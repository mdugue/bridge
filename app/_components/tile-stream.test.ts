import { expect, jest, test } from "bun:test";
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
import { finished } from "@/lib/city/build-steps";
import type { Steps } from "@/lib/city/build-steps";
import type { AskSet } from "@/lib/city/ask-solids";
import type { TrafficFeature } from "@/lib/city/features";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";
import type { Mural } from "@/lib/city/murals";
import type { CityLayer } from "./city-layer";
import type { MuralLayer } from "./mural-layer";
import type { TrafficBuilder } from "./data-layers-feature";
import type { TerrainLayer } from "./terrain-layer";
import { createWatch } from "./feature-seam";
import {
  disposeObject3D,
  estimateGeometryBytes,
  markSceneShared,
} from "./three-utils";
import { trafficAskSet } from "./traffic-ask";
import { buildTraffic } from "./traffic-layer";
import {
  asksOf,
  buildAsksWhenIdle,
  DressingPlugin,
  dressingPart,
  muralsPart,
  dressingParts,
  castersBatch,
  followEnvironment,
  handOverWaitMs,
  PHONE_STREAM,
  orderStreaming,
  takesOver,
  trafficSlot,
} from "./tile-stream";
import { COMPILE_WAIT_MS, createLateParts } from "./late-parts";
import type { Compiled, LateHandle, LatePart } from "./late-parts";
import { fakeHost, flush, gate } from "./late-parts.fixture";
import type {
  DressingSite,
  TileDressing,
  TileStreamContext,
  TrafficSlot,
} from "./tile-stream";
import type { VegetationControl } from "./vegetation-layer";

const nothing = (): void => undefined;
const emptyGroup = () => new Object3D();

/** A tile the way the renderer's queue sees it, by its content uri. */
const tileAt = (uri: string) => ({
  content: { uri },
  traversal: { distanceFromCamera: 0, error: 0, inFrustum: true, used: true },
});

/** The slices run at once. */
const runNow = async (steps: Steps<unknown>) => finished(steps);

/** A scene environment of its own: the season `day`, a fresh look store,
 *  the casters' changes counted. */
function fakeEnvironment(day = 180) {
  const env = {
    season: createWatch(day),
    look: createLookState(),
    casters: 0,
    castersChanged: () => {
      env.casters += 1;
    },
  };
  return env;
}

function* broken(): Steps<void> {
  yield;
  throw new Error("bad furniture");
}

test("a dressing's trees follow the scene's season from birth to release", async () => {
  const days: number[] = [];
  const vegetation = {
    // a crown changes on a day in winter only
    setSeason: (day: number) => {
      days.push(day);
      return day < 60;
    },
  } as unknown as VegetationControl;
  const env = fakeEnvironment(190);
  const casters = { hung: () => true, changed: castersBatch(env) };
  // born in July: the season of now, nothing cast differently
  const unfollow = followEnvironment({ vegetation }, env, casters);
  expect(days).toEqual([190]);
  // a change while it compiles, and one after it hangs: heard alike
  env.season.set(9);
  expect(days).toEqual([190, 9]);
  await flush();
  expect(env.casters).toBe(1);
  env.season.set(200);
  expect(days).toEqual([190, 9, 200]);
  await flush();
  expect(env.casters).toBe(1);
  // released: nothing more
  unfollow();
  env.season.set(10);
  expect(days).toEqual([190, 9, 200]);
  await flush();
  expect(env.casters).toBe(1);
});

test("a season change redraws the shadow map once, and only for the dressings that hang", async () => {
  const vegetation = {
    setSeason: (day: number) => day < 60,
  } as unknown as VegetationControl;
  const env = fakeEnvironment(190);
  const changed = castersBatch(env);
  const hung = { hung: () => true, changed };
  // three hung, one built but in no scene yet
  for (let i = 0; i < 3; i += 1) {
    followEnvironment({ vegetation }, env, hung);
  }
  let built = false;
  followEnvironment({ vegetation }, env, { hung: () => built, changed });
  env.season.set(9);
  await flush();
  expect(env.casters).toBe(1);
  // the next change is drawn again
  env.season.set(10);
  await flush();
  expect(env.casters).toBe(2);
  // only the unhung one's crowns change: nothing is drawn again
  const lone = fakeEnvironment(190);
  followEnvironment({ vegetation }, lone, {
    hung: () => built,
    changed: castersBatch(lone),
  });
  lone.season.set(9);
  await flush();
  expect(lone.casters).toBe(0);
  // once it hangs, it does
  built = true;
  lone.season.set(10);
  await flush();
  expect(lone.casters).toBe(1);
});

/** A dressing hung on a root of its own through its late part, over the
 *  fake host: built, compiled, hung. */
async function hungDressing(d: TileDressing, site: Partial<DressingSite> = {}) {
  const fake = fakeHost();
  const parts = createLateParts(fake.host);
  const root = new Object3D();
  const slot: DressingSite["slot"] = {};
  const dressings = new Set<TileDressing>();
  const look = createLookState();
  const handle = parts.add(
    dressingPart({
      tile: d.tile,
      level: "fine",
      root,
      slot,
      dressings,
      parts,
      look,
      live: () => true,
      failed: nothing,
      freeFailed: nothing,
      build: async () => await Promise.resolve(d),
      ...site,
    })
  );
  fake.load();
  await flush();
  fake.compiles[0]?.end("done");
  const outcome = await handle.settled;
  return { ...fake, dressings, handle, look, outcome, parts, root, slot };
}

