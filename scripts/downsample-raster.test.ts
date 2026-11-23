import { expect, test } from "bun:test";
import sharp from "sharp";
import {
  downsampleClassRaster,
  downsampleInterleaved,
} from "./downsample-raster";

/** 8×8 grey+alpha class raster (the DLM bake's layout): 2×2 blocks of ids. */
const CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7];

async function syntheticClassRaster(): Promise<Buffer> {
  const px = new Uint8Array(8 * 8 * 2);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const id = CLASS_IDS[Math.floor(y / 2) * 4 + Math.floor(x / 2)];
      px.set([id, 255], (y * 8 + x) * 2);
    }
  }
  return await sharp(px, { raw: { width: 8, height: 8, channels: 2 } })
    .toColourspace("b-w")
    .png()
    .toBuffer();
}

test("the class raster stays NEAREST: exact ids in a single grey band", async () => {
  const out = await downsampleClassRaster(await syntheticClassRaster(), 4);
  const { width, height, channels } = await sharp(out).metadata();
  expect([width, height, channels]).toEqual([4, 4, 1]);
  const { data } = await sharp(out)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([...data]).toEqual(CLASS_IDS);
});

test("an interleaved raster's twin keeps whole texels: every channel of the block's middle one, as baked", async () => {
  // 4 × 4 texels of two channels (8 bytes a row): texel (x, y) = [16y + x, 200 + 4y + x]
  const bytes = new Uint8Array(8 * 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      bytes.set([16 * y + x, 200 + 4 * y + x], (y * 4 + x) * 2);
    }
  }
  const source = await sharp(bytes, {
    raw: { width: 8, height: 4, channels: 1 },
  })
    .png()
    .toBuffer();
  const out = await downsampleInterleaved(source, 2, 2);
  const { width, height, channels } = await sharp(out).metadata();
  expect([width, height, channels]).toEqual([4, 2, 1]);
  const { data } = await sharp(out)
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // the texels (1, 1), (3, 1), (1, 3), (3, 3)
  expect([...data]).toEqual([17, 205, 19, 207, 49, 213, 51, 215]);
  // no twin of the same size, nor of one the raster's does not divide by
  await expect(downsampleInterleaved(source, 4, 2)).rejects.toThrow("twin");
  await expect(downsampleInterleaved(source, 3, 2)).rejects.toThrow("twin");
});
