import {
  FPS_BUCKETS,
  firstAt,
  formatBeat,
  resumedFor,
  round,
  type SummaryMark,
  type Trail,
  type TrailEvent,
  trailPhase,
} from "./crash-trail";
import { RESUME_WINDOW_MS } from "./gpu-safety";

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
 *   frame that threw, a GPU allocation that failed, a file that did not
 *   load, a failed boot, a GPU the page could not recover from) — until
 *   the page is past saving or leaving, after which a problem is its end's
 *   aftermath and only a breadcrumb (`isAftermath`).
 * - the page's **summary**, a transaction each time the page leaves view,
 *   for the stretch since the last one: the time to the first frame and to
 *   loaded (in the stretch they fell in), the frame rates while in view,
 *   the most memory held so far.
 * - the page's **session** (release health): started with the page, ended
 *   `exited` as it is left — or `crashed`, by the next load, when it died
 *   in use. Sentry's crash-free rate per release is these.
 *
 * Every report names the build it came from, `bridge@<commit>` (Sentry's
 * release; the build creates it with its commit and deploy,
 * scripts/sentry-release.ts), and goes to the site's own origin
 * (`TUNNEL_PATH`, which next.config.ts forwards to the tracker): a
 * blocker that drops requests to the tracker's host lets those through.
 *
 * What goes out is what the trail holds and nothing else: the path (no
 * query), the user agent, the screen and the device's memory, the
 * renderer, the events (`scrub`bed) and the beats — no position (the trail
 * has none), no user id (a session's id names the page, not the visitor),
 * no IP address (`sdk.settings.infer_ip: "never"`: Sentry infers none),
 * no cookie. No DOM.
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
  // a GPU allocation that failed in a compile: the page sheds and goes on
  "alloc-failed",
  // the render stopped and the page did not reload: the failure card
  "gpu failed",
]);
// Not "render stopped": it always follows a lost device or a failed frame,
// which say why. Nor what the viewer notes as it copes — "gpu reclaimed"
// (a GPU the system took while the page was in the background, restored
// by a reload), "memory emergency", "net-retry", "net-wait", "safety":
// those are the trail's breadcrumbs, never an event of their own.

/**
 * The problems that end the page: the render stops after them, or the boot
 * gives up. One goes out whatever the page reported before it (the cap is
 * for the problems a page goes on after: one out-of-memory episode alone
 * notes an allocation per part) — and only the first: the next is its echo
 * (a failure card after a failed frame).
 */
const PAGE_ENDING: ReadonlySet<string> = new Set([
  "device-lost",
  "frame failed",
  "boot failed",
  "gpu failed",
]);

/**
 * The problems a page reports once whatever their detail: every part a
 * GPU short of memory fails to make is one episode, one warning.
 */
const ONCE_A_PAGE: ReadonlySet<string> = new Set(["alloc-failed"]);

/** The most problems one page reports (a GPU error can repeat per frame). */
export const PROBLEMS_PER_PAGE = 5;

/** A report's severity, as Sentry names it. */
type ReportLevel = "fatal" | "error" | "warning";

/**
 * How bad a problem is: a lost device, a GPU the page could not recover
 * from and a failed boot end the page (fatal) — except a boot that gave
 * up on the network ("network: …", the detail the viewer gives a load it
 * retried in vain), which is the connection's failure, not the viewer's; a
 * failed allocation the page survived is a warning; everything else an
 * error.
 */
function problemLevel(event: TrailEvent): ReportLevel {
  switch (event.kind) {
    case "device-lost":
    case "gpu failed":
      return "fatal";
    case "boot failed":
      return event.detail?.startsWith("network:") ? "error" : "fatal";
    case "alloc-failed":
      return "warning";
    default:
      return "error";
  }
}

/**
 * The notes after which the page is past saving — its render stopped, it
 * reloads itself, or its GPU was taken in the background — so whatever
 * fails next is what its end leaves behind (a rejection from freeing what
 * the dead device held, a fetch the reload cancels).
 */
