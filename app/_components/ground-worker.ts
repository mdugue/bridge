/**
 * The ground worker: a terrain level's heights and water sheets
 * (lib/city/ground-prep.ts) worked out off the main thread, its arrays
 * handed back without a copy. Started by ground-prep-client.ts.
 */
import {
  type GroundPrepInput,
  groundPrepTransfer,
  prepareGround,
} from "@/lib/city/ground-prep";

interface Job {
  id: number;
  input: GroundPrepInput;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const prep = prepareGround(data.input);
    scope.postMessage({ id: data.id, prep }, groundPrepTransfer(prep));
  } catch (err) {
    scope.postMessage(
      { id: data.id, error: err instanceof Error ? err.message : String(err) },
      []
    );
  }
};
