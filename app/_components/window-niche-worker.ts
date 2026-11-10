/**
 * The window-niche worker: a city tile's niches (lib/city/window-niches.ts
 * `nichesOf`) worked out off the main thread, its arrays handed back
 * without a copy. Started by window-niche-client.ts, one job at a time.
 */
import { nichesOf } from "@/lib/city/window-niches";
import type { NicheMesh, NicheTable } from "@/lib/city/window-niches";

interface Job {
  mesh: NicheMesh;
  table: NicheTable;
}

const scope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<Job>) => void
  ) => void;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.addEventListener("message", ({ data }) => {
  try {
    const out = nichesOf(data.mesh, data.table);
    scope.postMessage({ out }, [
      out.niches.buffer,
      out.cells.buffer,
      out.houses.buffer,
    ]);
  } catch (error) {
    scope.postMessage(
      { error: error instanceof Error ? error.message : String(error) },
      []
    );
  }
});
