# Plan 051: Stand-ins where a Land publishes less, and looks derived from each city's data

> **Executor instructions**: Read fully first. The code is built and
> baked where noted; what is open is the look on a real GPU (`bun run
> shots --headed`, full profile, `SHOTS_SITE=<id>`), the re-bakes listed
> under *Open items*, and the items a stand-in cannot fix. Update the
> status row in `docs/plans/README.md` when one lands.
>
> **Builds on** ADR 0037 (sites, providers, per-tile steps read from the
> site config), plan 050 (landmarks, the roof relief, OSM materials) and
> ADR 0033 (bridges measured in DOM1). The decisions are
> [ADR 0039](../adr/0039-stand-ins-marked-per-city.md).
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/rail_osm.py pipeline/bake/ndvi.py pipeline/bake/osm_buildings.py lib/city/valley-fog.ts lib/city/source-matrix.ts`

## Status

- **Priority**: P2 (every city but Dresden looked poorer than its data
  allows)
- **Effort**: M (eight small items, two of them by other threads)
- **Risk**: LOW–MED — a stand-in weaker than what it replaces; a derived
  look drifting from what was tuned on Dresden
- **Planned at**: 2026-10-01
- **Status**: BUILT (2026-10-01), looks unverified on a real GPU. Baked:
  Hamburg's rails and decks, Hamburg's and Leipzig's registers, Munich's
  vegetation index, Hamburg's facade context (`brick` on all four
  tiles), Unna's relief floor. Not re-baked: `osm-buildings` on the
  other sites (their files carry no `context`, which builds as plaster —
  the old default), the landmarks (the floor) and the relief floor on
  the other sites.

## Goal

Generalise the one-off fixes so that **every city benefits**. A city
added under ADR 0037 got exactly what its Land publishes, and a step
whose source was missing wrote an empty file; some looks were tuned on
Dresden and applied everywhere, or set per site by hand. Two rules came
out of it (ADR 0039):

1. Where a Land or a city lacks the best source, read a **named
   stand-in** that measures or maps the same thing — and mark it per
   city, generated from the configs, so the difference is visible.
2. **No per-site look switches**: derive a look that differs between
   cities from the city's own data, in the bake or the build.

## What was done

1. **OSM rails, ballast and bridge decks without a Basis-DLM** (Hamburg,
   Berlin). `pipeline/bake/rail_osm.py` reads the rail ways
   (`rail`/`light_rail`/`subway`/`narrow_gauge`, out of tunnels, with
   `tracks` and `electrified`), buffers their beds into ballast, and
   hands the `bridge`-tagged road, path and rail ways and the
   `man_made=bridge` outlines to `rail.py`'s deck code
   (`decks(..., merge=True)`): a way on an outline already claimed adds
   nothing, the loose buffers of one bridge on one `layer` merge into one
   deck (`merged_decks`) — OSM draws a carriageway, its pavements and a
   cycle track as separate ways. `Ground(tile, networks)` classifies an
   unclaimed outline from OSM's networks. Deck heights, ribs, the fairway
   and Wikidata are unchanged. The `rail` step now runs **before
   `canopy`**, and `canopy.bridge_mask` reads the baked
   `bridge_<tile>.geojson` without a DLM, so no crown grows on an OSM
   deck.
2. **The landmark relief stands on the roof under it**
   (`structures.py` `relief`: `grid.floor` per cell, the lowest LoD2 roof
   in the 3 × 3 around it, roof cells only, sunk 0.3 m; `fill_voids` for
   DOM cells > 1 m below the LoD2 roof; `lib/city/structures.ts`
   `reliefMesh` drops each edge wall to its cell's floor). Found on Unna's
   Evangelische Stadtkirche (plan 050, Findings).
3. **Facade material from the neighbourhood** (`osm_buildings.py`
   `apply_contexts`): mapped wall materials within 300 m vote, distance
   weighted (brick for, plaster/stone/concrete/wood against, glass and
   metal abstain); ≥ 6 votes locally, else the tile and ≈ 350 m around
   it with ≥ 20, else plaster. The file's top-level `context` is the
   tile's, an object's own only where it differs. `Site.facades` is gone;
   `prepare-data.ts` passes the tile's context, `bake-city-mesh.ts` uses
   `look.context ?? facades`, a part inherits its root's
   (`inheritedLook`).
4. **A vegetation index from the visible bands** for a DOP without
   infrared (Bavaria): `ndvi.py` `gli_raster`, GLI = (2G − R − B) /
   (2G + R + B), mapped by 3.3 · GLI + 0.14 onto the NDVI's scale.
5. **Tram gauge from OSM**: `tram.py` `gauge_of` → the track's `g` (m);
   `TRAM_GAUGE` is the standard-gauge fallback 1.435 m; `tram-layer.ts`
   `addTrack` lays the rails at ± half the track's own gauge.
6. **Valley-haze depth from the site's relief**
   (`lib/city/valley-fog.ts`): `prepare-data.ts` samples each tile's
   coarse ground on a 32² grid, the tileset's `extras.ground` carries the
   site's 2nd and 90th height percentile, `create-app.ts` sets the fade
   height to 0.6 × that relief, clamped to 8–28 m.
7. **Landmarks by relative notability** (`landmarks.py`): ≥ 8 % of the
   tile's top sitelinks (`NOTABLE_SHARE`, never under 2), 40 a tile as a
   safety cap instead of a fixed 12 — plan 050's *Dense tiles* item.
8. **The generated *Sources by city* page**: `lib/city/source-matrix.ts`
   (pure: a row per drawn layer, a column per configured site, each cell
   🟢 best / 🔵 OSM only / 🟡 stand-in / ⚪ none, with the reason),
   `scripts/docs-matrix.ts` (`bun run docs:matrix`) writes
   `docs/guide/{en,de}/sources-by-city.md`, `scripts/docs-matrix.test.ts`
   fails when they differ.

Done in the same round by other threads, recorded here for the whole
picture:

- **Tree registers for Hamburg, Leipzig and Berlin**: `cadastre.py`
  holds each register as data — the WFS (service, feature types, output
  format, CRS) and a field mapping onto one tree record (`REGISTERS`;
  `lib/city/site.ts` `TREE_REGISTERS`). Hamburg's *Straßenbaumkataster*
  (BUKEA, dl-de/by-2-0, street trees, **no heights**: measured in
  DOM1 − DGM1 around the trunk where that fits the crown), Leipzig's
  *Baumkataster* (Amt für Stadtgrün und Gewässer, dl-de/by-2-0, street
  and park trees; felled ones and stands skipped), Berlin's *Baumbestand*
  (Geoportal Berlin, dl-de/zero-2-0, street and park trees). Sites
  `hamburg`, `leipzig`, `berlin` name them (`treeCadastre`).
- **Bavaria's laser scan**: `providers/by.py` `lsc` fetches the LDBV's
  classified laser points (CC BY 4.0, four 1 km LAZ a tile, merged) and
  maps their classes into the AdV scheme (`LSC_CLASSES`: 6 building and
  20 object points → 20; 9, 23, 24 → DTM only; class 22 by the file's
  year); every scan's low-return intensities are normalised by its own
  ground median (`lsc.rasterise`). See the ledger and data-pipeline.md.

## Results

- **Hamburg** (four tiles): 348 bridge decks — the Busanbrücke, the
  Brooktorkaibrücke, the Kuhmühlenbrücke, the Berlin–Hamburg and
  Lübeck–Hamburg lines' bridges among them —, 81 km of track and
  0.27 km² of ballast, where there were none. 10 418 register trees.
- **Leipzig**: 25 498 register trees.
- **Munich**: `ndvi_<tile>.png` on its four tiles from the GLI. The line
  was fitted on Unna's two summer DOP tiles (NRW's RGBI): r ≈ 0.7
  against the NDVI, 85 % agreement on NDVI > 0.3; on Hamburg's tiles r
  0.75–0.86.
- **Facades** — mapped wall materials in the baked files, the votes the
  context counts: Hamburg 106 brick / 11 plaster (its four tiles vote
  brick, so the clinker look Hamburg had by hand now comes from its
  data), Unna 45 plaster / 0 brick, Munich 272 plaster / 38 brick,
  Dresden 866 plaster / 246 brick.
- **Tram gauge**: Dresden 1450, Leipzig 1458, Munich 1435 mm, each from
  OSM.
- **Valley haze**: Dresden, Grimma, Meißen and Unna keep 28 m (the cap);
  Hamburg ≈ 9.6 m, Leipzig ≈ 12 m, Munich ≈ 15 m.
- **Unna's Stadtkirche**: the tower's relief stands on the nave's slope
  (floor down to −10.1 m under the 136.3 m roof) instead of hovering at
  the ridge, without the "legs" the sound openings tore into it.

## Open items

- **GPU plates not judged**: the OSM decks and track in Hamburg (the U3
  viaduct, the Hauptbahnhof's approaches, from the vantage and on foot),
  Munich's crowns and meadows under the GLI, a brick quarter beside a
  plaster one, the shallower haze in Hamburg and Munich, Unna's tower.
- **Re-bakes**: `osm-buildings` on every site but Hamburg (so Dresden's
  246 mapped brick walls can turn their quarters brick), `landmarks`
  (with the Wikidata cache; the committed files still hold the fixed 12)
  and then `structures` — only Unna's structures carry the relief
  `floor` yet; a file without it builds the old walls.
- **Hamburg's register has no heights**: 82 % are measured in DOM1, the
  rest come from the crown — fine for street trees, weaker under a
  closed canopy where the highest texel is a neighbour's.
- **Berlin is configured, not built**: its adapter is untested (the
  portal was unreachable from the agent's container); its register,
  OSM rails and decks wait for a first fetch and bake.
- **Hamburg publishes no laser scan** (it declined to, citing privacy):
  no sheds, no extra crowns, OSM hedges at their tag height. No
  stand-in: DOM1 alone cannot tell a shed from a crown.
- **The GLI is weaker than the NDVI**: it tells green from grey well and
  vigour less well; a dark conifer and a dry lawn read alike. If
  Bavaria opens its CIR orthophoto, read it instead.
- **OSM rails per track**: OSM maps each track as its own way where the
  DLM bundles them (`tracks`), so a yard is many single pairs rather than
  one bundled line, and the ballast is the beds' union, not the DLM's
  surveyed yard area. Acceptable from eye height; check from the air.

## Docs

Ledger (*Rails, ballast and decks from OSM*, *Vegetation index from the
visible bands*, *Facade context*, the haze depth under *Height-term
fog*, the tram gauge, the relief floor, the landmark floor, five 🗃️
rows), `data-flow.md` (both diagrams), the `rendering.md` codebook,
`data-pipeline.md`, `portability.md`, the guide's data sources (en + de)
and the generated *Sources by city*, ADR 0039, AGENTS.md.
