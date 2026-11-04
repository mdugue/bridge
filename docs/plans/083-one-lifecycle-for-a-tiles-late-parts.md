# 083 — One lifecycle for a tile's late parts: the dressing, the murals and the traffic bodies through one module

**Status:** PARTIAL (2026-11-04) — 078 is built; steps 0 and 1 of this
plan are built, steps 2–6 open (the README row has what was measured and
what was not). Plan 076's steps 3–4 are already in the code (see
*Interplay*), so nothing waits on 076.

Planned 2026-11-04 from candidate K2 of an architecture review, against
`04d8fad3`. A refactor with a short list of named behaviour changes
(*Findings*, the drift column). The picture must not change.

> **Executor instructions.** Read the whole plan, AGENTS.md, ADRs 0024
> and 0047, the `city-walker` skill's *Tiles* section and the
> `codebase-design` skill. The words *module*, *interface*, *seam*,
> *adapter*, *depth*, *leverage* and *locality* are used as that skill
> defines them. Each step ships on its own, as its own commit
> (Conventional Commits: `test(stream): …` for step 0,
> `refactor(stream): …` for steps 1–5, `docs: …` for step 6), and leaves
> `bun run verify` green. Do them in order; stop after any step if the
> STOP conditions say so. When you stop, add or update this plan's row in
> `docs/plans/README.md` with what you built and what you did not.
>
> **Drift check (run first):**
>
> ```bash
> git log --oneline 04d8fad3..HEAD -- app/_components/tile-stream.ts \
>   app/_components/tile-stream.test.ts app/_components/mural-layer.ts \
>   app/_components/traffic-layer.ts app/_components/data-layers-feature.ts \
>   lib/city/task-gate.ts app/_components/compile-lanes.ts
> grep -n "catchUp\|night()\|season()" app/_components/tile-stream.ts
> ls app/_components/scene-environment.ts
> ```
>
> The grep must print nothing and the file must exist (plan 078 done).
> If 078 is not done, stop: this plan rewrites the code its step 4
> rewrites. Line numbers below are of `04d8fad3` and approximate (≈);
> find code by its name. After 078, `catchUp` and the hang's second
> catch-up are gone and `TrafficHost` has a `look` watch: the rows below
> marked *078* describe what 078 already removed.

## Context

A tile's content root lands in `DressingPlugin.processTileModel`
(`app/_components/tile-stream.ts`). Three things arrive on it **later**,
each built, compiled, weighed, hung and freed by a hand-written copy of
one guard sequence:

| Late part | Where | ≈ lines | Started by |
|---|---|---|---|
| A terrain level's **dressing** (trees, lamps, furniture, rails, bridges…) | `queueDressing` ≈ 2157, `hangDressing` ≈ 2339, `dropDressing` ≈ 2408, `weighDressing` ≈ 1452 | ≈ 260 | `dressTerrain`, when the level has dressing or coarse files |
| A city tile's **murals** (full LoD2 only) | `hangMurals` ≈ 1881 | ≈ 70 | `dressContent`, `void`ed, before the content's compile |
| A dressing's **traffic bodies** (a data layer) | `trafficSlot` ≈ 876, `TrafficHost`/`TrafficSlot` ≈ 209–254, the host literal in `hangDressing` ≈ 2355–2385 | ≈ 200 | `TrafficSlot.show()` once the dressing hangs and the layer is on |

All three rest on the same plugin internals: `compileUnder` ≈ 2443
(counted on the root so its `release` waits; never rejects),
`withinCompileWait` (`COMPILE_WAIT_MS` 3 s), the lane `turn` ≈ 2054
(`createTaskGate(1, MAX_DRESSING_OVERTAKES)` after `dressingGate`, ranks
`COARSE_DRESSING_RANK`/`FINE_DRESSING_RANK`), `loaded` (settles when the
renderer has recorded the content), `released`/`disposed`, `reweigh`,
`compileFailed`/`disposeFailed`, `ctx.onAllocationFailure`/
`onDressingFailed`.

The proposal under review was one module
`attach(host, { build(signal), parts, dispose }, rank)` with three
adapters. This plan keeps the idea and reshapes the interface: as
proposed it has no place for the two hang policies, the part's weight,
the tile leaving before its release, or the traffic's owner (*The
interface*, Design A).

## Findings (verified against `04d8fad3`)

### 1. The three sequences side by side

Verdicts: **deliberate** (keep; the reason given), **drift** (accidental,
harmless or a waste), **latent bug** (wrong in a case the tests do not
reach). "078" marks rows plan 078 removes.

