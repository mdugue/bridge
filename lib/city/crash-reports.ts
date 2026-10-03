import {
  FPS_BUCKETS,
  firstAt,
  formatBeat,
  type Trail,
  type TrailEvent,
  trailPhase,
} from "./crash-trail";

/**
 * The viewer's reports to an error tracker, built from the crash trail
 * (lib/city/crash-trail.ts) in Sentry's envelope protocol — so Sentry, or
 * anything that speaks it (GlitchTip, Bugsink). The browser side that
 * sends them, and only where a DSN is set, is
 * app/_components/crash-reports.ts; why, ADR 0043. Three kinds:
 *
 * - a **crash**: the previous page died in use (`offerAsCrash`). A page the
 *   browser kills runs no handler, so no SDK could have said so; its trail
 *   is reported by the next load, its last events and beats as breadcrumbs.
 * - a **problem** on this page: an uncaught error, or one of the failures
 *   the viewer catches itself and notes (a lost device, a GPU error, a
 *   frame that threw, a file that did not load, a failed boot).
 * - the page's **summary**, a transaction: the time to the first frame and
 *   to loaded, the frame rates while in view, the most memory held.
 *
 * What goes out is what the trail holds and nothing else: the path (no
 * query), the user agent, the screen and the device's memory, the
 * renderer, the events (`scrub`bed) and the beats — no position (the trail
 * has none), no id, no cookie. No DOM.
 */

/** The noted events that are problems worth a report of their own. */
export const PROBLEM_KINDS: ReadonlySet<string> = new Set([
  "error",
  "rejection",
  "device-lost",
  "gpu-error",
  "frame failed",
  "load-error",
  "boot failed",
]);
// Not "render stopped": it always follows a lost device or a failed frame,
// which say why.

/** The most problems one page reports (a GPU error can repeat per frame). */
export const PROBLEMS_PER_PAGE = 5;

/** What the reports carry besides the trail. */
export interface ReportContext {
  /** the page's origin, to make the trail's path a URL */
  origin: string;
  /** the build (a commit), to tell a fix's effect */
  release?: string;
  environment: string;
}

/** One envelope item's payload: an event, or a transaction. */
export interface Payload {
  event_id: string;
  type?: "transaction";
  [key: string]: unknown;
}

/**
 * Where a DSN's envelopes go, the key in the query (a beacon sends no
 * headers), or null for anything that is not a DSN
 * (`https://<key>@<host>[/<path>]/<project>`).
 */
export function envelopeUrl(dsn: string): string | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const path = url.pathname.split("/").filter(Boolean);
  const project = path.pop();
  if (!(url.username && project && /^\d+$/.test(project))) {
    return null;
  }
  const prefix = path.map((part) => `/${part}`).join("");
  return (
    `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/` +
    `?sentry_key=${url.username}&sentry_version=7`
  );
}

/** One payload as an envelope (header, item header, payload; one a line). */
export function envelope(dsn: string, payload: Payload, sentAt: Date): string {
  const header = {
    event_id: payload.event_id,
    dsn,
    sent_at: sentAt.toISOString(),
  };
  const item = { type: payload.type ?? "event" };
  return `${[header, item, payload].map((v) => JSON.stringify(v)).join("\n")}\n`;
}

/**
 * An event's text as it may leave the device, with no place in it: the
 * numbers in a URL go (a tile's file names the 2 km cell the camera was
 * in — after *Standort*, where the visitor stands), and so does anything
 * shaped like a coordinate (five digits and more, three decimals and
 * more).
 */
export function scrub(text: string): string {
  const blank = (s: string) => s.replace(/\d/g, "#");
  return text
    .replace(/\b[a-z]+:\/\/\S+/gi, blank)
    .replace(/\d+\.\d{3,}|\d{5,}(?:\.\d+)?/g, blank);
}

/** One event as a breadcrumb's line (the crumb has the time), scrubbed. */
const eventLine = (e: TrailEvent) =>
  e.detail ? `${e.kind}  ${scrub(e.detail)}` : e.kind;

/**
 * What groups a problem: its kind's detail with the URLs, numbers and
 * the stack beyond the first line taken out — one tile that fails to
 * load is the same problem as the next.
 */
export function problemKey(event: TrailEvent): string {
  return (event.detail ?? "")
    .split(" | ")[0]
    .replace(/\b[a-z]+:\/\/\S+/gi, "<url>")
    .replace(/\d+/g, "#")
    .slice(0, 80)
    .trim();
}

/**
 * Which problems a page reports: each kind and key once, and no more than
 * PROBLEMS_PER_PAGE in all — the free tier's events are counted.
 */
