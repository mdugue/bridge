import { expect, test } from "bun:test";
import {
  DataTexture,
  DoubleSide,
  FrontSide,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { uniform } from "three/tsl";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { graphOf, slotsOf } from "./material-slots";
import { openSkyTexture } from "./sky-light";
import {
  applyCityLook,
  createClayMaterial,
  createStyleResources,
  setClaySection,
  setClaySkyView,
} from "./visual-style";

// The clay's side is part of the built node graph, so these tests watch
// `material.version` (the counter that `needsUpdate` increments) to pin down
// exactly when a rebuild is forced.

const objects = () => ({ rows: 1, texture: new DataTexture() });
const resourcesAt = () => createStyleResources(uniform(0), uniform(1));

test("the Schnitt draws the clay from both sides and back, one rebuild each way", () => {
  const resources = resourcesAt();
  const clay = createClayMaterial(resources, objects());
  const before = clay.version;
  expect(clay.side).toBe(FrontSide);

  setClaySection(resources, true);
  expect(clay.side).toBe(DoubleSide);
  expect(graphOf(clay)).toBe("clay|double");
  expect(clay.version).toBe(before + 1);
  // a tile that lands while the Schnitt shows is born two-sided
  expect(createClayMaterial(resources, objects()).side).toBe(DoubleSide);

  setClaySection(resources, true);
  expect(clay.version).toBe(before + 1);

  setClaySection(resources, false);
  expect(clay.side).toBe(FrontSide);
  expect(graphOf(clay)).toBe("clay");
  expect(clay.version).toBe(before + 2);
});

test("a disposed tile's material leaves the Schnitt's fan-out", () => {
  const resources = resourcesAt();
  const clay = createClayMaterial(resources, objects());
  expect(resources.materials.has(clay)).toBe(true);
  clay.dispose();
  expect(resources.materials.has(clay)).toBe(false);
});

test("applyCityLook pushes the building rows into the uniforms, no rebuild", () => {
  const resources = resourcesAt();
  const clay = createClayMaterial(resources, objects());
  const before = clay.version;
  applyCityLook(resources, {
    ...LOOK_DEFAULTS,
    tint: 0.42,
    roughness: 0.3,
  });
  expect(resources.clayDetail.uTint.value).toBe(0.42);
  expect(resources.clayDetail.uRough.value).toBe(0.3);
  expect(clay.version).toBe(before);
});

test("the clay shares the scene's night and sky-view nodes", () => {
  const night = uniform(0);
  const skyView = uniform(1);
  const resources = createStyleResources(night, skyView);
  // The sun rig and the terrain's row write these in place — a copy would
  // silently stop driving every tile's clay.
  expect(resources.clayDetail.uNight).toBe(night);
  expect(resources.clayDetail.uSkyView).toBe(skyView);
});

test("a tile's clay is a node material with the facade detail wired", () => {
  const clay = createClayMaterial(resourcesAt(), objects());
  expect(clay).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(clay.colorNode).not.toBeNull();
  expect(clay.normalNode).not.toBeNull();
  expect(clay.roughnessNode).not.toBeNull();
  expect(clay.emissiveNode).not.toBeNull();
  expect(clay.aoNode).not.toBeNull();
});

test("every building tile's clay shares one graph and reads its own table", () => {
  const resources = resourcesAt();
  const a = objects();
  const b = { rows: 7, texture: new DataTexture() };
  const clayA = createClayMaterial(resources, a);
  const clayB = createClayMaterial(resources, b);
  // one set of nodes: one build for every tile
  expect(clayB.colorNode).toBe(clayA.colorNode);
  expect(clayB.aoNode).toBe(clayA.aoNode);
  expect(slotsOf(clayB).clayObjects).toBe(b.texture);
  expect(slotsOf(clayB).clayRows).toBe(7);
  expect(graphOf(clayB)).toBe("clay");
  // the open sky until the tile's raster lands, then a swap of values
  expect(slotsOf(clayA).claySvf).toBe(openSkyTexture());
  const before = clayA.version;
  const raster = new DataTexture();
  setClaySkyView(clayA, raster, [0, 0], [2000, 2000]);
  expect(slotsOf(clayA).claySvf).toBe(raster);
  expect(slotsOf(clayA).clayObjects).toBe(a.texture);
  expect(clayA.version).toBe(before);
});
