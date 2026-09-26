import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  type Material,
  Matrix4,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  type UniformNode,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  clamp,
  distance,
  dot,
  float,
  floor,
  fract,
  length,
  materialColor,
  max,
  mix,
  normalize,
  normalWorldGeometry,
  positionGeometry,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CanopyFeature, VegRowFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import {
  LOOK_DEFAULTS,
  type LookValues,
  type VegetationLookKey,
} from "@/lib/city/look-controls";
import { decodeGreyPng } from "@/lib/city/png-raster";
import { samplePolyline } from "@/lib/city/polyline";
import {
  maxWindowSampler,
  type RasterSampler,
} from "@/lib/city/raster-sampler";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  TRUNK_FOOT_R,
  TRUNK_ROWS,
  TRUNK_TOP_R,
  trunkFlare,
} from "@/lib/city/tree-inventory";
import { seasonJitter } from "@/lib/city/tree-season";
import {
  CROWN_BASE_COLOR,
  type CrownMaterials,
  type CrownSeasonKey,
  crownSeasonNodes,
  type CrownWarmup,
  crownWarmup,
  type SeasonalCrowns,
  seasonCrowns,
} from "./crown-season";
import {
  type ChunkLodState,
  type CrownTier,
  keepInFarTier,
  planCrownTiers,
  RICH_IN_M,
  RICH_OUT_M,
} from "@/lib/city/vegetation-lod";
import { isAbortError } from "./fetch-optional";
import {
  Instances,
  instanceMatrix,
  instancePosition,
  instanceTint,
} from "./instancing";
import type { F, Live, V2, V3, V4 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * Veto on a row or canopy tree at EPSG (x, y) with its measured height `h`
 * (canopy points only): false drops it because a surveyed inventory tree
 * already stands there (tree-inventory-layer.ts).
 */
export type TreeVeto = (x: number, y: number, h?: number) => boolean;

/**
 * A tree placed by precomputed transforms rather than a uniform scale — the
 * street-tree cadastre's (tree-inventory-layer.ts). It joins the canopy's own
 * chunk meshes, so it costs instances, not draw calls: its trunk always, its
 * crown when it has the broadleaf shape the canopy draws (`crown`; the other
 * silhouettes are the inventory layer's own meshes).
 */
export interface TreeInstance {
  /** `season`: how the crown follows the year (absent = the generic
   *  deciduous curve, like a canopy tree) */
  crown?: {
    cheap: Matrix4;
    colour: Color;
    rich: Matrix4;
    season?: CrownSeasonKey;
  };
  trunk: Matrix4;
  /** Y-up world position, for the chunk bucketing */
  x: number;
  z: number;
}

/** One tile's decoded vegetation inputs. */
export interface VegetationFeatures {
  /** DOM1-derived canopy points (trees scaled to their measured height) */
  canopy: CanopyFeature[];
  /** precomputed trees drawn in the same chunk meshes (TreeInstance) */
  extraTrees?: TreeInstance[];
  /** optional TreeVeto; hedges are never vetoed */
  keepTree?: TreeVeto;
  /** the DOP NDVI sampler (loadNdviSampler), for lush↔dry crown colour */
  ndviAt?: RasterSampler;
  /** ATKIS veg04 hedges and tree rows */
  rows: VegRowFeature[];
}

export interface VegetationContext extends GroundContext {
  /**
   * Shared world-space sun direction (surface→sun), updated by the sun rig.
   * The crown materials' `sunDirection` uniform node holds it by reference
   * for the backlit shimmer. May be absent (the shimmer then keeps the
   * direction it has — straight up until a tile hands one in).
   */
  sunDirection?: Vector3;
}

/**
 * Crown LOD hysteresis, measured to the NEAREST tree in a chunk (camera distance
 * minus the chunk's instance-sphere radius), not the centroid — otherwise a tree
 * a few metres away could stay cheap because its 250 m chunk's centre is far. A
 * cheap chunk switches to rich within NEAR_IN; a rich chunk only drops past
 * NEAR_OUT, so chunks straddling the line don't flicker. These drive
 * swapCrownLod (the cadastre's own silhouettes); the canopy chunks take the
 * same distances through updateVegetationLod, which adds the far tier and
 * the site-wide rich budget.
 */
export const LOD_NEAR_IN_M = RICH_IN_M;
export const LOD_NEAR_OUT_M = RICH_OUT_M;
/** Far-tier crowns of a thinned (dense) chunk are drawn this much wider. */
const FAR_THIN_WIDEN = 1.35;

/**
 * Runtime handle for a loaded vegetation group: a per-frame LOD swap plus live
 * tuning of the shimmer and the rich-crown toggle.
 */
export interface VegetationControl {
  /**
   * Pushes the vegetation rows of the look into the crowns: the backlit
   * shimmer, the shadow-gated translucency, the multi-tuft crown LOD toggle,
   * and the two coupled "moving leaves" effects, each independently tunable
   * (zero one to preview the other):
   * - (A) leafFlutter: small, irregular bright specks (world-space value
   *   noise, ~1-2 m cells, two octaves + drift) where wind flips leaves to
   *   their paler underside; the crown albedo blends toward a lighter
   *   silver-sage — gated to SUNLIT, sun-facing leaves so it reads as light
   *   glinting off turning leaves, not a tree-group-wide band.
   * - (B) leafBright: the crown brightens as it leans into the same gust and
   *   dims as it rocks back (centred on the wind sway, so the mean colour is
   *   unchanged) — motion and light agree.
   * Both are lit-pass terms only (the shadow pass draws the crown rigid,
   * `castShadowPositionNode`, and keeps nothing of its colour but the
   * alpha), and they need no extra attribute or buffer upload.
   */
  applyLook: (look: LookValues) => void;
  /** the tile's canopy chunks; `updateVegetationLod` sets their crown tier
   *  over every loaded tile at once */
  chunks: VegetationChunk[];
  group: Group;
  /** whether the look allows the rich crown (the multi-tuft toggle) */
  multiTuft: () => boolean;
  /** advance the wind-sway animation (call per frame with elapsed seconds) */
  setTime: (seconds: number) => void;
  /**
   * Moves the crowns to `day` (days since 1 January; lib/city/tree-season.ts):
   * autumn colour and bare crowns. Called on a date change, never per frame;
   * returns true when any crown changed (the shadow map must then be redrawn).
   */
  setSeason: (day: number) => boolean;
  /** swaps the crowns a layer keeps outside the chunks (the cadastre's own
   *  silhouettes, swapCrownLod); true when any changed (the shadow map must
   *  then be redrawn). The canopy's chunks are `updateVegetationLod`'s. */
  updateLod: (cameraPos: Vector3) => boolean;
}

/**
 * One 250 m chunk of trees: its three crown tiers and the trunks
 * (lib/city/vegetation-lod.ts). The placements fill the first slots of every
 * mesh, the precomputed trees (TreeInstance) the rest.
 */
export interface VegetationChunk {
  far: Instances;
  mid: Instances;
  rich: Instances;
  tier: CrownTier;
  /** crowned trees in the chunk (what the rich-crown budget counts) */
  trees: number;
  trunks: Instances;
}

const nearInverse = new Matrix4();
const nearPoint = new Vector3();

/**
 * How many trees stand within `radius` m (horizontally) of a world (Y-up)
 * point, over the chunks — what the hidden soundscape's leaves rustle with
 * (plan 035). Read at the pose rate while the sound plays, never per frame.
 */
export function treesWithin(
  chunks: readonly VegetationChunk[],
  x: number,
  z: number,
  radius: number
): number {
  let count = 0;
  const r2 = radius * radius;
  for (const chunk of chunks) {
    const mesh = chunk.mid;
    nearInverse.copy(mesh.matrixWorld).invert();
    nearPoint.set(x, 0, z).applyMatrix4(nearInverse);
    const sphere = mesh.geometry.boundingSphere;
    if (
      sphere &&
      Math.hypot(sphere.center.x - nearPoint.x, sphere.center.z - nearPoint.z) >
        sphere.radius + radius
    ) {
      continue;
    }
    const m = mesh.instanceMatrix.array;
    for (let i = 0; i < chunk.trees; i++) {
      const dx = m[i * 16 + 12] - nearPoint.x;
      const dz = m[i * 16 + 14] - nearPoint.z;
      if (dx * dx + dz * dz <= r2) {
        count++;
      }
    }
  }
  return count;
}

/** A canopy or row tree's season: the generic deciduous curve, offset by
 *  a stable hash of its position. */
export function genericSeasonKey(x: number, z: number): CrownSeasonKey {
  return {
    genus: 0,
    evergreen: false,
    jitter: seasonJitter(hash(x * 0.53 + z * 0.29 + 7.1)),
  };
}

/** Runs every chunk's season; true when any changed. */
export function applySeasons(cells: SeasonalCrowns[], day: number): boolean {
  let changed = false;
  for (const cell of cells) {
    changed = cell.apply(day) || changed;
  }
  return changed;
}

/** A chunk's two crown sets; exactly one is visible (swapCrownLod). */
export interface CellLod {
  cheap: Instances;
  rich: Instances;
}

/**
 * Rich crown only near the camera (and only when multi-tuft is enabled);
 * far chunks fall back to the cheap crown. Distance is to the NEAREST tree
 * in the chunk (sphere centre minus radius) with enter/exit hysteresis.
 * Returns true when any chunk swapped (the shadow map must then be redrawn).
 */
export function swapCrownLod(
  cells: CellLod[],
  cameraPos: Vector3,
  multiTuft: boolean
): boolean {
  let changed = false;
  for (const c of cells) {
    const sphere = c.cheap.geometry.boundingSphere;
    const near = sphere
      ? cameraPos.distanceTo(sphere.center) - sphere.radius
      : Number.POSITIVE_INFINITY;
    const wantRich =
      multiTuft && near < (c.rich.visible ? LOD_NEAR_OUT_M : LOD_NEAR_IN_M);
    if (wantRich !== c.rich.visible) {
      changed = true;
    }
    c.rich.visible = wantRich;
    c.cheap.visible = !wantRich;
  }
  return changed;
}

const TREE_SPACING = 9; // metres between trees along a row
const HEDGE_SPACING = 1.1; // metres between hedge segments
/**
 * Edge length (m) of a vegetation chunk. Each chunk is its own Instances set
 * with a tight bounding sphere, so three frustum-culls whole chunks that are
 * behind or beside the camera out of BOTH the main and the shadow pass —
 * instead of the old all-or-nothing "one mesh per tile". Trades a few hundred
 * (mostly-culled) draw calls for a large drop in processed triangles.
 */
export const CHUNK_SIZE = 250;
export const TRUNK_H = 2.4;
const CROWN_R = 2.1;
const HEDGE_H = 1.3;
const HEDGE_W = 0.9;
/** Approx visual height of an unscaled tree; canopy scale = h / this. */
const BASE_TREE_H = 5.8;

/** Deterministic [0,1) jitter so the layer rebuilds identically. */
export function hash(i: number): number {
  const s = Math.sin(i * 12.9898) * 43_758.5453;
  return s - Math.floor(s);
}

export interface Placement {
  /** DOP NDVI 0..1 at this point (lush↔dry crown colour); undefined = no raster */
  ndvi?: number;
  rot: number;
  s: number;
  x: number;
  y: number;
  z: number;
}

/** Resamples every line and drops each point onto the terrain (EPSG -> world). */
function collectPlacements(
  features: VegRowFeature[],
  ctx: VegetationContext,
  ndviAt?: RasterSampler,
  keepTree?: TreeVeto
): { hedges: Placement[]; trees: Placement[] } {
  const { offset } = ctx;
  const trees: Placement[] = [];
  const hedges: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const isHedge = f.properties?.kind === "hedge";
    const pts = samplePolyline(
      f.geometry.coordinates,
      isHedge ? HEDGE_SPACING : TREE_SPACING
    );
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = pts[i];
      if (!isHedge && keepTree && !keepTree(ex, ey)) {
        continue; // an inventory tree stands here
      }
      const ground = ctx.heightAt(ex, ey);
      if (ground === null) {
        continue; // off-tile or NoData
      }
      const seed = ex * 0.13 + ey * 0.07 + i;
      const w = epsgToWorld(ex, ey, offset);
      const place: Placement = {
        x: w.x,
        y: ground,
        z: w.z,
        rot: isHedge ? hash(seed) * 0.3 : hash(seed * 1.7) * Math.PI,
        s: isHedge ? 1 : 0.8 + hash(seed) * 0.6,
        ndvi: ndviAt?.(ex, ey),
      };
      (isHedge ? hedges : trees).push(place);
    }
  }
  return { trees, hedges };
}

