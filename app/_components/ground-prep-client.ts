import {
  type GroundPrep,
  type GroundPrepInput,
  prepareGround,
} from "@/lib/city/ground-prep";

/**
 * A terrain level's heights and water sheets (lib/city/ground-prep.ts),
 * worked out in the ground worker (ground-worker.ts) — one for the page,
 * started at the first level, its jobs one after another. The input is
 * copied to it (the level still draws from its own buffers, and the
 * coarse levels share their index); the results come back without a copy.
 * Where no worker starts (a test, a browser that refuses it) or the worker
 * fails, the work runs here as it did before, on the main thread.
 */
interface Pending {
  resolve: (prep: GroundPrep) => void;
  reject: (err: Error) => void;
  input: GroundPrepInput;
}

let worker: Worker | null = null;
let broken = typeof Worker === "undefined";
let nextId = 0;
const pending = new Map<number, Pending>();

/** The work done here after all: the worker failed to start or died. */
function giveUp(): void {
  broken = true;
  worker?.terminate();
  worker = null;
  for (const [id, job] of pending) {
    pending.delete(id);
    try {
      job.resolve(prepareGround(job.input));
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
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
  worker.onmessage = ({
    data,
  }: MessageEvent<{ id: number; prep?: GroundPrep; error?: string }>) => {
    const job = pending.get(data.id);
    if (!job) {
      return;
    }
    pending.delete(data.id);
    if (data.prep) {
      job.resolve(data.prep);
      return;
    }
    // the worker threw: here, then, where the same input throws the same
    try {
      job.resolve(prepareGround(job.input));
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    giveUp();
  };
  return worker;
}

/** `prepareGround` in the ground worker (here where there is none). */
export function prepareGroundOffThread(
  input: GroundPrepInput
): Promise<GroundPrep> {
  const w = startWorker();
  if (!w) {
    return Promise.resolve().then(() => prepareGround(input));
  }
  const id = nextId++;
  // Only the numbers the job reads: a glTF accessor is a view into a
  // buffer that may hold more, and a message copies the whole buffer.
  const sent: GroundPrepInput = {
    ...input,
    positions: input.positions.slice(
      0,
      Math.min(input.positions.length, input.count * input.stride)
    ),
    index: input.index?.slice() ?? null,
  };
  const transfer = [sent.positions.buffer, sent.index?.buffer].filter(
    (b): b is ArrayBuffer => b instanceof ArrayBuffer
  );
  return new Promise<GroundPrep>((resolve, reject) => {
    pending.set(id, { resolve, reject, input });
    w.postMessage({ id, input: sent }, transfer);
  });
}
