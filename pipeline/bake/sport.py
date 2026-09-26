"""OSM sports grounds → a pitch table and an index raster: football pitches,
tennis and basketball courts, running tracks, beach-volleyball sand — each
with its playing surface, the lines painted on it and its own frame, so the
terrain shader draws the field in the ground's own fragment pass
(app/_components/sport-ground.ts). Playgrounds are not sports grounds here:
the furniture bake owns them, floor and equipment (furniture.py).

The table (`sport_<tile>.json`) is one row per ground, in burn order:

    [cx, cy, angle, p1, p2, p3, surface, marking, shape]

`cx, cy` is the ground's centre in metres from the tile's north-west corner
(x east, y north, so y ≤ 0 on the tile), `angle` its long axis (radians from
east, counter-clockwise). The shape says what `p1..p3` are:

    rect     p1, p2 = half length, half width of the minimum rotated rectangle
    stadium  p1 = half the straight, p2 = outer radius, p3 = the band's width
             (a running track: a capsule band, its lanes drawn from the edge)
    free     p1, p2 as rect; the raster's exact bit is the outline

Every row's surface and marking ids index `SURFACES` and `MARKINGS`; keep
them in step with lib/city/sport.ts.

The raster (`sport_<tile>.png`, 2048² over a 2 km tile, ≈1 m) says which rows
reach a texel, four bytes per texel, interleaved in an 8-bit greyscale PNG
four times as wide (R0 G0 B0 A0 R1 …, read by lib/city/png-raster.ts):

    R = 1 + the row                    (0 = no ground; every outline grown
                                        by `REACH`, then the exact outlines
                                        over them, so inside a ground its
                                        own row wins)
    G = 1 + another row                (every outline grown by `REACH_ALT`,
                                        the first row winning an overlap:
                                        where two grounds meet, the one R
                                        does not name)
    B = 255 inside an exact outline    (the free shapes' edge)
    A = 0

The shader takes the rows of the texels around a fragment and decides inside
or out from each row's analytic shape, so a court's edge is exact, not the
raster's metre staircase. The second row is what keeps that true where the
model and the mapped outline disagree — a track's capsule reaching past its
mapped inner edge, into the texels the pitch inside it claims.
"""

from __future__ import annotations

import json
import math

import numpy as np
import shapely
from rasterio.features import rasterize

from .common import OSM_ATTRIBUTION, Tile, column, save_grey_png
from .osm import has_extract, read_osm, tag

# id → key; keep in step with `SPORT_SURFACES` in lib/city/sport.ts. 0 keeps
# the ground as it is (lines only).
SURFACES = {
    0: "ground",
    1: "grass",
    2: "turf",
    3: "tartan",
    4: "clay",
    5: "sand",
    6: "hard",
    7: "cinder",
}
SURFACE_OF = {
    "grass": 1,
    "artificial_turf": 2,
    "artificial_grass": 2,
    "tartan": 3,
    "rubber": 3,
    "clay": 4,
    "sand": 5,
    "woodchips": 5,
    "asphalt": 6,
    "concrete": 6,
    "paved": 6,
    "paving_stones": 6,
    "acrylic": 6,
    "wood": 6,
    "concrete:plates": 6,
    "compacted": 7,
    "fine_gravel": 7,
    "gravel": 7,
    "dirt": 7,
    "ground": 7,
    "earth": 7,
    "unpaved": 7,
}

# id → key; keep in step with `SPORT_MARKINGS` in lib/city/sport.ts.
MARKINGS = {
    0: "none",
    1: "football",
    2: "tennis",
    3: "basketball",
    4: "volleyball",
    5: "court",
    6: "lanes",
    7: "board",
}

# id → key; keep in step with `SPORT_SHAPES` in lib/city/sport.ts.
SHAPES = {0: "rect", 1: "stadium", 2: "free"}

# The sport (the first of a `;` list) → (lines, the surface when untagged).
SPORTS = {
    "soccer": (1, 1),
    "american_football": (1, 1),
    "rugby": (1, 1),
    "rugby_union": (1, 1),
    "field_hockey": (1, 1),
    "cricket": (1, 1),
    "fistball": (4, 1),
    "tennis": (2, 4),
    "padel": (2, 2),
    "basketball": (3, 6),
    "streetball": (3, 6),
    "volleyball": (4, 6),
    "beachvolleyball": (4, 5),
    "badminton": (4, 6),
    "handball": (5, 6),
    "futsal": (5, 6),
    "five-a-side": (5, 6),
    "multi": (5, 6),
    "netball": (5, 6),
    "running": (6, 3),
    "athletics": (0, 3),
    "long_jump": (0, 5),
    "equestrian": (0, 5),
    "table_tennis": (0, 6),
    "skateboard": (0, 6),
    "skating": (0, 6),
    "roller_skating": (0, 6),
    "boules": (0, 7),
    "chess": (7, 6),
}
FOOTBALL, COURT, LANES = 1, 5, 6
SMALL_FOOTBALL_M = 50.0  # a sealed football pitch shorter than this is a Bolzplatz

