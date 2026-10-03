import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Vector3,
} from "three/webgpu";
import { createCityCollider } from "./collision";

/**
 * The building collider through a real three-mesh-bvh BVH (ADR 0032: the
 * camera is never inside a building). The fixture, in world metres: a
 * closed 10 m cube standing on y = 0 around (100, 100); a 20 cm slab at
 * y 6…6.2 over x 120…130 (a balcony, a bridge deck); a 1 m low wall around
 * (200, 100) that only the knee ray can see.
 */
function city() {
  const group = new Group();
  const solid = (
    size: [number, number, number],
    at: [number, number, number]
  ) => {
    const mesh = new Mesh(
      new BoxGeometry(...size),
      new MeshBasicNodeMaterial()
    );
    mesh.position.set(...at);
    mesh.geometry.computeBoundsTree();
    group.add(mesh);
    return mesh;
  };
  const meshes = [
    solid([10, 10, 10], [100, 5, 100]),
    solid([10, 0.2, 10], [125, 6.1, 100]),
    solid([10, 1, 10], [200, 0.5, 100]),
  ];
  group.updateMatrixWorld(true);
  return { collider: createCityCollider(() => meshes), group };
}

test("inside a building the roof above is found; outside or under a slab there is none", () => {
  const { collider } = city();
  expect(collider.roofAbove(100, 2, 100)).toBeCloseTo(10, 5);
  expect(collider.roofAbove(90, 2, 90)).toBeNull();
  // under the slab the surface above faces down: outside, not inside
  expect(collider.roofAbove(125, 2, 100)).toBeNull();
});

test("the top of the buildings over a point, or none off them", () => {
  const { collider } = city();
  expect(collider.topAt(100, 100)).toBeCloseTo(10, 5);
  expect(collider.topAt(125, 100)).toBeCloseTo(6.2, 5);
  expect(collider.topAt(0, 0)).toBeNull();
});

test("a step with nothing in the way passes unchanged", () => {
  const { collider } = city();
  const step = new Vector3(1, 0, 0);
  expect(collider.resolveStep(new Vector3(80, 1.7, 100), step)).toEqual(step);
});

test("a step head-on into a wall stops within the body radius", () => {
  const { collider } = city();
  const step = collider.resolveStep(
    new Vector3(94.5, 1.7, 100),
    new Vector3(1, 0, 0)
  );
  expect(step.length()).toBeCloseTo(0, 6);
});

test("an oblique step slides along the facade, nothing of it into the wall", () => {
  const { collider } = city();
  const step = collider.resolveStep(
    new Vector3(94.5, 1.7, 100),
    new Vector3(1, 0, 1)
  );
  expect(step.x).toBeCloseTo(0, 6);
  expect(step.z).toBeCloseTo(1, 6);
});

test("a wall below the eye still blocks: the knee ray sees it", () => {
  const { collider } = city();
  const step = collider.resolveStep(
    new Vector3(194.5, 1.7, 100),
    new Vector3(1, 0, 0)
  );
  expect(step.length()).toBeCloseTo(0, 6);
});

test("a building that moves is found where it went", () => {
  const { collider, group } = city();
  expect(collider.topAt(100, 100)).toBeCloseTo(10, 5);
  group.position.x += 50;
  group.updateMatrixWorld(true);
  expect(collider.topAt(150, 100)).toBeCloseTo(10, 5);
  expect(collider.topAt(100, 100)).toBeNull();
});
