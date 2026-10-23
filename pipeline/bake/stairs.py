"""OSM stairs (`highway=steps`) → stair axes with a width, a step count and
the two landing heights, oriented bottom → top. The DGM1 smooths a flight of
steps into a bank; the build lowers the terrain under each flight
(lib/city/stairs.ts) and the viewer stands the steps on it.

The landing heights are read from the DGM a metre beyond each end of the way
(the landings, not the smoothed slope between them). The width comes from
the `width` tag, else from an `area:highway=steps` outline over the way,
else from the OSM walls either side when the slope fills the gap between
them (the axis is then centred between the walls), else a default — a
public flight's in a pedestrian area, a garden's or a path's elsewhere; the
step count from `step_count` when it gives a plausible riser, else from the
height difference.

Each flight also says what stands along its sides (`walled`: an OSM wall or
building beside the left and the right edge, which the viewer's Wange
needs), where its handrails run (`rail`, from the `handrail*` tags, on a
side no mapped fence or handrail runs along already) and what it is made
of (`mat`, from `surface`, else the site's majority; lib/city/stairs.ts
`STAIR_TONES`).

Where the DGM lacks the structure a flight climbs — the Brühlsche Terrasse
is a platform over casemates, so the bare-earth model runs flat under it —
the tagged steps (`step_count` × `step:height`, 15 cm when untagged) set the
rise instead, but only when the flight's top lands on a raised OSM area
(`layer` ≥ 1). That area is written out as a terrace at the flight's top
level, and the build lifts the terrain inside it (lib/city/stairs.ts)."""

from __future__ import annotations

import dataclasses
import re
from collections import Counter

import numpy as np
import rasterio
import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, write_geojson
from .osm import has_extract, read_osm, tag
from .walls import FENCE_WHERE, MATERIALS, lines_of, majority, site_extent

WHERE = "highway = 'steps'"
AREA_WHERE = 'other_tags LIKE \'%"area:highway"=>"steps"%\''
WALL_WHERE = "barrier IN ('retaining_wall','city_wall','wall')"
RAISED_WHERE = 'other_tags LIKE \'%"layer"=>"%\''
# A flight without a width tag (PR #173, B7): 2.5 m was a public flight's,
# and most untagged flights are a garden's, a path's or a slope's, 1–1.5 m
# in the street photos. A flight in a pedestrian area (`highway=pedestrian`
# as an area, or any `area:highway` outline) is a public one.
DEFAULT_W = 1.5  # m
PUBLIC_W = 2.5  # m
PUBLIC_WHERE = (
    'other_tags LIKE \'%"highway"=>"pedestrian"%\' OR other_tags LIKE \'%"area:highway"=>%\''
)
PUBLIC_NEAR_M = 1.0  # the flight's middle this close to a pedestrian area lies in it
# What stands along a flight's side (PR #173, B8): an OSM wall or a
# building within SIDE_NEAR_M of the side's edge at two of its three
# quarter points. Only there does the viewer build a Wange; elsewhere the
# bank beside the steps stays ground (a grass bank, Meißen's Burgberg).
SIDE_NEAR_M = 1.0
SIDE_AT = (0.25, 0.5, 0.75)
BUILDING_WHERE = "building IS NOT NULL"
# What a flight is made of (PR #173, B6): its `surface` (or `material`),
# else the site's majority of its tagged flights (`walls.majority`). Paving
# stones on steps are concrete pavers; unpaved steps are timber risers.
STAIR_MATERIALS = {
    **MATERIALS,
    "concrete:plates": "concrete",
    "concrete:lanes": "concrete",
    "paving_stones": "concrete",
    "asphalt": "concrete",
    "sett": "stone",
    "cobblestone": "stone",
    "unhewn_cobblestone": "stone",
    "metal_grid": "metal",
    "dirt": "wood",
    "ground": "wood",
    "earth": "wood",
    "compacted": "wood",
    "gravel": "wood",
    "fine_gravel": "wood",
    "pebblestone": "wood",
    "grass": "wood",
}
MIN_W, MAX_W = 0.8, 30.0
RISER = 0.16  # m, the riser a count is derived with
MIN_RISER, MAX_RISER = 0.08, 0.25  # a tagged count outside this is a typo
MIN_RISE = 0.3  # m; a flatter "flight" is not something the DGM can place
MIN_LEN = 0.8  # m
LANDING_PROBE = 1.0  # m beyond each end of the way
WALL_REACH = 15.0  # m, how far either side a flight looks for its walls
WALL_CLEARANCE = 0.3  # m, half a wall's thickness on each side
TAGGED_RISER = 0.15  # m, `step:height` when a lifted flight has none
TERRACE_SNAP = 3.0  # m, how close a lifted flight's top must be to a raised area


