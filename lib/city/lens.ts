/**
 * The depth of field's optics: how wide a point before or beyond the
 * focus blurs on a real camera with this view's angle, how the focus
 * follows the crosshair, and how the blur fades back in after the camera
 * stops. No THREE, no DOM.
 *
 * The camera is a full-frame one (a 24 mm tall sensor) whose focal length
 * gives the view's vertical angle — 23 mm at the default 55° — with the
 * opening of a fast normal lens, 28 mm across (a 50 mm at f/1.8). Thin-lens
 * optics give the circle of confusion of a point at S2, focus S1, opening
 * D, focal length f as
 *
 *   c = f · D / (S1 − f) · |1 − S1 / S2|
 *
 * on the sensor; scaled to the frame's height in pixels it is the blur's
 * diameter on screen. Behind the focus it grows towards c∞ = f·D/(S1 − f)
 * at the horizon; before it, it grows as S2 nears — about f·D/S2 when the
 * focus is far. On a 1440 px tall frame: focused on a tree 5 m ahead the
 * horizon blurs by 8 px; focused down the street, a tree 5 m ahead blurs
 * by 8 px and a lamp post 2 m ahead by 19.
 *
 * (A 23 mm lens at f/1.8, 13 mm across, drew the street all but sharp:
 * the look of a photograph's depth comes from a normal lens's opening.)
 */

import { clamp, clamp01 } from "./math";

/** Sensor height (mm): full frame. */
export const SENSOR_HEIGHT_MM = 24;
/** The lens's opening (mm): a 50 mm at f/1.8. */
export const PUPIL_MM = 28;
/**
 * The widest blur drawn, as a share of the frame's height (a diameter): a
 * hand at arm's length would ask for more, and past this the gather's
 * taps grow too sparse to stay smooth.
 */
export const MAX_BLUR_SHARE = 0.025;
/** Where the lens focuses when the crosshair finds nothing (the sky). */
export const SKY_FOCUS_M = 1000;
/** The nearest focus (m). */
export const MIN_FOCUS_M = 0.5;
/**
 * How fast the focus follows the crosshair (ms, the time constant of its
 * approach, in dioptres): a lens racks focus rather than jumping, and a
 * crosshair flicking between a crown and the gaps in it does not flicker
 * the blur.
 */
export const FOCUS_PULL_MS = 180;
/**
 * When the lens comes back — the camera at rest (`RECOVER_MS`,
 * regression.ts), or a style or view that draws it chosen — the blur grows
 * in over this long (ms), as a lens racks focus, instead of snapping on.
 */
export const LENS_FADE_MS = 700;

/** The focal length (mm) that gives a vertical view angle of `fovDeg`. */
export function focalLengthMm(fovDeg: number): number {
  const half = (clamp(fovDeg, 1, 179) * Math.PI) / 360;
  return SENSOR_HEIGHT_MM / 2 / Math.tan(half);
}

/** The widest blur drawn (px, diameter) on a frame `heightPx` tall. */
export function maxBlurPx(heightPx: number): number {
  return MAX_BLUR_SHARE * Math.max(heightPx, 0);
}

/**
 * The blur's diameter (px) at the horizon, c∞, for a focus `focusM`
 * metres ahead, a vertical view angle `fovDeg` and a frame `heightPx`
 * tall. A point at S2 blurs by this times |1 − S1 / S2| (lens-blur.ts
 * `blurAt`, per pixel).
 */
export function horizonBlurPx(
  focusM: number,
  fovDeg: number,
  heightPx: number
): number {
  const f = focalLengthMm(fovDeg);
  // a focus inside the focal length cannot be reached: the closest the
  // formula stays finite at, a centimetre past it
  const s1 = Math.max(focusM * 1000, f + 10);
  const onSensor = (f * PUPIL_MM) / (s1 - f);
  return (onSensor / SENSOR_HEIGHT_MM) * Math.max(heightPx, 0);
}

/** A focus distance in dioptres (1/m), no nearer than `MIN_FOCUS_M`. */
export function dioptres(m: number): number {
  return 1 / Math.max(m, MIN_FOCUS_M);
}

/**
 * The focus `dtMs` later, following `targetM` from `currentM` in dioptres
 * (1/m): a step from 5 m to 50 m and one from 50 m to 5 m take as long,
 * and the far field, where a metre means little, moves little.
 */
export function pullFocus(
  currentM: number,
  targetM: number,
  dtMs: number
): number {
  const from = dioptres(currentM);
  const to = dioptres(targetM);
  const k = 1 - Math.exp(-Math.max(dtMs, 0) / FOCUS_PULL_MS);
  return 1 / (from + (to - from) * k);
}

/**
 * How much of the blur shows (0…1), `shownMs` after the lens came back —
 * the camera at rest long enough (`RECOVER_MS`, regression.ts), or a style
 * or view that draws it chosen: the cubic ease of the time over
 * `LENS_FADE_MS`.
 */
export function lensFadeIn(shownMs: number): number {
  const t = clamp01(shownMs / LENS_FADE_MS);
  return t * t * (3 - 2 * t);
}

/** How near the focus must have come to its aim (1/m) to count as there:
 *  a millimetre at 1 m, ten centimetres at 10 m. */
export const FOCUS_SETTLED_DIOPTRES = 1e-3;

/** The lens from frame to frame: how long it has been drawn, and where it
 *  focuses. */
export interface LensState {
  /** how long the lens has been drawn (ms); 0 while it is not */
  shownMs: number;
  /** the focus (m) */
  focusM: number;
}

/** How long after the lens comes back its focus still jumps to the aim
 *  (ms): the focus ray's 10 Hz tick and a frame, so the first aim the ray
 *  finds where the view rests is taken at once while the blur is all but
 *  faded out (≈ 1 % in), not pulled to in view. */
export const FOCUS_SNAP_MS = 150;

export function createLensState(): LensState {
  return { shownMs: 0, focusM: SKY_FOCUS_M };
}

/**
 * Advances the lens by one frame of `stepMs`: drawn (`drawn`), it grows in
 * and its focus follows `aimM` in dioptres; not drawn, and for
 * `FOCUS_SNAP_MS` after it returns, its focus is at the aim at once.
 * Returns how much of the blur shows (0…1).
 */
export function stepLens(
  state: LensState,
  drawn: boolean,
  aimM: number,
  stepMs: number
): number {
  state.shownMs = drawn ? state.shownMs + Math.max(stepMs, 0) : 0;
  const fade = lensFadeIn(state.shownMs);
  state.focusM =
    state.shownMs <= FOCUS_SNAP_MS
      ? aimM
      : pullFocus(state.focusM, aimM, stepMs);
  return fade;
}

/** Whether the lens shows what it will until the view changes: grown in
 *  and focused on its aim — or not wanted at all (a style or a view that
 *  draws none). */
export function lensSettled(
  state: LensState,
  wanted: boolean,
  aimM: number
): boolean {
  if (!wanted) {
    return true;
  }
  const off = Math.abs(dioptres(state.focusM) - dioptres(aimM));
  return lensFadeIn(state.shownMs) >= 1 && off < FOCUS_SETTLED_DIOPTRES;
}
