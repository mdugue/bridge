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
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
} from "three/webgpu";
import { finished, type Steps } from "@/lib/city/build-steps";
import type { AskSet } from "@/lib/city/ask-solids";
import type { TrafficFeature } from "@/lib/city/features";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import type { CityLayer } from "./city-layer";
import type { TrafficBuilder } from "./data-layers-feature";
import type { LampControl } from "./lamp-layer";
import type { TerrainLayer } from "./terrain-layer";
import { markSceneShared } from "./three-utils";
import { trafficAskSet } from "./traffic-ask";
import { buildTraffic } from "./traffic-layer";
import {
  asksOf,
  buildAsksWhenIdle,
  catchUp,
  DressingPlugin,
  dressingParts,
  handOverWaitMs,
  PHONE_STREAM,
  orderStreaming,
  showDataLayers,
  type TileDressing,
  type TileStreamContext,
  type TrafficHost,
  takesOver,
  trafficSlot,
} from "./tile-stream";
import type { VegetationControl } from "./vegetation-layer";

test("a dressing that joins the stream late takes the season, night and look of now", () => {
  const calls: string[] = [];
  const vegetation = {
    applyLook: (look: { multiTuft: boolean }) =>
      calls.push(`look ${look.multiTuft}`),
    setSeason: (day: number) => {
      calls.push(`season ${day}`);
      return true;
    },
  } as unknown as VegetationControl;
  const lamps = {
    setNightFactor: (night: number) => calls.push(`night ${night}`),
  } as unknown as LampControl;
  const look = createLookState();
  look.set({ multiTuft: false });
  // Built on 10 July by day; the scene moved on to a January night while
  // its compile was pending.
  catchUp({ vegetation, lamps }, { look, night: () => 1, season: () => 9 });
  expect(calls).toEqual(["look false", "season 9", "night 1"]);
});

