/**
 * Two published sites compared by content (plan 087, phase 5): the proof a
 * change that gives up byte-identical bakes (plan 092) still publishes the
 * same city. A site is a `public/data/<site>` folder (its `manifest.json`
 * and the unhashed files beside it) or one manifest file (what it names);
 * files are matched by their logical names (ADR 0024).
 *
 * The rule: everything is compared exactly unless it is declared here as
 * tolerant, and a file that cannot be read is different, never equal.
 *
 * - The same served name is the same file once both copies are read and
 *   their bytes agree; a named file missing on either side differs.
 * - A glb (`.glb.gz`): its whole JSON chunk, but for what is decoded and
 *   compared on its own (accessors, buffer views, buffers, the encoding
 *   extensions, the generator, the transforms of the nodes that carry a
 *   mesh); each primitive's decoded attributes in order — POSITION in the
 *   node's frame and NORMAL and TANGENT within the coarser side's
 *   quantisation step (the only tolerant fields: measurements), every
 *   other attribute (ids, packed codes) exactly, NaN equal only to NaN —
 *   its indices exactly, its EXT_structural_metadata tables row by row,
 *   its images' bytes.
 * - A raster (`.png` through lib/city/png-raster.ts, `.webp` through
 *   sharp's raw decode): the decoded values, cell by cell.
 * - JSON and GeoJSON: the order of an object's keys is ignored, the order
 *   of an array never (rows are referenced by position: a markings raster
 *   by `1 + row`, `treefacts_<tile>.json` by the trees' feature index,
 *   the trams' profiles by pattern index); a served name is read as its
 *   logical name, marked as served, so a tileset naming a changed file is
 *   not itself named, and an unhashed name stays different from a served
 *   one. Records only in another order are reported as such.
 * - The packed binaries through their readers in lib/city/, in order: the
 *   canopy points (`.pts`), the coarse crowns (`.crw`), the footprints
 *   (`.fpr`), the ground plate (`plate.bin`) tile by tile.
 * - Anything else as bytes. A new kind of published file needs its reader
 *   here, or it compares as bytes only.
 *
 *   bun scripts/compare-tilesets.ts <site-a> <site-b>
 *     prints each file that differs and how, then a count; exit 0 when the
 *     sites hold the same, 1 when a file differs or is in one site only,
 *     2 when a site cannot be read or names no file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Logger, NodeIO } from "@gltf-transform/core";
import type { Accessor, Document, Node, Primitive } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { unpackCrowns } from "../lib/city/coarse-crowns";
import { readFootprints, unpackedFootprints } from "../lib/city/footprint-pack";
import { decodePlate, plateOf } from "../lib/city/ground-plate";
import type { PlateRef } from "../lib/city/ground-plate";
import { unpackPoints } from "../lib/city/point-pack";
import { decodeGreyPng } from "../lib/city/png-raster";
import { readStructuralMetadata } from "../lib/city/property-table";
import type { StructuralMetadataJson } from "../lib/city/property-table";
import { MANIFEST_FILE } from "../lib/city/tile";
import { readGlb } from "./glb-container";
import { toExtMeshopt } from "./khr-meshopt";

/** How many lines a differing file reports at most. */
const MAX_DETAILS = 5;
/** How many characters of a value a line quotes. */
const QUOTE = 160;
/** A published name with its content hash (`publisher.ts` `hashedName`). */
const HASHED = /\.[0-9a-f]{8}(?:\.[^.]+)+$/u;
/** How a served name reads once canonical: never equal to a literal. */
const SERVED = "⟪served⟫";

/** One published site: each logical name and the file it is served as. */
export interface PublishedSite {
  dir: string;
  /** logical name → file name in `dir` */
  files: Map<string, string>;
  /** a served (hashed) name → its logical name */
  logical: Map<string, string>;
}

/** What two sites' comparison found. */
export interface SiteComparison {
  /** logical name → what differs (one line or more) */
  differs: Map<string, string[]>;
  equalByContent: number;
  equalByHash: number;
  onlyA: string[];
  onlyB: string[];
}

