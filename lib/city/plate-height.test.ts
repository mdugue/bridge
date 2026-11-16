import { expect, test } from "bun:test";
import { platePositions, plateVertex } from "./ground-plate";
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

/** A plane rising east and north. */
const ramp = (x: number, y: number) => x - 900 + (y - 2000) / 2;

test("across two tiles the plate's ground follows a ramp, by each tile's cell", () => {
  const n = 5;
  const tiles = [
    [1000, 2000, 1400, 2400],
    [1400, 2000, 1800, 2400],
  ].map((b) => {
    const bounds = b as TerrainBounds;
    const heights = new Float32Array(n * n).map((_, v) => {
      const [x, y] = plateVertex(bounds, n, v % n, Math.floor(v / n));
      return ramp(x, y);
    });
    const tile = { id: "t", bounds, classes: new Uint8Array(n * n), heights };
    return {
      bounds,
      positions: platePositions(tile, n, { cx: 1000, cy: 2000 }),
    };
  });
  const at = plateHeightAt(tiles, n);
  for (const [x, y] of [
    [1000, 2400],
    [1200, 2200],
    [1250, 2130],
    [1400, 2000],
    [1650, 2370],
    [1800, 2400],
  ]) {
    expect(at(x, y)).toBeCloseTo(ramp(x, y), 4);
  }
  expect(at(999, 2200)).toBeUndefined();
  expect(at(1200, 2401)).toBeUndefined();
});
