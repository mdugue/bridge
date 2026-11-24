/**
 * Prepares every site this deployment serves, ahead of `dev` and `build`:
 * each site whose data is ready (`bun run site --all`) — or only the ones
 * named, `bun scripts/prepare-sites.ts leipzig unna` — goes through
 * prepare-data.ts into public/data/<site>/, the folder its route /<site>
 * streams from. Then the index, public/data/sites.json
 * (lib/city/site-index.ts), which the start page lists and the route
 * prerenders from; folders of sites no longer built are pruned. With
 * `PREPARE_SITES=dresden bun dev` only those sites are prepared and the
 * others stay served as they were built last (site-choice.ts). With
 * `--pull` (the web build) nothing is baked: each site comes from the
 * store as CI published it for this checkout (data-store.ts).
 *
 * A site is served exactly when its data is on disk at build time: in a
 * fresh clone that is every site whose folder is committed (ADR 0037 — all
 * fetched sites but Berlin today); a site whose folder is missing is left
 * out, never an error.
 */
import { parseSiteStats, SITE_STATS_FILE } from "../lib/city/site-stats";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  SITE_INDEX_FILE,
  SITE_MAP_FILE,
  siteDataBase,
} from "../lib/city/site-index";
import type { SiteIndex } from "../lib/city/site-index";
import { siteReport } from "../lib/city/site-report";
import { SERVER_WISSEN_DIR, STADTWISSEN_FILE } from "../lib/city/stadtwissen";
import type { StadtwissenIndex } from "../lib/city/stadtwissen";
import { MANIFEST_FILE } from "../lib/city/tile";
import type { DataManifest } from "../lib/city/tile";
import { TILESET_FILE } from "../lib/city/tileset";
import { SITES } from "../sites";
import type { SiteId } from "../sites";
import { chosenSites } from "./site-choice";
import { pullSite } from "./data-store";

const OUT_DIR = path.join(process.cwd(), "public/data");

function log(message: string): void {
  process.stdout.write(`prepare-sites: ${message}\n`);
}

function fail(message: string): never {
  process.stderr.write(`prepare-sites: ${message}\n`);
  process.exit(1);
}

/** Whether every tile of the site can be built from what is on disk. */
function isReady(id: SiteId): boolean {
  return siteReport(SITES[id], existsSync).every((t) => t.next === "ready");
}

/** prepare-data.ts for one site, each line it prints under the site's id
 *  (the bakes run side by side); resolves with whether it succeeded. It
 *  runs on this process's own Bun, not whichever `bun` comes first on the
 *  PATH. */
async function bake(id: SiteId): Promise<boolean> {
  const child = spawn(process.execPath, ["scripts/prepare-data.ts", id], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const [from, to] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ] as const) {
    createInterface({ input: from }).on("line", (line) => {
      to.write(`[${id}] ${line}\n`);
    });
  }
  return await new Promise((resolve) => {
    child.on("close", (code) => resolve(code === 0));
  });
}

/** The site from the store (`--pull`); a failure is its one line. */
async function pull(id: SiteId): Promise<boolean> {
  try {
    await pullSite(id, path.join(OUT_DIR, id));
    return true;
  } catch (error) {
    process.stderr.write(`[${id}] ${(error as Error).message}\n`);
    return false;
  }
}

/**
 * A bake is single-threaded and a whole site baked cold in one process
 * peaks at 2.3 GiB (Dresden; München 1.7, the small sites near 1,
 * 2026-11-24): as many side by side as the cores and the memory hold at
 * 4 GB each (the container's limit where it sets one), or `PREPARE_JOBS`.
 */
function bakesAtOnce(): number {
  const limit = process.constrainedMemory();
  const memory = limit > 0 ? Math.min(totalmem(), limit) : totalmem();
  return (
    Number(process.env.PREPARE_JOBS) ||
    Math.max(1, Math.min(availableParallelism(), Math.floor(memory / 4e9)))
  );
}

/** Prepares the sites, `lanes` at a time, largest first; resolves with
 *  the ones that failed. */
