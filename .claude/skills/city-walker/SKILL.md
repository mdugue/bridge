---
name: city-walker
description: Project-specific guide to this 3D city-walker viewer — scene architecture, the shadow recipe and its decision history, terrain/water/vegetation/surface rendering, the EPSG/world coordinate frame, the offline geodata pipeline, and the screenshot QA harness. Use for any non-trivial work on the three.js scene, the data bakes, performance, or visual debugging.
---

# City Walker — rendering, data & QA

Stylized client-side 3D walk through Dresden from Saxon open geodata. Read
`AGENTS.md` first for the high-level map; this skill is the deep reference for
*how it's built*. For *what maps to what* — the source→feature provenance
diagram, the transformation ledger (active / experimental / planned /
**discontinued**), and how to render other locations — see `docs/`
(`docs/README.md`). **When you add, change, or drop a data→feature
transformation, update `docs/transformations.md` + `docs/data-flow.md` as part of
the change** (Definition of Done in `docs/README.md`). `docs/rendering.md` is
the human-readable map of the frame (scene graph, the attribute → visual
codebook, budgets, boot sequence), `docs/data-pipeline.md` the bake/build
reference, and `docs/adr/` the record of *why* the load-bearing choices below
were made — add an ADR when you change one.

## Scene architecture

`app/_components/create-app.ts` is the spine: it builds the renderer, scene, a
`PerspectiveCamera`, a `world` group (Z-up data frame, rotated −90° about X to
Y-up), reads the tileset's extras (CRS, recenter offset, tile bounds), starts
streaming the site and the animation loop, and returns a `CityWalkHandle`
(the imperative API the React HUD calls) once the spawn tile's buildings and
any of its terrain levels are on screen — the first frame. The fixed
lamp-light pool and the fog floor are created before the first frame and
retargeted/lowered as tiles land.

**Streaming** (`tile-stream.ts`, ADR 0024): the build bakes the site into an
OGC 3D Tiles tileset (`lib/city/tileset.ts`): per site tile the buildings
(refine ADD) over the terrain at two levels (a 512² grid, geometric error
40 m, replaced near the camera by an error-bounded TIN of the native DGM,
ADR 0030). Content is glTF (meshopt, quantised,
pre-gzipped `.glb.gz`). 3DTilesRendererJS loads and unloads it by
screen-space error with an LRU cache; the sun's shadow camera is a second
camera, so casters outside the view stay loaded. A dressing plugin builds
what a tile carries in `processTileModel` and frees it in `disposeTile`; the
heavy part (vegetation incl. the street-tree cadastre and the OSM hedges,
lamps, rails on the fine terrain level; its walls
and stairs are baked into the glTF) waits
behind the HUD's gate and is built one tile at a time behind the streaming
chip. Every tile change re-renders the shadow map. The layers:

- `city-layer.ts` — `dressCity` on a building tile: one glTF mesh per tile
  with a per-vertex feature id (`EXT_mesh_features`); the per-object table
  (`EXT_structural_metadata`: tint, heights, roof colour, glow, roughness,
  the demolish tree) is packed into a float texture the clay shader reads
  (`lib/city/city-mesh.ts`). Demolish = drop the object's building tree from
  the index buffer and rebuild the tile's BVH (you can't hide one building
  in a batched mesh). Picking/collision use `three-mesh-bvh` on every loaded
  tile. No CityJSON reaches the browser.
- `terrain-layer.ts` — `dressTerrain` on a terrain tile: the glTF mesh
  gets the land-cover material and hangs the water and mist sheets. The
  fine level is a TIN of the native 1 m DGM1 (±0.15 m,
  `scripts/bake-terrain-tin.ts`; `extras.tin`): `heightAt` reads its
  triangles through a bucket index (`lib/city/terrain-tin.ts` `TinIndex`),
  and the water gets an up-facing normal twin. Nothing is burned into it;
  the wall ribbons in its `walls` node snap to the measured step at bake
  time (`lib/city/wall-snap.ts`, ADR 0030). The coarse level is the 512²
  grid with the wall breaklines burned in (ADR 0014), heights read back
  from its first n·n vertices. Both are shaped under OSM stairs and
  terraces at bake time (`scripts/bake-tiles.ts`, ADR 0028); study and
  numbers in the ledger's "Terrain TIN" entry.
