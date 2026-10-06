# Plan 060: The viewer's failure paths say what failed and settle — dressing failures reported, the whole frame guarded, the cut-out hold that fails, the error word's latch, the ghost dressing, the heartbeat after a stop, the Modell exit's FOV, a cancelled pointer

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command
> and confirm the expected result before moving on. If anything in the
> "STOP conditions" section occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- app/_components/create-app.ts app/_components/tile-stream.ts app/_components/tile-stream.test.ts app/_components/crash-trail.ts app/_components/crash-trail.test.ts lib/city/crash-trail.ts lib/city/crash-trail.test.ts lib/city/crash-reports.ts app/_components/model-rig.ts app/_components/model-rig.test.ts app/_components/touch-controls.ts app/_components/touch-controls.test.ts app/_components/post-stack.ts`
> `create-app.ts` changes often (44 commits in the last week): if its
> line numbers moved, find the excerpts by their text; on a mismatch of
> the *code*, treat it as a STOP condition for that step.
>
> **Ordering**: plan 066 lifts the GPU-loss closures out of `create-app.ts`.
> Run this plan **before** 066 (it edits the same closures in place).

## Status

- **Priority**: P1 (steps 1–4), P2 (steps 5–8)
- **Effort**: M in all (S per step)
- **Risk**: LOW per step
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

Eight defects in the viewer's spine, all found by reading the code at
`4b0310a` and confirmed against three.js r186's source; none is covered
by a test, all are on the paths ADR 0043 (reports), 0046 (GPU recovery)
and 0048 (network) were written for:

1. **A dressing that fails to build is dropped silently.** The dressing
   queue's final `.catch(() => {})` swallows every rejection of
   `buildDressing`: a bug in any of seventeen layer builders on one tile's
   data, a corrupt side file, or a heap allocation failure (`RangeError`,
   exactly what `lib/city/gpu-allocation.ts` classifies as an allocation
   failure) leaves bare tiles for every visitor of that place, with no
   trail note, no report, no HUD word — and the phone's memory-emergency
   path is bypassed for one of its likeliest triggers. `create-app.ts`'s
   comment promises "A tile that fails to load (or to dress) … the HUD
   says so once"; only `load-error` is wired.
2. **A throw before the render does not freeze the loop — it storms.**
   three's `Animation.update()` requests the next frame *before* calling
   the animation loop, so a throw out of `pose.step`, `stream.tiles.update()`,
   `followView` or `overlays.step` re-throws **every frame**. Each one
   lands in the crash trail's `window` error handler, whose `note()` does
   `JSON.stringify(trail)` + `localStorage.setItem` per call, and in the
   reports' `problems` counter — a 60 Hz main-thread storm behind a frozen
   picture, a session with thousands of errors, and no reload: only
   `postStack.render()` is guarded, so `onFrameFailed` never runs.
3. **The Ausschnitt stays "pending" for ever when its program hold fails.**
   `postStack.holdCut(...).then(reveal).catch(() => undefined)`: one failed
   shader build (an allocation failure on a phone) leaves the HUD's switch
   in "building…" with no error and no breadcrumb.
4. **The HUD's layer-error latch hides later failures.** `reportedError`
   is set once per page and only reset by the network's all-clear, which
   requires `reportedNetwork`: a non-network failure first silences every
   later failure, network ones included; a network failure first lets a
   later non-network one vanish when the network tile lands.
5. **A dressing whose compile outlasts the 3 s wait is hung on a released
   root.** `release()` returns early while a compile runs; the queue then
   checks `disposed`, the entry and `outcome`, but not `released`, and
   hangs the dressing on content the renderer already detached — a ghost
   in `stream.dressings` until the compile settles.
6. **Heartbeats after the render stopped count as 0-fps frames.** The beat
   interval keeps running after `stopRendering`; `pushBeat` counts any beat
   with cumulative `frames > 0` while visible, so the sessions behind the
   failure card report a bogus frame rate.
7. **`exitNow` from an interrupted Modell entry keeps the dolly's FOV.**
   `applyFrame` writes `fov`, `near`, `far` each frame of the dolly;
   `exitNow` restores `near`/`far` only; a `flyTo`/`placeAt` during the
   1.1 s entry lands telephoto.
8. **A `pointercancel` is scored as a tap** (and can complete a double-tap
   glide): `pointerup` and `pointercancel` share `onPointerEnd`, which
   decides `isTap` from slop and duration alone.

## Current state

All excerpts are from `4b0310a`; find them by text if the lines moved.

### 1 — the dressing queue (`app/_components/tile-stream.ts`)

`tile-stream.ts:1394-1400`:

```ts
      .catch(() => {
        // A dressing that fails leaves its tile bare, never the stream stuck.
      })
      .finally(() => {
        built();
        this.builtOf.delete(scene);
```

The context already has an allocation hook, `tile-stream.ts:194`:
`onAllocationFailure?: (error: unknown, where: string) => void;` and the
plugin's `compileFailed` (`:1270-1277`) routes compile errors through it:

```ts
  private compileFailed(err: unknown, where: string): Compiled {
    if (!isAllocationFailure(err)) {
      return "failed";
    }
    this.ctx.onAllocationFailure?.(err, where);
    return "out of memory";
  }
```

`create-app.ts:1129-1136` turns it into a trail note and the emergency:

```ts
      onAllocationFailure: (error, where) => {
        const message = error instanceof Error ? error.message : String(error);
        const part = where.split(" ")[0] ?? where;
        opts.trail?.note("alloc-failed", `${part} ${message}`);
        if (part !== "dispose") {
          memoryEmergency(`allocation ${part}`);
        }
      },
```

`create-app.ts:1182-1184` (the promise) and `:1238-1242` (the one `onError`
call, for `load-error` only):

```ts
    if (!(disposed || reportedError)) {
      reportedError = true;
      reportedNetwork = lost;
      opts.onError?.(failure.message);
    }
```

`lib/city/crash-reports.ts:53-65` — `PROBLEM_KINDS` (the trail kinds that
become a report of their own): `error`, `rejection`, `device-lost`,
`gpu-error`, `frame failed`, `load-error`, `boot failed`, `alloc-failed`,
`gpu failed`.

`isAbortError` is exported by `app/_components/fetch-optional.ts:33`;
`isAllocationFailure` by `lib/city/gpu-allocation.ts`.

The test to model after: `tile-stream.test.ts:229-266` ("a compile the GPU
had no room for is reported once, and drops nothing") builds a
`DressingPlugin` with a `TileStreamContext` stub (`compile`,
`onAllocationFailure`, `onChange`, `dressingGate`) and calls
`processTileModel`.

### 2 — the frame loop (`app/_components/create-app.ts:2417-2493`)

```ts
  void renderer.setAnimationLoop((time) => {
    if (pocFramesHeld()) {
      return;
    }
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    …
    if (!(modelRig.owns() || exporting)) {
      pose.step(dt);
    }
    …
    stream.tiles.update();
    …
    const equivalent = followView(elapsed);
    …
    overlays.step(performance.now());
    …
    renderer.info.reset();
    try {
      postStack.render();
    } catch (error) {
      onFrameFailed(error);
      return;
    }
    takeCaptureTile();
    frames++;
    tickPocFrame(shadowRendered);
  });
```

`node_modules/three/src/renderers/common/Animation.js:70-91` — `update()`
calls `this._context.requestAnimationFrame(update)` first, then
`this._animationLoop(time, xrFrame)`.

`app/_components/crash-trail.ts:210-220` — `note` writes on every call:

```ts
  const note = (kind: string, detail?: string) => {
    const event = { t: seconds(), kind, detail: detail?.slice(0, 300) };
    pushEvent(trail, event, Date.now());
    try {
      listener?.(event, trail);
    } catch { … }
    write();
    console.info(TAG, formatEvent(event));
  };
```

and `:237-244` the `window` error handler calls `note("error", …)`.

`onFrameFailed` (`create-app.ts:2297-2314`) classifies with `frameLoss`
and calls `stopRendering`, which nulls the animation loop.

### 3 — the cut-out hold (`create-app.ts:2165-2174`, `post-stack.ts:888-894`)

```ts
    postStack
      .holdCut(cuts.group, [cuts.group])
      .then(() => {
        if (request === cutRequest && !disposed) {
          cuts.reveal();
          invalidateShadows();
          opts.trail?.note("cut-out", "shown");
        }
      })
      .catch(() => undefined);
```

`modelHud()` (`:2177-2186`) reports `cutOutPending: cuts.cutOut() !== null && !cuts.revealed()`.
`postStack.releaseCut` exists (`post-stack.ts:895`: `releaseCut: letGo`).

### 4 — the latch (`create-app.ts:1190-1202`, `:1238-1242`)

```ts
  let reportedError = false;
  let reportedNetwork = false;
  …
  const clearNetworkWord = () => {
    if (reportedNetwork && !disposed) {
      reportedError = false;
      reportedNetwork = false;
      opts.onErrorCleared?.();
    }
  };
```

### 5 — the released root (`tile-stream.ts:1372-1384`, `:1454-1466`, `:1553-1561`)

```ts
        if (
          this.disposed ||
          this.dressed.get(scene) !== entry ||
          outcome === "out of memory"
        ) {
          // freed once its compile has ended (see `compiles`)
          compiled
            .then(() => this.disposeFailed(disposeDressing(dressing), scene))
            .catch(() => undefined);
          return;
        }
        this.hangDressing(scene, entry, dressing);
```

`disposeTile` adds the scene to `this.released` then calls `release(scene)`,
which returns early `if (this.compiles.has(scene))` — so the `dressed`
entry is still `entry` when the queue resumes.

### 6 — the beat (`create-app.ts:2500-2531`, `lib/city/crash-trail.ts:336-351`)

```ts
    const beat = setInterval(() => {
      …
      const rate = ((frames - beatFrames) * 1000) / Math.max(now - beatAt, 1);
      beatFrames = frames;
      beatAt = now;
      trail.beat({ frames, fps: rate, … });
    }, TRAIL_BEAT_MS);
```

```ts
export function pushBeat(trail: Trail, beat: TrailBeat): void {
  pushRing(trail.beats, beat, TRAIL_BEATS);
  if (beat.frames === 0 || trail.state === "hidden") {
    return;
  }
  const stats = (trail.stats ??= emptyStats());
  stats.beats += 1;
  stats.fpsSum += beat.fps;
  …
```

`stopRendering` (`:2236-2268`) sets `stopped = true` and nulls the loop.

### 7 — Modell's exit (`app/_components/model-rig.ts:336-358`, `:827-841`)

```ts
  const applyFrame = (…) => {
    …
    c.fov = f.fovDeg;
    c.near = f.near;
    c.far = f.far;
    c.updateProjectionMatrix();
    …
  };

  const restorePerspective = () => {
    const c = opts.camera;
    c.near = PERSPECTIVE_NEAR;
    c.far = PERSPECTIVE_FAR;
    c.updateProjectionMatrix();
  };
  …
    exitNow: () => {
      if (phase.kind === "off") {
        return;
      }
      const wasParallel = phase.kind === "model";
      restorePerspective();
      phase = { kind: "off" };
      view = null;
      glide = null;
      entry = null;
      …
```

`entry` holds the pose the dolly started from (read `enter()` in the
same file for its shape — it carries the perspective pose including `fov`).

### 8 — the pointer (`app/_components/touch-controls.ts:304-324`, `:370-371`)

```ts
    const isTap =
      !(dragged || longPressed) &&
      pointers.size === 0 &&
      e.timeStamp - state.startTime <= TAP_MAX_DURATION_MS;
    if (isTap) {
      …
      callbacks.onTap?.(ndcX, ndcY, e.pointerType);
      if (isDoubleTap(lastTap, tap)) {
        lastTap = null;
        callbacks.onDoubleTap(ndcX, ndcY);
      } else {
        lastTap = tap;
      }
    }
```

```ts
  element.addEventListener("pointerup", onPointerEnd);
  element.addEventListener("pointercancel", onPointerEnd);
```

Conventions: TypeScript strict, complexity cap 20 (extract helpers);
every trail kind that is a problem is listed in `PROBLEM_KINDS`; tests
beside the module with `bun:test`; a `// reason:` comment for any `as`
that overrules a type; Conventional Commits (`fix(stream): …`,
`fix(viewer): …`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Format + autofix | `bun run fix` | exit 0 |
| Typecheck | `bun typecheck` | exit 0 |
| Targeted tests | `bun test app/_components/tile-stream.test.ts app/_components/crash-trail.test.ts lib/city/crash-trail.test.ts app/_components/model-rig.test.ts app/_components/touch-controls.test.ts` | pass |
| The gate | `bun run verify` | exit 0 |
| e2e smoke (optional, slow) | `bun run test:e2e --grep "@desktop-render"` | pass |

## Scope

**In scope** (the only files you should modify):
- `app/_components/tile-stream.ts`, `app/_components/tile-stream.test.ts`
- `app/_components/create-app.ts` (the named closures only)
- `app/_components/crash-trail.ts`, `app/_components/crash-trail.test.ts`
- `lib/city/crash-trail.ts`, `lib/city/crash-trail.test.ts`
- `lib/city/crash-reports.ts` (`PROBLEM_KINDS` only)
- `app/_components/model-rig.ts`, `app/_components/model-rig.test.ts`
- `app/_components/touch-controls.ts`, `app/_components/touch-controls.test.ts`
- `app/(legal)/datenschutz/page.mdx` — **only if** step 1 adds a report
  field the page does not cover (it does not: a new problem *kind* is
  not a new field; see Maintenance notes)

**Out of scope** (do NOT touch, even though they look related):
- Moving the closures out of `create-app.ts` — plan 066.
- `post-stack.ts` — `holdCut`/`releaseCut` are used as they are.
- `lib/city/gpu-safety.ts` `frameLoss` — step 2 widens what reaches it;
  its "emergency before it" sign having no time window is a known,
  accepted limit (index: rejected list).
- The HUD components that show `onError` — step 4 changes when they are
  called, not what they render.

## Git workflow

- Branch: the branch you were given, or `plan/060-spine-failure-paths`.
- One commit per step, Conventional Commits, lowercase subject (examples
  in each step).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: A dressing that fails is noted, reported, and an allocation failure sheds memory

In `tile-stream.ts`:

1. Add to `TileStreamContext` (beside `onAllocationFailure`):
   ```ts
     /** a dressing whose build threw (not an abort, not an allocation
      *  failure — those go to `onAllocationFailure`): the tile stays bare */
     onDressingFailed?: (error: unknown, tile: string) => void;
   ```
2. Replace the swallowing `.catch(() => {})` in `queueDressing` with:
   ```ts
         .catch((err: unknown) => {
           // A dressing that fails leaves its tile bare, never the stream
           // stuck — but never silently: a builder's throw is a bug or a
           // heap that ran out.
           if (isAbortError(err) || this.disposed) {
             return;
           }
           if (isAllocationFailure(err)) {
             this.ctx.onAllocationFailure?.(err, `dressing ${tileIdOf(scene)}`);
           } else {
             this.ctx.onDressingFailed?.(err, tileIdOf(scene));
           }
         })
   ```
   (`tileIdOf(scene)` is what the plugin already uses at `:1283`; check
   `isAbortError` is imported — it is used elsewhere in the file.)
3. In `create-app.ts`, where the context is built (`:1129` area), add:
   ```ts
         onDressingFailed: (error, tile) => {
           const message = error instanceof Error ? error.message : String(error);
           opts.trail?.note("dressing failed", `${tile} ${message}`);
           if (!(disposed || reportedError)) {
             reportedError = true;
             reportedNetwork = false;
             opts.onError?.(`Ein Teil der Stadt fehlt (${tile}): ${message}`);
           }
         },
   ```
   (the German matches the existing `onError` texts in the file — read the
   `load-error` branch's message and mirror its wording; step 4 then
   reshapes the latch — do step 4's edit on the latch after this one.)
4. Add `"dressing failed"` to `PROBLEM_KINDS` in `lib/city/crash-reports.ts`
   with a comment `// a dressing's build threw: the tile stays bare`.

Test (in `tile-stream.test.ts`, modelled on `:229-266`): a plugin whose
`buildDressing` throws — the cheapest way is a context whose fetch of a
side file is a function that throws synchronously inside the build; read
`buildDressing`'s first awaits (`:644-700`) to find the earliest injected
dependency (`ctx.fetch`/`get`), and make it throw `new TypeError("boom")`
for one case and `new RangeError("Array buffer allocation failed")` for
the other. Assert `onDressingFailed` received the TypeError with the tile
id and `onAllocationFailure` received the RangeError with
`"dressing <tile>"`, and that the plugin is not stuck (`built` was called:
`processTileModel` resolves).

**Verify**: `bun test app/_components/tile-stream.test.ts` → pass with the
new test; `bun typecheck` → exit 0.
Commit: `fix(stream): a dressing that fails to build is noted and reported, an allocation failure sheds memory`.

### Step 2: The whole frame is guarded; repeated identical errors coalesce

In `create-app.ts`, move the `try` to cover the loop body: from `timer.update(time)`
through `tickPocFrame(shadowRendered)`, i.e.

```ts
  void renderer.setAnimationLoop((time) => {
    if (pocFramesHeld()) {
      return;
    }
    try {
      frame(time);
    } catch (error) {
      onFrameFailed(error);
    }
  });
```

with the existing body extracted as `const frame = (time: number) => { … }`
(the body is long; the extraction is a cut-and-paste, no logic change —
the inner `try { postStack.render() } catch { onFrameFailed; return }`
becomes a plain `postStack.render()` call, since the outer guard now
covers it). `onFrameFailed` already classifies through `frameLoss` with
`answers: () => probeGpu(renderer) === null`, so a throw on a working GPU
takes the `"failed"` branch (a reload at the same level, never a lighter
device).

In `app/_components/crash-trail.ts`, make the `window` error handler
coalesce a repeated identical message: keep the last `error` note's text
and a count; on the same text within 10 s, do not call `note` again but
bump the count, and when the text changes (or at `end`) emit one note
`error ×N`. Simplest form: a module-level `let lastError = { text: "", count: 0, at: 0 }`
in `startCrashTrail`'s closure; `onError` computes `text`; if
`text === lastError.text && seconds() - lastError.at < 10`, `lastError.count++`
and return; else, if `lastError.count > 1`, `note("error", `${lastError.text} ×${lastError.count}`)`,
then `note("error", text)` and reset. This keeps a storm to one write per
10 s instead of one per frame.

Test (`crash-trail.test.ts`, with the file's fake storage): dispatch the
same `ErrorEvent` 5 times within the window → the trail holds one `error`
event; dispatch a different one → the first is followed by a `×5`
summary... adjust to whatever shape you implement, and assert the count
of `error` events is 2–3, not 6.

**Verify**: `bun test app/_components/crash-trail.test.ts` → pass;
`bun typecheck` → exit 0; `bun run test:e2e --grep "@desktop-render"`
(optional, slow) → pass (the loop still renders).
Commit: `fix(viewer): a throw anywhere in the frame stops the render once; repeated errors coalesce in the trail`.

### Step 3: A cut-out hold that fails settles

Replace `.catch(() => undefined)` on the `holdCut` chain with:

```ts
      .catch((error: unknown) => {
        if (request !== cutRequest || disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        opts.trail?.note("cut-out failed", message);
        cuts.setCutOut(null);
        postStack.releaseCut();
        if (isAllocationFailure(error)) {
          memoryEmergency("allocation cut-out");
        }
        opts.onError?.(`Der Ausschnitt konnte nicht gebaut werden (${message}).`);
      });
```

Read `cuts.setCutOut`'s signature first (`:2126-2160`) and call it the way
the HUD's "off" path does. `modelHud()` then reports `cutOut: false`.

**Verify**: `bun typecheck` → exit 0; `bun lint` → exit 0. (No unit test
reaches this closure before plan 066; note it in the commit.)
Commit: `fix(model): a cut-out whose programs fail to build is released and said`.

### Step 4: The error word has one latch per cause

Replace the two booleans with one small state: `let shown: "none" | "network" | "layer" = "none"`.
`load-error` (network) → `shown = "network"` and `onError` if `shown === "none"`
or `shown === "layer"` (a network word replaces a layer word: it is the one
the healer can clear); a non-network `load-error` or a `dressing failed`
→ if `shown === "none"`, `shown = "layer"` and `onError`. `clearNetworkWord`
→ only if `shown === "network"`: `shown = "none"`, `onErrorCleared`. Keep
the HUD's "once" semantics: a second layer failure while a layer word
shows stays silent (as today), but a network failure is never silenced
by an earlier layer word, and a layer failure is never cleared by a
network landing.

**Verify**: `bun typecheck` → exit 0; `grep -n "reportedError\|reportedNetwork" app/_components/create-app.ts` → no match.
Commit: `fix(hud): the missing-part word keeps one latch per cause`.

### Step 5: A released root is never dressed

In the queue's condition add the released check:

```ts
        if (
          this.disposed ||
          this.released.has(scene) ||
          this.dressed.get(scene) !== entry ||
          outcome === "out of memory"
        ) {
```

Test (`tile-stream.test.ts`): a `compile` that never resolves, a dressing
queued, `disposeTile` called before the 3 s wait ends (use fake timers —
`net-gate.test.ts:30-35` shows `jest.useFakeTimers()` works here — or
set `COMPILE_WAIT_MS` through an existing hook if one exists; read
`withinCompileWait`), then advance past the wait and assert
`stream.dressings.size === 0` and the scene has no dressing children.

**Verify**: `bun test app/_components/tile-stream.test.ts` → pass.
Commit: `fix(stream): a tile released during its compile is never dressed after the wait`.

### Step 6: Beats after a stopped render do not count

In `create-app.ts`'s beat interval, pass `stopped` to the beat
(`trail.beat({ …, stopped })` — add `stopped?: boolean` to `TrailBeat` in
`lib/city/crash-trail.ts`), and in `pushBeat` also return early when
`beat.stopped` or when `beat.frames` did not advance since the previous
beat (compare with the last ring entry's `frames`). Keep the beat in the
ring (it is the record of what the page was doing); only the stats skip it.

Test (`lib/city/crash-trail.test.ts`, pure): two beats with the same
`frames` → `stats.beats` is 1; a beat with `stopped: true` → not counted.

**Verify**: `bun test lib/city/crash-trail.test.ts` → pass.
Commit: `fix(trail): a heartbeat after the render stopped is not a frame rate`.

### Step 7: `exitNow` restores the FOV

In `model-rig.ts`, `restorePerspective` takes the FOV to restore:
`exitNow` passes `entry?.state.fov` (read `enter()` for the exact field
holding the perspective pose's `fov`; if the dolly started from a pose
the rig captured, that pose's `fov` is the one) and `restorePerspective`
sets `c.fov = fov ?? c.fov` before `updateProjectionMatrix()`. If no pose
is held (exit from a settled Modell view), the camera's FOV must be the
one the pose module owns — read `applyCameraState`/`camera-pose.ts:696-699`
to see where it is restored on a normal exit and mirror it.

Test (`model-rig.test.ts`, following its existing construction): enter,
step the dolly a few frames (FOV changes), `exitNow()` → `camera.fov`
equals the FOV before `enter`.

**Verify**: `bun test app/_components/model-rig.test.ts` → pass.
Commit: `fix(model): leaving mid-dolly restores the field of view`.

### Step 8: A cancelled pointer is no tap

In `touch-controls.ts` `onPointerEnd`, before the tap logic:

```ts
    if (e.type === "pointercancel") {
      // The browser took the pointer (a system gesture, palm rejection):
      // the press is over, but it was no tap and no drag end.
      … the same cleanup the function does after the tap block (remove the
      pointer, reset `dragged`/`longPressed` when `pointers.size === 0`) …
      return;
    }
```

Read the whole function to copy the cleanup exactly (pointer map
deletion, `wasPair` → `onDragEnd`, the `dragged` reset).

Test (`touch-controls.test.ts`, following its existing event helpers): a
`pointerdown` then `pointercancel` within 100 ms → `onTap` not called,
`lastTap` not set (a following quick tap is a single tap, not a double).

**Verify**: `bun test app/_components/touch-controls.test.ts` → pass.
Commit: `fix(touch): a cancelled pointer never counts as a tap`.

### Step 9: The gate

`bun run fix && bun run verify` → exit 0.

## Test plan

- Step 1: two cases (bug vs allocation) in `tile-stream.test.ts`.
- Step 2: coalesced errors in `crash-trail.test.ts`.
- Step 5: released-during-compile in `tile-stream.test.ts`.
- Step 6: beats not counted in `lib/city/crash-trail.test.ts`.
- Step 7: FOV restored in `model-rig.test.ts`.
- Step 8: cancel is no tap in `touch-controls.test.ts`.
- Steps 3–4 have no unit seam until plan 066; the e2e smoke covers that
  the loop and the HUD still work.
- Verification: `bun run verify` → all pass, six+ new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "onDressingFailed" app/_components/tile-stream.ts app/_components/create-app.ts` → both match
- [ ] `grep -n '"dressing failed"' lib/city/crash-reports.ts` matches
- [ ] `grep -n "catch(() => {" app/_components/tile-stream.ts` → no match in `queueDressing`
- [ ] in `create-app.ts`, `setAnimationLoop`'s callback body is one `try { frame(time) } catch …`
- [ ] `grep -n "cut-out failed" app/_components/create-app.ts` matches
- [ ] `grep -n "reportedError\|reportedNetwork" app/_components/create-app.ts` → no match
- [ ] `grep -n "this.released.has(scene) ||" app/_components/tile-stream.ts` matches
- [ ] `grep -n "stopped" lib/city/crash-trail.ts` matches in `TrailBeat`/`pushBeat`
- [ ] `grep -n "pointercancel" app/_components/touch-controls.ts` shows the early return
- [ ] `bun run verify` exits 0 with the new tests
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 060 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `buildDressing` cannot be made to throw from a test without a renderer
  (report which dependency blocks it; then test step 1's `.catch` through
  a `queueDressing` seam the file already exposes, or mark the test
  deferred to plan 066).
- The frame body cannot be extracted without a behaviour change (e.g. a
  `return` inside it that the outer guard would change — look for early
  returns other than `pocFramesHeld`).
- `cuts.setCutOut`'s "off" path requires a HUD interaction you cannot call
  from the closure.
- `enter()` in `model-rig.ts` holds no perspective FOV to restore.
- Any existing test in the five test files fails after a step.

## Maintenance notes

- Every new *way a tile can be incomplete* (a builder, a compile, a fetch)
  must end in a trail note with a kind in `PROBLEM_KINDS` and, where the
  visitor can see a hole, in `onError` — step 1 is the template.
- The report field set is unchanged (a kind is a value of `kind`, already
  described on the privacy page as "welche Fehler er abgefangen hat"); a
  new *field* would need the page (ADR 0045).
- Plan 066 moves `stopRendering`/`onFrameFailed`/`memoryEmergency`/`onVisibility`
  into a pure machine: do this plan first, so the machine starts from the
  fixed behaviour.
- Reviewer: in step 2, check that `onFrameFailed` on a throw from
  `stream.tiles.update()` with a working GPU takes `"failed"` (same-level
  reload), not `"lost"` (a lighter device for days) — `frameLoss`'s
  `answers` probe decides it.
