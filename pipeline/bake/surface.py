"""OSM `surface=*` and `parking` → a paving raster: which material a street
or a walkway is made of (asphalt, concrete, slabs, sett, unpaved, grass
pavers), where cars park, and the street's own frame (its direction and the
distance along it) — four bytes per texel, 2048² over a 2 km tile (≈1 m).

The land-cover class raster already says *where* the carriageway is (the DLM,
class 7) and where the pavement is (the rest); this raster only says *what*
each is made of, so the terrain shader can pick a pattern. The two are packed
into one byte, because the same spot can need both answers — an OSM road
buffer is wider than the DLM's surveyed carriageway and reaches onto the
pavement beside it. The direction lets slabs, sett rows and parking bays run
along the street rather than along the map grid:

    R  = park * 64 + walk * 8 + road   (road, walk 0..7, 0 = unknown;
                                        park 0..3, `PARKING`)
    G  = the way's bearing             (0 unknown, else 1 + bearing over
                                        0..360° → 1..254)
    BA = the along-street offset       (13 bits over `ALONG_PERIOD`), and
                                        in A's top bits the street parking's
                                        place (5–6, `PLACES`) and whether
                                        its bays are painted (7)

On arable land (`field_frames`) G holds the field's long axis, which the
shader's furrows follow; every street's frame burns over it.

The along-street coordinate is the distance along the OSM way: the shader
adds the texel's position projected on the bearing to the offset, so bays
and stone rows follow a street through its bends (rotating a pattern by the
bearing alone, about a far origin, made every bend a shower of arcs). The
offset is one constant per straight piece, so it costs next to nothing in
the PNG.

`park` marks the parking lane beside a carriageway from the roads'
`parking:{left,right,both}` (+ `:orientation`) tags, or the older
`parking:lane:*` — parallel (1) or perpendicular/diagonal (2) bays, which
the shader lays out from the kerb: on the carriageway, straddling the kerb
by a metre (`half_on_kerb`) or on the pavement (`on_kerb`) — and the car
parks (3): `amenity=parking` lots on the surface and `amenity=parking_space`
bays, with the `service=parking_aisle` driveways through them cleared, so
the bay lines stop at the aisle. A street's bays are painted only where OSM
says they are marked (`parking:<side>:markings`, the old `marked` or
`painted_area_only`; a street-side car park's `markings`): elsewhere the
shader tints the parking lane faintly and draws no line. A lot is painted
unless `markings=no` or its surface is gravel or grass.

`walk` on the paths (class 6) that OSM gives no surface: the Basis-DLM's
`BEF`, else asphalt inside the settlement and unpaved outside it
(`path_defaults`). A street's tagged `sidewalk:*:surface` reaches from the
kerb to the nearest OSM building within 8 m (`band_depths`), else 3 m.

The PNG is 8-bit greyscale, four times as wide as the raster, the four
bytes of a texel side by side (R0 G0 B0 A0 R1 …). The viewer inflates it itself
(lib/city/png-raster.ts): a browser's image decoder colour-manages what it
decodes, which rewrites data bytes. Interleaved, the bytes are exactly an
RGBA8 texture.

`road` comes from the carriageways (highway=primary…service), `walk` from the
footways, paths, pedestrian areas, parking lots and the roads'
`sidewalk:*:surface` tags (a band beside the carriageway). The viewer reads
`road` on class-7 texels and `walk` everywhere else
(app/_components/terrain-layer.ts). Ids are `SURFACES`; keep them in step
with `SURFACE_KINDS` in lib/city/landcover.ts.
"""

from __future__ import annotations

import json
import re

import numpy as np
import shapely
from rasterio.features import rasterize

from .common import OSM_ATTRIBUTION, Tile, column, dlm_complete, read_layer, save_grey_png
from .osm import has_extract, read_osm, read_ways, tag

# id → key; 0 = unknown (the shader keeps the class default).
SURFACES = {
    0: "unknown",
    1: "asphalt",
    2: "concrete",
    3: "paving",
    4: "sett",
    5: "unpaved",
    6: "grass",
}

# OSM surface value → id. Values not listed stay unknown.
SURFACE_OF = {
    "asphalt": 1,
    "chipseal": 1,
    "paved": 1,
    "concrete": 2,
    "concrete:plates": 2,
    "concrete:lanes": 2,
    "paving_stones": 3,
    "paving_stones:lanes": 3,
    "granite:plates": 3,
    "tiles": 3,
    "bricks": 3,
    "sett": 4,
    "cobblestone": 4,
    "unhewn_cobblestone": 4,
    "cobblestone:flattened": 4,
    "pebblestone": 4,
    "compacted": 5,
    "fine_gravel": 5,
    "gravel": 5,
    "dirt": 5,
    "ground": 5,
    "earth": 5,
    "sand": 5,
    "unpaved": 5,
    "grass_paver": 6,
    "grass": 6,
}

