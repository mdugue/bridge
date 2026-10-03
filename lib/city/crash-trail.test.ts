import { describe, expect, test } from "bun:test";
import {
  createTrail,
  endedInCrash,
  formatTrail,
  offerAsCrash,
  parseTrail,
  pushBeat,
  pushEvent,
  TRAIL_BEATS,
  TRAIL_EVENTS,
} from "./crash-trail";

const setup = {
  startedAt: "2026-09-28T10:00:00.000Z",
  url: "/",
  userAgent: "iPhone",
  screen: "393×852@3",
};

const beat = (t: number) => ({
  t,
  frames: t * 30,
  fps: 30,
  gpuMB: 180.4,
  calls: 90,
  triangles: 1_200_000,
  cities: 3,
  dressings: 2,
  style: "pastel",
  mode: "walk",
  heightM: 1.7,
});

test("a record starts running, so a page that is killed stays a crash", () => {
  const trail = createTrail(setup);
  expect(trail.state).toBe("running");
  expect(endedInCrash(trail)).toBe(true);
  trail.state = "hidden";
  expect(endedInCrash(trail)).toBe(false);
  trail.state = "clean";
  expect(endedInCrash(trail)).toBe(false);
  expect(endedInCrash(null)).toBe(false);
});

test("events and beats keep only the newest entries", () => {
  const trail = createTrail(setup);
  for (let i = 0; i < TRAIL_EVENTS + 5; i++) {
    pushEvent(trail, { t: i, kind: `e${i}` });
  }
  for (let i = 0; i < TRAIL_BEATS + 3; i++) {
    pushBeat(trail, beat(i));
  }
  expect(trail.events).toHaveLength(TRAIL_EVENTS);
  expect(trail.events[0]?.kind).toBe("e5");
  expect(trail.beats).toHaveLength(TRAIL_BEATS);
  expect(trail.beats.at(-1)?.t).toBe(TRAIL_BEATS + 2);
});

test("a stored record round-trips; anything else is no record", () => {
  const trail = createTrail(setup);
  pushEvent(trail, { t: 1, kind: "style", detail: "paper" });
  expect(parseTrail(JSON.stringify(trail))).toEqual(trail);
  expect(parseTrail(null)).toBeNull();
  expect(parseTrail("{broken")).toBeNull();
  expect(parseTrail(JSON.stringify({ ...trail, v: 0 }))).toBeNull();
});

test("the text names the device, the events and the last beats", () => {
  const trail = createTrail(setup);
  trail.backend = "WebGPU";
  pushEvent(trail, { t: 12.34, kind: "device-lost", detail: "unknown" });
  pushBeat(trail, beat(14));
  const text = formatTrail(trail);
  expect(text).toContain("backend WebGPU");
  expect(text).toContain("12.3s  device-lost  unknown");
  expect(text).toContain("gpu 180MB");
  expect(text).toContain("tiles 3/2");
});

describe("which previous record is offered as a crash", () => {
  const died = (...kinds: string[]) => {
    const trail = createTrail(setup);
    kinds.forEach((kind, i) => pushEvent(trail, { t: i, kind }));
    return trail;
  };

  test("a page that died in use", () => {
    expect(offerAsCrash(died("renderer", "first frame"), false)).toBe(true);
  });

  test("not a page that reloaded itself to recover its GPU", () => {
    const trail = died("first frame", "gpu lost", "reloading");
    expect(offerAsCrash(trail, false)).toBe(false);
    expect(offerAsCrash(trail, true)).toBe(false);
    // the device-lost WebKit reports after the failed frame
    pushEvent(trail, { t: 9, kind: "device-lost" });
    expect(offerAsCrash(trail, true)).toBe(false);
  });

  test("a recovered page that drew long ago and then died is offered", () => {
    const trail = died("renderer", "first frame");
    for (let i = 0; i < TRAIL_EVENTS; i++) {
      pushEvent(trail, { t: 2 + i, kind: "dressings" });
    }
    expect(trail.events.some((e) => e.kind === "first frame")).toBe(false);
    expect(offerAsCrash(trail, true)).toBe(true);
  });

  test("after a recovery, not iOS's own navigation that never drew", () => {
    expect(offerAsCrash(died("renderer"), true)).toBe(false);
  });

  test("a recovered page that drew and then died is offered", () => {
    expect(offerAsCrash(died("renderer", "first frame", "error"), true)).toBe(
      true
    );
  });

  test("not a page that went to the background or left", () => {
    const trail = died("first frame");
    trail.state = "hidden";
    expect(offerAsCrash(trail, false)).toBe(false);
    expect(offerAsCrash(null, false)).toBe(false);
  });
});