def number(value: str | None) -> float | None:
    num = re.search(r"\d*\.?\d+", value or "")
    return float(num.group()) if num else None


def skipped(other_tags: str | None) -> bool:
    """Flights the terrain cannot seat: indoors, underground, on a bridge."""
    if tag(other_tags, "indoor") not in (None, "no"):
        return True
    if tag(other_tags, "tunnel") not in (None, "no"):
        return True
    if tag(other_tags, "bridge") not in (None, "no"):
        return True
    below_ground = (tag(other_tags, "level") or "").lstrip().startswith("-")
    return below_ground or tag(other_tags, "location") == "underground"


def tagged_width(line: shapely.LineString, other_tags: str | None, areas: list) -> float | None:
    tagged = number(tag(other_tags, "width"))
    if tagged is not None:
        return min(max(tagged, MIN_W), MAX_W)
    for area in areas:
        inside = shapely.intersection(line, area).length
        if inside > 0.5 * line.length and inside > 0:
            return min(max(area.area / inside, MIN_W), MAX_W)
    return None


def width_of(line: shapely.LineString, other_tags: str | None, areas: list) -> float:
    return tagged_width(line, other_tags, areas) or DEFAULT_W


def side_hit(point, normal, walls: list, side: float) -> float | None:
    """Distance to the nearest wall along the perpendicular on one side."""
    far = (point[0] + normal[0] * side * WALL_REACH, point[1] + normal[1] * side * WALL_REACH)
    ray = shapely.LineString([point, far])
    best = None
    for wall in walls:
        hit = shapely.intersection(ray, wall)
        if not hit.is_empty:
            d = shapely.distance(shapely.Point(point), hit)
            best = d if best is None else min(best, d)
    return best


def between_walls(line: shapely.LineString, walls: list) -> tuple[float, float] | None:
    """The gap between the walls either side of the axis, sampled at a
    quarter, half and three quarters of its length: (width, offset to the
    gap's middle, + = left), or None when fewer than two samples see a wall
    on both sides."""
    near = [w for w in walls if shapely.distance(w, line) <= WALL_REACH]
    widths, offsets = [], []
    for t in (0.25, 0.5, 0.75):
        a = line.interpolate(max(t * line.length - 0.5, 0))
        b = line.interpolate(min(t * line.length + 0.5, line.length))
        dx, dy = b.x - a.x, b.y - a.y
        d = float(np.hypot(dx, dy)) or 1.0
        normal = (-dy / d, dx / d)  # left of the way's direction
        p = line.interpolate(t * line.length)
        left = side_hit((p.x, p.y), normal, near, 1.0)
        right = side_hit((p.x, p.y), normal, near, -1.0)
        if left is not None and right is not None:
            widths.append(left + right)
            offsets.append((left - right) / 2)
    if len(widths) < 2:
        return None
    return float(np.median(widths)) - 2 * WALL_CLEARANCE, float(np.median(offsets))


def rise_along(line: shapely.LineString, dgm: Dgm) -> float | None:
    coords = list(line.coords)
    z0 = landing(dgm, coords[0], coords[1])
    z1 = landing(dgm, coords[-1], coords[-2])
    return None if z0 is None or z1 is None else abs(z1 - z0)


