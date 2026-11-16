/**
 * Dev/test-only debug hook consumed by the Playwright specs (e2e/) and manual
 * QA. NEXT_PUBLIC_POC_DEBUG is inlined at build time, so regular production
 * builds ship `enabled === false` and never touch `window` — the hook cannot
 * leak into production.
 *
 * It publishes the objects the HUD itself drives — the scene handle and the
 * look store — rather than a hand-copied mirror of their members: a member
 * added to either is available to the specs without an edit here, and
 * nothing can be left out of a registration list. What the render loop
 * counts and the probes the specs set on it live with the scene, which may
 * run in a worker (poc-scene.ts, ADR 0061): here they are accessors that
 * read the scene's last mirror and send the probes on.
 */

import type { VeilState } from "@/lib/city/load-frontier";
import type { LookState } from "@/lib/city/look-state";
import type { CityWalkStats } from "./create-app";
import type { PocCounts, PocProbe } from "./poc-scene";
import type { CityWalkHandle } from "./scene-client";

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
  /**
   * When set, the loading veil draws this ring instead of the stream's
   * (load-veil.ts): a snapshot of the loading state at a chosen radius.
   */
  veil?: Pick<VeilState, "radius" | "strength">;
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

/** The booted scene's side of the hook (scene-client.ts). */
export interface PocScene {
  /** what the scene counted, as of its last mirror */
  counts: () => PocCounts | null;
  /** the specs' probes, sent to the scene */
  probe: (probe: PocProbe) => void;
}

let scene: PocScene | null = null;
const probe: PocProbe = {};

/** A count the hook reads from the scene's last mirror. */
const counted = (key: "frames" | "regressed" | "shadowRenders") => ({
  enumerable: true,
  get: () => scene?.counts()?.[key] ?? (key === "regressed" ? undefined : 0),
});

/** A probe the specs set on the hook, sent on to the scene. */
const probed = (key: "frameMs" | "hold" | "veil") => ({
  enumerable: true,
  get: () => probe[key],
  set: (value: unknown) => {
    // reason: each key takes its own member's type from the specs
    (probe as Record<string, unknown>)[key] = value;
    // the key alone: a whole copy would ask its stale step again
    scene?.probe({ [key]: value });
  },
});

/** The hook on the window, made once with its accessors. */
function pocInfo(): PocDebugInfo {
  if (window.__poc) {
    return window.__poc;
  }
  const poc = { firstFrame: false, ready: false } as PocDebugInfo;
  Object.defineProperties(poc, {
    frames: counted("frames"),
    shadowRenders: counted("shadowRenders"),
    regressed: counted("regressed"),
    hold: probed("hold"),
    frameMs: probed("frameMs"),
    veil: probed("veil"),
    step: {
      enumerable: true,
      // the scene counts it down as it draws
      get: () => scene?.counts()?.step ?? probe.step,
      set: (value: number | undefined) => {
        probe.step = value;
        scene?.probe({ step: value });
      },
    },
  });
  window.__poc = poc;
  return poc;
}

export function updatePocDebug(
  patch: Partial<Omit<PocDebugInfo, keyof PocCounts | keyof PocProbe>>
): void {
  if (enabled) {
    Object.assign(pocInfo(), patch);
  }
}

/** The booted scene behind the hook's counters and probes; the probes set
 *  before it booted go to it at once. */
export function connectPocScene(next: PocScene | null): void {
  if (!enabled) {
    return;
  }
  pocInfo();
  scene = next;
  // the boot carried them, a step among them: these are the ones set
  // since, and a step set before would be asked twice
  next?.probe({ hold: probe.hold, frameMs: probe.frameMs, veil: probe.veil });
}
