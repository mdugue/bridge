/**
 * A lost GPU, recovered by a new page where the player stood. iOS takes
 * Safari's GPU process away under memory pressure, and the page's device
 * is gone for good: three has no way back to a new one, so the only
 * recovery is a new page. The camera, the time and the look (the Snapshot
 * codec, lib/city/snapshot.ts) wait in session storage, and the next load
 * puts them back. At most twice in two minutes: a scene that loses its GPU
 * again at once shows the message instead of reloading in a loop.
 */

const KEY = "gpu-recovery";
const WINDOW_MS = 120_000;
const TRIES = 2;

type Store = Pick<Storage, "getItem" | "setItem">;

interface Stored {
  /** the snapshot to put back on the next load */
  snapshot?: string;
  /** when the page last reloaded for a lost GPU (ms) */
  tries: number[];
}

function read(store: Store): Stored {
  try {
    const value = JSON.parse(store.getItem(KEY) ?? "null") as Stored | null;
    return value && Array.isArray(value.tries) ? value : { tries: [] };
  } catch {
    return { tries: [] };
  }
}

/**
 * Reloads the page with `snapshot` kept for the next load, unless it
 * already did twice in the last two minutes (or storage is unavailable):
 * then it returns false and the caller says the graphics failed.
 */
export function recoverFromGpuLoss(
  snapshot: string | null,
  store: Store = sessionStorage,
  reload: () => void = () => location.reload(),
  now = Date.now()
): boolean {
  try {
    const tries = read(store).tries.filter((t) => now - t < WINDOW_MS);
    if (tries.length >= TRIES) {
      return false;
    }
    const next: Stored = { tries: [...tries, now] };
    if (snapshot) {
      next.snapshot = snapshot;
    }
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Whether this page follows a recovery (the last one under two minutes
 * ago): what died before it was the lost GPU, already handled — iOS may
 * interleave a navigation of its own that leaves a trail with nothing but
 * its start (crash-report.tsx does not offer that one).
 */
export function recentlyRecovered(
  store: Store = sessionStorage,
  now = Date.now()
): boolean {
  try {
    return read(store).tries.some((t) => now - t < WINDOW_MS);
  } catch {
    return false;
  }
}

/** The snapshot a recovery left for this load, once (the tries stay). */
export function takeRecoverySnapshot(
  store: Store = sessionStorage
): string | null {
  try {
    const stored = read(store);
    if (!stored.snapshot) {
      return null;
    }
    store.setItem(KEY, JSON.stringify({ tries: stored.tries }));
    return stored.snapshot;
  } catch {
    return null;
  }
}
