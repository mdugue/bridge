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
  if (typeof window === "undefined" || typeof MessageChannel === "undefined") {
    return;
  }
  const host = window as unknown as {
    scheduler?: { yield?: () => Promise<void> };
  };
  if (typeof host.scheduler?.yield === "function") {
    return;
  }
  const waiting: (() => void)[] = [];
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    waiting.shift()?.();
  };
  const yieldNow = () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(null);
    });
  if (host.scheduler) {
    host.scheduler.yield = yieldNow;
  } else {
    host.scheduler = { yield: yieldNow };
  }
}

/**
 * Runs `work` once the main thread is idle — at the latest after
 * `timeoutMs`, since a busy page never is. Where `requestIdleCallback` is
 * missing (Safari before 18) a timer of half that stands in. Returns what
 * cancels it.
 */
export function whenIdle(work: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(work, { timeout: timeoutMs });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(work, timeoutMs / 2);
  return () => clearTimeout(id);
}
