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
- **Status**: DONE (2026-09-26) — the gate passed with the echo rule
  tightened to a per-cell window (phase 0 below); 6 625 structures on the
  fifteen tiles (6 783 before the review fixes below), appended to the
  city mesh (+3.3 % city glTF). Plates on a
  real GPU (an allotment colony, a Neustadt courtyard) are still open: the
  look was checked headless only.

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

## Results (2026-09-26)

### Phase 0 — the measurement and the gate

Spawn tile 33412_5656, the scan rasterised by `lsc.py` (0.5 m), the LoD2
mask grown 1 m, classes 5/7/8 out. 89 849 connected blobs lie in the
2–6.5 m band outside the footprints; 6 388 of them measure 6–150 m².

| Filter | Blobs | Sample vs DOP |
|---|---|---|
| the plan's rule: blob-wide multi-echo share ≈ 0 (≤ 0.05), flat, compact | **4** | — |
| … share ≤ 0.10 | 43 | — |
| … share ≤ 0.10 in the blob's interior | 377, 112 of them touching a > 6.5 m cell (tree crowns) | — |
| **per-cell**: no multi-echo return in a cell's 3 × 3 window, then blobs, flat, compact | 130 | 14 / 20 structures |
| + the core ≥ 4 m² grown back one cell, width ≥ 2 m | 280 | 14–17 / 20 |
| + the OSM exclusions, NDVI ≤ 0.25, vehicle size | 222 | **16 / 20** (17 counting one only the scan shows) |
| + the roof-edge sliver rule (shipped) | 213 | the 2 of the 3 misses that were slivers are gone |

The plan's literal echo rule fails the count: a shed's roof edge splits
the pulse (part roof, part ground), so its blob-wide multi-echo share is
never ≈ 0 — the median over all band blobs is 0.93, and 0.27 at the 10th
percentile. The STOP condition's remedy — tighten the echo rule — is what
passed: the rule is applied per cell (no multi-echo return within the 3 × 3
window), which drops the roof's rim and every tree crown (0 of the 130
blobs touch a > 6.5 m cell), and the rim is grown back one cell afterwards.

**Gate: passed** — 213 ≥ 100 on the spawn tile, and 16 of the 20 blobs of
the final sample (seeded at random, crops of the DOP20 at 400 px / 30 m
with the rectangle drawn) are structures: container buildings, garden and
allotment houses, a hexagonal gazebo, sheds and carports in courtyards, a
garage row, a pavilion tent, and three annexes or hall parts LoD2 lacks.
The misses: two strips along a LoD2 roof edge (now caught by the sliver
rule), one blob in a March shadow. Two caveats: the DOP is from 19 March
2024, eight months before the scan (27–30 Nov 2024), and six of the 20 of
an earlier sample lay in its long shadows, so they were judged on the
scan's own hillshade (a sharp flat rectangle) instead. Earlier samples, for
the record: 14 / 20 (per-cell rule alone), 14–17 / 20 (with the growth
rule); the misses there were a clipped evergreen block (NDVI 0.56 → the
NDVI rule), a van on a car park, a trailer in a depot (→ the vehicle rule)
and roof-edge slivers.

Areas of the 6 783 structures first shipped (all tiles): 6–10 m² 90, 10–15 m²
1 211, 15–20 m² 1 452, 20–30 m² 2 119, 30–50 m² 1 429, 50–75 m² 314,
75–100 m² 85, 100–200 m² 76 (the rectangle, which can exceed the blob);
median 22.5 m², median height 2.7 m.

### What the flight caught that is gone

The flight was on 27–30 Nov 2024; the Striezelmarkt opened on 27 Nov.
The markets are plainly in the scan: the OSM context took 101 blobs off
the Altmarkt (a `place=square`; the square is empty in the March DOP), 39
off the Neumarkt, 17 off An der Frauenkirche, 14 off the Postplatz, 11 off
the Stallhof (the medieval market), 28 off Prager Straße and 4 off the
Wiener Platz; the vehicle rule took 43 / 51 / 85 on 33410_5656 / 5654 /
5658. The squares are OSM `highway=pedestrian` areas: the bake drops
blobs inside pedestrian areas (and `area:highway=pedestrian`), `place=square`,
`amenity=marketplace`, `landuse=construction` and surface car parks
(`amenity=parking` without `parking=carports`/`underground` …), and within
6 m of a pedestrian street mapped only as a line (Münzgasse,
Augustusstraße, Seestraße: one blob each). What remains: three blobs on the pavement of the Schloßstraße (a living
street) beside the Kulturpalast, probably stalls or a café hut; container
stacks in the Alberthafen (109 on 33408_5656) and rental yards, which were
there that day and may not be now.

