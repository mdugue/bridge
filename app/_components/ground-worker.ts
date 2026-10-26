/**
 * The ground worker: a terrain level's heights and water sheets
 * (lib/city/ground-prep.ts) worked out off the main thread, its arrays
 * handed back without a copy. Started by ground-prep-client.ts, one job
 * at a time; an index the site shares comes once, under its key, and is
 * kept here for the next level that names it.
 */
import {
  type GroundIndex,
  type GroundPrepInput,
  groundPrepTransfer,
  prepareGround,
} from "@/lib/city/ground-prep";

interface Job {
  input: GroundPrepInput;
  /** the key of an index the site shares: sent once, then null */
  shared?: number;
  /** shared indices the page no longer sends */
  drop: number[];
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

const sharedIndices = new Map<number, GroundIndex>();

scope.onmessage = ({ data }) => {
  try {
    const { input, shared, drop } = data;
    for (const key of drop) {
      sharedIndices.delete(key);
    }
    if (shared !== undefined && input.index) {
      sharedIndices.set(shared, input.index);
    }
    const index =
      shared === undefined ? input.index : (sharedIndices.get(shared) ?? null);
    const prep = prepareGround({ ...input, index });
    scope.postMessage({ prep }, groundPrepTransfer(prep));
  } catch (err) {
    scope.postMessage(
      { error: err instanceof Error ? err.message : String(err) },
      []
    );
  }
};
