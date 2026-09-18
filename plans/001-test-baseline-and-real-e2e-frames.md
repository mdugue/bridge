# Plan 001: Make the test baseline real — app/ tests run, e2e waits for frames, one verify command

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8075a21..HEAD -- package.json app/_components/poc-debug.ts app/_components/create-app.ts app/_components/city-walk.tsx e2e/city-walk.spec.ts app/_components/visual-style.test.ts app/_components/fps-movement.test.ts app/_components/three-utils.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (PR #16 "Aesthectic and visual fine
> tuning" changes `poc-debug.ts`, `create-app.ts` and `city-walk.tsx`; if it
> has merged, the excerpts will not match — stop and ask whether to port.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `8075a21`, 2026-09-18

## Why this matters

CI is green, but three things make that signal weaker than it looks:

1. `bun run test` is `bun test ./lib`, so any test file under
   `app/_components/` is silently ignored by both the local script and CI.
   Every module that talks to three.js is structurally untestable today,
   even the ones that need no WebGL (movement math, material switching,
   disposal guards).
2. The e2e "style burst" in `e2e/city-walk.spec.ts` runs 22 setter calls in
   one synchronous `page.evaluate`, then waits a fixed 500 ms and asserts no
   console errors. Under the software renderer a frame can take longer than
   500 ms, and only the last value of each setter is ever bound to a frame.
   The comment claiming it exercises the clay alpha-hash recompile is false:
   `setStyle("ghost")` re-binds the ghost material before any frame renders.
   Commit `013eab7` ("fix: clay transparency applies instantly and occludes
   correctly") is guarded only by this assertion, which cannot fail.
3. There is no single command that runs what CI runs; a contributor (or an
   agent) reaching for `bun run check` gets Biome only.

After this plan: `bun run test` covers `app/`, three headless unit-test files
exist for the highest-churn three.js modules, the e2e burst waits for real
rendered frames via a frame counter on the debug hook, the hook's `ready`
flag means what it says, and `bun run verify` runs lint + typecheck + unit.

## Current state

Files and roles:

- `package.json` — scripts (lines 56–68): `"test": "bun test ./lib"`,
  `"test:watch": "bun test ./lib --watch"`, `"test:coverage": "bun test ./lib --coverage"`,
  `"check": "ultracite check"`, `"lint": "eslint && ultracite check"`,
  `"typecheck": "tsgo --noEmit"`, `"test:e2e": "playwright test"`.
- `app/_components/poc-debug.ts` — the `window.__poc` debug hook consumed by
  the e2e spec; `updatePocDebug(patch)` merges a patch into `window.__poc`
  with defaults `{ ready: false, buildingCount: 0, terrainVertexCount: 0, shadowsEnabled: false }`
  (lines 66–78). Enabled only in dev or with `NEXT_PUBLIC_POC_DEBUG=1`.
- `app/_components/create-app.ts` — the animation loop (lines 485–497) and
  `emitStats()` (lines 397–403, called synchronously at line 499 before the
  handle is returned).
- `app/_components/city-walk.tsx` — `onStats` (lines 183–193) calls
  `updatePocDebug({ ready: true, ...s })`; the `.then` (lines 205–240)
  installs the API methods and calls `setStatus({ phase: "ready" })`.
- `e2e/city-walk.spec.ts` — Playwright smoke spec (3 tests, software WebGL).
- `app/_components/visual-style.ts` — `setCityTransparency` (lines 153–177),
  `setEdgeOpacity` (lines 185–191), `createStyleResources` (lines 78–136).
- `app/_components/fps-movement.ts` — `createFpsMovement` (lines 47–141).
- `app/_components/three-utils.ts` — `disposeObject3D` (lines 22–31) with
  the `userData.shared` guard in `disposeMaterial` (lines 3–15).

Excerpt — `app/_components/poc-debug.ts:56-78`:

```ts
declare global {
  interface Window {
    __poc?: PocDebugInfo;
  }
}

const enabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_POC_DEBUG === "1";

export function updatePocDebug(patch: Partial<PocDebugInfo>): void {
  if (!enabled) {
    return;
  }
  window.__poc = {
    ready: false,
    buildingCount: 0,
    terrainVertexCount: 0,
    shadowsEnabled: false,
    ...window.__poc,
    ...patch,
  };
}
```

Excerpt — `app/_components/create-app.ts:485-499`:

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
  });

  emitStats();
