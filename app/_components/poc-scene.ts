/**
 * The scene's half of the dev/test debug hook (poc-debug.ts is the page's
 * `window.__poc`): what the render loop counts — frames drawn, shadow-map
 * redraws, whether the post stack runs reduced — and the probes the specs
 * set on it — hold the loop, step it, fix its clock, let no time pass in
 * what animates, pin the loading veil. The scene may run in a worker (ADR 0061), which has no `window`:
 * the counters reach the page with the scene's mirror (scene-server.ts),
 * the probes come back from it as a command. NEXT_PUBLIC_POC_DEBUG is
 * inlined at build time, so a production build never counts or probes.
 */

import { time as nodeTime } from "three/tsl";
import type { VeilState } from "@/lib/city/load-frontier";

/** What the specs set on the scene (poc-debug.ts `PocDebugInfo`). */
export interface PocProbe {
  /** the render loop skips its frames while it is set */
  hold?: boolean;
  /** while held, the loop still draws this many frames, counting down */
  step?: number;
  /** the scene's clock advances by exactly this many ms per drawn frame */
  frameMs?: number;
  /**
   * no time passes in what animates: the scene's phase clock (water,
   * crowns, flags, fountains, the lamps' reflections, the data layers'
   * hook) and three's TSL `time` (the clouds, the film grain, Sin City's
   * rain) read `STILL_PHASE_S`, while the loop's own clock runs on, so
   * that what settles by it (the lens, the exposure, the eye onto the
   * ground) still does. Two renders of one commit are then one picture
   * (plan 087, the compared plates).
   */
  still?: boolean;
  /** the loading veil draws this ring instead of the stream's */
  veil?: Pick<VeilState, "radius" | "strength">;
}

/** The phase every animation reads while a probe holds the scene `still`
 *  (s): any instant would do, as long as it is the same one. */
export const STILL_PHASE_S = 0;

/** What the scene counts for the specs. */
export interface PocCounts {
  frames: number;
  shadowRenders: number;
  regressed?: boolean;
  /** frames still to step while held (counted down as they draw) */
  step?: number;
}

export const pocEnabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_POC_DEBUG === "1";

const probe: PocProbe = {};
const counts: PocCounts = { frames: 0, shadowRenders: 0 };

/** The specs' probes, as the page last set them. */
export function setPocProbe(next: PocProbe): void {
  if (pocEnabled) {
    Object.assign(probe, next);
    // only a step asked now: the scene counts it down as it draws
    if ("step" in next) {
      counts.step = next.step;
    }
    if ((probe.still === true) !== nodeTimeHeld) {
      nodeTimeHeld = probe.still === true;
      holdNodeTime(nodeTimeHeld);
    }
  }
}

/**
 * three's TSL `time` held at the still phase, or back on the renderer's
 * clock: the node is one shared uniform whose update is public
 * (`onRenderUpdate`), so the sky's clouds, the grain and the rain need no
 * edit. Only ever called from a probe, so never in a production build.
 */
let nodeTimeHeld = false;
function holdNodeTime(still: boolean): void {
  nodeTime.onRenderUpdate((frame) =>
    still ? STILL_PHASE_S : (frame.time ?? 0)
  );
}

/** The phase the scene's animations read: the loop's elapsed time, or a
 *  probe's still instant. Never anything but `elapsed` in a production
 *  build. */
export function pocPhase(elapsed: number): number {
  return pocEnabled && probe.still === true ? STILL_PHASE_S : elapsed;
}

/** What the scene counted, for the page's mirror; null in production. */
export function pocCounts(): PocCounts | null {
  return pocEnabled ? { ...counts } : null;
}

/** The post stack runs reduced (lib/city/regression.ts), or not. */
export function notePocRegressed(regressed: boolean): void {
  if (pocEnabled) {
    counts.regressed = regressed;
  }
}

/** True while the specs hold the render loop (`hold`); never in a
 *  production build. */
export function pocFramesHeld(): boolean {
  if (!pocEnabled || probe.hold !== true) {
    return false;
  }
  // counted down by the frames drawn (`tickPocFrame`), not the ones
  // asked for: the pace may skip one
  return (probe.step ?? 0) <= 0;
}

/** The probe's loading veil (`veil`), if one is set; never in a
 *  production build. */
export function pocVeil(): PocProbe["veil"] {
  return pocEnabled ? probe.veil : undefined;
}

let virtualMs: number | null = null;
/** how far the probe's clock has drifted from the wall clock: kept after
 *  `frameMs` is cleared, so the clock never runs backwards */
let offsetMs = 0;

/** The time the frame's clock reads: the wall clock's, or a probe's fixed
 *  step (`frameMs`). Never anything but `time` in a production build. */
export function pocFrameTime(time: number): number {
  const frameMs = pocEnabled ? probe.frameMs : undefined;
  if (frameMs === undefined) {
    virtualMs = null;
    return time + offsetMs;
  }
  virtualMs = virtualMs === null ? time + offsetMs : virtualMs + frameMs;
  offsetMs = virtualMs - time;
  return virtualMs;
}

/** Called once per rendered frame from the animation loop. */
export function tickPocFrame(shadowRendered: boolean): void {
  if (!pocEnabled) {
    return;
  }
  counts.frames += 1;
  if ((probe.step ?? 0) > 0) {
    probe.step = (probe.step ?? 0) - 1;
    counts.step = probe.step;
  }
  if (shadowRendered) {
    counts.shadowRenders += 1;
  }
}