RECT_FILL = 0.85  # area / minimum rotated rectangle at or above this is a rectangle
STADIUM_MIN_RADIUS = 15.0  # m: a narrower track bending is a sprint strip, not an oval
TRACK_LANE_BAND = 7.32  # six 1.22 m lanes: an untagged track line's width
REACH = 1.5  # m every outline grows by for the lookup
REACH_ALT = 4.0  # m for the second row
NOT_OUTSIDE = {"indoor", "roof", "underground"}


def surface_id(value: str | None) -> int:
    """The id of an OSM surface value (`;`-lists take the first), else 0."""
    if not value:
        return 0
    return SURFACE_OF.get(value.split(";")[0].strip().lower(), 0)


def first_sport(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(";")[0].strip().lower() or None


def classify(leisure: str, sport: str | None, surface: str | None) -> tuple[int, int] | None:
    """(surface id, marking id) of a ground, or None when nothing would show:
    a pitch of an unknown sport only with a tagged surface."""
    tagged = surface_id(surface)
    first = first_sport(sport)
    if leisure == "track":
        return (tagged or 3, LANES)
    lines, default = SPORTS.get(first or "", (0, 0))
    ground = tagged or default
    if not ground and not lines:
        return None
    return ground, lines


def rectangle(g: shapely.Geometry) -> tuple[float, float, float, float, float]:
    """(cx, cy, angle of the long side, half length, half width) of the
    minimum rotated rectangle."""
    ring = np.asarray(shapely.minimum_rotated_rectangle(g).exterior.coords)[:4]
    edges = np.diff(np.vstack([ring, ring[:1]]), axis=0)
    lengths = np.hypot(*edges.T)
    long = int(np.argmax(lengths))
    dx, dy = edges[long]
    c = ring.mean(axis=0)
    return (
        float(c[0]),
        float(c[1]),
        math.atan2(dy, dx),
        float(lengths[long]) / 2,
        float(lengths[(long + 1) % 4]) / 2,
    )


def band_width(area: float, straight: float, radius: float) -> float:
    """The width w of a capsule band (outer radius R, straight 2a) with the
    given area: area = 4aw + π(2Rw − w²), the smaller root, at most R."""
    b = 4 * straight + 2 * math.pi * radius
    disc = b * b - 4 * math.pi * area
    w = (b - math.sqrt(max(disc, 0.0))) / (2 * math.pi)
    return min(max(w, 0.0), radius)


def frame(g: shapely.Geometry, marking: int) -> tuple[int, list[float]]:
    """(shape id, [cx, cy, angle, p1, p2, p3]) in the tile CRS."""
    cx, cy, angle, hl, hw = rectangle(g)
    fill = g.area / max(4 * hl * hw, 1e-6)
    if marking == LANES and fill < RECT_FILL and hl > 1.1 * hw and hw >= STADIUM_MIN_RADIUS:
        a, r = hl - hw, hw
        return 1, [cx, cy, angle, a, r, band_width(g.area, a, r)]
    shape = 0 if fill >= RECT_FILL else 2
    return shape, [cx, cy, angle, hl, hw, 0.0]


def track_area(g: shapely.Geometry, other_tags: str | None) -> shapely.Geometry:
    """A track mapped as a line (its middle): a band as wide as its `width`,
    else six lanes."""
    width = tag(other_tags, "width")
    try:
        band = float(width.replace(",", ".")) if width else TRACK_LANE_BAND
    except ValueError:
        band = TRACK_LANE_BAND
    return shapely.buffer(g, band / 2, cap_style="flat")


def outdoors(other_tags: str | None) -> bool:
    return (
        tag(other_tags, "indoor") != "yes"
        and tag(other_tags, "covered") != "yes"
        and tag(other_tags, "location") not in NOT_OUTSIDE
    )


def grounds(
    tile: Tile, areas, leisures, sports, area_tags, lines, line_tags
) -> list[tuple[shapely.Geometry, int, int, int, list[float]]]:
    """(outline, surface, marking, shape, frame) for every ground touching
    the tile, in burn order: tracks, then the pitches largest first, so a
    court inside a larger ground wins."""
    box = shapely.box(*tile.bounds)
    found: list[tuple[int, float, shapely.Geometry, int, int]] = []
    rank = {"track": 0, "pitch": 1}

    def add(g, leisure, sport, tags):
        if g is None or g.is_empty or not g.intersects(box) or not outdoors(tags):
            return
        kind = classify(leisure, sport, tag(tags, "surface"))
        if kind is None:
            return
        surface, marking = kind
        found.append((rank[leisure], -g.area, g, surface, marking))

    for g, leisure, sport, tags in zip(areas, leisures, sports, area_tags, strict=True):
        if leisure in rank:
            add(shapely.make_valid(g), leisure, sport, tags)
    for g, tags in zip(lines, line_tags, strict=True):
        if tag(tags, "leisure") == "track":
            add(track_area(g, tags), "track", tag(tags, "sport"), tags)
    found.sort(key=lambda f: (f[0], f[1]))
    out = []
    for _, _, g, surface, marking in found:
        shape, params = frame(g, marking)
        if marking == FOOTBALL and surface in (3, 6, 7) and params[3] * 2 < SMALL_FOOTBALL_M:
            marking = COURT
        out.append((g, surface, marking, shape, params))
    return out[:255]


def index_raster(outlines: list[shapely.Geometry], tile: Tile, px: int) -> np.ndarray:
    """R: 1 + the row reaching a texel (grown outlines, then the exact ones);
    G: 1 + the first row whose wider growth reaches it; B: 255 inside an
    exact outline; A: 0. Shape (px, px, 4)."""
    rows = np.zeros((px, px), dtype=np.uint8)
    alt = np.zeros((px, px), dtype=np.uint8)
    exact = np.zeros((px, px), dtype=np.uint8)
    if outlines:
        transform = tile.transform(px)
        numbered = list(enumerate(outlines, start=1))
        grown = [(shapely.buffer(g, REACH), i) for i, g in numbered]
        rasterize(grown, out=rows, transform=transform, dtype=np.uint8)
        rasterize([(g, i) for i, g in numbered], out=rows, transform=transform, dtype=np.uint8)
        wide = [(shapely.buffer(g, REACH_ALT), i) for i, g in reversed(numbered)]
        rasterize(wide, out=alt, transform=transform, dtype=np.uint8)
        rasterize([(g, 255) for g in outlines], out=exact, transform=transform, dtype=np.uint8)
    return np.stack([rows, alt, exact, np.zeros_like(rows)], axis=-1)


def table_row(tile: Tile, surface: int, marking: int, shape: int, params: list[float]) -> list:
    xmin, _, _, ymax = tile.bounds
    cx, cy, angle, p1, p2, p3 = params
    return [
        round(cx - xmin, 2),
        round(cy - ymax, 2),
        round(angle, 4),
        round(p1, 2),
        round(p2, 2),
        round(p3, 2),
        surface,
        marking,
        shape,
    ]


def table_json(table: dict, rows: list[list]) -> str:
    """The table with one ground per line (diffable, still plain JSON)."""
    head = json.dumps(table, indent=2)[:-2]
    body = ",\n".join(f"    {json.dumps(r)}" for r in rows)
    grounds = f"[\n{body}\n  ]" if rows else "[]"
    return f'{head},\n  "grounds": {grounds}\n}}\n'


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the sports grounds"):
        return
    areas, afields = read_osm(
        tile,
        "multipolygons",
        "leisure IN ('pitch', 'track')",
        ["leisure", "sport", "other_tags"],
    )
    lines, lfields = read_osm(
        tile, "lines", 'other_tags LIKE \'%"leisure"=>"track"%\'', ["other_tags"]
    )
    found = grounds(
        tile,
        areas,
        column(afields, "leisure", areas),
        column(afields, "sport", areas),
        column(afields, "other_tags", areas),
        lines,
        column(lfields, "other_tags", lines),
    )
    raster = index_raster([g for g, *_ in found], tile, px)
    save_grey_png(tile.out("dlm", f"sport_{tile.id}.png"), raster.reshape(px, 4 * px))
    table = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "encoding": {
            "layout": "8-bit greyscale, 4 * size wide: R0 G0 B0 A0 R1 ... per row",
            "r": "1 + the row of `grounds` reaching the texel (0 none)",
            "g": "1 + another row reaching it (grown wider, the first row wins)",
            "b": "255 inside an exact outline",
            "grounds": "[cx, cy, angle, p1, p2, p3, surface, marking, shape]: the centre "
            "in m from the tile's north-west corner (x east, y north), the long axis "
            "(rad from east, ccw); rect/free p1, p2 = half length, half width; stadium "
            "p1 = half straight, p2 = outer radius, p3 = band width",
        },
        "surfaces": {str(k): v for k, v in SURFACES.items()},
        "markings": {str(k): v for k, v in MARKINGS.items()},
        "shapes": {str(k): v for k, v in SHAPES.items()},
        "attribution": OSM_ATTRIBUTION,
    }
    rows = [table_row(tile, s, m, sh, p) for _, s, m, sh, p in found]
    tile.out("dlm", f"sport_{tile.id}.json").write_text(table_json(table, rows))
    counts = {MARKINGS[m]: 0 for m in MARKINGS}
    for _, _, m, _, _ in found:
        counts[MARKINGS[m]] += 1
    print(f"{tile.id}: {len(found)} sports grounds, {counts}")
