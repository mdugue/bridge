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
there is no NDVI. Outside Germany (other CRS, OSM buildings, a public DEM)
is an open direction in [plans/README.md](./plans/README.md).

## What is built

**Sites and providers**
([ADR 0026](./adr/0026-one-site-config-per-build.md),
[ADR 0030](./adr/0030-sites-providers-and-per-site-data.md)). A place is
`sites/<id>.ts`, typed by `lib/city/site.ts`: its `name` and HUD `label`,
the tiles (`{e, n}` 2 km cells, the first is the spawn), the curated
viewpoints, the sun's fallback position and the **provider** it draws on.
The provider (`sites/providers.ts`) is the Land's surveying office: CRS
(`epsg`: **25832 or 25833**), licence and the credit line the HUD footer
shows, the Geofabrik extract, the tile suffix, and which optional products
are open (`products`: a surface model, the orthophoto's bands, the
Basis-DLM). `SITE=<id>` — in `.env.local`, or the host's environment —
picks the site at build time (default `dresden`); `next.config.ts` inlines
it for the client. One site per build keeps the app a static bundle
([ADR 0001](./adr/0001-client-only-static-app.md)); a multi-site deployment
is one build per site.

| Provider | Id | CRS | Licence | Downloads | Surface model | DOP | Basis-DLM (Shape) | Adapter tested |
|---|---|---|---|---|---|---|---|---|
| Saxony (GeoSN) | `sn` | 25833 | dl-de/by-2-0 | 2 km tiles (our grid) | DOM1 | RGBI | ✅ statewide package | ✅ Dresden, Leipzig, Meißen, Grimma |
| NRW (Geobasis NRW) | `nw` | 25832 | dl-de/zero-2-0 | 1 km tiles, `index.json` per folder | DOM1 | RGBI (JPEG 2000) | ✅ 4.7 GB package, layers read by range | ✅ Unna |
| Bavaria (LDBV) | `by` | 25832 | CC BY 4.0 | 1 km rasters, 2 km LoD2 | DOM20 → 1 m | RGB only | ✅ 1.3 GB package (Deflate64), layers by range | ✅ München |
| Hamburg (LGV) | `hh` | 25832 | dl-de/by-2-0 | one ZIP per product for the city (1 km inside), read by range | bDOM1 | RGBI | ❌ NAS only → OSM | ✅ Hamburg |
| Berlin (SenSBW) | `be` | 25833 | dl-de/zero-2-0 | ATOM: 2 km XYZ heights, 1 km LoD2, DOP per district | DOM1 | RGBI (JPEG 2000) | ❌ WFS only → OSM | ❌ portal unreachable from the agent's container |

**Tile ids.** `tileIdOf` names a cell
`<UTM zone><e km>_<n km>_2<tileSuffix>` — Saxony's scheme; Dresden keeps
`33412_5656_2_sn`. Every tile is 2 km (`TILE_KM`): the rasters (4096²
classes, 1024² terrain) and phone budgets are sized for it, and the fetch
step cuts other download grids to it. Ids are coordinates, so they are
unique across sites.

**Any number of tiles.** The site streams as a 3D Tiles tileset
([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)): there is no fixed
block and no "primary" tile beyond where you spawn.

