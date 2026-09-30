/**
 * Keeps the GPU memory a page holds under the line where the browser takes
 * its GPU away. On an iPhone, Safari's GPU process failed to allocate a
 * buffer at ~720 MB (three's own count) and the page lost its device for
 * good: the render stopped. The tile cache bounds the tiles nobody looks at,
 * never the ones in view — looking around from high above put more fine
 * tiles in view than fit.
 *
 * So the governor watches what the renderer holds and steps the detail
 * down before that line: the tile renderer's error target goes up (coarser
 * tiles in view) and the cache's lower bound goes down (tiles no longer in
 * use leave sooner). It never lowers the cache's upper bound: at that bound
 * the cache loads nothing, and the coarser tiles it now wants would never
 * arrive. It steps back up only once the memory is well below the line
 * again and some time has passed, so a step down does not undo itself the
 * moment it worked. Pure: the caller feeds it bytes and times.
 */

export interface MemoryLimits {
  /** held bytes at which the first step down is taken */
  soft: number;
  /** held bytes at which the second is */
  hard: number;
  /** how far below a line the memory must fall to step back up */
  margin: number;
  /** the least time (ms) a step holds before it is undone */
  holdMs: number;
}

export interface MemoryStep {
  level: 0 | 1 | 2;
  /** the tile renderer's error target, as a multiple of its own */
  errorScale: number;
  /** the tile cache's lower bound, as a fraction of its own */
  minScale: number;
}

export const MEMORY_STEPS: readonly [MemoryStep, MemoryStep, MemoryStep] = [
  { level: 0, errorScale: 1, minScale: 1 },
  { level: 1, errorScale: 2, minScale: 0.5 },
  { level: 2, errorScale: 4, minScale: 0.25 },
];

const MB = 1024 * 1024;

/**
 * A phone's lines sit well under the ~720 MB its Safari failed at (the
 * frames in between still allocate); the desktop's only catch the extreme.
 */
export function memoryLimitsFor(tier: "desktop" | "mobile"): MemoryLimits {
  return tier === "mobile"
    ? { soft: 480 * MB, hard: 560 * MB, margin: 60 * MB, holdMs: 10_000 }
    : { soft: 2048 * MB, hard: 2560 * MB, margin: 256 * MB, holdMs: 10_000 };
}

export interface MemoryGovernor {
  /** the current step */
  step: () => MemoryStep;
  /** the step to take at `held` bytes and time `now` (ms); null: stay */
  update: (held: number, now: number) => MemoryStep | null;
}

export function createMemoryGovernor(limits: MemoryLimits): MemoryGovernor {
  let level: 0 | 1 | 2 = 0;
  let since = Number.NEGATIVE_INFINITY;
  const lineOf = (l: 1 | 2) => (l === 2 ? limits.hard : limits.soft);
  const target = (held: number, now: number): 0 | 1 | 2 => {
    if (held >= limits.hard) {
      return 2;
    }
    if (held >= limits.soft && level < 1) {
      return 1;
    }
    if (level === 0 || now - since < limits.holdMs) {
      return level;
    }
    if (held < lineOf(level) - limits.margin) {
      return level === 2 ? 1 : 0;
    }
    return level;
  };
  return {
    step: () => MEMORY_STEPS[level],
    update: (held, now) => {
      const next = target(held, now);
      if (next === level) {
        return null;
      }
      level = next;
      since = now;
      return MEMORY_STEPS[level];
    },
  };
}
