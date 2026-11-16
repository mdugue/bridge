/**
 * Two published sites compared by content (plan 087, phase 5): the proof a
 * change that gives up byte-identical bakes (plan 092) still publishes the
 * same city. A site is a `public/data/<site>` folder (its `manifest.json`
 * and every other file beside it) or one manifest file (what it names, and
 * nothing else); files are matched by their logical names (ADR 0024).
 *
 * The rule: everything is compared exactly, unless the caller asks for a
 * tolerance; a file never sets its own. A file that cannot be read as its
 * kind is an error (exit 2), also when both sides hold the same bytes.
 *
 * - A named file missing on either side differs; the same bytes on both
 *   sides are the same file once its reader has read them.
 * - glb (`.glb.gz`): scripts/compare-glb.ts — storage, transforms and
 *   stored values exactly; with `--within <m>` / `--within-unit <d>`
 *   positions, normals and tangents placed in the world within those.
 * - JSON and GeoJSON: scripts/compare-json.ts — keys unordered, arrays in
 *   order, served names read as logical ones.
 * - Rasters: an 8-bit grey `.png` through lib/city/png-raster.ts,
 *   another 8-bit PNG or a `.webp` through sharp; the decoded values,
 *   cell by cell. A PNG of another bit depth is unreadable.
 * - The packed binaries through their readers in lib/city/, in order: the
 *   canopy points (`.pts`), the coarse crowns (`.crw`), the footprints
 *   (`.fpr`), the ground plate (`plate.bin`, through each tileset).
 * - Anything else as bytes: a new kind of published file needs its reader
 *   here, or it compares as bytes only.
 *
 *   bun scripts/compare-tilesets.ts <site-a> <site-b> [--within <m>]
 *       [--within-unit <d>]
 *     prints each file that differs and how, then the verdict (with a
 *     tolerance: the largest deviation found); exit 0 when the sites hold
 *     the same, 1 when a file differs or is in one site only, 2 when a
 *     site or a file cannot be read, or nothing is named.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { unpackCrowns } from "../lib/city/coarse-crowns";
import { readFootprints, unpackedFootprints } from "../lib/city/footprint-pack";
import { decodePlate, plateOf } from "../lib/city/ground-plate";
import type { PlateRef } from "../lib/city/ground-plate";
import { unpackPoints } from "../lib/city/point-pack";
import { decodeGreyPng } from "../lib/city/png-raster";
import { MANIFEST_FILE } from "../lib/city/tile";
import { compareGlbs, readGlbContent, tolerant } from "./compare-glb";
import type { Deviation, Tolerance } from "./compare-glb";
import { asJson, compareJson, rowsLine } from "./compare-json";

export { multisetDiff } from "./compare-json";
export type { Tolerance } from "./compare-glb";

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
  /** the largest deviation a tolerance let pass */
  deviation: Deviation;
  /** logical name → what differs (one line or more) */
  differs: Map<string, string[]>;
  equalByContent: number;
  equalByHash: number;
  onlyA: string[];
  onlyB: string[];
  tolerance: Tolerance;
  /** logical name → why it cannot be read as its kind */
  unreadable: Map<string, string>;
}

