# Plan 009: Re-render the shadow map only when the player has moved a real distance

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- app/_components/sun-rig.ts app/_components/create-app.ts app/_components/vegetation-layer.ts app/_components/poc-debug.ts e2e/city-walk.spec.ts .claude/skills/city-walker/SKILL.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Plan 008 adds `layerStats` to
> `poc-debug.ts` and one e2e test — that is expected drift; the excerpts
> below still apply.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/008-verification-net.md (recommended — it makes the e2e assertion meaningful)
- **Category**: perf
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

The sun's 3072² shadow map is rendered on demand: the sun rig sets
`shadow.needsUpdate` whenever the camera-following frustum's *texel-snapped*
centre changes. One texel is 220 m / 3072 ≈ 0.072 m. Walking moves the
camera 9 m/s (0.15 m per 60 Hz frame), sprinting 27 m/s, flying 35 m/s — so
while the player moves, the snapped centre changes on essentially **every
frame** and the full depth pass (all four merged city meshes, every tree
chunk inside the frustum, lamps, walls, bridges — hundreds of thousands to
millions of triangles into a 9.4-Mtexel target) runs every frame. The
project's own notes name this depth pass as the single biggest per-frame
cost, and the motion-keyed quality regression (plan 007) sheds AO and DoF
during exactly these frames — while the shadow pass keeps running.

The frustum has a 110 m half-size. Letting the player drift up to 20 m from
the last re-centred position before re-rendering keeps them inside the
high-resolution area (90 m of margin) and cuts shadow re-renders while
walking from ~60/s to ~0.45/s. The texel snap stays, so the look is
unchanged between re-renders. Two things that were hidden by the every-frame
re-render must become explicit: the crown LOD swap and the Multi-Tuft toggle
change what casts shadows and never invalidate the map today.

## Current state

- `app/_components/sun-rig.ts` — sun + shadow camera; the follow/snap logic.
- `app/_components/create-app.ts` — the render loop calls `sunRig.follow` and
  `veg.updateLod` every frame; `invalidateShadows()` is the single entry point.
- `app/_components/vegetation-layer.ts` — `updateLod` flips crown visibility.
- `app/_components/poc-debug.ts` — `window.__poc` (`frames` counter).
- `e2e/city-walk.spec.ts` — the regression test that holds `W`.

`app/_components/sun-rig.ts:36-46`:

```ts
const SUN_INTENSITY = 2.4;
/** 3072 over the 110 m frustum ≈ 0.07 m/texel. The soft Vogel-disk PCF (see
 * shadow.radius) hides residual stepping, so 3072 looks like 4096 here while
 * costing ~44% less shadow fill — it re-renders on most frames while walking.
 * The `lite` e2e profile drops this to 512 (see scene-profile.ts): under
 * SwiftShader the depth pass is one of the few per-frame costs that does not
 * shrink with the canvas, and no headless assertion depends on edge quality. */
const SHADOW_MAP_SIZE = shadowMapSizeFor(currentSceneProfile());
/** Half-size of the shadow frustum, in metres. Small = fine texels (smoother
 * shadow edges, less staircase under PCFSoft); the frustum follows the camera
 * so street-level coverage isn't lost. 160 m → ~0.16 m texels at 2048². */
const SHADOW_RADIUS = 110;
```

`app/_components/sun-rig.ts:85-90`:

```ts
  const center = worldBounds.getCenter(new Vector3());
  // Light sits twice the frustum radius out; tight depth range = good precision.
  const shadowDistance = SHADOW_RADIUS * 2;
  // World size of one shadow texel — snap the frustum centre to this grid so
  // shadow edges don't crawl/shimmer as the camera moves.
  const texelSize = (SHADOW_RADIUS * 2) / SHADOW_MAP_SIZE;
```

`app/_components/sun-rig.ts:134-163`:

```ts
  const focus = center.clone();
  let lastFx = Number.NaN;
  let lastFy = Number.NaN;
  let lastFz = Number.NaN;
  const reposition = () => {
    // Snap the focus to the texel grid to keep shadow edges stable while moving.
    const fx = Math.round(focus.x / texelSize) * texelSize;
    const fy = Math.round(focus.y / texelSize) * texelSize;
    const fz = Math.round(focus.z / texelSize) * texelSize;
    sun.target.position.set(fx, fy, fz);
    sun.position.set(
      fx + dir.x * shadowDistance,
      fy + dir.y * shadowDistance,
      fz + dir.z * shadowDistance
    );
    // Manual shadow update only when the snapped frustum centre changed. fy
    // matters too: ascending straight up in fly mode keeps fx/fz fixed while
    // the frustum's vertical slice shifts, which would otherwise go stale.
    if (fx !== lastFx || fy !== lastFy || fz !== lastFz) {
      sun.shadow.needsUpdate = true;
      lastFx = fx;
      lastFy = fy;
      lastFz = fz;
    }
  };

  const follow = (point: Vector3) => {
    focus.copy(point);
    reposition();
  };
```

