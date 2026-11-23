/**
 * The bake cache's entries (scripts/prepare-data.ts `cached`): one file per
 * artifact name and key, `<key>.<name>`, so a changed input or bake takes
 * a new key. A name keeps its newest `generations()` entries and the older
 * ones are dropped: one on Vercel and in CI, whose caches are carried from
 * build to build (and Vercel's shared cache holds every branch's entries,
 * shared-cache.ts), three elsewhere — a checkout of another branch and
 * back, across a bake module, finds both branches' entries instead of
 * baking each way. Several processes write the cache at once —
 * prepare-sites.ts bakes the sites side by side and a large site's tiles
 * over several warmers — so an entry is written to a part file and renamed
 * into place: a reader never sees half an entry, and two processes writing
 * the same entry leave one whole file.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";

/** How many entries a name keeps (`BAKE_CACHE_GENERATIONS` overrides). */
export function generations(
  env: Readonly<Record<string, string | undefined>> = process.env
): number {
  const asked = Number(env.BAKE_CACHE_GENERATIONS);
  if (Number.isInteger(asked) && asked >= 1) {
    return asked;
  }
  return env.VERCEL || env.CI ? 1 : 3;
}

/** Where the entry for `name` under `key` lies. */
export function entryPath(dir: string, name: string, key: string): string {
  return nodePath.join(dir, `${key}.${name}`);
}

/** The entry's path, when it is there — marked as used now, so that the
 *  entries a name keeps are the ones last read or written. */
export function cachedEntry(
  dir: string,
  name: string,
  key: string
): string | null {
  const path = entryPath(dir, name, key);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const now = new Date();
    utimesSync(path, now, now);
  } catch {
    // another process dropped it between the two calls: it is read or
    // baked again by the caller either way
  }
  return path;
}

/** When a file was last written or marked, 0 for one that has gone. */
function usedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Writes the entry for `name` under `key` and returns its path. The name
 * keeps `keep` entries (one, unless the caller says: the bake cache's are
 * `generations()`), this one among them: of its other keys the oldest
 * are dropped first — never the entry itself, which another process may
 * have just renamed into place, nor a part file (it ends in `.<pid>.part`,
 * never in the name) — then the bytes go to this process's part file,
 * renamed over the entry.
 */
export function writeEntry(
  dir: string,
  name: string,
  key: string,
  bytes: Uint8Array,
  keep = 1
): string {
  mkdirSync(dir, { recursive: true });
  const own = `${key}.${name}`;
  const others = readdirSync(dir)
    .filter((entry) => entry !== own && isEntryOf(entry, name))
    .map((entry) => nodePath.join(dir, entry))
    .toSorted((a, b) => usedAt(b) - usedAt(a));
  for (const stale of others.slice(Math.max(0, keep - 1))) {
    // another process may drop the same stale entry
    rmSync(stale, { force: true });
  }
  const path = nodePath.join(dir, own);
  const part = `${path}.${process.pid}.part`;
  writeFileSync(part, bytes);
  renameSync(part, path);
  return path;
}

/** Whether a cache file is an entry of `name`: `<key>.<name>`, the key
 *  without a dot (a name may end in another's: `a.json`, `x.a.json`). */
function isEntryOf(entry: string, name: string): boolean {
  if (!entry.endsWith(`.${name}`)) {
    return false;
  }
  return !entry.slice(0, -(name.length + 1)).includes(".");
}
