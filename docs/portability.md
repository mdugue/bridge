# Portability — rendering any location, with whatever data it has

The goal is a viewer that works for **any city, village, or area** we can pull
structured geodata for — not just Dresden. Two locations rarely have the same
data: one has LoD2 + DOP, another only OSM footprints and a coarse DEM. This
page says **what is built today** for standing up another place, **what each
feature does when its input is missing**, and **what is still missing** — with
a checklist for a new site.

Design rule: **every feature has a graceful fallback, and no single optional
source is load-bearing.** The core is LoD2 buildings and DGM1 terrain —
published openly by every German Land. Everything else degrades: without
an open Basis-DLM the land cover comes from OpenStreetMap, without a
surface model the trees come from the rows only, without an infrared band
the vegetation index comes from the visible bands. Which stand-in each
city uses is the generated
[Sources by city](./guide/en/sources-by-city.md) page
([ADR 0012](./adr/0012-openstreetmap-for-what-official-data-lacks.md)). Outside Germany (other CRS, OSM buildings, a public DEM)
is an open direction in [plans/README.md](./plans/README.md).

## What is built

**Sites and providers**
([ADR 0037](./adr/0037-sites-providers-and-per-site-data.md),
[ADR 0037](./adr/0037-sites-providers-and-per-site-data.md)). A place is
`sites/<id>.ts`, typed by `lib/city/site.ts`: its `name` and HUD `label`,
the tiles (`{e, n}` 2 km cells, the first is the spawn), the curated
viewpoints, the sun's fallback position and the **provider** it draws on.
The provider (`sites/providers.ts`) is the Land's surveying office: CRS
(`epsg`: **25832 or 25833**), licence and the credit line the HUD footer
shows, the Geofabrik extract, the tile suffix, and which optional products
are open (`products`: a surface model, the orthophoto's bands, the
Basis-DLM) — and the `land` the start page names.

**One deployment, a route per site.** There is no site variable: the build
(`scripts/prepare-sites.ts`) prepares every site whose data is ready into
`public/data/<site>/` and writes the index `public/data/sites.json`; the
app prerenders one route per built site (`/dresden`, `/leipzig`, …,
`app/[site]/page.tsx`; an unknown or unbuilt site is a 404) and a start
page at `/` with a card per city. It stays a static bundle
([ADR 0001](./adr/0001-client-only-static-app.md)): every route is
prerendered and every site's data is static files. A deployment serves
exactly the sites whose `data/<site>/` is present where it builds — in a
fresh clone every committed site: Dresden, Grimma, Hamburg, Leipzig,
Meißen, München and Unna (ADR 0037).

| Provider | Id | CRS | Licence | Downloads | Surface model | DOP | Basis-DLM (Shape) | Laser scan (`--lsc`) | Adapter tested |
|---|---|---|---|---|---|---|---|---|---|
| Saxony (GeoSN) | `sn` | 25833 | dl-de/by-2-0 | 2 km tiles (our grid) | DOM1 | RGBI | ✅ statewide package | ✅ LSC, 2 km LAZ (≈380 MB) | ✅ Dresden, Leipzig, Meißen, Grimma |
| NRW (Geobasis NRW) | `nw` | 25832 | dl-de/zero-2-0 | 1 km tiles, `index.json` per folder | DOM1 | RGBI (JPEG 2000) | ✅ 4.7 GB package, layers read by range | ✅ 3D-Messdaten, four 1 km LAZ (≈100 MB each) merged; 16-bit intensities, normalised per scan like every scan | ✅ Unna |
| Bavaria (LDBV) | `by` | 25832 | CC BY 4.0 | 1 km rasters, 2 km LoD2 | DOM20 → 1 m | RGB only | ✅ 1.3 GB package (Deflate64), layers by range | ✅ laser points, four 1 km LAZ (≈105 MB each) merged, LDBV classes mapped to AdV (buildings 6 and "object points" 20 → 20) | ✅ München |
| Hamburg (LGV) | `hh` | 25832 | dl-de/by-2-0 | one ZIP per product for the city (1 km inside), read by range | bDOM1 | RGBI | ❌ NAS only → OSM | — not read | ✅ Hamburg |
| Berlin (SenSBW) | `be` | 25833 | dl-de/zero-2-0 | ATOM: 2 km XYZ heights, 1 km LoD2, DOP per district | DOM1 | RGBI (JPEG 2000) | ❌ WFS only → OSM | — not read | ❌ portal unreachable from the agent's container |

