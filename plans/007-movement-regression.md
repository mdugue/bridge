# Plan 007: Adaptive quality while the camera moves (movement regression)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 908ade3..HEAD -- app/_components/create-app.ts app/_components/post-stack.ts app/_components/fps-movement.ts lib/city`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (The open branch
> `claude/r3f-feasibility-check-9pac9i` — PR #20, the successor of the PR #16
> line — rewrites `create-app.ts` and `post-stack.ts` heavily and adds
> `vegetation-layer.ts`, `water-layer.ts`, `rail-layer.ts` and friends. If it
> has merged, stop and ask whether to port: the *idea* ports unchanged but
> every excerpt below will be wrong, and that branch adds continuously
> animating layers that change one of the assumptions in "Why this matters".)

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (Step 1–3) / MED (Step 4, optional)
- **Depends on**: plans/002-render-loop-quick-wins.md (landed — this plan
  assumes `shadowMap.autoUpdate = false` and the half-res transmission are
  already in place)
- **Category**: perf
- **Planned at**: commit `908ade3`, 2026-09-18

## Why this matters

`AGENTS.md` and finding #22 both say the same thing: **the bottleneck is
fill-rate — the post stack and the shadow map — not draw calls.** Plan 002
removed the per-frame *CPU* waste. What is left is the per-frame *GPU* cost,
and every pixel of it is paid at all times, including while the player is
walking and cannot resolve the detail they are paying for.

The post stack on the current head runs, every frame:

- `N8AOPostPass` — screen-space AO, the single most expensive pass
- `DepthOfFieldEffect` — on by default (`DEFAULT_DOF = true`), a CoC pass
  plus a bokeh blur
- `SMAAEffect` + depth grading + vignette + paper grain in one `EffectPass`

While the camera is translating or turning, the DoF blur and the AO contact
darkening are precisely the two signals the eye cannot resolve — motion is
already destroying that detail. Sketchfab and the pmndrs `<Canvas
performance>` regression system both exploit this: drop quality *during*
movement, restore it on settle. We get the same win with ~40 lines and no new
dependency.

**Why not react-three-fiber.** This pattern is r3f's `regress()`. Adopting
r3f to get it was evaluated and rejected — see "Findings considered and
rejected" in `plans/README.md`. The short version: r3f's frameloop is a bare
`requestAnimationFrame` with React out of the per-frame path, so it is
frame-for-frame identical to our `renderer.setAnimationLoop`; its advertised
scheduler win is time-slicing *component mounts*, which our imperative
loaders cannot use. The pattern is worth having; the reconciler is not.

**Relationship to finding #22.** #22 proposes a *static* quality tier
(`quality: "high" | "mobile"`) chosen once from the device. This plan is a
*transient* drop keyed to motion, on any device. They compose — a mobile tier
would simply regress from a lower ceiling — and neither blocks the other.
Do not implement #22 here.

## Current state

`app/_components/create-app.ts:510-522` — the whole loop. Note there is no
continuous animation left in it: with plan 002 landed, a stationary camera
produces a pixel-identical frame every time.

```ts
  const timer = new Timer();
  let tickDue = 0;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    movement.update(dt);
    if (timer.getElapsed() >= tickDue) {
      tickDue = timer.getElapsed() + 0.1;
      opts.onPose?.(getPose());
      updateFocus();
    }
    postStack.render(dt);
    tickPocFrame();
  });
```

`app/_components/create-app.ts:160` — the DPR lever for the optional Step 4:

```ts
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

`app/_components/fps-movement.ts:25-38` — `FpsMovement` exposes `getMode`,
`press`, `release`, `setAnalog`, `setMode`, `snapToGround`, `update`. It
does **not** expose "is the camera moving", and it does not know about
pointer-lock mouse-look or touch look at all — those move the camera
directly. So motion must be detected from the camera, not from the input
layer (see Step 2).

`app/_components/post-stack.ts:61,76-77,98-106` — the two passes are local
consts (`ao`, `dofPass`) inside `createPostStack`, and **both already use
`.enabled` as the user-intent flag**:

```ts
  const ao = new N8AOPostPass(scene, camera, size.x, size.y);
  const dofPass = new EffectPass(camera, dof);
  dofPass.enabled = DEFAULT_DOF;
  ...
    setDepthOfField: (enabled) => {
      dofPass.enabled = enabled;
    },
    setContactShadows: (strength) => {
      const s = Math.min(Math.max(strength, 0), 1);
      ao.configuration.intensity = s * AO_INTENSITY_MAX;
      ao.enabled = s > 0.01;
    },