# Carriageways, least important first (a later burn wins at a junction), with
# the half-width (m) used when the way has no `width` tag. Generous on purpose:
# the raster is only read where the DLM says carriageway, so an OSM buffer
# must cover the surveyed road, and spilling onto the pavement is harmless.
ROAD_HALF_WIDTH = {
    "track": 2.0,
    "service": 2.5,
    "busway": 3.5,
    "living_street": 3.5,
    "residential": 4.0,
    "unclassified": 4.0,
    "pedestrian": 4.0,
    "tertiary": 5.0,
    "secondary": 5.5,
    "primary": 6.0,
    "trunk": 7.0,
    "motorway": 8.0,
}
ROAD_RANK = {kind: i for i, kind in enumerate(ROAD_HALF_WIDTH)}

# Walkways and their half-width without a `width` tag.
WALK_HALF_WIDTH = {
    "footway": 1.25,
    "path": 1.0,
    "cycleway": 1.0,
    "bridleway": 1.0,
    "steps": 1.5,
    "pedestrian": 4.0,
}
# `park` values; keep in step with `PARKING_KINDS` in lib/city/landcover.ts.
PARKING = {0: "none", 1: "street-parallel", 2: "street-perpendicular", 3: "lot"}
PARKED = {"lane", "yes", "street_side", "half_on_kerb", "on_kerb", "shoulder"}
ANGLED = {"perpendicular", "diagonal"}
# Where a street's bays lie across its kerb (`PLACES`, the A byte's bits 5–6;
# keep in step with `PARKING_PLACES` in lib/city/landcover.ts): on the
# carriageway, straddling the kerb by a metre, or on the pavement.
PLACES = {0: "carriageway", 1: "half-on-kerb", 2: "on-kerb"}
PLACE_OF = {"half_on_kerb": 1, "on_kerb": 2}
PLACE_REACH = {0: 0.0, 1: 1.0, 2: 5.0}  # m past the kerb the bays may reach
# The old `parking:lane:<side>` scheme: its orientations, and `marked` (bays
# of mixed orientation, painted).
OLD_PARKED = {"parallel", "diagonal", "perpendicular", "marked"}
# A street-side car park mapped as an area: its bays are the street's, so
# they are painted only where OSM says so, like the parking lanes.
STREET_LOTS = PARKED - {"yes"}
UNPAVED_LOT = {5, 6}  # surface ids: no paint on gravel or grass pavers
MARKED_BIT = 16  # the burned code's "bays painted" bit (`parking_code`)
CLEARED = 0x80  # burned for an aisle, read back as "no bays"
NOT_ON_THE_GROUND = {
    "underground",
    "multi-storey",
    "rooftop",
    "garages",
    "garage_boxes",
    "carports",
}
AISLE_HALF_WIDTH = 3.0  # a parking aisle's driveway, cleared of bay lines
AISLE_REACH = 5.5  # how far the bays beside an aisle take its direction

SIDEWALK_HALF_WIDTH = 1.5  # a `footway=sidewalk` centreline
SIDEWALK_BAND = 3.0  # how far a `sidewalk:*:surface` band reaches past the kerb

WALK_AREAS = {"footway", "pedestrian", "traffic_island", "path", "cycleway"}


def surface_id(value: str | None) -> int:
    """The id of an OSM surface value (`;`-lists take the first), else 0."""
    if not value:
        return 0
    return SURFACE_OF.get(value.split(";")[0].strip().lower(), 0)


def parse_width(value: str | None) -> float | None:
    """A `width` tag in metres (`5`, `5.5 m`, `5,5`), else None."""
    if not value:
        return None
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*(m|meter|metres?)?\s*$", value)
    if not m:
        return None
    width = float(m.group(1).replace(",", "."))
    return width if 0 < width < 60 else None


def _highway_kind(highway: str | None) -> str | None:
    """`primary_link` counts as `primary`."""
    if not highway:
        return None
    return highway.removesuffix("_link")


# How far a tagged sidewalk reaches from the kerb: to the nearest building
# on its side within SIDEWALK_MAX (Berlin's are 5–8 m, Meißen's 1.5),
# else SIDEWALK_BAND; probed every BAND_STEP_M along the street.
SIDEWALK_MAX = 8.0
SIDEWALK_MIN = 1.0
BAND_STEP_M = 4.0


