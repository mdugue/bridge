/**
 * Thin casters keep a shadow at every map resolution: in the sun's shadow
 * pass an instanced pole, mast, stake or bollard is drawn at least one map
 * texel wide across the sun (`thinCasterPosition`, a material's
 * `castShadowPositionNode`); the picture itself draws it as it is.
 *
 * Why: a lamp post is 12–20 cm thick, and from the air a texel of the
 * warped map is 0.15–0.55 m (shadow-warp.ts). A caster narrower than a
 * texel lands on the map only in the rows whose texel centres it happens
 * to cover — a dashed shadow, or none — and when the map is fitted anew
 * with finer texels (flying nearer) its shadow pops in whole. Drawn one
 * texel wide it covers a centre in every row, so its shadow is a faint
 * line from afar that sharpens as the texels shrink, never one that
 * appears. Only from the air: on foot and in Modell the square's texels
 * are even and change only when it is resized, and a phone's (0.12 m at
 * 2048²) would have widened every tree stake's shadow under the eye; the
 * lantern's cube map, drawn through the same node, is left alone there
 * too.
 *
 * Only the cross-section across the sun is widened (the shadow's width on
 * the ground): the sunward face stays where it is, within the map's depth
 * bias, so the pole does not shade itself. A vertex nearer the instance's
 * axis than half a texel is pushed out to it; one further out is left
 * alone (a bench wider than a texel keeps its shape).
 *
 * Coordinates: world Y-up (the scene frame); the sets live in it.
 */
import { Matrix4, Vector3 } from "three/webgpu";
import {
  abs,
  dot,
  Fn,
  length,
  max,
  min,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  sign,
  uniform,
  vec4,
} from "three/tsl";
import { instanceMatrix, instancePosition } from "./instancing";
import type { V3 } from "./shader-chunks";

/** World → the sun's shadow map (uv 0…1 after the divide by w): three's
 *  `LightShadow.matrix` as the map was last fitted (sun-rig.ts). */
export const sunMapMatrix = uniform(new Matrix4());

/** The sun's shadow map edge (texels). */
export const sunMapTexels = uniform(1);

/** The level direction across the sun (world, unit): the axis a vertical
 *  caster's shadow is wide along on the ground. */
export const sunAcross = uniform(new Vector3(1, 0, 0));

/** A caster is never widened past this (m): far off, where a texel is
 *  metres wide, a lamp's shadow would be a broad smudge, and the fog has
 *  it anyway. */
const THIN_MAX_M = 0.8;

/** How wide (m) a caster may be drawn at most: `THIN_MAX_M` while the map
 *  is warped over the view, 0 (as it is) on the square. */
export const thinCasterReach = uniform(0);

/** Keeps the shared uniforms on the map the sun last drew: its matrix (the
 *  light's `shadow.matrix`, current after `updateMatrices`), its size and
 *  the sun's direction (world, surface → sun). */
export function setThinCasterMap(
  matrix: Matrix4,
  texels: number,
  sun: Vector3,
  warped: boolean
): void {
  sunMapMatrix.value.copy(matrix);
  sunMapTexels.value = texels;
  thinCasterReach.value = warped ? THIN_MAX_M : 0;
  // level and across the sun's azimuth; overhead, any level axis will do
  const across = sunAcross.value.set(-sun.z, 0, sun.x);
  if (across.lengthSq() < 1e-8) {
    across.set(1, 0, 0);
  } else {
    across.normalize();
  }
}

/**
 * The shadow pass's position of an instanced thin caster: its instance's
 * vertex (`instancePosition`), pushed out across the sun to half a map
 * texel from the instance's axis where it lies nearer. Off a set it is
 * the plain vertex.
 */
export function thinCasterPosition(): V3 {
  return Fn((builder) => {
    const placed = instancePosition();
    if (!builder.geometry.hasAttribute("iMat0")) {
      return placed;
    }
    const origin = instanceMatrix().mul(vec4(0, 0, 0, 1)).xyz;
    const foot = modelWorldMatrix.mul(vec4(origin, 1));
    // the map's texels per metre across the sun, at the caster's foot
    const q0 = sunMapMatrix.mul(foot);
    const q1 = sunMapMatrix.mul(foot.add(vec4(sunAcross, 0)));
    const uv0 = q0.xy.div(max(q0.w, 1e-6));
    const uv1 = q1.xy.div(max(q1.w, 1e-6));
    const perMetre = max(length(uv1.sub(uv0)).mul(sunMapTexels), 1e-3);
    const half = min(perMetre.reciprocal(), thinCasterReach).mul(0.5);
    const across = normalize(
      modelWorldMatrixInverse.mul(vec4(sunAcross, 0)).xyz
    );
    const off = dot(placed.sub(origin), across);
    const widened = sign(off).mul(max(abs(off), half));
    return placed.add(across.mul(widened.sub(off)));
  })();
}
