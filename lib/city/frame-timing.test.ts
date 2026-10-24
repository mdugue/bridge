import { describe, expect, test } from "bun:test";
import { createFrameTiming, peakHzOf } from "./frame-timing";

describe("frame timing", () => {
  test("a beat without frames has no timings", () => {
    expect(createFrameTiming().take()).toBeUndefined();
  });

  test("means the main thread's and the GPU's times over a beat", () => {
    const timing = createFrameTiming();
    timing.frame(10, 6);
    timing.frame(20, 8, 16);
    timing.gpu(12);
    timing.gpu(14);
    const beat = timing.take();
    expect(beat?.frames).toBe(2);
    expect(beat?.cpuMs).toBe(15);
    expect(beat?.cpuMaxMs).toBe(20);
    expect(beat?.renderMs).toBe(7);
    expect(beat?.gpuMs).toBe(13);
  });

  test("has no GPU time where nothing was read back (or only zeros)", () => {
    const timing = createFrameTiming();
    timing.frame(5, 3);
    timing.gpu(0);
    expect(timing.take()?.gpuMs).toBeUndefined();
  });

  test("starts the next beat afresh", () => {
    const timing = createFrameTiming();
    timing.frame(40, 30);
    timing.gpu(30);
    timing.take();
    timing.frame(4, 2);
    const beat = timing.take();
    expect(beat?.cpuMaxMs).toBe(4);
    expect(beat?.gpuMs).toBeUndefined();
  });
});

describe("peak rate", () => {
  test("reads a 120 Hz display from frames that keep up with it", () => {
    const intervals = Array.from({ length: 100 }, (_, i) =>
      i % 3 === 0 ? 1000 / 60 : 1000 / 120
    );
    expect(peakHzOf(intervals)).toBeCloseTo(120, 0);
  });

  test("reads the loop's own rate where it falls behind", () => {
    expect(peakHzOf(Array.from({ length: 30 }, () => 40))).toBe(25);
  });

  test("needs a few intervals", () => {
    expect(peakHzOf([16, 16])).toBeUndefined();
  });
});
