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
 *
 * It reads public/data/<site>/, so a build (or `bun scripts/prepare-sites.ts
 * dresden`) comes first.
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
  gatedWire,
  glbFigures,
  LEDGER_VERSION,
  ledgerDiff,
  ledgerTiles,
  layerModules,
  RECORDED_NOTE,
  seamModules,
  upstreamWorkarounds,
  WIRE_RULE,
  weigh,
  wireBytes,
} from "../lib/city/ledger";
import type {
  ByLevel,
  Counters,
  Ledger,
  MeshFigures,
  RasterReads,
  Recorded,
  SourceText,
} from "../lib/city/ledger";
import {
  DRESSING_RECORDED_NOTE,
  DRESSING_TILES,
  dressingLedger,
} from "../lib/city/ledger-dressing";
import type { DressingRecorded } from "../lib/city/ledger-dressing";
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

/** The gated part of the buildings' figures: their triangles. */
const triangles = (
  level: Record<string, MeshFigures>
): Record<string, { triangles: number }> =>
  Object.fromEntries(
    Object.entries(level).map(([tile, m]) => [tile, { triangles: m.triangles }])
  );

/** This machine, as the recorded figures name it. */
function machine(): string {
  const cpu = cpuCount();
  return `${cpu.model} ×${cpu.count}, ${process.platform}-${process.arch}, Bun ${Bun.version}`;
}

function cpuCount(): { count: number; model: string } {
  const all = cpus();
  return { count: all.length, model: all[0]?.model.trim() ?? "unknown CPU" };
}

/** The ledger's figures for `site`, from its published files: the gated
 *  ones and the recorded ones. */
export function measure(site: string): {
  gated: Omit<Ledger, "dated" | "recorded">;
  recorded: Omit<Recorded, "machine" | "read">;
} {
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
  const gated = gatedWire(wire);
  const tiles = ledgerTiles(published.tileset);
  const servedNames = Object.values(published.files).toSorted();
  const mesh = (served: string) =>
    glbFigures(new Uint8Array(gunzipSync(published.read(served))));
  const meshes: ByLevel<MeshFigures> = {
    near: Object.fromEntries(tiles.map((t) => [t.id, mesh(t.city)])),
    far: Object.fromEntries(tiles.map((t) => [t.id, mesh(t.cityFar)])),
  };
  return {
    gated: {
      version: LEDGER_VERSION,
      site,
      wire: WIRE_RULE,
      tiles: tiles.length,
      published: weigh(servedNames, gated),
      bytes: bytesLedger(tiles, viewerReads, gated),
      buildings: {
        near: triangles(meshes.near),
        far: triangles(meshes.far),
      },
      counters: counters(published.files),
      dressing: dressingLedger(tiles, DRESSING_TILES, gated),
    },
    recorded: {
      note: RECORDED_NOTE,
      published: weigh(servedNames, wire),
      bytes: bytesLedger(tiles, viewerReads, wire),
      buildings: meshes,
    },
  };
}

/** Where the dressing's measuring tools leave what they read
 *  (e2e/dressing-ledger.spec.ts, scripts/eval/): gitignored scratch. */
export const DRESSING_SCRATCH = nodePath.join(ROOT, ".cache/ledger-dressing");

const scratch = (name: string): unknown => {
  const file = nodePath.join(DRESSING_SCRATCH, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : undefined;
};

/** München's watched tile, where its site is built here. */
function muenchenDressing(was: unknown, today: string): unknown {
  if (!existsSync(nodePath.join(ROOT, "public/data/muenchen", MANIFEST_FILE))) {
    return was;
  }
  const published = publishedFiles("muenchen");
  const wire = (served: string) => wireBytes(served, published.read(served));
  const tiles = dressingLedger(
    ledgerTiles(published.tileset),
    [{ tile: "32690_5334_2_by", what: "heaviest" }],
    wire
  );
  const kept = was as { tiles?: unknown } | undefined;
  return ledgerDiff(kept?.tiles ?? {}, tiles).length === 0
    ? was
    : { read: today, tiles };
}

/**
 * The dressing's recorded section: the committed one, with whatever the
 * measuring tools left in the scratch folder since folded in — so a
 * machine that measured nothing writes it back as it was.
 */
function dressingRecorded(
  was: DressingRecorded | undefined,
  today: string
): DressingRecorded {
  const fold = (key: "browser" | "lines" | "stands") => {
    const read = scratch(key);
    return read === undefined ? was?.[key] : read;
  };
  const out: DressingRecorded = { note: DRESSING_RECORDED_NOTE };
  const members = {
    muenchen: muenchenDressing(was?.muenchen, today),
    browser: fold("browser"),
    stands: fold("stands"),
    lines: fold("lines"),
  };
  for (const [key, value] of Object.entries(members)) {
    if (value !== undefined) {
      out[key as keyof typeof members] = value;
    }
  }
  return out;
}

function main(check: boolean): void {
  const committed: unknown = existsSync(LEDGER_FILE)
    ? JSON.parse(readFileSync(LEDGER_FILE, "utf-8"))
    : null;
  const { gated, recorded } = measure(REFERENCE_SITE);
  if (check) {
    const moved = ledgerDiff(committed ?? {}, gated);
    for (const line of moved) {
      process.stdout.write(`differs: ${line}\n`);
    }
    // the recorded figures, for the reader only: never a failure
    const was = (committed as Partial<Ledger> | null)?.recorded;
    for (const line of ledgerDiff(
      {
        published: was?.published,
        bytes: was?.bytes,
        buildings: was?.buildings,
      },
      {
        published: recorded.published,
        bytes: recorded.bytes,
        buildings: recorded.buildings,
      }
    )) {
      process.stdout.write(`recorded, not compared: ${line}\n`);
    }
    process.stdout.write(
      moved.length === 0
        ? "qa/ledger.json holds\n"
        : `${moved.length} figures differ: run bun scripts/ledger.ts and commit qa/ledger.json\n`
    );
    if (moved.length > 0) {
      // the gated JSON bytes are zlib's on CI's platform: a platform
      // difference shows here at a glance
      process.stdout.write(
        `platform: here ${machine()}; the ledger's record: ${was?.machine ?? "(none)"}\n`
      );
      process.exitCode = 1;
    }
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const ledger = datedLedger(gated, recorded, committed, today, machine());
  ledger.dressingRecorded = dressingRecorded(ledger.dressingRecorded, today);
  writeFileSync(LEDGER_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
  process.stdout.write(`qa/ledger.json (${ledger.dated})\n`);
}

if (import.meta.main) {
  main(process.argv.includes("--check"));
}
