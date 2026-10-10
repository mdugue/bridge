# Plan 071: A phone renders a lean scene, a desktop a lighter one

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the plans index — unless a reviewer dispatched you and told you they
> maintain it.
>
> **Drift check (run first)**:
> `git diff --stat 85a41b7..HEAD -- app/_components/scene-profile.ts app/_components/scene-profile.test.ts app/_components/post-stack.ts app/_components/create-app.ts app/_components/city-walk.tsx lib/city/gpu-safety.ts lib/city/gpu-safety.test.ts docs/rendering.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status (2026-10-10)**: **PARTIAL** — on the performance PR, with
  deviations: step 1 as **8** GTAO samples on a phone, not 0
  (`aoSamplesFor(profile, tier)`; the pass and its smoothing stay); step 2
  as a smaller rich-crown budget on a phone (`PHONE_RICH_TREE_BUDGET` =
  800, `vegetation-lod.ts`) instead of *Multi-Tuft* off; the 10 Hz
  autofocus ray no longer runs where no lens blur is built. **Step 4.2
  (no lens blur on a desktop) is REJECTED by the maintainer**: depth of
  field stays, always on, not parametrisable (the switch and focus
  controls went on the same PR). Open: step 3, step 4.1 (desktop DPR 1.5),
  step 5 (`streamFarFor` exists now), steps 6–7.

- **Priority**: P2 (P1 for the phone half if crashes are the top complaint)
- **Effort**: M
- **Risk**: MED — every step is a visible compromise the maintainer has accepted in principle ("slight visual compromises are OK"); each must still be looked at
- **Depends on**: none; step 5 needs plan 068
- **Category**: perf (phone stability and frame time; desktop fill-rate and GPU memory)
- **Planned at**: commit `85a41b7`, 2026-10-10

## Why this matters

`scene-profile.ts` says it plainly: "Same world, same shaders — only fill,
shadow texels and texture memory shrink; AO quality follows the profile,
not the tier." So a phone runs the desktop's **16-sample GTAO** plus a
25-tap smoothing pass every frame, the desktop's **rich crown budget**
(2 500 multi-tuft crowns of ~1 440 triangles ≈ 3.6 M triangles, drawn
again by the shadow pass), and lets the sun's shadow camera stream tiles
behind the player. A desktop renders at **device pixel ratio 2** — 5.2
megapixels on a 13″ retina laptop — and builds a depth-of-field pass that
holds six targets plus a full-resolution copy of the frame ("23 MB at an
iPhone's 603×1311 drawing buffer", `scene-profile.ts` `PostProfile.dof`;
≈ 6.6× that at 2880×1800) whether the lens is in use or not. These are
the cheapest large levers on frame time and on the phone's memory, and
each is a construction-time choice per tier.

## Current state

- `app/_components/scene-profile.ts`
  - Line 159: `const PIXEL_RATIO_CAP = { desktop: [2, 1.5, 1.25, 1], mobile: [1.5, 1.25, 1, 0.85] }` (per safety level 0–3); `pixelRatioFor` (line 174).
  - Lines 294–296:
    ```ts
    export function aoSamplesFor(profile: SceneProfile): number {
      return profile === "lite" ? 8 : 16;
    }
    ```
  - Lines 337–345:
    ```ts
    export function postProfileFor(tier: DeviceTier): PostProfile {
      return tier === "mobile"
        ? { dof: false, antialias: "fxaa", warmStyles: "outline-only", warmPaper: false }
        : { dof: true, antialias: "smaa", warmStyles: "all", warmPaper: true };
    }
    ```
  - Tests: `scene-profile.test.ts:50–54` (pixel ratios), `:95–98`
    (`"aoSamplesFor halves the GTAO samples only in the lite profile"`).
- `app/_components/post-stack.ts:489–502` — the AO, built unconditionally:
  ```ts
  const aoPass = ao(depth, null as never, lens.camera);
  aoPass.resolutionScale = 0.5;
  ...
  aoPass.samples.value = aoSamples;
  const aoTexture = aoSmoothed(aoPass.getTextureNode(), depthTexture, lens);
  const contact = uniform(LOOK_DEFAULTS.contact * AO_INTENSITY_MAX);
  const occlusion = pow(aoTexture.r, contact);
  const lit = vec4(colour.rgb.mul(occlusion), colour.a);
  const litAt = (at: V2): V3 =>
    texture(target.texture, at).rgb.mul(
      pow(texture(aoTexture.value, at).r, contact)
    );
  ```
  `occlusion` also feeds the FXAA path (`antialiasingOf`, `direct:
  vec4(sceneAa.rgb.mul(occlusion), …)`) and `litAt` feeds the picture
  styles (`createStylize({ … litAt })`). `dispose` frees `aoTexture` and
  `aoPass` (lines ~1008–1009). `createPostStack` receives `aoSamples` from
  `create-app.ts:1445` (`aoSamplesFor(budget.profile)`).
- `lib/city/look-controls.ts:412` — `multiTuft: true` in `LOOK_DEFAULTS`;
  `lib/city/vegetation-lod.ts:39` — `RICH_TREE_BUDGET = 2500`; the rich
  tier is used only for chunks whose control reports `multiTuft()` true
  (`vegetation-layer.ts:1291`, and the cadastre's `swapCrownLod`,
  `tree-inventory-layer.ts:593`).
- `app/_components/city-walk.tsx:507–514` — the look store is created
  once from `LOOK_DEFAULTS` (plus the remembered style); `budget` is in
  scope there.
- `lib/city/gpu-safety.ts:193–195`:
  ```ts
  export function shadowTilesStream(level: SafetyLevel): boolean {
    return level < 2;
  }
  ```
  used at `create-app.ts:1360`; tested at `gpu-safety.test.ts:201`.
- The HUD hides the depth-of-field switch when the profile has no lens
  blur: `city-walk.tsx:1241` passes `lensBlur={postProfileFor(budget.tier).dof}`;
  `scene-sidebar.tsx:985, 1100` read it.

Context to keep: phones' crashes are GPU memory (ADR 0046/0047); the
memory governor and safety ladder stay as they are — this plan lowers what
level 0 asks for.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Unit tests | `bun run test` | all pass |
| Focused | `bun test app/_components/scene-profile.test.ts lib/city/gpu-safety.test.ts` | all pass |
| Typecheck / lint | `bun typecheck && bun run fix && bun lint` | exit 0 |
| E2E | `bun run build && bun run test:e2e` | all pass (the `@phone` group included) |
| Phone on the LAN | `bun dev` (HTTPS) | `/dresden` on the phone |
| Real-GPU plates | `bun run shots` | PNGs in `shots/` |

## Scope

**In scope**: `app/_components/scene-profile.ts` (+ test),
`app/_components/post-stack.ts` (the AO-less branch),
`app/_components/create-app.ts` (passing tier to the AO and shadow-stream
choices), `app/_components/city-walk.tsx` (the per-tier look default),
`lib/city/gpu-safety.ts` (+ test), `lib/city/atmosphere.ts` (step 5 only),
`app/_components/crash-trail.ts` (only `"dof"` in `TRAIL_QUERY`), AGENTS.md (the knob),
`docs/rendering.md` (the frame-budget table), `docs/guide/{en,de}/*` only
where they describe depth of field or contact shadows on a device.

**Out of scope**: the memory governor and its lines; the tile cache bounds;
the shadow map sizes; the picture styles; Modell.

## Git workflow

- Branch: `perf/071-tier-budgets`
- One commit per step, e.g. `perf(phone): no contact-shadow pass on a phone`.
- Visual change → the PR carries snapshots (`pr-snapshots` skill).

## Steps

### Step 1: No GTAO on a phone

Change `aoSamplesFor` to take the tier and return 0 for a phone:

```ts
/**
 * GTAO samples for a profile and tier; 0 = no contact-shadow pass at all.
 * A phone pays for the pass and its 25-tap smoothing every frame; the clay's
 * ground shade and the baked sky view still darken what meets the ground.
 */
