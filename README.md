# City Walk — Dresden

A client-side, stylized **3D city walker**: spawn into a pastel rendering of
Dresden built from Saxon open geodata and walk (or fly) through it. Buildings
come from LoD2 **CityJSON**, the ground from **DGM1** elevation rasters,
surfaces (roads, water, meadow, …) from an **ATKIS Basis-DLM** splatmap, and
trees from DLM hedge/tree rows plus a **DOM1**-derived canopy. Everything runs
in the browser with [three.js](https://threejs.org) — one route, no backend, no
database, no accounts, nothing persisted.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- A WebGL2-capable browser

## Quickstart

```bash
bun install
bun dev     # prepares public/data, then serves http://localhost:3000
```

`bun dev` runs `scripts/prepare-data.ts` first; it bakes the committed
per-tile artifacts into `public/data/` — the terrain heightfields from the
DGM GeoTIFFs and the building meshes from the CityJSON — and publishes
everything under content-hashed names with a `manifest.json` (a few seconds
on the first run, nothing on later ones; the bake cache lives in `.cache/`).

Add `?scene=lite` to load the primary tile alone with a small shadow map —
that is what the headless e2e suite uses; it is not how the scene is meant to
look.

## Data

```
data/**  (committed, small, derived)  →  scripts/prepare-data.ts  →  public/data/  (gitignored)
```

The viewer loads a **2 × 2 block** of 2 km tiles: the primary tile
`33412_5656_2_sn` (which you spawn on, collide with and demolish from) plus
three neighbours for context. The list lives in
[`lib/city/tile.ts`](lib/city/tile.ts) — the one place a tile id is written,
read by both the bake script and the client.

Tile id scheme: `<UTM zone 33><easting km>_<northing km>_<edge km>_sn`. The
primary tile spans 412000–414000 E / 5656000–5658000 N in **EPSG:25833**.

Neither the DGM1 GeoTIFF nor the CityJSON is served. `prepare-data.ts`
resamples the DGM into a gzipped centimetre-uint16 heightfield
(`<tile>.heightfield-<n>.json` + `.u16.gz`, primary 1024², neighbours 512²;
see [`lib/city/heightfield.ts`](lib/city/heightfield.ts)) and runs the
CityJSON parser once at build time into a binary building mesh
(`city_<tile>.mesh.json` + `.mesh.bin.gz`;
[`lib/city/city-mesh.ts`](lib/city/city-mesh.ts)), so the browser decodes
neither a raster nor a CityJSON document. Every `/data` file is published
under a content-hashed name and cached as immutable; `manifest.json` maps the
logical names and is the one file that revalidates. The DGM1 GeoTIFFs
themselves are committed under `data/dgm/` (they are the bake input); every
other raw source stays in the gitignored `data/_raw/`.

Requirements for new data:

- CityJSON must declare EPSG:25832 or 25833 in `metadata.referenceSystem`
  ([`lib/city/crs.ts`](lib/city/crs.ts)). Reproject with
  `cjio in.city.json reproject 25833 save out.city.json`.
- The DGM GeoTIFF needs embedded georeferencing or a `.tfw` sidecar. Embed it
  with `gdal_translate -a_srs EPSG:25833 in.tif out.tif`.
- The city's recenter point must fall inside the DGM extent, or startup fails
  loudly rather than placing the city in the void.

Raw bulk downloads (DLM, DOM1, DOP — gigabytes) stay in `data/_raw/`, which is
gitignored; there is no Git-LFS. The bake scripts in `scripts/` regenerate the
committed artifacts from them.

**Provenance.** Sources are the
[Saxon open-geodata portal](https://www.geodaten.sachsen.de/) (*Offene
Geodaten*, mostly *Datenlizenz Deutschland – Zero*) plus OpenStreetMap for
street lamps, retaining walls, station platforms and bridge structure (ODbL) —
see
[docs/portability.md](docs/portability.md#fetching-source-data).
`TODO(maintainer):` record the exact dataset editions, download dates and
per-dataset licences for the committed tiles.

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
| `B` | Insert a building at the prescribed spot |
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

Two design decisions worth knowing: **demolish** is a data-level filter plus a
re-parse of the CityJSON rather than a mesh edit
([`city-layer.ts`](app/_components/city-layer.ts)), and
`cityjson-threejs-loader` is **patched** via [`patches/`](patches) — read the
patch header before bumping it.

## Development

```bash
bun run verify   # lint + typecheck + unit tests — run this before pushing
bun run build
bun run test:e2e # Playwright, against a production build
bun run fix      # ultracite (biome) autofix
```

Unit tests are `bun test` files colocated with the code they cover (`lib/` and
`app/_components/`). The e2e specs drive the viewer through the `window.__poc`
hook ([`poc-debug.ts`](app/_components/poc-debug.ts)), which dev builds expose
automatically and production builds only with `NEXT_PUBLIC_POC_DEBUG=1`;
changing that hook means updating [`e2e/`](e2e).

## Further reading

- [AGENTS.md](AGENTS.md) — orientation: stack, commands, conventions, the
  coordinate frame, and the rendering gotchas worth not relearning.
- [docs/](docs/README.md) — the knowledge base: what maps to what
  ([data-flow](docs/data-flow.md)), every transformation built, shelved or
  rejected ([transformations](docs/transformations.md)), and how to render a
  different location ([portability](docs/portability.md)).
- [plans/README.md](plans/README.md) — the implementation plans and their
  status.