/** A manifest's files, or an error saying why it is not one. */
function manifestFiles(file: string): Map<string, string> {
  const doc = JSON.parse(readFileSync(file, "utf-8")) as unknown;
  const files = (doc as { files?: unknown } | null)?.files;
  if (
    (doc as { version?: unknown } | null)?.version !== 1 ||
    typeof files !== "object" ||
    files === null
  ) {
    throw new Error(`${file}: not a manifest (version 1, files)`);
  }
  const out = new Map<string, string>();
  for (const [name, served] of Object.entries(files)) {
    if (typeof served !== "string") {
      throw new Error(`${file}: ${name} is not served under a name`);
    }
    out.set(name, served);
  }
  return out;
}

/**
 * A site from its manifest file (what it names, nothing else) or its
 * folder (its `manifest.json`, and the unhashed files beside it, such as
 * the start page's `site-stats.json`). A folder without a manifest is an
 * error, not a listing.
 */
export function readSite(where: string): PublishedSite {
  const isFile = existsSync(where) && statSync(where).isFile();
  const dir = isFile ? path.dirname(where) : where;
  const manifest = isFile ? where : path.join(dir, MANIFEST_FILE);
  if (!existsSync(manifest)) {
    throw new Error(`${where}: no ${MANIFEST_FILE}`);
  }
  const files = manifestFiles(manifest);
  if (!isFile) {
    const served = new Set(files.values());
    for (const file of readdirSync(dir)) {
      const beside =
        file !== MANIFEST_FILE &&
        !served.has(file) &&
        !HASHED.test(file) &&
        !file.endsWith(".part");
      if (beside && statSync(path.join(dir, file)).isFile()) {
        files.set(file, file);
      }
    }
  }
  const logical = new Map<string, string>();
  for (const [name, file] of files) {
    if (name !== file) {
      logical.set(file, name);
    }
  }
  return { dir, files, logical };
}

function quote(value: unknown): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
  return text.length > QUOTE ? `${text.slice(0, QUOTE)}…` : text;
}

const asJson = (v: unknown): string => JSON.stringify(v) ?? "undefined";

// --- rows: in order, with a word on what differs ------------------------------

/** The rows only in `a` and only in `b`, each row once per copy. */
export function multisetDiff(
  a: readonly string[],
  b: readonly string[]
): { onlyA: string[]; onlyB: string[] } {
  const left = new Map<string, number>();
  for (const row of a) {
    left.set(row, (left.get(row) ?? 0) + 1);
  }
  const onlyB: string[] = [];
  for (const row of b) {
    const n = left.get(row) ?? 0;
    if (n > 0) {
      left.set(row, n - 1);
    } else {
      onlyB.push(row);
    }
  }
  const onlyA = [...left].flatMap(([row, n]) =>
    Array.from({ length: n }, () => row)
  );
  return { onlyA, onlyB };
}

/** Two lists of rows compared in order: none when equal, else one line —
 *  the same rows in another order, or what is in one list only. */
function rowsLine(
  where: string,
  a: readonly string[],
  b: readonly string[],
  noun = "records"
): string[] {
  if (a.length === b.length && a.every((row, i) => row === b[i])) {
    return [];
  }
  const { onlyA, onlyB } = multisetDiff(a, b);
  if (onlyA.length === 0 && onlyB.length === 0) {
    return [`${where}the same ${a.length} ${noun} in another order`];
  }
  const examples = [
    onlyA.length > 0 ? `a: ${quote(onlyA[0])}` : "",
    onlyB.length > 0 ? `b: ${quote(onlyB[0])}` : "",
  ].filter(Boolean);
  return [
    `${where}${onlyA.length} ${noun} only in a, ${onlyB.length} only in b (${examples.join("; ")})`,
  ];
}

// --- JSON: keys unordered, arrays in order, served names marked --------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A string that names a served file, as that file's logical name marked
 *  as served; any other string as it is. */
