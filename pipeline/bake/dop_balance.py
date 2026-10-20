"""Each flight's colour cast, read off its carriageways and taken out.

The orthophotos are flown on other days, with other cameras, and processed
apart, and every colour read off them carries the flight's cast: Leipzig's
is cyan (its sunlit carriageways read r/g 0.79, b/g 1.15 in linear RGB,
Dresden's 0.95 and 0.94), so its grey roofs came out blue-green, and
München's yellow (b/g 0.82). Hamburg, Unna, Meißen and Grimma lie within
8 % of Dresden. It is the flight, not the asphalt: the grey pixels of the
whole photo (its sunlit texels within 12 % of grey, roofs, pavements and
gravel among them) give the same cast to 3 %.

So the site's sunlit carriageways — the class raster's roads, the brighter
half of their texels (the darker half is in shade, blue with sky light),
pooled over all its tiles, since a flight covers the site — are scaled to
Dresden's chromaticity, per channel in linear RGB. Their brightness is
kept: the flight's exposure is its own (asphalt's lightness varies more
than its hue). `gains` is identity where too few road texels are seen;
`balanced` applies them to the 8-bit photo, so its shadows are found in
it too (a blue cast reads as shade)."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import rasterio
from rasterio.enums import Resampling

from .common import Tile

ROAD = 7  # the class raster's road (landcover.py CLASSES)
# Dresden's sunlit carriageways' median, linear RGB, over green: its own
# flight keeps its colours
REF_ROAD = (0.950, 1.0, 0.938)
MIN_TEXELS = 5000  # pooled road texels the site needs
KEEP = 50_000  # texels a tile contributes
_ROADS: dict[tuple, np.ndarray | None] = {}


def linear(srgb: np.ndarray) -> np.ndarray:
    """8-bit sRGB values (as floats) in linear light, 0..1."""
    c = srgb / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def road_texels(tile: Tile) -> np.ndarray | None:
    """The tile's sunlit carriageway texels (linear RGB, n × 3, at most
    KEEP), or None without a DOP or a class raster; once per process."""
    key = (tile.raw_raster("dop"), tile.id)
    if key not in _ROADS:
        _ROADS[key] = _measure(tile)
    return _ROADS[key]


def _measure(tile: Tile) -> np.ndarray | None:
    cls = tile.classes()
    if cls is None or not tile.raw_raster("dop").exists():
        return None
    with rasterio.open(tile.raw_raster("dop")) as dop:
        if dop.count < 3:
            return None
        rgb = dop.read((1, 2, 3), out_shape=(3, *cls.shape), resampling=Resampling.average)
    texels = linear(rgb[:, cls == ROAD].T.astype(np.float32))
    if len(texels) == 0:
        return None
    lum = texels.mean(axis=1)
    sunlit = texels[lum >= np.median(lum)]
    if len(sunlit) > KEEP:
        sunlit = sunlit[np.random.default_rng(0).choice(len(sunlit), KEEP, replace=False)]
    return sunlit


def cast(tiles: Sequence[Tile]) -> np.ndarray | None:
    """The site's sunlit carriageways' median (linear RGB) over green, or
    None under MIN_TEXELS."""
    found = [t for t in (road_texels(tile) for tile in tiles) if t is not None]
    texels = np.concatenate(found) if found else np.zeros((0, 3), np.float32)
    if len(texels) < MIN_TEXELS:
        return None
    median = np.median(texels, axis=0)
    return median / median[1]


def gains(tiles: Sequence[Tile]) -> np.ndarray:
    """Per-channel factors (linear RGB) taking the site's cast to Dresden's,
    their mean over the roads' colour 1 (the brightness kept); ones when
    the cast cannot be read."""
    seen = cast(tiles)
    if seen is None:
        return np.ones(3, np.float32)
    k = np.asarray(REF_ROAD) / seen
    return (k * seen.sum() / (k * seen).sum()).astype(np.float32)


def table(k: np.ndarray) -> np.ndarray:
    """The 8-bit sRGB → 8-bit sRGB lookup of each channel (3 × 256) that
    scales its linear value by `k`."""
    c = linear(np.arange(256, dtype=np.float64))[None, :] * np.asarray(k, np.float64)[:, None]
    c = np.clip(c, 0.0, 1.0)
    srgb = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
    return np.round(srgb * 255).astype(np.uint8)


def balanced(rgb8: np.ndarray, lut: np.ndarray, axis: int = -1) -> np.ndarray:
    """`rgb8` with each channel (along `axis`) through its row of `lut`, in
    place."""
    view = np.moveaxis(rgb8, axis, 0)
    for c in range(3):
        view[c] = lut[c][view[c]]
    return rgb8