export function createProblemGate(): (event: TrailEvent) => boolean {
  const seen = new Set<string>();
  return (event) => {
    if (!PROBLEM_KINDS.has(event.kind) || seen.size >= PROBLEMS_PER_PAGE) {
      return false;
    }
    const key = `${event.kind} ${problemKey(event)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}

/** A time on the trail (s since its start) as a Unix time (s). */
function at(trail: Trail, t: number): number {
  return Date.parse(trail.startedAt) / 1000 + t;
}

/** The trail's last moment (s since its start). */
function lastT(trail: Trail): number {
  return Math.max(trail.events.at(-1)?.t ?? 0, trail.beats.at(-1)?.t ?? 0);
}

function path(trail: Trail): string {
  return trail.url.split(/[?#]/)[0] ?? "/";
}

const asTag = (value: number | undefined) =>
  value === undefined ? undefined : String(value);

/** What every report carries: where, on what, how far the page got. */
function common(trail: Trail, ctx: ReportContext) {
  const last = trail.beats.at(-1);
  return {
    platform: "javascript",
    release: ctx.release,
    environment: ctx.environment,
    // The user agent as a request header: Sentry reads browser, OS and
    // device from it.
    request: {
      url: ctx.origin + path(trail),
      headers: { "User-Agent": trail.userAgent },
    },
    tags: {
      site: path(trail).split("/")[1] || "start",
      backend: trail.backend,
      phase: trailPhase(trail),
      ended: trail.state,
      style: last?.style,
      mode: last?.mode,
      screen: trail.screen,
      pixel_ratio: asTag(trail.pixelRatio),
      device_memory_gb: asTag(trail.deviceMemoryGB),
    },
    contexts: { page: pageContext(trail) },
  };
}

const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** The page's numbers, shown with every report. */
function pageContext(trail: Trail) {
  const stats = trail.stats;
  const beats = stats?.beats ?? 0;
  const last = trail.beats.at(-1);
  const firstFrame = firstAt(trail, "first frame");
  const loaded = firstAt(trail, "loaded");
  return {
    first_frame_s: firstFrame === undefined ? undefined : round(firstFrame),
    loaded_s: loaded === undefined ? undefined : round(loaded),
    beats_in_view: beats,
    fps_mean: stats && beats > 0 ? round(stats.fpsSum / beats) : undefined,
    max_held_mb: stats ? round(stats.maxHeldMB, 0) : undefined,
    max_gpu_mb: stats ? round(stats.maxGpuMB, 0) : undefined,
    max_heap_mb:
      stats?.maxHeapMB === undefined ? undefined : round(stats.maxHeapMB, 0),
    last_held_mb:
      last?.heldMB === undefined ? undefined : round(last.heldMB, 0),
    last_fps: last ? round(last.fps) : undefined,
    last_tiles: last ? `${last.cities}/${last.dressings}` : undefined,
    last_height_m: last ? round(last.heightM, 0) : undefined,
  };
}

/** The trail's rings as breadcrumbs, oldest first: what led up to it. */
function breadcrumbs(trail: Trail) {
  const events = trail.events.map((e) => ({
    t: e.t,
    crumb: {
      timestamp: at(trail, e.t),
      category: "trail",
      message: eventLine(e),
      level: PROBLEM_KINDS.has(e.kind) ? "error" : "info",
    },
  }));
  const beats = trail.beats.map((b) => ({
    t: b.t,
    crumb: {
      timestamp: at(trail, b.t),
      category: "beat",
      message: formatBeat(b),
      level: "debug",
    },
  }));
  return {
    values: [...events, ...beats]
      .toSorted((a, b) => a.t - b.t)
      .map(({ crumb }) => crumb),
  };
}

/** The previous page, which died in use: a fatal event, by phase. */
export function crashReport(
  trail: Trail,
  id: string,
  ctx: ReportContext
): Payload {
  const phase = trailPhase(trail);
  return {
    ...common(trail, ctx),
    event_id: id,
    timestamp: at(trail, lastT(trail)),
    level: "fatal",
    logger: "crash-trail",
    message: { formatted: `Page died in use (${phase}, ${trail.backend})` },
    fingerprint: ["page died", trail.backend, phase],
    breadcrumbs: breadcrumbs(trail),
  };
}

/** A problem the page noted, with the trail so far. */
export function problemReport(
  trail: Trail,
  event: TrailEvent,
  id: string,
  ctx: ReportContext
): Payload {
  const fatal = event.kind === "device-lost" || event.kind === "boot failed";
  return {
    ...common(trail, ctx),
    event_id: id,
    timestamp: at(trail, event.t),
    level: fatal ? "fatal" : "error",
    logger: "crash-trail",
    message: {
      formatted: scrub(`${event.kind}: ${event.detail ?? ""}`.trim()),
    },
    fingerprint: [event.kind, problemKey(event)],
    breadcrumbs: breadcrumbs(trail),
  };
}

/**
 * The page in numbers, as a transaction over its whole time: Sentry keeps
 * these apart from the events, and can chart and filter them.
 */
export function summaryReport(
  trail: Trail,
  id: string,
  ctx: ReportContext
): Payload {
  const base = common(trail, ctx);
  const stats = trail.stats;
  const beats = stats?.beats ?? 0;
  const measurements: Record<string, { value: number; unit: string }> = {};
  const measure = (name: string, value: number | undefined, unit: string) => {
    if (value !== undefined && Number.isFinite(value)) {
      measurements[name] = { value, unit };
    }
  };
  measure("first_frame", firstAt(trail, "first frame"), "second");
  measure("loaded", firstAt(trail, "loaded"), "second");
  measure("beats_in_view", beats, "none");
  if (stats && beats > 0) {
    measure("fps_mean", stats.fpsSum / beats, "none");
    // The share of the time in view below 10, 20 and 30 fps.
    let below = 0;
    FPS_BUCKETS.slice(0, 3).forEach((bound, i) => {
      below += stats.fps[i] ?? 0;
      measure(`fps_below_${bound}`, below / beats, "ratio");
    });
    measure("held_max", stats.maxHeldMB, "megabyte");
    measure("heap_max", stats.maxHeapMB, "megabyte");
  }
  return {
    ...base,
    event_id: id,
    type: "transaction",
    transaction: path(trail),
    transaction_info: { source: "url" },
    start_timestamp: at(trail, 0),
    timestamp: at(trail, lastT(trail)),
    contexts: {
      ...base.contexts,
      trace: {
        trace_id: id,
        span_id: id.slice(16),
        op: "page",
        status: "ok",
      },
    },
    measurements,
    spans: [],
  };
}
