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
| 016 | Replace `sharp` with `Bun.Image` for the 2048² raster downsample | REJECTED — premise gone with ADR 0023 (no baked RGB splat) | [completed.md](./completed.md#016--bunimage-instead-of-sharp-for-the-raster-downsample--rejected-premise-gone) |
| 017 | Any German city: site config, own 2 km tile grid, per-Land ingest adapters, OSM land cover as a DLM substitute | **PARTIAL** — phases 1–2 done for Saxony (site config in TS, Python bakes, `ingest_sn`); 3 half; 4 (OSM land cover), NRW, 5 (rest) open | [017-germany-wide-sites.md](./017-germany-wide-sites.md) |
| 018 | Stream tiles around the camera: tile manager, loader worker, 1 km near cells, KTX2 splat | REJECTED — superseded by 3D Tiles + 3DTilesRendererJS (ADR 0024) | [completed.md](./completed.md#018--stream-tiles-around-the-camera--rejected-superseded-by-adr-0024) |
| 019 | Verify and tune the 3D Tiles branch on a real GPU (palette, quantisation, LOD, seams, shadows, frame time, phones, deploy host) | **TODO** — needs a GPU | [019-gpu-verification.md](./019-gpu-verification.md) |
| 020 | WebGPURenderer + TSL instead of WebGL and `onBeforeCompile`; node post instead of `postprocessing`/`n8ao` | **IN PROGRESS** — Phase 0 spike done (look matches; WebGPU 40–80 % faster than today, WebGL2 backend on par but stalls while compiling); gate awaits the maintainer | [020-webgpu-tsl.md](./020-webgpu-tsl.md) |
| 021 | `/wissen` on Astro Starlight instead of a hand-built Next route | **TODO** — plan only; Phase 0 awaits the maintainer | [021-wissen-astro-starlight.md](./021-wissen-astro-starlight.md) |
| 022 | Re-bake land cover, canopy, NDVI, roof colours and lamps from the current editions (one DLM edition for every product, lamps owned by one tile) | **TODO** | [022-rebake-current-editions.md](./022-rebake-current-editions.md) |
| 023 | The ground up close: kerbs, lawn edges, OSM paving and parking, urban green; kerb geometry, grass volume, micro-relief, official sources | **PARTIAL** — 1–3 and 5 done (kerb stones on baked edges, lawn edges, OSM paving with parking bays, urban green as meadow); 4 (GPU tuning), 5–8 open | [023-ground-detail.md](./023-ground-detail.md) |
| 024 | Trams: OSM tracks (street, grass, ballast), contact wire, masts, span wires, stop signs | **TODO** | [024-tram-and-catenary.md](./024-tram-and-catenary.md) |
| 025 | Trees by species and season: OSM trees beside the cadastre, autumn colour, bare winter crowns | **TODO** | [025-trees-by-species-and-season.md](./025-trees-by-species-and-season.md) |
| 026 | Road markings: zebra and signalled crossings, stop lines, cycle lanes, centre lines | DONE — all phases (bake + shader, four tiles); centre lines on main roads only; look unjudged on a GPU | [026-road-markings.md](./026-road-markings.md) |
| 027 | Buildings from OSM: part attribute inheritance (bug), ground-floor shop glow, heritage, era (spike) | **PARTIAL** — 0–2 built (1 682 parts regain their use; 1 188 shop objects, 842 listed), 3 REJECTED (0.8 % dated); open: dusk plates on a GPU | [027-buildings-from-osm.md](./027-buildings-from-osm.md) |
| 028 | Cultivated land: allotment colonies, orchards, vineyards | DONE — all phases (bake, allotment beds at low strength: 0 of 66 colonies map parcels, orchard trees, vineyard code + tests); look unjudged on a GPU | [028-cultivated-land.md](./028-cultivated-land.md) |
| 029 | Fences, railings and gates, baked into the fine terrain | **PARTIAL** — 1–2 built (99 km, 875 gates; one pattern-drawn quad per panel, +2.7–6.8 % fine glTF); open: plates on a GPU | [029-fences-and-gates.md](./029-fences-and-gates.md) |
| 030 | More street furniture: advertising columns, traffic signals, hydrants, clocks, drinking water, stop signs | **TODO** | [030-street-furniture-2.md](./030-street-furniture-2.md) |
| 031 | The Elbe: landing stages, pontoons, groynes, ferry lines | **TODO** | [031-elbe-riverside.md](./031-elbe-riverside.md) |
| 032 | Street names: map lettering in fly mode, a caption on foot | **TODO** | [032-street-names.md](./032-street-names.md) |
| 033 | Sky-view factor and baked horizon map: city-scale ambient light and far-field shadows | **PARTIAL** — phases 1–3 built (bake, terrain ambient + far shadow, clay facades SVF); horizon at 8 m (4 m broke the 1.5 MB cap); GPU plates and tuning open, horizon on facades not done | [033-sky-view-and-horizon-shading.md](./033-sky-view-and-horizon-shading.md) |
| 034 | Small structures from DOM − LoD2 (kiosks, sheds, carports), gated on a measurement | **TODO** — needs the raw laser scan (`--ingest --lsc`) | [034-dom-minus-lod2.md](./034-dom-minus-lod2.md) |
| 035 | A hidden, opt-in soundscape synthesised from the scene's data | **TODO** | [035-soundscape.md](./035-soundscape.md) |
| — | Aesthetic and visual fine-tuning roadmap (ten items) | DONE except atmospheric motes | [completed.md](./completed.md#aesthetic-and-visual-fine-tuning-roadmap--done-except-motes) |

## Open work

Ordered by leverage. Everything here is vetted against the code; effort
S/M/L.

1. **Plan 019 (S–M, GPU) — first.** The 3D Tiles branch (ADRs 0023–0026)
   was verified headless only; look at it on a real GPU, tune the LOD and
   cache knobs, check phones and the deploy host. Take plan 023 phase 4
   along (the ground detail's look and cost on the same GPU); its phases
   5–8 follow on their own.
2. **Plan 017, the rest (M).** OSM land cover as a DLM substitute (now a
   class raster only), the NRW adapter and a second site, `site:check`.
   Run the OSM bakes once against a Geofabrik extract (unreachable from
   the environment that ported them).
3. **Plan 020 (L, GPU-gated).** WebGPU + TSL; removes every
   `onBeforeCompile` patch, two post libraries and plan 008 step 7.
4. **Plan 008, steps 5–7 (S).** The coverage artifact; the remaining
   fixture-integrity checks; shader-anchor tests (moot with plan 020).
5. **Plan 021 (M, maintainer-gated).** `/wissen` on Starlight: about 2 000
   lines of hand-built docs site out, search in.
6. **Pixel-ratio drop while moving (S, GPU).** Plan 007 step 4:
   `setPixelRatio` reallocates every render target, so hold ~1 s before
   restoring; judge on a real GPU.
7. **Atmospheric motes (S, GPU).** The one unbuilt item of the aesthetic
   roadmap. Design: camera-local `Points` (2–4 k) with a toroidal wrap on
   the camera-relative offset (R ≈ 30 m), additive, `depthWrite: false`,
   `depthTest: true`, `toneMapped: false`, `fog: false` (fog would brighten
   distant motes), hash-seeded for reproducible snapshots, one slider
   driving opacity *and* `setDrawRange`, `material.map` disposed
   explicitly. +1 draw call, sub-0.1 ms of JS; vertex-shader-only beyond
   ~8 k points. Ledger: 📋 planned #10.
8. **Water and mist sheets draw the whole terrain geometry (M, bake +
   GPU).** ≈7.3 M of the ≈10.9 M terrain-derived triangles per frame belong
   to transparent sheets that `discard` on ~95 % of each tile (counted
   before ADR 0024; each fine terrain tile still hangs its sheets on the
   whole 1024² grid). Fix, now in the bake: a water-only index buffer over
   the shared positions, written into the terrain glTF as a second
   primitive from the class raster.
9. **Far crown LOD tier (S–M, GPU).** A third InstancedMesh per cell
   (detail 1 or 0, trunk hidden) beyond ~500 m; today a tree 2 km away
   draws ~400 triangles in the main and every shadow pass. Ledger 📋 #11.
10. ~~**Terrain BVH → grid ray-march (M).**~~ Done 2026-09-24
    (`lib/city/ground-ray.ts`): no terrain BVH any more; it was the longest
    stall on flights (~1 s per fine tile).
11. **Shadow centre biased ahead at eye level (S, GPU).** Plan 009's
   leftover: push the re-centre 20–30 m along the view direction so long
   low-sun shadows clip less (the altitude fit only pushes ahead above the
   base radius). Long shadows beyond the frustum are otherwise a CSM
   problem (ledger 📋 #7).
12. ~~**First-frame compile (S, GPU).**~~ Done 2026-09-24: every tile and
    dressing is compiled with `compileAsync` before it shows
    (`PostStack.compile`).
13. **Bundle: `proj4` for one conversion (S).** A 40-line UTM inverse for
    zones 32/33 replaces it (`lib/city/crs.ts`). Size unmeasured.
    (`GLTFLoader` is load-bearing now: every tile is glTF.)
14. **Split the 1 000-line `create-app.ts` (L).** The tile path left for
    `tile-stream.ts`, but the ground, lamps, focus and loaded-state logic
    still sit in one closure: `focus-controller.ts`, `ground.ts`, ….
15. **`lib/city/math.ts` and one `densify` (S–M).** `clamp` re-implemented
    dozens of times; four polyline resamplers with divergent carry
    semantics; unifying changes geometry slightly and needs a shot
    comparison.
16. **Pure-helper tests (S each, when a module is next touched).** Rail
    geometry (`pushTri`, `deckLift`, `addArches`, `buildRails` — none run in
    CI because the lite tile has no rail lines and the only arch bridge is
    on a neighbour), vegetation (`sampleLine`, `bucketByCell`, `crownColor`,
    `updateLod`), lamps, walls, `prepare-data`'s content-keyed cache.
17. **`dispose()` leaves textures, the shadow map and the GL context to the
    GC (S).** Bounded today (only dev/CI unmount).
18. **Materials whose GLSL depends on `heightFog` but whose cache key does
    not (S).** Latent while every caller passes it; one
    `customProgramCacheKey` each.
19. **Low-confidence, investigate not fix:** NoData next to valid samples
    in the terrain bake's resample (`scripts/bake-tiles.ts`); the lowest
    terrain bound (with the 30 m skirt) as the ground fallback; the minimap assumes square
    bounds; the joystick releases on any `pointerup`; the `crs.ts`
    trailing-slash regex.

### Data → scene: plans 024–035 (planned 2026-09-25)

A batch of features derived from OSM, the DGM and the laser scan, each its
own plan. OSM counts in the plans are from the BBBike Dresden extract of
2026-09-19 over the four tiles. Suggested order, by leverage and
independence:

1. **033** sky-view factor + horizon shading (committed inputs only; also
   the cheap answer to the far-shadow limit, ledger 📋 #7).
2. **027 phase 0** — BuildingParts do not inherit `function` (wrong tint
   and dusk glow on the parts of 90 non-housing buildings in one tile).
3. **024** trams, then **030** street furniture (shares the stop sign).
4. **026** road markings, **029** fences and gates.
5. **027** phases 1–3, **032** street names, **031** the Elbe.
6. **025** (on the cadastre shipped in PR #49; the genus must first reach
   the tree data), **028** (its parcel hedges are the shipped OSM hedges),
   **034** once the laser scan is downloaded (`lsc.py` is shipped).
7. **035** the soundscape, last, once the data it listens to exists.

### Direction — options for the maintainer (choices, not defects)

1. **Make portability real: a second, OSM-only location (spike M, build L).**
   [portability.md](../portability.md) promises OSM footprint extrusion, a
   flat-plane terrain and OSM landuse fallbacks; the code has none of them
   (`prepare-data.ts` exits without CityJSON/DLM/DGM per tile; the CRS check
   rejects anything but 25832/25833). Pick one non-Saxon 2 km tile, run the
   pipeline with OSM + a public DEM, write down what breaks; then decide
   bake-side extrusion vs. runtime fallbacks.
   *For Germany this is now [plan 017](./017-germany-wide-sites.md)*
   (LoD2 + DGM1 are near-nationwide, so no footprint extrusion is needed
   there; the site config and a Land-neutral pipeline exist since
   ADRs 0025/0026). The OSM-only case outside Germany stays open here; the
   CRS check still accepts only 25832/25833.
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
4. **Editing (M).** The unused insert plumbing (`insertedModelUrl`,
   `insertAt`, the disabled `B` key) was removed with ADR 0026; demolish
   stays and now works on every visible tile. Place/move would return as a
   glTF in the scene (or in the tileset); undo for demolish is a stack of
   removed object ids plus the per-tile index rebuild.
5. **A user-facing quality tier (S–M).** The device tier already halves
   shadow texels and rasters on phones; a selectable `medium` tuple (DPR 1,
   2048² shadows, AO/DoF off) for weak desktops needs real-device looks.
6. **A provenance manifest per tile (S).** `bun run bake [tile]
   [--ingest]` exists (plan 017 phase 2); what is left is writing
   `data/<site>/<tile>.provenance.json` (dataset, edition, download date,
   licence) from the ingest adapter, for the HUD footer to read. The guide's
   dataset table and `data/provenance.json` are the hand-kept version.

### Maintainer actions

- Run plan 019 on a GPU machine before merging the 3D Tiles branch.
- Re-bake the remaining DLM/DOP products with the current editions:
  [plan 022](./022-rebake-current-editions.md).
- Plan 021's Phase 0 (a second framework for `/wissen`, the URL scheme).

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
- **2026-09-23**: plan 018 (tile streaming) and ADR 0022 (proposed) written
  by hand after a Q&A on adding more tiles: Next.js/Bun is not the limit,
  GPU memory, the main thread and the committed source size are.
- **2026-09-24**: after an architecture review aimed at fewer own concepts,
  one branch built the runtime palette (ADR 0023), the site config and plan
  017 phases 1–2 (ADRs 0025, 0026) and 3D Tiles via 3DTilesRendererJS with
  glTF + `EXT_mesh_features` content (ADR 0024). That superseded plan 018
  and ADR 0022 and removed plan 016's premise. Plans 019 (GPU
  verification), 020 (WebGPU/TSL, ADR 0027 proposed) and 021 (`/wissen` on
  Starlight) were written.
