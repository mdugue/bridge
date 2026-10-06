import { DownloadPriorityQueue, PriorityQueue } from "3d-tiles-renderer/core";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import {
  type BufferGeometry,
  type Camera,
  type Color,
  Group,
  Matrix4,
  type Mesh,
  type MeshStandardNodeMaterial,
  type Object3D,
  type Texture,
  type UniformNode,
  type Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyExtraFeature,
  CultivatedFeature,
  FurnitureFeature,
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
import type { LookState } from "@/lib/city/look-state";
import { pointFeatures, unpackPoints } from "@/lib/city/point-pack";
import { type SportTable, sportFixtures } from "@/lib/city/sport";
import { offMonuments } from "@/lib/city/tree-placement";
import { unpackCrowns } from "@/lib/city/coarse-crowns";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  type CityExtras,
  type ContentExtras,
  ownsPoint,
  type TerrainExtras,
} from "@/lib/city/tileset";
import { COARSE_DRESSING_KINDS, type DressingKind } from "@/lib/city/tile";
import { bridgeItems, monumentItems, treeSets } from "@/lib/city/ask-items";
import { askSets, type AskSet } from "@/lib/city/ask-solids";
import { isAllocationFailure } from "@/lib/city/gpu-allocation";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import { type CityLayer, dressCity } from "./city-layer";
import { buildCoarseCrowns } from "./coarse-crowns-layer";
import type { CrownWarmup } from "./crown-season";
import { buildVineyards } from "./cultivated-layer";
import { TILE_FETCH_BUDGET_MS } from "@/lib/city/fetch-retry";
import {
  eitherSignal,
  fetchBytes,
  fetchFeatures,
  fetchOptionalBinary,
  fetchOptionalJson,
} from "./fetch-optional";
import { buildFurniture } from "./furniture-layer";
import { buildLamps, type LampControl } from "./lamp-layer";
import { buildLowVegetation } from "./low-vegetation-layer";
import { buildMonuments, type MonumentLayer } from "./monument-layer";
import { buildRail } from "./rail-layer";
import { bridgeAskSet } from "./bridge-ask";
import { buildRiverside } from "./riverside-layer";
import { buildSportFixtures, type SportFixtureLayer } from "./sport-fixtures";
import {
  cpuDroppable,
  createGridShare,
  dressTerrain,
  freeSplatRasters,
  freeSport,
  type GridShare,
  type GroundUniforms,
  loadNdviTexture,
  loadSplatRasters,
  loadSportKey,
  type SplatRasters,
  type SportRasters,
  type TerrainLayer,
} from "./terrain-layer";
import { dressFences } from "./fence-layer";
import { dressKerbs } from "./kerb-layer";
import { RasterShares } from "./raster-shares";
import { setRasterTier } from "./raster-upload";
import type { DeviceTier } from "./scene-profile";
import { createSharedRasters, type SharedRasters } from "./shared-rasters";
import { loadHorizonTexture, loadSkyViewTexture } from "./sky-light";
import { dressStairs } from "./stair-layer";
import {
  type AnyAttribute,
  compileRepresentatives,
  detachSceneShared,
  disposeGeometry,
  disposeObject3D,
  dropCpuCopies,
  estimateGeometryBytes,
  sceneSharedBytes,
} from "./three-utils";
import { buildTraffic } from "./traffic-layer";
import { trafficAskSet } from "./traffic-ask";
import { buildTram } from "./tram-layer";
import { buildTreeInventory } from "./tree-inventory-layer";
import {
  buildCrownWarmup,
  buildVegetation,
  loadNdviSampler,
  type VegetationContext,
  type VegetationControl,
  type VegetationFeatures,
} from "./vegetation-layer";
import { setClaySkyView, type StyleResources } from "./visual-style";
import { dressWalls } from "./wall-layer";

/**
 * The world as it streams in: OGC 3D Tiles (lib/city/tileset.ts) through
 * 3DTilesRendererJS, which decides what to load and unload from the cameras,
 * the screen-space error and a memory budget. This module only dresses what
 * lands — the terrain material, water, buildings, vegetation (canopy,
 * street-tree cadastre, laser-scan trees, hedges), lamps, monuments, street
 * furniture, rails, walls — and undresses what leaves, so every tile is one
 * handle whose content comes and goes with it.
 */
