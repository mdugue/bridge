import {
  InstancedInterleavedBuffer,
  type InstancedMesh,
  type MeshStandardMaterial,
  Vector3,
} from "three";
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
  instanceColor,
  instancedBufferAttribute,
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
  uniform,
  varying,
  varyingProperty,
  vec2,
  vec3,
} from "three/tsl";
import {
  MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
} from "three/webgpu";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  disposeSharedMaterial,
  onNodeSceneEnd,
  shareMaterial,
} from "./node-shared";
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
 * translated anew for each tile). So are the crowns' look refs and clock on
 * this path (`nodeCrownRefs`): every tile's vegetation writes the same
 * objects, so a slider still reaches the crowns after the tile that built
 * them last has left. The sun is the latest caller's (one per app). Freed
 * with the last app (node-shared.ts).
 */
export interface CrownRefs {
  leafBright: Live;
  leafFlutter: Live;
  shimmer: Live;
  translucency: Live;
  /** the render loop's clock (vegetation setTime), as the GLSL's uTime */
  uTime: Live;
}
let refs: CrownRefs | null = null;
let sun: Vector3 | null = null;
/** the leafy and the seasonal (bare) crown */
const crownShared = new Map<boolean, MeshStandardMaterial>();
const trunkShared = new Map<number, MeshStandardMaterial>();
let hedgeShared: MeshStandardMaterial | null = null;
onNodeSceneEnd(() => {
  for (const m of [...crownShared.values(), ...trunkShared.values()]) {
    disposeSharedMaterial(m);
  }
  if (hedgeShared) {
    disposeSharedMaterial(hedgeShared);
  }
  crownShared.clear();
  trunkShared.clear();
  hedgeShared = null;
  refs = null;
  sun = null;
});

/** The crowns' look refs and clock, one set per scene on the node path. */
export function nodeCrownRefs(): CrownRefs {
  refs ??= {
    leafBright: { value: LOOK_DEFAULTS.leafBright },
    leafFlutter: { value: LOOK_DEFAULTS.leafFlutter },
    shimmer: { value: LOOK_DEFAULTS.shimmer },
    translucency: { value: LOOK_DEFAULTS.translucency },
    uTime: { value: 0 },
  };
  return refs;
}
const live = (pick: (r: CrownRefs) => Live) =>
  uniform(0).onRenderUpdate(() => pick(nodeCrownRefs()).value);
const UP = new Vector3(0, 1, 0);

/** Set per vertex from the instance's matrix (CrownNodeMaterial). */
const crownOrigin = varyingProperty("vec2", "vCrownOrigin");
const crownScale = varyingProperty("float", "vCrownScale");
/** The wind's bend in the crown's own frame (the GLSL's, before the
 *  instance transform): stiff at the base, loose at the top. */
let swayBend: ((phase: Node<"float">) => Node<"vec3">) | null = null;

/**
 * The crown material with the GLSL's order of things: the sway bends the
 * crown in its own space before the instance transform (so a tall tree
 * sways more and each leans its own way), and the instance's world column
 * and scale reach the fragment (the sway phase, the leaf-cover seed, the
 * large-crown translucency). Read from the instance matrix per build —
 * three builds every instanced mesh on its own anyway. The shadow pass
 * draws with its own material, so the cast shadow stays rigid, as it does
 * on WebGL.
 */
/**
 * The instance matrices as an instance-stepped buffer the columns read:
 * handed a plain attribute, three wraps it in a vertex-stepped one (the
 * step mode comes from the buffer), and the draw overruns it. One per mesh
 * (the crowns' matrices are written once, at build).
 */
const columnBuffers = new WeakMap<InstancedMesh, InstancedInterleavedBuffer>();
function instanceColumns(mesh: InstancedMesh): InstancedInterleavedBuffer {
  let buffer = columnBuffers.get(mesh);
  if (!buffer) {
    buffer = new InstancedInterleavedBuffer(mesh.instanceMatrix.array, 16, 1);
    columnBuffers.set(mesh, buffer);
  }
  return buffer;
}

