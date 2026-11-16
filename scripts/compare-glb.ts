/**
 * The glTF half of scripts/compare-tilesets.ts: two glbs compared by
 * content. Exact unless the caller asks for a tolerance; the file under
 * test never sets one.
 *
 * Exact (the default): the whole JSON chunk but for what is decoded and
 * compared on its own — every accessor a primitive reads stands as its
 * storage (component type, normalised, type, count, min, max, sparse
 * count), so another quantisation is a difference; the node transforms as
 * they are; the encoding extensions (meshopt, quantisation) and the
 * generator left out. Then every mesh's stored values, attributes and
 * morph targets and indices, number for number (NaN equal only to NaN):
 * the same content baked twice stores the same integers. The
 * EXT_structural_metadata tables row by row; the images' bytes.
 *
 * With `within` (metres) and `withinUnit` (a distance between unit
 * vectors): POSITION, NORMAL and TANGENT of every node's mesh — a node in
 * no scene included — are compared placed in the world, each vertex
 * within its tolerance (0 when not given), the winding by the sign of the
 * node's determinant; their accessors' storage and the transforms of the
 * nodes that carry a mesh are then not compared, everything else still
 * exactly. The largest deviation found is kept for the verdict.
 *
 * A glb that cannot be read throws (the caller reports it as unreadable).
 * Build-time only.
 */
import { Logger, NodeIO } from "@gltf-transform/core";
import type { Accessor, Document, Node, Primitive } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { readStructuralMetadata } from "../lib/city/property-table";
import type { StructuralMetadataJson } from "../lib/city/property-table";
import { compareJson, isRecord, MAX_DETAILS, rowsLine } from "./compare-json";
import type { ServedNames } from "./compare-json";
import { readGlb } from "./glb-container";
import { toExtMeshopt } from "./khr-meshopt";

/** A tolerance the caller asked for; absent, everything is exact. */
export interface Tolerance {
  /** metres a placed vertex may move */
  within?: number;
  /** how far a placed unit vector (normal, tangent) may move */
  withinUnit?: number;
}

/** The largest deviation a tolerant comparison found. */
export interface Deviation {
  position: number;
  unit: number;
}

type Json = Record<string, unknown>;

interface RawGltf extends Json {
  accessors?: Json[];
  bufferViews?: { byteLength: number; byteOffset?: number }[];
  extensions?: { EXT_structural_metadata?: StructuralMetadataJson } & Json;
}

/** The attributes compared placed when a tolerance is asked for. */
const PLACED = new Set(["POSITION", "NORMAL", "TANGENT"]);

/** Extensions that say how the bytes are stored, not what they hold. */
const ENCODINGS = new Set([
  "EXT_meshopt_compression",
  "KHR_meshopt_compression",
  "KHR_mesh_quantization",
]);

const TRANSFORM = ["matrix", "rotation", "scale", "translation"];

/** An integer component type's largest value (a normalised value's 1). */
const INT_MAX: Record<number, number> = {
  5120: 127,
  5121: 255,
  5122: 32_767,
  5123: 65_535,
  5125: 4_294_967_295,
};

const without = (o: unknown, keys: readonly string[]): Json =>
  Object.fromEntries(
    Object.entries((o ?? {}) as Json).filter(([key]) => !keys.includes(key))
  );

const listOf = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

const withoutEncodings = (v: unknown): unknown =>
  Array.isArray(v)
    ? (v as string[]).filter((n) => !ENCODINGS.has(n)).sort()
    : v;

// --- the JSON chunk -------------------------------------------------------------

/** How an accessor stores its values: content, compared exactly. */
function storage(raw: RawGltf, index: unknown): unknown {
  const a = typeof index === "number" ? raw.accessors?.[index] : undefined;
  if (!a) {
    return index;
  }
  const sparse = isRecord(a.sparse) ? a.sparse.count : undefined;
  return {
    ...without(a, ["bufferView", "byteOffset", "sparse"]),
    normalized: a.normalized === true,
    ...(sparse === undefined ? {} : { sparse }),
  };
}

