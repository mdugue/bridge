import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Color,
  Matrix4,
  MeshBasicNodeMaterial,
  Vector3,
} from "three/webgpu";
import { Instances } from "./instancing";

const set = (n = 3) =>
  new Instances(new BoxGeometry(), new MeshBasicNodeMaterial(), n);

test("a set is a plain mesh: count 1, no instanceColor", () => {
  const s = set();
  // A count above one would put the set back on three's per-mesh build
  // path (its uuid in the cache key); an instanceColor would multiply its
  // colour by InstancedMesh's varying.
  expect(s.count).toBe(1);
  expect("instanceColor" in s).toBe(false);
  expect(s.geometry.isInstancedBufferGeometry).toBe(true);
  expect(s.drawCount).toBe(3);
});

test("matrices land in the iMat columns, colours in iColor", () => {
  const s = set(2);
  const m = new Matrix4().makeTranslation(5, 6, 7);
  s.setMatrixAt(1, m);
  expect(s.getMatrixAt(1, new Matrix4()).equals(m)).toBe(true);
  expect(s.geometry.getAttribute("iMat3").getX(1)).toBe(5);
  expect(s.geometry.hasAttribute("iColor")).toBe(false);
  s.setColorAt(0, new Color(0.5, 0.25, 1));
  expect(s.geometry.getAttribute("iColor").getY(0)).toBe(0.25);
  // untouched instances stay white
  expect(s.geometry.getAttribute("iColor").getX(1)).toBe(1);
});

test("two sets can share one matrix buffer (one upload)", () => {
  const a = set();
  const b = set();
  b.instanceMatrix = a.instanceMatrix;
  a.setMatrixAt(0, new Matrix4().makeTranslation(1, 2, 3));
  expect(b.getMatrixAt(0, new Matrix4()).elements[12]).toBe(1);
});

test("the bounding sphere covers every drawn instance", () => {
  const s = set(2);
  s.setMatrixAt(0, new Matrix4().makeTranslation(-100, 0, 0));
  s.setMatrixAt(1, new Matrix4().makeTranslation(100, 0, 0));
  s.computeBoundingSphere();
  const sphere = s.geometry.boundingSphere;
  expect(sphere?.containsPoint(new Vector3(-100.4, 0, 0))).toBe(true);
  expect(sphere?.containsPoint(new Vector3(100.4, 0.4, 0))).toBe(true);
});

test("drawCount stays within the capacity", () => {
  const s = set(4);
  s.drawCount = 9;
  expect(s.drawCount).toBe(4);
  s.drawCount = -1;
  expect(s.drawCount).toBe(0);
});