| # | Step | Dressing | Murals | Traffic | Verdict |
|---|---|---|---|---|---|
| 1 | Wait before the turn | `dressingGate` (in `turn`) | `source.forTile(tile)` (the site's mural file) | `builderNow()`: the data layers' feature, **outside** the lane ("must not hold the dressings' chain") | deliberate: each part's own input; stays in the adapter |
| 2 | Turn | the lane, rank coarse 0 / fine 1 (`4eafaf42`), then `await olderCompile` (`a36e7c32`, `e66aaa47`) | **none** | the lane at `FINE_DRESSING_RANK` always, coarse slots too (`4eafaf42` hard-coded it); no `olderCompile` | murals: deliberate (fetch and decode, no long main-thread task; two murals in Dresden, none elsewhere). Traffic's fixed rank: **drift, not intended** (maintainer, 2026-11-04): a coarse level's bodies take the coarse rank (step 4, D10) |
| 3 | Gone before the build | `!entry ‖ disposed ‖ released.has(scene)` (`71d1fa29`) | `dressed.get(scene) !== entry` only | `gone(h)`: slot disposed ‖ plugin disposed ‖ released ‖ `entry.dressing !== dressing` | **drift → waste** (D1): murals miss `released`. A city tile that leaves while its own content compile runs keeps its entry (`release` waits on `compiles`), so its murals are fetched, decoded and built, then thrown away. `71d1fa29` fixed exactly this for the dressing only |
| 4 | Abort | a fresh `entry.aborter` per build | `entry.aborter ??= aborter` (shares the dressing's slot; city entries have no dressing) | none (the build is synchronous) | **drift → waste** (D2), dressing and murals alike: the aborter fires in `releaseDressed`, i.e. only once the root's compiles have ended. A tile that leaves while its content compiles keeps building until then |
| 5 | Build | `buildDressing(terrain, extras, ctx, url, signal)`, hard-wired | `buildMurals(murals, {fileUrl, offset, phone, signal})` | `builder.build(…)` + `builder.askSet(…)` | part-specific: the adapter's `build` |
| 6 | Prepare before the compile | `catchUp` in try/catch, freed and rethrown (`93300353`) | — | — | 078 (becomes `followEnvironment` at birth) |
| 7 | Gone after the build | `current = dressed.get(scene) === entry && !released`: no compile, no weight (`a3348a56`) | `gone()` → `dispose()` | (synchronous build: cannot change) | consistent |
| 8 | Hung before the compile | no | no | **yes**: `h.root.add(group)`, hidden, before its compile (`4adff283`) | drift, harmless (D3): a compile starts at the drawable, where it hangs does not change it (the dressing's own comment). Nothing reads `slot.group` before the bodies are asked (`create-app.ts` ≈ 2445 reads it for an asked section) |
| 9 | Compile | `compileUnder(scene, compileRepresentatives(parts), "dressing t")` | `compileUnder(scene, [group], "murals t")` | `compileUnder(scene, compileRepresentatives([group]), "traffic t")` | drift, harmless (D4): murals compile every mesh (each has its own textures, so the representatives would be all of them anyway) |
| 10 | Weighed while it waits | **from the build** (`80e8212b`, `3db636a4`) | only once hung (`entry.murals`) | only at `built()`, after its compile has ended | **latent bug** (D5, ADR 0047's class): between build and hang the tile cache does not count the murals' drawings (2.7 MB on Dresden's tile, 2.0 MB on a phone, `docs/rendering.md`) nor the traffic bodies hung hidden on the root. `80e8212b`'s reason ("a built dressing waiting its turn to hang must count against the cache's budget") holds for both; neither copy got it |
| 11 | Compile wait | `withinCompileWait` **after** the lane (`e01997c8`), then hang | `await compiled`, unbounded | `withinCompileWait` **inside** the turn, then `await compiled` before showing | two deliberate policies, see 12. Traffic holding the lane through its wait (D6): `e01997c8` moved the dressing's wait out of the lane and did not touch the slot — drift by origin, but **kept on evidence** (finding 4): a traffic compile is one large upload, the hold lasts as long as that upload (not 3 s unless it is slow), and letting the next body build beside it would put a second 20 MiB body in flight on a phone |
| 12 | Hang policy | **at the wait**: hangs after ≤ 3 s even if its compile runs on; comes down again if that compile then runs out of memory (`17ca6cce`, `dropAfterCompile` → `dropDressing`) | at the compile's end | at the compile's end | deliberate: a level that hands over keeps one of the renderer's parse slots waiting on the dressing (`handsOver`, `8227605c`); nothing waits on murals or traffic |
| 13 | Ready signal | `built()` after the wait, **before** `await loaded` | — | — | deliberate and load-bearing: `processTileModel` awaits it (`waitHandOver`) and `loaded` settles only after `processTileModel` returns; awaiting `loaded` first would deadlock until `handOverWaitMs` |
| 14 | Wait for `loaded` | yes | yes | implicit: `attach` runs in `hangDressing`, after `loaded` | consistent; the module always awaits it (settled already for traffic) |
| 15 | Gone or out of memory after the wait | unweigh, free once the compile ends | `dispose()` (compile ended) | gone: return (the release frees); out of memory: `slot.dispose()`, the layer stays off on this tile | consistent |
| 16 | Hang | `scene.add(parts)`, `entry.dressing`, `stream.dressings`, `buildAsksWhenIdle`, `traffic.attach`, second `catchUp` in try/finally around the weigh (`346f873e`) | `scene.add`, `entry.murals`, `city.hang(mesh, building)` per mural | `group.visible = wanted`, `src.asks.push(set)`, `ready` | part-specific: the adapter's `hang`. The second catch-up is 078 |
| 17 | Weigh at the hang | `weighDressing` + `reweigh` | `recalculateBytesUsed(tile)` only if `tileOf` knows the tile (no whole-cache fallback) | `built()`: `weighDressing` (the whole dressing, traffic in it) + `reweigh` (`a3348a56` normalised it) | drift, harmless (D7): murals came on 2026-11-01, `a3348a56` on 11-03 normalised traffic only |
| 18 | `onChange` | in `finishDressing`'s `finally`, always (the frontier, `settled`) | on the hang only | on `built()` | deliberate for the dressing (ready and the loading frontier count it); the module calls `changed` on hang and drop |
| 19 | Failure | abort / disposed / released: silent; allocation → `onAllocationFailure("dressing t")`; else `onDressingFailed` | abort / gone: silent; **everything else** → `onDressingFailed` | gone: silent; allocation → `onAllocationFailure("traffic t")`; else `onDressingFailed` | **drift, narrow** (D8, finding 5): the decode itself never reports (`decodeImage` swallows every throw: the mural is left out), and a mural *compile* that runs out already reaches `onAllocationFailure("murals t")` through `compileUnder`. Only a throw between the two — `redOf`'s ≈ 0.9 MiB `Uint8Array`, the `DataTexture` — is shown as a layer's hole instead of an allocation failure |
| 20 | Free while its compile runs | held by `compiles`, freed in the gone path after `await compiled` | held by `compiles`, freed by `hangMurals` after the compile | `slot.dispose()` takes it down now, frees after via `host.freeFailed` (`5876b641`) | consistent rule, three mechanisms |
| 21 | Rejections | `finishDressing` catches all | `void this.hangMurals(…)`: a throw after the build (e.g. in `city.hang`) is an **unhandled rejection** | `buildGuarded` catches all | drift (D9), minor |
| 22 | Tests | three, through private members (`queueDressing` ×2, `compileUnder`, `hangDressing`) and a `tilesetUrl` getter that throws (the earliest throw a test can inject: `buildDressing` is hard-wired) | **none** (`buildMurals` needs `createImageBitmap`, imported directly) | ten, through an exported fake `TrafficHost` | the dressing is tested past its interface; the murals not at all |

### 2. The `fix(load)` commits

`git log --grep='^fix(load)'`: 13 commits (2026-11-02 to 11-03). Eleven
change `tile-stream.ts`; **none** changes `tile-stream.test.ts` (three
change `lib/city/load-frontier.test.ts`). The review's "9 of 13 changed
the sequence" overstates it: **6** change the late-part sequence, all of
them in the dressing's copy.

| Commit | What | Copy | Murals | Traffic |
|---|---|---|---|---|
| `80e8212b` | weigh a dressing from its build while it waits | dressing | not carried (D5) | not carried (D5) |
| `3db636a4` | weigh per tile (`reweigh`), after the compile is set up | dressing | not carried (D7) | carried by `a3348a56` |
| `93300353` | free a dressing whose catch-up throws | dressing | n/a | n/a — 078 |
| `346f873e` | weigh a hung dressing even if its catch-up throws | dressing | n/a | n/a — 078 |
| `a3348a56` | no compile or weight for a dressing whose tile left | dressing (+ traffic's `built` to `reweigh`) | had it (`gone()`) | had it (`gone(h)`) |
| `71d1fa29` | no build for a dressing whose tile left before its turn | dressing | **not carried** (D1) | had it |
| `90a0cef4`, `68828991`, `e7497f2b` | the loading frontier (`pendingTilesInView`) | — | — | — |
| `26aa89cb`, `dab67272` | `calculateBytesUsed`'s scene lookup (and back) | shared | — | — |
| `2cfe1da4`, `e1578ff0` | `lib/city/load-frontier.ts` | — | — | — |

Two of the six fix the catch-up 078 deletes. The other four are the
weight and the gone checks — the two things a single module would own.

### 3. The tests today (`app/_components/tile-stream.test.ts`)

23 `as unknown as`: **3** reach private members (≈ 356 `queueDressing`,
≈ 417 `compileUnder` + `queueDressing`, ≈ 673 `hangDressing`); **9** fake
the 35-member `TileStreamContext`; **11** fake layers (`TerrainLayer`,
`CityLayer`, `VegetationControl`, `LampControl`, `TileDressing`,
`AskSet`). Only the first three are this plan's; the context fakes are
plan 074 part C's (the context's width).

The traffic tests (≈ 794–1023) drive `trafficSlot` through a fake
`TrafficHost` and pin, among others, that "the first tile's turn holds
the chain while its compile runs" (≈ 910): D6, which this plan keeps
(finding 4).

### 4. Should the traffic bodies overlap the lane like the dressings? No.

What the lane's rules guard against, from their commits:

- `e01997c8` (2026-11-02): the lane held each dressing through its
  compile wait (up to 3 s) and its hang; holding the build only took veil
  to loaded from 289 s to 229 s (headless, full profile). The gain is
  throughput on the boot and the hand-over, where dozens of dressings
  queue and each compile builds new programs.
- `e66aaa47`: unbounded overlap let built dressings and the compile queue
  pile up behind a slow GPU — built dressings were then unweighed, and a
  queue past the wait hung them before their compile. A build now waited
  out the last compile.
- `a36e7c32`: that put the lane back to idling (288 s); a build waits
  out the compile *before* the last one: at most one compile wait ahead
  of a build.

The traffic bodies, measured on `04d8fad3` (`buildTraffic` over four of
Dresden's tiles in bun, `estimateGeometryBytes`; desktop CPU):

| Tile | fine | build | coarse | build |
|---|---|---|---|---|
| 33412_5656 (24.8 km counted) | 22.0 MiB | 1.2 s | 3.3 MiB | 0.17 s |
| 33414_5654 (24.5 km) | 22.3 MiB | 0.44 s | 3.4 MiB | 0.06 s |
| 33410_5654 (23.5 km) | 20.3 MiB | 0.50 s | 3.1 MiB | 0.08 s |
| 33416_5656 (14.2 km) | 12.8 MiB | 0.19 s | 2.0 MiB | 0.03 s |

One mesh per body, one scene-wide material (`traffic-glass`): after the
first tile the program exists, and a body's compile is the upload of its
buffers. `withinCompileWait` ends when the compile does, so the hold
costs a tile its upload time, not 3 s, except on a GPU that is already
behind. The build is the long part (unsliced, a whole long task), and it
is in the lane either way.

The cost of overlapping: the one-ahead bound counts parts, not bytes. On
a phone a fine body is ≈ 20 MiB against a tile cache of 285 MiB at level
0 (196 at level 3, `docs/rendering.md`): building the next one while the
last still uploads puts ≈ 7–10 % of the cache in flight a second time,
on top of the dressing lane's own one ahead. Weighing from the build
(D5) only lets the cache evict tiles it does not draw; with the view's
tiles in use the cache runs over (`docs/rendering.md`: "the cache can
run a tile over `max` before it unloads"). ADR 0047 does not allow that
for a small gain. The switch-on timing also argues for the hold: a
switch-on queues every loaded tile's bodies at once, both levels, behind
or between the dressings; with the hold, the dressings landing meanwhile
wait one body's upload at most, not a pile of built bodies.

**Decision: no overlap for the traffic.** No part field is needed: the
lane derives it from `hangAt`. A `"wait"` part (the dressing: something
waits on it) frees the lane after its build; a `"compile"` part in the
lane (the traffic: nothing waits on it) holds it through its compile
wait. **Gate to revisit** (step 4, Verification): on a desktop, a
switch-on with the spawn view loaded — the time from `trafficLayer: true`
to the last body shown, and the `dressing:queue-wait` maximum meanwhile.
If the hold costs more than 1 s over the switch-on on the desktop and the
phone-emulated peak of `renderer.info.memory.total` does not grow with
overlap, open a follow-up to let `"compile"` parts overlap on the desktop
tier only.

### 5. Should a mural that runs out of memory be a memory emergency? Yes, narrowly.

What the emergency does (`create-app.ts` ≈ 3526 `memoryEmergency` →
`lib/city/page-lifecycle.ts` `allocationFailed`): at most once per
`emergencyGapMs`, it notes it on the trail, forces the memory governor to
its last step (`lib/city/memory-governor.ts`: screen-space error × 8, the
cache's floor × ⅛), sheds every tile not in use (`shedUnusedTiles`),
holds the shadow camera's streaming, and — once per page, if visible and
not just resumed — raises the device's safety level, which persists and
falls by one every three days (ADR 0047). It drops no tile in use, so it
does not drop the city for one texture, but it does lower the page's
detail and, once, the next visits'. It must fire only on a real failure
to allocate.

The murals today: two in Dresden, none elsewhere; drawings of
3840 × 237 (lines, one channel) + 1223 × 75 (wash) for the Fürstenzug and
1280 × 448 + 360 × 126 for the other, 2.7 MB with mipmaps on their tile
(2.0 MB on a phone, 32 px a metre). Where they can fail:

| Where | Today | After step 3 |
|---|---|---|
| fetch or decode (`decodeImage`: `createImageBitmap`, `getImageData`) | every throw swallowed: the mural is left out, silently | unchanged: an oversized or undecodable drawing still only leaves its mural out |
| `redOf` (≈ 0.9 MiB) or `new DataTexture` | `onDressingFailed`: a layer's hole in the HUD | `isAllocationFailure` → `onAllocationFailure("murals t")` → emergency; anything else stays `failed` |
| the compile (the upload) | `compileUnder` → `onAllocationFailure("murals t")` → emergency, **already** | unchanged |

So the emergency already fires for the murals' largest allocation (the
GPU upload), as for the dressing's and the traffic's. The one path that
does not is an ArrayBuffer of under a megabyte failing, which happens
only when the page's process is truly out — the case the emergency is
for; `isAllocationFailure` needs an out-of-room message or a GPU call in
the stack, so a bug in the mural code is not taken for one. **Decision:
classify it like the other parts (step 3); keep the decode's swallow.**

### Interplay

- **Plan 078** (TODO). Its step 4 deletes `catchUp` (both calls), puts
  `followEnvironment(d, env)` where the first catch-up is (before the
  compile, so it stays keyed to the season's crown material), stores the
  unsubscribe on the dressing for `disposeDressing`, gives `TrafficHost`
  a `look` watch that `attach` follows, and rewrites the traffic and
  catch-up tests. That is the same code this plan rewrites. Before 078
  the module would need a *prepare before compile* hook and an *after
  hang* hook that exist only for the catch-up, and 078's step 4 would be
  re-planned against it. After 078 both hooks vanish:
  `followEnvironment` runs inside the dressing adapter's `build`, its
  unsubscribe inside `free`; the traffic's look follow moves into the
  slot's `attach`. **K2 waits for 078.** Step 0 of this plan reuses 078's
  step-0 script and baselines.
- **Plan 076** has all four steps in the code: step 1 `c6758a3d` and
  before (`lib/city/stream-order.ts`), step 2 `aefc090b`
  (`ground-plate.ts`, `scripts/prepare/plate.ts`), step 3 `a08c6813`
  (`city_<t>_far`, `FAR_CITY_ERROR` 4), step 4 `4eafaf42`
  (`COARSE_DRESSING_RANK`, `standInCrowns`), all 2026-10-25. Only its
  status lines are stale (the README row and the plan's header). What 076
  put into `DressingPlugin` is this plan's baseline: the rank by level,
  the overtakes cap, `standInCrowns` reading `entry.dressing` (the
  dressing adapter keeps setting it). Murals on the full LoD2 only
  (`geometricError === 0`) came with the murals (`bfab0b6f`) on top of
  076's far level.
- **Plan 077** (TODO) rewrites `calculateBytesUsed`'s raster term and
  `releaseDressed`'s sky view. This plan rewrites the dressing and murals
  terms of the same two methods. Independent; whichever lands second
  rebases.

### Constraints the design must keep

- **Free only after the compile.** three cannot stop a compile; one that
  resumes on freed buffers uploads them again (`compiles`' comment). Any
  free of a part waits for that part's compile.
- **The hand-over never waits on `loaded`** (row 13).
- **Nothing scene-wide hangs before `loaded`** (`loaded`'s comment: the
  renderer would dispose scene-wide materials with the tile).
- **One build at a time in the lane, lower rank first, at most four
  overtakes, a build overlaps at most one compile wait** (`a36e7c32`).
- **A shared buffer is detached before a release** (`detachSceneShared`
  stays at the head of `release`).
- **The stream timings keep their names** (`dressing:queue-wait`,
  `dressing:build`, `dressing:compile`; plan 069, `?trace=1`).
- **Phone memory** (ADR 0047): no new buffer, no new CPU copy; a part's
  bytes reach `calculateBytesUsed` from its build.
- **No test-only seam** (`test-audit` skill): what a test injects is what
  production passes too.

## The interface

Both designs below were written against the same constraints. The
`codebase-design` skill's *Design it twice* asks for parallel sub-agents;
this review had none and wrote them in one pass. Redo that step with
sub-agents if the executor's tool set allows and the spike in step 1
finds the chosen shape wanting.

### Design A — a function per part (the proposal, made complete)

```ts
function attachLate<T>(host: LateHost, part: LatePart<T>): LateHandle;
// host per call: lane, compile, loaded, gone(), weigh(bytes | undefined),
//   leaving (a promise), reweigh, report
```

To be correct for all three parts the host must hand each call a weight
slot, a gone predicate and a leave signal. The plugin then keeps three
of each (`dressingBytes`, `murals.bytes`, the traffic folded into the
dressing's bytes; three `gone` closures; `entry.aborter`) — exactly the
weight and gone logic where four of the six fixes landed. **Depth:**
moderate; the sequence is in one place, its state is not. **Locality:**
ordering fixes land once, weight and release fixes still land in the
plugin. **Seam:** at the part (three adapters) and at the host (the
plugin, a fake). **Testability:** good for the order, poor for "the tile
weighs what its parts weigh" and "a release frees every part".

### Design B — a per-root registry the host owns (recommended)

```ts
// app/_components/late-parts.ts

/** How one late part comes to hang on its tile. */
export interface LatePart<T> {
  /** "dressing", "murals", "traffic": the trail's `where` and the timings' names */
  kind: string;
  tile: string;
  /** its place in the site's lane (lower first); null: built outside it */
  rank: number | null;
  /** "wait": hangs once its compile wait is over and comes down again if
   *  that compile then runs out of memory (a level's hand-over waits on
   *  it); "compile": hangs once its compile has ended */
  hangAt: "wait" | "compile";
  /** builds it, or null: nothing to hang. Aborted when the tile leaves;
   *  frees what it made before it rethrows */
  build: (signal: AbortSignal) => Promise<T | null>;
  /** what is compiled before it hangs */
  objects: (built: T) => Object3D[];
  /** what the tile cache weighs it by, from its build on */
  bytes: (built: T) => number;
  /** hangs it (once, after the content is recorded) */
  hang: (built: T, self: LateHandle) => void;
  /** frees it, hung or not, taking it down first; returns what threw */
  free: (built: T) => unknown[];
}

export type LateOutcome = "hung" | "nothing" | "gone" | "out of memory" | "failed";

export interface LateHandle {
  /** built and its compile wait over, or given up; settles without
   *  waiting for the content to be recorded (the hand-over awaits it) */
  ready: Promise<void>;
  /** how it ended; never rejects */
  settled: Promise<LateOutcome>;
  /** takes it down now and frees it, now or once its compile ends; a
   *  build still running ends without hanging. Returns what threw now */
  dispose: () => unknown[];
}

/** The parts of one content root. */
export interface LateParts {
  /** starts a part; `owner`: it goes when that part goes (the traffic
   *  with its dressing) */
  add: <T>(part: LatePart<T>, owner?: LateHandle) => LateHandle;
  /** what its parts weigh, from their build until freed or given up */
  bytes: () => number;
  /** the tile left (`disposeTile`): builds abort, `ready`s settle,
   *  nothing new builds or hangs — even while the root's release waits */
  leave: () => void;
  /** frees every part, now or once its compile ends (the root's
   *  `releaseDressed`); returns what threw now */
  release: () => unknown[];
}

/** The site's lane: after the gate, one build at a time, lower rank
 *  first (at most MAX_DRESSING_OVERTAKES overtakes), a build waiting
 *  out the compile wait before the last one; a "wait" part frees it
 *  after its build, a "compile" part after its compile wait. Opaque. */
export interface LateLane {}
export function createLateLane(gate: Promise<void>): LateLane;

/** What the plugin gives one root's parts. */
export interface LateHost {
  lane: LateLane;
  /** compiles, counted on the root (its release waits); never rejects */
  compile: (objects: Object3D[], where: string) => Promise<Compiled>;
  /** settles once the renderer has recorded the content */
  loaded: Promise<void>;
  /** the stream has gone */
  disposed: () => boolean;
  reweigh: () => void;
  changed: () => void;
  /** a build or hang that threw: classified by the module
   *  (`isAllocationFailure`) — an allocation failure, or a failure */
  allocationFailure: (error: unknown, where: string) => void;
  failed: (error: unknown, tile: string) => void;
  /** what a free after a compile threw */
  freeFailed: (errors: unknown[]) => void;
}

export function createLateParts(host: LateHost): LateParts;
```

**What it hides:** the order (turn → gone → build → gone → compile →
weigh → wait → ready → `loaded` → gone/out of memory → hang → drop on a
late out of memory), every gone check (the root left, the stream went,
the part or its owner disposed), the abort, the one-ahead compile
throttle, the bounded wait, the weight from build to free, the three
free-after-compile mechanisms (one), the failure classification, the
timings. **Interface:** four members on `LateParts`, nine fields on a
part, two of them policy (`rank`, `hangAt`).

**Usage (after 078):**

```ts
// dressTerrain
const entry = { terrain, late: createLateParts(this.hostOf(scene)), … };
const handle = entry.late.add(dressingPart({
  tile, rank, entry, stream: this.stream,
  build: async (signal) => {
    const d = await buildDressing(terrain, extras, this.ctx, this.url, signal);
    d.unfollow = followEnvironment(d, this.ctx.environment);   // 078
    return d;
  },
}));
return { dressed: handle.ready };          // the hand-over waits on this
// dressContent, a city on its full LoD2
entry.late.add(muralsPart({ source, city: entry.city, scene, ctx: this.ctx }));
// TrafficSlot.attach({ parts: entry.late, owner: handle, rank, look })
// show(): builder first (outside the lane), then parts.add(trafficPart(…), owner)
// disposeTile: entry.late.leave();  releaseDressed: errors.push(...entry.late.release())
// calculateBytesUsed: rasters + entry.late.bytes() − shared
```

`dressingPart`, `muralsPart` and `trafficPart` are exported factories
(the part seam's three adapters). The plugin passes the build closure,
so `buildDressing` stops being hard-wired without a test-only parameter.

### Comparison

- **Depth.** B hides the weight and the release behind `bytes()` and
  `release()`; A leaves them to every caller. Same part interface.
- **Locality.** Of the six sequence fixes, four were weight or gone
  checks: in B each lands in `late-parts.ts`; in A two of the four would
  still land in the plugin. `Dressed` loses `dressingBytes`, `murals`
  and `aborter` in B.
- **Seam.** Both: at the part (three adapters: a real seam) and at the
  host (the plugin and the tests' fake: a real seam). B adds the root as
  the owner of its parts, which is where 3DTilesRenderer's lifecycle
  already hangs everything (ADR 0024).
- **Testability.** B: a fake host (controllable `compile`, `loaded`,
  a real lane over a resolved gate, recorders) and fake parts test every
  row of finding 1 without a renderer, a tileset or a private member.
- **Rejected:** a private generic method on `DressingPlugin` (fixes the
  drift, keeps the tests past the interface); a generator of commands
  the host interprets (pure, but a second language for one sequence);
  the proposal's `{ build, parts, dispose }` without `hangAt` (either the
  murals and traffic hang before their compile ends, or the dressing
  loses its hand-over) and without `bytes` (D5 stays).

**Recommendation: B.**

## Steps

### Step 0 — Pin today's behaviour (tests only)

On the drift-checked HEAD (078 done), before any refactor:

1. **Baselines** (scratchpad, not committed): plan 078's step-0 script
   on the lite boot and the phone-emulated boot (`framedBuilds`,
   `gpuBytes`, `memory`, `getGpuDebug().anchors`), extended by: switch
   the traffic layer on (`__poc.look.set({ trafficLayer: true })`), 60
   frames, record again; off, 10 frames, record. And three headless runs
   of the full-profile Dresden start with `?trace=1`: veil-to-loaded and
   the `dressing:*` timings (`a36e7c32`'s method). And the traffic
   switch-on with the spawn view loaded (finding 4's gate): the time
   from `trafficLayer: true` to the last body shown, the spawn tile's
   fine bodies' time, the `dressing:queue-wait` maximum meanwhile, and
   on the phone-emulated boot the peak `renderer.info.memory.total` over
   the switch-on (sampled each frame).
2. **Traffic** (`tile-stream.test.ts`, the existing fake `TrafficHost`):
   add pins for (a) `built()` not called until the compile ends —
   *changes in step 4 (D5)*; (b) the bodies hung hidden on `root` while
   compiling — *changes in step 4 (D3)*; (c) a compile that resolves
   "out of memory": nothing shown, asked or built, a later `show()`
   builds nothing; (d) a build that throws: `failed` once; while gone:
   silent. Mark the existing "one after another" test's
   held-through-the-compile assertion as kept (finding 4); add a pin
   that a coarse slot's turn is taken at the fine rank today — *changes
   in step 4 (D10)*.
3. **Dressing** (private reaches allowed in this step only, each with a
   `// reason:` naming step 5): (a) a tile released before its turn
   never starts its build — a counting `tilesetUrl` getter (today's
   first read in `buildDressing`) reads zero; (b) `hangDressing` with a
   hand-made dressing (a `furniture` group with a box mesh, as ≈ 673)
   weighs it: `calculateBytesUsed(tile, scene)` equals
   `estimateGeometryBytes` of its parts; (c) `dropDressing` after it:
   weight 0, `stream.dressings` empty, the box's geometry disposed.
   The existing three dressing tests stay.
4. **Murals**: no unit pin is possible today (finding 1, row 22). Record
   instead, in the baselines: on the lite boot, the tile of the
   Fürstenzug (`data/dresden/murals/murals.json`) in view, the scene's meshes named
   under a `murals` group and that tile's
   `calculateBytesUsed` share (through `__poc.handle.getGpuDebug()` or
   the census, whichever shows it; if neither does, a real-GPU plate of
   the wall, oblique).
5. `bun run verify`. Commit: `test(stream): pin how a tile's late parts
   hang today`.

### Step 1 — The module, through its interface only

1. Spike first (≤ 1 h, not committed): write `LatePart`, `LateParts`
   and `createLateParts` for the dressing alone and check that the
   adapter needs nothing beyond the nine fields. If a third policy
   field is needed, stop and re-run *Design it twice* for the part
   interface before building.
2. `app/_components/late-parts.ts`: the interface above.
   `createLateLane` takes over the task gate (`createTaskGate(1,
   MAX_DRESSING_OVERTAKES)`), the gate and the `lastCompile`/
   `olderCompile` pair; `COMPILE_WAIT_MS`, `withinWait` and
   `withinCompileWait` move here (`tile-stream.ts` re-exports nothing
   it no longer uses). Timings: `${kind}:queue-wait`, `${kind}:build`,
   `${kind}:compile` through `streamTimings`. Head comment: what a late
   part is, the two hang policies, the free-after-compile rule.
3. `app/_components/late-parts.test.ts` — a fake host (a controllable
   `compile`, a controllable `loaded`, a real lane over a resolved
   gate, recorders) and fake parts (a `Group` with one box mesh, its
   geometry's `dispose` event counted). One test per rule:
   1. the order: build → compile → `ready` → hang, and `hang` never
      before `loaded`; `ready` settles while `loaded` is still pending
      (row 13);
   2. left before its turn (`leave()`): `build` never called; `ready`
      settles; outcome "gone";
   3. left during the build: the signal aborts; an abort is silent;
      what the build returns after all is freed, never compiled, never
      weighed;
   4. weighed from the build (`bytes()` > 0 before the hang), 0 after a
      give-up; `reweigh` called on each change;
   5. "compile" policy: out of memory → never hung, freed, reported
      once as an allocation failure by the host's compile (not again);
   6. "wait" policy: the compile outlasts the wait → hung → resolves
      out of memory → taken down, freed, weight withdrawn, `changed`;
   7. `release()` or `dispose()` while a compile runs: taken down now,
      freed only after the compile ends, once; what the free threw
      reaches `freeFailed`;
   8. a build that throws: an allocation failure (a
      `RangeError("Array buffer allocation failed")`) →
      `allocationFailure("<kind> <tile>")`; another →
      `failed(error, tile)`; after `leave()` → neither;
   9. the lane: rank 0 overtakes rank 1 (at most the cap); a third
      build waits for the first's compile wait, not the second's
      (`a36e7c32`); a `"wait"` part frees the lane after its build, a
      `"compile"` part holds it through its compile wait (finding 4);
      rank null runs outside it;
   10. an owner: a part added with an owner is gone when the owner is
       disposed or given up, and is freed with it;
   11. `bytes()` sums every live part; `release()` frees every one and
       leaves `bytes()` at 0.
4. `bun run verify`. Commit: `refactor(stream): one lifecycle for a
   tile's late parts`.

### Step 2 — The dressing through it

1. `dressingPart(…)`: `kind: "dressing"`, `rank` by level, `hangAt:
   "wait"`, `objects` = `compileRepresentatives(dressingParts(d))`,
   `bytes` = today's `weighDressing` sum, `hang` = today's
   `hangDressing` body (it still calls `traffic.attach` with today's
   `TrafficHost` until step 4), `free` = take it off `entry.dressing`
   and `stream.dressings` if hung, then `disposeDressing`.
2. `Dressed` gains `late: LateParts` (made in `dressTerrain` and
   `dressCity`); `dressingBytes` and `weighDressing` go;
   `calculateBytesUsed` reads `entry.late.bytes()`. `queueDressing`
   keeps only the frontier's bookkeeping (`pending`, `pendingScenes`,
   `builtOf`, `settled`, `onChange` in a `finally` over
   `handle.settled`) and returns `handle.ready`. `hangDressing`,
   `dropDressing`, the lane fields and `turn` go.
   `disposeTile` calls `entry.late.leave()`; `releaseDressed` pushes
   `entry.late.release()`'s errors.
3. Behaviour change (D2): a tile that leaves while its content compiles
   aborts its dressing's build at once, not when the compile ends. Say
   so in the commit body.
4. The three dressing tests and step 0's dressing pins move onto the
   adapter and the module (`dressingPart` with a fake build, a fake
   host); delete the private reaches they used.
5. `bun run verify`, the step-0 baselines (Verification). Commit:
   `refactor(stream): the dressing hangs through the late parts`.

### Step 3 — The murals through it

1. `muralsPart(…)`: `kind: "murals"`, `rank: null`, `hangAt:
   "compile"`, `build` = `forTile` then `buildMurals` (null when none),
   `bytes` = `layer.bytes`, `hang` = `scene.add` + `city.hang` per mesh,
   `free` = `layer.dispose()` after `removeFromParent`.
2. `hangMurals`, `Dressed.murals` and `Dressed.aborter` go;
   `calculateBytesUsed` loses its murals term (in `late.bytes()` now).
3. Behaviour changes, each in the commit body: D1 (no build for a tile
   that left), D2 (abort at once), D5 (weighed from the build), D7
   (`reweigh`), D8 (an allocation failure reported as one), D9 (no
   unhandled rejection), D4 (representatives).
4. Tests: `muralsPart` with a fake `MuralLayer` (a group, two meshes,
   `bytes`) and a fake city (`hang` recorded): hung per building, bytes
   on the tile, freed on release. The module's tests already cover the
   rest; do not repeat them.
5. Commit: `refactor(stream): the murals hang through the late parts`.

### Step 4 — The traffic bodies through it

1. `TrafficHost` goes. `TrafficSlot.attach({ parts, owner, rank,
   look })` (`look` from 078). `show()` waits for the builder outside
   the lane as today (`builderNow`), then `parts.add(trafficPart(…),
   owner)` once; `hide()` as today; `dispose()` disposes the handle.
   `trafficPart`: `kind: "traffic"`, `rank` by the slot's level
   (`src.detail`: `"coarse"` → `COARSE_DRESSING_RANK`, `"fine"` →
   `FINE_DRESSING_RANK`; D10, decided 2026-11-04), `hangAt: "compile"`,
   `build` = `builder.build` + `askSet`, `bytes` = `estimateGeometryBytes(group)`, `hang` =
   `scene.add(group)`, `group.visible = wanted`, the ask set pushed,
   `free` = take the set out of `src.asks`, `disposeObject3D(group)`.
2. The dressing part's `bytes` leaves `traffic.group` out (it is a part
   of its own now): the tile's total is unchanged once both are built.
3. Behaviour changes: D3 (hung after its compile), D5 (weighed from the
   build), D10 (a coarse level's bodies at the coarse rank). D6 stays: a
   `"compile"` part holds the lane through its compile wait (finding 4).
   Update step 0's marked pins in this commit, nothing else.
4. **What D10 changes.** On a switch-on the coarse levels' bodies (2–3.4
   MiB, 30–170 ms to build each on a desktop) go ahead of the fine
   levels' bodies and of fine dressings still queued, at most
   `MAX_DRESSING_OVERTAKES` (4) ahead of any one of them: from the air
   and far off the flows appear everywhere first, as the coarse crowns
   do (plan 076 step 4); near the camera the fine bodies come a few
   coarse builds later. The tile's total weight is unchanged. Verify:
   a `late-parts.test.ts` case — a coarse traffic part queued after a
   fine dressing builds first, and a fifth coarse part does not
   overtake it; in step 4's switch-on measurement (Verification) the
   spawn tile's fine bodies are shown within the baseline's time plus
   four coarse builds, and `dressing:queue-wait`'s maximum is no
   higher than the baseline's.
5. Rewrite the traffic tests (≈ 794–1023) on a real `createLateParts`
   with step 1's fake host; keep every case's expectation except the
   marked ones.
6. Verification adds `--grep @desktop-hud` (the data layers' switch-on)
   and finding 4's gate (Verification).
   Commit: `refactor(stream): the traffic bodies hang through the late
   parts`.

### Step 5 — Clean up

1. Delete what nothing calls: `unresolved` (if unused), the step-0
   private reaches, any `TrafficHost` mention in comments. `grep -n
   "as unknown as" app/_components/tile-stream.test.ts` counts 20 or
   fewer (the three private reaches gone).
2. `tile-stream.ts` head comment: the dressing plugin dresses what lands
   and hands what lands later to `late-parts.ts`.
3. Commit: `refactor(stream): drop what the late parts replaced`.

### Step 6 — Docs

Per the `docs-upkeep` skill (rewrite in place, no "update" paragraphs):

- **ADR 0024**, *Decision*, the bullet "Everything a tile brings is built
  and freed with it in the dressing plugin …, compiled before it shows":
  add in the same sentence that what lands after the tile itself — its
  dressing, a city tile's murals, a data layer's bodies — goes through
  one lifecycle (`late-parts.ts`): built in its turn, compiled before it
  hangs, weighed from its build, freed once its compile has ended.
  *Consequences*, "Anything added after the first frame … respects
  disposal": name the late parts as the way.
- **`docs/rendering.md`**, *Boot sequence* (≈ 1500–1545): the dressing
  and the traffic slot paragraph names the late parts and the two hang
  policies (a level's hand-over waits on the dressing only); the tile
  cache bullet (≈ 1089) "the dressing's geometry and a city tile's
  murals" becomes what the tile's late parts weigh from their build.
- **`city-walker` skill**, *Tiles*: after "What a tile adds beyond its
  glTF must reach the cache's weighing", one sentence: a part that lands
  after its tile is a `LatePart` (`late-parts.ts`), which weighs, frees
  after the compile and reports for it.
- **`new-scene-layer` skill**, item 5 *Lifecycle*: a part built after
  its tile (on demand, from a file of its own) is a `LatePart` adapter;
  choose `hangAt` ("wait" only for what a hand-over waits on).
- **AGENTS.md**, *Rendering*, "Everything a tile brings is built in the
  dressing plugin's `processTileModel` …": add "(what lands later: a
  late part, `late-parts.ts`)". One line.
- `docs/plans/README.md`: this plan's row.
- Commit: `docs: a tile's late parts have one lifecycle`.

## Verification

After every step: `bun run fix`, `bun run verify`, `bun run
typecheck:tsc`; `git diff --stat` touches only the step's files.

After steps 2, 3 and 4 (one production build each):

- `bun run test:e2e -- --grep @desktop-render` and `--grep @phone`;
  after step 4 also `--grep @desktop-hud`.
- Step 0's script, lite and phone-emulated: `framedBuilds` (every
  delta), `anchors` equal to the baseline; `gpuBytes` and every `memory`
  counter, and `cpuBytesOf().total`, no higher. The traffic switch-on
  numbers too.
- Veil to loaded, three headless runs: the median within 5 % of the
  baseline; `dressing:compile` and `dressing:queue-wait` maxima not
  higher than the baseline's by more than run-to-run spread.
- Leak hunt (`city-walker` skill): fly away and back to the spawn twice;
  `getGpuDebug()`'s gap at the second return equals the first's.
- After step 3: step 0's murals record (meshes present, the tile's
  share) holds.
- After step 4: the switch-on numbers of step 0 — the phone-emulated
  peak `renderer.info.memory.total` no higher, the time to the last body
  and the `dressing:queue-wait` maximum within run-to-run spread, the
  spawn tile's fine bodies no later than the baseline plus four coarse
  builds (D10). Record the desktop switch-on time against finding 4's
  gate (more than 1 s spent in the hold → note a follow-up in the status
  row; do not change the lane in this plan).

No picture change is intended: no plates are needed unless a check above
moves; then a real-GPU plate pair of the moved view (`pr-snapshots`).

## STOP conditions

Stop, leave the tree green at the last finished step, and write the
reason in the status row if:

- **078 is not done** (drift check).
- **A compile count moves**: any `framedBuilds` delta or `anchors`
  differs from the baseline (a part compiled differently, or hung before
  its compile).
- **A phone's memory grows**: `gpuBytes`, a `memory` counter or
  `cpuBytesOf().total` above the baseline on the phone-emulated boot, or
  the leak hunt's gap grows.
- **The hand-over stalls**: veil to loaded slower by more than 5 %, or a
  level waits on `loaded` before its `ready` (row 13).
- **A free before its compile ends**: the module test fails, or a
  `dispose <tile>` allocation note appears on the trail in an e2e run
  that had none at the baseline.
- **A pinned test changes outside its step's listed drift items.**
- **The part interface needs a third policy field** (step 1's spike):
  the module is getting shallow; redesign before building.

## Out of scope

- The content's own compile (`compileContent`, `dropContentCopies`,
  `disposeContentNow`): the tile itself, not a late part.
- The sky view and the facade readings (`shareSkyView`,
  `facadeReadings`): late, but they bind a texture or a table to the
  city's material — no compile, no hang. They could join later.
- The data overlays' bicycle columns and trams (`data-overlays.ts`,
  scene-wide, not per tile), and the nameplate.
- `TileStreamContext`'s width and its nine test fakes: plan 074 part C.
- The ranks' values, `MAX_DRESSING_OVERTAKES`, `COMPILE_WAIT_MS`,
  `handOverWaitMs`.
- The rasters (plan 077).

## Maintenance notes

- A new thing that lands on a tile after the tile is a `LatePart`
  adapter in `late-parts.ts`'s callers, never a new hand-written
  sequence. `hangAt: "wait"` only for what a level's hand-over waits on
  (today the dressing alone); everything else `"compile"`.
- A rule about late parts — when to weigh, when to free, what is gone —
  is fixed in `late-parts.ts` and tested in `late-parts.test.ts`, through
  the fake host; never through a private member of the plugin.
- `ready` must never wait on `loaded`: the renderer records the content
  only after `processTileModel`, which may be waiting on `ready`.
- Once DONE, condense this plan into `completed.md` per the README's
  Lifecycle.
