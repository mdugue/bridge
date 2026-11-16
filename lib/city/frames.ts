/**
 * The frames a coordinate lives in, as types that cost nothing at runtime,
 * and the conversions between them (ADR 0005). No THREE, no DOM.
 *
 * - **Projected** (`Epsg…`): the provider's UTM, easting and northing in
 *   metres (EPSG:25832/25833) — what the bakes write and `heightAt` reads.
 * - **Data** (`Data…`): recentered and Z-up, `x = E − cx`, `y = N − cy` —
 *   the frame of the rotated `world` group and of the tileset's content
 *   before its up-axis turn.
 * - **Scene** (`Scene…`): three.js, Y-up, `x = E − cx`, `z = −(N − cy)` —
 *   where dressing, the camera and the player stand.
 *
 * Elevation is the same number in every frame and stays a `number`.
 *
 * A brand is on the scalar: an easting is not a scene `z`, and the brand
 * survives destructuring (`const { x, z } = epsgToWorld(…)`). A point is a
 * pair of branded scalars. Arithmetic drops a brand (`e + 1.5` is a
 * `number`): a value computed in its own frame takes it back with `as`,
 * and a list read from a file is typed once, not once a vertex.
 *
 * The conversions return branded values and still take plain numbers, so
 * none of their callers moves; `ground-clamp.ts` re-exports them under
 * their old address. What branding the callers cost is plan 095's
 * Findings (phase B1).
 */

declare const frame: unique symbol;

/** `T` tagged as being in frame `F`; erased at runtime. */
type In<T, F extends string> = T & { readonly [frame]: F };

/** Projected easting (m). */
export type EpsgX = In<number, "epsg.x">;
/** Projected northing (m). */
export type EpsgY = In<number, "epsg.y">;
/** Recentered data-frame x (Z-up; equal to the scene's x). */
export type DataX = In<number, "data.x">;
/** Recentered data-frame y (Z-up; north, the scene's −z). */
export type DataY = In<number, "data.y">;
/** Scene x (Y-up; east). */
export type SceneX = In<number, "scene.x">;
/** Scene z (Y-up; south). */
export type SceneZ = In<number, "scene.z">;

/** A projected point as the bakes write it: `[E, N]`. */
export type EpsgPair = [EpsgX, EpsgY];

/** One site's recenter offset: the projected point at the scene's origin. */
export interface RecenterOffset {
  cx: number;
  cy: number;
}

/** Projected (E, N) → scene (x, z). */
export function epsgToWorld(
  x: number,
  y: number,
  offset: RecenterOffset
): { x: SceneX; z: SceneZ } {
  return {
    x: (x - offset.cx) as SceneX,
    z: -(y - offset.cy) as SceneZ,
  };
}

/** Projected (E, N) → the data frame (x, y): the plane of the rotated
 *  `world` group, where a shape drawn flat and turned −90° about X lies on
 *  the ground (the scene's `(x, −z)`). */
export function epsgToData(
  x: number,
  y: number,
  offset: RecenterOffset
): { x: DataX; y: DataY } {
  return { x: (x - offset.cx) as DataX, y: (y - offset.cy) as DataY };
}

/** Scene (x, z) → projected (E, N). */
export function worldToEpsg(
  x: number,
  z: number,
  offset: RecenterOffset
): { x: EpsgX; y: EpsgY } {
  return { x: (x + offset.cx) as EpsgX, y: (offset.cy - z) as EpsgY };
}
