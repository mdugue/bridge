import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Points,
} from "three/webgpu";
import { Instances } from "./instancing";
import { sceneCensus } from "./scene-census";

test("counts meshes, instances and triangles (instanced × drawCount)", () => {
  const group = new Group();
  const material = new MeshBasicNodeMaterial();
  group.add(new Mesh(new BoxGeometry(), material)); // 12 triangles
  const set = new Instances(new BoxGeometry(), material, 8);
  set.drawCount = 5; // 5 × 12: what is drawn, not the capacity
  group.add(set);
  expect(sceneCensus([group])).toEqual({
    meshes: 2,
    instances: 5,
    triangles: 12 + 60,
  });
});

test("an empty group is all zeros", () => {
  expect(sceneCensus([new Group()])).toEqual({
    meshes: 0,
    instances: 0,
    triangles: 0,
  });
});

test("non-mesh objects are ignored", () => {
  const group = new Group();
  group.add(new Points(new BoxGeometry()));
  expect(sceneCensus([group])).toEqual({
    meshes: 0,
    instances: 0,
    triangles: 0,
  });
});
