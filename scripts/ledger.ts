/**
 * Writes or checks `qa/ledger.json` (plan 087; lib/city/ledger.ts has the
 * shapes and says what each figure is): the reference site's published
 * bytes and requests, its watched tiles' dressing, the product's code
 * lines, and what a browser reads. A pull request that moves a figure
 * commits the new file, and its diff is what the reviewer reads.
 *
 *   bun scripts/ledger.ts                  # write qa/ledger.json
 *   bun scripts/ledger.ts --check          # name each figure that differs, exit 1
 *   … --browser                            # with the browser's figures read
 *                                          # anew (e2e/ledger.spec.ts against a
 *                                          # NEXT_PUBLIC_POC_DEBUG=1 build);
 *                                          # else the committed ones stand
 *   bun scripts/ledger.ts --against <ref>  # code.product here and at <ref>,
 *                                          # nothing written: what a
 *                                          # milestone PR quotes
 *
 * Any other argument is refused (exit 2). It reads public/data/<site>/, so
 * a build (or `bun scripts/prepare-sites.ts`) comes first.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { gzipSync } from "node:zlib";
import {
  RASTER_KINDS,
  REACH_KINDS,
  rasterFiles,
} from "../app/_components/tile-rasters";
import type { RasterKind } from "../app/_components/tile-rasters";
import {
  browserFigures,
  bytesLedger,
  CODE_AREAS,
  DRESSING_TILES,
  dressingLedger,
  LEDGER_VERSION,
  ledgerDiff,
  ledgerTiles,
  NOT_CODE,
  productCode,
  publishedLedger,
  tileSet,
  wireBytes,
} from "../lib/city/ledger";
import type {
  BrowserFigures,
  BrowserReading,
  CodeLines,
  Ledger,
  PublishedName,
  RasterReads,
} from "../lib/city/ledger";
import { MANIFEST_FILE } from "../lib/city/tile";
import type { DataManifest } from "../lib/city/tile";
import type { ContentExtras } from "../lib/city/tileset";
import { TILESET_FILE } from "../lib/city/tileset";
import { REFERENCE_SITE } from "../sites";

const ROOT = nodePath.join(import.meta.dir, "..");
/** The ledger, relative to the repository's root. */
export const LEDGER_PATH = "qa/ledger.json";

/** A site's published files as the browser gets them. */
interface PublishedFiles {
  /** every name the manifest maps, logical → as served */
  files: Record<string, string>;
  /** every file of the published directory: the manifest's, and those
   *  published under their own name (the manifest itself among them) */
  names: PublishedName[];
  read: (served: string) => Uint8Array;
  tileset: unknown;
}

/** The ONE place the ledger finds a site's published files: the build's
 *  `public/data/<site>/`, listed itself, not the manifest alone. Plan 088
 *  points this at the published tileset the lock file names. */
function publishedFiles(site: string, root: string): PublishedFiles {
  const dir = nodePath.join(root, "public/data", site);
  const manifestPath = nodePath.join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(
      `ledger: no ${nodePath.relative(root, manifestPath)} — build first (bun scripts/prepare-sites.ts ${site})`
    );
  }
  const { files } = JSON.parse(
    readFileSync(manifestPath, "utf-8")
  ) as DataManifest;
  const read = (served: string) =>
    new Uint8Array(readFileSync(nodePath.join(dir, served)));
  const inManifest = new Set(Object.values(files));
  return {
    files,
    names: [
      ...Object.entries(files).map(([logical, served]) => ({
        logical,
        served,
      })),
      ...readdirSync(dir)
        .filter((name) => !inManifest.has(name))
        .map((name) => ({ logical: name, served: name })),
    ],
    read,
    tileset: JSON.parse(
      new TextDecoder().decode(read(files[TILESET_FILE] ?? TILESET_FILE))
    ),
  };
}

/**
 * The viewer's own rule for which rasters a level reads: every kind a
 * level acquires, through `rasterFiles`; beyond the ground detail's reach
 * the far twin of the kinds that follow the reach (`REACH_KINDS`).
 */
export const viewerReads: RasterReads = (extras, level, phone, reach) =>
  (Object.keys(RASTER_KINDS) as RasterKind[]).flatMap((kind) => {
    const files = rasterFiles(
      // reason: a terrain level's extras, read for their file names only
      { ...extras, level } as unknown as ContentExtras,
      kind,
      phone,
      reach === "beyond" && (REACH_KINDS as readonly string[]).includes(kind)
    );
    return files ? [files.raster, ...(files.table ? [files.table] : [])] : [];
  });

/** Git under `root`, without the variables a hook exports (a `GIT_DIR`
 *  would point it at another repository); its output, or its error. */
function git(root: string, args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  );
  const done = Bun.spawnSync(["git", ...args], { cwd: root, env });
  // git grep exits 1 where nothing matched: no code is a count, not a fault
  if (done.exitCode !== 0 && done.stderr.length > 0) {
    throw new Error(`ledger: git ${args[0]}: ${done.stderr.toString().trim()}`);
  }
  return done.stdout.toString();
}

/** `code.product` (lib/city/ledger.ts): each tracked file's lines that are
 *  code — in the work tree, or at `ref` — summed by area. */
