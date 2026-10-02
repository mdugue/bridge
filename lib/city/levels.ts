/**
 * Which level a line runs on — the ground, a deck, a span over a gap or a
 * cut through a fill — decided along the whole line, never per sample.
 * DOM-free, THREE-free, pure.
 *
 * A railway or tram line is a 2D polyline; its height comes from what lies
 * under it. Deciding that per sample went wrong in three ways:
 *
 * - **a line passing under a deck rode it**: a point inside a deck's
 *   outline was lifted onto it, so where one line crosses under another's
 *   bridge (a flyover, a road over the tracks) the lower one jumped 7 m up
 *   for the deck's width and down again;
 * - **a line on a bridge fell through the ground's gap**: the DGM removes a
 *   bridge, and its gap is often longer than the deck's outline (or there
 *   is no outline at all), so the track dropped into the street below for
 *   a few metres beside the deck;
 * - **a line through an underpass climbed the fill**: under a deck no laser
 *   sees the ground, and the DGM fills it in from the embankment around —
 *   a track through the passage climbed over the fill.
 *
 * A line cannot do any of that: a railway climbs a few per cent at most, a
 * tram a few more. So the level is the path through the candidate heights
 * (the ground, every deck the point lies on) that a line could actually
 * drive — a Viterbi over the candidates with the climb beyond the line's
 * grade as the cost (`chooseLevels`) — and what no candidate path can
 * drive is then read off the jumps that remain (`bridgeJumps`): a drop
 * that comes back up within a span is a gap the line spans ("span": the
 * layer draws a deck under it), a rise that comes back down is a fill it
 * cuts through ("cut": the terrain bake opens it under a deck). A jump
 * that never comes back (a deck ending above lower ground) is left alone:
 * the approaches meet it (lib/city/bridge.ts).
 */

/** What lies under one sample of a line. */
export interface LevelSample {
  /** distance along the line (m), increasing */
  d: number;
  /** the deck tops under it (every deck the point lies on that the line
   *  may ride) */
  decks: readonly number[];
  /** the ground there, or null where it is unknown */
  ground: number | null;
  /** what the source says here, over the line's own `prefer` (a chain
   *  joined from ways with and without a bridge tag) */
  prefer?: "deck" | "ground";
}

export type LevelMode = "ground" | "deck" | "span" | "cut";

/** The lines that take levels. */
export type LevelLine = "rail" | "tram";

/** Sample spacing along a line (m): the rails' and the trams' own (the
 *  layers sample their lines at it, rail-layer.ts / tram-layer.ts, and the
 *  baked runs index those samples). */
export const LEVEL_STEP: Readonly<Record<LevelLine, number>> = {
  rail: 4,
  tram: 2,
};

/** The steepest a line climbs (rise over run): a main line ~4 %, a tram
 *  a little steeper. */
export const LEVEL_GRADE: Readonly<Record<LevelLine, number>> = {
  rail: 0.04,
  tram: 0.08,
};

/** The level a line runs on at one sample. */
export interface Level {
  mode: LevelMode;
  y: number;
}

export interface LevelOptions {
  /** the steepest the line climbs (rise over run) */
  grade: number;
  /**
   * What the source says of the whole line: OSM puts a way on a bridge
   * (`deck`: off a deck is the exception) or not (`ground`: a deck is the
   * exception). Absent: no preference (the DLM's rails carry none).
   */
  prefer?: "deck" | "ground";
}

/** A jump beyond the line's grade this high (m) is one it cannot drive. */
export const LEVEL_JUMP_M = 1;
/** The longest gap a line spans (m): a viaduct the DGM removed. */
export const LEVEL_SPAN_M = 400;
/** The longest fill a line cuts through (m): the ground under a deck the
 *  DGM filled in from its embankment. */
export const LEVEL_CUT_M = 120;
/** Slack on the grade (m per step): the TIN's error, a line a metre off
 *  its embankment's crown. */
const SLACK_M = 0.35;
/** Slack on the grade (m per step) while a rim is pushed out over a slope:
 *  the DGM's noise on flat ground, no more. */
