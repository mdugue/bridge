# Plan 090 [rewrite]: A tile's dressing arrives in the layout the GPU draws from

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and `AGENTS.md`
> first, then load the `city-walker`, `new-scene-layer` and
> `new-bake-step` skills. The plan goes a family of layers at a time; each
> phase is one PR and ends in a **Verify** and in figures written into the
> ledger plan [087](./087-rewrite-measuring-stick.md) sets up. If a STOP
> condition occurs, stop and report with the figures — do not improvise.
> Update this plan's row in `docs/plans/README.md` after every phase.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- app/_components/tile-stream.ts app/_components/instancing.ts app/_components/late-parts.ts lib/city/tile.ts lib/city/tileset.ts lib/city/build-steps.ts lib/city/coarse-crowns.ts lib/city/point-pack.ts scripts/coarse-crowns.ts scripts/bake-entries.ts scripts/ground-joins.ts`
> — on a change, compare "Current state" with the code before going on.

## Status

- **Priority**: P1
- **Effort**: L — six phases, each S–M
- **Risk**: MED–HIGH — the picture must not change, and three's public
  API has to take a compact instance record (Phase 0 finds out)
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (plates and
  ledger; hard); [088](./088-rewrite-tiles-as-a-data-product.md) for the
  byte gates as a visitor is served (until then they are measured on
  `public/data`)
- **Category**: rewrite — faster on the device; fewer bytes and requests;
  less code in the viewer
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: IN PROGRESS — phase 0 built 2026-11-16 (Findings)

## Why this matters

A fine terrain level fetches up to seventeen side files, parses most of
them as GeoJSON and rebuilds its dressing — trees, lamps, rails, trams,
furniture, monuments — in JavaScript on the thread that draws, on every
device, on every visit. All of it is a function of committed files; none
of it depends on the visitor. Before the builders were cut into slices a
phone lost 0.7–1.3 s a builder a tile; since then the cost is spread, not
gone, and the viewer carries the machinery that spreads it. After this
plan the build has placed everything, a tile brings its dressing as
tables whose bytes are the vertex buffers, and the viewer uploads them.
It takes over [plan 074](./074-architecture-deepening.md) part A and its
spike, PR #156.

## Current state

Counted and read on 2026-11-16 at `5dfa300d`.

**The seventeen dressing kinds** (`lib/city/tile.ts`, the `ARTIFACTS`
rows with `dressing: true`): `vegrows`, `canopy`, `cultivated`, `lamps`,
`monuments`, `furniture`, `mly`, `rail`, `bridge`, `railarea`,
`platform`, `tram`, `riverside`, `trees`, `traffic`, `lowveg`,
`canopyx`. The coarse level has three (`coarse: true`): `bridge`,
`traffic` and the built `crowns`. One file is fetched only with a
question (`ask: true`): `treeFacts`. `canopy` and `canopyx` are published
packed (`lib/city/point-pack.ts`, magic `PTS1`, 12–20 bytes a point);
the other fifteen are GeoJSON.

**Where they are built**: `buildDressing` in
`app/_components/tile-stream.ts` fetches every kind at once
(`allNamed({ rows: get("vegrows"), canopy: getPoints("canopy"), … })`),
loads the NDVI raster a second time as a CPU sampler for the trees
(`loadNdviSampler`), joins kinds
(`const lamps = [...osmLamps, ...fromMapillary.lamps]`,
`lampsBy(rails, trams, …)`, `tramSteps(trams, bridges, pinned)`,
`offMonuments(canopy, monuments)`), filters by seam ownership
(`ownsPoint`) and runs the builders one after another, with
`await nextTask(signal)` between them and `inSlices(…)` inside the long
ones. The inquiry's solids (`lib/city/ask-items.ts`: `treeSets`,
`monumentItems`, `bridgeItems`, `moreSetsSteps`) are built from the same
features in idle time.

