import { describe, expect, test } from "bun:test";
import {
  COVERED_FPS,
  COVERED_TAIL_MS,
  createFramePace,
  createStillness,
  LISTENING_FPS,
  LISTENING_MOVING_FPS,
  STILL_AFTER_MS,
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
  for (let i = 0; i < n; i += 1) {
    if (pace.draws(start + i * FRAME)) {
      count += 1;
    }
  }
  return count;
}

describe("frame pace", () => {
  test("an uncovered scene draws every frame", () => {
    const pace = createFramePace();
    expect(drawn(pace, 0)).toBe(60);
    expect(pace.takePaced()).toBe(false);
  });

  test("a covered, still scene draws nothing it was not asked for", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.setStill(true);
    expect(drawn(pace, 0)).toBe(0);
    expect(pace.takePaced()).toBe(true);
    expect(pace.takePaced()).toBe(false);
  });

  test("asked, a covered scene draws at its rate for a while, then stops", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.setStill(true);
    pace.wake();
    const tail = Math.floor(COVERED_TAIL_MS / FRAME);
    const n = drawn(pace, 0, tail);
    expect(n).toBeGreaterThanOrEqual(
      Math.floor((COVERED_TAIL_MS / 1000) * COVERED_FPS)
    );
    expect(n).toBeLessThanOrEqual(
      Math.ceil((COVERED_TAIL_MS / 1000) * COVERED_FPS) + 1
    );
    expect(drawn(pace, tail * FRAME + FRAME, 60)).toBe(0);
  });

  test("a covered ask ends no stillness: a still scene stops after the tail", () => {
    // the loop: the pace decides, a drawn frame tells the stillness
    const pace = createFramePace();
    const stillness = createStillness();
    pace.setCovered(true);
    stillness.frame(0, false);
    pace.setStill(stillness.frame(STILL_AFTER_MS, false));
    const at = 2 * STILL_AFTER_MS;
    if (pace.wake()) {
      stillness.wake(at);
    }
    let last = Number.NaN;
    for (let i = 0; i < 120; i += 1) {
      const now = at + i * FRAME;
      if (pace.draws(now)) {
        last = now;
        pace.setStill(stillness.frame(now, false));
      }
    }
    expect(last - at).toBeLessThan(COVERED_TAIL_MS);
    // (its last frame lies within a covered frame of its end)
    expect(last - at).toBeGreaterThan(COVERED_TAIL_MS - 1000 / COVERED_FPS - 1);
  });

  test("a covered ask that starts a move draws as long as it moves", () => {
    const pace = createFramePace();
    const stillness = createStillness();
    pace.setCovered(true);
    stillness.frame(0, false);
    pace.setStill(stillness.frame(STILL_AFTER_MS, false));
    const at = 2 * STILL_AFTER_MS;
    expect(pace.wake()).toBe(false);
    // a glide of 1.5 s: the camera moves in every frame drawn
    let last = Number.NaN;
    for (let i = 0; i < 240; i += 1) {
      const now = at + i * FRAME;
      if (pace.draws(now)) {
        last = now;
        pace.setStill(stillness.frame(now, now - at < 1500));
      }
    }
    expect(last - at).toBeGreaterThan(1500 + STILL_AFTER_MS - 100);
  });

  test("covered, still and listened to: an ask draws its tail at the covered rate", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.setStill(true);
    pace.setListening(true);
    pace.wake();
    expect(drawn(pace, 0, 30)).toBe(COVERED_FPS / 2);
  });

  test("an uncovered ask ends the stillness, a covered one does not", () => {
    const pace = createFramePace();
    pace.setStill(true);
    expect(pace.wake()).toBe(true);
    pace.setCovered(true);
    expect(pace.wake()).toBe(false);
  });

  test("a covered scene that moves draws at the covered rate", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    // a glide a call started: its pose steps only in drawn frames
    const n = drawn(pace, 0, 60);
    expect(n).toBeGreaterThanOrEqual(COVERED_FPS - 1);
    expect(n).toBeLessThanOrEqual(COVERED_FPS + 1);
    pace.setStill(true);
    expect(drawn(pace, 1000 + FRAME, 60)).toBe(0);
  });

  test("uncovering draws at once, an ask or not", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.setStill(true);
    expect(pace.draws(0)).toBe(false);
    pace.setCovered(false);
    pace.setStill(false);
    expect(pace.draws(FRAME)).toBe(true);
  });

  test("a frame after held ones says so; the next one in a row does not", () => {
    const pace = createFramePace();
    pace.setCovered(true);
    pace.wake();
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
    for (let i = 0; i < 120; i += 1) {
      if (pace.draws(i * (1000 / 120))) {
        count += 1;
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
    pace.wake();
    // asked: the covered rate, slower than the still one
    expect(drawn(pace, 0, 30)).toBe(COVERED_FPS / 2);
  });
});

describe("listening pace", () => {
  test("a still scene the visitor only listens to draws at its rate, and every frame again after", () => {
    const pace = createFramePace();
    pace.setStill(true);
    pace.setListening(true);
    expect(drawn(pace, 0, 120)).toBe(2 * LISTENING_FPS);
    pace.setListening(false);
    expect(drawn(pace, 2000)).toBe(30);
  });

  test("a moving one draws at its rate", () => {
    const pace = createFramePace();
    pace.setListening(true);
    expect(drawn(pace, 0)).toBe(LISTENING_MOVING_FPS);
  });

  test("a moving one keeps no two frames further apart than the loop's time step, at any display rate", () => {
    // the loop clamps a frame's time step to 0.05 s: a wider gap slows a glide
    for (const hz of [24, 30, 36, 38, 50, 60, 75, 90, 120, 144]) {
      const pace = createFramePace();
      pace.setListening(true);
      let last = Number.NaN;
      let widest = 0;
      for (let i = 0; i < hz * 2; i += 1) {
        const now = (i * 1000) / hz;
        if (pace.draws(now)) {
          widest = Math.max(widest, now - last || 0);
          last = now;
        }
      }
      expect(widest).toBeLessThanOrEqual(50);
    }
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
