/**
 * The scene's half of the dev/test debug hook (poc-debug.ts is the page's
 * `window.__poc`): what the render loop counts — frames drawn, shadow-map
 * redraws, whether the post stack runs reduced — and the probes the specs
 * set on it — hold the loop, step it, fix its clock, pin the loading
 * veil. The scene may run in a worker (ADR 0061), which has no `window`:
 * the counters reach the page with the scene's mirror (scene-server.ts),
 * the probes come back from it as a command. NEXT_PUBLIC_POC_DEBUG is
 * inlined at build time, so a production build never counts or probes.
 */

import type { VeilState } from "@/lib/city/load-frontier";

/** What the specs set on the scene (poc-debug.ts `PocDebugInfo`). */
export interface PocProbe {
  /** the render loop skips its frames while it is set */
  hold?: boolean;
  /** while held, the loop still draws this many frames, counting down */
  step?: number;
  /** the scene's clock advances by exactly this many ms per drawn frame */
  frameMs?: number;
  /** the loading veil draws this ring instead of the stream's */
  veil?: Pick<VeilState, "radius" | "strength">;
}

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
  }
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
