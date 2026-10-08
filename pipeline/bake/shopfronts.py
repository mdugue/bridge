"""Shopfronts: the ground floor of a LoD2 wall as street panoramas show it,
in bays along the wall (Mapillary, CC BY-SA 4.0), and the canopy over it
where the surface model shows one (DOM1, the provider's licence).

The fetch (facades.py) measures every panorama on every wall it sees and
caches, per image and wall, the ground floor's profile in `BIN_M` bins from
the wall's start vertex (facade_measure.profile): `gf` the openings' share
of the band 0.3–3.4 m above ground per bin (-1 where the bin is not seen),
`gz` the same per 0.3 m row of the band,
`sg` the bins a store sign covers (Mapillary's segmentation,
`object--sign--store`), `sz` the signs' band in metres above ground, `gt`
the ground floor's top where wide, low openings show it.

Per wall (`merge`):

  - each sequence's profile is the per-bin median of its images (one
    sequence shares one reconstruction, so its images line up);
  - the sequences are aligned on the one that sees most of the wall: the
    other's shift is the one within `MAX_SHIFT_M` that best correlates the
    two profiles (`best_shift`; SfM poses of different sequences differ by
    ~0.6 m), kept at zero where they overlap too little or are flat;
  - every image then votes per bin: open when its `openness` is at least
    `OPEN_BIN` — the lesser of the openings' share at knee height (0.6–1.2
    m) and at eye height (1.2–2.4 m), from the profile's 0.3 m rows (`gz`):
    a shop window or a door is open in both, a house window (sill at 0.9 m
    or higher) is shut at knee height, a dark plinth lies below it. A bin
    is open or a pier when at least `MIN_VOTES` images saw it and the
    majority says so, unknown otherwise;
  - `bays` are the runs of open bins (bridging one unknown bin, a pole or a
    passer-by) at least `MIN_BAY_M` wide; their edges are moved by the
    neighbouring pier's mean share (a sub-bin edge). Where three or more
    measured bays have nearly the same width they take their median width
    about their own centres (`snap_rhythm`): no bay is added where nothing
    was measured;
  - a glazed row (`row`): where the bins any image saw are at least
    `ROW_SHARE` open over at least `ROW_SEEN_M` of the wall — a modernist
    shop row, glass from pier to pier, seen from the boulevard by one or
    two panoramas each stretch — one image's verdict decides a bin no other
    saw, and unknown gaps up to `ROW_GAP_M` (a tree trunk, a canopy's
    column in front) are bridged: the bays are that row's glass;
  - the wall is a shopfront when its open bins are at least `SHOP_SHARE` of
    its decided bins and it has a bay, or it is a glazed row, or a store
    sign is seen on it (in `MIN_VOTES` images, or in one and as a Mapillary
    map feature within `SIGN_M`).

A wall no panorama shows as a shopfront gets nothing: an OSM shop node
says there is a shop, not where its windows are, and a guessed bay read as
a door (the first bake drew one there; dropped).

Over a shopfront the surface model may show a canopy (`canopy`): the
GDR shop pavilions of the Hauptstraße carry their flat roof 3–4 m out over
the pavement on columns. Per metre along the wall, nDOM = DOM1 − DGM1 is
sampled every half metre out of it; where it is `CANOPY_H` high a metre
out, no higher than the building behind, and stays level (`CANOPY_TOL_M`)
before it drops off within `CANOPY_OUT_M`, that station has a canopy of
that depth. Runs of stations at least `CANOPY_MIN_M` long (one miss
bridged) are the canopies, each with its median depth and height.

The bake writes `dlm/shopfronts_<tile>.json`:

    {"attribution": …, "bin_m": 0.5, "buildings": {"<gml:id>": [
      {"oid", "wi", "a": [x, y], "b": [x, y], "L", "n": [nx, ny],
       "z": [za, zb], "src": "photo", "row": true?,
       "bays": [[s, e], …], "sign": {"at": [[s, e], …], "z": [z0, z1]},
       "canopy": [{"at": [s, e], "d", "h"}, …],
       "gf_top", "imgs", "seqs"}, …]}}

`a`/`b` are the wall's base points in the tile's CRS (the LoD2 footprint's
edge, a → b the direction s runs), s in metres from a; `n` its outward
normal; `z` the lowest DGM ground in front of a and of b; a canopy's `d`
its depth out of the wall and `h` its top above the ground in front. Its
own file, credited to Mapillary and the provider: their licences do not
mix with the OSM tables."""

