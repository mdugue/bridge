# ADR 0003: Bake heavy inputs at build time — the browser decodes no raster and parses no CityJSON

- **Status:** accepted
- **Date:** 2026-09 (heightfield: plan 004; building mesh and 2048² rasters: PR #28/#29)

## Context

The first versions fetched the raw DGM1 GeoTIFF (13.6 MB per tile, 12.6 MB
gzipped because float noise does not compress) and decoded and resampled it
on the main thread (~0.6 s per tile under Bun, more on a phone), and parsed
8–11 MB of CityJSON per tile (~0.5 s of JSON.parse, earcut triangulation
and attribute annotation each). Four tiles multiplied every cost. The
results of both steps are deterministic functions of committed inputs.

## Decision

`scripts/prepare-data.ts`, which already runs before `next dev` and
`next build`, bakes the heavy inputs once:

- the GeoTIFF becomes a **heightfield** — an n×n bilinear resample
  (1024² primary, 512² neighbours) quantised to centimetre `uint16`,
  `0xFFFF` = NoData, pre-gzipped, plus a small JSON header
  (`lib/city/heightfield.ts`, version 2);
- the CityJSON becomes a **binary building mesh** — the
  `cityjson-threejs-loader` parse run once, chunk meshes concatenated into
  one uint16-quantised vertex stream with per-vertex `objectid`, plus a
  per-object style table with the DOP roof colour folded in
  (`lib/city/city-mesh.ts`, version 1);
- the 4096² land-cover rasters get **2048² variants** for neighbours and
  phones (ADR 0016).

Outputs are cached in `.cache/prepare-data/` with mtime staleness against
the inputs *and* the bake's own source files.

## Consequences

- A 1024² tile goes 13.6 MB → ~1.1 MB on the wire; a building tile
  ~10 MB → ~1 MB; the client dequantises in one pass and uploads.
- `geotiff` and `cityjson-threejs-loader` are build-time dependencies;
  nothing under `app/` may import them.
- Demolish is a vertex-stream filter and rebuild, not a re-parse.
- Format versions (`HEIGHTFIELD_VERSION`, `CITY_MESH_VERSION`) must be
  bumped on any layout change; the bake re-runs on mismatch and the client
  rejects unknown versions.
- NoData vertices are parked at the mean valid elevation, not 0, so the
  bounding box used by the shadow camera and the spawn fallback is not
  dragged 110 m underground.
- The gzip is baked into the file because static hosts compress only
  text-like MIME types; the browser inflates with `DecompressionStream`.

## Alternatives

- **Runtime decode with a resolution knob:** rejected — the grid size is a
  bake-time property; emit several sizes if ever needed.
- **float32 heightfield left to the host to compress:** superseded by the
  uint16 + baked gzip format after the blob travelled uncompressed.
- **BatchedMesh for buildings:** moot — one merged mesh per tile already;
  it would break `objectid` picking.

## References

- plans 004 (heightfield) and the loading-performance PR (#28); ledger
  entries "Terrain heightfield", "Buildings", "Rasters at 2048²".
- `scripts/bake-heightfield.ts`, `scripts/bake-city-mesh.ts`,
  `lib/city/heightfield.ts`, `lib/city/city-mesh.ts`.
