/**
 * The crash trail's pure core (the browser side is
 * app/_components/crash-trail.ts). A page the browser kills — iOS ends a
 * tab that holds too much memory, a GPU process that dies takes the page
 * with it — runs no handler on the way out, so the viewer keeps a small
 * record of itself in local storage as it goes: what it runs on, a ring of
 * events (boot stages, style switches, errors, a lost device) and a ring
 * of heartbeats (frames, memory, what is loaded), and the whole page in a
 * few numbers the rings would lose (`stats`, `firsts`). A record that never
 * reached a clean end on the next load is the trace of a crash, and the
 * HUD offers it as text to copy (and, where a DSN is set, the viewer
 * reports it: lib/city/crash-reports.ts). No THREE, no DOM.
 */

/** Bumped when the stored shape changes; older records are dropped. */
export const TRAIL_VERSION = 1;
/** How many events and heartbeats a record keeps (the newest). */
export const TRAIL_EVENTS = 40;
export const TRAIL_BEATS = 12;

export interface TrailEvent {
  /** seconds since the record started */
  t: number;
  kind: string;
  detail?: string;
}

export interface TrailBeat {
  /** seconds since the record started */
  t: number;
  frames: number;
  /** frames rendered per second since the previous beat */
  fps: number;
  /** the scene's GPU estimate (geometry, textures, shadow map), MB */
  gpuMB: number;
  /**
   * What the renderer holds on the GPU (three's own count), MB, and its
   * attributes and textures (each with its MB), programs and uniform
   * buffers — optional: older records lack it.
   */
  heldMB?: number;
  held?: string;
  calls: number;
  triangles: number;
  /** the JS heap, MB (Chromium only) */
  heapMB?: number;
  /** loaded building tiles and built dressings */
  cities: number;
  dressings: number;
  style: string;
  /** walk or fly, and the camera's height above the ground (m) */
  mode: string;
  heightM: number;
}

/**
 * The upper bounds (fps) of the frame-rate buckets a page's beats are
 * counted in; the last bucket is everything at or above the last bound.
 */
export const FPS_BUCKETS = [10, 20, 30, 45] as const;

/**
 * The whole page in numbers, where the rings keep only its end: every beat
 * rendered in view (none before the first frame, none while hidden),
 * counted by frame rate, and the most the page held.
 */
export interface TrailStats {
  /** beats counted */
  beats: number;
  /** their frame rates summed (the mean is `fpsSum / beats`) */
  fpsSum: number;
  /** beats per frame-rate bucket: FPS_BUCKETS, then everything above */
  fps: number[];
  maxGpuMB: number;
  maxHeldMB: number;
  maxHeapMB?: number;
}

/**
 * How a record ended: "running" is how a record in view starts and what a
 * killed page leaves behind; "hidden" is a page in the background — gone
 * there, or loaded there and never shown (a kill there is the system
 * reclaiming it, not a crash in use); "clean" is a page that left normally.
 */
export type TrailEnd = "running" | "hidden" | "clean";

export interface Trail {
  v: typeof TRAIL_VERSION;
  startedAt: string;
  url: string;
  userAgent: string;
  /** "WebGPU", "WebGL2" or "?" before the renderer is up */
  backend: string;
  /** CSS size × devicePixelRatio, and the renderer's pixel ratio */
  screen: string;
  pixelRatio?: number;
  /** the device memory the browser reports (GB, Chromium only) */
  deviceMemoryGB?: number;
  state: TrailEnd;
  /**
   * The page reached its first frame — kept apart from the events, whose
   * ring drops its oldest (a minute of streaming notes forty dressings);
   * optional: older records lack it.
   */
  drew?: boolean;
  events: TrailEvent[];
  beats: TrailBeat[];
  /** the page in numbers (optional: older records lack it) */
  stats?: TrailStats;
  /**
   * When each kind of event first happened (s): the boot's milestones
   * ("first frame", "loaded") outlive the ring. Optional, as `stats`.
   */
  firsts?: Record<string, number>;
  /** what the crash reports keep with the record (none without a DSN) */
  report?: TrailReport;
}

/**
 * The reports' part of a record (lib/city/crash-reports.ts): the page's
 * session and its build, so that the next load can end that session and
 * report the page under the release it ran, and what already went out.
 */
