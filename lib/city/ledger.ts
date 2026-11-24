/**
 * The ledger's shapes and arithmetic (plan 087): the figures `qa/ledger.json`
 * holds and CI gates, each a function of the tree or of one browser read.
 *
 * - `published`: every file of the reference site's directory in exactly
 *   one class (a tile's, or a row of `SITE_FILES`); one in neither is an
 *   error, never a silence.
 * - `bytes`: bytes and requests of what a visit fetches for a tile, set by
 *   set (`LEDGER_SETS`).
 * - `dressing`: the watched tiles' dressing on the wire, kind by kind.
 * - `code.product`: the product's code lines, area by area.
 * - `browser`: the first load's JavaScript and a phone's tile cache
 *   (e2e/ledger.spec.ts reads them; `--browser`).
 *
 * Pure: scripts/ledger.ts reads the files and hands names and bytes in.
 *
 * The wire rule: `.png`, `.webp` and `.gz` at face value; `.json` and
 * `.geojson` gzipped at level 6 by the pinned Bun's zlib; any other
 * extension is an error. The text figures are a stand-in kept constant so
 * that they compare over time (a host sends brotli), those of linux-x64:
 * regenerate the ledger there. `published.server` is bytes on disk.
 */
import { gzipSync } from "node:zlib";
import { TERRAIN_RASTER_KEYS } from "./tileset";

const PACKED_EXTENSIONS = [".png", ".webp", ".gz"];
const TEXT_EXTENSIONS = [".json", ".geojson"];

/** A published file's bytes on the wire (the head's rule). */
export function wireBytes(name: string, bytes: Uint8Array): number {
  if (PACKED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return bytes.length;
  }
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return gzipSync(bytes, { level: 6 }).length;
  }
  throw new Error(
    `ledger: ${name} has an extension the wire rule does not know (lib/city/ledger.ts)`
  );
}

/* ------------------------------------------------------------------ sets */

type Named = Record<string, unknown>;

/** One site tile as the tileset names it (`buildTileset`'s tree). */
export interface LedgerTile {
  /** the inquiry card's files, by kind */
  ask: Named;
  /** the minimap's bridge decks */
  bridges?: string;
  /** the near buildings' content */
  city: string;
  /** the side files both building contents name */
  cityExtras: Named;
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
    const [cityFar, coarse] = nodes[i]?.children ?? [];
    const fine = coarse?.children?.[0];
    const id = String(info.id);
    return {
      id,
      cityFar: uriOf(cityFar, `${id} far buildings`),
      city: uriOf(cityFar?.children?.[0], `${id} buildings`),
      cityExtras: cityFar?.extras ?? {},
      terrain: {
        1: {
          uri: uriOf(coarse, `${id} coarse terrain`),
          extras: coarse?.extras ?? {},
        },
        0: {
          uri: uriOf(fine, `${id} fine terrain`),
          extras: fine?.extras ?? {},
        },
      },
      footprints: String(info.footprints),
      ...(typeof info.bridges === "string" ? { bridges: info.bridges } : {}),
      ask: (info.ask as Named | undefined) ?? {},
    };
  });
}

/** Where a level lies for the ground detail: beyond its reach a level
 *  reads the rasters' far twins, within it the full ones. */
export type Reach = "beyond" | "within";

/** Which of a terrain level's rasters and tables a tier reads at a reach:
 *  the viewer's own rule (scripts/ledger.ts `viewerReads`), handed in so
 *  that the ledger states no second one. */
export type RasterReads = (
  extras: Named,
  level: 0 | 1,
  phone: boolean,
  reach: Reach
) => string[];

