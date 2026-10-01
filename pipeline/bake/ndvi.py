"""DOP (RGB + NIR) → a vegetation-vigour raster: NDVI = (NIR − Red) /
(NIR + Red), clamped to 0..1 and stored ×255 in one byte, 1024² over the tile
(≈2 m) — the crown colour and the meadow tint sample it.

A DOP without an infrared band (Bavaria's open DOP40 is RGB only) gets the
same raster from its visible bands: the Green Leaf Index GLI = (2G − R − B)
/ (2G + R + B), mapped onto the NDVI's scale by a line fitted where both
exist (`GLI_SCALE`, `GLI_OFFSET`: Unna's two summer DOP tiles, NRW's RGBI,
r ≈ 0.7 against the NDVI, 85 % agreement on NDVI > 0.3). It tells green
from grey well and vigour from colour less well — the honest second best,
not an NDVI."""

from __future__ import annotations

import numpy as np
import rasterio
from rasterio.enums import Resampling

from .common import Tile, save_grey_png

# GLI → NDVI scale, fitted on NRW's summer RGBI (see the module docstring)
GLI_SCALE = 3.3
GLI_OFFSET = 0.14


def gli_raster(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> np.ndarray:
    """The visible-band stand-in for the NDVI, on its 0..255 scale."""
    gli = (2 * green - red - blue) / (2 * green + red + blue + 1.0)
    return (np.clip(GLI_SCALE * gli + GLI_OFFSET, 0.0, 1.0) * 255.0).astype(np.uint8)


def rgb_raster(tile: Tile, px: int) -> np.ndarray:
    with rasterio.open(tile.raw_raster("dop")) as dop:
        red, green, blue = (
            dop.read(band, out_shape=(px, px), resampling=Resampling.bilinear).astype(np.float64)
            for band in (1, 2, 3)
        )
    return gli_raster(red, green, blue)


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
    with rasterio.open(tile.raw_raster("dop")) as dop:
        bands = dop.count
    if bands < 3:
        print(f"{tile.id}: the DOP has {bands} band(s) — skipping NDVI")
        return
    if bands < 4:
        save_grey_png(tile.out("dlm", f"ndvi_{tile.id}.png"), rgb_raster(tile, px))
        print(f"{tile.id}: no infrared band — vegetation index from RGB (GLI) {px}²")
        return
    save_grey_png(tile.out("dlm", f"ndvi_{tile.id}.png"), ndvi_raster(tile, px))
    print(f"{tile.id}: NDVI {px}²")
