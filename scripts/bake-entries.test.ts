import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BAKE_ENTRIES,
  KEY_PLUMBING,
  KEY_STOPS,
  KEY_VALUES,
} from "./bake-entries";
import { directImports, moduleGraph } from "./bake-sources";

const ROOT = join(import.meta.dir, "..");

/**
 * What prepare-data.ts imports that no bake's key needs: what it publishes
 * on every run without a cache (the tileset, the provenance, the trams'
 * timetable). A module added here says why its changes need no re-bake.
 */
const NOT_A_BAKE: Record<string, string> = {
  "lib/city/provenance.ts": "published uncached every run",
  "lib/city/tram-timetable.ts": "published uncached every run",
  "lib/city/landmarks.ts": "the tileset's extras, built uncached every run",
  "lib/city/valley-fog.ts": "the tileset's extras, built uncached every run",
};

/** What the plumbing (`KEY_PLUMBING`) may import: no key walks it, so
 *  nothing there may shape a baked byte. */
const PLUMBING_IMPORTS = new Set([
  "lib/city/tile.ts",
  "scripts/bake-cache.ts",
  "scripts/bake-entries.ts",
  "scripts/bake-sources.ts",
  "scripts/cache-keys.ts",
  "scripts/publisher.ts",
  "scripts/shared-cache.ts",
  "scripts/warmers.ts",
  "sites/index.ts",
]);

const graph = (entry: string) => moduleGraph(entry, ROOT, KEY_STOPS);

const reached = () => {
  const out = new Set<string>();
  for (const entries of Object.values(BAKE_ENTRIES)) {
    for (const entry of entries) {
      for (const path of graph(entry)) {
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
      expect(graph(entry).filter((p) => p.startsWith("sites/"))).toEqual([]);
    }
  }
});

test("every module prepare-data.ts imports is in some bake's key, or says why not", () => {
  // AGENTS.md: a module prepare-data calls to make an artifact must be one
  // of its entries or imported from one, or that artifact's cache goes
  // stale without a word. Which artifact needs it the test cannot know: it
  // holds each import to being in some bake's key, or excused below; the
  // plumbing and the value modules reach no walk (`KEY_STOPS`), so what a
  // value module imports is held to the same
  const keyed = reached();
  const unkeyed = (from: string) =>
    directImports(from, ROOT).filter(
      (p) => !keyed.has(p) && !(p in NOT_A_BAKE) && !KEY_STOPS.includes(p)
    );
  const imported = directImports("scripts/prepare-data.ts", ROOT);
  expect(imported.length).toBeGreaterThan(10);
  expect(unkeyed("scripts/prepare-data.ts")).toEqual([]);
  for (const path of KEY_VALUES) {
    expect(unkeyed(path)).toEqual([]);
  }
  // and the list holds nothing that has since become a bake's, or gone
  expect(
    Object.keys(NOT_A_BAKE).filter((p) => keyed.has(p) || !imported.includes(p))
  ).toEqual([]);
});

test("prepare-data.ts orders the steps and bakes nothing itself", () => {
  // no key carries it: a cached artifact made here would go stale
  const source = readFileSync(join(ROOT, "scripts/prepare-data.ts"), "utf8");
  expect(source).not.toMatch(/\b(cached|cachedFile|cacheKey)\(/u);
  for (const step of directImports("scripts/prepare-data.ts", ROOT).filter(
    (p) => p.startsWith("scripts/prepare/") && !p.endsWith("/context.ts")
  )) {
    // every step module is some bake's entry, or a value module
    expect(
      (KEY_VALUES as readonly string[]).includes(step) ||
        Object.values(BAKE_ENTRIES).some((e) =>
          (e as readonly string[]).includes(step)
        )
    ).toBe(true);
  }
});

test("the plumbing imports nothing that bakes", () => {
  for (const plumbing of KEY_PLUMBING) {
    const imported = directImports(plumbing, ROOT);
    expect(imported.filter((p) => !PLUMBING_IMPORTS.has(p))).toEqual([]);
  }
});

/** What each value module exports, and how it reaches a key: no walk goes
 *  past these modules (`KEY_VALUES`), so a new export is reviewed here. */
const VALUE_EXPORTS: Record<string, Record<string, string>> = {
  "scripts/prepare/frame.ts": {
    frame: "the tileset's extras (uncached)",
    offset: "a value in every key that reads it",
    spawnFrame: "the buildings' bake, whose entries list bake-city-mesh.ts",
  },
  "scripts/prepare/side-files.ts": {
    colonyCrops: "the terrain's extras, a value in its key",
    landmarkFile: "reads the landmark file, an input of every key that does",
    Published: "a type",
    publishSideFiles: "the side files' own step",
    sideFiles: "published names, in the extras the keys carry",
  },
};

test("a value module exports only what reaches keys as values", () => {
  for (const path of KEY_VALUES) {
    // the transpiler's list holds every form of export, the types aside
    const source = readFileSync(join(ROOT, path), "utf8");
    const { exports } = new Bun.Transpiler({ loader: "ts" }).scan(source);
    const types = [
      ...source.matchAll(/^export (?:type|interface) ([\w$]+)/gmu),
    ].map((m) => m[1]);
    expect([...exports, ...types].toSorted()).toEqual(
      Object.keys(VALUE_EXPORTS[path] ?? {}).toSorted()
    );
  }
});
