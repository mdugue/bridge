import { expect, test } from "bun:test";
import { type WallRibbon, wallGeometry } from "./walls";

const offset = { cx: 0, cy: 0 };
const flat = () => 100;

const line = (h: number): WallRibbon => ({
  coords: [
    [0, 0],
    [10, 0],
  ],
  h,
});

test("a wall becomes one ribbon: a quad (two triangles) per densified segment", () => {
  // 10 m at 2.5 m spacing → 5 columns → 4 quads → 24 vertices.
  expect(wallGeometry([line(3)], flat, offset)?.positions.length).toBe(
    4 * 6 * 3
  );
});

test("kerb-height walls and empty inputs build nothing", () => {
  expect(wallGeometry([], flat, offset)).toBeNull();
  expect(wallGeometry([line(0.5)], flat, offset)).toBeNull();
});

test("a wall off the ground is skipped, not thrown", () => {
  expect(wallGeometry([line(3)], () => null, offset)).toBeNull();
});

test("a wall on a step stands from the low shelf to the high one", () => {
  // Ground 100 m south of y = 0, 108 m north of it: a wall along y = 0.
  const step = (_x: number, y: number) => (y > 0 ? 108 : 100);
  const g = wallGeometry([line(3)], step, offset);
  const ys = (g?.positions ?? []).filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBe(108);
  expect(Math.min(...ys)).toBeCloseTo(99.6, 5); // the low shelf, 0.4 m dip
});
