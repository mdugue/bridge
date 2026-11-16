import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Color,
  Matrix4,
  MeshBasicNodeMaterial,
  Vector3,
} from "three/webgpu";
import type { InterleavedBufferAttribute } from "three/webgpu";
import { packStands } from "@/lib/city/stand-record";
import { Instances, standTable } from "./instancing";

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

test("a set born on another's matrices shares them", () => {
  const a = set();
  const b = new Instances(
    new BoxGeometry(),
    new MeshBasicNodeMaterial(),
    3,
    a.instanceMatrix
  );
  expect(b.instanceMatrix).toBe(a.instanceMatrix);
  a.setMatrixAt(2, new Matrix4().makeTranslation(4, 5, 6));
  expect(b.getMatrixAt(2, new Matrix4()).elements[13]).toBe(5);
});

test("a fresh set starts on identity matrices", () => {
  const s = set(2);
  expect(s.getMatrixAt(1, new Matrix4()).equals(new Matrix4())).toBe(true);
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

test("a set of stand records: one buffer, three views, no matrices", () => {
  const origin: [number, number, number] = [-1031, 112, 2040];
  const stands = [
    { x: -1030.4, y: 112.4, z: 2041, turn: 1.2, scale: [2, 3, 2] as const },
    { x: -1000, y: 113, z: 2100, turn: 0, scale: [1, 1, 1] as const },
  ];
  const words = packStands(stands, origin);
  const table = standTable(words, origin);
  const s = Instances.ofStands(
    new BoxGeometry(),
    new MeshBasicNodeMaterial(),
    table
  );
  expect(s.drawCount).toBe(2);
  // the file's words are the instance buffer: nothing copied
  expect(table.buffer.array).toBe(words);
  const views = ["iPlace", "iSize", "iKind"].map(
    (name) => s.geometry.getAttribute(name) as InterleavedBufferAttribute
  );
  expect(views.map((v) => v.data === table.buffer)).toEqual([true, true, true]);
  // not normalized: three hands them to the shader as unsigned integers
  expect(views.map((v) => v.normalized)).toEqual([false, false, false]);
  expect(s.geometry.hasAttribute("iMat0")).toBe(false);
  expect(s.userData.standOrigin).toBe(table.origin);
  expect(() => s.setMatrixAt(0, new Matrix4())).toThrow();
  // what the vertex stage composes, for the bounds
  const m = s.getMatrixAt(0, new Matrix4());
  const at = new Vector3().setFromMatrixPosition(m);
  expect(at.distanceTo(new Vector3(-1030.4, 112.4, 2041))).toBeLessThan(0.03);
  s.computeBoundingSphere();
  expect(s.geometry.boundingSphere?.containsPoint(at)).toBe(true);
  // a second set shares the table through `placement`
  const twin = new Instances(
    new BoxGeometry(),
    new MeshBasicNodeMaterial(),
    2,
    s.placement
  );
  expect(twin.stands).toBe(table);
});
