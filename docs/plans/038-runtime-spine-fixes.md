# Plan 038: Five runtime fixes — night tile pinning, a boot that never loads, a reload loop, a stuck key, live mode after a jump

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command
> and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this
> plan's row in `docs/plans/README.md` (status + deviations).
>
> **Drift check (run first)**:
> `git diff --stat dd470e9..HEAD -- app/_components/sun-rig.ts app/_components/create-app.ts app/_components/tile-stream.ts lib/city/boot-phases.ts app/_components/gpu-recovery.ts app/_components/crash-report.tsx lib/city/crash-trail.ts app/_components/keyboard-controls.ts app/_components/camera-pose.ts`
> If any of these changed, compare the excerpts below against the live
> code; a mismatch in the lines a step edits is a STOP condition for that
> step (the other steps may proceed).

## Status

- **Priority**: P1 (steps 1–3 hit phones, the device the memory work exists for)
- **Effort**: S (five small, unit-testable changes)
- **Risk**: LOW–MED (step 2 touches the boot state machine)
- **Depends on**: 037 (for the correct test command); otherwise none
- **Category**: bug
- **Planned at**: commit `a28de75`, 2026-10-01; refreshed against `dd470e9` (main with ADR 0035)

## Why this matters

Five independent defects in the viewer's spine, each confirmed by reading
the code (three.js r186 and 3d-tiles-renderer 0.5.3 sources included):

1. **At night the shadow camera freezes and pins tiles.** The sun's shadow
   camera is a *streaming* camera (tiles in its view are loaded at full
   detail). three only updates its matrices while it renders the shadow,
   and an invisible light (the sun below the horizon) renders none — so
   after dusk the frustum stays where the last daytime shadow was, and the
   tile under it stays loaded wherever the player goes. The memory governor
   cannot evict tiles that are in use. Worst case: a phone recovering from
   a lost GPU at night boots at 14:00 at the spawn, then restores the night
   pose — the spawn tile stays pinned on top of the view that ran it out of
   memory.
2. **"Loaded" never arrives if the spawn's fine level never loaded.** The
   boot waits for the spawn tile's dressing to be *tried*; only the fine
   terrain level carries a dressing; the first frame accepts the coarse
   one. A jump away before the fine level is requested (GPU-recovery
   restore, an early locate, a minimap click, a viewpoint) means the
   dressing is never tried: fog stays capped at 1.1 km for the session,
   the picture styles are never warmed, the pill sits at "99 %".
3. **GPU recovery can reload forever, and hides the report you'd want.** It
   allows two reloads per 120 s; a phone that loses its GPU ~70 s after
   each boot (realistic: boot + stream back to the heavy view) reloads
   indefinitely. And the next page suppresses the previous crash report
   whenever any recovery happened in the last two minutes — including a
   recovered page that then died.
4. **A ⌘-chord on macOS leaves a movement key held.** macOS browsers send
   no `keyup` for a key released while ⌘ is down; the handler registers
   the movement press *before* checking for a chord, so ⌘A, ⌘E, ⌘W… leave
   the camera walking until the window blurs.
5. **Live mode pulls the camera back after a jump.** With live mode on, a
   minimap click, a viewpoint or a double tap moves the camera — and the
   GPS follow eases it back 1–3 s later, because those paths never end
   follow. The code's own contract (`endFollow`: "the player took over by
   hand") says they should.

## Current state

### 1 — sun rig (`app/_components/sun-rig.ts`)

`reposition()` (`:269-289`) moves `sun.position` and `sun.target.position`
and sets `sun.shadow.needsUpdate` when the snapped centre changed. It never
touches the shadow camera. `update()` (`:323-332`):

```ts
  const update = (date: Date): SunState => {
    const d = sunDirectionWorld(date, latLng.lat, latLng.lng);
    dir.set(d.x, d.y, d.z);
    sunDirectionOut?.copy(dir);
    const aboveHorizon = dir.y > 0;
    reposition();
    sun.shadow.needsUpdate = true; // sun moved — force a shadow re-render
    sun.visible = aboveHorizon;
```

