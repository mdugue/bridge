import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  Points,
} from "three/webgpu";
import { Instances } from "./instancing";
import { graphOf, setGraph, setSlots } from "./material-slots";
import { createPipelineAnchors, layoutStub } from "./pipeline-anchors";
import { sceneMaterial, retainSceneMaterials } from "./three-utils";

// reason: @types/three declares no RenderObject; reading three's own key
// in a test (not patching it, ADR 0027) keeps this from drifting.
// @ts-expect-error -- no type declarations for three's src modules
import RenderObject from "three/src/renderers/common/RenderObject.js";

/** What three keys a pipeline's geometry by: its own getGeometryCacheKey. */
const layoutKey = (object: { geometry: Mesh["geometry"] }): string =>
  (
    RenderObject as {
      prototype: { getGeometryCacheKey: (this: unknown) => string };
    }
  ).prototype.getGeometryCacheKey.call(object);

test("a stub has the instanced layout of its set, in three vertices", () => {
  const set = new Instances(new BoxGeometry(), new MeshBasicNodeMaterial(), 50);
  set.setColorAt(0, set.material.color);
  const stub = layoutStub(set.geometry);
  expect(layoutKey({ geometry: stub })).toBe(layoutKey(set));
  expect(stub.getAttribute("position").count).toBe(3);
  expect(stub.index?.count).toBe(3);
  expect(stub.index?.array.constructor).toBe(
    set.geometry.index?.array.constructor
  );
  expect((stub as { instanceCount?: number }).instanceCount).toBe(1);
  // the four matrix columns share one small buffer, as the set's do
  const columns = [0, 1, 2, 3].map(
    (i) => (stub.getAttribute(`iMat${i}`) as unknown as { data: object }).data
  );
  expect(new Set(columns).size).toBe(1);
});

test("only scene-wide materials are anchored, once per layout and receipt", async () => {
  const release = retainSceneMaterials();
  const shared = sceneMaterial(
    "anchor-test",
    () => new MeshBasicNodeMaterial()
  );
  const compiled: Object3D[] = [];
  const anchors = createPipelineAnchors((o) => {
    compiled.push(o);
    return Promise.resolve();
  });
  const a = new Mesh(new BoxGeometry(), shared);
  const b = new Mesh(new BoxGeometry(), shared);
  const receiving = new Mesh(new BoxGeometry(), shared);
  receiving.receiveShadow = true;
  const own = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
  const points = new Points(new BoxGeometry(), shared);
  for (const o of [a, b, receiving, own, points]) {
    await anchors.anchor(o);
  }
  // a and b share a key; receiving and points are their own; own is per-tile
  expect(anchors.count()).toBe(3);
  expect(compiled).toHaveLength(3);
  expect(compiled.map((o) => o.type)).toEqual(["Mesh", "Mesh", "Points"]);
  expect(compiled[1]?.receiveShadow).toBe(true);
  anchors.dispose();
  expect(anchors.count()).toBe(0);
  release();
});

test("a shared build is anchored once, through a stand-in without the tile's slots", async () => {
  const compiled: Object3D[] = [];
  const anchors = createPipelineAnchors((o) => {
    compiled.push(o);
    return Promise.resolve();
  });
  const tile = (raster: object) => {
    const material = new MeshBasicNodeMaterial();
    setSlots(material, { class: raster });
    setGraph(material, "terrain|fine");
    return new Mesh(new BoxGeometry(), material);
  };
  const raster = {};
  await anchors.anchor(tile(raster));
  await anchors.anchor(tile({}));
  expect(anchors.count()).toBe(1);
  const standIn = (compiled[0] as Mesh).material as MeshBasicNodeMaterial;
  // it builds as the tiles do and holds none of their rasters
  expect(graphOf(standIn)).toBe("terrain|fine");
  expect(standIn.userData.slots).toBeUndefined();
  anchors.dispose();
});
