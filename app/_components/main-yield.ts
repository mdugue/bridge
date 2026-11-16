/**
 * `scheduler.yield()` where the browser lacks it — every WebKit browser,
 * and with it every browser on an iPhone. The dressing's builders give the
 * main thread back between their slices with it (lib/city/build-steps.ts
 * `giveBack`), and fall back to a timer without it, which the browser
 * clamps; three yields with it where no frame is drawn (a hidden page,
 * three/src/utils.js `yieldToMain`), and falls back to
 * `requestAnimationFrame` there, which a hidden page never runs. A
 * message-channel task gives the event loop back as Chromium's own
 * `scheduler.yield` does (input and frames run between the steps) without
 * waiting for a frame. (Up to r186 three's compiles yielded through it
 * between every node-build stage — nine frames a build on WebKit; since
 * r187 a compile works through a time budget and waits for a drawn frame
 * after it, the same in every browser.)
 *
 * Installed once, before the renderer exists; a browser with the real API
 * keeps it.
 */
export function installMainYield(): void {
  if (typeof MessageChannel === "undefined") {
    return;
  }
  // (the page's global, or the scene worker's: ADR 0061)
  const host = globalThis as unknown as {
    scheduler?: { yield?: () => Promise<void> };
  };
  if (typeof host.scheduler?.yield === "function") {
    return;
  }
  const waiting: (() => void)[] = [];
  const channel = new MessageChannel();
  channel.port1.addEventListener("message", () => {
    waiting.shift()?.();
  });
  // addEventListener does not open the port the way `onmessage` did
  channel.port1.start();
  const yieldNow = async () =>
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(null);
    });
  if (host.scheduler) {
    host.scheduler.yield = yieldNow;
  } else {
    host.scheduler = { yield: yieldNow };
  }
}

/** The fallback's wait where neither idle API exists (WebKit's worker). */
const IDLE_FALLBACK_MS = 250;

type PostTask = (
  task: () => void,
  opts: { priority: "background"; signal: AbortSignal }
) => Promise<unknown>;

/**
 * Runs `work` once the thread is idle — at the latest after `timeoutMs`,
 * since a busy thread never is. The page has `requestIdleCallback`; the
 * scene's worker (ADR 0061) has none in any browser, so there a
 * background-priority `scheduler.postTask` stands in (Chromium and
 * Firefox workers), raced against the timeout; where neither exists
 * (WebKit) a short timer does. Returns what cancels it.
 */
export function whenIdle(work: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(work, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const host = globalThis as unknown as {
    scheduler?: { postTask?: PostTask };
  };
  const postTask = host.scheduler?.postTask;
  if (typeof postTask !== "function") {
    const id = setTimeout(work, Math.min(timeoutMs / 2, IDLE_FALLBACK_MS));
    return () => clearTimeout(id);
  }
  const abort = new AbortController();
  let done = false;
  const run = () => {
    if (!done) {
      done = true;
      clearTimeout(timer);
      work();
    }
  };
  const timer = setTimeout(() => {
    abort.abort();
    run();
  }, timeoutMs);
  const background = async () => {
    try {
      await postTask.call(host.scheduler, run, {
        priority: "background",
        signal: abort.signal,
      });
    } catch (error) {
      // an abort is ours; anything else `work` threw, and stays loud
      if (!abort.signal.aborted) {
        throw error;
      }
    }
  };
  void background();
  return () => {
    done = true;
    clearTimeout(timer);
    abort.abort();
  };
}
