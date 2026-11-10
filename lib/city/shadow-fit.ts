import { clamp } from "./math";
/**
 * The square the sun's camera streams tiles for: how wide it is for the
 * camera's altitude and how far along the view it is pushed. Pure math, no
 * THREE, no DOM (sun-rig.ts applies it). It draws nothing: the shadow map's
 * own squares are the rings (shadow-rings.ts); this one only keeps loaded
 * what casts into the view, so a building behind the player still throws its
 * shadow forward.
 *
 * It is quantized to octaves with hysteresis, so climbing does not change
 * what the stream asks for at every metre.
 */

/** The square's half-size at eye level (walking), in metres. */
export const SHADOW_BASE_RADIUS = 121;

/** The altitude ladder's anchor: above eye level the half-size takes the
 *  octaves of 110 m (220, 440, 880). */
const OCTAVE_RADIUS = 110;

/** The largest half-size it grows to. */
export const SHADOW_MAX_RADIUS = 880;

/** Half-size per metre of altitude: from height h a downward-tilted 55°
 *  camera sees ground out to several times h. */
const RADIUS_PER_HEIGHT = 2.5;

/**
 * How far (in log2 radius) the wanted fit must diverge from the current one
 * before the radius actually changes. Octave steps are a factor 2 apart, so
 * 0.6 leaves a band on both sides of every boundary. (The bottom step,
 * 121 → 220 m, is a factor 1.8: climbing leaves 121 m at 73 m up, descending
 * leaves 220 m at 58 m.)
 */
const RADIUS_HYSTERESIS = 0.6;

/** The fraction of the *extra* radius (beyond the 110 m anchor) its centre
 *  is pushed along the view above eye level. Zero at eye level, so turning
 *  on the spot never moves it. */
const AHEAD_FRACTION = 0.5;

/** Metres its centre may drift on foot before it follows. */
export const WALK_DEAD_ZONE_M = 30;

/** The fraction of its radius its centre may drift above eye level (in the
 *  air, and in Modell's parallel view, whose half-octave steps from 110 m
 *  never take the walker's 121 m). */
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
