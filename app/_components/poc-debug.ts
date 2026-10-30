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
   * follows when everything in view has streamed in and been dressed
   * (other tiles, vegetation, rails).
   */
  firstFrame: boolean;
  /** Rendered-frame counter; e2e waits on it instead of sleeping. */
  frames: number;
  /** The booted scene's handle — the object the HUD calls; set at the first frame. */
  handle?: CityWalkHandle;
  /**
   * Set by the e2e specs around steps that only touch the HUD: the render
   * loop skips its frames while it is true (`pocFramesHeld`). Under
   * SwiftShader a frame holds the main thread for half a second or more,
   * and every Playwright action waits on animation frames (a click on two),
   * so each click in the sidebar cost seconds.
   */
  hold?: boolean;
  /**
   * While `hold` is set, the render loop still draws this many frames,
   * one per animation frame, counting it down: a probe steps the scene
   * frame by frame (the `flicker-probe` skill).
   */
  step?: number;
  /**
   * When set, the scene's clock advances by exactly this many ms per drawn
   * frame instead of by the wall clock: two frames a probe takes differ by
   * one real frame's animation (sway, ripple, grain), however long
   * SwiftShader took to draw them.
   */
  frameMs?: number;
  /** The HUD's look store: `look.set(...)` is exactly what a slider does. */
  look?: LookState;
  ready: boolean;
  /**
   * True while the camera is moving and the post stack is running reduced
   * (DoF skipped) — see lib/city/regression.ts.
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

/** True while the e2e specs hold the render loop (`hold`); never in a
 *  production build. */
export function pocFramesHeld(): boolean {
  const poc = enabled ? window.__poc : undefined;
  if (poc?.hold !== true) {
    return false;
  }
  // counted down by the frames drawn (`tickPocFrame`), not the ones
  // asked for: the pace may skip one
  return (poc.step ?? 0) <= 0;
}

let virtualMs: number | null = null;

/** The time the frame's clock reads: the wall clock's, or a probe's fixed
 *  step (`frameMs`). Never anything but `time` in a production build. */
export function pocFrameTime(time: number): number {
  const frameMs = enabled ? window.__poc?.frameMs : undefined;
  if (frameMs === undefined) {
    virtualMs = null;
    return time;
  }
  virtualMs = virtualMs === null ? time : virtualMs + frameMs;
  return virtualMs;
}

/** Called once per rendered frame from the animation loop. */
export function tickPocFrame(shadowRendered: boolean): void {
  if (!enabled) {
    return;
  }
  const poc = window.__poc;
  if (poc) {
    poc.frames += 1;
    if ((poc.step ?? 0) > 0) {
      poc.step = (poc.step ?? 0) - 1;
    }
    if (shadowRendered) {
      poc.shadowRenders += 1;
    }
  }
}
