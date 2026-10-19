/**
 * The bake cache's entries (scripts/prepare-data.ts `cached`): one file per
 * artifact name, `<key>.<name>`, so a changed input or bake takes a new key
 * and the stale one is dropped. Several processes write it at once —
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
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Where the entry for `name` under `key` lies. */
export function entryPath(dir: string, name: string, key: string): string {
  return join(dir, `${key}.${name}`);
}

/** The entry's path, when it is there. */
export function cachedEntry(
  dir: string,
  name: string,
  key: string
): string | null {
  const path = entryPath(dir, name, key);
  return existsSync(path) ? path : null;
}

/**
 * Writes the entry for `name` under `key` and returns its path. One entry
 * per name: the name's other keys are dropped first — never the entry
 * itself, which another process may have just renamed into place, nor a
 * part file (it ends in `.<pid>.part`, never in the name) — then the bytes
 * go to this process's part file, renamed over the entry.
 */
export function writeEntry(
  dir: string,
  name: string,
  key: string,
  bytes: Uint8Array
): string {
  mkdirSync(dir, { recursive: true });
  const own = `${key}.${name}`;
  for (const entry of readdirSync(dir)) {
    if (entry !== own && entry.endsWith(`.${name}`)) {
      // another process may drop the same stale entry
      rmSync(join(dir, entry), { force: true });
    }
  }
  const path = join(dir, own);
  const part = `${path}.${process.pid}.part`;
  writeFileSync(part, bytes);
  renameSync(part, path);
  return path;
}
