/**
 * The ledger's shapes and arithmetic (plan 087, phase 1): the figures of the
 * reference site that are a function of the tree — bytes and requests per
 * tile and level, read from the published tileset and manifest, and the
 * complexity counters the rewrite series promises to lower. Pure: the
 * caller reads the files (scripts/ledger.ts, `publishedFiles`) and hands
 * their names, bytes and texts in. `qa/ledger.json` is the result; its
 * `--check` names each figure that moved (`ledgerDiff`).
 *
 * Every figure is gated, the buildings' vertices and bytes among them: a
 * bake's bytes do not depend on the machine (lib/city/portable-math.ts;
 * until PR #310 the near buildings' weld gave 1–3 vertices more or fewer a
 * tile on another machine, and those figures were recorded only).
 */
import { gzipSync } from "node:zlib";
import type { RasterLedger } from "./ledger-rasters";
import { TERRAIN_RASTER_KEYS } from "./tileset";

/** The extensions a static host sends as they are: compressed already. */
export const PACKED_EXTENSIONS = [".png", ".webp", ".gz"] as const;
/** The gzip level a static host compresses the rest at. */
export const WIRE_GZIP_LEVEL = 6;
export const WIRE_RULE =
  ".png, .webp and .gz at face value; every other file gzipped at level 6 (Bun's zlib) — a stand-in for what a host sends (Vercel sends text as brotli), kept constant so the figures compare over time, exact once plan 088 stores files in their transport encoding. The gated figures are those of CI's platform (linux-x64, the pinned Bun): regenerate the ledger there or in a cloud session.";

/** What a glTF holds, whoever baked it: its vertices (the positions'
 *  counts), its triangles and its accessors' decoded bytes. */
export interface MeshFigures {
  accessorBytes: number;
  triangles: number;
  vertices: number;
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};
const GLB_MAGIC = 0x46_54_6c_67;
const TRIANGLES = 4;

interface GltfJson {
  accessors?: { componentType: number; count: number; type: string }[];
  meshes?: {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      mode?: number;
    }[];
  }[];
}

/** A binary glTF's mesh figures, read from its JSON chunk alone (so a
 *  meshopt-compressed buffer needs no decoding). */
export function glbFigures(glb: Uint8Array): MeshFigures {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("ledger: not a binary glTF");
  }
  const length = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(glb.subarray(20, 20 + length))
  ) as GltfJson;
  const accessors = json.accessors ?? [];
  const accessorBytes = accessors.reduce(
    (sum, a) =>
      sum +
      a.count *
        (COMPONENT_BYTES[a.componentType] ?? 0) *
        (TYPE_COMPONENTS[a.type] ?? 0),
    0
  );
  const positions = new Set<number>();
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes.POSITION;
      if (position !== undefined) {
        positions.add(position);
      }
      if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) {
        continue;
      }
      const counted = primitive.indices ?? position;
      triangles += Math.floor(
        (counted === undefined ? 0 : (accessors[counted]?.count ?? 0)) / 3
      );
    }
  }
  const vertices = [...positions].reduce(
    (sum, i) => sum + (accessors[i]?.count ?? 0),
    0
  );
  return { vertices, triangles, accessorBytes };
}

/** A published file's bytes on the wire: packed files at face value,
 *  everything else (JSON, GeoJSON) gzipped as a static host would. */
export function wireBytes(name: string, bytes: Uint8Array): number {
  if (PACKED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return bytes.length;
  }
  return gzipSync(bytes, { level: WIRE_GZIP_LEVEL }).length;
}

/** A logical name's extension: the last, with the one before it where the
 *  last is `.gz` (`.glb.gz`, `.pts.gz`); a raster twin's `.r1024` is not one. */
export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const parts = base.split(".").slice(1);
  const last = parts.at(-1);
  if (last === undefined) {
    return "";
  }
  const before = parts.at(-2);
  return last === "gz" && before !== undefined ? `.${before}.gz` : `.${last}`;
}

/** The distinct extensions among the published files' logical names. */
export function distinctExtensions(names: Iterable<string>): string[] {
  return [...new Set([...names].map(extensionOf))].toSorted();
}

/* ------------------------------------------------------------------ sets */

/** Where a tile's level of the tileset names its files. */
type Named = Record<string, unknown>;