```

Excerpt — `app/_components/city-walk.tsx:183-193` and `205-240` (abridged):

```ts
      onStats: (s) => {
        if (cancelled) {
          return;
        }
        setStats(s);
        updatePocDebug({ ready: true, ...s });
        const h = handleRef.current;
        if (h) {
          setFootprints(h.getFootprints());
        }
      },
// ...
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        handleRef.current = h;
        setSun(h.setSun(composeDate(INITIAL_DATE, INITIAL_MINUTES)));
        setFootprints(h.getFootprints());
        setBounds(h.terrainBounds);
        updatePocDebug({
          offset: h.offset,
          flyTo: h.flyTo,
          // ... every other API method ...
        });
        setStatus({ phase: "ready" });
      })
```

Excerpt — `e2e/city-walk.spec.ts:15-24` (the vacuous first test):

```ts
test("city page serves the viewer shell", async ({ page }) => {
  await page.goto("/");
  // Either the loading overlay, the ready HUD, or a loud error — never blank.
  await expect(
    page
      .locator("main")
      .filter({ has: page.locator("div") })
      .first()
  ).toBeVisible();
});
```

Excerpt — `e2e/city-walk.spec.ts:158-189` (the burst being fixed):

```ts
  // Style, DoF and atmosphere controls must not produce shader/render
  // errors (caught by the console assertions below after a few frames).
  await page.evaluate(() => {
    window.__poc?.setStyle?.("clay");
    window.__poc?.setStyle?.("standard");
    window.__poc?.setStyle?.("ghost");
    window.__poc?.setDepthOfField?.(false);
    window.__poc?.setDepthOfField?.(true);
    window.__poc?.setAtmosphere?.(1);
    window.__poc?.setAtmosphere?.(0.35);
    window.__poc?.setDepthGrading?.(1);
    window.__poc?.setDepthGrading?.(0.5);
    window.__poc?.setBuildingTransparency?.(0.8);
    window.__poc?.setBuildingTransparency?.(0.45);
    // Clay's alpha-hash path recompiles when crossing 0 — exercise it.
    window.__poc?.setStyle?.("clay");
    window.__poc?.setBuildingTransparency?.(0.5);
    window.__poc?.setBuildingTransparency?.(0);
    window.__poc?.setStyle?.("ghost");
    window.__poc?.setToonBands?.(4);
    window.__poc?.setToonBands?.(0);
    window.__poc?.setEdges?.(0);
    window.__poc?.setEdges?.(0.7);
    window.__poc?.setContactShadows?.(1);
    window.__poc?.setContactShadows?.(0.5);
    window.__poc?.setPaperGrain?.(1);
    window.__poc?.setPaperGrain?.(0.25);
  });
  await page.waitForTimeout(500);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
```

Excerpt — `app/_components/visual-style.ts:153-191`:

```ts
export function setCityTransparency(
  resources: StyleResources,
  style: CityStyleId,
  transparency: number
): void {
  const t = Math.min(Math.max(transparency, 0), 1);
  if (style === "ghost") {
    const wasTransmissive = resources.ghost.transmission > 0;
    resources.ghost.transmission = t;
    if (t > 0 !== wasTransmissive) {
      resources.ghost.needsUpdate = true;
    }
    return;
  }
  if (style === "clay") {
    const clay = resources.clay;
    const wasHashed = clay.alphaHash;
    clay.opacity = 1 - t;
    clay.alphaHash = t > 0;
    clay.transparent = false;
    if (clay.alphaHash !== wasHashed) {
      clay.needsUpdate = true;
    }
  }
}

/** 0 disables toon banding; 2..6 are sensible band counts. */
export function setToonBands(resources: StyleResources, bands: number): void {
  resources.toonBands.value = bands;
}

