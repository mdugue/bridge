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
    BA = the along-street offset       (16 bits over `ALONG_PERIOD`)

The along-street coordinate is the distance along the OSM way: the shader
adds the texel's position projected on the bearing to the offset, so bays
and stone rows follow a street through its bends (rotating a pattern by the
bearing alone, about a far origin, made every bend a shower of arcs). The
offset is one constant per straight piece, so it costs next to nothing in
the PNG.

`park` marks the parking lane beside a carriageway from the roads'
`parking:{left,right,both}` (+ `:orientation`) tags — parallel (1) or
perpendicular/diagonal (2) bays, which the shader lays out from the kerb —
and the car parks (3): `amenity=parking` lots on the surface and
`amenity=parking_space` bays, with the `service=parking_aisle` driveways
through them cleared, so the bay lines stop at the aisle.

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
from PIL import Image
from rasterio.features import rasterize

from .common import OSM_ATTRIBUTION, Tile, column
from .osm import has_extract, read_osm, tag

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
CLEARED = 4  # burned for an aisle, read back as "no bays"

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


def sidewalk_bands(
    line: shapely.Geometry, half: float, other_tags: str | None
) -> list[tuple[shapely.Geometry, int]]:
    """The pavement beside a carriageway, from its `sidewalk:*:surface` tags:
    a band from the kerb (`half`) to `half + SIDEWALK_BAND`, on the tagged
    side (OSM left/right follow the way's direction; shapely's single-sided
    buffer is left for a positive distance)."""
    both = surface_id(
        tag(other_tags, "sidewalk:both:surface") or tag(other_tags, "sidewalk:surface")
    )
    sides = {
        1.0: surface_id(tag(other_tags, "sidewalk:left:surface")) or both,
        -1.0: surface_id(tag(other_tags, "sidewalk:right:surface")) or both,
    }
    out = []
    for sign, sid in sides.items():
        if sid:
            outer = shapely.buffer(line, sign * (half + SIDEWALK_BAND), single_sided=True)
            inner = shapely.buffer(line, sign * half, single_sided=True)
            band = shapely.difference(outer, inner)
            if not band.is_empty:
                out.append((band, sid))
    return out


def classify_lines(
    geoms, highways, other_tags
) -> tuple[list[tuple[shapely.Geometry, int]], list[tuple[shapely.Geometry, int]]]:
    """(road shapes, walk shapes), each as (geometry, surface id) in burn
    order."""
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
            bands.extend(sidewalk_bands(g, half, tags))
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
# 0.55 m), so the wrap never shows. 16 bits over it is 2.5 mm.
ALONG_PERIOD = 165.0


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
        of the same way. Stored as 16 bits over `ALONG_PERIOD`."""
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
        steps = (np.mod(offset, ALONG_PERIOD) / ALONG_PERIOD * 65536.0).astype(np.int64) & 0xFFFF
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
            reach = half + (AISLE_REACH if is_aisle(hw, tags) else SIDEWALK_BAND)
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


def street_parking(
    line: shapely.Geometry, half: float, other_tags: str | None
) -> list[tuple[shapely.Geometry, int]]:
    """The carriageway's half on each side cars park on (`parking:<side>`,
    else `parking:both`), marked parallel (1) or perpendicular/diagonal (2).
    The half reaches a little past the road's nominal edge; the shader lays
    the bays out from the DLM kerb."""
    out = []
    for side, sign in (("left", 1.0), ("right", -1.0)):
        how = tag(other_tags, f"parking:{side}") or tag(other_tags, "parking:both")
        if how not in PARKED:
            continue
        orientation = tag(other_tags, f"parking:{side}:orientation") or tag(
            other_tags, "parking:both:orientation"
        )
        code = 2 if orientation in ANGLED else 1
        out.append((shapely.buffer(line, sign * (half + 1.5), single_sided=True), code))
    return out


def is_aisle(highway: str | None, other_tags: str | None) -> bool:
    return highway == "service" and tag(other_tags, "service") == "parking_aisle"


def parking_shapes(
    lines, highways, line_tags, areas, amenities, area_tags
) -> list[tuple[shapely.Geometry, int]]:
    """The `park` layer in burn order: the car parks (3), the street
    parking lanes (1, 2), then the aisles cleared (`CLEARED`)."""
    lots = [
        (g, 3)
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


def lot_frames(areas, amenities, area_tags) -> Frames:
    """A car park's long axis as its direction, anchored at its centroid,
    for the lots no aisle crosses (burned first, so a mapped aisle wins)."""
    frames = Frames()
    for g, amenity, tags in zip(areas, amenities, area_tags, strict=True):
        if not is_car_park(amenity, tags) or g is None or g.is_empty:
            continue
        ring = np.asarray(shapely.minimum_rotated_rectangle(g).exterior.coords)[:4]
        edges = np.diff(np.vstack([ring, ring[:1]]), axis=0)
        dx, dy = edges[np.argmax(np.hypot(*edges.T))]
        c = shapely.centroid(g)
        frames.add([g], [np.arctan2(dy, dx)], [(shapely.get_x(c), shapely.get_y(c))], [0.0])
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


def burn(shapes: list[tuple[shapely.Geometry, int]], tile: Tile, px: int) -> np.ndarray:
    """Shapes burned in order (a later one wins) into a px² raster."""
    raster = np.zeros((px, px), dtype=np.uint8)
    valid = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
    if valid:
        rasterize(valid, out=raster, transform=tile.transform(px), dtype=np.uint8)
    return raster


def pack(road: np.ndarray, walk: np.ndarray, park: np.ndarray | None = None) -> np.ndarray:
    """R: park * 64 + walk * 8 + road; the aisles' `CLEARED` reads as 0."""
    out = (walk.astype(np.uint8) << 3) | road.astype(np.uint8)
    if park is not None:
        out |= np.where(park == CLEARED, 0, park).astype(np.uint8) << 6
    return out


