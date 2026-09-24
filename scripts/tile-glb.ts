/**
 * Writes the glTF binaries the viewer streams (lib/city/tileset.ts): one
 * terrain mesh per tile and level, one building mesh per tile. Standard glTF
 * 2.0 with EXT_meshopt_compression, so any glTF tool can open them, and the
 * buildings carry their per-object style table the standard way —
 * EXT_mesh_features (a feature id per vertex) pointing into an
 * EXT_structural_metadata property table.
 *
 * Input geometry is in the site's recentered data frame (Z-up); it is written
 * Y-up as glTF requires ((x, y, z) → (x, z, −y)), and 3D Tiles turns it back
 * (the tileset's frame is Z-up). Positions are quantised to 16 bits and
 * normals to 8 (KHR_mesh_quantization) with the dequantisation on the node,
 * so shaders derive data-frame coordinates from world space, never from
 * `position`. Build-time only; no DOM.
 */
import { Document, NodeIO, type Primitive } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { quantize, reorder, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

/** A property table column: one value (SCALAR) or tuple (VEC3) per feature. */
export type Column =
  | { type: "SCALAR"; componentType: "FLOAT32"; values: Float32Array }
  | { type: "SCALAR"; componentType: "UINT8"; values: Uint8Array }
  | { type: "SCALAR"; componentType: "UINT32"; values: Uint32Array }
  | { type: "VEC3"; componentType: "FLOAT32"; values: Float32Array };

export interface PropertyTable {
  /** the class name in the embedded schema */
  className: string;
  count: number;
  properties: Record<string, Column>;
}

export interface MeshInput {
  /**
   * custom vertex attributes (glTF names, `_UPPER_CASE`). Float32: three's
   * WebGPU backend has no 1-component 8/16-bit vertex format, and every
   * renderer reads these as floats anyway (whole-number feature ids).
   */
  attributes?: Record<string, Float32Array<ArrayBuffer>>;
  /** glTF `extras` of the scene: whatever the runtime needs next to the mesh */
  extras: Record<string, unknown>;
  indices?: Uint32Array<ArrayBuffer>;
  name: string;
  /** vertex normals; bake them, the runtime never recomputes */
  normals: Float32Array;
  positions: Float32Array;
  /** per-feature table; requires a `_FEATURE_ID_0` attribute */
  table?: PropertyTable;
  /** merge vertices whose every attribute is equal (flat-shaded buildings) */
  weld?: boolean;
}

async function io(): Promise<NodeIO> {
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
}

/** Data frame (Z-up) → glTF (Y-up): (x, y, z) → (x, z, −y). */
function toYUp(xyz: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    out[i] = xyz[i];
    out[i + 1] = xyz[i + 2];
    out[i + 2] = -xyz[i + 1];
  }
  return out;
}

function addPrimitive(doc: Document, input: MeshInput): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  type Array =
    | Float32Array<ArrayBuffer>
    | Uint8Array<ArrayBuffer>
    | Uint16Array<ArrayBuffer>
    | Uint32Array<ArrayBuffer>;
  const accessor = (array: Array, type: "SCALAR" | "VEC3") =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor(toYUp(input.positions), "VEC3"))
    .setAttribute("NORMAL", accessor(toYUp(input.normals), "VEC3"));
  for (const [name, array] of Object.entries(input.attributes ?? {})) {
    prim.setAttribute(name, accessor(array, "SCALAR"));
  }
  if (input.indices) {
    prim.setIndices(accessor(input.indices, "SCALAR"));
  }
  return prim;
}

/** The glb for one mesh, meshopt-compressed, optionally with a feature table. */
export async function writeMeshGlb(input: MeshInput): Promise<Uint8Array> {
  const doc = new Document();
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    });
  const mesh = doc
    .createMesh(input.name)
    .addPrimitive(addPrimitive(doc, input));
  const scene = doc
    .createScene(input.name)
    .addChild(doc.createNode(input.name).setMesh(mesh));
  scene.setExtras(input.extras);
  // Only positions and normals are quantised: the custom attributes are ids
  // and flags that must stay exact (quantize would squeeze them to 12 bits).
  const transforms = [
    quantize({
      pattern: /^(POSITION|NORMAL)$/,
      quantizePosition: 16,
      quantizeNormal: 8,
    }),
  ];
  if (input.weld) {
    // Merged and reordered for the vertex cache — and for meshopt, which
    // compresses a cache-ordered stream far better. (A grid terrain keeps its
    // order: the runtime reads ground height from it. A TIN is indexed by
    // triangle at runtime, so it welds and reorders.)
    transforms.unshift(weld(), reorder({ encoder: MeshoptEncoder }));
  }
  await doc.transform(...transforms);
  const glb = await (await io()).writeBinary(doc);
  return input.table ? addPropertyTable(glb, input.table) : glb;
}

