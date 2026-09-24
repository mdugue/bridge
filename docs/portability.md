# Portability — rendering any location, with whatever data it has

The goal is a viewer that works for **any city, village, or area** we can pull
structured geodata for — not just Dresden. Two locations rarely have the same
data: one has LoD2 + DOP, another only OSM footprints and an SRTM DEM. This page
defines **what each feature degrades to when its best input is missing**, and a
**checklist for standing up a new location**.

Design rule: **every feature has a graceful fallback, and no single optional
source is load-bearing.** The only hard requirements are a footprint source for
buildings and *some* elevation (even a flat plane). Everything else degrades.

## Degradation matrix

For each source: its role, and what the dependent feature does when the source is
**absent**, **lower quality**, or **richer** than Dresden's.

| Source | Role | If **absent** | If **lower quality** | If **richer** |
|---|---|---|---|---|
| **CityJSON LoD2** | building geometry + attrs | fall back to **OSM building footprints** extruded by `building:levels`/height tag → flat-roof boxes | **LoD1** (boxes, no roof shape): roof colour → flat-roof slate; eave = box top; storey bands still work from height | **LoD3 / textured**: could use real roof geometry + textures |
| **DGM1** | terrain + ground-clamp | **flat plane** at a constant elevation; everything clamps to y=0 | coarser DEM (e.g. 10–30 m SRTM): smoother terrain, same pipeline | finer/derived (breaklines): sharper riverbanks |
| **DOM1** | canopy heights (nDOM) + **bridge deck surface** | trees from row data only, at **default heights**; bridge decks fall back to the DGM abutment ramp (no viaduct lift) | coarser nDOM: blockier canopy placement | point-cloud per-tree height (see below) |
| **Basis-DLM** | surface colours + veg rows + water mask + tree gate + **rail tracks (ver03_l) + ballast yards (ver03_f) + bridge decks (ver06_f)** | single flat ground colour; **OSM `landuse`/`natural`/`water`** for surfaces; **OSM `railway=rail` + `man_made=bridge`/`bridge=yes`** for tracks/bridges (the bake keeps buffered `ver06_l` centrelines as the no-`ver06_f` deck fallback); no road gate → gate trees on OSM roads | regional DLM variant: remap class ids in `extract-dlm.sh` palette | OSM `bridge:structure` adds arches |
| **OSM** | street lamps + **station platforms** (+ universal fallback for footprints/water/landuse + rails/bridges) | no lamps/platforms; the other fallbacks above go away too | — | denser tags → richer POI/lamps/platforms |
| **Laser scan (LAZ)** | hedge heights and trees outside the canopy mask | **OSM only**: mapped hedges at their `height` tag (or 1.5 m); no extra trees | sparser points (< 4 /m²): the 0.5 m rasters get holes — bin at 1 m and raise `MIN_AREA_M2` | classified low vegetation (ASPRS 3/4) would replace the NDVI + intensity cue outright |
| **DOP** | roof colour (`roofcolor_<tile>.json`) + NDVI crowns (`ndvi_<tile>.png`) | synthesized roof palette + hash-only sage crowns (both fall back automatically) | RGB-only (no NIR): roof colour yes, NDVI no | true-ortho: no building lean → cleaner roof sampling |

**Reading the matrix when porting:** start from the cheapest universal source
(**OSM** is near-global) and treat the German-specific layers (CityJSON LoD2,
Basis-DLM, DGM1/DOM1, DOP) as **progressive enhancement**. A location with only
OSM + a public DEM should still render a recognizable, stylized scene; each extra
source upgrades a feature listed above.

## Porting checklist (new location)

1. **Pick the CRS & recenter offset.** Source data may be EPSG:25833 (Saxony) or
   another UTM zone. The world frame math (`world.x = epsgX − cx`,
   `world.z = −(epsgY − cy)`, `world.y = elevation`) is CRS-agnostic; just capture
   `(cx, cy)` from the primary tile. Keep all sources in **one** projected CRS.
2. **Choose tiles.** Note the tile id scheme and the primary + neighbour block (we
   use a 2×2 around `33412_5656_2_sn`).
