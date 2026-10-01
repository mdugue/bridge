# Plan 017: Any German city — the open half: a second Land, NAS input, OSM land cover, a site check

> **Executor instructions**: Follow this plan phase by phase. Each phase is
> its own PR and must leave Dresden rendering exactly as before. Run every
> verification command and confirm the expected result before moving on. If
> anything in the "STOP conditions" section occurs, stop and report — do not
> improvise. When a phase is done, update the status row for this plan in
> `docs/plans/README.md` (PARTIAL with the open phases, DONE at the end).
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
> `git log --oneline -10 -- lib/city/site.ts sites pipeline/bake/ingest_sn.py pipeline/bake/landcover.py pipeline/bake/__main__.py scripts/bake.ts docs/portability.md`

## Status

- **Priority**: P2 (direction, not a defect)
- **Effort**: M–L for what is open (phases A–D below, each S–M)
- **Risk**: MED — Dresden must stay byte-identical; the data-availability
  facts per Land are unverified (see "Open questions")
- **Depends on**: plan 045 (named class ids in the bakes) before phase C;
  plan 040 step 3 (ingest hardening: timeouts, https check, atomic
  extraction) is the pattern a second adapter copies
- **Category**: portability / data pipeline
- **Planned at**: commit `cf8602a`, 2026-09-23; rewritten for the Python
  pipeline on 2026-10-01 (audit) — the bash/JSON text is in git history
- **Status**: PARTIAL — the site config, the Python bake package and the
  Saxony adapter are built (below), and plans 049 and 051 built most of
  phases A, C and D in their own shape (see "Progress, second round");
  open: NAS input (phase B) and the canopy without DOM1 (phase D.1).

## Progress, second round (plans 049 and 051)

