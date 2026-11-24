# Plan 092 [rewrite]: The bakes work on site-wide typed tables, cut tiles last, and no step rewrites another's file

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and AGENTS.md
> first, then the `new-bake-step` and `docs-upkeep` skills. This plan is
> six phases, each one PR (phase 3 a PR per family of steps, phases 4
> and 5 a PR per site); phase 0 is a spike whose numbers decide the
> format. Run every **Verify** before the next phase. On a STOP
> condition, stop and report — never leave a site half migrated. Write
> each phase's figures into plan 087's ledger and into *Findings* at the
> end of this file, and update this plan's row in
> `docs/plans/README.md` when a phase lands.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- pipeline/bake pipeline/tests lib/city/bake-file.ts lib/city/features.ts scripts/tile-sources.ts scripts/bake-entries.ts scripts/eval/compare-bakes.py docs/adr/0059-one-schema-per-file-a-bake-hands-over.md`
> — the symbols below are named, not numbered; find them by name. Plans
> 088, 089 and 090 land before this one and move things: where this file
> says "at `5dfa300d`", check what they left.

## Status

- **Priority**: P2 — after 087–090; the door to 093
- **Effort**: L–XL, with a full re-bake of every site on the
  maintainer's machine
- **Risk**: HIGH — the input and output of all 37 tile steps; from
  phase 5 on the proof "the build publishes the same bytes" no longer
  holds and a comparison by content takes its place
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (plates,
  ledger), [088](./088-rewrite-tiles-as-a-data-product.md) (the data is
  out of git before a binary format enters: joint 2 of 086),
  [089](./089-rewrite-python-types.md) (the bakes are type-checked
  before every one of them is rewritten); leans on
  [090](./090-rewrite-dressing-gpu-ready.md) for the build's one reader
  a kind (joint 7)
- **Category**: rewrite — less complexity (seams, a second copy of
  every shape, the ledger's last-writer logic); no silent drift; it
  makes a tile's size a parameter of publishing, which
  [093](./093-rewrite-streaming-quadtree.md) needs
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: DONE as far as built (2026-11-24, the series closed): its row in
  [README.md](./README.md) says what holds. As it stood before:
  REDUCED (plan 086, "The series, reduced") — phase 0 done
  (2026-11-16); phase 2 and one read helper done (2026-11-24, in
  *Findings*). Phases 1 and 3 to 6 (the schema export, the store, a
  format, site-wide windows, typed buildings) are not built

## Why this matters

A bake step is written for one 2 km tile and hands over loose files:
about fifty a tile in three formats. Everything that follows from that
is paid in every step. A step that needs what lies beyond its edge
reads a margin, a neighbour's raster or a neighbour's finished file,
each in its own way; a thing on a seam is given to one tile by a rule
each step repeats; a file's shape is written in a Python dict, in a zod
schema or a hand-written interface, and again in the tests; and three
steps write into a file another step made, so the step cache carries a
ledger that works out what a file "would hold" at each step. The tile's
size is fixed by all of it, which is what keeps 093 from cutting the
stream's tiles smaller. One store with one way to read (by extent) and
one way to write (by owner), typed by one schema, takes the seam out of
the steps and makes the tile a question asked at publishing.

## Current state

Read at `5dfa300d`; counts by `grep` on 2026-11-16.

**The runner.** `pipeline/bake/__main__.py`: `STEPS` is a dict of 37
tile steps in the order `bake all` runs them, each comment saying what
it must follow; `SITE_STEPS = ("transit", "landmark-facts", "murals")`
run once after every tile. `Bake.step` runs a step over all tiles
before the next ("Each tile writes only its own files and reads only
what earlier steps wrote"). `run_tile` passes `site_tiles` to `ndvi`,
`roof-colour` and `sport`, which read every tile of the site; `warm`
makes their site-wide measurements once before the workers fork.

**The writer and the readers.** `pipeline/bake/common.py`:

```python
def write_geojson(path, features, epsg, attribution=None) -> None:
    doc: dict = {"type": "FeatureCollection"}
    if attribution:
        doc["attribution"] = attribution
    doc["crs"] = crs_member(epsg)
    doc["features"] = features
    path.write_text(json.dumps(doc))
