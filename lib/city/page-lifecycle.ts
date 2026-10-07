/**
 * The page's GPU-loss, memory-emergency and resume decisions (ADR 0046) as
 * a pure machine, like boot-phases.ts: the page hears signals — a device
 * lost, a frame that threw, an allocation that failed, the page hidden or
 * shown, the first frame, the end — and the machine answers with the
 * effects to carry out, in order. create-app.ts binds the signals to the
 * renderer, the stream and the page and executes the effects; the
 * clocks and the page's visibility arrive as signal fields. No THREE, no
 * DOM.
 *
 * The effects' order is the crash trail's order (the `note` effects),
 * which the reports read: "render stopped" goes on the trail first — what
 * the page notes after it is the aftermath (cancelled fetches, the
 * device's last word). A page that does not reload notes "gpu failed"
 * last: the failure card (or the failed boot) is reported once — after a
 * reclaim, which reports nothing of its own, it is the only word there is
 * (crash-reports.ts).
 */
import {
  frameLoss,
  type GpuLoss,
  RESUME_AWAY_MS,
  RESUME_WINDOW_MS,
} from "./gpu-safety";

/**
 * What the page hears. `now` is the monotonic clock (ms); `wall` the wall
 * clock (ms) — iOS stops the monotonic one while the device sleeps, and an
 * hour with the phone locked would read as a glance away, so the time away
 * is measured on the wall. `hidden` is the page's visibility at the
 * signal.
 */
export type LifecycleSignal =
  | { kind: "deviceLost"; message: string; now: number; hidden: boolean }
  | {
      kind: "frameFailed";
      message: string;
      /** the error's first stack lines, for the trail */
      where: string;
      /** the error is the GPU failing to give memory (gpu-allocation.ts) */
      allocation: boolean;
      /** whether the GPU still takes work — asked only when the other
       *  signs do not decide (frameLoss) */
      gpuAnswers: () => boolean;
      now: number;
      hidden: boolean;
    }
  | { kind: "allocationFailed"; reason: string; now: number; hidden: boolean }
  | { kind: "hidden"; wall: number; phone: boolean }
  | {
      kind: "shown";
      wall: number;
      now: number;
      /** the GPU probe's failure, or null — asked only on a live page */
      gpuFailure: () => string | null;
    }
  | { kind: "firstFrame" }
  | { kind: "dispose" };

/** What the page then does, in order. */
export type LifecycleEffect =
  | { kind: "note"; event: string; detail?: string }
  | { kind: "stopRender" }
  | { kind: "reload"; how: GpuLoss }
  | { kind: "fatal"; message: string; beforeFirstFrame: boolean }
  | { kind: "shed" }
  | { kind: "governorForce"; now: number }
  | { kind: "applyStep" }
  | { kind: "holdShadows"; untilNow: number }
  | { kind: "raiseSafety" };

export interface LifecycleOptions {
  /** allocation failures closer together than this are one emergency */
  emergencyGapMs: number;
  /** how long an emergency keeps the shadow camera from streaming */
  shadowHoldMs: number;
  /**
   * Whether the page reloads to recover this loss (gpu-recovery's answer,
   * create-app's `onGpuLost`): asked once per stop, and only on a page not
   * disposed. One that throws (the recovery's capture failed) is no reload:
   * noted as "recovery failed", and the page says the GPU failed — the
   * throw never escapes `dispatch`, so the render stops all the same.
   */
  mayReload: (how: GpuLoss) => boolean;
  /** the wall clock's time the page was hidden at, if it starts hidden */
  hiddenAt?: number | null;
}

export interface PageLifecycle {
  dispatch(signal: LifecycleSignal): LifecycleEffect[];
  /** the render stopped (once, for good) */
  readonly stopped: boolean;
  /** how a GPU that fails now went: in the background, or in use */
  lossNow(now: number, hidden: boolean): GpuLoss;
  /** the page had a memory emergency (frameLoss's sign) */
  readonly emergencyBefore: boolean;
}

interface State {
  stopped: boolean;
  disposed: boolean;
  firstFrameShown: boolean;
  /** when the page came back after RESUME_AWAY_MS or more hidden */
  resumedAt: number;
  lastEmergency: number;
  emergencyRaised: boolean;
  hiddenAt: number | null;
}

function lossAt(state: State, now: number, hidden: boolean): GpuLoss {
  return hidden || now - state.resumedAt < RESUME_WINDOW_MS
    ? "reclaimed"
    : "lost";
}

/** `mayReload`'s answer; a throw is a no, noted after the stop. */
function askReload(
  opts: LifecycleOptions,
  how: GpuLoss,
  effects: LifecycleEffect[]
): boolean {
  try {
    return opts.mayReload(how);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    effects.push({ kind: "note", event: "recovery failed", detail });
    return false;
  }
}

/**
 * The render cannot go on: stop once, then recover (a reload where the
 * player stood, gpu-recovery.ts) or say so — before the first frame by
 * failing the boot, since the HUD shows the fatal word only once booted
 * and the stopped loop no longer streams the tiles the boot waits for.
 */
function stopSequence(
  state: State,
  opts: LifecycleOptions,
  message: string,
  how: GpuLoss,
  detail: string
): LifecycleEffect[] {
  if (state.stopped) {
    return [];
  }
  state.stopped = true;
  const effects: LifecycleEffect[] = [
    { kind: "stopRender" },
    { kind: "note", event: "render stopped", detail: message },
  ];
  if (how === "reclaimed") {
    // iOS took the GPU of a page in the background: no failure of the
    // page's own, and no reason for a lighter one (gpu-safety.ts).
    effects.push({ kind: "note", event: "gpu reclaimed", detail });
  }
  if (state.disposed) {
    return effects;
  }
  if (askReload(opts, how, effects)) {
    effects.push(
      {
        kind: "note",
        event: "reloading",
        detail: `to recover the GPU (${how})`,
      },
      { kind: "reload", how }
    );
    return effects;
  }
  effects.push(
    { kind: "note", event: "gpu failed", detail: `${how}: ${message}` },
    { kind: "fatal", message, beforeFirstFrame: !state.firstFrameShown }
  );
  return effects;
}

