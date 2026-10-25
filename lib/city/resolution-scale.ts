/**
 * The render's resolution as the frame rate allows: a fill-bound page — the
 * post stack, the shadow map and the ground's fragment pass cost by the
 * pixel — draws fewer pixels while it cannot keep its frame rate, and the
 * browser scales the canvas up to its CSS size (the HUD stays sharp). The
 * scale moves in a few steps, each held for seconds, because a step
 * reallocates every screen-sized target of the post stack.
 *
 * - **Down** a step when the median frame over a window is slower than the
 *   tier's floor rate for two windows running — but only while the main
 *   thread is not what holds it up (its frame takes less than 60 % of the
 *   interval): fewer pixels do not speed up JavaScript.
 *   A step down that did not make the frames faster goes back, and none is
 *   tried for a while: that frame rate is capped by the browser, not drawn
 *   by the GPU.
 * - **Up** a step, never sooner than 4 s after a step down and only while
 *   the frame rate holds, where the GPU's own time (timestamp queries) says
 *   the finer step fits with room to spare for two windows; where there is
 *   none (Safari), a tentative step up after a calm stretch, which waits
 *   twice as long each time it had to come back down (up to two minutes)
 *   and is short again once a step up held.
 * - A still scene (drawn at the still pace) steps up by the GPU's time
 *   alone, and without it holds its step.
 * - The window after a change is not judged (its frames and GPU times are
 *   the old step's).
 *
 * Medians, so a compile's or a tile's one long frame does not move it. No
 * THREE, no DOM.
 */

/** The scale steps (× the tier's pixel ratio), finest first. */
export const SCALE_STEPS = [1, 0.85, 0.72, 0.6] as const;

/** A window's length (ms): the medians are taken over it. */
export const WINDOW_MS = 1000;
/** Slow windows in a row before a step down. */
const SLOW_WINDOWS = 2;
/** Windows in a row the GPU's time must say a finer step fits. */
const FIT_WINDOWS = 2;
/** No step up for this long after a step down (ms). */
const HOLD_MS = 4 * WINDOW_MS;
/** The calm wait before a tentative step up (ms), and its cap. */
const PROBE_WAIT_MS = 8000;
const PROBE_WAIT_MAX_MS = 120_000;
/**
 * A step down that did not speed the frames up by a tenth goes back, and no
 * step down is tried for this long (ms), twice as long each time, to its cap:
 * a frame rate the browser or the display caps (an iPhone's Low Power Mode,
 * 30 fps) is not the GPU's.
 */
const NO_GAIN_WAIT_MS = 30_000;
const NO_GAIN_WAIT_MAX_MS = 300_000;
/** A window needs this many frames to count (a hidden page has none). */
const MIN_FRAMES = 3;

export interface ResolutionTargets {
  /** the frame rate below which a window is slow (fps) */
  floorFps: number;
  /** the coarsest step the tier may take (an index into SCALE_STEPS) */
  maxStep: number;
}

/** A desktop holds 50 fps, a phone 40 — and a phone keeps more pixels. */
export function resolutionTargetsFor(
  tier: "desktop" | "mobile"
): ResolutionTargets {
  return tier === "mobile"
    ? { floorFps: 40, maxStep: 2 }
    : { floorFps: 50, maxStep: 3 };
}

