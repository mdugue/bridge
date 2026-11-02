import {
  BufferAttribute,
  BufferGeometry,
  InterpolationSamplingType,
  type Material,
  MeshStandardNodeMaterial,
  type Texture,
  type UniformNode,
  Vector2,
} from "three/webgpu";
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  clamp,
  cos,
  distance,
  float,
  floor,
  Fn,
  fwidth,
  ivec2,
  length,
  max,
  mix,
  modelWorldMatrix,
  positionGeometry,
  sin,
  smoothstep,
  step,
  texture,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  BUILTUP_CLASS,
  EDGE_SCALE,
  RAILWAY_CLASS,
  ROAD_CLASS,
  srgbToLinear,
} from "@/lib/city/landcover";
import { trunkRadiusAt } from "@/lib/city/tree-inventory";
import { outOfDesignSite } from "./design-site";
import { byteOf, gdHash, gdNoise, texelAt, texelSize } from "./ground-detail";
import { instanceFloat, Instances } from "./instancing";
import {
  type Slots,
  setGraph,
  setSlots,
  slotsOf,
  slotTexture,
  slotUniform,
} from "./material-slots";
import { type F, rasterUv, type Tex, type V2, type V3 } from "./shader-chunks";
import {
  applyGroundLight,
  type GroundLight,
  groundLightKey,
} from "./sky-light";

/**
 * Where a tree meets the ground. A trunk alone stabbed into a flat ground
 * read cheap: the ground ran on to the bark with nothing between, and a
 * flat disc under it read as a sticker. Every trunk of the fine level now
 * has, on the trunks' own instance buffers (their matrices, drops and bark
 * colours — the very column views, so three's memory count, which the
 * governor reads, charges nothing twice), a site-shared geometry and a
 * material per tile:
 *
 * - at every foot, the trunk itself turns to earth (vegetation-layer.ts
 *   `buildTrunkMaterial`): no separate skirt, which read as a shoe;
 * - **in paving** (the class raster's built-up, road, railway or
 *   unclassified land, off the baked lawn): a **tree pit** — mulched earth
 *   with litter and the odd tuft of green, its rim wobbling a little, in a
 *   ring of setts. The pit is two sets drawn in order: every ring first,
 *   then every pit's earth, so two pits that overlap become one bed with
 *   one ring round it. Where the pit reaches the kerb (the edge raster's
 *   road distance) it stops short of it.
 *
 * The pit is lit as the ground is (its sun, shadows, sky view and far
 * horizon, sky-light.ts) and alpha-blended, so the paper styles leave it
 * out (paper-scene.ts). It covers what is under it (no glaze the paving
 * could show through), fades out between FADE_FROM and FADE_TO and casts
 * nothing. Which foot a tree gets is read once per vertex at the trunk's
 * foot, so it never splits a pit.
 */

/** The tree pit's radius (m): the trunk's foot radius plus this, within
 *  PIT_MIN..PIT_MAX, and how much its rim wobbles (a fraction). */
const PIT_CLEAR = 0.7;
const PIT_MIN = 0.85;
const PIT_MAX = 1.4;
const PIT_WOBBLE = 0.06;
/** The sett ring's width (m), a sett's length along it (m), the joints'
 *  width (m). */
const EDGING = 0.12;
const SETT = 0.14;
const JOINT = 0.014;
/** How far the pit keeps off the road edge (m, the kerb band and stone). */
const KERB_CLEAR = 0.32;
/** The quad's half-size beyond the pit (m): the ring and its antialiasing. */
const PIT_QUAD = PIT_MAX * (1 + PIT_WOBBLE) + EDGING + 0.08;
/** The feet fade out between these camera distances (m). */
const FADE_FROM = 70;
const FADE_TO = 150;
const linear = (srgb: [number, number, number]): V3 =>
  vec3(...(srgb.map(srgbToLinear) as [number, number, number]));
/** Albedos (sRGB): the pit's mulched earth, its litter, the green that
 *  grows in a corner, the setts, the joints' shade. */
const EARTH = linear([158, 136, 110]);
const LITTER = linear([188, 162, 120]);
const MOSS = linear([150, 170, 118]);
const STONE = linear([206, 200, 190]);
const JOINT_SHADE = 0.62;
/** The unit trunk's foot radius as drawn (flared), times the instance's
 *  horizontal scale gives the drawn foot. */
const TRUNK_FOOT = trunkRadiusAt(0);

/** The trunks' drop to the ground (vegetation-layer.ts `TRUNK_DROP`). */
const DROP = "iDrop";

/** The cull sphere's growth over the trunks' (m). */
export const FOOT_REACH = PIT_QUAD;

