/**
 * Downsamples one baked land-cover class raster for scripts/prepare-data.ts.
 * NEAREST, so no class ids blend. Only class rasters are resized: the colour
 * splat is painted in the client (app/_components/landcover-splat.ts), so no
 * raster whose alpha channel carries data goes through an image tool's
 * (premultiplied) resize any more. The output is single-band grey — the
 * loader uploads the red channel alone.
 */
import sharp from "sharp";

export function downsampleClassRaster(
  source: string | Buffer,
  px: number
): Promise<Buffer> {
  return sharp(source)
    .removeAlpha()
    .resize(px, px, { kernel: "nearest", fit: "fill" })
    .toColourspace("b-w")
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}
