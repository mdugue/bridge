# ADR 0028: Mesh every terrain level from an error-bounded TIN; snap walls to the measured step

- **Status:** accepted (supersedes [ADR 0014](./0014-wall-to-terrain-breakline-conflation.md) except for the grid fallback)
- **Date:** 2026-09

## Context

The ground was a heightfield resampled from the 1 m DGM1 to 1024² (and
512² for the coarse level, ADR 0024), with OSM wall lines burned in as
breaklines (ADR 0014). The terrain study (`scripts/terrain-study/`, ledger
"Terrain TIN") measured both against held-out laser-scan ground: most of the
"wall smear" was our resample, not the data (the native DGM1 steps within
~1.7 m, the 1024² grid within ~2.9 m), and the burn *tripled* the error in
the 20 m band around walls (0.43 → 0.76 m RMSE) — it flattens terraced
walls into one cliff and puts the step on the OSM line, which misses the
measured edge. A Delatin TIN of the native DGM1 at ±0.15 m matched or beat
the grid on every metric with a seventh of its triangles.

The study was run while the viewer still loaded its own heightfield and TIN
codecs; the decision was then carried into the 3D Tiles bake of ADR 0024.

## Decision

Both terrain levels of every tile are an error-bounded TIN of the tile's
committed native DGM, refined by Delatin at build time
(`scripts/bake-tiles.ts` `tinTerrainMesh`, inside `prepare-data.ts`) and
shipped as the level's glTF content like any other mesh: the fine level at
**±0.15 m**, the coarse one at **±0.5 m** (`TERRAIN_LEVELS`,
`lib/city/tileset.ts`). Nothing is burned into a TIN; the earth-retaining
wall ribbons snap to the step the ground measures (`lib/city/wall-snap.ts`:
face just in front of the ramp foot, a coping cap back to its crest).

The runtime reads ground height from the very triangles it draws: a bucket
index over the streamed mesh's quantised positions (`TriangleIndex`,
`lib/city/terrain-tin.ts`), built when the tile is dressed. The glTF extras
say which surface a level is (`surface: {kind: "tin", maxError}`).

A DGM with NoData cannot be meshed as a TIN; the bake then falls back to
the level's grid (1024² / 512²) with the walls burned in (ADR 0014), and the
ribbons of that tile keep the OSM line.

## Consequences

- One standard mesh path: no custom TIN codec, no heightfield codec. The
  glTF may weld and reorder a TIN (its vertex order carries nothing).
- Per Dresden tile the fine level is 290–480k triangles in 0.9–1.5 MB
  gzipped (the 1024² grid: 2.1 M triangles, 1.5–2.0 MB), the coarse one
  47–86k triangles in 0.17–0.31 MB (the 512² grid: 526k, 0.4–0.5 MB).
  Delatin costs ~2 s per tile at ±0.15 m in the (cached) build.
- `heightAt` needs an index per terrain level (a few MB of buckets for the
  fine level) where the grid needed none; ground-clamp, collision, ground
  rays and the drawn ground agree to the quantisation step.
- Water on a TIN gets an up-facing twin of the geometry: the huge river
  triangles share vertices with the steep banks, and their averaged normals
  would streak the water's shading.
- Two TINs meet at a seam with different border vertices; the shared skirt
  hides the crack (checked on a real GPU across the Brühlsche Terrasse,
  before the 3D Tiles port — re-check on a GPU, plan 019).
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
- **A 512² grid for the coarse level:** a tenth of a ±0.5 m TIN's
  accuracy at walls (4 m cells) for 6–10× its triangles and twice its bytes.
- **A custom TIN codec next to the tileset** (what the study shipped):
  a second format and decoder for what glTF already carries.

## References

- Ledger "Terrain TIN" and "Wall → terrain conflation"
  ([transformations.md](../transformations.md)); ADR 0014, ADR 0024.
- `lib/city/terrain-tin.ts`, `lib/city/wall-snap.ts`,
  `scripts/bake-tiles.ts`, `app/_components/terrain-layer.ts`
  (`groundSampler`), `lib/city/tileset.ts`.
