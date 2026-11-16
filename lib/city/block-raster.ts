/**
 * A soft raster as GPU blocks (plan 091 phase 2, the trial on the sky
 * view): the published file the viewer uploads as a compressed texture,
 * its mip chain inside, so the GPU neither decodes a PNG nor makes mips.
 * Written by `scripts/block-encode.ts`; read here, with no THREE and no
 * DOM (as `point-pack.ts`).
 *
 * The file, little-endian: a 16-byte header — the magic `BLK1`, the format
 * (u8: 1 BC4, 2 EAC R11), the number of levels (u8), two bytes zero, the
 * width and the height of level 0 (u32 each) — then each level's blocks,
 * level 0 first, a level `ceil(w / 4) × ceil(h / 4)` blocks of 8 bytes,
 * row by row from the raster's first (northern) row, each level half the
 * one above (at least 1). Only a one-channel SOFT raster goes this way:
 * the blocks are lossy (AGENTS.md, "Data").
 */

/** The block formats, by the GPU feature each needs. */
export type BlockFormat = "bc4" | "eac";

export const BLOCK_MAGIC = "BLK1";
export const BLOCK_HEADER_BYTES = 16;
/** Bytes a 4 × 4 block of one channel takes, in both formats. */
export const BLOCK_BYTES = 8;

const FORMAT_CODE: Readonly<Record<BlockFormat, number>> = { bc4: 1, eac: 2 };

/** The WebGPU feature a format needs (`renderer.hasFeature`). */
export const BLOCK_FEATURE: Readonly<Record<BlockFormat, string>> = {
  bc4: "texture-compression-bc",
  eac: "texture-compression-etc2",
};

/** One level of a block raster: its size in texels and its blocks. */
export interface BlockLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

export interface BlockRaster {
  format: BlockFormat;
  height: number;
  levels: BlockLevel[];
  width: number;
}

/** The sizes of a full mip chain from `width` × `height` down to 1 × 1. */
export function mipSizes(
  width: number,
  height: number
): { height: number; width: number }[] {
  const sizes = [{ width, height }];
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    sizes.push({ width: w, height: h });
  }
  return sizes;
}

/** The bytes of one level's blocks. */
export function levelBytes(width: number, height: number): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * BLOCK_BYTES;
}

/** The file of `raster` (its levels' data concatenated after the header). */
export function packBlockRaster(raster: BlockRaster): Uint8Array {
  const total = raster.levels.reduce((sum, l) => sum + l.data.length, 0);
  const out = new Uint8Array(BLOCK_HEADER_BYTES + total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) {
    out[i] = BLOCK_MAGIC.codePointAt(i) ?? 0;
  }
  out[4] = FORMAT_CODE[raster.format];
  out[5] = raster.levels.length;
  view.setUint32(8, raster.width, true);
  view.setUint32(12, raster.height, true);
  let at = BLOCK_HEADER_BYTES;
  for (const level of raster.levels) {
    out.set(level.data, at);
    at += level.data.length;
  }
  return out;
}

function formatOf(code: number): BlockFormat {
  if (code === FORMAT_CODE.bc4) {
    return "bc4";
  }
  if (code === FORMAT_CODE.eac) {
    return "eac";
  }
  throw new Error(`block raster: unknown format ${code}`);
}

/** Reads a block raster's file; throws on a wrong magic, an unknown
 *  format or a length that does not match its levels. The levels are
 *  views of `bytes`. */
export function parseBlockRaster(bytes: Uint8Array): BlockRaster {
  if (bytes.length < BLOCK_HEADER_BYTES) {
    throw new Error("block raster: truncated header");
  }
  for (let i = 0; i < 4; i += 1) {
    if (bytes[i] !== BLOCK_MAGIC.codePointAt(i)) {
      throw new Error("block raster: wrong magic");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = formatOf(bytes[4]);
  const count = bytes[5];
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const sizes = mipSizes(width, height);
  if (count < 1 || count > sizes.length) {
    throw new Error(`block raster: ${count} levels for ${width}×${height}`);
  }
  const levels: BlockLevel[] = [];
  let at = BLOCK_HEADER_BYTES;
  for (const size of sizes.slice(0, count)) {
    const length = levelBytes(size.width, size.height);
    if (at + length > bytes.length) {
      throw new Error("block raster: truncated level");
    }
    levels.push({ ...size, data: bytes.subarray(at, at + length) });
    at += length;
  }
  if (at !== bytes.length) {
    throw new Error("block raster: trailing bytes");
  }
  return { format, width, height, levels };
}
