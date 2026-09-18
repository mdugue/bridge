# Plan 002: Remove per-frame waste from the render loop (terrain BVH, on-demand shadows, half-res transmission)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8075a21..HEAD -- app/_components/create-app.ts app/_components/city-layer.ts app/_components/three-utils.ts app/_components/three-utils.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (PR #16 rewrites large parts of
> `create-app.ts` and `city-layer.ts`; if it has merged, stop and ask
> whether to port — every change here is under 10 lines and ports easily,
> but the excerpts will not match.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-test-baseline-and-real-e2e-frames.md (for the `three-utils.test.ts` file this plan extends and for `bun run test` covering `app/`)
- **Category**: perf
- **Planned at**: commit `8075a21`, 2026-09-18

## Why this matters

Four independent, measured or verified sources of waste in the frame loop:

1. **Un-accelerated terrain raycast at 10 Hz.** The depth-of-field autofocus
   raycasts the terrain mesh every 100 ms. The terrain only gets a BVH when
   the user double-taps (touch travel), which desktop users never do. Without
   the BVH, three.js's stock `Mesh.raycast` tests all ~522k terrain triangles.
   Measured with the same geometry under Bun: **48 ms per raycast without a
   BVH, 0.04 ms with one; building the BVH once costs 198 ms**. Today that is
   a ~48 ms main-thread stall ten times per second for every desktop user
   with DoF on (the default).
2. **Shadow map re-rendered every frame.** `renderer.shadowMap.autoUpdate`
   is left at its default `true`, so every frame renders a depth pass over
   terrain + city (~640k triangles) into a 2048² map, although the shadow
   map only changes when the sun, the buildings, or the inserted object
   change.
3. **Full-resolution transmission pass.** The default "ghost" style uses
   `MeshPhysicalMaterial.transmission`, which makes three render the opaque
   scene a second time into a transmission buffer every frame. The material
   has `roughness: 0.8`, so it samples a blurred mip anyway;
   `renderer.transmissionResolutionScale` (present in three 0.186, default
   1.0) can halve that buffer's resolution at no visible cost.
4. **Wasted MSAA backbuffer.** `WebGLRenderer({ antialias: true })` allocates
   a multisampled default framebuffer, but every scene pixel goes through the
   `EffectComposer` (whose comment says "SMAA carries the antialiasing"); the
   only thing hitting the default framebuffer is a full-screen quad.

Plus two small correctness items in the same files: the demolish pick
collects and sorts every hit along the ray instead of stopping at the first,
and `disposeObject3D` never frees the loader material stashed in
`userData.originalMaterial`, so each demolish leaks one compiled shader
program while a non-standard style is active.

## Current state

- `app/_components/create-app.ts` — renderer creation (`createRenderer`,
  lines 151–164), terrain load + world assembly (lines 282–296), sun rig
  update (line 296), double-tap lazy BVH (lines 382–394), `demolishAtCrosshair`
  (405–414), `insertBuilding` (416–432), `updateFocus` (472–483), the handle
  (`setSun` 502, `setStyle` 503–506, `setBuildingTransparency` 511–512).
- `app/_components/collision.ts` — patches `BufferGeometry.prototype.computeBoundsTree`
  and `Mesh.prototype.raycast` at import time (lines 12–14). `create-app.ts`
  imports it, so the patch is active before any code in `bootApp` runs.
- `app/_components/city-layer.ts` — `pickCityObjectId` (lines 84–98).
- `app/_components/three-utils.ts` — `disposeMaterial` / `disposeObject3D`.
- `app/_components/visual-style.ts:243` — `mesh.userData.originalMaterial ??= mesh.material;`
  (the stash that leaks).

Excerpt — `create-app.ts:151-164`:

```ts
function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.domElement.style.display = "block";
  // Touch gestures (look/pinch/double-tap) need the browser to keep its
  // hands off scrolling and double-tap zoom on the canvas.
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);
  return renderer;
}
```

Excerpt — `create-app.ts:282-296`:

```ts
  opts.onProgress?.("Loading DGM terrain…");
  const terrain = await loadTerrain({
    url: opts.demSrc,
    tfwUrl: opts.demTfwSrc,
    offset,
    signal: opts.signal,
  });
  ensureAlive();
  assertCityOnTerrain(offset, terrain);
  world.add(terrain.mesh);

  world.updateMatrixWorld(true);
  const worldBounds = new Box3().setFromObject(world);
  const sunRig = createSunRig(scene, worldBounds, tileLatLng(cityData, offset));
  sunRig.update(opts.initialDate);
```

