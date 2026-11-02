/**
 * Where *Frag die Stadt*'s `zeige` puts the camera (ADR 0056): a vantage
 * on the places the tools found. From the air (the default) the view is
 * computed from the places' footprints and heights, `frameTargets`: the
 * pitch from how tall and how spread they are, the distance that fits
 * every one of them into the screen as it is shaped, and the heading the
 * best of twelve — near, from the side the visitor comes from, the sun
 * behind the camera, the places beside rather than behind each other,
 * and none hidden behind a building the scene has loaded or behind the
 * ground. The eye's height is taken over the ground beneath the eye, not
 * the places' (on a slope the two differ by the slope), and an eye a
 * hillside would bury backs off along its sight line until it stands
 * clear. On foot
 * (`streetView`) the walker stands in front of one, far enough back to see
 * it whole. Pure: the card hands the result to the scene's glide.
 */
import type { ViewpointGeometry } from "./site";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** A place to show, as the knowledge tools return it (site CRS, m). */
export interface AskTarget {
  /** height above its ground, where the tools know it */
  h?: number;
  /** the radius of its footprint, where the tools know it */
  r?: number;
  x: number;
  y: number;
  /** the ground at its base (m a.s.l.), where the tools know it */
  z?: number;
}

/** Eye height on foot (m). */
const EYE = 1.6;
/** The lens every `zeige` view uses: its vertical opening (°). */
export const ASK_FOV = 60;

/**
 * The farthest an aerial view of several places stands off them (m):
 * beyond it a 20 m house is a few pixels on a phone and the fog nears
 * (on a phone the stream ends at 2.2 km). Further spread places are
 * shown one at a time, from their chips.
 */
export const AERIAL_REACH = 900;

/**
 * On foot: the walker on the street in front of `target`, on the side of
 * `from` (the camera's place now; straight from the south where it stands
 * on the target), far enough back to see it whole. The pitch takes the
 * eye's ground for the target's unless `groundAt` knows both: on a slope
 * the walker looks up or down to it.
 */
export function streetView(
  target: AskTarget,
  from: { x: number; y: number },
  groundAt?: (x: number, y: number) => number | null
): ViewpointGeometry {
  const h = Math.max(target.h ?? 15, 4);
  let dx = from.x - target.x;
  let dy = from.y - target.y;
  if (Math.hypot(dx, dy) < 1) {
    dx = 0;
    dy = -1;
  }
  const len = Math.hypot(dx, dy);
  // its height across the lens, and a street; wider than it is tall, its
  // footprint's width too
  const back = Math.max(35, h * 1.4 + 15, (target.r ?? 0) * 2.2);
  const ex = target.x + (dx / len) * back;
  const ey = target.y + (dy / len) * back;
  // look at a third of its height, from the eye's ground to its own
  const foot = target.z ?? groundAt?.(target.x, target.y) ?? null;
  const stand = groundAt?.(ex, ey) ?? null;
  const rise = foot !== null && stand !== null ? foot - stand : 0;
  const pitch = Math.atan2(rise + h * 0.35 - EYE, back) * DEG;
  const heading = (Math.atan2(target.x - ex, target.y - ey) * DEG + 360) % 360;
  return {
    epsg: { x: round1(ex), y: round1(ey) },
    aboveGround: EYE,
    headingDeg: round1(heading),
    pitchDeg: round1(Math.max(-60, Math.min(35, pitch))),
    fov: ASK_FOV,
    mode: "walk",
  };
}

// --- from the air -----------------------------------------------------------------

/** A point in the site's CRS, `z` metres above sea level. */
export interface SitePoint {
  x: number;
  y: number;
  z: number;
}

/** What the framing reads of the moment beyond the places. */
export interface FrameContext {
  /** the screen's width over its height */
  aspect: number;
  /** where the camera stands now (site CRS) */
  from: { x: number; y: number } | null;
  /**
   * The first building a sight line meets between `eye` and `point`, or
   * null — the scene's loaded buildings (a tile without its BVH is not
   * asked). Absent: nothing is hidden.
   */
  sightHit?: (eye: SitePoint, point: SitePoint) => SitePoint | null;
  /** towards the sun, east and north (any length), or null by night */
  sun?: { east: number; north: number } | null;
  /**
   * The terrain's height at a point of the site (m a.s.l.), or null where
   * none is loaded. Absent: the ground is flat at the places' foot.
   */
  groundAt?: (x: number, y: number) => number | null;
}