/** The tile-shared geometry: the pit's quad. */
export interface FootGeos {
  quad: BufferGeometry;
}

/** The quad (x, z in −1..1), facing up; the shader sizes it to the pit. */
export function buildFootGeos(): FootGeos {
  const quad = new BufferGeometry();
  quad.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
      3
    )
  );
  quad.setAttribute(
    "normal",
    new BufferAttribute(
      new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      3
    )
  );
  // wound counter-clockwise seen from above (+y)
  quad.setIndex([0, 2, 1, 0, 3, 2]);
  return { quad };
}

/** A tile's two foot materials (`footMaterialFor`). */
export interface FootMaterials {
  ring: Material;
  earth: Material;
}

/** Draw order among the blended sets: every ring, then every pit's earth. */
const ORDER = { ring: 1, earth: 2 } as const;

/**
 * The feet of a chunk's trunks: two sets on the trunks' buffers (the
 * very attribute objects: nothing uploaded or counted twice), drawn as
 * many as the trunks, culled by their sphere grown by the pit's reach.
 */
export function treeFeet(
  geos: FootGeos,
  materials: FootMaterials,
  trunks: Instances
): Instances[] {
  const sets: Instances[] = [];
  for (const part of ["ring", "earth"] as const) {
    const feet = new Instances(
      geos.quad,
      materials[part],
      trunks.capacity,
      trunks.instanceMatrix
    );
    for (const name of ["iMat0", "iMat1", "iMat2", "iMat3", DROP, "iColor"]) {
      const shared = trunks.geometry.getAttribute(name);
      if (shared) {
        feet.geometry.setAttribute(name, shared);
      }
    }
    feet.drawCount = trunks.drawCount;
    const sphere = trunks.geometry.boundingSphere?.clone();
    if (sphere) {
      sphere.radius += FOOT_REACH + 1;
      feet.geometry.boundingSphere = sphere;
    }
    feet.castShadow = false;
    feet.receiveShadow = true;
    feet.renderOrder = ORDER[part];
    feet.name = `tree-${part}`;
    sets.push(feet);
  }
  return sets;
}

/** What the feet's graphs read of a tile (the terrain's slots). */
export interface FootRasters {
  /** the class-id raster (NEAREST) */
  classTexture: Texture;
  /** the baked edge distances (RG), when the tile has them */
  edgesTexture?: Texture;
  /** the tile's north-west corner, recentered (data frame) */
  origin: Vector2;
  /** the tile's size (m) */
  size: [number, number];
}

/** A class id read as a float at a texel (clamped to the raster). */
const classTexel = (t: Tex, uv: V2): F => {
  const size = texelSize(t, uv);
  return byteOf(texelAt(t, ivec2(floor(uv.mul(vec2(size)))), size).r);
};

/** 1 for |x| ≥ 0.5 (a class id differs), else 0. */
const step01 = (x: F): F => smoothstep(0.49, 0.51, x);

/** 1 where `c` is ground a tree pit is cut into. */
const pavedClass = (c: F): F =>
  max(
    max(
      float(1).sub(step01(abs(c.sub(BUILTUP_CLASS)))),
      float(1).sub(step01(abs(c.sub(ROAD_CLASS))))
    ),
    max(
      float(1).sub(step01(abs(c.sub(RAILWAY_CLASS)))),
      float(1).sub(step01(c))
    )
  );

/** An edge-raster distance (m; R the road's, + on the road; G the lawn's). */
const edgeDistance = (v: F): F => v.mul(255).sub(128).div(EDGE_SCALE);

/** What every foot graph reads per instance (the vertex stage). */
interface FootFrame {
  /** the trunk's foot, content frame */
  foot: V3;
  /** the trunk's drawn foot radius (m) */
  rt: F;
  /** the trunk's foot, world */
  world: V3;
  /** 1 on paving off the lawn */
  pit: F;
  /** the camera's distance fade (1 near) */
  fade: F;
}

interface FootSlots {
  origin: UniformNode<"vec2", Vector2>;
  classTex: Tex;
  edgesTex?: Tex;
}

function footSlots(r: FootRasters): FootSlots {
  return {
    // reason: a Vector2 slot is a vec2 uniform; slotUniform types it loosely.
    origin: slotUniform("origin", r.origin) as unknown as UniformNode<
      "vec2",
      Vector2
    >,
    classTex: slotTexture("class", r.classTexture),
    edgesTex: r.edgesTexture && slotTexture("edges", r.edgesTexture),
  };
}

