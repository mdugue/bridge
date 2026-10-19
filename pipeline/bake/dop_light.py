"""The light the orthophoto was flown in, so a roof's colour can be read
from it without its shadows and its slope's shading (roof_colour.py).

An orthophoto is flown in sun: a pitched roof's face turned from the sun,
or one a taller neighbour shades, reads three to five times darker and
bluer (skylight alone) than the same tiles in sun, and a face turned to
the sun brighter than a flat roof. A median over a whole roof therefore
painted the Frauenkirche's dome slate grey and half the Altstadt's red
roofs brown. Here:

- `shadow_mask`: the texels in shadow, dark and bluish (skylight);
- `light_ratio`: how much brighter sun and sky are than the sky alone,
  read across the shadows' edges;
- `estimate_sun`: the sun's azimuth and elevation at the flight, the one
  whose shadows of the LoD2 roofs over the DGM best match the image's;
- `incidence_gain`: what scales a sunlit texel on a face of a given
  normal to how a flat roof in sun would read it.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# Shadow in an 8-bit sRGB DOP: skylight is blue (B well over R) and dim,
# or the texel is simply very dark. Lit dark roofs (slate, bitumen) stay
# grey, B ≈ R.
SHADOW_BLUE = 1.3
SHADOW_DIM = 110
SHADOW_DARK = 40
# The sun search: the raster's metres per texel and how far a shadow is
# followed (m); the coarse grid, then a finer one round its best.
SUN_RES_M = 2.0
SUN_REACH_M = 120.0
# Under this share of shadow, or this agreement, the flight is taken as
# overcast or the fit as failed: no slope correction.
MIN_SHADOW_SHARE = 0.03
# The sun is fitted on the ground this near a roof (m), and no lower than
# this (degrees): aerial surveys fly in a high sun.
NEAR_ROOFS_M = 25.0
MIN_SUN_EL = 20
MIN_SUN_FIT = 0.15
# The slope correction stays within these: a face lit at a grazing angle
# reads too dark to scale up much without its noise.
GAIN_MIN = 0.7
GAIN_MAX = 1.4


def luminance(rgb8: np.ndarray) -> np.ndarray:
    """Rec. 709 luminance of 8-bit sRGB texels (…, 3), on the sRGB scale."""
    return rgb8[..., 0] * 0.2126 + rgb8[..., 1] * 0.7152 + rgb8[..., 2] * 0.0722


def shadow_mask(rgb8: np.ndarray, rows: int = 1000) -> np.ndarray:
    """The texels in shadow of an (h, w, 3) 8-bit DOP, in row blocks (a
    full tile's floats would take gigabytes)."""
    out = np.zeros(rgb8.shape[:2], bool)
    for r in range(0, rgb8.shape[0], rows):
        block = rgb8[r : r + rows].astype(np.float32)
        lum = luminance(block)
        blue = block[..., 2] > SHADOW_BLUE * block[..., 0]
        out[r : r + rows] = (blue & (lum < SHADOW_DIM)) | (lum < SHADOW_DARK)
    return out


def _linear(srgb: np.ndarray) -> np.ndarray:
    c = srgb / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def light_ratio(rgb8: np.ndarray, shadow: np.ndarray) -> float | None:
    """Sun and sky over sky alone (linear luminance): the median texel a
    little outside the shadows' edges over the median a little inside —
    the same ground, mostly, either side. None without shadows."""
    sm = Image.fromarray(shadow.astype(np.uint8) * 255)
    inner = np.asarray(sm.filter(ImageFilter.MinFilter(3))) > 0
    deep = np.asarray(sm.filter(ImageFilter.MinFilter(5))) > 0
    outer = np.asarray(sm.filter(ImageFilter.MaxFilter(3))) > 0
    wide = np.asarray(sm.filter(ImageFilter.MaxFilter(5))) > 0
    inside = inner & ~deep
    outside = wide & ~outer
    if inside.sum() < 100 or outside.sum() < 100:
        return None
    lum = _linear(luminance(rgb8.astype(np.float32)))
    lit, dark = float(np.median(lum[outside])), float(np.median(lum[inside]))
    return lit / dark if dark > 0 and lit > dark else None


def roof_surface_model(dgm: np.ndarray, faces, to_px) -> tuple[np.ndarray, np.ndarray]:
    """The DGM raised to the LoD2 roofs (each face at its mean height, the
    higher drawn last) and the roofs' footprint, both on the DGM's grid.
    `faces` are lists of (x, y, z); `to_px` maps (x, y) to (col, row)."""
    h, w = dgm.shape
    roofs = Image.new("F", (w, h), -1e4)
    foot = Image.new("L", (w, h), 0)
    dr, df = ImageDraw.Draw(roofs), ImageDraw.Draw(foot)
    for pts in sorted(faces, key=lambda f: max(p[2] for p in f)):
        xy = [to_px(x, y) for x, y, _ in pts]
        dr.polygon(xy, fill=float(sum(p[2] for p in pts) / len(pts)))
        df.polygon(xy, fill=255)
    return np.maximum(dgm, np.asarray(roofs)), np.asarray(foot) > 0


def cast_shadow(dsm: np.ndarray, az: float, el: float, res: float) -> np.ndarray:
    """Where a surface model shades itself from a sun at azimuth `az`
    (clockwise from north) and elevation `el` (degrees)."""
    h, w = dsm.shape
    east, north = math.sin(math.radians(az)), math.cos(math.radians(az))
    rise = math.tan(math.radians(el)) * res
    out = np.zeros(dsm.shape, bool)
    for s in range(1, int(SUN_REACH_M / res)):
        dc, dr = round(east * s), round(-north * s)
        if abs(dc) >= w or abs(dr) >= h:
            break
        # the surface s steps towards the sun, over each texel
        ahead = np.full(dsm.shape, -1e4, np.float32)
        ahead[max(0, -dr) : h - max(0, dr), max(0, -dc) : w - max(0, dc)] = dsm[
            max(0, dr) : h - max(0, -dr), max(0, dc) : w - max(0, -dc)
        ]
        out |= ahead - s * rise > dsm + 0.5
    return out


def estimate_sun(
    shadow: np.ndarray, dsm: np.ndarray, roofs: np.ndarray, res: float = SUN_RES_M
) -> tuple[float, float] | None:
    """The sun (azimuth, elevation in degrees) whose shadows of `dsm` on
    the open ground best match the image's `shadow` (all on one grid):
    a 10°/5° grid over the sky a survey flies in, then 2°/1° round its
    best. Only the ground near the roofs counts: trees cast shadows the
    roof model lacks, and over a park their long shadows fitted a sun
    near the horizon. The agreement stays well under one; under
    MIN_SUN_FIT, or with hardly any shadow, None."""
    m = int(SUN_REACH_M / res)
    core = (slice(m, -m), slice(m, -m))
    reach = 2 * int(NEAR_ROOFS_M / res) + 1
    near = Image.fromarray(roofs.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(reach))
    open_ground = (np.asarray(near) > 0)[core] & ~roofs[core]
    if open_ground.sum() < 100 or shadow[core][open_ground].mean() < MIN_SHADOW_SHARE:
        return None

    def score(az, el):
        cast = cast_shadow(dsm, az, el, res)[core][open_ground]
        seen = shadow[core][open_ground]
        union = (cast | seen).sum()
        return float((cast & seen).sum() / union) if union else 0.0

    coarse = max(
        (score(az, el), az, el) for az in range(90, 271, 10) for el in range(MIN_SUN_EL, 66, 5)
    )
    _, az0, el0 = coarse
    fit, az, el = max(
        (score(a, e), a, e)
        for a in range(az0 - 8, az0 + 9, 2)
        for e in range(max(MIN_SUN_EL, el0 - 4), el0 + 5)
    )
    return (float(az), float(el)) if fit >= MIN_SUN_FIT else None


def sun_vector(az: float, el: float) -> tuple[float, float, float]:
    """Towards the sun, east-north-up."""
    a, e = math.radians(az), math.radians(el)
    return (math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e))


def incidence_gain(normal, sun: tuple[float, float, float] | None, ratio: float | None) -> float:
    """What scales a sunlit texel on a face of `normal` (unit, east-north-
    up) to how a flat roof in the same sun reads: sun and sky over sun and
    sky on the flat, the sun's share from `ratio` (`light_ratio`).
    Clamped to GAIN_MIN…GAIN_MAX; 1 without a sun or a ratio."""
    if sun is None or ratio is None or sun[2] <= 0:
        return 1.0
    direct = (ratio - 1) / sun[2]  # the sun's irradiance over the sky's
    cos = max(0.0, sum(n * s for n, s in zip(normal, sun, strict=True)))
    gain = (direct * sun[2] + 1) / (direct * cos + 1)
    return min(GAIN_MAX, max(GAIN_MIN, gain))