from __future__ import annotations

import collections
import json
import math
from pathlib import Path

import numpy as np
import rasterio
import shapely

from .common import Tile
from .facade_measure import BIN_M, GF_BAND, ROW_M
from .facades import ATTRIBUTION, SIGN_M, _signs, measured_path, walls
from .osm_buildings import root_of

MAX_SHIFT_M = 1.5
MIN_OVERLAP = 6  # bins two sequences must share to be aligned
MIN_SPREAD = 0.08  # a profile flatter than this (std of shares) aligns nothing
MIN_CORR = 0.5  # a shift must correlate this well ...
SHIFT_GAIN = 0.15  # ... and this much better than none
OPEN_BIN = 0.6  # an image's bin this open (openness) is an opening
LOW_M = (0.6, 1.2)  # knee height: below a house window's sill, above a plinth
MID_M = (1.2, 2.4)  # eye height
MIN_VOTES = 2
MIN_BAY_M = 1.2
SHOP_SHARE = 0.5
MIN_PIER_M = 0.2
RHYTHM_TOL_M = 0.4  # bays this close to their median width are one rhythm
GT_SPREAD_M = 0.6  # the images' ground-floor tops must agree this well
ROW_SHARE = 0.75  # the seen bins this open: a glazed shop row
ROW_SEEN_M = 6.0  # ... seen over at least this much of the wall
ROW_GAP_M = 1.0  # an unknown gap this narrow in a glazed row is bridged
CANOPY_STEP_M = 1.0  # the stations along the wall
CANOPY_OUT_M = tuple(0.5 * k for k in range(1, 17))  # 0.5 … 8 m out
CANOPY_H = (2.6, 6.5)  # a canopy's top above the ground: over a ground floor
CANOPY_TOL_M = (0.6, 1.0)  # it stays this level (below, above: a fascia's lip)
CANOPY_MIN_D = 1.5
CANOPY_MIN_M = 4.0
CLOSED_M = 1.5  # a run of wall this long that two images agree on stays wall
FACING_COS = 0.98  # walls of one object this parallel face the same way
FRONT_M = (0.5, 1.5)  # the ground in front of a wall is sampled this far out

# --- one wall (pure) --------------------------------------------------------


def as_array(gf: list[int] | None, n: int) -> np.ndarray:
    """An image's `gf` as shares in [0, 1], NaN where not seen, n bins."""
    out = np.full(n, np.nan)
    if gf:
        v = np.asarray(gf[:n], float)
        out[: len(v)] = np.where(v < 0, np.nan, v / 100)
    return out


def openness(r: dict, n: int) -> np.ndarray:
    """An image's bins as how open a door or a shop window keeps them: the
    lesser of the openings' share at knee height (`LOW_M`) and at eye
    height (`MID_M`), from its rows (`gz`). A house window (sill at 0.9 m
    or higher) is shut at knee height, a dark plinth below it. Images
    without rows fall back to the whole band's share (`gf`)."""
    if not r.get("gz"):
        return as_array(r.get("gf"), n)
    rows = np.stack([as_array(row, n) for row in r["gz"]])
    zones = []
    for lo, hi in (LOW_M, MID_M):
        k0 = int(round((lo - GF_BAND[0]) / ROW_M))
        k1 = int(round((hi - GF_BAND[0]) / ROW_M))
        zones.append(_nanmean(rows[k0:k1]))
    return np.minimum(*zones)  # NaN where either zone is unseen (a parked car)


def shifted(p: np.ndarray, k: int) -> np.ndarray:
    """p moved k bins towards the wall's end (NaN fills)."""
    out = np.full_like(p, np.nan)
    if k >= 0:
        out[k:] = p[: len(p) - k] if k else p
    else:
        out[:k] = p[-k:]
    return out


