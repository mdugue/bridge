---
name: city-walker
description: Project-specific guide to this 3D city-walker viewer — scene architecture, the shadow recipe and its decision history, terrain/water/vegetation/surface rendering, the EPSG/world coordinate frame, the offline geodata pipeline, and the screenshot QA harness. Use for any non-trivial work on the three.js scene, the data bakes, performance, or visual debugging.
---

# City Walker — rendering, data & QA

Stylized client-side 3D walk through Dresden from Saxon open geodata. Read
`AGENTS.md` first for the high-level map; this skill is the deep reference.

## Scene architecture

`app/_components/create-app.ts` is the spine: it builds the renderer, scene, a
`PerspectiveCamera`, a `world` group (Z-up data frame, rotated −90° about X to
Y-up), loads the tiles, runs the animation loop, and returns a `CityWalkHandle`
(the imperative API the React HUD calls). The layers:

- `city-layer.ts` — wraps `cityjson-threejs-loader`. One **merged** mesh per
  tile (~2000 buildings, per-vertex `objectid`). Demolish = remove the object
  from the in-memory CityJSON and **re-parse** (you can't hide one building).
  Picking/collision use `three-mesh-bvh`.
- `terrain-layer.ts` — DGM1 GeoTIFF → heightfield mesh + the surface splat; also
  builds the water layer. `lib/city/terrain-geometry.ts` is the pure math.
- `water-layer.ts` — clone of terrain geometry, masked by the splat's alpha
  (water coverage), animated normal wobble.
- `vegetation-layer.ts` — InstancedMesh trees (rows + DOM1 canopy) and hedges,
  chunked for culling. Added to the **Y-up `scene`**, not `world`.
- `sun-rig.ts` — directional light + shadow camera, sky dome, hemisphere fill,
  fog/atmosphere by time of day.
- `post-stack.ts` — pmndrs `postprocessing`: SSAO, DoF, SMAA, depth grading,
  paper grain, vignette.
- `visual-style.ts` — clay (opaque, default) / ghost (transmission) / standard.
- `minimap.tsx`, `city-walk.tsx` (HUD), `poc-debug.ts` (`window.__poc`).

Constants live in the layer files and are the source of truth; values quoted
below may drift — confirm in code.

## Coordinate frame (critical)

Data is EPSG:25833 (UTM33), Z-up. `world` is rotated −90° about X so data-Z
(elevation) → scene-Y. Conversions (`lib/city/ground-clamp.ts`):

```
world.x = epsgX − cx       world.z = −(epsgY − cy)       world.y = elevation
```

`(cx, cy)` = recenter offset from the **primary** tile's loader matrix; neighbour
tiles reuse it so they align. **Trap:** vegetation uses Y-up world coords, so it
is added to `scene`, not the rotated `world` (else the −90° applies twice and
trees launch into the sky). Tiles `33EEE_NNNN`; primary `33412_5656_2_sn` + a
2×2 block (collision/demolish primary-only).

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
| terrain `castShadow` | **false** | a casting heightfield self-shadows into triangle/staircase acne at grazing sun; ground only receives |
| `SHADOW_MAP_SIZE` | 3072 | soft radius lets 3072 look like 4096 at ~44% less fill |
| `SHADOW_RADIUS` (frustum half-size) | ~110 m | camera-following, texel-snapped; small = fine texels |
| `shadow.autoUpdate` | false | re-render only when the snapped focus or the sun moves (throttle) |

Dead ends (don't repeat): large `normalBias` (peter-panning), VSM at any blur
(rings/grid on lit faces), bigger frustum (coarser texels → fraying), 4096 map
(cost without visible gain once radius softens). **Open limit:** very long
low-sun shadows clip beyond the 110 m frustum — only Cascaded Shadow Maps fix
that (three has CSM in examples; sizeable integration, custom-material patching).

## Surfaces (splatmap)

`extract-dlm.sh` bakes a **4096² RGBA** PNG: RGB = curated pastel palette per
land-cover class, **A = water coverage**. The terrain shader samples it
`LinearFilter` + mipmaps + **anisotropy 16** (GPU AA at grazing angles — kills
the NEAREST staircase). Water reads the alpha and `smoothstep`s it for a crisp
shoreline. Edge sharpness is bounded by the bake resolution, not the GPU filter
— raise `LANDCOVER_RES` for sharper boundaries.

## Terrain seams

Vertices sit at pixel centres, so a tile stops half a pixel short of its bounds;
abutting tiles of different resolution left a sky-gap "white seam". Fix in
`terrain-geometry.ts`: snap the border ring to the true tile edge **and** drop a
vertical **skirt** (~30 m) so any residual height-mismatch crack shows terrain,
not sky.

## Vegetation

- Trees = InstancedMesh (trunk + crown), hedges = InstancedMesh boxes. Crown is
  `IcosahedronGeometry(r, 1)` (≈80 tris; detail 2 is 320 — too costly ×tens of
  thousands ×shadow pass).
- **Chunking:** placements are bucketed into 250 m cells, one InstancedMesh per
  cell (shared geo/material), so off-screen cells frustum-cull from both the
  main and shadow pass. After `setMatrixAt` you **must**
  `instanceMatrix.needsUpdate = true` + `computeBoundingSphere()` or the whole
  cloud is wrongly culled when the world origin is off-screen.
- Canopy from `extract-canopy.sh`: `nDOM = DOM1 − DGM1`, one tree per ~7 m cell
  at the tallest pixel, scaled to measured height, gated off road/bridge/water
  via the class raster.
- **Tree LOD (planned):** chunking gives per-cell camera distance, so the rich
  crown can be used near the camera and the cheap icosphere far away.

### Porting the sandbox crown (`aesthetic-sandbox.html`) — cost

Cost = `geometry_tris × instances`, paid twice (shadow pass). Cheap, take any
time: **radial normals** (free, build-time normal rewrite — biggest bang/buck),
**backlight shimmer** (one shadow sample; far cheaper than `transmission`),
**dappled canopy shadow** (`customDepthMaterial` + alphaMap in the depth pass).
Expensive, gate behind LOD: the **multi-tuft crown** (core + ~17 merged lobes ≈
**18×** triangles).

## Performance model

Buildings are already merged (low draw calls) — **BatchedMesh is moot** and
would break objectid picking. The bottleneck is **fill-rate**: post-processing
(SSAO is the priciest) and the shadow-map render. `MeshPhysicalMaterial.transmission`
(ghost) ≈ doubles scene cost → default is opaque clay. `handle.getRenderInfo()`
exposes counters (but with post-processing it reflects only the final pass —
read true scene counts with FX off).

## QA: self-verify on a real GPU

The in-app **Snapshot** panel serializes camera + sun time + look sliders to
JSON; `__poc.getCameraState()` / `applyCameraState()` replay it. To eyeball a
change yourself:

```bash
# drop the snapshot JSON into shots/, then:
bunx playwright test e2e/snapshot-shot.spec.ts --headed
# writes shots/<name>.png (HUD hidden, real GPU). shots/ is gitignored.
```

Headless e2e uses SwiftShader — shadows/AA look nothing like a real GPU, so use
`--headed` for any lighting work. Verify from **oblique** angles (a tree through
a bridge is invisible looking straight down). Snapshot JSON shape:

```json
{ "v": 1,
  "camera": { "mode": "fly", "pos": {"x":0,"y":0,"z":0}, "epsg": {"x":0,"y":0},
              "headingDeg": 0, "pitchDeg": 0, "fov": 55 },
  "date": "2026-06-15T08:30:00.000Z",
  "look": { "style":"clay","transparencyPct":0,"fogPct":35,"gradingPct":50,
            "contactPct":50,"grainPct":25,"dof":true } }
```

## Data pipeline

Raw downloads (gitignored `data/_raw/`): no Git-LFS; commit only the small
derived per-tile artifacts in `data/dlm/` and `data/dgm/`. `prepare-data.ts`
copies them to `public/data/` at `bun dev`/`build`. **numpy and `gdal_calc.py`
are unavailable** — do raster math in Python/Pillow (palette mode for speed; mode
`F` for float GeoTIFFs). Regenerate one tile:

```bash
bash scripts/extract-dlm.sh 33412_5656     # splat + class raster + veg rows
bash scripts/extract-canopy.sh 33412_5656  # canopy (needs the class raster first)
bun scripts/prepare-data.ts                # refresh public/data
```

## Researching three.js releases

GitHub's releases **HTML** page is JS-heavy and reads poorly via WebFetch.
Authoritative: `registry.npmjs.org/three/latest` (version),
`github.com/mrdoob/three.js/releases.atom` (feed),
`raw.githubusercontent.com/wiki/mrdoob/three.js/Migration-Guide.md` (API
changes). Confirm shader/behaviour claims in `node_modules/three/src`.
