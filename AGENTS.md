# AGENTS.md

Entrypoint for coding agents working on this repo. Read this, then load
the skill the task needs (below). Decisions and their reasons are the ADRs
in [docs/adr/](docs/adr/README.md); this file only points at them.

## What this project is

A client-side, stylized **3D city walker**: a pastel, poetic rendering of a
German city built from open geodata, walked, flown or viewed as a drawing
(Modell). Dresden is the reference site; Leipzig, Meißen, Grimma, Hamburg,
München, Berlin and Unna are configured too. One deployment serves every
city whose data is present at build time under its own route (`/dresden`);
`/` lists them; `/wissen` publishes `docs/`.

The build bakes each city's LoD2 CityJSON, DGM1 and derived layers into an
**OGC 3D Tiles** tileset of glTF; the browser streams it with
**3DTilesRendererJS** and renders it with **three.js on WebGPURenderer**
and TSL node materials. No database, no accounts (ADR 0001). React owns the
HUD, three.js the canvas (ADR 0002).

## Commands

```bash
bun install
bun dev                 # prepare every ready site's data, then next dev
bun run build           # the same, then next build
bun run verify          # lint + typecheck + unit tests — the pre-push gate
bun run fix             # format + safe autofixes; run before verify
bun lint                # oxlint (type-aware) + oxfmt --check
bun typecheck           # bun check; bun run typecheck:tsc is the reference
bun run test            # units in lib/, app/_components/, scripts/
                        # (a bare `bun test` also loads e2e/)
bun run test:e2e        # playwright against a production build
                        # (E2E_DEV=1: against bun dev)
bun run shots           # real-GPU plates of shots/*.json (headed)
bun run site <site>     # where a site stands (--all: every site)
bun run fetch <site>    # downloads → data/_raw/<provider>/, sources → data/<site>/
bun run bake <site>     # offline bakes [tile…] [--step X] [--jobs N] [--force]
bun run osm-coverage <site>  # OSM's built things no bake decided about
bun run test:pipeline   # pytest + ruff for pipeline/
bun run docs:diagrams   # render docs/ Mermaid blocks to docs/diagrams/*.svg
bun run docs:matrix     # regenerate the guide's sources-by-city pages
bun scripts/stadtwissen.ts <site> such|nah|…  # search what the twin knows
bun scripts/walks.ts <site> check             # check a written walk (docs/walks.md)
```

## Skills

- **`city-walker`** — how the scene, the shadows, the ground, vegetation,
  the pipeline and the QA harness are built. Load it for any non-trivial
  rendering, data or performance work.
- **`new-scene-layer`**, **`new-bake-step`**, **`add-city`** — the
  checklists for the three most common additions.
- **`docs-upkeep`** — what a change must update in `docs/`, how to write an
  ADR.
- **`pr-snapshots`** — the snapshots a visual PR carries.
- **`flicker-probe`** — find and prove flicker by diffing held frames.
- **`sentry-triage`**, **`open-data-watch`**, **`osm-gaps`**,
  **`model-faults`** — the scheduled routines ([docs/routines.md](docs/routines.md)):
  each reports to its GitHub issue and never merges, resolves or edits a
  third party's data.
- `threejs-*` are generic three.js references; in this repo only their
  WebGPU/TSL parts apply.
- `improve` writes plans to a root `plans/` by default: point it at
  `docs/plans/` and reconcile with that README.
- `domain-modeling`, `codebase-design`, `grilling` and
  `improve-codebase-architecture` are generic; an ADR they call for is
  written the way `docs-upkeep` and `docs/adr/README.md` say (numbered
  from main's `docs/adr/`, a superseded one deleted), not in their own
  format.

## Hard rules

Breaking one of these breaks something that tests may not catch.

**Frame.** Data stays in the provider's UTM (25833 Saxony and Berlin,
25832 Hamburg, Bavaria, NRW). `x = E − cx`, `z = −(N − cy)`, `y` = height;
a −90° X-rotated `world` group turns data-Z up, and tile content is Y-up.
Dressing lives in the Y-up frame, **never inside the rotated group**. glTF
positions are quantised: shaders derive data-frame coordinates from world
space (`shader-chunks.ts`). The glTF extras key is `tileId`, never `tile`
(the renderer writes `userData.tile` itself). See ADR 0005.

