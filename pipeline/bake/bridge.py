"""What a bridge deck learns beyond its footprint (rail.py builds the decks,
ADR 0041):

- **the deck line** — the roadway as DOM1 sees it along the axis (the lower
  third of the surface across the deck, smoothed), held near the abutment
  ramp; without DOM1 the ramp itself;
- **superstructure** — the steel or masonry that stands *above* the deck
  (the Blaues Wunder's truss and pylons, the Waldschlößchenbrücke's arch)
  measured in DOM1: along the deck's axis, the highest surface in each half
  of the cross-section above the deck line, cleaned of lamps, poles and
  cars (a morphological opening), kept where it rises ≥ 3 m for ≥ 25 m.
  Each half gives one rib: its lateral offset and a rise per 2 m station;
- **clearance** — the navigation clearance of the Elbe fairway from OSM's
  inland-waterway data (`seamark:type=bridge`, ODbL), over the DGM's water
  surface: the soffit height, hence the deck's structural depth there;
- **Wikidata** (CC0) — the structural type and the main span of a named
  bridge, from a file `bun run fetch` fetched (`<raw>/wikidata/`).

Everything here is optional: without DOM1 there are no ribs, without OSM no
clearance, without the Wikidata file the OSM `bridge:structure` stays.
"""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

from .common import Tile
from .osm import read_osm, tag

STEP = 2.0  # rib stations along the axis (m)
SAMPLE = 1.0  # profile sampling along the axis (m)
ACROSS = 0.5  # cross-section sampling (m)
EDGE = 3.0  # the cross-section reaches this far past the deck outline (m)
OPEN_M = 7  # opening window: anything narrower along the axis is clutter (m)
CLOSE_M = 11  # closing window: a gap this short in a member is filled (m)
MIN_RISE = 3.0  # a rib stands at least this far above the deck (m)
MIN_RUN = 25.0  # ... over at least this length (m)
MIN_PEAK = 5.0  # ... and somewhere this high (m)
MERGE_M = 3.0  # two half-ribs closer than this are one central rib (m)
# the kinds whose structure stands above the deck (`bridge:structure` tokens)
STANDING = ("arch", "truss", "suspension", "cantilever", "cable-stayed")
DEPTH_MIN, DEPTH_MAX = 0.6, 5.0  # the deck's structural depth, clamped (m)
CLEARANCE_REACH = 30.0  # a fairway mark belongs to a deck this close (m)
DECK_BELOW, DECK_ABOVE = 6.0, 4.0  # the measured deck stays this close to the ramp (m)
DECK_SMOOTH_M = 15  # along-axis median window for the measured deck (m)
MAX_GRADE = 0.08  # a road or path deck is no steeper than this
RAIL_GRADE = 0.04  # ...a railway deck no steeper than this


# --- the deck axis ---------------------------------------------------------------


class Axis:
    """A deck's centreline, first abutment → last: a polyline with stations
    (m along it) and, across it, offsets (m, + to the left)."""

    def __init__(self, pts):
        self.pts = np.asarray(pts, dtype=float)
        seg = np.diff(self.pts, axis=0)
        self.seg_len = np.hypot(seg[:, 0], seg[:, 1])
        keep = self.seg_len > 1e-6
        self.pts = np.vstack([self.pts[:1], self.pts[1:][keep]])
        seg = seg[keep]
        self.seg_len = self.seg_len[keep]
        self.dirs = seg / self.seg_len[:, None]
        self.cum = np.concatenate([[0.0], np.cumsum(self.seg_len)])
        self.length = float(self.cum[-1])

    def _segment(self, s):
        return np.clip(np.searchsorted(self.cum, s, side="right") - 1, 0, len(self.seg_len) - 1)

    def points(self, s, offset):
        """World (x, y) at stations `s` and offsets `offset` (broadcast)."""
        s = np.asarray(s, dtype=float)
        i = self._segment(s)
        d = self.dirs[i]
        base = self.pts[i] + d * (s - self.cum[i])[..., None]
        offset = np.asarray(offset, dtype=float)
        x = base[..., 0] - d[..., 1] * offset
        y = base[..., 1] + d[..., 0] * offset
        return x, y

    def point(self, s: float) -> tuple[float, float]:
        x, y = self.points(np.float64(s), 0.0)
        return float(x), float(y)

    def project(self, x: float, y: float) -> tuple[float, float]:
        """(station, offset) of the nearest point on the axis; beyond an end
        the station runs on along the end segment."""
        best = None
        last = len(self.seg_len) - 1
        for i, (p, d, n) in enumerate(zip(self.pts[:-1], self.dirs, self.seg_len, strict=True)):
            t = (x - p[0]) * d[0] + (y - p[1]) * d[1]
            tc = t if (i == 0 and t < 0) or (i == last and t > n) else min(max(t, 0.0), n)
            off = -(x - p[0]) * d[1] + (y - p[1]) * d[0]
            px, py = p[0] + d[0] * tc, p[1] + d[1] * tc
            dist = math.hypot(x - px, y - py)
            if best is None or dist < best[0]:
                best = (dist, float(self.cum[i] + tc), float(off))
        return best[1], best[2]

    def coords(self) -> list[list[float]]:
        return [[round(float(x), 2), round(float(y), 2)] for x, y in self.pts]


