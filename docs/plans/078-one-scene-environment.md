# 078 — One scene environment the dressings bind at birth

**Status:** TODO

The rest of backlog item 20 (`docs/plans/README.md`, *Open work*). An
architecture review and three verifiers on 2026-10-30 found that the
scene's sun, night, date, season and look still reach the dressings by
hand: `setSun` in `create-app.ts` fans out to about fifteen sinks, two
loops over `stream.dressings` push night, season and look into every tile,
and `catchUp` in `tile-stream.ts` replays all three into a dressing that
was compiling meanwhile. This plan puts the scene-wide values in one
module, lets each dressing bind them when it is born and let go when it
is released, and leaves `setSun` with one environment write plus the
sinks that really are subscribers. The picture must not change at any
step.

Read AGENTS.md, then load the `city-walker` skill (rendering rules) and
the `codebase-design` skill (the words *module*, *interface*, *seam*,
*adapter*, *depth* are used as it defines them). Honour the STOP
conditions. When done, update this plan's row in `docs/plans/README.md`
and backlog item 20 there, with deviations.

**Drift check (run first).** The plan was written against `6c2a70ba`.

```bash
git diff --stat 6c2a70ba..HEAD -- app/_components/create-app.ts \
  app/_components/tile-stream.ts app/_components/lamp-layer.ts \
  app/_components/monument-layer.ts app/_components/furniture-layer.ts \
  app/_components/vegetation-layer.ts app/_components/crown-season.ts \
  app/_components/feature-seam.ts app/_components/post-stack.ts \
  app/_components/three-utils.ts
```

Line numbers below are approximate (≈). Find each place by its function
or const name. If a name is gone, stop and re-read before going on.

## Context

Done before this plan:

- Plan 020 (the WebGPU port) removed the per-tile copies of the scene's
  values. Every scene-wide value is now a uniform node the tiles'
  materials share (ADR 0027).
- On 2026-10-30, commit `40ebf34c` made the per-frame clocks one write a
  frame: `setCrownTime` (`vegetation-layer.ts`) and `setWaterTime`
  (`water-layer.ts`). The per-dressing `setTime` and the stream's
  `standingIn` accessor are gone. The push mechanism had already cost one
  bug: `beb5905` (the stand-in crowns froze), fixed by that merge.
- Plan 074 part B built `feature-seam.ts`: the spine's hooks, and
  `createWatch`, a watched value. The data layers read the scene clock
  with it (`data-layers-feature.ts` `startDataLayers`: `get()` first,
  then `subscribe`). Plan 074 part C (the spine as a module with a test
  surface) names `setSun` and `applyLook` as two of its four hubs; this
  plan empties both of their per-dressing work.

What is left is the subject of this plan.

## Findings (verified against `6c2a70ba`)

### 1. What `setSun` writes

`setSun` in `app/_components/create-app.ts` (≈ line 1714), in order:

| Sink | What it is | Kind | Fate in this plan |
| --- | --- | --- | --- |
| `streamShadowTiles(aboveHorizon)` (≈ 1698) | adds or removes the sun's shadow camera from the stream | real subscriber | stays in `setSun` |
| `currentNight = nightFactor` | a closure variable, read only by `ctx.night` (≈ 1567) | state for late births | gone (step 1) |
| `sunAltitude`, `sunToStyles?.(altitude)` | the post stack's dusk exposure (`postStack.setSunAltitude`, set ≈ 1837) | real subscriber | stays |
| `for (d of stream.dressings) d.lamps?.setNightFactor(nf)` | uniform write **and** a per-tile visibility flip (finding 3) | loop | gone (step 2) |
| `lampLights.setNightFactor(nf)` | the light pool's CPU intensities, per frame in `updateNearest` (ADR 0009) | real subscriber | stays |
| `lantern.setNight(nf)` | the lantern's light and the derived `nightShadowFree` (`lantern.ts`) | real subscriber | stays |
| `setFountainNight(nf)`, `setFountainSeason(date)` | module setters in `monument-layer.ts` (≈ 696, 701): `fountainNight`, `fountainSeason` | uniform writes | into the environment (step 3) |
| `setFurnitureNight(nf)`, `setClockTime(date)` | module setters in `furniture-layer.ts` (≈ 669, 678): `furnitureNight`, `clockMinutes` | uniform writes | into the environment (step 3) |
| `clayNight.value = nf` | a per-boot `uniform(0)` (≈ 1418) handed to `createStyleResources` (≈ 1442) | uniform write | becomes the shared night node (step 1) |
| `seasonClock.set(date)` | `createSeasonClock` (`crown-season.ts` ≈ 504): throttled (`SEASON_THROTTLE_MS`), calls back on a new calendar day; the callback (≈ 1479) loops over `stream.dressings` calling `vegetation.setSeason(climateDay(…))` and invalidates the shadow map if any crown changed | per-dressing instance state | the environment's season watch (step 1); the dressings follow it themselves (step 4) |
| `sceneClock.set({ date, atMs })` | the data layers' watched clock (≈ 1427) | watch | into the environment (step 1) |
| `invalidateShadows()` (unless `preview`) | the sun moved | real subscriber | stays |

