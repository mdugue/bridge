/**
 * The build's block encoders for a one-channel SOFT raster (plan 091
 * phase 2): BC4 (RGTC1, `texture-compression-bc`) and EAC R11
 * (`texture-compression-etc2`), each 8 bytes a 4 × 4 block, with the mip
 * chain a box filter makes (a compressed texture gets no mips from the
 * GPU). Integer arithmetic only, so a bake's bytes do not depend on the
 * machine (ADR 0024); an exhaustive search over a small neighbourhood of
 * each block's range, not a fast heuristic: the build runs it once a tile
 * and caches it. The decoders are the formats' own rules, for the tests
 * and the trial's figures (what the shader reads, in byte steps). The file
 * is `lib/city/block-raster.ts`'s.
 */
import {
  levelBytes,
  mipSizes,
  packBlockRaster,
} from "../lib/city/block-raster";
import type { BlockFormat, BlockLevel } from "../lib/city/block-raster";

/** A one-channel raster, row-major from its first (northern) row. */
export interface Grey {
  data: Uint8Array;
  height: number;
  width: number;
}

/** The next level of a mip chain: each texel the rounded mean of the 2 × 2
 *  above it (an odd edge repeats its last texel). */
export function boxHalf(src: Grey): Grey {
  const width = Math.max(1, src.width >> 1);
  const height = Math.max(1, src.height >> 1);
  const data = new Uint8Array(width * height);
  const at = (x: number, y: number) =>
    src.data[
      Math.min(y, src.height - 1) * src.width + Math.min(x, src.width - 1)
    ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sum =
        at(2 * x, 2 * y) +
        at(2 * x + 1, 2 * y) +
        at(2 * x, 2 * y + 1) +
        at(2 * x + 1, 2 * y + 1);
      data[y * width + x] = (sum + 2) >> 2;
    }
  }
  return { data, width, height };
}

/** Every level of `raster`'s mip chain, level 0 itself first. */
export function mipChain(raster: Grey): Grey[] {
  const chain = [raster];
  const count = mipSizes(raster.width, raster.height).length;
  let last = raster;
  while (chain.length < count) {
    last = boxHalf(last);
    chain.push(last);
  }
  return chain;
}

/** The 16 texels of the block at (bx, by), row-major; past an edge the
 *  edge texel repeats (a level smaller than a block). */
function blockTexels(src: Grey, bx: number, by: number, out: Uint8Array) {
  for (let y = 0; y < 4; y += 1) {
    const row = Math.min(by * 4 + y, src.height - 1) * src.width;
    for (let x = 0; x < 4; x += 1) {
      out[y * 4 + x] = src.data[row + Math.min(bx * 4 + x, src.width - 1)];
    }
  }
}

// --- BC4 ---------------------------------------------------------------------

/** The palette of a BC4 block in 35ths of a byte step: exact integers for
 *  both modes (sevenths when r0 > r1, fifths with 0 and 255 otherwise). */
function bc4Palette(r0: number, r1: number, out: Int32Array): void {
  out[0] = r0 * 35;
  out[1] = r1 * 35;
  if (r0 > r1) {
    for (let i = 2; i < 8; i += 1) {
      out[i] = ((8 - i) * r0 + (i - 1) * r1) * 5;
    }
  } else {
    for (let i = 2; i < 6; i += 1) {
      out[i] = ((6 - i) * r0 + (i - 1) * r1) * 7;
    }
    out[6] = 0;
    out[7] = 255 * 35;
  }
}

/** The squared error of the best index of each texel, and the indices. */
function fitPalette(
  texels: Uint8Array,
  palette: Int32Array,
  scale: number,
  indices: Uint8Array
): number {
  let total = 0;
  for (let t = 0; t < 16; t += 1) {
    const target = texels[t] * scale;
    let best = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    for (let i = 0; i < 8; i += 1) {
      const d = palette[i] - target;
      const e = d * d;
      if (e < best) {
        best = e;
        bestIndex = i;
      }
    }
    indices[t] = bestIndex;
    total += best;
  }
  return total;
}

