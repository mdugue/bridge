import { expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Raycaster,
  Vector3,
} from "three/webgpu";
import { MeshBVH } from "three-mesh-bvh";
import {
  buildBvhOffThread,
  bvhBuilding,
  bvhWorkerUp,
  stopBvhWorker,
} from "./bvh-client";
import "./collision";

/** A field of quantised quads (int16, four per vertex, interleaved), as a
 *  building tile's glTF stores them. */
function field(n = 30): BufferGeometry {
  const raw = new Int16Array((n + 1) * (n + 1) * 4);
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) {
      const i = r * (n + 1) + c;
      raw[4 * i] = Math.round(((c / n) * 2 - 1) * 32_767);
      raw[4 * i + 1] = Math.round(Math.sin(r + c) * 8000);
      raw[4 * i + 2] = Math.round(((r / n) * 2 - 1) * 32_767);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * (n + 1) + c;
      index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new InterleavedBufferAttribute(new InterleavedBuffer(raw, 4), 3, 0, true)
  );
  geometry.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  return geometry;
}

test("the worker builds the BVH a ray finds the same hits through", async () => {
  const there = field();
  const here = field();
  here.boundsTree = new MeshBVH(here);
  await buildBvhOffThread(there);
  expect(bvhWorkerUp()).toBe(true);
  expect(bvhBuilding(there)).toBe(false);
  expect(there.boundsTree).toBeDefined();
  // the arrays are back, the index sorted as the BVH has it
  expect(there.getIndex()?.array.length).toBe(here.getIndex()?.array.length);
  expect([...(there.getIndex()?.array ?? [])]).toEqual([
    ...(here.getIndex()?.array ?? []),
  ]);
  const ray = new Raycaster();
  for (const [x, z] of [
    [0.1, 0.2],
    [-0.7, 0.4],
    [0.9, -0.9],
  ]) {
    ray.set(new Vector3(x, 2, z), new Vector3(0, -1, 0));
    const a = ray.intersectObject(new Mesh(there), false)[0];
    const b = ray.intersectObject(new Mesh(here), false)[0];
    expect(a?.distance).toBeCloseTo(b?.distance ?? Number.NaN, 9);
    expect(a?.faceIndex).toBe(b?.faceIndex);
  }
});

test("while the worker builds, the geometry says so", async () => {
  const geometry = field(300);
  const done = buildBvhOffThread(geometry);
  // its turn comes after the builds before it, within a few microtasks
  for (let i = 0; i < 10 && !bvhBuilding(geometry); i++) {
    await Promise.resolve();
  }
  expect(bvhBuilding(geometry)).toBe(true);
  // the positions and index are the worker's meanwhile
  expect(geometry.getIndex()?.array.length).toBe(0);
  await done;
  expect(geometry.getIndex()?.array.length).toBe(300 * 300 * 6);
  expect(bvhBuilding(geometry)).toBe(false);
});

test("a tile that left before its turn is not built, one that left during it gets its arrays back", async () => {
  const before = field();
  await buildBvhOffThread(before, () => false);
  expect(before.boundsTree).toBeFalsy();
  const during = field(100);
  let there = true;
  const done = buildBvhOffThread(during, () => there);
  for (let i = 0; i < 10 && !bvhBuilding(during); i++) {
    await Promise.resolve();
  }
  there = false;
  await done;
  expect(during.boundsTree).toBeFalsy();
  expect(during.getIndex()?.array.length).toBe(100 * 100 * 6);
});

test("a stopped worker starts again for the next build", async () => {
  await buildBvhOffThread(field(4));
  stopBvhWorker();
  expect(bvhWorkerUp()).toBe(false);
  const again = field(4);
  await buildBvhOffThread(again);
  expect(bvhWorkerUp()).toBe(true);
  expect(again.boundsTree).toBeDefined();
});
