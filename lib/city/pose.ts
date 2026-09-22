/**
 * Pure camera-pose math: the one compass/pitch convention every pose in the
 * viewer shares (CameraState, Viewpoint, FlightTarget, PlayerPose) and the
 * angular policy — how far the view may pitch and zoom. No THREE, no DOM.
 *
 * World frame (Y-up): north = -Z, east = +X. A heading is a compass bearing
 * (0 = north, clockwise positive, so 90° = east); pitch tilts towards +Y.
 */
import type { CameraStateJson } from "./snapshot";

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** Eye height above the terrain on foot (m). */
export const EYE_HEIGHT = 1.7;

/** Max pitch magnitude in radians (~83°) — keeps the look-at math sane. */
export const PITCH_LIMIT = 1.45;

export const MIN_FOV = 30;
export const MAX_FOV = 95;

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

/** Player pose for the minimap: EPSG position + compass heading. */
export interface PlayerPose {
  epsgX: number;
  epsgY: number;
  /** radians, 0 = north, clockwise positive (towards east) */
  heading: number;
}

/**
 * Full camera state for reproducible snapshots: enough to drop the camera back
 * exactly where it was. `pos` is the authoritative world position (Y-up);
 * `epsg` is the human-readable ground coordinate. Angles in degrees. It IS the
 * JSON shape (`snapshot.ts`), so a snapshot round-trips untouched.
 */
export type CameraState = CameraStateJson;

export function clampPitch(pitch: number): number {
  return Math.min(Math.max(pitch, -PITCH_LIMIT), PITCH_LIMIT);
}

/**
 * The shortest angle between two headings (radians, unsigned). Headings wrap,
 * so a turn from 359° to 1° is 2°, not 358° — "has the player looked around?"
 * is wrong by a whole circle without this.
 */
export function headingDelta(a: number, b: number): number {
  const turn = Math.PI * 2;
  const d = Math.abs(a - b) % turn;
  return d > Math.PI ? turn - d : d;
}

/** Unit view direction for a compass heading and a pitch (both radians). */
export function directionOf(heading: number, pitch: number): Xyz {
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(heading) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(heading) * cp,
  };
}

/** Compass heading and pitch (radians) of a view direction. */
export function headingPitchOf(dir: Xyz): { heading: number; pitch: number } {
  const length = Math.hypot(dir.x, dir.y, dir.z) || 1;
  return {
    heading: Math.atan2(dir.x, -dir.z),
    pitch: Math.asin(Math.min(Math.max(dir.y / length, -1), 1)),
  };
}

/**
 * FOV after a zoom gesture: `ratio` = current finger distance / distance at
 * the start (or a wheel notch's factor). Spreading (> 1) zooms in — a
 * smaller FOV — like map apps. Clamped to the viewer's FOV range.
 */
export function nextFov(startFov: number, ratio: number): number {
  if (ratio <= 0 || !Number.isFinite(ratio)) {
    return startFov;
  }
  return Math.min(Math.max(startFov / ratio, MIN_FOV), MAX_FOV);
}
