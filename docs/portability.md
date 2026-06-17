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
| **DOM1** | canopy heights (nDOM) | trees from row data only, at **default heights**; no canopy fill | coarser nDOM: blockier canopy placement | point-cloud per-tree height (see below) |
| **Basis-DLM** | surface colours + veg rows + water mask + tree gate | single flat ground colour; **OSM `landuse`/`natural`/`water`** polygons substitute for surfaces, water, and forest; no road gate → gate trees on OSM roads | regional DLM variant: remap class ids in `extract-dlm.sh` palette | — |
| **OSM** | street lamps (+ universal fallback for footprints/water/landuse) | no lamps; the other fallbacks above go away too | — | denser tags → richer POI/lamps |
| **DOP** (planned) | preferred roof colour + NDVI veg | synthesized roof palette + uniform-green veg (current behaviour) | RGB-only (no NIR): roof colour yes, NDVI no | true-ortho: no building lean → cleaner roof sampling |

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
   bash scripts/extract-dlm.sh <tile>        # surfaces + veg rows (Basis-DLM)
   bash scripts/extract-canopy.sh <tile>     # canopy (needs DLM class raster + DOM1/DGM1)
   bash scripts/extract-lamps.sh <tile>      # lamps (OSM)
   bash scripts/extract-roof-colour.sh <tile> # roof colour LUT (DOP) — experimental
   bun scripts/prepare-data.ts               # copy derived artifacts → public/data
   ```
5. **List the tiles** in `scripts/prepare-data.ts` (`TILES`) and the loader's tile
   block.
6. **Verify on a real GPU** with the snapshot harness (see the skill's QA section)
   from oblique angles.
7. **Record any new fallback** you had to add in the
   [degradation matrix](#degradation-matrix) and
   [transformations.md](./transformations.md).

## Fetching source data

All from the **[Saxon open-geodata portal](https://www.geodaten.sachsen.de/)**
(*Offene Geodaten*, free; mostly *Datenlizenz Deutschland – Zero*). Raw downloads
stay in `data/_raw/` (gitignored, **never committed** — no Git-LFS); only small
derived per-tile artifacts under `data/` are committed.

| Source | Where |
|---|---|
| CityJSON LoD2, DGM1, DOM1 | [Höhen- & 3D-Stadtmodelle](https://www.geodaten.sachsen.de/digitale-hoehenmodelle-3994.html) |
| Basis-DLM (ATKIS) | portal → Landschaftsmodelle |
| **DOP** orthophoto (RGB + NIR) | [DOP-Downloadbereich](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html) — 2 km tiles, GeoTIFF + `.tfw`; pick the **4-channel (RGB+Infrarot)** variant for NDVI. Drop into `data/_raw/dop/dop_<tile>.tif`. |
| Laser-scan point cloud | portal → Laserscandaten (LAS/LAZ; large) |
| Street lamps | OpenStreetMap (Overpass) — ODbL |

For a **non-Saxon** location, substitute the equivalent national/state portal (or
OSM + a public DEM) and remap class ids / attribute keys in the bake scripts; the
runtime is data-source-agnostic once the derived artifacts match the expected
shape.
