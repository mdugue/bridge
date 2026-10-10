/**
 * `scheduler.yield()` where the browser lacks it — every WebKit browser,
 * and with it every browser on an iPhone. three's asynchronous compiles
 * (`compileAsync`, the node builder's stages) yield to the main thread
 * between their steps with it, and fall back to `requestAnimationFrame`
 * without it (three/src/utils.js `yieldToMain`): there each node build
 * waited for nine frames — three stages for each of three shader stages —
 * whatever its own cost, so a tile's compile or the dressing's took as many
 * frames as it had materials times nine, and a phone's slow boot frames
 * made that seconds. A message-channel task gives the event loop back as
 * Chromium's own `scheduler.yield` does (input and frames run between the
 * steps) without waiting for a frame; the compiles then run as they do in
 * Chromium.
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
