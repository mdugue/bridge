"""OSM's passages through buildings (`tunnel=building_passage`) →
`data/<site>/dlm/passages_<tile>.geojson`, which the building bake
(`scripts/bake-city-mesh.ts`) cuts through the LoD2 walls they run through
and lines with walls and a ceiling: the gateway into a courtyard (a
Tordurchfahrt), the Zwinger's gates, a passage under a station's hall.

LoD2 draws every building as a closed shell from the ground up, so a
passage was solid wall. Nothing measures one: the surface model sees the
roof over it, and the street photos' poses miss by half a metre (Plan 075),
so an opening read in them would be a guess. OSM maps them — a way tagged
`tunnel=building_passage` where it runs through the building; Dresden's
tiles hold 567 that run more than a metre through LoD2 — so the passage is
OSM's, never an invented one.

Per way on the ground floor (a `level` without a 0 or a `layer` above 0 —
the Zwinger's terrace walk through a pavilion, a garage ramp — is skipped;
`layer=-1`, which mappers give passages under the building's 0, stays):
- the stretches it runs inside the tile's LoD2 footprints, those less than
  `GAP_M` apart joined (a gateway through two houses' party wall is one),
  each at least `MIN_INSIDE_M` long; the way simplified (`SIMPLIFY_M`) and
  run on `MARGIN_M` past either wall, so the cut opens the wall through —
  but where the way ends inside the buildings, more than `MARGIN_M` from
  their outline (a drive into a garage, a track into its shed), the
  passage ends there, shut by a wall across it (`sides`): it runs into the
  building, not through its hollow shell;
- its width (`w`): `width` where plausible (`WIDTH`), else by its kind
  (`wFrom`): a drive's `DRIVE_W` (a fire lane's clear width under DIN
  14090, 3 m, with the gateway's jambs), a track's `TRACK_W` (a railway
  into its shed, kind `railway`), a footway's `WALK_W`;
- its clear height (`h`): `maxheight:physical` or `maxheight` where
  plausible (`HEIGHT`), else null — the build takes the ground storey's
  (lib/city/building-passages.ts);
- per LoD2 object whose footprint the passage's strip reaches (`of`; a
  part of the building beside the way is cut too, so it is lined too):
  the ceiling's plan (`roof`: the strip ∩ its footprint, outer rings), the
  walls along it (`sides`: the strip's edges and a shut end ∩ its
  footprint, each walked with the passage on its left)
  and its portals (`portals`: where the way meets the outline, `[x, y, nx,
  ny]` with the wall's outward normal; the windows keep off a portal as
  off a door);
- the ground along it (`z`: per vertex of its axis the lowest DGM1 sample
  within `NEAR_M` along it, every `STEP_M`), which its walls reach under
  and its ceiling follows — a passage down to the Zwingerteich falls 4 m.

A passage mapped as a chain of ways (a footway, a flight of steps, a
footway) is one: the ground-floor passage ways that meet end to end are
merged first (their ids in `osm`, the longest's kind, the widest tagged
width, the lowest tagged height). A stretch that bends more than
`MAX_BEND_DEG` at a vertex is dropped (the build mitres a bend; past that
the strip folds over itself), and so is one that meets no outline: a
piece inside a building opens nothing."""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
import shapely
from shapely.ops import substring

from .common import OSM_ATTRIBUTION, Sampler, Tile, column, feature, write_geojson
from .doors import measure, snap
from .osm import has_extract, read_osm, tag
from .osm_buildings import footprints

WHERE = 'other_tags LIKE \'%"tunnel"=>"building_passage"%\''
# the highway kinds a vehicle drives through: a drive's width, else a walk's
DRIVES = {
    "living_street",
    "primary",
    "residential",
    "road",
    "secondary",
    "service",
    "tertiary",
    "track",
    "unclassified",
}
DRIVE_W = 3.5
WALK_W = 2.5
# a track's: a single track's structure gauge, 2.2 m either side of its axis
TRACK_W = 4.5
WIDTH = (1.5, 12.0)  # m, a tagged width outside is a typo
HEIGHT = (2.0, 10.0)  # m, a tagged clear height outside is one
MIN_INSIDE_M = 1.0  # a way that only grazes a wall opens none
GAP_M = 2.0  # stretches inside this close are one passage
MARGIN_M = 0.6  # the stretch runs on past each wall
SIMPLIFY_M = 0.3
MAX_BEND_DEG = 60.0
STEP_M = 0.5  # the ground along the passage
NEAR_M = 1.0  # ... read this far along it either side of a vertex
MIN_PIECE_M = 0.2  # a side wall shorter than this is none
MIN_ROOF_M2 = 0.2


