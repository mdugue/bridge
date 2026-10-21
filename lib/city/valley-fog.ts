/**
 * How deep the valley haze pools (app/_components/height-fog.ts), from the
 * site's ground and the land around it: a fraction of the valley's depth,
 * so a valley city keeps the Elbe-to-rim pool it was tuned on and a flat
 * one (Hamburg, Munich) is not hazed from the river to the rooftops. Pure.
 *
 * A valley rises on both sides. Where the bake read the land around the
 * site (Copernicus GLO-30: pipeline/bake/glo30.py `rims`, in each tile's
 * horizon legend), the depth is, seen from a tile's low ground, the LOWER
 * side's rise above it, across the axis where that is highest
 * (`valleyDepth`): a town on a one-sided slope (Unna, below the Haar) is no
 * valley, however much its ground climbs, and Dresden's rim beyond its
 * tiles counts. Without it the site's own relief stands in.
 */

/** The pool's depth where the site's relief is unknown (m) — and its
 *  ceiling: the depth the look was tuned on in Dresden. */
export const VALLEY_FALLOFF_MAX = 28;
/** The shallowest pool (m): even a flat site keeps a hint of ground haze. */
export const VALLEY_FALLOFF_MIN = 8;
/** The share of the relief (or the valley's depth) the pool fills. */
export const VALLEY_SHARE = 0.6;
/** The pool sets in with distance from the camera (m): none up to the
 *  first, all of it from the second. Haze is what lies between the eye and
 *  far things, so it gathers over the whole depth of a view: at 10 m the
 *  pool's full share greyed every nearby surface (a shop window read
 *  mid-grey, not dark), and full from 90 m it laid one flat veil over the
 *  river and the meadows in the lower half of the start view, the same at
 *  200 m as at 2 km. */
export const VALLEY_NEAR_M: readonly [number, number] = [40, 900];

/**
 * The site's ground for the haze: its 2nd and 90th height percentile (the
 * river and the typical high ground, robust to a pit or a hilltop) and,
 * where the tiles' rims are known, the valley's depth (`valleyDepth`).
 */
export type GroundRelief = [number, number] | [number, number, number];

/** A tile's valley (the horizon legend's `valley`): the height of its low
 *  ground (m) and, per azimuth (clockwise from north, evenly spaced), the
 *  high ground's height (m) within reach of it, null where none. */
export interface ValleyRim {
  floorM: number;
  rimM: readonly (number | null)[];
}

/** The 2nd and 90th percentile of ground heights — and, given the tiles'
 *  rims, the valley's depth. */
export function groundRelief(
  heights: readonly number[],
  rims: readonly ValleyRim[] = []
): GroundRelief {
  const v = heights.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) {
    return [0, 0];
  }
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  const depth = valleyDepth(rims);
  return depth === undefined ? [at(0.02), at(0.9)] : [at(0.02), at(0.9), depth];
}

/** One tile's valley depth: each side's rise above its floor (≥ 0; none
 *  where the side is unknown), per axis (an azimuth and its opposite) the
 *  lower side, the deepest axis. */
function tileDepth(rim: ValleyRim): number | undefined {
  const n = rim.rimM.length;
  if (n === 0 || n % 2 !== 0 || !Number.isFinite(rim.floorM)) {
    return undefined;
  }
  const rise = rim.rimM.map((h) =>
    typeof h === "number" && Number.isFinite(h)
      ? Math.max(0, h - rim.floorM)
      : 0
  );
  let depth = 0;
  for (let k = 0; k < n / 2; k++) {
    depth = Math.max(depth, Math.min(rise[k], rise[k + n / 2]));
  }
  return depth;
}

/**
 * The site's valley depth (m): the deepest of its tiles' (`tileDepth`) —
 * the haze pools from the site's lowest ground up, wherever a valley holds
 * it. Undefined where no tile has a rim.
 */
export function valleyDepth(rims: readonly ValleyRim[]): number | undefined {
  const depths = rims
    .map(tileDepth)
    .filter((d): d is number => d !== undefined);
  return depths.length === 0
    ? undefined
    : Math.round(Math.max(...depths) * 10) / 10;
}

/** The pool's fade height for a site whose ground spans `relief`: a share
 *  of the valley's depth where it is known, else of the site's relief. */
export function valleyFalloff(relief?: GroundRelief): number {
  if (!relief) {
    return VALLEY_FALLOFF_MAX;
  }
  const valley = relief.length === 3 ? relief[2] : relief[1] - relief[0];
  const depth = valley * VALLEY_SHARE;
  return Math.min(VALLEY_FALLOFF_MAX, Math.max(VALLEY_FALLOFF_MIN, depth));
}
