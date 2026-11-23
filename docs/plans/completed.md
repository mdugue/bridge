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

See [ADR 0024](../adr/0024-site-streams-as-3d-tiles.md).

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

See [ADR 0009](../adr/0009-shadow-recipe.md).

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

See [ADR 0024](../adr/0024-site-streams-as-3d-tiles.md).

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

See [ADR 0018](../adr/0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md).

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

See [AGENTS.md, Conventions](../../AGENTS.md).

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

See [ADR 0024](../adr/0024-site-streams-as-3d-tiles.md) and
[ADR 0009](../adr/0009-shadow-recipe.md).

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

See [ADR 0009](../adr/0009-shadow-recipe.md).

## 016 — `Bun.Image` instead of sharp for the raster downsample · REJECTED (premise gone)

**Problem.** sharp, the build step's only native dependency, existed for
one downsample, and its premultiplied-alpha resize had painted the ground
black when the RGB splat's alpha carried water coverage (fixed in #29 by
resizing colour and alpha separately).

**Outcome.** Overtaken by [ADR 0010](../adr/0010-opaque-clay-buildings-only.md):
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
tile. Phase 7 (KTX2 splat) became moot with ADR 0010, since the colour
splat is painted on the GPU from the 1 B/px class raster. The 1 km cells
(Phase 6) became the two terrain levels. The proposed ADR 0024 was never
accepted.

**Keep in mind.**
- The recenter offset stays one constant from the spawn tile's CityJSON
  matrix. float32 keeps ~1 mm at 10 km and ~4 mm at 50 km from the
  origin; a floating origin only matters beyond ~30 km.
- Anything added after the first frame must re-render the shadow map and
  respect disposal. With streaming it also has to leave again: build it
  in the tile plugin, never in `bootApp`.
- The fixed lamp light pool (ADR 0009) is fed from the visible dressings;
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

## 022 — Re-bake from the current editions, the whole chain · DONE (2026-11-05)

**Problem.** Planned 2026-09-24 for the four original Dresden tiles,
which then still carried the old bash bake's land cover, canopy, NDVI and
roof colours from the June 2026 Basis-DLM; about thirteen later steps
read the class raster, so a re-bake had to be the whole chain, step by
step (plan 040 step 1), not the land cover alone.

**Outcome.** Overtaken in part: every site was re-baked by the Python
pipeline on 2026-10-20/21 and 2026-11-01 (the 2026-10-20 package). On
2026-11-05 GeoSN served a new package (`basisdlm_akt.csv` and the inner
ZIP dated 2026-11-04), and the collected re-bake (with plans 040, 045
and 081) ran every tile step of the four Saxon sites on it. Land cover
against the committed bake: Dresden's three western tiles (33408_*)
99.986–99.995 % of texels the same, no class lost (class 1 −1 % on
33408_5654), the other twelve identical; Leipzig, Grimma and Meißen
identical. Downstream on those three tiles: canopy ±1–4 points, edges,
kerbs, markings, surface and sky view. NDVI and roof colours unchanged
(same flight). The OSM input was the committed bake's (BBBike city
extracts of 2026-10-31; Geofabrik reset every connection from the
container), so the diff isolates the edition and the code. No plates
were taken (no GPU); nothing in the diff called for one.

**Keep in mind.**
- The package is replaced under the same URL: record
  `basisdlm_akt.csv`'s date at every download (each Saxon site's
  `provenance.json`, the guide's editions table).
- GeoSN's laser scan answered 404 (2026-11-05), so the Saxon `lowveg`
  and `small-buildings` files are still the September bake's
  (maintainer actions).
- Hamburg's OSM land cover moved by up to 2.1 % on 2026-11-05, but that
  was plan 045's parser (steps `width=100 cm` had burned 100 m wide
  paths), not an edition.

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
≈ 1 030 km over the fifteen tiles); since ADR 0030 its back meets the
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
Rejected: a raised pavement behind the kerb (ADR 0030 meets the pavement
at its own level, never a step the data lacks) and DGM1 micro-relief as a
normal texture (the fine level is a ±0.15 m TIN, ADR 0030, and
`terrainNormal` in `terrain-layer.ts` calms near-flat normals on purpose:
under a low sun they read as dirty flecks). Not planned: shell-textured
grass, demoted to a ledger idea — the maintainer has vetoed sub-pixel
detail again and again (🗃️ drawn fence panels, allotment bed bands).
Moved: the GPU look and frame time to plan 019; the DLM `sie02_f` split
and LSC intensity to the [data-streams survey](../data-streams.md) (ledger 📋 #12); trees inside the
carved parks to plan 022's canopy re-bake after land cover.

See [ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md),
[ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md),
[ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md), the
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
stretch shorter than 20 m, the track cut where it changes (ADR 0030;
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

See [ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md), the ledger's
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

**Outcome.** No new land-cover class (ADR 0010): dressing only.
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
*Allotment bed bands*), [ADR 0010](../adr/0010-opaque-clay-buildings-only.md)
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
in `scripts/bake-tiles.ts`, ADR 0030); `fence-layer.ts` is only the
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
and shimmer and are 🗃️ in the ledger. ADR 0030 (2026-10-01): the band's
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

See [ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md),
[ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md), the
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
- *Horizon shade* (*Ferne Schatten*, default 0.8; [ADR 0009](../adr/0009-shadow-recipe.md)):
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