test("the stream's dispose releases every dressed tile, quietly", async () => {
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
      dressingGate: new Promise<void>(() => {}),
      bootTile: () => null,
      onChange: () => {
        changes += 1;
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
  // a hung dressing hears the scene's season until its release
  const dressing: TileDressing = {
    tile: "t",
    unfollow: () => {
      freed.push("unfollow");
    },
  };
  const { parts, slot } = await hungDressing(dressing, {
    dressings: stream.dressings,
  });
  expect(stream.dressings.has(dressing)).toBe(true);
  plugin.dressed.set(new Object3D(), { terrain, late: parts, ...slot });
  plugin.dressed.set(new Object3D(), {
    city,
    late: createLateParts(fakeHost().host),
    svf: "svf.png",
  });
  // 3DTilesRendererJS unregisters (and disposes) its plugins before it
  // disposes its tiles: disposeTile never comes for these.
  plugin.dispose();
  expect(freed).toEqual(["terrain", "unfollow", "city"]);
  expect(stream.dressings.size).toBe(0);
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
  const control = () => ({ group: emptyGroup() });
  const parts = {
    vegetation: control(),
    lowVegetation: emptyGroup(),
    lamps: control(),
    monuments: control(),
    furniture: emptyGroup(),
    rail: emptyGroup(),
    tram: emptyGroup(),
    riverside: emptyGroup(),
    traffic: control(),
    sport: control(),
    vineyards: emptyGroup(),
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
  let finish = nothing;
  const compiling = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => {}),
      bootTile: () => null,
      compile: async () => await compiling,
      onChange: () => {},
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

test("a stream disposed while a shown tile's compile runs frees that tile once the compile ends", async () => {
  jest.useFakeTimers();
  try {
    let finish = nothing;
    const compiling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => {}),
        bootTile: () => null,
        compile: async () => await compiling,
        onChange: () => {},
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
    plugin.dressed.set(scene, { late: createLateParts(fakeHost().host) });
    // the renderer keeps the scene: shown once its compile wait is over
    const tile = { engineData: { scene } };
    const loading = plugin.processTileModel(scene, tile);
    await flush();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    await loading;
    jest.advanceTimersByTime(1);
    plugin.dispose();
    expect(freed).toBe(false);
    finish();
    await flush();
    expect(freed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("a stream disposed while a content it never dressed still compiles frees that content once the compile ends", async () => {
  jest.useFakeTimers();
  try {
    let finish = nothing;
    const compiling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => {}),
        bootTile: () => null,
        compile: async () => await compiling,
        onChange: () => {},
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
    const loading = plugin.processTileModel(scene, {});
    await flush();
    // the stream goes while the content waits on its compile: it has no
    // dressing, so the stream's dispose does not know it
    plugin.dispose();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    await loading;
    expect(freed).toBe(false);
    finish();
    await flush();
    expect(freed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test("a stream disposed while a compile runs keeps the site's shared rasters until that compile ends", async () => {
  jest.useFakeTimers();
  try {
    let finish = nothing;
    const compiling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const plugin = new DressingPlugin(
      {
        dressingGate: new Promise<void>(() => {}),
        bootTile: () => null,
        compile: async () => await compiling,
        onChange: () => {},
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
    scene.add(new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial()));
    plugin.dressed.set(scene, { late: createLateParts(fakeHost().host) });
    // a sky view the site shares, held past this tile
    void plugin.skyView.acquire("data:,");
    const loading = plugin.processTileModel(scene, {});
    await flush();
    // a remount: the stream goes while that compile still runs, which
    // would upload a raster freed now again
    plugin.dispose();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    await loading;
    expect(plugin.skyView.held()).toBe(1);
    finish();
    await flush();
    expect(plugin.skyView.held()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("a tile that leaves lets go of the site's shared index at once, while its compile still runs", async () => {
  let finish = nothing;
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => {}),
      bootTile: () => null,
      compile: async () =>
        await new Promise<void>((resolve) => {
          finish = resolve;
        }),
      onChange: () => {},
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
        dressingGate: new Promise<void>(() => {}),
        bootTile: () => null,
        compile: async () => compiled,
        onChange: () => {},
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
      city: { mesh, dispose: () => {} } as unknown as CityLayer,
      late: createLateParts(fakeHost().host),
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
        dressingGate: new Promise<void>(() => {}),
        bootTile: () => null,
        compile: async () => {
          throw error;
        },
        onAllocationFailure: (_: unknown, where: string) =>
          failures.push(where),
        onChange: () => {},
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
      city: { mesh, dispose: () => {} } as unknown as CityLayer,
      late: createLateParts(fakeHost().host),
    });
    // the tile still loads: the frames retry what the compile could not
    await plugin.processTileModel(scene, { engineData: { scene } });
    expect(failures).toEqual(reported ? ["content 33412_5656_2_sn"] : []);
    expect(mesh.geometry.getAttribute("normal").array.length).toBeGreaterThan(
      0
    );
  }
});

/** A plugin over a stream of its own; its content compiles end when the
 *  test says. */
function lateRootPlugin() {
  let finish = nothing;
  const compiling = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => {}),
      bootTile: () => null,
      compile: async () => await compiling.then(() => true),
      onChange: () => {},
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
  scene.add(new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial()));
  return { finish: () => finish(), plugin, scene };
}

/** A late part of its own: a group with one box, its geometry's dispose
 *  counted, its builds counted. */
function boxPart(build: Promise<void> = Promise.resolve()) {
  const group = new Group();
  const box = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  group.add(box);
  const counts = { builds: 0, freed: 0 };
  box.geometry.addEventListener("dispose", () => {
    counts.freed += 1;
  });
  const part: LatePart<Group> = {
    kind: "murals",
    tile: "t",
    rank: 1,
    hangAt: "compile",
    build: async () => {
      await build;
      counts.builds += 1;
      return group;
    },
    objects: (g) => [g],
    bytes: (g) => estimateGeometryBytes(g),
    hang: () => nothing,
    free: (g) => disposeObject3D(g),
  };
  return { counts, group, part };
}

test("a tile that leaves while its content compiles gets nothing more built on it", async () => {
  const { finish, plugin, scene } = lateRootPlugin();
  // what is still to land waits its turn behind the gate
  const turn = gate();
  const fake = fakeHost(turn.opened);
  const late = createLateParts(fake.host);
  plugin.dressed.set(scene, { late });
  const tile = {};
  const loading = plugin.processTileModel(scene, tile);
  const { counts, part } = boxPart();
  const handle = late.add(part);
  // the renderer unloads the tile while its compile runs: its release
  // waits for that compile, the entry stays — and its parts are gone
  plugin.disposeTile(tile);
  expect(plugin.dressed.get(scene)?.late).toBe(late);
  turn.open();
  expect(await handle.settled).toBe("gone");
  expect(counts.builds).toBe(0);
  finish();
  await loading;
});

test("a tile weighs its late parts from their build, and its release frees them", async () => {
  const { finish, plugin, scene } = lateRootPlugin();
  const fake = fakeHost();
  const late = createLateParts(fake.host);
  plugin.dressed.set(scene, { late });
  const { counts, group, part } = boxPart();
  late.add(part);
  await flush();
  // built, compiling: weighed already
  expect(plugin.calculateBytesUsed({}, scene)).toBe(
    estimateGeometryBytes(group)
  );
  // the stream goes: the part is freed once its compile has ended
  plugin.dispose();
  expect(counts.freed).toBe(0);
  fake.compiles[0]?.end("done");
  await flush();
  expect(counts.freed).toBe(1);
  finish();
});

/** A plugin whose compiles resolve at once, and a content root with a mesh
 *  whose geometry reports its own dispose. */
function abortableLoad() {
  const plugin = new DressingPlugin(
    {
      dressingGate: new Promise<void>(() => {}),
      bootTile: () => null,
      compile: async () => {},
      onChange: () => {},
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
const nextTask = async () =>
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });

/** Waits until `ready` holds, a timer at a time (at most ~2 s). */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !ready(); i += 1) {
    await nextTask();
  }
}

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
  for (const queue of [phone.parseQueue, desktop.downloadQueue]) {
    expect(
      queue.priorityCallback?.(
        tileAt("terrain_a_l1.0.glb.gz"),
        tileAt("city_a.0.glb.gz")
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
    return () => {};
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
  const hung = dressing();
  const { asks } = hung;
  buildAsksWhenIdle(hung, () => true, { idle: later, run: runNow });
  expect(hung.asks).toEqual([]);
  idle.shift()?.();
  expect(hung.asks).toBe(asks);
  expect(hung.asks).toEqual([set]);
  // run once, and its features let go of
  expect(hung.buildAsks).toBeUndefined();
  const gone = dressing();
  buildAsksWhenIdle(gone, () => false, { idle: later, run: runNow });
  idle.shift()?.();
  expect(gone.asks).toEqual([]);
  // a dressing with nothing to build waits for nothing
  buildAsksWhenIdle({ tile: "t" }, () => true, { idle: later, run: runNow });
  expect(idle).toHaveLength(0);
  // a question before the idle time builds them at once, and only once
  const early = dressing();
  buildAsksWhenIdle(early, () => true, { idle: later, run: runNow });
  expect(asksOf(early)).toEqual([set]);
  expect(asksOf(early)).toEqual([set]);
  idle.shift()?.();
  expect(early.asks).toEqual([set]);
});

test("a question while the ask sets build in slices finishes them, once", async () => {
  const idle: (() => void)[] = [];
  const later = (work: () => void) => {
    idle.push(work);
    return () => {};
  };
  const set = {
    box: {},
    nearest: () => null,
  } as unknown as AskSet<FeatureInquiry>;
  const asks: AskSet<FeatureInquiry>[] = [];
  let steps = 0;
  function* build() {
    for (let i = 0; i < 3; i += 1) {
      steps += 1;
      yield;
    }
    asks.push(set);
  }
  const d: TileDressing = { tile: "t", asks, buildAsks: build() };
  // a slice is one step, and the next waits for `go`
  let go = nothing;
  const waitForGo = async () => {
    await new Promise<void>((resolve) => {
      go = resolve;
    });
  };
  const sliced = async (s: Steps<unknown>) => {
    for (let r = s.next(); !r.done; r = s.next()) {
      await waitForGo();
    }
  };
  buildAsksWhenIdle(d, () => true, { idle: later, run: sliced });
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

test("a dressing hangs on its tile, its traffic handed the tile; released, it comes down and is freed whole", async () => {
  const furniture = new Group();
  const box = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  furniture.add(box);
  let freed = false;
  box.geometry.addEventListener("dispose", () => {
    freed = true;
  });
  const { slot: traffic } = trafficTile();
  const dressing: TileDressing = { tile: "t", furniture, traffic };
  const { compiles, dressings, look, outcome, parts, root, slot } =
    await hungDressing(dressing);
  // compiled as one representative per build, under its kind and tile
  expect(compiles.map((c) => c.where)).toEqual(["dressing t"]);
  expect(compiles[0].objects).toEqual([box]);
  expect(outcome).toBe("hung");
  expect(furniture.parent).toBe(root);
  expect(slot.dressing).toBe(dressing);
  expect(dressings.has(dressing)).toBe(true);
  // the tile weighs its parts' geometry
  expect(parts.bytes()).toBe(estimateGeometryBytes(furniture));
  // its traffic has the tile: the layer switched on builds its bodies
  // there, a part of the same root
  look.set({ trafficLayer: true });
  await until(() => compiles.length > 1);
  expect(compiles.map((c) => c.where)).toEqual(["dressing t", "traffic t"]);
  expect(parts.release()).toEqual([]);
  expect(slot.dressing).toBeUndefined();
  expect(dressings.size).toBe(0);
  expect(furniture.parent).toBeNull();
  expect(freed).toBe(true);
  expect(parts.bytes()).toBe(0);
});

test("a dressing hung while its compile runs leaves the root at its release, freed once that compile ends", async () => {
  jest.useFakeTimers();
  try {
    const furniture = new Group();
    const box = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    furniture.add(box);
    let freed = 0;
    box.geometry.addEventListener("dispose", () => {
      freed += 1;
    });
    const dressing: TileDressing = { tile: "t", furniture };
    const fake = fakeHost();
    const parts = createLateParts(fake.host);
    const root = new Object3D();
    const handle = parts.add(
      dressingPart({
        tile: "t",
        level: "fine",
        root,
        slot: {},
        dressings: new Set(),
        parts,
        look: createLookState(),
        live: () => true,
        failed: nothing,
        freeFailed: nothing,
        build: async () => await Promise.resolve(dressing),
      })
    );
    fake.load();
    await flush();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    expect(await handle.settled).toBe("hung");
    expect(furniture.parent).toBe(root);
    // the tile goes as that compile ends (the plugin's last compile): the
    // root's release disposes what hangs on it, so the dressing is down
    fake.compiles[0].end("done");
    expect(parts.release()).toEqual([]);
    expect(furniture.parent).toBeNull();
    await flush();
    expect(freed).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a dressing taken down while its compile runs hears the scene no more", async () => {
  jest.useFakeTimers();
  try {
    let loads = 0;
    const { slot: traffic } = trafficTile({
      load: async () => {
        loads += 1;
        return await loaded();
      },
    });
    const heard: string[] = [];
    const dressing: TileDressing = {
      tile: "t",
      furniture: new Group(),
      traffic,
      unfollow: () => {
        heard.push("unfollow");
      },
    };
    const fake = fakeHost();
    const parts = createLateParts(fake.host);
    const look = createLookState();
    const handle = parts.add(
      dressingPart({
        tile: "t",
        level: "fine",
        root: new Object3D(),
        slot: {},
        dressings: new Set(),
        parts,
        look,
        live: () => true,
        failed: nothing,
        freeFailed: nothing,
        build: async () => await Promise.resolve(dressing),
      })
    );
    fake.load();
    await flush();
    jest.advanceTimersByTime(COMPILE_WAIT_MS);
    expect(await handle.settled).toBe("hung");
    // the tile goes; its free waits for the compile
    expect(handle.dispose()).toEqual([]);
    expect(heard).toEqual(["unfollow"]);
    // the traffic layer switched on builds nothing for it
    look.set({ trafficLayer: true });
    await flush();
    expect(loads).toBe(0);
    fake.compiles[0].end("done");
    await flush();
    expect(heard).toEqual(["unfollow"]);
  } finally {
    jest.useRealTimers();
  }
});

test("a dressing whose hang throws half-way is taken down whole and freed as a failure", async () => {
  const furniture = new Group();
  const traffic = {
    attach: () => {
      throw new Error("attach threw");
    },
    dispose: () => [],
  } as unknown as TrafficSlot;
  const dressing: TileDressing = { tile: "t", furniture, traffic };
  const { calls, dressings, outcome, root, slot } =
    await hungDressing(dressing);
  expect(outcome).toBe("failed");
  expect(calls.failed).toHaveLength(1);
  expect(slot.dressing).toBeUndefined();
  expect(dressings.size).toBe(0);
  expect(furniture.parent).toBeNull();
  expect(root.children).toHaveLength(0);
});

test("a dressing whose hang and take-down both throw fails with the hang's error, the take-down's reported as a free failure", async () => {
  const attachError = new Error("attach threw");
  const disposeErrors = [new Error("bodies"), new Error("slot")];
  const traffic = {
    attach: () => {
      throw attachError;
    },
    dispose: () => disposeErrors,
  } as unknown as TrafficSlot;
  const dressing: TileDressing = { tile: "t", furniture: new Group(), traffic };
  const freeFailed: unknown[][] = [];
  const { calls, outcome, root } = await hungDressing(dressing, {
    freeFailed: (errors) => {
      freeFailed.push(errors);
    },
  });
  expect(outcome).toBe("failed");
  expect(calls.failed).toEqual([[attachError, "t"]]);
  expect(freeFailed).toEqual([disposeErrors]);
  expect(root.children).toHaveLength(0);
});

test("a hung dressing's take-down reports every error its traffic's dispose threw", async () => {
  const disposeErrors = [new Error("bodies"), new Error("slot")];
  // a slot frees once: a second dispose throws nothing
  let thrown: Error[] = disposeErrors;
  const traffic = {
    attach: () => {},
    dispose: () => {
      const now = thrown;
      thrown = [];
      return now;
    },
  } as unknown as TrafficSlot;
  const dressing: TileDressing = { tile: "t", furniture: new Group(), traffic };
  const { handle, outcome } = await hungDressing(dressing);
  expect(outcome).toBe("hung");
  expect(handle.dispose()).toEqual(disposeErrors);
});

test("a coarse level's dressing builds ahead of a fine level's queued before it", async () => {
  const turn = gate();
  const { compiles, host } = fakeHost(turn.opened);
  const parts = createLateParts(host);
  const built: string[] = [];
  const site = (tile: string, level: "coarse" | "fine") =>
    dressingPart({
      tile,
      level,
      root: new Object3D(),
      slot: {},
      dressings: new Set(),
      parts,
      look: createLookState(),
      live: () => true,
      failed: nothing,
      freeFailed: nothing,
      build: async () => {
        built.push(tile);
        return await Promise.resolve({ tile });
      },
    });
  // the first takes the lane as the gate opens; the others queue behind it
  parts.add(site("first", "fine"));
  parts.add(site("fine", "fine"));
  parts.add(site("coarse", "coarse"));
  turn.open();
  await flush();
  for (const c of compiles) {
    c.end("done");
  }
  await flush();
  expect(built).toEqual(["first", "coarse", "fine"]);
});

test("a city tile's murals hang on their buildings once compiled, weigh on the tile, and leave with it", async () => {
  const group = new Group();
  const meshes = ["a", "b"].map(
    () => new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial())
  );
  group.add(...meshes);
  let disposed = 0;
  const layer: MuralLayer = {
    bytes: 2_700_000,
    dispose: () => {
      disposed += 1;
      group.removeFromParent();
    },
    group,
    meshes,
    murals: [{ building: "A" }, { building: "B" }] as unknown as Mural[],
  };
  const hung: [Object3D, string][] = [];
  const root = new Object3D();
  const fake = fakeHost();
  const parts = createLateParts(fake.host);
  const handle = parts.add(
    muralsPart({
      tile: "t",
      root,
      city: {
        hang: (object, building) => {
          hung.push([object, building]);
        },
      },
      murals: async () =>
        await Promise.resolve([{ building: "A" }] as unknown as Mural[]),
      build: async () => await Promise.resolve(layer),
    })
  );
  fake.load();
  await flush();
  // weighed from the build; not hung while its compile runs
  expect(parts.bytes()).toBe(layer.bytes);
  expect(fake.compiles.map((c) => c.where)).toEqual(["murals t"]);
  expect(group.parent).toBeNull();
  fake.compiles[0].end("done");
  expect(await handle.settled).toBe("hung");
  expect(group.parent).toBe(root);
  expect(hung).toEqual([
    [meshes[0], "A"],
    [meshes[1], "B"],
  ]);
  expect(parts.release()).toEqual([]);
  expect(disposed).toBe(1);
  expect(group.parent).toBeNull();
  expect(parts.bytes()).toBe(0);
});

test("a city tile with no murals builds none", async () => {
  let built = 0;
  const fake = fakeHost();
  const parts = createLateParts(fake.host);
  const handle = parts.add(
    muralsPart({
      tile: "t",
      root: new Object3D(),
      city: { hang: nothing },
      murals: async () => await Promise.resolve([]),
      build: async () => {
        built += 1;
        return await Promise.resolve(null);
      },
    })
  );
  expect(await handle.settled).toBe("nothing");
  expect(built).toBe(0);
  expect(fake.compiles).toHaveLength(0);
});

test("a dressing whose tile leaves before its idle time never builds its ask sets", async () => {
  // the idle callback whenIdle (main-yield.ts) asks the browser for
  const idle: (() => void)[] = [];
  const host = globalThis as { requestIdleCallback?: unknown };
  const had = "requestIdleCallback" in host;
  const saved = host.requestIdleCallback;
  host.requestIdleCallback = (work: () => void) => idle.push(work);
  try {
    let built = 0;
    const dressing: TileDressing = {
      tile: "t",
      asks: [],
      buildAsks: (function* builtOnce() {
        built += 1;
        yield;
      })(),
      furniture: new Group(),
    };
    const { parts } = await hungDressing(dressing);
    expect(idle).toHaveLength(1);
    // the renderer unloads the tile before the page is idle
    parts.release();
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
const loaded = async () => builder;

/** A tile's counted traffic as a slot: one two-way street, its dressing's
 *  ask list, and the tile's late parts over a host whose compiles the test
 *  ends (shared between tiles: one lane). */
function trafficTile(
  opts: {
    detail?: "coarse" | "fine";
    fake?: ReturnType<typeof fakeHost>;
    load?: () => Promise<TrafficBuilder | null>;
    tile?: string;
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
  const tile = opts.tile ?? "t";
  const asks: AskSet<FeatureInquiry>[] = [];
  const slot = trafficSlot({
    load: opts.load ?? loaded,
    features: [street],
    bridges: [],
    ground: { offset: { cx: 0, cy: 0 }, heightAt: () => 110 },
    detail: opts.detail ?? "fine",
    tile,
    asks,
  });
  const fake = opts.fake ?? fakeHost();
  fake.load();
  const parts = createLateParts(fake.host);
  const root = new Object3D();
  // the look store: the layer off
  const look = createLookState();
  const compiled = () =>
    fake.compiles.filter((c) => c.where === `traffic ${tile}`);
  return {
    asks,
    attach: (owner?: LateHandle) => {
      slot.attach({
        look,
        parts,
        owner: owner ?? parts.add(ownerPart()),
        root,
      });
    },
    calls: fake.calls,
    compiled,
    /** ends the bodies' compile */
    finish: (outcome: Compiled = "done") => compiled()[0]?.end(outcome),
    look,
    parts,
    root,
    slot,
  };
}

/** The dressing that owns the bodies: built, its compile never ending
 *  here (it stays, neither hung nor given up). */
function ownerPart(): LatePart<Group> {
  return {
    kind: "dressing",
    tile: "owner",
    rank: null,
    hangAt: "compile",
    build: async () => await Promise.resolve(new Group()),
    objects: () => [],
    bytes: () => 0,
    hang: () => nothing,
    free: () => [],
  };
}

test("the counted traffic costs nothing while the layer is off", async () => {
  const { asks, attach, compiled, parts, slot } = trafficTile();
  const d: TileDressing = { tile: "t", traffic: slot };
  // hung with the layer off
  attach();
  await nextTask();
  expect(slot.group).toBeNull();
  expect(dressingParts(d)).toEqual([]);
  expect(compiled()).toHaveLength(0);
  expect(asks).toHaveLength(0);
  expect(parts.bytes()).toBe(0);
});

test("the first switch-on builds and compiles the bodies once, hangs them once compiled; off keeps them, the release frees them", async () => {
  const { asks, attach, compiled, finish, look, parts, root, slot } =
    trafficTile();
  const d: TileDressing = { tile: "t", traffic: slot };
  // switched on before the dressing hangs: nothing to hang it on yet
  look.set({ trafficLayer: true });
  await nextTask();
  expect(slot.group).toBeNull();
  // the hang builds them, as the look has the layer on
  attach();
  const first = slot.show();
  const second = slot.show();
  // the build is sliced into turns: on a loaded runner (coverage, parallel
  // files) it can outlast one short timer
  await until(() => compiled().length > 0);
  await nextTask();
  // compiled once, weighed from the build, hung only once compiled
  expect(compiled()).toHaveLength(1);
  expect(parts.bytes()).toBeGreaterThan(0);
  expect(slot.group).toBeNull();
  expect(root.children).toHaveLength(0);
  expect(asks).toHaveLength(0);
  finish();
  await Promise.all([first, second]);
  expect(compiled()).toHaveLength(1);
  expect(slot.group?.visible).toBe(true);
  const hung = slot.group;
  if (!hung) {
    throw new Error("the traffic group was not built");
  }
  expect(hung.parent).toBe(root);
  expect(parts.bytes()).toBe(estimateGeometryBytes(hung));
  expect(dressingParts(d)).toEqual([hung]);
  // the probe asks its sections now
  expect(asks).toHaveLength(1);
  expect(slot.asks()).toBe(asks[0]);
  // off: hidden, kept; on again: no second build
  look.set({ trafficLayer: false });
  expect(hung.visible).toBe(false);
  look.set({ trafficLayer: true });
  await slot.show();
  expect(slot.group).toBe(hung);
  expect(hung.visible).toBe(true);
  expect(compiled()).toHaveLength(1);
  // the tile's release frees them
  let freed = false;
  const mesh = hung.children[0] as Mesh | undefined;
  mesh?.geometry.addEventListener("dispose", () => {
    freed = true;
  });
  expect(slot.dispose()).toEqual([]);
  expect(freed).toBe(true);
  expect(slot.group).toBeNull();
  expect(hung.parent).toBeNull();
  expect(parts.bytes()).toBe(0);
  // ...and it hears the look no more: a switch-on builds nothing
  look.set({ trafficLayer: false });
  look.set({ trafficLayer: true });
  await nextTask();
  expect(compiled()).toHaveLength(1);
  expect(slot.group).toBeNull();
});

test("a tile released while its traffic compiles gets nothing shown, asked or weighed", async () => {
  const { asks, attach, compiled, finish, parts, slot } = trafficTile();
  attach();
  const showing = slot.show();
  await until(() => compiled().length > 0);
  // the renderer unloads the tile while the compile runs
  parts.leave();
  finish();
  await showing;
  expect(slot.group).toBeNull();
  expect(asks).toHaveLength(0);
  expect(parts.bytes()).toBe(0);
});

test("bodies freed while their compile runs are freed once it ends", async () => {
  const { attach, calls, compiled, finish, parts, slot } = trafficTile();
  attach();
  const showing = slot.show();
  await until(() => compiled().length > 0);
  const [{ objects }] = compiled();
  const mesh = objects[0] as Mesh;
  let freed = false;
  mesh.geometry.addEventListener("dispose", () => {
    freed = true;
  });
  // the dressing comes down (its own compile ran out of memory) while the
  // traffic's compile still runs: freed only after
  expect(slot.dispose()).toEqual([]);
  expect(slot.group).toBeNull();
  expect(parts.bytes()).toBe(0);
  await nextTask();
  expect(freed).toBe(false);
  finish();
  await showing;
  await nextTask();
  expect(freed).toBe(true);
  expect(calls.freeFailed).toEqual([]);
});

test("a switch-on builds the tiles' bodies one after another", async () => {
  // one lane for both tiles, as the plugin's
  const fake = fakeHost();
  const a = trafficTile({ fake, tile: "a" });
  const b = trafficTile({ fake, tile: "b" });
  a.attach();
  b.attach();
  const showing = [a.slot.show(), b.slot.show()];
  await until(() => a.compiled().length > 0);
  await nextTask();
  await nextTask();
  // the first tile's turn holds the lane while its compile runs (kept by
  // plan 083, finding 4)
  expect(a.compiled()).toHaveLength(1);
  expect(b.compiled()).toHaveLength(0);
  a.finish();
  await until(() => b.compiled().length > 0);
  expect(b.compiled()).toHaveLength(1);
  b.finish();
  await Promise.all(showing);
  expect(a.slot.group?.visible).toBe(true);
  expect(b.slot.group?.visible).toBe(true);
});

test("a coarse level's bodies build ahead of a fine level's dressing queued before them", async () => {
  const turn = gate();
  const fake = fakeHost(turn.opened);
  const coarse = trafficTile({ detail: "coarse", fake, tile: "c" });
  const built: string[] = [];
  const dressing = (tile: string) =>
    dressingPart({
      tile,
      level: "fine",
      root: new Object3D(),
      slot: {},
      dressings: new Set(),
      parts: coarse.parts,
      look: coarse.look,
      live: () => true,
      failed: nothing,
      freeFailed: nothing,
      build: async () => {
        built.push(tile);
        return await Promise.resolve({ tile });
      },
    });
  // the first fine dressing takes the lane as the gate opens; the second
  // and the coarse bodies queue behind it
  coarse.parts.add(dressing("first"));
  coarse.parts.add(dressing("fine"));
  coarse.attach();
  const showing = coarse.slot.show();
  await nextTask();
  turn.open();
  await until(() => coarse.compiled().length > 0);
  expect(built).toEqual(["first"]);
  coarse.finish();
  await showing;
  await until(() => built.length > 1);
  expect(built).toEqual(["first", "fine"]);
});

test("a dressing freed before its traffic's turn builds nothing", async () => {
  const { attach, compiled, slot } = trafficTile();
  attach();
  const showing = slot.show();
  slot.dispose();
  await showing;
  expect(slot.group).toBeNull();
  expect(compiled()).toHaveLength(0);
});

test("the bodies go when the dressing that owns them goes", async () => {
  const { attach, compiled, finish, parts, root, slot } = trafficTile();
  const owner = parts.add(ownerPart());
  attach(owner);
  const showing = slot.show();
  await until(() => compiled().length > 0);
  finish();
  await showing;
  expect(slot.group?.parent).toBe(root);
  owner.dispose();
  expect(slot.group).toBeNull();
  expect(root.children).toHaveLength(0);
});

/** The builder on its way (the data layers starting): it arrives when the
 *  test says. */
function builderOnItsWay() {
  let arrive = nothing;
  const coming = new Promise<TrafficBuilder>((resolve) => {
    arrive = () => resolve(builder);
  });
  return { arrive: () => arrive(), load: async () => await coming };
}

test("tiles hung before the builder arrives get their bodies when it does, and later tiles too", async () => {
  const { arrive, load } = builderOnItsWay();
  const early = trafficTile({ load });
  early.attach();
  const showing = early.slot.show();
  await nextTask();
  // nothing built while the builder is on its way
  expect(early.compiled()).toHaveLength(0);
  expect(early.slot.group).toBeNull();
  arrive();
  await until(() => early.compiled().length > 0);
  early.finish();
  await showing;
  expect(early.slot.group?.visible).toBe(true);
  // a tile that lands once it has come builds at once
  const late = trafficTile({ load });
  late.attach();
  const lateShowing = late.slot.show();
  await until(() => late.compiled().length > 0);
  late.finish();
  await lateShowing;
  expect(late.slot.group?.visible).toBe(true);
});

test("a builder that did not come builds nothing and is asked for on the next switch-on", async () => {
  let fails = true;
  // (a builder that did not come is no failed build of this tile, and
  // must not be reported as one)
  const { attach, calls, compiled, finish, slot } = trafficTile({
    load: async () =>
      fails ? await Promise.reject(new Error("start")) : await loaded(),
  });
  attach();
  await slot.show();
  expect(compiled()).toHaveLength(0);
  expect(slot.group).toBeNull();
  fails = false;
  const again = slot.show();
  await until(() => compiled().length > 0);
  finish();
  await again;
  expect(slot.group?.visible).toBe(true);
  expect(calls.failed).toEqual([]);
});

test("a layer switched off while its builder comes builds nothing until it is on again", async () => {
  const { arrive, load } = builderOnItsWay();
  const { attach, compiled, finish, slot } = trafficTile({ load });
  attach();
  const showing = slot.show();
  slot.hide();
  arrive();
  await showing;
  expect(compiled()).toHaveLength(0);
  expect(slot.group).toBeNull();
  const again = slot.show();
  await until(() => compiled().length > 0);
  finish();
  await again;
  expect(slot.group?.visible).toBe(true);
});

test("bodies whose compile ran out of memory are shown, asked and built never again", async () => {
  const { asks, attach, compiled, finish, parts, slot } = trafficTile();
  attach();
  const showing = slot.show();
  await until(() => compiled().length > 0);
  finish("out of memory");
  await showing;
  expect(asks).toHaveLength(0);
  expect(slot.group).toBeNull();
  expect(parts.bytes()).toBe(0);
  // the layer stays off on this tile
  await slot.show();
  await nextTask();
  expect(compiled()).toHaveLength(1);
});

test("a traffic build that throws is reported once, and not once its tile has gone", async () => {
  for (const leaves of [false, true]) {
    const thrown = new TypeError("bad section");
    const tile = trafficTile({
      load: async () =>
        await Promise.resolve({
          ...builder,
          build: () => {
            // the renderer unloads the tile while it builds
            if (leaves) {
              tile.parts.leave();
            }
            throw thrown;
          },
        }),
    });
    tile.attach();
    await tile.slot.show();
    expect(tile.calls.failed).toEqual(leaves ? [] : [[thrown, "t"]]);
  }
});

test("a traffic build that threw is tried again on the next switch-on, not on other look changes, and never once its dressing is taken down", async () => {
  let throws = true;
  let builds = 0;
  const tile = trafficTile({
    load: async () =>
      await Promise.resolve({
        ...builder,
        build: (...args: Parameters<TrafficBuilder["build"]>) => {
          builds += 1;
          if (throws) {
            throw new TypeError("bad section");
          }
          return builder.build(...args);
        },
      }),
  });
  tile.attach();
  tile.look.set({ trafficLayer: true });
  await until(() => tile.calls.failed.length > 0);
  await nextTask();
  expect(tile.slot.group).toBeNull();
  // a look change that leaves the layer on builds (and reports) nothing
  tile.look.set({ fogAmount: 0.9 });
  tile.look.set({ multiTuft: false });
  await nextTask();
  await nextTask();
  expect(builds).toBe(1);
  expect(tile.calls.failed).toHaveLength(1);
  // off and on again: built anew, and this time it hangs
  throws = false;
  tile.look.set({ trafficLayer: false });
  tile.look.set({ trafficLayer: true });
  await until(() => tile.compiled().length > 0);
  tile.finish();
  await tile.slot.show();
  expect(builds).toBe(2);
  expect(tile.slot.group?.parent).toBe(tile.root);
  // taken down with its dressing: no switch-on builds it again
  tile.slot.dispose();
  tile.look.set({ trafficLayer: false });
  tile.look.set({ trafficLayer: true });
  await nextTask();
  expect(builds).toBe(2);
});

test("an ask builder that throws in idle time is reported and lets the tile go", async () => {
  const idle: (() => void)[] = [];
  const later = (work: () => void) => {
    idle.push(work);
    return () => {};
  };
  const d: TileDressing = { tile: "t", asks: [], buildAsks: broken() };
  const failures: unknown[] = [];
  buildAsksWhenIdle(d, () => true, {
    idle: later,
    run: async (steps) => await Promise.resolve().then(() => finished(steps)),
    failed: (err) => {
      failures.push(err);
    },
  });
  idle.shift()?.();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(failures).toHaveLength(1);
  expect(d.buildAsks).toBeUndefined();
  expect(asksOf(d)).toEqual([]);
});