3. **Fetch sources** into `data/_raw/` (gitignored) — see below.
4. **Run the bakes** for whatever sources exist; skip the rest (the loaders treat
   missing optional artifacts as "feature off"):
   ```bash
   bash scripts/extract-dlm.sh <tile>         # surfaces + veg rows + class raster (Basis-DLM)
   bash scripts/extract-canopy.sh <tile>      # canopy (needs the class raster; DOM1 + DGM1)
   bash scripts/extract-ndvi.sh <tile>        # NDVI raster: crown colour + meadow tint (DOP)
   bash scripts/extract-roof-colour.sh <tile> # roof colour LUT (DOP + CityJSON)
   bash scripts/extract-lamps.sh <tile>       # lamps (OSM Overpass; needs the class raster)
   bash scripts/extract-walls.sh <tile>       # retaining walls (local OSM .osm.pbf)
   bash scripts/extract-rail.sh <tile>        # rails, ballast, bridges (Basis-DLM + DOM1/DGM1), platforms (Overpass)
   bun scripts/prepare-data.ts                # bake + publish → public/data
   ```
   The same list with one-line dependencies lives in the
   [city-walker skill](../.claude/skills/city-walker/SKILL.md#data-pipeline).
5. **List the tiles** in `lib/city/tile.ts` (`TILE_BLOCK`); new per-tile
   artifacts go into `tileArtifacts()` in the same file — `prepare-data.ts`
   and the client both read it.
6. **Verify on a real GPU** with the snapshot harness (see the skill's QA section)
   from oblique angles.
7. **Record any new fallback** you had to add in the
   [degradation matrix](#degradation-matrix) and
   [transformations.md](./transformations.md).

## Fetching source data

All from the **[Saxon open-geodata portal](https://www.geodaten.sachsen.de/)**
of GeoSN (free; *Datenlizenz Deutschland – Namensnennung – Version 2.0*,
`dl-de/by-2-0`, credit "Quelle: GeoSN, dl-de/by-2-0" — see the guide's
[licence table](./guide/en/data-sources.md#licences-and-credits)). Raw
downloads stay in `data/_raw/` (gitignored, **never committed** — no Git-LFS);
only small derived per-tile artifacts under `data/` are committed, plus the
DGM1 GeoTIFF the build reads. What each dataset is good and bad at, and the
editions currently in use, are in the guide's
[Where the data comes from](./guide/en/data-sources.md).

| Source | Where |
|---|---|
| DGM1, DOM1 (GeoTIFF, 2 km tiles), laser scan (LAZ) | [Downloadbereich Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html) |
| 3D-Stadtmodell LoD2 (CityGML, 2 km tiles; convert to CityJSON before committing) | [Downloadbereich Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html) |
| Basis-DLM (ATKIS, statewide Shape package) | [Downloadbereich Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html) |
| **DOP** orthophoto (RGB + NIR) | [DOP-Downloadbereich](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html) — 2 km tiles, GeoTIFF + `.tfw`; pick the **4-channel (RGB+Infrarot)** variant for NDVI. Unpack as downloaded into `data/_raw/DOP_RGBI/dop20rgbi_<tile>_2_sn_tiff/` — `extract-ndvi.sh` and `extract-roof-colour.sh` read `dop20rgbi_<tile>_2_sn.tif` from there. |
| Street lamps, station platforms | OpenStreetMap via Overpass (`extract-lamps.sh`, `extract-rail.sh`) — ODbL |
| OSM walls, platforms, bridge structure | Geofabrik regional extract (`.osm.pbf`, e.g. Sachsen ~250 MB) from [download.geofabrik.de](https://download.geofabrik.de) into `data/_raw/osm/`; `extract-walls.sh` reads it via GDAL's OSM driver (override with `WALLS_PBF=`); `extract-lamps.sh`/`extract-rail.sh` platforms and `bridge:structure` use Overpass — ODbL |

For a **non-Saxon** location, substitute the equivalent national/state portal (or
OSM + a public DEM) and remap class ids / attribute keys in the bake scripts; the
runtime is data-source-agnostic once the derived artifacts match the expected
shape.