function writeIndicesLE(
  out: Uint8Array,
  at: number,
  indices: Uint8Array
): void {
  // 48 bits little-endian: texel t (row-major) at bits 3t..3t+2
  let lo = 0;
  let hi = 0;
  for (let t = 0; t < 8; t += 1) {
    lo |= indices[t] << (3 * t);
  }
  for (let t = 0; t < 8; t += 1) {
    hi |= indices[t + 8] << (3 * t);
  }
  out[at] = lo & 255;
  out[at + 1] = (lo >> 8) & 255;
  out[at + 2] = (lo >> 16) & 255;
  out[at + 3] = hi & 255;
  out[at + 4] = (hi >> 8) & 255;
  out[at + 5] = (hi >> 16) & 255;
}

const BC4_REACH = 2;

function encodeBc4Block(texels: Uint8Array, out: Uint8Array, at: number) {
  let lo = 255;
  let hi = 0;
  for (let t = 0; t < 16; t += 1) {
    lo = Math.min(lo, texels[t]);
    hi = Math.max(hi, texels[t]);
  }
  const palette = new Int32Array(8);
  const indices = new Uint8Array(16);
  const bestIndices = new Uint8Array(16);
  let best = Number.POSITIVE_INFINITY;
  let bestPair = [lo, lo];
  // a flat block: both ends the value, every index 0 (the r0 <= r1 mode)
  const candidates: [number, number][] = [[lo, hi]];
  for (let a = hi - BC4_REACH; a <= hi + BC4_REACH; a += 1) {
    for (let b = lo - BC4_REACH; b <= lo + BC4_REACH; b += 1) {
      if (a >= 0 && a <= 255 && b >= 0 && b <= 255 && a > b) {
        candidates.push([a, b]);
      }
    }
  }
  for (const [r0, r1] of candidates) {
    bc4Palette(r0, r1, palette);
    const error = fitPalette(texels, palette, 35, indices);
    if (error < best) {
      best = error;
      bestPair = [r0, r1];
      bestIndices.set(indices);
      if (error === 0) {
        break;
      }
    }
  }
  out[at] = bestPair[0];
  out[at + 1] = bestPair[1];
  writeIndicesLE(out, at + 2, bestIndices);
}

// --- EAC R11 -----------------------------------------------------------------

/** The modifier tables of ETC2's alpha and EAC (Khronos Data Format,
 *  "ETC2 alpha" / "EAC"). */
export const EAC_MODIFIERS: readonly (readonly number[])[] = [
  [-3, -6, -9, -15, 2, 5, 8, 14],
  [-3, -7, -10, -13, 2, 6, 9, 12],
  [-2, -5, -8, -13, 1, 4, 7, 12],
  [-2, -4, -6, -13, 1, 3, 5, 12],
  [-3, -6, -8, -12, 2, 5, 7, 11],
  [-3, -7, -9, -11, 2, 6, 8, 10],
  [-4, -7, -8, -11, 3, 6, 7, 10],
  [-3, -5, -8, -11, 2, 4, 7, 10],
  [-2, -6, -8, -10, 1, 5, 7, 9],
  [-2, -5, -8, -10, 1, 4, 7, 9],
  [-2, -4, -8, -10, 1, 3, 7, 9],
  [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9],
  [-1, -2, -3, -10, 0, 1, 2, 9],
  [-4, -6, -8, -9, 3, 5, 7, 8],
  [-3, -5, -7, -9, 2, 4, 6, 8],
];

/** An EAC R11 value (0–2047) of base, multiplier, table and index. */
export function eacValue(
  base: number,
  multiplier: number,
  table: number,
  index: number
): number {
  const modifier = EAC_MODIFIERS[table][index];
  const step = multiplier === 0 ? modifier : modifier * multiplier * 8;
  return Math.min(2047, Math.max(0, base * 8 + 4 + step));
}

