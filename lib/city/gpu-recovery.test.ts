import { expect, test } from "bun:test";
import {
  arrivalOf,
  FAILURE_TRIES,
  mayRecover,
  RECLAIM_WINDOW_MS,
} from "./gpu-recovery";
import type { SafetyLevel } from "./gpu-safety";
import type { Snapshot } from "./snapshot";

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

/** A snapshot with every part a level may hold back (snapshot.test.ts's
 *  `valid`, in Modell). */
const waiting: Snapshot = {
  v: 1,
  camera: {
    mode: "fly",
    pos: { x: 25, y: 140, z: -60 },
    epsg: { x: 412_025, y: 5_657_060 },
    headingDeg: 42,
    pitchDeg: -20,
    fov: 55,
    model: {
      pivot: { x: 120, y: 112, z: -340 },
      preset: "iso",
      scale: 2500,
      tiltDeg: 35.26,
      turnDeg: 45,
    },
  },
  date: "2026-06-21T12:00:00.000Z",
  look: { fogPct: 30, multiTuft: false, style: "comic" },
};

const arrive = (over: Partial<Parameters<typeof arrivalOf>[0]> = {}) =>
  arrivalOf({
    snapshot: waiting,
    reset: false,
    picked: false,
    level: 1,
    ...over,
  });

test("nothing waiting, or a place picked meanwhile: the boot starts as it would", () => {
  const nothing = { snapshot: null, note: null, sayLighter: false };
  expect(arrive({ snapshot: null })).toEqual(nothing);
  expect(arrive({ snapshot: null, reset: true, picked: true })).toEqual(
    nothing
  );
  expect(arrive({ picked: true })).toEqual(nothing);
  expect(arrive({ picked: true, reset: true })).toEqual(nothing);
});

test("a reset to full detail comes back where the player stood, and says nothing", () => {
  const a = arrive({ reset: true, level: 0 });
  expect(a.snapshot?.camera.epsg).toEqual(waiting.camera.epsg);
  expect(a.note).toEqual({
    event: "quality reset",
    detail: "back where the player stood",
  });
  expect(a.sayLighter).toBe(false);
  expect(arrive({ reset: true, level: 2 }).sayLighter).toBe(false);
});

test("a recovery is noted, and says it came back lighter from level 1", () => {
  const at0 = arrive({ level: 0 });
  expect(at0.note).toEqual({ event: "recovered", detail: "after a lost GPU" });
  expect(at0.sayLighter).toBe(false);
  for (const level of [1, 2, 3] as const) {
    expect(arrive({ level }).sayLighter).toBe(true);
  }
});

test("from level 2 the place and the time come back without the picture style and Modell", () => {
  for (const level of [0, 1, 2, 3] as SafetyLevel[]) {
    const s = arrive({ level }).snapshot;
    const keeps = level < 2;
    expect(s?.camera.model === undefined).toBe(!keeps);
    expect(s?.look?.style === undefined).toBe(!keeps);
    expect("model" in (s?.camera ?? {})).toBe(keeps);
    expect("style" in (s?.look ?? {})).toBe(keeps);
    // the rest at every level
    expect(s?.camera.pos).toEqual(waiting.camera.pos);
    expect(s?.camera.headingDeg).toBe(waiting.camera.headingDeg);
    expect(s?.date).toBe(waiting.date);
    expect(s?.look?.fogPct).toBe(30);
    expect(s?.look?.multiTuft).toBe(false);
  }
});

test("the parsed snapshot is not changed: a gated arrival is a new one", () => {
  const before = structuredClone(waiting);
  for (const level of [0, 2] as SafetyLevel[]) {
    arrive({ level });
  }
  const s = arrive({ level: 2 }).snapshot;
  expect(s).not.toBe(waiting);
  expect(s?.camera).not.toBe(waiting.camera);
  expect(waiting).toEqual(before);
});