const PAST_SAVING: readonly string[] = [
  "render stopped",
  "reloading",
  "gpu reclaimed",
];
/** The problems a page causes itself as it leaves: a fetch cancelled. */
const LEAVING_PROBLEMS: ReadonlySet<string> = new Set([
  "load-error",
  "boot failed",
]);
/**
 * The signs of a GPU the system took (ADR 0046): a device lost, or an
 * allocation refused, while the page is hidden or just after a long
 * absence — what create-app's resume guard calls a reclaim. It notes
 * `gpu reclaimed` only as it stops the render, after the device's own
 * word: the order the signs arrive in must not decide the report.
 */
const RECLAIM_PROBLEMS: ReadonlySet<string> = new Set([
  "device-lost",
  "alloc-failed",
]);
/** create-app's window after a return, in the trail's seconds. */
const RECLAIM_WINDOW_S = RESUME_WINDOW_MS / 1000;

/**
 * Whether a problem the page notes is the aftermath of its end, kept as a
 * breadcrumb instead of a report of its own: once the page is past saving
 * (PAST_SAVING) or leaving (its record ended clean: pagehide, or the
 * viewer unmounted); a load that failed while the page was `hidden` — the
 * browser cancels a background page's fetches, and a reload's; and the
 * signs of a GPU the system reclaimed (RECLAIM_PROBLEMS). A page that
 * could not recover its GPU ("gpu failed": the failure card) is reported
 * past saving too — after a reclaim it is the only word there is.
 */
export function isAftermath(
  trail: Trail,
  event: TrailEvent,
  hidden: boolean
): boolean {
  if (trail.state === "clean") {
    return true;
  }
  if (event.kind === "gpu failed") {
    return false;
  }
  if (PAST_SAVING.some((kind) => firstAt(trail, kind) !== undefined)) {
    return true;
  }
  if (RECLAIM_PROBLEMS.has(event.kind) && reclaimedAt(trail, event, hidden)) {
    return true;
  }
  return hidden && LEAVING_PROBLEMS.has(event.kind);
}

/** Whether the GPU fails where the system takes it: hidden, or just back. */
function reclaimedAt(trail: Trail, event: TrailEvent, hidden: boolean) {
  return hidden || (resumedFor(trail, event.t) ?? Infinity) < RECLAIM_WINDOW_S;
}

/**
 * The release names' prefix: a name is global to a Sentry organisation,
 * so the commit alone could collide with another project's.
 */
export const RELEASE_PREFIX = "bridge@";

/**
 * Where the page sends its envelopes: a path on its own origin, which
 * next.config.ts rewrites to the tracker's envelope endpoint
 * (`tunnelRewrites`).
 */
export const TUNNEL_PATH = "/r/e";

/**
 * The sender, as Sentry's protocol names one: `infer_ip: "never"` is what
 * keeps Relay from deriving the visitor's address from the request.
 */
export const SDK = {
  name: "bridge.crash-reports",
  version: "1.0.0",
  settings: { infer_ip: "never" },
} as const;

/** What a build knows about its reports, from its environment. */
export interface ReportBuild {
  /** the DSN, or null when none (or none that parses) is set */
  dsn: string | null;
  /** `bridge@<commit>`, or SENTRY_RELEASE as given; none in a local build */
  release?: string;
  /** production, preview (Vercel's) or development */
  environment: string;
}

type Env = Record<string, string | undefined>;

/** The first of these that is set (an empty variable is not). */
export const firstSet = (...values: (string | undefined)[]) =>
  values.find((value) => value !== undefined && value.trim() !== "")?.trim();

/**
 * The one place the release name is derived — the page's tag (inlined by
 * next.config.ts) and the release the build creates
 * (scripts/sentry-release.ts) must be the same string, or Sentry shows a
 * release with commits and no events beside one with events and no
 * commits.
 */
export function reportBuild(env: Env): ReportBuild {
  const dsn = firstSet(env.NEXT_PUBLIC_SENTRY_DSN) ?? "";
  const commit = firstSet(env.VERCEL_GIT_COMMIT_SHA);
  return {
    dsn: envelopeUrl(dsn) ? dsn : null,
    release:
      firstSet(env.SENTRY_RELEASE) ??
      (commit ? `${RELEASE_PREFIX}${commit}` : undefined),
    environment:
      firstSet(env.SENTRY_ENVIRONMENT, env.VERCEL_ENV, env.NODE_ENV) ??
      "production",
  };
}

