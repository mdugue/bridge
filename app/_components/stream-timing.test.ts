import { expect, test } from "bun:test";
import {
  BOOT_FRAMES,
  bootFrames,
  createStreamTimings,
  traceRequested,
} from "./stream-timing";

/** A clock the test moves by hand. */
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("measures add up by category: count, total and the longest", async () => {
  const clock = fakeClock();
  const timings = createStreamTimings(clock.now);
  timings.timedSync("tile:bvh", () => clock.advance(40), "33412_5656_2_sn");
  timings.timedSync("tile:bvh", () => clock.advance(75), "33414_5656_2_sn");
  await timings.timed("tile:rasters", async () => {
    clock.advance(12);
    return Promise.resolve();
  });
  const start = clock.now();
  clock.advance(5);
  timings.since("dressing:queue-wait", start);
  expect(timings.summary()).toEqual({
    "dressing:queue-wait": { count: 1, totalMs: 5, maxMs: 5 },
    "tile:bvh": { count: 2, totalMs: 115, maxMs: 75 },
    "tile:rasters": { count: 1, totalMs: 12, maxMs: 12 },
  });
});

test("a span that throws is still counted, and the throw goes on", () => {
  const clock = fakeClock();
  const timings = createStreamTimings(clock.now);
  expect(() =>
    timings.timedSync("dressing:build", () => {
      clock.advance(3);
      throw new Error("heap");
    })
  ).toThrow("heap");
  expect(timings.summary()["dressing:build"]).toEqual({
    count: 1,
    totalMs: 3,
    maxMs: 3,
  });
});

test("the tile id goes to the browser's timeline only, never into the summary", () => {
  const clock = fakeClock();
  const timings = createStreamTimings(clock.now);
  const names: string[] = [];
  timings.trace({
    mark: (name) => names.push(name),
    measure: (name) => names.push(name),
  });
  timings.timedSync("tile:compile", () => clock.advance(9), "33412_5656_2_sn");
  timings.markOnce("boot:light-done");
  expect(names).toEqual(["tile:compile 33412_5656_2_sn", "boot:light-done"]);
  expect(JSON.stringify(timings.summary())).not.toMatch(/\d{5}_\d{4}/);
});

test("a timeline that throws (an old WebKit) costs nothing but its entry", () => {
  const clock = fakeClock();
  const timings = createStreamTimings(clock.now);
  timings.trace({
    mark: () => {
      throw new Error("SyntaxError");
    },
    measure: () => {
      throw new Error("SyntaxError");
    },
  });
  timings.markOnce("boot:veil-drop");
  expect(timings.markedAt("boot:veil-drop")).toBe(0);
  timings.since("boot:light-to-veil", 0);
  expect(timings.summary()["boot:light-to-veil"]?.count).toBe(1);
});

test("a mark is set once; the long tasks have a row only where the browser reports them", () => {
  const clock = fakeClock();
  const timings = createStreamTimings(clock.now);
  timings.markOnce("boot:light-done");
  clock.advance(100);
  timings.markOnce("boot:light-done");
  expect(timings.markedAt("boot:light-done")).toBe(0);
  expect(timings.markedAt("boot:veil-drop")).toBeUndefined();
  expect(timings.summary().longtask).toBeUndefined();
  timings.watchLongTasks();
  expect(timings.summary().longtask).toEqual({
    count: 0,
    totalMs: 0,
    maxMs: 0,
  });
  timings.longTask(120);
  timings.longTask(60);
  expect(timings.summary().longtask).toEqual({
    count: 2,
    totalMs: 180,
    maxMs: 120,
  });
});

test("the boot's frames are timed from the placing on: the first with a shadow map once, at most BOOT_FRAMES", () => {
  const clock = fakeClock();
  const timings = createStreamTimings(clock.now);
  const frame = bootFrames(timings);
  const draw = (ms: number, shadow: boolean) => {
    const start = clock.now();
    clock.advance(ms);
    frame(start, shadow);
  };
  draw(500, true); // still under the overlay, before the placing
  timings.markOnce("boot:placed");
  draw(40, false);
  draw(900, true);
  draw(30, true);
  for (let i = 0; i < BOOT_FRAMES; i++) {
    draw(10, false);
  }
  const summary = timings.summary();
  expect(summary["boot:first-shadow-frame"]).toEqual({
    count: 1,
    totalMs: 900,
    maxMs: 900,
  });
  expect(summary["boot:frame"]?.count).toBe(BOOT_FRAMES);
  expect(summary["boot:frame"]?.maxMs).toBe(900);
});

test("the trace is asked for with ?trace=1", () => {
  expect(traceRequested("?scene=lite&trace=1")).toBe(true);
  expect(traceRequested("?trace=0")).toBe(false);
  expect(traceRequested("")).toBe(false);
});
