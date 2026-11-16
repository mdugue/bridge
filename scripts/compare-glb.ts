/**
 * The glTF half of scripts/compare-tilesets.ts: two glbs compared by
 * content. Exact unless the caller asks for a tolerance; the file under
 * test never sets one.
 *
 * Exact (the default): the whole JSON chunk but for what is decoded and
 * compared on its own. Every accessor stands as its storage (component
 * type, normalised, type, count, min, max, sparse count) — where a
 * primitive reads it, there; any other (an animation's, an instancing
 * extension's) by its index — so another quantisation is a difference;
 * the node transforms as they are; the encoding extensions (meshopt,
 * quantisation) and the generator left out. Then every accessor's stored
 * values, number for number (NaN equal only to NaN): the same content
 * baked twice stores the same integers. The EXT_structural_metadata
 * tables row by row; the images' bytes.
 *
 * With `within` (metres) and `withinUnit` (a distance between unit
 * vectors): POSITION, NORMAL and TANGENT of every mesh a node draws — a
 * node in no scene included — are compared placed in the world, each
 * vertex within its tolerance (0 when not given) by the Euclidean
 * distance over the components that are numbers on both sides (NaN only
 * against NaN); a normal's and a tangent's stored length within
 * `withinUnit`, a tangent's handedness (w, as the world sees it) and the
 * winding (the sign of the node's determinant) exactly. Those accessors'
 * storage and the transforms of the nodes that carry a mesh are then not
 * compared; everything else still exactly, a mesh no node draws included.
 * The largest deviation found is kept for the verdict.
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

/** The meshes some node draws: only those are placed. */
function drawnMeshes(raw: RawGltf): Set<number> {
  return new Set(
    listOf(raw.nodes)
      .map((node) => node.mesh)
      .filter((m): m is number => typeof m === "number")
  );
}

/** The accessors a mesh primitive reads (attributes, indices, targets). */
function primitiveAccessors(raw: RawGltf): Set<number> {
  const out = new Set<number>();
  const add = (v: unknown) => {
    if (typeof v === "number") {
      out.add(v);
    }
  };
  for (const mesh of listOf(raw.meshes)) {
    for (const p of listOf(mesh.primitives)) {
      for (const v of [
        ...Object.values((p.attributes ?? {}) as Json),
        p.indices,
        ...listOf(p.targets).flatMap((t) => Object.values(t)),
      ]) {
        add(v);
      }
    }
  }
  return out;
}

/** Every accessor no primitive reads (an animation's, an extension's),
 *  as its storage by index: compared exactly whoever reads it. */
function otherAccessors(raw: RawGltf): Json {
  const read = primitiveAccessors(raw);
  return Object.fromEntries(
    (raw.accessors ?? []).flatMap((_, i) =>
      read.has(i) ? [] : [[String(i), storage(raw, i)]]
    )
  );
}

