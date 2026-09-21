import { expect, test } from "bun:test";
import sharp from "sharp";
import { downsampleRaster } from "./downsample-raster";

const LAND = [220, 215, 198];
const WATER = [120, 160, 200];

/** 32×32 RGBA splat: the left half land (alpha 0), the right half water. */
function syntheticColourSplat(): Promise<Buffer> {
  const n = 32;
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const water = x >= n / 2;
      px.set([...(water ? WATER : LAND), water ? 255 : 0], (y * n + x) * 4);
    }
  }
  return sharp(px, { raw: { width: n, height: n, channels: 4 } })
    .png()
    .toBuffer();
}

/** 8×8 grey+alpha class raster: 2×2 blocks of ids, opaque everywhere. */
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

/**
 * The PNG's band layout plus its texels widened to RGB(A) — sharp's `.raw()`
 * never yields grey+alpha as two bands, so the layout is read from the
 * metadata and the texels from the widened buffer (grey → r = g = b).
 */
async function decode(png: Buffer) {
  const { width, height, channels, hasAlpha } = await sharp(png).metadata();
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const texel = (x: number, y: number) => {
    const at = (y * width + x) * info.channels;
    return [...data.subarray(at, at + info.channels)];
  };
  return { layout: [width, height, channels, hasAlpha], texel };
}

/** The largest per-channel difference (Infinity on a channel-count mismatch). */
function deviation(actual: number[], expected: number[]): number {
  if (actual.length !== expected.length) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(...actual.map((v, i) => Math.abs(v - expected[i])));
}

test("the RGB splat keeps its colour where alpha (= water coverage) is 0", async () => {
  const out = await downsampleRaster(
    await syntheticColourSplat(),
    16,
    "lanczos3"
  );
  const { layout, texel } = await decode(out);
  expect(layout).toEqual([16, 16, 4, true]);
  // Columns far from the land/water edge (Lanczos3 reaches 6 source texels
  // at a 2× shrink) reproduce the source: land colour with alpha 0 — the
  // texels sharp's premultiply turned black — and water with alpha 255.
  for (let y = 0; y < 16; y++) {
    expect(deviation(texel(0, y), [...LAND, 0])).toBeLessThanOrEqual(1);
    expect(deviation(texel(15, y), [...WATER, 255])).toBeLessThanOrEqual(1);
  }
  for (let i = 0; i < 16 * 16; i++) {
    const [r, g, b] = texel(i % 16, Math.floor(i / 16));
    expect(r + g + b).toBeGreaterThan(0);
  }
});

test("the class raster stays NEAREST: exact ids, opaque, grey+alpha", async () => {
  const out = await downsampleRaster(
    await syntheticClassRaster(),
    4,
    "nearest"
  );
  const { layout, texel } = await decode(out);
  expect(layout).toEqual([4, 4, 2, true]);
  const ids: number[] = [];
  for (let i = 0; i < 16; i++) {
    const [id, , , alpha] = texel(i % 4, Math.floor(i / 4));
    ids.push(id);
    expect(alpha).toBe(255);
  }
  expect(ids).toEqual(CLASS_IDS);
});

test("a raster without alpha resizes as is", async () => {
  const grey = await sharp(new Uint8Array(64).fill(200), {
    raw: { width: 8, height: 8, channels: 1 },
  })
    .toColourspace("b-w")
    .png()
    .toBuffer();
  const { layout, texel } = await decode(
    await downsampleRaster(grey, 4, "lanczos3")
  );
  expect(layout).toEqual([4, 4, 1, false]);
  for (let i = 0; i < 16; i++) {
    const t = texel(i % 4, Math.floor(i / 4));
    expect(deviation(t, [200, 200, 200])).toBeLessThanOrEqual(1);
  }
});
