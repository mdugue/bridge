import type { RasterSampler } from "@/lib/city/raster-sampler";
import {
  type BufferGeometry,
  Color,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { TreeFeature } from "@/lib/city/features";
import { familyLook, TRUNK_BASE } from "@/lib/city/tree-family";
import { ageLook } from "@/lib/city/tree-age";
import { buildTreeStakes } from "./tree-stakes";
import { buildTreePlan } from "./tree-plan";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  CROWN_SHAPES,
  type CrownShape,
  inventoryCovers,
  type InventoryTree,
  inventoryTrees,
  type TreeExtents,
  trunkGirth,
} from "@/lib/city/tree-inventory";
import {
  type CrownMaterials,
  type CrownSeasonKey,
  type SeasonalCrowns,
  seasonCrowns,
} from "./crown-season";
import {
  buildConeGeo,
  buildPineGeo,
  CONE_SEGMENTS,
  reshapeCrown,
  type SilhouetteMap,
} from "./conifer-crown";
import { finished, inRuns, type Steps } from "@/lib/city/build-steps";
import { Instances } from "./instancing";
import {
  applySeasons,
  buildCrownGeo,
  buildCrownGeoRich,
  padCrownSphere,
  bucketByCell,
  type CellLod,
  crownColor,
  evergreenColor,
  hash,
  sceneCrowns,
  swapCrownLod,
  TRUNK_H,
  type TreeInstance,
  type TreeVeto,
  type VegetationContext,
  type VegetationControl,
} from "./vegetation-layer";

/**
 * Tree inventory layer: the Dresden street-tree cadastre
 * (pipeline/bake/trees.py) drawn at each tree's surveyed position, height
 * and crown diameter, with an archetype silhouette per genus/cultivar
 * (lib/city/tree-inventory.ts).
 *
 * It reuses everything the canopy trees are made of — the lobed crown and the
 * multi-tuft rich crown, the scene's crown materials (sway, shimmer,
 * translucency, gust brightening; the same builds as the canopy's), the
 * trunk, the 250 m chunks and the distance LOD swap — and adds
 * only what a per-instance scale cannot express: two reshaped variants of
 * the SAME two crown geometries (a flame for fastigiate cultivars, a
 * curtained dome for weeping trees) and the needle trees' two forms
 * (conifer-crown.ts, the canopy's evergreens wear the same): the tiered
 * lathe cone for a spruce, a fir, a thuja, and a pine's flat-topped crown,
 * all inside the broadleaf crown's local box. Proportions ride on
 * a non-uniform instance scale (width = crown diameter, depth = height minus
 * the clear stem), so round, oval and small ornamentals — and a yew's bush,
 * the lobed crown down to the ground — share one mesh.
 *
 * Cost: the trunks and the broadleaf crowns (≈93 % of the trees) are not
 * meshes of this layer at all — they are handed to the canopy
 * (`instances`, vegetation-layer.ts TreeInstance) and ride in its chunk
 * meshes, so they cost instances, not draw calls. Only the four reshaped
 * silhouettes get sets here: per 250 m chunk one per shape present (flame
 * often, cone, pine and dome rarely), each doubled by the invisible other
 * LOD.
 */

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Fastigiate flame: a sphere whose upper half tapers to a soft point. */
const flame: SilhouetteMap = (dy) => {
  const y = (dy + 1) / 2;
  const r = Math.sqrt(Math.max(0, 1 - dy * dy));
  return { r: r * (1.08 - 0.55 * smoothstep(0.3, 1, y)), y };
};

/** Weeping: a dome on top, a folded curtain hanging almost to the ground,
 *  and a hollow underside tucked up inside it. */
const weep: SilhouetteMap = (dy, phi) => {
  if (dy >= 0) {
    return { r: Math.sqrt(Math.max(0, 1 - dy * dy)), y: 0.62 + 0.38 * dy };
  }
  const s = -dy;
  if (s <= 0.75) {
    const k = s / 0.75;
    return {
      r: (1 - 0.08 * k) * (1 + 0.06 * k * Math.sin(9 * phi)),
      y: 0.62 * (1 - k),
    };
  }
  const k = (s - 0.75) / 0.25;
  return { r: 0.92 * (1 - k), y: 0.12 * k };
};

type ReshapedShape = "spindle" | "weep";
const SILHOUETTES: Record<ReshapedShape, SilhouetteMap> = {
  spindle: flame,
  weep,
};
/** Height (0..1) of the centre the reshaped crown's radial normals point
 *  away from. */
