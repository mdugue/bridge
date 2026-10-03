# Completed plans — condensed records

What each executed plan set out to do, what came of it, and the knowledge
worth keeping: decisions, numbers, invariants, dead ends. The full plan
texts (step lists, verification commands, drift checks, line references)
were execution-time material and were removed when the plans moved into
`docs/`; they remain in git history at commit `761d609` under `plans/`.
Decisions that constrain future work are also written up as
[ADRs](../adr/README.md); the ones cited below are the primary record.

---

## 001 — Test baseline and real e2e frames · DONE (PR #18)

**Problem.** CI was green but hollow: `bun test ./lib` ignored every test
under `app/`; the e2e "style burst" fired 23 setters in one synchronous
evaluate and slept 500 ms, so under SwiftShader (a frame can exceed 500 ms)
only the last value per setter reached a frame; no single command ran what
CI runs.

**Outcome.** `bun run verify` = lint + typecheck + unit, mirroring CI.
Rendered frames are counted on `__poc.frames` (`tickPocFrame()` is the last
statement of the loop) and specs wait with `waitForFrames`; `waitForTimeout`
is banned. `__poc.ready` flips only after every handle method is installed.
The burst became 21 frame-gated steps driven by index inside the
browser-side function (Playwright cannot serialise closures).

**Keep in mind.**
- Always pass directories to `bun test` (`bun test ./lib ./app ./scripts`):
  Bun matches `*.spec.*`, so a bare `bun test` loads the Playwright specs
  and crashes on `@playwright/test`.
- three.js units run headless under Bun: `createStyleResources()` builds
  materials without a GL context; `Material.needsUpdate` is a write-only
  setter, so tests assert on `material.version`.
- Movement constants: walk 9 m/s, sprint ×3, fly 35 m/s; a camera looking
  −Z has +X on its right.

See [ADR 0018](../adr/0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md).

## 002 — Render-loop quick wins · DONE (PR #18)

**Problem.** Four per-frame wastes: the DoF autofocus ray brute-forced
~522 k terrain triangles at 10 Hz (48 ms per ray; 0.04 ms with a BVH that
costs 198 ms to build once), the shadow map was redrawn every frame, the
"ghost" style re-rendered the scene at full resolution, and an MSAA
backbuffer was resolved for a full-screen quad no scene pixel used.

**Outcome.** Terrain BVH at load; shadow map on demand with
`invalidateShadows()` as the single entry point (the gate lives on the
light, `sun.shadow.autoUpdate`, because the rig re-renders from inside the
loop); `antialias: false` — SMAA in the composer is the anti-aliasing;
demolish picks with a hoisted `Raycaster` and `firstHitOnly` (stops the BVH
walk at the nearest hit). The transmission and stashed-material items are
moot since the ghost style was removed.

**Keep in mind.** A missed `invalidateShadows()` is a stale shadow, never a
crash — reviewers grep for it. If shadows go stale, never revert to
`autoUpdate = true`. The synchronous terrain BVH at boot has since grown to
~3.6 M triangles (≈1–1.5 s) — a heightfield ray-march would replace it
(backlog).

See [ADR 0009](../adr/0009-shadow-recipe.md).

## 003 — CityJSON-derived ink edges · REJECTED

**Problem.** Building outlines were built by welding the loader's GPU mesh
and running `EdgesGeometry`: ~1,070 ms at boot and ~650 ms per demolish.

**Outcome.** PR #16 removed outlines entirely (hard edges clash with the
watercolour look), so the plan lost its target. Its design is kept in case
outlines return: derive edges from the CityJSON polygon rings (shared
vertices, Newell normals, crease test at 30°), one group-level
`LineSegments` with `renderOrder = 1` and a no-op `raycast`; the prototype
produced 88,228 segments in 85 ms against 92,143 from `EdgesGeometry`.
City meshes live in the recentred Z-up data frame — anything added to the
city group must use that frame.

See [ADR 0010](../adr/0010-opaque-clay-buildings-only.md).

## 004 — Build-time heightfield · DONE (PR #25, format v2 in PR #28)

**Problem.** Every load fetched the 13.6 MB DGM GeoTIFF (12.6 MB gzipped —
float noise) and resampled it on the main thread (632 ms under Bun).

**Outcome.** `prepare-data.ts` bakes an n×n bilinear resample (1024²
primary, 512² neighbours) — since v2 quantised to centimetre `uint16`,
`0xFFFF` = NoData, pre-gzipped (a 1024² tile 4 MB → ~1.1 MB on the wire;
static hosts do not compress binary MIME types) — plus a validated JSON
header (`data` must be a bare sibling name). `geotiff` left the client
bundle. NoData vertices sit at the mean valid elevation, not 0, so the
bounding box the shadow camera and spawn fallback use is not dragged 110 m
underground. Row 0 = north; little-endian assumed on both sides.

**Keep in mind.** Bump `HEIGHTFIELD_VERSION` on any layout change; the bake
also re-runs when its own source files change. The e2e minimap-teleport
assertion (≈412,500 E / 5,657,500 N) fails if bounds or row order are
wrong — fix the data, not the test.

See [ADR 0003](../adr/0003-bake-heavy-inputs-at-build-time.md).

## 005 — Input and collision correctness · DONE (PR #25)

**Problem.** Keys stuck after focus loss; `R` repeated on key-repeat (each
repeat re-parsing the tile); diagonal input moved √2× and key + joystick
2× faster than walking; a stale pinch baseline when a third finger lifted;
the inserted building had no collision and leaked if its glTF resolved
after `dispose()`; a failed boot leaked post-stack targets and listeners.

**Outcome.** Keys and stick are summed into one vector, clamped to unit
length, then scaled by the step (sub-unit stick input is not normalised
up). `releaseAll()` on window blur and tab hide; `keydown` ignores
`e.repeat`. The pinch baseline re-anchors whenever exactly two pointers
remain. The collider takes `getTargets()` so inserted models join
collision and autofocus. Every boot-time disposable pushes onto a
`cleanups` list that both the boot `catch` and `dispose()` run in reverse;
`dispose()` is idempotent.

