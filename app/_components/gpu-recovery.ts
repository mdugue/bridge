import {
  type GpuLoss,
  mayRecover,
  recentHistory,
  type RecoveryHistory,
  type SafetyLevel,
} from "@/lib/city/gpu-safety";
import { SESSION_KEYS } from "./storage-keys";

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
 * page was in the background says nothing about the page, nor does a
 * frame that threw on a GPU that still answers (a bug): each reloads at
 * the same level, under a cap of its own.
 */

const KEY = SESSION_KEYS.gpuRecovery;
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
  /** when it reloaded for a frame that failed on a working GPU (ms) */
  failures?: number[];
  /** the snapshot waits for a reload the player asked for full detail in */
  reset?: boolean;
}

/** The reload times kept, as the caps read them. */
const historyOf = (stored: Stored): RecoveryHistory => ({
  losses: stored.tries,
  reclaims: stored.reclaims ?? [],
  failures: stored.failures ?? [],
});

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
 * (none: the page never drew, and the one it booted with stays) and, for a
 * loss in use, the stored level raised (`raise`, gpu-safety.ts; false: it
 * could not be stored). The caller reloads. False with storage
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
    const history = historyOf(stored);
    if (!mayRecover(how, level, history, now)) {
      return false;
    }
    const recent = recentHistory(history, now);
    const next: Stored = {
      tries: [...recent.losses, ...(how === "lost" ? [now] : [])],
      reclaims: [...recent.reclaims, ...(how === "reclaimed" ? [now] : [])],
      failures: [...recent.failures, ...(how === "failed" ? [now] : [])],
    };
    // A page lost before its first frame has no camera of its own yet:
    // the place it booted at waits for the next load still.
    const kept = snapshot ?? stored.snapshot;
    if (kept) {
      next.snapshot = kept;
    }
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  return how !== "lost" || raise(level);
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
  keepPlaceForReload(snapshot, store);
}

/**
 * The place, the time and the look kept for a reload the caller is about
 * to make — *Leichter weiter*, or the sidebar's reset to full detail
 * (`reset`, so the next page's trail does not call it a lost GPU). The
 * reload times stay as they were: such a page is no recovery
 * (`recentlyRecovered`). Without storage the reload starts at the spawn.
 */
export function keepPlaceForReload(
  snapshot: string | null,
  store: Store | null = session(),
  { reset = false }: { reset?: boolean } = {}
): void {
  if (!(store && snapshot)) {
    return;
  }
  try {
    const next: Stored = { ...read(store), snapshot };
    if (reset) {
      next.reset = true;
    } else {
      delete next.reset;
    }
    store.setItem(KEY, JSON.stringify(next));
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
    const { losses, reclaims, failures } = historyOf(read(store));
    return [...losses, ...reclaims, ...failures].some(
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

/**
 * Whether the snapshot waiting for this load was kept for a reset to full
 * detail (`keepPlaceForReload`), not for a lost GPU.
 */
export function recoveryWasReset(store: Store | null = session()): boolean {
  if (!store) {
    return false;
  }
  try {
    return read(store).reset === true;
  } catch {
    return false;
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
    const rest = read(store);
    const { snapshot } = rest;
    if (!snapshot) {
      return null;
    }
    delete rest.snapshot;
    delete rest.reset;
    store.setItem(KEY, JSON.stringify(rest));
    return snapshot;
  } catch {
    return null;
  }
}
