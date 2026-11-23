"""Where a wall's window axes stand, from the drives that photographed it
(windows.py's `model["phase"]`).

One drive's pose is off along a wall by ~0.2 m (its reconstruction's GPS),
two drives' by up to a metre: one strip of the wall alone does not say
where its windows are. Every drive sees the same windows, though, so the
strips can be registered to each other, and their errors, one per drive,
average out:

1. `register`: each pair of images of the wall is matched by its jamb
   profile (facade_traits.py `jx`, the vertical edges per 5 cm column) —
   the shift (within `REG_MAX_M`) with the best normalised correlation,
   kept where that is at least `REG_MIN_R` and `REG_MARGIN` above the best
   shift `REG_APART_M` away (a window period's alias).
2. `offsets`: one offset per image, so that each pair's shift is the
   difference of its images' offsets (a robust least squares, Huber at
   `HUBER_M`), over the largest set of images the pairs link; their
   drives' mean offsets average to 0 — each drive's error counts once,
   however many of its images see the wall. At least two images that
   register, of `MIN_DRIVES` drives.
3. `phase`: the openings profiles (`ch`), each moved by its image's
   offset, averaged; a window is a run of it at least half its peak and
   `OPEN_MIN` open, `WINDOW_RUN_M` wide; the axes' phase along the wall
   is the circular mean of their centres modulo the measured axis
   spacing, kept where they agree (`PHASE_R`).

On Dresden's spawn tile (2026-11-01) the drives' offsets have a robust
spread of 0.2 m, the registered pairs close to 1 cm, and where three or
more drives agree the mean's standard error is 0.12 m (median).
Pure, no I/O."""

from __future__ import annotations

import collections
import itertools
import math

import numpy as np

from .facade_traits import JX_M, STEP_M, decode_profile

REG_MAX_M = 2.0  # the largest shift between two drives looked for
REG_MIN_R = 0.5  # a pair's correlation at its shift at least
REG_MARGIN = 0.12  # ... and this much above an alias
REG_APART_M = 0.4  # an alias: a shift this far from the best
MIN_OVERLAP_M = 3.0  # a pair is compared over at least this much wall
HUBER_M = 0.12  # a pair's residual counts in full up to this
MIN_DRIVES = 1  # one drive alone is ~0.2 m off: still nearer than a centred axis
OPEN_MIN = 0.25  # a window's column is at least this open
WINDOW_RUN_M = (0.4, 3.0)
PHASE_R = 0.8  # the window centres agree on the phase this well (0–1)
MIN_WINDOWS = 2


def register(a: np.ndarray, b: np.ndarray) -> tuple[float, float] | None:
    """(shift m, correlation) with a(x + shift) ≈ b(x), or None where no
    shift stands out (see the module)."""
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    least = int(round(MIN_OVERLAP_M / JX_M))
    if n < least:
        return None
    reach = min(int(round(REG_MAX_M / JX_M)), n - least)
    scores = np.full(2 * reach + 1, np.nan)
    for k, s in enumerate(range(-reach, reach + 1)):
        x, y = (a[s:], b[: n - s]) if s >= 0 else (a[:s], b[-s:])
        m = np.isfinite(x) & np.isfinite(y)
        if m.sum() < least:
            continue
        xx, yy = x[m] - x[m].mean(), y[m] - y[m].mean()
        den = math.sqrt(float((xx * xx).sum() * (yy * yy).sum()))
        if den > 0:
            scores[k] = float((xx * yy).sum()) / den
    if not np.isfinite(scores).any():
        return None
    k = int(np.nanargmax(scores))
    best = scores[k]
    apart = np.abs(np.arange(len(scores)) - k) * JX_M > REG_APART_M
    alias = (
        np.nanmax(np.where(apart, scores, np.nan)) if (apart & np.isfinite(scores)).any() else -1
    )
    if best < REG_MIN_R or best - alias < REG_MARGIN:
        return None
    return (k - reach) * JX_M, float(best)


def _linked(n: int, pairs: list[tuple[int, int, float, float]]) -> list[int]:
    """The largest set of images the pairs connect."""
    nb: dict[int, set[int]] = collections.defaultdict(set)
    for a, b, *_ in pairs:
        nb[a].add(b)
        nb[b].add(a)
    seen: set[int] = set()
    best: list[int] = []
    for i in range(n):
        if i in seen:
            continue
        comp, stack = set(), [i]
        while stack:
            x = stack.pop()
            if x not in comp:
                comp.add(x)
                stack.extend(nb[x])
        seen |= comp
        if len(comp) > len(best):
            best = sorted(comp)
    return best