/** A primitive's attributes as their storage (or, placed, their names). */
function attributesStorage(raw: RawGltf, attrs: unknown, placed: boolean) {
  return Object.fromEntries(
    Object.entries((attrs ?? {}) as Json).map(([sem, index]) => [
      sem,
      placed && PLACED.has(sem) ? "placed" : storage(raw, index),
    ])
  );
}

function meshesStructure(raw: RawGltf, placed: boolean): Json[] {
  return listOf(raw.meshes).map((mesh) => ({
    ...mesh,
    primitives: listOf(mesh.primitives).map((p) => ({
      ...p,
      attributes: attributesStorage(raw, p.attributes, placed),
      indices: storage(raw, p.indices),
      ...(p.targets === undefined
        ? {}
        : {
            targets: listOf(p.targets).map((t) =>
              attributesStorage(raw, t, false)
            ),
          }),
    })),
  }));
}

/** The metadata extension without the buffer views its columns point at
 *  (their values are compared as the decoded tables). */
function metadataStructure(ext: unknown): unknown {
  if (!isRecord(ext)) {
    return ext;
  }
  return {
    ...ext,
    propertyTables: listOf(ext.propertyTables).map((t) => ({
      ...t,
      properties: Object.fromEntries(
        Object.entries((t.properties ?? {}) as Json).map(([k, column]) => [
          k,
          without(column, ["values", "arrayOffsets", "stringOffsets"]),
        ])
      ),
    })),
  };
}

/**
 * A glb's JSON chunk without what is decoded and compared on its own: the
 * accessors stand as their storage where a primitive reads them, the
 * buffer views and buffers go (their bytes are the values, tables and
 * images), the encoding extensions and the generator go. Placed (a
 * tolerance asked for), the placed attributes' storage and the transforms
 * of the nodes that carry a mesh go too.
 */
export function glbStructure(raw: RawGltf, placed = false): unknown {
  const extensions = isRecord(raw.extensions)
    ? {
        ...raw.extensions,
        EXT_structural_metadata: metadataStructure(
          raw.extensions.EXT_structural_metadata
        ),
      }
    : raw.extensions;
  return {
    ...without(raw, ["accessors", "bufferViews", "buffers"]),
    asset: without(raw.asset, ["generator"]),
    extensions,
    extensionsRequired: withoutEncodings(raw.extensionsRequired),
    extensionsUsed: withoutEncodings(raw.extensionsUsed),
    images: listOf(raw.images).map((image) => without(image, ["bufferView"])),
    meshes: meshesStructure(raw, placed),
    nodes: listOf(raw.nodes).map((node) =>
      placed && node.mesh !== undefined ? without(node, TRANSFORM) : node
    ),
  };
}

// --- stored values ----------------------------------------------------------------

/** An accessor's values as stored (integers stay integers). */
function stored(accessor: Accessor | null): Float64Array {
  const array = accessor?.getArray();
  return array ? Float64Array.from(array) : new Float64Array(0);
}

/** Two numbers the same: NaN only with NaN. */
const same = (a: number, b: number): boolean =>
  a === b || (Number.isNaN(a) && Number.isNaN(b));

/** Two stored arrays compared number for number. */
function storedLine(name: string, a: Float64Array, b: Float64Array): string[] {
  if (a.length !== b.length) {
    return [`${name}: ${a.length} values in a, ${b.length} in b`];
  }
  let count = 0;
  let first = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (!same(a[i], b[i])) {
      count += 1;
      first = first < 0 ? i : first;
    }
  }
  return count === 0
    ? []
    : [
        `${name}: ${count} values differ (first at ${first}: ${a[first]} → ${b[first]})`,
      ];
}

