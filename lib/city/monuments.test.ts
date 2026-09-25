import { expect, test } from "bun:test";
import {
  basinLevels,
  insideRing,
  jetHeight,
  jetPlaces,
  onRelief,
  openRing,
  reliefSurface,
  ringArea,
  ringCentre,
  yawOf,
} from "./monuments";
import type { Point2 } from "./polyline";

const square = (s: number): Point2[] => [
  [0, 0],
  [s, 0],
  [s, s],
  [0, s],
  [0, 0],
];

test("a basin on a slope is footed below the low side, rimmed above the high one", () => {
  const levels = basinLevels([110, 111, 110.4], "basin");
  expect(levels?.base).toBeCloseTo(109.7);
  expect(levels?.rim).toBeCloseTo(111.35);
  expect(levels?.water).toBeCloseTo(111.27);
});

test("a splash pad has no rim: the water is the paving", () => {
  const levels = basinLevels([100], "splash");
  expect(levels?.rim).toBe(levels?.water);
  expect(levels?.water).toBeCloseTo(100.03);
});

test("no ground under a basin means no basin", () => {
  expect(basinLevels([], "basin")).toBeNull();
  expect(basinLevels([Number.NaN], "pool")).toBeNull();
});

test("jets grow with the basin, clamped; pools have none", () => {
  expect(jetHeight(1, "basin")).toBe(1.2);
  expect(jetHeight(100, "basin")).toBeCloseTo(3);
  expect(jetHeight(10_000, "basin")).toBe(4.5);
  expect(jetHeight(100, "pool")).toBe(0);
  expect(jetHeight(100, "splash")).toBe(1);
});

test("ring helpers: area, centre, closing vertex, inside", () => {
  expect(ringArea(square(4))).toBe(16);
  expect(ringArea(openRing(square(4)))).toBe(16);
  expect(openRing(square(4))).toHaveLength(4);
  expect(ringCentre(square(4))).toEqual([2, 2]);
  expect(insideRing([1, 1], square(4))).toBe(true);
  expect(insideRing([5, 1], square(4))).toBe(false);
});

test("a figure gets four jets round it, only those on the water", () => {
  expect(jetPlaces([0, 0], 50, false, null)).toEqual([[0, 0]]);
  const wide = square(20).map(([x, y]) => [x - 10, y - 10] as Point2);
  expect(jetPlaces([0, 0], 400, true, wide)).toHaveLength(4);
  // A strip 2 m wide: the diagonal jets fall off it.
  const strip: Point2[] = [
    [-20, -1],
    [20, -1],
    [20, 1],
    [-20, 1],
  ];
  expect(jetPlaces([0, 0], 80, true, strip)).toHaveLength(0);
});

test("a monument's yaw is stable and in range", () => {
  const a = yawOf(412_117.9, 5_657_577.5);
  expect(a).toBe(yawOf(412_117.9, 5_657_577.5));
  expect(a).toBeGreaterThanOrEqual(0);
  expect(a).toBeLessThan(Math.PI * 2);
});

test("a relief is smoothed into one form that settles into the ground", () => {
  // A 2 × 2 m block 4 m tall, padded by one empty cell (as the bake writes).
  const dm = [0, 0, 0, 0, 0, 40, 40, 0, 0, 40, 40, 0, 0, 0, 0, 0];
  const s = reliefSurface({ cols: 4, rows: 4, west: 100, north: 200, dm });
  expect(s.cols).toBe(17);
  expect(s.rows).toBe(17);
  expect(s.step).toBe(0.25);
  const at = (row: number, col: number) => s.heights[row * s.cols + col];
  // Softened, not taller than measured, and highest in the middle.
  expect(at(8, 8)).toBeLessThanOrEqual(4);
  expect(at(8, 8)).toBeGreaterThan(3);
  expect(at(8, 8)).toBeGreaterThan(at(8, 5));
  // The fringe sinks under the paving rather than lying on it.
  expect(at(0, 0)).toBeLessThan(0);
  expect(at(16, 16)).toBeLessThan(0);
  // Symmetric input, symmetric form.
  expect(at(4, 8)).toBeCloseTo(at(12, 8));
});

test("a point on a measured relief cell is on it; its padding is not", () => {
  const dm = [0, 0, 0, 0, 50, 0, 0, 0, 0];
  const relief = { cols: 3, rows: 3, west: 100, north: 200, dm };
  expect(onRelief([relief], 101.5, 198.5)).toBe(true);
  expect(onRelief([relief], 100.5, 199.5)).toBe(false);
  expect(onRelief([relief], 90, 190)).toBe(false);
});