def wall_to_wall(line: shapely.LineString, walls: list, dgm: Dgm, rise: float):
    """The axis re-centred between its walls and the gap's width, when the
    slope fills that gap (both edges climb at least half the axis's rise) —
    a flight that spans the whole cut, like the one beside the Italienisches
    Dörfchen. None otherwise."""
    gap = between_walls(line, walls)
    if gap is None:
        return None
    width, offset = gap
    if not DEFAULT_W < width <= MAX_W:
        return None
    centred = line.offset_curve(offset) if abs(offset) > 0.05 else line
    if not isinstance(centred, shapely.LineString) or centred.is_empty:
        return None
    for side in (1.0, -1.0):
        edge = centred.offset_curve(side * (width / 2 - 1.0))
        if not isinstance(edge, shapely.LineString) or len(edge.coords) < 2:
            return None
        edge_rise = rise_along(edge, dgm)
        if edge_rise is None or edge_rise < 0.5 * rise:
            return None
    return centred, width


def step_count(rise: float, other_tags: str | None) -> int:
    tagged = number(tag(other_tags, "step_count"))
    if tagged is not None and tagged >= 1 and MIN_RISER <= rise / round(tagged) <= MAX_RISER:
        return int(round(tagged))
    return max(2, round(rise / RISER))


class Dgm:
    """The tile's DGM1 on its 1 m grid, read as small-window medians."""

    def __init__(self, tile: Tile):
        self.xmin, self.ymin, self.xmax, self.ymax = tile.bounds
        with rasterio.open(tile.dgm) as src:
            self.z = src.read(1).astype(np.float64)
            self.res = src.res[0]

    def at(self, x: float, y: float) -> float | None:
        if not (self.xmin <= x < self.xmax and self.ymin <= y < self.ymax):
            return None
        n = self.z.shape[0]
        c = min(int((x - self.xmin) / self.res), n - 1)
        r = min(int((self.ymax - y) / self.res), n - 1)
        block = self.z[max(r - 1, 0) : r + 2, max(c - 1, 0) : c + 2]
        vals = block[block > -1000]
        return float(np.median(vals)) if len(vals) else None


def landing(dgm: Dgm, end, inner) -> float | None:
    """The ground a probe's length beyond one end of the way (the end itself
    when that lies off the tile)."""
    dx, dy = end[0] - inner[0], end[1] - inner[1]
    d = float(np.hypot(dx, dy)) or 1.0
    beyond = dgm.at(end[0] + dx / d * LANDING_PROBE, end[1] + dy / d * LANDING_PROBE)
    return beyond if beyond is not None else dgm.at(end[0], end[1])


def tagged_rise(other_tags: str | None) -> float | None:
    count = number(tag(other_tags, "step_count"))
    if count is None or count < 2:
        return None
    return round(count) * (number(tag(other_tags, "step:height")) or TAGGED_RISER)


def lifted(coords, z0: float, z1: float, other_tags: str | None, raised: list):
    """For a flight the DGM runs flat under (less than half its tagged rise):
    its coordinates bottom → top, the two landings and the raised area its top
    lands on — when the way's `incline` says which end is up and that end
    lies on a raised area. None otherwise."""
    rise = tagged_rise(other_tags)
    if rise is None or abs(z1 - z0) >= 0.5 * rise or rise < MIN_RISE:
        return None
    incline = tag(other_tags, "incline")
    if incline not in ("up", "down"):
        return None
    coords = list(coords) if incline == "up" else list(reversed(coords))
    bottom = z0 if incline == "up" else z1
    top = shapely.Point(coords[-1])
    area = next((a for a in raised if shapely.distance(a, top) <= TERRACE_SNAP), None)
    if area is None:
        return None
    return coords, bottom, bottom + rise, area


@dataclasses.dataclass
class Context:
    """What a flight's sides, width and material are read against: the
    pedestrian areas (`PUBLIC_WHERE`), the walls and buildings beside it, the
    mapped fences and handrails, and the site's majority material."""

    public: list = dataclasses.field(default_factory=list)
    sides: shapely.STRtree | None = None
    fences: shapely.STRtree | None = None
    mat: str = "concrete"


