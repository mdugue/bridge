/**
 * At most `limit` async tasks at once, the rest waiting in the order they
 * came: what keeps a burst of parallel work from holding all its
 * intermediate memory at the same moment (the streamed tiles' rasters,
 * app/_components/raster-upload.ts). A waiter whose signal aborts leaves the
 * line without running; a task that fails frees its place like one that
 * succeeds.
 */
export interface TaskGate {
  /** runs `task` once a place is free; rejects with the signal's reason
   *  when it aborts first */
  run: <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
  /** tasks running now */
  running: () => number;
  /** tasks waiting for a place */
  waiting: () => number;
  /** how many may run at once from now on (a raised limit starts waiters
   *  at once; a lowered one lets the running finish) */
  setLimit: (limit: number) => void;
}

interface Waiter {
  start: () => void;
}

/** What a waiter rejects with when its signal fires: the abort's reason. */
function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export function createTaskGate(initialLimit: number): TaskGate {
  let limit = initialLimit;
  let running = 0;
  const line: Waiter[] = [];
  const next = () => {
    while (running < limit && line.length > 0) {
      line.shift()?.start();
    }
  };
  const run = <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      const waiter: Waiter = {
        start: () => {
          signal?.removeEventListener("abort", leave);
          running++;
          // a task that throws synchronously is a failed task, not a stuck
          // place
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              running--;
              next();
            });
        },
      };
      const leave = () => {
        const at = line.indexOf(waiter);
        if (at >= 0) {
          line.splice(at, 1);
          reject(abortError(signal));
        }
      };
      signal?.addEventListener("abort", leave, { once: true });
      line.push(waiter);
      next();
    });
  return {
    run,
    running: () => running,
    waiting: () => line.length,
    setLimit: (next_: number) => {
      limit = Math.max(1, next_);
      next();
    },
  };
}
