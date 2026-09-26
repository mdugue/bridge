import {
  type BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import type { TreeFeature } from "@/lib/city/features";
import { epsgToWorld } from "@/lib/city/ground-clamp";
import {
  LOOK_DEFAULTS,
  type VegetationLookKey,
} from "@/lib/city/look-controls";
import {
  ARCHETYPE_SHAPE,
  archetypeOf,
  CROWN_SHAPES,
  type CrownShape,
  footprintIndex,
  footprintRadius,
  type TreeExtents,
  treeExtents,
  trunkGirth,
} from "@/lib/city/tree-inventory";
import { seasonJitter } from "@/lib/city/tree-season";
import {
  type CrownMaterials,
  type CrownSeasonKey,
  type SeasonalCrowns,
  seasonCrowns,
} from "./crown-season";
import {
  applySeasons,
  buildCrownGeo,
  buildCrownGeoRich,
  buildCrownMaterials,
  bucketByCell,
  crownLookRefs,
  type CellLod,
  crownColor,
  hash,
  type RasterSampler,
  swapCrownLod,
  TRUNK_H,
  type TreeInstance,
  type TreeVeto,
  type VegetationContext,
  type VegetationControl,
} from "./vegetation-layer";
import { disposeMaterial } from "./three-utils";

/**
 * Tree inventory layer: the Dresden street-tree cadastre
 * (pipeline/bake/trees.py) drawn at each tree's surveyed position, height
 * and crown diameter, with an archetype silhouette per genus/cultivar
 * (lib/city/tree-inventory.ts).
 *
 * It reuses everything the canopy trees are made of — the lobed crown and the
 * multi-tuft rich crown, the crown material (sway, shimmer, translucency,
 * flutter), the trunk, the 250 m chunks and the distance LOD swap — and adds
 * only what a per-instance scale cannot express: two reshaped variants of
 * the SAME two crown geometries (a flame for fastigiate cultivars, a
 * curtained dome for weeping trees) and a tiered lathe cone for conifers,
 * all inside the broadleaf crown's local box. Proportions ride on
 * a non-uniform instance scale (width = crown diameter, depth = height minus
 * the clear stem), so round, oval and small ornamentals share one mesh.
 *
 * Cost: the trunks and the broadleaf crowns (≈93 % of the trees) are not
 * meshes of this layer at all — they are handed to the canopy
 * (`instances`, vegetation-layer.ts TreeInstance) and ride in its chunk
 * meshes, so they cost instances, not draw calls. Only the three reshaped
 * silhouettes get meshes here: per 250 m chunk one per shape present (flame
 * often, cone and dome rarely), each doubled by the invisible other LOD.
 */

/** Unit-space silhouette: a direction on the unit sphere (its height `dy`
 *  in [-1, 1] and azimuth `phi`) → horizontal radius and height in [0, 1]. */
type SilhouetteMap = (dy: number, phi: number) => { r: number; y: number };

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

/**
 * Conifer profile (unit radius, unit height), bottom centre to apex: three
 * tiers, each hem flaring out below the tier above — the stacked-skirt
 * silhouette of a children's-book fir. A reshaped lobed sphere cannot hold
 * the hems (too few vertex rings), so the cone is a lathe of its own.
 */
const CONE_PROFILE: [number, number][] = [
  [0, 0],
  [0.9, 0.05],
  [1, 0.1],
  [0.82, 0.22],
  [0.6, 0.4],
  [0.76, 0.36],
  [0.58, 0.52],
  [0.42, 0.66],
  [0.54, 0.62],
  [0.3, 0.84],
  [0, 1],
];

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
 *  away from (a cone's is low, so its flanks face up and out). */
const NORMAL_CENTRE: Record<ReshapedShape | "cone", number> = {
  spindle: 0.4,
  cone: 0.25,
  weep: 0.5,
};
/** How much of the source crown's lobe relief survives the reshape. */
const RELIEF = 0.8;

/**
 * Reshapes one of the vegetation layer's crown geometries into another
 * silhouette inside the SAME bounding box, keeping its lobes as relief: each
 * vertex's direction from the crown centre (in the box's ellipsoid space)
 * picks its place on the new silhouette, its distance the bump on top. The
 * local height range is kept on purpose — the crown material's wind sway
 * reads local Y, so a reshaped crown bends exactly like the original.
 */
function reshapeCrown(
  source: BufferGeometry,
  map: SilhouetteMap,
  normalCentre: number
): BufferGeometry {
  const g = source.clone();
  g.computeBoundingBox();
  const box = g.boundingBox;
  if (!box) {
    return g;
  }
  const minY = box.min.y;
  const height = box.max.y - box.min.y;
  const halfH = height / 2;
  const halfW = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const cy = minY + halfH;
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const v = new Vector3();
  const centre = new Vector3(0, minY + normalCentre * height, 0);
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) / halfW, (pos.getY(i) - cy) / halfH, pos.getZ(i) / halfW);
    const len = Math.max(v.length(), 1e-6);
    const dy = v.y / len;
    const phi = Math.atan2(v.z, v.x);
    const { r, y } = map(dy, phi);
    const k = 1 + (len - 1) * RELIEF;
    pos.setXYZ(
      i,
      Math.cos(phi) * r * k * halfW,
      minY + y * height,
      Math.sin(phi) * r * k * halfW
    );
  }
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(centre).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

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

