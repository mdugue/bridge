# 081 — One schema per file a bake hands over

**Status:** TODO

Planned 2026-11-04 against `04d8fad3` from an architecture review: the
files the Python bakes write and TypeScript reads have their shape
written three or four times (the Python dict literal, pytest asserts, a
TypeScript interface, sometimes a hand guard) and nothing compares the
copies (graphify: 0 edges between `pipeline/` and the TypeScript). Two
refactors and one data fix: each such file gets one zod schema on the
TypeScript side, the build refuses a file that does not match, and the
monuments' `wikidata` field says what its name promises.

> **Executor instructions.** Read the whole plan, AGENTS.md (Hard rules,
> Data), ADRs 0012, 0042, 0047 and 0055, `scripts/bake-entries.ts` and
> its test, and the `new-bake-step` skill. Each step is its own commit
> (Conventional Commits) and leaves `bun run fix && bun run verify`
> green. Do them in order; Steps 0–7 can merge one by one. Step 8 is one
> branch that **must not merge** before the maintainer's Step 9 adds the
> re-baked data to it. If `docs/plans/README.md` has no row for 081, add
> one (TODO) with Step 0; update it when you stop, with what you built,
> what you did not, and every deviation.
>
> **Drift check (run first):**
> `git log --oneline 04d8fad3..HEAD -- pipeline/bake/monuments.py pipeline/bake/landmarks.py pipeline/bake/landmark_facts.py pipeline/bake/osm_buildings.py pipeline/bake/roof_colour.py pipeline/bake/dormers.py pipeline/bake/murals.py pipeline/bake/transit.py lib/city/landmark-facts.ts lib/city/landmarks.ts lib/city/city-mesh.ts lib/city/features.ts lib/city/stadtwissen.ts lib/city/murals.ts lib/city/tram-timetable.ts lib/city/building-tint.ts scripts/bake-stadtwissen.ts scripts/prepare scripts/prepare-data.ts scripts/bake-entries.ts`
> A commit there that adds a key to one of the files below means
> Findings' key lists are stale: re-run the census in Step 0.1 first.
> Line numbers are approximate; find code by its name.

## Context

A bake writes a Python dict; TypeScript reads it with
`readJson(path) as T` or `JSON.parse(…) as T`. A renamed key, a number
turned string, or a field whose meaning changed in Python passes every
check: the reader sees `undefined` and a layer, card or directory is
silently poorer. One such drift is live (`wikidata` on monuments).

`lib/city/features.test.ts` already reads **every committed GeoJSON of
every `tileArtifacts` kind** and asserts its shape and its value rules.
That stays the home of the GeoJSON layers; this plan does not redo it.
It covers what that test does not: the JSON files, and the GeoJSON a
build-side reader casts to a type of its own.

## Findings (verified 2026-11-04)

### Files in scope

