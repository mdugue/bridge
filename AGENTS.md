# AGENTS.md

Entrypoint for coding agents working on this repo.

## What this project is

A client-side, stylized **3D city walker**: you spawn into a pastel, poetic
rendering of Dresden built from Saxon open geodata and walk (or fly) through it.
Buildings come from LoD2 **CityJSON**, the ground from **DGM1** elevation
rasters, surfaces (roads/water/meadow/…) from an **ATKIS Basis-DLM** "splatmap",
and trees from DLM hedge/tree-rows plus a **DOM1**-derived canopy. Everything
renders in the browser with **three.js**; there is no backend.

Single-page Next.js app. The 3D scene is imperative three.js code mounted into a
React shell; React owns the HUD/controls, three.js owns the canvas.

## Tech stack

- Next.js (App Router) + TypeScript (strict) + Tailwind v4, run with **bun**
- **three.js r186** (`three`), `cityjson-threejs-loader`, `geotiff` (build step
  only — the client no longer decodes rasters),
  `three-mesh-bvh` (collision/picking), `postprocessing` (pmndrs — SSAO, DoF,
  SMAA, grading, grain, vignette)
- GDAL CLI + Python/Pillow for the offline data pipeline
- Playwright for e2e + the screenshot harness; `bun test` for `lib/` units
- Deployed as a static client app; no database, no stateful API routes

## Commands

```bash
bun install
bun dev            # prepare-data.ts (geodata -> public/data) then next dev
bun build
bun lint           # eslint + ultracite (biome)
bun typecheck      # tsgo --noEmit
bun test           # unit tests in lib/
bun test:e2e       # playwright (e2e/) against a production build
E2E_DEV=1 bun test:e2e   # ...against `bun dev` instead, for spec iteration
```

Lint is **ultracite** (a biome preset) — it auto-formats on save via the hook
and enforces a complexity cap; extract helpers rather than fighting it. No
`console.log` in committed code.

## Where things live

- `app/_components/` — the viewer: `create-app.ts` (scene/loop/handle),
  `terrain-layer.ts`, `water-layer.ts`, `vegetation-layer.ts`, `city-layer.ts`,
  `sun-rig.ts`, `post-stack.ts`, `visual-style.ts`, `minimap.tsx`,
  `city-walk.tsx` (HUD), `poc-debug.ts` (the `window.__poc` test/QA hook)
- `lib/city/` — pure, DOM-free logic (terrain geometry, minimap math, CRS,
  ground-clamp) with `bun test` units alongside
- `scripts/` — `extract-dlm.sh`, `extract-canopy.sh` (offline data bakes) and
  `prepare-data.ts` (copies committed artifacts into `public/data` at build and
  bakes each DGM GeoTIFF into a float32 heightfield — see `lib/city/heightfield.ts`)
- `data/` — committed *derived* geodata; `data/_raw/` is **gitignored** bulk
  source. `public/data/` is generated, gitignored.
- `e2e/` — `city-walk.spec.ts` (smoke) and `snapshot-shot.spec.ts` (QA harness)

The **`city-walker` skill** (`.claude/skills/city-walker/`) is the project's
deep reference — scene architecture, the full shadow recipe + its dead ends,
terrain/vegetation/surfaces, the data pipeline, and the QA harness. Load it for
any non-trivial rendering, data, or perf work. The `.claude/skills/threejs-*`
skills are generic three.js references. There is no `SPEC.md`; these are the
source of truth.