const RIM_SLACK_M = 0.1;
/** Cost of a candidate the source speaks against (in metres of jump). */
const AGAINST_M = 4;
/** Cost of changing level without a jump: ties go to staying put. */
const SWITCH_M = 0.05;
/** On a deck, the ground costs this much: where both are as good (a deck
 *  flush with its abutment), the line rides the deck. */
const DECK_FIRST_M = 0.02;

interface Candidate {
  deck: boolean;
  y: number;
}

function candidatesOf(s: LevelSample, fallback: LevelOptions["prefer"]) {
  const prefer = s.prefer ?? fallback;
  const out: { c: Candidate; cost: number }[] = [];
  if (s.ground !== null) {
    let cost = s.decks.length > 0 ? DECK_FIRST_M : 0;
    if (prefer === "deck" && s.decks.length > 0) {
      cost += AGAINST_M;
    }
    out.push({ c: { deck: false, y: s.ground }, cost });
  }
  for (const y of s.decks) {
    out.push({
      c: { deck: true, y },
      cost: prefer === "ground" ? AGAINST_M : 0,
    });
  }
  return out;
}

/** The cost of driving from height a to height b over `run` metres. */
function climbCost(a: number, b: number, run: number, grade: number): number {
  const excess = Math.abs(b - a) - grade * run - SLACK_M;
  return excess > 0 ? excess : 0;
}

/**
 * The cheapest path through the candidates (the ground, the decks) a line
 * with this grade drives, per sample; null where a sample has none (the
 * ground unknown and no deck: the caller breaks the line there).
 */
export function chooseLevels(
  samples: readonly LevelSample[],
  opts: LevelOptions
): (Level | null)[] {
  const out: (Level | null)[] = samples.map(() => null);
  let start = 0;
  while (start < samples.length) {
    while (
      start < samples.length &&
      candidatesOf(samples[start], opts.prefer).length === 0
    ) {
      start++;
    }
    let end = start;
    while (
      end < samples.length &&
      candidatesOf(samples[end], opts.prefer).length > 0
    ) {
      end++;
    }
    if (end > start) {
      viterbi(samples, start, end, opts, out);
    }
    start = end;
  }
  return out;
}

