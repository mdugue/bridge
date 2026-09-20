# Plan 008: Make the verification net catch what it exists to catch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- e2e/ playwright.config.ts .github/workflows/ci.yml app/_components/create-app.ts app/_components/poc-debug.ts app/_components/visual-style.ts app/_components/terrain-layer.ts app/_components/water-layer.ts app/_components/height-fog.ts app/_components/vegetation-layer.ts lib/city/tile.ts scripts/prepare-data.ts package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

The headless e2e suite is the only automated check that the scene actually
builds, and today it can pass with nothing rendered: if WebGL is unavailable
every render test is *skipped* rather than failed, the one "renders" test
asserts data counts and a flag that is set unconditionally at boot, no test
looks at whether the vegetation, lamp, rail, wall or water layers exist, and
every optional layer swallows its errors into an empty group. The data
contracts the loaders rely on (GeoJSON geometry types and property names) are
checked by nothing — one committed tile already carries `MultiPolygon` ballast
that the loader silently drops. Every material patch is a string `.replace`
against three.js shader-chunk names that nothing pins, so a `three` bump can
switch a feature off with green CI. And the CI job that decides whether to run
the e2e half ignores `scripts/`, `data/` and `patches/`, the three paths that
change what the viewer loads.

After this plan: CI fails when WebGL is missing, every layer is asserted
present with real counts, a demolish is checked at the render level, the
committed data is validated against what the loaders read, shader anchors are
pinned, the snapshot harness no longer runs by accident, failures leave a
screenshot behind, and the e2e half runs whenever the data path changes. The
later plans (009–012) rely on this net.

## Current state

Files and their roles:

- `e2e/city-walk.spec.ts` — the smoke suite (lite profile, shared boot).
- `e2e/snapshot-shot.spec.ts` — the manual `--headed` QA harness; picked up
  by the default run whenever `shots/*.json` exist.
- `playwright.config.ts` — no `testIgnore`, no screenshot/trace on failure.
- `.github/workflows/ci.yml` — the e2e scope gate at lines 96–99.
- `app/_components/create-app.ts` — `CityWalkStats` (lines 98–102) and
  `emitStats` (lines 980–987) feed `window.__poc` via the HUD.
- `app/_components/poc-debug.ts` — `PocDebugInfo` (the `__poc` contract).
- `lib/city/tile.ts` — `TILE_BLOCK` (lines 36–39); file-name helpers (41–52).
- `scripts/prepare-data.ts` — the artifact copy lists (lines 42–69).
- `app/_components/visual-style.ts`, `terrain-layer.ts`, `water-layer.ts`,
  `height-fog.ts`, `vegetation-layer.ts` — the `onBeforeCompile` patches.

### The skip-instead-of-fail path

`e2e/city-walk.spec.ts:159-179`:

```ts
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    page = await context.newPage();
    errors = watchErrors(page);
    await page.goto(LITE);
    webgl = await hasWebGl(page);
    if (!webgl) {
      return;
    }
    ...
  });

  test.beforeEach(() => {
    // biome-ignore lint/suspicious/noSkippedTests: conditional runtime skip — render assertions are meaningless without WebGL
    test.skip(!webgl, "WebGL is genuinely unavailable in this environment");
  });
```

The same pattern is at `:424-426` in the mobile test. `afterAll` (`:181-183`)
closes the page without a final `expectNoErrors(errors)`.

### The "renders" test asserts a constant

`e2e/city-walk.spec.ts:194-198`:

```ts
    const poc = await page.evaluate(() => window.__poc);
    expect(poc?.buildingCount ?? 0).toBeGreaterThan(0);
    expect(poc?.terrainVertexCount ?? 0).toBeGreaterThan(0);
    expect(poc?.shadowsEnabled).toBe(true);
    expectNoErrors(errors);
```

`shadowsEnabled` is `renderer.shadowMap.enabled` (`create-app.ts:985`), set
unconditionally at `create-app.ts:316`. Nothing asserts on vegetation, lamps,
rail, walls or water. Demolish (`:324-328`) is judged only by
`buildingCount`, which is `countBuildings(cityLayer.data)` — the filtered
document, not the mesh.

### Stats plumbing

`app/_components/create-app.ts:98-102`:

```ts
export interface CityWalkStats {
  buildingCount: number;
  shadowsEnabled: boolean;
  terrainVertexCount: number;
}
```

`app/_components/create-app.ts:980-987`:

```ts
  let fps = 0;
  const emitStats = () => {
    opts.onStats?.({
      buildingCount: countBuildings(cityLayer.data),
      terrainVertexCount: terrain.vertexCount,
      shadowsEnabled: renderer.shadowMap.enabled,
    });
  };
```