/** Ink edge strength; 0 hides the lines entirely (via applyCityStyle). */
export function setEdgeOpacity(
  resources: StyleResources,
  opacity: number
): void {
  resources.edgeLines.opacity = Math.min(Math.max(opacity, 0), 1);
  resources.edgesVisible = opacity > 0.01;
}
```

Facts you need:

- three.js's `Material.needsUpdate` is a write-only setter that increments
  the public `material.version` counter. Tests observe `version`, not
  `needsUpdate`.
- `createStyleResources()` builds `MeshPhysicalMaterial`/`MeshStandardMaterial`
  objects with no WebGL context; they construct fine under Bun. Importing
  `app/_components/visual-style.ts` also pulls `three/examples/jsm/utils/BufferGeometryUtils.js`,
  which is plain JS. (`app/_components/poc-debug.ts` reads `process.env`,
  which Bun provides.)
- `fps-movement.ts` constants: `WALK_SPEED = 9`, `SPRINT_FACTOR = 3`,
  `FLY_SPEED = 35`, `GROUND_TAU = 0.12`. `PerspectiveCamera.getWorldDirection`
  updates the world matrix itself. With the camera at `(0, 1.7, 0)` looking
  at `(0, 1.7, -100)`: forward is `-Z`, "right" (`forward × up`) is `+X`.
- Do NOT assert the magnitude of diagonal (W+D) movement in this plan — it is
  currently `step·√2` and plan 005 changes it; asserting either value here
  would couple the plans.
- Biome (`biome.jsonc`) already relaxes `useTopLevelRegex` for `**/*.test.ts`
  anywhere in the tree, and `tsconfig.json` includes `**/*.ts` with
  `types: ["bun"]`, so new test files under `app/` need no config changes.
- A bare `bun test` (no path) would also pick up `e2e/city-walk.spec.ts`
  (Bun matches `*.spec.*`) and crash on `@playwright/test`. Always pass the
  directories.
- The shadcn `Alert` in `components/ui/alert.tsx` renders `role="alert"`
  (verify with `grep -n 'role="alert"' components/ui/alert.tsx`).

Conventions: `bun:test`, colocated `*.test.ts`, small fixtures and exact
expectations (see `lib/city/ground-clamp.test.ts` for numeric tests and
`lib/city/filter-city-object.test.ts` for fixture builders). Conventional
Commits, lowercase subject. No `console.log`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 (`bun fix` first if only formatting is reported) |
| Unit tests | `bun run test` | all pass |
| E2E | `bunx playwright install chromium` once, then `bun run test:e2e` | 3 passed |
| Build | `bun run build` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `package.json` (scripts only)
- `app/_components/poc-debug.ts`
- `app/_components/create-app.ts` (one call in the animation loop)
- `app/_components/city-walk.tsx` (move the `ready` flag)
- `e2e/city-walk.spec.ts`
- `app/_components/visual-style.test.ts` (create)
- `app/_components/fps-movement.test.ts` (create)
- `app/_components/three-utils.test.ts` (create)
- `plans/README.md` (status row)

**Out of scope**:
- `.github/workflows/ci.yml` — the unit job already runs `bun run test`, so
  it picks up the new glob automatically; do not edit CI.
- `biome.jsonc`, `tsconfig.json`, `playwright.config.ts` — no changes needed.
- Any behaviour change in `visual-style.ts`, `fps-movement.ts`,
  `three-utils.ts` — this plan only adds tests for what they do today.
- `lib/**` tests — extending them is a separate, lower-priority item.

## Git workflow

- Branch: `advisor/001-test-baseline` from `main`.
- Commits: `test: run unit tests under app/ and add verify script`,
  `test: count rendered frames on the debug hook and wait for them in e2e`,
  `test: cover visual-style, fps-movement and three-utils headlessly`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Widen the test glob and add `verify`

In `package.json` `scripts`:

- `"test": "bun test ./lib ./app"`
- `"test:watch": "bun test ./lib ./app --watch"`
- `"test:coverage": "bun test ./lib ./app --coverage"`
- add `"verify": "bun run lint && bun run typecheck && bun run test"`

Leave `check` as it is (renaming it is not worth the churn).

**Verify**: `bun run test` → the same 12 files pass as before (no tests under
`app/` yet); `bun run verify` → exit 0.

### Step 2: Frame counter and an honest `ready` on the debug hook

In `app/_components/poc-debug.ts`:

1. Add to `PocDebugInfo`: `/** Rendered-frame counter; e2e waits on it instead of sleeping. */ frames: number;`
2. Add `frames: 0` to the defaults object in `updatePocDebug`.
3. Add and export:

```ts
/** Called once per rendered frame from the animation loop. */
export function tickPocFrame(): void {
  if (!enabled) {
    return;
  }
  const poc = window.__poc;
  if (poc) {
    poc.frames += 1;
  }
}
```

In `app/_components/create-app.ts`: import `tickPocFrame` from `./poc-debug`
and call it as the last statement of the `setAnimationLoop` callback, after
`postStack.render(dt);`.

In `app/_components/city-walk.tsx`:

- In `onStats`, change `updatePocDebug({ ready: true, ...s });` to
  `updatePocDebug(s);` (stats only).
- In the `.then`, add `ready: true,` as the first property of the
  `updatePocDebug({ … })` call that installs the API — so `ready` becomes
  true in the same tick as `setStatus({ phase: "ready" })` and after every
  method is installed.

**Verify**:
- `bun typecheck` → exit 0.
- `grep -n "ready: true" app/_components/city-walk.tsx` → exactly one hit, inside the `.then` block.
- `grep -n "tickPocFrame" app/_components/create-app.ts` → an import line and one call in the loop.

### Step 3: Make the e2e spec wait for frames and assert real content

In `e2e/city-walk.spec.ts`:

1. Add two helpers near the top (after the `test.use` block):

```ts
import type { Page } from "@playwright/test";

