import { expect, test } from "bun:test";
import type { SafetyLevel } from "@/lib/city/gpu-safety";
import {
  peekRecoverySnapshot,
  recentlyRecovered,
  recoverFromGpuLoss,
  recoverOnRequest,
  takeRecoverySnapshot,
} from "./gpu-recovery";
import { raiseSafety, settleSafety } from "./gpu-safety";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

/**
 * The safety level as the pages keep it (gpu-safety.ts): `raise` stores a
 * level lighter, `next()` is the level the next page boots at.
 */
function ladder() {
  const local = memoryStore();
  let raises = 0;
  return {
    raise: (from: SafetyLevel) => {
      raises++;
      return raiseSafety(from, local, 0);
    },
    next: () => settleSafety("", local, null, 0),
    raises: () => raises,
  };
}

test("a lost GPU reloads where the player stood, and the next load puts it back once", () => {
  const store = memoryStore();
  const { raise } = ladder();
  expect(recoverFromGpuLoss("lost", '{"camera":1}', 0, raise, store, 0)).toBe(
    true
  );
  // a boot that is aborted before its first frame leaves it for the next
  expect(peekRecoverySnapshot(store)).toBe('{"camera":1}');
  expect(takeRecoverySnapshot(store)).toBe('{"camera":1}');
  expect(takeRecoverySnapshot(store)).toBeNull();
  expect(peekRecoverySnapshot(store)).toBeNull();
  // the page after it knows it followed a recovery, for two minutes
  expect(recentlyRecovered(store, 60_000)).toBe(true);
  expect(recentlyRecovered(store, 121_000)).toBe(false);
});

test("each reload after a loss is a level lighter, and the lightest shows the message", () => {
  const store = memoryStore();
  const pages = ladder();
  // every page loses its GPU a minute after its boot, at its own level
  for (const page of [0, 1, 2]) {
    const level = pages.next();
    expect(level).toBe(page as SafetyLevel);
    expect(
      recoverFromGpuLoss("lost", null, level, pages.raise, store, page * 60_000)
    ).toBe(true);
  }
  expect(pages.next()).toBe(3);
  expect(recoverFromGpuLoss("lost", null, 3, pages.raise, store, 180_000)).toBe(
    false
  );
  expect(pages.raises()).toBe(3);
});

test("a level that cannot be stored means no reload: the next page would be no lighter", () => {
  const store = memoryStore();
  expect(recoverFromGpuLoss("lost", "{}", 0, () => false, store, 0)).toBe(
    false
  );
});

test("a GPU reclaimed in the background reloads at the same level, three times in half an hour", () => {
  const store = memoryStore();
  const pages = ladder();
  for (const t of [0, 60_000, 120_000]) {
    expect(
      recoverFromGpuLoss("reclaimed", "{}", 3, pages.raise, store, t)
    ).toBe(true);
  }
  expect(
    recoverFromGpuLoss("reclaimed", "{}", 3, pages.raise, store, 180_000)
  ).toBe(false);
  expect(pages.next()).toBe(0);
  // half an hour after the first, one more
  expect(
    recoverFromGpuLoss("reclaimed", "{}", 3, pages.raise, store, 1_800_001)
  ).toBe(true);
  // and a reclaim counts as a recovery for the page after it
  expect(recentlyRecovered(store, 1_800_002)).toBe(true);
});

test("Leichter weiter raises the level and keeps the place past every cap", () => {
  const store = memoryStore();
  const pages = ladder();
  pages.raise(1);
  expect(recoverFromGpuLoss("lost", "{}", 2, pages.raise, store, 0)).toBe(true);
  expect(recoverFromGpuLoss("lost", "{}", 3, pages.raise, store, 1)).toBe(
    false
  );
  recoverOnRequest('{"camera":2}', 2, pages.raise, store);
  expect(pages.next()).toBe(3);
  expect(takeRecoverySnapshot(store)).toBe('{"camera":2}');
});

test("without storage it gives up rather than reloading blind", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  const { raise } = ladder();
  expect(recoverFromGpuLoss("lost", "{}", 0, raise, broken)).toBe(false);
  expect(recoverFromGpuLoss("reclaimed", "{}", 0, raise, broken)).toBe(false);
});

test("with site data blocked, reading session storage throws: all of them give up quietly", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  try {
    const { raise } = ladder();
    expect(recoverFromGpuLoss("lost", "{}", 0, raise)).toBe(false);
    expect(recentlyRecovered()).toBe(false);
    expect(peekRecoverySnapshot()).toBeNull();
    expect(takeRecoverySnapshot()).toBeNull();
    expect(() => recoverOnRequest("{}", 0, raise)).not.toThrow();
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
