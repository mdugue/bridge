/**
 * Prepares every site this deployment serves, ahead of `dev` and `build`:
 * each site whose data is ready (`bun run site --all`) — or only the ones
 * named, `bun scripts/prepare-sites.ts leipzig unna` — goes through
 * prepare-data.ts into public/data/<site>/, the folder its route /<site>
 * streams from. Then the index, public/data/sites.json
 * (lib/city/site-index.ts), which the start page lists and the route
 * prerenders from; folders of sites no longer built are pruned.
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
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  SITE_INDEX_FILE,
  SITE_MAP_FILE,
  type SiteIndex,
  siteDataBase,
} from "../lib/city/site-index";
import { siteReport } from "../lib/city/site-report";
import { type DataManifest, MANIFEST_FILE } from "../lib/city/tile";
import { type SiteId, SITES, siteById } from "../sites";

const OUT_DIR = join(process.cwd(), "public/data");

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
 *  (the sites run side by side); resolves with its exit code. */
function prepare(id: SiteId): Promise<number | null> {
  const child = spawn("bun", ["scripts/prepare-data.ts", id], {
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
  return new Promise((resolve) => {
    child.on("close", resolve);
  });
}

/**
 * Bakes the sites, each in its own process, several at a time: a bake is
 * single-threaded, so one after the other a cold build waited for every
 * site in turn (seven sites: ~4 min) where side by side it waits for the
 * largest (Dresden, ~2 min). Largest first, so it never starts last. A
 * cold bake peaks at ~3 GB (Dresden; the others ~1 GB), which bounds the
 * processes on a small machine as the cores do on a large one.
 */
async function prepareAll(ids: readonly SiteId[]): Promise<SiteId[]> {
  const queue = [...ids].sort(
    (a, b) => SITES[b].tiles.length - SITES[a].tiles.length
  );
  const jobs = Math.max(
    1,
    Math.min(queue.length, availableParallelism(), Math.floor(totalmem() / 3e9))
  );
  const failed: SiteId[] = [];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      if ((await prepare(id)) !== 0) {
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  return failed;
}

const named = process.argv.slice(2);
for (const id of named) {
  if (!siteById(id)) {
    fail(`unknown site "${id}"; known: ${Object.keys(SITES).join(", ")}`);
  }
}
const ids = (
  named.length > 0
    ? named
    : Object.keys(SITES).filter((id) => isReady(id as SiteId))
) as SiteId[];
if (ids.length === 0) {
  fail("no site has its data on disk — run `bun run site --all`");
}
const skipped = Object.keys(SITES).filter((id) => !ids.includes(id as SiteId));
log(
  `building ${ids.join(", ")}${skipped.length > 0 ? ` (not ready or not named: ${skipped.join(", ")})` : ""}`
);

mkdirSync(OUT_DIR, { recursive: true });
const failed = await prepareAll(ids);
if (failed.length > 0) {
  fail(`${failed.join(", ")} failed`);
}
const index: SiteIndex = { version: 1, sites: [] };
for (const id of ids) {
  const manifest = JSON.parse(
    readFileSync(join(OUT_DIR, id, MANIFEST_FILE), "utf8")
  ) as DataManifest;
  const map = manifest.files[SITE_MAP_FILE];
  const statsPath = join(OUT_DIR, id, SITE_STATS_FILE);
  const stats = existsSync(statsPath)
    ? parseSiteStats(JSON.parse(readFileSync(statsPath, "utf8")))
    : undefined;
  index.sites.push({
    id,
    ...(map ? { map: `${siteDataBase(id)}/${map}` } : {}),
    ...(stats ? { stats } : {}),
  });
}

writeFileSync(
  join(OUT_DIR, SITE_INDEX_FILE),
  `${JSON.stringify(index, null, 2)}\n`
);
// Anything else at the top of public/data is a site no longer built, or the
// single-site layout that came before (its files sat there directly).
let pruned = 0;
for (const entry of readdirSync(OUT_DIR)) {
  if (entry !== SITE_INDEX_FILE && !ids.includes(entry as SiteId)) {
    rmSync(join(OUT_DIR, entry), { recursive: true });
    pruned++;
  }
}
log(
  `${ids.length} site(s) in public/data${pruned > 0 ? `, ${pruned} stale entries pruned` : ""}`
);