/**
 * The ledger's sets of a tile, each what a visit fetches for it:
 * `far` a tile seen from afar (the far buildings, the coarse terrain,
 * their rasters and side files); `fine` its fine level beyond the ground
 * detail's reach; `approached` the same once the camera came within reach
 * (the full rasters on top of the twins); `near` the buildings as baked;
 * `ask` the inquiry card's files; `all` every file the tile names;
 * `unvisited` the files of `all` that no set above fetches on either tier.
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
const VISIT_SETS = ["far", "fine", "approached", "near", "ask"] as const;
export type LedgerSet = (typeof LEDGER_SETS)[number];

const names = (record: unknown): string[] =>
  typeof record === "object" && record !== null
    ? Object.values(record).filter((v): v is string => typeof v === "string")
    : [];

/** Every file a terrain level's extras name. */
const levelNames = (extras: Named): string[] => [
  ...TERRAIN_RASTER_KEYS.flatMap((key) => names({ file: extras[key] })),
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
  // the dressing build fetches the sports table on every tier; the coarse
  // level's tree file it reads too is the set `far`'s, fetched once
  // (tile-stream.ts `buildDressing`)
  const fineAt = (reach: Reach): string[] => [
    fine.uri,
    ...reads(fine.extras, 0, phone, reach),
    ...names(fine.extras.dressing),
    ...names({ t: fine.extras.sportTable }),
  ];
  switch (set) {
    case "far": {
      return unique([
        tile.cityFar,
        ...names(tile.cityExtras),
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
      return [tile.city];
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
        tile.bridges ?? "",
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
type TileWeight = Weight & { tile: string };
type Wire = (file: string) => number;

/** A set's figures: the spawn tile, the median and the largest tile, and
 *  the site (each file once, over every tile). */
export interface SetFigures {
  largest: TileWeight;
  median: TileWeight;
  site: Weight;
  spawn: TileWeight;
}
/** A set's figures on a desktop, and a phone's where they differ. */
export type SetLedger = SetFigures & { phone?: SetFigures };

const weigh = (files: readonly string[], wire: Wire): Weight => ({
  bytes: files.reduce((sum, file) => sum + wire(file), 0),
  files: files.length,
});

/** Strings by their code units: no locale reorders a gated figure. */
const codeOrder = (a: string, b: string): number =>
  a === b ? 0 : (a < b && -1) || 1;

/** The spawn (first), median (the lower of an even count) and largest tile
 *  by bytes; ties go to the tile id. */
function setFigures(
  perTile: readonly { files: string[]; tile: string }[],
  wire: Wire
): SetFigures {
  const weights = perTile.map(({ files, tile }) => ({
    tile,
    ...weigh(files, wire),
  }));
  const sorted = weights.toSorted(
    (a, b) => a.bytes - b.bytes || codeOrder(a.tile, b.tile)
  );
  const [spawn] = weights;
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const largest = sorted.at(-1);
  if (!(spawn && median && largest)) {
    throw new Error("ledger: no tiles");
  }
  const site = weigh(unique(perTile.flatMap((t) => t.files)), wire);
  return { spawn, median, largest, site };
}

/** Every set's figures over the site's tiles (the spawn tile first). */
export function bytesLedger(
  tiles: readonly LedgerTile[],
  reads: RasterReads,
  wire: Wire
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
    const differs = JSON.stringify(phone) !== JSON.stringify(desktop);
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
 *  `server` no visitor at all. */
type SiteClass = "boot" | "site" | "server";

/**
 * Every published file that no tile of the tileset names, by its logical
 * name: `[kind, class, match]`. Whoever publishes a new one adds its row
 * here and says who fetches it.
 */
export const SITE_FILES: readonly (readonly [string, SiteClass, RegExp])[] = [
  ["manifest", "boot", /^manifest\.json$/u],
  ["tileset", "boot", /^tileset\.json$/u],
  ["plate", "boot", /^plate\.bin\.gz$/u],
  // the lite profile's stand-in for the tileset: the spawn tile alone
  ["tileset-spawn", "site", /^tileset-spawn\.json$/u],
  ["provenance", "site", /^provenance\.json$/u],
  ["landmark-facts", "site", /^landmark-facts\.json$/u],
  ["trams", "site", /^trams\.json$/u],
  ["murals", "site", /^murals\.json$/u],
  ["mural-drawings", "site", /^mural-[a-z]\d+\.(?:lines|wash)\.webp$/u],
  ["walks", "site", /^walks\.json$/u],
  ["walk-photos", "site", /^walk-photo_[\w-]+\.webp$/u],
  ["minimap", "site", /^minimap\.webp$/u],
  ["site-map", "site", /^site-map\.webp$/u],
  // read by the server alone (app/api/frag, app/_lib/built-sites.ts)
  ["stadtwissen", "server", /^stadtwissen(?:_\w+)?\.json$/u],
  ["site-stats", "server", /^site-stats\.json$/u],
];

/** A published file: its logical name and the name it is served under. */
export interface PublishedName {
  logical: string;
  served: string;
}

/** Every published file in exactly one class. */
export interface PublishedLedger {
  boot: Weight;
  /** every file of the published directory */
  files: number;
  /** each row of `SITE_FILES` that has files, with its class */
  kinds: Record<string, Weight & { class: SiteClass }>;
  /** in bytes on disk: never on the wire */
  server: Weight;
  site: Weight;
  /** every file a tile names (the set `all` over the site) */
  tiles: Weight;
}

/**
 * The published directory's files by class: a tile's (`tileFiles`, served
 * names) or a row's of `SITE_FILES`. Throws on a file that is in neither
 * and on a file a tile names that is not published.
 */
export function publishedLedger(
  published: readonly PublishedName[],
  tileFiles: ReadonlySet<string>,
  wire: Wire,
  disk: Wire
): PublishedLedger {
  const served = new Set(published.map((p) => p.served));
  const missing = [...tileFiles].filter((f) => !served.has(f)).toSorted();
  if (missing.length > 0) {
    throw new Error(
      `ledger: the tileset names files that are not published: ${missing.join(", ")}`
    );
  }
  const byClass: Record<SiteClass, string[]> = {
    boot: [],
    site: [],
    server: [],
  };
  const byKind: Record<string, { class: SiteClass; files: string[] }> = {};
  const unlisted: string[] = [];
  for (const file of published) {
    if (tileFiles.has(file.served)) {
      continue;
    }
    const rule = SITE_FILES.find((row) => row[2].test(file.logical));
    if (!rule) {
      unlisted.push(file.logical);
      continue;
    }
    const [kind, siteClass] = rule;
    byClass[siteClass].push(file.served);
    byKind[kind] ??= { class: siteClass, files: [] };
    byKind[kind].files.push(file.served);
  }
  if (unlisted.length > 0) {
    throw new Error(
      `ledger: published files in no class — no tile names them and no row of SITE_FILES (lib/city/ledger.ts) does: ${unlisted.toSorted().join(", ")}`
    );
  }
  const weight = (files: string[], siteClass: SiteClass) =>
    weigh(unique(files), siteClass === "server" ? disk : wire);
  return {
    files: served.size,
    boot: weight(byClass.boot, "boot"),
    tiles: weigh([...tileFiles], wire),
    site: weight(byClass.site, "site"),
    server: weight(byClass.server, "server"),
    kinds: Object.fromEntries(
      Object.entries(byKind)
        .toSorted(([a], [b]) => codeOrder(a, b))
        .map(([kind, k]) => [
          kind,
          { class: k.class, ...weight(k.files, k.class) },
        ])
    ),
  };
}

/* -------------------------------------------------------------- dressing */

/** The reference site's tiles whose dressing is watched (plan 090), by
 *  what each is watched for. */
export const DRESSING_TILES: Readonly<Record<string, string>> = {
  spawn: "33412_5656_2_sn",
  forest: "33416_5658_2_sn",
  yards: "33410_5656_2_sn",
};

/** One level's dressing on the wire: a request a kind present. */
export interface DressingLevel extends Weight {
  kinds: Record<string, number>;
}

function dressingLevel(named: unknown, wire: Wire): DressingLevel {
  const kinds: Record<string, number> = {};
  for (const [kind, file] of Object.entries(named ?? {}).toSorted(([a], [b]) =>
    codeOrder(a, b)
  )) {
    if (typeof file === "string" && file !== "") {
      kinds[kind] = wire(file);
    }
  }
  const sizes = Object.values(kinds);
  return {
    bytes: sizes.reduce((sum, b) => sum + b, 0),
    files: sizes.length,
    kinds,
  };
}

export type DressingLedger = Record<
  string,
  { coarse: DressingLevel; fine: DressingLevel; tile: string }
>;

/** The watched tiles' dressing: the side files a level's extras name
 *  under `dressing` (fine, with the sports table its goals read) or
 *  `coarse`. A tile the site lacks is left out. */
export function dressingLedger(
  tiles: readonly LedgerTile[],
  watched: Readonly<Record<string, string>>,
  wire: Wire
): DressingLedger {
  const out: DressingLedger = {};
  for (const [what, id] of Object.entries(watched)) {
    const tile = tiles.find((t) => t.id === id);
    if (tile) {
      const fine = tile.terrain[0].extras;
      out[what] = {
        tile: id,
        fine: dressingLevel(
          { ...(fine.dressing as Named), sportTable: fine.sportTable },
          wire
        ),
        coarse: dressingLevel(tile.terrain[1].extras.coarse, wire),
      };
    }
  }
  return out;
}

/* ------------------------------------------------------------------ code */

/** Where the product's code lies: TypeScript, and the bakes' Python. */
export const CODE_AREAS = [
  "app",
  "lib",
  "components",
  "scripts",
  "pipeline/bake",
] as const;

/** The measuring tools themselves: the ledger and the compared plates
 *  (plan 087). The limits test's count (`wgsl-budget.ts`,
 *  `pipeline-budget.ts`) is the product's: the scene imports it. */
const MEASURING_TOOLS = new Set([
  "lib/city/ledger.ts",
  "scripts/ledger.ts",
  "scripts/plates.ts",
  "lib/city/plate-diff.ts",
  "lib/city/plate-pose.ts",
]);

/** Not the product: tests, fixtures, one-off probes and the tools above. */
const notProduct = (path: string): boolean =>
  /\.test\.[a-z]+$|(?:^|\/)__fixtures__\/|^scripts\/eval\//u.test(path) ||
  MEASURING_TOOLS.has(path);

/** A line that is no code, as `git grep -E` reads it: blank, or one that
 *  opens as a comment (TypeScript and JSX; Python). */
export const NOT_CODE = {
  ts: String.raw`^[[:space:]]*($|//|/\*|\*|\{/\*)`,
  py: "^[[:space:]]*($|#)",
} as const;

export type CodeLines = Record<(typeof CODE_AREAS)[number] | "total", number>;

/** The product's code lines by area, from each tracked file's count of
 *  lines that are code (`[path, lines]`). */
export function productCode(
  counts: readonly (readonly [string, number])[]
): CodeLines {
  const out = { total: 0 } as CodeLines;
  for (const area of CODE_AREAS) {
    out[area] = 0;
    for (const [path, lines] of counts) {
      if (path.startsWith(`${area}/`) && !notProduct(path)) {
        out[area] += lines;
      }
    }
    out.total += out[area];
  }
  return out;
}

/* --------------------------------------------------------------- browser */

/** What e2e/ledger.spec.ts read at `/dresden?scene=lite`, as it read it. */
export interface BrowserReading {
  /** the adapter the scene drew with */
  adapter: string;
  browser: string;
  /** every `/_next/static/*.js` the page or one of `FIRST_LOAD_WORKERS`
   *  fetched itself: its path, its raw body (base64), and `worker` when
   *  the page did not fetch it */
  firstLoad: { body: string; url: string; worker: boolean }[];
  /** the phone's tile cache (`getGpuDebug().tileCache.tiles`), settled */
  phone: { bytes: number; loaded: boolean; uri: string }[];
}

/** The named workers the first load waits for and counts. Not the BVH
 *  worker: it starts only when a building tile near the camera has no BVH
 *  yet, which at the spawn differs from read to read. */
export const FIRST_LOAD_WORKERS = ["ground", "niches", "scene"] as const;

interface JsWeight {
  files: number;
  gzip: number;
}

/** The ledger's browser figures, gated exactly but for `readWith`. */
export interface BrowserFigures {
  /** the first load's JavaScript, each raw body gzipped at level 9 by the
   *  pinned Bun; `workerOnly`: the files the page did not fetch itself */
  firstLoad: JsWeight & { workerOnly: JsWeight };
  /** the tile cache's own accounting (`calculateBytesUsed`) on an
   *  emulated phone, loaded contents by logical name: the lite profile's
   *  spawn tile. Not the phone's memory: what never reaches
   *  `calculateBytesUsed` moves nothing here. */
  phoneLiteSpawnCache: { bytes: number; contents: Record<string, number> };
  readWith: string;
}

/** The figures of a reading; `gzip` weighs a body, `logical` maps a
 *  served name back to the manifest's. */
export function browserFigures(
  reading: BrowserReading,
  gzip: (body: string) => number,
  logical: (served: string) => string | undefined
): BrowserFigures {
  const js = (files: BrowserReading["firstLoad"]): JsWeight => ({
    files: files.length,
    gzip: files.reduce((sum, f) => sum + gzip(f.body), 0),
  });
  const contents: Record<string, number> = {};
  for (const entry of reading.phone.filter((t) => t.loaded)) {
    const served = entry.uri.split("?")[0]?.split("/").at(-1) ?? "";
    const name = logical(served) ?? served;
    contents[name] = (contents[name] ?? 0) + entry.bytes;
  }
  return {
    readWith: `${reading.browser}, ${reading.adapter}`,
    firstLoad: {
      ...js(reading.firstLoad),
      workerOnly: js(reading.firstLoad.filter((f) => f.worker)),
    },
    phoneLiteSpawnCache: {
      bytes: Object.values(contents).reduce((sum, b) => sum + b, 0),
      contents: Object.fromEntries(
        Object.entries(contents).toSorted(([a], [b]) => a.localeCompare(b))
      ),
    },
  };
}

/* ---------------------------------------------------------------- ledger */

export const LEDGER_VERSION = 3;

/** `qa/ledger.json`. */
export interface Ledger {
  /** absent until `--browser` has run */
  browser?: BrowserFigures;
  bytes: Record<LedgerSet, SetLedger>;
  code: { product: CodeLines };
  dressing: DressingLedger;
  published: PublishedLedger;
  site: string;
  tiles: number;
  version: typeof LEDGER_VERSION;
}

/** The paths `--check` never compares: `code` has a check of its own
 *  (`--code --check`), which needs no build and lets a fall pass. */
const UNCOMPARED = new Set(["browser.readWith", "code"]);

/** Leaf paths with their values (`bytes.fine.spawn.bytes`). */
function leaves(value: unknown, path = ""): Map<string, string> {
  if (typeof value !== "object" || value === null) {
    return new Map([[path, JSON.stringify(value)]]);
  }
  const out = new Map<string, string>();
  for (const [key, inner] of Object.entries(value)) {
    const at = path ? `${path}.${key}` : key;
    if (!UNCOMPARED.has(at)) {
      for (const [p, v] of leaves(inner, at)) {
        out.set(p, v);
      }
    }
  }
  return out;
}

/** Each gated figure that differs between the committed ledger and a fresh
 *  one, as `path: was → now`: one that grew, one that shrank, one that is
 *  new and one that is gone. */
export function ledgerDiff(was: unknown, now: unknown): string[] {
  const a = leaves(was);
  const b = leaves(now);
  return [...new Set([...a.keys(), ...b.keys()])]
    .toSorted(codeOrder)
    .flatMap((p) =>
      a.get(p) === b.get(p)
        ? []
        : [`${p}: ${a.get(p) ?? "(none)"} → ${b.get(p) ?? "(none)"}`]
    );
}
