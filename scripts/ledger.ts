/**
 * Writes or checks `qa/ledger.json`, the rewrite series' ledger (plan 087):
 * the reference site's bytes and requests per tile and level, read from its
 * published tileset and manifest, every published file in a class, and the
 * complexity counters. The shapes and the arithmetic are lib/city/ledger.ts
 * and ledger-counters.ts; this reads the files. Every figure is a function
 * of the tree, so a second run writes the same file; a pull request that
 * moves one commits the new file, and its diff is what the reviewer reads.
 *
 *   bun scripts/ledger.ts           # write qa/ledger.json
 *   bun scripts/ledger.ts --check   # name each figure that differs, exit 1
 *   … --browser                     # with what a browser reads
 *                                   # (scripts/ledger-browser.ts)
 *   … --census                      # and plan 094's census: every built
 *                                   # site flown (implies --browser; tens
 *                                   # of minutes, never on CI)
 *
 * Any other argument is refused (exit 2) and nothing is written: a
 * mistyped `--check` must not pass as a write. It reads
 * public/data/<site>/, so a build (or `bun scripts/prepare-sites.ts`) comes
 * first: the reference site for the bytes and counters, and every site a
 * build serves for the `rasters` section (plan 091 phase 0,
 * scripts/ledger-rasters.ts). A write formats the file with oxfmt, as it is
 * committed; `--check` compares values, not layout. `--browser` reads the
 * NEXT_PUBLIC_POC_DEBUG=1 build too; without it the committed browser
 * figures stand, and `--check` says it did not compare them.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { gunzipSync } from "node:zlib";
import {
  RASTER_KINDS,
  REACH_KINDS,
  rasterFiles,
} from "../app/_components/tile-rasters";
import type { RasterKind } from "../app/_components/tile-rasters";
import {
  bytesLedger,
  datedLedger,
  distinctExtensions,
  glbFigures,
  LEDGER_VERSION,
  ledgerDiff,
  ledgerTiles,
  publishedLedger,
  tileSet,
  unservedNames,
  WIRE_RULE,
  wireBytes,
} from "../lib/city/ledger";
import type { Ledger, PublishedName, RasterReads } from "../lib/city/ledger";
import {
  layerModules,
  longestFunction,
  seamModules,
  upstreamWorkarounds,
} from "../lib/city/ledger-counters";
import type { Counters } from "../lib/city/ledger-counters";
import type { SourceText } from "../lib/city/source-lexer";
import {
  ASK_KINDS,
  COARSE_DRESSING_KINDS,
  DRESSING_KINDS,
  MANIFEST_FILE,
} from "../lib/city/tile";
import type { DataManifest } from "../lib/city/tile";
import type { ContentExtras } from "../lib/city/tileset";
import { TILESET_FILE, TILESET_SPAWN_FILE } from "../lib/city/tileset";
import { REFERENCE_SITE } from "../sites";
import { measureBakeStore } from "./ledger-bake-store";
import { browserSections, timingReport } from "./ledger-browser";
import { measureDressing } from "./ledger-dressing";
import { rasterLedger, readySites } from "./ledger-rasters";

const ROOT = nodePath.join(import.meta.dir, "..");
/** The ledger, relative to the repository's root. */
export const LEDGER_PATH = "qa/ledger.json";
export const LEDGER_FILE = nodePath.join(ROOT, LEDGER_PATH);
/** Where the workarounds for a dependency's bugs are registered. */
export const WORKAROUND_REGISTER = "docs/rendering.md";
/** Where the viewer's and the build's TypeScript lies; a root that does
 *  not exist (yet: plan 095's packages) is none. */
export const SOURCE_ROOTS = ["app", "lib", "packages"] as const;
/** Where the bakes lie. */
export const BAKE_ROOT = "pipeline/bake";

/** A site's published files as the browser gets them. */
export interface PublishedFiles {
  /** every name the manifest maps, logical → as served */
  files: Record<string, string>;
  /** every file of the published directory: the manifest's, and those
   *  published under their own name (the manifest itself among them) */
  names: PublishedName[];
  /** a served file's bytes */
  read: (served: string) => Uint8Array;
  /** the tileset JSON */
  tileset: unknown;
}