def correlation(a: np.ndarray, b: np.ndarray) -> float | None:
    both = ~np.isnan(a) & ~np.isnan(b)
    if both.sum() < MIN_OVERLAP:
        return None
    x, y = a[both], b[both]
    if x.std() < MIN_SPREAD or y.std() < MIN_SPREAD:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def best_shift(ref: np.ndarray, other: np.ndarray, max_bins: int) -> tuple[int, float | None]:
    """The shift (bins) of `other` that best correlates it with `ref`, and
    that correlation; (0, None) where no shift can be judged. Ties go to
    the smaller shift. A shift is taken only where it correlates at least
    MIN_CORR and SHIFT_GAIN better than none: the best of seven shifts of
    a noisy profile is always somewhat better than the first."""
    c0 = correlation(ref, other)
    best: tuple[int, float | None] = (0, c0)
    for k in sorted(range(-max_bins, max_bins + 1), key=abs):
        c = correlation(ref, shifted(other, k))
        if c is not None and (best[1] is None or c > best[1] + 1e-9):
            best = (k, c)
    k, c = best
    if k and (c is None or c < MIN_CORR or (c0 is not None and c - c0 < SHIFT_GAIN)):
        return 0, c0
    return best


def _nanmedian(stack: np.ndarray) -> np.ndarray:
    out = np.full(stack.shape[1], np.nan)
    seen = ~np.isnan(stack).all(0)
    out[seen] = np.nanmedian(stack[:, seen], axis=0)
    return out


def align(by_seq: dict[str, list[dict]], n: int) -> tuple[dict[str, int], list[dict]]:
    """Each sequence's shift in bins (the reference's is 0) and, per
    sequence that was compared, {seq, shift, corr0, corr}."""
    meds = {q: _nanmedian(np.stack([openness(r, n) for r in rs])) for q, rs in by_seq.items()}
    order = sorted(meds, key=lambda q: (-int((~np.isnan(meds[q])).sum()), q))
    ref = meds[order[0]]
    shifts, stats = {order[0]: 0}, []
    max_bins = int(round(MAX_SHIFT_M / BIN_M))
    for q in order[1:]:
        k, c = best_shift(ref, meds[q], max_bins)
        shifts[q] = k
        if c is not None:
            stats.append({"seq": q, "shift": k, "corr0": correlation(ref, meds[q]), "corr": c})
    return shifts, stats


def vote(profiles: list[np.ndarray], min_votes: int = MIN_VOTES) -> tuple[np.ndarray, np.ndarray]:
    """Per bin: 1 open, 0 pier, -1 unknown (fewer than `min_votes` images,
    or a tie); and the mean share where seen."""
    stack = np.stack(profiles)
    seen = (~np.isnan(stack)).sum(0)
    opened = (stack >= OPEN_BIN).sum(0)  # NaN compares False
    state = np.full(stack.shape[1], -1)
    decided = seen >= min_votes
    state[decided & (2 * opened > seen)] = 1
    state[decided & (2 * opened < seen)] = 0
    return state, _nanmean(stack)