type GroundAt = NonNullable<FrameContext["groundAt"]>;

/** A computed vantage: the view and how far its eye stands off the aim. */
export interface Framed {
  /** from the eye to the middle of the places (m) */
  distance: number;
  view: ViewpointGeometry;
}

/** How many headings are tried, evenly round the compass. */
const HEADINGS = 12;
/** Room around the places: the lens's half-width over theirs. */
const MARGIN = 1.15;
/** The nearest a place's point comes to the eye (m). */
const NEAR_PLANE = 10;
/** How many of the best headings have their sight lines drawn: each
 *  costs a ray per place's top and middle, on the main thread. */
const SIGHT_CANDIDATES = 4;
/** The nearest an aerial eye comes (m): a fountain is not seen from 5 m. */
const MIN_DISTANCE = 60;
/** A place without a known height is framed as if it had this (m). */
const DEFAULT_HEIGHT = 12;
/** A place without a known footprint is framed as if it had this (m). */
const DEFAULT_RADIUS = 8;
/** The pitch below the horizon for a lone tall place and for flat or
 *  spread ones (°). */
const PITCH_TALL = 30;
const PITCH_FLAT = 55;

/** The least an aerial eye stands over the ground beneath it (m). */
const CLEARANCE = 25;
/** How far an eye a slope would bury backs off each step, and how often:
 *  1.2⁸ ≈ 4.3 times its distance at most. */
const BACK_OFF = 1.2;
const BACK_OFF_STEPS = 8;
/** Where a sight line asks the terrain, as shares of its length. */
const TERRAIN_STEPS = 12;

/** How much each judgement weighs in a heading's score. */
const WEIGHTS = { near: 1, from: 0.8, sun: 0.5, beside: 0.6, seen: 3 };

interface Sample {
  /** the place it belongs to */
  i: number;
  /** whether a sight line goes to it (its top and its middle) */
  sight: boolean;
  x: number;
  y: number;
  z: number;
}

/** Each place's points the view must hold: foot and top, at its centre
 *  and round its footprint. Places without a ground take the others' —
 *  a guess the frame survives, a sight line does not: theirs are not
 *  drawn. */
function samples(
  targets: readonly AskTarget[],
  groundAt: GroundAt | undefined
): Sample[] {
  // a place without its ground stands on the terrain, where that is known
  const footOf = (t: AskTarget) => t.z ?? groundAt?.(t.x, t.y) ?? undefined;
  const feet = targets.map(footOf);
  const known = feet.filter((z): z is number => z !== undefined);
  const ground =
    known.length > 0 ? known.reduce((s, z) => s + z, 0) / known.length : 0;
  return targets.flatMap((t, i) => {
    const z = feet[i] ?? ground;
    const h = Math.max(t.h ?? DEFAULT_HEIGHT, 3);
    const r = Math.max(t.r ?? DEFAULT_RADIUS, 2);
    const ring = [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ];
    const sight = feet[i] !== undefined;
    return [
      { i, sight, x: t.x, y: t.y, z: z + h },
      { i, sight, x: t.x, y: t.y, z: z + h * 0.6 },
      ...ring.flatMap(([dx, dy]) => [
        { i, sight: false, x: t.x + dx, y: t.y + dy, z },
        { i, sight: false, x: t.x + dx, y: t.y + dy, z: z + h },
      ]),
    ];
  });
}

/** The camera's axes for a heading and a pitch below the horizon (°):
 *  forward, right and up, east-north-up. */
function axes(headingDeg: number, pitchDeg: number) {
  const t = headingDeg * RAD;
  const p = pitchDeg * RAD;
  return {
    f: [Math.sin(t) * Math.cos(p), Math.cos(t) * Math.cos(p), -Math.sin(p)],
    r: [Math.cos(t), -Math.sin(t), 0],
    u: [Math.sin(t) * Math.sin(p), Math.cos(t) * Math.sin(p), Math.cos(p)],
  };
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The pitch for places this tall and this spread (°, below the horizon). */
function pitchFor(points: readonly Sample[], aim: SitePoint): number {
  let spread = 0;
  let top = 0;
  for (const p of points) {
    spread = Math.max(spread, Math.hypot(p.x - aim.x, p.y - aim.y));
    top = Math.max(top, p.z - aim.z);
  }
  // a tower alone: low, to see its height; a square of houses: steep
  const tall = (2 * top) / (2 * top + 2 * spread);
  return PITCH_FLAT - (PITCH_FLAT - PITCH_TALL) * Math.min(1, tall * 1.3);
}

/** The middle of the points' box. */
function middle(points: readonly Sample[]): SitePoint {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const v = [p.x, p.y, p.z];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  }
  return {
    x: (lo[0] + hi[0]) / 2,
    y: (lo[1] + hi[1]) / 2,
    z: (lo[2] + hi[2]) / 2,
  };
}

