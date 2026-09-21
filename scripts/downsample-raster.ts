/**
 * Downsamples one baked land-cover raster for scripts/prepare-data.ts.
 *
 * The trap this exists to avoid: sharp premultiplies alpha across `resize`
 * and unpremultiplies afterwards, which maps alpha = 0 to colour 0. On the
 * pastel RGB splat alpha is water COVERAGE, so alpha = 0 is every land
 * texel — a plain `sharp(src).resize()` turns the whole ground black (on the
 * committed 4096² bakes 100 % of land texels came out (0,0,0)). Neither
 * `removeAlpha()` (sharp applies it after the resize) nor the raw-input
 * `premultiplied` flag prevents it. What does: resizing the colour channels
 * and the alpha channel as two alpha-less raw images and joining them again.
 */
import sharp, { type OutputInfo, type Sharp } from "sharp";
import type { RasterResample } from "../lib/city/tile";

interface RawImage {
  data: Buffer;
  info: OutputInfo;
}

const PNG = { compressionLevel: 9, palette: false } as const;

/** sharp widens a single-band image to sRGB on output unless told not to. */
function keepBands(image: Sharp, channels: number): Sharp {
  return channels === 1 ? image.toColourspace("b-w") : image;
}

function toRaw(image: Sharp, channels: number): Promise<RawImage> {
  return keepBands(image, channels).raw().toBuffer({ resolveWithObject: true });
}

function resizeRaw(
  { data, info }: RawImage,
  px: number,
  kernel: RasterResample
): Promise<Buffer> {
  const { width, height, channels } = info;
  const resized = sharp(data, { raw: { width, height, channels } }).resize(
    px,
    px,
    { kernel, fit: "fill" }
  );
  return keepBands(resized, channels).raw().toBuffer();
}

/**
 * The raster at `px`² as a PNG with the source's channel layout. NEAREST
 * keeps class ids exact (no blending); Lanczos filters colour. Every channel
 * — alpha included — is resampled independently of the others.
 */
export async function downsampleRaster(
  source: string | Buffer,
  px: number,
  kernel: RasterResample
): Promise<Buffer> {
  const image = sharp(source);
  const { channels, hasAlpha } = await image.metadata();
  if (!hasAlpha) {
    const resized = image.resize(px, px, { kernel, fit: "fill" });
    return keepBands(resized, channels).png(PNG).toBuffer();
  }
  // Grey+alpha (the class raster) or RGBA (the colour splat).
  const colourChannels = channels - 1;
  const colour = await toRaw(image.clone().removeAlpha(), colourChannels);
  const alpha = await toRaw(
    image.clone().extractChannel(channels === 2 ? 1 : 3),
    1
  );
  const [colourSmall, alphaSmall] = await Promise.all([
    resizeRaw(colour, px, kernel),
    resizeRaw(alpha, px, kernel),
  ]);
  const size = { width: px, height: px };
  const joined = sharp(colourSmall, {
    raw: { ...size, channels: colour.info.channels },
  }).joinChannel(alphaSmall, { raw: { ...size, channels: 1 } });
  return keepBands(joined, colourChannels).png(PNG).toBuffer();
}