/** What the comparison of one pair of files needs to know. */
interface Context {
  deviation: Deviation;
  siteA: PublishedSite;
  siteB: PublishedSite;
  tolerance: Tolerance;
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
 * folder (its `manifest.json`, and every other file beside it under its
 * own name: the publisher prunes what no manifest names, so what is left
 * is the site's). A folder without a manifest is an error, not a listing.
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
      // a stray file named like a logical name never stands in for the
      // manifest's file: the manifest alone says which file a name is
      const beside =
        file !== MANIFEST_FILE &&
        !served.has(file) &&
        !files.has(file) &&
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

// --- rasters -------------------------------------------------------------------

interface Raster {
  channels: number;
  data: Uint8Array;
  height: number;
  width: number;
}

/** A PNG's bit depth and colour type (IHDR). */
const pngHeader = (b: Uint8Array) => ({ colour: b[25], depth: b[24] });

/** A raster decoded: an 8-bit grey PNG by png-raster.ts (as the viewer
 *  reads it), another 8-bit PNG or a WebP by sharp. A PNG of another bit
 *  depth is refused, never read at 8 bits (none is published). */
async function decodeRaster(bytes: Uint8Array, png: boolean): Promise<Raster> {
  const header = png ? pngHeader(bytes) : undefined;
  if (header && header.depth !== 8) {
    throw new Error(`a PNG of bit depth ${header.depth}: no reader here`);
  }
  if (header?.colour === 0) {
    return { ...(await decodeGreyPng(bytes)), channels: 1 };
  }
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    channels: info.channels,
    data: new Uint8Array(data),
    height: info.height,
    width: info.width,
  };
}

/** A raster's shape, as a line says it. */
const shape = (r: Raster) => `${r.width}×${r.height}×${r.channels}`;

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
  if (shape(ra) !== shape(rb)) {
    return [`${shape(ra)} in a, ${shape(rb)} in b`];
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

// --- the packed binaries, in order ------------------------------------------------

/** A packed binary read: its rows in order, and a header if it has one. */
interface Packed {
  header?: string;
  noun: string;
  rows: string[];
}

/** The bytes in an ArrayBuffer of their own (a Node Buffer's `slice` is a
 *  view into a shared pool, and its `buffer` the whole pool). */
const copied = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

/** `value`, or an error naming what its reader refused. */
function read<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`not ${what}`);
  }
  return value;
}

/** The canopy points as rows, and their header. */
function pointRows(bytes: Uint8Array): Packed {
  const p = read(unpackPoints(copied(bytes)), "a canopy pack (PTS1)");
  return {
    header: `stride ${p.stride}, flags ${p.flags}, origin ${p.origin.join(" ")}`,
    noun: "points",
    rows: Array.from({ length: p.count }, (_, i) =>
      Array.from(p.data.subarray(i * p.stride, (i + 1) * p.stride)).join(",")
    ),
  };
}

const crownRows = (bytes: Uint8Array): string[] =>
  read(unpackCrowns(copied(bytes)), "a crown pack (CRW1)").map(asJson);

const footprintRows = (bytes: Uint8Array): string[] =>
  unpackedFootprints(
    read(readFootprints(bytes), "a footprint pack (FPR1)")
  ).map(asJson);

/** The plate a site's tileset names (its tiles and grid). */
function plateRef(site: PublishedSite): PlateRef {
  const file = site.files.get("tileset.json");
  const tileset = file
    ? (JSON.parse(readFileSync(path.join(site.dir, file), "utf-8")) as {
        extras?: unknown;
      })
    : undefined;
  return read(plateOf(tileset?.extras) ?? null, "a plate its tileset names");
}

/** A plate's tiles, each a row. */
const plateRows = (bytes: Uint8Array, site: PublishedSite): string[] => {
  const ref = plateRef(site);
  return decodePlate(bytes, ref.tiles, ref.n).map((t) =>
    JSON.stringify({
      bounds: t.bounds,
      classes: Array.from(t.classes),
      heights: Array.from(t.heights),
      id: t.id,
    })
  );
};

/** A packed binary's rows through its reader, or undefined for a kind
 *  without one. Throws when the reader refuses the bytes. */
function packedRows(
  name: string,
  bytes: Uint8Array,
  site: PublishedSite
): Packed | undefined {
  if (name.endsWith(".pts")) {
    return pointRows(bytes);
  }
  if (name.endsWith(".crw")) {
    return { noun: "crowns", rows: crownRows(bytes) };
  }
  if (name.endsWith(".fpr")) {
    return { noun: "footprints", rows: footprintRows(bytes) };
  }
  if (path.basename(name) === "plate.bin") {
    return { noun: "tiles", rows: plateRows(bytes, site) };
  }
  return undefined;
}

