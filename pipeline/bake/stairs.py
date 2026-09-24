"""OSM stairs (`highway=steps`) → stair axes with a width, a step count and
the two landing heights, oriented bottom → top. The DGM1 smooths a flight of
steps into a bank; the build lowers the terrain under each flight
(lib/city/stairs.ts) and the viewer stands the steps on it.

The landing heights are read from the DGM a metre beyond each end of the way
(the landings, not the smoothed slope between them). The width comes from
the `width` tag, else from an `area:highway=steps` outline over the way,
else a default; the step count from `step_count` when it gives a plausible
riser, else from the height difference."""

from __future__ import annotations

import re

import numpy as np
import rasterio
import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, write_geojson
from .osm import has_extract, read_osm, tag

WHERE = "highway = 'steps'"
AREA_WHERE = 'other_tags LIKE \'%"area:highway"=>"steps"%\''
DEFAULT_W = 2.5  # m, a public flight without a width tag
MIN_W, MAX_W = 0.8, 30.0
RISER = 0.16  # m, the riser a count is derived with
MIN_RISER, MAX_RISER = 0.08, 0.25  # a tagged count outside this is a typo
MIN_RISE = 0.3  # m; a flatter "flight" is not something the DGM can place
MIN_LEN = 0.8  # m
LANDING_PROBE = 1.0  # m beyond each end of the way


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


def width_of(line: shapely.LineString, other_tags: str | None, areas: list) -> float:
    tagged = number(tag(other_tags, "width"))
    if tagged is not None:
        return min(max(tagged, MIN_W), MAX_W)
    for area in areas:
        inside = shapely.intersection(line, area).length
        if inside > 0.5 * line.length and inside > 0:
            return min(max(area.area / inside, MIN_W), MAX_W)
    return DEFAULT_W


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


def flight(line: shapely.LineString, other_tags: str | None, areas: list, dgm: Dgm) -> dict | None:
    coords = [tuple(c[:2]) for c in line.coords]
    if len(coords) < 2 or line.length < MIN_LEN:
        return None
    z0 = landing(dgm, coords[0], coords[1])
    z1 = landing(dgm, coords[-1], coords[-2])
    if z0 is None or z1 is None or abs(z1 - z0) < MIN_RISE:
        return None
    if z0 > z1:  # bottom → top, whatever way the mapper drew it
        coords.reverse()
        z0, z1 = z1, z0
    rise = z1 - z0
    return feature(
        geometry_json(shapely.LineString(coords)),
        {
            "w": round(width_of(line, other_tags, areas), 2),
            "n": step_count(rise, other_tags),
            "z": [round(z0, 2), round(z1, 2)],
        },
    )


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


def run(tile: Tile) -> None:
    if not has_extract(tile, "the stairs"):
        return
    box = shapely.box(*tile.bounds)
    dgm = Dgm(tile)
    areas = outlines(tile)
    geoms, fields = read_osm(tile, "lines", WHERE, ["highway", "other_tags"])
    features = []
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        # Unclipped: a flight across a seam is burned into both tiles'
        # terrain; the viewer stands it once, on the tile owning its middle.
        if skipped(other) or not g.intersects(box):
            continue
        for part in shapely.get_parts(g):
            if isinstance(part, shapely.LineString):
                f = flight(part, other, areas, dgm)
                if f:
                    features.append(f)
    write_geojson(
        tile.out("dlm", f"stairs_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    print(f"{tile.id}: {len(features)} stairs")
