/**
 * The order the streamed tiles' rasters download in: nearest the eye
 * first. A boot asks for the rasters of every tile in view at once (some
 * fifty files, 40 MB), and over one connection they share the line evenly
 * — the tile the visitor stands on had its ground when the last of them
 * had (19 s on a 20 Mbit line, of which its own rasters are 3). The rank
 * is the horizontal distance from the eye to the tile's bounds, in the
 * data frame's metres. Pure math: no three, no DOM.
 */

/** A tile's bounds in projected coordinates: min E, min N, max E, max N. */
export type FetchBounds = readonly [number, number, number, number];

/** The distance on the map from `eye` to `bounds`, 0 inside them. */
export function fetchRank(
  bounds: FetchBounds,
  eye: { e: number; n: number }
): number {
  const [minE, minN, maxE, maxN] = bounds;
  const de = Math.max(minE - eye.e, 0, eye.e - maxE);
  const dn = Math.max(minN - eye.n, 0, eye.n - maxN);
  return Math.hypot(de, dn);
}
