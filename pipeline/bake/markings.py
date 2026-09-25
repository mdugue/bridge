"""OSM crossings, signals and lane tags → road markings: zebra crossings,
signalled crossings (a *Furt*: two broken lines), stop lines, cycle lanes
and centre lines, painted by the terrain shader in the ground's own
fragment pass (app/_components/road-markings.ts), like the sports grounds.

The table (`markings_<tile>.json`) is one row per painted crossing or stop
line:

    [cx, cy, angle, halfLength, halfWidth, kind]

`cx, cy` is the centre in metres from the tile's north-west corner (x east,
y north, so y ≤ 0 on the tile); `angle` the marking's long axis — ACROSS the
road, the way a pedestrian walks (radians from east, counter-clockwise);
`halfLength` half its extent across the road (the carriageway measured on
the class raster), `halfWidth` half its extent along the road. `kind`
indexes `KINDS` (keep them in step with lib/city/markings.ts).

- A crossing (`highway=crossing` node) is painted when OSM says it is
  marked: `crossing:markings` zebra → zebra, dashes/dots → furt, no/surface
  → nothing; else `crossing_ref=zebra` → zebra; else `crossing` =
  traffic_signals → furt (German signalled crossings are broken lines, not
  a zebra), marked/uncontrolled/zebra → zebra, anything else nothing. Its
  axis is the normal of the nearest carriageway way at the node; its extent
  the contiguous DLM road texels (class 7) along that normal.
- A stop line: 3 m before a `highway=traffic_signals` node whose
  `traffic_signals:direction` (or `direction`) is forward or backward, on
  the right half of the approach (right-hand traffic; the whole carriageway
  on a oneway), 0.5 m wide.

The raster (`markings_<tile>.png`, 2048² over a 2 km tile, ≈1 m) is four
bytes per texel, interleaved in an 8-bit greyscale PNG four times as wide
(R0 G0 B0 A0 R1 …, read by lib/city/png-raster.ts):

    R, A  = 1 + the row whose outline, grown by 1 m, reaches the texel
            (low, high byte; 0 none)
    G     = lane bits on road texels: 1 = a cycle lane runs along the kerb on
            THIS side of the way, 4 = a centre line road
    B     = 128 + 20 · the signed distance (m) to the carriageway's middle
            (centre-line roads only; ±6.35 m)

The side is resolved here, per texel (which side of the nearest way it lies
on), because the paving raster's bearing is only known modulo 180°. Centre
lines: two-way (no `oneway`) primary/secondary/tertiary/trunk/unclassified
roads with `lanes` ≥ 2, not `lane_markings=no`, where the carriageway is at
least 5.5 m wide, and not within 12 m of a junction node. The middle is
where the distances to the kerbs on the way's two sides are equal. Cycle
lanes: `cycleway:right|left|both=lane`, `cycleway=lane` (both sides of a
two-way road, the right of a oneway).
"""

from __future__ import annotations

import json
import math

import numpy as np
import shapely
from PIL import Image
from rasterio.features import rasterize
from scipy import ndimage as ndi

from .common import OSM_ATTRIBUTION, Tile, column, owns
from .osm import has_extract, read_osm, tag

# id → key; keep in step with `MARKING_KINDS` in lib/city/markings.ts.
KINDS = {0: "none", 1: "zebra", 2: "furt", 3: "stop"}
ZEBRA, FURT, STOP = 1, 2, 3
HALF_WIDTH = {ZEBRA: 2.0, FURT: 1.5, STOP: 0.25}  # m along the road
STOP_BEFORE_M = 3.0
ROAD = 7
MOTOR = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "busway",
    "road",
)
CENTRE_ROADS = ("trunk", "primary", "secondary", "tertiary", "unclassified")
CENTRE_MIN_WIDTH_M = 5.5
JUNCTION_CLEAR_M = 12.0
MAX_CARRIAGEWAY_M = 30.0  # wider runs are a square or a junction box: not painted
SNAP_M = 3.0  # how far along the normal the carriageway may start from the node
CROSSING_SAMPLES = (0.0, -5.0, 5.0, -10.0, 10.0)  # m along the road
STOP_SAMPLES = (0.0, 4.0, 8.0)  # m back along the approach
LOCAL_SLACK_M = 1.5
GROW_M = 1.0
EDGE_SCALE = 20.0  # bytes per metre, as edges.py
SIDE_REACH_M = 20.0  # texels farther from every way get no side