/** The squared error of a palette of 11-bit values against bytes, both
 *  scaled to a common integer unit (value × 255 against byte × 2047). */
function fitEac(
  texels: Uint8Array,
  palette: Int32Array,
  indices: Uint8Array,
  bound: number
): number {
  let total = 0;
  for (let t = 0; t < 16; t += 1) {
    const target = texels[t] * 2047;
    let best = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    for (let i = 0; i < 8; i += 1) {
      const d = palette[i] * 255 - target;
      const e = d * d;
      if (e < best) {
        best = e;
        bestIndex = i;
      }
    }
    indices[t] = bestIndex;
    total += best;
    if (total >= bound) {
      return total;
    }
  }
  return total;
}

interface EacChoice {
  base: number;
  error: number;
  indices: Uint8Array;
  multiplier: number;
  table: number;
}

/** Tries one base, multiplier and table; keeps it in `best` if better. */
function tryEac(
  texels: Uint8Array,
  choice: { base: number; multiplier: number; table: number },
  scratch: { indices: Uint8Array; palette: Int32Array },
  best: EacChoice
): void {
  if (choice.base < 0 || choice.base > 255) {
    return;
  }
  for (let i = 0; i < 8; i += 1) {
    scratch.palette[i] = eacValue(
      choice.base,
      choice.multiplier,
      choice.table,
      i
    );
  }
  const error = fitEac(texels, scratch.palette, scratch.indices, best.error);
  if (error < best.error) {
    best.error = error;
    best.base = choice.base;
    best.multiplier = choice.multiplier;
    best.table = choice.table;
    best.indices.set(scratch.indices);
  }
}

/** The multipliers worth trying for a table whose modifiers span `span`
 *  on a block whose texels span `range` (both in 11-bit steps). */
function multipliersFor(range: number, span: number): number[] {
  const ideal = range / (span * 8);
  const out = [0];
  for (
    let m = Math.max(1, Math.floor(ideal) - 1);
    m <= Math.min(15, Math.ceil(ideal) + 1);
    m += 1
  ) {
    out.push(m);
  }
  return out;
}

function encodeEacBlock(texels: Uint8Array, out: Uint8Array, at: number) {
  let lo = 255;
  let hi = 0;
  for (let t = 0; t < 16; t += 1) {
    lo = Math.min(lo, texels[t]);
    hi = Math.max(hi, texels[t]);
  }
  // the block's ends in 11-bit steps (rounded: v × 2047 / 255)
  const lo11 = Math.floor((lo * 2047 + 127) / 255);
  const hi11 = Math.floor((hi * 2047 + 127) / 255);
  const best: EacChoice = {
    base: 0,
    error: Number.POSITIVE_INFINITY,
    indices: new Uint8Array(16),
    multiplier: 0,
    table: 0,
  };
  const scratch = { indices: new Uint8Array(16), palette: new Int32Array(8) };
  for (let table = 0; table < 16 && best.error > 0; table += 1) {
    const mods = EAC_MODIFIERS[table];
    const minMod = Math.min(...mods);
    const maxMod = Math.max(...mods);
    for (const multiplier of multipliersFor(hi11 - lo11, maxMod - minMod)) {
      const scale = multiplier === 0 ? 1 : multiplier * 8;
      // the base that centres the table's span on the block's range
      const centre = (lo11 + hi11 - (minMod + maxMod) * scale) / 2 - 4;
      const base0 = Math.round(centre / 8);
      for (let base = base0 - 1; base <= base0 + 1; base += 1) {
        tryEac(texels, { base, multiplier, table }, scratch, best);
      }
    }
  }
  out[at] = best.base;
  out[at + 1] = (best.multiplier << 4) | best.table;
  // 48 bits big-endian: texel (x, y) at the 3 bits from the top of
  // position x·4 + y (the pixels go down each column)
  let hiWord = 0;
  let loWord = 0;
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      const p = x * 4 + y;
      const index = best.indices[y * 4 + x];
      if (p < 8) {
        hiWord = hiWord * 8 + index;
      } else {
        loWord = loWord * 8 + index;
      }
    }
  }
  out[at + 2] = (hiWord >> 16) & 255;
  out[at + 3] = (hiWord >> 8) & 255;
  out[at + 4] = hiWord & 255;
  out[at + 5] = (loWord >> 16) & 255;
  out[at + 6] = (loWord >> 8) & 255;
  out[at + 7] = loWord & 255;
}

