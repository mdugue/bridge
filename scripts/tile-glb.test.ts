import { expect, test } from "bun:test";
import { writeMeshGlb } from "./tile-glb";

/** The JSON chunk of a glb. */
function gltfJson(glb: Uint8Array): Record<string, unknown> {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + length))
  ) as Record<string, unknown>;
}

// One triangle per object, two objects; flat normals up.
const positions = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 1, 6, 5, 1, 5, 6, 1,
]);
const normals = new Float32Array([
  0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
]);

test("a mesh glb is meshopt-compressed, quantised and Y-up", async () => {
  const glb = await writeMeshGlb({
    name: "terrain",
    positions,
    normals,
    indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    extras: { kind: "terrain", tileId: "t" },
  });
  const json = gltfJson(glb) as {
    accessors: {
      componentType: number;
      max?: number[];
      min?: number[];
      normalized?: boolean;
    }[];
    extensionsRequired: string[];
    scenes: { extras: unknown }[];
  };
  expect(json.extensionsRequired).toContain("EXT_meshopt_compression");
  expect(json.extensionsRequired).toContain("KHR_mesh_quantization");
  expect(json.scenes[0].extras).toEqual({ kind: "terrain", tileId: "t" });
  // Positions and normals are normalised integers now.
  expect(json.accessors.some((a) => a.normalized === true)).toBe(true);
});

test("a feature table rides along as EXT_structural_metadata", async () => {
  const glb = await writeMeshGlb({
    name: "city",
    positions,
    normals,
    attributes: {
      _FEATURE_ID_0: new Float32Array([0, 0, 0, 1, 1, 1]),
      _ROOF: new Float32Array([0, 0, 0, 1, 1, 1]),
    },
    weld: true,
    extras: { kind: "city", tileId: "t" },
    table: {
      className: "building",
      count: 2,
      properties: {
        baseZ: {
          type: "SCALAR",
          componentType: "FLOAT32",
          values: new Float32Array([100, 101]),
        },
        tint: {
          type: "VEC3",
          componentType: "FLOAT32",
          values: new Float32Array(6),
        },
      },
    },
  });
  const json = gltfJson(glb) as {
    accessors: { componentType: number; normalized?: boolean }[];
    bufferViews: { byteLength: number; byteOffset: number }[];
    extensions: {
      EXT_structural_metadata: {
        propertyTables: {
          class: string;
          count: number;
          properties: Record<string, { values: number }>;
        }[];
        schema: {
          classes: Record<
            string,
            { properties: Record<string, { type: string }> }
          >;
        };
      };
    };
    extensionsUsed: string[];
    meshes: {
      primitives: {
        attributes: Record<string, number>;
        extensions: {
          EXT_mesh_features: { featureIds: { featureCount: number }[] };
        };
      }[];
    }[];
  };
  // Ids and flags stay plain floats: never quantised, never normalised
  // (WebGPU has no 1-component 8/16-bit vertex format).
  const { attributes } = json.meshes[0].primitives[0];
  for (const name of ["_FEATURE_ID_0", "_ROOF"]) {
    const accessor = json.accessors[attributes[name]];
    expect(accessor.componentType).toBe(5126);
    expect(accessor.normalized ?? false).toBe(false);
  }
  expect(json.extensionsUsed).toContain("EXT_mesh_features");
  expect(json.extensionsUsed).toContain("EXT_structural_metadata");
  const meta = json.extensions.EXT_structural_metadata;
  expect(meta.schema.classes.building.properties.tint.type).toBe("VEC3");
  const [table] = meta.propertyTables;
  expect(table).toMatchObject({ class: "building", count: 2 });
  // Columns sit 8-byte aligned, as the extension requires.
  const view = json.bufferViews[table.properties.baseZ.values];
  expect(view.byteOffset % 8).toBe(0);
  expect(view.byteLength).toBe(8);
  expect(
    json.meshes[0].primitives[0].extensions.EXT_mesh_features.featureIds[0]
      .featureCount
  ).toBe(2);
  // The glb's declared length is its real length.
  expect(new DataView(glb.buffer, glb.byteOffset).getUint32(8, true)).toBe(
    glb.length
  );
});
