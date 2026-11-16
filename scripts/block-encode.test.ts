import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseBlockRaster } from "../lib/city/block-raster";
import type { BlockFormat } from "../lib/city/block-raster";
import { decodeGreyPng } from "../lib/city/png-raster";
import {
  boxHalf,
  decodeLevel,
  encodeBlockRaster,
  encodeLevel,
  mipChain,
} from "./block-encode";
import type { Grey } from "./block-encode";

const FORMATS: BlockFormat[] = ["bc4", "eac"];

const grey = (
  width: number,
  height: number,
  at: (x: number, y: number) => number
): Grey => {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = at(x, y);
    }
  }
  return { data, width, height };
};

const worst = (src: Grey, format: BlockFormat): number => {
  const decoded = decodeLevel(encodeLevel(src, format), format);
  let max = 0;
  for (const [i, v] of decoded.entries()) {
    max = Math.max(max, Math.abs(v - src.data[i]));
  }
  return max;
};

test("the box filter rounds the mean of four, an odd edge repeats", () => {
  expect([
    ...boxHalf(grey(2, 2, (x, y) => [1, 2, 3, 5][y * 2 + x])).data,
  ]).toEqual([3]);
  expect(boxHalf(grey(3, 1, (x) => x * 10))).toEqual({
    data: new Uint8Array([5]),
    width: 1,
    height: 1,
  });
  expect(mipChain(grey(8, 2, () => 7)).map((l) => [l.width, l.height])).toEqual(
    [
      [8, 2],
      [4, 1],
      [2, 1],
      [1, 1],
    ]
  );
});

test("a flat block, 0, 255 and a raster smaller than a block are exact in BC4", () => {
  for (const v of [0, 1, 128, 254, 255]) {
    expect(
      worst(
        grey(4, 4, () => v),
        "bc4"
      )
    ).toBe(0);
  }
  expect(
    worst(
      grey(2, 1, () => 77),
      "bc4"
    )
  ).toBe(0);
});

test("a flat block is within half an 11-bit step in EAC", () => {
  for (const v of [0, 1, 128, 254, 255]) {
    expect(
      worst(
        grey(4, 4, () => v),
        "eac"
      )
    ).toBeLessThanOrEqual(0.07);
  }
});

test("a gentle ramp is within a byte step in both formats", () => {
  const ramp = grey(16, 16, (x, y) => 60 + x * 2 + y);
  for (const format of FORMATS) {
    expect(worst(ramp, format)).toBeLessThanOrEqual(1);
  }
});

test("the texels land where they were, in both formats' orders", () => {
  // one bright texel in two blocks: a wrong index order moves it (an error
  // of some 240); EAC's uneven steps leave a few
  const spots = grey(8, 8, (x, y) =>
    (x === 1 && y === 2) || (x === 6 && y === 5) ? 250 : 10
  );
  for (const format of FORMATS) {
    expect(worst(spots, format)).toBeLessThanOrEqual(3);
  }
});

// The trial's figures on Dresden's spawn tile (plan 091 phase 2, Findings):
// the error of what the shader reads, in byte steps, held where it was
// recorded; and the bytes the same on a second encode (the bake's cache and
// the content hashes).
const SPAWN_SVF = "data/dresden/dlm/svf_33412_5656_2_sn.png";
const RECORDED: Record<
  BlockFormat,
  { max: number; mean: number; p99: number }
> = {
  bc4: { mean: 0.791, p99: 4, max: 12 },
  eac: { mean: 0.822, p99: 4.092, max: 11.952 },
};

test("the spawn tile's sky view: the error as recorded, the bytes stable", async () => {
  const src = await decodeGreyPng(readFileSync(SPAWN_SVF));
  for (const format of FORMATS) {
    const bytes = encodeBlockRaster(src, format);
    expect(
      Buffer.compare(
        Buffer.from(bytes),
        Buffer.from(encodeBlockRaster(src, format))
      )
    ).toBe(0);
    const raster = parseBlockRaster(bytes);
    expect(raster.levels).toHaveLength(11);
    // half a byte a texel and a third more for the chain
    expect(bytes.length).toBe(16 + 699_064);
    const decoded = decodeLevel(raster.levels[0], format);
    const errors = decoded.map((v, i) => Math.abs(v - src.data[i])).sort();
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const recorded = RECORDED[format];
    expect(mean).toBeLessThanOrEqual(recorded.mean);
    expect(errors[Math.floor(0.99 * (errors.length - 1))]).toBeLessThanOrEqual(
      recorded.p99
    );
    expect(errors.at(-1)).toBeLessThanOrEqual(recorded.max);
  }
}, 30_000);
