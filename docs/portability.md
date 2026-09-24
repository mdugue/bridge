# Portability — rendering any location, with whatever data it has

The goal is a viewer that works for **any city, village, or area** we can pull
structured geodata for — not just Dresden. Two locations rarely have the same
data: one has LoD2 + DOP, another only OSM footprints and a coarse DEM. This
page says **what is built today** for standing up another place, **what each
feature does when its input is missing**, and **what is still missing** — with
a checklist for a new site.

Design rule: **every feature has a graceful fallback, and no single optional
source is load-bearing.** Today that holds for the enhancers (DOP, the OSM
layers, partly DOM1); the core — LoD2 buildings, DGM1 terrain and the
Basis-DLM land cover — is still required. Closing that gap for Germany is
[plan 017](./plans/017-germany-wide-sites.md); the OSM-only case outside
Germany is an open direction in [plans/README.md](./plans/README.md)
(Direction, option 1).

## What is built

**One site config per build**
([ADR 0026](./adr/0026-one-site-config-per-build.md)). Everything about a
place that is not data lives in `sites/<id>.ts`, typed by
`lib/city/site.ts`: label and page title, the CRS (`epsg`: **25832 or
25833**, ETRS89 / UTM zone 32 or 33 — together every German Land), the
tile grid (`tileKm`, `tileSuffix`), the tile list (`{e, n}` km cells, the
first is the spawn tile), the curated viewpoints, the attribution lines for
the HUD footer, the sun's fallback position (`fallbackLatLng`) and the
ingest adapter. `SITE=<id>` picks one at build time (default `dresden`;
`sites/index.ts` is the registry); `next.config.ts` inlines it for the
client, and the bakes and the build step read the same registry. The
runtime and the bakes know no place names. One site per build keeps the
app a static bundle ([ADR 0001](./adr/0001-client-only-static-app.md)); a
multi-site deployment is several builds.

**Tile ids.** `tileIdOf` names a cell
`<UTM zone><e km>_<n km>_<tileKm><tileSuffix>` — the scheme Saxony's
downloads use; Dresden keeps `33412_5656_2_sn` through `tileSuffix: "_sn"`,
another site can leave the suffix empty. Every file under `data/` carries
the id. The extent comes from the cell and `tileKm`, never from parsing a
name.

**Any number of tiles.** The site streams as a 3D Tiles tileset
([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)): there is no fixed
block and no "primary" tile beyond where you spawn; collision, demolish and
picking work on every loaded tile.

