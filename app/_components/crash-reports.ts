import {
  crashReport,
  createProblemGate,
  envelope,
  firstSet,
  isAftermath,
  type Payload,
  PROBLEM_KINDS,
  problemReport,
  type ReportContext,
  sessionEnvelope,
  type SessionPayload,
  sessionUpdate,
  summaryDue,
  summaryMark,
  summaryReport,
  TUNNEL_PATH,
} from "@/lib/city/crash-reports";
import { offerAsCrash, type Trail } from "@/lib/city/crash-trail";
import {
  pageStillOpen,
  previousTrail,
  type TrailListener,
} from "./crash-trail";
import { recentlyRecovered } from "./gpu-recovery";
import {
  type ReportsState,
  reportsDeclined,
  reportsState,
} from "./report-choice";

/**
 * The crash reports' browser side (what goes out, and why:
 * lib/city/crash-reports.ts, ADR 0043). Off unless the build has a DSN
 * (`NEXT_PUBLIC_SENTRY_DSN`, as `reportBuild` read it: next.config.ts
 * inlines it), off for a visitor whose browser sends Global Privacy
 * Control, and off in a browser that said no on /datenschutz
 * (report-choice.ts — checked before every report, so it holds at once in
 * a tab already open; ADR 0045). Each report is a beacon to the site's own
 * origin (`TUNNEL_PATH`, forwarded to the tracker by next.config.ts): no
 * SDK, nothing loaded from the tracker, and a beacon outlives the page
 * that sends it.
 *
 * The console says once per load whether the reports are on, where they
 * go and under which release; `crashReports.test()` sends one test event.
 */

/** The build's DSN, release and environment (next.config.ts, `reportBuild`). */
const DSN = firstSet(process.env.CRASH_REPORTS_DSN) ?? "";
const RELEASE = firstSet(process.env.CRASH_REPORTS_RELEASE);
const ENVIRONMENT = firstSet(process.env.CRASH_REPORTS_ENV) ?? "production";
/** The start of the last previous record reported, so it goes out once. */
const REPORTED_KEY = "crash-trail.reported";
const TAG = "[crash-reports]";

/** The events that leave the page's view (the summary goes out) … */
const LEAVING = new Set(["hidden", "pagehide", "end"]);
/** … and those after which it is gone (its session ends). */
const LEFT = new Set(["pagehide", "end"]);

declare global {
  interface Window {
    /** Whether and where the reports go; `test()` sends a test event. */
    crashReports?: { status: string; test: () => void };
  }
}

const OFF_REASONS: Record<Exclude<ReportsState, "on">, string> = {
  "no-dsn": "no DSN in this build",
  gpc: "the browser sends Global Privacy Control",
  declined: "turned off in this browser (/datenschutz)",
};

/** Why this page sends no reports, or null when it does. */
function offReason(): string | null {
  const state = reportsState();
  return state === "on" ? null : OFF_REASONS[state];
}

/** Whether this page sends reports (the crash card says so). */
export function crashReportsOn(): boolean {
  return offReason() === null;
}

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

function post(body: string): void {
  // Said no since the page started (on /datenschutz, maybe in another
  // tab): nothing goes out after a no — the session's end included, so
  // Sentry closes that session itself.
  if (reportsDeclined()) {
    return;
  }
  try {
    // A string goes as text/plain: no preflight, which a beacon cannot make.
    if (navigator.sendBeacon(TUNNEL_PATH, body)) {
      return;
    }
  } catch {
    // No beacon (or refused): the fetch below.
  }
  fetch(TUNNEL_PATH, { method: "POST", body, keepalive: true }).catch(() => {
    // Lost: a report is never worth an error of its own.
  });
}

const sendEvent = (payload: Payload) =>
  post(envelope(DSN, payload, new Date()));

const sendSession = (session: SessionPayload | null) => {
  if (session) {
    post(sessionEnvelope(DSN, session, new Date()));
  }
};

/**
 * The previous page's record, once per record: its crash if it died in
 * use, the stretch no summary covered (a killed page sends none), and the
 * end of its session — `crashed`, or `exited` for a page that went to the
 * background and never came back. Not while that page is still open in
 * another tab: its record only looks ended (crash-trail.ts).
 */
