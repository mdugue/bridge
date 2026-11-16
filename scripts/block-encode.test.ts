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
import { knownLevel } from "./block-known";

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

/** Levels 1 on, against the box-filtered chain: the largest texel and
 *  the mean (Findings). */
const LOWER: Record<BlockFormat, { max: number; mean: number }> = {
  bc4: { max: 14.572, mean: 1.57 },
  eac: { max: 16.041, mean: 1.52 },
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
    // every lower level against the chain it was encoded from
    const chain = mipChain(src);
    let lowerMax = 0;
    let lowerSum = 0;
    let lowerTexels = 0;
    for (const [k, level] of raster.levels.entries()) {
      if (k > 0) {
        for (const [i, v] of decodeLevel(level, format).entries()) {
          const e = Math.abs(v - chain[k].data[i]);
          lowerMax = Math.max(lowerMax, e);
          lowerSum += e;
          lowerTexels += 1;
        }
      }
    }
    expect(lowerMax).toBeLessThanOrEqual(LOWER[format].max);
    expect(lowerSum / lowerTexels).toBeLessThanOrEqual(LOWER[format].mean);
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

test("a block's edge texels repeat past a level's edge, never zeros", () => {
  // a 6 × 6 raster: three of its four blocks reach past an edge; padded
  // with zeros, their ends would span 0 to 200
  const level = encodeLevel(
    grey(6, 6, () => 200),
    "bc4"
  );
  for (let b = 0; b < 4; b += 1) {
    expect([level.data[b * 8], level.data[b * 8 + 1]]).toEqual([200, 200]);
  }
});

/**
 * Known answers from a decoder that is not ours: what WebGPU on
 * SwiftShader (Chromium 1243's Dawn on SwiftShader's Vulkan, the e2e's
 * flags) reads from scripts/block-known.ts's level — every EAC table and
 * multiplier, both BC4 modes, every index — written by
 * `bun scripts/eval/block-raster-probe.ts --known`. SwiftShader truncates
 * BC4's interpolation to whole bytes and reads EAC's eleven bits as v·32,
 * so both are exact integers here: a changed modifier table or palette
 * rule shows.
 */
const GPU_READ: Record<BlockFormat, number[]> = {
  bc4: [
    200, 20, 174, 148, 216, 71, 107, 143, 163, 140, 117, 94, 110, 142, 175, 0,
    112, 92, 72, 52, 171, 0, 255, 55, 72, 55, 158, 38, 255, 65, 192, 90, 144,
    44, 129, 115, 184, 96, 118, 140, 118, 107, 95, 84, 121, 139, 157, 0, 90, 81,
    73, 64, 153, 0, 255, 95, 73, 67, 102, 62, 255, 105, 160, 116, 122, 97, 71,
    45, 179, 0, 255, 35, 71, 48, 186, 26, 255, 45, 208, 77, 172, 32, 152, 132,
    200, 84, 113, 142, 140, 123, 106, 89, 115, 141, 166, 0, 101, 86, 72, 58,
    162, 0, 255, 75, 72, 61, 130, 50, 255, 85, 176, 103, 116, 56, 107, 98, 168,
    109, 124, 138, 96, 90, 84, 79, 127, 138, 149, 0, 200, 20, 174, 148, 216, 71,
    107, 143, 163, 140, 117, 94, 110, 142, 175, 0, 112, 92, 72, 52, 171, 0, 255,
    55, 72, 55, 158, 38, 255, 65, 192, 90, 144, 44, 129, 115, 184, 96, 118, 140,
    118, 107, 95, 84, 121, 139, 157, 0, 90, 81, 73, 64, 153, 0, 255, 95, 73, 67,
    102, 62, 255, 105, 160, 116, 122, 97, 71, 45, 179, 0, 255, 35, 71, 48, 186,
    26, 255, 45, 208, 77, 172, 32, 152, 132, 200, 84, 113, 142, 140, 123, 106,
    89, 115, 141, 166, 0, 101, 86, 72, 58, 162, 0, 255, 75, 72, 61, 130, 50,
    255, 85, 176, 103, 116, 56, 107, 98, 168, 109, 124, 138, 96, 90, 84, 79,
    127, 138, 149, 0,
  ],
  eac: [
    1025, 1022, 1019, 1013, 972, 948, 924, 1044, 900, 820, 1044, 1092, 716,
    1052, 1100, 1148, 1092, 1188, 1252, 1380, 1268, 1348, 1428, 908, 1364, 1508,
    836, 692, 1588, 860, 748, 580, 900, 644, 516, 388, 1023, 1020, 1018, 1029,
    964, 948, 1036, 1052, 868, 1044, 1092, 1124, 1076, 1100, 1172, 1244, 1060,
    1092, 1316, 996, 1308, 1348, 868, 788, 1412, 884, 788, 692, 1030, 1033,
    1036, 1042, 1076, 1100, 1124, 1004, 1140, 1220, 996, 948, 1316, 980, 932,
    884, 932, 836, 772, 644, 748, 668, 588, 1108, 644, 500, 1172, 1316, 412,
    1140, 1252, 1420, 1092, 1348, 1476, 1604, 1032, 1035, 1037, 1026, 1084,
    1100, 1012, 996, 1172, 996, 948, 916, 956, 932, 860, 788, 964, 932, 708,
    1028, 708, 668, 1148, 1228, 596, 1124, 1220, 1316, 1025, 1022, 1019, 1013,
    972, 948, 924, 1044, 900, 820, 1044, 1092, 716, 1052, 1100, 1148, 1092,
    1188, 1252, 1380, 1268, 1348, 1428, 908, 1364, 1508, 836, 692, 1588, 860,
    748, 580, 900, 644, 516, 388, 1023, 1020, 1018, 1029, 964, 948, 1036, 1052,
    868, 1044, 1092, 1124, 1076, 1100, 1172, 1244, 1060, 1092, 1316, 996, 1308,
    1348, 868, 788, 1412, 884, 788, 692, 1030, 1033, 1036, 1042, 1076, 1100,
    1124, 1004, 1140, 1220, 996, 948, 1316, 980, 932, 884, 932, 836, 772, 644,
    748, 668, 588, 1108, 644, 500, 1172, 1316, 412, 1140, 1252, 1420, 1092,
    1348, 1476, 1604, 1032, 1035, 1037, 1026, 1084, 1100, 1012, 996, 1172, 996,
    948, 916, 956, 932, 860, 788, 964, 932, 708, 1028, 708, 668, 1148, 1228,
    596, 1124, 1220, 1316,
  ],
};

test("the decoders agree with a GPU's read of every table and mode", () => {
  for (const format of FORMATS) {
    const decoded = decodeLevel(knownLevel(format), format);
    const ours = Array.from(decoded, (v) =>
      format === "bc4" ? Math.floor(v + 1e-9) : Math.round((v * 2047) / 255)
    );
    expect(ours).toEqual(GPU_READ[format]);
  }
});