/**
 * The tiered conifer as a lathe inside the broadleaf crown's local box (so
 * the material's sway, which reads local Y, bends it the same way). A low
 * azimuthal wobble keeps it from reading as a paper cone; the rich LOD only
 * adds segments and a second wobble octave.
 */
function buildConeGeo(like: FittedGeo, segments: number): BufferGeometry {
  const halfW = like.width / 2;
  const pts = CONE_PROFILE.map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(pts, segments);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const v = new Vector3();
  const centre = new Vector3(
    0,
    like.minY + NORMAL_CENTRE.cone * like.height,
    0
  );
  const rich = segments > 16;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const phi = Math.atan2(z, x);
    let k = 1 + 0.07 * Math.sin(5 * phi + y * 9);
    if (rich) {
      k += 0.035 * Math.sin(11 * phi - y * 17);
    }
    pos.setXYZ(i, x * k * halfW, like.minY + y * like.height, z * k * halfW);
  }
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(centre).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  return g;
}

function buildShapeGeos(): ShapeGeos {
  const cheap = buildCrownGeo();
  const rich = buildCrownGeoRich();
  const broad = { cheap: fitted(cheap), rich: fitted(rich) };
  const out = {
    broad,
    cone: {
      cheap: fitted(buildConeGeo(broad.cheap, 10)),
      rich: fitted(buildConeGeo(broad.cheap, 24)),
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
  return out;
}

/** One inventory tree in the Y-up scene frame. */
interface InventoryTree {
  colour: number;
  /** measured trunk diameter at breast height (cm) */
  dbh?: number;
  ext: TreeExtents;
  ground: number;
  leaf: "d" | "e";
  ndvi?: number;
  rot: number;
  /** genus, leaf type and jitter: how the crown follows the year */
  season: CrownSeasonKey;
  shape: CrownShape;
  x: number;
  z: number;
}

function collectTrees(
  features: TreeFeature[],
  ctx: VegetationContext,
  ndviAt?: RasterSampler
): InventoryTree[] {
  const out: InventoryTree[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point" || !f.properties) {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    const p = f.properties;
    const archetype = archetypeOf(p.a);
    const w = epsgToWorld(ex, ey, ctx.offset);
    out.push({
      x: w.x,
      z: w.z,
      ground,
      rot: hash(ex * 0.13 + ey * 0.07) * Math.PI * 2,
      ext: treeExtents(p.h, p.d, archetype, p.g === 1),
      shape: ARCHETYPE_SHAPE[archetype],
      leaf: p.l === "e" ? "e" : "d",
      season: {
        genus: p.gn ?? 0,
        evergreen: p.l === "e",
        jitter: seasonJitter(hash(ex * 0.29 + ey * 0.53 + 3.7)),
      },
      colour: p.c ?? 0,
      dbh: p.t,
      ndvi: ndviAt?.(ex, ey),
    });
  }
  return out;
}

const Y_AXIS = new Vector3(0, 1, 0);

/** Crown matrices: the geometry's local box fitted to the tree's crown. */
function writeCrowns(
  mesh: InstancedMesh,
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
  const girth = trunkGirth(t.ext, t.dbh);
  return new Matrix4().compose(
    new Vector3(t.x, t.ground, t.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, t.rot),
    new Vector3(girth, t.ext.trunkTop / TRUNK_H, girth)
  );
}

/** The crown's local box fitted to the tree's crown (see writeCrowns). */
function crownMatrix(t: InventoryTree, fit: FittedGeo): Matrix4 {
  const sy = (t.ext.crownTop - t.ext.crownBase) / fit.height;
  const sxz = t.ext.crownWidth / fit.width;
  return new Matrix4().compose(
    new Vector3(t.x, t.ground + t.ext.crownBase - fit.minY * sy, t.z),
    new Quaternion().setFromAxisAngle(Y_AXIS, t.rot),
    new Vector3(sxz, sy, sxz)
  );
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
    const out: TreeInstance = { x: t.x, z: t.z, trunk: trunkMatrix(t) };
    if (t.shape === "broad") {
      const colour = new Color();
      inventoryColor(colour, t, hash(t.x * 0.3 + t.z * 0.7) - 0.5);
      out.crown = {
        cheap: crownMatrix(t, broad.cheap),
        rich: crownMatrix(t, broad.rich),
        colour,
        season: t.season,
      };
    }
    return out;
  });
}

