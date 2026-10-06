import {
  createVisibleClock,
  type RetryEnv,
  type RetryNote,
} from "@/lib/city/fetch-retry";

/**
 * The page's one view of its network, for every retry
 * (lib/city/fetch-retry.ts) and for the tile healer (tile-retry.ts):
 * whether it is visible (a hidden page's requests are what iOS cancels and
 * starves first, and its frames — so its streaming — stop), whether it is
 * usable (visible and not offline: a request now can succeed), and the
 * budgets' clock, which runs while the page is visible, offline or not —
 * a visible page that cannot reach the network spends its budgets, so an
 * outage ends in a give-up the healer and the boot take up, instead of
 * every retry waiting for good. Its listeners are the page's, installed
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

type Events = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** The browser page as the gate reads it (a fake one in the tests). */
export interface GatePage {
  /** "online", "offline", "pagehide", "pageshow" */
  window: Events;
  /** "visibilitychange" */
  document: Events & { readonly visibilityState: DocumentVisibilityState };
  navigator: { readonly onLine: boolean };
  /** a monotonic clock (ms) */
  now: () => number;
}

/** One page's view of its network (see above). */
export interface NetGate {
  visible: () => boolean;
  usable: () => boolean;
  leaving: () => boolean;
  /** how long the page has been visible since the gate started (ms) */
  visibleMs: () => number;
  whenUsable: (signal?: AbortSignal) => Promise<void>;
  onUsableAgain: (listener: () => void) => () => void;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function createNetGate(page: GatePage): NetGate {
  let leaving = false;
  const visible = () => page.document.visibilityState !== "hidden";
  const usable = () => visible() && page.navigator.onLine !== false;
  const clock = createVisibleClock(visible(), page.now());
  const wakers = new Set<() => void>();
  const changed = () => {
    clock.set(visible(), page.now());
    if (usable()) {
      // (each waker deletes itself: a Set iterates on safely)
      for (const wake of wakers) {
        wake();
      }
    }
  };
  page.window.addEventListener("online", changed);
  page.window.addEventListener("offline", changed);
  page.document.addEventListener("visibilitychange", changed);
  page.window.addEventListener("pagehide", () => {
    leaving = true;
    changed();
  });
  page.window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) {
      leaving = false;
    }
    changed();
  });
  const whenUsable = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    if (usable()) {
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
          () => (visible() ? wake() : arm()),
          OFFLINE_PROBE_MS
        );
      };
      wakers.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
      arm();
    });
  };
  const onUsableAgain = (listener: () => void) => {
    const wake = () => {
      if (visible()) {
        listener();
      }
    };
    page.window.addEventListener("online", wake);
    page.document.addEventListener("visibilitychange", wake);
    page.window.addEventListener("pageshow", wake);
    return () => {
      page.window.removeEventListener("online", wake);
      page.document.removeEventListener("visibilitychange", wake);
      page.window.removeEventListener("pageshow", wake);
    };
  };
  return {
    visible,
    usable,
    leaving: () => leaving,
    visibleMs: () => clock.visibleMs(page.now()),
    whenUsable,
    onUsableAgain,
  };
}

let gate: NetGate | null = null;
const retryWatchers = new Set<(note: RetryNote) => void>();

/** The page's gate, made on first use; none outside a browser (a unit
 *  test), where the page counts as visible, online and staying. */
function pageGate(): NetGate | null {
  if (!gate && typeof window !== "undefined") {
    gate = createNetGate({
      window,
      document,
      navigator,
      now: () => performance.now(),
    });
  }
  return gate;
}

/** The page is not hidden (a hidden page's frames — and so its streaming —
 *  stop). */
export function pageVisible(): boolean {
  return pageGate()?.visible() ?? true;
}

/** Visible and not offline: a request now can succeed. */
export function pageUsable(): boolean {
  return pageGate()?.usable() ?? true;
}

/** The page is on its way out (pagehide, not yet back from the bfcache). */
export function pageLeaving(): boolean {
  return pageGate()?.leaving() ?? false;
}

/** How long the page has been visible since it loaded (ms): the clock the
 *  retries' budgets and the boot's network wait count by. */
export function visibleMs(): number {
  return pageGate()?.visibleMs() ?? performance.now();
}

/**
 * Resolves once the page is usable — on "online", "visibilitychange" or
 * "pageshow", or, while it is visible but offline, every
 * OFFLINE_PROBE_MS — and rejects with an AbortError when `signal` aborts.
 */
export function whenUsable(signal?: AbortSignal): Promise<void> {
  const page = pageGate();
  if (page) {
    return page.whenUsable(signal);
  }
  return signal?.aborted ? Promise.reject(abortError()) : Promise.resolve();
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
  const nav = globalThis.navigator as Navigator | undefined;
  const vis = typeof document === "undefined" ? "?" : document.visibilityState;
  return `online=${String(nav?.onLine !== false)} vis=${vis}`;
}

/** The retries' page: the real one. */
export const PAGE_RETRY_ENV: RetryEnv = {
  whenUsable,
  sleep,
  visibleMs,
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
  return pageGate()?.onUsableAgain(listener) ?? (() => undefined);
}
