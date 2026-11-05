import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  InterpolationSamplingType,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  MultiplyBlending,
} from "three/webgpu";
import type {
  Material,
  Node,
  NodeBuilder,
  Texture,
  UniformNode,
  Vector3,
  Vector2,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
  int,
  fract,
  fwidth,
  If,
  ivec2,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  normalLocal,
  output,
  positionGeometry,
  property,
  sin,
  smoothstep,
  step,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  dot,
} from "three/tsl";
import {
  BUILTUP_CLASS,
  COPSE_CLASS,
  FOREST_CLASS,
  MEADOW_CLASS,
  RAILWAY_CLASS,
  ROAD_CLASS,
  srgbToLinear,
} from "@/lib/city/landcover";
import { SINK } from "@/lib/city/ground-join";
import { TRUNK_UNIT_H, trunkRadiusAt } from "@/lib/city/tree-inventory";
import { outOfDesignSite } from "./design-site";
import { edgeAt, paletteOf } from "./ground-detail";
import { instanceFloat, Instances } from "./instancing";
import {
  setGraph,
  setSlots,
  slotsOf,
  ownSlotTexture,
  ownSlotValue,
} from "./material-slots";
import type { Slots } from "./material-slots";
import {
  byteOf,
  gdHash,
  gdNoise,
  rasterUv,
  texelAt,
  texelSize,
} from "./shader-chunks";
import type { F, Tex, V2, V3, V4 } from "./shader-chunks";
import { applyGroundLight, groundLightKey } from "./sky-light";
import type { GroundLight } from "./sky-light";

/**
 * Where a tree meets the ground. A trunk alone stabbed into a flat ground
 * read cheap: the ground ran on to the bark with nothing between, and a
 * flat disc under it read as a sticker. Every trunk of the fine level now
 * has, on the trunks' own instance buffers (their matrices, drops and bark
 * colours — the very column views, so three's memory count, which the
 * governor reads, charges nothing twice), a quad, a hoop and a tuft per tile
 * (shared by its chunks, about 15 KB, most of it the tuft) and a material per tile:
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
 * - **under the crown** (off forest and copse, which have their own floor):
 *   the ground in the crown's shade — a little darker and cooler, mossy
 *   on a lawn (`shadeGraph`, a multiplied glaze, the one thing here that
 *   lets the ground through, since a shade is one) — and, in autumn,
 *   fallen leaves (`litterGraph`, covering flecks in the leaves' colours,
 *   lit as the ground), thick under the crown and gathered at the kerb.
 *   How much leaf lies is the scene's season (`footLitter`).
 * - **in the city**: the trunk's roots (the trunk material's lobes,
 *   `trunkRoots`) show in its pit — a root breaking the mulch, setts
 *   heaved and joints opened over it, cracks running on into the paving —
 *   a pit far from any road (a pedestrian zone) wears a cast-iron grate,
 *   and one close by the kerb a guard hoop between it and the road.
 * - **on a lawn or a meadow**: a tuft of grass blades round the foot
 *   (`tuftGraph`, opaque, lit as the ground), the grass the mower leaves,
 *   standing over the cut between bark and ground.
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
/** A crown's reach over the ground (m): this share of its trunk's drawn
 *  length (a crowned tree's trunk reaches into its crown), within
 *  CROWN_MIN..CROWN_MAX. */
const CROWN_SPREAD = 0.8;
const CROWN_MIN = 1.5;
const CROWN_MAX = 7;
/** The shade under a crown: the factor its middle multiplies the ground
 *  by (linear; a cool, sky-lit shade), and a lawn's moss in it. */
const SHADE = vec3(0.86, 0.88, 0.93);
const SHADE_MOSS = vec3(0.93, 0.99, 0.86);
/** Where people sit under a big park tree and the path they wear to it:
 *  which share of the trees on a lawn have one, the crown it takes (m),
 *  the quad's half-size (m), and the worn earth (sRGB). */
const WORN_SHARE = 0.55;
const WORN_CROWN = 2.5;
const WORN_QUAD = 4.8;
const WORN_SRGB = [176, 156, 122] as const;
/** The city's details: a grate's iron and a surfaced root (sRGB), a pit
 *  at least this far (m) off the road has a grate, and a guard hoop
 *  stands this far (m) before the kerb by a pit within GUARD_NEAR (m) of
 *  it, for so many of them. */
const IRON_SRGB = [72, 74, 76] as const;
const ROOT_SRGB = [112, 88, 64] as const;
const GRATE_FROM = 5;
const GUARD_BEFORE = 0.45;
const GUARD_NEAR: [number, number] = [0.9, 3];
const GUARD_SHARE = 0.7;
/** The hoop's tube (m), and how far out (× the trunk's foot radius) the
 *  roots' bulge reaches (`trunkRoots`' ROOT_BULGE, with a margin). */
const GUARD_T = 0.06;
const GUARD_CLEAR = 1.55;
/** The unmown grass round a park tree (the mower keeps off the trunk):
 *  how far out it reaches past the trunk (m), the factor its long, darker,
 *  yellower blades multiply the lawn by, and its seed heads'. */
const UNMOWN_REACH = 0.85;
const UNMOWN = vec3(0.8, 0.9, 0.66);
const SEED_HEADS = vec3(1.14, 1.1, 0.9);
/** Sun flecks in the crown's shadow. Each is the sun's own image through
 *  a gap in the leaves (a pinhole camera): a round spot as wide as the
 *  gap's height over the ground times the sun's 0.53° (about 9 cm under
 *  a crown 10 m up), drawn out along the sun by 1 / its elevation,
 *  soft-rimmed, and all of one size under one crown. The wind does not
 *  carry them along: a branch sways a cluster of them to and fro, slowly,
 *  and a fluttering leaf blinks one on and off — they flicker in place.
 *  How much a fleck lifts the shaded ground (×, a shadow is about half the
 *  sun), the cells they sit in (m, two grids turned against each other),
 *  how far a branch sways them (m) and how often (rad/s), a leaf's
 *  flutter (rad/s), and how far off (m) they still show. */
const DAPPLE = 1.1;
const DAPPLE_CELLS: [number, number] = [0.5, 0.63];
const DAPPLE_SWAY = 0.05;
const DAPPLE_SWAY_RATE = 0.9;
const DAPPLE_FLUTTER: [number, number] = [4, 11];
const DAPPLE_TO = 45;
/** The sun's angular diameter (rad): a pinhole image's width per metre
 *  of the gap's height. */
const SUN_DIAMETER = 0.0093;
/** Fallen leaves (sRGB): yellow, orange, russet, old brown. */
const LEAF_YELLOW = [214, 176, 78] as const;
const LEAF_ORANGE = [204, 128, 62] as const;
const LEAF_RUSSET = [160, 92, 58] as const;
const LEAF_BROWN = [138, 108, 78] as const;
/** A leaf's cell (m) and how far the leaves blow beyond the crown (a
 *  share of its reach). */
const LEAF_CELL = 0.11;
const LEAF_BEYOND = 1.25;
/** The feet fade out between these camera distances (m). */
const FADE_FROM = 70;
const FADE_TO = 150;
/** A chunk shows its feet while one of its trees is this near (m): past
 *  it all of them have faded (vegetation-layer.ts, the crowns' LOD). */
export const FOOT_SHOWN_M = FADE_TO + 10;
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
/** The feet's attribute: the ground's rise along x and z at the foot. */
const SLOPE = "iSlope";

/** The cull sphere's growth over the trunks' (m): the farthest leaf. */
export const FOOT_REACH = CROWN_MAX * LEAF_BEYOND + 0.5;
/** How far a shade glaze reaches from its trunk (m): thrown up to three
 *  crowns along the sun, and its ellipse drawn out by up to three past
 *  that (shadeGraph); behind the trunk it reaches SHADE_BACK crowns, at
 *  least SHADE_BACK_MIN (m: a pit's cracks). */
