# ADR 0023: Mesh every tile from an error-bounded TIN; snap walls to the measured step

- **Status:** accepted
- **Date:** 2026-09

## Context

The ground was a heightfield resampled from the 1 m DGM1 to 1024² (primary)
or 512² (neighbours), with OSM wall lines burned in as breaklines (ADR
0014). The terrain study (`scripts/terrain-study/`, ledger "Terrain TIN")
measured both against held-out laser-scan ground: most of the "wall smear"
was our resample, not the data (the native DGM1 steps within ~1.7 m, the
1024² grid within ~2.9 m), and the burn *tripled* the error in the 20 m band
around walls (0.43 → 0.76 m RMSE) — it flattens terraced walls into one
cliff and puts the step on the OSM line, which misses the measured edge.
A Delatin TIN of the native DGM1 at ±0.15 m matched or beat the grid on
every metric with a seventh of its triangles and about its bytes.

## Decision

Every tile whose spec names a tolerance (`lib/city/tile.ts` `tinMaxError`)
is meshed from a TIN baked at build time from its committed DGM GeoTIFF
(`scripts/bake-terrain-tin.ts` inside `prepare-data.ts`): the primary at
±0.15 m, the three neighbours at ±0.25 m. Nothing is burned into a TIN; the
earth-retaining wall ribbons snap to the step the ground measures
(`lib/city/wall-snap.ts`: face just in front of the ramp foot, a coping cap
back to its crest). A tile without a tolerance keeps the heightfield and the
conflation of ADR 0014, which this ADR supersedes for TIN tiles — every tile
of the shipped block.

## Consequences

- One terrain mesh path in practice; the heightfield is still baked (the
  neighbours' headers frame the minimap, and it is the fallback for a tile
  without a TIN), but not meshed for the shipped block.
- `heightAt` interpolates the very triangles the GPU draws (a bucket index,
  `TinIndex`), so ground-clamp, collision and the drawn ground agree.
- The neighbours cost 1.6–2.2× their 512² grid's gzipped bytes (0.5–0.8 MB
  each, +~0.94 MB for the block) for a third of the triangles and walls that
  no longer smear over 4 m.
- The bake refuses NoData: a tile with holes must drop its tolerance and
  fall back to the grid until the bake learns to mask them.
- Two TINs meet at a seam with different border vertices; the shared skirt
  hides the crack (checked on a real GPU across the Brühlsche Terrasse).
- Open: constrained breaklines (a vertical face needs two vertices at one
  xy), crease-angle normals, the sub-metre spikes at some wall feet.

## Alternatives

- **Keep the grid + conflation (ADR 0014):** measurably worse at walls, 7×
  the triangles.
- **Native 2000² grid:** accurate but 8 M triangles per tile.
- **A laser-scan DTM (0.5 m) or its TIN:** better only at the sharpest quay
  walls, for 2–4× the triangles and a committed LSC-derived artifact.
- **Burn the conflation into the TIN:** sharp steps, but the same tripled
  wall-band error as the grid burn.
- **±0.25–0.5 m neighbours to undercut the grid's bytes:** 0.5 m would, but
  ±0.25 m was chosen for accuracy at the Altstadt walls on 33410_5656.

## References

- Ledger "Terrain TIN" and "Wall → terrain conflation"
  ([transformations.md](../transformations.md)); ADR 0014.
- `lib/city/terrain-tin.ts`, `lib/city/wall-snap.ts`,
  `scripts/bake-terrain-tin.ts`, `app/_components/terrain-layer.ts`
  (`loadTinSurface`), `lib/city/tile.ts`.
