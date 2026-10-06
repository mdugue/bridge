import { expect, test } from "bun:test";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ClippingGroup,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
} from "three/webgpu";
import {
  aloneUnder,
  disposeObject3D,
  dropCpuCopies,
  estimateGeometryBytes,
  markSceneShared,
  releaseRenderState,
  retainSceneMaterials,
  sceneMaterial,
  sceneShared,
  sceneSharedBytes,
  textureBytes,
} from "./three-utils";
import { Instances } from "./instancing";

/** Counts three's "dispose" events, which `.dispose()` dispatches. */
function countDisposals(resource: BufferGeometry | Material): () => number {
  let calls = 0;
  resource.addEventListener("dispose", () => {
    calls += 1;
  });
  return () => calls;
}

test("disposes the geometry and material of a nested mesh", () => {
  const geometry = new BoxGeometry();
  const material = new MeshBasicNodeMaterial();
  const geometryCalls = countDisposals(geometry);
  const materialCalls = countDisposals(material);
  const group = new Object3D();
  group.add(new Mesh(geometry, material));

  disposeObject3D(group);

  expect(geometryCalls()).toBe(1);
  expect(materialCalls()).toBe(1);
});

test("walks material arrays", () => {
  const first = new MeshBasicNodeMaterial();
  const second = new MeshBasicNodeMaterial();
  const firstCalls = countDisposals(first);
  const secondCalls = countDisposals(second);

  disposeObject3D(new Mesh(new BoxGeometry(), [first, second]));

  expect(firstCalls()).toBe(1);
  expect(secondCalls()).toBe(1);
});

test("two meshes sharing one material dispose without throwing", () => {
  const material = new MeshBasicNodeMaterial();
  const calls = countDisposals(material);
  const group = new Object3D();
  group.add(new Mesh(new BoxGeometry(), material));
  group.add(new Mesh(new BoxGeometry(), material));

  expect(() => disposeObject3D(group)).not.toThrow();
  expect(calls()).toBeGreaterThanOrEqual(1);
});

test("an instanced set's buffers go with its geometry view", () => {
  const set = new Instances(new BoxGeometry(), new MeshBasicNodeMaterial(), 4);
  let calls = 0;
  set.geometry.addEventListener("dispose", () => {
    calls += 1;
  });
  const group = new Object3D();
  group.add(set);

  disposeObject3D(group);

  expect(calls).toBe(1);
});

test("a bare Object3D is traversed without throwing", () => {
  expect(() => disposeObject3D(new Object3D())).not.toThrow();
});

test("a buffer the scene shares is off a geometry when that geometry is disposed", () => {
  // three's dispose destroys the GPU buffer of whatever the geometry holds
  // as it dispatches: the shared index must not be held by then
  const shared = new BufferAttribute(Uint32Array.from([0, 1, 2]), 1);
  markSceneShared(shared);
  const geometry = new BoxGeometry();
  geometry.setIndex(shared);
  const own = geometry.getAttribute("position");
  let heldAtDispose: unknown = "never disposed";
  geometry.addEventListener("dispose", () => {
    heldAtDispose = geometry.index;
  });
  const root = new Object3D();
  root.add(new Mesh(geometry, new MeshBasicNodeMaterial()));
  expect(sceneSharedBytes(root)).toBe(12);
  disposeObject3D(root);
  expect(heldAtDispose).toBeNull();
  // the tile's own attributes went with it as ever
  expect(geometry.getAttribute("position")).toBe(own);
  expect(shared.array).toEqual(Uint32Array.from([0, 1, 2]));
});

test("estimateGeometryBytes counts each geometry once, index included", () => {
  const geometry = new BoxGeometry();
  const expected =
    Object.values(geometry.attributes).reduce(
      (sum, a) => sum + a.array.byteLength,
      0
    ) + (geometry.index?.array.byteLength ?? 0);
  const root = new Object3D();
  root.add(new Mesh(geometry, new MeshBasicNodeMaterial()));
  root.add(new Mesh(geometry, new MeshBasicNodeMaterial()));
  expect(estimateGeometryBytes(root)).toBe(expected);
});

/** A quantised glTF-like mesh: interleaved positions and normals, an index. */
function gltfMesh() {
  const geometry = new BufferGeometry();
  const positions = new InterleavedBuffer(
    Int16Array.from([0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 100, 0]),
    4
  );
  const normals = new InterleavedBuffer(
    Int8Array.from([0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0, 0]),
    4
  );
  geometry.setAttribute(
    "position",
    new InterleavedBufferAttribute(positions, 3, 0, true)
  );
  geometry.setAttribute(
    "normal",
    new InterleavedBufferAttribute(normals, 3, 0, true)
  );
  geometry.setIndex(new BufferAttribute(Uint32Array.from([0, 1, 2]), 1));
  return new Mesh(geometry, new MeshBasicNodeMaterial());
}