The rig exposes `shadowCamera: sun.shadow.camera` (`:370`), which
`create-app.ts:771-775` registers with the tile renderer:

```ts
      {
        camera: sunRig.shadowCamera,
        width: shadowMapSizeFor(budget.profile, budget.tier),
        height: shadowMapSizeFor(budget.profile, budget.tier),
      },
```

three r186: `ShadowNode.renderShadow` calls `shadow.updateMatrices(light)`
(`node_modules/three/src/nodes/lighting/ShadowNode.js:646`) — the only
place the shadow camera's `matrixWorld`/`matrixWorldInverse` are updated.
`Renderer._projectObject` returns early for `object.visible === false`
(`Renderer.js:3244`), so an invisible sun never reaches it.
3d-tiles-renderer reads `camera.matrixWorldInverse` as is
(`node_modules/3d-tiles-renderer/src/three/renderer/tiles/TilesRenderer.js:565-576`).
`LightShadow.updateMatrices(light)` is public three API (core
`DirectionalLightShadow` inherits it).

### 2 — boot (`lib/city/boot-phases.ts`, `create-app.ts`, `tile-stream.ts`)

`boot-phases.ts:84-94`:

```ts
    update: (inputs) => {
      const idle = inputs.tilesIdle && inputs.dressingsQueued === 0;
      if (!loaded) {
        const stages = progress(inputs);
        if (streaming && inputs.spawnDressed && idle) {
          loaded = true;
```

`create-app.ts:1465-1475` feeds it `spawnDressed: stream.dressingSettled(spawn.id)`.
`tile-stream.ts:889-891` queues a dressing only from `dressTerrain` when
`extras.dressing` is set (`if (extras.dressing) { this.queueDressing(scene, terrain, extras); }`),
and `queueDressing`'s `finally` does `this.settled.add(extras.tileId)`
(`:1012-1014`). Only level 0 carries `dressing`
(`scripts/prepare-data.ts:591`: `...(level === 0 ? { dressing: pickFiles(names, DRESSING_KINDS) } : {})`).
`TerrainLayer` has `level: 0 | 1` (`terrain-layer.ts:126`) and the stream
holds every loaded one in `stream.terrains: Set<TerrainLayer>`
(`tile-stream.ts:164`). Whether a `TerrainLayer` knows its tile id: check
its interface (`terrain-layer.ts:112-150`) — the stream's `extras.tileId`
is available where the layer is created.

Key fact for the fix: `queueDressing` is called **synchronously** inside
`dressTerrain`, so "the spawn's fine terrain is loaded" implies "its
dressing is queued or settled". If the fine level is not loaded and the
tile renderer is idle, nobody will ever dress the spawn — waiting for it is
wrong.

`boot-phases.test.ts` builds inputs with a helper `at(over)` and asserts
`update(...).loaded` — follow it.

### 3 — GPU recovery (`app/_components/gpu-recovery.ts`, `crash-report.tsx`)

```ts
const KEY = "gpu-recovery";
const WINDOW_MS = 120_000;
const TRIES = 2;
...
    const tries = read(store).tries.filter((t) => now - t < WINDOW_MS);
    if (tries.length >= TRIES) {
      return false;
    }
```

`crash-report.tsx:22-28`:

```ts
function initialTrail(): Trail | null {
  const always = new URLSearchParams(location.search).get("trail") === "1";
  if (always) {
    return previousTrail();
  }
  return recentlyRecovered() ? null : previousCrash();
}
```

The `recentlyRecovered` doc comment explains why it exists: iOS may
interleave a navigation of its own that leaves a trail with nothing but its
start. A page that reloads for a lost GPU notes `"reloading"` last
(`create-app.ts:1237-1239`: `opts.trail?.note("reloading", "to recover the GPU")`).
A trail's events are `TrailEvent { t, kind, detail? }` in `trail.events`
(`lib/city/crash-trail.ts`); `endedInCrash(trail)` is `trail?.state === "running"`.
Also note: `onFrameFailed` (any throw inside `postStack.render`) goes
through the same `stopRendering → onGpuLost → reload` path
(`create-app.ts:1227-1268`), so a deterministic render bug loops too.

