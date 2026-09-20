# Plan 015: Show the scene while it is still loading (progressive first frame)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 3590838..HEAD -- app/_components/create-app.ts app/_components/city-walk.tsx app/_components/city-walk-client.tsx app/_components/poc-debug.ts app/_components/lamp-layer.ts app/_components/sun-rig.ts app/_components/height-fog.ts lib/city/tile.ts scripts/prepare-data.ts e2e/city-walk.spec.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: the loading-performance PR (plan 010, hashed `/data`,
  baked heightfields + building meshes, deferred terrain BVH) — all merged
  before this plan was written; plan 008's layer census is recommended as
  the safety net for the e2e changes in Step 6
- **Category**: perf / UX
- **Planned at**: commit `3590838` (branch `claude/app-loading-performance-156xny`), 2026-09-20

## Why this matters

Even after the loading-performance PR the viewer is all-or-nothing: the
overlay covers a black canvas until every tile, every layer and the
post-processing stack exist, and only then does the first frame render.
Measured on localhost (no network latency, four cores) the fetch/build
stretch is now ~3.3 s, of which the **primary tile alone is ~1.0 s**; on a
phone over a real connection the neighbours, rails, walls and the 4096²
rasters of three backdrop tiles dominate the wait for something the player
cannot even see from the spawn point.

Everything the first frame needs — the primary tile's terrain and
buildings, the sun, the post stack — is available after the first ~third of
the boot. The rest (three neighbour tiles, vegetation, lamps, rails, walls,
water) can stream in **while the player is already looking around**, each
addition followed by one shadow-map invalidation. The goal: the overlay
drops after the primary terrain + buildings, the HUD stays usable, and a
small non-blocking indicator shows what is still arriving.

## Current state

### The boot is one straight line (`app/_components/create-app.ts`, `bootApp`)

In order, each awaited before the next starts:

1. `fetchCityMesh(primary)` → `createCityLayer` — the recenter `offset` is
   read from the baked meta (`primaryCity.meta.offset`), no longer computed
   from a parse.
2. `loadTileScene(primary)` — walls features → `loadTerrain` (heightfield +
   three rasters) → `loadVegetation` → `loadLamps`.
3. `assertCityOnTerrain`.
4. Neighbours: `Promise.all(fetchCityMesh)` → `createCityLayer` ×3 →
   `Promise.all(neighbourTiles.map(loadTileScene))`.
5. `createLampLights(lampHeads)` — **built once, after all tiles**, so
   `NUM_POINT_LIGHTS` is baked into every lit program exactly once.
