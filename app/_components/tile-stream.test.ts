import { expect, test } from "bun:test";
import {
  DEFAULT_DOWNLOAD_QUEUE,
  DEFAULT_PARSE_QUEUE,
} from "3d-tiles-renderer/core";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { createLookState } from "@/lib/city/look-state";
import {
  BoxGeometry,
  BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
} from "three/webgpu";
import type { CityLayer } from "./city-layer";
import type { LampControl } from "./lamp-layer";
import type { TerrainLayer } from "./terrain-layer";
import { markSceneShared } from "./three-utils";
import {
  catchUp,
  DRESSING_PART_NAMES,
  DressingPlugin,
  dressingParts,
  PHONE_STREAM,
  paceStreaming,
  type TileDressing,
  type TileStreamContext,
  takesOver,
} from "./tile-stream";
import type { VegetationControl } from "./vegetation-layer";

test("a dressing that joins the stream late takes the season, night and look of now", () => {
  const calls: string[] = [];
  const vegetation = {
    applyLook: (look: { shimmer: number }) =>
      calls.push(`look ${look.shimmer}`),
    setSeason: (day: number) => {
      calls.push(`season ${day}`);
      return true;
    },
  } as unknown as VegetationControl;
  const lamps = {
    setNightFactor: (night: number) => calls.push(`night ${night}`),
  } as unknown as LampControl;
  const look = createLookState();
  look.set({ shimmer: 0.25 });
  // Built on 10 July by day; the scene moved on to a January night while
  // its compile was pending.
  catchUp({ vegetation, lamps }, { look, night: () => 1, season: () => 9 });
  expect(calls).toEqual(["look 0.25", "season 9", "night 1"]);
});

test("the stream's dispose releases every dressed tile, quietly", () => {
  let changes = 0;
  const stream = {
    cities: new Set<CityLayer>(),
    terrains: new Set<TerrainLayer>(),
    dressings: new Set<TileDressing>(),
    demolished: new Map<string, Set<number>>(),
  };
  const plugin = new DressingPlugin(
    {
      // the gate never opens: nothing is built here
      dressingGate: new Promise<void>(() => undefined),
      onChange: () => {
        changes++;
      },
    } as unknown as TileStreamContext,
    stream
  );
  const freed: string[] = [];
  const terrain = {
    rasters: [],
    dispose: () => freed.push("terrain"),
  } as unknown as TerrainLayer;
  const city = { dispose: () => freed.push("city") } as unknown as CityLayer;
  stream.terrains.add(terrain);
  stream.cities.add(city);
  plugin.dressed.set(new Object3D(), { terrain });
  plugin.dressed.set(new Object3D(), { city, svf: "svf.png" });
  // 3DTilesRendererJS unregisters (and disposes) its plugins before it
  // disposes its tiles: disposeTile never comes for these.
  plugin.dispose();
  expect(freed).toEqual(["terrain", "city"]);
  expect(plugin.dressed.size).toBe(0);
  expect(stream.terrains.size).toBe(0);
  expect(stream.cities.size).toBe(0);
  expect(plugin.skyView.held()).toBe(0);
  // the app is going: no change reaches it
  expect(changes).toBe(0);
});

test("every part of a dressing is in the part table, so disposal and the census reach it", () => {
  const group = () => new Object3D();
  const control = () => ({ group: group() });
  // One of each: a TileDressing field left out of DRESSING_PARTS would be
  // neither disposed nor counted.
  const full = {
    tile: "t",
    vegetation: control(),
    lowVegetation: group(),
    lamps: control(),
    monuments: control(),
    furniture: group(),
    rail: group(),
    tram: group(),
    riverside: group(),
    traffic: group(),
    sport: control(),
    vineyards: group(),
  } as unknown as TileDressing;
  const fields = Object.keys(full).filter((key) => key !== "tile");
  expect([...DRESSING_PART_NAMES].sort() as string[]).toEqual(fields.sort());
  expect(dressingParts(full)).toHaveLength(fields.length);
  expect(dressingParts({ tile: "t" })).toEqual([]);
});

test("a tile that leaves while its compile runs is freed once the compile ends", async () => {
  let finish = (): void => undefined;
  const compiling = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => undefined),
      compile: () => compiling,
      onChange: () => undefined,
    } as unknown as TileStreamContext,
    {
      cities: new Set(),
      terrains: new Set(),
      dressings: new Set(),
      demolished: new Map(),
    }
  );
  const scene = new Object3D();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  scene.add(mesh);
  let freed = false;
  mesh.geometry.addEventListener("dispose", () => {
    freed = true;
  });
  const tile = {};
  const loading = plugin.processTileModel(scene, tile);
  // the renderer unloads the tile before its compile is through: three
  // cannot stop that compile, and it would upload the freed geometry again
  plugin.disposeTile(tile);
  expect(freed).toBe(false);
  finish();
  await loading;
  expect(freed).toBe(true);
});

