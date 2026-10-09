"""The facade traits per LoD2 wall, from the street panoramas' trait
profiles (facade_traits.py, the `<tile>.v3.jsonl` cache), and the abstract
facade they model (docs/transformations.md, *Facade traits*).

Per image and wall the profiles give features that do not change when the
image is moved along the wall — the poses of two drives differ by ~0.6 m,
which is why the first reading's window size, count and storey height
did not agree between two of them (2026-10-07):

   1 `axis`    the period of the column darkness profile (`cd`): the
               window axes' spacing (`period`, `AXIS_M`);
   2 `grid`    that period's autocorrelation peak: regular, loose or none;
   3 `storey`  the period of the row darkness profile (`rd`, `STOREY_M`);
   4 `share`   the openings' share of the upper wall (`ch`);
   5 `prop`    the openings' width over height: the share of a period the
               column / row profile is dark (`duty`) times its period;
   6 `frame`   a set-off band round the openings (`fa`, a Fasche);
   7 `sill`    horizontal lines recurring at the storey (`eh`);
   8 `lisene`  vertical lines recurring at the axis (`ev`);
   9 `orn`     the plaster's fine texture (`tx`);
  10 `plinth`  the ground floor's plaster against the upper's (`gr`), and
               `rustic` its horizontal joints against the upper's (`ge`);
  11 `panel`   a fine grid of joints, 1.2–3.6 m, both ways (`eh`, `ev`).

A wall's value is the median of its sequences' medians (one sequence
shares one reconstruction). `agreement` measures each feature's Spearman
ρ between two sequences on the same walls; only the features in
`RELIABLE` (ρ ≥ `MIN_RHO` over Dresden's tiles pooled, 2026-10-09) drive the
model, the rest are written for the record. `RELIABLE` is fixed in the
code, not decided per tile: one tile's few walls must not switch a
feature on or off.

The model (`model`), per wall seen by at least `MIN_IMAGES` images whose
axis periods agree within `AXIS_TOL` (`axis_agrees`):

  - windows only on a regular or loose grid (`grid`); none without a
    period — no window is invented where nothing was measured;
  - the axis spacing measured, the axes centred on the wall (their
    position is not measured);
  - width and height from the measured duty and share where those are
    reliable, else the median proportions of Dresden's measured walls;
  - a frame, sill band, lisenes or ornament where that feature is
    reliable and measured clearly (`FLAG_MIN`).

The bake writes `dlm/windows_<tile>.json`:

    {"attribution", "reliability": {feature: [ρ, walls]},
     "buildings": {"<gml:id>": [{"oid", "wi", "a", "b", "L", "n", "z",
       "imgs", "seqs", "traits": {...}, "model": {"axis", "grid", "w",
       "h", "storey"?, "frame"?, "sill"?, "lisene"?, "orn"?}}, …]}}

with the wall's frame as in shopfronts.py (`_wall_entry`). Its own file,
credited to Mapillary (CC BY-SA 4.0)."""

from __future__ import annotations

import collections
import json
import math
from pathlib import Path

import numpy as np

from .common import Tile
from .facade_traits import STEP_M
from .facades import ATTRIBUTION, traits_path, walls
from .osm_buildings import root_of
from .shopfronts import _Raster, _wall_entry

