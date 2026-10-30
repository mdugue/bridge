/**
 * The pure part of drawing a bridge from what the bake measured
 * (pipeline/bake/bridge.py, ADR 0041): where a rib of superstructure runs,
 * where its pylons stand, the arch through a measured rib, and where the
 * piers go without blocking the fairway. Stations are metres along the
 * deck's axis from its first abutment. No THREE, no DOM.
 */

import { reachLevel } from "./ground-join";

/** Spacing of the baked stations (`line`, `rise`) along the axis (m) —
 *  `STEP` in pipeline/bake/bridge.py. */
export const BRIDGE_STEP = 2;

/** One rib of superstructure: a member standing above the deck. */
export interface BridgeRib {
  /** signed distance from the axis, + to the left of the first → last
   *  abutment (m) */
  offset: number;
  /** height above the deck line per station (m, 0 where there is none) */
  rise: number[];
}

/** [first, last] station indices of each stretch where a rib stands. */
export function ribRuns(rise: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= rise.length; i++) {
    const on = i < rise.length && rise[i] > 0;
    if (on && start < 0) {
      start = i;
    } else if (!on && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/** A pylon stands where a rib peaks this high (m)... */
const PYLON_MIN_RISE = 10;
/** ...at least this far from the next one (m)... */
const PYLON_MIN_GAP = 30;
/** ...and standing this far above the dip to anything higher (m): a wave
 *  in a chord is no pylon. */
const PYLON_PROMINENCE = 4;

/**
 * Station indices of the rib's pylons: local maxima at least
 * PYLON_MIN_RISE high and PYLON_PROMINENCE prominent, the higher one
 * winning within PYLON_MIN_GAP. A truss that sags between two pylons (the
 * Blaues Wunder) has two; an arch has its crown (callers only ask for
 * non-arch ribs).
 */
export function ribPeaks(rise: readonly number[]): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < rise.length; i++) {
    const left = i > 0 ? rise[i - 1] : Number.NEGATIVE_INFINITY;
    const right = i < rise.length - 1 ? rise[i + 1] : Number.NEGATIVE_INFINITY;
    if (
      rise[i] >= PYLON_MIN_RISE &&
      rise[i] >= left &&
      rise[i] > right &&
      prominence(rise, i) >= PYLON_PROMINENCE
    ) {
      candidates.push(i);
    }
  }
  candidates.sort((p, q) => rise[q] - rise[p]);
  const gap = PYLON_MIN_GAP / BRIDGE_STEP;
  const kept: number[] = [];
  for (const i of candidates) {
    if (kept.every((k) => Math.abs(k - i) >= gap)) {
      kept.push(i);
    }
  }
  return kept.sort((p, q) => p - q);
}

/** How far station i stands above the higher of the two lowest points
 *  between it and anything higher on either side (or the rib's end). */
function prominence(rise: readonly number[], i: number): number {
  const dip = (dir: -1 | 1) => {
    let low = rise[i];
    for (let k = i + dir; k >= 0 && k < rise.length; k += dir) {
      if (rise[k] > rise[i]) {
        return low;
      }
      low = Math.min(low, rise[k]);
    }
    return low;
  };
  return rise[i] - Math.max(dip(-1), dip(1));
}

/** y = a·s² + b·s + c */
export interface Parabola {
  a: number;
  b: number;
  c: number;
  /** root-mean-square residual of the fit (m) */
  rms: number;
}

/** Least-squares parabola through (s, y) points; null when degenerate. */
export function fitParabola(
  points: readonly { s: number; y: number }[]
): Parabola | null {
  if (points.length < 3) {
    return null;
  }
  // Centre s for conditioning, then solve the 3×3 normal equations.
  const mean = points.reduce((t, p) => t + p.s, 0) / points.length;
  const m = [0, 0, 0, 0, 0];
  const r = [0, 0, 0];
  for (const p of points) {
    const x = p.s - mean;
    let xp = 1;
    for (let k = 0; k < 5; k++) {
      m[k] += xp;
      if (k < 3) {
        r[k] += xp * p.y;
      }
      xp *= x;
    }
  }
  const A = [
    [m[4], m[3], m[2]],
    [m[3], m[2], m[1]],
    [m[2], m[1], m[0]],
  ];
  const rhs = [r[2], r[1], r[0]];
  const sol = solve3(A, rhs);
  if (!sol) {
    return null;
  }
  const [a2, b2, c2] = sol;
  // back from centred x = s − mean
  const a = a2;
  const b = b2 - 2 * a2 * mean;
  const c = a2 * mean * mean - b2 * mean + c2;
  let sq = 0;
  for (const p of points) {
    sq += (a * p.s * p.s + b * p.s + c - p.y) ** 2;
  }
  return { a, b, c, rms: Math.sqrt(sq / points.length) };
}

