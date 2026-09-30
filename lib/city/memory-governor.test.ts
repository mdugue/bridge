import { expect, test } from "bun:test";
import {
  createMemoryGovernor,
  type MemoryLimits,
  memoryLimitsFor,
} from "./memory-governor";

const MB = 1024 * 1024;
const LIMITS: MemoryLimits = {
  soft: 480 * MB,
  hard: 560 * MB,
  margin: 60 * MB,
  holdMs: 10_000,
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

test("it steps back up only well below the line, and not at once", () => {
  const governor = createMemoryGovernor(LIMITS);
  governor.update(570 * MB, 0);
  // below the hard line, but not by the margin
  expect(governor.update(530 * MB, 20_000)).toBeNull();
  // by the margin, but the step has not held long enough
  const fresh = createMemoryGovernor(LIMITS);
  fresh.update(570 * MB, 0);
  expect(fresh.update(450 * MB, 5000)).toBeNull();
  expect(fresh.update(450 * MB, 10_000)?.level).toBe(1);
  // and one step at a time
  expect(fresh.update(300 * MB, 12_000)).toBeNull();
  expect(fresh.update(300 * MB, 20_000)?.level).toBe(0);
});

test("a phone's lines sit under where its Safari failed; the desktop's far above", () => {
  const phone = memoryLimitsFor("mobile");
  expect(phone.hard).toBeLessThan(720 * MB);
  expect(phone.soft).toBeLessThan(phone.hard);
  expect(memoryLimitsFor("desktop").soft).toBeGreaterThan(phone.hard);
});