function logicalString(s: string, site: PublishedSite): string {
  const slash = s.lastIndexOf("/");
  const base = site.logical.get(s.slice(slash + 1));
  return base === undefined ? s : `${SERVED}${s.slice(0, slash + 1)}${base}`;
}

/** `value` in a form whose JSON is the same for the same content: keys
 *  sorted, arrays as they are, served names as marked logical names. */
export function canonical(value: unknown, site: PublishedSite): unknown {
  if (typeof value === "string") {
    return logicalString(value, site);
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonical(v, site));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonical(value[key], site);
    }
    return out;
  }
  return value;
}

/** Where two canonical arrays differ. */
function arrayDiff(a: unknown[], b: unknown[], at: string, out: string[]) {
  const where = at === "" ? "" : `${at}: `;
  const rowsA = a.map(asJson);
  const rowsB = b.map(asJson);
  const { onlyA, onlyB } = multisetDiff(rowsA, rowsB);
  const reordered = onlyA.length === 0 && onlyB.length === 0;
  if (a.length === b.length && !reordered) {
    for (const [i, v] of a.entries()) {
      jsonDiff(v, b[i], `${at}[${i}]`, out);
    }
    return;
  }
  out.push(...rowsLine(where, rowsA, rowsB, "items"));
}

/** Where two canonical values differ, as up to MAX_DETAILS lines. */
function jsonDiff(a: unknown, b: unknown, at: string, out: string[]): void {
  if (out.length >= MAX_DETAILS || asJson(a) === asJson(b)) {
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    arrayDiff(a, b, at, out);
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = at === "" ? key : `${at}.${key}`;
      if (!Object.hasOwn(b, key)) {
        out.push(`${next}: only in a`);
      } else if (Object.hasOwn(a, key)) {
        jsonDiff(a[key], b[key], next, out);
      } else {
        out.push(`${next}: only in b`);
      }
    }
    return;
  }
  out.push(`${at === "" ? "" : `${at}: `}${quote(a)} → ${quote(b)}`);
}

/** Two JSON documents compared, as lines (none: the same content). */
export function compareJson(
  a: unknown,
  b: unknown,
  siteA: PublishedSite,
  siteB: PublishedSite
): string[] {
  const out: string[] = [];
  jsonDiff(canonical(a, siteA), canonical(b, siteB), "", out);
  return out;
}

// --- rasters -------------------------------------------------------------------

interface Raster {
  channels: number;
  data: Uint8Array;
  height: number;
  width: number;
}

async function decodeRaster(bytes: Uint8Array, png: boolean): Promise<Raster> {
  if (png) {
    try {
      const grey = await decodeGreyPng(bytes);
      return { ...grey, channels: 1 };
    } catch {
      // not 8-bit grey: sharp's decode below
    }
  }
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    channels: info.channels,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    height: info.height,
    width: info.width,
  };
}

/** Two rasters' decoded values compared cell by cell. */
export async function compareRasters(
  a: Uint8Array,
  b: Uint8Array,
  png: boolean
): Promise<string[]> {
  const [ra, rb] = await Promise.all([
    decodeRaster(a, png),
    decodeRaster(b, png),
  ]);
  if (
    ra.width !== rb.width ||
    ra.height !== rb.height ||
    ra.channels !== rb.channels
  ) {
    return [
      `${ra.width}×${ra.height}×${ra.channels} in a, ${rb.width}×${rb.height}×${rb.channels} in b`,
    ];
  }
  let cells = 0;
  let first = -1;
  let most = 0;
  for (let i = 0; i < ra.data.length; i += 1) {
    const d = Math.abs(ra.data[i] - rb.data[i]);
    if (d > 0) {
      cells += 1;
      most = Math.max(most, d);
      first = first < 0 ? i : first;
    }
  }
  if (cells === 0) {
    return [];
  }
  const cell = Math.floor(first / ra.channels);
  return [
    `${cells} of ${ra.data.length} values differ, by up to ${most} (first at column ${cell % ra.width}, row ${Math.floor(cell / ra.width)}: ${ra.data[first]} → ${rb.data[first]})`,
  ];
}

