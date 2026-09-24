"""DOP (RGB + NIR) → a vegetation-vigour raster: NDVI = (NIR − Red) /
(NIR + Red), clamped to 0..1 and stored ×255 in one byte, 1024² over the tile
(≈2 m) — the crown colour and the meadow tint sample it."""

from __future__ import annotations

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

from .common import Tile


def ndvi_raster(tile: Tile, px: int) -> np.ndarray:
    with rasterio.open(tile.raw_raster("dop")) as dop:
        red, nir = (
            dop.read(band, out_shape=(px, px), resampling=Resampling.bilinear).astype(np.float64)
            for band in (1, 4)
        )
    ndvi = (nir - red) / (nir + red + 1.0)
    return (np.clip(ndvi, 0.0, None) * 255.0).astype(np.uint8)


def run(tile: Tile, px: int = 1024) -> None:
    if not tile.raw_raster("dop").exists():
        print(f"{tile.id}: no DOP — skipping NDVI (crowns keep the hash sage)")
        return
    Image.fromarray(ndvi_raster(tile, px), mode="L").save(tile.out("dlm", f"ndvi_{tile.id}.png"))
    print(f"{tile.id}: NDVI {px}²")