def _nanmean(stack: np.ndarray) -> np.ndarray:
    out = np.full(stack.shape[1], np.nan)
    seen = ~np.isnan(stack).all(0)
    out[seen] = np.nanmean(stack[:, seen], axis=0)
    return out


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, stop) of the True runs."""
    out, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j < len(mask) and mask[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def bridged(state: np.ndarray, most: int) -> np.ndarray:
    """`state` with runs of at most `most` unknown bins between two open
    ones opened."""
    s = state.copy()
    for i, j in runs(s == -1):
        if j - i <= most and i > 0 and j < len(s) and s[i - 1] == 1 and s[j] == 1:
            s[i:j] = 1
    return s


def bays(state: np.ndarray, share: np.ndarray, length: float, bridge: int = 1) -> list[list[float]]:
    """The runs of open bins (up to `bridge` unknown bins between two open
    ones bridged) at least MIN_BAY_M wide, as [start, end] metres. An edge
    next to a pier moves into it by the pier bin's open share (at most
    half), split between the two bays where the pier is one bin between
    two: a pier keeps at least a quarter metre."""
    s = bridged(state, bridge)

    def into(p: int) -> float:
        if p < 0 or p >= len(s) or s[p] != 0 or np.isnan(share[p]):
            return 0.0
        both = 0 < p < len(s) - 1 and s[p - 1] == 1 and s[p + 1] == 1
        return BIN_M * float(np.clip(share[p], 0, 0.5)) / (2 if both else 1)

    out = []
    for i, j in runs(s == 1):
        start, end = i * BIN_M - into(i - 1), j * BIN_M + into(j)
        start, end = max(0.0, start), min(length, end)
        if end - start >= MIN_BAY_M - 1e-9:
            out.append([round(start, 2), round(end, 2)])
    return out


def snap_rhythm(bs: list[list[float]], length: float) -> list[list[float]]:
    """Three or more bays whose widths all lie within RHYTHM_TOL_M of their
    median take that width about their own centres; otherwise unchanged.
    Only measured bays move — none is added."""
    if len(bs) < 3:
        return bs
    widths = [e - s for s, e in bs]
    med = float(np.median(widths))
    if any(abs(w - med) > RHYTHM_TOL_M for w in widths):
        return bs
    out = []
    for s, e in bs:
        c = (s + e) / 2
        out.append([round(max(0.0, c - med / 2), 2), round(min(length, c + med / 2), 2)])
    if any(b[0] - a[1] < MIN_PIER_M for a, b in zip(out, out[1:], strict=False)):
        return bs  # the rhythm would close a measured pier
    return out


def sign_runs(images: list[tuple[dict, int]], n: int, near_feature: bool) -> list[list[float]]:
    """The bins with a store sign in MIN_VOTES images (or one, when a map
    feature stands by the wall), as [start, end] metres; images are
    (record, shift)."""
    count = np.zeros(n, int)
    for r, k in images:
        for b in r.get("sg", []):
            if 0 <= b + k < n:
                count[b + k] += 1
    need = 1 if near_feature else MIN_VOTES
    return [[i * BIN_M, j * BIN_M] for i, j in runs(count >= need)]


def ground_top(records: list[dict]) -> float | None:
    """The median of the images' ground-floor tops when at least two
    measured one and their interquartile range is within GT_SPREAD_M."""
    tops = [r["gt"] for r in records if r.get("gt") is not None]
    if len(tops) < 2:
        return None
    q1, q3 = np.percentile(tops, [25, 75])
    return round(float(np.median(tops)), 2) if q3 - q1 <= GT_SPREAD_M else None


def merge(records: list[dict], length: float, near_feature: bool = False) -> dict:
    """One wall's images (records with seq, gf, sg, sz, gt) merged: its
    bays, sign, ground-floor top, whether it is a shopfront, and the
    sequences' alignment (`align`)."""
    n = max(1, math.ceil(length / BIN_M - 1e-6))
    seen = [r for r in records if r.get("gf") or r.get("sg")]
    by_seq: dict[str, list[dict]] = collections.defaultdict(list)
    for r in seen:
        by_seq[r["seq"]].append(r)
    out = {"imgs": len(seen), "seqs": len(by_seq), "shop": False, "bays": [], "align": []}
    if not seen:
        return out
    shifts, out["align"] = align(by_seq, n)
    placed = [(r, shifts[r["seq"]]) for r in seen]
    profiles = [shifted(openness(r, n), k) for r, k in placed]
    state, share = vote(profiles)
    bs = snap_rhythm(bays(state, share, length), length)
    decided = state >= 0
    open_share = float((state == 1).sum() / decided.sum()) if decided.any() else 0.0
    if (row := glazed_row(profiles, length)) is not None:
        bs, out["row"] = row, True
    sign = sign_runs(placed, n, near_feature)
    out |= {"bays": bs, "open_share": round(open_share, 2), "decided": int(decided.sum())}
    out["closed"] = [
        [i * BIN_M, min(j * BIN_M, length)]
        for i, j in runs(state == 0)
        if (j - i) * BIN_M >= CLOSED_M - 1e-9
    ]
    if sign:
        zs = np.array([r["sz"] for r in seen if r.get("sz")])
        out["sign"] = {"at": [[s, min(e, round(length, 2))] for s, e in sign]}
        if len(zs):
            out["sign"]["z"] = [
                round(float(np.median(zs[:, 0])), 2),
                round(float(np.median(zs[:, 1])), 2),
            ]
    if (gt := ground_top(seen)) is not None:
        out["gf_top"] = gt
    out["shop"] = bool(sign) or (bool(bs) and (open_share >= SHOP_SHARE or "row" in out))
    return out