[Plan 049](./049-many-sites-one-env-var.md) and
[ADR 0037](../adr/0037-sites-providers-and-per-site-data.md) finished most
of what is open below, in a different shape: a typed `Provider` per
Land instead of `Site.ingest`; `bun run fetch <site>` with one adapter per
provider — Saxony, NRW, Bavaria, Hamburg (tested), Berlin (untested) — that
also fetches the DGM1 and the LoD2 (CityGML converted in-house, no
citygml-tools/cjio); per-site data in `data/<site>/`, downloads per
provider (`data/_raw/<provider>/`), provenance per site
(`data/<site>/provenance.json`); OSM land cover where the Basis-DLM is not
open as Shape (phase C); `bun run site <site>` (phase D's `site:check`);
tests over every site; one deployment with a route per site.
[Plan 051](./051-stand-ins-and-derived-looks.md) and
[ADR 0039](../adr/0039-stand-ins-marked-per-city.md) added phase C.2: OSM
rails and bridge decks (`rail_osm.py`) for providers without a DLM. Still
open: NAS input (phase B) and row-only trees without DOM1 (phase D.1).

## Built (2026-09-24…26)

- **The site config, in TypeScript.** `lib/city/site.ts` holds the `Site`
  type (id, label, title, EPSG 25832/25833, `tileKm`, `tileSuffix`, the
  tiles as `{e, n}` km cells, fallback lat/lng, attribution, viewpoints,
  the ingest adapter) plus `tileIdOf` / `tileExtentOf` / `utmZoneOf`;
  `sites/dresden.ts` is the one site and `SITE` picks it at build time
  ([ADR 0026](../adr/0026-one-site-config-per-build.md)). There is no tile
  block any more: the site streams as a 3D Tiles tileset
  ([ADR 0024](../adr/0024-site-streams-as-3d-tiles.md)).
- **One Python bake package** (`pipeline/bake/`, uv;
  [ADR 0025](../adr/0025-bakes-are-one-python-package.md)), run by
  `bun run bake [tile] [--ingest] [--step X]` with the site's extent and
  CRS. Canonical raw layout: `data/_raw/<site>/{dom1,dop,dlm,osm,lsc,downloads}`;
  the DGM1 and the CityJSON stay committed under `data/`.
  `pipeline/bake/ingest_sn.py` is Saxony's adapter (GeoSN's download-link
  service per tile, the statewide Basis-DLM, the Geofabrik extract, the
  city's tree WFS; checked downloads). Every OSM layer is baked on all
  fifteen tiles from a local Geofabrik extract.
- **The class table is data** at the top of `pipeline/bake/landcover.py`
  (`CLASSES`, the burn order, `ROAD_HALF_WIDTH`); the colours are the
  client's alone ([ADR 0023](../adr/0023-land-cover-colours-painted-at-runtime.md)).
- **Optional inputs, partly:** without DOM1 or DOP the canopy, NDVI and
  roof-colour steps skip with a note; rail decks fall back to the DGM ramp.
  `docs/portability.md` separates what is built from what is planned.

## Why this matters

The viewer still renders Dresden only. The site config and the bake
package made the code Land-neutral in shape, but there is one ingest
adapter (Saxony), the bakes need the Basis-DLM as AdV Shape, and
`docs/portability.md` lists fallbacks (OSM land cover, row-only trees
without DOM1) that are not built.

The runtime is closer to portable than the pipeline:

- terrain bounds come from the tileset (`lib/city/tileset.ts`), not from the tile name;
- `lib/city/crs.ts` handles EPSG:25832 **and** 25833, which together cover
  every German Land (each Land picks one zone for its whole territory, so a
  city never straddles zones);
- the LoD2 attributes the bake reads (`function`, `roofType`,
  `measuredHeight`) are AdV-standard CityGML, nationwide; the one Saxon
  extra, `Dachneigung`, already falls back (`lib/city/building-tint.ts`);
- the Basis-DLM layer names the bakes use (`veg01_f`, `ver01_l`, `gew01_f`,
  `ver03_f`, `ver06_f`, attributes `BRF`/`WDM`) are the AdV Shape profile,
  not a Saxon invention.

So the work left is: one ingest adapter per Land, NAS as a second DLM
format, and OSM as a same-shape substitute for the Basis-DLM where the
Land does not publish it.

## Phase A — A second Land: the NRW adapter and a second site (M)

1. `pipeline/bake/ingest_nw.py` (NRW, EPSG:25832, 1 km downloads), modelled
   on `ingest_sn.py` and its tests (`pipeline/tests/test_ingest.py`): for
   rasters, mosaic the Land's tiles and cut our 2 km tile at 1 m (DOP at its
   native resolution) with rasterio (GDAL is in the wheels; no shell);
   LoD2 via `citygml-tools to-cityjson` and `cjio … merge` +
   `subset --bbox` per tile (bake-only tools; document them in
   `docs/data-pipeline.md`). Widen `Site.ingest` (`lib/city/site.ts`, today
   the literal `"sn"`) to `"sn" | "nw"`.
2. `sites/<id>.ts` for an NRW city the maintainer picks (ask), one or a
   few tiles; commit its derived data only after the size check (STOP).
3. Per-tile provenance (was README Direction option 6): the ingest adapter
   writes `data/<site>/<tile>.provenance.json` (dataset, edition, download
   date, licence — the values `download()` already checks); the HUD footer
   reads them where it shows the attribution.

**Verify**: `bun run test:pipeline` green; `SITE=<id> bun dev` boots the new
site; a `--headed` shot from an oblique angle shows buildings on the ground
(DGM and LoD2 heights agree); Dresden's `git status data/` stays clean.

## Phase B — NAS input for Länder without AdV Shape (S–M)

The bakes read the Basis-DLM as AdV Shape layers (`veg01_f`, `ver01_l`,
`gew01_f`, `ver03_f`, `ver06_f`, attributes `BRF`/`WDM`). For a Land that
ships only NAS/XML, the ingest adapter converts it with GDAL's NAS driver
(pyogrio/`ogr2ogr` from the wheels) into a GeoPackage, and a mapping
(`AX_Landwirtschaft→1`, `AX_Wald→2`, `AX_Gehoelz→3`,
`AX_Wohnbauflaeche|AX_IndustrieUndGewerbeflaeche|…→4`, `AX_Bahnverkehr→5`,
`AX_Weg→6`, `AX_Strassenverkehr|AX_Strassenachse→7`,
`AX_Fliessgewaesser|AX_StehendesGewaesser|AX_Gewaesserachse→8`) feeds the
same burn order. Confirm the width attributes' NAS names before relying
on them.

