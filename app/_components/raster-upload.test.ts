import { afterEach, expect, jest, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
} from "three/webgpu";
import type { Texture, WebGPURenderer } from "three/webgpu";
import { loadDataRaster } from "./raster-upload";
import type { RasterLook } from "./raster-upload";
import { trackedBytesOf } from "./three-utils";

/** One PNG chunk: length, type, body (the CRC left at 0). */
const chunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(
    Array.from(type, (c) => c.codePointAt(0) ?? 0),
    4
  );
  out.set(body, 8);
  return out;
};

/** A greyscale PNG of `px` (filter 0 rows, one IDAT; CRCs left at 0: the
 *  viewer's decoder does not check them). */
function greyPng(
  width: number,
  height: number,
  px: Uint8Array
): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
});

/** `promise` settled under Bun's fake timers: the clock moves on 50 ms at a
 *  time, the microtasks between the steps drained, so a retry's backoff
 *  waits on no real time. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  const state = { done: false };
  const watched = promise.finally(() => {
    state.done = true;
  });
  for (let waited = 0; !state.done && waited < 60_000; waited += 50) {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
    jest.advanceTimersByTime(50);
  }
  return await watched;
}

function serve(png: Uint8Array<ArrayBuffer>): void {
  // reason: the loader reads only `ok` and the body of a Response
  globalThis.fetch = (async () => new Response(png)) as unknown as typeof fetch;
}

/** What three's `initTexture` does that the loader relies on: the upload
 *  with the texture as it stands, then its `onUpdate`. */
function fakeRenderer(seen: { mips: boolean; min: number }[]) {
  return {
    initTexture: (texture: Texture) => {
      seen.push({ mips: texture.generateMipmaps, min: texture.minFilter });
      texture.onUpdate?.(texture);
    },
  } as unknown as WebGPURenderer;
}

const NDVI: RasterLook = {
  channels: 1,
  filter: "linear",
  mipmaps: true,
  anisotropy: 16,
  browserFallback: true,
};

test("a raster is on the GPU, set up as it samples, when its load resolves — its bytes gone", async () => {
  serve(greyPng(4, 4, new Uint8Array(16).fill(200)));
  const seen: { mips: boolean; min: number }[] = [];
  const raster = await loadDataRaster("ndvi.png", NDVI, {
    renderer: fakeRenderer(seen),
  });
  if (!raster) {
    throw new Error("the raster did not load");
  }
  const { texture } = raster;
  // uploaded once, with its mip chain already asked for (fixed at the upload)
  expect(seen).toEqual([{ mips: true, min: LinearMipmapLinearFilter }]);
  expect((texture.image as { data: unknown }).data).toBeNull();
  // the size it holds on the GPU is still known (the HUD, the tile cache)
  expect(trackedBytesOf(texture)).toBe(Math.round(16 * (4 / 3)));
});

test("a raster whose download hit a blip is asked for again, not taken for absent", async () => {
  jest.useFakeTimers();
  const png = greyPng(2, 2, new Uint8Array(4).fill(90));
  let calls = 0;
  // reason: the loader reads only `ok` and the body of a Response
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? await Promise.reject(new TypeError("Load failed"))
      : await Promise.resolve(new Response(png));
  }) as unknown as typeof fetch;
  const seen: { mips: boolean; min: number }[] = [];
  expect(
    await settled(
      loadDataRaster("ndvi.png", NDVI, { renderer: fakeRenderer(seen) })
    )
  ).not.toBeNull();
  expect(calls).toBe(2);
});

test("a raster the GPU refuses is absent, and freed", async () => {
  serve(greyPng(2, 2, new Uint8Array(4)));
  let refused: Texture | null = null;
  const renderer = {
    initTexture: (texture: Texture) => {
      refused = texture;
      throw new RangeError("Allocation failure.");
    },
  } as unknown as WebGPURenderer;
  expect(await loadDataRaster("ndvi.png", NDVI, { renderer })).toBeNull();
  expect(refused).not.toBeNull();
  // disposed: no longer counted
  expect(trackedBytesOf(refused as unknown as Texture)).toBe(0);
});

const HORIZON: RasterLook = { channels: 4, filter: "linear", layers: 8 };

test("a layered raster is an array of square layers, or no raster at all in another shape", async () => {
  // 2 × 2 RGBA texels a layer: 8 bytes wide, 2 rows a layer
  serve(greyPng(8, 2 * 8, new Uint8Array(8 * 16)));
  const seen: { mips: boolean; min: number }[] = [];
  const raster = await loadDataRaster("horizon.png", HORIZON, {
    renderer: fakeRenderer(seen),
  });
  if (!raster) {
    throw new Error("the raster did not load");
  }
  expect(raster.texture).toBeInstanceOf(DataArrayTexture);
  const image = raster.texture.image as {
    data: unknown;
    depth: number;
    height: number;
    width: number;
  };
  expect([image.width, image.height, image.depth]).toEqual([2, 2, 8]);
  expect(raster.texture.minFilter).toBe(LinearFilter);
  expect(seen).toEqual([{ mips: false, min: LinearFilter }]);
  expect(image.data).toBeNull();
  expect(trackedBytesOf(raster.texture)).toBe(2 * 2 * 8 * 4);

  // seven layers' height: the wrong shape
  serve(greyPng(8, 2 * 7, new Uint8Array(8 * 14)));
  expect(
    await loadDataRaster("horizon.png", HORIZON, {
      renderer: fakeRenderer([]),
    })
  ).toBeNull();
});

test("a PNG the decoder rejects is absent without the browser fallback", async () => {
  serve(new Uint8Array([1, 2, 3, 4]));
  const seen: { mips: boolean; min: number }[] = [];
  expect(
    await loadDataRaster(
      "svf.png",
      { channels: 1, filter: "linear", mipmaps: true },
      { renderer: fakeRenderer(seen) }
    )
  ).toBeNull();
  expect(seen).toEqual([]);
});
