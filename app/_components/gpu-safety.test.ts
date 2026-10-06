import { expect, test } from "bun:test";
import { SAFETY_DECAY_MS } from "@/lib/city/gpu-safety";
import { raiseSafety, settleSafety } from "./gpu-safety";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

test("a raise is kept for the next pages, and wears off over days", () => {
  const store = memoryStore();
  expect(settleSafety("", store, null, 0)).toBe(0);
  expect(raiseSafety(0, store, 1000)).toBe(true);
  expect(settleSafety("", store, null, 2000)).toBe(1);
  expect(raiseSafety(1, store, 3000)).toBe(true);
  expect(settleSafety("", store, null, 4000)).toBe(2);
  expect(settleSafety("", store, null, 3000 + SAFETY_DECAY_MS)).toBe(1);
  expect(settleSafety("", store, null, 3000 + 2 * SAFETY_DECAY_MS)).toBe(0);
});

test("a crashed previous page raises the level once, however often it is seen", () => {
  const store = memoryStore();
  expect(settleSafety("", store, "2026-10-04T04:26:00Z", 0)).toBe(1);
  expect(settleSafety("", store, "2026-10-04T04:26:00Z", 10)).toBe(1);
  // a raise in between keeps the record counted
  raiseSafety(1, store, 20);
  expect(settleSafety("", store, "2026-10-04T04:26:00Z", 30)).toBe(2);
});

test("?safety=N runs the page at N and stores nothing", () => {
  const store = memoryStore();
  expect(settleSafety("?safety=3", store, "crashed", 0)).toBe(3);
  expect(store.map.size).toBe(0);
});

test("a browser that cannot store keeps nothing: a crash lightens only the page that saw it", () => {
  const broken = {
    getItem: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
    setItem: () => {
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError"
      );
    },
  };
  expect(settleSafety("", broken, "crashed", 0)).toBe(1);
  expect(settleSafety("", broken, null, 0)).toBe(0);
  expect(raiseSafety(0, broken, 0)).toBe(false);
  expect(raiseSafety(0, null, 0)).toBe(false);
});
