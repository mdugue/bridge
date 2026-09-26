import { Color, DoubleSide, type Mesh, MeshStandardMaterial } from "three";
import { FENCE_CODE, FENCE_UV_CODES } from "@/lib/city/fences";
import {
  abs,
  cameraViewMatrix,
  color,
  floor,
  length,
  mix,
  normalize,
  positionView,
  select,
  smoothstep,
  uv,
  vec4,
} from "three/tsl";
import type { MeshStandardNodeMaterial, Node } from "three/webgpu";
import { nodeRenderer } from "./gpu-mode";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import {
  type GroundLight,
  groundLightKey,
  injectGroundLight,
} from "./sky-light";
import { groundLitNodeMaterial } from "./sky-light-node";

/*
 * A fence is one calm band (lib/city/fences.ts), in a single muted tone close
 * to the ground's and the hedges' (lib/city/landcover.ts: the built-up clay,
 * the meadow's sage): a warm grey-sage for railings, wire and handrails, a
 * warm stone for wood, a lighter stone for a gate's leaf and a boom — low
 * contrast against the ground, never dark. Plan 029's first look (dark iron
 * bars, a wire mesh, posts every 2.5 m, alpha-cut and dithered) read "zu hart
 * und kleinteilig" on a phone, and its fine detail aliased (moiré, shimmer);
 * the band has no holes, no dither and nothing finer than its own height.
 */
const SAGE_STONE = 0xcf_d0_bf;
const WOOD = 0xd6_cb_b8;
const LEAF = 0xdc_d7_c8;
/** The band's top edge lightens toward this: a see-through impression by
 *  colour alone. */
const TOP = 0xe6_e4_da;
/** Far off the band fades toward the pale ground (the built-up clay). */
const FAR = 0xe0_da_cc;
const FAR_START_M = 40;
const FAR_END_M = 160;
/** A touch of self-light, so the band never reads as a dark sheet. */
const LIFT = 0.08;

const glslVec3 = (hex: number) => {
  const c = new Color(hex); // linear, as the shader works
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};
const f1 = (x: number) => x.toFixed(4);

/** The kind from `u` (lib/city/fences.ts `fenceU`) → its tone. */
const FENCE_TONE = /* glsl */ `
varying vec2 vFenceUv;
vec3 fenceTone() {
  float code = floor( vFenceUv.x * ${f1(FENCE_UV_CODES)} );
  if ( abs( code - ${f1(FENCE_CODE.gate)} ) < 0.5 || abs( code - ${f1(FENCE_CODE.frame)} ) < 0.5 ) return ${glslVec3(LEAF)};
  if ( abs( code - ${f1(FENCE_CODE.picket)} ) < 0.5 ) return ${glslVec3(WOOD)};
  return ${glslVec3(SAGE_STONE)};
}
`;

const VERTEX_UV = "#include <begin_vertex>\nvFenceUv = uv;";

/**
 * The band's colour: its tone, a breath deeper at the foot (rooted, like the
 * hedges), lighter toward its top edge, and fading toward the pale ground
 * with distance. Everything varies with the height fraction or the distance
 * only — smooth across a whole quad, so nothing can alias.
 */
const FRAGMENT_TONE = `#include <map_fragment>
vec3 fenceCol = mix( fenceTone(), ${glslVec3(TOP)}, 0.65 * smoothstep( 0.55, 1.0, vFenceUv.y ) );
fenceCol *= mix( 0.93, 1.0, smoothstep( 0.0, 0.4, vFenceUv.y ) );
fenceCol = mix( fenceCol, ${glslVec3(FAR)}, 0.7 * smoothstep( ${f1(FAR_START_M)}, ${f1(FAR_END_M)}, length( vViewPosition ) ) );
diffuseColor.rgb *= fenceCol;`;

/**
 * The band is lit as the ground it stands on: its normal is the world's up,
 * so both faces take the ground's light whatever the sun's side — a
 * vertical quad lit as one was a dark grey sheet against the pale ground on
 * the side away from the sun. Shadows it receives still fall on it.
 */
const FRAGMENT_NORMAL = `#include <normal_fragment_maps>
normal = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );`;

/** Lifts the band a touch toward its tone (see LIFT). */
const FRAGMENT_LIFT = `#include <emissivemap_fragment>
totalEmissiveRadiance += ${f1(LIFT)} * diffuseColor.rgb;`;

/**
 * Fences, railings and gates from OSM, baked with the terrain: the fine
 * terrain glTF carries a `fences` node (lib/city/fences.ts, written by
 * scripts/bake-tiles.ts `fenceMesh` on the final ground). This gives it its
 * material: an opaque, double-sided band in one tone, lit as the ground
 * (FRAGMENT_NORMAL) — and by the ground's baked light too, its sky view
 * and far horizon (`light`, sky-light.ts). It receives shadows
 * but casts none — an opaque band would cast a solid wall of shadow, and a
 * light one needs a dithered depth pass, which is what crawled. It arrives
 * and leaves with its tile.
 */
export function dressFences(
  mesh: Mesh,
  heightFog?: HeightFogUniforms,
  light?: GroundLight
): void {
  if (nodeRenderer()) {
    mesh.material = nodeFenceMaterial(light);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return;
  }
  const material = new MeshStandardMaterial({
    color: 0xff_ff_ff,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  const key = `fence-${groundLightKey(light, true)}-${heightFog !== undefined}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (sh) => {
    injectGroundLight(sh, light, true);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFenceUv;")
      .replace("#include <begin_vertex>", VERTEX_UV);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${FENCE_TONE}`)
      .replace("#include <map_fragment>", FRAGMENT_TONE)
      .replace("#include <normal_fragment_maps>", FRAGMENT_NORMAL)
      .replace("#include <emissivemap_fragment>", FRAGMENT_LIFT);
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  mesh.material = material;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
}

/**
 * SPIKE (plan 020): the band of dressFences as a node material — the same
 * tone by kind, top-edge lift, rooted foot, distance fade, the world-up
 * normal and the self-light; the ground light takes its ao and shadow
 * slots, the scene's fog node the height fog.
 */
function nodeFenceMaterial(light?: GroundLight): MeshStandardMaterial {
  const material = groundLitNodeMaterial(
    { color: 0xff_ff_ff, roughness: 1, metalness: 0, side: DoubleSide },
    light,
    true
  ) as unknown as MeshStandardNodeMaterial;
  const fenceUv = uv();
  const code = floor(fenceUv.x.mul(FENCE_UV_CODES));
  const is = (c: number) => abs(code.sub(c)).lessThan(0.5);
  const tone = select(
    is(FENCE_CODE.gate).or(is(FENCE_CODE.frame)),
    color(LEAF),
    select(is(FENCE_CODE.picket), color(WOOD), color(SAGE_STONE))
  );
  let col: Node<"vec3"> = mix(
    tone,
    color(TOP),
    smoothstep(0.55, 1, fenceUv.y).mul(0.65)
  );
  col = col.mul(mix(0.93, 1, smoothstep(0, 0.4, fenceUv.y)));
  col = mix(
    col,
    color(FAR),
    smoothstep(FAR_START_M, FAR_END_M, length(positionView)).mul(0.7)
  );
  material.colorNode = col;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
  material.emissiveNode = col.mul(LIFT);
  return material as unknown as MeshStandardMaterial;
}
