"""How far the orthophoto leans each building's roof off its footprint, so
roof_colour.py reads a roof's texels where the image shows the roof.

A DOP is no true orthophoto: each strip is a central projection, and a
roof shows shifted away from the strip's flight line by its height over
the ground times the off-nadir angle — at Dresden up to 0.15 m per metre,
a 30 m roof four to five metres off its LoD2 outline. A roof's samples
then took in the street and the shadow beside it (the Schauspielhaus read
beige). The shift per metre of height, the lean `k` (east, north), is the
same for every building near another on one strip and changes smoothly
with the distance from its flight line, then jumps at a seam between
strips.

- `lean_map`: for one tall building, how well the shading its roof faces
  should show in the flight's sun (bright to the sun, dark from it)
  matches the image, for every shift of its outline: a ridge's bright and
  dark sides are the roof's own, where its outline alone also matches
  neighbours and shadow edges;
- `fit_leans`: the lean on a grid over the tile, each node the one lean
  that agrees best with every tall building near it (a single building's
  best shift is often a neighbour's roof), then each building's from the
  nodes near it, the one its own map likes best (so a building by a seam
  takes its own strip's).
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import fft

# The lean searched, metres of shift per metre of height, and its step.
LEAN_MAX = 0.35
LEAN_STEP = 0.01
# Buildings this tall (m) and with this many roof texels measure the lean.
LEAN_MIN_HEIGHT = 10.0
LEAN_MIN_TEXELS = 200
# A map's shifts step this many texels; a map reads at most this many.
MAP_STEP = 2
MAP_SAMPLES = 4000
# A shift whose samples vary less than this (luminance², 0…255) shows
# nothing to match.
VAR_MIN = 1e-6
# The grid's spacing, how far a node gathers buildings, how many it needs,
# and how far a building looks for nodes (m).
CELL_M = 125.0
REACH_M = 250.0
MIN_BUILDINGS = 5
CHOICE_M = 300.0
# A node no neighbour agrees with to within this lean is dropped: the
# lean changes smoothly but at a seam, and a seam runs between several.
AGREE = 0.06


def reach_px(height: float, px: float) -> int:
    """The shift a building of `height` is searched over (texels, even)."""
    s = int(math.ceil(LEAN_MAX * height / px))
    return s + s % 2


def shading_samples(shape, faces, sun):
    """The texels (rows, cols) of a crop of `shape` a roof's expected
    shading is matched at, at most about MAP_SAMPLES of them, and that
    shading there, normalised; None when the roof shows no shading to match
    (flat, small). `faces`: (ring in crop texels, unit normal east-north-
    up)."""
    h, w = shape
    expected = Image.new("F", (w, h), -1.0)
    draw = ImageDraw.Draw(expected)
    for ring, normal in faces:
        cos = max(0.0, sum(n * s for n, s in zip(normal, sun, strict=True)))
        draw.polygon(ring, fill=float(cos))
    e = np.asarray(expected)
    rows, cols = np.nonzero(e >= 0)
    if len(rows) < LEAN_MIN_TEXELS:
        return None
    pick = slice(None, None, max(1, len(rows) // MAP_SAMPLES))
    rows, cols, ev = rows[pick], cols[pick], e[rows, cols][pick]
    if ev.std() < 0.05:
        return None
    return rows, cols, (ev - ev.mean()) / ev.std()


def lean_map(lum: np.ndarray, faces, sun, reach: int) -> np.ndarray | None:
    """Correlation of a building's expected roof shading with `lum` (a crop
    with `reach` texels of margin round the roof) for every shift
    (dy, dx) in -reach…reach by MAP_STEP, as a square array (NaN where
    nothing was read). `faces`: (ring in crop texels, unit normal east-
    north-up). None when the roof shows no shading to match (flat, small)."""
    picked = shading_samples(lum.shape, faces, sun)
    if picked is None:
        return None
    rows, cols, ev = picked
    h, w = lum.shape
    # A shift's score is the mean over the samples it keeps inside the crop
    # of ev · (seen − mean) / std, which is (Σ ev·L − mean · Σ ev) / (n · std)
    # with mean and std from Σ L and Σ L² over those n samples: five sums
    # over the samples for every shift, each a correlation of the crop with
    # the samples placed in it, all shifts at once by FFT. Padded by the
    # reach, no shift wraps round. In float64, they agree with the direct
    # float32 sums to 2e-6 (dop_lean's test).
    size = (fft.next_fast_len(h + reach, real=True), fft.next_fast_len(w + reach, real=True))
    placed = np.zeros((2, h, w))
    placed[0, rows, cols] = ev
    placed[1, rows, cols] = 1.0
    crop = lum.astype(np.float64)
    seen = fft.rfft2(np.stack([crop, np.ones_like(crop), crop * crop]), s=size)
    by = np.conj(fft.rfft2(placed, s=size))
    pairs = ((0, 0), (0, 1), (1, 0), (1, 1), (1, 2))
    sums = fft.irfft2(np.stack([by[k] * seen[f] for k, f in pairs]), s=size)
    shifts = np.arange(-reach, reach + 1, MAP_STEP)
    at = np.ix_(shifts % size[0], shifts % size[1])
    ev_l, ev_n, l1, n, l2 = (s[at] for s in sums)
    n = np.rint(n)
    with np.errstate(divide="ignore", invalid="ignore"):
        mean = l1 / n
        var = l2 / n - mean * mean
        score = (ev_l - mean * ev_n) / (n * np.sqrt(np.maximum(var, 0.0)))
    # too few samples inside the crop, or a crop that shows no shading
    # (a uniform patch's variance is rounding, of the order of 1e-11)
    read = (n >= LEAN_MIN_TEXELS) & (var > VAR_MIN)
    return np.where(read, score, np.nan).astype(np.float32)


class Sample:
    """One tall building's lean map, at its place (m) and height."""

    def __init__(self, x: float, y: float, height: float, grid: np.ndarray, reach: int, px: float):
        self.x, self.y, self.height = x, y, height
        self.grid, self.reach, self.px = grid, reach, px

    def scores(self, ks: np.ndarray) -> np.ndarray:
        """The map at every lean (ky, kx) of `ks` × `ks`, NaN outside it."""
        step = self.px * MAP_STEP
        half = self.reach // MAP_STEP
        cols = np.rint(ks * self.height / step).astype(int) + half
        rows = np.rint(-ks * self.height / step).astype(int) + half
        n = self.grid.shape[0]
        ok_r, ok_c = (rows >= 0) & (rows < n), (cols >= 0) & (cols < n)
        out = np.full((len(ks), len(ks)), np.nan, np.float32)
        out[np.ix_(ok_r, ok_c)] = self.grid[np.ix_(rows[ok_r], cols[ok_c])]
        return out

    def score(self, k) -> float:
        step = self.px * MAP_STEP
        half = self.reach // MAP_STEP
        c = round(k[0] * self.height / step) + half
        r = round(-k[1] * self.height / step) + half
        n = self.grid.shape[0]
        v = self.grid[r, c] if 0 <= r < n and 0 <= c < n else np.nan
        return -math.inf if np.isnan(v) else float(v)


