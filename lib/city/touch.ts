/**
 * Pure helpers for the touch control scheme (street-view-style):
 * one-finger drag looks around, pinch zooms (FOV), double-tap travels.
 * No THREE, no DOM.
 */

import { clamp } from "@/lib/math";

/** Max pitch magnitude in radians (~83°) — keeps lookAt math sane. */
export const PITCH_LIMIT = 1.45;

export const MIN_FOV = 30;
export const MAX_FOV = 95;

export function clampPitch(pitch: number): number {
  return clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
}

/**
 * FOV for a pinch gesture: `ratio` = current finger distance / start
 * distance. Spreading (> 1) zooms in (smaller FOV), like map apps.
 */
export function nextFov(startFov: number, ratio: number): number {
  if (ratio <= 0 || !Number.isFinite(ratio)) {
    return startFov;
  }
  return clamp(startFov / ratio, MIN_FOV, MAX_FOV);
}

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
