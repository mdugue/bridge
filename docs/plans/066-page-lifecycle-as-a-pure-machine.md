# Plan 066: The page's GPU-loss, memory-emergency and resume decisions are one pure machine with tests — `create-app.ts` keeps a thin binder

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- app/_components/create-app.ts lib/city/gpu-safety.ts lib/city/gpu-safety.test.ts app/_components/gpu-safety.ts app/_components/gpu-recovery.ts lib/city/memory-governor.ts lib/city/gpu-allocation.ts lib/city/boot-phases.ts`
> `create-app.ts` changes often: find the excerpts by text. Plan 060 edits
> these closures first (the frame guard, the beat, the cut-out); run this
> plan **after** 060 and take the closures as 060 left them.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (closure-capture order in `bootApp`; mitigated by moving
  behind a port with the binder as the only caller, and by the e2e
  recovery/HUD groups)
- **Depends on**: 060
- **Category**: tests (characterisation) + tech-debt
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

ADR 0046's safety ladder exists because a phone in a reload loop is the
worst failure this viewer has (the Sentry CITY-WALK-1…8 series). The
*policies* are pure and well tested — `lib/city/gpu-safety.ts`
(`frameLoss`, `raisedSafety`, `resolveSafety`, the recovery caps),
`app/_components/gpu-recovery.ts`, `lib/city/memory-governor.ts` — but the
*wiring* that decides which signal reaches which policy, in which order,
with which trail notes, is ≈ 130 lines of closures inside `bootApp`
(`create-app.ts`, 2 964 lines, 44 commits in the last week) over
`renderer`, `stream`, `governor`, `opts` and a dozen `let`s (`stopped`,
`resumedAt`, `lastEmergency`, `emergencyRaised`, `hiddenAt`,
`shadowHeldUntil`, `firstFrameShown`, `bootFailure`, `disposed`). Nothing
tests it: the e2e never loses a device, never fires an allocation error,
never hides the page. The five fixes of 2026-10-06 (`e377633` one raise
per incident, `b3b0534` failed frames classified, `2abdf3d` the page's
end, `0ec8bfe` the healer, `75d0a06` the pill) each changed an edge here
with nothing to pin it, and plan 060 adds three more edits.

This plan lifts the decisions into `lib/city/page-lifecycle.ts`: a pure
machine that takes signals (`deviceLost`, `frameFailed`, `allocationFailed`,
`hidden`, `shown`, `dispose`) and a clock, holds the state, and returns
*effects* (`stopRender`, `note(kind, detail)`, `reload(how)`, `fatal(message)`,
`shed`, `governorForce`, `holdShadows(ms)`, `raise`) — the same pattern as
`lib/city/boot-phases.ts`. `create-app.ts` keeps a binder that feeds the
signals and executes the effects against the renderer, the stream and
the HUD. The behaviour is unchanged; the tests name the incident
sequences the commit messages describe.

## Current state

(Excerpts at `4b0310a`; plan 060 changes the frame guard around them, not
these lines.)

`create-app.ts:2221-2268` — `stopped`, `resumedAt`, `lossNow`, `stopRendering`:

```ts
  let stopped = false;
  let resumedAt = Number.NEGATIVE_INFINITY;
  /** How a GPU that fails now went: in the background, or in use. */
  const lossNow = (): GpuLoss =>
    document.hidden || performance.now() - resumedAt < RESUME_WINDOW_MS
      ? "reclaimed"
      : "lost";
  const stopRendering = (message: string, how: GpuLoss = "lost", detail = message) => {
    if (stopped) {
      return;
    }
    stopped = true;
    void renderer.setAnimationLoop(null);
    opts.trail?.note("render stopped", message);
    if (how === "reclaimed") {
      opts.trail?.note("gpu reclaimed", detail);
    }
    if (disposed) {
      return;
    }
    const reload = opts.onGpuLost?.(how);
    if (reload) {
      opts.trail?.note("reloading", `to recover the GPU (${how})`);
      void releaseGpu(renderer).then(() => whenVisible(reload));
      return;
    }
    opts.trail?.note("gpu failed", `${how}: ${message}`);
    const failed = `Die Grafik ist ausgefallen (${message}). Bitte neu laden.`;
    if (!firstFrameShown) {
      bootFailure ??= new Error(failed);
      return;
    }
    opts.onFatal?.(message);
  };