def glazed_row(profiles: list[np.ndarray], length: float) -> list[list[float]] | None:
    """The glass of a glazed shop row, or None where the wall is not one:
    the bins any image saw at least ROW_SHARE open over ROW_SEEN_M of the
    wall. One image decides a bin no other saw (a tie stays unknown), and
    unknown gaps up to ROW_GAP_M are bridged; at least one bay."""
    state, share = vote(profiles, min_votes=1)
    decided = state >= 0
    if decided.sum() * BIN_M < ROW_SEEN_M - 1e-9:
        return None
    if (state == 1).sum() < ROW_SHARE * decided.sum():
        return None
    out = bays(state, share, length, bridge=int(round(ROW_GAP_M / BIN_M)))
    return out or None


# --- the canopy over it (pure, given the surface model) ---------------------


def under_canopy(cs: list[dict], closed: list[list[float]]) -> list[list[float]]:
    """The glass of a shop row under its canopies: each canopy's run along
    the wall, without the runs two images agree are wall (`closed`), at
    least MIN_BAY_M wide."""
    out = []
    for c in cs:
        pieces = [list(c["at"])]
        for c0, c1 in closed:
            pieces = [
                q
                for s0, s1 in pieces
                for q in ([s0, min(s1, c0)], [max(s0, c1), s1])
                if q[1] - q[0] > 0
            ]
        out.extend(q for q in pieces if q[1] - q[0] >= MIN_BAY_M - 1e-9)
    return [[round(a, 2), round(b, 2)] for a, b in sorted(out)]


def canopy_depth(heights: list[float | None], inside: float | None) -> tuple[float, float] | None:
    """One station's canopy (depth, height) from nDOM `heights` at
    CANOPY_OUT_M out of the wall and `inside` a metre and a half behind it;
    None where the surface model shows none: its height a metre out within
    CANOPY_H, no higher than the building, level until it drops off before
    the last sample, at least CANOPY_MIN_D deep."""
    if len(heights) < 3 or heights[1] is None or heights[2] is None:
        return None
    h = (heights[1] + heights[2]) / 2
    lo, hi = CANOPY_TOL_M
    if not (CANOPY_H[0] <= h <= CANOPY_H[1]) or inside is None or inside < h - lo:
        return None
    depth = None
    for d, v in zip(CANOPY_OUT_M, heights, strict=False):
        if v is None or not (h - lo <= v <= h + hi):
            break
        depth = d
    else:
        return None  # level as far as it was sampled: not a canopy's edge
    if depth is None or depth + 0.25 < CANOPY_MIN_D:
        return None
    return depth + 0.25, h


def canopies(w: dict, ndom) -> list[dict]:
    """The canopies along wall `w` ({a, b, L, n}): `ndom(x, y)` the surface
    model's height over the ground there (None outside it)."""
    (ax, ay), (bx, by), (nx, ny) = w["a"], w["b"], w["n"]
    tx, ty = (bx - ax) / w["L"], (by - ay) / w["L"]
    stations = np.arange(CANOPY_STEP_M / 2, w["L"], CANOPY_STEP_M)
    found: list[tuple[float, float] | None] = []
    for s in stations:
        x, y = ax + tx * s, ay + ty * s
        found.append(
            canopy_depth(
                [ndom(x + nx * d, y + ny * d) for d in CANOPY_OUT_M],
                ndom(x - nx * 1.5, y - ny * 1.5),
            )
        )
    has = np.array([f is not None for f in found] + [False])
    for i in range(1, len(found) - 1):  # one miss bridged
        if not has[i] and has[i - 1] and has[i + 1]:
            has[i] = True
    out = []
    for i, j in runs(has[:-1]):
        got = [f for f in found[i:j] if f is not None]
        s0 = max(0.0, stations[i] - CANOPY_STEP_M / 2)
        s1 = min(w["L"], stations[j - 1] + CANOPY_STEP_M / 2)
        if s1 - s0 < CANOPY_MIN_M - 1e-9:
            continue
        out.append(
            {
                "at": [round(s0, 2), round(s1, 2)],
                "d": round(float(np.median([d for d, _ in got])), 2),
                "h": round(float(np.median([h for _, h in got])), 2),
            }
        )
    return out


