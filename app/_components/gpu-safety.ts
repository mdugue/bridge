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
import { STORAGE_KEYS } from "./storage-keys";

/**
 * The safety ladder's browser side (the ladder and why it exists:
 * lib/city/gpu-safety.ts): one local-storage key, `gpu-safety`, holding
 * `{ level, raisedAt }`, the start of the crashed page's record that last
 * raised it and of the page that last raised it in use. Every access may
 * throw (private mode, site data blocked, a full quota): a page that
 * cannot read it runs at level 0, one that cannot write it simply does not
 * get lighter — and does not reload itself after a lost GPU
 * (gpu-recovery.ts).
 */

const KEY = STORAGE_KEYS.gpuSafety;

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

export interface RaiseOptions {
  /**
   * The raising page's record start (crash-trail.ts): a raise in use, once
   * per incident — the loss after this page's own memory emergency renews
   * that raise instead of adding one, and the page's death raises nothing
   * more on the next load (lib/city/gpu-safety.ts `raisedSafety`). Without
   * it, a raise on top (*Leichter weiter*).
   */
  by?: string;
  store?: Store | null;
  now?: number;
}

/**
 * A level lighter from the next page on (a lost GPU, a memory emergency,
 * "Leichter weiter"), above `from`, the level this page runs at. False
 * when it cannot be stored.
 */
export function raiseSafety(
  from: SafetyLevel,
  { by, store = local(), now = Date.now() }: RaiseOptions = {}
): boolean {
  return writeStored(store, raisedSafety(readStored(store), from, now, by));
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
 * The level a page boots at once a previous record that looks crashed
 * (`crashed`) has had its chance to answer (`stillOpen`): a record that
 * only looked ended is a page still open in another tab (crash-trail.ts
 * `pageStillOpen`) — no crash, no raise, and nothing marked counted: the
 * next load asks again.
 */
export async function settleAfterAsking(
  search: string,
  store: Store | null,
  crashed: Trail | null,
  stillOpen: (trail: Trail) => Promise<boolean>,
  now: () => number = Date.now
): Promise<SafetyLevel> {
  const open = crashed ? await stillOpen(crashed) : false;
  return settleSafety(
    search,
    store,
    open ? null : (crashed?.startedAt ?? null),
    now()
  );
}

let pageLevel: Promise<SafetyLevel> | null = null;

/**
 * This page's safety level, worked out once per load (the budget is made
 * from it, city-walk-client.tsx): the previous page's record is read
 * before the crash trail of this page starts, so it is still the one
 * offered; the level settles once that page had its chance to say it is
 * still open (up to 250 ms, beside the manifest's fetch — and only for a
 * record that looks crashed).
 */
export function pageSafety(): Promise<SafetyLevel> {
  if (typeof window === "undefined") {
    return Promise.resolve(0);
  }
  pageLevel ??= settleAfterAsking(
    location.search,
    local(),
    crashedBefore(),
    pageStillOpen
  );
  return pageLevel;
}
