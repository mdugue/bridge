/**
 * A build that gives the main thread back while it runs. A dressing's
 * builders (the trees, the rails and their ballast, the tram, the ask
 * sets) each ran as one task: on the phone profile (CPU ×4) up to 1.3 s in
 * which no frame was drawn — the stutter of every tile a flight reaches.
 * Their work is plain arithmetic over the tile's features and three
 * objects nothing draws yet, so it can stop anywhere: written as a
 * generator (`Steps`), a builder `yield`s where it may pause — between
 * features, cells, triangles — and its driver decides whether it does.
 *
 * `inSlices` runs one in slices of SLICE_MS, the main thread given back
 * between them (`scheduler.yield`: the browser's, or main-yield.ts's on
 * WebKit — input and frames run in between); `finished` runs the rest at
 * once (a test, a question that needs the ask sets now). A builder reads
 * the ground through the scene's `heightAt` as before; a level that lands
 * between two slices is read by the later ones, as it was by the later
 * builders before.
 */
export type Steps<T> = Generator<void, T, void>;

/** How long a slice runs before it gives the thread back (ms): half a
 *  60 Hz frame — the frame's own work on a phone is the other half and
 *  more. */
export const SLICE_MS = 8;
/** The slice while the camera rests (ms): the picture holds still, so a
 *  frame that comes a slice later shows nothing missing, and the tile
 *  under way is dressed in less than half the time — on a phone a frame's own
 *  work is 30 ms and more, and each pause costs one. */
export const REST_SLICE_MS = 30;

let budget = SLICE_MS;

/** The slice `inSlices` runs from its next one on (ms): the scene sets
 *  SLICE_MS while its camera moves, REST_SLICE_MS while it rests. */
export function setSliceBudget(ms: number): void {
  budget = ms;
}

/** Runs `steps` to its end, here and now. */
export function finished<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) {
      return r.value;
    }
  }
}

/** The main thread given back: the next slice in a later task. */
export function giveBack(): Promise<void> {
  const host = globalThis as {
    scheduler?: { yield?: () => Promise<void> };
  };
  if (typeof host.scheduler?.yield === "function") {
    return host.scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Runs `steps` in slices of about `sliceMs` (the budget the scene set,
 * `setSliceBudget`, where not given), the thread given back between them. A step longer than a slice runs whole (the builders keep theirs
 * short). Rejects with `signal`'s reason before the first slice and at
 * every pause after it fires: the build of a tile that left stops there
 * (its caller frees what was built).
 */
export async function inSlices<T>(
  steps: Steps<T>,
  opts: { now?: () => number; signal?: AbortSignal; sliceMs?: number } = {}
): Promise<T> {
  const { now = () => performance.now(), signal, sliceMs } = opts;
  signal?.throwIfAborted();
  let start = now();
  for (;;) {
    const r = steps.next();
    if (r.done) {
      return r.value;
    }
    if (now() - start >= (sliceMs ?? budget)) {
      await giveBack();
      signal?.throwIfAborted();
      start = now();
    }
  }
}

/** `fn` over `items` in runs of `size`, a step after each run: for a loop
 *  whose items are each cheap (a tree's placement, a triangle). */
export function* inRuns<I, T>(
  items: readonly I[],
  size: number,
  fn: (run: I[]) => T[]
): Steps<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i += size) {
    for (const v of fn(items.slice(i, i + size))) {
      out.push(v);
    }
    yield;
  }
  return out;
}

/** `steps` while `go` says so: stops (undefined) at the first step it
 *  says no before — another driver may finish them (`finished`). */
export function* onlyWhile<T>(
  steps: Steps<T>,
  go: () => boolean
): Steps<T | undefined> {
  for (;;) {
    if (!go()) {
      return undefined;
    }
    const r = steps.next();
    if (r.done) {
      return r.value;
    }
    yield;
  }
}