/** The CHUNK_SIZE cell a Y-up world position falls in. */
function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}

/** Groups Y-up items into CHUNK_SIZE cells so each becomes its own mesh. */
export function bucketByCell<T extends { x: number; z: number }>(
  items: T[]
): T[][] {
  const cells = new Map<string, T[]>();
  for (const p of items) {
    const key = cellKey(p.x, p.z);
    const cell = cells.get(key);
    if (cell) {
      cell.push(p);
    } else {
      cells.set(key, [p]);
    }
  }
  return [...cells.values()];
}

/** One chunk's trees: the uniform-scale placements plus the precomputed ones. */
interface TreeCell {
  extras: TreeInstance[];
  trees: Placement[];
}

function bucketTrees(trees: Placement[], extras: TreeInstance[]): TreeCell[] {
  const cells = new Map<string, TreeCell>();
  const cellAt = (x: number, z: number): TreeCell => {
    const key = cellKey(x, z);
    let cell = cells.get(key);
    if (!cell) {
      cell = { trees: [], extras: [] };
      cells.set(key, cell);
    }
    return cell;
  };
  for (const p of trees) {
    cellAt(p.x, p.z).trees.push(p);
  }
  for (const e of extras) {
    cellAt(e.x, e.z).extras.push(e);
  }
  return [...cells.values()];
}

