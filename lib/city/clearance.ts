/**
 * Keeping the camera out of the solid world — the pure half. The camera
 * never ends up below the ground or inside a building, whichever way it got
 * there: walking, flying, a scenic glide (also on its way), a double tap, a
 * snapshot, a GPS fix. camera-pose.ts applies these after every move; the
 * rays that find ground and roofs are the WebGL side's (collision.ts).
 * No THREE, no DOM.
 */

/** m the camera keeps above the ground (the near plane is 0.3 m). */
export const GROUND_CLEARANCE = 0.5;
/** m the camera keeps above a roof it was lifted out of. */
export const ROOF_CLEARANCE = 0.5;
/** m a walker is set out past the facade of the building they stood in. */
export const WALL_CLEARANCE = 1;
/** Stacked parts: a lift out of one roof may land inside the next. */
const MAX_ROOF_LIFTS = 8;
/** A lift clears the roof face itself, so the next probe starts above it. */
const ROOF_EPSILON = 1e-3;

/**
 * The lowest height at or above `y` where the camera is clear: at least
 * GROUND_CLEARANCE over `ground`, and — while a probe ROOF_CLEARANCE below
 * the eye is inside a building — ROOF_CLEARANCE over that building's roof.
 * `roofAbove(y)` answers for the point at height `y` on the camera's
 * column: the first surface above it when the point is inside a solid, else
 * null.
 */
export function clearHeight(
  y: number,
  ground: number,
  roofAbove: (y: number) => number | null
): number {
  let h = Math.max(y, ground + GROUND_CLEARANCE);
  for (let i = 0; i < MAX_ROOF_LIFTS; i += 1) {
    const roof = roofAbove(h - ROOF_CLEARANCE);
    if (roof === null) {
      return h;
    }
    h = Math.max(h, roof + ROOF_CLEARANCE + ROOF_EPSILON);
  }
  return h;
}

export interface NearestFreeOptions {
  /** m, the search gives up past this radius */
  maxRadius?: number;
  /** m, how far a found spot is pushed on past the building's edge */
  margin?: number;
  /** radians in the x/z plane (atan2(dz, dx)) to try first on each ring */
  preferAngle?: number;
  /** m between rings */
  step?: number;
}

/**
 * The spot nearest to (x, z) where `isFree` holds: (x, z) itself when free,
 * else the first free point on rings of growing radius, pushed on by
 * `margin` in the same direction when that is free too (so the walker does
 * not stand with their nose in the facade). null when nothing within
 * `maxRadius` is free.
 */
export function nearestFree(
  x: number,
  z: number,
  isFree: (x: number, z: number) => boolean,
  options: NearestFreeOptions = {}
): { x: number; z: number } | null {
  if (isFree(x, z)) {
    return { x, z };
  }
  const step = options.step ?? 1;
  const maxRadius = options.maxRadius ?? 150;
  const margin = options.margin ?? WALL_CLEARANCE;
  const start = options.preferAngle ?? 0;
  for (let r = step; r <= maxRadius; r += step) {
    const n = Math.min(64, Math.max(8, Math.ceil((2 * Math.PI * r) / step)));
    for (let k = 0; k < n; k += 1) {
      // 0, +1, −1, +2, −2 …: the preferred direction first, then its sides.
      const j = k % 2 === 0 ? k / 2 : -(k + 1) / 2;
      const a = start + (j * 2 * Math.PI) / n;
      const cx = x + Math.cos(a) * r;
      const cz = z + Math.sin(a) * r;
      if (isFree(cx, cz)) {
        const px = x + Math.cos(a) * (r + margin);
        const pz = z + Math.sin(a) * (r + margin);
        return isFree(px, pz) ? { x: px, z: pz } : { x: cx, z: cz };
      }
    }
  }
  return null;
}

/** A point of a glide's lift profile: parameter s ∈ [0, 1], lift in m. */
export interface LiftPoint {
  s: number;
  lift: number;
}

/**
 * The upper concave hull of `points` pinned to (0, 0) and (1, 0): the
 * least concave lift profile that clears every point — a glide climbs over
 * what lies on its way in straight lines, and never dips between two
 * obstacles.
 */
export function upperHull(points: readonly LiftPoint[]): LiftPoint[] {
  const sorted = [
    { s: 0, lift: 0 },
    ...points.filter((p) => p.s > 0 && p.s < 1 && p.lift > 0),
    { s: 1, lift: 0 },
  ].sort((a, b) => a.s - b.s || b.lift - a.lift);
  const hull: LiftPoint[] = [];
  for (const p of sorted) {
    while (hull.length >= 2) {
      const a = hull.at(-2) as LiftPoint;
      const b = hull.at(-1) as LiftPoint;
      // b lies on or under the chord a → p: it cannot be on the upper hull.
      const cross =
        (b.s - a.s) * (p.lift - a.lift) - (b.lift - a.lift) * (p.s - a.s);
      if (cross >= 0) {
        hull.pop();
      } else {
        break;
      }
    }
    if (hull.at(-1)?.s !== p.s) {
      hull.push(p);
    }
  }
  return hull;
}

/** The hull's lift at `s` (linear between its points, 0 outside). */
export function hullLift(hull: readonly LiftPoint[], s: number): number {
  for (let i = 1; i < hull.length; i += 1) {
    const a = hull[i - 1];
    const b = hull[i];
    if (s <= b.s) {
      if (s < a.s) {
        return 0;
      }
      const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 1;
      return a.lift + (b.lift - a.lift) * t;
    }
  }
  return 0;
}

/** Straight-line glide from `from` to `to` (world x/y/z). */
export interface GlideLine {
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
}

/** m between the obstacle samples along a glide. */
const GLIDE_SAMPLE_STEP = 2;
/** The samples a glide takes at most (a long glide spaces them wider). */
const GLIDE_MAX_SAMPLES = 480;

/**
 * The lift a glide needs above its straight line so its path keeps clear of
 * everything under it: `floorAt(x, z)` is the lowest height the camera may
 * pass at over (x, z) — the ground, or a roof, plus the clearance. Each
 * sample's need is widened to its neighbours' spacing, so a facade between
 * two samples is covered too, and the result is the hull through them.
 */
export function glideHull(
  line: GlideLine,
  floorAt: (x: number, z: number) => number
): LiftPoint[] {
  const { from, to } = line;
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.min(
    GLIDE_MAX_SAMPLES,
    Math.max(2, Math.ceil(dist / GLIDE_SAMPLE_STEP))
  );
  const ds = 1 / n;
  const points: LiftPoint[] = [];
  for (let i = 1; i < n; i += 1) {
    const s = i * ds;
    const x = from.x + (to.x - from.x) * s;
    const z = from.z + (to.z - from.z) * s;
    const y = from.y + (to.y - from.y) * s;
    const lift = floorAt(x, z) - y;
    if (lift > 0) {
      const lo = Math.max(s - ds, ds / 2);
      const hi = Math.min(s + ds, 1 - ds / 2);
      points.push({ s: lo, lift }, { s, lift }, { s: hi, lift });
    }
  }
  return upperHull(points);
}
