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
- **Status**: TODO

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

*(empty: the inventory, the format's criteria table, each site's
comparison report)*
