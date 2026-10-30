# Plan 069: Find what holds the load at 52 %, then take it off the tile path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Steps 6 and 7 are **gated** on step 2's measurement — do them
> only when the gate's condition holds. If anything in the "STOP
> conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in the plans index — unless a
> reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 85a41b7..HEAD -- app/_components/tile-stream.ts app/_components/tile-stream.test.ts app/_components/create-app.ts app/_components/city-walk.tsx app/_components/city-layer.ts lib/city/ask-more.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status (2026-10-10)**: **PARTIAL** — built on the performance PR
  (branch `claude/perf-optimizations`): step 5 (meshopt in the decoder's
  workers — two on every tier, `MESHOPT_WORKERS`), and beside the plan the
  scene compile before the first frame bounded like a tile's
  (`withinCompileWait`), stage reports passed on only when they change,
  a terrain level's rasters asked for at once (`loadTerrainRasters`), a
  per-attempt stall guard in `fetchBytes` (`STALL_MS`), one stream-change
  pass per task (`queueChange` in `create-app.ts`) and a message-channel
  `scheduler.yield` for WebKit (`main-yield.ts` — three's compiles waited a
  frame per step there; unmeasured on an iPhone, step 2 should check it).
  **Then (branch `worktree-agent-aa0338b64fd10a649`, after the iPhone
  crash reports):** one meshopt worker on a phone (`MESHOPT_WORKERS` per
  tier: each worker's WebAssembly heap keeps its largest buffer); the
  tiles' CPU arrays counted (`cpuBytesOf` → `getGpuDebug().cpuMB`, the
  trail's `cpuMB`, the reports' `max_cpu_mb`/`last_cpu_mb`/`cpu_max`);
  **step 7, ungated** — every crash is an iPhone that ran out of process
  memory with three's GPU count low (CITY-WALK-B: 257 MB held, one
  building tile, no terrain, "boot after buildings"), so the BVH comes
  when a ray first needs it, not as the tile lands (it needed more than
  filters: see step 7's note); steps 1, 3, 4 and 6 as written (step 6's
  gate held: `dressing:asks` 190–299 ms locally). Step 2's device rows
  are open: no device here — measured instead with a mobile-emulated
  headless Chromium A/B against `main` (Findings). Not fed into the
  cache's weighing or the governor yet: the `cpuMB` figure is recorded so
  a later step can.

- **Priority**: P1
- **Effort**: M (steps 1–5); +M for each gated step
- **Risk**: MED — step 4 trades a short pop-in of trees for a stream that keeps moving
- **Depends on**: none; land after plan 068 if both are in flight (068 shrinks what streams, this plan shrinks what each tile costs)
- **Category**: perf (boot, frame pacing)
- **Planned at**: commit `85a41b7`, 2026-10-10

## Why this matters

Users see the load "freeze at 52 %" and "very jerky movement". 52 % is
`WALKABLE_PERCENT` (`lib/city/load-stages.ts:54`): the bar reaches it at
`stage("light", 1)` (`app/_components/create-app.ts:2858`), and the load
screen stays up another 600 ms (`VEIL_HOLD_MS`, `handover.ts:37`) before
it drops. Two mechanisms fit the report and this plan must tell them
apart before fixing anything:

- **(a) the page is busy** right after 52 %: the first frames at the start
  pose build the shadow pass's pipelines synchronously (three's
  `compileAsync` compiles the main pass only —
  `node_modules/three/src/renderers/common/Renderer.js:896ff.`; AGENTS.md
  says so too), the two pastel post pipelines build on their first render
  (`post-stack.ts`, `toWarm`), the HUD mounts its full tree, and
  neighbouring tiles land with main-thread work (a city BVH,
  `city-layer.ts:253–262`, ≈75 ms a tile on a desktop, 3–5× on a phone;
  raster decodes; dressing builds). The timer that drops the veil then
  fires late, and the load screen looks frozen at 52 %.
- **(b) the number is stuck** after the veil: *Umgebung* is
  `stream.tiles.loadProgress` until the renderer is idle
  (`lib/city/boot-phases.ts:74–84`), and the renderer's parse slots are
  held by tiles **waiting**: each content's `processTileModel` runs inside
  its parse job (`3d-tiles-renderer/src/three/renderer/tiles/TilesRenderer.js:808`,
  `core/renderer/tiles/TilesRendererBase.js:1724`) and, in this plugin,
  awaits its rasters' site-wide decode turn, a compile (≤ 3 s) and — for a
  fine level that takes over from the coarse one — its whole dressing
  (≤ **10 s**, `HAND_OVER_WAIT_MS`). Dressings build **one at a time** for
  the site. A phone has **two** parse slots (`PHONE_STREAM.parses`).

The same long tasks are what makes walking jerky once the scene is up.

## Current state