`update(date)` (`:165-172`) sets `dir`, calls `reposition()` and forces
`sun.shadow.needsUpdate = true`; `invalidateShadow` (`:207-209`) sets the
flag; the interface `SunRig` is at `:21-33`. The rig sets
`sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;` at `:102-103`
and adds the light at `:124` (`scene.add(sun, sun.target)`). three's
`WebGLShadowMap` renders the map when `needsUpdate` is true and then resets
it to `false`.

`app/_components/create-app.ts:1176-1221` (the loop; unchanged lines elided):

```ts
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.05);
    ...
    // Keep the (small, sharp) shadow frustum centered on the player.
    sunRig.follow(camera.position);
    // Drift the sky dome's clouds (one uniform write/frame).
    sunRig.setTime(elapsed);
    // Repoint the shared real lamp lights at the nearest heads.
    lampLights?.updateNearest(camera.position);
    // Swap each vegetation chunk between the rich and cheap crown by distance,
    // and advance the wind sway (same clock as the water ripple).
    for (const veg of vegControls) {
      veg.updateLod(camera.position);
      veg.setTime(elapsed);
    }
    ...
    postStack.render(dt);
    tickPocFrame();
  });
```

`invalidateShadows` is defined earlier at `create-app.ts:784-793` (calls
`sunRig.invalidateShadow()`); `setTreeMultiTuft` at `:1283-1287` only forwards
to each `veg.setMultiTuft(enabled)`.

`app/_components/vegetation-layer.ts:75-76` and `:888-899`:

```ts
const LOD_NEAR_IN_M = 220;
const LOD_NEAR_OUT_M = 300;
...
    updateLod: (cameraPos) => {
      for (const c of cells) {
        const sphere = c.cheap.boundingSphere;
        const near = sphere
          ? cameraPos.distanceTo(sphere.center) - sphere.radius
          : Number.POSITIVE_INFINITY;
        const wantRich =
          multiTuft && near < (c.rich.visible ? LOD_NEAR_OUT_M : LOD_NEAR_IN_M);
        c.rich.visible = wantRich;
        c.cheap.visible = !wantRich;
      }
    },
```

Both crown meshes have `castShadow = true` (`:647-651`), so a flip changes
the depth pass. The interface member is `updateLod: (cameraPos: Vector3) => void;`
(`:94`).

`app/_components/poc-debug.ts:145-154`:

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

`frames: number` is a required member of `PocDebugInfo` (`:29-30`) and is
defaulted to `0` in `updatePocDebug` (`:134-142`).

`e2e/city-walk.spec.ts:388-404` (the test to extend):

```ts
  test("quality regresses while moving and recovers when still", async () => {
    await page.keyboard.down("KeyW");
    await waitForFrames(page, 2);
    expect(await page.evaluate(() => window.__poc?.regressed)).toBe(true);

    await page.keyboard.up("KeyW");
    await page.waitForFunction(() => window.__poc?.regressed === false, null, {
      timeout: slow(60_000),
    });
    expectNoErrors(errors);
  });
```

Movement speeds (`app/_components/fps-movement.ts:6-8`): `WALK_SPEED = 9`,
`FLY_SPEED = 35`; the loop clamps `dt` to 0.05 s, so one walking frame moves
at most 0.45 m.

Conventions: unit tests colocated, `bun test`; model a three-importing test
on `app/_components/visual-style.test.ts`. `scene-profile.ts:31-36` returns
`"full"` when `window` is undefined, so `createSunRig` is constructible under
bun (it builds a `Sky` mesh with a `ShaderMaterial`, a `DirectionalLight` and
a `HemisphereLight` — no WebGL). The knowledge-base rule (`AGENTS.md:204-207`)
does not apply (no data→feature change), but the shadow recipe table in
`.claude/skills/city-walker/SKILL.md:69-80` documents `shadow.autoUpdate`
and must be kept true.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Full gate | `bun run verify` | exit 0 |
| One test file | `bun test app/_components/sun-rig.test.ts` | all pass |
| E2E | `bun run test:e2e` | all pass |

## Suggested executor toolkit