```

About 35 call sites; about forty more writes are
`path.write_text(json.dumps(doc))` (a step's own raw caches among
them), the rasters go through `save_grey_png`. A step reads another's file by building its name —
`tile.out("dlm", f"canopyx_{tile.id}.geojson")` then `json.loads` (98
`json.loads` calls in `pipeline/bake/*.py`): Python reads its own
hand-overs untyped too.

**Seams, five ways.**

| How | Where | Modules |
|---|---|---|
| a margin in degrees on the OSM read | `osm.read_osm(tile, layer, where, columns, margin=0.001)`, `osm.wgs84_bbox` | "margin" in 30 |
| ownership: west and south edge in | `common.owns(bounds, x, y)`; buildings by envelope centre in `citygml.py`, with a ring of cells read by the fetch (plan 057) | `owns(` in 20 |
| the neighbours' rasters | `common.mosaic`, `dgm_paths`, `dom_paths` (plan 040: the stairs' DGM within 50 m) | 7 |
| the neighbours' finished files | `Tile.neighbours()`, `Tile.classes(tile_id)` — "what a seam-aware step reads beyond its edge" | `.neighbours()` in 14 |
| a measurement over the whole site, kept for the process | `step_cache.memo`: the NDVI's anchors, `dop_balance.gains`, `roof_colour.site_readings`, `furniture.site_bin_tone`, `monuments.winter_flight` | 5 |

And what the per-tile bakes could not do at all, the build solves over
the site: the lines' levels (`scripts/line-levels.ts`
`siteLineLevels`, ADR 0041) and the platforms' clearance, the passages
and the beds (`scripts/prepare/lines.ts`).

**Steps that write into another step's file.** `islands`
(`landcover.run_islands`: opens `landcover_<tile>.png`, carves, saves
it and its legend again); `lamp-heights` and `lamp-water` (both rewrite
`lamps_<tile>.geojson` and `mly_<tile>.geojson` with `h`, `hs`, `arm`
and `w`, `wr`); and `trees`, which calls `lowveg.rethin_scan_trees` and
rewrites `canopyx_<tile>.geojson` — a file of a step that runs 25 steps
later. `step_cache.py` (609 lines) therefore has the `Ledger`: "A run
that skips what is unchanged is judged against what a full run would
see: before step k a file holds what its last writer before k wrote" —
`_held`, `_lasts`, `restore`, `after`, the recorder's `before`, and the
`again` / `then` loops in `Bake.step`.

**The shapes.** `lib/city/bake-file.ts` (`BakeFile`, `parseBakeFile`)
and 22 schema modules `lib/city/*-file.ts` (ADR 0059: strict zod, no
transform, "the parse returns its input, never zod's copy: a copy
reorders keys, and baked bytes follow the file's order"). The served
GeoJSON kinds are hand-written interfaces in `lib/city/features.ts`,
several nested (`under?: { c: [number, number][]; h: number; y:
number[] }[]`, `wire?: [Point2, Point2]`, `m?: [number, number][]`),
held by `features.test.ts`; AGENTS.md lists what is still cast. Every
committed file is read by `lib/city/bake-files.test.ts`,
`features.test.ts`, `tile-data.test.ts` and
`pipeline/tests/test_committed.py` (which globs `data/*/dlm`).

**What the pinned stacks can do** (checked in `pipeline/.venv` and
`node_modules`): GDAL 3.12.4 in pyogrio 0.13.0 lists `FlatGeobuf rw`,
`GPKG raw`, `GeoJSONSeq raw`; it has **no Parquet and no Arrow driver**;
`pyarrow`, `geopandas`, `duckdb`, `jsonschema` and `pydantic` are not
installed. The OSM index is FlatGeobuf already
(`pipeline/bake/osm_index.py`). On the TypeScript side no FlatGeobuf or
Parquet reader is installed; zod 4.6.7 exports `toJSONSchema`;
`lib/city/wkb.ts` reads a GeoPackage's geometries and `sql.js` is a
dependency (for a visitor's design, ADR 0054).

**The buildings.** `citygml.py` writes CityJSON; 23 bake modules read
it with `json.loads(tile.cityjson.read_text())`; the build parses it
through the viewer library `cityjson-threejs-loader` 0.4.0 under a
179-line patch (`scripts/city-lod2.ts`, `scripts/bake-city-mesh.ts`).

**The sites, smallest first** (tiles; size of `dlm/`): Meißen 1, 12 MB;
Grimma 2, 17 MB; Unna 2, 21 MB; Hamburg 4, 44 MB; München 4, 50 MB;
Leipzig 4, 54 MB; Dresden 15, 176 MB.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install`; `uv sync --locked` in `pipeline/` | exit 0 |
| Gate | `bun run fix && bun run verify` | exit 0 |
| Pipeline | `bun run test:pipeline` | pytest and ruff green (and 089's type check) |
| Where a site stands | `bun run site <site>` | every tile's files listed |
| Bake | `bun run bake <site> [--step S] [--jobs N] [--force]` | each step's seconds; no error |
| Build a site | `bun scripts/prepare-data.ts <site>` | publishes, exit 0 |
| Old against new bakes | `uv run --project pipeline python scripts/eval/compare-bakes.py` | exit 0, "0 differences" |

Fetch and bake need the raw downloads and the network at fetch time:
they run on the maintainer's machine, not in CI.

## Scope

**In scope**: `pipeline/bake/**` (a new `store.py`; every step's reads
and writes; `step_cache.py`; `common.py`), `pipeline/tests/**`,
`lib/city/bake-file.ts`, `lib/city/*-file.ts`, `lib/city/features.ts`,
the build's readers of bake files (at `5dfa300d`
`scripts/tile-sources.ts` and the `parseBakeFile` callers under
`scripts/prepare/`; after 090 its one reader a kind),
`scripts/bake-entries.ts`, the four tests named above,
`scripts/eval/compare-bakes.py`, a new comparer under `scripts/eval/`,
`pipeline/pyproject.toml` and `package.json` for the one reader and
writer the maintainer approves, and the docs and skills listed under
*Done criteria*.

**Out of scope**:

- What a bake computes. No heuristic, threshold or rounding changes
  here: a value that differs outside a window's halo is a bug of this
  plan.
- The provider adapters (`pipeline/bake/providers/*`, their five
  functions `dgm`, `dom`, `dop`, `lod2`, `dlm`), the fetch and the
  layout of `data/_raw/`.
- The viewer (`app/`) and what the browser downloads: 090 and 091.
- The tileset's tree and the tile's size: 093 uses what this plan
  opens.
