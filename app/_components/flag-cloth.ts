/**
 * A flagpole's cloth (furniture-layer.ts stands the mast): one soft sheet
 * hung from the mast's top, flying downwind and rippling in the scene's
 * wind clock — a travelling wave that grows from the hoist to the fly end,
 * bent on the vertex before the mast's instance transform. Its folds are
 * shaded by the wave's own slope, so the sheet reads as cloth without a
 * normal of its own. The cloth moves, so it never reaches the shadow map
 * (ADR 0009): the mast casts, the cloth does not. Far off the ripple fades
 * out, as the crowns' sway does (a sub-pixel wave only shimmers), and a
 * picture style's sway share stills it.
 *
 * A flag the map names (`FlagDesign`) wears its colours in the scene's
 * pastels — horizontal bands, no emblem (the stars of Europe, Hamburg's
 * castle and Bavaria's lozenges are left out, as a model's flag would be);
 * every other flag a pale cloth: most are a shop's or a firm's, and their
 * colours are not mapped.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  cos,
  distance,
  float,
  modelWorldMatrix,
  max,
  positionGeometry,
  sin,
  smoothstep,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { FlagDesign } from "@/lib/city/features";
import { Instances, instanceMatrix, instancePosition } from "./instancing";
import { sceneMaterial } from "./three-utils";
import { crownSwayShare, windClock } from "./vegetation-layer";

/** The cloth's size (m), 3 : 5, a forecourt flag's, whatever the mast's
 *  height; its top hangs this far under the mast's top. */
export const CLOTH_H = 1.2;
export const CLOTH_L = 2;
const CLOTH_TOP = -0.12;
/** The ball on the mast's top: its radius and its centre over the top (m). */
const BALL_R = 0.075;
const BALL_Y = 0.05;
const BALL = 0xb3_b3_bf; // furniture-layer.ts's RING
/** Off the mast's axis (m): the hoist clears the mast's radius. */
const HOIST = 0.06;
/** Quads along the cloth and down it: six rows hold two or three bands. */
const COLUMNS = 10;
const ROWS = 6;

/** The wave: its amplitude at the fly end (m), its length along the cloth
 *  (m) and how fast it runs (radians a second). */
const WAVE_AMP = 0.22;
const WAVE_K = 3.4;
const WAVE_SPEED = 4.2;
/** Within this distance (m) the cloth ripples fully, past WAVE_FAR_M not at all. */
const WAVE_NEAR_M = 120;
const WAVE_FAR_M = 260;
/** How dark a fold turned from the eye goes at the wave's steepest. */
const FOLD_SHADE = 0.22;

/* The cloths, in the scene's pastels (furniture-layer.ts's palette). */
const CLOTH = 0xf1_ec_e2;
const BLACK = 0x76_74_7e; // charcoal, not black
const RED = 0xd4_91_89;
const GOLD = 0xe9_d3_9b;
const BLUE_EU = 0x9f_b3_d6;
const GREEN = 0xb9_c9_a8;
const BLUE_BY = 0xb7_cd_e6;

/** Each design's bands, top to bottom (each an equal share of the rows). */
export const CLOTH_BANDS: Record<FlagDesign | "plain", readonly number[]> = {
  plain: [CLOTH],
  de: [BLACK, RED, GOLD],
  eu: [BLUE_EU],
  sn: [CLOTH, GREEN],
  by: [CLOTH, BLUE_BY],
  hh: [RED],
};

/** The cloth of one design and the ball on the mast's top, in a frame
 *  whose origin is the mast's top (so neither stretches with the mast):
 *  the sheet's hoist at the mast, its fly end along local +X;
 *  non-indexed, a colour per band. */
