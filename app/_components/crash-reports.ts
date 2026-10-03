import {
  crashReport,
  createProblemGate,
  envelope,
  envelopeUrl,
  type Payload,
  problemReport,
  type ReportContext,
  summaryReport,
} from "@/lib/city/crash-reports";
import { offerAsCrash } from "@/lib/city/crash-trail";
import { previousTrail, type TrailListener } from "./crash-trail";
import { recentlyRecovered } from "./gpu-recovery";

/**
 * The crash reports' browser side (what goes out, and why:
 * lib/city/crash-reports.ts, ADR 0043). Off unless the build has a DSN
 * (`NEXT_PUBLIC_SENTRY_DSN`), and off for a visitor whose browser sends
 * Global Privacy Control. Each report is a beacon: no SDK, nothing loaded
 * from the tracker, and a beacon outlives the page that sends it — the
 * page's summary goes out as it is hidden or left.
 */

/** The first of these that is set (an empty variable is not). */
const firstSet = (...values: (string | undefined)[]) =>
  values.find((value) => value !== undefined && value !== "");

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
/** The build, to tell a fix's effect (on Vercel, its commit). */
const RELEASE = firstSet(
  process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
);
const ENVIRONMENT =
  firstSet(process.env.NEXT_PUBLIC_VERCEL_ENV, process.env.NODE_ENV) ??
  "production";
/** The start of the last previous record reported, so it goes out once. */
const REPORTED_KEY = "crash-trail.reported";

/** Whether this page sends reports (the crash card says so). */
export function crashReportsOn(): boolean {
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl;
  return envelopeUrl(DSN) !== null && gpc !== true;
}

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

function send(url: string, payload: Payload): void {
  const body = envelope(DSN, payload, new Date());
  try {
    // A string goes as text/plain: no preflight, which a beacon cannot make.
    if (navigator.sendBeacon(url, body)) {
      return;
    }
  } catch {
    // No beacon (or refused): the fetch below.
  }
  fetch(url, {
    method: "POST",
    body,
    keepalive: true,
    mode: "no-cors",
    credentials: "omit",
  }).catch(() => {
    // Lost: a report is never worth an error of its own.
  });
}

/**
 * The previous page's record, once per record: its crash if it died in
 * use, and its summary if it never sent one (a killed page cannot).
 */
function reportPrevious(url: string, ctx: ReportContext): void {
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
  if (offerAsCrash(previous, recentlyRecovered())) {
    send(url, crashReport(previous, newId(), ctx));
  }
  if (!previous.summarized) {
    send(url, summaryReport(previous, newId(), ctx));
  }
}

let previousReported = false;

/**
 * Starts this page's reports: the previous page's first (once per load —
 * StrictMode mounts the viewer twice in development), then a listener for
 * this page's trail (crash-trail.ts `startCrashTrail`), or null when the
 * reports are off.
 */
export function startCrashReports(): TrailListener | null {
  const url = envelopeUrl(DSN);
  if (!(url && crashReportsOn())) {
    return null;
  }
  const ctx: ReportContext = {
    origin: location.origin,
    release: RELEASE,
    environment: ENVIRONMENT,
  };
  if (!previousReported) {
    previousReported = true;
    reportPrevious(url, ctx);
  }
  const admit = createProblemGate();
  return (event, trail) => {
    if (admit(event)) {
      send(url, problemReport(trail, event, newId(), ctx));
    }
    // The summary as the page goes out of view or away — on a phone,
    // "hidden" may be the last thing a page ever hears.
    const leaving =
      event.kind === "hidden" ||
      event.kind === "pagehide" ||
      event.kind === "end";
    if (leaving && !trail.summarized) {
      trail.summarized = true;
      send(url, summaryReport(trail, newId(), ctx));
    }
  };
}
