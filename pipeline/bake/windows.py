"""The facade traits per LoD2 wall, from the street panoramas' trait
profiles (facade_traits.py, the `<tile>.v4.jsonl` cache), and the abstract
facade they model (docs/transformations.md, *Windows on every house*).

Per image and wall the profiles give features that do not change when the
image is moved along the wall — one drive's pose is off along it by
~0.2 m, two drives' by up to a metre, which is why the first reading's
window size, count and storey height did not agree between two of them
(2026-10-07); where the axes stand comes from the drives registered onto
each other (window_axes.py):

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
  - the axis spacing measured; where the drives that saw the wall
    register onto each other, the axes where they stand (`phase`, metres
    from the wall's start `a` to an axis, window_axes.py), else centred
    on the wall;
  - width and height from the measured duty and share where those are
    reliable, else the median proportions of Dresden's measured walls;
  - a frame, sill band, lisenes or ornament where that feature is
    reliable and measured clearly (`FLAG_MIN`).

The bake writes `dlm/windows_<tile>.json`:

    {"attribution", "reliability": {feature: [ρ, walls]},
     "buildings": {"<gml:id>": [{"oid", "wi", "a", "b", "L", "n", "z",
       "imgs", "seqs", "traits": {...}, "model": {"axis", "grid", "w",
       "h", "phase"?, "frame"?, "sill"?, "lisene"?, "orn"?},
       "drives"?}, …]}}

with the wall's frame as in shopfronts.py (`_wall_entry`). Its own file,
credited to Mapillary (CC BY-SA 4.0).

The street photos' glass readings (facade_glass.py, the
`<tile>.glass.<key>.jsonl` cache) add each wall's `"glass": {"glass",
"n", "p"}` (`wall_glass`; a wall no panorama measured enters with it
alone) and the file's `"outer"`, per object with a wall read for glass the
length of its outer walls: the building bake decides which objects are
glass (lib/city/photo-glass.ts, ADR 0060)."""

from __future__ import annotations

import collections
import json
import math
from pathlib import Path

import numpy as np

from .common import Tile
from .facade_traits import STEP_M
from .facades import (
    ATTRIBUTION,
    GLASS_NEAR_M,
    GLASS_SEQ,
    complete,
    glass_path,
    traits_path,
    wall_key,
    walls,
)
from .osm_buildings import root_of
from .shopfronts import _Raster, _wall_entry
from .window_axes import wall_phase

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
MIN_OPENINGS = 2  # whole openings an image must see to give their size
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
    "ow",
    "oh",
    "oprop",
)
# ρ ≥ MIN_RHO over Dresden's thirteen measured tiles pooled (1 931 walls,
# 2026-10-09; docs/transformations.md has every feature's ρ). `sill` passed
# on the spawn tile alone (0.65 over 48 walls) and failed pooled (0.53
# over 85): it is out.
# The openings' own size joined on 2026-11-06 (Dresden pooled again, 141
# walls: ow 0.69, oh 0.71, oprop 0.76); `storey` no longer sets the rows
# (lib/city/windows.ts `windowStorey`) and fell to 0.59 there.
RELIABLE: frozenset[str] = frozenset(
    {
        "axis",
        "grid",
        "storey",
        "share",
        "dark",
        "wduty",
        "width",
        "height",
        "prop",
        "orn",
        "ow",
        "oh",
        "oprop",
    }
)
AXIS_DRAWN = (1.8, 4.8)  # a window axis drawn: no stucco band, no double period
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
    out |= opening_sizes(r.get("op"))
    return out


def opening_sizes(op: list[list[int]] | None) -> dict:
    """The size of the openings an image saw whole (facade_traits.py
    `openings`), where it saw at least `MIN_OPENINGS`: their median width
    and height (`ow`, `oh`, m) and the median of each one's width over its
    height (`oprop`). Read off each opening, not off a profile's duty: two
    drives agree on the height and the proportion better (ρ 0.71 and 0.76
    against the profiles' 0.59 and 0.65, the width alike at 0.69; Dresden's
    tiles pooled, 2026-11-06)."""
    ops = op or []
    if len(ops) < MIN_OPENINGS:
        return {}
    return {
        "ow": float(np.median([o[2] for o in ops])) / 100,
        "oh": float(np.median([o[3] for o in ops])) / 100,
        "oprop": float(np.median([o[2] / o[3] for o in ops])),
    }


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


