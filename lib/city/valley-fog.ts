/**
 * How deep the valley haze pools (app/_components/height-fog.ts), from the
 * site's own ground: a fraction of its relief, so a valley city keeps the
 * Elbe-to-rim pool it was tuned on and a flat one (Hamburg, Munich) is not
 * hazed from the river to the rooftops. Pure.
 */

/** The pool's depth where the site's relief is unknown (m) — and its
 *  ceiling: Dresden's Elbe-to-rim drop, the depth the look was tuned on. */
export const VALLEY_FALLOFF_MAX = 28;
/** The shallowest pool (m): even a flat site keeps a hint of ground haze. */
export const VALLEY_FALLOFF_MIN = 8;
/** The share of the relief the pool fills. */
export const VALLEY_SHARE = 0.6;
/** The pool sets in with distance from the camera (m): none up to the
 *  first, all of it from the second. Haze is what lies between the eye and
 *  far things, so it gathers over the whole depth of a view: at 10 m the
 *  pool's full share greyed every nearby surface (a shop window read
 *  mid-grey, not dark), and full from 90 m it laid one flat veil over the
 *  river and the meadows in the lower half of the start view, the same at
 *  200 m as at 2 km. */
export const VALLEY_NEAR_M: readonly [number, number] = [40, 900];

/** The 2nd and 90th percentile of ground heights: the river and the
 *  typical high ground, robust to a pit or a hilltop. */
export function groundRelief(heights: readonly number[]): [number, number] {
  const v = heights.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) {
    return [0, 0];
  }
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return [at(0.02), at(0.9)];
}

/** The pool's fade height for a site whose ground spans `relief`. */
export function valleyFalloff(relief?: readonly [number, number]): number {
  if (!relief) {
    return VALLEY_FALLOFF_MAX;
  }
  const depth = (relief[1] - relief[0]) * VALLEY_SHARE;
  return Math.min(VALLEY_FALLOFF_MAX, Math.max(VALLEY_FALLOFF_MIN, depth));
}