`emitStats()` runs once at the end of boot (`:1223`) and after each demolish
(`:998`). The HUD forwards the object to the hook: `city-walk.tsx:1124-1125`
does `setStats(s); updatePocDebug(s);` — so any field added to
`CityWalkStats` appears on `window.__poc` automatically. `PocDebugInfo`
(`poc-debug.ts:19-118`) must gain a matching typed member.

The per-layer objects available inside `bootApp` at the point `emitStats` is
defined: `cityLayer.group` (primary buildings; re-assigned on demolish),
`extraCities` (`CityLayer[]`), `terrains` (`TerrainLayer[]`, each with `mesh`
and optional `water.mesh` / `water.mistMesh`), `vegControls`
(`VegetationControl[]`, each with `group`), `lampControls` (`LampControl[]`,
each with `group`), `railControls` (`RailControl[]`, `group`), `wallControls`
(`WallControl[]`, `group`). Vegetation and lamps use `InstancedMesh` (the
vegetation crown LOD keeps one of the two crown meshes per cell at
`visible = false`; count both).

### The CI scope gate

`.github/workflows/ci.yml:96-99`:

```yaml
          if git diff --name-only "$BASE_SHA" HEAD -- \
              app components hooks lib e2e public types \
              playwright.config.ts next.config.ts package.json bun.lock \
              | grep -q .; then
```

`scripts/prepare-data.ts` bakes the heightfields the terrain uploads,
`data/**` is what the viewer loads, and `patches/` rewrites the CityJSON
loader — none is in the list.

### Playwright config

`playwright.config.ts:31` — `testDir: "./e2e"` with no `testIgnore`;
`:54-57`:

```ts
  use: {
    baseURL,
    trace: "on-first-retry",
  },
```

`e2e/snapshot-shot.spec.ts:62-74` turns every `shots/*.json` into a test that
boots the **full** profile and overwrites `shots/<name>.png`:

```ts
const SHOTS_DIR = join(process.cwd(), "shots");

function snapshotFiles(): string[] {
  try {
    return readdirSync(SHOTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

for (const file of snapshotFiles()) {
  const name = file.replace(/\.json$/, "");
  test(`snapshot: ${name}`, async ({ page }) => {
```

### The committed data and what the loaders read

`lib/city/tile.ts:36-52` (tile list and the three names it owns):

```ts
export const TILE_BLOCK: TileSpec[] = [
  { tile: PRIMARY_TILE, n: PRIMARY_HEIGHTFIELD_N },
  ...NEIGHBOUR_TILES.map((tile) => ({ tile, n: NEIGHBOUR_HEIGHTFIELD_N })),
];

/** Files served from /data (= public/data/), all derived from the tile id. */
export function cityJsonFile(tile: string): string {
  return `lod2_${tile}.city.json`;
}
```

`scripts/prepare-data.ts:42-69` lists the other names: required
`data/cityjson/lod2_<tile>.city.json`, `data/dlm/landcover_<tile>.png`,
`data/dlm/landcover_rgb_<tile>.png`, `data/dlm/vegrows_<tile>.geojson`,
`data/dlm/canopy_<tile>.geojson`; optional `data/dlm/lamps_<tile>.geojson`,
`data/dop/roofcolor_<tile>.json`, `data/dlm/ndvi_<tile>.png`,
`data/dlm/rail_<tile>.geojson`, `data/dlm/bridge_<tile>.geojson`,
`data/dlm/railarea_<tile>.geojson`, `data/dlm/platform_<tile>.geojson`,
`data/dlm/walls_<tile>.geojson`. The DGM source the bake reads is
`data/dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif` (+ `.tfw`).

What the loaders read from each GeoJSON (verified in code):

| File | Geometry the loader accepts | Properties read |
|---|---|---|
| `vegrows_*` | `LineString` | `kind` ∈ `hedge` \| `treerow` (`vegetation-layer.ts:105-108`; `properties` may be `null`) |
| `canopy_*` | `Point` | `h` number (`vegetation-layer.ts:110-113`, `:786-790` tolerates a missing/NaN `h`) |
| `lamps_*` | `Point` | `h?` number (`lamp-layer.ts:43-46`) |
| `walls_*` | `LineString` | `kind` string, `h` number (`wall-layer.ts:24-27`) |
| `rail_*` | `LineString` | `tracks` number, `electrified` number (`rail-layer.ts:38-41`) |
| `bridge_*` | `Polygon` | `deck` number[] (one per outer-ring vertex), `kind` ∈ `rail`\|`road`\|`path`\|`other`, `name`, `structure?` (`rail-layer.ts:43-52`) |
| `railarea_*` | `Polygon` only (`rail-layer.ts:810`) | none |
| `platform_*` | `Polygon` or `LineString` (`rail-layer.ts:883-892`) | none |
| `roofcolor_*` | JSON `{ roofs: Record<id, [r,g,b]> }` (`create-app.ts:383-384`) | — |