- The lines' levels stay solved by the build (ADR 0041).
- The OSM index (`osm_index.py`): it is the model, not the patient.

## Phases

### Phase 0 — Count, compare, choose (spike; nothing a bake writes changes)

1. **Two comparers.**
   - `scripts/compare-tilesets.ts` — plan 087's (its phase 5): two
     published sites by their manifests; equal hashed names are equal
     files, the rest are compared by content, a kind at a time. Use it
     as it is; if 087's phase 5 has not landed, build it there, not
     here. Below, "the published trees compare equal" means this
     command exits 0.
   - `scripts/eval/compare-bakes.py`, built out here: today it compares only the
     vegetation files against a git ref (`compare_points`,
     `compare_lines`, `compare_rasters`), widened to every kind and to
     two folders: rows matched by identity, order ignored; rows only
     in one, properties that differ, rasters cell by cell.
2. **The inventory**, written into *Findings* as one table a kind:
   writer step, readers (bake steps and TypeScript modules), geometry,
   nested properties, what makes a row the same row (its identity),
   the ownership rule in use, the halo it reads. Take the reads and
   writes from the step cache's manifests
   (`data/_raw/<provider>/.bake-cache/<site>/<step>/<tile>.json`:
   `inputs`, `outputs`) — they record what really happened, across
   tiles — not from reading the modules alone.
