import { expect, test } from "bun:test";
import {
  BLOCK_HEADER_BYTES,
  levelBytes,
  mipSizes,
  packBlockRaster,
  parseBlockRaster,
} from "./block-raster";
import type { BlockRaster } from "./block-raster";

const raster = (width: number, height: number): BlockRaster => ({
  format: "eac",
  width,
  height,
  levels: mipSizes(width, height).map((size, i) => ({
    ...size,
    data: new Uint8Array(levelBytes(size.width, size.height)).fill(i + 1),
  })),
});

test("a full chain down to 1 × 1, a level smaller than a block one block", () => {
  expect(mipSizes(8, 4)).toEqual([
    { width: 8, height: 4 },
    { width: 4, height: 2 },
    { width: 2, height: 1 },
    { width: 1, height: 1 },
  ]);
  expect(levelBytes(8, 4)).toBe(16);
  expect(levelBytes(2, 1)).toBe(8);
});

test("a raster comes back as it was packed", () => {
  const packed = packBlockRaster(raster(16, 8));
  const back = parseBlockRaster(packed);
  expect(back.format).toBe("eac");
  expect([back.width, back.height]).toEqual([16, 8]);
  expect(back.levels.map((l) => [l.width, l.height, l.data[0]])).toEqual([
    [16, 8, 1],
    [8, 4, 2],
    [4, 2, 3],
    [2, 1, 4],
    [1, 1, 5],
  ]);
  expect(packed.length).toBe(BLOCK_HEADER_BYTES + (8 + 2 + 1 + 1 + 1) * 8);
  // a chain cut short is a file too (the levels it has)
  const two = raster(16, 8);
  two.levels = two.levels.slice(0, 2);
  expect(parseBlockRaster(packBlockRaster(two)).levels).toHaveLength(2);
});

test("a wrong magic, a truncated or overlong file, an unknown format throw", () => {
  const packed = packBlockRaster(raster(8, 8));
  const wrong = packed.slice();
  wrong[0] = 0;
  expect(() => parseBlockRaster(wrong)).toThrow("magic");
  expect(() => parseBlockRaster(packed.subarray(0, 10))).toThrow("header");
  expect(() => parseBlockRaster(packed.subarray(0, -1))).toThrow("truncated");
  const long = new Uint8Array(packed.length + 1);
  long.set(packed);
  expect(() => parseBlockRaster(long)).toThrow("trailing");
  const unknown = packed.slice();
  unknown[4] = 9;
  expect(() => parseBlockRaster(unknown)).toThrow("format");
});