```

That is the exact collision Step 3 has to avoid: regression cannot simply
write `.enabled`, because recovering would then overwrite the user's slider
choice (a player who set contact shadows to 0 would get AO back the moment
they stopped walking).

## Commands you will need

```bash
bun install
bun run verify        # lint + typecheck + test  (test = bun test ./lib ./app)
bun run build
bun run test:e2e
```

## Scope

**In scope**

- `lib/city/regression.ts` (new) + `lib/city/regression.test.ts` (new)
- `app/_components/post-stack.ts` — add a `setRegressed(on: boolean)` method
- `app/_components/create-app.ts` — detect motion, drive `setRegressed`
- `app/_components/poc-debug.ts` — expose the regression flag for the e2e

**Out of scope** — do not do these here

- A device/quality tier (finding #22)
- Render-on-demand / skipping frames entirely (rejected — see
  `plans/README.md`; also it would break `waitForFrames` in the e2e spec)
- Any change to `fps-movement.ts` or `touch-controls.ts`
- Re-tuning the DoF or AO defaults

## Git workflow

Branch from `main`, conventional-commit title (`perf: ...`), open a draft PR.
CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, build, e2e.

## Steps

### Step 1 — the pure state machine

Create `lib/city/regression.ts`. **`lib/city` is three-free and DOM-free**
(verified: no file under it imports `three`) — keep it that way. This is a
plain debounce:

```ts
/** Frames-of-motion → regressed; settles back after RECOVER_MS of stillness. */
export const RECOVER_MS = 250;

export interface RegressionState {
  regressed: boolean;
  stillMs: number;
}

export function createRegressionState(): RegressionState { ... }

/**
 * Advances the state. `moved` = the camera changed pose this frame.
 * Returns true when the caller should render at reduced quality.
 */
export function stepRegression(
  state: RegressionState,
  moved: boolean,
  dtMs: number,
  recoverMs = RECOVER_MS
): boolean { ... }
```

Semantics to implement and test:

- `moved === true` → `regressed = true`, `stillMs = 0` (regress immediately,
  on the first moving frame — a late regress is a visible hitch).
- `moved === false` → accumulate `stillMs += dtMs`; once
  `stillMs >= recoverMs`, `regressed = false`.
- A single still frame in the middle of movement must **not** recover
  (that is the whole point of the debounce).

Write `lib/city/regression.test.ts` covering: immediate regress; no recovery
before `recoverMs`; recovery exactly at/after `recoverMs`; a one-frame gap
mid-movement not recovering; `dtMs` of 0 being harmless.

### Step 2 — detect motion from the camera

In `create-app.ts`, inside `bootApp`, before the loop:

```ts
  const lastPos = camera.position.clone();
  const lastQuat = camera.quaternion.clone();
  const regression = createRegressionState();
```

In the loop, after `movement.update(dt)`:

```ts
    const moved =
      !camera.position.equals(lastPos) || !camera.quaternion.equals(lastQuat);
    lastPos.copy(camera.position);
    lastQuat.copy(camera.quaternion);
    postStack.setRegressed(stepRegression(regression, moved, dt * 1000));
```

**Why camera-derived and not input-derived**: this catches WASD, the virtual
joystick, pointer-lock mouse-look, touch look and `flyTo`/`teleportTo`
uniformly, with zero changes to the input layer. Exact `equals` is correct
here — we want "did anything at all change", and a resting camera in walk
mode is genuinely bit-stable once the ground smoothing settles. **Verify
that last claim in Step 5**; if the walk-mode ground smoothing never fully
settles, switch to `distanceToSquared(lastPos) > 1e-8` and an equivalent
quaternion epsilon, and say so in the status row.

`setRegressed` must be cheap to call every frame with an unchanged value —
make it an early return when the flag has not changed.

### Step 3 — the regression itself (the free levers)

In `post-stack.ts`, keep references to the AO pass and the DoF pass and add
to the `PostStack` interface:

```ts
  /** Reduced-quality mode while the camera moves (skips AO + DoF). */
  setRegressed: (on: boolean) => void;