async function reportPrevious(ctx: ReportContext): Promise<void> {
  const previous = previousTrail();
  if (!previous || (await pageStillOpen(previous))) {
    return;
  }
  try {
    if (localStorage.getItem(REPORTED_KEY) === previous.startedAt) {
      return;
    }
    localStorage.setItem(REPORTED_KEY, previous.startedAt);
  } catch {
    // No storage, no previous record either.
    return;
  }
  const recovered = recentlyRecovered();
  const crashed = offerAsCrash(previous, recovered);
  if (crashed) {
    sendEvent(
      crashReport(previous, newId(), ctx, {
        recovered,
        // This page's navigation start: how soon it followed the death.
        nextStart: performance.timeOrigin / 1000,
      })
    );
  }
  if (summaryDue(previous)) {
    sendEvent(summaryReport(previous, newId(), ctx));
  }
  if (previous.report && !previous.report.ended) {
    sendSession(sessionUpdate(previous, crashed ? "crashed" : "exited", ctx));
  }
}

/** This page's record, for `crashReports.test()`. */
let current: Trail | null = null;

/**
 * The page's session starts with its record — and again when the page
 * comes back from the back-forward cache, its old session having ended
 * as it left (its summaries carry on where they were).
 */
function begin(trail: Trail, ctx: ReportContext): void {
  trail.report = {
    sid: newId(),
    release: ctx.release,
    environment: ctx.environment,
    problems: 0,
    sent: trail.report?.sent,
    ended: false,
  };
  current = trail;
  sendSession(sessionUpdate(trail, "ok", ctx));
}

/**
 * Hears this page's trail: its problems, its leaving, its end. A problem
 * that is the aftermath of the page's end (`isAftermath`: after its render
 * stopped or as it leaves) stays a breadcrumb — no event, no error on the
 * session.
 */
function listen(ctx: ReportContext): TrailListener {
  const admit = createProblemGate();
  return (event, trail) => {
    if (
      event.kind === "start" ||
      (event.kind === "pageshow" && trail.report?.ended)
    ) {
      begin(trail, ctx);
    }
    const report = trail.report;
    if (!report) {
      return;
    }
    if (
      PROBLEM_KINDS.has(event.kind) &&
      !isAftermath(trail, event, document.visibilityState === "hidden")
    ) {
      report.problems += 1;
      if (admit(event)) {
        sendEvent(problemReport(trail, event, newId(), ctx));
      }
    }
    // A summary each time the page goes out of view or away — on a phone,
    // "hidden" may be the last thing a page ever hears.
    if (LEAVING.has(event.kind) && summaryDue(trail)) {
      sendEvent(summaryReport(trail, newId(), ctx));
      report.sent = summaryMark(trail);
    }
    if (LEFT.has(event.kind) && !report.ended) {
      report.ended = true;
      sendSession(sessionUpdate(trail, "exited", ctx));
    }
  };
}

/** Says once per load, in the console, whether and where reports go. */
function announce(ctx: ReportContext): void {
  const off = offReason();
  const status = off
    ? `off: ${off}`
    : `on → ${new URL(DSN).host} via ${TUNNEL_PATH} · ` +
      `${ctx.release ?? "no release (no sessions)"} · ${ctx.environment}`;
  console.info(TAG, status);
  window.crashReports = {
    status,
    test: () => {
      // Asked now: the visitor may have said no since the page started.
      const offNow = offReason();
      if (offNow || !current) {
        console.info(TAG, offNow ? `nothing sent: ${offNow}` : "no page yet");
        return;
      }
      const t = (Date.now() - Date.parse(current.startedAt)) / 1000;
      sendEvent(
        problemReport(
          current,
          { t, kind: "test", detail: "crashReports.test()" },
          newId(),
          ctx
        )
      );
      console.info(TAG, "test event sent");
    },
  };
}

let started = false;

/**
 * Starts this page's reports: the previous page's first (once per load —
 * StrictMode mounts the viewer twice in development), then a listener for
 * this page's trail (crash-trail.ts `startCrashTrail`), or null when the
 * reports are off — or when anything in them fails: a report is never
 * worth the viewer's boot.
 */
export function startCrashReports(): TrailListener | null {
  try {
    const ctx: ReportContext = {
      origin: location.origin,
      release: RELEASE,
      environment: ENVIRONMENT,
    };
    if (!started) {
      started = true;
      announce(ctx);
      if (crashReportsOn()) {
        reportPrevious(ctx).catch(() => {
          // The previous page's report is lost; this page's are not.
        });
      }
    }
    return crashReportsOn() ? listen(ctx) : null;
  } catch {
    return null;
  }
}
