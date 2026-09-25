"""OSM `surface=*` → a paving raster: which material a street or a walkway is
made of (asphalt, concrete, slabs, sett, unpaved, grass pavers) and which way
the street runs, 2048² RGB over a 2 km tile (≈1 m).

The land-cover class raster already says *where* the carriageway is (the DLM,
class 7) and where the pavement is (the rest); this raster only says *what*
each is made of, so the terrain shader can pick a pattern. The two are packed
into one byte, because the same spot can need both answers — an OSM road
buffer is wider than the DLM's surveyed carriageway and reaches onto the
pavement beside it. The direction lets slabs and sett rows run along the
street rather than along the map grid:

    R = walk * 8 + road          (each 0..7, 0 = unknown)
    G = the way's direction      (0 unknown, else 1 + bearing mod 180° → 1..254)

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


def segments(line: shapely.Geometry) -> tuple[np.ndarray, np.ndarray]:
    """A line's straight pieces as LineStrings and their direction byte:
    1 + the bearing mod 180° over 0..254, so 0 is left for "unknown"."""
    parts = [np.asarray(p.coords)[:, :2] for p in shapely.get_parts(line) if not p.is_empty]
    if not parts:
        return np.array([], dtype=object), np.array([], dtype=np.uint8)
    a = np.concatenate([p[:-1] for p in parts])
    b = np.concatenate([p[1:] for p in parts])
    keep = np.hypot(*(b - a).T) > 1e-6
    a, b = a[keep], b[keep]
    angle = np.degrees(np.arctan2(b[:, 1] - a[:, 1], b[:, 0] - a[:, 0])) % 180.0
    code = (1 + np.round(angle / 180.0 * 254.0)).astype(np.uint8)
    code[code == 255] = 1  # 180° is 0°
    return shapely.linestrings(np.stack([a, b], axis=1)), code


def direction_shapes(geoms, highways, other_tags) -> list[tuple[shapely.Geometry, int]]:
    """The way direction around every street and walkway, tagged or not, so
    slabs and sett rows can run along the street: the carriageway's reach
    with its pavement first, then the walkways, then the carriageways
    themselves (a crossing footway does not turn the road's sett)."""
    bands, walks, cores = [], [], []
    for g, hw, tags in zip(geoms, highways, other_tags, strict=True):
        kind = _highway_kind(hw)
        width = parse_width(tag(tags, "width"))
        table = ROAD_HALF_WIDTH if kind in ROAD_HALF_WIDTH else WALK_HALF_WIDTH
        if kind not in table:
            continue
        half = width / 2 if width else table[kind]
        pieces, codes = segments(g)
        if len(pieces) == 0:
            continue
        if table is ROAD_HALF_WIDTH:
            bands.append((shapely.buffer(pieces, half + SIDEWALK_BAND, cap_style="flat"), codes))
            cores.append((shapely.buffer(pieces, half, cap_style="flat"), codes))
        else:
            walks.append((shapely.buffer(pieces, half, cap_style="flat"), codes))
    return [
        (shape, int(code))
        for group in (bands, walks, cores)
        for shapes, codes in group
        for shape, code in zip(shapes, codes, strict=True)
    ]


def classify_areas(
    geoms, amenities, other_tags
) -> tuple[list[tuple[shapely.Geometry, int]], list[tuple[shapely.Geometry, int]]]:
    """(road areas, walk areas): `area:highway` outlines, pedestrian squares
    and parking lots that carry a surface."""
    roads, walks = [], []
    for g, amenity, tags in zip(geoms, amenities, other_tags, strict=True):
        sid = surface_id(tag(tags, "surface"))
        if not sid:
            continue
        area = tag(tags, "area:highway")
        highway = tag(tags, "highway")
        if area in WALK_AREAS or highway == "pedestrian" or amenity == "parking":
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


def pack(road: np.ndarray, walk: np.ndarray) -> np.ndarray:
    return (walk.astype(np.uint8) << 3) | road.astype(np.uint8)


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the paving raster"):
        return
    lines, lfields = read_osm(tile, "lines", "highway IS NOT NULL", ["highway", "other_tags"])
    areas, afields = read_osm(
        tile,
        "multipolygons",
        "amenity = 'parking' OR other_tags LIKE '%\"highway\"=>%' "
        "OR other_tags LIKE '%\"area:highway\"=>%'",
        ["amenity", "other_tags"],
    )
    road_lines, walk_lines = classify_lines(
        lines, column(lfields, "highway", lines), column(lfields, "other_tags", lines)
    )
    road_areas, walk_areas = classify_areas(
        areas, column(afields, "amenity", areas), column(afields, "other_tags", areas)
    )
    road = burn(road_lines + road_areas, tile, px)
    walk = burn(walk_areas + walk_lines, tile, px)
    heading = burn(
        direction_shapes(
            lines, column(lfields, "highway", lines), column(lfields, "other_tags", lines)
        ),
        tile,
        px,
    )
    # RGB, not grey+alpha: nothing that carries data rides in an alpha channel.
    rgb = np.stack([pack(road, walk), heading, np.zeros_like(heading)], axis=-1)
    Image.fromarray(rgb, mode="RGB").save(tile.out("dlm", f"surface_{tile.id}.png"), optimize=True)
    legend = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "r": "walk * 8 + road (surface ids)",
            "g": "way direction: 0 unknown, else 1 + bearing mod 180 deg over 0..254",
        },
        "surfaces": {str(k): v for k, v in SURFACES.items()},
        "attribution": OSM_ATTRIBUTION,
    }
    tile.out("dlm", f"surface_{tile.id}.json").write_text(json.dumps(legend, indent=2) + "\n")
    print(
        f"{tile.id}: paving {px}², road {np.count_nonzero(road)} / "
        f"walk {np.count_nonzero(walk)} texels"
    )
