# ADR 0030: The fine terrain level is an error-bounded TIN of the native DGM; walls snap to the measured step

- **Status:** accepted (supersedes [ADR 0014](./0014-wall-to-terrain-breakline-conflation.md) for the fine level)
- **Date:** 2026-09

## Context

The fine terrain level (ADR 0024) was the 1 m DGM1 resampled to a 1024²
grid, with the OSM wall lines burned in as breaklines (ADR 0014). The
terrain study (`scripts/terrain-study/`, ledger "Terrain TIN") measured both
against held-out laser-scan ground: most of the "wall smear" was our
resample, not the data (the native DGM1 steps within ~1.7 m, the 1024² grid
within ~2.9 m), and the burn *tripled* the error in the 20 m band around
walls (0.43 → 0.76 m RMSE) — it flattens terraced walls into one cliff and
puts the step on the OSM line, which misses the measured edge. A Delatin TIN
of the native DGM1 at ±0.15 m matched or beat the grid on every metric with
a seventh of its triangles.

## Decision

`prepare-data.ts` bakes each tile's **fine level** as an error-bounded TIN
of its committed DGM GeoTIFF read at native resolution
(`scripts/bake-terrain-tin.ts`, `FINE_TIN_MAX_ERROR` = ±0.15 m), written as
the same glTF content (`terrain_<tile>_l0.glb.gz`) with
`TerrainExtras.tin` set:

- The raised areas (terraces) and the stair burn of ADR 0028 are shaped in
  before the refinement; the stairs `maxError` deeper, so no triangle that
  only approximates the burned grid pierces a tread. **The walls are not
  burned in.**
- The earth-retaining wall ribbons baked beside it (ADR 0029) **snap to the
  step the TIN measures** (`lib/city/wall-snap.ts`: face just in front of
  the ramp foot, a coping cap back to its crest); walls without a
  measurable step keep the OSM-line placement.
- The glTF is reordered for the vertex cache and meshopt (nothing reads a
  TIN's order). The viewer indexes its triangles for `heightAt`
  (`lib/city/terrain-tin.ts` `TinIndex`, the skirt skipped as vertical),
  and gives the water an up-facing normal twin of the mesh.
- The **coarse level stays the 512² grid** with the walls burned in: it is
  backdrop beyond ~1.2 km, where a 4 m grid smears any wall anyway.
- A DGM with NoData keeps the grid for its fine level (a TIN has no holes).

## Consequences

- The walker stands on exactly the triangles the GPU draws; the walls stand
  on them too, at bake time, over every tile's fine level.
- The fine level shrinks from 2 M to 0.30–0.49 M triangles per tile and
  its gzipped glTF by 20–27 % (1.6–2.0 MB vs 2.15–2.45 MB); the bake adds
  about 30 s for the site, cold.
- Fine and coarse levels differ at walls (the coarse one has the burned
  step): visible only at the switch distance.
- Two TINs meet at a seam with different border vertices; the skirt hides
  the crack (checked on a real GPU across the Brühlsche Terrasse, before
  the move to glTF — re-check per plan 019).
- Open: constrained breaklines (a vertical face needs two vertices at one
  xy), crease-angle normals, the sub-metre spikes at some wall feet.

## Alternatives

- **Keep the grid + conflation (ADR 0014):** measurably worse at walls,
  seven times the triangles, larger on the wire.
- **Native 2000² grid:** accurate but 8 M triangles per tile.
- **A laser-scan DTM (0.5 m) or its TIN:** better only at the sharpest quay
  walls, for 2–4× the triangles and a committed LSC-derived artifact.
- **Burn the conflation into the TIN:** sharp steps, but the same tripled
  wall-band error as the grid burn.
- **The TIN's own binary payload** (as first prototyped: header + gzipped
  planes): smaller still, but a private format again (ADR 0024 chose glTF).

## References

- Ledger "Terrain TIN" and "Wall → terrain conflation"
  ([transformations.md](../transformations.md)); ADRs 0014, 0024, 0028,
  0029.
- `lib/city/terrain-tin.ts`, `lib/city/wall-snap.ts`, `lib/city/walls.ts`,
  `scripts/bake-terrain-tin.ts`, `scripts/bake-tiles.ts`
  (`tinTerrainMesh`), `app/_components/terrain-layer.ts` (`tinHeightAt`).
