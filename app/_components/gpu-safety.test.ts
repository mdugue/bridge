import { expect, test } from "bun:test";
import { createTrail, type Trail } from "@/lib/city/crash-trail";
import { SAFETY_DECAY_MS } from "@/lib/city/gpu-safety";
import { raiseSafety, settleAfterAsking, settleSafety } from "./gpu-safety";

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
  expect(raiseSafety(0, { store, now: 1000 })).toBe(true);
  expect(settleSafety("", store, null, 2000)).toBe(1);
  expect(raiseSafety(1, { store, now: 3000 })).toBe(true);
  expect(settleSafety("", store, null, 4000)).toBe(2);
  expect(settleSafety("", store, null, 3000 + SAFETY_DECAY_MS)).toBe(1);
  expect(settleSafety("", store, null, 3000 + 2 * SAFETY_DECAY_MS)).toBe(0);
});

test("one incident raises the level once: the emergency, then the loss or the death it foretold", () => {
  const store = memoryStore();
  const page = "2026-10-06T08:00:00.000Z";
  // the page at level 0 runs out of memory, then loses its GPU
  raiseSafety(0, { by: page, store, now: 10 });
  raiseSafety(0, { by: page, store, now: 20 });
  expect(settleSafety("", store, null, 30)).toBe(1);
  // or Safari kills it: the next load sees its record as a crash
  expect(settleSafety("", store, page, 30)).toBe(1);
  // the card's Leichter weiter asks for a level on top
  raiseSafety(0, { store, now: 40 });
  expect(settleSafety("", store, null, 50)).toBe(2);
});

test("a crashed previous page raises the level once, however often it is seen", () => {
  const store = memoryStore();
  expect(settleSafety("", store, "2026-10-04T04:26:00Z", 0)).toBe(1);
  expect(settleSafety("", store, "2026-10-04T04:26:00Z", 10)).toBe(1);
  // a raise in between keeps the record counted
  raiseSafety(1, { store, now: 20 });
  expect(settleSafety("", store, "2026-10-04T04:26:00Z", 30)).toBe(2);
});

test("a previous record whose page answers is no crash: the level stays", async () => {
  const store = memoryStore();
  raiseSafety(0, { store, now: 0 });
  const live = createTrail({
    startedAt: "2026-10-06T08:00:00.000Z",
    url: "/dresden",
    userAgent: "test",
    screen: "1×1@1",
  });
  const asked: string[] = [];
  const open = (trail: Trail) => {
    asked.push(trail.startedAt);
    return Promise.resolve(true);
  };
  const now = () => 10;
  expect(await settleAfterAsking("", store, live, open, now)).toBe(1);
  expect(asked).toEqual([live.startedAt]);
  // not marked counted: the next load asks again, and a page gone by
  // then is the crash it looked like
  const gone = () => Promise.resolve(false);
  expect(await settleAfterAsking("", store, live, gone, now)).toBe(2);
  // nothing to ask without a crashed-looking record
  expect(await settleAfterAsking("", store, null, open, now)).toBe(2);
  expect(asked).toHaveLength(1);
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
  expect(raiseSafety(0, { store: broken, now: 0 })).toBe(false);
  expect(raiseSafety(0, { store: null, now: 0 })).toBe(false);
});