```

Implement it by toggling `enabled` on `ao` and `dofPass` only. Two rules:

1. **It must not fight the sliders.** As quoted above, `setContactShadows`
   and `setDepthOfField` already own `.enabled`. Introduce two closure
   booleans (`aoWanted`, initialised from the AO default; `dofWanted`,
   initialised from `DEFAULT_DOF`), have those two setters write the
   booleans, and funnel every change through one helper that applies
   `ao.enabled = aoWanted && !regressed` and
   `dofPass.enabled = dofWanted && !regressed`. Keep
   `ao.configuration.intensity` on the slider path only — regression must
   not overwrite the intensity, or the user's value is lost on recovery.
2. **Do not touch the SMAA/grading/vignette/grain `EffectPass`.** Dropping
   AA during motion is very visible crawl, and the grain/vignette are the
   art direction — the look must not change, only its sharpness.

Leave `shadowMap` alone: plan 002 already made it on-demand, and regressing
it would force a re-render of the map on every settle, which is the opposite
of the intent.

### Step 4 — pixel-ratio drop (OPTIONAL — measure before keeping)

Only after Steps 1–3 are green, and only if a real-GPU look confirms it is
worth it. Lowering `renderer.setPixelRatio` mid-session forces the renderer
**and** the composer to reallocate every render target. Doing that on every
movement start/stop can cost more (allocation + GC hitches at the exact
moment the player starts moving) than the fill-rate it saves. If you try it:
call `renderer.setPixelRatio(...)` then `renderer.setSize(w, h)` then
`postStack.setSize(w, h)`, and hold the regressed DPR for at least ~1 s of
stillness before restoring, so a walking player does not thrash it.

**If it hitches, drop this step and record that in the status row** — Steps
1–3 are the plan; this is an experiment.

### Step 5 — expose it for QA

Add a `regressed: boolean` field to `PocDebugInfo` in `poc-debug.ts` and
update it from the loop (only when it changes). This makes the behaviour
assertable in the e2e and lets a maintainer confirm it in `bun dev` without
a profiler.

## Verification

```bash
bun run verify     # must pass
bun run build      # must pass
bun run test:e2e   # must pass
```

Manual check on a real GPU (needs a display — if the executing environment
has none, say so in the status row and leave this for the maintainer):

1. `bun dev`, stand still → `window.__poc.regressed === false`, DoF blur and
   contact shadows visible.
2. Hold `W` → `regressed` flips to `true` within one frame; the far blur and
   the AO darkening disappear; the image stays anti-aliased and keeps its
   grain/vignette.
3. Release `W` → within ~250 ms both come back, with no visible pop in
   exposure or colour.
4. Set the contact-shadow slider to 0, move and stop → AO stays off
   throughout (regression did not resurrect it).

## Repo rules that are easy to break

- `lib/city` is pure: **no `three` import, no DOM** in `regression.ts`.
- No `console.log` in committed code.
- Conventional Commits for the commit *and* the PR title (the
  `Conventional Commits` check gates the PR).
- `bun lint` is ultracite/biome with a complexity cap — extract a helper
  rather than growing the loop callback's branching.
- Anything that changes a data→feature transformation must update the docs;
  **this plan changes none**, so there is nothing to update there.

## Test plan

- Unit: `lib/city/regression.test.ts` as specified in Step 1 (the state
  machine is the only logic worth testing; the pass toggling is a WebGL
  concern and is covered by the e2e).
- E2E: extend `e2e/city-walk.spec.ts` — press `KeyW`, `waitForFrames(2)`,
  assert `__poc.regressed === true`; release, wait past the recover window,
  assert it is `false` again. Keep using `waitForFrames`, not sleeps.

## Done criteria

- `bun run verify`, `bun run build`, `bun run test:e2e` all green.
- Regression engages on the first moving frame and releases ~250 ms after
  the camera settles.
- User slider intent survives a regress/recover cycle (check 4 above).
- The still-frame image is unchanged from before this plan — same AA, same
  grain, same vignette, same colours.
- `plans/README.md` status row updated, including whether Step 4 was kept.

## STOP conditions

- The drift check shows `create-app.ts` or `post-stack.ts` changed since
  `908ade3` (PR #20 rewrites both) — stop and ask whether to port.
- A resting camera never reports `moved === false` (Step 2's assumption
  fails) and the epsilon fallback also does not settle — stop; the ground
  smoothing needs its own fix first, and that is plan 005 territory.
- Disabling the AO or DoF pass mid-run throws or produces a black frame —
  stop and report; that is a `postprocessing` ordering issue, not something
  to work around by rebuilding the composer per frame.
- Step 4 measurably hitches — drop Step 4, keep the rest, note it.

## Maintenance notes

If PR #20 lands, this plan's assumption that "a stationary camera produces a
pixel-identical frame" stops holding: that branch animates water ripple,
wind sway in the vegetation and cloud drift every frame. Regression still
works and is still worth having (those layers are exactly the kind of detail
motion hides), but the extra levers become interesting too — e.g. freezing
the wind/water clocks while regressed. Re-derive before extending.