/**
 * Crown colour: the cadastre's leaf type and foliage colour where they say
 * something the NDVI cannot (evergreens, purple and golden cultivars), the
 * canopy trees' own NDVI remap (vegetation-layer crownColor) otherwise, so
 * an inventory lime and a canopy lime read as the same tree.
 */
function inventoryColor(col: Color, t: InventoryTree, v: number): void {
  if (t.colour === 1) {
    col.setHSL(0.97 + v * 0.02, 0.2, 0.47 + v * 0.06); // copper / plum
  } else if (t.colour === 2) {
    col.setHSL(0.15 + v * 0.02, 0.4, 0.66 + v * 0.05); // golden
  } else if (t.leaf === "e") {
    col.setHSL(0.38 + v * 0.03, 0.24, 0.44 + v * 0.06); // evergreen blue-green
  } else {
    crownColor(
      col,
      { x: t.x, y: t.ground, z: t.z, rot: 0, s: 1, ndvi: t.ndvi },
      v
    );
  }
}

function paint(mesh: InstancedMesh, items: InventoryTree[]): void {
  const col = new Color();
  items.forEach((t, i) => {
    inventoryColor(col, t, hash(t.x * 0.3 + t.z * 0.7) - 0.5);
    mesh.setColorAt(i, col);
  });
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function crownPair(
  items: InventoryTree[],
  geos: ShapeGeos[CrownShape],
  materials: CrownMaterials
): { lod: CellLod; season: SeasonalCrowns } {
  const cheap = new InstancedMesh(
    geos.cheap.geo,
    materials.leafy,
    items.length
  );
  const rich = new InstancedMesh(geos.rich.geo, materials.leafy, items.length);
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
  // the cheap tier is the season's "mid": the pair shares one colour buffer
  const season = seasonCrowns(
    { mid: cheap, rich },
    items.map((t) => t.season),
    materials
  );
  return { lod: { cheap, rich }, season };
}

export interface TreeInventory {
  /** the reshaped silhouettes (flame, cone, dome) — this layer's own meshes */
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
  const group = new Group();
  group.name = "tree-inventory";
  const { shimmer, translucency, leafFlutter, leafBright, uTime } =
    crownLookRefs();
  const rowUniform: Record<VegetationLookKey, { value: number }> = {
    leafBright,
    leafFlutter,
    shimmer,
    translucency,
  };
  let multiTuft = LOOK_DEFAULTS.multiTuft;
  const counts = { broad: 0, spindle: 0, cone: 0, weep: 0 };

  // A tree in DLM forest/copse (the bake's `f`) vetoes nothing: there the
  // measured canopy is denser than the register, and letting the register
  // thin it made parks and woods visibly sparser.
  const covers = footprintIndex(
    features.flatMap((f) =>
      f.geometry?.type === "Point" && f.properties && f.properties.f !== 1
        ? [
            {
              x: f.geometry.coordinates[0],
              y: f.geometry.coordinates[1],
              r: footprintRadius(f.properties.d),
              h: f.properties.h,
            },
          ]
        : []
    )
  );
  const trees = collectTrees(features, ctx, ndviAt);
  const cells: CellLod[] = [];
  const seasons: SeasonalCrowns[] = [];
  let instances: TreeInstance[] = [];
  if (trees.length > 0) {
    const geos = buildShapeGeos();
    instances = canopyInstances(trees, geos.broad);
    counts.broad = trees.filter((t) => t.shape === "broad").length;
    const reshaped = trees.filter((t) => t.shape !== "broad");
    const crownMats =
      reshaped.length > 0
        ? buildCrownMaterials(
            {
              sunDirection: ctx.sunDirection ?? new Vector3(0, 1, 0),
              shimmer,
              uTime,
              translucency,
              leafFlutter,
              leafBright,
            },
            ctx.heightFog
          )
        : null;
    for (const cell of crownMats ? bucketByCell(reshaped) : []) {
      for (const shape of CROWN_SHAPES) {
        const items = cell.filter((t) => t.shape === shape);
        if (items.length === 0 || !crownMats) {
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
    }
    // As in the canopy (vegetation-layer.ts buildTrees): a crown material
    // may be on no mesh, so both go with the layer's first mesh.
    cells[0]?.cheap.addEventListener("dispose", () => {
      disposeMaterial(crownMats?.leafy);
      disposeMaterial(crownMats?.bare);
    });
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
        for (const key of Object.keys(rowUniform) as VegetationLookKey[]) {
          rowUniform[key].value = look[key];
        }
        multiTuft = look.multiTuft;
      },
      setTime: (seconds) => {
        uTime.value = seconds;
      },
      setSeason: (day) => applySeasons(seasons, day),
      // Same rule as the canopy (vegetation-layer.ts swapCrownLod).
      updateLod: (cameraPos) => swapCrownLod(cells, cameraPos, multiTuft),
    },
  };
}
