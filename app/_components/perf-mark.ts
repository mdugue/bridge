import { nodeRenderer } from "./gpu-mode";

/**
 * SPIKE (plan 020): times a synchronous step and leaves a performance
 * measure when it is long enough to cost a frame, so a probe can say what
 * a stall was. Node-renderer pages only: today's path runs the step as is.
 */
export function timed<T>(name: string, fn: () => T): T {
  if (!nodeRenderer()) {
    return fn();
  }
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  if (duration > 16) {
    performance.measure(name, { start, duration });
  }
  return result;
}
