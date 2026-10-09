# Sources by city

*Deutsch: [Quellen nach Stadt](../de/sources-by-city.md)*

Every city is drawn the same way, but not every Land publishes the same
data openly. This table shows, for each city and each thing the viewer
draws, where it comes from — and whether that is the best source there
is, the only one, or a stand-in for a better one the Land or city does
not publish. The datasets themselves (downloads, strengths, licences) are
described in [Where the data comes from](./data-sources.md).

| What is drawn | Dresden | Grimma | Hamburg | Leipzig | Meißen | München | Unna | Berlin (configured, not built yet) |
|---|---|---|---|---|---|---|---|---|
| *Land* | *Sachsen* | *Sachsen* | *Hamburg* | *Sachsen* | *Sachsen* | *Bayern* | *Nordrhein-Westfalen* | *Berlin* |
| Surfaces (roads, water, meadow …) | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ |
| Railway tracks | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟢 Basis-DLM | 🟡 OSM ¹ |
| Bridge decks | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟡 OSM + DOM1 ¹ | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟢 Basis-DLM + DOM1 | 🟡 OSM + DOM1 ¹ |
| Street trees (species, crown) | 🟢 tree register | ⚪ — ² | 🟡 tree register ³ | 🟢 tree register | ⚪ — ² | ⚪ — ² | ⚪ — ² | 🟢 tree register |
| Tree rows, hedges | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ |
| Sheds, extra trees, hedge heights | 🟢 laser scan | 🟢 laser scan | ⚪ — ⁴ | 🟢 laser scan | 🟢 laser scan | 🟢 laser scan | 🟢 laser scan | ⚪ — ⁵ |
| Vegetation colour (vigour) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) | 🟡 DOP RGB (GLI) ⁶ | 🟢 DOP (NDVI) | 🟢 DOP (NDVI) |
| Shop windows, facade readings | 🟢 Mapillary | ⚪ — ⁷ | ⚪ — ⁷ | 🟢 Mapillary | ⚪ — ⁷ | ⚪ — ⁷ | ⚪ — ⁷ | ⚪ — ⁷ |
| Monuments, fountains | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟢 Basis-DLM + OSM | 🟡 OSM ¹ |
| Street furniture, lamps, stairs, walls, fences, markings, paving, sports grounds, trams, landing stages | 🔵 OSM + Mapillary | 🔵 OSM | 🔵 OSM | 🔵 OSM | 🔵 OSM | 🔵 OSM | 🔵 OSM | 🔵 OSM |
| Data layer: motor traffic | 🟢 city counts | 🟡 road census ⁸ | 🟢 city counts (main roads) | ⚪ — ⁹ | 🟡 road census ⁸ | ⚪ — ⁹ | 🟡 road census ⁸ | 🟢 city counts |
| Data layer: cycling, live | 🟢 city counters | ⚪ — ¹⁰ | 🟢 city counters | ⚪ — ¹⁰ | ⚪ — ¹⁰ | ⚪ — ¹⁰ | ⚪ — ¹⁰ | ⚪ — ¹⁰ |
| Data layer: trams by timetable | 🟢 GTFS (DELFI) + OSM | ⚪ — ¹¹ | ⚪ — ¹¹ | 🟢 GTFS (DELFI) + OSM | ⚪ — ¹¹ | 🟢 GTFS (DELFI) + OSM | ⚪ — ¹¹ | 🟢 GTFS (DELFI) + OSM |
| 🟢 from the best source | **20** / 22 | **15** / 22 | **11** / 22 | **18** / 22 | **15** / 22 | **15** / 22 | **15** / 22 | **12** / 22 |

## Legend

- 🟢 official or measured — the best source there is
- 🔵 OpenStreetMap — the only source for it (community-mapped, as complete as the city's mappers made it)
- 🟡 a substitute — the better source is missing for this city (the footnote says why)
- ⚪ not drawn — no open source (the footnote says why)

## Why not the best source

1. The Land publishes no open Basis-DLM (the official landscape model), so OpenStreetMap stands in.
2. The city publishes no open street-tree register; its street trees come from the canopy and the laser scan only.
3. The register has no tree heights: each tree's height is taken from the surface model where it stands, else from its crown.
4. The Land publishes no open classified laser scan (Hamburg declined to, citing privacy).
5. The pipeline does not read this Land's laser scan yet (no adapter for it).
6. The open aerial photograph has no infrared band: the vegetation index is computed from its visible colours (the Green Leaf Index), which tells green from grey well but vigour less well.
7. The pipeline has not measured this city's street photos (Mapillary) yet.
8. The city publishes no counts of its own: the road census counts the federal, state and district roads only, both directions together (shown split evenly).
9. No open counts per road section: the city publishes none, and the road census does not reach its centre.
10. No open bicycle counter the browser can read live (counts published yearly, monthly or daily only, or none).
11. The city has no trams.

## The same in every city

These come from the same kind of source everywhere — every Land
publishes them openly, or OpenStreetMap is the one source for them:

- **Terrain**: 🟢 DGM1
- **Buildings**: 🟢 LoD2
- **Bridge arches, trusses, pylons**: 🟢 DOM1 + OSM/Wikidata
- **Tree canopy**: 🟢 DOM1 − DGM1
- **Roof colours**: 🟢 DOP
- **Facade materials**: 🔵 OSM + neighbourhood
- **Towers, chimneys, missing buildings**: 🟢 DOM1 + OSM
- **Landmarks**: 🟢 Wikidata + OSM
- **Sky light, far shadows**: 🟢 DGM1 + LoD2

*This page is generated from the site and provider configurations
(`bun run docs:matrix`, `lib/city/source-matrix.ts`), so it always says
what the pipeline actually reads.*