function solve3(A: number[][], y: number[]): [number, number, number] | null {
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-9) {
    return null;
  }
  const col = (k: number) =>
    A.map((row, i) => row.map((v, j) => (j === k ? y[i] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/** The best rib of an arch fits its parabola at least this tightly (m). */
const ARCH_MAX_RMS = 1.5;
/** ...and its curve drops at least this far from crown to run's end (m). */
const ARCH_MIN_SAG = 2;
/** Another rib follows that arch if its points lie this close to it (m). */
const ARCH_FOLLOW_RMS = 3;

/** A rib's points: (station, deck line + rise) where it stands. */
function ribPoints(
  rise: readonly number[],
  line: readonly number[]
): { s: number; y: number }[] {
  const points: { s: number; y: number }[] = [];
  for (let i = 0; i < rise.length && i < line.length; i++) {
    if (rise[i] > 0) {
      points.push({ s: i * BRIDGE_STEP, y: line[i] + rise[i] });
    }
  }
  return points;
}

/** The parabola through a rib's points, if it is an arch: opening
 *  downwards, tight, its crown inside the run and a real sag. */
function ribArch(points: { s: number; y: number }[]): Parabola | null {
  const fit = fitParabola(points);
  if (!fit || fit.a >= 0 || fit.rms > ARCH_MAX_RMS) {
    return null;
  }
  const first = points[0].s;
  const last = points.at(-1)?.s ?? first;
  const crown = -fit.b / (2 * fit.a);
  const sag = -fit.a * ((last - first) / 2) ** 2;
  return crown >= first && crown <= last && sag >= ARCH_MIN_SAG ? fit : null;
}

/**
 * The arch each rib of an arch bridge belongs to. The ribs of one arch
 * share its curve, but the raster sees them unequally (one side of the
 * Waldschlößchenbrücke's arch is patchy), so the tightest rib's parabola
 * is fitted and given to every rib whose points follow it — lifted or
 * lowered by their median distance. Null for a rib that follows no arch
 * (a catenary or a tree along the deck is no arch: it is not drawn).
 */
export function archFits(
  ribs: readonly BridgeRib[],
  line: readonly number[]
): (Parabola | null)[] {
  const points = ribs.map((rib) => ribPoints(rib.rise, line));
  let best: Parabola | null = null;
  for (const pts of points) {
    const fit = ribArch(pts);
    if (fit && (!best || fit.rms < best.rms)) {
      best = fit;
    }
  }
  const arch = best;
  if (!arch) {
    return ribs.map(() => null);
  }
  return points.map((pts) => {
    if (pts.length === 0) {
      return null;
    }
    const off = pts
      .map((p) => p.y - (arch.a * p.s * p.s + arch.b * p.s + arch.c))
      .sort((p, q) => p - q);
    const shift = off[Math.floor(off.length / 2)];
    const rms = Math.sqrt(
      off.reduce((t, d) => t + (d - shift) ** 2, 0) / off.length
    );
    return rms <= ARCH_FOLLOW_RMS ? { ...arch, c: arch.c + shift, rms } : null;
  });
}

/**
 * Where an arch meets the ground on either side of its crown — the
 * springing, which the DOM cannot see under the deck. `groundAt(s)` is the
 * terrain along the axis; the search stays within [−reach, length + reach].
 */
export function archSpringing(
  fit: Parabola,
  length: number,
  groundAt: (s: number) => number | null,
  reach = 20
): { from: number; to: number } {
  const crown = -fit.b / (2 * fit.a);
  const y = (s: number) => fit.a * s * s + fit.b * s + fit.c;
  const spring = (dir: -1 | 1): number => {
    let s = crown;
    const end = dir < 0 ? -reach : length + reach;
    while ((end - s) * dir > 0) {
      const next = s + dir;
      const g = groundAt(next);
      if (g !== null && y(next) <= g) {
        return next;
      }
      s = next;
    }
    return end;
  };
  return { from: spring(-1), to: spring(1) };
}

/** Distance between beam-bridge piers at most (m). */
export const PIER_SPACING = 26;
/** A beam bridge this short spans its gap without a pier (m). */
const FREE_SPAN = 40;
/** Half the width kept clear around a fairway mark without a known span (m). */
const FAIRWAY_HALF = 20;

/**
 * Stations of a beam bridge's piers: no more than PIER_SPACING apart
 * between the abutments (none on a deck up to FREE_SPAN long), except
 * inside the navigation opening — centred on the fairway mark (`fairway`,
 * 0..1 along the axis), as wide as the bridge's main span when Wikidata
 * knows it.
 */
export function pierStations(
  length: number,
  opts: { fairway?: number | null; span?: number | null } = {}
): number[] {
  const n = length <= FREE_SPAN ? 1 : Math.ceil(length / PIER_SPACING);
  const out: number[] = [];
  const centre =
    opts.fairway === null || opts.fairway === undefined
      ? null
      : opts.fairway * length;
  const half = opts.span ? opts.span / 2 : FAIRWAY_HALF;
  for (let k = 1; k < n; k++) {
    const s = (k / n) * length;
    // clear of the opening and of the piers that frame it
    if (centre !== null && Math.abs(s - centre) < half + PIER_SPACING / 2) {
      continue;
    }
    out.push(s);
  }
  if (centre !== null && n > 1) {
    // the opening's own piers, where it ends
    for (const s of [centre - half, centre + half]) {
      if (s > PIER_SPACING / 2 && s < length - PIER_SPACING / 2) {
        out.push(s);
      }
    }
    out.sort((p, q) => p - q);
  }
  return out;
}

// --- what carries a deck, and how deep it is (photo QA V16, V17) -------------

/** How a bridge carries its deck: on arches, hung from or framed by
 *  steel above it (a truss, cables), or on beams between piers. */
export type DeckCarrier = "arch" | "beam" | "frame";

/** The carrier an OSM `bridge:structure` value names (an unknown one is a
 *  beam: most bridges are). */
export function deckCarrier(structure: string | null | undefined): DeckCarrier {
  const s = structure ?? "";
  if (s.includes("arch") || s.includes("humpback")) {
    return "arch";
  }
  return /truss|suspension|cable-stayed|cantilever/.test(s) ? "frame" : "beam";
}

/** A beam is about a twentieth of its span deep... */
const BEAM_SLENDERNESS = 20;
/** ...within these (m): a footbridge's slab, a river span's box girder. */
const BEAM_DEPTH_M: readonly [number, number] = [0.8, 2.5];
/** An arch bridge's deck over its crown (m). */
const ARCH_DECK_M = 1;
/** The deck a truss or cables carry (m): their floor, not a girder. */
const FRAME_DECK_M = 1.2;

/**
 * The structural depth of a deck (m), top to soffit, by what carries it:
 * a beam span/BEAM_SLENDERNESS deep within BEAM_DEPTH_M (`span` the main
 * span, else the typical distance between its supports), an arch's deck
 * ARCH_DECK_M, a truss's or cables' floor FRAME_DECK_M. The fairway's
 * clearance (`bound`, the bake's `depth`) only caps it: taken as the
 * depth, against the river's mean high water rather than the water the
 * scan saw, it hung 5 m girders under the Meißen bridges and the U3's
 * steel viaduct.
 */
export function deckDepth(
  carrier: DeckCarrier,
  span: number,
  bound?: number | null
): number {
  const [low, high] = BEAM_DEPTH_M;
  const depth =
    carrier === "arch"
      ? ARCH_DECK_M
      : carrier === "frame"
        ? FRAME_DECK_M
        : Math.min(Math.max(span / BEAM_SLENDERNESS, low), high);
  return bound !== null && bound !== undefined && bound > 0
    ? Math.min(depth, bound)
    : depth;
}

/** A support under a beam deck: a pier on the axis, or a pair of columns
 *  at the deck's edges (an elevated railway's frame). */
export interface DeckSupport {
  /** a pair of columns under the deck's edges, not one pier on the axis */
  edge: boolean;
  s: number;
}

/** A rail deck this long is a viaduct on columns (m)... */
const VIADUCT_MIN_M = 100;
/** ...a pair of them at most this far apart (m): two bays make one span
 *  over water, within PIER_SPACING. */
export const VIADUCT_BAY_M = 13;

/**
 * Where a beam deck stands (stations from the first abutment). A railway
 * beam deck (`structure`, `deckCarrier`) longer than VIADUCT_MIN_M is a
 * viaduct: paired columns under its edges every VIADUCT_BAY_M or less
 * (Hamburg's U3 runs on them every 10–15 m), over the water (`water`, the
 * bake's stretches) a pier on the axis at every other station, so no span
 * exceeds PIER_SPACING, and a fairway it crosses kept open between two
 * piers (`fairwayOpening`). Any other deck stands on piers on its axis
 * (`pierStations`).
 */
export function beamSupports(
  length: number,
  opts: {
    fairway?: number | null;
    kind?: string | null;
    span?: number | null;
    structure?: string | null;
    water?: readonly (readonly [number, number])[] | null;
  } = {}
): DeckSupport[] {
  const viaduct =
    opts.kind === "rail" &&
    deckCarrier(opts.structure) === "beam" &&
    length > VIADUCT_MIN_M;
  if (!viaduct) {
    return pierStations(length, opts).map((s) => ({ s, edge: false }));
  }
  const n = Math.ceil(length / VIADUCT_BAY_M);
  const wet = (s: number) =>
    (opts.water ?? []).some(([a, b]) => s >= a && s <= b);
  const opening = fairwayOpening(length, opts);
  const out: DeckSupport[] = [];
  for (let k = 1; k < n; k++) {
    const s = (k * length) / n;
    if (
      opening &&
      s > opening.from - VIADUCT_BAY_M / 2 &&
      s < opening.to + VIADUCT_BAY_M / 2
    ) {
      continue;
    }
    if (!wet(s)) {
      out.push({ s, edge: true });
    } else if (k % 2 === 0) {
      out.push({ s, edge: false });
    }
  }
  for (const s of opening ? [opening.from, opening.to] : []) {
    if (s > VIADUCT_BAY_M / 2 && s < length - VIADUCT_BAY_M / 2) {
      out.push({ s, edge: false });
    }
  }
  return out.sort((p, q) => p.s - q.s);
}

/** The navigation opening around the fairway mark (stations): the main
 *  span wide when Wikidata knows it, else 2 × FAIRWAY_HALF; null without
 *  a mark. */
function fairwayOpening(
  length: number,
  opts: { fairway?: number | null; span?: number | null }
): { from: number; to: number } | null {
  if (opts.fairway === null || opts.fairway === undefined) {
    return null;
  }
  const centre = opts.fairway * length;
  const half = opts.span ? opts.span / 2 : FAIRWAY_HALF;
  return { from: centre - half, to: centre + half };
}

/** The span a beam deck's depth is reckoned from (m): its main span where
 *  Wikidata knows it, else the median gap between its supports and
 *  abutments. */
export function beamSpan(
  length: number,
  supports: readonly DeckSupport[],
  mainSpan?: number | null
): number {
  if (mainSpan && mainSpan > 0) {
    return Math.min(mainSpan, length);
  }
  const at = [0, ...supports.map((p) => p.s), length];
  const gaps = at.slice(1).map((s, i) => s - at[i]);
  return median(gaps);
}

/** The parapet a deck's edges carry: a masonry bridge's ashlar wall, or
 *  an open steel railing — posts, a top rail, a low kerb — on every other
 *  (photo QA V18: the beam, truss and cable bridges' railings are open). */
export type ParapetStyle = "ashlar" | "railing";

/** The parapet of a bridge of this structure; `steelArch` when its arch
 *  was measured above the deck (a steel arch, not masonry). */
export function parapetStyle(
  structure: string | null | undefined,
  steelArch = false
): ParapetStyle {
  const masonry =
    deckCarrier(structure) === "arch" || (structure ?? "").includes("stone");
  return masonry && !steelArch ? "ashlar" : "railing";
}

/** A rib stands this far inside the deck's edge (m): half a chord, so its
 *  outer face is flush with the deck's side — on the bridge, not beside it. */
const RIB_IN = 0.3;
/** A lone rib this close to the axis is the bridge's centre line (m). */
const CENTRE_RIB = 3;

/**
 * Where the ribs are drawn across the deck. The bake measures a rib's
 * offset against the DLM centreline, which can sit a metre or two off the
 * real bridge (the Blaues Wunder's ribs came out at −5.5 and +3.0 m around a
 * deck 11 m wide: a truss through the roadway). Two ribs are the two sides:
 * each goes just outside its deck edge (`left` > 0 > `right`, the ring's
 * extreme offsets). A lone rib near the axis is central (a pylon on the
 * centre line); a lone rib off it goes to its side's edge.
 */
export function placeRibs(
  ribs: readonly BridgeRib[],
  edges: { left: number; right: number }
): BridgeRib[] {
  const side = (offset: number) =>
    offset >= 0 ? edges.left - RIB_IN : edges.right + RIB_IN;
  if (ribs.length === 1 && Math.abs(ribs[0].offset) < CENTRE_RIB) {
    return [{ ...ribs[0], offset: 0 }];
  }
  if (
    ribs.length === 2 &&
    Math.sign(ribs[0].offset) === Math.sign(ribs[1].offset)
  ) {
    // both measured on one side of a misplaced centreline: the outer one
    // keeps its side, the other takes the opposite edge
    const [inner, outer] =
      Math.abs(ribs[0].offset) < Math.abs(ribs[1].offset)
        ? [ribs[0], ribs[1]]
        : [ribs[1], ribs[0]];
    return [
      { ...outer, offset: side(outer.offset) },
      { ...inner, offset: side(-outer.offset) },
    ];
  }
  return ribs.map((rib) => ({ ...rib, offset: side(rib.offset) }));
}

/**
 * A rib's rise smoothed along the axis (a centred moving average over
 * `window` stations, never raising a station that had none): a frame's
 * chord is a calm line, not the raster's 1 m jitter.
 */
export function smoothRise(rise: readonly number[], window = 5): number[] {
  const half = Math.floor(window / 2);
  return rise.map((r, i) => {
    if (r <= 0) {
      return 0;
    }
    let sum = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < rise.length && rise[k] > 0) {
        sum += rise[k];
        n++;
      }
    }
    return sum / n;
  });
}

/** A deck's centreline (EPSG), first abutment → last: points at a station
 *  and offset, and where a point lies in those terms. */
export interface AxisFrame {
  /** the point at station `s` (m along the axis), `offset` to its left */
  at(s: number, offset: number): [number, number];
  length: number;
  /** station and offset of the nearest axis point (beyond an end the
   *  station runs on along the end segment) */
  project(x: number, y: number): { offset: number; s: number };
}

/** The frame of a baked `axis` polyline; null for fewer than two distinct
 *  points (pipeline/bake/bridge.py `Axis`). */
export function axisFrame(
  points: readonly (readonly [number, number])[]
): AxisFrame | null {
  const pts: [number, number][] = [];
  for (const [x, y] of points) {
    const last = pts.at(-1);
    if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-6) {
      pts.push([x, y]);
    }
  }
  if (pts.length < 2) {
    return null;
  }
  const dirs: [number, number][] = [];
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    dirs.push([dx / len, dy / len]);
    cum.push(cum[i] + len);
  }
  const last = dirs.length - 1;
  const segment = (s: number) => {
    let i = 0;
    while (i < last && s >= cum[i + 1]) {
      i++;
    }
    return i;
  };
  return {
    length: cum[last + 1],
    at: (s, offset) => {
      const i = segment(s);
      const [dx, dy] = dirs[i];
      const t = s - cum[i];
      return [
        pts[i][0] + dx * t - dy * offset,
        pts[i][1] + dy * t + dx * offset,
      ];
    },
    project: (x, y) => {
      let best = { d: Number.POSITIVE_INFINITY, s: 0, offset: 0 };
      for (let i = 0; i <= last; i++) {
        const [dx, dy] = dirs[i];
        const len = cum[i + 1] - cum[i];
        const rx = x - pts[i][0];
        const ry = y - pts[i][1];
        const t = rx * dx + ry * dy;
        const open = (i === 0 && t < 0) || (i === last && t > len);
        const tc = open ? t : Math.min(Math.max(t, 0), len);
        const d = Math.hypot(rx - dx * tc, ry - dy * tc);
        if (d < best.d) {
          best = { d, s: cum[i] + tc, offset: -rx * dy + ry * dx };
        }
      }
      return { s: best.s, offset: best.offset };
    },
  };
}