def solve(n: int, pairs: list[tuple[int, int, float, float]], drives: list[str]) -> np.ndarray:
    """Offsets o with o[a] − o[b] = shift for each pair (weighted by its
    correlation, Huber IRLS), the drives' mean offsets averaging to 0."""
    count = collections.Counter(drives)
    gauge = np.array([1 / (len(count) * count[d]) for d in drives])
    o = np.zeros(n)
    for _ in range(10):
        rows, ys, ws = [], [], []
        for a, b, s, r in pairs:
            row = np.zeros(n)
            row[a], row[b] = 1, -1
            res = o[a] - o[b] - s
            rows.append(row)
            ys.append(s)
            ws.append(r * min(1.0, HUBER_M / max(abs(res), 1e-6)))
        rows.append(gauge)
        ys.append(0.0)
        ws.append(1e3)
        sw = np.sqrt(np.array(ws))
        o = np.linalg.lstsq(np.array(rows) * sw[:, None], np.array(ys) * sw, rcond=None)[0]
    return o


def offsets(records: list[dict]) -> dict[int, float] | None:
    """Per record (its index) the offset its drive's pose puts on the wall
    (m, where the image sees a thing minus where it is), or None where
    no two images register or fewer than MIN_DRIVES drives link up."""
    profiles = [decode_profile(r["jx"]) if r.get("jx") else None for r in records]
    usable = [i for i, p in enumerate(profiles) if p is not None]
    pairs = []
    for i, j in itertools.combinations(usable, 2):
        found = register(profiles[i], profiles[j])
        if found is not None:
            pairs.append((i, j, *found))
    linked = _linked(len(records), pairs)
    drives = [records[i]["seq"] for i in linked]
    # at least two images that agree on the wall's jambs
    if len(linked) < 2 or len(set(drives)) < MIN_DRIVES:
        return None
    at = {i: k for k, i in enumerate(linked)}
    local = [(at[a], at[b], s, r) for a, b, s, r in pairs if a in at and b in at]
    o = solve(len(linked), local, drives)
    return {i: float(o[at[i]]) for i in linked}


def stacked_openings(records: list[dict], offs: dict[int, float]) -> np.ndarray:
    """The openings profiles (`ch`, STEP_M bins, 0–1) moved onto the wall
    by each image's offset and averaged; NaN where none sees."""
    n = max(len(records[i].get("ch") or []) for i in offs)
    total, seen = np.zeros(n), np.zeros(n)
    for i, o in offs.items():
        ch = np.asarray(records[i].get("ch") or [], float)
        if len(ch) == 0:
            continue
        k = int(round(o / STEP_M))
        moved = np.full(n, -1.0)
        # what the image sees at x stands at x − o
        src = np.arange(n) + k
        ok = (src >= 0) & (src < len(ch))
        moved[ok] = ch[src[ok]]
        good = moved >= 0
        total[good] += moved[good] / 1000
        seen[good] += 1
    return np.where(seen > 0, total / np.maximum(seen, 1), np.nan)


def window_centres(profile: np.ndarray) -> list[float]:
    """The middles (m along the wall) of the openings profile's runs."""
    if not np.isfinite(profile).any():
        return []
    p = np.nan_to_num(profile, nan=0.0)
    on = p >= max(OPEN_MIN, 0.5 * float(p.max()))
    out, i = [], 0
    while i < len(on):
        if not on[i]:
            i += 1
            continue
        j = i
        while j < len(on) and on[j]:
            j += 1
        wide = (j - i) * STEP_M
        closed = i > 0 and j < len(on) and np.isfinite(profile[i - 1]) and np.isfinite(profile[j])
        if closed and WINDOW_RUN_M[0] <= wide <= WINDOW_RUN_M[1]:
            out.append((i + j) / 2 * STEP_M)
        i = j
    return out


def phase(centres: list[float], axis: float) -> float | None:
    """Where an axis stands (m from the wall's start, in [0, axis)), the
    centres' circular mean modulo the spacing, or None where fewer than
    MIN_WINDOWS agree to PHASE_R."""
    if len(centres) < MIN_WINDOWS or axis <= 0:
        return None
    ang = np.exp(2j * np.pi * np.asarray(centres) / axis)
    mean = ang.mean()
    if abs(mean) < PHASE_R:
        return None
    return float((np.angle(mean) / (2 * np.pi) * axis) % axis)


def wall_phase(records: list[dict], axis: float) -> dict | None:
    """{"phase", "drives", "windows"} for one wall's records, or None."""
    offs = offsets(records)
    if offs is None:
        return None
    centres = window_centres(stacked_openings(records, offs))
    ph = phase(centres, axis)
    if ph is None:
        return None
    drives = len({records[i]["seq"] for i in offs})
    return {"phase": round(ph, 2), "drives": drives, "windows": len(centres)}
