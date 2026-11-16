/**
 * Writes or checks `qa/ledger.json`, the rewrite series' ledger (plan 087):
 * the reference site's bytes and requests per tile and level, read from its
 * published tileset and manifest, and the complexity counters. The shapes
 * and the arithmetic are lib/city/ledger.ts; this reads the files. Every
 * figure is a function of the tree, so a second run writes the same file;
 * a pull request that moves one commits the new file, and its diff is what
 * the reviewer reads.
 *
 *   bun scripts/ledger.ts           # write qa/ledger.json
 *   bun scripts/ledger.ts --check   # name each figure that differs, exit 1
 *   … --browser                     # with what a browser reads
 *                                   # (scripts/ledger-browser.ts)
 *
 * It reads public/data/<site>/, so a build (or `bun scripts/prepare-sites.ts
 * dresden`) comes first; `--browser` the NEXT_PUBLIC_POC_DEBUG=1 build too.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import nodePath from "node:path";
import { gunzipSync } from "node:zlib";
import { RASTER_KINDS, rasterFiles } from "../app/_components/tile-rasters";
import type { RasterKind } from "../app/_components/tile-rasters";
import {
  bytesLedger,
  datedLedger,
  distinctExtensions,
  functionLines,
  glbFigures,
  LEDGER_VERSION,
  ledgerDiff,
  ledgerTiles,
  layerModules,
  seamModules,
  upstreamWorkarounds,
  WIRE_RULE,
  weigh,
  wireBytes,
} from "../lib/city/ledger";
import type {
  Counters,
  Ledger,
  RasterReads,
  SourceText,
} from "../lib/city/ledger";
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
import { browserSections, timingReport } from "./ledger-browser";

const ROOT = nodePath.join(import.meta.dir, "..");
export const LEDGER_FILE = nodePath.join(ROOT, "qa/ledger.json");

/** A site's published files as the browser gets them. */
export interface PublishedFiles {
  /** every published name, logical → as served */
  files: Record<string, string>;
  /** a served file's bytes */
  read: (served: string) => Uint8Array;
  /** the tileset JSON */
  tileset: unknown;
}

/**
 * The ONE place the ledger finds a site's published files: today the
 * build's `public/data/<site>/` and its manifest. Plan 088 points this at
 * the published tileset the lock file names, and nothing else changes.
 */
export function publishedFiles(site: string): PublishedFiles {
  const dir = nodePath.join(ROOT, "public/data", site);
  const manifestPath = nodePath.join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `ledger: no ${nodePath.relative(ROOT, manifestPath)} — build first (bun scripts/prepare-sites.ts ${site})`
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
  return {
    files: manifest.files,
    read,
    tileset: JSON.parse(new TextDecoder().decode(read(tilesetName))),
  };
}

const RASTER_KIND_NAMES = Object.keys(RASTER_KINDS) as RasterKind[];

/** The viewer's own rule for which rasters a level reads near the camera. */
export const viewerReads: RasterReads = (extras, level, phone) =>
  RASTER_KIND_NAMES.flatMap((kind) => {
    const files = rasterFiles(
      // reason: a terrain level's extras, read for their file names only
      { ...extras, level } as unknown as ContentExtras,
      kind,
      phone
    );
    return files ? [files.raster, ...(files.table ? [files.table] : [])] : [];
  });

/** The sources under `dir` (repo-relative) whose name passes `keep`. */
function sources(dir: string, keep: (name: string) => boolean): SourceText[] {
  return readdirSync(nodePath.join(ROOT, dir), {
    recursive: true,
    encoding: "utf-8",
  })
    .filter(keep)
    .toSorted()
    .map((name) => ({
      path: `${dir}/${name}`,
      text: readFileSync(nodePath.join(ROOT, dir, name), "utf-8"),
    }));
}

/** A TypeScript source, tests left out. */
const isSource = (name: string) =>
  /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name);

