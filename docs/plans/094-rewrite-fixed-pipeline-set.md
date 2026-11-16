# Plan 094 [rewrite]: The clay's limits are counted by a test, and every pipeline the scene draws with is known at boot

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and AGENTS.md
> first, then ADR 0027 and the "Workarounds for upstream bugs" section
> of `docs/rendering.md`. This plan has two parts with different dates:
> phases 0–2 go **now**; phase 3 goes **before plan 093** and only on
> phase 2's numbers; phase 4 goes **with a bump of three**, whenever one
> reworks `compileAsync`. Each phase is one PR and ends in a **Verify**.
> On a STOP condition, stop and report. When a phase lands, update this
> plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- app/_components/visual-style.ts app/_components/material-slots.ts app/_components/pipeline-anchors.ts app/_components/compile-lanes.ts app/_components/late-parts.ts app/_components/post-stack.ts app/_components/three-utils.ts app/_components/terrain-layer.ts app/_components/poc-scene.ts app/_components/create-app.ts e2e/city-walk.spec.ts`
> If an in-scope file changed, compare *Current state* with the code
> before you go on; a mismatch is a STOP condition.

## Status

- **Priority**: P1 for phases 0–1 (a silent failure gets a check), P2
  for the rest
- **Effort**: S (phases 0–2), M (phase 3), S (phase 4, when it comes)
- **Risk**: LOW for the counting test; MED for the register — it moves
  compiles to the boot, where a phone has the least to spare
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (the ledger
  and the plates); phase 3 is cheaper after
  [090](./090-rewrite-dressing-gpu-ready.md) and
  [091](./091-rewrite-rasters.md) phase 5, and is a precondition of
  [093](./093-rewrite-streaming-quadtree.md)
- **Category**: rewrite — faster on the device (no build inside a
  frame), less complexity (the compile choreography)
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: IN PROGRESS — phases 0–1 done (2026-11-16), see *Findings*

## Why this matters

Two things here hold only because people remember them.

**The limits.** WebGPU draws a mesh from at most eight vertex buffers
and passes at most sixteen variables from the vertex to the fragment
stage. Past either the pipeline is invalid and the mesh draws nothing —
no error a test sees, on a GPU and in the headless e2e alike. The clay
passes thirteen of the fifteen it may. AGENTS.md states the rule;
nothing counts. The traffic bodies vanished this way once.

**The set of builds.** Which shader programs and pipelines the scene
needs is decided by the data as it arrives: which rasters a tile has,
which colour a bridge is mapped in, which camera looks. So builds
happen when a tile lands, and a body of code exists to keep them out of
the frames: a compile before a tile shows, one compile at a time,
stand-ins that keep a build alive when its last tile leaves, a second
set for Modell's camera. If the set were closed and listed, it could be
built once, and a landing tile would upload and draw. With plan 093
tiles land many times as often, and that turns from an improvement into
a precondition.

## Current state

**The rule** — AGENTS.md, *Rendering*: "WebGPU draws from at most eight
vertex buffers, and the clay is two inter-stage variables short of
sixteen. Past either a mesh vanishes." The `city-walker` skill has the
count: of sixteen, `front_facing` takes one (and Modell's cut, its clip
distances, one on the vertex side); the clay passes thirteen of the
other fifteen. Each attribute that is not interleaved is one buffer,
`position` and `normal` too; an interleaved instance matrix is one.

**What checks it today** — one unit test, for one layer:

```ts
// app/_components/traffic-layer.test.ts
expect(Object.keys(geo?.attributes ?? {}).length).toBeLessThanOrEqual(8);
```

Nothing counts the clay's variables. The renderer is made without
`requiredLimits` (`create-app.ts` `createRenderer`), so the device has
WebGPU's defaults.

**The clay** — `app/_components/visual-style.ts`: `createClayMaterial`
gives each building tile a `MeshStandardNodeMaterial` on the app's one
graph (`clayGraph`), read through slots. It has four shared builds,
named by `setClayKey`: `clay`, `clay|double` (Modell's section,
`setClaySection`), `clay|niches` (`setClayNicheCut`: the windows'
openings cut near the eye) and `clay|double|niches`. Its windows are
`clay-windows.ts`, its chunks `shader-chunks.ts`.

**How builds are shared** — three keys a node build by the material and
its nodes, and a pipeline also by the geometry's layout and the target.

- `three-utils.ts` `sceneMaterial(key, make)`: a material every tile
  wears, made on first use, 39 call sites. Most keys are constants
  (`"lamp-post"`, `"rail-sleepers"`); some are **made from data**:
  `bridge-stone:${colour}`, `bridge-deck:${kind}:${colour}`
  (`bridge-surface.ts`), `wire-${ink.color}-${ink.opacity}`
  (`wire-ribbons.ts`), `tram-car:${key}` (`tram-cars.ts`), the splat's
  painting pass by size (`landcover-splat.ts`), `mesh-kit.ts`'s `key`.
- `material-slots.ts` `setGraph(material, key)`: a per-tile material is
  one user of a shared build; its tile's textures come through slots.
  Users: the clay; the ground, `terrain|${splatVariant(splat)}` — eight
  optional rasters and the tile's size, so up to 2⁸ builds a size
  (`terrain-layer.ts`), and `|design-cut` on top (`create-app.ts`); the
  ground-lit walls, `${kind}|${groundLightKey(light, skyView)}`
  (`sky-light.ts`); the trees' feet and crowns (`tree-foot.ts`,
  `vegetation-layer.ts`).
- `pipeline-anchors.ts`: a three-vertex stand-in a build (`layoutStub`),
  compiled and never drawn, so a build outlives its last tile.
- `three-utils.ts` `compileRepresentatives`: one object per material,
  draw kind, attribute layout (`layoutOf`) and shadow receipt — what a
  compile walks.

**The choreography** — `compile-lanes.ts`: `compileInTurn` (never two
`compileAsync` in flight: an upstream workaround) and `compileInLanes`;
`post-stack.ts`: `compile`, `recompile`, `warmView` and `dropView` (a
second set of builds for a parallel camera: three r187 builds a material
per kind of camera), `releaseWhenSettled`; `late-parts.ts`: built in its
turn, compiled before it hangs, freed once its compile has ended
(`COMPILE_WAIT_MS` 3 000). ADR 0027 accepts one gap: the shadow pass's
pipelines for new casters build in the frame that first draws them.

**What is counted** — `create-app.ts` `framedBuildCounter`: node builds
made while a frame draws, through three's public
`renderer.debug.onNodeBuilderCreated`, split into `shadow` and `other`;
`getRenderInfo()` hands out `framedBuilds`, `compilesQueued` and
three's `info.memory` (with `programs`). One e2e test uses it, the
look test's night step in `e2e/city-walk.spec.ts`: it waits for
`compilesQueued` to reach 0, sets the sun to night and expects
`framedBuilds.other` not to rise.
`three-console.ts` notes three's own console errors — a pipeline whose
creation failed among them — in the crash trail.

**What three r187 offers on public API** (read in
`node_modules/three/src/renderers/common/Renderer.js`; read it again):
`renderer.debug.getShaderAsync(scene, camera, object)` runs a compile
and returns the object's `vertexShader` and `fragmentShader` as WGSL
text; `renderer.debug.onNodeBuilderCreated`; `renderer.info.memory`.
There is no public count of GPU pipelines.

**Upstream** — `docs/rendering.md`, "Workarounds for upstream bugs",
lists what `compileAsync` does wrong in r187: it is not re-entrant, it
restores a stale render target, it keys a canvas pipeline by the output
colour space at a later moment, a throw leaves its state set, and now
and then it builds pipelines without a depth format. Upstream means to
rework it (three issue 35086, the review of PR 35092). The maintainer
keeps the newest three (plan 086, ruling 2).

**Next door** — [085](./085-window-niche-follow-ups.md) item 4 (the
`clay|niches` build is made in a frame the first time a tile cuts) and
item 5 (the clay's shadow pass goes through a mask and a pipeline of
its own).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Format, then gate | `bun run fix && bun run verify` | exit 0 |
| Headless e2e (builds with the debug hook) | `bun run test:e2e` | all pass |
| One e2e test | `bun run test:e2e -- --grep "<title>"` | pass |
| Plates on a GPU | `bun run shots` (and plan 087's `bun run plates`) | plates written, compared |
| The ledger | plan 087's `bun run ledger` | `qa/ledger.json` as committed |

Bun has no WebGPU: anything that needs a built shader runs in the
headless e2e (WebGPU on SwiftShader), reached through the debug hook
(`window.__poc`, `poc-debug.ts`; the scene's half is `poc-scene.ts`,
and a read of the scene is a promise, ADR 0061).

## Scope

**In scope**: a new `lib/city/wgsl-budget.ts` with its test; a probe in
`app/_components/poc-scene.ts` and its message in `scene-protocol.ts`;
`e2e/city-walk.spec.ts` (or a spec beside it); from phase 3 a new
`app/_components/pipeline-register.ts`, `three-utils.ts`
(`sceneMaterial`), `pipeline-anchors.ts`, `post-stack.ts` (`warmView`),
and the layers whose material keys are made from data; AGENTS.md's
rule, ADR 0027, `docs/rendering.md`, the `city-walker` skill.

**Out of scope**:
- three's internals: no `_` member, no prototype patch, no wrapper
  around the renderer (ADR 0027). If a count needs one, STOP.
- New machinery around `compileAsync` itself — more lanes, compiles
  side by side, cancelling one. That waits for upstream (phase 4).
- The looks. No material's picture changes in this plan.
- The ground's variants as such: plan 091 phase 5 reduces them; this
  plan lists what is left.

## Phases

### Phase 0 — Spike: can the counts be had on public API?

1. In a dev build, call `renderer.debug.getShaderAsync` for one
   building tile's mesh, through the post stack's turn (it runs a
   compile: `compileInTurn`, and the frame names its targets). Save the
   two WGSL texts as fixtures.
2. Find in the text: the vertex stage's inputs (one `@location` an
   attribute), its outputs and the fragment stage's inputs (one
   `@location` an inter-stage variable), and the builtins that count
   against the limit. Read the WebGPU specification's validation of
   inter-stage interfaces and of `maxVertexBuffers` for what counts —
   do not take this file's word for it. Check the result against the
   skill's sentence: thirteen passed, two spare.
3. Vertex buffers are not in the text: count, over the attributes the
   vertex stage names, the distinct buffers of the mesh's geometry (an
   `InterleavedBufferAttribute`'s `data` is one buffer for all its
   attributes).
4. Do the same for the far building level, an instanced set
   (`instancing.ts`) and a ground variant, and under Modell's parallel
   camera.

**Verify**: the fixtures and a table of counts in this file's
*Findings*; no source change merged. **STOP** if the text cannot be had
without a private member, or the counts do not explain the known
limits. The fallback is then smaller: phase 1 counts buffers from
geometry alone and asserts that the crash trail holds no failed
pipeline.

### Phase 1 — The counting test (now)

1. `lib/city/wgsl-budget.ts`: WGSL text in, `{ attributes,
   interStageOut, interStageIn, builtins }` out. Pure, no THREE, no
   DOM; unit-tested on phase 0's fixtures and on a hand-made text at
   each limit.
2. A probe on the scene (`poc-scene.ts`, debug builds only):
   `pipelineBudget()` takes `compileRepresentatives` of the scene,
   asks for each one's WGSL in turn, and returns a row a build — its
   key (`graphOf(material)` or the material's name), layout, camera
   kind, vertex buffers, attributes, variables each way.
3. An e2e test, after *ready*: every row is within the device's limits;
   the clay's rows — each of its four keys the test can bring about, on
   the near and the far level — have the spare variables this plan
   found, **as a number in the test**. A change that takes one edits
   that number, and the PR says what took it, as ADR 0047's exceptions
   are named.
4. The rows go into plan 087's ledger, so a diff shows a layer coming
   near a limit before it crosses.
5. AGENTS.md's rule and the skill name the test.

**Verify**: `bun run test` → the parser's tests pass;
`bun run test:e2e -- --grep "limits"` → pass; add a ninth plain
attribute to a copy of a geometry in the test's own fixture and see it
fail. **Ledger**: a row a build; the clay's spare variables.

### Phase 2 — The census (now)

Count what phase 3 would have to list. Over a scripted flight of each
committed site (the whole-site profile), and once in Modell:

- the distinct builds: material or graph key × layout × shadow receipt
  × camera kind, from `compileRepresentatives` at the end;
- which keys are made from data, and how many values each took;
- `framedBuilds.other` and `.shadow` and `info.memory.programs` at
  *ready* and at the flight's end;
- the compiles a landing tile waited for, and for how long
  (`stream-timing.ts` has the marks).

**Verify**: the figures in the ledger and in *Findings*. **Decides**
phase 3: if a flight today makes no build inside a frame and the
compile waits are small, and 093 is not being built, close phase 3 as
not needed.

### Phase 3 — The register (before 093)

1. **Close the open sets.** A material's key comes from a list written
   in the code, never from a value in the data. A bridge's colour, a
   wire's ink and a tram car's livery become a slot, a uniform or a
   per-vertex or per-instance value (`material-slots.ts`, `Instances`'
   tints); the picture must not change (plates). Layers that 090 has
   already moved bring their colours in tables — do those there.
2. **List them.** `pipeline-register.ts`: one entry a build — the key,
   how to make the material, a stand-in geometry in its layout
   (`layoutStub`), whether it receives shadow, which kinds of camera
   draw it. Each layer exports its entries; `sceneMaterial` refuses a
   key that is not listed (in debug builds, with the key in the
   message).
3. **Build them once.** After the first frame, in idle turns and in the
   compile's turn, most likely first: what the spawn tile's surroundings
   use, then the rest of what the site has. The tileset can say which
   kinds a site has; a site without trams builds no tram pipelines.
   A tile that lands before its entry is built waits for its compile as
   today — the compile before a tile shows stays as the net.
   `warmView` compiles the register for Modell's camera instead of
   walking the scene.
4. **The shadow pass.** Try whether an entry's stand-in, drawn once
   into the shadow map (drawn, not compiled: three skips the shadow map
   while it precompiles), makes the caster's pipeline ahead of its
   first tile. If that needs a private member, leave ADR 0027's gap as
   it is.
5. **The check.** An e2e test: after *ready* and an idle wait, a
   scripted flight across the site raises neither `framedBuilds.other`
   nor `info.memory.programs` (and `.shadow` only if step 4 was left).

**Verify**: the flight test passes on every committed site;
`bun run test:e2e` → all pass; plates within 087's noise floor; the
time to the first frame and to *ready* on the reference phone not above
their ledger figures. **Ledger**: builds listed, builds made at boot,
in-frame builds over the flight (0), time to first frame and *ready*,
`programsSize` a phone holds.

### Phase 4 — With a bump of three that reworks `compileAsync`

Not scheduled: it runs when the bump comes. For each entry of
`docs/rendering.md`'s workaround list, do what its "Once fixed" says —
`compileInTurn` starts its compile at once, `releaseWhenSettled` waits
for its own compiles, the comment at `PostStack.render` loses its
reason — and measure the boot and Modell's warm-up again. Phase 3's
register does not depend on the outcome: three keys a build by the
material and the layout whatever becomes of the call that makes it.

**Verify**: `grep -rni "upstream workaround" app lib` lists only what
the release did not fix; the flight test and the plates pass.
**Ledger**: boot and warm-up before and after.

## At every bump of three

Whether or not phase 4 applies:

1. Run phase 1's test. three's own lighting and fog nodes pass
   variables too; a release can take the clay's two without a line of
   ours changing.
2. Run the plates (plan 087) and, once phase 3 has landed, the flight
   test.
3. Go through `docs/rendering.md`'s workaround list against the
   release notes; drop an entry with its workaround.
4. Read the release's changes to how builds are keyed (r187 began to
   key them by the kind of camera): a new part of the key is a new
   column of the register.

## Test plan

- `lib/city/wgsl-budget.test.ts`: fixtures from phase 0; texts at and
  over each limit; a builtin that counts and one that does not.
- e2e "limits": every build within the limits; the clay's spare
  variables as a number.
- e2e "a flight builds nothing" (phase 3), modelled on the existing
  night test in `e2e/city-walk.spec.ts`.
- `app/_components/pipeline-register.test.ts`: every `sceneMaterial`
  key in the code is listed (a scan of the call sites, as
  `bake-entries.test.ts` scans imports); no entry twice.

## Done criteria

- [ ] `bun run test:e2e -- --grep "limits"` passes, and fails when a
      fixture is pushed past a limit
- [ ] AGENTS.md's rule on the limits names the test; `qa/ledger.json`
      holds a row a build
- [ ] Phase 2's census is in *Findings*, with the decision on phase 3
- [ ] If phase 3 is built: no `sceneMaterial` or `setGraph` key is made
      from a value in the data (`pipeline-register.test.ts` scans the
      call sites); the flight test passes on every committed site;
      ADR 0027 rewritten (the limits counted, the builds listed)
- [ ] `bun run verify` and `bun run test:e2e` pass

## STOP conditions

- A count needs a `_` member of three, or `getShaderAsync` disturbs a
  running scene in a way the compile's turn does not contain.
- The clay's measured spare variables differ from the two the skill
  states: report both counts before writing the test's number.
- Phase 3 makes the time to the first frame or to *ready* longer on the
  reference phone, or raises what a phone holds (ADR 0047) — the
  stand-ins keep programs alive.
- A build cannot be made without a tile's data (a size, a count baked
  into the graph): report which, do not fake the data.
- Closing an open set changes a plate.
- A bump of three lands mid-phase and changes how builds are keyed.

## Maintenance notes

- A new scene-wide material is an entry in the register, as a new side
  file is a row in `lib/city/tile.ts`; the `new-scene-layer` skill's
  checklist gets the line.
- The number of spare variables in the test is a budget. Raising what
  the clay passes is a decision, not a fix for a red test.
- The register's stand-ins hold pipelines for the whole session. If a
  phone's `programsSize` becomes a weight, list fewer at boot and more
  on first need — the order in phase 3 step 3 is the knob.
- Plan 085's item 4 is this plan's entry for `clay|niches`; whichever
  lands first does it, the other drops it.

## What the series changes about this plan

- **Alone**, only phases 0–2 would be worth their cost today: the
  scene mostly keeps builds out of its frames already, by the
  choreography above.
- **With 090** dressing arrives in a few fixed layouts and its colours
  in tables, so the open sets close there and the register is short.
  Build phase 3 after 090's layers have moved, not before.
- **With 091** phase 5 the ground has a handful of variants in place of
  up to 2⁸ a size; without it the register cannot list the ground and
  must leave it to the compile before a tile shows.
- **With 093** tiles land many times as often and each waits on its
  compile; a build in that path is met constantly. Then phase 3 is a
  precondition (joint 9 of 086). If 093 is not built, phase 2's census
  decides.
- **The newest three stays** (086, ruling 2): so nothing here invests
  in `compileAsync` as it is, and every bump runs the list above.

## Findings

### Phase 0 — the spike (2026-11-16, three r187, headless Chromium on SwiftShader)

**The counts can be had on public API.**
`renderer.debug.getShaderAsync(scene, camera, object)` returns the two
WGSL texts of a drawable's build; nothing private is touched. What the
call needs around it:

- It runs a `compileAsync`, so it takes a compile's turn
  (`compileInTurn`), and it reads the build back for **the render target
  set once that compile has resolved** — so the scene's target stays set
  over the whole call, not only over its synchronous half as a compile's
  does. A frame that gets in meanwhile ends on the canvas, and the read
  would then look the drawable up under the canvas's context (and make a
  render object for it). `PostStack.shadersOf` therefore compiles the
  drawable first (`compileNow`), after which the read's own compile
  awaits nothing a frame fits into, checks the target after the read and
  reads again if it changed.
- It looks the drawable up under the render context's own clipping
  context, not a `ClippingGroup`'s: under a held Ausschnitt the read
  would miss the build that is drawn. `shadersOf` answers null while a
  cut is held.
- Measured: reading all 69 builds of the lite scene took 0.2 s, and
  `info.memory.programs` (182; 261 in Modell) and `framedBuilds`
  (59 other, 22 shadow) were the same before and after, and 8 s later.
  The probe builds nothing.

**What counts** (WebGPU specification, "validating inter-stage
interfaces" and "validating GPURenderPipelineDescriptor", read
2026-11-16): the vertex stage may write `maxInterStageShaderVariables`
(16) user-defined outputs — one fewer on a point list, one fewer for
every four `clip_distances`, which also lower the highest location; the
fragment stage may read as many user-defined inputs, one fewer for each
of `front_facing`, `sample_index`, `sample_mask`, `primitive_index` and
the two subgroup builtins it names. `position` counts on neither side.
A pipeline has at most `maxVertexBuffers` (8) buffers and
`maxVertexAttributes` (16) attributes. three writes the vertex stage's
attributes as `main`'s parameters and the varyings as `VaryingsStruct`;
it makes one buffer layout for each attribute and one for an interleaved
buffer (`WebGPUAttributeUtils.createShaderVertexBuffers`), so the buffers
are the distinct `attribute` / `attribute.data` objects among those the
vertex stage names. The device is made without `requiredLimits` and
reports 16 / 16 / 8.

**The counts explain the known limits**: the clay passes thirteen
variables and reads `front_facing`, two spare — the skill's sentence.

| Build | Camera | Vertex buffers (of 8) | Attributes (of 16) | Variables out / in | Counting builtins | Spare variables |
|---|---|---|---|---|---|---|
| `clay\|niches` — the spawn tile, near level, openings cut | walk/fly | 4 (`featureId`, `facade`, `position`, `normal`) | 4 | 13 / 13 | `front_facing` | **2** |
| `clay` — the far building level, from 3.5 km | walk/fly | 4 | 4 | 13 / 13 | `front_facing` | **2** |
| `clay` — near level in Modell (no niches there) | parallel | 4 | 4 | 12 / 12 | `front_facing` | **3** |
| `window-niche` — an `Instances` set (`iMat0`–`3` interleaved: one buffer) | walk/fly | 4 | 7 | 12 / 12 | — | 4 |
| `window-niche` | parallel | 4 | 7 | 11 / 11 | — | 5 |
| `terrain\|ndvi\|surface\|edges\|sport\|markings\|colonies\|svf\|horizon\|2000\|2000` — the spawn tile's ground, every raster | walk/fly | 2 | 2 | 4 / 4 | — | 12 |
| the same ground | parallel | 2 | 2 | 3 / 3 | — | 13 |

Over the lite scene's 69 builds (spawn tile, every layer of it): at most
5 vertex buffers (the trees' feet, `crown-bare`, the instanced
`monument-clay`, `furniture-hands`) and 8 attributes; after the clay and
the niches the fewest spare variables are 7 (`crown-bare`, the feet's
`tree-earth`, `-litter`, `-shade`). No attribute a vertex stage names is
missing on its geometry.

**A parallel camera's build passes one variable fewer**, every lit
material alike: `v_positionViewDirection` is not a varying where the
direction to the eye is one for the whole view. The clay's budget is
therefore the walk/fly camera's.

The fixtures are the clay's texts, `lib/city/__fixtures__/wgsl-budget/`
(`clay.*` = `clay|niches` under the walk/fly camera, `clay-parallel.*` =
`clay` under Modell's).

### Phase 1 — the counting test (2026-11-16)

- `lib/city/wgsl-budget.ts` (pure; `wgslBudget`, `budgetSpare`,
  `budgetBreaches`) with its unit test: the fixtures, hand-made texts at
  and over each limit, a builtin that counts and one that does not.
- The probe is `app/_components/pipeline-budget.ts`, behind `pocEnabled`
  (a production build answers with no rows), reached as the handle's
  value call `getPipelineBudget()` beside `getGpuDebug` — no new message
  in `scene-protocol.ts`, the call rides the existing `call`.
- The e2e test "limits: every build is within WebGPU's limits, the clay
  two variables short" (`@desktop-render`): the lite scene at the spawn
  (`clay|niches`), from far off (`clay`, the far level), and inside the
  Modell test under the parallel camera (`clay`). The budget is
  `CLAY_SPARE_VARIABLES` (2, parallel 3) and `CLAY_VERTEX_BUFFERS` (4) in
  the spec.
- Seen to fail: with one more varying on the clay
  (`varying(float(0.25))` added to its colour, not committed) the e2e
  test fails with `clay|niches […]: 1 spare` where it expects `2 spare`.
  The ninth plain attribute is a unit test
  (`pipeline-budget.test.ts`: eight buffers pass, the ninth is a
  breach) — a real ninth buffer in the scene would log a failed
  pipeline and trip the spec's error watch before the count.

**Open after phases 0–1**

- **The ledger** (phase 1 step 4): plan 087's `qa/ledger.json` does not
  exist yet. When it does, its rows are `getPipelineBudget()`'s.
- **`clay|double`, `clay|double|niches` and the clip distances**: the
  Schnitt comes with a cut, and the probe does not read under a held cut
  (above). By the specification a cut's clip distances (up to four)
  take one output and one location on the vertex side, where the clay
  has three spare outputs — the fragment side's two stay the tighter
  bound; unmeasured.
- **Builds the lite scene does not draw** (the traffic bodies, tram
  cars, bridges' ribs, the data layers, the designs): the probe reads
  whatever is in the scene, so phase 2's census over the whole site can
  hold them to the limits with the same call; until then
  `traffic-layer.test.ts` keeps its own count.
- **The shadow pass's builds** are not read (`getShaderAsync` reads the
  main pass's build).
- Seen beside the work, not caused by it: entering Modell headless logs
  three's `Async render pipeline creation failed
  (renderPipeline_nameplate-shadow_…): The fragment stage has fewer
  output components (2) than the color format` once, with and without
  the probe.