| File (writer) | TS readers | Check today |
|---|---|---|
| `data/<site>/landmark-facts.json` (`pipeline/bake/landmark_facts.py` `run_site`) | `lib/city/landmark-facts.ts` (`LandmarkFactsEntry`, `isEntry`, `isLandmarkFactsFile`); `app/_components/landmark-facts-load.ts` (a file failing the guard → `null`, every error swallowed); `scripts/prepare-data.ts` ≈ 224 publishes the bytes unread | viewer guard only; nothing at build, no committed-data test |
| `dlm/landmarks_<tile>.json` (`pipeline/bake/landmarks.py` `run` ≈ 461–511) | `scripts/prepare/landmarks.ts` `landmarkFile` (`readJson … as LandmarkFile`; feeds city, stadtwissen, siteStats and `siteLandmarks` in prepare-data); `scripts/fetch-stadtwissen.ts` ≈ 78; `scripts/windows-report.ts` ≈ 99; type `LandmarkEntry`/`LandmarkFile` in `lib/city/landmarks.ts` | none |
| `dlm/osmbuild_<tile>.json` (`pipeline/bake/osm_buildings.py` `run` ≈ 673–721) | `scripts/prepare/city.ts` `parseCity` ≈ 109 (`{context?, objects?: OsmBuildingLut}`); `scripts/prepare/stadtwissen.ts` ≈ 50 (`{objects: Record<string, never>}`); `scripts/bake-stadtwissen.ts` `OsmRow`; `scripts/windows-report.ts` ≈ 96; type `OsmBuildingFacts` in `lib/city/city-mesh.ts` ≈ 33 | `features.test.ts` ≈ 1065 checks only its `attribution` |
| `dlm/monuments_<tile>.geojson` (`pipeline/bake/monuments.py`) | the viewer via `MonumentFeature` (`lib/city/features.ts` ≈ 329); `scripts/bake-stadtwissen.ts` `MonumentCollection` ≈ 187 (its own type); `scripts/walks.test.ts` ≈ 117 (same cast) | `features.test.ts` ≈ 763 (shape and rules) — but the Stadtwissen reads it through its own type |
| `murals/murals.json` (`pipeline/bake/murals.py` ≈ 793) | `lib/city/murals.ts` `parseMurals`: prepare-data ≈ 236 **drops a malformed mural silently**; the viewer (`mural-layer.ts`) the same | guard filter only; no committed-data test |
| `transit/trams.json` (`pipeline/bake/transit.py` ≈ 547) | prepare-data publishes the bytes unread; the viewer: `isTramTimetable` (`app/_components/data-overlays.ts` ≈ 189, five shallow checks); type `TramTimetable` (`lib/city/tram-timetable.ts` ≈ 170) | `tram-timetable.test.ts` ≈ 111 (rules, through a cast) |
| `dop/roofcolor_<tile>.json` (`pipeline/bake/roof_colour.py`; 12 MB over all sites) | `scripts/prepare/city.ts` ≈ 107 `as RoofColours` (`lib/city/building-tint.ts` ≈ 504) | `features.test.ts` ≈ 151: `meta` and `roofs` are objects, nothing inside |
| `dlm/dormers_<tile>.geojson` (`pipeline/bake/dormers.py`) | `scripts/prepare/city.ts` ≈ 141 `as FeatureCollection<DormerFeature>` | **none** (not in `tileArtifacts`, absent from `features.test.ts`) |

A census of the committed files (all seven sites) found no key the
TypeScript types lack today: landmarks 527 entries
(`id name x y links objects z h height material`), landmark facts 312,
osmbuild 32 files (`addr storey levels heritage material roof_colour
name outline shop colour context`; top level `attribution context meta
objects`), monuments 1 490 features. All seven landmark-facts files
pass `isLandmarkFactsFile`, all murals pass `parseMurals`, all three
timetables pass `isTramTimetable`. So Step 0 should be green; it is
there so the next drift is red.

`OsmBuildingFacts` mixes the file's row with what the build adds
(`landmark`, `wikidata`, `materialFrom`: `withLandmarks` in
`scripts/prepare/city.ts` ≈ 60). The schema describes the file only.

### Covered elsewhere, not in scope

- `features.test.ts` (deep, every committed file): every `tileArtifacts`
  GeoJSON, the city bake's other GeoJSON inputs (doors, passages,
  plinths, roofs, smallbuild, structures; walls, kerbs, stairs,
  terraces), `windows`, `shopfronts`, `treefacts`. Their casts stay.
- Raster legends (`landcover surface edges markings sport horizon`
  `.json`): pinned to the decoders' constants by their tests — plan 045.
- `facades_<tile>.json` (`facades.py`): only the viewer reads it
  (`tile-stream.ts` ≈ 1863, `fetchOptionalJson<FacadeReadings>`),
  unchecked — backlog.
- `provenance.json` (hand-kept), `wissen/wikidata.json` (TypeScript
  writes it), the walks: not a bake's hand-over.

### The monument `wikidata` drift

- `pipeline/bake/monuments.py` `wikidata_materials` ≈ 668 sets
  `m["wikidata"]` to the item the **material** came from (of its name
  within `WIKIDATA_NAME_M` 40 m, else the nearest within
  `WIKIDATA_NEAR_M` 10 m); `properties` ≈ 738 writes it.
  `lib/city/features.ts` ≈ 364 documents that correctly, and the card
  credits the material to Wikidata by it (`inquiry-features.ts` ≈ 302,
  ≈ 364).
- `scripts/bake-stadtwissen.ts` `monumentsOf` ≈ 243 republishes it as
  `wd`, which `lib/city/stadtwissen.ts` ≈ 71 documents as "the Wikidata
  item OSM links it to" and `ask-knowledge.ts` ≈ 86 hands *Frag die
  Stadt* as the monument's `wikidata`. Its `material` comment ≈ 67
  ("where the DLM names one") is wrong too: OSM, else Wikidata.