// --- glTF ----------------------------------------------------------------------

type Json = Record<string, unknown>;

interface RawGltf extends Json {
  bufferViews?: { byteLength: number; byteOffset?: number }[];
  extensions?: { EXT_structural_metadata?: StructuralMetadataJson } & Json;
}

/** One decoded attribute: its values and each component's tolerance. */
export interface Attribute {
  size: number;
  tolerance: number[];
  values: Float64Array;
}

interface PrimitiveContent {
  attributes: Map<string, Attribute>;
  indices: Uint32Array | null;
  where: string;
}

/** The attributes that are measurements: compared within a quantisation
 *  step. Every other attribute (feature ids, packed codes such as the
 *  facades' `_FACADE`) is compared exactly. */
const MEASURED = new Set(["POSITION", "NORMAL", "TANGENT"]);

/** Extensions that say how the bytes are stored, not what they hold: the
 *  decoded content is compared instead. */
const ENCODINGS = new Set([
  "EXT_meshopt_compression",
  "KHR_meshopt_compression",
  "KHR_mesh_quantization",
]);

/** An integer component type's largest value (a normalised value's 1). */
const INT_MAX: Record<number, number> = {
  5120: 127,
  5121: 255,
  5122: 32_767,
  5123: 65_535,
  5125: 4_294_967_295,
};

/** The decoded values of an accessor, and its step in its own units. */
function decoded(accessor: Accessor): { step: number; values: Float64Array } {
  const array = accessor.getArray();
  const values = new Float64Array(array?.length ?? 0);
  const max = INT_MAX[accessor.getComponentType()];
  const normalized = accessor.getNormalized() && max !== undefined;
  for (let i = 0; i < values.length; i += 1) {
    const v = array?.[i] ?? 0;
    values[i] = normalized ? Math.max(v / max, -1) : v;
  }
  if (max === undefined) {
    return { step: 0, values };
  }
  return { step: normalized ? 1 / max : 1, values };
}

/** Positions in the frame the node puts them in (where quantisation
 *  ends), each axis's tolerance one step of each local axis it reads. */
function placedPositions(accessor: Accessor, node: Node): Attribute {
  const { step, values } = decoded(accessor);
  const m = node.getWorldMatrix();
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i += 3) {
    const [x, y, z] = [values[i], values[i + 1], values[i + 2]];
    for (let r = 0; r < 3; r += 1) {
      out[i + r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
    }
  }
  const tolerance = [0, 1, 2].map(
    (r) => step * (Math.abs(m[r]) + Math.abs(m[4 + r]) + Math.abs(m[8 + r]))
  );
  return { size: 3, tolerance, values: out };
}

function attributeOf(semantic: string, accessor: Accessor, node: Node) {
  if (semantic === "POSITION") {
    return placedPositions(accessor, node);
  }
  const { step, values } = decoded(accessor);
  const size = accessor.getElementSize();
  const tolerance = Array.from({ length: size }, () =>
    MEASURED.has(semantic) && accessor.getNormalized() ? step : 0
  );
  return { size, tolerance, values };
}

/** One primitive of `node`'s mesh, decoded. */
function primitiveContent(
  node: Node,
  prim: Primitive,
  where: string
): PrimitiveContent {
  const attributes = new Map<string, Attribute>();
  for (const semantic of prim.listSemantics().sort()) {
    const accessor = prim.getAttribute(semantic);
    if (accessor) {
      attributes.set(semantic, attributeOf(semantic, accessor, node));
    }
  }
  const index = prim.getIndices()?.getArray();
  return {
    attributes,
    indices: index ? Uint32Array.from(index) : null,
    where,
  };
}

