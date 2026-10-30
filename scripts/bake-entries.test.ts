import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BAKE_ENTRIES } from "./bake-entries";
import { moduleGraph } from "./bake-sources";

const ROOT = join(import.meta.dir, "..");

/**
 * What prepare-data.ts imports that no bake's key needs: the orchestration
 * itself (every key carries prepare-data.ts, `COMMON_SOURCES`), types, and
 * what it publishes on every run without a cache (the tileset, the
 * provenance, the trams' timetable, the site index). A module added here
 * says why its changes need no re-bake.
 */
const NOT_A_BAKE: Record<string, string> = {
  "sites/index.ts":
    "the site registry: the site's own config is a common source",
  "scripts/bake-cache.ts": "the cache store",
  "scripts/bake-sources.ts": "the key's own machinery",
  "scripts/bake-entries.ts": "this table",
  "scripts/cache-keys.ts": "the key's own machinery",
  "scripts/publisher.ts": "the hashed names and the manifest",
  "scripts/warmers.ts": "the run's mode",
  "lib/city/types.ts": "types",
  "lib/city/features.ts": "types",
  "lib/city/provenance.ts": "published uncached every run",
  "lib/city/tram-timetable.ts": "published uncached every run",
  "lib/city/landmarks.ts": "the tileset's extras, built uncached every run",
  "lib/city/valley-fog.ts": "the tileset's extras, built uncached every run",
  "lib/city/site-index.ts": "a file name",
};

const reached = () => {
  const out = new Set<string>();
  for (const entries of Object.values(BAKE_ENTRIES)) {
    for (const entry of entries) {
      for (const path of moduleGraph(entry, ROOT)) {
        out.add(path);
      }
    }
  }
  return out;
};

test("every bake entry exists and reaches no site config", () => {
  // the CLI that reads a config lives beside its bake (line-levels-cli.ts):
  // another site's config re-bakes nothing
  for (const entries of Object.values(BAKE_ENTRIES)) {
    for (const entry of entries) {
      expect(existsSync(join(ROOT, entry))).toBe(true);
      expect(
        moduleGraph(entry, ROOT).filter((p) => p.startsWith("sites/"))
      ).toEqual([]);
    }
  }
});

test("every module prepare-data.ts imports is in a bake's key, or says why not", () => {
  // AGENTS.md: a module prepare-data calls to make an artifact must be one
  // of its entries or imported from one, or that artifact's cache goes
  // stale without a word
  const source = readFileSync(join(ROOT, "scripts/prepare-data.ts"), "utf8");
  // static imports, side-effect imports and dynamic import() alike
  const specifiers = /(?:from |import\s*\(?\s*)"(\.\.?\/[^"]+)"/gu;
  const imported = [...source.matchAll(specifiers)].map((m) => {
    const path = m[1].replace(/^\.\.\//u, "").replace(/^\.\//u, "scripts/");
    return existsSync(join(ROOT, `${path}.ts`))
      ? `${path}.ts`
      : `${path}/index.ts`;
  });
  expect(imported.length).toBeGreaterThan(30);
  const keyed = reached();
  const unkeyed = imported.filter((p) => !keyed.has(p) && !(p in NOT_A_BAKE));
  expect(unkeyed).toEqual([]);
  // and the list holds nothing that has since become a bake's
  expect(Object.keys(NOT_A_BAKE).filter((p) => keyed.has(p))).toEqual([]);
});
