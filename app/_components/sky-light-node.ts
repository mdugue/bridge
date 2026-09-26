import {
  type MeshStandardMaterial,
  type Texture,
  Vector2,
  type Vector3,
} from "three";
import {
  asin,
  atan,
  clamp,
  degrees,
  distance,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  texture,
  uniform,
  vec2,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import {
  FACADE_SVF_GAIN,
  FACADE_SVF_OFFSET_M,
  HORIZON_AZIMUTHS,
  HORIZON_LAYERS,
  HORIZON_MAX_DEG,
  HORIZON_SOFT_DEG,
  NEAR_BAND_FADE_FROM,
  NEAR_MAX_DEG,
} from "@/lib/city/skyview";
import { openSkyTexture } from "./sky-light";

/**
 * SPIKE (plan 020): sky-light.ts on the node renderer — the same two terms
 * from the same rasters, as node-material slots instead of chunk patches:
 *
 * - Himmelslicht scales the indirect diffuse light only: three's `aoNode`
 *   (the ambient-occlusion slot multiplies `indirectDiffuse`, as
 *   `aomap_fragment` does in the GLSL).
 * - Ferne Schatten cuts the sun's direct light: `receivedShadowNode`
 *   folds the horizon into the directional shadow by `min`, exactly the
 *   `min( shadow map, hzLit )` of `lightsWithFarShadow`.
 */

type Live<T> = { value: T };
const live = (ref: Live<number>) =>
  uniform(ref.value).onRenderUpdate(() => ref.value);

/** Data-frame XY of the fragment: world (x, y, z) = data (x, −z, y). */
const dataXY = (): Node<"vec2"> =>
  vec2(positionWorld.x, positionWorld.z.negate());

/** A tile's raster uv at data-frame `xy`: v grows southward. */
function rasterUv(
  xy: Node<"vec2">,
  origin: [number, number],
  size: [number, number]
): Node<"vec2"> {
  // The corner as a uniform: every tile compiles to the same shader.
  const o = uniform(new Vector2(origin[0], origin[1]));
  return vec2(xy.x.sub(o.x).div(size[0]), o.y.sub(xy.y).div(size[1]));
}

/** What a tile's ground light binds (sky-light.ts `GroundLight`). */
export interface NodeGroundLight {
  svf?: Texture;
  horizon?: Texture;
  origin: [number, number];
  size: [number, number];
  skyView: Live<number>;
  horizonShade: Live<number>;
  shadowReach: Live<Vector3>;
  sunDirection: Vector3;
}

/**
 * The horizon's sun visibility at `uv` (1 = the sun clears the skyline),
 * both bands, the near one faded in over the shadow frustum's last 20 %
 * (lib/city/skyview.ts horizonSunVisibility / nearBandWeight).
 */
function horizonSunVisible(
  horizon: Texture,
  uv: Node<"vec2">,
  xy: Node<"vec2">,
  light: NodeGroundLight
): Node<"float"> {
  const sun = uniform(light.sunDirection).onRenderUpdate(
    () => light.sunDirection
  );
  const reach = uniform(light.shadowReach.value).onRenderUpdate(
    () => light.shadowReach.value
  );
  const angle = (k: Node<"float">, base: number, maxDeg: number) => {
    // level 0: the array has no mips
    const v = texture(horizon, uv)
      .depth(floor(k.div(4)).add(base))
      .level(float(0));
    const c = mod(k, 4);
    return select(
      c.lessThan(0.5),
      v.r,
      select(c.lessThan(1.5), v.g, select(c.lessThan(2.5), v.b, v.a))
    ).mul(maxDeg);
  };
  const clears = (h: Node<"float">, el: Node<"float">) =>
    smoothstep(h.sub(HORIZON_SOFT_DEG), h.add(HORIZON_SOFT_DEG), el);
  const el = degrees(asin(clamp(sun.y, -1, 1)));
  const az = mod(degrees(atan(sun.x, sun.z.negate())).add(360), 360);
  const f = az.div(360 / HORIZON_AZIMUTHS);
  const k0 = mod(floor(f), HORIZON_AZIMUTHS);
  const k1 = mod(k0.add(1), HORIZON_AZIMUTHS);
  const t = fract(f);
  const far = clears(
    mix(angle(k0, 0, HORIZON_MAX_DEG), angle(k1, 0, HORIZON_MAX_DEG), t),
    el
  );
  const r = max(reach.z, 1);
  const w = smoothstep(r.mul(NEAR_BAND_FADE_FROM), r, distance(xy, reach.xy));
  const hn = mix(
    angle(k0, HORIZON_LAYERS, NEAR_MAX_DEG),
    angle(k1, HORIZON_LAYERS, NEAR_MAX_DEG),
    t
  );
  const both = min(far, mix(float(1), clears(hn, el), w));
  // straight overhead the azimuth is undefined, and the sun clears all
  return select(length(sun.xz).lessThan(1e-4), float(1), both);
}

/** The node slots a ground light fills (either may be absent). */
export interface GroundLightNodes {
  /** the indirect-diffuse scale (material.aoNode) */
  ao: Node<"float"> | null;
  /** the horizon folded into the sun's shadow (material.receivedShadowNode) */
  receivedShadow: ((shadow: Node<"float">) => Node<"float">) | null;
}

/**
 * The terrain's and its baked parts' light terms, read at the fragment's
 * own ground position. `skyView` false leaves the sky view out (the walls
 * take the horizon only, as injectGroundLight's callers decide).
 */
export function groundLightNodes(
  light: NodeGroundLight | undefined,
  skyView = true
): GroundLightNodes {
  if (!light) {
    return { ao: null, receivedShadow: null };
  }
  const xy = dataXY();
  const uv = rasterUv(xy, light.origin, light.size);
  const ao =
    skyView && light.svf
      ? mix(float(1), texture(light.svf, uv).r, live(light.skyView))
      : null;
  let receivedShadow: GroundLightNodes["receivedShadow"] = null;
  if (light.horizon) {
    const lit = mix(
      float(1),
      horizonSunVisible(light.horizon, uv, xy, light),
      live(light.horizonShade)
    );
    receivedShadow = (shadow) => min(shadow, lit);
  }
  return { ao, receivedShadow };
}

/** The slots of a node material the ground light writes. */
interface LitNodeMaterial {
  aoNode: Node | null;
  receivedShadowNode: ((shadow: Node) => Node) | null;
}

/** Writes a ground light into a node material's ao / shadow slots. */
export function applyGroundLightNodes(
  material: LitNodeMaterial,
  light: NodeGroundLight | undefined,
  skyView = true
): void {
  const nodes = groundLightNodes(light, skyView);
  if (nodes.ao) {
    material.aoNode = nodes.ao;
  }
  if (nodes.receivedShadow) {
    // reason: three calls the slot with the shadow node and uses what it
    // returns; its typing is looser than the float in and out here.
    material.receivedShadowNode = nodes.receivedShadow as unknown as (
      shadow: Node
    ) => Node;
  }
}

/**
 * A tile's facade sky view, set once its raster lands (visual-style.ts
 * setClaySkyView): uniform writes, no rebuild.
 */
export interface ClaySkyNodes {
  set: (
    texture: Texture,
    origin: [number, number],
    size: [number, number]
  ) => void;
  /** the ambient scale for the clay's aoNode (CLAY_SKY_AO) */
  ao: (
    localH: Node<"float">,
    eaveH: Node<"float">,
    skyView: Node<"float">
  ) => Node<"float">;
}

export function createClaySkyNodes(): ClaySkyNodes {
  const svf = texture(openSkyTexture());
  const origin = uniform(new Vector2(0, 0));
  const size = uniform(new Vector2(1, 1));
  return {
    set: (tex, o, s) => {
      svf.value = tex;
      origin.value.set(o[0], o[1]);
      size.value.set(s[0], s[1]);
    },
    ao: (localH, eaveH, skyView) => {
      // The ground's sky view a little outside the wall, doubled, faded to
      // the open sky toward the eaves (sky-light.ts CLAY_SKY_AO).
      const n = vec2(normalWorld.x, normalWorld.z.negate());
      const nl = length(n);
      const out = select(nl.greaterThan(1e-3), n.div(max(nl, 1e-3)), vec2(0));
      const p = dataXY().add(out.mul(FACADE_SVF_OFFSET_M));
      const uv = vec2(
        p.x.sub(origin.x).div(size.x),
        origin.y.sub(p.y).div(size.y)
      );
      const facade = min(svf.sample(uv).r.mul(FACADE_SVF_GAIN), 1);
      const open = mix(facade, float(1), smoothstep(0, max(eaveH, 3), localH));
      return mix(float(1), open, skyView);
    },
  };
}

/**
 * A plain standard node material lit by a tile's ground light — the node
 * path of what stands on the fine terrain (kerbs, stairs, walls, fences),
 * whose GLSL path patches the same terms in with `injectGroundLight`.
 */
export function groundLitNodeMaterial(
  params: ConstructorParameters<typeof MeshStandardNodeMaterial>[0],
  light: NodeGroundLight | undefined,
  skyView: boolean
): MeshStandardMaterial {
  const material = new MeshStandardNodeMaterial(params);
  applyGroundLightNodes(material, light, skyView);
  // reason: the layers hold it where a MeshStandardMaterial goes; the
  // members they touch exist on both.
  return material as unknown as MeshStandardMaterial;
}