AXIS_M = (1.2, 7.0)  # a window axis' spacing
STOREY_M = (2.6, 5.0)  # a storey
PANEL_M = (1.2, 3.6)  # a panel's joints
MIN_PEAK = 0.15  # an autocorrelation peak this high is a period
NEAR_TOP = 0.8  # the first peak this close to the highest is the period
REGULAR, LOOSE = 0.45, 0.25  # a grid's peak: regular, loose, none below
MIN_COVER = 0.5  # an image must see this share of the upper wall ...
MAX_RES_M = 0.07  # ... at this resolution (median m a pixel) or finer
MIN_IMAGES = 2
AXIS_TOL = 0.15  # the images' axis periods agree this well (relative) ...
AXIS_AGREE = 0.6  # ... in this share of them
MIN_RHO = 0.6
MIN_PAIRS = 30  # walls a feature's ρ needs
FEATURES = (
    "axis",
    "grid",
    "storey",
    "share",
    "dark",
    "wduty",
    "hduty",
    "width",
    "height",
    "prop",
    "frame",
    "frame_signed",
    "sill",
    "lisene",
    "orn",
    "plinth",
    "plinth_h",
    "rustic",
    "panel",
)
# ρ ≥ MIN_RHO over Dresden's thirteen measured tiles pooled (1 931 walls,
# 2026-10-09; docs/transformations.md has every feature's ρ). `sill` passed
# on the spawn tile alone (0.65 over 48 walls) and failed pooled (0.53
# over 85): it is out.
RELIABLE: frozenset[str] = frozenset(
    {"axis", "grid", "storey", "share", "dark", "wduty", "width", "height", "prop", "orn"}
)
AXIS_DRAWN = (1.8, 4.8)  # a window axis drawn: no stucco band, no double period
STOREY_DRAWN = (2.8, 4.6)
WINDOW_W_M = (0.7, 2.2)
WINDOW_H_M = (0.8, 2.4)
MIN_PIER_M = 0.6  # wall left between two windows at least
WIDTH_SHARE = 0.44  # Dresden's median: a window's width a share of its axis
PROPORTION = 0.77  # Dresden's median width over height
# a flag set from this value (the feature's upper third or so on Dresden)
FLAG_MIN = {"frame": 0.02, "sill": 0.45, "lisene": 0.45, "orn": 0.011}


# --- one image's features (pure) ------------------------------------------


def as_profile(p: list[int] | None) -> np.ndarray:
    """A cached profile (‰, −1 unseen) as values in [0, 1], NaN unseen."""
    if not p:
        return np.zeros(0)
    a = np.asarray(p, float)
    return np.where(a < 0, np.nan, a / 1000)


def autocorrelation(p: np.ndarray, max_lag: int) -> np.ndarray:
    """The profile's normalised autocorrelation per lag (bins) 0…max_lag,
    over the pairs both seen; NaN where fewer than a third of the profile
    pairs up or a side is flat."""
    out = np.full(max_lag + 1, np.nan)
    seen = ~np.isnan(p)
    if seen.sum() < 8:
        return out
    x = np.where(seen, p - np.nanmean(p), 0.0)
    for k in range(min(max_lag, len(p) - 1) + 1):
        a, b = x[: len(x) - k], x[k:]
        both = seen[: len(x) - k] & seen[k:]
        if both.sum() < max(6, seen.sum() / 3):
            continue
        u, v = a[both], b[both]
        d = math.sqrt(float((u * u).sum() * (v * v).sum()))
        if d > 1e-9:
            out[k] = float((u * v).sum()) / d
    return out


