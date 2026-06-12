import { expect, test } from "bun:test";
import { tfwToBounds } from "./tfw";

// Real sidecar of data/dgm/dgm1_33412_5656_2_sn_tiff (1 m pixels, 2000x2000).
const dresdenTfw = `1.0000000000
0.0000000000
0.0000000000
-1.0000000000
412000.5000000000
5657999.5000000000`;

test("tfwToBounds matches the hand-computed Dresden tile extent", () => {
  // Official tile extent per the akt.csv sidecar: 412000 5656000 414000 5658000
  expect(tfwToBounds(dresdenTfw, 2000, 2000)).toEqual([
    412_000, 5_656_000, 414_000, 5_658_000,
  ]);
});

test("tfwToBounds shifts the pixel-center origin by half a pixel", () => {
  // 10x10 raster, 2 m pixels, top-left pixel center at (101, 99).
  const tfw = "2\n0\n0\n-2\n101\n99";
  expect(tfwToBounds(tfw, 10, 10)).toEqual([100, 80, 120, 100]);
});

test("tfwToBounds rejects malformed content", () => {
  expect(() => tfwToBounds("1 2 3", 10, 10)).toThrow(/Invalid \.tfw/);
  expect(() => tfwToBounds("1\n0.5\n0\n-1\n0\n0", 10, 10)).toThrow(/Rotated/);
  expect(() => tfwToBounds("1\n0\n0\n1\n0\n0", 10, 10)).toThrow(/north-up/);
});
