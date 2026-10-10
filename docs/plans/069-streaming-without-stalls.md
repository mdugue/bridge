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
  Open: steps 1–4, 6, 7. Re-read the "Current state" excerpts against the
  code before starting (the drift check will flag `tile-stream.ts` and
  `create-app.ts`).

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

## Test plan

- `app/_components/stream-timing.test.ts` (new): aggregation, no tile id
  in the summary, no throw on a missing mark.
- `app/_components/tile-stream.test.ts`: `handOverWaitMs` per tier; (step
  6) asks built on idle.
- Pattern: the existing `paceStreaming` and `takesOver` tests in that file.
- `bun run test` → all pass; `bun run test:e2e` after `bun run build` → all pass.

## Done criteria

- [ ] `bun typecheck`, `bun lint`, `bun run test` exit 0
- [ ] `bun run build && bun run test:e2e` passes
- [ ] `grep -n "HAND_OVER_WAIT_MS" app/_components/tile-stream.ts` returns nothing; `handOverWaitMs` is exported and tested
- [ ] `grep -n "useWorkers" app/_components/tile-stream.ts` returns one line
- [ ] Step 2's measurement table (before) and a re-measurement (after) are in the PR and in this plan's Findings
- [ ] `grep -rn "trail" app/_components/stream-timing.ts` returns nothing (timings never reach the crash trail)
- [ ] `docs/rendering.md`'s boot sequence names the honest light stage and the per-tier hand-over wait; AGENTS.md lists `?trace=1`
- [ ] No files outside the in-scope list modified

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

(append step 2's table and decision here)
