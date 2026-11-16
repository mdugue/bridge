/**
 * A level of block-compressed texels built to cover a format's rules
 * (plan 091 phase 2): sixteen 4 × 4 blocks in one row, a 64 × 4 level
 * (a GPU's readback wants rows of 256 bytes), block `b` with every index
 * somewhere. For EAC R11 block `b` has table `b`, multiplier b mod 9 (0
 * included) and base 128, so every modifier table is read and no value
 * reaches the clamp at 0 or 2047, which would hide a changed modifier; for BC4 the even blocks have r0 > r1 (eight
 * interpolated values), the odd ones r0 ≤ r1 (six, then 0 and 255).
 * What a GPU reads from it is pinned in `scripts/block-encode.test.ts`
 * (read by `scripts/eval/block-raster-probe.ts --known`), so that the
 * encoder's own tables cannot drift unseen.
 */
import type { BlockFormat, BlockLevel } from "../lib/city/block-raster";

const WIDTH = 64;
const HEIGHT = 4;

/** Block `b`'s 48 index bits: texel `t`'s index (t + b) mod 8, written in
 *  the format's own order (BC4 little-endian by row, EAC big-endian by
 *  column). */
function indexBytes(format: BlockFormat, b: number): number[] {
  const index = (x: number, y: number) => (y * 4 + x + b) % 8;
  if (format === "bc4") {
    let lo = 0;
    let hi = 0;
    for (let t = 0; t < 8; t += 1) {
      lo |= index(t % 4, Math.floor(t / 4)) << (3 * t);
      hi |= index(t % 4, 2 + Math.floor(t / 4)) << (3 * t);
    }
    return [
      lo & 255,
      (lo >> 8) & 255,
      (lo >> 16) & 255,
      hi & 255,
      (hi >> 8) & 255,
      (hi >> 16) & 255,
    ];
  }
  let hiWord = 0;
  let loWord = 0;
  for (let p = 0; p < 16; p += 1) {
    const value = index(Math.floor(p / 4), p % 4);
    if (p < 8) {
      hiWord = hiWord * 8 + value;
    } else {
      loWord = loWord * 8 + value;
    }
  }
  return [
    (hiWord >> 16) & 255,
    (hiWord >> 8) & 255,
    hiWord & 255,
    (loWord >> 16) & 255,
    (loWord >> 8) & 255,
    loWord & 255,
  ];
}

/** Block `b`'s first two bytes: BC4's ends, EAC's base and its
 *  multiplier and table. */
function headBytes(format: BlockFormat, b: number): number[] {
  if (format === "eac") {
    return [128, ((b % 9) << 4) | b];
  }
  return b % 2 === 0 ? [200 - b * 7, 20 + b * 3] : [30 + b * 5, 220 - b * 4];
}

/** The level: sixteen blocks side by side. */
export function knownLevel(format: BlockFormat): BlockLevel {
  const data = new Uint8Array(16 * 8);
  for (let b = 0; b < 16; b += 1) {
    const head = headBytes(format, b);
    data.set([...head, ...indexBytes(format, b)], b * 8);
  }
  return { data, width: WIDTH, height: HEIGHT };
}
