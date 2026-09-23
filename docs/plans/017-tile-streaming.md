# Plan 017: Stream tiles around the camera (tile manager, loader worker, 1 km near cells)

> **Executor instructions**: This is a multi-phase plan. Execute **one phase
> per PR**, in order. Each phase ends with a verification block, so run it and
> confirm the expected result before starting the next phase. Phases 0, 6 and
> 7 have maintainer gates. If a gate is unanswered, stop at that phase. If
> anything in "STOP conditions" occurs, stop and report; do not improvise.
> Update the status row for this plan in `docs/plans/README.md` after every
> phase, and record any deviations there.
>
> **Drift check (run first)**:
> `git diff --stat b63c034..HEAD -- app/_components/create-app.ts app/_components/city-walk-client.tsx app/_components/terrain-layer.ts app/_components/collision.ts lib/city/tile.ts lib/city/terrain-geometry.ts lib/city/heightfield.ts lib/city/city-mesh.ts scripts/prepare-data.ts next.config.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" section against the live code before proceeding. On a
> mismatch in the boot/loading path, treat it as a STOP condition.

## Status

- **Priority**: P2 (direction work, not a defect)
- **Effort**: L overall. Phase sizes are S–M each (see the phase headers).
- **Risk**: MED. The scene's invariants (shadow invalidation, abort/dispose,
  the lamp light pool) all assume a world that only grows. This plan makes
  it shrink as well.
- **Depends on**: nothing merged. Phase 1 *is* backlog item 12 (split
  `bootApp`) for the tile path.
- **Decision record**: [ADR 0022](../adr/0022-stream-tiles-around-the-camera.md)
  (proposed). It supersedes [ADR 0006](../adr/0006-tile-block-with-one-primary-and-one-artifact-map.md)
  once Phase 3 lands.
- **Category**: architecture / performance / data scale
- **Planned at**: commit `b63c034`, 2026-09-23
- **Status**: TODO. Phase 0 is waiting on the maintainer.

## Why this matters

The viewer loads a fixed 2×2 block of 2 km tiles (`TILE_BLOCK`,
`lib/city/tile.ts`), all at once, and never unloads anything. Adding more of
Dresden means more tiles, and "load everything at boot" does not scale
past a handful:

- **Wire:** ~2.2–2.7 MB per neighbour tile, ~3.9 MB for the primary
  (`docs/data-pipeline.md`, measured 2026-09-22). That part is cheap.
- **GPU memory:** this is the real limit. One 4096² RGBA splat is ~85 MB
  with mips, and a 2048² splat is ~21 MB. Every tile also carries terrain,
  water and mist geometry (the water/mist sheets span the whole terrain
  grid, see backlog item 6), a canopy cloud and a building mesh. Phones are
  already served 2048² for every tile to stay inside their budget.
- **Main thread:** every tile that lands costs a canopy build, a terrain BVH
  (~0.4–1.5 s) and a texture upload, all on the main thread.
- **Correctness:** collision and demolish only work on the primary tile. A
  player who walks 1 km east is on a tile they can walk *through* the
  buildings of.

Next.js/Bun is **not** a constraint here. The data is served as static,
content-hashed files (ADR 0007, `next.config.ts` `immutable` headers), so
there can be any number of them. The work is in the client and in the
bake.

### Why hand-written, not a library

The options were checked (2026-09-23) and rejected for now:

- **3DTilesRendererJS** (`3d-tiles-renderer`): the best three.js-native
  streamer (screen-space-error LOD, LRU cache, worker parsing). It only
  streams **OGC 3D Tiles** (`tileset.json` + glTF). Adopting it means
  rewriting every bake. The terrain (heightfield + class/RGB/NDVI splat +
  wall breaklines, ADR 0014) has no natural 3D Tiles form, and the clay
  shader, objectid picking and demolish would all need re-plumbing.
  Revisit only if the target becomes "all of Saxony", where a real LOD
  hierarchy pays for itself. That would need its own ADR.
- **giro3d / iTowns**: full GIS frameworks on three.js that own the scene,
  camera and loop. They conflict with the sun rig, post stack and camera
  pose, and they are the "heavy dependency" AGENTS.md says to ask about.
- **geo-three**: quadtree terrain from Web-Mercator map providers, not from
  our own UTM artifacts.
- **CesiumJS**: a second renderer. Out.

Our tiles form a **regular grid**, not a quadtree. The streaming core is a
few hundred lines of pure logic. The hard parts (switching the "primary"
tile, seams, shadows, lamps, rails) are project-specific and no library
would do them for us.

## Current state (at `b63c034`)

Where each fact lives, so the executor can re-verify quickly:

- **Tile list:** `lib/city/tile.ts` holds `PRIMARY_TILE`, `NEIGHBOUR_TILES`
  and `TILE_BLOCK` (with the heightfield `n` 1024/512 and raster
  4096/2048 per role), plus `tileArtifacts(spec)` as the single artifact map.
  `scripts/prepare-data.ts` bakes exactly `TILE_BLOCK`.
  `city-walk-client.tsx` builds the URLs through the manifest
  (`tileUrlsFrom`).
- **Origin:** the recenter offset comes from the **primary** CityJSON's
  loader matrix at bake time (`scripts/bake-city-mesh.ts`, `sharedMatrix`
  → `recenterOffset`) and is shared by every tile (`meta.offset`). It is a
  constant, so it stays valid for any number of tiles as long as every bake
  uses the same matrix.
- **Boot** (`app/_components/create-app.ts`, ADR 0008): the first frame
  needs the primary city + terrain. `startStreaming()` → `loadRest()`
  loads the primary's dressing, then `loadNeighbours()` (all neighbour
  meshes at once, terrains concurrently, dressing one tile at a time), then
  rails and walls **once for the whole block** (`addBlockRails`,
  `addBlockWalls`, ADR 0013) on the cross-tile `heightAt`, then
  `restoreFog()`.
- **Per-tile loaders** are closures inside `bootApp`:
  - `loadTileTerrain(tile, slot)` fetches the walls, calls `loadTerrain`,
    adds to `world`, then `landTerrain(slot)` and `lowerGroundFloor`.
  - `loadTileDressing(tile, t)` builds vegetation + lamps on `scene`
    (Y-up) and calls `lampLights.setHeads`.
- **Ledgers that only grow:** `terrains` (via `landedTerrain`),
  `extraCities`, `vegControls`, `lampControls`, `railGroups`,
  `wallGroups`, `wallFeatures`, `indexedTerrain`. Teardown is all-at-once
  in `dispose()`. Nothing frees a single tile.
- **Ground:** `heightAt` already walks **every** landed terrain ("first
  covering tile wins"), so the walk clamp, the shadow frustum
  (`groundUnderCamera`) and double-tap travel already work across tiles.
- **Collision:** `createCityCollider(() => [cityLayer.group, inserted?])`
  covers the primary city only. Demolish uses `pickCityObjectIndex(camera,
  cityLayer)`, also primary only. Autofocus targets `extraCities` +
  `indexedTerrain` as well.
- **Fog edge:** `worldPartial` clamps fog to `PARTIAL_WORLD_FOG_FAR`
  (1100 m) until `restoreFog()`. This is a one-way switch.
- **Minimap:** `landcoverTiles` and `terrainBounds: unionBounds` are
  computed once at boot from the heightfield headers and returned on the
  handle.
- **Lamps:** one fixed pool of real point lights (ADR 0020), built before
  the first render so `NUM_POINT_LIGHTS` never changes. Each tile's heads
  are fed in through `setHeads`.
- **Vegetation:** already chunked into 250 m cells (`CHUNK_SIZE`,
  `vegetation-layer.ts`), one InstancedMesh per cell.
- **Terrain seams:** every tile has a 30 m skirt (`SKIRT_DEPTH`,
  `lib/city/terrain-geometry.ts`), which hides cracks between tiles of
  different resolution.
- **Texture decode** is already off the main thread (`createImageBitmap`,
  `terrain-layer.ts` `loadBitmapTexture`). The class and NDVI rasters are
  `RedFormat` (1 B/px). The RGB splat is RGBA8 (4 B/px). The CPU bitmap is
  closed after upload.
- **Pure, DOM-free cores** that a worker can run unchanged:
  `lib/city/heightfield.ts` (parse), `lib/city/terrain-geometry.ts` (grid,
  skirt), `lib/city/terrain-conflate.ts` (wall breaklines),
  `lib/city/city-mesh.ts` (decode). `purity.test.ts` enforces that they
  have no THREE or DOM imports.
- **three-mesh-bvh** ships `GenerateMeshBVHWorker`
  (`node_modules/three-mesh-bvh/src/workers/`). three ships `KTX2Loader`
  and the Basis transcoder (`examples/jsm/libs/basis/`, ~576 KB).

## Target architecture

```
lib/city/tile-grid.ts        pure: tile/cell ids <-> EPSG bounds, neighbours, distance
lib/city/tile-schedule.ts    pure: desired set + LOD per cell from camera pos/dir,
                             hysteresis, priority order, memory budget -> {load, unload}