function viterbi(
  samples: readonly LevelSample[],
  start: number,
  end: number,
  opts: LevelOptions,
  out: (Level | null)[]
): void {
  const cands = [];
  for (let i = start; i < end; i++) {
    cands.push(candidatesOf(samples[i], opts.prefer));
  }
  const cost: number[][] = [cands[0].map((k) => k.cost)];
  const back: number[][] = [cands[0].map(() => -1)];
  for (let i = 1; i < cands.length; i++) {
    const run = samples[start + i].d - samples[start + i - 1].d;
    const row: number[] = [];
    const from: number[] = [];
    for (const k of cands[i]) {
      let best = Number.POSITIVE_INFINITY;
      let arg = 0;
      cands[i - 1].forEach((p, j) => {
        const c =
          cost[i - 1][j] +
          climbCost(p.c.y, k.c.y, run, opts.grade) +
          (p.c.deck === k.c.deck ? 0 : SWITCH_M);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      row.push(best + k.cost);
      from.push(arg);
    }
    cost.push(row);
    back.push(from);
  }
  const last = cost.at(-1) ?? [];
  let j = last.indexOf(Math.min(...last));
  for (let i = cands.length - 1; i >= 0; i--) {
    const { c } = cands[i][j];
    out[start + i] = { mode: c.deck ? "deck" : "ground", y: c.y };
    j = back[i][j];
  }
}

/**
 * How far below (sign 1) or above (sign −1) the line `y` lies at each
 * sample beyond what it can reach from that side: from the left
 * (`dir` 1) or the right (−1), the most a line through every sample within
 * `reach` at the grade lies above (below) it.
 */
function coneExcess(
  y: readonly number[],
  d: readonly number[],
  grade: number,
  reach: number,
  dir: 1 | -1,
  sign: 1 | -1
): number[] {
  const n = y.length;
  const out = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) {
    let most = 0;
    for (let j = i - dir; j >= 0 && j < n; j -= dir) {
      const run = Math.abs(d[i] - d[j]);
      if (run > reach) {
        break;
      }
      // how far the line through j, at the grade, stays beyond y_i
      const beyond = sign * (y[j] - y[i]) - grade * run - SLACK_M;
      most = Math.max(most, beyond);
    }
    out[i] = most;
  }
  return out;
}

/** Runs where a line lies beyond what it can reach from BOTH sides by a
 *  jump: [first, last] index pairs. */
function trappedRuns(
  y: readonly number[],
  d: readonly number[],
  grade: number,
  reach: number,
  sign: 1 | -1
): [number, number][] {
  const left = coneExcess(y, d, grade, reach, 1, sign);
  const right = coneExcess(y, d, grade, reach, -1, sign);
  const trapped = y.map((_, i) => Math.min(left[i], right[i]) >= LEVEL_JUMP_M);
  const runs: [number, number][] = [];
  let first = -1;
  for (let i = 0; i <= y.length; i++) {
    if (i < y.length && trapped[i]) {
      if (first < 0) {
        first = i;
      }
    } else if (first >= 0) {
      runs.push([first, i - 1]);
      first = -1;
    }
  }
  return runs;
}

/**
 * Spans the gaps and cuts the fills the chosen levels still jump into. A
 * sample the line cannot get down to from either side within its grade
 * (a drop that comes back up within LEVEL_SPAN_M) lies in a gap: the run
 * becomes a straight span between its rims (mode "span"), a deck at that
 * height riding along. A sample it cannot get up to from either side
 * (a rise that comes back down within LEVEL_CUT_M) lies in a fill: a
 * straight cut ("cut"). The rims are pushed out over the gap's or fill's
 * sloped sides (the DGM rounds every step into a ramp). A jump that never
 * comes back (a deck ending above lower ground) stays.
 */
export function bridgeJumps(
  levels: (Level | null)[],
  samples: readonly LevelSample[],
  opts: LevelOptions
): (Level | null)[] {
  const out = levels.map((l) => (l ? { ...l } : null));
  for (const [from, to] of knownRuns(out)) {
    const idx = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    const d = idx.map((i) => samples[i].d);
    for (const [mode, sign, reach] of [
      ["span", 1, LEVEL_SPAN_M],
      ["cut", -1, LEVEL_CUT_M],
    ] as const) {
      const y = idx.map((i) => (out[i] as Level).y);
      for (const [a, b] of trappedRuns(y, d, opts.grade, reach, sign)) {
        const [ra, rb] = rims(y, d, [a, b], opts.grade, sign, reach);
        if (ra < 0 || rb >= y.length) {
          continue; // a gap or fill at the line's end: nothing to join
        }
        joinRims(out, samples, from + ra, from + rb, mode);
      }
    }
  }
  return out;
}

/** The runs of consecutive known levels: [first, last] index pairs. */
function knownRuns(levels: readonly (Level | null)[]): [number, number][] {
  const runs: [number, number][] = [];
  let first = -1;
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && levels[i]) {
      if (first < 0) {
        first = i;
      }
    } else if (first >= 0) {
      runs.push([first, i - 1]);
      first = -1;
    }
  }
  return runs;
}

/**
 * The rims of a trapped run [a, b]: the nearest sample on each side that
 * stands a jump beyond the run's own end (out of the gap, up the fill),
 * pushed out over the sloped sides (the DGM rounds every step into a
 * ramp): past every sample that still rises away from the gap (falls away
 * from the fill) steeper than the grade. −1 / y.length when a side has
 * none within `reach`.
 */
function rims(
  y: readonly number[],
  d: readonly number[],
  [a, b]: [number, number],
  grade: number,
  sign: 1 | -1,
  reach: number
): [number, number] {
  const steep = (i: number, j: number) =>
    sign * (y[j] - y[i]) > grade * Math.abs(d[j] - d[i]) + RIM_SLACK_M;
  const out = (i: number, from: number) =>
    sign * (y[i] - y[from]) >= LEVEL_JUMP_M;
  let ra = a - 1;
  while (ra >= 0 && !out(ra, a)) {
    ra = d[a] - d[ra] > reach ? -1 : ra - 1;
  }
  while (ra > 0 && steep(ra, ra - 1)) {
    ra--;
  }
  let rb = b + 1;
  while (rb < y.length && !out(rb, b)) {
    rb = d[rb] - d[b] > reach ? y.length : rb + 1;
  }
  while (rb >= 0 && rb < y.length - 1 && steep(rb, rb + 1)) {
    rb++;
  }
  return [ra, rb];
}