/** A chord never ends lower than this above the deck (m). */
const CHORD_END = 0.3;
/** Between two towers a chord sags no lower than this above the deck (m):
 *  lower, it lay along the parapet as a second thin strip. */
const SAG_LOW = 2.6;

/**
 * The simple form a truss, suspension or cantilever rib is drawn in, per
 * station (0 where there is none). With towers (`ribPeaks`): a straight
 * chord from the deck at the first run's start up to the first tower, a
 * curve sagging between two towers to the lowest the rib was measured
 * there (SAG_LOW where it was lost), a straight chord down to the deck
 * at the last run's end — the Blaues Wunder's outline, not the raster's
 * waves, and no end left hanging in the air. Without towers: each run a
 * level girder at its median rise.
 */
export function ribProfile(rise: readonly number[]): number[] {
  const out = rise.map(() => 0);
  const runs = ribRuns(rise);
  if (runs.length === 0) {
    return out;
  }
  const peaks = ribPeaks(rise);
  if (peaks.length === 0) {
    for (const [a, b] of runs) {
      const level = median(rise.slice(a, b + 1));
      out.fill(level, a, b + 1);
    }
    return out;
  }
  const start = runs[0][0];
  const end = runs.at(-1)?.[1] ?? start;
  const line = (a: number, ya: number, b: number, yb: number) => {
    for (let i = a; i <= b; i++) {
      out[i] = b === a ? yb : ya + ((yb - ya) * (i - a)) / (b - a);
    }
  };
  line(start, CHORD_END, peaks[0], rise[peaks[0]]);
  for (let k = 0; k < peaks.length - 1; k++) {
    sag(out, rise, peaks[k], peaks[k + 1]);
  }
  const lastPeak = peaks.at(-1) ?? start;
  line(lastPeak, rise[lastPeak], end, CHORD_END);
  return out;
}