def band_depths(
    line: shapely.Geometry, half: float, sign: float, buildings: shapely.STRtree | None
) -> list[shapely.Geometry]:
    """The pavement beside one side of a line as quads, BAND_STEP_M long:
    each from the kerb (`half`) to the nearest building its normal meets
    within SIDEWALK_MAX, else SIDEWALK_BAND (left of the line's direction
    for a positive `sign`)."""
    quads = []
    for part in shapely.get_parts(shapely.segmentize(line, BAND_STEP_M)):
        xy = np.asarray(part.coords)[:, :2]
        if len(xy) < 2:
            continue
        a, b = xy[:-1], xy[1:]
        d = b - a
        length = np.hypot(*d.T)
        keep = length > 1e-6
        a, b, d = a[keep], b[keep], d[keep] / length[keep, None]
        n = sign * np.column_stack([-d[:, 1], d[:, 0]])
        mid = (a + b) / 2
        depth = np.full(len(a), SIDEWALK_BAND)
        if buildings is not None and len(a):
            start = mid + n * half
            probes = shapely.linestrings(np.stack([start, start + n * SIDEWALK_MAX], axis=1))
            hit_probe, hit_building = buildings.query(probes, predicate="intersects")
            if len(hit_probe):
                cut = shapely.intersection(probes[hit_probe], buildings.geometries[hit_building])
                dist = shapely.distance(shapely.points(start[hit_probe]), cut)
                near = np.full(len(a), np.inf)
                np.minimum.at(near, hit_probe, dist)
                depth = np.where(np.isfinite(near), np.maximum(near, SIDEWALK_MIN), depth)
        inner_a, inner_b = a + n * half, b + n * half
        outer_a, outer_b = inner_a + n * depth[:, None], inner_b + n * depth[:, None]
        rings = np.stack([inner_a, inner_b, outer_b, outer_a, inner_a], axis=1)
        quads.extend(shapely.polygons(rings))
    return quads


def sidewalk_bands(
    line: shapely.Geometry,
    half: float,
    other_tags: str | None,
    buildings: shapely.STRtree | None = None,
) -> list[tuple[shapely.Geometry, int]]:
    """The pavement beside a carriageway, from its `sidewalk:*:surface` tags:
    on the tagged side (OSM left/right follow the way's direction; shapely's
    single-sided buffer is left for a positive distance), from the kerb
    (`half`) to the nearest building (`band_depths`, given the buildings),
    else to `half + SIDEWALK_BAND`."""
    both = surface_id(
        tag(other_tags, "sidewalk:both:surface") or tag(other_tags, "sidewalk:surface")
    )
    sides = {
        1.0: surface_id(tag(other_tags, "sidewalk:left:surface")) or both,
        -1.0: surface_id(tag(other_tags, "sidewalk:right:surface")) or both,
    }
    out = []
    for sign, sid in sides.items():
        if not sid:
            continue
        if buildings is not None:
            out += [(q, sid) for q in band_depths(line, half, sign, buildings)]
            continue
        outer = shapely.buffer(line, sign * (half + SIDEWALK_BAND), single_sided=True)
        inner = shapely.buffer(line, sign * half, single_sided=True)
        band = shapely.difference(outer, inner)
        if not band.is_empty:
            out.append((band, sid))
    return out


def classify_lines(
    geoms, highways, other_tags, buildings: shapely.STRtree | None = None
) -> tuple[list[tuple[shapely.Geometry, int]], list[tuple[shapely.Geometry, int]]]:
    """(road shapes, walk shapes), each as (geometry, surface id) in burn
    order; a tagged sidewalk reaches to the `buildings` (`sidewalk_bands`)."""
    roads: list[tuple[int, shapely.Geometry, int]] = []
    bands: list[tuple[shapely.Geometry, int]] = []
    walks: list[tuple[shapely.Geometry, int]] = []
    for g, hw, tags in zip(geoms, highways, other_tags, strict=True):
        kind = _highway_kind(hw)
        width = parse_width(tag(tags, "width"))
        sid = surface_id(tag(tags, "surface"))
        if kind in ROAD_HALF_WIDTH:
            half = width / 2 if width else ROAD_HALF_WIDTH[kind]
            if sid:
                roads.append((ROAD_RANK[kind], shapely.buffer(g, half), sid))
            bands.extend(sidewalk_bands(g, half, tags, buildings))
        if kind in WALK_HALF_WIDTH:
            sidewalk = kind == "footway" and tag(tags, "footway") == "sidewalk"
            default = SIDEWALK_HALF_WIDTH if sidewalk else WALK_HALF_WIDTH[kind]
            half = width / 2 if width else default
            wid = sid or surface_id(tag(tags, "footway:surface"))
            if wid:
                walks.append((shapely.buffer(g, half), wid))
    roads.sort(key=lambda r: r[0])
    return [(g, s) for _, g, s in roads], bands + walks


