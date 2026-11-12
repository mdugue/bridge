import { expect, test } from "bun:test";
import { coverRaster } from "./footprint-figure";
import { packFootprints, readFootprints } from "./footprint-pack";

type Ring = [number, number][];
const square = (x0: number, y0: number, s: number): Ring => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];

function packOf(objects: Ring[][]) {
  const pack = readFootprints(packFootprints(objects));
  if (!pack) {
    throw new Error("no pack");
  }
  return pack;
}

/** A pixel's cover in the 10 × 10 raster over (0, 0)–(100, 100). */
const at = (raster: Uint8Array, col: number, row: number) =>
  raster[row * 10 + col];

test("a footprint covers its pixels, north up, and only those", () => {
  // the south-west pixel: x 0–10, y 0–10, which is the last row
  const raster = coverRaster(
    [packOf([[square(0, 0, 10)]])],
    [0, 0, 100, 100],
    10,
    10
  );
  expect(at(raster, 0, 9)).toBe(255);
  expect(at(raster, 1, 9)).toBe(0);
  expect(at(raster, 0, 8)).toBe(0);
  expect(raster.reduce((a, v) => a + v, 0)).toBe(255);
});

test("a pixel half covered is half ink", () => {
  const raster = coverRaster(
    [packOf([[square(0, 0, 5)]])],
    [0, 0, 100, 100],
    10,
    10
  );
  // a quarter of the pixel's area
  expect(at(raster, 0, 9)).toBe(64);
});

test("a courtyard stays open; two objects that overlap are one", () => {
  const ring = square(20, 20, 60);
  const court = square(40, 40, 20);
  const raster = coverRaster(
    [packOf([[ring, court], [square(70, 70, 20)]])],
    [0, 0, 100, 100],
    10,
    10
  );
  expect(at(raster, 2, 7)).toBe(255);
  // the courtyard (x 40–60, y 40–60): rows 4–5, columns 4–5
  expect(at(raster, 4, 4)).toBe(0);
  expect(at(raster, 5, 5)).toBe(0);
  // where the second object lies over the first: no more than whole
  expect(at(raster, 7, 2)).toBe(255);
  expect(at(raster, 8, 1)).toBe(255);
});

test("several packs are one picture, on a raster that is not square", () => {
  // 20 × 10 pixels over 200 × 100 m
  const raster = coverRaster(
    [packOf([[square(0, 0, 10)]]), packOf([[square(190, 90, 10)]])],
    [0, 0, 200, 100],
    20,
    10
  );
  expect(raster).toHaveLength(200);
  // south-west: the last row's first pixel; north-east: the first row's last
  expect(raster[9 * 20]).toBe(255);
  expect(raster[19]).toBe(255);
  expect(raster.reduce((a, v) => a + v, 0)).toBe(2 * 255);
});