# --- the tile ---------------------------------------------------------------


def _along(w: dict, pt) -> tuple[float, float]:
    """(distance to the wall's segment, position along it from a)."""
    (ax, ay), (bx, by) = w["a"], w["b"]
    dx, dy = (bx - ax) / w["L"], (by - ay) / w["L"]
    s = (pt[0] - ax) * dx + (pt[1] - ay) * dy
    sc = min(max(s, 0.0), w["L"])
    return math.hypot(pt[0] - (ax + dx * sc), pt[1] - (ay + dy * sc)), s


def nearest_walls(ws: list[dict], pts: np.ndarray, within: float) -> dict[int, list[float]]:
    """Per wall index, the positions along it (m from a) of the points whose
    nearest wall it is, within `within`."""
    out: dict[int, list[float]] = collections.defaultdict(list)
    if not ws or len(pts) == 0:
        return out
    tree = shapely.STRtree(shapely.linestrings([[w["a"], w["b"]] for w in ws]))
    idx, dist = tree.query_nearest(
        shapely.points(pts), return_distance=True, max_distance=within, all_matches=False
    )
    for p, j, d in zip(idx[0], idx[1], dist, strict=True):
        if d <= within:
            _, s = _along(ws[int(j)], pts[int(p)])
            out[int(j)].append(round(min(max(s, 0.0), ws[int(j)]["L"]), 2))
    return out


def _records(path: Path) -> dict[tuple[str, int], list[dict]]:
    by: dict[tuple[str, int], list[dict]] = collections.defaultdict(list)
    for line in path.read_text().splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        for w in r.get("walls", []):
            by[(w["oid"], w["wi"])].append(w | {"seq": r["seq"]})
    return by


def _wall_entry(w: dict, ground=None) -> dict:
    """The wall's identity and frame: base points, length, outward normal
    `n`, and with `ground` the lowest ground in front of each end `z`
    (FRONT_M out, a little in from the corner)."""
    out = {
        "oid": w["oid"],
        "wi": w["wi"],
        "a": [round(c, 2) for c in w["a"]],
        "b": [round(c, 2) for c in w["b"]],
        "L": round(w["L"], 2),
        "n": [round(c, 4) for c in w["n"]],
    }
    if ground is not None:
        (ax, ay), (bx, by), (nx, ny) = w["a"], w["b"], w["n"]
        tx, ty = (bx - ax) / w["L"], (by - ay) / w["L"]
        inset = min(0.5, w["L"] / 4)
        zs = []
        for (x, y), sign in (((ax, ay), 1), ((bx, by), -1)):
            px, py = x + tx * inset * sign, y + ty * inset * sign
            z = [ground(px + nx * d, py + ny * d) for d in FRONT_M]
            z = [v for v in z if v is not None]
            zs.append(round(min(z), 2) if z else None)
        if None not in zs:
            out["z"] = zs
    return out


