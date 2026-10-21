"""The land-cover class raster → an edge-distance raster: for every texel the
signed distance (m) to the carriageway's edge and to the meadow's edge,
smoothed, 2048² over a 2 km tile (≈1 m).

The DLM road class (7) is the carriageway at its surveyed width, so its edge
is the kerb line; the terrain shader draws the kerb, the gutter and the
parking lanes (2–5 m out from the kerb) at distances from it, and lays paving
rows along it. Reading the class raster alone, the shader only knows that
distance within about a texel of the edge, and it follows the raster's 0.5 m
staircase. Here it is measured out to ±6 m and smoothed, so its isolines run
straight along a diagonal street and parallel to the kerb.

Two bytes per texel, interleaved in an 8-bit greyscale PNG twice as wide
(R0 G0 R1 G1 …, read by the viewer's own PNG decoder, lib/city/png-raster.ts):

    R = 128 + 20 · distance to the road edge   (positive on the road)
    G = 128 + 20 · distance to the meadow edge (positive on the meadow,
                                               urban green and verges
                                               included)

so 5 cm steps over ±6.35 m, clamped. Keep `EDGE_SCALE` in step with the
viewer (`EDGE_SCALE` in lib/city/landcover.ts). Needs only the committed
class raster (plus the NDVI and paving rasters, the baked rails and the OSM
tracks and roads when present), so it runs without the raw DLM; it runs after
`surface` and `rail`. Only the verges (`verge_green`: the DLM's road land
past the carriageway that is green, low ground) need DOM1 and, where the
provider has one, the DLM's road axes; without them none is found. A verge
counts as meadow and not as road, so its edge with the carriageway is the
road's edge (and a kerb, in town).

It also writes the kerb lines (`kerbs_<tile>.geojson`): the smoothed road
edge where the far side is ground, the carriageway on each line's left, and
the road is not one out of town (`out_of_town`), each with the stretches
OSM lowers (`low`: crossings, lowered kerbs, driveways — kerb_drops.py).
The terrain bake stands a kerb stone on them (lib/city/kerbs.ts).
"""

from __future__ import annotations

import json
import re

import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from scipy import ndimage as ndi

from . import surface, ways
from .common import Tile, column, feature, geometry_json, save_grey_png, write_geojson
from .kerb_drops import kerb_drops
from .osm import has_extract, read_osm, read_ways, tag