### 4 — keyboard (`app/_components/keyboard-controls.ts:58-93`)

```ts
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || isTextEntry(e.target)) {
      return;
    }
    actions.press(e.code);
    // A chord belongs to the browser: Cmd/Ctrl+V pastes, Cmd+F finds, Cmd+R
    // reloads — none of them may also switch the style, fly or demolish.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    ...
  const onKeyUp = (e: KeyboardEvent) => {
    actions.release(e.code);
  };
  const onBlur = () => actions.releaseAll();
```

Shift is a movement modifier (sprint / descend) — do not block `shiftKey`.
The test harness in `keyboard-controls.test.ts:1-53` (`harness()`, `fire()`,
`calls`) records `press:<code>`, `release:<code>`, `releaseAll`.

### 5 — live mode (`app/_components/camera-pose.ts`)

```ts
  /** The player took over by hand: live mode ends, the HUD hears of it. */
  const endFollow = () => {
    if (followAim || followPos) {
      followAim = null;
      followPos = null;
      opts.onFollowEnd?.();
    }
  };
```

Called from `rotate` (`:398-399`), `press` for movement keys (`:567-569`)
and `setMoveInput` (`:583-586`). **Not** from `applyCameraState` (`:427`),
`teleportTo` (`:449`) or `flyToViewpoint` (`:484`). `step()` eases toward
`followPos`/`followAim` every frame (`:524-529`). `placeAt` (`:491`) is the
"locate me" path that *puts* you at the GPS spot — leave it alone.
Callers: minimap `onTeleport` (`city-walk.tsx`), sidebar viewpoints
(`scene-sidebar.tsx`), the double tap (`create-app.ts`, calls into the pose).
Tests: `camera-pose.test.ts:298-365` ("live mode eases the view…", "live
mode walks the camera to each GPS fix…") use `rig({ onFollowEnd })`,
`pose.setFollowPosition`, `settle(pose)`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests (one file) | `bun test app/_components/sun-rig.test.ts` | all pass |
| All unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |

(Never a bare `bun test` with no path: it loads the Playwright specs.)

## Scope

**In scope**: `app/_components/sun-rig.ts` (+ test), `lib/city/boot-phases.ts`
(+ test), `app/_components/create-app.ts` (only the `checkLoaded` input),
`app/_components/tile-stream.ts` (only if a small query is needed for
step 2), `app/_components/gpu-recovery.ts` (+ test), `app/_components/crash-report.tsx`,
`lib/city/crash-trail.ts` (+ test), `app/_components/keyboard-controls.ts`
(+ test), `app/_components/camera-pose.ts` (+ test).

**Out of scope**: the memory governor (`lib/city/memory-governor.ts`) and
its start level (a separate direction option); any change to what the
shadow *renders*; `placeAt`; the HUD message texts beyond step 3's.

## Git workflow

Branch `claude/038-runtime-spine-fixes`; one Conventional Commit per step,
e.g. `fix(sun): the shadow camera follows at night, no tile pinned`,
`fix(boot): loaded without the spawn's dressing when its fine level never came`,
`fix(recovery): two reloads per ten minutes; a recovered page's crash is reported`,
`fix(keys): a Cmd chord never holds a movement key`,
`fix(live): a jump or a glide ends live mode`. No push unless instructed.

## Steps

### Step 1: The shadow camera follows by night

At the end of `reposition()` (after `sun.position.set(...)`), bring the
shadow camera up to date regardless of visibility:

```ts
    // The shadow camera is also a streaming camera (create-app.ts): three
    // updates it only while drawing the shadow, which an invisible sun (at
    // night) never does — a stale frustum would keep its tiles loaded.
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
```

Add a test to `sun-rig.test.ts` using its `rig()` and `walkTo()` helpers:
set a night time (e.g. `sunRig.update(new Date("2026-12-21T23:00:00+01:00"))`),
`walkTo(sunRig, 0, 0)`, read `sunRig.shadowCamera.matrixWorld` translation
(`new Vector3().setFromMatrixPosition(...)`), then `walkTo(sunRig, 800, 0)`
and assert the camera's world position moved by roughly 800 m in x
(`toBeGreaterThan(700)`). Also assert the same holds by day (regression).

**Verify**: `bun test app/_components/sun-rig.test.ts` → all pass,
including the new test; temporarily remove the three new lines → the night
test fails; restore.

### Step 2: The boot does not wait for a dressing nobody will build

Change the meaning of the `spawnDressed` input (rename it to
`spawnSettled` in `BootInputs` and its doc comment): *the spawn's dressing
was tried, or the spawn's fine terrain is not loaded* (then no dressing is
pending for it, and `tilesIdle` already says nothing more is coming).

