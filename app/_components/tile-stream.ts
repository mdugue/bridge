import { TilesRenderer } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/three/plugins";
import {
  BufferAttribute,
  type Camera,
  type Group,
  Matrix4,
  type Mesh,
  type Object3D,
  type Vector3,
  type WebGLRenderer,
} from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyFeature,
  LampFeature,
  RailFeature,
  VegRowFeature,
  WallFeature,
} from "@/lib/city/features";
import type { LookState } from "@/lib/city/look-state";
import type {
  CityExtras,
  ContentExtras,
  TerrainExtras,
} from "@/lib/city/tileset";
import { type CityLayer, dressCity } from "./city-layer";
import { nodeRenderer } from "./gpu-mode";
import { fetchFeatures, fetchOptionalJson } from "./fetch-optional";
import type { HeightFogUniforms } from "./height-fog";
import { buildLamps, type LampControl } from "./lamp-layer";
import { buildRail } from "./rail-layer";
import { dressTerrain, type TerrainLayer } from "./terrain-layer";
import { disposeObject3D } from "./three-utils";
import {
  buildVegetation,
  loadNdviSampler,
  type VegetationControl,
} from "./vegetation-layer";
import type { StyleResources } from "./visual-style";
import { buildWalls } from "./wall-layer";

/**
 * The world as it streams in: OGC 3D Tiles (lib/city/tileset.ts) through
 * 3DTilesRendererJS, which decides what to load and unload from the cameras,
 * the screen-space error and a memory budget. This module only dresses what
 * lands — the terrain material, water, buildings, vegetation, lamps, rails,
 * walls — and undresses what leaves, so every tile is one handle whose
 * content comes and goes with it.
 */
export interface TileDressing {
  lamps?: LampControl;
  rail?: Group;
  tile: string;
  vegetation?: VegetationControl;
  walls?: Group;
}

export interface TileStreamContext {
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
  meadowNdvi: { value: number };
  /** the current night factor, for lamps that land later */
  night: () => number;
  offset: { cx: number; cy: number };
  /** content landed, left, or changed visibility */
  onChange: () => void;
  renderer: WebGLRenderer;
  styleResources: StyleResources;
  sunDirection: Vector3;
  tilesetUrl: string;
}

export interface TileStream {
  cities: Set<CityLayer>;
  /** dressings queued or being built */
  pendingDressings: () => number;
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

/**
 * SPIKE (plan 020): three's WebGPU backend maps 3-component 8/16-bit
 * attributes (the quantised positions and normals) to padded ×4 formats,
 * but has no mapping for 1-component 8/16-bit ones — the per-vertex
 * feature id (uint16) and roof flag (uint8) — so their pipeline failed; the
 * WebGL2 backend rejects them against TSL's float attribute too. Widen
 * just those two to Float32 on load (a few hundred KB per city tile).
 */
function floatAttributes(mesh: Mesh): void {
  const geometry = mesh.geometry;
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (attr.itemSize !== 1 || attr.array instanceof Float32Array) {
      continue;
    }
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < attr.itemSize; c++) {
        out[i * attr.itemSize + c] = attr.getComponent(i, c);
      }
    }
    geometry.setAttribute(name, new BufferAttribute(out, attr.itemSize));
  }
}

function dressingParts(d: TileDressing): Object3D[] {
  return [d.vegetation?.group, d.lamps?.group, d.rail, d.walls].filter(
    (part): part is Group => part !== undefined
  );
}

function disposeDressing(d: TileDressing): void {
  d.lamps?.dispose();
  for (const part of dressingParts(d)) {
    part.removeFromParent();
    disposeObject3D(part);
  }
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
    rails,
    bridges,
    ballast,
    platforms,
    walls,
  ] = await Promise.all([
    get<VegRowFeature>(d.vegrows),
    get<CanopyFeature>(d.canopy),
    extras.ndvi
      ? loadNdviSampler(url(extras.ndvi), terrain.bounds)
      : Promise.resolve(null),
    get<LampFeature>(d.lamps),
    get<RailFeature>(d.rail),
    get<BridgeFeature>(d.bridge),
    get<AreaFeature>(d.railarea),
    get<AreaFeature>(d.platform),
    get<WallFeature>(d.walls),
  ]);
  // Rails and walls may run past the tile edge: they sample the ground over
  // every loaded terrain, not this tile's alone.
  const ground = { offset: ctx.offset, heightAt: ctx.heightAt };
  const vegetation = buildVegetation(
    { rows, canopy, ndviAt: ndviAt ?? undefined },
    {
      offset: ctx.offset,
      heightAt: terrain.heightAt,
      sunDirection: ctx.sunDirection,
      heightFog: ctx.heightFog,
    }
  );
  // Born with the current look, not the default.
  vegetation.applyLook(ctx.look.get());
  const lampControl = buildLamps(lamps, {
    ...ground,
    heightAt: terrain.heightAt,
  });
  lampControl.setNightFactor(ctx.night());
  const rail = buildRail(
    { rails, bridges, ballast, platforms },
    { ...ground, heightFog: ctx.heightFog }
  );
  const wallGroup = buildWalls(walls, { ...ground, heightFog: ctx.heightFog });
  return { tile, vegetation, lamps: lampControl, rail, walls: wallGroup };
}