/** One site tile as the tileset names it (`buildTileset`'s tree). */
export interface LedgerTile {
  /** the inquiry card's files, by kind */
  ask: Named;
  /** the minimap's bridge decks and footprints */
  bridges?: string;
  /** the near buildings' content */
  city: string;
  /** the side files both building contents name */
  cityExtras: Named;
  /** the far buildings' content */
  cityFar: string;
  footprints: string;
  id: string;
  /** each terrain level's content and extras */
  terrain: Record<0 | 1, { extras: Named; uri: string }>;
}

interface Node {
  children?: Node[];
  content?: { uri?: string };
  extras?: Named;
}

const uriOf = (node: Node | undefined, what: string): string => {
  const uri = node?.content?.uri;
  if (typeof uri !== "string") {
    throw new Error(`ledger: the tileset's ${what} has no content`);
  }
  return uri;
};

/** The site tiles of a tileset JSON, spawn first: its root's children (as
 *  `tileNode` writes them) beside the extras' tile list, in one order. */
export function ledgerTiles(tileset: unknown): LedgerTile[] {
  const json = tileset as {
    extras?: { tiles?: Named[] };
    root?: { children?: Node[] };
  };
  const infos = json.extras?.tiles ?? [];
  const nodes = json.root?.children ?? [];
  if (infos.length === 0 || infos.length !== nodes.length) {
    throw new Error("ledger: the tileset's tiles and children differ");
  }
  return infos.map((info, i) => {
    const [cityFar, terrainCoarse] = nodes[i]?.children ?? [];
    const id = String(info.id);
    return {
      id,
      cityFar: uriOf(cityFar, `${id} far buildings`),
      city: uriOf(cityFar?.children?.[0], `${id} buildings`),
      cityExtras: cityFar?.extras ?? {},
      terrain: {
        1: {
          uri: uriOf(terrainCoarse, `${id} coarse terrain`),
          extras: terrainCoarse?.extras ?? {},
        },
        0: {
          uri: uriOf(terrainCoarse?.children?.[0], `${id} fine terrain`),
          extras: terrainCoarse?.children?.[0]?.extras ?? {},
        },
      },
      footprints: String(info.footprints),
      ...(typeof info.bridges === "string" ? { bridges: info.bridges } : {}),
      ask: (info.ask as Named | undefined) ?? {},
    };
  });
}

/**
 * Which of a terrain level's rasters and tables a tier reads near the
 * camera: the viewer's own rule (`rasterFiles` in
 * app/_components/tile-rasters.ts), handed in by the caller so that the
 * ledger counts what the viewer fetches and states no second rule.
 */
export type RasterReads = (
  extras: Named,
  level: 0 | 1,
  phone: boolean
) => string[];

/** The ledger's sets of a tile: what a far tile, a fine level, the near
 *  buildings and the inquiry card fetch, and every file the tile names. */
export const LEDGER_SETS = ["far", "fine", "near", "ask", "all"] as const;
export type LedgerSet = (typeof LEDGER_SETS)[number];

const names = (record: unknown): string[] =>
  typeof record === "object" && record !== null
    ? Object.values(record).filter((v): v is string => typeof v === "string")
    : [];

/** Every file a terrain level's extras name: its rasters and tables (all
 *  twins), and its dressing or coarse side files. */
const levelNames = (extras: Named): string[] => [
  ...TERRAIN_RASTER_KEYS.flatMap((key) => {
    const file = extras[key];
    return typeof file === "string" ? [file] : [];
  }),
  ...names(extras.dressing),
  ...names(extras.coarse),
];

const unique = (files: string[]): string[] =>
  [...new Set(files.filter((f) => f !== ""))].toSorted();

/** The published files of `set` for one tile on one tier. */
export function tileSet(
  tile: LedgerTile,
  set: LedgerSet,
  reads: RasterReads,
  phone: boolean
): string[] {
  const coarse = tile.terrain[1];
  const fine = tile.terrain[0];
  switch (set) {
    case "far": {
      return unique([
        tile.cityFar,
        ...names(tile.cityExtras),
        coarse.uri,
        ...reads(coarse.extras, 1, phone),
        ...names(coarse.extras.coarse),
      ]);
    }
    case "fine": {
      // the dressing build fetches the sports table on every tier (its
      // goals and nets, tile-stream.ts) and samples the NDVI
      return unique([
        fine.uri,
        ...reads(fine.extras, 0, phone),
        ...names(fine.extras.dressing),
        ...names({ t: fine.extras.sportTable, n: fine.extras.ndvi }),
      ]);
    }
    case "near": {
      return unique([tile.city]);
    }
    case "ask": {
      return unique(names(tile.ask));
    }
    case "all": {
      return unique([
        tile.cityFar,
        tile.city,
        ...names(tile.cityExtras),
        coarse.uri,
        ...levelNames(coarse.extras),
        fine.uri,
        ...levelNames(fine.extras),
        tile.footprints,
        ...(tile.bridges ? [tile.bridges] : []),
        ...names(tile.ask),
      ]);
    }
    default: {
      throw new Error(`ledger: no set ${String(set)}`);
    }
  }
}