def _base(highway: str | None) -> str | None:
    if not highway:
        return None
    return highway.removesuffix("_link")


def crossing_kind(other_tags: str | None) -> int:
    """The paint of a `highway=crossing` node (0: nothing)."""
    markings = tag(other_tags, "crossing:markings")
    if markings == "zebra":
        return ZEBRA
    if markings in ("dashes", "dots"):
        return FURT
    if markings in ("no", "surface"):
        return 0
    if tag(other_tags, "crossing_ref") == "zebra":
        return ZEBRA
    crossing = tag(other_tags, "crossing")
    signals = crossing == "traffic_signals" or tag(other_tags, "crossing:signals") == "yes"
    if signals:
        return FURT
    if crossing in ("marked", "uncontrolled", "zebra") or markings == "yes":
        return ZEBRA
    return 0


def signal_direction(other_tags: str | None) -> int:
    """+1 forward, −1 backward, 0 unknown/both."""
    value = tag(other_tags, "traffic_signals:direction") or tag(other_tags, "direction")
    return {"forward": 1, "backward": -1}.get(value or "", 0)


def is_oneway(other_tags: str | None) -> bool:
    return tag(other_tags, "oneway") in ("yes", "true", "1", "-1")


def lane_count(other_tags: str | None) -> int:
    try:
        return int(float((tag(other_tags, "lanes") or "0").split(";")[0]))
    except ValueError:
        return 0


def has_centre_line(highway: str | None, other_tags: str | None) -> bool:
    return (
        _base(highway) in CENTRE_ROADS
        and not is_oneway(other_tags)
        and lane_count(other_tags) >= 2
        and tag(other_tags, "lane_markings") != "no"
    )


def cycle_sides(other_tags: str | None) -> tuple[bool, bool]:
    """(a cycle lane on the way's right, on its left)."""

    def lane(key: str) -> bool:
        return tag(other_tags, key) == "lane"

    both = lane("cycleway:both")
    plain = lane("cycleway")
    right = both or lane("cycleway:right") or plain
    left = both or lane("cycleway:left") or (plain and not is_oneway(other_tags))
    return right, left


# --- geometry -------------------------------------------------------------


