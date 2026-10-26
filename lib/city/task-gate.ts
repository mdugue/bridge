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
  /** how many waiters of a lower rank went ahead of it */
  overtaken: number;
  start: () => void;
}

/** Where a waiter of `rank` joins the line: before the first of a higher
 *  rank, but behind every one overtaken `maxOvertakes` times already;
 *  those it goes ahead of count one more. */
function placeIn(line: Waiter[], rank: number, maxOvertakes: number): number {
  let at = line.findIndex((w) => w.rank > rank);
  if (at < 0) {
    return line.length;
  }
  for (let i = line.length - 1; i >= at; i--) {
    if (line[i].overtaken >= maxOvertakes) {
      at = i + 1;
      break;
    }
  }
  for (let i = at; i < line.length; i++) {
    line[i].overtaken++;
  }
  return at;
}

/** What a waiter rejects with when its signal fires: the abort's reason. */
function abortError(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

/** `maxOvertakes`: how many waiters of a lower rank may go ahead of one
 *  that came before them — past it, it keeps its place, so a stream of
 *  low ranks cannot hold a higher one back for ever. */
export function createTaskGate(
  initialLimit: number,
  maxOvertakes = Number.POSITIVE_INFINITY
): TaskGate {
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
        overtaken: 0,
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
      line.splice(placeIn(line, rank, maxOvertakes), 0, waiter);
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
