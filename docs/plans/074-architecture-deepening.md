# Plan 074: Bake the static dressing, load the optional features on demand, one store for the HUD

> **Executor instructions**: This is a *direction* plan from the 2026-10-10
> architecture review (`improve-codebase-architecture`, run beside the
> performance audit that produced plans 069–073). Its four parts are
> independent; each opens with a spike whose numbers decide whether the
> rest is built. Read AGENTS.md first. If a STOP condition occurs, stop and
> report. Update this plan's row in `docs/plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat <this plan's commit>..HEAD -- app/_components/tile-stream.ts app/_components/create-app.ts app/_components/city-walk.tsx app/_components/scene-sidebar.tsx scripts/prepare-data.ts`

## Status

- **Priority**: P2 (part A P1 once plan 069's measurements are in)
- **Effort**: L (A), M (B), M (C), S–M (D)
- **Risk**: MED — A moves geometry from the runtime into the build
- **Depends on**: plan 069 steps 1–2 (the timing marks name what part A
  saves); none for B–D
- **Category**: architecture, perf (boot, jank, bundle)
- **Planned at**: 2026-10-10, on top of the performance PR that built
  plan 068, plan 070 steps 1–3, plan 069 step 5 and the maintainer's look
  decisions

## Why this matters

The maintainer reported a load that freezes at 52 %, jerky movement and
crashing phones, and asked whether the code "simply grew a lot or is
optimised for niches". Measured on the reference site (SwiftShader, full
profile, 400×300): the first frame at 58 s, *loaded* at 501 s, the
*Umgebung* stage done only at 456 s — right after the sixth of eight
dressings, because a fine terrain level holds a tile-renderer parse slot
while it waits (≤ 10 s, `HAND_OVER_WAIT_MS`) for its dressing, and
dressings are built one at a time for the site. The dressing is built on
the main thread from up to 17 side files per fine level. The structural
causes are below; the per-tile ones (raster sizes, the fog-bounded
stream, meshopt workers) were fixed in the PR this plan follows.

## Part A — Bake the static dressing into the fine level (top recommendation)

**Problem.** Every fine terrain level fetches its side files and rebuilds
about ten static parts on the main thread inside `buildDressing`
(`tile-stream.ts`): rails, tram, riverside, bridge decks and their
superstructure, furniture, monuments, lamps, sport fixtures, cultivated
rows, hedges — and then compiles them. None of it depends on the viewer's
state beyond the look's uniforms. ADR 0029 already moved walls, kerbs,
stairs and fences into the fine glTF and named rails as the next
candidate once deck heights were solved by the build — ADR 0041 did that
(`scripts/line-levels.ts`).

**Solution.** Bake the geometry into the L0 glTF as named nodes (as
`stairs` is), each with the material key the runtime binds to its scene
material; furniture and lamps as instance tables over one site-wide model
set; trees as a baked instance table (the build already places them for
the coarse crowns, `lib/city/coarse-crowns.ts` — only the placement
moves; LOD, season and wind stay at runtime). The inquiry's data become a
per-tile file fetched with the first question (the artifact table's `ask`
column already works this way for trees).

**First step (spike).** Rails, tram and riverside only: bake them in
`prepare-data.ts` through the same builders (they are DOM-free or can be
made so), name the nodes, dress them with their existing scene materials
in `dressTerrain`, and drop their side files from the fine level's
dressing extras. Measure with plan 069's marks: `dressing:build` per
tile, requests per fine level, the fine glb's size. `scripts/ground-joins.test.ts`
already holds baked parts to the ground (list them in `JOIN_PARTS`).

**Benefits.** Fewer requests and long tasks per fine level, buffers
quantised and meshopt-compressed instead of Float32, no GeoJSON parse on a
phone, and the parse slot no longer waits on a dressing chain. Most of
≈ 7 400 lines of mesh builders leave the viewer chunk.

**STOP** if the fine glb of the spawn tile grows by more than 30 % gz, or
if a baked part breaks a `ground-joins` budget.

## Part B — Optional features behind one lazy seam

**Problem.** Modell (≈ 3 500 lines: `model-rig.ts`, `model-camera.ts`,
`model-cuts.ts`, `projection-panel.tsx`, `image-export.ts`), the picture
styles (≈ 1 900: `stylize-effect.ts`, `paper-scene.ts`,
`style-dressing.ts`) and the data layers (≈ 3 500: `traffic-layer.ts`,
`data-overlays.ts`, `bike-layer.ts`, `tram-cars.ts`, `glass.ts`) ship in
the scene chunk and are wired into `bootApp` by hand. The maintainer:
"they are important, but not for the initial load, and often never
loaded — lazy?". Their *runtime* cost on the initial load is gone (no tier
warms the styles any more, the data layers build on first switch-on), so
what is left is ≈ 33 KB gz of code and the coupling.

**Solution.** A feature seam in `create-app.ts`: the spine (renderer,
stream, post stack, render loop, clock) exposes hooks (`onFrame`,
`onStreamChange`, `onLook`, `onSun`, input claims); each optional feature
is a module loaded with `import()` on first use that registers against
them. Modell's input checks become a claim it installs while on; the
styles' pipelines are built by the module when a style is first picked
(the post stack keeps the pastel pair); the data layers' tile slot in
`tile-stream.ts` becomes a registration.

**First step.** The data layers: they already build on first switch-on
(`showDataLayers`); move their modules behind `import()` and measure the
scene chunk (`gzip -9c`) before and after. Then the styles, then Modell.

**STOP** if a lazy feature's first use hitches longer than its warmed
build did before (measure on a real GPU), or if the seam needs a module
global.

## Part C — The spine as a module with a test surface

**Problem.** `bootApp` in `create-app.ts` is one closure of ≈ 2 200 lines;
its four hubs (`setSun`, `applyLook`, the stream-change handler, the
frame) hard-code ≈ 31 feature hookups; the handle has 49 members, the
options 18 callbacks; neither `create-app.ts` nor `post-stack.ts` has a
unit test — only the SwiftShader e2e reaches them.

**Solution.** Follows from part B: once features register through hooks,
the spine is testable with fake features (does a stream change reach every
registered feature once per task; does a lost GPU stop the loop). Do it
after B, not before — B decides the hook set.

## Part D — A scene-status store for the HUD

**Problem.** `CityWalk` (`city-walk.tsx`) holds 31 `useState`s and takes
18 scene callbacks; `SceneSidebar` takes ≈ 40 props, so every report from
the scene (stages, stats, fps, pose, data-layer status) re-renders the
whole HUD.

**Solution.** A store with slices, shaped like the existing look store
(`lib/city/look-state.ts`, `useSyncExternalStore`), so each widget
subscribes to its slice. Measure with React's profiler: renders per second
of `SceneSidebar` while streaming, before and after.

## Also seen (backlog, not planned)

- **One raster stack per tile** (`terrain-layer.ts` loaders,
  `ground-detail`, `sport-ground`, `road-markings`, `cultivated-layer`,
  `sky-light`): a fine level binds ≈ 12 textures from 9 files; bake one set
  both levels name (class, NDVI, sky view, horizon) and one fine-only set
  grouped by sampler — 9 loads to 2, 12 bindings to ≈ 4.
- **Building level of detail**: one full LoD2 mesh at every distance
  (≈ 2 M triangles, 75 MB for the spawn tile). A simplified per-tile city
  level (meshopt simplify, feature ids kept, REPLACE to the full mesh near
  the camera) would need no BVH and no CPU copies far away.
- **City BVH lazily**: only for building tiles within ~1 km, or on the
  first ray (plan 043 is blocked on bundling a worker; this is the
  no-worker half, plan 069 step 7).

## Done criteria

Per part: its spike's numbers recorded in this file's Findings; the part
built or rejected with the reason; `bun run verify` and the e2e suite
green; docs (`docs/rendering.md`, `docs/data-pipeline.md`, AGENTS.md "Where
things live", ADR 0029 amended for part A) current.

## Findings

(none yet)
