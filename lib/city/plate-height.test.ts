import { expect, test } from "bun:test";
import { platePositions } from "./ground-plate";
import { plateHeightAt } from "./plate-height";
import type { TerrainBounds } from "./terrain-geometry";

test("the plate's ground is bilinear between its vertices, none off it", () => {
  const n = 3;
  const bounds: TerrainBounds = [0, 0, 100, 100];
  // rows north → south: the ground rises 10 m a column eastwards
  const heights = new Float32Array([0, 10, 20, 0, 10, 20, 0, 10, 20]);
  const tile = { id: "t", bounds, classes: new Uint8Array(n * n), heights };
  // read back from the drawn positions, the sunk middle vertex lifted
  const positions = platePositions(tile, n, { cx: 50, cy: 50 });
  const at = plateHeightAt([{ bounds, positions }], n);
  expect(at(0, 100)).toBe(0);
  expect(at(100, 0)).toBe(20);
  expect(at(50, 50)).toBeCloseTo(10);
  expect(at(25, 60)).toBeCloseTo(5);
  expect(at(75, 10)).toBeCloseTo(15);
  expect(at(101, 50)).toBeUndefined();
});