interface Candidate {
  distance: number;
  eye: SitePoint;
  heading: number;
  /** how far the places spread across the view over how far in depth */
  beside: number;
}

/** The heading's eye: as near as holds every point within the lens,
 *  backed off along its axis where the ground beneath would bury it. */
function candidate(
  points: readonly Sample[],
  aim: SitePoint,
  heading: number,
  pitch: number,
  aspect: number,
  groundAt: GroundAt | undefined
): Candidate {
  const { f, r, u } = axes(heading, pitch);
  // the lens narrowed by the margin: room round the places on every side
  const tanV = Math.tan((ASK_FOV / 2) * RAD) / MARGIN;
  const tanH = tanV * Math.max(aspect, 0.2);
  let distance = 0;
  let across = 0;
  let deep = 0;
  for (const p of points) {
    const q = [p.x - aim.x, p.y - aim.y, p.z - aim.z];
    const x = dot(q, r);
    const y = dot(q, u);
    const z = dot(q, f);
    // the point lies `distance + z` before the eye: it fits once that
    // depth spans its offset across the lens
    distance = Math.max(
      distance,
      Math.max(Math.abs(x) / tanH, Math.abs(y) / tanV, NEAR_PLANE) - z
    );
    across = Math.max(across, Math.abs(x));
    deep = Math.max(deep, Math.abs(z));
  }
  distance = Math.max(distance, MIN_DISTANCE);
  const eyeAt = (d: number): SitePoint => ({
    x: aim.x - f[0] * d,
    y: aim.y - f[1] * d,
    z: aim.z - f[2] * d,
  });
  let eye = eyeAt(distance);
  // further back along a downward axis is higher: it clears a slope that
  // climbs towards the eye less steeply than the view looks down
  for (let k = 0; groundAt && k < BACK_OFF_STEPS; k++) {
    const under = groundAt(eye.x, eye.y);
    if (under === null || eye.z >= under + CLEARANCE) {
      break;
    }
    distance *= BACK_OFF;
    eye = eyeAt(distance);
  }
  return {
    heading,
    distance,
    eye,
    beside: across / (across + deep + 1e-6),
  };
}

/** Whether the terrain rises above the line from `eye` to `point`. */
function groundCuts(eye: SitePoint, point: SitePoint, groundAt: GroundAt) {
  for (let k = 1; k < TERRAIN_STEPS; k++) {
    const t = k / TERRAIN_STEPS;
    const under = groundAt(
      eye.x + (point.x - eye.x) * t,
      eye.y + (point.y - eye.y) * t
    );
    if (under !== null && under > eye.z + (point.z - eye.z) * t) {
      return true;
    }
  }
  return false;
}

/** The unit plan vector from `a` towards `b`, or null where they meet. */
function towards(
  a: { x: number; y: number },
  b: { x: number; y: number }
): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len < 1 ? null : [dx / len, dy / len];
}

/** How far two plan directions agree, 0 (opposed) to 1; ½ without one. */
function agreement(
  a: readonly [number, number] | number[],
  b: readonly [number, number] | null
): number {
  return b ? (1 + a[0] * b[0] + a[1] * b[1]) / 2 : 0.5;
}

/** The share of the places' sight lines neither the ground nor (where
 *  `sightHit` is given) another building cuts. */
function seenShare(
  c: Candidate,
  points: readonly Sample[],
  targets: readonly AskTarget[],
  groundAt: GroundAt | undefined,
  sightHit: FrameContext["sightHit"]
): number {
  let lines = 0;
  let seen = 0;
  for (const p of points) {
    if (!p.sight) {
      continue;
    }
    lines++;
    if (groundAt && groundCuts(c.eye, p, groundAt)) {
      continue;
    }
    const hit = sightHit ? sightHit(c.eye, p) : null;
    const t = targets[p.i];
    // a hit on the place itself (its own roof before its top) is a sight
    const own = Math.max(t.r ?? DEFAULT_RADIUS, 2) * 1.2 + 3;
    if (!hit || Math.hypot(hit.x - t.x, hit.y - t.y) <= own) {
      seen++;
    }
  }
  return lines === 0 ? 1 : seen / lines;
}

