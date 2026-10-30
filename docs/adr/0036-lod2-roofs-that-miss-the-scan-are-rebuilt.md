# ADR 0036: Buildings are LoD2; geometry beyond it only where a measurement and a name agree, and roofs that miss the scan are rebuilt in its form

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10 (absorbs the geometry rules of ADR 0038)

## Context

LoD2 is the building model: footprints from the cadastre, roofs fitted to
a laser scan as the nearest catalogue type. It leaves out slim structures
(chimneys, masts, towers), lags new buildings by a year or more, and draws
complex buildings it cannot fit as a few non-planar polygons — a hotel of
flat roofs as a crumpled tent, a new block as a 3 m placeholder. The
surface model DOM1 sees everything that stands, but most of what it adds
is trees, pylons and the cranes of the flight day.

## Decision

1. **New volumes need a measurement and a name.** DOM1 measures, OSM or
   Wikidata names: a column (chimney, tower, mast, water tower) where OSM
   maps one and the scan rises there; a missing building where OSM maps an
   outline LoD2 barely covers and the scan fills it; a roof on posts where
   OSM maps a roof and DOM1 shows a level surface. The shape is simple and
   measured, never a modelled likeness. A tower LoD2 already draws is not
   added again.
2. **A landmark's roof relief** (a Wikidata item matched to LoD2 objects)
   is the one gap drawn without its own outline: the measured height field
   above its highest LoD2 roof, where the excess is large.
3. **A LoD2 roof that misses DOM1 is rebuilt inside its own footprint**
   (`pipeline/bake/roofs.py`), only where the rebuild fits the scan
   clearly better and the footprint is not out of date. A LoD2 roof whose
   form the scan confirms is kept, even when its level is off. The rebuild
   follows the scan's form — measured faces where it slopes, flat levels
   elsewhere, walls where parts meet — under the object's own id, so its
   row, tint, picking and demolish stay.
4. **Rebuilt parts are architectural, not raster-shaped:** no part
   narrower than a few metres, outlines straight rather than on the 1 m
   grid, steep flanks drawn as faces.
5. **Where the scan predates a building OSM maps**, the mapped height
   stands, guarded by OSM's date and the outline's coverage.
6. **Every rule is general.** No list of buildings, no per-building fix.

## Consequences

- Free-form complexes and new buildings read as what they are; a city
  gets its chimneys and towers from `fetch → bake → build`.
- What OSM does not map is not drawn, even where the scan shows it.
- A new LoD2 edition or scan means re-running `roofs` and then `skyview`.

## Alternatives

- **Every gap from the surface model alone:** cranes, pylons and crowns
  become towers.
- **Hand-modelled landmarks or models from 3D warehouses:** not
  repeatable, licensed per model, and a detailed look the clay cannot
  absorb.
- **Re-triangulating LoD2's non-planar polygons:** they describe a tent.
- **Rebuilding every `tdcFreeFormRoof`:** most fit the scan; the gate
  measures the fault instead of trusting the label.
- **Stepped flat blocks or 1 m cells:** contour terraces on every dome and
  vault, or a mesh 70 % larger.
- **LoD1 from the scan everywhere:** throws away the 98 % of roofs LoD2
  gets right.
