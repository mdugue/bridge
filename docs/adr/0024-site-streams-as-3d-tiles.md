# ADR 0024: The site streams as OGC 3D Tiles with glTF content through 3DTilesRendererJS

- **Status:** accepted (supersedes [ADR 0006](./0006-tile-block-with-one-primary-and-one-artifact-map.md) and the never-accepted [ADR 0022](./0022-stream-tiles-around-the-camera.md))
- **Date:** 2026-09

## Context

The viewer loaded a fixed 2×2 block at boot and never unloaded anything;
collision and demolish stopped at a "primary" tile's edge; every tile had
its own formats (a quantised heightfield header + blob, a building vertex
stream + meta JSON) with codecs on both sides. ADR 0022 proposed a
hand-written tile manager, loader worker, LOD cells and KTX2 — and
rejected 3DTilesRendererJS because adopting it "means rewriting every
bake". Plan 017 was about to rewrite every bake anyway.

## Decision

`scripts/prepare-data.ts` bakes the site into an **OGC 3D Tiles 1.1**
tileset (`lib/city/tileset.ts`) and 3DTilesRendererJS streams it.

- **Tree per site tile:** the buildings (refine ADD, always loaded when
  the tile is in view) over the terrain at two levels — 512² (geometric
  error 40 m) replaced by 1024² near the camera. Only the fine level is
  dressed (vegetation, lamps, rails, walls). Distance, not a role, decides
  which tile is detailed.
- **Content is standard glTF 2.0**: `EXT_meshopt_compression`,
  `KHR_mesh_quantization`, Y-up, pre-gzipped (`.glb.gz`, inflated by a
  renderer plugin). Each glTF names its side files (rasters, feature
  collections) in scene `extras` under `tileId` — never `tile`, which the
  renderer writes into `userData` itself.
- **Buildings carry their style per object**, the standard way:
  `EXT_mesh_features` ids per vertex into an `EXT_structural_metadata`
  property table (tint, roof colour, heights, glow, roughness, the demolish
  tree). The clay shader reads it from a float texture; demolish filters
  the index buffer.
- **The bake does what the browser did at load**: DGM resampling, wall
  breaklines (ADR 0014), the grid, the normals.
- **Dressing happens in a renderer plugin** (`processTileModel` /
  `disposeTile` in `app/_components/tile-stream.ts`), so everything a tile
  adds leaves with it. The heavy dressing waits for the HUD's gate
  (ADR 0008's second phase).
- **Shaders derive data-frame coordinates from world space**
  (`app/_components/shader-chunks.ts`): quantised positions are not in
  metres, but the `world` group only rotates, so world (x, y, z) is data
  (x, −z, y).
- The **sun's shadow camera** is a second camera of the renderer, so tiles
  that cast into the view stay loaded; `displayActiveTiles` keeps loaded
  tiles drawn when turning.
- The manifest (ADR 0007) stays the one `no-cache` entry: it names the
  hashed tileset, which names every hashed content file.

## Consequences

- The world is bounded by the data, not by boot cost; collision, demolish,
  focus and double-tap work on every visible tile.
- Content opens in any glTF / 3D Tiles tool; the per-object table is
  inspectable metadata, not a private format.
- Wire size per tile grew (≈1.4 MB buildings + 1.5 MB fine terrain +
  0.4 MB coarse terrain, gzipped, vs ≈1.0 + 1.1 MB before): quantised
  meshes, not a heightfield blob.
- Rails and walls are built per tile on the heights of every loaded
  terrain, no longer once for the whole block (ADR 0013's reason for the
  block build was the off-tile `heightAt`, which the global sampler now
  covers); seams need a look on a GPU (plan 019).
- The first frame waits on the spawn tile's buildings and any of its
  terrain levels; the lite e2e profile streams a spawn-only tileset.
- Tuning (error thresholds, LRU budget, which camera loads what) is new
  and GPU-bound (plan 019).
- The renderer patches materials in its fade and overlay plugins with
  `onBeforeCompile`; they are not used (they would clash with a later
  TSL migration, ADR 0027).

## Alternatives

- **The hand-written manager of ADR 0022:** 1–1.5 k lines of schedule,
  LRU, worker and budgets that the library already has.
- **CesiumJS:** a second renderer that owns lighting, atmosphere and
  shadows — the stylised look is this project's point.
- **Terrain as a custom content type (heightmap PNG + parser plugin):**
  smaller on the wire, but an own format again; revisit if wire size
  matters more than tooling.
- **3D Tiles implicit tiling:** worth it for a large regular quadtree; an
  explicit tree over a handful of tiles is simpler today.

## References

- `lib/city/tileset.ts`, `scripts/prepare-data.ts`, `scripts/bake-tiles.ts`,
  `scripts/tile-glb.ts`, `app/_components/tile-stream.ts`,
  `app/_components/city-layer.ts`, `lib/city/city-mesh.ts`; plans 018
  (condensed), 019; ADRs 0006, 0007, 0008, 0013, 0014, 0022.