3. **The format**, tried on Meißen with three kinds: `bridge` (nested
   properties), `lamps` (points) and `osmbuild` (a record per LoD2
   object, no geometry). Candidates and what is known:

   | Candidate | Written from the pinned stack | To verify in the spike |
   |---|---|---|
   | GeoParquet | no: the wheel's GDAL has no Parquet driver; needs `pyarrow` (a heavy dependency — ask first) | a TypeScript reader with nested columns and no heavy dependency; exact float64 |
   | FlatGeobuf | yes (`FlatGeobuf rw`), as the OSM index is | how nested properties travel (a JSON column loses their types); a TypeScript reader's weight |
   | GeoPackage | yes (`GPKG raw`) | forked workers writing side by side (one file a kind and window, or locks); read in the build with Bun's SQLite and `lib/city/wkb.ts`; nested as JSON text |
   | GeoJSON as now, under the neutral schema | yes | nothing: the fallback |

   Criteria, each a column of the result table: typed columns, nested
   ones included; coordinates and numbers round-trip exactly (float64
   or scaled integers — the build's bytes follow them); a reader in
   TypeScript without a heavy dependency, used by `scripts/` only; a
   writer from the pinned Python stack, or one new dependency the
   maintainer grants; opens in QGIS or DuckDB for a look; size on disk;
   read and write time for a Dresden tile's largest kind.
4. Ask the maintainer with the table. A new dependency is pinned
   exactly and its locked version joins the bake keys, as zod's does.

**Verify**: both comparers exit 0 on a tree against itself and 1 on a
seeded difference (unit tests beside them); *Findings* holds the
inventory and the criteria table. Ledger: file kinds a tile hands over,
formats, `wc -l pipeline/bake/step_cache.py`, modules matching
`\.neighbours()` and `owns(`.

### Phase 1 — One schema says what both languages read (format unchanged)

Zod stays the source: the viewer takes its types by `import type`
(ADR 0059, point 4), and ADR 0059's own Alternatives call the export "a
small step later".

1. Every served GeoJSON kind in `lib/city/features.ts` gets a schema
   module like its 22 siblings; the hand-written interfaces become
   `z.infer`. The casts AGENTS.md still excuses (crowns, canopy, lines
   and areas, the legend's `water`, the sports and markings tables) go
   with their kinds.
2. `bun scripts/store-schema.ts` writes `z.toJSONSchema` of every
   schema to `pipeline/bake/schemas/<kind>.schema.json`, committed; a
   test fails when the committed export is stale (as `docs:matrix`'s
   test does for its page).
3. Python checks **at the write**: one function validates a document
   against its exported schema before any byte is written, so a renamed
   key fails in the bake that renamed it, not in the next build. Use a
   small validator for the subset the schemas use, or `jsonschema`
   pinned exactly (ask: it is small, but a dependency). From the same
   export generate the `TypedDict`s 089's type checker reads
   (committed, pinned by a test).

**Verify**: `bun run verify`, `bun run test:pipeline`; a test seeds a
wrong key into one step's output and sees the write refuse it; a bake
of Meißen publishes the same bytes (`compare-tilesets.ts` exit 0).
Ledger: copies of a shape per kind (was: dict, schema or interface,
tests), kinds still cast (target 0).

### Phase 2 — A step's output is its own

No path is written by two steps. What a later step adds is its own
table, joined where it is read:

- `landcover` writes `landcover_base_<tile>.png` and its legend;
  `islands` reads the base and writes `landcover_<tile>.png` and its
  legend — also where it has nothing to carve (a provider without a
  Basis-DLM, no extract), so every later reader still finds one name.
- `lamp-heights` writes the heights (`h`, `hs`, `arm`), `lamp-water`
  the water (`w`, `wr`), each keyed to the row of `lamps` or `mly` it
  measured; a last small step joins them into today's `lamps_<tile>`
  and `mly_<tile>` files, byte for byte, until phase 4 makes the join
  a read.
- `trees` writes which scan trees it claims; the read of `canopyx`
  leaves them out. `lowveg.rethin_scan_trees` goes.
- `step_cache.py` loses what only rewrites needed: `Ledger._held`,
  `_lasts`, `restore`, `after`, the recorder's `before` and the
  manifest's, the `again` / `then` loops of `Bake.step`; `unchanged`
  is the key, the inputs, the probes, the listings and the outputs as
  recorded. Bump `VERSION`. A test runs every step on the synthetic
  fixture and fails when one path is in two steps' outputs.
- `Tile.raw_absent` keeps its meaning: a step whose raw input is not
  on the machine leaves its own last output standing.

**Verify**: re-bake Meißen, then every site; `compare-bakes.py` against
the site's current data: 0 differences in every handed-over file;
`compare-tilesets.ts`: equal. Ledger: lines of `step_cache.py`, steps
that write another's path (4 → 0).

### Phase 3 — One way to read and one way to write (files still as they are)

`pipeline/bake/store.py`:

- `KINDS`: a kind's schema, geometry, **anchor rule** (who owns a row:
  its point; its envelope's centre; clipped to the window; whole where
  it touches), credit (the `attribution` member — attribution is part
  of the data; the OSM kinds stay checked) and whether it is served.
- `read(kind, extent, columns=None)`: the rows whose geometry meets
  the extent, from whichever windows hold them, each row once.
- `write(kind, window, rows)`: validates (phase 1), keeps the rows the
  window owns by the kind's anchor rule, writes — an empty set where
  nothing was found: every window carries every kind, as every tile
  carries the same files today (`tile-data.test.ts` keeps saying so).

Then the steps move onto it, a family a PR (ground: walls, stairs,
surface, edges, markings; green: canopy, trees, lowveg, cultivated;
buildings: osm-buildings to dormers; lines: rail, tram, riverside,
traffic; lights and furniture; the rest). In each module the name
building (`tile.out("dlm", f"…_{tid}.geojson")`), the loop over
`Tile.neighbours()` and the `owns(` filter give way to `read` with the
halo the step needs and `write`. The backend still writes today's
per-tile GeoJSON, so both comparers must say: nothing changed.

**Verify** (each family): `bun run test:pipeline`; re-bake every site;
`compare-bakes.py` 0 differences; `compare-tilesets.ts` equal. Ledger:
modules matching `\.neighbours()` and `owns(` (14 and 20 at
`5dfa300d`).

### Phase 4 — The format (only if phase 0 chose one)

The store's backend writes the chosen format; the build's readers (one
a kind, joint 7) read it and hand back rows in the schema's key order,
which is the files' order today — pinned by a test, because the baked
bytes follow it. A site at a time, smallest first: Meißen, Grimma,
Unna, Hamburg, München, Leipzig, Dresden. For each: old and new side
by side in the site's folder; `compare-tilesets.ts` on a build from
each must say equal; then the old files go and the site's data is
published the way 088 set up. The four committed-data tests read
through the store's reader — over 088's fixture in CI, over every site
that is on disk. The reader's module is a bake entry or imported from
one, and its locked version is in the keys (`bake-entries.test.ts`).

**Verify** (each site): the two builds publish the same manifest;
`bun run verify`; `bun run test:pipeline`. Ledger: the site's store
size against its `dlm/` size, `prepare-sites` warm and cold for that
site, formats handed over (3 → 1 plus rasters).

### Phase 5 — Windows, not tiles: the bake is site-wide

The 2 km cell stays as the **window** a step works in; it stops being
what a row belongs to.

- A step reads by extent and halo and writes what its window owns; a
  thing on a seam exists once, by its identity, whoever saw it.
- The site-wide measurements become site tables written once by a
  step of their own (the NDVI's anchors, the flight's colour cast, the
  roofs' sun readings, the bin tone, the leaf-off flight); `run_tile`'s
  special cases, `warm` and `step_cache.memo` go.
- **Rasters stay cut by window with a halo.** A tile's orthophoto is
  10 000² texels in three or four bands and Dresden has fifteen; the
  heights are 2 000² floats a tile. No site fits in memory, and a
  raster step is local: a window read with a halo at least its
  kernel's reach gives the site-wide answer. `mosaic`, `dgm_paths` and
  `dom_paths` are that read already; the output rasters get a site
  index, so publishing can cut any extent (class rasters NEAREST,
  never through an image resize).
- **Tiles are cut at publishing**: the build asks the store for an
  extent and gets rows by the kind's anchor rule; `sideFileSource` and
  the per-tile source names in `lib/city/tile.ts` go. The tileset's
  tile is still 2 km until 093 says otherwise.

The proof changes here, once a site. Order differs and seams differ by
design, so `compare-bakes.py` must show every row of the old data in
the new, and every difference within the halo of a window's edge; 087's
plates of the seam views (`seam-eye`, `seam-fly`) are looked at; the
site's published bytes change once and are recorded.

**Verify** (each site): the comparison's report, with no difference
away from an edge; `bun run verify`; the e2e suite
(`bun run test:e2e`); 087's plates. Ledger: modules with seam handling,
the site's bake time (the runner prints each step's seconds), published
bytes before and after.

### Phase 6 (optional) — The buildings as typed surfaces

Only on the maintainer's word after phase 5. The fetch's converter
writes the buildings as tables — an object a row (id, parent, root,
attributes), a surface a row (object, wall / roof / ground, its rings
in three dimensions) — keyed by `gml:id`, owned by envelope centre as
now. The build triangulates the rings with `earcut` (a dependency
already) in a module of its own; `cityjson-threejs-loader`, its patch
and its pin leave `scripts/city-lod2.ts` and
`scripts/bake-city-mesh.ts`; the 23 bake modules read the tables.

**Verify**: per object the same footprint, height span and roof area
as before (a test over every site); `ground-joins.test.ts` budgets
unmoved; 087's `roof-close` and `oblique-400` plates. Ledger: the
buildings' bake seconds and peak memory a tile, the city glbs' bytes.

## Test plan

- Unit tests for both comparers (equal, seeded difference, canonical
  JSON, a raster cell).
- `pipeline/tests/`: the store's anchor rules on synthetic rows at a
  seam (a point on the west edge, a line across it, a building whose
  centre lies next door); `read` returns a row once across two
  windows; `write` refuses a row its schema does not take; no path in
  two steps' outputs. Model on the existing end-to-end runs of `walls`
  and `stairs` against the synthetic DGM and OSM fixture.
- `lib/city/`: the schema export is current; the reader returns keys
  in the schema's order; each viewer guard still agrees with its
  schema.
- The four committed-data tests keep their meaning through every
  phase.

## Done criteria

- [ ] `bun run verify` and `bun run test:pipeline` exit 0
- [ ] `grep -rn "\.neighbours()" pipeline/bake` and
      `grep -rn "rethin_scan_trees\|_held\|_lasts" pipeline/bake`
      return nothing
- [ ] No step's manifest lists a path another step's lists as output
      (the test of phase 2)
- [ ] `grep -rn "readJson(.*) as " scripts lib` returns nothing for a
      bake's file; AGENTS.md's list of excused casts is gone
- [ ] Every site's comparison report is filed in *Findings*; every
      site is on the store, none on both
- [ ] ADR 0059 rewritten (the source is zod, exported; Python checks
      at the write; the format; its Alternatives no longer rest on
      "files no longer diffable" — with 088 the data is not in git, and
      the comparers show what a re-bake changed); ADR 0037 rewritten
      (the bake's unit is a window, ownership is the store's, tiles are
      cut at publishing); ADR 0012 checked where credits moved
- [ ] `docs/data-pipeline.md` ("What a re-bake runs", "The steps",
      "Files a bake hands over", "The contracts the browser relies
      on"), the `new-bake-step` and `add-city` skills and AGENTS.md's
      Data rules say what the code does
- [ ] 087's ledger has every phase's figures; this plan's README row
      is updated

## STOP conditions

- **A raw source cannot be had.** A re-bake needs a download that is
  gone or unreachable (plan 022 met GeoSN's laser scan as a 404 and an
  unreachable OSM mirror): stop the phase for that site. Its old data
  stays the published one; nothing is half moved. `Tile.raw_absent`
  must never be the way a site "passes".
- **A comparer shows a difference it should not**: a changed value
  before phase 5, or in phase 5 a difference farther from a window's
  edge than the step's halo.
- **No candidate meets the criteria** in phase 0 (exact round trip, a
  light TypeScript reader, a writer the maintainer accepts): keep
  GeoJSON under the schema, skip phase 4, go on — phases 1 to 3 and 5
  pay without it.
- **The read API does not pay**: after the first family of phase 3 the
  seam call sites in it fell by less than a third.
- **Forked workers and the format**: `--jobs` writes side by side; a
  backend that cannot (a lock, a half-written table another worker
  reads) is not chosen.
- **A site's bake or build becomes slower by more than a quarter**, or
  a window's memory grows: report with the step's seconds.
- **088 has not landed** and the chosen format is binary: do not
  commit a binary store to git (joint 2).

## Maintenance notes

- A new bake step is a row in `KINDS`, a schema and two calls; it
  names no file and no neighbour. The `new-bake-step` skill is the
  place that says so.
- The anchor rule and the halo are a pair, as plan 057 learned of the
  ownership rule and the margin: whoever changes one checks the other.
- The schema's key order is the build's byte order. Reordering a
  schema re-bakes; say so beside `BakeFile`.
- Reviewers: any diff in a published byte before phase 5; any step
  that opens a path the store did not hand it.
- Deferred: moving the lines' levels into the bake (ADR 0041 keeps
  them in the build); a NAS reader (plan 017); per-window incremental
  publishing.

## What the series changes about this plan

Built alone, this plan would stop after phase 2 or keep GeoJSON: with
the data in git a binary table has no diff and no delta, which is why
ADR 0059 turned such formats down. 088 removes that reason. Alone it
would also have to touch every baker of the build twice — once for the
format, once when 090 moves the dressing; 090's one reader a kind
(joint 7) makes it one place. Alone it would have no plates for
phase 5, where bytes no longer prove anything: 087 is why that phase is
allowed at all. And alone nobody would ask for the cut at publishing;
093 does.

## Findings

> **Slimmed before milestone 1 (2026-11-24; plan 086, ruling 5).** Phase
> 0's tools left `rewrite`: the ledger's `bakeStore` section, the
> built-out `scripts/eval/compare-bakes.py` with its test (the file is
> main's again: the hand-over format stays GeoJSON, decision 4 of plan
> 086's list), and `scripts/compare-tilesets.ts`, which is on the branch
> `tools/compare-tilesets`. All are history at commit `b00b08c2`: a
> phase above that says "compare with `compare-bakes.py`" or
> "`compare-tilesets.ts`: equal" fetches them from there first. The
> figures below are the record.

### Phase 0 (2026-11-16): counted, compared, the format tried

Counted over the committed files of all seven sites (32 tiles) and by
grep; who wrote and read what is from the manifests of a Grimma bake
(two tiles, 37 steps). The other formats, every time and the Grimma
re-bake are single runs.

| Counter | At phase 0 |
|---|---|
| File kinds a tile hands over (`dlm/` and `dop/`) | 51: 28 GeoJSON, 13 JSON, 10 PNG (Dresden, Grimma, Meißen; Leipzig, München and Unna 50, Hamburg 49) |
| Formats | 3 |
| Dresden's fifteen tiles by format | GeoJSON 103.3 MB, PNG 70.9 MB, JSON 12.5 MB |
| `wc -l pipeline/bake/step_cache.py` | 619, 503 of them code (609 at `5dfa300d`; #315 added ten) |
| Modules matching `\.neighbours()` | 14 |
| Modules matching `owns(` | 20 by the plan's grep; 17 call `owns` — `canopy.py`, `roof_planes.py` and `skyview.py` only match in "cr**owns(**" |
| Steps that write a path another step wrote | 4: `islands` (`landcover.png` and `.json`), `lamp-heights` and `lamp-water` (`lamps`, `mly`), `trees` (`canopyx`) |
| Kinds with no single key order | 2 over all sites: `furniture` within a file; `traffic` between sites (Dresden `t, f, hf, b, …`, the others `t, f, b, sp, hf, …`). The other 26 feature kinds have one order each |
| Exact duplicates, rows equal in geometry and every property | furniture 14, trees 13, lamps 9, walls 5, structures 4 |
| Rings that do not close | 214 of the 623 bridge outlines; no other kind has one |
| Properties written as `null` | 2: `bridge.name` and `passages.h`; everywhere else a missing value is a missing key |

Grimma as committed against its re-bake, order ignored: 114 files, 103
the same, 11 differ in 522 places — all newer street photos, a newer
OSM extract or the missing laser scan (`lowveg`, below).

### The inventory

The two tables, a row a kind (rows, geometry, nested properties,
identity; writer, readers, owner, halo, TypeScript readers), are in
this file at `b00b08c2`. What they say to the phases that follow:

| Finding | What it is |
|---|---|
| A row's identity is its geometry | in 27 of 28 feature kinds; only the plinths have a name of their own (`of`). "Each row once" compares geometry, and a clipped kind has no identity across a seam |
| Eight joins go by a row's place in its file | `treefacts` to `trees`; `markings.png` and `sport.png` to their tables; the land cover's tint grid to `water.bodies`; `roofcolor`'s `scan` and `gaps` to `smallbuild` and `structures`, and a rebuilt roof's parts to a building's rows in `roofs`; the build's solved levels to `rail` and `tram`; the terrain study to the walls. Phase 3's `write` keeps the order it is given, or these get keys first |
| One file, several owner rules | `rail`, `tram`, `walls`, `furniture`, `cultivated`, `riverside` and `lowveg` hold clipped rows beside point-owned ones (the point, a middle, a first vertex, a representative point or a centroid). `KINDS`' anchor rule is a rule a kind of *row*, not a file |
| Whole where it touches, in both tiles' files by design | `bridge`, `stairs`, `terraces`, the sports grounds, the DLM's rail lines and tree rows, the seam copies of gates and markings. A deck's readers (`lamps`, `furniture`, `traffic`) open every tile's `bridge` file and meet it twice |
| In no tile's file | a lamp or a piece of furniture mapped in one tile and moved to the kerb in the next (both points must be owned); a platform whose representative point lies on the edge (`box.contains`, where every other step uses `owns`) |
| `Tile.neighbours()` is the whole site | not the eight around: most callers cut it down with `overlaps`, the decks' readers do not |
| Halos come in three units | degrees on the OSM read (0.0005 to 0.05), metres on rasters and files (20 to 1 500), and "the site" (five memos; `walls.site_material` and `stairs.site_stair_material` are not memoised). Four were fixed at the fetch (the cadastre 10 m, the photo cells 1 m, the panoramas 30 and 60 m, the bridges' Wikidata 500 m): a `read(kind, extent)` cannot widen those |
| A step reads a file written after it | `canopy` reads `canopyx`, which `lowveg` writes 26 steps later — the last bake's, so a first bake and a second differ; `landcover` reads the last bake's class rasters, its own among them, for the site's road tone. `shopfronts` rewrites its own last output where its photo cache is not on the machine (`refilter`; `traffic`'s `reflag` is the same). All belong to phase 2's list beside the four rewrites |
| Read without a schema | two legends nobody reads in TypeScript (`edges.json`, `surface.json`); three served tables published unparsed (`sport.json`, `markings.json`, `treefacts.json`); the kinds 090 still serves as baked are read by a cast in the viewer |

### The format trial

Run on 2026-11-16 (4 cores, Bun 1.4.4, Python 3.13) on Meißen's
`bridge` (17 rows, nested), `lamps` (715 points) and `osmbuild` (5 012
records, no geometry), on 1 335 made-up rows of awkward float64, and
for the times on the largest kind of a Dresden tile, a canopy file of
81 383 points and 10.9 MB. Nothing of it was installed.

| Criterion | GeoParquet | FlatGeobuf | GeoPackage | GeoJSON under the schema |
|---|---|---|---|---|
| Typed columns | yes | scalars only | scalars only | none in the file: the schema is beside it |
| Nested ones | yes (`list<struct<…>>`; DuckDB shows the same types) | no: a text column holding JSON | no: a text column holding JSON | as JSON, checked by the schema |
| float64, Python → TypeScript | exact, all 1 335 rows and the three kinds | exact | exact | exact |
| What does not round-trip as it is | `null` against absent; int64 comes back as `BigInt` unless the column is declared int32 | the same `null`; **row order** (the spatial index sorts the rows; `SPATIAL_INDEX=NO` or a sequence column) | the same `null` | nothing |
| A table without geometry (`osmbuild`) | yes | written only with `SPATIAL_INDEX=NO`; the package's GeoJSON reader throws on it | yes | yes |
| TypeScript reader | `hyparquet` 1.33.0: 303 KB installed, no dependency, 61 KB bundled (18 KB gzip), MIT; snappy built in, zstd needs `hyparquet-compressors` (549 KB and four packages in all, 176 KB bundled) | `flatgeobuf` 4.6.1: 3.7 MB installed with four dependencies, 55 KB bundled, BSD-3 | none to add: `bun:sqlite` and `lib/city/wkb.ts` | none |
| Writer from the pinned Python stack | **no**: the wheel's GDAL 3.12.4 has no Parquet and no Arrow driver; needs `pyarrow` (26.0.1; 166–171 MB installed) | yes | yes | yes |
| Forked workers | a file a kind and window | a file a kind and window | the same; eight workers writing a layer each into **one** file: seven failed | a file a kind and window |
| Opens for a look | DuckDB (tried); QGIS where its GDAL has the Parquet driver (not tried) | GDAL, so QGIS; DuckDB's `st_read` (tried) | the same (tried) | the same (tried) |
| An empty table | 475 B | 2 208 B | 98 304 B — fifty kinds a tile are 4.9 MB of empty tables | 184 B |
| Size: `bridge` / `lamps` / `osmbuild` (as committed 14.0 / 104.7 / 363.1 KB; gzip 3.5 / 8.5 / 93.0) | 11.8 / 13.2 / 93.5 KB (zstd); 12.4 / 16.0 / 143.4 (snappy) | 15.1 / 110.9 / 461.5 KB | 110.6 / 192.5 / 397.3 KB | as committed |
| Size: Dresden's canopy tile (10 862 KB; gzip 545) | 417 KB (zstd), 744 (snappy), 2 248 (none) | 10 947 KB (gzip 1 307) | 9 470 KB (gzip 1 830) | 10 862 KB |
| Write, Python, that tile (best of 3) | 0.56–0.63 s | 0.86–1.01 s | 1.03–1.11 s | 0.24–0.32 s |
| Read, Python | 0.06–0.07 s (to rows) | 0.14–0.17 s (arrays, WKB undecoded) | 0.18–0.19 s (the same) | 0.18–0.20 s |
| Read, Bun, to rows | 57–74 ms (snappy), 117–194 ms (zstd) | 172–187 ms | 155–170 ms | 68–112 ms |

The times are good to a factor of about 1.5: no candidate is slow, and
nothing finer. Whatever the format: a writer that builds its WKB with
shapely closes the unclosed rings, so a binary store packs its own WKB
or keeps coordinates in a typed list; phase 1's schema says whether a
key is `null` or absent; phase 4's "the files' order today" holds for
`furniture` and `traffic` only once their writers are put in one order
(their bytes change, not their content); and a store that keeps "a row
once, by its identity" drops the exact duplicates, which phase 5's
comparison must expect.

### The recommendation, and the question for the maintainer

**Keep GeoJSON under the one schema and skip phase 4**; build the
store's `read` and `write` (phase 3) so that the encoding stays behind
them and can be changed later in one place. If a binary format is
wanted all the same, **GeoParquet is the only candidate that meets the
criteria**, at the price of `pyarrow` in the bakes' environment.

- FlatGeobuf and GeoPackage fail the first criterion for the 14 of 28
  feature kinds that have nested properties and for every record map,
  and neither is smaller than the GeoJSON it replaces.
- GeoParquet's files are 1.2 (`bridge`), 3.9 (`osmbuild`), 8 (`lamps`)
  and 26 (the canopy) times smaller than the GeoJSON as written;
  against the GeoJSON gzipped, which is how 088's store would hold
  either, it is larger for `bridge` (3.4 times) and `lamps` (1.6), the
  same for `osmbuild` and 1.3 times smaller for the canopy.
- It costs `pyarrow` in every bake's key, a migration a site, a WKB
  packer of our own, and files no longer readable in an editor or a
  diff.
- What the series counts comes from phases 1, 2, 3 and 5 with the
  format unchanged: the browser reads none of these files after 090,
  and the build's read of the largest one is 0.1 s.
- The one number that could change this is phase 5's, not measured: a
  read by extent parses up to nine windows' files of a kind, 9 ×
  0.19 s for the canopy in Python against 9 × 0.065 s from Parquet. If
  the bake's time grows by that (the STOP at a quarter), the format is
  the lever, and the store is where it is pulled.

The question: **(a)** GeoJSON under the schema, no new dependency,
phase 4 skipped (recommended); or **(b)** GeoParquet — then granted
are `pyarrow` (26.0.1 today; bakes only) and `hyparquet` (1.33.0;
`scripts/` only), both pinned exactly, snappy so that the reader stays
one package. Phase 1's own question stays open beside it: a small
validator of our own for the exported schema, or `jsonschema` pinned.

### For phase 2: a step without its raw input

Two cases where a bake wrote less instead of leaving its last output
standing, against "`Tile.raw_absent` keeps its meaning". **Without the
OSM extract** a bake rewrote the committed `trees`, `rail`,
`monuments`, `edges` and `ndvi`, and the canopy and the land cover
after them, with what the official data alone gives; since PR #315
such a step skips. **Without the laser scan** (seen in phase 0's
Grimma bake, not fixed) `small-buildings` skips and `canopyx` stays,
but `lowveg` rewrites `lowveg_<tile>.geojson` from OSM alone: the
committed hedges lost the heights the scan had measured (2 of 2 rows
on `33340_5678`: `h`, `w`, `src`). It is the documented "No LAZ: OSM
only" of a tile that never had a scan, applied to one whose scan is
merely not on this machine.

### Phase 2 (2026-11-24): a file has one writer, and the ledger goes

Built reduced, as plan 086's ruling 5 asks: no new file under `data/`,
no join step, less code.

| What phase 0 found | What it is now |
|---|---|
| `islands` rewrote the land cover's raster and legend | the step is gone: `landcover` carved the islands itself already, the step only did it again. Gone with it: refreshing the islands of a committed raster from a newer extract on a machine without the raw DLM (`--step islands`), where `landcover` stops |
| `lamp-heights` and `lamp-water` rewrote `lamps` and `mly` | `lamps` and `mapillary` hand their points on under `data/_raw/<provider>/work/<site>/` (`Tile.work`), `lamp-heights` the two with their heights, and `lamp-water` alone writes the two files. `tram`, which reads the lamps, runs after it |
| `trees` rewrote `canopyx` (`lowveg.rethin_scan_trees`) | `lowveg`, whose file it is, thins its standing scan trees itself where the scan is not on the machine |
| `canopy` read the last bake's `canopyx` | it reads none: `lowveg` writes no scan crown within 5 m of a canopy point, a row's tree among them, so the row's tree now stands where a scan crown took its place before. Without the scan on the machine the standing crowns were thinned against the rows' trees only until 2026-11-24 (3 211 committed crowns stood within 5 m of another canopy point); since then against every canopy point, as with the scan |
| the `Ledger`, the `again` / `then` loops, the recorder's `before` | gone: `step_cache.unchanged` is the key, the inputs, the probes, the listings and the outputs as recorded; `VERSION` 4. `step_cache.py` 619 → 503 lines |

**The maintainer's decision (2026-11-24, passed on by the series'
coordinator): a row's tree wins over a scan crown, as built here.**

Not done, and why:

- `landcover` still takes the flight's cast for the water's tint from
  every tile's class raster as the last bake left it — the same step's
  on the other tiles, no later step's. Only a site's very first bake
  reads fewer of them than its second. Reading them in the same bake
  needs a second pass over the tiles or a file of its own.
- `shopfronts` (`refilter`) and `traffic` (`reflag`) still filter their
  own last output where their raw input is not on the machine, as
  `lowveg` now does its scan trees: `Tile.raw_absent`'s meaning.
- `lowveg` without the laser scan wrote the hedges from OSM alone
  ("For phase 2", above). Since 2026-11-24 it leaves the file where
  the provider publishes a scan (`products.lsc`) and it is not on the
  machine (`Tile.raw_absent`); every site of such a provider is baked
  with its scan.
- On a machine without the Mapillary cache the tile's `mly` file stands
  as before, but its lamps are no longer measured again with OSM's
  (they are not handed on).

**The read helper.** `Tile.features(kind, near=None)`: a kind's
features of the tile, with an extent those of every tile that reaches
into it. Used where it made the call site shorter (canopy, cultivated,
dormers, furniture, lowveg, roof-colour, small-buildings, tram, ways);
`json.loads` calls in `pipeline/bake/*.py` 102 → 87. The modules that
call `Tile.neighbours()` stay 14: the others read rasters, not
features.

**Counted.** `code.product.pipeline/bake` 35 634 → 35 441 (−193);
steps 37 → 36; steps that write a path another step wrote 4 → 0.

**Grimma, baked here** (two tiles, BBBike's extract, no laser scan —
GeoSN's listing has none today), cold with `--force`, `rewrite` twice
and this branch twice, then once more with the cache:

- `rewrite`'s two bakes are the same 114 files.
- This branch against `rewrite`: 107 files the same bytes; 7 differ, all
  on purpose. `canopy_<t>.geojson`: 75 and 107 row trees more (16 → 91,
  15 → 122), each within 4.5 m of a scan crown that had kept it out.
  `canopyx_<t>.geojson`: those scan crowns gone (5 410 → 5 338,
  2 492 → 2 384). `svf_<t>.png`, which draws both: 1.0 % and 1.8 % of
  its texels. `provenance.json`: no `islands` entry.
- The branch's first, second and third bake are the same bytes; the
  third skips all 72 runs. In its manifests no path is in two steps'
  outputs and no step reads what a later step wrote.

Every step is keyed anew (`common.py` changed, and `VERSION`): the next
bake of a site runs all of it. On a machine with the scans the
committed data then changes where Grimma's did here — the canopy's row
trees, the scan trees beside them, the sky view — and nowhere else.
