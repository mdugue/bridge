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
 *
 * Any other argument is refused (exit 2) and nothing is written: a
 * mistyped `--check` must not pass as a write. It reads
 * public/data/<site>/, so a build (or `bun scripts/prepare-sites.ts
 * dresden`) comes first.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
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
import type { Counters, SourceText } from "../lib/city/ledger-counters";
import {
  ASK_KINDS,
  COARSE_DRESSING_KINDS,
  DRESSING_KINDS,
  MANIFEST_FILE,
} from "../lib/city/tile";
import type { DataManifest } from "../lib/city/tile";
import type { ContentExtras } from "../lib/city/tileset";
import { TILESET_FILE } from "../lib/city/tileset";
import { REFERENCE_SITE } from "../sites";

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
    .toSorted()
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

/** This machine, for a check that fails: the text's wire bytes are this
 *  Bun's zlib's. */
function machine(): string {
  const all = cpus();
  const model = all[0]?.model.trim() ?? "unknown CPU";
  return `${model} ×${all.length}, ${process.platform}-${process.arch}, Bun ${Bun.version}`;
}

/** The ledger's figures for `site`, from its published files and the
 *  sources under `root`. A further section is a further key here. */
export function measure(site: string, root = ROOT): Omit<Ledger, "dated"> {
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

/** The arguments the script takes. A new one (a section's switch) joins
 *  here; anything else is refused. */
export const FLAGS = ["--check"] as const;

export interface RunOptions {
  /** where the report goes */
  out?: (text: string) => void;
  /** the repository: its sources, `public/data/` and `qa/ledger.json` */
  root?: string;
  site?: string;
  today?: string;
}

/**
 * The script: writes the ledger, or with `--check` compares it. Returns
 * the exit code — 0 written or holding, 1 a figure differs (or none is
 * committed), 2 an argument it does not know.
 */
export function run(argv: readonly string[], opts: RunOptions = {}): number {
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
  const fresh = measure(site, root);
  if (!argv.includes("--check")) {
    const ledger = datedLedger(fresh, committed, today);
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    out(`${LEDGER_PATH} (${ledger.dated})\n`);
    return 0;
  }
  const moved = ledgerDiff(committed ?? {}, fresh);
  for (const line of moved) {
    out(`differs: ${line}\n`);
  }
  if (moved.length === 0) {
    out(`${LEDGER_PATH} holds\n`);
    return 0;
  }
  out(
    `${moved.length} figures differ: run bun scripts/ledger.ts and commit ${LEDGER_PATH}\n`
  );
  // the text's wire bytes are zlib's on CI's platform: a platform
  // difference shows here at a glance
  out(`platform: here ${machine()}\n`);
  return 1;
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2));
}
