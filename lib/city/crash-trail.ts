import { RESUME_AWAY_MS } from "./gpu-safety";

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
  /**
   * seconds since the record started, by the page's own clock — which iOS
   * stops while the device sleeps: what must hold across a sleep is kept
   * by the wall clock as well (`hiddenWall`, `lastWall`)
   */
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
  /**
   * What tells the ways a phone runs out apart (optional: older records
   * lack them): the tracked raster textures inside the `gpu` figure (tile
   * rasters, land-cover splats, sky light), MB …
   */
  rasterMB?: number;
  /** … the terrain levels loaded with their rasters, fine and coarse … */
  fine?: number;
  coarse?: number;
  /** … the tile cache's bytes and its lower and upper bound, MB … */
  cacheMB?: number;
  cacheMinMB?: number;
  cacheMaxMB?: number;
  /** … tile contents downloading and parsing now, and failed for good … */
  downloading?: number;
  parsing?: number;
  failed?: number;
  /** … and whether the browser thinks it is online. */
  online?: boolean;
  style: string;
  /** walk or fly, and the camera's height above the ground (m) */
  mode: string;
  heightM: number;
  /** the render had stopped (the failure card): a record, no frame rate */
  stopped?: boolean;
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
  /**
   * How far the viewer lowered its budget on this device after earlier
   * losses (0: not at all), once the page knows it; optional.
   */
  safety?: number;
  state: TrailEnd;
  /**
   * Since when the page is in the background (s), while it is: a record
   * that starts hidden is hidden from its start. Optional, as `stats`.
   */
  hiddenAt?: number;
  /**
   * The same moment by the wall clock (ms since the epoch): the page's own
   * clock stands still while the device sleeps, and an hour with the phone
   * locked would read as a glance away. Optional: older records lack it.
   */
  hiddenWall?: number;
  /**
   * When the page last came back into view after at least RESUME_AFTER_S
   * in the background (s) — where iOS reclaims a GPU. Optional.
   */
  resumedAt?: number;
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
  /**
   * When the record was last written, by the wall clock (ms since the
   * epoch): when a killed page was last alive, across any sleep (a crash's
   * time and `restart_gap_s`). Optional: older records lack it.
   */
  lastWall?: number;
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

/**
 * A stretch in the background at least this long makes a resume (s): where
 * create-app's resume guard looks for a reclaimed GPU.
 */
const RESUME_AFTER_S = RESUME_AWAY_MS / 1000;
/** How long after a resume a report says how long ago it was (s). */
const RESUME_WINDOW_S = 60;

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
    ...(hidden ? { hiddenAt: 0, hiddenWall: Date.parse(setup.startedAt) } : {}),
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

/**
 * Adds an event; `wall` is the wall clock as it is noted (ms since the
 * epoch), what the time away is measured with.
 */
export function pushEvent(
  trail: Trail,
  event: TrailEvent,
  wall?: number
): void {
  if (event.kind === FIRST_FRAME) {
    trail.drew = true;
  }
  followVisibility(trail, event, wall);
  pushRing(trail.events, event, TRAIL_EVENTS);
  trail.firsts ??= {};
  trail.firsts[event.kind] ??= event.t;
}

/**
 * Keeps when the page went to the background and when it last came back
 * from a long stretch there (the browser side notes "hidden" and
 * "visible" as the document's visibility changes).
 */
function followVisibility(
  trail: Trail,
  event: TrailEvent,
  wall: number | undefined
): void {
  if (event.kind === "hidden") {
    trail.hiddenAt ??= event.t;
    if (wall !== undefined) {
      trail.hiddenWall ??= wall;
    }
  } else if (event.kind === "visible") {
    if (timeAway(trail, event, wall) >= RESUME_AFTER_S) {
      trail.resumedAt = event.t;
    }
    delete trail.hiddenAt;
    delete trail.hiddenWall;
  }
}

/**
 * How long (s) the page was in the background when it comes back (0 when
 * it was not): the longer of the two clocks — the page's own stops while
 * the device sleeps, the wall clock can be set back.
 */