See [ADR 0009](../adr/0009-shadow-recipe.md), the
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
([transformations.md](../transformations.md)), [ADR 0030](../adr/0030-terrain-tin-and-wall-snap.md)
(the box's ground join) and plan 019.

## 035 — A hidden soundscape · REJECTED (removed 2026-10-10)

**Problem.** The maintainer asked for a surprise, opt-in and hidden: the
city made audible from the same data the picture reads — footsteps by
paving, the Elbe, wind and leaves, birds and crickets by season and hour,
the city's hum, church bells at the full hour, a tram bell — with no
audio files and no dependency.

**Removed 2026-10-10**, never heard: the maintainer decided to drop it
to cut code and maintenance, before the listening pass (plan 019) was
done. The engine, the switch and the L key, the tileset's `sound`
column, the `soundmarks` bake, its committed files and their docs are
gone; the full implementation is in git history (`5b59b79`, the last
commit carrying it). What follows is the record of what was built.

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

See the ledger's 🗃️ row ([transformations.md](../transformations.md)).
Revive only with a listening pass first, not as a re-audit finding.

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

## 039 — Bridge ramps, rain that lasts, Papier's ribbons · DONE (2026-11-05)

**Problem.** A ramp quad whose first column is flush with the ground had a
zero normal (`normalize(0)` is NaN on the GPU: a black face). Sin City's
rain hashed a cell index that grows with the clock and lost its pattern
after about an hour. Papier's override drew double-sided things from one
side.

**Decision.** `rampNormal` sums both triangles' normals; a pair of flush
columns draws nothing. The rain's cell is `mod(cell, 1024)` before the
hash. Opaque double-sided materials draw a stand-in, the card with their
side and position, shared per side and position, freed at the gather after
its last mesh left (`paper-scene.ts`). Step 3 (rails under a deck) was moot
since ADR 0041.

**Deviations from the plan, both found by reading three or a plate.** The
plan swapped `mesh.material` for the frame. A stand-in has `allowOverride =
false`, so the shadow pass would draw it too, reading the shadow map it
draws into. So a frame hands stand-ins over through the renderer's object
function, which the shadow pass replaces with its own; only `swapped`
(a compile takes no object function) wears one on the mesh. The plan also
carried `maskNode` over so that winter crowns stay bare: on a Mac GPU the
pen outlined every gap and the crowns turned into dark grey clots, so the
card draws them whole, as before. The clay and a design (`userData.figure`)
stay with the override.

**Verified.** The ramp test fails without the fix (the flush column has to
be the *first*: as the last, the old normal had area). Plates on a Mac GPU
of a retaining wall from both sides, against the stand-ins switched off:
without them trunk feet and grass show through its missing back, with them
it covers. An eye-level colony view with no ribbon: unchanged. Not done:
the rain watched for an hour, a ribbon judged in Sin City (plan 019).

**Keep in mind.** A new opaque double-sided material gets its stand-in by
itself; a new see-through one stays hidden in Papier. Masks stay out unless
the pen learns to ignore them.

## 040 — Bakes that read finished neighbours, keep their seam stairs, never trust a half-written file · DONE (2026-11-05)

**Problem.** (2026-10-01) `bun run bake` ran tile-major while several
steps read their neighbours' outputs; the stairs bake read only its own
tile's DGM, so a flight crossing a seam had no landing and was dropped by
both tiles (0 of 1 197 flights crossed one); the ingest extracted
non-atomically with no timeouts; `prepare-data` trusted a half-written
file by name; the `/wissen` hero was baked square on a 5 × 3 site.

**Outcome.** Refreshed against `8b8ec332` (2026-11-04): the runner was
step-major already (`Bake.step`, `--jobs`), the fetch's timeouts, `.part`
writes and complete-DLM check and the hero's `cell * rows` were built.
Built then: step 1's tests (every `run` in `STEPS` once; a failing step
names site, tile and step; the stairs/walls/rail-from-OSM fixtures on EPSG
25832 too), step 2 (`stairs.Dgm` on a mosaic of the committed DGMs within
50 m, `mosaic` in `common.py`), step 4 for the publisher (the cache already
wrote through a part file). The stairs re-bake ran 2026-11-05 on every
tile of every site: Dresden 6 flights more, Leipzig 1, München 4, a few
redrawn; Meißen, Grimma, Hamburg, Unna none more.

**Keep in mind.** A step that reads a neighbour's file runs for every tile
before the next step (never `--tile` alone for such a step). A flight's
landing comes from the mosaic, so a missing neighbour DGM drops the flight
again.

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

## 043 — The city BVH in a worker · CLOSED (2026-11-04; built in another shape)

**Problem.** `dressCity` built three-mesh-bvh's BVH over every city tile
synchronously inside `processTileModel`: a median 75 ms a tile (38–116 ms
for 90–209 k triangles, Bun, desktop-class), plausibly 3–5× on a phone,
rebuilt each time the memory governor reloads a tile.

