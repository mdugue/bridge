import { describe, expect, test } from "bun:test";
import {
  createResolutionScale,
  type ResolutionScale,
  resolutionTargetsFor,
  SCALE_STEPS,
  WINDOW_MS,
} from "./resolution-scale";

const DESKTOP = resolutionTargetsFor("desktop");

interface Load {
  /** the main thread's time per frame (ms) */
  cpuMs: number;
  /** the GPU's time per frame at full resolution (ms): it scales by pixels */
  gpuMs: number;
  /** whether the GPU's times are read back (not on Safari) */
  timed?: boolean;
  /** a frame rate cap (ms per frame), as a 30 Hz Low Power Mode */
  capMs?: number;
}

/**
 * Runs `windows` windows of a scene under `load` from `start`: each frame
 * as slow as its main thread, its GPU at the current scale, a 60 Hz
 * display and any cap allow. Returns the scales it switched to and where
 * the clock ended.
 */
function run(
  rs: ResolutionScale,
  start: number,
  windows: number,
  load: Load
): { changes: number[]; end: number } {
  const changes: number[] = [];
  let now = start;
  const end = start + windows * WINDOW_MS;
  while (now < end) {
    const gpu = load.gpuMs * rs.scale() ** 2;
    const interval = Math.max(16.7, load.capMs ?? 0, load.cpuMs, gpu);
    now += interval;
    rs.frame(interval, load.cpuMs);
    if (load.timed) {
      rs.gpu(gpu);
    }
    const scale = rs.update(now);
    if (scale !== undefined) {
      changes.push(scale);
    }
  }
  return { changes, end: now };
}

describe("resolution scale", () => {
  test("keeps full resolution while the frame rate holds", () => {
    const rs = createResolutionScale(DESKTOP);
    expect(run(rs, 0, 10, { cpuMs: 6, gpuMs: 15 }).changes).toEqual([]);
    expect(rs.scale()).toBe(1);
  });

  test("steps down a GPU-bound page until it holds its rate", () => {
    const rs = createResolutionScale(DESKTOP);
    // 30 ms of GPU at full resolution: 21.7 at 0.85 (still slow), 15.6 at 0.72
    const { changes } = run(rs, 0, 12, { cpuMs: 8, gpuMs: 30 });
    expect(changes).toEqual([SCALE_STEPS[1], SCALE_STEPS[2]]);
    expect(rs.scale()).toBe(SCALE_STEPS[2]);
  });

  test("never steps past the tier's coarsest step", () => {
    const phone = createResolutionScale(resolutionTargetsFor("mobile"));
    run(phone, 0, 30, { cpuMs: 8, gpuMs: 100 });
    expect(phone.scale()).toBe(SCALE_STEPS[2]);
  });

  test("leaves a page held up by its main thread alone", () => {
    const rs = createResolutionScale(DESKTOP);
    expect(run(rs, 0, 10, { cpuMs: 28, gpuMs: 30 }).changes).toEqual([]);
  });

  test("takes back a step that gained nothing (a capped frame rate)", () => {
    const rs = createResolutionScale(DESKTOP);
    // 30 fps whatever the pixels: down once, back, then left alone for 30 s
    const capped = { cpuMs: 8, gpuMs: 12, capMs: 33.3 };
    const { changes } = run(rs, 0, 25, capped);
    expect(changes).toEqual([SCALE_STEPS[1], 1]);
    expect(rs.scale()).toBe(1);
  });

  test("decides even at a few frames a second", () => {
    const rs = createResolutionScale(DESKTOP);
    run(rs, 0, 6, { cpuMs: 8, gpuMs: 150 });
    expect(rs.scale()).toBeLessThan(1);
  });

  test("ignores a lone long frame (medians)", () => {
    const rs = createResolutionScale(DESKTOP);
    let now = 0;
    for (let i = 0; i < 200; i++) {
      const dt = i % 50 === 0 ? 400 : 16.7;
      now += dt;
      rs.frame(dt, 5);
      expect(rs.update(now)).toBeUndefined();
    }
  });

  test("steps back up where the GPU's time says the finer step fits", () => {
    const rs = createResolutionScale(DESKTOP);
    const down = run(rs, 0, 4, { cpuMs: 6, gpuMs: 24, timed: true });
    expect(down.changes).toEqual([SCALE_STEPS[1]]);
    // the scene got lighter: not at once (held 4 s), then after two windows
    const up = run(rs, down.end, 8, { cpuMs: 6, gpuMs: 8, timed: true });
    expect(up.changes).toEqual([1]);
  });

  test("holds a step the GPU's time says would not fit", () => {
    const rs = createResolutionScale(DESKTOP);
    const down = run(rs, 0, 4, { cpuMs: 6, gpuMs: 24, timed: true });
    expect(rs.scale()).toBe(SCALE_STEPS[1]);
    // 17.3 ms at 0.85, 24 at 1: above 75 % of the 20 ms floor
    expect(
      run(rs, down.end, 30, { cpuMs: 6, gpuMs: 24, timed: true }).changes
    ).toEqual([]);
  });

  test("never steps up while the frame rate misses its floor", () => {
    const rs = createResolutionScale(DESKTOP);
    const down = run(rs, 0, 4, { cpuMs: 6, gpuMs: 24 });
    expect(rs.scale()).toBe(SCALE_STEPS[1]);
    // now the main thread holds it up (33 ms of JavaScript): no probe
    expect(run(rs, down.end, 30, { cpuMs: 33, gpuMs: 24 }).changes).toEqual([]);
  });

  test("without GPU times, probes up after a calm stretch and backs off", () => {
    const rs = createResolutionScale(DESKTOP);
    const down = run(rs, 0, 4, { cpuMs: 6, gpuMs: 24 });
    expect(rs.scale()).toBe(SCALE_STEPS[1]);
    // calm for 8 s: a tentative step up, too slow at full resolution, back
    const probe = run(rs, down.end, 14, { cpuMs: 6, gpuMs: 24 });
    expect(probe.changes).toEqual([1, SCALE_STEPS[1]]);
    // … and the next probe waits twice as long
    expect(run(rs, probe.end, 12, { cpuMs: 6, gpuMs: 24 }).changes).toEqual([]);
    const later = run(rs, probe.end + 12 * WINDOW_MS, 8, {
      cpuMs: 6,
      gpuMs: 24,
    });
    expect(later.changes).toEqual([1]);
  });

  test("decides nothing from an export's frames", () => {
    const rs = createResolutionScale(DESKTOP);
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += 100;
      rs.frame(100, 5);
      rs.reset();
      expect(rs.update(now)).toBeUndefined();
    }
  });
});