export interface TrailReport {
  /** the session's id (release health) */
  sid: string;
  /** the build the page ran (`bridge@<commit>`), if it had one */
  release?: string;
  environment: string;
  /** the problems noted: the session's error count */
  problems: number;
  /**
   * How far the page's summaries have covered it: a summary goes out each
   * time the page leaves view, for the stretch since the last one.
   */
  sent?: SummaryMark;
  /** the session's last update (exited or crashed) went out */
  ended: boolean;
}

/** Where the last summary ended: its time and the stats' sums then. */
export interface SummaryMark {
  /** seconds since the record started */
  t: number;
  beats: number;
  fpsSum: number;
  fps: number[];
  /** summaries sent so far */
  count: number;
}

/** The event the HUD notes when the scene goes live (city-walk.tsx). */
const FIRST_FRAME = "first frame";

export interface TrailSetup extends Pick<
  Trail,
  "startedAt" | "url" | "userAgent" | "screen" | "deviceMemoryGB"
> {
  /** the page starts in the background (a tab opened behind, restored) */
  hidden?: boolean;
}

export function createTrail({ hidden, ...setup }: TrailSetup): Trail {
  return {
    v: TRAIL_VERSION,
    backend: "?",
    state: hidden ? "hidden" : "running",
    events: [],
    beats: [],
    stats: emptyStats(),
    firsts: {},
    ...setup,
  };
}

function emptyStats(): TrailStats {
  return {
    beats: 0,
    fpsSum: 0,
    fps: FPS_BUCKETS.map(() => 0).concat(0),
    maxGpuMB: 0,
    maxHeldMB: 0,
  };
}

/** The bucket of FPS_BUCKETS a frame rate falls in. */
export function fpsBucket(fps: number): number {
  const i = FPS_BUCKETS.findIndex((bound) => fps < bound);
  return i < 0 ? FPS_BUCKETS.length : i;
}

/** Appends to a ring: the newest `limit` entries stay. */
function pushRing<T>(ring: T[], entry: T, limit: number): void {
  ring.push(entry);
  if (ring.length > limit) {
    ring.splice(0, ring.length - limit);
  }
}

export function pushEvent(trail: Trail, event: TrailEvent): void {
  if (event.kind === FIRST_FRAME) {
    trail.drew = true;
  }
  pushRing(trail.events, event, TRAIL_EVENTS);
  trail.firsts ??= {};
  trail.firsts[event.kind] ??= event.t;
}

/**
 * Appends a beat to the ring and, when the page rendered in view, counts
 * it in the stats: a beat before the first frame measures the boot, one
 * while hidden a paused loop — neither is the frame rate anybody saw.
 */
export function pushBeat(trail: Trail, beat: TrailBeat): void {
  pushRing(trail.beats, beat, TRAIL_BEATS);
  if (beat.frames === 0 || trail.state === "hidden") {
    return;
  }
  const stats = (trail.stats ??= emptyStats());
  stats.beats += 1;
  stats.fpsSum += beat.fps;
  stats.fps[fpsBucket(beat.fps)] += 1;
  stats.maxGpuMB = Math.max(stats.maxGpuMB, beat.gpuMB);
  stats.maxHeldMB = Math.max(stats.maxHeldMB, beat.heldMB ?? 0);
  if (beat.heapMB !== undefined) {
    stats.maxHeapMB = Math.max(stats.maxHeapMB ?? 0, beat.heapMB);
  }
}

/** When an event of `kind` first happened (s), or undefined. */
export function firstAt(trail: Trail, kind: string): number | undefined {
  return trail.firsts?.[kind] ?? trail.events.find((e) => e.kind === kind)?.t;
}

/**
 * How far the page got: "running" once the site was loaded, "streaming"
 * after the first frame, before it "boot" and the last boot stage done.
 */
export function trailPhase(trail: Trail): string {
  if (firstAt(trail, "loaded") !== undefined) {
    return "running";
  }
  if (firstAt(trail, FIRST_FRAME) !== undefined) {
    return "streaming";
  }
  const stage = trail.events.findLast((e) => e.kind.startsWith("stage "));
  return stage ? `boot after ${stage.kind.slice("stage ".length)}` : "boot";
}

/** A stored record, or null for anything that is not one of this version. */
export function parseTrail(raw: string | null): Trail | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<Trail> | null;
    if (
      value?.v !== TRAIL_VERSION ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.beats)
    ) {
      return null;
    }
    return value as Trail;
  } catch {
    return null;
  }
}