test("the stream's dispose releases every dressed tile, quietly", () => {
  let changes = 0;
  const stream = {
    cities: new Set<CityLayer>(),
    terrains: new Set<TerrainLayer>(),
    dressings: new Set<TileDressing>(),
    demolished: new Map<string, Set<number>>(),
    demolishedGroups: new Set<number>(),
  };
  const plugin = new DressingPlugin(
    {
      // the gate never opens: nothing is built here
      dressingGate: new Promise<void>(() => undefined),
      bootTile: () => null,
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
  // (a TileDressing field left out of DRESSING_PARTS does not compile: the
  // table `satisfies` a record of every field)
  const group = () => new Object3D();
  const control = () => ({ group: group() });
  const parts = {
    vegetation: control(),
    lowVegetation: group(),
    lamps: control(),
    monuments: control(),
    furniture: group(),
    rail: group(),
    tram: group(),
    riverside: group(),
    traffic: control(),
    sport: control(),
    vineyards: group(),
  };
  const full = { tile: "t", ...parts } as unknown as TileDressing;
  // each name's accessor hands over that field's own scene part
  const own = Object.values(parts).map((p) =>
    p instanceof Object3D ? p.uuid : p.group.uuid
  );
  expect(
    dressingParts(full)
      .map((o) => o.uuid)
      .sort()
  ).toEqual(own.sort());
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
      bootTile: () => null,
      compile: () => compiling,
      onChange: () => undefined,
    } as unknown as TileStreamContext,
    {
      cities: new Set(),
      terrains: new Set(),
      dressings: new Set(),
      demolished: new Map(),
      demolishedGroups: new Set<number>(),
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
      bootTile: () => null,
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
      demolishedGroups: new Set<number>(),
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

test("a city drops its normals' and places on the wall's CPU copies once its compile uploaded them, and only then", async () => {
  for (const compiled of [true, false]) {
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => undefined),
        bootTile: () => null,
        compile: () => Promise.resolve(compiled),
        onChange: () => undefined,
      } as unknown as TileStreamContext,
      {
        cities: new Set(),
        terrains: new Set(),
        dressings: new Set(),
        demolished: new Map(),
        demolishedGroups: new Set<number>(),
      }
    );
    const geometry = new BoxGeometry();
    geometry.setAttribute(
      "facade",
      new BufferAttribute(
        new Int16Array(4 * geometry.attributes.position.count),
        4,
        true
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
    expect(geometry.getAttribute("facade").array.length === 0).toBe(compiled);
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
        bootTile: () => null,
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
        demolishedGroups: new Set<number>(),
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
      bootTile: () => null,
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
      demolishedGroups: new Set<number>(),
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

test("a tile released while a compile still runs is never dressed after the wait", async () => {
  // the content's own compile outlasts everything here
  const blocker = new Object3D();
  const failures: unknown[] = [];
  const stream = {
    cities: new Set<CityLayer>(),
    terrains: new Set<TerrainLayer>(),
    dressings: new Set<TileDressing>(),
    demolished: new Map<string, Set<number>>(),
    demolishedGroups: new Set<number>(),
  };
  const plugin = new DressingPlugin(
    {
      dressingGate: Promise.resolve(),
      bootTile: () => null,
      compile: (o: Object3D) =>
        o === blocker
          ? new Promise<boolean>(() => undefined)
          : Promise.resolve(true),
      look: createLookState(),
      night: () => 0,
      season: () => 180,
      onDressingFailed: (error: unknown) => failures.push(error),
      onChange: () => undefined,
    } as unknown as TileStreamContext,
    stream
  );
  const scene = new Object3D();
  const terrain = {
    rasters: [],
    dispose: () => undefined,
  } as unknown as TerrainLayer;
  plugin.dressed.set(scene, { terrain });
  // reason: the queue and the compile count are private; the test drives
  // them directly, without the terrain build a renderer would need
  const inner = plugin as unknown as {
    compileUnder: (
      scene: Object3D,
      objects: Object3D[],
      where: string
    ) => Promise<unknown>;
    queueDressing: (
      scene: Object3D,
      terrain: TerrainLayer,
      extras: unknown
    ) => Promise<void>;
  };
  void inner.compileUnder(scene, [blocker], "content t");
  const queued = inner.queueDressing(scene, terrain, { tileId: "t", level: 0 });
  // the renderer unloads the tile before the dressing's turn: the release
  // waits for the running compile, the entry stays
  plugin.disposeTile({ engineData: { scene } });
  await queued;
  // (the release ended the tile's wait at once; the queue goes on)
  while (plugin.pending > 0) {
    await nextTask();
  }
  expect(failures).toEqual([]);
  expect(plugin.settled.has("t")).toBe(true);
  expect(stream.dressings.size).toBe(0);
});

/** A plugin whose compiles resolve at once, and a content root with a mesh
 *  whose geometry reports its own dispose. */
function abortableLoad() {
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => undefined),
      bootTile: () => null,
      compile: () => Promise.resolve(),
      onChange: () => undefined,
    } as unknown as TileStreamContext,
    {
      cities: new Set(),
      terrains: new Set(),
      dressings: new Set(),
      demolished: new Map(),
      demolishedGroups: new Set<number>(),
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

/** A task, long enough for the code under test's own next task: a traffic
 *  slot sets its timer only after its builder's load has resolved, past
 *  the microtasks of the call that showed it. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a load the renderer aborts after its compile is freed by the plugin (the renderer frees only its textures)", async () => {
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

test("a phone streams fewer contents at once, on queues of their own in our order", () => {
  const phone = new TilesRenderer("https://example.com/tileset.json");
  const desktop = new TilesRenderer("https://example.com/tileset.json");
  orderStreaming(phone, "mobile", () => null);
  orderStreaming(desktop, "desktop", () => null);
  expect(phone.parseQueue.maxJobs).toBe(PHONE_STREAM.parses);
  expect(phone.downloadQueue.maxJobsPerOrigin).toBe(
    PHONE_STREAM.downloadsPerOrigin
  );
  // a desktop keeps the renderer's limits, on queues of its own
  expect(desktop.parseQueue).not.toBe(DEFAULT_PARSE_QUEUE);
  expect(desktop.parseQueue.maxJobs).toBe(DEFAULT_PARSE_QUEUE.maxJobs);
  expect(desktop.downloadQueue).not.toBe(DEFAULT_DOWNLOAD_QUEUE);
  expect(desktop.downloadQueue.maxJobsPerOrigin).toBe(
    DEFAULT_DOWNLOAD_QUEUE.maxJobsPerOrigin
  );
  // not the renderer's error order: a tile's coarse ground before its
  // buildings
  const at = (uri: string) => ({
    content: { uri },
    traversal: { distanceFromCamera: 0, error: 0, inFrustum: true, used: true },
  });
  for (const queue of [phone.parseQueue, desktop.downloadQueue]) {
    expect(
      queue.priorityCallback?.(
        at("terrain_a_l1.0.glb.gz"),
        at("city_a.0.glb.gz")
      )
    ).toBe(1);
  }
  // the module-wide defaults another renderer shares are left as they were
  expect(DEFAULT_PARSE_QUEUE.maxJobs).toBeGreaterThan(PHONE_STREAM.parses);
  phone.dispose();
  desktop.dispose();
});

test("a hung dressing's ask sets come in idle time, into the same array; none for a dressing that left", () => {
  const idle: (() => void)[] = [];
  const later = (work: () => void) => {
    idle.push(work);
    return () => undefined;
  };
  const set = {
    box: {},
    nearest: () => null,
  } as unknown as AskSet<FeatureInquiry>;
  const dressing = (): TileDressing => {
    const asks: AskSet<FeatureInquiry>[] = [];
    function* build() {
      yield;
      asks.push(set);
    }
    return { tile: "t", asks, buildAsks: build() };
  };
  // the slices run at once here
  const now = (steps: Steps<unknown>) => Promise.resolve(finished(steps));
  const hung = dressing();
  const asks = hung.asks;
  buildAsksWhenIdle(hung, () => true, later, now);
  expect(hung.asks).toEqual([]);
  idle.shift()?.();
  expect(hung.asks).toBe(asks);
  expect(hung.asks).toEqual([set]);
  // run once, and its features let go of
  expect(hung.buildAsks).toBeUndefined();
  const gone = dressing();
  buildAsksWhenIdle(gone, () => false, later, now);
  idle.shift()?.();
  expect(gone.asks).toEqual([]);
  // a dressing with nothing to build waits for nothing
  buildAsksWhenIdle({ tile: "t" }, () => true, later, now);
  expect(idle).toHaveLength(0);
  // a question before the idle time builds them at once, and only once
  const early = dressing();
  buildAsksWhenIdle(early, () => true, later, now);
  expect(asksOf(early)).toEqual([set]);
  expect(asksOf(early)).toEqual([set]);
  idle.shift()?.();
  expect(early.asks).toEqual([set]);
});

test("a question while the ask sets build in slices finishes them, once", async () => {
  const idle: (() => void)[] = [];
  const later = (work: () => void) => {
    idle.push(work);
    return () => undefined;
  };
  const set = {
    box: {},
    nearest: () => null,
  } as unknown as AskSet<FeatureInquiry>;
  const asks: AskSet<FeatureInquiry>[] = [];
  let steps = 0;
  function* build() {
    for (let i = 0; i < 3; i++) {
      steps++;
      yield;
    }
    asks.push(set);
  }
  const d: TileDressing = { tile: "t", asks, buildAsks: build() };
  // a slice is one step, and the next waits for `go`
  let go: () => void = () => undefined;
  const sliced = async (s: Steps<unknown>) => {
    for (let r = s.next(); !r.done; r = s.next()) {
      await new Promise<void>((resolve) => {
        go = resolve;
      });
    }
  };
  buildAsksWhenIdle(d, () => true, later, sliced);
  idle.shift()?.();
  expect(steps).toBe(1);
  expect(asks).toEqual([]);
  // the question finishes what is left at once
  expect(asksOf(d)).toEqual([set]);
  expect(steps).toBe(3);
  go();
  await Promise.resolve();
  await Promise.resolve();
  expect(asks).toEqual([set]);
  expect(d.buildAsks).toBeUndefined();
});

test("a dressing whose tile leaves before its idle time never builds its ask sets", () => {
  // the idle callback whenIdle (main-yield.ts) asks the browser for
  const idle: (() => void)[] = [];
  const host = globalThis as { requestIdleCallback?: unknown };
  const had = "requestIdleCallback" in host;
  const saved = host.requestIdleCallback;
  host.requestIdleCallback = (work: () => void) => idle.push(work);
  try {
    const stream = {
      cities: new Set<CityLayer>(),
      terrains: new Set<TerrainLayer>(),
      dressings: new Set<TileDressing>(),
      demolished: new Map<string, Set<number>>(),
      demolishedGroups: new Set<number>(),
    };
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => undefined),
        bootTile: () => null,
        look: createLookState(),
        night: () => 0,
        season: () => 180,
        onChange: () => undefined,
      } as unknown as TileStreamContext,
      stream
    );
    const scene = new Object3D();
    const terrain = {
      rasters: [],
      dispose: () => undefined,
    } as unknown as TerrainLayer;
    const entry = { terrain };
    plugin.dressed.set(scene, entry);
    let built = 0;
    const dressing: TileDressing = {
      tile: "t",
      asks: [],
      buildAsks: (function* () {
        built++;
        yield;
      })(),
      furniture: new Group(),
    };
    // reason: the hang is private; the test hangs a built dressing without
    // the terrain build a renderer would need
    const inner = plugin as unknown as {
      hangDressing: (scene: Object3D, entry: object, d: TileDressing) => void;
    };
    inner.hangDressing(scene, entry, dressing);
    expect(idle).toHaveLength(1);
    // the renderer unloads the tile before the page is idle
    plugin.disposeTile({ engineData: { scene } });
    idle.shift()?.();
    expect(built).toBe(0);
    expect(asksOf(dressing)).toEqual([]);
    expect(built).toBe(0);
  } finally {
    if (had) {
      host.requestIdleCallback = saved;
    } else {
      delete host.requestIdleCallback;
    }
  }
});

test("a phone's parse slot never waits on a dressing; a desktop's a little", () => {
  expect(handOverWaitMs("mobile")).toBe(0);
  expect(handOverWaitMs("desktop")).toBeGreaterThan(0);
  // well under the compile's own bound and the old 10 s
  expect(handOverWaitMs("desktop")).toBeLessThanOrEqual(3000);
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

/** The data layers' traffic builder as the slot waits for it, there at
 *  once. */
const builder: TrafficBuilder = { build: buildTraffic, askSet: trafficAskSet };
const loaded = () => Promise.resolve(builder);

/** A tile's counted traffic as a slot: one two-way street, its dressing's
 *  ask list, and a host whose compiles the test holds and counts. */
function trafficTile(
  opts: {
    gone?: () => boolean;
    load?: () => Promise<TrafficBuilder | null>;
    turn?: TrafficHost["turn"];
  } = {}
) {
  const street: TrafficFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [100, 0],
      ],
    },
    properties: { t: 9000, f: 6000, b: 3000 },
  };
  const asks: AskSet<FeatureInquiry>[] = [];
  const slot = trafficSlot({
    load: opts.load ?? loaded,
    features: [street],
    bridges: [],
    ground: { offset: { cx: 0, cy: 0 }, heightAt: () => 110 },
    detail: "fine",
    tile: "t",
    asks,
  });
  const root = new Object3D();
  const compiled: Group[] = [];
  let finish = (): void => undefined;
  let built = 0;
  const freeErrors: unknown[][] = [];
  const host: TrafficHost = {
    root,
    compile: (group) => {
      compiled.push(group);
      return new Promise((resolve) => {
        finish = () => resolve("done");
      });
    },
    turn: opts.turn ?? ((work) => work()),
    freeFailed: (errors) => {
      freeErrors.push(errors);
    },
    gone: opts.gone ?? (() => false),
    built: () => {
      built++;
    },
    failed: (err) => {
      throw err;
    },
  };
  return {
    asks,
    built: () => built,
    compiled,
    finish: () => finish(),
    freeErrors,
    host,
    root,
    slot,
  };
}

test("the counted traffic costs nothing while the layer is off", async () => {
  const { asks, compiled, host, slot } = trafficTile();
  const d: TileDressing = { tile: "t", traffic: slot };
  slot.attach(host);
  catchUp(d, {
    look: createLookState(),
    night: () => 0,
    season: () => 180,
  });
  showDataLayers(d, { trafficLayer: false });
  await nextTask();
  expect(slot.group).toBeNull();
  expect(dressingParts(d)).toEqual([]);
  expect(compiled).toHaveLength(0);
  expect(asks).toHaveLength(0);
});

test("the first switch-on builds and compiles the bodies once; off keeps them, the release frees them", async () => {
  const { asks, built, compiled, finish, host, root, slot } = trafficTile();
  const d: TileDressing = { tile: "t", traffic: slot };
  // switched on before the dressing hangs: nothing to hang it on yet
  showDataLayers(d, { trafficLayer: true });
  await nextTask();
  expect(slot.group).toBeNull();
  slot.attach(host);
  const first = slot.show();
  const second = slot.show();
  await nextTask();
  // hung hidden while it compiles, once
  expect(compiled).toHaveLength(1);
  expect(slot.group?.parent).toBe(root);
  expect(slot.group?.visible).toBe(false);
  expect(asks).toHaveLength(0);
  finish();
  await Promise.all([first, second]);
  expect(compiled).toHaveLength(1);
  expect(built()).toBe(1);
  expect(slot.group?.visible).toBe(true);
  expect(dressingParts(d)).toEqual([slot.group as Group]);
  // the probe asks its sections now
  expect(asks).toHaveLength(1);
  expect(slot.asks()).toBe(asks[0]);
  // off: hidden, kept; on again: no second build
  showDataLayers(d, { trafficLayer: false });
  const bodies = slot.group;
  expect(bodies?.visible).toBe(false);
  await slot.show();
  expect(slot.group).toBe(bodies);
  expect(bodies?.visible).toBe(true);
  expect(compiled).toHaveLength(1);
  // the tile's release frees them
  let freed = false;
  const mesh = bodies?.children[0] as Mesh | undefined;
  mesh?.geometry.addEventListener("dispose", () => {
    freed = true;
  });
  expect(slot.dispose()).toEqual([]);
  expect(freed).toBe(true);
  expect(slot.group).toBeNull();
  expect(bodies?.parent).toBeNull();
});

test("a tile released while its traffic compiles gets nothing shown, asked or weighed", async () => {
  let gone = false;
  const { asks, built, finish, host, slot } = trafficTile({
    gone: () => gone,
  });
  slot.attach(host);
  const showing = slot.show();
  await nextTask();
  const bodies = slot.group;
  expect(bodies).not.toBeNull();
  // the renderer unloads the tile while the compile runs
  gone = true;
  finish();
  await showing;
  expect(bodies?.visible).toBe(false);
  expect(asks).toHaveLength(0);
  expect(built()).toBe(0);
  // ...and its release (once the compile ended) frees them
  slot.dispose();
  expect(bodies?.parent).toBeNull();
});

test("bodies freed while their compile runs are freed once it ends", async () => {
  const { finish, freeErrors, host, slot } = trafficTile();
  slot.attach(host);
  const showing = slot.show();
  await nextTask();
  const bodies = slot.group;
  const mesh = bodies?.children[0] as Mesh | undefined;
  let freed = false;
  mesh?.geometry.addEventListener("dispose", () => {
    freed = true;
  });
  // the dressing comes down (its own compile ran out of memory) while the
  // traffic's compile still runs: taken down now, freed only after
  expect(slot.dispose()).toEqual([]);
  expect(bodies?.parent).toBeNull();
  expect(slot.group).toBeNull();
  await nextTask();
  expect(freed).toBe(false);
  finish();
  await showing;
  await nextTask();
  expect(freed).toBe(true);
  expect(freeErrors).toEqual([[]]);
});

test("a switch-on builds the tiles' bodies one after another", async () => {
  // the dressings' chain, as the plugin hands it to every slot
  let chain = Promise.resolve();
  const turn: TrafficHost["turn"] = (work) => {
    const run = chain.then(work);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  const a = trafficTile({ turn });
  const b = trafficTile({ turn });
  a.slot.attach(a.host);
  b.slot.attach(b.host);
  const showing = [a.slot.show(), b.slot.show()];
  await nextTask();
  await nextTask();
  // the first tile's turn holds the chain while its compile runs
  expect(a.compiled).toHaveLength(1);
  expect(b.compiled).toHaveLength(0);
  expect(b.slot.group).toBeNull();
  a.finish();
  await nextTask();
  await nextTask();
  expect(b.compiled).toHaveLength(1);
  b.finish();
  await Promise.all(showing);
  expect(a.built()).toBe(1);
  expect(b.built()).toBe(1);
});

test("a dressing freed before its traffic's turn builds nothing", async () => {
  const { compiled, host, slot } = trafficTile();
  slot.attach(host);
  const showing = slot.show();
  slot.dispose();
  await showing;
  expect(slot.group).toBeNull();
  expect(compiled).toHaveLength(0);
});

/** The builder on its way (the data layers starting): it arrives when the
 *  test says. */
function builderOnItsWay() {
  let arrive = (): void => undefined;
  const coming = new Promise<TrafficBuilder>((resolve) => {
    arrive = () => resolve(builder);
  });
  return { arrive: () => arrive(), load: () => coming };
}

test("tiles hung before the builder arrives get their bodies when it does, and later tiles too", async () => {
  const { arrive, load } = builderOnItsWay();
  const early = trafficTile({ load });
  early.slot.attach(early.host);
  const showing = early.slot.show();
  await nextTask();
  // nothing built while the builder is on its way
  expect(early.compiled).toHaveLength(0);
  expect(early.slot.group).toBeNull();
  arrive();
  await nextTask();
  expect(early.compiled).toHaveLength(1);
  early.finish();
  await showing;
  expect(early.slot.group?.visible).toBe(true);
  // a tile that lands once it has come builds at once
  const late = trafficTile({ load });
  late.slot.attach(late.host);
  const lateShowing = late.slot.show();
  await nextTask();
  expect(late.compiled).toHaveLength(1);
  late.finish();
  await lateShowing;
  expect(late.slot.group?.visible).toBe(true);
});

test("a builder that did not come builds nothing and is asked for on the next switch-on", async () => {
  let fails = true;
  // (the host's `failed` throws: a builder that did not come is no failed
  // build of this tile, and must not be reported as one)
  const { compiled, finish, host, slot } = trafficTile({
    load: () => (fails ? Promise.reject(new Error("start")) : loaded()),
  });
  slot.attach(host);
  await slot.show();
  expect(compiled).toHaveLength(0);
  expect(slot.group).toBeNull();
  fails = false;
  const again = slot.show();
  await nextTask();
  expect(compiled).toHaveLength(1);
  finish();
  await again;
  expect(slot.group?.visible).toBe(true);
});

test("a layer switched off while its builder comes builds nothing until it is on again", async () => {
  const { arrive, load } = builderOnItsWay();
  const { compiled, finish, host, slot } = trafficTile({ load });
  slot.attach(host);
  const showing = slot.show();
  slot.hide();
  arrive();
  await showing;
  expect(compiled).toHaveLength(0);
  expect(slot.group).toBeNull();
  const again = slot.show();
  await nextTask();
  expect(compiled).toHaveLength(1);
  finish();
  await again;
  expect(slot.group?.visible).toBe(true);
});
