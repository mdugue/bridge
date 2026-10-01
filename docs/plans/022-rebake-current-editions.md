# Plan 022: Re-bake the four original tiles from the current editions, the whole chain downstream of the land cover

> **Executor instructions**: Run on a machine with the raw inputs (or
> network access to GeoSN and Geofabrik); step 3 also needs a real GPU (or
> hand its plates to plan 019). Bake **in place on a branch** — git holds
> the committed version to compare against. If anything in "STOP
> conditions" occurs, stop and report with the numbers. Update the status
> row in `docs/plans/README.md` when done.
>
> **Multi-site layout (merged 2026-10-01, ADR 0037, plan 049)**: the data
> lives per site — `data/<site>/{dgm,cityjson,dlm,dop}` (Dresden's under
> `data/dresden/`), raw downloads in `data/_raw/<provider>/` — and the bakes
> run as `bun run fetch <site>` / `bun run bake <site> [tile…] [--step X]`
> through `scripts/pipeline.ts` (`scripts/bake.ts` and `--ingest` are gone;
> Saxony's adapter is `pipeline/bake/providers/sn.py`). Read the paths and
> commands below in that layout; this is drift, not a STOP condition.
>
> **Drift check (run first)**:
> `git log --oneline -10 -- pipeline/bake data/dlm data/dop data/provenance.json scripts/bake.ts`

## Status

- **Priority**: P2 (data currency; nothing is broken)
- **Effort**: S–M (half a day: downloads, bakes, a comparison, shots)
- **Risk**: LOW–MED — the class raster drives the ground colour, the water,
  the tree gate and the lamp gate, so an edition change shows everywhere
- **Depends on**: plan 040 step 1 (`bun run bake` runs step-major, so every
  step reads its neighbours' fresh outputs)
- **Planned at**: 2026-09-24; re-scoped 2026-10-01 (audit)
- **Status**: TODO

## Why this matters

Only the **four original tiles** — `33410_5656`, `33410_5658`,
`33412_5656`, `33412_5658` — still carry products from the old bash bake
of the June 2026 Basis-DLM package: land cover + legend, hedge/tree rows,
canopy, NDVI and roof colours. The eleven tiles added on 2026-09-25 were
baked by the Python pipeline from the current package. On the four, the
land cover was since edited in place by `bake --step islands` (OSM parks
and lawns carved to meadow) and the canopy filtered against bridges
(2dbdeb2), but the canopy was never re-baked after the carve, so trees
can still stand inside the carved parks (plan 023 phase 1c's leftover).
Their lamps also still carry the old ~50 m margin (34, 3, 50 and 3 lamps
outside their own tile; the viewer filters them by owner at runtime).

The spawn-tile comparison done while porting the bakes measured what a
re-bake changes: land cover 99.95 % of texels identical; canopy
5 104 vs 5 118 points; NDVI pixel-identical (same DOP flight); roof
colours 3 658 of 3 668 identical, the rest within 0.008. The differences
trace to the new DLM edition (no `ver03_f` / `ver06_f` areas on that tile,
which feed class 5).

**Scope is the whole chain, not five products.** About thirteen later
steps read the class raster (surface, edges, markings, sport, furniture,
tram, riverside, lowveg, cultivated, small-buildings, trees, …). Re-baking
only the land cover would leave them describing a different raster, and
no test would notice.

## Steps

### 0. Inputs and their editions

```bash
cd pipeline && uv sync && cd ..
bun run bake --ingest 33412_5656_2_sn --step landcover   # downloads DOM1, DOP, Basis-DLM, OSM if missing
```

Record the editions before baking:

- the Basis-DLM ZIP's `Last-Modified` (`curl -sI <download URL>`) and any
  metadata file inside the ZIP;
- the Geofabrik extract's timestamp (its file name, or `osmium fileinfo -e`
  if osmium is installed — it is not part of the pipeline environment);
- DOM1 / DOP `stand` from the download-link service (unchanged if the
  portal still lists 2024-11-30 / 2024-03-19).

### 1. Bake the four tiles in place, on a branch

```bash
git switch -c claude/rebake-four-tiles
bun run bake 33410_5656_2_sn 33410_5658_2_sn 33412_5656_2_sn 33412_5658_2_sn
```

After plan 040 this runs every step for the four tiles, step by step. The
neighbours outside the four keep their files (they were baked from the
current edition already). Then re-bake **every tile's** seam-reading steps
once more so the neighbours see the new four
(`bun run bake --step markings`, `--step tram`, `--step cultivated`,
`--step small-buildings` — check `bake.ts`'s header for the current list of
steps that read neighbours).

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

Compare against `HEAD` (the committed version). For the vegetation files
`scripts/eval/compare-bakes.py --ref HEAD` already does it; for the class
raster a short numpy + Pillow script over `git show HEAD:data/dlm/landcover_<t>.png`
is enough. Also count what the downstream steps changed (`git diff --stat data/`).

### 3. Look at the differences

Take headed plates (`bun run shots`) at the places the confusion table
points to, before and after, from an oblique angle (AGENTS.md): at least
the rail yard on the spawn tile (class 5), the Elbe shoreline (class 8),
and one park (classes 1–3, canopy). Use the plan 019 snapshots where they
fit.

### 4. Verify and commit the re-bake

```bash
bun run verify && bun run test:pipeline && bun run test:e2e
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
