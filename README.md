# City Walk

A client-side, stylized **3D city walker**: spawn into a pastel rendering of a
German city built from open geodata and walk (or fly) through it — Dresden
first, and any place whose Land publishes the data: Leipzig, Meißen, Grimma,
Hamburg, München, Berlin and Unna are configured. Buildings come from LoD2
**CityGML/CityJSON**, the ground from **DGM1** elevation rasters, surfaces
(roads, water, meadow, …) from the **ATKIS Basis-DLM** (or OpenStreetMap where
the Land does not publish it openly), and trees from hedge/tree rows plus a
canopy derived from the surface model. The build turns it into an
[OGC 3D Tiles](https://www.ogc.org/standard/3dtiles/) tileset of glTF, which
the browser streams with
[3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) and renders
with [three.js](https://threejs.org) — one route, no backend, no database, no
accounts, nothing persisted.

## Prerequisites

- [Bun](https://bun.sh) 1.4+ (the version in `package.json` `packageManager`)
- A WebGL2-capable browser
- For any site other than Dresden, or to re-run the bakes:
  [uv](https://docs.astral.sh/uv/) (it installs the Python and the geo
  libraries in `pipeline/`)

## Quickstart (Dresden)

```bash
bun install
bun dev     # prepares public/data, then serves http://localhost:3000
```

Dresden's data is committed, so that is all. `bun dev` runs
`scripts/prepare-data.ts` first; it bakes the site's data into a 3D Tiles
tileset in `public/data/` — terrain meshes at two levels of detail from the
DGM GeoTIFFs, building meshes with a per-building attribute table from the
CityJSON — and publishes everything under content-hashed names with a
`manifest.json` (about 20 s on the first run, nothing on later ones; the bake
cache lives in `.cache/`).

Add `?scene=lite` to stream the spawn tile alone with a small shadow map —
that is what the headless e2e suite uses; it is not how the scene is meant to
look.

## Another place

```bash
cp .env.example .env.local   # then set SITE=leipzig (or meissen, grimma,
                             # hamburg, muenchen, berlin, unna)
bun run fetch                # downloads the site's data (once; minutes to
                             # an hour — statewide packages are GBs)
bun run bake                 # derives land cover, trees, lamps, … (minutes)
bun dev                      # or: bun run build
bun run site                 # where the site stands, tile by tile
```

`SITE` is read from `.env.local` by every script and by Next; a deployment
sets it in its host's environment instead. Each site is one file in
[`sites/`](sites/) — its tiles (2 km cells, the first is the spawn),
curated viewpoints, and the data **provider** it draws on
([`sites/providers.ts`](sites/providers.ts): CRS, licence and credit, which
products are open). `bun run site --all` lists every site and how much of it
is on disk. Adding a place in a covered Land is one file plus one line in
[`sites/index.ts`](sites/index.ts); see [portability](docs/portability.md).

**Deploying a site** is one hosting project per site (e.g. one Vercel project
each, all from this repo) with `SITE=<id>` and `SITE_URL=https://<id>.walkedby.manuel.fyi`
in its environment and that domain attached. The host builds from git, so the
site's `data/<id>/` must be committed: only Dresden's is by default
(`.gitignore`); un-ignore a site's folder once you decide to ship it — it is
roughly 20–40 MB per 2×2 site ([ADR 0032](docs/adr/0032-sites-providers-and-per-site-data.md)).

## Data

```
provider portals ── bun run fetch ──→ data/_raw/<provider>/   (downloads, gitignored)
                                  └─→ data/<site>/dgm, cityjson  (build sources)
data/_raw + data/<site> ── bun run bake ──→ data/<site>/dlm, dop  (derived, small)
data/<site>/ ── scripts/prepare-data.ts (bun dev/build) ──→ public/data/  (3D Tiles)
```

The fetch step is one adapter per Land in `pipeline/bake/providers/`
(Saxony, NRW, Bavaria, Hamburg, Berlin): it mosaics and clips each
provider's grid to our 2 km tiles, writes the DGM compactly and converts the
LoD2 CityGML to CityJSON with its own converter (no Java, no extra tools).
The bulky downloads — surface model, orthophotos, the statewide Basis-DLM,
the OSM extract — are kept per provider, so sites in one Land share them;
a tile's DGM and LoD2 go straight into `data/<site>/`.

Tile id scheme: `<UTM zone><easting km>_<northing km>_2_<provider>` — Dresden
spawns on `33412_5656_2_sn`, spanning 412000–414000 E / 5656000–5658000 N in
**EPSG:25833**. The viewer streams every tile of the site around the camera —
detailed near, coarse far, unloaded when out of view — and walking, collision
and demolish work on every loaded tile.

Neither the DGM1 GeoTIFF nor the CityJSON is served. `prepare-data.ts`
resamples the DGM into terrain meshes (1024² and 512² grids, with retaining
walls burned in as breaklines) and runs the CityJSON parser once at build
time; both are written as standard glTF (meshopt-compressed, quantised,
buildings with an `EXT_mesh_features` / `EXT_structural_metadata` table) into
a tileset ([`lib/city/tileset.ts`](lib/city/tileset.ts)). Every `/data` file
is published under a content-hashed name and cached as immutable;
`manifest.json` maps the logical names and is the one file that revalidates.

**Provenance.** Each provider's licence and credit line is in
[`sites/providers.ts`](sites/providers.ts) and shows in the HUD footer. For
Dresden: the [Saxon open-geodata portal](https://www.geodaten.sachsen.de/) of
GeoSN (*Datenlizenz Deutschland – Namensnennung 2.0*, "Quelle: GeoSN,
dl-de/by-2-0") plus OpenStreetMap for street lamps, retaining walls, station
platforms and bridge structure (ODbL, "© OpenStreetMap contributors"). Every
dataset — download route, strengths and weaknesses, the editions in use — is
described in the guide [Where the data comes from](docs/guide/en/data-sources.md)
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
