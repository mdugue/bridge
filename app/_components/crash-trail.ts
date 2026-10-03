import {
  createTrail,
  endedInCrash,
  formatBeat,
  formatEvent,
  formatTrail,
  parseTrail,
  pushBeat,
  pushEvent,
  type Trail,
  type TrailBeat,
  type TrailEvent,
} from "@/lib/city/crash-trail";

/**
 * The crash trail's browser side (the core and why it exists:
 * lib/city/crash-trail.ts). One record per page: started before the
 * renderer exists, written through to local storage on every event and
 * heartbeat, marked clean when the page leaves normally. The record of the
 * previous page is moved aside once per page load, before the new one
 * overwrites it, so the HUD can offer it. Storage can be missing or throw
 * (private mode, a full quota); then there is simply no trail.
 *
 * It also speaks to the console, for reading it from a computer (Safari's
 * Web Inspector on a cabled iPhone): every event as `info`, every
 * heartbeat as `debug`, a crashed previous page in full as `warn` — and
 * `crashTrail.current()` / `crashTrail.previous()` return the report text.
 */

const CURRENT_KEY = "crash-trail";
const TAG = "[crash-trail]";

declare global {
  interface Window {
    /** The reports as text, for the console (see above). */
    crashTrail?: { current: () => string; previous: () => string };
  }
}
const PREVIOUS_KEY = "crash-trail.previous";

let rotated = false;
let announced = false;
/** Moves the last page's record aside, once per page load. */
function rotate(): void {
  if (rotated) {
    return;
  }
  rotated = true;
  try {
    const last = localStorage.getItem(CURRENT_KEY);
    if (last) {
      localStorage.setItem(PREVIOUS_KEY, last);
      localStorage.removeItem(CURRENT_KEY);
    }
  } catch {
    // No storage: no trail.
  }
}

/** The previous page's record, or null. */
export function previousTrail(): Trail | null {
  rotate();
  try {
    return parseTrail(localStorage.getItem(PREVIOUS_KEY));
  } catch {
    return null;
  }
}

/**
 * The previous record may be a page still open in another tab: every tab
 * writes the one record key, so a second viewer moves the first one's live
 * record aside as if that page had gone. Each page therefore answers for
 * its own record on a channel, and the next page asks before it treats a
 * record as ended — a page that answers is not a crash.
 */
const CHANNEL = "crash-trail";
interface LivenessMessage {
  ask?: string;
  open?: string;
}

/**
 * Answers for the record that started at `startedAt` while the page lives;
 * a page going into the back-forward cache closes its channel (an open one
 * may keep a page out of that cache) and opens it again when restored.
 * Returns the stop.
 */
function answerFor(startedAt: string): () => void {
  if (typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  let channel: BroadcastChannel | null = null;
  const open = () => {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as LivenessMessage | null)?.ask === startedAt) {
        channel?.postMessage({ open: startedAt } satisfies LivenessMessage);
      }
    };
  };
  const close = () => {
    channel?.close();
    channel = null;
  };
  const onShow = (event: PageTransitionEvent) => {
    if (event.persisted && !channel) {
      open();
    }
  };
  open();
  addEventListener("pagehide", close);
  addEventListener("pageshow", onShow);
  return () => {
    close();
    removeEventListener("pagehide", close);
    removeEventListener("pageshow", onShow);
  };
}

/**
 * Whether the page that wrote `trail` is still open (it answers within
 * `waitMs`); false where no page can answer (no channel in this browser).
 */
export function pageStillOpen(trail: Trail, waitMs = 250): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL);
    const done = (open: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(open);
    };
    const timer = setTimeout(() => done(false), waitMs);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as LivenessMessage | null)?.open === trail.startedAt) {
        done(true);
      }
    };
    channel.postMessage({ ask: trail.startedAt } satisfies LivenessMessage);
  });
}