Facts measured on the committed data at `2079c3a` (use them as expectations):
primary tile `33412_5656_2_sn` has 5 118 canopy points, 25 vegrows (all
`treerow`), 339 lamps, 292 walls, 21 platforms, 3 bridges, 1 railarea polygon
and **0** rail lines (`rail_33412_5656_2_sn.geojson` is a legitimately empty
collection). `railarea_33410_5658_2_sn.geojson` holds 2 `MultiPolygon` + 1
`Polygon` features — the loader skips the two MultiPolygons today (plan 011
makes it accept them; this plan's test must accept both types).

### The shader patches and their anchors

`app/_components/visual-style.ts:108-120` (vertex) replaces
`#include <common>`, `#include <beginnormal_vertex>`, `#include <begin_vertex>`;
`:121-187` (fragment) replaces `#include <common>`,
`#include <roughnessmap_fragment>`, `#include <map_fragment>`,
`#include <emissivemap_fragment>`; then `injectHeightFog` when a `heightFog`
is given (`:188-190`). `createStyleResources(heightFog?, night?)` is exported
(`:196`).

`app/_components/terrain-layer.ts:320-336` (`patchTerrainVertex`) replaces
`#include <common>` and `#include <begin_vertex>`; `:338-377`
(`patchTerrainFragment`) replaces `#include <common>`, the literal
`vec4 diffuseColor = vec4( diffuse, opacity );` and, with a splat,
`#include <normal_fragment_begin>`. `createTerrainMaterial(splat?, heightFog?)`
at `:379-405` is **not exported**; it sets `customProgramCacheKey` (`:392-393`).

`app/_components/water-layer.ts:224-294` replaces (vertex) `#include <common>`,
`#include <begin_vertex>`; (fragment) `#include <common>`,
`#include <map_fragment>`, `#include <normal_fragment_begin>`,
`#include <emissivemap_fragment>`; `createWaterLayer(geometry, splat,
sunDirection?, heightFog?)` is exported (`:172`) and needs a `SplatLayer`
(`terrain-layer.ts:210-221`: `texture`, optional `colorTexture`, `bounds`,
`offset`) — plain `new Texture()` objects are enough (no WebGL).

`app/_components/height-fog.ts:78-92`:

```ts
export function injectHeightFog(
  shader: OnBeforeCompileShader,
  uniforms: HeightFogUniforms
): void {
  shader.uniforms.uFogHeightStart = uniforms.uFogHeightStart;
  shader.uniforms.uFogHeightFalloff = uniforms.uFogHeightFalloff;
  shader.uniforms.uFogHeightStrength = uniforms.uFogHeightStrength;
  shader.vertexShader = `varying float vWorldY;
${shader.vertexShader.replace("#include <fog_vertex>", FOG_VERTEX_INJECT)}`;
  shader.fragmentShader = `varying float vWorldY;
uniform float uFogHeightStart;
uniform float uFogHeightFalloff;
uniform float uFogHeightStrength;
${shader.fragmentShader.replace("#include <fog_fragment>", FOG_FRAGMENT_REPLACE)}`;
}
```

A failed `.replace` here leaves an unused varying and no error — the feature
just switches off.

`app/_components/vegetation-layer.ts` has three more `onBeforeCompile`
callbacks (`:385`, `:557`, `:673`); their anchors were not excerpted here —
Step 7 tells you how to enumerate them.

### Conventions

- Unit tests are `bun test` files colocated with the code; they may import
  `three` classes that need no WebGL (`Group`, `Mesh`, `BoxGeometry`,
  `InstancedMesh`, `Texture`, `ShaderLib`). Model new tests on
  `app/_components/visual-style.test.ts` (imports `three`, builds a `Group`,
  asserts on materials) and `lib/city/tfw.test.ts` (plain data test).
- `lib/city/` must stay three-free and DOM-free (`AGENTS.md:52-53`). A test
  file under `lib/city/` may use `node:fs`; the modules may not.
- Lint is ESLint + ultracite (Biome) with a cognitive-complexity cap: keep
  helpers small. Regex literals are allowed inline in `*.test.ts` and `e2e/**`
  (`biome.jsonc:39-66`).
- e2e rules (`AGENTS.md:163-175`): drive the viewer at `/?scene=lite`, share
  the booted page, budget in frames via `waitForFrames`.
- Conventional Commits, e.g. `test: count rendered frames on the debug hook and wait for them in e2e`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Typecheck | `bun typecheck` | exit 0, no errors |
| Unit tests | `bun test` (or `bun test <path>`) | all pass |
| Full gate | `bun run verify` | exit 0 |
| Build | `bun run build` | exit 0 (runs `prepare-data.ts` first) |
| E2E | `bun run test:e2e` | all pass; requires a production build (the config builds one if nothing listens on :3000) |
| E2E, one spec | `bunx playwright test e2e/city-walk.spec.ts` | all pass |

## Suggested executor toolkit

- Load the `city-walker` skill (`.claude/skills/city-walker/SKILL.md`) for
  the scene architecture and the e2e frame-budget rules before Step 2.

## Scope

**In scope** (the only files you should modify or create):

- `e2e/city-walk.spec.ts`
- `playwright.config.ts`
- `.github/workflows/ci.yml`
- `package.json` (one new script)
- `bunfig.toml` (create)
- `app/_components/create-app.ts` (only `CityWalkStats` and `emitStats`)
- `app/_components/poc-debug.ts` (only `PocDebugInfo`)
- `app/_components/scene-census.ts` (create) + `scene-census.test.ts` (create)
- `lib/city/tile.test.ts` (create — fixture integrity)
- `lib/city/purity.test.ts` (create)
- `app/_components/shader-patches.test.ts` (create)
- `app/_components/terrain-layer.ts` (only: export `createTerrainMaterial`)
- `app/_components/vegetation-layer.ts` (only: export the crown/trunk material builders)
- `AGENTS.md` lines 147–149 and `.claude/skills/city-walker/SKILL.md` lines 149–151 (the harness command)

**Out of scope** (do NOT touch, even though they look related):

- `e2e/snapshot-shot.spec.ts` — it stays as is; only the config decides when it runs.
- `app/_components/rail-layer.ts` — the MultiPolygon fix is plan 011.
- Any loader's fetch/abort behaviour — plan 010.
- `lib/city/tile.ts` itself — plan 010 adds the artifact map there; this plan's test names the files explicitly so it can run first.
- `components/ui/**`, `.agents/**`, `data/**`.

## Git workflow

- Branch: `advisor/008-verification-net` (or the branch the operator names).
- One commit per step; Conventional Commits, `test:`/`ci:` prefixes.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fail (not skip) when WebGL is missing on CI, and check errors in `afterAll`

In `e2e/city-walk.spec.ts`:

1. In `beforeAll` (`:159-174`), right after `webgl = await hasWebGl(page);`
   add:

   ```ts
       // On CI the SwiftShader flags above must yield WebGL; a silent skip
       // would let a Chromium/Playwright bump turn the whole suite green.
       if (process.env.CI) {
         expect(webgl).toBe(true);
       }
   ```

   Keep the existing `if (!webgl) return;` and the `beforeEach` skip for
   local runs.
2. Apply the same two-line guard in the mobile test right after its
   `const webgl = await hasWebGl(page);` (`:424`).
3. Change `afterAll` (`:181-183`) to:

   ```ts
     test.afterAll(async () => {
       if (webgl) {
         expectNoErrors(errors);
       }
       await page?.context().close();
     });
   ```

**Verify**: `bun lint && bun typecheck` → exit 0.
`bunx playwright test e2e/city-walk.spec.ts` → all tests pass (WebGL is
available under the SwiftShader flags).

### Step 2: Add a scene census and expose per-layer stats on `__poc`

1. Create `app/_components/scene-census.ts`:

   ```ts
   import { InstancedMesh, type Mesh, type Object3D } from "three";

   /** Counts of what a set of scene roots actually contain (built, not rendered). */
   export interface SceneCensus {
     /** InstancedMesh instances (sum of `count`) */
     instances: number;
     /** Mesh + InstancedMesh objects */
     meshes: number;
     /** triangles, with instanced geometry multiplied by its instance count */
     triangles: number;
   }

   function triangleCount(mesh: Mesh): number {
     const geometry = mesh.geometry;
     const index = geometry.getIndex();
     const vertices = index ? index.count : geometry.getAttribute("position")?.count ?? 0;
     return Math.floor(vertices / 3);
   }

   export function sceneCensus(roots: Object3D[]): SceneCensus {
     const census: SceneCensus = { instances: 0, meshes: 0, triangles: 0 };
     for (const root of roots) {
       root.traverse((obj) => {
         const mesh = obj as Mesh;
         if (!mesh.isMesh) {
           return;
         }
         census.meshes += 1;
         const tris = triangleCount(mesh);
         if (obj instanceof InstancedMesh) {
           census.instances += obj.count;
           census.triangles += tris * obj.count;
         } else {
           census.triangles += tris;
         }
       });
     }
     return census;
   }
   ```

2. Create `app/_components/scene-census.test.ts` (model on
   `visual-style.test.ts`): a `Group` with one `Mesh(new BoxGeometry())`
   (12 triangles) and one `InstancedMesh(new BoxGeometry(), material, 5)`
   → `{ meshes: 2, instances: 5, triangles: 12 + 60 }`; an empty group →
   all zeros; a group containing only a `Points` object → all zeros.
3. In `create-app.ts`, extend `CityWalkStats` (`:98-102`):

   ```ts
   export type LayerName =
     | "city"
     | "terrain"
     | "water"
     | "vegetation"
     | "lamps"
     | "rail"
     | "walls";

   export interface CityWalkStats {
     buildingCount: number;
     /** what each layer actually built — the e2e suite asserts on these */
     layerStats: Record<LayerName, SceneCensus>;
     shadowsEnabled: boolean;
     terrainVertexCount: number;
   }
   ```

   and in `emitStats` (`:981-987`) add:

   ```ts
       layerStats: {
         city: sceneCensus([cityLayer.group, ...extraCities.map((c) => c.group)]),
         terrain: sceneCensus(terrains.map((t) => t.mesh)),
         water: sceneCensus(
           terrains.flatMap((t) => (t.water ? [t.water.mesh, t.water.mistMesh] : []))
         ),
         vegetation: sceneCensus(vegControls.map((v) => v.group)),
         lamps: sceneCensus(lampControls.map((l) => l.group)),
         rail: sceneCensus(railControls.map((r) => r.group)),
         walls: sceneCensus(wallControls.map((w) => w.group)),
       },
   ```

   Import `sceneCensus` and `SceneCensus` from `./scene-census`.
4. In `poc-debug.ts`, add to `PocDebugInfo` (alphabetical position, after
   `insertBuilding`):

   ```ts
     /** Per-layer build census (meshes / instances / triangles), refreshed with the stats. */
     layerStats?: Record<LayerName, SceneCensus>;
   ```

   with `import type { LayerName } from "./create-app"` (the file already
   imports types from there) and `import type { SceneCensus } from "./scene-census"`.

**Verify**: `bun test app/_components/scene-census.test.ts` → 3 pass.
`bun run verify` → exit 0.

### Step 3: Assert every layer is built and that demolish changes the mesh

In `e2e/city-walk.spec.ts`, add a new test **directly after** "renders
buildings, terrain and shadows" (it is read-only, so it must precede the
mutating tests):

