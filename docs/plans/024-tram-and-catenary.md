# Plan 024: Trams — tracks, overhead line, stops

> **Executor instructions**: Read fully first. Phases in order; each lands
> on its own. The look is judged on a real GPU (`bun run shots --headed`,
> full profile, oblique plates); lite/SwiftShader only proves it compiles.
> Honour the STOP conditions. Update the status row in
> `docs/plans/README.md` when a phase lands.
>
> **Base**: `feat/tin-kataster-lowveg` (TIN terrain, ADR 0030 there) is in
> flight. If it has merged, work on top of it; the tram layer samples the
> ground through `ctx.heightAt` either way.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/rail.py app/_components/rail-layer.ts app/_components/tile-stream.ts`

## Status

- **Priority**: P1 (the biggest gap in the Dresden street scene)
- **Effort**: M (bake S, tracks M, overhead line M, stops S)
- **Risk**: MED — thin wires alias; bridge decks need road-deck heights
- **Planned at**: 2026-09-25
- **Status**: TODO

## Why this matters

Dresden is a tram city, and the viewer has none: `rail.py` keeps DLM
`ver03_l` with `SPW='1000'` only (heavy rail; `rail.py:90-93`), and trams
were left out on purpose because the DLM carries them poorly
(`docs/transformations.md`, Steel rails). OSM carries them well. In the
four tiles (BBBike extract of 2026-09-19, box 410 000–414 000 ×
5 656 000–5 660 000):

- **401 `railway=tram` ways, 59.6 km** of track (OSM maps each track as
  its own way), all `gauge=1450` (Dresden's own gauge) and
  `electrified=contact_line`; 8 on bridges (`bridge=yes|viaduct`), 4 in
  cuttings (`layer=-1`), 2 crossovers.
- **321 `power=catenary_mast`** points.
- **161 `railway=tram_stop`** points; tram platforms partly arrive already
  through `rail.py`'s OSM platform read.
- No `embedded`/`embedded_rails` tags: where a track runs in the street
  must be inferred (below).

The overhead wires against the sky are the most graphic line work Dresden
streets have; they suit the ink/contour look.

## Design

### Bake — `pipeline/bake/tram.py` → `data/dlm/tram_<tile>.geojson`

- `read_osm(tile, "lines", "railway = 'tram'", ["railway", "other_tags"])`
  (`railway` is a column on `lines` only, `rail.py:322-323`). Merge
  fragments at 1 m like `merge_lines` in `rail.py:53-87`; clip to the
  tile + 30 m margin (lines cross seams; the runtime samples the
  cross-tile `ctx.heightAt`, never the tile's own).
- Per line properties: `bed` — `"street"` when ≥ 70 % of its 2 m samples
  fall on class 7 (road) of the committed class raster, `"grass"` when on
  class 1 or NDVI > 0.3 there (Dresden's *Rasengleis*), else `"ballast"`;
  `bridge` (1 when OSM says so), `layer`.
- Masts: `read_osm(tile, "points", "other_tags LIKE '%\"power\"=>\"catenary_mast\"%'", ["other_tags"])`,
  owned by one tile (`owns()`), as Point features `{k: "mast"}`.
- Stops: `railway=tram_stop` points `{k: "stop", name}`.
- `attribution` = `OSM_ATTRIBUTION`. Register `"tram"` in `STEPS`
  (`pipeline/bake/__main__.py`) **after** `landcover` and `ndvi`.
- Tests in `pipeline/tests/test_bakes.py` with `_osm_tile` (a street
  track, a grass track, a mast, ownership at the seam).

### Publish

`tram` in `TileArtifactKind` + `tileArtifacts()` (`lib/city/tile.ts`),
`TramFeature` in `lib/city/features.ts` (+ its case in `features.test.ts`),
`tram` in `DressingFiles` (`lib/city/tileset.ts`) and `dressingOf`
(`scripts/prepare-data.ts:370-384`). Optional artifact: missing = no trams.

### Runtime — `app/_components/tram-layer.ts`

Built in `buildDressing` (`tile-stream.ts:273-369`) with `ctx.heightAt`,
disposed in `disposeDressing`; census name `tram` (`create-app.ts:77-87`).

1. **Tracks.** Two rails per way at ±`1.450/2`, reusing `addRail`'s
   profile (`rail-layer.ts:452-505`; export it rather than copy it).
   - `street`: grooved rail flush with the road — rail top at ground
     + 0.02 m, darker groove strip 4 cm inside each rail; no sleepers.
   - `grass`: rails 0.15 m up, a meadow-coloured strip 2.6 m wide under
     them (the terrain already paints meadow there if NDVI says so; the
     strip only covers road-class texels).
   - `ballast`: rails as heavy rail, the ballast strip in the ballast tone.
   - **Bridges**: `rail-layer.ts:574-596` lifts only `kind === "rail"`
     decks. Extend the deck lift table to road decks (Augustusbrücke,
     Carolabrücke, Albertbrücke carry trams) and share it with this layer.
2. **Contact wire.** One wire per track at rail top + 5.6 m, sagging
   0.15 m between supports, sampled every 4 m. Rendered as camera-facing
   ribbons whose width is `max(0.012 m, 0.8 px)` in the vertex shader
   (no `Line2`, no new dependency), colour near-black, height fog on,
   `castShadow = false`.
3. **Supports.** OSM masts: a 7.5 m steel pole (instanced, casting). From
   each mast, a span wire across to the nearest mast on the other side of
   the track pair within 28 m, else a cantilever arm to the nearest track.
   Wire stretches with no mast within 45 m (narrow streets, where Dresden
   hangs the wire from wall rosettes) get span wires to the LoD2 facade
   on both sides (ray against the city BVH at 6 m height, ≤ 15 m) every
   30 m — derived from the buildings the wire really hangs from, and
   dropped where no facade is found.
4. **Stops.** An "H" stop sign on a pole (reusing the furniture palette
   and its instancing path) at each `tram_stop` not already carrying a
   shelter from `furniture_<tile>`.

### Docs

`docs/transformations.md` (Railway & bridges: trams ✅), `docs/data-flow.md`,
`docs/rendering.md` codebook, `docs/data-pipeline.md` step table,
`data/provenance.json` OSM products, the credit list in
`sites/dresden.ts:40-43`, guide `data-sources.md` OSM "Used here for" (en + de).

## Phases

1. Bake + publish + tracks (street/grass/ballast, bridges). Plate: the
   Postplatz junction and the Augustusbrücke, oblique, noon.
2. Contact wire + masts + span wires + rosette spans. Plates at dusk
   against the sky and from 150 m in fly mode (aliasing check).
3. Stop signs.

## STOP conditions

- Wires shimmer or crawl at any distance in the plates: fix the pixel-width
  floor and fade the wire out past ~400 m; do not add MSAA or a line
  library.
- The `bed` inference puts > 10 % of a visibly street-running line on
  grass (check the Hauptstraße and the Albertplatz): report the numbers
  before tuning thresholds.
- The shadow map cost rises measurably (> 0.3 ms): wires and span wires
  must not cast; only poles cast.
