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
/** The far band: occluders 80–1 500 m away (m) in the 8 m field; the
 *  bake maxes a 1.5–10 km ring of Copernicus GLO-30 into the same band. */
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
