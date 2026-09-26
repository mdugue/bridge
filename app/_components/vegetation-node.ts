import { type MeshStandardMaterial, Vector3 } from "three";
import {
  abs,
  attribute,
  cameraPosition,
  ceil,
  color,
  dFdx,
  dFdy,
  exp2,
  clamp,
  distance,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceColor,
  instanceIndex,
  length,
  log2,
  max,
  min,
  materialColor,
  mix,
  normalize,
  normalWorld,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { onNodeSceneEnd } from "./node-shared";
import {
  BARE_EPS,
  CROWN_BASE_COLOR,
  HASH_PIXELS,
  TWIG_COLOR,
  TWIG_DENSITY,
} from "./crown-season";

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
 * values; the shared uniforms read whichever tile built last — the sun's
 * direction too, so a remounted app's crowns follow its own sun. Freed with
 * the last app (node-shared.ts).
 */
let refs: {
  leafBright: Live;
  leafFlutter: Live;
  shimmer: Live;
  sunDirection: Vector3;
  translucency: Live;
} | null = null;
/** the leafy and the seasonal (bare) crown */
const crownShared = new Map<boolean, MeshStandardMaterial>();
const trunkShared = new Map<number, MeshStandardMaterial>();
let hedgeShared: MeshStandardMaterial | null = null;
onNodeSceneEnd(() => {
  for (const m of [...crownShared.values(), ...trunkShared.values()]) {
    m.dispose();
  }
  hedgeShared?.dispose();
  crownShared.clear();
  trunkShared.clear();
  hedgeShared = null;
  refs = null;
});
const live = (pick: (r: NonNullable<typeof refs>) => Live) =>
  uniform(0).onRenderUpdate(() => (refs ? pick(refs).value : 0));
const UP = new Vector3(0, 1, 0);

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

/** crown-season.ts's hashed alpha test (three's getAlphaHashThreshold at
 *  HASH_PIXELS): cells in the crown's own space about a pixel wide at any
 *  distance, blended between two power-of-two scales. */
function crownThreshold(p: Node<"vec3">, seed: Node<"vec3">): Node<"float"> {
  const h2 = (v: Node<"vec2">) =>
    fract(
      sin(v.x.mul(17).add(v.y.mul(0.1)))
        .mul(1e4)
        .mul(abs(sin(v.y.mul(13).add(v.x))).add(0.1))
    );
  const h3 = (v: Node<"vec3">) => h2(vec2(h2(v.xy), v.z));
  const maxDeriv = max(length(dFdx(p)), length(dFdy(p)));
  const pixScale = float(1).div(max(maxDeriv, 1e-6).mul(HASH_PIXELS));
  const lo = exp2(floor(log2(pixScale)));
  const hi = exp2(ceil(log2(pixScale)));
  const ax = h3(floor(p.mul(lo)).add(seed));
  const ay = h3(floor(p.mul(hi)).add(seed));
  const lerp = fract(log2(pixScale));
  const x = float(1).sub(lerp).mul(ax).add(lerp.mul(ay));
  const a = min(lerp, float(1).sub(lerp));
  const k = float(2).mul(a).mul(float(1).sub(a));
  const cx = x.mul(x).div(k);
  const cy = x.sub(a.mul(0.5)).div(float(1).sub(a));
  const cz = float(1).sub(float(1).sub(x).mul(float(1).sub(x)).div(k));
  const t = select(
    x.lessThan(float(1).sub(a)),
    select(x.lessThan(a), cx, cy),
    cz
  );
  return clamp(t, 1e-6, 1);
}

/**
 * The seasonal leaf cover of crown-season.ts: per instance `aBare`
 * (1 − leaf), a crown thinned to a sparse twig mass by a hashed alpha test
 * fixed to the tree. `keep` is the mask (three's shadow pass honours a
 * material's `maskNode`, so the shadow thins too — no depth material),
 * `twig` 1 where the fragment is twig.
 */
function crownSeason(): { keep: Node<"bool">; twig: Node<"float"> } {
  const bare = varying(attribute("aBare", "float"));
  // A fixed rotation turns the cells off the crown's axes; the seed
  // (per instance, as crown-season.ts's from the instance's column) offsets
  // the hash, so neighbours differ.
  const cell = varying(
    vec3(
      dot(positionGeometry, vec3(0.6667, 0.6667, 0.3333)),
      dot(positionGeometry, vec3(0.6667, -0.3333, -0.6667)),
      dot(positionGeometry, vec3(0.3333, -0.6667, 0.6667))
    )
  );
  const seed = varying(
    vec2(hash(instanceIndex), hash(instanceIndex.add(7919))).mul(97)
  );
  const h = crownThreshold(cell, vec3(seed, 0));
  const leafy = float(1).sub(bare);
  const isBare = bare.greaterThan(BARE_EPS);
  return {
    keep: isBare.and(h.greaterThanEqual(max(leafy, TWIG_DENSITY))).not(),
    twig: select(isBare, step(leafy, h), float(0)),
  };
}

export function createNodeCrownMaterial(
  sunDirection: Vector3,
  shimmer: Live,
  translucency: Live,
  leafFlutter: Live,
  leafBright: Live,
  bare = false
): MeshStandardMaterial {
  refs = { leafBright, leafFlutter, shimmer, sunDirection, translucency };
  const cached = crownShared.get(bare);
  if (cached) {
    return cached;
  }
  const m = new MeshStandardNodeMaterial({
    color: CROWN_BASE_COLOR,
    roughness: 1,
  });
  m.userData.shared = true;
  const season = bare ? crownSeason() : null;
  const sunDir = uniform(new Vector3(0, 1, 0)).onRenderUpdate(
    () => refs?.sunDirection ?? UP
  );

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
  const lit = leaf.mul(
    float(1).add(
      live((r) => r.leafBright)
        .mul(swayOut)
        .mul(0.18)
    )
  );
  // Twigs of a bare crown take the twig colour; three multiplies the
  // instance colour in after this node, so it is divided out here.
  // reason: instanceColor is a varying property three types loosely.
  const perInstance = instanceColor as unknown as Node<"vec3">;
  const twigCol = (color(TWIG_COLOR) as unknown as Node<"vec3">).div(
    max(perInstance, vec3(1e-3))
  );
  m.colorNode = season ? mix(lit, twigCol, season.twig) : lit;
  if (season) {
    m.maskNode = season.keep;
  }

  const nearOrDay = float(1)
    .sub(smoothstep(120, 260, camDist))
    .mul(dayGate);
  const glow = vec3(0.95, 0.85, 0.45)
    .mul(live((r) => r.shimmer).mul(pow(back, 3.6)))
    .add(
      vec3(0.45, 0.62, 0.3).mul(
        live((r) => r.translucency)
          .mul(pow(back, 1.6))
          .mul(nearOrDay)
      )
    )
    .add(vec3(0.9, 0.95, 0.6).mul(flutter.mul(twinkle).mul(0.14)));
  // Twigs neither shimmer nor glow.
  m.emissiveNode = season ? glow.mul(float(1).sub(season.twig)) : glow;
  // reason: spike — callers only set colour/visibility on it.
  const crown = m as unknown as MeshStandardMaterial;
  crownShared.set(bare, crown);
  return crown;
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

/** The hedge material, shared like the crowns. */
export function nodeHedgeMaterial(): MeshStandardMaterial {
  if (!hedgeShared) {
    const m = new MeshStandardNodeMaterial({ color: 0x55_6b_3e, roughness: 1 });
    m.userData.shared = true;
    hedgeShared = m as unknown as MeshStandardMaterial;
  }
  return hedgeShared;
}