Six of these are plain node writes. The rest are real subscribers or
per-dressing state.

### 2. Four night nodes hold one value

`clayNight` (create-app.ts), `lampNight` (`lamp-layer.ts` ≈ 140),
`fountainNight` (`monument-layer.ts` ≈ 677) and `furnitureNight`
(`furniture-layer.ts` ≈ 664) all carry `SunState.nightFactor`, clamped to
[0, 1]. `nightFactor` is a `smoothstepDown` (`sun-rig.ts` ≈ 58), so it is
in [0, 1] already: one node can replace all four without changing a
value.

`lampNight` is read by more than the lamps: `water-layer.ts` (the river
mist's night white, `MIST_WHITE_NIGHT`), `riverside-layer.ts` (the ferry
wakes, `WAKE_NIGHT`), `fence-layer.ts` (the fences' day lift) and
`style-dressing.ts` (the Comic lamp cones). But it is written only by a
tile's `LampControl.setNightFactor`, which only exists on a dressing with
lamp pools, and only runs for dressings in `stream.dressings`. **Latent
bug, from reading the code, not observed:** where no dressed tile has
lamps (a boot that only sees coarse levels, Modell far out, a site
without lamps), a change from day to night leaves the mist, the wakes and
the fences on their day value. Step 2 fixes it. Plates taken where lamp
tiles are dressed must stay identical; a coarse-only night view may
change, and should, towards the night look.

### 3. The lamps' night is no plain node write

`buildLamps` (`lamp-layer.ts` ≈ 542) returns a `LampControl` whose
`setNightFactor` (≈ 593) writes `lampNight.value` and flips
`glow.visible` and `decals.visible` at `nf > 0.01`, so by day the
additive halos and pools are skipped. Both meshes start hidden
(`buildGlow` ≈ 310, `buildDecals` ≈ 340). Their materials are already
scene-wide: `sceneMaterial("lamp-glow", …)` and
`sceneMaterial("lamp-pool", …)`. So the switch can move to the material:
`material.visible`, written once for the whole scene.

Checked in three r186.1 (`node_modules/three/src`):

- `Renderer._projectObject` (`renderers/common/Renderer.js` ≈ 3242)
  pushes a mesh, line, points or sprite only `if (material.visible)`
  (≈ 3278, 3326). A hidden material draws nothing, as a hidden object
  does.
- `RenderObject.getMaterialCacheKey` (`renderers/common/RenderObject.js`
  ≈ 751) skips `visible` (with `version`, `uuid`, `name`, `opacity`,
  `userData`). Setting it does not bump `material.version` and is not in
  `NodeMaterialObserver`'s `refreshUniforms`. **A visibility switch costs
  no rebuild.**
- **Trap:** `compileAsync` (≈ 896) collects what it compiles through the
  same `_projectObject` (≈ 985). `PostStack`'s `compileOne`
  (`post-stack.ts` ≈ 782) lifts `object.visible` and `frustumCulled` for
  the synchronous half of the call, not `material.visible`. With the
  material hidden by day, a tile's glow and pool — and the pipeline
  anchors (`pipeline-anchors.ts`, compiled through `compileOne`) — would
  compile nothing, and the first dusk would build them inside a frame.
  The same holds for `compileUnder` (`post-stack.ts` ≈ 848, Modell's
  Ausschnitt). Both must lift the drawable's material visibility for the
  synchronous half, as `compileOne` already does for the object. That is
  safe: no frame runs inside synchronous code, and the renderer is
  initialised before any tile compiles (the same assumption `compileOne`
  makes today).
- `paper-scene.ts` hides points and sprites for a Papier frame and
  restores what was visible (≈ 425–445); a glow object that is always
  visible is restored to visible. `drawablesOf` and
  `compileRepresentatives` traverse regardless of visibility.

### 4. What `catchUp` replays, and the births

`catchUp` (`tile-stream.ts` ≈ 609) writes `vegetation.applyLook`,
`vegetation.setSeason(ctx.season())`, `lamps.setNightFactor(ctx.night())`
and `showDataLayers`. `DressingPlugin.queueDressing` (≈ 2002) calls it
before the dressing's compile (≈ 2038: it keys the compile to the
season's crown material, plain or seasonal), and `hangDressing` (≈ 2119)
calls it after the hang (≈ 2174: whatever changed while it compiled).
Besides, `buildDressing` (≈ 1112) births the fine vegetation with
`applyLook` and `setSeason` (≈ 1253–1254) and the lamps with
`setNightFactor(ctx.night())` (≈ 1281). `buildCoarseDressing` (≈ 1021)
births the coarse crowns with no season at all: only the first `catchUp`
gives them one.

`ctx.season()` (create-app.ts ≈ 1568) is `climateDay(seasonClock.day(),
climate)`: the latest calendar day, not the throttled one the callback
has applied. The callback (≈ 1479) computes `climateDay(calendar,
climate)` again. That is the one duplicated computation.

### 5. The look in the trees is one scene-wide flag

`VegetationControl.applyLook` (`vegetation-layer.ts` ≈ 189) stores only
`look.multiTuft`, in three copies: the canopy (≈ 1420), the cadastre
(`tree-inventory-layer.ts` ≈ 492) and the joined control
(`tileVegetationSteps` in tile-stream.ts ≈ 801); the coarse crowns ignore
it (`coarse-crowns-layer.ts` ≈ 224). It is read back through
`multiTuft()` in exactly two places: `createVegetationLod` (≈ 1467) and
the cadastre's `updateLod` (`swapCrownLod(cells, cameraPos,
multiTuft)`). Both run from `stepVegetation` (create-app.ts ≈ 2761),
which can read the look store itself. Every dressing holds the same
value, so the look needs no subscription: it is a read at the LOD pass.
This is deeper than "subscribe at birth" and deletes state rather than
moving it.

### 6. The traffic slot needs the look after its hang

`trafficSlot` (`tile-stream.ts` ≈ 872): `show()` before `attach(host)`
builds nothing; it builds once attached and asked again. That is why the
second `catchUp` runs `showDataLayers` after `attach` in `hangDressing`,
and why `applyLook` loops over the dressings for it. If `attach` follows
the look (current value, then changes), both go.

### 7. The watch idiom as it is

`createWatch` (`feature-seam.ts` ≈ 64) does **not** deliver the current
value on subscribe, and emits on every `set`, equal or not. The data
layers read `get()`, then subscribe, in one synchronous step. This plan
adds one helper for that idiom (`follow`, step 4) and keeps `createWatch`
as it is. The look store (`lib/city/look-state.ts` `LookState`) already
fits `Watch<LookValues>` (`get`, `subscribe`).

### 8. Why the environment's nodes stay module-level

`sceneMaterial(key, make)` (`three-utils.ts` ≈ 464) builds each material
once per page and keeps it until the last app lets go
(`retainSceneMaterials`); a remount may boot the next app before the last
is gone. A node a factory closes over is therefore bound for the page,
not the boot. The shared nodes (night, the fountains' season, the clock's
minutes) must stay module-level, as `lampNight` is today. Only the
watches and the write (`set`) belong to the boot. A test against a fake
environment builds a part with a fake season watch and look store, calls
the real `set`, and reads the module nodes' `.value`.

### 9. Naming

`scene.environment` is three's environment map, which `docs/rendering.md`
says the viewer never sets. The new module is still called the scene
environment, after backlog item 20. Its head comment must say that it is
not three's `scene.environment`.

## The module

`app/_components/scene-environment.ts` (new). A sketch of the interface;
names may change, the shape should not:

```ts
/** 0 by day → 1 at night (SunState.nightFactor): every scene material
 *  that dims, glows or ignites after dark reads this one node. */
