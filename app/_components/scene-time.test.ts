import { expect, test } from "bun:test";
import { composeDate, frameGate, splitDate, tweenMinutes } from "./scene-time";

test("a day and a minute compose to a local instant and split back", () => {
  const day = new Date(2026, 11, 21);
  const date = composeDate(day, 8 * 60 + 15);
  expect(date.getHours()).toBe(8);
  expect(date.getMinutes()).toBe(15);
  const parts = splitDate(date);
  expect(parts.minutes).toBe(495);
  expect(parts.day.getTime()).toBe(day.getTime());
});

test("seconds are dropped: the sliders show whole minutes", () => {
  const parts = splitDate(new Date(2026, 5, 1, 23, 59, 40));
  expect(parts.minutes).toBe(23 * 60 + 59);
  expect(parts.day.getDate()).toBe(1);
});

/** A frame clock the test advances by hand. */
function fakeFrames() {
  let next = 1;
  const waiting = new Map<number, () => void>();
  return {
    schedule: (job: () => void) => {
      const handle = next;
      waiting.set(handle, job);
      next += 1;
      return handle;
    },
    unschedule: (handle: number) => {
      waiting.delete(handle);
    },
    frame: () => {
      const due = [...waiting.values()];
      waiting.clear();
      for (const job of due) {
        job();
      }
    },
  };
}

test("a drag's steps reach the scene once a frame, the first at once and the last at the next", () => {
  const frames = fakeFrames();
  let runs = 0;
  const gate = frameGate(
    () => {
      runs += 1;
    },
    frames.schedule,
    frames.unschedule
  );
  gate.request();
  expect(runs).toBe(1);
  gate.request();
  gate.request();
  gate.request();
  expect(runs).toBe(1);
  frames.frame();
  expect(runs).toBe(2);
  // a frame without a request runs nothing, and the next request is at once
  frames.frame();
  expect(runs).toBe(2);
  gate.request();
  expect(runs).toBe(3);
});

test("a cancelled gate drops the step still waiting for its frame", () => {
  const frames = fakeFrames();
  let runs = 0;
  const gate = frameGate(
    () => {
      runs += 1;
    },
    frames.schedule,
    frames.unschedule
  );
  gate.request();
  gate.request();
  gate.cancel();
  frames.frame();
  expect(runs).toBe(1);
  gate.request();
  expect(runs).toBe(2);
});

test("the hour glides as the camera does, in whole minutes, and lands", () => {
  expect(tweenMinutes(600, 990, 0)).toBe(600);
  expect(tweenMinutes(600, 990, 0.5)).toBe(795);
  expect(tweenMinutes(600, 990, 1)).toBe(990);
  // eased: slow at the start, as the glide leaves
  expect(tweenMinutes(600, 990, 0.1)).toBeLessThan(600 + 39);
  // back to an earlier hour, and past the ends held
  expect(tweenMinutes(990, 600, 0.5)).toBe(795);
  expect(tweenMinutes(600, 990, 1.4)).toBe(990);
  expect(tweenMinutes(600, 990, -1)).toBe(600);
  // through the night, not back through the day
  expect(tweenMinutes(22 * 60, 6 * 60, 0.5)).toBe(2 * 60);
  expect(tweenMinutes(22 * 60, 6 * 60, 1)).toBe(6 * 60);
  expect(tweenMinutes(1 * 60, 23 * 60, 0.5)).toBe(0);
});
