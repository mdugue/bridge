# Plan 061: Each baked artifact is keyed on its own bake's imports — a viewpoint edit in one site's config no longer re-bakes every tile of every site

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- scripts/prepare-data.ts scripts/bake-sources.ts scripts/bake-sources.test.ts .github/workflows/ci.yml AGENTS.md`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW–MED (a too-narrow key leaves an artifact stale; mitigated by
  keeping the entry file and the site's own config in every key, and by
  the test in step 3)
- **Depends on**: none
- **Category**: perf (build / CI)
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

`scripts/prepare-data.ts` caches every artifact by the contents of its
inputs plus `BAKE_SOURCES` — **every module reachable from
`prepare-data.ts`** through imports, found by `scripts/bake-sources.ts`.
Measured at `4b0310a` with the repo's own helper: that graph is **68
modules**, among them all ten `sites/*.ts` (Berlin's config included),
`lib/city/landcover.ts` (the palette — AGENTS.md promises "Changing a
colour is not a re-bake"), `lib/city/tree-season.ts`,
`lib/city/tram-timetable.ts`, `lib/city/pose.ts` and `lib/city/minimap.ts`,
none of which shapes a terrain or building tile. Since the cache was born
(2026-09-26), **40 of 267 commits** touched one of those 68 files and so
invalidated every artifact of every site; `sites/dresden.ts` alone five
times (viewpoint edits). Each such commit costs the cold bake: about two
minutes locally before `bun dev` serves, and ≈ 110 s on **each of the
three** e2e shards in CI (the workflow's bake cache restores main's entry,
but every content key misses).

The fix keeps the design (content keys, the import graph walked from an
entry so a new import can never be missing) and changes only *which entry*
each artifact's key walks from: the bake that makes it, plus
`prepare-data.ts`'s own text and the site's own config. The hero map keeps
`lib/city/landcover.ts` (it paints the palette); the tiles lose it.

## Current state

- `scripts/bake-sources.ts` — `moduleGraph(entry, root)`,
  `createContentHasher()`, `contentKey(hashOf, files, extra)`.
- `scripts/bake-sources.test.ts` — asserts the graph from `prepare-data.ts`
  reaches named modules (`lib/city/landcover.ts`, `sites/dresden.ts`,
  `lib/city/pose.ts` among them — that test must change, see step 3).
- `scripts/prepare-data.ts:210-227` — `BAKE_SOURCES` and `cacheKey`:

```ts
const BAKE_SOURCES = [
  ...moduleGraph("scripts/prepare-data.ts"),
  "bun.lock",
  ...readdirSync(at("patches")).map((name) => `patches/${name}`),
].map(at);

const hashOf = createContentHasher();

/** A cache key over the contents of the input files, the bake's sources and
 *  any extra values. */
