# AGENTS.md

Entrypoint for coding agents working on this repo.

## What this project is

A client-side, stylized **3D city walker**: you spawn into a pastel, poetic
rendering of Dresden built from Saxon open geodata and walk (or fly) through it.
Buildings come from LoD2 **CityJSON**, the ground from **DGM1** elevation
rasters (the walked-on level an error-bounded TIN), surfaces
(roads/water/meadow/…) from an **ATKIS Basis-DLM** land-cover class raster
(painted with one palette at runtime), and trees from DLM hedge/tree-rows, a
**DOM1**-derived canopy, the city's **street-tree cadastre** and laser-scan
crowns, plus OSM hedges. The build bakes it all into an
**OGC 3D Tiles** tileset of glTF content that the browser streams with
**3DTilesRendererJS** and renders with **three.js**; there is no backend.

Single-page Next.js app. The 3D scene is imperative three.js code mounted into a
React shell; React owns the HUD/controls, three.js owns the canvas.

## Tech stack

- Next.js (App Router) + TypeScript (strict) + Tailwind v4, run with **bun**
- **three.js r186** (`three`), **`3d-tiles-renderer`** (3DTilesRendererJS —
  streaming, LOD, LRU, glTF metadata), `three-mesh-bvh` (collision/picking),
  `postprocessing` (pmndrs — SSAO, DoF, SMAA, grading, grain, vignette)
- Build step only: `cityjson-threejs-loader`, `geotiff`, `@gltf-transform/*`
  and `meshoptimizer` (the client decodes neither CityJSON nor GeoTIFF; it
  gets glTF)
- **Python in a uv environment** (`pipeline/`: numpy, rasterio, pyogrio,
  shapely, Pillow — GDAL ships inside the wheels) for the offline bakes
- Playwright for e2e + the screenshot harness; `bun test` for the `lib/`,
  `app/_components/` and `scripts/` units
- Deployed as a static client app; no database, no stateful API routes

## Commands

```bash
bun install
bun dev            # prepare-data.ts (geodata -> public/data) then next dev
bun build
bun run verify     # lint + typecheck + unit tests — the pre-push gate
bun lint           # oxlint (rules, type-aware via tsgolint) + oxfmt --check
bun typecheck      # tsc --noEmit (TypeScript 7, the native compiler — the
                   # same one `next build` type-checks with)
bun test           # unit tests in lib/, app/_components/ and scripts/
bun run bake       # offline bakes (pipeline/, Python via uv): raw → data/
                   # [tile] [--ingest] [--step X]; --ingest downloads first
bun run test:pipeline   # pytest + ruff for pipeline/
bun run docs:diagrams   # render docs/ Mermaid blocks to docs/diagrams/*.svg
                   # (Bun.WebView + Chrome; commit the SVGs with the change)
bun test:e2e       # playwright (e2e/) against a production build
E2E_DEV=1 bun test:e2e   # ...against `bun dev` instead, for spec iteration
```

Linting and formatting are **oxlint + oxfmt** (`.oxlintrc.json`, `.oxfmtrc.json`)
— biome/ultracite are gone. `bun lint` runs `oxlint --max-warnings=0` then
`oxfmt --check`; `bun run fix` formats and applies the safe autofixes.
oxlint is **type-aware**: `options.typeAware` in `.oxlintrc.json` hands the
`typescript/*` rules that need type information (`no-floating-promises`,
`no-misused-promises`, `no-unsafe-*`, `no-deprecated`, `switch-exhaustiveness-
check`, …) to `oxlint-tsgolint`, the typescript-go backend, which reads the
same `tsconfig.json` as `tsc`. It adds well under a second here and needs no
flag. The deliberately *unlisted* type-aware rules are `strict-boolean-
expressions`, `no-unnecessary-condition` and `no-confusing-void-expression`:
each reports 40–60 findings on this codebase, nearly all of them the
`if (maybeObject)` / `onClick={() => setX()}` idioms the code uses on purpose.
`--type-check` (tsc diagnostics inside lint) stays off — `bun typecheck` is
the type checker and runs as its own CI job.
Run `bun run fix` before `bun run verify` — there is no format-on-save hook
for Claude Code (it was removed after it reformatted files carrying
merge-conflict markers); Cursor still runs a fix hook after edits via
`.cursor/hooks.json`. A complexity cap of 20 is enforced (`complexity`), so
extract helpers rather than fighting it. No `console.log` in committed code.

