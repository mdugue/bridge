import {
  createUsableClock,
  type RetryEnv,
  type RetryNote,
  type UsableClock,
} from "@/lib/city/fetch-retry";

/**
 * Whether the page can use the network now: visible (a hidden page's
 * requests are what iOS cancels and starves first) and not offline — the
 * page's one view of it, for every retry (lib/city/fetch-retry.ts) and for
 * the tile healer (tile-retry.ts). Its listeners are the page's, installed
 * once on first use and never removed: they outlive every app on the page.
 *
 * `pageLeaving()` holds from pagehide — a navigation, a reload (the GPU
 * recovery's too) or the bfcache — until the page comes back from the
 * bfcache: the loads a leaving page loses are its own doing, and nothing
 * about them is decided or reported.
 */

/** A visible page that the browser calls offline still tries now and then:
 *  navigator.onLine is a hint (a missed "online" event would strand it). */
const OFFLINE_PROBE_MS = 15_000;

let installed = false;
let leavingNow = false;
let clock: UsableClock | null = null;
const wakers = new Set<() => void>();
const retryWatchers = new Set<(note: RetryNote) => void>();

/** The page is not hidden (a hidden page's frames — and so its streaming —
 *  stop). */
export function pageVisible(): boolean {
  // (read off globalThis: outside a browser — a unit test — there is no
  // `document` to name)
  const doc = globalThis.document as Document | undefined;
  return doc?.visibilityState !== "hidden";
}

function isOnline(): boolean {
  const nav = globalThis.navigator as Navigator | undefined;
  return nav?.onLine !== false;
}

/** Visible and not offline: a request now can succeed. */
export function pageUsable(): boolean {
  return pageVisible() && isOnline();
}

function changed(): void {
  const usable = pageUsable();
  clock?.set(usable, performance.now());
  if (usable) {
    // (each waker deletes itself: a Set iterates on safely)
    for (const wake of wakers) {
      wake();
    }
  }
}

function install(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  clock = createUsableClock(pageUsable(), performance.now());
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("pagehide", () => {
    leavingNow = true;
    changed();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      leavingNow = false;
    }
    changed();
  });
}

/** The page is on its way out (pagehide, not yet back from the bfcache). */
export function pageLeaving(): boolean {
  install();
  return leavingNow;
}

/** How long the page has been usable since it loaded (ms). */
export function usableMs(): number {
  install();
  return clock ? clock.usableMs(performance.now()) : performance.now();
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Resolves once the page is usable — on "online", "visibilitychange" or
 * "pageshow", or, while it is visible but offline, every
 * OFFLINE_PROBE_MS — and rejects with an AbortError when `signal` aborts.
 */
export function whenUsable(signal?: AbortSignal): Promise<void> {
  install();
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  if (pageUsable()) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let probe: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      wakers.delete(wake);
      signal?.removeEventListener("abort", abort);
      clearTimeout(probe);
    };
    const wake = () => {
      done();
      resolve();
    };
    const abort = () => {
      done();
      reject(abortError());
    };
    const arm = () => {
      probe = setTimeout(
        () => (pageVisible() ? wake() : arm()),
        OFFLINE_PROBE_MS
      );
    };
    wakers.add(wake);
    signal?.addEventListener("abort", abort, { once: true });
    arm();
  });
}

/** Waits `ms`; rejects with an AbortError when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** The page's state in a give-up's message and a load-error's detail. */
export function describeNet(): string {
  const vis = typeof document === "undefined" ? "?" : document.visibilityState;
  return `online=${String(isOnline())} vis=${vis}`;
}

/** The retries' page: the real one. */
export const PAGE_RETRY_ENV: RetryEnv = {
  whenUsable,
  sleep,
  usableMs,
  now: () => Date.now(),
  random: () => Math.random(),
  describe: describeNet,
};

/** Every retry on the page, as it waits (the crash trail's "net-retry"). */
export function watchRetries(watcher: (note: RetryNote) => void): () => void {
  retryWatchers.add(watcher);
  return () => {
    retryWatchers.delete(watcher);
  };
}

/** Tells the watchers about one retry. */
export function reportRetry(note: RetryNote): void {
  for (const watcher of retryWatchers) {
    watcher(note);
  }
}

/**
 * `listener` on every moment the page may have its network back
 * ("online", visible again, "pageshow") while it is visible — whatever
 * navigator.onLine says, which is a hint; returns its removal.
 */
export function onUsableAgain(listener: () => void): () => void {
  install();
  const wake = () => {
    if (pageVisible()) {
      listener();
    }
  };
  if (typeof window === "undefined") {
    return () => undefined;
  }
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pageshow", wake);
  return () => {
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("pageshow", wake);
  };
}
