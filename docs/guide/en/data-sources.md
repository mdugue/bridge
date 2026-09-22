# Where the data comes from

*Deutsch: [Woher die Daten kommen](../de/data-sources.md)*

Everything in the viewer is derived from **open data**: datasets that a
public authority or a volunteer community publishes for anyone to use.
Nothing was surveyed or drawn by hand for this project. This page lists
each dataset, where it was downloaded, what it is good at, where it falls
short, and under which licence it may be used. The abbreviations are
explained in the [glossary](./glossary.md).

## The providers

**GeoSN** — the *Landesamt für Geobasisinformation Sachsen*, Saxony's state
survey office. It publishes the terrain and surface models, the 3D building
model, the land-use map and the aerial photos as free downloads on its
open-geodata portal, [geodaten.sachsen.de](https://www.geodaten.sachsen.de/).
All of them are cut into the same **2 km × 2 km tiles**, which is why the
viewer thinks in tiles too.

**OpenStreetMap (OSM)** — the world map maintained by volunteers. It fills
gaps the official datasets leave: street lamps, station platforms,
retaining walls with their heights, and what kind of structure a bridge is.

## The datasets at a glance

| Dataset | Plain-English name | Provider | What the viewer uses it for |
|---|---|---|---|
| **DGM1** | Terrain model, 1 m grid | GeoSN | The ground; seating every object on it; bridge abutment heights; the input for tree heights |
| **DOM1** | Surface model, 1 m grid (terrain *plus* everything standing on it) | GeoSN | Tree heights (surface minus terrain); bridge deck heights |
| **LoD2** | 3D building model with roof shapes | GeoSN | Every building's footprint, height, roof shape and attributes |
| **Basis-DLM** | Digital landscape model (the land-use map) | GeoSN | Ground colours, water outlines, hedges and tree rows, railway areas and tracks, bridge outlines |
| **DOP** | Digital orthophoto, 20 cm, with a near-infrared channel | GeoSN | Roof colours; vegetation greenness for tree crowns and meadows |
| **OSM** | OpenStreetMap | Volunteers | Street lamps, station platforms, walls, bridge structure types |

Available from the same portal but **not used yet**: the laser-scan point
cloud (individual tree crowns would come from it), the cadastral parcels
(**ALKIS**), and the topographic base map (**DTK**). The planned section of
the [transformation ledger](../../transformations.md) records what they
could add.

## Dataset by dataset

### DGM1 — the terrain model

- **What it is:** a grid of ground heights, one value per metre, with
  buildings and vegetation removed. Derived from airborne laser scanning.
- **Download:** [Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html),
  one ZIP per 2 km tile containing a GeoTIFF raster, a `.tfw` world file
  and a small `_akt.csv` stating the survey date.
- **Format and size:** GeoTIFF, 2000 × 2000 pixels of 32-bit floats,
  13.6 MB per tile. Heights are metres above sea level in the German height
  system **DHHN2016**; in the start tile they range from 104 m (the Elbe)
  to 124 m.
- **Good at:** the true shape of the ground, including river banks,
  embankments and the terraces of the old town. Precise to a few
  centimetres.
- **Not good at:** anything vertical. A laser-scanned wall is smoothed into
  a ramp about a metre wide, so monumental walls such as the Brühlsche
  Terrasse "disappear" into a gentle bank. Bridges are removed by
  definition (it is a *terrain* model), so a bridge deck taken from this
  model would sink to the river bed. The viewer fixes both by bringing in
  other sources.
- **Special role:** this is the only bulk raw dataset committed to the
  repository, because the build step reads it directly. See
  [From download to browser](./data-journey.md).

### DOM1 — the surface model

- **What it is:** the same 1 m grid, but of the *first surface the laser
  hit*: roofs, tree tops, bridge decks, parked lorries.
- **Download:** the same portal page as the DGM1.
- **Used for:** `DOM1 − DGM1` gives the height of everything standing on the
  ground. Where the land-use map says "forest" or "park", the viewer places
  one tree per 7 m cell at the tallest point, with that height. Bridge decks
  take their height from this model.
- **Not good at:** telling a tree from a building or a bus. That is why tree
  placement is restricted to vegetation classes of the land-use map and
  excluded from roads, rails and water. Small vegetation under 3 m is
  ignored; one metre is too coarse for individual shrubs.
- Only used offline; the raw file is not committed and never reaches the
  browser.

### LoD2 — the 3D building model

- **What it is:** every building as a simple solid with its real footprint,
  measured height and a standardised roof shape (flat, gable, hip, mansard
  and others). *LoD* stands for "level of detail"; LoD2 means "with roof
  shape but without facade detail".
- **Download:** [Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html),
  as **CityGML** per 2 km tile. The project converts the files to
  **CityJSON**, a compact JSON flavour of the same standard, before
  committing them (8–11 MB per tile).
- **What is in it, per building:** footprint and roof polygons; measured
  height; the roof type as a code; the roof pitch; a building function
  code; occasionally the number of storeys; the date the object was
  generated. The four tiles hold about 16,000 objects (buildings and
  building parts).
- **Good at:** silhouettes. Footprints and roof shapes are exact; heights
  are measured from the laser scan.
- **Not good at:** anything below the eaves. There are no windows, doors,
  materials or colours. The building-function attribute is "unspecified"
  for about 86 % of buildings, and the storey count is filled in for only a
  few percent, so the viewer derives storey bands from the measured height
  instead. Since 2021 the product can also contain bridges, walls and
  towers; the downloaded tiles contain only buildings.
- **How current it is:** the model of a tile is dated by its inputs. For
  these tiles the roofs come from the **2016** laser scan, the footprints
  from the 2021 or 2022 Basis-DLM and the ground from the 2016 DGM; the
  model itself was produced in 2023 (western pair) and 2024 (eastern pair).
  The 2025 dates inside the files are export dates, not survey dates.

### Basis-DLM — the landscape model

- **What it is:** the vector map of what covers the ground: roads, paths,
  railways, water, forest, farmland, built-up areas, plus line features
  such as hedges and tree rows. Part of the nationwide **ATKIS** system, so
  the object types are the same in every German state.
- **Download:** [Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html)
  as a statewide Shapefile package of several gigabytes; the project clips
  each tile out of it.
- **Layers the viewer reads:** farmland/meadow, forest, copse and built-up
  areas; road and path centrelines (buffered to their surveyed or typical
  width); railway areas and track lines with track count; water areas and
  streams; hedges and tree rows; bridge centrelines and, where present,
  bridge deck outlines.
- **Good at:** an authoritative, consistent classification with useful
  attributes: road widths, number of tracks, whether a line is electrified,
  bridge names.
- **Not good at:** anything small. Roads are centrelines, not surfaces, and
  have to be widened by rule; railway lines come in short fragments that
  need merging; deck outlines exist mostly for major bridges, so smaller
  road and path bridges are reconstructed from their centreline; there is no
  street furniture and no platforms.

### DOP — the aerial photos

- **What it is:** orthophotos, i.e. aerial photographs rectified so that
  every pixel sits at its true map position. Ground resolution 20 cm. The
  4-channel variant carries **near infrared** in addition to red, green and
  blue.
- **Download:** [DOP download area](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html);
  GeoTIFF per 2 km tile, 10,000 × 10,000 pixels. The project uses the
  RGBI (4-channel) variant.
- **Used for:** the colour of each roof (a robust median over the roof
  footprint, avoiding the edge) and a vegetation-greenness index, **NDVI**,
  computed from the red and infrared channels. Lush vegetation lights up in
  infrared; roofs, roads and water stay dark. The index tints tree crowns
  from dry pale sage to lush deep green and does the same for meadows.
- **Good at:** real colours and real greenness where the photo looks
  straight down.
- **Not good at:** facades (a nadir photo sees roofs only); tall buildings
  lean sideways in the image, so roof footprints are eroded inward before
  sampling; the raw colours read drab and hazy, which the viewer corrects
  with a hue-preserving saturation lift. The tiles were flown on
  **19 March 2024**, a leaf-off spring flight: deciduous trees are bare in
  the image, so the greenness index is low almost everywhere and the
  viewer's crown colouring recentres it on the median rather than reading
  it as an absolute value.

### OpenStreetMap

- **What it is:** the volunteer-built world map, licensed under the
  **ODbL**, which requires the credit "© OpenStreetMap contributors".
- **Downloads:** two routes. Small point queries (street lamps, station
  platforms, the `bridge:structure` tag) go through the **Overpass API** and
  are cached locally so the service is hit once. Walls are read from a
  regional extract of the whole state, downloaded once from
  [Geofabrik](https://download.geofabrik.de/europe/germany/sachsen.html)
  (about 250 MB), which avoids rate limits and makes the result
  reproducible.
- **Used for:** lamp positions (`highway=street_lamp`), station platforms
  (`railway=platform`), retaining walls, city walls and embankments
  (`barrier=*`, `man_made=embankment`) with their `height` tag, and whether
  a bridge is an arch bridge (`bridge:structure`), which decides between
  arches and plain piers under the deck.
- **Good at:** things no official dataset has, with human-readable tags.
- **Not good at:** completeness and consistency. Not every lamp is mapped,
  heights are often missing (the viewer uses defaults per wall type), and
  tags vary from mapper to mapper.

## Dataset editions in use

The exact edition matters when the picture disagrees with reality. GeoSN
publishes, for every tile and product, a currency field ("Stand") through
the download service behind its portal; the values below were read from it
on 2026-09-22 and match the metadata files shipped in the tile ZIPs. The
machine-readable version, with the download link of every file, is
[`data/provenance.json`](../../../data/provenance.json). "Committed" is the
date a file entered the repository; the download happened on or shortly
before it.

| Dataset | Tiles | Edition / survey date (provider's "Stand") | How we know | Committed |
|---|---|---|---|---|
| DGM1 | all four (plus two unused tiles to the east) | **2024-11-30** (southern row), **2024-11-27 and 2024-11-30** (northern row) | the `_akt.csv` in each tile ZIP; GeoSN download service | 2026-06-11 |
| DOM1 | all four | the **same laser flight** as the DGM1: 2024-11-30 / 2024-11-27 and 2024-11-30 | GeoSN download service (DOM1, DGM1 and the point cloud carry identical dates) | derived canopy files 2026-06-12 |
| LoD2 | all four | south-western pair (33410_*): model **2023**, built from the 2016 laser scan, the 2021 Basis-DLM footprints and the 2016 DGM; south-eastern pair (33412_*): model **2024**, from the 2016 laser scan, the 2022 Basis-DLM and the 2016 DGM. The objects were exported 2025-04-26 … 2025-07-07 (`creationDate`) | GeoSN download service; a few older objects still carry `Stand_*` attributes with the same values | 2026-06-11 |
| DOP (RGBI) | all four | flown **2024-03-19** (leaf-off) | GeoSN download service | derived roof colours and NDVI 2026-06-16/17 |
| Basis-DLM | statewide package | the quarterly package current in **June 2026**; the exact release date was not noted and cannot be read from the portal afterwards because the package is replaced under the same file name (the share's file was dated 2026-07-28 when checked) | download page: "updated quarterly"; git history | derived files 2026-06-12, rail and bridge files re-baked 2026-09-18 |
| OSM via Overpass | all four | the live database on the fetch day: 2026-06-12 or earlier (lamps), 2026-06-17 or earlier (platforms, bridge structure) | git history; the cached raw responses carry the exact `timestamp_osm_base` | 2026-06-12 / 2026-06-17 |
| OSM via Geofabrik | statewide extract | the daily extract of 2026-09-18 or shortly before | git history (walls re-baked that day); `osmium fileinfo -e` on the raw file prints the exact timestamp | 2026-09-18 |

Note the **mismatch of dates inside one picture**: the ground and the tree
heights are from late 2024, the building shapes from a 2016 laser scan with
2021/2022 footprints, the roof colours from March 2024, and the lamps and
walls from mid-2026 OpenStreetMap. A building finished in 2023 can have a
2024 roof colour and no 3D shape.

Still to record at the next download: the Basis-DLM package's release date
(read the `Last-Modified` of the ZIP or the metadata inside it) and the
Geofabrik extract's timestamp.

## Where exactly each file came from

GeoSN serves every tile ZIP from public folders on its cloud share; the
portal's download app finds them through a map service that also carries
the "Stand" of each tile. The folders are per product and format:

| Product | Package | Portal page |
|---|---|---|
| DGM1 (GeoTIFF + `.tfw` + `_akt.csv`) | `…/JCcXyifaNdLDnxZ/dgm1_<tile>_tiff.zip` | [Digitale Höhenmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-hoehenmodelle-4851.html) |
| DOM1 (GeoTIFF) | `…/S6wwnFwX7882sZm/dom1_<tile>_tiff.zip` | same page |
| Laser-scan point cloud (LAZ), unused | `…/rqcqdt8QMcLFUvC/lsc_<tile>_laz.zip` | same page |
| LoD2 (CityGML) | `…/GVzwbSyp7Yl7mBD/lod2_<tile>_citygml.zip` | [Digitale 3D-Stadtmodelle](https://www.geodaten.sachsen.de/downloadbereich-digitale-3d-stadtmodelle-4875.html) |
| DOP20 RGBI (GeoTIFF) | `…/sX3GPcdBMGrfXT9/dop20rgbi_<tile>_tiff.zip` | [DOP](https://www.geodaten.sachsen.de/downloadbereich-dop-4826.html) |
| Basis-DLM (Shape, statewide, 1.23 GB) | `…/DtPWngtLEJP8K3k/basisdlm_sn_shape.zip` | [Basis-DLM](https://www.geodaten.sachsen.de/downloadbereich-basis-dlm-4168.html) |

`…` stands for `https://geocloud.landesvermessung.sachsen.de/public.php/dav/files/`.
The folder tokens can rotate; the durable index is the download service
described in [data-pipeline.md](../../data-pipeline.md#provenance), which
lists the current link and "Stand" for any tile. OpenStreetMap data came
from the Overpass API (point queries, cached once) and from the Geofabrik
Saxony extract (`sachsen-latest.osm.pbf`).

## Licences and credits

| Source | Licence | Required credit |
|---|---|---|
| GeoSN datasets (DGM1, DOM1, LoD2, Basis-DLM, DOP) | *Datenlizenz Deutschland – Namensnennung – Version 2.0* (`dl-de/by-2-0`), per GeoSN's [terms of use](https://www.landesvermessung.sachsen.de/allgemeine-nutzungsbedingungen-8954.html) (checked 2026-09-22) | "Quelle: GeoSN, dl-de/by-2-0" |
| OpenStreetMap | *Open Database License* (ODbL) | "© OpenStreetMap contributors" |

The viewer shows both credits in the footer of its settings panel. The
derived lamp and wall files carry the OSM credit inside the file as well.
