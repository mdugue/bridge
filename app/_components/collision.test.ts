import { expect, test } from "bun:test";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Ray,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bvhBytesUnder, createCityCollider, rayEntry } from "./collision";

/**
 * The building collider through a real three-mesh-bvh BVH (ADR 0032: the
 * camera is never inside a building). The fixture, in world metres: a
 * closed 10 m cube standing on y = 0 around (100, 100); a 20 cm slab at
 * y 6…6.2 over x 120…130 (a balcony, a bridge deck); a 1 m low wall around
 * (200, 100) that only the knee ray can see.
 */
function city({
  bvh = true,
  build,
}: { bvh?: boolean; build?: (mesh: Mesh) => void } = {}) {
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
    if (bvh) {
      mesh.geometry.computeBoundsTree();
    }
    group.add(mesh);
    return mesh;
  };
  const meshes = [
    solid([10, 10, 10], [100, 5, 100]),
    solid([10, 0.2, 10], [125, 6.1, 100]),
    solid([10, 1, 10], [200, 0.5, 100]),
  ];
  group.updateMatrixWorld(true);
  return { collider: createCityCollider(() => meshes, build), group };
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

test("a building without a BVH is passed over — never walked triangle by triangle — or built as a ray reaches it", () => {
  const bare = city({ bvh: false });
  expect(bare.collider.topAt(100, 100)).toBeNull();
  const step = new Vector3(1, 0, 0);
  expect(bare.collider.resolveStep(new Vector3(94.5, 1.7, 100), step)).toEqual(
    step
  );
  // with a builder the same rays build what they reach, and only that
  const built: Mesh[] = [];
  const lazy = city({
    bvh: false,
    build: (mesh) => {
      built.push(mesh);
      mesh.geometry.computeBoundsTree();
    },
  });
  expect(lazy.collider.topAt(100, 100)).toBeCloseTo(10, 5);
  expect(built).toHaveLength(1);
  // a long ray through the cube toward the low wall: the cube is hit
  // first, so the wall behind it is not built for it
  const along = lazy.collider.along(
    new Vector3(80, 0.5, 100),
    new Vector3(1, 0, 0),
    200
  );
  expect(along).toBeCloseTo(15, 5);
  expect(built).toHaveLength(1);
  expect(
    lazy.collider.resolveStep(new Vector3(194.5, 1.7, 100), step).length()
  ).toBeCloseTo(0, 6);
  expect(built).toHaveLength(2);
});

test("the walls of the tile the player stands in block: its box holds the eye", () => {
  // one building tile, as streamed: two houses in one mesh, whose box
  // reaches from (38, 0, 38) to (105, 10, 105) — the eye inside it
  const tile = new Mesh(
    mergeGeometries([
      new BoxGeometry(10, 10, 10).translate(100, 5, 100),
      new BoxGeometry(4, 4, 4).translate(40, 2, 40),
    ]),
    new MeshBasicNodeMaterial()
  );
  tile.updateMatrixWorld(true);
  const collider = createCityCollider(
    () => [tile],
    (mesh) => mesh.geometry.computeBoundsTree()
  );
  const step = collider.resolveStep(
    new Vector3(94.5, 1.7, 100),
    new Vector3(1, 0, 0)
  );
  expect(step.length()).toBeCloseTo(0, 6);
  expect(
    collider.along(new Vector3(80, 1.7, 100), new Vector3(1, 0, 0), 200)
  ).toBeCloseTo(15, 5);
});

test("a ray enters a box where it meets it, and at once from inside it", () => {
  const box = new Box3(new Vector3(10, 0, -5), new Vector3(20, 10, 5));
  const along = (x: number) =>
    rayEntry(new Ray(new Vector3(x, 5, 0), new Vector3(1, 0, 0)), box);
  expect(along(0)).toBeCloseTo(10, 6);
  // three's intersectBox gives the exit (at 20) from inside
  expect(along(12)).toBe(0);
  expect(along(30)).toBeNull();
});

test("a mesh's BVH weighs its node buffers; one without a BVH weighs nothing", () => {
  const { group } = city();
  const nodes = bvhBytesUnder(group);
  expect(nodes).toBeGreaterThan(0);
  // each geometry once, however many meshes draw it
  const twin = new Group();
  for (const child of group.children) {
    twin.add(child.clone(), child.clone());
  }
  expect(bvhBytesUnder(twin)).toBe(nodes);
  const bare = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicNodeMaterial());
  expect(bvhBytesUnder(bare)).toBe(0);
});
