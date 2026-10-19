import { afterEach, expect, test } from "bun:test";
import { installMainYield } from "./main-yield";

const host = globalThis as unknown as {
  scheduler?: { yield?: () => Promise<void> };
  window?: unknown;
};
const realScheduler = host.scheduler;
// read through a call, so the assignments below do not narrow it
const current = () => host.scheduler;
const realWindow = host.window;

afterEach(() => {
  host.scheduler = realScheduler;
  host.window = realWindow;
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

test("the browser's own scheduler.yield is kept", () => {
  host.window = globalThis;
  const own = () => Promise.resolve();
  host.scheduler = { yield: own };
  installMainYield();
  expect(current()?.yield).toBe(own);
});