test("a tile that leaves lets go of the site's shared index at once, while its compile still runs", async () => {
  let finish = (): void => undefined;
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => undefined),
      compile: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      onChange: () => undefined,
    } as unknown as TileStreamContext,
    {
      cities: new Set(),
      terrains: new Set(),
      dressings: new Set(),
      demolished: new Map(),
    }
  );
  const shared = new BufferAttribute(Uint32Array.from([0, 1, 2]), 1);
  markSceneShared(shared);
  const scene = new Object3D();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  mesh.geometry.setIndex(shared);
  scene.add(mesh);
  const tile = {};
  const loading = plugin.processTileModel(scene, tile);
  plugin.disposeTile(tile);
  // the tile renderer disposes the tile's geometries right after this; the
  // index other tiles draw with must be gone from them by then
  expect(mesh.geometry.index).toBeNull();
  finish();
  await loading;
});

test("a city drops its normals' and roof flags' CPU copies once its compile uploaded them, and only then", async () => {
  for (const compiled of [true, false]) {
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => undefined),
        compile: () => Promise.resolve(compiled),
        onChange: () => undefined,
      } as unknown as TileStreamContext,
      {
        cities: new Set(),
        terrains: new Set(),
        dressings: new Set(),
        demolished: new Map(),
      }
    );
    const geometry = new BoxGeometry();
    geometry.setAttribute(
      "roof",
      new BufferAttribute(
        new Float32Array(geometry.attributes.position.count),
        1
      )
    );
    const mesh = new Mesh(geometry, new MeshBasicNodeMaterial());
    const scene = new Object3D();
    scene.add(mesh);
    plugin.dressed.set(scene, {
      city: { mesh, dispose: () => undefined } as unknown as CityLayer,
    });
    // the renderer keeps the load (its scene recorded on the tile)
    await plugin.processTileModel(scene, { engineData: { scene } });
    // dropped only where the compile ran: a buffer three meets for the first
    // time without its numbers uploads empty
    expect(geometry.getAttribute("normal").array.length === 0).toBe(compiled);
    expect(geometry.getAttribute("roof").array.length === 0).toBe(compiled);
    // what collision, picks and demolish read stays
    expect(geometry.getAttribute("position").array.length).toBeGreaterThan(0);
    expect(geometry.getIndex()?.array.length).toBeGreaterThan(0);
  }
});

test("a compile the GPU had no room for is reported once, and drops nothing", async () => {
  for (const [error, reported] of [
    [
      new RangeError("Range consisting of offset and length are out of bounds"),
      true,
    ],
    [new TypeError("a bug, not memory"), false],
  ] as const) {
    const failures: string[] = [];
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => undefined),
        compile: () => Promise.reject(error),
        onAllocationFailure: (_: unknown, where: string) =>
          failures.push(where),
        onChange: () => undefined,
      } as unknown as TileStreamContext,
      {
        cities: new Set(),
        terrains: new Set(),
        dressings: new Set(),
        demolished: new Map(),
      }
    );
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    const scene = new Object3D();
    scene.userData = { tileId: "33412_5656_2_sn" };
    scene.add(mesh);
    plugin.dressed.set(scene, {
      city: { mesh, dispose: () => undefined } as unknown as CityLayer,
    });
    // the tile still loads: the frames retry what the compile could not
    await plugin.processTileModel(scene, { engineData: { scene } });
    expect(failures).toEqual(reported ? ["content 33412_5656_2_sn"] : []);
    expect(mesh.geometry.getAttribute("normal").array.length).toBeGreaterThan(
      0
    );
  }
});