def _first(traits: dict, reliable: frozenset[str], *names: str) -> float | None:
    """The first of the features that is reliable and measured: the
    openings' own size before the profiles'."""
    return next((traits[n] for n in names if n in reliable and n in traits), None)


def model(traits: dict, axis: float | None, reliable: frozenset[str] = RELIABLE) -> dict | None:
    """The abstract facade a wall's traits give (see the module), or None:
    no reliable axis in AXIS_DRAWN (a window rhythm, not a stucco band or a
    double period), or no grid. Each part only from a reliable feature;
    the window's width and proportion are the whole openings' (`ow`,
    `oprop`), else the profiles' (`width`, `prop`), else Dresden's medians."""
    if axis is None or "axis" not in reliable or not AXIS_DRAWN[0] <= axis <= AXIS_DRAWN[1]:
        return None
    g = traits.get("grid", 0.0)
    grid = "regular" if g >= REGULAR else "loose" if g >= LOOSE else None
    if grid is None or "grid" not in reliable:
        return None
    w = _clamp(_first(traits, reliable, "ow", "width") or WIDTH_SHARE * axis, *WINDOW_W_M)
    w = min(w, axis - MIN_PIER_M)
    prop = _first(traits, reliable, "oprop", "prop")
    h = _clamp(w / (prop if prop is not None else PROPORTION), *WINDOW_H_M)
    out: dict = {"axis": round(axis, 2), "grid": grid, "w": round(w, 2), "h": round(h, 2)}
    for name, least in FLAG_MIN.items():
        if name in reliable and traits.get(name, -1.0) >= least:
            out[name] = True
    return out


# --- glass (pure) ------------------------------------------------------------

# A wall is glass where its photos say so (facade_glass.py): at least
# GLASS_IMAGES readings of it, each from a photo that sees MIN_COVER of
# its upper wall (no photo that sees less is read), and GLASS_SHARE of
# them at GLASS_MIN or more. On the probe
# (2026-11-10) every known glass front read 0.91–1.00 on its clear views;
# over all of Dresden 0.9 also took metal cladding, ribbon-window blocks and
# a plastered house with balconies (all below 0.95 on most views), 0.95 left
# about a dozen objects of which the contact sheets showed two doubtful.
# Two photos keep a single reflection or a scaffold from deciding.
GLASS_MIN = 950  # ‰
GLASS_IMAGES = 2
GLASS_SHARE = 2 / 3


def glass_records(lines: list[str]) -> dict[tuple[str, int, float], list[int]]:
    """Per wall (`wall_key`) the glass readings (‰) of the photos that saw
    enough of it from near enough (`GLASS_NEAR_M`), one a sequence — its
    photo that saw most of the wall — so that two readings are two passes,
    not two frames of one; of the GLASS_SEQ sequences that saw most of it,
    as the fetch plans them (a cache read under an earlier plan may hold
    more)."""
    best: dict[tuple, tuple[float, int]] = {}
    for line in lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        for w in r.get("walls", []):
            if "gl" in w and w.get("dist", 0) <= GLASS_NEAR_M:
                key = (*wall_key(w), r.get("seq", r["img"]))
                cov = w.get("cov", 0)
                if key not in best or cov > best[key][0]:
                    best[key] = (cov, int(w["gl"]))
    seqs: dict[tuple, list[tuple[float, str, int]]] = collections.defaultdict(list)
    for (*wall, seq), (cov, gl) in best.items():
        seqs[tuple(wall)].append((cov, seq, gl))
    return {
        key: [gl for _, _, gl in sorted(rs, key=lambda r: (-r[0], r[1]))[:GLASS_SEQ]]
        for key, rs in sorted(seqs.items())
    }


def wall_glass(readings: list[int]) -> dict | None:
    """A wall's glass entry — {"p": the readings' median, ‰, "n": how many,
    "glass": whether it is glass} — or None with too few readings."""
    if len(readings) < GLASS_IMAGES:
        return None
    hits = sum(g >= GLASS_MIN for g in readings)
    return {
        "glass": hits >= GLASS_SHARE * len(readings),
        "n": len(readings),
        "p": int(np.median(readings)),
    }


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