/** Writes the placements' matrices from slot 0 on (`widen` stretches the
 *  crown sideways: the far tier's thinned forest). */
function writePlacements(mesh: Instances, items: Placement[], widen = 1): void {
  const dummy = new Object3D();
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.set(p.s * widen, p.s, p.s * widen);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
}

/** Uploads the matrices and fits the cull sphere to the instances. */
function finishInstances(mesh: Instances): void {
  mesh.instanceMatrix.needsUpdate = true;
  // Without this the cull test uses the (origin-centred) geometry sphere and
  // wrongly culls the whole spread-out instance cloud whenever the world
  // origin is off-screen.
  mesh.computeBoundingSphere();
}

function writeInstances(mesh: Instances, items: Placement[]): void {
  writePlacements(mesh, items);
  finishInstances(mesh);
}

/**
 * Lumpy, soft-shaded crown — a single icosphere (detail 2) whose surface is
 * pushed out into a few overlapping lobes, then given RADIAL normals (every
 * vertex normal points out from the crown centre). The lobes break the "green
 * ball" silhouette; the radial normals make light glide over the whole mass as
 * one soft form instead of faceting per triangle. This stays ONE shared
 * geometry (180 tris) — a cheap ~2× over the old icosphere, not the 18× of the
 * sandbox's merged multi-tuft crown (that needs per-distance LOD before it can
 * be afforded across tens of thousands of trees). At `detail` 1 (80 tris) it
 * is the far tier's crown.
 */
export function buildCrownGeo(detail = 2): BufferGeometry {
  const g = new IcosahedronGeometry(CROWN_R, detail);
  const cy = TRUNK_H + CROWN_R * 0.5;
  // Lobe directions: a fuller top, irregular sides, flatter underside.
  const lobes = [
    new Vector3(0, 0.6, 0),
    new Vector3(0.8, 0.25, 0.35),
    new Vector3(-0.7, 0.15, 0.5),
    new Vector3(0.25, 0.5, -0.7),
    new Vector3(-0.45, 0.4, -0.3),
    new Vector3(0.55, -0.05, -0.55),
    new Vector3(-0.2, -0.1, 0.7),
  ].map((v) => v.normalize());
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const v = new Vector3();
  const dir = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    // Bumpy radius: each lobe bulges the surface where the vertex points at it.
    let bulge = 0;
    for (const L of lobes) {
      const d = Math.max(0, dir.dot(L));
      bulge += d * d * 0.34;
    }
    const r = CROWN_R * (0.74 + Math.min(bulge, 0.95));
    v.copy(dir).multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 1.05, 1);
  g.translate(0, cy, 0);
  // Radial normals from the crown centre -> soft, unified shading.
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i) - cy, pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  nrm.needsUpdate = true;
  return g;
}

/**
 * Rich multi-tuft crown for NEAR trees (LOD): a squashed core plus heavily
 * overlapping, elongated lobes merged into one mass, then RADIAL normals. ~18×
 * the cheap crown's triangles, so it is only ever shown within LOD_NEAR_M. ONE
 * shared geometry (fixed seed) — instance rotation hides the repetition.
 */