```ts
  test("every scene layer is built on the primary tile", async () => {
    // Counts come from what each loader actually put in the scene graph, so a
    // renamed GeoJSON property, a 404 or a thrown builder — all of which the
    // loaders swallow into an empty group — fails here instead of passing.
    const stats = await page.evaluate(() => window.__poc?.layerStats);
    expect(stats).toBeDefined();
    if (!stats) {
      return;
    }
    expect(stats.city.triangles).toBeGreaterThan(0);
    expect(stats.terrain.meshes).toBe(1); // lite = primary tile only
    expect(stats.water.meshes).toBeGreaterThanOrEqual(1);
    // 5 118 canopy points + 25 tree rows on 33412_5656 (trunk + two crowns each)
    expect(stats.vegetation.instances).toBeGreaterThan(1000);
    // 339 OSM lamps: posts + heads + decals are instanced
    expect(stats.lamps.instances).toBeGreaterThan(100);
    // 3 bridges, 1 ballast yard, 21 platforms (this tile has no rail lines)
    expect(stats.rail.triangles).toBeGreaterThan(0);
    // 292 wall lines
    expect(stats.walls.triangles).toBeGreaterThan(0);
    expectNoErrors(errors);
  });
```

In "demolishes the building under the crosshair" (`:273-330`), capture
`const trianglesBefore = await page.evaluate(() => window.__poc?.layerStats?.city.triangles ?? 0);`
next to `buildingsBefore`, and after the existing `waitForFunction` on
`buildingCount` add:

