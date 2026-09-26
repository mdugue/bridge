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
