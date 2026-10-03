import type { Texture } from "three/webgpu";
import { trackedBytesOf } from "./three-utils";

/**
 * Which terrain levels hold which rasters, so the tile cache weighs each a
 * share. The two levels of a tile name the same class raster, splat, NDVI,
 * sports grounds and light (shared-rasters.ts); counted whole by both, a
 * phone's cache was full at a fraction of what the GPU held.
 */
export class RasterShares {
  private readonly holders = new Map<Texture, Set<object>>();

  /** `holder` takes up `rasters`; returns the other holders whose share
   *  of one of them changed (to reweigh). */
  hold(holder: object, rasters: readonly Texture[]): object[] {
    return this.change(holder, rasters, true);
  }

  /** `holder` lets go of `rasters`; returns the other holders whose share
   *  of one of them changed (to reweigh). */
  release(holder: object, rasters: readonly Texture[]): object[] {
    return this.change(holder, rasters, false);
  }

  /** Σ each raster's tracked bytes over the number of its holders. */
  bytesOf(rasters: readonly Texture[]): number {
    let bytes = 0;
    for (const texture of rasters) {
      const holders = this.holders.get(texture)?.size ?? 1;
      bytes += trackedBytesOf(texture) / Math.max(holders, 1);
    }
    return bytes;
  }

  private change(
    holder: object,
    rasters: readonly Texture[],
    hold: boolean
  ): object[] {
    const others = new Set<object>();
    for (const texture of rasters) {
      let holders = this.holders.get(texture);
      if (!holders) {
        holders = new Set();
        this.holders.set(texture, holders);
      }
      if (hold) {
        holders.add(holder);
      } else {
        holders.delete(holder);
      }
      for (const other of holders) {
        if (other !== holder) {
          others.add(other);
        }
      }
      if (holders.size === 0) {
        this.holders.delete(texture);
      }
    }
    return [...others];
  }
}