/** A primitive's stored arrays by name: attributes, morph targets
 *  (`target<n>.<semantic>`) and `indices`. */
function primitiveValues(prim: Primitive, placed: boolean) {
  const out = new Map<string, Float64Array>();
  for (const sem of prim.listSemantics()) {
    if (!(placed && PLACED.has(sem))) {
      out.set(sem, stored(prim.getAttribute(sem)));
    }
  }
  for (const [t, target] of prim.listTargets().entries()) {
    for (const sem of target.listSemantics()) {
      out.set(`target${t}.${sem}`, stored(target.getAttribute(sem)));
    }
  }
  out.set("indices", stored(prim.getIndices()));
  return out;
}

// --- placed values ------------------------------------------------------------------

/** An accessor's values decoded (a normalised integer as its float). */
function decoded(accessor: Accessor | null): Float64Array {
  const array = accessor?.getArray();
  const values = new Float64Array(array?.length ?? 0);
  if (!(accessor && array)) {
    return values;
  }
  const max = INT_MAX[accessor.getComponentType()];
  const normalized = accessor.getNormalized() && max !== undefined;
  for (let i = 0; i < values.length; i += 1) {
    values[i] = normalized ? Math.max(array[i] / max, -1) : array[i];
  }
  return values;
}

type M4 = readonly number[];

/** The upper 3×3's inverse transpose (column-major), for normals. */
function normalMatrix(m: M4): number[] {
  const [a, b, c, d, e, f, g, h, i] = [
    m[0],
    m[1],
    m[2],
    m[4],
    m[5],
    m[6],
    m[8],
    m[9],
    m[10],
  ];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const k = det === 0 ? 0 : 1 / det;
  // the cofactor matrix over the determinant is the inverse transpose
  return [
    (e * i - f * h) * k,
    (g * f - d * i) * k,
    (d * h - g * e) * k,
    (h * c - b * i) * k,
    (a * i - g * c) * k,
    (g * b - a * h) * k,
    (b * f - e * c) * k,
    (d * c - a * f) * k,
    (a * e - d * b) * k,
  ];
}

const determinant = (m: M4): number =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) -
  m[4] * (m[1] * m[10] - m[2] * m[9]) +
  m[8] * (m[1] * m[6] - m[2] * m[5]);

/** Each vertex's xyz through a 3×3 (column-major) plus `offset`,
 *  normalised when `unit`. */
function through(
  v: Float64Array,
  size: number,
  m: readonly number[],
  stride: number,
  offset: readonly number[],
  unit: boolean
): Float64Array {
  const out = new Float64Array((v.length / size) * 3);
  for (let i = 0, o = 0; i < v.length; i += size, o += 3) {
    const [x, y, z] = [v[i], v[i + 1], v[i + 2]];
    for (let r = 0; r < 3; r += 1) {
      out[o + r] =
        m[r] * x + m[stride + r] * y + m[2 * stride + r] * z + offset[r];
    }
    const n = unit ? Math.hypot(out[o], out[o + 1], out[o + 2]) : 1;
    for (let r = 0; r < 3; r += 1) {
      out[o + r] /= n === 0 ? 1 : n;
    }
  }
  return out;
}

interface Placed {
  /** the sign of the node's determinant: its winding */
  winding: number;
  where: string;
  vectors: Map<string, Float64Array>;
}

/** Every node's mesh placed in the world, a node in no scene included. */
function placedOf(doc: Document): Placed[] {
  const out: Placed[] = [];
  for (const [n, node] of doc.getRoot().listNodes().entries()) {
    const mesh = node.getMesh();
    for (const [k, prim] of (mesh?.listPrimitives() ?? []).entries()) {
      out.push(placedPrimitive(node, prim, `node ${n}#${k}`));
    }
  }
  return out;
}