function counters(published: Record<string, string>): Counters {
  return {
    dressingKinds: DRESSING_KINDS.length,
    coarseDressingKinds: COARSE_DRESSING_KINDS.length,
    askKinds: ASK_KINDS.length,
    publishedExtensions: distinctExtensions(Object.keys(published)),
    layerModules: layerModules(
      sources("app/_components", (n) => n.endsWith("-layer.ts"))
    ),
    bootAppLines: functionLines(
      readFileSync(
        nodePath.join(ROOT, "app/_components/create-app.ts"),
        "utf-8"
      ),
      "bootApp"
    ),
    bakeSeamModules: seamModules(
      sources("pipeline/bake", (n) => n.endsWith(".py") && !n.includes("/"))
    ),
    upstreamWorkarounds: upstreamWorkarounds([
      ...sources("app", isSource),
      ...sources("lib", isSource),
    ]),
  };
}

/** This machine, for a check that fails: the JSON's wire bytes are zlib's. */
function machine(): string {
  const cpu = cpuCount();
  return `${cpu.model} ×${cpu.count}, ${process.platform}-${process.arch}, Bun ${Bun.version}`;
}

function cpuCount(): { count: number; model: string } {
  const all = cpus();
  return { count: all.length, model: all[0]?.model.trim() ?? "unknown CPU" };
}

/** The ledger's figures for `site`, from its published files. */
export function measure(site: string): Omit<Ledger, "dated"> {
  const published = publishedFiles(site);
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
  const servedNames = Object.values(published.files).toSorted();
  const mesh = (served: string) =>
    glbFigures(new Uint8Array(gunzipSync(published.read(served))));
  return {
    version: LEDGER_VERSION,
    site,
    wire: WIRE_RULE,
    tiles: tiles.length,
    published: weigh(servedNames, wire),
    bytes: bytesLedger(tiles, viewerReads, wire),
    buildings: {
      near: Object.fromEntries(tiles.map((t) => [t.id, mesh(t.city)])),
      far: Object.fromEntries(tiles.map((t) => [t.id, mesh(t.cityFar)])),
    },
    counters: counters(published.files),
  };
}

/** The browser's sections: read now with `--browser`, else the committed
 *  ones, which `--check` then does not compare. */
function browserPart(
  read: boolean,
  committed: Partial<Ledger> | null
): Pick<Ledger, "browser" | "timings"> {
  if (read) {
    return browserSections(publishedFiles(REFERENCE_SITE).files, machine());
  }
  return {
    ...(committed?.browser ? { browser: committed.browser } : {}),
    ...(committed?.timings ? { timings: committed.timings } : {}),
  };
}

function main(check: boolean, browser: boolean): void {
  const committed: unknown = existsSync(LEDGER_FILE)
    ? JSON.parse(readFileSync(LEDGER_FILE, "utf-8"))
    : null;
  const fresh = {
    ...measure(REFERENCE_SITE),
    ...browserPart(browser, committed as Partial<Ledger> | null),
  };
  if (check) {
    if (browser && fresh.timings) {
      process.stdout.write(timingReport(fresh.timings));
    }
    const moved = ledgerDiff(committed ?? {}, fresh);
    for (const line of moved) {
      process.stdout.write(`differs: ${line}\n`);
    }
    if (!browser) {
      process.stdout.write(
        "the browser figures were not compared (no --browser)\n"
      );
    }
    const rerun = moved.some((m) => m.startsWith("browser."))
      ? "bun scripts/ledger.ts --browser"
      : "bun scripts/ledger.ts";
    process.stdout.write(
      moved.length === 0
        ? "qa/ledger.json holds\n"
        : `${moved.length} figures differ: run ${rerun} and commit qa/ledger.json\n`
    );
    if (moved.length > 0) {
      // the JSON's wire bytes are zlib's on CI's platform: a platform
      // difference shows here at a glance
      process.stdout.write(`platform: here ${machine()}\n`);
      process.exitCode = 1;
    }
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const ledger = datedLedger(fresh, committed, today);
  writeFileSync(LEDGER_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(`qa/ledger.json (${ledger.dated})\n`);
}

if (import.meta.main) {
  main(process.argv.includes("--check"), process.argv.includes("--browser"));
}
