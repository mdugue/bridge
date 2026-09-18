# Plan 005: Fix input and collision defects — stuck keys, diagonal speed, pinch baseline, inserted building, failure-path cleanup

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8075a21..HEAD -- app/_components/fps-movement.ts app/_components/fps-movement.test.ts app/_components/create-app.ts app/_components/touch-controls.ts app/_components/touch-controls.test.ts app/_components/collision.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (PR #16 rewrites `create-app.ts`;
> if it has merged, stop and ask whether to port — Steps 1 and 3 are
> independent of it, Steps 2, 4 and 5 are not.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (Step 5 restructures teardown)
- **Depends on**: plans/001-test-baseline-and-real-e2e-frames.md (test glob + `fps-movement.test.ts`)
- **Category**: bug
- **Planned at**: commit `8075a21`, 2026-09-18

## Why this matters

Five confirmed defects, all in the input/collision layer, each small:

1. **Keys stick when the window loses focus.** `keydown`/`keyup` are bound
   to `document` and the held-key `Set` is only cleared by a matching
   `keyup`. Alt-Tab while holding `W` delivers the `keyup` elsewhere; the
   camera walks forever. Holding `R` also repeats the demolish action on
   every key-repeat event (each one re-parses the tile, ~0.5 s).
2. **Diagonal and stacked input is faster than walking.** `W+D` moves
   `step·√2` (41 % faster); joystick + key stacks to `2·step`. The collision
   ray budget is computed from the larger step, so the player can push
   further into a facade before being stopped.
3. **Pinch baseline goes stale with a third finger.** The pinch start
   distance is captured only when the second pointer goes down; lifting one
   of three fingers leaves two pointers with a baseline from a different
   pair, so the FOV jumps.
4. **The inserted building is a ghost.** It is added to `scene`, outside the
   city group that collision and DoF autofocus raycast, so the player walks
   through it and the camera never focuses on it; and if the glTF finishes
   loading after `dispose()`, the loaded object is dropped without disposal.
5. **A failed boot leaks GPU resources.** `createCityWalkApp`'s catch only
   disposes the scene and renderer; the post stack (half-float render
   targets), style materials, pointer-lock controls, touch/keyboard
   listeners and the resize observer created inside `bootApp` are not
   reachable from it. Any throw after `createStyleResources()` (including
   a StrictMode abort at the wrong moment) leaks them.

Not a defect (checked and rejected): "the collider can lock the player
inside a building". All city materials use three's default `FrontSide`, so
the collision ray never hits back faces; a player teleported inside a shell
walks out. Do not add back-face handling.

## Current state

Excerpt — `app/_components/fps-movement.ts:61-86` (input accumulation):

```ts
  /** Accumulates the proposed horizontal step into `displacement`. */
  const horizontalStep = (step: number): Vector3 => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    displacement.set(0, 0, 0);
    if (keys.has("KeyW")) {
      displacement.addScaledVector(forward, step);
    }
    if (keys.has("KeyS")) {
      displacement.addScaledVector(forward, -step);
    }
    if (keys.has("KeyD")) {
      displacement.addScaledVector(right, step);
    }
    if (keys.has("KeyA")) {
      displacement.addScaledVector(right, -step);
    }
    if (analogX !== 0 || analogY !== 0) {
      displacement.addScaledVector(forward, step * analogY);
      displacement.addScaledVector(right, step * analogX);
    }
    return displacement;
  };
```

and the returned object (lines 123–141) exposes `update, press, release,
setAnalog, getMode, setMode, snapToGround`; the `FpsMovement` interface is
at lines 25–38. Constants: `WALK_SPEED = 9`, `SPRINT_FACTOR = 3`, `FLY_SPEED = 35`.

Excerpt — `app/_components/create-app.ts:440-462` (desktop input) and `545-559` (dispose):

```ts
  const onKeyDown = (e: KeyboardEvent) => {
    movement.press(e.code);
    if (e.code === "KeyR") {
      demolishAtCrosshair();
    }
    if (e.code === "KeyB") {
      insertBuildingNow();
    }
    if (e.code === "KeyF") {
      setMovementMode(movement.getMode() === "walk" ? "fly" : "walk");
    }
  };
  const onKeyUp = (e: KeyboardEvent) => movement.release(e.code);
  // Mouse wheel zooms like pinch (FOV); immersive pointer lock is opt-in
  // via the handle, so plain clicks/drags stay free for grab-look.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.fov = nextFov(camera.fov, e.deltaY < 0 ? 1.05 : 1 / 1.05);
    camera.updateProjectionMatrix();
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
// ...
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      detachTouch();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      controls.dispose();
      postStack.dispose();
      disposeObject3D(scene);
      styleResources.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
```

Excerpt — `app/_components/create-app.ts:223-242` (the failure path):

```ts
export async function createCityWalkApp(
  opts: CityWalkOptions
): Promise<CityWalkHandle> {
  const renderer = createRenderer(opts.container);
  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  const fogRange = fogRangeFor(DEFAULT_ATMOSPHERE);
  scene.fog = new Fog(SKY_COLOR, fogRange.near, fogRange.far);

  try {
    return await bootApp(opts, renderer, scene);
  } catch (err) {
    // Centralized teardown: covers both abort (StrictMode remount) and real
    // load failures — otherwise the dead canvas would linger in the DOM.
    disposeObject3D(scene);
    renderer.dispose();
    renderer.domElement.remove();
    throw err;
  }
}
```

Inside `bootApp` the disposables are created in this order:
`createStyleResources()` (line 299), `createPostStack(...)` (302),
`new PointerLockControls(...)` (309), `createCityCollider(() => cityLayer.group)` (315),
`attachTouchControls(...)` → `detachTouch` (366), the three listeners (460–462),
`new ResizeObserver(...)` (464–470), `renderer.setAnimationLoop(...)` (487).
`let disposed = false;` is declared at line 250; `let inserted: Object3D | null = null;`
at line 416, AFTER the collider is created.

Excerpt — `create-app.ts:416-432` (`insertBuilding`; after plan 002 there is
also an `invalidateShadows();` call after `scene.add(obj);`):

```ts
  let inserted: Object3D | null = null;
  const insertBuilding = async () => {
    const at = opts.insertAt ?? DEFAULT_INSERT_AT;
    const obj = await createInsertedBuilding(opts.insertedModelUrl);
    if (disposed) {
      return;
    }
    if (inserted) {
      scene.remove(inserted);
      disposeObject3D(inserted);
    }
    const ground = terrain.heightAt(at.x, at.y) ?? worldBounds.min.y;
    // Data frame (x, y, z-up) -> scene frame (x, z, -y), recentered.
    obj.position.set(at.x - offset.cx, ground, -(at.y - offset.cy));
    scene.add(obj);
    inserted = obj;
  };
```

Excerpt — `create-app.ts:472-483` (`updateFocus`; unchanged by plan 002):

```ts
  // Crosshair autofocus for the photographic DoF (throttled like the pose).
  const focusRaycaster = new Raycaster();
  focusRaycaster.firstHitOnly = true;
  focusRaycaster.far = 4000;
  const updateFocus = () => {
    focusRaycaster.setFromCamera(new Vector2(0, 0), camera);
    const hit = focusRaycaster.intersectObjects(
      [cityLayer.group, terrain.mesh],
      true
    )[0];
    postStack.setFocusTarget(hit?.point ?? null);
  };
```

Excerpt — `app/_components/collision.ts:41-67`:

```ts
export function createCityCollider(getCity: () => Object3D): CityCollider {
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const normalMatrix = new Matrix3();
  const dir = new Vector3();
  const origin = new Vector3();

  /** World-space wall normal when the step is blocked, else null. */
  const blockingNormal = (
    position: Vector3,
    displacement: Vector3
  ): Vector3 | null => {
    const distance = displacement.length();
    dir.copy(displacement).normalize();
    raycaster.far = distance + BODY_RADIUS;
    for (const drop of [0, KNEE_DROP]) {
      origin.copy(position);
      origin.y -= drop;
      raycaster.set(origin, dir);
      const hit = raycaster.intersectObject(getCity(), true)[0];
      if (hit?.face) {
        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      }
    }
    return null;
  };
```

Excerpt — `app/_components/touch-controls.ts:57-78` and `102-133`:

```ts
  const onPointerDown = (e: PointerEvent) => {
    if (!acceptsPointer(e)) {
      return;
    }
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) carry pointer ids unknown to the browser.
    }
    pointers.set(e.pointerId, {
      startTime: e.timeStamp,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
    });
    dragged = pointers.size > 1 ? true : dragged;
    if (pointers.size === 2) {
      pinchStartDistance = pinchDistance();
      callbacks.onPinchStart();
    }
  };
// ...
  const onPointerEnd = (e: PointerEvent) => {
    const state = pointers.get(e.pointerId);
    if (!state) {
      return;
    }
    pointers.delete(e.pointerId);
    const isTap =
      !dragged &&
      pointers.size === 0 &&
      e.timeStamp - state.startTime <= TAP_MAX_DURATION_MS;
    if (isTap) {
      // ... double-tap detection, unchanged ...
    }
    if (pointers.size === 0) {
      dragged = false;
      pinchStartDistance = 0;
    }
  };
```

`acceptsPointer` (lines 35–41) returns `true` immediately for
`pointerType === "touch" | "pen"` and only consults `document` for mouse
pointers — so touch-only tests need no DOM. `onPointerEnd` calls
`element.getBoundingClientRect()` only when a double tap fires.

Conventions: `bun:test` colocated tests with hand-built fixtures; existing
comment style ("why", not "what"); Conventional Commits; no `console.log`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Fast gate | `bun run verify` | exit 0 (lint + typecheck + unit) |
| Single test file | `bun test app/_components/<file>.test.ts` | all pass |
| E2E | `bun run test:e2e` | 3 passed |
| Build | `bun run build` | exit 0 |

## Scope

**In scope**:
- `app/_components/fps-movement.ts`, `app/_components/fps-movement.test.ts` (extend; created by plan 001)
- `app/_components/create-app.ts`
- `app/_components/touch-controls.ts`, `app/_components/touch-controls.test.ts` (create)
- `app/_components/collision.ts`
- `plans/README.md` (status row)

**Out of scope**:
- `lib/city/collision.ts` (`horizontalSlide`) and its test — the slide math is correct.
- `app/_components/virtual-joystick.tsx` — the joystick already clamps to the unit circle.
- The handle's public method names and `window.__poc` (e2e depends on them).
- Pointer-lock / `PointerLockControls` behaviour.
- Any speed constant (`WALK_SPEED`, `SPRINT_FACTOR`, `FLY_SPEED`).

## Git workflow

- Branch: `advisor/005-input-and-collision-correctness` from `main`.
- One commit per step.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Unit-length input and `releaseAll` in `fps-movement.ts`

Rewrite `horizontalStep` so keys and stick combine into one 2D input
vector that is clamped to unit length, then scaled by `step`:

```ts
  /** Proposed horizontal step: keys + stick combined, never faster than `step`. */
  const horizontalStep = (step: number): Vector3 => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    let ix = analogX;
    let iy = analogY;
    if (keys.has("KeyW")) {
      iy += 1;
    }
    if (keys.has("KeyS")) {
      iy -= 1;
    }
    if (keys.has("KeyD")) {
      ix += 1;
    }
    if (keys.has("KeyA")) {
      ix -= 1;
    }
    // Diagonals and stacked stick+key input move at walking speed, not √2×
    // or 2× — this also keeps the collision ray budget honest.
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    displacement.set(0, 0, 0);
    displacement.addScaledVector(forward, step * iy);
    displacement.addScaledVector(right, step * ix);
    return displacement;
  };
```

Add to the `FpsMovement` interface and the returned object:

```ts
  /** Drops every held key and the stick — call when the window loses focus. */
  releaseAll: () => void;
// ...
    releaseAll: () => {
      keys.clear();
      analogX = 0;
      analogY = 0;
    },
```

Extend `app/_components/fps-movement.test.ts` with:

1. `KeyW` + `KeyD` + `update(1)` → displacement length ≈ 9 (`Math.hypot(x, z)`), with `x ≈ 6.364` and `z ≈ -6.364`.
2. `KeyW` + `setAnalog(0, 1)` + `update(1)` → `z ≈ -9` (not −18).
3. `setAnalog(0.5, 0)` alone → `x ≈ 4.5` (sub-unit input is not normalised up).
4. `press("KeyW")`, `setAnalog(1, 0)`, `releaseAll()`, `update(1)` → position unchanged.

**Verify**: `bun test app/_components/fps-movement.test.ts` → all pass (10 from plan 001 + 4).

Commit: `fix: unit-length movement input and releaseAll for focus loss`.

### Step 2: Focus-loss reset, no key repeat, no keys from text fields

In `bootApp` (`create-app.ts`), replace the two key handlers with:

```ts
  const isTextEntry = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select"));
  const onKeyDown = (e: KeyboardEvent) => {
    // Held keys auto-repeat; the Set is idempotent for movement and the
    // one-shot actions (R re-parses the tile) must fire once per press.
    if (e.repeat || isTextEntry(e.target)) {
      return;
    }
    movement.press(e.code);
    if (e.code === "KeyR") {
      demolishAtCrosshair();
    }
    if (e.code === "KeyB") {
      insertBuildingNow();
    }
    if (e.code === "KeyF") {
      setMovementMode(movement.getMode() === "walk" ? "fly" : "walk");
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!isTextEntry(e.target)) {
      movement.release(e.code);
    }
  };
  // A keyup delivered to another window would leave the key held forever.
  const onFocusLost = () => movement.releaseAll();
  const onVisibility = () => {
    if (document.hidden) {
      movement.releaseAll();
    }
  };
```

Register `window.addEventListener("blur", onFocusLost)` and
`document.addEventListener("visibilitychange", onVisibility)` next to the
existing listener registrations. Then:

- Add `window.removeEventListener("blur", onFocusLost);` and
  `document.removeEventListener("visibilitychange", onVisibility);` to the
  handle's `dispose` right after the existing `keyup` removal. This is
  required even if you stop before Step 5; Step 5 moves these removals into
  the cleanup list.

**Verify**: `bun typecheck` → exit 0; `grep -c "releaseAll" app/_components/create-app.ts` → `2`.

Commit: `fix: release held keys on focus loss and ignore key repeat`.

### Step 3: Pinch baseline follows the pointer set

In `touch-controls.ts`, add inside `attachTouchControls`:

```ts
  /** Re-anchors the pinch whenever exactly two pointers remain. */
  const syncPinchBaseline = () => {
    if (pointers.size === 2) {
      pinchStartDistance = pinchDistance();
      callbacks.onPinchStart();
    } else {
      pinchStartDistance = 0;
    }
  };
```

In `onPointerDown`, replace the `if (pointers.size === 2) { … }` block with
`syncPinchBaseline();`. In `onPointerEnd`, call `syncPinchBaseline();`
immediately after `pointers.delete(e.pointerId);` and delete the
`pinchStartDistance = 0;` line from the `pointers.size === 0` block (keep
`dragged = false;` there).

Create `app/_components/touch-controls.test.ts`. No DOM: a fake element
records listeners and replays them.

```ts
import { expect, test } from "bun:test";
import { attachTouchControls, type TouchControlsCallbacks } from "./touch-controls";

function harness() {
  const handlers = new Map<string, (e: PointerEvent) => void>();
  const element = {
    addEventListener: (type: string, fn: (e: PointerEvent) => void) => handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  } as unknown as HTMLElement;
  const calls = { look: [] as [number, number][], pinchStart: 0, pinch: [] as number[], doubleTap: [] as [number, number][] };
  const callbacks: TouchControlsCallbacks = {
    onLook: (dx, dy) => calls.look.push([dx, dy]),
    onPinchStart: () => { calls.pinchStart += 1; },
    onPinch: (r) => calls.pinch.push(r),
    onDoubleTap: (x, y) => calls.doubleTap.push([x, y]),
  };
  const detach = attachTouchControls(element, callbacks);
  const fire = (type: string, e: { pointerId: number; clientX: number; clientY: number; timeStamp?: number }) =>
    handlers.get(type)?.({ pointerType: "touch", button: 0, timeStamp: 0, ...e } as unknown as PointerEvent);
  return { fire, calls, detach };
}
```

Cases:

1. One touch down then two moves → `onLook` receives per-event deltas (`[10, 0]` then `[5, -3]`), not cumulative.
2. Two touches at distance 100 → `pinchStart === 1`; move one to distance 200 → last `onPinch` ratio ≈ 2.
3. **Regression**: three touches down (A at (0,0), B at (100,0), C at (0,300)); lift B → `pinchStart` increments again; then move C to (0,330) → last ratio ≈ 1.1 (relative to the A–C distance 300, not the stale A–B 100).
4. Two quick taps at the same spot (`timeStamp` 0/10 and 200/210) → one `onDoubleTap` with NDC `[(200/400)*2-1, -((400/800)*2-1)] = [0, 0]` for a tap at (200, 400).
5. Down, move 30 px, up → no `onDoubleTap` even when followed by a quick second tap.
6. After `detach()`, firing events does nothing (handlers removed → `fire` returns undefined and `calls` unchanged).

**Verify**: `bun test app/_components/touch-controls.test.ts` → 6 pass.

Commit: `fix: re-anchor pinch zoom when a third finger lifts`.

### Step 4: Collision and autofocus see the inserted building; no leak on abort

- `collision.ts`: change the parameter to `getTargets: () => Object3D[]`
  and the call to `raycaster.intersectObjects(getTargets(), true)[0]`.
  Update the JSDoc (`/** Wall collision against whatever `getTargets` returns — the city group and the inserted building. */`).
- `create-app.ts`:
  - Move `let inserted: Object3D | null = null;` above the collider creation
    (before `const collider = …`).
  - `const collider = createCityCollider(() => inserted ? [cityLayer.group, inserted] : [cityLayer.group]);`
  - In `updateFocus`, raycast `inserted ? [cityLayer.group, inserted, terrain.mesh] : [cityLayer.group, terrain.mesh]`.
  - In `insertBuilding`: after `await createInsertedBuilding(...)`, change
    the early return to `if (disposed) { disposeObject3D(obj); return; }`,
    and before `scene.add(obj)` build BVHs so the collider stays cheap for
    real glTF models:

```ts
    // BVHs keep the per-frame collision rays cheap for real glTF models.
    obj.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh && !mesh.geometry.boundsTree) {
        mesh.geometry.computeBoundsTree();
      }
    });
```

    (`import { type Mesh, … } from "three"` — `Mesh.isMesh` narrows.)

**Verify**: `bun typecheck` → exit 0; `bun run test:e2e` → 3 passed (the
spec presses nothing that inserts, but the collider signature change is
exercised by walking in the mobile drag test). Manual in `bun dev`: press
`B`, walk into the orange box → you stop at it; aim at it → DoF focuses.

Commit: `fix: inserted building participates in collision, focus and disposal`.

### Step 5: Unwind partial boots with a cleanup list

Goal: the failure path and the success path free exactly the same things.

1. In `createCityWalkApp`, declare `const cleanups: Array<() => void> = [];`
   before the `try`, pass it as a fourth argument `bootApp(opts, renderer, scene, cleanups)`,
   and in the `catch` run `for (const cleanup of [...cleanups].reverse()) { cleanup(); }`
   before the existing `disposeObject3D(scene)` / `renderer.dispose()` / `remove()`.
2. In `bootApp(opts, renderer, scene, cleanups)`, push a cleanup right after
   each disposable is created, in creation order:
   - `cleanups.push(() => styleResources.dispose());`
   - `cleanups.push(() => postStack.dispose());`
   - `cleanups.push(() => controls.dispose());`
   - `cleanups.push(detachTouch);`
   - after the listener registrations: one cleanup removing `keydown`, `keyup`, `blur`, `visibilitychange` and `wheel`;
   - `cleanups.push(() => resizeObserver.disconnect());`
   - after `renderer.setAnimationLoop(...)`: `cleanups.push(() => renderer.setAnimationLoop(null));`
3. Replace the handle's `dispose` body with:

```ts
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const cleanup of [...cleanups].reverse()) {
        cleanup();
      }
      disposeObject3D(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
```

   Reverse order makes the teardown sequence: animation loop → resize
   observer → listeners → touch → controls → post stack → style resources →
   scene → renderer, which matches the current order except that
   `styleResources.dispose()` now runs before `disposeObject3D(scene)`;
   that is safe because `disposeObject3D` skips `userData.shared` materials.

**Verify**:
- `bun typecheck` → exit 0; `bun lint` → exit 0.
- `grep -c "cleanups.push" app/_components/create-app.ts` → `7`.
- `bun run test:e2e` → 3 passed.
- Manual: `bun dev` (StrictMode double-mounts the effect); after load,
  `document.querySelectorAll("canvas[data-engine]").length` in the console
  → `1`, and no errors in the console.

Commit: `fix: unwind every boot-time resource when startup fails`.

### Step 6: Full verification

`bun run verify` → exit 0; `bun run build` → exit 0; `bun run test:e2e` → 3 passed.

## Test plan

- `fps-movement.test.ts`: +4 cases (Step 1).
- `touch-controls.test.ts`: 6 new cases including the three-finger regression (Step 3).
- E2E: unchanged spec; manual checks for Steps 4 and 5 recorded in the status row.
- Pattern files: `lib/city/ground-clamp.test.ts` (numeric), `lib/city/touch.test.ts` (tap semantics).

## Done criteria

- [ ] `bun run verify` exits 0; `bun run build` exits 0; `bun run test:e2e` reports 3 passed
- [ ] `bun test app/_components/fps-movement.test.ts` → 14 pass; `bun test app/_components/touch-controls.test.ts` → 6 pass
- [ ] `grep -n "Math.hypot(ix, iy)" app/_components/fps-movement.ts` → 1 hit
- [ ] `grep -c "releaseAll" app/_components/create-app.ts` → `2`; `grep -n "e.repeat" app/_components/create-app.ts` → 1 hit
- [ ] `grep -n "syncPinchBaseline" app/_components/touch-controls.ts` → definition + 2 calls
- [ ] `grep -n "intersectObjects(getTargets()" app/_components/collision.ts` → 1 hit
- [ ] `grep -c "cleanups.push" app/_components/create-app.ts` → `7`
- [ ] Manual checks (walk into inserted box; single canvas in dev) recorded in the status row
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- The "Current state" excerpts do not match the live files.
- After Step 5 the e2e demolish or drag assertions fail, or `bun dev` shows
  two canvases / a console error on the StrictMode remount — the cleanup
  order or the `disposed` guard is wrong; report rather than reverting to
  the old inline `dispose`.
- Step 3's regression test cannot be made to pass without changing
  `pinchDistance()` to pick specific pointers — report; the intended fix is
  the baseline re-anchor only.
- You find yourself editing `lib/city/collision.ts` or `virtual-joystick.tsx`.

## Maintenance notes

- Every new boot-time resource in `bootApp` must `cleanups.push(...)` its
  teardown; reviewers should reject additions to `bootApp` that create a
  disposable without one. (PR #16 adds several layers — apply this rule
  when merging.)
- `releaseAll` is also the right hook if a future modal/drawer should
  pause movement while open.
- Deferred: nudging the player out of a building on teleport (cosmetic —
  the shell interior is visible for a moment), a `Escape`-to-release for
  the joystick on desktop.