def on_ground_floor(other_tags: str | None) -> bool:
    """Whether the way runs at street level: no `level` without a 0, no
    `layer` above 0 (a negative layer is the passage under its building)."""
    level = tag(other_tags, "level")
    if level is not None:
        parts = [p.strip() for p in level.replace(",", ";").split(";")]
        if "0" not in parts:
            return False
    layer = (tag(other_tags, "layer") or "0").strip()
    try:
        return float(layer) <= 0
    except ValueError:
        return False


def kind_of(highway: str | None, railway: str | None) -> str | None:
    """A passage way's kind: its `highway`, `railway` for a track (yard
    tracks into their sheds, a tram into its depot), else None."""
    if highway:
        return highway
    return "railway" if railway else None


def width_of(kind: str | None, tagged: float | None) -> tuple[float, str]:
    """The passage's width and where it comes from: the `width` tag, or the
    way's kind."""
    if tagged is not None:
        return tagged, "width"
    if kind == "railway":
        return TRACK_W, "kind"
    return (DRIVE_W if kind in DRIVES else WALK_W), "kind"


def height_of(other_tags: str | None) -> float | None:
    """The clear height OSM gives, or None."""
    for key in ("maxheight:physical", "maxheight"):
        value = measure(other_tags, key, *HEIGHT)
        if value is not None:
            return value
    return None


class Way:
    """A passage way, or a chain of them merged end to end."""

    def __init__(self, line: shapely.LineString, ids: list[int], kind, width, height):
        self.line = line
        self.ids = ids
        self.kind = kind
        self.width = width
        self.height = height


def merged(ways: list[tuple[shapely.LineString, int, str | None, str | None]]) -> list[Way]:
    """The ground-floor passage ways, those that meet end to end merged:
    each chain with its members' ids, the longest's kind, the widest tagged
    width and the lowest tagged height."""
    kept = [w for w in ways if on_ground_floor(w[3])]
    if not kept:
        return []
    lines = shapely.line_merge(shapely.MultiLineString([w[0] for w in kept]))
    out = []
    for line in getattr(lines, "geoms", [lines]):
        near = line.buffer(0.01)
        members = [w for w in kept if near.contains(w[0])]
        if not members:
            continue
        longest = max(members, key=lambda w: w[0].length)
        widths = [v for w in members if (v := measure(w[3], "width", *WIDTH)) is not None]
        heights = [v for w in members if (v := height_of(w[3])) is not None]
        out.append(
            Way(
                line,
                sorted(w[1] for w in members),
                longest[2],
                max(widths) if widths else None,
                min(heights) if heights else None,
            )
        )
    return out


def stretches(
    line: shapely.LineString, inside: list[shapely.Geometry]
) -> list[tuple[float, float]]:
    """The intervals (m along `line`) it runs inside the footprints, those
    under GAP_M apart joined, each at least MIN_INSIDE_M long."""
    spans = []
    for geom in inside:
        for part in getattr(geom, "geoms", [geom]):
            if part.geom_type != "LineString" or part.length <= 0:
                continue
            a, b = (line.project(shapely.Point(c)) for c in (part.coords[0], part.coords[-1]))
            spans.append((min(a, b), max(a, b)))
    spans.sort()
    out: list[list[float]] = []
    for a, b in spans:
        if out and a - out[-1][1] < GAP_M:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out if b - a >= MIN_INSIDE_M]


def extended(line: shapely.LineString, s0: float, s1: float) -> shapely.LineString:
    """The way from `s0` to `s1` (m along it), run on in its end segments'
    directions where the interval reaches past an end."""
    piece = substring(line, max(s0, 0.0), min(s1, line.length))
    xy = np.asarray(piece.coords, dtype=float)
    if len(xy) < 2:
        return piece
    if s0 < 0:
        d = xy[0] - xy[1]
        xy[0] = xy[0] + d / np.linalg.norm(d) * -s0
    if s1 > line.length:
        d = xy[-1] - xy[-2]
        xy[-1] = xy[-1] + d / np.linalg.norm(d) * (s1 - line.length)
    return shapely.LineString(xy)


