import { expect, test } from "bun:test";
import {
  DataTexture,
  MeshStandardNodeMaterial,
  RedFormat,
  RGBAFormat,
  Vector3,
} from "three/webgpu";
import { uniform } from "three/tsl";
import {
  createTerrainMaterial,
  type GroundUniforms,
  readsSportGrounds,
  type SplatLayer,
  splatUv,
} from "./terrain-layer";

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