export function buildCrownGeoRich(): BufferGeometry {
  const cy = TRUNK_H + CROWN_R * 0.5;
  const R = CROWN_R;
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const at = new Vector3();
  const scl = new Vector3();
  const q = new Quaternion();
  const mtx = new Matrix4();
  const parts: BufferGeometry[] = [];
  let k = 0;
  const rnd = () => hash((k++ + 1) * 1.37 + 0.19);

  const core = new IcosahedronGeometry(R * 0.72, 1);
  core.scale(1.1, 0.82, 1.1);
  parts.push(core);

  const addLobes = (
    count: number,
    distLo: number,
    distHi: number,
    radLo: number,
    radHi: number,
    elong: number,
    yLo: number,
    yHi: number
  ): void => {
    for (let i = 0; i < count; i++) {
      const ny = yLo + rnd() * (yHi - yLo);
      dir.set(rnd() * 2 - 1, ny, rnd() * 2 - 1).normalize();
      at.copy(dir).multiplyScalar(R * (distLo + rnd() * (distHi - distLo)));
      at.y += R * 0.06;
      const rad = R * (radLo + rnd() * (radHi - radLo));
      const long = 1 + rnd() * elong; // stretch along the lobe's reach
      scl.set(1 / Math.sqrt(long), long, 1 / Math.sqrt(long));
      q.setFromUnitVectors(up, dir);
      mtx.compose(at, q, scl);
      const b = new IcosahedronGeometry(rad, 1);
      b.applyMatrix4(mtx);
      parts.push(b);
    }
  };
  addLobes(5, 0.24, 0.44, 0.5, 0.66, 0.4, -0.3, 1.15); // big fused lobes
  addLobes(4, 0.34, 0.52, 0.4, 0.54, 0.35, -0.7, 0.05); // low skirt
  addLobes(8, 0.46, 0.66, 0.24, 0.34, 0.3, -0.15, 1.05); // silhouette bumps

  const merged = mergeGeometries(parts);
  if (!merged) {
    return buildCrownGeo(); // attributes always match here; fall back defensively
  }
  merged.scale(1, 1.04, 1);
  merged.translate(0, cy, 0);
  const pos = merged.attributes.position;
  const nrm = merged.attributes.normal;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i) - cy, pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  nrm.needsUpdate = true;
  return merged;
}

/** The value-noise hash (a smoothed lattice of sin hashes). */
function leafHash(p: V2): F {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43_758.5453));
}

/**
 * Cheap value noise (smoothed hash lattice), 0..1: the crowns' leaf
 * twinkle and the hedges' foliage mottle (low-vegetation-layer.ts) — small,
 * irregular specks instead of a clean rolling sine band.
 */
export function leafNoise(p: V2): F {
  const i = floor(p);
  const f0 = fract(p);
  const f = f0.mul(f0).mul(f0.mul(-2).add(3));
  return mix(
    mix(leafHash(i), leafHash(i.add(vec2(1, 0))), f.x),
    mix(leafHash(i.add(vec2(0, 1))), leafHash(i.add(vec2(1, 1))), f.x),
    f.y
  );
}

/** The crown's live uniform nodes, shared by every crown material of the
 *  scene (the look writes them, the loop the clock). */
export interface CrownUniforms {
  leafBright: Live;
  leafFlutter: Live;
  shimmer: Live;
  /** world-space surface → sun; its value is the sun rig's vector, by
   *  reference (sceneCrowns) */
  sunDirection: UniformNode<"vec3", Vector3>;
  /** the wind-sway clock (s) */
  time: Live;
  translucency: Live;
}

/** Fresh crown uniforms at the look table's defaults. */
function createCrownUniforms(): CrownUniforms {
  return {
    leafBright: uniform(LOOK_DEFAULTS.leafBright),
    leafFlutter: uniform(LOOK_DEFAULTS.leafFlutter),
    shimmer: uniform(LOOK_DEFAULTS.shimmer),
    sunDirection: uniform(new Vector3(0, 1, 0)),
    time: uniform(0),
    translucency: uniform(LOOK_DEFAULTS.translucency),
  };
}

/** A column of the drawn instance's matrix (`m · eᵢ`; identity off a set). */
const instanceColumn = (i: number): V4 =>
  instanceMatrix().mul(
    vec4(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0)
  );

/**
 * The wind sway: the crown bent in its own space, before the instance
 * transform — stiff at the base (where it meets the trunk) and loose at the
 * top. The per-tree phase comes from the instance's world column (its
 * matrix's translation, xz) so neighbours sway out of step — a free,
 * stable seed with no extra attribute or buffer upload. Crowns live in the
 * Y-up scene, so local Y is already up. Returns the bent vertex and the
 * centred gust signal (the brightness pulse rides on it).
 */
function crownSway(time: Live): { gust: F; local: V3 } {
  const phase = dot(instanceColumn(3).xz, vec2(0.07, 0.11));
  const k0 = clamp(positionGeometry.y.div(7), 0, 1);
  const k = k0.mul(k0).mul(0.16);
  const gust = sin(time.mul(0.38).add(phase)).add(
    sin(time.mul(0.8).add(phase.mul(1.7))).mul(0.5)
  );
  const side = sin(time.mul(0.31).add(phase).add(1.7)).mul(0.6);
  return {
    gust,
    local: positionGeometry.add(vec3(gust.mul(k), 0, side.mul(k))),
  };
}

/**
 * The crown's light terms (all in world space, off the swayed fragment's
 * `positionWorld`): the backlit shimmer, the translucency, the leaf
 * twinkle and the sway-coupled brightness. `base` is the crown's own
 * colour (tint, twigs); returns the lit colour and the emissive glow.
 *
 * The shimmer and translucency glow where the sun is behind the canopy.
 * The GLSL crown gated both, and the twinkle, on the sun's shadow map
 * sampled 2 m toward the sun (so a building behind the tree killed the
 * glow while the crown's own self-shadow did not). Node lights keep their
 * shadow map to themselves: r186's public TSL offers only `shadow(light)`,
 * which builds a second shadow node that renders its own map, and the
 * scene's shadow node is the light node's, reachable only from inside the
 * lighting pass. So the gate is the daylight ramp alone — the sun's own
 * intensity ramp (sun-rig.ts, `clamp(sun.y · 5)`), so the glow fades out
 * with the sun instead of lingering into the night; a crown behind a
 * building now glows too.
 */
