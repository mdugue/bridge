import { expect, test } from "bun:test";
import { isDoubleTap } from "./touch";

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