- 63 of 1 490 committed monuments carry it. Hamburg's
  `monuments_32564_5932_2_hh.geojson` shows the nearest rule: an unnamed
  OSM sculpture holds `Q425622` (St. Nikolai, a landmark of that tile)
  and `material: Ziegel` — the church's brick.
- The monument's own OSM link is never read, though the pattern exists
  (`tag(other, "wikidata")`: `landmarks.py` ≈ 382, `bridge.py` ≈ 729;
  `murals.py` ≈ 154 takes the first of a `;` list), and
  `_osm_monuments` ≈ 429 and `_osm_fountains` ≈ 373 already read
  `other_tags` from the local extract (ADR 0012). The ODbL credit is
  already written when OSM contributed (`run` ≈ 1224): no new source,
  no new credit.
- Walks cite landmark Q-ids and monument ids `m<x>_<y>[_n]` (9 of them),
  never a monument's `wd` (Hamburg's `Q425622` ref is the landmark). But
  `monumentsOf` orders same-metre suffixes by a key holding `wd`
  (≈ 250): a changed `wd` can renumber a `_2`.

### Constraints the design must keep

- **Phone memory and first load (ADR 0047).** zod is in no first-load
  chunk: its one importer, `lib/city/ask-tools.ts`, reaches the viewer
  only through `ask-city.tsx`, loaded by `dynamic(import())`
  (`city-walk.tsx` ≈ 111). The modules `app/` imports (`landmark-facts`,
  `landmarks`, `features`, `city-mesh`, `building-tint`, `murals`,
  `tram-timetable`) take schema types by `import type` only.
- **Bake keys.** A module a keyed step module imports by value enters
  that bake's key, and so does every package it imports itself
  (`scripts/bake-sources.ts`; type-only imports are not walked).
  Parsing in `scripts/prepare/city.ts`, `landmarks.ts`, `stadtwissen.ts`
  puts the schema modules and **zod's locked version** into the keys of
  `city`, `stadtwissen` and `siteStats`: the first build after Steps 2,
  3, 4 and 6 re-bakes those artifacts once for every site, and so will a
  zod bump. The bytes must not change (Verification).
- **Key order.** zod's `parse` returns a copy with keys in the schema's
  order (checked: `{c,b,a}` → `{a,b,c}`). Baked JSON depends on input
  order. So the helper validates and returns **its input**, never
  `parse`'s output; schemas carry no `.transform`, `.default`,
  `.catch` or `.pipe`, so input and output types are one.
- `bake-entries.test.ts` "every module prepare-data.ts imports is in some
  bake's key, or says why not" also fails when an excused module later
  becomes keyed: move entries in and out of `NOT_A_BAKE` as the steps go.
- `lib/city/purity.test.ts` scans `lib/city/*.ts` only: keep the
  schema modules flat there.

## The design

**Modules.** One module per file, flat in `lib/city/`, imported by value
only from `scripts/` and tests:

| Module | Exports |
|---|---|
| `lib/city/bake-file.ts` | `interface BakeFile<S>` `{ schema: S; file: string; writer: string; step: string }`; `bakeFileProblems(spec, json): string[]`; `parseBakeFile(spec, json, where): z.infer<S>` |
| `lib/city/landmark-facts-file.ts` | `LANDMARK_FACTS_FILE_SPEC`, `LandmarkFactsFile`, `LandmarkFactsEntry` |
| `lib/city/landmarks-file.ts` | `LANDMARKS_FILE`, `LandmarkFile`, `LandmarkEntry` |
| `lib/city/osm-buildings-file.ts` | `OSM_BUILDINGS_FILE`, `OsmBuildingsFile`, `OsmBuildingRow` |
| `lib/city/monuments-file.ts` | `MONUMENTS_FILE`, `MonumentsFile`, `MonumentProps`, `ReliefGrid` |
| `lib/city/murals-file.ts` | `MURALS_FILE_SPEC`, `MuralFile`, `Mural` |
| `lib/city/tram-timetable-file.ts` | `TRAMS_FILE`, `TramTimetable`, `TramPattern` |
| `lib/city/roof-colours-file.ts` | `ROOF_COLOURS_FILE`, `RoofColours` |

