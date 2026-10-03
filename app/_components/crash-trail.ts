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

/** Starts this page's record; the listeners go with `end`. */
export function startCrashTrail(): CrashTrail {
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
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", onPageHide);
      removeEventListener("pageshow", onPageShow);
    },
  };
}
