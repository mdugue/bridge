# Plan 034: What the laser saw and LoD2 did not — small structures from DOM − LoD2

> **Executor instructions**: Read fully first. Phase 0 is a measurement
> and gates the rest: if its numbers say there is little to gain, STOP and
> report. Look is judged on a real GPU (`bun run shots --headed`, full
> profile). Update the status row in `docs/plans/README.md` when a phase
> lands.
>
> **Builds on** `pipeline/bake/lsc.py` (laser scan through laspy, shipped
> in PR #49): its 0.5 m `dsm`, `dtm` and **`nonground_multiecho_count`**
> rasters tell a shed from a shrub; `lowveg.py` `lsc_rasters` makes them
> on first use and `building_mask` already rasterises the LoD2.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/lsc.py pipeline/bake/monuments.py scripts/bake-city-mesh.ts`

## Status

- **Priority**: P3 (completeness; courtyards and garden colonies)
- **Effort**: M (measurement S, bake M, build step S)
- **Risk**: MED — false positives (parked vans, dense shrubs, scaffolding)
- **Planned at**: 2026-09-25
- **Status**: TODO (needs the raw laser scan)

## Why this matters

LoD2 already carries many small buildings (≈ 2 300 objects under 3.5 m in
the four tiles, the ALKIS garage code among them), but not all: kiosks,
carports, bike sheds, garden houses in the allotments, container
buildings, market stalls, the pavilions in parks. The surface model sees
all of them. Whatever stands 2–6 m above the ground, is not a LoD2
building and is not vegetation is very likely one of them.

## Design

### Raw inputs and access

- The laser scan: `bun run bake <tile> --ingest --lsc` (`ingest_sn.py`
  `ingest_lsc`, ≈ 380 MB a tile) → `lsc_rasters`. On 2026-09-25 the LSC
  share answered 503 and the DOM1 share 401 (rotated token): if the
  ingest fails, fetch fresh links through the download-links service
  `data/provenance.json` names, and record them there.

### Phase 0 — measure (no code shipped)

For the spawn tile: the LoD2 mask from `building_mask` dilated by 1 m; `ndsm = dsm − dtm`; candidates = connected blobs of
`2.0 m < ndsm < 6.5 m` outside footprints, area 6–150 m², **single-echo**
(multi-echo count ≈ 0 — vegetation returns several echoes, roofs one),
flat top (height std < 0.35 m), compact (area / min-rect area > 0.6),
not on class 5/7/8 (rail, road, water — parked vans and boats). Report
the count, a histogram of areas and a 20-blob sample checked against the
DOP. **Gate**: ≥ 100 blobs per tile and ≥ 70 % true structures in the
sample; otherwise REJECT with the numbers (🗃️ ledger row).

### Bake — `pipeline/bake/small_buildings.py` → `data/dlm/smallbuild_<tile>.geojson`

- The phase-0 filter; each blob → its minimum rotated rectangle
  (simplified footprint), `h` = the blob's median ndsm, `z` = the
  footprint's minimum DTM; roof flat (a pent roof when the top plane's
  tilt > 8°, with its direction). The monuments bake's flood + ownership
  pattern (`monuments.py:267-328`, `owns()`) applies.
- `attribution` = GeoSN (dl-de/by-2-0).

### Build — appended to the city mesh

`bakeCityMesh` appends the extruded boxes as extra objects: rows at
`keys.length + j`, `root` = own index, `building` = true, a flat-roof
colour, triangles tagged with the new ids (`bake-city-mesh.ts`, the
analysis in this plan's research: the weld never merges across objects,
so picking, demolish, collision and minimap work unchanged). Add the
GeoJSON to `cityMeshSourceFiles` and the city cache key
(`prepare-data.ts:287-288`). A distinct `source` column (u8: 0 LoD2, 1 scan)
lets the census and the knowledge base count them.

### Docs

Ledger (Buildings: small structures from the scan ✅, or 🗃️ if the gate
fails), `data-flow.md`, `rendering.md`, guide data-sources LSC/DOM rows
("Used here for") in en + de.

## Phases

0. Measurement + gate (report in the PR, no code merged).
1. Bake + tests (a synthetic ndsm with a shed, a shrub, a van on a road).
2. Append to the city mesh. Plates: an allotment colony, a Neustadt
   courtyard, the Altmarkt (market stalls — expect them, as seasonal
   structures, to be caught at the scan date only).

## STOP conditions

- The phase-0 gate fails.
- Blobs appear under tree crowns (the scan saw a trunk cluster): tighten
  the echo rule before the height rule.
- Structures on the scan date that are gone (construction site cabins,
  the Striezelmarkt if the flight was in winter — it was November 2024):
  exclude blobs inside OSM `landuse=construction` and on the Altmarkt
  area; report what remains.