AXIS_REACH = 60.0  # a centreline is extended at most this far to the outline (m)


def deck_axis(ring, line=None) -> Axis:
    """The deck's centreline. The DLM bridge line where there is one, clipped
    to the outline and run on to its ends; else the long axis of the
    outline's minimum rotated rectangle, through its middle. (The two
    farthest-apart vertices, used before, are the corners of a diagonal:
    everything measured or drawn across the deck came out skewed by up to
    half its width.) Oriented from the end nearer the ring's first vertex."""
    poly = shapely.make_valid(shapely.Polygon(ring))
    pts = _line_axis(poly, line) if line is not None and len(line) >= 2 else None
    if pts is None:
        pts = _rect_axis(poly)
    first = ring[0]
    if math.dist(pts[-1], first) < math.dist(pts[0], first):
        pts = pts[::-1]
    return Axis(pts)


def _rect_axis(poly) -> list[tuple[float, float]]:
    rect = shapely.minimum_rotated_rectangle(poly)
    c = list(rect.exterior.coords)[:4] if rect.geom_type == "Polygon" else None
    if c is None:
        (x0, y0, x1, y1) = poly.bounds
        return [(x0, (y0 + y1) / 2), (x1, (y0 + y1) / 2)]
    mid = [((c[i][0] + c[(i + 1) % 4][0]) / 2, (c[i][1] + c[(i + 1) % 4][1]) / 2) for i in range(4)]
    # the short edges' midpoints: edge 0 and 2 or edge 1 and 3
    if math.dist(c[0], c[1]) < math.dist(c[1], c[2]):
        return [mid[0], mid[2]]
    return [mid[1], mid[3]]


def _line_axis(poly, line) -> list[tuple[float, float]] | None:
    inside = shapely.intersection(shapely.LineString(line), poly.buffer(1.0))
    parts = [g for g in shapely.get_parts(inside) if g.geom_type == "LineString"]
    if not parts:
        return None
    part = max(parts, key=lambda g: g.length)
    pts = [(x, y) for x, y, *_ in part.coords]
    if len(pts) < 2:
        return None
    grown = poly.buffer(0.5)
    for end in (0, -1):
        a, b = (pts[1], pts[0]) if end == 0 else (pts[-2], pts[-1])
        length = math.dist(a, b) or 1.0
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        reach = 0.0
        while reach < AXIS_REACH and shapely.contains_xy(
            grown, b[0] + ux * (reach + 0.5), b[1] + uy * (reach + 0.5)
        ):
            reach += 0.5
        tip = (b[0] + ux * reach, b[1] + uy * reach)
        if end == 0:
            pts[0] = tip
        else:
            pts[-1] = tip
    simple = shapely.LineString(pts).simplify(0.3)
    return [(x, y) for x, y, *_ in simple.coords]


def opening(values: np.ndarray, window: int) -> np.ndarray:
    """Morphological opening (min then max over `window` samples; NaN-aware):
    removes everything narrower than the window, keeps the rest's shape."""
    padded = np.where(np.isnan(values), -np.inf, values)
    return _slide(_slide(padded, window, np.min), window, np.max)


def closing(values: np.ndarray, window: int) -> np.ndarray:
    """Morphological closing (max then min): fills dips narrower than the
    window — the gaps the 1 m raster leaves in a slender steel member."""
    return _slide(_slide(values, window, np.max), window, np.min)


