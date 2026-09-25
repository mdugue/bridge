/**
 * Crops the allotment-colony raster for scripts/prepare-data.ts
 * (pipeline/bake/cultivated.py: two bytes per texel, interleaved in a
 * greyscale PNG twice as wide — R the signed distance to the garden land's
 * edge, 0 far outside; G the colony's axis). Colonies cover a corner of
 * most tiles, and the full 2048² RG raster is 8 MiB of GPU memory, so the
 * viewer gets only the texels that carry a colony — the crop named in the
 * terrain's extras (`cultivatedCrop`) — and phones a half-resolution twin
 * of that crop. Bytes are copied, never resampled by an image tool.
 */
import sharp from "sharp";

/** `[x, y, width, height, size]`: the crop in texels of the `size`² raster. */
export type ColonyCrop = [number, number, number, number, number];

/** Texels of margin kept around the colonies (the LINEAR edge's reach). */
const MARGIN = 2;

/**
 * The texels that carry a colony (R > 0) with a margin, on even bounds so
 * the half-resolution twin covers exactly the same ground; null when none.
 */
export function colonyCrop(rg: Uint8Array, size: number): ColonyCrop | null {
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rg[(y * size + x) * 2] > 0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) {
    return null;
  }
  const lo = (v: number) => Math.max(0, Math.floor((v - MARGIN) / 2) * 2);
  const hi = (v: number) => Math.min(size, Math.ceil((v + 1 + MARGIN) / 2) * 2);
  const [cx, cy] = [lo(x0), lo(y0)];
  return [cx, cy, hi(x1) - cx, hi(y1) - cy, size];
}

/** The crop's texels (RG interleaved), row by row. */
export function cropRg(rg: Uint8Array, crop: ColonyCrop): Uint8Array {
  const [x, y, w, h, size] = crop;
  const out = new Uint8Array(w * h * 2);
  for (let r = 0; r < h; r++) {
    const from = ((y + r) * size + x) * 2;
    out.set(rg.subarray(from, from + w * 2), r * w * 2);
  }
  return out;
}

/**
 * Half resolution: each 2×2 block's mean distance (a "far outside" 0 counts
 * as the byte's floor, 1; a mean at the floor stays 0) and its largest axis
 * code (inside one colony all four agree).
 */
export function halveRg(rg: Uint8Array, w: number, h: number): Uint8Array {
  const [hw, hh] = [w / 2, h / 2];
  const out = new Uint8Array(hw * hh * 2);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let sum = 0;
      let axis = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const i = ((2 * y + dy) * w + 2 * x + dx) * 2;
        sum += Math.max(rg[i], 1);
        axis = Math.max(axis, rg[i + 1]);
      }
      const mean = Math.round(sum / 4);
      out[(y * hw + x) * 2] = mean <= 1 ? 0 : mean;
      out[(y * hw + x) * 2 + 1] = mean <= 1 ? 0 : axis;
    }
  }
  return out;
}

function encode(rg: Uint8Array, w: number, h: number): Promise<Buffer> {
  return sharp(rg, { raw: { width: w * 2, height: h, channels: 1 } })
    .toColourspace("b-w")
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

/** The cropped raster, its half-resolution twin and the crop; null when
 *  the tile has no colony. */
export async function cropColonyRaster(
  source: string | Buffer
): Promise<{ crop: ColonyCrop; full: Buffer; low: Buffer } | null> {
  const { data, info } = await sharp(source)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = info.height;
  if (info.width !== size * 2) {
    throw new Error(
      `colony raster ${info.width}×${info.height}: not RG ${size}²`
    );
  }
  const rg = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const crop = colonyCrop(rg, size);
  if (!crop) {
    return null;
  }
  const [, , w, h] = crop;
  const cut = cropRg(rg, crop);
  return {
    crop,
    full: await encode(cut, w, h),
    low: await encode(halveRg(cut, w, h), w / 2, h / 2),
  };
}
