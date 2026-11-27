/**
 * A flagpole's cloth (furniture-layer.ts stands the mast): one soft sheet
 * hung from the mast's top, flying downwind and rippling in the scene's
 * wind clock — a travelling wave that grows from the hoist to the fly end,
 * bent on the vertex before the mast's instance transform. Its folds are
 * shaded by the wave's own slope, so the sheet reads as cloth without a
 * normal of its own. The cloth moves, so its shadow is the sheet at rest
 * (`castShadowPositionNode`, ADR 0009): the shadow map never redraws for
 * the wave, and at 1.2 × 2 m the still shadow under a rippling cloth does
 * not show. Far off the ripple fades out, as the crowns' sway does (a
 * sub-pixel wave only shimmers, `swayNear`), and a picture style's sway
 * share stills it.
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
  cos,
  float,
  modelWorldMatrix,
  max,
  positionGeometry,
  sin,
  step,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { FlagDesign } from "@/lib/city/features";
import {
  FLAG_BALL_R,
  FLAG_BALL_Y,
  FLAG_CLOTH_H,
  FLAG_CLOTH_L,
} from "@/lib/city/furniture";
import { Instances, instanceMatrix, instancePosition } from "./instancing";
import { RING, SOFT_GREEN } from "./furniture-palette";
import { hash21 } from "./shader-chunks";
import { markThinCaster, sceneMaterial } from "./three-utils";
import { swayNear } from "./vegetation-layer";

/** How far under the mast's top the cloth's top hangs (m); its size is
 *  lib/city/furniture.ts's FLAG_CLOTH_H × FLAG_CLOTH_L. */
const CLOTH_TOP = -0.12;
/** Off the mast's axis (m): the hoist clears the mast's radius. */
const HOIST = 0.06;
/** Quads along the cloth and down it: six rows hold two or three bands. */
const COLUMNS = 10;
const ROWS = 6;

/** The wave: its amplitude at the fly end (m), its wavenumber along the
 *  cloth (radians a metre: a 1.85 m wave) and how fast it runs (radians a
 *  second). */
const WAVE_AMP_M = 0.22;
const WAVE_AMP = float(WAVE_AMP_M);
const WAVE_K = 3.4;
const WAVE_SPEED = 4.2;
/** How dark a fold goes where the wave turns the sheet most (its slope's
 *  size: the same seen from either side). */
const FOLD_SHADE = float(0.22);
const TURN = Math.PI * 2;

/* The cloths, in the scene's pastels (furniture-palette.ts's too). */
const CLOTH = 0xf1_ec_e2;
const BLACK = 0x76_74_7e; // charcoal, not black
const RED = 0xd4_91_89;
const GOLD = 0xe9_d3_9b;
const BLUE_EU = 0x9f_b3_d6;
const BLUE_BY = 0xb7_cd_e6;

/** Each design's bands, top to bottom (each an equal share of the rows). */
const CLOTH_BANDS: Record<FlagDesign | "plain", readonly number[]> = {
  plain: [CLOTH],
  de: [BLACK, RED, GOLD],
  eu: [BLUE_EU],
  sn: [CLOTH, SOFT_GREEN],
  by: [CLOTH, BLUE_BY],
  hh: [RED],
};

/** The cloth of one design and the ball on the mast's top, in a frame
 *  whose origin is the mast's top (so neither stretches with the mast):
 *  the sheet's hoist at the mast, its fly end along local +X; indexed,
 *  each row its own vertices (a colour per band). */