class ClassRaster:
    """The committed class raster with its EPSG mapping (row 0 = north)."""

    def __init__(self, cls: np.ndarray, bounds: tuple[float, float, float, float]):
        self.cls = cls
        self.xmin, self.ymin, self.xmax, self.ymax = bounds
        self.n = cls.shape[0]
        self.res = (self.xmax - self.xmin) / self.n

    def is_road(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        c = np.floor((np.asarray(x) - self.xmin) / self.res).astype(np.int64)
        r = np.floor((self.ymax - np.asarray(y)) / self.res).astype(np.int64)
        ok = (c >= 0) & (c < self.n) & (r >= 0) & (r < self.n)
        out = np.zeros(np.shape(c), bool)
        out[ok] = self.cls[r[ok], c[ok]] == ROAD
        return out


def carriageway(
    raster: ClassRaster, p: np.ndarray, n: np.ndarray, step: float = 0.25
) -> tuple[float, float] | None:
    """The contiguous road run through (or within SNAP_M of) p along the unit
    normal n, as (t0, t1) in metres from p; None where there is no road or
    the run is wider than MAX_CARRIAGEWAY_M."""
    reach = MAX_CARRIAGEWAY_M + SNAP_M
    t = np.arange(-reach, reach + step / 2, step)
    road = raster.is_road(p[0] + t * n[0], p[1] + t * n[1])
    near = np.flatnonzero(road & (np.abs(t) <= SNAP_M))
    if len(near) == 0:
        return None
    start = near[np.argmin(np.abs(t[near]))]
    lo = start
    while lo > 0 and road[lo - 1]:
        lo -= 1
    hi = start
    while hi < len(t) - 1 and road[hi + 1]:
        hi += 1
    if lo == 0 or hi == len(t) - 1:
        return None
    t0, t1 = t[lo] - step / 2, t[hi] + step / 2
    if t1 - t0 > MAX_CARRIAGEWAY_M:
        return None
    return float(t0), float(t1)


def tangent_at(line: shapely.Geometry, p: shapely.Point) -> np.ndarray:
    """The unit direction of the line at its point nearest p (digitised
    direction)."""
    s = line.project(p)
    a = line.interpolate(max(s - 1.0, 0.0))
    b = line.interpolate(min(s + 1.0, line.length))
    d = np.array([b.x - a.x, b.y - a.y])
    norm = np.hypot(*d)
    return d / norm if norm > 1e-9 else np.array([1.0, 0.0])


def nearest_way(tree: shapely.STRtree, ways, p: shapely.Point, within: float):
    """Index of the nearest way within `within` metres, or None."""
    hit = tree.query_nearest(p, max_distance=within, all_matches=False)
    return int(hit[0]) if len(hit) else None


def carriageway_near(
    raster: ClassRaster, p: np.ndarray, t: np.ndarray, n: np.ndarray, offsets
) -> tuple[float, float] | None:
    """The carriageway across n at p, measured also a few metres along the
    road (`offsets` along t): at a junction the normal through the node runs
    down the crossing street, so the arm's narrowest valid run nearby wins;
    the run at p itself when it is within `LOCAL_SLACK_M` of that."""
    runs = {}
    for k in offsets:
        run = carriageway(raster, p + t * k, n)
        if run is not None:
            runs[k] = run
    if not runs:
        return None
    best = min(runs.values(), key=lambda r: r[1] - r[0])
    here = runs.get(0.0)
    if here is not None and (here[1] - here[0]) - (best[1] - best[0]) <= LOCAL_SLACK_M:
        return here
    return best


def crossing_row(raster, ways, tree, p, kind):
    i = nearest_way(tree, ways, p, 3.0)
    if i is None:
        return None
    t = tangent_at(ways[i], p)
    n = np.array([-t[1], t[0]])
    run = carriageway_near(raster, np.array([p.x, p.y]), t, n, CROSSING_SAMPLES)
    if run is None:
        return None
    t0, t1 = run
    c = np.array([p.x, p.y]) + n * (t0 + t1) / 2
    return [c[0], c[1], math.atan2(n[1], n[0]), (t1 - t0) / 2, HALF_WIDTH[kind], kind]


def stop_row(raster, ways, tree, oneway, p, direction):
    i = nearest_way(tree, ways, p, 1.0)
    if i is None:
        return None
    travel = tangent_at(ways[i], p) * direction
    at = np.array([p.x, p.y]) - travel * STOP_BEFORE_M
    right = np.array([travel[1], -travel[0]])
    # back along the approach, away from the junction the signal guards
    run = carriageway_near(raster, at, -travel, right, STOP_SAMPLES)
    if run is None:
        return None
    t0, t1 = run
    if not oneway[i]:
        t0 = (t0 + t1) / 2
    c = at + right * (t0 + t1) / 2
    return [c[0], c[1], math.atan2(right[1], right[0]), (t1 - t0) / 2, HALF_WIDTH[STOP], STOP]


def rotated_rect(row) -> shapely.Geometry:
    cx, cy, angle, hl, hw, _ = row
    u = np.array([math.cos(angle), math.sin(angle)])
    v = np.array([-u[1], u[0]])
    c = np.array([cx, cy])
    corners = [c + su * hl * u + sv * hw * v for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return shapely.Polygon(corners)


# --- the per-texel lane fields ------------------------------------------------


def junctions(ways, highways) -> list[shapely.Point]:
    """Road junction nodes: vertices where three or more segment ends of
    the (non-service) road ways meet — a way running through counts two, a
    way ending there one, so a way merely split in two is no junction."""
    degree: dict[tuple[float, float], int] = {}
    for g, hw in zip(ways, highways, strict=True):
        if _base(hw) == "service":
            continue
        for part in shapely.get_parts(g):
            xy = np.round(np.asarray(part.coords)[:, :2], 2)
            for k, (x, y) in enumerate(xy):
                ends = 1 if k in (0, len(xy) - 1) else 2
                degree[(x, y)] = degree.get((x, y), 0) + ends
    return [shapely.Point(xy) for xy, d in degree.items() if d >= 3]


def nearest_way_fields(tile: Tile, px: int, ways):
    """Per texel: the index of the nearest way (−1 far from all), whether
    the texel lies on its right (digitised direction) and within reach."""
    res = (tile.bounds[2] - tile.bounds[0]) / px
    transform = tile.transform(px)
    ids = np.zeros((px, px), np.int32)
    heading = np.zeros((px, px), np.float32)
    idx, angles = [], []
    for i, g in enumerate(ways):
        for part in shapely.get_parts(g):
            xy = np.asarray(part.coords)[:, :2]
            for a, b in zip(xy[:-1], xy[1:], strict=True):
                if np.hypot(*(b - a)) > 1e-6:
                    seg = shapely.LineString([a, b])
                    idx.append((seg, i + 1))
                    angles.append((seg, math.atan2(b[1] - a[1], b[0] - a[0])))
    if not idx:
        return np.full((px, px), -1), np.zeros((px, px), bool), np.zeros((px, px), bool)
    rasterize(idx, out=ids, transform=transform, all_touched=True, dtype=np.int32)
    rasterize(angles, out=heading, transform=transform, all_touched=True, dtype=np.float32)
    dist, (ri, ci) = ndi.distance_transform_edt(ids == 0, return_indices=True)
    way = ids[ri, ci] - 1
    ang = heading[ri, ci]
    rows, cols = np.mgrid[0:px, 0:px]
    dx = (cols - ci) * res  # east
    dy = -(rows - ri) * res  # north
    right = np.cos(ang) * dy - np.sin(ang) * dx < 0
    near = dist * res <= SIDE_REACH_M
    return np.where(near, way, -1), right, near


def lane_fields(
    tile: Tile, px: int, road: np.ndarray, ways, highways, centre, cycle
) -> tuple[np.ndarray, np.ndarray]:
    """(G lane bits, B centre offset byte), px² each. `road` is the class
    raster's road mask at px²; `centre[i]` whether way i draws a centre
    line; `cycle[i]` its (right, left) cycle lanes."""
    bits = np.zeros((px, px), np.uint8)
    offset = np.full((px, px), 128, np.uint8)
    if not any(centre) and not any(any(c) for c in cycle):
        return bits, offset
    way, right, _ = nearest_way_fields(tile, px, ways)
    n = len(ways)
    w = np.where(way >= 0, way, n)  # n: no way
    lane_r = np.array([c[0] for c in cycle] + [False])
    lane_l = np.array([c[1] for c in cycle] + [False])
    bits |= (road & np.where(right, lane_r[w], lane_l[w])).astype(np.uint8)
    is_c = np.array(list(centre) + [False])[w]
    if not is_c.any():
        return bits, offset
    res = (tile.bounds[2] - tile.bounds[0]) / px
    kerb_r = ~road & right & is_c
    kerb_l = ~road & ~right & is_c
    if not (kerb_r.any() and kerb_l.any()):
        return bits, offset
    d_r = ndi.distance_transform_edt(~kerb_r) * res
    d_l = ndi.distance_transform_edt(~kerb_l) * res
    width = d_r + d_l
    s = (d_l - d_r) / 2  # + right of the middle
    clear = np.ones((px, px), bool)
    pts = junctions(ways, highways)
    if pts:
        burned = rasterize(
            [(pt.buffer(JUNCTION_CLEAR_M), 1) for pt in pts],
            out_shape=(px, px),
            transform=tile.transform(px),
            dtype=np.uint8,
        )
        clear = burned == 0
    ok = road & is_c & clear & (width >= CENTRE_MIN_WIDTH_M) & (width <= MAX_CARRIAGEWAY_M)
    bits |= ok.astype(np.uint8) << 2
    code = np.clip(np.round(128 + EDGE_SCALE * s), 1, 255).astype(np.uint8)
    return bits, np.where(ok, code, offset)


def road_mask(tile: Tile, px: int) -> ClassRaster | None:
    png = tile.data / "dlm" / f"landcover_{tile.id}.png"
    if not png.exists():
        return None
    cls = np.asarray(Image.open(png).convert("L"))
    return ClassRaster(cls, tile.bounds)


def index_raster(rows: list[list[float]], tile: Tile, px: int) -> np.ndarray:
    """1 + the row reaching each texel (outlines grown by GROW_M), uint16."""
    out = np.zeros((px, px), np.uint16)
    if rows:
        shapes = [(rotated_rect(r).buffer(GROW_M), i + 1) for i, r in enumerate(rows)]
        rasterize(shapes, out=out, transform=tile.transform(px), dtype=np.uint16)
    return out


def table_row(tile: Tile, row: list[float]) -> list:
    xmin, _, _, ymax = tile.bounds
    cx, cy, angle, hl, hw, kind = row
    return [round(cx - xmin, 2), round(cy - ymax, 2), round(angle, 4), round(hl, 2), hw, kind]


def table_json(table: dict, rows: list[list]) -> str:
    """One marking per line (diffable, still plain JSON)."""
    head = json.dumps(table, indent=2)[:-2]
    body = ",\n".join(f"    {json.dumps(r)}" for r in rows)
    listed = f"[\n{body}\n  ]" if rows else "[]"
    return f'{head},\n  "markings": {listed}\n}}\n'


def build(tile: Tile, raster: ClassRaster, px: int, points, pt_fields, lines, ln_fields):
    highways = column(ln_fields, "highway", lines)
    line_tags = column(ln_fields, "other_tags", lines)
    motor = [i for i, h in enumerate(highways) if _base(h) in MOTOR]
    ways = [lines[i] for i in motor]
    tags = [line_tags[i] for i in motor]
    tree = shapely.STRtree(ways) if ways else None
    oneway = [is_oneway(t) for t in tags]
    rows, counts = [], {"crossings": 0, "crossings_unplaced": 0, "stops": 0, "stops_unplaced": 0}
    if tree is not None:
        for p, hw, t in zip(
            points,
            column(pt_fields, "highway", points),
            column(pt_fields, "other_tags", points),
            strict=True,
        ):
            if not owns(tile.bounds, p.x, p.y):
                continue
            if hw == "crossing" and (kind := crossing_kind(t)):
                row = crossing_row(raster, ways, tree, p, kind)
                key = "crossings"
            elif hw == "traffic_signals" and (direction := signal_direction(t)):
                row = stop_row(raster, ways, tree, oneway, p, direction)
                key = "stops"
            else:
                continue
            if row is None:
                counts[f"{key}_unplaced"] += 1
            else:
                counts[key] += 1
                rows.append(row)
    # a texel is road where most of the class raster's texels under it are
    k = raster.n // px
    road = (raster.cls == ROAD).reshape(px, k, px, k).mean(axis=(1, 3)) >= 0.5
    motor_hw = [highways[i] for i in motor]
    centre = [has_centre_line(h, t) for h, t in zip(motor_hw, tags, strict=True)]
    cycle = [cycle_sides(t) for t in tags]
    bits, offset = lane_fields(tile, px, road, ways, motor_hw, centre, cycle)
    return rows, bits, offset, counts


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the road markings"):
        return
    raster = road_mask(tile, px)
    if raster is None:
        print(f"{tile.id}: no class raster — skipping the road markings")
        return
    points, pf = read_osm(
        tile, "points", "highway IN ('crossing', 'traffic_signals')", ["highway", "other_tags"]
    )
    lines, lf = read_osm(tile, "lines", "highway IS NOT NULL", ["highway", "other_tags"], 0.003)
    rows, bits, offset, counts = build(tile, raster, px, points, pf, lines, lf)
    index = index_raster(rows, tile, px)
    grey = np.stack(
        [(index & 0xFF).astype(np.uint8), bits, offset, (index >> 8).astype(np.uint8)], axis=-1
    ).reshape(px, 4 * px)
    Image.fromarray(grey, mode="L").save(tile.out("dlm", f"markings_{tile.id}.png"), optimize=True)
    table = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "layout": "8-bit greyscale, 4 * size wide: R0 G0 B0 A0 R1 ... per row",
            "ra": "1 + the row of `markings` reaching the texel (R low, A high byte; 0 none)",
            "g": "lane bits: 1 cycle lane along this side's kerb, 4 centre-line road",
            "b": f"128 + {EDGE_SCALE:g} * the signed distance (m) to the carriageway's middle",
            "markings": "[cx, cy, angle, halfLength, halfWidth, kind]: the centre in m from "
            "the tile's north-west corner (x east, y north), the axis across the road "
            "(rad from east, ccw), half the extent across and along the road",
        },
        "kinds": {str(k): v for k, v in KINDS.items()},
        "attribution": OSM_ATTRIBUTION,
    }
    listed = [table_row(tile, r) for r in rows]
    tile.out("dlm", f"markings_{tile.id}.json").write_text(table_json(table, listed))
    kinds = {KINDS[k]: sum(1 for r in rows if r[5] == k) for k in (ZEBRA, FURT, STOP)}
    print(
        f"{tile.id}: {len(rows)} markings {kinds}, {counts}; "
        f"cycle-lane texels {int((bits & 1).sum())}, "
        f"centre-line texels {int((bits & 4).sum() // 4)}"
    )
