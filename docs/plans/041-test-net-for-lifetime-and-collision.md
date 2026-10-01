# Plan 041: Tests where the regressions are — tile weighing and freeing, the building collider, the layer census, the eye height

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> This plan adds tests and, in step 1, one small extraction so the tested
> behaviour has a public seam. Read `.claude/skills/test-audit/SKILL.md`
> before writing the first test and follow it (behaviour over
> implementation, no assertions that would pass with any input). On a STOP
> condition, stop and report. When done, update this plan's row in
> `docs/plans/README.md`.
>
> **Multi-site layout (merged 2026-10-01, ADR 0037, plan 049)**: the data
> lives per site — `data/<site>/{dgm,cityjson,dlm,dop}` (Dresden's under
> `data/dresden/`), raw downloads in `data/_raw/<provider>/` — and the bakes
> run as `bun run fetch <site>` / `bun run bake <site> [tile…] [--step X]`
> through `scripts/pipeline.ts` (`scripts/bake.ts` and `--ingest` are gone;
> Saxony's adapter is `pipeline/bake/providers/sn.py`). Read the paths and
> commands below in that layout; this is drift, not a STOP condition.
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- app/_components/tile-stream.ts app/_components/tile-stream.test.ts app/_components/collision.ts app/_components/create-app.ts e2e/city-walk.spec.ts app/_components/stylize-effect.ts app/_components/pipeline-anchors.test.ts`

## Status

- **Priority**: P2 (protects the code that has had six lifetime fixes in three days)
- **Effort**: M
- **Risk**: LOW (tests; one behaviour-preserving extraction)
- **Depends on**: 037 (test commands). Plan 038 step 2 changes the boot's
  loaded condition — if 038 is merged first, nothing here conflicts.
- **Category**: tests
- **Planned at**: commit `a28de75`, 2026-10-01

## Why this matters

The modules most likely to regress have the thinnest net. `tile-stream.ts`
(32.7 % line coverage) had six disposal/lifetime fixes between 2026-09-28
and 2026-09-30; its tile-cache weighing (added after an iPhone ran out of
GPU memory) and its "free an aborted load the renderer never kept" path
have no test. `collision.ts` — the code that enforces ADR 0032 ("the
camera is never inside a building") through three-mesh-bvh — is never
imported by a test; camera-pose tests replace it with hand-written
lambdas. The e2e layer census exists so a builder that throws and is
swallowed fails CI, but it skips stairs, sports fixtures and kerbs — all
reworked this month — and nothing checks that the walker stands at the
right height. Two small checks guard recent contracts: a picture style
without pens fails silently, and the pipeline-anchor test compares against
its own copy of three's private geometry key.

## Current state

### Tile weighing (`app/_components/tile-stream.ts:681-731`)

```ts
  calculateBytesUsed(_tile: object, scene: Object3D | null): number {
    const dressed = scene ? this.dressed.get(scene) : undefined;
    let rasters = 0;
    for (const texture of dressed?.terrain?.rasters ?? []) {
      const holders = this.rasterHolders.get(texture)?.size ?? 1;
      rasters += trackedBytesOf(texture) / Math.max(holders, 1);
    }
    return rasters + (dressed?.dressingBytes ?? 0);
  }

  /** `scene`'s terrain takes up (or lets go of) its rasters; the other
   *  levels reading one of them now weigh a different share of it. */
  private holdRasters(scene: Object3D, rasters: Texture[], hold: boolean) {
    const others = new Set<Object3D>();
    for (const texture of rasters) {
      let holders = this.rasterHolders.get(texture);
      ... add/delete scene, collect the other holders, drop empty sets ...
    }
    for (const other of others) {
      const tile = this.tileOf.get(other);
      if (tile) {
        this.tiles?.recalculateBytesUsed(tile);
      }
    }
  }
```

`trackedBytesOf` comes from `three-utils.ts` (bytes of a texture
registered with `trackTexture`). `holdRasters` is private and reached only
through `dressTerrain` (which fetches real rasters) — not testable as is.

### Aborted load (`tile-stream.ts:733-800`)

`processTileModel(scene, tile)` → `dressContent`: for a scene whose
`userData.kind` is neither `"city"` nor `"terrain"` it only compiles
(`this.compileUnder`), then:

```ts
    setTimeout(() => {
      const kept = (tile as { engineData?: { scene?: Object3D | null } })
        .engineData?.scene;
      if (kept === scene || this.released.has(scene)) {
        return;
      }
      if (this.sceneOf.get(tile) === scene) {
        this.sceneOf.delete(tile);
      }
      this.released.add(scene);
      this.release(scene);
    }, 0);
```

Pattern to follow: `tile-stream.test.ts:107-150` ("a tile that leaves while
its compile runs is freed once the compile ends") builds
`new DressingPlugin({ dressingGate, compile, onChange } as unknown as TileStreamContext, { cities, terrains, dressings, demolished })`,
a scene with a `Mesh(new BoxGeometry(), new MeshBasicNodeMaterial())`, and
listens for the geometry's `"dispose"` event.

### Collider (`app/_components/collision.ts`, 214 lines)

`createCityCollider(getTargets)` returns `{ roofAbove(x, y, z), topAt(x, z), resolveStep(position, displacement) }`.
It installs three-mesh-bvh's `computeBoundsTree`/`acceleratedRaycast` on
the prototypes at import; meshes need `geometry.computeBoundsTree()`.
Behaviours to pin:
- `roofAbove`: from **inside** a closed solid, the surface straight above
  faces up → returns its world height; from **under** an overhang (outside,
  below a surface whose normal faces down) → null; outside with nothing
  above → null.
- `topAt(x, z)`: the highest surface over (x, z), or null off the mesh.
- `resolveStep`: an unobstructed step passes unchanged; a head-on step into
  a wall returns zero; an oblique step slides along the wall (no component
  into it); a ray at knee height (eye − 1.2 m) also blocks.
- The cached world frame (`frameOf`) refreshes when the mesh's
  `matrixWorld` changes (move the parent, call `updateMatrixWorld(true)`,
  `topAt` follows).

### Census (`app/_components/create-app.ts:997-1017`, `e2e/city-walk.spec.ts:314-351`)

```ts
      layerStats: {
        city: census(cities.map((c) => c.mesh)),
        terrain: census(terrains.map((t) => t.mesh)),
        water: census(terrains.flatMap((t) => [t.water?.mesh, t.water?.mistMesh])),
        ...dressingCensus(dressings, census),
        walls: census(terrains.map((t) => t.walls)),
        stairs: census(terrains.map((t) => t.stairs)),
        fences: census(terrains.map((t) => t.fences)),
      },
```

There is no `kerbs` entry, although `TerrainLayer` has `kerbs`
(`terrain-layer.ts`, "the tile's baked kerb stones (fine level only)") and
`LayerName` (`create-app.ts:~110-119`) is the key type. The e2e test
"every scene layer is built on the primary tile" asserts city, terrain,
water, vegetation, lowVegetation, lamps, monuments, furniture, rail, tram,
riverside, walls and fences — **not** stairs, sport (a dressing part; see
`DRESSING_PART_NAMES` in `tile-stream.ts`) or kerbs. The spawn tile has
data for all three: `data/dlm/stairs_33412_5656_2_sn.geojson` (140
features), a sports-ground table for the tile, and kerbs.

### Eye height

`lib/city/pose.ts:15` `export const EYE_HEIGHT = 1.7`. World y is the
elevation (AGENTS.md: `y = elevation`). The committed DGM for the spawn
tile is `data/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif`
(check the exact path with `ls data/dgm | grep 33412_5656`). The e2e spec
already imports `proj4`; `geotiff` is a devDependency (used by
`scripts/bake-tiles.ts` — copy its reading pattern). The test "minimap
click teleports the player" leaves the player in walk mode at a known
EPSG position; `window.__poc.handle.getCameraState()` returns
`{ epsg: {x, y}, pos: {x, y, z}, mode, … }`.

### Pens (`app/_components/stylize-effect.ts:813-818, 848-849`)

```ts
    setStyle: (style) => {
      mode.value = style.shaderMode;
      const def = PENS[style.shaderMode];
      if (!def) {
        return;
      }
...
/** The live uniforms a caller may want in tests (the pens by mode). */
export const STYLE_PENS: Readonly<Record<number, Readonly<Pen>>> = PENS;
```

No test imports `STYLE_PENS`. The style rows are `RENDER_STYLES` in
`lib/city/render-style.ts` (each with a `shaderMode`; 0 = the plain pastel
look, no pens).

### Anchor key (`app/_components/pipeline-anchors.test.ts:14-29`)

A local `layoutKey()` re-implements three's
`RenderObject.prototype.getGeometryCacheKey`
(`node_modules/three/src/renderers/common/RenderObject.js:687-704`). three
exports `./src/*` (`node_modules/three/package.json`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| One test file | `bun test app/_components/collision.test.ts` | all pass |
| Unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |
| E2E (one test) | `bunx playwright test e2e/city-walk.spec.ts -g "every scene layer"` | pass (needs a Chromium; see below) |

E2E needs Playwright's Chromium. In a Claude Code web container it is at
`/opt/pw-browsers` (do not run `playwright install`). Elsewhere, if no
browser is available, write the e2e changes, run `bun run typecheck`, and
say "e2e not run locally" in the status row — CI runs them.

## Scope

**In scope**: `lib/city/features.test.ts` (step 5b), `app/_components/tile-stream.ts` (step 1 extraction only),
`app/_components/tile-stream.test.ts`, `app/_components/collision.test.ts`
(create), `app/_components/create-app.ts` (add the `kerbs` census entry
only), `e2e/city-walk.spec.ts`, `app/_components/stylize-effect.test.ts`
(create, or the closest existing test file for it),
`app/_components/pipeline-anchors.test.ts`.

**Out of scope**: any behaviour change in tile-stream, collision, or the
layers; new `__poc` fields beyond what step 4 needs (none should be
needed); a WebGPU CI shard.

## Git workflow

Branch `claude/041-test-net`; commits like
`test(stream): the tile cache weighs a shared raster once`,
`test(collision): the building collider through a real BVH`,
`test(e2e): the census counts stairs, sport and kerbs; the walker stands on the DGM`.
No push unless instructed.

## Steps

### Step 1: Raster shares as a unit, then test it

Extract the raster-holder bookkeeping into a small exported class in
`tile-stream.ts` (or a new `app/_components/raster-shares.ts`):

```ts
/** Which terrain levels hold which rasters: each holder weighs an equal share. */
export class RasterShares {
  hold(holder: object, rasters: Texture[]): object[]   // returns the OTHER holders whose share changed
  release(holder: object, rasters: Texture[]): object[]
  bytesOf(rasters: Texture[]): number                 // Σ trackedBytesOf(t) / holders(t)
}
```

`DressingPlugin` keeps `holdRasters(scene, rasters, hold)` as a thin
wrapper: call `hold`/`release`, then `recalculateBytesUsed` for each
returned holder's tile (as today). `calculateBytesUsed` uses `bytesOf`.
**Behaviour must not change.**

Tests (`tile-stream.test.ts`): two holders share one tracked texture
(`trackTexture(texture, bytes)` from `three-utils.ts` registers a byte
size; `trackedBytesOf(texture)` reads it) → each weighs half; `release` of one returns the other
and the other now weighs the whole; a raster held by one holder weighs
whole; releasing the last holder forgets the texture.

**Verify**: `bun test app/_components/tile-stream.test.ts` → all pass;
`bun run typecheck` → exit 0.

### Step 2: The aborted load is freed

Two tests next to "a tile that leaves while its compile runs…":
- a `processTileModel(scene, tile)` with `compile: () => Promise.resolve()`
  and a `tile` whose `engineData.scene` is never set → after
  `await loading` and one more macrotask (`await new Promise((r) => setTimeout(r, 1))`)
  the geometry's `"dispose"` fired;
- the same, but set `tile.engineData = { scene }` right after `await loading`
  (before the macrotask) → not disposed.

**Verify**: `bun test app/_components/tile-stream.test.ts` → all pass;
temporarily comment out the `this.release(scene)` inside the `setTimeout`
→ the first test fails; restore.

### Step 3: The collider through a real BVH

Create `app/_components/collision.test.ts`. Fixture: a closed box building
(`new BoxGeometry(10, 10, 10)`, `geometry.computeBoundsTree()`) in a
`Group` translated to (100, 5, 100) so the box spans y 0…10; a second mesh
for the overhang (a thin box at y 6…6.2 spanning x 120…130); call
`group.updateMatrixWorld(true)`. `createCityCollider(() => [group])`.

Cases (each its own `test`):
- `roofAbove(100, 2, 100)` (inside) → ≈ 10; `roofAbove(90, 2, 90)` (outside, nothing above) → null; under the overhang `roofAbove(125, 2, 100)` → null.
- `topAt(100, 100)` → ≈ 10; `topAt(0, 0)` → null.
- `resolveStep`: from (80, 1.7, 100) a step of (1, 0, 0) → unchanged; from
  (94.5, 1.7, 100) a step of (1, 0, 0) → length ≈ 0 (head-on, within
  `BODY_RADIUS` 0.6); from (94.5, 1.7, 100) a step of (1, 0, 1) → x
  component ≈ 0, z component ≈ 1 (slides).
- Knee ray: a low box (y 0…1, no wall at eye height) blocks a step at eye
  height 1.7 (the second ray at 1.7 − 1.2 = 0.5 hits).
- Frame refresh: move the group by +50 in x, `updateMatrixWorld(true)`,
  `topAt(150, 100)` → ≈ 10 and `topAt(100, 100)` → null.

If three-mesh-bvh cannot run under Bun, STOP (do not mock it — a mock
would test nothing).

**Verify**: `bun test app/_components/collision.test.ts` → all pass.

### Step 4: Census and eye height in e2e

1. `create-app.ts`: add `kerbs: census(terrains.map((t) => t.kerbs)),` next
   to `walls`/`stairs`/`fences`, and add `| "kerbs"` to the `LayerName`
   union (`create-app.ts:112-119`, alphabetical like the others).
   `SceneCensus` (`scene-census.ts`) has `instances`, `meshes`, `triangles`.
2. `e2e/city-walk.spec.ts`, test "every scene layer is built on the primary
   tile": add, with a one-line comment giving the spawn tile's count like
   the others,
   `expect(stats.stairs.triangles).toBeGreaterThan(0);` (140 OSM flights),
   `expect(stats.kerbs.triangles).toBeGreaterThan(0);`,
   and for sport whichever of `triangles`/`instances` the sport dressing
   produces (`expect(stats.sport.triangles + stats.sport.instances).toBeGreaterThan(0)`
   if unsure; check `SceneCensus`'s fields in `scene-census.ts`).
3. Eye height: in the test "minimap click teleports the player" (after the
   teleport has landed and the mode is walk), read the camera state, read
   the spawn tile's DGM at the state's `epsg` with `geotiff` (Node side,
   nearest pixel: column = floor(x − minX), row = floor(maxY − y) with the
   GeoTIFF's bounding box), and assert
   `Math.abs(state.pos.y − EYE_HEIGHT − dgm) < 0.5` (import `EYE_HEIGHT`
   from `../lib/city/pose`). On a building, stairs or a bridge the camera
   is lifted (ADR 0032), so the target must be open ground: if the
   existing test's target is not, add the check to a teleport of your own
   to an open spot on the spawn tile (a meadow — e.g. pick a point the
   class raster marks as meadow). Never widen the tolerance to make it
   pass.

**Verify**: `bun run typecheck` → exit 0; `bunx playwright test e2e/city-walk.spec.ts -g "every scene layer|minimap click"` → pass (or "e2e not run locally" noted).

### Step 5: Pens per style, and three's real key

1. New test (e.g. `app/_components/stylize-effect.test.ts`): every row of
   `RENDER_STYLES` with `shaderMode > 0` has an entry in `STYLE_PENS`. If
   importing `stylize-effect.ts` under Bun fails (it builds TSL nodes at
   import), STOP for this sub-step and instead delete the unused
   `STYLE_PENS` export.
2. `pipeline-anchors.test.ts`: replace the local `layoutKey` body with
   three's own:
   ```ts
   import RenderObject from "three/src/renderers/common/RenderObject.js";
   const layoutKey = (object: { geometry: Mesh["geometry"] }): string =>
     RenderObject.prototype.getGeometryCacheKey.call(object);
   ```
   (Reading three internals in a *test* is fine; ADR 0027 forbids
   *patching* them.) If the import has no type declarations, add a
   `// reason:` comment and a narrow cast, not a `.d.ts` shim.

**Verify**: `bun test app/_components/pipeline-anchors.test.ts` → all pass
(same assertions, now against three's key).

### Step 5b: The fixture checks plan 008 left (contract rows)

`lib/city/tile-data.test.ts` already checks that every tile carries every
kind of file (CityJSON, `landcover_*.png` + legend, DGM `.tif`/`.tfw`, …).
Still unchecked, from plan 008 step 6 — add them to
`lib/city/features.test.ts` next to the existing per-kind contract tests
(follow their style; they iterate `tileIds(DRESDEN)`):

- every tile's `canopy_*.geojson` and `vegrows_*.geojson` has at least one
  feature (true on all fifteen today; an empty file means a skipped bake);
- every `bridge_*.geojson` feature's `kind` ∈ {`rail`, `road`, `path`, `other`};
- every `rail_*.geojson` feature's `tracks` is a finite number ≥ 1 when
  present (8 of 15 rail files are legitimately empty — no rail lines);
- every `roofcolor_*.json` has the shape `{ meta, roofs }`;
- every committed `.geojson` has `type === "FeatureCollection"`.

**Verify**: `bun test lib/city/features.test.ts` → all pass; break one
committed file locally (e.g. set a bridge `kind` to `"x"`) → fails; restore
with `git checkout -- data/`.

### Step 6: Gate

**Verify**: `bun run fix && bun run verify` → exit 0.

## Test plan

Everything above is the test plan: 4 raster-share tests, 2 aborted-load
tests, ~7 collider tests, 3–4 new e2e assertions, 1 pens test, the anchor
test switched to three's key.

## Done criteria

- [ ] `bun run verify` exits 0
- [ ] `app/_components/collision.test.ts` exists, ≥ 6 tests, all pass
- [ ] `grep -n "RasterShares" app/_components/*.ts` → class + use + tests
- [ ] `grep -n "stats.stairs\|stats.kerbs\|stats.sport" e2e/city-walk.spec.ts` → 3 matches
- [ ] `grep -n "EYE_HEIGHT" e2e/city-walk.spec.ts` → 1 match
- [ ] `grep -n "getGeometryCacheKey" app/_components/pipeline-anchors.test.ts` → 1 match
- [ ] Step 5b's five contract checks exist in `lib/city/features.test.ts` and pass
- [ ] Only in-scope files changed

## STOP conditions

- Step 1's extraction changes what `calculateBytesUsed` returns for any
  existing test or the e2e → stop.
- three-mesh-bvh does not work under Bun (step 3) → stop; no mocks.
- The eye-height check fails by more than the tolerance at open ground →
  stop and report the numbers (it may be a real bug — do not loosen it).

## Maintenance notes

- A new dressing part or terrain node should get a census line and an e2e
  assertion in the same change.
- If the collider's ray rules change (ADR 0032), these tests are the spec —
  update them deliberately.
