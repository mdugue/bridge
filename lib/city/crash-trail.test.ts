import { describe, expect, test } from "bun:test";
import {
  createTrail,
  endedInCrash,
  firstAt,
  formatTrail,
  offerAsCrash,
  parseTrail,
  pushBeat,
  pushEvent,
  TRAIL_BEATS,
  TRAIL_EVENTS,
  trailPhase,
} from "./crash-trail";

const setup = {
  startedAt: "2026-09-28T10:00:00.000Z",
  url: "/",
  userAgent: "iPhone",
  screen: "393×852@3",
};

const beat = (t: number, fps = 30) => ({
  t,
  frames: t * 30,
  fps,
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

test("a page loaded in the background is no crash when it is killed there", () => {
  const trail = createTrail({ ...setup, hidden: true });
  pushEvent(trail, { t: 0, kind: "start" });
  pushBeat(trail, beat(2)); // the loop's frames while out of view
  expect(endedInCrash(trail)).toBe(false);
  expect(offerAsCrash(trail, false)).toBe(false);
  expect(trail.stats?.beats).toBe(0);
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
  expect(text).toContain("page 1 beats, mean 30fps");
  expect(text).toContain("12.3s  device-lost  unknown");
  expect(text).toContain("gpu 180MB");
  expect(text).toContain("tiles 3/2");
});

test("the page's stats count only the beats rendered in view", () => {
  const trail = createTrail(setup);
  pushBeat(trail, { ...beat(1, 0), frames: 0 }); // before the first frame
  pushBeat(trail, beat(2, 8));
  pushBeat(trail, { ...beat(3, 50), heldMB: 640, heapMB: 210 });
  trail.state = "hidden";
  pushBeat(trail, { ...beat(4, 0), heldMB: 900 }); // a paused loop
  trail.state = "running";
  pushBeat(trail, beat(5, 25));
  expect(trail.stats).toEqual({
    beats: 3,
    fpsSum: 83,
    fps: [1, 0, 1, 0, 1],
    maxGpuMB: 180.4,
    maxHeldMB: 640,
    maxHeapMB: 210,
  });
  // The ring still holds every beat, for the report's last seconds.
  expect(trail.beats).toHaveLength(5);
});

test("the boot's milestones outlive the event ring", () => {
  const trail = createTrail(setup);
  pushEvent(trail, { t: 3.5, kind: "first frame" });
  for (let i = 0; i < TRAIL_EVENTS; i++) {
    pushEvent(trail, { t: 4 + i, kind: "style" });
  }
  expect(trail.events.some((e) => e.kind === "first frame")).toBe(false);
  expect(firstAt(trail, "first frame")).toBe(3.5);
  expect(firstAt(trail, "style")).toBe(4);
  // An older record without `firsts` still answers from its ring.
  const older = createTrail(setup);
  older.events.push({ t: 2, kind: "loaded" });
  delete older.firsts;
  expect(firstAt(older, "loaded")).toBe(2);
});

test("the phase says how far the page got", () => {
  const trail = createTrail(setup);
  expect(trailPhase(trail)).toBe("boot");
  pushEvent(trail, { t: 1, kind: "stage buildings" });
  pushEvent(trail, { t: 2, kind: "stage terrain" });
  expect(trailPhase(trail)).toBe("boot after terrain");
  pushEvent(trail, { t: 3, kind: "first frame" });
  expect(trailPhase(trail)).toBe("streaming");
  pushEvent(trail, { t: 9, kind: "loaded" });
  expect(trailPhase(trail)).toBe("running");
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

  test("a recovery page that died in its boot is offered: the loop", () => {
    // its buildings landed, then it died before the first frame
    expect(offerAsCrash(died("start", "stage buildings"), true)).toBe(true);
    // its loop rendered, then it died before any stage was done
    const rendered = died("start");
    pushBeat(rendered, { ...beat(2), frames: 40 });
    expect(offerAsCrash(rendered, true)).toBe(true);
    // a beat before the loop drew anything is still nothing but its start
    const idle = died("start");
    pushBeat(idle, { ...beat(2), frames: 0 });
    expect(offerAsCrash(idle, true)).toBe(false);
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
