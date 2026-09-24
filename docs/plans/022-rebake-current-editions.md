# Plan 022: Re-bake land cover, canopy, NDVI, roof colours and lamps from the current editions

> **Executor instructions**: Run on a machine with the raw inputs (or
> network access to GeoSN and Geofabrik) and, for step 5, a real GPU. Bake
> into a scratch directory first and compare before anything overwrites
> `data/`. If anything in "STOP conditions" occurs, stop and report with the
> numbers. Update the status row in `docs/plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat 5d210fd..HEAD -- pipeline/bake data/dlm data/dop data/provenance.json`

## Status

- **Priority**: P2 (data currency; nothing is broken)
- **Effort**: S–M (half a day: downloads, bakes, a comparison, shots)
- **Risk**: LOW–MED — the class raster drives the ground colour, the water,
  the tree gate and the lamp gate, so an edition change shows everywhere
- **Depends on**: PR #48 (the Python pipeline, lamp ownership)
- **Planned at**: 2026-09-24
- **Status**: TODO

## Why this matters

The committed derived data comes from two editions of the Basis-DLM:

| Product | Files | Baked from | By |
|---|---|---|---|
| Land cover + legend, hedge/tree rows | `data/dlm/landcover_<t>.png\|json`, `vegrows_<t>.geojson` | the quarterly package current in **June 2026** | the old bash bake |
| Canopy points | `data/dlm/canopy_<t>.geojson` | DOM1 + DGM1, gated on the June class raster | the old bash bake |
| NDVI | `data/dlm/ndvi_<t>.png` | DOP RGBI, flight 2024-03-19 | the old bash bake |
| Roof colours | `data/dop/roofcolor_<t>.json` | DOP + LoD2 | the old bash bake |
| Rails, ballast, bridges, platforms | `rail/railarea/bridge/platform_<t>.geojson` | the package downloaded **2026-09-24** + Geofabrik 2026-06-15 | the Python bake (5d210fd) |
| Walls, lamps | `walls/lamps_<t>.geojson` | Geofabrik 2026-06-15 | the Python bake (06f6ca8) |

So the ground and the rail layer describe different editions, and four
products were never produced by the code that is in the repo now. The
spawn-tile comparison done while porting the bakes (plan 017, "Progress")
measured what a re-bake would change:

- land cover: 99.95 % of texels identical;
- canopy: 5104 vs 5118 trees;
- NDVI: pixel-identical (same DOP flight);
- roof colours: 3658 of 3668 identical, the rest within 0.008.

The differences trace to the new DLM edition. It no longer has the
`ver03_f` / `ver06_f` areas on that tile, which feed class 5 (railway), and
the ballast and bridge decks already re-baked on 2026-09-24.

The lamps change too. Since PR #48 each tile writes only the lamps it
**owns** (west/south edges in, east/north out; `owns` in
`pipeline/bake/common.py`, `ownsPoint` in the viewer). The committed files
still carry the old ~50 m margin, which the viewer filters at runtime.

## Steps

### 0. Inputs and their editions

```bash
cd pipeline && uv sync && cd ..
bun run bake --ingest --step landcover   # downloads DOM1, DOP, Basis-DLM, OSM if missing
```

Record the editions before baking:

- the Basis-DLM ZIP's `Last-Modified` (`curl -sI <download URL>`) and any
  metadata file inside the ZIP;
- the Geofabrik extract's replication timestamp
  (`osmium fileinfo -e data/_raw/dresden/osm/*.osm.pbf`, or the file name);
- DOM1 / DOP `stand` from the download-link service (unchanged if the
  portal still lists 2024-11-30 / 2024-03-19).

### 1. Bake into a scratch directory

For each tile of the site (bounds from `sites/dresden.ts`, or read them
from `bun run bake`'s output):

```bash
S=$(mktemp -d)
for step in landcover canopy ndvi roof-colour lamps; do
  PYTHONPATH=pipeline uv run --project pipeline python -m bake $step \
    --tile 33412_5656_2_sn --bounds 412000 5656000 414000 5658000 \
    --epsg 25833 --raw data/_raw/dresden --data "$S"
done
```

The order matters: canopy and lamps read the class raster the land-cover
step just wrote. Use `--data "$S"` for all of them so they read the new one.

### 2. Compare with what is committed

Per tile, write the numbers into "Findings" below:

- **Land cover**: texel agreement overall and a per-class confusion table
  (class ids 0–8, committed vs new). Pay particular attention to class 5
  (railway) and class 8 (water). Class 8 is the water sheet and the
  shoreline, and class 5 gates lamps.
- **Veg rows**: feature counts per `kind`.
- **Canopy**: point count, and how many points moved in or out because of
  the new gate.
- **NDVI**: identical expected (same flight). Any difference is a bake
  change, not an edition change: investigate.
- **Roof colours**: count of identical entries and the max difference.
- **Lamps**: count per tile. Also the sum over all tiles against the old
  sum minus the seam duplicates. Each lamp must appear in exactly one tile.

A short script (numpy + Pillow, in the pipeline environment) is enough. If
it proves useful, keep it as `pipeline/bake/compare.py` with a test.

### 3. Look at the differences

Take headed plates (`bun run shots`) at the places the confusion table
points to, before and after, from an oblique angle (AGENTS.md): at least
the rail yard on the spawn tile (class 5), the Elbe shoreline (class 8),
and one park (classes 1–3, canopy). Use the plan 019 snapshots where they
fit.

### 4. Commit the re-bake

```bash
bun run bake --step landcover && bun run bake --step canopy \
  && bun run bake --step ndvi && bun run bake --step roof-colour \
  && bun run bake --step lamps
bun run verify && bun test:e2e
```

`lib/city/features.test.ts` checks every committed GeoJSON's shape;
`lib/city/landcover.test.ts` checks the legends.

Update what quotes counts:

- the comments in `e2e/city-walk.spec.ts` ("5 118 canopy points", "339 OSM
  lamps", …);
- the census numbers in `docs/rendering.md` and the PR/plan texts that cite
  "17 679 vegetation instances";
- the per-tile sizes in `docs/data-pipeline.md` if they move.

### 5. Provenance and docs

- `data/provenance.json`: `Basis-DLM.editionInUse` (one edition for every
  DLM product now), its `$comment` (the Last-Modified from step 0), the
  Geofabrik `extract`, and the lamps' `dataAsOf`.
- The guide's data-sources page, the editions table, in **both**
  languages (`docs/guide/en/data-sources.md`, `docs/guide/de/data-sources.md`).
- `docs/transformations.md` only if a class mapping or a gate changed (it
  should not; this is data, not code).

## STOP conditions

- Land-cover agreement below ~99 % on any tile, or a class that disappears
  from a tile. Report the confusion table and wait for a decision. It may
  be a real change on the ground, or a layer the new edition renamed.
- Class 5 or 8 losing more than a few percent of its texels on a tile
  (rail yard ground, water sheet, lamp gate).
- NDVI or roof colours differing beyond rounding: the bake changed, not
  the data.
- A plate that looks worse and that no class explains.

## Findings

(fill in: date, editions from step 0, the per-tile numbers from step 2,
the plates from step 3)
