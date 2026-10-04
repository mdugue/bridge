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
 * moment it worked — and not while the memory would cross the line again
 * with what the step freed back: a camera standing still otherwise gave
 * its fine tiles up, streamed them back in and gave them up again, every
 * hold. Pure: the caller feeds it bytes and times.
 *
 * Two lines, three steps. The last is taken when the second has held and
 * the memory is still past the hard line: an iPhone in Comic sat at level
 * 2 with 690–760 MB held for forty seconds — what stayed in view at ×4
 * still weighed more than the line — and Safari took its GPU away. The last
 * step brings the fine terrain (and the dressing it carries) in to about a
 * quarter of a kilometre on a phone, and keeps next to nothing out of view.
 *
 * The bytes are three's own count, and they run high on purpose: three
 * charges an interleaved buffer once per attribute view, so an instanced
 * set's matrices (instancing.ts: four column views) count four times, and
 * again for every set that shares them — the vegetation weighs several
 * times what the GPU holds. The phone's lines were set against that count
 * on the phone itself; counted true, they would have to be measured again,
 * so the count stays as a cautious measure rather than a corrected one.
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
  /**
   * How long (ms) what a step freed counts against undoing it: after that
   * the camera has likely moved on, and a step up is tried again.
   */
  retryMs: number;
}

type Level = 0 | 1 | 2 | 3;

export interface MemoryStep {
  level: Level;
  /** the tile renderer's error target, as a multiple of its own */
  errorScale: number;
  /** the tile cache's lower bound, as a fraction of its own */
  minScale: number;
}

export const MEMORY_STEPS: readonly [
  MemoryStep,
  MemoryStep,
  MemoryStep,
  MemoryStep,
] = [
  { level: 0, errorScale: 1, minScale: 1 },
  { level: 1, errorScale: 2, minScale: 0.5 },
  { level: 2, errorScale: 4, minScale: 0.25 },
  // Only after level 2 has held and not brought the memory under the hard
  // line (see the module comment).
  { level: 3, errorScale: 8, minScale: 0.125 },
];

const MB = 1024 * 1024;

/**
 * A phone's lines sit well under the ~720 MB its Safari failed at (the
 * frames in between still allocate); the desktop's only catch the extreme.
 */
export function memoryLimitsFor(tier: "desktop" | "mobile"): MemoryLimits {
  return tier === "mobile"
    ? {
        soft: 480 * MB,
        hard: 560 * MB,
        margin: 60 * MB,
        holdMs: 10_000,
        retryMs: 120_000,
      }
    : {
        soft: 2048 * MB,
        hard: 2560 * MB,
        margin: 256 * MB,
        holdMs: 10_000,
        retryMs: 120_000,
      };
}

export interface MemoryGovernor {
  /** the current step */
  step: () => MemoryStep;
  /** the step to take at `held` bytes and time `now` (ms); null: stay */
  update: (held: number, now: number) => MemoryStep | null;
}

export function createMemoryGovernor(limits: MemoryLimits): MemoryGovernor {
  let level: Level = 0;
  let since = Number.NEGATIVE_INFINITY;
  // Per level stepped down to: the memory held when the step was taken,
  // the least held while it settled (its hold), and when. Their difference
  // is what the step freed — what undoing it would bring back.
  const taken = [0, 0, 0, 0];
  const settled = [0, 0, 0, 0];
  const takenAt = [0, 0, 0, 0].map(() => Number.NEGATIVE_INFINITY);
  const freedBy = (l: Level, now: number) =>
    now - takenAt[l] < limits.retryMs ? Math.max(0, taken[l] - settled[l]) : 0;
  // The line a level was taken past, and the one undoing it must stay
  // under: the last step is taken at the hard line too.
  const lineOf = (l: Exclude<Level, 0>) =>
    l === 1 ? limits.soft : limits.hard;
  const target = (held: number, now: number): Level => {
    const holding = now - since < limits.holdMs;
    if (held >= limits.hard) {
      if (level < 2) {
        return 2;
      }
      // Level 2 has held, and the memory is still past its line.
      return level === 2 && !holding ? 3 : level;
    }
    if (held >= limits.soft && level < 1) {
      return 1;
    }
    if (level === 0 || holding) {
      return level;
    }
    if (held + freedBy(level, now) < lineOf(level) - limits.margin) {
      return (level - 1) as Level;
    }
    return level;
  };
  return {
    step: () => MEMORY_STEPS[level],
    update: (held, now) => {
      for (let l = 1; l <= level; l++) {
        if (now - takenAt[l] < limits.holdMs) {
          settled[l] = Math.min(settled[l], held);
        }
      }
      const next = target(held, now);
      if (next === level) {
        return null;
      }
      for (let l = level + 1; l <= next; l++) {
        taken[l] = held;
        settled[l] = held;
        takenAt[l] = now;
      }
      level = next;
      since = now;
      return MEMORY_STEPS[level];
    },
  };
}
