import {
  BufferAttribute,
  BufferGeometry,
  InterpolationSamplingType,
  type Material,
  type Node,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
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
  property,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  BUILTUP_CLASS,
  EDGE_SCALE,
  MEADOW_CLASS,
  RAILWAY_CLASS,
  ROAD_CLASS,
  srgbToLinear,
} from "@/lib/city/landcover";
import { TRUNK_UNIT_H, trunkRadiusAt } from "@/lib/city/tree-inventory";
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
 * - **under the crown** (off forest and copse, which have their own floor):
 *   the ground in the crown's shade — a little darker and cooler, mossy
 *   on a lawn (`shadeGraph`, a multiplied glaze, the one thing here that
 *   lets the ground through, since a shade is one) — and, in autumn,
 *   fallen leaves (`litterGraph`, covering flecks in the leaves' colours,
 *   lit as the ground), thick under the crown and gathered at the kerb.
 *   How much leaf lies is the scene's season (`footLitter`).
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
/** The unmown grass round a park tree (the mower keeps off the trunk):
 *  how far out it reaches past the trunk (m), the factor its long, darker,
 *  yellower blades multiply the lawn by, and its seed heads'. */
const UNMOWN_REACH = 0.85;
const UNMOWN = vec3(0.8, 0.9, 0.66);
const SEED_HEADS = vec3(1.14, 1.1, 0.9);
/** Sun flecks in the crown's shadow: how much a fleck lifts the shaded
 *  ground (×, a shadow is about half the sun), their size (m) and how far
 *  off (m) they still show (beyond, they would only shimmer). */
const DAPPLE = 1.1;
const DAPPLE_CELL = 0.55;
const DAPPLE_TO = 60;
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

/** The cull sphere's growth over the trunks' (m): the farthest leaf. */
export const FOOT_REACH = CROWN_MAX * LEAF_BEYOND + 0.5;

/** How much fallen leaf lies (0..1): the scene's season, one value for
 *  every tile (create-app.ts, lib/city/tree-season.ts `leafLitterAt`). */
export const footLitter = uniform(0);

/** The wind's clock (s) the sun flecks drift by: the crowns' own
 *  (vegetation-layer.ts `setCrownTime` keeps it). */
export const footClock = uniform(0);

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

/** A tile's foot materials (`footMaterialFor`). */
export interface FootMaterials {
  ring: Material;
  earth: Material;
  litter: Material;
  shade: Material;
}

/** The sets of a chunk's feet. */
const PARTS = ["ring", "earth", "litter", "shade"] as const;
type Part = (typeof PARTS)[number];

/** Draw order among the blended sets: every ring, then every pit's earth
 *  (so pits that overlap merge), the leaves on them, the shade over all. */
const ORDER: Record<Part, number> = { ring: 1, earth: 2, litter: 3, shade: 4 };

/**
 * The feet of a chunk's trunks: a set per part on the trunks' buffers (the
 * very attribute objects: nothing uploaded or counted twice), drawn as
 * many as the trunks, culled by their sphere grown by the leaves' reach.
 */
