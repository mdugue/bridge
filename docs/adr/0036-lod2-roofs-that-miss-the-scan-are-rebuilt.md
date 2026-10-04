# ADR 0036: A LoD2 roof that misses the surface model is rebuilt from it as stepped flat blocks

- **Status:** accepted; what is drawn in the LoD2's place follows the scan's form since the update below
- **Date:** 2026-10 (amended 2026-10-03: measured faces)

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
`data/<site>/dlm/roofs_<tile>.geojson`; `scripts/measured-roofs.ts`, applied in
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
  LoD2 edition or a new scan means re-running `bun run bake <site> --step roofs`.
- The sky-view and horizon bake (`skyview.py`) reads the rebuilt roofs in
  place of their objects, so the far shadows and the sky light agree with
  the mesh; `roofs` runs before `skyview`, and re-baking one means
  re-baking the other.
- Two parts side by side each stand a full-height wall on the shared edge;
  the lower part's is hidden inside the higher. Cutting walls to the
  exposed band would save triangles, not change the picture.

## Update (2026-10-03): the rebuilt roof keeps the scan's form

Flat by construction turned out to be the wrong half of the decision. The
gate found the right buildings, but every roof it rebuilt became a flight
of 1 m terraces wherever the scan was not flat: the Frauenkirche's stone
dome (its LoD2 part sits ~5 m under the scan, so it misses on every cell)
became four stacked drums, the Hauptbahnhof's arched train shed and its
membrane bays a staircase of 52 ledges along the hall, the
Schauspielhaus's hipped roofs contour lines. The same lesson as the
landmark relief
([ADR 0038](./0038-measured-and-named-additions.md), update of 2026-09-30):
a contour model of a smooth shape reads as a stack of plates.

- **Whether** a roof is rebuilt is decided as before, on the flat model
  (every region at its median) — the hotel and the theatre still are —
  with one exception: **a LoD2 roof whose form the scan confirms is kept,
  even when its level is off.** It has a form (it rises ≥ 3 m), the scan
  follows it (Pearson r ≥ 0.85), it misses on ≤ 20 % of the cells once
  shifted by its median offset, and that offset is smaller than the form's
  own height. The Frauenkirche's modelled dome (r 0.90, ~5.6 m under the
  scan) is such a roof: the scan's 1 m cells on a steep curve are no
  better a dome than the model's 162 facets. Five objects in Dresden keep
  their LoD2 so, two in Leipzig, ten in Munich (whose surface model is the
  coarser DOM20); a flat roof or a 3 m placeholder has no form to keep,
  and a tent over a flat slab does not follow the scan.
- **What** is drawn follows the scan's form. The scan over the footprint
  is split into its **faces** — where it rises by more than 0.15 m per
  metre (8.5°) over a patch at least 10 m across, the ridge or valley
  between two slopes included, never a cell beside a step of more than
  2 m (a face ends at a step, which stays a wall) — and the rest, cut into
  levels as before. A face is drawn on its measured surface (the scan,
  edge-preservingly smoothed twice), a level flat at its median; walls
  stand where the parts meet and at the footprint. A strip a cell or two
  wide (a step's blurred flank) joins the neighbour closest in height.
- **How:** the bake writes a face's 1 m surface grid with the part
  (`surface`, cm from its `z`), carried on past the face on its own plane
  so the mesh does not bend at the outline; the build makes an
  error-bounded TIN of it (Delatin, 0.25 m), triangulates its inner
  vertices with the outline's points where the height along the outline
  bends (Delaunay, the outline's edges enforced), and stands the walls on
  those same points. The face shades with normals smoothed over it, not
  across a crease of more than 30° (a ridge stays sharp): flat-shaded, the
  TIN's irregular facets read as a crumpled sheet. The sky-view and
  horizon bake burns the same surface.
- **Cost:** 886 objects rebuilt on Dresden's fifteen tiles (2 956 parts,
  94 of them faces — the halls, vaults and broad roofs); their triangles
  stay at 215 k (the faces' TIN costs what the terraces it replaces did);
  the roofs files of all seven committed sites grow from 6.1 to 9.1 MB (a
  build input, not served).

Rejected on the way: **faces from 5 m across** (the Bellevue's slab and
the Schauspielhaus's narrow slopes came out as draped blankets: at that
width the scan's metre of blur at each edge is a fifth of the face, and
the levels it replaces were one or two); **every 1 m cell as two
triangles** (+70 % city-mesh triangles on the Altstadt tile); **flat
shading** (the TIN's facets crumpled the Hauptbahnhof's vaults); **a TIN
cut by the outline's ear-clipping
triangles** (the slivers multiplied the pieces fourfold); **steps inside
a face** (Delatin traced every step edge with points — a face ends at a
step instead); **planes per region** (a dome or a vault needs a plane per
facet, and a region of 1 m bands is a ring, not a facet).

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
  30 % (the hotel: 78 % → 3 %). (Superseded by the measured faces of the
  update above: the faults were not all flat-roofed.)
- **LoD1 from the scan everywhere:** throws away the LoD2's good roofs on
  the 98 % of objects it gets right.

## References

- `pipeline/bake/roofs.py`, `pipeline/tests/test_roofs.py`
- `scripts/measured-roofs.ts`, `scripts/bake-city-mesh.ts` `withMeasuredRoofs`
- [transformations.md](../transformations.md) — "Roofs rebuilt from DOM1"
- [ADR 0010](./0010-opaque-clay-buildings-only.md) (the clay the parts wear),
  [ADR 0033](./0033-bridges-measured-in-the-surface-model.md) (DOM1 measuring
  what another model gets wrong, there the bridges)
