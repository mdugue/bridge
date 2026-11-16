/**
 * Two published sites compared by content (plan 087, phase 5): the proof a
 * change that gives up byte-identical bakes (plan 092) still publishes the
 * same city. A site is a `public/data/<site>` tree, or its manifest; its
 * files are matched by their logical names (`manifest.json`, ADR 0024).
 *
 * The same hashed name is the same file. The rest are decoded, a kind at
 * a time, and compared by what they hold:
 *
 * - a glb (`.glb.gz`): each primitive's decoded attributes — positions in
 *   the node's frame, within the coarser side's quantisation step — its
 *   indices exactly, the EXT_structural_metadata tables row by row, and
 *   the names, extras and materials;
 * - a raster (`.png` through lib/city/png-raster.ts, `.webp` through
 *   sharp's raw decode): the decoded values, cell by cell;
 * - JSON and GeoJSON: the same records, with the order of keys and of
 *   records (an array of objects) ignored, and a hashed name another file
 *   is served under read as its logical name — so a tileset that names a
 *   changed file is not itself named;
 * - the packed binaries through their own readers in lib/city/: the canopy
 *   points (`.pts`), the coarse crowns (`.crw`), the footprints (`.fpr`)
 *   as unordered records, the ground plate (`plate.bin`) tile by tile;
 * - anything else as bytes. A new kind of published file needs its reader
 *   here, or it compares as bytes only.
 *
 *   bun scripts/compare-tilesets.ts <dir-a> <dir-b>
 *     prints each file that differs and how, then a count; exit 1 when a
 *     file differs or is in one site only.
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
import type { DataManifest } from "../lib/city/tile";
import { readGlb } from "./glb-container";
import { toExtMeshopt } from "./khr-meshopt";

/** How many lines a differing file reports at most. */
const MAX_DETAILS = 5;
/** How many characters of a value a line quotes. */
const QUOTE = 160;

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

/** A site from its directory or its manifest: the manifest's files, and
 *  every other file in the directory under its own name. */
