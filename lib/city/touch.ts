/**
 * Pure tap recognition for the touch control scheme (double-tap travels).
 * The look/zoom policy the gestures drive lives in pose.ts. No THREE, no DOM.
 */

export interface TapSample {
  timeMs: number;
  x: number;
  y: number;
}

const DOUBLE_TAP_MAX_DELAY_MS = 320;
const DOUBLE_TAP_MAX_DIST_PX = 40;

/** True when `next` completes a double tap started by `prev`. */
export function isDoubleTap(prev: TapSample | null, next: TapSample): boolean {
  if (!prev) {
    return false;
  }
  return (
    next.timeMs - prev.timeMs <= DOUBLE_TAP_MAX_DELAY_MS &&
    Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_MAX_DIST_PX
  );
}