const NORMAL_CENTRE: Record<ReshapedShape, number> = {
  spindle: 0.4,
  weep: 0.5,
};
/** A crown geometry plus the local box the instance scale is fitted to. */
interface FittedGeo {
  geo: BufferGeometry;
  height: number;
  minY: number;
  width: number;
}

function fitted(geo: BufferGeometry): FittedGeo {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) {
    return { geo, height: 1, minY: 0, width: 1 };
  }
  return {
    geo,
    height: box.max.y - box.min.y,
    minY: box.min.y,
    width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
  };
}

type ShapeGeos = Record<CrownShape, { cheap: FittedGeo; rich: FittedGeo }>;

function buildShapeGeos(): ShapeGeos {
  const cheap = buildCrownGeo();
  const rich = buildCrownGeoRich();
  const broad = { cheap: fitted(cheap), rich: fitted(rich) };
  const out = {
    broad,
    // the conifer-crown.ts cone in the broadleaf crown's box, and the
    // pine's crown reshaped from the broadleaf's own, as the canopy's
    // evergreens draw them
    cone: {
      cheap: fitted(buildConeGeo(broad.cheap, CONE_SEGMENTS.mid)),
      rich: fitted(buildConeGeo(broad.cheap, CONE_SEGMENTS.rich)),
    },
    pine: {
      cheap: fitted(buildPineGeo(cheap)),
      rich: fitted(buildPineGeo(rich)),
    },
  } as ShapeGeos;
  for (const shape of ["spindle", "weep"] as const) {
    const map = SILHOUETTES[shape];
    const c = NORMAL_CENTRE[shape];
    out[shape] = {
      cheap: fitted(reshapeCrown(cheap, map, c)),
      rich: fitted(reshapeCrown(rich, map, c)),
    };
  }
  // the crowns are reshaped per tree in the material (crownShape)
  for (const pair of Object.values(out)) {
    padCrownSphere(pair.cheap.geo);
    padCrownSphere(pair.rich.geo);
  }
  return out;
}

/** How a register tree's crown follows the year (its genus and leaf). */

function seasonKeyOf(t: InventoryTree): CrownSeasonKey {
  const evergreen = t.leaf === "e";
  return {
    genus: t.genus,
    evergreen,
    jitter: t.jitter,
  };
}

/** A trunk's bark as the trunk material's tint (white = its own colour):
 *  the family's bark divided by the material's base. */
export function barkTint(genus: number, evergreen: boolean): Color {
  const bark = new Color(familyLook(genus, evergreen).bark);
  const own = new Color(TRUNK_BASE);
  return bark.setRGB(bark.r / own.r, bark.g / own.g, bark.b / own.b);
}

const Y_AXIS = new Vector3(0, 1, 0);

/** Register trees placed per step (build-steps.ts). */
const INVENTORY_RUN = 256;

/** Crown matrices: the geometry's local box fitted to the tree's crown. */
function writeCrowns(
  mesh: Instances,
  items: InventoryTree[],
  fit: FittedGeo
): void {
  items.forEach((t, i) => mesh.setMatrixAt(i, crownMatrix(t, fit)));
  mesh.instanceMatrix.needsUpdate = true;
  // Without this the cull test uses the origin-centred geometry sphere and
  // culls the whole chunk whenever the world origin is off-screen.
  mesh.computeBoundingSphere();
}

/** Trunk girth: the measured diameter where there is one, else the height
 *  (tree-inventory.ts trunkGirth). */
function trunkMatrix(t: InventoryTree): Matrix4 {
  // a measured trunk is as measured; else the age thins or thickens it
  const girth =
    trunkGirth(t.ext, t.dbh) * (t.dbh === undefined ? ageLook(t.age).girth : 1);
  return new Matrix4().compose(
    new Vector3(t.x, t.ground, t.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, t.rot),
    new Vector3(girth, t.ext.trunkTop / TRUNK_H, girth)
  );
}

/** Where a crown stands and how far it reaches. */
type CrownPlace = Pick<InventoryTree, "ground" | "rot" | "x" | "z"> & {
  ext: Pick<TreeExtents, "crownBase" | "crownTop" | "crownWidth">;
};

/** The crown's local box fitted to the tree's crown (see writeCrowns). */
function crownMatrix(t: CrownPlace, fit: Omit<FittedGeo, "geo">): Matrix4 {
  const sy = (t.ext.crownTop - t.ext.crownBase) / fit.height;
  const sxz = t.ext.crownWidth / fit.width;
  return new Matrix4().compose(
    new Vector3(t.x, t.ground + t.ext.crownBase - fit.minY * sy, t.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, t.rot),
    new Vector3(sxz, sy, sxz)
  );
}