function crownLight(
  u: CrownUniforms,
  base: V3,
  gust: F,
  crownScale: F
): { colour: V3; emissive: V3 } {
  const sun = u.sunDirection;
  const t = u.time;
  const shimVis = clamp(sun.y.mul(5), 0, 1);
  const daylight = clamp(sun.y, 0, 1);
  const view = normalize(cameraPosition.sub(positionWorld));
  const back = clamp(dot(view, sun.negate()), 0, 1);
  const far = distance(cameraPosition, positionWorld);
  const shimmer = u.shimmer
    .mul(pow(back, 3.6))
    .mul(shimVis)
    .mul(vec3(0.95, 0.85, 0.45));
  // Backlit translucency: a BROADER subsurface glow (low exponent) with the
  // same gate, limited to near OR large crowns and to daytime so it never
  // reads as far-field "noise".
  const trLarge = smoothstep(1.2, 3, crownScale);
  const trNear = float(1).sub(smoothstep(120, 260, far));
  const translucency = u.translucency
    .mul(pow(back, 1.6))
    .mul(shimVis)
    .mul(max(trLarge, trNear).mul(daylight))
    .mul(vec3(0.45, 0.62, 0.3));
  // (A) Leaf twinkle — small, irregular bright specks where wind flips
  // leaves to their pale underside. World-space value noise at ~1-2 m cells
  // (two octaves + drift) keeps each speck leaf-clump-sized and noisy, NOT a
  // tree-group-wide band; the height offset stops them forming vertical
  // columns. Gated to daylight, sun-facing (N·L) leaves and faded with
  // distance so far crowns don't crawl. Blends the crown's OWN colour
  // toward a paler silver-sage + a faint glint, in the diffuse colour, so
  // it still shades naturally.
  const leafUV = positionWorld.xz.add(positionWorld.y.mul(vec2(0.7, 0.5)));
  const twk = leafNoise(leafUV.mul(1.2).add(vec2(t.mul(0.7), t.mul(0.45)))).add(
    leafNoise(leafUV.mul(2.8).sub(vec2(t.mul(1.1), t.mul(0.8)))).mul(0.6)
  );
  const sunFace = clamp(dot(normalWorldGeometry, sun), 0, 1);
  const twDist = float(1).sub(smoothstep(150, 420, far).mul(0.7));
  const twinkle = smoothstep(0.95, 1.45, twk)
    .mul(shimVis)
    .mul(daylight)
    .mul(sunFace.mul(0.7).add(0.3))
    .mul(twDist);
  const luma = dot(base, vec3(0.299, 0.587, 0.114));
  const under = mix(base, vec3(luma.mul(1.25).add(0.06)), 0.6);
  const flipped = mix(base, under, clamp(u.leafFlutter.mul(twinkle), 0, 1));
  const glint = u.leafFlutter
    .mul(twinkle)
    .mul(0.14)
    .mul(vec3(0.9, 0.95, 0.6));
  // (B) Sway-coupled brightness — the SAME centred gust signal that bends
  // the geometry, so the whole crown brightens leaning in and dims rocking
  // back; centred so the average colour is unchanged.
  return {
    colour: flipped.mul(u.leafBright.mul(gust).mul(0.18).add(1)),
    emissive: shimmer.add(translucency).add(glint),
  };
}

/**
 * Sage crown material with a backlit shimmer: when the sun is behind the
 * canopy the camera-facing leaves glow warm (crownLight). Shared by every
 * crown set of the scene, every tier (sceneCrowns). The uniforms are live:
 * writing `shimmer.value` retunes without a rebuild. `bare` builds the
 * seasonal variant: the per-instance leaf cover thins the crown to twigs
 * (crown-season.ts) through `maskNode`, which the shadow pass honours, so
 * the thinned crown thins its shadow too; a chunk wears it only while any
 * of its crowns is out of full leaf, so the summer crown keeps early depth
 * testing. The cast shadow stays rigid (`castShadowPositionNode`): the sun
 * rig only redraws the shadow map on a move — accepted, invisible at this
 * scale.
 */
export function buildCrownMaterial(
  u: CrownUniforms,
  bare = false
): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    color: CROWN_BASE_COLOR,
    roughness: 1,
  });
  m.name = bare ? "crown-bare" : "crown-leafy";
  m.userData.crownUniforms = u;
  const sway = crownSway(u.time);
  m.positionNode = instancePosition(sway.local);
  m.castShadowPositionNode = instancePosition();
  const crownScale = varying(length(instanceColumn(0).xyz));
  const gust = varying(sway.gust);
  const tinted = materialColor.mul(instanceTint());
  if (!bare) {
    const lit = crownLight(u, tinted, gust, crownScale);
    m.colorNode = lit.colour;
    m.emissiveNode = lit.emissive;
    return m;
  }
  const season = crownSeasonNodes();
  m.maskNode = season.keep;
  const lit = crownLight(
    u,
    mix(tinted, season.twigColour, season.twig),
    gust,
    crownScale
  );
  m.colorNode = lit.colour;
  // Twigs of a bare crown neither shimmer nor glow.
  m.emissiveNode = lit.emissive.mul(float(1).sub(season.twig));
  return m;
}

/**
 * De-sterilised trunk — a tapered cylinder with (1) a root flare at the base,
 * (2) low-amplitude radial "bark" bumps and (3) a gentle fixed lean. One shared
 * geometry across all instances (per-tree variety comes from instance rotation
 * + scale); branches were dropped here because, shared, they'd repeat
 * identically — they belong on a near-distance LOD crown.
 */
