# ADR 0036: A LoD2 roof that misses the surface model is rebuilt from it as stepped flat blocks

- **Status:** accepted
- **Date:** 2026-10

## Context

The Westin Bellevue on the Elbe's north bank looked like a crumpled tent:
one 160 m complex of a tall slab, lower wings and two courtyards, every
roof flat, drawn as three huge sloping facets rising from 7 m at the eaves
to a 25 m peak in the middle. The LoD2 is to blame, not the viewer. The
2025 edition models a building it cannot fit to its roof catalogue as
`tdcFreeFormRoof` (10 305 objects on the fifteen tiles), and for a complex
building that is often a handful of non-planar polygons over the whole
footprint; the loader triangulates them as they are. 78 % of the hotel's
roof stands more than 2 m off DOM1.

Measured against DOM1 (1 m, the laser flight of 27–30 November 2024), the
same failure shows on department stores, theatres, clinics and office
blocks (the Altmarkt-Galerie, the Schauspielhaus, the Staatsoperette in
the Kraftwerk Mitte), and a second one besides it: buildings finished after
the LoD2's roofs were measured (in 2016, for these tiles) still stand as a
3 m placeholder slab — a new block on the Ferdinandplatz is 3 m tall in
the LoD2 and 19 m in the scan. The footprints are right; they come from the
cadastre.

## Decision

**A LoD2 object whose roof misses DOM1 is drawn as stepped flat blocks
measured in DOM1, inside its own footprint** (`pipeline/bake/roofs.py` →
`data/dlm/roofs_<tile>.geojson`; `scripts/measured-roofs.ts`, applied in
`scripts/bake-city-mesh.ts` `withMeasuredRoofs`).

- **When:** a building (`31001_*`) whose own roof cells (no other roof
  over them) cover ≥ 150 m², and more than 40 % of them (one cell inside
  the edge, no crown over them by the NDVI) stand more than 2 m off DOM1.
  Its roof is burned with each vertex's own height, as the loader draws it.
- **What:** DOM1 over the footprint, 3 × 3-median filtered, cut into 1 m
  bands; pieces under 20 m² join the neighbour closest in height,
  neighbours closer than 1.5 m merge; each region's median is its roof.
  The regions are polygonised, simplified as one coverage (1 m, shared
  edges stay shared) and clipped to the footprint.
- **Only when it is better:** the blocks must miss DOM1 on at most half as
  many cells as the LoD2 and on at most 30 %. Where the scan sees open
  ground over more than 15 % of the footprint, the footprint itself is out
  of date (a block torn down since) and the LoD2 stays. A part that would
  stand lower than 2 m is left out.
- **How it is drawn:** each part a prism from the object's LoD2 base to its
  roof, walls and roof, no floor, under the object's own id — its table
  row, tint, roof colour, demolish, picking, collision and minimap
  footprint stay. The eave and storey rows follow the new shape.

889 of ≈ 50 000 objects on the fifteen tiles are rebuilt (3 146 parts),
+8.4 % triangles in the city mesh. A step without DOM1 writes nothing and
leaves the committed file alone.

## Consequences

- The free-form complexes read as what they are; new buildings stand at
  their height. The roofs are flat by construction: a real pitched or
  barrel roof inside a rebuilt object becomes one level at its median, and
  a facade's setback reads as a step at the next metre band.
- DOM1 is now a city-mesh input (through the committed GeoJSON). A new
  LoD2 edition or a new scan means re-running `bun run bake --step roofs`.
- The sky-view and horizon bake (`skyview.py`) reads the rebuilt roofs in
  place of their objects, so the far shadows and the sky light agree with
  the mesh; `roofs` runs before `skyview`, and re-baking one means
  re-baking the other.
- Two parts side by side each stand a full-height wall on the shared edge;
  the lower part's is hidden inside the higher. Cutting walls to the
  exposed band would save triangles, not change the picture.

## Alternatives

- **Re-triangulate the non-planar polygons** (constrained Delaunay, a
  fitted plane per polygon): the polygons themselves describe a tent; any
  triangulation of them is still a tent.
- **Rebuild every `tdcFreeFormRoof`:** most of them fit the scan (69 of
  321 miss it on the Altstadt tile); the gate measures the fault instead of
  trusting the label, and so also catches catalogue roofs that miss (a
  gable over a flat-roofed hall) and the 3 m placeholders.
- **Planes per region** (pent and gable faces fitted to DOM1): better for
  pitched roofs, but the faults found are flat-roofed complexes; the
  stepped model already brings them from 40–100 % of cells off to at most
  30 % (the hotel: 78 % → 3 %).
- **LoD1 from the scan everywhere:** throws away the LoD2's good roofs on
  the 98 % of objects it gets right.

## References

- `pipeline/bake/roofs.py`, `pipeline/tests/test_roofs.py`
- `scripts/measured-roofs.ts`, `scripts/bake-city-mesh.ts` `withMeasuredRoofs`
- [transformations.md](../transformations.md) — "Roofs rebuilt from DOM1"
- [ADR 0010](./0010-opaque-clay-buildings-only.md) (the clay the parts wear),
  [ADR 0033](./0033-bridges-measured-in-the-surface-model.md) (DOM1 measuring
  what another model gets wrong, there the bridges)