def interleave(*planes: np.ndarray) -> np.ndarray:
    """px² byte planes as one px × (n·px) greyscale image, the bytes of a
    texel side by side (R0 G0 B0 A0 R1 …)."""
    return np.stack(planes, axis=-1).reshape(planes[0].shape[0], -1)


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the paving raster"):
        return
    lines, lfields = read_osm(tile, "lines", "highway IS NOT NULL", ["highway", "other_tags"])
    areas, afields = read_osm(
        tile,
        "multipolygons",
        "amenity IN ('parking', 'parking_space') OR other_tags LIKE '%\"highway\"=>%' "
        "OR other_tags LIKE '%\"area:highway\"=>%'",
        ["amenity", "other_tags"],
    )
    road_lines, walk_lines = classify_lines(
        lines, column(lfields, "highway", lines), column(lfields, "other_tags", lines)
    )
    road_areas, walk_areas = classify_areas(
        areas, column(afields, "amenity", areas), column(afields, "other_tags", areas)
    )
    highways, line_tags = column(lfields, "highway", lines), column(lfields, "other_tags", lines)
    amenities, area_tags = column(afields, "amenity", areas), column(afields, "other_tags", areas)
    road = burn(road_lines + road_areas, tile, px)
    walk = burn(walk_areas + walk_lines, tile, px)
    park = burn(parking_shapes(lines, highways, line_tags, areas, amenities, area_tags), tile, px)
    frames = lot_frames(areas, amenities, area_tags)
    frames.extend(direction_frames(lines, highways, line_tags))
    heading, along = frames.rasterise(tile, px)
    rgba = interleave(
        pack(road, walk, park),
        heading,
        (along & 0xFF).astype(np.uint8),
        (along >> 8).astype(np.uint8),
    )
    Image.fromarray(rgba, mode="L").save(tile.out("dlm", f"surface_{tile.id}.png"), optimize=True)
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "layout": "8-bit greyscale, 4 * size wide: R0 G0 B0 A0 R1 ... per row",
            "r": "park * 64 + walk * 8 + road (surface ids, parking kinds)",
            "g": "way bearing: 0 unknown, else 1 + bearing (from east, ccw) over 0..360 deg",
            "ba": f"along-street offset mod {ALONG_PERIOD} m, 16 bits, low byte first: "
            "along = offset + (x - west, y - north) . (cos, sin)(bearing)",
        },
        "surfaces": {str(k): v for k, v in SURFACES.items()},
        "parking": {str(k): v for k, v in PARKING.items()},
        "alongPeriod": ALONG_PERIOD,
        "attribution": OSM_ATTRIBUTION,
    }
    tile.out("dlm", f"surface_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    print(
        f"{tile.id}: paving {px}², road {np.count_nonzero(road)} / "
        f"walk {np.count_nonzero(walk)} / parking {np.count_nonzero(np.isin(park, (1, 2, 3)))}"
    )