# The along-street coordinate is stored modulo this period (m; the viewer's
# `SURFACE_ALONG_PERIOD` in lib/city/landcover.ts): a common
# multiple of every pattern length along a street (the shader's bays 2.5 and
# 5.5 m, slabs 0.5 m, sett 0.15 m, concrete plates 5.5 m, grass pavers
# 0.55 m), so the wrap never shows. 13 bits over it is 2 cm — the offset is
# one constant per straight piece, so that is how far a pattern may step at
# a bend; the A byte's top three bits carry the parking place and paint.
ALONG_PERIOD = 165.0
ALONG_BITS = 13


def heading_code(radians: np.ndarray) -> np.ndarray:
    """A bearing (from east, counter-clockwise) as a byte: 1 + the bearing
    over 0..360° in 0..254, so 0 is left for "unknown" (and 360° is 0°)."""
    code = 1 + np.round((np.degrees(radians) % 360.0) / 360.0 * 254.0).astype(np.int64)
    return np.where(code == 255, 1, code).astype(np.uint8)


def segments(line: shapely.Geometry) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """A line's straight pieces as LineStrings, each with its bearing
    (radians), its start point and the distance along the line to it."""
    pieces, bearings, starts, along = [], [], [], []
    for part in shapely.get_parts(line):
        xy = np.asarray(part.coords)[:, :2] if not part.is_empty else np.empty((0, 2))
        if len(xy) < 2:
            continue
        a, b = xy[:-1], xy[1:]
        length = np.hypot(*(b - a).T)
        s0 = np.concatenate([[0.0], np.cumsum(length)[:-1]])
        keep = length > 1e-6
        pieces.append(shapely.linestrings(np.stack([a[keep], b[keep]], axis=1)))
        d = (b - a)[keep]
        bearings.append(np.arctan2(d[:, 1], d[:, 0]))
        starts.append(a[keep])
        along.append(s0[keep])
    if not pieces:
        return (np.array([], dtype=object), np.array([]), np.empty((0, 2)), np.array([]))
    return (
        np.concatenate(pieces),
        np.concatenate(bearings),
        np.concatenate(starts),
        np.concatenate(along),
    )


class Frames:
    """Street frames in burn order: for each shape, the bearing, an anchor
    point and the along-street distance at it. A texel takes the last shape
    burned over it."""

    def __init__(self) -> None:
        self.shapes: list[shapely.Geometry] = []
        self.bearing: list[float] = []
        self.anchor: list[tuple[float, float]] = []
        self.along: list[float] = []

    def add(self, shapes, bearings, anchors, along) -> None:
        self.shapes.extend(shapes)
        self.bearing.extend(float(v) for v in bearings)
        self.anchor.extend((float(x), float(y)) for x, y in anchors)
        self.along.extend(float(v) for v in along)

    def extend(self, other: Frames) -> None:
        self.add(other.shapes, other.bearing, other.anchor, other.along)

    def rasterise(self, tile: Tile, px: int) -> tuple[np.ndarray, np.ndarray]:
        """(heading byte, along-street offset), both px²; 0 where no frame
        reaches. The offset is one constant per frame: with p the texel's
        position from the tile's north-west corner and d the bearing as the
        byte decodes it, the along-street coordinate is `offset + p·d` —
        exact along a straight piece, and continuous into the next piece
        of the same way. Stored as `ALONG_BITS` bits over `ALONG_PERIOD`."""
        ids = np.zeros((px, px), dtype=np.int32)
        shapes = [(g, i + 1) for i, g in enumerate(self.shapes) if g is not None and not g.is_empty]
        if shapes:
            rasterize(shapes, out=ids, transform=tile.transform(px), dtype=np.int32)
        if not self.shapes:
            return np.zeros((px, px), np.uint8), np.zeros((px, px), np.uint16)
        code = heading_code(np.asarray(self.bearing))
        # The bearing the shader will use: the byte, decoded.
        b = (code.astype(np.float64) - 1.0) / 254.0 * 2.0 * np.pi
        anchor = np.asarray(self.anchor)
        xmin, _, _, ymax = tile.bounds
        offset = np.asarray(self.along) - (
            (anchor[:, 0] - xmin) * np.cos(b) + (anchor[:, 1] - ymax) * np.sin(b)
        )
        scale = float(1 << ALONG_BITS)
        steps = (np.mod(offset, ALONG_PERIOD) / ALONG_PERIOD * scale).astype(np.int64) & (
            (1 << ALONG_BITS) - 1
        )
        heading = np.concatenate([[0], code]).astype(np.uint8)[ids]
        along = np.concatenate([[0], steps]).astype(np.uint16)[ids]
        return heading, along


