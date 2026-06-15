import { expect, test } from "bun:test";
import { clamp, clamp01 } from "./math";

test("clamp constrains to the inclusive range", () => {
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(-3, 0, 10)).toBe(0);
  expect(clamp(42, 0, 10)).toBe(10);
  expect(clamp(0, 0, 10)).toBe(0);
  expect(clamp(10, 0, 10)).toBe(10);
});

test("clamp works with negative bounds", () => {
  expect(clamp(-2, -1, 1)).toBe(-1);
  expect(clamp(0.5, -1, 1)).toBe(0.5);
});

test("clamp01 constrains to [0, 1]", () => {
  expect(clamp01(0.5)).toBe(0.5);
  expect(clamp01(-1)).toBe(0);
  expect(clamp01(2)).toBe(1);
});