**Fetch, bake, build.** `bun run fetch` runs the provider's adapter
(`pipeline/bake/providers/<id>.py`, five functions: `dgm`, `dom`, `dop`,
`lod2`, `dlm`) and turns what it returns into the layouts the rest reads:
rasters mosaicked and clipped to the tile (`rasters.py`; the DGM written
compact into `data/<site>/dgm/`), LoD2 CityGML converted to CityJSON
(`citygml.py`, no external tools) into `data/<site>/cityjson/`, the surface
model, orthophoto, Basis-DLM layers and OSM extract into the provider's
shared `data/_raw/<provider>/`. `bun run bake` derives the per-tile
artifacts; `bun dev` / `bun run build` build the tileset. `bun run site`
reports per tile what is on disk and what to run next. See
[data-pipeline.md](./data-pipeline.md#the-canonical-raw-layout).

**Land cover from OSM** (`pipeline/bake/landcover_osm.py`) where the
Basis-DLM is not open in the Shape profile: the same class raster, legend
and hedge / tree-row lines, from `landuse`/`natural`/`leisure` areas,
buildings and amenity areas (as settlement), buffered highways, waterways
and rail. Measured against the DLM on Leipzig's centre tile: 71 % of
texels agree overall — water 95 %, settlement 78 %, roads 55 % (OSM draws
centrelines; the DLM whole street spaces).

**One palette, painted at runtime**
([ADR 0023](./adr/0023-land-cover-colours-painted-at-runtime.md)). The
bakes write class ids only; the colours are `lib/city/landcover.ts`. The
building tint has one per-site switch, `facades: "brick"` for clinker
cities (Hamburg); the default is Dresden's rendered plaster
(`lib/city/building-tint.ts`).

## Degradation matrix

For each source: its role, what happens **today** when it is absent, and
the planned fallback. ✅ built · ❌ not built.

| Source | Role | If **absent**, today | Planned |
|---|---|---|---|
| **LoD2** (CityGML → CityJSON, `data/<site>/cityjson/`) | building geometry + attributes; roof-colour sampling | ❌ the build fails (`prepare-data: missing source file … — run bun run fetch`) | open in every Land, so no fallback is planned; OSM footprints are an idea for outside Germany (Direction option 1) |
| **DGM1** (`data/<site>/dgm/`) | terrain; ground heights for the canopy and rail bakes | ❌ the build fails; the canopy and rail bakes need it | open in every Land; a flat plane is an idea for outside Germany |
| **Surface model** (DOM1; Bavaria's DOM20 averaged to 1 m) | canopy heights (nDOM); bridge deck surface | ✅ the canopy step skips with a note and the build treats the canopy as optional (trees come from the hedge / tree rows only); ✅ rail decks fall back to the DGM abutment ramp (no viaduct lift) | — |
| **Basis-DLM** (AdV Shape profile) | class raster (surface colours, water, the tree and lamp gates), hedge / tree rows, rail tracks + ballast, bridge decks | ✅ a provider without it (`products.dlm: false`) gets the class raster, legend and veg rows **from OSM**, and the canopy's forest/park gate from the class raster plus OSM parks. ❌ rails, ballast and bridge decks are off (optional at runtime). A DLM provider whose package is missing on disk stops the land-cover step (`bun run fetch` first) | OSM tracks (`railway=rail`) and decks (`man_made=bridge`); a NAS reader for Hamburg's open NAS package |
| **DOP** (RGB + NIR) | roof colour per building; NDVI (crown colour, meadow tint) | ✅ both steps skip; an RGB-only DOP (Bavaria) skips the NDVI only; the runtime uses the synthesized roof palette and hash-only sage crowns (`ndvi` and the roof LUT are optional) | — |
| **OSM extract** (`.osm.pbf`) | retaining walls (+ terrain breaklines), stairs and terraces (shaped into the fine terrain), street lamps, platforms, bridge structure (arches); the land cover where there is no DLM | ✅ the lamps, walls and stairs steps skip with a note, and the rail step writes bridges without structure; none of them empties a file already there (platforms stay as committed). Lamps, walls, stairs and platforms are optional at runtime. ❌ Where the land cover comes from OSM (Hamburg, Berlin) the land-cover step stops ("run bun run fetch first") — the extract is then required | — |

**Lower quality or different shape** is mostly untested:

- The canopy and rail bakes read DGM1 and DOM1 on the tile's **1 m grid**
  (`nDOM = DOM1 − DGM1` texel by texel); the fetch resamples every
  provider's heights to that grid (`rasters.py`), so a coarser model reads
  as a blurrier one (Bavaria's DOM20 is averaged down, which is fine). The
  terrain bake itself resamples the DGM to its 1024² / 512² grids.
- An **RGB-only DOP** (no NIR band) skips the NDVI step; the roof colours
  only need bands 1–3.
- The raster edges are per tile, not per metre: a 4096² class raster and
  1024² terrain over a 2 km tile, which is why every tile is 2 km.
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
2. **Select it.** `SITE=<id>` in `.env.local`.
3. **Fetch, bake, look.** `bun run fetch`, `bun run bake`, `bun dev`;
   `bun run site` says what is missing. Verify on a real GPU with the
   snapshot harness (see the
   [city-walker skill](../.claude/skills/city-walker/SKILL.md)) from
   oblique angles: buildings on the ground, not floating or sunk.
4. **Decide about git.** To deploy from git, un-ignore `data/<id>/` in
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
  (ADR 0030, alternatives).
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