- Load the `city-walker` skill for the shadow recipe ("Shadows — the recipe
  and why") before editing `sun-rig.ts`.

## Scope

**In scope**:

- `app/_components/sun-rig.ts`
- `app/_components/sun-rig.test.ts` (create)
- `app/_components/vegetation-layer.ts` (only `updateLod`'s return value and the interface line)
- `app/_components/create-app.ts` (only the render loop and `setTreeMultiTuft`)
- `app/_components/poc-debug.ts` (`shadowRenders` + `tickPocFrame`)
- `e2e/city-walk.spec.ts` (only the regression test)
- `.claude/skills/city-walker/SKILL.md` (only the `shadow.autoUpdate` row)

**Out of scope**:

- `SHADOW_MAP_SIZE`, `SHADOW_RADIUS`, `shadow.radius`, `bias`, `normalBias`
  — the recipe is settled; do not retune it.
- Cascaded shadow maps, a pixel-ratio drop while moving, any post-stack change.
- `lib/city/regression.ts` and the AO/DoF gating.

## Git workflow

- Branch: `advisor/009-shadow-refresh-dead-zone`.
- One commit per step; Conventional Commits (`perf:` for Step 1, `fix:` for
  Step 2, `test:` for Steps 3–5, `docs:` for Step 6).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the follow dead zone

In `app/_components/sun-rig.ts`:

1. After `const SHADOW_RADIUS = 110;` add:

   ```ts
   /**
    * Metres the player may drift from the last re-centred frustum before the
    * shadow map is re-rendered. Re-centring on every texel (0.07 m) meant the
    * ~640k-triangle depth pass ran on every moving frame; 20 m keeps the
    * player well inside the 110 m half-size (90 m of margin in every
    * direction) and turns ~60 re-renders/s while walking into ~0.5/s. The
    * texel snap below still applies at each re-centre, so edges do not crawl.
    */
   const FOLLOW_DEAD_ZONE_M = 20;
   ```

2. Replace the `focus`/`lastF*`/`reposition`/`follow` block (`:134-163`) so
   the last re-centred position is remembered and `follow` early-returns
   inside the dead zone:

   ```ts
     const focus = center.clone();
     const lastCentre = new Vector3(Number.NaN, Number.NaN, Number.NaN);
     const reposition = () => {
       // Snap the focus to the texel grid to keep shadow edges stable.
       const fx = Math.round(focus.x / texelSize) * texelSize;
       const fy = Math.round(focus.y / texelSize) * texelSize;
       const fz = Math.round(focus.z / texelSize) * texelSize;
       sun.target.position.set(fx, fy, fz);
       sun.position.set(
         fx + dir.x * shadowDistance,
         fy + dir.y * shadowDistance,
         fz + dir.z * shadowDistance
       );
       // Manual shadow update only when the snapped frustum centre changed.
       // fy matters too: ascending straight up in fly mode keeps fx/fz fixed
       // while the frustum's vertical slice shifts.
       if (fx !== lastCentre.x || fy !== lastCentre.y || fz !== lastCentre.z) {
         sun.shadow.needsUpdate = true;
         lastCentre.set(fx, fy, fz);
       }
     };

     const follow = (point: Vector3) => {
       // Inside the dead zone the frustum stays put — nothing to re-render.
       if (
         Number.isFinite(lastCentre.x) &&
         point.distanceTo(lastCentre) < FOLLOW_DEAD_ZONE_M
       ) {
         return;
       }
       focus.copy(point);
       reposition();
     };
   ```

   `update()` keeps calling `reposition()` on the current `focus` and forcing
   `needsUpdate` (the sun moved) — leave it.
3. Add `shadowPending: () => boolean` to the `SunRig` interface with the doc
   comment `/** True when the next render will redraw the shadow map. */`,
   implement it as `() => sun.shadow.needsUpdate`, and include it in the
   returned object.
4. Rewrite the comment at `:36-38` so it no longer says "it re-renders on
   most frames while walking"; say re-renders happen at each `FOLLOW_DEAD_ZONE_M`
   re-centre, on sun changes, and on explicit invalidation.

**Verify**: `bun typecheck && bun lint` → exit 0.

### Step 2: Invalidate the shadow map when the crown LOD flips

1. `app/_components/vegetation-layer.ts` — change the interface line to
   `/** swaps crown LOD per chunk; returns true when any chunk changed (the shadow map must then be redrawn) */ updateLod: (cameraPos: Vector3) => boolean;`
   and make the implementation return whether any cell's `rich.visible`
   changed:

   ```ts
       updateLod: (cameraPos) => {
         let changed = false;
         for (const c of cells) {
           const sphere = c.cheap.boundingSphere;
           const near = sphere
             ? cameraPos.distanceTo(sphere.center) - sphere.radius
             : Number.POSITIVE_INFINITY;
           const wantRich =
             multiTuft && near < (c.rich.visible ? LOD_NEAR_OUT_M : LOD_NEAR_IN_M);
           if (wantRich !== c.rich.visible) {
             changed = true;
           }
           c.rich.visible = wantRich;
           c.cheap.visible = !wantRich;
         }
         return changed;
       },
   ```

2. `app/_components/create-app.ts` render loop — replace the vegetation loop
   with:

   ```ts
       // Swap each vegetation chunk between the rich and cheap crown by
       // distance, and advance the wind sway (same clock as the water ripple).
       // A swap changes what casts shadows, so it invalidates the map — with
       // the follow dead zone (sun-rig.ts) nothing else redraws it for us.
       let lodChanged = false;
       for (const veg of vegControls) {
         if (veg.updateLod(camera.position)) {
           lodChanged = true;
         }
         veg.setTime(elapsed);
       }
       if (lodChanged) {
         invalidateShadows();
       }
   ```

   The Multi-Tuft toggle needs no extra call: the next frame's `updateLod`
   flips the affected cells and returns `true`. Add one sentence to the
   `invalidateShadows` doc comment (`:784-790`) naming the LOD swap as a
   caller.

**Verify**: `bun typecheck && bun lint` → exit 0.

### Step 3: Count shadow renders on `__poc`

1. `app/_components/poc-debug.ts` — add a required member next to `frames`:

   ```ts
     /** Frames on which the sun's shadow map was redrawn; e2e asserts it stays far below `frames` while walking. */
     shadowRenders: number;
   ```

   default it to `0` in `updatePocDebug`, and change `tickPocFrame` to
   `export function tickPocFrame(shadowRendered: boolean): void` that also
   does `if (shadowRendered) poc.shadowRenders += 1;`.
2. `create-app.ts` loop — replace the last two lines with:

   ```ts
       // Read the flag BEFORE the render: three clears it once the map is drawn.
       const shadowRendered = sunRig.shadowPending();
       postStack.render(dt);
       tickPocFrame(shadowRendered);
   ```

**Verify**: `bun typecheck && bun lint` → exit 0 (the compiler flags every
other `tickPocFrame()` call site if one exists — there should be exactly one).

### Step 4: Unit-test the rig

Create `app/_components/sun-rig.test.ts` (model on `visual-style.test.ts`):

```ts
import { expect, test } from "bun:test";
import { Box3, DirectionalLight, Scene, Vector3 } from "three";
import { createSunRig } from "./sun-rig";

function rig() {
  const scene = new Scene();
  const bounds = new Box3(new Vector3(-1000, 0, -1000), new Vector3(1000, 300, 1000));
  const sunRig = createSunRig(scene, bounds, { lat: 51.05, lng: 13.74 });
  const sun = scene.children.find((o) => o instanceof DirectionalLight) as DirectionalLight;
  return { sunRig, sun };
}
```

Tests:

1. `"the map is marked for redraw once at construction"` → `sun.shadow.needsUpdate === true`, `sun.shadow.autoUpdate === false`, `sunRig.shadowPending() === true`.
2. `"follow inside the dead zone does not redraw"` → `follow(new Vector3(0, 100, 0))` (first call re-centres → `needsUpdate` true); set `sun.shadow.needsUpdate = false`; `follow(new Vector3(5, 100, 0))`, `follow(new Vector3(0, 100, 19))`, `follow(new Vector3(-10, 105, 10))` → still `false` after each.
3. `"follow beyond the dead zone re-centres and redraws"` → after the sequence above, `follow(new Vector3(25, 100, 0))` → `needsUpdate === true`; the light's `target.position` is within one texel of `(25, 100, 0)`; a purely vertical move of 25 m also redraws.
4. `"the sun moving always redraws"` → clear the flag; `update(new Date("2026-06-21T10:00:00Z"))` → `true`.
5. `"invalidateShadow redraws"` → clear the flag; `invalidateShadow()` → `true`.
6. `"nightFactor ramps across civil dusk"` → `update` at instants whose
   altitude you don't know is fine; instead assert monotonic ordering on
   three known Dresden instants: `2026-06-21T12:00:00Z` (`nightFactor === 0`,
   `aboveHorizon === true`), `2026-06-21T23:30:00Z` (`nightFactor === 1`,
   `aboveHorizon === false`), and that the returned `altitudeDeg` at noon is
   greater than 55.

**Verify**: `bun test app/_components/sun-rig.test.ts` → 6 pass.

### Step 5: Assert the saving end to end

Extend the regression test in `e2e/city-walk.spec.ts:388-404`:

```ts
  test("quality regresses while moving and recovers when still", async () => {
    const before = await page.evaluate(() => ({
      frames: window.__poc?.frames ?? 0,
      shadows: window.__poc?.shadowRenders ?? 0,
    }));
    await page.keyboard.down("KeyW");
    // 8 walking frames move at most 8 × 0.45 m = 3.6 m — inside the 20 m
    // follow dead zone, so the shadow map must not be redrawn on the way.
    await waitForFrames(page, 8);
    expect(await page.evaluate(() => window.__poc?.regressed)).toBe(true);
    const after = await page.evaluate(() => ({
      frames: window.__poc?.frames ?? 0,
      shadows: window.__poc?.shadowRenders ?? 0,
    }));
    const frames = after.frames - before.frames;
    const shadowRenders = after.shadows - before.shadows;
    expect(frames).toBeGreaterThanOrEqual(8);
    // Before the dead zone this equalled `frames` (one depth pass per frame).
    expect(shadowRenders).toBeLessThan(frames / 2);

    await page.keyboard.up("KeyW");
    await page.waitForFunction(() => window.__poc?.regressed === false, null, {
      timeout: slow(60_000),
    });
    expectNoErrors(errors);
  });
```

**Verify**: `bunx playwright test e2e/city-walk.spec.ts` → all pass. If the
shadow assertion fails, read the two deltas from the failure: `shadowRenders`
≈ `frames` means Step 1 is not in effect (STOP); a small non-zero count
(1–3) means LOD flips or the initial re-centre — acceptable, the `< frames/2`
bound already tolerates it.

### Step 6: Keep the recipe table true

In `.claude/skills/city-walker/SKILL.md`, the row
`| \`shadow.autoUpdate\` | false | re-render only when the snapped focus or the sun moves (throttle) |`
(line 80) becomes
`| \`shadow.autoUpdate\` | false | re-render only when the player leaves a 20 m dead zone around the last frustum centre, the sun moves, or a caster changes (\`invalidateShadows()\`, incl. the crown LOD swap) |`.

**Verify**: `grep -n "dead zone" .claude/skills/city-walker/SKILL.md` → 1 match.

## Test plan

- `sun-rig.test.ts`: 6 tests as listed (construction, dead-zone hold,
  re-centre, sun move, explicit invalidate, night factor).
- e2e: the extended regression test asserts `shadowRenders < frames / 2`
  over 8 walking frames.
- `bun run verify` → all pass; `bun run test:e2e` → all pass.

## Done criteria

- [ ] `bun run verify` exits 0; `app/_components/sun-rig.test.ts` exists and passes
- [ ] `bun run test:e2e` exits 0 and the regression test asserts on `shadowRenders`
- [ ] `grep -n "FOLLOW_DEAD_ZONE_M" app/_components/sun-rig.ts` → ≥ 2 matches
- [ ] `grep -n "updateLod: (cameraPos: Vector3) => boolean" app/_components/vegetation-layer.ts` → 1 match
- [ ] `grep -n "shadowRenders" app/_components/poc-debug.ts e2e/city-walk.spec.ts` → matches in both
- [ ] `grep -n "re-renders on most frames" app/_components/sun-rig.ts` → 0 matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- `createSunRig` cannot be constructed under `bun test` (e.g. the `Sky`
  import from `three/examples/jsm/objects/Sky.js` fails) — report the error;
  do not stub three.
- The e2e assertion shows `shadowRenders ≈ frames` after Step 1 (something
  else is setting `needsUpdate` every frame — find the caller, report it).
- Anything requires touching the shadow recipe constants or the post stack.

## Maintenance notes

- **Every new shadow caster or depth-affecting material change must call
  `invalidateShadows()`** — this was already the rule, but the every-frame
  re-render used to paper over missing calls while walking. From now on a
  missing call is a *visible* stale shadow. Reviewers: when a PR adds a
  layer, a visibility toggle, or a material swap, look for the call.
- The 20 m dead zone is a coverage trade: at 110 m half-size the player keeps
  ≥ 90 m of high-resolution shadow in every direction. If `SHADOW_RADIUS`
  ever shrinks, shrink `FOLLOW_DEAD_ZONE_M` with it (keep it ≤ ¼ of the
  radius).
- A follow-up worth measuring on a real GPU: bias the re-centre 20–30 m
  *ahead* along the view direction so long shadows in front of the player
  clip less often at low sun. Not done here because it needs the `--headed`
  snapshot harness to judge.
- The pixel-ratio drop while moving (plan 007, step 4) remains open and is
  independent of this change.
