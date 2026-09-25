# Plan 026: Road markings — crossings, stop lines, cycle lanes

> **Executor instructions**: Read fully first. Phases in order. The
> markings are painted in the terrain's fragment pass, like parking bays
> and sports lines; judge them on a real GPU (`bun run shots --headed`,
> full profile, oblique and from 150 m). Update the status row in
> `docs/plans/README.md` when a phase lands.
>
> **Ground**: the fine level is a TIN since PR #49 (ADR 0030). The
> markings are sampled by data-frame position (`vSplatUv`), not by mesh
> vertex, so a few large TIN triangles on a flat road change nothing —
> check it on a plate anyway.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- app/_components/ground-detail.ts app/_components/terrain-layer.ts pipeline/bake/surface.py pipeline/bake/edges.py`

## Status

- **Priority**: P2 (look — reads instantly as "a real street")
- **Effort**: M (bake M, shader M)
- **Risk**: LOW–MED — one more optional raster and table on the fine level
- **Planned at**: 2026-09-25
- **Status**: DONE (2026-09-25; the look unjudged on a GPU) — all three
  phases built: `pipeline/bake/markings.py` (table + 2048² RGBA raster,
  committed for the four tiles), `app/_components/road-markings.ts`
  (zebra, *Furt*, stop lines, cycle lanes, centre lines; scales with
  *Bodendetail*). Measured: 364 crossings (59 zebra, 305 *Furt*), 214 stop
  lines; axis within 20° of the crossing footway for 278 of 301, 18 of
  364 rectangles < 70 % on the DLM carriageway (STOP is 1 in 10: not
  triggered). Deviations: the raster is four channels, not two — the row
  is 16-bit (R + 256·A: the densest tile has 214 rows, and nothing caps a
  tile at 255) and B carries the signed offset to the carriageway's middle
  (the single-sided kerb distance, clamped at ±6.35 m, cannot place a
  centre line on a wide road); the lane bits are resolved per side in the
  bake (the paving raster's bearing is modulo 180°); crossings are
  measured also 5/10 m along the road (junction crossings). Centre-line
  STOP: restricted to main roads (primary…unclassified) with a
  carriageway ≥ 5.5 m; residential `lanes=2` streets left unmarked. Open:
  every plate (Albertplatz, Postplatz, Königsbrücker Straße) and the moiré
  check on a GPU.

## Why this matters

Streets carry kerbs, paving and parking bays (plan 023) but no paint.
OSM knows where the paint is (four tiles, BBBike 2026-09-19):

- **1 026 `highway=crossing`** nodes: `crossing=traffic_signals` 462,
  `uncontrolled` 68, `marked` 7; `crossing:markings=zebra` 15, `dashes`
  28; `crossing_ref=zebra` 13; `unmarked` 522 and `markings=no` 570
  (nothing to paint).
- **311 `highway=traffic_signals`** nodes, 244 with a direction
  (`forward` 155, `backward` 88) → stop lines on the right approach.
- **Cycle lanes**: `cycleway:right=lane` 274, `:left=lane` 41,
  `:both=lane` 87, `cycleway=lane` 12.
- `lanes` on ~1 600 ways (`2` 835).

None of these tags is read today (`surface.py` reads `highway`, `surface`,
sidewalk and parking tags only).

## Design

The two templates already exist:
- **Analytic shapes from a table** — `sport.py` + `sport-ground.ts`: a
  raster only indexes which feature touches a texel, a float table carries
  each feature's frame, and the shader draws SDF lines box-filtered over
  the pixel footprint (`spLine`, `grFw` fades).
- **Bands along the street** — the parking lanes in `ground-detail.ts:378-398`
  from the kerb distance (`edges` R) and the along-street coordinate
  (`surface` BA) and bearing (`surface` G).

### Bake — `pipeline/bake/markings.py`

- **Crossing table** `markings_<tile>.json`: one row per paintable
  crossing — `[cx, cy, angle, halfLength, halfWidth, kind]`, metres from
  the tile's NW corner like the sport table. The crossing's axis is the
  crossed road's bearing at the node (nearest `highway` line through it);
  its length is the carriageway width there (the DLM road class across the
  node, measured on the class raster along the normal), width 4 m (zebra)
  or 3 m (furt). `kind`: zebra (`crossing:markings=zebra`,
  `crossing_ref=zebra`, `crossing=marked|uncontrolled|zebra`), furt
  (`crossing=traffic_signals` or `markings=dashes`; German signalled
  crossings are two broken lines, not a zebra). Stop lines: rows of kind
  `stop` 3 m before each directed signal node, across the right half of
  the approach (German right-hand traffic), 0.5 m wide.
- **Index + lane raster** `markings_<tile>.png` (2048², 2 channels
  interleaved in greyscale, like `edges`): R = 1 + table row touching the
  texel (grown by 1 m; 0 none); G = lane bits on road texels — bit 0 cycle
  lane on the way's right, bit 1 on its left, bit 2 centre line (a
  two-way road with `lanes ≥ 2` and no `oneway`).
- `attribution` = OSM. Register after `surface` and `edges` (it reads the
  class raster only, but keep the order readable). Tests with `_osm_tile`.

### Publish

`markings` + `markingsTable` artifacts in `lib/city/tile.ts`, fine level
only in `TerrainExtras` (`lib/city/tileset.ts`), `bakeTerrain`'s
`described` (`level === 0 &&`).

### Shader — `app/_components/road-markings.ts`

Patched into the terrain fragment after `SPORT_GROUND`; its has-flag
joins the `customProgramCacheKey` (`terrain-layer.ts:613`) — a new
optional raster that is missing from the key recompiles into the wrong
program.

- Zebra: 0.5 m bars / 0.5 m gaps along the crossing's width axis; furt:
  two 0.12 m broken lines (0.5 m dash, 0.2 m gap) at the long edges; stop
  line: one 0.5 m bar.
- Cycle lane: a 0.25 m broken (1 m/1 m) line 1.85 m from the kerb
  (`edges` R distance), on the tagged side of the way's bearing.
- Centre line: 0.12 m dashes (3 m / 6 m) at the carriageway's middle —
  the midpoint of the kerb distances along the normal.
- Paint colour: a warm off-white, a little worn (low-frequency mottle),
  under the scene's palette; box-filtered and faded by `fwidth` like
  `spLine`. All of it scales with the existing **`groundDetail`** row —
  no new slider.

### Docs

Ledger (Geometry & ground: Road markings ✅), `data-flow.md`, `rendering.md`
codebook, `data-pipeline.md`, provenance, guide OSM row (en + de).

## Phases

1. Crossings (zebra + furt) — plates: the Albertplatz, Postplatz.
2. Stop lines.
3. Cycle lanes, then centre lines — plates on the Königsbrücker Straße.

## STOP conditions

- Crossings sit visibly off the carriageway or at the wrong angle in more
  than 1 in 10 checked (sample 20 across the tiles): report before
  tuning; the node-to-road snap is the suspect.
- Centre lines appear on roads a human reads as one-lane: drop the centre
  line phase, keep the rest.
- Moiré at any distance: the fades are wrong, not the raster budget.
