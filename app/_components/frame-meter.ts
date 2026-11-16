/** A drawn frame's times, and the render resolution they allow. */
import type { WebGPURenderer } from "three/webgpu";
import type { FramePace } from "@/lib/city/frame-pace";
import { createFrameTiming } from "@/lib/city/frame-timing";
import type { FrameTiming } from "@/lib/city/frame-timing";
import {
  createResolutionScale,
  resolutionTargetsFor,
} from "@/lib/city/resolution-scale";

/** How often the GPU's frame time is read back (ms): a few per beat. */
const GPU_TIME_READ_MS = 250;

export interface FrameMeterContext {
  renderer: WebGPURenderer;
  tier: "desktop" | "mobile";
  /** the render resolution follows the frame rate (not in the lite
   *  profile: the tests' fixed half resolution) */
  scales: boolean;
  /** the GPU's time is read from three's timestamp queries */
  timesGpu: boolean;
  /** the pixel ratio the tier draws at, before any scaling */
  basePixelRatio: number;
  pace?: Pick<FramePace, "heldBefore">;
  /** the renderer's pixel ratio changed: the screen targets follow */
  resized: () => void;
  /** the resolution stepped: for the crash trail */
  note: (step: string) => void;
}

/** What a drawn frame tells the meter. */
export interface MeteredFrame {
  /** the animation frame's time (ms) */
  time: number;
  /** when its callback began, its render call began and ended (ms) */
  cpuStart: number;
  renderStart: number;
  renderEnd: number;
  /** a picture export draws: its frames are not the scene's, and it draws
   *  at full resolution */
  exporting: boolean;
  /** the scene stood still in the frame before */
  still: boolean;
}

/**
 * The frame loop's meter, one of its owners (create-app.ts `frame`): where
 * each frame's time goes (lib/city/frame-timing.ts, for the heartbeat), the
 * GPU's time read back a few times a second, and the render's resolution
 * as the frame rate allows (lib/city/resolution-scale.ts): fewer pixels
 * while a GPU-bound page cannot hold its tier's rate, the browser scaling
 * the canvas up.
 */
export interface FrameMeter {
  /** after a frame's render */
  drawn: (frame: MeteredFrame) => void;
  /** the loop held a frame back (the e2e hold): the gap to the next one
   *  drawn is no measure of the display */
  held: () => void;
  /** the times since the last take (the heartbeat's) */
  timing: Pick<FrameTiming, "take">;
}

export function createFrameMeter(ctx: FrameMeterContext): FrameMeter {
  const { renderer } = ctx;
  const frameTiming = createFrameTiming();
  const resolution = ctx.scales
    ? createResolutionScale(resolutionTargetsFor(ctx.tier))
    : null;
  let gpuReadDue = 0;
  let gpuReading = false;
  // three hands back its last value when nothing new resolved (the map
  // busy, no pass since, a failed readback): the same number again is
  // not a new frame's.
  let lastGpuMs = Number.NaN;
  let lastDrawnAt: number | undefined;

  // One readback at a time: a slow GPU's answer is waited for.
  const readGpuTime = (now: number) => {
    if (!ctx.timesGpu || gpuReading || now < gpuReadDue) {
      return;
    }
    gpuReading = true;
    gpuReadDue = now + GPU_TIME_READ_MS;
    void renderer
      .resolveTimestampsAsync("render")
      .then((ms) => {
        if (typeof ms === "number" && ms !== lastGpuMs) {
          lastGpuMs = ms;
          frameTiming.gpu(ms);
          resolution?.gpu(ms);
        }
        return null;
      })
      .catch(() => {
        // a read that failed: the next one is due soon
      })
      .finally(() => {
        gpuReading = false;
      });
  };

  const rescale = (frame: MeteredFrame) => {
    if (!resolution) {
      return;
    }
    if (frame.exporting) {
      resolution.reset();
      return;
    }
    const changed = resolution.update(frame.time, frame.still);
    const ratio = ctx.basePixelRatio * resolution.scale();
    if (renderer.getPixelRatio() !== ratio) {
      renderer.setPixelRatio(ratio);
      ctx.resized();
    }
    if (changed !== undefined) {
      ctx.note(String(changed));
    }
  };

  return {
    // The frame's callback from `cpuStart`, the render call, and the
    // interval since the frame before — none across frames the pace or the
    // e2e hold kept back.
    drawn: (frame) => {
      const { time, cpuStart, renderStart, renderEnd } = frame;
      const gap = lastDrawnAt === undefined || ctx.pace?.heldBefore() === true;
      const interval = gap ? undefined : time - (lastDrawnAt ?? time);
      frameTiming.frame(
        renderEnd - cpuStart,
        renderEnd - renderStart,
        interval
      );
      if (interval !== undefined) {
        resolution?.frame(interval, renderEnd - cpuStart);
      }
      rescale(frame);
      lastDrawnAt = time;
      readGpuTime(renderEnd);
    },
    held: () => {
      lastDrawnAt = undefined;
    },
    timing: frameTiming,
  };
}
