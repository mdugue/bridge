import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Points,
} from "three";
import { sceneCensus } from "./scene-census";

test("counts meshes, instances and triangles (instanced × count)", () => {
  const group = new Group();
  const material = new MeshBasicMaterial();
  group.add(new Mesh(new BoxGeometry(), material)); // 12 triangles
  group.add(new InstancedMesh(new BoxGeometry(), material, 5)); // 5 × 12
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
