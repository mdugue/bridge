import { expect, test } from "bun:test";
import {
  finished,
  inRuns,
  inSlices,
  onlyWhile,
  REST_SLICE_MS,
  SLICE_MS,
  setSliceBudget,
  type Steps,
} from "./build-steps";

function* counted(n: number, log: number[]): Steps<number> {
  for (let i = 0; i < n; i++) {
    log.push(i);
    yield;
  }
  return n;
}

test("finished runs every step at once", () => {
  const log: number[] = [];
  expect(finished(counted(4, log))).toBe(4);
  expect(log).toEqual([0, 1, 2, 3]);
});

test("inSlices gives the thread back once a slice has run its time", async () => {
  const log: number[] = [];
  // each step takes 3 "ms": a slice of 8 holds three
  let t = 0;
  const now = () => {
    t += 1;
    return t;
  };
  let pauses = 0;
  const steps = counted(9, log);
  const run = inSlices(steps, { sliceMs: 8, now });
  // the first slice ran before the first pause
  pauses = log.length;
  expect(pauses).toBeGreaterThan(0);
  expect(pauses).toBeLessThan(9);
  expect(await run).toBe(9);
  expect(log).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("inRuns calls the function per run and keeps the order", () => {
  const runs: number[][] = [];
  const out = finished(
    inRuns([1, 2, 3, 4, 5], 2, (run) => {
      runs.push(run);
      return run.map((v) => v * 10);
    })
  );
  expect(runs).toEqual([[1, 2], [3, 4], [5]]);
  expect(out).toEqual([10, 20, 30, 40, 50]);
});

test("onlyWhile stops where it is told and leaves the rest to another driver", () => {
  const log: number[] = [];
  const steps = counted(5, log);
  let go = true;
  const outer = onlyWhile(steps, () => go);
  outer.next();
  outer.next();
  expect(log).toEqual([0, 1]);
  go = false;
  expect(outer.next()).toEqual({ done: true, value: undefined });
  expect(finished(steps)).toBe(5);
  expect(log).toEqual([0, 1, 2, 3, 4]);
});

test("inSlices stops at the first pause after its signal fires", async () => {
  const log: number[] = [];
  const aborter = new AbortController();
  let t = 0;
  const run = inSlices(counted(100, log), {
    sliceMs: 2,
    now: () => t++,
    signal: aborter.signal,
  });
  aborter.abort();
  let thrown: unknown = null;
  try {
    await run;
  } catch (err) {
    thrown = err;
  }
  expect((thrown as Error).name).toBe("AbortError");
  expect(log.length).toBeLessThan(100);
});

test("inSlices takes the budget the scene set", async () => {
  // a clock that ticks 1 ms a read: the first slice holds as many steps
  // as its budget has milliseconds
  const firstSlice = async (ms: number, holdsMs?: number) => {
    setSliceBudget(ms, holdsMs);
    const log: number[] = [];
    let t = 0;
    const run = inSlices(counted(100, log), { now: () => t++ });
    const steps = log.length;
    await run;
    return steps;
  };
  const moving = await firstSlice(SLICE_MS);
  const resting = await firstSlice(REST_SLICE_MS);
  // a budget no frame renewed is gone: the short slices again
  const lapsed = await firstSlice(REST_SLICE_MS, -1);
  setSliceBudget(SLICE_MS);
  expect(moving).toBe(SLICE_MS);
  expect(resting).toBe(REST_SLICE_MS);
  expect(lapsed).toBe(SLICE_MS);
});