let broadFit: Omit<FittedGeo, "geo"> | null = null;

/**
 * A register tree's broadleaf crown as the canopy's chunks place it (its
 * cheap matrix, `canopyInstances`): what the coarse level draws for a
 * register tree (coarse-crowns-layer.ts), whatever its silhouette.
 */
export function registerCrownMatrix(t: CrownPlace): Matrix4 {
  if (!broadFit) {
    const geo = buildCrownGeo();
    const { height, minY, width } = fitted(geo);
    geo.dispose();
    broadFit = { height, minY, width };
  }
  return crownMatrix(t, broadFit);
}

/**
 * What the canopy draws for the inventory: every trunk, and the broadleaf
 * crowns (fitted to the canopy's own cheap and rich crown geometry, which
 * are the very geometries `broad` holds).
 */
function canopyInstances(
  trees: InventoryTree[],
  broad: ShapeGeos["broad"]
): TreeInstance[] {
  return trees.map((t) => {
    const out: TreeInstance = {
      x: t.x,
      z: t.z,
      trunk: trunkMatrix(t),
      bark: barkTint(t.genus, t.leaf === "e"),
    };
    if (t.shape === "broad") {
      const colour = new Color();
      inventoryColor(colour, t, hash(t.x * 0.3 + t.z * 0.7) - 0.5);
      out.crown = {
        cheap: crownMatrix(t, broad.cheap),
        rich: crownMatrix(t, broad.rich),
        colour,
        season: seasonKeyOf(t),
      };
    }
    return out;
  });
}

/**
 * Crown colour: the cadastre's leaf type and foliage colour where they say
 * something the NDVI cannot (evergreens, purple and golden cultivars), the
 * canopy trees' own NDVI remap (vegetation-layer crownColor) otherwise, so
 * an inventory lime and a canopy lime read as the same tree — then leaned
 * by the genus's family (lib/city/tree-family.ts: a chestnut deeper, a
 * robinia yellower, a plane lighter), so a street of mixed genera reads
 * mixed — and by its age (lib/city/tree-age.ts: a sapling fresh and light,
 * an ancient tree deep).
 */
export function inventoryColor(
  col: Color,
  t: Pick<InventoryTree, "colour" | "ground" | "leaf" | "ndvi" | "x" | "z"> & {
    genus?: number;
    age?: number;
  },
  v: number
): void {
  plainInventoryColor(col, t, v);
  if (t.colour !== 0 || t.leaf === "e") {
    return;
  }
  if (t.genus !== undefined) {
    lean(col, familyLook(t.genus).summer);
  }
  lean(col, ageLook(t.age).leaf);
}

function lean(col: Color, [dh, ds, dl]: readonly [number, number, number]) {
  col.getHSL(hsl);
  col.setHSL(
    (hsl.h + dh + 1) % 1,
    Math.min(Math.max(hsl.s + ds, 0), 1),
    Math.min(Math.max(hsl.l + dl, 0), 1)
  );
}
const hsl = { h: 0, s: 0, l: 0 };

function plainInventoryColor(
  col: Color,
  t: Pick<InventoryTree, "colour" | "ground" | "leaf" | "ndvi" | "x" | "z">,
  v: number
): void {
  if (t.colour === 1) {
    col.setHSL(0.97 + v * 0.02, 0.2, 0.47 + v * 0.06); // copper / plum
  } else if (t.colour === 2) {
    col.setHSL(0.15 + v * 0.02, 0.4, 0.66 + v * 0.05); // golden
  } else if (t.leaf === "e") {
    evergreenColor(col, v);
  } else {
    crownColor(
      col,
      { x: t.x, y: t.ground, z: t.z, rot: 0, s: 1, ndvi: t.ndvi },
      v
    );
  }
}

function paint(mesh: Instances, items: InventoryTree[]): void {
  const col = new Color();
  items.forEach((t, i) => {
    inventoryColor(col, t, hash(t.x * 0.3 + t.z * 0.7) - 0.5);
    mesh.setColorAt(i, col);
  });
  if (mesh.instanceTints) {
    mesh.instanceTints.needsUpdate = true;
  }
}