In `create-app.ts` `checkLoaded()`:

```ts
      spawnSettled:
        stream.dressingSettled(spawn.id) || !spawnFineLoaded(),
```

where `spawnFineLoaded()` is true when `stream.terrains` contains a level-0
terrain of the spawn tile. If `TerrainLayer` has no tile id, compare
`terrain.bounds` with `spawn.bounds` (both `[minX, minY, maxX, maxY]` in the
projected CRS) — do not add a field to `TerrainLayer` for this unless
bounds comparison is impossible.

Update `boot-phases.ts` (field rename + comment) and add a test to
`boot-phases.test.ts`: after `startStreaming()`, an update with
`tilesIdle: true, dressingsQueued: 0, spawnSettled: true` is `loaded`,
and one with `spawnSettled: false` is not (rename in existing tests too).

**Verify**: `bun test lib/city/boot-phases.test.ts` → all pass;
`bun run typecheck` → exit 0; `grep -rn spawnDressed app lib` → no matches.

### Step 3: Recovery without a loop, and the crash it hides

> **2026-10-03:** sub-steps 2 and 3 (`offerAsCrash`, the card using it)
> landed with ADR 0043 — the crash reports use the same rule. Sub-steps 1
> and 4 are still open.

1. `gpu-recovery.ts`: `WINDOW_MS = 600_000` (ten minutes), keep `TRIES = 2`;
   update the file's header comment ("At most twice in ten minutes …") and
   the existing test "twice in two minutes…" to the new window (rename it).
   `recentlyRecovered` keeps its own two-minute meaning: introduce
   `const RECENT_MS = 120_000` for it so its behaviour does not change.
2. `lib/city/crash-trail.ts`: add a pure helper

   ```ts
   /** Whether the previous page's record should be offered as a crash. */
   export function offerAsCrash(trail: Trail | null, recovered: boolean): trail is Trail
   ```

   true when `endedInCrash(trail)` and NOT (the last event's `kind` is
   `"reloading"`), and NOT (`recovered` and the trail has no event of kind
   `"first frame"` — the iOS interleaved navigation the old comment
   describes). Unit-test the four cases in `lib/city/crash-trail.test.ts`.
3. `crash-report.tsx`: `initialTrail()` returns
   `offerAsCrash(prev, recentlyRecovered()) ? prev : null` with
   `prev = previousTrail()`; update its doc comment.
4. When `recoverFromGpuLoss` refuses (tries exhausted), the HUD currently
   shows the failure through the stream-error banner, whose prefix is
   "Eine Schicht konnte nicht geladen werden:". Check
   `create-app.ts:1241` (`const failed = "Die Grafik ist ausgefallen (…)"`)
   and how it reaches the HUD; if it lands under that prefix, give it its
   own path (e.g. `onError` vs `onStreamError`, whichever exists) so the
   message is not prefixed. **If** that requires touching more than
   `create-app.ts` and `city-walk.tsx` in a few lines, skip sub-step 4 and
   note it.