export function buildTrunkGeo(): BufferGeometry {
  // The profile (rows, taper, flare) is lib/city/tree-inventory.ts's, so a
  // measured trunk is fitted to the radius drawn (`trunkRadiusAt`).
  const t = new CylinderGeometry(
    TRUNK_TOP_R,
    TRUNK_FOOT_R,
    TRUNK_H,
    7,
    TRUNK_ROWS
  );
  t.translate(0, TRUNK_H / 2, 0);
  const bend = 0.05 * TRUNK_H;
  const bx = 0.82;
  const bz = 0.57;
  const pos = t.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const tt = Math.min(Math.max(v.y / TRUNK_H, 0), 1);
    const r = Math.hypot(v.x, v.z);
    const ang = Math.atan2(v.z, v.x);
    if (r > 1e-4) {
      const flare = trunkFlare(tt);
      const bump = 1 + (hash(ang * 2.4 + v.y * 1.7) - 0.5) * 0.2;
      const nr = r * flare * bump;
      v.x = Math.cos(ang) * nr;
      v.z = Math.sin(ang) * nr;
    }
    const k = tt ** 1.4 * bend;
    v.x += bx * k;
    v.z += bz * k;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  t.computeVertexNormals();
  return t;
}

/**
 * Trunk material with a gentle vertical value gradient (darker rooted
 * base), from the geometry's own height (before the instance scale).
 * Scene-wide: it carries nothing of a tile.
 */
export function buildTrunkMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("vegetation-trunk", () => {
    const m = new MeshStandardNodeMaterial({ color: 0x8a_7c_68, roughness: 1 });
    m.name = "trunk";
    m.positionNode = instancePosition();
    const tg = clamp(varying(positionGeometry.y).div(TRUNK_H), 0, 1);
    m.colorNode = materialColor.mul(mix(0.74, 1.05, smoothstep(0, 0.6, tg)));
    return m;
  });
}

/**
 * Per-tree crown colour. `v` is the deterministic hash jitter (keeps neighbours
 * distinct). Without NDVI it's the original pastel sage; with it, the DOP
 * greenness shifts the crown dry pale-sage → lush deep green, so a vigorous
 * park reads richer than a stressed street tree.
 */
export function crownColor(col: Color, p: Placement, v: number): void {
  if (p.ndvi === undefined) {
    col.setHSL(0.26 + v * 0.05, 0.27, 0.62 + v * 0.12);
    return;
  }
  // The DOP NDVI raster is globally muted (5×5-sampled median ~0.28), so remap
  // about that low centre — not a textbook 0.3..0.7 — or every tree clamps to
  // "dry" and the variation is invisible. This spreads the real per-tree spread
  // across the full lushness range while staying in the soft watercolour palette.
  const t = Math.min(Math.max((p.ndvi - 0.1) / 0.45, 0), 1);
  col.setHSL(
    0.19 + 0.1 * t + v * 0.04, // dry yellow-green → lush green
    0.14 + 0.26 * t, // pale sage → richer green
    0.68 - 0.16 * t + v * 0.1 // light → deeper
  );
}

/** Deterministic per-tree crown variation (hash jitter + optional NDVI);
 *  the precomputed trees bring their own colour, after the placements. */
function paintCrowns(
  crowns: Instances,
  cell: Placement[],
  extras: TreeInstance[] = []
): void {
  const col = new Color();
  for (let i = 0; i < cell.length; i++) {
    const v = hash(cell[i].x * 0.3 + cell[i].z * 0.7) - 0.5;
    crownColor(col, cell[i], v);
    crowns.setColorAt(i, col);
  }
  extras.forEach((e, i) => {
    if (e.crown) {
      crowns.setColorAt(cell.length + i, e.crown.colour);
    }
  });
  if (crowns.instanceTints) {
    crowns.instanceTints.needsUpdate = true;
  }
}

/** The shared crown and trunk geometries of every chunk. */
interface TreeGeos {
  far: BufferGeometry;
  mid: BufferGeometry;
  rich: BufferGeometry;
  trunk: BufferGeometry;
}