```ts
    const trianglesAfter = await page.evaluate(
      () => window.__poc?.layerStats?.city.triangles ?? 0
    );
    expect(trianglesAfter).toBeLessThan(trianglesBefore);
```

**Verify**: `bunx playwright test e2e/city-walk.spec.ts` → all pass,
including the new test. If the vegetation/lamps thresholds fail, read the
actual numbers from the failure and lower the threshold only if the count is
clearly the real layer (e.g. 5 000 instances vs. an expected 1 000); a zero
is a STOP.

### Step 4: Screenshots on failure, and make the snapshot harness opt-in

1. `playwright.config.ts` — in `use` replace `trace: "on-first-retry"` with:

   ```ts
       screenshot: "only-on-failure",
       trace: "retain-on-failure",
   ```

   and add, next to `testDir`:

   ```ts
     // The --headed snapshot harness renders every shots/*.json at the full
     // profile and overwrites the PNGs; it only runs when asked for.
     testIgnore: process.env.SHOTS ? [] : ["**/snapshot-shot.spec.ts"],
   ```

2. `package.json` scripts — add
   `"shots": "SHOTS=1 playwright test e2e/snapshot-shot.spec.ts --headed"`.
3. Replace the harness command in `AGENTS.md:147-149` and
   `.claude/skills/city-walker/SKILL.md:149-151`
   (`bunx playwright test e2e/snapshot-shot.spec.ts --headed`) with
   `bun run shots`, keeping the surrounding prose.

