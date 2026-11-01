"""A mural's photo redrawn as a pen-and-wash drawing (murals.py): the scene
is a pastel clay model, and a photograph on one of its walls broke it —
its own light, its grain, its contrast. What the viewer paints instead is
what an illustrator would draw after the photo: pen lines in one dark ink
over a light wash of the mural's own colours, lifted into the clay's
register (light, muted). Nothing per mural: the same steps for every one.

1. **Calm the photo.** Its own light comes out first (the large swings in
   lightness, `LIGHT_SIGMA` of its height), then an edge-keeping smoothing
   (a guided filter, `GUIDE_R`, `GUIDE_EPS`) takes its grain and keeps its
   drawing.
2. **The pen lines** are the calmed lightness's difference of Gaussians,
   thresholded softly (XDoG: `LINE_SIGMA`, `LINE_TAU`, `LINE_EPS`,
   `LINE_PHI`); a fleck of ink with too little ink around it (`SPECK`) is
   grain, not drawing, and is dropped.
3. **The wash** is the mural's own colours: its calmed photo sorted into
   `COLOURS` fields (k-means in CIELAB, seeded: the same photo always
   draws the same), each field's colour lifted (`WASH_L`) and muted
   (`WASH_CHROMA`), a speck of a field merged into its surroundings, the
   edges soft. It is kept at `WASH_PX_PER_M`: a wash needs no more.
4. **The ink** is the mural's darkest field, muted and darkened (`INK_L`).

The viewer multiplies the wall's own lit colour by the drawing
(mural-layer.ts): the wall's light, shadow and night carry over it.

Pure numpy: no image library beyond reading and writing the files.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# 1. calming
LIGHT_SIGMA = 0.5  # × the image's height: the photo's own light
LIGHT_KEEP = 0.3  # of those swings kept
GUIDE_R = 2  # px
GUIDE_EPS = 0.004
# 2. the pen lines
LINE_SIGMA = 0.9  # px
LINE_K = 1.6
LINE_TAU = 0.98
LINE_EPS = 0.012
LINE_PHI = 45.0
LINE_SOFT = 0.45  # px: the line's anti-aliasing
SPECK = 5  # a fleck with fewer ink pixels than this around it (5 × 5) goes
# 3. the wash
COLOURS = 5
KMEANS_SAMPLE = 60_000
KMEANS_ITERATIONS = 25
SEED = 0
MODAL_PX = 5
WASH_L = (64.0, 96.0)  # CIELAB lightness the fields span
WASH_CHROMA = 0.75
WASH_PAPER = 0.4  # the clay's share in the wash
WASH_PX_PER_M = 12
# 4. the ink
INK_L = (20.0, 60.0)
INK_CHROMA = 0.5

# The clay's base colour (sRGB; app/_components/visual-style.ts CLAY_BASE):
# the drawing's paper. The viewer divides by it, so paper is the wall.
CLAY = np.array([0xEC, 0xE7, 0xDF]) / 255.0


@dataclass(frozen=True)
class Drawing:
    lines: np.ndarray  # uint8 (h, w): 255 paper, 0 ink
    wash: np.ndarray  # uint8 (h', w', 3) sRGB, at WASH_PX_PER_M
    ink: tuple[int, int, int]  # sRGB


# --- colour -----------------------------------------------------------------


def _linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _gamma(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


_M = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)
_WHITE = np.array([0.95047, 1.0, 1.08883])


def to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB in [0, 1] → CIELAB (D65)."""
    xyz = _linear(rgb) @ _M.T / _WHITE
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack(
        [116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1
    )


def to_rgb(lab: np.ndarray) -> np.ndarray:
    """CIELAB (D65) → sRGB in [0, 1], clipped."""
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], -1)
    xyz = np.where(f > 6 / 29, f**3, 3 * (6 / 29) ** 2 * (f - 4 / 29)) * _WHITE
    return _gamma(xyz @ np.linalg.inv(_M).T)


def lifted(lab: np.ndarray, span: tuple[float, float], chroma: float) -> np.ndarray:
    """Lightness compressed into `span`, colour muted by `chroma`."""
    out = np.array(lab, dtype=float)
    out[..., 0] = span[0] + (span[1] - span[0]) * np.clip(out[..., 0] / 100, 0, 1)
    out[..., 1:] *= chroma
    return out


# --- filters ----------------------------------------------------------------


