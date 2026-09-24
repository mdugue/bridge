# City Walk — Dresden

A client-side, stylized **3D city walker**: spawn into a pastel rendering of
Dresden built from Saxon open geodata and walk (or fly) through it. Buildings
come from LoD2 **CityJSON**, the ground from **DGM1** elevation rasters (as
an error-bounded TIN), surfaces (roads, water, meadow, …) from an **ATKIS
Basis-DLM** land-cover raster, and trees from DLM hedge/tree rows, a
**DOM1**-derived canopy, the city's street-tree register and laser-scan
crowns, plus OSM hedges. The
build turns it into an [OGC 3D Tiles](https://www.ogc.org/standard/3dtiles/)
tileset of glTF, which the browser streams with
[3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) and renders
with [three.js](https://threejs.org) — one route, no backend, no database, no
accounts, nothing persisted.

## Prerequisites

- [Bun](https://bun.sh) 1.4+ (the version in `package.json` `packageManager`)
- A WebGL2-capable browser
- Only to re-run the offline bakes: [uv](https://docs.astral.sh/uv/) (it
  installs the Python and the geo libraries in `pipeline/`)

## Quickstart

```bash
bun install
bun dev     # prepares public/data, then serves http://localhost:3000
```

`bun dev` runs `scripts/prepare-data.ts` first; it bakes the committed
per-tile artifacts into a 3D Tiles tileset in `public/data/` — terrain meshes
at two levels of detail from the DGM GeoTIFFs, building meshes with a
per-building attribute table from the CityJSON — and publishes everything
under content-hashed names with a `manifest.json` (about 20 s on the first
run, nothing on later ones; the bake cache lives in `.cache/`).

Add `?scene=lite` to stream the spawn tile alone with a small shadow map —
that is what the headless e2e suite uses; it is not how the scene is meant to
look.

## Data

```
provider downloads (data/_raw/, gitignored)
   → bun run bake (pipeline/, Python)       → data/**  (committed, small, derived)
   → scripts/prepare-data.ts (bun dev/build) → public/data/  (3D Tiles, gitignored)
```

The place is one **site config**, [`sites/dresden.ts`](sites/dresden.ts):
four 2 km tiles, the CRS, labels, attribution and viewpoints; `SITE` picks it
at build time. You spawn on `33412_5656_2_sn`; the viewer streams every tile
of the site around the camera — detailed near, coarse far, unloaded when out
of view — and walking, collision and demolish work on every loaded tile.

Tile id scheme: `<UTM zone 33><easting km>_<northing km>_<edge km>_sn`. The
spawn tile spans 412000–414000 E / 5656000–5658000 N in **EPSG:25833**.

Neither the DGM1 GeoTIFF nor the CityJSON is served. `prepare-data.ts`
meshes the native DGM as error-bounded TINs (±0.15 m near, ±0.5 m far —
retaining walls are not burned in; their ribbons snap to the measured step)
and runs the CityJSON parser once at build
time; both are written as standard glTF (meshopt-compressed, quantised,
buildings with an `EXT_mesh_features` / `EXT_structural_metadata` table) into
a tileset ([`lib/city/tileset.ts`](lib/city/tileset.ts)). Every `/data` file
is published under a content-hashed name and cached as immutable;
`manifest.json` maps the logical names and is the one file that revalidates.
The DGM1 GeoTIFFs and the CityJSON are committed under `data/` (they are the
build input); every other raw source stays in the gitignored `data/_raw/`.

Requirements for new data:

- CityJSON must declare EPSG:25832 or 25833 in `metadata.referenceSystem`
  ([`lib/city/crs.ts`](lib/city/crs.ts)). Reproject with
  `cjio in.city.json reproject 25833 save out.city.json`.
- The DGM GeoTIFF needs embedded georeferencing or a `.tfw` sidecar. Embed it
  with `gdal_translate -a_srs EPSG:25833 in.tif out.tif`.

Raw bulk downloads (DLM, DOM1, DOP, the OSM extract — gigabytes) stay in
`data/_raw/<site>/`, which is gitignored; there is no Git-LFS. The offline
bakes regenerate the committed artifacts from them — one Python package in
`pipeline/`, run with `bun run bake` (`--ingest` downloads the inputs first;
see [data-pipeline](docs/data-pipeline.md)).

**Provenance.** Sources are the
[Saxon open-geodata portal](https://www.geodaten.sachsen.de/) of GeoSN
(*Datenlizenz Deutschland – Namensnennung 2.0*, credit "Quelle: GeoSN,
dl-de/by-2-0") plus OpenStreetMap for street lamps, retaining walls, station
platforms and bridge structure (ODbL, "© OpenStreetMap contributors"). Every
dataset — download route, strengths and weaknesses, the editions in use and
what is still unrecorded — is described in the guide
[Where the data comes from](docs/guide/en/data-sources.md)
([deutsch](docs/guide/de/data-sources.md)).

## Controls

Desktop:

| Input | Action |
|---|---|
| Drag | Look around |
| `W` `A` `S` `D` | Move (`Shift` sprints) |
| `F` | Toggle walk / fly |
| `Space` / `Shift` | Up / down (fly mode) |
| Scroll | Zoom (field of view) |
| Double-click the ground | Travel there |
| Click the minimap | Teleport there |
| `R` | Demolish the building under the crosshair |
| "Immersive mode" | Pointer lock (`Esc` exits) |

Touch: drag to look, joystick to walk, pinch to zoom, double-tap the ground to
travel, and the button in the corner opens the scene settings.

## Architecture

A React shell owns the HUD; three.js owns the canvas.
[`app/_components/city-walk.tsx`](app/_components/city-walk.tsx) mounts
`createCityWalkApp` ([`create-app.ts`](app/_components/create-app.ts)), which
builds the scene imperatively and returns a **handle of setters** — every HUD
slider calls one. Pure, three-free, unit-tested math lives in
[`lib/city/`](lib/city); the WebGL glue lives in `app/_components/`.

Coordinate frames matter here. Source data is EPSG:25833, Z-up; a parent
`world` group is rotated −90° about X so data-Z (elevation) becomes scene-Y
(up), giving `x = easting − cx`, `z = −(northing − cy)`, `y = elevation`, with
`(cx, cy)` the shared recenter offset ([`lib/city/recenter.ts`](lib/city/recenter.ts),
[`lib/city/ground-clamp.ts`](lib/city/ground-clamp.ts)). The sun goes suncalc →
ENU → world in [`lib/city/sun.ts`](lib/city/sun.ts) — note suncalc 2 reports
degrees with a **north-based** azimuth (1.x used radians measured from south).

Two design decisions worth knowing: **demolish** filters the building's
triangles out of its tile's index buffer and rebuilds the tile's BVH — there
is no CityJSON in the browser to re-parse ([`city-layer.ts`](app/_components/city-layer.ts)), and
`cityjson-threejs-loader` is **patched** via [`patches/`](patches) — read the
patch header before bumping it. The reasoning behind these and the other
load-bearing choices is recorded in [docs/adr](docs/adr/README.md).

## Development

```bash
bun run verify   # lint + typecheck + unit tests — run this before pushing
bun run build
bun run test:e2e # Playwright, against a production build
bun run fix      # oxfmt + oxlint --fix
bun run shots    # real-GPU screenshot plates from shots/*.json (headed)
bun run bake     # offline bakes (needs uv): raw downloads → data/
bun run test:pipeline  # pytest + ruff for pipeline/
```

Unit tests are `bun test` files colocated with the code they cover (`lib/`,
`app/_components/` and `scripts/`); the bakes have their own pytest suite in
`pipeline/tests/`. The e2e specs drive the viewer through the `window.__poc`
hook ([`poc-debug.ts`](app/_components/poc-debug.ts)), which dev builds expose
automatically and production builds only with `NEXT_PUBLIC_POC_DEBUG=1`;
changing that hook means updating [`e2e/`](e2e).

## Further reading

- [docs/guide](docs/guide/README.md) — for users and non-developers, in
  English and German: how it works, where the data comes from, the data's
  journey to the browser, using the viewer, and a glossary.
- [AGENTS.md](AGENTS.md) — orientation: stack, commands, conventions, the
  coordinate frame, and the rendering gotchas worth not relearning.
- [docs/](docs/README.md) — the knowledge base: how data becomes pixels
  ([rendering](docs/rendering.md)), the bakes and the build step
  ([data-pipeline](docs/data-pipeline.md)), what maps to what
  ([data-flow](docs/data-flow.md)), every transformation built, shelved or
  rejected ([transformations](docs/transformations.md)), how to render a
  different location ([portability](docs/portability.md)), the
  [architecture decision records](docs/adr/README.md) and the
  [implementation plans and backlog](docs/plans/README.md).
