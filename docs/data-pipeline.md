# Data pipeline — the bakes, the build step and the artifact contracts

The developer reference for everything between a provider download and the
files the browser requests. For the plain-language version read the guide
[From download to browser](./guide/en/data-journey.md); for *what maps to
what* see [data-flow.md](./data-flow.md); for standing up another location
see [portability.md](./portability.md).

```mermaid
flowchart LR
  PROV["provider downloads<br/>GeoSN · Geofabrik"] -->|"bun run bake --ingest<br/>ingest adapter, per Land"| RAW["data/_raw/dresden/<br/>(gitignored)"]
  RAW -->|"bun run bake<br/>pipeline/bake (Python, uv)"| DER["data/dlm · data/dop<br/>committed derivatives"]
  COM["data/dgm · data/cityjson<br/>(committed sources)"] --> DER
  COM --> PUB
  DER -->|"scripts/prepare-data.ts<br/>bun dev · bun build"| PUB["public/data/<br/>3D Tiles tileset + manifest.json"]
  PUB -->|"3DTilesRendererJS<br/>tile-stream.ts"| APP["app/_components/*<br/>dressing"]
```

Two stages, one language each ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)):
**Python** turns provider downloads into the small per-tile files committed
under `data/`, and runs by hand; **TypeScript** turns `data/` into the
tileset the browser streams, and runs on every `bun dev` / `bun build`.

## Sites and tiles

Everything about a place that is not data lives in one site config
([ADR 0026](./adr/0026-one-site-config-per-build.md)): `sites/<id>.ts`,
typed by `lib/city/site.ts`, picked at build time by `SITE=<id>` (default
`dresden`; the registry is `sites/index.ts`, and `next.config.ts` inlines
the id for the client as `NEXT_PUBLIC_SITE`). The bakes and the build step
read the same registry, so the HUD and the data always describe one place.

A site lists its tiles as `{e, n}` cells — the south-west corner in km of
the site's grid (`tileKm`) in its CRS (`epsg`, 25832 or 25833). The **first
tile is the spawn tile**; the order of the rest does not matter.
`tileIdOf` names a cell `<UTM zone><e>_<n>_<tileKm><tileSuffix>`, the
scheme Saxony's downloads use, and every file name under `data/` carries
that id; `tileExtentOf` gives its extent. Dresden:

```
        N
  ┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
  │ 33410_5658_2_sn │ 33412_5658_2_sn │ 33414_5658_2_sn │ 33416_5658_2_sn │
  │ Innere Neustadt │ Äußere Neustadt │ Waldschlößchen- │ Dresdner Heide, │
  │                 │                 │ brücke          │ Loschwitz slope │
  ├─────────────────┼─────────────────┼─────────────────┼─────────────────┤
  │ 33410_5656_2_sn │ 33412_5656_2_sn │ 33414_5656_2_sn │ 33416_5656_2_sn │
  │ Altstadt        │ Johannstadt ★   │ Elbwiesen,      │ Blaues Wunder,  │
  │                 │                 │ Elbschlösser    │ Loschwitz       │
  ├─────────────────┼─────────────────┼─────────────────┼─────────────────┤
  │ 33410_5654_2_sn │ 33412_5654_2_sn │ 33414_5654_2_sn │ 33416_5654_2_sn │
  │ Hauptbahnhof    │ Großer Garten   │ Striesen        │ Blasewitz       │
  └─────────────────┴─────────────────┴─────────────────┴─────────────────┘
                                                                          E
  ★ spawn tile (sites/dresden.ts, first in the list)
```

The spawn tile spans 412 000–414 000 E / 5 656 000–5 658 000 N
(EPSG:25833) — roughly 51.049–51.067° N, 13.745–13.773° E; the site as a
whole covers 410 000–418 000 E / 5 654 000–5 660 000 N, a 4×3 block of twelve
tiles. No
tile has a role beyond "where you start": which tile is detailed is decided
by camera distance at runtime
([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)), and collision,
demolish and picking work on every loaded tile.

## Stage 1 — the bakes (`pipeline/`, `bun run bake`)