**Verify**: `bunx playwright test --list` → lists only `city-walk.spec.ts`
tests. `SHOTS=1 bunx playwright test --list` → additionally lists
`snapshot-shot.spec.ts` (zero tests when `shots/` has no JSON — that is
fine). `bun lint` → exit 0.

### Step 5: Widen the CI e2e gate and publish unit coverage

1. `.github/workflows/ci.yml:96-99` — extend the path list to:

   ```yaml
              app components hooks lib e2e public types scripts data patches \
              playwright.config.ts next.config.ts tsconfig.json postcss.config.mjs \
              package.json bun.lock \
   ```

   and update the comment above it (`:79-82`) so it no longer says the data
   pipeline scripts are out of scope.
2. Create `bunfig.toml`:

   ```toml
   [test]
   coverageSkipTestFiles = true
   coverageReporter = ["text", "lcov"]
   coverageDir = "coverage"
   ```

3. In the `unit` job of `ci.yml`, change `- run: bun run test` to
   `- run: bun run test:coverage` and add after it:

   ```yaml
         - uses: actions/upload-artifact@v7
           if: always()
           with:
             name: unit-coverage
             path: coverage/
             retention-days: 7
   ```

**Verify**: `bun run test:coverage` → all tests pass and a coverage table
prints; `ls coverage/lcov.info` exists. `git diff .github/workflows/ci.yml`
shows only the two edits.

### Step 6: Fixture-integrity test over the committed tile data

Create `lib/city/tile.test.ts` (a data test — it may use `node:fs`; model
the style on `lib/city/tfw.test.ts`). Requirements:

- `const DATA = join(import.meta.dir, "../../data")`.
- For every `spec` in `TILE_BLOCK`, assert these files exist:
  `cityjson/lod2_<tile>.city.json`, `dlm/landcover_<tile>.png`,
  `dlm/landcover_rgb_<tile>.png`, `dlm/vegrows_<tile>.geojson`,
  `dlm/canopy_<tile>.geojson`, `dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif`,
  `dgm/dgm1_<tile>_tiff/dgm1_<tile>.tfw`.
- For every GeoJSON in the table below that exists, `JSON.parse` it, assert
  `type === "FeatureCollection"` and `Array.isArray(features)`, and for every
  feature assert the geometry type is in the accepted set and the listed
  properties have the listed types. Missing optional files are fine.

  | prefix | accepted geometry types | property checks |
  |---|---|---|
  | `vegrows_` | `LineString` | `properties` null or `kind` ∈ {`hedge`,`treerow`} |
  | `canopy_` | `Point` | `properties` null or `h` is a finite number |
  | `lamps_` | `Point` | `h` absent or a finite number |
  | `walls_` | `LineString` | `kind` string, `h` finite number |
  | `rail_` | `LineString` | `tracks` finite number |
  | `bridge_` | `Polygon` | `deck` array of finite numbers with `length >= coordinates[0].length`; `kind` ∈ {`rail`,`road`,`path`,`other`} |
  | `railarea_` | `Polygon`, `MultiPolygon` | — |
  | `platform_` | `Polygon`, `MultiPolygon`, `LineString` | — |

