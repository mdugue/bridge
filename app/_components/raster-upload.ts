import type { Texture, WebGPURenderer } from "three/webgpu";
import { OPTIONAL_FETCH_BUDGET_MS } from "@/lib/city/fetch-retry";
import { createTaskGate } from "@/lib/city/task-gate";
import { fetchBytes } from "./fetch-optional";
import type { DeviceTier } from "./scene-profile";

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
 * what it always did, so its boot is not held up: five decodes at once (a
 * level decodes its rasters one after another, and the tile renderer
 * parses five tiles at once), each raster uploaded by the compile of the
 * first material that binds it. Through one turn, the spawn tile's ground
 * waited behind every neighbour's; uploaded as they decoded, every
 * neighbour's rasters took the main thread before the spawn tile's
 * compile (7 s of the first 18 under SwiftShader) — the whole-site boot
 * took 40 %, then 15 % longer than before.
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
 * loads its rasters one after another inside its dressing, so a longer
 * budget each would hold it for minutes on a dead network. Rejects on an
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
export function inRasterTurn<T>(
  task: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return rasterGate.run(task, signal);
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
  } catch (err) {
    texture.dispose();
    throw err;
  }
}
