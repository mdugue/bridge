/**
 * Downsamples a baked raster for scripts/prepare-data.ts: a land-cover
 * class raster, or one whose channels the bake interleaved in a greyscale
 * PNG (`downsampleInterleaved`).
 * NEAREST, so no class ids blend. Only class rasters are resized: the colour
 * splat is painted in the client (app/_components/landcover-splat.ts), so no
 * raster whose alpha channel carries data goes through an image tool's
 * (premultiplied) resize any more. The output is single-band grey — the
 * loader uploads the red channel alone.
 */
import sharp from "sharp";

export async function downsampleClassRaster(
  source: string | Buffer,
  px: number
): Promise<Buffer> {
  return await sharp(source)
    .removeAlpha()
    .resize(px, px, { kernel: "nearest", fit: "fill" })
    .toColourspace("b-w")
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

/**
 * A raster of `channels` interleaved bytes a texel (R0 G0 … R1 G1 …: a
 * greyscale PNG that many times as wide, app/_components/raster-upload.ts)
 * at `px` texels a side: every n-th texel of every n-th row, each with all
 * its channels — ids, bits and distances as baked, none blended. No image
 * resize touches it (it would step through the channels as if they were
 * pixels). A raster already that small, or one `px` does not divide, is
 * refused.
 */
export async function downsampleInterleaved(
  source: string | Buffer,
  px: number,
  channels: 2 | 4
): Promise<Buffer> {
  const { data, info } = await sharp(source)
    .removeAlpha()
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const texels = info.width / channels;
  const step = texels / px;
  if (!(Number.isInteger(step) && step > 1 && info.height === texels)) {
    throw new Error(
      `a ${info.width} × ${info.height} raster of ${channels} channels has no ${px}² twin`
    );
  }
  // the texel in the middle of each n × n block
  const off = Math.floor(step / 2);
  const out = Buffer.alloc(px * px * channels);
  for (let y = 0; y < px; y += 1) {
    const row = (y * step + off) * info.width;
    for (let x = 0; x < px; x += 1) {
      const from = row + (x * step + off) * channels;
      data.copy(out, (y * px + x) * channels, from, from + channels);
    }
  }
  return await sharp(out, {
    raw: { width: px * channels, height: px, channels: 1 },
  })
    .toColourspace("b-w")
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}
