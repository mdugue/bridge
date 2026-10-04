import { expect, test } from "bun:test";
import {
  createMemoryGovernor,
  MEMORY_STEPS,
  type MemoryLimits,
  memoryLimitsFor,
} from "./memory-governor";

const MB = 1024 * 1024;
const LIMITS: MemoryLimits = {
  soft: 480 * MB,
  hard: 560 * MB,
  margin: 60 * MB,
  holdMs: 10_000,
  retryMs: 120_000,
};

test("the detail steps down at each line, and holds below it", () => {
  const governor = createMemoryGovernor(LIMITS);
  expect(governor.update(400 * MB, 0)).toBeNull();
  expect(governor.update(490 * MB, 1000)?.level).toBe(1);
  expect(governor.update(500 * MB, 2000)).toBeNull();
  expect(governor.update(570 * MB, 3000)?.level).toBe(2);
  expect(governor.step().errorScale).toBeGreaterThan(1);
  expect(governor.step().minScale).toBeLessThan(1);
});

test("a jump past the hard line takes both steps at once", () => {
  const governor = createMemoryGovernor(LIMITS);
  expect(governor.update(700 * MB, 0)?.level).toBe(2);
});

test("level 2 that held with the memory still past its line takes the last step", () => {
  const governor = createMemoryGovernor(LIMITS);
  expect(governor.update(640 * MB, 0)?.level).toBe(2);
  // still past the line, but level 2 has not held yet
  expect(governor.update(700 * MB, 5000)).toBeNull();
  expect(governor.update(760 * MB, 10_000)?.level).toBe(3);
  expect(governor.step().errorScale).toBeGreaterThan(
    MEMORY_STEPS[2].errorScale
  );
  expect(governor.step().minScale).toBeLessThan(MEMORY_STEPS[2].minScale);
  // there is no further step
  expect(governor.update(760 * MB, 30_000)).toBeNull();
});

test("level 2 that brought the memory under its line is not followed by the last", () => {
  const governor = createMemoryGovernor(LIMITS);
  governor.update(640 * MB, 0);
  expect(governor.update(540 * MB, 10_000)).toBeNull();
  expect(governor.update(550 * MB, 60_000)).toBeNull();
  expect(governor.step().level).toBe(2);
});

test("the last step comes back one step at a time, well below the hard line", () => {
  const governor = createMemoryGovernor(LIMITS);
  governor.update(600 * MB, 0);
  governor.update(600 * MB, 10_000);
  // the last step frees 200 MB while it holds
  governor.update(400 * MB, 15_000);
  // under the hard line, but undoing the step would cross it again
  expect(governor.update(400 * MB, 30_000)).toBeNull();
  // on to a lighter view
  expect(governor.update(250 * MB, 40_000)?.level).toBe(2);
  expect(governor.update(250 * MB, 45_000)).toBeNull();
  expect(governor.update(250 * MB, 50_000)?.level).toBe(1);
});

test("it steps back up only well below the line, and not at once", () => {
  const governor = createMemoryGovernor(LIMITS);
  governor.update(570 * MB, 0);
  // below the hard line, but not by the margin
  expect(governor.update(530 * MB, 20_000)).toBeNull();
  // by the margin, but the step has not held long enough
  const fresh = createMemoryGovernor(LIMITS);
  fresh.update(570 * MB, 0);
  expect(fresh.update(450 * MB, 5000)).toBeNull();
  // (the step freed 120 MB, and 300 MB sits below the line with it back)
  expect(fresh.update(300 * MB, 10_000)?.level).toBe(1);
  // and one step at a time
  expect(fresh.update(250 * MB, 12_000)).toBeNull();
  expect(fresh.update(250 * MB, 20_000)?.level).toBe(0);
});

test("a phone's lines sit under where its Safari failed; the desktop's far above", () => {
  const phone = memoryLimitsFor("mobile");
  expect(phone.hard).toBeLessThan(720 * MB);
  expect(phone.soft).toBeLessThan(phone.hard);
  expect(memoryLimitsFor("desktop").soft).toBeGreaterThan(phone.hard);
});

test("a camera standing still does not step back up into what it gave up", () => {
  const governor = createMemoryGovernor(LIMITS);
  expect(governor.update(490 * MB, 0)?.level).toBe(1);
  // the fine tile gives way to the coarse one: the step freed 100 MB
  governor.update(430 * MB, 2000);
  governor.update(390 * MB, 4000);
  // well below the line, but undoing the step would cross it again
  for (let t = 10_000; t < 60_000; t += 2000) {
    expect(governor.update(390 * MB, t)).toBeNull();
  }
  // flying on to a lighter view, it steps up at once
  expect(governor.update(300 * MB, 60_000)?.level).toBe(0);
});

test("what a step freed is forgotten after a while: the step up is tried again", () => {
  const governor = createMemoryGovernor(LIMITS);
  governor.update(490 * MB, 0);
  governor.update(390 * MB, 4000);
  expect(governor.update(390 * MB, 60_000)).toBeNull();
  expect(governor.update(390 * MB, 120_000)?.level).toBe(0);
});