/**
 * The ONE place the ledger finds a site's published files: today the
 * build's `public/data/<site>/` and its manifest. Plan 088 points this at
 * the published tileset the lock file names, and nothing else changes.
 * It lists the directory itself, not the manifest alone: a file published
 * beside the manifest is a published file.
 */
export function publishedFiles(site: string, root = ROOT): PublishedFiles {
  const dir = nodePath.join(root, "public/data", site);
  const manifestPath = nodePath.join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `ledger: no ${nodePath.relative(root, manifestPath)} — build first (bun scripts/prepare-sites.ts ${site})`
    );
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8")
  ) as DataManifest;
  const read = (served: string) =>
    new Uint8Array(readFileSync(nodePath.join(dir, served)));
  const tilesetName = manifest.files[TILESET_FILE];
  if (tilesetName === undefined) {
    throw new Error(`ledger: the manifest names no ${TILESET_FILE}`);
  }
  const named = Object.entries(manifest.files).map(([logical, served]) => ({
    logical,
    served,
  }));
  const inManifest = new Set(named.map((n) => n.served));
  const plain = readdirSync(dir)
    .filter((name) => !inManifest.has(name))
    .map((name) => ({ logical: name, served: name }));
  return {
    files: manifest.files,
    names: [...named, ...plain],
    read,
    tileset: JSON.parse(new TextDecoder().decode(read(tilesetName))),
  };
}

const RASTER_KIND_NAMES = Object.keys(RASTER_KINDS) as RasterKind[];
const FOLLOWS_REACH: ReadonlySet<RasterKind> = new Set(REACH_KINDS);

/**
 * The viewer's own rule for which rasters a level reads: every kind a
 * level acquires (terrain-layer.ts `loadTerrainRasters`), through
 * `rasterFiles`; beyond the ground detail's reach the far twin of the
 * kinds that follow the reach (`REACH_KINDS`, what `loadReachSet` swaps).
 * scripts/ledger.test.ts holds this against terrain-layer.ts's own calls.
 */
export const viewerReads: RasterReads = (extras, level, phone, reach) =>
  RASTER_KIND_NAMES.flatMap((kind) => {
    const files = rasterFiles(
      // reason: a terrain level's extras, read for their file names only
      { ...extras, level } as unknown as ContentExtras,
      kind,
      phone,
      reach === "beyond" && FOLLOWS_REACH.has(kind)
    );
    return files ? [files.raster, ...(files.table ? [files.table] : [])] : [];
  });

/** The sources under `dir` (relative to `root`) whose name passes `keep`,
 *  at any depth; none where `dir` is not there. */
function sources(
  root: string,
  dir: string,
  keep: (name: string) => boolean
): SourceText[] {
  if (!existsSync(nodePath.join(root, dir))) {
    return [];
  }
  return readdirSync(nodePath.join(root, dir), {
    recursive: true,
    encoding: "utf-8",
  })
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => !name.split("/").includes("node_modules") && keep(name))
    .map((name) => ({
      path: `${dir}/${name}`,
      text: readFileSync(nodePath.join(root, dir, name), "utf-8"),
    }));
}

/** The complexity counters of the tree at `root` (ledger-counters.ts says
 *  what each counts). */
export function counters(root: string, published: readonly string[]): Counters {
  const typescript = SOURCE_ROOTS.flatMap((dir) =>
    sources(root, dir, (name) => /\.tsx?$/u.test(name))
  );
  return {
    dressingKinds: DRESSING_KINDS.length,
    coarseDressingKinds: COARSE_DRESSING_KINDS.length,
    askKinds: ASK_KINDS.length,
    publishedExtensions: distinctExtensions(published),
    layerModules: layerModules(typescript),
    longestFunction: longestFunction(typescript),
    bakeSeamModules: seamModules(
      sources(root, BAKE_ROOT, (name) => name.endsWith(".py"))
    ),
    upstreamWorkarounds: upstreamWorkarounds(
      typescript,
      readFileSync(nodePath.join(root, WORKAROUND_REGISTER), "utf-8")
    ),
  };
}