/**
 * The 3DTilesRendererJS plugin that dresses content as it loads. Runs inside
 * the renderer's own load (awaited before the tile is marked loaded), so a
 * tile is never shown half-dressed.
 */
class DressingPlugin {
  name = "BRIDGE_DRESSING";
  readonly dressed = new WeakMap<Object3D, Dressed>();
  private readonly toData = new Matrix4();

  constructor(
    private readonly ctx: TileStreamContext,
    private readonly stream: Pick<
      TileStream,
      "cities" | "demolished" | "dressings" | "terrains"
    >
  ) {}

  private url = (file: string): string =>
    new URL(file, new URL(this.ctx.tilesetUrl, window.location.href)).href;

  async processTileModel(scene: Object3D): Promise<void> {
    const extras = scene.userData as ContentExtras;
    const mesh = scene.getObjectByProperty("isMesh", true) as Mesh | undefined;
    if (!mesh) {
      return;
    }
    if (nodeRenderer()) {
      floatAttributes(mesh);
    }
    if (extras.kind === "city") {
      await this.dressCity(scene, mesh, extras);
    } else if (extras.kind === "terrain") {
      await this.dressTerrain(scene, mesh, extras);
    }
  }

  private async dressCity(scene: Object3D, mesh: Mesh, extras: CityExtras) {
    const demolished = this.stream.demolished.get(extras.tileId) ?? new Set();
    const city = dressCity(
      mesh,
      extras.tileId,
      this.ctx.styleResources,
      demolished
    );
    city.footprints = await fetchOptionalJson<[number, number][][][]>(
      this.url(extras.footprints)
    );
    this.stream.cities.add(city);
    this.dressed.set(scene, { city });
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
      meadowNdvi: this.ctx.meadowNdvi,
      offset: this.ctx.offset,
      renderer: this.ctx.renderer,
      sunDirection: this.ctx.sunDirection,
    });
    terrain.water?.setMist(this.ctx.look.get().waterMist);
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
        this.ctx.onChange();
      });
  }

  disposeTile(tile: { engineData?: { scene?: Object3D | null } }): void {
    const scene = tile.engineData?.scene;
    const dressed = scene ? this.dressed.get(scene) : undefined;
    if (!(scene && dressed)) {
      return;
    }
    this.dressed.delete(scene);
    if (dressed.city) {
      this.stream.cities.delete(dressed.city);
      dressed.city.dispose();
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
  const stream: TileStream = {
    tiles,
    group: tiles.group,
    cities: new Set(),
    terrains: new Set(),
    dressings: new Set(),
    demolished: new Map(),
    pendingDressings: () => 0,
    visibleTerrains: () =>
      [...stream.terrains]
        .filter((t) => isShown(t.mesh))
        .sort((a, b) => a.level - b.level),
    visibleCities: () => [...stream.cities].filter((c) => isShown(c.mesh)),
    visibleDressings: () =>
      [...stream.dressings].filter((d) =>
        isShown(d.vegetation?.group ?? d.lamps?.group ?? d.rail ?? null)
      ),
    dispose: () => {
      tiles.dispose();
    },
  };
  const isShown = (object: Object3D | null): boolean => {
    let root: Object3D | null = object;
    while (root && root.parent !== tiles.group) {
      root = root.parent;
    }
    return root !== null && tiles.group.children.includes(root);
  };
  const dressing = new DressingPlugin(ctx, stream);
  stream.pendingDressings = () => dressing.pending;
  tiles.registerPlugin(dressing);
  for (const { camera, width, height } of cameras) {
    tiles.setCamera(camera);
    tiles.setResolution(camera, width, height);
  }
  tiles.addEventListener("load-model", ctx.onChange);
  tiles.addEventListener("tile-visibility-change", ctx.onChange);
  world.add(tiles.group);
  return stream;
}