// --- one file ------------------------------------------------------------------

const jsonOf = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));

const RASTERS = new Set([".png", ".webp", ".jpg"]);

/** Two versions of a file compared by its kind (its logical name). Throws
 *  when either cannot be read as that kind. */
async function compareKind(
  name: string,
  a: Uint8Array,
  b: Uint8Array,
  ctx: Context
): Promise<string[]> {
  if (name.endsWith(".gz")) {
    return await compareKind(
      name.slice(0, -3),
      gunzipSync(a),
      gunzipSync(b),
      ctx
    );
  }
  const ext = path.extname(name).toLowerCase();
  const served = [ctx.siteA.logical, ctx.siteB.logical] as const;
  if (ext === ".glb") {
    return await compareGlbs(a, b, [...served], ctx.tolerance, ctx.deviation);
  }
  if (ext === ".json" || ext === ".geojson") {
    return compareJson(jsonOf(a), jsonOf(b), ...served);
  }
  if (RASTERS.has(ext)) {
    return await compareRasters(a, b, ext === ".png");
  }
  const pa = packedRows(name, a, ctx.siteA);
  const pb = packedRows(name, b, ctx.siteB);
  if (pa && pb) {
    const header =
      pa.header === pb.header ? [] : [`${pa.header} → ${pb.header}`];
    return [...header, ...rowsLine("", pa.rows, pb.rows, pa.noun)];
  }
  return Buffer.compare(a, b) === 0
    ? []
    : [`bytes differ (${a.length} in a, ${b.length} in b)`];
}

/** One file read as its kind, its bytes the same on both sides: throws
 *  when it cannot be read. */
async function readKind(name: string, bytes: Uint8Array, ctx: Context) {
  if (name.endsWith(".gz")) {
    await readKind(name.slice(0, -3), gunzipSync(bytes), ctx);
    return;
  }
  const ext = path.extname(name).toLowerCase();
  if (ext === ".glb") {
    await readGlbContent(bytes, tolerant(ctx.tolerance));
  } else if (ext === ".json" || ext === ".geojson") {
    jsonOf(bytes);
  } else if (RASTERS.has(ext)) {
    await decodeRaster(bytes, ext === ".png");
  } else {
    packedRows(name, bytes, ctx.siteA);
  }
}

/** A named file's bytes, or null when it is not on disk. */
function bytesOf(site: PublishedSite, name: string): Uint8Array | null {
  const file = path.join(site.dir, site.files.get(name) ?? name);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
}

type Outcome =
  | { kind: "hash" }
  | { kind: "content" }
  | { kind: "differs"; lines: string[] }
  | { kind: "unreadable"; why: string };

/** One file both sites name, compared. */
async function sharedFile(name: string, ctx: Context): Promise<Outcome> {
  const [a, b] = [bytesOf(ctx.siteA, name), bytesOf(ctx.siteB, name)];
  if (!(a && b)) {
    const missing = [a ? "" : "a", b ? "" : "b"].filter(Boolean).join(" and ");
    return { kind: "differs", lines: [`named but missing in ${missing}`] };
  }
  try {
    if (Buffer.compare(a, b) === 0) {
      await readKind(name, a, ctx);
      const served = ctx.siteA.files.get(name);
      const hash = served === ctx.siteB.files.get(name) && served !== name;
      return { kind: hash ? "hash" : "content" };
    }
    const lines = await compareKind(name, a, b, ctx);
    return lines.length > 0 ? { kind: "differs", lines } : { kind: "content" };
  } catch (error) {
    return { kind: "unreadable", why: String(error) };
  }
}

/** Two published sites compared file by file. Throws when neither names a
 *  file: nothing compared is not "the same". */
