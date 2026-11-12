import { afterEach, expect, test } from "bun:test";
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DataTexture,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  RedFormat,
  RGBAFormat,
  Vector3,
} from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { uniform } from "three/tsl";
import type { TerrainExtras } from "@/lib/city/tileset";
import {
  createGridShare,
  createTerrainMaterial,
  dressTerrain,
  groundDetailOf,
} from "./terrain-layer";
import type { GroundUniforms, SplatLayer } from "./terrain-layer";
import { isSceneShared } from "./three-utils";
import { createTileRasters } from "./tile-rasters";
import type { RasterHold } from "./tile-rasters";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ground = (): GroundUniforms => ({
  shadowReach: uniform(new Vector3()),
  sunDirection: uniform(new Vector3(0, 1, 0)),
});

const raster = (format: typeof RedFormat | typeof RGBAFormat) =>
  new DataTexture(new Uint8Array(format === RedFormat ? 4 : 16), 2, 2, format);

const splat = (extra: Partial<SplatLayer> = {}): SplatLayer => ({
  bounds: [1000, 2000, 2000, 3000],
  colorTexture: raster(RGBAFormat),
  ground: ground(),
  offset: { cx: 1500, cy: 2500 },
  texture: raster(RedFormat),
  ...extra,
});

/** What a dressing came to: "dressed", or the name of the error it ended in. */
async function outcomeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "dressed";
  } catch (error) {
    return (error as Error).name;
  }
}

test("the terrain is one standard node material with colour and normal nodes", () => {
  for (const material of [
    createTerrainMaterial(),
    createTerrainMaterial(splat()),
  ]) {
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(material.colorNode).not.toBeNull();
    expect(material.normalNode).not.toBeNull();
    expect(material.roughness).toBe(1);
    // fogged by the scene's fog node, like everything else
    expect(material.fog).toBe(true);
  }
});

test("the baked light folds in only where the tile has its rasters", () => {
  expect(createTerrainMaterial(splat()).aoNode).toBeNull();
  const lit = createTerrainMaterial(splat({ svfTexture: raster(RedFormat) }));
  expect(lit.aoNode).not.toBeNull();
});

test("a level without the sports grounds builds as every tile without them", () => {
  const look = ground();
  const sport = { raster: raster(RGBAFormat), table: raster(RGBAFormat) };
  const bare = createTerrainMaterial(splat({ ground: look }));
  const lean = createTerrainMaterial(splat({ ground: look }));
  const pitched = createTerrainMaterial(splat({ ground: look, sport }));
  // one shared graph for the variant: a tile that lands builds no shader
  expect(lean.colorNode).toBe(bare.colorNode);
  expect(pitched.colorNode).not.toBe(bare.colorNode);
});

/** A quantised Y-up grid tile's positions (interleaved, four numbers a
 *  vertex as the glTF has them) and its index: two triangles of a quad, then
 *  a skirt triangle with no area in plan. */
function gridTile(lift: number, shift = 0) {
  const plan = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  const array = new Int16Array(5 * 4);
  for (const [i, [x, z]] of plan.entries()) {
    array.set([x + shift, 10 + lift, z, 0], 4 * i);
  }
  // the skirt's foot under vertex 0
  array.set([shift, -20 + lift, 0, 0], 16);
  const position = new InterleavedBufferAttribute(
    new InterleavedBuffer(array, 4),
    3,
    0,
    true
  );
  const index = new BufferAttribute(
    Uint32Array.from([0, 1, 2, 0, 2, 3, 0, 4, 1]),
    1
  );
  return { index, position };
}

test("the coarse tiles draw with one index and one water index for the site", () => {
  const grids = createGridShare();
  const first = gridTile(0);
  const second = gridTile(7);
  const site = grids.index(2, first.index);
  // the first tile's index is the site's, a later equal one is swapped for it
  expect(site).toBe(first.index);
  expect(grids.index(2, second.index)).toBe(site);
  expect(isSceneShared(site)).toBe(true);
  // its water: the surface's triangles, not the skirt's, shared where the
  // plan agrees whatever the heights
  const water = grids.water(2, site, first.position);
  expect(Array.from(water.array)).toEqual([0, 1, 2, 0, 2, 3]);
  expect(grids.water(2, site, second.position)).toBe(water);
  expect(isSceneShared(water)).toBe(true);
  // a tile whose plan or whose index differs keeps its own
  const moved = grids.water(2, site, gridTile(0, 3).position);
  expect(moved).not.toBe(water);
  expect(isSceneShared(moved)).toBe(false);
  const other = gridTile(0);
  other.index.array.set([0, 2, 1], 0);
  const own = grids.index(2, other.index);
  expect(own).toBe(other.index);
  expect(grids.water(2, own, other.position)).not.toBe(water);
  // another grid size is another site-wide index
  expect(grids.index(3, gridTile(0).index)).not.toBe(site);
});

