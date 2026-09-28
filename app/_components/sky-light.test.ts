import { expect, test } from "bun:test";
import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  type Node,
  TextureNode,
  type Vector2,
  Vector3,
} from "three/webgpu";
import { float, uniform } from "three/tsl";
import { dressFences } from "./fence-layer";
import { slotsOf } from "./material-slots";
import { dressKerbs } from "./kerb-layer";
import {
  applyGroundLight,
  createClaySky,
  type GroundLight,
  groundLitMaterial,
  openSkyTexture,
} from "./sky-light";
import { dressStairs } from "./stair-layer";
import { dressWalls } from "./wall-layer";

function groundLight(parts: { horizon: boolean; svf: boolean }): GroundLight {
  return {
    svf: parts.svf ? new DataTexture() : undefined,
    horizon: parts.horizon ? new DataArrayTexture() : undefined,
    origin: [10, 20],
    size: [1000, 1000],
    skyView: uniform(1),
    horizonShade: uniform(1),
    shadowReach: uniform(new Vector3()),
    sunDirection: uniform(new Vector3(0, 1, 0)),
  };
}

/** Every node reachable from `root` through its inputs. */
function reachable(root: Node): Set<Node> {
  const seen = new Set<Node>();
  root.traverse((n: Node) => {
    seen.add(n);
  });
  return seen;
}

function texturesOf(root: Node): unknown[] {
  return [...reachable(root)]
    .filter((n): n is TextureNode => (n as TextureNode).isTextureNode === true)
    .map((n) => n.value);
}

/** The node three's ShadowNode would get back for a shadow term. */
function received(material: MeshStandardNodeMaterial, shadow: Node): Node {
  const fn = material.receivedShadowNode as ((s: Node) => Node) | null;
  if (!fn) {
    throw new Error("no receivedShadowNode");
  }
  return fn(shadow);
}

test("the sky view scales the ambient through aoNode, by the shared row", () => {
  const light = groundLight({ horizon: false, svf: true });
  const material = groundLitMaterial({ roughness: 1 }, light, true);
  expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(material.aoNode).not.toBeNull();
  const ao = reachable(material.aoNode as Node);
  // the row by reference: the slider reaches it without a rebuild
  expect(ao.has(light.skyView)).toBe(true);
  // the tile's raster goes in by slot, not into the shared graph
  expect(texturesOf(material.aoNode as Node)).not.toContain(light.svf);
  expect(slotsOf(material).lightSvf).toBe(light.svf);
  // no horizon, no change to the sun's shadow
  expect(material.receivedShadowNode).toBeNull();
});

test("tiles of one variant share the light's nodes, each with its own slots", () => {
  const light = groundLight({ horizon: true, svf: true });
  const other: GroundLight = {
    ...light,
    svf: new DataTexture(),
    horizon: new DataArrayTexture(),
    origin: [1010, 20],
  };
  const a = new MeshStandardNodeMaterial();
  const b = new MeshStandardNodeMaterial();
  applyGroundLight(a, light);
  applyGroundLight(b, other);
  // one graph, one shader build for both tiles
  expect(a.aoNode).toBe(b.aoNode);
  expect(a.receivedShadowNode).toBe(b.receivedShadowNode);
  expect(slotsOf(a).lightSvf).toBe(light.svf);
  expect(slotsOf(b).lightSvf).toBe(other.svf);
  expect(slotsOf(b).lightHorizon).toBe(other.horizon);
  expect((slotsOf(b).lightOrigin as Vector2).x).toBe(1010);
  // a tile without the far horizon is another variant
  const c = new MeshStandardNodeMaterial();
  applyGroundLight(c, { ...light, horizon: undefined });
  expect(c.aoNode).not.toBe(a.aoNode);
});

test("the far horizon joins the sun's shadow by min, never a product", () => {
  const light = groundLight({ horizon: true, svf: false });
  const material = new MeshStandardNodeMaterial();
  applyGroundLight(material, light);
  const shadow = float(0.5);
  type Math = Node & { aNode?: Node; method?: string; node?: Math };
  const result = received(material, shadow) as Math;
  // three wraps a math node in a variable
  const out = result.node ?? result;
  expect(out.method).toBe("min");
  expect(out.aNode).toBe(shadow);
  // the horizon row by reference
  expect(reachable(out).has(light.horizonShade)).toBe(true);
  expect(material.aoNode).toBeNull();
});

test("a wall takes the far shadow without the ground's sky view", () => {
  const light = groundLight({ horizon: true, svf: true });
  const wall = new Mesh();
  dressWalls(wall, light);
  const material = wall.material as MeshStandardNodeMaterial;
  expect(material.aoNode).toBeNull();
  expect(material.receivedShadowNode).not.toBeNull();
  expect(wall.castShadow).toBe(true);
});

test("kerbs, stairs and fences take both terms", () => {
  const light = groundLight({ horizon: true, svf: true });
  for (const dress of [dressKerbs, dressStairs, dressFences]) {
    const mesh = new Mesh();
    dress(mesh, light);
    const material = mesh.material as MeshStandardNodeMaterial;
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(material.aoNode).not.toBeNull();
    expect(material.receivedShadowNode).not.toBeNull();
  }
});

test("a fence is one lit band: tone, ground normal and self-light in node slots", () => {
  const mesh = new Mesh();
  dressFences(mesh);
  const material = mesh.material as MeshStandardNodeMaterial;
  expect(material.colorNode).not.toBeNull();
  expect(material.normalNode).not.toBeNull();
  expect(material.emissiveNode).not.toBeNull();
  // it receives shadows but casts none
  expect(mesh.castShadow).toBe(false);
  expect(mesh.receiveShadow).toBe(true);
});

test("a tile without the rasters leaves the material as it was", () => {
  const material = new MeshStandardNodeMaterial();
  applyGroundLight(material, undefined);
  applyGroundLight(material, groundLight({ horizon: false, svf: false }));
  // a sky view only, where the caller wants none
  applyGroundLight(material, groundLight({ horizon: false, svf: true }), false);
  expect(material.aoNode).toBeNull();
  expect(material.receivedShadowNode).toBeNull();
});

test("the clay's sky view swaps its raster in without a new node", () => {
  const sky = createClaySky();
  const ao = sky.ao(float(2), float(9), float(1));
  const [tex] = texturesOf(ao);
  expect(tex).toBe(openSkyTexture());
  const raster = new DataTexture();
  sky.set(raster, [100, 200], [1000, 1000]);
  expect(texturesOf(ao)).toContain(raster);
});

test("the open-sky texel samples as the rasters that replace it (LINEAR)", () => {
  const tex = openSkyTexture();
  expect(tex.magFilter).toBe(LinearFilter);
  expect(tex.minFilter).toBe(LinearFilter);
});
