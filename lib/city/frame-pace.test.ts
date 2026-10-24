import { describe, expect, test } from "bun:test";
import {
  COVERED_FPS,
  createFramePace,
  createStillness,
  SCROLL_QUIET_MS,
  STILL_FPS,
} from "./frame-pace";

const FRAME = 1000 / 60;

/** How many of `n` 60 Hz frames from `start` the pace draws. */
function drawn(
  pace: ReturnType<typeof createFramePace>,
  start: number,
  n = 60
) {
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (pace.draws(start + i * FRAME)) {
      count++;
    }
  }
  return count;
}

describe("frame pace", () => {
  test("an uncovered scene draws every frame, scroll or not", () => {
    const pace = createFramePace();
    pace.noteScroll(0);
    expect(drawn(pace, 0)).toBe(60);
    expect(pace.takePaced()).toBe(false);
  });

  test("a covered scene draws at its rate", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    expect(drawn(pace, 0)).toBe(COVERED_FPS);
    expect(pace.takePaced()).toBe(true);
    expect(pace.takePaced()).toBe(false);
  });

  test("a covered scene holds still while its cover scrolls", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.noteScroll(0);
    expect(drawn(pace, 0, Math.floor(SCROLL_QUIET_MS / FRAME))).toBe(0);
    // quiet again: back at the covered rate
    expect(pace.draws(SCROLL_QUIET_MS)).toBe(true);
  });

  test("uncovering ends a hold at once", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.noteScroll(0);
    pace.setCovered(false);
    expect(pace.draws(FRAME)).toBe(true);
    // a scroll while uncovered holds nothing once covered again
    pace.noteScroll(2 * FRAME);
    pace.setCovered(true);
    expect(pace.draws(1000)).toBe(true);
  });

  test("a frame after held ones says so; the next one in a row does not", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    expect(pace.draws(0)).toBe(true);
    expect(pace.heldBefore()).toBe(false);
    expect(pace.draws(FRAME)).toBe(false);
    expect(pace.draws(100)).toBe(true);
    expect(pace.heldBefore()).toBe(true);
    pace.setCovered(false);
    expect(pace.draws(100 + FRAME)).toBe(true);
    expect(pace.heldBefore()).toBe(false);
  });
});

describe("still pace", () => {
  test("a still scene draws at its rate, every second frame at 60 Hz", () => {
    const pace = createFramePace();
    pace.setStill(true);
    expect(drawn(pace, 0)).toBe(STILL_FPS);
    expect(pace.takePaced()).toBe(true);
  });

  test("every fourth frame at 120 Hz", () => {
    const pace = createFramePace();
    pace.setStill(true);
    let count = 0;
    for (let i = 0; i < 120; i++) {
      if (pace.draws(i * (1000 / 120))) {
        count++;
      }
    }
    expect(count).toBe(STILL_FPS);
  });

  test("a woken scene draws the very next frame", () => {
    const pace = createFramePace();
    pace.setStill(true);
    expect(pace.draws(0)).toBe(true);
    expect(pace.draws(FRAME)).toBe(false);
    pace.setStill(false);
    expect(pace.draws(2 * FRAME)).toBe(true);
    expect(pace.heldBefore()).toBe(true);
    expect(pace.draws(3 * FRAME)).toBe(true);
    expect(pace.heldBefore()).toBe(false);
  });

  test("covered and still: the slower of the two", () => {
    const pace = createFramePace();
    pace.setStill(true);
    pace.setCovered(true);
    expect(drawn(pace, 0)).toBe(COVERED_FPS);
  });
});

describe("stillness", () => {
  test("is still once nothing moved for its time", () => {
    const still = createStillness(1000);
    expect(still.frame(0, false)).toBe(false);
    expect(still.frame(500, false)).toBe(false);
    expect(still.frame(1000, false)).toBe(true);
    expect(still.frame(1100, true)).toBe(false);
    expect(still.frame(2050, false)).toBe(false);
    expect(still.frame(2100, false)).toBe(true);
  });

  test("input wakes it", () => {
    const still = createStillness(1000);
    still.frame(0, false);
    expect(still.frame(1500, false)).toBe(true);
    still.wake(1600);
    expect(still.frame(1616, false)).toBe(false);
    expect(still.frame(2600, false)).toBe(true);
  });
});
