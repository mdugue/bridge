/**
 * A visitor's "no" to the crash reports (crash-reports.ts, ADR 0043),
 * kept in this browser's local storage: set on /datenschutz, read before
 * every report goes out, so it holds at once in every open tab. Without
 * storage there is no choice to keep — and no crash trail either.
 */
const DECLINED_KEY = "crash-reports.declined";

/** Whether this browser said no to the reports. */
export function reportsDeclined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Says no (or yes again); false when the browser keeps nothing. */
export function setReportsDeclined(declined: boolean): boolean {
  try {
    if (declined) {
      localStorage.setItem(DECLINED_KEY, "1");
    } else {
      localStorage.removeItem(DECLINED_KEY);
    }
    return true;
  } catch {
    return false;
  }
}
