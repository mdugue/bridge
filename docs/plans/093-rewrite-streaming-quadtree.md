# Plan 093 [rewrite]: The stream's tile is smaller than the bake's — a quadtree whose levels replace the raster twins, built only if a phone still asks for it

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and `AGENTS.md`
> first. This plan is **gated**: Phase 0 reads numbers and Phase 1 is a
> spike; both can end the plan as REJECTED, and that is a good outcome.
> Build nothing past a phase whose **Verify** did not hold. Each phase is
> one PR. On a STOP condition, stop and report with the numbers. When a
> phase lands, update this plan's row in `docs/plans/README.md` (keep the
> `[rewrite]` mark) and write the phase's figures into the ledger of
> [087](./087-rewrite-measuring-stick.md).
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- lib/city/tileset.ts lib/city/tile.ts lib/city/site.ts lib/city/ground-reach.ts app/_components/tile-stream.ts app/_components/scene-profile.ts app/_components/city-layer.ts scripts/prepare`
> Plans 090, 091 and 092 change most of these on purpose before this plan
> starts: read "Current state" as the map of 2026-11-16, find every
> symbol by name, and take the numbers from 087's ledger, not from here.

## Status

- **Priority**: P3 until Phase 0 opens the gate; then P1 for phones
- **Effort**: XL (Phase 0: S, Phase 1: M, the rest L–XL)
- **Risk**: HIGH — the series' largest. It touches the tree, the cache,
  the budgets, the shadows and every per-tile owner at once
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (ledger,
  plates), [088](./088-rewrite-tiles-as-a-data-product.md) (the tiles are
  published, so a new cut is a new publish, not a 600 MB diff),
  [090](./090-rewrite-dressing-gpu-ready.md) (one container a tile),
  [091](./091-rewrite-rasters.md) (one raster stack a tile),
  [092](./092-rewrite-bake-store.md) (the cut is a query),
  [094](./094-rewrite-fixed-pipeline-set.md) (the register: an arriving
  tile builds no pipeline)
- **Category**: rewrite — faster on the device (a phone's memory, the
  time until a street is walkable) and fewer bytes a visit; it takes the
  raster twins away (less complexity) and adds a tree (more)
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md),
  joint 9
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: REJECTED (2026-11-24, the series closed): its row in
  [README.md](./README.md) says what holds. As it stood before:
  TODO — gated

## Why this matters

The 2 km tile is four things at once: the Land's download cell, the
bake's unit, the stream's unit and the memory's unit. The first two are
right. The last two cost a phone:

- A phone holds about two fine levels. `scene-profile.ts` bounds the
  largest tile at 128 MB on a phone (`LARGEST_TILE_BYTES`) and the cache
  at 150–285 MiB (`TILE_CACHE_BYTES`), and `max − min` must exceed the
  largest tile or the cache locks (it did: "a phone that flew to the
  Alaunpark sat at 181 MB with a 62 MB tile first in line to go").
- Stepping into a street brings four square kilometres: the near
  buildings of the whole tile (up to 4.3 MB on the wire, 0.63 M
  triangles, `docs/rendering.md` 2026-11-11) although they switch in
  only within ≈ 260 m, and the fine ground of the whole tile (1.3–3.6 MB)
  with its rasters.
- A tile has one resolution, so the levels were made by hand: a phone's
  2048² class raster, the coarse level's 1024², the "far twins"
  (`FAR_RASTER_PX`), the `_low` files, and `lib/city/ground-reach.ts`,
  which swaps a fine level's rasters by the metres a pixel spans.

A quadtree under each bake tile — leaves of 1 km or 500 m, merged
parents for the distance — makes the stream's and the memory's unit
small while the bake keeps its 2 km. Whether that still pays after 090
and 091 have made a tile lighter is a question of numbers, which is why
this plan starts with them.

## What was decided before, and what has changed

- **Plan 018** (a tile manager of our own, 1 km near cells) was
  superseded by ADR 0024: the library traverses, we write the tree.
  *Unchanged*: this plan keeps 3DTilesRendererJS and changes only the
  tree the build writes and what a tile is in the viewer.
- **Plan 076** rejected "implicit tiling (15 tiles)" for now.
  *Unchanged*: Dresden has fifteen tiles, and implicit tiling is still
  not what this plan needs (below). *Changed*: with 090 a tile is one
  container and not seventeen side files, so sixteen leaves are not
  sixteen times the requests; with 091 a raster has levels; with 092 a
  tile's cut is a query over site-wide tables and not sixteen times the
  seam code; and the phone budgets have since been derived to the byte
  (ADR 0047), so what a smaller unit buys can be counted.
- **Implicit tiling in the installed library** (`3d-tiles-renderer`
  0.5.4, read on 2026-11-16): `ImplicitTilingPlugin` exists
  (`src/core/plugins/ImplicitTilingPlugin.js`, `SUBTREELoader.js`). It
  keeps one content a tile ("Multiple contents not handled, keep the
  first content found"), gives every child the root's box divided
  evenly — so every child spans the site's whole height range —, halves
  the error a level, and builds content addresses from a template
  (`{level}/{x}/{y}`). Our files are named by content hash through the
  manifest, and a tile's side files are named in its `extras`
  (`tileNode` in `lib/city/tileset.ts`), which an implicit tile does not
  have. So: **an explicit tree**. If one tileset JSON grows too large
  for a big site, the library loads a `.json` content with a `root` as
  an external tileset (`TilesRendererBase.js`, `isExternalTileset`): one
  tileset a bake tile. Phase 1 measures the JSON; nothing here asserts
  it.

## Current state (2026-11-16, before 090–092)

- `lib/city/site.ts` — `export const TILE_KM = 2;` "The rasters (4096²
  classes, 1024² terrain) and the phone budgets are sized for it".
  `tileIdOf` names a cell `<zone><e km>_<n km>_2<suffix>`.
- `lib/city/tileset.ts` — the tree, `buildTileset` over `tileNode`:

  ```
  tile           no content                     refine ADD
    ├ buildings far  content: the LoD2, simplified  refine REPLACE
    │   └ buildings    content: the LoD2 as baked
    └ terrain L1 content: 512² terrain         refine REPLACE
        └ terrain L0 content: TIN terrain + the tile's dressing
  ```

  `TILE_ERROR = 100_000`, `FAR_CITY_ERROR = 4` (near buildings within
  ≈ 260 m), `COARSE_TERRAIN_ERROR = 40` (fine ground within ≈ 2.6 km at
  1080 px, 2.1 km on an iPhone; the error target is 16 px). All four
  contents share the tile's box. `ownsPoint` (west and south edges in)
  says which tile a point on a seam belongs to. `tileset-spawn.json`
  holds the spawn tile alone for the `lite` profile.
- `app/_components/tile-stream.ts` — `createTileStream` (queues from
  `orderStreaming`; `STREAM_DOWNLOADS = { boot: 3, desktop: 6, mobile: 4 }`,
  two parses at once on a phone, five on a desktop; the cache's
  `minBytesSize`/`maxBytesSize`), the dressing plugin
  (`processTileModel`, `disposeTile`, `calculateBytesUsed`: a tile weighs
  its rasters, its city table and texture and its late parts beside the
  glTF). What streams is decided by the twin camera (ADR 0024).
- `app/_components/scene-profile.ts` — `LARGEST_TILE_BYTES` (desktop
  260 MB, mobile 128 MB), `TILE_CACHE_BYTES` per tier and safety level,
  derived for a phone from the memory governor's soft line.
- `lib/city/tile.ts` — `MOBILE_RASTER_PX = 2048`,
  `COARSE_RASTER_PX = 1024`, `FAR_RASTER_PX = 1024`; the artifact table
  `tileArtifacts`. `lib/city/ground-reach.ts` — `metresPerPixel` and the
  swap between a fine level's rasters and their twins.
- `app/_components/city-layer.ts` — per building tile: `dressCity`, one
  float texture of the object table (`objectTexture`), demolish by
  object index with its group (`replayDemolitions`), a BVH built in the
  worker when a ray first needs it or ahead within 400 m
  (`ensureCityBvh`, `nearestWithoutBvh`).
- `lib/city/shadow-rings.ts` — four rings of half-size 80, 240, 720 and
  2 160 m; `changedTiles` decides which rings a landed or left tile
  redraws. `invalidateShadows(` has ten call sites in `app/_components`.
- `scripts/prepare/` — the build's steps. The fine ground is shaped for
  the whole site before anything stands on it (`ground.ts`), walls,
  kerbs, stairs and fences stand on the neighbours' ground too
  (`terrain.ts`), the line levels are solved along the whole line
  (`lines.ts`). `pipeline/bake/citygml.py` gives a building to the tile
  holding its envelope's centre.
- The fine terrain carries a 30 m skirt a tile (ADR 0030).
- The viewer already counts what this plan measures:
  `renderer.info.render.drawCalls` and `triangles`, the cache's `bytes`,
  `items` and each tile's size (`GpuDebug.tileCache` in `create-app.ts`,
  read through `__poc`), and the stream's marks by category
  (`stream-timing.ts`: `tile:compile`, `tile:bvh`, `dressing:build`, …,
  listed with `?trace=1`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install` | exit 0 |
| Format, then gate | `bun run fix && bun run verify` | exit 0 |
| Build every ready site | `bun run build` | exit 0 |
| One site's tileset | `bun scripts/prepare-data.ts dresden` | exit 0 |
| End to end | `bun run test:e2e` | all pass |
| Plates on a real GPU | `bun run shots` | plates written; compared as 087 says |
| Where a site stands | `bun run site dresden` | every tile ready |

## Scope

**In scope**: `lib/city/tileset.ts`, `lib/city/tile.ts`,
`lib/city/site.ts` (a stream constant beside `TILE_KM`, never a change
of `TILE_KM`), `lib/city/ground-reach.ts`, `scripts/prepare/*` and
`scripts/bake-entries.ts` (the cut as build steps),
`app/_components/tile-stream.ts`, `scene-profile.ts`, `tile-memory.ts`,
`city-layer.ts`, `terrain-layer.ts`, `demolitions.ts`, their tests, the
e2e specs, `qa/views/`, the docs and ADRs named in the phases.

**Out of scope**:

- `pipeline/` and the bake's 2 km unit. A provider's download grid, the
  1 m rasters and the bakes' margins stay as they are.
- A tile manager of our own, or another streaming library (ADR 0024).
- Implicit tiling, unless Phase 1's JSON figure asks for it and the
  maintainer says so.
- The look. No constant of a material, no palette, no shadow recipe.
- `components/ui/` (vendored).

## The gate (Phase 0) — which numbers, and what they must say

Read from 087's ledger after 090 and 091 have landed, for Dresden and
for the largest built site, on the phone profile and on one real phone
of each kind (plan 019's section I):

| # | Figure | How it is read | Proposed line (the maintainer sets it) |
|---|---|---|---|
| G1 | The largest fine level as a phone's cache weighs it | the largest entry of `GpuDebug.tileCache.sizes` over the reference flight | go on if it is still above **64 MiB** (half of today's 128 MB bound) |
| G2 | Fine levels a phone holds at once at safety level 0 | cache `max` ÷ G1, rounded down | go on if it is **below four** (the tile under the walker and the three it can reach next) |
| G3 | Walking into a street: bytes and time from a tile coming into the near buildings' reach to its buildings and fine ground drawn | the stream's marks summed for that tile, the bytes from the ledger's request log, on the 10 Mbit profile | go on if it is still above **4 MB** or **3 s** |
| G4 | Phones that lost their GPU or met a memory emergency while tiles landed | the error tracker's last thirty days after 091 | go on if there is **any** |

If none of G1–G4 holds, close this plan as REJECTED with the four
figures (the row, `completed.md`, the README's *Rejected* list) and
leave `TILE_KM`'s comment as it is. If one holds, Phase 1.

**Verify**: the table above, filled in, stands in this file's Findings;
the maintainer's lines and word (go, or rejected) stand in the README
row.

## Phases

### Phase 1 — Spike: one tile cut into four and into sixteen (never merged)

On a branch of its own. Take Dresden's densest tile — the one with the
largest near-buildings file in `public/data/dresden/manifest.json`; name
it in the Findings — and publish it three ways beside each other: as
today, as four 1 km leaves, as sixteen 500 m leaves; the far buildings
and the coarse ground stay **one merged parent** a bake tile in all
three. Cut from the baked contents (the meshes after the bake, by the
owner of each object and of each ground triangle), not by baking
sixteen times. The viewer picks the variant by a query knob on the spike
branch only, as `city-walk-client.tsx` picks `tileset-spawn.json` for
`lite`.

Write down, for 1, 4 and 16, on the reference GPU and the phone profile:

1. **Bytes**: the wire bytes of everything the tile publishes, and of
   the reference walk. Small files compress worse, skirts and tables
   repeat.
2. **Requests** a leaf brings (with 090's container and 091's stack).
3. **Draw calls and frame time** in the reference views
   (`renderer.info.render.drawCalls`; 087's plates name the views).
4. **Arrivals**: tiles landing a second on the reference flight, and
   what each costs: `tile:compile` (with 094's register an arrival
   builds no pipeline — count the builds), the parse, the BVH.
5. **Shadow redraws** a minute on the reference walk, by ring (the e2e
   already counts them).
6. **The cache**: G1 and G2 again, and the bytes a phone holds standing
   still in the Altstadt.
7. **Objects on a cut**: how many buildings' boxes cross a leaf's edge,
   and how far the leaves' boxes must grow to contain their content (a
   tile's content must lie in its bounding volume, and a parent's volume
   must contain its children's).
8. **Per-leaf owners**: the object texture and its bind group a leaf (or
   one a bake tile shared by its leaves), the BVH a leaf, the height
   index of a leaf's ground.
9. **The ground's seams**: triangles spent on skirts, and whether a
   fine leaf beside a coarse parent shows a crack (plan 019, section D;
   a plate of `seam-eye` and `seam-fly`).
10. **The tileset JSON**: its gzip bytes for Dresden, and extrapolated
    to a site of two hundred bake tiles.
11. **G3** again: bytes and seconds to a walkable street.

**Kill criteria** — any one closes the plan as REJECTED with the table:

- the cut tile publishes more than **10 %** more bytes than the uncut
  one, or the reference walk fetches more;
- draw calls in the reference views rise by more than **25 %**, or the
  reference GPU's frame time by more than **10 %**;
- an arriving leaf builds a pipeline in its frame, or shadow redraws a
  minute more than **double**;
- the largest leaf weighs more than **a third** of the uncut fine level
  on a phone (the city is not even: one leaf may hold most of it);
- G3 improves by less than **30 %**.

Otherwise the Findings name the leaf size (1 km or 500 m) and whether
the ground takes a middle level, and the maintainer says go.

**Verify**: the table for 1, 4 and 16 in the Findings; the three plates
of each reference view attached to the spike PR; the PR closed unmerged.

### Phase 2 — The tree in the build

`lib/city/tileset.ts` writes, per bake tile, the parent (far buildings,
coarse ground: today's contents) and under it the leaves of the size
Phase 1 chose, each with its box grown to its content and its own
errors, so that the distances stay what they are (`FAR_CITY_ERROR`,
`COARSE_TERRAIN_ERROR`: a constant that moves is a look change and
needs plates). The cut is a publish step in `scripts/prepare/` over the
baked 2 km contents with its own row in `scripts/bake-entries.ts`; the
bakes' keys do not change, and an object's leaf is 092's query (its
envelope's centre, `ownsPoint`'s edge rule). A leaf's id is its bake
tile's id and its place in the tree; the glTF extras key stays `tileId`.
The viewer still loads the uncut tree (both are published, as
`tileset-spawn.json` is beside `tileset.json`).

**Verify**: `bun run verify` → exit 0, with new tests in
`lib/city/tileset.test.ts`: every leaf's box inside its parent's; every
object in exactly one leaf; the leaves' triangles sum to the uncut
tile's; every address a hashed name from the manifest.
`bun scripts/prepare-data.ts dresden` twice → the second run bakes
nothing. Ledger: bytes a tile, both trees.

### Phase 3 — The viewer by leaf

`tile-stream.ts`: a leaf is dressed, weighed (`calculateBytesUsed`) and
freed as a tile is today — everything a leaf brings is built in
`processTileModel` and freed in `disposeTile`, and reaches the cache's
weighing. `city-layer.ts`: the object table, demolish (a building's
parts lie in its root's leaf; a demolish made on the parent's far
buildings holds on the leaf that replaces it, as it does across the two
levels today) and the BVH per leaf. The ground's height, the collider
and the picks read across leaves through `nearestCityHit`,
`cityObjectsAlong` and the ground as today, and nothing reads a leaf's
CPU positions while `bvhBuilding` says so. A landed or left leaf calls
`invalidateShadows()` through `changedTiles` for the rings it touches,
not for all. `scene-profile.ts`: `LARGEST_TILE_BYTES` and
`TILE_CACHE_BYTES` derived again from what a leaf weighs; a phone's
memory must not grow (ADR 0047), so the saved bytes go to `min`, not to
`max`. The lite profile's tileset is the spawn bake tile's subtree. The
viewer switches to the quadtree; the uncut tree is no longer published.

**Verify**: `bun run verify` and `bun run test:e2e` → green, with the
scene census summed over leaves equal to the uncut tile's
(`__poc.stats.layerStats`), a demolish across a cut, a walk across a
leaf's seam. `bun run shots` → 087's compare passes on every reference
view, `seam-eye` and `seam-fly` among them. Ledger: G1–G3, draw calls,
shadow redraws a minute, a phone's held bytes standing still — none
worse than Phase 1 measured.

### Phase 4 — Levels in place of the twins

With 091's raster stack: a leaf's rasters at the native texel, its
parent's a level coarser. A phone reads one level coarser where it read
the 2048² file. `MOBILE_RASTER_PX`, `FAR_RASTER_PX`, the `_low` rows of
the artifact table, `scripts/downsample-raster.ts`'s twins and the swap
in `lib/city/ground-reach.ts` go; class rasters are still NEAREST and
decoded by `lib/city/png-raster.ts` or what 091 put in its place, never
by an image tool.

**Verify**: `grep -rn "FAR_RASTER_PX\|MOBILE_RASTER_PX" lib app scripts`
→ no matches; `bun run verify`, `bun run test:e2e` green; plates of the
ground's reference views (`street-crossings`, `pitches-200`,
`meadow-eye`) pass; ledger: raster bytes a phone holds, bytes a tile.

### Phase 5 — The records

Rewrite, in the present tense and without an "update" note: ADR 0024
(the tree and what a tile is), ADR 0047 (the budget's unit and its
table), ADR 0030 where the skirt or a middle ground level changed;
`docs/rendering.md` (the tier table, "What one site tile costs", the
scene graph diagram: `bun run docs:diagrams`), `docs/data-pipeline.md`
("The tree", the contracts), `docs/portability.md` ("every tile is
2 km" becomes "every bake tile"), `AGENTS.md` and the `city-walker`
skill ("Tiles"), plan 019's sections D and M, `qa/views/`.

**Verify**: `bun run verify` → exit 0 (`lib/docs/links.test.ts` reads
every relative link); `bun run docs:diagrams` leaves no diff after a
second run; `grep -rn "every tile is 2 km" docs AGENTS.md` returns
nothing.

## Test plan

- `lib/city/tileset.test.ts`: the tree's invariants (Phase 2), modelled
  on its tests of `buildTileset` today.
- `lib/city/tile-data.test.ts` and `scripts/ground-joins.test.ts` hold
  as they are: every tile carries the same files; nothing stands off
  the ground at a leaf's edge.
- `app/_components/tile-stream.test.ts`: a leaf weighs what it holds; a
  leaf that leaves frees it; the order of arrivals keeps the ground
  before the buildings (`stream-order.ts`).
- e2e (`e2e/city-walk.spec.ts`): the census by leaf, a demolish that
  survives the far-to-near switch across a cut, the phone profile's
  cache staying under `max` on the reference flight.
- Plates: every reference view through 087's compare; a PR that changes
  the picture carries snapshots (`pr-snapshots` skill).

## Done criteria

- [ ] Phase 0's table and the maintainer's word are in the Findings
- [ ] Either: the plan is REJECTED with its numbers in `completed.md`
      and the README's *Rejected* list — **or** all of the following
- [ ] `bun run verify`, `bun run build`, `bun run test:e2e` exit 0
- [ ] 087's plate compare passes on every reference view
- [ ] Ledger: G1 ≤ a third of its Phase 0 value; G3 improved by ≥ 30 %;
      bytes a site and draw calls within Phase 1's kill lines; a phone's
      held bytes not above Phase 0's
- [ ] `grep -rn "FAR_RASTER_PX\|MOBILE_RASTER_PX" lib app scripts`
      returns nothing
- [ ] ADRs 0024 and 0047 state the new unit; `docs/plans/README.md` row
      updated

## STOP conditions

- 090, 091, 092 or 094's register has not landed: do not start Phase 1.
- A kill criterion of Phase 1 holds: stop, write the table, close.
- A phone's memory grows in any phase (ADR 0047).
- A cut needs a bake step to run per leaf, or a change under
  `pipeline/`: the cut is no longer a publish step — report.
- A leaf's content cannot be kept inside a box without the boxes
  overlapping so far that the renderer loads neighbours for every view.
- The library needs a patch beyond `patches/3d-tiles-renderer@0.5.4.patch`
  or a private member (ADR 0027's rule holds for it too).
- A reference plate differs and the difference is not a seam this plan
  names: a look change is not this plan's.

## Maintenance notes

- `TILE_KM` stays the bake's. Anything sized "for a tile" must say
  which: the bake's or the stream's.
- A new per-tile owner (a table, a texture, a worker's copy) is per
  leaf: it is built and freed with the leaf and weighed in
  `calculateBytesUsed`, or it leaks sixteen times as fast.
- A new streaming need registers against the twin camera, as before.
- Reviewers: the object-in-exactly-one-leaf test, the budgets' new
  derivation in `scene-profile.ts`, and that no error constant moved
  without plates.
- Deferred: implicit tiling and external tilesets, until a site's JSON
  asks for them.

## What the series changes about this plan

Built alone, this plan would be the old plan 018 again with a library:
sixteen times the side-file requests, sixteen times the seams in every
bake, raster twins cut once more by hand, and a pipeline built for
every arrival. It would not pass its own kill criteria. Inside the
series the cut is a query (092), a leaf is one container and one stack
(090, 091), an arrival is an upload (094) — and 090 and 091 may have
made a 2 km tile light enough that the gate stays shut. That is why the
gate comes first and the series' table says "built only if".

## Findings

(Empty. Phase 0's table, Phase 1's table for 1, 4 and 16, and the
maintainer's lines go here, with dates and devices.)