function timeAway(
  trail: Trail,
  event: TrailEvent,
  wall: number | undefined
): number {
  const own = trail.hiddenAt === undefined ? 0 : event.t - trail.hiddenAt;
  const walled =
    trail.hiddenWall === undefined || wall === undefined
      ? 0
      : (wall - trail.hiddenWall) / 1000;
  return Math.max(own, walled);
}

/**
 * How long ago (s) the page came back from a long stretch in the
 * background, at `t` — or undefined when that is not recent
 * (RESUME_WINDOW_S) or never happened.
 */
export function resumedFor(trail: Trail, t: number): number | undefined {
  const since = trail.resumedAt === undefined ? -1 : t - trail.resumedAt;
  return since >= 0 && since < RESUME_WINDOW_S ? round(since, 1) : undefined;
}

/**
 * Appends a beat to the ring and, when the page rendered in view, counts
 * it in the stats: a beat before the first frame measures the boot, one
 * while hidden a paused loop — neither is the frame rate anybody saw.
 */
export function pushBeat(trail: Trail, beat: TrailBeat): void {
  const previous = trail.beats.at(-1);
  pushRing(trail.beats, beat, TRAIL_BEATS);
  // The stats are the frames rendered in view: not before the first, not
  // out of view, not after the render stopped, nor a beat that met no new
  // frame (a held or stopped loop) — those stay in the ring as the record.
  if (
    beat.frames === 0 ||
    beat.stopped ||
    (previous !== undefined && beat.frames <= previous.frames) ||
    trail.state === "hidden"
  ) {
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

/**
 * One heartbeat as a line of the report (and of the console), its parts
 * two spaces apart; a part an older record lacks is left out:
 *
 *     12.3s  f300 30fps  gpu 180MB rast 98MB held 512MB 5482a 274MB …
 *       90dc 1200k▲  tiles 3/2 terr 2f/5c  cache 412MB 320-600
 *       net 4d 2p 0f offline  pastel walk 2m
 */
export function formatBeat(b: TrailBeat): string {
  return [
    `${round(b.t, 1)}s`,
    `f${b.frames} ${round(b.fps)}fps`,
    memoryPart(b),
    `${b.calls}dc ${round(b.triangles / 1000)}k▲`,
    tilesPart(b),
    cachePart(b),
    netPart(b),
    `${b.style} ${b.mode} ${round(b.heightM)}m`,
  ]
    .filter((part) => part !== "")
    .join("  ");
}

/** The scene's estimate (and its rasters), three's count, the JS heap. */
function memoryPart(b: TrailBeat): string {
  const raster = b.rasterMB === undefined ? "" : ` rast ${round(b.rasterMB)}MB`;
  const held =
    b.heldMB === undefined ? "" : ` held ${round(b.heldMB)}MB ${b.held ?? ""}`;
  const heap = b.heapMB === undefined ? "" : ` heap ${round(b.heapMB)}MB`;
  return `gpu ${round(b.gpuMB)}MB${raster}${held.trimEnd()}${heap}`;
}

/** Building tiles / dressings, and the terrain levels: fine / coarse. */
function tilesPart(b: TrailBeat): string {
  const levels =
    b.fine === undefined || b.coarse === undefined
      ? ""
      : ` terr ${b.fine}f/${b.coarse}c`;
  return `tiles ${b.cities}/${b.dressings}${levels}`;
}

/** The tile cache: its bytes, then its bounds (min-max), MB. */
function cachePart(b: TrailBeat): string {
  if (b.cacheMB === undefined) {
    return "";
  }
  const bounds =
    b.cacheMinMB === undefined || b.cacheMaxMB === undefined
      ? ""
      : ` ${round(b.cacheMinMB)}-${round(b.cacheMaxMB)}`;
  return `cache ${round(b.cacheMB)}MB${bounds}`;
}

/** Tile contents in flight (downloading, parsing), failed, and offline. */
function netPart(b: TrailBeat): string {
  const flight =
    b.downloading === undefined
      ? ""
      : `net ${b.downloading}d ${b.parsing ?? 0}p ${b.failed ?? 0}f`;
  return b.online === false ? `${flight} offline`.trim() : flight;
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
        : ` · mem ${trail.deviceMemoryGB}GB`) +
      (trail.safety === undefined ? "" : ` · safety ${trail.safety}`),
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
