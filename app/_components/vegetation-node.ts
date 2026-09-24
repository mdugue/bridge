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

/**
 * The crown and trunk materials are shared by every tile's vegetation (three
 * keys a node graph by its nodes' ids, so a per-tile copy would be
 * translated anew for each tile). Every tile's look refs carry the same
 * values; the shared uniforms read whichever tile built last.
 */
let refs: {
  leafBright: Live;
  leafFlutter: Live;
  shimmer: Live;
  translucency: Live;
} | null = null;
let crownShared: MeshStandardMaterial | null = null;
const trunkShared = new Map<number, MeshStandardMaterial>();
const live = (pick: (r: NonNullable<typeof refs>) => Live) =>
  uniform(0).onRenderUpdate(() => (refs ? pick(refs).value : 0));

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
  refs = { leafBright, leafFlutter, shimmer, translucency };
  if (crownShared) {
    return crownShared;
  }
  const m = new MeshStandardNodeMaterial({ color: 0xa6_bf_92, roughness: 1 });
  m.userData.shared = true;
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
  const flutter = live((r) => r.leafFlutter);
  const base = materialColor.rgb;
  const luma = dot(base, vec3(0.299, 0.587, 0.114));
  const under = mix(base, vec3(luma.mul(1.25).add(0.06)), 0.6);
  const leaf = mix(base, under, clamp(flutter.mul(twinkle), 0, 1));
  // Sway-coupled brightness: the crown brightens leaning into the gust.
  m.colorNode = leaf.mul(
    float(1).add(
      live((r) => r.leafBright)
        .mul(swayOut)
        .mul(0.18)
    )
  );

  const nearOrDay = float(1)
    .sub(smoothstep(120, 260, camDist))
    .mul(dayGate);
  m.emissiveNode = vec3(0.95, 0.85, 0.45)
    .mul(live((r) => r.shimmer).mul(pow(back, 3.6)))
    .add(
      vec3(0.45, 0.62, 0.3).mul(
        live((r) => r.translucency)
          .mul(pow(back, 1.6))
          .mul(nearOrDay)
      )
    )
    .add(vec3(0.9, 0.95, 0.6).mul(flutter.mul(twinkle).mul(0.14)));
  // reason: spike — callers only set colour/visibility on it.
  crownShared = m as unknown as MeshStandardMaterial;
  return crownShared;
}

export function createNodeTrunkMaterial(
  trunkHeight: number
): MeshStandardMaterial {
  const cached = trunkShared.get(trunkHeight);
  if (cached) {
    return cached;
  }
  const m = new MeshStandardNodeMaterial({ color: 0x8a_7c_68, roughness: 1 });
  m.userData.shared = true;
  const t = clamp(positionGeometry.y.div(trunkHeight), 0, 1);
  m.colorNode = materialColor.rgb.mul(mix(0.74, 1.05, smoothstep(0, 0.6, t)));
  // reason: spike — see createNodeCrownMaterial.
  const trunk = m as unknown as MeshStandardMaterial;
  trunkShared.set(trunkHeight, trunk);
  return trunk;
}

let hedgeShared: MeshStandardMaterial | null = null;

/** The hedge material, shared like the crowns. */
export function nodeHedgeMaterial(): MeshStandardMaterial {
  if (!hedgeShared) {
    const m = new MeshStandardNodeMaterial({ color: 0x55_6b_3e, roughness: 1 });
    m.userData.shared = true;
    hedgeShared = m as unknown as MeshStandardMaterial;
  }
  return hedgeShared;
}
