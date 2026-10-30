/**
 * What every step of scripts/prepare-data.ts shares: the site and mode this
 * run bakes, the log, the publisher and the bake cache (`cached`: the local
 * entry, else the shared one, else baked). Every cache key carries this
 * module (`COMMON_SOURCES`), the gzip level and the JSON encoding among it,
 * so it holds plumbing only: a bake belongs in the module of its step.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tileIds } from "../../lib/city/tile";
import { siteFromArgs } from "../../sites";
import { bakeMode, NOT_CACHED } from "../warmers";
import { readLockfile } from "../bake-sources";
import { cachedEntry, writeEntry } from "../bake-cache";
import { KEY_PLUMBING, KEY_STOPS } from "../bake-entries";
import { createKeyMaker } from "../cache-keys";
import { sharedCache } from "../shared-cache";
import { createPublisher } from "../publisher";

/** On Vercel the cache lives under `.next/cache`, the one folder (with
 *  node_modules) its Next.js builds carry from one deployment to the next;
 *  elsewhere under `.cache`, so clearing `.next` keeps a local bake. */
const CACHE_DIR = join(
  process.cwd(),
  process.env.VERCEL ? ".next/cache/prepare-data" : ".cache/prepare-data"
);
export const { MODE, SITE } = (() => {
  try {
    const { rest, site } = siteFromArgs(process.argv.slice(2));
    return { MODE: bakeMode(rest, tileIds(site)), SITE: site };
  } catch (error) {
    process.stderr.write(`prepare-data: ${(error as Error).message}\n`);
    process.exit(2);
  }
})();
export const OUT_DIR = join(process.cwd(), "public/data", SITE.id);
export const TILES = tileIds(SITE);
/** A warmer (warmers.ts; prepare-sites.ts runs them only with
 *  PREPARE_WARMERS=1) only fills the cache for its own tiles: it publishes
 *  nothing — no file under public/data, no manifest, no prune. */
export const WARMING = MODE.kind !== "publish";
/** The tiles this run bakes. */
export const OWN = new Set(MODE.kind === "publish" ? TILES : MODE.tiles);
/** What a missing source means for a site that has not been fetched yet. */
export const HINT = ` — run \`bun run fetch ${SITE.id}\` and \`bun run bake ${SITE.id}\``;

export function fail(message: string): never {
  process.stderr.write(`prepare-data: ${message}\n`);
  process.exit(1);
}

export function log(message: string): void {
  process.stdout.write(`prepare-data: ${message}\n`);
}

/** Whole milliseconds since `t0` (`performance.now()`), for the timing
 *  lines. */
export const since = (t0: number) => Math.round(performance.now() - t0);
export const started = performance.now();

export const at = (path: string) => join(process.cwd(), path);
export const utf8 = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);
export const parse = <T>(bytes: Uint8Array): T =>
  JSON.parse(new TextDecoder().decode(bytes)) as T;
export const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

// --- publish ------------------------------------------------------------------

export const publisher = createPublisher(OUT_DIR, { warming: WARMING });
export const publish = publisher.publish;

// --- cache --------------------------------------------------------------------

/** What every key carries: this module (the cache and the encodings), the site's own
 *  config and the dependency patches (the glTF tools' versions shape the
 *  output too). Not the other sites' configs, nor what only the viewer
 *  reads: an artifact's own bake brings its sources (`cacheKey`'s
 *  `entries`). Each must exist: the hasher reads a missing file as
 *  "absent" (an optional input's right answer), which would drop it from
 *  every key without a word. */
const COMMON_SOURCES = [
  ...KEY_PLUMBING,
  `sites/${SITE.id}.ts`,
  "sites/providers.ts",
  ...readdirSync(at("patches")).map((name) => `patches/${name}`),
].map((source) => {
  if (!existsSync(at(source))) {
    fail(
      `missing source file ${source} — every cache key carries it (a site's config is sites/<site id>.ts)`
    );
  }
  return at(source);
});

/** The lockfile: a key carries what it resolved for the packages the
 *  key's modules import (cache-keys.ts). */
