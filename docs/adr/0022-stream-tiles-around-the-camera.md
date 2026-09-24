# ADR 0022: Stream tiles around the camera with a hand-written tile manager

- **Status:** proposed (supersedes ADR 0006 once plan 018 Phase 3 lands)
- **Date:** 2026-09

## Context

[ADR 0006](./0006-tile-block-with-one-primary-and-one-artifact-map.md)
fixed the world to a 2×2 block of 2 km tiles, loaded in full at boot, with
one "primary" tile for collision and demolish. The maintainer wants more of
the city. Loading more tiles up front does not scale:

- Wire cost is small: ~2.2–2.7 MB per neighbour tile.
- GPU memory is the binding limit. A 4096² RGBA splat is ~85 MB with mips,
  and every tile also carries terrain, water/mist sheets, a canopy cloud
  and a building mesh.
- Each tile that lands costs main-thread time: the canopy build, a terrain
  BVH and a texture upload.
- Collision and demolish stop at the primary tile's edge.

The serving side is not a constraint. The data is static, content-hashed
files behind an `immutable` cache header (ADR 0007), so the number of files
does not matter to Next.js or the host.

Ready-made streamers were evaluated: 3DTilesRendererJS, giro3d, iTowns,
geo-three and CesiumJS. Each one either requires OGC 3D Tiles, which would
mean re-baking everything and has no good form for our splatted
heightfield, or owns the scene and loop, or is a second renderer.

## Decision

The viewer streams tiles around the camera with a **hand-written tile
manager**:

- A **pure schedule** in `lib/city/` computes the desired set from the
  camera position and view direction on the regular tile grid, with
  distance-based levels, hysteresis on unload, distance/direction
  priority and an LRU memory budget per device tier.
- A **loader** turns one tile into a disposable handle, and nothing a tile
  adds outlives its `dispose()`.
- The heavy parsing and geometry building runs in a **module Web Worker**
  that returns transferable typed arrays. The main thread only wraps them
  and uploads at most one large resource per frame.
- Near the camera, the unit is a **1 km cell** baked from the 2 km source
  tiles. The existing 2 km artifacts serve as the mid-distance level.
- The **tile list comes from `manifest.json`**, not from a constant in
  code.
- Collision and demolish follow the camera's cell and its ring-1
  neighbours instead of a fixed primary tile.

The data stays static files (ADR 0001). The first frame still waits only
on the camera cell's terrain and buildings (ADR 0008).

## Consequences

- The world size is bounded by the data, not by boot cost or GPU memory.
- Every piece of scene state that assumed a world that only grows (fog
  edge, `groundFloor`, minimap bounds, lamp heads, block-wide rails and
  walls) has to be recomputed on unload as well as on load. A missing
  `invalidateShadows()` after an unload shows up as a stale shadow.
- The bake writes more, smaller files (four L0 cells per 2 km tile, with a
  one-sample heightfield overlap). Buildings are assigned to one cell and
  never cut.
- Committed sources grow ~25 MB per 2 km tile. Beyond ~15–20 tiles the
  baked data should move to object storage (an ADR 0004 amendment), which
  is still static.
- The e2e needs a teleport-and-wait spec. Headless still runs the lite
  profile (ADR 0018).

## Alternatives

- **Bigger fixed block (3×3, 5×5):** ~2.3× (or 6×) the boot cost and GPU
  memory for area the player rarely sees. It was rejected in ADR 0006 and
  still does not scale.
- **3DTilesRendererJS:** the right tool if the target becomes a whole
  region with a real LOD hierarchy. Today it would mean re-baking every
  artifact to 3D Tiles and re-plumbing the clay shader, objectid picking
  and demolish. Revisit it with its own ADR if the area outgrows a
  regular grid.
- **giro3d / iTowns / geo-three:** frameworks that own the scene and camera,
  or streamers of Web-Mercator map tiles. Neither fits an imperative scene
  with its own sun rig and post stack (ADR 0002).
- **CesiumJS:** a second renderer. Out.
- **The whole renderer in a worker (`OffscreenCanvas`):** it would move the
  HUD bridge, input, the `__poc` hook and the post stack across a message
  boundary. Moving only the loading into a worker gets most of the benefit.

## References

- [Plan 018](../plans/018-tile-streaming.md); [plan 017](../plans/017-germany-wide-sites.md) (site config and tile grid, which the manager builds on); ADR 0006, 0007, 0008, 0013,
  0018, 0020.
- `lib/city/tile.ts`, `app/_components/create-app.ts` (`loadRest`,
  `loadNeighbours`, `loadTileTerrain`, `loadTileDressing`).