def default_width(axis: shapely.LineString, context: Context | None) -> float:
    """An untagged flight's width: PUBLIC_W in a pedestrian area, else
    DEFAULT_W."""
    if context is not None and context.public:
        middle = axis.interpolate(0.5, normalized=True)
        if any(shapely.distance(a, middle) <= PUBLIC_NEAR_M for a in context.public):
            return PUBLIC_W
    return DEFAULT_W


def side_points(axis: shapely.LineString, half: float, side: float) -> list:
    """The edge points `half` metres left (+1) or right (−1) of the axis at
    its quarter points (SIDE_AT)."""
    out = []
    for t in SIDE_AT:
        s = t * axis.length
        a = axis.interpolate(max(s - 0.5, 0.0))
        b = axis.interpolate(min(s + 0.5, axis.length))
        d = float(np.hypot(b.x - a.x, b.y - a.y)) or 1.0
        p = axis.interpolate(s)
        out.append(
            shapely.Point(p.x - (b.y - a.y) / d * half * side, p.y + (b.x - a.x) / d * half * side)
        )
    return out


def beside(axis: shapely.LineString, half: float, tree: shapely.STRtree | None) -> list[bool]:
    """Per side (left, right of the climb): whether a line of `tree` runs
    within SIDE_NEAR_M of its edge at two of its quarter points."""
    if tree is None:
        return [False, False]
    out = []
    for side in (1.0, -1.0):
        pts = side_points(axis, half, side)
        hits = sum(len(tree.query_nearest(p, max_distance=SIDE_NEAR_M)) > 0 for p in pts)
        out.append(hits >= 2)
    return out


def rail_sides(other_tags: str | None) -> tuple[bool, bool]:
    """The handrails the tags give, (left, right) of the way as drawn:
    `handrail=yes` (both, double) on both sides unless a side says no, and
    `handrail:left` / `handrail:right`."""
    both = (tag(other_tags, "handrail") or "") in ("yes", "both", "double")

    def side(key: str) -> bool:
        value = tag(other_tags, key)
        return value == "yes" or (both and value != "no")

    return side("handrail:left"), side("handrail:right")


def stair_material(other_tags: str | None) -> str | None:
    """A flight's material from its `surface` (or `material`): the first
    known of a list, None when untagged or unknown."""
    for key in ("surface", "material"):
        for value in (tag(other_tags, key) or "").lower().split(";"):
            if value.strip() in STAIR_MATERIALS:
                return STAIR_MATERIALS[value.strip()]
    return None


def sides_of(
    axis: shapely.LineString, width: float, other_tags: str | None, flipped: bool, context
) -> dict:
    """The flight's `walled`, `rail` (where any) and `mat` properties: the
    handrail tags' sides turned with the axis when it runs against the way
    (`flipped`), less a side a mapped fence or handrail runs along."""
    half = width / 2
    walled = beside(axis, half, context.sides if context else None)
    left, right = rail_sides(other_tags)
    rail = [right, left] if flipped else [left, right]
    fenced = beside(axis, half, context.fences if context else None)
    rail = [r and not f for r, f in zip(rail, fenced, strict=True)]
    props: dict = {"walled": walled}
    if any(rail):
        props["rail"] = rail
    props["mat"] = stair_material(other_tags) or (context.mat if context else "concrete")
    return props


