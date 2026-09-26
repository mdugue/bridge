import { clamp } from "./math";
/**
 * Shadow-frustum fit: how wide the sun's orthographic shadow frustum has to be
 * for the camera's current altitude, and how far along the view direction to
 * push its centre. Pure math — no THREE, no DOM (see sun-rig.ts for the rig
 * that applies it).
 *
 * The frustum used to be a fixed 110 m half-size centred on the camera. At eye
 * level that is exactly right: fine texels, a soft PCF penumbra, and the
 * player always well inside it. In fly mode it is not — from 200 m up, a 110 m
 * box around the camera covers a patch of ground directly below that is barely
 * on screen, so everything the player is actually looking at falls outside the
 * shadow camera and renders unshadowed. That is the "no sun shadows when
 * flying" symptom.
 *
 * The honest fix for the whole range is Cascaded Shadow Maps. This is the
 * cheap 90%: one map whose footprint grows with altitude, so the shadowed area
 * tracks how much world is on screen. Texels get coarser as you climb, which
 * is exactly the trade a CSM far cascade makes anyway — and at 200 m up a
 * building is a few dozen pixels, so a 0.15 m texel buys nothing.
 *
 * Cost is unchanged per re-render (same map size, same 5-tap PCF); only the
 * set of casters inside the frustum grows. The radius is quantized to octaves
 * with hysteresis so climbing does not re-render the depth pass every metre.
 */

/**
 * Frustum half-size at eye level, in metres. 110 m over a 3072² map is
 * ~0.07 m texels — small enough that the soft PCF radius hides the staircase.
 */
export const SHADOW_BASE_RADIUS = 110;

/**
 * Largest half-size we grow to. 880 m over 3072² is ~0.57 m texels: coarse,
 * but at the altitude that asks for it (350 m+) a shadow is a soft blob and
 * having one beats having none.
 */
export const SHADOW_MAX_RADIUS = 880;

/**
 * Frustum half-size per metre of altitude. From height h a downward-tilted
 * 55°-FOV camera sees ground out to several times h; 2.5 h covers the
 * mid-ground the eye reads while keeping texels as fine as possible.
 */
const RADIUS_PER_HEIGHT = 2.5;

/**
 * How far (in log2 radius) the wanted fit must diverge from the current one
 * before the radius actually changes. Octave steps are a factor 2 apart, so
 * 0.6 leaves a comfortable band on both sides of every boundary: hovering at
 * an altitude that sits exactly on one does not flap the frustum — and a flap
 * is a full depth-pass re-render.
 */
const RADIUS_HYSTERESIS = 0.6;

/**
 * Fraction of the *extra* radius (beyond the base) that the frustum centre is
 * pushed along the view direction. Zero at eye level, so walking behaves
 * exactly as it did — in particular, turning on the spot still never moves the
 * frustum. Airborne, it puts the shadowed area where the camera is looking
 * instead of directly underneath it.
 */
const AHEAD_FRACTION = 0.5;

/**
 * Fraction of the radius the frustum centre may drift before the map is
 * re-rendered. 0.18 reproduces the old fixed 20 m dead zone at the base
 * radius, and scales with it: the player stays ~80% of the half-size clear of
 * every edge, so nothing on screen falls out of the map between re-centres.
 */
export const FOLLOW_DEAD_ZONE_FRACTION = 0.18;

/**
 * The frustum half-size for a camera `heightAboveGround` metres up, given the
 * radius currently in use. Returns `currentRadius` unchanged while the wanted
 * fit is within the hysteresis band, so the caller can use identity to decide
 * whether the shadow camera needs rebuilding.
 */
export function fitShadowRadius(
  heightAboveGround: number,
  currentRadius: number
): number {
  const height = Number.isFinite(heightAboveGround)
    ? Math.max(heightAboveGround, 0)
    : 0;
  const wanted = clamp(
    height * RADIUS_PER_HEIGHT,
    SHADOW_BASE_RADIUS,
    SHADOW_MAX_RADIUS
  );
  if (Math.abs(Math.log2(wanted / currentRadius)) < RADIUS_HYSTERESIS) {
    return currentRadius;
  }
  // Octave steps off the base: 110, 220, 440, 880.
  const octave = Math.round(Math.log2(wanted / SHADOW_BASE_RADIUS));
  return clamp(
    SHADOW_BASE_RADIUS * 2 ** octave,
    SHADOW_BASE_RADIUS,
    SHADOW_MAX_RADIUS
  );
}

/**
 * Metres to push the frustum centre along the camera's world direction. Feed
 * it the *unnormalized horizontal* part of that direction (`dir.x`, `dir.z`,
 * which carry a cos(pitch) factor) and looking straight down centres the
 * frustum under the camera while looking at the horizon pushes it the full
 * distance out — no pitch special-casing needed.
 */
export function shadowFocusAhead(radius: number): number {
  return (radius - SHADOW_BASE_RADIUS) * AHEAD_FRACTION;
}

/** Metres the frustum centre may drift at `radius` before a re-render. */
export function shadowDeadZone(radius: number): number {
  return radius * FOLLOW_DEAD_ZONE_FRACTION;
}
