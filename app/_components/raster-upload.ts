import type { Texture, WebGPURenderer } from "three/webgpu";
import { createTaskGate } from "@/lib/city/task-gate";

/**
 * The streamed rasters' decode and upload, one at a time for the whole
 * site. A tile's rasters decode to up to 16 MB each (a 2048² RGBA), and the
 * tile renderer parses several tiles at once: each level held every raster
 * it had decoded until its compile uploaded them, so a boot or a flight
 * held several levels' worth at the same moment — on a phone, memory the
 * page's process was ended for. Through the gate, a raster is decoded and
 * on the GPU (`uploadNow`, its bytes dropped) before the next one decodes.
 * The download stays outside: a stalled request must not hold the ground
 * of every other tile.
 */
const rasterGate = createTaskGate(1);

/** A raster's PNG bytes. Rejects on a network failure, an HTTP error and
 *  an abort. */
export async function fetchRasterBytes(
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
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
 * Uploads a texture now (three's public `initTexture`) rather than at the
 * compile of the first material that binds it: a data texture's bytes are
 * dropped right away (`dropDataOnUpload`). Configure it first — its format,
 * filters and mip chain are fixed at the upload. One that fails to upload
 * is disposed and the error rethrown (the caller treats the raster as
 * absent).
 */
export function uploadNow(
  texture: Texture,
  renderer: WebGPURenderer | undefined
): void {
  if (!renderer) {
    return;
  }
  try {
    renderer.initTexture(texture);
  } catch (err) {
    texture.dispose();
    throw err;
  }
}