function cacheKey(inputs: string[], ...extra: unknown[]): string {
  return contentKey(hashOf, [...inputs, ...BAKE_SOURCES], extra);
}
```

The eleven `cacheKey(…)` call sites in `prepare-data.ts` at `4b0310a`, and
the bake module each artifact comes from (read the surrounding function to
confirm the entry):

| Line | Artifact | Bake entry (what the key should walk) |
|---|---|---|
| 281 | a class raster + its 1024² and crop (`downsampleClassRaster`) | `scripts/downsample-raster.ts` (+ `lib/city/landcover.ts`? only if the function reads the palette — it does not: NEAREST ids; check its imports) |
| 326 | the canopy pack `.pts.gz` | `lib/city/point-pack.ts` and the canopy helpers the function imports (`scripts/coarse-crowns.ts`? read it) |
| 349 | `line-levels-<site>.json` | `scripts/line-levels.ts` |
| 430 | a downsampled artifact (`artifact.bakedFrom.raster`) | `scripts/downsample-raster.ts` |
| 538 | `frame.json` (the recenter frame) | `scripts/bake-city-mesh.ts` |
| 571, 595 | `city_<tile>.glb.gz` + extras | `scripts/bake-city-mesh.ts`, `scripts/bake-tiles.ts`, `scripts/tile-glb.ts`, `scripts/measured-roofs.ts` |
| 785 | the coarse crowns file | `scripts/coarse-crowns.ts` |
| 846, 856 | the terrain levels and their `.json` | `scripts/bake-tiles.ts`, `scripts/bake-terrain-tin.ts`, `scripts/tile-glb.ts`, `scripts/line-levels.ts` (passages) |
| 1010 | the `/wissen` hero (`site-map.webp`) | `scripts/bake-wissen-hero.ts` + `lib/city/landcover.ts` (already in `heroSources`) |
| 1035 | `site-stats.json` | the stats function in `prepare-data.ts` itself |

`scripts/prepare-sites.ts` runs `prepare-data.ts` once per site, so the
"site's own config" is `sites/<id>.ts` (and `sites/providers.ts`, which
every site imports).

CI: `.github/workflows/ci.yml:173-182` restores `.cache/prepare-data` by a
key over `hashFiles('data/**', 'scripts/**', 'lib/**', 'sites/**', 'patches/**', 'bun.lock')`
with `restore-keys: prepare-data-${{ runner.os }}-` — the restore is
coarse on purpose ("Any earlier entry is a sound start — the bake keys
every artifact by the contents of its inputs and of every module it
imports"); the content keys inside decide the work.

AGENTS.md "Data pipeline": "`prepare-data.ts` caches by content in
`.cache/prepare-data` … the key covers the inputs' contents and every
module the bake imports (`scripts/bake-sources.ts` walks the import graph
— there is no list to keep in step)". That sentence stays true; add
"from each artifact's own bake entry".

Conventions: TypeScript strict; `scripts/` is bun-run; tests with
`bun:test` beside the module; no new dependency; Conventional Commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Unit tests (targeted) | `bun test scripts/bake-sources.test.ts` | pass |
| Typecheck | `bun typecheck` | exit 0 |
| A warm bake (the measurement) | `bun scripts/prepare-sites.ts dresden` twice | second run ≈ 1 s, "cached" lines |
| The gate | `bun run verify` | exit 0 |

The bake writes to `public/data/` and `.cache/prepare-data` (both
gitignored). It is the one command in this plan that writes outside the
in-scope files; it is part of the normal dev flow (`bun dev` runs it).

## Scope

**In scope** (the only files you should modify):
- `scripts/prepare-data.ts` (`BAKE_SOURCES`, `cacheKey`, the eleven call sites)
- `scripts/bake-sources.ts` (an optional memo helper)
- `scripts/bake-sources.test.ts`
- `AGENTS.md` (one clause in "Data pipeline")

**Out of scope** (do NOT touch, even though they look related):
- `.github/workflows/ci.yml` — the workflow's restore key is coarse by
  design; plan 064 touches the workflow for other reasons.
- The bake modules themselves (`bake-tiles.ts`, …) — their imports *are*
  the key; do not restructure them to shrink it.
- `.cache/` format or the `cached()` helper.

## Git workflow

- Branch: the branch you were given, or `plan/061-cache-keys-per-entry`.
- One or two commits, Conventional Commits, e.g.
  `perf(bake): each artifact's cache key walks its own bake's imports`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `cacheKey` takes the entry

In `scripts/prepare-data.ts`, replace `BAKE_SOURCES`/`cacheKey` with:

```ts
/** What every key carries: this file (the orchestration), the site's own
 *  config, the lockfile and the dependency patches (the glTF tools'
 *  versions shape the output too). */
const COMMON_SOURCES = [
  "scripts/prepare-data.ts",
  `sites/${SITE.id}.ts`,
  "sites/providers.ts",
  "bun.lock",
  ...readdirSync(at("patches")).map((name) => `patches/${name}`),
].map(at);

const hashOf = createContentHasher();
const graphs = new Map<string, string[]>();

