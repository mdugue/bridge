/**
 * Timing marks for the boot and the tile stream (plan 069), local only:
 * what holds the load at 52 % and what makes walking jerky, measured where
 * it happens. Every measure is counted by its category (`tile:bvh`,
 * `dressing:build`, …), a name without a tile id; with `?trace=1` each
 * one also goes to the browser's own timeline as `performance.measure`
 * (DevTools' and Web Inspector's *Timings* track), there with the tile id
 * named, and the page prints the summary once it has loaded
 * (create-app.ts). Nothing here reaches the crash records or the
 * reports: a tile's id names where the player was.
 */

/** One category's measures so far. */
export interface TimingStat {
  count: number;
  totalMs: number;
  maxMs: number;
}

/** What the timings write to the browser's timeline (`performance`). */
interface Timeline {
  mark: (name: string) => unknown;
  measure: (name: string, options: { start: number; end: number }) => unknown;
}

export interface StreamTimings {
  /** the clock's time, for a span `since` ends */
  now: () => number;
  /** times `work` under `category`; `detail` (a tile id) names it on the
   *  browser's timeline only */
  timed: <T>(
    category: string,
    work: () => Promise<T>,
    detail?: string
  ) => Promise<T>;
  timedSync: <T>(category: string, work: () => T, detail?: string) => T;
  /** counts a span measured elsewhere (from `start`, the clock's time, to
   *  now) */
  since: (category: string, start: number, detail?: string) => void;
  /** a mark at most once per page (`boot:light-done`); its time */
  markOnce: (name: string) => void;
  /** when a `markOnce` mark was set, if it was */
  markedAt: (name: string) => number | undefined;
  /** the long tasks will be counted (the browser reports them): the
   *  summary's `longtask` row exists from now on, at 0 until one comes */
  watchLongTasks: () => void;
  /** a long task the browser reported */
  longTask: (ms: number) => void;
  /** category → its measures, and the long tasks (`longtask`; no row
   *  where the browser reports none, as Safari) */
  summary: () => Record<string, TimingStat>;
  /** writes each measure to `timeline` from now on (`?trace=1`) */
  trace: (timeline: Timeline) => void;
}

/**
 * The timings over a clock (`performance.now` in the page, a fake one in
 * the tests). A timeline that throws — an old WebKit on a measure it does
 * not take — is passed over; the counts stand.
 */
export function createStreamTimings(now: () => number): StreamTimings {
  const stats = new Map<string, TimingStat>();
  const marks = new Map<string, number>();
  let timeline: Timeline | null = null;
  let longTasks: TimingStat | null = null;
  const add = (category: string, ms: number) => {
    const stat = stats.get(category) ?? { count: 0, totalMs: 0, maxMs: 0 };
    stat.count += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stats.set(category, stat);
  };
  const since = (category: string, start: number, detail?: string) => {
    const end = now();
    add(category, end - start);
    try {
      timeline?.measure(detail ? `${category} ${detail}` : category, {
        start,
        end,
      });
    } catch {
      // the count stands
    }
  };
  return {
    now,
    timed: async (category, work, detail) => {
      const start = now();
      try {
        return await work();
      } finally {
        since(category, start, detail);
      }
    },
    timedSync: (category, work, detail) => {
      const start = now();
      try {
        return work();
      } finally {
        since(category, start, detail);
      }
    },
    since,
    markOnce: (name) => {
      if (marks.has(name)) {
        return;
      }
      marks.set(name, now());
      try {
        timeline?.mark(name);
      } catch {
        // the time is kept
      }
    },
    markedAt: (name) => marks.get(name),
    watchLongTasks: () => {
      longTasks ??= { count: 0, totalMs: 0, maxMs: 0 };
    },
    longTask: (ms) => {
      longTasks ??= { count: 0, totalMs: 0, maxMs: 0 };
      longTasks.count += 1;
      longTasks.totalMs += ms;
      longTasks.maxMs = Math.max(longTasks.maxMs, ms);
    },
    summary: () => {
      const out: Record<string, TimingStat> = {};
      for (const [category, stat] of [...stats].sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        out[category] = { ...stat };
      }
      if (longTasks) {
        out.longtask = { ...longTasks };
      }
      return out;
    },
    trace: (to) => {
      timeline = to;
    },
  };
}

/** How many frames at the start pose `bootFrames` times. */
export const BOOT_FRAMES = 60;

/**
 * The boot's first frames once it has placed the player at the start
 * (`boot:placed`), each timed whole from its `start`: the first one that
 * draws the shadow map (`boot:first-shadow-frame` — three builds the
 * shadow pass's pipelines inside it; the light stage waits for it) and the
 * first BOOT_FRAMES of them (`boot:frame`).
 */
export function bootFrames(
  timings: StreamTimings
): (start: number, shadowDrawn: boolean) => void {
  let counted = 0;
  let shadowSeen = false;
  return (start, shadowDrawn) => {
    if (timings.markedAt("boot:placed") === undefined) {
      return;
    }
    if (counted < BOOT_FRAMES) {
      counted += 1;
      timings.since("boot:frame", start);
    }
    if (shadowDrawn && !shadowSeen) {
      shadowSeen = true;
      timings.since("boot:first-shadow-frame", start);
    }
  };
}

/** The page's timings (performance.now; a stand-in clock outside a page). */
export const streamTimings: StreamTimings = createStreamTimings(() =>
  typeof performance === "undefined" ? Date.now() : performance.now()
);

/** Whether the page was opened with `?trace=1`. */
export function traceRequested(search: string): boolean {
  return new URLSearchParams(search).get("trace") === "1";
}

/**
 * Starts the trace: each measure on the browser's timeline, and the long
 * tasks counted where the browser reports them (Chromium; Safari has
 * none, and the summary then lacks the row). Returns what stops the long
 * tasks' observer.
 */
export function startTrace(): () => void {
  streamTimings.trace(performance);
  const supported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask");
  if (!supported) {
    return () => undefined;
  }
  streamTimings.watchLongTasks();
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      streamTimings.longTask(entry.duration);
    }
  });
  observer.observe({ type: "longtask", buffered: true });
  return () => observer.disconnect();
}

/** Prints the summary to the console (`?trace=1` only): one row per
 *  category, in whole milliseconds. */
export function printTrace(when: string): void {
  const summary = streamTimings.summary();
  const rows = Object.fromEntries(
    Object.entries(summary).map(([category, s]) => [
      category,
      {
        count: s.count,
        totalMs: Math.round(s.totalMs),
        maxMs: Math.round(s.maxMs),
      },
    ])
  );
  console.info(
    `[trace] ${when}${summary.longtask ? "" : " — long tasks: n/a"}`
  );
  console.table(rows);
}