**What happened.** Stopped twice. 2026-10-03: the worker built and
tested (indirect mode, serialized nodes transferred, 0.2 ms to
deserialize), but the build seemed not to bundle — Turbopack copies the
worker's source to `/_next/static/media/*.worker.ts`. 2026-10-11 (the
spawn tile only, after plan 069 made the BVH lazy): that asset is a
leftover nothing loads; Next 16.3.7's Turbopack **does** bundle the
worker (`turbopack-worker-<hash>.js` + `importScripts`). Stopped instead
at the chunk: three's core and three-mesh-bvh shared with the worker left
the scene chunk's scope (ADR 0040), +20.8 KB gz first-load JS (904 985 →
925 796), and mobile-emulated the first frame came later (the lite boot
has nothing to overlap once its ground has landed; the worker's build ran
3× slower beside SwiftShader's frames). Built on 2026-10-26 (`038d55a`)
in another shape: the BVH is lazy (plan 069 step 7 — a ray builds a
tile's when it first reaches it), and the tiles within 400 m are built
ahead **in the BVH worker** (`bvh-client.ts`, `bvh-worker.ts`): on the
main thread a dense tile had taken 0.2 s on a desktop and 0.8–1.6 s on
the phone profile, the longest stall of a flight. The spawn tile's stays
on the main thread at the placing (ADR 0032); `docs/rendering.md` has
the whole rule.

**Keep in mind.**
- The positions and index are handed over, not copied (35 MB a dense
  tile), so while `bvhBuilding` says so nothing reads the tile's CPU
  arrays: a step waits, a pick answers nothing, a demolish and the outline
  wait, the autofocus passes it over (AGENTS.md, Rendering).
- The job carries the positions as GLTFLoader gives them (int16,
  `normalized`, interleaved at stride 4); three-mesh-bvh's
  `GenerateMeshBVHWorker` would throw on that attribute.
- The worker's first-load chunk cost was not measured again after
  `038d55a` (it imports `three/webgpu` and three-mesh-bvh). If it matters,
  the 2026-10-11 options stand: a worker bundle of our own (`Bun.build`
  into `public/`), or a worker without three (`buildPackedTree`).

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

## 045 — One source for the raster decoders and the class ids · DONE (2026-11-05)

**Problem.** (2026-10-01) A decoder copied instead of shared let a test
pin a copy the shipped code did not use (`surfaceHeading` decoded
0–180° while bake and shader used 0–360°); the land-cover class ids were
integer literals in eleven bake modules; OSM numbers were parsed by
helpers with different rules (`"1,5"` was 1.0 in one, 1.5 in another).

**Outcome.** Refreshed against `8b8ec332`, steps 1–4 (2026-11-04).
`surfaceHeading` deleted (no caller; ground-detail.ts's `div(254)` is
the one live decode, the bake's `heading_code` pinned by `test_bakes.py`).
The class ids in `pipeline/bake/classes.py`, named in every bake, values
pinned by a pytest (a module of their own: landcover.py imports the
modules that name classes). One parser family in `osm.py`: `osm_number`
(decimal comma, units), `osm_metres` (metres; `cm`/`mm` converted; feet,
ranges and lists none), `osm_width` (within 0–60 m) — for every width,
height and length reader (stairs, walls, hedges, bollards, piers, gates,
platforms, decks, carriageways, driveways, the class raster's ways, the
monuments' `height`); `step_count` stays on `osm_number`. The byte scales
(`EDGE_SCALE`, cultivated, markings) pinned by text across languages.
Re-baked 2026-11-05 on every site: the visible change is Hamburg's OSM
land cover, where 36 flights of steps tagged `width=100 cm` had burned
100 m wide paths round the Hauptbahnhof (32566_5934 97.9 % of texels the
same, 32564_5934 99.45 %; the paths went back to railway, background and
settlement, and the furniture standing on them went too); elsewhere one
wall height each in Leipzig and Hamburg.

**Keep in mind.** A new reader of a tagged length goes through
`osm_metres`/`osm_width` with its own bounds, never a regex of its own.
The Saxon `lowveg` (hedge heights) waits for GeoSN's laser scan.

## 046 — Moves only: split the god modules and sweep · CLOSED (2026-11-04; drifted, the rest in the backlog)

**Problem (2026-10-01).** `rail-layer.ts` (2 191 lines) was also the
geometry library of the tram and riverside layers; `bootApp` one
≈ 1 040-line closure with telemetry and picking inside; `ground-detail.ts`
the de-facto TSL helper library; `water-layer.ts` ↔ `terrain-layer.ts`
an import cycle; vendored shadcn components, exports and a `hooks/` file
nobody needed. Planned as moves only — no formula, constant or geometry
change.

**What happened.** Never executed as written; it drifted (2026-10-06
amendment) and the code moved under it. Done elsewhere by 2026-11-04:
the mesh kit (`app/_components/mesh-kit.ts`, shared by rail, tram,
riverside and catenary, its winding tested — backlog item 21); the pure
deck table (`lib/city/decks.ts`); the cycle (`splat-uv.ts`; water keeps
a type-only import of `SplatLayer`); the GPU-loss trio
(`lib/city/page-lifecycle.ts`, plan 066); most of the dead exports
(dropped or moved into their tests in the 2026-10-24 test audit;
`screenOfPoint` kept for QA). Step 2 — telemetry and picking as
section-sized modules out of `bootApp`, now 4 539 lines — is dropped:
the 2026-11-04 review found such sections read 10–20 of `bootApp`'s
locals and fail the deletion test, so only pure functions move (backlog
item 14); demolitions are item 26's. What is still worth doing — the
rest of the rail split, a home for the TSL helpers, the sweep — is
backlog item 27.

**Keep in mind.** New layers import geometry from `mesh-kit.ts`, never
from `rail-layer.ts`. `aesthetic-sandbox.html` waits for the
maintainer (README, Maintainer actions).

## 049 — Many sites: fetch, bake, build, a route per site · DONE (2026-10-01)

**Problem.** Plan 017 made one site configurable; nothing made several
operable. Each Land's portal had to be read by hand, the providers ship
CityGML (the build reads CityJSON, and `citygml-tools` needs a JRE), and
Dresden's data lay flat in `data/`.

**Decision (ADR 0037).** What belongs to a **provider** (the Land: EPSG,
credit and licence, portal, OSM extract, which products are open — DOM1,
RGBI or RGB, a Basis-DLM, a laser scan —, the tile suffix) is one typed
table, `sites/providers.ts`; a **site** is a label, tiles, viewpoints and
its provider. Raw downloads are shared per provider
(`data/_raw/<provider>/`: Leipzig, Meißen, Grimma and Dresden share one
statewide DLM and one OSM extract); committed sources are per site
(`data/<site>/{dgm,cityjson,dlm,dop}` + `provenance.json`). Three
stages: `bun run fetch <site>` (network; adapters per Land in
`pipeline/bake/providers/`), `bun run bake <site>` (offline), `bun dev` /
`bun run build`; `bun run site <site>` reports (`lib/city/site-report.ts`).

**Outcome.** A streaming CityGML → CityJSON converter for the AdV LoD2
profile every Land publishes (`pipeline/bake/citygml.py`), no Java; a
building belongs to the tile holding its envelope centre (plan 057 made
the fetch honour that). The DGM sources are written compact: tiled
DEFLATE GeoTIFF with the float predictor, rounded to centimetres — 5.6
instead of 15 MB a tile, ≤ 5 mm off after the resample. Dresden's
manifest stayed byte-identical through the move. Round 2 (2026-09-27)
dropped the `SITE` variable: one deployment serves every ready site
under `/<site>` (`app/[site]/page.tsx`, prerendered, unknown ids 404,
`/city` → `/dresden`); `scripts/prepare-sites.ts` prepares each into
`public/data/<site>/` and writes `sites.json`; `/` is a start page with a
card per city on its `site-map.webp`. Leipzig, Meißen, Grimma, Unna,
München and Hamburg were fetched, baked and — the maintainer's decision
— committed (≈ 310 MB beside Dresden's 470 MB; plain git, the largest
file 16 MB, no LFS).

**Numbers.** OSM land cover against the DLM on Leipzig's centre tile:
71 % of texels agree (water 95 %, settlement 78 %, roads 55 %).
`public/data` for seven sites ≈ 340 MB.

**Keep in mind.**
- Berlin is configured, never fetched (`gdi.berlin.de` failed TLS from
  the container; the adapter follows the ATOM feeds' documentation) —
  README Open work item 2.
- The OSM layers of the non-Saxon sites and Unna were baked from
  stand-in extracts (BBBike, openstreetmap.fr), named in each
  `provenance.json`. NRW's, Bavaria's, Hamburg's and Berlin's laser scans
  are not read by their adapters.
- Open on a GPU: small black squares in some headless SwiftShader shots
  (one dressing layer, likely the lite profile) — plan 019, section N.

## 055 — Modell, the city in parallel projection · DONE (2026-10-03; three looks unjudged on a GPU — plan 019)

**Problem.** Planners read a city in parallel projection — Isometrie,
Vogelschau, Militärperspektive, Lageplan, Ansicht, Schnitt — with a
scale bar, a north arrow, a Schwarzplan and shadow studies. The viewer
had one perspective camera, and every depth-reading post term, every
distance-keyed LOD and the shadow fit assumed it.

**Decisions (the maintainer, 2026-10-03).** A third camera mode,
*Modell*, beside Gehen and Fliegen (`M`); a real `OrthographicCamera`,
not a long lens (exact, the oblique projection possible, no float32
depth games 40 km out); all five phases at once; *Strich* and
*Schwarzplan* are picture styles in every mode (`V` cycles seven); the
scale bar carries its numbers as HUD legend on the HUD's glass (ADR 0042
holds: nothing pinned into the scene); free roaming stays parallel
(Isometrie keeps its 35.26° tilt, `atan(1/√2)`, the turn free).

**Outcome ([ADR 0044](../adr/0044-modell-parallel-projections.md)).**
A pure rig (`lib/city/model-view.ts`) and its binder
(`app/_components/model-rig.ts`); the Militärperspektive a sheared ortho
matrix, so picking goes through one ndc unproject for every camera. **One
pipeline:** the post passes read the active camera through `view-lens.ts`,
and the parallel camera stands `MODEL_STANDOFF` (20 km) back so the
scene's perspective-built branches stay right to a fraction of a degree
— entering Modell builds nothing. The Schnitt cuts at the near plane, the
clay drawn two-sided while it shows, its back faces the poché (the paper
styles are one-sided: a cut building is open). The Ausschnitt clips by
four uniform planes, buildings included (keeping whole buildings by
centroid needs a per-object centroid — not done); its first use builds
the clipped programs in the frame. The export is tiled one tile per
animation frame (SMAA and GTAO render once a frame), up to 4× the canvas
and 25 MP. The shadow study is one sheet of 3 dates × 4 hours (21.3.,
21.6., 21.12.; 9, 12, 15, 18 Uhr device time), ≤ 6 000 px wide.
Follow-ups (2026-10-04): the twist's sign (`twistedTurn`), trees at every
scale (each terrain level carries its trees, the coarse one a third, √3
wider), the bridges' surfaces.

**Look rules.** Paper, not sky, where the site ends; no distance fog,
depth grading, vignette or DoF ("far" is "higher up the sheet"); ink
lines constant in screen pixels; the vegetation LOD keyed to the view's
scale, not the camera's distance.

**Rejected.** Modell as a picture style (a projection changes picking,
LOD, shadows and streaming); Isometrie as the 2:1 game dimetry (edges at
26.57°); a canvas or SVG redraw of the plan (the minimap is that).

**Keep in mind.** Still to judge on a real GPU: the specular and halo
branches built for the perspective camera, the water's glitter in a
parallel view, Strich's washes (plan 019, section N). The study's hours
are the device's, not Dresden's (backlog: *the scene clock's zone*). Not
in scope then: ALKIS parcels and B-Pläne under the model, a measuring
tool.

## 056 — The markings rasters test finds its data again · DONE (2026-10-07)

**Problem.** The one test of the committed road-marking rasters globbed
`data/dlm/`, gone since the data moved per site (2026-09-30); pytest
turns an empty `parametrize` into a skip, so for a week the suite was
green (`359 passed, 1 skipped`) while 32 re-baked tables went unchecked.
It also hard-coded EPSG:25833.

**Outcome.** The test walks `data/*/dlm` as `test_committed.py` does,
reads each table's `crs`, ids read `site/tile`; `pipeline/pyproject.toml`
sets `empty_parameter_set_mark = "fail_at_collect"`. 32 tables over seven
sites, 0 skipped. Deviation: the bound scales with the raster
(`DROPPED_OK × size / px` — 0.5 % at 2048², 1 % on the phones' 1024²).
The one table over 0.5 %, Leipzig `33318_5688_2_sn` row 22 (a signalled
crossing over a zebra at an angle), loses 0.8 % at 1024² and 0 % at
2048²: the shared corner texels are twice as wide there — what the code
bakes, not stale data.

**Keep in mind.** Every test over committed data uses the `data/*/dlm`
glob. `fail_at_collect` fails a checkout without any `data/<site>/`:
revisit the setting, not the test, if the data ever leaves the repo.

## 057 — Seam buildings are fetched and kept · DONE (2026-10-07)

**Problem.** The converter keeps a building only in the tile holding its
envelope centre, which assumes the provider's files overlap at the seams.
Saxony's 2 km files do not: GeoSN files each building once, by another
rule. Dresden's committed tiles (converted whole by the older path) hold
9–34 buildings a tile centred outside it, 0–2 of them in a neighbour;
Leipzig's pipeline-converted tiles held none — so 10–35 buildings
dropped silently per 2 km seam. The 1 km providers read only the cells
inside the tile and lost the rim alike.

**Outcome.** `cells(tile, km, margin)` and `own_cells`
(`pipeline/bake/fetch.py`): sn, nw, hh and be read one ring of cells for
LoD2 (the rasters keep margin 0 — their mosaics are clipped to the
tile); `convert()` dedupes by `gml:id`. A margin cell is skipped only on
a 404/410 (past the Land's border); any other failure raises. Saxony's
LoD2 ZIPs stay under `data/_raw/sn/downloads/LoD2_CityGML/` (a site of N
tiles reads N + 2√N + 4). Adapter tests for sn and nw. Deviation:
`by.py` untouched — Bavaria's LoD2 is a 2 km grid (a STOP condition);
backlog, *Bavaria's LoD2 reads its own 2 km cells only*.

**Keep in mind.** The ownership rule and the margin are a pair: whoever
changes `owns()` or the tile size keeps "every file that can hold an
owned building is read" true. Re-fetching Leipzig, Grimma and Meißen is a
maintainer action (README; `_step` skips an existing CityJSON — delete it
first).

## 058 — The Standort hand-off stays off the server · DONE (2026-10-07)

**Problem.** When *Standort* found the visitor in another city of the
deployment, the dialog linked `/<site>?at=lat,lng` (six decimals). That
put the position in the host's request log and in `Referer`s, in the
crash trail in local storage (it recorded `pathname + search` at mount,
before the first frame stripped the query) and in the crash card's text
— against the privacy page's "Dein Standort verlässt dein Gerät nie".
The automatic reports were not affected (`path()` drops the query).

**Outcome.** The fix travels in the fragment, `#at=lat,lng` (never sent
to a server, never in a `Referer`), dropped with `replaceState` at the
first frame; the trail keeps only the known QA knobs of a query
(`TRAIL_QUERY`, `crash-trail.ts`); the privacy page, the guide and
AGENTS.md's knobs say so. Deviations: `arrivalOf` requires the leading
`#` (`URLSearchParams` strips a `?` too), and `crash-trail.test.ts` is
new (`trailUrl` is pure).

**Reversed (2026-11-05).** The maintainer moved the hand-off back to the
query, `?at=lat,lng` (with plan 048's `?snap=`): URL parameters go in the
query, for diagnosis in the host's request log and so several parameters
sit side by side. What stays: the trail keeps only `TRAIL_QUERY`, the
reports send the path alone, `arriveAt` drops `at` with `replaceState`,
and the privacy page now says plainly that the link carries the real
position into Vercel's request log.

**Keep in mind.** A position in a URL goes in the query and is named on
the privacy page (ADR 0043). A new query knob worth seeing in a crash
record joins `TRAIL_QUERY`; one that carries a place never does.

## 059 — Storage keys pinned to the privacy page · DONE (2026-10-07)

**Problem.** ADR 0043's rule (a storage key or third-party request is not
done until `/datenschutz` names it) was kept by eye and had slipped: ten
keys in eight files, nine on the page (`crash-trail.reported` missing).
The reports' opt-out — the switch, `reportsDeclined()` before every
beacon, the in-memory "no" — had no test at any layer, and CI builds
without a DSN.

**Outcome.** `app/_components/storage-keys.ts`, one table every writer
imports its key from; a unit test that each key's literal and each
live-feed host appears in the page's text (the page names keys in
backticks); tests for `report-choice.ts` and the sender's gate. No
behaviour change. Deviation: the report-choice test loads its own module
instance (a query specifier) — Bun's test files share a registry and the
sender's test loads it with a DSN. The BroadcastChannel name
`crash-trail` and the Sentry logger label stay literals (not storage
keys).

**Keep in mind.** A new key: a row in `STORAGE_KEYS` and its name on the
page; a new live host: the page (plan 053's feeds are next). Not built:
one try-wrapped storage accessor for the hand-rolled wrappers (optional),
and an e2e that toggles the switch (CI's build would need a dummy
`NEXT_PUBLIC_SENTRY_DSN`).

## 060 — The spine fails loudly and settles · DONE (2026-10-07)

**Problem.** Eight untested defects in the viewer's spine: (1) a
dressing build that failed was swallowed (`.catch(() => {})`) — bare
tiles, no note, and an allocation failure bypassed the memory emergency;
(2) three's `Animation` asks for the next frame before it calls the loop,
so a throw before the render re-threw every frame — a 60 Hz storm into
the trail's `localStorage` write and the problems counter, no reload;
(3) a failed Ausschnitt hold stayed "pending"; (4) one HUD error latch a
page hid later failures; (5) a dressing whose compile outlasted the 3 s
wait was hung on a released root; (6) heartbeats after the render stopped
counted as 0-fps frames; (7) `exitNow` during Modell's entry kept the
dolly's FOV; (8) a `pointercancel` scored as a tap.

**Outcome.** All eight. Deviations: the HUD's layer word takes the bare
message (the HUD prefixes it); a cut-out failure goes through the same
latch and is a problem kind; a layer word covered by a network one shows
again when that clears; the trail's coalescing is a tested
`errorCoalescer`; steps 1 and 5 drive the private queue through casts
(no fake timers); `model-rig.test.ts` is new.

**Keep in mind.** Every new way a tile can be incomplete (a builder, a
compile, a fetch) ends in a trail note with a kind in `PROBLEM_KINDS`
and, where the visitor sees a hole, in `onError`. A throw from the
stream's update on a working GPU is `"failed"` (a same-level reload),
not `"lost"` — `frameLoss`'s answers probe decides.

## 061 — The bake cache keyed per artifact · DONE (2026-10-07)

**Problem.** Every artifact's cache key held every module reachable from
`prepare-data.ts`: 68 modules, all ten `sites/*.ts` and the palette among
them. 40 of 267 commits since the cache was born re-baked every site
(≈ 2 min locally before `bun dev` served, ≈ 110 s on each of three CI
shards).

**Outcome.** Each `cacheKey` walks its own bake's entries (the import
graph from each, plus `prepare-data.ts`, the site's own config,
`bun.lock`, `patches/`); the levels CLI split into
`scripts/line-levels-cli.ts` so no bake reaches `sites/`; the fine
terrain keys on every tile's passages, the stats on the footprints'
content. Measured on Dresden: warm 1–2 s; still warm (2.0 s) after a
Leipzig config edit; a palette edit re-baked only the map picture
(3.3 s); a Dresden config edit the site (≈ 3 min). The entries became
one table later, `scripts/bake-entries.ts`, held by
`bake-entries.test.ts` (AGENTS.md, Data).

**Keep in mind.** A new artifact names its bake's entry modules. The
terrain keys include `scripts/line-levels.ts`, the city key
`scripts/measured-roofs.ts`. CI's restore key stays coarse on purpose.

## 062 — Traffic bodies built on the first switch-on · DONE (2026-10-07)

**Problem.** The counted motor traffic is off at start (ADR 0040) but
its bodies were built, compiled and weighed for every fine and coarse
level at every load: the spawn tile's 209 sections (47.4 km of lanes)
≈ 260 000 vertices ≈ 21 MB of GPU buffers for the fine level, ≈ 3.3 MB
a coarse level, plus JS copies — reasoned at 50–100 MB of a phone's
336 MiB tile cache, and the build ran inside every dressing's longest
task.

**Outcome.** The feature lists (30–60 kB a tile) stay in the dressing;
`TrafficSlot` (`tile-stream.ts`) builds the bodies on the first switch-on
per tile, in a task of its own: compiled hidden, then shown, weighed and
asked; kept while off, freed with the tile, nothing hung on a tile
released mid-build. Deviation: step 1 (no vertex normals) dropped — the
glass reads them.

**Keep in mind.** Features at load, bodies on demand, bytes reported
when built: the rule for a fourth data layer. `hide()` keeps the bodies;
it may dispose them if phone memory ever asks. Plan 083 proposes one
lifecycle for these bodies, the dressings and the murals.

## 063 — The build and the fetch fail loudly · DONE (2026-10-07)

**Problem.** Five places hid a failure or depended on the machine: a
freshly baked site without the hand-kept `provenance.json` passed the
readiness check and then killed `prepare-data` — no site served; every
error in the TIN builder fell back to the grid as "NoData"; `bun run
fetch` exited 0 whatever failed, four per-tile fetches ran outside
`_step`, and a non-JSON Wikidata answer aborted the rest; the Wikidata
and GTFS caches were written in place (a killed run left truncated JSON
every later fetch kept); `siteLandmarks` broke ties with a locale-less
`localeCompare`, so `tileset.json`'s hash and the HUD's list depended on
the build machine's locale (Dresden: 194 of 289 landmarks tied).

**Outcome.** All five. A site without the record builds, and
`scripts/site-report.ts` notes it (`absentSiteFiles` in
`lib/city/site-report.ts`); only a NoData grid falls back; the fetch
exits non-zero on a required product and guards every per-tile fetch;
the caches go through `.part` + rename (tests in
`pipeline/tests/test_caches.py`); landmarks tie by id, as the Python
ranking does. An unreadable trams cache is derived again rather than
kept.

**Keep in mind.** A new per-tile fetch goes inside `_step`/`_try`, a new
cache writer through `.part`, a new required product into `fetch_tile`'s
required list. A DGM with holes still gets the grid (backlog: *DGM NoData
blended by the resample*).

## 064 — CI hashes what it means and clones what it reads · DONE (2026-11-04)

**Problem.** Measured on `.github/workflows/ci.yml` at `4b0310a`: the
Next-cache key's `hashFiles('**/*.ts', …)` walked `node_modules` (11 541
files against the repo's 476); every job cloned 811 MB of geodata (the
comment said ~130 MB), lint and typecheck included; the shard comment
said ~100 / ~135 / ~125 s where run 37476256017 measured 149 / 220 /
340 s.

**Outcome.** The Next-cache key hashes the repo's own source folders
(`types/**/*.ts` added on review); Lint and Typecheck check out sparsely
without `data/` (`sparse-checkout` with `!/data/`, cone mode off — two
lines a job); the shards re-cut by tag from run 37496735478, `@phone`
moved to the HUD shard (the rendering group shares one booted page and
cannot be split by tag without a second boot). Implemented 2026-10-07
(`3de5ea2d`, `3fb9a505`); CI on `main` has run green since (e.g. runs of
2026-11-03/04).

**Keep in mind.** The spread criterion (shards within ~60 s) was never
met: the whole-site shard sets the floor (169–415 s for its one spec
since it streams five dressed tiles), measured 457 / 321 / 246 s on
2026-10-24 — the workflow's comment records the numbers and says a
cheaper whole-site boot, not re-tagging, would help. A new job that
reads `data/` must not copy the sparse checkout; a new top-level source
folder joins the Next-cache pattern list.

## 065 — The docs say what the code does · DONE (2026-10-07)

**Problem.** The docs an agent loads first were wrong against the code:
the city-walker skill gave EPSG:25833 and `_sn` tiles for every site
(three of seven are 25832) and missed the `traffic` and `transit` bakes;
README said "nothing persisted"; ADR 0001's storage list lacked
`gpu-safety`; ADRs 0024 and 0010 named deleted scripts; the ledger and
the data-streams survey listed built rows as open; AGENTS.md put
`report-choice` under `app/(legal)/`; `?at`/`safety` were missing among
the URL reads.

**Outcome.** Steps 1–6 as planned: the skill's frame per provider, the
complete bake list, README's CRS and storage, the ADR references, the
ledger (#15 marks only its built part ✅) and the survey (a Status
column). Not built: step 7, a backtick-path check in `links.test.ts` —
it also fails on paths that open plans propose to create (its STOP
condition).

**Keep in mind.** Without that check, a path move repeats this plan;
the skill's coordinate section stays per provider as long as the CRS is
(ADR 0037).

## 066 — The page lifecycle as a pure machine · DONE (2026-10-07)

**Problem.** The policies of ADR 0047's safety ladder were pure and
tested, but the wiring — which signal reaches which policy, in which
order, with which trail notes — was ≈ 130 lines of closures in `bootApp`
over a dozen `let`s, untested (no e2e loses a device), and the five fixes
of 2026-10-06 had each changed an edge of it.

**Outcome.** `lib/city/page-lifecycle.ts`: signals (`deviceLost`,
`frameFailed`, `allocationFailed`, `hidden`, `shown`, `dispose`) and a
clock in, effects out (`stopRender`, `note`, `reload`, `fatal`, `shed`,
`governorForce`, `holdShadows`, `raise`) — the shape of `boot-phases.ts`;
`create-app.ts` keeps a binder. 15 tests name the incident sequences.
Deviations: `gpuAnswers`/`gpuFailure` are lazy thunks (the probe is asked
only where the closures asked it); an initial `hiddenAt` for a page that
starts hidden; `onGpuLost` is asked inside `dispatch`, before the stop's
effects (the trail's note order unchanged). `create-app.ts` shrank by 45
lines, not ≥ 80: the binder keeps the effect map.

**Keep in mind.** A new lifecycle decision is a signal/effect pair with
a test; a decision that needs the DOM is a binder concern. `frameLoss`'s
"emergency before it" has no time window (rejected list); a test pins
it. Plan 079 builds the recovery session on this machine.

## 067 — Data layers and the twin: small fixes · DONE (2026-10-07)

**Problem.** Six defects in the newest layers: one failed timetable load
left the tram layer dead for the session (`loading` never reset); Dresden's
bicycle counts were judged in the viewer's zone (all grey in Tokyo, a
dead counter lit in New York); orchard trees were drawn but not askable;
a card on a non-Saxon site credited GeoSN and Dresden; a null element in
a feed threw out of the poll every five minutes; the bicycle feed polled
in hidden tabs.

**Outcome.** All six. Deviations: the tram failure is
`TramCarsStatus.failed`, shown by `TramStatusLine` in
`data-layers-panel.tsx`; orchard trees are marked `s: "orchard"` (a flag
bit in `ask-items.ts`); the zone is a fact of the feed
(`BikeFeedReader.zone`); credits come from `cardCredits(site)`
(`card-lines.ts`), `GEOSN_CREDIT` deleted.

**Keep in mind.** An overlay's lazy `load()` resets its flag in
`finally` and reports a failure through its status. A feed's times are
its city's zone, never the viewer's. Left: the bike card still formats
the count time in the visitor's zone (`inquiry-traffic.ts`) — part of the
backlog's *scene clock's zone*.

## 068 — The tile stream loads only what the fog lets you see · DONE (2026-10-10)

**Problem.** The tile renderer streamed for the walk/fly camera itself,
whose far plane is 6 km (the sky dome needs it). Three's range fog runs on
view depth — the far plane's measure — and ends at ≈ 2.6 km at the
default *Nebel* (1.1 km during the boot), and the sky's horizon band takes
the fog colour: every building tile and coarse level between the two was
loaded, compiled, given a BVH and drawn as plain fog colour, and city
tiles (error 100 000, ADD) never leave while in a frustum.

**Outcome.** A stream camera, the walk/fly camera's twin synced every
frame before the stream's update, with its far plane at
`streamFarFor(max(fog applied, the look's fog), camera.far)` = the fog's
end × 1.1 (`lib/city/atmosphere.ts`, `create-app.ts`). The larger of the
two fogs, so the boot's partial-world fog does not leave the tiles it
hides to load once it opens. Modell streams for its own camera
(`swapCamera`), the sun's shadow camera as before. Measured at Dresden's
spawn view (SwiftShader, full profile): the same tiles load — the view
looks south-west, and the site's edge lies inside 2.85 km there — so the
saving is in the views across the city (east from the spawn the second
ring of tiles, 3.8 km out, no longer loads) and from the air; the
plan's step 5 (stream at the boot's own fog) was not built.

**Keep in mind.** A new camera-driven streaming need registers against
the stream camera, not the camera. A future look term drawn past the fog
(`material.fog = false` on tile content) would vanish beyond its reach.

## 072 — A cold build bakes a site's tiles on every core · DONE (2026-10-31)

**Problem.** A cold build at `85a41b7` (4 cores, 15 GB, seven sites):
`prepare-sites` 419 s, of which **414 s** one single-threaded process
baking Dresden's 15 tiles one after another, three cores idle for its
last ~280 s; `next build` 61 s. And cold is common: the fine level's key
covers every tile's terrain inputs (ADR 0030), so an edit to a shared
bake module re-bakes all of Dresden.

**Outcome.** Tile warmers: a `--if-cached` plain run first (a warm build
runs no warmer), then one process per cold tile, admitted by cores and
memory (`scripts/warmers.ts` `bakeLimits`: 80 % of the memory or the
container's limit, a tile warmer counted at 3 GB, any other bake at
1.6 GB; `PREPARE_JOBS`, `PREPARE_MEMORY_GB`), the smaller sites first.
Atomic cache entries (`scripts/bake-cache.ts`); each tile's fine ground
its own entry (`scripts/ground-pack.ts`, ≈ 6.7 MB a Dresden tile), the
site ground reading a tile's heights only once a point asks; to rebuild
from the entry `bake-tiles.ts` split each mesher into shaping and meshing
halves. Every `manifest.json` identical to main's on every cold run.
History: on 2026-10-10 Vercel's builder (4 cores, 8.6 GB) showed no gain
(322 s against main's 232–235 s, two sites side by side already), so the
warmers were opt-in; by 2026-10-31 a whole cold site peaked at 4.5–6.1
GiB in one process, Vercel baked one site at a time, and two tile
warmers at once took all seven sites from 11:07 to 5:19 min on a box
held to that builder. Default since: on (`PREPARE_WARMERS=0` turns them
off) — `docs/data-pipeline.md`, *Bakes side by side*.

**Numbers.** Dresden cold, step 1: buildings 268.9 s, fine 265.3 s (the
site ground's first call, fifteen TINs, 202.7 s), coarse 31.8 s, line
levels 105.6 s. A ground warmer is Delatin and the DGM's LZW; a tile
warmer's top: `rayHit` (doors) 5.9 %, `unionArea` 4.2 %. Step 2 (a
cheaper gzip) skipped: 11.0 s over Dresden's 45 glbs at level 9, and a
level change rewrites every `.glb.gz`. Peak RSS: Dresden in one process
4.5–4.9 GiB, a tile warmer at most 2.7 GB; the warmers' start-up costs
≈ 10 % more CPU.

**Keep in mind.** Anything site-wide (computed from every tile) is cached
before the warmers start, or every warmer computes it again. Backlog
(2026-10-10 list): a finer fine-level key (the tiles a bake read, 1–9
not 15), tile warmers admitted by a size-based estimate. Optional, the
maintainer's: `typescript.ignoreBuildErrors` would drop `next build`'s
second type-check (6 s) that CI's typecheck job already runs.

## 073 — The look table frozen · DONE (2026-10-10)

**Problem.** Asked whether the sidebar's free parameters cost performance
or bundle. From the code: a slider that is a uniform costs almost
nothing on the GPU (each term runs at any value, 0 included — only
deleting a term saves work); the few real costs are construction-time
choices (DoF, contact shadows, multi-tuft crowns, `transparency`'s
hashed-alpha rebuild); the cost is code — the table, its store, a
versioned snapshot codec, the sidebar's groups, two guides a test pins
to the labels.

**Outcome.** On the performance PR the maintainer removed *Transparenz*
and *Blattflimmern* (*Windhelligkeit* baked) and fixed *Flussnebel* and
*Tiefenschärfe*; this plan fixed the other 25 percent rows with the
default table ("continue … don't ask in between"). *Nebel* is the one
slider left and the multi-tuft switch stays; every other value is a
named constant in its owner, its old `initial` (`GROUND_SHADE`, `RIM`,
`WINDOWS`, `AO_EXPONENT`, …); four keep an internal uniform that a style
or Modell writes (the valley haze, the grading, the grain among them). Old
snapshots still load: their 32 keys are parsed and never written
(`RETIRED_SNAPSHOT_KEYS`). ADR 0018 amended. Production code +382 −820
lines; ≈ 3 kB gzip (all chunks 996 759 → 993 509 B): the gain is code
and UI, not bytes. The default picture is the same by construction.

**Keep in mind.**
- Tuning a look is an edit of a named constant, reviewed with snapshots
  of place and time.
- Open on a GPU (plan 019, section N): plates of the frozen table against
  production (none taken in the container); then, measured, delete or
  tier-gate the most expensive fixed terms on phones (the clay's windows
  and facade reading, the terrain's ground detail) and the terms that
  compute nothing visible under the fixed full *Spiegelung*
  (`REFLECTIONS` = 1: the glass sheen in `clayGlow`, the gilding's
  stand-in in `monument-layer.ts`, the water's fog-colour stand-in), each
  with a plate pair.
- Two comments in modules the bakes import still call a term a slider
  (`lib/city/building-tint.ts`, `scripts/bake-city-mesh.ts`): fix them
  with the next change that re-bakes the buildings anyway.

## 075 — Window axes from street photos · DONE (2026-11-01)

**Problem.** The window-grid veto (the ledger's discontinued table) was
loosened on 2026-10-07 for one case: window axes **measured** in open
street photos may show — nothing where nothing was measured. Google
Street View is out by its terms; Panoramax and Mapillary are CC BY-SA.

**What the spikes found.** Panoramax on the spawn tile: 789 photos, all
looking along the street, median horizontal accuracy 29.7 m — 58
footprints (1.6 %) with a facade seen under 60°. Mapillary: 32 379
images, 8 097 360° panoramas with computed poses; 536 walls seen face-on
from two or more sequences; rectifying a panorama onto the LoD2 wall at
20 px/m gives clean strips — but the SfM poses are metre-level (the same
rhythm 0.6 m apart between sequences), and fitting each pose to the
skyline (1–3° misfit: trees, the camera car's roof boxes, LoD2's eaves)
or each reconstruction rigidly onto the footprints (moved 0.5–2.5 m,
drives agreed *less*) did not fix it.

**Outcome.** First (2026-10-09), only what does not move with the camera:
per wall the column profile's period and peak, the storey, the openings'
width, proportion and ornament (`pipeline/bake/facade_traits.py`,
`windows.py`), each only where two sequences agree (Spearman ρ ≥ 0.6);
the clay draws windows from that rhythm on every house (ADR 0010,
PR #143): over Dresden's fifteen tiles 891 buildings carry their own
rhythm, 4 823 borrow a measured neighbour's (same roof form and eave),
31 361 take their type's (the photos' medians). Then (2026-11-01) the
axes' positions, without needing each pose: the strips of one wall are
registered onto each other by their **vertical edges** (darkness profiles
were dominated by tree shadows) — two drives agree within 0.25 m in
≈ 60 % of confident pairs, and three or more drives of ~0.2 m error each
leave a standard error of 0.12 m (`window_axes.py`, `lib/city/windows.ts`
`measuredColumns`; ledger, *Windows on every house*). The meridian
convergence (~1° in Dresden) had been missing from every pose.

**Keep in mind.** The drawing is the clay's recess per window, not the
planned pencil lines, and no panes or glass. Mapillary needs a client
token in the environment at fetch time, never committed.

## 081 — One schema per file a bake hands over · DONE (2026-11-05)

**Problem.** The files the Python bakes write and TypeScript reads had
their shape written three or four times (the dict literal, pytest
asserts, a TypeScript interface, sometimes a hand guard) and nothing
compared the copies: a renamed key or a number turned string passed every
check and a layer, card or directory went silently poorer. One drift was
live: a monument's `wikidata` named the item its *material* came from,
while the Stadtwissen and the card read it as the item OSM links it to.

**Decision.** ADR 0059: one zod schema per hand-over file in
`lib/city/<name>-file.ts` (`bake-file.ts`: `BakeFile`, `parseBakeFile`,
which returns its input typed and throws file, key path, writer and the
`--step` to re-bake); records are `z.strictObject`; a union the viewer
has is a `z.enum` held equal to it by a type-level test. The build parses
every such file (per tile in the step modules of `scripts/prepare/`,
site-wide files in `prepare-data.ts`, uncached) and fails on a mismatch;
`bake-files.test.ts` parses every committed file; the viewer imports a
schema module by type only and keeps its hand guards, pinned to the
schemas by agreement tests. zod is pinned exactly (its version is in
three bake keys).

**Outcome.** Steps 0–7 (2026-11-04): seven schemas (landmark facts,
landmarks, osmbuild, monuments, murals, trams, roof colours); Dresden's
and Hamburg's manifests byte-identical through the reader moves; zod only
in the *Frag die Stadt* chunk. Deviations: `heritage`/`shop`
non-negative ints, not the literal 1; members the writer always writes
required. Step 8 (2026-11-05): `wikidata` is OSM's link (the first Q-id
of the tag; a DLM monument takes its OSM partner's, an OSM fountain
carries its own), `materialWikidata` the item a material came from; a
monument linked to a cached item takes that item's material whatever the
distance, every monument linked to it does (a fountain and its figure, a
group of sculptures share one item), and no neighbour can claim it; then
the name (40 m) and nearest (10 m) rules as before. The Stadtwissen
carries `wd` and `materialWd`, the card credits Wikidata for a material
by `materialWikidata`. Step 9 re-baked every site (inputs: the committed
bake's BBBike extracts, Unna's openstreetmap.fr extract of 2026-11-05):
OSM links Dresden 237, Hamburg 92, München 87, Leipzig 38, Meißen 2,
Grimma 1, Unna 0; Wikidata materials 67 (Dresden 18 — the three other
Tageszeiten on the Brühlsche Terrasse and the second Schildlöwe gained
their group's Bronze —, Leipzig 23, München 13, Hamburg 12, Meißen 1);
nothing else changed in the files. Phone bytes (ADR 0047, accepted
2026-11-04): Dresden's monuments 199 491 → 205 926 B (+3.2 %), all
sites +12.3 kB. Every walk's monument ids resolve.

**Keep in mind.**
- A bake that renames a key changes its schema in the same commit; the
  committed data is re-baked before that commit merges.
- The fetch caches only the items its box query finds (five classes,
  with a `P186`): of the OSM-linked monuments (no fountains), 254 link
  an item the cache lacks, 159 of them without any material — the
  follow-up is backlog item 28.
- Not in scope and still open: `facades_<tile>.json` and the tile
  sources' schema pass (backlog item 26).

## 083 — One lifecycle for a tile's late parts · DONE (2026-11-04)

**Problem.** Three things land on a tile's content root after the root
itself — a terrain level's dressing, a city tile's murals, a data layer's
traffic bodies — and `DressingPlugin` built, compiled, weighed, hung and
freed each by a hand-written copy of one guard sequence. Of the six
`fix(load)` commits that changed that sequence (2026-11-02/03), four were
weight or gone checks landed in the dressing's copy only: the murals were
built for a tile that had left (D1), every part aborted only once the
root's compiles ended (D2), the murals and traffic bodies weighed nothing
between build and hang (D5, ADR 0047's class), the murals' failures were
never classed as allocation failures (D8), and a throw after their build
was an unhandled rejection (D9). The traffic bodies took the fine rank on
the coarse level too (D10).

**Decision.** One module, `app/_components/late-parts.ts` (Design B of
the plan): a per-root registry the plugin owns (`createLateParts`, four
members: `add`, `bytes`, `leave`, `release`) over the site's lane
(`createLateLane`), and a `LatePart` per kind of part with two policy
fields — `rank` (its place in the lane; null outside it) and `hangAt`
(`"wait"`: hangs once its compile wait is over, a hand-over waits on it,
comes down again if the compile then runs out of memory; `"compile"`:
hangs once its compile has ended). Three adapters: `dressingPart`,
`muralsPart` and the traffic slot's part (owned by the dressing's handle).
The module hides the order (turn → gone → build → gone → compile → weigh
→ wait → ready → `loaded` → hang), every gone check, the abort, the
one-ahead compile throttle, the weight from build to free, free after the
compile, the failure classification and the timings
(`<kind>:queue-wait`, `:build`, `:compile`).

**Kept on evidence.** A `"compile"` part holds the lane through its compile
wait (finding 4): a traffic body's compile is one large upload (≈ 20 MiB
fine), and overlapping them would put a second one in flight on a phone.
Its cost headless (full profile, desktop): the eight bodies of the start
view's switch-on hold the lane ≈ 110–130 s of the ≈ 135–185 s to the last
body under SwiftShader (timers starve there); judge it on a desktop GPU
before letting `"compile"` parts overlap on the desktop tier (the plan's
gate: more than 1 s spent in the hold). Measured 2026-11-05 on an M1 Max
(WebGPU, Albertstraße, 14 bodies, three switch-ons): 40–468 ms in all the
compiles, 0.8 s in the builds, under the gate, so `"compile"` parts keep
the lane on the desktop too. The hold reaches the fine
dressings too: a coarse level's bodies take the coarse rank (D10), so
after a switch-on up to `MAX_LATE_OVERTAKES` (4) of them may go ahead of
a fine dressing queued before them, each holding the lane through its
build and compile — at most ≈ 4 × (build + 3 s) on a GPU whose compiles
outlast the wait, the same bound the coarse dressings already have, and
only while a switch-on's bodies queue (the layer is off at the boot,
ADR 0040). Not changed: it is the same open measure — the hold's length
on a desktop GPU — and a part that holds without overtaking, or
overtakes counted by hold time, would be new lane machinery for a delay
nobody has seen there yet.

**Deviations from the plan.** `hang` returns the part's take-down (no
tenth field); a `"wait"` part's `settled` says `"hung"` as it hangs (the
loading frontier counts the dressing done there, as before) and a late
out-of-memory drop happens after; a `"wait"` part whose compile ran out
of memory within the wait never hangs (the dressing did not). The lane's
rank orders only the builds queued while it is busy. The murals' adapter
takes the drawings' builder (`build`) from the plugin, so its test needs
no `createImageBitmap`. The tests' fake host is `late-parts.fixture.ts`,
shared by the module's and the adapters' tests; the stream's tests reach
no private member (17 casts, from 26).

**Measured** (SwiftShader, `NEXT_PUBLIC_POC_DEBUG` builds per step, the
plan's step-0 script and a `?trace=1` start; 1-min load 2–4.6, this
container shared with other sessions): every `framedBuilds` delta 0 and
`anchors` 62/63 at every step; the phone-emulated lite boot's
`gpuBytes`, `memory.total` and `cpuBytesOf().total` within the base's
own two-run range (the BVH's 17.4/20.7 MB is bimodal on the base too) and
its traffic switch-on peak no higher (239.35 MB); veil to loaded, pooled
over every run of the evening, base median 224 s (183–314, seven runs),
step 4 median 233 s (194–299, seven runs) — within the noise, which an
order effect dominated (a base/branch pair run in the opposite order
flipped by 119 s); the switch-on's last body at 135–185 s (base 158–202
s), the coarse bodies first (D10), the start tile's fine bodies at 77–90 s.
The murals' record (Fürstenzug start): the same four drawings fetched and
the same texture count and bytes as the base.

**Keep in mind.** A new thing that lands on a tile after the tile is a
`LatePart` adapter, never a new hand-written sequence; `hangAt: "wait"`
only for what a level's hand-over waits on. A rule about late parts is
fixed in `late-parts.ts` and tested through the fake host. `ready` must
never wait on `loaded`. Open: the hold's cost on a desktop GPU (above);
real-GPU plates were not needed (no check moved).
