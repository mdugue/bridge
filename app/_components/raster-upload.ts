import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Texture,
  UnsignedByteType,
} from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { OPTIONAL_FETCH_BUDGET_MS } from "@/lib/city/fetch-retry";
import { decodeGreyPng } from "@/lib/city/png-raster";
import type { GreyRaster } from "@/lib/city/png-raster";
import { createTaskGate } from "@/lib/city/task-gate";
import { fetchBytes, isAbortError } from "./fetch-optional";
import type { DeviceTier } from "./scene-profile";
import { streamTimings } from "./stream-timing";
import { textureBytes, trackTexture } from "./three-utils";

/**
 * The streamed rasters' decode and upload, one at a time for the whole
 * site. A tile's rasters decode to up to 16 MB each (a 2048² RGBA), and the
 * tile renderer parses several tiles at once: each level held every raster
 * it had decoded until its compile uploaded them, so a boot or a flight
 * held several levels' worth at the same moment — on a phone, memory the
 * page's process was ended for. Through the gate, a raster is decoded and
 * on the GPU (`uploadNow`, its bytes dropped) before the next one decodes.
 * The download stays outside, its retries with it: a stalled request must
 * not hold the ground of every other tile.
 *
 * That is a phone's (`setRasterTier`). A desktop has the memory and keeps
 * what it always did, so its boot is not held up: five decodes at once (the
 * tile renderer parses five tiles at once, and a level asks for all its
 * rasters together, terrain-layer.ts `loadTerrainRasters`), each raster
 * uploaded by the compile of the first material that binds it. Through
 * one turn, the spawn tile's ground waited behind every neighbour's;
 * uploaded as they decoded, every neighbour's rasters took the main thread
 * before the spawn tile's compile (7 s of the first 18 under SwiftShader)
 * — the whole-site boot took 40 %, then 15 % longer than before.
 */
const rasterGate = createTaskGate(1);
let uploadAtDecode = true;

/** How many rasters decode at once, per device tier. */
export const RASTER_TURNS: Readonly<Record<DeviceTier, number>> = {
  desktop: 5,
  mobile: 1,
};

/**
 * This page's tier (tile-stream.ts): a phone decodes one raster at a time
 * and uploads it at once; a desktop decodes five at once and uploads at
 * the compile.
 */
export function setRasterTier(tier: DeviceTier): void {
  rasterGate.setLimit(RASTER_TURNS[tier]);
  uploadAtDecode = tier === "mobile";
}

/**
 * A raster's PNG bytes, through the viewer's one fetch policy
 * (fetch-optional.ts `fetchBytes`): a blip is retried for the budget of an
 * optional file — every raster is optional to its level, and a level
 * waits for all of its rasters inside its dressing, so a longer budget
 * would hold it that much longer on a dead network. Rejects on an
 * HTTP error, a network give-up and an abort.
 */
