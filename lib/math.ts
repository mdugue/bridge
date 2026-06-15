/** Tiny numeric helpers. Pure, dependency-free — safe for the lib/city layer. */

/** Constrains `v` to the inclusive range [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Constrains `v` to [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
