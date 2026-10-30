# ADR 0024: The build bakes each city into a 3D Tiles tileset that streams around the camera

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10 (absorbs ADRs 0003, 0006, 0007, 0008, 0022, 0050)

## Context

Decoding a GeoTIFF or parsing CityJSON in the browser cost seconds per
tile, and the results are deterministic functions of committed files. A
city is too large to load whole, and a fixed block of tiles ended at a
visible edge. Data files change rarely but must reach every client when
they do.

## Decision

- **Everything heavy is baked at build time** by `scripts/prepare-data.ts`:
  the browser decodes no GeoTIFF and parses no CityJSON. The build caches
  each artifact by content (inputs, the modules that bake it, the locked
  package versions).
- **The city is an OGC 3D Tiles 1.1 tileset of glTF 2.0 content**
  (meshopt, quantised, pre-gzipped), streamed by 3DTilesRendererJS. Per
  site tile: the buildings (one mesh, a feature id per vertex, a property
  table per object — `EXT_mesh_features`, `EXT_structural_metadata`) over
  the terrain at two levels, coarse far off and fine near the camera.
  Distance, not a role, decides which tile is detailed.
- **Content-hashed names and one manifest.** Every file is published as
  `<stem>.<hash>.<ext>` and served `immutable`; `manifest.json` (no-cache)
  names the hashed tileset, which names everything else.
- **Everything a tile brings is built and freed with it** in the dressing
  plugin (`processTileModel` / `disposeTile`), compiled before it shows.
- **Two phases.** The first frame waits on the spawn tile's buildings and
  any of its terrain levels; the dressing (trees, lamps, rails, furniture)
  then streams tile by tile, and the HUD flips to *ready* when the spawn
  tile is dressed and the stream is idle.
- **What streams is decided by a twin camera** whose far plane ends where
  the fog does, plus the sun's shadow camera while the sun is up, at a low
  resolution of its own.

## Consequences

- The world is bounded by the data, not by boot cost; collision, picking
  and demolish work on every loaded tile.
- Content opens in any glTF / 3D Tiles tool; the per-object table is
  inspectable metadata.
- Anything that builds a `/data` URL goes through the manifest.
- Anything added after the first frame redraws the shadow map and respects
  disposal, or it shows as a missing shadow or a leak.
- A new streaming need registers against the twin camera, not the camera.

## Alternatives

- **A hand-written tile manager with a loader worker and 1 km cells**
  (ADR 0022, never accepted): 1–1.5 k lines of what the library has.
- **CesiumJS, giro3d, iTowns:** a second renderer or a framework that owns
  the scene, against the stylised look and ADR 0002.
- **Runtime decode with a resolution knob:** the grid size is a bake-time
  property.
- **Terrain as a custom heightmap content type:** smaller, but a private
  format again.
- **Query-string cache busting, or mtime copies with revalidation:**
  inconsistent caches, or a round trip per file per visit.
