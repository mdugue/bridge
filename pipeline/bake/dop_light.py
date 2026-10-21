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
  whose shadows of the LoD2 roofs over the DGM best match the image's —
  searched along the solar path of the flight's day (`solar_path`) where
  the fetch has the date (`flight_days`), so a fit can no longer land on a
  sun the day never had (Dresden's 33416_5654 fitted 29° where the sun
  stood 38.5° at that azimuth; 33416_5656 ran into the search's 20° floor),
  and with its contrast against the opposite sun's, which tells a fit from
  a guess;
- `pooled_sun`: the flight's sun from the shadows of all its tiles at once,
  for a tile whose own fit is a guess;
- `incidence_gain`: what scales a sunlit texel on a face of a given
  normal to how a flat roof in sun would read it.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

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
# Along the flight day's solar path the sun is searched every PATH_STEP
# minutes, then every PATH_FINE round the best.
PATH_STEP = 10
PATH_FINE = 2
# A fit is the tile's own when its shadows agree this many times better
# than the opposite sun's (same elevation, azimuth + 180°): a sunny
# flight's shadows fall on one side of the buildings only. Under it the
# agreement is mostly the courtyards' and the narrow streets', which
# either sun darkens (Dresden's 33416_5656, its east all fields: 1.5 along
# the day's path), and the flight's pooled sun is taken instead.
MIN_SUN_CONTRAST = 2.8
# Sun and sky over the sky alone (`light_ratio`) under this: the flight
# was overcast (Meißen's, 1.87), the light as good as diffuse — no face is
# lit more or less by its slope, none lies in its own shadow.
OVERCAST_RATIO = 2.0
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


@dataclass(frozen=True)
class SunFit:
    """A fitted sun: azimuth and elevation (degrees), the shadows'
    agreement (`fit`, intersection over union on the open ground), its
    `contrast` over the opposite sun's, and the time it stood there where
    it was searched along a day's path (UTC)."""

    az: float
    el: float
    fit: float
    contrast: float
    when: datetime | None = None


class _Shadows:
    """A tile's open ground near the roofs, the image's shadows on it, and
    how a sun's cast shadows agree with them."""

    def __init__(self, shadow: np.ndarray, dsm: np.ndarray, roofs: np.ndarray, res: float):
        m = int(SUN_REACH_M / res)
        self.core = (slice(m, -m), slice(m, -m))
        reach = 2 * int(NEAR_ROOFS_M / res) + 1
        near = Image.fromarray(roofs.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(reach))
        self.ground = (np.asarray(near) > 0)[self.core] & ~roofs[self.core]
        self.seen = shadow[self.core][self.ground]
        self.dsm, self.res = dsm, res

    def usable(self) -> bool:
        return self.ground.sum() >= 100 and self.seen.mean() >= MIN_SHADOW_SHARE

    def counts(self, az: float, el: float) -> tuple[int, int]:
        """Cast and seen shadow's intersection and union."""
        cast = cast_shadow(self.dsm, az, el, self.res)[self.core][self.ground]
        return int((cast & self.seen).sum()), int((cast | self.seen).sum())

    def score(self, az: float, el: float) -> float:
        inter, union = self.counts(az, el)
        return inter / union if union else 0.0


def estimate_sun(
    shadow: np.ndarray,
    dsm: np.ndarray,
    roofs: np.ndarray,
    res: float = SUN_RES_M,
    path: Sequence[tuple[float, float, datetime]] | None = None,
    counts: dict[datetime, tuple[int, int]] | None = None,
) -> SunFit | None:
    """The sun whose shadows of `dsm` on the open ground best match the
    image's `shadow` (all on one grid). With `path` — (az, el, when) along
    the flight day's solar path, `solar_path` — only there: every
    PATH_STEP minutes, then every PATH_FINE round the best (a path made
    PATH_FINE apart); `counts`, when given, takes the agreement
    (intersection, union) at each of those PATH_STEP times, for
    `pooled_sun`. Without a path, a 10°/5° grid over the sky a survey
    flies in, then 2°/1° round its best. Only the ground near the roofs
    counts: trees cast shadows the roof model lacks, and over a park their
    long shadows fitted a sun near the horizon. The agreement stays well
    under one; under MIN_SUN_FIT, or with hardly any shadow, None."""
    ground = _Shadows(shadow, dsm, roofs, res)
    if not ground.usable():
        return None
    if path:
        fit, az, el, when = _along_path(ground, path, counts)
    else:
        fit, az, el = _over_sky(ground)
        when = None
    if fit < MIN_SUN_FIT:
        return None
    opposite = ground.score((az + 180) % 360, el)
    return SunFit(float(az), float(el), fit, fit / max(opposite, 1e-3), when)


def _over_sky(ground: _Shadows) -> tuple[float, float, float]:
    coarse = max(
        (ground.score(az, el), az, el)
        for az in range(90, 271, 10)
        for el in range(MIN_SUN_EL, 66, 5)
    )
    _, az0, el0 = coarse
    return max(
        (ground.score(a, e), a, e)
        for a in range(az0 - 8, az0 + 9, 2)
        for e in range(max(MIN_SUN_EL, el0 - 4), el0 + 5)
    )


def _along_path(ground: _Shadows, path, counts=None) -> tuple[float, float, float, datetime]:
    every = max(1, round(PATH_STEP / PATH_FINE))
    scores: dict[int, float] = {}
    for i in range(0, len(path), every):
        inter, union = ground.counts(*path[i][:2])
        scores[i] = inter / union if union else 0.0
        if counts is not None:
            counts[path[i][2]] = (inter, union)
    coarse = max(scores, key=lambda i: scores[i])
    for i in range(max(0, coarse - every), min(len(path), coarse + every + 1)):
        if i not in scores:
            scores[i] = ground.score(*path[i][:2])
    near = range(max(0, coarse - every), min(len(path), coarse + every + 1))
    best = max(near, key=lambda i: scores[i])
    az, el, when = path[best]
    return scores[best], az, el, when


def pooled_sun(counts: Sequence[dict[datetime, tuple[int, int]]]) -> datetime | None:
    """The time the flight's tiles' shadows, taken together, agree best
    with (their intersections over their unions, summed per time): a
    flight covers a site in a few hours, so this is its middle hour's sun
    — near enough for the slope correction of a tile whose own shadows
    cannot fix it. None without counts or under MIN_SUN_FIT."""
    inter: dict[datetime, int] = {}
    union: dict[datetime, int] = {}
    for c in counts:
        for when, (i, u) in c.items():
            inter[when] = inter.get(when, 0) + i
            union[when] = union.get(when, 0) + u
    scored = [(inter[w] / union[w], w) for w in inter if union[w]]
    if not scored:
        return None
    fit, when = max(scored)
    return when if fit >= MIN_SUN_FIT else None


def solar_position(when: datetime, lon: float, lat: float) -> tuple[float, float]:
    """The sun's azimuth (degrees clockwise from north) and elevation
    (degrees, without refraction) at `when` (UTC) seen from `lon`, `lat`:
    NOAA's solar calculator, good to a few hundredths of a degree."""
    t = when.astimezone(UTC)
    day = datetime(t.year, t.month, t.day, tzinfo=UTC)
    minutes = (t - day).total_seconds() / 60
    jd = day.timestamp() / 86400 + 2440587.5 + minutes / 1440
    jc = (jd - 2451545) / 36525
    l0 = math.radians((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360)
    m = math.radians(357.52911 + jc * (35999.05029 - 0.0001537 * jc))
    e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
    centre = (
        math.sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
        + math.sin(2 * m) * (0.019993 - 0.000101 * jc)
        + math.sin(3 * m) * 0.000289
    )
    omega = math.radians(125.04 - 1934.136 * jc)
    apparent = math.radians(math.degrees(l0) + centre - 0.00569 - 0.00478 * math.sin(omega))
    seconds = 21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))
    obliquity = math.radians(23 + (26 + seconds / 60) / 60 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(obliquity) * math.sin(apparent))
    y = math.tan(obliquity / 2) ** 2
    eq_time = 4 * math.degrees(
        y * math.sin(2 * l0)
        - 2 * e * math.sin(m)
        + 4 * e * y * math.sin(m) * math.cos(2 * l0)
        - 0.5 * y * y * math.sin(4 * l0)
        - 1.25 * e * e * math.sin(2 * m)
    )
    hour = math.radians(((minutes + eq_time + 4 * lon) % 1440) / 4 - 180)
    phi = math.radians(lat)
    el = math.asin(math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(hour))
    az = math.atan2(math.sin(hour), math.cos(hour) * math.sin(phi) - math.tan(decl) * math.cos(phi))
    return (math.degrees(az) + 180) % 360, math.degrees(el)


