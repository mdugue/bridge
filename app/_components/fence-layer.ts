import { Color, DoubleSide, type Mesh } from "three/webgpu";
import {
  cameraViewMatrix,
  floor,
  mix,
  positionView,
  select,
  smoothstep,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { FENCE_CODE, FENCE_UV_CODES } from "@/lib/city/fences";
import type { F, V3 } from "./shader-chunks";
import { type GroundLight, groundLitMaterial } from "./sky-light";

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

/** A tone as a vec3 (`Color` converts the sRGB hex to linear, as the
 *  shader works). */
const tone = (hex: number): V3 => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};

/** Whether the kind code `code` is `kind`. */
const isKind = (code: F, kind: number) => code.sub(kind).abs().lessThan(0.5);

/** The kind from `u` (lib/city/fences.ts `fenceU`) → its tone. */
function fenceTone(): V3 {
  const code = floor(uv().x.mul(FENCE_UV_CODES));
  return select(
    isKind(code, FENCE_CODE.gate).or(isKind(code, FENCE_CODE.frame)),
    tone(LEAF),
    select(isKind(code, FENCE_CODE.picket), tone(WOOD), tone(SAGE_STONE))
  );
}

/**
 * The band's colour: its tone, a breath deeper at the foot (rooted, like the
 * hedges), lighter toward its top edge, and fading toward the pale ground
 * with distance. Everything varies with the height fraction (`v`) or the
 * distance only — smooth across a whole quad, so nothing can alias.
 */
function fenceColour(): V3 {
  const v = uv().y;
  const topped = mix(fenceTone(), tone(TOP), smoothstep(0.55, 1, v).mul(0.65));
  const rooted = topped.mul(mix(0.93, 1, smoothstep(0, 0.4, v)));
  const fade = smoothstep(FAR_START_M, FAR_END_M, positionView.length()).mul(
    0.7
  );
  return mix(rooted, tone(FAR), fade);
}

/**
 * Fences, railings and gates from OSM, baked with the terrain: the fine
 * terrain glTF carries a `fences` node (lib/city/fences.ts, written by
 * scripts/bake-tiles.ts `fenceMesh` on the final ground). This gives it its
 * material: an opaque, double-sided band in one tone, lit as the ground —
 * and by the ground's baked light too, its sky view and far horizon
 * (`light`, sky-light.ts). It receives shadows but casts none — an opaque
 * band would cast a solid wall of shadow, and a light one needs a dithered
 * depth pass, which is what crawled. It arrives and leaves with its tile.
 */
export function dressFences(mesh: Mesh, light?: GroundLight): void {
  const material = groundLitMaterial(
    { color: 0xff_ff_ff, roughness: 1, metalness: 0, side: DoubleSide },
    light,
    true
  );
  const colour = fenceColour();
  material.colorNode = colour;
  // The band is lit as the ground it stands on: its normal is the world's
  // up (in view space, as the slot takes it), so both faces take the
  // ground's light whatever the sun's side — a vertical quad lit as one was
  // a dark grey sheet against the pale ground on the side away from the
  // sun. Shadows it receives still fall on it.
  material.normalNode = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize();
  // Lifts the band a touch toward its tone (see LIFT; the material colour
  // is white, so the tone is the diffuse colour).
  material.emissiveNode = colour.mul(LIFT);
  mesh.material = material;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
}