Excerpt — `create-app.ts:382-394` (the lazy BVH to delete):

```ts
    onDoubleTap: (ndcX, ndcY) => {
      // Travel to the tapped spot on the terrain.
      if (!terrain.mesh.geometry.boundsTree) {
        // Lazy: ~500k triangles, only pay the BVH build when actually used.
        terrain.mesh.geometry.computeBoundsTree();
      }
      tapRaycaster.setFromCamera(new Vector2(ndcX, ndcY), camera);
      const hit = tapRaycaster.intersectObject(terrain.mesh, false)[0];
      if (hit) {
        const epsg = worldToEpsg(hit.point.x, hit.point.z, offset);
        teleportTo(epsg.x, epsg.y);
      }
    },
```

Excerpt — `create-app.ts:405-432`:

```ts
  const demolishAtCrosshair = () => {
    const objectId = pickCityObjectId(camera, cityLayer);
    if (!objectId) {
      return;
    }
    cityLayer = demolishObject(cityLayer, world, objectId);
    // The reload produces bare loader meshes — re-dress them.
    applyCityStyle(cityLayer.group, currentStyle, styleResources);
    emitStats();
  };

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

Excerpt — `create-app.ts:472-483` and handle lines `501-518`:

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
// ...
  return {
    setSun: (date) => sunRig.update(date),
    setStyle: (style) => {
      currentStyle = style;
      applyCityStyle(cityLayer.group, style, styleResources);
    },
    setDepthOfField: (enabled) => postStack.setDepthOfField(enabled),
    setDepthGrading: (intensity) => postStack.setDepthGrading(intensity),
    setContactShadows: (strength) => postStack.setContactShadows(strength),
    setPaperGrain: (intensity) => postStack.setPaperGrain(intensity),
    setBuildingTransparency: (transparency) =>
      setCityTransparency(styleResources, currentStyle, transparency),
```

Excerpt — `city-layer.ts:84-98`:

```ts
/** Raycasts the screen center and resolves the aimed CityObject id. */
export function pickCityObjectId(
  camera: Camera,
  layer: CityLayer
): string | null {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  for (const hit of raycaster.intersectObject(layer.group, true)) {
    const obj = hit.object as unknown as CityObjectsMeshLike;
    if (obj.isCityObject && obj.resolveIntersectionInfo) {
      return obj.resolveIntersectionInfo(hit).objectId ?? null;
    }
  }
  return null;
}
```

Excerpt — `three-utils.ts:1-31`:

```ts
import type { BufferGeometry, Material, Object3D } from "three";

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (Array.isArray(material)) {
    for (const m of material) {
      disposeMaterial(m);
    }
    return;
  }
  // Style materials are shared across demolish-reloads; freeing them here
  // would force a shader recompile (or break textures) on the next frame.
  if (material && !material.userData.shared) {
    material.dispose();
  }
}

export function disposeObject3D(root: Object3D): void {
  root.traverse((obj) => {
    const resource = obj as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    resource.geometry?.dispose();
    disposeMaterial(resource.material);
  });
}
```

Facts verified in `three@0.186.0` sources:

- `WebGLShadowMap.render` returns immediately when
  `autoUpdate === false && needsUpdate === false`, and resets `needsUpdate`
  to `false` after rendering. The transmission pre-pass saves and restores
  both flags, so a pending `needsUpdate` survives it.
- `WebGLRenderer.transmissionResolutionScale` exists (default `1.0`) and
  scales the transmission render target size.
- three-mesh-bvh's `acceleratedRaycast` falls back to the stock brute-force
  path when `geometry.boundsTree` is absent; `raycaster.firstHitOnly` only
  affects the BVH path.
- The e2e spec asserts `window.__poc.shadowsEnabled === true`, which reads
  `renderer.shadowMap.enabled` — unaffected by `autoUpdate`.

Conventions: Conventional Commits, lowercase subject; comments explain the
"why" in the style of the existing ones; no `console.log`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Unit tests | `bun run test` | all pass |
| E2E | `bun run test:e2e` | 3 passed |
| Build | `bun run build` | exit 0 |
| Everything fast | `bun run verify` | exit 0 (added by plan 001) |

## Scope

