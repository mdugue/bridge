/**
 * How a part that stands on the ground meets it (ADR 0035). DOM-free,
 * THREE-free, pure.
 *
 * The ground is the bare-earth DGM1, which rounds every step a city has —
 * a kerb, a quay wall, a flight of steps, a bridge's abutment — into a
 * ramp one to two metres wide. Every part that stands on it (kerb stones,
 * walls, stairs, bridge decks, fences, sheds, furniture …) therefore meets
 * a ground that is *not* where its edge is, and each layer once answered
 * that on its own: the kerb stood a second step on the pavement, the wall's
 * cap ended before the ramp did, the deck stopped in the air, the flight
 * sat in a trench. The answers have one shape, kept here:
 *
 * - **feet go under** — whatever a part stands on reaches below the ground
 *   by its `SINK`, so no gap shows under it, whatever the ground does
 *   between two samples;
 * - **edges meet the ground** — where a part's top surface ends on the
 *   ground side, it ends at the ground's level (`meetGround`), or it runs on
 *   until the ground reaches its level (`reachLevel`): never a step the
 *   data does not have;
 * - **per-sample decisions are smoothed along the part** (`farthestNear`),
 *   so a noisy measurement does not turn an edge into a sawtooth.
 *
 * And each part reports where it meets the ground (`JoinPoint`), so one
 * check (`checkJoins`, scripts/ground-joins.test.ts over every committed
 * tile) holds every layer — and every layer added later — to those rules.
 */

/** Ground height at an EPSG point (m), or null off the known ground. */
export type HeightAt = (x: number, y: number) => number | null;

/**
 * How far below the ground a part's foot reaches (m): the ground between
 * two samples (a TIN triangle, 0.15 m from the DGM; a 2 m grid cell) must
 * not open a gap under it. Deeper for a part whose foot is sampled sparsely
 * or sits on rough ground; one table, so a new part picks a row rather
 * than a number.
 */
export const SINK = {
  /** a low band sampled every 2.5 m: fences */
  band: 0.05,
  /** a stone sampled every 2.5 m on smooth street ground: kerbs */
  kerb: 0.06,
  /** a box on one ground sample (its centre): sheds, garden houses */
  box: 0.2,
  /** a ground patch or apron drawn on the ground: furniture's paving */
  patch: 0.2,
  /** shapes on rough, planted ground: hedges, vine rows */
  planted: 0.25,
  /** a measured relief smoothed at runtime: monuments */
  relief: 0.25,
  /** a wall's foot below its low shelf */
  wall: 0.4,
  /** a flight's cheeks below its bottom landing: a solid block */
  stair: 0.6,
} as const;

/** How far an edge may stand above the ground it meets (m) before it reads
 *  as a step — measured on the very ground the part was built on (the
 *  check reads the ground the builder read, so no TIN error enters): a
 *  kerb's 12 cm reads, a hair against z-fighting does not. */
export const EDGE_TOLERANCE_M = 0.05;

/**
 * The height an edge of a part's top should end at where it meets the
 * ground: `lift` above the ground there (a hair, against z-fighting), never
 * above the part's own top and never below `floor` (what the part must
 * stay above — the road a kerb holds back). Null ground: the top.
 */
export function meetGround(
  top: number,
  ground: number | null,
  opts: { floor?: number; lift?: number } = {}
): number {
  if (ground === null) {
    return top;
  }
  const lift = opts.lift ?? 0.01;
  const floor = opts.floor ?? Number.NEGATIVE_INFINITY;
  return Math.min(top, Math.max(ground + lift, floor));
}

export interface ReachOptions {
  /** an unknown ground on the way ends the search (null) or is stepped
   *  over */
  onUnknown?: "skip" | "stop";
  /** the farthest distance searched (m) */
  reach: number;
  /** the search step (m) */
  step: number;
  /** the ground counts as reaching the level this far below it (m) */
  tolerance?: number;
}

/**
 * The first distance d (0, step, 2·step … reach) out from a part's edge at
 * which the ground comes up to the part's level there: `groundAt(d)` ≥
 * `levelAt(d)` − tolerance. A flat level is a coping cap running back
 * until the ground behind it meets it; a falling one is a ramp running out
 * until it lands. Null when the ground does not come up within reach (or,
 * with `onUnknown: "stop"`, is unknown on the way).
 */