function crownPair(
  items: InventoryTree[],
  geos: ShapeGeos[CrownShape],
  materials: CrownMaterials
): { lod: CellLod; season: SeasonalCrowns } {
  const cheap = new Instances(geos.cheap.geo, materials.leafy, items.length);
  const rich = new Instances(geos.rich.geo, materials.leafy, items.length);
  for (const [mesh, fit] of [
    [cheap, geos.cheap],
    [rich, geos.rich],
  ] as const) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    writeCrowns(mesh, items, fit);
    paint(mesh, items);
  }
  rich.visible = false;
  // the cheap tier is the season's "mid": the pair shares one tint buffer
  const season = seasonCrowns(
    { mid: cheap, rich },
    items.map(seasonKeyOf),
    materials
  );
  return { lod: { cheap, rich }, season };
}

export interface TreeInventory {
  /** the reshaped silhouettes (flame, cone, pine, dome) — this layer's own
   *  sets */
  control: VegetationControl;
  /** per-tile census of what was built, for the cost report */
  counts: Record<CrownShape, number>;
  /** every trunk and the broadleaf crowns, for the canopy's chunk meshes
   *  (VegetationFeatures.extraTrees) */
  instances: TreeInstance[];
  /** false where an inventory tree stands (VegetationFeatures.keepTree);
   *  a canopy point that clearly overtops it is kept, and a tree in DLM
   *  forest/copse (`f`) vetoes nothing (tree-inventory.ts) */
  keepTree: TreeVeto;
}

/**
 * Builds one tile's inventory trees. Empty input yields an empty group, no
 * instances and a `keepTree` that vetoes nothing. The group is added to the
 * Y-up `scene`, like every tree; the instances go to buildVegetation.
 */
export function buildTreeInventory(
  features: TreeFeature[],
  ctx: VegetationContext,
  ndviAt?: RasterSampler
): TreeInventory {
  return finished(treeInventorySteps(features, ctx, ndviAt));
}

/** `buildTreeInventory` in steps: per run of register trees, per cell of
 *  silhouettes (build-steps.ts). */
export function* treeInventorySteps(
  features: TreeFeature[],
  ctx: VegetationContext,
  ndviAt?: RasterSampler
): Steps<TreeInventory> {
  const group = new Group();
  group.name = "tree-inventory";
  // The scene's crown materials and uniforms, as the canopy's (sceneCrowns).
  const crownMats = sceneCrowns(ctx.sunDirection);
  const u = crownMats.uniforms;
  let multiTuft = LOOK_DEFAULTS.multiTuft;
  const counts = Object.fromEntries(CROWN_SHAPES.map((k) => [k, 0])) as Record<
    CrownShape,
    number
  >;

  // A tree in DLM forest/copse vetoes nothing (inventoryCovers).
  const covers = inventoryCovers(features);
  yield;
  const trees = yield* inRuns(features, INVENTORY_RUN, (run) =>
    inventoryTrees(run, ctx, ndviAt)
  );
  const cells: CellLod[] = [];
  const seasons: SeasonalCrowns[] = [];
  let instances: TreeInstance[] = [];
  if (trees.length > 0) {
    const geos = buildShapeGeos();
    instances = canopyInstances(trees, geos.broad);
    yield;
    const stakes = buildTreeStakes(trees.filter((t) => ageLook(t.age).staked));
    if (stakes) {
      group.add(stakes);
    }
    const plan = buildTreePlan(trees);
    if (plan) {
      group.add(plan);
    }
    counts.broad = trees.filter((t) => t.shape === "broad").length;
    const reshaped = trees.filter((t) => t.shape !== "broad");
    for (const cell of bucketByCell(reshaped)) {
      for (const shape of CROWN_SHAPES) {
        const items = cell.filter((t) => t.shape === shape);
        if (items.length === 0) {
          continue;
        }
        counts[shape] += items.length;
        const { lod, season } = crownPair(items, geos[shape], crownMats);
        lod.cheap.userData.treePart = shape;
        lod.rich.userData.treePart = shape;
        group.add(lod.cheap, lod.rich);
        cells.push(lod);
        seasons.push(season);
      }
      yield;
    }
  }

  return {
    counts,
    instances,
    keepTree: (x, y, h) => !covers(x, y, h),
    control: {
      group,
      // Its trunks and broadleaf crowns ride in the canopy's chunks
      // (`instances`); only its own silhouettes are here.
      chunks: [],
      multiTuft: () => multiTuft,
      applyLook: (look) => {
        multiTuft = look.multiTuft;
      },
      setTime: (seconds) => {
        u.time.value = seconds;
      },
      setSeason: (day) => applySeasons(seasons, day),
      // Same rule as the canopy (vegetation-layer.ts swapCrownLod).
      updateLod: (cameraPos) => swapCrownLod(cells, cameraPos, multiTuft),
    },
  };
}