/* --------------------------------------------------------------- figures */

export interface Weight {
  bytes: number;
  files: number;
}

export interface TileWeight extends Weight {
  tile: string;
}

/** A set's figures: the spawn tile, the median and the largest tile, and the
 *  site (each file once, over every tile). */
export interface SetFigures {
  largest: TileWeight;
  median: TileWeight;
  site: Weight;
  spawn: TileWeight;
}

/** The weight of a list of published files. */
export function weigh(
  files: readonly string[],
  wire: (file: string) => number
): Weight {
  return {
    bytes: files.reduce((sum, file) => sum + wire(file), 0),
    files: files.length,
  };
}

/** Strings by their code units: no locale reorders a gated figure. */
function codeOrder(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** The spawn (first), median (the lower of an even count) and largest tile
 *  by bytes; ties go to the tile id, so the figures are a function of the
 *  files alone. */
export function setFigures(
  perTile: readonly { files: string[]; tile: string }[],
  wire: (file: string) => number
): SetFigures {
  const weights: TileWeight[] = perTile.map(({ files, tile }) => ({
    tile,
    ...weigh(files, wire),
  }));
  const spawn = weights[0];
  if (spawn === undefined) {
    throw new Error("ledger: no tiles");
  }
  const sorted = weights.toSorted(
    (a, b) => a.bytes - b.bytes || codeOrder(a.tile, b.tile)
  );
  const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? spawn;
  const largest = sorted.at(-1) ?? spawn;
  const site = weigh(unique(perTile.flatMap((t) => t.files)), wire);
  return { spawn, median, largest, site };
}

/** A set's figures on a desktop, and a phone's where they differ (a row
 *  with a low twin). */
export type SetLedger = SetFigures & { phone?: SetFigures };

/** Every set's figures over the site's tiles (the spawn tile first). */
export function bytesLedger(
  tiles: readonly LedgerTile[],
  reads: RasterReads,
  wire: (file: string) => number
): Record<LedgerSet, SetLedger> {
  const out = {} as Record<LedgerSet, SetLedger>;
  for (const set of LEDGER_SETS) {
    const of = (phone: boolean) =>
      tiles.map((tile) => ({
        tile: tile.id,
        files: tileSet(tile, set, reads, phone),
      }));
    const desktop = of(false);
    const phone = of(true);
    const differs = phone.some(
      (t, i) => t.files.join("\n") !== desktop[i]?.files.join("\n")
    );
    out[set] = {
      ...setFigures(desktop, wire),
      ...(differs ? { phone: setFigures(phone, wire) } : {}),
    };
  }
  return out;
}

/* -------------------------------------------------------------- counters */

/** A source file as the counters read it. */
export interface SourceText {
  path: string;
  text: string;
}

/** Lines as `wc -l` counts them (a last line without its newline counts). */
export function lineCount(text: string): number {
  if (text === "") {
    return 0;
  }
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** The scene's layer modules (`app/_components/*-layer.ts`, tests left
 *  out): how many, and their lines. */
export function layerModules(files: readonly SourceText[]): {
  files: number;
  lines: number;
} {
  const layers = files.filter(
    ({ path }) =>
      /(?:^|\/)app\/_components\/[^/]+-layer\.ts$/u.test(path) &&
      !path.endsWith(".test.ts")
  );
  return {
    files: layers.length,
    lines: layers.reduce((sum, { text }) => sum + lineCount(text), 0),
  };
}

/** The lines of `bootApp` in create-app.ts: from its `function` line to
 *  the first closing brace at the start of a line, both counted. */
export function functionLines(text: string, name: string): number {
  const lines = text.split("\n");
  const head = new RegExp(`^(?:export )?(?:async )?function ${name}\\b`, "u");
  const start = lines.findIndex((line) => head.test(line));
  if (start === -1) {
    throw new Error(`ledger: no function ${name}`);
  }
  const end = lines.findIndex((line, i) => i > start && line === "}");
  if (end === -1) {
    throw new Error(`ledger: function ${name} does not close`);
  }
  return end - start + 1;
}

/** What marks a bake module that handles a tile's seam. */
export const SEAM_PATTERN = /neighbour|seam|margin/iu;

/** The bake modules (`pipeline/bake/*.py`, one level) that mention a
 *  neighbour, a seam or a margin, of all of them. */
export function seamModules(files: readonly SourceText[]): {
  matching: number;
  of: number;
} {
  const modules = files.filter(({ path }) =>
    /(?:^|\/)pipeline\/bake\/[^/]+\.py$/u.test(path)
  );
  return {
    matching: modules.filter(({ text }) => SEAM_PATTERN.test(text)).length,
    of: modules.length,
  };
}

/** What marks a comment as a workaround kept for three or the browser
 *  (written so that this module's own source does not match it). */
export const WORKAROUND_PATTERN = /upstream\sworkaround/iu;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u;

/** The comment lines that name a workaround for upstream: each a rule the
 *  code keeps because three or the browser does not. */
export function upstreamWorkarounds(files: readonly SourceText[]): number {
  return files.reduce(
    (sum, { text }) =>
      sum +
      text
        .split("\n")
        .filter(
          (line) => COMMENT_LINE.test(line) && WORKAROUND_PATTERN.test(line)
        ).length,
    0
  );
}

export interface Counters {
  askKinds: number;
  bakeSeamModules: { matching: number; of: number };
  bootAppLines: number;
  coarseDressingKinds: number;
  dressingKinds: number;
  layerModules: { files: number; lines: number };
  publishedExtensions: string[];
  upstreamWorkarounds: number;
}

/* ---------------------------------------------------------------- ledger */

export const LEDGER_VERSION = 1;

/** Per tile, near (as baked) and far (simplified). */
export interface ByLevel<T> {
  far: Record<string, T>;
  near: Record<string, T>;
}

/** The buildings' geometry: each tile's vertices, triangles and decoded
 *  bytes. */
export type BuildingFigures = ByLevel<MeshFigures>;

/** `qa/ledger.json`. Every figure but `dated` is a function of the tree. */
export interface Ledger {
  buildings: BuildingFigures;
  /** the bytes and requests of each set */
  bytes: Record<LedgerSet, SetLedger>;
  counters: Counters;
  /** the day the gated figures last changed (kept while they hold) */
  dated: string;
  /** every file the manifest names */
  published: Weight;
  /** every built site's rasters (plan 091 phase 0, ledger-rasters.ts) */
  rasters: RasterLedger;
  site: string;
  tiles: number;
  version: typeof LEDGER_VERSION;
  wire: string;
}

/** The part `--check` never compares. */
const UNCOMPARED = new Set(["dated"]);

/** Leaf paths with their values (`bytes.fine.spawn.bytes`). */
function leaves(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      if (path === "" && UNCOMPARED.has(key)) {
        continue;
      }
      for (const [p, v] of leaves(inner, path ? `${path}.${key}` : key)) {
        out.set(p, v);
      }
    }
  } else {
    out.set(path, JSON.stringify(value));
  }
  return out;
}