`pipeline/` is a [uv](https://docs.astral.sh/uv/) project:
`pipeline/pyproject.toml` pins numpy, rasterio, pyogrio, shapely, pyproj
and Pillow exactly (Python 3.12–3.13), `pipeline/uv.lock` locks the rest.
GDAL comes inside the rasterio and pyogrio wheels, with the OSM driver —
there is no system GDAL, no `gdal_calc.py` and no bash. `uv` on `PATH` is
the whole setup; `uv run` creates the environment on first use.

```bash
bun run bake                        # every tile of the site, every step
bun run bake 33412_5656_2_sn        # one tile
bun run bake --ingest               # fetch the raw inputs first (ingest adapter)
bun run bake --step canopy          # one step: landcover, canopy, ndvi,
                                    #   roof-colour, lamps, monuments,
                                    #   furniture, walls, stairs, rail,
                                    #   surface, edges, islands (OSM
                                    #   squares into the class raster, no
                                    #   raw DLM needed)
bun run test:pipeline               # pytest + ruff check + ruff format --check
```

`scripts/bake.ts` reads the site and, per tile, runs
`uv run --project pipeline python -m bake <step> --tile … --bounds … --epsg
… --raw data/_raw/<site> --data data` — the extent and CRS come from the
site, never from the tile name. With `--ingest` it first runs the site's
adapter, `python -m bake.ingest_<site.ingest>`. The modules in
`pipeline/bake/`:

| Module | Role |
|---|---|
| `__main__.py` | the step table and CLI; `all` runs the steps in dependency order |
| `common.py` | `Tile` (id, extent, CRS, raw and data folders), reading vector layers without geopandas, the GeoJSON writer |
| `osm.py` | reads the site's `.osm.pbf` through GDAL's OSM driver, with a margin in degrees around the tile, reprojected to the tile's CRS |
| `landcover.py`, `canopy.py`, `ndvi.py`, `roof_colour.py`, `lamps.py`, `monuments.py`, `furniture.py`, `walls.py`, `stairs.py`, `rail.py`, `surface.py`, `edges.py` | one step each (table below) |
| `ingest_sn.py` | the Saxony ingest adapter |

`pipeline/tests/test_bakes.py` covers the pure helpers (line merging, deck
outlines, wall heights, coordinate rounding, the class ids the client's
palette is keyed by, the monument kinds, the DLM ↔ OSM fountain
conflation and the relief measurement), and runs the `walls` and `stairs`
steps end to end against a synthetic DGM and a small OSM XML file (GDAL's
OSM driver reads `.osm` as well as `.osm.pbf`). CI's `pipeline` job runs it with ruff after
`uv sync --locked`. The bakes themselves need the raw downloads and run on
the maintainer's machine.

### The canonical raw layout

The bakes know no provider. They read one layout, which an ingest adapter
writes (gitignored, never committed — no Git-LFS):

```
data/_raw/<site>/
  dom1/<tile>.tif (+ .tfw)   DOM1 surface model, 1 m
  dop/<tile>.tif             orthophoto, 4 bands (R, G, B, NIR)
  dlm/*.shp                  Basis-DLM, AdV Shape profile (veg01_f, ver01_l, …)
  osm/*.osm.pbf              OpenStreetMap extract (the newest is read)
  downloads/                 the adapter's cache of provider ZIPs
```

The DGM1 GeoTIFF (`data/dgm/dgm1_<tile>_tiff/`) and the LoD2 CityJSON
(`data/cityjson/lod2_<tile>.city.json`) are **not** raw: they stay
committed ([ADR 0004](./adr/0004-commit-derived-artifacts-not-raw-data.md)),
because the build step reads them on every build. The bakes read them from
there too.

### The Saxony ingest adapter (`ingest_sn.py`)

`bun run bake --ingest` fills the layout from GeoSN and Geofabrik and never
downloads a file twice (the ZIPs stay in `downloads/`):

- **DOM1 and DOP RGBI, per tile:** the portal's own download-link service
  (layers 4 and 17, see [Provenance](#provenance)) is queried with a point
  inside the tile; the ZIP it names is fetched and its `.tif` / `.tfw`
  unpacked as `dom1/<tile>.tif` and `dop/<tile>.tif`.
- **Basis-DLM:** the statewide Shape package (one ZIP of ZIPs, ~1.2 GB),
  unpacked flat into `dlm/`.
- **OpenStreetMap:** Geofabrik's `sachsen-latest.osm.pbf` into `osm/`
  (from the Claude Code cloud container Geofabrik resets the connection;
  there, BBBike's city extract
  `https://download.bbbike.org/osm/bbbike/Dresden/Dresden.osm.pbf` does the
  same job — the bakes read the newest `.osm.pbf` under `osm/`). If
  the download fails the adapter says so and carries on; put any
  `.osm.pbf` covering the site there by hand.

Skipped inputs are skipped by *presence*: an existing `dom1/<tile>.tif` or
any `dlm/*.shp` is not fetched again. Delete it to refresh.

**Every OSM input comes from that local extract** (ADR 0025 tightening
[ADR 0012](./adr/0012-openstreetmap-for-what-official-data-lacks.md)):
walls, lamps, fountains, street furniture, platforms and the bridge structure. There are no Overpass
queries any more — a re-bake is reproducible from the recorded extract. The
*committed* lamp, platform and bridge-structure data still comes from the
old Overpass bakes; the next re-bake moves it (see
[Provenance](#provenance)).

### The steps

Each step writes into `data/` in the site's CRS (2 decimals for lines and
polygons, 1 for points) with a named-CRS member; the loaders never
reproject. Order matters where noted: `landcover` writes the class raster
that `canopy`, `lamps` and `furniture` gate on.

| Step | Reads | Writes (`data/…`) | Notes |
|---|---|---|---|
| `landcover` | `dlm/*.shp`; the OSM extract, when there, for the islands | `dlm/landcover_<t>.png` (class ids 0–8, one byte, 4096² over the tile), `dlm/landcover_<t>.json` (tile, CRS, bounds, size, legend), `dlm/vegrows_<t>.geojson` (`kind`: hedge / treerow) | Class ids only — the colours are painted in the browser ([ADR 0023](./adr/0023-land-cover-colours-painted-at-runtime.md)). The layer → class table is data at the top of the module (`CLASSES`, `burn_order`, `ROAD_HALF_WIDTH`). Classes burn lowest priority first, so water (8) wins. Roads are centrelines buffered by the surveyed width `BRF`, else by class `WDM`. Then the OSM islands (see `islands`) are carved out of the road class. Fails if nothing rasterised |
| `canopy` | DOM1, the committed DGM1, `veg02_f`/`veg03_f`/park areas, the class raster | `dlm/canopy_<t>.geojson` (points with `h`) | `nDOM = DOM1 − DGM1` in numpy. One tree per 7 m cell at the tallest texel between 3 and 45 m, only inside forest, copse or park, never on classes 5–8 (rail, path, road, water) — the gate that stopped trees growing through bridge decks. **No DOM1: skipped with a note** |
| `ndvi` | DOP bands 1 (red) and 4 (NIR) | `dlm/ndvi_<t>.png` (one byte, 1024², `max(NDVI, 0)·255`) | Reads the whole DOP resampled to 1024², so it assumes the DOP covers the tile exactly. **No DOP: skipped** |
| `roof-colour` | DOP bands 1–3, the committed CityJSON | `dop/roofcolor_<t>.json` (`meta` + `roofs: {id: [r,g,b]}`, linear RGB) | Per building: rasterise the RoofSurface rings, erode 5 px inward (the orthophoto leans buildings), take the per-channel median of ≥ 12 texels. Keyed by CityObject id. **No DOP or CityJSON: skipped** |
| `lamps` | OSM `highway=street_lamp`, the class raster | `dlm/lamps_<t>.geojson` (points, `h` = 5 m) | Only the lamps the tile owns (west and south edges in, east and north out), so a seam lamp stands once when both tiles are dressed; the viewer applies the same rule (`ownsPoint`) to older files. Lamps over railway (5) or water (8) are dropped. No `.osm.pbf`: skipped with a note, the file already there stays |
| `monuments` | Basis-DLM `sie03_p` (`OBJART=51009`, `BWF` 1750 Denkmal · 1770 Säule/Stein · 1780 Brunnen, with `NAM`); OSM `amenity=fountain` (points + basin outlines); DOM1 + the committed DGM1 | `dlm/monuments_<t>.geojson` (`kind`: fountain / statue / stone / column; `name`, `source`; fountains `style`: basin / pool / splash, `figure`; `relief`: `west`, `north`, `cols`, `rows`, `dm` — the measured body, heights above ground in dm on the 1 m grid) | The DLM is the official list and names; it does not say which monument is a fountain nor how big a basin is. A DLM point within 6 m of (or inside) an OSM fountain *is* that fountain — it keeps the DLM name (Albertplatz: "Stilles Wasser", "Stürmische Wogen"); a DLM name with *…brunnen*/*Tränke* is a fountain without a partner; every other OSM fountain is added (`source: osm`). An outline becomes a Polygon ring: the rim, its hole the water (inset 0.35 m); outlines under 1 m² become points. `relief`: for each monument and each fountain a DLM monument stands in, the nDOM patch above 0.7 m — inside the basin's water, or grown from the tallest cell within 2.5 m of the point — kept only when it ends within 6 m, stays ≤ 60 cells and below 8.5 m and touches nothing taller (a tree crown or a facade); 27 of 174 pass. Only what the tile owns (representative point). **No Basis-DLM: skipped, the file already there stays. No `.osm.pbf`: DLM monuments only. No DOM1: no reliefs (markers)** |
| `furniture` | OSM `leisure=playground` areas and `playground=*` equipment (points, ways, areas); OSM points `amenity=bench/waste_basket/bicycle_parking/post_box/shelter`, `leisure=picnic_table`, `barrier=bollard`, `highway=bus_stop` / `public_transport=platform` with `shelter=yes`; bench ways; every `highway` line; the class raster, the tile's `bridge` file | `dlm/furniture_<t>.geojson` (points with `k`: bench / picnic / bin / bike / bollard / postbox / shelter; `a` the bearing it faces, degrees from north; `l` a bench way's length; `back: false`; `n` a stand's hoops; `h`, `metal` a bollard's tagged height and material; Polygons `k: playground` and sandpit areas; equipment points `k`: swing / slide / sandpit / climb / springy / seesaw / roundabout / playhouse) | `a`: OSM `direction` on a bench (degrees or a compass point), else towards the nearest highway line within 25 m, across it when the object stands on it (< 0.5 m); a bench way stands at its midpoint facing the path side, length clamped 1–8 m. `n` = ⌈`capacity` ÷ 2⌉, 1–12. Dropped: `bicycle_parking=wall_loops`, `amenity=shelter` other than public transport, stops without `shelter=yes`, `indoor=yes`, `location=indoor/underground`, `level` < 0, classes 5 and 8, inside a bridge deck; a shelter within 8 m of another. Playgrounds under 20 m² and equipment kinds without a model (mounds, table football, …) are left out; nothing is added to a playground OSM maps empty. Only what the tile owns. No `.osm.pbf`: skipped with a note, the file already there stays |
| `walls` | OSM `barrier=retaining_wall/city_wall/wall`, `man_made=embankment`, `natural=cliff` | `dlm/walls_<t>.geojson` (lines with `kind`, `h`; a terrain bake input, not served) | Both the `lines` and `multipolygons` layers — GDAL routes closed ways with an area key into the latter; polygons contribute their outer ring. Heights from `height`/`est_height`, clamped 0.5–30 m, else per kind (city_wall 6, retaining_wall 3, wall 1.5, embankment 2.5, cliff 3). Clipped to the tile. No `.osm.pbf`: skipped with a note, the file already there stays |
| `stairs` | OSM `highway=steps` (+ `area:highway=steps` outlines, `barrier=wall/retaining_wall/city_wall`, areas on `layer` ≥ 1), the committed DGM1 | `dlm/stairs_<t>.geojson` (lines bottom → top with `w`, `n`, `z` = [bottom, top] landing heights), `dlm/terraces_<t>.geojson` (polygons with a level `z`) — both terrain bake inputs, not served | Landings: the DGM 1 m beyond each end, 3×3 m median. Width: `width`, else outline area ÷ axis length, else the gap between the walls either side (within 15 m, minus 0.3 m each side, the axis re-centred) when both edges of that gap climb ≥ half the axis's rise, else 2.5 m (0.8–30 m). A flight with less than half its tagged rise in the DGM (`step_count` × `step:height`, 15 cm untagged), an `incline` and its top ≤ 3 m from a raised area (no building, `man_made`, `landuse`, bridge, railway or public-transport area) takes the tagged rise from its lower landing; the area becomes a terrace at the highest such top (its outer rings, holes filled). Steps: `step_count` if its riser is 8–25 cm, else rise ÷ 16 cm. Left out: indoor, underground, `level` < 0, tunnel, bridge, rise < 30 cm. Unclipped (the viewer stands a flight on the tile that owns its middle). No `.osm.pbf`: skipped with a note, the file already there stays |
| `rail` | `ver03_f`, `ver03_l`, `ver06_f`, `ver06_l`, `ver01_l`, `ver02_l`; DGM1 + DOM1; OSM `man_made=bridge`, `railway=platform` | `dlm/railarea_<t>.geojson` (ballast polygons), `dlm/rail_<t>.geojson` (lines with `tracks`, `electrified`), `dlm/bridge_<t>.geojson` (polygons with per-vertex `deck`, `kind`, `name`, `structure`), `dlm/platform_<t>.geojson` | Ballast: `OBJART=42010` made valid, unioned (shapely) and clipped. Rails: heavy rail only (`SPW=1000`, trams excluded), fragments merged at 1 m. Decks: every `ver06_l` centreline (`BWF=1800`), snapped to a `ver06_f` footprint ≤ 50 m away, else buffered by kind width; deck height = the DGM abutment ramp lifted to the DOM surface, plus camber; `kind` from the rail/road/path networks under it; `structure` (arches) from the nearest OSM bridge ≤ 60 m. **No Basis-DLM: the step is skipped, the files already there stay. No DOM1: decks use the DGM ramp. No `.osm.pbf`: bridges without structure, the platform file already there stays.** Every other output is written, even when empty |

| `islands` | the committed class raster; OSM pedestrian / island / fountain areas, parks and lawns | the class raster in place (+ the legend's `attribution`) | The same `carve_islands` the `landcover` step runs when an extract is there: road texels (7) under OSM pedestrian areas, `area:highway` footway/pedestrian/traffic-island and fountain basins become 4, under parks and lawns 1 (lawn over walk). Idempotent; for sites whose raw DLM is not at hand |
| `edges` | the committed class raster; the NDVI and paving rasters when present | `dlm/edges_<t>.png` (8-bit greyscale 4096 × 2048 = two bytes per texel of a 2048² raster, interleaved: R, G = 128 + 20 · the signed distance (m) to the road edge / the meadow edge, positive inside, ±6.35 m), `dlm/edges_<t>.json` (legend, `scale`), `dlm/kerbs_<t>.geojson` (lines, the road on their left; a terrain bake input, not served) | Distance by growing the mask ring by ring (octagonal metric), three 3×3 box passes, averaged 4096 → 2048. The meadow mask counts urban green: NDVI (upsampled, blurred) > 0.3 on classes 0/4, not paved per the OSM raster. Kerb lines: marching squares on the road field's 0 level, segments beside water or railway dropped, merged, simplified 0.15 m, shorter than 3 m dropped. Runs after `surface`; needs no raw data |
| `surface` | OSM `highway=*` lines (`surface`, `width`, `footway=sidewalk`, `sidewalk:*:surface`, `footway:surface`, `parking:{left,right,both}` + `:orientation`, `service=parking_aisle`) and `highway` / `area:highway` / `amenity=parking` / `amenity=parking_space` multipolygons | `dlm/surface_<t>.png` (8-bit greyscale 4096 × 2048 = two bytes per texel of a 2048² raster, interleaved: R = park · 64 + walk · 8 + road, G = the way direction, 1 + bearing mod 180° over 0–254, 0 = unknown; greyscale because the viewer decodes data PNGs itself, `lib/city/png-raster.ts`), `dlm/surface_<t>.json` (tile, CRS, bounds, size, encoding, the surface and parking ids, attribution) | Two materials per texel because an OSM road buffer (half-width per `highway` class, else `width`) reaches past the DLM's carriageway: the viewer reads `road` on class 7 and `walk` elsewhere. Roads burn least important first (a primary wins its junctions); walks burn parking and pedestrian areas, then the roads' sidewalk bands (kerb to +3 m on the tagged side), then the ways. Direction: the car parks' long axes first, then every way's segments — the road's reach with its pavement (an aisle's reach covers its bays, 5.5 m), then walkways, then the carriageways (a crossing does not turn the road). Parking: car parks on the ground (not underground, multi-storey, rooftop, garages) = 3 and asphalt when they carry no `surface`, the road half on each tagged side = 1 (parallel) or 2 (perpendicular/diagonal), then the aisles cleared. Surface values → ids in `SURFACE_OF`. No `.osm.pbf`: skipped with a note, the file already there stays |

The OSM-derived files (`lamps`, `furniture`, `walls`, `stairs`, `bridge`, `platform`) carry
`"attribution": "© OpenStreetMap contributors (ODbL)"` as a foreign member;
`monuments` carries both credits (`Quelle: GeoSN, dl-de/by-2-0; © OpenStreetMap
contributors (ODbL)`), and the paving raster carries the OSM credit in its
legend JSON.
(The committed platform files predate that and carry none; the HUD footer
has the credit either way.)

### The land-cover legend

The ids are the bake's; the colours are `lib/city/landcover.ts`, the one
palette the terrain, the minimap and the `/wissen` picture paint with.
Changing a colour is a look change, not a re-bake.

| id | class | Basis-DLM source | palette (sRGB) |
|---|---|---|---|
| 0 | background | — | 230 224 209 |
| 1 | farmland / meadow | `veg01_f` | 197 211 170 |
| 2 | forest | `veg02_f` | 150 176 138 |
| 3 | copse | `veg03_f` | 175 195 158 |
| 4 | built-up | `sie02_f` | 228 219 203 |
| 5 | railway | `ver03_f` | 178 169 160 |
| 6 | path | `ver02_l` buffered 1 m | 224 205 168 |
| 7 | road | `ver01_f` + `ver01_l` buffered | 200 200 206 |
| 8 | water | `gew02_f`, `gew01_f`, `gew01_l` buffered 1 m | 164 192 209 |

Water coverage is no longer a baked channel: the browser derives it from
class 8 when it paints the splat (`app/_components/landcover-splat.ts`, a
3×3 tent — the soft shoreline). `lib/city/landcover.test.ts` checks every
committed legend names the same classes; `test_bakes.py` checks the bake's
ids are the palette's order.

### Checked against the committed artifacts

The committed `data/` was **not** re-baked by the Python pipeline. Its
outputs were compared with the committed files on the spawn tile, from
fresh GeoSN downloads:

| Output | Result |
|---|---|
| NDVI | byte-identical |
| land cover | 99.95 % of texels agree |
| roof colours | 3658 of 3668 buildings identical |
| bridges | 3 = 3 |
| canopy | 5104 trees vs 5118 committed |
| ballast | none vs one small corner sliver committed |

The differences trace to the newer Basis-DLM edition on the portal, not to
the port. The OSM steps (walls, lamps, platforms, bridge structure) were
not run against the committed files: Geofabrik was unreachable from that
environment.

## Stage 2 — the build step (`scripts/prepare-data.ts`)

Runs ahead of `next dev` and `next build` (`bun dev`, `bun build`) and turns
`data/` into an **OGC 3D Tiles 1.1** tileset under `public/data/`
([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)), which
3DTilesRendererJS streams (`app/_components/tile-stream.ts`). Four steps:

1. **Side files.** Each tile's rasters and feature collections
   (`tileArtifacts` in `lib/city/tile.ts`) are published as committed,
   plus `landcover_<t>.r2048.png`: the class raster downsampled NEAREST to
   2048², single band (`scripts/downsample-raster.ts`, sharp) — for phones,
   the coarse terrain and the minimap. Only class rasters are resized; no
   raster whose alpha carries data goes through an image tool any more.
2. **Content.** Per tile, three glTF files (below), each naming its side
   files in the glTF scene `extras`.
3. **Tilesets.** `tileset.json` over every tile of the site and
   `tileset-spawn.json` over the spawn tile alone (`lib/city/tileset.ts`,
   `buildTileset`). The client picks the full one unless the scene budget
   keeps to the spawn tile — the `lite` profile of the headless e2e
   (`city-walk-client.tsx`).
4. **Publish** (below).

### The tree

Per site tile, in the site's recentered data frame (Z-up, like every 3D
Tiles frame), all three nodes sharing the tile's bounding box:

```
root                                   refine ADD
└ tile            city_<t>.glb.gz      refine ADD      error 100 000
  └ terrain L1    terrain_<t>_l1       refine REPLACE  error 40 (COARSE_TERRAIN_ERROR)
    └ terrain L0  terrain_<t>_l0                       error 0
```

The buildings load whenever the tile is in view. The terrain refines from
512² to 1024² by screen-space error — at the renderer's 16 px target, 40 m
switches at ≈ 1.2 km from the tile on a 1080p screen. Only L0 is
*dressed*: vegetation, lamps, monuments, rails and the water and mist sheets
are built when a fine terrain tile arrives and leave with it. The root's
`extras` carry what the viewer needs before any content: the site id, the
EPSG code, the recenter offset `(cx, cy)` and per tile its id, extent and
minimap raster.

### The glTF content

Standard glTF 2.0 binaries, written by `scripts/tile-glb.ts` with
glTF-Transform: `EXT_meshopt_compression`, `KHR_mesh_quantization`
(16-bit positions, 8-bit normals, the dequantisation on the node), Y-up
(data `(x, y, z)` → glTF `(x, z, −y)`). Pre-gzipped at level 9 as
`.glb.gz`, because static hosts do not compress binary types; the client
inflates them with `DecompressionStream` when the gzip magic is there (a
host that adds `Content-Encoding: gzip` has the browser do it first). They
open in any glTF or 3D Tiles tool.

| File | From | Via | Contents |
|---|---|---|---|
| `terrain_<t>_l0.glb.gz`, `terrain_<t>_l1.glb.gz` | `data/dgm/…/dgm1_<t>.tif` (+ `.tfw` when there is no embedded georeferencing), `data/dlm/walls_<t>.geojson`, `data/dlm/stairs_<t>.geojson`, `data/dlm/terraces_<t>.geojson`, `data/dlm/kerbs_<t>.geojson` | `scripts/bake-tiles.ts` (`readDgm`, `terrainMesh`, `stairMesh`) | The DGM resampled bilinear to 1024² / 512² (NoData = NaN), the OSM walls burned in as breaklines ([ADR 0014](./adr/0014-wall-to-terrain-breakline-conflation.md), `lib/city/terrain-conflate.ts`), then the terraces lifted and the ground lowered under each flight of stairs ([ADR 0028](./adr/0028-osm-stairs-as-geometry-over-a-lowered-terrain.md), `lib/city/stairs.ts`), the grid plus a 30 m skirt, baked normals. The first n·n vertices are the grid, row 0 = north: the runtime samples ground height from them. L0 also carries a `stairs` node — the flights the tile owns as treads, risers and cheeks with 8-bit `COLOR_0` shades (`bake-tiles.ts` `stairMesh`) — and a `walls` node, the tile's wall ribbons standing on every tile's shaped fine ground (`wallMesh`), and a `kerbs` node, the kerb stones on the tile's kerb lines (`kerbMesh`, `lib/city/kerbs.ts`), so L0's cache key covers every tile's terrain inputs ([ADR 0029](./adr/0029-static-dressing-baked-into-the-fine-terrain.md)). `extras`: `kind`, `tileId`, `level`, `n`, `bounds`, `minElevation`, the level's class raster (`landcover`: 4096² for L0, 2048² for L1), `landcoverLow`, `ndvi`, and on L0 the paving and edge rasters (`surface`, `edges`) and the `dressing` file names |
| `city_<t>.glb.gz` | `data/cityjson/lod2_<t>.city.json` + `data/dop/roofcolor_<t>.json` (optional) | `scripts/bake-city-mesh.ts` (runs `cityjson-threejs-loader` once) → `bake-tiles.ts` `cityMesh` → `tile-glb.ts` `writeMeshGlb` + `addPropertyTable` | One welded mesh per tile. `_FEATURE_ID_0` per vertex (`EXT_mesh_features`) into an `EXT_structural_metadata` property table, one row per object: `tint`, `roof` (DOP colour folded in), `baseZ`, `eaveH`, `storeyH`, `glow`, `rough`, `building`, `root` (the demolish tree); `_ROOF` flags roof vertices. `extras`: `kind`, `tileId`, `footprints` |
| `footprints_<t>.json` | the same parse | `cityMesh` | per-object 2D footprints for the minimap, `[object][polygon][vertex] = [x, y]` |

Scene `extras` name the tile under **`tileId`, never `tile`**: the renderer
writes `userData.tile` itself. Every tile is recentered on one offset: the
spawn tile's CityJSON loader matrix, reused for the rest; the EPSG code
comes from the CityJSON's `metadata.referenceSystem` (25832 or 25833).

The client reads the property table through 3DTilesRendererJS's
`GLTFExtensionsPlugin` (`metadata: true`, meshopt decoder) and packs it
into a float texture the clay shader reads per object; demolish filters
the index buffer. That half is in [rendering.md](./rendering.md).

### The `/wissen` picture

`wissen-hero.webp` is not a viewer artifact: the site's class rasters
painted with the viewer's palette into one 1600² map
(`scripts/bake-wissen-hero.ts`), the picture of the `/wissen` pages
([ADR 0021](./adr/0021-docs-published-under-wissen-with-prerendered-diagrams.md)),
which hand it to `next/image`. Skipped with a log line if a class raster
is missing.

### Cache and publish

**Cache.** Baked outputs are cached in `.cache/prepare-data/` (gitignored),
one entry per output, under a key over its input files (path, mtime and
size), the bake's own sources (`BAKE_SOURCES` in `prepare-data.ts`: the
bake scripts and the `lib/city/` modules they use) and the values it
depends on (the recenter offset, the `extras` it names). A changed input,
a changed bake or a renamed side file re-bakes; anything else is a cache
read. A cold run of the Dresden site takes ≈ 21 s on four cores.

**Publish.** Each file is written to `public/data/` as
`<stem>.<8 hex of sha1>.<ext>` (`.glb.gz` keeps both suffixes);
`manifest.json` (`{ version: 1, files: {logical: hashed} }`) maps every
name, but the viewer looks up only the tileset in it: the tileset names
the hashed content, and the content's `extras` name the hashed side files
(the `/wissen` pages look up their picture the same way). Files the
manifest no longer references are pruned. `next.config.ts`
serves `/data/*` as `public, max-age=31536000, immutable` and the manifest
as `no-cache` ([ADR 0007](./adr/0007-content-hashed-publishing-with-a-manifest.md)).

A `required` side file that is missing fails the build
(`prepare-data: missing source file data/dlm/…`) rather than becoming a
404 on every client; so do a missing DGM GeoTIFF or CityJSON. A missing
optional one is logged and the feature is off.

## The contracts the browser relies on

| Contract | Module | Checked by |
|---|---|---|
| The site: tiles, CRS, grid, tile ids and extents | `lib/city/site.ts`, `sites/*.ts` | `tile.test.ts` pins Dresden's ids, spawn first |
| Every side file of a tile, its `required` flag (land cover, its 2048² variant, veg rows) and its source | `lib/city/tile.ts` (`tileArtifacts`) | `tile.test.ts`; `prepare-data.ts` publishes exactly this list and names it in the glTF `extras` — add an artifact there and nowhere else |
| The tileset tree and its `extras` | `lib/city/tileset.ts` (`buildTileset`, `parseTilesetExtras`) | `tileset.test.ts` |
| glTF encoding: meshopt, quantisation, Y-up, the property table | `scripts/tile-glb.ts` | `tile-glb.test.ts` |
| DGM → terrain grid, `.tfw` fallback | `scripts/bake-tiles.ts` | `bake-tiles.test.ts` (reads the committed spawn-tile DGM) |
| The per-object table and its texture packing, demolish | `lib/city/city-mesh.ts` | `city-mesh.test.ts` |
| Class ids ↔ palette | `lib/city/landcover.ts`, `pipeline/bake/landcover.py` | `landcover.test.ts` (every committed legend), `test_bakes.py` |
| The 2048² class raster keeps exact ids | `scripts/downsample-raster.ts` | `downsample-raster.test.ts` |
| GeoJSON feature shapes per kind | `lib/city/features.ts` | `features.test.ts` reads **every committed file** of every tile: a bake that renames a property fails there, not as an empty layer |
| Optional-artifact fetch policy | `app/_components/fetch-optional.ts` | 404 / network / parse → `null`/`[]` (feature off); **abort always rethrows** so a torn-down instance stops building from partial data |

GeoJSON allows `properties: null` and `MultiPolygon` geometries; every
loader guards both (the rail loader once dropped two of three ballast
polygons on a tile for lack of it).

## Measuring what the browser downloads

The guide's size figures come from this procedure. After
`bun scripts/prepare-data.ts`, sum the published files per tile, taking
PNG/WebP/`.gz` at face value and gzipping JSON/GeoJSON at level 6 (what a
static host sends):

```bash
bun scripts/prepare-data.ts
python3 - <<'PY'
import os, gzip, json, re
d = "public/data"; man = json.load(open(f"{d}/manifest.json"))["files"]
tot = {}
for logical, hashed in man.items():
    p = f"{d}/{hashed}"; raw = os.path.getsize(p)
    packed = logical.endswith((".png", ".webp", ".gz"))
    wire = raw if packed else len(gzip.compress(open(p, "rb").read(), 6))
    m = re.search(r"\d{5}_\d{4}_\d+(?:_[a-z]+)?", logical)
    t = tot.setdefault(m.group(0) if m else "(site)", [0, 0])
    t[0] += raw; t[1] += wire
for tile, (raw, wire) in sorted(tot.items()):
    print(tile, f"raw {raw/1e6:.2f} MB", f"wire {wire/1e6:.2f} MB")
PY
```

Measured 2026-09-25 on the current build (Dresden, gzipped wire sizes):

| Per tile | Wire |
|---|---|
| buildings `city_<t>.glb.gz` | up to 1.9 MB (33416_5658, all forest, holds one building) |
| fine terrain L0 (with walls, stairs and kerb stones) | 1.9–3.1 MB |
| coarse terrain L1 | 0.41–0.65 MB |
| minimap footprints | up to 0.08 MB (0.34 MB raw) |
| class raster 4096² / 2048² | 0.15–0.29 MB / 0.06–0.11 MB |
| NDVI 1024² | 0.32–0.77 MB |
| paving raster 2048² (fine level only) | 0.25–0.97 MB |
| edge raster 2048² (fine level only) | 0.03–1.97 MB (the forest tiles are the bottom, the southern row the top) |
| canopy GeoJSON | 0.04–0.53 MB (0.6–9.5 MB raw; the forest tiles 33414_5658 and 33416_5658 are the top) |
| street furniture GeoJSON | up to 0.02 MB (0.19 MB raw; the forest tile 33416_5658 has seven pieces) |
| everything else (veg rows, lamps, monuments, walls, rail, bridges, platforms) | ≈ 0.01–0.04 MB together |
| **tile total** | **4.2–9.0 MB** (phones, without the 4096² raster: 4.1–8.8 MB) |

The whole Dresden site is ≈ 83.4 MB on the wire (≈ 81.7 MB for a phone),
the spawn tile alone — the `lite` profile — ≈ 6.8 MB. A visit fetches
less: streaming loads a tile's content only when it is in view, and a far
tile stops at its coarse terrain (≈ 1.3–3.3 MB per tile: buildings,
footprints, the coarse terrain with its 2048² raster and the NDVI).
Before the tileset a desktop visit loaded the then four-tile site whole
at boot, ≈ 10.6 MB; the growth is quantised meshes instead of a heightfield blob
(≈ 1.4 + 1.5 + 0.4 MB of buildings and terrain per tile now vs
≈ 1.0 + 1.1 MB). Sources on disk that are never served: the DGM
GeoTIFF (12.9–15.6 MB/tile) and the CityJSON (2.7–13.6 MB/tile).

## Provenance

`data/provenance.json` is the machine-readable record: for every tile and
GeoSN product the provider's currency field ("Stand") and the download URL,
plus what is known about the OSM inputs. The guide's
[dataset table](./guide/en/data-sources.md#dataset-editions-in-use) (and its
German twin) is the prose version. Update both when a source is
re-downloaded — `bun run bake --ingest` keeps every ZIP it fetched under
`data/_raw/<site>/downloads/`, named as the provider named it.

**Where the GeoSN values come from.** The portal's download app
(`geoviewer.sachsen.de/mapviewer/resources/apps/produktdownload/`) reads an
ArcGIS map service that carries one feature per 2 km tile and product with
the fields `Produkt`, `Kachel` (the tile as `<easting km><northing km>`,
e.g. `4125656`), `Download` (the ZIP on `geocloud.landesvermessung.sachsen.de`)
and `Stand`. Layers: 1 LSC · 2 LoD1 · 3 LoD2 (`Download_CityGML`,
`Download_DXF`, `Download_Shape`) · 4 DOM1 · 6 DGM1 · 7 DOP_RGB · 17
DOP_RGBI · 18 P10 · 8–16 DTK sheets. The Saxony ingest adapter resolves
its DOM1 and DOP downloads through this service (a point query per tile).
This queries the whole Dresden site for one layer, with the `Stand`:

```bash
L=17   # 6 = DGM1, 4 = DOM1, 3 = LoD2, 17 = DOP_RGBI, 1 = LSC
curl -sS -G "https://geodienste.sachsen.de/ags-relay/ArcGISServer/guest/arcgis/rest/services/geosn/rest_geosn_downloadlinks/MapServer/$L/query" \
  --data-urlencode 'geometry={"xmin":410000,"ymin":5656000,"xmax":414000,"ymax":5660000,"spatialReference":{"wkid":25833}}' \
  --data-urlencode 'geometryType=esriGeometryEnvelope' --data-urlencode 'inSR=25833' \
  --data-urlencode 'spatialRel=esriSpatialRelIntersects' --data-urlencode 'outFields=*' \
  --data-urlencode 'returnGeometry=false' --data-urlencode 'f=json' \
  | python3 -c 'import json,sys; [print(f["attributes"]) for f in json.load(sys.stdin)["features"]]'
```

The ZIPs themselves are on public Nextcloud folders (one token per product
and format); the tokens can rotate, the service is the durable index. The
Basis-DLM is one statewide package replaced quarterly under the same URL
(`basisdlm_sn_shape.zip`, 1.23 GB, `Last-Modified` 2026-07-28 when
checked; `BASIS_DLM` in `ingest_sn.py`), so its edition must be noted at
download time: `curl -sI -r 0-0` on the URL prints the file date, and the
ZIP carries a metadata file.

**Where the OSM values come from.** The pipeline reads the Geofabrik
extract in `data/_raw/<site>/osm/`; its timestamp is printed by
`osmium fileinfo -e <file>.osm.pbf` (`osmosis_replication_timestamp`).
The committed walls came from such an extract; the committed lamps,
platforms and bridge structures came from Overpass queries in the old bash
bakes, whose cached responses carried the data timestamp in
`osm3s.timestamp_osm_base`. `data/provenance.json` records both sources.
No raw file is committed, so the record keeps git dates as bounds until
someone reads the timestamps.

**Licences.** *Datenlizenz Deutschland – Namensnennung 2.0* (`dl-de/by-2-0`)
for the GeoSN products and ODbL for OSM; both credits are in the HUD footer
(`scene-sidebar.tsx`), whose lines come from the site's `attribution`.

## Regenerating or adding a tile

```bash
bun run bake 33412_5656_2_sn --ingest   # fetch DOM1, DOP, Basis-DLM, OSM; bake all steps
bun run bake 33412_5656_2_sn --step rail   # or one step again
bun scripts/prepare-data.ts             # tileset + publish → public/data
bun test                                # features.test.ts checks the new files
```

For a new tile also:

1. Commit its DGM GeoTIFF (+ `.tfw`, `_akt.csv`) under
   `data/dgm/dgm1_<t>_tiff/` and its LoD2 as CityJSON under
   `data/cityjson/lod2_<t>.city.json`, with EPSG:25832 or 25833 declared in
   `metadata.referenceSystem` (reproject with
   `cjio in.city.json reproject 25833 save out.city.json`). The ingest
   adapter fetches neither: both are committed sources, not raw inputs.
2. Add the cell to the site's `tiles` in `sites/<id>.ts` (the first stays
   the spawn tile).
3. Bake and build as above; `bun test` runs `features.test.ts` over the
   committed files.

A new place is a new site file and, outside Saxony, a new ingest adapter;
what exists for that, and what is missing, is in
[portability.md](./portability.md).