export async function compareSites(
  siteA: PublishedSite,
  siteB: PublishedSite,
  tolerance: Tolerance = {}
): Promise<SiteComparison> {
  if (siteA.files.size === 0 && siteB.files.size === 0) {
    throw new Error("neither site names a file");
  }
  const ctx: Context = {
    deviation: { position: 0, unit: 0 },
    siteA,
    siteB,
    tolerance,
  };
  const result: SiteComparison = {
    deviation: ctx.deviation,
    differs: new Map(),
    equalByContent: 0,
    equalByHash: 0,
    onlyA: [...siteA.files.keys()].filter((n) => !siteB.files.has(n)).sort(),
    onlyB: [...siteB.files.keys()].filter((n) => !siteA.files.has(n)).sort(),
    tolerance,
    unreadable: new Map(),
  };
  const shared = [...siteA.files.keys()].filter((n) => siteB.files.has(n));
  for (const name of shared.sort()) {
    const outcome = await sharedFile(name, ctx);
    if (outcome.kind === "hash") {
      result.equalByHash += 1;
    } else if (outcome.kind === "content") {
      result.equalByContent += 1;
    } else if (outcome.kind === "differs") {
      result.differs.set(name, outcome.lines);
    } else {
      result.unreadable.set(name, outcome.why);
    }
  }
  return result;
}

/** What a tolerance let pass, for the verdict. */
function toleranceLine(r: SiteComparison): string {
  const { within, withinUnit } = r.tolerance;
  const parts = [
    within === undefined
      ? ""
      : `${within} m (largest ${r.deviation.position.toPrecision(3)} m)`,
    withinUnit === undefined
      ? ""
      : `${withinUnit} for unit vectors (largest ${r.deviation.unit.toPrecision(3)})`,
  ].filter(Boolean);
  return parts.length === 0 ? "" : `; compared within ${parts.join(" and ")}`;
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
  for (const [name, why] of result.unreadable) {
    lines.push(`cannot read: ${name}: ${why}`);
  }
  const files =
    result.equalByHash +
    result.equalByContent +
    result.differs.size +
    result.unreadable.size;
  lines.push(
    `${files} files in both: ${result.equalByHash} equal by hash, ${result.equalByContent} equal by content, ${result.differs.size} differ, ${result.unreadable.size} unreadable; ${result.onlyA.length} only in a, ${result.onlyB.length} only in b${toleranceLine(result)}`
  );
  return `${lines.join("\n")}\n`;
}

/** Whether the comparison found the two sites the same: every file in
 *  both, each read and equal, and at least one compared. */
export const sameSites = (r: SiteComparison): boolean =>
  r.differs.size === 0 &&
  r.unreadable.size === 0 &&
  r.onlyA.length === 0 &&
  r.onlyB.length === 0 &&
  r.equalByHash + r.equalByContent > 0;

/** The command's arguments: two sites and an optional tolerance. */
export function parseArgs(
  args: readonly string[]
): { sites: [string, string]; tolerance: Tolerance } | undefined {
  const sites: string[] = [];
  const tolerance: Tolerance = {};
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--within" || flag === "--within-unit") {
      const value = Number(args[i + 1]);
      if (!(Number.isFinite(value) && value >= 0)) {
        return undefined;
      }
      tolerance[flag === "--within" ? "within" : "withinUnit"] = value;
      i += 1;
    } else {
      sites.push(flag);
    }
  }
  return sites.length === 2
    ? { sites: [sites[0], sites[1]], tolerance }
    : undefined;
}

/** The command: 0 the same, 1 a difference, 2 something it cannot read. */
export async function main(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (!parsed) {
    process.stderr.write(
      "usage: bun scripts/compare-tilesets.ts <site-a> <site-b> [--within <m>] [--within-unit <d>]\n"
    );
    return 2;
  }
  try {
    const [a, b] = parsed.sites;
    const result = await compareSites(
      readSite(a),
      readSite(b),
      parsed.tolerance
    );
    process.stdout.write(report(result));
    if (result.unreadable.size > 0) {
      return 2;
    }
    return sameSites(result) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`compare-tilesets: ${String(error)}\n`);
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
