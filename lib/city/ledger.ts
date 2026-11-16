/**
 * The ledger's shapes and arithmetic (plan 087, phase 1): the figures of the
 * reference site that are a function of the tree — bytes and requests per
 * tile and level, read from the published tileset and manifest, every
 * published file in exactly one class — and the gate that compares them.
 * Pure: the caller reads the files (scripts/ledger.ts, `publishedFiles`)
 * and hands their names, bytes and texts in. `qa/ledger.json` is the
 * result; its `--check` names each figure that moved (`ledgerDiff`). The
 * complexity counters are ledger-counters.ts.
 *
 * Two rules hold the gate together. Every published file is counted: one
 * that no tile and no row of `SITE_FILES` names is an error, never a
 * silence (`publishedLedger`). And every figure is gated, the buildings'
 * vertices and bytes among them: a bake's bytes do not depend on the
 * machine (lib/city/portable-math.ts), so nothing is left out of a sum.
 */
import { gzipSync } from "node:zlib";
import type { BrowserFigures, Timings } from "./ledger-browser";
import type { Counters } from "./ledger-counters";
import type { BakeStoreLedger } from "./ledger-bake-store";
import { DRESSING_UNCOMPARED } from "./ledger-dressing";
import type { DressingLedger } from "./ledger-dressing";
import type { BlockLedger } from "./ledger-blocks";
import type { RasterLedger } from "./ledger-rasters";
import { BLOCK_RASTER_KEYS, TERRAIN_RASTER_KEYS } from "./tileset";

/** The extensions a static host sends as they are: compressed already. */
export const PACKED_EXTENSIONS = [".png", ".webp", ".gz"] as const;
/** The extensions a static host compresses: text. */
export const TEXT_EXTENSIONS = [".json", ".geojson"] as const;
/** The gzip level the text is counted at. */
export const WIRE_GZIP_LEVEL = 6;
export const WIRE_RULE =
  ".png, .webp and .gz at face value; .json and .geojson gzipped at level 6 by the pinned Bun's zlib; any other extension is an error, never a guess. The text figures are this Bun's, not what a host sends: zlib 1.3 gives 0.6–2.2 % other bytes for the same level, and Vercel sends text as brotli. They are a stand-in kept constant so that the figures compare over time, exact once plan 088 stores files in their transport encoding. The committed figures are those of linux-x64 with the pinned Bun: regenerate the ledger there or in a cloud session. `published.server` is bytes on disk: those files never travel.";

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

/** A published file's bytes on the wire: packed files at face value, text
 *  (JSON, GeoJSON) gzipped. An extension of neither list is refused: a raw
 *  `.glb` counted as if a host compressed it read 3.55 MB for 5.24. */
export function wireBytes(name: string, bytes: Uint8Array): number {
  if (PACKED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return bytes.length;
  }
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return gzipSync(bytes, { level: WIRE_GZIP_LEVEL }).length;
  }
  throw new Error(
    `ledger: ${name} has an extension the wire rule does not know: add it to PACKED_EXTENSIONS or TEXT_EXTENSIONS (lib/city/ledger.ts)`
  );
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

export type { SourceText } from "./source-lexer";

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

/**
 * The site tiles of a tileset JSON, spawn first: its root's children (as
 * `tileNode` writes them) beside the extras' tile list, in one order.
 * Throws on a tile that names a file the set `all` does not hold — a new
 * extras key, a third content — wherever that file lies: bytes must not
 * leave the gate by a name the ledger does not read. What the tileset
 * names outside its tiles is held by `unservedNames`; what lies in the
 * directory is counted or refused by `publishedLedger`.
 */
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
    const tile: LedgerTile = {
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
    const counted = new Set(tileSet(tile, "all", () => [], false));
    const uncounted = [...fileNames(nodes[i]), ...fileNames(info)].filter(
      (name) => !counted.has(name)
    );
    if (uncounted.length > 0) {
      throw new Error(
        `ledger: tile ${id} names ${uncounted.length} files that no set counts (a new key, a further content): ${unique(uncounted).join(", ")} — name them in tileSet (lib/city/ledger.ts)`
      );
    }
    return tile;
  });
}

/**
 * The strings anywhere in a tileset JSON that end in an extension of the
 * wire rule and are no served file of the site's directory: a name at the
 * tileset's root, under its extras or in a content, in the full tileset
 * or the lite profile's, that points out of the directory (`../common/…`)
 * or at nothing. Bytes must not leave the gate by such a name; the caller
 * throws on any. (By extension, not by a dot or a slash: a place is
 * called "St. Michael".)
 */