/** Every module reachable from `entry`, memoised per bake run. */
function sourcesOf(entry: string): string[] {
  let graph = graphs.get(entry);
  if (!graph) {
    graph = moduleGraph(entry).map(at);
    graphs.set(entry, graph);
  }
  return graph;
}

/** A cache key over the contents of the input files, the sources of the
 *  bake that makes the artifact (its entry module and every module it
 *  imports), the common sources, and any extra values. */
function cacheKey(inputs: string[], entries: string[], ...extra: unknown[]): string {
  const sources = new Set<string>(COMMON_SOURCES);
  for (const entry of entries) {
    for (const file of sourcesOf(entry)) {
      sources.add(file);
    }
  }
  return contentKey(hashOf, [...inputs, ...[...sources].toSorted()], extra);
}
```

Check how `SITE` is obtained in the file (it is the site from argv via
`siteFromArgs`; read the top of the file) so `sites/${SITE.id}.ts` is the
right file name — the ids match the file names (`sites/index.ts`).

**Verify**: `bun typecheck` → errors at every `cacheKey(` call site (the
new parameter) — that is expected until step 2.

### Step 2: Each call site names its bake

Edit the eleven call sites per the table in "Current state". For each,
open the function around it and list the `scripts/*.ts` modules whose
functions it calls to make the artifact; pass them as the `entries`
array. Examples:

- line 349: `cacheKey(levelInputs(SITE), ["scripts/line-levels.ts"])`
- line 571/595: `cacheKey(inputs, ["scripts/bake-city-mesh.ts", "scripts/bake-tiles.ts", "scripts/tile-glb.ts", "scripts/measured-roofs.ts"], offset, …)`
- line 846/856: `cacheKey(inputs, ["scripts/bake-tiles.ts", "scripts/bake-terrain-tin.ts", "scripts/tile-glb.ts", "scripts/line-levels.ts"], offset, described, passagesIn(tile))`
- line 1010: `cacheKey(heroSources, ["scripts/bake-wissen-hero.ts"])` — and
  remove `at("scripts/bake-wissen-hero.ts")` and `at("lib/city/landcover.ts")`
  from `heroSources` only if `bake-wissen-hero.ts` imports
  `lib/city/landcover.ts` (then the graph carries it); otherwise keep them.
- line 1035: `cacheKey(statSources, [])` — the stats are computed in
  `prepare-data.ts` itself (in `COMMON_SOURCES`), plus whatever `lib/city`
  module `siteStats()` calls: read it and add that module as an entry.

A helper used by a function (e.g. `lib/city/point-pack.ts` for the canopy
pack) is an entry too when `prepare-data.ts` imports it directly for that
artifact — `moduleGraph` accepts any `.ts` path.

**Verify**: `bun typecheck` → exit 0; `bun lint` → exit 0.

### Step 3: The test says what is and is not in a tile's key

Replace the first test in `scripts/bake-sources.test.ts` ("reaches every
module the bake imports, transitively") — its list includes
`lib/city/landcover.ts`, `sites/dresden.ts` and `lib/city/pose.ts`, which
are now deliberately **not** in a tile artifact's graph. New assertions:

```ts
  test("a tile bake's graph holds its own modules, not the site configs or the palette", () => {
    const terrain = moduleGraph("scripts/bake-tiles.ts");
    for (const path of ["scripts/bake-tiles.ts", "lib/city/tfw.ts", "lib/city/terrain-geometry.ts"]) {
      expect(terrain).toContain(path);
    }
    for (const path of ["sites/berlin.ts", "sites/dresden.ts", "lib/city/landcover.ts", "lib/city/pose.ts"]) {
      expect(terrain).not.toContain(path);
    }
    const city = moduleGraph("scripts/bake-city-mesh.ts");
    expect(city).toContain("lib/city/city-mesh.ts");
    expect(city).not.toContain("sites/berlin.ts");
    expect(moduleGraph("scripts/bake-wissen-hero.ts")).toContain("lib/city/landcover.ts");
  });
```

If one of the `not.toContain` assertions fails, the module *is* imported
by that bake: read the import chain (`grep -rn "from \"@/lib/city/landcover\"" scripts lib`)
and decide — if the bake really reads it (e.g. class ids for a mask), it
belongs in the key and the assertion is wrong; adjust the test and say so
in the commit. If `sites/*.ts` is reached from a bake module, that is a
layering problem to report (STOP condition).

**Verify**: `bun test scripts/bake-sources.test.ts` → pass.

### Step 4: Measure

1. `bun scripts/prepare-sites.ts dresden` (cold or warm — either way it
   fills the cache), then again: the second run prints "cached" for every
   artifact and finishes in about a second.
2. Edit a viewpoint label in `sites/leipzig.ts` (a string; revert
   afterwards), run `bun scripts/prepare-sites.ts dresden` again → still
   warm (≈ 1 s).
3. Edit `sites/dresden.ts` the same way → Dresden re-bakes (its own config
   is in every key) — expected.
4. Edit a colour in `lib/city/landcover.ts` (revert afterwards) → only the
   hero map re-bakes.
5. Revert the edits: `git checkout sites/leipzig.ts sites/dresden.ts lib/city/landcover.ts`.

**Verify**: the four runs behave as listed; `git status --short` shows
only in-scope files.

### Step 5: AGENTS.md

In "Data pipeline", the sentence "the key covers the inputs' contents and
every module the bake imports (`scripts/bake-sources.ts` walks the import
graph — there is no list to keep in step)" becomes "… every module the
artifact's own bake imports, walked from that bake's entry
(`scripts/bake-sources.ts`; the site's own config and `prepare-data.ts`
are in every key — there is no list to keep in step)".

**Verify**: `bun run test -- lib/docs` → pass.

### Step 6: The gate

`bun run fix && bun run verify` → exit 0.

## Test plan

- `scripts/bake-sources.test.ts`: per-entry graphs contain their modules
  and exclude the site configs and the palette (step 3); the existing
  `contentKey`/`moduleGraph` tests stay.
- The measurement in step 4 is run by hand and recorded in the plan's
  status row (warm after a foreign site's edit: yes/no).
- Verification: `bun run verify` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "moduleGraph(\"scripts/prepare-data.ts\")" scripts/prepare-data.ts` → no match
- [ ] `grep -c "cacheKey(" scripts/prepare-data.ts` equals the number of call sites plus the definition (12 at `4b0310a`), every call passing an `entries` array
- [ ] `bun test scripts/bake-sources.test.ts` passes with the new test
- [ ] step 4's run 2 is warm (≈ 1 s, every artifact "cached")
- [ ] `grep -n "walked from that bake's entry" AGENTS.md` matches
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 061 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A bake module (`scripts/bake-*.ts`, `tile-glb.ts`, `line-levels.ts`,
  `coarse-crowns.ts`, `downsample-raster.ts`) imports a `sites/*.ts` file
  (then the per-entry key cannot exclude the configs without a layering
  fix — report the import).
- An artifact's producing function cannot be attributed to one or two
  entry modules by reading (report the call site).
- Step 4's run 2 is not warm (a key still changes between identical
  runs — something non-deterministic entered the key; find it with two
  runs' `.cache/prepare-data` listings and report).

## Maintenance notes

- A new artifact: pass the bake's entry module(s) to `cacheKey`; the test
  in step 3 is the place to pin what its graph must and must not hold.
- `COMMON_SOURCES` is the only hand-kept list and holds four kinds of
  file; a new orchestration module that shapes every artifact (a second
  `prepare-*.ts`) goes there.
- The CI restore key stays coarse; with per-entry content keys a `lib/`
  edit now re-bakes only the artifacts whose bake imports it.
- Reviewer: check that the terrain keys still include `scripts/line-levels.ts`
  (the passages come from the site's levels) and the city key
  `scripts/measured-roofs.ts`.
