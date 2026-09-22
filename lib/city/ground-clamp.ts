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
