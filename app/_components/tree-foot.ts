import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  MeshBasicNodeMaterial,
  MultiplyBlending,
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
  distance,
  float,
  floor,
  Fn,
  fwidth,
  ivec2,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  positionGeometry,
  sin,
  smoothstep,
  texture,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { InterpolationSamplingType } from "three/webgpu";
import {
  BUILTUP_CLASS,
  EDGE_SCALE,
  RAILWAY_CLASS,
  ROAD_CLASS,
} from "@/lib/city/landcover";
import { trunkRadiusAt } from "@/lib/city/tree-inventory";
import { byteOf, gdNoise, texelAt, texelSize } from "./ground-detail";
import { outOfDesignSite } from "./design-site";
import { instanceFloat, Instances } from "./instancing";
import {
  type Slots,
  setGraph,
  setSlots,
  slotsOf,
  slotTexture,
  slotUniform,
} from "./material-slots";
import {
  type F,
  rasterUv,
  type Tex,
  type V2,
  type V3,
  type V4,
} from "./shader-chunks";

/**
 * Where a tree meets the ground. A trunk alone stabbed into a flat ground
 * read cheap: the ground ran on to the bark with nothing between. Every
 * trunk gets a foot under it, one `Instances` set per chunk on the trunks'
 * own instance buffers (their matrices and their drop to the ground), so
 * it costs no bytes of its own — a site-shared quad and, per tile, a
 * material with the tile's rasters in its slots:
 *
 * - **in paving** (the class raster's built-up, road, railway or
 *   unclassified land, off the baked lawn): a round tree pit, earth with a
 *   fine grain, edged by a narrow stone ring between two joints;
 * - **anywhere else** (a meadow, a park, a forest floor, a path): the
 *   root zone, a soft, slightly irregular patch of darker, warmer ground
 *   — bare earth and litter where the crown keeps the grass thin.
 *
 * Both darken toward the trunk (a contact shadow the sun's map, a metre a
 * texel from afar, cannot draw). The foot is a glaze (MultiplyBlending,
 * like a mural): the ground's own lit colour, its shadows, sky view and
 * fog are under it already, it only multiplies them — 1 at its rim, so
 * the quad never shows — and it fades out by distance before it could
 * shimmer. Transparent, so the paper styles leave it out
 * (paper-scene.ts); it casts and receives nothing.
 *
 * On slope it lies level at the trunk's foot, lifted a few centimetres: a
 * hillside cuts its upslope rim, which is already faint. The decision
 * which foot a tree gets is read once per vertex at the trunk's foot (the
 * same texel for all four corners), so it never splits a foot.
 */

/** The root zone's reach beyond the trunk's foot radius (m) — the quad's
 *  half-size is the trunk's foot radius plus this. */
export const FOOT_REACH = 1.7;
/** The tree pit's radius (m): the trunk's foot radius plus this, within
 *  PIT_MIN..PIT_MAX. */
const PIT_CLEAR = 0.75;
const PIT_MIN = 0.95;
const PIT_MAX = 1.5;
/** The edging ring's width (m) and its joints' (m). */
const EDGING = 0.1;
const JOINT = 0.018;
/** The feet fade out between these camera distances (m). */
const FADE_FROM = 70;
const FADE_TO = 150;
/** The glaze over the earth of a pit and over the root zone (linear
 *  multipliers of the ground's colour). */
const PIT_EARTH = vec3(0.6, 0.52, 0.42);
const ROOT_ZONE = vec3(0.66, 0.62, 0.53);
/** How dark the contact shadow gets at the bark. */
const CONTACT = 0.55;
const JOINT_DARK = 0.72;

/** The unit trunk's foot radius as drawn (flared), times the instance's
 *  horizontal scale gives the drawn foot. */
const TRUNK_FOOT = trunkRadiusAt(0);

/** The trunks' drop to the ground (vegetation-layer.ts `TRUNK_DROP`). */
const DROP = "iDrop";

/**
 * The foot's quad, shared by every set of a tile: x, z in −1..1, the
 * shader scales it to the tree.
 */
export function buildFootGeo(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
      3
    )
  );
  // wound counter-clockwise seen from above (+y)
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/**
 * The feet of a chunk's trunks: a set on the trunks' matrices and drops
 * (shared buffers: nothing uploaded twice), drawn as many as the trunks,
 * culled by their sphere grown by the foot's reach.
 */