ROAD = 7
MEADOW = 1
ARABLE = 9  # a lawn's edge as when it was meadow (landcover.py ARABLE_VEG)
BUILTUP = 4
RAILWAY = 5
NO_KERB = (5, 8)  # railway, water: a carriageway edge there is no kerb
# Urban green: built-up or unclassified ground whose DOP NDVI says green —
# courtyards, front gardens, parks inside the settlement — and railway land
# off the tracks (`ways.track_beds`: the DLM's parcel reaches the fences and
# holds the embankments' and the verges' grass). Counted as meadow here, so
# it gets the meadow's edges; the shader paints it as meadow.
GREEN_NDVI = 0.3
SEALED = (1, 2, 3, 4)  # OSM walk surfaces that are paved: never green
# Verges (PR #173, B12): the DLM's road parcel (class 7) holds more than the
# carriageway — the pavements, and the embankments, verges, junction islands
# and shrub strips between a dual carriageway's lanes, which the class raster
# painted as asphalt. Its green ground counts as meadow too, by the urban
# green's NDVI (`GREEN_NDVI`), but only where nothing paved can lie: clear of
# the carriageways and track beds (`ways.traffic`), of OSM's roads and
# walkways at their width (`surface`'s widths; a road tagged with a sidewalk
# one SIDEWALK_BAND wider) and of what OSM maps as paved ground (car parks,
# squares, highway areas but the traffic islands, buildings). Under a crown
# (the surface model LOW_M or more over the ground) the NDVI says little:
# it may be the crown's own green over a pavement (on that land 85 % of
# München's green and 89 % of Unna's stood under a crown, against about
# half in Dresden and Leipzig, 2026-10-21), and a leaf-off wood reads
# green in patches only. So there the land counts by its height: where
# the canopy is 2 · WIDE_M across (`binary_opening`: a wooded strip or
# embankment, not a row of street trees) and at least WOOD_GREEN of it
# reads green (not a deck or a roof). The seeds are closed over CLOSE_M
# within that land, their holes under a crown filled (the tree on an
# island) and kept in patches of VERGE_MIN_M2 or more. Without DOM1 no
# verge is found: a crown cannot be told from a lawn.
LOW_M = 1.0
WIDE_M = 4.0
WOOD_GREEN = 0.2
CLOSE_M = 2.0
VERGE_MIN_M2 = 25.0
SIDEWALK_BAND = surface.SIDEWALK_BAND
PAVED_AREAS = (
    "amenity IN ('parking', 'parking_space', 'bicycle_parking', 'motorcycle_parking', 'fuel') "
    "OR building IS NOT NULL OR other_tags LIKE '%\"highway\"=>%' "
    "OR other_tags LIKE '%\"area:highway\"=>%' "
    'OR other_tags LIKE \'%"place"=>"square"%\''
)
KERB_SIMPLIFY_M = 0.15
KERB_MIN_M = 3.0
EDGE_SCALE = 20.0  # bytes per metre
REACH_M = 6.5  # how far out the distance is measured
# Out of town no kerb lines the carriageway: an edge line, a verge and
# reflector posts. Mapillary at 13 kerbs along such roads on three sites
# (2026-10-20): 12 without a kerb, the one with a junction's island. OSM
# marks the road (`out_of_town`); a kerb's road is the carriageway on the
# ground nearest it within WAY_REACH_M (a motorway's edge lies up to ~15 m
# off its axis) — not one on a bridge over it.
CARRIAGEWAYS = (
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "living_street", "service", "road",
)  # fmt: skip
SPEED_ZONE_TAGS = ("maxspeed", "maxspeed:type", "source:maxspeed", "zone:traffic", "zone:maxspeed")
RURAL_KMH = 70  # a posted limit from this up, with no zone tag: out of town
WAY_REACH_M = 20.0


def distance_px(mask: np.ndarray, reach: int) -> np.ndarray:
    """For every texel, the distance (texels) to the nearest `True` one, by
    growing the mask ring by ring — 4-neighbours every ring, diagonals every
    other, an octagonal metric within ~8 % of the Euclidean one. Capped at
    `reach`; `True` texels are 0."""
    d = np.where(mask, 0.0, float(reach))
    cur = mask.copy()
    for ring in range(1, reach + 1):
        grow = cur.copy()
        grow[1:] |= cur[:-1]
        grow[:-1] |= cur[1:]
        grow[:, 1:] |= cur[:, :-1]
        grow[:, :-1] |= cur[:, 1:]
        if ring % 2 == 0:
            grow[1:, 1:] |= cur[:-1, :-1]
            grow[1:, :-1] |= cur[:-1, 1:]
            grow[:-1, 1:] |= cur[1:, :-1]
            grow[:-1, :-1] |= cur[1:, 1:]
        d[grow & ~cur] = ring
        cur = grow
    return d


def signed_distance_px(inside: np.ndarray, reach: int) -> np.ndarray:
    """Signed distance (texels) to the edge of `inside`, positive inside;
    the edge lies halfway between an inside and an outside texel."""
    return np.where(
        inside,
        distance_px(~inside, reach) - 0.5,
        -(distance_px(inside, reach) - 0.5),
    )


def box_blur(a: np.ndarray, passes: int = 3) -> np.ndarray:
    """Three 3×3 box passes ≈ a Gaussian of about one texel: the staircase
    of the class raster smoothed out of the distance's isolines."""
    out = a.astype(np.float64)
    for _ in range(passes):
        p = np.pad(out, 1, mode="edge")
        out = (
            sum(
                p[dy : dy + out.shape[0], dx : dx + out.shape[1]]
                for dy in range(3)
                for dx in range(3)
            )
            / 9.0
        )
    return out


def edge_field(cls: np.ndarray, class_id: int, res: float, out_px: int) -> np.ndarray:
    """The smoothed signed distance (m) to one class's edge, averaged down to
    out_px²."""
    reach = int(np.ceil(REACH_M / res)) + 2
    sd = box_blur(signed_distance_px(cls == class_id, reach)) * res
    k = cls.shape[0] // out_px
    return sd.reshape(out_px, k, out_px, k).mean(axis=(1, 3))


