/**
 * Many reports of one task, one run: `queue` asks for `run` at the end of
 * the task (a microtask), however often it is called before then, and
 * `flush` runs a queued one now — where the caller must see its effect
 * before it goes on (create-app.ts: the tile stream's change pass right
 * after the renderer's update, before the frame renders, so a tile that
 * came into view draws with its shadows in that frame). A run that is
 * already done is not done again; a report during the run queues the next.
 */
export interface Coalescer {
  /** runs a queued `run` now (nothing when none is queued) */
  flush: () => void;
  /** asks for one `run` at the end of the task */
  queue: () => void;
}

export function createCoalescer(run: () => void): Coalescer {
  let queued = false;
  const flush = () => {
    if (!queued) {
      return;
    }
    queued = false;
    run();
  };
  return {
    flush,
    queue: () => {
      if (queued) {
        return;
      }
      queued = true;
      queueMicrotask(flush);
    },
  };
}