def max_bend(line: shapely.LineString) -> float:
    """The sharpest turn at any vertex of `line` (degrees)."""
    xy = np.asarray(line.coords, dtype=float)
    worst = 0.0
    for a, b, c in zip(xy[:-2], xy[1:-1], xy[2:], strict=True):
        u, v = b - a, c - b
        nu, nv = np.linalg.norm(u), np.linalg.norm(v)
        if nu > 0 and nv > 0:
            cos = float(np.clip(np.dot(u, v) / (nu * nv), -1.0, 1.0))
            worst = max(worst, math.degrees(math.acos(cos)))
    return worst


def left_of_inside(piece: shapely.LineString, strip: shapely.Geometry) -> shapely.LineString:
    """`piece` walked so that the strip lies on its left."""
    (ax, ay), (bx, by) = piece.coords[0], piece.coords[1]
    length = math.hypot(bx - ax, by - ay)
    mx, my = (ax + bx) / 2, (ay + by) / 2
    probe = shapely.Point(mx - (by - ay) / length * 0.05, my + (bx - ax) / length * 0.05)
    return piece if strip.contains(probe) else shapely.LineString(piece.coords[::-1])


def r2(v: float) -> float:
    return round(float(v), 2)


def coords(geom) -> list[list[float]]:
    return [[r2(x), r2(y)] for x, y in geom.coords]


def strip_of(axis: shapely.LineString, w: float) -> shapely.Geometry:
    """The passage's plan: `w` wide along `axis`, square at its ends."""
    return axis.buffer(w / 2, cap_style="flat", join_style="mitre", mitre_limit=10.0)


def end_wall(axis: shapely.LineString, w: float, end: int) -> shapely.LineString:
    """The wall across the passage at its axis' start (`end` 0) or end (−1)."""
    xy = np.asarray(axis.coords, dtype=float)
    at, before = (xy[0], xy[1]) if end == 0 else (xy[-1], xy[-2])
    d = (at - before) / np.linalg.norm(at - before)
    m = np.array([-d[1], d[0]]) * w / 2
    return shapely.LineString([at - m, at + m])


def object_part(
    axis: shapely.LineString,
    w: float,
    poly: shapely.Geometry,
    shut: tuple[bool, bool] = (False, False),
) -> dict | None:
    """What one footprint holds of the passage along `axis`: its ceiling's
    plan, its walls (along it, and across it at an end `shut`) and its
    portals, or None when the strip misses it."""
    strip = strip_of(axis, w)
    roof = []
    for part in getattr(strip.intersection(poly), "geoms", [strip.intersection(poly)]):
        if part.geom_type == "Polygon" and part.area >= MIN_ROOF_M2:
            roof.append(coords(shapely.orient_polygons(part).exterior))
    if not roof:
        return None
    sides = []
    edges = [axis.offset_curve(d, join_style="mitre", mitre_limit=10.0) for d in (w / 2, -w / 2)]
    edges += [end_wall(axis, w, end) for end, closed in zip((0, -1), shut, strict=True) if closed]
    for edge in edges:
        cut = edge.intersection(poly)
        for piece in getattr(cut, "geoms", [cut]):
            if piece.geom_type == "LineString" and piece.length >= MIN_PIECE_M:
                sides.append(coords(left_of_inside(piece, strip)))
    portals = []
    hits = axis.intersection(poly.boundary)
    for point in getattr(hits, "geoms", [hits]):
        if point.geom_type != "Point":
            continue
        snapped = snap(point, poly)
        if snapped is not None:
            x, y, nx, ny, _ = snapped
            portals.append([r2(x), r2(y), round(nx, 3), round(ny, 3)])
    return {"roof": roof, "sides": sides, "portals": portals}


