import {
  type GpuLoss,
  mayRecover,
  recentHistory,
  type SafetyLevel,
} from "@/lib/city/gpu-safety";

/**
 * A lost GPU, recovered by a new page where the player stood. iOS takes
 * Safari's GPU process away under memory pressure, and the page's device
 * is gone for good: three has no way back to a new one, so the only
 * recovery is a new page. The camera, the time and the look (the Snapshot
 * codec, lib/city/snapshot.ts) wait in session storage, and the next load
 * puts them back.
 *
 * A page that lost its GPU in use comes back a safety level lighter
 * (lib/city/gpu-safety.ts) — the level is raised before the reload, and a
 * level that cannot be stored means no reload: the next page would be no
 * lighter, and lose the GPU the same way. So one automatic reload per
 * level, none from the lightest; past that the HUD says the graphics
 * failed and offers "Leichter weiter". A GPU that iOS reclaimed while the
 * page was in the background says nothing about the page: it reloads at
 * the same level, under a cap of its own.
 */

const KEY = "gpu-recovery";
/** how long a page counts as following a recovery (recentlyRecovered) */
const RECENT_MS = 120_000;

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * Session storage, or null where the browser refuses it: with site data
 * blocked, merely reading `sessionStorage` throws (a default parameter
 * reading it would throw before any `try` — out of the HUD's render).
 */
function session(): Store | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

interface Stored {
  /** the snapshot to put back on the next load */
  snapshot?: string;
  /** when the page last reloaded for a lost GPU (ms) */
  tries: number[];
  /** when it reloaded for a GPU reclaimed in the background (ms) */
  reclaims?: number[];
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
 * Whether the page reloads itself after its GPU went (`how`), at `level`
 * (the page's safety level): if so, `snapshot` is kept for the next load
 * and, for a loss in use, the stored level raised (`raise`, gpu-safety.ts;
 * false: it could not be stored). The caller reloads. False with storage
 * unavailable, or past the caps (lib/city/gpu-safety.ts `mayRecover`):
 * then the caller says the graphics failed.
 */
export function recoverFromGpuLoss(
  how: GpuLoss,
  snapshot: string | null,
  level: SafetyLevel,
  raise: (from: SafetyLevel) => boolean,
  store: Store | null = session(),
  now = Date.now()
): boolean {
  if (!store) {
    return false;
  }
  try {
    const stored = read(store);
    const history = { losses: stored.tries, reclaims: stored.reclaims ?? [] };
    if (!mayRecover(how, level, history, now)) {
      return false;
    }
    const recent = recentHistory(history, now);
    const next: Stored =
      how === "lost"
        ? { tries: [...recent.losses, now], reclaims: [...recent.reclaims] }
        : { tries: [...recent.losses], reclaims: [...recent.reclaims, now] };
    if (snapshot) {
      next.snapshot = snapshot;
    }
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return how === "reclaimed" || raise(level);
}

/**
 * "Leichter weiter" on the failure card: a level lighter and back where
 * the player stood, past every cap — the player asked for it. The caller
 * reloads; without storage that reload is all there is.
 */
export function recoverOnRequest(
  snapshot: string | null,
  level: SafetyLevel,
  raise: (from: SafetyLevel) => boolean,
  store: Store | null = session()
): void {
  raise(level);
  if (!(store && snapshot)) {
    return;
  }
  try {
    store.setItem(KEY, JSON.stringify({ ...read(store), snapshot }));
  } catch {
    // The reload starts at the spawn.
  }
}

/**
 * Whether this page follows a recovery (the last one under two minutes
 * ago): what died before it was the lost GPU, already handled — iOS may
 * interleave a navigation of its own that leaves a trail with nothing but
 * its start (crash-report.tsx does not offer that one).
 */
export function recentlyRecovered(
  store: Store | null = session(),
  now = Date.now()
): boolean {
  if (!store) {
    return false;
  }
  try {
    const stored = read(store);
    return [...stored.tries, ...(stored.reclaims ?? [])].some(
      (t) => now - t < RECENT_MS
    );
  } catch {
    return false;
  }
}

/**
 * The snapshot a recovery left for this load, without taking it: a boot
 * that StrictMode aborts (or that fails before its first frame) leaves it
 * for the next one. `takeRecoverySnapshot` once the scene is up.
 */
export function peekRecoverySnapshot(
  store: Store | null = session()
): string | null {
  if (!store) {
    return null;
  }
  try {
    return read(store).snapshot ?? null;
  } catch {
    return null;
  }
}

/** The snapshot a recovery left for this load, once (the tries stay). */
export function takeRecoverySnapshot(
  store: Store | null = session()
): string | null {
  if (!store) {
    return null;
  }
  try {
    const { snapshot, ...rest } = read(store);
    if (!snapshot) {
      return null;
    }
    store.setItem(KEY, JSON.stringify(rest));
    return snapshot;
  } catch {
    return null;
  }
}
