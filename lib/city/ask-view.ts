/**
 * Where *Frag die Stadt*'s `zeige` puts the camera (ADR 0056): a vantage
 * on the places the tools found. From the air (the default) the view is
 * computed from the places' footprints and heights, `frameTargets`: the
 * pitch from how tall and how spread they are, the distance that fits
 * every one of them into the screen as it is shaped, and the heading the
 * best of twelve — near, from the side the visitor comes from, the sun
 * behind the camera, the places beside rather than behind each other,
 * and none hidden behind a building the scene has loaded. On foot
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
 * On foot: the walker on the street in front of `target`, on the side of
 * `from` (the camera's place now; straight from the south where it stands
 * on the target), far enough back to see it whole. The pitch takes the
 * eye's ground for the target's (the scene measures the real one on
 * arrival).
 */
export function streetView(
  target: AskTarget,
  from: { x: number; y: number }
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
  // look at a third of its height
  const pitch = Math.atan2(h * 0.35 - EYE, back) * DEG;
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
}

/** A computed vantage: the view and how far its eye stands off the aim. */
export interface Framed {
  /** from the eye to the middle of the places (m) */
  distance: number;
  view: ViewpointGeometry;
}

/** How many headings are tried, evenly round the compass. */
const HEADINGS = 12;
/** Room around the places: the fitted distance times this. */
const MARGIN = 1.15;
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
 *  and round its footprint. Places without a ground take the others'. */
function samples(targets: readonly AskTarget[]): Sample[] {
  const known = targets.filter((t) => t.z !== undefined);
  const ground =
    known.length > 0
      ? known.reduce((s, t) => s + (t.z ?? 0), 0) / known.length
      : 0;
  return targets.flatMap((t, i) => {
    const z = t.z ?? ground;
    const h = Math.max(t.h ?? DEFAULT_HEIGHT, 3);
    const r = Math.max(t.r ?? DEFAULT_RADIUS, 2);
    const ring = [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ];
    return [
      { i, sight: true, x: t.x, y: t.y, z: z + h },
      { i, sight: true, x: t.x, y: t.y, z: z + h * 0.6 },
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

/** The heading's eye: as near as holds every point within the lens. */
function candidate(
  points: readonly Sample[],
  aim: SitePoint,
  heading: number,
  pitch: number,
  aspect: number
): Candidate {
  const { f, r, u } = axes(heading, pitch);
  const tanV = Math.tan((ASK_FOV / 2) * RAD);
  const tanH = tanV * Math.max(aspect, 0.2);
  let distance = 0;
  let across = 0;
  let deep = 0;
  for (const p of points) {
    const q = [p.x - aim.x, p.y - aim.y, p.z - aim.z];
    const x = dot(q, r);
    const y = dot(q, u);
    const z = dot(q, f);
    distance = Math.max(
      distance,
      z + Math.max(Math.abs(x) / tanH, Math.abs(y) / tanV)
    );
    across = Math.max(across, Math.abs(x));
    deep = Math.max(deep, Math.abs(z));
  }
  distance = Math.max(distance * MARGIN, MIN_DISTANCE);
  return {
    heading,
    distance,
    eye: {
      x: aim.x - f[0] * distance,
      y: aim.y - f[1] * distance,
      z: aim.z - f[2] * distance,
    },
    beside: across / (across + deep + 1e-6),
  };
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

/** The share of the places' sight lines no other building cuts. */
function seenShare(
  c: Candidate,
  points: readonly Sample[],
  targets: readonly AskTarget[],
  sightHit: NonNullable<FrameContext["sightHit"]>
): number {
  let lines = 0;
  let seen = 0;
  for (const p of points) {
    if (!p.sight) {
      continue;
    }
    lines++;
    const hit = sightHit(c.eye, p);
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
 * their tops that no loaded building cuts. The eye's height is taken
 * above the places' ground (the scene's glide measures the real one).
 */
export function frameTargets(
  targets: readonly AskTarget[],
  context: FrameContext
): Framed {
  if (targets.length === 0) {
    throw new Error("frameTargets: nothing to frame");
  }
  const points = samples(targets);
  const aim = middle(points);
  const pitch = pitchFor(points, aim);
  const candidates = Array.from({ length: HEADINGS }, (_, k) =>
    candidate(points, aim, (k * 360) / HEADINGS, pitch, context.aspect)
  );
  const nearest = Math.min(...candidates.map((c) => c.distance));
  const comeFrom = context.from ? towards(aim, context.from) : null;
  const sun = context.sun
    ? towards({ x: 0, y: 0 }, { x: context.sun.east, y: context.sun.north })
    : null;
  const scored = candidates.map((c) => {
    // where the eye stands, seen from the aim
    const back = towards(aim, c.eye) ?? [0, -1];
    const score =
      WEIGHTS.near * (nearest / c.distance) +
      WEIGHTS.from *
        (comeFrom
          ? (1 + back[0] * comeFrom[0] + back[1] * comeFrom[1]) / 2
          : 0.5) +
      WEIGHTS.sun *
        (sun ? (1 + back[0] * sun[0] + back[1] * sun[1]) / 2 : 0.5) +
      WEIGHTS.beside * (targets.length > 1 ? c.beside : 0.5) +
      WEIGHTS.seen *
        (context.sightHit
          ? seenShare(c, points, targets, context.sightHit)
          : 1);
    return { c, score };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a)).c;
  const ground = Math.min(...points.map((p) => p.z));
  return {
    distance: Math.round(best.distance),
    view: {
      epsg: { x: round1(best.eye.x), y: round1(best.eye.y) },
      aboveGround: Math.round(best.eye.z - ground),
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
