/**
 * What every step of scripts/prepare-data.ts shares: the site this run
 * bakes, the log, the publisher and the bake cache (`cached`: the local
 * entry, else baked). Every cache key carries this
 * module (`COMMON_SOURCES`), the gzip level and the JSON encoding among it,
 * so it holds plumbing only: a bake belongs in the module of its step.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { tileIds } from "../../lib/city/tile";
import { siteFromArgs } from "../../sites";
import { readLockfile } from "../bake-sources";
import { cachedEntry, generations, writeEntry } from "../bake-cache";
import { KEY_PLUMBING, KEY_STOPS } from "../bake-entries";
import { createKeyMaker } from "../cache-keys";
import { createPublisher } from "../publisher";

/** Under `.cache`, so clearing `.next` keeps a local bake. */
const CACHE_DIR = nodePath.join(process.cwd(), ".cache/prepare-data");
export const SITE = (() => {
  try {
    return siteFromArgs(process.argv.slice(2)).site;
  } catch (error) {
    process.stderr.write(`prepare-data: ${(error as Error).message}\n`);
    return process.exit(2);
  }
})();
export const OUT_DIR = nodePath.join(process.cwd(), "public/data", SITE.id);
export const TILES = tileIds(SITE);
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

export const at = (path: string) => nodePath.join(process.cwd(), path);
export const utf8 = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);
export const parse = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));
export const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf-8"));

// --- publish ------------------------------------------------------------------

export const publisher = createPublisher(OUT_DIR);
export const { publish } = publisher;

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
  lockfile: readLockfile(readFileSync(at(LOCKFILE), "utf-8")),
});
export const cacheKey = keys.key;

/**
 * A site-wide artifact's cache name. Every site shares the cache, and
 * `cached` keeps one entry per name: unscoped, each site's build would evict
 * the entry of the site built before it (and re-bake its own on every run).
 * A tile's names need no scope while no two sites share a tile.
 */
export const siteWide = (name: string) => `${SITE.id}.${name}`;

/** How many entries a name keeps in the local cache (bake-cache.ts). */
const KEPT = generations();

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
  const bytes = await bake();
  writeEntry(CACHE_DIR, name, key, bytes, KEPT);
  return bytes;
}

/** Where the cached entry for `key` lies, baked first when it is not
 *  there — for an entry read later, or only in part. */
export async function cachedFile(
  name: string,
  key: string,
  bake: () => Promise<Uint8Array> | Uint8Array
): Promise<string> {
  return (
    cachedEntry(CACHE_DIR, name, key) ??
    writeEntry(CACHE_DIR, name, key, await bake(), KEPT)
  );
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