**In scope**:
- `app/_components/create-app.ts`
- `app/_components/city-layer.ts` (`pickCityObjectId` only)
- `app/_components/three-utils.ts`
- `app/_components/three-utils.test.ts` (add one case)
- `plans/README.md` (status row)

**Out of scope**:
- `app/_components/sun-rig.ts` — the shadow camera sizing/quality (a
  separate, visual decision; see the "deferred" list in `plans/README.md`).
- `app/_components/post-stack.ts`, N8AO quality, DoF parameters, pixel ratio
  — quality tiering for mobile is a separate item.
- `terrain.mesh.castShadow` — leave it `true`; changing what casts shadows is
  a visual decision for the maintainer.
- `app/_components/visual-style.ts` — plan 003 owns it.
- Any change to the handle's public method names (the e2e spec depends on them).

## Git workflow

- Branch: `advisor/002-render-loop-quick-wins` from `main`.
- One commit per step (messages given per step).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the terrain BVH at load, delete the lazy build

In `bootApp`, immediately after `world.add(terrain.mesh);` (line 291):

```ts
  opts.onProgress?.("Indexing terrain…");
  // BVH for the 10 Hz autofocus ray and for double-tap travel. Building it
  // once costs ~0.2 s; without it every raycast brute-forces ~522k triangles
  // (~50 ms each on desktop).
  terrain.mesh.geometry.computeBoundsTree();
```

Then delete the four lines `if (!terrain.mesh.geometry.boundsTree) { … }`
inside `onDoubleTap` (keep the "Travel to the tapped spot" comment and the
raycast).

**Verify**: `bun typecheck` → exit 0; `grep -n "computeBoundsTree" app/_components/create-app.ts` → exactly one hit, before the `createSunRig` line.

Commit: `perf: build the terrain BVH at load for the autofocus raycast`.

### Step 2: First-hit-only pick with hoisted allocations

In `app/_components/city-layer.ts`, above `pickCityObjectId`:

```ts
// Hoisted: demolish picks happen on a key press, but there's no reason to
// allocate per call. firstHitOnly stops the BVH walk at the nearest hit
// instead of collecting and sorting every intersection along the ray.
const pickRaycaster = new Raycaster();
pickRaycaster.firstHitOnly = true;
const SCREEN_CENTER = new Vector2(0, 0);
```

and change the function body to use `pickRaycaster.setFromCamera(SCREEN_CENTER, camera)`
and `pickRaycaster.intersectObject(layer.group, true)`. Keep the loop
(with `firstHitOnly` it iterates at most one hit).

**Verify**: `bun typecheck` → exit 0; `grep -n "new Raycaster" app/_components/city-layer.ts` → one hit at module scope.

Commit: `perf: first-hit-only demolish pick`.

### Step 3: Render the shadow map on demand

1. In `createRenderer`, after `renderer.shadowMap.type = PCFShadowMap;`:

```ts
  // The sun and the buildings only change on user actions; re-rendering the
  // 2048² shadow map every frame (a depth pass over ~640k triangles) is
  // pure waste. bootApp raises needsUpdate whenever the scene changes.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
```

2. In `bootApp`, right after the `sunRig.update(opts.initialDate);` line, add:

```ts
  const invalidateShadows = () => {
    renderer.shadowMap.needsUpdate = true;
  };
  invalidateShadows();
```

