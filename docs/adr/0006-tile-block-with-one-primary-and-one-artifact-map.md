# ADR 0006: A 2×2 tile block with one primary tile, and one artifact map shared by bake and client

- **Status:** superseded by [ADR 0024](./0024-site-streams-as-3d-tiles.md)
- **Date:** 2026-06 (block), 2026-09 (artifact map, plan 010)

## Context

One 2 km tile ends at a visible edge a few hundred metres from the spawn.
Loading the whole city is out of the question (fill-rate and memory).
Separately, the per-tile file names were once spelled in three places (the
tile module, the client's URL builder, the prepare script) and four were
derived at runtime by string replacement; a typo degraded silently to
"feature off", and the wall file was fetched twice per tile.

## Decision

- The viewer loads a **2×2 block**: the primary tile `33412_5656_2_sn`
  (spawn, collision, demolish, full resolution) plus three neighbours as
  backdrop at lower resolution (heightfield 512² instead of 1024²,
  rasters 2048² instead of 4096²).
- `lib/city/tile.ts` is the **single home** of the tile list
  (`TILE_BLOCK`) and of every artifact a tile has (`tileArtifacts(spec)`:
  file name, source folder, `required` flag, resample kind).
  `scripts/prepare-data.ts` derives what to bake and publish from it;
  `city-walk-client.tsx` derives every URL from it through the manifest
  (`tileUrlsFrom`). No URL is ever built by `.replace()`.
- One fetch policy for optional artifacts
  (`app/_components/fetch-optional.ts`): 404, network or parse failure →
  feature off; an abort always rethrows. Walls are fetched once per tile
  and shared by the terrain conflation and the wall layer.
- Neighbour files are fetched concurrently and parsed in tile order so
  batched meshes stay deterministic.

## Consequences

- Adding an artifact is one entry in `tileArtifacts()`, one loader, one
  contract row in `lib/city/features.ts`; `tile.test.ts` pins the names and
  `features.test.ts` checks every committed file.
- A required artifact missing at build time fails the build instead of
  becoming a client 404.
- Neighbour seams are visible at close range; the neighbours are backdrop
  by design.
- Changing the block means editing `TILE_BLOCK` and committing the tiles'
  data.

## Alternatives

- **A single tile:** the edge is too close.
- **A 3×3 block:** rejected for now — ~2.3× the geometry and rasters for
  little visible gain from the spawn.
- **Names spelled per consumer:** the state before plan 010; rejected by
  experience.

## References

- plan 010; `lib/city/tile.ts`; README.md "Data".
