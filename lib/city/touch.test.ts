import { expect, test } from "bun:test";
import {
  clampPitch,
  isDoubleTap,
  MAX_FOV,
  MIN_FOV,
  nextFov,
  PITCH_LIMIT,
} from "./touch";

test("clampPitch limits to ±PITCH_LIMIT", () => {
  expect(clampPitch(0.5)).toBe(0.5);
  expect(clampPitch(3)).toBe(PITCH_LIMIT);
  expect(clampPitch(-3)).toBe(-PITCH_LIMIT);
});

test("nextFov: spreading fingers zooms in, pinching zooms out, clamped", () => {
  expect(nextFov(70, 2)).toBe(35);
  expect(nextFov(70, 0.5)).toBe(MAX_FOV);
  expect(nextFov(70, 10)).toBe(MIN_FOV);
  expect(nextFov(70, 1)).toBe(70);
});

test("nextFov ignores degenerate ratios", () => {
  expect(nextFov(70, 0)).toBe(70);
  expect(nextFov(70, Number.NaN)).toBe(70);
});

test("isDoubleTap accepts quick nearby taps only", () => {
  const first = { timeMs: 1000, x: 100, y: 100 };
  expect(isDoubleTap(first, { timeMs: 1200, x: 110, y: 95 })).toBe(true);
  // Too slow.
  expect(isDoubleTap(first, { timeMs: 1500, x: 100, y: 100 })).toBe(false);
  // Too far apart.
  expect(isDoubleTap(first, { timeMs: 1100, x: 200, y: 100 })).toBe(false);
  // No first tap.
  expect(isDoubleTap(null, { timeMs: 1100, x: 100, y: 100 })).toBe(false);
});