function placedPrimitive(node: Node, prim: Primitive, where: string): Placed {
  const m = node.getWorldMatrix();
  const nm = normalMatrix(m);
  const vectors = new Map<string, Float64Array>();
  const position = prim.getAttribute("POSITION");
  const normal = prim.getAttribute("NORMAL");
  const tangent = prim.getAttribute("TANGENT");
  if (position) {
    vectors.set(
      "POSITION",
      through(decoded(position), 3, m, 4, [m[12], m[13], m[14]], false)
    );
  }
  if (normal) {
    vectors.set("NORMAL", through(decoded(normal), 3, nm, 3, [0, 0, 0], true));
  }
  if (tangent) {
    vectors.set(
      "TANGENT",
      through(decoded(tangent), tangent.getElementSize(), m, 4, [0, 0, 0], true)
    );
  }
  return { winding: Math.sign(determinant(m)), where, vectors };
}

/** Two placed vector lists within `tol`; the largest distance found. */
function vectorsLine(
  name: string,
  a: Float64Array,
  b: Float64Array,
  tol: number
): { lines: string[]; most: number } {
  if (a.length !== b.length) {
    return {
      lines: [`${name}: ${a.length / 3} vertices in a, ${b.length / 3} in b`],
      most: 0,
    };
  }
  let most = 0;
  let count = 0;
  let first = -1;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
    // NaN against a number is a difference; NaN against NaN is not
    const nan = Number.isNaN(d) && !(Number.isNaN(a[i]) && Number.isNaN(b[i]));
    if (nan || d > tol) {
      count += 1;
      first = first < 0 ? i : first;
    }
    most = Number.isNaN(d) ? most : Math.max(most, d);
  }
  const at = (v: Float64Array) =>
    `(${Array.from(v.subarray(first, first + 3), (x) => +x.toFixed(4)).join(", ")})`;
  const lines =
    count === 0
      ? []
      : [
          `${name}: ${count} vertices beyond ${tol} (vertex ${first / 3}: ${at(a)} → ${at(b)})`,
        ];
  return { lines, most };
}

// --- the glb ------------------------------------------------------------------------

/** A glb's property tables, row by row in each column. */
function propertyTables(raw: RawGltf, bin: Uint8Array): unknown[] {
  const ext = raw.extensions?.EXT_structural_metadata;
  if (!ext) {
    return [];
  }
  const views = new Map<number, ArrayBuffer>();
  const view = (i: number): ArrayBuffer | undefined => {
    const v = raw.bufferViews?.[i];
    if (v && !views.has(i)) {
      const at = v.byteOffset ?? 0;
      views.set(i, new Uint8Array(bin.subarray(at, at + v.byteLength)).buffer);
    }
    return views.get(i);
  };
  const { tableAccessors } = readStructuralMetadata(ext, view);
  return tableAccessors.map((table) => {
    const columns: Record<string, unknown[]> = {};
    for (const name of Object.keys(table.properties).sort()) {
      columns[name] = Array.from({ length: table.count }, (_, row) =>
        table.getPropertyValue(name, row)
      );
    }
    return columns;
  });
}

let reader: Promise<NodeIO> | undefined;

/** gltf-transform's reader, with the decoders our glbs need. */
async function glbReader(): Promise<NodeIO> {
  reader ??= MeshoptDecoder.ready.then(() =>
    new NodeIO()
      // it reads no EXT_mesh_features or EXT_structural_metadata (compared
      // here from the glb's JSON): its warning that it drops them is noise
      .setLogger(new Logger(Logger.Verbosity.ERROR))
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
  );
  return await reader;
}

export interface GlbContent {
  images: string[];
  /** per mesh, per primitive: the stored arrays by name */
  meshes: Map<string, Float64Array>[][];
  placed: Placed[];
  structure: unknown;
  tables: unknown[];
}