(Pick final export names that do not clash with the existing
`LANDMARK_FACTS_FILE`/`MURALS_FILE` name constants.) Types are
`z.infer` of the schema; the existing modules re-export them with
`export type { … } from "./…-file"` and drop their hand-written
interfaces. Records are `z.strictObject` (a renamed key is an
"Unrecognized key"); a value whose content is free (`meta` in osmbuild)
is `z.looseObject` or a `z.record`. A TypeScript union the viewer
already has (`WallMaterial`, `FacadeMaterial`, `MonumentKind`,
`MonumentForm`, `FountainStyle`) is mirrored as a `z.enum([...])` whose
list `satisfies readonly WallMaterial[]`, and the test file holds a
type-level equality of the two, so neither can gain a member alone.
Ids are `z.string().regex(/^Q\d+$/u)` where they are Wikidata items.

**Parsing.** `parseBakeFile` runs `schema.safeParse(json)`; on success it
returns `json` (typed by the schema: the one cast, with a
`// reason: validated, and the input keeps its key order` comment); on
failure it throws an `Error` whose message is

```text
data/dresden/dlm/landmarks_33412_5656_2_sn.json does not match
lib/city/landmarks-file.ts (written by pipeline/bake/landmarks.py):
✖ Invalid input: expected number, received string
  → at landmarks[3].links
… and 4 more
Re-bake it (bun run bake dresden --step landmarks) or change the schema
with the bake, in one commit.
```

(`z.prettifyError`, first 8 issues.) Where:

- per tile, in the step module that reads the file (`scripts/prepare/
  landmarks.ts`, `city.ts`, `stadtwissen.ts`): a cache hit means these
  bytes passed this schema before, since both are in the key;
- site-wide (`landmark-facts.json`, `murals.json`, `trams.json`): in
  `scripts/prepare-data.ts`, uncached, every run, before publishing the
  **same bytes** it read;
- dev CLIs (`fetch-stadtwissen.ts`, `windows-report.ts`) and tests: the
  same call.

A thrown parse ends `prepare-data` non-zero, and with it the build.

**The viewer** keeps its hand guards (`isLandmarkFactsFile`,
`isTramTimetable`, `parseMurals`) and its fetch behaviour; a test pins
each guard to its schema (it accepts every committed file the schema
accepts, and rejects a table of broken fixtures the schema rejects).
With the build refusing a bad file, a guard failure in the viewer means a
stale cache or a half-deployed version: `null` stays the right answer.

**The committed-data test** `lib/city/bake-files.test.ts`: every
committed file of each spec (per tile via `cityMeshSourceFiles` /
`sideFileSource`, site-wide via the `…Source` helpers) has no
`bakeFileProblems`, and `schema.parse(x)` deep-equals `x`. One
`test.each` per spec, named by the file.

## Steps

### Step 0 — The schemas and the committed-data test (no reader moves)