/**
 * The aerial vantage that holds every one of `targets`. Each of twelve
 * headings gets the nearest eye that fits them all into a lens of
 * `ASK_FOV` on a screen of `context.aspect`; the headings are scored on
 * that nearness, on coming from the visitor's side (no turn about), on
 * the sun behind the camera (lit facades), on the places standing beside
 * rather than behind each other, and — heaviest — on the sight lines to
 * their tops that neither the ground nor a loaded building cuts. The
 * eye's height is given over the ground beneath the eye (`groundAt`;
 * without it, over the places' foot), which is how the glide reads it.
 */
export function frameTargets(
  targets: readonly AskTarget[],
  context: FrameContext
): Framed {
  if (targets.length === 0) {
    throw new Error("frameTargets: nothing to frame");
  }
  const { groundAt } = context;
  const points = samples(targets, groundAt);
  const aim = middle(points);
  const pitch = pitchFor(points, aim);
  const candidates = Array.from({ length: HEADINGS }, (_, k) =>
    candidate(
      points,
      aim,
      (k * 360) / HEADINGS,
      pitch,
      context.aspect,
      groundAt
    )
  );
  const nearest = Math.min(...candidates.map((c) => c.distance));
  const comeFrom = context.from ? towards(aim, context.from) : null;
  const sun = context.sun
    ? towards({ x: 0, y: 0 }, { x: context.sun.east, y: context.sun.north })
    : null;
  const scored = candidates
    .map((c) => {
      // the ground's cut is cheap (a few height lookups): every heading
      const ground = groundAt
        ? seenShare(c, points, targets, groundAt, undefined)
        : 0;
      // where the eye stands, seen from the aim
      const back = towards(aim, c.eye) ?? [0, -1];
      const score =
        WEIGHTS.near * (nearest / c.distance) +
        WEIGHTS.from * agreement(back, comeFrom) +
        WEIGHTS.sun * agreement(back, sun) +
        WEIGHTS.beside * (targets.length > 1 ? c.beside : 0.5) +
        WEIGHTS.seen * ground;
      return { c, score, ground };
    })
    .sort((a, b) => b.score - a.score);
  // the buildings' sight lines weigh as much and cost most: drawn for the
  // best few headings only, which then compete on ground and buildings
  const sightHit = context.sightHit;
  const finalists = scored.slice(0, sightHit ? SIGHT_CANDIDATES : 1);
  if (sightHit) {
    for (const s of finalists) {
      s.score +=
        WEIGHTS.seen *
        (seenShare(s.c, points, targets, groundAt, sightHit) - s.ground);
    }
  }
  const best = finalists.reduce((a, b) => (b.score > a.score ? b : a)).c;
  const foot = Math.min(...points.map((p) => p.z));
  const under = groundAt?.(best.eye.x, best.eye.y) ?? null;
  // an eye the back-off could not lift clear of a steep slope still
  // stands clear over the ground beneath it (the glide sets it there)
  const above =
    under === null
      ? best.eye.z - foot
      : Math.max(best.eye.z - under, CLEARANCE);
  return {
    distance: Math.round(best.distance),
    view: {
      epsg: { x: round1(best.eye.x), y: round1(best.eye.y) },
      aboveGround: Math.round(above),
      headingDeg: best.heading,
      pitchDeg: -round1(pitch),
      fov: ASK_FOV,
      mode: "fly",
    },
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * A place to frame from its triangles in the scene's Y-up world (x, y up,
 * z): the centre of its footprint, its foot and height, its footprint's
 * radius — what a selection's "Alle zeigen" frames by. Null for none.
 */
export function boundsTarget(
  positions: ArrayLike<number>
): { x: number; z: number; foot: number; h: number; r: number } | null {
  if (positions.length < 3) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = minX;
  let minZ = minX;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = maxX;
  let maxZ = maxX;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    foot: minY,
    h: maxY - minY,
    r: Math.hypot(maxX - minX, maxZ - minZ) / 2,
  };
}
