# Plan 017: Any German city — site config, a neutral tile grid, per-state ingest

> **Executor instructions**: Follow this plan phase by phase. Each phase is
> its own PR and must leave Dresden rendering exactly as before. Run every
> verification command and confirm the expected result before moving on. If
> anything in the "STOP conditions" section occurs, stop and report — do not
> improvise. When a phase is done, update the status row for this plan in
> `docs/plans/README.md` (PARTIAL with the open phases, DONE at the end).
>
> **Drift check (run first)**:
> `git diff --stat cf8602a..HEAD -- lib/city/tile.ts lib/city/crs.ts scripts/ app/_components/create-app.ts app/_components/viewpoints.ts app/_components/load-screen.tsx app/_components/scene-sidebar.tsx app/page.tsx docs/portability.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch that touches the step you are on, treat it as a STOP condition.

## Status

- **Priority**: P2 (direction, not a defect)
- **Effort**: L overall — five phases of S–M, ≈ 7–13 working days
- **Risk**: MED — Dresden must stay byte-identical through phases 1–3; the
  data-availability facts per Land are unverified (see "Open questions")
- **Depends on**: nothing; supersedes "Direction" option 1 (for Germany) and
  folds in option 6 (bake runner + provenance) in `docs/plans/README.md`
- **Category**: portability / data pipeline
- **Planned at**: commit `cf8602a`, 2026-09-23
- **Status**: PARTIAL. Phases 1, 2, 4 and 5 are done (see both "Progress"
  sections — the shape differs from what is written below). Open: NAS
  input (phase 3) and OSM rails / bridge decks for providers without a DLM.

## Progress, second round (plan 023)

[Plan 023](./023-many-sites-one-env-var.md) and
[ADR 0028](../adr/0028-sites-providers-and-per-site-data.md) finished most
of what is open below, in a different shape again: a typed `Provider` per
Land instead of `Site.ingest`; `bun run fetch` with one adapter per
provider — Saxony, NRW, Bavaria, Hamburg (tested), Berlin (untested) — that
also fetches the DGM1 and the LoD2 (CityGML converted in-house, no
citygml-tools/cjio); per-site data in `data/<site>/`, downloads per
provider; OSM land cover where the Basis-DLM is not open as Shape (phase 4,
tracks and decks excepted); `bun run site` (phase 5's `site:check`);
tests over every site. Still open: NAS input (phase 3), OSM rails and
bridge decks.

## Progress (2026-09-24, branch `claude/architecture-review-redesign-kddx6u`)

The phases below were written for bash bakes and a JSON site file. What was
built instead, and what that leaves open:

- **Phase 1 is done, as TypeScript.** `lib/city/site.ts` holds the `Site`
  type (id, label, title, EPSG 25832/25833, `tileKm`, `tileSuffix`, the tile
  list as `{e, n}` km cells, fallback lat/lng, attribution, viewpoints,
  ingest adapter) plus `tileIdOf` / `tileExtentOf` / `utmZoneOf`.
  `sites/dresden.ts` is the one site, and `SITE` picks it at build time
  (`NEXT_PUBLIC_SITE` inlines it into the client; `sites/index.ts`
  `currentSite()`). Dresden keeps its tile names through
  `tileSuffix: "_sn"`. A `.ts` file instead of JSON: the viewpoints are
  typed and use code constants, and no validator is needed. The client does
  not read the site from `manifest.json`; the build inlines it. The
  inserted-building plumbing (`insertAt`) was removed instead of
  configured.
- **The tile block is gone entirely** ([ADR 0024](../adr/0024-site-streams-as-3d-tiles.md)):
  the site's tiles become a 3D Tiles tileset, and "primary" is now just the
  spawn tile.
- **Phase 2 is done for Saxony, as Python.** The seven bash bakes became one
  package, `pipeline/bake/` (uv, numpy, rasterio, pyogrio, shapely;
  [ADR 0025](../adr/0025-bakes-are-one-python-package.md)). `bun run bake
  [tile] [--ingest] [--step X]` runs it with the site's extent and CRS. The
  canonical raw layout is `data/_raw/<site>/{dom1,dop,dlm,osm,downloads}`.
  The DGM1 and the CityJSON stay committed under `data/`, not raw.
  `pipeline/bake/ingest_sn.py` is the Saxony adapter: it resolves each
  tile's download through GeoSN's download-link service and fetches the
  statewide Basis-DLM and the Geofabrik extract. Compared with the committed
  artifacts on the spawn tile: NDVI identical, land cover 99.95 %, roof
  colours 3658/3668 identical, bridges 3 = 3, canopy 5104 vs 5118 trees.
  The differences trace to the newer Basis-DLM edition. The OSM bakes
  (walls, lamps, platforms, bridge structure) could not be run here because
  Geofabrik was unreachable. The per-tile provenance file (step 4) was not
  built; `data/provenance.json` stays the record.
- **Phase 3 is half done.** The layer → class table is data at the top of
  `pipeline/bake/landcover.py` (`CLASSES`, `burn_order`,
  `ROAD_HALF_WIDTH`), not a TSV. The colours no longer live in the bake at
  all ([ADR 0023](../adr/0023-land-cover-colours-painted-at-runtime.md)). NAS
  input is open.
- **Phase 4 (OSM land cover) and the NRW adapter are open.** With runtime
  colours, the OSM bake now only needs to write a class raster and a legend
  (no splat step to share).
- **Phase 5 is partial.** Missing DOM1 or DOP skips the canopy, NDVI and
  roof-colour bakes with a note, and rail decks fall back to the DGM ramp.
  `site:check`, the portability rewrite and a second site are open.

## Why this matters

The viewer only renders Dresden. `docs/portability.md` describes fallbacks
(OSM footprints, flat-plane terrain, OSM land cover) that are **not built**,
so porting today means hand-editing constants and bake scripts that assume
Saxony's naming, 2 km tiles and UTM zone 33.

The runtime is closer to portable than the pipeline:

- terrain bounds come from the heightfield header, not from the tile name;
- `lib/city/crs.ts` handles EPSG:25832 **and** 25833, which together cover
  every German Land (each Land picks one zone for its whole territory, so a
  city never straddles zones);
- the LoD2 attributes the bake reads (`function`, `roofType`,
  `measuredHeight`) are AdV-standard CityGML, nationwide; the one Saxon
  extra, `Dachneigung`, already falls back (`lib/city/building-tint.ts:196–200`);
- the Basis-DLM layer names the bakes use (`veg01_f`, `ver01_l`, `gew01_f`,
  `ver03_f`, `ver06_f`, attributes `BRF`/`WDM`) are the AdV Shape profile,
  not a Saxon invention.

So the work is: configuration instead of constants, a tile grid that is ours
rather than the Land's, one ingest adapter per Land, and OSM as a
same-shape substitute for the Basis-DLM where the Land doesn't publish it.

## Current state (what is Dresden/Saxony-specific)

| Where | What |
|---|---|
| `lib/city/tile.ts:12–19` | `PRIMARY_TILE = "33412_5656_2_sn"`, `NEIGHBOUR_TILES` hard-coded |
| `lib/city/tile.ts:168ff` | land-cover rasters are `required: true` (DLM is mandatory at runtime, contrary to portability.md) |
| `lib/city/crs.ts:20` | `FALLBACK_LAT_LNG` = Dresden centre |
| `app/_components/create-app.ts:109` | `DEFAULT_INSERT_AT = { x: 413_000, y: 5_657_000 }` |
| `app/_components/viewpoints.ts:37ff` | hand-picked Dresden vantages |
| `load-screen.tsx:135`, `scene-sidebar.tsx:661`, `app/page.tsx:5` | "Dresden · Altstadt" / "City Walk — Dresden" |
| `scene-sidebar.tsx` footer | "Quelle: GeoSN, dl-de/by-2-0" |
| `scripts/bake-wissen-hero.ts:23` | `step = 2` km per tile, parsed from the name |
| `scripts/ndvi-at-trees.py:14` | tile list duplicated |
| all seven `scripts/extract-*.sh` | `SUFFIX="2_sn"`, default tile `33412_5656`, extent from `${E#33}` + `2000` (wrong in zone 32), `EPSG:25833` literal (~20×) |
| `extract-dlm.sh`, `extract-canopy.sh`, `extract-rail.sh` | `SRC=data/_raw/basis-dlm/basisdlm_sn_shape`; DOM/DOP paths `dom1_<tile>_2_sn_tiff/…`, `dop20rgbi_<tile>_2_sn_tiff/…` |
| `extract-dlm.sh:61–101` | layer → class id mapping inline in bash |
| `extract-canopy.sh:33`, `extract-rail.sh:46` | hard `exit 1` without DOM1, although both have a sensible fallback |

## Target design (three decisions)

1. **One config per site** — `sites/<id>.json`, selected at build time with
   `SITE=<id>` (default `dresden`). Still a static app, no backend
   (ADR 0001 holds). `prepare-data.ts` copies the client-facing part
   (label, viewpoints, insert point, fallback lat/lng, attribution, tile
   block) into `manifest.json`; the client reads it from there.
2. **Our own tile grid** — 2 km squares in the Land's UTM zone, named
   `<zone>_<eKm>_<nKm>_<sizeKm>` (Dresden's primary becomes
   `33_412_5656_2` — or keep the legacy string for Dresden via an alias, see
   Phase 1 step 2). Independent of how the Land cuts its downloads, so the
   runtime, raster sizes (4096² over 2 km) and phone budgets stay as they
   are.
3. **Per-Land ingest adapters** — `scripts/ingest/<land>.sh` normalise the
   Land's downloads into one canonical layout
   `data/_raw/<site>/{dgm1,dom1,dop,lod2,dlm,osm}/…`, clipped/mosaicked to
   our grid. The `extract-*.sh` bakes read only that layout and know
   nothing about any Land.

Sketch of `sites/dresden.json`:

```jsonc
{
  "id": "dresden",
  "label": "Dresden · Altstadt",
  "title": "City Walk — Dresden",
  "land": "sn",                 // ingest adapter
  "epsg": 25833,
  "grid": { "zone": 33, "sizeKm": 2 },
  "primary": [412, 5656],       // SW corner, km
  "neighbours": [[410, 5656], [410, 5658], [412, 5658]],
  "fallbackLatLng": { "lat": 51.05, "lng": 13.74 },
  "insertAt": { "x": 413000, "y": 5657000 },
  "viewpoints": [ /* moved verbatim from viewpoints.ts */ ],
  "landcover": "dlm",           // "dlm" | "osm"
  "attribution": ["Quelle: GeoSN, dl-de/by-2-0", "© OpenStreetMap contributors"]
}
```

## Phase 1 — Site config and neutral tile ids (S–M, 1–2 days)

Goal: Dresden runs unchanged, but from `sites/dresden.json`.

1. Add `lib/city/site.ts`: the `Site` type, a validator (pure, `bun test`
   unit), and `loadSite(id)` for scripts. Add `sites/dresden.json` with the
   values from the table above.
2. `lib/city/tile.ts`: replace the constants with functions of a `Site`
   (`tileBlock(site)`, `primaryTile(site)`); add `parseTile(id)` /
   `tileId(zone, e, n, size)` / `tileExtent(id) → [xmin, ymin, xmax, ymax]`.
   For Dresden keep the committed file names working: either keep
   `33412_5656_2_sn` as the Dresden tile id (an optional `"tileSuffix": "_sn"`
   in the site) or rename the committed files in one commit — **prefer the
   suffix**, renaming ~60 committed files churns history for no user gain.
3. `scripts/tile-info.ts <tile>`: prints `XMIN=… YMIN=… XMAX=… YMAX=…
   EPSG=… SIZE=…` for `eval` in bash. Unit-test `parseTile` with zone 32 and
   zone 33, 1 km and 2 km ids.
4. `prepare-data.ts`: read `SITE` (default `dresden`), bake that site's
   block, write the site's client fields into `manifest.json`.
5. Client: `city-walk-client.tsx` takes the block from the manifest (it
   already fetches it); `create-app.ts` takes `insertAt` / fallback lat-lng
   from it; `viewpoints.ts` becomes a type + an accessor; labels in
   `load-screen.tsx`, `scene-sidebar.tsx` and the footer attribution come
   from it. `app/page.tsx` metadata reads the site JSON at build time.
   Keep a flat-name fallback for a missing manifest (as today).
6. `bake-wissen-hero.ts` and `ndvi-at-trees.py` take the tile list and size
   from the site (the Python script via argv).

**Verify**: `bun run fix && bun run verify` green; `bun scripts/prepare-data.ts`
produces a `public/data` whose hashed artifact names are **identical** to
before (diff the two `manifest.json` artifact maps); `bun test:e2e` green;
one `bun run shots` plate of an existing snapshot is pixel-identical or
visually indistinguishable.

## Phase 2 — Bakes read the canonical layout; Saxony + NRW adapters (M, 2–3 days)

1. Every `extract-*.sh`: drop `SUFFIX`, the `${E#33}` / `+2000` arithmetic
   and the `EPSG:25833` literals; take `eval "$(bun scripts/tile-info.ts "$TILE")"`
   and use `$EPSG`, `$XMIN`…; take the tile as a **required** argument
   (no Dresden default). Read inputs from `data/_raw/$SITE/<source>/…`
   with the canonical names:
   `dgm1/<tile>.tif`, `dom1/<tile>.tif`, `dop/<tile>.tif` (RGBI or RGB),
   `lod2/<tile>.city.json`, `dlm/` (AdV Shape layers), `osm/<extract>.osm.pbf`.
2. `scripts/ingest/sn.sh`: symlinks/moves today's Saxon downloads into the
   canonical layout (no resampling — Saxony's grid *is* ours).
3. `scripts/ingest/nw.sh` (NRW, EPSG:25832, 1 km downloads): for rasters
   `gdalbuildvrt` over the Land's tiles, then
   `gdalwarp -te $XMIN $YMIN $XMAX $YMAX -tr 1 1 -r bilinear` per our tile
   (DOP at its native 0.2 m); XYZ/ASCII inputs via `gdal_translate -a_srs`.
   LoD2: `citygml-tools to-cityjson`, then `cjio … merge` +
   `subset --bbox` per tile. DLM: link if AdV Shape, else Phase 3.
4. `bun run bake <tile>` (was Direction option 6): runs ingest → the seven
   bakes in dependency order (`extract-dlm` first), skips a bake whose
   inputs are absent with a one-line note, and writes
   `data/<site>/<tile>.provenance.json` (dataset, edition, download date,
   licence) that the HUD footer can read.
5. Add `sites/koeln.json` (or another NRW city the maintainer picks) with
   one primary tile and no neighbours; commit its derived artifacts only if
   the maintainer agrees (size check first, see STOP).

New offline tools: `citygml-tools` (Java) and `cjio` (Python). Document
them in `docs/data-pipeline.md`; they are bake-only, never shipped.

**Verify**: re-running the Dresden bakes through `ingest/sn.sh` produces
**byte-identical** `data/dlm/*`, `data/dop/*` (`git status` clean after the
re-bake); the NRW tile boots in `bun dev` with `SITE=koeln`; a `--headed`
shot from an oblique angle shows buildings on the ground, not floating or
sunk (DGM and LoD2 heights agree).

## Phase 3 — DLM class mapping as data; NAS input (S–M, 1–2 days)

1. Move the layer → class-id table out of `extract-dlm.sh:61–101` into
   `scripts/dlm-classes/adv-shape.tsv` (`layer  kind(area|buffer)  expr  class`),
   including the road-width `CASE` on `BRF`/`WDM`. Same for the rail layers
   `extract-rail.sh` reads (`ver03_l`, `ver03_f`, `ver06_f`, `ver06_l`).
2. `scripts/dlm-classes/nas.tsv` for Länder that ship only NAS/XML:
   `AX_Landwirtschaft→1`, `AX_Wald→2`, `AX_Gehoelz→3`,
   `AX_Wohnbauflaeche|AX_IndustrieUndGewerbeflaeche|…→4`, `AX_Bahnverkehr→5`,
   `AX_Weg→6`, `AX_Strassenverkehr|AX_Strassenachse→7`,
   `AX_Fliessgewaesser|AX_StehendesGewaesser|AX_Gewaesserachse→8`;
   the ingest adapter converts NAS with `ogr2ogr` (GDAL NAS driver) into a
   GPKG the bake reads. Confirm the width attributes' NAS names before
   relying on them.

**Verify**: Dresden `landcover_*.png` byte-identical after the refactor.

## Phase 4 — OSM as a same-shape land-cover source (M, 2–4 days)

Makes the Basis-DLM optional **without touching the runtime**: the file the
client requires is simply produced from another source.

1. `scripts/extract-landcover-osm.sh <tile>`: from the site's
   `.osm.pbf` (GDAL OSM driver, as `extract-walls.sh` already does) write the
   same `landcover_<tile>.png`, `landcover_rgb_<tile>.png` and legend JSON as
   `extract-dlm.sh`: `landuse=farmland|meadow|grass→1`, `landuse=forest|natural=wood→2`,
   `natural=scrub→3`, `landuse=residential|commercial|industrial|retail→4`,
   `landuse=railway→5`, `highway=footway|path|cycleway→6` (buffer 1 m),
   other `highway=*` → 7 (buffer by class, `width=` tag wins),
   `natural=water|waterway=riverbank→8`, `waterway=stream|river` buffered.
   Share the palette/splat step with `extract-dlm.sh` (extract it into one
   helper; don't copy the Pillow code).
2. `extract-rail.sh`: when no DLM, take tracks from `railway=rail` and
   bridge decks from `man_made=bridge` polygons (the deck-lift logic is
   unchanged; without DOM1 it falls back to the DGM ramp).
3. Veg rows for `extract-canopy.sh`'s gate: `natural=tree_row` /
   `barrier=hedge` from OSM when no DLM.
4. Site switch: `"landcover": "osm"` makes `bun run bake` call the OSM bake.

**Verify**: for the Dresden primary, bake OSM land cover to a scratch dir and
compare to the DLM raster: class agreement ≥ 80 % on road/water/forest
pixels (write the number into this plan); a `--headed` shot side by side
with the DLM version reads as the same place.

## Phase 5 — Optional inputs, a site check, docs (S–M, 1–2 days)

1. `extract-canopy.sh` without DOM1: warn and emit row-only trees at
   default heights (portability matrix row "DOM1 absent") instead of
   `exit 1`. `extract-rail.sh` without DOM1: warn and use the DGM ramp.
   `extract-ndvi.sh` / `extract-roof-colour.sh` without DOP: skip (the
   runtime already falls back).
2. `bun run site:check [SITE]`: per tile, which inputs exist, which
   artifacts will be baked, which fallback applies — run by `bun run bake`
   first and cheap enough for CI.
3. Docs: rewrite `docs/portability.md` to what is actually built (split
   "built" from "planned" fallbacks, add the Germany-wide checklist and a
   per-Land table: portal, CRS, download tile size, formats, licence);
   ADR "site config + own tile grid + ingest adapters"; update
   `docs/data-pipeline.md`, `docs/transformations.md` (OSM land-cover row),
   `docs/data-flow.md`, AGENTS.md "Where things live" / "Data pipeline",
   the city-walker skill's pipeline section, and the guide's data-sources
   page in **both** languages.
4. Tests: `site.test.ts` (validator), `tile.test.ts` (zone 32/33, 1/2 km),
   `features.test.ts` already checks every committed GeoJSON — make sure it
   iterates every site's tiles, not just Dresden's.

## STOP conditions

- Phase 1 or 3 changes any Dresden artifact hash, or a shot plate visibly
  changes — find out why before continuing.
- A second site's committed derived data would add more than ~40 MB to the
  repo (the DGM GeoTIFF alone is 13–15 MB per 2 km tile): ask the maintainer
  (ship one tile, or keep the second site uncommitted) — never switch on
  Git-LFS (AGENTS.md "ask before").
- A Land's licence requires terms the HUD footer can't carry (e.g. a
  non-derivative or non-commercial clause): stop for that Land.
- `citygml-tools` / `cjio` can't produce CityJSON the bake accepts (CRS
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
  here; note it in the site JSON as a future field if it matters.
