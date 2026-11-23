/**
 * Pure helpers for ground-clamped walking and world<->EPSG mapping.
 * No THREE, no DOM.
 *
 * World frame: three.js Y-up scene after the -90°-about-X rotation of the
 * data group — x = easting - cx, z = -(northing - cy), y = elevation.
 */

export interface RecenterOffset {
  cx: number;
  cy: number;
}

/**
 * What every layer needs to drape a feature: the ground at projected
 * coordinates and the recenter offset into the world frame.
 */
export interface GroundContext {
  /** ground elevation (world Y) at projected (x, y); null = off the terrain */
  heightAt: (x: number, y: number) => number | null;
  offset: RecenterOffset;
}

/** World (x, z) -> projected EPSG coordinates. */
export function worldToEpsg(
  x: number,
  z: number,
  offset: RecenterOffset
): { x: number; y: number } {
  return { x: x + offset.cx, y: offset.cy - z };
}

/** Projected EPSG coordinates -> world (x, z). */
export function epsgToWorld(
  x: number,
  y: number,
  offset: RecenterOffset
): { x: number; z: number } {
  return { x: x - offset.cx, z: -(y - offset.cy) };
}

/**
 * Frame-rate-independent exponential approach toward a target height.
 * Smooths the eye over the resampled (~4 m) DGM grid so slopes feel like
 * walking instead of stair-stepping. `tau` is the time constant in seconds;
 * tau <= 0 snaps immediately.
 */
export function approachHeight(
  current: number,
  target: number,
  dt: number,
  tau: number
): number {
  if (tau <= 0) {
    return target;
  }
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** How far apart (m) `groundSlope` reads the ground across a point. */
export const SLOPE_STEP = 1.5;

const holdToOne = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * The ground's slope at world (x, z): its rise (m per m) along world x
 * and along world z, from the ground SLOPE_STEP either side, each held
 * to ±1; on the terrain's edge one-sided from the point itself, 0 along
 * an axis it cannot read.
 */
export function groundSlope(
  ground: GroundContext,
  x: number,
  z: number
): [number, number] {
  const { x: e, y: n } = worldToEpsg(x, z, ground.offset);
  // read only where a side is missing (`rise`): most feet have all four
  let read = false;
  let at: number | null = null;
  const here = (): number | null => {
    if (!read) {
      at = ground.heightAt(e, n);
      read = true;
    }
    return at;
  };
  const east = ground.heightAt(e + SLOPE_STEP, n);
  const west = ground.heightAt(e - SLOPE_STEP, n);
  const north = ground.heightAt(e, n + SLOPE_STEP);
  const south = ground.heightAt(e, n - SLOPE_STEP);
  const alongX = rise(west, here, east);
  // world z runs south (z = -(northing - cy))
  const alongZ = rise(north, here, south);
  return [holdToOne(alongX), holdToOne(alongZ)];
}

/** The rise from `before` to `after` (m per m) across a point read
 *  SLOPE_STEP either side, one-sided from `here` (read on demand) where a
 *  side is missing. */
function rise(
  before: number | null,
  hereAt: () => number | null,
  after: number | null
): number {
  if (before !== null && after !== null) {
    return (after - before) / (2 * SLOPE_STEP);
  }
  const here = hereAt();
  if (here === null) {
    return 0;
  }
  if (after !== null) {
    return (after - here) / SLOPE_STEP;
  }
  return before === null ? 0 : (here - before) / SLOPE_STEP;
}