/** Whether a record is the trace of a page that died while in use. */
export function endedInCrash(trail: Trail | null): trail is Trail {
  return trail?.state === "running";
}

/**
 * Whether a record holds nothing but its start: it never drew, noted no
 * boot stage and beat no rendered frame — a page gone before the viewer
 * got anywhere.
 */
function startOnly(trail: Trail): boolean {
  const noted = (test: (kind: string) => boolean) =>
    Object.keys(trail.firsts ?? {}).some(test) ||
    trail.events.some((e) => test(e.kind));
  return !(
    trail.drew === true ||
    noted((kind) => kind === FIRST_FRAME || kind.startsWith("stage ")) ||
    trail.beats.some((b) => b.frames > 0)
  );
}

/**
 * Whether the previous page's record should be offered as a crash. Not when
 * that page reloaded itself to recover a lost GPU (it noted so — not
 * necessarily last: WebKit's device-lost can arrive after the failed frame
 * that started the reload — and the recovery already handled it), nor when
 * this page follows a recovery (`recovered`) and the record holds nothing
 * but its start (`startOnly`) — iOS may interleave a navigation of its own
 * that leaves such a trail. A recovered page that then died is offered, in
 * its boot too: a recovery page that dies again is the loop the reports
 * are there to show.
 */
export function offerAsCrash(
  trail: Trail | null,
  recovered: boolean
): trail is Trail {
  if (!endedInCrash(trail)) {
    return false;
  }
  if (trail.events.some((e) => e.kind === "reloading")) {
    return false;
  }
  return !(recovered && startOnly(trail));
}

export const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** One heartbeat as a line of the report (and of the console). */
export function formatBeat(b: TrailBeat): string {
  const heap = b.heapMB === undefined ? "" : ` heap ${round(b.heapMB)}MB`;
  const held =
    b.heldMB === undefined ? "" : ` held ${round(b.heldMB)}MB ${b.held ?? ""}`;
  return (
    `${round(b.t, 1)}s  f${b.frames} ${round(b.fps)}fps  gpu ${round(b.gpuMB)}MB${held}${heap}` +
    `  ${b.calls}dc ${round(b.triangles / 1000)}k▲  tiles ${b.cities}/${b.dressings}` +
    `  ${b.style} ${b.mode} ${round(b.heightM)}m`
  );
}

/** One event as a line of the report (and of the console). */
export function formatEvent(e: TrailEvent): string {
  return `${round(e.t, 1)}s  ${e.kind}${e.detail ? `  ${e.detail}` : ""}`;
}

/** The page's stats as one line of the report. */
export function formatStats(stats: TrailStats): string {
  if (stats.beats === 0) {
    return "no frames in view";
  }
  const share = (n: number) => `${Math.round((n / stats.beats) * 100)}%`;
  const buckets = stats.fps
    .map((n, i) => {
      const bound = FPS_BUCKETS[i];
      return `${bound === undefined ? `≥${FPS_BUCKETS.at(-1)}` : `<${bound}`} ${share(n)}`;
    })
    .join(" ");
  const heap =
    stats.maxHeapMB === undefined ? "" : ` heap ${round(stats.maxHeapMB)}MB`;
  return (
    `${stats.beats} beats, mean ${round(stats.fpsSum / stats.beats)}fps (${buckets})` +
    `  max held ${round(stats.maxHeldMB)}MB gpu ${round(stats.maxGpuMB)}MB${heap}`
  );
}

/** The record as the plain text the HUD offers to copy. */
export function formatTrail(trail: Trail): string {
  const lines = [
    `crash trail v${trail.v} · ${trail.state}`,
    `start ${trail.startedAt}`,
    `url ${trail.url}`,
    `ua ${trail.userAgent}`,
    `backend ${trail.backend} · screen ${trail.screen}` +
      (trail.pixelRatio === undefined ? "" : ` · pr ${trail.pixelRatio}`) +
      (trail.deviceMemoryGB === undefined
        ? ""
        : ` · mem ${trail.deviceMemoryGB}GB`),
    ...(trail.stats ? [`page ${formatStats(trail.stats)}`] : []),
    "",
    "events:",
    ...trail.events.map(formatEvent),
    "",
    "beats:",
    ...trail.beats.map(formatBeat),
  ];
  return lines.join("\n");
}
