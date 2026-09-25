/**
 * The baked large-scale light (pipeline/bake/skyview.py, plan 033): the
 * sky-view factor (`svf_<tile>.png`, the fraction of the sky the ground
 * sees within 150 m) and the horizon (`horizon_<tile>.png`, per azimuth
 * the elevation angle of the skyline in two bands: occluders 80–1 500 m
 * away, and 8–80 m away for the ground the shadow map does not reach). The
 * constants here are the bake's legend (`horizon_<tile>.json`, checked by
 * the test); the shaders that read them are app/_components/sky-light.ts.
 * No THREE, no DOM.
 */

/** Raster edges (px) over a tile: ≈ 2 m sky view, ≈ 8 m horizon. */
export const SVF_PX = 1024;
export const HORIZON_PX = 256;
/** Horizon azimuths, clockwise from north, evenly spaced. */
export const HORIZON_AZIMUTHS = 16;
/** Four azimuths per RGBA texel: one band's layers (planes). */
export const HORIZON_LAYERS = HORIZON_AZIMUTHS / 4;
/** The far band's planes, then the near band's: the texture's layers. */
export const HORIZON_BANDS = 2;
export const HORIZON_TEXTURE_LAYERS = HORIZON_LAYERS * HORIZON_BANDS;
/** The far band's horizon angle (°) of the byte 255. */
export const HORIZON_MAX_DEG = 45;
/** The far band: occluders 80–1 500 m away (m). */
export const HORIZON_NEAR_M = 80;
export const HORIZON_FAR_M = 1500;
/** The near band: occluders 8–80 m away, 0–90° (beside a wall the skyline
 *  is steep). Inside the shadow frustum they are the shadow map's. */
export const NEAR_BAND_M = 8;
export const NEAR_MAX_DEG = 90;
/** The near band fades in from this fraction of the shadow frustum's
 *  half-size to its edge, so the hand-over shows no seam. */
export const NEAR_BAND_FADE_FROM = 0.8;
/** Soft band (°) either side of the horizon angle the sun fades across —
 *  about the sun's own disk plus the raster's angle step. */
export const HORIZON_SOFT_DEG = 0.8;

/**
 * A vertical face sees at most half the sky, and the ground at its foot
 * (where a facade samples the raster) sees the face itself as well: an open
 * street's wall foot reads ≈ 0.5. Doubling maps that to a full sky for the
 * facade and keeps a courtyard's ≈ 0.2 at 0.4.
 */
export const FACADE_SVF_GAIN = 2;
/** How far outside a wall (m) a facade reads the ground's sky view: clear
 *  of the ≈ 2 m texel under the roof, whose ground sees almost no sky. */
export const FACADE_SVF_OFFSET_M = 2.5;

/** The sun's azimuth (° clockwise from north) and elevation (°) from its
 *  world (Y-up) direction: world (x, y, z) is data (x, −z, y). */
export function sunAngles(dir: { x: number; y: number; z: number }): {
  azimuthDeg: number;
  elevationDeg: number;
} {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const elevationDeg =
    (Math.asin(Math.min(Math.max(dir.y / len, -1), 1)) * 180) / Math.PI;
  const az = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
  return { azimuthDeg: (az + 360) % 360, elevationDeg };
}

/** The two horizon azimuths a sun azimuth falls between and the weight of
 *  the second — what the shader interpolates. */
export function horizonBracket(azimuthDeg: number): {
  lower: number;
  upper: number;
  t: number;
} {
  const step = 360 / HORIZON_AZIMUTHS;
  const f = (((azimuthDeg % 360) + 360) % 360) / step;
  const lower = Math.floor(f) % HORIZON_AZIMUTHS;
  return {
    lower,
    upper: (lower + 1) % HORIZON_AZIMUTHS,
    t: f - Math.floor(f),
  };
}

/** Where azimuth `k` lives in the raster: its layer and RGBA channel. */
export function horizonTexel(k: number): { channel: number; layer: number } {
  return { layer: Math.floor(k / 4), channel: k % 4 };
}

/**
 * How much of the sun's direct light reaches a point whose horizon in the
 * sun's direction stands at `horizonDeg`: the shader's smoothstep, at full
 * strength (the look row mixes it toward 1).
 */
export function farSunVisibility(
  horizonDeg: number,
  sunElevationDeg: number
): number {
  const a = horizonDeg - HORIZON_SOFT_DEG;
  const b = horizonDeg + HORIZON_SOFT_DEG;
  const t = Math.min(Math.max((sunElevationDeg - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * How much the near band counts at a ground point `distance` metres from
 * the shadow frustum's centre (half-size `radius`): 0 well inside the
 * frustum (the shadow map has those occluders, with their shapes), 1 at
 * and beyond its edge (nothing else has them), a smoothstep over the last
 * 20 % between. The shader's `hzNearWeight`.
 */
export function nearBandWeight(distance: number, radius: number): number {
  const r = Math.max(radius, 1);
  const a = r * NEAR_BAND_FADE_FROM;
  const t = Math.min(Math.max((distance - a) / (r - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The sun's visibility over both bands (the shader's `hzSunVisible`): the
 * far band always, the near band by its weight. Beyond the frustum this is
 * the visibility of the higher of the two horizons, max(near, far).
 */
export function horizonSunVisibility(
  farDeg: number,
  nearDeg: number,
  sunElevationDeg: number,
  nearWeight: number
): number {
  const far = farSunVisibility(farDeg, sunElevationDeg);
  const near = farSunVisibility(nearDeg, sunElevationDeg);
  return Math.min(far, 1 + (near - 1) * nearWeight);
}

/** The sky view a facade gets from the ground's: doubled (see
 *  FACADE_SVF_GAIN), faded to the open sky toward the eaves. */
export function facadeSkyView(
  groundSvf: number,
  heightAboveBase: number,
  eaveHeight: number
): number {
  const svf = Math.min(groundSvf * FACADE_SVF_GAIN, 1);
  const top = Math.max(eaveHeight, 3);
  const t = Math.min(Math.max(heightAboveBase / top, 0), 1);
  const fade = t * t * (3 - 2 * t);
  return svf + (1 - svf) * fade;
}