/** This platform, for a check that fails: the text's wire bytes are this
 *  Bun's zlib's. */
const platform = (): string =>
  `${process.platform}-${process.arch}, Bun ${Bun.version}`;

/** Throws where a tileset of the site — the full one or the lite
 *  profile's — names a file that is not served from its directory. */
function refuseUnserved(published: PublishedFiles): void {
  const served = new Set(published.names.map((n) => n.served));
  for (const logical of [TILESET_FILE, TILESET_SPAWN_FILE]) {
    const name = published.files[logical];
    if (name === undefined) {
      continue;
    }
    const unserved = unservedNames(
      JSON.parse(new TextDecoder().decode(published.read(name))),
      served
    );
    if (unserved.length > 0) {
      throw new Error(
        `ledger: ${logical} names ${unserved.length} files that the site does not serve: ${unserved.join(", ")}`
      );
    }
  }
}

/** The ledger's figures for `site`, from its published files and the
 *  sources under `root` (the rasters are every site's, `measureRasters`). */
export function measure(
  site: string,
  root = ROOT
): Omit<Ledger, "bakeStore" | "dated" | "dressing" | "rasters"> {
  const published = publishedFiles(site, root);
  const wireOf = new Map<string, number>();
  const wire = (served: string) => {
    let bytes = wireOf.get(served);
    if (bytes === undefined) {
      bytes = wireBytes(served, published.read(served));
      wireOf.set(served, bytes);
    }
    return bytes;
  };
  const tiles = ledgerTiles(published.tileset);
  refuseUnserved(published);
  const tileFiles = new Set(
    tiles.flatMap((tile) => tileSet(tile, "all", viewerReads, false))
  );
  const mesh = (served: string) =>
    glbFigures(new Uint8Array(gunzipSync(published.read(served))));
  return {
    version: LEDGER_VERSION,
    site,
    wire: WIRE_RULE,
    tiles: tiles.length,
    published: publishedLedger(
      published.names,
      tileFiles,
      wire,
      (served) => published.read(served).length
    ),
    bytes: bytesLedger(tiles, viewerReads, wire),
    buildings: {
      near: Object.fromEntries(tiles.map((t) => [t.id, mesh(t.city)])),
      far: Object.fromEntries(tiles.map((t) => [t.id, mesh(t.cityFar)])),
    },
    counters: counters(
      root,
      published.names.map((n) => n.logical)
    ),
  };
}

/** Every built site's rasters (plan 091 phase 0): the sites a build
 *  serves from `root`'s data, each of which must be built. */
export async function measureRasters(root = ROOT): Promise<Ledger["rasters"]> {
  return await rasterLedger(
    readySites(root),
    (site) => publishedFiles(site, root),
    sources(root, "app", (name) => /(?<!\.test)\.tsx?$/u.test(name))
  );
}

/** Formats a written file with the repository's formatter (oxfmt, as
 *  `bun run fix` and the lint's `--check` do), so a fresh run writes the
 *  committed file byte for byte. */
function formatAsCommitted(file: string): void {
  const done = Bun.spawnSync(
    [nodePath.join(ROOT, "node_modules/.bin/oxfmt"), file],
    { cwd: ROOT, stdout: "ignore", stderr: "pipe" }
  );
  if (done.exitCode !== 0) {
    throw new Error(`ledger: oxfmt failed: ${done.stderr.toString()}`);
  }
}

/** The arguments the script takes. A new one (a section's switch) joins
 *  here; anything else is refused. */
export const FLAGS = ["--check", "--browser", "--census"] as const;

export interface RunOptions {
  /** where the report goes */
  out?: (text: string) => void;
  /** the repository: its sources, `public/data/` and `qa/ledger.json` */
  root?: string;
  site?: string;
  today?: string;
}

