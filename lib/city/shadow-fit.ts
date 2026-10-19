import { clamp } from "./math";
/**
 * Shadow-frustum fit: how wide the sun's orthographic shadow frustum has to be
 * for the camera's current altitude, and how far along the view direction to
 * push its centre. Pure math — no THREE, no DOM (see sun-rig.ts for the rig
 * that applies it).
 *
 * The frustum used to be a fixed 110 m half-size centred on the camera. At eye
 * level that is about right: fine texels, a soft PCF penumbra, and the
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
 * Frustum half-size at eye level (walking), in metres: 121 m over a 3072²
 * map is ~0.08 m texels — small enough that the soft PCF radius hides the
 * staircase. It is the 110 m the frustum had until 2026-10-11, widened by
 * 10 % so the larger dead zone on foot (`WALK_DEAD_ZONE_M`) leaves the
 * player as far from every edge as before.
 */
export const SHADOW_BASE_RADIUS = 121;

/**
 * The altitude ladder's anchor: above eye level the half-size takes the
 * octaves of 110 m (220, 440, 880), as it did before the walker's frustum
 * was widened.
 */
const OCTAVE_RADIUS = 110;

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
 * is a full depth-pass re-render. (The bottom step, 121 → 220 m, is a factor
 * 1.8: climbing leaves 121 m at 73 m up, descending leaves 220 m at 58 m.)
 */
const RADIUS_HYSTERESIS = 0.6;

/**
 * Fraction of the *extra* radius (beyond the 110 m anchor) that the frustum
 * centre is pushed along the view direction above eye level. Zero at eye
 * level, so turning on the spot never moves the frustum. Airborne, it puts
 * the shadowed area where the camera is looking instead of directly
 * underneath it.
 */
const AHEAD_FRACTION = 0.5;

/**
 * Metres the frustum centre may drift on foot before the map is
 * re-rendered. At eye level the centre is the camera's ground at the last
 * re-render, so between two the camera is never nearer an edge than the
 * half-size less this (across the sun's azimuth; along it the frustum's
 * footprint on the ground is longer, by 1 / sin of the sun's elevation):
 * 121 − 30 = 91 m, where the old 110 m half-size and its 19.8 m dead zone
 * left 90.2 m. Walking straight, the map is redrawn every 30 m instead of
 * every 19.8 — a third fewer depth passes for 10 % coarser texels.
 */
export const WALK_DEAD_ZONE_M = 30;

/**
 * Fraction of the radius the frustum centre may drift before the map is
 * re-rendered above eye level (in the air, and in Modell's parallel view,
 * whose half-octave steps from 110 m never take the walker's 121 m): the
 * camera stays ~80% of the half-size clear of every edge, so nothing on
 * screen falls out of the map between re-centres.
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
  // Eye level, else the octaves of the anchor: 220, 440, 880.
  const octave = Math.round(Math.log2(wanted / OCTAVE_RADIUS));
  return octave <= 0
    ? SHADOW_BASE_RADIUS
    : Math.min(OCTAVE_RADIUS * 2 ** octave, SHADOW_MAX_RADIUS);
}

/**
 * Metres to push the frustum centre along the camera's world direction. Feed
 * it the *unnormalized horizontal* part of that direction (`dir.x`, `dir.z`,
 * which carry a cos(pitch) factor) and looking straight down centres the
 * frustum under the camera while looking at the horizon pushes it the full
 * distance out — no pitch special-casing needed.
 */
export function shadowFocusAhead(radius: number): number {
  return radius <= SHADOW_BASE_RADIUS
    ? 0
    : (radius - OCTAVE_RADIUS) * AHEAD_FRACTION;
}

/** Metres the frustum centre may drift at `radius` before a re-render: the
 *  walker's `WALK_DEAD_ZONE_M` at eye level, else a fraction of it. */
export function shadowDeadZone(radius: number): number {
  return radius === SHADOW_BASE_RADIUS
    ? WALK_DEAD_ZONE_M
    : radius * FOLLOW_DEAD_ZONE_FRACTION;
}

/**
 * 3DTilesRendererJS's error target (px), which the viewer keeps as its base
 * (the memory governor scales it up, never down).
 */
export const STREAM_ERROR_TARGET = 16;

/**
 * The resolution (px, square) the shadow camera streams tiles at: one
 * chosen for streaming, not the shadow map's. The tile renderer measures an
 * orthographic camera's error as a tile's geometric error over its pixel —
 * the frustum's width over the resolution — whatever the distance. At the
 * map's 2048 px the coarse terrain's 40 m came to 372 px over the 220 m
 * frustum, so every tile the frustum touched was refined to its fine level
 * (and from the air, up to four of them: 642 → 677 MB on an iPhone, flying
 * at 228 m). On a phone, at 64 px, the coarse level stays below the target
 * at every radius, while a tile's buildings (and the coarse level with its
 * crowns, which is the minimum terrain under them) still load for the
 * shadow: what the main camera refines is refined for the view, not for the
 * sun. A desktop has the memory for the fine level under the eye-level
 * frustum (121 m): at 128 px the coarse level's 21 px still refine it there
 * — a tile behind the player at a seam casts its own trees' shadows, and
 * the whole-site boot fetches the spawn tile's fine level as early as it
 * did — but no longer from the air, where the frustum grows (12 px and
 * less from 220 m on).
 *
 * A phone's 64 px is dormant since plan 071: its shadow camera streams no
 * tiles at all (gpu-safety.ts `shadowTilesStream`; create-app.ts registers
 * it with the stream and takes it off at the first `setSun`, before any
 * update). It stays the resolution a phone would stream at, were that
 * lifted.
 */
export const SHADOW_STREAM_PX: Readonly<Record<"desktop" | "mobile", number>> =
  {
    desktop: 128,
    mobile: 64,
  };

/** The width and height the shadow camera streams at (`SHADOW_STREAM_PX`). */
export function shadowStreamResolution(tier: "desktop" | "mobile"): {
  height: number;
  width: number;
} {
  const px = SHADOW_STREAM_PX[tier];
  return { width: px, height: px };
}

/**
 * The screen-space error (px) the tile renderer gives a node of
 * `geometricError` (m) under the shadow camera at half-size `radius` (m),
 * streamed at `px`: its pixel is the frustum's width over the resolution.
 */
export function shadowStreamError(
  geometricError: number,
  radius: number,
  px: number
): number {
  return geometricError / ((2 * radius) / px);
}
