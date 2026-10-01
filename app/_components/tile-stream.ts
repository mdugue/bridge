import { TilesRenderer } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import {
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
  CanopyFeature,
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
import { onRelief } from "@/lib/city/monuments";
import { type SportTable, sportFixtures } from "@/lib/city/sport";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import {
  type CityExtras,
  type ContentExtras,
  ownsPoint,
  type TerrainExtras,
} from "@/lib/city/tileset";
import type { DressingKind } from "@/lib/city/tile";
import { type CityLayer, dressCity } from "./city-layer";
import type { CrownWarmup } from "./crown-season";
import { buildVineyards } from "./cultivated-layer";
import { fetchFeatures, fetchOptionalJson } from "./fetch-optional";
import { buildFurniture } from "./furniture-layer";
import { buildLamps, type LampControl } from "./lamp-layer";
import { buildLowVegetation } from "./low-vegetation-layer";
import { buildMonuments, type MonumentLayer } from "./monument-layer";
import { buildRail } from "./rail-layer";
import { buildRiverside } from "./riverside-layer";
import { buildSportFixtures, type SportFixtureLayer } from "./sport-fixtures";
import {
  dressTerrain,
  freeSplatRasters,
  freeSport,
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
import { createSharedRasters, type SharedRasters } from "./shared-rasters";
import { loadHorizonTexture, loadSkyViewTexture } from "./sky-light";
import { dressStairs } from "./stair-layer";
import {
  compileRepresentatives,
  disposeObject3D,
  estimateGeometryBytes,
  trackedBytesOf,
} from "./three-utils";
import { buildTraffic } from "./traffic-layer";
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
  /** compiles an object's shaders before it shows (PostStack.compile) */
  compile: (object: Object3D) => Promise<void>;
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
  renderer: WebGPURenderer;
  styleResources: StyleResources;
  sunDirection: Vector3;
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

/** Every dressed object of a tile, keyed by its content root. */
interface Dressed {
  /** aborts the dressing's fetches when the tile leaves before it lands */
  aborter?: AbortController;
  city?: CityLayer;
  dressing?: TileDressing;
  /** the dressing's geometry bytes, once it hangs on the tile */
  dressingBytes?: number;
  /** the shared sky-view raster the city holds (its URL) */
  svf?: string;
  terrain?: TerrainLayer;
}

/**
 * The tiles' `.glb.gz` content is pre-gzipped (static hosts do not compress
 * binary types); inflate it natively before the loader sees it. Judged on the
 * gzip magic, not the URL alone: a host that serves `.gz` with
 * `Content-Encoding: gzip` has the browser inflate it already.
 */
class GzipContentPlugin {
  name = "BRIDGE_GZIP_CONTENT";
  async fetchData(url: string, options: RequestInit): Promise<Response> {
    const res = await fetch(url, options);
    if (!(url.endsWith(".gz") && res.ok)) {
      return res;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const body =
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"))
        : bytes;
    return new Response(body, { status: res.status });
  }
}

type Features<T> = Promise<T[]>;

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
  // every field but the id: a new part cannot be left out
  Exclude<keyof TileDressing, "tile">,
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

function withinCompileWait(done: Promise<void>): Promise<void> {
  return Promise.race([
    done,
    new Promise<void>((resolve) => setTimeout(resolve, COMPILE_WAIT_MS)),
  ]);
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

function disposeDressing(d: TileDressing): void {
  d.lamps?.dispose();
  d.monuments?.dispose();
  d.sport?.dispose();
  for (const part of dressingParts(d)) {
    part.removeFromParent();
    disposeObject3D(part);
  }
}

/** The canopy without the "trees" the DOM1 bake planted on a measured
 *  monument (lib/city/monuments.ts `onRelief`). */
function offMonuments(
  canopy: CanopyFeature[],
  monuments: MonumentFeature[]
): CanopyFeature[] {
  const reliefs = monuments.flatMap((m) =>
    m.properties?.relief ? [m.properties.relief] : []
  );
  if (reliefs.length === 0) {
    return canopy;
  }
  return canopy.filter((f) => {
    const [x, y] = f.geometry.coordinates;
    return !onRelief(reliefs, x, y);
  });
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
    return { tile };
  }
  // A kind the tile lacks is a feature off, never a request.
  const get = <T>(kind: DressingKind): Features<T> => {
    const file = d[kind];
    return file ? fetchFeatures<T>(url(file), signal) : Promise.resolve([]);
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
    canopy: get<CanopyFeature>("canopy"),
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
    scanTrees: get<CanopyExtraFeature>("canopyx"),
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
  // Sections are cut at the tile edge by the bake; a bridge street rides
  // the decks of this tile's bridge file (which names a seam deck in both).
  const trafficBands =
    traffic.length > 0 ? buildTraffic(traffic, bridges, ground) : undefined;
  return {
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
  /** tiles whose dressing was tried (see TileStream.dressingSettled) */
  readonly settled = new Set<string>();
  private readonly toData = new Matrix4();
  private tiles: {
    recalculateBytesUsed: (tile?: object | null) => void;
  } | null = null;
  /**
   * The content roots whose terrain reads each raster: the two levels of a
   * tile name the same class raster, splat, NDVI, sports grounds and light
   * (shared-rasters.ts), and the cache weighs such a raster half by each —
   * counted whole by both, a phone's cache was full at a fraction of what
   * the GPU held.
   */
  private readonly rasterHolders = new Map<Texture, Set<Object3D>>();
  /** the tile a content root was loaded for (to reweigh it) */
  private readonly tileOf = new WeakMap<Object3D, object>();
  /** the sky-view rasters a tile's terrain and buildings share */
  readonly skyView: SharedRasters<Texture> = createSharedRasters(
    (url) => loadSkyViewTexture(url),
    (texture) => texture.dispose()
  );
  /** the horizon rasters a tile's two terrain levels share */
  readonly horizon: SharedRasters<Texture> = createSharedRasters(
    (url) => loadHorizonTexture(url),
    (texture) => texture.dispose()
  );
  /** the class rasters (and their painted splats), NDVI and sports grounds
   *  a tile's two terrain levels share — on a phone both levels name the
   *  same files, ~43 MB of GPU memory per tile loaded twice */
  readonly splats: SharedRasters<SplatRasters> = createSharedRasters(
    (url, signal) => loadSplatRasters(url, this.ctx.renderer, signal),
    freeSplatRasters
  );
  readonly ndvis: SharedRasters<Texture> = createSharedRasters(
    (url, signal) => loadNdviTexture(url, signal),
    (texture) => texture.dispose()
  );
  readonly sports: SharedRasters<SportRasters> = createSharedRasters(
    (key, signal) => loadSportKey(key, signal),
    freeSport
  );

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
      .then(() => this.warmCrowns())
      .catch(() => {
        // Without the warm-up a date change compiles in a frame; the
        // stream goes on.
      });
  }

  init(tiles: { recalculateBytesUsed: (tile?: object | null) => void }): void {
    this.tiles = tiles;
  }

  /**
   * What the tile cache weighs a tile by on top of its glTF (the renderer
   * counts that one and sums every plugin's): the rasters its terrain
   * holds and its dressing's geometry, which the renderer cannot see — it
   * reads textures off the glTF's materials. Without them an iPhone's
   * cache sat at 173 MB of its 180 while the GPU held 865 MB, and the next
   * buffer failed to allocate.
   */
  calculateBytesUsed(_tile: object, scene: Object3D | null): number {
    const dressed = scene ? this.dressed.get(scene) : undefined;
    let rasters = 0;
    for (const texture of dressed?.terrain?.rasters ?? []) {
      const holders = this.rasterHolders.get(texture)?.size ?? 1;
      rasters += trackedBytesOf(texture) / Math.max(holders, 1);
    }
    return rasters + (dressed?.dressingBytes ?? 0);
  }

  /** `scene`'s terrain takes up (or lets go of) its rasters; the other
   *  levels reading one of them now weigh a different share of it. */
  private holdRasters(scene: Object3D, rasters: Texture[], hold: boolean) {
    const others = new Set<Object3D>();
    for (const texture of rasters) {
      let holders = this.rasterHolders.get(texture);
      if (!holders) {
        holders = new Set();
        this.rasterHolders.set(texture, holders);
      }
      if (hold) {
        holders.add(scene);
      } else {
        holders.delete(scene);
      }
      for (const other of holders) {
        if (other !== scene) {
          others.add(other);
        }
      }
      if (holders.size === 0) {
        this.rasterHolders.delete(texture);
      }
    }
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
    try {
      await this.dressContent(scene, tile);
    } finally {
      // The renderer records the content in the continuation of this call;
      // by the next task it has.
      setTimeout(settle, 0);
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
    if (extras.kind === "city") {
      this.dressCity(scene, mesh, extras);
    } else if (extras.kind === "terrain") {
      await this.dressTerrain(scene, mesh, extras);
    }
    // The renderer shows the tile once this resolves: its programs are
    // ready by then instead of compiling inside a frame. (A tile that left
    // meanwhile is not compiled: that would upload what nothing shows.)
    if (!this.released.has(scene)) {
      await withinCompileWait(this.compileUnder(scene, [scene]));
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

  private async dressTerrain(
    scene: Object3D,
    mesh: Mesh,
    extras: TerrainExtras
  ) {
    // Local → data frame: the node's dequantisation, then the content root's
    // glTF→3D Tiles up-axis turn (the tileset frame IS the data frame).
    scene.updateMatrix();
    mesh.updateMatrix();
    this.toData.multiplyMatrices(scene.matrix, mesh.matrix);
    const terrain = await dressTerrain(mesh, extras, this.toData, {
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
    });
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
    this.dressed.set(scene, { terrain });
    this.holdRasters(scene, terrain.rasters, true);
    if (extras.dressing) {
      this.queueDressing(scene, terrain, extras);
    }
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
        () => undefined
      )
    );
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

  private queueDressing(
    scene: Object3D,
    terrain: TerrainLayer,
    extras: TerrainExtras
  ): void {
    this.pending++;
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
        // Not before the renderer has recorded the tile's own content (see
        // `loaded`): the dressing's materials are the scene's.
        await this.loaded.get(scene);
        if (this.dressed.get(scene) !== entry) {
          disposeDressing(dressing);
          return;
        }
        const parts = dressingParts(dressing);
        // Compiled as the frames will draw it: in its season and at the
        // hour (which swap crown materials), hanging where it will hang —
        // but hidden until then. A build three keys differently from what
        // a frame asks for compiles inside that frame.
        catchUp(dressing, this.ctx);
        const shown = parts.map((part) => part.visible);
        for (const part of parts) {
          part.visible = false;
        }
        // The content root is the viewer's Y-up scene frame (the renderer's
        // up-axis turn cancels the world group's), so the Y-up dressing
        // hangs under it and leaves with its tile.
        scene.add(...parts);
        await withinCompileWait(
          this.compileUnder(scene, compileRepresentatives(parts))
        );
        if (this.dressed.get(scene) !== entry) {
          disposeDressing(dressing);
          return;
        }
        parts.forEach((part, i) => {
          part.visible = shown[i] ?? true;
        });
        entry.dressing = dressing;
        entry.dressingBytes = parts.reduce(
          (sum, part) => sum + estimateGeometryBytes(part),
          0
        );
        this.tiles?.recalculateBytesUsed();
        this.stream.dressings.add(dressing);
        // Whatever changed while it compiled (the hour moves on).
        catchUp(dressing, this.ctx);
      })
      .catch(() => {
        // A dressing that fails leaves its tile bare, never the stream stuck.
      })
      .finally(() => {
        this.pending--;
        this.settled.add(extras.tileId);
        if (!this.disposed) {
          this.ctx.onChange();
        }
      });
  }

  disposeTile(tile: { engineData?: { scene?: Object3D | null } }): void {
    const scene = tile.engineData?.scene ?? this.sceneOf.get(tile);
    this.sceneOf.delete(tile);
    if (scene) {
      this.released.add(scene);
      this.release(scene);
    }
  }

  /** Compiles `objects` (the root or what hangs under it), counted on
   *  `scene` until they end (see `compiles`). */
  private compileUnder(scene: Object3D, objects: Object3D[]): Promise<void> {
    this.compiles.set(scene, (this.compiles.get(scene) ?? 0) + 1);
    const done = Promise.all(objects.map((o) => this.ctx.compile(o))).then(
      () => undefined
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
    done.then(settle, settle);
    return done;
  }

  /** Frees everything dressed onto one content root — once its compiles
   *  have ended (see `compiles`; the last one to end calls this again). */
  private release(scene: Object3D): void {
    if (this.compiles.has(scene)) {
      return;
    }
    const dressed = this.dressed.get(scene);
    if (dressed) {
      this.releaseDressed(scene, dressed);
    }
    // The content itself, once — buildings, ground, and the walls, stairs,
    // kerbs and fences baked into it: its geometries, the per-tile
    // materials the dressing put on it (the renderer frees only the glTF's
    // own, which those replaced) and the render objects of everything in
    // it, which a scene-wide material never frees. On a normal unload the
    // renderer disposes the geometries again (a no-op); on an aborted load
    // it never does, and a compile has uploaded them by then.
    if (!this.freed.has(scene)) {
      this.freed.add(scene);
      disposeObject3D(scene);
    }
    if (dressed && !this.disposed) {
      this.ctx.onChange();
    }
  }

  private releaseDressed(scene: Object3D, dressed: Dressed): void {
    this.dressed.delete(scene);
    dressed.aborter?.abort();
    if (dressed.city) {
      this.stream.cities.delete(dressed.city);
      dressed.city.dispose();
    }
    if (dressed.svf) {
      this.skyView.release(dressed.svf);
    }
    if (dressed.terrain) {
      this.stream.terrains.delete(dressed.terrain);
      this.holdRasters(scene, dressed.terrain.rasters, false);
      dressed.terrain.dispose();
    }
    if (dressed.dressing) {
      this.stream.dressings.delete(dressed.dressing);
      disposeDressing(dressed.dressing);
    }
  }
}

/**
 * Starts streaming the tileset under `world` (the viewer's rotated Z-up
 * group). `cameras` decide what loads: the view camera, and the sun's shadow
 * camera, so a building behind the player still casts into the view.
 */
export function createTileStream(
  ctx: TileStreamContext,
  world: Group,
  cameras: { camera: Camera; height: number; width: number }[]
): TileStream {
  const tiles = new TilesRenderer(ctx.tilesetUrl);
  tiles.registerPlugin(new GzipContentPlugin());
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
  tiles.addEventListener("load-model", changed);
  tiles.addEventListener("tile-visibility-change", changed);
  world.add(tiles.group);
  return stream;
}
