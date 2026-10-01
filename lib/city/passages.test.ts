import { expect, test } from "bun:test";
import { carvePassages, PASSAGE_FLOOR_M } from "./passages";

test("a passage opens the fill along its line, as wide as its tracks, and no wider", () => {
  // 40 × 40 cells of 1 m, a 117 m fill everywhere but a 108 m strip (the
  // street beyond it) along the south edge
  const n = 40;
  const elevations = new Float32Array(n * n).fill(117);
  for (let col = 0; col < n; col++) {
    elevations[(n - 1) * n + col] = 108;
  }
  const out = carvePassages({
    bounds: [0, 0, 40, 40],
    elevations,
    n,
    passages: [
      {
        coords: [
          [20, 0],
          [20, 40],
        ],
        half: 3.5,
        y: [111, 111],
      },
    ],
  });
  const at = (x: number, y: number) =>
    out[Math.floor(40 - y) * n + Math.floor(x)];
  // under the line and beside it within the half-width: the line's level
  expect(at(20.5, 20.5)).toBeCloseTo(111 - PASSAGE_FLOOR_M, 5);
  expect(at(23.5, 20.5)).toBeCloseTo(111 - PASSAGE_FLOOR_M, 5);
  // past it: the fill stays
  expect(at(24.5, 20.5)).toBe(117);
  // lower ground on the line is never raised
  expect(at(20.5, 0.5)).toBe(108);
});
