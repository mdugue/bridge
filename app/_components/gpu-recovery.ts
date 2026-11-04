import { mayRecover, recentHistory } from "@/lib/city/gpu-recovery";
import type { RecoveryHistory } from "@/lib/city/gpu-recovery";
import type { GpuLoss, SafetyLevel } from "@/lib/city/gpu-safety";
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
 * the same level, under a cap of its own (lib/city/gpu-recovery.ts).
 *
 * The record and its protocol are one recovery session. A load reads what
 * waits (`peek`) before its boot and commits once the scene is up
 * (`landed`) or the boot failed (`abandoned`) — never on reading: React
 * StrictMode mounts the boot twice and aborts the first before its first
 * frame, and the second must still find the place. An aborted boot
 * commits nothing. The session holds no copy: every call reads the store,
 * so the double mount, the crash readers and the boot see one value.
 */

const KEY = SESSION_KEYS.gpuRecovery;
/** how long a page counts as following a recovery (`followsRecovery`) */
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

/** The level a reload goes lighter from, and how it is raised (gpu-safety.ts). */
export interface Ladder {
  level: SafetyLevel;
  /** a level lighter from the next page on; false: it could not be stored */
  raise: (from: SafetyLevel) => boolean;
}

/** What a recovery or a reset left for this load. */
export interface Waiting {
  snapshot: string;
  /** kept for Qualität's reset to full detail, not for a lost GPU */
  reset: boolean;
}

export type Leaving =
  | { kind: "lighter"; ladder: Ladder } // the failure card's "Leichter weiter"
  | { kind: "reset" }; // Qualität's full detail

export interface RecoverySession {
  /** What waits for this load, without taking it. Before the boot. */
  peek: () => Waiting | null;
  /** The scene is up: what waited is taken (used, or a place picked won). */
  landed: () => void;
  /** The boot failed: what waited goes with it. */
  abandoned: () => void;
  /**
   * The GPU went (`how`); `snapshot` is the place now (null: the page never
   * drew, and the stored one stays). True: the caller reloads. The record
   * is written first, then — for a loss in use — the level raised; a raise
   * that cannot be stored is no reload. False with storage unavailable, or
   * past the caps (lib/city/gpu-recovery.ts `mayRecover`): then the caller
   * says the graphics failed.
   */
  onLoss: (how: GpuLoss, snapshot: string | null, ladder: Ladder) => boolean;
  /**
   * The player asks for a reload; the caller reloads. *Leichter weiter*: a
   * level lighter and back where the player stood, past every cap — the
   * raise first, whatever the store. *Qualität*'s reset: the place kept,
   * marked `reset` so the next page's trail does not call it a lost GPU.
   * Neither adds a reload time: such a page is no recovery. Without
   * storage (or a snapshot) the reload starts at the spawn.
   */
  leave: (leaving: Leaving, snapshot: string | null) => void;
  /**
   * This page follows a recovery (the last reload under two minutes ago):
   * what died before it was the lost GPU, already handled — iOS may
   * interleave a navigation of its own that leaves a trail with nothing but
   * its start (crash-report.tsx does not offer that one).
   */
  followsRecovery: () => boolean;
}

/** The record over `store` (none: every method gives up quietly, and the
 *  lighter way out still raises the level). */
export function createRecoverySession(
  store: Store | null,
  now: () => number = Date.now
): RecoverySession {
  /** The place kept for a reload the caller is about to make. */
  const keepPlace = (snapshot: string | null, reset: boolean) => {
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
  };
  /** What waited, once (the reload times stay). */
  const take = () => {
    if (!store) {
      return;
    }
    try {
      const rest = read(store);
      if (!rest.snapshot) {
        return;
      }
      delete rest.snapshot;
      delete rest.reset;
      store.setItem(KEY, JSON.stringify(rest));
    } catch {
      // Nothing to take.
    }
  };
  return {
    peek: () => {
      if (!store) {
        return null;
      }
      try {
        const stored = read(store);
        return stored.snapshot
          ? { snapshot: stored.snapshot, reset: stored.reset === true }
          : null;
      } catch {
        return null;
      }
    },
    landed: take,
    abandoned: take,
    onLoss: (how, snapshot, ladder) => {
      if (!store) {
        return false;
      }
      const at = now();
      try {
        const stored = read(store);
        const history = historyOf(stored);
        if (!mayRecover(how, ladder.level, history, at)) {
          return false;
        }
        const recent = recentHistory(history, at);
        const next: Stored = {
          tries: [...recent.losses, ...(how === "lost" ? [at] : [])],
          reclaims: [...recent.reclaims, ...(how === "reclaimed" ? [at] : [])],
          failures: [...recent.failures, ...(how === "failed" ? [at] : [])],
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
      return how !== "lost" || ladder.raise(ladder.level);
    },
    leave: (leaving, snapshot) => {
      if (leaving.kind === "lighter") {
        leaving.ladder.raise(leaving.ladder.level);
      }
      keepPlace(snapshot, leaving.kind === "reset");
    },
    followsRecovery: () => {
      if (!store) {
        return false;
      }
      try {
        const { losses, reclaims, failures } = historyOf(read(store));
        const at = now();
        return [...losses, ...reclaims, ...failures].some(
          (t) => at - t < RECENT_MS
        );
      } catch {
        return false;
      }
    },
  };
}

/** This page's session, over session storage (none where it is refused). */
export function pageRecovery(): RecoverySession {
  return createRecoverySession(session());
}
