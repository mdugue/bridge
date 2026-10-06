/**
 * The safety ladder: how much lighter a device's next page must be, kept
 * across visits (the browser side is app/_components/gpu-safety.ts). An
 * iPhone that lost its GPU booted the recovered page with the very budget
 * that had just failed — the same pixel ratio, shadow map and tile cache,
 * the memory governor back at its first step — and lost the GPU again
 * within a minute, at less memory than the first time, until the recovery
 * gave up.
 *
 * So every sign that a device ran out raises its level by one, kept in the
 * browser: a lost GPU that reloads the page, a previous page that died in
 * use (the crash trail offers it as a crash), a memory emergency in the
 * page (create-app.ts). Each level is a lighter page: a lower pixel-ratio
 * cap, a smaller shadow map and tile cache (scene-profile.ts), lower
 * memory lines and a governor that starts — and stays — further down
 * (memory-governor.ts), no shadow-camera streaming from level 2, and a
 * recovered page that puts back the place and the time but neither the
 * picture style nor Modell from level 2. A level comes back down by
 * itself, one per three days since it was last raised; `?safety=N` sets
 * it for one page (QA) and stores nothing.
 *
 * Also here: the caps on the automatic recovery (one reload per level,
 * gpu-recovery.ts) and where a recovered page starts. Pure: the caller
 * hands it what was stored and the time. No THREE, no DOM.
 */

export type SafetyLevel = 0 | 1 | 2 | 3;

export const SAFETY_LEVELS: readonly SafetyLevel[] = [0, 1, 2, 3];

/** The lightest page there is: a loss there is no reason to reload. */
export const MAX_SAFETY: SafetyLevel = 3;

/** A level falls by one per this long since it was last raised. */
export const SAFETY_DECAY_MS = 3 * 24 * 60 * 60 * 1000;

/** What the browser keeps (one key, app/_components/gpu-safety.ts). */
export interface StoredSafety {
  level: SafetyLevel;
  /** when it was last raised (ms since the epoch) */
  raisedAt: number;
  /**
   * The start of the last crashed page's record that raised it: the same
   * record, seen again by a later page, raises nothing.
   */
  crash?: string;
}

/** The nearest level to `n`. */
export function clampSafety(n: number): SafetyLevel {
  const level = Math.min(MAX_SAFETY, Math.max(0, Math.round(n)));
  return level as SafetyLevel;
}

/** A stored record, or null for anything that is not one. */
export function parseStoredSafety(raw: string | null): StoredSafety | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<StoredSafety> | null;
    if (
      typeof value?.level !== "number" ||
      !Number.isInteger(value.level) ||
      value.level < 0 ||
      value.level > MAX_SAFETY ||
      typeof value.raisedAt !== "number" ||
      !Number.isFinite(value.raisedAt)
    ) {
      return null;
    }
    const stored: StoredSafety = {
      level: value.level,
      raisedAt: value.raisedAt,
    };
    if (typeof value.crash === "string") {
      stored.crash = value.crash;
    }
    return stored;
  } catch {
    return null;
  }
}

/** The stored level at `now`, one lower per SAFETY_DECAY_MS since raised. */
export function decayedSafety(
  stored: StoredSafety | null,
  now: number
): SafetyLevel {
  if (!stored) {
    return 0;
  }
  // A clock set back reads as no time passed, not as a level gained.
  const elapsed = Math.max(0, now - stored.raisedAt);
  return clampSafety(stored.level - Math.floor(elapsed / SAFETY_DECAY_MS));
}

/**
 * The record after a raise: one above the higher of what is stored (as it
 * stands now) and `from`, the level the page runs at — a page on a QA
 * override, or one whose stored level a memory emergency already raised,
 * still ends up above itself.
 */
export function raisedSafety(
  stored: StoredSafety | null,
  from: SafetyLevel,
  now: number
): StoredSafety {
  const level = clampSafety(Math.max(decayedSafety(stored, now), from) + 1);
  const raised: StoredSafety = { level, raisedAt: now };
  if (stored?.crash !== undefined) {
    raised.crash = stored.crash;
  }
  return raised;
}