def flight(
    line: shapely.LineString,
    other_tags: str | None,
    areas: list,
    dgm: Dgm,
    walls: list | None = None,
    raised: list | None = None,
    context: Context | None = None,
) -> dict | None:
    coords = [tuple(c[:2]) for c in line.coords]
    if len(coords) < 2 or line.length < MIN_LEN:
        return None
    drawn = coords[0]
    z0 = landing(dgm, coords[0], coords[1])
    z1 = landing(dgm, coords[-1], coords[-2])
    if z0 is None or z1 is None:
        return None
    lift = lifted(coords, z0, z1, other_tags, raised or [])
    terrace = None
    if lift:
        coords, z0, z1, terrace = lift
    elif abs(z1 - z0) < MIN_RISE:
        return None
    elif z0 > z1:  # bottom → top, whatever way the mapper drew it
        coords.reverse()
        z0, z1 = z1, z0
    flipped = coords[0] != drawn
    rise = z1 - z0
    axis = shapely.LineString(coords)
    width = tagged_width(axis, other_tags, areas)
    if width is None and walls and not lift:
        fitted = wall_to_wall(axis, walls, dgm, rise)
        if fitted:
            axis, width = fitted
    width = width or default_width(axis, context)
    props = {
        "w": round(width, 2),
        "n": step_count(rise, other_tags),
        "z": [round(z0, 2), round(z1, 2)],
        **sides_of(axis, width, other_tags, flipped, context),
    }
    out = feature(geometry_json(axis), props)
    if terrace is not None:
        out["terrace"] = terrace  # consumed by run(), never written
    return out


def wall_lines(tile: Tile) -> list:
    """The OSM walls a flight may run between: lines, and polygons' rings."""
    out = []
    for layer in ("lines", "multipolygons"):
        geoms, _ = read_osm(tile, layer, WALL_WHERE, ["barrier"])
        for g in geoms:
            for part in shapely.get_parts(g):
                if isinstance(part, shapely.Polygon):
                    out.append(part.exterior)
                elif isinstance(part, shapely.LineString):
                    out.append(part)
    return out


def is_raised(fields: dict[str, str | None]) -> bool:
    """A platform a lifted flight may climb onto: an area on `layer` ≥ 1 that
    is no building, bridge, railway or other man-made structure (platforms
    and tracks are the rail layer's)."""
    other = fields.get("other_tags")
    layer = tag(other, "layer") or ""
    if layer.lstrip().startswith("-") or (number(layer) or 0) < 1:
        return False
    if any(fields.get(k) for k in ("building", "man_made", "landuse")):
        return False
    return not any(
        tag(other, k) not in (None, "no") for k in ("bridge", "railway", "public_transport")
    )


def raised_areas(tile: Tile) -> list:
    """The raised OSM areas (`is_raised`) around the tile."""
    names = ["building", "man_made", "landuse", "other_tags"]
    geoms, fields = read_osm(tile, "multipolygons", RAISED_WHERE, names)
    cols = [column(fields, n, geoms) for n in names]
    return [
        g
        for g, *values in zip(geoms, *cols, strict=True)
        if is_raised(dict(zip(names, values, strict=True))) and g.is_valid and g.area > 0
    ]


def outlines(tile: Tile) -> list:
    """`area:highway=steps` outlines: closed ways reach GDAL as closed lines
    (the area key is not one of its polygon keys) or, tagged `area=yes`, as
    multipolygons."""
    out = []
    for layer in ("lines", "multipolygons"):
        geoms, _ = read_osm(tile, layer, AREA_WHERE, ["other_tags"])
        for g in geoms:
            if isinstance(g, shapely.LineString) and g.is_ring:
                g = shapely.Polygon(g.coords)
            if isinstance(g, (shapely.Polygon, shapely.MultiPolygon)) and g.is_valid:
                out.append(g)
    return out


def platform(area: shapely.Geometry) -> shapely.Geometry:
    """A raised area's platform: its outer rings, holes filled — the lawns,
    fountains and monuments cut out of a promenade stand on it too."""
    return shapely.union_all([shapely.Polygon(p.exterior) for p in shapely.get_parts(area)])


def terrace_features(lifted_flights: list[dict]) -> list[dict]:
    """One terrace per raised area a lifted flight reaches (its platform),
    at the highest top landing of the flights that reach it."""
    levels: dict[int, tuple[shapely.Geometry, float]] = {}
    for f in lifted_flights:
        area = f["terrace"]
        top = f["properties"]["z"][1]
        key = id(area)
        if key not in levels or top > levels[key][1]:
            levels[key] = (area, top)
    return [feature(geometry_json(platform(a)), {"z": round(z, 2)}) for a, z in levels.values()]