export function treeFeet(
  geos: FootGeos,
  materials: FootMaterials,
  trunks: Instances
): Instances[] {
  const sets: Instances[] = [];
  for (const part of PARTS) {
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

/** The forest's and the copse's class ids (lib/city/landcover.ts). */
const FOREST_CLASS = 2;
const COPSE_CLASS = 3;

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
  /** the crown's reach over the ground (m) */
  crown: F;
  /** 1 on a lawn or meadow (the baked lawn, the meadow class) */
  green: F;
  /** 1 in forest or copse, whose floor is its own */
  wood: F;
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
  return { foot, rt, world, pit, fade, crown, green, wood };
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

/** A flat varying: per instance, so a seed never smears (AGENTS.md). */
const flat = <T extends F | V2>(v: T, name: string): T =>
  varying(v, name).setInterpolation(
    InterpolationSamplingType.FLAT
  ) as unknown as T;

/** A quad of half-size `half` (m) at the foot, collapsed where `shown` is
 *  0, lifted off the ground (more with distance, the depth's precision). */
function footQuad(f: FootFrame, half: F, shown: F): { q: V2; position: V3 } {
  const lift = float(0.05).add(distance(cameraPosition, f.world).mul(0.0015));
  const q = positionGeometry.xz.mul(half).mul(shown);
  return { q, position: folded(f.foot.add(vec3(q.x, lift, q.y)), f.foot) };
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
    const kerb = edges
      ? smoothstep(
          -0.9,
          -0.15,
          edgeDistance(texture(edges, uv).level(float(0)).r)
        )
          .mul(
            float(1).sub(
              smoothstep(
                -0.15,
                0.05,
                edgeDistance(texture(edges, uv).level(float(0)).r)
              )
            )
          )
          .mul(float(1).sub(smoothstep(crown, crown.mul(LEAF_BEYOND), d)))
      : float(0);
    const density = clamp(under.add(kerb.mul(0.8)), 0, 1).mul(footLitter);
    const cellP = xy.div(LEAF_CELL).toVar();
    const cell = floor(cellP).toVar();
    const h = gdHash(cell).toVar();
    const h2 = gdHash(cell.add(17.3)).toVar();
    const inCell = cellP.sub(cell).sub(0.5).toVar();
    // a turned oval, off the cell's centre
    const turn = h2.mul(6.2832);
    const c = cos(turn);
    const sn = sin(turn);
    const p = inCell.sub(vec2(h.sub(0.5), h2.sub(0.5)).mul(0.3));
    const u = vec2(p.x.mul(c).add(p.y.mul(sn)), p.y.mul(c).sub(p.x.mul(sn)));
    const oval = length(u.mul(vec2(1, 1.9)));
    const w = max(fwidth(oval), 0.02);
    const leaf = float(1)
      .sub(smoothstep(float(0.36).sub(w), float(0.36).add(w), oval))
      .mul(step(h, density.mul(0.75)));
    const pick = gdHash(cell.add(5.1));
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
function shadeGraph(r: FootRasters, sun?: V3): ShadeGraph {
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
  const throwRaw = sun
    ? vec2(sun.x, sun.z).negate().div(up).mul(height)
    : vec2(0, 0);
  const throwLen = length(throwRaw);
  const thrown = throwRaw.mul(
    clamp(f.crown.mul(3).div(max(throwLen, 0.001)), 0, 1)
  );
  const half = f.crown.mul(1.1).add(length(thrown).mul(0.5));
  const lift = float(0.05).add(distance(cameraPosition, f.world).mul(0.0015));
  const q = positionGeometry.xz
    .mul(half)
    .mul(shown)
    .add(thrown.mul(0.5).mul(shown));
  const position = folded(f.foot.add(vec3(q.x, lift, q.y)), f.foot);
  const offset = varying(q, "vShadeOffset");
  const crown = flat(f.crown, "vShadeCrown");
  const green = flat(f.green, "vShadeGreen");
  const rt = flat(f.rt, "vShadeTrunk");
  const fade = varying(f.fade, "vShadeFade");
  const near = varying(
    float(1)
      .sub(
        smoothstep(
          DAPPLE_TO * 0.6,
          DAPPLE_TO,
          distance(cameraPosition, f.world)
        )
      )
      .mul(day),
    "vShadeDay"
  );
  const shadowAt = flat(thrown, "vShadeThrown");
  // the shadow's ellipse: drawn out along the sun by 1 / its elevation
  const stretch = flat(float(1).div(up).min(3), "vShadeStretch");
  const xy = varying(vec2(f.world.x, f.world.z).add(q), "vShadeXY");
  const sunLit = property("float", "footSunLit");
  const output = Fn(() => {
    const d = length(offset);
    const ragged = gdNoise(xy.mul(0.7)).sub(0.5).mul(crown.mul(0.35));
    const cover = float(1)
      .sub(smoothstep(crown.mul(0.45), crown.mul(1.05), d.add(ragged)))
      .toVar();
    const moss = smoothstep(0.45, 0.75, gdNoise(xy.mul(1.3).add(9.1)))
      .mul(green)
      .mul(cover);
    const k = mix(vec3(1), SHADE, cover.mul(0.75))
      .mul(mix(vec3(1), SHADE_MOSS, moss.mul(0.6)))
      .toVar();
    // the unmown ring on a lawn: long blades, streaked out from the trunk,
    // their seed heads catching the light; ragged at its edge
    const angle = atan(offset.y, offset.x);
    const reach = rt.add(UNMOWN_REACH).add(
      gdNoise(vec2(angle.mul(2.2), crown))
        .sub(0.5)
        .mul(0.5)
    );
    const ring = float(1)
      .sub(smoothstep(reach.sub(0.18), reach, d))
      .mul(green)
      .toVar();
    const blades = gdNoise(vec2(angle.mul(rt.add(0.6).mul(38)), d.mul(3)));
    const heads = smoothstep(0.7, 0.8, gdNoise(xy.div(0.05).add(3.3))).mul(
      float(1).sub(smoothstep(0.006, 0.02, fwidth(xy.x)))
    );
    k.mulAssign(
      mix(vec3(1), UNMOWN, ring.mul(blades.mul(0.5).add(0.6))).mul(
        mix(vec3(1), SEED_HEADS, ring.mul(heads))
      )
    );
    // sun flecks: in the crown's thrown shadow, where the ground is shaded
    const rel = offset.sub(shadowAt);
    const axis = vec2(shadowAt.x, shadowAt.y).div(max(length(shadowAt), 0.001));
    const along = rel.x.mul(axis.x).add(rel.y.mul(axis.y)).div(stretch);
    const across = rel.x.mul(axis.y).sub(rel.y.mul(axis.x));
    const inShadow = float(1).sub(
      smoothstep(crown.mul(0.5), crown.mul(1.05), length(vec2(along, across)))
    );
    const drift = vec2(footClock.mul(0.21), footClock.mul(0.13));
    const flecks = gdNoise(xy.div(DAPPLE_CELL).add(drift))
      .mul(0.6)
      .add(gdNoise(xy.div(DAPPLE_CELL * 0.45).sub(drift.mul(1.7))).mul(0.4));
    const fleck = smoothstep(0.6, 0.72, flecks)
      .mul(inShadow)
      .mul(float(1).sub(sunLit))
      .mul(near);
    k.mulAssign(fleck.mul(DAPPLE).add(1));
    return mix(vec3(1), k, fade);
  })();
  return { output, position, sunLit };
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

const shades = new Map<string, ShadeGraph>();

/**
 * A tile's shade glaze: multiplied into what is drawn under it. Lit only to
 * catch the shadow map's term for the sun flecks; what it draws is its
 * factor (`outputNode`), never its lighting.
 */
function shadeMaterial(
  r: FootRasters,
  slots: Slots,
  variant: string,
  light?: GroundLight
): MeshLambertNodeMaterial {
  const key = `tree-shade|${variant}|${light ? groundLightKey(light) : ""}`;
  let graph = shades.get(key);
  if (!graph) {
    graph = shadeGraph(r, light?.sunDirection);
    shades.set(key, graph);
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
  m.outputNode = vec4(graph.output, 1);
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
    shade: shadeMaterial(r, slots, variant, light),
  };
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
