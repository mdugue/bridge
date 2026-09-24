import type { DataTexture, MeshStandardMaterial } from "three";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  fwidth,
  int,
  ivec2,
  length,
  materialColor,
  max,
  min,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  step,
  textureLoad,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { OBJECT_TEXTURE_WIDTH } from "@/lib/city/city-mesh";
import type { ClayDetailUniforms, StyleResources } from "./visual-style";

/**
 * SPIKE (plan 020): the clay facade detail of visual-style.ts as a TSL node
 * material — the same terms, the same object-table layout (three texels per
 * object: (tint, baseZ) (roof, eaveH) (storeyH, glow, rough)), the same live
 * uniforms (the look writes `.value`, no recompile). No chunk anchors, no
 * cache key. Height fog is not ported (scene fog applies).
 */

type U = Node<"float">;

/** The clay uniforms as TSL uniform nodes; `.value` is what the look writes. */
export function createNodeClayUniforms(
  defaults: Record<keyof ClayDetailUniforms, number>,
  night?: { value: number }
): ClayDetailUniforms {
  const u = (v: number) => uniform(v);
  const nightNode = uniform(0);
  if (night) {
    nightNode.onRenderUpdate(() => night.value);
  }
  return {
    uAO: u(defaults.uAO),
    uBands: u(defaults.uBands),
    uDuskGlow: u(defaults.uDuskGlow),
    uEave: u(defaults.uEave),
    uNight: nightNode,
    uRim: u(defaults.uRim),
    uRoofTint: u(defaults.uRoofTint),
    uRoofVibrance: u(defaults.uRoofVibrance),
    uRough: u(defaults.uRough),
    uTint: u(defaults.uTint),
  };
}

export function createNodeClayMaterial(
  resources: StyleResources,
  objects: { rows: number; texture: DataTexture }
): MeshStandardMaterial {
  // reason: createNodeClayUniforms built these as uniform nodes.
  const d = resources.clayDetail as unknown as Record<
    keyof ClayDetailUniforms,
    U
  >;
  const material = new MeshStandardNodeMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
  });

  // --- per vertex: the object's row --------------------------------------
  const id = int(attribute("featureId", "float").add(0.5));
  const at = ivec2(id.mod(OBJECT_TEXTURE_WIDTH), id.div(OBJECT_TEXTURE_WIDTH));
  const texel = (band: number) =>
    textureLoad(objects.texture, at.add(ivec2(0, band * objects.rows)));
  const a = texel(0);
  const b = texel(1);
  const c = texel(2);
  const roofAttr = attribute("roof", "float");
  const localH = varying(positionWorld.y.sub(a.w));
  const tint = varying(select(roofAttr.greaterThan(0.5), b.rgb, a.rgb));
  const build = varying(vec4(roofAttr, c.x, b.w, c.y));
  const rough = varying(c.z);

  // --- per fragment --------------------------------------------------------
  material.roughnessNode = clamp(float(1).add(d.uRough.mul(rough)), 0.55, 1);

  const isRoof = step(0.5, build.x);
  const tintMix = mix(d.uTint, d.uRoofTint, isRoof);
  const roofL = dot(tint, vec3(0.299, 0.587, 0.114));
  const roofC = tint.sub(roofL);
  const dull = float(1).sub(smoothstep(0.04, 0.3, length(roofC)));
  const vib = d.uRoofVibrance.mul(dull);
  const roofCol = vec3(roofL)
    .add(roofC.mul(float(1).add(vib.mul(2.4))))
    .add(vec3(0.018, 0.004, -0.014).mul(d.uRoofVibrance).mul(dull));
  const clayCol = mix(tint, clamp(roofCol, 0, 1), isRoof);
  const base = materialColor;
  let col: Node<"vec3"> = select(
    dot(tint, tint).greaterThan(1e-4),
    mix(base, clayCol, tintMix),
    base
  );
  const h = max(localH, 0);
  col = col.mul(mix(float(1).sub(d.uAO.mul(0.55)), 1, smoothstep(0, 5, h)));
  const wall = float(1).sub(smoothstep(0.5, 0.7, abs(normalWorld.y)));
  const storeys = h.div(max(build.y, 0.5));
  const line = float(1).sub(
    min(
      abs(fract(storeys.sub(0.5)).sub(0.5)).div(max(fwidth(storeys), 1e-4)),
      1
    )
  );
  col = col.mul(float(1).sub(line.mul(d.uBands).mul(wall)));
  const eave = float(1).sub(
    min(abs(h.sub(build.z)).div(max(fwidth(h).mul(2), 1e-4)), 1)
  );
  col = col.mul(float(1).sub(eave.mul(d.uEave).mul(wall).mul(0.6)));
  material.colorNode = col;

  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = float(1)
    .sub(clamp(dot(view, normalWorld), 0, 1))
    .pow(2);
  const glow = build.w.mul(d.uDuskGlow).mul(d.uNight);
  material.emissiveNode = vec3(1, 0.95, 0.8)
    .mul(fres.mul(d.uRim))
    .add(vec3(1, 0.82, 0.5).mul(glow.mul(wall).mul(0.5)));

  // reason: spike — the look's transparency writer sets opacity/alphaHash,
  // which the node material has too.
  return material as unknown as MeshStandardMaterial;
}
