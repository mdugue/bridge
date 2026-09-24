import type { MeshStandardMaterial, Vector3 } from "three";
import {
  cameraPosition,
  clamp,
  distance,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  materialColor,
  mix,
  normalize,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";

/**
 * SPIKE (plan 020): the crown and trunk materials of vegetation-layer.ts in
 * TSL. Ported: wind sway (stiff base, loose top, per-tree phase), the
 * sway-coupled brightness, leaf twinkle, the backlit shimmer and the
 * translucency glow, the trunk's rooted gradient. Not ported: the shimmer's
 * shadow gate (the GLSL samples the sun's shadow map 2 m toward the sun; the
 * node version gates on sun elevation only), and the per-tree phase comes
 * from the instance index instead of the instance's world column.
 */

type Live = { value: number };
const live = (ref: Live) => uniform(ref.value).onRenderUpdate(() => ref.value);

/** Smoothed value noise over a hash lattice (the GLSL leafNoise). */
function valueNoise(p: Node<"vec2">): Node<"float"> {
  const h = (q: Node<"vec2">) =>
    fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(
    mix(h(i), h(i.add(vec2(1, 0))), u.x),
    mix(h(i.add(vec2(0, 1))), h(i.add(vec2(1, 1))), u.x),
    u.y
  );
}

export function createNodeCrownMaterial(
  sunDirection: Vector3,
  shimmer: Live,
  translucency: Live,
  leafFlutter: Live,
  leafBright: Live
): MeshStandardMaterial {
  const m = new MeshStandardNodeMaterial({ color: 0xa6_bf_92, roughness: 1 });
  const sunDir = uniform(sunDirection).onRenderUpdate(() => sunDirection);

  // Wind sway, after instancing (positionLocal is already the tree's frame
  // in the Y-up scene): stiff at the base, loose at the top.
  const phase = hash(instanceIndex).mul(40);
  const k = clamp(positionGeometry.y.div(7), 0, 1).pow(2);
  const sway = sin(time.mul(0.38).add(phase)).add(
    sin(time.mul(0.8).add(phase.mul(1.7))).mul(0.5)
  );
  const bend = 0.22;
  m.positionNode = positionLocal.add(
    vec3(
      sway.mul(k).mul(bend),
      0,
      sin(time.mul(0.31).add(phase).add(1.7))
        .mul(k)
        .mul(0.6 * bend)
    )
  );
  const swayOut = varying(sway);

  const view = normalize(cameraPosition.sub(positionWorld));
  const dayGate = clamp(sunDir.y, 0, 1);
  const back = clamp(dot(view, sunDir.negate()), 0, 1);

  // Leaf twinkle: pale undersides flipping in the wind, sunlit and near only.
  const leafUV = positionWorld.xz.add(positionWorld.y.mul(vec2(0.7, 0.5)));
  const twk = valueNoise(
    leafUV.mul(1.2).add(vec2(time.mul(0.7), time.mul(0.45)))
  ).add(
    valueNoise(leafUV.mul(2.8).sub(vec2(time.mul(1.1), time.mul(0.8)))).mul(0.6)
  );
  const sunFace = clamp(dot(normalWorld, sunDir), 0, 1);
  const camDist = distance(cameraPosition, positionWorld);
  const twinkle = smoothstep(0.95, 1.45, twk)
    .mul(dayGate)
    .mul(float(0.3).add(sunFace.mul(0.7)))
    .mul(float(1).sub(smoothstep(150, 420, camDist).mul(0.7)));
  const flutter = live(leafFlutter);
  const base = materialColor.rgb;
  const luma = dot(base, vec3(0.299, 0.587, 0.114));
  const under = mix(base, vec3(luma.mul(1.25).add(0.06)), 0.6);
  const leaf = mix(base, under, clamp(flutter.mul(twinkle), 0, 1));
  // Sway-coupled brightness: the crown brightens leaning into the gust.
  m.colorNode = leaf.mul(float(1).add(live(leafBright).mul(swayOut).mul(0.18)));

  const nearOrDay = float(1)
    .sub(smoothstep(120, 260, camDist))
    .mul(dayGate);
  m.emissiveNode = vec3(0.95, 0.85, 0.45)
    .mul(live(shimmer).mul(pow(back, 3.6)))
    .add(
      vec3(0.45, 0.62, 0.3).mul(
        live(translucency).mul(pow(back, 1.6)).mul(nearOrDay)
      )
    )
    .add(vec3(0.9, 0.95, 0.6).mul(flutter.mul(twinkle).mul(0.14)));
  // reason: spike — callers only set colour/visibility on it.
  return m as unknown as MeshStandardMaterial;
}

export function createNodeTrunkMaterial(
  trunkHeight: number
): MeshStandardMaterial {
  const m = new MeshStandardNodeMaterial({ color: 0x8a_7c_68, roughness: 1 });
  const t = clamp(positionGeometry.y.div(trunkHeight), 0, 1);
  m.colorNode = materialColor.rgb.mul(mix(0.74, 1.05, smoothstep(0, 0.6, t)));
  // reason: spike — see createNodeCrownMaterial.
  return m as unknown as MeshStandardMaterial;
}