- `landcover-splat.ts` — paints the class raster with the one palette
  (`lib/city/landcover.ts`) into the colour splat on the GPU (ADR 0023).
- `water-layer.ts` — sheets over the terrain geometry, masked by the splat's
  alpha (water coverage), animated normal wobble.
- `vegetation-layer.ts` — InstancedMesh trees (rows + DOM1 canopy + the
  laser-scan extra trees + the cadastre's trunks and broadleaf crowns, passed
  in as precomputed `TreeInstance`s) and DLM hedges, chunked for culling.
  Lives in the **Y-up frame** (a tile's content root), never inside the
  rotated `world` group itself. `tree-inventory-layer.ts` draws only the
  cadastre's reshaped silhouettes (flame / cone / dome) and vetoes canopy
  trees inside its crowns (not in forest/copse); `tile-stream.ts`
  (`buildTileVegetation`) joins both into the tile's one vegetation
  control. `low-vegetation-layer.ts` draws the OSM hedges.
- `shader-chunks.ts` — `DATA_POSITION`: glTF positions are quantised, so
  shaders derive data-frame coordinates from world space.
- `sun-rig.ts` — directional light + shadow camera, sky dome, hemisphere fill,
  fog/atmosphere by time of day.
- `post-stack.ts` — pmndrs `postprocessing`: SSAO, DoF, SMAA, depth grading,
  paper grain, vignette.
- `visual-style.ts` — the one building style: opaque archviz clay + facade
  detail (tint, Boden-Verlauf, Höhenlinien, Traufkante, Streiflicht, dusk
  glow), hash-dithered transparency. The old ghost/standard styles are gone.
- `minimap.tsx`, `city-walk.tsx` (HUD), `poc-debug.ts` (`window.__poc`).

Constants live in the layer files and are the source of truth; values quoted
below may drift — confirm in code.

## Coordinate frame (critical)

Data is EPSG:25833 (UTM33), Z-up. `world` is rotated −90° about X so data-Z
(elevation) → scene-Y. Conversions (`lib/city/ground-clamp.ts`):

```
world.x = epsgX − cx       world.z = −(epsgY − cy)       world.y = elevation
```

`(cx, cy)` = recenter offset from the **spawn** tile's CityJSON loader matrix,
taken at bake time and carried in the tileset's root extras; every tile is
baked against it so they align. The glTF content is Y-up and the renderer's
up-axis turn cancels `world`'s rotation, so a tile's content root is the Y-up
frame. **Trap:** vegetation uses Y-up coords, so it never goes into the
rotated `world` group itself (else the −90° applies twice and trees launch
into the sky). Tiles `33EEE_NNNN_2_sn` (the site's `tileSuffix`, `sites/`);
`33412_5656_2_sn` is the spawn tile.

## Shadows — the recipe and why (this took many rounds)

three **r182 deprecated `PCFSoftShadowMap`**: `WebGLShadowMap` silently swaps it
for `PCFShadowMap`, which is **now soft** — a 5-tap Vogel disk spread by
`shadow.radius * texel` (`node_modules/three/src/.../shadowmap_pars_fragment.glsl`).
Default `radius` is 1 ≈ hard.

Current working setup (`sun-rig.ts` / `create-app.ts`):

| Setting | Value | Why |
|---|---|---|
| `renderer.shadowMap.type` | `PCFShadowMap` | only soft option that doesn't ring (VSM "corduroy"-rings on grazing ground) |
| `shadow.radius` | ~5 | the actual softness knob; hides the texel staircase / fraying |
| `shadow.normalBias` | **0** | a positive normalBias offsets the flat ground sample → bright peter-panning contact strip. Safe at 0 because terrain doesn't cast and solids cast via back faces (lit faces never self-acne) |
| `shadow.bias` | ~−0.0003 | small constant bias, residual cleanup |
| terrain `castShadow` | **false** | a casting terrain self-shadows into triangle/staircase acne at grazing sun; ground only receives |
| shadow map size (`shadowMapSizeFor` in scene-profile.ts) | 3072 | soft radius lets 3072 look like 4096 at ~44% less fill |
| frustum half-size (`lib/city/shadow-fit.ts`) | 110 m at eye level, growing to 880 m with altitude | camera-following, texel-snapped; small = fine texels, but a fixed 110 m leaves a fly-over entirely unshadowed |
| `shadow.autoUpdate` | false | re-render only when the frustum centre leaves a dead zone (18% of the half-size — 20 m at the base, as before), when the half-size re-fits, when the sun moves, or when a caster changes (`invalidateShadows()`, incl. the crown LOD swap) |

### The frustum fit (`lib/city/shadow-fit.ts`)

A fixed 110 m half-size centred on the camera is exactly right at eye level and
useless in fly mode: from 200 m up it covers ground directly below the camera
that is barely on screen, so everything the player looks at falls outside the
shadow camera and renders flat. (That was the reported "no sun shadows when
flying" bug; `shots/` before/after at that snapshot show it plainly.) The rig
therefore re-fits per frame, from two pure functions:

- `fitShadowRadius(heightAboveGround, current)` — half-size = 2.5 × altitude,
  clamped to [110, 880] m and **quantized to octaves with hysteresis** (0.6 in
  log2), so hovering on a step boundary cannot flap the frustum. A flap is a
  full depth-pass re-render, which is the whole cost here.
- `shadowFocusAhead(radius)` — how far along the camera's world direction to
  push the centre: half of the radius *above the base*, so it is **zero at eye
  level** (walking, and turning on the spot, behave exactly as before). Feed it
  the raw `dir.x`/`dir.z`, not a renormalized horizontal: the cos(pitch) factor
  collapses the offset when looking straight down, which is what you want.

The centre is anchored to the **ground** under the camera, not to the camera —
airborne, a camera-centred frustum puts its tight depth range hundreds of metres
above the terrain that should be shadowed. Cost per re-render is unchanged (same
map size, same 5-tap PCF); only the caster set inside the frustum grows. This is
the cheap 90% of CSM: texels coarsen exactly where a far cascade would coarsen
them anyway.

Dead ends (don't repeat): large `normalBias` (peter-panning), VSM at any blur
(rings/grid on lit faces), a bigger frustum *at eye level* (coarser texels →
fraying — the fit is careful to keep the base radius while walking), 4096 map
(cost without visible gain once radius softens). **Open limit:** very long
low-sun shadows still clip beyond the frustum, and the far field at high
altitude is unshadowed — only Cascaded Shadow Maps fix that properly (three has
CSM in examples; sizeable integration, custom-material patching).

## Surfaces (the land-cover splat)

The bake writes only a **4096² class raster** (ids 0–8, `pipeline/bake/landcover.py`).
At runtime `landcover-splat.ts` paints it with the one palette
(`lib/city/landcover.ts`) into an RGBA target: RGB = the pastel class colour,
**A = water coverage** (a 3×3 tent over the water class — the soft
shoreline). The terrain shader samples it `LinearFilter` + mipmaps +
**anisotropy 16** (GPU AA at grazing angles — kills the NEAREST staircase);
water reads the alpha and `smoothstep`s it for a crisp shoreline. Edge
sharpness is bounded by the class raster's resolution, not the GPU filter.
A colour change is a look change, never a re-bake (ADR 0023).

**Ground detail** (`ground-detail.ts`, in the same fragment pass): the
kerb band, lawn edges, parking lanes and the paving rows along a kerb are
drawn at *signed distances in metres* from the baked, smoothed edge raster
(`pipeline/bake/edges.py` → `edges_<tile>.png`, RG, valid to ±6 m). The
class texels alone give that distance only within a texel of the edge and
follow the 0.5 m staircase — a shading-normal "kerb face" from them read as
dashes, and 2–5 m parking lanes from them as arcs. They remain the fallback
(4×4, box-smoothed) where the edge raster is absent. The same bake writes
the kerb lines; the fine terrain glTF stands a real 12 cm **kerb stone** on
them (`lib/city/kerbs.ts`, `kerb-layer.ts`; triangles wound CCW about their
normals — the first cut was clockwise and rendered black). The OSM paving
raster (`surface_<tile>.png`, RGBA: surface ids + parking bits, the bearing,
a per-segment along-street offset — along = offset + (position from the
tile's NW corner)·d, exact per straight piece) picks the pattern; every
pattern length along a street divides `SURFACE_ALONG_PERIOD` (165 m).
Rotating patterns by the bearing about the far data origin made every bend
a shower of arcs — don't. Both rasters are greyscale PNGs 2×/4× wide with
the bytes interleaved, so the viewer's own decoder (`lib/city/png-raster.ts`)
reads them exactly. *Bodendetail* and *Stadtgrün* (urban green painted as
meadow) are the sliders. The contour ink guards `fwidth == 0`.

**Sports grounds** (`sport-ground.ts`, same pass, after the ground
detail): `pipeline/bake/sport.py` writes a table of grounds (frame,
surface, line scheme, shape) and an RGBA index raster (row on top, a
second row grown wider, the exact bit). The fragment evaluates up to eight
candidate rows' *analytic* shapes (rotated rect, a track's capsule band,
else the raster outline) and keeps the deepest — reading one row per texel
sawed teeth into a track's inner edge where the capsule model strays past
the mapped outline. Lines use `spLine`, an exact box filter over the pixel
footprint; keep new lines on it (no `smoothstep` lines — they shimmer).
Goals, posts and nets are dressing (`sport-fixtures.ts`), one merged mesh
per tile, owned by the tile holding the ground's centre.

## Terrain seams

Vertices sit at pixel centres, so a tile stops half a pixel short of its bounds;
abutting tiles of different resolution left a sky-gap "white seam". Fix in
`terrain-geometry.ts` (run by the bake now): snap the border ring to the true tile edge **and** drop a
vertical **skirt** (~30 m) so any residual height-mismatch crack shows terrain,
not sky.

## Vegetation

- Trees = InstancedMesh (trunk + crown), hedges = InstancedMesh boxes. Crown =
  `IcosahedronGeometry(r, 2)` (180 tris) with lobes and radial normals. Three
  tiers per 250 m chunk, planned over the whole site each frame
  (`lib/city/vegetation-lod.ts`, applied by `updateVegetationLod`): the
  **rich multi-tuft crown** (~1 440 tris) near the camera (in 220 m / out
  300 m) but only within a **site-wide budget of 2 500 trees**, nearest
  chunks first — forest tiles (one tree per 7 m, up to ~1 300 per chunk)
  otherwise put ~9 000 rich crowns on screen and lost the WebGL context; the
  mid crown + trunk; and past 650 m (back at 550 m) a detail-1 crown (80
  tris), no trunk, dense chunks thinned to every other tree drawn wider.
  Trunks, mid and rich crowns of a chunk share ONE `instanceMatrix` (and
  the crowns one `instanceColor`) — ~9 MB instead of ~21 MB for a forest
  tile; compute each mesh's bounding sphere after sharing.
- Phones keep only 120–180 MB of out-of-view tile content cached
  (`tileCacheBytesFor`, `lruCache.min/maxBytesSize`): with the library's
  0.3–0.4 GB default, a minimap jump from the start into the Heide kept the
  start area loaded while the forest tiles arrived and Safari killed the
  tab.
- **Chunking:** placements are bucketed into 250 m cells, one InstancedMesh per
  cell (shared geo/material), so off-screen cells frustum-cull from both the
  main and shadow pass. After `setMatrixAt` you **must**
  `instanceMatrix.needsUpdate = true` + `computeBoundingSphere()` or the whole
  cloud is wrongly culled when the world origin is off-screen.
- Canopy from `pipeline/bake/canopy.py`: `nDOM = DOM1 − DGM1`, one tree per ~7 m cell
  at the tallest pixel, scaled to measured height, gated off road/bridge/water
  via the class raster.
- **Tree LOD (shipped):** the three tiers above; a tier change invalidates
  the shadow map (plan 009).
- **Cadastre + laser scan + hedges (all default-on):** the street-tree
  cadastre (`pipeline/bake/trees.py`), the laser-scan trees outside the canopy
  mask (`canopyx`, thinned in the bake against the cadastre within max(4 m,
  crown radius)) and the OSM hedges with their laser-scan height
  (`low-vegetation-layer.ts`, superellipsoid chains, static, chunked) from
  `pipeline/bake/lowveg.py`. The bake's laser-scan-only hedges and shrubs are NOT
  shipped (~30 % crown-rim false positives; `--step lowveg --research` writes them for
  research). Measured lesson: the LSC **multi-echo ratio is a tall-tree cue,
  not a shrub cue** (hedges 26 % vs fences 56 % at ≥ 0.5). Draw-call model:
  `scripts/eval/kataster-cost.ts`. Numbers in `docs/transformations.md`.

### Sandbox crown — what is left to port

Cost = `geometry_tris × instances`, paid twice (shadow pass). Still open:
**dappled canopy shadow** (`customDepthMaterial` + alphaMap in the depth pass;
mind the WebGLShadowMap alphaMap-override gotcha). Radial normals, backlight
shimmer and the LOD-gated multi-tuft crown are in `vegetation-layer.ts`.
`aesthetic-sandbox.html` at the repo root is the historical playground those
were ported from; the layer file, not the sandbox, is the source of truth.

## Performance model

Buildings are already merged (low draw calls) — **BatchedMesh is moot** and
would break objectid picking. The bottleneck is **fill-rate**: post-processing
(SSAO is the priciest) and the shadow-map render — which is why **DoF** is
skipped while the camera moves (`lib/city/regression.ts`). **AO is not**: the
contact shadows blinked on every footstep, so the pass instead runs permanently
at `configuration.halfRes` (depth-aware upsampling) — about what the skip saved,
paid every frame. `halfRes`/`aoSamples`/`denoiseSamples` rebuild n8ao's
materials, so they are construction-time settings; toggling them per frame
trades the flicker for a recompile hitch. Buildings are opaque
clay only; `MeshPhysicalMaterial.transmission` ≈ doubles scene cost, so the
frosted "ghost" style was dropped rather than kept as an option.
`handle.getRenderInfo()`
exposes counters (but with post-processing it reflects only the final pass —
read true scene counts with FX off).

## QA: self-verify on a real GPU

The in-app **Snapshot** panel serializes camera + sun time + look sliders to
JSON; `__poc.handle.getCameraState()` / `applyCameraState()` replay it. To eyeball a
change yourself:

```bash
# drop the snapshot JSON into shots/, then:
bun run shots   # = SHOTS=1 playwright test e2e/snapshot-shot.spec.ts --headed
# writes shots/<name>.png (HUD hidden, real GPU). shots/ is gitignored.
# Before/after pairs: SHOTS_QUERY=scene=lite SHOTS_TAG=x bun run shots
# appends the query to the page URL and writes shots/<name>.x.png.
# Plain `bun run test:e2e` ignores the harness (testIgnore in playwright.config.ts).
```

Headless e2e uses SwiftShader — shadows/AA look nothing like a real GPU, so use
`--headed` for any lighting work. Verify from **oblique** angles (a tree through
a bridge is invisible looking straight down). Snapshot JSON shape:

```json
{ "v": 1,
  "camera": { "mode": "fly", "pos": {"x":0,"y":0,"z":0}, "epsg": {"x":0,"y":0},
              "headingDeg": 0, "pitchDeg": 0, "fov": 55 },
  "date": "2026-06-15T08:30:00.000Z",
  "look": { "transparencyPct":0,"fogPct":35,"gradingPct":50,
            "contactPct":50,"grainPct":25,"dof":true } }
```

### The `lite` scene profile (headless e2e only)

`?scene=lite` (`app/_components/scene-profile.ts`) exists because SwiftShader
shades every pixel on the CPU. It changes four knobs (tiles, shadow map,
render scale, AO quality), all resolved once in `city-walk-client.tsx`
(`currentSceneBudget`) and handed down as numbers:

| Knob | full | lite | Why it is the right knob |
|---|---|---|---|
| tileset streamed | `tileset.json` (every site tile) | **`tileset-spawn.json`** (spawn tile only) | 3/4 of the geometry AND 3/4 of the boot (measured on the old block loader: 14 s → 4.4 s, 74 MB → 18 MB) |
| shadow map size (`shadowMapSizeFor`) | 3072 | **512** | the depth pass is per-frame fill that does *not* shrink with the canvas |
| `pixelRatio` | dpr≤2 | **0.5** | the canvas fills the viewport and the HUD needs ≥768 px to lay out, so render scale is the only honest way to cut fill-rate |
| N8AO quality | Medium | **Performance** | half the AO samples; keyed on the profile, not `navigator.webdriver` (Playwright sets that in the `--headed` shot harness too, which must show the product's AO) |

Everything a spec asserts on — loaders, layer construction, every style's shader
programs, the HUD wiring — is identical in both. **Never** use lite to judge a
render: it is coarse by design; that is what the `--headed` harness above is for.

The specs share one booted page per context (`mode: "serial"` + `beforeAll`),
because boot is the largest fixed cost left once frames are cheap. The
`snapshot-shot.spec.ts` harness deliberately stays on the **full** profile.


## Data pipeline

The site is `SITE` in `.env.local` (ADR 0031); its data is `data/<site>/`.
Bulk raw downloads (DLM, DOM1, DOP, OSM `.osm.pbf`) stay in the gitignored
`data/_raw/<provider>/{dom1,dop,dlm,osm,trees,lsc,downloads}`, shared by the
provider's sites; no Git-LFS. The build sources are the CityJSON **and the
DGM1 GeoTIFF per tile in `data/<site>/{cityjson,dgm}/`** — `prepare-data.ts`
bakes the terrain from it at build time and the canopy/rail bakes read it —
next to the small derived artifacts in `data/<site>/{dlm,dop}/`. Only
`data/dresden/` is committed; another site's folder is a maintainer
decision. `bun run fetch` downloads everything through the provider's
adapter (`pipeline/bake/providers/<id>.py`) and converts the LoD2 CityGML
itself (`citygml.py`); `bun run site` says what is missing.

**Stage 1, the offline bakes** (ADR 0025): one Python package,
`pipeline/bake/`, in a uv environment (numpy, rasterio, pyogrio, shapely,
Pillow, scipy, scikit-image; GDAL inside the wheels, with the OSM driver;
laspy for the laser scan — no PDAL). If a tool is missing,
fix the environment (`pipeline/pyproject.toml`), don't bend the code.
`bun run bake` runs every step for every tile of the site with its extent and
CRS, land cover first:

```bash
bun run fetch                          # download what the site needs (its provider's adapter)
bun run bake                           # every tile, every step
bun run bake 33412_5656_2_sn           # one tile, all steps
bun run bake --step canopy             # one step: landcover|canopy|trees|ndvi|roof-colour|lamps|walls|stairs|rail|surface|lowveg
bun run test:pipeline                  # pytest + ruff
```

Missing DOM1 or DOP skips the canopy, NDVI and roof-colour steps (the
runtime falls back); rail decks fall back to the DGM ramp. All OSM layers come
from the Geofabrik extract — no Overpass.

**Stage 2, the build step** (`bun dev` / `bun run build` → `prepare-data.ts`):
the tileset (`tileset.json`, `tileset-spawn.json`), per tile
`city_<tile>.glb.gz`, `terrain_<tile>_l0|l1.glb.gz`, `footprints_<tile>.json`
and the side files, all content-hashed under `public/data/` with
`manifest.json` as the one no-cache entry. `scripts/tile-glb.ts` owns the
glTF writing (meshopt, quantisation, the feature table); the `.tif` and the
CityJSON are never served. It caches by content in `.cache/prepare-data`.

## Researching three.js releases

GitHub's releases **HTML** page is JS-heavy and reads poorly via WebFetch.
Authoritative: `registry.npmjs.org/three/latest` (version),
`github.com/mrdoob/three.js/releases.atom` (feed),
`raw.githubusercontent.com/wiki/mrdoob/three.js/Migration-Guide.md` (API
changes). Confirm shader/behaviour claims in `node_modules/three/src`.