def direction_frames(geoms, highways, other_tags) -> Frames:
    """The street frame around every street and walkway, tagged or not, so
    slabs, sett rows and bays run along the street: the carriageway's reach
    with its pavement first, then the walkways, then the carriageways
    themselves (a crossing footway does not turn the road's sett)."""
    bands, walks, cores = Frames(), Frames(), Frames()
    for g, hw, tags in zip(geoms, highways, other_tags, strict=True):
        kind = _highway_kind(hw)
        width = parse_width(tag(tags, "width"))
        table = ROAD_HALF_WIDTH if kind in ROAD_HALF_WIDTH else WALK_HALF_WIDTH
        if kind not in table:
            continue
        half = width / 2 if width else table[kind]
        pieces, bearings, starts, along = segments(g)
        if len(pieces) == 0:
            continue
        if table is ROAD_HALF_WIDTH:
            reach = half + (AISLE_REACH if is_aisle(hw, tags) else SIDEWALK_MAX)
            bands.add(shapely.buffer(pieces, reach, cap_style="flat"), bearings, starts, along)
            cores.add(shapely.buffer(pieces, half, cap_style="flat"), bearings, starts, along)
        else:
            walks.add(shapely.buffer(pieces, half, cap_style="flat"), bearings, starts, along)
    bands.extend(walks)
    bands.extend(cores)
    return bands


def is_car_park(amenity: str | None, other_tags: str | None) -> bool:
    """A car park on the ground: a lot or a mapped bay, not a garage,
    a deck or an underground park."""
    return amenity in ("parking", "parking_space") and (
        tag(other_tags, "parking") not in NOT_ON_THE_GROUND
    )


def parking_code(kind: int, place: int = 0, marked: bool = False) -> int:
    """The burned parking value: the kind (`PARKING`) in bits 0–1, the place
    (`PLACES`) in bits 2–3, `MARKED_BIT` where the bays are painted."""
    return kind | place << 2 | (MARKED_BIT if marked else 0)


def _side_tag(other_tags: str | None, side: str, key: str) -> str | None:
    """`parking:<side><key>`, else `parking:both<key>`."""
    return tag(other_tags, f"parking:{side}{key}") or tag(other_tags, f"parking:both{key}")


def parking_side(other_tags: str | None, side: str) -> int:
    """The parking code (`parking_code`) of one side of a street, 0 where
    none. The kind from `parking:<side>` (+ `:orientation`), else the old
    `parking:lane:<side>` scheme; the place from its position
    (`half_on_kerb`, `on_kerb`; a lay-by or `street_side` lies at the
    carriageway's level, on the road side of the DLM kerb); the bays are
    painted only where OSM says so — `parking:<side>:markings` other than
    `no`, the old scheme's `marked` or `painted_area_only`. The orthophotos
    show almost no painted bays where OSM is silent (Dresden, Leipzig,
    Hamburg)."""
    how = _side_tag(other_tags, side, "")
    if how in PARKED:
        angled = _side_tag(other_tags, side, ":orientation") in ANGLED
        markings = _side_tag(other_tags, side, ":markings") or tag(other_tags, "parking:markings")
        return parking_code(2 if angled else 1, PLACE_OF.get(how, 0), markings not in (None, "no"))
    old = tag(other_tags, f"parking:lane:{side}") or tag(other_tags, "parking:lane:both")
    if old in OLD_PARKED:
        where = tag(other_tags, f"parking:lane:{side}:{old}") or tag(
            other_tags, f"parking:lane:both:{old}"
        )
        kind = 2 if old in ANGLED else 1
        return parking_code(
            kind, PLACE_OF.get(where, 0), old == "marked" or where == "painted_area_only"
        )
    return 0


def street_parking(
    line: shapely.Geometry, half: float, other_tags: str | None
) -> list[tuple[shapely.Geometry, int]]:
    """Each side of a street cars park on (`parking_side`), as the
    carriageway's half on that side, reaching a little past the road's
    nominal edge and, for bays on or half on the kerb, onto the pavement
    (`PLACE_REACH`); the shader lays the bays out from the DLM kerb."""
    out = []
    for side, sign in (("left", 1.0), ("right", -1.0)):
        code = parking_side(other_tags, side)
        if code:
            reach = half + 1.5 + PLACE_REACH[(code >> 2) & 3]
            out.append((shapely.buffer(line, sign * reach, single_sided=True), code))
    return out