/** Resolves once the viewer has rendered `count` more frames. */
async function waitForFrames(page: Page, count: number): Promise<void> {
  const start = await page.evaluate(() => window.__poc?.frames ?? 0);
  await page.waitForFunction(
    (target) => (window.__poc?.frames ?? 0) >= target,
    start + count,
    { timeout: 60_000 }
  );
}

/** Skips the current test when the browser has no WebGL at all. */
async function skipWithoutWebGl(page: Page): Promise<void> {
  const webglAvailable = await page.evaluate(() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  });
  // biome-ignore lint/suspicious/noSkippedTests: conditional runtime skip — render assertions are meaningless without WebGL
  test.skip(!webglAvailable, "WebGL is genuinely unavailable in this environment");
}
```

   Replace the inline probe + `test.skip` in the desktop test (lines 41–49)
   with `await skipWithoutWebGl(page);` and call the same helper at the start
   of the mobile test after `page.goto("/")`.

2. Replace the burst (lines 160–189) with grouped steps. Define the groups
   as an array of functions executed in the page, each followed by a
   two-frame wait and the error assertions:

```ts
  const steps: Array<() => void> = [
    () => window.__poc?.setStyle?.("clay"),
    () => window.__poc?.setStyle?.("standard"),
    () => window.__poc?.setStyle?.("ghost"),
    () => window.__poc?.setDepthOfField?.(false),
    () => window.__poc?.setDepthOfField?.(true),
    () => {
      window.__poc?.setAtmosphere?.(1);
      window.__poc?.setDepthGrading?.(1);
    },
    () => {
      window.__poc?.setAtmosphere?.(0.35);
      window.__poc?.setDepthGrading?.(0.5);
    },
    () => window.__poc?.setBuildingTransparency?.(0.8),
    () => window.__poc?.setBuildingTransparency?.(0.45),
    // Clay's alpha-hash program compiles when transparency crosses 0 —
    // each of these must reach a rendered frame.
    () => window.__poc?.setStyle?.("clay"),
    () => window.__poc?.setBuildingTransparency?.(0.5),
    () => window.__poc?.setBuildingTransparency?.(0),
    () => window.__poc?.setStyle?.("ghost"),
    () => window.__poc?.setToonBands?.(4),
    () => window.__poc?.setToonBands?.(0),
    () => window.__poc?.setEdges?.(0),
    () => window.__poc?.setEdges?.(0.7),
    () => window.__poc?.setContactShadows?.(1),
    () => window.__poc?.setContactShadows?.(0.5),
    () => window.__poc?.setPaperGrain?.(1),
    () => window.__poc?.setPaperGrain?.(0.25),
  ];
```

   Playwright cannot serialise closures, so the array literal must live
   INSIDE the browser-side function and be driven by index from the test:

```ts
  const STYLE_STEPS = 21;
  for (let i = 0; i < STYLE_STEPS; i++) {
    await page.evaluate((index) => {
      const steps: Array<() => void> = [ /* the 21 entries above, verbatim */ ];
      steps[index]?.();
    }, i);
    await waitForFrames(page, 2);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  }