export function reachLevel(
  groundAt: (d: number) => number | null,
  levelAt: (d: number) => number,
  opts: ReachOptions
): number | null {
  const tolerance = opts.tolerance ?? 0;
  const n = Math.floor(opts.reach / opts.step + 1e-9);
  for (let k = 0; k <= n; k++) {
    const d = k * opts.step;
    const g = groundAt(d);
    if (g === null) {
      if (opts.onUnknown === "stop") {
        return null;
      }
      continue;
    }
    if (g >= levelAt(d) - tolerance) {
      return d;
    }
  }
  return null;
}

/**
 * Per-sample values along a part carried over to their neighbours: each
 * becomes the farthest (`sign` +1: the largest, −1: the smallest) of the
 * values within `radius` samples that share its `group` (null stays null
 * and is not carried). A cap's back edge, decided per column on noisy
 * ground, then runs as a steady line instead of a sawtooth.
 */
export function farthestNear(
  values: readonly (number | null)[],
  radius: number,
  sign: (i: number) => 1 | -1,
  group: (i: number) => unknown = () => 0
): (number | null)[] {
  return values.map((v, i) => {
    if (v === null) {
      return null;
    }
    const s = sign(i);
    const g = group(i);
    let far = v;
    for (let k = i - radius; k <= i + radius; k++) {
      const other = values[k];
      if (other !== null && other !== undefined && group(k) === g) {
        far = s > 0 ? Math.max(far, other) : Math.min(far, other);
      }
    }
    return far;
  });
}

/**
 * Where a part meets the ground, in EPSG x, y and its elevation z:
 * - `foot` — it stands there, so it must reach the ground (z at or below
 *   it): a foot above the ground is a part floating;
 * - `edge` — its top surface ends there on the ground side, so it must not
 *   stand above the ground by more than EDGE_TOLERANCE_M: higher is a step
 *   the data does not have (below is a part tucked under the ground, fine).
 */
export interface JoinPoint {
  kind: "edge" | "foot";
  x: number;
  y: number;
  z: number;
}

/** A point of a part in EPSG x, y and its elevation z. */
export interface JoinEnd {
  x: number;
  y: number;
  z: number;
}

/** How far apart joins are sampled along a part's foot or edge (m): the
 *  ground between two of its columns is where a gap opens. */
export const JOIN_EVERY_M = 1;

/**
 * The joins of one straight span of a part's foot or edge, from `a` to `b`
 * (b excluded: the next span starts there), its height linear between
 * them as the drawn quad's is — every JOIN_EVERY_M, so the check reads the
 * ground between the part's columns, not only under them.
 */
export function joinsAlong(
  kind: JoinPoint["kind"],
  a: JoinEnd,
  b: JoinEnd,
  every = JOIN_EVERY_M
): JoinPoint[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / every));
  const out: JoinPoint[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / n;
    out.push({
      kind,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    });
  }
  return out;
}

/** A join that breaks its rule, and by how much (m, > 0). */
export interface JoinMiss {
  by: number;
  join: JoinPoint;
}

/** What `checkJoins` found for one part kind. */
export interface JoinReport {
  edges: number;
  feet: number;
  /** joins over unknown ground, not judged */
  unknown: number;
  /** the misses, worst first */
  misses: JoinMiss[];
}

/** A foot may stand this far above the ground and still count as on it
 *  (m): the ground the check reads is the DGM, the part stood on the TIN. */
const FOOT_SLACK_M = 0.02;

/** Every join measured against the ground (ADR 0035). */
export function checkJoins(
  joins: readonly JoinPoint[],
  heightAt: HeightAt,
  tolerance = EDGE_TOLERANCE_M
): JoinReport {
  const report: JoinReport = { edges: 0, feet: 0, unknown: 0, misses: [] };
  for (const join of joins) {
    const g = heightAt(join.x, join.y);
    if (g === null) {
      report.unknown++;
      continue;
    }
    const above = join.z - g;
    if (join.kind === "foot") {
      report.feet++;
      if (above > FOOT_SLACK_M) {
        report.misses.push({ join, by: above });
      }
    } else {
      report.edges++;
      if (above > tolerance) {
        report.misses.push({ join, by: above - tolerance });
      }
    }
  }
  report.misses.sort((a, b) => b.by - a.by);
  return report;
}
