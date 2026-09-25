"""OSM walls → wall lines with a kind and a height (retaining walls, city
walls, walls, embankments, cliffs), clipped to the tile. The terrain bake burns the
tall ones into the heightfield as breaklines; the viewer stands a ribbon on
each."""

from __future__ import annotations

import re

import shapely

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, write_geojson
from .osm import has_extract, read_osm, tag

CLIFF = 'other_tags LIKE \'%"natural"=>"cliff"%\''
WHERE = f"barrier IN ('retaining_wall','city_wall','wall') OR man_made = 'embankment' OR {CLIFF}"
DEFAULT_H = {
    "city_wall": 6.0,
    "retaining_wall": 3.0,
    "wall": 1.5,
    "embankment": 2.5,
    "cliff": 3.0,
}


def kind_of(barrier: str | None, man_made: str | None, other_tags: str | None) -> str:
    if barrier or man_made:
        return barrier or man_made
    return "cliff" if tag(other_tags, "natural") == "cliff" else "wall"


def height(other_tags: str | None) -> float | None:
    for key in ("height", "est_height"):
        value = tag(other_tags, key)
        num = re.search(r"[-+]?\d*\.?\d+", value or "")
        if num:
            return max(0.5, min(float(num.group()), 30.0))
    return None


def lines_of(geom: shapely.Geometry) -> list[shapely.Geometry]:
    """Lines as they are; polygons as their exterior rings (holes are no walls)."""
    out = []
    for part in shapely.get_parts(geom):
        if part.is_empty:  # a polygon clipped away entirely
            continue
        if isinstance(part, shapely.Polygon):
            out.append(part.exterior)
        elif isinstance(part, shapely.LineString) and len(part.coords) >= 2:
            out.append(part)
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the walls"):
        return
    box = shapely.box(*tile.bounds)
    features = []
    for layer in ("lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, WHERE, ["barrier", "man_made", "other_tags"])
        for g, barrier, man_made, other in zip(
            geoms,
            column(fields, "barrier", geoms),
            column(fields, "man_made", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        ):
            kind = kind_of(barrier, man_made, other)
            h = height(other) or DEFAULT_H.get(kind, 2.0)
            clipped = shapely.intersection(g, box)
            for line in lines_of(clipped):
                features.append(
                    feature(
                        geometry_json(shapely.LineString(line.coords)),
                        {"kind": kind, "h": round(h, 1)},
                    )
                )
    write_geojson(tile.out("dlm", f"walls_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    print(f"{tile.id}: {len(features)} walls")
