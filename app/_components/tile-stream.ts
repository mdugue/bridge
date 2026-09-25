import { TilesRenderer } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import {
  type Camera,
  Group,
  Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
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
  TreeFeature,
  VegRowFeature,
} from "@/lib/city/features";
import { orchardTrees, vineRows } from "@/lib/city/cultivated";
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
import { type CityLayer, dressCity } from "./city-layer";
import { buildVineyards } from "./cultivated-layer";
import { fetchFeatures, fetchOptionalJson } from "./fetch-optional";
import { buildFurniture } from "./furniture-layer";
import type { HeightFogUniforms } from "./height-fog";
import { buildLamps, type LampControl } from "./lamp-layer";
import { buildLowVegetation } from "./low-vegetation-layer";
import { buildMonuments, type MonumentLayer } from "./monument-layer";
import { buildRail } from "./rail-layer";
import { buildSportFixtures, type SportFixtureLayer } from "./sport-fixtures";
import {
  dressTerrain,
  type GroundUniforms,
  type TerrainLayer,
} from "./terrain-layer";
import { dressKerbs } from "./kerb-layer";
import { createSharedRasters, type SharedRasters } from "./shared-rasters";
import { loadSkyViewTexture } from "./sky-light";
import { dressStairs } from "./stair-layer";
import { disposeObject3D } from "./three-utils";
import { buildTreeInventory } from "./tree-inventory-layer";
import {
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
  heightFog: HeightFogUniforms;
  /** ground height over every loaded terrain (projected coordinates) */
  heightAt: (x: number, y: number) => number | null;
  /** the ground's look strengths (by reference) */
  ground: GroundUniforms;
  /** the current night factor, for lamps that land later */
  night: () => number;
  offset: { cx: number; cy: number };
  /** content landed, left, or changed visibility */
  onChange: () => void;
  renderer: WebGLRenderer;
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
  city?: CityLayer;
  dressing?: TileDressing;
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

function dressingParts(d: TileDressing): Object3D[] {
  return [
    d.vegetation?.group,
    d.lowVegetation,
    d.lamps?.group,
    d.monuments?.group,
    d.furniture,
    d.rail,
    d.sport?.group,
    d.vineyards,
  ].filter((part): part is Group => part !== undefined);
}

/**
 * One object per distinct material and draw kind. A dressing is hundreds of
 * objects (a vegetation cell each, lamps, rails, walls) over a handful of
 * materials; compiling every one would queue the same program hundreds of
 * times, and the node renderer yields a frame per object.
 */
function compileRepresentatives(roots: Object3D[]): Object3D[] {
  const seen = new Map<string, Object3D>();
  for (const root of roots) {
    root.traverse((object) => {
      const { material } = object as Mesh;
      if (!material) {
        return;
      }
      const kind = object.type;
      for (const m of Array.isArray(material) ? material : [material]) {
        const key = `${m.uuid}:${kind}`;
        if (!seen.has(key)) {
          seen.set(key, object);
        }
      }
    });
  }
  return [...seen.values()];
}

/** How long a tile may wait on its compile before it shows regardless. */
const COMPILE_WAIT_MS = 3000;

function withinCompileWait(done: Promise<void>): Promise<void> {
  return Promise.race([
    done,
    new Promise<void>((resolve) => setTimeout(resolve, COMPILE_WAIT_MS)),
  ]);
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
async function buildSport(
  terrain: TerrainLayer,
  file: string | undefined,
  ctx: TileStreamContext,
  url: (file: string) => string
): Promise<SportFixtureLayer | undefined> {
  const table = file ? await fetchOptionalJson<SportTable>(url(file)) : null;
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
    heightFog: ctx.heightFog,
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
    applyLook: (look) => {
      canopy.applyLook(look);
      own.applyLook(look);
    },
    setTime: (seconds) => {
      canopy.setTime(seconds);
      own.setTime(seconds);
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

async function buildDressing(
  terrain: TerrainLayer,
  extras: TerrainExtras,
  ctx: TileStreamContext,
  url: (file: string) => string
): Promise<TileDressing> {
  const d = extras.dressing;
  const tile = extras.tileId;
  if (!d) {
    return { tile };
  }
  const get = <T>(file: string): Features<T> =>
    file ? fetchFeatures<T>(url(file)) : Promise.resolve([]);
  const [
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
    sport,
    inventory,
    scanTrees,
    hedges,
    cultivated,
  ] = await Promise.all([
    get<VegRowFeature>(d.vegrows),
    get<CanopyFeature>(d.canopy),
    extras.ndvi
      ? loadNdviSampler(url(extras.ndvi), terrain.bounds)
      : Promise.resolve(null),
    get<LampFeature>(d.lamps),
    get<MonumentFeature>(d.monuments),
    get<FurnitureFeature>(d.furniture),
    get<RailFeature>(d.rail),
    get<BridgeFeature>(d.bridge),
    get<AreaFeature>(d.railarea),
    get<AreaFeature>(d.platform),
    buildSport(terrain, extras.sportTable, ctx, url),
    // the street-tree cadastre (tree-inventory-layer.ts)
    get<TreeFeature>(d.trees ?? ""),
    // laser-scan crowns outside the canopy mask (tiles with a laser scan)
    get<CanopyExtraFeature>(d.canopyx ?? ""),
    get<LowVegFeature>(d.lowveg ?? ""),
    // allotments, orchards, vineyards (cultivated-layer.ts)
    get<CultivatedFeature>(d.cultivated ?? ""),
  ]);
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
      heightFog: ctx.heightFog,
    }
  );
  // Born with the current look, not the default.
  vegetation.applyLook(ctx.look.get());
  const lowVegetation =
    hedges.length > 0
      ? buildLowVegetation(hedges, {
          offset: ctx.offset,
          heightAt: terrain.heightAt,
          heightFog: ctx.heightFog,
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
  const rail = buildRail(
    { rails, bridges, ballast, platforms },
    { ...ground, heightFog: ctx.heightFog }
  );
  // The bake writes only the monuments a tile owns; a basin that reaches
  // past the seam samples the neighbour's ground.
  const monumentLayer = buildMonuments(monuments, {
    ...ground,
    heightFog: ctx.heightFog,
  });
  // Owned by the bake (west/south edges in): stood on this tile's ground.
  const furnitureGroup = buildFurniture(furniture, {
    ...ground,
    heightAt: terrain.heightAt,
    heightFog: ctx.heightFog,
  });
  const vines = vineRows(cultivated);
  const vineyards =
    vines.length > 0
      ? buildVineyards(vines, {
          offset: ctx.offset,
          heightAt: terrain.heightAt,
          heightFog: ctx.heightFog,
        })
      : undefined;
  return {
    tile,
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
class DressingPlugin {
  name = "BRIDGE_DRESSING";
  readonly dressed = new WeakMap<Object3D, Dressed>();
  /** the content root a tile is being dressed for (before the renderer
   *  records it in engineData, which it skips when the load is aborted) */
  private readonly sceneOf = new WeakMap<object, Object3D>();
  /** content roots whose tile was disposed; whatever lands for them later
   *  is released on the spot */
  private readonly released = new WeakSet<Object3D>();
  /** tiles whose dressing was tried (see TileStream.dressingSettled) */
  readonly settled = new Set<string>();
  private readonly toData = new Matrix4();
  /** the sky-view rasters a tile's terrain and buildings share */
  readonly skyView: SharedRasters<Texture> = createSharedRasters(
    (url) => loadSkyViewTexture(url),
    (texture) => texture.dispose()
  );

  constructor(
    private readonly ctx: TileStreamContext,
    private readonly stream: Pick<
      TileStream,
      "cities" | "demolished" | "dressings" | "terrains"
    >
  ) {}

  private url = (file: string): string =>
    new URL(file, new URL(this.ctx.tilesetUrl, window.location.href)).href;

  async processTileModel(scene: Object3D, tile: object): Promise<void> {
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
    // ready by then instead of compiling inside a frame.
    await withinCompileWait(this.ctx.compile(scene));
    // Disposed while it was being dressed: the renderer drops an aborted
    // load without ever recording the scene, so nothing else frees it.
    if (this.released.has(scene)) {
      this.release(scene);
    }
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
        city.mesh.material as MeshStandardMaterial,
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
      heightFog: this.ctx.heightFog,
      lowRasters: this.ctx.lowRasters,
      ground: this.ctx.ground,
      offset: this.ctx.offset,
      renderer: this.ctx.renderer,
      sunDirection: this.ctx.sunDirection,
      skyView: this.skyView,
    });
    terrain.water?.setMist(this.ctx.look.get().waterMist);
    // The fine level's baked stairs, walls and kerbs: only their materials
    // here.
    const stairs = meshNamed(scene, "stairs");
    if (stairs) {
      dressStairs(stairs, this.ctx.heightFog);
      terrain.stairs = stairs;
    }
    const walls = meshNamed(scene, "walls");
    if (walls) {
      dressWalls(walls, this.ctx.heightFog);
      terrain.walls = walls;
    }
    const kerbs = meshNamed(scene, "kerbs");
    if (kerbs) {
      dressKerbs(kerbs, this.ctx.heightFog);
      terrain.kerbs = kerbs;
    }
    this.stream.terrains.add(terrain);
    this.dressed.set(scene, { terrain });
    if (extras.dressing) {
      this.queueDressing(scene, terrain, extras);
    }
  }

  /** Dressings build one at a time, after the gate: each is a long task. */
  private chain: Promise<void> = Promise.resolve();
  pending = 0;

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
        if (!entry) {
          return; // the tile left before its turn
        }
        const dressing = await buildDressing(
          terrain,
          extras,
          this.ctx,
          this.url
        );
        const parts = dressingParts(dressing);
        await withinCompileWait(
          Promise.all(
            compileRepresentatives(parts).map((o) => this.ctx.compile(o))
          ).then(() => undefined)
        );
        if (this.dressed.get(scene) !== entry) {
          disposeDressing(dressing);
          return;
        }
        // The content root is the viewer's Y-up scene frame (the renderer's
        // up-axis turn cancels the world group's), so the Y-up dressing
        // hangs under it and leaves with its tile.
        scene.add(...parts);
        entry.dressing = dressing;
        this.stream.dressings.add(dressing);
      })
      .catch(() => {
        // A dressing that fails leaves its tile bare, never the stream stuck.
      })
      .finally(() => {
        this.pending--;
        this.settled.add(extras.tileId);
        this.ctx.onChange();
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

  /** Frees everything dressed onto one content root. */
  private release(scene: Object3D): void {
    const dressed = this.dressed.get(scene);
    if (!dressed) {
      return;
    }
    this.dressed.delete(scene);
    if (dressed.city) {
      this.stream.cities.delete(dressed.city);
      dressed.city.dispose();
    }
    if (dressed.svf) {
      this.skyView.release(dressed.svf);
    }
    if (dressed.terrain) {
      this.stream.terrains.delete(dressed.terrain);
      dressed.terrain.dispose();
    }
    if (dressed.dressing) {
      this.stream.dressings.delete(dressed.dressing);
      disposeDressing(dressed.dressing);
    }
    this.ctx.onChange();
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
    visibleDressings: memo(() =>
      [...stream.dressings].filter((d) =>
        isShown(d.vegetation?.group ?? d.lamps?.group ?? d.rail ?? null)
      )
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
