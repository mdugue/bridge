/**
 * At most `limit` async tasks at once, the rest waiting in the order they
 * came, a lower `rank` ahead of a higher one: what keeps a burst of
 * parallel work from holding all its intermediate memory at the same
 * moment (the streamed tiles' rasters, app/_components/raster-upload.ts),
 * and the tiles' dressings one at a time, the coarse levels' first
 * (tile-stream.ts). A waiter whose signal aborts leaves the
 * line without running; a task that fails frees its place like one that
 * succeeds.
 */
export interface TaskGate {
  /** runs `task` once a place is free, after every waiter of a lower or
   *  the same `rank` (default 0); rejects with the signal's reason when it
   *  aborts first */
  run: <T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
    rank?: number
  ) => Promise<T>;
  /** tasks running now */
  running: () => number;
  /** tasks waiting for a place */
  waiting: () => number;
  /** how many may run at once from now on (a raised limit starts waiters
   *  at once; a lowered one lets the running finish) */
  setLimit: (limit: number) => void;
}

interface Waiter {
  rank: number;
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
  const run = <T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
    rank = 0
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      const waiter: Waiter = {
        rank,
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
      const behind = line.findIndex((w) => w.rank > rank);
      line.splice(behind < 0 ? line.length : behind, 0, waiter);
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