**Rendering** (ADR 0027; details in the `city-walker` skill):

- Node materials on public API only: no GLSL, `onBeforeCompile`,
  `ShaderMaterial`, prototype patches or `_` members. Import from
  `three/webgpu`, `three/tsl`, `three/addons`; `lib/` keeps `three` for math.
- A fixed look strength is a named constant node; anything that moves is a
  shared uniform's `.value`. Fog is `scene.fogNode` only.
- Never `InstancedMesh`: use `Instances` (`drawCount`, `instanceTints`).
  A material without per-tile data is a `sceneMaterial`.
- WebGPU draws from at most **eight vertex buffers**, and the clay is
  **two inter-stage variables short** of sixteen. Past either a mesh
  vanishes on WebGPU while WebGL2 (the headless e2e) still draws it.
- A TSL `select` and a `Loop` body are scopes: in per-pixel graphs use
  `mix`/`step`, and take what a loop reads into a `toVar()` before it.
  A packed word or a hash seed reaches the fragment as a FLAT varying.
- Every `compileAsync` runs in its turn (`compileInTurn`), and a frame
  names the targets it draws into — workarounds for three r187 bugs
  (`docs/rendering.md`, "Workarounds for upstream bugs"). Builds are per
  kind of camera: Modell's parallel camera has its own
  (`PostStack.warmView`).
- Everything a tile brings is built in the dressing plugin's
  `processTileModel`, compiled before it shows, and freed in `disposeTile`
  — never in `bootApp`. Freeing is on us; what a tile adds beyond its glTF
  reaches `calculateBytesUsed`; the rules for shared buffers and dropped
  CPU copies are in the `city-walker` skill, "Tiles".
- Nothing reads a building tile's CPU positions or index while
  `bvhBuilding` says so; rays against buildings go through
  `nearestCityHit`, `cityObjectsAlong` or the collider.
- Anything added after the first frame calls `invalidateShadows()`.
  Animated geometry never reaches the shadow map (ADR 0009).
- Buildings are one opaque clay; no `transmission` in the scene. Picture
  styles are a post pass (ADR 0010, 0034).
- A post pass reads the camera through `view-lens.ts`; a direction comes
  from `viewDirection()`, a pick ray from `setPickRay` (ADR 0044).
- The depth buffer runs reversed (1 near, 0 far): read depth through
  three's helpers or the lens; raw depth asks `reversedDepthBuffer`.
- A new streaming need registers against the stream's twin camera, not the
  camera (ADR 0024). Nothing sets `camera.position` outside
  `camera-pose.ts` (ADR 0032).
- **A phone's memory must not grow with a change** (ADR 0047).

**Ground and lines.** Every part that stands on the ground uses
`lib/city/ground-join.ts` and reports its `joins` (ADR 0030). A rail or
tram line takes its level and profile from the build (`lineLevelsAt`,
ADR 0041).

**Data.**

- Raw downloads (`data/_raw/`) are never committed; no Git-LFS.
- Every tile carries the same baked files (`lib/city/tile-data.test.ts`);
  a step that finds nothing writes an empty file.
- Each artifact's bake entries are one table, `scripts/bake-entries.ts`;
  a module an artifact needs must be one of them or imported from one, or
  its cache goes stale (`bake-entries.test.ts` holds every module
  `prepare-data.ts` imports to being in some bake's key or excused; which
  artifact needs it is yours to get right). `prepare-data.ts` is in no
  key: a bake lives in its step's module in `scripts/prepare/`, never there.