def _slide(values: np.ndarray, window: int, reduce) -> np.ndarray:
    half = window // 2
    n = len(values)
    return np.array([reduce(values[max(0, i - half) : i + half + 1]) for i in range(n)])


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) index ranges where `mask` is true."""
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask)))
    return out


def clean_rise(rise: np.ndarray) -> np.ndarray:
    """The rib's rise per 1 m sample: opened (lamps, poles, cars go), closed
    (small gaps in the member fill), then only the runs that are long and
    high enough to be structure (0 elsewhere)."""
    opened = closing(opening(rise, OPEN_M), CLOSE_M)
    keep = np.zeros(len(rise))
    for s, e in runs(opened >= MIN_RISE):
        if (e - s) * SAMPLE >= MIN_RUN and opened[s:e].max() >= MIN_PEAK:
            keep[s:e] = opened[s:e]
    return keep


def cross_sections(ground, ring, edge: float, axis: Axis | None = None):
    """DOM1 over the deck, one row per SAMPLE along the axis and one column
    per ACROSS: (stations, across offsets, heights) — NaN outside the
    outline grown by `edge`. None without DOM1 or for a stub."""
    if ground.dom is None:
        return None
    axis = axis or deck_axis(ring)
    length = axis.length
    if length < 2 * SAMPLE:
        return None
    outline = shapely.make_valid(shapely.Polygon(ring))
    if edge > 0:
        outline = outline.buffer(edge)
    offs = [axis.project(x, y)[1] for x, y in ring]
    across = np.arange(min(offs) - edge, max(offs) + edge + 1e-6, ACROSS)
    stations = np.arange(0.0, length + 1e-6, SAMPLE)
    xs, ys = axis.points(stations[:, None], across[None, :])
    top = ground.sample(ground.dom, xs, ys)
    top[~shapely.contains_xy(outline, xs, ys)] = np.nan
    return stations, across, top


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    half = window // 2
    return np.array(
        [np.median(values[max(0, i - half) : i + half + 1]) for i in range(len(values))]
    )


def limit_grade(deck: np.ndarray, step: float, grade: float) -> np.ndarray:
    """The deck line no steeper than `grade`: anchored on the median of its
    middle third, walked out to both ends. A deck's end over a street below
    (the DOM sees the street there) ramps instead of dropping off a cliff."""
    n = len(deck)
    if n < 3:
        return deck
    out = deck.copy()
    mid = n // 2
    out[mid] = float(np.median(deck[n // 3 : max(n // 3 + 1, 2 * n // 3)]))
    rise = grade * step
    for i in range(mid + 1, n):
        out[i] = min(max(deck[i], out[i - 1] - rise), out[i - 1] + rise)
    for i in range(mid - 1, -1, -1):
        out[i] = min(max(deck[i], out[i + 1] - rise), out[i + 1] + rise)
    return out


def measured_deck(ground, ring, ramp, grade: float = MAX_GRADE, axis: Axis | None = None):
    """The deck line as DOM1 sees the roadway: per station the lower third
    of the surface across the deck (parapets, cars and lamps stand above
    it), held within DECK_BELOW/DECK_ABOVE of the abutment ramp (a train or
    a canopy over the deck is not the deck), smoothed along the axis and
    no steeper than `grade`. Returns deck(t), or the ramp itself without
    DOM1."""
    section = cross_sections(ground, ring, 0.0, axis)
    if section is None:
        return ramp
    stations, _, top = section
    length = stations[-1]
    base = np.array([ramp(s / length) for s in stations])
    with np.errstate(all="ignore"):
        seen = np.nanpercentile(np.where(np.isnan(top), np.inf, top), 30, axis=1)
    seen[~np.isfinite(seen)] = np.nan
    deck = np.where(np.isnan(seen), base, np.clip(seen, base - DECK_BELOW, base + DECK_ABOVE))
    deck = limit_grade(rolling_median(deck, DECK_SMOOTH_M), SAMPLE, grade)
    deck = camber_fit(stations, deck, grade)
    return lambda t: float(np.interp(t * length, stations, deck))


def camber_fit(stations: np.ndarray, deck: np.ndarray, grade: float) -> np.ndarray:
    """The measured deck line as the simplest deck it can be: a straight
    ramp between its two ends plus one upward camber, fitted to the
    measurement (least squares) and never sagging, no end steeper than
    `grade`. What the raster adds on top — a dip where it saw the river
    through a gap, a wave from traffic — is not the roadway: the
    Waldschlößchenbrücke and the Blaues Wunder came out bowed inwards."""
    length = float(stations[-1])
    if len(deck) < 3 or length <= 0:
        return deck
    u = stations / length
    lin = deck[0] + (deck[-1] - deck[0]) * u
    bump = 4 * u * (1 - u)
    k = float(np.dot(deck - lin, bump) / np.dot(bump, bump))
    # the end slope is (Δ ± 4k) / L: keep it within the grade
    k_max = max(0.0, (grade * length - abs(float(deck[-1] - deck[0]))) / 4)
    return lin + min(max(k, 0.0), k_max) * bump


def superstructure(ground, ring, deck_at, axis: Axis | None = None) -> list[dict]:
    """The deck's ribs from DOM1: [{offset, rise}] — `offset` the signed
    distance from the axis (m, + to its left), `rise` the height above the
    deck line per STEP from the first abutment (m, 0 where there is none)."""
    section = cross_sections(ground, ring, EDGE, axis)
    if section is None or section[0][-1] < MIN_RUN:
        return []
    stations, across, top = section
    length = stations[-1]
    deck = np.array([deck_at(s / length) for s in stations])
    ribs = []
    for side in (across < 0, across >= 0):
        half = np.where(side[None, :], top, np.nan)
        valid = ~np.all(np.isnan(half), axis=1)
        high = np.full(len(stations), np.nan)
        where = np.full(len(stations), np.nan)
        high[valid] = np.nanmax(half[valid], axis=1)
        where[valid] = across[np.nanargmax(half[valid], axis=1)]
        rise = clean_rise(high - deck)
        if rise.max() <= 0:
            continue
        offset = float(np.nanmedian(where[rise > 0]))
        every = max(1, round(STEP / SAMPLE))
        stations_out = [round(float(r), 1) for r in rise[::every]]
        ribs.append({"offset": round(offset, 1), "rise": stations_out})
    if len(ribs) == 2 and abs(ribs[0]["offset"] - ribs[1]["offset"]) < MERGE_M:
        merged = [max(p, q) for p, q in zip(ribs[0]["rise"], ribs[1]["rise"], strict=True)]
        ribs = [{"offset": round((ribs[0]["offset"] + ribs[1]["offset"]) / 2, 1), "rise": merged}]
    return ribs


# --- the deck's width (DOM1) ---------------------------------------------------------

WIDTH_STEP = 2.0  # cross-sections along a line for its deck's width (m)
WIDTH_REACH = 22.0  # ... reaching this far either side of it (m)
DECK_SKIN = 1.2  # the deck's surface lies no lower than this under the deck line (m)
EDGE_DROP = 3.0  # a deck's side is where the surface falls this far under it...
EDGE_DROP_M = 2.5  # ...within this far past the last of the deck (m)
WIDTH_MIN, WIDTH_MAX = 3.0, 40.0  # a measured deck's width, clamped (m)
EDGES_SEEN = 0.3  # a side is measured when this share of its sections ends in a fall


def section_edges(ground, axis: Axis, deck_at, stations, stop=None):
    """The deck's sides as DOM1 sees them, per station along `axis`: out
    from the axis, the run of surface no lower than DECK_SKIN under the deck
    line (the roadway, its parapets, what stands on it), ended by a fall of
    EDGE_DROP within EDGE_DROP_M — the bridge's side, the water or the
    street below — or where `stop(xs, ys)` says another deck begins (a
    bridge beside it, no gap between). (left, right) offsets ≥ 0, NaN where
    a side's run never ends in a fall (the surface runs on at the deck's
    height: an abutment, a tree's crown) or the axis is not on the deck."""
    stations = np.asarray(stations, dtype=float)
    nan = np.full(len(stations), np.nan)
    if ground.dom is None or len(stations) == 0 or axis.length <= 0:
        return nan, nan.copy()
    level = np.array([deck_at(min(max(s / axis.length, 0.0), 1.0)) for s in stations])
    cx, cy = axis.points(stations, 0.0)
    on_deck = ground.sample(ground.dom, cx, cy) >= level - DECK_SKIN
    offs = np.arange(ACROSS, WIDTH_REACH + EDGE_DROP_M + 1e-6, ACROSS)
    reach, ahead = round(WIDTH_REACH / ACROSS), round(EDGE_DROP_M / ACROSS)
    out = []
    for sign in (1.0, -1.0):
        xs, ys = axis.points(stations[:, None], sign * offs[None, :])
        h = ground.sample(ground.dom, xs, ys)
        blocked = stop(xs, ys) if stop is not None else np.zeros(h.shape, dtype=bool)
        edges = nan.copy()
        for i in np.flatnonzero(on_deck):
            edges[i] = _side_edge(h[i], blocked[i], float(level[i]), reach, ahead)
        out.append(edges)
    return out[0], out[1]