export interface TileDressing {
  /** the trees, monuments and bridge decks the inquiry probe can ask
   *  (lib/city/ask-items.ts; plan 052 phase 4): data, nothing drawn */
  asks?: AskSet<FeatureInquiry>[];
  furniture?: Group;
  lamps?: LampControl;
  /** OSM hedges (low-vegetation-layer.ts): static, no per-frame work */
  lowVegetation?: Group;
  monuments?: MonumentLayer;
  rail?: Group;
  sport?: SportFixtureLayer;
  tile: string;
  /** OSM trams: tracks, masts, the overhead line (tram-layer.ts) */
  tram?: Group;
  /** the Elbe's landing stages, groynes, ferry lines (riverside-layer.ts) */
  riverside?: Group;
  /** the counted motor traffic (traffic-layer.ts): a data layer, shown
   *  only while the HUD has it on */
  traffic?: Group;
  vegetation?: VegetationControl;
  /** vine rows (cultivated-layer.ts): static */
  vineyards?: Group;
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
  /** the look store: dressing lands with the current look */
  look: LookState;
  /** phones sample the ≤ 2048² class rasters */
  lowRasters: boolean;
  /** bytes of out-of-view tile content kept cached (scene-profile.ts) */
  cacheBytes: { max: number; min: number };
  /** the scene fog's colour (height-fog.ts): the water's sky tint */
  fogColor: UniformNode<"color", Color>;
  /** ground height over every loaded terrain (projected coordinates) */
  heightAt: (x: number, y: number) => number | null;
  /** the ground's look strengths (by reference) */
  ground: GroundUniforms;
  /** the current night factor, for lamps that land later */
  night: () => number;
  /** the current day of the year, for trees that land later
   *  (lib/city/tree-season.ts) */
  season: () => number;
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
  renderer: WebGPURenderer;
  styleResources: StyleResources;
  sunDirection: Vector3;
  /** a phone streams fewer tiles at once (`paceStreaming`) */
  tier: DeviceTier;
  /** a site tile's exact extent (the tileset's root extras) */
  tileBounds: (tileId: string) => TerrainBounds | undefined;
  tilesetUrl: string;
}

export interface TileStream {
  cities: Set<CityLayer>;
  /** dressings queued or being built */
  pendingDressings: () => number;
  /** whether a tile's dressing was tried: built, failed, or its tile left */
  dressingSettled: (tileId: string) => boolean;
  /** demolished object indices per tile, kept across unload/reload */
  demolished: Map<string, Set<number>>;
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

/** What the dressing plugin reads of the renderer it is registered on. */
interface PluginTiles {
  recalculateBytesUsed: (tile?: object | null) => void;
  readonly visibleTiles: ReadonlySet<object>;
}

/** Every dressed object of a tile, keyed by its content root. */
interface Dressed {
  /** aborts the dressing's fetches when the tile leaves before it lands */
  aborter?: AbortController;
  city?: CityLayer;
  dressing?: TileDressing;
  /** the dressing's geometry bytes, once it hangs on the tile */
  dressingBytes?: number;
  /** the bytes of the site's shared buffers its content holds (the coarse
   *  grid's index and water index): the tile renderer counts them in the
   *  tile's glTF, but they stay when the tile goes */
  sharedBytes?: number;
  /** the shared sky-view raster the city holds (its URL) */
  svf?: string;
  terrain?: TerrainLayer;
}

/**
 * Every request the renderer makes — the tileset and each tile's content —
 * through the viewer's one fetch (fetch-optional.ts `fetchBytes`): a
 * network failure is retried while the page is visible, so a tile that hit
 * a blip stays loading (its coarse level shown, the boot waiting) instead
 * of failing; one that gives up is brought back later (tile-retry.ts). The
 * `.glb.gz` content is pre-gzipped (static hosts do not compress binary
 * types) and inflated natively inside the retries — unless the host already
 * did (isGzipped). Content comes back as its bytes, which the renderer
 * parses as they are (no Response to copy them through again); JSON as a
 * Response, which the renderer reads itself; a status no retry fixes as an
 * empty Response with that status, which the renderer reports.
 */
class ContentFetchPlugin {
  name = "BRIDGE_CONTENT_FETCH";
  /** aborts every request in flight when the stream goes (dispose) */
  private readonly aborter = new AbortController();
  async fetchData(
    url: string,
    options: RequestInit
  ): Promise<Response | ArrayBuffer> {
    const { signal, ...init } = options;
    const either = eitherSignal(signal, this.aborter.signal);
    try {
      const got = await fetchBytes(url, {
        signal: either.signal,
        budgetMs: TILE_FETCH_BUDGET_MS,
        gunzip: url.endsWith(".gz"),
        init,
      });
      if (!got.ok) {
        return new Response(null, { status: got.status });
      }
      return new URL(url, window.location.href).pathname.endsWith(".json")
        ? new Response(got.bytes, { status: got.status })
        : got.bytes.buffer;
    } finally {
      either.release();
    }
  }