def ground_along(axis: shapely.LineString, dgm) -> list[float] | None:
    """Per vertex of the axis the lowest DGM1 sample within NEAR_M along it
    (every STEP_M): the floor at that vertex. None where one has none."""
    n = max(2, int(math.ceil(axis.length / STEP_M)) + 1)
    at = np.linspace(0.0, axis.length, n)
    points = [axis.interpolate(s) for s in at]
    values = np.array([float(v[0]) for v in dgm.sample([(p.x, p.y) for p in points])])
    ok = (values > -1000) & np.isfinite(values)
    out = []
    for c in axis.coords:
        s = axis.project(shapely.Point(c))
        near = ok & (np.abs(at - s) <= NEAR_M)
        if not near.any():
            return None
        out.append(r2(values[near].min()))
    return out


def ends_inside(point, polys: list[shapely.Geometry], tree: shapely.STRtree) -> bool:
    """Whether a way's end lies inside the buildings, more than MARGIN_M
    from their joint outline: a dead end (a drive into a garage), not a way
    that stops at the wall."""
    p = shapely.Point(point)
    near = [polys[i] for i in tree.query(p.buffer(MARGIN_M))]
    if not near:
        return False
    union = shapely.union_all(near)
    return union.contains(p) and union.boundary.distance(p) > MARGIN_M


def passages_of(
    way: Way,
    ids: list[str],
    polys: list[shapely.Geometry],
    tree: shapely.STRtree,
    dgm,
) -> list[tuple[shapely.LineString, dict]]:
    """The way's passages through the footprints: each stretch's axis and
    its properties (the module's doc)."""
    line = way.line
    hit = [i for i in tree.query(line) if polys[i].intersects(line)]
    inside = [line.intersection(polys[i]) for i in hit]
    w, w_from = width_of(way.kind, way.width)
    out = []
    for s0, s1 in stretches(line, inside):
        shut = (
            s0 <= 0 and ends_inside(line.coords[0], polys, tree),
            s1 >= line.length and ends_inside(line.coords[-1], polys, tree),
        )
        axis = extended(
            line, s0 if shut[0] else s0 - MARGIN_M, s1 if shut[1] else s1 + MARGIN_M
        ).simplify(SIMPLIFY_M)
        if len(axis.coords) < 2 or max_bend(axis) > MAX_BEND_DEG:
            continue
        # every footprint the strip reaches: the build cuts each building
        # tree it runs through, a part beside the way as much as the host
        parts = {}
        for i in tree.query(strip_of(axis, w)):
            part = object_part(axis, w, polys[i], shut)
            if part is not None:
                parts[ids[int(i)]] = part
        z = ground_along(axis, dgm)
        if not any(p["portals"] for p in parts.values()) or z is None:
            continue
        props = {
            "osm": way.ids,
            "kind": way.kind or "way",
            "w": r2(w),
            "wFrom": w_from,
            "h": way.height,
            "z": z,
            "of": parts,
        }
        out.append((axis, props))
    return out


def run(tile: Tile) -> None:
    city_path = tile.data / "cityjson" / f"lod2_{tile.id}.city.json"
    if not city_path.exists() or not tile.dgm.exists() or not has_extract(tile, "the passages"):
        return
    city = json.loads(city_path.read_text())
    ids, polys = footprints(city)
    tree = shapely.STRtree(polys)
    geoms, fields = read_osm(tile, "lines", WHERE, ["osm_id", "highway", "railway", "other_tags"])
    ways = [
        (g, int(osm_id), kind_of(highway, railway), other)
        for g, osm_id, highway, railway, other in zip(
            geoms,
            column(fields, "osm_id", geoms),
            column(fields, "highway", geoms),
            column(fields, "railway", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        )
        if g is not None and g.geom_type == "LineString"
    ]
    found: list[tuple[shapely.LineString, dict]] = []
    with rasterio.open(tile.dgm) as ds:
        dgm = Sampler(ds)
        for way in merged(ways):
            found.extend(passages_of(way, ids, polys, tree, dgm))
    found.sort(key=lambda f: (r2(f[0].centroid.y), r2(f[0].centroid.x), f[1]["osm"]))
    features = [
        feature({"type": "LineString", "coordinates": coords(axis)}, props) for axis, props in found
    ]
    write_geojson(
        tile.out("dlm", f"passages_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    print(
        f"{tile.id}: {len(features)} passages through {sum(len(p['of']) for _, p in found)} objects"
    )