const SHADE_REACH = CROWN_MAX * (3 + 1.1 * 3) + 0.5;
const SHADE_BACK = 1.3;
const SHADE_BACK_MIN = 3.1;

/** How much fallen leaf lies (0..1): the scene's season, one value for
 *  every tile (create-app.ts, lib/city/tree-season.ts `leafLitterAt`). */
export const footLitter = uniform(0);
/** How leafy the crowns are today (0 bare, 1 in full leaf; the generic
 *  phenology's): the shade a broadleaf crown lays on the ground and on
 *  its trunk (vegetation-layer.ts `crownShade`). */
export const crownLeaf = uniform(1);
/** How much of its shade a bare crown still casts (its branches), on the
 *  ground and on its trunk (vegetation-layer.ts `crownShade`). */
export const BARE_SHADE = 0.3;

/** The wind's clock (s) the sun flecks drift by: the crowns' own
 *  (vegetation-layer.ts `setCrownTime` keeps it). */
export const footClock = uniform(0);

/** The tile-shared geometries: the pit's quad, a guard hoop. */
export interface FootGeos {
  quad: BufferGeometry;
  hoop: BufferGeometry;
  tuft: BufferGeometry;
}

/** The quad (x, z in −1..1) in QUAD_CELLS × QUAD_CELLS cells, facing up;
 *  the shader sizes it to the pit. */
const QUAD_CELLS = 8;
export function buildFootGeos(): FootGeos {
  // a grid, not one quad: each vertex is drawn toward the eye by its own
  // distance from the trunk (`draped`), little at the trunk, more out
  const n = QUAD_CELLS;
  const position = new Float32Array((n + 1) * (n + 1) * 3);
  const normal = new Float32Array(position.length);
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const k = (j * (n + 1) + i) * 3;
      position[k] = -1 + (2 * i) / n;
      position[k + 2] = -1 + (2 * j) / n;
      normal[k + 1] = 1;
    }
  }
  const quad = new BufferGeometry();
  quad.setAttribute("position", new BufferAttribute(position, 3));
  quad.setAttribute("normal", new BufferAttribute(normal, 3));
  const index: number[] = [];
  const at = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      // wound counter-clockwise seen from above (+y)
      const [p, q, r, t] = [
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      ];
      index.push(p, r, q, p, t, r);
    }
  }
  quad.setIndex(index);
  return { quad, hoop: buildHoop(), tuft: buildTuft() };
}

/** A guard hoop round a street tree's pit: an inverted U of 6 cm tube,
 *  0.75 m high and 0.6 m wide, along x (the kerb), its foot at 0 and its
 *  posts on under it by SINK.box (it stands on the trunk's one slope, not
 *  on the ground it meets; placed in the vertex stage, so it has no join
 *  points to report). */
function buildHoop(): BufferGeometry {
  const t = GUARD_T;
  const post = (x: number) =>
    new BoxGeometry(t, 0.75 + SINK.box, t).translate(
      x,
      (0.75 - SINK.box) / 2,
      0
    );
  const top = new BoxGeometry(0.6 + t, t, t).translate(0, 0.75, 0);
  const hoop = mergeGeometries([post(-0.3), post(0.3), top]);
  hoop.deleteAttribute("uv");
  return hoop;
}

/** The grass round a trunk's foot: TUFT_BLADES blades, each a thin
 *  triangle leaning out, in a band TUFT_BAND (m from the axis) round a
 *  nominal foot of radius TUFT_FOOT (the shader moves the band out to
 *  the trunk's own), TUFT_H high (the shader scales it per tree). */
const TUFT_BLADES = 88;
const TUFT_FOOT = 0.25;
const TUFT_BAND: [number, number] = [0.28, 0.8];
const TUFT_H: [number, number] = [0.08, 0.24];
const TUFT_W = 0.018;