export function codeProduct(root: string, ref?: string): CodeLines {
  const count = (notCode: string, extension: string) =>
    git(root, [
      "grep",
      "-c",
      "-v",
      "-E",
      notCode,
      ...(ref ? [ref] : []),
      "--",
      ...CODE_AREAS.map((area) => `${area}/*.${extension}`),
    ])
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [lines = "0", path = ""] = line.split(":").toReversed();
        return [path, Number(lines)] as const;
      });
  return productCode([
    ...count(NOT_CODE.ts, "ts"),
    ...count(NOT_CODE.ts, "tsx"),
    ...count(NOT_CODE.py, "py"),
  ]);
}

/** The ledger's figures for `site` but the browser's. */
export function measure(
  site: string,
  root: string,
  watched = DRESSING_TILES
): Omit<Ledger, "browser"> {
  const published = publishedFiles(site, root);
  const wireOf = new Map<string, number>();
  const wire = (served: string) => {
    const bytes =
      wireOf.get(served) ?? wireBytes(served, published.read(served));
    wireOf.set(served, bytes);
    return bytes;
  };
  const tiles = ledgerTiles(published.tileset);
  const tileFiles = new Set(
    tiles.flatMap((tile) => tileSet(tile, "all", viewerReads, false))
  );
  return {
    version: LEDGER_VERSION,
    site,
    tiles: tiles.length,
    published: publishedLedger(
      published.names,
      tileFiles,
      wire,
      (served) => published.read(served).length
    ),
    bytes: bytesLedger(tiles, viewerReads, wire),
    dressing: dressingLedger(tiles, watched, wire),
    code: { product: codeProduct(root) },
  };
}

/** The browser's figures, read now: runs e2e/ledger.spec.ts, which leaves
 *  its reading in a folder, and weighs the scripts with this Bun's zlib. */
function readBrowser(site: string, root: string): BrowserFigures {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "ledger-"));
  try {
    const done = Bun.spawnSync(
      ["bunx", "playwright", "test", "e2e/ledger.spec.ts", "--reporter=line"],
      {
        cwd: root,
        env: { ...process.env, LEDGER_OUT: dir },
        // Playwright's progress to stderr: stdout is the ledger's report
        stdio: ["ignore", process.stderr.fd, "inherit"],
      }
    );
    const file = nodePath.join(dir, "reading.json");
    if (done.exitCode !== 0 || !existsSync(file)) {
      throw new Error(
        `ledger: the browser's read failed (e2e/ledger.spec.ts, exit ${done.exitCode})`
      );
    }
    const served = Object.entries(publishedFiles(site, root).files);
    return browserFigures(
      JSON.parse(readFileSync(file, "utf-8")) as BrowserReading,
      (body) => gzipSync(Buffer.from(body, "base64"), { level: 9 }).length,
      (name) => served.find(([, as]) => as === name)?.[0]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `code.product` here and at `ref`, a line an area. */
function against(root: string, ref: string): string {
  const now = codeProduct(root);
  const was = codeProduct(root, ref);
  return ([...CODE_AREAS, "total"] as const)
    .map((area) => {
      const delta = now[area] - was[area];
      return `code.product.${area}: ${was[area]} (${ref}) → ${now[area]} (${delta < 0 ? "" : "+"}${delta})\n`;
    })
    .join("");
}

export interface RunOptions {
  /** where the report goes */
  out?: (text: string) => void;
  /** the repository: its sources, `public/data/` and `qa/ledger.json` */
  root?: string;
  site?: string;
  /** the tiles whose dressing is watched */
  watched?: Readonly<Record<string, string>>;
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
    watched,
  } = opts;
  if (argv[0] === "--against" && argv.length === 2 && argv[1]) {
    out(against(root, argv[1]));
    return 0;
  }
  const unknown = argv.filter((arg) => !["--check", "--browser"].includes(arg));
  if (unknown.length > 0) {
    out(
      `ledger: unknown argument ${unknown.join(" ")} (known: --check, --browser, --against <ref>); nothing written\n`
    );
    return 2;
  }
  const file = nodePath.join(root, LEDGER_PATH);
  const committed = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf-8")) as Partial<Ledger>)
    : {};
  const browser = argv.includes("--browser")
    ? readBrowser(site, root)
    : committed.browser;
  const fresh: Ledger = {
    ...measure(site, root, watched),
    ...(browser ? { browser } : {}),
  };
  if (!argv.includes("--check")) {
    writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`);
    out(`${LEDGER_PATH}\n`);
    return 0;
  }
  const moved = ledgerDiff(committed, fresh);
  for (const line of moved) {
    out(`differs: ${line}\n`);
  }
  if (!argv.includes("--browser")) {
    out("the browser figures were not compared (no --browser)\n");
  }
  if (moved.length === 0) {
    out(`${LEDGER_PATH} holds\n`);
    return 0;
  }
  // the text's wire bytes are this Bun's zlib's: a platform difference
  // shows here at a glance
  out(
    `${moved.length} figures differ: run bun scripts/ledger.ts${moved.some((m) => m.startsWith("browser.")) ? " --browser" : ""} and commit ${LEDGER_PATH} (here ${process.platform}-${process.arch}, Bun ${Bun.version})\n`
  );
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    // a site not built, a published file in no class, an extension the
    // wire rule does not know: the message is the report
    process.stdout.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
