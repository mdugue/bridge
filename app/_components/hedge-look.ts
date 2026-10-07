import {
  type BufferGeometry,
  type Color,
  MeshStandardNodeMaterial,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import {
  attribute,
  dot,
  materialColor,
  mix,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { instancePosition, instanceTint } from "./instancing";
import { leafNoise, type V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * The hedges' look, shared by the OSM hedges (low-vegetation-layer.ts) and
 * the Basis-DLM's row hedges (vegetation-layer.ts): one soft clipped block,
 * one scene-wide material — so the two read as the same plant.
 */

/** superellipsoid exponents of the hedge block (2 = ellipsoid, ∞ = box):
 *  a clipped, softly rounded top half on a squarer base */
const HEDGE_P = 4;
const HEDGE_P_BASE = 7;
/** The fringe: from this share of the block's height up, the top frays … */
const FRINGE_FROM = 0.8;
/** … until this much of it is gone at the very top. */
const FRINGE_DEPTH = 0.55;
/** How far a block's top waves along its length (share of its height). */
const TOP_WAVE = 0.1;

/**
 * The block's top lifted and dropped in a slow wave along its length, its
 * phase from where the piece stands (its instance's translation), so the
 * chain's ridge rises and falls like a hedge grown, not a wall. The base
 * stays on the ground.
 */
function hedgeShape(): V3 {
  const p = positionGeometry;
  const origin = vec3(
    attribute("iMat3", "vec4").x,
    0,
    attribute("iMat3", "vec4").z
  );
  const phase = dot(origin.xz, vec2(0.31, 0.47));
  const ty = p.y.clamp(0, 1);
  const wave = sin(p.x.mul(5.2).add(phase)).mul(TOP_WAVE).mul(ty.mul(ty));
  return p.add(vec3(0, wave, 0));
}

/**
 * Unit hedge block: 1 m long (x), 1 m wide (z), 1 m tall (y), base at y = 0.
 * A superellipsoid (|x|⁴ + |y|⁴ + |z|⁴ = 1 on a UV sphere): flat-ish sides
 * and top with generously rounded edges and blunt ends, so the overlapping
 * pieces of a chain merge into one clipped hedge with soft waists at the
 * joins instead of a row of boxes. A low-frequency lump breaks the top line;
 * smooth normals, bent a third of the way toward the block's core axis, let
 * the light roll over it as one soft mass (the crown's radial-normal trick).
 */
export function buildHedgeGeo(): BufferGeometry {
  const g = new SphereGeometry(1, 16, 10); // 288 triangles
  // Poles on the ends (±x), not on the top: the top then gets even quads
  // instead of a fan of slivers that the lumps would pull into spikes.
  g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // boxier below the equator: the base stands on the lawn, not on a curve
    const p = v.y < 0 ? HEDGE_P_BASE : HEDGE_P;
    const norm =
      (Math.abs(v.x) ** p + Math.abs(v.y) ** p + Math.abs(v.z) ** p) ** (1 / p);
    v.divideScalar(norm);
    const ty = (v.y + 1) / 2; // 0 (base) … 1 (top)
    // lumps on the upper half only (the base must stay on the ground)
    // (one gentle term: the rings along x are too sparse for more — a higher
    // frequency aliases into spikes on the ridge)
    const lump = 1 + ty ** 2 * 0.05 * Math.sin(v.x * 4.1 + v.z * 2.3 + 0.7);
    pos.setXYZ(i, v.x * 0.5, ty * lump, v.z * 0.5 * (1 - 0.12 * ty ** 2));
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const n = new Vector3();
  const core = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    core.set(pos.getX(i) * 0.6, pos.getY(i) - 0.4, pos.getZ(i) * 2).normalize();
    n.lerp(core, 0.35).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return g;
}

/**
 * Pastel moss with a rooted base: the unit geometry's own Y (0 at the ground,
 * 1 at the top, before the instance scale) darkens the lower third — the soft
 * contact shading that seats a hedge on the lawn in the watercolour look.
 * Scene-wide (`sceneMaterial`): it carries nothing of a tile.
 */
export function hedgeMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("low-vegetation-hedge", () => {
    const m = new MeshStandardNodeMaterial({ color: 0xff_ff_ff, roughness: 1 });
    m.name = "lowveg-hedge";
    m.positionNode = instancePosition(hedgeShape());
    // a leafy fringe: the top's last decimetres frayed by the foliage
    // noise, so the line against the sky is twigs, not a clay edge; the
    // shadow pass honours the mask, so the shadow's edge frays too
    const ty = varying(positionGeometry.y);
    const fringe = smoothstep(FRINGE_FROM, 1, ty);
    const twigs = leafNoise(
      positionWorld.xz.mul(5.3).add(positionWorld.y.mul(3.1))
    );
    m.maskNode = twigs.greaterThan(fringe.mul(FRINGE_DEPTH));
    // rooted base: darker toward the ground (contact shading)
    const rooted = mix(0.8, 1.05, smoothstep(0, 0.7, ty));
    // foliage mottle: leaf-clump-sized (~0.4 m) and bush-sized (~1.3 m)
    // value noise in world space, so neighbouring pieces never repeat; the
    // bright clumps lean a touch yellow — a watercolour wash, not a
    // texture. Static: nothing here moves (ADR 0020).
    const uv = positionWorld.xz.add(positionWorld.y.mul(vec2(0.63, -0.41)));
    const mottle = leafNoise(uv.mul(2.6))
      .mul(0.6)
      .add(leafNoise(uv.mul(0.75).add(7.1)).mul(0.4));
    const moss = materialColor
      .mul(instanceTint())
      .mul(rooted)
      .mul(mottle.mul(0.34).add(0.82));
    m.colorNode = mix(
      moss,
      moss.mul(vec3(1.08, 1.06, 0.86)),
      smoothstep(0.55, 0.9, mottle)
    );
    return m;
  });
}

/** Hedges read a touch deeper and cooler than crowns. */
export function hedgeTint(col: Color, t: number): void {
  col.setHSL(0.27 + t * 0.03, 0.34 + t * 0.06, 0.5 + t * 0.07);
}