test("a level whose tile leaves while it waits for its rasters lets go at once: their loads stop", async () => {
  const signals: AbortSignal[] = [];
  // a class raster that never answers, until its load is aborted
  // reason: the loader reads only `ok` and the body of a Response
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.signal) {
      signals.push(init.signal);
    }
    return await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("gone", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
  const rasters = createTileRasters({
    url: (file) => file,
    lowRasters: false,
    onShareChange: () => {},
    renderer: {} as WebGPURenderer,
  });
  const aborter = new AbortController();
  const outcome = outcomeOf(
    dressTerrain(
      new Mesh(new BoxGeometry(), new MeshStandardNodeMaterial()),
      {
        kind: "terrain",
        bounds: [0, 0, 100, 100],
        n: 2,
        level: 1,
        landcover: "landcover.png",
        landcoverLow: "landcover-low.png",
        minElevation: 0,
        tileId: "t",
      } as unknown as TerrainExtras,
      new Matrix4(),
      {
        fogColor: uniform(new Color()),
        ground: ground(),
        offset: { cx: 0, cy: 0 },
        rasters: rasters.holder({}),
        signal: aborter.signal,
      }
    )
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(signals.map((signal) => signal.aborted)).toEqual([false]);
  aborter.abort();
  expect(await outcome).toBe("AbortError");
  // its hold is gone already: the last holder gone, the load stops
  expect(signals.map((signal) => signal.aborted)).toEqual([true]);
});

/** A hold that hands out one raster per kind and set, and notes the drops. */
function reachHold(kinds: string[], missingFar: string[] = []) {
  const dropped: unknown[] = [];
  const asked: { far: boolean; kind: string; now: boolean }[] = [];
  const hold: RasterHold = {
    acquire: (async (
      kind: string,
      _extras: unknown,
      _signal?: AbortSignal,
      how?: { far?: boolean; now?: boolean }
    ) => {
      asked.push({ kind, far: how?.far === true, now: how?.now === true });
      if (!kinds.includes(kind) || (how?.far && missingFar.includes(kind))) {
        return await Promise.resolve(null);
      }
      return kind === "sport" || kind === "markings"
        ? { raster: raster(RGBAFormat), table: raster(RGBAFormat) }
        : raster(RGBAFormat);
    }) as RasterHold["acquire"],
    drop: (value) => {
      dropped.push(value);
    },
    release: () => {},
    settle: () => {},
  };
  return { asked, dropped, hold };
}

const twinExtras = {
  kind: "terrain",
  level: 0,
  surface: "p.png",
  surfaceFar: "p-far.png",
} as unknown as TerrainExtras;

const detailBox = { min: [0, 0, 0], max: [1, 1, 1] } as const;

test("a level's detail swaps its close-range rasters through the slots and drops the old set", async () => {
  const layer = splat({
    surfaceTexture: raster(RGBAFormat),
    markings: { raster: raster(RGBAFormat), table: raster(RGBAFormat) },
  });
  const near = { surface: layer.surfaceTexture, markings: layer.markings };
  const mesh = new Mesh(new BoxGeometry(), createTerrainMaterial(layer));
  const lightSlots = Object.keys(mesh.material.userData.slots as object);
  const { asked, dropped, hold } = reachHold(["surface", "markings"]);
  const detail = groundDetailOf({
    box: detailBox,
    extras: twinExtras,
    far: false,
    hold,
    mesh,
    signal: new AbortController().signal,
    splat: layer,
  });
  if (!detail) {
    throw new Error("the level has twins");
  }
  expect(detail.far()).toBe(false);
  // asked for what it reads already: nothing to do
  expect(await detail.setFar(false)).toBe(false);
  expect(await detail.setFar(true)).toBe(true);
  expect(detail.far()).toBe(true);
  expect(asked.every((a) => a.far && a.now)).toBe(true);
  const slots = mesh.material.userData.slots as Record<string, unknown>;
  expect(slots.surface).toBe(layer.surfaceTexture);
  expect(slots.surface).not.toBe(near.surface);
  expect(slots.markingsRaster).toBe(layer.markings?.raster);
  // the kinds the variant was built without stay out of it
  expect(slots.edges).toBeUndefined();
  expect(layer.edgesTexture).toBeUndefined();
  // every other slot (the baked light's among them) is still there
  expect(Object.keys(slots).sort()).toEqual(lightSlots.sort());
  expect(dropped).toContain(near.surface);
  expect(dropped).toContain(near.markings);
});

test("a twin missing beside a raster the level reads: no swap, what was loaded is let go", async () => {
  const layer = splat({ surfaceTexture: raster(RGBAFormat) });
  const before = layer.surfaceTexture;
  const mesh = new Mesh(new BoxGeometry(), createTerrainMaterial(layer));
  const { dropped, hold } = reachHold(["surface"], ["surface"]);
  const detail = groundDetailOf({
    box: detailBox,
    extras: twinExtras,
    far: false,
    hold,
    mesh,
    signal: new AbortController().signal,
    splat: layer,
  });
  expect(await detail?.setFar(true)).toBe(false);
  expect(detail?.far()).toBe(false);
  expect(layer.surfaceTexture).toBe(before);
  expect(dropped).not.toContain(before);
  // a level without twins, or without a splat, has no detail to swap
  expect(
    groundDetailOf({
      box: detailBox,
      extras: { kind: "terrain", level: 1 } as unknown as TerrainExtras,
      far: false,
      hold,
      mesh,
      signal: new AbortController().signal,
      splat: layer,
    })
  ).toBeUndefined();
});