export function clothGeometry(design: FlagDesign | "plain"): BufferGeometry {
  const bands = CLOTH_BANDS[design];
  const pos: number[] = [];
  const rgb: number[] = [];
  const nrm: number[] = [];
  const c = new Color();
  for (let r = 0; r < ROWS; r += 1) {
    c.setHex(bands[Math.floor((r * bands.length) / ROWS)]);
    const y0 = CLOTH_TOP - (r * CLOTH_H) / ROWS;
    const y1 = CLOTH_TOP - ((r + 1) * CLOTH_H) / ROWS;
    for (let i = 0; i < COLUMNS; i += 1) {
      const x0 = HOIST + (i * (CLOTH_L - HOIST)) / COLUMNS;
      const x1 = HOIST + ((i + 1) * (CLOTH_L - HOIST)) / COLUMNS;
      for (const [x, y] of [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x0, y0],
        [x1, y1],
        [x1, y0],
      ]) {
        pos.push(x, y, 0);
        rgb.push(c.r, c.g, c.b);
        nrm.push(0, 0, 1);
      }
    }
  }
  // the ball (at the hoist's x: the wave leaves it still)
  const ball = new SphereGeometry(BALL_R, 10, 6).toNonIndexed();
  ball.translate(0, BALL_Y, 0);
  const bp = ball.getAttribute("position");
  const bn = ball.getAttribute("normal");
  c.setHex(BALL);
  for (let i = 0; i < bp.count; i += 1) {
    pos.push(bp.getX(i), bp.getY(i), bp.getZ(i));
    nrm.push(bn.getX(i), bn.getY(i), bn.getZ(i));
    rgb.push(c.r, c.g, c.b);
  }
  ball.dispose();
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  return geo;
}

/**
 * The cloth's material: the wave bent on the vertex (along local Z, growing
 * with the distance from the hoist), the per-mast phase from where the
 * mast stands (its matrix's translation: no attribute), and the fold shade
 * from the wave's slope.
 */
function clothMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  });
  const origin = instanceMatrix().mul(vec4(0, 0, 0, 1)).xyz;
  const at = modelWorldMatrix.mul(vec4(origin, 1)).xyz;
  const near = float(1)
    .sub(smoothstep(WAVE_NEAR_M, WAVE_FAR_M, distance(at, cameraPosition)))
    .mul(crownSwayShare);
  const phase = origin.x.mul(0.37).add(origin.z.mul(0.61));
  // the geometry's own x: once a positionNode is set, positionLocal is
  // the moved vertex
  const u = max(positionGeometry.x, 0).div(CLOTH_L);
  const arg = positionGeometry.x
    .mul(WAVE_K)
    .sub(windClock.mul(WAVE_SPEED))
    .add(phase);
  const wave = sin(arg).mul(u).mul(WAVE_AMP).mul(near);
  m.positionNode = instancePosition(
    vec3(positionGeometry.x, positionGeometry.y, positionGeometry.z.add(wave))
  );
  // Worked out on the vertex (the instance's matrix is a vertex input) and
  // carried over; the vertex colour multiplies in after (NodeMaterial,
  // vertexColors).
  const fold = varying(
    float(1).sub(cos(arg).mul(u).mul(near).abs().mul(FOLD_SHADE))
  );
  m.colorNode = vec3(fold);
  return m;
}

/** A mast the cloth hangs on: its foot (the scene frame), its yaw
 *  (downwind, `flagYaw`) and its height (m). */
export interface Mast {
  at: Vector3;
  height: number;
  yaw: number;
}

/** The cloths of one design on their masts (one cell's), casting no
 *  shadow; `geometry` is the design's `clothGeometry`, shared by a tile's
 *  cells. */
export function flagCloths(
  design: FlagDesign | "plain",
  geometry: BufferGeometry,
  masts: readonly Mast[]
): Instances {
  const mesh = new Instances(
    geometry,
    sceneMaterial("furniture-flag-cloth", clothMaterial),
    masts.length
  );
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const top = new Vector3();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < masts.length; i += 1) {
    const mast = masts[i];
    q.setFromAxisAngle(up, mast.yaw);
    top.copy(mast.at).setY(mast.at.y + mast.height);
    mesh.setMatrixAt(i, m.compose(top, q, one));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = `furniture-flag-${design}`;
  return mesh;
}