/** A glb read: what is compared of it (throws when it cannot be read). */
export async function readGlbContent(
  glb: Uint8Array,
  tolerant: boolean
): Promise<GlbContent> {
  const { json, bin } = readGlb<RawGltf>(glb);
  const io = await glbReader();
  const doc = await io.readBinary(toExtMeshopt(glb));
  const meshes = doc.getRoot().listMeshes();
  if (meshes.length !== listOf(json.meshes).length) {
    throw new Error("glb: the decoded meshes are not the JSON's");
  }
  return {
    images: doc
      .getRoot()
      .listTextures()
      .map((t) => Buffer.from(t.getImage() ?? []).toString("base64")),
    meshes: meshes.map((mesh) =>
      mesh.listPrimitives().map((p) => primitiveValues(p, tolerant))
    ),
    placed: tolerant ? placedOf(doc) : [],
    structure: glbStructure(json, tolerant),
    tables: propertyTables(json, bin),
  };
}

/** Is a tolerance asked for? */
export const tolerant = (t: Tolerance): boolean =>
  t.within !== undefined || t.withinUnit !== undefined;

function meshLines(a: GlbContent, b: GlbContent): string[] {
  const out: string[] = [];
  for (const [m, prims] of a.meshes.entries()) {
    for (const [p, values] of prims.entries()) {
      const other = b.meshes[m]?.[p] ?? new Map<string, Float64Array>();
      for (const name of new Set([...values.keys(), ...other.keys()])) {
        const [x, y] = [values.get(name), other.get(name)];
        out.push(
          ...(x && y
            ? storedLine(`mesh ${m}#${p} ${name}`, x, y)
            : [`mesh ${m}#${p} ${name}: only in ${x ? "a" : "b"}`])
        );
      }
    }
  }
  return out;
}

function placedLines(
  a: GlbContent,
  b: GlbContent,
  t: Tolerance,
  deviation: Deviation
): string[] {
  if (a.placed.length !== b.placed.length) {
    return [
      `${a.placed.length} placed primitives in a, ${b.placed.length} in b`,
    ];
  }
  const out: string[] = [];
  for (const [i, pa] of a.placed.entries()) {
    const pb = b.placed[i];
    if (pa.winding !== pb.winding) {
      out.push(`${pa.where}: the winding turns over`);
    }
    for (const name of new Set([...pa.vectors.keys(), ...pb.vectors.keys()])) {
      const [x, y] = [pa.vectors.get(name), pb.vectors.get(name)];
      if (!(x && y)) {
        out.push(`${pa.where} ${name}: only in ${x ? "a" : "b"}`);
        continue;
      }
      const unit = name !== "POSITION";
      const tol = (unit ? t.withinUnit : t.within) ?? 0;
      const { lines, most } = vectorsLine(`${pa.where} ${name}`, x, y, tol);
      out.push(...lines);
      deviation[unit ? "unit" : "position"] = Math.max(
        deviation[unit ? "unit" : "position"],
        most
      );
    }
  }
  return out;
}

/** Two glbs compared by content; the largest placed deviation goes into
 *  `deviation`. Throws when either cannot be read. */
export async function compareGlbs(
  a: Uint8Array,
  b: Uint8Array,
  served: [ServedNames, ServedNames],
  t: Tolerance,
  deviation: Deviation
): Promise<string[]> {
  const placed = tolerant(t);
  const [ca, cb] = await Promise.all([
    readGlbContent(a, placed),
    readGlbContent(b, placed),
  ]);
  const out = compareJson(ca.structure, cb.structure, ...served);
  out.push(
    ...compareJson(ca.tables, cb.tables, ...served).map(
      (line) => `property table ${line}`
    ),
    ...(ca.meshes.length === cb.meshes.length
      ? meshLines(ca, cb)
      : [`${ca.meshes.length} meshes in a, ${cb.meshes.length} in b`]),
    ...(placed ? placedLines(ca, cb, t, deviation) : []),
    ...rowsLine("images: ", ca.images, cb.images, "images")
  );
  return out.slice(0, MAX_DETAILS);
}