// --- EXT_structural_metadata (gltf-transform has no writer for it) ----------

const JSON_CHUNK = 0x4e_4f_53_4a;
const BIN_CHUNK = 0x00_4e_49_42;

interface GltfJson {
  bufferViews?: { buffer: number; byteLength: number; byteOffset?: number }[];
  buffers?: { byteLength: number; extensions?: object; uri?: string }[];
  extensions?: Record<string, unknown>;
  extensionsUsed?: string[];
  meshes?: { primitives: { extensions?: Record<string, unknown> }[] }[];
}

const pad = (n: number, to: number) => Math.ceil(n / to) * to;

/**
 * Appends a property table to a glb: its columns as buffer views at the end
 * of the BIN chunk (8-byte aligned, as the extension requires), the schema
 * and table under EXT_structural_metadata, and EXT_mesh_features on every
 * primitive, reading feature ids from `_FEATURE_ID_0`.
 */
export function addPropertyTable(
  glb: Uint8Array,
  table: PropertyTable
): Uint8Array {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error("glb: first chunk is not JSON");
  }
  const json = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))
  ) as GltfJson;
  const binAt = 20 + jsonLength;
  const binLength = view.getUint32(binAt, true);
  if (view.getUint32(binAt + 4, true) !== BIN_CHUNK) {
    throw new Error("glb: second chunk is not BIN");
  }
  const bin = glb.subarray(binAt + 8, binAt + 8 + binLength);
  // The glb's own buffer: the one without a uri that is not a meshopt fallback.
  const bufferIndex = (json.buffers ?? []).findIndex(
    (b) => b.uri === undefined && b.extensions === undefined
  );
  if (bufferIndex === -1) {
    throw new Error("glb: no embedded buffer");
  }

  const chunks: Uint8Array[] = [bin];
  let length = bin.length;
  const bufferViews = json.bufferViews ?? [];
  const properties: Record<string, { values: number }> = {};
  const schema: Record<string, { componentType: string; type: string }> = {};
  for (const [name, column] of Object.entries(table.properties)) {
    const offset = pad(length, 8);
    chunks.push(new Uint8Array(offset - length));
    const bytes = new Uint8Array(
      column.values.buffer,
      column.values.byteOffset,
      column.values.byteLength
    );
    chunks.push(bytes);
    length = offset + bytes.length;
    bufferViews.push({
      buffer: bufferIndex,
      byteOffset: offset,
      byteLength: bytes.length,
    });
    properties[name] = { values: bufferViews.length - 1 };
    schema[name] = { type: column.type, componentType: column.componentType };
  }
  const total = pad(length, 4);
  chunks.push(new Uint8Array(total - length));
  json.bufferViews = bufferViews;
  (json.buffers ?? [])[bufferIndex].byteLength = total;
  json.extensions = {
    ...json.extensions,
    EXT_structural_metadata: {
      schema: {
        id: "bridge",
        classes: { [table.className]: { properties: schema } },
      },
      propertyTables: [
        { class: table.className, count: table.count, properties },
      ],
    },
  };
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      prim.extensions = {
        ...prim.extensions,
        EXT_mesh_features: {
          featureIds: [
            { featureCount: table.count, attribute: 0, propertyTable: 0 },
          ],
        },
      };
    }
  }
  json.extensionsUsed = [
    ...new Set([
      ...(json.extensionsUsed ?? []),
      "EXT_mesh_features",
      "EXT_structural_metadata",
    ]),
  ];

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = pad(jsonBytes.length, 4);
  const out = new Uint8Array(12 + 8 + jsonPadded + 8 + total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46_54_6c_67, true); // "glTF"
  o.setUint32(4, 2, true);
  o.setUint32(8, out.length, true);
  o.setUint32(12, jsonPadded, true);
  o.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  const binStart = 20 + jsonPadded;
  o.setUint32(binStart, total, true);
  o.setUint32(binStart + 4, BIN_CHUNK, true);
  let at = binStart + 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