def period(p: np.ndarray, lo_m: float, hi_m: float) -> tuple[float, float] | None:
    """(period in metres, its peak) of the profile in [lo_m, hi_m]: the
    first local maximum of the autocorrelation at least MIN_PEAK high and
    NEAR_TOP of the highest in range (not its double), refined by a
    parabola; None where the profile is shorter than two periods or shows
    none."""
    lo, hi = int(math.floor(lo_m / STEP_M)), int(math.ceil(hi_m / STEP_M))
    hi = min(hi, len(p) // 2)
    if hi <= lo + 2:
        return None
    ac = autocorrelation(p, hi + 1)
    peaks = [
        k
        for k in range(max(lo, 1), hi + 1)
        if np.isfinite(ac[k - 1 : k + 2]).all() and ac[k] >= ac[k - 1] and ac[k] >= ac[k + 1]
    ]
    if not peaks:
        return None
    top = max(ac[k] for k in peaks)
    if top < MIN_PEAK:
        return None
    k = next(k for k in peaks if ac[k] >= NEAR_TOP * top)
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    den = y0 - 2 * y1 + y2
    shift = 0.5 * (y0 - y2) / den if abs(den) > 1e-9 else 0.0
    return (k + max(-0.5, min(0.5, shift))) * STEP_M, float(y1)


def duty(p: np.ndarray) -> float | None:
    """The share of the profile's seen bins that are dark: above the middle
    of its 15th and 85th percentile, after a 0.2 m smoothing."""
    seen = ~np.isnan(p)
    if seen.sum() < 10:
        return None
    q = np.where(seen, p, np.nanmedian(p))
    q = np.convolve(q, np.ones(3) / 3, mode="same")[seen]
    lo, hi = np.percentile(q, 15), np.percentile(q, 85)
    if hi - lo < 0.03:
        return None
    return float((q > (lo + hi) / 2).mean())


def _mean(p: np.ndarray) -> float | None:
    return float(np.nanmean(p)) if np.isfinite(p).any() else None


def peakiness(p: np.ndarray) -> float | None:
    """How far a profile's strongest tenth stands over its median."""
    q = p[np.isfinite(p)]
    if len(q) < 10:
        return None
    med = float(np.median(q))
    return float(np.percentile(q, 90) / med - 1) if med > 1e-6 else None


def ac_at(p: np.ndarray, lag_m: float | None) -> float | None:
    """The profile's autocorrelation at a lag (m), the best within ±10 %."""
    if lag_m is None:
        return None
    k0, k1 = int(math.floor(0.9 * lag_m / STEP_M)), int(math.ceil(1.1 * lag_m / STEP_M))
    if k1 >= len(p) - 2:
        return None
    ac = autocorrelation(p, k1)[k0 : k1 + 1]
    return float(np.nanmax(ac)) if np.isfinite(ac).any() else None


def plinth(gr: np.ndarray) -> tuple[float, float] | None:
    """(tone step, its height): where the ground floor's plaster lightness
    profile (from 0.3 m up) steps most, between 0.6 and 3.0 m above the
    ground, the step's size."""
    best = None
    for k in range(3, min(len(gr) - 3, 28)):
        lo, hi = gr[:k], gr[k : k + 8]
        if np.isfinite(lo).sum() < 2 or np.isfinite(hi).sum() < 3:
            continue
        step = abs(float(np.nanmean(lo) - np.nanmean(hi)))
        if best is None or step > best[0]:
            best = (step, 0.3 + k * STEP_M)
    return best


def image_features(r: dict) -> dict:
    """One image's features on one wall (see the module); a feature it
    cannot give is left out."""
    cd, ch, rd = as_profile(r.get("cd")), as_profile(r.get("ch")), as_profile(r.get("rd"))
    ev, eh = as_profile(r.get("ev")), as_profile(r.get("eh"))
    out: dict = {}
    if len(cd) == 0:
        return out
    ax = period(cd, *AXIS_M)
    out["grid"] = ax[1] if ax else 0.0
    if ax:
        out["axis"] = ax[0]
    st = period(rd, *STOREY_M)
    if st:
        out["storey"] = st[0]
    for name, v in (("share", _mean(ch)), ("dark", _mean(cd))):
        if v is not None:
            out[name] = v
    wd, hd = duty(cd), duty(rd)
    if wd is not None:
        out["wduty"] = wd
        if ax:
            out["width"] = wd * ax[0]
    if hd is not None:
        out["hduty"] = hd
        if st:
            out["height"] = hd * st[0]
    if "width" in out and "height" in out and out["height"] > 0.2:
        out["prop"] = out["width"] / out["height"]
    if "fa" in r:
        out["frame"] = r["fa"] / 1000
        out["frame_signed"] = r["fr"] / 1000
    if (v := ac_at(eh, out.get("storey"))) is not None:
        out["sill"] = v
    if (v := ac_at(ev, out.get("axis"))) is not None:
        out["lisene"] = v
    if "tx" in r:
        out["orn"] = r["tx"] / 1000
    gr, ge = as_profile(r.get("gr")), as_profile(r.get("ge"))
    if len(gr) and (pl := plinth(gr)) is not None:
        out["plinth"], out["plinth_h"] = pl
    up = _mean(eh)
    if len(ge) and up and (g := _mean(ge)) is not None:
        out["rustic"] = g / up
    pe, pv = period(eh, *PANEL_M), period(ev, *PANEL_M)
    out["panel"] = min(pe[1] if pe else 0.0, pv[1] if pv else 0.0)
    return out


# --- per wall (pure) --------------------------------------------------------


def _median(values: list[float]) -> float | None:
    return float(np.median(values)) if values else None


def sharp(r: dict) -> bool:
    """Whether an image saw the wall well enough to be measured: at least
    MIN_COVER of its upper wall, at MAX_RES_M or finer. Between two
    sequences the axis spacing agrees at ρ 0.58 over every image and 0.72
    over these (Dresden's spawn tile)."""
    return r.get("cov", 0) >= MIN_COVER and r.get("res", 9) <= MAX_RES_M


def by_sequence(records: list[dict]) -> dict[str, list[dict]]:
    """A wall's well-seen images' features by sequence (`sharp`)."""
    out: dict[str, list[dict]] = collections.defaultdict(list)
    for r in records:
        if not sharp(r):
            continue
        f = image_features(r)
        if f:
            out[r["seq"]].append(f)
    return dict(out)


def sequence_value(feats: list[dict], name: str) -> float | None:
    return _median([f[name] for f in feats if name in f])


def wall_traits(seqs: dict[str, list[dict]]) -> dict:
    """Each feature as the median of its sequences' medians."""
    out = {}
    for name in FEATURES:
        meds = [m for fs in seqs.values() if (m := sequence_value(fs, name)) is not None]
        if meds:
            out[name] = round(float(np.median(meds)), 3)
    return out


def axis_agrees(seqs: dict[str, list[dict]]) -> float | None:
    """The wall's axis period where at least MIN_IMAGES images found one
    and AXIS_AGREE of them lie within AXIS_TOL of their median."""
    axes = [f["axis"] for fs in seqs.values() for f in fs if "axis" in f]
    if len(axes) < MIN_IMAGES:
        return None
    med = float(np.median(axes))
    near = sum(abs(a - med) <= AXIS_TOL * med for a in axes)
    return med if near >= AXIS_AGREE * len(axes) else None


def spearman(x: list[float], y: list[float]) -> float | None:
    if len(x) < 3:
        return None
    rx = np.argsort(np.argsort(x, kind="stable"), kind="stable").astype(float)
    ry = np.argsort(np.argsort(y, kind="stable"), kind="stable").astype(float)
    if rx.std() == 0 or ry.std() == 0:
        return None
    return float(np.corrcoef(rx, ry)[0, 1])


def agreement(walls_seqs: list[dict[str, list[dict]]]) -> dict[str, list]:
    """Per feature [ρ, walls]: Spearman's ρ between the two sequences with
    the most images, over the walls both measured it on."""
    pairs: dict[str, tuple[list[float], list[float]]] = {n: ([], []) for n in FEATURES}
    for seqs in walls_seqs:
        if len(seqs) < 2:
            continue
        a, b = sorted(seqs.values(), key=len, reverse=True)[:2]
        for n in FEATURES:
            va, vb = sequence_value(a, n), sequence_value(b, n)
            if va is not None and vb is not None:
                pairs[n][0].append(va)
                pairs[n][1].append(vb)
    out = {}
    for n, (x, y) in pairs.items():
        rho = spearman(x, y)
        out[n] = [None if rho is None else round(rho, 3), len(x)]
    return out


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def model(traits: dict, axis: float | None, reliable: frozenset[str] = RELIABLE) -> dict | None:
    """The abstract facade a wall's traits give (see the module), or None:
    no reliable axis in AXIS_DRAWN (a window rhythm, not a stucco band or a
    double period), or no grid. Each part only from a reliable feature;
    the window's width and proportion fall back to Dresden's medians where
    theirs is not."""
    if axis is None or "axis" not in reliable or not AXIS_DRAWN[0] <= axis <= AXIS_DRAWN[1]:
        return None
    g = traits.get("grid", 0.0)
    grid = "regular" if g >= REGULAR else "loose" if g >= LOOSE else None
    if grid is None or "grid" not in reliable:
        return None
    width = traits.get("width") if "width" in reliable else None
    w = _clamp(width if width is not None else WIDTH_SHARE * axis, *WINDOW_W_M)
    w = min(w, axis - MIN_PIER_M)
    prop = traits.get("prop") if "prop" in reliable else None
    h = _clamp(w / (prop if prop is not None else PROPORTION), *WINDOW_H_M)
    out: dict = {"axis": round(axis, 2), "grid": grid, "w": round(w, 2), "h": round(h, 2)}
    if "storey" in reliable and (st := traits.get("storey")) is not None:
        out["storey"] = round(_clamp(st, *STOREY_DRAWN), 2)
    for name, least in FLAG_MIN.items():
        if name in reliable and traits.get(name, -1.0) >= least:
            out[name] = True
    return out


# --- the tile ---------------------------------------------------------------


def _records(path: Path) -> dict[tuple[str, int], list[dict]]:
    by: dict[tuple[str, int], list[dict]] = collections.defaultdict(list)
    for line in path.read_text().splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        for w in r.get("walls", []):
            if "cd" in w:
                by[(w["oid"], w["wi"])].append(w | {"seq": r["seq"]})
    return by


def windows(city: dict, by_wall: dict, ground=None) -> tuple[dict, dict]:
    """Per Building gml:id its measured walls with traits and model, and
    the agreement table."""
    ws = walls(city)
    out: dict[str, list[dict]] = collections.defaultdict(list)
    all_seqs = []
    for w in ws:
        recs = by_wall.get((w["oid"], w["wi"]), [])
        if not recs:
            continue
        seqs = by_sequence(recs)
        if not seqs:
            continue
        all_seqs.append(seqs)
        traits = wall_traits(seqs)
        entry = _wall_entry(w, ground) | {
            "eave": round(w["eave"], 2),
            "imgs": sum(len(v) for v in seqs.values()),
            "seqs": len(seqs),
            "traits": traits,
        }
        if (m := model(traits, axis_agrees(seqs))) is not None:
            entry["model"] = m
        out[root_of(city, w["oid"])].append(entry)
    return dict(sorted(out.items())), agreement(all_seqs)


def write(path: Path, buildings: dict, reliability: dict) -> None:
    doc = {"attribution": ATTRIBUTION, "reliability": reliability, "buildings": buildings}
    path.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True))


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"windows_{tile.id}.json")
    path = traits_path(tile)
    if not tile.mapillary or not path.exists():
        if tile.mapillary:
            print(f"{tile.id}: no facade traits measured — no wall gets windows")
        write(out, {}, {})
        return
    city = json.loads(tile.cityjson.read_text())
    buildings, reliability = windows(city, _records(path), _Raster(tile.dgm))
    write(out, buildings, reliability)
    n_walls = sum(len(v) for v in buildings.values())
    modelled = sum("model" in w for v in buildings.values() for w in v)
    print(f"{tile.id}: {n_walls} walls with traits, {modelled} modelled")
    for name, (rho, n) in reliability.items():
        mark = "✓" if rho is not None and rho >= MIN_RHO and n >= MIN_PAIRS else " "
        print(f"  {mark} {name:13s} ρ {rho if rho is not None else '—'} over {n} walls")