### Per tile

After the final review (2026-09-26) the bake reads 40 m of the neighbours'
scan and layers across each seam and writes a structure on the tile that
owns its rectangle's centroid (27 structures now straddle a seam; before,
a blob touching the tile's edge was dropped on both sides); `z` is the
lowest ground under the whole rectangle and the DGM1 at its corners, and
a rectangle over ground that falls > 1.5 m is dropped (an embankment's
edge: 324 boxes stood > 0.1 m above the DGM at a corner, 21 > 0.5 m, the
worst 1.74 m; now 25, 1 and 0.84 m); of two rectangles overlapping by
> 0.5 m² the smaller goes (43 such pairs, all z-fighting; now 0 — 49 pairs
touch by less). The build no longer draws storey bands on them (the first
stroke fell 0.2 m under the eave on ~66 %), hashes their tint from the
first corner (a changed LoD2 object count no longer reshuffles it), and
drops the canopy and scan points in or within 0.5 m of one — 1 232 of
them (a shed's roof read as a 3–4 m tree; before: 970 points inside 732
sheds).

| Tile | Found (tile + 40 m) | Shipped (before → after) | Pent roofs | city glTF (gz, vs none) | change |
|---|---|---|---|---|---|
| 33408_5654 | 947 | 813 → 810 | 67 | +63.1 kB (+4.1 %) | -0.4 kB |
| 33408_5656 | 1 517 | 1 110 → 1 106 | 76 | +90.5 kB (+11.9 %) | -0.3 kB |
| 33408_5658 | 776 | 612 → 610 | 44 | +46.6 kB (+6.3 %) | -0.1 kB |
| 33410_5654 | 264 | 154 → 146 | 18 | +16.0 kB (+1.4 %) | -0.9 kB |
| 33410_5656 | 529 | 244 → 232 | 29 | +23.2 kB (+2.1 %) | -0.9 kB |
| 33410_5658 | 1 660 | 1 516 → 1 485 | 221 | +127.2 kB (+10.1 %) | -1.1 kB |
| 33412_5654 | 146 | 133 → 123 | 12 | +7.1 kB (+1.0 %) | -1.2 kB |
| 33412_5656 | 282 | 213 → 204 | 20 | +20.2 kB (+1.5 %) | -2.1 kB |
| 33412_5658 | 575 | 454 → 444 | 51 | +41.8 kB (+2.8 %) | -0.8 kB |
| 33414_5654 | 635 | 573 → 571 | 57 | +48.1 kB (+2.5 %) | -0.2 kB |
| 33414_5656 | 323 | 266 → 256 | 27 | +21.9 kB (+1.8 %) | -0.8 kB |
| 33414_5658 | 136 | 128 → 121 | 17 | +13.4 kB (+3.4 %) | -0.7 kB |
| 33416_5654 | 372 | 343 → 332 | 31 | +31.3 kB (+1.8 %) | -1.4 kB |
| 33416_5656 | 214 | 223 → 184 | 32 | +17.3 kB (+0.9 %) | -4.6 kB |
| 33416_5658 | 1 | 1 → 1 | 1 | +0.1 kB | 0.0 kB |
| **all** | **8 377** | **6 783 → 6 625** | **703** | **+568 kB (+3.3 %)** | **-15.6 kB** |

"Found" is after the shape rules, before the OSM context, over the tile
and its 40 m margin (so a seam's structures count on both sides). The
allotment colonies carry most of them. The committed GeoJSON is 1.6 MB for
all fifteen tiles. The first bake (6 783; found 8 168 on the tiles alone)
added +583 kB (+3.4 %).

### Look

Same clay material as every building: the hashed wall tint, the flat-roof
slate palette (no DOP roof colour is sampled for them), no dusk glow, a
flat or pent roof. Checked headless only (SwiftShader); the plates on a
real GPU are open.
