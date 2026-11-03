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

/**
 * The ground's slope at world (x, z): its rise (m per m) along world x
 * and along world z, from the ground SLOPE_STEP either side, each held
 * to ±1; [0, 0] where a side is off the terrain.
 */
export function groundSlope(
  ground: GroundContext,
  x: number,
  z: number
): [number, number] {
  const { x: e, y: n } = worldToEpsg(x, z, ground.offset);
  const east = ground.heightAt(e + SLOPE_STEP, n);
  const west = ground.heightAt(e - SLOPE_STEP, n);
  const north = ground.heightAt(e, n + SLOPE_STEP);
  const south = ground.heightAt(e, n - SLOPE_STEP);
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const alongX =
    east === null || west === null ? 0 : (east - west) / (2 * SLOPE_STEP);
  // world z runs south (z = -(northing - cy))
  const alongZ =
    north === null || south === null ? 0 : (south - north) / (2 * SLOPE_STEP);
  return [clamp(alongX), clamp(alongZ)];
}