/** A crown set over the placements and the crowned precomputed trees. */
function crownMesh(
  geo: BufferGeometry,
  material: Material,
  trees: Placement[],
  crowned: TreeInstance[],
  which: "cheap" | "rich",
  widen = 1
): Instances {
  const mesh = new Instances(geo, material, trees.length + crowned.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  writePlacements(mesh, trees, widen);
  crowned.forEach((e, i) => {
    if (e.crown) {
      mesh.setMatrixAt(trees.length + i, e.crown[which]);
    }
  });
  finishInstances(mesh);
  paintCrowns(mesh, trees, crowned);
  return mesh;
}

/**
 * One chunk's sets: a trunk per tree, and — when the chunk has any crown
 * — the mid, rich and far crowns (one is visible; updateVegetationLod
 * picks). A chunk without precomputed trees (every forest chunk) lets the
 * trunks and both near crowns share ONE matrix buffer and the crowns one
 * tint buffer, on the CPU and, since GPU buffers are keyed by the buffer,
 * on the GPU (one upload): a forest tile's vegetation takes ~9 MB of
 * instance data instead of ~21 MB. A precomputed tree has a matrix of its
 * own for each set, so its chunk keeps separate buffers.
 */
function buildTreeCell(
  cell: TreeCell,
  geos: TreeGeos,
  trunkMat: Material,
  crownMats: CrownMaterials
): {
  chunk: VegetationChunk | null;
  meshes: Instances[];
  season: SeasonalCrowns | null;
} {
  const crownMat = crownMats.leafy;
  const { trees, extras } = cell;
  const trunks = new Instances(
    geos.trunk,
    trunkMat,
    trees.length + extras.length
  );
  trunks.castShadow = true;
  const crowned = extras.filter((e) => e.crown);
  if (trees.length + crowned.length === 0) {
    extras.forEach((e, i) => trunks.setMatrixAt(i, e.trunk));
    finishInstances(trunks);
    return { chunk: null, meshes: [trunks], season: null };
  }
  const mid = crownMesh(geos.mid, crownMat, trees, crowned, "cheap");
  let rich: Instances;
  if (extras.length === 0) {
    rich = new Instances(geos.rich, crownMat, trees.length);
    rich.castShadow = true;
    rich.receiveShadow = true;
    trunks.instanceMatrix = mid.instanceMatrix;
    rich.instanceMatrix = mid.instanceMatrix;
    rich.instanceTints = mid.instanceTints;
    // Each set fits its own geometry into the shared matrices.
    trunks.computeBoundingSphere();
    rich.computeBoundingSphere();
  } else {
    rich = crownMesh(geos.rich, crownMat, trees, crowned, "rich");
    writePlacements(trunks, trees);
    extras.forEach((e, i) => trunks.setMatrixAt(trees.length + i, e.trunk));
    finishInstances(trunks);
  }
  // The far tier: every other tree of a dense chunk, drawn wider (see
  // keepInFarTier), so a forest stays a closed canopy far away.
  const farTrees = trees.filter((_, i) => keepInFarTier(i, trees.length));
  const far = crownMesh(
    geos.far,
    crownMat,
    farTrees,
    crowned,
    "cheap",
    farTrees.length < trees.length ? FAR_THIN_WIDEN : 1
  );
  // updateVegetationLod() picks the tier each frame; start on mid.
  rich.visible = false;
  far.visible = false;
  // Same order as the slots: the placements, then the precomputed crowns.
  const keys = [
    ...trees.map((p) => genericSeasonKey(p.x, p.z)),
    ...crowned.map((e) => e.crown?.season ?? genericSeasonKey(e.x, e.z)),
  ];
  const farSlots = [
    ...trees.flatMap((_, i) => (keepInFarTier(i, trees.length) ? [i] : [])),
    ...crowned.map((_, k) => trees.length + k),
  ];
  return {
    chunk: {
      far,
      mid,
      rich,
      tier: "mid",
      trees: trees.length + crowned.length,
      trunks,
    },
    meshes: [trunks, mid, rich, far],
    season: seasonCrowns({ far, farSlots, mid, rich }, keys, crownMats),
  };
}

/** The scene's crown materials and their uniforms (sceneCrowns). */
export interface SceneCrowns extends CrownMaterials {
  uniforms: CrownUniforms;
}

/**
 * The plain crown material and its seasonal (bare-crown) variant, one pair
 * for the whole scene (`sceneMaterial`: three keys a build by material and
 * attribute layout, so every tile's crowns share one build, in the scene
 * and the shadow pass). The uniforms are made with the plain crown and ride
 * on it (`userData.crownUniforms`), so they go — and come back at the
 * look's defaults — with the scene's materials. `sunDirection`, when given,
 * becomes the sun uniform's value (by reference, so the sun rig's in-place
 * writes are live); the latest app's vector wins across a remount.
 */
export function sceneCrowns(sunDirection?: Vector3): SceneCrowns {
  const leafy = sceneMaterial("vegetation-crown-leafy", () =>
    buildCrownMaterial(createCrownUniforms(), false)
  );
  const u = leafy.userData.crownUniforms as CrownUniforms;
  const bare = sceneMaterial("vegetation-crown-bare", () =>
    buildCrownMaterial(u, true)
  );
  if (sunDirection) {
    u.sunDirection.value = sunDirection;
  }
  return { leafy, bare, uniforms: u };
}

/**
 * The crown programs a date change may switch to, for the scene to compile
 * once ahead of time (crown-season.ts `crownWarmup`): a crown geometry
 * wearing each of the scene's two crown materials, laid out as a tile's
 * crown sets are (the uniforms' values do not reach the build).
 */
export function buildCrownWarmup(): CrownWarmup {
  return crownWarmup(buildCrownGeo(), sceneCrowns());
}

function buildTrees(
  trees: Placement[],
  extras: TreeInstance[],
  crownMats: CrownMaterials
): {
  chunks: VegetationChunk[];
  meshes: Instances[];
  seasons: SeasonalCrowns[];
} {
  // Geometry is shared across all of the tile's chunks, the materials
  // across the scene; only the per-chunk instance buffers differ, so this
  // stays cheap to allocate.
  const geos: TreeGeos = {
    far: buildCrownGeo(1),
    mid: buildCrownGeo(),
    rich: buildCrownGeoRich(),
    trunk: buildTrunkGeo(),
  };
  const trunkMat = buildTrunkMaterial();

  const meshes: Instances[] = [];
  const chunks: VegetationChunk[] = [];
  const seasons: SeasonalCrowns[] = [];
  for (const cell of bucketTrees(trees, extras)) {
    const built = buildTreeCell(cell, geos, trunkMat, crownMats);
    meshes.push(...built.meshes);
    if (built.chunk) {
      chunks.push(built.chunk);
    }
    if (built.season) {
      seasons.push(built.season);
    }
  }
  // The crown and trunk materials are scene-wide: a tile's disposal
  // (disposeObject3D) frees its sets' geometry views and leaves them.
  return { chunks, meshes, seasons };
}

/** The ATKIS row hedges' material (scene-wide: nothing of a tile). */
function rowHedgeMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("vegetation-row-hedge", () => {
    const m = new MeshStandardNodeMaterial({ color: 0x55_6b_3e, roughness: 1 });
    m.name = "row-hedge";
    m.positionNode = instancePosition();
    return m;
  });
}