/** The browser's sections (lib/city/ledger-browser.ts): read now with
 *  `--browser`, else the committed ones, which `--check` then does not
 *  compare; the census (recorded only) read with `--census` over every
 *  built site, else the committed one. */
async function browserPart(
  read: { browser: boolean; census: boolean },
  site: string,
  root: string,
  committed: Partial<Ledger> | null
): Promise<Pick<Ledger, "browser" | "census" | "timings">> {
  const kept = committed?.census ? { census: committed.census } : {};
  if (read.browser || read.census) {
    const fresh = await browserSections(
      publishedFiles(site, root).files,
      platform(),
      root,
      read.census ? readySites(root) : []
    );
    return { ...kept, ...fresh };
  }
  return {
    ...(committed?.browser ? { browser: committed.browser } : {}),
    ...(committed?.timings ? { timings: committed.timings } : {}),
    ...kept,
  };
}

/**
 * The script: writes the ledger, or with `--check` compares it. Returns
 * the exit code — 0 written or holding, 1 a figure differs (or none is
 * committed), 2 an argument it does not know.
 */
export async function run(
  argv: readonly string[],
  opts: RunOptions = {}
): Promise<number> {
  const {
    out = (text: string) => {
      process.stdout.write(text);
    },
    root = ROOT,
    site = REFERENCE_SITE,
    today = new Date().toISOString().slice(0, 10),
  } = opts;
  const known: readonly string[] = FLAGS;
  const unknown = argv.filter((arg) => !known.includes(arg));
  if (unknown.length > 0) {
    out(
      `ledger: unknown argument ${unknown.join(" ")} (known: ${FLAGS.join(", ")}); nothing written\n`
    );
    return 2;
  }
  const file = nodePath.join(root, LEDGER_PATH);
  const committed: unknown = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf-8"))
    : null;
  // one key a section: the reference site's, then every site's rasters,
  // then the dressing (its recorded part only on a write: the check
  // never compares it), then the bakes' hand-over (plan 092), then what a
  // browser read (`--browser`)
  const check = argv.includes("--check");
  const census = argv.includes("--census");
  const browser = argv.includes("--browser") || census;
  const fresh = {
    ...measure(site, root),
    rasters: await measureRasters(root),
    dressing: measureDressing(
      site,
      root,
      publishedFiles,
      check ? undefined : { committed, today }
    ),
    bakeStore: measureBakeStore(root),
    ...(await browserPart(
      { browser, census },
      site,
      root,
      committed as Partial<Ledger> | null
    )),
  };
  if (!check) {
    const ledger = datedLedger(fresh, committed, today);
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    formatAsCommitted(file);
    out(`${LEDGER_PATH} (${ledger.dated})\n`);
    return 0;
  }
  if (browser && fresh.timings) {
    out(timingReport(fresh.timings));
  }
  const moved = ledgerDiff(committed ?? {}, fresh);
  for (const line of moved) {
    out(`differs: ${line}\n`);
  }
  if (!browser) {
    out("the browser figures were not compared (no --browser)\n");
  }
  if (moved.length === 0) {
    out(`${LEDGER_PATH} holds\n`);
    return 0;
  }
  out(
    `${moved.length} figures differ: run bun scripts/ledger.ts${moved.some((m) => m.startsWith("browser.")) ? " --browser" : ""} and commit ${LEDGER_PATH}\n`
  );
  // the text's wire bytes are zlib's on CI's platform: a platform
  // difference shows here at a glance
  out(`platform: here ${platform()}\n`);
  return 1;
}

/**
 * The script as the shell starts it: `run`, with what it throws — a site
 * not built, a published file in no class, an extension the wire rule does
 * not know — printed as its message. Exit 1: the ledger does not hold.
 */
export async function main(
  argv: readonly string[],
  opts: RunOptions = {}
): Promise<number> {
  try {
    return await run(argv, opts);
  } catch (error) {
    const out = opts.out ?? ((text: string) => process.stdout.write(text));
    out(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
