/**
 * Dev/test-only debug hook consumed by the Playwright specs (e2e/) and manual
 * QA. NEXT_PUBLIC_POC_DEBUG is inlined at build time, so regular production
 * builds ship `enabled === false` and never touch `window` — the hook cannot
 * leak into production.
 *
 * It publishes the objects the HUD itself drives — the scene handle and the
 * look store — rather than a hand-copied mirror of their members: a member
 * added to either is available to the specs without an edit here, and
 * nothing can be left out of a registration list.
 */

import type { LookState } from "@/lib/city/look-state";
import type { CityWalkHandle, CityWalkStats } from "./create-app";

export interface PocDebugInfo {
  /**
   * True once the spawn tile is on screen and `handle` exists; `ready`
   * follows when every layer has streamed in (neighbours, vegetation, rails).
   */
  firstFrame: boolean;
  /** Rendered-frame counter; e2e waits on it instead of sleeping. */
  frames: number;
  /** The booted scene's handle — the object the HUD calls; set at the first frame. */
  handle?: CityWalkHandle;
  /** The HUD's look store: `look.set(...)` is exactly what a slider does. */
  look?: LookState;
  ready: boolean;
  /**
   * True while the camera is moving and the post stack is running reduced
   * (AO + DoF skipped) — see lib/city/regression.ts.
   */
  regressed?: boolean;
  /** Frames on which the sun's shadow map was redrawn; e2e asserts it stays far below `frames` while walking. */
  shadowRenders: number;
  /** The last stats emit: building count, per-layer census, GPU estimate. */
  stats?: CityWalkStats;
}

declare global {
  interface Window {
    __poc?: PocDebugInfo;
  }
}

const enabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_POC_DEBUG === "1";

export function updatePocDebug(patch: Partial<PocDebugInfo>): void {
  if (!enabled) {
    return;
  }
  window.__poc = {
    firstFrame: false,
    ready: false,
    frames: 0,
    shadowRenders: 0,
    ...window.__poc,
    ...patch,
  };
}

/** Called once per rendered frame from the animation loop. */
export function tickPocFrame(shadowRendered: boolean): void {
  if (!enabled) {
    return;
  }
  const poc = window.__poc;
  if (poc) {
    poc.frames += 1;
    if (shadowRendered) {
      poc.shadowRenders += 1;
    }
  }
}
