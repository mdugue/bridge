import { expect, test } from "bun:test";
import { clamp, clamp01 } from "./math";

test("clamp limits to the range and keeps what is inside", () => {
  expect(clamp(5, 0, 3)).toBe(3);
  expect(clamp(-1, 0, 3)).toBe(0);
  expect(clamp(2, 0, 3)).toBe(2);
  expect(clamp01(1.5)).toBe(1);
  expect(clamp01(0.25)).toBe(0.25);
});
