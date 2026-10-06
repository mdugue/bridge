import { expect, test } from "bun:test";
import {
  BufferAttribute,
  DataTexture,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  MeshStandardNodeMaterial,
  RedFormat,
  RGBAFormat,
  Vector3,
} from "three/webgpu";
import { uniform } from "three/tsl";
import {
  createGridShare,
  createTerrainMaterial,
  type GroundUniforms,
  readsSportGrounds,
  type SplatLayer,
  splatUv,
} from "./terrain-layer";
import { isSceneShared } from "./three-utils";

const ground = (): GroundUniforms => ({
  groundDetail: uniform(1),
  meadowNdvi: uniform(1),
  urbanGreen: uniform(1),
  skyView: uniform(1),
  horizonShade: uniform(1),
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

test("a phone's coarse level reads no sports grounds, and builds as every tile without them", () => {
  expect(readsSportGrounds(1, true)).toBe(false);
  // the fine level keeps them, and a desktop's coarse level too
  expect(readsSportGrounds(0, true)).toBe(true);
  expect(readsSportGrounds(1, false)).toBe(true);
  const look = ground();
  const sport = { raster: raster(RGBAFormat), table: raster(RGBAFormat) };
  const bare = createTerrainMaterial(splat({ ground: look }));
  const lean = createTerrainMaterial(splat({ ground: look }));
  const pitched = createTerrainMaterial(splat({ ground: look, sport }));
  // one shared graph for the variant: a tile that lands builds no shader
  expect(lean.colorNode).toBe(bare.colorNode);
  expect(pitched.colorNode).not.toBe(bare.colorNode);
});

test("the splat uv is a node over the tile's corner uniform", () => {
  const uv = splatUv(splat());
  expect(uv.isNode).toBe(true);
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
  plan.forEach(([x, z], i) => array.set([x + shift, 10 + lift, z, 0], 4 * i));
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