**Tile ids.** `tileIdOf` names a cell
`<UTM zone><e km>_<n km>_2<tileSuffix>` — Saxony's scheme; Dresden keeps
`33412_5656_2_sn`. Every tile is 2 km (`TILE_KM`): the rasters (4096²
classes, the 512² coarse terrain) and phone budgets are sized for it, and the fetch
step cuts other download grids to it. Ids are coordinates, so they are
unique across sites.

**Any number of tiles.** The site streams as a 3D Tiles tileset
([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)): there is no fixed
block and no "primary" tile beyond where you spawn.

**Fetch, bake, build.** `bun run fetch <site>` runs the provider's adapter
(`pipeline/bake/providers/<id>.py`, five functions: `dgm`, `dom`, `dop`,
`lod2`, `dlm`) and turns what it returns into the layouts the rest reads:
rasters mosaicked and clipped to the tile (`rasters.py`; the DGM written
compact into `data/<site>/dgm/`), LoD2 CityGML converted to CityJSON
(`citygml.py`, no external tools) into `data/<site>/cityjson/`, the surface
model, orthophoto, Basis-DLM layers and OSM extract into the provider's
shared `data/_raw/<provider>/`. `bun run bake <site>` derives the per-tile
artifacts; `bun dev` / `bun run build` build the tileset of every ready
site. `bun run site <site>` reports per tile what is on disk and what to
run next. See
[data-pipeline.md](./data-pipeline.md#the-canonical-raw-layout).

**Land cover from OSM** (`pipeline/bake/landcover_osm.py`) where the
Basis-DLM is not open in the Shape profile: the same class raster, legend
and hedge / tree-row lines, from `landuse`/`natural`/`leisure` areas,
buildings and amenity areas (as settlement), buffered highways, waterways
and rail. Measured against the DLM on Leipzig's centre tile: 71 % of
texels agree overall — water 95 %, settlement 78 %, roads 55 % (OSM draws
centrelines; the DLM whole street spaces).

**One palette, painted at runtime**
([ADR 0010](./adr/0010-opaque-clay-buildings-only.md)). The
bakes write class ids only; the colours are `lib/city/landcover.ts`.
There are **no per-site look switches**
([ADR 0012](./adr/0012-openstreetmap-for-what-official-data-lacks.md)): what differs
between cities is derived from their data. A building without a mapped
material wears brick or plaster as its OSM neighbourhood is mapped
(`osm_buildings.py` `context`; Hamburg's former `facades: "brick"` is
gone — its tiles now vote brick from their own mapped walls); the valley haze
pools over a share of the valley's depth, each tile's rise to its lower rim
within 5 km in Copernicus GLO-30, or of the site's ground relief where no
GLO-30 window is cached (`lib/city/valley-fog.ts`); a city's trees leave
out and turn by its own climate (`lib/city/tree-season.ts` `SITE_SEASON`,
from the DWD's phenology reporters within 30 km — a table in the code, so a
new site needs its row);
a tram track carries its OSM `gauge`; a tile's landmarks are those with a
share of its most notable one's Wikipedia articles. A new look parameter
that differs between cities is derived in the bake or the build, not
added to `Site`.

**Sources by city.** `bun run docs:matrix` writes the guide's
[Sources by city](./guide/en/sources-by-city.md) table from the site and
provider configs (`lib/city/source-matrix.ts`): per city and per drawn
layer, the best source (🟢), OSM as the only one (🔵), a stand-in (🟡)
or nothing (⚪), with the reason. A new site or provider product shows
up there after a re-run; its test keeps the committed page current.

## Degradation matrix

For each source: its role, what happens **today** when it is absent, and
the planned fallback. ✅ built · ❌ not built.

| Source | Role | If **absent**, today | Planned |
|---|---|---|---|
| **LoD2** (CityGML → CityJSON, `data/<site>/cityjson/`) | building geometry + attributes; roof-colour sampling; with the DGM the sky-view factor and far horizon (`skyview`) | ❌ the build fails (`prepare-data: missing source file … — run bun run fetch`) | open in every Land, so no fallback is planned; OSM footprints are an idea for outside Germany (Direction option 1) |
| **DGM1** (`data/<site>/dgm/`) | terrain; ground heights for the canopy and rail bakes | ❌ the build fails; the canopy and rail bakes need it | open in every Land; a flat plane is an idea for outside Germany |
| **Surface model** (DOM1; Bavaria's DOM20 averaged to 1 m) | canopy heights (nDOM); bridge roadway height and superstructure (truss, pylons, arch); the structures beyond LoD2 (`structures`: columns, missing buildings, a landmark's roof relief); the LoD2 roofs that miss it, rebuilt in its form (`roofs`, ADR 0036); the road land's green verges (`edges`, low ground and woods) | ✅ the canopy step skips with a note and the build treats the canopy as optional (trees come from the hedge / tree rows only); ✅ rail decks fall back to the DGM abutment ramp, with no ribs (slabs over arches or piers); ✅ `structures` writes an empty file (LoD2 only); ✅ `roofs` skips, every LoD2 roof stays as it is; ✅ `edges` finds no verges (a note): the road land stays road grey | — |
| **Basis-DLM** (AdV Shape profile) | class raster (surface colours, water, the tree and lamp gates), hedge / tree rows, rail tracks + ballast, bridge decks, the official monuments (statues, memorial stones, columns, named fountains) | ✅ a provider without it (`products.dlm: false`) gets the class raster, legend and veg rows **from OSM**, the canopy's forest/park gate from the class raster plus OSM parks, and its fountains from OSM alone, and **rails, ballast and bridge decks from OSM** (`rail_osm.py`: `railway=rail/light_rail/subway/narrow_gauge` with `tracks`, their beds as ballast, `bridge` ways merged per bridge and level on `man_made=bridge` outlines; deck heights still measured in DOM1 — weaker: a track per way, no bundled yards). ❌ the statues and stones are off (optional at runtime). The DLM's tunnels (`ver06`, `BWF=1870`) cut the rails that run underground; a package without them would draw subways at street level. Its culverts (`ver06` `BWF` 2010–2012) and the stream axes' `HDU_X` keep a piped stream off the class raster; without them it is painted as water. A DLM provider whose package is missing on disk stops the land-cover step (`bun run fetch` first) | a NAS reader for Hamburg's open NAS package |
| **DOP** (RGB + NIR) | roof colour per building; NDVI (crown colour, meadow tint, the tram's lawn bed, the hedge cue) | ✅ an RGB-only DOP (Bavaria) gets the vegetation index from its visible bands instead (GLI on the NDVI's scale, `ndvi.py` `_gli`; r ≈ 0.7 against the NDVI — green vs grey well, vigour less well); every flight's index is mapped onto Dresden's scale by its carriageways and mown lawns (needs the OSM extract and DOM1; without enough of either the raw index stays); no DOP: both steps skip and the runtime uses the synthesized roof palette and hash-only sage crowns (`ndvi` and the roof LUT are optional). The roof colour's sun is searched along the flight day's solar path (`dop/<tile>.flight.json`, the provider adapter's `flight`); a provider whose adapter reads no flight days falls back to a whole-sky search, which fitted suns the day never had (🗃️ in the ledger) | — |
| **OSM extract** (`.osm.pbf`) | retaining walls (+ terrain breaklines), stairs and terraces (shaped into the fine terrain), fountains, street lamps, street furniture and playgrounds, sports grounds, paving and parking, the road islands carved out of the DLM's roads, platforms, bridge structure (arches), the fairway clearance under bridges (`seamark:*`), fences and gates, road markings, trams, the Elbe's landing stages and ferries (`riverside`), allotments, orchards and vineyards (`cultivated`), shops, listed buildings, wall materials and colours (`osm-buildings`), what the surface model's gaps are (`structures`: nothing is added without it), which objects a landmark is (`landmarks`: else the LoD2 building under its point); the land cover where there is no DLM | ✅ the lamps, walls, stairs, furniture, paving, sport and islands steps skip with a note, and the rail step draws the DLM's tracks alone (one centreline a line, its `GLS` tracks side by side: two for Dresden Hbf's fifteen; the catenary on its own grid, no mapped mast) and writes bridges without structure or clearance (piers anywhere) — without a DLM as well it writes nothing (`has_extract`); none of them empties a file already there (platforms stay as committed). Lamps, walls, stairs, furniture, paving, sports grounds and platforms are optional at runtime. ❌ Where the land cover comes from OSM (Hamburg, Berlin) the land-cover step stops ("run bun run fetch first") — the extract is then required | — |
| **Copernicus GLO-30** (`data/_raw/glo30/<site>.tif`, a window over the site and 10 km around it, fetched by `bun run fetch` for every site; the model covers the world) | the ground beyond the site in the sky view and the far horizon (its hills to 10 km); the valley's rim, from which the haze's depth is read | ✅ no window: the site's own edge runs on level outward (`skyview.extend_edges`: no skyline beyond the site, nothing higher than the edge it continues), and the haze's depth falls back to the site's ground relief (p90 − p2: a town on a one-sided slope then reads as a valley) | — |
| **Wikidata** (`data/_raw/<provider>/wikidata/bridges_<tile>.json` and `landmarks_<tile>.json`, fetched by `bun run fetch` for every provider) | bridge class (overrides OSM's `bridge:structure`), main span, number of spans; the landmarks (flag, the HUD's list, the roof relief, a material where OSM has none) | ✅ no file: the OSM structure, the default fairway width; an empty landmark list (no *Wahrzeichen* chips, no relief) | — |
| **Wikimedia Commons** (`data/_raw/<provider>/murals/`, fetched by `bun run fetch`; the chosen photos committed as WebP in `data/<site>/murals/`) | the murals' photos and their credits (with Wikidata's size and photo where OSM has none) | ✅ no file, or no photo that shows a mural straight on: the wall is drawn plain, as before | — |
| **Laser scan (LAZ)** (`Provider.products.lsc`: GeoSN's LSC and NRW's 3D-Messdaten, the same AdV classes 2 / 20, and Bavaria's laser points, whose classes the merge maps into AdV — NRW's and Bavaria's 1 km files merged per tile by `lsc.merge_laz`; `data/_raw/<provider>/lsc/<tile>.laz`, `bun run fetch <site> --lsc` or by hand) | hedge heights along the OSM hedges; trees outside the canopy mask (`canopyx`); the sheds and garden houses LoD2 lacks (`small-buildings`) | ✅ the hedge step falls back to OSM only: mapped hedges at their `height` tag (or 1.5 m), no extra trees; the small-buildings step skips; `canopyx` and `smallbuild` are optional. Also without PDAL on PATH | sparser points (< 4 /m²) leave holes in the 0.5 m rasters — bin at 1 m and raise `MIN_AREA_M2`; classified low vegetation (ASPRS 3/4) would replace the NDVI + intensity cue outright; another scanner's intensities are normalised by `lsc.rasterise` itself (its ground median to GeoSN's 1352 on Dresden's spawn tile); another class scheme needs a table in its adapter (`merge_laz(classes=…)`, as Bavaria's) |
| **Street-tree cadastre** (`Site.treeCadastre`: the registers of Dresden, Hamburg, Leipzig and Berlin, `cadastre.py` `REGISTERS`; `data/_raw/<provider>/trees/<tile>.geojson`, fetched by `bun run fetch`) | surveyed trees with height, crown and taxon; the OSM trees it does not cover are added beside it (sized from its statistics) | ✅ the trees step writes the OSM trees alone, their heights measured in DOM1 (Grimma, Meißen, Munich and Unna: a city's own register is a city's, not a Land's, and these have none open); `trees` is optional at runtime, and the canopy and rows plant beside them. A register without heights (Hamburg's) takes them from each tree's genus and trunk (`allometry.py`, the curve fitted on Dresden's and Leipzig's registers and shipped as `tree_allometry.json`, so no other register is needed), then the surface check (a tree the model must see and does not is left out; a stale height becomes the model's). Another city's cadastre needs its own entry in `pipeline/bake/cadastre.py` (the WFS and the field mapping) and an id in `TREE_REGISTERS` (and its taxonomy in `tree_archetypes.py`) | — |

**Lower quality or different shape** is mostly untested:

- The canopy and rail bakes read DGM1 and DOM1 on the tile's **1 m grid**
  (`nDOM = DOM1 − DGM1` texel by texel); the fetch resamples every
  provider's heights to that grid (`rasters.py`), so a coarser model reads
  as a blurrier one (Bavaria's DOM20 is averaged down, which is fine). The
  terrain bake triangulates the fine level from that 1 m grid (a TIN within
  ±0.15 m) and resamples the coarse one to 512².
- An **RGB-only DOP** (no NIR band) gets a Green Leaf Index on the NDVI's
  scale from bands 1–3 (fitted on NRW's RGBI); the roof colours only need
  bands 1–3 anyway.
- **Another flight's colours** need no tuning: the vegetation index of every
  site is calibrated onto Dresden's by two anchors it shows anyway, its
  carriageways and its mown lawns (`ndvi.py`). A site that is nearly all
  forest or nearly no lawn — fewer than 2 000 texels of either over all its
  tiles — keeps the raw index, and the thresholds read it as Dresden's.
- The raster edges are per tile, not per metre: a 4096² class raster and
  a 512² coarse terrain over a 2 km tile, which is why every tile is 2 km.
- **LoD1** buildings (boxes, no roof shape) have not been tried through the
  building bake.

## Porting checklist (new location)

**In a Land that has a provider** (Saxony, NRW, Bavaria, Hamburg, Berlin):

1. **Write the site.** `sites/<id>.ts` — `id`, `name`, `label`, the
   provider, the tiles (even 2 km cells, spawn first), 3–5 viewpoints
   (aerials over a landmark are easiest framed with `overlook`), the
   `spawn` viewpoint the player starts at (on the first tile) and
   `fallbackLatLng` — and one line in `sites/index.ts`. `site.test.ts`
   checks that every viewpoint stands on a tile and the spawn on the first. Pick walk viewpoints on
   open ground: not in a building, not on water, and not on a bridge (the
   DGM has no deck, so eye height would put you on the river).
2. **Fetch, bake, look.** `bun run fetch <id>`, `bun run bake <id>`,
   `bun dev` — the start page gains its card and the viewer runs at
   `/<id>`; `bun run site <id>` says what is missing. Verify on a real GPU
   with the snapshot harness (`SHOTS_SITE=<id>`; see the
   [city-walker skill](../.claude/skills/city-walker/SKILL.md)) from
   oblique angles: buildings on the ground, not floating or sunk.
3. **Decide about git.** To deploy from git, un-ignore `data/<id>/` in
   `.gitignore` (`bun run site --all` shows the size) and record the
   editions in `data/<id>/provenance.json`.

**In a new Land:** add a `Provider` to `sites/providers.ts` (CRS, licence
and credit, open products, OSM extract, tile suffix) and its id to
`ProviderId`, and write `pipeline/bake/providers/<id>.py` with the five
functions — each returns the provider's own files covering a tile (any
grid, any raster GDAL reads, CityGML); `fetch.py` does the mosaicking,
clipping and conversion. `cells(tile, km)` gives the provider's grid cells;
`net.py` downloads whole files or single members of remote ZIPs. Record the
new source in the guide's data-sources page (both languages) and in
[transformations.md](./transformations.md) if a transformation changes.

## Still missing

- **Rails and bridges without a Basis-DLM**: OSM tracks and bridge decks,
  so Hamburg and Berlin get their viaducts.
- **NAS input** — Hamburg's Basis-DLM is open as NAS; a NAS reader would
  replace the OSM land cover there.
- **Berlin's adapter is untested** (the portal's certificate chain was
  refused in the environment that wrote it), and so is its XYZ gridding on
  real files.
- **Data outside git** for deployments beyond a handful of sites
  (ADR 0037, alternatives).
- **Outside Germany** — OSM buildings, a flat or public-DEM terrain, and a
  CRS other than ETRS89 / UTM 32/33 — is not planned beyond the Direction
  option in [plans/README.md](./plans/README.md).

## Where the data comes from

The portals, licences and credits per provider are in
`sites/providers.ts` and the table above; the guide's
[Where the data comes from](./guide/en/data-sources.md) describes each
dataset for non-developers, and [data-pipeline.md](./data-pipeline.md#provenance)
how the adapters find the downloads. Raw downloads stay in
`data/_raw/<provider>/` (gitignored, **never committed** — no Git-LFS).
