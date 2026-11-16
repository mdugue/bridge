import { prepareGround } from "@/lib/city/ground-prep";
import type {
  GroundIndex,
  GroundPrep,
  GroundPrepInput,
} from "@/lib/city/ground-prep";
import { createWorkerClient } from "./worker-client";

/**
 * A terrain level's heights and water sheets (lib/city/ground-prep.ts),
 * worked out in the ground worker (ground-worker.ts) — one for the page,
 * started at the first level. The input is copied to it (the level still
 * draws from its own buffers) except an index the site shares (the coarse
 * levels' grid index, `shared`): that one is sent once and kept there.
 * The results come back without a copy. Jobs go one at a time, a coarse
 * level's first, so a job whose level was dropped while it queued (a
 * flight outruns the stream) is skipped, never run. Where no worker starts
 * or it dies, the work runs here, on the main thread: the one rule of the
 * page's workers (worker-client.ts).
 */
interface Job {
  input: GroundPrepInput;
  shared?: object;
}

/** the shared indices the worker holds, by key, oldest first; it keeps a
 *  few (a remounted stream shares new ones), each a coarse level's 6 MB */
const sentShared = new Set<number>();
const MAX_SHARED = 2;
const sharedKeys = new WeakMap<object, number>();
let nextKey = 0;
const keyOf = (shared: object): number => {
  let key = sharedKeys.get(shared);
  if (key === undefined) {
    key = nextKey;
    nextKey += 1;
    sharedKeys.set(shared, key);
  }
  return key;
};

interface Reply {
  prep?: GroundPrep;
  error?: string;
}

/** Only the numbers a job reads: a glTF accessor is a view into a buffer
 *  that may hold more, and a message copies the whole buffer. */
function packed(job: Job): {
  message: unknown;
  transfer: Transferable[];
  kept: boolean;
} {
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
    // the level's own buffers stay: the job can still run here
    kept: true,
  };
}

const client = createWorkerClient<Job, Reply, GroundPrep>({
  name: "ground",
  start: () =>
    new Worker(new URL("./ground-worker.ts", import.meta.url), {
      type: "module",
      name: "ground",
    }),
  pack: packed,
  unpack: (reply) => {
    if (!reply.prep) {
      throw new Error(`ground worker: ${reply.error ?? "failed"}`);
    }
    return reply.prep;
  },
  here: (job) => prepareGround(job.input),
  // a coarse level first (a grid: no TIN index to build), as the stream
  // dresses its coarse levels ahead of the fine ones
  rank: (job) => (job.input.grid === null ? 1 : 0),
  unsent: (job) => {
    if (job.shared) {
      // (sent again with the next job that shares it)
      sentShared.delete(keyOf(job.shared));
    }
  },
  ended: () => sentShared.clear(),
});

/** Whether the ground worker is up (a test asks: the fallback answers alike). */
export function groundWorkerUp(): boolean {
  return client.up();
}

/**
 * Stops the worker before the page reloads (create-app.ts `stopWorkers`,
 * once the stream is gone): its heap — a coarse level's shared indices, a
 * job's copies — goes with it now, not when the old document is
 * collected. The jobs still waiting end with an abort (their tiles went
 * with the scene); a later job starts a new worker.
 */
export function stopGroundWorker(): void {
  client.stop();
}

/**
 * `prepareGround` in the ground worker (here where there is none).
 * `shared` is an index attribute the site shares (`input.index` its
 * array), sent to the worker once. Rejects with the abort when `signal`
 * fires before the job's turn.
 */
export async function prepareGroundOffThread(
  input: GroundPrepInput,
  opts: { shared?: object; signal?: AbortSignal } = {}
): Promise<GroundPrep> {
  return await client.run({ input, shared: opts.shared }, opts.signal);
}