- `app/_components/tile-stream.ts`
  - Lines 435–438:
    ```ts
    /** How long a tile may wait on its compile before it shows regardless. */
    const COMPILE_WAIT_MS = 3000;
    /** How long a level may wait on its dressing while the tile's other level
     *  stands in for it (DressingPlugin.handsOver) before it shows regardless. */
    const HAND_OVER_WAIT_MS = 10_000;
    ```
  - `dressContent` (from ~line 1305): `dressCity` (BVH, sync) or
    `await this.dressTerrain(...)` (rasters), then
    `await withinCompileWait(this.compileContent(scene))`, then
    ```ts
    if (
      dressed &&
      extras.kind === "terrain" &&
      !this.released.has(scene) &&
      this.handsOver(extras)
    ) {
      await withinWait(dressed, HAND_OVER_WAIT_MS);
    }
    ```
    (line 1334). `handsOver` (line 1239) returns false before the gate
    opens and otherwise `takesOver(extras, shown)`.
  - `queueDressing` (line ~1566): `this.chain = this.chain.then(() => this.ctx.dressingGate).then(async () => { … buildDressing … compileUnder … })` — FIFO, one at a time.
  - `PHONE_STREAM = { parses: 2, downloadsPerOrigin: 4 }` (line 1965);
    `paceStreaming` installs it (line 1973).
  - The glTF plugin (line ~2005):
    `new GLTFExtensionsPlugin({ metadata: true, meshoptDecoder: MeshoptDecoder })`;
    `MeshoptDecoder.useWorkers` is never called anywhere
    (`grep -rn useWorkers app lib` → nothing), so meshopt decodes run on the
    main thread. three's decoder supports workers from a Blob URL
    (`node_modules/three/examples/jsm/libs/meshopt_decoder.module.js:100–125, 167–186`),
    and `GLTFLoader` prefers `decodeGltfBufferAsync` (`GLTFLoader.js:1643`) —
    no bundler involvement (the reason plan 043's own worker was blocked
    does not apply).
  - `buildDressing` (from line 855) builds every layer and then, eagerly,
    the inquiry's ask sets (lines ~1035–1065: `treeSets`, `askSets`,
    `bridgeAskSet`, `moreSets(...)`). `moreSets` → `canopySets`
    (`lib/city/ask-more.ts:151–191`) **places every canopy tree a second
    time** (`canopyPlacements([f], …)` per feature, after the vegetation
    layer already placed them) for a card nobody may ever open.
- `app/_components/create-app.ts`
  - The boot (lines 2822–2858): poll until the spawn's city and terrain
    show, `await postStack.compile(scene)`, `placeStart()`, then
    `stage("light", 1);` — before any frame at the start pose has drawn the
    shadow map there.
  - The frame (line 2625ff.) reads `sunRig.shadowPending()` before
    `postStack.render()`.
- `app/_components/city-walk.tsx:905–918` — after the handle resolves:
  `setStatus({ phase: "running" })`, the veil timer (600 ms), the gate
  timer (600 + 250 ms).
