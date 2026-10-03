# Plan 046: Split `rail-layer.ts` and `bootApp` along their seams, give the shared TSL helpers a home, sweep the dead code

> **Executor instructions**: This plan is **moves only** — no logic,
> formula, constant or geometry changes. Every step must leave
> `bun run verify` green and the e2e layer census unchanged. Do the steps
> in order, one commit each. On a STOP condition, stop and report. When
> done, update this plan's row in `docs/plans/README.md` (and strike the
> backlog items it closes, see "Maintenance notes").
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- app/_components/rail-layer.ts app/_components/tram-layer.ts app/_components/riverside-layer.ts app/_components/create-app.ts app/_components/terrain-layer.ts app/_components/water-layer.ts app/_components/ground-detail.ts components/ui hooks`
> Plans 039 (rail-layer fixes), 041, 042 and 043 (create-app) edit the
> same files — **run this plan after them**, and re-derive the line
> numbers below from the live code (the section *names* are what matter).

## Status

- **Priority**: P3
- **Effort**: M (steps 1–2), S (steps 3–5)
- **Risk**: LOW (moves; the type-checker and the e2e census cover the wiring)
- **Depends on**: 039, 041, 042, 043 merged first (same files). 041 and
  042 merged 2026-10-03; 043 is BLOCKED (no code landed), so it no longer
  holds this plan up.
- **Category**: tech-debt
- **Planned at**: commit `a28de75`, 2026-10-01

## Why this matters

`rail-layer.ts` is 2 191 lines — ten times the repo's median module — and
it is also the geometry library of `tram-layer.ts` and
`riverside-layer.ts`, which import only its mesh kit and its deck table.
`bootApp` in `create-app.ts` is one ≈ 1 040-line closure; its telemetry
(GPU debug, stats census, crash-trail beats, the memory governor) and its
picking (footprints, demolish, the DoF focus ray) share almost no state
with the rest, yet every new HUD or boot feature lands in it (backlog item
14). `ground-detail.ts` has become the de-facto TSL helper library
(`floorMod`, `texelAt`, `byteOf`, `gdHash`, `gdNoise`, …) imported by four
other layers, and `water-layer.ts` ↔ `terrain-layer.ts` import each other
(it works only because of late use). And a handful of leftovers mislead
readers: four vendored shadcn components nothing imports, exports nothing
calls, a shared `hooks/` file that imports a route-private module.

## Current state

### `app/_components/rail-layer.ts` sections (line numbers at `a28de75`)

- **Mesh kit** — `COLORS` (140), `Mesh3`/`mesh3` (154-168), `pushTri`
  (169), `P3` (201), `quad` (209), `quadXYZ` (231), `finishGeo` (253),
  `MatOpts`/`material` (264-292), `Ring2`/`ringToWorld` (293-329),
  `addFootprint` (330), `ringWinding` (393), `outward` (408); and further
  down `tangentsXZ` (1048), `addRail` (1063), `addRibbon` (1072),
  `meshFrom` (1164), `cross` (1561), `unit` (1569).
- **Deck table** — `Pt` (529), `DeckPoly` (542), `pointInRing` (559),
  `profileAt` (579), `deckLift` (603), `deckPoly` (630), `deckOf` (657),
  `buildDeckTable` (681).
- **Approaches** (section comment at 708) — 711-1047: `approaches`,
  `approachFrom`, `approachPoly`, `addApproach`, `surfaceNormal`,
  `sideNormal`, `clampRing`, `worldToEpsg`.
- **Measured bridge** (section comment "the measured bridge (ADR 0033)" at
  1345; bridge code from 1185) — `bridgeProps` … `addMasonryPier` (to
  ≈ 2063), plus `addParapetWalls` (420), `endEdges` (470), `addColumn` (487).
- **Rail proper** — `RailContext`/`RailFeatures` (83-104), the constants
  (105-138), `buildBallast` (2064), `buildRails` (2086), `buildPlatforms`
  (2132), `buildRail` (2168).

Importers: `tram-layer.ts:56-67` (`addRail, addRibbon, buildDeckTable, COLORS, DeckPoly, deckLift, Mesh3, meshFrom, mesh3, Pt`),
`riverside-layer.ts:27-37` (`addFootprint, addRibbon, Mesh3, meshFrom, mesh3, Pt, quad, Ring2, ringToWorld`),
`tile-stream.ts:53` (`buildRail`), `rail-layer.test.ts:16`,
`tram-layer.test.ts:12` (`buildDeckTable, deckLift`).

### `create-app.ts` seams

- Telemetry: `GpuDebug` (≈145), `sceneBuffers()` (169-210), `gpuBytes`/
  `census`/`emitStats` (≈991-1017), the crash-trail beat (≈1335-1365,
  `trail.beat({...})`), the memory governor (`createMemoryGovernor`,
  ≈1366-1385), `getGpuDebug` on the handle (≈1525). Needs `renderer`,
  `scene`, `stream`, `pose`, `camera`, `sunRig`, `opts`.
- Picking: `loadFootprints` / `footprints` (≈1018-1039),
  `demolishAtCrosshair` (≈1069-1083), the focus ray `updateFocus`
  (≈1120-1170).

### TSL helpers in `app/_components/ground-detail.ts` (≈179-240)

`export const floorMod`, `texelSize`, `texelAt`, `loadTexel`, `byteOf`,
`gdHash`, `gdNoise`, `gdBand` (plus private `clampI2`, `classAt`).
Used by `sport-ground.ts`, `cultivated-layer.ts`, `road-markings.ts`,
`terrain-layer.ts`. `app/_components/shader-chunks.ts` is the documented
home of "the shared TSL pieces" (AGENTS.md).

### The cycle

`water-layer.ts:36` `import { type SplatLayer, splatUv } from "./terrain-layer";`
and `terrain-layer.ts:104` `import { createWaterLayer, type WaterLayer } from "./water-layer";`.
`SplatLayer` is declared at `terrain-layer.ts:576`, `splatUv` at `:617`
(with private helpers `splatSize` 606, `splatOrigin` 645, `splatVariant` 651).

### Leftovers

- `components/ui/dropdown-menu.tsx`, `input-group.tsx`, `kbd.tsx`,
  `spinner.tsx`: no importer anywhere (checked with grep). AGENTS.md:
  "`components/ui/**` is vendored by `shadcn add` — regenerate, never
  hand-edit … removing one should remove [its dependency] again."
- Exports with no reference outside their own line: `texSize`
  (`app/_components/shader-chunks.ts`), `SUPPORTED_EPSG_CODES`
  (`lib/city/crs.ts`), `SVF_PX` (`lib/city/skyview.ts`). (`STYLE_PENS` in
  `stylize-effect.ts`: keep it if plan 041 added a test for it, else delete.)
- `hooks/use-coarse-pointer.ts` imports `MOBILE_MEDIA_QUERY` from
  `@/app/_components/scene-profile`; its only consumer is
  `app/_components/city-walk.tsx:22`.
- `aesthetic-sandbox.html` (repo root, 669 lines, the last GLSL in the repo,
  excluded in `.oxlintrc.json:88` and `.oxfmtrc.json:20`): a **maintainer
  decision** is pending (`docs/plans/README.md`, "Maintainer actions").
  Do not delete it unless the operator confirms.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |
| Build | `bun run build` | exit 0 |
| E2E census | `bunx playwright test e2e/city-walk.spec.ts -g "every scene layer"` | pass |
| Remove a shadcn component | `bunx shadcn@4.21.0 remove <name>` if the CLI supports it; else delete the file | — |

## Scope

**In scope**: `app/_components/rail-layer.ts`, new
`app/_components/mesh-kit.ts`, `app/_components/bridge-deck.ts`,
`app/_components/bridge-layer.ts`, `tram-layer.ts`, `riverside-layer.ts`,
`tile-stream.ts` (imports), `rail-layer.test.ts`, `tram-layer.test.ts`;
`create-app.ts`, new `app/_components/app-telemetry.ts` and
`app/_components/scene-picking.ts`; `ground-detail.ts`, `shader-chunks.ts`
(or a new `app/_components/tsl-helpers.ts`), their importers;
`terrain-layer.ts`, `water-layer.ts`, new `app/_components/terrain-splat.ts`;
the four `components/ui` files; the three dead exports; `hooks/use-coarse-pointer.ts`
→ `app/_components/use-coarse-pointer.ts`, `city-walk.tsx`; docs that name
moved files (AGENTS.md "Where things live", `docs/rendering.md`,
`docs/data-flow.md`, `docs/transformations.md`, the city-walker skill) —
path updates only.

**Out of scope**: unifying the geometry writers' winding rules (backlog
item 21: changes baked geometry, needs plates); unifying hash/noise
*variants* (changes patterns); `terrain-layer.ts` and
`vegetation-layer.ts` splits beyond the cycle (backlog item 22); any
behaviour change.

## Git workflow

Branch `claude/046-split-and-sweep`; one `refactor:` commit per step
(e.g. `refactor(rail): the mesh kit, the deck table and the bridge in their own files`).
No push unless instructed.

## Steps

### Step 1: Split `rail-layer.ts`

Create, by **moving** code (cut/paste, then fix imports — no edits to
bodies):
- `mesh-kit.ts` — the mesh-kit list above (+ `cross`, `unit`, `tangentsXZ`).
- `bridge-deck.ts` — the deck table and the approaches (they belong
  together: `buildDeckTable` adds the approaches' ramps).
- `bridge-layer.ts` — the measured bridge, `addParapetWalls`, `endEdges`,
  `addColumn`, `buildBridges`.
- `rail-layer.ts` keeps `RailContext`, `RailFeatures`, the rail constants,
  `buildBallast`, `buildRails`, `buildPlatforms`, `buildRail`.

Constants used by more than one new file go where their first user is and
are exported from there (do not duplicate them). Repoint `tram-layer.ts`,
`riverside-layer.ts`, `tile-stream.ts` and the tests to the new modules.
Let `bun run typecheck` drive the import fixes. Check for new import
cycles: `bridge-deck.ts` must not import `bridge-layer.ts`.

**Verify**: `bun run verify` → exit 0; `wc -l app/_components/rail-layer.ts` → under 500;
`git diff --stat` shows the moved lines as deletions + additions of similar
size (no net logic added); e2e census passes.

### Step 2: Telemetry and picking out of `bootApp`

- `app-telemetry.ts`: `createAppTelemetry({ renderer, scene, stream, pose, camera, sunRig, trail, budget, onStats })`
  returning `{ emitStats (or scheduleStats if plan 042 landed), beat, getGpuDebug, governor…, dispose }`
  — move `sceneBuffers`, `GpuDebug`, the census helpers, the beat and the
  governor wiring. `bootApp` calls it once and wires the returned
  functions where the old code was.
- `scene-picking.ts`: footprints (loading + the version/cache from plan
  042 if present), `demolishAtCrosshair`, `updateFocus`, with the
  dependencies passed in.

Keep closure-capture order: anything the moved code reads lazily
(`stream`, `invalidateShadows`) is passed as a function, not a value
captured too early.

**Verify**: `bun run verify` → exit 0; `bun run build` → exit 0; e2e
census, minimap, demolish and DoF specs pass (`-g "every scene layer|minimap|demolish|focus"`).

### Step 3: A home for the shared TSL helpers

Move `floorMod`, `texelSize`, `texelAt`, `loadTexel`, `byteOf`, `gdHash`,
`gdNoise`, `gdBand` (and the private `clampI2` they need) from
`ground-detail.ts` into `shader-chunks.ts` (or a new `tsl-helpers.ts` if
`shader-chunks.ts` would then import `ground-detail` types — avoid that).
Repoint the importers. Formulas byte-for-byte unchanged. Also move the
CPU `hash` that `tree-inventory-layer.ts`, `low-vegetation-layer.ts` and
`cultivated-layer.ts` import from `vegetation-layer.ts`, and `leafNoise`
that `low-vegetation-layer.ts` imports from it, if they are pure helpers
(check: no vegetation state) — into the same helper module (TSL) or
`lib/city/math.ts` (CPU).

**Verify**: `bun run verify` → exit 0; `grep -rn "from \"./ground-detail\"" app/_components | grep -v terrain-layer` → no matches.

### Step 4: Break the terrain ↔ water cycle

Move `SplatLayer`, `splatUv` and their private helpers (`splatSize`,
`splatOrigin`, `splatVariant` — only those `splatUv` needs) from
`terrain-layer.ts` into `terrain-splat.ts`; `terrain-layer.ts` and
`water-layer.ts` import from it.

**Verify**: `bun run verify` → exit 0; `grep -n "from \"./terrain-layer\"" app/_components/water-layer.ts` → no match.

### Step 5: Sweep

- Remove the four unused `components/ui` components (shadcn CLI if it has
  `remove`; else delete the files). If a dependency was used only by them
  (`grep` the package name in `app components hooks lib`), remove it from
  `package.json` and run `bun install`.
- Delete the exports `texSize`, `SUPPORTED_EPSG_CODES`, `SVF_PX` (keep the
  values if used inside their module — only drop the `export`, or the
  declaration if unused).
- Move `hooks/use-coarse-pointer.ts` to `app/_components/use-coarse-pointer.ts`
  and fix the import in `city-walk.tsx` (`hooks/use-mobile.ts` stays — the
  vendored sidebar uses it).
- `aesthetic-sandbox.html`: only on the operator's explicit OK — delete it,
  its two config exclusions, and the SKILL.md / README "Maintainer
  actions" mentions. Otherwise leave it and say so.

**Verify**: `bun install --frozen-lockfile` → exit 0 (or the lockfile
change is only the removed package); `bun run verify` → exit 0;
`bun run build` → exit 0.

### Step 6: Docs

Update file paths in AGENTS.md ("Where things live": rail-layer now names
the mesh kit, deck table and bridge files; the telemetry and picking
modules), `docs/rendering.md`, `docs/data-flow.md` (if a Mermaid block
names `rail-layer.ts`, run `bun run docs:diagrams`), `docs/transformations.md`
and the city-walker skill. Paths only.

**Verify**: a script check — every `app/_components/*.ts` path mentioned in
AGENTS.md exists:
`grep -o "app/_components/[a-z0-9/-]*\.tsx\?" AGENTS.md | sort -u | xargs -I{} test -e {} && echo ok` → `ok`;
`bun test ./lib/docs` → all pass.

## Test plan

No new behaviour, so no new tests; the existing unit tests move with their
subjects (split `rail-layer.test.ts` along the same lines if it helps,
keeping every test). The e2e census is the integration guard.

## Done criteria

- [ ] `bun run verify` and `bun run build` exit 0; e2e census passes
- [ ] `wc -l app/_components/rail-layer.ts` < 500; `mesh-kit.ts`, `bridge-deck.ts`, `bridge-layer.ts` exist
- [ ] `app-telemetry.ts` and `scene-picking.ts` exist; `create-app.ts` is ≥ 250 lines shorter
- [ ] No import cycle between `terrain-layer.ts` and `water-layer.ts`
- [ ] The four `components/ui` files are gone; `grep -rn "texSize\|SUPPORTED_EPSG_CODES\|SVF_PX" app lib` → no exports
- [ ] AGENTS.md paths all exist

## STOP conditions

- A move needs a logic change to compile (e.g. a helper closes over module
  state) → stop and report which.
- The e2e census changes any count after a step → stop.
- A new import cycle appears (`bridge-deck` ↔ `bridge-layer`, telemetry ↔
  picking) → stop.

## Maintenance notes

- This closes most of backlog item 14 (create-app split) and prepares item
  21 (one geometry kit: `mesh-kit.ts` is its runtime half) and item 23
  (the dressing table). Strike/annotate them in `docs/plans/README.md`.
- New layers import geometry from `mesh-kit.ts`, never from `rail-layer.ts`.