**Land-neutral bakes, per-Land ingest adapters**
([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). The bakes in
`pipeline/bake/` take the tile's extent and CRS from the site and read one
canonical raw layout, `data/_raw/<site>/{dom1,dop,dlm,osm}` (see
[data-pipeline.md](./data-pipeline.md#the-canonical-raw-layout)). What is
provider-specific is an ingest adapter per Land,
`pipeline/bake/ingest_<id>.py`, that normalises the provider's downloads
into that layout. **Only Saxony's exists** (`ingest_sn.py`: GeoSN's
download-link service for DOM1 and DOP, the statewide Basis-DLM package,
the Geofabrik extract), and `Site.ingest` accepts only `"sn"`. The
Basis-DLM layer names the bakes read (`veg01_f`, `ver01_l`, `gew01_f`,
`ver03_f`, `ver06_f`, attributes `BRF`/`WDM`) are the AdV Shape profile,
not a Saxon invention; the layer → class table is data at the top of
`pipeline/bake/landcover.py`.

**One palette, painted at runtime**
([ADR 0023](./adr/0023-land-cover-colours-painted-at-runtime.md)). The
bakes write class ids only; the colours are `lib/city/landcover.ts`. A
per-site palette is a table away, not a re-bake. (The building tint still
defaults to Dresden's old-town terracotta, `lib/city/building-tint.ts`.)

## Degradation matrix

For each source: its role, what happens **today** when it is absent, and
the planned fallback. ✅ built · ❌ not built.

| Source | Role | If **absent**, today | Planned |
|---|---|---|---|
| **LoD2 CityJSON** (committed) | building geometry + attributes; roof-colour sampling | ❌ the build fails (`prepare-data: missing source file`) | LoD2 is near-nationwide in Germany, so no fallback is planned there; OSM footprints extruded by `building:levels`/`height` are an idea for outside Germany (Direction option 1), not a plan |
| **DGM1** (committed) | terrain; ground heights for the canopy and rail bakes | ❌ the build fails; the canopy and rail bakes need it | a flat plane at constant elevation — an idea (Direction option 1), no plan |
| **DOM1** | canopy heights (nDOM); bridge deck surface | ✅ the canopy step skips with a note and the build treats the canopy as optional (trees come from the hedge / tree rows only); ✅ rail decks fall back to the DGM abutment ramp (no viaduct lift) | row-only trees at default heights ([plan 017](./plans/017-germany-wide-sites.md), phase 5) |
| **Basis-DLM** | class raster (surface colours, water, the tree and lamp gates), hedge / tree rows, rail tracks + ballast, bridge decks | ❌ the land-cover step stops ("nothing rasterized"); the class raster and veg rows are `required` by the build. Rails, ballast and bridges come out empty | the **same class raster and legend from OSM** (`landuse`/`natural`/`highway`/`water`), tree rows from `natural=tree_row`/`barrier=hedge`, tracks from `railway=rail`, decks from `man_made=bridge` (plan 017, phase 4). NAS-only Länder: a NAS class table (phase 3) |
| **DOP** (RGB + NIR) | roof colour per building; NDVI (crown colour, meadow tint) | ✅ both steps skip; the runtime uses the synthesized roof palette and hash-only sage crowns (`ndvi` and the roof LUT are optional) | — |
| **OSM extract** (`.osm.pbf`) | retaining walls (+ terrain breaklines), street lamps, platforms, bridge structure (arches) | ✅ the lamps and walls steps skip with a note, and the rail step writes bridges without structure; none of them empties a file already there (platforms stay as committed). Lamps, walls and platforms are optional at runtime | — |

**Lower quality or different shape** is mostly untested:

- The canopy and rail bakes read DGM1 and DOM1 on the tile's **1 m grid**
  (`nDOM = DOM1 − DGM1` texel by texel), so a coarser DEM or a DOM on
  another grid needs resampling in the ingest adapter first. The terrain
  bake itself resamples any GeoTIFF to its 1024² / 512² grids.
- An **RGB-only DOP** (no NIR band) breaks the NDVI step, which reads band
  4; the roof colours only need bands 1–3.
- The raster edges are per tile, not per metre: a 4096² class raster and
  1024² terrain over a 2 km tile. `tileKm` other than 2 is typed but
  untried.
- **LoD1** buildings (boxes, no roof shape) have not been tried through the
  building bake.

## Porting checklist (new location)

1. **Write the site.** `sites/<id>.ts` with its CRS (25832 or 25833 — the
   `Site` type allows nothing else, and `lib/city/crs.ts` reprojects only
   those two for the sun), `tileKm`, `tileSuffix`, the tiles (spawn first),
   viewpoints, `fallbackLatLng` and the **attribution lines its licences
   require**; register it in `sites/index.ts`. The world frame
   (`x = epsgX − cx`, `z = −(epsgY − cy)`, `y = elevation`) is CRS-agnostic;
   the build takes `(cx, cy)` from the spawn tile's CityJSON.
2. **Commit the two sources the build reads.** Per tile, the DGM1 GeoTIFF
   as `data/dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif` (+ `.tfw` when it has no
   embedded georeferencing) and the LoD2 as
   `data/cityjson/lod2_<tile>.city.json`, CityGML converted to CityJSON
   with the EPSG code in `metadata.referenceSystem` (reproject with
   `cjio in.city.json reproject 25833 save out.city.json`). Check the size
   first: a DGM tile is 13–15 MB; more than ~40 MB for a new site is a
   maintainer decision, and Git-LFS is not an option.
3. **Fill the raw layout.** In Saxony, `SITE=<id> bun run bake --ingest`
   does it. Elsewhere, put the files into `data/_raw/<id>/` by hand —
   `dom1/<tile>.tif`, `dop/<tile>.tif` (4 bands), `dlm/*.shp` (AdV Shape
   profile), `osm/*.osm.pbf` (a Geofabrik extract covering the site) — or
   write `pipeline/bake/ingest_<land>.py` and add its id to `Site.ingest`.
4. **Bake.** `SITE=<id> bun run bake` (every tile, every step), or
   `--step <name>` per step when an input is missing (see the matrix). The
   land-cover step runs first; the canopy and lamps are gated on its class
   raster.
5. **Build and look.** `SITE=<id> bun dev`. `features.test.ts` and
   `tile.test.ts` check Dresden's committed files only; extending them to
   every site is plan 017, phase 5.
6. **Verify on a real GPU** with the snapshot harness (see the
   [city-walker skill](../.claude/skills/city-walker/SKILL.md)) from oblique
   angles: buildings on the ground, not floating or sunk (DGM and LoD2
   heights must agree).
7. **Record any new fallback** in the [degradation matrix](#degradation-matrix)
   and [transformations.md](./transformations.md), and the new source's
   edition in `data/provenance.json` and the guide's data-sources page (both
   languages).

## Still missing

In the order plan 017 takes them:

- **OSM land cover as a Basis-DLM substitute** (phase 4): a bake that writes
  the same class raster, legend and veg rows from the OSM extract, plus
  OSM tracks and bridge decks. With the colours painted at runtime, it only
  has to write class ids. Until then the Basis-DLM is mandatory.
- **NAS input** for Länder that publish the Basis-DLM only as NAS/XML
  (phase 3).
- **A second adapter** — NRW (EPSG:25832, 1 km downloads) is the plan's
  candidate (phase 2) — and a second site to prove the path.
- **The rest of phase 5**: an RGB-only DOP for the NDVI step, a `site:check` that reports per tile which inputs exist and which
  fallback applies, and tests over every site.
- **Outside Germany** — OSM buildings, a flat or public-DEM terrain, and a
  CRS other than ETRS89 / UTM 32/33 — is not planned beyond the Direction
  option in [plans/README.md](./plans/README.md).

## Fetching source data (Saxony)

All from the **[Saxon open-geodata portal](https://www.geodaten.sachsen.de/)**
of GeoSN (free; *Datenlizenz Deutschland – Namensnennung – Version 2.0*,
`dl-de/by-2-0`, credit "Quelle: GeoSN, dl-de/by-2-0" — see the guide's
[licence table](./guide/en/data-sources.md#licences-and-credits)), plus
OpenStreetMap (ODbL). Raw downloads stay in `data/_raw/<site>/`
(gitignored, **never committed** — no Git-LFS); only small derived per-tile
artifacts under `data/` are committed, plus the DGM1 GeoTIFF and the
CityJSON the build reads. What each dataset is good and bad at, and the
editions currently in use, are in the guide's
[Where the data comes from](./guide/en/data-sources.md); how the ingest
adapter finds the downloads is in
[data-pipeline.md](./data-pipeline.md#provenance).

| Source | Where | How it gets here |
|---|---|---|
| DGM1 (GeoTIFF, 2 km tiles) | [Downloadbereich Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html) | by hand, committed under `data/dgm/` |
| 3D-Stadtmodell LoD2 (CityGML, 2 km tiles) | [Downloadbereich Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html) | by hand, converted to CityJSON, committed under `data/cityjson/` |
| DOM1 (GeoTIFF, 2 km tiles) | same page as DGM1 | `bun run bake --ingest` → `dom1/<tile>.tif` |
| **DOP** orthophoto, **4-channel (RGB + infrared)** | [DOP-Downloadbereich](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html) | `bun run bake --ingest` → `dop/<tile>.tif` |
| Basis-DLM (ATKIS, statewide Shape package) | [Downloadbereich Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html) | `bun run bake --ingest` → `dlm/*.shp` |
| OpenStreetMap (walls, lamps, platforms, bridge structure) | Geofabrik's Sachsen extract from [download.geofabrik.de](https://download.geofabrik.de) (~250 MB) | `bun run bake --ingest` → `osm/sachsen-latest.osm.pbf` |

For a **non-Saxon** location in Germany, the equivalent Land portal takes
the place of GeoSN, and an ingest adapter (or a hand-filled raw layout)
takes the place of `ingest_sn.py`; the bakes and the runtime stay as they
are once the raw layout and the committed sources have the expected shape.
