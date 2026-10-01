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
| 008 | Make the verification net catch what it exists to catch | CLOSED (2026-10-01) — steps 1–4, 8 done, 7 moot; the coverage artifact moved to plan 037, the remaining fixture checks to plan 041 | [completed.md](./completed.md#008--the-verification-net--done-in-part-2026-09-24-step-7-moot-closed-the-rest-moved-to-plans-037-coverage-and-041-fixture-checks) |
| 009 | Re-render the shadow map only when the player has moved a real distance | DONE | [completed.md](./completed.md#009--shadow-refresh-dead-zone--done) |
| 010 | One tile artifact map, one fetch/abort policy, walls fetched once, neighbours loaded concurrently | DONE | [completed.md](./completed.md#010--tile-artifact-map-and-parallel-loads--done) |
| 011 | Six confirmed defects: flight cancel, keyup in text fields, minimap re-decode, null/MultiPolygon rail data, WebGL2 preflight | DONE | [completed.md](./completed.md#011--six-confirmed-defects--done) |
| 012 | Drive the look controls from one table, validate the Snapshot contract | DONE | [completed.md](./completed.md#012--look-controls-table-and-snapshot-contract--done) |
| 013 | One type-checker, suncalc 2 migration, dependency/pin hygiene, agent allowlist | DONE (overtaken by TS 7 + oxlint) | [completed.md](./completed.md#013--toolchain-and-dependency-hygiene--done-superseded-in-part) |
| 014 | Bring AGENTS.md, the skill, `docs/`, comments and the OSM attribution in line with the code | DONE | [completed.md](./completed.md#014--knowledge-base-currency--done) |
| 015 | Progressive first frame | DONE | [completed.md](./completed.md#015--progressive-first-frame--done) |
| 016 | Replace `sharp` with `Bun.Image` for the 2048² raster downsample | REJECTED — premise gone with ADR 0023 (no baked RGB splat) | [completed.md](./completed.md#016--bunimage-instead-of-sharp-for-the-raster-downsample--rejected-premise-gone) |
| 017 | Any German city: site config, per-Land ingest adapters, NAS input, OSM land cover as a DLM substitute | **PARTIAL** — site config, Python bake package and the Saxony adapter built; open (rewritten 2026-10-01 for the Python pipeline): phase A (NRW adapter, a second site, per-tile provenance), B (NAS), C (OSM land cover — after plan 045), D (no-DOM1 trees, `site:check`, every site in the tests) | [017-germany-wide-sites.md](./017-germany-wide-sites.md) |
| 018 | Stream tiles around the camera: tile manager, loader worker, 1 km near cells, KTX2 splat | REJECTED — superseded by 3D Tiles + 3DTilesRendererJS (ADR 0024) | [completed.md](./completed.md#018--stream-tiles-around-the-camera--rejected-superseded-by-adr-0024) |
| 019 | **The one GPU checklist**: backends, palette, quantisation, LOD and seams, shadows, GTAO and sky light, picture styles, frame time and memory, phones, deploy host, and the feature plates of plans 023–039 | **TODO** — needs a GPU and two phones; rewritten 2026-10-01 | [019-gpu-verification.md](./019-gpu-verification.md) |
| 020 | WebGPURenderer + TSL instead of WebGL and `onBeforeCompile`; node post instead of `postprocessing`/`n8ao` | DONE (2026-09-26) — the whole port, one path (WebGPU, its WebGL2 backend as the fallback), public API only; the spike's internal patches rejected for a top-level scene pass, `Instances` and `sceneMaterial`; look unjudged on a real GPU | [completed.md](./completed.md#020--webgpurenderer-and-tsl-node-materials--done-2026-09-26) |
| 021 | `/wissen` on Astro Starlight instead of a hand-built Next route | **TODO** — plan only; Phase 0 awaits the maintainer | [021-wissen-astro-starlight.md](./021-wissen-astro-starlight.md) |
| 022 | Re-bake the four original tiles from the current editions, the whole chain downstream of the land cover | **TODO** — after plan 040 step 1; re-scoped 2026-10-01 | [022-rebake-current-editions.md](./022-rebake-current-editions.md) |
| 023 | The ground up close: kerbs, lawn edges, OSM paving and parking, urban green | CLOSED (2026-10-01) — phases 1–3 and 5 built; the raised pavement and micro-relief rejected (🗃️), shell grass an idea only; the look in plan 019, the DLM split and LSC intensity in the [data-streams survey](../data-streams.md), trees in carved parks in plan 022 | [completed.md](./completed.md#023--the-ground-up-close-kerbs-paving-lawn-edges-urban-green--closed-2026-09-25-phases-13-and-5-built-rest-rejected-or-moved) |
| 024 | Trams: OSM tracks (street, grass, ballast), contact wire, masts, span wires, stop signs | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#024--trams-tracks-overhead-line-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 025 | Trees by species and season: OSM trees beside the cadastre, autumn colour, bare winter crowns | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#025--trees-by-species-and-season--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 026 | Road markings: zebra and signalled crossings, stop lines, cycle lanes, centre lines | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#026--road-markings--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 027 | Buildings from OSM: part attribute inheritance (bug), ground-floor shop glow, heritage, era (spike) | DONE (2026-09-25) — phases 0–2 built, 3 REJECTED (0.8 % dated); dusk look in plan 019 | [completed.md](./completed.md#027--what-osm-knows-about-the-buildings--done-2026-09-25-phase-3-rejected-dusk-look-unjudged-on-a-gpu--plan-019) |
| 028 | Cultivated land: allotment colonies, orchards, vineyards | DONE (2026-09-25) — look in plan 019; open: vine rows ignore the season (backlog) | [completed.md](./completed.md#028--cultivated-land-allotments-orchards-vineyards--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 029 | Fences, railings and gates, baked into the fine terrain | DONE (2026-09-25) — restyled to one calm band, ground join per ADR 0035; look in plan 019 | [completed.md](./completed.md#029--fences-railings-and-gates--done-2026-09-25-restyled-to-one-band-look-unjudged-on-a-gpu--plan-019) |
| 030 | More street furniture: advertising columns, traffic signals, hydrants, clocks, drinking water, stop signs | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#030--more-street-furniture-columns-signals-hydrants-clocks-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 031 | The Elbe: landing stages, pontoons, groynes, ferry lines | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#031--the-elbe-landing-stages-groynes-ferries--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 032 | Street names: map lettering in fly mode, a caption on foot | REJECTED — built 2026-09-25, removed 2026-09-26 by the maintainer's decision after seeing it | [completed.md](./completed.md#032--street-names-lettering-and-the-on-foot-caption--rejected-removed-2026-09-26) |
| 033 | Sky-view factor and baked horizon map: city-scale ambient light and far-field shadows | DONE (2026-09-25) — plates and tuning in plan 019; horizon on facades folded into ledger 📋 #7 (CSM) | [completed.md](./completed.md#033--sky-view-factor-and-baked-horizon-shading--done-2026-09-25-plates-and-tuning-open-on-a-gpu--plan-019) |
| 034 | Small structures from DOM − LoD2 (kiosks, sheds, carports), gated on a measurement | DONE (2026-09-26) — look in plan 019 | [completed.md](./completed.md#034--small-structures-from-dom--lod2--done-2026-09-26-look-unjudged-on-a-gpu--plan-019) |
| 035 | A hidden, opt-in soundscape synthesised from the scene's data | DONE (2026-09-26) — unheard: the listening pass rides along with plan 019's phone session | [completed.md](./completed.md#035--a-hidden-soundscape--done-2026-09-26-unheard-the-listening-pass-is-a-maintainer-action) |
| 036 | What the data streams carry that we do not use (OSM, LoD2, the city's WFS, Wikidata, GeoSN, DLM): a measured survey and a ranking | **REFERENCE** — moved to [docs/data-streams.md](../data-streams.md) on 2026-10-01 (a survey, not a plan); pick an item into its own plan | [data-streams.md](../data-streams.md) |
| 037 | The commands agents run work (`bun run build`/`test`, E2E_DEV over HTTPS), the skill's phone cache numbers, "1024²" → TIN, guide viewpoints and sizes, codebook pointers, Dependabot/CI paths, lockfile header; a test pins the guide to the HUD | **TODO** — P1, do first | [037-agent-commands-and-doc-drift.md](./037-agent-commands-and-doc-drift.md) |
| 038 | Runtime spine: the shadow camera follows by night (no pinned tile), "loaded" without a spawn dressing nobody builds, no GPU-recovery loop and the crash it hid, no stuck key after a ⌘ chord, a jump ends live mode | **TODO** — P1 | [038-runtime-spine-fixes.md](./038-runtime-spine-fixes.md) |
| 039 | Bridge approach ramps without zero normals, rails passing under a rail deck stay down, Papier keeps double-sided ribbons and bare crowns, Sin City rain that lasts | **TODO** — P1/P2; step 4 needs a GPU look | [039-geometry-and-style-fixes.md](./039-geometry-and-style-fixes.md) |
| 040 | Bakes: step-major `bun run bake`, seam stair flights kept, atomic ingest + timeouts + https check, atomic `prepare-data` writes, the `/wissen` hero as tall as the site | **TODO** — P1/P2; the stairs then need a re-bake (maintainer) | [040-bake-pipeline-fixes.md](./040-bake-pipeline-fixes.md) |
| 041 | Test net: raster shares and the aborted-load free, the collider through a real BVH, census for stairs/sport/kerbs, eye height vs the DGM, pens per style, three's real geometry key | **TODO** — P2 | [041-test-net-for-lifetime-and-collision.md](./041-test-net-for-lifetime-and-collision.md) |
| 042 | Main thread while streaming: stats coalesced, footprints only when they change (no minimap repaint per tile event), footprints after the handover, the viewer chunk fetched with the manifest | **TODO** — P2 | [042-boot-and-stream-main-thread-waste.md](./042-boot-and-stream-main-thread-waste.md) |
| 043 | The city BVH in a worker (≈ 80 ms per tile on desktop today) | **TODO** — P2, measurement gate; after 041 | [043-city-bvh-off-the-main-thread.md](./043-city-bvh-off-the-main-thread.md) |
| 044 | The canopy points as a packed binary instead of a 9.5 MB GeoJSON parsed in one task | **TODO** — P2, measurement gate | [044-tree-points-as-binary.md](./044-tree-points-as-binary.md) |
| 045 | One source for the raster decoders (the stale `surfaceHeading`) and the Python class ids; one OSM number parser; the byte scales pinned across languages | **TODO** — P3; before plan 017 phase 4 | [045-one-source-for-decoders-and-class-ids.md](./045-one-source-for-decoders-and-class-ids.md) |
| 046 | Moves only: `rail-layer.ts` into mesh kit / deck table / bridge, telemetry and picking out of `bootApp`, a home for the TSL helpers, the terrain↔water cycle, the dead-code sweep | **TODO** — P3; after 039, 041–043 | [046-split-the-god-modules-and-sweep.md](./046-split-the-god-modules-and-sweep.md) |
| 047 | Spike: "Problem melden" — the crash report with a destination, the view only on opt-in | **TODO** — spike; maintainer answers needed at its step 3 | [047-spike-report-a-problem.md](./047-spike-report-a-problem.md) |
| 048 | Spike: a view as a `?snap=` link; committed QA views for plan 019 | **TODO** — spike + small build | [048-spike-view-links-and-qa-views.md](./048-spike-view-links-and-qa-views.md) |
| 049 | A queryable twin: object ids and semantics in the tileset, the provenance manifest, asking by a click or a long press, the card | **PARTIAL** — 1–3 built (2026-09-27; ten fact columns, +3.5 % per building tile; OSM names, addresses, storeys re-baked on fifteen tiles; a click asks (no mode since 2026-10-01); since 2026-09-28 a long press asks, taps are tolerant, a bottom sheet on touch); the hatch unjudged on a GPU; 4–7 open (trees, bridges, a link, a Datenstand panel, ingest-written provenance) | [049-queryable-twin.md](./049-queryable-twin.md) |
| 050 | Time and live sources: the day plays, weather sets the mood, the Elbe follows its gauge | **TODO** — static where possible (ADR 0001 amended); CORS of each source to verify first | [050-time-and-live-sources.md](./050-time-and-live-sources.md) |
| 051 | Scenarios in the scene's own hand: flood, sun hours, sight lines, a planned building | **TODO** — TSL terms on the terrain and clay graphs | [051-scenarios.md](./051-scenarios.md) |
| — | Aesthetic and visual fine-tuning roadmap (ten items) | DONE except atmospheric motes | [completed.md](./completed.md#aesthetic-and-visual-fine-tuning-roadmap--done-except-motes) |

## Open work

**Direction since 2026-09-27: a digital twin with an aesthetic claim.**
The maintainer set it and fixed two rules: the app stays **static where
possible** (ADR 0001, amended), and **text appears only in a card, on
demand** — the scene stays wordless (ADR 0037). Plans 049 (ask the city),
050 (time and live sources) and 051 (scenarios) carry it; plan 019's GPU
pass comes first for them too, since every new look is unjudged there.

Ordered by leverage. Everything here is vetted against the code; effort
S/M/L.

0. **Plans 037–048 (2026-10-01 audit) — before the items below.** Order:
   037 (every executor runs its commands) → 038 → 040 → 039 → 041 → 042 →
   043 / 044 (each behind a measurement gate) → 045 → 046 (moves only,
   after 039 and 041–043, which edit the same files). The spikes 047 and
   048 can go any time after 038. Plan 019 (item 1) stays the one that
   needs a GPU; 039 step 4 and 048 part B add to its checklist. Plan 022
   (the four tiles' re-bake) waits for 040 step 1; plan 017 phase C waits
   for 045.

1. **Plan 019 (M, GPU) — the one GPU checklist.** Everything since the 3D
   Tiles switch was verified headless only. Since 2026-10-01 every "look
   unjudged on a GPU" of the condensed plans (023–035) and of the backlog
   is a ticked item there, grouped by feature; the plans' records in
   [completed.md](./completed.md) point to it.
2. **Plan 017, the rest (M–L).** Rewritten 2026-10-01 for the Python
   pipeline: the NRW adapter, a second site and per-tile provenance (A),
   NAS input (B), OSM land cover as a class raster (C, after plan 045),
   row-only trees without DOM1, `site:check`, every site in the tests (D).
3. ~~**Plan 020 (L, GPU-gated).**~~ Done 2026-09-26: WebGPU + TSL, every
   `onBeforeCompile` patch and both post libraries gone
   ([completed.md](./completed.md#020--webgpurenderer-and-tsl-node-materials--done-2026-09-26)).
   Its GPU look is item 1's.
4. ~~**Plan 008, steps 5–6 (S).**~~ Closed 2026-10-01: the coverage
   artifact is plan 037 step 7b, the remaining fixture checks plan 041
   step 5b.
5. **Plan 021 (M, maintainer-gated).** `/wissen` on Starlight: about 2 000
   lines of hand-built docs site out, search in.
6. **Pixel-ratio drop while moving (S, GPU).** Plan 007 step 4:
   `setPixelRatio` reallocates every render target, so hold ~1 s before
   restoring; judge on a real GPU.
7. **Atmospheric motes (S, GPU).** The one unbuilt item of the aesthetic
   roadmap. Design: 2–4 k camera-local billboards — not `Points`, which
   WebGPU draws 1 px wide; an `Instances` quad under a
   `PointsNodeMaterial`, as the lamp halos — with a toroidal wrap on the
   camera-relative offset (R ≈ 30 m) in the `positionNode`, additive,
   `depthWrite: false`, `depthTest: true`, `fog: false` (the scene's fog
   node would brighten distant motes), hash-seeded for reproducible
   snapshots, one slider driving opacity *and* `drawCount`, a
   `sceneMaterial`. +1 draw call, sub-0.1 ms of JS; vertex-stage-only
   beyond ~8 k motes. Ledger: 📋 planned #10.
8. **Water and mist sheets draw the whole terrain geometry (M, bake +
   GPU) — re-measure before doing.** The ≈7.3 M of ≈10.9 M triangles were
   counted on the old 1024² grid (before ADR 0024/0030). The sheets now
   hang on the fine level's TIN (0.30–0.49 M triangles per tile, against
   ≈2.1 M for the grid), so the cost is roughly 4–5× smaller than stated;
   count again on a GPU before ranking it. Fix if still worth it: a
   water-only index buffer over the shared positions, written into the
   terrain glTF as a second primitive from the class raster.
9. ~~**Far crown LOD tier (S–M, GPU).**~~ Done: `lib/city/vegetation-lod.ts`
   has a `far` tier (80 triangles, no trunk, from `FAR_IN_M` = 650 m);
   ledger 📋 #11 says shipped. (Found stale by the 2026-10-01 audit.)
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
    (`PostStack.compile`; since plan 020 against the scene pass's own
    target, one drawable per material and attribute layout). Open: the
    shadow pass's pipelines for new casters still build in-frame, and the
    WebGL2 backend compiles synchronously (ADR 0027).
13. **Bundle: `proj4` for one conversion (S).** A 40-line UTM inverse for
    zones 32/33 replaces it (`lib/city/crs.ts`). Size unmeasured.
    (`GLTFLoader` is load-bearing now: every tile is glTF.)
14. **Split the `create-app.ts` closure (L; 1 598 lines at `a28de75`).**
    Partly done 2026-09-26: the ground (`lib/city/ground.ts`) and the
    second boot phase (`lib/city/boot-phases.ts`) left the closure.
    Telemetry and picking: [plan 046](./046-split-the-god-modules-and-sweep.md)
    step 2. Left after it: lamps and the scene-wide state the dressings
    bind — see item 20.
15. **One `densify` (S–M) — mostly done.** `lib/city/polyline.ts` holds
    `subdividePolyline` and `samplePolyline`; what is left is the two
    arc-length tables (`lib/city/stairs.ts`, `lib/city/fences.ts`), which
    belong to item 21.
16. **Pure-helper tests (S each, when a module is next touched).**
    Rail and vegetation now have tests (`rail-layer.test.ts`,
    `vegetation-layer.test.ts`, ≈ 90 % lines). Left: lamps and walls'
    runtime halves; `collision.ts`, the tile cache's weighing and the
    terrain's TIN-height glue (`terrain-layer.ts` `tinHeightAt`,
    `waterGeometryOf`) — the first two in
    [plan 041](./041-test-net-for-lifetime-and-collision.md), the last
    open. (`prepare-data`'s cache is content-keyed and tested since
    2026-09-26: `scripts/bake-sources.ts`.)
17. **`dispose()` leaves stray textures to the GC (S).** Mostly closed:
    the sun rig frees the shadow map, the post stack its target and
    pipelines, and the teardown disposes the renderer (its device, or on
    the WebGL2 backend its context). Left: a texture whose layer does not
    free it waits for the GC (`disposeObject3D` never reaches textures).
    Bounded today (only dev/CI unmount).
18. ~~**Materials whose GLSL depends on `heightFog` but whose cache key
    does not (S).**~~ Moot since plan 020: fog is one `scene.fogNode`, and
    there are no cache keys to keep.
19. **Low-confidence, investigate not fix:** NoData next to valid samples
    in the terrain bake's resample (`scripts/bake-tiles.ts`); the lowest
    terrain bound (with the 30 m skirt) as the ground fallback; the
    joystick releases on any `pointerup`; the `crs.ts`
    trailing-slash regex.
20. **One scene environment the dressings bind at birth (M).** Half done
    by plan 020: the per-tile copies are gone. Scene-wide values are
    uniform nodes every tile's materials share — the sun, the ground rows,
    the fog (`scene.fogNode`), the crowns' look and wind clock
    (`sceneCrowns`), and module-level nodes for the lamps' night, the
    fountains, the furniture and the map overlay (the old
    `FOUNTAIN_UNIFORMS`/`FURNITURE_UNIFORMS`/`MAP_OVERLAY_UNIFORMS`
    objects). Left: `create-app.ts` still loops over every dressing on a
    change (the lamps' night, the vegetation's look and per-frame clock),
    now writing the same nodes once per tile, and `catchUp`
    (`tile-stream.ts`) still brings a dressing that was compiling up to the
    present (season, look, night). One environment object bound once
    would delete the loops and shrink `catchUp` to the per-dressing state
    (the season's instance buffers, the rich-crown toggle).
21. **A geometry kit for what stands on the ground (M).**
    Seven triangle-soup writers decide the winding rule in four ways
    (rail's `pushTri` auto-winds to the normal, furniture's `addSlab`,
    `kerbs.ts` reorders, `walls.ts` is double-sided, `fences.ts`,
    `stairs.ts`, `small-buildings.ts`), and `rail-layer.ts` is the geometry
    library of `tram-layer.ts` and `riverside-layer.ts`. One pure module
    (soup accumulator with one winding rule, ribbons, footprints, columns,
    the resamplers) used by the runtime layers and the bakes. Deferred on
    2026-09-26 until the WebGPU port had rewritten those files (done);
    unifying the winding changes baked geometry — needs its own earcut
    (`lib/city` forbids `three`) and a headed shot comparison.
22. **One terrain raster loader driven by the artifact table (M).** The
    artifact table (`lib/city/tile.ts`) now names the dressing, sound and
    OSM files, but the terrain's rasters still go their own way:
    `prepare-data.ts` spells their names into the terrain extras by hand,
    and `terrain-layer.ts` has one loader per raster (splat, NDVI, paving,
    edges, sports grounds, colonies, markings) plus the detail-raster
    bookkeeping. A raster column in the table (level,
    channels, filter, mipmaps) would let one loader serve them all.
    Deferred on 2026-09-26 until the port had rewritten the loaders; it
    kept them as `DataTexture` loaders bound to node textures, so this is
    unblocked.
23. **A dressing's layers declare the ground they stand on (S–M).**
    `DRESSING_PARTS` (`tile-stream.ts`) names each part once, but which
    ground a layer samples — its own tile's terrain or the height over
    every loaded terrain — is still chosen per call in `buildDressing` and
    explained only in comments; the layers' ground context does not say
    which. A layer entry carrying its artifact kinds, its ground and its
    build function would put the choice in the interface and let
    `buildDressing` get a unit test with a fake fetch and a fake ground;
    today only the e2e layer census covers that wiring.
24. **Leftovers of the 2026-09-26 refactors (S each).** The first frame is
    still awaited by a 50 ms `setTimeout` poll in `create-app.ts`;
    resolving it from the stream's change handler drops the poll.
    `SceneSidebar` still takes the scene time as five props although
    `useSceneTime` (`scene-time.ts`) owns it; a context removes them.
25. **Small follow-ups the condensed plans left (S each; 2026-10-01).**
    Vine rows ignore the season although plan 025's plumbing exists
    (`cultivated-layer.ts` takes no date: bare canes in winter, leaf-out
    with the calendar); canopy and row trees (species unknown) follow the
    generic season curve and hedges none — a per-class curve if plates in
    plan 019 ask for it; a site without a tree cadastre gets no OSM trees
    (an OSM-only `trees` artifact is a small change in `trees.run`); the
    official listed-building flag (the city's WFS `L1544`, rank 1 of the
    [data-streams survey](../data-streams.md)) instead of the OSM heritage
    join; tram tracks have no ground-join test (ADR 0035: a runtime part is
    tested with `checkJoins`).

### 2026-10-01 audit (`improve deep`, against `a28de75`)

Eight parallel auditors (spine, layers and geometry, build and bakes,
security and dependencies, performance, tests and DX, architecture, docs
and direction), every finding re-opened in the code before it was ranked;
the WebGPU port and the 97 commits since the last run were in scope.
Baseline green: `bun run verify` (1 051 unit tests), pipeline pytest
(224). The maintainer picked eight bundles → plans 037–046 — and two
direction options → spikes 047–048. Vetted but **not planned** (backlog,
S each unless noted):

- **Supply chain of agent sessions.** The vendored skills run unpinned
  tools (`.agents/skills/shadcn/SKILL.md`: `npx shadcn@latest` in
  `allowed-tools` and a load-time `!` command; `modern-web-guidance`:
  `npx -y …@latest`; `web-design-guidelines` WebFetches its rules from a
  `main` branch); the session hook installs Bun with `curl | bash`
  (`.claude/hooks/session-start.sh:36`, version pinned, no checksum);
  `pipeline/pyproject.toml` pins `pillow==11.3.0` (18 HIGH OSV advisories,
  fixed in 12.x; reached only by offline bakes on self-made rasters). No
  secrets in the tree or history; no prompt-injection content found.
- **Latent: DGM NoData blended by the resample.** `scripts/bake-tiles.ts`
  `readDgm` resamples bilinear before testing for NoData, so a hole would
  blend −9999 into pits; all fifteen committed DGMs have none. Fix when a
  tile with holes arrives (mask first, or fail loudly).
- **One path bridge at the site's west edge is drawn by no tile** (its
  ring's mean lies outside the site, `bridge_33408_5656`); the same
  centre-ownership rule governs sheds, stairs and tram spans.
- **Investigate on a GPU (plan 019):** the three always-present lamp
  `PointLight`s are shaded by every lit fragment by day (intensity 0);
  `WebGLRenderer`/GLSL may ride into the viewer chunk through
  3d-tiles-renderer's metadata `TextureReadUtility` (plain `three`
  import) — check with a bundle analyser.
- **Small robustness:** only `postStack.render` is guarded in the frame
  loop (a throw before it freezes silently while the crash trail writes
  on every error); the stream's `dispose()` during an in-flight compile
  leaves a dressing to attach to a disposed stream (teardown only);
  style-dressing siblings dispose a shared geometry's buffers on every
  tile release (re-uploaded by the next frame — churn, not a bug);
  vegetation LOD re-plans and allocates every frame though only camera
  movement can change it.
- **Docs:** the crash trail is undocumented in the guide and ADR 0001
  (folded into spike 047); `cityjson-threejs-loader` 0.4.0 is unmaintained
  (last release 2023) — on a three bump, a cold `prepare-data` is its
  canary; replace only when it breaks.

### 2026-09-26 audit (`improve deep` + architecture review, PR #67)

Done on PR #67: the build cache keyed on contents and the bake's import
graph; one artifact table (`dressing`, `sound`, `osm` columns) with a 512²
minimap/soundscape raster and the ODbL credit tested; the NDVI sampler
byte-exact and dressing fetches abortable; a dressing's parts as one
named table; the ground and the second boot phase out of `create-app.ts`;
the scene's time as one hook; `Tile.classes()`/`Tile.neighbours()` in the
pipeline with tests for the four untested bakes; checked downloads;
Pillow-13-ready PNG writes; one `clamp`; stale remnants swept.

Open from this run: items 20–24 above (20–22 no longer wait for the
port) and the direction options 7–9
below; what was considered and dropped is under "Rejected". The raw
reports (the ranked list, the audit's finding details, the architecture
review with its before/after diagrams) were not committed: this section,
those items and the rejected entries are their record.

**For the WebGPU port (plan 020).** The run left out every file the port
rewrites. What it found there, checked in the code at `2ed5ab1`, and what
the port (2026-09-26) made of it:

- Plan 020's drift check counted 15 `onBeforeCompile` sites in 7 files;
  the tree had 26 in 17 files, 12 of them with a
  `customProgramCacheKey`, several keyed closures branching on
  `heightFog` (item 18). *Outcome:* 33 sites in 19 files by the port, all
  replaced by node materials; fog is one `scene.fogNode`, item 18 moot.
- The terrain's fragment pass spliced GLSL chunks from `ground-detail.ts`,
  `sport-ground.ts`, `road-markings.ts` and `cultivated-layer.ts` that
  shared locals by name, in a fixed order, under a program key of ten
  flags (`createTerrainMaterial` in `terrain-layer.ts`). *Outcome:* node
  functions (`groundDetail`, `colonyGarden`, `sportGround`,
  `roadMarkings`) called in order on one shared set of ground inputs and
  colour fields; no key.
- The material-only layers of the baked nodes (`wall-layer.ts`,
  `kerb-layer.ts`, `stair-layer.ts`, `fence-layer.ts`) differed only by
  colour, side and shadow flags. *Outcome:* each is one
  `groundLitMaterial(params, light, skyView)` call (`sky-light.ts`), the
  ground's baked light included.
- Crown materials were built per tile (`vegetation-layer.ts`,
  `crown-season.ts`). *Outcome:* one pair per scene (`sceneCrowns`, a
  `sceneMaterial`), their uniforms shared; the seasonal crown thins its
  shadow through `maskNode`, no depth material.
- The painted land-cover target is the class raster's full size and is
  painted for both terrain levels, so two painted rasters per tile can be
  resident; size it to the level. *Still open* (the paint pass is one
  scene-wide node material per raster size now; the target size is
  unchanged).
- The NDVI texture is loaded per terrain level instead of shared through
  `shared-rasters.ts` like the sky view; one decode per tile could serve
  both levels and the crown sampler. *Mostly done (44c4111, found by the
  2026-10-01 audit):* the texture is shared by both levels
  (`DressingPlugin.ndvis`); the crown sampler (`loadNdviSampler`) still
  decodes the PNG a second time per tile (S).
- The tile cache's byte budget (`tileCacheBytesFor`) is filled from
  3DTilesRendererJS's estimate, taken once per tile when it loads: its
  geometry and the textures on standard material slots. The dressing,
  built later, and the terrain's textures bound as node textures are not
  counted. The renderer asks plugins through `calculateBytesUsed`, so the
  dressing plugin could report them. *Done (44c4111, fe1bee4):*
  `DressingPlugin.calculateBytesUsed` weighs the rasters (a raster two
  levels share half each) and the dressing; tests in
  [plan 041](./041-test-net-for-lifetime-and-collision.md).
- Demolish replaces the city mesh's index attribute (`city-layer.ts`)
  without disposing the old one. *Re-checked under the node renderer:*
  its `Geometries` also frees only the current index when a geometry is
  disposed, so each demolish's old buffer still waits for the GC. Still
  open (S).
- Items 20 and 21 above were to go inside the port or after it; they no
  longer wait for it.

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
2. **Shareable view links (S–M) — now [plan 048](./048-spike-view-links-and-qa-views.md)
   (spike), and cheaper:** the boot already restores a Snapshot string
   after the first frame (the GPU recovery), so `?snap=` is a second source
   for that hook. The Snapshot codec is versioned and
   validated; the URL reads are `scene`, `gpu`, `block` and `trail`. A `?snap=<base64>` read once
   after `ready` and written on Copy turns "this corner at 08:00 on
   21 December" into a link and collapses the shot harness to `page.goto`.
   Trade-off: URL length (~600 chars with every slider) vs. camera + date
   only; throttle `replaceState` on drags. Would supersede part of
   [ADR 0001](../adr/0001-client-only-static-app.md)'s "nothing persisted".
3. **Guided tour / attract mode and a day-cycle play button (S–M).**
   Nineteen authored viewpoints (`sites/dresden.ts`), the picture styles, an arc tween and cancel-on-input exist; nothing
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
6. ~~**A provenance manifest per tile (S).**~~ Now plan 017 phase A step 3
   (the ingest adapter writes `data/<site>/<tile>.provenance.json` from the
   values its checked downloads already know). The client side is built:
   the card's provenance manifest, derived from the hand-kept record at
   build time (plan 049 phase 2).
7. **Offline repeat visits: a service worker over the tileset (S–M).**
   [ADR 0007](../adr/0007-content-hashed-publishing-with-a-manifest.md)
   already makes every `/data/*` file immutable and content-hashed, with
   `manifest.json` the one `no-cache` entry, so a service-worker cache is
   bounded and updates itself: repeat visits boot from disk, a walk
   survives a tunnel, the site becomes installable. The browser's HTTP
   cache evicts a site this size first. Trade-offs: storage quota on
   phones, an explicit update path (re-read the manifest). A cache is not
   user state, but ADR 0001's "no persistence" wants a sentence on it.
8. **Dressing built off the main thread (L).**
   `buildDressing` fetches, parses and builds about seventeen layers per
   tile on the main thread; 3DTilesRendererJS decodes its glTF in workers,
   the dressing is ours. A worker returning transferable arrays (instance
   matrices, positions) is renderer-agnostic; the port settled the
   instancing formats (`Instances`: one Float32 buffer of 16 floats per
   instance, a Float32 RGB tint attribute, extra per-instance floats as
   named attributes). The cheaper interim is done (efae831: the builders
   run in separate tasks, `tile-stream.ts` `nextTask`); what is left is the
   worker itself. Plans 043 (the city BVH) and 044 (the canopy as a packed
   binary) take the two biggest single tasks off first.
9. **A bilingual HUD (M).** The page is `lang="de"` since 2026-09-26: the
   HUD, the spoken feedback and the `/wissen` landing are German, while
   the guide comes in both languages. About sixty HUD strings, picked by
   `navigator.language` or a `?lang=`, including the `aria-label`s and
   the spoken feedback, would follow the guide's pairing.
10. **"Problem melden" (S) — [plan 047](./047-spike-report-a-problem.md)
    (spike).** The crash panel says "copy and send it on" but names no
    destination; a prefilled report (the trail; the view only on opt-in)
    closes the loop the crash trail was built for. (2026-10-01.)
11. **A recovered page starts one memory step down (S).** The memory
    governor always starts at level 0, so a phone reloads after a lost
    GPU into the same load that killed it; starting the recovered session
    at level 1 (`lib/city/memory-governor.ts` `MEMORY_STEPS`) would make
    recovery stick, and makes option 5 (a quality tier) a starting level
    plus the scene-profile tuple. Offered 2026-10-01, not picked; plan
    038 step 3 stops the reload loop either way.
12. **Committed QA views (S) — [plan 048](./048-spike-view-links-and-qa-views.md)
    part B.** Plan 019's reference views have no coordinates and eleven
    rows say "look unjudged on a GPU"; `qa/views/*.json` read by the shot
    harness makes GPU passes repeatable. (2026-10-01.)

### Maintainer actions

- Run plan 019 on a GPU machine (the 3D Tiles branch is long merged;
  the look of everything since is unjudged on a GPU).
- Re-bake the remaining DLM/DOP products with the current editions:
  [plan 022](./022-rebake-current-editions.md).
- Plan 021's Phase 0 (a second framework for `/wissen`, the URL scheme).

- Close the superseded Dependabot PRs (#3, #12, #13, #15, #26).
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
  `onBeforeCompile` an escape hatch (moot since the TSL port, the rest
  stands); the `__poc` handle rebuilt on a store; a static-after-load
  scene is r3f's weakest case
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
- **Street and square names as text** (lettering on the ground, a HUD
  caption) — plan 032, built and removed on 2026-09-26 after the
  maintainer saw it on a device: the map look reads better without text
  ([completed.md](./completed.md#032--street-names-lettering-and-the-on-foot-caption--rejected-removed-2026-09-26),
  🗃️ in the [ledger](../transformations.md)).
- **Data not worth reading** (measured in plan 036): Wikidata heights,
  floors, style and architect (≤ 10 %), OSM `start_date` (0.5 %) and
  `roof:colour` (the DOP measures roofs), LoD2 storey and eave attributes
  (≈ 2 %), LoD1/DOM2/DGM2.
- **Held back deliberately:** `n8ao` 2.x and `postprocessing` 7.x — moot:
  both libraries left with plan 020 (three's node post replaced them).
- **Patching three's renderer internals** to fix node-build stalls (the
  plan 020 spike's render guard, shared-instancing patch and
  render-context override) — fixed stalls on paper, depended on private
  members, misbehaved in ways that could not be pinned down; replaced by
  public-API designs ([ADR 0027](../adr/0027-webgpu-renderer-and-tsl.md)).
- **A WebGLRenderer fallback beside WebGPU** (the spike's gate
  recommendation) — every look written twice; the maintainer chose one
  path, the WebGL2 backend of `WebGPURenderer` as the fallback.
- **From the 2026-09-26 run:**
  - *Clay materials leaking when a tile unloads* — refuted:
    3DTilesRendererJS collects a tile's materials after `processTileModel`,
    so the swapped clay is disposed with the tile.
  - *Malformed OSM numeric tags crashing a bake* — every tag parse is
    guarded or goes through a regex.
  - *Atomic GeoJSON writes in the bakes* — a truncated file fails
    `features.test.ts` and `tile-data.test.ts` before it ships; the bakes
    run on the maintainer's machine.
  - *`rehype-raw` in `/wissen` as an HTML sink* — it renders the repo's
    own `docs/` at build time only.
  - *Sharing the furniture models across tiles* — one tile's unload would
    dispose another tile's geometry. *One bridge deck table for rail and
    tram* — it saves microseconds per tile.
  - *Deep as they are* (architecture review): the look table, store and
    Snapshot codec (ADR 0017); `fetch-optional.ts`; `shared-rasters.ts`;
    `TinIndex` (one implementation, two adapters: bake and viewer);
    `camera-pose.ts`; `city-layer.ts` with `city-mesh.ts`; the bake ↔
    viewer contract tables pinned by `features.test.ts`, `test_bakes.py`
    and `test_committed.py`; the per-layer tests that go through
    `buildX(features, ctx)` with a fake ground.

- **From the 2026-10-01 run:**
  - *`bun dev` serving HTTPS only* — a maintainer decision (WebGPU on a
    phone over the LAN needs a secure context, `efae831`); plan 037 fixes
    the test side instead. *`allowedDevOrigins` with a LAN IP* — dev
    only, the same decision.
  - *`bun run verify` not running pytest/ruff* — CI's pipeline job gates
    it; no fallout in the history.
  - *The memory governor's hysteresis, shadow-fit octaves, storage access
    (all try-wrapped), StrictMode cleanup, iOS permission calls, Snapshot
    NaN* — checked, correct.
  - *Seam handling of bridges, determinism and overflow in the bakes, the
    `prepare-data` cache key, zip-slip in the ingest, the TS ↔ Python
    feature contract* — checked, sound.
  - *Regrouping `app/_components` into folders* — import churn across
    ≈ 110 files for orientation AGENTS.md already gives.
  - *Version lag* — none: three, 3d-tiles-renderer, three-mesh-bvh,
    TypeScript 7, oxlint, mermaid at npm latest; `next` one patch behind.

## What the audits did not cover

Internals of `components/ui/**` and the vendored skills (scanned for
prompt-injection content only); `data/**` beyond names, sizes, counts,
geometry types and property keys; anything executed (the audits ran with
no `node_modules`; CI's green run was the baseline); real-GPU behaviour
(every shader and fill-rate statement is reasoned from the three.js r186
source); the production deploy environment. The 2026-09-26 run also left
out everything the WebGPU port rewrites (the GLSL patch sites, the splat
pass, the post stack, the renderer construction and preflight, the sky
and lamp-halo materials, the vertex formats), and each of its audit
categories had one reader. The 2026-10-01 run ran the tests (unit, pipeline, coverage)
but no e2e and no `next build`, and read the WebGPU port's code but could
not render it (no GPU, no WebGPU in Bun).

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
- **2026-09-25**: plans 024–035 written as one batch of data → scene
  features (OSM, the DGM, the laser scan), in the order 033 → 027 phase 0
  → 024, 030 → 026, 029 → 027, 031 (032 built and removed) → 025, 028,
  034 → 035; all built by 2026-09-26, condensed on 2026-10-01.
- **2026-09-26 run** (against `d613345`): `improve deep` and an
  architecture review (`improve-codebase-architecture`) ran in parallel
  and were merged into one ranked list, scoped around the WebGPU port
  running at the same time. Eleven audit findings and eight architecture
  candidates; the renderer-agnostic ones were implemented on PR #67
  (sixteen commits, three review rounds). Open: items 20–24 and the
  direction options 7–9; the port-side notes are in the "2026-09-26
  audit" section.
- **2026-09-26, the WebGPU/TSL port**: the maintainer asked for the whole
  of plan 020 with no second path; the spike branch (internal patches)
  was set aside and the port restarted from `main`, several agents
  porting the layers side by side against one contract. ADR 0027
  accepted; plan 020 condensed into [completed.md](./completed.md); the
  port-side audit notes above got their outcomes.
- **2026-10-01 run** (against `a28de75`, `improve deep`): eight parallel
  auditors over the 97 commits since the last run, the WebGPU port
  included; findings vetted in the code. The maintainer picked plans
  037–046 and the spikes 047–048; backlog items 8, 9, 14–16 and two port
  notes reconciled (item 9 and the cache weighing were already done);
  what was left out is in the "2026-10-01 audit" section and under
  "Rejected".
- **2026-10-01, plan cleanup** (on the same PR, after merging ADR 0035):
  every open plan checked against `main`. Thirteen plans condensed into
  [completed.md](./completed.md) and deleted (008, 023–031, 033–035 —
  built, or closed with the rest rejected or moved); their GPU looks
  collected in plan 019, rewritten as the one GPU checklist; 017 trimmed
  to its open half and rewritten for the Python pipeline; 022 re-scoped to
  the four original tiles; 036 moved to
  [docs/data-streams.md](../data-streams.md) (a survey, not a plan); the
  new plans 037–045 refreshed against `main`; ledger 📋 #12 and two 🗃️
  rows (raised pavement, micro-relief) updated.