def lot_code(amenity: str | None, other_tags: str | None) -> int:
    """A car park's parking code: a lot (3), painted unless `markings=no` or
    unpaved; a street-side car park mapped as an area (`parking` lane,
    street_side, on or half on the kerb) painted only with `markings`."""
    markings = tag(other_tags, "markings") or tag(other_tags, "parking:markings")
    if tag(other_tags, "parking") in STREET_LOTS:
        return parking_code(3, 0, markings not in (None, "no"))
    unpaved = surface_id(tag(other_tags, "surface")) in UNPAVED_LOT
    return parking_code(3, 0, markings != "no" and not unpaved)


def is_aisle(highway: str | None, other_tags: str | None) -> bool:
    return highway == "service" and tag(other_tags, "service") == "parking_aisle"


def parking_shapes(
    lines, highways, line_tags, areas, amenities, area_tags
) -> list[tuple[shapely.Geometry, int]]:
    """The `park` layer in burn order (`parking_code`s): the car parks, the
    street parking lanes, then the aisles cleared (`CLEARED`)."""
    lots = [
        (g, lot_code(amenity, tags))
        for g, amenity, tags in zip(areas, amenities, area_tags, strict=True)
        if is_car_park(amenity, tags)
    ]
    lanes, aisles = [], []
    for g, hw, tags in zip(lines, highways, line_tags, strict=True):
        kind = _highway_kind(hw)
        if is_aisle(hw, tags):
            half = (parse_width(tag(tags, "width")) or 2 * AISLE_HALF_WIDTH) / 2
            aisles.append((shapely.buffer(g, half, cap_style="flat"), CLEARED))
        elif kind in ROAD_HALF_WIDTH:
            width = parse_width(tag(tags, "width"))
            lanes.extend(street_parking(g, width / 2 if width else ROAD_HALF_WIDTH[kind], tags))
    return lots + lanes + aisles


def add_long_axis(frames: Frames, g: shapely.Geometry) -> None:
    """An area's frame: its long axis (of its minimum rotated rectangle) as
    the direction, anchored at its centroid."""
    box = shapely.minimum_rotated_rectangle(g)
    if not isinstance(box, shapely.Polygon) or box.is_empty:
        return
    ring = np.asarray(box.exterior.coords)[:4]
    edges = np.diff(np.vstack([ring, ring[:1]]), axis=0)
    dx, dy = edges[np.argmax(np.hypot(*edges.T))]
    c = shapely.centroid(g)
    frames.add([g], [np.arctan2(dy, dx)], [(shapely.get_x(c), shapely.get_y(c))], [0.0])


def lot_frames(areas, amenities, area_tags) -> Frames:
    """A car park's long axis as its direction, for the lots no aisle
    crosses (burned first, so a mapped aisle wins)."""
    frames = Frames()
    for g, amenity, tags in zip(areas, amenities, area_tags, strict=True):
        if is_car_park(amenity, tags) and g is not None and not g.is_empty:
            add_long_axis(frames, g)
    return frames


def field_frames(tile: Tile) -> Frames:
    """Each arable field's long axis, the way it is ploughed and drilled
    nearly everywhere, for the furrows the terrain shader draws along it:
    the Basis-DLM's arable land (landcover.py `arable_areas`), else OSM's
    `landuse=farmland`. Burned first: a street's frame wins."""
    from . import landcover  # here: landcover reads its road widths from this module

    if tile.products.dlm and dlm_complete(tile.dlm):
        geoms = landcover.arable_areas(tile)
    else:
        geoms = list(read_osm(tile, "multipolygons", "landuse = 'farmland'", ["landuse"])[0])
    frames = Frames()
    for g in geoms:
        for part in shapely.get_parts(g) if g is not None else []:
            if part.area > 1.0:
                add_long_axis(frames, part)
    return frames


def classify_areas(
    geoms, amenities, other_tags
) -> tuple[list[tuple[shapely.Geometry, int]], list[tuple[shapely.Geometry, int]]]:
    """(road areas, walk areas): `area:highway` outlines, pedestrian squares
    and car parks that carry a surface (a car park without one is asphalt,
    as nearly all of them are)."""
    roads, walks = [], []
    for g, amenity, tags in zip(geoms, amenities, other_tags, strict=True):
        sid = surface_id(tag(tags, "surface"))
        if not sid and is_car_park(amenity, tags):
            sid = SURFACE_OF["asphalt"]
        if not sid:
            continue
        area = tag(tags, "area:highway")
        highway = tag(tags, "highway")
        if area in WALK_AREAS or highway == "pedestrian" or is_car_park(amenity, tags):
            walks.append((g, sid))
        elif _highway_kind(area) in ROAD_HALF_WIDTH:
            roads.append((g, sid))
    return roads, walks