3. Call `invalidateShadows()`:
   - in `demolishAtCrosshair`, after `applyCityStyle(...)`;
   - in `insertBuilding`, after `scene.add(obj);`;
   - in the handle: `setSun: (date) => { const state = sunRig.update(date); invalidateShadows(); return state; },`
   - in `setStyle`, after `applyCityStyle(...)` (clay's alpha-hash affects the depth pass);
   - in `setBuildingTransparency`, after `setCityTransparency(...)` (same reason).

**Verify**:
- `bun typecheck` → exit 0
- `grep -c "invalidateShadows()" app/_components/create-app.ts` → `6` (the initial call + five sites)
- `grep -n "shadowMap.autoUpdate = false" app/_components/create-app.ts` → 1 hit

Commit: `perf: render the shadow map only when the sun or the scene changes`.

### Step 4: Half-resolution transmission and no MSAA backbuffer

In `createRenderer`:

- Change the constructor to `new WebGLRenderer({ antialias: false, powerPreference: "high-performance" })`
  with the comment: `// No MSAA: everything renders through the EffectComposer and SMAA carries the AA (see post-stack.ts); a multisampled default framebuffer would only be resolved for a full-screen quad.`
- Add after `setPixelRatio`:

```ts
  // The ghost style's frosted transmission renders the opaque scene a second
  // time per frame; at roughness 0.8 it samples a blurred mip anyway, so a
  // half-resolution transmission buffer is visually free.
  renderer.transmissionResolutionScale = 0.5;
```

**Verify**: `bun typecheck` → exit 0; `bun run test:e2e` → 3 passed; open
`test-results/city-walk-smoke.png` — buildings still read as frosted
(light, slightly translucent) with dark outlines. This is the one visual
check.

Commit: `perf: drop the unused MSAA backbuffer and halve the transmission buffer`.

### Step 5: Free the stashed loader material on dispose

In `app/_components/three-utils.ts`, inside the `traverse` callback, after
`disposeMaterial(resource.material);`:

```ts
    // visual-style.ts stashes the loader's original material when it swaps
    // in a shared style material; free it too, or every demolish-reload
    // leaks one compiled program.
    const original = (obj.userData as { originalMaterial?: Material | Material[] })
      .originalMaterial;
    if (original && original !== resource.material) {
      disposeMaterial(original);
    }
```

Add a case to `app/_components/three-utils.test.ts` (created by plan 001):
a mesh whose `material` is a `userData.shared` material and whose
`userData.originalMaterial` is a plain `MeshBasicMaterial` → after
`disposeObject3D`, the original's dispose event fired once and the shared
one's did not.

**Verify**: `bun test app/_components/three-utils.test.ts` → 6 pass.

Commit: `fix: dispose the stashed loader material on demolish`.

### Step 6: Full verification

`bun run verify` → exit 0; `bun run build` → exit 0; `bun run test:e2e` → 3 passed.

## Test plan

- Unit: one new case in `app/_components/three-utils.test.ts` (Step 5).
- E2E: existing spec exercises demolish (shadow invalidation + pick),
  `setSun` is not called by the spec — do a manual check in `bun dev`: move
  the time slider and confirm shadows move; demolish a building (R) and
  confirm its shadow disappears; press B and confirm the orange box casts a
  shadow. Record the result in the status row.
- Verification: `bun run test` → all pass; `bun run test:e2e` → 3 passed.

## Done criteria

- [ ] `bun run verify` exits 0
- [ ] `bun run build` exits 0
- [ ] `bun run test:e2e` reports 3 passed
- [ ] `grep -c "computeBoundsTree" app/_components/create-app.ts` → `1` and it is not inside `onDoubleTap`
- [ ] `grep -c "invalidateShadows()" app/_components/create-app.ts` → `6`
- [ ] `grep -n "antialias: false" app/_components/create-app.ts` → 1 hit; `grep -n "transmissionResolutionScale = 0.5" app/_components/create-app.ts` → 1 hit
- [ ] `grep -n "firstHitOnly = true" app/_components/city-layer.ts` → 1 hit
- [ ] Manual shadow check (time slider, demolish, insert) recorded in the status row
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- The "Current state" excerpts do not match the live files.
- After Step 3, shadows visibly stop following the time slider or stay
  behind a demolished building even though `invalidateShadows()` is called
  at all five sites — report; do not revert to `autoUpdate = true`.
- After Step 4, the smoke screenshot shows heavy aliasing on building edges
  (SMAA is not in the final pass as this plan assumes) — report and revert
  only the `antialias` change.
- The e2e demolish assertion (`buildingCount` drops) fails after Step 2 —
  `firstHitOnly` returned a non-city hit first; report which object.

## Maintenance notes

- Every future mutation of scene geometry, materials that affect the depth
  pass, or the sun must call `invalidateShadows()`; a forgotten call shows
  up as a stale shadow, never as a crash. Reviewers should grep for it in
  any PR that adds scene objects (PR #16 adds several layers — port this
  rule when merging).
- If the terrain resolution grows beyond 512², the BVH build (~0.2 s now)
  grows roughly linearly; move it behind a progress message or into
  `requestIdleCallback` before it exceeds ~0.5 s.
- Deferred on purpose: shadow frustum following the player (sharper shadows,
  needs invalidation on movement), mobile quality tier (pixel ratio, N8AO
  half-res, 1024² shadow map), `terrain.castShadow = false`.
