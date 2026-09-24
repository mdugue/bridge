"""OSM stairs (`highway=steps`) → stair axes with a width, a step count and
the two landing heights, oriented bottom → top. The DGM1 smooths a flight of
steps into a bank; the build lowers the terrain under each flight
(lib/city/stairs.ts) and the viewer stands the steps on it.

The landing heights are read from the DGM a metre beyond each end of the way
(the landings, not the smoothed slope between them). The width comes from
the `width` tag, else from an `area:highway=steps` outline over the way,
else from the OSM walls either side when the slope fills the gap between
them (the axis is then centred between the walls), else a default; the step
count from `step_count` when it gives a plausible riser, else from the
height difference.

Where the DGM lacks the structure a flight climbs — the Brühlsche Terrasse
is a platform over casemates, so the bare-earth model runs flat under it —
the tagged steps (`step_count` × `step:height`, 15 cm when untagged) set the
rise instead, but only when the flight's top lands on a raised OSM area
(`layer` ≥ 1). That area is written out as a terrace at the flight's top
level, and the build lifts the terrain inside it (lib/city/stairs.ts)."""

from __future__ import annotations

import re

import numpy as np
import rasterio
import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, write_geojson
from .osm import has_extract, read_osm, tag

WHERE = "highway = 'steps'"
AREA_WHERE = 'other_tags LIKE \'%"area:highway"=>"steps"%\''
WALL_WHERE = "barrier IN ('retaining_wall','city_wall','wall')"
RAISED_WHERE = 'other_tags LIKE \'%"layer"=>"%\''
DEFAULT_W = 2.5  # m, a public flight without a width tag
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


def flight(
    line: shapely.LineString,
    other_tags: str | None,
    areas: list,
    dgm: Dgm,
    walls: list | None = None,
    raised: list | None = None,
) -> dict | None:
    coords = [tuple(c[:2]) for c in line.coords]
    if len(coords) < 2 or line.length < MIN_LEN:
        return None
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
    rise = z1 - z0
    axis = shapely.LineString(coords)
    width = tagged_width(axis, other_tags, areas)
    if width is None and walls and not lift:
        fitted = wall_to_wall(axis, walls, dgm, rise)
        if fitted:
            axis, width = fitted
    props = {
        "w": round(width or DEFAULT_W, 2),
        "n": step_count(rise, other_tags),
        "z": [round(z0, 2), round(z1, 2)],
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


def run(tile: Tile) -> None:
    if not has_extract(tile, "the stairs"):
        return
    box = shapely.box(*tile.bounds)
    dgm = Dgm(tile)
    areas = outlines(tile)
    walls = wall_lines(tile)
    raised = raised_areas(tile)
    geoms, fields = read_osm(tile, "lines", WHERE, ["highway", "other_tags"])
    features = []
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        # Unclipped: a flight across a seam is burned into both tiles'
        # terrain; the viewer stands it once, on the tile owning its middle.
        if skipped(other) or not g.intersects(box):
            continue
        for part in shapely.get_parts(g):
            if isinstance(part, shapely.LineString):
                f = flight(part, other, areas, dgm, walls, raised)
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
    print(f"{tile.id}: {len(features)} stairs, {len(terraces)} terraces")
