/**
 * The Snapshot contract: a fully reproducible capture of the view (camera
 * pose + sun instant + every look control) as it round-trips through JSON.
 * `parseSnapshot` validates a pasted snapshot before anything is applied, so
 * a trimmed or hand-edited one (the documented QA workflow) reports what is
 * wrong instead of yielding NaN camera matrices. No THREE, no DOM.
 */
import { LOOK_CONTROLS } from "./look-controls";

export type MovementModeJson = "fly" | "walk";

/** Camera pose as it round-trips through JSON (create-app's CameraState IS this type). */
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
  focusMode?: "auto" | "manual";
  multiTuft?: boolean;
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