/** `?safety=N` (0–3) for one page (QA), or null. Pure. */
export function safetyOverride(search: string): SafetyLevel | null {
  const raw = new URLSearchParams(search).get("safety");
  return raw !== null && /^[0-3]$/u.test(raw) ? clampSafety(Number(raw)) : null;
}

export interface SafetyInputs {
  /** what the browser kept, or null */
  stored: StoredSafety | null;
  /**
   * The start of the previous page's record when that page died in use
   * on WebGPU (the crash trail offers it as a crash), else null.
   */
  previousCrash: string | null;
  /** `?safety=N`, or null */
  override: SafetyLevel | null;
  now: number;
}

/**
 * The level a page boots at, and what to store for it (null: nothing). A
 * previous page that died in use raises the level once — the record's
 * start marks it counted. An override is the level, and stores nothing.
 */
export function resolveSafety(inputs: SafetyInputs): {
  level: SafetyLevel;
  store: StoredSafety | null;
} {
  const { stored, previousCrash, override, now } = inputs;
  if (override !== null) {
    return { level: override, store: null };
  }
  if (previousCrash !== null && stored?.crash !== previousCrash) {
    const raised = { ...raisedSafety(stored, 0, now), crash: previousCrash };
    return { level: raised.level, store: raised };
  }
  return { level: decayedSafety(stored, now), store: null };
}

/**
 * Whether the sun's shadow camera streams tiles at a level. From level 2 it
 * never does: it keeps the fine terrain loaded under its whole frustum,
 * tiles in use that no step of the memory governor can free.
 */
export function shadowTilesStream(level: SafetyLevel): boolean {
  return level < 2;
}

/**
 * Whether a page at a level puts back the picture style (the recovery's
 * snapshot, the style the viewer last left) and Modell. From level 2 a
 * page starts in the default picture style and on foot or in the air: a
 * Comic page held 761 MB, a Modell view 699 MB, and putting them back
 * replays the load that took the GPU.
 */
export function restoresLook(level: SafetyLevel): boolean {
  return level < 2;
}

// --- the automatic recovery's caps (gpu-recovery.ts) -----------------------

/**
 * How the GPU went: `lost` — it failed in use (a frame that threw, a device
 * the browser reports lost), which says the page asked too much; or
 * `reclaimed` — iOS took it while the page was in the background, which
 * says nothing about the page.
 */
export type GpuLoss = "lost" | "reclaimed";

/** When the page reloaded itself, per kind (ms since the epoch). */
export interface RecoveryHistory {
  losses: readonly number[];
  reclaims: readonly number[];
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
  };
}

/**
 * Whether the page may reload itself. A loss reloads once per level — the
 * reload is a level lighter — and not from the lightest; a reclaim does
 * not raise the level and has its own cap.
 */
export function mayRecover(
  how: GpuLoss,
  level: SafetyLevel,
  history: RecoveryHistory,
  now: number
): boolean {
  const recent = recentHistory(history, now);
  if (how === "reclaimed") {
    return recent.reclaims.length < RECLAIM_TRIES;
  }
  return level < MAX_SAFETY && recent.losses.length < MAX_SAFETY;
}

// --- where a recovered page starts -------------------------------------------

/**
 * The tile whose extent holds an EPSG point (a recovered page's camera),
 * or undefined off every tile — that page then boots at the spawn.
 */
export function startTileOf<
  T extends { bounds: readonly [number, number, number, number] },
>(
  tiles: readonly T[],
  epsg: { x: number; y: number } | undefined
): T | undefined {
  if (!epsg) {
    return undefined;
  }
  return tiles.find(
    ({ bounds: [x0, y0, x1, y1] }) =>
      epsg.x >= x0 && epsg.x <= x1 && epsg.y >= y0 && epsg.y <= y1
  );
}