# A path's material where OSM does not say (QA B20). The Basis-DLM's
# `befestigung` (`BEF`, 1000 paved, 2000 unpaved: in Bavaria 6144 of 6275
# paths, 98 % paved), else the settlement decides: a path between houses is
# sealed, one through parks, cemeteries, fields and woods is not. The
# settlement is the DLM's built land (or OSM's built landuse), not its
# parks, sports grounds, allotments or cemeteries. Read where the class
# raster says path (class 6: the DLM's `ver02_l`, or OSM's paths).
PATH_CLASS = 6
BUILT_LAND = (
    "AX_Wohnbauflaeche",
    "AX_IndustrieUndGewerbeflaeche",
    "AX_FlaecheGemischterNutzung",
    "AX_FlaecheBesondererFunktionalerPraegung",
)
OSM_BUILT_LAND = (
    "residential",
    "commercial",
    "industrial",
    "retail",
    "construction",
    "garages",
    "religious",
    "education",
)
DLM_BEF = {"1000": SURFACE_OF["asphalt"], "2000": SURFACE_OF["unpaved"]}
PATH_HALF_M = 1.0  # landcover.py burns a DLM path 1 m to each side


def settlement(tile: Tile) -> list[shapely.Geometry]:
    """The built land: the DLM's (`BUILT_LAND`), else OSM's built landuse."""
    if tile.products.dlm and dlm_complete(tile.dlm):
        where = f"OBJART_TXT IN ({', '.join(repr(k) for k in BUILT_LAND)})"
        geoms, _ = read_layer(tile.dlm / "sie02_f.shp", tile.bounds, where=where)
    else:
        where = f"landuse IN ({', '.join(repr(k) for k in OSM_BUILT_LAND)})"
        geoms, _ = read_osm(tile, "multipolygons", where, ["landuse"])
    return [g for g in geoms if g is not None]


def dlm_path_surfaces(tile: Tile) -> list[tuple[shapely.Geometry, int]]:
    """The DLM paths whose `BEF` says paved or unpaved, as burned."""
    if not (tile.products.dlm and dlm_complete(tile.dlm)):
        return []
    geoms, fields = read_layer(tile.dlm / "ver02_l.shp", tile.bounds, columns=["BEF"])
    return [
        (shapely.buffer(g, PATH_HALF_M), DLM_BEF[str(bef)])
        for g, bef in zip(geoms, column(fields, "BEF", geoms), strict=True)
        if g is not None and str(bef) in DLM_BEF
    ]


def path_defaults(tile: Tile, px: int) -> np.ndarray | None:
    """The walk kind of every path texel (class 6 on most of the class
    raster under it): the DLM's `BEF`, else asphalt in the settlement and
    unpaved outside; 0 elsewhere. None without a class raster."""
    cls = tile.classes()
    if cls is None or cls.shape[0] % px:
        return None
    k = cls.shape[0] // px
    path = (cls == PATH_CLASS).reshape(px, k, px, k).mean(axis=(1, 3)) >= 0.5
    if not path.any():
        return np.zeros((px, px), np.uint8)
    town = burn([(g, 1) for g in settlement(tile)], tile, px) > 0
    kind = np.where(town, SURFACE_OF["asphalt"], SURFACE_OF["unpaved"]).astype(np.uint8)
    bef = burn(dlm_path_surfaces(tile), tile, px)
    kind = np.where(bef > 0, bef, kind)
    return np.where(path, kind, 0).astype(np.uint8)


def burn(shapes: list[tuple[shapely.Geometry, int]], tile: Tile, px: int) -> np.ndarray:
    """Shapes burned in order (a later one wins) into a px² raster."""
    raster = np.zeros((px, px), dtype=np.uint8)
    valid = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
    if valid:
        rasterize(valid, out=raster, transform=tile.transform(px), dtype=np.uint8)
    return raster


def pack(road: np.ndarray, walk: np.ndarray, park: np.ndarray | None = None) -> np.ndarray:
    """R: park kind * 64 + walk * 8 + road; the aisles' `CLEARED` reads as 0."""
    out = (walk.astype(np.uint8) << 3) | road.astype(np.uint8)
    if park is not None:
        out |= np.where(park == CLEARED, 0, park & 3).astype(np.uint8) << 6
    return out


