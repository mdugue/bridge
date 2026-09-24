"""DOM1 − DGM1 → tree canopy points. One tree per `cell` metres at the
tallest canopy texel between 3 and 45 m, only inside forest, copse or park
(rasterised from the DLM), never on rail, path, road or water (the class
raster — the gate that stopped trees growing through bridge decks)."""

from __future__ import annotations

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import rasterize

from . import landcover_osm
from .common import Tile, feature, read_layer, write_geojson

MIN_H, MAX_H = 3.0, 45.0
BLOCKED = (5, 6, 7, 8)  # railway, path, road, water
WOODED = (2, 3)  # forest, copse
PARK = "OBJART_TXT='AX_SportFreizeitUndErholungsflaeche'"


def vegetation_mask(tile: Tile, px: int) -> np.ndarray:
    """Forest, copse and parks: from the Basis-DLM, or without one from the
    class raster's forest and copse plus OSM's parks."""
    if tile.products.dlm:
        geoms = [
            *read_layer(tile.dlm / "veg02_f.shp", tile.bounds)[0],
            *read_layer(tile.dlm / "veg03_f.shp", tile.bounds)[0],
            *read_layer(tile.dlm / "sie02_f.shp", tile.bounds, where=PARK)[0],
        ]
    else:
        geoms = landcover_osm.parks(tile)
    mask = np.zeros((px, px), dtype=np.uint8)
    if geoms:
        rasterize(((g, 1) for g in geoms), out=mask, transform=tile.transform(px))
    if not tile.products.dlm:
        mask |= np.isin(class_raster_at(tile, (px, px)), WOODED).astype(np.uint8)
    return mask


def class_raster_at(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """The baked class raster, nearest-sampled onto `shape`."""
    cls = np.asarray(Image.open(tile.out("dlm", f"landcover_{tile.id}.png")).convert("L"))
    rows = np.minimum((np.arange(shape[0]) * cls.shape[0]) // shape[0], cls.shape[0] - 1)
    cols = np.minimum((np.arange(shape[1]) * cls.shape[1]) // shape[1], cls.shape[1] - 1)
    return cls[np.ix_(rows, cols)]


def blocked_mask(tile: Tile, shape: tuple[int, int]) -> np.ndarray:
    """The class raster's blocked classes, nearest-sampled onto `shape`."""
    return np.isin(class_raster_at(tile, shape), BLOCKED)


def canopy_points(tile: Tile, cell: int) -> list[dict]:
    with rasterio.open(tile.raw_raster("dom1")) as dom, rasterio.open(tile.dgm) as dgm:
        ndom = dom.read(1).astype(np.float64) - dgm.read(1).astype(np.float64)
    h, w = ndom.shape
    ok = (vegetation_mask(tile, w) == 1) & ~blocked_mask(tile, ndom.shape)
    ok &= (ndom > MIN_H) & (ndom < MAX_H)
    heights = np.where(ok, ndom, -1.0)
    xmin, _, _, ymax = tile.bounds
    features = []
    for r0 in range(0, h, cell):
        for c0 in range(0, w, cell):
            block = heights[r0 : r0 + cell, c0 : c0 + cell]
            # The first maximum in row-major order, like the scan it replaces.
            i = int(np.argmax(block))
            best = block.flat[i]
            if best < 0:
                continue
            r, c = divmod(i, block.shape[1])
            x = xmin + c0 + c + 0.5
            y = ymax - (r0 + r) - 0.5
            features.append(
                feature(
                    {"type": "Point", "coordinates": [round(x, 1), round(y, 1)]},
                    {"h": round(float(best), 1)},
                )
            )
    return features


def run(tile: Tile, cell: int = 7) -> None:
    if not tile.raw_raster("dom1").exists():
        print(f"{tile.id}: no surface model — skipping the canopy (trees from rows only)")
        return
    features = canopy_points(tile, cell)
    write_geojson(tile.out("dlm", f"canopy_{tile.id}.geojson"), features, tile.epsg)
    print(f"{tile.id}: {len(features)} canopy trees")