/** Forgets the previous page's record (the HUD's card was dismissed). */
export function dismissPreviousTrail(): void {
  try {
    localStorage.removeItem(PREVIOUS_KEY);
  } catch {
    // Nothing to forget.
  }
}

export interface CrashTrail {
  /** One event: a boot stage, a style switch, an error, a lost device. */
  note: (kind: string, detail?: string) => void;
  /** One heartbeat (the record adds the time). */
  beat: (beat: Omit<TrailBeat, "t">) => void;
  /** Facts learned after the start (the backend once the renderer is up). */
  set: (patch: Partial<Pick<Trail, "backend" | "pixelRatio">>) => void;
  /** The page leaves normally: the record ends clean. */
  end: () => void;
}

/**
 * Hears every event as it is noted (crash-reports.ts). It runs before the
 * record is written, so what it marks on the trail is kept.
 */
export type TrailListener = (event: TrailEvent, trail: Trail) => void;

/** Starts this page's record; the listeners go with `end`. */
export function startCrashTrail(listener?: TrailListener): CrashTrail {
  rotate();
  const t0 = performance.now();
  const seconds = () => (performance.now() - t0) / 1000;
  const trail = createTrail({
    startedAt: new Date().toISOString(),
    url: location.pathname + location.search,
    userAgent: navigator.userAgent,
    screen: `${screen.width}×${screen.height}@${devicePixelRatio}`,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory,
  });
  const stopAnswering = answerFor(trail.startedAt);
  const write = () => {
    try {
      localStorage.setItem(CURRENT_KEY, JSON.stringify(trail));
    } catch {
      // Full or blocked: the trail stops, the viewer does not.
    }
  };
  const note = (kind: string, detail?: string) => {
    const event = { t: seconds(), kind, detail: detail?.slice(0, 300) };
    pushEvent(trail, event);
    try {
      listener?.(event, trail);
    } catch {
      // A report that fails is no reason to lose the record.
    }
    write();
    console.info(TAG, formatEvent(event));
  };
  const previous = previousTrail();
  // Once per page load (StrictMode mounts the viewer twice in development).
  if (endedInCrash(previous) && !announced) {
    announced = true;
    console.warn(
      `${TAG} the previous page ended unexpectedly:\n${formatTrail(previous)}`
    );
  }
  window.crashTrail = {
    current: () => formatTrail(trail),
    previous: () => {
      const last = previousTrail();
      return last ? formatTrail(last) : "(no previous record)";
    },
  };

  const onError = (event: ErrorEvent) => {
    const error = event.error as unknown;
    const stack =
      error instanceof Error
        ? (error.stack ?? "").split("\n").slice(1, 4).join(" | ")
        : `@${event.filename}:${event.lineno}`;
    note("error", `${event.message} ${stack}`);
  };
  const onRejection = (event: PromiseRejectionEvent) =>
    note(
      "rejection",
      event.reason instanceof Error
        ? event.reason.message
        : String(event.reason)
    );
  // A kill in the background is the system reclaiming the page, not a
  // crash in use: the state says which it was.
  const onVisibility = () => {
    trail.state = document.hidden ? "hidden" : "running";
    note(document.hidden ? "hidden" : "visible");
  };
  const onPageHide = () => {
    trail.state = "clean";
    note("pagehide");
  };
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("pagehide", onPageHide);
  // Back from the bfcache: the page is in use again.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      trail.state = "running";
      note("pageshow");
    }
  };
  addEventListener("pageshow", onPageShow);
  note("start");

  return {
    note,
    beat: (beat) => {
      const entry = { t: seconds(), ...beat };
      pushBeat(trail, entry);
      write();
      console.debug(TAG, formatBeat(entry));
    },
    set: (patch) => {
      Object.assign(trail, patch);
      write();
      console.info(TAG, JSON.stringify(patch));
    },
    end: () => {
      trail.state = "clean";
      note("end");
      stopAnswering();
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", onPageHide);
      removeEventListener("pageshow", onPageShow);
    },
  };
}