async function prepareAll(
  ids: readonly SiteId[],
  lanes: number,
  prepare: (id: SiteId) => Promise<boolean>
): Promise<SiteId[]> {
  const queue = [...ids].sort(
    (a, b) => SITES[b].tiles.length - SITES[a].tiles.length
  );
  const failed: SiteId[] = [];
  const lane = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      if (!(await prepare(id))) {
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return failed;
}

const PULL = "--pull";
const pulling = process.argv.includes(PULL);
const chosen = chosenSites({
  env: process.env.PREPARE_SITES,
  known: Object.keys(SITES),
  named: process.argv.slice(2).filter((arg) => arg !== PULL),
  ready: (id) => isReady(id as SiteId),
  built: (id) => existsSync(path.join(OUT_DIR, id, MANIFEST_FILE)),
});
if (chosen.unknown !== undefined) {
  fail(
    `unknown site "${chosen.unknown}"; known: ${Object.keys(SITES).join(", ")}`
  );
}
const ids = chosen.prepare as SiteId[];
/** prepared now, or left as built last (`PREPARE_SITES`): all served */
const served = Object.keys(SITES).filter(
  (id) => chosen.prepare.includes(id) || chosen.keep.includes(id)
) as SiteId[];
if (ids.length === 0) {
  fail("no site has its data on disk — run `bun run site --all`");
}
const skipped = Object.keys(SITES).filter(
  (id) => !served.includes(id as SiteId)
);
log(
  `${pulling ? "pulling" : "building"} ${ids.join(", ")}${chosen.keep.length > 0 ? ` (left as built last: ${chosen.keep.join(", ")})` : ""}${skipped.length > 0 ? ` (not ready or not named: ${skipped.join(", ")})` : ""}`
);

mkdirSync(OUT_DIR, { recursive: true });
const failed = pulling
  ? await prepareAll(ids, ids.length, pull)
  : await prepareAll(ids, bakesAtOnce(), bake);
if (failed.length > 0) {
  fail(`${failed.join(", ")} failed`);
}
const index: SiteIndex = { version: 1, sites: [] };
for (const id of served) {
  const manifest = JSON.parse(
    readFileSync(path.join(OUT_DIR, id, MANIFEST_FILE), "utf-8")
  ) as DataManifest;
  const map = manifest.files[SITE_MAP_FILE];
  const tileset = manifest.files[TILESET_FILE];
  const statsPath = path.join(OUT_DIR, id, SITE_STATS_FILE);
  const stats = existsSync(statsPath)
    ? parseSiteStats(JSON.parse(readFileSync(statsPath, "utf-8")))
    : undefined;
  index.sites.push({
    id,
    ...(map ? { map: `${siteDataBase(id)}/${map}` } : {}),
    ...(tileset ? { tileset: `${siteDataBase(id)}/${tileset}` } : {}),
    ...(stats ? { stats } : {}),
  });
}

writeFileSync(
  path.join(OUT_DIR, SITE_INDEX_FILE),
  `${JSON.stringify(index, null, 2)}\n`
);
publishServerWissen(served);
// Anything else at the top of public/data is a site no longer built, or the
// single-site layout that came before (its files sat there directly).
let pruned = 0;
for (const entry of readdirSync(OUT_DIR)) {
  if (entry !== SITE_INDEX_FILE && !served.includes(entry as SiteId)) {
    rmSync(path.join(OUT_DIR, entry), { recursive: true });
    pruned += 1;
  }
}
log(
  `${served.length} site(s) in public/data${pruned > 0 ? `, ${pruned} stale entries pruned` : ""}`
);

/**
 * The Stadtwissen again, outside public/, for the chat's server tools
 * (ADR 0056; next.config.ts traces this folder into the chat's function
 * and no other): the index and each tile's directory under its published
 * name. Rewritten whole, so a site no longer built leaves nothing.
 */
function publishServerWissen(siteIds: readonly SiteId[]): void {
  const root = path.join(process.cwd(), SERVER_WISSEN_DIR);
  rmSync(root, { recursive: true, force: true });
  for (const id of siteIds) {
    const from = path.join(OUT_DIR, id);
    const manifest = JSON.parse(
      readFileSync(path.join(from, MANIFEST_FILE), "utf-8")
    ) as DataManifest;
    const indexFile = manifest.files[STADTWISSEN_FILE];
    if (!indexFile) {
      continue;
    }
    const to = path.join(root, id);
    mkdirSync(to, { recursive: true });
    copyFileSync(path.join(from, indexFile), path.join(to, STADTWISSEN_FILE));
    const wissen = JSON.parse(
      readFileSync(path.join(from, indexFile), "utf-8")
    ) as StadtwissenIndex;
    for (const tile of wissen.tiles) {
      copyFileSync(path.join(from, tile.file), path.join(to, tile.file));
    }
  }
}