def off_tracks(tile: Tile, cls: np.ndarray) -> np.ndarray:
    """The railway texels clear of every track bed (`ways.track_beds`, grown
    by `ways.MARGIN_M`)."""
    rail = cls == RAILWAY
    beds = [shapely.buffer(g, ways.MARGIN_M) for g in ways.track_beds(tile)]
    if rail.any() and beds:
        on = np.zeros(cls.shape, dtype=np.uint8)
        rasterize(((g, 1) for g in beds), out=on, transform=tile.transform(cls.shape[0]))
        rail &= on == 0
    return rail


def green_ground(tile: Tile, n: int) -> np.ndarray | None:
    """The n² texels the NDVI calls green (`GREEN_NDVI`) that OSM does not
    call paved; None without the NDVI raster (the paving raster is
    optional)."""
    ndvi_png = tile.out("dlm", f"ndvi_{tile.id}.png")
    if not ndvi_png.exists():
        return None
    ndvi = np.asarray(Image.open(ndvi_png).convert("L"), dtype=np.float64) / 255.0
    # Upsampled and blurred: the ~2 m raster as a soft field, not a speckle.
    ndvi = box_blur(np.kron(ndvi, np.ones((n // ndvi.shape[0], n // ndvi.shape[1]))), passes=2)
    green = ndvi > GREEN_NDVI
    surface_png = tile.out("dlm", f"surface_{tile.id}.png")
    if surface_png.exists():
        grey = np.asarray(Image.open(surface_png).convert("L"))
        walk = (grey[:, 0::4] >> 3) & 7
        walk = np.kron(walk, np.ones((n // walk.shape[0], n // walk.shape[1]), dtype=np.uint8))
        green &= ~np.isin(walk, SEALED)
    return green


def urban_green(tile: Tile, cls: np.ndarray, green: np.ndarray | None = None) -> np.ndarray:
    """The built-up/background texels and the railway land off the tracks
    that the NDVI calls green and OSM does not call paved (the NDVI and
    paving rasters are optional; `green` is `green_ground`, if read)."""
    if green is None:
        green = green_ground(tile, cls.shape[0])
    if green is None:
        return np.zeros(cls.shape, dtype=bool)
    ground = np.isin(cls, (0, BUILTUP)) | off_tracks(tile, cls)
    return green & ground


def low_ground(tile: Tile, n: int) -> np.ndarray | None:
    """Where the surface model stands below LOW_M over the ground, on an n²
    grid (read at a quarter of it, ≈2 m); None without DOM1."""
    dom = tile.raw_raster("dom1")
    if not dom.exists() or not tile.dgm.exists():
        return None
    px = n // 4
    with rasterio.open(dom) as top, rasterio.open(tile.dgm) as dgm:
        a = top.read(1, out_shape=(px, px), resampling=Resampling.average).astype(np.float32)
        b = dgm.read(1, out_shape=(px, px), resampling=Resampling.average).astype(np.float32)
    return np.kron(a - b < LOW_M, np.ones((4, 4), dtype=bool))


def paved_ways(tile: Tile) -> list[shapely.Geometry]:
    """What OSM says is paved on the road land: every highway line at its
    width (or `surface`'s half-width for its kind; a road with a sidewalk
    tag SIDEWALK_BAND wider), grown by `ways.MARGIN_M`, and the paved areas
    (`PAVED_AREAS`) but the traffic islands."""
    out = []
    geoms, fields = read_ways(tile, "highway IS NOT NULL", ["highway", "other_tags"])
    for g, hw, tags in zip(
        geoms, column(fields, "highway", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        kind = (hw or "").removesuffix("_link")
        half = surface.ROAD_HALF_WIDTH.get(kind) or surface.WALK_HALF_WIDTH.get(kind)
        if g is None or half is None:
            continue
        width = surface.parse_width(tag(tags, "width"))
        half = width / 2 if width else half
        if kind in surface.ROAD_HALF_WIDTH and (tag(tags, "sidewalk") or "no") not in (
            "no", "none", "separate",
        ):  # fmt: skip
            half += SIDEWALK_BAND
        out.append(shapely.buffer(g, half + ways.MARGIN_M))
    areas, afields = read_osm(
        tile, "multipolygons", PAVED_AREAS, ["amenity", "building", "other_tags"]
    )
    for g, tags in zip(areas, column(afields, "other_tags", areas), strict=True):
        if g is not None and "traffic_island" not in (
            tag(tags, "area:highway"),
            tag(tags, "highway"),
        ):
            out.append(g)
    return out


def woods(green: np.ndarray, crowns: np.ndarray, wide: int) -> np.ndarray:
    """The crowned land `wide` texels from its edge at least (opened), in
    patches of which WOOD_GREEN or more is `green`."""
    wood = ndi.binary_opening(crowns, iterations=wide)
    labels, count = ndi.label(wood)
    if count == 0:
        return wood
    share = np.bincount(labels.ravel(), weights=green.ravel(), minlength=count + 1)
    share /= np.maximum(np.bincount(labels.ravel(), minlength=count + 1), 1)
    keep = share >= WOOD_GREEN
    keep[0] = False
    return keep[labels]


def verge_green(
    tile: Tile, cls: np.ndarray, green: np.ndarray | None, low: np.ndarray | None
) -> np.ndarray:
    """The road texels (class 7) beyond everything paved that are green
    low ground or a wood (`woods`): the verges, embankments, islands and
    wooded strips, in patches of VERGE_MIN_M2 or more. None found without the NDVI (`green`,
    from `green_ground`), the surface model (`low`, from `low_ground`), the
    DLM's road axes where the provider has a DLM, or the OSM extract: what
    is paved would not be known."""
    n = cls.shape[0]
    road = cls == ROAD
    none = np.zeros(cls.shape, dtype=bool)
    if green is None or low is None or not road.any():
        return none
    if tile.products.dlm and not (tile.dlm / "ver01_l.shp").exists():
        print(f"{tile.id}: no DLM road axes — no verges")
        return none
    if not has_extract(tile, "the verges (no road land painted green)"):
        return none
    paved = np.zeros(cls.shape, dtype=np.uint8)
    shapes = [g for g in (*ways.traffic(tile), *paved_ways(tile)) if not g.is_empty]
    if shapes:
        rasterize(((g, 1) for g in shapes), out=paved, transform=tile.transform(n))
    land = road & (paved == 0)
    res = (tile.bounds[2] - tile.bounds[0]) / n
    wide = max(1, round(WIDE_M / res))
    seed = ndi.binary_opening(green & low & land) | woods(green, ~low & land, wide)
    reach = max(1, round(CLOSE_M / res))
    verge = ndi.binary_closing(seed, iterations=reach) & land
    # A hole under a crown is the island's tree; one that is low and not
    # green (an unmapped car park in the green, say) stays road.
    verge |= ndi.binary_fill_holes(verge) & land & ~low
    labels, count = ndi.label(verge)
    if count == 0:
        return verge
    sizes = np.bincount(labels.ravel(), minlength=count + 1) * res * res
    big = sizes >= VERGE_MIN_M2
    big[0] = False
    return big[labels]


def contour_segments(field: np.ndarray) -> np.ndarray:
    """Marching squares on the 0 level of `field` (texel units, row 0 =
    north): the segments as an (n, 2, 2) array of (col, row) points."""
    v00, v10 = field[:-1, :-1], field[:-1, 1:]
    v01, v11 = field[1:, :-1], field[1:, 1:]
    rows, cols = np.mgrid[0 : field.shape[0] - 1, 0 : field.shape[1] - 1].astype(np.float64)

    def cross(a, b, ax, ay, bx, by):
        hit = (a > 0) != (b > 0)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = a / (a - b)
            return (
                np.where(hit, ax + t * (bx - ax), np.nan),
                np.where(hit, ay + t * (by - ay), np.nan),
            )

    # The four cell edges: north, east, south, west.
    edges = [
        cross(v00, v10, cols, rows, cols + 1, rows),
        cross(v10, v11, cols + 1, rows, cols + 1, rows + 1),
        cross(v01, v11, cols, rows + 1, cols + 1, rows + 1),
        cross(v00, v01, cols, rows, cols, rows + 1),
    ]
    xs = np.stack([e[0] for e in edges], axis=-1)
    ys = np.stack([e[1] for e in edges], axis=-1)
    hits = ~np.isnan(xs)
    count = hits.sum(axis=-1)
    out = []
    two = count == 2
    if two.any():
        idx = np.argsort(~hits[two], axis=-1, kind="stable")[:, :2]
        px = np.take_along_axis(xs[two], idx, axis=-1)
        py = np.take_along_axis(ys[two], idx, axis=-1)
        out.append(
            np.stack([np.stack([px[:, 0], py[:, 0]], -1), np.stack([px[:, 1], py[:, 1]], -1)], 1)
        )
    four = count == 4
    if four.any():  # a saddle: pair north-west and south-east
        for a, b in ((0, 3), (1, 2)):
            out.append(
                np.stack(
                    [
                        np.stack([xs[four][:, a], ys[four][:, a]], -1),
                        np.stack([xs[four][:, b], ys[four][:, b]], -1),
                    ],
                    1,
                )
            )
    return np.concatenate(out) if out else np.empty((0, 2, 2))


def out_of_town(highway: str | None, other_tags: str | None) -> bool:
    """A road out of town: a motorway or its link, a speed zone tagged rural
    or motorway (`DE:rural`, `DE:motorway`, in `maxspeed` itself too), or —
    no zone tagged — a posted limit of RURAL_KMH or more."""
    if highway in ("motorway", "motorway_link"):
        return True
    zones = " ".join(filter(None, (tag(other_tags, k) for k in SPEED_ZONE_TAGS))).lower()
    if "rural" in zones or "motorway" in zones:
        return True
    if "urban" in zones:
        return False
    speed = tag(other_tags, "maxspeed")
    return bool(speed and re.fullmatch(r"\d+", speed) and int(speed) >= RURAL_KMH)


def on_ground(highway: str | None, other_tags: str | None) -> bool:
    """A carriageway a kerb on the ground may border: not one on a bridge."""
    return highway in CARRIAGEWAYS and (tag(other_tags, "bridge") or "no") == "no"


class Roads:
    """The OSM carriageways on the ground near the tile (no bridge: a kerb is
    on the ground, and a motorway bridge over a street is not its road) and
    which of them run out of town."""

    def __init__(self, lines: list[shapely.Geometry], rural: list[bool]) -> None:
        self.tree = shapely.STRtree(lines) if lines else None
        self.rural = np.asarray(rural, dtype=bool)

    @classmethod
    def of(cls, tile: Tile) -> Roads:
        if not has_extract(tile, "the out-of-town roads (every road edge keeps its kerb)"):
            return cls([], [])
        geoms, fields = read_ways(tile, "highway IS NOT NULL", ["highway", "other_tags"])
        kinds, tags = column(fields, "highway", geoms), column(fields, "other_tags", geoms)
        roads = [
            (g, out_of_town(k, t))
            for g, k, t in zip(geoms, kinds, tags, strict=True)
            if g is not None and on_ground(k, t)
        ]
        return cls([g for g, _ in roads], [r for _, r in roads])

    def rural_at(self, points: np.ndarray) -> np.ndarray:
        """Per EPSG point: whether its nearest carriageway, within
        WAY_REACH_M, runs out of town."""
        out = np.zeros(len(points), dtype=bool)
        if self.tree is None or len(points) == 0:
            return out
        at, way = self.tree.query_nearest(
            shapely.points(points), max_distance=WAY_REACH_M, all_matches=False
        )
        out[at] = self.rural[way]
        return out


def kerb_lines(
    tile: Tile, road_m: np.ndarray, cls_small: np.ndarray, roads: Roads | None = None
) -> list[shapely.LineString]:
    """The kerb: the smoothed road edge, where the far side is ground (not
    water or railway) and the road is not out of town, as EPSG lines with
    the road on their left."""
    px = road_m.shape[0]
    segs = contour_segments(road_m)
    if len(segs) == 0:
        return []
    mid = segs.mean(axis=1)
    r = np.clip(np.round(mid[:, 1]).astype(int), 1, px - 2)
    c = np.clip(np.round(mid[:, 0]).astype(int), 1, px - 2)
    near = np.zeros(len(segs), dtype=bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= np.isin(cls_small[r + dy, c + dx], NO_KERB)
    segs = segs[~near]
    xmin, _, xmax, ymax = tile.bounds
    res = (xmax - xmin) / px
    # Texel (col, row) → EPSG: the field's samples sit at texel centres.
    epsg = np.stack([xmin + (segs[..., 0] + 0.5) * res, ymax - (segs[..., 1] + 0.5) * res], axis=-1)
    if roads is not None:
        epsg = epsg[~roads.rural_at(epsg.mean(axis=1))]
    if len(epsg) == 0:
        return []
    merged = shapely.line_merge(shapely.multilinestrings(list(epsg)))
    lines = []
    for line in shapely.get_parts(merged):
        line = shapely.simplify(line, KERB_SIMPLIFY_M)
        if line.length < KERB_MIN_M:
            continue
        lines.append(road_on_left(line, road_m, tile, res))
    return lines


def road_on_left(line: shapely.LineString, road_m: np.ndarray, tile: Tile, res: float):
    """The line, reversed if need be, so the carriageway lies on its left."""
    xy = np.asarray(line.coords)
    a, b = xy[0], xy[1]
    d = (b - a) / (np.hypot(*(b - a)) or 1.0)
    probe = (a + b) / 2 + np.array([-d[1], d[0]]) * 0.7
    xmin, _, _, ymax = tile.bounds
    col = int(np.clip((probe[0] - xmin) / res - 0.5, 0, road_m.shape[1] - 1))
    row = int(np.clip((ymax - probe[1]) / res - 0.5, 0, road_m.shape[0] - 1))
    return line if road_m[row, col] > 0 else shapely.reverse(line)


def encode(metres: np.ndarray) -> np.ndarray:
    return np.clip(np.round(128.0 + metres * EDGE_SCALE), 0, 255).astype(np.uint8)


def run(tile: Tile, px: int = 2048) -> None:
    cls = tile.classes()
    if cls is None:
        print(f"{tile.id}: no class raster — skipping the edge distances")
        return
    res = (tile.bounds[2] - tile.bounds[0]) / cls.shape[1]
    green = green_ground(tile, cls.shape[0])
    low = low_ground(tile, cls.shape[0]) if green is not None else None
    if green is not None and low is None:
        print(f"{tile.id}: no DOM1 — no verges told from the crowns over the road land")
    verge = verge_green(tile, cls, green, low)
    # A verge is meadow: off the road (its kerb moves to the carriageway's
    # side of it) and on the lawn (the shader paints it green).
    road_m = edge_field(np.where(verge, MEADOW, cls), ROAD, res, px)
    lawn = np.where(urban_green(tile, cls, green) | verge | (cls == ARABLE), MEADOW, cls)
    road = encode(road_m)
    meadow = encode(edge_field(lawn, MEADOW, res, px))
    grey = np.stack([road, meadow], axis=-1).reshape(px, 2 * px)
    save_grey_png(tile.out("dlm", f"edges_{tile.id}.png"), grey)
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "layout": "8-bit greyscale, 2 * size wide: R0 G0 R1 G1 ... per row",
            "r": "128 + scale * signed distance (m) to the road edge, positive on the road",
            "g": "128 + scale * signed distance (m) to the meadow edge, positive on the meadow",
        },
        "scale": EDGE_SCALE,
    }
    tile.out("dlm", f"edges_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    k = cls.shape[0] // px
    roads = Roads.of(tile)
    kerbs = kerb_lines(tile, road_m, cls[::k, ::k], roads)
    low = kerb_drops(tile, kerbs, roads.tree)
    write_geojson(
        tile.out("dlm", f"kerbs_{tile.id}.geojson"),
        [
            feature(geometry_json(line), {"low": d} if d else None)
            for line, d in zip(kerbs, low, strict=True)
        ],
        tile.epsg,
        tile.landcover_credit,
    )
    total = sum(line.length for line in kerbs) / 1000
    lowered = sum(b - a for d in low for a, b, _ in d)
    print(f"{tile.id}: {lowered:.0f} m of kerb lowered ({sum(map(len, low))} stretches)")
    share = 100 * verge.sum() / max(1, (cls == ROAD).sum())
    print(
        f"{tile.id}: edge distances {px}², {len(kerbs)} kerbs ({total:.1f} km), "
        f"verges {verge.sum() * res * res / 1e4:.2f} ha ({share:.1f} % of the road land)"
    )