export const sceneNight: Live = uniform(0);
/** 1 while the fountains run, 0 from November to mid-April
 *  (lib/city/monuments.ts `fountainsRun`). */
export const fountainsOn: Live = uniform(1);
/** Minutes past 12 o'clock on the scene's clock (0–720), on the minute. */
export const clockMinutes: Live = uniform(0);
/** Night above which a material drawn only after dark is drawn. */
export const NIGHT_DRAWN = 0.01;
/** Marks a scene-wide material as drawn only after dark (the lamps'
 *  halos and pools): its `visible` follows `sceneNight` from now on. */
export function drawnAtNight<T extends Material>(material: T): T;

/** What a dressing binds at birth and lets go at its release. */
export interface DressingEnvironment {
  /** the crowns' day of the year in this city's climate (climateDay);
   *  get() is the latest day, emits come throttled (SEASON_THROTTLE_MS) */
  season: Watch<number>;
  /** the look store */
  look: Watch<LookValues>;
  /** something that casts changed: the shadow map is drawn again */
  castersChanged: () => void;
}

/** The spine's half. */
export interface SceneEnvironment extends DressingEnvironment {
  /** the scene's instant as the HUD set it last (SpineHooks.clock) */
  clock: Watch<SceneClock>;
  /** the sun and date of now: the shared nodes, the night-only
   *  materials, the season (throttled), the clock */
  set: (sun: SunState, date: Date) => void;
  dispose: () => void;
}