def solar_path(
    days: Sequence[date], lon: float, lat: float, step: int = PATH_FINE
) -> list[tuple[float, float, datetime]]:
    """(az, el, when) every `step` minutes (UTC) of each of `days` while the
    sun stands at least MIN_SUN_EL high — the suns a flight on those days
    could have been flown in."""
    out = []
    for d in sorted(set(days)):
        start = datetime(d.year, d.month, d.day, tzinfo=UTC)
        for k in range(0, 1440, step):
            when = start + timedelta(minutes=k)
            az, el = solar_position(when, lon, lat)
            if el >= MIN_SUN_EL:
                out.append((az, el, when))
    return out


def flight_file(raw: Path, tile_id: str) -> Path:
    """Where the fetch keeps the tile's flight days (`<raw>/dop/<tile>.flight.json`)."""
    return raw / "dop" / f"{tile_id}.flight.json"


def flight_days(raw: Path, tile_id: str) -> list[date]:
    """The days the tile's orthophoto was flown, as the fetch read them off
    the provider's metadata (providers/<id>.py `flight`); empty when the
    fetch has none — the sun is then searched over the whole sky."""
    path = flight_file(raw, tile_id)
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text())
        return [date.fromisoformat(d) for d in doc.get("days", [])]
    except (ValueError, TypeError):
        return []


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