6. `loadRail` (all tiles' rail/bridge/railarea/platform GeoJSONs, needs the
   cross-tile `heightAt`), `loadWalls` (all tiles' features).
7. `world.updateMatrixWorld`, `worldBounds = new Box3().setFromObject(world)`,
   `valleyFloor` from every tile's `minElevation` →
   `heightFog.uFogHeightStart`, `createSunRig(scene, worldBounds, …)`,
   `setSun(opts.initialDate)`.
8. `createStyleResources`, `applyCityStyle` on every city group,
   `createPostStack`.
9. Camera spawn, controls, collider, movement, touch, `setAnimationLoop`,
   the idle-time terrain BVH builder, `emitStats()`, `return handle`.

The HUD (`city-walk.tsx`) keeps `status.phase === "loading"` until
`createCityWalkApp` resolves, then sets `"ready"`; the crosshair, FPS,
joystick, action buttons and the sidebar all render only in `"ready"`.
`window.__poc.ready` (`poc-debug.ts`, set in the HUD's `.then`) is what
every e2e spec waits on.

### What each late layer needs

| Layer | Needs | Today built at |
|---|---|---|
| neighbour buildings | `world`, the shared clay material | step 4 |
| neighbour terrain/water | `offset`, `heightFog`, `meadowNdvi`, `sunDirection` | step 4 |
| vegetation, lamps (per tile) | that tile's `heightAt` | inside `loadTileScene` |
| real lamp lights | every tile's lamp heads | step 5 |
| rails, bridges, walls | cross-tile `heightAt` (all tiles) | step 6 |
| sun rig | `worldBounds` (sky dome size + shadow frustum centre) | step 7 |
| height fog floor | min `minElevation` over all tiles | step 7 |
| minimap `landcoverTiles`, `terrainBounds` (`unionBounds`) | every tile's bounds | step 7 / handle |

### Conventions

- `invalidateShadows()` after **every** scene-topology change (the comment
  above it in `create-app.ts` is explicit: a missing call shows up as a
  stale shadow, never as a crash).
- `ensureAlive()` after every async step: the StrictMode remount aborts the
  first instance mid-load; anything added to the scene after the abort
  leaks.
- The lite profile (`?scene=lite`) has no neighbours; the e2e suite drives
  it and waits on `__poc.ready`.
- Conventional Commits.

## Scope

In: `create-app.ts` (the load path and the handle), `city-walk.tsx` (status
phases + a loading chip), `poc-debug.ts` (`firstFrame`), `lamp-layer.ts`
(a retargetable light pool), `sun-rig.ts` only if the sky-dome size has to
grow after the first frame, the e2e spec's boot wait, docs.

Out: any change to the data formats or bakes; any change to what is loaded
(the 2×2 block stays); the drawer/HUD layout.

## Steps

### Step 1: Split the boot into "first frame" and "rest"

In `bootApp`, keep steps 1–3 (primary buildings + primary terrain/water;
**move vegetation and lamps of the primary out of `loadTileScene` into the
rest**, so the first frame waits on terrain + buildings only), then run
steps 7–9 against the primary tile alone:

- `worldBounds`: `new Box3().setFromObject(world)` over the primary; the
  sun rig only needs a centre and the sky-dome radius — read
  `createSunRig` and, if the dome radius is derived from `worldBounds`,
  pass the **union of every tile's bounds** from the heightfield headers
  instead (they are known before any neighbour loads: fetch the four
  header JSONs up front — ~150 bytes each — and union their `bounds`; the
  `unionBounds`/`landcoverTiles` the handle exposes come from the same
  headers). STOP if the sky dome or fog needs anything else from the
  neighbours.
- `valleyFloor`: the primary tile's `minElevation` first; update
  `heightFog.uFogHeightStart.value` as each neighbour's terrain arrives
  (`Math.min`). Both are uniforms — no recompile.
- `createLampLights`: allocate the pool with **no heads** before the first
  frame (`createLampLights([])` must produce `MAX_REAL_LAMPS` lights so
  `NUM_POINT_LIGHTS` never changes — change `count` to
  `MAX_REAL_LAMPS`, lights idle at intensity 0 far away) and add
  `setHeads(heads: Vector3[])`; `updateNearest` reads the current list.

Return the handle **before** the rest loads. `emitStats()` and
`onProgress` keep working: emit stats again after each tile lands.

### Step 2: Stream the rest after the first frame

After `setAnimationLoop`, start an async `loadRest()` (not awaited by
`bootApp`) that, in this order and with `ensureAlive()` between steps:

1. primary vegetation + lamps → `scene.add`, `invalidateShadows()`;
2. neighbour building meshes (fetch all three concurrently, build in
   order) → `applyCityStyle`, `invalidateShadows()`, `emitStats()`;
3. neighbour terrain/water/vegetation/lamps (`Promise.all(loadTileScene)`)
   → push to `terrains` (order matters for `landcoverTiles`), lower the fog
   floor, `invalidateShadows()`;
4. `lampLights.setHeads(all heads)`;
5. rails + walls on the now-complete `heightAt` → `invalidateShadows()`;
6. the idle-time terrain BVH loop (already deferred) starts here, primary
   first.

Errors in `loadRest()` (other than aborts) must surface: call
`opts.onError?.(err)` (new optional callback) and keep the primary scene
running — a missing neighbour must never take the first frame down.

`heightAt` already tolerates missing tiles (first terrain that covers the
point wins, else `null`) — walking off the primary tile before its
neighbour lands falls back to `worldBounds.min.y` in `groundHeight`
callers; clamp the player to the **loaded** union bounds until step 3
lands (a two-line check in `stepMovement`), then release.

### Step 3: Fog and framing while the world is partial

Until step 2.3 lands, tighten the atmospheric fog (`scene.fog.far` ≈ the
primary tile's half-size + 300 m) so the missing neighbours read as haze,
not as a cliff edge; restore the user's fog slider value afterwards
(`setAtmosphere` already recomputes `near/far` from a 0..1 amount — store
the amount, apply a temporary override, reapply).

### Step 4: HUD: a non-blocking loading chip

`city-walk.tsx`: add a phase `{ phase: "streaming"; message }` between
`"loading"` and `"ready"`. `createCityWalkApp` resolves → `"streaming"`
(HUD, crosshair, joystick, sidebar all render; the overlay is gone); a new
`onLoaded()` callback from `loadRest()` → `"ready"`. Render `message` as a
small `bg-slate-900/55` pill next to the FPS readout while streaming.
Every `status.phase === "ready" &&` guard in the JSX becomes
`phase !== "loading" && phase !== "error"` (extract `const booted = …`).

### Step 5: Debug hook and e2e

`poc-debug.ts`: add `firstFrame: boolean` (true when the handle exists)
and keep `ready` for "everything loaded" (set from `onLoaded`). The e2e
boot waits (`waitForFunction(() => __poc.ready)`) keep their meaning; add
one assertion to the desktop suite: `__poc.firstFrame` becomes true
**before** `__poc.ready` and the canvas is visible while
`page.getByText(/Loading neighbouring|Building/)` (the chip) is still
present. In the lite profile there are no neighbours, so `ready` follows
`firstFrame` within the same boot — assert only the ordering there.

### Step 6: Docs

- `AGENTS.md` "QA" + the skill's "Scene architecture": describe the two
  phases and the rule "everything added after the first frame calls
  `invalidateShadows()`".
- `docs/transformations.md`: no data→feature change; add one line under
  the buildings/terrain entries that the neighbours stream after the first
  frame.

**Verify each step**: `bun run verify` → exit 0; `bun run build` → exit 0;
`bun run test:e2e` → all pass; one headed boot (`bun dev`) — the scene is
visible and walkable before the neighbours appear, no stale shadows after
they do (walk to a neighbour tile at low sun: trees and buildings there
must cast).

## Test plan

- Unit: none new beyond `createLampLights([])` producing a full idle pool
  (add a case to a new `lamp-layer.test.ts` if the pool becomes pure
  enough; otherwise cover through e2e).
- e2e: the ordering assertion (Step 5) + plan 008's layer census after
  `ready` (all layers present after streaming).
- Manual: real-GPU snapshot from a neighbour tile after streaming
  (`bunx playwright test e2e/snapshot-shot.spec.ts --headed`) — shadows,
  water and trees present on the neighbour.

## Done criteria

- [ ] Overlay gone and the canvas interactive after the primary tile
      (localhost: ≤ 1.5 s to `__poc.firstFrame`)
- [ ] `__poc.ready` still means "everything loaded"; e2e green
- [ ] No stale shadows / missing layers after streaming (layer census)
- [ ] `bun run verify`, `bun run build`, `bun run test:e2e` exit 0
- [ ] `plans/README.md` row updated

## STOP conditions

- `createSunRig` needs something from the neighbours that cannot come from
  the heightfield headers.
- `NUM_POINT_LIGHTS` changes after the first frame (a recompile storm).
- The StrictMode remount leaks objects added by `loadRest()` (check
  `renderer.info.memory` before/after a dev remount).
- Anything requires changing a data format or a bake.

## Maintenance notes

- New layers go into `loadRest()` unless the first frame cannot do without
  them; every addition ends with `invalidateShadows()` and an
  `ensureAlive()` before it.
- The "streaming" chip messages are the same `onProgress` strings; keep
  them short — they now sit in the HUD, not on an overlay.
