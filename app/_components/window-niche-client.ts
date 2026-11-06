import { nichesOf } from "@/lib/city/window-niches";
import type { NicheMesh, NicheTable } from "@/lib/city/window-niches";

/**
 * A city tile's window niches (lib/city/window-niches.ts `nichesOf`),
 * worked out in the niche worker (window-niche-worker.ts) — one for the
 * page, started at the first tile. The input is the tile's own copy
 * (`nicheInput`, window-niche-layer.ts), handed over; the result comes back
 * without a copy. Jobs go one at a time, and one whose tile left while it
 * queued is skipped. Where no worker starts (a test, a browser that
 * refuses it) or it dies, the work runs here, on the main thread.
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
  niches: Float32Array;
  cells: Float64Array;
}

interface Job {
  input: NicheJobInput;
  signal: AbortSignal;
  resolve: (out: NicheResult) => void;
  reject: (err: unknown) => void;
}

let worker: Worker | null = null;
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
  const left = running ? [running, ...queue] : [...queue];
  running = null;
  queue.length = 0;
  for (const job of left) {
    if (job.signal.aborted) {
      job.reject(job.signal.reason);
    } else {
      runHere(job);
    }
  }
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
      runHere(job);
      continue;
    }
    running = job;
    try {
      w.postMessage(job.input, transfers(job.input));
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
    queue.push({ input, signal, resolve, reject });
    next();
  });
}