- `app/_components/raster-upload.ts:33–36` — `RASTER_TURNS = { desktop: 5, mobile: 1 }`.
- No `performance.mark`/`measure` exists anywhere in `app/` or `lib/`.
- **Privacy rule (ADR 0043, crash-trail.ts)**: the crash trail and the
  reports never carry a tile id ("a tile's id names where the player
  was"). Timing names with tile ids are fine in `performance` entries
  (they stay in the browser) but must never go into `opts.trail` or
  `crash-reports`.

Conventions: comments in full sentences explaining *why*; pure logic in
`lib/city/` with colocated `bun:test` tests; tests for `tile-stream.ts`
live in `app/_components/tile-stream.test.ts` (exemplar: the
`"a phone streams fewer contents at once…"` test, ~line 444).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Unit tests | `bun run test` | all pass |
| One file | `bun test app/_components/tile-stream.test.ts` | all pass |
| Typecheck | `bun typecheck` | exit 0 |
| Lint + format | `bun run fix && bun lint` | exit 0 |
| E2E | `bun run build && bun run test:e2e` | all pass |
| Dev over HTTPS (phones on the LAN) | `bun dev` | serves `https://…/dresden` |

## Suggested executor toolkit

- `city-walker` skill (boot phases, tile stream, QA harness).
- Chrome DevTools *Performance* panel (desktop) and Safari Web Inspector
  *Timelines* with a cabled iPhone: both show `performance.measure`
  entries in the *Timings* track.

## Scope

**In scope**:
- `app/_components/stream-timing.ts` (create) and `app/_components/stream-timing.test.ts` (create)
- `app/_components/tile-stream.ts`, `app/_components/tile-stream.test.ts`
- `app/_components/create-app.ts`
- `app/_components/city-walk.tsx` (one mark at the veil drop)
- `lib/city/ask-more.ts` only if gated step 6 needs it
- `app/_components/city-layer.ts`, `collision.ts` only in gated step 7
- `docs/rendering.md` (boot sequence section), `AGENTS.md` (the `?trace=1` knob in the URL-knob list)

- `app/_components/crash-trail.ts` — **only** the one-word addition of
  `"trace"` to `TRAIL_QUERY` (line 45) and its test if one pins the list

**Out of scope**:
- The crash trail's and reports' content (`crash-trail.ts` beyond
  `TRAIL_QUERY`, `crash-reports.ts`): nothing measured here goes into
  them (tile ids).
- `lib/city/boot-phases.ts` and `lib/city/load-stages.ts` weights.
- The memory governor, safety ladder and cache bounds.
- Plan 043's worker approach (blocked on Turbopack; not needed for step 5).

## Git workflow

- Branch: `perf/069-streaming-without-stalls`
- One commit per step, Conventional Commits, e.g.
  `perf(stream): meshopt decodes in workers`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Timing marks, local only

Create `app/_components/stream-timing.ts`: thin wrappers over
`performance.mark` / `performance.measure` (try/catch: they can throw on
duplicate or missing marks in old WebKit) plus a `longtask`
`PerformanceObserver` (feature-detected: `PerformanceObserver.supportedEntryTypes?.includes("longtask")`; Safari has none — then report "n/a") that sums count and duration since boot. Export:

```ts
export function timed<T>(name: string, work: () => Promise<T>): Promise<T>;
export function timedSync<T>(name: string, work: () => T): T;
export function markOnce(name: string): void;
/** name → { count, totalMs, maxMs } of every measure so far, plus long tasks */
export function streamTimingSummary(): Record<string, { count: number; totalMs: number; maxMs: number }>;
```

Aggregate by a **category** name without the tile id (e.g. `tile:bvh`,
`tile:rasters`, `tile:compile`, `tile:handover-wait`, `dressing:queue-wait`,
`dressing:build`, `dressing:compile`, `dressing:asks`), and put the tile id
only into the `performance.measure` detail/name you pass to the browser
(e.g. `tile:bvh 33412_5656_2_sn`), so DevTools shows it but the summary
does not carry it.

Instrument:
- `tile-stream.ts`: in `dressContent` wrap `dressCity` (`tile:bvh`; the
  BVH dominates it), `await this.dressTerrain(...)` (`tile:rasters`),
  `withinCompileWait(this.compileContent(scene))` (`tile:compile`), the
  hand-over wait (`tile:handover-wait`); in `queueDressing` measure the
  time from queueing to the start of `buildDressing` (`dressing:queue-wait`),
  `buildDressing` itself (`dressing:build`), and the compile wait
  (`dressing:compile`). Inside `buildDressing`, wrap the ask-set block
  (`dressing:asks`).
- `create-app.ts`: `markOnce("boot:light-done")` at line 2858; in the
  frame loop, measure the first frame whose `shadowRendered` is true after
  `light-done` (`boot:first-shadow-frame`, the frame's full duration), and
  the first 60 frames' durations after `light-done` as `boot:frame` (count,
  total, max).
- `city-walk.tsx`: `markOnce("boot:veil-drop")` where `setVeilUp(false)`
  runs (line ~910) and measure `boot:light-to-veil` between the two marks.
- With `?trace=1` in the URL (a new QA knob: add `"trace"` to
  `TRAIL_QUERY` in `app/_components/crash-trail.ts:45`, the crash trail's
  allowlist of query knobs since plan 058, and to AGENTS.md's URL-knob
  list), `create-app.ts` prints
  `console.table(streamTimingSummary())` once at "loaded" and again 20 s
  later. (AGENTS.md bans `console.log`; `console.info`/`console.table`
  behind an explicit URL knob match how `crash-trail.ts` already logs with
  `console.info`/`console.debug`. Never call `console.log`.)

Unit-test `stream-timing.ts` with a fake clock where possible: categories
aggregate count/total/max; a missing mark does not throw; the summary
contains no string matching `/\d{5}_\d{4}/` (no tile id).

**Verify**: `bun test app/_components/stream-timing.test.ts && bun typecheck` → pass, exit 0.

### Step 2: Measure — this decides steps 4, 6 and 7

Run `bun dev` (HTTPS), open `/dresden?trace=1`:
1. desktop Chrome with WebGPU, cache disabled, 5 cold loads;
2. desktop Chrome `?gpu=webgl2&trace=1`, 3 cold loads;
3. an iPhone (Safari, cabled Web Inspector), 3 cold loads;
4. if available, a mid-range Android phone, 3 cold loads.

Record per run: `boot:light-to-veil`, `boot:first-shadow-frame`, max
`boot:frame`, long tasks (count/total), and the totals and maxima of every
`tile:*` and `dressing:*` category, plus the time from `boot:veil-drop`
to "loaded". Write the table into the PR description and the plan's
"Findings" section (append one at the end of this file).

Decide (write the decision next to the table):
- **(a) dominates** if `boot:light-to-veil` > 2 s or `boot:first-shadow-frame` > 500 ms on any device.
- **(b) dominates** if `tile:handover-wait` + `dressing:queue-wait` exceed
  50 % of the time from veil drop to "loaded" on the phone.

**Verify**: the table exists with all four rows (or a note that a device
was unavailable).

### Step 3: Make the 52 % honest

Move `stage("light", 1)` (create-app.ts:2858) to after the first frame
that has drawn the shadow map at the start pose: after `placeStart()`,
await a promise the frame loop resolves on the first frame where
`shadowRendered` is true (or after 2 frames when the sun is down —
`sunRig.shadowPending()` stays false by night). Keep it bounded
(`withinWait(…, 3000)`, the helper pattern from tile-stream.ts) so a
stalled frame never holds the boot. This moves the synchronous
shadow-pipeline build under *Licht und Schatten werden berechnet*, which
is what it is.

By night (`sunRig.shadowPending()` never turns true; the sun rig never
asks for the map below the horizon) the wait must short-circuit after the
two frames, never burn the 3 s bound. The handle resolves later by about
one frame (two under SwiftShader, ~1 s each in the lite profile): check
that the e2e boot budgets (`slow(...)` timeouts in `e2e/city-walk.spec.ts`)
still hold.

**Verify**: `bun typecheck && bun run test` → exit 0; in `bun dev` the bar
reaches 52 % only after `boot:first-shadow-frame` (check the order of the
marks in DevTools); with a night snapshot applied before boot (or
`initialDate` at 23:00) the boot is not 3 s slower; `bun run build && bun
run test:e2e` → all pass within their budgets.

### Step 4: A level waits for its dressing per tier, not 10 s

Replace `HAND_OVER_WAIT_MS` with an exported pure function and use it in
`dressContent`:

```ts
/** How long a level may wait on its dressing while the tile's other level
 *  stands in for it (DressingPlugin.handsOver): the wait holds one of the
 *  renderer's parse slots (processTileModel runs inside the parse job), and
 *  dressings build one at a time. A phone has two slots: it shows the level
 *  bare and dresses it after (the trees appear a moment later); a desktop
 *  waits a little, so most hand-overs still swap the trees in one frame. */
export function handOverWaitMs(tier: DeviceTier): number {
  return tier === "mobile" ? 0 : 1500;
}
```

`DressingPlugin` reads the tier from `this.ctx.tier` (already in
`TileStreamContext`). With 0, skip the `withinWait` call entirely (do not
schedule a 0 ms timer).

Test in `tile-stream.test.ts`: `handOverWaitMs("mobile") === 0`,
`handOverWaitMs("desktop")` is between 1 and 3000 ms.

**Accepted compromise** (say it in the PR): on a phone, when a tile's fine
level replaces its coarse level, the coarse level's thinned crowns vanish
and the fine level's trees, lamps and rails appear once its dressing is
built — a short pop-in instead of a stalled stream.

**Verify**: `bun test app/_components/tile-stream.test.ts` → pass; re-run
step 2's phone row: `tile:handover-wait` total ≈ 0 and the time from veil
drop to "loaded" not longer than before.

### Step 5: Meshopt decodes in workers

In `createTileStream` (tile-stream.ts ~line 1995), before registering the
glTF plugin, call once per page:

```ts
// The glTF's meshopt buffers decode in three's Blob-URL workers (no bundler
// involved), not in the parse job's main-thread task.
MeshoptDecoder.useWorkers(ctx.tier === "mobile" ? 1 : 2);
```

`useWorkers` resizes the worker pool to the count (idempotent for the same
count), so a StrictMode remount is harmless. Do not terminate the workers
on `dispose` (a remount reuses them; the module keeps them for the page).

**Verify**: in `bun dev`, DevTools → Sources/Threads shows the decoder
workers; the city and terrain still render; `bun run test:e2e` passes
after `bun run build`. Re-measure `tile:*` maxima (should not rise).

### Step 6 (gated: only if `dressing:asks` max > 20 ms on the phone or > 8 ms on desktop): ask sets off the dressing's critical path

Build the inquiry's ask sets after the dressing hangs, in idle time:

- In `buildDressing`, return `asks` as an **empty array** and a
  `buildAsks: () => void` closure that pushes the sets into that same
  array (the traffic slot pushes into it too — `src.asks.push(set)`,
  tile-stream.ts:709 — so the array's identity must not change).
- In `hangDressing`, schedule
  `requestIdleCallback(() => { if (entry.dressing === dressing) dressing.buildAsks?.(); }, { timeout: 2000 })`
  (with a `setTimeout(…, 500)` fallback where `requestIdleCallback` is
  missing — Safari before 18).
- Until then a click on that tile's trees finds nothing to ask, which is
  acceptable for the first second after a tile appears.
- Optional, in the same step if it is simple: let `canopySets` reuse the
  vegetation layer's placements instead of placing every tree again
  (`lib/city/ask-more.ts:151–191`). If it is not simple, leave it.

Test: in `tile-stream.test.ts`, a hung dressing's `asks` is `[]` until the
idle callback runs and then holds the sets (stub `requestIdleCallback` on
`globalThis`).

**Verify**: `bun run test` → pass; `dressing:build` max falls by about the
old `dressing:asks` max.

### Step 7 (gated: only if `tile:bvh` is the largest `tile:*` category on the phone, after plan 068): no BVH for building tiles far from the camera

Build a city tile's BVH only when the camera comes within ~400 m of the
tile's bounds (checked at the 10 Hz pose tick), in an idle callback. Every
raycast against city meshes must then skip meshes without
`geometry.boundsTree` — the global `Mesh.prototype.raycast =
acceleratedRaycast` (`collision.ts:25`) falls back to a brute-force
triangle loop otherwise. The collider already skips them
(`collision.ts:123`); the pick, focus and tap raycasters
(`city-layer.ts:313–380`, `create-app.ts:1688, 2162`) must filter their
target lists to meshes with a `boundsTree`. The spawn tile's BVH must
still exist before `placeStart()` (ADR 0032: the camera is never inside a
building). This is the cheap half of plan 043 (no worker); if it turns
out to need more than these filters, STOP and report.

> **As built (2026-10-10).** Ungated by the iPhone crash reports (the
> page's process memory, not three's count). It needed more than
> filters, and the operator asked for it regardless: the collider's two
> horizontal rays (`resolveStep`, `along`) went through
> `intersectObjects` and would have fallen back to three-mesh-bvh's
> brute-force loop — only its vertical rays skipped a mesh without a
> BVH. Every ray now asks only the tiles whose world box it enters,
> nearest first, and builds a missing BVH where it may: the collider
> always (once the boot has placed the player — the spawn tile's BVH is
> built by that placing, so ADR 0032 holds at the start pose), a pick up
> to its first hit, the probe and the double tap up to the ground; the
> autofocus never. The tiles within 400 m of the camera are built in idle
> time at the 10 Hz tick (`nearestWithoutBvh`). three-mesh-bvh sorts the
> index in place without marking it for upload (checked in
> `node_modules/three-mesh-bvh/src/core`): the GPU keeps its order, the
> same triangles.

## Test plan

- `app/_components/stream-timing.test.ts` (new): aggregation, no tile id
  in the summary, no throw on a missing mark.
- `app/_components/tile-stream.test.ts`: `handOverWaitMs` per tier; (step
  6) asks built on idle.
- Pattern: the existing `paceStreaming` and `takesOver` tests in that file.
- `bun run test` → all pass; `bun run test:e2e` after `bun run build` → all pass.

## Done criteria

- [x] `bun typecheck`, `bun lint`, `bun run test` exit 0 (`bun run verify`)
- [ ] `bun run build && bun run test:e2e` passes — on the loaded local
      machine only with CI's budgets and a raised per-test limit, and the
      whole-site spec not even then (Findings); to be judged on CI
- [x] `grep -n "HAND_OVER_WAIT_MS" app/_components/tile-stream.ts` returns nothing; `handOverWaitMs` is exported and tested
- [x] `grep -n "useWorkers" app/_components/tile-stream.ts` returns one line
- [ ] Step 2's measurement table (before) and a re-measurement (after) are in the PR and in this plan's Findings — in the Findings as a
      local mobile-emulated substitute; the device rows are open; no PR
- [x] `grep -rn "trail" app/_components/stream-timing.ts` returns nothing (timings never reach the crash trail)
- [x] `docs/rendering.md`'s boot sequence names the honest light stage and the per-tier hand-over wait; AGENTS.md lists `?trace=1`
- [ ] No files outside the in-scope list modified — the operator widened
      the scope (one meshopt worker on a phone, the tiles' CPU arrays
      counted, step 7 ungated): `crash-trail.ts`/`crash-reports.ts` (lib),
      `terrain-tin.ts`, `terrain-layer.ts`, `three-utils.ts`,
      `collision.ts`, `city-layer.ts`'s picks, `inquiry-probe.ts`,
      `main-yield.ts`, the privacy page, ADR 0024

## STOP conditions

- The excerpts do not match the code (drift).
- Step 2 shows neither (a) nor (b) dominating — report the table; the
  freeze is elsewhere (likely the WebGL2 backend's synchronous compiles;
  say which backend the slow devices ran).
- After step 4, the phone's "loaded" arrives *later* than before, or tiles
  stay bare (no dressing ever arrives) — revert step 4 and report.
- Meshopt workers fail to start (CSP, an error in the console) — revert
  step 5 and report the error.
- Step 7 needs changes beyond filtering raycast targets.

## Maintenance notes

- The timing categories are a contract for future perf work: keep names
  stable, add new ones rather than renaming.
- If plan 043's worker is ever unblocked, step 7's lazy BVH composes with
  it (lazy *and* off-thread).
- A new per-tile part built in `buildDressing` should be measured under
  `dressing:build` and considered for idle time if it serves an on-demand
  feature (as the ask sets do).
- Reviewer: check that no measure name with a tile id reaches
  `opts.trail`, `crash-reports.ts` or `onStats`.

## Findings

### 2026-10-10 — a local substitute for step 2 (no device here)

**Setup.** No iPhone or Android phone was available. Instead: headless
Chromium (Playwright's chromium-1194) with Playwright's `devices['iPhone
13']` descriptor (390×664 at DPR 3, touch: the viewer took the **mobile
tier** in every run — `(pointer: coarse) and (hover: none)` matched),
the renderer's WebGL2 backend over SwiftShader (headless Chromium has no
WebGPU adapter), **no CPU throttling**; production builds with
`NEXT_PUBLIC_POC_DEBUG=1` of `main` (266bb89) and of this branch, `next
start`, a cold browser profile per run, `?trace=1` on both (main ignores
it). Two URLs: `/dresden?scene=lite` (the spawn tile only) and
`/dresden?scene=lite&block=1` (the whole site, lite). The machine was
shared: **load average 10–21 on four cores** from other agents' builds
and browsers in every run — the times are directional at best; the
memory figures are the reliable ones. "After GC" is CDP
`HeapProfiler.collectGarbage` then `Runtime.getHeapUsage`
(`backingStorageSize`: the page's ArrayBuffers) — the like-for-like
retained figure against `main`, which has no `cpuMB`; the GC columns
exist from the second pair on. "Timer late" is a bare 1 s `setTimeout`
chain in the page: how late it fired at worst.

**A/B, mobile-emulated** (ff = first frame):

| run | first frame s | ready s | JS heap MB ff / ready | ArrayBuffers MB ff / ready (after GC) | peak ArrayBuffers MB | renderer RSS MB ff / ready (after GC) | peak renderer RSS MB | three's held MB ff / ready | cpuMB ff / ready (bvh) | long tasks to ready: n / total s / max s | timer late max s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| main lite 1 | 51 | 252 | 203 / 223 | 188 / 177 | 203 | 454 / 560 | 605 | 102 / 192 | – | 38 / 65 / 12.0 | – |
| branch lite 1 | 72 | 225 | 251 / 216 | 236 / 157 | 236 | 591 / 520 | 629 | 128 / 192 | 82 / 110 (19) | 42 / 68 / 13.6 | – |
| main lite 2 | 42 | 221 | 182 / 195 | 183 (189) / 157 (157) | 235 | 443 (454) / 539 (445) | 675 | 102 / 192 | – | 34 / 53 / 12.4 | 71 |
| branch lite 2 | 50 | 186 | 216 / 231 | 209 (139) / 157 (157) | 229 | 569 (411) / 499 (415) | 615 | 144 / 192 | 82 / 110 (19) | 30 / 38 / 6.1 | 70 |
| main site 1 | 189 | 759 | 511 / 534 | 494 / 475 | 544 | 838 / 875 | 1066 | 319 / 417 | – | 52 / 197 / 33.1 | – |
| branch site 1 | 155 | 601 | 597 / 541 | 504 / 421 | 504 | 941 / 779 | 941 | 350 / 416 | 234 / 266 (32) | 53 / 141 / 19.9 | – |
| main site 2 | 135 | 636 | 509 / 525 | 494 (493) / 466 (464) | 527 | 823 (812) / 873 (858) | 1082 | 312 / 417 | – | 46 / 165 / 29.2 | 206 |
| branch site 2 | 188 | 693 | 578 / 476 | 484 (484) / 421 (421) | 504 | 934 (826) / 775 (766) | 954 | 325 / 416 | 234 / 266 (32) | 52 / 207 / 32.0 | 181 |

A third branch lite run on the last build (with `boot:place` and its
neighbours timed): first frame 50 s, ready 193 s, ArrayBuffers after GC
at the first frame 176 MB.

**The branch's trace** (count · total s · max s). "Step-1 build" is this
branch before steps 3, 4 and 6 (workers, `cpuMB`, the lazy BVH and the
marks only) — the "before" of those three steps; `main` has no marks.

| category | step-1 build, lite | step-1 build, site | final, lite 1 | final, lite 2 | final, lite 3 | final, site 1 | final, site 2 |
|---|---|---|---|---|---|---|---|
| `boot:scene-compile` | – | – | – | – | 1 · 5.1 · 5.05 | – | – |
| `boot:place` | – | – | – | – | 1 · 7.2 · 7.24 | – | – |
| `boot:light-wait` | – | – | – | – | 1 · 0.5 · 0.49 | – | – |
| `boot:first-shadow-frame` | 1 · 0.0 · 0.00 | 1 · 0.0 · 0.01 | 1 · 0.0 · 0.00 | 1 · 0.0 · 0.00 | 1 · 0.0 · 0.01 | 1 · 0.1 · 0.12 | 1 · 0.0 · 0.01 |
| `boot:frame` | 41 · 7.6 · 4.61 | 47 · 34.6 · 12.47 | 38 · 7.5 · 3.66 | 35 · 4.0 · 3.79 | 41 · 7.0 · 4.09 | 41 · 30.0 · 11.89 | 43 · 52.9 · 26.49 |
| `boot:light-to-veil` | 1 · 7.3 · 7.31 | 1 · 0.7 · 0.73 | 1 · 0.7 · 0.70 | 1 · 34.6 · 34.61 | 1 · 8.8 · 8.83 | 1 · 7.4 · 7.37 | 1 · 24.9 · 24.88 |
| `boot:veil-to-loaded` | 1 · 99.5 · 99.55 | 1 · 494.9 · 494.85 | 1 · 149.8 · 149.82 | 1 · 98.0 · 97.97 | 1 · 130.5 · 130.49 | 1 · 439.0 · 439.03 | 1 · 480.1 · 480.06 |
| `tile:city` | 1 · 0.4 · 0.39 | 4 · 1.4 · 0.76 | 1 · 0.6 · 0.55 | 1 · 0.2 · 0.16 | 1 · 0.2 · 0.18 | 4 · 0.9 · 0.49 | 4 · 1.8 · 0.85 |
| `tile:bvh` | 1 · 4.9 · 4.86 | 2 · 9.2 · 5.05 | 1 · 9.1 · 9.14 | 1 · 5.4 · 5.42 | 1 · 7.2 · 7.23 | 2 · 15.2 · 8.30 | 2 · 21.9 · 16.57 |
| `tile:rasters` | 2 · 48.9 · 44.65 | 4 · 696.0 · 408.30 | 2 · 116.7 · 101.07 | 2 · 42.3 · 40.30 | 2 · 89.7 · 82.24 | 4 · 478.7 · 218.41 | 4 · 694.0 · 320.88 |
| `tile:compile` | 3 · 33.0 · 20.53 | 8 · 135.9 · 63.43 | 3 · 43.8 · 29.92 | 3 · 43.9 · 34.10 | 3 · 35.9 · 26.43 | 7 · 141.8 · 69.43 | 7 · 186.8 · 91.54 |
| `tile:handover-wait` | 1 · 14.0 · 13.97 | 1 · 231.8 · 231.82 | – | – | – | – | – |
| `dressing:queue-wait` | 2 · 69.1 · 37.49 | 4 · 190.8 · 103.23 | 2 · 50.4 · 49.56 | 2 · 134.5 · 72.73 | 2 · 45.2 · 44.55 | 3 · 215.8 · 112.32 | 3 · 268.3 · 137.62 |
| `dressing:build` | 2 · 37.4 · 27.30 | 4 · 148.2 · 64.93 | 2 · 52.7 · 36.41 | 2 · 22.3 · 18.87 | 2 · 45.3 · 31.49 | 3 · 153.8 · 84.25 | 3 · 206.9 · 104.56 |
| `dressing:compile` | 2 · 61.0 · 50.43 | 3 · 292.4 · 229.71 | 2 · 83.2 · 67.17 | 2 · 74.5 · 65.97 | 2 · 78.9 · 66.55 | 3 · 274.8 · 215.86 | 3 · 243.5 · 179.42 |
| `dressing:asks` | 1 · 0.3 · 0.30 | 1 · 0.2 · 0.19 | – | – | – | – | – |
| `longtask` | 31 · 37.7 · 10.06 | 43 · 133.6 · 25.80 | 36 · 61.7 · 13.59 | 27 · 33.4 · 6.08 | 30 · 49.9 · 13.84 | 50 · 138.8 · 19.86 | 49 · 205.3 · 31.96 |

**Decision.**

- **(b) dominates** on the emulated phone: in the step-1 full-site run
  `tile:handover-wait` + `dressing:queue-wait` = 232 + 191 s, 85 % of the
  495 s from the veil to "loaded" (the gate's 50 %). Step 4 (built) removes
  the wait on a phone: no `tile:handover-wait` since.
- **(a) holds by the letter** (`boot:light-to-veil` > 2 s in five of seven
  runs, up to 35 s) **but not by the plan's mechanism**: the first shadow
  frame costs ≤ 0.12 s and the honest light stage's wait 0.5 s. What holds
  the veil is its 600 ms timer firing late — next point.
- **Timers starve under this load — a finding the plan did not foresee.**
  A bare 1 s `setTimeout` fired up to 71 s late in the lite runs and up
  to 206 s in the full-site ones, on `main` as much as on the branch. The
  bounded waits are therefore nominal: the 3 s compile bound measured up
  to 230 s (`dressing:compile`), the 10 s hand-over bound 232 s, and step
  6's idle callbacks had not run by "loaded" in any branch run (no
  `dressing:asks` row; a question now builds a tile's pending sets at
  once, `asksOf`). In Chromium three's compile steps yield through the
  native `scheduler.yield`, whose continuations run ahead of timers, and
  with the main thread saturated (SwiftShader frames of 1–26 s) a timer
  waits behind them for minutes. Unmeasured on WebKit, where
  `main-yield.ts`'s message-channel shim is an ordinary task source.
  Whether a real phone's main thread ever saturates like this is step 2's
  open device row. Not fixed here (backlog).
- **Step 6's gate** held: `dressing:asks` 190–299 ms on this desktop-class
  CPU (gate: 8 ms) — built.
- **Step 7** was ungated by the crash reports (the page's process memory,
  not three's count) — built.

**What changed, in numbers.** *Memory* (what the iPhones die of): after a
GC the page keeps 139 / 176 MB of ArrayBuffers at the first frame on the
spawn tile against `main`'s 189, the same 157 MB at "ready"; over the
whole site 484 against 493 at the first frame and **421 against 464 MB at
"ready"**; the renderer process peaked at **941 / 954 MB against 1066 /
1082 MB** and held 766 against 858 MB after a GC at "ready"; three's GPU
count is the same (192 / 416 MB). The branch's own count (`cpuMB`): the
spawn tile keeps 82 MB at the first frame — its buildings' positions,
index and feature ids 48 MB, its BVH 19 MB — and the whole site 266 MB at
"ready", with **two BVHs (32 MB) for the four building tiles loaded**
(`main` builds one for each). The raw peaks of ArrayBuffers include
garbage not yet collected and move both ways in the lite runs. *Times*
(directional): the spawn tile's ready came 225 / 186 / 193 s against 252
/ 221 s; its **first frame 50–72 s against 42–51 s** — the spawn tile's
BVH now runs after its terrain has landed, on the boot's path
(`boot:place` 7.2 s of the 12.8 s from the terrain to 52 % in the third
run, all of it `tile:bvh`), where `main` ran it inside the city's parse
while the terrain still downloaded; the whole site's first frame and
ready moved both ways (155 / 188 against 189 / 135 s; 601 / 693 against
759 / 636 s); long tasks no clear change. The BVH's cost itself
(5–17 s here under four-fold contention) is far above the "≈75 ms a tile"
this plan assumed: re-measure on a device.

**E2E on the same machine, against the branch's build.** The default
local config (120 s per test) failed the four viewer groups' boots — each
still in *Details laden* when its 120 s ran out (slow, not hung: the
bench's lite boots took 186–252 s to "ready" on `main` and the branch
alike under this load); with CI's budgets (`CI=1`: `slow()` × 3, one
worker) and the per-test limit raised (`--timeout=900000`) **29 passed**
— the collision, demolish, double-tap, building and tree inquiry specs
among them — and the whole-site spec ran past its 810 s while still
streaming (five of six dressings built at 707 s), no page errors.

**Seen on a phone after this branch** (not by eye here — headless):
a fine terrain level that replaces the coarse one shows bare for a
moment, its trees, lamps and rails arriving once its dressing is built;
a tile's ask sets come in idle time or with the first question; the boot
reaches 52 % one shadow frame later and after the spawn tile's BVH.

### 2026-10-11 — the spawn tile's BVH in a worker (plan 043, re-tried)

The one BVH build step 7 left on the boot's path — the spawn tile's, in
`boot:place` — built in a worker on branch `claude/spawn-bvh-worker`
(the arrays lent once the tile's compile has uploaded them, after its
ground has landed, awaited before the placing: ADR 0032). Same setup as
above (POC builds of `main` 7cf7d2f and the branch, `devices['iPhone
13']`, headless Chromium over SwiftShader, `/dresden?scene=lite&trace=1`,
alternating, load 16–23 on four cores — directional):

| run | first frame s | ready s | `boot:place` s (waiting) | BVH build s | long tasks to first frame: n / total s / max s |
|---|---|---|---|---|---|
| branch 1 | 62.7 | 297.4 | 10.36 (10.36) | 10.37, worker | 54 / 59.0 / 7.27 |
| main 1 | 39.3 | 247.5 | 3.09 | 3.09, main thread | 54 / 33.3 / 5.36 |
| branch 2 | 71.9 | 270.0 | 4.15 (4.15) | 11.20, worker | 72 / 67.5 / 8.08 |
| main 2 | 52.6 | 268.0 | 3.46 | 3.46, main thread | 52 / 46.1 / 6.87 |

`boot:place` was shorter only where the scene's compile ran beside the
build (branch 2: 7.2 s of it); otherwise the lite boot has nothing left on
the main thread after its ground lands (`boot:scene-compile` 0.02–0.04 s),
and the build ran 3× slower in the worker beside the frames that keep
rendering on SwiftShader's CPU meanwhile. The worker also costs the first
load 20.8 KB gz (ADR 0040's chunk effect: three's core and three-mesh-bvh
left the scene's scope). Stopped there: plan 043's 2026-10-11 findings
have the numbers, the five options and the rest.
