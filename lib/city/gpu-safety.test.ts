import { expect, test } from "bun:test";
import {
  decayedSafety,
  FAILURE_TRIES,
  frameLoss,
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

test("a page raises once per incident: its lost GPU renews its emergency's raise", () => {
  // the emergency of the page started at "A", running at level 1
  const emergency = raisedSafety({ level: 1, raisedAt: 0 }, 1, 10, "A");
  expect(emergency).toEqual({ level: 2, raisedAt: 10, raisedBy: "A" });
  // the loss that follows on the same page: still a level above the page
  expect(raisedSafety(emergency, 1, 20, "A")).toEqual({
    level: 2,
    raisedAt: 20,
    raisedBy: "A",
  });
  // a loss with no emergency before it raises by one, as ever
  expect(raisedSafety({ level: 1, raisedAt: 0 }, 1, 20, "A").level).toBe(2);
  // another page's raise, or a request on top (Leichter weiter), adds one
  expect(raisedSafety(emergency, 1, 20, "B").level).toBe(3);
  expect(raisedSafety(emergency, 1, 20).level).toBe(3);
});

test("a page that died after raising the level itself raises nothing more", () => {
  const stored: StoredSafety = { level: 2, raisedAt: 0, raisedBy: "A" };
  expect(boot(stored, 10, "A")).toEqual({
    level: 2,
    stored: { level: 2, raisedAt: 0, raisedBy: "A", crash: "A" },
  });
  // another page that died is a crash of its own
  expect(boot(stored, 10, "B").level).toBe(3);
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
  expect(
    parseStoredSafety('{"level":2,"raisedAt":5,"raisedBy":"y","crash":7}')
  ).toEqual({ level: 2, raisedAt: 5, raisedBy: "y" });
});

test("a lost GPU reloads once per level, never from the lightest page", () => {
  const none = { losses: [], reclaims: [], failures: [] };
  expect(mayRecover("lost", 0, none, 0)).toBe(true);
  expect(mayRecover("lost", 2, none, 0)).toBe(true);
  expect(mayRecover("lost", 3, none, 0)).toBe(false);
  // the tab's own net: a page whose level cannot rise (an override) stops
  // after as many reloads as there are levels
  const three = { losses: [0, 60_000, 120_000], reclaims: [], failures: [] };
  expect(mayRecover("lost", 0, three, 180_000)).toBe(false);
  expect(mayRecover("lost", 0, three, 700_000)).toBe(true);
});

test("a background reclaim reloads under its own cap, whatever the level", () => {
  const reclaims = [0, 1000, 2000];
  const none = { losses: [], reclaims: [], failures: [] };
  expect(mayRecover("reclaimed", 3, none, 0)).toBe(true);
  expect(mayRecover("reclaimed", 0, { ...none, reclaims }, 3000)).toBe(false);
  expect(
    mayRecover("reclaimed", 0, { ...none, reclaims }, RECLAIM_WINDOW_MS)
  ).toBe(true);
  // losses do not use up the reclaims' cap, nor the other way round
  expect(mayRecover("reclaimed", 0, { ...none, losses: [0, 1, 2] }, 3)).toBe(
    true
  );
  expect(mayRecover("lost", 0, { ...none, reclaims }, 3000)).toBe(true);
});

test("a failed frame reloads twice in ten minutes, at any level", () => {
  const none = { losses: [], reclaims: [], failures: [] };
  expect(mayRecover("failed", 3, none, 0)).toBe(true);
  const failures = Array.from({ length: FAILURE_TRIES }, (_, i) => i);
  expect(mayRecover("failed", 0, { ...none, failures }, 60_000)).toBe(false);
  expect(mayRecover("failed", 0, { ...none, failures }, 600_000)).toBe(true);
  // a bug uses up no loss reload, nor a loss a bug's
  expect(mayRecover("lost", 0, { ...none, failures }, 60_000)).toBe(true);
  expect(mayRecover("failed", 0, { ...none, losses: [0, 1, 2] }, 3)).toBe(true);
});

test("a frame that throws on a GPU that still answers is a bug, not a loss", () => {
  const signs = { allocation: false, emergency: false, answers: () => true };
  expect(frameLoss("lost", signs)).toBe("failed");
  // what says the GPU ran out
  expect(frameLoss("lost", { ...signs, allocation: true })).toBe("lost");
  expect(frameLoss("lost", { ...signs, emergency: true })).toBe("lost");
  expect(frameLoss("lost", { ...signs, answers: () => false })).toBe("lost");
  // a reclaim stays one, and is not probed
  let probed = false;
  const answers = () => {
    probed = true;
    return true;
  };
  expect(frameLoss("reclaimed", { ...signs, answers })).toBe("reclaimed");
  expect(probed).toBe(false);
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
