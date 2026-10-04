/**
 * Whether this browser sends crash reports (crash-reports.ts, ADR 0043),
 * and the visitor's "no" to them (ADR 0045): set on /datenschutz, kept in
 * local storage, read before every report goes out — so it holds at once
 * in every open tab. Small on purpose: the privacy page's switch imports
 * it, not the reports themselves.
 *
 * Where the browser keeps nothing (storage blocked), the "no" still holds
 * for this tab, in memory: the trail and its reports run without storage
 * too, and an objection must not depend on it.
 */
const DECLINED_KEY = "crash-reports.declined";

/** The "no" of this tab, for a browser that keeps nothing. */
let declinedHere = false;

/** Whether this browser (or, without storage, this tab) said no. */
export function reportsDeclined(): boolean {
  if (declinedHere) {
    return true;
  }
  try {
    return localStorage.getItem(DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Says no (or yes again); false when the browser keeps nothing. */
export function setReportsDeclined(declined: boolean): boolean {
  declinedHere = declined;
  try {
    if (declined) {
      localStorage.setItem(DECLINED_KEY, "1");
    } else {
      localStorage.removeItem(DECLINED_KEY);
    }
    // Kept: the storage speaks for every tab from here on.
    declinedHere = false;
    return true;
  } catch {
    return false;
  }
}

/** Whether this page sends reports, and if not, why. */
export type ReportsState = "on" | "no-dsn" | "gpc" | "declined";

/**
 * The build's DSN as next.config.ts inlined it — empty unless
 * `reportBuild` found one that parses.
 */
const HAS_DSN = (process.env.CRASH_REPORTS_DSN ?? "").trim() !== "";

export function reportsState(): ReportsState {
  if (!HAS_DSN) {
    return "no-dsn";
  }
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean })
    .globalPrivacyControl;
  if (gpc === true) {
    return "gpc";
  }
  return reportsDeclined() ? "declined" : "on";
}
