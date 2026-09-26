/** Small numeric helpers shared by the scene's pure logic. No THREE, no DOM. */

/** `value` limited to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `value` limited to [0, 1]. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