/** A deck within this much (m) of a span rides it instead. */
const SPAN_DECK_M = 1;

/** Joins rims `from` and `to` with a straight line: what lies between
 *  becomes `mode`, except a deck that sits on the span (it is the span). */
function joinRims(
  out: (Level | null)[],
  samples: readonly LevelSample[],
  from: number,
  to: number,
  mode: "span" | "cut"
): void {
  const a = out[from];
  const b = out[to];
  const run = samples[to].d - samples[from].d;
  if (!(a && b) || run <= 0) {
    return;
  }
  for (let i = from + 1; i < to; i++) {
    const y = a.y + ((b.y - a.y) * (samples[i].d - samples[from].d)) / run;
    const deck =
      mode === "span"
        ? samples[i].decks.find((top) => Math.abs(top - y) <= SPAN_DECK_M)
        : undefined;
    out[i] = deck === undefined ? { mode, y } : { mode: "deck", y: deck };
  }
}

/** The level of every sample of a line: `chooseLevels`, then
 *  `bridgeJumps`. */
export function lineLevels(
  samples: readonly LevelSample[],
  opts: LevelOptions
): (Level | null)[] {
  return bridgeJumps(chooseLevels(samples, opts), samples, opts);
}

/** Runs of consecutive samples of one mode: [first, last] index pairs. */
export function modeRuns(
  levels: readonly (Level | null)[],
  mode: LevelMode
): [number, number][] {
  const runs: [number, number][] = [];
  let first = -1;
  for (let i = 0; i <= levels.length; i++) {
    const on = i < levels.length && levels[i]?.mode === mode;
    if (on && first < 0) {
      first = i;
    } else if (!on && first >= 0) {
      runs.push([first, i - 1]);
      first = -1;
    }
  }
  return runs;
}

/**
 * A stretch of a line off the ground, as the build step bakes it into the
 * line's feature (`lv`): [first, last] sample indices (at LEVEL_STEP), its
 * mode — "d" a deck, "s" a span, "c" a cut — and its height at both ends
 * (a span and a cut are straight between them; a deck rides the deck top
 * nearest that line). Every sample outside a run is on the ground.
 */
export type LevelRun = [number, number, "c" | "d" | "s", number, number];

const RUN_MODE = { deck: "d", span: "s", cut: "c" } as const;
const RUN_LEVEL = { d: "deck", s: "span", c: "cut" } as const;

/** The runs off the ground of a line's levels (`LevelRun`). */
export function encodeRuns(levels: readonly (Level | null)[]): LevelRun[] {
  const runs: LevelRun[] = [];
  for (const mode of ["deck", "span", "cut"] as const) {
    for (const [a, b] of modeRuns(levels, mode)) {
      runs.push([
        a,
        b,
        RUN_MODE[mode],
        Math.round((levels[a]?.y ?? 0) * 100) / 100,
        Math.round((levels[b]?.y ?? 0) * 100) / 100,
      ]);
    }
  }
  return runs.sort((p, q) => p[0] - q[0]);
}

/**
 * The baked level of sample `i` (`decodeRun`): its mode and the height
 * the run gives it (straight between the run's ends), or null on the
 * ground. `d` is each sample's distance along the line.
 */
export function runLevelAt(
  runs: readonly LevelRun[],
  d: readonly number[],
  i: number
): Level | null {
  for (const [a, b, mode, ya, yb] of runs) {
    if (i < a || i > b) {
      continue;
    }
    const run = d[b] - d[a];
    const t = run > 0 ? (d[i] - d[a]) / run : 0;
    return { mode: RUN_LEVEL[mode], y: ya + (yb - ya) * t };
  }
  return null;
}
