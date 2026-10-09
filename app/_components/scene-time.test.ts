import { expect, test } from "bun:test";
import { composeDate, frameGate, splitDate } from "./scene-time";

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
    schedule: (callback: () => void) => {
      waiting.set(next, callback);
      return next++;
    },
    unschedule: (handle: number) => {
      waiting.delete(handle);
    },
    frame: () => {
      const due = [...waiting.values()];
      waiting.clear();
      for (const callback of due) {
        callback();
      }
    },
  };
}

test("a drag's steps reach the scene once a frame, the first at once and the last at the next", () => {
  const frames = fakeFrames();
  let runs = 0;
  const gate = frameGate(
    () => {
      runs++;
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
      runs++;
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
