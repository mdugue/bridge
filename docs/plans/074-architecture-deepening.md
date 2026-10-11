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

### Part D — built (2026-10-10)

**What was built.** `lib/city/slice-store.ts`: a store of named slices,
DOM- and React-free — `get`/`set`/`update`/`subscribe` per slice, an
equality per slice (`Object.is`, or `dataEqual` for plain data), and an
optional `schedule` that hears a burst once per slice. On it
`app/_components/scene-status.ts`: the HUD's slices (the stages, *busy*,
a failed tile, the GPU failure, the stats' three counters, the
footprints, the frame rate in whole frames, the site, the mode, Modell's
view, the inquiry, the data layers' three statuses, the pose), a
`useSceneStatus(key)` hook over `useSyncExternalStore`, and
`sceneReports`, which turns the store into the `CityWalkOptions`
callbacks — **create-app.ts is unchanged**. The HUD's store notifies in
the task after a write (`afterTask`), so a report from inside a frame
(the frame rate, Modell's view, the pose) re-renders after it, as the
transitions did. Each widget reads its own slice: the loading screen and
the pill (`ShellLoadScreen`, `ScenePill`), the failed-tile line, the
centre mark, the failure card, the inquiry panel, the overlays (mode,
inquiry) and Modell's instruments, and in the sidebar the minimap
(footprints; the pose straight to its canvas), the mode switch, the key
table, *Projektion* (`ModelProjection`), the counters (`SceneCounters`)
and the data layers' lines. `CityWalk` holds 12 `useState`s instead of
30 (the store itself one of them; the rest HUD-local: boot phase, veil,
tab, snapshot, …) and `SceneSidebar` takes 28 props instead of 38, none
of them a scene report.

**Measured** (production build with `NEXT_PUBLIC_POC_DEBUG=1`,
`/dresden?scene=lite`, 800×600, headless Chromium on SwiftShader, on a
4-core container at a load average of ~17 from other jobs — frames took
4–8 s, so wall-clock rates mean little; the windows are anchored to the
scene's milestones instead). Render calls (component bodies run) and
commits, counted by a temporary counter on `window` (React's
`<Profiler>` is a no-op in a production build), cumulative from `goto`:

| window (end) | reports so far (stage / stats / fps / modelView) | `CityWalk` renders (commits) before → after | `SceneSidebar` commits before → after |
|---|---|---|---|
| first frame | 8 / 3 / 16 / 0 | 17 (9) → 3 (3) | 9 → 3 |
| *ready* | 12 / 6 / 56 / 0 | 31 (17) → 4 (4) | 17 → 4 |
| + 30 frames standing | 12 / 6 / 84 / 0 | 86 (44) → 4 (4) | 44 → 4 |
| + 30 frames in Modell | 12 / 6 / 113 / 30 | 147 (75) → 4 (4) | 75 → 4 |

Before, every frame-rate report (2 Hz on a real device) was one commit of
the whole HUD, and in Modell every view report (10 Hz) another: up to 12
whole-HUD renders a second in Modell on a phone. After, the HUD's two big
components render only for the HUD's own state (4 times in the whole run:
mount, the site, the first frame, the veil). What renders instead is
small: over the same run `ShellLoadScreen` 6, `ScenePill` 5,
`MinimapCard` 6, `ModelProjection` 7, Modell's instruments 3 (a view
standing still is the same data, so 30 view reports were 3 renders), the
counters 0 (their tab was not open).

**The handover.** The veil leaves `VEIL_HOLD_MS` after the first frame
on a timer, and a stage report is now an urgent render (an external
store's update is never a transition) — the failure the old `onStage`
comment warned about. Under this load the first frame is followed by
seconds-long frames during which neither timers nor React's scheduled
tasks run (presumably the compiles after the first frame), in both
builds: first frame → veil gone took 0.8, 54.6, 95.3 and 67.5 s on the
base and 72.5, 68.3, 87.9, 85.1 and 76.9 s on the branch; the veil's own
600 ms timer fired 0.7, 62 and 49 s after it was set on the base, 71, 68
and 61 s on the branch (traced by wrapping `setTimeout` in the page).
The ranges overlap, the path (a timer, a default update in `CityWalk`)
is unchanged code, and the stage renders are now a loading screen's, not
the HUD's; judged no regression on this evidence, but the handover is
worth a look on a phone.

**Checks.** `bun run verify` green; the e2e against the same build (the
counters are behaviourally inert) with the timeouts widened locally for
the load: `@desktop-hud` 10/10 (a first run lost *live mode* to a race in
the spec under the load — switched off, the button is gone a second
later once the compass has been quiet for five seconds; the rerun
passed), `@phone` 1/1, `@desktop-render` 8/8, the start page, the 404
and the viewer shell 3/3; the whole-site spec not run.

**Not done here**: a real-device profile (the numbers above are counts,
not milliseconds). Parts A–C stay open.
