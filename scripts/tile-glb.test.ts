import { expect, test } from "bun:test";
import { StructuralMetadata as LibraryMetadata } from "3d-tiles-renderer/three/plugins";
import { Vector3 } from "three";
import {
  propertyTableViews,
  readStructuralMetadata,
  type StructuralMetadataJson,
} from "../lib/city/property-table";
import {
  ENUM_NONE,
  enumColumn,
  type PropertyTable,
  writeMeshGlb,
} from "./tile-glb";

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

/** The BIN chunk of a glb. */
function gltfBin(glb: Uint8Array): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const binAt = 20 + view.getUint32(12, true);
  return glb.subarray(binAt + 8, binAt + 8 + view.getUint32(binAt, true));
}

test("string columns carry UTF-8 values and byte offsets; noData reaches the schema", async () => {
  const glb = await writeMeshGlb({
    name: "city",
    positions,
    normals,
    attributes: { _FEATURE_ID_0: new Float32Array([0, 0, 0, 1, 1, 1]) },
    extras: { kind: "city", tileId: "t" },
    table: {
      className: "building",
      count: 2,
      properties: {
        id: { type: "STRING", values: ["DESNATPU1000HJx5", ""] },
        addr: { type: "STRING", values: ["Schloßstraße 1", "Äußere Neustadt"] },
        height: {
          type: "SCALAR",
          componentType: "FLOAT32",
          values: new Float32Array([18.5, -1]),
          noData: -1,
        },
      },
    },
  });
  const json = gltfJson(glb) as {
    bufferViews: { byteLength: number; byteOffset: number }[];
    extensions: {
      EXT_structural_metadata: {
        propertyTables: {
          properties: Record<
            string,
            {
              stringOffsetType?: string;
              stringOffsets?: number;
              values: number;
            }
          >;
        }[];
        schema: {
          classes: Record<
            string,
            { properties: Record<string, { noData?: number; type: string }> }
          >;
        };
      };
    };
  };
  const meta = json.extensions.EXT_structural_metadata;
  const schema = meta.schema.classes.building.properties;
  expect(schema.id).toEqual({ type: "STRING" });
  expect(schema.height).toMatchObject({ noData: -1, default: -1 });
  const bin = gltfBin(glb);
  const read = (name: string): string[] => {
    const p = meta.propertyTables[0].properties[name];
    expect(p.stringOffsetType).toBe("UINT32");
    const values = json.bufferViews[p.values];
    const offsetsView = json.bufferViews[p.stringOffsets ?? -1];
    expect(values.byteOffset % 8).toBe(0);
    const offsets = new Uint32Array(
      bin.slice(
        offsetsView.byteOffset,
        offsetsView.byteOffset + offsetsView.byteLength
      ).buffer
    );
    const bytes = bin.subarray(
      values.byteOffset,
      values.byteOffset + values.byteLength
    );
    return [0, 1].map((i) =>
      new TextDecoder().decode(bytes.subarray(offsets[i], offsets[i + 1]))
    );
  };
  expect(read("id")).toEqual(["DESNATPU1000HJx5", ""]);
  expect(read("addr")).toEqual(["Schloßstraße 1", "Äußere Neustadt"]);
  expect(new DataView(glb.buffer, glb.byteOffset).getUint32(8, true)).toBe(
    glb.length
  );
});

test("an enum column holds the codes the tile uses, NONE first for none", () => {
  const { enumDef, indices } = enumColumn([
    "31001_2000",
    "",
    "31001_1000",
    "31001_2000",
  ]);
  expect(enumDef).toEqual({
    valueType: "UINT16",
    values: [
      { name: ENUM_NONE, value: 0 },
      { name: "31001_1000", value: 1 },
      { name: "31001_2000", value: 2 },
    ],
  });
  expect([...indices]).toEqual([2, 0, 1, 2]);
});