0. **Pin zod exactly** (maintainer, 2026-11-04): in `package.json`
   replace `"zod": "^4.6.7"` with the version `bun.lock` resolves
   today, run `bun install`, and add zod to the exact pins listed in
   AGENTS.md › Conventions in Step 7 ("… the lint tools, `suncalc` and
   `zod`, whose version is in three bake keys").
1. Re-run the census (a scratch script, not committed): for each file in
   scope, every key and value type over `data/*/`. Compare with the
   Python writer's dict literals and the TypeScript types above.
2. Add `lib/city/bake-file.ts` and the seven schema modules, each
   head-commented with its writer, its step and its readers. Write each
   schema from the **Python writer** (it is what the file is), then check
   it against the TypeScript type it will replace; where they differ,
   the census decides, and the difference goes in the commit message.
3. Add `lib/city/bake-files.test.ts` (the design above) with the enum
   equalities, and one more test: no non-test file under `app/` and no
   `lib/city/*.ts` other than `ask-tools.ts`, `bake-file.ts` and the
   `*-file.ts` modules contains `from "zod"`, and none of those imports
   a `*-file.ts` or `bake-file.ts` by value (`directImports` from
   `scripts/bake-sources.ts` skips type-only imports).
4. `features.test.ts`: a test for `dormers_<tile>.geojson` (its
   `DormerFeature` shape and value ranges, like its neighbours'; it is
   GeoJSON, so it belongs there, not in a schema).
5. `bun run verify`. Commit: `test(data): one schema per file a bake
   hands over, checked over every committed file`.

### Step 1 — The landmarks' facts

1. `lib/city/landmark-facts.ts`: `export type { LandmarkFactsEntry,
   LandmarkFactsFile } from "./landmark-facts-file"`; delete the
   interfaces. `isEntry`/`isLandmarkFactsFile` stay (the viewer's guard).
2. `scripts/prepare-data.ts` ≈ 224: read the bytes once, `parseBakeFile`
   their JSON with `factsSource` as `where`, publish the bytes.
   `NOT_A_BAKE` gains `lib/city/landmark-facts-file.ts` and
   `lib/city/bake-file.ts` ("checked uncached every run").
3. `lib/city/landmark-facts.test.ts`: the guard-agreement test.
4. Commit: `refactor(data): the landmarks' facts are checked at build`.

### Step 2 — `landmarks_<tile>.json`

1. `lib/city/landmarks.ts`: re-export `LandmarkEntry`, `LandmarkFile`
   by type from `./landmarks-file`; delete the interfaces.
2. `scripts/prepare/landmarks.ts` `landmarkFile`: `parseBakeFile`. Its
   keys (`city`, `stadtwissen`, `siteStats`) now walk `bake-file.ts` and
   the schema: remove `lib/city/bake-file.ts` from `NOT_A_BAKE`.
3. `scripts/fetch-stadtwissen.ts` ≈ 78, `scripts/windows-report.ts` ≈ 99:
   the same call, no cast.
4. Commit: `refactor(data): the landmarks file is read through its schema`.

### Step 3 — `osmbuild_<tile>.json`

1. `lib/city/city-mesh.ts`: `OsmBuildingFacts = OsmBuildingRow & {
   landmark?: number; materialFrom?: "wikidata"; wikidata?: string }`
   (the build's additions, with their doc comments), `OsmBuildingRow`
   by type from `./osm-buildings-file`.
2. `scripts/prepare/city.ts` `parseCity`, `scripts/prepare/stadtwissen.ts`
   `tileFile`, `scripts/windows-report.ts`: `parseBakeFile`, no casts.
   `scripts/bake-stadtwissen.ts`: `OsmRow` becomes `OsmBuildingRow`
   (its "values as strings" comment is wrong: numbers and strings).
3. Commit: `refactor(data): what OSM says of a building is read through
   its schema`.

### Step 4 — `monuments_<tile>.geojson` as the Stadtwissen reads it

1. `lib/city/features.ts`: `MonumentFeature`'s properties and
   `ReliefGrid` by type from `./monuments-file` (`| null` stays on the
   viewer's type: GeoJSON allows it, the loaders guard it).
2. `scripts/bake-stadtwissen.ts`: delete `MonumentCollection`;
   `monumentsOf` takes `{ features: readonly Pick<…, "geometry" |
   "properties">[] }` of the schema's types, so
   `bake-stadtwissen.test.ts`'s small fixtures still type-check.
   `scripts/prepare/stadtwissen.ts` parses; `scripts/walks.test.ts` ≈ 117
   parses instead of casting.
3. `features.test.ts`'s monument test stays: the schema holds the shape,
   the test the rules (a polygon is a fountain, ranges, `wikidata` ⇒
   `material`).
4. Commit: `refactor(data): the Stadtwissen reads monuments through
   their schema`.

### Step 5 — The murals and the timetable

1. `lib/city/murals.ts`, `lib/city/tram-timetable.ts`: their file types
   by type from the schema modules; `isMural`/`parseMurals` stay.
2. `scripts/prepare-data.ts`: parse `murals.json` before `parseMurals`
   (a malformed mural now fails the build instead of vanishing) and
   `trams.json` before publishing its bytes. `NOT_A_BAKE` gains both
   schema modules.
3. Guard-agreement tests: `murals.test.ts` (`parseMurals` keeps every
   committed mural), `app/_components/data-overlays.test.ts`
   (`isTramTimetable`). `tram-timetable.test.ts` ≈ 113 parses instead of
   casting.
4. Commit: `refactor(data): murals and the timetable are checked at
   build`.

### Step 6 — The roof colours

1. `lib/city/building-tint.ts`: `RoofColours` by type from
   `./roof-colours-file`. `scripts/prepare/city.ts` ≈ 107 parses.
2. Time the parse over Dresden's 15 files (12 MB over all sites); note
   it in the commit message. More than 2 s per site: STOP.
3. `features.test.ts` ≈ 151 (`{ meta, roofs }`) goes: the schema holds it.
4. Commit: `refactor(data): the roof colours are read through their
   schema`.

### Step 7 — Docs

1. **ADR 0059** — `docs/adr/0059-one-schema-per-file-a-bake-hands-over.md`.
   0058 is taken on `origin/claude/project-thread-r8qykv-auswahl`
   (`0058-scenarios-are-model-sums-on-open-data.md`); re-check with
   `for b in $(git branch -r | grep -v HEAD); do git ls-tree --name-only
   $b docs/adr/; done | sort -u | tail` and take the next free number.
   Format of `docs/adr/README.md`, ≤ ~600 words. *Context*: four
   copies of a shape, none compared; the monument drift; GeoJSON layers
   already held by `features.test.ts`. *Decision*: the design above as
   rules (one strict, transform-free zod schema per handed-over file in
   `lib/city/<name>-file.ts`; types are its `z.infer`; the build parses
   and fails naming file, writer and step; every committed file parsed
   by a test; the parse returns its input; `app/` by type only, its hand
   guard pinned by a test; a changed Python key changes the schema in
   the same commit). *Consequences*: a drift fails the build or
   `verify`, not a layer; zod's version is in the parsing bakes' keys.
   *Alternatives*: a hand guard per reader (what drifted); pydantic with
   generated TypeScript (a generator in the build, the truth in Python);
   protobuf or another IDL (a toolchain, files no longer diffable);
   pytest against JSON Schema exported by `z.toJSONSchema` — rejected
   for now as a new Python dependency (`jsonschema`); the export keeps
   it a small step later.
2. `docs/adr/README.md`: its row in the index.
3. `AGENTS.md`, Conventions, the exact-pins bullet: add `zod` (Step 0).
   Then Hard rules, **Data**, after the bake-entries bullet:

   ```markdown
   - A file a bake writes and TypeScript reads has one zod schema in
     `lib/city/<name>-file.ts` (ADR 0059): readers take its types and
     `parseBakeFile`, never `readJson(…) as T`; the build fails on a
     mismatch; `bake-files.test.ts` parses every committed file. The
     viewer imports a schema module by type only.
   ```
4. `docs/data-pipeline.md`: under "Stage 2", a section "Files a bake
   hands over" (the table of files, writers and schema modules, where
   each is parsed, the error message, the key consequence); in "The
   contracts the browser relies on" a row for it.
5. `.claude/skills/new-bake-step/SKILL.md` step 5: a JSON the build
   reads gets a schema module and a row in `bake-files.test.ts`.
6. Commit: `docs(adr): 0059 one schema per file a bake hands over`.

### Step 8 — The monument's own Wikidata link (branch; do not merge yet)

1. `pipeline/bake/monuments.py`:
   - `osm_wikidata(other_tags) -> str | None`: the first of a `;` list
     of `tag(other_tags, "wikidata")`, kept only if it matches
     `^Q\d+$`.
   - `_osm_monuments` and `_osm_fountains` put it on each item as
     `"wikidata"`; `type_monuments` copies it with `form`, `height`,
     `material`, `artist` from the partner; `conflate` carries an OSM
     fountain's.
   - `wikidata_materials` writes `m["materialWikidata"]`, never
     `m["wikidata"]`.
   - **The monument's own item first** (maintainer, 2026-11-04): before
     the name and nearest rules, a monument whose OSM `wikidata` is one
     of the cached items (`load_wikidata`) takes that item's material
     and claims it, whatever the distance; only a monument without such
     a link, or whose linked item the cache lacks, falls back to
     `WIKIDATA_NAME_M` / `WIKIDATA_NEAR_M`. The claim order is: own
     links first over all monuments, then the existing pass, so a
     linked item is never handed to a neighbour (the unnamed Hamburg
     sculpture no longer takes St. Nikolai's Q425622).
   - The cache holds only items the box query finds (the five classes,
     with a `P186`); a linked item outside them is not fetched. Leave
     the fetch as it is in this plan and count, in the step's PR, how
     many OSM-linked monuments miss the cache; if it is more than a
     handful, a follow-up adds their ids to the fetch (`VALUES ?i`, a
     re-fetch at fetch time, ADR 0012) — write it in the backlog.
   - `properties` writes both keys; the module docstring ≈ 30–35 and the
     run's count line name both ("… with OSM's Wikidata link, … with
     Wikidata's material").
2. `pipeline/tests/test_monuments.py` (with `read_osm` monkeypatched as
   in `test_an_outline_memorial_is_read_at_its_point…`): a memorial
   tagged `wikidata=Q1;Q2` writes `wikidata: Q1`; a monument linked to a
   cached item 30 m away takes that item's material although another
   item lies within 10 m, and the nearer monument then cannot claim the
   linked item; a DLM monument takes
   its OSM partner's link; a monument without a material that takes one
   from a cached item writes `materialWikidata` and no `wikidata` unless
   OSM links it; a malformed tag writes nothing.
   `bun run test:pipeline`.
3. TypeScript, one commit with the Python:
   - `lib/city/monuments-file.ts`: `wikidata` and `materialWikidata`,
     both optional Q-ids; doc comments say which is which.
   - `lib/city/features.ts` ≈ 352–365 comments follow.
   - `lib/city/inquiry-features.ts` ≈ 302, ≈ 364: read
     `p.materialWikidata` for the material's credit.
   - `features.test.ts` ≈ 811: the rule becomes `materialWikidata` ⇒
     `material`; `wikidata` is a Q-id.
   - `scripts/bake-stadtwissen.ts` `monumentsOf`: `wd` from `wikidata`,
     `materialWd` from `materialWikidata`; the suffix key keeps its
     order with `materialWd` appended after `wd`.
   - `lib/city/stadtwissen.ts` `WissenMonument`: `wd` stays "the
     Wikidata item OSM links it to"; `materialWd` "the Wikidata item its
     material comes from, where OSM names none"; `material` "OSM
     `material`, else Wikidata's". `scripts/stadtwissen.ts` ≈ 32 may
     print `materialWd`; `ask-knowledge.ts` keeps `wikidata: m.wd`.
   - Tests: `bake-stadtwissen.test.ts` (both fields mapped),
     `ask-knowledge.test.ts` unchanged.
4. ADR 0055, Decision 1: rewrite the parenthesis so it lists the
   monuments' fields too — name, kind, material, position, the item OSM
   links it to (`wd`) and the item its material comes from
   (`materialWd`). Rewrite, do not append (`docs/adr/README.md`).
   Grep `docs/` and `.claude/skills/` for the monuments' `wikidata` and
   name the new field where one describes it.
5. `bun run verify` is green on the old data (the new keys are optional,
   the old `wikidata` still a Q-id with a material) — but the card would
   now credit OSM for the 63 Wikidata materials. Push the branch, open a
   **draft** PR titled `fix(monuments): wd is the monument's own
   Wikidata link — needs re-bake`, and set the status row to PARTIAL
   ("Step 8 on <branch>, awaiting the maintainer's re-bake").
   Commit: `fix(monuments): the Wikidata link is OSM's, the material's
   item its own field`.

### Step 9 — The re-bake (maintainer)

The raw inputs are not in the agent's container: `data/_raw/` is
gitignored and the step reads the OSM extract, the Basis-DLM, DOM1 (and
the laser scan where a site has one) and the fetch's Wikidata cache
(`data/_raw/<provider>/wikidata/monuments_<tile>.json`). On the Step 8
branch, for each of the seven sites:

```bash
bun run bake <site> --step monuments   # step_cache.py re-runs it: the code changed
bun scripts/walks.ts <site> check
```

Then commit `data/*/dlm/monuments_*.geojson` on the branch
(`chore(data): re-bake the monuments with OSM's Wikidata link`),
`bun run verify`, a production build, and merge. Before committing,
diff each tile's features ignoring `wikidata`/`materialWikidata`: if
anything else changed, the extract or DOM1 is newer than the committed
bake's — keep it (the skill: never dodge a re-bake) but say so in the PR.
Do not commit a tile whose run printed "no DOM1" or lacked the extract
when the committed file has reliefs or the OSM credit.

## Verification

After every step: `bun run fix`, `bun run verify`, `git diff --stat`
touches only that step's files; `bun run typecheck:tsc` after Steps 1–6.

**No published byte changes (Steps 1–6).** Before Step 1 run
`bun scripts/prepare-data.ts dresden` and keep
`public/data/dresden/manifest.json`; after each of Steps 1–6 run it
again (Steps 2, 3, 4, 6 re-bake the keyed artifacts: expected) and
`diff` the manifests — they must be identical, since the names are
content hashes. Do it for one more site with landmarks and murals
(Hamburg) after Step 6.

**A bad file fails the build.** Once, after Step 2: change one `"links":
3` to `"links": "3"` in a `landmarks_*.json`, run
`bun scripts/prepare-data.ts dresden` — it exits non-zero with the
design's message (file, key path, `--step landmarks`) — then
`git checkout` the file. The same with the warmers on: still a failure.

**zod stays out of the first load (Steps 1, 4, 5, 6).** After `next
build`, list the files under `.next/static/` containing `Unrecognized
key` (a zod message): the same set as on `04d8fad3` (the *Frag die
Stadt* chunk); load `/dresden?scene=lite` headless and list the
`/_next/static/*.js` fetched until `__poc.ready` (plan 074's method):
none of them. First-load JS (gzip −9) within ±0.5 KB of the base.

**Step 8–9:** `bun run test:pipeline`; after the re-bake, Dresden's
monuments files carry `materialWikidata` where they carried `wikidata`
before (63 across the sites, give or take a newer extract), and
`grep -c '"wikidata"'` counts OSM's links; `scripts/walks.test.ts`
green on every site (the 9 monument refs resolve); on a real GPU or in
the `@desktop-render` inquiry spec, a monument with a Wikidata material
still credits Wikidata (CC0) for its material. **Phone bytes (ADR
0047):** sum Dresden's `monuments_*.geojson` sizes before and after; the
OSM links are the only growth the re-bake may bring (a few dozen bytes a
linked monument). The maintainer accepted this growth (2026-11-04); put
the number in the PR.

## STOP conditions

Stop, leave the tree green at the last finished step, and write the
reason in the status row if:

- **Step 0 finds a committed file the Python writer could not have
  written** (a bake bug, a hand edit): record the file and the key; do
  not edit data by hand and do not loosen the schema to pass it.
- **A published byte changes** in Steps 1–6 (the manifest diff).
- **zod or a schema module reaches the viewer by value**, or first-load
  JS grows by more than 0.5 KB gz.
- **A schema needs a transform, a default or `passthrough`** to accept
  the committed data, or `parseBakeFile` would have to return `parse`'s
  output.
- **A parse failure in a warmer does not fail the build.**
- **Parsing adds more than 2 s to one site's prepare** (Step 6 times it).
- **Step 9:** a walk's monument id changes or no longer resolves; a
  tile's raw inputs are missing; the merged branch would carry Step 8's
  code without the re-baked data.

## Out of scope

- Python-side validation, a JSON Schema export, any new Python
  dependency (ADR 0059's alternatives).
- Schemas for what `features.test.ts` checks, `facades_<tile>.json`
  (backlog), the raster legends (plan 045).
- Fetching linked Wikidata items the box query misses (Step 8 counts
  them; a follow-up if they matter).
- A Wikidata link on the monument card; any new card text; any change to
  what a bake writes beyond Step 8.

## Maintenance notes

- A bake that changes a key it writes changes the schema in the same
  commit, and the committed data is re-baked before that commit merges;
  `bake-files.test.ts` fails in between, by design.
- A new file a bake hands over: a `lib/city/<name>-file.ts`, a row in
  `bake-files.test.ts`, `parseBakeFile` where it is read (its step
  module, or prepare-data when it is published uncached, then an entry
  in `NOT_A_BAKE`), and its writer named in the module's head comment.
- zod is pinned exactly (Step 0): a bump re-bakes `city`,
  `stadtwissen` and `siteStats` for every site once (their keys hold
  zod's locked version); bump it on purpose, and the output must be
  byte-identical.
- A viewer guard is pinned to its schema by its agreement test; widen
  both together.
- When DONE, condense into `completed.md` (README, Lifecycle).