```

`:2271-2287` — the renderer hooks (`onDeviceLost` → `stopRendering(info.message, lossNow())`;
`onError` with `type === "GPUOutOfMemoryError"` → `memoryEmergency(message)`).

`:2297-2314` — `onFrameFailed(error)`: `frameLoss(lossNow(), { allocation: isAllocationFailure(error), emergency: lastEmergency !== -Infinity, answers: () => probeGpu(renderer) === null })`,
a `"frame failed"` note unless reclaimed, then `stopRendering(message, how, …)`.

`:2570-2612` — the emergency:

```ts
  let emergencyRaised = false;
  let lastEmergency = Number.NEGATIVE_INFINITY;
  let shadowResume: ReturnType<typeof setTimeout> | undefined;
  const memoryEmergency = (reason: string): void => {
    const now = performance.now();
    if (disposed || stopped || now - lastEmergency < EMERGENCY_GAP_MS) {
      return;
    }
    lastEmergency = now;
    opts.trail?.note("memory emergency", reason);
    const step = governor.force(3, renderer.info.memory.total, now);
    shedUnusedTiles(stream.tiles.lruCache);
    applyStep(step ?? governor.step());
    shadowHeldUntil = Math.max(shadowHeldUntil, now + EMERGENCY_SHADOW_HOLD_MS);
    streamShadowTiles(sunUp);
    clearTimeout(shadowResume);
    shadowResume = setTimeout(() => streamShadowTiles(sunUp), EMERGENCY_SHADOW_HOLD_MS + GOVERN_MS);
    if (!emergencyRaised && lossNow() === "lost") {
      emergencyRaised = true;
      raiseSafety(budget.safety, { by: opts.trail?.startedAt });
    }
  };
```

`:2614-2650` — the resume guard (`hiddenAt`, `onVisibility`: hidden → shed
on a phone; shown → `applyStep`, `resumedAt` after `RESUME_AWAY_MS`,
`probeGpu` → `stopRendering(failure, "reclaimed")`).

Constants: `EMERGENCY_SHADOW_HOLD_MS = 120_000` (`:191`), `EMERGENCY_GAP_MS = 5000`
(`:193`), `GOVERN_MS = 1000` (`:197`) in `create-app.ts`;
`RESUME_AWAY_MS = 10_000`, `RESUME_WINDOW_MS = 5000`, `GpuLoss`, `frameLoss`
in `lib/city/gpu-safety.ts:218-252`. `raiseSafety` is
`app/_components/gpu-safety.ts` (local storage); `probeGpu` (`:696`) and
`releaseGpu` (`:723`) are module functions of `create-app.ts`;
`whenVisible` (`:742`); `shedding`, `applyStep` (`:2548-2549`).

The pattern to copy: `lib/city/boot-phases.ts` (pure state + `createBootPhases()`
returning methods; its test `lib/city/boot-phases.test.ts` drives it with
events and asserts the state and the effects it returns).

The tests that already exist for the policies: `lib/city/gpu-safety.test.ts`
(`frameLoss` at `:186-190`, `mayRecover`, `startTileOf`),
`app/_components/gpu-recovery.test.ts`, `lib/city/memory-governor.test.ts`.

Conventions: `lib/city` is pure and DOM-free (no `document`, no
`performance`: the clock and `hidden` are inputs); TypeScript strict; the
complexity cap 20 (the machine's `dispatch` may need per-signal helpers);
tests with `bun:test`; Conventional Commits (`refactor(viewer): …`,
`test(viewer): …`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| New tests | `bun test lib/city/page-lifecycle.test.ts` | pass |
| Typecheck | `bun typecheck` | exit 0 |
| The gate | `bun run verify` | exit 0 |
| e2e (recovery, HUD) | `bun run test:e2e --grep "@desktop-render\|@phone"` | pass (slow) |

## Scope

**In scope** (the only files you should modify):
- `lib/city/page-lifecycle.ts` (create), `lib/city/page-lifecycle.test.ts` (create)
- `app/_components/create-app.ts` (the closures above become the binder)
- `docs/rendering.md` (one sentence in the GPU-loss paragraph naming the module)
- `AGENTS.md` (the `lib/city/` bullet gains `page-lifecycle.ts`)

**Out of scope** (do NOT touch, even though they look related):
- `lib/city/gpu-safety.ts`, `gpu-recovery.ts`, `memory-governor.ts` — the
  policies stay where they are; the machine calls them (or returns
  effects the binder calls them with).
- The boot's own machine (`boot-phases.ts`), the network watch
  (`tile-retry.ts`), the telemetry and picking (plan 046 step 2).
- The HUD's failure card and `onGpuLost`'s reload (unchanged signatures).
- `whenVisible`, `probeGpu`, `releaseGpu` — they stay in `create-app.ts`
  as the binder's effect executors.

## Git workflow

- Branch: the branch you were given, or `plan/066-page-lifecycle`.
- Three commits: the machine with its tests, the binder, the docs.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The machine

Create `lib/city/page-lifecycle.ts`:

```ts
import {
  frameLoss,
  type GpuLoss,
  RESUME_AWAY_MS,
  RESUME_WINDOW_MS,
} from "./gpu-safety";

