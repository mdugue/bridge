import { afterEach, expect, jest, test } from "bun:test";
import { installMainYield, whenIdle } from "./main-yield";

const host = globalThis as unknown as {
  scheduler?: { yield?: () => Promise<void>; postTask?: unknown };
  window?: unknown;
  requestIdleCallback?: unknown;
  cancelIdleCallback?: unknown;
};
const realScheduler = host.scheduler;
// read through a call, so the assignments below do not narrow it
const current = () => host.scheduler;
const realWindow = host.window;

const realIdle = [host.requestIdleCallback, host.cancelIdleCallback];

afterEach(() => {
  host.scheduler = realScheduler;
  host.window = realWindow;
  [host.requestIdleCallback, host.cancelIdleCallback] = realIdle;
  jest.useRealTimers();
});

test("a browser without scheduler.yield gets one that resolves without a frame", async () => {
  host.window = globalThis;
  host.scheduler = undefined;
  installMainYield();
  const yieldNow = current()?.yield;
  if (!yieldNow) {
    throw new Error("no scheduler.yield installed");
  }
  // each resolves after the task it gave the loop back to, in order
  const order: number[] = [];
  const first = yieldNow().then(() => order.push(1));
  const second = yieldNow().then(() => order.push(2));
  order.push(0);
  await first;
  await second;
  expect(order).toEqual([0, 1, 2]);
});

const own = async () => {};

test("the browser's own scheduler.yield is kept", () => {
  host.window = globalThis;
  host.scheduler = { yield: own };
  installMainYield();
  expect(current()?.yield).toBe(own);
});

// The scene's worker has no requestIdleCallback, and WebKit's no
// scheduler.postTask either: the idle work (tile-stream's ask sets) must
// still run, and a tile that leaves must still cancel it.
test("with neither idle API the work runs after a short timer, and is cancelled", () => {
  jest.useFakeTimers();
  host.requestIdleCallback = undefined;
  host.scheduler = undefined;
  let ran = 0;
  whenIdle(() => {
    ran += 1;
  }, 1000);
  jest.advanceTimersByTime(249);
  expect(ran).toBe(0);
  jest.advanceTimersByTime(1);
  expect(ran).toBe(1);
  const cancel = whenIdle(() => {
    ran += 1;
  }, 1000);
  cancel();
  jest.advanceTimersByTime(1000);
  expect(ran).toBe(1);
});

test("in a worker a background task runs the work once, at the latest its timeout", () => {
  jest.useFakeTimers();
  host.requestIdleCallback = undefined;
  const tasks: {
    task: () => void;
    opts: { priority: string; signal: AbortSignal };
  }[] = [];
  host.scheduler = {
    postTask: async (
      task: () => void,
      opts: { priority: string; signal: AbortSignal }
    ) => {
      tasks.push({ task, opts });
    },
  };
  let ran = 0;
  whenIdle(() => {
    ran += 1;
  }, 1000);
  expect(tasks.map((t) => t.opts.priority)).toEqual(["background"]);
  tasks[0]?.task();
  jest.advanceTimersByTime(1000);
  expect(ran).toBe(1);
  // a busy worker never runs it: the timeout does, and aborts the task
  whenIdle(() => {
    ran += 1;
  }, 1000);
  jest.advanceTimersByTime(1000);
  expect(ran).toBe(2);
  expect(tasks[1]?.opts.signal.aborted).toBe(true);
  tasks[1]?.task();
  expect(ran).toBe(2);
  // cancelled before either
  const cancel = whenIdle(() => {
    ran += 1;
  }, 1000);
  cancel();
  tasks[2]?.task();
  jest.advanceTimersByTime(1000);
  expect(ran).toBe(2);
});

test("with requestIdleCallback the work waits for idle, at the latest its timeout", () => {
  const asked: { timeout?: number }[] = [];
  const cancelled: number[] = [];
  let idle: (() => void) | null = null;
  host.requestIdleCallback = (fn: () => void, opts: { timeout?: number }) => {
    idle = fn;
    asked.push(opts);
    return 7;
  };
  host.cancelIdleCallback = (id: number) => cancelled.push(id);
  let ran = 0;
  const cancel = whenIdle(() => {
    ran += 1;
  }, 1000);
  expect(asked).toEqual([{ timeout: 1000 }]);
  expect(ran).toBe(0);
  (idle as (() => void) | null)?.();
  expect(ran).toBe(1);
  cancel();
  expect(cancelled).toEqual([7]);
});