- `docs/` — the **knowledge base** (what maps to what + status + portability):
  [data-flow.md](docs/data-flow.md) (source→feature provenance diagram),
  [transformations.md](docs/transformations.md) (the ledger of every
  built/experimental/planned/**discontinued** transformation), and
  [portability.md](docs/portability.md) (rendering other locations with
  more/less data). Roles: AGENTS.md = orientation, skill = how it's built,
  `docs/` = what maps to what. Start at [docs/README.md](docs/README.md).

## Coordinate system (read before touching geometry)

Source data is **EPSG:25833** (ETRS89/UTM33), Z-up. A parent `world` group is
rotated −90° about X so data-Z (elevation) becomes scene-Y (up). Mapping:
`x = epsgX − cx`, `z = −(epsgY − cy)`, `y = elevation`, where `(cx, cy)` is the
shared recenter offset (captured from the primary tile so all tiles align).
**Vegetation is added to the Y-up `scene`, not the Z-up `world`** — adding Y-up
coords into the rotated group applies the transform twice (trees shoot skyward).
Tiles are named `33EEE_NNNN`; the primary is `33412_5656_2_sn`, loaded with a
2×2 neighbour block for context (collision/demolish stay on the primary tile).

## Data pipeline

Raw downloads (DLM ~5 GB, DOM1/DGM ~100s MB) **must not be committed** — keep
them in `data/_raw/` (gitignored). No Git-LFS. Only small derived per-tile
artifacts (`data/dlm/*.png|geojson`, `data/dgm/…`) are committed; `prepare-data.ts`
copies them to `public/data/` at build. Pipeline notes:

- `extract-dlm.sh` bakes a 4096² class-id PNG + a pastel **RGBA splatmap**
  (RGB = palette, **A = water coverage**). Palette mapping uses PIL **palette
  mode** (fast at 4096²), not a per-pixel loop.
- `extract-canopy.sh` derives canopy points: `nDOM = DOM1 − DGM1`. `gdal_calc.py`
  and **numpy are unavailable**; nDOM is computed directly in Python/Pillow. It
  gates trees on the land-cover class raster so none sit on roads/bridges/water.

## Rendering gotchas (hard-won — don't relearn these)

**Shadows.** three **r182 deprecated `PCFSoftShadowMap`** — `WebGLShadowMap`
silently downgrades it to `PCFShadowMap`, which is **now itself soft**: it
spreads a 5-tap Vogel disk by `light.shadow.radius * texel`
(`shadowmap_pars_fragment.glsl`). Default `radius` is 1 ≈ hard, so soft shadows
require **explicitly raising `shadow.radius`**. The working recipe (see
`sun-rig.ts`): `PCFShadowMap` + a raised `shadow.radius`; terrain
**`castShadow = false`** (it only receives — a casting heightfield self-shadows
into triangle/staircase acne at grazing sun); `normalBias = 0` (it offsets the
flat ground's sample toward the light → the bright peter-panning contact strip;
safe at 0 because terrain doesn't cast and buildings/trees cast via back faces,
so lit faces never self-acne); a small negative `bias`; and a tight,
camera-following frustum on a right-sized map (finer texels = cleaner edges).
**VSM rings** ("corduroy"/grid) on large ground planes at grazing angles — avoid
it here. The remaining limit (very long shadows clipping beyond the frustum at
low sun) is only solvable with Cascaded Shadow Maps.

**Buildings are already batched.** `cityjson-threejs-loader` merges ~2000
buildings into one mesh per tile (per-vertex `objectid`), so draw calls are
already low and **BatchedMesh would not help** (and would break objectid
picking/demolish). The perf bottleneck is **fill-rate** (post FX + shadow map),
not draw calls.

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

**Verify renders from oblique angles**, not head-on — a tree growing through a
bridge or a misplaced layer is invisible looking straight down.

## QA: self-verify, don't ask for screenshots

There is a **snapshot system**: the in-app Snapshot panel copies the full
camera pose + sun time + look sliders as JSON; `__poc.getCameraState()` /
`applyCameraState()` replay it. To check a visual change on a **real GPU**, drop
a snapshot JSON into `shots/` and run:

```bash
bunx playwright test e2e/snapshot-shot.spec.ts --headed
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
[`app/_components/scene-profile.ts`](app/_components/scene-profile.ts). It loads
the **primary tile only** (boot 14 s → 4.4 s, 74 MB → 18 MB), shadow-maps at
**512²** instead of 3072², and renders at **`pixelRatio` 0.5** with a quarter-res
transmission buffer. Same loaders, same layers, same shader programs — a quarter
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
- Tailwind for styling; components in `app/_components/` (route-private) or
  `components/` (shared, incl. shadcn `components/ui/`).
- **Conventional Commits** (`feat:`, `fix:`, `perf:`, `refactor:`…).
- Commit hygiene: stage specific paths you changed; never sweep up the user's
  unrelated working-tree edits.
- **Keep the knowledge base current.** Adding, altering, or dropping a
  data→feature transformation isn't done until `docs/transformations.md` (with
  the right status, incl. **why** for discontinued) and `docs/data-flow.md`
  reflect it — see [docs/README.md](docs/README.md#keeping-these-docs-current).

## When in doubt, ask before

- Introducing a backend / stateful API route
- Adding a heavy dependency (map/tiling library, a second renderer)
- Migrating to WebGPURenderer + TSL (a large move; it is three's strategic
  direction and where advanced soft shadows live, but our post-processing stack
  is WebGL — revisit only if we hit WebGL ceilings)
- Committing raw bulk geodata, or switching on Git-LFS