**What the slices cost and hide** (`docs/rendering.md`, "The frame
budget"; `lib/city/build-steps.ts`): as one task each, on the phone
profile, the rails took 1.3 s (a yard's ballast draped at 1 m), the
trees 0.8–1.3 s, the tram 0.7 s, the ask sets 0.4–0.7 s. They now run in
slices of `SLICE_MS = 8` (`REST_SLICE_MS = 30` while the camera rests),
and every pause costs a frame.

**How an instance is drawn** (`app/_components/instancing.ts`): an
`Instances` set is a `Mesh` over an `InstancedBufferGeometry` whose
matrices are one `InstancedInterleavedBuffer` of sixteen floats an
instance (`new Float32Array(capacity * 16)`, attributes
`iMat0`…`iMat3`), written on the CPU with `setMatrixAt`; colours are a
second buffer (`iColor`, three floats), further per-instance values a
buffer each (`instanceFloat(name)`: the trunks' `TRUNK_DROP`, the
monuments' `iFinish`). `instancePosition()` branches on
`builder.geometry.hasAttribute("iMat0")`. That is 64 bytes an instance
before colour, against the 20 bytes of the record the build already
writes for a coarse crown.

**The pattern to follow is in the repository twice.**

- `lib/city/coarse-crowns.ts` and `scripts/coarse-crowns.ts`: the build
  runs "the fine level's own placement … on the fine level's own
  ground" and publishes `crowns_<tile>.crw.gz` — `CRW1`, 20 bytes a
  crown: `float32 x, z`; `uint8 code, ndvi, genus`; `int8 jitter`;
  `uint16 rot`; `uint16 a, b, c`. The viewer
  (`coarse-crowns-layer.ts`, 225 lines) still turns each record into a
  matrix and reads the ground for its height (`ctx.heightAt`).
- ADR 0030, decision 3: stairs, walls, kerbs and fences are named nodes
  in the fine terrain glTF, "and the browser computes nothing";
  `scripts/ground-joins.ts` holds them to budgets (`JOIN_PARTS`:
  kerbs, walls, stairs, fences, sheds, doors, plinths, monorails).

**The spike, PR #156** (branch `claude/plan-074a-bake-lines-spike`,
draft since 2026-10-11, based on `073a00d`, unmerged, not looked at on a
real GPU). It baked rails, trams and riverside as triangles into the
fine glTF (24 named nodes, `lib/city/line-nodes.ts`), with the builders
made DOM-free (`lib/city/rail-mesh.ts`, `tram-mesh.ts`,
`riverside-mesh.ts`, `wire-mesh.ts`, `mesh3.ts`, `scripts/bake-lines.ts`).
Its numbers: the spawn fine glb 1 862 749 → 2 073 882 bytes gz
(+11.3 %); all fifteen of Dresden 31.2 → 34.4 MB (+10.1 %, the worst
tile, the Neustadt yards, +34.5 %); side files a fine level 19 → 14;
`dressing:build` on the spawn level 1.65–2.90 s → 0.78–1.75 s
(SwiftShader). Float positions were rejected (+27.6 %). Left open: the
line materials compiled inside the content's compile, which holds a
tile-renderer parse slot; street rails stand 2 cm proud while a 16-bit
position steps up to 3 cm over a tile. **Triangles weigh more than the
lines they come from**: that is why this plan prefers tables the GPU
expands (086, joint 5).

**What already expands on the GPU**: `app/_components/wire-ribbons.ts`
draws wires as camera-facing ribbons from per-vertex direction, side and
half-width; the crowns' shape, lean, sway and season are vertex and
fragment nodes over one geometry (`vegetation-layer.ts`,
`crown-season.ts`); the tiers a 250 m chunk draws are planned at
runtime (`lib/city/vegetation-lod.ts`).

**Sizes** (lines, 2026-11-16): `vegetation-layer.ts` 2 093,
`bridge-layer.ts` 1 448, `rail-layer.ts` 1 216, `furniture-layer.ts`
1 202, `monument-layer.ts` 1 021, `lamp-layer.ts` 807, `tram-layer.ts`
781, `riverside-layer.ts` 600, `low-vegetation-layer.ts` 534,
`tree-inventory-layer.ts` 500, `catenary-layer.ts` 410,
`cultivated-layer.ts` 392, `coarse-crowns-layer.ts` 225 — about 11 200
lines in thirteen modules, materials included.

**Rules that bind every phase** (`AGENTS.md`): WebGPU draws from at most
eight vertex buffers and the clay is two inter-stage variables short of
sixteen — past either a mesh vanishes; never `InstancedMesh`; a material
without per-tile data is a `sceneMaterial`; what a tile brings is built
in the dressing plugin's `processTileModel` (later: a late part,
`late-parts.ts`), compiled before it shows, freed in `disposeTile`, and
weighed in `calculateBytesUsed`; anything added after the first frame
calls `invalidateShadows()`; a part that stands on the ground uses
`lib/city/ground-join.ts` and reports its `joins`; a line takes its
level from the build (`lineLevelsAt`, ADR 0041); every tile carries the
same baked files (`lib/city/tile-data.test.ts`); a bake's modules are in
its row of `scripts/bake-entries.ts`; a file a bake writes and
TypeScript reads has one zod schema (ADR 0059); **a phone's memory must
not grow** (ADR 0047).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install` | exit 0 |
| Autofix, then the gate | `bun run fix && bun run verify` | exit 0 |
| One site's tileset | `bun scripts/prepare-data.ts dresden` | publishes under `public/data/dresden/` |
| Every site | `bun run build` | exit 0 |
| Ground joins | `bun test scripts/ground-joins.test.ts` | pass |
| Same files a tile, bake keys | `bun test lib/city/tile-data.test.ts scripts/bake-entries.test.ts` | pass |
| Headless e2e | `bun run test:e2e` | pass |
| Real-GPU plates | `bun run shots` and plan 087's comparison | within its tolerance |
| Ledger | the command plan 087 defines | a row per figure, before and after |

## Scope

**In scope**: `app/_components/tile-stream.ts` (`buildDressing`,
`buildCoarseDressing`, the dressing plugin), `instancing.ts`, the
thirteen layer modules above and `sport-fixtures.ts`, `tree-foot.ts`,
`track-bed.ts`; `lib/city/tile.ts`, `tileset.ts`, `build-steps.ts`,
`point-pack.ts`, `coarse-crowns.ts`, `tree-placement.ts`,
`tree-inventory.ts`, `ask-items.ts`, `ask-solids.ts`; new
`lib/city/dressing-pack.ts` and one `lib/city/<kind>-file.ts` a kind;
new `scripts/dressing-sources.ts`, `scripts/bake-dressing.ts`,
`scripts/prepare/dressing.ts`; `scripts/bake-entries.ts`,
`scripts/ground-joins.ts`; the docs and ADRs named in Phase 5.

**Out of scope**: the Python bakes and the files they write (their
format is [plan 092](./092-rewrite-bake-store.md)'s); the rasters
([091](./091-rewrite-rasters.md)); the tile grid
([093](./093-rewrite-streaming-quadtree.md)); the buildings' glTF and
the clay; the window niches (plan 085); the data layers' live sources;
the murals; a worker pool (086, joint 6); merging or closing PR #156
(say what became of it in this plan's row; the maintainer closes it).

## Where every kind goes

Four homes. **Stands**: an instance table the vertex shader expands.
**Lines**: a table of segments the GPU expands. **Nodes**: triangles
baked into the fine glTF beside the ground, as ADR 0030's parts are.
**Runtime**: it moves, or a visitor switches it on.

| Kind today | Home | Reason; what stays at runtime |
|---|---|---|
| `canopy`, `canopyx`, the tree rows of `vegrows`, `trees`, the orchards of `cultivated` | stands — one table, sorted by 250 m chunk | the largest counts (a forest chunk ≈ 1 300 trees; a tile up to 81 000 canopy points) and the build already places them for the coarse crowns. Runtime: the tiers (`vegetation-lod.ts`), season, sway, colour |
| `crowns` (coarse) | stands — the same record | already a table; the viewer stops making matrices from it and reading the ground |
| `lamps`, the lamps of `mly` | stands | a post, an arm, a head. Runtime: the fixed pool of real lights and the night |
| `furniture`, the bins of `mly`, the sport fixtures | stands, over one site-wide set of models | a model, a place, a turn. Runtime: a flag's cloth, a clock's hands |
| `monuments` | stands for statues, stones and columns; nodes for basins | a basin is a ring of its own shape. Runtime: a fountain's water |
| masts, piles, posts, stop signs (in `tram`, `riverside`, `rail`) | stands | the spike merged them into triangles; an instance is smaller |
| `lowveg`, the hedge rows of `vegrows`, the vine rows of `cultivated` | lines | a hedge is a section along a line |
| the rails of `rail` and `tram`, the wires of trams, railways and lamps | lines **or** nodes — Phase 0 decides by bytes and by milliseconds | a rail is a profile along a line; the wires already expand on the GPU. Against it: a street rail needs centimetres |
| `railarea`, `platform`, the tram's beds, the piers, pontoons, huts and groynes of `riverside` | nodes | areas draped on the ground and a few irregular solids; no table is smaller than their triangles |
| `bridge` | nodes on both levels — last, behind a STOP | the largest builder, asked through its meshes today and drawn by the coarse level too |
| `traffic` | runtime | a data layer, off at start, bodies built on the first switch-on (ADR 0040). Its lines arrive as a table, not as GeoJSON |
| tram cars, bikes, the ferry's wake, water sheets | runtime | they move, or come from the level's own triangles |

## Phases

### Phase 0 — the baseline and two spikes (one PR, nothing visible)

1. **Baseline.** With plan 087's ledger, record for Dresden's spawn tile
   `33412_5656_2_sn`, a forest tile (`33416_5658_2_sn`), the Neustadt
   yards (the spike's worst tile) and München's heaviest
   (`32690_5334`), on the desktop and the phone profile: wire bytes and
   requests of a fine level by kind; scene-thread milliseconds by
   builder (`?trace=1`, the `dressing:build` and `dressing:asks`
   marks of `stream-timing.ts`); the bytes the dressing weighs
   (`calculateBytesUsed`); the longest task of a flight.
2. **The stand record, on the coarse crowns.** They are the smallest
   case and their file is the record. Draw a coarse level's crowns from
   the fetched bytes without `setMatrixAt`: give `Instances` a second
   way in (attributes over the record's own bytes instead of
   `iMat0`…`iMat3`) and let `instancePosition()` compose place, turn
   and scale in the vertex stage when the geometry has them. Target
   record, to be confirmed here: place `x, y, z` as 16 bits each over
   the tile's box plus the turn in the fourth (the height baked — the
   build stood it on the level's ground); three sizes and a spare as
   16 bits; `code`, `ndvi`, `genus`, `jitter` as four bytes — 20 bytes,
   stride a multiple of 4. Find out, on public API only: which typed
   arrays and `normalized` flags reach TSL as which types; whether one
   interleaved buffer can hold 16-bit and 8-bit fields or the record
   needs two or three buffers; that the tile's box reaches the shader
   through the set's own matrix or a slot
   (`app/_components/material-slots.ts`), never a material a tile;
   that sets of one layout still share one build and one pipeline.
   Count vertex buffers and inter-stage variables of every variant
   ([plan 094](./094-rewrite-fixed-pipeline-set.md) turns the count
   into a test).
3. **Lines three ways, on the yards' tile**: today's runtime builders;
   the spike's triangles (port `rail-mesh.ts` and `bake-lines.ts` from
   its branch, do not rebase the branch); a segment table (two ends,
   the level at each from `lineLevelsAt`, a profile id) drawn as an
   instanced profile. For each: bytes gz, scene-thread milliseconds,
   GPU bytes, and the street rail's height error against the road.

**Verify**: `bun run verify` → exit 0; plates of 087's views that show
trees and rails → within tolerance for arm 2, recorded for the three
arms of 3; the ledger holds the baseline and both spikes. Write the
chosen record and the chosen home of the rails into this file's
*Findings*.

### Phase 1 — the container and the trees

1. `lib/city/dressing-pack.ts` (no THREE, no DOM, as `point-pack.ts`):
   **one table of sections** — name, record fields, formats — from which
   the packer, the reader and the vertex layout are all derived, so the
   file's layout cannot differ from the GPU's. A file is a magic, a
   directory (section, stride, count, offset, the chunks' ranges and
   boxes) and the sections, each 4-byte aligned so a typed-array view
   needs no copy. One file a fine level (`dressing`), one a coarse
   level; every tile has both, with empty sections where it has nothing
   (`tile-data.test.ts`). It takes rows in `ARTIFACTS` (`built: true`)
   and in `scripts/bake-entries.ts`.
2. `scripts/dressing-sources.ts`: **one reader a kind**, each through
   `parseBakeFile` and a schema module `lib/city/<kind>-file.ts`
   (ADR 0059; this ends the excuse AGENTS.md grants the crown and canopy
   layers for the kinds it touches). Every baker below reads through
   it and nothing else opens those files — plan 092 then changes the
   format here once (086, joint 7).
3. The build places the trees as `scripts/coarse-crowns.ts` does today
   (`tree-placement.ts`, `tree-inventory.ts`, the register's veto, the
   monuments' veto `offMonuments`, the orchards), on the fine ground,
   sorted by 250 m chunk, with what the ground says where each stands
   baked into its record (height, the trunk's drop, the foot's slope —
   `tree-foot.ts` computes them at runtime today) and its NDVI.
4. The viewer uploads: a chunk's sets are views over the file's bytes;
   `tileVegetationSteps`, the runtime placement and `loadNdviSampler`
   in the dressing go; `vegetation-lod.ts`, the season and the sway
   stay as they are. `canopy`, `canopyx`, `trees` and the coarse
   `crowns` stop being published; `vegrows` and `cultivated` stay until
   Phase 3.
5. The inquiry: a tree's cylinders come from its record, built when a
   ray first reaches the tile; `treeFacts` stays, its row the record's
   source index.

**Verify**: `bun test lib/city/dressing-pack.test.ts` (round trip; every
stride a multiple of 4; the layout derived from the table) → pass;
`bun run verify`, `bun run test:e2e` → pass, the scene census still
counts the vegetation; plates of the tree views → within tolerance;
ledger: a fine level's bytes not larger, its requests 2 fewer (three
files leave, one arrives), the trees' scene-thread time near zero, the
vegetation's GPU bytes smaller.

### Phase 2 — everything that stands

Lamps, furniture, sport fixtures, monuments' markers, masts, piles,
posts, stop signs. The joins move into the build: Mapillary's lamps and
bins into their tables (`mapillaryParts`), seam ownership (`ownsPoint`),
which lamp stands by a track (`lampsBy`) or over water. The models
become one set for the site, shared across tiles and detached before a
tile's geometry is disposed (`markSceneShared`; the rule is in the
`city-walker` skill, "Tiles"). The lamp pool and the facades' street
light read heads from the table.

**Verify**: as Phase 1, for the night and furniture views; `lamps`,
`furniture`, `mly`, `monuments` no longer published.

### Phase 3 — lines

As Phase 0 decided. Hedges and vine rows as segments in any case; rails
and wires as segments or as nodes. A line's level comes from the build
(`lineLevelsAt`); a part on the ground reports `joins` and is listed in
`JOIN_PARTS` with a budget at its measured state.

**Verify**: `bun test scripts/ground-joins.test.ts` → pass with the new
parts; plates of the tram, rail and vineyard views; ledger as before.

### Phase 4 — areas and solids

Ballast, platforms, tram beds, the riverside's structures (the spike's
builders), monument basins: nodes in the fine glTF, quantised and
meshopt-compressed like the walls. Bridges last, on both levels, their
inquiry through `ask-solids.ts`' `Slab`. Per kind: if the level's bytes
grow, the kind stays at runtime and this file says so.

**Verify**: as Phase 3; no kind but `traffic` is left in `buildDressing`.

### Phase 5 — what is deleted, and the records

`buildDressing` becomes a fetch of one file and its upload; the slices
go (`inSlices`, `setSliceBudget`, `REST_SLICE_MS` and their callers in
`create-app.ts`; `finished` stays if a test needs it), with
`pointFeatures`, the viewer's GeoJSON guards for the kinds that left and
the idle-time ask build. One `ask` file a tile carries what a card says
of the things in the tables (ADR 0042, point 1). Measure whether a fine
level still needs its ground prepared before it shows now that nothing
stands things on it at runtime; if only walking and rays read it, make
it lazy like the BVH — or note the figure and leave it.

Docs (`docs-upkeep` skill): rewrite ADR 0024 (what a tile brings, the
side files, the two phases), ADR 0030 (decision 3 and 5: tables beside
nodes), ADR 0041 (who places a line), ADR 0042 (the inquiry's files),
ADR 0047 (bytes an instance), and write one new ADR — a tile's dressing
is tables the GPU expands — with the next free number
(`docs/adr/README.md`, "Numbering"); `docs/rendering.md` (scene graph,
frame budget, boot sequence), `docs/data-pipeline.md` (the contracts,
"Measuring what the browser downloads"), `docs/transformations.md`,
`docs/data-flow.md`, the guide's data journey in both languages,
`AGENTS.md`, the `city-walker` and `new-scene-layer` skills. Condense
plan 074 part A into `completed.md`.

**Verify**: `grep -rn "inSlices\|setSliceBudget" app lib` → no match;
`grep -c "dressing: true" lib/city/tile.ts` → at most 2; `bun run
verify`, `bun run build`, `bun run test:e2e` → pass; the ledger's final
row against Phase 0's baseline.

## Test plan

- `lib/city/dressing-pack.test.ts`: round trip of every section; the
  vertex layout equals the table; an unknown section is refused.
  Pattern: `lib/city/point-pack.test.ts`.
- A placement test a family: the build's records against today's
  runtime builder on the committed spawn tile (same count, positions
  within the quantisation step) — written **before** the builder moves,
  kept afterwards against a committed digest.
- **The look stays out of the bake**: a test over the import graph
  (`scripts/bake-sources.ts`) that the `dressing` entry reaches none of
  the palette, season, style or look modules (`lib/city/landcover.ts`'s
  colours, `tree-season.ts`, `render-style.ts`, `look-controls.ts`), so
  a colour change re-bakes nothing (086, joint 3).
- `scripts/ground-joins.test.ts`, `tile-data.test.ts`,
  `bake-entries.test.ts`, `features.test.ts`, `bake-files.test.ts` for
  each new schema.
- e2e: the per-layer census keeps every layer; a question on a tree, a
  lamp and a bench still opens its card.

## Done criteria

- [ ] `buildDressing` fetches one file a level; no GeoJSON is parsed in
      the scene (`grep -rn "fetchFeatures" app/_components` → only the
      data layers' own)
- [ ] `lib/city/build-steps.ts`' slicing is gone and no worker was added
- [ ] Ledger, against Phase 0: a fine level's wire bytes ≤ baseline on
      every measured tile; requests a fine level down by at least 12;
      `dressing:build` scene-thread time down by at least 80 %; a
      phone's tile bytes ≤ baseline
- [ ] Plan 087's plates within tolerance on a real GPU for every view
      that shows a moved layer
- [ ] `bun run verify`, `bun run build`, `bun run test:e2e` exit 0
- [ ] The ADRs and docs of Phase 5 are current; the row in
      `docs/plans/README.md` says what was built and what stayed

## STOP conditions

- Plan 087's ledger or plates do not exist yet: stop before Phase 1.
- Phase 0: the record cannot be drawn on public API without a material
  or a build a tile, or a variant needs a ninth vertex buffer or a
  seventeenth inter-stage variable. Report the layout that failed.
- Any phase: a fine level's wire bytes grow on a measured tile, or a
  phone's bytes grow (ADR 0047). Leave that kind where it was.
- A ground-join budget would have to rise.
- A plate differs beyond 087's tolerance and the cause is not found in
  one attempt: report with both plates and the snapshot JSON.
- A kind's place depends on something only the page knows (a setting, a
  live source): it belongs to the runtime row of the table.
- The dressing's compile, once it is uploads only, still holds a
  tile-renderer parse slot on a real GPU (the spike's open question):
  keep it a late part and report the timing.

## Maintenance notes

- A new kind takes a section in `dressing-pack.ts`, a reader in
  `dressing-sources.ts` and a row in the table above; it never adds a
  fetch to the scene.
- A record field is a fact about the place, never a colour. Review any
  import a baker gains.
- The dressing's cache key covers the fine ground of every tile it
  stands things on (as the coarse crowns' does), so a DGM change
  re-bakes its neighbours' dressings.
- `Instances`' matrix mode stays for what moves (tram cars, traffic).
- Deferred: the BVH and the ground's index stay runtime work in their
  workers — large, derived, and needed only near the walker.

## What the series changes about this plan

Built alone, this plan would have taken PR #156 as it is — triangles in
the glTF, ten per cent more bytes — because its only aim would be the
thread. The series counts bytes as well, hence tables first. Alone it
would also have kept a worker for the builders as the cheap interim
(README, *Direction* 8); with everything placed by the build there is
nothing left to hand to one. The one-reader rule exists for
[092](./092-rewrite-bake-store.md), the one file a level for
[093](./093-rewrite-streaming-quadtree.md) (sixteen times the tiles must
not be sixteen times seventeen requests), the fixed layouts for
[094](./094-rewrite-fixed-pipeline-set.md), and the edge the builders
leave behind is where
[095](./095-rewrite-packages-and-frames.md) cuts the viewer's package.
Until [088](./088-rewrite-tiles-as-a-data-product.md) serves the files
compressed, the container is pre-gzipped like the packs it replaces.

## Findings

### Phase 0 (2026-11-16) — the baseline, the stand record, the rails' home

Every figure is in `qa/ledger.json`: `dressing` (gated) and
`dressingRecorded` (the browser's, München's and the spikes', never
compared). The tools: `e2e/dressing-ledger.spec.ts`,
`scripts/eval/stand-record-probe.ts`, `stand-record-bytes.ts`,
`lines-three-ways.ts`. The yards' tile is `33410_5656_2_sn` (Bahnhof
Neustadt; the largest tram file of the site and its third-largest rail
file).

**Baseline — the wire** (gzip as the ledger's rule says; a fine level's
dressing files and the sports table):

| Tile | Fine: bytes | requests | the heaviest kinds | Coarse: bytes | requests |
|---|---|---|---|---|---|
| spawn `33412_5656` | 249 125 | 18 | trees 84 150, canopyx 43 036, canopy 40 495, furniture 25 898, tram 16 963 | 84 944 | 3 |
| forest `33416_5658` | 496 855 | 18 | canopy 468 887, canopyx 22 869 | 398 235 | 3 |
| yards `33410_5656` | 275 994 | 18 | canopy 56 529, trees 49 947, tram 35 801, furniture 29 202, canopyx 25 106, monuments 14 864, rail 12 840 | 78 626 | 3 |
| München `32690_5334` | 183 505 | 17 | canopyx 43 276, furniture 39 243, tram 27 448, canopy 22 034 | 51 303 | 2 |

The dressing is 3–7 % of a fine level's bytes (the spawn level is
6.94 MB) and 18 of its 29 requests. **So this plan's wire win is
requests, not bytes**: the byte gate of the Done criteria ("≤ baseline")
is a ceiling to hold, and there is little under it to gain.

**Baseline — the scene's thread and the tile cache** (recorded only:
headless Chromium, WebGPU on SwiftShader, a four-core cloud container,
`?scene=lite&block=1`; the milliseconds are the time inside each
builder's own slices, the pauses left out; the bytes are
`dressingPart`'s, what `calculateBytesUsed` adds for the dressing):

| Tile | Builders, ms | the heaviest | Cache bytes | the heaviest |
|---|---|---|---|---|
| spawn | 646 | trees 231, tram 108, rail 95, asks 78, furniture 61 | 12.8 MB | vegetation 5.5, tram 3.2, furniture 1.8 |
| forest | 752 | trees 541, asks 207 | 12.3 MB | vegetation 12.1 |
| yards | 1 348 | rail 840, tram 185, trees 123 | 22.0 MB | rail 7.2, tram 6.3, vegetation 4.9 |
| München | 889 | rail 315, trees 149, tram 148, monuments 97 | 16.7 MB | monuments 4.6, tram 4.6, vegetation 3.2 |

The phone profile (an emulated phone's viewport and touch, no CPU
throttle) reads the same within the noise (spawn 913 ms, the others
±5 %) and the same bytes. A second run moves a builder by tens of per
cent: the table says which builder is heavy on which tile, nothing more.
Not measured: **the longest task of a flight** — the scene draws in a
worker, where the browser reports no long tasks, and with `?thread=main`
on a software renderer the long task is the frame itself. It wants a
phone (plan 019's two).

**The stand record — chosen, and three's public API takes it.**
`lib/city/stand-record.ts`: ten unsigned 16-bit words, twenty bytes —
`x, y, z` in steps of 1/32 m from the table's origin (a tile's box:
2 048 m), the turn; three scales × 1/1024 and a spare; two words holding
the four bytes (`code`, `ndvi`, `genus`, `jitter`). It differs from the
plan's target in three points, each forced by what was found:

- **All words, no byte fields.** three (r187,
  `WebGPUAttributeUtils`) keeps one typed array per interleaved buffer
  and takes every view's vertex format from it, so 16-bit and 8-bit
  fields share a buffer only as 16-bit words; a shader takes a byte out
  of its word (`standByte`, exact: the words arrive as integers). Two
  typed-array views of one `ArrayBuffer` work but are two GPU buffers.
- **Not normalized, interleaved.** What reaches TSL as what (the probe
  drew each and read the value back):

  | Attribute | WGSL type | Uploaded as |
  |---|---|---|
  | interleaved `Uint16Array`, not normalized, 4 an item | `vec4<u32>` (`uint16x4`) | as it is |
  | … 2 an item | `vec2<u32>` | as it is |
  | interleaved `Uint16Array` or `Uint8Array`, normalized, 4 | `vec4<f32>` | as it is |
  | interleaved `Uint8Array`, not normalized, 4 | `vec4<u32>` | as it is |
  | plain `InstancedBufferAttribute`, `Uint16Array`/`Uint8Array`, **not** normalized | `vec4<u32>` | **widened to `Uint32Array`**: 2× / 4× the bytes |
  | plain, normalized, 4 or 3 an item | `vec4<f32>` / `vec3<f32>` | as it is (3 an item padded to 4) |
  | any 8- or 16-bit array, **1 an item** | — | no vertex format: the pipeline is not made |

- **The origin is the drawn object's, by a uniform — not the set's
  matrix.** The crown shaders seed a tree's form, sway and winter
  stipple from its instance's place in the tile's frame
  (`instanceColumn(3)`); a set matrix would move that frame and reshape
  every crown. One uniform node for all materials
  (`instancing.ts` `tableOrigin`, TSL's `onObjectUpdate`, as
  `material-slots.ts` does) reads `object.userData.standOrigin`, and
  lands in the object's bind group. No material and no build a tile:
  a second set of a material and layout built **0** node builders; a
  tile's 102 crown sets built 3 (the lobed crown, the cone and the
  pine are three geometries).

Counted on the scene's crown material (PR #314's method,
`renderer.debug.getShaderAsync`): from records **4 vertex buffers**
(position, normal, the records, `iColor`), 5 attributes, **3 inter-stage
variables** — from matrices 4, 7 and 3. No STOP.

What it buys and costs, on the coarse crowns (`?stands=record`; the
default path is untouched):

- GPU: a crown's placement 64 → 20 bytes (spawn 321 → 100 kB, the
  forest 1.78 → 0.55 MB); nothing is written on the scene's thread, each
  set is a view of the file's bytes.
- Wire: the same file size (spawn 73.1 against 75.9 kB today, yards
  65.2 / 65.6, München 49.8 / 51.1; the forest 407.6 / 397.5, +2.6 % —
  the baked height is information the old file lacks).
- Picture: a record stands within 2.4 cm and 0.16 % of scale of today's
  matrix. The probe's close view (1 m a pixel) differs in 291 of 8 412
  lit pixels at 24/255, crown edges; a `SHOTS_SMALL` plate of
  `qa/views/coarse-300.json` in 147 of 400 000.

Open for Phase 1: the height in the spike is read at runtime and packed
in the viewer (the build has the fine ground only: baking the coarse
level's needs its height function in `scripts/coarse-crowns.ts`); the
tint is still three floats painted on the CPU (the season's); nothing
has been looked at on a real GPU.

**The rails' home: lines — a table of segments, simplified by the
build.** The three arms on the yards' tile (337 runs, 47.7 km of track,
19 721 segments at today's 2 m / 4 m samples; a build that drops every
sample its neighbours stand in for within 1 cm across and 5 mm in
height keeps 7 676). Milliseconds under Bun on the container, not in a
browser:

| | wire, gz | scene thread | GPU bytes | street rail over the road, less its 2 cm (5th / 50th / 95th pct), buried |
|---|---|---|---|---|
| today: runtime builders | 34.7 kB (the rail file 12.7, the tram file's tracks 22.0) | ≈ 280–340 ms of the builders' 1 280 | 7.08 MB | +0.9 / +2.8 / +4.4 cm, 0.14 % |
| PR #156's triangles, every sample | 364.4 kB | 8 ms (parse) | 6.09 MB | +0.5 / +2.8 / +5.2 cm, 0.17 % |
| … simplified | 288.1 kB | 4 ms | 2.41 MB | +0.5 / +2.8 / +5.3 cm, 0.15 % |
| segment table, every sample | 164.2 kB | 4 ms | 0.40 MB | +0.9 / +2.8 / +4.4 cm, 0.14 % |
| **… simplified** | **72.5 kB** | **2–3 ms** | **0.15 MB** | +0.9 / +2.8 / +4.4 cm, 0.14 % |

- The table (`lib/city/rail-table.ts`, drawn by
  `app/_components/rail-segments.ts` behind `?rails=table`): twenty
  bytes a segment of track — both ends, the track's bearing at each, its
  offset across the line — expanded into the pair of rails by an
  instanced profile that is the builder's own two ribbons over a unit
  length. Cut into 250 m chunks with their own origin, sixteen bits step
  **4 mm in height** (8 mm in plan), so it stands where today's rails
  stand; the baked nodes' one step over a tile is 3.05 cm, which widens
  the spread and is what PR #156 left open. 3 vertex buffers, 5
  attributes, 1 inter-stage variable; one build a look.
- In the browser (the same container, `?rails=table`, every sample kept
  and the table still made at runtime from the builders' runs): the
  yards' dressing weighs 15.6 MB in the tile cache where it weighed
  22.0 (rail 7.2 → 5.6, tram 6.3 → 1.5), and the tram's builder takes
  47 ms where it took 185, the table's sets 23 ms.
- **Against it, and it binds Phase 3:** the table is 38 kB *more* on the
  wire than the GeoJSON it replaces on this tile (a line's samples carry
  the ground's height; the GeoJSON carries only the plan and the
  browser reads the ground). The level is 7.1 MB and its dressing
  276 kB, but the STOP on a level's bytes counts every byte: Phase 3
  must win them back inside the level (written as points, a run's
  neighbours being a segment, it is ≈ 55 kB — which needs a second
  view of the buffer or a storage buffer, not built), or the maintainer
  rules the 38 kB slight (ruling 3) for 7 MB less on the GPU and the
  rails off the scene's thread.
- Not carried by the spike's material: the press under a planner's
  design (`lineUnderDesign`). The wires, hedges and vine rows were not
  tried; the wires already expand on the GPU and take the same table.
  A chunk is a draw call: 86 sets on the yards' tile where today's
  builders make 3 meshes.
- Seen beside it: today's street rails stand a median 4.8 cm over the
  drawn ground, not the 2 cm the builder adds — the line's baked profile
  (`lz`, on the DGM) against the fine level's triangles.

PR #156's own builders (`rail-mesh.ts` …) were not copied: today's
builders run under Bun as they are (`mesh-kit.ts`), so the measurement
feeds their ribbons through the spike's writer (`weld`, 16-bit
positions, meshopt — `scripts/tile-glb.ts`), which is what
`bake-lines.ts` did.
