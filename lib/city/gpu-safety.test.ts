import { expect, test } from "bun:test";
import {
  decayedSafety,
  mayRecover,
  parseStoredSafety,
  RECLAIM_WINDOW_MS,
  raisedSafety,
  resolveSafety,
  restoresLook,
  SAFETY_DECAY_MS,
  safetyOverride,
  shadowTilesStream,
  startTileOf,
  type StoredSafety,
} from "./gpu-safety";

const DAY = 24 * 60 * 60 * 1000;

/** The boot of one page: its level, and the record it leaves stored. */
function boot(
  stored: StoredSafety | null,
  now: number,
  previousCrash: string | null = null,
  override: ReturnType<typeof safetyOverride> = null
) {
  const { level, store } = resolveSafety({
    stored,
    previousCrash,
    override,
    now,
  });
  return { level, stored: store ?? stored };
}

test("a device that never crashed boots at level 0", () => {
  expect(boot(null, 0).level).toBe(0);
});

test("a previous page that died in use raises the level once per record", () => {
  const first = boot(null, 1000, "2026-10-04T04:26:00Z");
  expect(first.level).toBe(1);
  // the next page sees the same record (it died before writing its own)
  const again = boot(first.stored, 2000, "2026-10-04T04:26:00Z");
  expect(again.level).toBe(1);
  // another page that died raises it again, up to the lightest page
  let { stored } = again;
  for (const [i, start] of ["a", "b", "c", "d"].entries()) {
    stored = boot(stored, 3000 + i, start).stored;
  }
  expect(decayedSafety(stored, 4000)).toBe(3);
});

test("a level falls by one per three days since it was last raised", () => {
  const stored: StoredSafety = { level: 3, raisedAt: 0 };
  expect(decayedSafety(stored, SAFETY_DECAY_MS - 1)).toBe(3);
  expect(decayedSafety(stored, SAFETY_DECAY_MS)).toBe(2);
  expect(decayedSafety(stored, 2 * SAFETY_DECAY_MS + DAY)).toBe(1);
  expect(decayedSafety(stored, 30 * DAY)).toBe(0);
  // a clock set back gains nothing
  expect(decayedSafety(stored, -DAY)).toBe(3);
  // a raise after the decay starts from where the level stands now
  expect(raisedSafety(stored, 0, 2 * SAFETY_DECAY_MS).level).toBe(2);
});

test("a raise ends above the page's own level and keeps the counted crash", () => {
  // a page on ?safety=2 with nothing stored loses its GPU
  expect(raisedSafety(null, 2, 0).level).toBe(3);
  const stored: StoredSafety = { level: 1, raisedAt: 0, crash: "x" };
  expect(raisedSafety(stored, 0, 10)).toEqual({
    level: 2,
    raisedAt: 10,
    crash: "x",
  });
});

test("?safety=N sets one page's level and stores nothing", () => {
  expect(safetyOverride("?safety=2")).toBe(2);
  expect(safetyOverride("?scene=lite&safety=0")).toBe(0);
  for (const search of [
    "",
    "?safety=4",
    "?safety=-1",
    "?safety=1.5",
    "?safety=",
  ]) {
    expect(safetyOverride(search)).toBeNull();
  }
  const stored: StoredSafety = { level: 3, raisedAt: 0 };
  expect(
    resolveSafety({ stored, previousCrash: "y", override: 0, now: 1 })
  ).toEqual({ level: 0, store: null });
});

test("a stored record that is not one counts as nothing stored", () => {
  for (const raw of [
    null,
    "",
    "not json",
    "null",
    '{"level":7,"raisedAt":0}',
    '{"level":1.5,"raisedAt":0}',
    '{"level":1}',
    '{"level":1,"raisedAt":"yesterday"}',
  ]) {
    expect(parseStoredSafety(raw)).toBeNull();
  }
  expect(parseStoredSafety('{"level":2,"raisedAt":5,"crash":"z"}')).toEqual({
    level: 2,
    raisedAt: 5,
    crash: "z",
  });
});

test("a lost GPU reloads once per level, never from the lightest page", () => {
  const none = { losses: [], reclaims: [] };
  expect(mayRecover("lost", 0, none, 0)).toBe(true);
  expect(mayRecover("lost", 2, none, 0)).toBe(true);
  expect(mayRecover("lost", 3, none, 0)).toBe(false);
  // the tab's own net: a page whose level cannot rise (an override) stops
  // after as many reloads as there are levels
  const three = { losses: [0, 60_000, 120_000], reclaims: [] };
  expect(mayRecover("lost", 0, three, 180_000)).toBe(false);
  expect(mayRecover("lost", 0, three, 700_000)).toBe(true);
});

test("a background reclaim reloads under its own cap, whatever the level", () => {
  const reclaims = [0, 1000, 2000];
  expect(mayRecover("reclaimed", 3, { losses: [], reclaims: [] }, 0)).toBe(
    true
  );
  expect(mayRecover("reclaimed", 0, { losses: [], reclaims }, 3000)).toBe(
    false
  );
  expect(
    mayRecover("reclaimed", 0, { losses: [], reclaims }, RECLAIM_WINDOW_MS)
  ).toBe(true);
  // losses do not use up the reclaims' cap, nor the other way round
  expect(
    mayRecover("reclaimed", 0, { losses: [0, 1, 2], reclaims: [] }, 3)
  ).toBe(true);
  expect(mayRecover("lost", 0, { losses: [], reclaims }, 3000)).toBe(true);
});

test("from level 2 the shadow camera streams nothing and the look starts plain", () => {
  expect([0, 1, 2, 3].map((l) => shadowTilesStream(l as 0))).toEqual([
    true,
    true,
    false,
    false,
  ]);
  expect([0, 1, 2, 3].map((l) => restoresLook(l as 0))).toEqual([
    true,
    true,
    false,
    false,
  ]);
});

test("a recovered page starts on the tile under its camera, off every tile at the spawn", () => {
  const tiles = [
    {
      id: "spawn",
      bounds: [0, 0, 2000, 2000] as [number, number, number, number],
    },
    {
      id: "east",
      bounds: [2000, 0, 4000, 2000] as [number, number, number, number],
    },
  ];
  expect(startTileOf(tiles, { x: 3500, y: 100 })?.id).toBe("east");
  expect(startTileOf(tiles, { x: 5000, y: 100 })).toBeUndefined();
  expect(startTileOf(tiles, undefined)).toBeUndefined();
});
