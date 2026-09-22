# Implementation plans, backlog and audit history

Plans are written by audit runs (the `improve` skill) or by hand, executed
by an agent or a person, and closed here. This folder holds the **open**
plans in full, a **condensed record** of every completed one
([completed.md](./completed.md)), the **backlog** of vetted-but-unplanned
work, the list of ideas **rejected** so nobody re-audits them, and the run
history. Decisions that came out of plans are written up as
[ADRs](../adr/README.md); data → look ideas live in the
[ledger](../transformations.md).

## Lifecycle

1. A plan is a numbered file `NNN-short-slug.md` (numbering continues
   monotonically) with a status row below. Status values: TODO ·
   IN PROGRESS · DONE · PARTIAL (with what is open) · BLOCKED (one-line
   reason) · REJECTED (one-line rationale).
2. The executor reads the plan fully, honours its STOP conditions, and
   updates the row when done — with deviations, because the row is what the
   next reader trusts.
3. When a plan is DONE or REJECTED, its durable knowledge (the problem, the
   decision and why, alternatives, numbers, invariants, open items) is
   condensed into [completed.md](./completed.md), a constraining decision
   becomes an ADR, a rejected data → look idea becomes a 🗃️ ledger row, and
   the full file is deleted (git keeps it). Only open plans stay here in
   full.
4. The `improve` skill writes to a root `plans/` by default. Move or point
   its output here and reconcile against this file: keep numbering
   monotonic, skip findings already planned or rejected.

## Status