app/_components/tile-loader.ts   one tile in / one tile out: builds a TileHandle
                                 {terrain, city, vegetation, lamps, walls, rails,
                                  bytes, dispose()} — extracted from bootApp
app/_components/tile-manager.ts  drives the schedule: per-tile AbortController,
                                 max concurrent loads, one GPU upload per frame,
                                 invalidateShadows/ensureAlive/emitStats per change
app/_components/tile-worker.ts   module worker: fetch + inflate + parse + geometry
                                 arrays, transferred back (no THREE inside)
```

LOD levels (see Phase 6 for the bake side):

| Level | Unit | Distance (start values, tune on a real GPU) | Content |
|---|---|---|---|
| L0 near | 1 km cell | camera cell + ring 1 (≈ ≤ 1–1.5 km) | full-resolution heightfield + rasters, buildings with collision, vegetation, lamps, walls, rails |
| L1 mid | 2 km tile | ≤ ~4 km | today's neighbour quality: 512² heightfield, 2048² (phone 1024²) rasters, buildings, no vegetation/lamps |
| L2 far (optional, later) | 4–8 km merged | beyond | terrain + simplified building blocks only |

## Phases

### Phase 0: Maintainer decisions (gate)

Answer these and record them in this file before Phase 3:

1. **Target area.** How many 2 km tiles (e.g. 3×3, 5×5, "Dresden
   Altstadt + Neustadt")? This sets the L1 radius and whether L2 is needed
   at all.
2. **Hosting and data location.** Every tile adds ~25 MB of committed
   sources (DGM GeoTIFF 13.6 MB, CityJSON 8–10 MB, DLM/DOP derivatives
   ~2.5 MB). `.git` is 108 MB today, so 5×5 is 600 MB or more. Options:
   (a) keep committing, fine up to ~15–20 tiles; (b) publish the *baked*
   `public/data` + `manifest.json` to object storage/CDN and fetch from
   there (still static, still ADR 0001, but ADR 0004 needs amending);
   (c) Git-LFS, which AGENTS.md says to ask about.
3. **Accept ADR 0022** (move it from *proposed* to *accepted*). Accepting
   also means marking ADR 0006 *superseded* once Phase 3 lands.

**STOP** before Phase 3 if 1–3 are unanswered. Phases 1 and 2 are safe
refactors and may proceed.

### Phase 1: Extract the tile loader from `bootApp` (M, no behaviour change)

1. Create `app/_components/tile-loader.ts` with
   `loadTile(spec, ctx, signal): Promise<TileHandle>`. `ctx` carries the
   shared things: `world`, `scene`, `offset`, `sunDirection`, `heightFog`,
   `meadowNdvi`, `styleResources`, `look`. Move into it the bodies of
   `loadTileTerrain`, `loadTileDressing` and the neighbour city build
   (`createCityLayer` + `applyCityStyle`).
2. `TileHandle.dispose()` must **remove from the scene and free**
   everything the tile added: meshes (`disposeObject3D`), the terrain's
   textures (`t.dispose()`), vegetation, lamps, and the tile's BVH. This
   closes backlog item 15 for per-tile resources.
3. `bootApp` keeps its ledgers but fills them from handles. The first
   frame, `loadRest` ordering, the stage reports and the `__poc` fields
   stay byte-identical.

**Verify:**
- `bun run fix && bun run verify` is green.
- `bun test:e2e` is green.
- `bun run shots` (headed) on the existing snapshot set shows no visual
  difference.
- New unit: a fake scene sees `loadTile` → `dispose()` leave zero added
  children.

### Phase 2: Pure scheduling logic (S–M, `bun test` only)

1. `lib/city/tile-grid.ts`:
   - `cellOf(epsgX, epsgY, sizeM)`, `cellBounds(id)`, `ringAround(id, r)`,
     and the id scheme `33EEE_NNNN_<km>`, matching GeoSN's
     `<zone><easting km>_<northing km>_<edge km>`.
   - `parentTile(cellId)` for 1 km → 2 km.
2. `lib/city/tile-schedule.ts`:
   `schedule(state, {camera, dir, available, budgetBytes}) → {load[], unload[]}`
   - desired L0 = the camera cell plus ring 1, desired L1 = within the L1
     radius;
   - **hysteresis:** unload only beyond `radius + 1` ring (or an extra
     500 m), so walking along a seam never thrashes;
   - priority = distance, weighted toward the view direction (in front
     beats behind);
   - LRU eviction once `sum(bytes) > budgetBytes`, never evicting the
     camera cell;
   - an L1 tile stays until its four L0 cells have landed (no hole while
     upgrading), and it drops out of the L0 area after that.
3. `available` comes from the manifest, not from `TILE_BLOCK`. Add a
   `tiles` array (id, level, bounds) to `manifest.json` in
   `prepare-data.ts`. `lib/city/features.test.ts` / `tile.test.ts` must
   keep checking every committed file.

**Verify:** `bun test lib/city/tile-grid.test.ts lib/city/tile-schedule.test.ts`
cover walking in a straight line across four cells, pacing along a seam
(zero unloads), a teleport (everything old unloads, the camera cell loads
first), budget eviction order, and upgrading L1→L0 without a hole.

### Phase 3: Runtime tile manager (M–L, gate: Phase 0)

1. `app/_components/tile-manager.ts` runs the schedule at ~2–4 Hz (not per
   frame) from the render loop:
   - at most 2 concurrent tile loads;
   - one `AbortController` per tile, so an unload while loading aborts it
     (`fetch-optional.ts` already rethrows aborts);
   - every land/unload calls `invalidateShadows()` and `emitStats()` and
     re-checks `ensureAlive()`.
2. Replace `loadNeighbours()` with the manager. The **first frame is
   unchanged** (camera cell's terrain + buildings, ADR 0008). `onLoaded` /
   `__poc.ready` now mean "the initial desired set has landed".
3. Make the one-shot state live:
   - **Collision / demolish:** `createCityCollider` takes the city groups of
     the camera cell and its ring-1 neighbours (a player stands within
     ~0.5 m of a seam's buildings). `demolishAtCrosshair` picks across the
     loaded L0 cities (`pickCityObjectIndex` per layer, nearest hit wins).
     Demolished ids are kept per tile id, so a tile that unloads and reloads
     stays demolished within the session.
   - **Fog:** replace the `worldPartial` boolean with the distance from the
     camera to the nearest *unloaded* edge in the view direction. Clamp
     `fog.far` to it (and never raise it above the slider value).
   - **Minimap:** the handle exposes `getLandcoverTiles()` and
     `getTerrainBounds()` (live), and `minimap.tsx` re-frames when they
     change. Keep the square-bounds assumption noted in backlog item 17 in
     mind.
   - **Lamps:** keep the fixed pool (ADR 0020). `setHeads` gets the union
     of the loaded tiles' heads on every change.
   - **Rails / walls:** they are built per block today (ADR 0013). Rebuild
     them over the **loaded L0 set** on change, debounced by ~1 s, with the
     cross-tile `heightAt`. If the rebuild costs > 50 ms per change, stop
     and move rails to a per-tile bake with overlap (a separate plan).
   - **`groundFloor`:** it only goes down today. Recompute it over the loaded
     set on unload, since it also drives the height-fog start.
4. `__poc` gains `tiles: {id, level, state}[]` for the e2e.

**Verify:**
- `bun run verify`.
- `bun test:e2e`, with a new serial spec at `?scene=lite&block=1`:
  `teleportTo` 2 km east, wait until `__poc.tiles` shows the new camera
  cell landed and the old one unloaded, then assert that collision stops
  the player at a building on the *new* tile.
- `__poc.handle.getRenderInfo().gpuBytes` returns to within 10 % of its
  starting value after walking away and back (no leak).
- `bun run shots` (headed) shows no seams at the spawn snapshots and no
  missing shadows after a tile lands.

### Phase 4: Loader worker (M)

1. `app/_components/tile-worker.ts` is a module worker, created with
   `new Worker(new URL("./tile-worker.ts", import.meta.url), { type: "module" })`.
   Check that `next build` (Turbopack) bundles it. If it does not, STOP.
2. Move into the worker: fetch, gzip inflate, heightfield parse, wall
   conflation, terrain + water grid arrays (positions, normals, uvs,
   indices), city-mesh decode, the canopy/vegetation instance matrices, and
   GeoJSON parsing. Return typed arrays as **transferables**.
3. The main thread only wraps them in `BufferGeometry` /
   `InstancedMesh`. BVHs go through `GenerateMeshBVHWorker`.
4. **Upload budget:** at most one large texture or geometry upload per
   frame (queue in the manager). `renderer.initTexture(tex)` warms a
   texture at a chosen moment instead of in the middle of a render.
5. The abort signal is forwarded as a message, and the worker aborts its
   fetches.

**Verify:**
- `bun run verify` and `bun test:e2e`.
- Performance trace (headed, real GPU) while walking across a cell seam: no
  main-thread task over 50 ms from tile loading, apart from single texture
  uploads. Record before/after numbers in this file.

### Phase 5: Budgets per device (S)

Derive `budgetBytes` from the existing device tier (`scene-profile.ts`,
the MOBILE_RASTER_PX logic). Starting hypotheses: desktop ~800 MB, phone
~300 MB of `gpuBytes`. Calibrate them on a real phone and a laptop iGPU,
then write the measured numbers here and in `docs/rendering.md`
(budgets).

### Phase 6: 1 km near cells in the bake (M–L, gate: shot review)

1. `prepare-data.ts` splits each 2 km source tile into four 1 km L0 cells:
   - heightfield: 512² per km (≈ 2 m, today's primary density), with a
     **1-sample overlap** on the shared edges so seams match exactly;
   - rasters: 2048² per km (≈ 0.5 m, today's primary density) for the
     class and RGB splats, NDVI cropped to match;
   - buildings: assigned to exactly one cell by footprint centroid, never
     cut. A roof overhanging the seam is fine because both cells are loaded
     at L0 anyway;
   - GeoJSON (canopy, vegrows, lamps: points assigned by position; walls,
     rails: lines assigned by midpoint and kept whole).
2. The existing 2 km artifacts become L1. The neighbour artifacts already
   have exactly this shape.
3. Update `docs/data-pipeline.md` (the artifact table and sizes),
   `docs/transformations.md`, `docs/data-flow.md` and
   `docs/rendering.md`. Run `bun run docs:diagrams` if a Mermaid block
   changes.

**Verify:** `features.test.ts` checks every cell file. `bun run shots`
(headed) has a new snapshot straddling a 1 km seam at eye level and one at
200 m altitude (oblique, per AGENTS.md). Zero visible cracks or colour steps.

### Phase 7: KTX2 for the RGB splat (S–M, gate: maintainer + shots)

1. Only the **RGB splat** (RGBA8, 4 B/px) changes. Encode it as KTX2
   **UASTC + zstd**, never ETC1S: alpha is water coverage, and ETC1S block
   artefacts show on shorelines. The class raster stays lossless (class ids
   must be exact, NEAREST), and so does NDVI (already 1 B/px).
2. Expected: 4096² splat ~85 → ~21 MB of GPU memory with mips, 2048²
   ~21 → ~5 MB. Faster upload with no decode. Wire size stays roughly the
   same as PNG. Measure it and write the numbers here.
3. Needs an encoder in the build (`basisu`/`toktx` CLI or a WASM encoder
   package; ask first, it is a dependency). The transcoder (~576 KB,
   `three/examples/jsm/libs/basis/`) is copied into `public/` by
   `prepare-data.ts` and loaded lazily by `KTX2Loader`, which already
   transcodes in its own workers.
4. Keep the PNG path as the fallback when the device supports no
   compressed format (`KTX2Loader` reports this).

**Verify:** `bun run shots` (headed) before/after on the shoreline and
meadow snapshots, with no visible difference at eye level. `gpuBytes`
drops as predicted.

## STOP conditions

- The first frame gets later (the `__poc.firstFrame` time in the lite e2e
  regresses by > 10 %).
- The e2e suite exceeds its frame budget (AGENTS.md "Budget the e2e specs
  in frames"). Shrink the spec, don't raise timeouts.
- Any visible seam, missing shadow or missing lamp light after a tile
  lands or unloads in a headed shot.
- `gpuBytes` does not come back after unload (leak).
- Turbopack cannot bundle the module worker (Phase 4).
- A phase would add a dependency beyond what is named here, or move data
  out of git, without the Phase 0 answer.

## Out of scope

- Streaming from a live service or a tile server: this stays static files
  (ADR 0001).
- A floating origin. The shared recenter offset is exact for the target
  area. float32 keeps ~1 mm at 10 km and ~4 mm at 50 km from the origin. If
  the area ever grows beyond ~30 km, re-centre the camera-relative
  rendering (a separate ADR).
- OGC 3D Tiles and the libraries above. See "Why hand-written".
- Portability to non-Saxon data (direction option 1).
