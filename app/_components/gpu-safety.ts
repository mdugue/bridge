import {
  parseStoredSafety,
  raisedSafety,
  resolveSafety,
  type SafetyLevel,
  safetyOverride,
  type StoredSafety,
} from "@/lib/city/gpu-safety";
import { offerAsCrash, type Trail } from "@/lib/city/crash-trail";
import { pageStillOpen, previousTrail } from "./crash-trail";
import { recentlyRecovered } from "./gpu-recovery";

/**
 * The safety ladder's browser side (the ladder and why it exists:
 * lib/city/gpu-safety.ts): one local-storage key, `gpu-safety`, holding
 * `{ level, raisedAt }` and the start of the crashed page's record that
 * last raised it. Every access may throw (private mode, site data
 * blocked, a full quota): a page that cannot read it runs at level 0, one
 * that cannot write it simply does not get lighter — and does not reload
 * itself after a lost GPU (gpu-recovery.ts).
 */

const KEY = "gpu-safety";

type Store = Pick<Storage, "getItem" | "setItem">;

/** Local storage, or null where reading it throws. */
function local(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function readStored(store: Store | null): StoredSafety | null {
  try {
    return parseStoredSafety(store?.getItem(KEY) ?? null);
  } catch {
    return null;
  }
}

function writeStored(store: Store | null, stored: StoredSafety): boolean {
  if (!store) {
    return false;
  }
  try {
    store.setItem(KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/**
 * The level a page boots at (`search` for `?safety=N`), storing the raise
 * a crashed previous page (`crashed`: its record's start) brings. Pure
 * but for the store.
 */
export function settleSafety(
  search: string,
  store: Store | null,
  crashed: string | null,
  now: number
): SafetyLevel {
  const { level, store: next } = resolveSafety({
    stored: readStored(store),
    previousCrash: crashed,
    override: safetyOverride(search),
    now,
  });
  if (next) {
    writeStored(store, next);
  }
  return level;
}

/**
 * A level lighter from the next page on (a lost GPU, a memory emergency,
 * "Leichter weiter"), above `from`, the level this page runs at. False
 * when it cannot be stored.
 */
export function raiseSafety(
  from: SafetyLevel,
  store: Store | null = local(),
  now = Date.now()
): boolean {
  return writeStored(store, raisedSafety(readStored(store), from, now));
}

/**
 * The previous page's record when it died in use on WebGPU — what the
 * crash trail offers as a crash (offerAsCrash: in view, not a reload of
 * its own) — else null. A WebGL2 page dies of other things.
 */
function crashedBefore(): Trail | null {
  const previous = previousTrail();
  return previous?.backend === "WebGPU" &&
    offerAsCrash(previous, recentlyRecovered())
    ? previous
    : null;
}

/**
 * A record that only looked ended was a page still open in another tab
 * (crash-trail.ts `pageStillOpen`): its raise is taken back, and the
 * record stays counted. Not if anything raised the level since.
 */
function undoIfStillOpen(
  store: Store | null,
  before: StoredSafety | null,
  trail: Trail
): void {
  const raised = readStored(store);
  void pageStillOpen(trail).then((open) => {
    const now = readStored(store);
    if (!(open && raised && now?.raisedAt === raised.raisedAt)) {
      return;
    }
    writeStored(store, {
      ...(before ?? { level: 0, raisedAt: 0 }),
      crash: trail.startedAt,
    });
  });
}

let pageLevel: SafetyLevel | null = null;

/**
 * This page's safety level, worked out once per load (the budget is made
 * from it, city-walk-client.tsx): before the crash trail of this page
 * starts, so the previous page's record is still the one offered.
 */
export function pageSafety(): SafetyLevel {
  if (typeof window === "undefined") {
    return 0;
  }
  if (pageLevel === null) {
    const store = local();
    const before = readStored(store);
    const crashed = crashedBefore();
    pageLevel = settleSafety(
      location.search,
      store,
      crashed?.startedAt ?? null,
      Date.now()
    );
    if (crashed && readStored(store)?.crash !== before?.crash) {
      undoIfStillOpen(store, before, crashed);
    }
  }
  return pageLevel;
}