/** The rewrite that forwards `TUNNEL_PATH` to the DSN's tracker. */
export function tunnelRewrites(
  dsn: string | null
): { source: string; destination: string }[] {
  const destination = dsn ? envelopeUrl(dsn) : null;
  return destination ? [{ source: TUNNEL_PATH, destination }] : [];
}

/** What the reports carry besides the trail: this page's build. */
export interface ReportContext {
  /** the page's origin, to make the trail's path a URL */
  origin: string;
  release?: string;
  environment: string;
}

/** One envelope item's payload: an event, or a transaction. */
export interface Payload {
  event_id: string;
  type?: "transaction";
  [key: string]: unknown;
}

/** A session's states: ongoing, left, or died (release health). */
export type SessionStatus = "ok" | "exited" | "crashed";

/** One update of a session. */
export interface SessionPayload {
  sid: string;
  /** the first update of the session */
  init: boolean;
  started: string;
  timestamp: string;
  status: SessionStatus;
  errors: number;
  /** seconds, once it has ended */
  duration?: number;
  attrs: { release: string; environment: string; user_agent: string };
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

/** Header, item header and payload, one a line. */
const lines = (...parts: object[]) =>
  `${parts.map((v) => JSON.stringify(v)).join("\n")}\n`;

/** An event or a transaction as an envelope. */
export function envelope(dsn: string, payload: Payload, sentAt: Date): string {
  const header = {
    event_id: payload.event_id,
    dsn,
    sent_at: sentAt.toISOString(),
  };
  return lines(header, { type: payload.type ?? "event" }, payload);
}

/** A session update as an envelope. */
export function sessionEnvelope(
  dsn: string,
  session: SessionPayload,
  sentAt: Date
): string {
  return lines(
    { dsn, sent_at: sentAt.toISOString() },
    { type: "session" },
    session
  );
}

/** A URL in an event's text (a tile's file, a chunk in a stack). */
const URL_PATTERN = /\b[a-z]+:\/\/\S+/gi;

/**
 * An event's text as it may leave the device, with no place in it: the
 * numbers in a URL go (a tile's file names the 2 km cell the camera was
 * in — after *Standort*, where the visitor stands), and those of a bare
 * tile id (`33412_5656_2_sn`: digit runs joined by underscores), and so
 * does anything shaped like a coordinate (five digits and more, three
 * decimals and more).
 */
export function scrub(text: string): string {
  const blank = (s: string) => s.replace(/\d/g, "#");
  return text
    .replace(URL_PATTERN, blank)
    .replace(/\d+(?:_\d+)+/g, blank)
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
    .replace(URL_PATTERN, "<url>")
    .replace(/\d+/g, "#")
    .slice(0, 80)
    .trim();
}

/**
 * Which problems a page reports: each kind and key once (an allocation
 * failure once at all), no more than PROBLEMS_PER_PAGE of those the page
 * goes on after — the free tier's events are counted — and, past that
 * cap, the first problem that ends the page (PAGE_ENDING).
 */
export function createProblemGate(): (event: TrailEvent) => boolean {
  const seen = new Set<string>();
  let counted = 0;
  let ended = false;
  return (event) => {
    if (!PROBLEM_KINDS.has(event.kind)) {
      return false;
    }
    const key = ONCE_A_PAGE.has(event.kind)
      ? event.kind
      : `${event.kind} ${problemKey(event)}`;
    if (seen.has(key)) {
      return false;
    }
    if (PAGE_ENDING.has(event.kind)) {
      if (ended) {
        return false;
      }
      ended = true;
    } else if (counted >= PROBLEMS_PER_PAGE) {
      return false;
    } else {
      counted += 1;
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

/**
 * The build a record's page ran: its own, kept with it — a crash reported
 * by the next load may come from the release before — or, for a record
 * from before the reports, this page's.
 */
function buildOf(trail: Trail, ctx: ReportContext) {
  return trail.report
    ? { release: trail.report.release, environment: trail.report.environment }
    : { release: ctx.release, environment: ctx.environment };
}

/**
 * What every report carries: where, on what, how far the page got — and,
 * at `t` (s on the trail), how long ago it came back from the background.
 */
function common(trail: Trail, ctx: ReportContext, t: number) {
  const last = trail.beats.at(-1);
  return {
    platform: "javascript",
    ...buildOf(trail, ctx),
    // The user agent as a request header: Sentry reads browser, OS and
    // device from it.
    request: {
      url: ctx.origin + path(trail),
      headers: { "User-Agent": trail.userAgent },
    },
    // No address for the visitor: without this, Sentry's ingestion infers
    // one from the request for every `javascript` event that names none
    // (and treats `ip_address: null` the same). /datenschutz says none is
    // kept.
    sdk: SDK,
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
      // the budget the page ran on after earlier losses on the device
      safety: asTag(trail.safety),
      // a failure within a minute of coming back from the background is
      // where iOS took the GPU while the page was away
      resumed_s: asTag(resumedFor(trail, t)),
    },
    contexts: { page: pageContext(trail) },
  };
}

/** The page's numbers, shown with every report. */
function pageContext(trail: Trail) {
  const stats = trail.stats;
  const beats = stats?.beats ?? 0;
  const last = trail.beats.at(-1);
  const firstFrame = firstAt(trail, "first frame");
  const loaded = firstAt(trail, "loaded");
  return {
    first_frame_s: firstFrame === undefined ? undefined : round(firstFrame, 1),
    loaded_s: loaded === undefined ? undefined : round(loaded, 1),
    beats_in_view: beats,
    fps_mean: stats && beats > 0 ? round(stats.fpsSum / beats, 1) : undefined,
    max_held_mb: stats ? round(stats.maxHeldMB, 0) : undefined,
    max_gpu_mb: stats ? round(stats.maxGpuMB, 0) : undefined,
    max_heap_mb:
      stats?.maxHeapMB === undefined ? undefined : round(stats.maxHeapMB, 0),
    last_held_mb:
      last?.heldMB === undefined ? undefined : round(last.heldMB, 0),
    last_fps: last ? round(last.fps, 1) : undefined,
    last_tiles: last ? `${last.cities}/${last.dressings}` : undefined,
    last_raster_mb:
      last?.rasterMB === undefined ? undefined : round(last.rasterMB, 0),
    last_cache_mb:
      last?.cacheMB === undefined ? undefined : round(last.cacheMB, 0),
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
      level: PROBLEM_KINDS.has(e.kind) ? problemLevel(e) : "info",
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
  // (A sorted copy: `toSorted` is newer than some phones this reports on.)
  return {
    values: [...events, ...beats]
      .sort((a, b) => a.t - b.t)
      .map(({ crumb }) => crumb),
  };
}

/** What the page that reports a crash knows about it. */
export interface CrashContext {
  /** it follows a GPU recovery (gpu-recovery.ts `recentlyRecovered`) */
  recovered?: boolean;
  /** when it started (Unix s): how soon after the death */
  nextStart?: number;
}

/**
 * The previous page, which died in use: a fatal event, by phase — a page
 * that followed a GPU recovery as one of its own ("Recovery page died":
 * the recovery runs in a loop). `restart_gap_s` is how long after the
 * record's last entry (its last beat can be two seconds before the death)
 * the reporting page started: under ~2 s, that was Safari reloading a
 * page whose process it killed. Both by the wall clock where the record
 * has it (`lastWall`): the trail's own stops while the device sleeps.
 */
export function crashReport(
  trail: Trail,
  id: string,
  ctx: ReportContext,
  crash: CrashContext = {}
): Payload {
  const phase = trailPhase(trail);
  const end = lastT(trail);
  const base = common(trail, ctx, end);
  const died =
    trail.lastWall === undefined ? at(trail, end) : trail.lastWall / 1000;
  const gap =
    crash.nextStart === undefined || !Number.isFinite(crash.nextStart)
      ? undefined
      : round(crash.nextStart - died, 1);
  const [title, group] = crash.recovered
    ? ["Recovery page died", "recovery page died"]
    : ["Page died in use", "page died"];
  return {
    ...base,
    event_id: id,
    timestamp: died,
    level: "fatal",
    logger: "crash-trail",
    message: { formatted: `${title} (${phase}, ${trail.backend})` },
    tags: { ...base.tags, restart_gap_s: asTag(gap) },
    fingerprint: [group, trail.backend, phase],
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
  return {
    ...common(trail, ctx, event.t),
    event_id: id,
    timestamp: at(trail, event.t),
    level: problemLevel(event),
    logger: "crash-trail",
    message: {
      formatted: scrub(`${event.kind}: ${event.detail ?? ""}`.trim()),
    },
    fingerprint: [event.kind, problemKey(event)],
    breadcrumbs: breadcrumbs(trail),
  };
}

/** The page's stats since its last summary (the whole page for the first). */
function stretch(trail: Trail) {
  const stats = trail.stats;
  const sent = trail.report?.sent;
  return {
    from: sent?.t ?? 0,
    index: sent?.count ?? 0,
    beats: (stats?.beats ?? 0) - (sent?.beats ?? 0),
    fpsSum: (stats?.fpsSum ?? 0) - (sent?.fpsSum ?? 0),
    fps: (stats?.fps ?? []).map((n, i) => n - (sent?.fps[i] ?? 0)),
  };
}

/**
 * Whether the page has a stretch no summary covers: none went out yet, or
 * it rendered in view since the last one.
 */
export function summaryDue(trail: Trail): boolean {
  const sent = trail.report?.sent;
  return !sent || (trail.stats?.beats ?? 0) > sent.beats;
}

/** Where a summary sent now leaves the page (`TrailReport.sent`). */
export function summaryMark(trail: Trail): SummaryMark {
  const stats = trail.stats;
  return {
    t: lastT(trail),
    beats: stats?.beats ?? 0,
    fpsSum: stats?.fpsSum ?? 0,
    fps: [...(stats?.fps ?? [])],
    count: (trail.report?.sent?.count ?? 0) + 1,
  };
}

/**
 * The page's stretch since its last summary, as a transaction — one each
 * time it leaves view, so a page that comes back is measured again and a
 * page counts once (`stretch: 1`). Its boot milestones go in the stretch
 * they fell in; the memory peaks are the page's so far.
 */
export function summaryReport(
  trail: Trail,
  id: string,
  ctx: ReportContext
): Payload {
  const base = common(trail, ctx, lastT(trail));
  const part = stretch(trail);
  const measurements: Record<string, { value: number; unit: string }> = {};
  const measure = (name: string, value: number | undefined, unit: string) => {
    if (value !== undefined && Number.isFinite(value)) {
      measurements[name] = { value, unit };
    }
  };
  const milestone = (name: string, kind: string) => {
    const t = firstAt(trail, kind);
    measure(name, t !== undefined && t >= part.from ? t : undefined, "second");
  };
  milestone("first_frame", "first frame");
  milestone("loaded", "loaded");
  measure("beats_in_view", part.beats, "none");
  if (part.beats > 0) {
    measure("fps_mean", part.fpsSum / part.beats, "none");
    // The share of the stretch in view below 10, 20 and 30 fps.
    let below = 0;
    FPS_BUCKETS.slice(0, 3).forEach((bound, i) => {
      below += part.fps[i] ?? 0;
      measure(`fps_below_${bound}`, below / part.beats, "ratio");
    });
    measure("held_max", trail.stats?.maxHeldMB, "megabyte");
    measure("heap_max", trail.stats?.maxHeapMB, "megabyte");
  }
  return {
    ...base,
    event_id: id,
    type: "transaction",
    transaction: path(trail),
    transaction_info: { source: "url" },
    start_timestamp: at(trail, part.from),
    timestamp: at(trail, lastT(trail)),
    tags: { ...base.tags, stretch: String(part.index + 1) },
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

/**
 * A session update for the record's page, or null where it has no session
 * (a record from before the reports) or no release to count it under.
 * `ok` starts it; `exited` and `crashed` end it, and nothing follows them.
 */
export function sessionUpdate(
  trail: Trail,
  status: SessionStatus,
  ctx: ReportContext
): SessionPayload | null {
  const report = trail.report;
  const { release, environment } = buildOf(trail, ctx);
  if (!(report && release)) {
    return null;
  }
  const ended = status !== "ok";
  return {
    sid: report.sid,
    init: !ended,
    started: trail.startedAt,
    timestamp: new Date(
      at(trail, ended ? lastT(trail) : 0) * 1000
    ).toISOString(),
    status,
    errors: report.problems,
    duration: ended ? round(lastT(trail), 3) : undefined,
    attrs: { release, environment, user_agent: trail.userAgent },
  };
}