**`.oxlintrc.json` names its rules explicitly, on purpose.** oxlint's default is
the `correctness` category alone, which on this repo reports nothing — so the
rules ported from biome (`no-var`, `prefer-const`, `typescript/no-explicit-any`,
`ban-ts-comment`, `no-namespace`, …) and the react/Next.js ones are listed one by
one. Do not "simplify" that to a category: `-D suspicious -D pedantic` adds 411
findings and `-D style` adds 6551, nearly all of them rules that do not fit this
codebase (`react-in-jsx-scope` is obsolete under the modern JSX transform,
`no-inline-comments` fights the commenting style, `max-lines-per-function`
fights the scene-setup functions). Equally, ultracite's own oxlint preset is as
opinionated as its biome one — adopting it wholesale is a style refactor, not a
config change.

## Where things live

- `app/_components/` — the viewer, grouped:
  - spine: `create-app.ts` (scene/loop/handle), `tile-stream.ts` (the
    3DTilesRendererJS setup: gzip + glTF-metadata plugins and the dressing
    plugin that builds and disposes everything a tile carries),
    `city-walk.tsx` (HUD), `city-walk-client.tsx` (the `ssr: false` mount +
    which tileset to stream),
    `poc-debug.ts` (the `window.__poc` test/QA hook), `scene-profile.ts`
    (`?scene=lite`), `webgl-support.ts` (the WebGL2 preflight),
    `fetch-optional.ts` (the one optional-artifact fetch/abort policy)
  - layers: `terrain-layer.ts` (dresses a terrain tile), `landcover-splat.ts`
    (the GPU pass that paints the class raster with the palette),
    `water-layer.ts`, `vegetation-layer.ts` (+ `tree-inventory-layer.ts`,
    the street-tree cadastre's silhouettes, `crown-season.ts`, the
    crowns' autumn colour and bare winter stipple, and
    `low-vegetation-layer.ts`, the OSM hedges), `city-layer.ts` (dresses a
    building tile: clay material, object table, BVH, demolish),
    `ground-detail.ts` (kerb band, lawn edges, paving, parking and urban
    green in the terrain's fragment pass), `sport-ground.ts` (sports
    grounds: surface and lines in the same pass), `sport-fixtures.ts`
    (their goals, posts and nets), `rail-layer.ts`, `wall-layer.ts`,
    `kerb-layer.ts`, `stair-layer.ts` and `fence-layer.ts` (only their
    materials: walls, kerbs, stairs and fences are baked into the fine
    terrain glTF; a fence is one low band in a muted tone — no pattern),
    `lamp-layer.ts`, `monument-layer.ts` (fountains, statues, stones),
    `furniture-layer.ts` (benches, picnic tables, bins, bicycle stands,
    bollards, post boxes, stop shelters and bus-stop signs, advertising
    columns, traffic signals, hydrants, clocks, drinking fountains,
    playgrounds with their mapped equipment),
    `road-markings.ts` (crossings, stop, cycle and centre lines in the
    terrain pass), `cultivated-layer.ts` (allotment beds in the same pass,
    vine rows), `tram-layer.ts` (tracks in their bed, the overhead line,
    stop signs), `riverside-layer.ts` (landing stages, groynes, ferry
    lines) and `map-overlay.ts` (fades the ferry lines in with height),
    `shader-chunks.ts` (data-frame positions from world space)
  - lighting/post: `sun-rig.ts`, `sky-light.ts` (the baked sky-view
    factor on the ambient light, the far horizon on the sun; its raster
    shared by a tile's terrain and buildings through `shared-rasters.ts`),
    `height-fog.ts`, `post-stack.ts`,
    `depth-grading-effect.ts`, `paper-grain-effect.ts`, `visual-style.ts`
    (the look table with its defaults is `lib/city/look-controls.ts`; the
    store the HUD owns and the scene subscribes to is `lib/city/look-state.ts`)
  - input/camera: `camera-pose.ts` (the one owner of where the player
    stands and looks, walk/fly and the scenic glides; every input cancels a
    glide), `fps-movement.ts`, `camera-flight.ts`, `keyboard-controls.ts`,
    `touch-controls.ts`, `collision.ts`, `virtual-joystick.tsx`,
    `altitude-stick.tsx` (the fly-mode climb control opposite it),
    `locate-me.ts` + `locate-button.tsx` ("take me to where I am": GPS
    fix + phone compass → `placeAt`), `live-mode.ts` (opt-in live mode:
    view follows the compass, camera the GPS; offered only while a compass
    reports), `hud-toolbar.tsx` (those tools + walk/fly as one foldable
    labelled group) and
    `device-orientation.ts` (the one orientation-event adapter both use);
    the math is `lib/city/geolocation.ts`
  - HUD widgets: `minimap.tsx`; `three-utils.ts` (dispose helpers)
  - sound: `soundscape-toggle.tsx` (the hidden soundscape's switch — the L
    key; no AudioContext before it) and `soundscape/` (`engine.ts`,
    `hearing.ts`, `voices.ts`: loaded by dynamic import on the first
    toggle, driven from the 10 Hz pose tick, all synthesized)
- `lib/brand.ts` — `SUPPORT_URL`, the Ko-fi link in the HUD footer
  (`scene-sidebar.tsx`): a plain link, never Ko-fi's widget, so nothing
  loads from there until it is clicked
- `lib/city/` — pure, DOM-free logic (terrain geometry, minimap math, CRS,
  ground-clamp, polyline resampling, the pose convention + pitch/FOV
  policy, the look table + store, the Snapshot codec, `terrain-tin.ts`
  (the fine level's TIN + its height index), `wall-snap.ts` (walls onto
  the measured step), `fences.ts` (fence panels and gate gaps),
  `tree-inventory.ts` (the cadastre's archetypes and veto), `tree-season.ts`
  (per-genus leaf-out, autumn and leaf fall), `building-tint.ts` (the
  per-building clay tint, storey height, roof palette), `small-buildings.ts`
  (the scan's sheds as boxes; the canopy points they veto), `markings.ts`,
  `cultivated.ts`, `tram.ts` and `skyview.ts` (the pure halves
  of those layers), `soundscape.ts` and `sound-entry.ts` (the soundscape's
  mix and its boot-side half), `site.ts` (the
  site type, tile ids and extents), `tileset.ts` (the 3D Tiles tree and its
  extras), `landcover.ts` (the classes and the one palette), `sport.ts`
  (the sports grounds' surfaces, line schemes and fixtures), `city-mesh.ts`
  (the per-object table: packing, demolish, footprints), `tile.ts` (each
  tile's side artifacts), and `features.ts` — the GeoJSON shapes the bakes
  write, checked against every committed file by its test) with `bun test`
  units alongside
- `sites/` — one config per place (`dresden.ts`: tiles, CRS, labels,
  attribution, viewpoints); `SITE` picks it at build time (ADR 0026)
- `pipeline/` — the offline bakes, one Python package in a uv environment
  (`bake/landcover.py`, `canopy.py`, `trees.py` (+ `tree_archetypes.py`),
  `lowveg.py` (+ `lsc.py`, the laser scan's rasters), `small_buildings.py`
  (the sheds and garden houses LoD2 lacks, appended to the city mesh),
  `ndvi.py`, `roof_colour.py`,
  `lamps.py`, `monuments.py`, `furniture.py`, `walls.py`, `stairs.py`,
  `rail.py`, `surface.py`, `edges.py`, `sport.py`, `markings.py`,
  `cultivated.py`, `skyview.py`, `osm_buildings.py` (shops and heritage
  per LoD2 object), `tram.py`, `riverside.py`, `soundmarks.py`
  (the bell towers), `osm.py`; `ingest_sn.py` is Saxony's
  download adapter; tests in `pipeline/tests/`), run by `bun run bake`
  (`scripts/bake.ts`) — see ADR 0025
- `scripts/` — the build step: `prepare-data.ts` bakes the committed
  artifacts into `public/data` as a **3D Tiles tileset** (`tileset.json`,
  `tileset-spawn.json`) with glTF content under content-hashed names +
  `manifest.json` — per tile the buildings (`bake-city-mesh.ts` runs the
  CityJSON loader, `bake-tiles.ts` turns it into glTF with a per-object
  property table) and the terrain at two levels (fine: an error-bounded TIN
  of the native DGM, `bake-terrain-tin.ts`, the walls snapped to its
  measured steps; coarse: the DGM resampled to 512², the wall breaklines
  burned in), written by `tile-glb.ts` (meshopt, quantised,
  `EXT_mesh_features` + `EXT_structural_metadata`), pre-gzipped; plus
  `bake.ts` (the pipeline runner), `downsample-raster.ts` (the 2048² class
  raster), `bake-wissen-hero.ts`, `render-diagrams.ts`
- `data/` — committed *derived* geodata; `data/_raw/<site>/` is
  **gitignored** bulk source. `public/data/` is generated, gitignored.
- `app/wissen/` — the knowledge base on the site: `docs/` prerendered as
  pages (`[[...slug]]/page.tsx`, the entry in `_components/landing.tsx`,
  Markdown pipeline in `_lib/markdown.tsx`, the zoom dialog in
  `_components/diagram.tsx`, the typeset preset and diagram tokens in
  `wissen.css`; the prose rules themselves are shadcn/typeset, vendored as
  `app/typeset.css`); `lib/docs/` is its pure core (file → route, link
  rewriting, menu order, diagram keys and theming),
  `scripts/render-diagrams.ts` renders the Mermaid blocks to
  `docs/diagrams/`, and `scripts/bake-wissen-hero.ts` bakes the pages' map
  picture inside `prepare-data.ts` — see ADR 0021
- `e2e/` — `city-walk.spec.ts` (smoke), `wissen.spec.ts` (the docs pages)
  and `snapshot-shot.spec.ts` (QA harness)

The **`city-walker` skill** (`.claude/skills/city-walker/`) is the project's
deep reference — scene architecture, the full shadow recipe + its dead ends,
terrain/vegetation/surfaces, the data pipeline, and the QA harness. Load it for
any non-trivial rendering, data, or perf work. The `.claude/skills/threejs-*`
skills are generic three.js references. There is no `SPEC.md`; these are the
source of truth.

- `docs/` — the **knowledge base**. Start at [docs/README.md](docs/README.md).
  - [rendering.md](docs/rendering.md) (scene graph, the attribute → visual
    codebook, light/post, budgets, boot) and
    [data-pipeline.md](docs/data-pipeline.md) (bakes, build step, artifact
    contracts, sizes, provenance, regeneration) — the developer overviews;
  - [data-flow.md](docs/data-flow.md) (source→feature provenance diagram),
    [transformations.md](docs/transformations.md) (the ledger of every
    built/experimental/planned/**discontinued** transformation),
    [portability.md](docs/portability.md) (rendering other locations with
    more/less data);
  - [adr/](docs/adr/README.md) — architecture decision records: *why* the
    load-bearing choices were made and which alternatives lost;
  - [plans/](docs/plans/README.md) — implementation plans, the backlog and
    the audit history. **Plans live here, not in a root `plans/`**: the
    `improve` skill writes to `plans/` by default — move or point its output
    to `docs/plans/` and reconcile against that README;
  - [guide/](docs/guide/README.md) — user-facing pages in English **and
    German** (how it works, data sources, the data's journey, using the
    viewer, glossary). Written for non-developers; keep both languages in
    sync when a user-visible fact changes.

  Roles: AGENTS.md = orientation, skill = how it's built, `docs/` = what it
  shows, what maps to what, why, and what is next. The site publishes
  `docs/` under `/wissen` (guide) and `/wissen/dev` (the rest): keep writing
  it for GitHub, and run `bun run docs:diagrams` when a Mermaid block
  changes.

## Coordinate system (read before touching geometry)

Source data is **EPSG:25833** for Dresden (ETRS89/UTM33; the site config
allows 25832 too), Z-up. A parent `world` group is rotated −90° about X so
data-Z (elevation) becomes scene-Y (up). Mapping: `x = epsgX − cx`,
`z = −(epsgY − cy)`, `y = elevation`, where `(cx, cy)` is the shared recenter
offset (captured at bake time from the spawn tile's CityJSON, carried in the
tileset's extras, so all tiles align). The glTF content is Y-up; the
renderer's up-axis turn cancels the `world` rotation, so a tile's content
root **is** the Y-up scene frame. **Vegetation and other dressing live in the
Y-up frame, never inside the rotated `world` group itself** — adding Y-up
coords into the rotated group applies the transform twice (trees shoot
skyward). Positions in the glTF are quantised (not metres): shaders that need
data-frame coordinates derive them from world space (`shader-chunks.ts`,
world (x, y, z) = data (x, −z, y)). Tiles are named `33EEE_NNNN_2_sn` (the
site's `tileSuffix`); `33412_5656_2_sn` is the spawn tile. The viewer streams
every tile of the site around the camera; collision, demolish and picking
work on every loaded tile.

## Data pipeline

Bulk raw downloads (DLM ~5 GB, DOM1, DOP, OSM `.osm.pbf`) **must not be
committed** — keep them in `data/_raw/<site>/{dom1,dop,dlm,osm,downloads}`
(gitignored; `bun run bake --ingest` fills it through the site's ingest
adapter). The exception is the **DGM1 GeoTIFF + `.tfw` per tile (~13–15 MB,
`data/dgm/`)** and the CityJSON: committed because `prepare-data.ts` bakes the
terrain and buildings from them at build time and the canopy/rail bakes read
the DGM. No Git-LFS. Only small derived per-tile artifacts
(`data/dlm/*.png|json|geojson`, `data/dop/*.json`) are committed otherwise;
`prepare-data.ts` publishes them to `public/data/` at build. Pipeline notes:

- **The bakes are Python, in their own uv environment** (`pipeline/`,
  `uv.lock`; ADR 0025). numpy, rasterio, pyogrio and shapely are there, and
  GDAL comes inside the wheels (with the OSM driver): fix the environment,
  don't bend the code around a missing tool. `bun run bake` passes each
  tile's extent and CRS from the site config; the steps run land cover
  first (the canopy, lamps and street furniture are gated on it). `bun run test:pipeline` and
  CI's `pipeline` job run pytest + ruff.
- `landcover.py` bakes **only class ids** (4096² 8-bit PNG + legend); the
  colours are `lib/city/landcover.ts`, painted on the GPU at runtime
  (`landcover-splat.ts`, ADR 0023). Changing a colour is not a re-bake.
- `canopy.py` derives canopy points from `nDOM = DOM1 − DGM1` and gates
  them on the class raster so no tree sits on a road, bridge or water.
- `trees.py` bakes Dresden's street-tree cadastre (the ingest adapter
  caches the city's WFS per tile); `lowveg.py` the OSM hedges at their
  laser-scan height and the scan's trees outside the canopy mask, thinned
  against the cadastre. The laser scan (`<raw>/lsc/<tile>.laz`) is placed
  there by `bun run bake --ingest --lsc` (or by hand) and rasterised in
  Python (`lsc.py`, laspy — no PDAL); without it the step is OSM only.
- `monuments.py` takes the monuments (statues, stones, columns, named
  fountains) from the Basis-DLM (`sie03_p`, official names) and the fountain
  basins from OSM `amenity=fountain`; a DLM monument inside an OSM basin
  names that fountain. A monument's form is its measured nDOM patch
  (`relief`, when it stands clear of trees/facades), smoothed at runtime —
  never an invented figure.
- All OSM layers (walls, cliffs, stairs, lamps, street furniture,
  fountains, platforms, bridge structure, paving) come from the site's
  Geofabrik `.osm.pbf` via GDAL's OSM driver — no Overpass. `furniture.py`
  turns a bench without a tagged `direction` towards the nearest highway line.
- Missing DOM1 or DOP skips the canopy, NDVI and roof-colour bakes with a
  note (the runtime falls back); rail decks fall back to the DGM ramp.
- **Every tile carries the same baked files** — `lib/city/tile-data.test.ts`
  fails when one tile has a kind of file another lacks. The runtime treats a
  missing optional artifact as "layer off", so without that test a tile
  added before a new bake step (or a step run on some tiles only) ships
  quietly poorer. After merging a new step, or adding a tile, bake it on
  every tile the test names; a step that finds nothing writes an empty file.
- `prepare-data.ts` downsamples the class raster to 2048² (phones, minimap)
  with NEAREST, so no class ids blend. Nothing whose alpha carries data goes
  through an image resize any more (sharp premultiplies alpha — that once
  painted the ground black). Nor through the browser's image decoder: the
  class and NDVI PNGs are inflated byte-exact by `lib/city/png-raster.ts`
  (WebKit colour-manages untagged greyscale even with
  `colorSpaceConversion: "none"` — on iPhones the ground came out speckled
  with neighbouring classes).
- `prepare-data.ts` caches by content in `.cache/prepare-data` (cold run
  ≈ 20 s); the glTF quantisation, meshopt and gzip settings live in
  `scripts/tile-glb.ts`.

## Rendering gotchas (hard-won — don't relearn these)

**Shadows.** three **r182 deprecated `PCFSoftShadowMap`** — `WebGLShadowMap`
silently downgrades it to `PCFShadowMap`, which is **now itself soft**: it
spreads a 5-tap Vogel disk by `light.shadow.radius * texel`
(`shadowmap_pars_fragment.glsl`). Default `radius` is 1 ≈ hard, so soft shadows
require **explicitly raising `shadow.radius`**. The working recipe (see
`sun-rig.ts`): `PCFShadowMap` + a raised `shadow.radius`; terrain
**`castShadow = false`** (it only receives — a casting terrain self-shadows
into triangle/staircase acne at grazing sun); `normalBias = 0` (it offsets the
flat ground's sample toward the light → the bright peter-panning contact strip;
safe at 0 because terrain doesn't cast and buildings/trees cast via back faces,
so lit faces never self-acne); a small negative `bias`; and a tight,
camera-following frustum on a right-sized map (finer texels = cleaner edges).
**VSM rings** ("corduroy"/grid) on large ground planes at grazing angles — avoid
it here. Past the frustum the ground's shadows come from a baked horizon map (two
bands, ADR 0031); their *shapes* there (and on facades) remain a job for
Cascaded Shadow Maps.

**The shadow frustum is not fixed** (`lib/city/shadow-fit.ts`). A 110 m
half-size is right at eye level and wrong in fly mode: from 200 m up it covers
a patch of ground directly below the camera that is barely on screen, so the
whole view renders unshadowed. The half-size therefore grows with altitude, in
octaves (110 → 880 m) with hysteresis, and the frustum is centred **on the
ground**, pushed along the camera's world direction by a fraction of the extra
radius. At eye level the offset is zero and the behaviour is byte-for-byte the
old one — in particular turning on the spot still never moves the frustum.
Per-render cost is unchanged (same map size, same PCF); only the caster set
grows. This is the cheap 90% of CSM, not a replacement for it.

**Contact shadows (SSAO) are never motion-gated.** Skipping the N8AO pass while
the camera moves made them blink on every footstep, which reads as a bug. The
pass now runs at `configuration.halfRes` with n8ao's depth-aware upsampling —
roughly what the skip used to save, paid every frame instead. `halfRes`,
`aoSamples` and `denoiseSamples` all rebuild the pass's materials (see its
configuration Proxy), so they are **construction-time settings**: a motion-keyed
quality switch there trades a flicker for a shader-recompile hitch. DoF is still
dropped while moving — motion has already destroyed the bokeh.

**Buildings are already batched.** Each tile's buildings are ONE glTF mesh
(`scripts/bake-city-mesh.ts` runs `cityjson-threejs-loader` at build time,
`scripts/bake-tiles.ts` writes it with a per-vertex feature id,
`EXT_mesh_features`), so draw calls are already low and **BatchedMesh would
not help** (and would break feature-id picking/demolish). Per-building data
(tint, heights, roof colour, glow, roughness, the demolish tree) is **one row
per object** in an `EXT_structural_metadata` property table, packed into a
float texture the clay shader reads (`lib/city/city-mesh.ts`) — add a
building attribute there, not as a vertex attribute. The perf bottleneck is
**fill-rate** (post FX + shadow map), not draw calls.

**Tiles come and go.** 3DTilesRendererJS loads and unloads tiles by
screen-space error (`app/_components/tile-stream.ts`; two terrain levels,
the coarse one's geometric error is `COARSE_TERRAIN_ERROR` in
`lib/city/tileset.ts`). Everything a tile brings (dressing, BVH, materials,
textures) is built in the dressing plugin's `processTileModel` and freed in
its `disposeTile` — never in `bootApp`, or it leaks when the tile unloads.
Before a tile or its dressing shows, its shaders are compiled with
`compileAsync` against the scene pass's target (`PostStack.compile`) —
add new per-tile objects inside that path, or they compile inside a frame.
`compileAsync` never reaches a mesh's `customDepthMaterial` (three r186
compiles `object.material` only); `PostStack.compile` compiles those
through stand-ins (`depthMaterialStandIns` in `three-utils.ts`) set up as
the shadow pass sets them, so the shadow pass finds the program cached.
The terrain has no BVH: ground rays march the height function
(`lib/city/ground-ray.ts`) — the coarse grid's vertices, or the fine TIN's
triangles through a bucket index (`lib/city/terrain-tin.ts` `TinIndex`). The glTF extras key is **`tileId`**: the
renderer writes `userData.tile` itself and would overwrite ours. The sun's shadow camera is a second
streaming camera, so tiles that cast into the view stay loaded;
`displayActiveTiles` keeps loaded tiles drawn while turning.

**Vegetation** is chunked into 250 m cells (one InstancedMesh per cell) so
off-screen chunks frustum-cull out of both the main and shadow pass. After
`setMatrixAt`, you **must** call `instanceMatrix.needsUpdate = true` and
`computeBoundingSphere()` or the whole cloud gets wrongly culled when the origin
is off-screen.

**Buildings render in exactly one style: the opaque "clay"** (`visual-style.ts`
— archviz clay plus the facade-detail shader, with hash-dithered transparency).
The earlier "ghost" (`MeshPhysicalMaterial.transmission`) and "standard" (the
loader's raw LoD colours) styles were removed. Keep transmission out of the
scene: it re-renders everything into a buffer each frame (~2× cost).

**The boot has two phases.** `bootApp` returns (and the overlay drops) as
soon as the spawn tile's buildings and any of its terrain levels are on
screen; `startStreaming` then opens the dressing gate, and vegetation,
lamps and rails are built tile by tile behind a HUD chip (stairs, walls,
kerbs and fences are baked into the fine terrain glTF and arrive with it)
(the streaming pill). `onLoaded` flips it to `ready` once the
spawn tile is dressed, the renderer is idle and no dressing is pending.
Anything added to the scene after the first frame must re-render the shadow
map (`invalidateShadows()`, which the stream's change handler does) and
respect disposal, or it shows up as a missing shadow / a leak after a
StrictMode remount. The e2e hook distinguishes `__poc.firstFrame` from
`__poc.ready`; the lite profile streams `tileset-spawn.json` (the spawn tile
only), and `?scene=lite&block=1` streams the whole site in lite to exercise
the streaming headless.

**Verify renders from oblique angles**, not head-on — a tree growing through a
bridge or a misplaced layer is invisible looking straight down.

## QA: self-verify, don't ask for screenshots

There is a **snapshot system**: the in-app Snapshot panel copies the full
camera pose + sun time + look sliders as JSON; `__poc.handle.getCameraState()`
/ `applyCameraState()` replay it and `__poc.look.set()` drives the sliders. To check a visual change on a **real GPU**, drop
a snapshot JSON into `shots/` and run:

```bash
bun run shots
```

It writes a clean canvas plate (HUD hidden) to `shots/<name>.png` — read it and
iterate yourself. `shots/` is gitignored. The default headless e2e uses
SwiftShader, which renders shadows/AA nothing like a real GPU, so use `--headed`
for any lighting/shadow work.

**Budget the e2e specs in frames, not seconds.** Under SwiftShader every pixel
is shaded on the CPU. At the **full** profile this scene costs ~**14 s to boot**
and ~**4 s per frame** at 1280×720 (measured on four cores). Anything that waits
on rendered frames — the control walk uses `waitForFrames` — walks straight into
the per-test timeout if it spends frames carelessly. Playwright runs a single worker on CI for the same reason: parallel
viewer pages halve each other's frame rate.

**The viewer specs therefore run the `lite` scene profile** — `?scene=lite`, see
[`app/_components/scene-profile.ts`](app/_components/scene-profile.ts). It streams
the **spawn tile only** (`tileset-spawn.json`; the full-site boot was
14 s → 4.4 s, 74 MB → 18 MB when this was measured), shadow-maps at
**512²** instead of 3072², renders at **`pixelRatio` 0.5**, and runs the SSAO
pass in its cheaper Performance mode. Same loaders,
same layers, same shader programs — a quarter
of the world and a quarter of the pixels. The knobs it does *not* touch are the
ones a test asserts on. Two rules when you add a spec:

- Drive the viewer at `/?scene=lite`; only the "serves the viewer shell" spec
  uses the bare route, and it never waits for the scene to load.
- Share a booted page across assertions (`test.describe.configure({ mode:
  "serial" })` + a `beforeAll` context) rather than booting per test — the boot
  is the single largest fixed cost left.

Lite is for headless CI, **never for looking at pixels**: for anything visual use
the `--headed` snapshot harness below, at the full profile, on a real GPU.

## Researching three.js releases

The GitHub releases **HTML page is JS-heavy and WebFetch reads it poorly** (and
training data lags). Use authoritative sources: `registry.npmjs.org/three/latest`
for the current version, `github.com/mrdoob/three.js/releases.atom` for the feed,
and `raw.githubusercontent.com/wiki/mrdoob/three.js/Migration-Guide.md` for exact
API changes. Confirm shader/behaviour claims against `node_modules/three/src`.

## Conventions

- TypeScript strict. No `any` without a `// reason:` comment.
- Version pins: exact for the three.js stack (`three`, `@types/three`,
  `postprocessing`, `n8ao`, `three-mesh-bvh`, `cityjson-threejs-loader`,
  `3d-tiles-renderer`) and the glTF build tools (`@gltf-transform/*`,
  `meshoptimizer`), the
  framework trio and the lint/format tools (`oxlint`, `oxlint-tsgolint`,
  `oxfmt` — oxlint declares a `>=` peer range on tsgolint, so bump them
  together); caret for everything else. `suncalc` is
  pinned exactly too — its 2.0 was a units/azimuth-origin break, so a silent
  float would rotate the sun rather than fail. The Bun version comes from
  `packageManager` in `package.json` (CI reads it via `bun-version-file`), and
  `.mcp.json` pins **both** MCP servers (shadcn, next-devtools) to an exact
  version rather than `@latest`. In Claude Code on the web,
  `.claude/hooks/session-start.sh` (registered in `.claude/settings.json`)
  upgrades the container's older Bun to that pin and runs
  `bun install --frozen-lockfile`: `Bun.WebView` (`bun run docs:diagrams`)
  needs Bun ≥ 1.4, and an older Bun rewrites `bun.lock` on install. Bump the
  pin and the hook follows; it does nothing outside the web container.
- **One TypeScript, and it is 7.x (the native compiler).** `bun typecheck` and
  `next build` both run it; there is no second checker. Note what TS 7's npm
  package *is*: a per-platform native binary plus a `tsc` launcher. It ships
  **no `lib/typescript.js`**, so the classic JS compiler API is gone and any
  tool that consumes it (typescript-eslint, the old tsserver) cannot run on it.
  That is why ESLint is no longer here — see below. If you ever need that API
  back, `@typescript/typescript6` is the shim that provides it. The same
  applies to the editor: `.vscode/settings.json` no longer points
  `js/ts.tsdk.path` at `node_modules/typescript/lib`, because there is no
  `tsserver` there any more — let the TypeScript extension supply its own.
- **No ESLint — oxlint replaced it.** typescript-eslint hard-crashes on TS 7
  (`Cannot read properties of undefined (reading 'Cjs')`) and no channel of it,
  canary included, accepts `typescript >=7`. oxlint needs no TypeScript at all
  (it has its own Rust parser), so it cannot hit that wall. Coverage was checked
  rule by rule against the 86 rules `eslint-config-next` had enabled here, and
  all of them are reachable except **one**:
  `@next/next/no-location-assign-relative-destination`, which oxlint has no
  equivalent for (no current exposure — nothing here calls `location.assign`).
  **Careful when auditing oxlint coverage**: `oxlint --print-config` lists only
  the *enabled* rules, and its default is the `correctness` category alone —
  the full catalogue is 653 rules (`oxlint --print-config -D all`). Several
  rules you would expect are present but off by default, which is why
  `.oxlintrc.json` names `react/rules-of-hooks`, `react/display-name`,
  `react/no-unescaped-entities`, `react/jsx-no-comment-textnodes` and
  `import/no-anonymous-default-export` explicitly. Do not re-add ESLint to
  recover a rule without first checking the full catalogue.
- `types/n8ao.d.ts` is a hand-written shim because `n8ao` ships no types. Do
  not add one for `three-mesh-bvh`: the package declares its own `three`
  augmentation (`BufferGeometry.boundsTree`, `Raycaster.firstHitOnly`, and
  `BatchedMesh` on top).
- `tsconfig.json`'s `allowJs: true` is **not** removable — `next build`
  rewrites the file to put it back, which would dirty the tree on every build.
- **Markdown is excluded from oxfmt** (`.oxfmtrc.json`). It rewrites `*em*` to
  `_em_` and, worse, strips the indent from continuation lines inside list
  items, which detaches them from their bullet. Prose here stays hand-wrapped.
- **No CSS linting any more.** biome checked `app/globals.css` (unknown at-rules,
  unknown units, descending specificity); oxlint does not lint CSS at all. oxfmt
  still *formats* it. Accepted knowingly — revisit if oxc ships CSS rules.
- `components/ui/**` is vendored by `shadcn add` — regenerate, never hand-edit.
  Adding a component adds its dependency; removing one should remove it again.
- Class names are joined with `cn` from the **`cn` package** (shadcn's
  replacement for `clsx` + `tailwind-merge`, set up by `shadcn migrate cn`):
  import it as `import { cn } from "cn"`, as the generated components do.
  `lib/utils.ts` only re-exports it for the `utils` alias in
  `components.json`; its test pins the merge behaviour the code relies on.
- Tailwind for styling; components in `app/_components/` (route-private) or
  `components/` (shared, incl. shadcn `components/ui/`).
- **Conventional Commits** (`feat:`, `fix:`, `perf:`, `refactor:`…).
- Commit hygiene: stage specific paths you changed; never sweep up the user's
  unrelated working-tree edits.
- **Keep the knowledge base current.** Adding, altering, or dropping a
  data→feature transformation isn't done until `docs/transformations.md` (with
  the right status, incl. **why** for discontinued), `docs/data-flow.md` and
  the codebook in `docs/rendering.md` reflect it; a decision that constrains
  future work gets an ADR in `docs/adr/`; a new dataset or edition updates the
  guide's data-sources page in **both** languages — see
  [docs/README.md](docs/README.md#keeping-these-docs-current).
- **Attribution is part of the data.** GeoSN products are `dl-de/by-2-0`
  ("Quelle: GeoSN, dl-de/by-2-0"), OSM-derived layers ODbL ("© OpenStreetMap
  contributors"); both credits live in the HUD footer (`scene-sidebar.tsx`) and
  the OSM bakes write an `attribution` member. Keep them when you touch either.

## When in doubt, ask before

- Introducing a backend / stateful API route
- Adding a heavy dependency (map/tiling library, a second renderer)
- Migrating to WebGPURenderer + TSL: proposed in ADR 0027 and staged in
  plan 020 behind a spike on a real GPU; don't start the port before the
  maintainer has the spike's plates and numbers
- Committing raw bulk geodata, or switching on Git-LFS
