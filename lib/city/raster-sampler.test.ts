import { expect, test } from "bun:test";
import { maxWindowSampler } from "./raster-sampler";

// A 10×10 raster over a 100 m tile: one bright pixel at column 7, row 2.
const data = new Uint8Array(100);
data[2 * 10 + 7] = 255;
const sample = maxWindowSampler(
  { data, width: 10, height: 10 },
  [0, 0, 100, 100]
);

test("row 0 is north", () => {
  // Column 7, row 2 = x 75, y 75 (100 − 25).
  expect(sample(75, 75)).toBe(1);
});

test("the 5×5 window reaches two pixels out, not three", () => {
  expect(sample(55, 75)).toBe(1); // column 5
  expect(sample(45, 75)).toBe(0); // column 4
  expect(sample(75, 35)).toBe(0); // row 6
});

test("off the raster is undefined", () => {
  expect(sample(-1, 50)).toBeUndefined();
  expect(sample(50, 101)).toBeUndefined();
});