export async function fetchRasterBytes(
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  const got = await fetchBytes(url, {
    signal,
    budgetMs: OPTIONAL_FETCH_BUDGET_MS,
  });
  if (!got.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${got.status}`);
  }
  return got.bytes;
}

/** Runs a raster's decode and upload in its turn (see `rasterGate`);
 *  rejects with the abort when `signal` fires while it waits. */
export async function inRasterTurn<T>(
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return await rasterGate.run(task, signal);
}

/** Drops a data texture's CPU copy once the GPU has it: dead weight after
 *  the upload (mipmaps are generated on the GPU). */
export function dropDataOnUpload(texture: Texture): void {
  texture.onUpdate = () => {
    (texture.image as { data: Uint8Array | null }).data = null;
    texture.onUpdate = null;
  };
}

/**
 * On a phone (`setRasterTier`), uploads a texture now (three's public
 * `initTexture`) rather than at the compile of the first material that
 * binds it: a data texture's bytes are dropped right away
 * (`dropDataOnUpload`). Configure it first — its format, filters and mip
 * chain are fixed at the upload. One that fails to upload is disposed and
 * the error rethrown (the caller treats the raster as absent). On a
 * desktop it leaves the upload to the compile, as before.
 */
export function uploadNow(
  texture: Texture,
  renderer: WebGPURenderer | undefined
): void {
  if (!(renderer && uploadAtDecode)) {
    return;
  }
  try {
    renderer.initTexture(texture);
  } catch (error) {
    texture.dispose();
    throw error;
  }
}

/**
 * How a data raster is sampled: its channels (the bake interleaves them in
 * a greyscale PNG), NEAREST for ids and LINEAR for fields, a mip chain
 * where it is read from afar. Set before the upload: the format and the
 * mip chain are fixed by it.
 */
export interface RasterLook {
  anisotropy?: number;
  /** a 1-channel PNG the viewer's decoder rejects goes to the browser's
   *  (`loadBitmapTexture`; the browser cannot de-interleave more channels) */
  browserFallback?: true;
  channels: 1 | 2 | 4;
  filter: "linear" | "nearest";
  /** an array texture of this many square layers, stacked north to south
   *  in the PNG; another shape is no raster */
  layers?: number;
  mipmaps?: boolean;
}

/** A loaded raster and its size in texels (of one layer). */
export interface LoadedRaster {
  height: number;
  texture: Texture;
  width: number;
}

/** Reads a raster's decoded bytes before its upload may drop them. */
export type RasterInspect = (
  data: Uint8Array,
  width: number,
  height: number
) => void;

/** What a decode brought: the bytes until the upload drops them (not a
 *  bitmap's). */
type DecodedRaster = LoadedRaster & { data?: Uint8Array };

/** Applies `look` and records the texture's GPU bytes (trackTexture). */
function applyLook(raster: LoadedRaster, look: RasterLook): void {
  const { texture: map } = raster;
  const filter = look.filter === "nearest" ? NearestFilter : LinearFilter;
  map.magFilter = filter;
  map.minFilter = look.mipmaps ? LinearMipmapLinearFilter : filter;
  map.generateMipmaps = look.mipmaps === true;
  if (look.anisotropy) {
    map.anisotropy = look.anisotropy;
  }
  map.colorSpace = NoColorSpace;
  trackTexture(
    map,
    textureBytes(
      raster.width,
      raster.height * (look.layers ?? 1),
      look.channels,
      look.mipmaps === true
    )
  );
}

/** The texture format of an interleaved raster with this many channels. */
function rasterFormat(channels: 1 | 2 | 4) {
  if (channels === 4) {
    return RGBAFormat;
  }
  return channels === 2 ? RGFormat : RedFormat;
}

/**
 * The texture of a decoded raster, or null when it has the wrong shape for
 * `look.layers`. A two- or four-channel raster is baked as a greyscale PNG
 * two or four times as wide, its bytes interleaved (R0 G0 B0 A0 R1 …) —
 * exactly the RG8 / RGBA8 layout; a layered one has its layers stacked,
 * each n rows of n texels: exactly a DataArrayTexture's layer-major layout.
 */
function textureOf(raster: GreyRaster, look: RasterLook): DecodedRaster | null {
  const width = raster.width / look.channels;
  const height = look.layers ? width : raster.height;
  if (look.layers && raster.height !== width * look.layers) {
    return null;
  }
  const map = look.layers
    ? new DataArrayTexture(raster.data, width, height, look.layers)
    : new DataTexture(raster.data, width, height);
  map.format = rasterFormat(look.channels);
  map.type = UnsignedByteType;
  // Row 0 is the PNG's first (northern) row, as with the bitmap upload
  // (flipY = false; v grows southward).
  map.flipY = false;
  map.unpackAlignment = 1;
  map.needsUpdate = true;
  // 16 MB of CPU bytes for a 4096² raster: dead weight once the GPU has
  // them. Twelve resident copies took mobile Safari past its per-tab
  // memory limit when these were bitmaps.
  dropDataOnUpload(map);
  return { texture: map, width, height, data: raster.data };
}

/**
 * The browser-decoded fallback for a raster the PNG decoder rejects:
 * `createImageBitmap` decodes in the browser's image workers, already in the
 * orientation three needs (`imageOrientation: "none"` = flipY false).
 */
async function loadBitmapTexture(blob: Blob): Promise<LoadedRaster> {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const bitmapTexture = new Texture(bitmap);
  bitmapTexture.flipY = false;
  bitmapTexture.format = RedFormat;
  bitmapTexture.needsUpdate = true;
  // Not closed after the upload, unlike the data rasters' bytes: three may
  // upload the image again (a re-created GPU texture reads `image`), and a
  // closed bitmap uploads empty — the ground would turn to class 0. Freed
  // with the texture instead. Rare: only a PNG our decoder rejects lands
  // here.
  bitmapTexture.addEventListener("dispose", () => {
    bitmap.close();
  });
  return { texture: bitmapTexture, width: bitmap.width, height: bitmap.height };
}

/** The raster's texture from its PNG bytes (see `loadDataRaster`). */
async function decodeRaster(
  bytes: Uint8Array<ArrayBuffer>,
  look: RasterLook,
  signal?: AbortSignal
): Promise<DecodedRaster | null> {
  let raster: GreyRaster;
  try {
    raster = await decodeGreyPng(bytes);
  } catch (error) {
    if (!look.browserFallback) {
      throw error;
    }
    return await loadBitmapTexture(new Blob([bytes]));
  }
  signal?.throwIfAborted();
  return textureOf(raster, look);
}

/**
 * A DATA raster as a texture holding exactly the baked bytes: on the GPU (or
 * set up for the compile, on a desktop) when it resolves, its CPU bytes
 * dropped at the upload — or null: absent, undecodable, the wrong shape for
 * `look.layers`, or refused by the GPU (freed). Rejects with an abort.
 * Decoded and uploaded in its turn (`rasterGate`). The PNG is inflated and
 * unfiltered here (lib/city/png-raster.ts), not by the browser's image
 * decoder: WebKit colour-manages (and dithers) untagged greyscale even with
 * `colorSpaceConversion: "none"`, which on iPhones rewrote class ids into
 * speckles of the neighbouring classes' colours. The inflate is async and
 * the unfiltering yields every few hundred rows, so a 4096² raster does not
 * stall the frame it streams in with.
 */
export async function loadDataRaster(
  url: string,
  look: RasterLook,
  opts: {
    inspect?: RasterInspect;
    renderer?: WebGPURenderer;
    signal?: AbortSignal;
  } = {}
): Promise<LoadedRaster | null> {
  const { inspect, renderer, signal } = opts;
  try {
    // (the three parts of a raster's wait, apart: the network, its turn at
    // the gate, and the inflate with the upload — `?trace=1` tells which
    // one a slow ground waits for)
    const bytes = await streamTimings.timed(
      "raster:fetch",
      async () => await fetchRasterBytes(url, signal)
    );
    const queued = streamTimings.now();
    return await inRasterTurn(async () => {
      streamTimings.since("raster:turn-wait", queued);
      const started = streamTimings.now();
      try {
        const raster = await decodeRaster(bytes, look, signal);
        if (!raster) {
          return null;
        }
        if (inspect && raster.data) {
          inspect(raster.data, raster.width, raster.height);
        }
        applyLook(raster, look);
        uploadNow(raster.texture, renderer);
        const { texture, width, height } = raster;
        return { texture, width, height };
      } finally {
        streamTimings.since("raster:decode", started);
      }
    }, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return null;
  }
}