```

   (Do not define the array outside `page.evaluate`; do not try to pass
   functions across the boundary.) Delete the `waitForTimeout(500)` line.

3. Replace the first test's body with assertions on real content:

```ts
test("city page serves the viewer shell", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.goto("/");
  // Either the loading overlay or the booted canvas — never a blank page.
  await expect(
    page.getByText(/Loading 3D viewer|Starting renderer|Loading CityJSON|Parsing buildings|Loading DGM|Preparing render styles/)
      .or(page.locator("canvas[data-engine]"))
      .first()
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
```

4. In the mobile test, add the `pageErrors`/`consoleErrors` collectors (same
   as the desktop test) and assert both are empty at the end, after the
   drawer assertion. Keep every existing mobile assertion.

**Verify**: `bun run test:e2e` → 3 passed. Expect the desktop test to take
roughly 30–90 s longer than before under software rendering; if it exceeds
its 240 s budget, raise only that test's `test.setTimeout` to `360_000` and
note it in the status row.

Commit: `test: count rendered frames on the debug hook and wait for them in e2e`.

### Step 4: Headless unit tests for `visual-style.ts`

Create `app/_components/visual-style.test.ts` (model after
`lib/city/atmosphere.test.ts` — boundary-focused, no mocks):

```ts
import { expect, test } from "bun:test";
import {
  createStyleResources,
  DEFAULT_GHOST_TRANSPARENCY,
  setCityTransparency,
  setEdgeOpacity,
} from "./visual-style";
```

Cases (one `test(...)` each, exact expectations):

1. Ghost starts at `DEFAULT_GHOST_TRANSPARENCY` transmission; `setCityTransparency(r, "ghost", 0.6)` sets `r.ghost.transmission` to 0.6 and does NOT change `r.ghost.version`.
2. `setCityTransparency(r, "ghost", 0)` from a transmissive state sets transmission 0 and increments `r.ghost.version` by 1; then `setCityTransparency(r, "ghost", 0.4)` increments it again.
3. `setCityTransparency(r, "clay", 0.5)` sets `opacity` 0.5, `alphaHash` true, `transparent` false, and increments `r.clay.version`; a following `0.8` changes `opacity` to `0.2` (use `toBeCloseTo`) without changing `version`; a following `0` sets `alphaHash` false, `opacity` 1, and increments `version`.
4. Inputs are clamped: `-1` behaves as `0`, `2` behaves as `1` (ghost transmission 1, clay opacity 0).
5. `setCityTransparency(r, "standard", 0.5)` changes neither `r.ghost.transmission` nor `r.clay.opacity`.
6. `setEdgeOpacity`: `0` → `edgesVisible === false` and `edgeLines.opacity === 0`; `0.005` → `false`; `0.02` → `true`; `1.5` → `opacity === 1`.
7. `createStyleResources()` marks `ghost`, `clay` and `edgeLines` with `userData.shared === true`.

**Verify**: `bun test app/_components/visual-style.test.ts` → 7 pass.

### Step 5: Headless unit tests for `fps-movement.ts`

Create `app/_components/fps-movement.test.ts` (model after
`lib/city/ground-clamp.test.ts`). Fixture:

```ts
function rig(overrides: Partial<FpsMovementOptions> = {}) {
  const camera = new PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 1.7, -100); // facing -Z
  const movement = createFpsMovement(camera, {
    eyeHeight: 1.7,
    groundHeight: () => 0,
    ...overrides,
  });
  return { camera, movement };
}
```

Cases:

1. `press("KeyW")` + `update(1)` → `camera.position.z ≈ -9`, `x ≈ 0`, `y ≈ 1.7`.
2. `KeyS` → `z ≈ +9`; `KeyD` → `x ≈ +9`; `KeyA` → `x ≈ -9` (fresh rig each).
3. `KeyW` + `ShiftLeft` → `z ≈ -27` (sprint ×3).
4. `KeyW` + `KeyS` → position unchanged (opposing keys cancel).
5. `setAnalog(2, -3)` clamps to `(1, -1)`: after `update(1)` with no keys, `x ≈ 9` and `z ≈ 9`.
6. `release("KeyW")` after `press("KeyW")` → `update(1)` moves nothing.
7. Walk mode: `resolveStep` is called with the proposed step and its return value is applied verbatim — pass `resolveStep: () => new Vector3()` and assert `x`/`z` unchanged after `KeyW` + `update(1)`; pass a spy that records its argument and assert the recorded vector has `z ≈ -9`.
8. `groundHeight: () => null` holds `y` at its current value across `update(1)`.
9. Fly mode: `setMode("fly")`, `press("Space")`, `update(1)` → `y ≈ 1.7 + 35`; `ShiftLeft` instead → `y ≈ 1.7 - 35`; in walk mode `ShiftLeft` alone leaves `y ≈ 1.7`.
10. `snapToGround()` with `groundHeight: () => 50` sets `y` to exactly `51.7` (no smoothing); `getMode()` reports `"walk"` then `"fly"` after `setMode`.

Use `toBeCloseTo(value, 5)` for floats.

**Verify**: `bun test app/_components/fps-movement.test.ts` → 10 pass.

### Step 6: Headless unit tests for `three-utils.ts`

Create `app/_components/three-utils.test.ts` (model after
`lib/city/filter-city-object.test.ts`). Spy on disposal with
`material.addEventListener("dispose", () => { calls += 1; })` and
`geometry.addEventListener("dispose", ...)`.

Cases:

1. `Group > Mesh(BoxGeometry, MeshBasicMaterial)`: `disposeObject3D(group)` disposes the geometry once and the material once.
2. A material with `userData.shared = true` is NOT disposed; its mesh's geometry still is.
3. A mesh with an array material `[a, b]` where `b.userData.shared = true`: `a` disposed, `b` not.
4. Two meshes sharing one non-shared material: `disposeObject3D` does not throw; the material's dispose event fires (twice is acceptable — assert `>= 1`).
5. A bare `Object3D` with no geometry/material is traversed without throwing.

**Verify**: `bun test app/_components/three-utils.test.ts` → 5 pass.

Commit: `test: cover visual-style, fps-movement and three-utils headlessly`.

### Step 7: Full verification

- `bun run verify` → exit 0 (lint, typecheck, unit — now 15 test files).
- `bun run build` → exit 0.
- `bun run test:e2e` → 3 passed.

## Test plan

- New unit tests: the 22 cases in Steps 4–6.
- Changed e2e: first test asserts loading text or canvas and no alert; the
  style burst is 21 frame-gated steps with error assertions after each;
  the mobile test gains the WebGL skip and error assertions.
- Pattern files: `lib/city/atmosphere.test.ts`, `lib/city/ground-clamp.test.ts`,
  `lib/city/filter-city-object.test.ts`.
- Verification: `bun run test` → all pass including 22 new; `bun run test:e2e` → 3 passed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n '"test": "bun test ./lib ./app"' package.json` → 1 hit; `grep -n '"verify":' package.json` → 1 hit
- [ ] `bun run verify` exits 0
- [ ] `bun run test` reports 15 test files passing, 0 failing
- [ ] `grep -c "waitForTimeout" e2e/city-walk.spec.ts` → `0`
- [ ] `grep -c "waitForFrames(page, 2)" e2e/city-walk.spec.ts` → `1` (inside the loop) and the in-page `steps` array has 21 entries
- [ ] `grep -n "frames" app/_components/poc-debug.ts` → the interface field, the default, and `tickPocFrame`
- [ ] `bun run test:e2e` reports 3 passed
- [ ] `bun run build` exits 0
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts do not match the live files.
- Importing `./visual-style` or `./fps-movement` under `bun test` throws at
  module load (e.g. a `window`/`document` access at import time) — report
  the stack; do not add DOM shims.
- The frame-gated e2e burst exceeds 360 s even with the raised timeout —
  report the per-step timings from the Playwright HTML report instead of
  reducing the number of waits.
- Any existing e2e assertion has to be weakened to get to green.
- You need to touch a file outside the in-scope list.

## Maintenance notes

- `window.__poc.frames` is now part of the e2e contract documented in
  `poc-debug.ts`; any future "wait for the scene to settle" should use
  `waitForFrames`, never `waitForTimeout`.
- Plan 003 changes how edges are built inside `visual-style.ts`; the tests
  here do not touch edge construction, only the material/opacity setters, so
  they survive that change.
- Plan 005 normalises diagonal movement speed; the fps-movement tests here
  deliberately avoid asserting the diagonal magnitude so plan 005 can add
  that assertion as its regression test.
- Reviewer focus: the `ready` flag now flips in the `.then` — confirm no
  e2e step reads an API method before that point.
