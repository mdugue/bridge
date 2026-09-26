/**
 * The pure part of drawing a bridge from what the bake measured
 * (pipeline/bake/bridge.py, ADR 0030): where a rib of superstructure runs,
 * where its pylons stand, the arch through a measured rib, and where the
 * piers go without blocking the fairway. Stations are metres along the
 * deck's axis from its first abutment. No THREE, no DOM.
 */

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
/** ...at least this far from the next one (m). */
const PYLON_MIN_GAP = 30;

/**
 * Station indices of the rib's pylons: local maxima at least
 * PYLON_MIN_RISE high, the higher one winning within PYLON_MIN_GAP. A truss
 * that sags between two pylons (the Blaues Wunder) has two; an arch has its
 * crown (callers only ask for non-arch ribs).
 */
export function ribPeaks(rise: readonly number[]): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < rise.length; i++) {
    const left = i > 0 ? rise[i - 1] : Number.NEGATIVE_INFINITY;
    const right = i < rise.length - 1 ? rise[i + 1] : Number.NEGATIVE_INFINITY;
    if (rise[i] >= PYLON_MIN_RISE && rise[i] >= left && rise[i] > right) {
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

/** Distance between beam-bridge piers (m). */
export const PIER_SPACING = 26;
/** Half the width kept clear around a fairway mark without a known span (m). */
const FAIRWAY_HALF = 20;

/**
 * Stations of a beam bridge's piers: every ~PIER_SPACING between the
 * abutments, except inside the navigation opening — centred on the
 * fairway mark (`fairway`, 0..1 along the axis), as wide as the bridge's
 * main span when Wikidata knows it.
 */
export function pierStations(
  length: number,
  opts: { fairway?: number | null; span?: number | null } = {}
): number[] {
  const n = Math.floor(length / PIER_SPACING);
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