test("dropped CPU copies keep their kind, count and weight, and the mesh its bounds", () => {
  const mesh = gltfMesh();
  const { geometry } = mesh;
  const root = new Object3D();
  root.add(mesh);
  const before = estimateGeometryBytes(root);
  const dropped = dropCpuCopies(root, [
    geometry.getAttribute("position"),
    geometry.getAttribute("normal"),
    geometry.getIndex(),
  ]);
  expect(dropped).toBe(24 + 12 + 12);
  const position = geometry.getAttribute(
    "position"
  ) as InterleavedBufferAttribute;
  // what three reads after the upload: the kind of array, and the count
  expect(position.data.array).toBeInstanceOf(Int16Array);
  expect(position.data.array.length).toBe(0);
  expect(position.count).toBe(3);
  expect(geometry.getIndex()?.array).toBeInstanceOf(Uint32Array);
  expect(geometry.getIndex()?.count).toBe(3);
  // the HUD and the tile cache weigh what the GPU holds, not the CPU
  expect(estimateGeometryBytes(root)).toBe(before);
  // bounds taken from the positions while they were there (culling)
  expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
});

test("a buffer still read through another attribute, or shared by the scene, keeps its copy", () => {
  const mesh = gltfMesh();
  const twin = new Mesh(new BufferGeometry(), mesh.material);
  // a second view of the same normals the drop does not list
  twin.geometry.setAttribute(
    "normal",
    new InterleavedBufferAttribute(
      (mesh.geometry.getAttribute("normal") as InterleavedBufferAttribute).data,
      3,
      0,
      true
    )
  );
  const shared = mesh.geometry.getIndex();
  if (shared) {
    markSceneShared(shared);
  }
  const root = new Object3D();
  root.add(mesh, twin);
  dropCpuCopies(root, [mesh.geometry.getAttribute("normal"), shared]);
  expect(mesh.geometry.getAttribute("normal").array.length).toBe(12);
  expect(shared?.array.length).toBe(3);
});

test("textureBytes adds a third for a mip chain", () => {
  expect(textureBytes(4, 4, 4, false)).toBe(64);
  expect(textureBytes(4, 4, 1, true)).toBe(21);
});

test("a scene-wide material survives its tile's disposal", () => {
  const release = retainSceneMaterials();
  const shared = sceneMaterial(
    "test-shared",
    () => new MeshBasicNodeMaterial()
  );
  expect(sceneMaterial("test-shared", () => new MeshBasicNodeMaterial())).toBe(
    shared
  );
  const own = new MeshBasicNodeMaterial();
  const root = new Object3D();
  root.add(
    new Mesh(new BoxGeometry(), shared),
    new Mesh(new BoxGeometry(), own)
  );
  const sharedDisposed = countDisposals(shared);
  const ownDisposed = countDisposals(own);
  disposeObject3D(root);
  expect(sharedDisposed()).toBe(0);
  expect(ownDisposed()).toBe(1);
  // the last app frees it; the next one makes a fresh one
  release();
  expect(sharedDisposed()).toBe(1);
  const again = retainSceneMaterials();
  expect(
    sceneMaterial("test-shared", () => new MeshBasicNodeMaterial())
  ).not.toBe(shared);
  again();
});

test("a scene-shared resource is disposed with the last app that holds it", () => {
  const share = sceneShared(() => new MeshBasicNodeMaterial());
  const releaseA = share.retain();
  const first = share.get();
  expect(share.get()).toBe(first);
  const disposed = countDisposals(first);
  // a remount boots the next app before the last one is gone
  const releaseB = share.retain();
  releaseA();
  releaseA();
  expect(disposed()).toBe(0);
  releaseB();
  expect(disposed()).toBe(1);
  // the next app makes a fresh one, its renderer's listeners on it alone
  const releaseC = share.retain();
  expect(share.get()).not.toBe(first);
  releaseC();
});

test("a released drawable dispatches dispose, even on a scene-wide material", () => {
  // WebGPURenderer frees a drawable's render objects on this event only
  // (or on its material's dispose, which a scene-wide material never gets).
  const release = retainSceneMaterials();
  const shared = sceneMaterial(
    "test-release",
    () => new MeshBasicNodeMaterial()
  );
  const root = new Object3D();
  const drawable = new Mesh(new BoxGeometry(), shared);
  const group = new Object3D();
  root.add(drawable, group);
  const seen: string[] = [];
  const listen = (o: Object3D, name: string) =>
    (
      o as unknown as { addEventListener: (t: string, f: () => void) => void }
    ).addEventListener("dispose", () => seen.push(name));
  listen(drawable, "drawable");
  listen(group, "group");
  releaseRenderState(root);
  expect(seen).toEqual(["drawable"]);
  seen.length = 0;
  disposeObject3D(root);
  expect(seen).toEqual(["drawable"]);
  release();
});

test("a compile under a group sees the object alone there, and then all is back", () => {
  const group = new ClippingGroup();
  group.enabled = false;
  const city = new Group();
  const hidden = new Group();
  hidden.visible = false;
  group.add(city, hidden);
  const stub = new Mesh();
  const seen = aloneUnder(group, stub, () => ({
    enabled: group.enabled,
    visible: group.children.filter((c) => c.visible),
  }));
  expect(seen.enabled).toBe(true);
  expect(seen.visible).toEqual([stub]);
  expect(group.enabled).toBe(false);
  expect(group.children).toEqual([city, hidden]);
  expect([city.visible, hidden.visible]).toEqual([true, false]);
  expect(stub.parent).toBeNull();
  // put back even when the compile throws
  expect(() =>
    aloneUnder(group, stub, () => {
      throw new Error("lost device");
    })
  ).toThrow("lost device");
  expect(group.children).toEqual([city, hidden]);
  expect(city.visible).toBe(true);
});
