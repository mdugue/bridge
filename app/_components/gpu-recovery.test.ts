import { expect, test } from "bun:test";
import { arrivalOf } from "@/lib/city/gpu-recovery";
import { parseSnapshot } from "@/lib/city/snapshot";
import type { SafetyLevel } from "@/lib/city/gpu-safety";
import { createRecoverySession, pageRecovery } from "./gpu-recovery";
import type { Ladder } from "./gpu-recovery";
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
      raises += 1;
      return raiseSafety(from, { store: local, now: 0 });
    },
    next: () => settleSafety("", local, null, 0),
    raises: () => raises,
  };
}

/** A session over a store of its own, on a clock the test sets. */
function sessionAt() {
  const store = memoryStore();
  const clock = { t: 0 };
  return { store, clock, session: createRecoverySession(store, () => clock.t) };
}

const at = (level: SafetyLevel, raise: Ladder["raise"]): Ladder => ({
  level,
  raise,
});

test("a lost GPU reloads where the player stood, and the next load puts it back once", () => {
  const { session, clock } = sessionAt();
  const { raise } = ladder();
  expect(session.onLoss("lost", '{"camera":1}', at(0, raise))).toBe(true);
  // a boot that is aborted before its first frame leaves it for the next
  expect(session.peek()).toEqual({ snapshot: '{"camera":1}', reset: false });
  session.landed();
  expect(session.peek()).toBeNull();
  // the page after it knows it followed a recovery, for two minutes
  clock.t = 60_000;
  expect(session.followsRecovery()).toBe(true);
  clock.t = 121_000;
  expect(session.followsRecovery()).toBe(false);
});

test("each reload after a loss is a level lighter, and the lightest shows the message", () => {
  const { session, clock } = sessionAt();
  const pages = ladder();
  // every page loses its GPU a minute after its boot, at its own level
  for (const page of [0, 1, 2]) {
    const level = pages.next();
    expect(level).toBe(page as SafetyLevel);
    clock.t = page * 60_000;
    expect(session.onLoss("lost", null, at(level, pages.raise))).toBe(true);
  }
  expect(pages.next()).toBe(3);
  clock.t = 180_000;
  expect(session.onLoss("lost", null, at(3, pages.raise))).toBe(false);
  expect(pages.raises()).toBe(3);
});

test("a level that cannot be stored means no reload: the next page would be no lighter", () => {
  const { session } = sessionAt();
  expect(
    session.onLoss(
      "lost",
      "{}",
      at(0, () => false)
    )
  ).toBe(false);
  // the record was written before the raise
  expect(session.peek()?.snapshot).toBe("{}");
});

test("a GPU reclaimed in the background reloads at the same level, three times in half an hour", () => {
  const { session, clock } = sessionAt();
  const pages = ladder();
  for (const t of [0, 60_000, 120_000]) {
    clock.t = t;
    expect(session.onLoss("reclaimed", "{}", at(3, pages.raise))).toBe(true);
  }
  clock.t = 180_000;
  expect(session.onLoss("reclaimed", "{}", at(3, pages.raise))).toBe(false);
  expect(pages.next()).toBe(0);
  // half an hour after the first, one more
  clock.t = 1_800_001;
  expect(session.onLoss("reclaimed", "{}", at(3, pages.raise))).toBe(true);
  // and a reclaim counts as a recovery for the page after it
  clock.t = 1_800_002;
  expect(session.followsRecovery()).toBe(true);
});

test("a frame that failed on a working GPU reloads at the same level, twice in ten minutes", () => {
  const { session, clock } = sessionAt();
  const pages = ladder();
  for (const t of [0, 60_000]) {
    clock.t = t;
    expect(session.onLoss("failed", "{}", at(0, pages.raise))).toBe(true);
  }
  clock.t = 120_000;
  expect(session.onLoss("failed", "{}", at(0, pages.raise))).toBe(false);
  // a bug never makes the device lighter
  expect(pages.raises()).toBe(0);
  expect(pages.next()).toBe(0);
  expect(session.followsRecovery()).toBe(true);
  // ten minutes on, the next one may reload again
  clock.t = 600_001;
  expect(session.onLoss("failed", "{}", at(0, pages.raise))).toBe(true);
});

test("a page lost before its first frame keeps the place it booted at for the next", () => {
  const { session, clock } = sessionAt();
  const { raise } = ladder();
  session.onLoss("lost", '{"camera":1}', at(0, raise));
  // the recovered page boots there, and loses its GPU before it drew:
  // it has no camera of its own to give
  expect(session.peek()?.snapshot).toBe('{"camera":1}');
  clock.t = 1000;
  expect(session.onLoss("lost", null, at(1, raise))).toBe(true);
  expect(session.peek()?.snapshot).toBe('{"camera":1}');
});

