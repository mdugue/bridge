import { expect, test } from "bun:test";
import { createSliceStore, dataEqual } from "./slice-store";

interface Slices {
  fps: number | null;
  busy: boolean;
  hour: { time: string; factor: number } | null;
}

const INITIAL: Slices = { fps: null, busy: false, hour: null };

/** A schedule the test runs by hand: what a task boundary would. */
function manualSchedule() {
  const queued: (() => void)[] = [];
  return {
    schedule: (flush: () => void) => {
      queued.push(flush);
    },
    queued,
    run: () => {
      for (const flush of queued.splice(0)) {
        flush();
      }
    },
  };
}

test("a write is read back at once, and the slice keeps its value until one changes it", () => {
  const store = createSliceStore(INITIAL);
  expect(store.get("fps")).toBeNull();
  expect(store.set("fps", 30)).toBe(true);
  expect(store.get("fps")).toBe(30);
  const hour = { time: "14:00", factor: 1 };
  store.set("hour", hour);
  expect(store.get("hour")).toBe(hour);
  // the initial object is copied, not written through
  expect(INITIAL.fps).toBeNull();
});

test("a write equal to the slice's value notifies no one", () => {
  const store = createSliceStore(INITIAL);
  const seen: boolean[] = [];
  store.subscribe("busy", (v) => seen.push(v));
  expect(store.set("busy", false)).toBe(false);
  store.set("busy", true);
  store.set("busy", true);
  expect(seen).toEqual([true]);
});

test("a slice's equality decides what counts as unchanged", () => {
  const store = createSliceStore(INITIAL, { equals: { hour: dataEqual } });
  const seen: unknown[] = [];
  store.subscribe("hour", (v) => seen.push(v));
  const first = { time: "14:00", factor: 1 };
  store.set("hour", first);
  // rebuilt with the same numbers: the same report, and the same object kept
  expect(store.set("hour", { time: "14:00", factor: 1 })).toBe(false);
  expect(store.get("hour")).toBe(first);
  store.set("hour", { time: "14:01", factor: 1 });
  expect(seen).toHaveLength(2);
});

test("a write reaches only its own slice's listeners", () => {
  const store = createSliceStore(INITIAL);
  const fps: unknown[] = [];
  const busy: unknown[] = [];
  store.subscribe("fps", (v) => fps.push(v));
  store.subscribe("busy", (v) => busy.push(v));
  store.set("fps", 60);
  expect(fps).toEqual([60]);
  expect(busy).toEqual([]);
});

test("with a schedule, a burst of writes is heard once per slice, after the task, with the last value", () => {
  const clock = manualSchedule();
  const store = createSliceStore(INITIAL, { schedule: clock.schedule });
  const fps: unknown[] = [];
  const busy: unknown[] = [];
  store.subscribe("fps", (v) => fps.push(v));
  store.subscribe("busy", (v) => busy.push(v));
  store.set("fps", 10);
  store.set("fps", 20);
  store.set("busy", true);
  store.set("fps", 30);
  // read back at once, heard later — one flush for the whole burst
  expect(store.get("fps")).toBe(30);
  expect(fps).toEqual([]);
  expect(clock.queued).toHaveLength(1);
  clock.run();
  expect(fps).toEqual([30]);
  expect(busy).toEqual([true]);
  // nothing written since: nothing to hear
  clock.run();
  expect(fps).toEqual([30]);
  store.set("fps", 30);
  expect(clock.queued).toHaveLength(0);
});

test("a listener may unsubscribe itself or another while the slice is heard", () => {
  const store = createSliceStore(INITIAL);
  const seen: string[] = [];
  const stopB = store.subscribe("busy", () => seen.push("b"));
  const stopA = store.subscribe("busy", () => {
    seen.push("a");
    stopA();
    stopB();
  });
  store.subscribe("busy", () => seen.push("c"));
  store.set("busy", true);
  // everyone subscribed at the write hears it once
  expect(seen.sort()).toEqual(["a", "b", "c"]);
  seen.length = 0;
  store.set("busy", false);
  expect(seen).toEqual(["c"]);
});

test("a listener that throws keeps no one else in its burst from hearing, and its error still surfaces", () => {
  const clock = manualSchedule();
  const store = createSliceStore(INITIAL, { schedule: clock.schedule });
  const heard: string[] = [];
  store.subscribe("busy", () => {
    throw new Error("listener failed");
  });
  store.subscribe("busy", () => heard.push("busy"));
  store.subscribe("fps", () => heard.push("fps"));
  // one burst, the throwing listener's slice written first
  store.set("busy", true);
  store.set("fps", 30);
  expect(clock.run).toThrow("listener failed");
  expect(heard).toEqual(["busy", "fps"]);
  // the store schedules the next burst as before
  store.set("fps", 31);
  expect(clock.queued).toHaveLength(1);
  // without a schedule: the write stands, its other listeners hear it
  const direct = createSliceStore(INITIAL);
  const seen: boolean[] = [];
  direct.subscribe("busy", () => {
    throw new Error("listener failed");
  });
  direct.subscribe("busy", (v) => seen.push(v));
  expect(() => direct.set("busy", true)).toThrow("listener failed");
  expect(direct.get("busy")).toBe(true);
  expect(seen).toEqual([true]);
});

test("update makes the next value from the current one", () => {
  const store = createSliceStore(INITIAL);
  store.set("fps", 1);
  expect(store.update("fps", (n) => (n ?? 0) + 1)).toBe(true);
  expect(store.get("fps")).toBe(2);
  expect(store.update("fps", (n) => n)).toBe(false);
});

test("dataEqual compares plain data by value", () => {
  expect(dataEqual(1, 1)).toBe(true);
  expect(dataEqual(Number.NaN, Number.NaN)).toBe(true);
  expect(dataEqual(null, null)).toBe(true);
  expect(dataEqual(null, {})).toBe(false);
  expect(
    dataEqual({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 })
  ).toBe(true);
  expect(dataEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(dataEqual({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
  expect(dataEqual([1], { 0: 1 })).toBe(false);
  expect(dataEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
});

test("dataEqual counts a date, a map, a set or an instance equal only to itself", () => {
  // none of them has own keys that carry its value: compared key by key,
  // any two would be the same, and a slice holding one would never change
  expect(dataEqual(new Date(1), new Date(2))).toBe(false);
  expect(dataEqual(new Map([["a", 1]]), new Map())).toBe(false);
  expect(dataEqual(new Set([1]), new Set([2]))).toBe(false);
  expect(dataEqual({ at: new Date(1) }, { at: new Date(2) })).toBe(false);
  const at = new Date(1);
  expect(dataEqual({ at }, { at })).toBe(true);
  class Point {
    constructor(readonly x: number) {}
  }
  expect(dataEqual(new Point(1), new Point(1))).toBe(false);
  // an object without a prototype is still plain data
  expect(
    dataEqual(Object.assign(Object.create(null), { a: 1 }), { a: 1 })
  ).toBe(true);
});
