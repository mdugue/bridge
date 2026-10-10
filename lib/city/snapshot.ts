/**
 * The Snapshot contract: a fully reproducible capture of the view (camera
 * pose + sun instant + every look control) as it round-trips through JSON.
 * `parseSnapshot` validates a pasted snapshot before anything is applied, so
 * a trimmed or hand-edited one (the documented QA workflow) reports what is
 * wrong instead of yielding NaN camera matrices. No THREE, no DOM.
 */
import { DATA_LAYERS } from "./data-layers";
import { LOOK_CONTROLS, type LookValues } from "./look-controls";
import { isModelPreset, type ModelPresetId } from "./model-view";
import { isRenderStyle, RENDER_STYLES, type RenderStyle } from "./render-style";

export type MovementModeJson = "fly" | "walk";

/**
 * The Modell view (plan 055): a parallel camera's pivot (world, Y-up), its
 * preset, turn, tilt and scale (the denominator at 96 dpi). Optional: a
 * reader that predates it ignores it and shows the perspective pose the
 * camera fields hold — the one Modell would leave to.
 */
export interface ModelStateJson {
  pivot: { x: number; y: number; z: number };
  preset: ModelPresetId;
  scale: number;
  /** world up onto screen up (Militärperspektive); absent = the preset's */
  shear?: number;
  tiltDeg: number;
  turnDeg: number;
}

/** Camera pose as it round-trips through JSON (lib/city/pose.ts's CameraState IS this type). */
export interface CameraStateJson {
  epsg: { x: number; y: number };
  fov: number;
  /** 0 = north, clockwise positive (east) */
  headingDeg: number;
  mode: MovementModeJson;
  /** present while the view is Modell (a parallel projection) */
  model?: ModelStateJson;
  /** + = looking up, - = looking down */
  pitchDeg: number;
  pos: { x: number; y: number; z: number };
}

export interface SnapshotLook {
  multiTuft?: boolean;
  /** the picture style; absent in older snapshots (they keep the current one) */
  style?: RenderStyle;
  /**
   * Per-control percentages, keyed by LookControlDef.snapshotKey (all
   * optional: older snapshots omit newer controls). Keys of removed
   * controls (`transparencyPct`, `dof`, `focusMode`, …) are unknown keys:
   * kept, never checked, never applied.
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

function checkModel(v: unknown): ModelStateJson {
  const m = record(v, "camera.model");
  const pivot = record(m.pivot, "camera.model.pivot");
  if (!isModelPreset(m.preset)) {
    throw new SnapshotError("camera.model.preset is not a known view");
  }
  const scale = finite(m.scale, "camera.model.scale");
  if (scale <= 0) {
    throw new SnapshotError("camera.model.scale must be positive");
  }
  const tiltDeg = finite(m.tiltDeg, "camera.model.tiltDeg");
  if (tiltDeg < 0 || tiltDeg > 90) {
    throw new SnapshotError("camera.model.tiltDeg must be between 0 and 90");
  }
  const model: ModelStateJson = {
    pivot: {
      x: finite(pivot.x, "camera.model.pivot.x"),
      y: finite(pivot.y, "camera.model.pivot.y"),
      z: finite(pivot.z, "camera.model.pivot.z"),
    },
    preset: m.preset,
    scale,
    tiltDeg,
    turnDeg: finite(m.turnDeg, "camera.model.turnDeg"),
  };
  if (m.shear !== undefined) {
    model.shear = finite(m.shear, "camera.model.shear");
  }
  return model;
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
  const camera: CameraStateJson = {
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
  if (c.model !== undefined) {
    camera.model = checkModel(c.model);
  }
  return camera;
}

function checkDate(v: unknown): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
    throw new SnapshotError("date must be an ISO date string");
  }
  return v;
}

function checkLookFlags(look: Record<string, unknown>): void {
  for (const key of [
    "multiTuft",
    ...DATA_LAYERS.map((def) => def.snapshotKey),
  ]) {
    if (look[key] !== undefined && typeof look[key] !== "boolean") {
      throw new SnapshotError(`look.${key} must be a boolean`);
    }
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
 * table row, the two flags, the data layers and the sun instant. What Copy writes.
 */
export function encodeSnapshot(
  look: LookValues,
  camera: CameraStateJson,
  date: Date
): Snapshot {
  const lookJson: SnapshotLook = {
    multiTuft: look.multiTuft,
    style: look.style,
  };
  for (const def of LOOK_CONTROLS) {
    lookJson[def.snapshotKey] = Math.round(look[def.key] * 100);
  }
  for (const def of DATA_LAYERS) {
    lookJson[def.snapshotKey] = look[def.key];
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
 * current value) and each of the two flags and the data layers when present;
 * a removed control's key is left out. Ranges are clamped by the store on
 * apply. What Apply reads.
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
  if (look.multiTuft !== undefined) {
    patch.multiTuft = look.multiTuft;
  }
  if (look.style !== undefined) {
    patch.style = look.style;
  }
  for (const def of DATA_LAYERS) {
    const on = look[def.snapshotKey];
    if (typeof on === "boolean") {
      patch[def.key] = on;
    }
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