/** Every primitive of the scene, in the order the scene holds them. */
function primitivesOf(doc: Document): PrimitiveContent[] {
  const out: PrimitiveContent[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) {
        return;
      }
      const name = `${node.getName() || "node"}/${mesh.getName() || "mesh"}`;
      for (const [k, prim] of mesh.listPrimitives().entries()) {
        out.push(primitiveContent(node, prim, `${name}#${k}`));
      }
    });
  }
  return out;
}

/** Whether two decoded values agree: NaN only with NaN, else within `tol`. */
function agree(a: number, b: number, tol: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  return tol > 0 ? Math.abs(a - b) <= tol * (1 + 1e-6) + 1e-9 : a === b;
}

/** Two attributes compared value by value, each within the coarser side's
 *  tolerance for its component (0 for anything not measured). */
export function attributeLine(
  name: string,
  a: Attribute,
  b: Attribute
): string[] {
  if (a.size !== b.size || a.values.length !== b.values.length) {
    return [
      `${name}: ${a.values.length / a.size} × ${a.size} in a, ${b.values.length / b.size} × ${b.size} in b`,
    ];
  }
  let count = 0;
  let first = -1;
  for (let i = 0; i < a.values.length; i += 1) {
    const c = i % a.size;
    const tol = Math.max(a.tolerance[c], b.tolerance[c]);
    if (!agree(a.values[i], b.values[i], tol)) {
      count += 1;
      first = first < 0 ? i : first;
    }
  }
  if (count === 0) {
    return [];
  }
  const e = Math.floor(first / a.size) * a.size;
  const element = (v: Float64Array) =>
    `(${Array.from(v.subarray(e, e + a.size), (x) => +x.toFixed(4)).join(", ")})`;
  const beyond = a.tolerance.some((t) => t > 0)
    ? "beyond the quantisation step"
    : "differ";
  return [
    `${name}: ${count} values ${beyond} (vertex ${e / a.size}: ${element(a.values)} → ${element(b.values)})`,
  ];
}

function indicesLine(a: PrimitiveContent, b: PrimitiveContent): string[] {
  const [ia, ib] = [a.indices, b.indices];
  if (!(ia && ib)) {
    return ia === ib ? [] : [`${a.where} indices: only in ${ia ? "a" : "b"}`];
  }
  if (ia.length !== ib.length) {
    return [`${a.where} indices: ${ia.length} in a, ${ib.length} in b`];
  }
  let moved = 0;
  for (let i = 0; i < ia.length; i += 1) {
    moved += ia[i] === ib[i] ? 0 : 1;
  }
  return moved === 0 ? [] : [`${a.where} indices: ${moved} differ`];
}

function primitiveLines(a: PrimitiveContent, b: PrimitiveContent): string[] {
  const out: string[] = [];
  const names = new Set([...a.attributes.keys(), ...b.attributes.keys()]);
  for (const name of names) {
    const [x, y] = [a.attributes.get(name), b.attributes.get(name)];
    if (x && y) {
      out.push(...attributeLine(`${a.where} ${name}`, x, y));
    } else {
      out.push(`${a.where} ${name}: only in ${x ? "a" : "b"}`);
    }
  }
  out.push(...indicesLine(a, b));
  return out;
}

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
      views.set(i, copied(bin.subarray(at, at + v.byteLength)));
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

const without = (o: unknown, keys: readonly string[]): Json =>
  Object.fromEntries(
    Object.entries((o ?? {}) as Json).filter(([key]) => !keys.includes(key))
  );

/** A list of extension names without the encodings, sorted. */
const withoutEncodings = (v: unknown): unknown =>
  Array.isArray(v)
    ? (v as string[]).filter((n) => !ENCODINGS.has(n)).sort()
    : v;

/** The metadata extension without the buffer views its columns point at
 *  (their values are compared as the decoded tables). */