def _node_lean(samples, ks) -> tuple[float, float] | None:
    total = np.zeros((len(ks), len(ks)))
    count = np.zeros_like(total)
    for s in samples:
        sc = s.scores(ks)
        ok = ~np.isnan(sc)
        total[ok] += sc[ok]
        count[ok] += 1
    if count.max() < MIN_BUILDINGS:
        return None
    # leans only some buildings could be shifted by are not compared
    mean = np.where(count >= 0.8 * count.max(), total / np.maximum(count, 1), -np.inf)
    i, j = np.unravel_index(int(np.argmax(mean)), mean.shape)
    return float(ks[j]), float(ks[i])


def fit_leans(samples, bounds) -> list[tuple[float, float, tuple[float, float]]]:
    """The lean (east, north) at the nodes of a CELL_M grid over `bounds`
    (xmin, ymin, xmax, ymax), as (x, y, lean); a node with fewer than
    MIN_BUILDINGS tall buildings within REACH_M has none, nor one no
    neighbour agrees with (AGREE)."""
    ks = np.arange(-LEAN_MAX, LEAN_MAX + LEAN_STEP / 2, LEAN_STEP)
    xmin, ymin, xmax, ymax = bounds
    nodes = []
    for x in np.arange(xmin + CELL_M / 2, xmax, CELL_M):
        for y in np.arange(ymin + CELL_M / 2, ymax, CELL_M):
            near = [s for s in samples if (s.x - x) ** 2 + (s.y - y) ** 2 <= REACH_M**2]
            k = _node_lean(near, ks) if near else None
            if k is not None:
                nodes.append((float(x), float(y), k))
    return [n for n in nodes if _agreed(n, nodes)]


def _agreed(node, nodes) -> bool:
    x, y, k = node
    near = [
        m
        for m in nodes
        if m is not node and (m[0] - x) ** 2 + (m[1] - y) ** 2 <= (1.5 * CELL_M) ** 2
    ]
    return not near or any(max(abs(m[2][0] - k[0]), abs(m[2][1] - k[1])) <= AGREE for m in near)


def building_lean(nodes, x: float, y: float, sample: Sample | None) -> tuple[float, float]:
    """A building's lean: of the nodes within CHOICE_M, the one its own map
    likes best, or the nearest node's without a map; none without nodes."""
    if not nodes:
        return (0.0, 0.0)
    dist = [(nx - x) ** 2 + (ny - y) ** 2 for nx, ny, _ in nodes]
    nearest = nodes[int(np.argmin(dist))][2]
    if sample is None:
        return nearest
    near = [k for (_, _, k), d in zip(nodes, dist, strict=True) if d <= CHOICE_M**2]
    best = max(near, key=sample.score, default=nearest)
    return best if sample.score(best) > -math.inf else nearest
