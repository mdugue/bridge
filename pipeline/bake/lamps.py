"""OSM street lamps → lamp points with a head height, dropped where the class
raster says railway or water (off-tile lamps are kept: a neighbour's gate
owns them)."""

from __future__ import annotations

import numpy as np
import shapely
from PIL import Image

from .common import OSM_ATTRIBUTION, Tile, feature, write_geojson
from .osm import has_extract, read_osm

BLOCKED = (5, 8)  # railway, water


def run(tile: Tile, lamp_height: float = 5.0) -> None:
    if not has_extract(tile, "the lamps"):
        return
    # ~50 m around the tile, so lamps at its edge are not cut off.
    geoms, _ = read_osm(tile, "points", "highway = 'street_lamp'", ["highway"], margin=0.0005)
    cls = np.asarray(Image.open(tile.out("dlm", f"landcover_{tile.id}.png")).convert("L"))
    ch, cw = cls.shape
    xmin, ymin, xmax, ymax = tile.bounds
    features = []
    for g in geoms:
        x, y = shapely.get_x(g), shapely.get_y(g)
        if xmin <= x <= xmax and ymin <= y <= ymax:
            c = min(int((x - xmin) / (xmax - xmin) * cw), cw - 1)
            r = min(int((ymax - y) / (ymax - ymin) * ch), ch - 1)
            if cls[r, c] in BLOCKED:
                continue
        features.append(
            feature(
                {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
                {"h": round(lamp_height, 1)},
            )
        )
    write_geojson(tile.out("dlm", f"lamps_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    print(f"{tile.id}: {len(features)} lamps")