/**
 * A frame that threw stops the render. Soon after a long absence it is the
 * GPU iOS reclaimed meanwhile: noted as that, not as a failed frame. In use
 * it is a loss only with a sign of the GPU running out — an allocation
 * error, a memory emergency before it, a GPU that no longer takes work —
 * and otherwise a bug ("failed"): a reload at the same level, never a
 * lighter device for days.
 */
function frameFailed(
  state: State,
  opts: LifecycleOptions,
  signal: Extract<LifecycleSignal, { kind: "frameFailed" }>
): LifecycleEffect[] {
  // A frame after the stop (one already queued, a loop another error
  // could not stop) is the stop's aftermath, not a failure of its own.
  if (state.stopped) {
    return [];
  }
  const how = frameLoss(lossAt(state, signal.now, signal.hidden), {
    allocation: signal.allocation,
    emergency: state.lastEmergency !== Number.NEGATIVE_INFINITY,
    answers: signal.gpuAnswers,
  });
  const detail = `${signal.message} ${signal.where}`;
  const effects: LifecycleEffect[] =
    how === "reclaimed"
      ? []
      : [{ kind: "note", event: "frame failed", detail }];
  return [
    ...effects,
    ...stopSequence(state, opts, signal.message, how, detail),
  ];
}

/**
 * The GPU ran out of memory: shed at once what can go, before a frame's
 * own allocation fails and the render stops — every tile not in use, the
 * governor to its last step, the shadow camera's tiles for a while — and
 * make the next page a safety level lighter (gpu-safety.ts), once per page
 * and per incident: the raise names this page, so the loss it foretold
 * renews it rather than adding one. Not for a GPU iOS reclaimed (hidden,
 * or just back after a long absence): an allocation refused there is the
 * reclaim's symptom. WebKit reports every allocation that failed: one
 * emergency covers a burst.
 */
function emergency(
  state: State,
  opts: LifecycleOptions,
  signal: Extract<LifecycleSignal, { kind: "allocationFailed" }>
): LifecycleEffect[] {
  const { now } = signal;
  if (
    state.disposed ||
    state.stopped ||
    now - state.lastEmergency < opts.emergencyGapMs
  ) {
    return [];
  }
  state.lastEmergency = now;
  const effects: LifecycleEffect[] = [
    { kind: "note", event: "memory emergency", detail: signal.reason },
    { kind: "governorForce", now },
    { kind: "shed" },
    { kind: "applyStep" },
    { kind: "holdShadows", untilNow: now + opts.shadowHoldMs },
  ];
  if (!state.emergencyRaised && lossAt(state, now, signal.hidden) === "lost") {
    state.emergencyRaised = true;
    effects.push({ kind: "raiseSafety" });
  }
  return effects;
}

/**
 * The resume guard. iOS takes the GPU of a page in the background, and
 * what the page holds counts against it there: hidden, a phone's page lets
 * go of every tile not in use (a desktop keeps its cache: a tab switch is
 * no threat there); shown again, it gets its cache back and probes the GPU
 * before the next frame draws — a GPU gone meanwhile is a reclaim, not a
 * failure of the page's.
 */
function visibility(
  state: State,
  opts: LifecycleOptions,
  signal: Extract<LifecycleSignal, { kind: "hidden" | "shown" }>
): LifecycleEffect[] {
  if (state.disposed || state.stopped) {
    return [];
  }
  if (signal.kind === "hidden") {
    state.hiddenAt = signal.wall;
    return signal.phone ? [{ kind: "shed" }, { kind: "applyStep" }] : [];
  }
  const away = state.hiddenAt === null ? 0 : signal.wall - state.hiddenAt;
  state.hiddenAt = null;
  const effects: LifecycleEffect[] = [{ kind: "applyStep" }];
  if (away >= RESUME_AWAY_MS) {
    state.resumedAt = signal.now;
  }
  const failure = signal.gpuFailure();
  if (failure !== null) {
    effects.push(...stopSequence(state, opts, failure, "reclaimed", failure));
  }
  return effects;
}

export function createPageLifecycle(opts: LifecycleOptions): PageLifecycle {
  const state: State = {
    stopped: false,
    disposed: false,
    firstFrameShown: false,
    resumedAt: Number.NEGATIVE_INFINITY,
    lastEmergency: Number.NEGATIVE_INFINITY,
    emergencyRaised: false,
    hiddenAt: opts.hiddenAt ?? null,
  };
  const dispatch = (signal: LifecycleSignal): LifecycleEffect[] => {
    switch (signal.kind) {
      case "deviceLost": {
        const how = lossAt(state, signal.now, signal.hidden);
        return stopSequence(state, opts, signal.message, how, signal.message);
      }
      case "frameFailed":
        return frameFailed(state, opts, signal);
      case "allocationFailed":
        return emergency(state, opts, signal);
      case "hidden":
      case "shown":
        return visibility(state, opts, signal);
      case "firstFrame":
        state.firstFrameShown = true;
        return [];
      case "dispose":
        state.disposed = true;
        return [];
      default: {
        const never: never = signal;
        return never;
      }
    }
  };
  return {
    dispatch,
    get stopped() {
      return state.stopped;
    },
    lossNow: (now, hidden) => lossAt(state, now, hidden),
    get emergencyBefore() {
      return state.lastEmergency !== Number.NEGATIVE_INFINITY;
    },
  };
}