def shopfronts(
    city: dict, by_wall: dict, signs: np.ndarray, ground=None, ndom=None
) -> tuple[dict, dict]:
    """Per Building gml:id its shopfront walls (with their canopies where
    `ndom` shows one), and the merge's statistics.

    Under a canopy the shop row runs the canopy's length (`under_canopy`):
    the pavilions' glass from end to end, where the photos are few and the
    canopy's shade and columns break their profile up. A wall the photos do
    not show as a shopfront gets one only under a canopy that continues a
    measured one: the same LoD2 object, facing the same way (`src:
    "canopy"`)."""
    ws = walls(city)
    near_sign = nearest_walls(ws, signs, SIGN_M)
    out: dict[str, list[dict]] = collections.defaultdict(list)
    stats = {"walls_seen": 0, "align": [], "photo": 0, "row": 0, "canopy": 0, "continued": 0}
    merged: dict[int, dict] = {}
    for i, w in enumerate(ws):
        recs = by_wall.get((w["oid"], w["wi"]), [])
        if not recs:
            continue
        merged[i] = m = merge(recs, w["L"], near_feature=i in near_sign)
        if m["imgs"]:
            stats["walls_seen"] += 1
            stats["align"].extend(m["align"])
    sheltered: dict[str, list[tuple[float, float]]] = collections.defaultdict(list)
    shops = [i for i, m in merged.items() if m["shop"]]
    for i in shops:
        w, m = ws[i], merged[i]
        entry = _wall_entry(w, ground) | {"src": "photo", "bays": m["bays"]}
        entry |= {k: m[k] for k in ("row", "sign", "gf_top") if k in m}
        entry |= {"imgs": m["imgs"], "seqs": m["seqs"]}
        if ndom is not None and (cs := canopies(w, ndom)):
            entry |= {"canopy": cs, "bays": under_canopy(cs, m["closed"]), "row": True}
            sheltered[w["oid"]].append(w["n"])
            stats["canopy"] += 1
        out[root_of(city, w["oid"])].append(entry)
        stats["photo"] += 1
        stats["row"] += int("row" in entry)
    for i, w in enumerate(ws):
        if i in shops or ndom is None:
            continue
        if not any(w["n"][0] * n[0] + w["n"][1] * n[1] >= FACING_COS for n in sheltered[w["oid"]]):
            continue
        if not (cs := canopies(w, ndom)):
            continue
        closed = merged[i].get("closed", []) if i in merged else []
        if not (glass := under_canopy(cs, closed)):
            continue
        entry = _wall_entry(w, ground) | {"src": "canopy", "bays": glass, "row": True, "canopy": cs}
        out[root_of(city, w["oid"])].append(entry)
        stats["continued"] += 1
    return dict(sorted(out.items())), stats


def write(path: Path, buildings: dict, credit: str = "") -> None:
    doc = {
        "attribution": "; ".join(c for c in (ATTRIBUTION, credit) if c),
        "bin_m": BIN_M,
        "buildings": buildings,
    }
    path.write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True))


class _Raster:
    """A single-band raster in memory, sampled by point (None outside it or
    where it holds no value)."""

    def __init__(self, path: Path):
        with rasterio.open(path) as r:
            self.a = r.read(1, masked=True).filled(np.nan).astype(np.float32)
            self.inv = ~r.transform

    def __call__(self, x: float, y: float) -> float | None:
        c, r = self.inv * (x, y)
        r, c = int(math.floor(r)), int(math.floor(c))
        if not (0 <= r < self.a.shape[0] and 0 <= c < self.a.shape[1]):
            return None
        z = float(self.a[r, c])
        return z if np.isfinite(z) and z > -1000 else None


def run(tile: Tile) -> None:
    out = tile.out("dlm", f"shopfronts_{tile.id}.json")
    path = measured_path(tile)
    city = json.loads(tile.cityjson.read_text())
    by_wall = _records(path) if tile.mapillary and path.exists() else {}
    signs = _signs(tile) if tile.mapillary else np.zeros((0, 2))
    ground = _Raster(tile.dgm)
    ndom = None
    dom_path = tile.raw_raster("dom1")
    if by_wall and tile.products.dom and dom_path.exists():
        dom = _Raster(dom_path)

        def ndom(x: float, y: float) -> float | None:
            top, z = dom(x, y), ground(x, y)
            return None if top is None or z is None else top - z

    elif by_wall:
        print(f"{tile.id}: no DOM1 — the shopfronts without canopies")
    buildings, stats = shopfronts(city, by_wall, signs, ground, ndom)
    write(out, buildings, tile.credit if stats["canopy"] else "")
    print(
        f"{tile.id}: {stats['photo']} shopfront walls from photos ({stats['row']} glazed rows,"
        f" {stats['canopy']} under a canopy), {stats['continued']} more under a canopy that"
        f" continues one ({len(buildings)} buildings; {stats['walls_seen']} walls seen)"
    )