test("enum columns reach the schema as ENUM with NONE as noData", async () => {
  const glb = await writeMeshGlb({
    name: "city",
    positions,
    normals,
    attributes: { _FEATURE_ID_0: new Float32Array([0, 0, 0, 1, 1, 1]) },
    extras: { kind: "city", tileId: "t" },
    table: {
      className: "building",
      count: 2,
      properties: { roofType: { type: "ENUM", values: ["3100", ""] } },
    },
  });
  const meta = (
    gltfJson(glb) as {
      extensions: {
        EXT_structural_metadata: {
          schema: {
            classes: Record<string, { properties: Record<string, unknown> }>;
            enums: Record<string, { values: { name: string }[] }>;
          };
        };
      };
    }
  ).extensions.EXT_structural_metadata;
  expect(meta.schema.classes.building.properties.roofType).toEqual({
    type: "ENUM",
    enumType: "roofType",
    noData: ENUM_NONE,
  });
  expect(meta.schema.enums.roofType.values.map((v) => v.name)).toEqual([
    ENUM_NONE,
    "3100",
  ]);
});

test("the viewer reads back every column the bake writes, as 3DTilesRendererJS's reader did", async () => {
  const properties: PropertyTable["properties"] = {
    baseZ: {
      type: "SCALAR",
      componentType: "FLOAT32",
      values: new Float32Array([100.5, 101]),
    },
    height: {
      type: "SCALAR",
      componentType: "FLOAT32",
      values: new Float32Array([18.5, -1]),
      noData: -1,
    },
    building: {
      type: "SCALAR",
      componentType: "UINT8",
      values: Uint8Array.from([1, 0]),
    },
    flags: {
      type: "SCALAR",
      componentType: "UINT16",
      values: Uint16Array.from([3, 0]),
    },
    root: {
      type: "SCALAR",
      componentType: "UINT32",
      values: Uint32Array.from([0, 0]),
    },
    tint: {
      type: "VEC3",
      componentType: "FLOAT32",
      values: new Float32Array([0.5, 0.25, 0.75, 1, 1, 1]),
    },
    addr: { type: "STRING", values: ["Schloßstraße 1", ""] },
    roofType: { type: "ENUM", values: ["", "3100"] },
  };
  const glb = await writeMeshGlb({
    name: "city",
    positions,
    normals,
    attributes: { _FEATURE_ID_0: new Float32Array([0, 0, 0, 1, 1, 1]) },
    extras: { kind: "city", tileId: "t" },
    table: { className: "building", count: 2, properties },
  });
  const json = gltfJson(glb) as {
    bufferViews: { byteLength: number; byteOffset?: number }[];
    extensions: { EXT_structural_metadata: StructuralMetadataJson };
  };
  const ext = json.extensions.EXT_structural_metadata;
  const bin = gltfBin(glb);
  // the buffer views as GLTFLoader hands them over: a copy each
  const views: ArrayBuffer[] = [];
  for (const i of propertyTableViews(ext)) {
    const { byteOffset = 0, byteLength } = json.bufferViews[i];
    views[i] = bin.slice(byteOffset, byteOffset + byteLength).buffer;
  }
  const [table] = readStructuralMetadata(ext, (i) => views[i]).tableAccessors;
  const theirs = new LibraryMetadata(ext, [], views).getPropertyTableData(
    [0, 0],
    [0, 1],
    []
  ) as unknown as Record<string, unknown>[];
  const flat = (v: unknown) => (v instanceof Vector3 ? v.toArray() : v);
  for (const [name, column] of Object.entries(properties)) {
    const written =
      column.type === "VEC3"
        ? [[...column.values.subarray(0, 3)], [...column.values.subarray(3)]]
        : [...column.values];
    for (const id of [0, 1]) {
      expect(table.getPropertyValue(name, id)).toEqual(written[id]);
      expect(flat(theirs[id][name])).toEqual(written[id]);
    }
  }
  expect(Object.keys(table.properties).toSorted()).toEqual(
    Object.keys(theirs[0]).toSorted()
  );
});
