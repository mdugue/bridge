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

### 2026-10-10 — part A's spike: the rails, trams and riverside baked

**Built** (on plans 072 and 069 merged; ADR 0029's update):

- The builders the viewer ran per tile moved DOM-free to `lib/city/`:
  `mesh3.ts` (the triangle soups; three's triangulation is handed in),
  `rail-mesh.ts` (ballast, the steel on its level, polygon and line
  platforms, the decks under a span), `tram-mesh.ts` (tracks in their
  bed, span decks, masts, contact and span wires), `riverside-mesh.ts`
  (piers on piles, pontoons, huts, gangways, groynes, the ferry's wake)
  and `wire-mesh.ts`. Each returns its parts and their joins (ADR 0035).
- `scripts/bake-lines.ts` writes them into the fine level's glTF as one
  named node per part — 24 names, `lib/city/line-nodes.ts` — welded,
  quantised and meshopt-compressed like the walls. Masts, piles and posts
  are merged where they stand (no instancing in the file). The wires and
  the wake carry the ribbons' attributes their shaders read (`_WIREDIR`,
  `_WIRESIDE`, `_WIREHALF`, `_WAKEALONG`). The lines stand on every
  tile's fine ground, on the build's levels (`lv`, `siteLineLevels`;
  `scripts/line-sources.ts` reads the tile's files).
- `lib/city/tile.ts` flags `rail`, `railarea`, `platform`, `tram` and
  `riverside` `baked`: bake inputs, no longer published; the fine level's
  cache key covers them.
- The viewer finds the nodes by name and gives each its layer's look
  (`app/_components/line-looks.ts`, from `RAIL_LOOKS`, `TRAM_LOOKS`,
  `RIVERSIDE_LOOKS`); their CPU copies go after the compile with the
  terrain's (`cpuDroppable`); the census counts them under rail, tram and
  riverside.
- The tram stops' signs are still the furniture's instanced model, stood
  at runtime.

**Deviations from the plan.**

1. *"Dress them with their existing scene materials"*: each tile gets a
   **copy** of the scene-wide material. 3DTilesRendererJS records the
   materials of a tile's content right after `processTileModel` and
   disposes them when the tile unloads, so a scene-wide material on the
   content would be disposed by the first tile to leave, for every
   tile. The copy shares the original's nodes and cache key: one build
   (`setGraph` keeps the pipeline anchors).
2. **The bridges stay runtime-built** (decks, measured steel, piers,
   arches): the inquiry asks a bridge by its meshes (`bridge-ask.ts`) and
   the coarse level draws the same bridges from the same file. The
   `bridge` file is still fetched by both levels; the bake reads it for
   the decks the lines ride and the ballast leaves out.
3. **What the inquiry asks rides in the fine level's extras**, not in a
   file fetched with the first question (the plan's `ask` column). The
   tram stops and the landing stages are all it needs of these files.
   They are few — 23 stops and 20 landing stages on the spawn tile — and
   the stop signs need the stops at load anyway. With them and the new
   nodes, the spawn tile's glTF JSON grows from 8 to 35 kB. A per-tile
   `ask` file is the way once the furniture and monuments follow.
4. **Float positions were measured and left out.** 16 bits over a 2 km
   tile step by about 3 cm, and a street rail stands 2 cm over the road.
   Floats for the line nodes cost +27.6 % on the spawn tile, +23.9 % over
   the site and +82 % on the Neustadt's yards (33410_5656). Quantised, a
   street rail's vertices lie under the fine ground at 10.6 % of them,
   against 7.7 % with floats: most of that is the centreline sampling,
   not the quantisation.

**Measured** (Dresden, the fifteen tiles, as built here):

| | before | after | change |
|---|---|---|---|
| spawn tile's fine glTF, gzipped | 1 862 749 B | 2 073 882 B | **+11.3 %** (STOP at 30 %) |
| spawn tile's fine glTF, raw | 4 644 964 B | 5 251 048 B | +13.0 % |
| the site's fifteen, gzipped | 31 219 253 B | 34 373 084 B | +10.1 % |
| the most-grown tile (33410_5656, Neustadt's yards) | 1 965 864 B | 2 644 170 B | +34.5 % |
| a tile without lines (33416_5658) | 1 661 245 B | 1 661 406 B | ±0 |
| side files a fine level fetches | 19 | 14 | −5 (the site: 285 → 210) |
| GeoJSON no longer fetched | — | — | 75 files, 614 kB raw, 138 kB gzipped (spawn: 55 kB / 11 kB) |

The download grows: the triangles weigh more than the lines they are built
from. The spawn tile's fine level brings ≈ 200 kB more gzipped (+211 kB of
glTF, −11 kB of GeoJSON), the site 3.0 MB more. What it buys is the
requests and the main thread's parse and build.

**`dressing:build` and the compiles** (plan 069's marks, `?trace=1`,
`/dresden?scene=lite` — the spawn tile only, so one fine level per run,
not every tile's —, headless Chromium over
SwiftShader at 800×600, production builds with `NEXT_PUBLIC_POC_DEBUG=1`,
three runs each, and a fourth after-run once the box had quietened).
The box was shared with other agents' builds and browsers: load average
10–12 on four cores in the before-runs and the first two after-runs,
about 7 and 4 in the last two. **The times are directional**; the last
two after-runs have no before at their load.

| run | fine `dressing:build` s | coarse `dressing:build` s | fine content `tile:compile` s | fine `dressing:compile` s | veil → loaded s | ready s |
|---|---|---|---|---|---|---|
| before 1 | 2.90 | 13.8 | 35.4 | 95.2 | 134.7 | 239.8 |
| before 2 | 2.87 | 24.1 | 31.5 | 88.4 | 130.8 | 208.5 |
| before 3 | 1.65 | 16.6 | 37.9 | 65.1 | 101.9 | 216.2 |
| after 1 | 1.75 | 15.9 | 80.4 | 87.0 | 126.9 | 262.9 |
| after 2 | 1.34 | 18.7 | 67.7 | 71.5 | 105.6 | 225.1 |
| after 3 (load ≈ 7) | 0.99 | 5.3 | 20.1 | 30.5 | 46.8 | 133.3 |
| after 4 (load ≈ 4) | 0.78 | 5.2 | 17.2 | 28.6 | 45.4 | 90.7 |

- The fine level's `dressing:build` — the main thread's parse and build
  of its side files — fell from 1.7–2.9 s to 1.3–1.8 s at the same load
  (0.8–1.0 s at the lighter ones): the rails, trams and riverside left
  it. The coarse level's dressing is untouched (it
  draws the bridges, as before).
- **The line materials' programs now build in the fine content's
  compile** (`tile:compile`, inside the tile renderer's parse of the
  level) instead of in its dressing's compile. That is structural; what
  it costs is not measured here. At load 10–12 that compile read 68–80 s
  against 32–38 s before, and 17–20 s at load 4–7, below every
  before-run. At
  this load the marks are mostly timer starvation: plan 069 saw a bare
  1 s timer fire up to 71 s late in lite runs. The programs are
  site-wide (each line material is one build), so only the first fine
  level pays them — here the only one. It is a cost that moved, not one
  that went; but it moved into `processTileModel`, which holds one of
  the tile renderer's parse slots while it runs (plan 069). Measure it on
  a real GPU (WebGPU compiles its pipelines
  asynchronously, SwiftShader's WebGL2 does not) before the rest of
  part A: if it holds there, the line materials belong in the scene's
  warm-up, so the first fine level finds them built.
- *Veil → loaded* and *ready* move with the load, not with the change.

**Ground joins** (`bun scripts/ground-joins.ts dresden`, before / after).
The parts that were already listed are unchanged to the last miss. The new
parts over the site, on the site's line levels:

| part | feet | edges | misses |
|---|---|---|---|
| `rails` | 60 565 | 0 | 6 362 (10.50 %) |
| `tram` | 576 519 | 0 | 3 379 (0.59 %) |
| `riverside` | 936 | 38 | 0 |

`scripts/ground-joins.test.ts` holds them at what they measure on one
tile, each line solved on its own piece (`--solo`; over the site the
trams' share is the same within 0.01 %): `tram` 0.31 % on the spawn tile
(budget 0.4 %), `riverside` 0 (0.1 %), `rails` 16.93 % on 33410_5656
(17.5 %) — the spawn tile's rails are line-mapped platforms only, which
report no joins (below).

**STOP: not hit.** The spawn tile grew by 11 %, under 30 %. No
`ground-joins` budget broke: the parts that were already listed measure
the same, and the new ones are budgeted at what they measure.

**Found on the way** (left as drawn, since the look was not to change):

- The polygon platforms' fascia reaches the ground only at its outline's
  vertices: 38 % of their feet miss over the site, most of them on the
  viaduct platforms. The ballast misses at 3.6 %.
- The line-mapped platforms are a ribbon at platform height with no
  fascia: they float by construction and report no joins. The spawn
  tile's rails are all of that kind, so the rails' budget is measured on
  33410_5656.

**Verified.** `bun run fix`, then `bun run verify`: lint, typecheck,
2 492 unit tests passed, 1 skipped (`tile-data`, `ground-joins` and
`line-levels` among them). `bun run build`: the fifteen tiles baked cold
in 336 s (peak RSS 4.1 GiB), then `next build`. e2e against that build
(`next start`, headless SwiftShader, the box shared): `@desktop-hud`
10 passed, the scene census among them; `@desktop-render` 8 passed on a
second run. Its first run timed out on *Modell* at the 120 s test
budget, which left three tests unrun. Every wait in that test had
succeeded — entering took 62 s and the turn 18 s at a load average
above 10 — and the way back was still running. The whole-site smoke ran out of its
local budget (240 s to `ready`; CI gives it three times that), with five
dressings built, one pending, the second fine level landed at 254 s and
no error. The same load without the budget (`block=1`, 400×300) reached
`ready` at 391 s with eight dressings built and no page or console
error. Its census: 5 terrains, 5 building tiles, 205 552 tree
instances, 310 k rail, 446 k tram and 8.6 k riverside triangles.
Not done: plates on a real GPU (none here), so the unchanged look rests
on the builders being the ones the viewer ran (their tests ported) and
on positions within ±1.5 cm. Snapshots for the reviewer, oblique
afternoon views (the Albertplatz trams, the Marienbrücke, the
Terrassenufer pontoons):

```json
{"v":1,"camera":{"mode":"fly","pos":{"x":-849.21875,"y":150,"z":-557.5},"epsg":{"x":412265,"y":5657575},"headingDeg":-45,"pitchDeg":-17.108335234202936,"fov":46},"date":"2026-06-15T14:30:00.000Z","look":{"fogPct":20,"style":"pastel"}}
{"v":1,"camera":{"mode":"fly","pos":{"x":-1854.21875,"y":150,"z":-162.5},"epsg":{"x":411260,"y":5657180},"headingDeg":-46.68019440492742,"pitchDeg":-8.151899521318477,"fov":46},"date":"2026-06-15T14:30:00.000Z","look":{"fogPct":20,"style":"pastel"}}
{"v":1,"camera":{"mode":"fly","pos":{"x":-899.21875,"y":128,"z":377.5},"epsg":{"x":412215,"y":5656640},"headingDeg":-143.5490768204187,"pitchDeg":-12.37312412433849,"fov":46},"date":"2026-06-15T14:30:00.000Z","look":{"fogPct":20,"style":"pastel"}}
```

**Next.** Measure the fine content's compile on a real GPU. If it holds
the parse slot there, warm the line materials with the scene. Either
way, settle the bytes question before the rest of part A goes on. The
rails, trams and riverside cost +10 % of fine-level bytes for five
requests and about a second of main-thread build on the spawn tile.
Furniture and lamps would bake as instance tables over one model set,
which is far cheaper in bytes than merged geometry.

### Part B — the data layers behind the seam (2026-10-10): STOPPED at the chunk

Built on plan 069's branch (`claude/plan-069-streaming-without-stalls`).

**Method.** Both sides built the same way: `NEXT_PUBLIC_POC_DEBUG=1 next
build` (the e2e build; the `__poc` hook is the same constant on both
sides), Next.js 16.3.7 with Turbopack, all seven sites' data. The base is
the branch's head exported to a scratch folder (`git archive`). Each build
served by `next start`; headless Chromium (SwiftShader, as the e2e) at
`/dresden?scene=lite`, 800×600, records every `/_next/static/*.js` it
fetches until `__poc.ready` — the first-load set: the route's own chunks,
the HUD's (`city-walk.tsx`) and the scene's (`create-app.ts` and three.js);
each file then `gzip -9`-ed from the build's own `.next/static`. Then
`__poc.look.set({ trafficLayer: true })`, and the chunks fetched after it.
The scene chunk is told by a string only `create-app.ts` holds, the data
layers' code by `DataGlassBackdrop` / `traffic-glass` / the tram status's
failure text.

| build | first-load JS, gz | raw | the scene's chunk(s), raw / gz | on the first switch-on |
|---|---|---|---|---|
| base | **904 619** | 2 799 471 | 1 574 194 / 493 506 (data layers inside) | nothing |
| data layers behind `import()` | **927 361** (+22 742) | 2 896 987 (+97 516) | 576 471 + 1 086 665 / 211 003 + 301 060 | 23 749 / **10 089** |
| … and the rail module out of its reach (a stub, measured only) | 924 669 (+20 050) | 2 891 542 | 618 739 + 1 040 073 | 23 709 / 10 080 |
| the seam with the module imported statically (built) | **904 716** (+97) | 2 801 048 | 1 575 601 / 493 561 | nothing |

**Why the chunk cost more than it moved.** Turbopack hoists the modules
one chunk group alone needs into one scope: the scene's own code and
three.js were one scope, three's functions called by local, mangled
names. The data layers import `three/webgpu` and `three/tsl` too, so as a
chunk group of their own three.js became a module both groups share — it
left the scene's scope for a shared chunk (its WebGPU backend moved from
the scene's chunk to the second one), and every call into it became a
property access on the module: the scene's code made 180 such
`(0,X.fn)(…)` calls before and 2 929 after. Taking the rail module (the
largest the data layers share with the scene, via `buildDeckTable`) out
of their reach won back only 2.7 KB: the cost is three's, not the app
modules'. It is paid once, by the first lazy chunk that imports three —
≈ 32.8 KB gz (22.7 net + the 10.1 moved) — and this part's own estimate
of everything it could move is ≈ 33 KB gz. Styles and Modell import
three/tsl as much as the data layers do, so even all three behind
`import()` would about break even, for a seam with Modell's ≈ 111
references still to untangle. Escaping the tax means a lazy chunk that
takes TSL from the spine instead of importing it — every layer module a
factory with a prologue of injected functions, a bigger framework than
the three features need.

**What was kept** (`refactor(scene)`, byte-neutral as measured: +97 B
gz; the decision is ADR 0051): the seam itself. `feature-seam.ts` — the
spine's hooks (`frame`, `streamChange`, the look store, the scene's
clock as a watched value a late starter reads first), `lazyFeature` (starts once, on first want;
never after the spine is gone; a failed load asked for again — by the
spine on the next switch-on, `wantOnSwitchOn`);
`data-layers-feature.ts` — the data layers start on the first switch-on
of any of them against those hooks (create-app.ts no longer wires the
overlays into `setSun`, `applyLook`, the stream-change handler and the
frame by hand, nor writes the glass's clock: it emits, and keeps three
reads of a started feature — the probe's asks, the census, the card's
hour); the tiles' traffic
slot takes its builder through `TileStreamContext.trafficBuilder` and
waits for it outside the dressings' turn — a tile hung before the first
switch-on and one landing after build from the same start, a builder
that did not come is asked for again on the next switch-on and never
reported as the tile's failed build, one that comes after the layer went
off again builds nothing (three new `tile-stream.test.ts` cases);
`traffic-flow.ts` — the flows' hour uniforms, position node, attributes
and mesh lookup, which the asked section's outline (its pass compiled at
boot, its shape) reads,
split from the layer's builder. Going lazy is then the one line in
`create-app.ts` (`() => Promise.resolve(dataLayersModule)` → an
`import()`), at the cost measured above.

**What stopped and why.** The `import()` itself, and with it the styles
and Modell: not by the plan's STOP conditions (no module global was
needed; the first switch-on's extra cost would have been the chunk's
fetch, 48–173 ms from a local server, and its parse) but by the
measurement — the chunk makes the first load larger, the one number this
part exists to lower. Neither the styles nor Modell was started.

**Timings, for the record, not for conclusions.** Boot to `ready` 228 s
(base), 204 s (lazy), 230 s (rail stub), 186 s (static); first
switch-on of the traffic to its first triangles in the stats (a 250 ms
timer) 26.2 s, 36.7 s, 40.4 s, 27.7 s. One run each on a shared
four-core box at load 7–11 under SwiftShader: noise-dominated.

**Verified.** `bun run verify` green (2 468 pass); e2e against the
static build (production, `NEXT_PUBLIC_POC_DEBUG=1`): `@desktop-hud` 10
passed (7.9 min) — the data layers' switch-on spec among them —,
`@desktop-render` 8 passed (13.1 min). Run with CI's timeouts (`CI=1`,
`--timeout=900000`): on this box the boot took longer than the local
120 s wait for `ready`, and the first local run stopped there before any
test ran. The whole-site shard and `@phone` were not run.

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
not milliseconds). Parts A and C stay open (part B above).
