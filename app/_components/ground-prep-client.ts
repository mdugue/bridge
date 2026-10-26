import {
  type GroundIndex,
  type GroundPrep,
  type GroundPrepInput,
  prepareGround,
} from "@/lib/city/ground-prep";

/**
 * A terrain level's heights and water sheets (lib/city/ground-prep.ts),
 * worked out in the ground worker (ground-worker.ts) — one for the page,
 * started at the first level. The input is copied to it (the level still
 * draws from its own buffers) except an index the site shares (the coarse
 * levels' grid index, `shared`): that one is sent once and kept there.
 * The results come back without a copy. Jobs go one at a time, so a job
 * whose level was dropped while it queued (a flight outruns the stream)
 * is skipped, never run. Where no worker starts (a test, a browser that
 * refuses it) or it dies, the work runs here, on the main thread, as it
 * did before.
 */
interface Job {
  input: GroundPrepInput;
  shared?: object;
  signal?: AbortSignal;
  resolve: (prep: GroundPrep) => void;
  reject: (err: unknown) => void;
}

let worker: Worker | null = null;
let broken = typeof Worker === "undefined";
/** the job the worker is on, and those waiting for it */
let running: Job | null = null;
const queue: Job[] = [];
/** the shared indices the worker holds, by key, oldest first; it keeps a
 *  few (a remounted stream shares new ones), each a coarse level's 6 MB */
const sentShared = new Set<number>();
const MAX_SHARED = 2;
const sharedKeys = new WeakMap<object, number>();
let nextKey = 0;
const keyOf = (shared: object): number => {
  let key = sharedKeys.get(shared);
  if (key === undefined) {
    key = nextKey++;
    sharedKeys.set(shared, key);
  }
  return key;
};

/** Whether the ground worker is up (a test asks: the fallback answers alike). */
export function groundWorkerUp(): boolean {
  return worker !== null && !broken;
}

function runHere(job: Job): void {
  try {
    job.resolve(prepareGround(job.input));
  } catch (err) {
    job.reject(err);
  }
}

/** The work done here after all: the worker failed to start or died. */
function giveUp(): void {
  broken = true;
  worker?.terminate();
  worker = null;
  sentShared.clear();
  const left = running ? [running, ...queue] : [...queue];
  running = null;
  queue.length = 0;
  for (const job of left) {
    if (job.signal?.aborted) {
      job.reject(job.signal.reason);
    } else {
      runHere(job);
    }
  }
}

interface Reply {
  prep?: GroundPrep;
  error?: string;
}

function startWorker(): Worker | null {
  if (worker || broken) {
    return worker;
  }
  try {
    worker = new Worker(new URL("./ground-worker.ts", import.meta.url), {
      type: "module",
      name: "ground",
    });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const job = running;
    running = null;
    if (job) {
      if (data.prep) {
        job.resolve(data.prep);
      } else {
        job.reject(new Error(`ground worker: ${data.error ?? "failed"}`));
      }
    }
    next();
  };
  // a reply that cannot be read: that job here, the rest as before
  worker.onmessageerror = () => {
    const job = running;
    running = null;
    if (job) {
      runHere(job);
    }
    next();
  };
  worker.onerror = (event) => {
    event.preventDefault();
    giveUp();
  };
  return worker;
}

/** Only the numbers a job reads: a glTF accessor is a view into a buffer
 *  that may hold more, and a message copies the whole buffer. */
function packed(job: Job): { message: unknown; transfer: Transferable[] } {
  const { input } = job;
  const positions = input.positions.slice(
    0,
    Math.min(input.positions.length, input.count * input.stride)
  );
  const shared = job.shared ? keyOf(job.shared) : undefined;
  const drop: number[] = [];
  let index: GroundIndex | null = null;
  if (input.index && !(shared !== undefined && sentShared.has(shared))) {
    index = input.index.slice();
    if (shared !== undefined) {
      sentShared.add(shared);
      for (const key of sentShared) {
        if (sentShared.size <= MAX_SHARED) {
          break;
        }
        sentShared.delete(key);
        drop.push(key);
      }
    }
  }
  const transfer: Transferable[] = [positions.buffer];
  if (index) {
    transfer.push(index.buffer);
  }
  return {
    message: { input: { ...input, positions, index }, shared, drop },
    transfer,
  };
}

function next(): void {
  while (!running && queue.length > 0) {
    // a coarse level first (a grid: no TIN index to build), as the stream
    // dresses its coarse levels ahead of the fine ones
    const coarse = queue.findIndex((j) => j.input.grid !== null);
    const job = queue.splice(Math.max(coarse, 0), 1)[0];
    if (job.signal?.aborted) {
      job.reject(job.signal.reason);
      continue;
    }
    const w = startWorker();
    if (!w) {
      runHere(job);
      continue;
    }
    running = job;
    try {
      const { message, transfer } = packed(job);
      w.postMessage(message, transfer);
    } catch {
      // a message that cannot be sent (nothing went over: a clone fails
      // before the transfer) is done here, and the queue goes on
      running = null;
      if (job.shared) {
        // (sent again with the next job that shares it)
        sentShared.delete(keyOf(job.shared));
      }
      runHere(job);
    }
  }
}

/**
 * `prepareGround` in the ground worker (here where there is none).
 * `shared` is an index attribute the site shares (`input.index` its
 * array), sent to the worker once. Rejects with the abort when `signal`
 * fires before the job's turn.
 */
export function prepareGroundOffThread(
  input: GroundPrepInput,
  opts: { shared?: object; signal?: AbortSignal } = {}
): Promise<GroundPrep> {
  return new Promise<GroundPrep>((resolve, reject) => {
    queue.push({ input, ...opts, resolve, reject });
    next();
  });
}