function meshesStructure(raw: RawGltf, placed: boolean): Json[] {
  const drawn = drawnMeshes(raw);
  return listOf(raw.meshes).map((mesh, m) => ({
    ...mesh,
    primitives: listOf(mesh.primitives).map((p) => ({
      ...p,
      attributes: attributesStorage(raw, p.attributes, placed && drawn.has(m)),
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
 * accessors stand as their storage (where a primitive reads them, there;
 * the rest by index, so an animation's or an instancing extension's are
 * compared too), the
 * buffer views and buffers go (their bytes are the values, tables and
 * images), the encoding extensions and the generator go. Placed (a
 * tolerance asked for), the placed attributes' storage of every mesh a
 * node draws and the transforms of the nodes that carry a mesh go too.
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
    accessors: otherAccessors(raw),
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

const term = (k: number, v: number): number => (k === 0 ? 0 : k * v);

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
      // a zero coefficient takes nothing of its component: a NaN in x
      // must not make y NaN too (0 × NaN is NaN)
      out[o + r] =
        term(m[r], x) +
        term(m[stride + r], y) +
        term(m[2 * stride + r], z) +
        offset[r];
    }
    const n = unit ? Math.hypot(out[o], out[o + 1], out[o + 2]) : 1;
    for (let r = 0; r < 3; r += 1) {
      out[o + r] /= n === 0 ? 1 : n;
    }
  }
  return out;
}

interface Placed {
  /** values compared exactly: a tangent's handedness in the world */
  exact: Map<string, Float64Array>;
  /** a normal's or tangent's stored length, within the unit tolerance */
  lengths: Map<string, Float64Array>;
  /** the sign of the node's determinant: its winding */
  winding: number;
  where: string;
  vectors: Map<string, Float64Array>;
}

/** Each vertex's xyz length (of `size` components a vertex). */
function lengthsOf(v: Float64Array, size: number): Float64Array {
  const out = new Float64Array(v.length / size);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.hypot(v[i * size], v[i * size + 1], v[i * size + 2]);
  }
  return out;
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
  const lengths = new Map<string, Float64Array>();
  const exact = new Map<string, Float64Array>();
  const winding = Math.sign(determinant(m));
  const position = prim.getAttribute("POSITION");
  const normal = decoded(prim.getAttribute("NORMAL"));
  const tangent = prim.getAttribute("TANGENT");
  if (position) {
    vectors.set(
      "POSITION",
      through(decoded(position), 3, m, 4, [m[12], m[13], m[14]], false)
    );
  }
  if (normal.length > 0) {
    vectors.set("NORMAL", through(normal, 3, nm, 3, [0, 0, 0], true));
    lengths.set("NORMAL", lengthsOf(normal, 3));
  }
  if (tangent) {
    const size = tangent.getElementSize();
    const t = decoded(tangent);
    vectors.set("TANGENT", through(t, size, m, 4, [0, 0, 0], true));
    lengths.set("TANGENT", lengthsOf(t, size));
    // the handedness, as the world sees it
    exact.set(
      "TANGENT.w",
      Float64Array.from({ length: t.length / size }, (_, i) =>
        size === 4 ? t[i * 4 + 3] * winding : 0
      )
    );
  }
  return { exact, lengths, winding, where, vectors };
}

/** The Euclidean distance between two vertices of `dims` components, over
 *  the components that are numbers on both sides; NaN when a component is
 *  NaN on one side only (NaN against NaN is the same). */
function distance(a: Float64Array, b: Float64Array, i: number, dims: number) {
  let sum = 0;
  for (let k = i; k < i + dims; k += 1) {
    const [x, y] = [Number.isNaN(a[k]), Number.isNaN(b[k])];
    if (x !== y) {
      return Number.NaN;
    }
    sum += x ? 0 : (a[k] - b[k]) ** 2;
  }
  return Math.sqrt(sum);
}

/** Two placed lists (vectors of `dims` components) within `tol`; the
 *  largest distance found. */
function vectorsLine(
  name: string,
  a: Float64Array,
  b: Float64Array,
  tol: number,
  dims = 3
): { lines: string[]; most: number } {
  if (a.length !== b.length) {
    return {
      lines: [
        `${name}: ${a.length / dims} vertices in a, ${b.length / dims} in b`,
      ],
      most: 0,
    };
  }
  let most = 0;
  let count = 0;
  let first = -1;
  for (let i = 0; i < a.length; i += dims) {
    const d = distance(a, b, i, dims);
    if (Number.isNaN(d) || d > tol) {
      count += 1;
      first = first < 0 ? i : first;
    }
    most = Number.isNaN(d) ? most : Math.max(most, d);
  }
  const at = (v: Float64Array) =>
    `(${Array.from(v.subarray(first, first + dims), (x) => +x.toFixed(4)).join(", ")})`;
  const lines =
    count === 0
      ? []
      : [
          `${name}: ${count} vertices beyond ${tol} (vertex ${first / dims}: ${at(a)} → ${at(b)})`,
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
  /** the stored values of the accessors no primitive reads, by index */
  accessors: Map<number, Float64Array>;
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
  const accessors = doc.getRoot().listAccessors();
  if (
    meshes.length !== listOf(json.meshes).length ||
    accessors.length !== (json.accessors ?? []).length
  ) {
    throw new Error("glb: the decoded meshes or accessors are not the JSON's");
  }
  const drawn = drawnMeshes(json);
  const read = primitiveAccessors(json);
  return {
    accessors: new Map(
      accessors.flatMap((a, i) =>
        read.has(i) ? [] : [[i, stored(a)] as const]
      )
    ),
    images: doc
      .getRoot()
      .listTextures()
      .map((t) => Buffer.from(t.getImage() ?? []).toString("base64")),
    meshes: meshes.map((mesh, m) =>
      mesh
        .listPrimitives()
        .map((p) => primitiveValues(p, tolerant && drawn.has(m)))
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

function accessorLines(a: GlbContent, b: GlbContent): string[] {
  const out: string[] = [];
  for (const [i, x] of a.accessors) {
    const y = b.accessors.get(i);
    out.push(...(y ? storedLine(`accessor ${i}`, x, y) : []));
  }
  return out;
}

/** One placed primitive against another. */
function placedPair(
  pa: Placed,
  pb: Placed,
  t: Tolerance,
  deviation: Deviation
): string[] {
  const out: string[] = [];
  if (pa.winding !== pb.winding) {
    out.push(`${pa.where}: the winding turns over`);
  }
  const lists: [
    Map<string, Float64Array>,
    Map<string, Float64Array>,
    number,
  ][] = [
    [pa.vectors, pb.vectors, 3],
    [pa.lengths, pb.lengths, 1],
  ];
  for (const [ma, mb, dims] of lists) {
    for (const name of new Set([...ma.keys(), ...mb.keys()])) {
      const [x, y] = [ma.get(name), mb.get(name)];
      const label = `${pa.where} ${name}${dims === 1 ? " length" : ""}`;
      if (!(x && y)) {
        out.push(`${label}: only in ${x ? "a" : "b"}`);
        continue;
      }
      const unit = name !== "POSITION";
      const tol = (unit ? t.withinUnit : t.within) ?? 0;
      const { lines, most } = vectorsLine(label, x, y, tol, dims);
      out.push(...lines);
      const key = unit ? "unit" : "position";
      deviation[key] = Math.max(deviation[key], most);
    }
  }
  for (const [name, x] of pa.exact) {
    const y = pb.exact.get(name) ?? new Float64Array(0);
    out.push(...storedLine(`${pa.where} ${name}`, x, y));
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
  return a.placed.flatMap((pa, i) => placedPair(pa, b.placed[i], t, deviation));
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
    ...accessorLines(ca, cb),
    ...(placed ? placedLines(ca, cb, t, deviation) : []),
    ...rowsLine("images: ", ca.images, cb.images, "images")
  );
  return out.slice(0, MAX_DETAILS);
}
