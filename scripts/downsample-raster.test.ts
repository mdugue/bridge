import { expect, test } from "bun:test";
import sharp from "sharp";
import { downsampleClassRaster } from "./downsample-raster";

/** 8×8 grey+alpha class raster (the DLM bake's layout): 2×2 blocks of ids. */
const CLASS_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7];

function syntheticClassRaster(): Promise<Buffer> {
  const px = new Uint8Array(8 * 8 * 2);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const id = CLASS_IDS[Math.floor(y / 2) * 4 + Math.floor(x / 2)];
      px.set([id, 255], (y * 8 + x) * 2);
    }
  }
  return sharp(px, { raw: { width: 8, height: 8, channels: 2 } })
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
