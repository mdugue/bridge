/**
 * A minimal PNG decoder for the single-channel DATA rasters (land-cover class
 * ids, NDVI): 8-bit greyscale, non-interlaced — exactly what the bakes write.
 *
 * Why not the browser's decoder: an <img> or ImageBitmap is decoded as a
 * picture. WebKit colour-manages untagged greyscale on the way (and may
 * dither the result), and not every engine honours
 * `colorSpaceConversion: "none"`. For a colour that is invisible; for a class
 * raster it rewrites ids — on iPhones the ground came out speckled with
 * neighbouring classes' colours. Inflating the bytes ourselves hands the GPU
 * exactly what the bake wrote, on every browser. No THREE, no DOM (the inflate
 * is `DecompressionStream`, in browsers and Bun alike).
 */

export interface GreyRaster {
  /** row-major, row 0 = the PNG's first (northern) row */
  data: Uint8Array;
  height: number;
  width: number;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(b: Uint8Array, at: number): number {
  return (
    ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
  );
}

function chunkType(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

interface PngParts {
  height: number;
  idat: Uint8Array<ArrayBuffer>;
  width: number;
}

/** Walks the chunks: IHDR (validated) and the concatenated IDAT stream. */
function readParts(png: Uint8Array): PngParts {
  if (!SIGNATURE.every((v, i) => png[i] === v)) {
    throw new Error("not a PNG");
  }
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = readU32(png, at);
    const type = chunkType(png, at + 4);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = readU32(body, 0);
      height = readU32(body, 4);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || colour !== 0 || interlace !== 0) {
        throw new Error(
          `unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`
        );
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (width === 0 || height === 0 || idat.length === 0) {
    throw new Error("PNG without IHDR/IDAT");
  }
  const total = idat.reduce((n, part) => n + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of idat) {
    joined.set(part, offset);
    offset += part.length;
  }
  return { width, height, idat: joined };
}

async function inflate(zlib: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([zlib])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reverses one scanline's filter into `out` (one byte per pixel, so the
 * "left" neighbour is the previous byte). `prev` is the reconstructed row
 * above; for the first row it is a zero row. Branch-light on purpose: a
 * 4096² class raster is 16 M bytes, mostly Paeth-filtered.
 */
function unfilterRow(
  filter: number,
  line: Uint8Array,
  prev: Uint8Array,
  out: Uint8Array
): void {
  const n = line.length;
  switch (filter) {
    case 0:
      out.set(line);
      return;
    case 1: {
      let left = 0;
      for (let i = 0; i < n; i++) {
        left = (line[i] + left) & 255;
        out[i] = left;
      }
      return;
    }
    case 2:
      for (let i = 0; i < n; i++) {
        out[i] = (line[i] + prev[i]) & 255;
      }
      return;
    case 3: {
      let left = 0;
      for (let i = 0; i < n; i++) {
        left = (line[i] + ((left + prev[i]) >> 1)) & 255;
        out[i] = left;
      }
      return;
    }
    case 4: {
      let left = 0;
      let upLeft = 0;
      for (let i = 0; i < n; i++) {
        const up = prev[i];
        const p = left + up - upLeft;
        const pa = p > left ? p - left : left - p;
        const pb = p > up ? p - up : up - p;
        const pc = p > upLeft ? p - upLeft : upLeft - p;
        const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        left = (line[i] + pred) & 255;
        out[i] = left;
        upLeft = up;
      }
      return;
    }
    default:
      throw new Error(`bad PNG filter ${filter}`);
  }
}

/** Rows unfiltered between yields: ~5 ms of work for a 4096-wide raster. */
const ROWS_PER_SLICE = 256;

const yieldToFrame = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Decodes an 8-bit greyscale PNG to its exact bytes. Throws on anything else.
 * The inflate runs in the browser's stream machinery; the unfiltering is
 * sliced (yielding every few hundred rows) so a 4096² raster — ~80 ms of
 * work — never stalls a frame while a tile streams in.
 */
export async function decodeGreyPng(png: Uint8Array): Promise<GreyRaster> {
  const { width, height, idat } = readParts(png);
  const raw = await inflate(idat);
  const stride = width + 1;
  if (raw.length < stride * height) {
    throw new Error("truncated PNG data");
  }
  const data = new Uint8Array(width * height);
  const zeroRow = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * stride + 1, (y + 1) * stride);
    const out = data.subarray(y * width, (y + 1) * width);
    const prev = y > 0 ? data.subarray((y - 1) * width, y * width) : zeroRow;
    unfilterRow(raw[y * stride], line, prev, out);
    if (y % ROWS_PER_SLICE === ROWS_PER_SLICE - 1) {
      await yieldToFrame();
    }
  }
  return { width, height, data };
}