def _side_edge(h, blocked, level: float, reach: int, ahead: int) -> float:
    """One side of one cross-section (samples ACROSS apart from the axis
    out): the offset where the deck ends, or NaN (see `section_edges`)."""
    skin, fall = level - DECK_SKIN, level - EDGE_DROP
    for k in range(reach):
        if blocked[k]:
            return (k + 0.5) * ACROSS
        if np.isnan(h[k]):
            return math.nan
        if h[k] < skin:
            past = h[k : k + ahead + 1]
            seen = past[~np.isnan(past)]
            return (k + 0.5) * ACROSS if len(seen) and seen.min() <= fall else math.nan
    return math.nan


def measured_halves(ground, axis: Axis, deck_at, stop=None) -> tuple[float | None, float | None]:
    """A bridge line's deck either side of it as DOM1 sees it (`section_edges`):
    the median side over the middle half of the line, every WIDTH_STEP. A
    side is None where fewer than EDGES_SEEN of its sections end in a fall:
    a low deck over a brook, a deck in the trees."""
    length = axis.length
    if ground.dom is None or length <= 0:
        return None, None
    n = max(3, int(length / 2 / WIDTH_STEP) + 1)
    left, right = section_edges(
        ground, axis, deck_at, np.linspace(0.25 * length, 0.75 * length, n), stop
    )
    out: list[float | None] = []
    for side in (left, right):
        seen = side[~np.isnan(side)]
        out.append(float(np.median(seen)) if len(seen) >= max(2.0, EDGES_SEEN * n) else None)
    return out[0], out[1]


def deck_halves(
    measured: tuple[float | None, float | None], fallback: float
) -> tuple[float, float]:
    """The half-widths, left and right of its line, a deck is drawn with:
    DOM1's where it saw both sides, the side it saw mirrored where it saw
    one (a centreline lies near the middle), else `fallback`'s halves (the
    mapped width, or the kind's); a measured total clamped to
    WIDTH_MIN..WIDTH_MAX. The kind's width alone drew the Elbe bridges at
    half their width (the Albertbrücke 11 m of its 22.5)."""
    left, right = measured
    if left is None and right is None:
        return fallback / 2, fallback / 2
    left = right if left is None else left
    right = left if right is None else right
    total = left + right
    scale = min(max(total, WIDTH_MIN), WIDTH_MAX) / total if total > 0 else 1.0
    return left * scale, right * scale


# --- a masonry bridge's piers (DOM1) -----------------------------------------------

BASTION_M = 1.5  # over a pier the deck widens at least this much (m)...
BASTION_RUN_M = (3.0, 16.0)  # ...over this length (m)
BASTION_BASE_M = 41  # the deck's own width: the median over this window (m)
BASTION_END_M = 8.0  # a pier stands at least this far from an end (m)
BASTION_GAP_M = 10.0  # two piers stand at least this far apart (m)