def is_public(other_tags: str | None) -> bool:
    """A pedestrian area's tags (`PUBLIC_WHERE`)."""
    return tag(other_tags, "highway") == "pedestrian" or tag(other_tags, "area:highway") is not None


def as_area(g: shapely.Geometry) -> shapely.Geometry | None:
    """An area, or a closed line (an `area:highway` outline without an area
    key) as one; None for anything else."""
    if isinstance(g, shapely.LineString) and g.is_ring:
        g = shapely.Polygon(g.coords)
    ok = isinstance(g, (shapely.Polygon, shapely.MultiPolygon)) and g.is_valid
    return g if ok else None


def site_stair_material(tile: Tile) -> str:
    """The site's majority stair material (`walls.majority` over every flight
    on the site's tiles whose surface says one)."""
    geoms, fields = read_osm(site_extent(tile), "lines", WHERE, ["other_tags"])
    found = Counter(m for m in map(stair_material, column(fields, "other_tags", geoms)) if m)
    return majority(found)


def context_of(tile: Tile, walls: list) -> Context:
    """A tile's `Context`: its pedestrian areas, its walls and building
    outlines, its fences and handrails, its site's material — the OSM read
    once per layer."""
    public, sides, fences = [], list(walls), []
    for layer, extra in (("lines", []), ("multipolygons", ["building"])):
        where = f"({FENCE_WHERE}) OR ({PUBLIC_WHERE})"
        where += f" OR {BUILDING_WHERE}" if extra else ""
        geoms, fields = read_osm(tile, layer, where, ["barrier", "other_tags", *extra])
        barriers, tags = column(fields, "barrier", geoms), column(fields, "other_tags", geoms)
        buildings = column(fields, "building", geoms)  # Nones on the lines
        for g, barrier, other, building in zip(geoms, barriers, tags, buildings, strict=True):
            if g is None:
                continue
            if barrier in ("fence", "handrail"):
                fences += lines_of(g)
            if building is not None:
                sides += lines_of(g)
            if is_public(other) and (area := as_area(g)) is not None:
                public.append(area)
    return Context(
        public=public,
        sides=shapely.STRtree(sides) if sides else None,
        fences=shapely.STRtree(fences) if fences else None,
        mat=site_stair_material(tile),
    )


def run(tile: Tile) -> None:
    if not has_extract(tile, "the stairs"):
        return
    box = shapely.box(*tile.bounds)
    dgm = Dgm(tile)
    areas = outlines(tile)
    walls = wall_lines(tile)
    raised = raised_areas(tile)
    context = context_of(tile, walls)
    geoms, fields = read_osm(tile, "lines", WHERE, ["highway", "other_tags"])
    features = []
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        # Unclipped: a flight across a seam is burned into both tiles'
        # terrain; the viewer stands it once, on the tile owning its middle.
        if skipped(other) or not g.intersects(box):
            continue
        for part in shapely.get_parts(g):
            if isinstance(part, shapely.LineString):
                f = flight(part, other, areas, dgm, walls, raised, context)
                if f:
                    features.append(f)
    terraces = terrace_features([f for f in features if "terrace" in f])
    for f in features:
        f.pop("terrace", None)
    write_geojson(
        tile.out("dlm", f"stairs_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    write_geojson(
        tile.out("dlm", f"terraces_{tile.id}.geojson"), terraces, tile.epsg, OSM_ATTRIBUTION
    )
    walled = sum(any(f["properties"]["walled"]) for f in features)
    railed = sum("rail" in f["properties"] for f in features)
    print(
        f"{tile.id}: {len(features)} stairs ({walled} walled, {railed} with a handrail drawn; "
        f"untagged ones {context.mat}), {len(terraces)} terraces"
    )