def gaussian(img: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur over the first two axes, edges reflected."""
    if sigma <= 0:
        return img
    r = max(1, int(3 * sigma + 0.5))
    x = np.arange(-r, r + 1)
    k = np.exp(-(x**2) / (2 * sigma**2))
    k /= k.sum()
    out = img.astype(float)
    for axis in (0, 1):
        r_eff = min(r, out.shape[axis] - 1)
        kk = k[r - r_eff : r + r_eff + 1]
        kk = kk / kk.sum()
        pad = [(0, 0)] * out.ndim
        pad[axis] = (r_eff, r_eff)
        p = np.pad(out, pad, mode="reflect")
        acc = np.zeros_like(out)
        for i, w in enumerate(kk):
            sl = [slice(None)] * out.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def box(img: np.ndarray, size: int) -> np.ndarray:
    """Mean over a size × size window (odd), edges repeated."""
    r = size // 2
    p = np.pad(img.astype(float), [(r + 1, r), (r + 1, r)] + [(0, 0)] * (img.ndim - 2), mode="edge")
    c = p.cumsum(0).cumsum(1)
    h, w = img.shape[:2]
    s = (
        c[size : size + h, size : size + w]
        - c[:h, size : size + w]
        - c[size : size + h, :w]
        + c[:h, :w]
    )
    return s / (size * size)


def guided(img: np.ndarray, r: int, eps: float) -> np.ndarray:
    """He's guided filter of a single channel by itself: smooths where it
    varies little, keeps an edge where it varies much."""
    size = 2 * r + 1
    mean = box(img, size)
    var = box(img * img, size) - mean * mean
    a = var / (var + eps)
    b = mean - a * mean
    return box(a, size) * img + box(b, size)


def xdog(gray: np.ndarray) -> np.ndarray:
    """Winnemöller's XDoG: 1 paper, 0 ink, a soft step between."""
    d = gaussian(gray, LINE_SIGMA) - LINE_TAU * gaussian(gray, LINE_SIGMA * LINE_K)
    return np.clip(np.where(d >= LINE_EPS, 1.0, 1.0 + np.tanh(LINE_PHI * (d - LINE_EPS))), 0, 1)


def kmeans(px: np.ndarray, k: int) -> np.ndarray:
    """k-means (k-means++ seeding, a fixed seed) of a sample: the centres."""
    rng = np.random.default_rng(SEED)
    sample = px[rng.choice(len(px), size=min(len(px), KMEANS_SAMPLE), replace=False)]
    centres = [sample[rng.integers(len(sample))]]
    for _ in range(1, k):
        d = np.min([((sample - c) ** 2).sum(1) for c in centres], axis=0)
        centres.append(sample[rng.choice(len(sample), p=d / d.sum())])
    c = np.array(centres)
    for _ in range(KMEANS_ITERATIONS):
        near = ((sample[:, None, :] - c[None]) ** 2).sum(2).argmin(1)
        moved = np.array(
            [sample[near == i].mean(0) if (near == i).any() else c[i] for i in range(k)]
        )
        if np.allclose(moved, c):
            break
        c = moved
    return c


def nearest(px: np.ndarray, centres: np.ndarray) -> np.ndarray:
    return ((px[:, None, :] - centres[None]) ** 2).sum(2).argmin(1)


def modal(labels: np.ndarray, k: int, size: int) -> np.ndarray:
    """Each pixel takes its window's most common field."""
    return np.stack([box((labels == i).astype(float), size) for i in range(k)]).argmax(0)


# --- the drawing ------------------------------------------------------------


def drawing(rgb: np.ndarray, px_per_m: float) -> Drawing:
    """`rgb` (uint8, h × w × 3, the mural's photo at its size) as a drawing."""
    im = rgb.astype(float) / 255
    h, w = im.shape[:2]
    lab = to_lab(im)
    low = gaussian(lab[..., 0], LIGHT_SIGMA * h)
    lab[..., 0] -= (1 - LIGHT_KEEP) * (low - low.mean())
    lightness = np.clip(lab[..., 0] / 100, 0, 1)
    calm = guided(lightness, GUIDE_R, GUIDE_EPS)

    lines = xdog(calm)
    ink_px = lines < 0.5
    alone = box(ink_px.astype(float), 5) * 25 < SPECK
    lines = np.where(ink_px & alone, 1.0, lines)
    lines = gaussian(lines, LINE_SOFT)

    calm_lab = lab.copy()
    calm_lab[..., 0] = calm * 100
    for c in (1, 2):
        calm_lab[..., c] = guided(lab[..., c] / 100, GUIDE_R, GUIDE_EPS) * 100
    flat = calm_lab.reshape(-1, 3)
    centres = kmeans(flat, COLOURS)
    labels = modal(nearest(flat, centres).reshape(h, w), COLOURS, MODAL_PX)
    wash_colours = WASH_PAPER * CLAY + (1 - WASH_PAPER) * to_rgb(
        lifted(centres, WASH_L, WASH_CHROMA)
    )
    weights = np.stack([gaussian((labels == i).astype(float), 1.6) for i in range(COLOURS)])
    wash = np.einsum("khw,kc->hwc", weights / weights.sum(0), wash_colours)
    wash = shrink(wash, max(1, round(w * WASH_PX_PER_M / px_per_m)))

    ink = to_rgb(lifted(centres[np.argmin(centres[:, 0])], INK_L, INK_CHROMA))
    return Drawing(
        lines=np.round(np.clip(lines, 0, 1) * 255).astype(np.uint8),
        wash=np.round(np.clip(wash, 0, 1) * 255).astype(np.uint8),
        ink=tuple(int(round(v * 255)) for v in ink),
    )


def shrink(img: np.ndarray, width: int) -> np.ndarray:
    """Area-averaged downscale to `width` (the height in proportion)."""
    h, w = img.shape[:2]
    height = max(1, round(h * width / w))
    ys = np.linspace(0, h, height + 1).astype(int)
    xs = np.linspace(0, w, width + 1).astype(int)
    rows = np.add.reduceat(img, ys[:-1], axis=0) / np.diff(ys)[:, None, None]
    return np.add.reduceat(rows, xs[:-1], axis=1) / np.diff(xs)[None, :, None]