export function createSceneEnvironment(opts: {
  initialDate: Date;
  climate: SeasonShift; // lib/city/tree-season.ts seasonShiftFor
  look: Watch<LookValues>;
  castersChanged: () => void;
}): SceneEnvironment;
```

`set` writes `sceneNight`, each `drawnAtNight` material's `visible`,
`fountainsOn`, `clockMinutes`, the season clock and the scene clock.
`drawnAtNight` keeps a module-level set of materials (removed on the
material's `dispose` event) and sets a new one's `visible` from
`sceneNight.value` at once. The season watch wraps `createSeasonClock`:
`get()` returns `climateDay(clock.day(), climate)` (today's `ctx.season`
semantics), the clock's callback emits `climateDay(day, climate)` — one
function computes it. The module imports no layer. The layers import its
nodes.

## Steps

One commit per step (Conventional Commits, `refactor(scene): …`). After
each step: `bun run fix`, `bun run verify`, the step's own checks, and the
checks under *Verification* marked *each step*.

### Step 0 — Baselines on the base commit

Before any change, on `6c2a70ba` (or the drift-checked HEAD):

1. Build the e2e build (`NEXT_PUBLIC_POC_DEBUG=1`, as plan 074 part B
   did) and record, at `/dresden?scene=lite`, 800×600, after `__poc.ready`:
   `getRenderInfo().framedBuilds`, `getRenderInfo().gpuBytes`,
   `getRenderInfo().memory`, `getGpuDebug().anchors`. Then
   `handle.setSun(<a July night instant>)`, draw 10 frames, record
   `framedBuilds` again; `setSun(<a July dusk instant>)`, 10 frames;
   `setSun(<a January day instant>)`, 10 frames (bare crowns, fountains
   off); back to the July day, 10 frames. Pick the instants by
   `setSun`'s returned `SunState`: night `nightFactor` 1, dusk strictly
   between 0 and 1, day 0. Keep the script in the scratchpad; it runs
   again after every step. The deltas are the baseline: the lantern's
   shadow programs may legitimately build on the first night, on the base
   as well.
2. The same four numbers on a phone-emulated lite boot (390×844,
   `isMobile`, `hasTouch`; the `@phone` spec's settings).
3. Flicker-probe frames (the `flicker-probe` skill, `probe.mjs`) for
   `pastel` at the probe's default pose, at the same five instants
   (`date` is its fifth argument), into `out/base-<instant>`.
4. Snapshot JSONs for the plates (see *Verification*), captured with
   `__poc.handle.getCameraState()`, into `shots/`. Where a GPU is at
   hand, `SHOTS_TAG=before bun run shots`.

### Step 1 — The environment, handed to the stream

1. Create `app/_components/scene-environment.ts` with `sceneNight`,
   `createSceneEnvironment`, the season watch and the clock watch (the
   module sketch; `fountainsOn`, `clockMinutes` and `drawnAtNight` come
   in steps 2–3). The head comment says what the module owns and that it
   is not three's `scene.environment`.
2. In `bootApp` (create-app.ts): build the environment where
   `seasonClock` is built today (≈ 1478), after `invalidateShadows`
   (≈ 1411), with `climate: seasonShiftFor(opts.site.id)`,
   `look: opts.look`, `castersChanged: invalidateShadows`. Delete
   `clayNight` (≈ 1418), `currentNight`, `sceneClock` (≈ 1427) and
   `seasonClock`; pass `sceneNight` to `createStyleResources` (≈ 1442);
   `hooks.clock = env.clock` (≈ 1521). Keep, for this step only, a
   subscription to `env.season` that does what the season callback did
   (loop over `stream.dressings`, `setSeason(day)`, invalidate if any
   changed). `cleanups.push(env.dispose)`.
3. `setSun`: replace `clayNight.value = …`, `seasonClock.set`,
   `sceneClock.set` and `currentNight = …` with `env.set(state, date)`.
   Everything else stays for now.
4. `TileStreamContext` (`tile-stream.ts` ≈ 238): replace `look`,
   `night` and `season` with `environment: DressingEnvironment`. Readers:
   `catchUp` (≈ 609) reads `ctx.environment.look.get()`,
   `ctx.environment.season.get()` and, for the lamps until step 2,
   `sceneNight.value`; the births in `buildDressing` (≈ 1253, 1254,
   1281) the same. create-app.ts passes `environment: env` (≈ 1567).
   Update the contexts built in `tile-stream.test.ts` (the `catchUp` test
   and the `DressingPlugin` tests, ≈ 45, 381, 619, 769).
5. Tests: `scene-environment.test.ts` — `set` writes `sceneNight`
   clamped; the season watch's `get()` is the latest climate day at once,
   its first change emits at once (the throttle's first flush), a second
   within `SEASON_THROTTLE_MS` emits once, later; the clock watch emits on
   every `set`; `dispose` clears a pending throttle. `visual-style.test.ts`
   builds its resources with `sceneNight` where it used a fresh uniform
   only if a test needs the shared node.

No picture change: the clay reads a different node object holding the
same value.

### Step 2 — Lamps: visibility on the shared materials, no per-dressing night

1. `scene-environment.ts`: add `NIGHT_DRAWN` and `drawnAtNight` (finding
   3). `set` writes each registered material's `visible = night >
   NIGHT_DRAWN`.
2. `three-utils.ts`: add a helper that runs a callback with every
   material of one drawable (single or array) set visible and puts each
   back after, synchronously (`try`/`finally`), beside `aloneUnder`.
   Unit-test it in `three-utils.test.ts` (shown during, restored after,
   restored when the callback throws, an array material).
3. `post-stack.ts`: `compileOne` (≈ 782) and `compileUnder` (≈ 848) call
   `renderer.compileAsync` inside that helper. Check with
   `grep -n compileAsync app/_components/*.ts` that no other compile path
   meets a tile's or an anchor's drawable (`selection-outline.ts`
   compiles its own passes only).
4. `lamp-layer.ts`: delete `lampNight`; the heads, glow and pool read
   `sceneNight`. Wrap the `lamp-glow` and `lamp-pool` factories' result in
   `drawnAtNight`. Delete `mesh.visible = false` in `buildGlow` and
   `buildDecals`. Delete `LampControl.setNightFactor` and its empty-tile
   stub; `LampControl` keeps `group`, `headPositions`, `dispose`.
5. `water-layer.ts`, `riverside-layer.ts`, `fence-layer.ts`,
   `style-dressing.ts`: import `sceneNight` instead of `lampNight`.
6. create-app.ts `setSun`: delete the `stream.dressings` lamp loop.
   tile-stream.ts: delete the lamps' line in `catchUp` and the birth
   `lampControl.setNightFactor(…)` (≈ 1281); `catchUp`'s `Pick` loses
   `"lamps"`.
7. Tests (`lamp-layer.test.ts`): build a tile's lamps with two features
   against a fake ground (the file already builds pools for the light
   pool tests); `env.set` at night → the glow and pool meshes are
   `visible`, their materials `visible`, `sceneNight.value` 1; by day →
   the materials hidden, the meshes still `visible`, and each material's
   `version` unchanged by both writes (no `needsUpdate`). A material
   registered by day starts hidden. The `catchUp` test in
   `tile-stream.test.ts` loses its night line.
8. Check: the step-0 script. Its `framedBuilds` deltas (the night, the
   dusk, the January day, the July day) must equal the baseline; `getGpuDebug().anchors` must equal it. If a
   dusk now builds in a frame, the material lift in item 3 missed a path:
   STOP and find it before going on.

Picture: identical where lamp tiles are dressed. The latent bug of
finding 2 is fixed (mist, wakes and fences follow the night everywhere).

### Step 3 — The fountains' and the furniture's setters become the environment's nodes

1. `scene-environment.ts`: add `fountainsOn` and `clockMinutes`, and a
   pure `clockMinutesAt(date)` (`(hours % 12) * 60 + minutes`, today's
   `setClockTime` math). `set` writes `fountainsOn.value =
   fountainsRun(date) ? 1 : 0` and `clockMinutes.value =
   clockMinutesAt(date)`.
2. `monument-layer.ts` (≈ 676–703): delete `fountainNight`,
   `fountainSeason`, `setFountainNight`, `setFountainSeason`; the jets,
   the basins' water and the uplight read `sceneNight` and `fountainsOn`.
   `fountainTime` and `setFountainTime` stay: they are the frame clock,
   written in the frame (create-app.ts ≈ 3384), outside this plan.
3. `furniture-layer.ts` (≈ 664–689): delete `furnitureNight`,
   `clockMinutes`, `setFurnitureNight`, `setClockTime`; the lit columns
   read `sceneNight`, the clock hands `clockMinutes` from the
   environment. Move the clock test (`furniture-layer.test.ts` ≈ 110–120)
   to `scene-environment.test.ts`: two `set`s in one minute leave
   `clockMinutes` as it was, the next minute moves it, 14:31 and 02:31
   read the same.
4. create-app.ts `setSun`: delete the four setter calls and their
   imports.
5. Update the comments that name the old setters
   (`monument-layer.ts` ≈ 119, the head of the furniture's shared
   uniforms).

Picture: identical (the same values in fewer nodes).

### Step 4 — The dressings follow the environment; `catchUp` goes; `setSun` reaches its shape

1. `feature-seam.ts`: add `follow(watch, listener)`: calls
   `listener(watch.get())`, then returns `watch.subscribe(listener)`.
   Test it in `feature-seam.test.ts` (the current value first, every
   change after, none after the returned call).
2. The look out of the trees (finding 5): delete `applyLook` and
   `multiTuft` from `VegetationControl` and its three implementations
   (canopy, cadastre, the joined control in `tileVegetationSteps`) and
   the coarse crowns' stubs. `createVegetationLod`'s pass takes the rich
   crowns' switch as an argument; the cadastre's `updateLod` takes it
   too. `stepVegetation` (create-app.ts ≈ 2761) reads
   `opts.look.get().multiTuft` once per pass. `applyLook` (≈ 1904) loses
   `d.vegetation?.applyLook(look)` and keeps `crownTiers.force()`. Update
   `vegetation-layer.test.ts` (≈ 98) and `tree-inventory-layer.test.ts`
   (≈ 186).
3. The season at birth: in `tile-stream.ts`, a `followEnvironment(d,
   env)` that subscribes a dressing's vegetation to `env.season` with
   `follow` (`if (d.vegetation.setSeason(day)) env.castersChanged()`) and
   returns the unsubscribe. `queueDressing` calls it where the first
   `catchUp` is now (≈ 2038), before the compile — so the compile is
   still keyed to the season's crown material, for fine and coarse
   dressings alike. Store the unsubscribe on the dressing (a
   `TileDressing` member, e.g. `unfollow`); `disposeDressing` (≈ 636)
   calls it first. Every release path goes through `disposeDressing`
   (≈ 1099, 1414, 2079, 2204, 2384); a build that throws never reached
   `followEnvironment`. Delete the birth `setSeason` and `applyLook`
   (≈ 1253–1254). Delete step 1's interim season loop in create-app.ts.
4. The traffic (finding 6): `TrafficHost` gains `look:
   Watch<Pick<LookValues, "trafficLayer">>`; `attach` follows it (on:
   `show()`, off: `hide()`), and the slot's `dispose` unsubscribes.
   `hangDressing` passes `this.ctx.environment.look`. Delete the second
   `catchUp` (≈ 2174), `catchUp` itself and the `showDataLayers` loop in
   `applyLook`; keep `showDataLayers` only if a test or a caller still
   needs it. Rewrite the traffic tests in `tile-stream.test.ts` (≈ 755 on)
   to drive a look watch: switched on before the hang builds on the hang,
   off keeps the bodies, a release unsubscribes.
5. The `catchUp` test becomes: a dressing built against a fake
   environment (`createWatch(180)` for the season, `createLookState()`,
   a counting `castersChanged`) takes the season of now at birth, a
   change while it compiles, a change after it hangs, and nothing after
   its release; `castersChanged` is called only when `setSeason` said a
   crown changed.
6. `setSun` ends as: `sunRig.update`, `streamShadowTiles`,
   `sunAltitude` and `sunToStyles`, `env.set(state, date)`,
   `lampLights.setNightFactor`, `lantern.setNight`, `invalidateShadows`
   unless `preview`. No loop over `stream.dressings` remains in `setSun`
   or `applyLook`.
7. `TileStreamContext` keeps `environment` only; nothing in
   `tile-stream.ts` reads a night, a season or a look any other way
   (`grep -n "season()\|night()\|ctx.look" app/_components/tile-stream.ts`
   is empty).

Picture: identical. A dressing now hears a season change while it
compiles instead of after; the material it switches to is warmed by the
crown stand-ins (`warmCrowns`), as it was for the hang's `catchUp`.

### Step 5 — Docs

Per the `docs-upkeep` skill:

- `docs/rendering.md`, *Light and shadow*, the "Lamps at night" bullet
  (≈ line 342): one night node (`sceneNight`, `scene-environment.ts`),
  the halos and pools hidden by their materials by day.
- `.claude/skills/city-walker/SKILL.md`, *Node materials*: the sentence
  on module-level uniform nodes a setter writes (`fountainTime`,
  `lampNight`, `mapAltitude`) now names the environment's nodes and
  `drawnAtNight`; *Scene architecture*: the environment beside the
  feature seam.
- `.claude/skills/new-scene-layer/SKILL.md`, item 8 *Night*: scale by
  `sceneNight`; a part drawn only after dark wears `drawnAtNight`; a part
  whose instances follow the date `follow`s the environment at birth and
  lets go in `disposeDressing`.
- `docs/transformations.md`: the rows that name `setClockTime`
  (≈ 3196), `setFountainNight` (≈ 3266) and `setFountainSeason`
  (≈ 3377).
- ADR 0027, *Decision*, "anything that moves a shared uniform's
  `.value`": amend with one line — scene-wide values the sun and the date
  move live in `scene-environment.ts`; a layer reads them, it adds no
  setter to `setSun`.
- AGENTS.md, *Where things live*: add `scene-environment.ts` to the
  spine's list.
- `docs/plans/README.md`: this plan's row; backlog item 20 closed or cut
  to what is left; plan 074 part C's note that `setSun` and `applyLook`
  no longer loop over the dressings.

## Verification

**Each step:**

- `bun run fix`, `bun run verify` (lint, typecheck, units).
- The step-0 script on the lite boot: `framedBuilds`, `gpuBytes`,
  `memory`, `anchors`, and the deltas over day → night → dusk → January
  day → July day, against the baseline.
- Flicker-probe frames at the five instants; compare each `pastel.a.png`
  with the base's: copy the base frame into the new run's folder as
  `pastel.base.png` and run `python3 .claude/skills/flicker-probe/diff.py
  <dir> pastel base:a`. The share changed must be no larger than the
  run's own still pair (`a:b`). This is SwiftShader: it measures change,
  not light.
- `bun run test:e2e -- --grep @desktop-render` (SwiftShader, presence,
  ADR 0018).

**Once, after step 2, and at the end:**

- Add one step to *post and shader controls survive real frames*
  (`e2e/city-walk.spec.ts`, `@desktop-render`, ≈ line 1137): set a night
  instant through `__poc.handle.setSun`, draw two frames, expect no
  errors and `getRenderInfo().framedBuilds.other` no higher than before
  the step plus the base's own night delta; set the day back. Budget it
  in frames (two), as the spec does.
- After step 4 also `--grep @desktop-hud` (the data layers' switch-on
  spec drives the traffic slot) and `--grep @phone`.

**Plates, on a real GPU** (`pr-snapshots` skill; `bun run shots`,
headed). The same snapshots before (`SHOTS_TAG=before`, on the base) and
after (`SHOTS_TAG=after`). Views, oblique, never head-on:

| View | Instants | What to look for |
| --- | --- | --- |
| A street with lamps, street trees and a clock or an advertising column, at eye height | July day, July dusk, July night, January day, January night | lamp halos and pools on at dusk and after, off by day; the lit column; the hands; autumn and bare crowns and their thin winter shadow |
| A fountain square (a fountain in the spawn tile's monuments), oblique from about 30 m | July day, July night, January day | jets and basin at night; drained in January |
| A river reach with fences and a ferry line, from about 150 m | July night | mist, wakes and fences at their night value |
| Modell, far out at night, only coarse levels loaded | July night | **may differ** (finding 2): mist, wakes and fences now at their night value |

The first three must be identical by eye. With no GPU at hand (the cloud
container has none), the plates are left for the maintainer: put the
snapshots in the PR description, as the skill says, and record in the
README row that the plates are open.

**Phone memory.** The phone-emulated numbers of step 0 after step 4:
`gpuBytes` and every `memory` counter equal. The change adds a few
closures per dressing and no buffer.

## STOP conditions

Stop and report (in this file's *Findings*, below the existing ones) if:

- A visibility switch causes a node rebuild: `material.version` moves,
  or a dusk or dawn adds a framed build the baseline does not have.
- Any compile count changes: a `framedBuilds` delta (`other` or
  `shadow`) over the step-0 script differs from the baseline, or
  `getGpuDebug().anchors` differs.
- A phone's memory grows: `gpuBytes` or any `memory` counter on the
  phone-emulated boot is higher than the baseline.
- A probe diff against the base is larger than the run's own still pair
  at an instant where lamp tiles are dressed, or a plate differs by eye
  (other than the Modell night view).
- A shared node turns out to need a per-boot value (two apps alive at
  once needing different nights): the module-level nodes of finding 8
  would then be wrong.
- `follow` at birth makes a crown material switch inside a compile that
  the crown warm-up does not cover (a framed build after a January jump
  that the baseline does not have).

## Out of scope

- The per-frame clocks (`setCrownTime`, `setWaterTime`,
  `setFountainTime`, the glass's `setDataTime`): one write a frame
  already.
- The rest of plan 074 part C (the spine as a module with fake features;
  the stream-change handler and the frame as hubs). This plan only
  empties `setSun` and `applyLook` of the dressings.
- The light pool's head list (`lampLights.setHeads` in the stream-change
  handler, create-app.ts ≈ 2484) and the furniture's near cells in
  `stepVegetation`: per change and per pass, not environment.
- The post stack's sun (`setSunAltitude`, `Stylize.night`), the sun rig,
  the lantern's own night ramp: real subscribers, left as they are.
- Moving `fountainsRun` or the clock's minutes into TSL: they stay CPU
  values written on a date change.
- Any change to what the look store holds or to `createWatch`'s
  semantics.

## Maintenance notes

- A new scene-wide value the sun or the date moves goes into
  `scene-environment.ts` as a module-level node written by `set`, and the
  layer reads it. It never adds a setter to `setSun`.
- A new per-instance state that follows the date or the look (a buffer, a
  material swap) `follow`s the environment in `followEnvironment` and is
  let go in `disposeDressing`; it reports a changed caster through
  `castersChanged`.
- A new part drawn only after dark wears `drawnAtNight` on its
  scene-wide material. A per-tile material cannot use it; give it a
  night-scaled opacity instead, or make it scene-wide.
- Any new compile path must lift material visibility like `compileOne`,
  or the night-only materials build inside the first dusk frame.