function buildHedges(hedges: Placement[]): Instances[] {
  const geo = new BoxGeometry(HEDGE_W, HEDGE_H, HEDGE_W * 1.4);
  geo.translate(0, HEDGE_H / 2, 0);
  const mat = rowHedgeMaterial();
  const meshes: Instances[] = [];
  for (const cell of bucketByCell(hedges)) {
    const mesh = new Instances(geo, mat, cell.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    writeInstances(mesh, cell);
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Loads the DOP NDVI PNG into a CPU sampler (EPSG → 0..1). The bytes are
 * inflated as written (lib/city/png-raster.ts), never through the browser's
 * image decoder, which colour-manages untagged greyscale on WebKit. Returns
 * null on any failure (no raster, decode error) so crowns fall back to the
 * hash-only sage — graceful degradation, see docs/portability.md.
 */
export async function loadNdviSampler(
  url: string,
  bounds: TerrainBounds,
  signal?: AbortSignal
): Promise<RasterSampler | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return null;
    }
    const png = new Uint8Array(await res.arrayBuffer());
    return maxWindowSampler(await decodeGreyPng(png), bounds);
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/** Canopy points (DOM1-derived) → height-scaled tree placements. */
function collectCanopy(
  features: CanopyFeature[],
  ctx: VegetationContext,
  ndviAt?: RasterSampler,
  keepTree?: TreeVeto
): Placement[] {
  const { offset } = ctx;
  const out: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point") {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    if (keepTree && !keepTree(ex, ey, f.properties?.h)) {
      continue; // an inventory tree stands here
    }
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    // A point missing a numeric `h` (only the TS type, not the JSON, promises
    // one) would make scale NaN; Math.max/min don't clamp NaN, so the NaN
    // matrix poisons the chunk's bounding sphere and the whole cell culls.
    const rawH = f.properties?.h ?? Number.NaN;
    const h = Number.isFinite(rawH) ? rawH : BASE_TREE_H;
    const seed = ex * 0.13 + ey * 0.07;
    const w = epsgToWorld(ex, ey, offset);
    out.push({
      x: w.x,
      y: ground,
      z: w.z,
      rot: hash(seed * 1.7) * Math.PI,
      // Scale the whole tree to the measured canopy height (± a touch).
      s: Math.min(Math.max(h / BASE_TREE_H, 0.5), 7) * (0.9 + hash(seed) * 0.2),
      ndvi: ndviAt?.(ex, ey),
    });
  }
  return out;
}

/**
 * Builds stylized vegetation from the ATKIS veg04 rows GeoJSON (hedges + tree
 * rows) and, when given, the DOM1-derived canopy GeoJSON (area trees scaled to
 * their measured height). Everything is drawn with `Instances` sets so tens of
 * thousands of plants stay cheap; each is dropped onto the terrain via
 * `heightAt` and points off the tile are skipped. Empty inputs yield an empty
 * group; the sets are freed with the scene (disposeObject3D), the
 * scene-wide materials with the last app.
 */
export function buildVegetation(
  features: VegetationFeatures,
  ctx: VegetationContext
): VegetationControl {
  const group = new Group();
  group.name = "vegetation";

  // The crown uniforms are the scene's (sceneCrowns): every tile's control
  // writes the same nodes — the look's rows and the wind clock, which the
  // render loop advances once per frame (same elapsed seconds as the water
  // ripple).
  const crownMats = sceneCrowns(ctx.sunDirection);
  const u = crownMats.uniforms;
  // The crown uniform each vegetation row drives — a Record over the keys, so
  // a row added to the table cannot go unapplied.
  const rowUniform: Record<VegetationLookKey, Live> = {
    leafBright: u.leafBright,
    leafFlutter: u.leafFlutter,
    shimmer: u.shimmer,
    translucency: u.translucency,
  };
  let multiTuft = LOOK_DEFAULTS.multiTuft;
  let chunks: VegetationChunk[] = [];
  let seasons: SeasonalCrowns[] = [];

  const { ndviAt, keepTree } = features;
  const { trees, hedges } = collectPlacements(
    features.rows,
    ctx,
    ndviAt,
    keepTree
  );
  trees.push(...collectCanopy(features.canopy, ctx, ndviAt, keepTree));
  const extras = features.extraTrees ?? [];
  if (trees.length + extras.length > 0) {
    const built = buildTrees(trees, extras, crownMats);
    group.add(...built.meshes);
    chunks = built.chunks;
    seasons = built.seasons;
  }
  if (hedges.length > 0) {
    group.add(...buildHedges(hedges));
  }

  return {
    group,
    chunks,
    applyLook: (look) => {
      for (const key of Object.keys(rowUniform) as VegetationLookKey[]) {
        rowUniform[key].value = look[key];
      }
      multiTuft = look.multiTuft;
    },
    multiTuft: () => multiTuft,
    setTime: (seconds) => {
      u.time.value = seconds;
    },
    setSeason: (day) => applySeasons(seasons, day),
    // The chunks' tiers are updateVegetationLod's; the canopy keeps no other
    // crowns.
    updateLod: () => false,
  };
}

/** Metres from `cameraPos` to the chunk's nearest tree (sphere centre minus radius). */
function nearestTree(chunk: VegetationChunk, cameraPos: Vector3): number {
  const sphere = chunk.mid.geometry.boundingSphere;
  return sphere
    ? Math.max(cameraPos.distanceTo(sphere.center) - sphere.radius, 0)
    : Number.POSITIVE_INFINITY;
}

function showTier(chunk: VegetationChunk, tier: CrownTier): void {
  chunk.tier = tier;
  chunk.rich.visible = tier === "rich";
  chunk.mid.visible = tier === "mid";
  chunk.far.visible = tier === "far";
  // A trunk 550 m out is below a pixel; the far tier drops it.
  chunk.trunks.visible = tier !== "far";
}

/**
 * Picks every loaded chunk's crown tier at once (lib/city/vegetation-lod.ts):
 * the rich-crown budget is shared by the whole site, not granted per tile.
 * Returns true when any chunk changed — what casts shadows changed, so the
 * shadow map must be redrawn.
 */
export function updateVegetationLod(
  controls: readonly VegetationControl[],
  cameraPos: Vector3
): boolean {
  const all: VegetationChunk[] = [];
  const states: ChunkLodState[] = [];
  for (const control of controls) {
    const allowRich = control.multiTuft();
    for (const chunk of control.chunks) {
      all.push(chunk);
      states.push({
        allowRich,
        current: chunk.tier,
        near: nearestTree(chunk, cameraPos),
        trees: chunk.trees,
      });
    }
  }
  const tiers = planCrownTiers(states);
  let changed = false;
  for (let i = 0; i < all.length; i++) {
    if (tiers[i] !== all[i].tier) {
      showTier(all[i], tiers[i]);
      changed = true;
    }
  }
  return changed;
}