export function readSite(where: string): PublishedSite {
  const dir =
    existsSync(where) && statSync(where).isFile() ? path.dirname(where) : where;
  const files = new Map<string, string>();
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf-8")
    ) as DataManifest;
    for (const [name, served] of Object.entries(manifest.files)) {
      files.set(name, served);
    }
  }
  const served = new Set(files.values());
  for (const file of readdirSync(dir)) {
    if (file !== MANIFEST_FILE && !served.has(file)) {
      files.set(file, file);
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

/** The bytes in an ArrayBuffer of their own (a Node Buffer's `slice` is a
 *  view into a shared pool, and its `buffer` the whole pool). */
const copied = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

function quote(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > QUOTE ? `${text.slice(0, QUOTE)}…` : text;
}

// --- JSON: keys and records unordered, served names read as logical ---------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An array of records (objects): compared as a multiset. */
const isRecordArray = (v: unknown[]): boolean =>
  v.length > 0 && v.every(isRecord);

/** Strings in code-unit order (the same on every machine and locale). */
function byText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A string that names a served file, as that file's logical name. */
function logicalString(s: string, site: PublishedSite): string {
  const direct = site.logical.get(s);
  if (direct !== undefined) {
    return direct;
  }
  const slash = s.lastIndexOf("/");
  const base = site.logical.get(s.slice(slash + 1));
  return slash !== -1 && base !== undefined ? s.slice(0, slash + 1) + base : s;
}

/** `value` in a form whose JSON is the same for the same content: keys
 *  sorted, records sorted by their own JSON, served names as logical. */
export function canonical(value: unknown, site: PublishedSite): unknown {
  if (typeof value === "string") {
    return logicalString(value, site);
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v, site));
    if (!isRecordArray(items)) {
      return items;
    }
    return items
      .map((item) => [JSON.stringify(item), item] as const)
      .sort(([a], [b]) => byText(a, b))
      .map(([, item]) => item);
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

/** One line for two sets of rows that differ, or none when they agree. */
function rowsLine(
  where: string,
  a: readonly string[],
  b: readonly string[],
  noun = "records"
): string[] {
  const { onlyA, onlyB } = multisetDiff(a, b);
  if (onlyA.length === 0 && onlyB.length === 0) {
    return [];
  }
  const examples = [
    onlyA.length > 0 ? `a: ${quote(onlyA[0])}` : "",
    onlyB.length > 0 ? `b: ${quote(onlyB[0])}` : "",
  ].filter(Boolean);
  return [
    `${where}${onlyA.length} ${noun} only in a, ${onlyB.length} only in b (${examples.join("; ")})`,
  ];
}

/** Where two canonical values differ, as up to MAX_DETAILS lines. */
function jsonDiff(a: unknown, b: unknown, at: string, out: string[]): void {
  if (out.length >= MAX_DETAILS || JSON.stringify(a) === JSON.stringify(b)) {
    return;
  }
  const where = at === "" ? "" : `${at}: `;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isRecordArray(a) || isRecordArray(b)) {
      out.push(...rowsLine(where, a.map(String2), b.map(String2)));
    } else if (a.length === b.length) {
      for (const [i, v] of a.entries()) {
        jsonDiff(v, b[i], `${at}[${i}]`, out);
      }
    } else {
      out.push(`${where}${a.length} items in a, ${b.length} in b`);
    }
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
  out.push(`${where}${quote(a)} → ${quote(b)}`);
}

function String2(v: unknown): string {
  return JSON.stringify(v);
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

interface RawGltf {
  bufferViews?: { byteLength: number; byteOffset?: number }[];
  extensions?: { EXT_structural_metadata?: StructuralMetadataJson };
  extensionsUsed?: string[];
  materials?: unknown[];
  meshes?: { extras?: unknown; name?: string; primitives?: unknown[] }[];
  nodes?: { extras?: unknown; mesh?: number; name?: string }[];
  scenes?: { extras?: unknown; name?: string }[];
}

/** One decoded attribute: its values and each component's tolerance. */
interface Attribute {
  size: number;
  tolerance: number[];
  values: Float64Array;
}

interface PrimitiveContent {
  attributes: Map<string, Attribute>;
  indices: Uint32Array | null;
  mode: number;
  where: string;
}

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
  // an integer that is not normalised (an id) is exact
  const tolerance = Array.from({ length: size }, () =>
    accessor.getNormalized() ? step : 0
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
    mode: prim.getMode(),
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

/** Two attributes compared within the coarser side's tolerance. */
function attributeLine(name: string, a: Attribute, b: Attribute): string[] {
  if (a.size !== b.size || a.values.length !== b.values.length) {
    return [
      `${name}: ${a.values.length / a.size} × ${a.size} in a, ${b.values.length / b.size} × ${b.size} in b`,
    ];
  }
  let count = 0;
  let first = -1;
  for (let i = 0; i < a.values.length; i += 1) {
    const c = i % a.size;
    const tol = Math.max(a.tolerance[c], b.tolerance[c]) * (1 + 1e-6);
    if (Math.abs(a.values[i] - b.values[i]) > tol + 1e-9) {
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
  return [
    `${name}: ${count} values beyond the quantisation step (vertex ${e / a.size}: ${element(a.values)} → ${element(b.values)})`,
  ];
}

function primitiveLines(a: PrimitiveContent, b: PrimitiveContent): string[] {
  const out: string[] = [];
  if (a.mode !== b.mode) {
    out.push(`${a.where}: mode ${a.mode} → ${b.mode}`);
  }
  const names = new Set([...a.attributes.keys(), ...b.attributes.keys()]);
  for (const name of names) {
    const [x, y] = [a.attributes.get(name), b.attributes.get(name)];
    if (x && y) {
      out.push(...attributeLine(`${a.where} ${name}`, x, y));
    } else {
      out.push(`${a.where} ${name}: only in ${x ? "a" : "b"}`);
    }
  }
  const [ia, ib] = [a.indices ?? [], b.indices ?? []];
  let moved = ia.length === ib.length ? 0 : -1;
  for (let i = 0; moved >= 0 && i < ia.length; i += 1) {
    moved += ia[i] === ib[i] ? 0 : 1;
  }
  if (moved !== 0) {
    out.push(
      moved < 0
        ? `${a.where} indices: ${ia.length} in a, ${ib.length} in b`
        : `${a.where} indices: ${moved} differ`
    );
  }
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
  return tableAccessors.map((table, k) => {
    const columns: Record<string, unknown[]> = {};
    for (const name of Object.keys(table.properties).sort()) {
      columns[name] = Array.from({ length: table.count }, (_, row) =>
        table.getPropertyValue(name, row)
      );
    }
    return {
      class: ext.propertyTables?.[k]?.class,
      columns,
      count: table.count,
    };
  });
}

/** Extensions that say how the bytes are stored, not what they hold: the
 *  decoded content is compared instead. */
const ENCODINGS = new Set([
  "EXT_meshopt_compression",
  "KHR_meshopt_compression",
  "KHR_mesh_quantization",
]);

/** What a glb says besides its buffers: names, extras, materials, the
 *  schema — nothing that points into a buffer or a quantisation. */
function glbStructure(raw: RawGltf): unknown {
  return {
    extensionsUsed: (raw.extensionsUsed ?? [])
      .filter((name) => !ENCODINGS.has(name))
      .sort(),
    materials: raw.materials ?? [],
    meshes: (raw.meshes ?? []).map((m) => ({
      extras: m.extras,
      name: m.name,
      primitives: m.primitives?.length ?? 0,
    })),
    nodes: (raw.nodes ?? []).map((n) => ({
      extras: n.extras,
      mesh: n.mesh !== undefined,
      name: n.name,
    })),
    scenes: raw.scenes ?? [],
    schema: raw.extensions?.EXT_structural_metadata?.schema,
  };
}

let reader: Promise<NodeIO> | undefined;

/** gltf-transform's reader, with the decoders our glbs need. */
async function glbReader(): Promise<NodeIO> {
  reader ??= MeshoptDecoder.ready.then(() =>
    new NodeIO()
      // it reads no EXT_mesh_features or EXT_structural_metadata (read
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

// --- the packed binaries ---------------------------------------------------------

/** The canopy points: header and points, order ignored. */
export function comparePoints(a: Uint8Array, b: Uint8Array): string[] | null {
  const [pa, pb] = [unpackPoints(copied(a)), unpackPoints(copied(b))];
  if (!(pa && pb)) {
    return null;
  }
  const rows = (p: NonNullable<typeof pa>): string[] =>
    Array.from({ length: p.count }, (_, i) => {
      const row = Array.from(p.data.subarray(i * p.stride, (i + 1) * p.stride));
      row[0] += p.origin[0];
      row[1] += p.origin[1];
      return row.join(",");
    });
  const out =
    pa.stride === pb.stride && pa.flags === pb.flags
      ? []
      : [`stride ${pa.stride}, flags ${pa.flags} → ${pb.stride}, ${pb.flags}`];
  return [...out, ...rowsLine("", rows(pa), rows(pb), "points")];
}

/** The coarse crowns, order ignored. */
export function compareCrowns(a: Uint8Array, b: Uint8Array): string[] | null {
  const [ca, cb] = [unpackCrowns(copied(a)), unpackCrowns(copied(b))];
  return ca && cb
    ? rowsLine("", ca.map(String2), cb.map(String2), "crowns")
    : null;
}

/** The footprints, an object's rings a record, order ignored. */
export function compareFootprints(
  a: Uint8Array,
  b: Uint8Array
): string[] | null {
  const [fa, fb] = [readFootprints(a), readFootprints(b)];
  const rows = (f: NonNullable<typeof fa>) =>
    unpackedFootprints(f).map(String2);
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

/** Two packed binaries through their readers (null: not that kind). */
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

/** Two versions of the file `name` (its logical name) compared by
 *  content, as lines: none when they hold the same. */
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

/** Two published sites compared file by file. */
export async function compareSites(
  siteA: PublishedSite,
  siteB: PublishedSite
): Promise<SiteComparison> {
  const result: SiteComparison = {
    differs: new Map(),
    equalByContent: 0,
    equalByHash: 0,
    onlyA: [...siteA.files.keys()].filter((n) => !siteB.files.has(n)).sort(),
    onlyB: [...siteB.files.keys()].filter((n) => !siteA.files.has(n)).sort(),
  };
  const shared = [...siteA.files.keys()].filter((n) => siteB.files.has(n));
  for (const name of shared.sort()) {
    const [fa, fb] = [siteA.files.get(name), siteB.files.get(name)];
    const [pa, pb] = [
      path.join(siteA.dir, fa ?? name),
      path.join(siteB.dir, fb ?? name),
    ];
    if (fa === fb && fa !== name) {
      result.equalByHash += 1;
      continue;
    }
    const lines = await compareFile(
      name,
      readFileSync(pa),
      readFileSync(pb),
      siteA,
      siteB
    );
    if (lines.length === 0) {
      result.equalByContent += 1;
    } else {
      result.differs.set(name, lines);
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

/** Whether the comparison found the two sites the same. */
export const sameSites = (r: SiteComparison): boolean =>
  r.differs.size === 0 && r.onlyA.length === 0 && r.onlyB.length === 0;

if (import.meta.main) {
  const [a, b] = process.argv.slice(2);
  if (!(a && b)) {
    process.stderr.write(
      "usage: bun scripts/compare-tilesets.ts <dir-a> <dir-b>\n"
    );
    process.exit(2);
  }
  const result = await compareSites(readSite(a), readSite(b));
  process.stdout.write(report(result));
  process.exitCode = sameSites(result) ? 0 : 1;
}