function footFrame(s: FootSlots, size: [number, number]): FootFrame {
  const col = (i: number) => attribute(`iMat${i}`, "vec4");
  // the trunk's foot in the content's frame (its matrix, lowered by its
  // drop) and its drawn foot radius
  const foot = col(3).xyz.sub(col(1).xyz.mul(instanceFloat(DROP)));
  const rt = float(TRUNK_FOOT).mul(length(col(0).xyz));
  const world = modelWorldMatrix.mul(vec4(foot, 1)).xyz;
  const uv = rasterUv(vec2(world.x, world.z.negate()), s.origin, size);
  // off the baked lawn (the green courtyards and front gardens the class
  // raster counts as built-up land): the edge raster's lawn distance
  const lawn = s.edgesTex
    ? smoothstep(
        -0.1,
        0.1,
        edgeDistance(texture(s.edgesTex, uv).level(float(0)).g)
      )
    : float(0);
  const pit = pavedClass(classTexel(s.classTex, uv)).mul(float(1).sub(lawn));
  const fade = float(1).sub(
    smoothstep(FADE_FROM, FADE_TO, distance(cameraPosition, world))
  );
  return { foot, rt, world, pit, fade };
}

/** A trunk standing in a loaded design's site is folded away
 *  (instancePosition); its foot folds with it. */
const folded = (placed: V3, foot: V3): V3 =>
  Fn(() => outOfDesignSite(placed, foot))();

/** The pit's radius at an angle: its clearance, wobbling by a world-space
 *  noise round the rim. */
function pitRadius(rt: F, angle: F, seed: V2): F {
  const base = clamp(rt.add(PIT_CLEAR), PIT_MIN, PIT_MAX);
  const around = vec2(cos(angle), sin(angle)).mul(1.6).add(seed);
  return base.mul(
    gdNoise(around)
      .sub(0.5)
      .mul(PIT_WOBBLE * 2)
      .add(1)
  );
}

interface PitGraph {
  color: V3;
  opacity: F;
  position: V3;
}

/** The ring's or the earth's graph (the tile's raster size, edges or not). */
function pitGraph(r: FootRasters, part: "ring" | "earth"): PitGraph {
  const s = footSlots(r);
  const f = footFrame(s, r.size);
  // lifted off the ground, more with distance (the depth's precision);
  // collapsed where the tree stands in no paving
  const lift = float(0.04).add(distance(cameraPosition, f.world).mul(0.0015));
  // none off paving, and collapsed once faded out: nothing to draw
  const q = positionGeometry.xz
    .mul(PIT_QUAD)
    .mul(step(0.5, f.pit))
    .mul(step(0.001, f.fade));
  const position = folded(f.foot.add(vec3(q.x, lift, q.y)), f.foot);
  const offset = varying(q, "vPitOffset");
  // FLAT: they seed the rim's wobble and the litter (AGENTS.md)
  const flat = <T extends F | V2>(v: T, name: string): T =>
    varying(v, name).setInterpolation(
      InterpolationSamplingType.FLAT
    ) as unknown as T;
  const rt = flat(f.rt, "vPitTrunk");
  const seed = flat(vec2(f.world.x, f.world.z).mul(0.37), "vPitSeed");
  const fade = varying(f.fade, "vPitFade");
  const xy = varying(vec2(f.world.x, f.world.z).add(q), "vPitXY");
  const edges = s.edgesTex;
  const uv = varying(
    rasterUv(
      vec2(f.world.x.add(q.x), f.world.z.add(q.y).negate()),
      s.origin,
      r.size
    ),
    "vPitUV"
  );
  const graph = Fn(() => {
    const d = length(offset).toVar();
    const w = max(fwidth(d), 0.002).toVar();
    const angle = atan(offset.y, offset.x).toVar();
    const pitR = pitRadius(rt, angle, seed).toVar();
    // off the kerb: the edge raster's road distance at the fragment
    const clear = edges
      ? float(1).sub(
          smoothstep(
            -KERB_CLEAR - 0.06,
            -KERB_CLEAR,
            edgeDistance(texture(edges, uv).level(float(0)).r)
          )
        )
      : float(1);
    if (part === "earth") {
      const inside = float(1).sub(smoothstep(pitR.sub(w), pitR.add(w), d));
      // mulch: two grains, litter flecks, a tuft of green in a corner
      const grain = gdNoise(xy.div(0.045))
        .mul(0.6)
        .add(gdNoise(xy.div(0.16).add(seed)).mul(0.4))
        .toVar();
      const fine = float(1).sub(smoothstep(0.008, 0.03, w));
      const litter = smoothstep(0.62, 0.7, gdNoise(xy.div(0.07).add(31)))
        .mul(fine)
        .mul(0.55);
      const moss = smoothstep(0.68, 0.82, gdNoise(xy.div(0.55).add(seed)))
        .mul(smoothstep(rt.add(0.15), pitR.mul(0.8), d))
        .mul(0.35);
      const base = mix(mix(EARTH, LITTER, litter), MOSS, moss);
      // darker toward the bark (the trunk's shade) and at the ring
      const contact = smoothstep(rt.add(0.5), rt, d).mul(0.25);
      return vec4(
        base
          .mul(grain.sub(0.5).mul(0.22).mul(fine).add(1))
          .mul(float(1).sub(contact)),
        inside.mul(clear).mul(fade)
      );
    }
    {
      // the ring: setts round the pit, a joint each SETT along it and on
      // both of its edges
      const out = d.sub(pitR).toVar();
      const inRing = smoothstep(w.negate(), w, out).mul(
        float(1).sub(
          smoothstep(float(EDGING).sub(w), float(EDGING).add(w), out)
        )
      );
      const along = angle.mul(pitR.add(EDGING / 2));
      const cell = along.div(SETT).toVar();
      const jw = w.mul(0.5).add(JOINT / 2);
      const across = float(1).sub(
        smoothstep(jw, jw.add(w), abs(cell.sub(floor(cell.add(0.5)))).mul(SETT))
      );
      const edgeJoint = float(1).sub(smoothstep(jw, jw.add(w), abs(out)));
      const outerJoint = float(1).sub(
        smoothstep(jw, jw.add(w), abs(out.sub(EDGING)))
      );
      const joints = max(max(across, edgeJoint), outerJoint)
        .mul(float(1).sub(smoothstep(0.015, 0.05, w)))
        .toVar();
      const stone = gdHash(vec2(floor(cell.add(0.5)), seed.x))
        .sub(0.5)
        .mul(0.12)
        .add(1);
      return vec4(
        STONE.mul(stone).mul(mix(float(1), JOINT_SHADE, joints)),
        max(inRing, outerJoint.mul(0.6)).mul(clear).mul(fade)
      );
    }
  })();
  return { color: graph.xyz, opacity: graph.w, position };
}

