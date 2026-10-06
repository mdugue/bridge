import { afterEach, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  LinearMipmapLinearFilter,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { loadNdviTexture } from "./terrain-layer";
import { trackedBytesOf } from "./three-utils";

/** A greyscale PNG of `px` (filter 0 rows, one IDAT; CRCs left at 0: the
 *  viewer's decoder does not check them). */
function greyPng(
  width: number,
  height: number,
  px: Uint8Array
): Uint8Array<ArrayBuffer> {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    new DataView(out.buffer).setUint32(0, body.length);
    out.set(
      Array.from(type, (c) => c.charCodeAt(0)),
      4
    );
    out.set(body, 8);
    return out;
  };
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
const realRandom = Math.random;
afterEach(() => {
  globalThis.fetch = realFetch;
  Math.random = realRandom;
});

function serve(png: Uint8Array<ArrayBuffer>): void {
  // reason: the loader reads only `ok` and the body of a Response
  globalThis.fetch = (() =>
    Promise.resolve(new Response(png))) as unknown as typeof fetch;
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

test("a raster is on the GPU, set up as it samples, when its load resolves — its bytes gone", async () => {
  serve(greyPng(4, 4, new Uint8Array(16).fill(200)));
  const seen: { mips: boolean; min: number }[] = [];
  const texture = await loadNdviTexture("ndvi.png", fakeRenderer(seen));
  if (!texture) {
    throw new Error("the raster did not load");
  }
  // uploaded once, with its mip chain already asked for (fixed at the upload)
  expect(seen).toEqual([{ mips: true, min: LinearMipmapLinearFilter }]);
  expect((texture.image as { data: unknown }).data).toBeNull();
  // the size it holds on the GPU is still known (the HUD, the tile cache)
  expect(trackedBytesOf(texture)).toBe(Math.round(16 * (4 / 3)));
});

test("a raster whose download hit a blip is asked for again, not taken for absent", async () => {
  // the shortest backoff (0.25 s), so the test waits for one real retry
  Math.random = () => 0;
  const png = greyPng(2, 2, new Uint8Array(4).fill(90));
  let calls = 0;
  // reason: the loader reads only `ok` and the body of a Response
  globalThis.fetch = (() =>
    ++calls === 1
      ? Promise.reject(new TypeError("Load failed"))
      : Promise.resolve(new Response(png))) as unknown as typeof fetch;
  const seen: { mips: boolean; min: number }[] = [];
  expect(await loadNdviTexture("ndvi.png", fakeRenderer(seen))).not.toBeNull();
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
  expect(await loadNdviTexture("ndvi.png", renderer)).toBeNull();
  expect(refused).not.toBeNull();
  // disposed: no longer counted
  expect(trackedBytesOf(refused as unknown as Texture)).toBe(0);
});