def bastion_piers(ground, axis: Axis, deck_at, stop=None) -> list[float]:
    """Stations of a masonry bridge's piers where DOM1 sees them: an old
    stone bridge widens over each pier — the cutwater carried up as a
    bastion, a pulpit on the parapet (the Augustusbrücke's) — so a run of
    BASTION_RUN_M where the deck's width (`section_edges`, every metre)
    stands BASTION_M over its running median is a pier, at the run's
    middle. [] where DOM1 sees too little of the deck's sides."""
    length = axis.length
    if ground.dom is None or length < 2 * BASTION_END_M + BASTION_RUN_M[0]:
        return []
    stations = np.arange(0.0, length + 1e-6, 1.0)
    left, right = section_edges(ground, axis, deck_at, stations, stop)
    width = left + right
    ok = ~np.isnan(width)
    if ok.sum() < 0.6 * len(width):
        return []
    filled = np.interp(stations, stations[ok], width[ok])
    excess = filled - rolling_median(filled, BASTION_BASE_M)
    found = []
    for s, e in runs(excess >= BASTION_M):
        centre = float(stations[s:e].mean())
        if (
            BASTION_RUN_M[0] <= e - s <= BASTION_RUN_M[1]
            and BASTION_END_M <= centre <= length - BASTION_END_M
        ):
            found.append((centre, float(excess[s:e].max())))
    kept: list[float] = []
    for centre, _ in sorted(found, key=lambda f: -f[1]):
        if all(abs(centre - k) >= BASTION_GAP_M for k in kept):
            kept.append(centre)
    return sorted(round(k, 1) for k in kept)


# --- what lies under a deck -----------------------------------------------------------

WATER_CLASS = 8  # lib/city/landcover.ts WATER_CLASS
WATER_RUN_M = 4.0  # a stretch over water is at least this long (m)