function litMaterial(
  name: string,
  graph: PitGraph,
  slots: Slots,
  light: GroundLight | undefined,
  key: string
): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  m.name = name;
  m.positionNode = graph.position;
  m.colorNode = graph.color;
  m.opacityNode = graph.opacity;
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  setSlots(m, slots);
  applyGroundLight(m, light);
  setGraph(m, `${key}|${groundLightKey(light)}`);
  return m;
}

const graphs = new Map<string, PitGraph>();
const cached = (key: string, make: () => PitGraph): PitGraph => {
  const known = graphs.get(key);
  if (known) {
    return known;
  }
  const made = make();
  graphs.set(key, made);
  return made;
};

/**
 * A tile's foot materials: the shared graphs of its raster size, the
 * tile's rasters and its baked light in their slots. Freed with the tile
 * (they are the tile's own).
 */
export function createFootMaterials(
  r: FootRasters,
  light?: GroundLight
): FootMaterials {
  const variant = `${r.size.join("x")}|${r.edgesTexture ? "edges" : ""}`;
  const slots: Slots = {
    origin: r.origin,
    class: r.classTexture,
    edges: r.edgesTexture,
  };
  const make = (part: "ring" | "earth"): Material => {
    const key = `tree-${part}|${variant}`;
    const graph = cached(key, () => pitGraph(r, part));
    return litMaterial(`tree-${part}`, graph, slots, light, key);
  };
  return { ring: make("ring"), earth: make("earth") };
}

/**
 * The foot materials of a fine terrain level, made from the rasters its
 * ground material reads (its slots) and its baked light: none where the
 * tile has no class raster — its trunks then stand on the bare ground.
 */
export function footMaterialFor(terrain: {
  bounds: readonly [number, number, number, number];
  mesh: { material: Material | Material[] };
  light?: GroundLight;
}): FootMaterials | undefined {
  const own = terrain.mesh.material;
  const slots = slotsOf(Array.isArray(own) ? (own[0] ?? null) : own);
  const classTexture = slots.class as Texture | undefined;
  const origin = slots.origin as Vector2 | undefined;
  if (!(classTexture && origin)) {
    return undefined;
  }
  const [minX, minY, maxX, maxY] = terrain.bounds;
  return createFootMaterials(
    {
      classTexture,
      edgesTexture: slots.edges as Texture | undefined,
      origin,
      size: [maxX - minX, maxY - minY],
    },
    terrain.light
  );
}
