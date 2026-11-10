import { ContentFetchPlugin } from "./tile-content-fetch";
import { DownloadPriorityQueue, PriorityQueue } from "3d-tiles-renderer/core";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { Group, Matrix4 } from "three/webgpu";
import type {
  BufferGeometry,
  Camera,
  Color,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  UniformNode,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
// (lower case: rules-of-hooks reads `Pascal.useX` as a React hook)
import { MeshoptDecoder as meshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyExtraFeature,
  CultivatedFeature,
  FurnitureFeature,
  MapillaryFeature,
  LampFeature,
  LowVegFeature,
  MonumentFeature,
  RailFeature,
  RiversideFeature,
  TrafficFeature,
  TramFeature,
  TreeFeature,
  VegRowFeature,
} from "@/lib/city/features";
import { orchardTrees, vineRows } from "@/lib/city/cultivated";
import type { LookValues } from "@/lib/city/look-controls";
import {
  pointFeatures,
  ROWS_MEASURED,
  unpackPoints,
} from "@/lib/city/point-pack";
import { sportFixtures } from "@/lib/city/sport";
import type { SportTable } from "@/lib/city/sport";
import { offMonuments, plantedRows } from "@/lib/city/tree-placement";
import type { TreeVeto } from "@/lib/city/tree-placement";
import { coarseCrownsStandIn, unpackCrowns } from "@/lib/city/coarse-crowns";
import {
  keepOrder,
  siteTileOfTile,
  streamOrder,
} from "@/lib/city/stream-order";
import type { OrderedTile } from "@/lib/city/stream-order";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { ownsPoint } from "@/lib/city/tileset";
import type {
  CityExtras,
  ContentExtras,
  TerrainExtras,
} from "@/lib/city/tileset";
import { COARSE_DRESSING_KINDS } from "@/lib/city/tile";
import type { DressingKind } from "@/lib/city/tile";
import {
  bridgeItems,
  monumentItems,
  moreSetsSteps,
  treeSets,
} from "@/lib/city/ask-items";
import { askSets } from "@/lib/city/ask-solids";
import type { AskSet } from "@/lib/city/ask-solids";
import { isAllocationFailure } from "@/lib/city/gpu-allocation";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import { mapillaryParts } from "@/lib/city/mapillary";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { dressCity } from "./city-layer";
import type { CityLayer } from "./city-layer";
import { GltfContentPlugin } from "./gltf-content";
import type { FacadeReadings } from "@/lib/city/facade-reading";
import { coarseCrownSteps } from "./coarse-crowns-layer";
import type { CrownWarmup } from "./crown-season";
import { buildVineyards } from "./cultivated-layer";
import {
  eitherSignal,
  fetchFeatures,
  fetchOptionalBinary,
  fetchOptionalJson,
} from "./fetch-optional";
import { furnitureSteps } from "./furniture-layer";
import { buildLamps } from "./lamp-layer";
import { LAMP_TRACK_REACH_M } from "./lamp-reflections";
import { nearLines } from "@/lib/city/near-lines";
import { isMonorail } from "@/lib/city/line-levels";
import type { LampControl } from "./lamp-layer";
import { buildLowVegetation } from "./low-vegetation-layer";
import { buildMonuments } from "./monument-layer";
import type { MonumentLayer } from "./monument-layer";
import { buildMurals } from "./mural-layer";
import type { MuralLayer, MuralSource } from "./mural-layer";
import type { Mural } from "@/lib/city/murals";
import { railSteps } from "./rail-layer";
import { bridgeAskSet } from "./bridge-ask";
import { buildRiverside } from "./riverside-layer";
import { buildSportFixtures } from "./sport-fixtures";
import type { SportFixtureLayer } from "./sport-fixtures";
import { cpuDroppable, createGridShare, dressTerrain } from "./terrain-layer";
import type { GridShare, GroundUniforms, TerrainLayer } from "./terrain-layer";
import { dressFences } from "./fence-layer";
import { dressKerbs } from "./kerb-layer";
import { setRasterTier } from "./raster-upload";
import type { DeviceTier } from "./scene-profile";
import { createTileRasters } from "./tile-rasters";
import type { RasterHold, TileRasters } from "./tile-rasters";
import { dressStairs } from "./stair-layer";
import {
  createLateLane,
  createLateParts,
  withinCompileWait,
  withinWait,
} from "./late-parts";
import type {
  Compiled,
  LateHandle,
  LateHost,
  LateLane,
  LatePart,
  LateParts,
} from "./late-parts";
import { streamTimings } from "./stream-timing";
import { whenIdle } from "./main-yield";
import { bvhBytesUnder } from "./collision";
import {
  finished,
  giveBack,
  inSlices,
  onlyWhile,
} from "@/lib/city/build-steps";
import type { Steps } from "@/lib/city/build-steps";
import {
  compileRepresentatives,
  cpuArrayBytes,
  detachSceneShared,
  disposeGeometry,
  disposeObject3D,
  dropCpuCopies,
  estimateGeometryBytes,
  sceneSharedBytes,
  trackedBytesOf,
} from "./three-utils";
import type { AnyAttribute } from "./three-utils";
import type { TrafficBuilder } from "./data-layers-feature";
import type { TrafficDetail } from "./traffic-layer";
import { tramSteps } from "./tram-layer";
import { treeInventorySteps } from "./tree-inventory-layer";
import {
  buildCrownWarmup,
  vegetationSteps,
  loadNdviSampler,
} from "./vegetation-layer";
import type {
  VegetationContext,
  VegetationControl,
  VegetationFeatures,
} from "./vegetation-layer";
import { footMaterialFor } from "./tree-foot";
import { follow } from "./feature-seam";
import type { Watch } from "./feature-seam";
import type { DressingEnvironment } from "./scene-environment";
import { setClaySkyView } from "./visual-style";
import type { StyleResources } from "./visual-style";
import { dressWalls } from "./wall-layer";

/**
 * The world as it streams in: OGC 3D Tiles (lib/city/tileset.ts) through
 * 3DTilesRendererJS, which decides what to load and unload from the cameras,
 * the screen-space error and a memory budget. This module only dresses what
 * lands — the terrain material, water, buildings, vegetation (canopy,
 * street-tree cadastre, laser-scan trees, hedges), lamps, monuments, street
 * furniture, rails, walls — and undresses what leaves, so every tile is one
 * handle whose content comes and goes with it. What lands on a content
 * root after the root itself — a terrain level's dressing, a city tile's
 * murals, a data layer's traffic bodies — it hands to late-parts.ts as
 * late parts (`dressingPart`, `muralsPart`, `trafficSlot`): one lifecycle
 * that builds, compiles, weighs, hangs and frees each.
 */
export interface TileDressing {
  /** the trees, monuments and bridge decks the inquiry probe can ask
   *  (lib/city/ask-items.ts; plan 052 phase 4): data, nothing drawn */
  asks?: AskSet<FeatureInquiry>[];
  /** fills `asks` (the same array) — in idle time once the dressing hangs
   *  (`dressingPart`), not on its critical path: a card
   *  nobody may open placed every canopy tree a second time inside the
   *  dressing's build. Gone once it has run. */
  buildAsks?: Steps<void>;
  furniture?: Group;
  lamps?: LampControl;
  /** the hedges, OSM's and the DLM's (low-vegetation-layer.ts): static,
   *  no per-frame work */
  lowVegetation?: Group;
  monuments?: MonumentLayer;
  rail?: Group;
  sport?: SportFixtureLayer;
  tile: string;
  /** OSM trams: tracks, masts, the overhead line (tram-layer.ts) */
  tram?: Group;
  /** the Elbe's landing stages, groynes, ferry lines (riverside-layer.ts) */
  riverside?: Group;
  /** the counted motor traffic (traffic-layer.ts): a data layer, its
   *  bodies built on the first switch-on (`TrafficSlot`) */
  traffic?: TrafficSlot;
  /** lets go of the scene environment it follows from its birth
   *  (`followEnvironment`); `disposeDressing` calls it first */
  unfollow?: () => void;
  vegetation?: VegetationControl;
  /** vine rows (cultivated-layer.ts): static */
  vineyards?: Group;
}

/**
 * Where a tile's traffic bodies go once its dressing hangs on the tile
 * (`dressingPart`): they are a late part of the same content root, owned
 * by the dressing (they go when it goes).
 */
export interface TrafficTile {
  /** the look store: the bodies show while the layer is on, from the
   *  hang on (`TrafficSlot.attach` follows it) */
  look: Watch<Pick<LookValues, "trafficLayer">>;
  /** the content root's late parts (late-parts.ts) */
  parts: LateParts;
  /** the dressing's handle: the bodies go with it */
  owner: LateHandle;
  /** the content root the bodies hang under (the Y-up scene frame) */
  root: Object3D;
}

/**
 * The counted traffic of a tile (traffic-layer.ts): its features at once,
 * its bodies built on the first switch-on and freed with the dressing — a
 * data layer costs nothing while it is off, like the bicycle columns and
 * the trams (data-overlays.ts).
 */
export interface TrafficSlot {
  /** the bodies, once built and compiled (null before; kept while the
   *  layer is off again) */
  group: Group | null;
  /** builds the bodies on the first call (in a task of its own, once the
   *  dressing hangs on its tile) and shows them; resolves once they show,
   *  or once there is nothing to show */
  show: () => Promise<void>;
  /** hides the bodies (keeps them: a second switch-on is instant) */
  hide: () => void;
  /** the ask set for the probe, once the bodies are built */
  asks: () => AskSet<FeatureInquiry> | null;
  /** the tile the bodies will hang on (`dressingPart`, as it hangs):
   *  from now on they show and hide with the look's layer (its value of
   *  now first), until `dispose` */
  attach: (tile: TrafficTile) => void;
  /** frees the bodies — once their compile has ended, if one still runs
   *  (three cannot stop it, and one that resumes on freed buffers uploads
   *  them again); a show still running ends without hanging them. Returns
   *  what the freeing threw now (a later free reports to the late parts'
   *  host). */
  dispose: () => unknown[];
}

export interface TileStreamContext {
  /**
   * Compiles an object's shaders before it shows (PostStack.compile), which
   * uploads its buffers: resolves true once that is done, false when
   * nothing could compile it yet (the frames will). Rejects with what the
   * compile threw.
   */
  compile: (object: Object3D) => Promise<boolean>;
  /** resolves when the HUD lets the heavy dressing start (create-app's
   *  startStreaming): the first frames only wait on terrain + buildings */
  dressingGate: Promise<void>;
  /** the site tile the boot waits on, streamed first; null once the first
   *  frame is up (`orderStreaming`) */
  bootTile: () => string | null;
  /** phones sample the ≤ 2048² class rasters */
  lowRasters: boolean;
  /** bytes of out-of-view tile content kept cached (scene-profile.ts) */
  cacheBytes: { max: number; min: number };
  /** the site's murals (mural-layer.ts), hung on a city tile's full LoD2;
   *  null where it has none */
  murals?: MuralSource | null;
  /** the scene fog's colour (height-fog.ts): the water's sky tint */
  fogColor: UniformNode<"color", Color>;
  /** ground height over every loaded terrain (projected coordinates) */
  heightAt: (x: number, y: number) => number | null;
  /** `heightAt` over the terrains loaded now, whatever lands later: a
   *  dressing built in slices reads one ground (lib/city/ground.ts) */
  pinnedGround?: () => (x: number, y: number) => number | null;
  /** the ground's look strengths (by reference) */
  ground: GroundUniforms;
  /** the scene's season and look (scene-environment.ts): a dressing
   *  lands with them as they are now */
  environment: DressingEnvironment;
  offset: { cx: number; cy: number };
  /** content landed, left, or changed visibility */
  onChange: () => void;
  /**
   * A compile threw because the GPU (or the page's process) could not
   * make room (lib/city/gpu-allocation.ts) — `where` says what: `content
   * <tile>`, `dressing <tile>` (left off, the tile bare) or `crowns` (the
   * seasonal warm-up) — or a tile's release met what such a failure left
   * behind (`dispose <tile>`: three's half-made attribute, the tile freed
   * past it). Once per failure.
   */
  onAllocationFailure?: (error: unknown, where: string) => void;
  /** a dressing whose build threw (not an abort, not an allocation
   *  failure — those go to `onAllocationFailure`): the tile stays bare */
  onDressingFailed?: (error: unknown, tile: string) => void;
  /**
   * A content's CPU copies went once its compile had uploaded them
   * (`dropContentCopies`): what the tiles keep on the page's process
   * changed, without a change of the stream when the compile outlasted
   * its wait and the tile showed first (`cpuBytesOf` is counted again).
   */
  onCopiesDropped?: () => void;
  renderer: WebGPURenderer;
  styleResources: StyleResources;
  sunDirection: Vector3;
  /** a phone streams fewer tiles at once (`orderStreaming`) */
  tier: DeviceTier;
  /** a site tile's exact extent (the tileset's root extras) */
  tileBounds: (tileId: string) => TerrainBounds | undefined;
  tilesetUrl: string;
  /**
   * The traffic bodies' builder, from the data layers' feature
   * (data-layers-feature.ts), which starts on the first switch-on: the
   * slots wait on it, so the stream does not depend on the layer's code.
   * Null once the scene is gone; rejects when the feature could not
   * start (the next switch-on asks again).
   */
  trafficBuilder: () => Promise<TrafficBuilder | null>;
}

export interface TileStream {
  cities: Set<CityLayer>;
  /** dressings queued or being built */
  pendingDressings: () => number;
  /** whether a tile's dressing was tried: built, failed, or its tile left */
  dressingSettled: (tileId: string) => boolean;
  /**
   * The site tiles with something still on its way: a content in view the
   * renderer is fetching or parsing (processTileModel included), or a
   * dressing queued or building (the loading frontier,
   * lib/city/load-frontier.ts). One set, refilled by every call: read it
   * before the next.
   */
  pendingSiteTiles: () => ReadonlySet<string>;
  /** demolished object indices per tile, kept across unload/reload */
  demolished: Map<string, Set<number>>;
  /** the site-wide groups (`CityObjectTable.group`) of demolished
   *  ensembles: their parts in a tile loaded later go too */
  demolishedGroups: Set<number>;
  dispose: () => void;
  dressings: Set<TileDressing>;
  group: Group;
  terrains: Set<TerrainLayer>;
  tiles: TilesRenderer;
  /** the visible terrains, fine level first ("first covering tile wins") */
  visibleTerrains: () => TerrainLayer[];
  visibleCities: () => CityLayer[];
  visibleDressings: () => TileDressing[];
}

/**
 * Whether a terrain level takes over from its tile's other level: one of
 * `shown` (the content extras of what is on screen) is that level.
 */
export function takesOver(
  level: Pick<TerrainExtras, "level" | "tileId">,
  shown: readonly (Partial<ContentExtras> | undefined)[]
): boolean {
  return shown.some(
    (other) =>
      other?.kind === "terrain" &&
      other.tileId === level.tileId &&
      other.level !== level.level
  );
}

/**
 * Whether the traversal saw `tile` in the view this frame: `inFrustum` is
 * only rewritten for the tiles it visits, so a tile it has left (the
 * camera turned, a parent culled) keeps its last answer.
 */
function inViewNow(tile: OrderedTile, frame: number): boolean {
  const t = tile.traversal;
  return t?.inFrustum === true && t.lastFrameVisited === frame;
}

/** What the dressing plugin reads of the renderer it is registered on. */
interface PluginTiles {
  /** the renderer's group of shown content roots */
  readonly group?: Object3D;
  recalculateBytesUsed: (tile?: object | null) => void;
  readonly visibleTiles: ReadonlySet<object>;
}

/** Every dressed object of a tile, keyed by its content root. */
interface Dressed {
  city?: CityLayer;
  /** the dressing, while it hangs on the tile */
  dressing?: TileDressing;
  /** what lands on the root after it (late-parts.ts): a terrain level's
   *  dressing and its traffic bodies, a city tile's murals — weighed
   *  from their build on, freed with the root */
  late: LateParts;
  /** the bytes of the site's shared buffers its content holds (the coarse
   *  grid's index and water index): the tile renderer counts them in the
   *  tile's glTF, but they stay when the tile goes */
  sharedBytes?: number;
  /** the city's hold on its shared sky-view raster (not weighed) */
  svf?: RasterHold;
  terrain?: TerrainLayer;
}

type Features<T> = Promise<T[]>;

/**
 * The city's buffers nothing reads on the CPU once it is compiled: its
 * normals and places on the wall, the roof flag among them (the clay reads
 * both, so its compile uploads them). The positions, index and feature ids stay —
 * collision and picks raycast the BVH over them, demolish rebuilds the
 * index from the feature ids, the selection outline cuts a building's
 * triangles out of them.
 */
function cityCpuDroppable(city: CityLayer): AnyAttribute[] {
  const { geometry } = city.mesh;
  return [geometry.getAttribute("normal"), geometry.getAttribute("facade")];
}

function firstMesh(root: Object3D): Mesh | undefined {
  return root.getObjectByProperty("isMesh", true) as Mesh | undefined;
}

/** The mesh on a glTF node of that name (the loader names the node's mesh
 *  after it). */
function meshNamed(root: Object3D, name: string): Mesh | undefined {
  let found: Mesh | undefined;
  root.traverse((o) => {
    if (!found && (o as Mesh).isMesh && o.name === name) {
      found = o as Mesh;
    }
  });
  return found;
}

/**
 * A dressing's scene parts by name — the one list its parts, its disposal,
 * its visibility and the HUD's layer census (create-app.ts) walk. A field
 * added to TileDressing does not compile until it has its entry here.
 */
export const DRESSING_PARTS = {
  vegetation: (d) => d.vegetation?.group,
  lowVegetation: (d) => d.lowVegetation,
  lamps: (d) => d.lamps?.group,
  monuments: (d) => d.monuments?.group,
  furniture: (d) => d.furniture,
  rail: (d) => d.rail,
  tram: (d) => d.tram,
  riverside: (d) => d.riverside,
  traffic: (d) => d.traffic?.group ?? undefined,
  sport: (d) => d.sport?.group,
  vineyards: (d) => d.vineyards,
} as const satisfies Record<
  // every field but the id, the askables (data) and the environment's
  // let-go: a new part cannot be left out
  Exclude<keyof TileDressing, "asks" | "buildAsks" | "tile" | "unfollow">,
  (d: TileDressing) => Object3D | undefined
>;

export type DressingPartName = keyof typeof DRESSING_PARTS;

export const DRESSING_PART_NAMES = Object.keys(
  DRESSING_PARTS
) as DressingPartName[];

export function dressingParts(d: TileDressing): Object3D[] {
  return DRESSING_PART_NAMES.flatMap((name) => DRESSING_PARTS[name](d) ?? []);
}

/**
 * What the loaded tiles keep on the page's process, by what keeps it
 * (bytes) — beside what three counts on the GPU, which is all the memory
 * governor and the tile cache's weighing see. An iPhone's page died at the
 * boot with three's count at 257 MB: the process ran out first. The typed
 * arrays only (`cpuArrayBytes`, `bvhBytesUnder`): not the meshopt
 * workers' heaps, the loaders' transient copies or plain JS objects (the
 * ask sets), which nothing can weigh from here.
 */
export interface CpuBytes {
  /** the buildings' positions, index and feature ids, which picks, the
   *  BVH, demolish and the selection outline read */
  city: number;
  /** the buildings' BVHs (city-layer.ts builds them as rays need them) */
  bvh: number;
  /** the buildings' object tables and the textures packed from them */
  tables: number;
  /** the terrain levels' kept arrays (a TIN's index, the water's) */
  terrain: number;
  /** their height lookups: a TIN's vertices and buckets, a grid's heights */
  heights: number;
  /** the dressings' geometry and instance arrays, and the BVHs of what
   *  was asked (bridge decks, traffic bodies) */
  dressing: number;
  total: number;
}

/** The loaded tiles' CPU arrays (`CpuBytes`), each buffer once. */
export function cpuBytesOf(
  stream: Pick<TileStream, "cities" | "dressings" | "terrains">
): CpuBytes {
  const seen = new Set<ArrayBufferLike>();
  const arrays = (roots: (Object3D | undefined)[]) =>
    roots.reduce(
      (sum, root) => sum + (root ? cpuArrayBytes(root, seen) : 0),
      0
    );
  const out: CpuBytes = {
    city: 0,
    bvh: 0,
    tables: 0,
    terrain: 0,
    heights: 0,
    dressing: 0,
    total: 0,
  };
  for (const city of stream.cities) {
    out.city += arrays([city.mesh]);
    out.bvh += bvhBytesUnder(city.mesh);
    out.tables += city.tableBytes;
  }
  for (const t of stream.terrains) {
    // the level's own meshes, not the dressing hung beside them
    out.terrain += arrays([
      t.mesh,
      t.water?.mesh,
      t.water?.mistMesh,
      t.stairs,
      t.walls,
      t.kerbs,
      t.fences,
    ]);
    out.heights += t.heightBytes;
  }
  for (const d of stream.dressings) {
    const parts = dressingParts(d);
    out.dressing += arrays(parts);
    for (const part of parts) {
      out.dressing += bvhBytesUnder(part);
    }
  }
  out.total =
    out.city + out.bvh + out.tables + out.terrain + out.heights + out.dressing;
  return out;
}

/**
 * Meshopt decode workers per tier. Each worker's WebAssembly heap grows to
 * the largest buffer it has decoded (a dense building tile's 75 MB) and
 * never shrinks, so every worker is a heap of that size on the page's
 * process for good: a phone, which the page's process memory ends (an
 * iPhone's crashes come with three's GPU count at 257 MB), keeps one — its
 * two parse slots queue their decodes, a fraction of each parse — and a
 * desktop two.
 */
export const MESHOPT_WORKERS: Readonly<Record<DeviceTier, number>> = {
  desktop: 2,
  mobile: 1,
};
/**
 * How long a level may wait on its dressing while the tile's other level
 * stands in for it (DressingPlugin.handsOver): the wait holds one of the
 * renderer's parse slots (processTileModel runs inside the parse job), and
 * dressings build one at a time. A phone has two slots: it shows the level
 * bare and dresses it after (the trees appear a moment later); a desktop
 * waits a little, so most hand-overs still swap the trees in one frame.
 * (It was 10 s on every tier: a phone's stream stood still behind it.)
 */
export function handOverWaitMs(tier: DeviceTier): number {
  return tier === "mobile" ? 0 : 1500;
}

/**
 * The stream's one call for "a hung dressing's crowns changed": every
 * dressing hears a season change in the same emit, and the shadow map is
 * drawn again once for all of them (`castersChanged` once, after the emit
 * ends: a microtask).
 */
export function castersBatch(env: Pick<DressingEnvironment, "castersChanged">) {
  let pending = false;
  return (): void => {
    if (pending) {
      return;
    }
    pending = true;
    queueMicrotask(() => {
      pending = false;
      env.castersChanged();
    });
  };
}

/**
 * Binds a dressing's trees to the scene environment (scene-environment.ts)
 * from its birth: they take the season of now at once and every change
 * after — while the dressing compiles, hangs and shows — and a crown that
 * changed while the dressing hangs (`hung`) redraws the shadow map through
 * the stream's batch (`changed`, `castersBatch`); one in no scene yet casts
 * nothing, and its hang redraws the map (the stream's change). Returns the
 * call that lets go (`TileDressing.unfollow`, called by `disposeDressing`).
 * The look needs no following here: the traffic follows the layer once it hangs
 * (`TrafficSlot.attach`).
 */
export function followEnvironment(
  d: Pick<TileDressing, "vegetation">,
  env: Pick<DressingEnvironment, "season">,
  casters: { hung: () => boolean; changed: () => void }
): () => void {
  const { vegetation } = d;
  if (!vegetation) {
    return () => {
      // nothing follows
    };
  }
  return follow(env.season, (day) => {
    if (vegetation.setSeason(day) && casters.hung()) {
      casters.changed();
    }
  });
}

/** Frees a dressing; a part that throws does not keep the others (what
 *  was thrown is returned). */
function disposeDressing(d: TileDressing): unknown[] {
  // it hears the scene no more
  d.unfollow?.();
  d.unfollow = undefined;
  // its ask sets, if still pending, are never built: their idle callback
  // may come after the tile has left (the entry it checks keeps the
  // dressing), over a terrain already disposed
  d.buildAsks = undefined;
  const errors: unknown[] = [];
  for (const own of [d.lamps, d.monuments, d.sport]) {
    try {
      own?.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  // the traffic's bodies, built or still building (it nulls its group)
  if (d.traffic) {
    errors.push(...d.traffic.dispose());
  }
  for (const part of dressingParts(d)) {
    part.removeFromParent();
    errors.push(...disposeObject3D(part));
  }
  return errors;
}

/** How long a hung dressing's ask sets wait for an idle main thread. */
const ASKS_IDLE_MS = 2000;

/**
 * Builds a dressing's pending ask sets (`TileDressing.buildAsks`) now, at
 * most once: into its `asks`, whose identity the traffic's sets rely on;
 * the closure goes, and with it the features it held.
 */
function buildAsksNow(dressing: TileDressing): void {
  const steps = dressing.buildAsks;
  dressing.buildAsks = undefined;
  if (steps) {
    finished(steps);
  }
}

/**
 * Builds a hung dressing's ask sets once the main thread is idle — if the
 * dressing still hangs on its tile then (`stillHung`). A question that
 * comes first builds them at once (`asksOf`): a busy page's idle time can
 * be long in coming, and its callback's timeout late (timers wait behind
 * three's compile steps there — plan 069's Findings).
 */
export function buildAsksWhenIdle(
  dressing: TileDressing,
  stillHung: () => boolean,
  opts: {
    /** a builder that threw: its tile has no ask sets */
    failed?: (err: unknown) => void;
    idle?: typeof whenIdle;
    run?: (steps: Steps<unknown>) => Promise<unknown>;
  } = {}
): void {
  const { failed, idle = whenIdle, run = inSlices } = opts;
  const steps = dressing.buildAsks;
  if (!steps) {
    return;
  }
  // neither a question (which finishes them) nor a release took them
  const pending = () => dressing.buildAsks === steps && stillHung();
  const release = () => {
    if (dressing.buildAsks === steps) {
      dressing.buildAsks = undefined;
    }
  };
  idle(() => {
    if (!pending()) {
      release();
      return;
    }
    // in slices: a dense tile's took 0.4–0.7 s on the phone profile
    const runAsks = async () => {
      try {
        await run(
          (function* askSteps() {
            yield* onlyWhile(steps, pending);
            release();
          })()
        );
      } catch (error) {
        release();
        failed?.(error);
      }
    };
    void runAsks();
  }, ASKS_IDLE_MS);
}

/** What the probe can ask of a dressing: its ask sets, the pending ones
 *  built first (a question before its idle time). */
export function asksOf(dressing: TileDressing): AskSet<FeatureInquiry>[] {
  buildAsksNow(dressing);
  return dressing.asks ?? [];
}

/** The site tile a content root is of (its extras), for the trail. */
const tileIdOf = (scene: Object3D): string =>
  (scene.userData as Partial<ContentExtras>).tileId ?? "?";

/**
 * Whether a lamp at projected (x, y) stands by one of the tile's tracks,
 * close enough for the rails to catch its light (lamp-reflections.ts).
 * (The lamps the river mirrors the bake names: `w`, pipeline/bake/
 * lamp_water.py.)
 */
function lampsBy(
  rails: readonly RailFeature[],
  trams: readonly TramFeature[],
  lampCount: number
): {
  tracks?: (x: number, y: number) => boolean;
} {
  const lines = [
    // a drawn track: no monorail's beam, none below ground
    ...rails.flatMap((f) =>
      f.geometry?.type === "LineString" &&
      !isMonorail(f) &&
      (f.properties?.layer ?? 0) >= 0
        ? [f.geometry.coordinates]
        : []
    ),
    // a track, not a span or an arm between its anchors
    ...trams.flatMap((f) =>
      f.properties?.k === "track" && f.geometry.type === "LineString"
        ? [f.geometry.coordinates]
        : []
    ),
  ];
  return {
    // hashed only for a tile that has lamps to test
    tracks:
      lines.length > 0 && lampCount > 0
        ? nearLines(lines, LAMP_TRACK_REACH_M)
        : undefined,
  };
}

/** The goals, posts and nets of the grounds this tile owns (a ground on a
 *  seam is in both tiles' tables; its centre decides). */
function buildSport(
  terrain: TerrainLayer,
  table: SportTable | null,
  ctx: TileStreamContext
): SportFixtureLayer | undefined {
  if (!table?.grounds?.length) {
    return undefined;
  }
  const minX = terrain.bounds[0];
  const maxY = terrain.bounds[3];
  const extent = ctx.tileBounds(terrain.tile);
  const own = extent
    ? table.grounds.filter(([cx, cy]) =>
        ownsPoint(extent, minX + cx, maxY + cy)
      )
    : table.grounds;
  return buildSportFixtures(sportFixtures({ grounds: own }), {
    offset: ctx.offset,
    heightAt: terrain.heightAt,
    origin: { x: minX, y: maxY },
  });
}

/**
 * The tile's trees as one control: the canopy (DLM rows, DOM1 crowns, scan
 * crowns) and, where the tile has them, the street-tree cadastre
 * (tree-inventory-layer.ts). A cadastre tree vetoes the canopy point it
 * stands on (`keepTree`), and its trunk and broadleaf crown ride in the
 * canopy's chunk meshes (instances, not draw calls); only its reshaped
 * silhouettes (flame, cone, weeping) are meshes of its own.
 * @yields {void} once per finished run, to hand the thread back.
 */
function* tileVegetationSteps(
  features: Omit<VegetationFeatures, "extraTrees" | "keepTree">,
  inventoryTrees: TreeFeature[],
  vegCtx: VegetationContext
): Steps<{ keepTree?: TreeVeto; vegetation: VegetationControl }> {
  const inventory =
    inventoryTrees.length > 0
      ? yield* treeInventorySteps(inventoryTrees, vegCtx, features.ndviAt)
      : null;
  const canopy = yield* vegetationSteps(
    {
      ...features,
      keepTree: inventory?.keepTree,
      extraTrees: inventory?.instances,
    },
    vegCtx
  );
  if (!inventory) {
    return { vegetation: canopy };
  }
  const own = inventory.control;
  const group = new Group();
  group.name = "vegetation";
  group.add(canopy.group, own.group);
  const vegetation: VegetationControl = {
    group,
    chunks: canopy.chunks,
    cells: own.cells,
    looseFeet: canopy.looseFeet,
    setSeason: (day) => {
      const a = canopy.setSeason(day);
      const b = own.setSeason(day);
      return a || b;
    },
  };
  return { keepTree: inventory.keepTree, vegetation };
}

/** `Promise.all` over named promises: no position to get out of step. */
async function allNamed<T extends Record<string, Promise<unknown>>>(
  promises: T
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(promises) as (keyof T)[];
  const values = await Promise.all(keys.map((key) => promises[key]));
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as {
    [K in keyof T]: Awaited<T[K]>;
  };
}

/**
 * The next builder in a later task, a frame in between (the long ones run
 * in slices of their own, lib/city/build-steps.ts). A tile that leaves
 * meanwhile stops there (its signal); the dressing frees what it had
 * built.
 */
const nextTask = async (signal?: AbortSignal): Promise<void> => {
  await giveBack();
  signal?.throwIfAborted();
};

/** What a tile's traffic bodies are built from (traffic-layer.ts
 *  `buildTraffic`), and where the probe's ask set goes once they are. */
export interface TrafficSource {
  /** the builder: the data layers' feature, started on the first show
   *  (`TileStreamContext.trafficBuilder`) */
  load: () => Promise<TrafficBuilder | null>;
  features: TrafficFeature[];
  bridges: BridgeFeature[];
  ground: GroundContext;
  detail: TrafficDetail;
  /** the tile's extent: a section cut at its edge does not taper there */
  bounds?: readonly [number, number, number, number];
  tile: string;
  /** the dressing's ask list: the counted sections join it once their
   *  bodies are built (they are asked on them, while the layer shows) */
  asks: AskSet<FeatureInquiry>[];
}

/** The dressings' turns in the site's lane (late-parts.ts): a coarse
 *  level's — the bridges and a third of the trees, light to build — ahead
 *  of any fine level's, so every tile in view has trees before the nearest
 *  has all. */
const COARSE_DRESSING_RANK = 0;
const FINE_DRESSING_RANK = 1;

/** A tile's traffic bodies, built (traffic-layer.ts) with their ask set. */
interface TrafficBodies {
  group: Group;
  asks: AskSet<FeatureInquiry> | null;
}

/**
 * A tile's counted traffic, its bodies built on demand (`TrafficSlot`):
 * the first `show` once the dressing hangs waits for the builder (the
 * data layers' feature, started once for the scene — a tile that landed
 * before the first switch-on and one landing after wait on the same
 * start, outside the dressings' lane), then adds the bodies as a late part
 * of the tile (late-parts.ts), owned by the dressing: built in the site's
 * lane at the level's rank (a switch-on builds every loaded tile's bodies
 * one after another, like the dressings, a coarse level's first), weighed
 * from their build, holding the lane through their compile wait (one body
 * in flight at a time: a fine body is ≈ 20 MiB), hung once compiled, and
 * only then shown and asked. A tile that leaves meanwhile gets nothing
 * hung (its release frees what was built).
 */
export function trafficSlot(src: TrafficSource): TrafficSlot {
  let tile: TrafficTile | null = null;
  let building: Promise<void> | null = null;
  let handle: LateHandle | null = null;
  let set: AskSet<FeatureInquiry> | null = null;
  let wanted = false;
  let disposed = false;
  /** lets go of the look (attach follows it) */
  let unfollowLook: (() => void) | null = null;
  /** The builder, before the lane: waiting for it must not hold the
   *  dressings' lane. One that did not come is no failed build of this
   *  tile (the spine says so once): the next show asks again; nor is one
   *  that came after the layer went off again — built on the next show. */
  const builderNow = async (): Promise<TrafficBuilder | null> => {
    const builder = await src.load().catch(() => null);
    if (builder && wanted) {
      return builder;
    }
    building = null;
    return null;
  };
  const part = (
    at: TrafficTile,
    builder: TrafficBuilder
  ): LatePart<TrafficBodies> => ({
    kind: "traffic",
    tile: src.tile,
    rank: src.detail === "coarse" ? COARSE_DRESSING_RANK : FINE_DRESSING_RANK,
    hangAt: "compile",
    build: async (signal) => {
      await nextTask(signal);
      const group = builder.build(
        src.features,
        src.bridges,
        src.ground,
        src.detail,
        src.bounds
      );
      // asked as built, before it hangs (traffic-ask.ts)
      return { group, asks: builder.askSet(group, src.features, src.tile) };
    },
    objects: ({ group }) => compileRepresentatives([group]),
    bytes: ({ group }) => estimateGeometryBytes(group),
    hang: (bodies) => {
      bodies.group.visible = wanted;
      at.root.add(bodies.group);
      slot.group = bodies.group;
      set = bodies.asks;
      if (set) {
        src.asks.push(set);
      }
      return () => {
        bodies.group.removeFromParent();
        slot.group = null;
        const index = bodies.asks ? src.asks.indexOf(bodies.asks) : -1;
        if (index >= 0) {
          src.asks.splice(index, 1);
        }
        set = null;
      };
    },
    free: ({ group }) => disposeObject3D(group),
  });
  const build = async (at: TrafficTile): Promise<void> => {
    const builder = await builderNow();
    if (!builder || disposed) {
      return;
    }
    const own = at.parts.add(part(at, builder), at.owner);
    handle = own;
    const outcome = await own.settled;
    if (outcome === "out of memory") {
      // the GPU had no room (reported by the compile): the layer stays
      // off on this tile rather than the GPU further under
      slot.dispose();
    } else if ((outcome === "failed" || outcome === "gone") && handle === own) {
      // nothing hangs (a build that threw, a tile that left): the next
      // show tries again — none once the dressing is taken down
      // (`disposed`), and a tile that left settles a new part "gone" at
      // once, building nothing
      building = null;
      handle = null;
    }
  };
  const slot: TrafficSlot = {
    group: null,
    show: async () => {
      wanted = true;
      if (slot.group) {
        slot.group.visible = true;
        return;
      }
      if (!tile || disposed) {
        return; // built once the dressing hangs
      }
      building ??= build(tile);
      await building;
    },
    hide: () => {
      wanted = false;
      if (slot.group) {
        slot.group.visible = false;
      }
    },
    asks: () => set,
    attach: (at) => {
      tile = at;
      // a layer that is off draws nothing, and one never switched on has
      // built nothing. Only the layer's own switch counts: any other look
      // change (the fog, the style) leaves the slot as it is — so a build
      // that failed is tried again on the next switch-on, never on each
      // look change (each one a ~20 MiB build and a report)
      let on: boolean | null = null;
      unfollowLook = follow(at.look, (look) => {
        if (look.trafficLayer === on) {
          return;
        }
        on = look.trafficLayer;
        if (on) {
          void slot.show();
        } else {
          slot.hide();
        }
      });
    },
    dispose: () => {
      unfollowLook?.();
      unfollowLook = null;
      disposed = true;
      // taken down now, freed now or once its compile has ended
      return handle?.dispose() ?? [];
    },
  };
  return slot;
}

/**
 * The coarse terrain level's dressing: what must not end where the fine
 * level's reach does — the counted traffic, built coarser (traffic-layer.ts
 * `TrafficDetail`) on the coarse ground it is drawn over, so the flows
 * reach every tile in view and not just the ones the fine level has
 * loaded; the bridges (decks, piers, the measured steel, no rails): the
 * LoD2 leaves them out of the buildings (city-mesh.ts), so without them
 * every river crossing vanished past the fine level's reach — in the air
 * beyond ≈1.2 km, and from 2.5 m/px on in a whole Modell picture; and the
 * trees, a third of them drawn wider (coarse-crowns-layer.ts): the fine
 * level carries every tree, so without these every place showing the
 * coarse level showed none — in the distance, and at any Modell scale
 * where the fine level was not loaded.
 */
async function buildCoarseDressing(
  terrain: TerrainLayer,
  extras: TerrainExtras,
  ctx: TileStreamContext,
  extent: TerrainBounds,
  url: (file: string) => string,
  signal?: AbortSignal
): Promise<TileDressing> {
  const { offset } = ctx;
  const files = extras.coarse ?? {};
  const tile = extras.tileId;
  const fetchKind = async <T>(file: string | undefined): Features<T> =>
    file ? await fetchFeatures<T>(url(file), signal) : [];
  const [traffic, bridges, crownBytes] = await Promise.all([
    fetchKind<TrafficFeature>(files.traffic),
    fetchKind<BridgeFeature>(files.bridge),
    files.crowns
      ? fetchOptionalBinary(url(files.crowns), signal)
      : Promise.resolve(null),
  ]);
  // the same bridges as the fine level draws (its decks are measured, the
  // piers stand on the ground in reach), the same owner per seam
  const owns = (x: number, y: number) => ownsPoint(extent, x, y);
  const ground = { offset, heightAt: ctx.heightAt };
  const rail =
    bridges.length > 0
      ? await inSlices(
          railSteps(
            { bridges, rails: [], ballast: [], platforms: [] },
            {
              offset,
              heightAt: ctx.pinnedGround?.() ?? ctx.heightAt,
              owns,
            }
          ),
          { signal }
        )
      : undefined;
  const decks = rail
    ? bridgeAskSet(
        rail,
        bridgeItems(bridges, {
          ...ground,
          tile,
          owns,
        })
      )
    : undefined;
  const asks = decks ? [decks] : [];
  // asked on the coarse bodies too, once built: the tiles the fine level
  // has not reached show only these
  const flows =
    traffic.length > 0
      ? trafficSlot({
          load: ctx.trafficBuilder,
          features: traffic,
          bridges,
          ground: { offset, heightAt: terrain.heightAt },
          detail: "coarse",
          bounds: extent,
          tile,
          asks,
        })
      : undefined;
  const crowns = (crownBytes && unpackCrowns(crownBytes)) ?? [];
  const vegetation =
    crowns.length > 0
      ? await inSlices(
          coarseCrownSteps(crowns, {
            heightAt: terrain.heightAt,
            offset,
            sunDirection: ctx.sunDirection,
          }),
          { signal }
        ).catch((error: unknown) => {
          // the bridges and the traffic's slot built, never hung: freed
          // with the build
          disposeDressing({ tile, rail, traffic: flows });
          throw error;
        })
      : undefined;
  return {
    asks: asks.length > 0 || flows ? asks : undefined,
    rail: rail && rail.children.length > 0 ? rail : undefined,
    tile,
    traffic: flows,
    vegetation,
  };
}

async function buildDressing(
  terrain: TerrainLayer,
  extras: TerrainExtras,
  ctx: TileStreamContext,
  url: (file: string) => string,
  signal?: AbortSignal
): Promise<TileDressing> {
  const d = extras.dressing;
  const tile = extras.tileId;
  if (!d) {
    return COARSE_DRESSING_KINDS.some((kind) => extras.coarse?.[kind])
      ? await buildCoarseDressing(
          terrain,
          extras,
          ctx,
          ctx.tileBounds(tile) ?? terrain.bounds,
          url,
          signal
        )
      : { tile };
  }
  // A kind the tile lacks is a feature off, never a request.
  const get = async <T>(kind: DressingKind): Features<T> => {
    const file = d[kind];
    return file ? await fetchFeatures<T>(url(file), signal) : [];
  };
  // The canopy points come packed (lib/city/point-pack.ts, prepare-data.ts):
  // no parse, the same features for the vegetation. Not a pack = off.
  // whether the canopy holds the tree rows' trees (point-pack.ts)
  let rowsMeasured = false;
  const getPoints = async (
    kind: "canopy" | "canopyx"
  ): Promise<CanopyExtraFeature[]> => {
    const file = d[kind];
    const buffer = file ? await fetchOptionalBinary(url(file), signal) : null;
    const points = buffer ? unpackPoints(buffer) : null;
    if (kind === "canopy" && points) {
      rowsMeasured = (points.flags & ROWS_MEASURED) !== 0;
    }
    return points ? (pointFeatures(points) as CanopyExtraFeature[]) : [];
  };
  const {
    rows: mappedRows,
    canopy,
    ndviAt,
    lamps: osmLamps,
    monuments,
    furniture: osmFurniture,
    mly,
    rails,
    bridges,
    ballast,
    platforms,
    sportTable,
    inventory,
    scanTrees,
    hedges,
    cultivated,
    trams,
    river,
    traffic,
  } = await allNamed({
    rows: get<VegRowFeature>("vegrows"),
    canopy: getPoints("canopy"),
    ndviAt: extras.ndvi
      ? loadNdviSampler(url(extras.ndvi), terrain.bounds, signal)
      : Promise.resolve(null),
    lamps: get<LampFeature>("lamps"),
    monuments: get<MonumentFeature>("monuments"),
    furniture: get<FurnitureFeature>("furniture"),
    // the lamps and bins OSM lacks, Mapillary's (lib/city/mapillary.ts)
    mly: get<MapillaryFeature>("mly"),
    rails: get<RailFeature>("rail"),
    bridges: get<BridgeFeature>("bridge"),
    ballast: get<AreaFeature>("railarea"),
    platforms: get<AreaFeature>("platform"),
    // the table only: its fixtures are built once every fetch has landed,
    // so an aborted dressing leaves nothing built behind
    sportTable: extras.sportTable
      ? fetchOptionalJson<SportTable>(url(extras.sportTable), signal)
      : Promise.resolve(null),
    // the street-tree cadastre (tree-inventory-layer.ts)
    inventory: get<TreeFeature>("trees"),
    // laser-scan crowns outside the canopy mask (tiles with a laser scan)
    scanTrees: getPoints("canopyx"),
    hedges: get<LowVegFeature>("lowveg"),
    // allotments, orchards, vineyards (cultivated-layer.ts)
    cultivated: get<CultivatedFeature>("cultivated"),
    trams: get<TramFeature>("tram"),
    river: get<RiversideFeature>("riverside"),
    traffic: get<TrafficFeature>("traffic"),
  });
  // A canopy that holds its tile's tree rows' trees (DOM1's crown peaks
  // along them) leaves only the hedges to be planted from the rows.
  const rows = plantedRows(mappedRows, rowsMeasured);
  const fromMapillary = mapillaryParts(mly);
  const lamps = [...osmLamps, ...fromMapillary.lamps];
  const furniture = [...osmFurniture, ...fromMapillary.furniture];
  const sport = buildSport(terrain, sportTable, ctx);
  // what is built so far: freed if the build stops (a tile that left, a
  // builder that threw) — never hung, but a lamp's lights and the other
  // parts' own are still theirs to free
  const made: TileDressing = { tile, sport };
  try {
    await nextTask(signal);
    // Rails may run past the tile edge: they sample the ground over
    // every loaded terrain, not this tile's alone — what the ask sets and
    // the traffic, built later, read as it is then; the builders below,
    // run in slices between frames, over the terrains loaded now: one
    // ground for all of them, whatever lands meanwhile.
    const ground = { offset: ctx.offset, heightAt: ctx.heightAt };
    const pinned = {
      offset: ctx.offset,
      heightAt: ctx.pinnedGround?.() ?? ctx.heightAt,
    };
    // Orchard trees join the cadastre as its "small" archetype, appended: an
    // index stays the trees file's (and its facts row), the orchard's past it.
    const trees = [...inventory, ...orchardTrees(cultivated)];
    const ownCanopy = offMonuments(canopy, monuments);
    const ownScan = offMonuments(scanTrees, monuments);
    const { vegetation, keepTree } = await inSlices(
      tileVegetationSteps(
        {
          rows,
          // The laser-scan crowns outside the canopy mask join the canopy as
          // ordinary trees (they carry the same measured `h`); the bake already
          // dropped the ones a cadastre tree claims.
          canopy: [...ownCanopy, ...ownScan],
          ndviAt: ndviAt ?? undefined,
        },
        trees,
        {
          offset: ctx.offset,
          heightAt: terrain.heightAt,
          sunDirection: ctx.sunDirection,
          footMaterial: (sun) => footMaterialFor(terrain, sun),
        }
      ),
      { signal }
    );
    // (its season: from the environment, as the plugin queues it)
    made.vegetation = vegetation;
    await nextTask(signal);
    // the OSM hedges and the DLM's hedge rows, drawn as one kind of hedge
    const lowVegetation =
      hedges.length > 0 || rows.some((f) => f.properties?.kind === "hedge")
        ? buildLowVegetation(
            hedges,
            { offset: ctx.offset, heightAt: terrain.heightAt },
            rows
          )
        : undefined;
    made.lowVegetation = lowVegetation;
    // The bake reads lamps with a margin around the tile; a lamp on or past a
    // seam is its owner's, or two tiles would stand it twice.
    const extent = ctx.tileBounds(tile);
    const ownLamps = extent
      ? lamps.filter((f) =>
          ownsPoint(
            extent,
            f.geometry.coordinates[0],
            f.geometry.coordinates[1]
          )
        )
      : lamps;
    const lampControl = buildLamps(
      ownLamps,
      { ...ground, heightAt: terrain.heightAt },
      lampsBy(rails, trams, ownLamps.length)
    );
    made.lamps = lampControl;
    await nextTask(signal);
    const rail = await inSlices(
      railSteps(
        { rails, bridges, ballast, platforms },
        {
          ...pinned,
          // a deck across a seam is in both tiles' files; its owner draws it
          owns: extent ? (x, y) => ownsPoint(extent, x, y) : undefined,
        }
      ),
      { signal }
    );
    made.rail = rail;
    await nextTask(signal);
    // The bake writes only the monuments a tile owns; a basin that reaches
    // past the seam samples the neighbour's ground.
    const monumentLayer = buildMonuments(monuments, pinned);
    made.monuments = monumentLayer;
    // Owned by the bake (west/south edges in): stood on this tile's ground.
    const furnitureGroup = await inSlices(
      furnitureSteps(furniture, {
        ...ground,
        heightAt: terrain.heightAt,
      }),
      { signal }
    );
    made.furniture = furnitureGroup;
    await nextTask(signal);
    const vines = vineRows(cultivated);
    const vineyards =
      vines.length > 0
        ? buildVineyards(vines, {
            offset: ctx.offset,
            heightAt: terrain.heightAt,
          })
        : undefined;
    made.vineyards = vineyards;
    // Tracks are cut at the tile edge by the bake; they and the span wires
    // sample the ground over every loaded terrain, like the rails.
    await nextTask(signal);
    const tram =
      trams.length > 0
        ? await inSlices(tramSteps(trams, bridges, pinned), { signal })
        : undefined;
    made.tram = tram;
    // Piers and pontoons are the tile's own; a ferry line or groyne cut at
    // the seam samples the neighbour's ground past it.
    const riverside =
      river.length > 0 ? buildRiverside(river, pinned) : undefined;
    made.riverside = riverside;
    // What the probe can ask, sized as drawn: the trees on the tile's own
    // ground (as the inventory stands them), decks only where this tile
    // draws them — built once the dressing hangs, in idle time (`buildAsks`,
    // dressingPart), into the array the traffic's sets join too. Until then
    // a click on the tile's trees finds nothing to ask.
    const askCtx = {
      ...ground,
      tile,
      treeHeightAt: terrain.heightAt,
      owns: extent
        ? (x: number, y: number) => ownsPoint(extent, x, y)
        : undefined,
    };
    const asks: AskSet<FeatureInquiry>[] = [];
    // (lazy: nothing runs before its first step)
    const askSteps = function* askSteps(): Steps<void> {
      // its span from the first step to the last, the pauses included
      const start = streamTimings.now();
      const own = [
        ...treeSets(trees, askCtx),
        ...askSets(monumentItems(monuments, askCtx)),
      ];
      yield;
      const bridgeSet = bridgeAskSet(rail, bridgeItems(bridges, askCtx));
      yield;
      // every other tree, the hedges, lamps, furniture, stops and landings
      const more = yield* moreSetsSteps(
        {
          canopy: ownCanopy,
          scan: ownScan,
          rows,
          hedges,
          lamps: ownLamps,
          furniture,
          trams,
          river,
        },
        askCtx,
        keepTree
      );
      // all at once, in their order: a question finds the tile's sets whole
      for (const set of [...own, ...(bridgeSet ? [bridgeSet] : []), ...more]) {
        asks.push(set);
      }
      streamTimings.since("dressing:asks", start, tile);
    };
    const buildAsks = askSteps();
    // Sections are cut at the tile edge by the bake; a bridge street rides
    // the decks of this tile's bridge file (which names a seam deck in both).
    // The counted sections are asked on their bodies, while the layer shows;
    // the bodies (and their builder, the data layers' feature) come with
    // the first switch-on.
    const trafficFlows =
      traffic.length > 0
        ? trafficSlot({
            load: ctx.trafficBuilder,
            features: traffic,
            bridges,
            ground,
            detail: "fine",
            bounds: ctx.tileBounds(tile) ?? terrain.bounds,
            tile,
            asks,
          })
        : undefined;
    return {
      asks,
      buildAsks,
      tile,
      tram,
      riverside,
      traffic: trafficFlows,
      vegetation,
      lowVegetation,
      vineyards,
      lamps: lampControl,
      monuments: monumentLayer,
      furniture: furnitureGroup,
      rail,
      sport,
    };
  } catch (error) {
    disposeDressing(made);
    throw error;
  }
}

/** Where a terrain level's dressing hangs (`dressingPart`). */
export interface DressingSite {
  tile: string;
  level: "coarse" | "fine";
  /** the content root it hangs under (the viewer's Y-up scene frame) */
  root: Object3D;
  /** where the root keeps it while it hangs (its entry in the plugin) */
  slot: { dressing?: TileDressing };
  /** the stream's hung dressings */
  dressings: Set<TileDressing>;
  /** the root's late parts: its traffic bodies join them, owned by it */
  parts: LateParts;
  /** the look store: its traffic shows while the layer is on */
  look: TrafficTile["look"];
  /** whether the stream is still there */
  live: () => boolean;
  /** an ask builder that threw in idle time */
  failed: (error: unknown, tile: string) => void;
  /** what a take-down after a failed hang threw (the hang's own error
   *  goes on as the failure) */
  freeFailed: (errors: unknown[]) => void;
  build: (signal: AbortSignal) => Promise<TileDressing>;
}

/**
 * A terrain level's dressing as a late part of its content root
 * (late-parts.ts): built in the site's lane (a coarse level's first),
 * compiled one representative per build, weighed from its build by its
 * parts' geometry, hung once its compile wait is over — a level that hands
 * over waits on it (`DressingPlugin.handsOver`) — its ask sets built in
 * idle time once it hangs, and freed whole.
 */
export function dressingPart(site: DressingSite): LatePart<TileDressing> {
  const { slot, dressings } = site;
  return {
    kind: "dressing",
    tile: site.tile,
    rank: site.level === "coarse" ? COARSE_DRESSING_RANK : FINE_DRESSING_RANK,
    hangAt: "wait",
    build: site.build,
    objects: (d) => compileRepresentatives(dressingParts(d)),
    // what evicting the tile frees: not the site's shared buffers (the
    // flags' cloths)
    bytes: (d) =>
      dressingParts(d).reduce(
        (sum, part) => sum + estimateGeometryBytes(part, true),
        0
      ),
    hang: (d, self) => {
      // taken down, its parts leave the root (or the coarse crowns'
      // stand-in) at once: its free may wait for its compile, and the
      // root's release would dispose whatever still hangs on it
      const takeDown = (): unknown[] => {
        // it hears the scene no more — its season, its traffic's look —
        // though its free may wait: a look change would start the
        // traffic's builder for a tile gone. (Its bodies, a part it owns,
        // went before it: what their slot frees here is nothing.)
        d.unfollow?.();
        d.unfollow = undefined;
        const errors = d.traffic?.dispose() ?? [];
        if (slot.dressing === d) {
          slot.dressing = undefined;
        }
        dressings.delete(d);
        for (const part of dressingParts(d)) {
          part.removeFromParent();
        }
        return errors;
      };
      try {
        // The content root is the viewer's Y-up scene frame (the
        // renderer's up-axis turn cancels the world group's), so the Y-up
        // dressing hangs under it and leaves with its tile.
        site.root.add(...dressingParts(d));
        slot.dressing = d;
        dressings.add(d);
        buildAsksWhenIdle(d, () => site.live() && slot.dressing === d, {
          failed: (err) => site.failed(err, d.tile),
        });
        // its traffic's bodies hang on the tile once the layer is on
        d.traffic?.attach({
          look: site.look,
          parts: site.parts,
          owner: self,
          root: site.root,
        });
      } catch (error) {
        // half hung: nothing of it stays where the stream would find it —
        // what that throws is reported beside the hang's own failure
        site.freeFailed(takeDown());
        throw error;
      }
      // every error of its take-down goes to the free's report
      return takeDown;
    },
    free: (d) => disposeDressing(d),
  };
}

/** Where a city tile's murals hang (`muralsPart`). */
export interface MuralSite {
  tile: string;
  /** the content root they hang under */
  root: Object3D;
  /** the tile's buildings: each mural shows while its building does */
  city: Pick<CityLayer, "hang">;
  /** the tile's murals in the site's file (none: nothing to build) */
  murals: () => Promise<readonly Mural[]>;
  /** their drawings fetched and decoded, their strips made
   *  (mural-layer.ts `buildMurals`) */
  build: (
    murals: readonly Mural[],
    signal: AbortSignal
  ) => Promise<MuralLayer | null>;
}

/**
 * A city tile's murals as a late part of its content root (late-parts.ts):
 * built outside the dressings' lane (a fetch and a decode a drawing, no long
 * main-thread task), weighed from their build, compiled before they hang
 * and hung once that compile has ended — nothing waits on them — each shown
 * while its building is (`CityLayer.hang`), and freed with the tile.
 */
export function muralsPart(site: MuralSite): LatePart<MuralLayer> {
  return {
    kind: "murals",
    tile: site.tile,
    rank: null,
    hangAt: "compile",
    build: async (signal) => {
      const murals = await site.murals();
      return murals.length > 0 ? await site.build(murals, signal) : null;
    },
    objects: (layer) => compileRepresentatives([layer.group]),
    bytes: (layer) => layer.bytes,
    hang: (layer) => {
      site.root.add(layer.group);
      for (let i = 0; i < layer.meshes.length; i += 1) {
        site.city.hang(layer.meshes[i], layer.murals[i].building);
      }
      return () => {
        layer.group.removeFromParent();
      };
    },
    free: (layer) => {
      try {
        layer.dispose();
        return [];
      } catch (error) {
        return [error];
      }
    },
  };
}

/** A promise's resolver until its executor has run. */
const unresolved = (): void => undefined;

/**
 * The 3DTilesRendererJS plugin that dresses content as it loads. Runs inside
 * the renderer's own load (awaited before the tile is marked loaded), so a
 * tile is never shown half-dressed.
 */
export class DressingPlugin {
  name = "BRIDGE_DRESSING";
  /** every content root dressed and not yet released: a Map, not a
   *  WeakMap, so the stream's dispose can release them all (see dispose) */
  readonly dressed = new Map<Object3D, Dressed>();
  /** the content root a tile is being dressed for (before the renderer
   *  records it in engineData, which it skips when the load is aborted) */
  private readonly sceneOf = new WeakMap<object, Object3D>();
  /** content roots whose tile was disposed; whatever lands for them later
   *  is released on the spot */
  private readonly released = new WeakSet<Object3D>();
  /** Content roots whose geometries and materials are already freed. */
  private readonly freed = new WeakSet<Object3D>();
  /**
   * The compiles still running on a content root (its own, its
   * dressing's), which may outlast the wait a tile gives them. A root is
   * freed only once they end: three cannot stop a compile, and one that
   * resumes on a drawable freed meanwhile uploads its geometry again and
   * makes bindings for a render object already dropped — nothing would
   * free those again.
   */
  private readonly compiles = new Map<Object3D, number>();
  /** each content root's own geometries (its glTF's and the water's), and
   *  the roots whose own compile still runs (disposeContentNow) */
  private readonly contentOf = new WeakMap<Object3D, Set<BufferGeometry>>();
  private readonly contentCompiling = new WeakSet<Object3D>();
  /**
   * Settles once the renderer is done with a content root's load: it
   * records every material in the content right after `processTileModel`
   * (and disposes them all when it unloads the tile), so nothing wearing a
   * scene-wide material may hang there before — a dressing that landed
   * while the tile still compiled had its crowns', hedges' and lamps'
   * materials disposed for the whole scene when the tile left, and every
   * tile rebuilt their shaders inside the frames of a flight.
   */
  private readonly loaded = new WeakMap<Object3D, Promise<void>>();
  /** what settles `loaded`: the renderer's load-model (`landed`), the
   *  moment it records the content and before any frame shows it */
  private readonly settles = new WeakMap<Object3D, () => void>();
  /** the boot's spawn tile is shown bare, its dressing after the gate */
  private gateOpen = false;
  /** tiles whose dressing was tried (see TileStream.dressingSettled) */
  readonly settled = new Set<string>();
  private tiles: PluginTiles | null = null;
  /** the tile a content root was loaded for (to reweigh it) */
  private readonly tileOf = new WeakMap<Object3D, object>();
  /** the site's rasters: what the content roots read, by kind, shared by
   *  file and weighed a share per terrain level (tile-rasters.ts) */
  readonly rasters: TileRasters;
  /** the coarse level's grid index and water index, one copy for the
   *  site (terrain-layer.ts `GridShare`) */
  private readonly grids: GridShare = createGridShare();
  /** ends the levels' waits on their rasters when the stream goes (the
   *  loads themselves are the rasters module's, `clearShared`) */
  private readonly lifetime = new AbortController();
  /**
   * Each terrain level's raster loads while it dresses, aborted when its
   * tile leaves (`disposeTile`): a level the camera wanted and dropped
   * again — a flight, a boot that looked around, the memory emergency's
   * shed — would otherwise decode and upload every raster it names, in
   * the site-wide turn of the tiles still wanted and holding one of the
   * renderer's parse slots, only to free them at once.
   */
  private readonly loadAborts = new WeakMap<Object3D, AbortController>();

  private readonly ctx: TileStreamContext;
  /** a hung dressing's crowns changed: once per season change for all */
  private readonly castersChanged: () => void;
  private readonly stream: Pick<
    TileStream,
    "cities" | "demolished" | "demolishedGroups" | "dressings" | "terrains"
  >;

  constructor(
    ctx: TileStreamContext,
    stream: Pick<
      TileStream,
      "cities" | "demolished" | "demolishedGroups" | "dressings" | "terrains"
    >
  ) {
    this.ctx = ctx;
    this.stream = stream;
    this.rasters = createTileRasters({
      renderer: ctx.renderer,
      url: this.url,
      lowRasters: ctx.lowRasters,
      // (a root that left is not reweighed: the renderer may be evicting its
      // tile, and weighing it there adds its bytes back for good)
      onShareChange: (root) => {
        const tile = this.tileOf.get(root as Object3D);
        if (tile && !this.released.has(root as Object3D)) {
          this.tiles?.recalculateBytesUsed(tile);
        }
      },
    });
    this.castersChanged = castersBatch({
      castersChanged: () => {
        if (!this.disposed) {
          ctx.environment.castersChanged();
        }
      },
    });
    this.lane = createLateLane(ctx.dressingGate);
    // The warm-up runs beside the dressings, not ahead of them: its compile
    // may take up to COMPILE_WAIT_MS, and the spawn tile's trees need none
    // of its programs (they compile their own).
    this.warmWhenOpen().catch(() => {
      // Without the warm-up a date change compiles in a frame; the
      // stream goes on.
    });
  }

  /** Warms the crowns' programs once the dressing gate opens. */
  private async warmWhenOpen(): Promise<void> {
    await this.ctx.dressingGate;
    this.gateOpen = true;
    await this.warmCrowns();
  }

  init(tiles: PluginTiles): void {
    this.tiles = tiles;
  }

  /** Where a coarse level's crowns stand in on its fine level
   *  (`standInCrowns`): beside the renderer's group, which only the
   *  renderer fills, in the content roots' frame. */
  private readonly standIns = (() => {
    const group = new Group();
    group.name = "coarse-crowns-stand-in";
    group.matrixAutoUpdate = false;
    return group;
  })();

  /**
   * Moves each coarse level's crowns onto its tile's fine level while that
   * shows without its own trees, and home again once they hang
   * (lib/city/coarse-crowns.ts `coarseCrownsStandIn`). The crowns are
   * built, compiled and weighed with the coarse level already; they leave
   * with it (`disposeDressing` takes them from wherever they hang).
   */
  standInCrowns(isShown: (object: Object3D) => boolean): void {
    const group = this.tiles?.group;
    if (!group?.parent) {
      return;
    }
    for (const { coarse, crowns, fine } of this.coarseCrownLevels()) {
      const standIn = coarseCrownsStandIn({
        coarse: isShown(coarse),
        fine: fine?.terrain ? isShown(fine.terrain.mesh) : false,
        fineDressed: fine?.dressing !== undefined,
      });
      const home = standIn ? this.standIns : coarse;
      if (crowns.parent === home) {
        continue;
      }
      if (standIn) {
        // every content root carries the same matrix (no tile transforms):
        // the renderer's up-axis turn
        group.parent.add(this.standIns);
        this.standIns.matrix.multiplyMatrices(group.matrix, coarse.matrix);
        this.standIns.updateMatrixWorld(true);
      }
      home.add(crowns);
      crowns.updateMatrixWorld(true);
    }
  }

  /** Each tile whose coarse level has crowns: its content root, the
   *  crowns, and its fine level's entry if it has one. */
  private coarseCrownLevels(): {
    coarse: Object3D;
    crowns: Object3D;
    fine?: Dressed;
  }[] {
    const coarse = new Map<string, { scene: Object3D; crowns: Object3D }>();
    const fine = new Map<string, Dressed>();
    for (const [scene, entry] of this.dressed) {
      const control = entry.dressing?.vegetation;
      if (entry.terrain?.level === 0) {
        fine.set(entry.terrain.tile, entry);
      } else if (entry.terrain && control) {
        coarse.set(entry.terrain.tile, { scene, crowns: control.group });
      }
    }
    return [...coarse].map(([tile, { scene, crowns }]) => ({
      coarse: scene,
      crowns,
      fine: fine.get(tile),
    }));
  }

  /** The renderer has marked `scene`'s tile loaded (its load-model): the
   *  content is recorded, and no frame has shown it yet. */
  landed(scene: Object3D): void {
    this.settles.get(scene)?.();
    this.settles.delete(scene);
  }

  /**
   * Whether `extras`' level takes over from the tile's other level, which
   * is on screen now. The renderer keeps that one drawn until this one is
   * loaded (3D Tiles' REPLACE refinement, both ways), so this one is
   * loaded only once its dressing is built and compiled too: the trees,
   * lamps and bridges of one level leave in the frame the next level's
   * arrive, instead of a gap between the two. A tile with no level on
   * screen shows at once and is dressed after (nothing to hand over); so
   * does the boot's spawn tile, whose dressing waits for the gate.
   */
  private handsOver(extras: TerrainExtras): boolean {
    if (!(this.gateOpen && this.tiles)) {
      return false;
    }
    const shown = [...this.tiles.visibleTiles].map(
      (tile) =>
        (tile as { engineData?: { scene?: Object3D | null } }).engineData?.scene
          ?.userData as Partial<ContentExtras> | undefined
    );
    return takesOver(extras, shown);
  }

  /**
   * What the tile cache weighs a tile by on top of its glTF (the renderer
   * counts that one and sums every plugin's): the rasters its terrain
   * holds and its dressing's geometry, which the renderer cannot see — it
   * reads textures off the glTF's materials. Without them an iPhone's
   * cache sat at 173 MB of its 180 while the GPU held 865 MB, and the next
   * buffer failed to allocate. Less the site's shared buffers it counted in
   * the glTF (`sharedBytes`): evicting the tile frees none of them.
   */
  calculateBytesUsed(_tile: object, scene: Object3D | null): number {
    // (a tile still in processTileModel weighs nothing yet: the renderer
    // drops a new tile from a full cache only while it weighs 0)
    const dressed = scene ? this.dressed.get(scene) : undefined;
    if (!(scene && dressed)) {
      return 0;
    }
    const held = dressed.terrain ? this.rasters.bytesOf(scene) : 0;
    const own = (dressed.terrain?.rasters ?? []).reduce(
      (bytes, texture) => bytes + trackedBytesOf(texture),
      0
    );
    return held + own + dressed.late.bytes() - (dressed.sharedBytes ?? 0);
  }

  private readonly url = (file: string): string =>
    new URL(file, new URL(this.ctx.tilesetUrl, window.location.href)).href;

  async processTileModel(scene: Object3D, tile: object): Promise<void> {
    this.tileOf.set(scene, tile);
    let settle = unresolved;
    this.loaded.set(
      scene,
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    this.settles.set(scene, settle);
    try {
      await this.dressContent(scene, tile);
    } finally {
      // The renderer records the content in the continuation of this call
      // and then says so (`landed`); a load it drops says nothing, and by
      // the next task it has dropped it.
      setTimeout(() => this.landed(scene), 0);
    }
  }

  private async dressContent(scene: Object3D, tile: object): Promise<void> {
    const extras = scene.userData as ContentExtras;
    // The content's own mesh by its node name ("terrain", "city"); the fine
    // terrain also carries a "stairs" node.
    const mesh = meshNamed(scene, extras.kind) ?? firstMesh(scene);
    if (!mesh) {
      return;
    }
    this.sceneOf.set(tile, scene);
    // (A city's own dressing in this task: its compile is counted on the
    // tile before anything can unload it.)
    let dressed: Promise<void> | undefined;
    if (extras.kind === "city") {
      streamTimings.timedSync(
        "tile:city",
        () => this.dressCity(scene, mesh, extras),
        extras.tileId
      );
      // the murals hang on the full LoD2 only (the far level's walls are
      // simplified by half a metre: lib/city/tileset.ts FAR_CITY_ERROR)
      if ((tile as { geometricError?: number }).geometricError === 0) {
        this.addMurals(scene, extras.tileId);
      }
    } else if (extras.kind === "terrain") {
      ({ dressed } = await streamTimings.timed(
        "tile:rasters",
        async () => await this.dressTerrain(scene, mesh, extras),
        extras.tileId
      ));
    }
    // The renderer shows the tile once this resolves: its programs are
    // ready by then instead of compiling inside a frame. (A tile that left
    // meanwhile is not compiled: that would upload what nothing shows.)
    if (!this.released.has(scene)) {
      await streamTimings.timed(
        "tile:compile",
        async () => await withinCompileWait(this.compileContent(scene)),
        extras.tileId
      );
    }
    if (dressed && extras.kind === "terrain") {
      await this.waitHandOver(scene, extras, dressed);
    }
    // Disposed while it was being dressed: the renderer drops an aborted
    // load without ever recording the scene, so nothing else frees it. The
    // same once the stream is gone (its plugins are unregistered first) —
    // left first: one whose compile still runs is released as it ends.
    if (this.disposed || this.released.has(scene)) {
      this.leave(scene);
      this.release(scene);
      return;
    }
    // A load the renderer aborts while this ran (a flight outruns it) is
    // dropped right after this resolves, and then it frees the content's
    // textures only (TilesRenderer.parseTile) — the geometry the compile
    // above uploaded would stay on the GPU. Whether it kept the scene is
    // settled by the next task.
    setTimeout(() => {
      const kept = (tile as { engineData?: { scene?: Object3D | null } })
        .engineData?.scene;
      if (kept === scene || this.released.has(scene)) {
        return;
      }
      if (this.sceneOf.get(tile) === scene) {
        this.sceneOf.delete(tile);
      }
      this.leave(scene);
      this.release(scene);
    }, 0);
  }

  /** ...and, where a level takes over from its tile's other level, its
   *  dressing with it (handsOver) — for as long as a parse slot may wait
   *  on this tier (`handOverWaitMs`; a phone's not at all). */
  private async waitHandOver(
    scene: Object3D,
    extras: TerrainExtras,
    dressed: Promise<void>
  ): Promise<void> {
    const wait = handOverWaitMs(this.ctx.tier);
    if (wait === 0 || this.released.has(scene) || !this.handsOver(extras)) {
      return;
    }
    await streamTimings.timed(
      "tile:handover-wait",
      async () => await withinWait(dressed, wait),
      extras.tileId
    );
  }

  private dressCity(scene: Object3D, mesh: Mesh, extras: CityExtras): void {
    const demolished = this.stream.demolished.get(extras.tileId) ?? new Set();
    const city = dressCity(
      mesh,
      extras.tileId,
      this.ctx.styleResources,
      demolished,
      this.stream.demolishedGroups
    );
    this.stream.cities.add(city);
    const entry: Dressed = { city, late: this.lateParts(scene) };
    this.dressed.set(scene, entry);
    if (extras.svf) {
      this.shareSkyView(scene, entry, extras);
    }
    // What street photos say about the facades lands after the buildings
    // show; until then (and without it) they are drawn as before.
    if (extras.facades) {
      void fetchOptionalJson<FacadeReadings>(this.url(extras.facades)).then(
        (readings) => {
          if (readings && this.dressed.get(scene) === entry) {
            city.facadeReadings(readings);
          }
          return null;
        }
      );
    }
  }

  /** A city tile's murals land after its buildings show, as a late part of
   *  its content root (`muralsPart`). */
  private addMurals(scene: Object3D, tileId: string): void {
    const source = this.ctx.murals;
    const entry = this.dressed.get(scene);
    const city = entry?.city;
    if (!(source && city)) {
      return;
    }
    entry.late.add(
      muralsPart({
        tile: tileId,
        root: scene,
        city,
        murals: async () => await source.forTile(tileId),
        build: async (murals, signal) =>
          await buildMurals(murals, {
            fileUrl: source.fileUrl,
            offset: this.ctx.offset,
            phone: this.ctx.tier === "mobile",
            signal,
          }),
      })
    );
  }

  /** The facades' sky view lands after the buildings show (the clay binds
   *  an open sky until then); held until the city tile leaves. */
  private shareSkyView(
    scene: Object3D,
    entry: Dressed,
    extras: CityExtras
  ): void {
    const bounds = this.ctx.tileBounds(extras.tileId);
    // not weighed: a building tile weighs no raster
    entry.svf = this.rasters.holder(scene, { weighed: false });
    void entry.svf.acquire("svf", extras).then((texture) => {
      const { city } = entry;
      if (texture && bounds && city && this.dressed.get(scene) === entry) {
        const [minX, minY, maxX, maxY] = bounds;
        const { cx, cy } = this.ctx.offset;
        setClaySkyView(
          city.mesh.material as MeshStandardNodeMaterial,
          texture,
          [minX - cx, maxY - cy],
          [maxX - minX, maxY - minY]
        );
      }
      return null;
    });
  }

  /** Dresses a terrain level's ground and queues the rest of its dressing
   *  (`dressed`: built and compiled — wrapped, since an async function
   *  would wait for a promise it returns). */
  private async dressTerrain(
    scene: Object3D,
    mesh: Mesh,
    extras: TerrainExtras
  ): Promise<{ dressed?: Promise<void> }> {
    // Local → data frame: the node's dequantisation, then the content root's
    // glTF→3D Tiles up-axis turn (the tileset frame IS the data frame). Each
    // level its own: the dressing reads it again after its rasters load,
    // when other tiles' dressings have started (one shared matrix gave the
    // water sheets another tile's frame — their triangles chosen over dry
    // land, the river left without them).
    scene.updateMatrix();
    mesh.updateMatrix();
    const toData = new Matrix4().multiplyMatrices(scene.matrix, mesh.matrix);
    const own = new AbortController();
    this.loadAborts.set(scene, own);
    const either = eitherSignal(own.signal, this.lifetime.signal);
    let terrain: TerrainLayer;
    const rasters = this.rasters.holder(scene);
    try {
      terrain = await dressTerrain(mesh, extras, toData, {
        fogColor: this.ctx.fogColor,
        ground: this.ctx.ground,
        offset: this.ctx.offset,
        rasters,
        grids: this.grids,
        signal: either.signal,
      });
    } catch (error) {
      // no terrain to dispose them: its hold goes here, or its rasters stay
      // on the GPU for the session
      rasters.release();
      throw error;
    } finally {
      either.release();
      this.loadAborts.delete(scene);
    }
    try {
      // The fine level's baked stairs, walls, kerbs and fences: only their
      // materials here, lit by the tile's baked light as the ground is.
      const stairs = meshNamed(scene, "stairs");
      if (stairs) {
        dressStairs(stairs, terrain.light);
        terrain.stairs = stairs;
      }
      const walls = meshNamed(scene, "walls");
      if (walls) {
        dressWalls(walls, terrain.light);
        terrain.walls = walls;
      }
      const kerbs = meshNamed(scene, "kerbs");
      if (kerbs) {
        dressKerbs(kerbs, terrain.light);
        terrain.kerbs = kerbs;
      }
      const fences = meshNamed(scene, "fences");
      if (fences) {
        dressFences(fences, terrain.light);
        terrain.fences = fences;
      }
      this.stream.terrains.add(terrain);
    } catch (error) {
      // not in `dressed` yet, so no release will free it: its rasters
      // would stay held for the session
      terrain.dispose();
      throw error;
    }
    this.dressed.set(scene, {
      terrain,
      late: this.lateParts(scene),
      sharedBytes: sceneSharedBytes(scene),
    });
    rasters.settle();
    const coarse = COARSE_DRESSING_KINDS.some((kind) => extras.coarse?.[kind]);
    return extras.dressing || coarse
      ? { dressed: this.queueDressing(scene, terrain, extras) }
      : {};
  }

  /** The site's lane for what lands late (late-parts.ts): the dressings
   *  build one at a time after the gate, each a long task. The crowns'
   *  seasonal programs warm up beside them (warmCrowns). */
  private readonly lane: LateLane;

  /** What one content root's late parts are given: its compiles counted
   *  on it (its release waits), its record by the renderer, its weight. */
  private lateParts(scene: Object3D): LateParts {
    const host: LateHost = {
      lane: this.lane,
      compile: async (objects, where) =>
        await this.compileUnder(scene, objects, where),
      loaded: async () => {
        const loaded = this.loaded.get(scene);
        if (loaded === undefined) {
          throw new Error("a late part on a content the renderer never loaded");
        }
        await loaded;
      },
      disposed: () => this.disposed,
      reweigh: () => this.reweigh(scene),
      changed: () => {
        if (!this.disposed) {
          this.ctx.onChange();
        }
      },
      allocationFailure: (error, where) =>
        this.ctx.onAllocationFailure?.(error, where),
      failed: (error, tile) => this.ctx.onDressingFailed?.(error, tile),
      freeFailed: (errors) => this.disposeFailed(errors, scene),
    };
    return createLateParts(host);
  }

  /** `scene`'s tile has left: what is still to land on it never does (its
   *  builds abort, its hand-over stops waiting) — even while its release
   *  waits for a compile. */
  private leave(scene: Object3D): void {
    this.released.add(scene);
    this.dressed.get(scene)?.late.leave();
  }
  pending = 0;
  /** the dressings queued or building: their scene's site tile */
  private readonly pendingScenes = new Map<Object3D, string>();

  /** The site tiles of the dressings queued or building whose tile is in
   *  view: one behind the camera does not hold the loading frontier. */
  pendingTilesInView(into: Set<string>, frame: number): void {
    for (const [scene, id] of this.pendingScenes) {
      const tile: OrderedTile | undefined = this.tileOf.get(scene);
      // a dressing whose tile the traversal no longer visits is out of
      // view; one whose tile has left will never come
      if (this.released.has(scene)) {
        continue;
      }
      if (!tile?.traversal || inViewNow(tile, frame)) {
        into.add(id);
      }
    }
  }
  private warmup: CrownWarmup | null = null;
  private disposed = false;

  /**
   * Builds, once per scene and before the first tree lands, the crown
   * materials a date change may switch to: the seasonal and the plain crown
   * (crown-season.ts) — no tile's compile reaches the ones its crowns do not
   * wear yet. The stand-ins stay (holding their builds) until the stream
   * goes. A crown's shadow is its own material under the shadow pass (the
   * seasonal crown thins it through `maskNode`), so there is no depth
   * material to warm.
   */
  private async warmCrowns(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const warmup = buildCrownWarmup();
    this.warmup = warmup;
    const compileAll = async () => {
      try {
        await Promise.all(
          warmup.main.map(async (mesh) => await this.ctx.compile(mesh))
        );
      } catch (error) {
        this.compileFailed(error, "crowns");
      }
    };
    await withinCompileWait(compileAll());
  }

  /** What a compile that threw comes to: out of memory (reported) or a
   *  failure the frames will meet again. */
  private compileFailed(err: unknown, where: string): Compiled {
    if (!isAllocationFailure(err)) {
      return "failed";
    }
    this.ctx.onAllocationFailure?.(err, where);
    return "out of memory";
  }

  /** Reports the first thing a tile's release threw (three's half-made
   *  attribute of a failed allocation: the release went on past it). */
  private disposeFailed(errors: unknown[], scene: Object3D): void {
    if (errors.length > 0 && !this.disposed) {
      this.ctx.onAllocationFailure?.(errors[0], `dispose ${tileIdOf(scene)}`);
    }
  }

  /**
   * Called by the renderer when the stream is disposed — before it disposes
   * its tiles, and with this plugin already unregistered, so `disposeTile`
   * never runs for them: every dressed tile is released here, and the
   * shared rasters with them (once no compile runs). Whatever is still
   * being built finds the stream gone and frees itself (processTileModel,
   * queueDressing).
   */
  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.warmup?.dispose();
    this.warmup = null;
    this.standIns.removeFromParent();
    // (release deletes the entry it is on: a Map iterates on safely)
    for (const scene of this.dressed.keys()) {
      // left first: one whose compile still runs is released as it ends
      this.leave(scene);
      this.release(scene);
    }
    this.clearShared();
  }

  /** The site's shared rasters go with the stream — once no compile runs
   *  (the last one to end calls this again): one still running would
   *  upload a freed raster again, which nothing would free. */
  private clearShared(): void {
    if (this.compiles.size > 0) {
      return;
    }
    this.rasters.clear();
  }

  /**
   * Builds the tile's dressing in its turn and hangs it on the tile, as a
   * late part of its content root (late-parts.ts, `dressingPart`). The
   * promise settles once the dressing is built and its compile wait is over
   * (or it is given up), before it hangs: it hangs as soon as the renderer
   * has recorded the tile's own content (`loaded`), before any frame — so a
   * tile that waits for it (handsOver) is shown with it.
   */
  private async queueDressing(
    scene: Object3D,
    terrain: TerrainLayer,
    extras: TerrainExtras
  ): Promise<void> {
    const entry = this.dressed.get(scene);
    if (!entry) {
      return;
    }
    this.pending += 1;
    this.pendingScenes.set(scene, extras.tileId);
    const handle = entry.late.add(
      dressingPart({
        tile: extras.tileId,
        level: extras.dressing ? "fine" : "coarse",
        root: scene,
        slot: entry,
        dressings: this.stream.dressings,
        live: () => !this.disposed,
        failed: (err, tile) => this.ctx.onDressingFailed?.(err, tile),
        freeFailed: (errors) => this.disposeFailed(errors, scene),
        parts: entry.late,
        look: this.ctx.environment.look,
        build: async (signal) => {
          const dressing = await buildDressing(
            terrain,
            extras,
            this.ctx,
            this.url,
            signal
          );
          // It follows the scene's season from here on, so it compiles as
          // the frames will draw it — in its season (which swaps crown
          // materials) — before it hangs anywhere: a build three keys
          // differently from what a frame asks for compiles inside that
          // frame. One that throws here never hangs: it is freed, not left
          // to nothing.
          try {
            dressing.unfollow = followEnvironment(
              dressing,
              this.ctx.environment,
              {
                hung: () => this.stream.dressings.has(dressing),
                changed: this.castersChanged,
              }
            );
          } catch (error) {
            this.disposeFailed(disposeDressing(dressing), scene);
            throw error;
          }
          return dressing;
        },
      })
    );
    const finish = async () => {
      await handle.settled;
      this.pending -= 1;
      this.pendingScenes.delete(scene);
      // A tile is dressed when its fine level is (the coarse one only
      // stands in for it).
      if (extras.level === 0) {
        this.settled.add(extras.tileId);
      }
      if (!this.disposed) {
        this.ctx.onChange();
      }
    };
    void finish();
    await handle.ready;
  }

  /** The cache weighs `scene`'s tile again (the whole cache: none known). */
  private reweigh(scene: Object3D): void {
    const tile = this.tileOf.get(scene);
    if (tile) {
      this.tiles?.recalculateBytesUsed(tile);
    } else {
      this.tiles?.recalculateBytesUsed();
    }
  }

  disposeTile(tile: { engineData?: { scene?: Object3D | null } }): void {
    const scene = tile.engineData?.scene ?? this.sceneOf.get(tile);
    this.sceneOf.delete(tile);
    if (scene) {
      // its rasters stop where they are (the load this rejects is the
      // renderer's to drop: its own signal is aborted by now)
      this.loadAborts.get(scene)?.abort();
      this.leave(scene);
      this.release(scene);
      this.disposeContentNow(scene);
    }
  }

  /**
   * Compiles `objects` (the root or what hangs under it), counted on
   * `scene` until they end (see `compiles`). Resolves how it ended (a
   * failure for want of memory reported as `where`); never rejects.
   */
  private async compileUnder(
    scene: Object3D,
    objects: Object3D[],
    where: string
  ): Promise<Compiled> {
    this.compiles.set(scene, (this.compiles.get(scene) ?? 0) + 1);
    const compile = async (): Promise<Compiled> => {
      try {
        const compiled = await Promise.all(
          objects.map(async (o) => await this.ctx.compile(o))
        );
        return compiled.every(Boolean) ? "done" : "not run";
      } catch (error) {
        return this.compileFailed(error, where);
      }
    };
    const done = compile();
    const uncount = () => {
      const left = (this.compiles.get(scene) ?? 1) - 1;
      if (left > 0) {
        this.compiles.set(scene, left);
        return;
      }
      this.compiles.delete(scene);
      if (this.released.has(scene)) {
        this.release(scene);
      }
      if (this.disposed) {
        this.clearShared();
      }
    };
    // a release that throws must not surface as an unhandled rejection
    const settleAfter = async () => {
      try {
        await done;
        uncount();
      } catch {
        // swallowed on purpose, see above
      }
    };
    void settleAfter();
    return await done;
  }

  /**
   * The content's own compile — and once it has uploaded the content, the
   * CPU copies of what nothing reads any more go (`dropContentCopies`).
   */
  private async compileContent(scene: Object3D): Promise<Compiled> {
    // the content's own geometries, before any dressing hangs beside them
    // (disposeContentNow)
    const content = new Set<BufferGeometry>();
    scene.traverse((obj) => {
      const { geometry } = obj as Object3D & { geometry?: BufferGeometry };
      if (geometry) {
        content.add(geometry);
      }
    });
    this.contentOf.set(scene, content);
    this.contentCompiling.add(scene);
    const compiled = this.compileUnder(
      scene,
      [scene],
      `content ${tileIdOf(scene)}`
    );
    const afterCompile = async () => {
      try {
        const ended = await compiled;
        this.contentCompiling.delete(scene);
        if (ended === "done") {
          this.dropContentCopies(scene);
        }
      } catch {
        // a drop that throws must not surface as an unhandled rejection
      }
    };
    void afterCompile();
    return await compiled;
  }

  /**
   * Drops the CPU copies of the content's buffers that the GPU has and
   * nothing reads on the CPU (three-utils.ts `dropCpuCopies`): a terrain
   * level's (terrain-layer.ts `cpuDroppable`), a city's normals and roof
   * flags (`cityCpuDroppable`). Not for a tile that left or a stream that
   * went: its buffers go with it.
   */
  private dropContentCopies(scene: Object3D): void {
    const entry = this.dressed.get(scene);
    if (this.disposed || this.released.has(scene) || !entry) {
      return;
    }
    let drop: Parameters<typeof dropCpuCopies>[1] = [];
    if (entry.terrain) {
      drop = cpuDroppable(entry.terrain);
    } else if (entry.city) {
      drop = cityCpuDroppable(entry.city);
    }
    dropCpuCopies(scene, drop);
    this.ctx.onCopiesDropped?.();
  }

  /** Frees everything dressed onto one content root — once its compiles
   *  have ended (see `compiles`; the last one to end calls this again). */
  private release(scene: Object3D): void {
    // The site's shared buffers leave its geometries at once, whatever
    // still compiles: the tile renderer disposes them right after this
    // plugin let go of the tile, and three's dispose would destroy those
    // buffers for every other tile (three-utils.ts `markSceneShared`).
    detachSceneShared(scene);
    if (this.compiles.has(scene)) {
      return;
    }
    const dressed = this.dressed.get(scene);
    const errors = dressed ? this.releaseDressed(scene, dressed) : [];
    // The content itself, once — buildings, ground, and the walls, stairs,
    // kerbs and fences baked into it: its geometries, the per-tile
    // materials the dressing put on it (the renderer frees only the glTF's
    // own, which those replaced) and the render objects of everything in
    // it, which a scene-wide material never frees. On a normal unload the
    // renderer disposes the geometries again (a no-op); on an aborted load
    // it never does, and a compile has uploaded them by then.
    if (!this.freed.has(scene)) {
      this.freed.add(scene);
      errors.push(...disposeObject3D(scene));
    }
    this.disposeFailed(errors, scene);
    if (dressed && !this.disposed) {
      this.ctx.onChange();
    }
  }

  /**
   * The content's geometries freed now, though the rest of the tile waits
   * for its dressing's compile (`release`): the tile renderer disposes them
   * right after this plugin let go of the tile, and on a geometry with an
   * attribute that failed to allocate three's dispose throws out of the
   * renderer's update. Freed here past that attribute (three-utils.ts
   * `disposeGeometry`), its later dispose is a no-op. Not while the
   * content's own compile runs: it would upload them again.
   */
  private disposeContentNow(scene: Object3D): void {
    const content = this.contentOf.get(scene);
    if (!content || this.freed.has(scene) || this.contentCompiling.has(scene)) {
      return;
    }
    this.disposeFailed(
      [...content].flatMap((geometry) => disposeGeometry(geometry)),
      scene
    );
  }

  /** Frees what was dressed onto `scene`; returns what threw on the way
   *  (the rest is freed regardless). */
  private releaseDressed(scene: Object3D, dressed: Dressed): unknown[] {
    this.dressed.delete(scene);
    const errors: unknown[] = [];
    const free = (dispose: () => void) => {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    };
    if (dressed.city) {
      this.stream.cities.delete(dressed.city);
      free(() => dressed.city?.dispose());
    }
    dressed.svf?.release();
    if (dressed.terrain) {
      this.stream.terrains.delete(dressed.terrain);
      free(() => dressed.terrain?.dispose());
    }
    // its dressing, hung or not: taken down now (off the root the content's
    // dispose below walks), freed now or a few microtasks on — its part
    // learns its compile has ended after the plugin's count does
    errors.push(...dressed.late.release());
    return errors;
  }
}

/**
 * Lets go of the glTF loader's result the tile renderer keeps with a loaded
 * tile (`engineData.metadata`), and with it the loader's parser: the glb's
 * binary chunk and every buffer it decoded — what keeps a tile's whole
 * geometry on the CPU however many of its attributes give up their copy
 * (three-utils.ts `dropCpuCopies`): 1.3 / 2.4 / 4.4 MB of chunk for a
 * coarse / city / fine content besides. Only Google's copyright plugin
 * reads it, which this viewer does not use; the scene stays.
 */
export function dropLoaderResult(tile: unknown): void {
  const data = (tile as { engineData?: { metadata?: unknown } }).engineData;
  if (data) {
    data.metadata = null;
  }
}

/**
 * How many tile contents a phone downloads (per origin) and parses at once.
 * The tile renderer's own queues (25 downloads, 5 parses) asked for the
 * boot's eleven contents in one millisecond, and a parse holds its decoded
 * glTF, its rasters and its compile until it is through: several hundred
 * MB on the page's process before anything reached the GPU, and Safari
 * ended the page at the first frame. Two parses keep a neighbour coming
 * while the spawn tile compiles.
 */
export const PHONE_STREAM = { parses: 2, downloadsPerOrigin: 4 } as const;

/**
 * Gives the renderer queues of its own, in our order (lib/city/stream-order.ts:
 * the coarse ground before the buildings, nearer before farther, the
 * boot's tile first until its first frame; a full cache admits in the
 * same order, `keepOrder`), and on a
 * phone at `PHONE_STREAM`'s limits. Before its first update (the renderer
 * takes them up then). The defaults are module-wide queues every renderer
 * shares, so they are replaced, not changed: a second app (a StrictMode
 * remount) keeps its own.
 */
export function orderStreaming(
  tiles: TilesRenderer,
  tier: DeviceTier,
  bootTile: () => string | null
): void {
  const order = streamOrder(bootTile);
  const parse = new PriorityQueue();
  parse.maxJobs =
    tier === "mobile" ? PHONE_STREAM.parses : tiles.parseQueue.maxJobs;
  parse.priorityCallback = order;
  tiles.parseQueue = parse;
  const download = new DownloadPriorityQueue();
  download.maxJobsPerOrigin =
    tier === "mobile"
      ? PHONE_STREAM.downloadsPerOrigin
      : tiles.downloadQueue.maxJobsPerOrigin;
  download.priorityCallback = order;
  tiles.downloadQueue = download;
  // a full cache admits loads in the order it keeps tiles: ground first
  // there too (the cache is the renderer's module-wide one, used by no
  // other renderer here; wrapped once)
  const cache = tiles.lruCache as unknown as {
    unloadPriorityCallback: KeepOrderCallback & { [KEEP_ORDER]?: true };
  };
  if (!cache.unloadPriorityCallback[KEEP_ORDER]) {
    const kept = Object.assign(keepOrder(cache.unloadPriorityCallback), {
      [KEEP_ORDER]: true as const,
    });
    cache.unloadPriorityCallback = kept;
  }
}

type KeepOrderCallback = Parameters<typeof keepOrder>[0];
const KEEP_ORDER = Symbol("keepOrder");

/**
 * Starts streaming the tileset under `world` (the viewer's rotated Z-up
 * group). `cameras` decide what loads: the view camera, and the sun's shadow
 * camera, so a building behind the player still casts into the view — the
 * latter at a resolution of its own (lib/city/shadow-fit.ts
 * `shadowStreamResolution`), so it loads a tile's buildings and coarse
 * ground but never refines its terrain.
 */
export function createTileStream(
  ctx: TileStreamContext,
  world: Group,
  cameras: { camera: Camera; height: number; width: number }[]
): TileStream {
  const tiles = new TilesRenderer(ctx.tilesetUrl);
  orderStreaming(tiles, ctx.tier, ctx.bootTile);
  setRasterTier(ctx.tier);
  tiles.registerPlugin(new ContentFetchPlugin());
  // The decoder's own workers: without them a tile's meshopt buffers (75 MB
  // decoded for a dense building tile) decode on the main thread, inside
  // the parse that lands it. Idempotent: a remount keeps the same workers.
  meshoptDecoder.useWorkers(MESHOPT_WORKERS[ctx.tier]);
  tiles.registerPlugin(new GltfContentPlugin(meshoptDecoder));
  // Out-of-view tiles that are still active stay drawn (shadows, turning on
  // the spot); three's own frustum culling keeps them out of the main pass.
  tiles.displayActiveTiles = true;
  tiles.autoDisableRendererCulling = false;
  // What lingers once the camera moves on (tileCacheBytesFor): tiles in use
  // are never unloaded, only the ones left behind.
  tiles.lruCache.minBytesSize = ctx.cacheBytes.min;
  tiles.lruCache.maxBytesSize = ctx.cacheBytes.max;
  // What is shown changes only with these events, so the visible lists are
  // worked out once per change, not on every call (the collider asks for
  // the cities every frame).
  let version = 0;
  const changed = () => {
    version += 1;
    // (the plugin is made below; the renderer calls this only later)
    dressing.standInCrowns(isShown);
    ctx.onChange();
  };
  const memo = <T>(list: () => T[]): (() => T[]) => {
    let at = -1;
    let cached: T[] = [];
    return () => {
      if (at !== version) {
        at = version;
        cached = list();
      }
      return cached;
    };
  };
  // A content root is shown while it is a child of the renderer's group.
  // Walk up from any object inside it; the membership test is not redundant:
  // an active but hidden tile keeps the group as its parent without being
  // one of its children (for raycasting).
  const isShown = (object: Object3D | null): boolean => {
    let root: Object3D | null = object;
    while (root && root.parent !== tiles.group) {
      root = root.parent;
    }
    return root !== null && tiles.group.children.includes(root);
  };
  const stream: TileStream = {
    tiles,
    group: tiles.group,
    cities: new Set(),
    terrains: new Set(),
    dressings: new Set(),
    demolished: new Map(),
    demolishedGroups: new Set(),
    pendingDressings: () => 0,
    dressingSettled: () => false,
    pendingSiteTiles: () => new Set(),
    visibleTerrains: memo(() =>
      [...stream.terrains]
        .filter((t) => isShown(t.mesh))
        .sort((a, b) => a.level - b.level)
    ),
    visibleCities: memo(() =>
      [...stream.cities].filter((c) => isShown(c.mesh))
    ),
    // Every part hangs under its tile's content root: any one tells.
    visibleDressings: memo(() =>
      [...stream.dressings].filter((d) => isShown(dressingParts(d)[0] ?? null))
    ),
    dispose: () => {
      tiles.dispose();
    },
  };
  const dressing = new DressingPlugin({ ...ctx, onChange: changed }, stream);
  stream.pendingDressings = () => dressing.pending;
  stream.dressingSettled = (tileId) => dressing.settled.has(tileId);
  // one set, refilled each frame: this runs in every frame of the session
  const pendingIds = new Set<string>();
  // reason: loadingTiles (its tiles in flight) and frameCount are the
  // renderer's public members; its declaration does not list them.
  const inFlight = tiles as unknown as {
    frameCount: number;
    loadingTiles: Set<OrderedTile>;
  };
  stream.pendingSiteTiles = () => {
    pendingIds.clear();
    const frame = inFlight.frameCount;
    dressing.pendingTilesInView(pendingIds, frame);
    for (const tile of inFlight.loadingTiles) {
      const id = inViewNow(tile, frame) ? siteTileOfTile(tile) : null;
      if (id !== null) {
        pendingIds.add(id);
      }
    }
    return pendingIds;
  };
  tiles.registerPlugin(dressing);
  for (const { camera, width, height } of cameras) {
    tiles.setCamera(camera);
    tiles.setResolution(camera, width, height);
  }
  tiles.addEventListener("load-model", (event) => {
    dropLoaderResult(event.tile);
    dressing.landed(event.scene);
    changed();
  });
  tiles.addEventListener("tile-visibility-change", changed);
  world.add(tiles.group);
  return stream;
}
