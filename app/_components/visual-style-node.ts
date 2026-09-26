import type { DataTexture, MeshStandardMaterial } from "three";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  floor,
  fwidth,
  int,
  ivec2,
  length,
  materialColor,
  max,
  min,
  mix,
  mod,
  normalize,
  normalWorld,
  positionWorld,
  select,
  sin,
  smoothstep,
  step,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { OBJECT_TEXTURE_WIDTH } from "@/lib/city/city-mesh";
import { createClaySkyNodes } from "./sky-light-node";
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
  night?: { value: number },
  skyView?: { value: number }
): ClayDetailUniforms {
  const u = (v: number) => uniform(v);
  const nightNode = uniform(0);
  if (night) {
    nightNode.onRenderUpdate(() => night.value);
  }
  // The terrain's Himmelslicht row, shared by reference.
  const skyViewNode = uniform(defaults.uSkyView);
  if (skyView) {
    skyViewNode.onRenderUpdate(() => skyView.value);
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
    uSkyView: skyViewNode,
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
  // The table's band height as a uniform, as the GLSL's uObjectRows: a
  // constant would make each tile's row count a shader of its own.
  const rows = uniform(objects.rows, "int");
  const texel = (band: number) =>
    textureLoad(objects.texture, at.add(ivec2(0, rows.mul(band))));
  const a = texel(0);
  const b = texel(1);
  const c = texel(2);
  const roofAttr = attribute("roof", "float");
  const localH = varying(positionWorld.y.sub(a.w));
  const tint = varying(select(roofAttr.greaterThan(0.5), b.rgb, a.rgb));
  const build = varying(vec4(roofAttr, c.x, b.w, c.y));
  const rough = varying(c.z);
  // OSM facts (lib/city/city-mesh.ts: shop 1, heritage 2)
  const flags = varying(c.w);

  // A triangle degenerate when its flat normal was baked has a zero normal;
  // quantisation can give it area again, and normalize(0) = NaN lighting
  // (black pixels the DoF spreads). visual-style.ts swaps in "up" per vertex;
  // so does this normal node (view space, as the lighting reads it).
  const rawNormal = attribute("normal", "vec3");
  const safeNormal = select(
    dot(rawNormal, rawNormal).lessThan(1e-8),
    vec3(0, 1, 0),
    rawNormal
  );
  material.normalNode = normalize(varying(transformNormalToView(safeNormal)));

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
  // Denkmal (visual-style.ts addOsmFacade): a barely-there warm lift of a
  // listed facade and a finer second cornice under the eave.
  const f = floor(flags.add(0.5));
  const shop = mod(f, 2);
  const listed = mod(floor(f.div(2)), 2);
  col = col.mul(
    vec3(1).add(vec3(0.035, 0.012, -0.012).mul(listed.mul(d.uTint).mul(wall)))
  );
  const cornice = float(1).sub(
    min(abs(h.sub(build.z.sub(0.45))).div(max(fwidth(h), 1e-4)), 1)
  );
  col = col.mul(
    float(1).sub(
      cornice.mul(listed).mul(step(2, build.z)).mul(d.uEave).mul(wall).mul(0.35)
    )
  );
  material.colorNode = col;
  // Himmelslicht: the courtyard's ground floor gets less of the sky.
  const sky = createClaySkyNodes();
  material.userData.skyNodes = sky;
  material.aoNode = sky.ao(h, build.z, d.uSkyView);

  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = float(1)
    .sub(clamp(dot(view, normalWorld), 0, 1))
    .pow(2);
  const glow = build.w.mul(d.uDuskGlow).mul(d.uNight);
  // Ladenlicht: a shop's ground floor at dusk, broken along the facade in
  // ≈ 3.5 m cells so a long front is no single strip.
  const ground = float(1).sub(smoothstep(0.7, 1, h.div(max(build.y, 0.5))));
  const along = normalize(
    vec2(normalWorld.z.negate(), normalWorld.x).add(1e-5)
  );
  const seg = dot(positionWorld.xz, along).div(3.5);
  const cell = floor(seg);
  const n0 = fract(sin(cell.mul(12.9898)).mul(43758.5453));
  const n1 = fract(sin(cell.add(1).mul(12.9898)).mul(43758.5453));
  const lit = mix(0.45, 1, mix(n0, n1, smoothstep(0, 1, fract(seg))));
  const shopGlow = shop
    .mul(ground)
    .mul(wall)
    .mul(lit)
    .mul(d.uDuskGlow)
    .mul(d.uNight);
  material.emissiveNode = vec3(1, 0.95, 0.8)
    .mul(fres.mul(d.uRim))
    .add(vec3(1, 0.82, 0.5).mul(glow.mul(wall).mul(0.5)))
    .add(vec3(1, 0.78, 0.45).mul(shopGlow.mul(0.4)));

  // reason: spike — the look's transparency writer sets opacity/alphaHash,
  // which the node material has too.
  return material as unknown as MeshStandardMaterial;
}