export function treeFeet(
  geo: BufferGeometry,
  material: Material,
  trunks: Instances
): Instances {
  const feet = new Instances(
    geo,
    material,
    trunks.capacity,
    trunks.instanceMatrix
  );
  // the trunks' own column views, not new ones over their buffer: three's
  // info.memory charges a buffer per view, and the memory governor reads
  // that count (instancing.ts) — so the feet cost it nothing
  for (let c = 0; c < 4; c++) {
    const column = trunks.geometry.getAttribute(`iMat${c}`);
    if (column) {
      feet.geometry.setAttribute(`iMat${c}`, column);
    }
  }
  const drop = trunks.geometry.getAttribute(DROP);
  if (drop) {
    feet.geometry.setAttribute(DROP, drop);
  }
  feet.drawCount = trunks.drawCount;
  const sphere = trunks.geometry.boundingSphere?.clone();
  if (sphere) {
    sphere.radius += FOOT_REACH + 1;
    feet.geometry.boundingSphere = sphere;
  }
  feet.castShadow = false;
  feet.receiveShadow = false;
  feet.name = "tree-feet";
  return feet;
}

/** What the feet's graph reads of a tile (the terrain's slots). */
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

interface FootGraph {
  color: V4;
  position: V3;
}

const footGraphs = new Map<string, FootGraph>();

/** A class id read as a float at a texel (clamped to the raster). */
const classTexel = (t: Tex, uv: V2): F => {
  const size = texelSize(t, uv);
  return byteOf(texelAt(t, ivec2(floor(uv.mul(vec2(size)))), size).r);
};

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

/** 1 for |x| ≥ 0.5 (a class id differs), else 0. */
const step01 = (x: F): F => smoothstep(0.49, 0.51, x);

