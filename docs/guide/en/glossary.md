# Glossary

*Deutsch: [Glossar](../de/glossary.md)*

The abbreviations and jargon used in this project, in plain words. Geodata
terms first, then rendering terms, then project terms.

## Geodata

**ALKIS** — *Amtliches Liegenschaftskataster-Informationssystem*, the
official German cadastre: parcels, owners' plots, building functions. The
building attributes in the 3D model (function code, roof type) follow ALKIS
code lists. Parcels themselves are not used yet.

**ATKIS** — *Amtliches Topographisch-Kartographisches Informationssystem*,
the nationwide system of official topographic data. The Basis-DLM is its
most detailed landscape model.

**Basis-DLM** — *Digitales Basis-Landschaftsmodell*: the vector map of what
covers the ground (roads, rails, water, forest, farmland, settlements), with
attributes. Delivered as Shapefiles. The viewer's ground colours, hedges,
railways and bridges come from it.

**CityGML / CityJSON** — two encodings of the same standard for 3D city
models. CityGML is XML and is what the portal ships; CityJSON is a compact
JSON form of it that the project converts to. Both describe buildings as
solids with semantic surfaces (wall, roof, ground).

**CRS / EPSG:25833** — a *coordinate reference system* says what the numbers
in a coordinate mean. EPSG:25833 is "ETRS89 / UTM zone 33 N": metres east
and north of a reference point, covering eastern Germany. All project data
is kept in this system; the viewer's scene units are metres.

**DGM1** — *Digitales Geländemodell*, the terrain model: ground heights on a
1 m grid, with buildings and vegetation removed.

**DHHN2016** — the current German height reference; heights are "metres
above sea level" in this system.

**DOM1** — *Digitales Oberflächenmodell*, the surface model: the first
surface the laser hit, on a 1 m grid — roofs, tree tops, bridge decks.

**DOP / DOP20 / RGBI** — *Digitales Orthophoto*: an aerial photograph
rectified so every pixel sits at its true map position; 20 cm per pixel;
"RGBI" = red, green, blue plus near-infrared channels.

**GDAL / ogr2ogr** — the open-source geodata toolkit the bake scripts use
to clip, reproject, rasterise and convert.

**GeoJSON** — a simple JSON format for points, lines and polygons with
attributes. All small per-tile vector files are GeoJSON.

**GeoTIFF / world file (.tfw)** — a TIFF image that also knows where on
Earth it sits. When the position is not embedded, a small `.tfw` text file
next to it supplies it.

**Geofabrik** — a company that publishes regional OpenStreetMap extracts
for download; the project reads the Saxony extract.

**GeoSN** — *Landesamt für Geobasisinformation Sachsen*, Saxony's state
survey office and the provider of all official datasets used here.

**Land-cover class** — the land-use category of a pixel in the baked class
raster: background, farmland/meadow, forest, copse, built-up, railway,
path, road, water (ids 0–8).

**LoD1 / LoD2** — *level of detail* of a 3D building model: LoD1 is a flat
box per building, LoD2 adds the standardised roof shape. No facade detail
in either.

**nDOM** — *normalisiertes DOM*: surface model minus terrain model, i.e. the
height of things standing on the ground. Computed by the project from DOM1
and DGM1; the portal also offers it on request.

**NDVI** — *Normalized Difference Vegetation Index*: (infrared − red) /
(infrared + red). Healthy vegetation reflects infrared strongly, so the
index is high on lush plants and near zero on roofs, roads and water.

**ODbL** — *Open Database License*, the licence of OpenStreetMap; requires
the credit "© OpenStreetMap contributors".

**dl-de/by-2-0** — *Datenlizenz Deutschland – Namensnennung – Version 2.0*,
the licence of GeoSN's open geodata; requires the credit "Quelle: GeoSN,
dl-de/by-2-0".

**OSM / Overpass** — OpenStreetMap, the volunteer world map, and the
Overpass API, a query service for it.

**.osm.pbf** — the compact binary file format of OpenStreetMap extracts.

**Raster / vector** — a raster is a grid of pixels (the terrain model, the
aerial photo); vector data is points, lines and polygons (buildings,
roads, tree points).

**Shapefile** — an old but ubiquitous vector file format; the Basis-DLM
comes as one file set per object type.

**Tile / Kachel** — a 2 km × 2 km square of the state's tiling scheme. The
name `33412_5656_2_sn` means UTM zone 33, easting 412 km, northing 5656 km
(the south-west corner), 2 km edge, Saxony. The viewer loads a block of
four; the one you spawn on is the *primary* tile.

## Rendering

**three.js** — the JavaScript library that talks to the graphics card
through WebGL; the whole scene is built with it.

**WebGL2** — the browser's interface to the graphics card. Required.

**Mesh / triangle** — everything drawn is triangles. A mesh is a set of
triangles with a material. The buildings of a tile are one mesh; a
"building" is identified per vertex so that one can be demolished.

**Heightfield** — a regular grid of heights; the terrain mesh is built from
it (one vertex per grid cell).

**Splatmap** — a texture that tells the ground shader which colour to use
where. Here: the pastel land-use raster; its transparency channel encodes
water coverage.

**Instancing / InstancedMesh** — drawing thousands of copies of one shape
(trees, lamp posts) in a single draw call, each with its own position and
scale.

**LOD** — *level of detail*: a cheaper version of a shape drawn when it is
far away (the tree crown has two versions).

**Shadow map** — a depth image rendered from the sun's point of view; every
pixel then checks whether it is the closest thing to the sun. Soft edges
come from sampling it several times (PCF).

**SSAO / contact shadows** — *screen-space ambient occlusion*: darkening in
corners, under eaves and where objects meet the ground, computed from the
depth buffer.

**Depth of field (DoF)** — the photographic blur outside the focus
distance; here focused on the crosshair by default.

**Post-processing** — effects applied to the finished image: contact
shadows, depth of field, anti-aliasing (SMAA), depth grading, vignette,
paper grain.

**Fill-rate** — how many pixels per second the graphics card can shade;
the scene's main cost driver, which is why phones render fewer pixels.

**Frustum** — the pyramid of space a camera (or the shadow camera) sees;
things outside it are skipped.

**BVH** — *bounding volume hierarchy*, a search tree over triangles that
makes "what is under the crosshair" and collision checks fast.

**Pixel ratio (DPR)** — how many rendered pixels per screen pixel; lowered
on phones to save fill-rate.

**SwiftShader** — a software renderer used by the headless test browser;
it draws the scene on the CPU, slowly and without the real look.

## Project

**Bake** — any offline or build-time step that turns a heavy input into a
small, ready-to-use artifact.

**Artifact** — one of the prepared files the browser may request; the full
list lives in `lib/city/tile.ts`.

**Manifest** — `public/data/manifest.json`, mapping plain file names to the
fingerprinted names they are served under.

**Content hash** — the eight-character fingerprint in a served file name;
changes whenever the content changes, so caches never serve stale data.

**Lite profile** — `?scene=lite`: one tile, tiny shadow map, half
resolution; for automated tests only.

**Snapshot** — the JSON text that captures camera, date/time and every
slider, used to reproduce a view.

**Scenic view / Aussichtspunkt** — one of the five authored vantages the
camera can glide to.

**Primary tile / neighbour tiles** — the tile you spawn on (full detail,
collision, demolish) and the three around it (backdrop, lower resolution).

**ADR** — *architecture decision record*: a short document stating one
decision, its context and consequences; see [docs/adr](../../adr/README.md).