/** Each gated figure that differs between the committed ledger and a fresh
 *  one, as `path: was → now` (`dated` is none). */
export function ledgerDiff(was: unknown, now: unknown): string[] {
  const a = leaves(was);
  const b = leaves(now);
  const paths = [...new Set([...a.keys(), ...b.keys()])].toSorted();
  return paths.flatMap((p) =>
    a.get(p) === b.get(p)
      ? []
      : [`${p}: ${a.get(p) ?? "(none)"} → ${b.get(p) ?? "(none)"}`]
  );
}

type Gated = Omit<Ledger, "dated">;

/** The ledger to write: the committed one's date while no figure moved,
 *  else `today`. */
export function datedLedger(
  fresh: Gated,
  committed: unknown,
  today: string
): Ledger {
  const was = committed as Partial<Ledger> | null;
  const kept =
    typeof was?.dated === "string" && ledgerDiff(was, fresh).length === 0;
  const dated = kept && was?.dated ? was.dated : today;
  // the heading first, then the figures, in one order
  return {
    version: fresh.version,
    site: fresh.site,
    dated,
    wire: fresh.wire,
    tiles: fresh.tiles,
    published: fresh.published,
    bytes: fresh.bytes,
    buildings: fresh.buildings,
    counters: fresh.counters,
    rasters: fresh.rasters,
  };
}