/** Between two towers: a curve from one top to the other, its lowest the
 *  least the rib was measured there (where the raster lost it, the deck),
 *  but never below SAG_LOW. */
function sag(out: number[], rise: readonly number[], p: number, q: number) {
  const between = rise.slice(p, q + 1);
  const measured = between.some((r) => r <= 0)
    ? 0
    : Math.min(...smoothRise(between));
  const low = Math.max(measured, SAG_LOW);
  const hp = rise[p];
  const hq = rise[q];
  const dip = Math.max(0, (hp + hq) / 2 - low);
  for (let i = p; i <= q; i++) {
    const u = (i - p) / (q - p);
    out[i] = hp + (hq - hp) * u - dip * 4 * u * (1 - u);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Target span of a masonry arch without a measured or known one, pier to
 *  pier (m). */
export const ARCH_SPAN = 26;
/** A masonry pier is about a seventh of its arches' span thick (the
 *  Augustusbrücke's 7 m between 43 m arches)... */
const PIER_SLENDERNESS = 7;
/** ...within these (m). */
const MASONRY_PIER_M: readonly [number, number] = [1.5, 7];
/** A segmental arch rises a fifth of its span (the Elbe bridges' flat
 *  stone arches; the half ellipse rose to the deck from the water). */
const ARCH_RISE = 1 / 5;
/** The arch's crown stands this far under the deck's soffit (m): the
 *  ring's own thickness shows. */
const CROWN_UNDER_M = 0.2;
/** An arch springs at least this far above the ground (water) under it (m). */
const SPRING_CLEAR_M = 0.5;
/** An arch opens only where it rises this much over its springing (m); a
 *  lower bay (the banks) is the deck on its own. */
const ARCH_MIN_RISE = 2;

/** One masonry arch: its stations, springing and crown heights. */
export interface MasonrySpan {
  crown: number;
  from: number;
  spring: number;
  to: number;
}

/** A masonry pier: its station, half its thickness along the axis, the
 *  ground under it and its top (the springing of the arches either side). */
export interface MasonryPier {
  ground: number;
  half: number;
  s: number;
  top: number;
}

/** What is known of a masonry bridge's arches: DOM1's piers (stations,
 *  the bake's bastions), Wikidata's number of spans and main span, the
 *  fairway mark (0..1) a main span is centred on. */
export interface MasonryKnown {
  fairway?: number | null;
  piers?: readonly number[] | null;
  span?: number | null;
  spans?: number | null;
}

/** `count` equal bays over [a, b]: their inner boundaries. */
function equalBays(a: number, b: number, count: number): number[] {
  const out: number[] = [];
  for (let k = 1; k < count; k++) {
    out.push(a + ((b - a) * k) / count);
  }
  return out;
}

/** The main span `main` centred on `centre` (kept inside the deck), the
 *  rest either side in `others` bays shared by their lengths. */
function aroundMain(
  length: number,
  main: number,
  centre: number,
  others: number | null
): number[] {
  const c = Math.min(Math.max(centre, main / 2), length - main / 2);
  const a = c - main / 2;
  const b = c + main / 2;
  const side = (part: number) =>
    others === null
      ? Math.max(1, Math.round(part / ARCH_SPAN))
      : Math.round((others * part) / Math.max(a + length - b, 1e-6));
  const left = a > 1 ? side(a) : 0;
  const right =
    others === null ? (length - b > 1 ? side(length - b) : 0) : others - left;
  // a side without arches of its own is the abutment: still a bay, which
  // opens only if it clears the ground
  return [
    ...(a > 1 ? [...equalBays(0, a, Math.max(left, 1)), a] : []),
    ...(length - b > 1 ? [b, ...equalBays(b, length, Math.max(right, 1))] : []),
  ].filter((s) => s > 1 && s < length - 1);
}

/** No masonry arch here spans more than this (m; the Luitpoldbrücke's
 *  62.4 m is the widest)... */
const MASONRY_SPAN_MAX_M = 70;
/** ...nor more than this over a known main span. */
const MAIN_SPAN_SLACK = 1.2;

/**
 * The bay boundaries of a masonry bridge, 0 and `length` included: DOM1's
 * piers where the bake found them and no bay they leave is wider than an
 * arch can be (MASONRY_SPAN_MAX_M, or the known main span and a fifth: a
 * pier DOM1 missed left the Reichenbachbrücke one 161 m bay); else
 * Wikidata's spans — the main span centred on the fairway (or the
 * middle), the others sharing the rest — or equal bays of about ARCH_SPAN.
 */
export function masonryBays(
  length: number,
  known: MasonryKnown = {}
): number[] {
  const piers = (known.piers ?? [])
    .filter((s) => s > 0 && s < length)
    .sort((p, q) => p - q);
  const widest =
    known.span && known.span > 0
      ? known.span * MAIN_SPAN_SLACK
      : MASONRY_SPAN_MAX_M;
  const measured = [0, ...piers, length];
  if (
    piers.length > 0 &&
    measured.every((s, k) => k === 0 || s - measured[k - 1] <= widest)
  ) {
    return measured;
  }
  const count = known.spans && known.spans >= 1 ? known.spans : null;
  const main =
    known.span && known.span > 0 && known.span < length ? known.span : null;
  const centre = (known.fairway ?? 0.5) * length;
  if (main !== null) {
    return [
      0,
      ...aroundMain(length, main, centre, count === null ? null : count - 1),
      length,
    ];
  }
  const n = count ?? Math.min(Math.max(Math.round(length / ARCH_SPAN), 1), 16);
  return [0, ...equalBays(0, length, n), length];
}

/** Half a masonry pier's thickness between bays `left` and `right` long:
 *  a seventh of the wider within MASONRY_PIER_M, a quarter of the narrower
 *  at most. */
function pierHalf(left: number, right: number): number {
  const [low, high] = MASONRY_PIER_M;
  const thick = Math.min(
    Math.max(Math.max(left, right) / PIER_SLENDERNESS, low),
    high
  );
  return Math.min(thick, Math.min(left, right) / 2) / 2;
}

/**
 * The arches and piers of a masonry bridge (structure `arch` without a
 * measured steel arch). Its bays (`masonryBays`) are bounded by piers
 * about a seventh of their span thick; a bay whose deck clears its ground
 * gets a segmental arch between the piers' faces, rising a fifth of its
 * span to just under the deck and springing no lower than SPRING_CLEAR_M
 * over the higher ground at its ends (flatter where the deck is low). A
 * pier stands at every bay boundary with an arch on either side, from the
 * ground to its arches' springing. `groundAt(s)` is the terrain on the
 * axis (the water over the river), `underAt(s)` the deck's underside.
 */
export function masonryArches(
  length: number,
  groundAt: (s: number) => number | null,
  underAt: (s: number) => number,
  known: MasonryKnown = {}
): { piers: MasonryPier[]; spans: MasonrySpan[] } {
  const bays = masonryBays(length, known);
  const n = bays.length - 1;
  const halves = bays.map((s, k) =>
    k === 0 || k === n ? 0 : pierHalf(s - bays[k - 1], bays[k + 1] - s)
  );
  const spans: (MasonrySpan | null)[] = [];
  for (let k = 0; k < n; k++) {
    const g0 = groundAt(bays[k]);
    const g1 = groundAt(bays[k + 1]);
    if (g0 === null || g1 === null) {
      spans.push(null);
      continue;
    }
    const from = bays[k] + halves[k];
    const to = bays[k + 1] - halves[k + 1];
    const crown = underAt((from + to) / 2) - CROWN_UNDER_M;
    const spring = Math.max(
      crown - (to - from) * ARCH_RISE,
      Math.max(g0, g1) + SPRING_CLEAR_M
    );
    spans.push(
      crown - spring >= ARCH_MIN_RISE ? { from, to, spring, crown } : null
    );
  }
  const piers: MasonryPier[] = [];
  for (let k = 1; k < n; k++) {
    const ground = groundAt(bays[k]);
    const sides = [spans[k - 1], spans[k]].filter(
      (sp): sp is MasonrySpan => sp !== null
    );
    if (ground !== null && sides.length > 0) {
      const top = Math.max(...sides.map((sp) => sp.spring));
      piers.push({ s: bays[k], half: halves[k], ground, top });
    }
  }
  return {
    piers,
    spans: spans.filter((sp): sp is MasonrySpan => sp !== null),
  };
}

/** The underside of an arch at station `s` — a circular segment from
 *  springing to crown (a semicircle at most) — or null outside it. */
export function intradosAt(span: MasonrySpan, s: number): number | null {
  if (s < span.from || s > span.to) {
    return null;
  }
  const half = (span.to - span.from) / 2;
  const rise = Math.min(span.crown - span.spring, half);
  if (half <= 0 || rise <= 0) {
    return span.spring;
  }
  const radius = (half * half + rise * rise) / (2 * rise);
  const u = s - span.from - half;
  return span.crown - radius + Math.sqrt(Math.max(0, radius * radius - u * u));
}

/** A deck end this close above the ground meets it already (m). */
export const APPROACH_FLUSH_M = 0.05;
/** How far past a deck end its approach may run to reach the ground (m). */
export const APPROACH_REACH_M = 40;
/** The approach is searched in steps this long (m). */
const APPROACH_STEP_M = 0.5;
/** The steepest approach by deck kind (rise over run): a road or path ramp
 *  as steep as a street climbs, a railway's no steeper than its line. */
export const APPROACH_GRADE: Readonly<Record<string, number>> = {
  road: 0.08,
  path: 0.1,
  rail: 0.03,
  other: 0.08,
};

/**
 * Where the approach leaving a deck end at height `top` meets the ground:
 * the first distance (m) out from the end at which a ramp falling at
 * `grade` reaches `groundAt(d)` (the ground that far out along the
 * approach). 0 when the end is flush with the ground already (or below
 * it); null when no ground within APPROACH_REACH_M comes up to the ramp
 * (a deck ending in the air, over a street, onto the next deck) or the
 * ground is unknown on the way.
 *
 * The bake measures a deck's ends in DOM1 (the roadway), the terrain is
 * the bare-earth DGM, which runs on under a bridge's approach as the
 * ground it was built on: without an approach every deck end stood as a
 * slab edge a metre or more above the road running up to it.
 */
export function approachLanding(
  groundAt: (d: number) => number | null,
  top: number,
  grade: number
): number | null {
  return reachLevel(groundAt, (d) => top - grade * d, {
    reach: APPROACH_REACH_M,
    step: APPROACH_STEP_M,
    tolerance: APPROACH_FLUSH_M,
    onUnknown: "stop",
  });
}