function buildTuft(): BufferGeometry {
  // each blade twice, wound both ways, its normal up on both faces (a
  // back face's flipped normal faced the ground and drew it black)
  const position = new Float32Array(TUFT_BLADES * 18);
  const normal = new Float32Array(position.length);
  let seed = 0;
  const rnd = () => {
    seed += 1;
    const x = Math.sin(seed * 12.9898 + 4.1) * 43_758.545;
    return x - Math.floor(x);
  };
  for (let b = 0; b < TUFT_BLADES; b += 1) {
    const angle = ((b + rnd() * 0.8) / TUFT_BLADES) * Math.PI * 2;
    // more blades close in, where the mower never reaches
    const t = rnd() ** 1.6;
    const d = TUFT_BAND[0] + t * (TUFT_BAND[1] - TUFT_BAND[0]);
    const h = TUFT_H[0] + rnd() * (TUFT_H[1] - TUFT_H[0]) * (1 - t * 0.5);
    const [ox, oz] = [Math.cos(angle), Math.sin(angle)];
    // the blade's face turned a little off the radial
    const turn = angle + Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const [wx, wz] = [Math.cos(turn) * TUFT_W, Math.sin(turn) * TUFT_W];
    const lean = 0.25 + rnd() * 0.35;
    const k = b * 18;
    const left = [ox * d - wx, 0, oz * d - wz];
    const right = [ox * d + wx, 0, oz * d + wz];
    const tip = [ox * (d + lean * h), h, oz * (d + lean * h)];
    position.set([...left, ...right, ...tip, ...right, ...left, ...tip], k);
    for (let v = 0; v < 6; v += 1) {
      normal[k + v * 3 + 1] = 1;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  return g;
}

/** A tile's foot materials (`footMaterialFor`). */
export interface FootMaterials {
  ring: Material;
  earth: Material;
  litter: Material;
  shade: Material;
  /** a needle tree's shade (no bare season), made for a tile that has any */
  needleShade: () => Material;
  /** none without the edge raster (no road to stand a hoop by) */
  guard?: Material;
  tuft: Material;
  /** what the trunk's foot turns to: the ground's colour there (a graph
   *  read per vertex at the foot), the key of its build and the tile's
   *  slots for it (vegetation-layer.ts `tileTrunkMaterial`) */
  trunkEarth: { colour: V3; key: string; slots: Slots };
}

/** The sets of a chunk's feet. */
const PARTS = ["ring", "earth", "litter", "shade", "guard", "tuft"] as const;
type Part = (typeof PARTS)[number];

/** Draw order among the blended sets: every ring, then every pit's earth
 *  (so pits that overlap merge), the leaves on them, the shade over all;
 *  the guard hoops are opaque. */
const ORDER: Record<Part, number> = {
  ring: 1,
  earth: 2,
  litter: 3,
  shade: 4,
  guard: 0,
  tuft: 0,
};

/**
 * The feet of a chunk's trunks: a set per part on the trunks' buffers (the
 * very attribute objects: nothing uploaded or counted twice), drawn as
 * many as the trunks, culled by their sphere grown by the leaves' reach.
 */
export function treeFeet(
  geos: FootGeos,
  materials: FootMaterials,
  trunks: Instances,
  slopes: BufferAttribute,
  needle = false
): Instances[] {
  const sets: Instances[] = [];
  for (const part of PARTS) {
    // no autumn leaves under a needle tree, and its shade has no bare season
    const material =
      part === "shade" && needle ? materials.needleShade() : materials[part];
    if ((part === "litter" && needle) || !material) {
      continue;
    }
    let geo = geos.quad;
    if (part === "guard") {
      geo = geos.hoop;
    } else if (part === "tuft") {
      geo = geos.tuft;
    }
    const feet = new Instances(
      geo,
      material,
      trunks.capacity,
      trunks.instanceMatrix
    );
    // the ground's slope at the foot: the feet's own (two bytes a tree),
    // one attribute for all the chunk's sets
    feet.geometry.setAttribute(SLOPE, slopes);
    for (const name of ["iMat0", "iMat1", "iMat2", "iMat3", DROP]) {
      const shared = trunks.geometry.getAttribute(name);
      if (shared) {
        feet.geometry.setAttribute(name, shared);
      }
    }
    feet.drawCount = trunks.drawCount;
    const sphere = trunks.geometry.boundingSphere?.clone();
    if (sphere) {
      // the shade is thrown off along the sun, out to SHADE_REACH
      sphere.radius += (part === "shade" ? SHADE_REACH : FOOT_REACH) + 1;
      feet.geometry.boundingSphere = sphere;
    }
    feet.castShadow = false;
    feet.receiveShadow = true;
    feet.renderOrder = ORDER[part];
    feet.name = `tree-${part}`;
    // the leaves' set is drawn only in their season (`seasonalFoot`)
    feet.userData.seasonal = part === "litter";
    sets.push(feet);
  }
  return sets;
}

/** Whether a foot set has anything to draw today: the fallen leaves only
 *  while some lie (`footLitter`); every other part always. */
export function seasonalFoot(set: Instances): boolean {
  return set.userData.seasonal !== true || footLitter.value > 0;
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
  /** the crown's reach over the ground (m) */
  crown: F;
  /** 1 on a lawn or meadow (the baked lawn, the meadow class) */
  green: F;
  /** 1 in forest or copse, whose floor is its own */
  wood: F;
  /** the trunk's roots (vegetation-layer.ts `trunkRoots`, the same hash):
   *  how many, and their phase round the stem */
  lobes: F;
  phase: F;
  /** the trunk's own x and z axes over the ground (unit, content frame) */
  axisX: V2;
  axisZ: V2;
  /** the edge raster's road distance at the foot (m, + on the road; −99
   *  without the raster) */
  road: F;
  /** the ground's rise (m per m) along x and z at the foot */
  slope: V2;
  /** the class id at the foot */
  cls: F;
}

interface FootSlots {
  origin: UniformNode<"vec2", Vector2>;
  classTex: Tex;
  edgesTex?: Tex;
}

/** The tile's rasters, read from the drawn object's own material: under
 *  a style's override (paper-scene.ts carries the tuft's and the hoop's
 *  positions over) the drawing material has no slots. */
function footSlots(r: FootRasters): FootSlots {
  return {
    // reason: a Vector2 slot is a vec2 uniform; the slot types it loosely.
    origin: ownSlotValue("origin", r.origin) as unknown as UniformNode<
      "vec2",
      Vector2
    >,
    classTex: ownSlotTexture("class", r.classTexture),
    edgesTex: r.edgesTexture && ownSlotTexture("edges", r.edgesTexture),
  };
}

/** Column `i` of the tree's instance matrix. */
const col = (i: number) => attribute(`iMat${i}`, "vec4");

function footFrame(s: FootSlots, size: [number, number]): FootFrame {
  // the trunk's foot in the content's frame (its matrix, lowered by its
  // drop) and its drawn foot radius
  const foot = col(3).xyz.sub(col(1).xyz.mul(instanceFloat(DROP)));
  const rt = float(TRUNK_FOOT).mul(length(col(0).xyz));
  const world = modelWorldMatrix.mul(vec4(foot, 1)).xyz;
  const uv = rasterUv(vec2(world.x, world.z.negate()), s.origin, size);
  // off the baked lawn (the green courtyards and front gardens the class
  // raster counts as built-up land): the edge raster's lawn distance
  // the edge raster's two distances, one read (x the road's, + on the
  // road; y the lawn's)
  const edge = s.edgesTex ? edgeAt(s.edgesTex, uv).toVar() : undefined;
  const lawn = edge ? smoothstep(-0.1, 0.1, edge.y) : float(0);
  const cls = classTexel(s.classTex, uv);
  const pit = pavedClass(cls).mul(float(1).sub(lawn));
  const fade = float(1).sub(
    smoothstep(FADE_FROM, FADE_TO, distance(cameraPosition, world))
  );
  const isClass = (id: number): F => float(1).sub(step01(abs(cls.sub(id))));
  const green = max(lawn, isClass(MEADOW_CLASS));
  const wood = max(isClass(FOREST_CLASS), isClass(COPSE_CLASS));
  // the trunk's drawn length (its foot lowered by its drop)
  const length1 = float(TRUNK_UNIT_H)
    .add(instanceFloat(DROP))
    .mul(length(col(1).xyz));
  const crown = clamp(length1.mul(CROWN_SPREAD), CROWN_MIN, CROWN_MAX);
  const roots = rootSeed(col(3).xz);
  const road = edge ? edge.x : float(-99);
  return {
    foot,
    rt,
    world,
    pit,
    fade,
    crown,
    green,
    wood,
    lobes: roots.lobes,
    phase: roots.phase,
    axisX: normalize(col(0).xz),
    axisZ: normalize(col(2).xz),
    road,
    slope: attribute(SLOPE, "vec2"),
    cls,
  };
}

/**
 * A trunk's roots from where it stands (`origin`, its matrix's
 * translation): how many (three or four) and their phase round the stem.
 * The one rule for the trunk's lobes (vegetation-layer.ts `trunkRoots`)
 * and the pit's roots, cracks and tufts that follow them.
 */
export function rootSeed(origin: V2): { lobes: F; phase: F } {
  // a hash that keeps its spread kilometres from the frame's centre (a
  // sine of a large argument loses it in 32-bit floats)
  const seed = gdHash(origin.mul(1.37));
  return { lobes: floor(seed.mul(2)).add(3), phase: seed.mul(40) };
}

/** A trunk standing in a loaded design's site is folded away
 *  (instancePosition); its foot folds with it. */
const folded = (placed: V3, foot: V3): V3 =>
  Fn(() => outOfDesignSite(placed, foot))();

/**
 * A foot's quad lies on the ground's slope at the trunk (`slope`, the
 * feet's attribute); flat, it sank into rising ground and the slope's
 * crease cut the leaves and the shade off in a straight line. Where the
 * ground bends away from that plane each vertex is drawn toward the eye
 * along its own ray, by DRAPE_SLOPE of its distance `q` from the trunk
 * (at most DRAPE_MAX): it keeps its place on the screen and stays over
 * the ground, and at the trunk it is not moved, so it never paints over
 * the bark.
 */
const DRAPE_SLOPE = 0.08;
const DRAPE_MAX = 1;
const draped = (placed: V3, q: V2, slope: V2): V3 => {
  const onSlope = placed.add(vec3(0, dot(slope, q), 0));
  const eye = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const toEye = eye.sub(onSlope);
  const by = min(length(q).mul(DRAPE_SLOPE), DRAPE_MAX).min(
    length(toEye).mul(0.5)
  );
  return onSlope.add(normalize(toEye).mul(by));
};

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

/** A root's place about an offset from the trunk (content frame): the
 *  lobe it lies on (1 on a root's crest) and its distance (m) across from
 *  the nearest crest's line. */
function rootAt(
  offset: V2,
  lobes: F,
  phase: F,
  axisX: V2,
  axisZ: V2
): { lobe: F; across: F } {
  const angle = atan(dot(offset, axisZ), dot(offset, axisX));
  const turn = angle.mul(lobes).add(phase);
  const lobe = cos(turn).mul(0.5).add(0.5);
  const off = fract(turn.div(6.2832).add(0.5)).sub(0.5).mul(6.2832).div(lobes);
  return { lobe, across: abs(off).mul(length(offset)) };
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
  // a big tree on a lawn, one in so many: the earth people wear bare
  // (the earth set only; never with a pit)
  const pick = gdHash(vec2(f.world.x, f.world.z).mul(0.53));
  const wornHere =
    part === "earth"
      ? step(0.5, f.green)
          .mul(step(pick, WORN_SHARE))
          .mul(step(WORN_CROWN, f.crown))
          .mul(float(1).sub(step(0.5, f.pit)))
      : float(0);
  // none off paving (or worn lawn), and collapsed once faded out
  const q = positionGeometry.xz
    .mul(mix(float(PIT_QUAD), WORN_QUAD, wornHere))
    .mul(max(step(0.5, f.pit), wornHere))
    .mul(step(0.001, f.fade));
  const position = folded(
    draped(f.foot.add(vec3(q.x, lift, q.y)), q, f.slope),
    f.foot
  );
  // far from any road: a pedestrian zone's pit wears a grate (not on a
  // tile without the edge raster, whose road reads -99)
  const grate = step(GRATE_FROM, f.road.negate())
    .mul(step(-50, f.road))
    .mul(f.pit);
  // packed four to a varying: WebGPU has sixteen, the lit ground most
  // of them (AGENTS.md); FLAT: per tree, they seed the rim's wobble and
  // the litter
  const smooth = varying(
    vec4(
      q,
      rasterUv(
        vec2(f.world.x.add(q.x), f.world.z.add(q.y).negate()),
        s.origin,
        r.size
      )
    ),
    "vPitQ"
  );
  const tree = flat4(vec4(f.world.x, f.world.z, f.rt, f.fade), "vPitTree");
  const kind = flat4(vec4(wornHere, pick, f.lobes, f.phase), "vPitKind");
  const axes = flat4(vec4(f.axisX, f.axisZ), "vPitAxes");
  const offset = smooth.xy;
  const uv = smooth.zw;
  const rt = tree.z;
  const fade = tree.w;
  const seed = tree.xy.mul(0.37);
  const xy = tree.xy.add(offset);
  const worn = kind.x;
  const wornPick = kind.y;
  const lobes = kind.z;
  const phase = kind.w;
  const axisX = axes.xy;
  const axisZ = axes.zw;
  const grated = flat(grate, "vPitGrate");
  const edges = s.edgesTex;
  const graph = Fn(() => {
    const d = length(offset).toVar();
    const w = max(fwidth(d), 0.002).toVar();
    const angle = atan(offset.y, offset.x).toVar();
    const pitR = pitRadius(rt, angle, seed).toVar();
    const root = rootAt(offset, lobes, phase, axisX, axisZ);
    const crest = smoothstep(0.86, 0.97, root.lobe).toVar();
    // off the kerb: the edge raster's road distance at the fragment
    const clear = edges
      ? float(1).sub(
          smoothstep(-KERB_CLEAR - 0.06, -KERB_CLEAR, edgeAt(edges, uv).x)
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
      // a root breaking the mulch along its crest, thinning outwards
      const rootW = mix(float(0.07), 0.03, clamp(d.div(pitR), 0, 1));
      const surfaced = float(1)
        .sub(smoothstep(rootW.sub(w), rootW.add(w), root.across))
        .mul(smoothstep(rt, rt.add(0.1), d))
        .mul(float(1).sub(smoothstep(pitR.mul(0.7), pitR.mul(0.95), d)))
        .mul(step(0.5, root.lobe));
      // a grate: radial bars and rings of iron, its frame at the rim
      const spoke = abs(fract(angle.mul(36 / 6.2832)).sub(0.5)).mul(
        d.mul(6.2832 / 36)
      );
      const band = abs(fract(d.div(0.12)).sub(0.5)).mul(0.12);
      const bar = float(1)
        .sub(
          smoothstep(float(0.012).sub(w), float(0.012).add(w), min(spoke, band))
        )
        .mul(smoothstep(rt.add(0.1), rt.add(0.14), d));
      const frame = float(1).sub(smoothstep(0.04, 0.04 + 0.01, pitR.sub(d)));
      const iron = max(bar, frame).mul(grated);
      const pitColour = mix(
        mix(
          base
            .mul(grain.sub(0.5).mul(0.22).mul(fine).add(1))
            .mul(float(1).sub(contact)),
          linear([...ROOT_SRGB]).mul(grain.mul(0.2).add(0.9)),
          surfaced
        ),
        linear([...IRON_SRGB]),
        iron
      );
      // worn lawn: a patch on one side of the trunk where people sit, and
      // the path they wear to it, tapering and wandering, grass showing
      // through it in tufts
      const turn = wornPick.mul(40);
      const dir = vec2(cos(turn), sin(turn));
      const seat = length(offset.sub(dir.mul(rt.add(0.55))))
        .add(gdNoise(xy.mul(1.7)).sub(0.5).mul(0.5))
        .toVar();
      const along = offset.x.mul(dir.x).add(offset.y.mul(dir.y)).toVar();
      const side = offset.x.mul(dir.y).sub(offset.y.mul(dir.x));
      const length2 = wornPick.mul(3.5).add(2.6);
      const t = clamp(along.div(length2), 0, 1);
      const wander = gdNoise(vec2(along.mul(0.6), wornPick.mul(9)))
        .sub(0.5)
        .mul(0.6);
      const width = mix(float(0.42), 0.16, t);
      const path = float(1)
        .sub(smoothstep(width.mul(0.6), width, abs(side.sub(wander.mul(t)))))
        .mul(step(0, along))
        .mul(float(1).sub(smoothstep(length2.mul(0.8), length2, along)));
      const patch = float(1).sub(smoothstep(0.6, 1.05, seat));
      const tufts = smoothstep(0.25, 0.6, gdNoise(xy.div(0.09).add(seed)));
      const bare = max(patch, path).mul(
        mix(tufts, float(1), max(patch, path).mul(0.6))
      );
      const wornColour = linear([...WORN_SRGB]).mul(
        grain.sub(0.5).mul(0.25).mul(fine).add(1)
      );
      return vec4(
        mix(pitColour, wornColour, worn),
        mix(inside.mul(clear), bare.mul(0.92), worn).mul(fade)
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
      // a whole number of setts round the ring (by the tree's mean pit,
      // not the fragment's wobbling edge), so it closes without a seam
      const ringR = clamp(rt.add(PIT_CLEAR), PIT_MIN, PIT_MAX).add(EDGING / 2);
      const setts = max(floor(ringR.mul(TAU / SETT).add(0.5)), 3).toVar();
      const cell = angle.div(TAU).mul(setts).toVar();
      const settLen = ringR.mul(TAU).div(setts);
      const jw = w.mul(0.5).add(JOINT / 2);
      const across = float(1).sub(
        smoothstep(
          jw,
          jw.add(w),
          abs(cell.sub(floor(cell.add(0.5)))).mul(settLen)
        )
      );
      // the stone's index, the same either side of the angle's wrap
      const index = floor(cell.add(0.5));
      const stoneId = index.sub(setts.mul(floor(index.div(setts))));
      const edgeJoint = float(1).sub(smoothstep(jw, jw.add(w), abs(out)));
      const outerJoint = float(1).sub(
        smoothstep(jw, jw.add(w), abs(out.sub(EDGING)))
      );
      // over a root the setts heave: lifted to the light, their joints
      // opened and dark
      const joints = max(max(across, edgeJoint), outerJoint)
        .mul(float(1).sub(smoothstep(0.015, 0.05, w)))
        .mul(crest.mul(0.6).add(1))
        .min(1)
        .toVar();
      const stone = gdHash(vec2(stoneId, seed.x))
        .sub(0.5)
        .mul(0.12)
        .add(1)
        .mul(crest.mul(0.14).add(1));
      return vec4(
        STONE.mul(stone).mul(mix(float(1), JOINT_SHADE, joints)),
        max(inRing, outerJoint.mul(0.6)).mul(clear).mul(fade)
      );
    }
  })();
  return { color: graph.xyz, opacity: graph.w, position };
}

const TAU = Math.PI * 2;

/**
 * Value noise round a trunk, read at `angle × scale` (and `y`): `atan`
 * jumps from π to −π on the trunk's west side, and noise read at the angle
 * broke there in a straight line. Blended with its read one turn on, so
 * both ends of the turn read the same.
 */
const aroundNoise = (angle: F, scale: F, y: F): F => {
  const t = angle.add(Math.PI).div(TAU);
  return mix(
    gdNoise(vec2(angle.mul(scale), y)),
    gdNoise(vec2(angle.sub(TAU).mul(scale), y)),
    t
  );
};

/** A flat varying: per instance, so a seed never smears (AGENTS.md). */
const flat = <T extends F | V2>(v: T, name: string): T =>
  varying(v, name).setInterpolation(
    InterpolationSamplingType.FLAT
  ) as unknown as T;
/** Four per-instance floats in one flat varying (they are scarce). */
const flat4 = (v: V4, name: string): V4 =>
  varying(v, name).setInterpolation(InterpolationSamplingType.FLAT);

/** A quad of half-size `half` (m) at the foot, collapsed where `shown` is
 *  0, lifted off the ground (more with distance, the depth's precision). */
function footQuad(f: FootFrame, half: F, shown: F): { q: V2; position: V3 } {
  const lift = float(0.05).add(distance(cameraPosition, f.world).mul(0.0015));
  const q = positionGeometry.xz.mul(half).mul(shown);
  return {
    q,
    position: folded(
      draped(f.foot.add(vec3(q.x, lift, q.y)), q, f.slope),
      f.foot
    ),
  };
}

/**
 * Fallen leaves under a crown: in cells of LEAF_CELL, a leaf in some (the
 * more, the thicker the litter: under the crown, and gathered against the
 * kerb), each a small turned oval in one of four colours; past a few
 * pixels a cell's leaves blend into their mean, so they never shimmer.
 * Collapsed out of season, in a wood and far off.
 */
function litterGraph(r: FootRasters): PitGraph {
  const s = footSlots(r);
  const f = footFrame(s, r.size);
  const reach = f.crown.mul(LEAF_BEYOND);
  const shown = step(0.01, footLitter)
    .mul(float(1).sub(f.wood))
    .mul(step(0.001, f.fade));
  const { q, position } = footQuad(f, reach, shown);
  const offset = varying(q, "vLeafOffset");
  const crown = flat(f.crown, "vLeafCrown");
  const fade = varying(f.fade, "vLeafFade");
  const xy = varying(vec2(f.world.x, f.world.z).add(q), "vLeafXY");
  const edges = s.edgesTex;
  const uv = varying(
    rasterUv(
      vec2(f.world.x.add(q.x), f.world.z.add(q.y).negate()),
      s.origin,
      r.size
    ),
    "vLeafUV"
  );
  const graph = Fn(() => {
    const d = length(offset);
    // thick under the crown, thinning past it; and swept against the kerb
    const under = float(1).sub(
      smoothstep(crown.mul(0.6), crown.mul(LEAF_BEYOND), d)
    );
    const road = edges ? edgeAt(edges, uv).x.toVar() : undefined;
    const kerb = road
      ? smoothstep(-0.9, -0.15, road)
          .mul(float(1).sub(smoothstep(-0.15, 0.05, road)))
          .mul(float(1).sub(smoothstep(crown, crown.mul(LEAF_BEYOND), d)))
      : float(0);
    const density = clamp(under.add(kerb.mul(0.8)), 0, 1).mul(footLitter);
    // two grids of cells turned against each other, a leaf in some cells
    // of each: one grid alone read as rows
    const layer = (angle: number, cellM: number, salt: number) => {
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const at = vec2(
        xy.x.mul(ca).add(xy.y.mul(sa)),
        xy.y.mul(ca).sub(xy.x.mul(sa))
      )
        .div(cellM)
        .add(salt);
      const cell = floor(at).toVar();
      const h = gdHash(cell).toVar();
      const h2 = gdHash(cell.add(17.3)).toVar();
      const keep = gdHash(cell.add(41.7));
      const size = gdHash(cell.add(8.9)).mul(0.12).add(0.24);
      // a turned oval, well off the cell's centre (inside it)
      const turn = h2.mul(6.2832);
      const c = cos(turn);
      const sn = sin(turn);
      const p = at
        .sub(cell)
        .sub(0.5)
        .sub(vec2(h.sub(0.5), h2.sub(0.5)).mul(float(0.92).sub(size.mul(2))));
      const u = vec2(p.x.mul(c).add(p.y.mul(sn)), p.y.mul(c).sub(p.x.mul(sn)));
      const oval = length(u.mul(vec2(1, 1.9)));
      const w = max(fwidth(oval), 0.02);
      return {
        leaf: float(1)
          .sub(smoothstep(size.sub(w), size.add(w), oval))
          .mul(step(keep, density.mul(0.5))),
        pick: gdHash(cell.add(5.1)),
        shade: h,
      };
    };
    const a = layer(0, LEAF_CELL, 0);
    const b = layer(0.61, LEAF_CELL * 1.27, 3.7);
    const onB = step(a.leaf, b.leaf.sub(0.001));
    const leaf = max(a.leaf, b.leaf);
    const pick = mix(a.pick, b.pick, onB);
    const h = mix(a.shade, b.shade, onB);
    const colour = mix(
      mix(
        linear([...LEAF_YELLOW]),
        linear([...LEAF_ORANGE]),
        smoothstep(0.3, 0.4, pick)
      ),
      mix(
        linear([...LEAF_RUSSET]),
        linear([...LEAF_BROWN]),
        smoothstep(0.8, 0.9, pick)
      ),
      smoothstep(0.6, 0.7, pick)
    ).mul(h.mul(0.25).add(0.85));
    // far off: the cells' mean, a soft tint as thick as the leaves are
    const coarse = smoothstep(0.012, 0.03, fwidth(xy.x));
    const mean = linear([186, 132, 72]);
    return vec4(
      mix(colour, mean, coarse),
      mix(leaf, density.mul(0.45), coarse).mul(fade)
    );
  })();
  return { color: graph.xyz, opacity: graph.w, position };
}

/** A shade glaze's graph: the factor it multiplies by, and where. */
interface ShadeGraph {
  /** the factor, read after the lighting (the material's `outputNode`) */
  output: V3;
  position: V3;
  /** the sun's share reaching the fragment (the shadow map), caught by
   *  the material's `receivedShadowNode` */
  sunLit: F;
}

/**
 * The shade under a crown, as a glaze the ground is multiplied by: a little
 * darker and cooler (less of the sky reaches it), and on a lawn mossier,
 * fading out round the crown's ragged edge. Where the crown's shadow lies
 * (thrown off by the sun, so the quad reaches out to it) and the shadow
 * map says the ground is shaded, sun flecks drift with the wind and lift
 * the shade back towards the sun. The glaze's own lighting is never drawn:
 * it only catches the shadow term (`sunLit`). Collapsed in a wood (its
 * floor is shade already) and far off.
 */
function shadeGraph(
  r: FootRasters,
  sun: V3 | undefined,
  evergreen: boolean
): ShadeGraph {
  const s = footSlots(r);
  const f = footFrame(s, r.size);
  const shown = float(1).sub(f.wood).mul(step(0.001, f.fade));
  // where the crown's shadow falls: its middle, thrown off along the sun
  // by its height (a low sun throws it far; held to three crowns)
  const up = sun ? max(sun.y, 0.2) : float(1);
  const day = sun ? smoothstep(0.02, 0.12, sun.y) : float(0);
  const height = f.crown.mul(0.4).add(
    float(TRUNK_UNIT_H)
      .add(instanceFloat(DROP))
      .mul(length(attribute("iMat1", "vec4").xyz))
  );
  // (no throw at night: the quad shrinks to the crown's cover)
  const throwRaw = sun
    ? vec2(sun.x, sun.z).negate().div(up).mul(height).mul(day)
    : vec2(0, 0);
  const throwLen = length(throwRaw);
  const thrown = throwRaw.mul(
    clamp(f.crown.mul(3).div(max(throwLen, 0.001)), 0, 1)
  );
  // the quad, laid along the throw: back past the shade under the crown
  // (and the cracks round a pit), forward past the thrown shadow's
  // ellipse; anything less cut the glaze off in a straight line
  const stretchV = mix(float(1), float(1).div(up).min(3), day);
  const throwAxis = mix(
    vec2(1, 0),
    thrown.div(max(length(thrown), 0.001)),
    step(0.001, length(thrown))
  );
  const back = max(f.crown.mul(SHADE_BACK), float(SHADE_BACK_MIN));
  const ahead = length(thrown).add(f.crown.mul(1.1).mul(stretchV));
  const u = positionGeometry.x
    .mul(ahead.add(back).mul(0.5))
    .add(ahead.sub(back).mul(0.5));
  const v = positionGeometry.z.mul(back);
  const q = throwAxis
    .mul(u)
    .add(vec2(throwAxis.y.negate(), throwAxis.x).mul(v))
    .mul(shown);
  const lift = float(0.05).add(distance(cameraPosition, f.world).mul(0.0015));
  const position = folded(
    draped(f.foot.add(vec3(q.x, lift, q.y)), q, f.slope),
    f.foot
  );
  // the sun flecks' reach: by day, near the camera
  const flecks = float(1)
    .sub(
      smoothstep(DAPPLE_TO * 0.6, DAPPLE_TO, distance(cameraPosition, f.world))
    )
    .mul(day);
  // packed four to a varying: the lit ground takes most of WebGPU's
  // sixteen (AGENTS.md); all but the offset are per tree (FLAT)
  const offset = varying(q, "vShadeQ");
  const tree = flat4(
    vec4(f.world.x, f.world.z, f.crown, f.green),
    "vShadeTree"
  );
  const kind = flat4(
    vec4(f.rt, step(0.5, f.pit), f.lobes, f.phase),
    "vShadeKind"
  );
  const axes = flat4(vec4(f.axisX, f.axisZ), "vShadeAxes");
  // the shadow's ellipse: drawn out along the sun by 1 / its elevation
  const throw4 = flat4(vec4(thrown, stretchV, f.fade), "vShadeThrow");
  const crown = tree.z;
  const green = tree.w;
  const rt = kind.x;
  const paved = kind.y;
  const lobes = kind.z;
  const phase = kind.w;
  const axisX = axes.xy;
  const axisZ = axes.zw;
  const shadowAt = throw4.xy;
  const stretch = throw4.z;
  const fade = throw4.w;
  // the flecks' reach, and the gaps' height over the ground (m)
  const sky = flat(vec2(flecks, height), "vShadeDay");
  const near = sky.x;
  const gapHeight = sky.y;
  const xy = tree.xy.add(offset);
  const sunLit = property("float", "footSunLit");
  const factor = Fn(() => {
    const d = length(offset);
    const ragged = gdNoise(xy.mul(0.7)).sub(0.5).mul(crown.mul(0.35));
    const cover = float(1)
      .sub(smoothstep(crown.mul(0.45), crown.mul(1.05), d.add(ragged)))
      .toVar();
    const moss = smoothstep(0.45, 0.75, gdNoise(xy.mul(1.3).add(9.1)))
      .mul(green)
      .mul(cover);
    // a bare broadleaf crown shades little; a needle tree the year round
    const leaf = evergreen
      ? float(1)
      : mix(float(BARE_SHADE), float(1), crownLeaf);
    const k = mix(vec3(1), SHADE, cover.mul(0.75).mul(leaf))
      .mul(mix(vec3(1), SHADE_MOSS, moss.mul(0.6)))
      .toVar();
    // the unmown ring on a lawn: long blades, streaked out from the trunk,
    // their seed heads catching the light; ragged at its edge
    const angle = atan(offset.y, offset.x);
    const reach = rt
      .add(UNMOWN_REACH)
      .add(aroundNoise(angle, float(2.2), crown).sub(0.5).mul(0.5));
    const ring = float(1)
      .sub(smoothstep(reach.sub(0.18), reach, d))
      .mul(green)
      .toVar();
    const blades = aroundNoise(angle, rt.add(0.6).mul(38), d.mul(3));
    const heads = smoothstep(0.7, 0.8, gdNoise(xy.div(0.05).add(3.3))).mul(
      float(1).sub(smoothstep(0.006, 0.02, fwidth(xy.x)))
    );
    k.mulAssign(
      mix(vec3(1), UNMOWN, ring.mul(blades.mul(0.5).add(0.6))).mul(
        mix(vec3(1), SEED_HEADS, ring.mul(heads))
      )
    );
    // cracks in the paving where a root runs on under it, past the pit
    const pitOut = clamp(rt.add(PIT_CLEAR), PIT_MIN, PIT_MAX).add(EDGING);
    const root = rootAt(offset, lobes, phase, axisX, axisZ);
    const jag = gdNoise(vec2(d.mul(5), phase))
      .sub(0.5)
      .mul(0.08);
    const cw = max(fwidth(d), 0.004);
    const crack = float(1)
      .sub(smoothstep(cw.mul(0.5), cw.mul(1.5), abs(root.across.sub(jag))))
      .mul(step(0.5, root.lobe))
      .mul(smoothstep(pitOut, pitOut.add(0.08), d))
      .mul(float(1).sub(smoothstep(pitOut.add(0.6), pitOut.add(1.5), d)))
      .mul(paved)
      .mul(float(1).sub(smoothstep(0.02, 0.06, cw)));
    k.mulAssign(float(1).sub(crack.mul(0.35)));
    // sun flecks: in the crown's thrown shadow, where the ground is shaded
    const rel = offset.sub(shadowAt);
    const axis = vec2(shadowAt.x, shadowAt.y).div(max(length(shadowAt), 0.001));
    const along = rel.x.mul(axis.x).add(rel.y.mul(axis.y)).div(stretch);
    const across = rel.x.mul(axis.y).sub(rel.y.mul(axis.x));
    const inShadow = float(1).sub(
      smoothstep(crown.mul(0.5), crown.mul(1.05), length(vec2(along, across)))
    );
    // the flecks only where they can show: in the thrown shadow, shaded,
    // near and by day (the quad reaches far past the shadow at a low sun)
    const dappleW = inShadow.mul(float(1).sub(sunLit)).mul(near).toVar();
    const fleck = float(0).toVar();
    const coverMean = float(0).toVar();
    If(dappleW.greaterThan(0), () => {
      // the ground in the sun's frame, its run along the sun shrunk by the
      // stretch: there a fleck is round, on the ground drawn out along it
      const sunXY = vec2(
        xy.x.mul(axis.x).add(xy.y.mul(axis.y)).div(stretch),
        xy.x.mul(axis.y).sub(xy.y.mul(axis.x))
      ).toVar();
      // the gaps come in clusters (where the crown is thin)
      const gaps = smoothstep(0.38, 0.78, gdNoise(xy.mul(0.55).add(phase)));
      const radius = clamp(gapHeight.mul(SUN_DIAMETER * 0.5), 0.035, 0.1);
      for (let n = 0; n < DAPPLE_CELLS.length; n += 1) {
        const cellM = DAPPLE_CELLS[n];
        const turn = n * 0.83;
        const ct = Math.cos(turn);
        const st = Math.sin(turn);
        const at = vec2(
          sunXY.x.mul(ct).add(sunXY.y.mul(st)),
          sunXY.y.mul(ct).sub(sunXY.x.mul(st))
        )
          .div(cellM)
          .add(n * 5.3);
        const cell = floor(at).toVar();
        const h1 = gdHash(cell.add(1.7)).toVar();
        const h2 = gdHash(cell.add(23.1)).toVar();
        const h3 = gdHash(cell.add(47.9)).toVar();
        // a branch sways its cluster to and fro, all in one phase
        const swayPhase = gdNoise(cell.mul(0.21).add(n * 9.1)).mul(12.6);
        const sway = sin(footClock.mul(DAPPLE_SWAY_RATE).add(swayPhase)).mul(
          DAPPLE_SWAY / cellM
        );
        // a leaf flutters: the spot trembles and blinks
        const rate = mix(DAPPLE_FLUTTER[0], DAPPLE_FLUTTER[1], h3);
        const flutter = sin(footClock.mul(rate).add(h1.mul(40)));
        const room = float(0.5)
          .sub(radius.div(cellM))
          .sub(DAPPLE_SWAY / cellM);
        const centre = vec2(h1.sub(0.5), h2.sub(0.5))
          .mul(room.mul(2))
          .add(vec2(sway, sway.mul(0.4)))
          .add(vec2(flutter.mul(0.012 / cellM), 0));
        const spotR = radius.div(cellM).mul(h2.mul(0.35).add(0.8));
        const dist = length(at.sub(cell).sub(0.5).sub(centre));
        // the penumbra: a sun image's rim is soft
        const spot = float(1).sub(
          smoothstep(spotR.mul(0.55), spotR.mul(1.15), dist)
        );
        // some leaves blink a fleck right out, most only dim it
        const blink = mix(
          float(1),
          smoothstep(-0.3, 0.4, flutter),
          step(0.55, h3)
        ).mul(flutter.mul(0.15).add(0.85));
        const lit = step(h2, gaps.mul(0.75));
        fleck.assign(max(fleck, spot.mul(blink).mul(lit)));
        coverMean.addAssign(
          gaps.mul(0.75 * 0.5).mul(spotR.mul(spotR).mul(3.1))
        );
      }
    });
    // past a few pixels a fleck would shimmer: their mean
    const coarse = smoothstep(0.012, 0.03, fwidth(xy.x));
    const dapple = mix(fleck, clamp(coverMean, 0, 0.5), coarse).mul(dappleW);
    k.mulAssign(dapple.mul(DAPPLE).add(1));
    return mix(vec3(1), k, fade);
  })();
  return { output: factor, position, sunLit };
}

/**
 * A guard hoop by a street tree near the road: between its pit and the
 * kerb, GUARD_BEFORE short of it, along the kerb (the road raster's
 * distance falls off across it: its gradient is the way to the road).
 * Collapsed for a tree far from the road, off paving, without the edge
 * raster, for a share of them by a hash, and far off.
 */
function guardGraph(r: FootRasters): { position: V3 } {
  const s = footSlots(r);
  const f = footFrame(s, r.size);
  const edges = s.edgesTex;
  if (!edges) {
    // (`createFootMaterials` makes no hoop without the edge raster)
    throw new Error("guard hoops need the edge raster");
  }
  const at = (dx: number, dz: number): F =>
    edgeAt(
      edges,
      rasterUv(
        vec2(f.world.x.add(dx), f.world.z.add(dz).negate()),
        s.origin,
        r.size
      )
    ).x;
  const toRoad = normalize(
    vec2(at(1, 0).sub(at(-1, 0)), at(0, 1).sub(at(0, -1))).add(vec2(1e-4, 0))
  );
  const off = f.road.negate();
  const pick = gdHash(vec2(f.world.x, f.world.z).mul(0.71));
  const shown = step(0.5, f.pit)
    .mul(step(GUARD_NEAR[0], off))
    .mul(step(off, GUARD_NEAR[1]))
    .mul(step(pick, GUARD_SHARE))
    .mul(step(0.001, f.fade))
    // none where the trunk's foot and its roots' bulge reach past it
    .mul(step(f.rt.mul(GUARD_CLEAR).add(GUARD_T), off.sub(GUARD_BEFORE)));
  const place = toRoad.mul(off.sub(GUARD_BEFORE));
  const p = positionGeometry;
  // x along the kerb, z towards the road: a rotation (determinant +1), so
  // the hoop keeps its winding and its faces stay outward
  const along = vec2(toRoad.y, toRoad.x.negate());
  const position = Fn(() => {
    const n = normalLocal;
    normalLocal.assign(
      vec3(
        n.x.mul(along.x).add(n.z.mul(toRoad.x)),
        n.y,
        n.x.mul(along.y).add(n.z.mul(toRoad.y))
      )
    );
    const local = vec3(
      p.x.mul(along.x).add(p.z.mul(toRoad.x)).add(place.x),
      p.y,
      p.x.mul(along.y).add(p.z.mul(toRoad.y)).add(place.y)
    )
      // standing where the slope puts the ground under it
      .add(vec3(0, dot(f.slope, place), 0))
      .mul(shown);
    return outOfDesignSite(f.foot.add(local), f.foot);
  })();
  return { position };
}

/** A tile's guard hoops: painted anthracite steel, lit, opaque. */
function guardMaterial(
  r: FootRasters,
  slots: Slots,
  variant: string
): MeshStandardNodeMaterial {
  const key = `tree-guard|${variant}`;
  let graph = guards.get(key);
  if (!graph) {
    graph = guardGraph(r);
    guards.set(key, graph);
  }
  const m = new MeshStandardNodeMaterial({
    color: 0x4a_4e_50,
    roughness: 0.55,
    metalness: 0.3,
  });
  m.name = "tree-guard";
  m.positionNode = graph.position;
  setSlots(m, slots);
  setGraph(m, key);
  return m;
}

const guards = new Map<string, { position: V3 }>();

/** The tufts' grass (sRGB): the lawn's green, a blade's tip paler and
 *  yellower (`UNMOWN`), its foot in the grass's own shade. */
const TUFT_GREEN = linear([150, 172, 112]);
const TUFT_TIP = linear([196, 198, 140]);
const TUFT_SWAY = 0.035;

/**
 * Grass and herbs round a trunk on a lawn or a meadow (not in paving,
 * not in a wood): the blades the mower leaves at the foot, standing up
 * over the cut between the bark and the ground so it is not seen. Lit as
 * the ground is, swaying a little with the clock, as tall as the tree is
 * big (0.8–1.3 × by a hash), shrinking into the ground as the foot fades
 * out; collapsed where none grow.
 */
function tuftGraph(r: FootRasters): PitGraph {
  const s = footSlots(r);
  const f = footFrame(s, r.size);
  const shown = f.green
    .mul(float(1).sub(f.wood))
    .mul(float(1).sub(step(0.5, f.pit)))
    .mul(step(0.001, f.fade));
  const seed = gdHash(f.world.xz.mul(0.83).add(19.1));
  const p = positionGeometry;
  const dir = normalize(p.xz.add(vec2(1e-4, 0)));
  // out to the trunk's own foot, its roots' bulge (the trunk's lobes, in
  // the trunk's turned frame as `rootAt` reads them)
  const { lobe } = rootAt(dir, f.lobes, f.phase, f.axisX, f.axisZ);
  const out = f.rt.mul(lobe.mul(lobe).mul(0.55).add(1)).sub(TUFT_FOOT);
  const tall = p.y.mul(mix(0.8, 1.3, seed)).mul(smoothstep(0, 0.6, f.fade));
  const sway = sin(footClock.mul(1.3).add(seed.mul(40)).add(p.x.mul(9)))
    .mul(TUFT_SWAY)
    .mul(p.y.div(TUFT_H[1]));
  const q = p.xz.add(dir.mul(max(out, 0))).add(dir.mul(sway));
  const local = vec3(q.x, tall, q.y).mul(shown);
  const position = Fn(() => {
    normalLocal.assign(vec3(0, 1, 0));
    return folded(
      f.foot.add(local).add(vec3(0, dot(f.slope, q.mul(shown)), 0)),
      f.foot
    );
  })();
  const up = varying(p.y.div(TUFT_H[1]), "vTuftUp");
  // a blade's own tint: hashed per vertex, flat, so the provoking
  // vertex's holds over the blade
  const tint = flat(gdHash(p.xz.mul(31).add(seed)), "vTuftTint");
  return {
    position,
    color: mix(TUFT_GREEN, TUFT_TIP, up.mul(tint.mul(0.6).add(0.4))).mul(
      mix(0.6, 1, up)
    ),
    opacity: float(1),
  };
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

/** Shade graphs by their sun (a new app has a new sun uniform; the old
 *  one's graphs go with it) and their key. */
const shades = new WeakMap<object, Map<string, ShadeGraph>>();
const NO_SUN = {};

/**
 * A tile's shade glaze: multiplied into what is drawn under it. Lit only to
 * catch the shadow map's term for the sun flecks; what it draws is its
 * factor (`outputNode`), never its lighting.
 */
function shadeMaterial(
  r: FootRasters,
  slots: Slots,
  variant: string,
  light: GroundLight | undefined,
  evergreen: boolean,
  sceneSun?: UniformNode<"vec3", Vector3>
): MeshLambertNodeMaterial {
  const key = `tree-shade|${evergreen ? "evergreen|" : ""}${variant}|${light ? groundLightKey(light) : ""}`;
  // the tile's baked light's sun, else the scene's: a tile without the
  // sky-view and horizon rasters still has a day
  const sunNode = light?.sunDirection ?? sceneSun;
  const sun = sunNode ?? NO_SUN;
  let bySun = shades.get(sun);
  if (!bySun) {
    bySun = new Map();
    shades.set(sun, bySun);
  }
  let graph = bySun.get(key);
  if (!graph) {
    graph = shadeGraph(r, sunNode, evergreen);
    bySun.set(key, graph);
  }
  const { sunLit } = graph;
  const m = new MeshLambertNodeMaterial();
  m.name = "tree-shade";
  m.positionNode = graph.position;
  m.colorNode = Fn(() => {
    sunLit.assign(1);
    return vec3(1);
  })();
  m.receivedShadowNode = (shadow?: Node) => {
    if (shadow) {
      sunLit.mulAssign(shadow as F);
    }
    return shadow ?? float(1);
  };
  // the factor, fogged as three fogs any output (the scene's fog fades a
  // multiplied glaze to white, height-fog.ts). Three's own fog is off: it
  // fogs the lit colour before this runs, a node builds once per shader,
  // and this read would get that result, multiplying the ground by the
  // lighting over the whole quad (black where quads overlap at a low sun).
  m.fog = false;
  m.outputNode = Fn((builder: NodeBuilder) => {
    const glaze = vec4(graph.output, 1);
    // reason: three's NodeBuilder reads the scene's `fogNode` (what its
    // own setupFog uses) but its types do not declare it.
    const { fogNode } = builder as NodeBuilder & { fogNode?: V4 | null };
    if (!fogNode) {
      return glaze;
    }
    output.assign(glaze);
    return vec4(fogNode.toVar());
  })();
  m.blending = MultiplyBlending;
  m.premultipliedAlpha = true;
  m.transparent = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -3;
  setSlots(m, slots);
  setGraph(m, key);
  return m;
}

/** The pit's mulch (sRGB), also the trunk's foot off the foot rasters
 *  (vegetation-layer.ts `TRUNK_EARTH`). */
export const MULCH_SRGB: [number, number, number] = [128, 98, 70];
/** The ground's colour at a trunk's foot as its bark turns to it (sRGB):
 *  the pit's mulch in paving, the forest floor's leaf mould in a wood,
 *  the grass's roots on a lawn or meadow; elsewhere the ground's own
 *  class colour, darkened as damp soil. */
const FOOT_MULCH = linear(MULCH_SRGB);
const FOOT_MOULD = linear([104, 92, 68]);
const FOOT_GRASS = linear([112, 120, 78]);
const DAMP = 0.72;

/**
 * The colour a trunk's foot turns to, read once per vertex at the foot
 * (the class raster and the edge raster's lawn, as every foot part
 * reads them): instead of one earth for every tree, the ground it stands
 * in, so the bark runs into the lawn, the pit or the forest floor.
 */
function trunkEarthGraph(r: FootRasters): V3 {
  const s = footSlots(r);
  const f = footFrame(s, r.size);
  const own = paletteOf(int(f.cls));
  const ground = mix(own.mul(DAMP), FOOT_GRASS, f.green);
  return mix(mix(ground, FOOT_MOULD, f.wood), FOOT_MULCH, step(0.5, f.pit));
}

const trunkEarths = new Map<string, V3>();

/** A tile's grass tufts: opaque, lit as the ground. */
function tuftMaterial(
  r: FootRasters,
  slots: Slots,
  variant: string,
  light?: GroundLight
): MeshStandardNodeMaterial {
  const key = `tree-tuft|${variant}`;
  const graph = cached(key, () => tuftGraph(r));
  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  m.name = "tree-tuft";
  m.positionNode = graph.position;
  m.colorNode = graph.color;
  setSlots(m, slots);
  applyGroundLight(m, light);
  setGraph(m, `${key}|${groundLightKey(light)}`);
  return m;
}

function trunkEarthOf(r: FootRasters, variant: string): V3 {
  let colour = trunkEarths.get(variant);
  if (!colour) {
    colour = trunkEarthGraph(r);
    trunkEarths.set(variant, colour);
  }
  return colour;
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
  light?: GroundLight,
  sun?: UniformNode<"vec3", Vector3>
): FootMaterials {
  const variant = `${r.size.join("x")}|${r.edgesTexture ? "edges" : ""}`;
  const slots: Slots = {
    origin: r.origin,
    class: r.classTexture,
    edges: r.edgesTexture,
  };
  let needleShade: Material | undefined;
  const make = (part: "ring" | "earth" | "litter"): Material => {
    const key = `tree-${part}|${variant}`;
    const graph = cached(key, () =>
      part === "litter" ? litterGraph(r) : pitGraph(r, part)
    );
    return litMaterial(`tree-${part}`, graph, slots, light, key);
  };
  return {
    ring: make("ring"),
    earth: make("earth"),
    litter: make("litter"),
    shade: shadeMaterial(r, slots, variant, light, false, sun),
    needleShade: () =>
      (needleShade ??= shadeMaterial(r, slots, variant, light, true, sun)),
    guard: r.edgesTexture ? guardMaterial(r, slots, variant) : undefined,
    tuft: tuftMaterial(r, slots, variant, light),
    trunkEarth: {
      colour: trunkEarthOf(r, variant),
      key: `earth|${variant}`,
      slots,
    },
  };
}

/**
 * The foot materials of a fine terrain level, made from the rasters its
 * ground material reads (its slots) and its baked light: none where the
 * tile has no class raster — its trunks then stand on the bare ground.
 */
export function footMaterialFor(
  terrain: {
    bounds: readonly [number, number, number, number];
    mesh: { material: Material | Material[] };
    light?: GroundLight;
  },
  sun?: UniformNode<"vec3", Vector3>
): FootMaterials | undefined {
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
    terrain.light,
    sun
  );
}
