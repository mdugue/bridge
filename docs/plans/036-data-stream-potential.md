# Plan 036: What the data streams carry that the walker does not use yet

> **Executor instructions**: This is a survey, not a build plan. It lists,
> per source, the information that is present over the site but unread by
> any bake, with measured coverage, and ranks what would fit the walker.
> Pick an item, give it its own numbered plan, and mark it here. Every
> item must pass the art-direction north star at the end of
> [transformations.md](../transformations.md) and must not revive a 🗃️
> entry without its caveat (notably **no map lettering**: plan 032).
>
> **Drift check (run first)**: re-run the census before trusting a count
> older than a few months — OSM and Wikidata are live data, the city's WFS
> layers are replaced without notice.

## Status

- **Priority**: P3 (direction)
- **Effort**: survey S (done); each item S–L, see the ranking
- **Risk**: LOW (read-only); per item as stated
- **Planned at**: 2026-09-27
- **Status**: **TODO** — survey done, no item picked

## Method (2026-09-27)

Site = the fifteen tiles, EPSG:25833 x 408 000–418 000, y 5 654 000–
5 660 000 (WGS84 13.6865–13.8306 E, 51.0302–51.0856 N). A way counts by
its middle node, a relation by any member inside; counts are approximate.

| Source | How it was read | As of |
|---|---|---|
| OSM | BBBike `Dresden.osm.pbf` (Geofabrik unreachable from the container), pyosmium tag census | extract of 2026-09-19 |
| LoD2 CityJSON | every attribute key on the fifteen committed files, fill rate per object type | committed files |
| Dresden open data | the city's WFS (`kommisdd.dresden.de/net3/public/ogcsl.ashx`), NODEIDs 1–2400 scanned for feature types (~980), samples over the spawn tile | live, 2026-09-27 |
| Wikidata | SPARQL `wikibase:box` over P625, class closure computed separately (a `P31/P279*` inside the box query times out) | live, 2026-09-27 |
| GeoSN | the download-links MapServer's layer list; the LAZ/DOP/DOM channels from the bake code | 2026-09-27 |
| Basis-DLM | the layers and attributes the bakes read, from the code; the unread layers **from the AAA catalogue, unverified** (the raw package is not in the container) | — |

The census scripts were throw-away; the counts below are their record.

## What is read today (short)

- **LoD2**: `function`, `roofType`, `Dachneigung`, `measuredHeight`, the
  RoofSurface/GroundSurface semantics.
- **Basis-DLM**: `veg01–04`, `sie02_f`, `sie03_p` (monuments), `ver01–03`,
  `ver06` (bridges), `gew01–02`.
- **Laser scan**: classes 2/8/30 and 20, return counts, `z`, intensity for
  returns 0.25–4 m up. **DOP**: RGB on roofs, R + NIR as NDVI. **DOM1**:
  canopy, monument relief, bridge decks and steel.
- **Tree cadastre**: position, botanical/German name, height, crown and
  trunk diameter.
- **Wikidata**: bridges only (class, P2787, P2043).
- **OSM**: see `data/provenance.json` → `openstreetmap` (walls, fences,
  stairs, lamps by position, furniture, surfaces, markings, sport, trams,
  riverside, cultivated land, trees, shop/gastro and heritage on buildings,
  church outlines for the bells).

## Unused, by source

### OpenStreetMap

