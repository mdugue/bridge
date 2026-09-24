import type { Xyz } from "./pose";

/**
 * Where a ray first meets the ground, found by marching over a height
 * function instead of intersecting triangles: the terrain is a regular grid,
 * so its height at any point is a bilinear sample (`heightAt`), and a ray
 * test needs no index at all. It replaces a BVH over the fine terrain tiles
 * (≈ 2 M triangles each, about a second to build per tile) that served only
 * two rays: double-tap travel and the crosshair autofocus.
 *
 * Coordinates are the viewer's world frame (Y up); `groundAt(x, z)` returns
 * the ground elevation there, or null off the loaded terrain. Steps grow
 * with distance (a fraction of the range so far, never below `minStep`), so
 * a far ray costs a few hundred samples; the first step that ends below
 * ground is refined by bisection.
 */
export interface GroundRayOptions {
  /** longest distance to search (m) */
  far: number;
  /** smallest step (m); the ground's features are grid cells of ~2 m */
  minStep?: number;
  /** step as a fraction of the distance already travelled */
  stepFraction?: number;
}

export function groundRayDistance(
  origin: Xyz,
  direction: Xyz,
  groundAt: (x: number, z: number) => number | null,
  { far, minStep = 1, stepFraction = 0.01 }: GroundRayOptions
): number | null {
  const below = (t: number): boolean | null => {
    const h = groundAt(origin.x + direction.x * t, origin.z + direction.z * t);
    return h === null ? null : origin.y + direction.y * t <= h;
  };
  let prev = 0;
  let t = minStep;
  while (t <= far) {
    if (below(t) === true) {
      // The crossing lies in (prev, t]: bisect to a few centimetres.
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 24 && hi - lo > 0.02; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid) === true) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      return hi;
    }
    prev = t;
    t += Math.max(minStep, t * stepFraction);
  }
  return null;
}
