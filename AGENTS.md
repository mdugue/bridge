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
- **three.js r186** (`three`), `cityjson-threejs-loader` and `geotiff` (both
  build step only — the client decodes neither CityJSON nor rasters),
  `three-mesh-bvh` (collision/picking), `postprocessing` (pmndrs — SSAO, DoF,
  SMAA, grading, grain, vignette)
- GDAL CLI + Python/Pillow for the offline data pipeline
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
  - spine: `create-app.ts` (scene/loop/handle), `city-walk.tsx` (HUD),
    `city-walk-client.tsx` (the `ssr: false` mount + the tile URLs),
    `poc-debug.ts` (the `window.__poc` test/QA hook), `scene-profile.ts`
    (`?scene=lite`), `webgl-support.ts` (the WebGL2 preflight),
    `fetch-optional.ts` (the one optional-artifact fetch/abort policy)
  - layers: `terrain-layer.ts`, `water-layer.ts`, `vegetation-layer.ts`,
    `city-layer.ts`, `rail-layer.ts`, `wall-layer.ts`, `lamp-layer.ts`,
    `inserted-building.ts`
  - lighting/post: `sun-rig.ts`, `height-fog.ts`, `post-stack.ts`,
    `depth-grading-effect.ts`, `paper-grain-effect.ts`, `visual-style.ts`
    (the look table with its defaults is `lib/city/look-controls.ts`; the
    store the HUD owns and the scene subscribes to is `lib/city/look-state.ts`)
  - input/camera: `camera-pose.ts` (the one owner of where the player
    stands and looks, walk/fly and the scenic glides; every input cancels a
    glide), `fps-movement.ts`, `camera-flight.ts`, `keyboard-controls.ts`,
    `touch-controls.ts`, `collision.ts`, `viewpoints.ts`,
    `virtual-joystick.tsx`
  - HUD widgets: `minimap.tsx`; `three-utils.ts` (dispose helpers)
- `lib/city/` — pure, DOM-free logic (terrain geometry, minimap math, CRS,
  ground-clamp, polyline resampling, the pose convention + pitch/FOV
  policy, the look table + store, the Snapshot codec, the tile artifact
  list, and `features.ts` — the GeoJSON shapes the bakes write, checked
  against every committed file by its test) with `bun test` units alongside
- `scripts/` — the offline data bakes `extract-dlm.sh`, `extract-canopy.sh`,
  `extract-ndvi.sh`, `extract-roof-colour.sh`, `extract-lamps.sh`,
  `extract-walls.sh`, `extract-rail.sh` (+ `ndvi-at-trees.py`, the NDVI
  sampler `extract-ndvi.sh` calls), `bake-city-mesh.ts` and
  `prepare-data.ts` (bakes the committed artifacts into `public/data` under
  content-hashed names + `manifest.json`: each DGM GeoTIFF becomes a gzipped
  uint16 heightfield, each CityJSON a binary building mesh via
  `bake-city-mesh.ts` — see `lib/city/heightfield.ts`)
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

Bulk raw downloads (DLM ~5 GB, DOM1, DOP, OSM `.osm.pbf`) **must not be
committed** — keep them in `data/_raw/` (gitignored). The exception is the
**DGM1 GeoTIFF + `.tfw` per tile (~13–15 MB, `data/dgm/`)**: it is committed
because `prepare-data.ts` bakes the heightfield from it at build time and
`extract-canopy.sh`/`extract-rail.sh` read it. No Git-LFS. Only small derived
per-tile artifacts (`data/dlm/*.png|geojson`, `data/dop/*.json`) are committed
otherwise; `prepare-data.ts` publishes them to `public/data/` at build.
Pipeline notes:

- `extract-dlm.sh` bakes a 4096² class-id PNG + a pastel **RGBA splatmap**
  (RGB = palette, **A = water coverage**). Palette mapping uses PIL **palette
  mode** (fast at 4096²), not a per-pixel loop.
- `extract-canopy.sh` derives canopy points: `nDOM = DOM1 − DGM1`. `gdal_calc.py`
  and **numpy are unavailable**; nDOM is computed directly in Python/Pillow. It
  gates trees on the land-cover class raster so none sit on roads/bridges/water.
- `prepare-data.ts` downsamples the 4096² rasters to the 2048² variants through
  `scripts/downsample-raster.ts`. **sharp premultiplies alpha across `resize`**,
  and on the RGB splat alpha is water coverage, so a plain resize zeroes the
  colour of every land texel (a black ground; the headless e2e cannot see it).
  The helper resizes the colour and the alpha as separate alpha-less images —
  keep it that way, and keep its unit test.

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

**Buildings are already batched.** Each tile's buildings are ONE baked mesh
(`scripts/bake-city-mesh.ts` runs `cityjson-threejs-loader` at build time and
writes a gzipped vertex stream + meta, `lib/city/city-mesh.ts`; per-vertex
`objectid`), so draw calls are already low and **BatchedMesh would not help**
(and would break objectid picking/demolish). The perf bottleneck is **fill-rate** (post FX + shadow map),
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

**The boot has two phases.** `bootApp` returns (and the overlay drops) as
soon as the primary tile's terrain + buildings are on screen; `loadRest`
then streams the primary's vegetation and lamps, the three neighbour tiles,
rails and walls behind a HUD chip (`status.phase === "streaming"`), and
`onLoaded` flips it to `ready`. Anything added to the scene after the first
frame must `invalidateShadows()` and re-check the abort signal
(`ensureAlive()`), or it shows up as a missing shadow / a leak after a
StrictMode remount. The e2e hook distinguishes `__poc.firstFrame` from
`__poc.ready` (= everything loaded); `?scene=lite&block=1` keeps the
neighbours in the lite profile to exercise the streaming headless.

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
[`app/_components/scene-profile.ts`](app/_components/scene-profile.ts). It loads
the **primary tile only** (boot 14 s → 4.4 s, 74 MB → 18 MB), shadow-maps at
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
  `postprocessing`, `n8ao`, `three-mesh-bvh`, `cityjson-threejs-loader`), the
  framework trio and the lint/format tools (`oxlint`, `oxlint-tsgolint`,
  `oxfmt` — oxlint declares a `>=` peer range on tsgolint, so bump them
  together); caret for everything else. `suncalc` is
  pinned exactly too — its 2.0 was a units/azimuth-origin break, so a silent
  float would rotate the sun rather than fail. The Bun version comes from
  `packageManager` in `package.json` (CI reads it via `bun-version-file`), and
  `.mcp.json` pins **both** MCP servers (shadcn, next-devtools) to an exact
  version rather than `@latest`.
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
