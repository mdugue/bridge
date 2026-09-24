/**
 * SPIKE (plan 020): times a synchronous step and leaves a performance
 * measure when it is long enough to cost a frame, so a probe can say what
 * a stall was.
 */
export function timed<T>(name: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  if (duration > 16) {
    performance.measure(name, { start, duration });
  }
  return result;
}