def windows(
    city: dict,
    by_wall: dict,
    ground=None,
    glass: dict | None = None,
    ws: list[dict] | None = None,
) -> tuple[dict, dict]:
    """Per Building gml:id its measured walls with traits and model, and
    the agreement table. `glass` holds each wall's glass readings
    (`glass_records`); a wall no panorama measured enters with its glass
    alone. `ws` the city's `walls`, where the caller has them."""
    ws = walls(city) if ws is None else ws
    out: dict[str, list[dict]] = collections.defaultdict(list)
    all_seqs = []
    for w in ws:
        recs = by_wall.get((w["oid"], w["wi"]), [])
        seqs = by_sequence(recs) if recs else {}
        gl = wall_glass((glass or {}).get(wall_key(w), []))
        if not seqs and gl is None:
            continue
        if seqs:
            all_seqs.append(seqs)
        traits = wall_traits(seqs) if seqs else {}
        entry = _wall_entry(w, ground) | {
            "eave": round(w["eave"], 2),
            "imgs": sum(len(v) for v in seqs.values()),
            "seqs": len(seqs),
            "traits": traits,
        }
        if gl is not None:
            entry["glass"] = gl
        # a glass wall keeps its model for the record: no building takes
        # its mullions for a rhythm (lib/city/windows.ts `measuredModels`)
        if seqs and (m := model(traits, axis_agrees(seqs))) is not None:
            if (at := wall_phase(recs, m["axis"])) is not None:
                m["phase"] = at["phase"]
                entry["drives"] = at["drives"]
            entry["model"] = m
        out[root_of(city, w["oid"])].append(entry)
    return dict(sorted(out.items())), agreement(all_seqs)


def outer_lengths(ws: list[dict], buildings: dict) -> dict[str, float]:
    """Per object with a wall read for glass, the length of all its outer
    walls (`walls`): the building bake weighs its glass against it, so one
    glazed stair tower read alone does not make a stone house glass."""
    read = {w["oid"] for entries in buildings.values() for w in entries if "glass" in w}
    total: dict[str, float] = collections.defaultdict(float)
    for w in ws:
        if w["oid"] in read:
            total[w["oid"]] += w["L"]
    return {oid: round(v, 1) for oid, v in sorted(total.items())}


def write(path: Path, buildings: dict, reliability: dict, outer: dict | None = None) -> None:
    doc = {"attribution": ATTRIBUTION, "reliability": reliability, "buildings": buildings}
    if outer:
        doc["outer"] = outer
    path.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True))


def _had_glass(out: Path) -> bool:
    """Whether the tile's windows file holds a wall read as glass."""
    try:
        doc = json.loads(out.read_text())
    except (OSError, ValueError):
        return False
    return any(
        w.get("glass", {}).get("glass") for ws in doc.get("buildings", {}).values() for w in ws
    )


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"windows_{tile.id}.json")
    path, gpath = traits_path(tile), glass_path(tile)
    if tile.mapillary and not complete(gpath) and _had_glass(out):
        # none read, read in part, or under other prompts, model or limits
        # (facade_glass.reading_key): baking on would drop glass fronts the
        # committed file holds
        raise SystemExit(
            f"{tile.id}: {out.name} holds glass fronts but {gpath.name} is missing or "
            f"not read through — run the glass fetch before baking the windows"
        )
    glass = glass_records(gpath.read_text().splitlines()) if gpath.exists() else {}
    if not tile.mapillary or not (path.exists() or glass):
        if tile.mapillary:
            print(f"{tile.id}: no facade traits measured — no wall gets windows")
        write(out, {}, {})
        return
    city = json.loads(tile.cityjson.read_text())
    by_wall = _records(path) if path.exists() else {}
    ws = walls(city)
    buildings, reliability = windows(city, by_wall, _Raster(tile.dgm), glass, ws)
    write(out, buildings, reliability, outer_lengths(ws, buildings))
    n_walls = sum(len(v) for v in buildings.values())
    modelled = sum("model" in w for v in buildings.values() for w in v)
    read = sum("glass" in w for v in buildings.values() for w in v)
    glazed = sum(w.get("glass", {}).get("glass", False) for v in buildings.values() for w in v)
    print(
        f"{tile.id}: {n_walls} walls with traits, {modelled} modelled, "
        f"{read} read for glass, {glazed} glass"
    )
    for name, (rho, n) in reliability.items():
        mark = "✓" if rho is not None and rho >= MIN_RHO and n >= MIN_PAIRS else " "
        print(f"  {mark} {name:13s} ρ {rho if rho is not None else '—'} over {n} walls")
