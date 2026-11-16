import { nichesOf } from "@/lib/city/window-niches";
import type { NicheMesh, NicheTable } from "@/lib/city/window-niches";
import { createWorkerClient } from "./worker-client";

/**
 * A city tile's window niches (lib/city/window-niches.ts `nichesOf`),
 * worked out in the niche worker (window-niche-worker.ts) — one for the
 * page, started at the first tile. The input is the tile's own copy
 * (`nicheInput`, window-niche-layer.ts), handed over; the result comes back
 * without a copy. Jobs go one at a time, and one whose tile left while it
 * queued is skipped. Where no worker starts or it dies, the work runs
 * here, on the main thread, one job a task; the job a dying worker held
 * is lost with its copy. The one rule of the page's workers
 * (worker-client.ts).
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

interface Reply {
  out?: NicheResult;
  error?: string;
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

const client = createWorkerClient<NicheJobInput, Reply, NicheResult>({
  name: "niche",
  start: () =>
    new Worker(new URL("./window-niche-worker.ts", import.meta.url), {
      type: "module",
      name: "niches",
    }),
  pack: (input) => ({
    message: input,
    transfer: transfers(input),
    kept: false,
  }),
  unpack: (reply) => {
    if (!reply.out) {
      throw new Error(`niche worker: ${reply.error ?? "failed"}`);
    }
    return reply.out;
  },
  here: (input) => nichesOf(input.mesh, input.table),
});

/** A tile's niches from its own copy of mesh and table (handed over:
 *  neither may be read after this call). A tile that leaves while its job
 *  waits lets go of its copy at once. */
export async function tileNichesOffThread(
  input: NicheJobInput,
  signal: AbortSignal
): Promise<NicheResult> {
  return await client.run(input, signal);
}

/**
 * Stops the worker before the page reloads (create-app.ts `stopWorkers`,
 * once the stream is gone): what its last tiles left in its heap goes
 * now, not when the old document is collected. The job it held and those
 * queued settle as given up (their tiles went with the scene); a later job
 * starts a new worker.
 */
export function stopNicheWorker(): void {
  client.stop();
}