/** What the page hears. `now` is the monotonic clock (ms); `wall` the
 *  wall clock (ms) — iOS stops the monotonic one while the device sleeps,
 *  so the time away is measured on the wall. */
export type LifecycleSignal =
  | { kind: "deviceLost"; message: string; now: number; hidden: boolean }
  | { kind: "frameFailed"; message: string; where: string; allocation: boolean; gpuAnswers: boolean; now: number; hidden: boolean }
  | { kind: "allocationFailed"; reason: string; now: number; hidden: boolean }
  | { kind: "hidden"; wall: number; phone: boolean }
  | { kind: "shown"; wall: number; now: number; gpuFailure: string | null }
  | { kind: "firstFrame" }
  | { kind: "dispose" };

/** What the page then does, in order. */
export type LifecycleEffect =
  | { kind: "note"; event: string; detail?: string }
  | { kind: "stopRender" }
  | { kind: "reload"; how: GpuLoss }
  | { kind: "fatal"; message: string; beforeFirstFrame: boolean }
  | { kind: "shed" }
  | { kind: "governorForce"; now: number }
  | { kind: "applyStep" }
  | { kind: "holdShadows"; untilNow: number }
  | { kind: "raiseSafety" };

export interface LifecycleOptions {
  emergencyGapMs: number;      // EMERGENCY_GAP_MS
  shadowHoldMs: number;        // EMERGENCY_SHADOW_HOLD_MS
  /** whether a reload is available for this loss (gpu-recovery's answer) */
  mayReload: (how: GpuLoss) => boolean;
}

export interface PageLifecycle {
  dispatch(signal: LifecycleSignal): LifecycleEffect[];
  readonly stopped: boolean;
  /** "lost" or "reclaimed" for a failure now (the resume window) */
  lossNow(now: number, hidden: boolean): GpuLoss;
  readonly emergencyBefore: boolean;
}

