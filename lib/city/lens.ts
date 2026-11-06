/**
 * The depth of field's optics: how wide a point beyond the focus blurs on
 * a real camera with this view's angle, and how the blur fades back in
 * after the camera stops. No THREE, no DOM.
 *
 * The lens is a full-frame camera (a 24 mm tall sensor) whose focal
 * length gives the view's vertical angle — 23 mm at the default 55° —
 * at f/1.8, a fast prime wide open. Thin-lens optics give the circle of
 * confusion of a point at S2 behind the focus S1 as
 *
 *   c = f² / (N · (S1 − f)) · (1 − S1 / S2)
 *
 * on the sensor; scaled to the frame's height in pixels it is the blur's
 * diameter on screen. It grows towards c∞ = f² / (N · (S1 − f)) at the
 * horizon and shrinks with the focus distance: a facade 20 m ahead leaves
 * the city behind it nearly sharp (under a pixel on a 1440 px tall
 * frame), a lamp post 3 m ahead blurs it by six.
 */

/** Sensor height (mm): full frame. */
export const SENSOR_HEIGHT_MM = 24;
/** The aperture, an f-number: a fast prime wide open (f/2.8 read as too
 *  faint, 2026-11-06). */
export const APERTURE_F = 1.8;
/**
 * The widest blur drawn (px, diameter): the lens blur's full circle. A
 * close focus would ask for more (eighteen pixels at a metre); past this it
 * would smear rather than hint at depth.
 */
export const MAX_BLUR_PX = 8;
/**
 * After the camera stops (`RECOVER_MS`, regression.ts), the blur grows in
 * over this long (ms), as a lens racks focus, instead of snapping on.
 */
export const LENS_FADE_MS = 700;

/** The focal length (mm) that gives a vertical view angle of `fovDeg`. */
export function focalLengthMm(fovDeg: number): number {
  const half = (Math.min(Math.max(fovDeg, 1), 179) * Math.PI) / 360;
  return SENSOR_HEIGHT_MM / 2 / Math.tan(half);
}

/**
 * The blur's diameter (px) at the horizon, c∞, for a focus `focusM`
 * metres ahead, a vertical view angle `fovDeg` and a frame `heightPx`
 * tall. A point at S2 blurs by this times (1 − S1 / S2).
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
  const onSensor = (f * f) / (APERTURE_F * (s1 - f));
  return (onSensor / SENSOR_HEIGHT_MM) * Math.max(heightPx, 0);
}

/** The blur's diameter (px) of a point `depthM` ahead, focus `focusM`. */
export function blurPxAt(depthM: number, focusM: number, horizonPx: number) {
  const behind = 1 - focusM / Math.max(depthM, focusM);
  return Math.min(horizonPx * behind, MAX_BLUR_PX);
}

/** The cubic ease (smoothstep) of `x` clamped to 0…1. */
function ease(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How much of the blur shows (0…1), `sinceRecoverMs` after the camera came
 * to rest long enough for the lens to return (0 or less: none yet).
 */
export function lensFadeIn(sinceRecoverMs: number): number {
  return ease(sinceRecoverMs / LENS_FADE_MS);
}
