/** The tile stream's detail and cache bound to the GPU memory held. */
import type { SafetyLevel } from "@/lib/city/gpu-safety";
import {
  createMemoryGovernor,
  memoryFloorFor,
  memoryLimitsFor,
} from "@/lib/city/memory-governor";
import type { MemoryStep } from "@/lib/city/memory-governor";

/** How often the memory governor looks at the GPU memory held (ms). */
export const GOVERN_MS = 1000;

/** What of the tile renderer the memory steers. */
export interface GovernedTiles {
  errorTarget: number;
  lruCache: { minBytesSize: number; maxBytesSize: number };
}

export interface TileMemoryContext {
  tiles: GovernedTiles;
  tier: "desktop" | "mobile";
  safety: SafetyLevel;
  /** the bytes the renderer holds now */
  held: () => number;
  /** the page keeps no tile it does not use (a phone's, in the
   *  background): the cache's lower bound is 0 meanwhile, whatever step
   *  the governor takes */
  shedding: () => boolean;
  /** a step was taken: for the crash trail */
  note: (detail: string) => void;
}

/**
 * Coarser tiles in view before the browser takes the GPU away
 * (lib/city/memory-governor.ts), one owner of the scene's (create-app.ts):
 * the stream's error target and its cache's bounds follow what the
 * renderer holds, looked at every `GOVERN_MS`. A page at a raised safety
 * level (lib/city/gpu-safety.ts) has lower lines and starts further down,
 * at its floor — already for the stream's first update. The bounds it
 * found on the stream are the ones it scales.
 */
export interface TileMemory {
  /** bytes the tile cache leaves to something else (a loaded design, ADR
   *  0054): the page holds no more with it than without */
  reserve: (bytes: number) => void;
  /** a memory emergency at `now` (ms): the lowest step at once; `apply`
   *  carries it out */
  force: (now: number) => void;
  /** the stream takes the forced step, or the current one again (the
   *  page was hidden or shown: `shedding` changed) */
  apply: () => void;
  dispose: () => void;
}

export function bindTileMemory(ctx: TileMemoryContext): TileMemory {
  const { tiles } = ctx;
  const governor = createMemoryGovernor(
    memoryLimitsFor(ctx.tier, ctx.safety),
    memoryFloorFor(ctx.tier, ctx.safety)
  );
  const baseError = tiles.errorTarget;
  const baseMin = tiles.lruCache.minBytesSize;
  const baseMax = tiles.lruCache.maxBytesSize;
  let reserved = 0;
  // the governor's forced step, for the `apply` that follows
  let forced: MemoryStep | null = null;
  const applyStep = (step: MemoryStep) => {
    tiles.errorTarget = baseError * step.errorScale;
    tiles.lruCache.minBytesSize = ctx.shedding()
      ? 0
      : Math.max(0, baseMin * step.minScale - reserved);
    tiles.lruCache.maxBytesSize = Math.max(
      tiles.lruCache.minBytesSize,
      baseMax - reserved
    );
  };
  applyStep(governor.step());
  const govern = setInterval(() => {
    const held = ctx.held();
    const step = governor.update(held, performance.now());
    if (!step) {
      return;
    }
    applyStep(step);
    ctx.note(`level ${step.level} at ${Math.round(held / 1_048_576)} MB`);
  }, GOVERN_MS);
  return {
    reserve: (bytes) => {
      reserved = bytes;
      applyStep(governor.step());
    },
    force: (now) => {
      forced = governor.force(3, ctx.held(), now);
    },
    apply: () => {
      applyStep(forced ?? governor.step());
      forced = null;
    },
    dispose: () => clearInterval(govern),
  };
}