**Keep in mind.** "The collider can lock the player inside a building" is
not a bug: all city materials are `FrontSide`, the ray never hits back
faces, a teleport inside a shell walks out — do not add back-face
handling. The step-2 "ignore keyup from text fields" filter was itself a
bug (finding #40) and was fixed by plan 011.

## 006 — Scaffold cleanup, dependencies, README · DONE (PR #25)

**Problem.** The repo was bootstrapped from an unrelated project
("activity-card") and never re-pointed: dead dependencies (`@giro3d/giro3d`
pulled 40 packages, `recharts` 42), lint overrides for missing files, four
Google fonts with a duplicated `--font-heading`, a create-next-app README,
`bun-version: latest` in five CI places.

**Outcome.** Package renamed `bridge`; zero-import dependencies removed;
`components/ui` pruned to the *computed* reachable set (16 of 55 files) with
their dependencies; two fonts; the Bun version comes from `packageManager`
via `bun-version-file`; one Dependabot group for the three.js stack
(`postprocessing` caps `three`, so the group PR needs a manual WebGL
smoke); README rewritten from verified facts with a provenance TODO — now
resolved by the guide's dataset table except for four unrecorded dates.

**Keep in mind.** Never hand-edit `bun.lock`; the `shadcn` package must
stay installed because `app/globals.css` imports `shadcn/tailwind.css`;
a shadcn component and its dependency are added and removed together.

## 007 — Adaptive quality while the camera moves · DONE (PR #25; step 4 open; amended)

**Problem.** Post-processing is paid every frame, including while moving,
when the eye cannot resolve bokeh or fine contact shadows.

**Outcome.** A pure debounce (`lib/city/regression.ts`): regress on the
first moving frame, recover after 250 ms of stillness; motion detected
from the camera transform so every input path is caught. Slider intent
and regression are separate layers; only `applyPassGating()` writes
`.enabled`. **Amended after shipping:** SSAO is no longer gated — the
contact shadows blinked on every footstep — and runs permanently at half
resolution; only DoF is dropped. `regressed` is on `__poc`.

**Open.** Step 4, a pixel-ratio drop under motion: `setPixelRatio`
reallocates every render target, so it needs a ~1 s hold before restoring
and a real-GPU look.

See [ADR 0011](../adr/0011-motion-keyed-quality-regression.md).

## 008 — The verification net · DONE in part (2026-09-24; step 7 moot; closed: the rest moved to plans 037 (coverage) and 041 (fixture checks))

**Problem.** The headless e2e could pass with nothing rendered: a missing
WebGL *skipped* every render test, the "renders" test asserted a flag set
unconditionally at boot, no test looked at vegetation, lamps, rail, walls
or water (every loader swallows a failure into an empty group), demolish
was judged on the filtered document rather than the mesh, no test read
`data/**`, and the CI e2e gate ignored `scripts/`, `data/` and `patches/`.

**Outcome.** On CI (`process.env.CI`) a missing WebGL fails; locally it
still skips, and `afterAll` checks for page errors. A **scene census**
(`app/_components/scene-census.ts`: meshes, instances as the sum of each
`Instances` set's `drawCount`, triangles × instances, per `LayerName`) is
exposed on `__poc.stats.layerStats`; the e2e asserts every layer of the
lite spawn tile (city, terrain = 1 mesh, water, vegetation > 1 000
instances, low vegetation, lamps, monuments, furniture, rail, tram,
riverside, walls, fences) and that demolish shrinks `city.triangles`.
Failure screenshots and traces are kept; the `--headed` shot harness is
opt-in (`SHOTS=1` / `bun run shots`) so a default run never overwrites
real-GPU plates. `lib/city/purity.test.ts` keeps `lib/city` free of `three`
and the DOM. `lib/city/features.ts` holds the data contracts and
`features.test.ts` checks every committed GeoJSON of every tile against
them. The CI e2e diff list now includes `scripts data sites patches
tsconfig.json postcss.config.mjs`. Step 7 (pinning the `onBeforeCompile`
anchors) became moot with the WebGPU/TSL port: a look term is a typed node
expression, and the layers' units assert the node setup instead.

Most of step 6's existence checks landed with `lib/city/tile-data.test.ts`:
every tile of the site carries every artifact the viewer reads
(`tileArtifacts`, the landcover raster among them) and every bake input
(the CityJSON, `roofcolor_`, `osmbuild_`, `smallbuild_`, the DGM `.tif` +
`.tfw`, the wall, kerb, stair and terrace sources); any kind of baked file
one tile has, every tile has (the landcover legend included); and no baked
file names a tile outside the site. `MAY_LACK` is empty — "not baked yet"
is never a reason.

**Keep in mind.** A new layer needs a `LayerName` (`create-app.ts`), a
census line and an e2e assertion; a new GeoJSON artifact a contract row in
`features.ts` and its test. `CityWalkStats` fields reach `__poc` by
themselves, but `PocDebugInfo` needs the typed member. Never edit `data/`
to prove a test bites — point the test's data root at a scratch copy. The
plan's pin "`rail_33412_5656` has 0 features" is obsolete: seven of the
fifteen rail files are legitimately empty.
Open: the coverage artifact — a `bunfig.toml` (`coverageSkipTestFiles`,
text + lcov into `coverage/`), `bun run test:coverage` in the `unit` job,
`coverage/` uploaded as an artifact for 7 days; publish, never enforce
(plan 037).
Open: the remaining fixture checks — canopy and vegrows non-empty per
tile, `bridge.kind` ∈ {rail, road, path, other}, `rail.tracks` finite,
`roofcolor_<tile>.json` shaped `{ meta, roofs: Record<id, [r, g, b]> }`,
`type === "FeatureCollection"` on every GeoJSON (plan 041). All hold on the
committed data today; nothing pins them.

See [ADR 0018](../adr/0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md)
and [ADR 0027](../adr/0027-webgpu-renderer-and-tsl.md).

## 009 — Shadow refresh dead zone · DONE

**Problem.** The 3072² shadow map was re-rendered on essentially every
moving frame: the camera-following frustum re-centred whenever its
texel-snapped centre (220 m / 3072 ≈ 0.072 m) changed, and walking moves
0.15 m per frame.

**Outcome.** The frustum holds until the camera drifts a dead zone (20 m at
the base; now 18 % of the altitude-fitted half-size), then re-centres and
texel-snaps — ~60 → ~0.45 re-renders per second while walking (≈100×). The
crown LOD swap reports its flips so the loop invalidates the map (both
crowns cast). `shadowRenders` is counted on `__poc` (read before
`postStack.render`, because three clears `needsUpdate` after drawing) and
the e2e asserts `shadowRenders < frames / 2` while walking. The vegetation
step moved into a `stepVegetation` helper for the complexity cap.

**Keep in mind.** Keep the dead zone ≤ ¼ of the shadow radius; keep the
vertical component in the re-centre test (ascending straight up shifts the
depth slice). `shadowRenders ≈ frames` means something sets `needsUpdate`
every frame — find the caller. Open: biasing the eye-level centre 20–30 m
ahead along the view so long low-sun shadows clip less (the altitude fit
only pushes ahead above the base radius).

See [ADR 0009](../adr/0009-shadow-recipe.md).

## 010 — Tile artifact map and parallel loads · DONE

**Problem.** `lib/city/tile.ts` named 3 of 15 artifacts; the rest were
template literals in two places and four were derived at runtime by string
replacement, degrading silently to "feature off" on a typo. Three abort
policies across loaders; walls fetched and parsed twice per tile; ~34
dependent round trips (~21 MB gzipped) awaited serially at boot.

**Outcome.** `tileArtifacts(spec)` is the one map (name, source,
`required`, resample), consumed by `prepare-data.ts` and the client and
pinned by `tile.test.ts`; `CityWalkOptions.primary: TileSrc` replaced nine
`*Src` fields. One `fetch-optional.ts`: required artifacts throw; optional
ones return `null`/`[]` on 404/network/parse and **rethrow aborts** so a
StrictMode-remounted instance stops building from partial data. Walls
fetched once and shared (`wallLinesFrom`). Neighbour documents fetched with
`Promise.all`, parsed in tile order for deterministic meshes.

**Keep in mind.** Reject any new loader that catches everything. The
shared recentre offset must come from the primary's matrix before any
neighbour is parsed. `TextureLoader.loadAsync` cannot take an
`AbortSignal` — splat textures are not abortable.

See [ADR 0006](../adr/0006-tile-block-with-one-primary-and-one-artifact-map.md).

## 011 — Six confirmed defects · DONE

**Outcome.** (1) A pose set from outside — `applyCameraState`,
`teleportTo`, the QA `flyTo` — cancels a scenic glide first, otherwise the
glide overwrote it next frame and its `pendingMode` won; since generalised
into `camera-pose.ts` where every setter cancels. (2) `keyup` always
releases (a never-pressed key is a no-op); only `keydown` is filtered by
`isTextEntry`. (3) The size-only copy check was already moot (content-hashed
publishing). (4) The minimap caches its decoded, recoloured tiles across
renders and computes neighbour footprints once — it used to decode four
4096² PNGs on every demolish and sidebar resize. (5) The rail loader guards
`properties: null` and accepts `MultiPolygon` (two of three ballast yards
on `33410_5658` were silently missing). (6) A WebGL2 preflight probe shows
a plain-language message; it lives in a `useState` initializer because the
React Compiler lint forbids `setState` in an effect body.

**Keep in mind.** Any future code that sets the pose from outside the
movement system (tour mode, URL state) must cancel the glide. A tile
switcher must clear the minimap decode cache. Playwright specs cannot
import app modules (the viewpoint is pasted literally). Still open, minor:
the joystick releases on any `pointerup` regardless of `pointerId`;
`dispose()` leaves textures and the shadow map to the GC;
`worldBounds.min.y` includes the 30 m skirt.

## 012 — Look-controls table and Snapshot contract · DONE

**Problem.** 21 sliders hand-wired in six places (~16 edits in 4–5 files per
new slider; 35 of 96 commits touched the three core files together); a
pasted Snapshot was applied after checking only `camera.pos.x`, yielding
NaN camera matrices and `undefined` sliders while reporting success.

**Outcome.** `lib/city/look-controls.ts` is the one pure table; the HUD,
the store (`look-state.ts`), the codec (`snapshot.ts`), the `__poc`
registration and the e2e harness derive from it; each owner applies its
rows through a `Record<…LookKey, …>` the compiler keeps complete.
`parseSnapshot` never throws and validates every field (finite numbers,
enums, parseable date), accepts unknown versions and keys, clamps ranges
in the applier. `useState` count 39 → 19; `SceneControlsProps` 62 → 23. A
fresh handle is re-seeded with the HUD's look through a ref — listing the
look as a boot-effect dependency would reboot the renderer per slider move.

**Keep in mind.** Never rename a `snapshotKey`; `__poc` setter names,
slider DOM ids and labels are the e2e contract; `lib/city` stays three-
and DOM-free because the spec imports it.

See [ADR 0017](../adr/0017-look-controls-table-and-snapshot-contract.md).

## 013 — Toolchain and dependency hygiene · DONE (superseded in part)

**Problem.** Three TypeScript compilers checked the repo; suncalc 2.0
changed units, azimuth origin and export shape; stale type stubs; an
unpinned `npx …@latest` MCP server; the committed agent allowlist
pre-approved `node -e` and `python3 -`.

**Outcome.** One compiler — ultimately TypeScript 7 native with oxlint +
oxfmt replacing ESLint and biome (the plan's TS 6 choice was overtaken).
suncalc 2.0.2 pinned exactly with convention tests (2.x reports degrees
with a north-based azimuth; `sin(az_north) = −sin(az_south)`,
`cos(az_north) = −cos(az_south)` — a mechanical import fix would have
shipped a sun rotated 180°). `geotiff` to devDependencies; `@types/proj4`
and the redundant `three-mesh-bvh` shim removed; `.mcp.json` pinned;
interpreter grants moved to local settings; Dependabot npm cap 5 → 10.

**Keep in mind.** `allowJs` cannot leave `tsconfig.json` (`next build`
re-adds it); every lockfile change ships with its manifest change; only a
human bumps `packageManager`. Not done: `.editorconfig`; closing the
superseded Dependabot PRs is a maintainer action.

See [ADR 0019](../adr/0019-oxlint-oxfmt-and-native-typescript.md).

## 014 — Knowledge-base currency · DONE

**Outcome.** AGENTS.md, the skill, `docs/` and code comments were brought
back in line with the code: the DGM1 GeoTIFF is committed by design (a
contributor following the old "never commit rasters" rule broke `bun dev`);
the cheap crown is a detail-2 icosphere (320 tris) with the rich crown
(~1,440 tris) swapped per chunk — recorded rather than reverted, detail 1
kept as a far-tier option; roof colour is active, transmission and the
Snapshot `style` key are gone; the seven bakes have a documented order;
ODbL credit wherever OSM geometry shows (footer, README, an `attribution`
member in the bakes). Docs locate targets by text, never by line number.

**Still open from this plan.** The two unused `33414_*` DGM tiles (~28 MB)
are committed; `aesthetic-sandbox.html` sits at the repo root; the
platform GeoJSON (written straight by `ogr2ogr`) carries no `attribution`
member; the Basis-DLM package date and the Geofabrik extract timestamp are
unrecorded (`data/provenance.json` has the rest).

## 015 — Progressive first frame · DONE

**Problem.** All-or-nothing boot: ~3.3 s of fetch-and-build on a four-core
localhost before anything showed, of which the primary tile alone was
~1.0 s.

**Outcome.** `bootApp` returns after the primary tile's terrain and
buildings, the sun rig and the post stack; `loadRest()` streams the rest
in order behind a HUD chip; every step `ensureAlive()`s and
`invalidateShadows()`; errors surface via `onError` and never take the
first frame down. The four heightfield headers (~150 B each) are fetched up
front for the sky dome, minimap bounds and fog floor; the lamp-light pool
is allocated before the first frame because three bakes the light count
into every program; the fog far plane is clamped to ~1.1 km until the
block is complete. `__poc.firstFrame` vs `__poc.ready`;
`?scene=lite&block=1` exercises the streaming headless.

See [ADR 0008](../adr/0008-progressive-two-phase-boot.md) and
[ADR 0020](../adr/0020-fixed-light-pool-and-static-shadow-casters.md).

## Aesthetic and visual fine-tuning roadmap · DONE except motes

Ten items for deepening the watercolour look within the fill-rate budget,
all shipped except atmospheric motes (see [open work](./README.md#open-work)):
wind sway (plus an unplanned sway-coupled brightness), water Fresnel /
glitter / feathered shoreline, drifting clouds, golden and blue hour
palette stops, height fog, river mist, meadow mottle (plus the NDVI tint),
shadow-gated translucency, night lighting with OSM lamps. Its slider-wiring
mechanics were superseded by plan 012's table.

**Guiding constraints worth keeping.** Every new term is a wash, not an
edge; features are driven by by-reference `{ value }` uniforms (no
recompile) and screen effects join the trailing `EffectPass`; Y-up things
go on `scene`, anything reusing Z-up terrain geometry (water, mist) on
`world`; light counts and `#define`s are baked into every program, so light
slots stay fixed and booleans gate on uniform floats; a second `.replace`
of an already-substituted chunk silently no-ops; additive terms fight ACES;
`fog: false` for additive points, `depthWrite: false` for mist (else DoF
focuses on the haze), `toneMapped: false` for glow; the crown shimmer
hard-codes `directionalLightShadows[0]`, so lamps never cast shadows.

**Rejected here (now in the ledger).** Cloud shadows and per-frame shadow
updates for sway; a camera-follow grass tuft ring; plain translucency;
selective bloom.

**Numbers.** 6,169 lamps in Dresden on 2026-06-15; default lamp height
5 m; `MAX_REAL_LAMPS = 3`; `nightFactor = smoothstep(2°, −6°)`.

See [ADR 0020](../adr/0020-fixed-light-pool-and-static-shadow-casters.md).

## 016 — `Bun.Image` instead of sharp for the raster downsample · REJECTED (premise gone)

**Problem.** sharp, the build step's only native dependency, existed for
one downsample, and its premultiplied-alpha resize had painted the ground
black when the RGB splat's alpha carried water coverage (fixed in #29 by
resizing colour and alpha separately).

**Outcome.** Overtaken by [ADR 0023](../adr/0023-land-cover-colours-painted-at-runtime.md):
the RGB splat is no longer baked, so no raster whose alpha is data goes
through an image tool. The trap, the split-resize workaround and its
AGENTS.md paragraph are gone. What is left of sharp is a nearest-neighbour
resize of the single-band class raster and the `/wissen` map picture's WebP
encode.

**Keep in mind.** Measured 2026-09-21 (Bun 1.4.2 vs sharp 0.35.4, 4096² →
2048²): `Bun.Image` produced equivalent pixels, but its PNGs were ~21 %
larger for the class raster, because it standardises on RGBA8. Revisit
dropping sharp when `Bun.Image` writes single-band PNG and WebP, or fold
the remaining resize into the Python land-cover bake (Pillow `NEAREST`).

## 018 — Stream tiles around the camera · REJECTED (superseded by ADR 0024)

**Problem.** A fixed 2×2 block loaded at boot and never unloaded. GPU
memory (one 4096² RGBA splat ≈ 85 MB with mips), main-thread cost (terrain
BVH 0.4–1.5 s per tile, canopy builds) and the primary-only collision and
demolish made "more of the city" a boot-cost problem. The plan proposed a
hand-written tile manager with a pure schedule, a loader worker, 1 km near
cells, per-device budgets and KTX2 for the RGB splat. It rejected
3DTilesRendererJS because adopting it "means rewriting every bake".

**Outcome.** Plan 017 was going to rewrite every bake anyway, so the
library won ([ADR 0024](../adr/0024-site-streams-as-3d-tiles.md)). The site
bakes into an OGC 3D Tiles 1.1 tileset: per tile, buildings over terrain at
two levels. 3DTilesRendererJS streams it with screen-space-error LOD, an
LRU cache and the shadow camera as a second camera. Dressing is a renderer
plugin with `disposeTile`, and collision and demolish work on every visible
tile. Phase 7 (KTX2 splat) became moot with ADR 0023, since the colour
splat is painted on the GPU from the 1 B/px class raster. The 1 km cells
(Phase 6) became the two terrain levels. The proposed ADR 0022 was never
accepted.

**Keep in mind.**
- The recenter offset stays one constant from the spawn tile's CityJSON
  matrix. float32 keeps ~1 mm at 10 km and ~4 mm at 50 km from the
  origin; a floating origin only matters beyond ~30 km.
- Anything added after the first frame must re-render the shadow map and
  respect disposal. With streaming it also has to leave again: build it
  in the tile plugin, never in `bootApp`.
- The fixed lamp light pool (ADR 0020) is fed from the visible dressings;
  its size never changes at runtime.
- Class and NDVI rasters stay lossless (ids must be exact, `NEAREST`).

## 020 — WebGPURenderer and TSL node materials · DONE (2026-09-26)

**Problem.** Every custom look was a string patch on three's GLSL chunks
(`onBeforeCompile` + `.replace("#include <…>")`: 15 sites in 7 files when
the plan was written, 26 in 17 files by the 2026-09-26 audit, 33 in 19 at
the port), with `customProgramCacheKey` bookkeeping; a failed replace
switched a feature off with green CI (plan 008 step 7 existed only to
catch that). The post stack was two libraries (`postprocessing`, `n8ao`
with a hand-written type shim) plus two custom effect classes, and height
fog a patch every lit material had to carry. three r186 has the
replacements in the box: node materials, `scene.fogNode`, `GTAONode`,
`DepthOfFieldNode`, `SMAANode`, `RenderPipeline`, `CSMShadowNode`.

**Phase 0 spike** (2026-09-24, Apple Silicon Mac, Chrome, 1600×1000 @2×,
on a throwaway branch). Ported term for term: the clay, terrain, water,
crowns and trunks, the land-cover paint pass, the sky (`SkyMesh`), the lamp
halos, fog as one `scene.fogNode`, the post stack as a `RenderPipeline`.
Frame rate, all effects on, settled (fps):

| View | WebGL + GLSL + postprocessing | WebGPURenderer → WebGL2 | WebGPURenderer → WebGPU |
|---|---|---|---|
| Canaletto (eye level) | 67 | 59 | **94** |
| Über den Dächern | 42 | 30 | **60** |
| Elbe-Panorama (246 m) | 33 | 39 | **50** |
| Carolabrücke (70 m) | 54 | 63 | **98** |
| ready (dev server) | 8.1 s | 18.7 s | **6.3 s** |

WebGPU was 40–80 % faster at the same look and booted faster. The WebGL2
backend was on par in steady state but stalled for seconds whenever new
materials appeared (1.8 fps right after a jump, 43 fps a few seconds
later): it compiles node shaders synchronously, even under
`compileAsync`. Stalls on a 56 s flight over eight viewpoints:

| | frames > 100 ms | > 500 ms | total stalled |
|---|---|---|---|
| WebGL, before | 6 | 2 | 2.4 s |
| WebGL, with `compileAsync` + no terrain BVH | **0** | 0 | **0 s** |
| WebGPU, before | 21 | 4 | 7.8 s |
| WebGPU, with both | 5 | 2 | 2.4 s |
| WebGPURenderer → WebGL2, with both | 69 | 24 | 55 s |

Both fixes landed on `main` before the port (`PostStack.compile`,
`lib/city/ground-ray.ts`). What remained on WebGPU (two tasks of
0.6–1.2 s early in a flight) was the **first shadow render of newly
landed content**: the profile's longest task sits in
`render › updateBefore › render`, the shadow pass creating its render
objects and pipelines for the new casters — `compileAsync` primes only the
main pass. Neither geometry upload nor tile size was the cause.

**Other findings.**
- *Vertex formats:* the first WebGPU run drew nothing. three pads
  snorm16×3 / snorm8×3 by itself, but has no WebGPU mapping for
  **one-component 8/16-bit** attributes (the feature id, uint16; the roof
  flag, uint8), and its WebGL2 backend rejects them against TSL's float
  attribute. They are baked as FLOAT now (`scripts/tile-glb.ts`; tens of
  KB per tile after meshopt + gzip).
- *Colour:* the WebGL path applied **no tone mapping** — three tone-maps
  only renders straight to the screen, the composer rendered to a target
  and its passes were `toneMapped: false`, so `ACESFilmicToneMapping` was
  inert. ACES in the output node washed the clay out; the output is plain
  sRGB, as before.
- Closing the class raster's `ImageBitmap` in `onUpdate` left it empty on
  node pages (the renderer uploads it again).
- WebGPU draws point primitives 1 px wide whatever their size: the lamp
  halos are billboard quads (an instanced mesh under a
  `PointsNodeMaterial`), not `Points`.
- One shared terrain/water/clay material with per-tile textures bound per
  draw (`onObjectUpdate`) failed (grey ground, untinted clay), and builds
  per tile material were cheap (none over 20 ms): only materials without
  per-tile data are shared.
- DoF as two prebuilt pipelines, not one pipeline whose output node is
  swapped when the camera starts or stops.
- 3DTilesRendererJS needed no change; its fade and overlay plugins patch
  GLSL and stay unused.

**Gate reading.** Neither reject criterion triggered (the WebGL2 backend
not > 25 % slower, the clay matched). The spike recommended WebGPU for
browsers that have it and keeping the WebGLRenderer path as the fallback.

**Outcome.** The maintainer asked for **the whole port with no second
path**: `WebGPURenderer` only (its WebGL2 backend as the fallback,
`?gpu=webgl2` to force it), every material a TSL node material, no GLSL
left ([ADR 0027](../adr/0027-webgpu-renderer-and-tsl.md), accepted
2026-09-26). The spike branch had answered the stalls by patching three's
internals — a render guard, a shared-instancing patch and a
render-context override — which kept misbehaving in ways that could not
be pinned down; that work was **rejected** and the port restarted from
`main`, the TSL written from the GLSL on the branch, on public API only:
- the scene renders **top-level into its own target** and the node
  `RenderPipeline` reads its colour and depth (three keys a build by
  render context, a context by target *and* call depth: a nested scene
  `pass()` never matched what `compileAsync` prepared);
- **`Instances`** (`instancing.ts`) replace `InstancedMesh` (three puts an
  InstancedMesh's uuid in the build key): a plain `Mesh` over an
  `InstancedBufferGeometry`, so every set with the same material and
  layout shares one build;
- **`sceneMaterial`** (`three-utils.ts`): one build for the site for every
  material without per-tile data; tiles compile ahead one drawable per
  material and layout.
The post stack is GTAO (half res, normals from depth; 16 samples, lite 8)
× the contact slider → DoF → SMAA → grading, vignette, grain → sRGB.
`postprocessing`, `n8ao`, `types/n8ao.d.ts`, `depth-grading-effect.ts`,
`paper-grain-effect.ts` and `webgl-support.ts` (now `gpu-support.ts`) are
gone; `shader-chunks.ts` stayed, as the shared TSL helpers. The six phase
PRs the plan staged became one port; plan 008 step 7 is moot.

**Keep in mind.**
- Public API only: no prototype patches, no `_` members. Before adding
  machinery against a stall, measure it with the flight probe.
- Known limits: the shadow pass's pipelines for new casters still build
  in the frame that first draws them; the WebGL2 backend compiles
  synchronously (the table above is what a browser without WebGPU pays).
- `Instances` traps: `drawCount`, never a `count` above 1 (it puts the
  uuid back in the key); `instanceTints`, never `instanceColor` (three
  multiplies any object carrying one by an InstancedMesh-only varying —
  black sets); the material applies the transform and the tint itself.
- Look terms that could not be ported exactly: the crown shimmer's
  shadow-map gate (node lights keep their map to themselves; the gate is
  the sun's daylight ramp, so a crown behind a building glows too) and
  `SkyMesh`'s own cloud horizon fade (inside its colour node; the horizon
  haze band covers it). GTAO is not N8AO: the contact shadows want a look
  on a real GPU, as does the whole port against the spike's plates.
- CSM (`CSMShadowNode`) and clustered lamp lights are in reach now, each
  its own decision.

## 023 — The ground up close: kerbs, paving, lawn edges, urban green · CLOSED (2026-09-25; phases 1–3 and 5 built; rest rejected or moved)

**Problem.** At eye level the ground fills half the frame and was the
flattest thing in it: one pastel per land-cover class, a stair-stepped
blend where road met pavement (0.5 m class texels). The data knew more:
the DLM road class is the carriageway at its surveyed width, so its edge
*is* the kerb line; OSM says what streets are made of (on the four first
tiles, 2026-09-19 extract: ~87 % of highway ways carry `surface`, ~68 % of
carriageway texels get a material); the DOP NDVI finds the courtyards and
parks inside the DLM's built-up class.

**Outcome.** One fragment pass in the terrain (`ground-detail.ts`), scaled
by *Bodendetail* (`groundDetail`, default 0.7). `pipeline/bake/edges.py`
measures the signed distance to the road and meadow edges, ±6 m in 5 cm
steps, box-smoothed so isolines run straight along a diagonal
(`edges_<tile>.png`, 2048²): kerb band, gutter, lawn lip, parking lanes,
paving rows along the kerb. Its kerb lines carry a **kerb stone** baked
into the fine terrain glTF (`lib/city/kerbs.ts`: 12 cm, 24 cm wide;
≈ 1 030 km over the fifteen tiles); since ADR 0035 its back meets the
pavement (`meetGround`) — the old level top stood a second step and missed
32 % of its ground joins, now 2 %. With the sun behind it the road strip
out to 12 cm · cot(elevation) is shaded (the shadow map cannot hold it).
`carve_islands` (`landcover.py --step islands`) cuts OSM pedestrian areas,
islands, fountain basins and lawns out of DLM road areas (the
Albertplatz). `surface.py` → `surface_<tile>.png`: R =
`park · 64 + walk · 8 + road`, G the way's bearing; asphalt, concrete,
slabs, sett, unpaved, grass pavers; unknown → asphalt / slabs / sand by
class; street parking (2 m lane with bays every 5.5 m, or 5 m every 2.5 m)
and surface car parks. Urban green: NDVI > 0.3 on classes 0 and 4, not
OSM-paved, is painted exactly as meadow (*Stadtgrün*, default 1).

**Keep in mind.** A kerb drawn as a shading-normal step on the class
texels read as dashes along the staircase; a drawn sett grid with pillow
shading read as busy and seamed where two streets' frames met (sett is a
warm tone with a direction-free grain now); a blend toward meadow read as
barely there. Pattern detail fades by `fwidth`: moiré means fix the fades,
never raise the texture budget. The contour ink must not divide by a zero
`fwidth` (NaN diamonds on flat roads). The 4×4 box-smoothed class-texel
distance remains where no edge raster is read (the coarse level, a site
without the bake). A site with < 30 % OSM paving coverage runs on the
class defaults, no per-site switch; no Overpass.
Rejected: a raised pavement behind the kerb (ADR 0035 meets the pavement
at its own level, never a step the data lacks) and DGM1 micro-relief as a
normal texture (the fine level is a ±0.15 m TIN, ADR 0030, and
`terrainNormal` in `terrain-layer.ts` calms near-flat normals on purpose:
under a low sun they read as dirty flecks). Not planned: shell-textured
grass, demoted to a ledger idea — the maintainer has vetoed sub-pixel
detail again and again (🗃️ drawn fence panels, allotment bed bands).
Moved: the GPU look and frame time to plan 019; the DLM `sie02_f` split
and LSC intensity to the [data-streams survey](../data-streams.md) (ledger 📋 #12); trees inside the
carved parks to plan 022's canopy re-bake after land cover.

See [ADR 0029](../adr/0029-static-dressing-baked-into-the-fine-terrain.md),
[ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md),
[ADR 0035](../adr/0035-parts-meet-the-ground.md), the
[ledger](../transformations.md) (*Kerbs and lawn edges*, *Paving
materials*, *Parking*, *Urban green*) and plan
[019](./019-gpu-verification.md).

## 024 — Trams: tracks, overhead line, stops · DONE (2026-09-25; look unjudged on a GPU — plan 019)

**Problem.** Dresden is a tram city and the viewer had none: `rail.py`
keeps heavy rail only, and the DLM carries trams poorly. OSM carries them
well (four first tiles: 401 `railway=tram` ways, 59.6 km, all
`gauge=1450`, `electrified=contact_line`; 321 `power=catenary_mast`), but
nothing says where a track runs in the street, and the overhead wires
are thin lines that alias.

**Outcome.** `pipeline/bake/tram.py` → `tram_<tile>.geojson` (ODbL);
`tram-layer.ts` per fine terrain tile. Fifteen tiles: 146.8 km of track
(130.2 street, 13.4 grass, 3.2 ballast), 376 masts, 133 spans, 258 rosette
spans, 93 arms, 229 stop signs. The **bed** is read every 2 m on the
committed class raster (`street` on road and paved squares, `grass` on
meadow or NDVI > 0.3, else `ballast`), a majority over 20 m with no
stretch shorter than 20 m, the track cut where it changes (ADR 0035;
until 2026-09-30 one bed per chain put 23.8 km in ballast, the Postplatz
half in a brown strip). Two rails at ±0.725 m with the rail layer's
profile: street flush (+2 cm), grass +15 cm over a 2.6 m meadow strip,
ballast +25 cm over 2.8 m. A track on an OSM `bridge` rides the deck
through the rail layer's shared lift table (any deck kind, interpolated
along the deck); a tram under a railway bridge stays down. Contact wire
5.6 m over the rail, sagging 0.15 m between supports (`lib/city/tram.ts`;
both line ends are stations, so it meets the next tile at one height).
Supports, decided on everything within 30 m of the tile so a seam support
is the same in both: a **span** to the nearest mast across the tracks
(≤ 28 m), else an **arm** (≤ 10 m), and where a track is 45 m from any
mast a **rosette** span every 30 m between the facades either side (OSM
building outlines ≤ 15 m out). Only masts within 15 m of a tram track are
kept (167 of 321 on the four first tiles; the rest are the railway's).
Stop signs stand on the nearest mapped platform (≤ 25 m) facing the
track, because OSM puts 144 of 164 `tram_stop` nodes on the track; none
within 8 m of a shelter, a bus-stop sign or another tram sign.

**Keep in mind.**
- Rosettes come from the OSM outlines in the bake, not a runtime ray
  against the LoD2 BVH: a dressing cannot count on its own or its
  neighbour's buildings being loaded, and a support must not depend on
  load order.
- Wires: one camera-facing ribbon mesh per tile, width
  `max(true width, 0.8 px)` in the vertex stage, alpha the true coverage
  (≥ 0.2) × 0.6, light slate, faded 150 → 350 m; no `Line2`, no MSAA, no
  line library. Wires never cast; only the 7.5 m masts do.
- Style (maintainer, on the fences): the soft clay idiom beats the plan's
  detail — no groove strip, rails the road's lavender-grey a shade deeper,
  pale green-grey masts, nothing near-black.
- The bed thresholds stood the plan's check: Albertplatz 87 % street /
  5 % grass, Hauptstraße 100 % street (the > 10 % STOP not hit).

See [ADR 0035](../adr/0035-parts-meet-the-ground.md), the ledger's
*Trams* ([transformations](../transformations.md)) and plan
[019](./019-gpu-verification.md).

## 025 — Trees by species and season · DONE (2026-09-25; look unjudged on a GPU — plan 019)

**Problem.** The street-tree cadastre placed every municipal tree with
height, crown, archetype and leaf type, but trees on Free-State or private
ground (courts, the Zwinger) were missing, the genus never reached the
runtime, and nothing varied with the date: a snapshot on 21 December
showed full summer crowns.

**Outcome.** *Bake* (`trees.py`): each tree's genus `gn`, an index into
`tree_archetypes.GENERA` (38 entries, the red maples and red oaks their
own for their autumn; written as the file's `genera` member and checked
against `TREE_GENERA` by `features.test.ts`), and the trunk diameter `t`
(cm). Fifteen tiles: 56 185 cadastre trees, 50 246 (89 %) with a genus,
51 523 with a trunk; **3 453 OSM `natural=tree`** added (`s: "osm"`, 298
with a genus), an OSM tree within 3 m of any cadastre tree of the cached
WFS answer (its 10 m seam margin included) being taken to be it. An OSM
tree needs a taxon naming a known genus or a `leaf_type`, else it is
dropped (the DOM canopy covers unknown trees; no species is invented);
OSM trees join the cadastre's `keepTree` veto, replacing the canopy or
laser-scan crown they stand in. *Model* (`lib/city/tree-season.ts`):
`(day, genus, ±6-day jitter) → { leaf, autumn }` per genus (limes early,
horse-chestnuts browned from August, oaks holding 30 % dead leaves,
larches rust then bare; evergreens constant; unknown species a generic
curve). *Scene* (`crown-season.ts`): on a change of local calendar day,
throttled to 150 ms, never per frame, the autumn hue goes into the sets'
`instanceTints` and `aBare` into a per-chunk instance attribute; a chunk
with any bare crown wears the seasonal crown material, a hashed alpha test
(three's `alphaHash` method, ~1.25 px cells fixed to the tree) down to a
25 % grey-brown twig stipple, as its `maskNode`, which the shadow pass
honours — the winter shadow thins too. A date change costs 4–7 ms median
on the whole site (`scripts/eval/season-cost.ts`, 58 988 crowns), under
the plan's 16 ms bar.

**Keep in mind.**
- Colour is mixed on the CPU (divided by the crown material's base colour)
  so the hue table stays in the pure, tested module; a chunk in full leaf
  keeps the plain crown (no discard, early depth intact). Both crown
  materials are scene-wide (`sceneCrowns`) and warmed once per scene
  (`crownWarmup`) so the first date drag across the leaf fall builds
  nothing in a frame; a tile still compiling catches up on join
  (`tile-stream.ts` `catchUp`).
- A first cut with fixed dither cells (~8 per crown) and solid far crowns
  shattered big trees into brown shards on headless plates — the plan's
  noise STOP remedy was applied before any GPU check.
- `dayOfYear` reads the local calendar (the HUD composes local dates).
- The trunk fit follows the drawn profile with its flared foot
  (`trunkRadiusAt`); a taper-only fit drew a 25 m tree's trunk ~50 % too
  thick. The bake drops implausible diameters rather than clamping.
- Open: canopy and row trees (species unknown) follow the generic curve,
  conifers among them included; hedges and low vegetation stay green.
- Open: a site without a cadastre gets no OSM trees (the step is
  skipped); an OSM-only `trees` artifact is a small change in
  `trees.run`.
- The season clock is the plumbing plan 028's bare vineyard canes wait
  for.

See [ADR 0027](../adr/0027-webgpu-renderer-and-tsl.md), the ledger's
*OSM trees beside the cadastre* and *Trees by season*
([transformations](../transformations.md)) and plan
[019](./019-gpu-verification.md).

## 026 — Road markings · DONE (2026-09-25; look unjudged on a GPU — plan 019)

**Problem.** Streets had kerbs, paving and parking bays (plan 023) but no
paint, although OSM maps where it is: `highway=crossing` nodes with
`crossing`/`crossing:markings`/`crossing_ref`, directed
`highway=traffic_signals`, `cycleway[:side]=lane` and `lanes` on the
roads. None of these tags was read.

**Outcome.** `pipeline/bake/markings.py` writes a table of rotated
rectangles per tile (`markings_<tile>.json`: centre, axis across the road,
half extents, kind zebra / *Furt* / stop) and a 2048² four-byte raster
(`markings_<tile>.png`: the row reaching the texel as 16 bits in R + A,
lane bits in G, B the signed distance to the carriageway's middle) plus a
1024² twin for phones (4 MiB of GPU memory per fine tile instead of 16).
`road-markings.ts` paints them in the terrain's fragment pass, fine level
only, box-filtered over the pixel footprint, clipped to the carriageway,
worn, scaled by *Bodendetail* (no new slider). Signalled crossings are a
*Furt* (two broken lines), not a zebra; `unmarked` / `markings=no` paint
nothing. A crossing's axis is the normal of the nearest carriageway way,
its length the DLM road run along it, measured also 5 and 10 m along the
road (the narrowest wins: at a junction the normal runs down the side
street). Stop lines 3 m before a directed signal on the right half of the
approach. Rows are measured on the neighbours' class rasters too and a
neighbour's row reaching over the seam is painted. Fifteen tiles
(2026-09-26): 837 crossings (127 zebra, 710 *Furt*), 583 stop lines.

**Keep in mind.** The four-byte raster is deliberate: a tile can hold
more than 255 rows, and the kerb distance alone (clamped at ±6.35 m)
cannot place a centre line on a wide road. Lane sides are resolved in the
bake because the paving raster's bearing is only known modulo 180°.
Duplicate OSM crossings clipped each other's paint (62 of 578 rows): the
bake merges rows of one family within 30° and 1.5 m (zebra beats *Furt*)
and gives each texel to the nearest rectangle — keep that, the raster
names one row per texel. Centre lines (the plan's STOP taken): only
two-way primary…unclassified roads with `lanes` ≥ 2 and a carriageway
≥ 5.5 m, clear of junctions; residential `lanes=2` streets stay unmarked.
Snap check on the four first tiles: axis within 20° of the crossing
footway for 278 of 301, 18 of 364 rectangles < 70 % on the carriageway
(STOP was 1 in 10). The phone twin's lane bits agree with the full raster
on ≈90 % of texels.

See the [ledger](../transformations.md) (*Road markings*) and
[plan 019](./019-gpu-verification.md) for the plates.

## 027 — What OSM knows about the buildings · DONE (2026-09-25; phase 3 rejected, dusk look unjudged on a GPU — plan 019)

**Problem.** Dusk glow and tint came from the ALKIS `function` alone, so
a commercial building glowed over its full height and the street had no
shop fronts, although OSM maps shops and places to eat densely. Found
while planning (phase 0, a bug): a Saxon LoD2 `Building` with parts has
no geometry of its own and its `BuildingPart`s carry no `function`, so
every part read as housing — 1 682 parts of 338 commerce/public/special
buildings dark at dusk on the four first tiles.

**Outcome.** Phase 0: `inheritedAttributes` (`lib/city/building-tint.ts`)
resolves tint, roof palette and glow through the root — the part's own
value first, the root's as fallback; heights stay the part's own.
Phases 1–2: `pipeline/bake/osm_buildings.py` → `osmbuild_<tile>.json`, a
LUT by CityObject id; one `flags` UINT8 column (shop 1, heritage 2) in
the object table's one free float (the third texel's w); a part carries
its root's flags too (`inheritedFlags`). Shop: a point (`shop=*`, the
gastronomy amenities, ground floor only) marks the footprint it lies in,
else the nearest within 3 m; an OSM outline with a shop marks the
objects it covers ≥ 50 %. The clay draws a warm wash under the first
storey line, walls only, with a ≈3.5 m hash along the facade, at 0.4 ×
the dusk glow × `nightFactor` — no window structure. Heritage: OSM
outlines with `heritage=*` covering ≥ 50 % give a barely-there warm lift
of the tint and a second cornice line 0.45 m under the eave. No new
slider: the wash rides *Abendlicht*, the lift *Farbvariation* and
*Traufkante*. Fifteen tiles: 2 986 of 3 471 shop points placed, 2 332
objects matched with a shop, 1 302 listed. Phase 3 (colour by era)
REJECTED: 64 of 8 310 OSM outlines dated on the four first tiles
(0.8 %, bar 30 %), and no open official dating source (🗃️ in the
ledger).

**Keep in mind.** A new per-building fact goes through the column path
(a bake LUT listed in `cityMeshSourceFiles` → the `bakeCityMesh` row →
the glTF property table → `readObjectTable` → `packObjectTexels` → the
clay node), as a further bit of `flags`, not a vertex attribute.
Courtyard STOP: 8.2 % of placed points (2 of 20) fell in a footprint
more than 20 m from any street, under the 20 % bar, so the join stays
containment-first. The window grid is a recorded veto. Era: revisit only
with an official Baualter source.
Open: replace the OSM heritage join with the official listed-building
flag — the city's WFS `L1544` carries `kulturdenkmal` on every roof face
(S; ranked first in [data-streams.md](../data-streams.md); the column and
the shader exist).

See the [ledger](../transformations.md) (*Attributes through the
building tree*, *Shop fronts at dusk*, *Listed facades*, 🗃️ *Building
era*) and [plan 019](./019-gpu-verification.md).

## 028 — Cultivated land: allotments, orchards, vineyards · DONE (2026-09-25; look unjudged on a GPU — plan 019)

**Problem.** The DLM burns vineyards, orchards and garden land into one
vegetation class and allotments into the built-up class without the
attribute that tells them apart. OSM tells them apart: Dresden's
*Kleingärten* colonies are a real feature of the city, and the Elbe
slopes carry vineyards.

**Outcome.** No new land-cover class (ADR 0023): dressing only.
`pipeline/bake/cultivated.py` → `cultivated_<tile>.geojson` (colonies,
parcels, orchards with their trees, vineyards with their rows) and a
2048² colony raster with two bytes per texel — the signed distance to the
garden land's edge (the colony less its paths, roads, rail and water) and
the colony's long axis; `prepare-data.ts` crops it to the colonies and
phones read a half-resolution twin. Allotments: `colonyGarden` in the
terrain pass draws analytic plots (≈12 × 17 m, a jittered Voronoi in the
colony's axis frame, meandering borders as thin soft paths; soft greens,
some warm beds, flower dots, shrub mottles), box-filtered and fading with
distance to one calm colony tone; the edge is the distance field sampled
LINEAR with a slow wobble. Orchards: mapped `natural=tree`, else an 8 m
grid along the long axis, less spots a measured tree (canopy, scan,
cadastre) already fills within 4 m or its crown radius, drawn as the
cadastre's "small" archetype. Vineyards: rows 1.8 m apart along the
contour (perpendicular to the DGM's mean gradient over the whole
polygon, read across tile seams), chains of boxes 1.3 m tall, 0.5 m
wide, 250 m chunks. Fifteen tiles: ≈195 colonies (208 ha), 5 orchards
with 35 trees, 11 vineyards with 305 rows on the Loschwitz slopes
(`33414_5656`, `33416_5654`, `33416_5656`).

**Keep in mind.** STOP measured: 0 colonies map their parcels (0 of 66
on the four first tiles, 0 over fifteen), so every plot is invented
texture — kept low in contrast (`COLONY_GARDEN.strength` 0.85 of
*Bodendetail*, `lib/city/cultivated.ts`) and no parcel outline is
claimed as data; a mapped parcel would take its own axis and a 0.5 m
seam. No synthetic sheds or parcel hedges: sheds are LoD2 or the scan's
small buildings, hedges `lowveg`, fences plan 029. The first look — bed
bands over a NEAREST colony-id raster — showed the raster's staircase on
a phone and is 🗃️ (*Allotment bed bands*). The orchard step runs after
`lowveg` so its dedupe sees every measured tree. A vineyard's direction
must come from every DGM it touches (one tile's alone kinked the rows at
x = 416 000 by 2°).
Open: vine rows ignore the season — plan 025's plumbing now exists
(`ctx.season()` and `setSeason` on a tile's vegetation dressing,
`tile-stream.ts` / `create-app.ts`), but `cultivated-layer.ts` takes no
date; bare canes in winter, leaf-out with the calendar (S).

See the [ledger](../transformations.md) (*Cultivated land*, 🗃️
*Allotment bed bands*), [ADR 0023](../adr/0023-land-cover-colours-painted-at-runtime.md)
and [plan 019](./019-gpu-verification.md).

## 029 — Fences, railings and gates · DONE (2026-09-25; restyled to one band, look unjudged on a GPU — plan 019)

**Problem.** Walls were drawn, fences were not read at all, although OSM
maps them along almost every yard, park and school, with gates on them.

**Outcome.** `pipeline/bake/walls.py` appends `{kind: "fence", type, h}`
lines (`barrier=fence|handrail`, lines and the outer ring of areas;
`fence_type` → railing / mesh / picket, untagged → railing; `height`
0.3–4 m, else 1.2 m, a handrail 1.0 m) and `{kind: "gate", w, on}`
points within 0.5 m of a wall or fence line, snapped onto it (`width`,
else 1.2 m, a lift gate 4 m). Fifteen tiles: 189.3 km of fence, 1 452
gates on a line (1 238 on fences, 214 on walls); gate points on no
mapped line are dropped. Fences are static, so they are **baked into the
fine terrain glTF** as a `fences` node (`lib/city/fences.ts`, `fenceMesh`
in `scripts/bake-tiles.ts`, ADR 0029); `fence-layer.ts` is only the
material. After the maintainer's review on a phone ("zu hart und
kleinteilig", then "stärker stilisiert, mildere Farbwahl, Kleinteiligkeit
führt zu Artefakten") a fence is **one low, calm band**: a flat
double-sided quad per ≤ 2.5 m at ¾ of the tagged height (`bandHeight`,
0.4–1 m; a handrail only its top 15 cm), one muted tone near the
ground's (warm grey-sage; wood a warm stone; a gate leaf lighter), a
breath deeper at the foot, lighter at the top edge, fading toward the
pale ground from 40 to 160 m, lit with the world's up as normal so no
side turns dark; opaque, no discard, no dither; receives shadows, casts
none. A gate cuts a `w`-wide gap with a lighter leaf, a boom at the
band's top for a lift gate, swing gate or cycle barrier; gates on a
freestanding wall cut the wall too. The drawn panels of the first look
(bars every 12.5 cm, wire mesh, pickets, posts, alpha-cut and dithered,
a dithered shadow through a custom depth material) aliased into moiré
and shimmer and are 🗃️ in the ledger. ADR 0035 (2026-10-01): the band's
foot reaches `SINK.band` (5 cm) into the ground and `followGround`
densifies a run where the ground bends between samples (a band bridging
a dip floated over it); misses 1.7 → 0.16 % site-wide, held by
`ground-joins.test.ts` (budget 0.3 % on the spawn tile).

**Keep in mind.** A fence stands on its OSM line: it never enters the
coarse level's conflation, the stair burn or the step snap, and never
reshapes the terrain. Clip every ring to the tile **as a line** — clipping
an area as a polygon first closed it along the tile edge (1.52 km of
phantom fence in 10 rings, 216 m of wall); `features.test.ts` keeps 0 m
on any tile edge. A gate at a ring's closing vertex must open the ring
there (`cutGaps`), and a neighbour's gate whose gap crosses the seam
comes along as `{seam: true}`. The walls file mixes editions: the walls
stay verbatim from the Geofabrik bake (the terrain study addresses them
by index), fences and gates come from the BBBike extract of 2026-09-19,
and a gate is kept only on a line of its kind the file carries. Building
posts and a rail as geometry cost 125–361 k triangles and +12–32 % on
the fine terrain glTF per tile (over the 10 % STOP). Crossing check on
the four first tiles: 5.4 % of fence lines run > 1 m inside a LoD2
footprint, 9.7 % over the DLM road class (which includes pavements) —
lines are not shifted; the verdict is visual. A pattern returns only
with a calm real-GPU plate at walking height and from 150 m; a dithered
shadow would be the material's `maskNode`.

See [ADR 0029](../adr/0029-static-dressing-baked-into-the-fine-terrain.md),
[ADR 0035](../adr/0035-parts-meet-the-ground.md), the
[ledger](../transformations.md) (*Fences, railings and gates*, 🗃️
*Drawn fence panels*) and [plan 019](./019-gpu-verification.md).

## 030 — More street furniture: columns, signals, hydrants, clocks, stops · DONE (2026-09-25; look unjudged on a GPU — plan 019)

**Problem.** `furniture.py` covered benches, bins, bicycle stands,
bollards, post boxes, shelters, picnic tables and playgrounds; the things
that make a Dresden junction read as one were mapped in OSM and unused:
advertising columns (the *Litfaßsäule*), traffic signals, fire hydrants,
clocks, drinking water, bus and tram stop signs.

**Outcome.** Eight kinds added through the existing furniture path (bake
branch, `FurnitureKind`, model table, a builder in the type-enforced
`MODEL_PARTS`), appended to the committed files with every earlier object
byte-identical. Over the fifteen tiles: 175 columns, 786 signals, 24
pillar hydrants and 1 482 hydrant sign plates, 20 pole and 3 wall clocks,
15 drinking fountains, 231 bus-stop signs. Decisions:
- *Signals at the kerb.* OSM puts `highway=traffic_signals` on the
  carriageway at the stop line; the bake walks each one to the kerb on the
  right of the traffic its `traffic_signals:direction` names (kerb from
  the class raster, ≤ 15 m) and faces it that way; without a direction,
  the nearest kerb, facing the nearest way. The same walk takes an
  underground hydrant's sign out of the lane. Lamps unlit: the viewer has
  no traffic to time.
- *Hydrant signs* drawn at 70 % (`HYDRANT_SIGN_SCALE`) — the plan's STOP
  fallback, taken without a plate, rather than dropping them.
- *Wall clocks* hang on the nearest OSM building outline (≤ 3 m), not on a
  ray against the LoD2 BVH: a dressing cannot count on the buildings being
  loaded, and the result must not depend on load order. The rest are
  dropped, as are tower clocks (the tower is LoD2) and sundials.
- *Clock hands* show the scene time from one shared uniform node that
  `setSun` updates on the minute only (`setClockTime`); the hands never
  cast, so the shadow map is not redrawn for them.
- *Stop sign*: `highway=bus_stop` without a shelter, dropped within 8 m of
  one; the same model stands at the tram stops (plan 024).
- *Style* (maintainer feedback on the fences): no near-black and no fine
  detail — poster fields as colour without text, the hydrant plate one
  soft rose field, the "H" as a green disc in a yellow one, slate hands.

**Keep in mind.** A new furniture kind is touched in five places: the
bake's `POINT_WHERE` and `kind_of`, `FurnitureKind` (+ the kinds list in
its test), the model table, `MODEL_PARTS`, and the credits/provenance/
docs. Not drawn, on purpose: traffic signs (~100 mapped) and street-name
signs (almost none).

See the ledger's *Signs and fixtures* row ([transformations.md](../transformations.md)) and plan 019.

## 031 — The Elbe: landing stages, groynes, ferries · DONE (2026-09-25; look unjudged on a GPU — plan 019)

**Problem.** The view from the Brühlsche Terrasse looked onto empty water:
nothing read OSM `man_made=pier`, groynes or `route=ferry`, and lamps and
furniture are dropped on water on purpose. The *Anlegestellen* of the
Sächsische Dampfschifffahrt below the Terrasse were missing.

**Outcome.** `pipeline/bake/riverside.py` → `riverside_<tile>.geojson`
(ODbL): 44 piers, 43 pontoons, 1 groyne and 9 ferry stretches over the
fifteen tiles. `riverside-layer.ts` draws a pier as a timber deck on piles
every 4 m with a railing over the water, a pontoon as a soft slate hull
under a pale deck with a ticket hut when longer than 15 m and a gangway
to its bank point, a groyne as a low stone ridge half under the drawn
water, a ferry as a faint dashed wake. The paddle steamers are not drawn:
no dataset has them.
- *Pontoons (the STOP, measured).* The DGM's river surface is flat per
  stretch (103.75 / ≈104.3 / 105.05 m), but OSM draws most pontoons up the
  bank, so the uncut outlines stood on 2.7–5.2 m of relief. The bake cuts
  a pontoon to its part on the water class (median spread under the cut
  hull 0.22 m, max 2.27 m at a shoreline cell), and the runtime floats it
  on the **lowest ground under it** — the terrain the water sheet is drawn
  on (`water-layer.ts` has no surface of its own), so hull and water agree
  by construction. Never float a hull on a baked DGM value.
- *Ferry lines (the STOP, unjudged).* The conservative fallback was taken
  without a plate: the wake shows only from the air, fading in with the
  camera's height over the ground from 25 to 60 m (`map-overlay.ts`, kept
  for them when plan 032's lettering was removed).
- *Deviation:* the wake is its own ribbon over the water sheet, one draw
  per tile, not a line table inside the water shader (which other plans
  also edit).

**Keep in mind.** The pier railing is the layer's own top rail and posts
every 2 m: plan 029's fences (since baked into the fine terrain glTF) were
not on the branch when this was built; whether the two should match is a
plate question. No non-GPU work is open.

See the ledger's *Landing stages, groynes, ferries* row
([transformations.md](../transformations.md)) and plan 019.

## 032 — Street names: lettering and the on-foot caption · REJECTED (removed 2026-09-26)

**Problem.** The contour-map look had no text. The plan lettered the OSM
street names (plus named squares and the DLM bridge names) on the ground,
fading in from 25 m up, and named the street underfoot in a HUD caption
while walking.

**Outcome.** Built on 2026-09-25 (`pipeline/bake/names.py` →
`names_<tile>.geojson`, a Canvas-2D atlas per tile in `name-layer.ts`,
`street-caption.tsx`, `lib/city/names.ts`; ≈ 1 500 labels over the fifteen
tiles), then removed completely on 2026-09-26 by the maintainer's decision
after seeing it on a device: the map look reads better without text. The
bake, the committed files, the layer, the caption and their docs are gone;
the full implementation is in git history (`4b08993` and its follow-ups).

**Keep in mind.**
- `map-overlay.ts` (the altitude fade shared by map marks) stays: the
  ferry lines use it.
- The DLM bridge `name` stays in the bridge files.
- Street-name *signs* were never drawn: OSM maps almost none.
- Revive only with a new look decision, not as a re-audit finding.

## 033 — Sky-view factor and baked horizon shading · DONE (2026-09-25; plates and tuning open on a GPU — plan 019)

**Problem.** Two lighting gaps. The hemisphere light lit a narrow Neustadt
courtyard as brightly as the open Elbwiesen (the contact shadows darken
creases only, on screen). And long shadows stopped at the shadow frustum
(110 m half-size at eye level): at a low sun a street 300 m from the
Frauenkirche lay fully sunlit — "only solvable with CSM" (ledger 📋 #7).
Both causes are static (DGM + LoD2), so both can be baked once.

**Outcome.** `pipeline/bake/skyview.py` reads the committed DGM1 with the
LoD2 surfaces burned on top (`lowveg.py`'s one CityJSON walk,
`lod2_rings`; trees left out on purpose), neighbour tiles for the margin;
≈25–40 s per tile, on all fifteen.
- *Sky-view factor* (*Himmelslicht*, default 0.5): `svf_<tile>.png`,
  1024² (≈2 m), 16 azimuths within 150 m, `svf = 1 − mean(sin² h)`;
  0.19–0.58 MB. It is the material's `aoNode`, so it scales only the
  indirect light. Terrain on both levels; the clay facades read the
  ground's value 2.5 m outside the wall, doubled, faded to 1 toward the
  eaves. One raster per tile shared by terrain and buildings, refcounted
  (`shared-rasters.ts`).
- *Horizon shade* (*Ferne Schatten*, default 0.8; [ADR 0031](../adr/0031-baked-horizon-map-for-far-shadows.md)):
  `horizon_<tile>.png`, 256² (≈8 m) × 16 azimuths × two bands — far
  occluders 80–1 500 m (0–45°), near 8–80 m (0–90°) — in one greyscale PNG
  read by `png-raster.ts`; 0.69–1.35 MB. The ground's `receivedShadowNode`
  combines it with the shadow map by **min**, never a product (one
  occluder seen by both must not darken twice). Inside the frustum only
  the far band counts; the near band fades in over the frustum's last
  20 % (`shadowReach`, a shared uniform node) and rules beyond it, so a
  street past the frustum keeps its neighbours' shadows (the far band
  alone lost a 20 m block's 55 m shadow at a 20° sun).
- *STOP, measured:* at the plan's 4 m the far band alone was 1.86 MB on
  the spawn tile, past the 1.5 MB cap; 8 m keeps all 16 azimuths and both
  bands under it.

**Keep in mind.**
- Cells under a roof carry the nearest open cell's value in both rasters;
  left at ≈0, LINEAR filtering and mipmaps pulled a dark band onto wall
  feet and dimmed distant streets.
- The sun's azimuth is guarded for a sun straight overhead.
- Past the site's rim the ground is open at the edge tile's mean height:
  a rim tile sees no skyline beyond the site.
- Horizon on facades (phase 3, "only if plates call for it") was not
  built; it is folded into the ledger's 📋 #7 (CSM), which would also give
  the middle distance its shadow *shapes*.
- *Boden-Verlauf* (the clay's ~5 m ground darkening) stands as it was:
  retune or retire it against the sky view on the plates.
- Both defaults are conservative stand-ins until the plates.

See [ADR 0031](../adr/0031-baked-horizon-map-for-far-shadows.md), the
ledger's *Sky-view factor* and *Horizon shade* rows
([transformations.md](../transformations.md)) and plan 019.

## 034 — Small structures from DOM − LoD2 · DONE (2026-09-26; look unjudged on a GPU — plan 019)

**Problem.** LoD2 carries many small buildings but not all: kiosks,
carports, bike sheds, garden and allotment houses, container buildings,
pavilions. The laser scan sees them. The plan gated the work on a
measurement: ≥ 100 candidates per tile and ≥ 70 % true structures in a
20-blob sample against the DOP, or reject.

**Phase 0 — the gate.** Spawn tile 33412_5656, the 0.5 m scan rasters
(`lsc.py`), the LoD2 mask grown 1 m, rail/road/water (classes 5/7/8) out:
6 388 blobs of 6–150 m² in the 2–6.5 m band. The plan's rule — a
blob-wide multi-echo share ≈ 0 — found **4**: a shed's roof *edge* splits
the pulse, so no blob is ever echo-free (median share 0.93). The STOP's
own remedy, tightening the echo rule, passed: **per cell**, no multi-echo
return in its 3 × 3 window, which drops the rim and every tree crown
(0 of 130 blobs touch a > 6.5 m cell); the core grown back one cell, then
NDVI ≤ 0.25 (a clipped evergreen block is flat and single-echo too), a
vehicle-size rule, OSM exclusions and a roof-edge sliver rule. Result:
213 on the spawn tile, **16 of 20** sampled are structures (container
buildings, garden houses, a gazebo, sheds and carports, a garage row,
annexes LoD2 lacks); the misses were two roof-edge slivers (since ruled
out) and a shadow. Caveat: the DOP is from March 2024, the flight from
27–30 Nov 2024.

**Outcome.** `pipeline/bake/small_buildings.py` →
`smallbuild_<tile>.geojson` (GeoSN): each blob its minimum rotated
rectangle, `z` the lowest ground under it and the DGM1 at its corners,
`h` the fitted top's median, `hc` the corner heights where it tilts > 8°
(a pent roof). **6 625** over the fifteen tiles (703 pent roofs; median
22.5 m², 2.7 m high), most in the allotment colonies; 1.6 MB of GeoJSON.
`bakeCityMesh` appends each as a closed box (`lib/city/small-buildings.ts`,
sunk 0.2 m): its own object and root, so picking, demolish, collision and
the minimap work unchanged; `source` = 1 in the property table (0 =
LoD2); +3.3 % city glTF. The review's fixes: 40 m of the neighbours' scan
read across each seam, a structure owned by the tile holding its
centroid; a box over ground falling > 1.5 m dropped; of two overlapping
> 0.5 m² the smaller goes; canopy and scan tree points in or within
0.5 m of one dropped at build time (a shed's roof read as a 3–4 m tree).

**Keep in mind.**
- *What the flight saw that day only.* The Striezelmarkt opened on 27 Nov
  2024: the Altmarkt alone held 101 blobs, the Neumarkt 39, Prager Straße
  28, the Stallhof 11. The bake drops blobs in pedestrian areas and
  squares, within 6 m of a pedestrian street mapped as a line, on
  marketplaces, building sites and surface car parks. Left in: three
  probable stalls on the Schloßstraße pavement (a living street) and the
  Alberthafen's container stacks, which may be gone now.
- Same clay as every building, the flat-roof slate palette (no DOP roof
  colour), no dusk glow, no storey bands (the first stroke fell under the
  eave on ~66 %); the wall tint hashed from the first corner, so a change
  in the LoD2 object count does not reshuffle it.
- The laser scan is not committed: a re-bake needs `bun run bake --ingest
  --lsc` per tile.

See the ledger's *Small structures from the laser scan* row
([transformations.md](../transformations.md)), [ADR 0035](../adr/0035-parts-meet-the-ground.md)
(the box's ground join) and plan 019.

## 035 — A hidden soundscape · DONE (2026-09-26; unheard: the listening pass is a maintainer action)

**Problem.** The maintainer asked for a surprise, opt-in and hidden: the
city made audible from the same data the picture reads — footsteps by
paving, the Elbe, wind and leaves, birds and crickets by season and hour,
the city's hum, church bells at the full hour, a tram bell — with no
audio files and no dependency.

**Outcome.** All four phases built, everything synthesized with WebAudio.
- *Entry.* **L** (not in the control hints) and one quiet switch,
  *Klang (experimentell)*, at the bottom of the *Erweitert* tab; off at
  every load, no persistence. The `AudioContext` is created inside the
  toggle's gesture, with `navigator.audioSession.type = "ambient"` where
  Safari has it (mixes with the visitor's audio, keeps to the silent
  switch). A speaker glyph shows while it plays; its click turns the sound
  off. Muted on a hidden tab and under the loading overlay. The e2e suite
  asserts no `AudioContext` before **L** and exactly one after.
- *Cost.* The engine (`app/_components/soundscape/`) is a dynamic import
  fetched on the first toggle; the boot carries only
  `lib/city/sound-entry.ts`. The pure core `lib/city/soundscape.ts` is
  sampled on the 10 Hz pose tick; the render loop is untouched. The
  rasters it needs (class raster at 4 m within ≈ 320 m, the sky view, the
  paving byte for the tile underfoot) are fetched only while sound is on
  and dropped when it goes off — the viewer's own CPU copies stay dropped
  after upload (iOS memory).
- *Bells.* `pipeline/bake/soundmarks.py` → `soundmarks_<tile>.geojson`
  (OSM churches and bell towers, the tip found in the LoD2): 20 towers,
  six of the fifteen tiles empty. The scene clock does not run on its own
  (14:00 unless moved), so the bells answer a forward scrub of the time
  slider or a snapshot: the last full hour crossed, struck once the clock
  rests 0.7 s, by the nearest four towers within 1.5 km, each delayed by
  its distance at 343 m/s.
- *Footsteps.* The walker moves at 9 m/s, so one step per 0.75 m would be
  a drum roll: above walking pace the stride lengthens (≤ 2.8 steps/s); a
  jump or a gap over 1.5 s is no walk.

**Keep in mind.**
- Every level and timbre was chosen on paper (master 0.32; the per-source
  trims live in `engine.ts`). The plan's rule stands: a source the
  maintainer finds cheesy on listening is **removed, not tuned**.
- Any sound before an explicit toggle, in any browser, is a blocker.
- If iPhones stay silent, switch the audio session to `"playback"`.
- Plan 036's rank 6 (a soundscape from measured data: the WFS noise maps,
  OSM acoustic signals, streams and weirs) waits for the listening pass.

See the ledger's *Sound* section ([transformations.md](../transformations.md)),
[rendering.md](../rendering.md) and plan 019 (the listening pass rides
along with its phone session).

## 037 — The commands agents run, and docs that say what the code does · DONE (2026-10-03)

**Problem.** `AGENTS.md` told agents to run `bun build` (Bun's bundler) and
a bare `bun test` (loads the Playwright specs); `E2E_DEV=1` assumed plain
HTTP although `bun dev` serves HTTPS only since 2026-09-30; the city-walker
skill still gave the phone tile cache as 120–180 MB (the value the code
records as a bug); half the docs described the fine terrain as a 1024²
grid (a ±0.15 m TIN since ADR 0030); the guide missed five viewpoints and
named a crown switch the HUD does not have.

**Outcome.** `bun run build` / `bun run test` everywhere, and a
`bunfig.toml` that keeps a bare `bun test` out of `e2e/`
(`pathIgnorePatterns` — Bun 1.4 honours it). Playwright derives the scheme
from `E2E_DEV` and ignores the self-signed certificate. The TIN is
described as one in README, rendering, data-pipeline, data-flow,
portability, both glossaries (a new *TIN* entry) and both data-journeys.
Two new tests in `lib/docs/`: the guides name every Dresden viewpoint and
every look slider (`guide-labels.test.ts`), and every relative link in
`docs/` and `AGENTS.md` resolves (`links.test.ts`, code spans ignored).
Dependabot groups follow the stack (tsgolint with oxlint, 3d-tiles-renderer
with three) and watch `pipeline/uv.lock`; CI runs e2e for `docs/` changes
(`wissen.spec.ts` asserts docs text); the unit job uploads the lcov and
lists the sources no test imports (`scripts/coverage-gaps.ts`: 42 files,
≈ 12 600 lines, `create-app.ts` first).

**Keep in mind.** A new viewpoint or slider fails `guide-labels.test.ts`
until both guides name it. A condensed or renumbered plan fails
`links.test.ts` until its links follow. If the dev server ever goes back
to HTTP, revert the scheme switch in `playwright.config.ts`.

## 038 — Five runtime fixes in the viewer's spine · DONE (2026-10-03)

**Problem.** Five defects, three of them on phones: (1) the sun's shadow
camera streams tiles but three updates it only while it renders the
shadow, which an invisible sun never does — after dusk it pinned the tile
under its last daytime frustum (the memory governor cannot evict a tile
in use); (2) "loaded" waited for the spawn's dressing, which only its fine
level carries — a jump away before that level loaded left fog capped and
the pill at 99 % for good; (3) GPU recovery allowed two reloads per two
minutes, so a phone that lost its GPU ≈ 70 s after each boot reloaded
forever, and the next page hid every crash report for two minutes after
a recovery; (4) a ⌘ chord left a movement key held (macOS sends no keyup
under ⌘); (5) a jump or a glide with live mode on was pulled back by the
GPS 1–3 s later.

**Outcome.** (1) `reposition()` updates the shadow camera's matrices
itself. (2) The boot machine takes `spawnDressingTried` and
`spawnFineLoaded` and waits for the spawn's dressing only while its fine
level is loaded (deviation: the decision lives in the pure machine, so the
regression is unit-tested there). (3) Two reloads per ten minutes;
`offerAsCrash` (`lib/city/crash-trail.ts`) drops only a page that reloaded
itself and, after a recovery, a record that never drew — a recovered page
that then died is offered; the "graphics failed" message has its own path
to the HUD (`onFatal`), no longer under the layer-failure prefix. (4) A ⌘
keydown presses nothing; releasing ⌘ releases every key. (5)
`applyCameraState`, `teleportTo`, `flyTo` and `flyToViewpoint` end the
follow; `placeAt` (the GPS fix itself) does not. Each fix has a test that
fails without it.

Review follow-ups (same day): by night the shadow camera is taken off the
stream altogether (`streamShadowTiles`: it draws no shadow, so its tiles
were memory for nothing); the crash trail keeps a `drew` flag beside its
40-event ring, and any `reloading` note marks a recovery reload.

**Keep in mind.** `__poc.ready` no longer guarantees the spawn is dressed
when the camera left it before its fine level came (the specs start at
the spawn). "Not coming" rests on `tiles-load-end` firing only at the end
of an `update()` that requested nothing new (3DTilesRendererJS 0.5.3) —
re-check that on an upgrade. Releasing ⌘ releases every held key, a key
still held included (re-press it): macOS gives no keyup to tell them apart.

## 041 — Tests where the regressions are · DONE (2026-10-03)

**Outcome.** The tile cache's raster weighing moved into `RasterShares`
(`app/_components/raster-shares.ts`, behaviour unchanged) with its tests;
two tests pin the freeing of a load the renderer aborts after its compile
and the keeping of one it records; `collision.test.ts` runs the building
collider through a real three-mesh-bvh BVH (roof above from inside, none
under a slab, top over a point, free / head-on / oblique steps, the knee
ray, a moved building) — each guard checked to fail without its rule. The
layer census counts kerbs; the e2e census asserts stairs, kerbs and the
sports fixtures; a new e2e test stands the walker on the Canaletto meadow
and checks its height against the committed DGM (± 0.5 m). Every inked
picture style has its pens; the pipeline-anchor test reads three's own
`getGeometryCacheKey`. `features.test.ts` gained plan 008's leftovers:
every GeoJSON is a FeatureCollection, a baked canopy has trees, bridge
kinds and rail track counts in range, roof colours `{ meta, roofs }`.

**Keep in mind.** Tree rows stay allowed empty (Grimma's and Munich's
outer tiles have none). A new dressing part or terrain node gets a census
line and an e2e assertion in the same change. The collider tests are the
spec of ADR 0032's ray rules.

## 042 — Less main-thread churn while tiles stream · DONE (2026-10-03)

**Problem.** Every tile event (≈ 4 per tile) ran a whole-scene stats pass
and handed the HUD a freshly flattened list of every footprint of the site
(≈ 40 000 polygons): the minimap repainted its static layer each time. The
fifteen footprint files competed with the spawn tile's glTF; the viewer
chunk waited for the manifest's round trip.

**Outcome.** Stats coalesce into one pass at most every 250 ms (a timer,
so they arrive while the e2e holds frames); the first frame and the
loaded moment flush them. The footprint list is cached under a version a
landing file or a demolish bumps — the same array otherwise, so React
bails out and the minimap's effect does not re-run. The footprints load
after the handover. The viewer chunk starts with the manifest (a second
`import()` of the same module from an effect; the one inside `dynamic()`
stays written out, Next matches its chunk by it).

**Keep in mind.** Anything new that changes footprints (an undo of a
demolish) bumps `footprintVersion`.

## 044 — The canopy points packed, not GeoJSON · DONE (2026-10-03)

**Problem.** The canopy and scan-tree points were the browser's biggest
parse: up to 8.6 MB of GeoJSON a tile (81 269 features on 33416_5658), one
`JSON.parse` of **96 ms** (V8, measured on the published file) that cannot
be sliced, three objects per point.

**Outcome.** `prepare-data.ts` publishes `canopy_<t>.pts.gz` and
`canopyx_<t>.pts.gz` (`lib/city/point-pack.ts`: a 32-byte header, float32
x/y relative to the tile's south-west corner — a tenth of a millimetre —
then `h`, and `r` for the scan trees; pre-gzipped like the glTF since
static hosts do not compress binary types). The dressing reads them with
`fetchOptionalBinary` (the optional-artifact policy, inflated by the gzip
magic) into the same features as before. 33416_5658: 0.40 MB on the wire
(was ≈ 0.49 MB host-gzipped), **≈ 13 ms** to unpack into the features
(V8), most of it the object creation. The committed GeoJSON stays the bake
contract; a test packs a committed `canopyx` file and gets it back within
a millimetre.

**Keep in mind.** If the dressing still shows a long task here, hand the
`Float32Array` to the vegetation instead of feature objects (phase 2), and
pack the street-tree cadastre (`trees`) with a small column set.