- Assert the collections that must not be empty are not: `canopy_` and
  `vegrows_` for every tile. Record the known-empty file explicitly:
  `expect(features("rail_33412_5656_2_sn").length).toBe(0)` with a comment
  that this tile has no Basis-DLM heavy rail — so a future bake that
  produces rails there is a deliberate change, not a silent one.
- `dop/roofcolor_<tile>.json`, if present: `roofs` is an object whose values
  are `[number, number, number]`.

Keep each check in a small helper (`readJson`, `checkCollection`) so the
complexity cap is not hit. Use `test.each(TILE_BLOCK)`.

**Verify**: `bun test lib/city/tile.test.ts` → passes on the committed data
(8 files × 4 tiles are checked). Temporarily rename one property in a copy of
the data is NOT allowed (never modify `data/`); instead, prove the test bites
by pointing `DATA` at a scratch directory containing one deliberately broken
GeoJSON, run once, then revert that local change before committing.

### Step 7: Pin the shader anchors

1. Export the material builders the test needs: in `terrain-layer.ts` change
   `function createTerrainMaterial(` (`:379`) to
   `export function createTerrainMaterial(`. In `vegetation-layer.ts` find the
   functions that contain the `onBeforeCompile` assignments at `:385` and
   `:557` (run `grep -n "onBeforeCompile\|^function \|^export function " app/_components/vegetation-layer.ts`)
   and export them. If either takes anything other than plain objects /
   `{ value }` uniform refs / `Vector3`, STOP and report the signature.
2. Create `app/_components/shader-patches.test.ts`. Structure:

   ```ts
   import { expect, test } from "bun:test";
   import { BufferGeometry, ShaderLib, Texture, Vector3, type WebGLRenderer } from "three";
   import { createHeightFogUniforms, injectHeightFog } from "./height-fog";
   import { createTerrainMaterial } from "./terrain-layer";
   import { createStyleResources } from "./visual-style";
   import { createWaterLayer } from "./water-layer";
   // + the exported vegetation builders

   interface PatchedShader {
     fragmentShader: string;
     uniforms: Record<string, { value: unknown }>;
     vertexShader: string;
   }

   /** Runs a material's onBeforeCompile against a copy of ShaderLib.standard. */
   function patchStandard(
     onBeforeCompile: (shader: PatchedShader, renderer: WebGLRenderer) => void
   ): PatchedShader {
     const shader: PatchedShader = {
       vertexShader: ShaderLib.standard.vertexShader,
       fragmentShader: ShaderLib.standard.fragmentShader,
       uniforms: {},
     };
     onBeforeCompile(shader, undefined as unknown as WebGLRenderer);
     return shader;
   }
   ```

   `material.onBeforeCompile` is typed against three's parameter type; pass it
   through `as unknown as (shader: PatchedShader, renderer: WebGLRenderer) => void`
   with a `// reason:` comment — the callbacks only read/write the three
   string/uniform fields.
3. Tests to write:
   - **Anchors exist upstream**: for each anchor string listed in "Current
     state" (the eight `#include <…>` names, the literal
     `vec4 diffuseColor = vec4( diffuse, opacity );`, `#include <fog_vertex>`,
     `#include <fog_fragment>`) assert it occurs in
     `ShaderLib.standard.vertexShader` or `.fragmentShader` as appropriate.
     Add every anchor you find in the vegetation builders
     (`grep -n '\.replace(' app/_components/vegetation-layer.ts`).
   - **Clay**: `patchStandard(createStyleResources(createHeightFogUniforms(), { value: 0 }).clay.onBeforeCompile …)` →
     vertex contains `vLocalH` and `vClayWN`; fragment contains
     `uRoofVibrance`, `clayFres`, `uFogHeightStrength`; fragment does not
     contain `#include <fog_fragment>`; vertex does not contain
     `#include <fog_vertex>`; `uniforms.uTint` is the same object as
     `resources.clayDetail.uTint`.
   - **Terrain with splat**: build a `SplatLayer`
     `{ texture: new Texture(), colorTexture: new Texture(), ndviTexture: new Texture(), meadowNdvi: { value: 0.5 }, bounds: [0, 0, 2000, 2000], offset: { cx: 0, cy: 0 } }`,
     `createTerrainMaterial(splat, createHeightFogUniforms())` → fragment
     contains `vSplatUv`, `grMeadow`, `uMeadowNdvi`, `uFogHeightStrength` and
     does not contain `vec4 diffuseColor = vec4( diffuse, opacity );`;
     `material.customProgramCacheKey()` equals `"terrain-true-true-true-true"`.
     **Terrain without splat**: fragment contains `vElevation`, not `vSplatUv`.
   - **Water**: `createWaterLayer(new BufferGeometry(), splat, new Vector3(0, 1, 0), createHeightFogUniforms())` →
     patch `layer.mesh.material.onBeforeCompile`; fragment contains
     `waterCoverage(`, `wtrFres`, `uFogHeightStrength`; vertex contains
     `vWaterWP`; `customProgramCacheKey()` is `"water-true"`.
   - **Height fog alone**: `injectHeightFog` on a copy of `ShaderLib.standard`
     → `vWorldY` appears in both shaders, `#include <fog_fragment>` is gone,
     and the `uniforms.uFogHeightStart` reference is the object passed in.
   - **Vegetation**: for each exported builder, at least one injected marker
     per patch and the absence of each replaced anchor.