export interface ResolutionScale {
  /** a drawn frame: the interval since the frame before, its main-thread time (ms) */
  frame: (intervalMs: number, cpuMs: number) => void;
  /** a GPU time read back for one frame (ms) */
  gpu: (ms: number) => void;
  /**
   * At `now` (ms): the new scale when the step changes, else undefined.
   * Called every frame; it decides once per WINDOW_MS. `still`: the scene
   * stands still at the still pace (lib/city/frame-pace.ts), whose frame
   * rate is not the GPU's — then only the GPU's own time may step up.
   */
  update: (now: number, still?: boolean) => number | undefined;
  /** forget the window so far (frames that are not the scene's: an export) */
  reset: () => void;
  /** the scale now */
  scale: () => number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function createResolutionScale(
  targets: ResolutionTargets
): ResolutionScale {
  const floorMs = 1000 / targets.floorFps;
  let step = 0;
  let windowStart: number | undefined;
  const intervals: number[] = [];
  const cpus: number[] = [];
  const gpus: number[] = [];
  let slow = 0;
  let fits = 0;
  let calmSince: number | undefined;
  let probeWait = PROBE_WAIT_MS;
  // a step up tried without the GPU's word: a slow window soon after it
  // proves it did not fit
  let probedAt: number | undefined;
  // the last step down: when, and the median frame before it
  let downAt = Number.NEGATIVE_INFINITY;
  let downFrom: number | undefined;
  let noGainWait = NO_GAIN_WAIT_MS;
  let downBlockedUntil = Number.NEGATIVE_INFINITY;
  // the window after a change is not judged: its first frames (and a GPU
  // time still in flight) are the old step's
  let settling = false;

  const change = (to: number): number => {
    step = to;
    slow = 0;
    fits = 0;
    calmSince = undefined;
    settling = true;
    return SCALE_STEPS[step];
  };

  /** The first judged window after a step down: did it help? */
  const judgeGain = (now: number, interval: number): number | undefined => {
    const before = downFrom;
    downFrom = undefined;
    if (before === undefined || interval < before * 0.9) {
      noGainWait = NO_GAIN_WAIT_MS;
      return undefined;
    }
    downBlockedUntil = now + noGainWait;
    noGainWait = Math.min(noGainWait * 2, NO_GAIN_WAIT_MAX_MS);
    return change(step - 1);
  };

  const stepDown = (now: number, interval: number): number | undefined => {
    calmSince = undefined;
    fits = 0;
    slow++;
    if (
      slow < SLOW_WINDOWS ||
      step >= targets.maxStep ||
      now < downBlockedUntil
    ) {
      return undefined;
    }
    if (probedAt !== undefined && now - probedAt < 4 * WINDOW_MS) {
      probeWait = Math.min(probeWait * 2, PROBE_WAIT_MAX_MS);
    }
    probedAt = undefined;
    downAt = now;
    downFrom = interval;
    return change(step + 1);
  };

  const stepUp = (now: number, gpu: number | undefined) => {
    if (probedAt !== undefined && now - probedAt >= 4 * WINDOW_MS) {
      // the last probe held: the next may come sooner again
      probedAt = undefined;
      probeWait = PROBE_WAIT_MS;
    }
    if (step === 0 || now - downAt < HOLD_MS) {
      return undefined;
    }
    // the finer step's pixels, against this one's
    const growth = (SCALE_STEPS[step - 1] / SCALE_STEPS[step]) ** 2;
    if (gpu !== undefined) {
      fits = gpu * growth < floorMs * 0.75 ? fits + 1 : 0;
      return fits >= FIT_WINDOWS ? change(step - 1) : undefined;
    }
    calmSince ??= now;
    if (now - calmSince < probeWait) {
      return undefined;
    }
    probedAt = now;
    return change(step - 1);
  };

  const decideStill = (now: number): number | undefined => {
    slow = 0;
    calmSince = undefined;
    if (settling) {
      settling = false;
      return undefined;
    }
    return gpus.length > 0 ? stepUp(now, median(gpus)) : undefined;
  };

  const decide = (now: number): number | undefined => {
    if (intervals.length < MIN_FRAMES) {
      slow = 0;
      fits = 0;
      calmSince = undefined;
      return undefined;
    }
    if (settling) {
      settling = false;
      return undefined;
    }
    const interval = median(intervals);
    if (downFrom !== undefined) {
      const back = judgeGain(now, interval);
      if (back !== undefined) {
        return back;
      }
    }
    const gpuBound = median(cpus) < interval * 0.6;
    if (interval > floorMs) {
      // slow: fewer pixels where the GPU holds it up; never more pixels
      if (gpuBound) {
        return stepDown(now, interval);
      }
      slow = 0;
      fits = 0;
      calmSince = undefined;
      return undefined;
    }
    slow = 0;
    return stepUp(now, gpus.length > 0 ? median(gpus) : undefined);
  };

  const clear = () => {
    intervals.length = 0;
    cpus.length = 0;
    gpus.length = 0;
  };

  return {
    frame: (intervalMs, cpuMs) => {
      intervals.push(intervalMs);
      cpus.push(cpuMs);
    },
    gpu: (ms) => {
      if (Number.isFinite(ms) && ms > 0) {
        gpus.push(ms);
      }
    },
    update: (now, still = false) => {
      windowStart ??= now;
      if (now - windowStart < WINDOW_MS) {
        return undefined;
      }
      windowStart = now;
      const changed = still ? decideStill(now) : decide(now);
      clear();
      return changed;
    },
    reset: () => {
      clear();
      windowStart = undefined;
    },
    scale: () => SCALE_STEPS[step],
  };
}
