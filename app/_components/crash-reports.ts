import {
  crashReport,
  createProblemGate,
  envelope,
  envelopeUrl,
  type Payload,
  PROBLEM_KINDS,
  problemReport,
  type ReportContext,
  sessionEnvelope,
  type SessionPayload,
  sessionUpdate,
  summaryReport,
  TUNNEL_PATH,
} from "@/lib/city/crash-reports";
import { offerAsCrash, type Trail } from "@/lib/city/crash-trail";
import { previousTrail, type TrailListener } from "./crash-trail";
import { recentlyRecovered } from "./gpu-recovery";

/**
 * The crash reports' browser side (what goes out, and why:
 * lib/city/crash-reports.ts, ADR 0043). Off unless the build has a DSN
 * (`NEXT_PUBLIC_SENTRY_DSN`), and off for a visitor whose browser sends
 * Global Privacy Control. Each report is a beacon to the site's own
 * origin (`TUNNEL_PATH`, forwarded to the tracker by next.config.ts): no
 * SDK, nothing loaded from the tracker, and a beacon outlives the page
 * that sends it.
 *
 * The console says once per load whether the reports are on, where they
 * go and under which release; `crashReports.test()` sends one test event.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
/** The build's release and environment (next.config.ts, `reportBuild`). */
const RELEASE = orUndefined(process.env.CRASH_REPORTS_RELEASE);
const ENVIRONMENT = orUndefined(process.env.CRASH_REPORTS_ENV) ?? "production";
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

function orUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** Why this page sends no reports, or null when it does. */
function offReason(): string | null {
  if (envelopeUrl(DSN) === null) {
    return "no DSN in this build";
  }
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl;
  return gpc === true ? "the browser sends Global Privacy Control" : null;
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
 * use, its summary if it never sent one (a killed page cannot), and the
 * end of its session — `crashed`, or `exited` for a page that went to the
 * background and never came back.
 */
function reportPrevious(ctx: ReportContext): void {
  const previous = previousTrail();
  if (!previous) {
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
  const crashed = offerAsCrash(previous, recentlyRecovered());
  if (crashed) {
    sendEvent(crashReport(previous, newId(), ctx));
  }
  if (!previous.report?.summarized) {
    sendEvent(summaryReport(previous, newId(), ctx));
  }
  if (previous.report && !previous.report.ended) {
    sendSession(sessionUpdate(previous, crashed ? "crashed" : "exited", ctx));
  }
}

/** This page's record, for `crashReports.test()`. */
let current: Trail | null = null;

/** The page's session starts with its record. */
function begin(trail: Trail, ctx: ReportContext): void {
  trail.report = {
    sid: newId(),
    release: ctx.release,
    environment: ctx.environment,
    problems: 0,
    summarized: false,
    ended: false,
  };
  current = trail;
  sendSession(sessionUpdate(trail, "ok", ctx));
}

/** Hears this page's trail: its problems, its leaving, its end. */
function listen(ctx: ReportContext): TrailListener {
  const admit = createProblemGate();
  return (event, trail) => {
    if (event.kind === "start") {
      begin(trail, ctx);
    }
    const report = trail.report;
    if (!report) {
      return;
    }
    if (PROBLEM_KINDS.has(event.kind)) {
      report.problems += 1;
      if (admit(event)) {
        sendEvent(problemReport(trail, event, newId(), ctx));
      }
    }
    // The summary as the page goes out of view or away — on a phone,
    // "hidden" may be the last thing a page ever hears.
    if (LEAVING.has(event.kind) && !report.summarized) {
      report.summarized = true;
      sendEvent(summaryReport(trail, newId(), ctx));
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
      if (off || !current) {
        console.info(TAG, off ? `nothing sent: ${off}` : "no page yet");
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
 * reports are off.
 */
export function startCrashReports(): TrailListener | null {
  const ctx: ReportContext = {
    origin: location.origin,
    release: RELEASE,
    environment: ENVIRONMENT,
  };
  if (!started) {
    started = true;
    announce(ctx);
    if (crashReportsOn()) {
      reportPrevious(ctx);
    }
  }
  return crashReportsOn() ? listen(ctx) : null;
}
