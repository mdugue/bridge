import { expect, test } from "bun:test";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import { LoadingManager, type Mesh } from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { StructuralMetadata } from "@/lib/city/property-table";
import { writeMeshGlb } from "@/scripts/tile-glb";
import { GltfContentPlugin } from "./gltf-content";

test("a building tile's glb parses meshopt and carries its table on the mesh, until the plugin goes", async () => {
  const manager = new LoadingManager();
  const plugin = new GltfContentPlugin(MeshoptDecoder);
  plugin.init({ manager } as TilesRenderer);
  // how the renderer finds the loader for a glTF content
  const loader = manager.getHandler("path.glb") as GLTFLoader | null;
  expect(loader).not.toBeNull();

  const glb = await writeMeshGlb({
    name: "city",
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 1, 6, 5, 1, 5, 6, 1,
    ]),
    normals: new Float32Array(18).fill(1),
    attributes: { _FEATURE_ID_0: new Float32Array([0, 0, 0, 1, 1, 1]) },
    extras: { kind: "city", tileId: "t" },
    table: {
      className: "building",
      count: 2,
      properties: {
        baseZ: {
          type: "SCALAR",
          componentType: "FLOAT32",
          values: new Float32Array([100.5, 101]),
        },
        addr: { type: "STRING", values: ["Schloßstraße 1", ""] },
      },
    },
  });
  const gltf = await loader?.parseAsync(glb.slice().buffer, "");
  let mesh: Mesh | undefined;
  gltf?.scene.traverse((o) => {
    mesh ??= (o as Mesh).isMesh ? (o as Mesh) : undefined;
  });
  expect(mesh?.geometry.getAttribute("_feature_id_0").count).toBe(6);
  const metadata = mesh?.userData.structuralMetadata as StructuralMetadata;
  const [table] = metadata.tableAccessors;
  expect(table.count).toBe(2);
  expect(table.getPropertyValue("baseZ", 1)).toBe(101);
  expect(table.getPropertyValue("addr", 0)).toBe("Schloßstraße 1");
  // the renderer frees it on every object of a tile that goes
  expect(gltf?.scene.userData.structuralMetadata).toBe(metadata);
  expect(() => metadata.dispose()).not.toThrow();

  plugin.dispose();
  expect(manager.getHandler("path.glb")).toBeNull();
});