test("Leichter weiter raises the level and keeps the place past every cap", () => {
  const { session, clock } = sessionAt();
  const pages = ladder();
  pages.raise(1);
  expect(session.onLoss("lost", "{}", at(2, pages.raise))).toBe(true);
  clock.t = 1;
  expect(session.onLoss("lost", "{}", at(3, pages.raise))).toBe(false);
  session.leave(
    { kind: "lighter", ladder: at(2, pages.raise) },
    '{"camera":2}'
  );
  expect(pages.next()).toBe(3);
  expect(session.peek()?.snapshot).toBe('{"camera":2}');
});

test("a reset to full detail keeps the place for the reload, and is no recovery", () => {
  const { session } = sessionAt();
  session.leave({ kind: "reset" }, '{"camera":3}');
  expect(session.peek()).toEqual({ snapshot: '{"camera":3}', reset: true });
  expect(session.followsRecovery()).toBe(false);
  // landing takes it, the mark with it
  session.landed();
  expect(session.peek()).toBeNull();
  // Leichter weiter after it is a lost GPU's again
  session.leave({ kind: "reset" }, '{"camera":3}');
  session.leave(
    { kind: "lighter", ladder: at(0, ladder().raise) },
    '{"camera":4}'
  );
  expect(session.peek()).toEqual({ snapshot: '{"camera":4}', reset: false });
});

test("without storage it gives up rather than reloading blind", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  const session = createRecoverySession(broken);
  const { raise } = ladder();
  expect(session.onLoss("lost", "{}", at(0, raise))).toBe(false);
  expect(session.onLoss("reclaimed", "{}", at(0, raise))).toBe(false);
});

test("with site data blocked, reading session storage throws: every method gives up quietly", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  try {
    const pages = ladder();
    const session = pageRecovery();
    expect(session.onLoss("lost", "{}", at(0, pages.raise))).toBe(false);
    expect(session.followsRecovery()).toBe(false);
    expect(session.peek()).toBeNull();
    expect(() => session.landed()).not.toThrow();
    expect(() => session.abandoned()).not.toThrow();
    expect(() =>
      session.leave({ kind: "lighter", ladder: at(0, pages.raise) }, "{}")
    ).not.toThrow();
    expect(() => session.leave({ kind: "reset" }, "{}")).not.toThrow();
    // the lighter way out still raises the level
    expect(pages.raises()).toBe(1);
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

// --- the boot's sequences ---

/** A snapshot as the HUD encodes one (lib/city/snapshot.ts). */
const PLACE = JSON.stringify({
  v: 1,
  camera: {
    mode: "walk",
    pos: { x: 0, y: 2, z: 0 },
    epsg: { x: 412_000, y: 5_657_000 },
    headingDeg: 0,
    pitchDeg: 0,
    fov: 60,
  },
  date: "2026-06-21T12:00:00.000Z",
});

test("StrictMode: a boot aborted between the peek and its first frame leaves the place for the next", () => {
  const { session } = sessionAt();
  session.onLoss("lost", PLACE, at(0, ladder().raise));
  const first = session.peek();
  // (the first boot is aborted: it commits nothing)
  expect(session.peek()).toEqual(first);
  session.landed();
  expect(session.peek()).toBeNull();
});

test("a place picked meanwhile wins: no snapshot, no note, and the stored one goes", () => {
  const { session, clock } = sessionAt();
  session.onLoss("lost", PLACE, at(0, ladder().raise));
  const waiting = session.peek();
  expect(waiting).not.toBeNull();
  const parsed = parseSnapshot(waiting?.snapshot ?? "");
  expect(parsed.ok).toBe(true);
  const arrival = arrivalOf({
    snapshot: parsed.ok ? parsed.snapshot : null,
    reset: waiting?.reset ?? false,
    picked: true,
    level: 1,
  });
  expect(arrival).toEqual({ snapshot: null, note: null, sayLighter: false });
  session.landed();
  expect(session.peek()).toBeNull();
  // the reload times stay
  clock.t = 1000;
  expect(session.followsRecovery()).toBe(true);
});

test("a failed boot drops the snapshot, and the reload times stay", () => {
  const { session } = sessionAt();
  session.onLoss("reclaimed", PLACE, at(0, ladder().raise));
  expect(session.peek()).not.toBeNull();
  session.abandoned();
  expect(session.peek()).toBeNull();
  expect(session.followsRecovery()).toBe(true);
});

test("a loss after a reset mark clears the mark", () => {
  const { session } = sessionAt();
  session.leave({ kind: "reset" }, PLACE);
  expect(session.peek()?.reset).toBe(true);
  session.onLoss("reclaimed", PLACE, at(0, ladder().raise));
  expect(session.peek()?.reset).toBe(false);
});

test("a snapshot that does not parse is taken once the scene is up", () => {
  const { session } = sessionAt();
  session.onLoss("reclaimed", '{"v":99}', at(0, ladder().raise));
  expect(session.peek()?.snapshot).toBe('{"v":99}');
  session.landed();
  expect(session.peek()).toBeNull();
});