export function createPageLifecycle(opts: LifecycleOptions): PageLifecycle { … }
```

Implement `dispatch` so that it reproduces the closures **exactly**
(read them line by line; the effects' order is the trail's order):

- `deviceLost` → the `stopRendering(message, lossNow())` sequence: if
  stopped → `[]`; else `stopRender`, `note("render stopped", message)`,
  (`note("gpu reclaimed", …)` when reclaimed), then if disposed → done;
  `mayReload(how)` → `note("reloading", …)`, `reload(how)`; else
  `note("gpu failed", …)` and `fatal(message, beforeFirstFrame)`.
- `frameFailed` → `how = frameLoss(lossNow, { allocation, emergency: emergencyBefore, answers: () => !gpuAnswers })`;
  `note("frame failed", …)` unless reclaimed; then the stop sequence.
  (Keep `frameLoss`'s `answers` lazy: pass a function that returns the
  signal's `gpuAnswers` — the binder probes the GPU before dispatching
  only when the other signs do not decide; read `frameLoss` to see
  whether it calls `answers` unconditionally; if it does, the binder may
  probe eagerly and the field is a boolean.)
- `allocationFailed` → the emergency: if disposed/stopped/within the gap
  → `[]`; else `note("memory emergency", reason)`, `governorForce(now)`,
  `shed`, `applyStep`, `holdShadows(now + shadowHoldMs)`, and — once per
  page and only when `lossNow === "lost"` — `raiseSafety`.
- `hidden` → remember `hiddenAt = wall`; if `phone` → `shed`, `applyStep`.
- `shown` → `applyStep`; if `wall - hiddenAt >= RESUME_AWAY_MS` →
  `resumedAt = now`; if `gpuFailure !== null` → the stop sequence with
  `"reclaimed"`.
- `firstFrame` → `firstFrameShown = true` (decides `fatal.beforeFirstFrame`).
- `dispose` → `disposed = true`.

The shadow-resume `setTimeout` stays in the binder (it is a timer, not a
decision): the machine returns `holdShadows`, the binder schedules the
resume.

**Verify**: `bun typecheck` → exit 0.

### Step 2: The tests name the incidents

Create `lib/city/page-lifecycle.test.ts`. Table-test with a fresh machine
per case, `mayReload` as a recording stub, and assert the **effect kinds
in order** plus the state. Cases (the commit messages of 2026-10-06 are
the spec):

1. **A device lost in use, reload available** → `stopRender, note(render stopped), note(reloading), reload(lost)`; `stopped` true; a second signal → `[]`.
2. **A device lost while hidden** → `… note(gpu reclaimed) …`, `reload(reclaimed)`.
3. **A device lost within 5 s of a return from 10 s+ away** (`hidden` at wall 0, `shown` at wall 20 000 / now 100, `deviceLost` at now 2 000) → reclaimed.
4. **A failed frame on a working GPU, no signs** → `frameLoss` → `"failed"`; `note(frame failed)` then reload with `how: "failed"` (a same-level reload, never a lighter device: assert no `raiseSafety` anywhere).
5. **An allocation failure then a failed frame** → the emergency's effects, then the frame's loss is `"lost"` (the "emergency before it" sign) — one `raiseSafety` only (from the emergency; the loss renews rather than adds).
6. **Two allocation failures 1 s apart** → the second returns `[]` (the gap).
7. **An allocation failure while hidden** → no `raiseSafety` (reclaim symptom).
8. **A failed frame before the first frame** → `fatal.beforeFirstFrame === true` (the boot fails instead of the card).
9. **`dispose` then anything** → stop sequence ends after the notes (no reload, no fatal).
10. **`hidden` on a phone** → `shed, applyStep`; on a desktop → `[]`.

**Verify**: `bun test lib/city/page-lifecycle.test.ts` → 10 pass.

### Step 3: The binder

In `create-app.ts`, replace the closures with a `lifecycle = createPageLifecycle({ emergencyGapMs: EMERGENCY_GAP_MS, shadowHoldMs: EMERGENCY_SHADOW_HOLD_MS, mayReload: (how) => Boolean(reloadFor(how)) })`
— where `reloadFor` captures `opts.onGpuLost?.(how)` once per stop (it
returns the reload thunk or undefined; keep its single call per loss, as
today) — and one `run(effects)` that executes each effect against the
existing helpers: `note` → `opts.trail?.note`, `stopRender` →
`renderer.setAnimationLoop(null)`, `reload` → `releaseGpu(renderer).then(() => whenVisible(reload))`,
`fatal` → `bootFailure ??= new Error(…)` or `opts.onFatal`, `shed` →
`shedUnusedTiles(stream.tiles.lruCache)`, `governorForce` →
`governor.force(3, renderer.info.memory.total, now)` (its returned step
feeds the following `applyStep`), `applyStep` → `applyStep(step ?? governor.step())`,
`holdShadows` → `shadowHeldUntil = max(…)`, `streamShadowTiles(sunUp)` and
the resume timer, `raiseSafety` → `raiseSafety(budget.safety, { by: opts.trail?.startedAt })`.

The signal sources: `renderer.onDeviceLost` → `deviceLost`; `renderer.onError`
with `GPUOutOfMemoryError` → `allocationFailed`; `onFrameFailed` →
`frameFailed` (with `allocation: isAllocationFailure(error)`, `gpuAnswers: probeGpu(renderer) === null`
— or lazy, per step 1); `onAllocationFailure` from the stream →
`allocationFailed`; `visibilitychange` → `hidden`/`shown` (with
`gpuFailure: probeGpu(renderer)` on show); the first frame → `firstFrame`;
`dispose()` → `dispose`. `stopped` reads become `lifecycle.stopped`;
`lossNow()` reads (the emergency's raise, elsewhere) become
`lifecycle.lossNow(performance.now(), document.hidden)`.

Delete the `let`s the machine now owns (`stopped`, `resumedAt`,
`lastEmergency`, `emergencyRaised`, `hiddenAt`); keep `shadowHeldUntil`,
`firstFrameShown` and `bootFailure` if other code reads them (grep), else
move them too.

**Verify**: `bun typecheck` → exit 0; `bun lint` → exit 0 (the binder's
`run` switch may need `switch-exhaustiveness-check` satisfied — a
`default: never` guard); `bun run test:e2e --grep "@desktop-render|@phone"` → pass.

### Step 4: Docs

`docs/rendering.md`: in the paragraph on a lost GPU / the safety ladder
(grep "gpu-recovery"), add "the decisions — what a lost device, a failed
frame, an allocation failure, a hidden or shown page lead to — are one
pure machine, `lib/city/page-lifecycle.ts`, tested by the incident
sequences in its test; `create-app.ts` binds its signals and effects".
AGENTS.md `lib/city/` bullet: add "`page-lifecycle.ts` (the page's
GPU-loss, memory-emergency and resume decisions as effects — ADR 0046)".

**Verify**: `bun test lib/docs` → pass.

### Step 5: The gate

`bun run fix && bun run verify` → exit 0.

## Test plan

- `lib/city/page-lifecycle.test.ts`: the ten incident sequences above.
- The e2e recovery/HUD groups: the wiring still works.
- Verification: `bun run verify` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `lib/city/page-lifecycle.ts` exports `createPageLifecycle`, `LifecycleSignal`, `LifecycleEffect`
- [ ] `grep -n "document\|performance\|window\|localStorage" lib/city/page-lifecycle.ts` → no match (pure)
- [ ] `bun test lib/city/page-lifecycle.test.ts` → ≥ 10 pass
- [ ] `grep -n "let stopped\|let resumedAt\|let lastEmergency\|let emergencyRaised\|let hiddenAt" app/_components/create-app.ts` → no match
- [ ] `grep -n "createPageLifecycle" app/_components/create-app.ts` matches
- [ ] `wc -l app/_components/create-app.ts` is smaller than before by ≥ 80 lines
- [ ] `bun run test:e2e --grep "@desktop-render|@phone"` passes
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 066 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 060 has not landed (its row in the index is not DONE): the
  closures differ from the excerpts; do 060 first.
- A closure reads something the machine cannot receive as a signal field
  (report it; do not import a DOM API into `lib/city`).
- The effects' order would have to differ from the closures' trail-note
  order to type-check (the order is the record Sentry reads: keep it and
  report the conflict).
- The e2e recovery group fails after step 3 and the cause is not a
  binder typo you can see (report the failing spec and the trail output).

## Maintenance notes

- Every new lifecycle decision is a signal/effect pair in the machine
  with a test case here; the binder only maps names. A decision that
  needs the DOM is a binder concern (a new signal field), never a machine
  import.
- `frameLoss`'s "emergency before it" sign has no time window (known;
  index: rejected list) — case 5 pins the current behaviour; if a window
  is ever added, that case changes.
- Plan 046's "telemetry and picking out of `bootApp`" is the sibling move;
  the three together are what the backlog's item 14 asked for.
- Reviewer: diff the trail-note sequence of a device loss before and
  after (the `note` effects, in order) — it must be identical.
