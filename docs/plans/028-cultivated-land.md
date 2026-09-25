# Plan 028: Cultivated land — allotments, orchards, vineyards

> **Executor instructions**: Read fully first. Phases in order. Look is
> judged on a real GPU (`bun run shots --headed`, full profile). Update
> the status row in `docs/plans/README.md` when a phase lands.
>
> **Hedges exist**: since PR #49 the OSM hedges (`barrier=hedge`, with
> laser-scan height and width) are drawn by `low-vegetation-layer.ts` from
> `lowveg_<tile>.geojson` (`pipeline/bake/lowveg.py`). Parcel hedges come
> from there; do not add a second hedge style.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/landcover.py app/_components/vegetation-layer.ts lib/city/landcover.ts`

## Status

- **Priority**: P3 (character; vineyards are outside today's four tiles)
- **Effort**: M (bake S, allotment texture M, orchard S, vineyard S–M)
- **Risk**: LOW — a ground texture plus instanced dressing, no new class
- **Planned at**: 2026-09-25
- **Status**: DONE (2026-09-25; the look unjudged on a GPU) — all four
  phases built: `pipeline/bake/cultivated.py` (GeoJSON + 2048² colony
  raster for the four tiles, pytest), allotment beds in the terrain pass,
  orchard trees through the tree layer's "small" archetype, vine rows
  (code + unit tests; no vineyard in the tiles). **STOP measured:** 0 of 66
  colonies carry mapped parcels (< ⅓), so the colony texture ships at a
  low strength (0.45 of *Bodendetail*) and no parcel is invented; against
  the chessboard risk the ≈12 m plots are jittered-Voronoi cells, not a
  grid. Deviations: the colony raster has a second byte (the distance to
  a parcel's border, for the lawn edge) — the plan said one byte; orchard
  trees ride in the cadastre's instances instead of a layer of their own;
  vine rows are not seasonal yet (plan 025's plumbing does not exist).
  Colony paths (OSM footways, paths, service roads) are carved out of the
  raster. Open: the plates (the Johannstadt / Großer Garten colonies) and
  the vineyard plate once the site grows east.

## Why this matters

The DLM burns vineyards, orchards and garden land into class 1 (`veg01_f`)
and allotments into class 4 (`sie02_f`) without reading the attribute that
tells them apart (`landcover.py:62-76`). OSM tells them apart. In the four
tiles (BBBike 2026-09-19): **64 `landuse=allotments`, 77.4 ha** —
Dresden's *Kleingärten* are a real feature of the Johannstadt and
Friedrichstadt — 4 orchards (0.1 ha) and **no vineyard**. The Elbe slopes'
vineyards (Loschwitz, Wachwitz, Pillnitz, Radebeul) lie outside the
current tiles, so the vineyard phase is built and unit-tested now and
judged on a plate once the site grows east (plan 017).

## Design

No new land-cover class: the palette and the class raster stay as they
are (ADR 0023). Dressing only, one GeoJSON per tile.

### Bake — `pipeline/bake/cultivated.py` → `data/dlm/cultivated_<tile>.geojson`

- `multipolygons` with `landuse IN ('allotments','orchard','vineyard')`,
  clipped to the tile.
- Allotments: the colony polygon plus its inner structure **where mapped**
  (`leisure=garden` parcels, garden paths); count how many colonies carry
  parcels and report it in the PR. No synthetic parcel grid and no
  generated sheds: the project keeps what the data carries and invents
  nothing (`furniture.py`'s rule). The sheds are already in LoD2 (≈ 2 300
  objects under 3.5 m across the tiles) or come with plan 034; the parcel
  edges come as hedges (lowveg branch) and fences (plan 029).
  Properties: `{k: "colony"}` and `{k: "parcel"}` polygons.
- Orchards: a tree grid (8 m × 8 m) aligned to the long axis, or the
  mapped `natural=tree` inside it (plan 025 must not place those twice —
  the orchard grid only fills orchards without mapped trees).
- Vineyards: row lines 1.8 m apart **along the contour** — the row
  direction is perpendicular to the DGM gradient's mean over the polygon
  (Elbe vineyards run across the slope; terraces follow walls, which the
  wall layer already draws).
- `attribution` = OSM. Tests on synthetic polygons (parcel count, row
  spacing, row direction on a sloped DGM).

### Runtime — `app/_components/cultivated-layer.ts`

- **Allotments**: the colony's ground gets a garden texture in the
  terrain fragment pass — small beds (≈ 1.2 m strips, hash-oriented per
  parcel or per 12 m cell where no parcel is mapped) in soil and green
  tones over the class colour, faded with distance like the paving
  patterns; mapped parcels get a lawn-edge line at their border. This
  needs a colony/parcel index raster (1 byte per texel, 2048², fine level
  only), the same route as `surface`.
- **Orchard**: small round-crown trees (archetype "small" from the tree
  layer), wider spacing, trunk 1.2 m.
- **Vineyard**: vine rows as instanced low boxes 1.3 m high, 0.5 m wide,
  foliage tone, seasonal like plan 025 (bare canes in winter) once that
  plan's season plumbing exists.
- 250 m chunks, compile path, dispose like the vegetation layer.

### Docs

Ledger (Vegetation), `data-flow.md`, `rendering.md` codebook, guide OSM row
(en + de).

## Phases

1. Bake (all three kinds, tests).
2. Allotments — plate: the colony by the Großer Garten / Johannstadt.
3. Orchard.
4. Vineyard — unit tests now, plate when the site covers a vineyard.

## STOP conditions

- The bed texture reads as a chessboard in the plate (real colonies are
  irregular): orient beds per mapped parcel only and fall back to plain
  meadow mottle elsewhere.
- Fewer than a third of the colonies carry mapped parcels and the bed
  texture alone reads as noise from walking height: ship the colony
  texture at a lower strength only, report the numbers.