function metadataStructure(ext: unknown): unknown {
  if (!isRecord(ext)) {
    return ext;
  }
  const tables = Array.isArray(ext.propertyTables) ? ext.propertyTables : [];
  return {
    ...ext,
    propertyTables: tables.map((t: Json) => ({
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

const listOf = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

/**
 * A glb's JSON chunk without what is decoded and compared on its own: the
 * accessors, buffer views and buffers (the attributes, indices, tables and
 * images), the encoding extensions, the generator, and the transforms of
 * the nodes that carry a mesh (their positions are compared placed). The
 * attributes stay as their names, the indices as whether there are any;
 * everything else — materials, extras, extensions, names — as it is.
 */
export function glbStructure(raw: Json): unknown {
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
    meshes: listOf(raw.meshes).map((mesh) => ({
      ...mesh,
      primitives: listOf(mesh.primitives).map((p) => ({
        ...p,
        attributes: Object.keys((p.attributes ?? {}) as Json).sort(),
        indices: p.indices !== undefined,
      })),
    })),
    nodes: listOf(raw.nodes).map((node) =>
      node.mesh === undefined
        ? node
        : without(node, ["matrix", "rotation", "scale", "translation"])
    ),
  };
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

/** A glb's content: its structure, its tables, its primitives, its
 *  images' bytes. */
async function glbContent(glb: Uint8Array) {
  const { json, bin } = readGlb<RawGltf>(glb);
  const io = await glbReader();
  const doc = await io.readBinary(toExtMeshopt(glb));
  return {
    images: doc
      .getRoot()
      .listTextures()
      .map((t) => Buffer.from(t.getImage() ?? []).toString("base64")),
    primitives: primitivesOf(doc),
    structure: glbStructure(json),
    tables: propertyTables(json, bin),
  };
}

/** Two glbs compared by content (the sites name the files the extras
 *  name, so a renamed reference is no difference). */
export async function compareGlbs(
  a: Uint8Array,
  b: Uint8Array,
  siteA: PublishedSite,
  siteB: PublishedSite
): Promise<string[]> {
  const [ca, cb] = await Promise.all([glbContent(a), glbContent(b)]);
  const out = compareJson(ca.structure, cb.structure, siteA, siteB);
  out.push(
    ...compareJson(ca.tables, cb.tables, siteA, siteB).map(
      (line) => `property table ${line}`
    )
  );
  if (ca.primitives.length === cb.primitives.length) {
    for (const [k, p] of ca.primitives.entries()) {
      out.push(...primitiveLines(p, cb.primitives[k]));
    }
  } else {
    out.push(
      `${ca.primitives.length} primitives in a, ${cb.primitives.length} in b`
    );
  }
  out.push(...rowsLine("images: ", ca.images, cb.images, "images"));
  return out.slice(0, MAX_DETAILS);
}

// --- the packed binaries, in order ------------------------------------------------

/** The bytes in an ArrayBuffer of their own (a Node Buffer's `slice` is a
 *  view into a shared pool, and its `buffer` the whole pool). */
const copied = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

/** The canopy points: header and points, in order. */
export function comparePoints(a: Uint8Array, b: Uint8Array): string[] | null {
  const [pa, pb] = [unpackPoints(copied(a)), unpackPoints(copied(b))];
  if (!(pa && pb)) {
    return null;
  }
  const rows = (p: NonNullable<typeof pa>): string[] =>
    Array.from({ length: p.count }, (_, i) =>
      Array.from(p.data.subarray(i * p.stride, (i + 1) * p.stride)).join(",")
    );
  const header = (p: NonNullable<typeof pa>) =>
    `stride ${p.stride}, flags ${p.flags}, origin ${p.origin.join(" ")}`;
  const out =
    header(pa) === header(pb) ? [] : [`${header(pa)} → ${header(pb)}`];
  return [...out, ...rowsLine("", rows(pa), rows(pb), "points")];
}

/** The coarse crowns, in order. */
export function compareCrowns(a: Uint8Array, b: Uint8Array): string[] | null {
  const [ca, cb] = [unpackCrowns(copied(a)), unpackCrowns(copied(b))];
  return ca && cb
    ? rowsLine("", ca.map(asJson), cb.map(asJson), "crowns")
    : null;
}

/** The footprints, an object's rings a row, in order. */
export function compareFootprints(
  a: Uint8Array,
  b: Uint8Array
): string[] | null {
  const [fa, fb] = [readFootprints(a), readFootprints(b)];
  const rows = (f: NonNullable<typeof fa>) => unpackedFootprints(f).map(asJson);
  return fa && fb ? rowsLine("", rows(fa), rows(fb), "footprints") : null;
}

/** The plate a site's tileset names (its tiles and grid), if any. */
function plateRef(site: PublishedSite): PlateRef | undefined {
  const file = site.files.get("tileset.json");
  if (!file) {
    return undefined;
  }
  const tileset = JSON.parse(
    readFileSync(path.join(site.dir, file), "utf-8")
  ) as { extras?: unknown };
  return plateOf(tileset.extras);
}

/** A plate's tiles, each a row. */
const plateTiles = (bytes: Uint8Array, ref: PlateRef): string[] =>
  decodePlate(bytes, ref.tiles, ref.n).map((t) =>
    JSON.stringify({
      bounds: t.bounds,
      classes: Array.from(t.classes),
      heights: Array.from(t.heights),
      id: t.id,
    })
  );

/** The ground plate, tile by tile, through each site's tileset. */
export function comparePlates(
  a: Uint8Array,
  b: Uint8Array,
  siteA: PublishedSite,
  siteB: PublishedSite
): string[] | null {
  const [ra, rb] = [plateRef(siteA), plateRef(siteB)];
  if (!(ra && rb)) {
    return null;
  }
  return rowsLine("", plateTiles(a, ra), plateTiles(b, rb), "tiles");
}

// --- one file ------------------------------------------------------------------

function bytesLine(a: Uint8Array, b: Uint8Array): string[] {
  return Buffer.compare(a, b) === 0
    ? []
    : [`bytes differ (${a.length} in a, ${b.length} in b)`];
}

/** Two packed binaries through their readers (null: not that kind, or a
 *  side its reader refuses — then compared as bytes). */
function comparePacked(
  name: string,
  a: Uint8Array,
  b: Uint8Array,
  siteA: PublishedSite,
  siteB: PublishedSite
): string[] | null {
  if (name.endsWith(".pts")) {
    return comparePoints(a, b);
  }
  if (name.endsWith(".crw")) {
    return compareCrowns(a, b);
  }
  if (name.endsWith(".fpr")) {
    return compareFootprints(a, b);
  }
  if (path.basename(name) === "plate.bin") {
    return comparePlates(a, b, siteA, siteB);
  }
  return null;
}

const jsonOf = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));

/** Two versions of a file compared by its kind (its logical name). */
async function compareKind(
  name: string,
  a: Uint8Array,
  b: Uint8Array,
  siteA: PublishedSite,
  siteB: PublishedSite
): Promise<string[]> {
  if (name.endsWith(".gz")) {
    return await compareFile(
      name.slice(0, -3),
      gunzipSync(a),
      gunzipSync(b),
      siteA,
      siteB
    );
  }
  const ext = path.extname(name).toLowerCase();
  if (ext === ".glb") {
    return await compareGlbs(a, b, siteA, siteB);
  }
  if (ext === ".json" || ext === ".geojson") {
    return compareJson(jsonOf(a), jsonOf(b), siteA, siteB);
  }
  if (ext === ".png" || ext === ".webp" || ext === ".jpg") {
    return await compareRasters(a, b, ext === ".png");
  }
  return comparePacked(name, a, b, siteA, siteB) ?? bytesLine(a, b);
}

/** Two versions of the file `name` (its logical name) compared by
 *  content, as lines: none when they hold the same. A file that cannot be
 *  read as its kind is different, with the reason. */
export async function compareFile(
  name: string,
  a: Uint8Array,
  b: Uint8Array,
  siteA: PublishedSite,
  siteB: PublishedSite
): Promise<string[]> {
  if (Buffer.compare(a, b) === 0) {
    return [];
  }
  try {
    return await compareKind(name, a, b, siteA, siteB);
  } catch (error) {
    return [`cannot be read as its kind: ${String(error)}`];
  }
}

/** A named file's bytes, or null when it is not on disk. */
function bytesOf(site: PublishedSite, name: string): Uint8Array | null {
  const file = path.join(site.dir, site.files.get(name) ?? name);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
}

/** One file both sites name: the lines that say how it differs. */
async function sharedFile(
  name: string,
  siteA: PublishedSite,
  siteB: PublishedSite
): Promise<{ hash: boolean; lines: string[] }> {
  const [a, b] = [bytesOf(siteA, name), bytesOf(siteB, name)];
  if (!(a && b)) {
    const missing = [a ? "" : "a", b ? "" : "b"].filter(Boolean).join(" and ");
    return { hash: false, lines: [`named but missing in ${missing}`] };
  }
  if (Buffer.compare(a, b) === 0) {
    const served = siteA.files.get(name);
    return {
      hash: served === siteB.files.get(name) && served !== name,
      lines: [],
    };
  }
  return { hash: false, lines: await compareFile(name, a, b, siteA, siteB) };
}

/** Two published sites compared file by file. Throws when neither names a
 *  file: nothing compared is not "the same". */
export async function compareSites(
  siteA: PublishedSite,
  siteB: PublishedSite
): Promise<SiteComparison> {
  if (siteA.files.size === 0 && siteB.files.size === 0) {
    throw new Error("neither site names a file");
  }
  const result: SiteComparison = {
    differs: new Map(),
    equalByContent: 0,
    equalByHash: 0,
    onlyA: [...siteA.files.keys()].filter((n) => !siteB.files.has(n)).sort(),
    onlyB: [...siteB.files.keys()].filter((n) => !siteA.files.has(n)).sort(),
  };
  const shared = [...siteA.files.keys()].filter((n) => siteB.files.has(n));
  for (const name of shared.sort()) {
    const { hash, lines } = await sharedFile(name, siteA, siteB);
    if (lines.length > 0) {
      result.differs.set(name, lines);
    } else if (hash) {
      result.equalByHash += 1;
    } else {
      result.equalByContent += 1;
    }
  }
  return result;
}

/** The comparison as the command prints it. */
export function report(result: SiteComparison): string {
  const lines: string[] = [];
  for (const name of result.onlyA) {
    lines.push(`only in a: ${name}`);
  }
  for (const name of result.onlyB) {
    lines.push(`only in b: ${name}`);
  }
  for (const [name, details] of result.differs) {
    lines.push(`differs: ${name}`, ...details.map((d) => `  ${d}`));
  }
  const files =
    result.equalByHash + result.equalByContent + result.differs.size;
  lines.push(
    `${files} files in both: ${result.equalByHash} equal by hash, ${result.equalByContent} equal by content, ${result.differs.size} differ; ${result.onlyA.length} only in a, ${result.onlyB.length} only in b`
  );
  return `${lines.join("\n")}\n`;
}

/** Whether the comparison found the two sites the same: every file in
 *  both, each equal, and at least one compared. */
export const sameSites = (r: SiteComparison): boolean =>
  r.differs.size === 0 &&
  r.onlyA.length === 0 &&
  r.onlyB.length === 0 &&
  r.equalByHash + r.equalByContent > 0;

/** The command: 0 the same, 1 a difference, 2 a site it cannot read. */
export async function main(args: readonly string[]): Promise<number> {
  const [a, b] = args;
  if (!(a && b) || args.length !== 2) {
    process.stderr.write(
      "usage: bun scripts/compare-tilesets.ts <site-a> <site-b>\n"
    );
    return 2;
  }
  try {
    const result = await compareSites(readSite(a), readSite(b));
    process.stdout.write(report(result));
    return sameSites(result) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`compare-tilesets: ${String(error)}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