class Wet:
    """The class raster's water around a tile — its own and its neighbours',
    loaded as a point first needs one — for the stretches of a deck over
    water."""

    def __init__(self, tile: Tile) -> None:
        self.tile = tile
        self.parts = [[bounds, tid, None] for tid, bounds in tile.neighbours()]

    def __call__(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
        xs, ys = np.asarray(xs, dtype=float), np.asarray(ys, dtype=float)
        out = np.zeros(xs.shape, dtype=bool)
        for part in self.parts:
            (x0, y0, x1, y1), tid, wet = part
            inside = (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)
            if not inside.any():
                continue
            if wet is None:
                classes = self.tile.classes(tid)
                wet = part[2] = (
                    classes == WATER_CLASS if classes is not None else np.zeros((1, 1), bool)
                )
            h, w = wet.shape
            c = np.minimum(((xs[inside] - x0) / (x1 - x0) * w).astype(int), w - 1)
            r = np.minimum(((y1 - ys[inside]) / (y1 - y0) * h).astype(int), h - 1)
            out[inside] = wet[r, c]
        return out


def water_runs(wet_at, axis: Axis) -> list[list[float]]:
    """The stretches of the axis over water, [from, to] stations (m): where
    the viewer puts a river pier rather than a viaduct's columns."""
    stations = np.arange(0.0, axis.length + 1e-6, 1.0)
    if len(stations) < 2:
        return []
    xs, ys = axis.points(stations, 0.0)
    wet = wet_at(xs, ys)
    return [
        [round(float(stations[s]), 1), round(float(stations[e - 1]), 1)]
        for s, e in runs(wet)
        if e - s >= WATER_RUN_M
    ]


# Under a deck no laser sees the ground: the DGM fills it — from the
# embankments, or (some Länder's DGM, Hamburg's) with the bridge itself.
# The terrain bake opens what the fill closes (lib/city/passages.ts).
UNDER_CLEAR_M = 2.0  # a way this close under a deck's top is closed by the DGM (m)
UNDER_OPEN_M = 0.5  # it is opened where the DGM stands this far over its level (m)
UNDER_REACH_M = 30.0  # a closed way's level is read this far past the deck at most (m)
UNDER_RIM = 3  # ... from the lowest of this many open samples either side
UNDER_HEADROOM_M = 2.2  # an opened way has this much room under the deck at least (m)
UNDER_GRADE = 0.12  # ... and climbs no steeper than this under it
HUMP_M = 2.0  # the DGM holds a bridge where it stands this far over both sides (m)
HUMP_SIDE_M = (2.0, 6.0)  # the sides are read this far past the deck's edges (m)
HUMP_FLAT_M = 0.6  # ... and are level ground there (water, a street) within this (m)
HUMP_STEP = 2.0  # stations of the hump test along the axis (m)
HUMP_RUN = 4  # a hump is this many stations at least (a quay's ramp in the DGM is less)
PASSAGE_SIMPLIFY_M = 0.3


def way_passages(ground, outline, axis: Axis, deck_at, ways) -> list[dict]:
    """The passages of the ways under a deck (`ways`: (line, half-width), the
    OSM highways off any bridge): where the DGM closes one — under the
    outline it lies within UNDER_CLEAR_M of the deck's top, the fill or the
    bridge itself — its level runs straight across, between the lowest open
    ground either side, and where the DGM stands UNDER_OPEN_M over that
    level the passage is kept: {c: the way's points, y: its level there, h:
    its half-width}. A way that ends under the deck (onto it), or one whose
    level leaves no UNDER_HEADROOM_M under it or climbs steeper than
    UNDER_GRADE (a path up the bank to the abutment) is not passed under."""
    out = []
    grown = outline.buffer(UNDER_REACH_M)
    for line, half in ways:
        for part in shapely.get_parts(shapely.intersection(line, grown)):
            if part.geom_type == "LineString" and part.length >= 2.0:
                out += _way_passage(ground, outline, axis, deck_at, part, half)
    return out


def _way_passage(ground, outline, axis: Axis, deck_at, part, half: float) -> list[dict]:
    d = np.linspace(0.0, part.length, int(part.length) + 2)
    pts = shapely.line_interpolate_point(part, d)
    xs, ys = shapely.get_x(pts), shapely.get_y(pts)
    inside = shapely.contains_xy(outline, xs, ys)
    if not inside.any():
        return []
    g = ground.sample(ground.dgm, xs, ys)
    top = np.full(len(d), np.nan)
    for i in np.flatnonzero(inside):
        top[i] = deck_at(min(max(axis.project(xs[i], ys[i])[0] / axis.length, 0.0), 1.0))
    with np.errstate(invalid="ignore"):
        closed = inside & (top - g < UNDER_CLEAR_M)
    open_ = ~closed & ~np.isnan(g)
    out = []
    for s, e in runs(closed):
        before = [i for i in range(s - 1, -1, -1) if open_[i]][:UNDER_RIM]
        after = [i for i in range(e, len(d)) if open_[i]][:UNDER_RIM]
        if s == 0 or e == len(d) or not before or not after:
            continue  # the way ends under the deck, or nothing open beside it
        i0, i1 = s - 1, e
        ya, yb = float(g[before].min()), float(g[after].min())
        level = ya + (yb - ya) * (d[i0 : i1 + 1] - d[i0]) / (d[i1] - d[i0])
        headroom = np.nanmin(top[s:e] - level[1:-1])
        if (
            np.nanmax(g[i0 : i1 + 1] - level) < UNDER_OPEN_M
            or headroom < UNDER_HEADROOM_M
            or abs(yb - ya) > UNDER_GRADE * (d[i1] - d[i0])
        ):
            continue  # nothing closed, or no passage: the way climbs to the deck's end
        run = shapely.LineString(np.column_stack([xs[i0 : i1 + 1], ys[i0 : i1 + 1]]))
        kept = run.simplify(PASSAGE_SIMPLIFY_M)
        coords, ys_out = [], []
        for x, y in kept.coords:
            t = run.project(shapely.Point(x, y)) / run.length
            coords.append([round(x, 2), round(y, 2)])
            ys_out.append(round(ya + (yb - ya) * t, 2))
        out.append({"c": coords, "y": ys_out, "h": round(half, 2)})
    return out


def ring_edges(ring, axis: Axis):
    """The ring's vertices on the axis: (station, offset) each, for
    `edges_at`."""
    return [axis.project(x, y) for x, y in ring]


def edges_at(on_axis, s: float) -> tuple[float, float] | None:
    """The outline's extreme offsets where it crosses station s (left,
    right), linear along each ring edge; None where it does not."""
    left, right = -math.inf, math.inf
    for (sa, oa), (sb, ob) in zip(on_axis, on_axis[1:] + on_axis[:1], strict=True):
        if (sa - s) * (sb - s) <= 0 and sa != sb:
            off = oa + (ob - oa) * (s - sa) / (sb - sa)
            left, right = max(left, off), min(right, off)
    return (left, right) if math.isfinite(left) else None


def hump_passages(ground, ring, axis: Axis, deck_at, wet_at=None) -> list[dict]:
    """Where the DGM still holds the bridge (`_hump_at`: a hump of HUMP_M
    over the level ground beside the deck, read HUMP_SIDE_M past its
    edges), for every station of a stretch of HUMP_RUN or more: a passage
    across the deck, edge to edge (a metre past each) and HUMP_STEP along
    it, at the lower side's level — together the stretch opened as wide
    as the deck and no wider, flat-ended where the sides rise (the quay
    walls). A stretch at a deck's end is an abutment, not a hump, unless
    it reaches the deck's middle: the DGM holds the whole bridge."""
    length = axis.length
    if length < 2 * HUMP_STEP:
        return []
    on_axis = ring_edges(ring, axis)
    stations = np.arange(HUMP_STEP / 2, length, HUMP_STEP)
    found = [_hump_at(ground, axis, deck_at, on_axis, float(s), wet_at) for s in stations]
    humped = np.array([f is not None for f in found])
    out = []
    for s, e in runs(humped):
        if e - s < HUMP_RUN or (
            (s == 0 or e == len(stations)) and not stations[s] <= length / 2 <= stations[e - 1]
        ):
            continue
        level = np.array([found[i][0] for i in range(s, e)])
        level = rolling_median(level, 3) if len(level) >= 3 else level
        for i, y in zip(range(s, e), level, strict=True):
            left, right = found[i][1]
            xs, ys = axis.points(np.full(2, stations[i]), np.array([left + 1.0, right - 1.0]))
            out.append(
                {
                    "c": [
                        [round(float(x), 2), round(float(v), 2)]
                        for x, v in zip(xs, ys, strict=True)
                    ],
                    "y": [round(float(y), 2)] * 2,
                    "h": HUMP_STEP / 2 + 0.05,
                }
            )
    return out


def _hump_at(
    ground, axis: Axis, deck_at, on_axis, s: float, wet_at=None
) -> tuple[float, tuple[float, float]] | None:
    """(the level to open to, the deck's edges there) where the DGM holds
    the bridge at station s, else None: the DGM under the deck stands
    HUMP_M over level ground (flat within HUMP_FLAT_M) on both sides — a
    street, a canal — or, where the class raster's water runs on under the
    deck, over level water on one side (the other a landing stage the DGM
    holds too: Hamburg's Hohe Brücke), and no higher than the deck. Water
    on one side alone is the quay a deck's end or a promenade stands on."""
    edges = edges_at(on_axis, s)
    if edges is None or edges[0] - edges[1] < 1.0:
        return None
    left, right = edges
    inner = np.arange(right + 0.5, left - 0.5 + 1e-6, 1.0)
    xs, ys = axis.points(np.full(len(inner), s), inner)
    g = ground.sample(ground.dgm, xs, ys)
    if len(inner) == 0 or np.isnan(g).all():
        return None
    under = float(np.nanmedian(g))
    if under > deck_at(min(max(s / axis.length, 0.0), 1.0)) + 1.0:
        return None
    probe = np.arange(HUMP_SIDE_M[0], HUMP_SIDE_M[1] + 1e-6, 1.0)
    low, wet_low = [], []
    for offs in (left + probe, right - probe):
        xs, ys = axis.points(np.full(len(offs), s), offs)
        h = ground.sample(ground.dgm, xs, ys)
        if np.isnan(h).any() or h.max() - h.min() > HUMP_FLAT_M or under - h.max() < HUMP_M:
            continue
        low.append(float(np.median(h)))
        if wet_at is not None and wet_at(xs, ys).all():
            wet_low.append(low[-1])
    if len(low) == 2:
        return min(low), (left, right)
    xs, ys = axis.points(np.full(len(inner), s), inner)
    if wet_low and wet_at is not None and wet_at(xs, ys).any():
        return wet_low[0], (left, right)
    return None


def under_deck(ground, ring, axis: Axis, deck_at, ways, wet_at=None) -> list[dict]:
    """The passages under a deck (`way_passages`, `hump_passages`): what
    the terrain bake opens (lib/city/passages.ts `deckPassages`)."""
    outline = shapely.make_valid(shapely.Polygon(ring))
    return way_passages(ground, outline, axis, deck_at, ways) + hump_passages(
        ground, ring, axis, deck_at, wet_at
    )


# --- navigation clearance (OSM seamarks) -------------------------------------------


def fairway_marks(tile: Tile) -> list[tuple[float, float, float, str | None]]:
    """(x, y, clearance m, wikidata) of the OSM inland-waterway bridge marks."""
    geoms, fields = read_osm(
        tile,
        "points",
        "other_tags LIKE '%seamark:bridge:clearance_height%'",
        ["other_tags"],
        margin=0.01,
    )
    out = []
    for g, other in zip(geoms, fields.get("other_tags", [None] * len(geoms)), strict=True):
        if tag(other, "seamark:type") != "bridge":
            continue
        try:
            clearance = float(tag(other, "seamark:bridge:clearance_height") or "")
        except ValueError:
            continue
        out.append((g.x, g.y, clearance, tag(other, "wikidata")))
    return out


def fairway(ground, ring, deck_at, marks, axis: Axis | None = None) -> dict:
    """{fairway, clearance, depth} for a deck a fairway mark belongs to:
    `fairway` where along the axis (0..1), `depth` = deck − (water +
    clearance)."""
    poly = shapely.Polygon(ring)
    best, bd = None, CLEARANCE_REACH
    for mark in marks:
        d = poly.distance(shapely.Point(mark[0], mark[1]))
        if d <= bd:
            best, bd = mark, d
    if best is None:
        return {}
    axis = axis or deck_axis(ring)
    s_at, _ = axis.project(best[0], best[1])
    t = min(max(s_at / axis.length, 0.0), 1.0) if axis.length > 0 else 0.5
    water = ground.lowest(best[0], best[1], 15)
    if water is None:
        return {}
    depth = deck_at(t) - (water + best[2])
    return {
        "fairway": round(t, 3),
        "clearance": best[2],
        "depth": round(min(max(depth, DEPTH_MIN), DEPTH_MAX), 2),
    }


# --- Wikidata ------------------------------------------------------------------------

SPARQL = "https://query.wikidata.org/sparql"
QUERY = """
SELECT ?b ?label ?coord (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (SAMPLE(?span) AS ?mainSpan) (SAMPLE(?len) AS ?length) (SAMPLE(?n) AS ?spans) WHERE {
  SERVICE wikibase:box {
    ?b wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(%(w)f %(s)f)"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(%(e)f %(n)f)"^^geo:wktLiteral .
  }
  ?b wdt:P31/wdt:P279* wd:Q12280 .
  ?b wdt:P31 ?type . ?type rdfs:label ?typeLabel FILTER(lang(?typeLabel) = "de")
  ?b rdfs:label ?label FILTER(lang(?label) = "de")
  OPTIONAL { ?b wdt:P2787 ?span } OPTIONAL { ?b wdt:P2043 ?len } OPTIONAL { ?b wdt:P1314 ?n }
} GROUP BY ?b ?label ?coord
"""

# German Wikidata classes → the OSM `bridge:structure` vocabulary the viewer reads
STRUCTURES = [
    ("Bogenbrücke", "arch"),
    ("Steinbrücke", "arch"),
    ("Gewölbebrücke", "arch"),
    ("Hängebrücke", "suspension"),
    ("Kettenbrücke", "suspension"),
    ("Gerberträger", "cantilever"),
    ("Fachwerkbrücke", "truss"),
    ("Schrägseilbrücke", "cable-stayed"),
    ("Balkenbrücke", "beam"),
    ("Spannbetonbrücke", "beam"),
]


def structure_of(types: list[str]) -> str:
    """Wikidata classes → `bridge:structure` tokens (";"-joined, in order)."""
    out: list[str] = []
    for word, token in STRUCTURES:
        if any(word in t for t in types) and token not in out:
            out.append(token)
    return ";".join(out)


# The cache's layout: 2 added the number of spans (P1314). A cache of an
# older layout is fetched again; if that fails it stays as it is.
WIKIDATA_VERSION = 2


def cache_version(path: Path) -> int:
    """The layout a Wikidata cache was written in (1 before it was recorded)."""
    try:
        return int(json.loads(path.read_text()).get("version", 1))
    except (OSError, ValueError, AttributeError):
        return 0


def fetch_wikidata(raw: Path, tile_id: str, bounds, epsg: int, margin: float = 500.0) -> None:
    """The bridges Wikidata knows around a tile → `<raw>/wikidata/bridges_<tile>.json`
    (fetch time only, `bun run fetch`; the bake reads the file, never the network):
    each with its classes, main span (P2787), length (P2043) and number of
    spans (P1314)."""
    dest = raw / "wikidata" / f"bridges_{tile_id}.json"
    if dest.exists() and cache_version(dest) >= WIKIDATA_VERSION:
        return
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = bounds
    lons, lats = back.transform(
        [xmin - margin, xmax + margin, xmin - margin, xmax + margin],
        [ymin - margin, ymin - margin, ymax + margin, ymax + margin],
    )
    query = QUERY % {"w": min(lons), "s": min(lats), "e": max(lons), "n": max(lats)}
    req = urllib.request.Request(
        f"{SPARQL}?{urllib.parse.urlencode({'query': query})}",
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "bridge-bake/0.1 (city walker; offline bake)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            rows = json.load(res)["results"]["bindings"]
    except (OSError, ValueError, KeyError) as err:
        print(f"{tile_id}: Wikidata not fetched ({err}); bridges keep the OSM structure")
        return
    bridges = []
    for r in rows:
        lon, lat = (float(v) for v in r["coord"]["value"][6:-1].split())
        bridges.append(
            {
                "id": r["b"]["value"].rsplit("/", 1)[-1],
                "label": r["label"]["value"],
                "lon": lon,
                "lat": lat,
                "types": sorted(r["types"]["value"].split("|")),
                "mainSpan": _number(r, "mainSpan"),
                "length": _number(r, "length"),
                "spans": _count(r, "spans"),
            }
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "source": "Wikidata (CC0)",
        "query": SPARQL,
        "version": WIKIDATA_VERSION,
        "bridges": bridges,
    }
    # through a `.part` file: a run killed mid-write leaves no truncated
    # cache that every later fetch would keep
    part = dest.with_name(dest.name + ".part")
    part.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    part.replace(dest)
    print(f"{tile_id}: {len(bridges)} Wikidata bridges → {dest}")


def _number(row: dict, key: str) -> float | None:
    try:
        return float(row[key]["value"]) if key in row else None
    except ValueError:
        return None


def _count(row: dict, key: str) -> int | None:
    """A count (the spans): a whole number from 1 to 99, else unknown."""
    n = _number(row, key)
    return int(n) if n is not None and n == int(n) and 1 <= n < 100 else None


def load_wikidata(tile: Tile) -> list[dict]:
    """The fetched Wikidata bridges, with their position in the tile's CRS."""
    path = tile.raw / "wikidata" / f"bridges_{tile.id}.json"
    if not path.exists():
        return []
    to_tile = Transformer.from_crs(4326, tile.epsg, always_xy=True)
    out = []
    try:
        doc = json.loads(path.read_text())
    except ValueError as err:
        path.unlink()
        raise OSError(f"{path}: not JSON — deleted; run bun run fetch again") from err
    for b in doc["bridges"]:
        x, y = to_tile.transform(b["lon"], b["lat"])
        out.append({**b, "x": x, "y": y})
    return out


def wikidata_for(ring, name, wikidata_ids: list[str], known: list[dict]) -> dict | None:
    """The Wikidata bridge a deck is: one an OSM `wikidata` tag on or near the
    deck names, else the one whose label is the deck's DLM name and whose
    point lies within 150 m of it."""
    by_id = {b["id"]: b for b in known}
    for qid in wikidata_ids:
        if qid in by_id:
            return by_id[qid]
    if not name:
        return None
    poly = shapely.Polygon(ring)
    for b in known:
        if b["label"] == name and poly.distance(shapely.Point(b["x"], b["y"])) <= 150.0:
            return b
    return None