function clothGeometry(design: FlagDesign | "plain"): BufferGeometry {
  const bands = CLOTH_BANDS[design];
  const pos: number[] = [];
  const rgb: number[] = [];
  const nrm: number[] = [];
  const index: number[] = [];
  const c = new Color();
  for (let r = 0; r < ROWS; r += 1) {
    c.setHex(bands[Math.floor((r * bands.length) / ROWS)]);
    const y0 = CLOTH_TOP - (r * FLAG_CLOTH_H) / ROWS;
    const y1 = CLOTH_TOP - ((r + 1) * FLAG_CLOTH_H) / ROWS;
    const first = pos.length / 3;
    for (let i = 0; i <= COLUMNS; i += 1) {
      const x = HOIST + (i * (FLAG_CLOTH_L - HOIST)) / COLUMNS;
      pos.push(x, y0, 0, x, y1, 0);
      rgb.push(c.r, c.g, c.b, c.r, c.g, c.b);
      nrm.push(0, 0, 1, 0, 0, 1);
    }
    for (let i = 0; i < COLUMNS; i += 1) {
      const top0 = first + i * 2;
      const [bottom0, top1, bottom1] = [top0 + 1, top0 + 2, top0 + 3];
      index.push(top0, bottom0, bottom1, top0, bottom1, top1);
    }
  }
  // the ball (above the cloth's top: the wave leaves it still)
  const ball = new SphereGeometry(FLAG_BALL_R, 10, 6);
  ball.translate(0, FLAG_BALL_Y, 0);
  const bp = ball.getAttribute("position");
  const bn = ball.getAttribute("normal");
  const first = pos.length / 3;
  c.setHex(RING); // the mast's fittings
  for (let i = 0; i < bp.count; i += 1) {
    pos.push(bp.getX(i), bp.getY(i), bp.getZ(i));
    nrm.push(bn.getX(i), bn.getY(i), bn.getZ(i));
    rgb.push(c.r, c.g, c.b);
  }
  for (const i of ball.index?.array ?? []) {
    index.push(first + i);
  }
  ball.dispose();
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  geo.setIndex(index);
  // the sphere every set's is made of (`Instances`): wide enough for the
  // fly end's swing off the sheet
  geo.computeBoundingSphere();
  if (geo.boundingSphere) {
    geo.boundingSphere.radius += WAVE_AMP_M;
  }
  return geo;
}

/** The wave's clock, wrapped to a turn on the CPU (`setFlagTime`): sin and
 *  cos stay in their accurate range however long the page is open. */
const waveClock = uniform(0);

/** Advances every cloth's wave (the scene's elapsed seconds, the crowns'
 *  wind clock; once per frame). */
export function setFlagTime(seconds: number): void {
  waveClock.value = (seconds * WAVE_SPEED) % TURN;
}

/**
 * The cloth's material: the wave bent on the vertex (along local Z, growing
 * from the hoist to the fly end, none on the ball), the per-mast phase from
 * where the mast stands (its matrix's translation: no attribute), and the
 * fold shade from the wave's slope.
 */
function clothMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  });
  const origin = instanceMatrix().mul(vec4(0, 0, 0, 1)).xyz;
  const near = swayNear(origin);
  // a hash of where the mast stands, so a row's masts do not wave in
  // step; a turn at most, so sin and cos stay accurate kilometres out
  const phase = hash21(origin.xz).mul(TURN);
  // the geometry's own position: once a positionNode is set,
  // positionLocal is the moved vertex. 0 at the hoist and on the ball
  // (over the cloth's top), 1 at the fly end
  const u = max(positionGeometry.x.sub(HOIST), 0)
    .div(FLAG_CLOTH_L - HOIST)
    .mul(step(positionGeometry.y, CLOTH_TOP / 2));
  const arg = positionGeometry.x.mul(WAVE_K).sub(waveClock).add(phase);
  const wave = sin(arg).mul(u).mul(WAVE_AMP).mul(near);
  m.positionNode = instancePosition(
    vec3(positionGeometry.x, positionGeometry.y, positionGeometry.z.add(wave))
  );
  // the shadow pass draws the sheet at rest: a still caster
  m.castShadowPositionNode = instancePosition(positionGeometry);
  // and the cloth looks its shadow up where it hangs at rest, or the wave,
  // swung behind that sheet, would fall into its own shadow (the matrix
  // alone: `instancePosition` turns the normal, once is enough)
  m.receivedShadowPositionNode = varying(
    modelWorldMatrix.mul(instanceMatrix().mul(vec4(positionGeometry, 1))).xyz
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

/** A tile's cloths, one per design, made on first ask: every cell's set
 *  of that design draws from it, and they go with the tile, as a model's
 *  geometry does (furniture-layer.ts `modelGeometry`). */
export type TileCloths = (design: FlagDesign | "plain") => BufferGeometry;

/** A new tile's cloths (`TileCloths`). */
export function tileCloths(): TileCloths {
  const made = new Map<FlagDesign | "plain", BufferGeometry>();
  return (design) => {
    let geo = made.get(design);
    if (!geo) {
      geo = clothGeometry(design);
      made.set(design, geo);
    }
    return geo;
  };
}

/** The cloths of one design on their masts (one cell's), casting the
 *  sheet's shadow at rest, on the tile's cloth of that design. */
export function flagCloths(
  design: FlagDesign | "plain",
  masts: readonly Mast[],
  cloths: TileCloths
): Instances {
  const mesh = new Instances(
    cloths(design),
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
  mesh.castShadow = true;
  markThinCaster(mesh, "slender");
  mesh.receiveShadow = true;
  mesh.name = `furniture-flag-${design}`;
  return mesh;
}