| Information | In the site | Idea for the walker |
|---|---|---|
| Tram route relations with `colour` | 31 relations, 13 lines; 179 bus routes | a stop's lines; a passing tram (or only its sound) in the line colour |
| `building:colour` | 2 900 objects (1 385 buildings, 1 515 parts); 21–28 % of outlines in the centre, 0–6 % outside | the only **facade** colour source (the DOP sees roofs only): a pastelised tint where mapped, the hash elsewhere |
| `building:material`, `roof:material` | 1 988 / 1 743 — sandstone 520, glass 336, brick 197; copper roofs 132, gold 10, green roofs 135 | sandstone darkening, a glass sheen, verdigris domes, gilded tips |
| `tourism=artwork` | 383 (sculpture 150, statue 84, mural 44); `artist_name` 149, `wikidata` 161 | murals as a facade patch, sculptures beside the DLM monuments |
| `memorial=stolperstein`, plaques, war memorials | 281 (all named), 60, 20 | small brass glints in the pavement; names only on demand |
| `lit` on ways | 19 268 ways (yes 15 844, no 4 693) — far more than the 3 064 mapped lamps | at night lit streets keep a glow, unlit park paths fall dark |
| Lamp shape: `lamp_mount`, `lamp_type`, `light:count`, `support` | 1 078 / 571 (9 gaslight) / 289 / 401 of 3 064 lamps | lamp silhouettes, double heads, warm gas lanterns |
| `traffic_signals:sound=yes`, `vibration` | 615 / 1 014 | the crossings' ticking in the soundscape |
| `opening_hours`, `outdoor_seating`, `cuisine` | 2 957 on shops and gastro / 540 yes / 675 | shop glow only while open; café tables in the warm months; a murmur there |
| Small water: `waterway=stream/drain/weir/waterfall`, `natural=spring`, ponds | 121 / 30 / 4 / 2 / 11 / 31 | trickle and weir sounds; brooks below the class raster's reach |
| Tree `denotation`, `natural=tree_row` | 2 900 (avenue 647, natural monument 15), 423 rows | avenue rhythm; landmark trees |
| `landuse=flowerbed` | 185 | painted as meadow today; a seasonal flower speckle |
| `place=suburb/quarter/neighbourhood/square`, admin levels 9 and 11 | 23 / 5 / 22 / 32; 63 / 101 | "you are in …" as a HUD line (not on the ground); a sound character per quarter |
| Razed/abandoned/disused railways | 782 / 371 / 283 | faint ghost tracks as a history layer |
| `entrance=*` | 8 362 (main 4 070) | a door glow at dusk, where the shop wash has none |
| Small `man_made`: flagpole, chimney, mast, crane, water well/tap, planter | 129, 56, 147, 15, 38 + 43, 52 | flags in the wind, cranes on the skyline, hand pumps |
| `tactile_paving`, `kerb`, `smoothness` | 5 422 / 2 845 / 13 133 ways | ridged plates at crossings; footsteps by smoothness |
| `tourism=viewpoint`, information boards | 29, 132 (history 62) | destinations for the scenic glides |
| `attraction=animal`, schools, kindergartens | 58, 117, 148 | zoo calls; children's voices in school hours |
| `building:levels`, `roof:shape`, `roof:colour` | 52 % / 42 % / 8.6 % of buildings | low: LoD2 and the DOP measure these; levels could seed the storey bands (but see the city's WFS below) |

Caveats: `building:colour` mixes names and hex (normalise); `start_date`
stays at 0.5 % (plan 027 phase 3 remains rejected); OSM `species` is on
351 of 10 854 trees.

### LoD2 CityJSON (33 615 Buildings, 24 143 BuildingParts)

| Information | Fill (Building / Part) | Idea |
|---|---|---|
| `name` (real names; the rest are GML ids) | 1 010 Buildings (3 %), 496 unique | the name when a building is picked |
| `Dachtyp_tdc` (gable, hip, tent, free-form…) | 74 % / 98 % | a finer roof class for the palette and the eave |
| `QualitaetDacherkennung` (0–100) | 76 % / 100 % | gate the DOP roof colour on poorly detected roofs |
| `BauwerkHoehe`, `Art` on structures | 113 (27 chimneys, 14 masts, 32 walls) | chimneys and masts at their height instead of as clay houses |
| ClosureSurface | 43 417 surfaces, drawn as walls | drop them in the bake: fewer triangles, no storey bands on inner walls between parts |
| `storeysAboveGround`, `MittlereTraufHoehe`, … | ≈ 2 % | too sparse |

No address member exists in the files.

### Dresden open data (the city's WFS)

| Layer | Content (spawn tile) | Idea |
|---|---|---|
| `L1261` tree cadastre: **`jalter`** (age, years) | 78.5 % filled, unread | stakes and ties on young trees; a size fallback where height or crown is missing |
| `L1261` `name` (street/site) | 100 % | — (text) |
| `L1544` / `L1545` solar potential, roof / facade faces | 11 775 roof faces, **`kulturdenkmal` on 100 %** (6 206 "ja"), `face_gmlid`, tilt, orientation, irradiation | **the official listed-building flag** — the ledger says the LfD list is reachable only as a WMS; this is a WFS with the flag on every roof face. `face_gmlid` may join to LoD2 directly (check) |
| `L1512` buildings as noise barriers | 2 835 buildings, **`gesch_zahl` (storeys) on 100 %**, height, ALKIS `objekt_id` | real storey bands instead of `storeyHeight(measuredHeight)` |
| `L1514` / `L1511` / `L1518` noise maps (road, tram) | 1 199 polygons, 50 to 75+ dB | the soundscape's city hum at its mapped loudness |
| `L134` addresses | 1 601 points, street + number | the address when a building is picked |
| `L1233` stops | 48 with their lines ("6, 8, 13") | real line numbers on the stop signs |
| Flood extents 1845, 1890, 2002, 2013, 2024; modelled HQ levels; `L1001` flood marks | polygons; 5 marks | an Elbe high-water slider; small plaques at the marks |
| `L34` Naturdenkmale, `L807` valuable trees | 4 + 7, named, crowns 25–32 m | landmark trees at their size |
| `L1557` green roofs | 82 polygons | a green roof tint (cross-check OSM `roof:material`) |
| `L137` Stadtteile, `L569` parks, `L568` playgrounds | 9 / 34 / 7 | quarter for a HUD line or the soundscape; park areas |
| `L1223` Stolpersteine | 73 | the official source for the OSM ones |
| `L1805` biotope types | 114 lines (87 tree rows) | a second source for avenues |

Licence to confirm per layer before a bake (the cadastre is dl-de/by-2-0,
Landeshauptstadt Dresden). The query needs `outputFormat` URL-encoded.

### Wikidata (5 376 items inside the site)

| Group (n) | Coverage |
|---|---|
| Buildings incl. destroyed (2 464) | image 95 %, street 88 %, **OSM way id P10689 73 %**, **heritage P1435 65 %**, Saxon heritage id P1708 62 %, inception 11 %, floors 10 %, architect 5 %, style 3 %, height 11 items |
| Streets (1 136) | **named after (P138) 74 %**, 395 after a dated person |
| Works of art (965), monuments (630) | creator 63 % / 66 %, material 38 % |
| Stolpersteine (331), plaques (372) | commemorates (P547) 157 |
| Destroyed buildings (318) | 74 dated 1945 — **points only, no footprints** |
| Natural monuments / remarkable trees (60) | heritage 66 %, height on 4 |
| Paintings depicting a site item | 111 (20 by Bellotto) |
| Bells | **none** — no bell items, nothing under P527; `soundmarks.py` stays on OSM |

1 208 items have a German Wikipedia article. Statements are CC0; the
Commons images (P18) are not — per-file attribution. The endpoint answers
429 after ~30 quick queries: throttle and cache per tile, as
`fetch_wikidata` does.

### GeoSN products

| Information | Status | Idea |
|---|---|---|
| **ALKIS** (download layer 0: `14612000.xml.zip`, 200.8 MB, 2026-06-30) | downloadable (a ranged GET answered 206) | unblocks ledger 📋 #3 (parcels, surveyed stairs and walls); should carry building use and storeys (unchecked) |
| Laser-scan intensity above 4 m, return number, scan angle | unread | roof/ground material cues (ledger 📋 #12 names the intensity map) |
| DTK10 / P10 (layers 8–16, 18) | unread | the cartographic minimap, ledger 📋 #4 |
| LoD1, DOM2, DGM2 | — | nothing LoD2/DOM1/DGM1 do not do better |
| True orthophotos, facade textures, historical maps, building age | **not offered** by this service | — |

The LSC share for the spawn tile answered 503 again on 2026-09-27; the
ingest falls back to the batch page's share on its own.

### Basis-DLM (unread layers — from the catalogue, unverified)

`veg02_f` VEG (broadleaf/conifer/mixed → the forest's crown mix);
`veg01_f` VEG (grassland/arable/garden); `ver02_l` path widths;
`sie03` towers (51001, named), chimneys and masts (51002), historic
structures (51007); `rel01/rel02` embankments and cliffs (ink lines in
the picture styles); `gew02/gew03` weirs and quay walls, `gew01` flow
direction. Splitting `sie02_f` by OBJART/FKT is already ledger 📋 #12.

## Ranking

Value to the walker against effort, art-direction fit and data quality.
"Identity" items need a picking UI that shows text **on demand** (a card),
never on the ground — check that line with the maintainer first.

| # | Item | Sources | Effort | Why |
|---|---|---|---|---|
| 1 | **Official heritage flag** per LoD2 object | WFS `L1544`, cross-check Wikidata P1435/P1708 | S | replaces the OSM `heritage` join (1 302 objects) with the official list; the column and the shader exist (plan 027 phase 2) |
| 2 | **Real storey count** for the storey bands | WFS `L1512` (or ALKIS) | S–M | 100 % vs ≈ 2 % in LoD2; the bands are derived from height today |
| 3 | **Cheap bake wins in LoD2** | CityJSON | S | drop ClosureSurfaces; `QualitaetDacherkennung` gates the roof colour; chimneys/masts at `BauwerkHoehe` |
| 4 | **Night from `lit`** | OSM | S–M | a whole network lit or dark at night, beyond the 3 064 lamp points; fits the dusk look |
| 5 | **Facade colour and material** | OSM `building:colour`/`material`/`roof:material` | M | the one facade colour source; centre-dense, so blend with the hash; judge on a GPU (risk: "painted-by-numbers") |
| 6 | **Soundscape from measured data** | WFS noise maps, OSM acoustic signals, streams/weirs, `attraction=animal`, schools | M | plan 035 already listens to the scene; these make it measured |
| 7 | **"What am I looking at" card** | LoD2 `name`, Wikidata (via OSM way id), WFS addresses, OSM artwork/`artist_name` | M | a knowledge layer on pick; needs a maintainer decision on text in the HUD |
| 8 | **Tree age and landmark trees** | cadastre `jalter`, WFS `L34`/`L807`, OSM `denotation`, Wikidata | S | young trees staked; natural monuments at their size |
| 9 | **Elbe high water** | WFS flood extents + marks | M | a slider flooding the Elbwiesen to 2002/2013/1845; the water layer exists |
| 10 | **Memory layer** (Stolpersteine, plaques, ghost tracks, destroyed 1945) | OSM, WFS `L1223`, Wikidata | M | quiet ground glints, names on demand; needs careful, respectful design |
| 11 | **ALKIS** | GeoSN layer 0 | L | parcels, surveyed stairs/walls, building use — the bigger official upgrade (ledger 📋 #3) |
| 12 | **Lamp shapes and gas lanterns** | OSM lamp tags | S–M | varied silhouettes; 35 % coverage, so a default shape stays |
| 13 | **Opening hours and outdoor seating** | OSM | M | the shop wash only while open; café tables in summer |
| 14 | **Tram lines on the stop signs / passing trams** | OSM route relations, WFS `L1233` | M–L | the colour of each line; a moving tram is a new kind of object |
| 15 | **Viewpoints** for the glides | OSM `tourism=viewpoint`, Bellotto paintings (placed by hand) | S | authored viewpoints exist; these give more |

**Not worth it** (measured): Wikidata heights, floors, style, architect,
material, 3D models (≤ 10 %); OSM `start_date` (0.5 %) and `roof:colour`
(the DOP already measures roofs); LoD2 storey/eave attributes (≈ 2 %);
the WFS `Baukultur` layer (17 buildings); LoD1, DOM2, DGM2.
