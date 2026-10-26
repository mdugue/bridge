# ADR 0050: A building tile's BVH is built when a ray first needs it, and no ray walks a tile without one

- **Status:** accepted; its worker alternative re-tried 2026-10-11 for the spawn tile ([plan 043](../plans/043-city-bvh-off-the-main-thread.md)'s findings): Turbopack does bundle the worker, but one importing three costs the scene's chunk its scope ([ADR 0051](./0051-optional-features-start-on-first-use-in-the-scene-chunk.md), +20.8 KB gz), and mobile-emulated it brought the first frame no earlier; the choice is open
- **Date:** 2026-10-10

## Context

Every building tile got its three-mesh-bvh BVH inside the parse that
landed it (`dressCity` in `city-layer.ts`): it held the main thread for
the whole build — estimated at ≈75 ms on a desktop, measured at 5–17 s
for one tile in a headless run on a four-core machine under four-fold
contention (plan 069's Findings) — and allocated six floats per triangle
beside the node buffers it keeps (≈50 MB of transient for two million
triangles; 19 MB kept for the spawn tile). Most loaded tiles never needed one: a tile far from the
camera is drawn and casts shadows, and is rarely walked into or clicked.

The crash reports (ADR 0043) then showed every crash on an iPhone, and
the page's process — not the GPU — running out: CITY-WALK-B died at
"boot after buildings" on safety level 3 with three's GPU count at
257 MB, one building tile and no terrain loaded, while the terrain was
still parsing next to the BVH's transient. The memory governor
(lib/city/memory-governor.ts) watches three's GPU count and never sees
any of it.

A BVH-less mesh is not safe to raycast: `Mesh.prototype.raycast =
acceleratedRaycast` (collision.ts) falls back to three's own triangle
loop for a geometry without a `boundsTree` — two million triangles a
ray. Only the collider's vertical rays skipped such a mesh; its
horizontal rays, the picks, the double tap and the autofocus would have
walked it.

## Decision

**A building tile's BVH is built when a ray first reaches the tile**
(`ensureCityBvh`), and **every ray against the buildings asks only the
tiles whose world box it enters, nearest first, through their BVH**:

- the collider (`createCityCollider`'s `build`) builds the tiles its rays
  reach — once the boot has placed the player on the spawn tile's ground;
  that placing builds the spawn tile's BVH, so the camera is never inside
  a building at the start pose (ADR 0032), and the build comes after the
  tile's terrain has landed instead of beside its parse;
- a user's pick (`pickCityObject`, demolish) builds up to its first hit
  (`nearestCityHit`); the probe (`cityObjectsAlong`) and the double tap
  take the ground first and build only the tiles before it, the probe's
  candidates behind the first hit only from tiles already built;
- the autofocus builds none (ten times a second);
- the tiles within 400 m of the camera are built in idle time, one at a
  time, at the 10 Hz pose tick (`nearestWithoutBvh`, `whenIdle`), so a
  walk into the next tile finds its BVH there.

three-mesh-bvh sorts the index in place and does not mark it for upload:
the GPU keeps the order it was given, the same triangles. A demolish
rebuilds a BVH only where there was one.

## Consequences

- **A new ray against the buildings goes through one of these paths**
  (`nearestCityHit`, `cityObjectsAlong`, the collider) and decides whether
  it may build: a ray straight at `city.mesh` with `intersectObject(s)` is
  a bug — on a tile without a BVH it is the brute-force loop.
- A far tile costs its BVH's memory only once something asks it: in the
  local mobile-emulated full-site run, two BVHs (32 MB) for the four
  building tiles loaded, where every one had its own before (plan 069's
  Findings: 421 against 464 MB of ArrayBuffers kept at "ready").
- The spawn tile's build now sits between its terrain landing and the
  first frame, on the boot's path — one BVH build later to the first
  frame (all of `boot:place`), where it used to overlap the terrain's
  download inside the city's parse; in exchange it no longer overlaps
  the terrain's parse, the window the iPhones died in. Deferring it past
  the first frame would only move the stall into the first frames the
  player steers (collision needs it there).
- A glide planned across tiles nobody has asked yet builds their BVHs as
  its path's vertical rays reach them — a one-time hitch per tile, at the
  start of that glide.
- The tiles' CPU arrays are counted (`cpuBytesOf` → `getGpuDebug().cpuMB`,
  the trail's heartbeat, the reports) so a later step can bring them into
  the cache's weighing and the governor; this ADR does not.

## Alternatives

- **Build in a worker** (plan 043's own worker): blocked on Turbopack,
  and composes with this (lazy *and* off-thread) if it is unblocked.
- **Keep the eager build, skip it only on a phone**: the phone is where
  the memory ran out, and a desktop gains the same parse time back.
- **`indirect: true`** (no index reorder): another Uint32 per triangle
  kept for good; the reorder is harmless (above).

## Amendment (2026-10-26): the near tiles' build in a worker

The worker alternative is no longer blocked: Turbopack bundles
`new Worker(new URL("./bvh-worker.ts", import.meta.url))` as it bundles
the ground worker (`ground-worker.ts`). The tiles within 400 m of the
camera, built ahead of a ray in idle time until then, are built in the
BVH worker (`bvh-client.ts`) — on a flight they were its longest stalls
(0.8–1.6 s on the phone profile). Lazy stays: a ray that needs a tile
now still builds it on the main thread. The positions and index are
handed over, not copied, so the page's memory does not grow (the build's
scratch is on the worker's heap instead of the page's); while they are
away `bvhBuilding` holds and every CPU reader passes the tile over or
waits (a demolish). The reorder stays as it was.