- A file a bake writes and TypeScript reads has one zod schema in
  `lib/city/<name>-file.ts` (ADR 0059): readers take its types and
  `parseBakeFile`, never `readJson(…) as T`; the build fails on a
  mismatch; `bake-files.test.ts` parses every committed file. The
  viewer imports a schema module by type only.
- Nothing whose alpha or values carry data goes through an image resize or
  the browser's image decoder; class rasters are NEAREST and decoded by
  `lib/city/png-raster.ts`.
- OSM only from the local extract, never Overpass; a bake reads the network
  only at fetch time (ADR 0012).
- No per-site look switch: derive it from the city's data (ADR 0012).
- Attribution is part of the data: keep the credits in the HUD footer, the
  `attribution` members, the guide's licence table and `NOTICE`.

**Privacy.** A new request to a third party, a new report field or a new
browser-storage key is not done until `app/(legal)/datenschutz/page.mdx`
says so (ADR 0043). A visitor's design is read in the page and never
uploaded; nothing it names is fetched (ADR 0054).

## QA: self-verify, don't ask for screenshots

- A PR that changes what the viewer shows carries JSON snapshots in its
  description (`pr-snapshots` skill).
- Visual work is judged on a real GPU: drop a snapshot JSON into `shots/`
  and run `bun run shots`; read the plate and iterate. Verify from oblique
  angles, not head-on.
- URL knobs: `?scene=lite`, `?gpu=webgl2`, `?safety=0…3`, `?trail=1`,
  `?trace=1`, `?inspect=1`, `?depth=standard`, `#at=lat,lng`.

## Conventions

- TypeScript strict; no `any` without a `// reason:` comment; no
  `console.log`; complexity cap 20 — extract helpers.
- Each file's head comment says what it does.
- `FRAG_FAKE=1` is a scripted model for local tests, never set on a
  deployment (ADR 0056).
- **oxlint + oxfmt, no ESLint, no biome.** `oxlint.config.ts` extends
  ultracite's core, react and next presets, and each rule it changes says
  why there. No `oxlint-disable` comment: change the code, or the config
  with its reason. `--type-check` stays off.
  typescript-eslint cannot run on TypeScript 7; check oxlint's full catalogue
  (`oxlint --print-config -D all`) before reaching for ESLint. Markdown and
  MDX are excluded from oxfmt; prose stays hand-wrapped.
- **One TypeScript, 7.x native.** `bun check` is the fast check; tsc (in
  `next build` and CI) is the reference. Delete `tsconfig.tsbuildinfo` when
  they disagree. `allowJs: true` stays (`next build` puts it back).
- Exact pins for the three.js stack, the glTF build tools, `delatin`, the
  framework trio, the lint tools and `ultracite` (bump `oxlint` and
  `oxlint-tsgolint` together), `suncalc` and `zod`, whose version is in
  three bake keys; caret for the rest; the npm MCP servers in
  `.mcp.json` exactly. Bun comes from `packageManager` (≥ 1.4 for
  `Bun.WebView`; the web session's start hook upgrades it).
- No type shim for `three-mesh-bvh` (it augments `three` itself).
- The Ko-fi link (`lib/brand.ts`) stays a plain link, never Ko-fi's widget.
- `components/ui/` is vendored by `shadcn add`; regenerate, never
  hand-edit — except that `sidebar.tsx` writes no cookie. Class names are
  joined with `cn` from the `cn` package.
- Conventional Commits; stage only the paths you changed.
- A change is not done until `docs/` says so (`docs-upkeep` skill).

## When in doubt, ask before

- Introducing a backend, a stateful API route or a database
- Adding a heavy dependency (a map or tiling library, a second renderer)
- Bringing back a second render path (WebGLRenderer, GLSL), or patching
  three's renderer internals (ADR 0027)
- Committing raw bulk geodata, switching on Git-LFS, or committing another
  city's `data/<site>/` (ADR 0037)

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