  dispose(): void {
    this.aborter.abort();
  }
}

type Features<T> = Promise<T[]>;

/**
 * The city's buffers nothing reads on the CPU once it is compiled: its
 * normals and roof flags (the clay reads both, so its compile uploads
 * them). The positions, index and feature ids stay — collision and picks
 * raycast the BVH over them, demolish rebuilds the index from the feature
 * ids, the selection outline cuts a building's triangles out of them.
 */
function cityCpuDroppable(city: CityLayer): AnyAttribute[] {
  const geometry = city.mesh.geometry;
  return [geometry.getAttribute("normal"), geometry.getAttribute("roof")];
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
  traffic: (d) => d.traffic,
  sport: (d) => d.sport?.group,
  vineyards: (d) => d.vineyards,
} as const satisfies Record<
  // every field but the id and the askables (data): a new part cannot be
  // left out
  Exclude<keyof TileDressing, "asks" | "tile">,
  (d: TileDressing) => Object3D | undefined
>;

export type DressingPartName = keyof typeof DRESSING_PARTS;

export const DRESSING_PART_NAMES = Object.keys(
  DRESSING_PARTS
) as DressingPartName[];

export function dressingParts(d: TileDressing): Object3D[] {
  return DRESSING_PART_NAMES.flatMap((name) => DRESSING_PARTS[name](d) ?? []);
}

/** How long a tile may wait on its compile before it shows regardless. */
const COMPILE_WAIT_MS = 3000;
/** How long a level may wait on its dressing while the tile's other level
 *  stands in for it (DressingPlugin.handsOver) before it shows regardless. */
const HAND_OVER_WAIT_MS = 10_000;

function withinWait(done: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    done.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

function withinCompileWait(done: Promise<unknown>): Promise<void> {
  return withinWait(done, COMPILE_WAIT_MS);
}

/**
 * Brings a dressing that has just joined the stream up to the scene's
 * present. It was born with the season, night and look of the moment it
 * was built, but its compile may then wait up to COMPILE_WAIT_MS, and the
 * clocks that follow a change (create-app.ts) reach only the dressings in
 * `stream.dressings` — a date drag, dusk or a slider moved meanwhile would
 * pass it by. Each setter is idempotent: nothing moves when nothing did.
 */
export function catchUp(
  d: Pick<TileDressing, "lamps" | "traffic" | "vegetation">,
  ctx: Pick<TileStreamContext, "look" | "night" | "season">
): void {
  const look = ctx.look.get();
  d.vegetation?.applyLook(look);
  d.vegetation?.setSeason(ctx.season());
  d.lamps?.setNightFactor(ctx.night());
  showDataLayers(d, look);
}

/** A dressing's data layers shown or hidden as the look has them
 *  (lib/city/data-layers.ts): a layer that is off draws nothing. */
export function showDataLayers(
  d: Pick<TileDressing, "traffic">,
  look: Pick<LookValues, "trafficLayer">
): void {
  if (d.traffic) {
    d.traffic.visible = look.trafficLayer;
  }
}

/** Frees a dressing; a part that throws does not keep the others (what
 *  was thrown is returned). */
function disposeDressing(d: TileDressing): unknown[] {
  const errors: unknown[] = [];
  for (const own of [d.lamps, d.monuments, d.sport]) {
    try {
      own?.dispose();
    } catch (err) {
      errors.push(err);
    }
  }
  for (const part of dressingParts(d)) {
    part.removeFromParent();
    errors.push(...disposeObject3D(part));
  }
  return errors;
}

/** The site tile a content root is of (its extras), for the trail. */
const tileIdOf = (scene: Object3D): string =>
  (scene.userData as Partial<ContentExtras>).tileId ?? "?";

/**
 * How a compile ended (`DressingPlugin.compileUnder`): done, its buffers on
 * the GPU with it; not run, nothing could compile it yet; failed; or out
 * of memory — the GPU or the page could not make room.
 */
type Compiled = "done" | "failed" | "not run" | "out of memory";

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
  const [minX, , , maxY] = terrain.bounds;
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
 */
function buildTileVegetation(
  features: Omit<VegetationFeatures, "extraTrees" | "keepTree">,
  inventoryTrees: TreeFeature[],
  vegCtx: VegetationContext
): VegetationControl {
  const inventory =
    inventoryTrees.length > 0
      ? buildTreeInventory(inventoryTrees, vegCtx, features.ndviAt)
      : null;
  const canopy = buildVegetation(
    {
      ...features,
      keepTree: inventory?.keepTree,
      extraTrees: inventory?.instances,
    },
    vegCtx
  );
  if (!inventory) {
    return canopy;
  }
  const own = inventory.control;
  const group = new Group();
  group.name = "vegetation";
  group.add(canopy.group, own.group);
  return {
    group,
    chunks: canopy.chunks,
    multiTuft: canopy.multiTuft,
    applyLook: (look) => {
      canopy.applyLook(look);
      own.applyLook(look);
    },
    setTime: (seconds) => {
      canopy.setTime(seconds);
      own.setTime(seconds);
    },
    setSeason: (day) => {
      const a = canopy.setSeason(day);
      const b = own.setSeason(day);
      return a || b;
    },
    // Both run: `||` would skip the cadastre's swap whenever the canopy's
    // changed.
    updateLod: (cameraPos) => {
      const a = canopy.updateLod(cameraPos);
      const b = own.updateLod(cameraPos);
      return a || b;
    },
  };
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
 * The next builder in a later task: each is a long task of its own on a
 * phone (the trees alone ~50 ms on a laptop), and a frame gets in between.
 * A tile that leaves meanwhile still gets its dressing whole — the caller
 * frees it.
 */
const nextTask = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

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
  const fetchKind = <T>(file: string | undefined): Features<T> =>
    file ? fetchFeatures<T>(url(file), signal) : Promise.resolve([]);
  const [traffic, bridges, crownBytes] = await Promise.all([
    fetchKind<TrafficFeature>(files.traffic),
    fetchKind<BridgeFeature>(files.bridge),
    files.crowns
      ? fetchOptionalBinary(url(files.crowns), signal)
      : Promise.resolve(null),
  ]);
  const bands =
    traffic.length > 0
      ? buildTraffic(
          traffic,
          bridges,
          { offset, heightAt: terrain.heightAt },
          "coarse",
          extent
        )
      : undefined;
  // the same bridges as the fine level draws (its decks are measured, the
  // piers stand on the ground in reach), the same owner per seam
  const owns = (x: number, y: number) => ownsPoint(extent, x, y);
  const ground = { offset, heightAt: ctx.heightAt };
  const rail =
    bridges.length > 0
      ? buildRail(
          { bridges, rails: [], ballast: [], platforms: [] },
          { ...ground, owns }
        )
      : undefined;
  // asked on the coarse bodies too: the tiles the fine level has not
  // reached show only these
  const flows = trafficAskSet(bands, traffic, tile);
  const decks = rail
    ? bridgeAskSet(
        rail,
        bridgeItems(bridges, {
          ...ground,
          tile,
          treeHeightAt: terrain.heightAt,
          owns,
        })
      )
    : undefined;
  const asks = [flows, decks].filter(
    (a): a is AskSet<FeatureInquiry> => a !== undefined && a !== null
  );
  const crowns = (crownBytes && unpackCrowns(crownBytes)) ?? [];
  const vegetation =
    crowns.length > 0
      ? buildCoarseCrowns(crowns, {
          heightAt: terrain.heightAt,
          offset,
          sunDirection: ctx.sunDirection,
        })
      : undefined;
  return {
    asks: asks.length > 0 ? asks : undefined,
    rail: rail && rail.children.length > 0 ? rail : undefined,
    tile,
    traffic: bands,
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
      ? buildCoarseDressing(
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
  const get = <T>(kind: DressingKind): Features<T> => {
    const file = d[kind];
    return file ? fetchFeatures<T>(url(file), signal) : Promise.resolve([]);
  };
  // The canopy points come packed (lib/city/point-pack.ts, prepare-data.ts):
  // no parse, the same features for the vegetation. Not a pack = off.
  const getPoints = async (
    kind: "canopy" | "canopyx"
  ): Promise<CanopyExtraFeature[]> => {
    const file = d[kind];
    const buffer = file ? await fetchOptionalBinary(url(file), signal) : null;
    const points = buffer ? unpackPoints(buffer) : null;
    return points ? (pointFeatures(points) as CanopyExtraFeature[]) : [];
  };
  const {
    rows,
    canopy,
    ndviAt,
    lamps,
    monuments,
    furniture,
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
  const sport = buildSport(terrain, sportTable, ctx);
  await nextTask();
  // Rails may run past the tile edge: they sample the ground over
  // every loaded terrain, not this tile's alone.
  const ground = { offset: ctx.offset, heightAt: ctx.heightAt };
  const vegetation = buildTileVegetation(
    {
      rows,
      // The laser-scan crowns outside the canopy mask join the canopy as
      // ordinary trees (they carry the same measured `h`); the bake already
      // dropped the ones a cadastre tree claims.
      canopy: offMonuments([...canopy, ...scanTrees], monuments),
      ndviAt: ndviAt ?? undefined,
    },
    // Orchard trees join the cadastre as its "small" archetype.
    [...inventory, ...orchardTrees(cultivated)],
    {
      offset: ctx.offset,
      heightAt: terrain.heightAt,
      sunDirection: ctx.sunDirection,
    }
  );
  // Born with the current look and season, not the defaults.
  vegetation.applyLook(ctx.look.get());
  vegetation.setSeason(ctx.season());
  await nextTask();
  const lowVegetation =
    hedges.length > 0
      ? buildLowVegetation(hedges, {
          offset: ctx.offset,
          heightAt: terrain.heightAt,
        })
      : undefined;
  // The bake reads lamps with a margin around the tile; a lamp on or past a
  // seam is its owner's, or two tiles would stand it twice.
  const extent = ctx.tileBounds(tile);
  const ownLamps = extent
    ? lamps.filter((f) =>
        ownsPoint(extent, f.geometry.coordinates[0], f.geometry.coordinates[1])
      )
    : lamps;
  const lampControl = buildLamps(ownLamps, {
    ...ground,
    heightAt: terrain.heightAt,
  });
  lampControl.setNightFactor(ctx.night());
  await nextTask();
  const rail = buildRail(
    { rails, bridges, ballast, platforms },
    {
      ...ground,
      // a deck across a seam is in both tiles' files; its owner draws it
      owns: extent ? (x, y) => ownsPoint(extent, x, y) : undefined,
    }
  );
  await nextTask();
  // The bake writes only the monuments a tile owns; a basin that reaches
  // past the seam samples the neighbour's ground.
  const monumentLayer = buildMonuments(monuments, {
    ...ground,
  });
  // Owned by the bake (west/south edges in): stood on this tile's ground.
  const furnitureGroup = buildFurniture(furniture, {
    ...ground,
    heightAt: terrain.heightAt,
  });
  await nextTask();
  const vines = vineRows(cultivated);
  const vineyards =
    vines.length > 0
      ? buildVineyards(vines, {
          offset: ctx.offset,
          heightAt: terrain.heightAt,
        })
      : undefined;
  // Tracks are cut at the tile edge by the bake; they and the span wires
  // sample the ground over every loaded terrain, like the rails.
  await nextTask();
  const tram = trams.length > 0 ? buildTram(trams, bridges, ground) : undefined;
  // Piers and pontoons are the tile's own; a ferry line or groyne cut at
  // the seam samples the neighbour's ground past it.
  const riverside =
    river.length > 0 ? buildRiverside(river, ground) : undefined;
  // What the probe can ask, sized as drawn: the trees on the tile's own
  // ground (as the inventory stands them), decks only where this tile
  // draws them.
  const askCtx = {
    ...ground,
    tile,
    treeHeightAt: terrain.heightAt,
    owns: extent
      ? (x: number, y: number) => ownsPoint(extent, x, y)
      : undefined,
  };
  const bridgeSet = bridgeAskSet(rail, bridgeItems(bridges, askCtx));
  const asks = [
    ...treeSets(inventory, askCtx),
    ...askSets(monumentItems(monuments, askCtx)),
    ...(bridgeSet ? [bridgeSet] : []),
  ];
  // Sections are cut at the tile edge by the bake; a bridge street rides
  // the decks of this tile's bridge file (which names a seam deck in both).
  const trafficBands =
    traffic.length > 0
      ? buildTraffic(
          traffic,
          bridges,
          ground,
          "fine",
          ctx.tileBounds(tile) ?? terrain.bounds
        )
      : undefined;
  // The counted sections are asked on their bodies, while the layer shows.
  const trafficSet = trafficAskSet(trafficBands, traffic, tile);
  if (trafficSet) {
    asks.push(trafficSet);
  }
  return {
    asks,
    tile,
    tram,
    riverside,
    traffic: trafficBands,
    vegetation,
    lowVegetation,
    vineyards,
    lamps: lampControl,
    monuments: monumentLayer,
    furniture: furnitureGroup,
    rail,
    sport,
  };
}

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
  /** what ends a content root's wait for its queued dressing (handsOver) */
  private readonly builtOf = new WeakMap<Object3D, () => void>();
  /** the boot's spawn tile is shown bare, its dressing after the gate */
  private gateOpen = false;
  /** tiles whose dressing was tried (see TileStream.dressingSettled) */
  readonly settled = new Set<string>();
  private readonly toData = new Matrix4();
  private tiles: PluginTiles | null = null;
  /** the content roots whose terrain reads each raster (raster-shares.ts) */
  private readonly rasterShares = new RasterShares<Object3D>();
  /** the tile a content root was loaded for (to reweigh it) */
  private readonly tileOf = new WeakMap<Object3D, object>();
  /** the sky-view rasters a tile's terrain and buildings share */
  readonly skyView: SharedRasters<Texture> = createSharedRasters(
    (url, signal) => loadSkyViewTexture(url, signal, this.ctx.renderer),
    (texture) => texture.dispose()
  );
  /** the horizon rasters a tile's two terrain levels share */
  readonly horizon: SharedRasters<Texture> = createSharedRasters(
    (url, signal) => loadHorizonTexture(url, signal, this.ctx.renderer),
    (texture) => texture.dispose()
  );
  /** the class rasters (and their painted splats), NDVI and sports grounds
   *  a tile's two terrain levels share — on a phone both levels name the
   *  same class and NDVI files, ~30 MB of GPU memory per tile loaded twice
   *  (the sports grounds only the fine level reads there) */
  readonly splats: SharedRasters<SplatRasters> = createSharedRasters(
    (url, signal) => loadSplatRasters(url, this.ctx.renderer, signal),
    freeSplatRasters
  );
  readonly ndvis: SharedRasters<Texture> = createSharedRasters(
    (url, signal) => loadNdviTexture(url, this.ctx.renderer, signal),
    (texture) => texture.dispose()
  );
  readonly sports: SharedRasters<SportRasters> = createSharedRasters(
    (key, signal) => loadSportKey(key, this.ctx.renderer, signal),
    freeSport
  );
  /** the coarse level's grid index and water index, one copy for the
   *  site (terrain-layer.ts `GridShare`) */
  private readonly grids: GridShare = createGridShare();
  /** aborts the levels' own raster loads when the stream goes: they would
   *  hold their turn to decode (raster-upload.ts) from the next app's */
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

  constructor(
    private readonly ctx: TileStreamContext,
    private readonly stream: Pick<
      TileStream,
      "cities" | "demolished" | "dressings" | "terrains"
    >
  ) {
    // The warm-up runs beside the dressings, not ahead of them: its compile
    // may take up to COMPILE_WAIT_MS, and the spawn tile's trees need none
    // of its programs (they compile their own).
    this.chain = ctx.dressingGate;
    ctx.dressingGate
      .then(() => {
        this.gateOpen = true;
        return this.warmCrowns();
      })
      .catch(() => {
        // Without the warm-up a date change compiles in a frame; the
        // stream goes on.
      });
  }

  init(tiles: PluginTiles): void {
    this.tiles = tiles;
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
    const dressed = scene ? this.dressed.get(scene) : undefined;
    const rasters = this.rasterShares.bytesOf(dressed?.terrain?.rasters ?? []);
    return (
      rasters + (dressed?.dressingBytes ?? 0) - (dressed?.sharedBytes ?? 0)
    );
  }

  /** `scene`'s terrain takes up (or lets go of) its rasters; the other
   *  levels reading one of them now weigh a different share of it. */
  private holdRasters(scene: Object3D, rasters: Texture[], hold: boolean) {
    const others = hold
      ? this.rasterShares.hold(scene, rasters)
      : this.rasterShares.release(scene, rasters);
    for (const other of others) {
      const tile = this.tileOf.get(other);
      if (tile) {
        this.tiles?.recalculateBytesUsed(tile);
      }
    }
  }

  private url = (file: string): string =>
    new URL(file, new URL(this.ctx.tilesetUrl, window.location.href)).href;

  async processTileModel(scene: Object3D, tile: object): Promise<void> {
    this.tileOf.set(scene, tile);
    let settle = (): void => undefined;
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
    let dressed: Promise<void> | undefined;
    if (extras.kind === "city") {
      this.dressCity(scene, mesh, extras);
    } else if (extras.kind === "terrain") {
      ({ dressed } = await this.dressTerrain(scene, mesh, extras));
    }
    // The renderer shows the tile once this resolves: its programs are
    // ready by then instead of compiling inside a frame. (A tile that left
    // meanwhile is not compiled: that would upload what nothing shows.)
    if (!this.released.has(scene)) {
      await withinCompileWait(this.compileContent(scene));
    }
    // ...and, where it takes over from the tile's other level, its
    // dressing with it (handsOver).
    if (
      dressed &&
      extras.kind === "terrain" &&
      !this.released.has(scene) &&
      this.handsOver(extras)
    ) {
      await withinWait(dressed, HAND_OVER_WAIT_MS);
    }
    // Disposed while it was being dressed: the renderer drops an aborted
    // load without ever recording the scene, so nothing else frees it. The
    // same once the stream is gone (its plugins are unregistered first).
    if (this.disposed || this.released.has(scene)) {
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
      this.released.add(scene);
      this.release(scene);
    }, 0);
  }

  private dressCity(scene: Object3D, mesh: Mesh, extras: CityExtras): void {
    const demolished = this.stream.demolished.get(extras.tileId) ?? new Set();
    const city = dressCity(
      mesh,
      extras.tileId,
      this.ctx.styleResources,
      demolished
    );
    this.stream.cities.add(city);
    const entry: Dressed = { city };
    this.dressed.set(scene, entry);
    if (extras.svf) {
      entry.svf = this.url(extras.svf);
      this.shareSkyView(scene, entry, extras.tileId, entry.svf);
    }
  }

  /** The facades' sky view lands after the buildings show (the clay binds
   *  an open sky until then); held until the city tile leaves. */
  private shareSkyView(
    scene: Object3D,
    entry: Dressed,
    tileId: string,
    url: string
  ): void {
    const bounds = this.ctx.tileBounds(tileId);
    void this.skyView.acquire(url).then((texture) => {
      const city = entry.city;
      if (!(texture && bounds && city) || this.dressed.get(scene) !== entry) {
        return;
      }
      const [minX, minY, maxX, maxY] = bounds;
      const { cx, cy } = this.ctx.offset;
      setClaySkyView(
        city.mesh.material as MeshStandardNodeMaterial,
        texture,
        [minX - cx, maxY - cy],
        [maxX - minX, maxY - minY]
      );
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
    // glTF→3D Tiles up-axis turn (the tileset frame IS the data frame).
    scene.updateMatrix();
    mesh.updateMatrix();
    this.toData.multiplyMatrices(scene.matrix, mesh.matrix);
    const own = new AbortController();
    this.loadAborts.set(scene, own);
    const either = eitherSignal(own.signal, this.lifetime.signal);
    let terrain: TerrainLayer;
    try {
      terrain = await dressTerrain(mesh, extras, this.toData, {
        fileUrl: this.url,
        fogColor: this.ctx.fogColor,
        lowRasters: this.ctx.lowRasters,
        ground: this.ctx.ground,
        offset: this.ctx.offset,
        renderer: this.ctx.renderer,
        skyView: this.skyView,
        horizon: this.horizon,
        splats: this.splats,
        ndvis: this.ndvis,
        sports: this.sports,
        grids: this.grids,
        signal: either.signal,
      });
    } finally {
      either.release();
      this.loadAborts.delete(scene);
    }
    terrain.water?.setMist(this.ctx.look.get().waterMist);
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
    this.dressed.set(scene, { terrain, sharedBytes: sceneSharedBytes(scene) });
    this.holdRasters(scene, terrain.rasters, true);
    const coarse = COARSE_DRESSING_KINDS.some((kind) => extras.coarse?.[kind]);
    return extras.dressing || coarse
      ? { dressed: this.queueDressing(scene, terrain, extras) }
      : {};
  }

  /** Dressings build one at a time, after the gate: each is a long task.
   *  The crowns' seasonal programs warm up beside them (warmCrowns). */
  private chain: Promise<void>;
  pending = 0;
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
    await withinCompileWait(
      Promise.all(warmup.main.map((mesh) => this.ctx.compile(mesh))).then(
        () => undefined,
        (err: unknown) => {
          this.compileFailed(err, "crowns");
        }
      )
    );
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
   * shared sky views with them. Whatever is still being built finds the
   * stream gone and frees itself (processTileModel, queueDressing).
   */
  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.warmup?.dispose();
    this.warmup = null;
    // (release deletes the entry it is on: a Map iterates on safely)
    for (const scene of this.dressed.keys()) {
      this.release(scene);
    }
    this.skyView.clear();
    this.horizon.clear();
    this.splats.clear();
    this.ndvis.clear();
    this.sports.clear();
  }

  /**
   * Builds the tile's dressing in its turn and hangs it on the tile. The
   * promise settles once the dressing is built and compiled (or given up),
   * before it hangs: it hangs as soon as the renderer has recorded the
   * tile's own content (`loaded`), before any frame — so a tile that waits
   * for it (handsOver) is shown with it.
   */
  private queueDressing(
    scene: Object3D,
    terrain: TerrainLayer,
    extras: TerrainExtras
  ): Promise<void> {
    this.pending++;
    let built = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      built = resolve;
    });
    // a tile that leaves stops waiting for it at once (disposeTile)
    this.builtOf.set(scene, built);
    this.chain = this.chain
      .then(() => this.ctx.dressingGate)
      .then(async () => {
        const entry = this.dressed.get(scene);
        if (!entry || this.disposed) {
          return; // the tile (or the stream) left before its turn
        }
        entry.aborter = new AbortController();
        const dressing = await buildDressing(
          terrain,
          extras,
          this.ctx,
          this.url,
          entry.aborter.signal
        );
        entry.aborter = undefined;
        const parts = dressingParts(dressing);
        // Compiled as the frames will draw it — in its season and at the
        // hour (which swap crown materials) — before it hangs anywhere: a
        // build three keys differently from what a frame asks for compiles
        // inside that frame. (A compile starts at the drawable: where it
        // will hang does not change its build.)
        catchUp(dressing, this.ctx);
        const compiled =
          this.dressed.get(scene) === entry
            ? this.compileUnder(
                scene,
                compileRepresentatives(parts),
                `dressing ${extras.tileId}`
              )
            : Promise.resolve<Compiled>("not run");
        let outcome: Compiled | undefined;
        compiled
          .then((ended) => {
            outcome = ended;
          })
          .catch(() => undefined);
        await withinCompileWait(compiled);
        built();
        // Not before the renderer has recorded the tile's own content (see
        // `loaded`): the dressing's materials are the scene's.
        await this.loaded.get(scene);
        // A dressing whose compile ran out of GPU memory stays off: the
        // tile goes bare rather than the GPU further under.
        if (
          this.disposed ||
          this.dressed.get(scene) !== entry ||
          outcome === "out of memory"
        ) {
          // freed once its compile has ended (see `compiles`)
          compiled
            .then(() => this.disposeFailed(disposeDressing(dressing), scene))
            .catch(() => undefined);
          return;
        }
        this.hangDressing(scene, entry, dressing);
        // ...and one whose compile outlasted the wait and then ran out of
        // memory comes down again
        compiled
          .then((ended) => {
            if (ended === "out of memory") {
              this.dropDressing(scene, entry, dressing);
            }
          })
          .catch(() => undefined);
      })
      .catch(() => {
        // A dressing that fails leaves its tile bare, never the stream stuck.
      })
      .finally(() => {
        built();
        this.builtOf.delete(scene);
        this.pending--;
        // A tile is dressed when its fine level is (the coarse one only
        // stands in for it).
        if (extras.level === 0) {
          this.settled.add(extras.tileId);
        }
        if (!this.disposed) {
          this.ctx.onChange();
        }
      });
    return ready;
  }

  /** Hangs a built dressing on its tile's content root. */
  private hangDressing(
    scene: Object3D,
    entry: Dressed,
    dressing: TileDressing
  ): void {
    const parts = dressingParts(dressing);
    // The content root is the viewer's Y-up scene frame (the renderer's
    // up-axis turn cancels the world group's), so the Y-up dressing
    // hangs under it and leaves with its tile.
    scene.add(...parts);
    entry.dressing = dressing;
    entry.dressingBytes = parts.reduce(
      (sum, part) => sum + estimateGeometryBytes(part),
      0
    );
    this.tiles?.recalculateBytesUsed();
    this.stream.dressings.add(dressing);
    // Whatever changed while it compiled (the hour moves on).
    catchUp(dressing, this.ctx);
  }

  /** Takes a hung dressing down again and frees it (its compile ran out of
   *  memory after it hung); the tile stays, bare. */
  private dropDressing(
    scene: Object3D,
    entry: Dressed,
    dressing: TileDressing
  ): void {
    if (this.disposed || entry.dressing !== dressing) {
      return; // gone with its tile already
    }
    entry.dressing = undefined;
    entry.dressingBytes = undefined;
    this.stream.dressings.delete(dressing);
    this.disposeFailed(disposeDressing(dressing), scene);
    this.tiles?.recalculateBytesUsed();
    this.ctx.onChange();
  }

  disposeTile(tile: { engineData?: { scene?: Object3D | null } }): void {
    const scene = tile.engineData?.scene ?? this.sceneOf.get(tile);
    this.sceneOf.delete(tile);
    if (scene) {
      // its rasters stop where they are (the load this rejects is the
      // renderer's to drop: its own signal is aborted by now)
      this.loadAborts.get(scene)?.abort();
      this.builtOf.get(scene)?.();
      this.released.add(scene);
      this.release(scene);
      this.disposeContentNow(scene);
    }
  }

  /**
   * Compiles `objects` (the root or what hangs under it), counted on
   * `scene` until they end (see `compiles`). Resolves how it ended (a
   * failure for want of memory reported as `where`); never rejects.
   */
  private compileUnder(
    scene: Object3D,
    objects: Object3D[],
    where: string
  ): Promise<Compiled> {
    this.compiles.set(scene, (this.compiles.get(scene) ?? 0) + 1);
    const done = Promise.all(objects.map((o) => this.ctx.compile(o))).then(
      (compiled): Compiled => (compiled.every(Boolean) ? "done" : "not run"),
      (err: unknown) => this.compileFailed(err, where)
    );
    const settle = () => {
      const left = (this.compiles.get(scene) ?? 1) - 1;
      if (left > 0) {
        this.compiles.set(scene, left);
        return;
      }
      this.compiles.delete(scene);
      if (this.released.has(scene)) {
        this.release(scene);
      }
    };
    // a release that throws must not surface as an unhandled rejection
    done.then(settle).catch(() => undefined);
    return done;
  }

  /**
   * The content's own compile — and once it has uploaded the content, the
   * CPU copies of what nothing reads any more go (`dropContentCopies`).
   */
  private compileContent(scene: Object3D): Promise<Compiled> {
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
    compiled
      .then((ended) => {
        this.contentCompiling.delete(scene);
        if (ended === "done") {
          this.dropContentCopies(scene);
        }
      })
      .catch(() => undefined);
    return compiled;
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
    const drop = entry.terrain
      ? cpuDroppable(entry.terrain)
      : entry.city
        ? cityCpuDroppable(entry.city)
        : [];
    dropCpuCopies(scene, drop);
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
    dressed.aborter?.abort();
    const errors: unknown[] = [];
    const free = (dispose: () => void) => {
      try {
        dispose();
      } catch (err) {
        errors.push(err);
      }
    };
    if (dressed.city) {
      this.stream.cities.delete(dressed.city);
      free(() => dressed.city?.dispose());
    }
    if (dressed.svf) {
      this.skyView.release(dressed.svf);
    }
    if (dressed.terrain) {
      this.stream.terrains.delete(dressed.terrain);
      this.holdRasters(scene, dressed.terrain.rasters, false);
      free(() => dressed.terrain?.dispose());
    }
    if (dressed.dressing) {
      this.stream.dressings.delete(dressed.dressing);
      errors.push(...disposeDressing(dressed.dressing));
    }
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
 * Gives a phone's renderer queues of its own at `PHONE_STREAM`'s limits.
 * Before its first update (the renderer takes them up then). The defaults
 * are module-wide queues every renderer shares, so they are replaced, not
 * changed: a desktop app booted after (a StrictMode remount) keeps its own.
 */
export function paceStreaming(tiles: TilesRenderer, tier: DeviceTier): void {
  if (tier !== "mobile") {
    return;
  }
  const parse = new PriorityQueue();
  parse.maxJobs = PHONE_STREAM.parses;
  parse.priorityCallback = tiles.parseQueue.priorityCallback;
  tiles.parseQueue = parse;
  const download = new DownloadPriorityQueue();
  download.maxJobsPerOrigin = PHONE_STREAM.downloadsPerOrigin;
  download.priorityCallback = tiles.downloadQueue.priorityCallback;
  tiles.downloadQueue = download;
}

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
  paceStreaming(tiles, ctx.tier);
  setRasterTier(ctx.tier);
  tiles.registerPlugin(new ContentFetchPlugin());
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({ metadata: true, meshoptDecoder: MeshoptDecoder })
  );
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
    version++;
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
    pendingDressings: () => 0,
    dressingSettled: () => false,
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