**Verify**: Dresden's `landcover_*.png` unchanged after the refactor; a
unit test over a tiny NAS sample (or a GeoPackage fixture) yields the
expected class ids.

## Phase C — OSM as a same-shape land-cover source (M; after plan 045)

Makes the Basis-DLM optional **without touching the runtime**: the bake
writes the same class raster and legend from another source.

1. `pipeline/bake/landcover_osm.py`: from the site's `.osm.pbf` (GDAL's OSM
   driver, as the other OSM bakes) write `landcover_<tile>.png` (class ids
   only — the colours are the client's) and the legend:
   `landuse=farmland|meadow|grass→1`, `landuse=forest|natural=wood→2`,
   `natural=scrub→3`, `landuse=residential|commercial|industrial|retail→4`,
   `landuse=railway→5`, `highway=footway|path|cycleway→6` (buffer 1 m),
   other `highway=*` → 7 (buffer by class, a `width=` tag wins),
   `natural=water|waterway=riverbank→8`, `waterway=stream|river` buffered.
   Use plan 045's named class ids, never literals.
2. `rail.py` without a DLM: tracks from `railway=rail`, bridge decks from
   `man_made=bridge` polygons (the deck logic is unchanged).
3. Hedge and tree rows for the canopy gate from OSM `natural=tree_row` /
   `barrier=hedge` when there is no DLM.
4. A `Site` field (e.g. `landcover: "dlm" | "osm"`) makes `bun run bake`
   run the OSM step instead of `landcover`.

**Verify**: for the spawn tile, bake OSM land cover on a branch and compare
with the DLM raster: class agreement ≥ 80 % on road/water/forest texels
(write the number here); a `--headed` shot side by side reads as the same
place.

## Phase D — Without DOM1, a site check, every site in the tests (S–M)

1. Canopy without DOM1: emit row-only trees at default heights (the
   portability matrix's "DOM1 absent" row, `docs/portability.md`) instead
   of skipping.
2. `bun run site:check [SITE]`: per tile, which inputs exist, which
   artifacts will be baked, which fallback applies — run by `bun run bake`
   first and cheap enough for CI.
3. `lib/city/features.test.ts` and `lib/city/tile-data.test.ts` iterate
   every site's tiles, not just `DRESDEN`.
4. Docs: the per-Land table in `docs/portability.md` (portal, CRS, download
   tile size, formats, licence), an ADR for the second Land if it changes a
   decision, `docs/data-pipeline.md`, the guide's data-sources page in
   **both** languages.

## STOP conditions

- Phase 3 or 4 changes any Dresden artifact (`git status data/` after a
  re-bake with the DLM path) — find out why before continuing.
- A second site's committed derived data would add more than ~40 MB to the
  repo (the DGM GeoTIFF alone is 13–15 MB per 2 km tile): ask the maintainer
  (ship one tile, or keep the second site uncommitted) — never switch on
  Git-LFS (AGENTS.md "ask before").
- A Land's licence requires terms the HUD footer can't carry (e.g. a
  non-derivative or non-commercial clause): stop for that Land.
- `citygml-tools` / `cjio` cannot produce CityJSON the bake accepts (CRS
  other than 25832/25833, missing `objectid`/`surfacetype`) — report rather
  than patch the loader.
- LoD2 roofs and DGM1 disagree by more than ~1 m at building footprints in
  the new site (different height references/editions): report.

## Open questions (verify, don't assume)

- **Availability and licence per Land** of DGM1, DOM1, LoD2, DOP (RGBI or
  RGB only) and Basis-DLM (Shape vs NAS only, open or not). LoD2 and DGM1
  are believed open in most Länder; DOM1 and Basis-DLM are not everywhere.
  Fill a table in `docs/portability.md` from the portals themselves.
- Berlin and Hamburg cut downloads by their own grids/districts — the
  ingest mosaicking handles that, but confirm the CRS (25833 / 25832).
- Brick-built northern cities may want a site-level roof/facade tint preset
  (`building-tint.ts` defaults to Dresden old-town terracotta). Out of scope
  here; note it as a future `Site` field if it matters.