class CrownNodeMaterial extends MeshStandardNodeMaterial {
  override setupPosition(builder: NodeBuilder): Node {
    const object = builder.object as InstancedMesh;
    if (object.isInstancedMesh && swayBend) {
      // columns 0 and 3 of the instance matrix: from the shared-instancing
      // attributes (shared-instancing.ts), else from the mesh's own buffer
      const shared = builder.geometry.getAttribute("iMat0") !== undefined;
      const matrices = shared ? null : instanceColumns(object);
      // reason: @types/three leaves the attribute node's type open.
      const column = (offset: number) =>
        (matrices
          ? instancedBufferAttribute(matrices, "vec4", 16, offset)
          : attribute(`iMat${offset / 4}`, "vec4")) as unknown as Node<"vec4">;
      const origin = column(12).xz;
      crownOrigin.assign(origin);
      crownScale.assign(length(column(0).xyz));
      positionLocal.addAssign(swayBend(dot(origin, vec2(0.07, 0.11))));
    } else {
      crownOrigin.assign(vec2(0));
      crownScale.assign(1);
    }
    return super.setupPosition(builder);
  }
}

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
  // A fixed rotation turns the cells off the crown's axes; the seed (from
  // the instance's column, as crown-season.ts's) offsets the hash, so
  // neighbours differ and a tree keeps its stipple across the LOD tiers.
  const cell = varying(
    vec3(
      dot(positionGeometry, vec3(0.6667, 0.6667, 0.3333)),
      dot(positionGeometry, vec3(0.6667, -0.3333, -0.6667)),
      dot(positionGeometry, vec3(0.3333, -0.6667, 0.6667))
    )
  );
  const seed = fract(crownOrigin.mul(0.0137)).mul(97);
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
  bare = false
): MeshStandardMaterial {
  sun = sunDirection;
  const cached = crownShared.get(bare);
  if (cached) {
    return cached;
  }
  const m = shareMaterial(
    new CrownNodeMaterial({ color: CROWN_BASE_COLOR, roughness: 1 })
  );
  const season = bare ? crownSeason() : null;
  const sunDir = uniform(new Vector3(0, 1, 0)).onRenderUpdate(() => sun ?? UP);
  const uTime = live((r) => r.uTime);

  // Wind sway (vegetation-layer.ts): phase from the instance's column.
  const phase = varyingProperty("float", "vCrownPhase");
  const swayOf = (p: Node<"float">) =>
    sin(uTime.mul(0.38).add(p)).add(
      sin(uTime.mul(0.8).add(p.mul(1.7))).mul(0.5)
    );
  swayBend = (p) => {
    phase.assign(p);
    const k = clamp(positionLocal.y.div(7), 0, 1).pow(2);
    return vec3(
      swayOf(p).mul(k).mul(0.16),
      0,
      sin(uTime.mul(0.31).add(p).add(1.7))
        .mul(k)
        .mul(0.6 * 0.16)
    );
  };
  // the gust signal again in the fragment (vSway), for the brightness pulse
  const sway = swayOf(phase);

  const view = normalize(cameraPosition.sub(positionWorld));
  const dayGate = clamp(sunDir.y, 0, 1);
  const back = clamp(dot(view, sunDir.negate()), 0, 1);

  // Leaf twinkle: pale undersides flipping in the wind, sunlit and near only.
  const leafUV = positionWorld.xz.add(positionWorld.y.mul(vec2(0.7, 0.5)));
  const twk = valueNoise(
    leafUV.mul(1.2).add(vec2(uTime.mul(0.7), uTime.mul(0.45)))
  ).add(
    valueNoise(leafUV.mul(2.8).sub(vec2(uTime.mul(1.1), uTime.mul(0.8)))).mul(
      0.6
    )
  );
  const sunFace = clamp(dot(normalWorld, sunDir), 0, 1);
  const camDist = distance(cameraPosition, positionWorld);
  const twinkle = smoothstep(0.95, 1.45, twk)
    .mul(dayGate)
    .mul(float(0.3).add(sunFace.mul(0.7)))
    .mul(float(1).sub(smoothstep(150, 420, camDist).mul(0.7)));
  const flutter = live((r) => r.leafFlutter);
  // The GLSL works on diffuseColor — base × the instance colour, or the
  // twig colour — and three multiplies the instance colour in after this
  // node: work on the product, divide it out at the end.
  // reason: instanceColor is a varying property three types loosely.
  const perInstance = max(instanceColor as unknown as Node<"vec3">, vec3(1e-3));
  let diffuse: Node<"vec3"> = materialColor.rgb.mul(perInstance);
  if (season) {
    diffuse = mix(
      diffuse,
      color(TWIG_COLOR) as unknown as Node<"vec3">,
      season.twig
    );
  }
  const luma = dot(diffuse, vec3(0.299, 0.587, 0.114));
  const under = mix(diffuse, vec3(luma.mul(1.25).add(0.06)), 0.6);
  const leaf = mix(diffuse, under, clamp(flutter.mul(twinkle), 0, 1));
  // Sway-coupled brightness: the crown brightens leaning into the gust.
  const lit = leaf.mul(
    float(1).add(
      live((r) => r.leafBright)
        .mul(sway)
        .mul(0.18)
    )
  );
  m.colorNode = lit.div(perInstance);
  if (season) {
    m.maskNode = season.keep;
  }

  // Translucency near OR on a large crown, by day.
  const large = smoothstep(1.2, 3, crownScale);
  const near = float(1).sub(smoothstep(120, 260, camDist));
  const gate = max(large, near).mul(dayGate);
  const glow = vec3(0.95, 0.85, 0.45)
    .mul(live((r) => r.shimmer).mul(pow(back, 3.6)))
    .add(
      vec3(0.45, 0.62, 0.3).mul(
        live((r) => r.translucency)
          .mul(pow(back, 1.6))
          .mul(gate)
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
  const m = shareMaterial(
    new MeshStandardNodeMaterial({ color: 0x8a_7c_68, roughness: 1 })
  );
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
    const m = shareMaterial(
      new MeshStandardNodeMaterial({ color: 0x55_6b_3e, roughness: 1 })
    );
    hedgeShared = m as unknown as MeshStandardMaterial;
  }
  return hedgeShared;
}
