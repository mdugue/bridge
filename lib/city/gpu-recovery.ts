/**
 * The automatic recovery's caps and where a recovered page starts (ADR
 * 0047): how often a page that lost its GPU may reload itself, per kind of
 * loss, and what of the place it left comes back at which safety level.
 * The record itself — the snapshot and the reload times in session
 * storage — is app/_components/gpu-recovery.ts's. Pure: the caller hands
 * it what was stored and the time. No THREE, no DOM.
 */
import { MAX_SAFETY, restoresLook } from "./gpu-safety";
import type { GpuLoss, SafetyLevel } from "./gpu-safety";
import type { Snapshot } from "./snapshot";

/** When the page reloaded itself, per kind (ms since the epoch). */
export interface RecoveryHistory {
  losses: readonly number[];
  reclaims: readonly number[];
  failures: readonly number[];
}

/**
 * The tab's own net under the ladder: no more loss reloads than there are
 * levels in this window — a page whose level cannot rise (`?safety=N`)
 * would otherwise reload for ever.
 */
export const LOSS_WINDOW_MS = 600_000;
/** At most this many reloads after a reclaim in RECLAIM_WINDOW_MS. */
export const RECLAIM_TRIES = 3;
export const RECLAIM_WINDOW_MS = 1_800_000;
/**
 * At most this many reloads after a failed frame in LOSS_WINDOW_MS: the
 * recovery's old cap — a bug that comes back with the place shows the card.
 */
export const FAILURE_TRIES = 2;

const within = (times: readonly number[], windowMs: number, now: number) =>
  times.filter((t) => now - t < windowMs);

/** The history without the reloads too long ago to count. */
export function recentHistory(
  history: RecoveryHistory,
  now: number
): RecoveryHistory {
  return {
    losses: within(history.losses, LOSS_WINDOW_MS, now),
    reclaims: within(history.reclaims, RECLAIM_WINDOW_MS, now),
    failures: within(history.failures, LOSS_WINDOW_MS, now),
  };
}

/**
 * Whether the page may reload itself. A loss reloads once per level — the
 * reload is a level lighter — and not from the lightest; a reclaim and a
 * failed frame do not raise the level and have caps of their own.
 */
export function mayRecover(
  how: GpuLoss,
  level: SafetyLevel,
  history: RecoveryHistory,
  now: number
): boolean {
  const recent = recentHistory(history, now);
  switch (how) {
    case "reclaimed": {
      return recent.reclaims.length < RECLAIM_TRIES;
    }
    case "failed": {
      return recent.failures.length < FAILURE_TRIES;
    }
    case "lost": {
      return level < MAX_SAFETY && recent.losses.length < MAX_SAFETY;
    }
    default: {
      const unknown: never = how;
      throw new Error(`unknown GPU loss: ${String(unknown)}`);
    }
  }
}

/** Where this load starts, and what it says once the scene is up. */
export interface Arrival {
  /**
   * The snapshot the boot starts from: its time and look go back before
   * the boot (the HUD's `prepare`), its camera is the boot's
   * `initialCamera` and is applied again after the first frame. Gated by
   * the level (`restoresLook`): from level 2 without the picture style
   * and without Modell. Null when nothing waited, it did not parse, or a
   * place was picked meanwhile (the player's time and look stay theirs).
   */
  snapshot: Snapshot | null;
  /** the trail's note once the scene is up, or null */
  note:
    | { event: "recovered"; detail: "after a lost GPU" }
    | { event: "quality reset"; detail: "back where the player stood" }
    | { event: "view link"; detail: "opened at a linked view" }
    | null;
  /** the HUD says "Mit weniger Details neu geladen" (a recovery, level ≥ 1) */
  sayLighter: boolean;
}

/** A snapshot as this level puts it back: below level 2 (`restoresLook`)
 *  the parsed one itself, from it a new one without the picture style and
 *  without Modell — the parsed one untouched. */
function gated(snapshot: Snapshot, level: SafetyLevel): Snapshot {
  if (restoresLook(level)) {
    return snapshot;
  }
  const { model: _model, ...camera } = snapshot.camera;
  const out: Snapshot = { ...snapshot, camera };
  if (snapshot.look) {
    const { style: _style, ...look } = snapshot.look;
    out.look = look;
  }
  return out;
}

/**
 * Where a page starts that a recovery or a reset left a snapshot for:
 * nothing when none waited or it did not parse, nor when a place was
 * picked meanwhile (the player's choice wins); else the snapshot as the
 * level gates it, the trail's note — a reset to full detail, or a
 * recovery — and, for a recovery onto a lighter page, the HUD's word.
 * With nothing waiting, the view the page's link names (`?snap=`,
 * lib/city/snapshot.ts), gated the same way: a recovery wins over the
 * link, which a reload keeps in the address.
 */
export function arrivalOf(inputs: {
  /** the waiting one, parsed by the HUD */
  snapshot: Snapshot | null;
  /** it waited for Qualität's reset */
  reset: boolean;
  /** a place was picked meanwhile */
  picked: boolean;
  /** this page's safety level */
  level: SafetyLevel;
  /** the view link's snapshot, parsed by the HUD */
  linked?: Snapshot | null;
}): Arrival {
  const { snapshot, reset, picked, level, linked } = inputs;
  if (picked) {
    return { snapshot: null, note: null, sayLighter: false };
  }
  if (!snapshot) {
    return linked
      ? {
          snapshot: gated(linked, level),
          note: { event: "view link", detail: "opened at a linked view" },
          sayLighter: false,
        }
      : { snapshot: null, note: null, sayLighter: false };
  }
  return reset
    ? {
        snapshot: gated(snapshot, level),
        note: { event: "quality reset", detail: "back where the player stood" },
        sayLighter: false,
      }
    : {
        snapshot: gated(snapshot, level),
        note: { event: "recovered", detail: "after a lost GPU" },
        sayLighter: level > 0,
      };
}
