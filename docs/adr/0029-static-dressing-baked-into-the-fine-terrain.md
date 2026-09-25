# ADR 0029: Static dressing is baked into the fine terrain glTF

- **Status:** accepted
- **Date:** 2026-09

## Context

The fine terrain level is dressed in the browser from per-tile GeoJSON:
vegetation, lamps, rails, walls, and (briefly) stairs. For walls and stairs
that split one feature across two places. The ground under them was shaped
at build time (the wall breaklines, ADR 0014; the stair burn and terraces,
ADR 0028), while their geometry was built at runtime from the same file,
over whichever terrain levels happened to be loaded. Neither depends on
anything the runtime knows: no look slider, no time of day, no device.

## Decision

Geometry that depends only on baked data is baked into the fine terrain
glTF (`terrain_<tile>_l0.glb.gz`), as named nodes beside the grid:

- `stairs`: the flights the tile owns (the one owning a flight's middle),
  treads, risers and cheeks with 8-bit `COLOR_0` shades
  (`scripts/bake-tiles.ts` `stairMesh`, `lib/city/stairs.ts`).
- `walls`: the tile's wall ribbons (`wallMesh`, `lib/city/walls.ts`),
  standing on the shaped fine ground of **every** tile of the site. A wall
  near a seam probes 9 m into its neighbour, so the fine grids of all tiles
  are built first, and the L0 cache key covers every tile's terrain inputs.

The viewer finds a tile's meshes by node name (`terrain`, `city`,
`stairs`, `walls`) and only gives the baked nodes their materials
(`stair-layer.ts`, `wall-layer.ts`). The GeoJSON they come from stays in
`data/<site>/dlm/` as a build input and is no longer served.

## Consequences

- Ground and geometry come from one build step and one file; they cannot
  disagree, and the browser computes neither.
- Walls and stairs arrive with the fine terrain, not behind the dressing
  gate, and leave with it; they count in the census from the terrains.
- A fine terrain glTF grows by 35–70 kB (walls) and 20–60 kB (stairs),
  gzipped; the walls GeoJSON (8–22 kB) is no longer fetched.
- Changing one tile's walls, stairs or DGM re-bakes every tile's L0 (about
  20 s for the site, cold).

## Alternatives

- **Keep building them in the browser**: two sources of truth, and walls
  that stood on the coarse level's ground when only that was loaded.
- **Separate glTF content per layer**: more requests and more tileset
  plumbing for geometry that always travels with the fine terrain.
- **Vegetation, lamps and rails too**: vegetation carries the look state
  (crown LOD, NDVI tint, sliders) and instancing; lamps drive the light
  pool; rails are the next candidate once their deck heights move to the
  build — not part of this decision.

## References

`scripts/bake-tiles.ts` (`stairMesh`, `wallMesh`), `scripts/prepare-data.ts`
(`shapedTerrain`, `siteGround`, `fineChildren`), `lib/city/walls.ts`,
`lib/city/stairs.ts`, `app/_components/tile-stream.ts` (`meshNamed`),
ADR 0014, ADR 0024, ADR 0028.
