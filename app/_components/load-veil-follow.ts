/** The loading veil's ring, stepped each frame after what is still on its way. */
import {
  BOOT_VEIL,
  NO_VEIL,
  bootFrontier,
  loadFrontier,
  stepVeil,
} from "@/lib/city/load-frontier";
import type { VeilState } from "@/lib/city/load-frontier";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";

export interface LoadVeilFollowContext {
  /** where the stream looks from (scene frame, read each frame) */
  at: { readonly x: number; readonly z: number };
  /** the scene frame's origin in the data's frame */
  offset: { cx: number; cy: number };
  /** every site tile's bounds (data frame), by id */
  tileBounds: ReadonlyMap<string, TerrainBounds>;
  /** the site tiles still on their way */
  pending: () => Iterable<string>;
  /** the boot's last two stages' progress, 0…1 */
  bootProgress: () => number;
  /** a veil the e2e probe asks for instead (never in production) */
  asked: () => Partial<VeilState> | undefined;
  /** the veil the post pass draws, centred on the stream's eye */
  show: (state: VeilState, centreX: number, centreZ: number) => void;
}

/**
 * The loading frontier (lib/city/load-frontier.ts), one owner of the frame
 * loop's (create-app.ts `frame`, the `follow` step): what is still on its
 * way, as a ring around the camera that walks outward as the city fills.
 */
export interface LoadVeilFollow {
  /** one frame's step; an exported image is the city, not its loading,
   *  nor is Modell's drawing */
  step: (dt: number, view: { exporting: boolean; model: boolean }) => void;
  /** the last frame drew it (the frame pacer) */
  shown: () => boolean;
  /** the first load is through: from here the ring follows the tiles
   *  still pending, not the boot's progress */
  bootLoaded: () => void;
}

export function createLoadVeilFollow(
  ctx: LoadVeilFollowContext
): LoadVeilFollow {
  let veil: VeilState = BOOT_VEIL;
  let loaded = false;
  let shown = false;
  return {
    step: (dt, { exporting, model }) => {
      const { at } = ctx;
      // Modell after the boot: no veil, nor any measuring (from Modell's
      // camera the state would come back stale to the walker's view).
      if (model && loaded) {
        veil = NO_VEIL;
        shown = false;
        ctx.show(NO_VEIL, at.x, at.z);
        return;
      }
      // Until the first load is through, the ring walks out with the last
      // two stages' progress instead: the tile underfoot would hold it at
      // the feet until its own details are built, then let it jump. Nor
      // does a moment with nothing in flight mid-boot (between two stages)
      // sweep it out and lift it: only the end of the load does.
      const frontier = loaded
        ? loadFrontier(
            ctx.tileBounds,
            ctx.pending(),
            at.x + ctx.offset.cx,
            ctx.offset.cy - at.z
          )
        : bootFrontier(ctx.bootProgress());
      veil = stepVeil(veil, frontier, dt);
      const asked = exporting || model ? { strength: 0 } : ctx.asked();
      const drawn = asked ? { ...veil, ...asked } : veil;
      shown = drawn.strength > 0;
      ctx.show(drawn, at.x, at.z);
    },
    shown: () => shown,
    bootLoaded: () => {
      loaded = true;
    },
  };
}
