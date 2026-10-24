/**
 * Where a frame's time goes, beat by beat: the main thread's share (the
 * whole frame callback, and the render call inside it, where three encodes
 * and submits the passes), the GPU's (timestamp queries, where the browser
 * offers them: Chromium's WebGPU, not Safari's), the pixels drawn and the
 * fastest the loop ran (a 120 Hz display asks for twice the frames). A frame
 * rate alone cannot tell a page held up by its JavaScript from one held up
 * by its GPU; these can. No THREE, no DOM.
 */

/** One beat's timings (the crash trail's `TrailBeat`). */
export interface BeatTiming {
  /** frames timed */
  frames: number;
  /** the frame callback's mean main-thread time, ms */
  cpuMs: number;
  /** its slowest frame, ms */
  cpuMaxMs: number;
  /** the mean of the render call inside it, ms */
  renderMs: number;
  /** the GPU's mean time per frame, ms — none without timestamp queries */
  gpuMs?: number;
  /**
   * The fastest rate the loop ran at (the 10th percentile of the intervals
   * between drawn frames, as Hz): the display's refresh when the page keeps
   * up with it, so 120 on a ProMotion display.
   */
  peakHz?: number;
}

export interface FrameTiming {
  /**
   * A drawn frame: its main-thread time, the render call's part of it, and
   * the time since the previous drawn frame (ms; none for the first).
   */
  frame: (cpuMs: number, renderMs: number, sinceMs?: number) => void;
  /** a GPU time read back for one frame (ms) */
  gpu: (ms: number) => void;
  /** the beat's timings since the last call (and resets), or none */
  take: () => BeatTiming | undefined;
}

/** intervals kept per beat for the peak rate (a 2 s beat at 240 Hz: 480) */
const INTERVALS = 512;

export function createFrameTiming(): FrameTiming {
  let frames = 0;
  let cpuSum = 0;
  let cpuMax = 0;
  let renderSum = 0;
  let gpuSum = 0;
  let gpuCount = 0;
  const intervals: number[] = [];
  return {
    frame: (cpuMs, renderMs, sinceMs) => {
      frames++;
      cpuSum += cpuMs;
      cpuMax = Math.max(cpuMax, cpuMs);
      renderSum += renderMs;
      if (
        sinceMs !== undefined &&
        sinceMs > 0 &&
        intervals.length < INTERVALS
      ) {
        intervals.push(sinceMs);
      }
    },
    gpu: (ms) => {
      // (a pool that resolved before any pass ran reads 0)
      if (Number.isFinite(ms) && ms > 0) {
        gpuSum += ms;
        gpuCount++;
      }
    },
    take: () => {
      const timing =
        frames === 0
          ? undefined
          : {
              frames,
              cpuMs: cpuSum / frames,
              cpuMaxMs: cpuMax,
              renderMs: renderSum / frames,
              gpuMs: gpuCount > 0 ? gpuSum / gpuCount : undefined,
              peakHz: peakHzOf(intervals),
            };
      frames = 0;
      cpuSum = 0;
      cpuMax = 0;
      renderSum = 0;
      gpuSum = 0;
      gpuCount = 0;
      intervals.length = 0;
      return timing;
    },
  };
}

/** The 10th percentile of the intervals, as a rate (Hz), or none. */
export function peakHzOf(intervals: readonly number[]): number | undefined {
  if (intervals.length < 5) {
    return undefined;
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)];
  return 1000 / p10;
}
