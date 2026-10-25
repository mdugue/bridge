# 076 — Streaming without holes: the ground first, a plate under everything, coarse buildings and trees from the start

**Status:** IN PROGRESS (2026-10-25) — steps 1 and 2 built; 3 and 4 open.
Asked by the maintainer on 2026-10-25: the spawn tile loads in full while
others show nothing, trees come late, long flights show large holes in the
ground; everything should be there from the start and refine smoothly,
with no cost in frame time, phone memory or the bytes before the first
picture.

## Findings (Dresden, gzip, 15 tiles)

| Content | per tile | whole site | when it loaded |
| --- | --- | --- | --- |
| buildings, full LoD2 | 4.1 MB (max 7.4) | 61.5 MB | whenever the tile is in view, at any distance — first of all |
| fine ground (TIN) + its rasters | 2.3 + ≈ 4.9 MB | 34 + 73 MB | within ≈ 2.6 km (a phone 2.1 km) |
| coarse ground (512²) + sky-view and horizon | 0.47 + 1.7 MB | 7 + 25 MB | otherwise |
| coarse crowns | 0.13 MB | 2 MB | behind every fine dressing, one at a time |

- 3DTilesRendererJS sorts its queues by screen-space error, highest first;
  a tile's buildings carry `TILE_ERROR` (100 000) so that they always show,
  so every visible tile's buildings queued ahead of any ground.
- Nothing stands in for a tile that never loaded or was evicted: `loadAncestors`
  only works between the two terrain levels of one tile.
- Buildings have one level: a tile 5 km away loads the same LoD2 as the
  one underfoot.
- The dressing (trees, lamps, furniture, rails) is one serial chain after
  the boot's gate; the coarse crowns wait behind the neighbours' fine
  dressings.

## Steps

1. **Load order** (built): `lib/city/stream-order.ts`, `orderStreaming`
   in `tile-stream.ts`. Nearest first with the coarse ground counted a tile
   (2 km) nearer, on one tile ground → buildings → fine ground; until the
   first frame the boot tile's ground and buildings first; a full cache
   admits in the same order (`keepOrder`). Measured headless, full profile,
   after a jump 400 m over the north-east of Dresden: see the PR.
2. **Ground plate** (built): `lib/city/ground-plate.ts`,
   `ground-plate-layer.ts`, `bakePlate` in `prepare-data.ts` — one site
   file of 33² heights and classes per tile, drawn wherever a tile has no
   terrain on screen. ≈ 0.6 MB of GPU buffers for Dresden.
3. **Coarse buildings** (open): LoD1 blocks from the footprints the minimap
   already loads, plus a height per object, as the far level of each
   tile's buildings (geometric error ≈ 20 m, LoD2 below it by REPLACE).
   The phone's memory must not grow: the far tiles' LoD2 it no longer
   loads pays for it. Then tune the distance falloff (`errorFalloff`).
4. **Trees from the start** (open): the coarse crowns of every tile as one
   site file at boot, out of the dressing chain; the fine crowns take over
   per tile.

Rejected for now: KTX2 for the rasters (data, not colour: block
compression would change class ids), implicit tiling (15 tiles), runtime
progressive meshes, Draco instead of meshopt, the library's
`TilesFadePlugin` (it patches GLSL through `onBeforeCompile`, ADR 0027).
