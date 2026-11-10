import { nichesOf } from "@/lib/city/window-niches";
import type { NicheMesh, NicheTable } from "@/lib/city/window-niches";

/**
 * A city tile's window niches (lib/city/window-niches.ts `nichesOf`),
 * worked out in the niche worker (window-niche-worker.ts) — one for the
 * page, started at the first tile. The input is the tile's own copy
 * (`nicheInput`, window-niche-layer.ts), handed over; the result comes back
 * without a copy. Jobs go one at a time, and one whose tile left while it
 * queued is skipped. Where no worker starts (a test, a browser that
 * refuses it, a module that fails to load: the first job is copied, not
 * handed over, until the worker has answered) or it dies, the work runs
 * here, on the main thread, one job a task.
 */
export interface NicheJobInput {
  mesh: NicheMesh & {
    positions: Float32Array;
    facade: Int16Array;
    objectIds: Uint32Array;
    index?: Uint32Array;
  };
  table: NicheTable;
}

export interface NicheResult {
  niches: Uint16Array;
  cells: Float64Array;
  houses: Float32Array;
}

interface Job {
  input: NicheJobInput;
  signal: AbortSignal;
  resolve: (out: NicheResult) => void;
  reject: (err: unknown) => void;
}

let worker: Worker | null = null;
/** the worker answered once: its module loaded, a job handed over to it
 *  (its buffers transferred) is in safe hands */
let answered = false;
let broken = typeof Worker === "undefined";
let running: Job | null = null;
const queue: Job[] = [];

function runHere(job: Job): void {
  try {
    job.resolve(nichesOf(job.input.mesh, job.input.table));
  } catch (error) {
    job.reject(error);
  }
}

/** The work done here after all: the worker failed to start or died. */
function giveUp(): void {
  broken = true;
  worker?.terminate();
  worker = null;
  // the job the worker held handed its buffers over: it cannot run here
  // (one sent before the worker ever answered was copied, not handed over)
  const held = running;
  running = null;
  if (held && !answered && !held.signal.aborted) {
    runHere(held);
  } else {
    held?.reject(new Error("niche worker died with a tile's niches"));
  }
  // the rest one a task, as `next` hands them on here: a flight's dozen
  // tiles must not freeze the page in one
  next();
}

interface Reply {
  out?: NicheResult;
  error?: string;
}

function startWorker(): Worker | null {
  if (worker || broken) {
    return worker;
  }
  let w: Worker;
  try {
    w = new Worker(new URL("./window-niche-worker.ts", import.meta.url), {
      type: "module",
      name: "niches",
    });
  } catch {
    broken = true;
    return null;
  }
  worker = w;
  w.addEventListener("message", ({ data }: MessageEvent<Reply>) => {
    if (worker !== w) {
      return;
    }
    answered = true;
    const job = running;
    running = null;
    if (job) {
      if (data.out) {
        job.resolve(data.out);
      } else {
        job.reject(new Error(`niche worker: ${data.error ?? "failed"}`));
      }
    }
    next();
  });
  w.addEventListener("error", (event) => {
    event.preventDefault();
    if (worker === w) {
      giveUp();
    }
  });
  // a reply that cannot be read leaves its job waiting for ever, and every
  // job behind it: as good as a dead worker
  w.addEventListener("messageerror", () => {
    if (worker === w) {
      giveUp();
    }
  });
  return w;
}

function transfers(input: NicheJobInput): Transferable[] {
  const { mesh, table } = input;
  const buffers = new Set<ArrayBufferLike>([
    mesh.positions.buffer,
    mesh.facade.buffer,
    mesh.objectIds.buffer,
    ...(mesh.index ? [mesh.index.buffer] : []),
    ...Object.values(table).map((a: ArrayBufferView) => a.buffer),
  ]);
  return [...buffers] as Transferable[];
}

/** A job run here in a task of its own, the next one after it: one a
 *  task, not all in this one. */
function runSoon(job: Job): void {
  running = job;
  setTimeout(() => {
    running = null;
    if (job.signal.aborted) {
      job.reject(job.signal.reason);
    } else {
      runHere(job);
    }
    next();
  }, 0);
}

function next(): void {
  while (!running) {
    const job = queue.shift();
    if (!job) {
      return;
    }
    if (job.signal.aborted) {
      job.reject(job.signal.reason);
      continue;
    }
    const w = startWorker();
    if (!w) {
      runSoon(job);
      return;
    }
    running = job;
    try {
      // until the worker has answered once (its module may yet fail to
      // load) the job is copied, so it can still run here
      w.postMessage(job.input, answered ? transfers(job.input) : []);
    } catch {
      running = null;
      runHere(job);
    }
  }
}

/** A tile's niches from its own copy of mesh and table (handed over:
 *  neither may be read after this call). */
export async function tileNichesOffThread(
  input: NicheJobInput,
  signal: AbortSignal
): Promise<NicheResult> {
  return await new Promise<NicheResult>((resolve, reject) => {
    // a tile that leaves while its job waits lets go of its copy at once
    const onAbort = () => {
      const at = queue.indexOf(job);
      if (at !== -1) {
        queue.splice(at, 1);
        job.reject(signal.reason);
      }
    };
    // settled, the job lets go of the signal (which lives as long as the
    // tile), and with it of its input
    const job: Job = {
      input,
      signal,
      resolve: (out) => {
        signal.removeEventListener("abort", onAbort);
        resolve(out);
      },
      reject: (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    };
    signal.addEventListener("abort", onAbort, { once: true });
    queue.push(job);
    next();
  });
}