**Verify**: `bun test app/_components/shader-patches.test.ts` → all pass.
`bun run verify` → exit 0.

### Step 8: Guard `lib/city` purity

Create `lib/city/purity.test.ts`:

```ts
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// lib/city is the three-free, DOM-free half of the viewer (AGENTS.md); this
// keeps it that way so every module here stays unit-testable under bun.
const DIR = import.meta.dir;
const sources = readdirSync(DIR).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts")
);

test.each(sources)("%s imports no three.js and touches no DOM", (file) => {
  const text = readFileSync(join(DIR, file), "utf8");
  expect(text).not.toMatch(/from ["']three(\/|["'])/);
  expect(text).not.toMatch(/\b(document|window|navigator)\./);
});
```

**Verify**: `bun test lib/city/purity.test.ts` → all pass (there are ~20
source files). `bun run verify` → exit 0.

## Test plan

- New: `scene-census.test.ts` (3 cases), `lib/city/tile.test.ts`
  (fixture integrity, table-driven over `TILE_BLOCK`), `shader-patches.test.ts`
  (anchors upstream + one test per patched material), `lib/city/purity.test.ts`.
- Changed e2e: WebGL fail-on-CI guards, `afterAll` error check, the layer
  census test, the demolish triangle assertion.
- Verification: `bun run verify` → all unit tests pass (the previous count was
  125 + the new files); `bun run test:e2e` → 9 tests pass (8 before + 1 new).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run verify` exits 0
- [ ] `bun run build` exits 0
- [ ] `bun run test:e2e` exits 0 and the run includes "every scene layer is built on the primary tile"
- [ ] `bunx playwright test --list` does not list `snapshot-shot.spec.ts`; `SHOTS=1 bunx playwright test --list` does
- [ ] `grep -n "scripts data patches" .github/workflows/ci.yml` matches the gate's path list
- [ ] `grep -n "expect(webgl).toBe(true)" e2e/city-walk.spec.ts` returns 2 matches
- [ ] `grep -n "layerStats" app/_components/create-app.ts app/_components/poc-debug.ts e2e/city-walk.spec.ts` returns matches in all three files
- [ ] `test -f bunfig.toml && test -f lib/city/tile.test.ts && test -f lib/city/purity.test.ts && test -f app/_components/shader-patches.test.ts`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts.
- Step 3's layer census reports **zero** for any layer under the lite profile
  (that is a real missing layer, not a threshold problem).
- Step 6 finds a committed file whose geometry or property types are outside
  the table for a reason other than the two documented cases (empty
  `rail_33412_5656_2_sn.geojson`, MultiPolygon ballast in `33410_5658`).
- Step 7: an anchor listed in "Current state" is absent from
  `ShaderLib.standard` (that means `three` moved — report which one), or a
  vegetation builder cannot be called without WebGL objects.
- `bun run test:e2e` fails twice after a reasonable fix attempt.
- Any step appears to require touching an out-of-scope file.

## Maintenance notes

- **Adding a layer**: add a `LayerName` and a census line in `emitStats`,
  and an assertion in the e2e layer test. Adding a GeoJSON artifact: add a
  row to `lib/city/tile.test.ts`. Adding a shader patch: add its anchors to
  `shader-patches.test.ts`. Reviewers should reject a PR that adds one of
  these without the matching test.
- Plan 010 moves the artifact file names into `lib/city/tile.ts`; when it
  lands, `tile.test.ts` should derive its file list from that map instead of
  the literals here (010 says so).
- Plan 011 makes the rail loader accept `MultiPolygon`; this test already
  accepts it, so no change is needed then.
- The coverage report is published, not enforced. A threshold is a maintainer
  decision once a baseline number exists.
- Deferred on purpose: unit tests for the pure rail/vegetation/lamp/wall
  helpers, the collider, and camera-pose math (see `plans/README.md`
  "deferred" list) — this plan builds the net; those fill it in.
