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

test("the splat uv is a node over the tile's corner uniform", () => {
  const uv = splatUv(splat());
  expect(uv.isNode).toBe(true);
});