def pack_along(along: np.ndarray, park: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """(B, A): the along-street offset's 13 bits (`ALONG_BITS`, low byte
    first), and in A's top bits a street's parking place (bits 5–6,
    `PLACES`) and whether its bays are painted (bit 7)."""
    steps = along.astype(np.uint16) & ((1 << ALONG_BITS) - 1)
    high = (steps >> 8).astype(np.uint8)
    if park is not None:
        kept = np.where(park == CLEARED, 0, park).astype(np.uint8)
        high |= ((kept >> 2) & 3) << 5
        high |= np.where(kept & MARKED_BIT, 0x80, 0).astype(np.uint8)
    return (steps & 0xFF).astype(np.uint8), high


def interleave(*planes: np.ndarray) -> np.ndarray:
    """px² byte planes as one px × (n·px) greyscale image, the bytes of a
    texel side by side (R0 G0 B0 A0 R1 …)."""
    return np.stack(planes, axis=-1).reshape(planes[0].shape[0], -1)


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the paving raster"):
        return
    lines, lfields = read_ways(tile, "highway IS NOT NULL", ["highway", "other_tags"])
    areas, afields = read_osm(
        tile,
        "multipolygons",
        "amenity IN ('parking', 'parking_space') OR other_tags LIKE '%\"highway\"=>%' "
        "OR other_tags LIKE '%\"area:highway\"=>%' OR building IS NOT NULL",
        ["amenity", "building", "other_tags"],
    )
    built = np.array([b is not None for b in column(afields, "building", areas)], dtype=bool)
    buildings = shapely.STRtree(areas[built]) if built.any() else None
    areas, afields = areas[~built], {k: v[~built] for k, v in afields.items()}
    road_lines, walk_lines = classify_lines(
        lines, column(lfields, "highway", lines), column(lfields, "other_tags", lines), buildings
    )
    road_areas, walk_areas = classify_areas(
        areas, column(afields, "amenity", areas), column(afields, "other_tags", areas)
    )
    highways, line_tags = column(lfields, "highway", lines), column(lfields, "other_tags", lines)
    amenities, area_tags = column(afields, "amenity", areas), column(afields, "other_tags", areas)
    road = burn(road_lines + road_areas, tile, px)
    walk = burn(walk_areas + walk_lines, tile, px)
    defaults = path_defaults(tile, px)
    if defaults is not None:
        walk = np.where(walk == 0, defaults, walk)
    park = burn(parking_shapes(lines, highways, line_tags, areas, amenities, area_tags), tile, px)
    frames = field_frames(tile)
    frames.extend(lot_frames(areas, amenities, area_tags))
    frames.extend(direction_frames(lines, highways, line_tags))
    heading, along = frames.rasterise(tile, px)
    low, high = pack_along(along, park)
    rgba = interleave(pack(road, walk, park), heading, low, high)
    save_grey_png(tile.out("dlm", f"surface_{tile.id}.png"), rgba)
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "layout": "8-bit greyscale, 4 * size wide: R0 G0 B0 A0 R1 ... per row",
            "r": "park * 64 + walk * 8 + road (surface ids, parking kinds)",
            "g": "way bearing (a field's long axis on arable land): 0 unknown, "
            "else 1 + bearing (from east, ccw) over 0..360 deg",
            "ba": f"along-street offset mod {ALONG_PERIOD} m, {ALONG_BITS} bits, low byte "
            "first: along = offset + (x - west, y - north) . (cos, sin)(bearing); "
            "A bits 5-6 the street parking's place, bit 7 its bays painted",
        },
        "surfaces": {str(k): v for k, v in SURFACES.items()},
        "parking": {str(k): v for k, v in PARKING.items()},
        "parkingPlaces": {str(k): v for k, v in PLACES.items()},
        "alongPeriod": ALONG_PERIOD,
        "attribution": OSM_ATTRIBUTION,
    }
    tile.out("dlm", f"surface_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    kept = np.where(park == CLEARED, 0, park)
    street = np.isin(kept & 3, (1, 2))
    paths = defaults if defaults is not None else np.zeros_like(walk)
    print(
        f"{tile.id}: paving {px}², road {np.count_nonzero(road)} / "
        f"walk {np.count_nonzero(walk)} / parking {np.count_nonzero(kept & 3)} "
        f"(street {np.count_nonzero(street)}, "
        f"painted {np.count_nonzero(street & ((kept & MARKED_BIT) > 0))}, "
        f"on/half on the kerb {np.count_nonzero(street & (((kept >> 2) & 3) > 0))}); "
        f"path defaults asphalt {np.count_nonzero(paths == 1)} / "
        f"unpaved {np.count_nonzero(paths == 5)}"
    )