export function aoSamplesFor(profile: SceneProfile, tier: DeviceTier = "desktop"): number {
  if (tier === "mobile") {
    return 0;
  }
  return profile === "lite" ? 8 : 16;
}
```

In `post-stack.ts`, when `aoSamples === 0`: do not create `aoPass` or
`aoTexture`; set `occlusion = float(1)`; `litAt = (at) =>
texture(target.texture, at).rgb`; make the `contact` row a no-op; guard
both disposals (`aoTexture?.dispose(); aoPass?.dispose();`). Keep the
desktop branch byte-for-byte as it is. Pass the tier at
`create-app.ts:1445` (`aoSamplesFor(budget.profile, budget.tier)`).

Update `scene-profile.test.ts:95–98`: desktop full 16, desktop lite 8,
mobile (either profile) 0. The `@phone` e2e group runs the lite profile
on a phone viewport — check whether it asserts the AO pass exists
(`grep -n "ao\|contact" e2e/*.ts`); if one does, STOP and report.

**Verify**: `bun test app/_components/scene-profile.test.ts && bun typecheck` → pass;
`bun run build && bun run test:e2e` → pass.

### Step 2: No multi-tuft crowns on a phone by default

In `city-walk.tsx:508`, start the look store with
`multiTuft: budget.tier !== "mobile"` (the *Erweitert* switch still turns
them on). Add one sentence to the comment above it. Nothing else changes:
every crown chunk's `allowRich` follows `multiTuft()`.

**Verify**: `bun typecheck && bun run test` → pass. On a phone in
`bun dev`, the crash trail's beat (`crashTrail.current()`) shows fewer
`triangles` at the spawn than on `main` (record both).

### Step 3: The shadow camera streams no tiles on a phone

Change `shadowTilesStream(level)` to `shadowTilesStream(level, tier)`:
`tier === "desktop" && level < 2`. Update the call at
`create-app.ts:1360` and the test at `gpu-safety.test.ts:201` (desktop:
true, true, false, false; mobile: all false). Doc comment: the shadow
camera's tiles are tiles in use the governor cannot free, and on a phone
the casters that matter stand on the tile the player is on.

**Accepted compromise**: at a tile seam with the sun behind the player,
the neighbour tile's buildings cast no shadow into view until that tile
is loaded for the view camera.

**Verify**: `bun test lib/city/gpu-safety.test.ts && bun typecheck` → pass.

### Step 4: The desktop renders at 1.5× and builds no lens blur

1. `PIXEL_RATIO_CAP.desktop` → `[1.5, 1.25, 1, 1]` (comment: a retina
   laptop at 2× is 5.2 MP of post stack; 1.5× is 56 % of it, with SMAA
   on top). Update `scene-profile.test.ts:50` (`pixelRatioFor("full",
   "desktop", 3)` → 1.5) and any safety-level ladder assertion that
   pinned 2.
2. `postProfileFor("desktop").dof` → `false`. The HUD's DoF switch and
   focus controls then hide on a desktop as on a phone (they read
   `postProfileFor(budget.tier).dof`). Keep the lens blur buildable for
   stills: add a URL knob `?dof=1` (parsed in `scene-profile.ts` like
   `forceWebGLFromSearch`, carried in `SceneBudget` as `lensBlur`), and
   make `postProfileFor(tier, lensBlur = false)` return `dof: lensBlur`
   on a desktop; update both call sites (`create-app.ts:1447`,
   `city-walk.tsx:1241`). List `?dof=1` in AGENTS.md's URL knobs and add
   `"dof"` to `TRAIL_QUERY` (`app/_components/crash-trail.ts:45`, the
   crash trail's allowlist of QA knobs since plan 058).
3. Update the `postProfileFor` tests.

**Verify**: `bun test app/_components/scene-profile.test.ts && bun typecheck && bun run test` → pass.

### Step 5 (needs plan 068): a phone's stream ends before the fog does

If `streamFarFor` exists (plan 068), give it a tier factor: on a phone the
stream ends at `min(streamFarFor(...), 2200)` m — the fine level's reach
on an iPhone is ≈ 2.1 km, so beyond it a phone streams only coarse levels
it draws as near-fog. Test it in `lib/city/atmosphere.test.ts`. If plan
068 has not landed, skip this step and say so in the PR.

### Step 6: Measure and look

- Desktop (real GPU, Chrome): at the spawn and at a 200 m fly view, `main`
  vs branch: frames per second over 10 s standing still and while walking
  (the HUD's *Erweitert* counters or the trail's beat `fps`), and
  `__poc.handle.getGpuDebug()` totals. Record them.
- Phone (iPhone Safari; Android Chrome if available): the same, plus
  `heldMB` from the beat after a flight across the site and back; note any
  `memory` or `gpu-error` notes in `crashTrail.current()`.
- Plates (`bun run shots`) at the spawn, at a wall's foot on a lawn at low
  sun (where GTAO shows most), and in a park with trees near the camera —
  `main` vs branch, desktop and phone viewports.

**Verify**: the numbers and plates are in the PR.

### Step 7: Docs

`docs/rendering.md`, "The frame budget" table: GTAO samples
(desktop 16, phone none), pixel ratio (desktop ≤ 1.5 …), post (desktop:
no DoF unless `?dof=1`), shadow camera (phone: never), and a sentence
that a phone's crowns start without the rich tier. Keep the guide pages
(`docs/guide/en`, `docs/guide/de`) in step if they describe the depth of
field or the contact shadows as always on (`grep -rn -i "tiefenschärfe\|depth of field\|kontaktschatten\|contact shadow" docs/guide`).

**Verify**: `bun run test` → pass (the guide-label and link tests).

## Test plan

- `scene-profile.test.ts`: `aoSamplesFor` per tier; the desktop pixel
  ratio cap; `postProfileFor` with and without `lensBlur`; the `?dof=1`
  parser.
- `gpu-safety.test.ts`: `shadowTilesStream` per tier and level.
- `atmosphere.test.ts` (step 5).
- No unit test can build the post stack (it needs a renderer); the e2e
  suite covers that the AO-less phone pipeline renders.

## Done criteria

- [ ] `bun typecheck`, `bun lint`, `bun run test` exit 0
- [ ] `bun run build && bun run test:e2e` passes, the `@phone` group included
- [ ] `aoSamplesFor("full", "mobile") === 0` is tested; post-stack builds no `ao(` pass when it is 0 (`grep -n "aoPass" app/_components/post-stack.ts` shows it guarded)
- [ ] `shadowTilesStream(0, "mobile") === false` is tested
- [ ] Measurements and plates in the PR; `docs/rendering.md` table updated
- [ ] No files outside the in-scope list modified

## STOP conditions

- Drift in the excerpts.
- A picture style breaks on a phone without AO (its `litAt` reads a
  disposed or missing texture — a WebGPU validation error in the console).
- A desktop plate at 1.5× looks unacceptably soft to the maintainer
  (report; the cap is one number to revert).
- Any e2e spec asserts the presence of the AO pass, the DoF switch on a
  desktop, or a pixel ratio of 2.

## Maintenance notes

- A future adaptive-resolution governor (backlog item "pixel-ratio drop
  while moving") should step *within* these caps, not raise them.
- New per-pixel passes should get a per-tier switch at construction from
  the start (see `PostProfile`), never a uniform that only zeroes them.
- Reviewer: check that the desktop AO branch is unchanged and that the
  phone's styled pipelines still read `litAt`.