export function unservedNames(
  tileset: unknown,
  served: ReadonlySet<string>
): string[] {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      const file = [...PACKED_EXTENSIONS, ...TEXT_EXTENSIONS].some((ext) =>
        value.endsWith(ext)
      );
      if (file && !served.has(value)) {
        out.add(value);
      }
    } else if (typeof value === "object" && value !== null) {
      for (const inner of Object.values(value)) {
        walk(inner);
      }
    }
  };
  walk(tileset);
  return [...out].toSorted(codeOrder);
}

/** Every string under `value` that reads as a file's name or path: one
 *  with a dot or a slash (a tile's id, a kind and a refine mode have
 *  neither). */
function fileNames(value: unknown): string[] {
  if (typeof value === "string") {
    return /[./]/u.test(value) ? [value] : [];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.values(value).flatMap(fileNames);
}

/** Where a level lies for the ground detail (lib/city/ground-reach.ts):
 *  beyond its reach a level reads the rasters' far twins, within it the
 *  full ones. */
export type Reach = "beyond" | "within";

/**
 * Which of a terrain level's rasters and tables a tier reads at a reach:
 * the viewer's own rule (`rasterFiles` in app/_components/tile-rasters.ts
 * over the kinds a level acquires, scripts/ledger.ts `viewerReads`), handed
 * in by the caller so that the ledger counts what the viewer fetches and
 * states no second rule.
 */
export type RasterReads = (
  extras: Named,
  level: 0 | 1,
  phone: boolean,
  reach: Reach
) => string[];

/**
 * The ledger's sets of a tile, each what a visit fetches for it:
 *
 * - `far`: a tile seen from afar — the far buildings with their side
 *   files, the coarse terrain, its rasters and coarse side files;
 * - `fine`: its fine level beyond the ground detail's reach — the fine
 *   terrain, its dressing files and its rasters, the close-range ones as
 *   their far twins;
 * - `approached`: the same level once the camera came within reach: the
 *   set `fine` and the full rasters fetched on top of the twins (a level
 *   that lands within reach never fetches the twins, so its own cost is
 *   below this figure; a visit that flies in pays it);
 * - `near`: the buildings as baked;
 * - `ask`: the inquiry card's files;
 * - `all`: every file the tile names;
 * - `unvisited`: the files of `all` that none of the sets above fetches on
 *   either tier — the minimap's footprints and bridges, read by the build
 *   alone, and whatever a level names but no tier reads. A fetch that the
 *   viewer drops or adds moves it.
 */
export const LEDGER_SETS = [
  "far",
  "fine",
  "approached",
  "near",
  "ask",
  "all",
  "unvisited",
] as const;
/** The sets a visit fetches. */
const VISIT_SETS = ["far", "fine", "approached", "near", "ask"] as const;
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

/** The files the buildings' extras name that a visit reads: not the sky
 *  view's GPU blocks, which only `?svf=blocks` reads (`BLOCK_RASTER_KEYS`). */
const cityReads = (extras: Named): string[] =>
  names(
    Object.fromEntries(
      Object.entries(extras).filter(
        ([key]) => !(BLOCK_RASTER_KEYS as readonly string[]).includes(key)
      )
    )
  );

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
  /** the fine level at a reach: the dressing build fetches the sports
   *  table on every tier (its goals and nets) and samples the NDVI
   *  (tile-stream.ts `buildDressing`) */
  const fineAt = (reach: Reach): string[] => [
    fine.uri,
    ...reads(fine.extras, 0, phone, reach),
    ...names(fine.extras.dressing),
    ...names({ t: fine.extras.sportTable, n: fine.extras.ndvi }),
  ];
  switch (set) {
    case "far": {
      return unique([
        tile.cityFar,
        ...cityReads(tile.cityExtras),
        coarse.uri,
        ...reads(coarse.extras, 1, phone, "beyond"),
        ...names(coarse.extras.coarse),
      ]);
    }
    case "fine": {
      return unique(fineAt("beyond"));
    }
    case "approached": {
      return unique([...fineAt("beyond"), ...fineAt("within")]);
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
    case "unvisited": {
      const visited = new Set(
        VISIT_SETS.flatMap((visit) => [
          ...tileSet(tile, visit, reads, false),
          ...tileSet(tile, visit, reads, true),
        ])
      );
      return tileSet(tile, "all", reads, phone).filter((f) => !visited.has(f));
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

/* ------------------------------------------------------------- published */

/** Who fetches a published file that no tile names: `boot` every visit of
 *  a city, before its first frame; `site` a visit that asks for it, once;
 *  `server` no visitor at all (the server reads it). */
export const SITE_CLASSES = ["boot", "site", "server"] as const;
export type SiteClass = (typeof SITE_CLASSES)[number];

export interface SiteFileRule {
  class: SiteClass;
  /** the row's name in `published.kinds` */
  kind: string;
  /** the logical names it covers (a plain file's name is its own) */
  match: RegExp;
}

/**
 * Every published file that no tile of the tileset names, by its logical
 * name. A file that matches no row (and that no tile names) is an error:
 * whoever publishes a new one adds its row here and says who fetches it.
 *
 * Not a site's file, and in no class: `public/data/sites.json`, the
 * build's index of the sites it serves. The server reads it to render the
 * start page and the routes; no visitor fetches it, and it lies beside the
 * sites' directories, which is where this ledger reads.
 */
export const SITE_FILES: readonly SiteFileRule[] = [
  // the walker's first requests (city-walk-client.tsx)
  { kind: "manifest", class: "boot", match: /^manifest\.json$/u },
  { kind: "tileset", class: "boot", match: /^tileset\.json$/u },
  // the ground plate, fetched beside the boot's first tiles (create-app.ts)
  { kind: "plate", class: "boot", match: /^plate\.bin\.gz$/u },
  // the lite profile's stand-in for the tileset: the spawn tile alone
  { kind: "tileset-spawn", class: "site", match: /^tileset-spawn\.json$/u },

  { kind: "provenance", class: "site", match: /^provenance\.json$/u },
  { kind: "landmark-facts", class: "site", match: /^landmark-facts\.json$/u },
  { kind: "trams", class: "site", match: /^trams\.json$/u },
  { kind: "murals", class: "site", match: /^murals\.json$/u },
  {
    kind: "mural-drawings",
    class: "site",
    match: /^mural-[a-z]\d+\.(?:lines|wash)\.webp$/u,
  },
  { kind: "walks", class: "site", match: /^walks\.json$/u },
  { kind: "walk-photos", class: "site", match: /^walk-photo_[\w-]+\.webp$/u },
  { kind: "minimap", class: "site", match: /^minimap\.webp$/u },
  // the start page's picture of the site
  { kind: "site-map", class: "site", match: /^site-map\.webp$/u },
  // read by the server alone: the inquiry's knowledge (app/api/frag) and
  // the start page's figures (app/_lib/built-sites.ts)
  {
    kind: "stadtwissen",
    class: "server",
    match: /^stadtwissen(?:_\w+)?\.json$/u,
  },
  { kind: "site-stats", class: "server", match: /^site-stats\.json$/u },
];

/** A published file: its logical name and the name it is served under (the
 *  same for a file published plain, the manifest itself among them). */
export interface PublishedName {
  logical: string;
  served: string;
}

/** Every published file in exactly one class. */
export interface PublishedLedger {
  /** the manifest, the tileset and the ground plate: what every visit of
   *  a city fetches first */
  boot: Weight;
  /** every file of the published directory */
  files: number;
  /** each row of `SITE_FILES` that has files, with its class */
  kinds: Record<string, Weight & { class: SiteClass }>;
  /** read by the server alone, in bytes on disk: never on the wire */
  server: Weight;
  /** the site-wide files a visit fetches when it asks for them */
  site: Weight;
  /** every file a tile names (the set `all` over the site) */
  tiles: Weight;
}

/**
 * The published directory's files by class: a tile's (`tileFiles`, the
 * served names the tileset's tiles name) or a row's of `SITE_FILES`.
 * Throws, naming each, on a file that is in neither — a file published
 * beside the manifest must not be free — and on a file a tile names that
 * is not published.
 */
export function publishedLedger(
  published: readonly PublishedName[],
  tileFiles: ReadonlySet<string>,
  wire: (served: string) => number,
  disk: (served: string) => number
): PublishedLedger {
  const servedNames = new Set(published.map((p) => p.served));
  const missing = [...tileFiles].filter((f) => !servedNames.has(f)).toSorted();
  if (missing.length > 0) {
    throw new Error(
      `ledger: the tileset names ${missing.length} files that are not published: ${missing.join(", ")}`
    );
  }
  const byClass: Record<SiteClass, string[]> = {
    boot: [],
    site: [],
    server: [],
  };
  const byKind = new Map<string, { files: string[]; rule: SiteFileRule }>();
  const unlisted: string[] = [];
  for (const { logical, served } of published) {
    if (tileFiles.has(served)) {
      continue;
    }
    const rule = SITE_FILES.find((r) => r.match.test(logical));
    if (!rule) {
      unlisted.push(logical);
      continue;
    }
    byClass[rule.class].push(served);
    const kind = byKind.get(rule.kind) ?? { rule, files: [] };
    kind.files.push(served);
    byKind.set(rule.kind, kind);
  }
  if (unlisted.length > 0) {
    throw new Error(
      `ledger: ${unlisted.length} published files are in no class — no tile names them and no row of SITE_FILES (lib/city/ledger.ts) does: ${unlisted.toSorted().join(", ")}`
    );
  }
  const weight = (files: string[], rule: SiteClass) =>
    weigh(unique(files), rule === "server" ? disk : wire);
  return {
    files: servedNames.size,
    boot: weight(byClass.boot, "boot"),
    tiles: weigh([...tileFiles], wire),
    site: weight(byClass.site, "site"),
    server: weight(byClass.server, "server"),
    kinds: Object.fromEntries(
      [...byKind]
        .toSorted(([a], [b]) => codeOrder(a, b))
        .map(([kind, { files, rule }]) => [
          kind,
          { class: rule.class, ...weight(files, rule.class) },
        ])
    ),
  };
}

/* ---------------------------------------------------------------- ledger */

export const LEDGER_VERSION = 2;

/** Per tile, near (as baked) and far (simplified). */
export interface ByLevel<T> {
  far: Record<string, T>;
  near: Record<string, T>;
}

/** The buildings' geometry: each tile's vertices, triangles and decoded
 *  bytes. */
export type BuildingFigures = ByLevel<MeshFigures>;

/**
 * `qa/ledger.json`. Every figure but `dated` is a function of the tree.
 * A further section (a table of rasters, a browser's figures) is one more
 * field here and one more key of what scripts/ledger.ts `measure` returns:
 * `datedLedger` and `ledgerDiff` take whatever they are handed.
 */
export interface Ledger {
  /** what the bakes hand over and how they cross a tile's edge (plan 092,
   *  ledger-bake-store.ts) */
  bakeStore: BakeStoreLedger;
  /** what a browser reads (lib/city/ledger-browser.ts): absent until
   *  `--browser` has run */
  browser?: BrowserFigures;
  buildings: BuildingFigures;
  /** the bytes and requests of each set */
  bytes: Record<LedgerSet, SetLedger>;
  counters: Counters;
  /** the day the gated figures last changed (kept while they hold) */
  dated: string;
  /** every published file, in exactly one class */
  published: PublishedLedger;
  /** the watched tiles' dressing by kind, and its recorded part (plan 090
   *  phase 0, ledger-dressing.ts) */
  dressing: DressingLedger;
  /** every built site's rasters (plan 091 phase 0, ledger-rasters.ts) */
  rasters: RasterLedger;
  /** every built site's sky view as GPU blocks (plan 091 phase 2's trial,
   *  ledger-blocks.ts) */
  blocks: BlockLedger;
  site: string;
  tiles: number;
  /** the browser's timings, recorded, never compared */
  timings?: Timings;
  version: typeof LEDGER_VERSION;
  wire: string;
}

/** The paths `--check` never compares, each with everything under it
 *  (`dated`; a section's recorded part joins by its path, as
 *  `browser.readWith`). */
export const UNCOMPARED: readonly string[] = [
  "dated",
  DRESSING_UNCOMPARED,
  "timings",
  "browser.readWith",
];

/** Leaf paths with their values (`bytes.fine.spawn.bytes`). */
function leaves(
  value: unknown,
  uncompared: readonly string[],
  path = ""
): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (uncompared.includes(at)) {
        continue;
      }
      for (const [p, v] of leaves(inner, uncompared, at)) {
        out.set(p, v);
      }
    }
  } else {
    out.set(path, JSON.stringify(value));
  }
  return out;
}

/** Each gated figure that differs between the committed ledger and a fresh
 *  one, as `path: was → now` (`dated` is none): one that grew, one that
 *  shrank, one that is new and one that is gone. */
export function ledgerDiff(
  was: unknown,
  now: unknown,
  uncompared: readonly string[] = UNCOMPARED
): string[] {
  const a = leaves(was, uncompared);
  const b = leaves(now, uncompared);
  const paths = [...new Set([...a.keys(), ...b.keys()])].toSorted(codeOrder);
  return paths.flatMap((p) =>
    a.get(p) === b.get(p)
      ? []
      : [`${p}: ${a.get(p) ?? "(none)"} → ${b.get(p) ?? "(none)"}`]
  );
}

/** The heading's keys, in the order the file opens with. */
const HEADING = ["version", "site", "dated", "wire", "tiles"] as const;

/** The ledger to write: the committed one's date while no figure moved,
 *  else `today`; the heading first, then the sections in `fresh`'s order. */
export function datedLedger<G extends Omit<Ledger, "dated">>(
  fresh: G,
  committed: unknown,
  today: string
): G & { dated: string } {
  const was = committed as { dated?: unknown } | null;
  const kept =
    typeof was?.dated === "string" &&
    was.dated !== "" &&
    ledgerDiff(was, fresh).length === 0;
  const all: Record<string, unknown> = {
    ...fresh,
    dated: kept ? was.dated : today,
  };
  const order = [
    ...HEADING,
    ...Object.keys(fresh).filter((key) => !HEADING.some((h) => h === key)),
  ];
  // reason: the keys of `fresh` and `dated`, reordered
  return Object.fromEntries(order.map((key) => [key, all[key]])) as G & {
    dated: string;
  };
}