const LOCKFILE = "bun.lock";
if (!existsSync(at(LOCKFILE))) {
  fail(`missing ${LOCKFILE} — every cache key carries the versions it holds`);
}
const keys = createKeyMaker({
  root: process.cwd(),
  common: COMMON_SOURCES,
  stop: KEY_STOPS,
  lockfile: readLockfile(readFileSync(at(LOCKFILE), "utf8")),
});
export const cacheKey = keys.key;

/**
 * A site-wide artifact's cache name. Every site shares the cache, and
 * `cached` keeps one entry per name: unscoped, each site's build would evict
 * the entry of the site built before it (and re-bake its own on every run).
 * A tile's names need no scope while no two sites share a tile.
 */
export const siteWide = (name: string) => `${SITE.id}.${name}`;

/** Every branch's bake cache, behind the local one (shared-cache.ts). */
const SHARED = sharedCache(
  process.env,
  log,
  `bun ${Bun.version} ${process.platform}-${process.arch}`
);
log(`shared bake cache: ${SHARED.reason}`);

/** The entry from the shared cache, written to the local one, or null. */
async function fromShared(
  name: string,
  key: string
): Promise<{ bytes: Uint8Array; path: string } | null> {
  const bytes = await SHARED.cache?.get(name, key);
  return bytes
    ? { bytes, path: writeEntry(CACHE_DIR, name, key, bytes) }
    : null;
}

/** A baked entry, written to the local cache and noted for the shared one
 *  (`settleShared` uploads it, read back from the local cache). */
function store(name: string, key: string, bytes: Uint8Array): string {
  const path = writeEntry(CACHE_DIR, name, key, bytes);
  SHARED.cache?.put(name, key, () =>
    existsSync(path) ? readFileSync(path) : null
  );
  return path;
}

/** `--if-cached` (warmers.ts) stops at the first entry it would bake. */
function mayBake(name: string): void {
  if (MODE.kind === "publish" && MODE.ifCached) {
    log(`${name} is not cached: the warmers bake the site`);
    process.exit(NOT_CACHED);
  }
}

/** The cached bytes for `key`, or the baked ones (then cached: one entry
 *  per name, written whole — bake-cache.ts). */
export async function cached(
  name: string,
  key: string,
  bake: () => Promise<Uint8Array> | Uint8Array
): Promise<Uint8Array> {
  const path = cachedEntry(CACHE_DIR, name, key);
  if (path) {
    return readFileSync(path);
  }
  const shared = await fromShared(name, key);
  if (shared) {
    return shared.bytes;
  }
  mayBake(name);
  const bytes = await bake();
  store(name, key, bytes);
  return bytes;
}

/** Where the cached entry for `key` lies, baked first when it is not
 *  there — for an entry read later, or only in part. */
export async function cachedFile(
  name: string,
  key: string,
  bake: () => Promise<Uint8Array> | Uint8Array
): Promise<string> {
  const path =
    cachedEntry(CACHE_DIR, name, key) ?? (await fromShared(name, key))?.path;
  if (path) {
    return path;
  }
  mayBake(name);
  return store(name, key, await bake());
}

/** Bun's libdeflate: at the same level about twice as fast as zlib here and
 *  a little smaller (the site's glTF: 3.0 s vs 6.5 s, 52.96 vs 53.13 MB). */
export function gz(bytes: Uint8Array): Uint8Array {
  // The glb writers build on plain ArrayBuffers; Bun's types only take those.
  return Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>, {
    level: 9,
    library: "libdeflate",
  });
}

/** Uploads what this run baked to the shared cache, then logs what the run
 *  took from and gave to it: a run's last step before it exits. */
export async function settleShared(): Promise<void> {
  await SHARED.cache?.flush();
  const stats = SHARED.cache?.stats();
  if (stats && stats.hits + stats.misses + stats.stored > 0) {
    log(
      `shared bake cache: ${stats.hits} fetched (${(stats.bytes / 1024 ** 2).toFixed(1)} MB), ${stats.misses} missing, ${stats.stored} stored`
    );
  }
}
