import {
  type BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  type Material,
  type Texture,
  type Vector3,
} from "three";
import {
  attribute,
  color,
  float,
  materialEmissive,
  materialOpacity,
  mix,
  normalize,
  normalView,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu";
import {
  CLAY_COLOR,
  FOUNTAIN_UNIFORMS,
  SPRAY_COLOR,
  WATER_COLOR,
  WATER_GLOW,
} from "./monument-layer";
import {
  disposeSharedMaterial,
  onNodeSceneEnd,
  shareMaterial,
} from "./node-shared";

/**
 * SPIKE (plan 020): the fountain materials of monument-layer.ts in TSL, term
 * for term its `onBeforeCompile` patches: the breathing water bells with
 * droplets running down the curtain and their night glow (`animateSpray`),
 * the basin water's crossing swells and glow (`animateWater`), the
 * sculpture's uplight from the basin (`uplight`). Clock and night factor are
 * the shared `FOUNTAIN_UNIFORMS` refs (`setFountainTime`/`setFountainNight`).
 * Height fog is the scene's fog node. Shared by every tile (shareMaterial),
 * as the tree materials are, so no tile translates its own graphs.
 */

export interface MonumentMaterials {
  clay: Material;
  litClay: Material;
  spray: Material;
  water: Material;
}

let shared: MonumentMaterials | null = null;
let sharedAlpha: Texture | null = null;
// Freed with the last app (node-shared.ts), the bells' alpha with them.
onNodeSceneEnd(() => {
  if (shared) {
    for (const m of [shared.clay, shared.litClay, shared.water, shared.spray]) {
      disposeSharedMaterial(m);
    }
  }
  sharedAlpha?.dispose();
  shared = null;
  sharedAlpha = null;
});

const fountainTime = () =>
  uniform(0).onRenderUpdate(() => FOUNTAIN_UNIFORMS.uFountainTime.value);
const fountainNight = () =>
  uniform(0).onRenderUpdate(() => FOUNTAIN_UNIFORMS.uFountainNight.value);

/**
 * Each jet's phase (a hash of its position, as the GLSL derives it from
 * `instanceMatrix[3].xz`) and its base height, per instance: the node
 * material sees positions after the instance transform, so the breathing
 * scales the height above the base rather than the local y.
 */
export function addJetAttribute(
  geometry: BufferGeometry,
  jets: { at: Vector3 }[]
): void {
  const data = new Float32Array(jets.length * 2);
  for (let i = 0; i < jets.length; i++) {
    const { x, y, z } = jets[i].at;
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43_758.5453;
    data[i * 2] = (h - Math.floor(h)) * 6.2831;
    data[i * 2 + 1] = y;
  }
  geometry.setAttribute("aJet", new InstancedBufferAttribute(data, 2));
}

function sprayMaterial(alpha: Texture): Material {
  const time = fountainTime();
  const night = fountainNight();
  const spray = new MeshBasicNodeMaterial({
    color: SPRAY_COLOR,
    alphaMap: alpha,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: DoubleSide,
  });
  const jet = attribute<"vec2">("aJet", "vec2");
  const phase = jet.x;
  // Rotation about Y and the per-instance scale commute with a Y scale, so
  // scaling the height above the base is the GLSL's local `transformed.y *=`.
  const breath = float(1)
    .add(sin(time.mul(1.1).add(phase)).mul(0.07))
    .add(sin(time.mul(2.7).add(phase.mul(1.7))).mul(0.03));
  spray.positionNode = vec3(
    positionLocal.x,
    jet.y.add(positionLocal.y.sub(jet.y).mul(breath)),
    positionLocal.z
  );
  const swirl = sin(uv().x.mul(43.98).add(phase)).mul(1.5);
  spray.opacityNode = materialOpacity.mul(
    float(0.72).add(sin(uv().y.mul(38).sub(time.mul(5)).add(swirl)).mul(0.28))
  );
  spray.colorNode = mix(
    color(SPRAY_COLOR),
    vec3(1, 0.93, 0.8).mul(1.5),
    night.mul(0.5)
  );
  return spray;
}

function waterMaterial(): Material {
  const time = fountainTime();
  const night = fountainNight();
  const water = new MeshStandardNodeMaterial({
    color: WATER_COLOR,
    emissive: WATER_GLOW,
    roughness: 0.12,
    metalness: 0,
  });
  const p = positionWorld;
  // Three crossing swells, none aligned with another, so no stripes read.
  const ripA: Node<"float"> = sin(
    p.x.mul(2.3).add(p.z.mul(0.7)).add(time.mul(1.6))
  )
    .add(sin(p.z.mul(2.9).sub(p.x.mul(1.1)).sub(time.mul(1.3))))
    .add(sin(p.x.add(p.z).mul(4.1).add(time.mul(2.3))))
    .div(3);
  const ripB = sin(p.x.mul(3.7).sub(p.z.mul(1.9)).add(time.mul(2.1)));
  water.normalNode = normalize(
    normalView.add(vec3(ripA.mul(0.06), ripB.mul(0.06), 0))
  );
  water.emissiveNode = materialEmissive
    .add(vec3(0.03, 0.04, 0.045).mul(ripA.mul(0.5).add(0.5)))
    .add(vec3(0.12, 0.17, 0.2).mul(night.mul(ripA.mul(0.2).add(0.8))));
  return water;
}

function litClayMaterial(): Material {
  const night = fountainNight();
  const lit = new MeshStandardNodeMaterial({
    color: CLAY_COLOR,
    roughness: 0.95,
    metalness: 0,
  });
  const lift = attribute<"float">("aLift", "float");
  lit.emissiveNode = materialEmissive.add(
    vec3(1, 0.82, 0.6).mul(
      night.mul(0.55).mul(float(1).sub(smoothstep(0, 2.5, lift)))
    )
  );
  return lit;
}

/** The four materials, built once (the bell alpha on first use). */
export function nodeMonumentMaterials(
  makeAlpha: () => Texture
): MonumentMaterials {
  if (!shared) {
    const clay = new MeshStandardNodeMaterial({
      color: CLAY_COLOR,
      roughness: 0.95,
      metalness: 0,
    });
    shared = {
      clay,
      litClay: litClayMaterial(),
      water: waterMaterial(),
      spray: sprayMaterial((sharedAlpha = makeAlpha())),
    };
    for (const m of [shared.clay, shared.litClay, shared.water, shared.spray]) {
      shareMaterial(m);
    }
  }
  return shared;
}
