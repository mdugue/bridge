import { describe, expect, test } from "bun:test";
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type InterleavedBufferAttribute,
} from "three";
import { shareInstancing } from "./shared-instancing";

function tree(): { root: Group; mesh: InstancedMesh; base: BoxGeometry } {
  const base = new BoxGeometry();
  const mesh = new InstancedMesh(base, new MeshBasicMaterial(), 3);
  mesh.setColorAt(0, new Color(1, 0, 0));
  const root = new Group();
  root.add(mesh);
  return { root, mesh, base };
}

describe("shareInstancing", () => {
  test("gives the mesh a view with its instance data by name", () => {
    const { root, mesh, base } = tree();
    shareInstancing(root);
    const view = mesh.geometry;
    expect(view).not.toBe(base);
    expect(view.getAttribute("position")).toBe(base.getAttribute("position"));
    expect(view.index).toBe(base.index);
    expect(view.groups).toBe(base.groups);
    const column = view.getAttribute("iMat3") as InterleavedBufferAttribute;
    expect(column.data.array).toBe(mesh.instanceMatrix.array);
    expect(column.offset).toBe(12);
    expect(view.getAttribute("iColor").array).toBe(mesh.instanceColor?.array);
    expect(mesh.userData.sharedInstancing).toBe(true);
  });

  test("the views upload again when the instance data changes", () => {
    const { root, mesh } = tree();
    shareInstancing(root);
    const column = mesh.geometry.getAttribute(
      "iMat0"
    ) as InterleavedBufferAttribute;
    const before = column.data.version;
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(1, 2, 3));
    mesh.instanceMatrix.needsUpdate = true;
    expect(column.data.version).toBe(before + 1);
    const colour = mesh.geometry.getAttribute("iColor");
    const colourBefore = colour.version;
    mesh.instanceColor!.needsUpdate = true;
    expect(colour.version).toBe(colourBefore + 1);
  });

  test("marks each mesh once", () => {
    const { root, mesh } = tree();
    shareInstancing(root);
    const view = mesh.geometry;
    shareInstancing(root);
    expect(mesh.geometry).toBe(view);
  });
});