// --- levels and files --------------------------------------------------------

/** One level's blocks in `format`. */
export function encodeLevel(src: Grey, format: BlockFormat): BlockLevel {
  const bw = Math.ceil(src.width / 4);
  const bh = Math.ceil(src.height / 4);
  const data = new Uint8Array(levelBytes(src.width, src.height));
  const texels = new Uint8Array(16);
  const encode = format === "bc4" ? encodeBc4Block : encodeEacBlock;
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      blockTexels(src, bx, by, texels);
      encode(texels, data, (by * bw + bx) * 8);
    }
  }
  return { data, width: src.width, height: src.height };
}

/** The published file of `raster` in `format`, its whole mip chain
 *  encoded (`lib/city/block-raster.ts`). */
export function encodeBlockRaster(
  raster: Grey,
  format: BlockFormat
): Uint8Array {
  return packBlockRaster({
    format,
    width: raster.width,
    height: raster.height,
    levels: mipChain(raster).map((level) => encodeLevel(level, format)),
  });
}

// --- decoders (the tests' and the trial's) -----------------------------------

/** What the GPU reads from one level, as a fraction of 255 (a float per
 *  texel; BC4 interpolates past the byte, EAC holds eleven bits). */
export function decodeLevel(
  level: BlockLevel,
  format: BlockFormat
): Float64Array {
  const { width, height, data } = level;
  const out = new Float64Array(width * height);
  const bw = Math.ceil(width / 4);
  const palette = new Int32Array(8);
  for (let b = 0; b < data.length / 8; b += 1) {
    const bx = b % bw;
    const by = Math.floor(b / bw);
    const at = b * 8;
    const value =
      format === "bc4" ? bc4Reader(data, at, palette) : eacReader(data, at);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const px = bx * 4 + x;
        const py = by * 4 + y;
        if (px < width && py < height) {
          out[py * width + px] = value(x, y);
        }
      }
    }
  }
  return out;
}

function bc4Reader(
  data: Uint8Array,
  at: number,
  palette: Int32Array
): (x: number, y: number) => number {
  bc4Palette(data[at], data[at + 1], palette);
  const lo = data[at + 2] | (data[at + 3] << 8) | (data[at + 4] << 16);
  const hi = data[at + 5] | (data[at + 6] << 8) | (data[at + 7] << 16);
  return (x, y) => {
    const t = y * 4 + x;
    const index = t < 8 ? (lo >> (3 * t)) & 7 : (hi >> (3 * (t - 8))) & 7;
    return palette[index] / 35;
  };
}

function eacReader(
  data: Uint8Array,
  at: number
): (x: number, y: number) => number {
  const base = data[at];
  const multiplier = data[at + 1] >> 4;
  const table = data[at + 1] & 15;
  const hiWord = (data[at + 2] << 16) | (data[at + 3] << 8) | data[at + 4];
  const loWord = (data[at + 5] << 16) | (data[at + 6] << 8) | data[at + 7];
  return (x, y) => {
    const p = x * 4 + y;
    const index =
      p < 8 ? (hiWord >> (3 * (7 - p))) & 7 : (loWord >> (3 * (15 - p))) & 7;
    // the nominal 11-bit fraction; SwiftShader reads v·32 / 65 535, up to
    // 0.12 byte steps below it (scripts/eval/block-raster-probe.ts)
    return (eacValue(base, multiplier, table, index) * 255) / 2047;
  };
}
