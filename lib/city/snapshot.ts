/**
 * The Snapshot contract: a fully reproducible capture of the view (camera
 * pose + sun instant + every look control) as it round-trips through JSON.
 * `parseSnapshot` validates a pasted snapshot before anything is applied, so
 * a trimmed or hand-edited one (the documented QA workflow) reports what is
 * wrong instead of yielding NaN camera matrices. No THREE, no DOM.
 */
import {
  type FocusMode,
  LOOK_CONTROLS,
  type LookValues,
} from "./look-controls";
import { isRenderStyle, RENDER_STYLES, type RenderStyle } from "./render-style";

export type MovementModeJson = "fly" | "walk";

/** Camera pose as it round-trips through JSON (lib/city/pose.ts's CameraState IS this type). */
export interface CameraStateJson {
  epsg: { x: number; y: number };
  fov: number;
  /** 0 = north, clockwise positive (east) */
  headingDeg: number;
  mode: MovementModeJson;
  /** + = looking up, - = looking down */
  pitchDeg: number;
  pos: { x: number; y: number; z: number };
}

export interface SnapshotLook {
  dof?: boolean;
  focusDistanceM?: number;
  focusMode?: FocusMode;
  multiTuft?: boolean;
  /** the picture style; absent in older snapshots (they keep the current one) */
  style?: RenderStyle;
  /**
   * Per-control percentages, keyed by LookControlDef.snapshotKey (all
   * optional: older snapshots omit newer controls).
   */
  [pctKey: string]: boolean | number | string | undefined;
}

export interface Snapshot {
  camera: CameraStateJson;
  /** ISO instant driving the sun */
  date: string;
  look?: SnapshotLook;
  v: number;
}

export const SNAPSHOT_VERSION = 1;

export type SnapshotParse =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: string };

class SnapshotError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Asserts a finite number at `path` (1e999 parses to Infinity — rejected). */
function finite(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SnapshotError(`${path} must be a finite number`);
  }
  return v;
}

function record(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new SnapshotError(`${path} must be an object`);
  }
  return v;
}

function checkCamera(v: unknown): CameraStateJson {
  const c = record(v, "camera");
  const pos = record(c.pos, "camera.pos");
  const epsg = record(c.epsg, "camera.epsg");
  const fov = finite(c.fov, "camera.fov");
  if (fov <= 0 || fov >= 180) {
    throw new SnapshotError("camera.fov must be between 0 and 180");
  }
  if (c.mode !== "walk" && c.mode !== "fly") {
    throw new SnapshotError('camera.mode must be "walk" or "fly"');
  }
  return {
    pos: {
      x: finite(pos.x, "camera.pos.x"),
      y: finite(pos.y, "camera.pos.y"),
      z: finite(pos.z, "camera.pos.z"),
    },
    epsg: {
      x: finite(epsg.x, "camera.epsg.x"),
      y: finite(epsg.y, "camera.epsg.y"),
    },
    fov,
    headingDeg: finite(c.headingDeg, "camera.headingDeg"),
    pitchDeg: finite(c.pitchDeg, "camera.pitchDeg"),
    mode: c.mode,
  };
}

function checkDate(v: unknown): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new SnapshotError("date must be an ISO date string");
  }
  return v;
}

function checkLookFlags(look: Record<string, unknown>): void {
  for (const key of ["dof", "multiTuft"]) {
    if (look[key] !== undefined && typeof look[key] !== "boolean") {
      throw new SnapshotError(`look.${key} must be a boolean`);
    }
  }
  const mode = look.focusMode;
  if (mode !== undefined && mode !== "auto" && mode !== "manual") {
    throw new SnapshotError('look.focusMode must be "auto" or "manual"');
  }
  const dist = look.focusDistanceM;
  if (dist !== undefined && finite(dist, "look.focusDistanceM") < 1) {
    throw new SnapshotError("look.focusDistanceM must be at least 1");
  }
  if (look.style !== undefined && !isRenderStyle(look.style)) {
    const ids = RENDER_STYLES.map((def) => `"${def.id}"`).join(", ");
    throw new SnapshotError(`look.style must be one of ${ids}`);
  }
}

/** Percent keys must be finite numbers when present; range is clamped by the applier. */
function checkLook(v: unknown): SnapshotLook {
  const look = record(v, "look");
  for (const def of LOOK_CONTROLS) {
    if (look[def.snapshotKey] !== undefined) {
      finite(look[def.snapshotKey], `look.${def.snapshotKey}`);
    }
  }
  checkLookFlags(look);
  // Unknown keys are preserved (forward compatibility).
  return look as SnapshotLook;
}

/**
 * The persisted document for the live values: one `<snapshotKey>` percent per
 * table row, the five flags and the sun instant. What Copy writes.
 */
export function encodeSnapshot(
  look: LookValues,
  camera: CameraStateJson,
  date: Date
): Snapshot {
  const lookJson: SnapshotLook = {
    dof: look.dof,
    focusMode: look.focusMode,
    focusDistanceM: look.focusDistanceM,
    multiTuft: look.multiTuft,
    style: look.style,
  };
  for (const def of LOOK_CONTROLS) {
    lookJson[def.snapshotKey] = Math.round(look[def.key] * 100);
  }
  return {
    v: SNAPSHOT_VERSION,
    camera,
    date: date.toISOString(),
    look: lookJson,
  };
}

/**
 * The look values a parsed snapshot carries, as a store patch: every percent
 * key that is present (older snapshots omit newer controls, which keep their
 * current value) and each of the five flags when present. Ranges are clamped
 * by the store on apply. What Apply reads.
 */
export function decodeLook(
  look: SnapshotLook | undefined
): Partial<LookValues> {
  const patch: Partial<LookValues> = {};
  if (!look) {
    return patch;
  }
  for (const def of LOOK_CONTROLS) {
    const raw = look[def.snapshotKey];
    if (typeof raw === "number") {
      patch[def.key] = raw / 100;
    }
  }
  if (look.dof !== undefined) {
    patch.dof = look.dof;
  }
  if (look.focusMode !== undefined) {
    patch.focusMode = look.focusMode;
  }
  if (look.focusDistanceM !== undefined) {
    patch.focusDistanceM = look.focusDistanceM;
  }
  if (look.multiTuft !== undefined) {
    patch.multiTuft = look.multiTuft;
  }
  if (look.style !== undefined) {
    patch.style = look.style;
  }
  return patch;
}

/**
 * The instant a snapshot applies: its date floored to the minute, which is
 * what the HUD's time slider can show — so a Copy right after an Apply
 * re-emits the same snapshot, and the shot harness renders what Apply does.
 */
export function snapshotInstant(snapshot: Pick<Snapshot, "date">): Date {
  const date = new Date(snapshot.date);
  date.setSeconds(0, 0);
  return date;
}

/** Parses and validates pasted snapshot JSON; never throws. */
export function parseSnapshot(text: string): SnapshotParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Invalid snapshot JSON" };
  }
  try {
    const root = record(raw, "snapshot");
    const snapshot: Snapshot = {
      // Unknown versions are accepted (forward compatibility); non-numbers are not.
      v: finite(root.v, "v"),
      camera: checkCamera(root.camera),
      date: checkDate(root.date),
    };
    if (root.look !== undefined) {
      snapshot.look = checkLook(root.look);
    }
    return { ok: true, snapshot };
  } catch (err) {
    if (err instanceof SnapshotError) {
      return { ok: false, reason: err.message };
    }
    throw err;
  }
}
