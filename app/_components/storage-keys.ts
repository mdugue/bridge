/**
 * Every key the viewer keeps in the browser's storage (ADR 0045: the
 * privacy page, app/(legal)/datenschutz/page.mdx, names each one; its
 * test holds it to that). A new key is added here first.
 */
export const STORAGE_KEYS = {
  /** the last picture style (style-memory.ts) */
  style: "bildstil",
  /** the control hints closed (control-hints.tsx) */
  hintsDismissed: "city-walk:hints-dismissed",
  /** Modell's hints closed (control-hints.tsx) */
  modelHintsDismissed: "city-walk:model-hints-dismissed",
  /** the toolbar folded (hud-toolbar.tsx) */
  toolbarCollapsed: "hud-toolbar-collapsed",
  /** this page's crash trail (crash-trail.ts) */
  trail: "crash-trail",
  /** the previous page's trail (crash-trail.ts) */
  trailPrevious: "crash-trail.previous",
  /** which previous trail was reported (crash-reports.ts) */
  trailReported: "crash-trail.reported",
  /** the visitor's "no" to the reports (report-choice.ts) */
  reportsDeclined: "crash-reports.declined",
  /** the device's safety level (gpu-safety.ts, ADR 0046) */
  gpuSafety: "gpu-safety",
} as const;

/** Session storage: gone with the tab. */
export const SESSION_KEYS = {
  /** the view a GPU recovery returns to (gpu-recovery.ts) */
  gpuRecovery: "gpu-recovery",
} as const;
