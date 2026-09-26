"""OSM street lamps → lamp points with a head height, dropped where the class
raster says railway or water. Each tile writes only the lamps it owns (west
and south edges in, east and north out — lib/city/tileset.ts `ownsPoint`), so
a lamp on a seam stands once when both tiles are dressed."""

from __future__ import annotations

import shapely

from .common import OSM_ATTRIBUTION, Tile, feature, value_at, write_geojson
from .osm import has_extract, read_osm

BLOCKED = (5, 8)  # railway, water


def run(tile: Tile, lamp_height: float = 5.0) -> None:
    if not has_extract(tile, "the lamps"):
        return
    # A small margin, so the reprojected bbox cannot clip a lamp on the edge.
    geoms, _ = read_osm(tile, "points", "highway = 'street_lamp'", ["highway"], margin=0.0005)
    cls = tile.classes()
    if cls is None:
        print(f"{tile.id}: no class raster — skipping the lamps")
        return
    features = []
    for g in geoms:
        x, y = shapely.get_x(g), shapely.get_y(g)
        cls_here = value_at(cls, tile.bounds, x, y)
        if cls_here is None or cls_here in BLOCKED:
            continue
        features.append(
            feature(
                {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
                {"h": round(lamp_height, 1)},
            )
        )
    write_geojson(tile.out("dlm", f"lamps_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    print(f"{tile.id}: {len(features)} lamps")