function footGraph(r: FootRasters): FootGraph {
  const key = `${r.size.join("x")}|${r.edgesTexture ? "edges" : ""}`;
  const known = footGraphs.get(key);
  if (known) {
    return known;
  }
  // reason: a Vector2 slot is a vec2 uniform; slotUniform types it loosely.
  const origin = slotUniform("origin", r.origin) as unknown as UniformNode<
    "vec2",
    Vector2
  >;
  const classTex = slotTexture("class", r.classTexture);
  const edgesTex = r.edgesTexture && slotTexture("edges", r.edgesTexture);
  const col = (i: number) => attribute(`iMat${i}`, "vec4");
  // the trunk's foot in the content's frame (its matrix, lowered by its
  // drop), the drawn foot radius, the quad's half-size
  const footLocal = col(3).xyz.sub(col(1).xyz.mul(instanceFloat(DROP)));
  const sx = length(col(0).xyz);
  const rt = float(TRUNK_FOOT).mul(sx);
  const reach = rt.add(FOOT_REACH);
  const footWorld = modelWorldMatrix.mul(vec4(footLocal, 1)).xyz;
  const dataXy = vec2(footWorld.x, footWorld.z.negate());
  const uv = rasterUv(dataXy, origin, r.size);
  const cls = classTexel(classTex, uv);
  // off the baked lawn (the green courtyards and front gardens the class
  // raster counts as built-up land): the edge raster's lawn distance
  const lawn = edgesTex
    ? smoothstep(
        -0.1,
        0.1,
        texture(edgesTex, uv)
          .level(float(0))
          .g.mul(255)
          .sub(128)
          .div(EDGE_SCALE)
      )
    : float(0);
  const pit = varying(pavedClass(cls).mul(float(1).sub(lawn)), "vFootPit");
  // lifted off the ground, more with distance (the depth's precision)
  const lift = float(0.035).add(
    distance(cameraPosition, footWorld).mul(0.0015)
  );
  const q = positionGeometry.xz;
  // a trunk standing in a loaded design's site is folded away
  // (instancePosition); its foot folds with it
  const position = Fn(() =>
    outOfDesignSite(
      footLocal.add(vec3(q.x.mul(reach), lift, q.y.mul(reach))),
      footLocal
    )
  )();
  const offset = varying(q.mul(reach), "vFootOffset");
  // FLAT: it seeds the wobble and the grain (AGENTS.md, hash seeds)
  const trunkR = varying(rt, "vFootTrunk").setInterpolation(
    InterpolationSamplingType.FLAT
  );
  const color = Fn(() => {
    const d = length(offset).toVar();
    const w = max(fwidth(d), 0.002).toVar();
    // the contact shadow at the bark, falling off over ~0.6 m
    const contact = float(1)
      .sub(smoothstep(trunkR.mul(0.9), trunkR.add(0.8), d))
      .toVar();
    const shade = float(1).sub(contact.mul(contact).mul(CONTACT));
    // the root zone: an irregular soft patch (its rim wobbles by angle)
    const angle = atan(offset.y, offset.x);
    const wobble = sin(angle.mul(3).add(trunkR.mul(40)))
      .mul(0.12)
      .add(sin(angle.mul(5).sub(trunkR.mul(70))).mul(0.08));
    const rootR = trunkR.add(FOOT_REACH * 0.8).mul(wobble.add(1));
    const root = float(1).sub(smoothstep(trunkR.mul(0.9), rootR, d));
    const soft = mix(vec3(1), ROOT_ZONE, root).mul(shade);
    // the pit: earth with a grain, a stone ring between two joints
    const pitR = clamp(trunkR.add(PIT_CLEAR), PIT_MIN, PIT_MAX);
    const inside = float(1).sub(smoothstep(pitR.sub(w), pitR.add(w), d));
    const grainFade = float(1).sub(smoothstep(0.01, 0.04, w));
    const grain = gdNoise(offset.div(0.05).add(trunkR.mul(97)))
      .sub(0.5)
      .mul(0.16)
      .mul(grainFade)
      .add(1);
    const earth = PIT_EARTH.mul(grain).mul(shade);
    const joint = (at: F): F =>
      float(1).sub(
        smoothstep(
          JOINT * 0.5,
          JOINT * 0.5 + 0.01,
          abs(d.sub(at)).sub(w.mul(0.5))
        )
      );
    const joints = max(joint(pitR), joint(pitR.add(EDGING)))
      .mul(float(1).sub(smoothstep(0.02, 0.06, w)))
      .mul(1 - JOINT_DARK);
    const paved = mix(vec3(1), earth, inside).mul(float(1).sub(joints));
    const k = mix(soft, paved, pit);
    // out by distance, before the grain or a joint could shimmer
    const fade = float(1).sub(
      smoothstep(FADE_FROM, FADE_TO, distance(cameraPosition, footWorld))
    );
    return vec4(min(mix(vec3(1), k, fade), vec3(1)), 1);
  })();
  const graph = { color, position };
  footGraphs.set(key, graph);
  return graph;
}

/**
 * A tile's foot material: the shared graph of its raster size, the tile's
 * rasters in its slots. Freed with the tile (it is the tile's own).
 */
export function createFootMaterial(r: FootRasters): MeshBasicNodeMaterial {
  const graph = footGraph(r);
  const m = new MeshBasicNodeMaterial();
  m.name = "tree-foot";
  m.positionNode = graph.position;
  m.colorNode = graph.color;
  m.blending = MultiplyBlending;
  m.premultipliedAlpha = true;
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  const slots: Slots = {
    origin: r.origin,
    class: r.classTexture,
    edges: r.edgesTexture,
  };
  setSlots(m, slots);
  setGraph(m, `tree-foot|${r.size.join("x")}|${r.edgesTexture ? "edges" : ""}`);
  return m;
}

/**
 * The foot material of a fine terrain level, made from the rasters its
 * ground material reads (its slots): none where the tile has no class
 * raster — its trunks then stand on the bare ground.
 */
export function footMaterialFor(terrain: {
  bounds: readonly [number, number, number, number];
  mesh: { material: Material | Material[] };
}): MeshBasicNodeMaterial | undefined {
  const own = terrain.mesh.material;
  const slots = slotsOf(Array.isArray(own) ? (own[0] ?? null) : own);
  const classTexture = slots.class as Texture | undefined;
  const origin = slots.origin as Vector2 | undefined;
  if (!(classTexture && origin)) {
    return undefined;
  }
  const [minX, minY, maxX, maxY] = terrain.bounds;
  return createFootMaterial({
    classTexture,
    edgesTexture: slots.edges as Texture | undefined,
    origin,
    size: [maxX - minX, maxY - minY],
  });
}