| Plan | Title | Status | Record |
|------|-------|--------|--------|
| 001 | Make the test baseline real — `app/` tests run, e2e waits for frames, `bun run verify` | DONE (PR #18) | [completed.md](./completed.md#001--test-baseline-and-real-e2e-frames--done-pr-18) |
| 002 | Remove per-frame waste: terrain BVH at load, on-demand shadow map, no MSAA backbuffer | DONE (PR #18; shadow gate on the light) | [completed.md](./completed.md#002--render-loop-quick-wins--done-pr-18) |
| 003 | Derive ink edges from CityJSON rings instead of welding the GPU mesh | REJECTED — PR #16 removed outlines; design kept | [completed.md](./completed.md#003--cityjson-derived-ink-edges--rejected) |
| 004 | Preprocess the DGM into a heightfield at build time | DONE (PR #25; uint16 + gzip format in #28) | [completed.md](./completed.md#004--build-time-heightfield--done-pr-25-format-v2-in-pr-28) |
| 005 | Input & collision fixes: stuck keys, diagonal speed, pinch baseline, inserted building, failure-path cleanup | DONE (PR #25) | [completed.md](./completed.md#005--input-and-collision-correctness--done-pr-25) |
| 006 | Scaffold cleanup, unused deps, lint config, fonts, README + AGENTS.md | DONE (PR #25) | [completed.md](./completed.md#006--scaffold-cleanup-dependencies-readme--done-pr-25) |
| 007 | Adaptive quality while the camera moves | DONE (PR #25; SSAO gating reverted 2026-09-22; step 4 open) | [completed.md](./completed.md#007--adaptive-quality-while-the-camera-moves--done-pr-25-step-4-open-amended) |
| 008 | Make the verification net catch what it exists to catch | **PARTIAL** — steps 1–4, 8 done; 5, 6 (rest), 7 open | [008-verification-net.md](./008-verification-net.md) |
| 009 | Re-render the shadow map only when the player has moved a real distance | DONE | [completed.md](./completed.md#009--shadow-refresh-dead-zone--done) |
| 010 | One tile artifact map, one fetch/abort policy, walls fetched once, neighbours loaded concurrently | DONE | [completed.md](./completed.md#010--tile-artifact-map-and-parallel-loads--done) |
| 011 | Six confirmed defects: flight cancel, keyup in text fields, minimap re-decode, null/MultiPolygon rail data, WebGL2 preflight | DONE | [completed.md](./completed.md#011--six-confirmed-defects--done) |
| 012 | Drive the look controls from one table, validate the Snapshot contract | DONE | [completed.md](./completed.md#012--look-controls-table-and-snapshot-contract--done) |
| 013 | One type-checker, suncalc 2 migration, dependency/pin hygiene, agent allowlist | DONE (overtaken by TS 7 + oxlint) | [completed.md](./completed.md#013--toolchain-and-dependency-hygiene--done-superseded-in-part) |
| 014 | Bring AGENTS.md, the skill, `docs/`, comments and the OSM attribution in line with the code | DONE | [completed.md](./completed.md#014--knowledge-base-currency--done) |
| 015 | Progressive first frame | DONE | [completed.md](./completed.md#015--progressive-first-frame--done) |
| 016 | Replace `sharp` with `Bun.Image` for the 2048² raster downsample | **TODO** — gated on the deploy container's Bun version; premise drift noted in the file | [016-bun-image-raster-downsample.md](./016-bun-image-raster-downsample.md) |
| — | Aesthetic and visual fine-tuning roadmap (ten items) | DONE except atmospheric motes | [completed.md](./completed.md#aesthetic-and-visual-fine-tuning-roadmap--done-except-motes) |

## Open work

Ordered by leverage. Everything here is vetted against the code; effort
S/M/L.

1. **Plan 008, steps 5–7 (S).** CI e2e gate for `scripts/`, `data/`,
   `patches/`; coverage artifact; the remaining fixture-integrity checks;
   shader-anchor tests that pin the `onBeforeCompile` chunk names (a
   renamed chunk currently switches height fog, meadow NDVI or rim light
   off with green CI). See the plan.
2. **Plan 016 (S, gated).** `Bun.Image` instead of `sharp`; first confirm
   from a deploy log that install *and* build run Bun 1.4.x.
3. **Pixel-ratio drop while moving (S, GPU).** Plan 007 step 4:
   `setPixelRatio` reallocates every render target, so hold ~1 s before
   restoring; judge on a real GPU.
4. **Atmospheric motes (S, GPU).** The one unbuilt item of the aesthetic
   roadmap. Design: camera-local `Points` (2–4 k) with a toroidal wrap on
   the camera-relative offset (R ≈ 30 m), additive, `depthWrite: false`,
   `depthTest: true`, `toneMapped: false`, `fog: false` (fog would brighten
   distant motes), hash-seeded for reproducible snapshots, one slider
   driving opacity *and* `setDrawRange`, `material.map` disposed
   explicitly. +1 draw call, sub-0.1 ms of JS; vertex-shader-only beyond
   ~8 k points. Ledger: 📋 planned #10.
5. **Water and mist sheets draw the whole terrain geometry (M, bake +
   GPU).** ≈7.3 M of the ≈10.9 M terrain-derived triangles per frame belong
   to transparent sheets that `discard` on ~95 % of each tile. Fix: a
   water-only index buffer over the shared positions from a baked coarse
   water mask.
6. **Far crown LOD tier (S–M, GPU).** A third InstancedMesh per cell
   (detail 1 or 0, trunk hidden) beyond ~500 m; today a tree 2 km away
   draws ~400 triangles in the main and every shadow pass. Ledger 📋 #11.
7. **Terrain BVH → heightfield ray-march (M).** The synchronous
   `computeBoundsTree()` over ≈3.6 M triangles at boot (≈1–1.5 s) serves
   two rays per second that a bilinear march answers in microseconds. Pure
   `lib/city/heightfield-ray.ts` + tests.
8. **Shadow centre biased ahead at eye level (S, GPU).** Plan 009's
   leftover: push the re-centre 20–30 m along the view direction so long
   low-sun shadows clip less (the altitude fit only pushes ahead above the
   base radius). Long shadows beyond the frustum are otherwise a CSM
   problem (ledger 📋 #7).
9. **First-frame decode/compile (S, GPU).** Eight 4096² `<img>` decodes and
   every program compile land in the first visible frame;
   `ImageBitmapLoader` + `renderer.compileAsync` under the overlay.
10. **Bundle: `GLTFLoader` and `proj4` for paths that never run (S).**
    Dynamic-import the loader behind `modelUrl`; a 40-line UTM inverse for
    zones 32/33 replaces proj4. Sizes unmeasured.
11. **Split the 900-line `bootApp` (L).** `tile-loader.ts`,
    `focus-controller.ts`, …; plans 010–012 and the camera-pose extraction
    already shrank it.
12. **`lib/city/math.ts` and one `densify` (S–M).** `clamp` re-implemented
    dozens of times; four polyline resamplers with divergent carry
    semantics; unifying changes geometry slightly and needs a shot
    comparison.
13. **Pure-helper tests (S each, when a module is next touched).** Rail
    geometry (`pushTri`, `deckLift`, `addArches`, `buildRails` — none run in
    CI because the lite tile has no rail lines and the only arch bridge is
    on a neighbour), vegetation (`sampleLine`, `bucketByCell`, `crownColor`,
    `updateLod`), lamps, walls, `prepare-data`'s staleness helpers, the
    NaN/`nodata: null` terrain path.
14. **`dispose()` leaves textures, the shadow map and the GL context to the
    GC (S).** Bounded today (only dev/CI unmount).
15. **Materials whose GLSL depends on `heightFog` but whose cache key does
    not (S).** Latent while every caller passes it; one
    `customProgramCacheKey` each.
16. **Low-confidence, investigate not fix:** NoData smearing in the
    bilinear bake before the sentinel compare; `worldBounds.min.y` (with
    the 30 m skirt) as the ground fallback; the minimap assumes square
    bounds; the joystick releases on any `pointerup`; the `crs.ts`
    trailing-slash regex.

### Direction — options for the maintainer (choices, not defects)

1. **Make portability real: a second, OSM-only location (spike M, build L).**
   [portability.md](../portability.md) promises OSM footprint extrusion, a
   flat-plane terrain and OSM landuse fallbacks; the code has none of them
   (`prepare-data.ts` exits without CityJSON/DLM/DGM per tile; the CRS check
   rejects anything but 25832/25833). Pick one non-Saxon 2 km tile, run the
   pipeline with OSM + a public DEM, write down what breaks; then decide
   bake-side extrusion vs. runtime fallbacks.
2. **Shareable view links (S–M).** The Snapshot codec is versioned and
   validated; the only URL read is `?scene=`. A `?snap=<base64>` read once
   after `ready` and written on Copy turns "this corner at 08:00 on
   21 December" into a link and collapses the shot harness to `page.goto`.
   Trade-off: URL length (~600 chars with every slider) vs. camera + date
   only; throttle `replaceState` on drags. Would supersede part of
   [ADR 0001](../adr/0001-client-only-static-app.md)'s "nothing persisted".
3. **Guided tour / attract mode and a day-cycle play button (S–M).** Five
   authored viewpoints, an arc tween and cancel-on-input exist; nothing
   chains them or animates the sun. A moving sun forces a shadow re-render
   per step — step it at a few Hz, not per frame.
4. **Finish the editing pair (M).** `insertedModelUrl`/`insertAt` are
   plumbed with no caller and the `B` key is disabled; place/move/delete
   via the double-tap raycast; undo for demolish is a stack of removed
   object ids plus a rebuild.
5. **A user-facing quality tier (S–M).** The device tier already halves
   shadow texels and rasters on phones; a selectable `medium` tuple (DPR 1,
   2048² shadows, AO/DoF off) for weak desktops needs real-device looks.
6. **Productise the bake and write a provenance manifest (S–M).** A
   `bun run bake <tile>` that runs the seven scripts in order, skips absent
   inputs and writes `data/<tile>.provenance.json` (dataset, edition,
   download date, licence) that the HUD footer could read. The guide's
   dataset table is the hand-kept version of this today.

### Maintainer actions

- Close the superseded Dependabot PRs (#3, #12, #13, #15, #26).
- Decide on the two unused `33414_*` DGM tiles (~28 MB): delete, or move to
  `data/_raw/`.
- Decide where `aesthetic-sandbox.html` (the historical crown playground at
  the repo root) should live, or delete it — the layer files are the source
  of truth.
- Record the Basis-DLM package's release date and the Geofabrik extract's
  timestamp the next time those are downloaded (`data/provenance.json` and
  the guide's dataset table; the DOM1 and DOP dates and the LoD2 inputs are
  resolved — read from GeoSN's download service, see
  [data-pipeline.md](../data-pipeline.md#provenance)).
- Optionally give the platform GeoJSON an `attribution` member (it is
  written straight by `ogr2ogr`); the HUD footer carries the credit today.
- `.editorconfig` was never created (plan 013).

## Rejected (kept so nobody re-audits them)

- **react-three-fiber** — frame loop identical to `setAnimationLoop`; every
  `onBeforeCompile` an escape hatch; the `__poc` handle rebuilt on a store;
  a static-after-load scene is r3f's weakest case
  ([ADR 0002](../adr/0002-imperative-threejs-in-a-react-shell.md)).
- **Render-on-demand loop** — continuous input needs continuous frames and
  it breaks `waitForFrames`; motion-keyed quality is the version that pays.
- **A `tsconfig.node.json` / project-references split** — tests are
  colocated and need `bun:test` types; M effort for a hazard nothing trips.
- **`cacheComponents: true` as dead config** — a valid top-level Next 16
  option; harmless on one route.
- **Bake-script tile-id validation** — the sole caller is the maintainer's
  shell; all scripts use `set -euo pipefail`, `mktemp`/`trap`, quoted
  expansions.
- **Dev-tree `bun audit` advisories** — all in CLI transitive trees, none
  reachable from the shipped bundle.
- **CI dependency caching, CSP headers, SHA-pinned actions,
  `.env.example`, CONTRIBUTING, a pre-push hook, verifying
  `skills-lock.json` in CI** — low value for a solo static POC; no auth,
  cookies, user content or backend.
- **`docs/architecture.md`** — rejected in 2026-09 as "documented
  decisions"; superseded by [rendering.md](../rendering.md) and the ADRs,
  which cover what it would have.
- **Replace `date-fns` with `Intl`** — `react-day-picker` depends on it.
- **`terrain.mesh.castShadow = true`, BatchedMesh for buildings, synchronous
  CityJSON parser in the browser, fly mode with collision, global
  three-mesh-bvh prototype patching** — documented decisions or not worth
  doing.
- **"Walk-mode collider can lock the player inside a building"** — not a
  bug: `FrontSide` materials, the ray never hits back faces.
- **ultracite / its oxlint preset** — the same style refactor its biome
  preset was; JSON configs cannot `extends` `.mjs` presets.
- **Held back deliberately:** `n8ao` 2.x (no types, changes SSAO output —
  needs the headed harness), `postprocessing` 7.x (alpha/beta only).

## What the audits did not cover

Internals of `components/ui/**` and the vendored skills (scanned for
prompt-injection content only); `data/**` beyond names, sizes, counts,
geometry types and property keys; anything executed (the audits ran with
no `node_modules`; CI's green run was the baseline); real-GPU behaviour
(every shader and fill-rate statement is reasoned from the three.js r186
source); the production deploy environment.

## History

- **2026-09-18 run** (against `8075a21`): plans 001–006 from the audit, 007
  from an r3f feasibility check. PR #16 (the aesthetic branch) was merged
  into the plan tree and tripped every drift check; 001 and 002 were ported
  onto it; 003 lost its target; 004–007 were executed in PR #25.
- **2026-09-20 run** (against `2079c3a`): 001–007 verified closed; findings
  31–67 vetted across nine categories by eight parallel auditors; plans
  008–014 written; executed 2026-09-20/21 in the order 010 → 015 → 014 →
  011 → 012 → 013 → 009 → 008 (partial).
- **2026-09-21**: plan 016 written by hand after the `/code-review` of the
  2048² raster change found sharp's alpha premultiply painting the ground
  black (fixed in #29).
- **2026-09-22**: the folder moved from `plans/` to `docs/plans/`; completed
  plans condensed into [completed.md](./completed.md), decisions into
  [ADRs](../adr/README.md), open items into the backlog above, rejected
  data → look ideas into the ledger. Full texts: git history at `761d609`.