**Verify**: `bun test app/_components/gpu-recovery.test.ts lib/city/crash-trail.test.ts` → all pass, including a new case: tries at t=0 and t=70 s, a third at t=140 s is refused (`false`).

### Step 4: A ⌘-chord never holds a movement key

In `onKeyDown`, return before `actions.press(e.code)` when `e.metaKey` is
set. In `onKeyUp`, when `e.code` is `"MetaLeft"` or `"MetaRight"`, call
`actions.releaseAll()` (a key held *before* ⌘ went down gets no keyup
either). Keep Ctrl/Alt behaviour as is (they deliver keyups).

Tests in `keyboard-controls.test.ts` (use `harness()`/`fire()`):
`fire("keydown", { code: "KeyA", metaKey: true })` → no `press:KeyA` in
`calls`; `fire("keydown", { code: "KeyW" })` then
`fire("keyup", { code: "MetaLeft" })` → `releaseAll` in `calls`.

**Verify**: `bun test app/_components/keyboard-controls.test.ts` → all pass.

### Step 5: A jump or a glide ends live mode

Call `endFollow()` right after `cancelGlide()` in `applyCameraState`,
`teleportTo` and `flyToViewpoint` (`flyToViewpoint` has no `cancelGlide`
call — add `endFollow()` at its top). Do not change `placeAt`.

Test in `camera-pose.test.ts`, modelled on "live mode walks the camera to
each GPS fix…": `setFollowPosition` near the camera, `teleportTo` 300 m
away, `settle(pose)` → the camera stays at the teleport target (within
0.5 m) and `ended === 1`. Repeat for `flyToViewpoint` with a viewpoint
from the existing tests.

**Verify**: `bun test app/_components/camera-pose.test.ts` → all pass.

### Step 6: Gate

**Verify**: `bun run fix && bun run verify` → exit 0.

## Test plan

New unit tests (all `bun:test`, colocated):
- `sun-rig.test.ts`: shadow camera follows `follow()` by night and by day.
- `boot-phases.test.ts`: loaded with `spawnSettled` when idle after the gate.
- `gpu-recovery.test.ts`: third try in ten minutes refused; spacing of 70 s no longer loops.
- `crash-trail.test.ts`: `offerAsCrash` — reloading-last (no), recovered-without-first-frame (no), recovered-with-first-frame-then-died (yes), plain crash (yes).
- `keyboard-controls.test.ts`: meta chord does not press; Meta keyup releases all.
- `camera-pose.test.ts`: teleport and viewpoint glide end follow.

## Done criteria

- [ ] `bun run verify` exits 0
- [ ] `grep -n "updateMatrices" app/_components/sun-rig.ts` → 1 match
- [ ] `grep -rn "spawnDressed" app lib` → no matches
- [ ] `grep -n "WINDOW_MS = 600_000" app/_components/gpu-recovery.ts` → 1 match
- [ ] `grep -n "offerAsCrash" app/_components/crash-report.tsx lib/city/crash-trail.ts` → matches in both
- [ ] `grep -c "endFollow()" app/_components/camera-pose.ts` → at least 6 (3 old + 3 new)
- [ ] Only in-scope files changed (`git status`)

## STOP conditions

- `sun.shadow.updateMatrices` does not exist on the r186 type or throws in
  the test → stop; report (alternative: `tiles.deleteCamera` while the sun
  is down — a design change for the maintainer).
- Step 2 needs a new field on `TerrainLayer` *and* bounds comparison is
  unreliable → stop and report the options.
- An existing e2e assertion depends on the two-minute recovery window
  (`grep -rn "recover" e2e/`) → stop.

## Maintenance notes

- If the sun rig ever stops being a streaming camera, step 1's lines stay
  harmless.
- Step 2's rule ("loaded" can come without the spawn's dressing) means the
  e2e `__poc.ready` no longer guarantees the spawn is dressed when the
  camera left it early — the specs start at the spawn, so they are not
  affected.
- Reviewers: check step 3 still reports a recovered page that later died
  (`offerAsCrash` case 3) — that is the report the old code lost.
