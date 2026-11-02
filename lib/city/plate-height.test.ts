import { expect, test } from "bun:test";
import { plateHeightAt } from "./plate-height";
import type { TerrainBounds } from "./terrain-geometry";

test("the plate's ground is bilinear between its vertices, none off it", () => {
  const n = 3;
  const bounds: TerrainBounds = [0, 0, 100, 100];
  // rows north → south: the ground rises 10 m a column eastwards
  const heights = new Float32Array([0, 10, 20, 0, 10, 20, 0, 10, 20]);
  const at = plateHeightAt(
    [{ id: "t", bounds, classes: new Uint8Array(n * n), heights }],
    n
  );
  expect(at(0, 100)).toBe(0);
  expect(at(100, 0)).toBe(20);
  expect(at(25, 60)).toBeCloseTo(5);
  expect(at(75, 10)).toBeCloseTo(15);
  expect(at(101, 50)).toBeUndefined();
});