test("a dressing whose build throws is reported, an allocation failure as one, and the tile settles", async () => {
  for (const error of [
    new TypeError("boom"),
    new RangeError("Array buffer allocation failed"),
  ]) {
    const failed: [unknown, string][] = [];
    const allocations: [unknown, string][] = [];
    const ctx = {
      dressingGate: Promise.resolve(),
      compile: () => Promise.resolve(true),
      onAllocationFailure: (err: unknown, where: string) =>
        allocations.push([err, where]),
      onDressingFailed: (err: unknown, tile: string) =>
        failed.push([err, tile]),
      onChange: () => undefined,
      // the build's first file URL reads it: the earliest throw a test
      // can inject without a renderer
      get tilesetUrl(): string {
        throw error;
      },
    } as unknown as TileStreamContext;
    const plugin = new DressingPlugin(ctx, {
      cities: new Set(),
      terrains: new Set(),
      dressings: new Set(),
      demolished: new Map(),
    });
    const scene = new Object3D();
    const terrain = {} as TerrainLayer;
    plugin.dressed.set(scene, { terrain });
    const tile = "33412_5656_2_sn";
    // reason: queueDressing is private; the test drives the queue directly,
    // without the terrain build a renderer would need
    const queue = (
      plugin as unknown as {
        queueDressing: (
          scene: Object3D,
          terrain: TerrainLayer,
          extras: unknown
        ) => Promise<void>;
      }
    ).queueDressing.bind(plugin);
    await queue(scene, terrain, {
      tileId: tile,
      level: 0,
      dressing: { vegrows: "vegrows.json" },
    });
    // the queue moves on: the tile counts as tried
    await nextTask();
    expect(plugin.settled.has(tile)).toBe(true);
    if (error instanceof RangeError) {
      expect(allocations).toEqual([[error, `dressing ${tile}`]]);
      expect(failed).toEqual([]);
    } else {
      expect(failed).toEqual([[error, tile]]);
      expect(allocations).toEqual([]);
    }
  }
});

/** A plugin whose compiles resolve at once, and a content root with a mesh
 *  whose geometry reports its own dispose. */
function abortableLoad() {
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => undefined),
      compile: () => Promise.resolve(),
      onChange: () => undefined,
    } as unknown as TileStreamContext,
    {
      cities: new Set(),
      terrains: new Set(),
      dressings: new Set(),
      demolished: new Map(),
    }
  );
  const scene = new Object3D();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  scene.add(mesh);
  const freed = { value: false };
  mesh.geometry.addEventListener("dispose", () => {
    freed.value = true;
  });
  return { freed, plugin, scene };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 1));

test("a load the renderer aborts after its compile is freed: it frees only the textures", async () => {
  const { freed, plugin, scene } = abortableLoad();
  const tile: { engineData?: { scene?: Object3D } } = {};
  await plugin.processTileModel(scene, tile);
  expect(freed.value).toBe(false);
  // the renderer never recorded the scene on the tile: it dropped the load
  await nextTask();
  expect(freed.value).toBe(true);
});

test("a load the renderer keeps is not freed", async () => {
  const { freed, plugin, scene } = abortableLoad();
  const tile: { engineData?: { scene?: Object3D } } = {};
  await plugin.processTileModel(scene, tile);
  tile.engineData = { scene };
  await nextTask();
  expect(freed.value).toBe(false);
});

test("a phone streams fewer contents at once, on queues of its own", () => {
  const phone = new TilesRenderer("https://example.com/tileset.json");
  const desktop = new TilesRenderer("https://example.com/tileset.json");
  paceStreaming(phone, "mobile");
  paceStreaming(desktop, "desktop");
  expect(phone.parseQueue.maxJobs).toBe(PHONE_STREAM.parses);
  expect(phone.downloadQueue.maxJobsPerOrigin).toBe(
    PHONE_STREAM.downloadsPerOrigin
  );
  // the renderer's own order of what loads first
  expect(phone.parseQueue.priorityCallback).toBe(
    DEFAULT_PARSE_QUEUE.priorityCallback
  );
  expect(phone.downloadQueue.priorityCallback).toBe(
    DEFAULT_DOWNLOAD_QUEUE.priorityCallback
  );
  // the module-wide defaults another renderer shares are left as they were
  expect(desktop.parseQueue).toBe(DEFAULT_PARSE_QUEUE);
  expect(DEFAULT_PARSE_QUEUE.maxJobs).toBeGreaterThan(PHONE_STREAM.parses);
  expect(desktop.downloadQueue).toBe(DEFAULT_DOWNLOAD_QUEUE);
  phone.dispose();
  desktop.dispose();
});

test("a level waits for its dressing only where it takes over from its tile's other level", () => {
  const fine = { tileId: "33412_5656_2_sn", level: 0 as const };
  const coarse = {
    kind: "terrain" as const,
    tileId: fine.tileId,
    level: 1 as const,
  };
  // zooming in: the coarse level stands in until the fine one is dressed
  expect(takesOver(fine, [coarse])).toBe(true);
  // and out again
  expect(takesOver({ ...coarse }, [{ ...coarse, level: 0 }])).toBe(true);
  // nothing of the tile on screen: shown at once, dressed after
  expect(takesOver(fine, [])).toBe(false);
  expect(
    takesOver(fine, [undefined, { kind: "city", tileId: fine.tileId }])
  ).toBe(false);
  // another tile's level, or the level itself (a reload)
  expect(takesOver(fine, [{ ...coarse, tileId: "33410_5656_2_sn" }])).toBe(
    false
  );
  expect(takesOver(fine, [{ ...coarse, level: 0 }])).toBe(false);
});
