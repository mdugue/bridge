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
| 017 | Any German city: site config, per-Land ingest adapters, NAS input, OSM land cover as a DLM substitute | **PARTIAL** — site config, Python bake package and the Saxony adapter built; plans 049 and 051 built most of phases A, C and D in their own shape (providers for SN, NW, BY, HH, BE; per-site data and provenance; OSM land cover, rails and decks; `bun run site <site>`; every site in the tests); open: B (NAS), D.1 (row-only trees without DOM1), a first run of Berlin's adapter | [017-germany-wide-sites.md](./017-germany-wide-sites.md) |
| 018 | Stream tiles around the camera: tile manager, loader worker, 1 km near cells, KTX2 splat | REJECTED — superseded by 3D Tiles + 3DTilesRendererJS (ADR 0024) | [completed.md](./completed.md#018--stream-tiles-around-the-camera--rejected-superseded-by-adr-0024) |
| 019 | **The one GPU checklist**: backends, palette, quantisation, LOD and seams, shadows, GTAO and sky light, picture styles, frame time and memory, phones, deploy host, and the feature plates of plans 023–039 | **TODO** — needs a GPU and two phones; rewritten 2026-10-01; section M, the phone crash fixes of 2026-10-06 (ADRs 0046–0048), added | [019-gpu-verification.md](./019-gpu-verification.md) |
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
| 037 | The commands agents run work (`bun run build`/`test`, E2E_DEV over HTTPS), the skill's phone cache numbers, "1024²" → TIN, guide viewpoints and sizes, codebook pointers, Dependabot/CI paths, lockfile header; a test pins the guide to the HUD | DONE (2026-10-03) — `bunfig.toml` keeps a bare `bun test` out of e2e; coverage gaps listed in CI; a docs link test besides the guide test | [completed.md](./completed.md#037--the-commands-agents-run-and-docs-that-say-what-the-code-does--done-2026-10-03) |
| 038 | Runtime spine: the shadow camera follows by night (no pinned tile), "loaded" without a spawn dressing nobody builds, no GPU-recovery loop and the crash it hid, no stuck key after a ⌘ chord, a jump ends live mode | DONE (2026-10-03) — step 2's decision moved into the pure boot machine; the GPU failure has its own HUD path | [completed.md](./completed.md#038--five-runtime-fixes-in-the-viewers-spine--done-2026-10-03) |
| 039 | Bridge approach ramps without zero normals, rails passing under a rail deck stay down, Papier keeps double-sided ribbons and bare crowns, Sin City rain that lasts | **TODO** — P1/P2; step 4 needs a GPU look; **step 3 moot since ADR 0041** (2026-10-06 audit: `buildRails` goes through `lineLevelsAt`, commit 677fe7c) and the line refs of steps 1/4 moved — see the plan's amendment | [039-geometry-and-style-fixes.md](./039-geometry-and-style-fixes.md) |
| 040 | Bakes: step-major `bun run bake`, seam stair flights kept, atomic ingest + timeouts + https check, atomic `prepare-data` writes, the `/wissen` hero as tall as the site | **TODO** — P1/P2; the stairs then need a re-bake (maintainer); **drifted** (2026-10-06 audit): its step bodies cite `scripts/bake.ts`, `ingest_sn.py`, `test_ingest.py` (gone — `scripts/pipeline.ts`, `fetch.py` + `providers/`, `test_fetch.py`), the runner takes one JSON spec, step 3 is partly done (`net.py` timeouts, `.part` writes), step 5 appears done (`bake-wissen-hero.ts` `cell * rows`); refresh before executing and fold in the bake runner's order test — see the plan's amendment | [040-bake-pipeline-fixes.md](./040-bake-pipeline-fixes.md) |
| 041 | Test net: raster shares and the aborted-load free, the collider through a real BVH, census for stairs/sport/kerbs, eye height vs the DGM, pens per style, three's real geometry key | DONE (2026-10-03) — raster shares in their own module; tree rows left allowed empty (Grimma, Munich) | [completed.md](./completed.md#041--tests-where-the-regressions-are--done-2026-10-03) |
| 042 | Main thread while streaming: stats coalesced, footprints only when they change (no minimap repaint per tile event), footprints after the handover, the viewer chunk fetched with the manifest | DONE (2026-10-03) — the first frame and "loaded" flush the coalesced stats | [completed.md](./completed.md#042--less-main-thread-churn-while-tiles-stream--done-2026-10-03) |
| 043 | The city BVH in a worker (≈ 80 ms per tile on desktop today) | **BLOCKED** (2026-10-03) — gate passed (BVH median 75 ms a tile), the worker built and tested, but Next 16.3.7's Turbopack emits `new Worker(new URL(…))` as a raw asset; three options in the plan's findings | [043-city-bvh-off-the-main-thread.md](./043-city-bvh-off-the-main-thread.md) |
| 044 | The canopy points as a packed binary instead of a 9.5 MB GeoJSON parsed in one task | DONE (2026-10-03) — 96 ms of JSON.parse → ≈ 13 ms to unpack on the biggest tile; published pre-gzipped (`.pts.gz`) | [completed.md](./completed.md#044--the-canopy-points-packed-not-geojson--done-2026-10-03) |
| 045 | One source for the raster decoders (the stale `surfaceHeading`) and the Python class ids; one OSM number parser; the byte scales pinned across languages | **TODO** — P3; before plan 017 phase 4 | [045-one-source-for-decoders-and-class-ids.md](./045-one-source-for-decoders-and-class-ids.md) |
| 046 | Moves only: `rail-layer.ts` into mesh kit / deck table / bridge, telemetry and picking out of `bootApp`, a home for the TSL helpers, the terrain↔water cycle, the dead-code sweep | **TODO** — P3; after 039, 041–043; **drifted** (2026-10-06 audit): the deck table moved to `lib/city/decks.ts` on the day 046 was planned, `rail-layer.ts` is 2 485 lines with the span-deck code (ADR 0041) and two more importers (`traffic-layer.ts`, `data-overlays.ts`), `bootApp` doubled to ≈ 2 050 lines (plans 060/066 take its GPU-loss slice); refresh its drift block before executing — see the plan's amendment | [046-split-the-god-modules-and-sweep.md](./046-split-the-god-modules-and-sweep.md) |
| 047 | Spike: "Problem melden" — the crash report with a destination, the view only on opt-in | **TODO** — spike; maintainer answers needed at its step 3. Crashes now also go out on their own where a DSN is set (ADR 0043); what is left is the view on opt-in and a destination for deploys without a DSN | [047-spike-report-a-problem.md](./047-spike-report-a-problem.md) |
| 048 | Spike: a view as a `?snap=` link; committed QA views for plan 019 | **TODO** — spike + small build | [048-spike-view-links-and-qa-views.md](./048-spike-view-links-and-qa-views.md) |
| 049 | Many sites: providers, per-site data, `bun run fetch <site>` → `bake` → build, eight sites with viewpoints; one deployment with a route per site (`/dresden`) and a start page to pick the city | **DONE** (2026-10-01) — Berlin's adapter untested; committing sites other than Dresden is the maintainer's call | [049-many-sites-one-env-var.md](./049-many-sites-one-env-var.md) |
| 050 | Landmarks and what LoD2 leaves out: DOM1 gaps named by OSM (chimneys, towers, masts, missing buildings, a landmark's roof relief), OSM materials and colours in the clay palette, Wikidata landmarks in the HUD | **BUILT** (2026-09-28) — all three parts, baked on the seven committed sites: 386 columns, 920 missing buildings, 508 relief slabs on 74 landmark objects, 310 landmarks; the relief a measured height field since 2026-09-30 (re-bake `structures` everywhere), towers LoD2 draws no longer doubled; look unverified on a real GPU; since 2026-10-01 a tile's landmarks are those with ≥ 8 % of its top sitelinks (the *Dense tiles* item, plan 051) and the relief stands on the roof under each cell (Unna re-baked) | [050-landmarks-and-gaps.md](./050-landmarks-and-gaps.md) |
| 051 | Stand-ins where a Land publishes less (OSM rails and decks without a DLM, a visible-band vegetation index without infrared, tree registers per city, Bavaria's laser scan), marked in a generated *Sources by city* page; looks derived from each city's data (facade context, valley-haze depth, tram gauge, landmarks per tile) instead of per-site switches | **BUILT** (2026-10-01) — Hamburg's 348 decks and 81 km of track, Hamburg's and Leipzig's registers, Munich's GLI baked; `osm-buildings`, `landmarks` and `structures` still to re-bake on most sites; Berlin not built; looks unverified on a real GPU | [051-stand-ins-and-derived-looks.md](./051-stand-ins-and-derived-looks.md) |
| 052 | A queryable twin: object ids and semantics in the tileset, the provenance manifest, asking by a click or a long press, the card | **PARTIAL** — 1–3 built (2026-09-27; ten fact columns, +3.5 % per building tile; OSM names, addresses, storeys re-baked on fifteen tiles; a click asks (no mode since 2026-10-01); since 2026-09-28 a long press asks, taps are tolerant, a bottom sheet on touch); the hatch unjudged on a GPU; 4 built 2026-10-01 (trees with the register's facts, monuments, bridges; one screen-space outline for every kind); 4b–7 open (aim and ask, a link, a Datenstand panel, ingest-written provenance) | [052-queryable-twin.md](./052-queryable-twin.md) |
| 053 | Time and live sources: the day plays, weather sets the mood, the Elbe follows its gauge | **TODO** — static where possible (ADR 0001 amended); CORS of each source to verify first | [053-time-and-live-sources.md](./053-time-and-live-sources.md) |
| 054 | Scenarios in the scene's own hand: flood, sun hours, sight lines, a planned building | **TODO** — TSL terms on the terrain and clay graphs | [054-scenarios.md](./054-scenarios.md) |
| 055 | *Modell*: the city in parallel projection for planners — Isometrie, Vogelschau, Lageplan, Militärperspektive, Ansicht and Schnitt; scale bar, north arrow, planner styles, image export, shadow study | **DONE** — all five phases (ADR 0044); still to judge on a real GPU: the perspective-built specular and halo branches, the water glitter, Strich's washes | [055-model-view-parallel-projections.md](./055-model-view-parallel-projections.md) |
| 056 | The committed markings rasters are checked again: the test globs `data/*/dlm` (it globbed the moved `data/dlm` and skipped, green, since 2026-09-30), reads each tile's CRS, and an empty parametrize fails at collection | **DONE** (2026-10-07) — 32 tables over seven sites, 0 skipped; `empty_parameter_set_mark = "fail_at_collect"`. Deviation: the bound scales with the raster (`DROPPED_OK × size / px`: 0.5 % at 2048², 1 % on the phones' 1024²) — the one table over 0.5 %, Leipzig `33318_5688_2_sn` row 22 (a signalled crossing over a zebra at an angle, 0.8 % on the 1024² raster, 0 % at 2048²), is what the current code bakes from the committed table, not stale data: the shared corner texels are twice as wide at 1024² | [056-markings-rasters-test-finds-its-data-again.md](./056-markings-rasters-test-finds-its-data-again.md) |
| 057 | Every seam building is converted: the LoD2 fetch reads one ring of neighbouring cells, so the centre-ownership rule finds what Saxony filed next door (9–34 buildings per Dresden tile centred outside it, none in the neighbour's file; Leipzig's pipeline-converted tiles have 0 — dropped) | DONE (2026-10-07) — `cells(…, margin)` + `own_cells`; sn (ZIPs kept in `downloads/`), nw, hh, be read one ring for LoD2, margin cells past the border skipped; deviation: `by.py` untouched — its LoD2 is a 2 km grid (a STOP condition), its margin left for a follow-up (backlog, 2026-10-06 audit); review fixes: a margin cell is skipped only on a 404/410 (sn, be — any other failure raises), adapter tests for sn and nw; re-fetch of Leipzig, Grimma, Meißen is the maintainer's | [057-seam-buildings-are-fetched-and-kept.md](./057-seam-buildings-are-fetched-and-kept.md) |
| 058 | The jump to another city hands the GPS fix over in the URL fragment, not `?at=` (which reached the host's request log, the crash trail in local storage and the crash card's text, against the privacy page's "never leaves your device"); the trail keeps only the QA knobs of a query; the page, the guide and AGENTS.md say so | DONE (2026-10-07) — as planned; deviations: `arrivalOf` requires a leading `#` (URLSearchParams also strips `?`, so the plan's `replace(/^#/u, "")` still read a query), and `crash-trail.test.ts` was new (no fake storage needed, `trailUrl` is pure) | [058-standort-hand-off-stays-off-the-server.md](./058-standort-hand-off-stays-off-the-server.md) |
| 059 | One table of the ten storage keys, a test that `/datenschutz` names each (it misses `crash-trail.reported`) and each live-feed host, and tests for the reports' "no" and the sender's gate (none existed) | **DONE (2026-10-07)** — as planned; the report-choice test loads its own module instance (query specifier) since Bun's test files share a registry and the sender's test loads it with a DSN; the BroadcastChannel name `crash-trail` and the Sentry logger label stay literals (not storage keys) | [059-storage-keys-pinned-to-the-privacy-page.md](./059-storage-keys-pinned-to-the-privacy-page.md) |
| 060 | The spine's failure paths: a dressing build that fails is noted and reported (an allocation failure sheds memory), the whole frame is guarded (a throw before the render re-threw 60×/s into the trail's storage write), a failed cut-out hold settles, the missing-part word keeps one latch per cause, a released root is never dressed, heartbeats after a stop do not count, `exitNow` restores the FOV, a cancelled pointer is no tap | DONE (2026-10-07) — all eight steps; deviations: the HUD's layer word takes the bare message (the HUD prefixes it), a cut-out failure goes through the same latch and is a problem kind too, a layer word covered by a network one shows again when that clears, the trail's coalescing is a tested `errorCoalescer`, steps 1/5 drive the private queue through casts (no fake timers), `model-rig.test.ts` is new; e2e not run here | [060-the-spine-fails-loudly-and-settles.md](./060-the-spine-fails-loudly-and-settles.md) |
| 061 | Each baked artifact's cache key walks its own bake's imports: the one graph from `prepare-data.ts` holds 68 modules incl. all ten `sites/*.ts` and the palette, so 40 of 267 commits since the cache was born re-baked every site (≈ 2 min locally, ≈ 110 s × 3 shards on CI) | **DONE** (2026-10-07) — each `cacheKey` names its bake's entries (the graph from each, plus `prepare-data.ts`, the site's own config, `bun.lock`, `patches/`); the levels CLI split into `scripts/line-levels-cli.ts` so no bake reaches `sites/`; the fine terrain keys on every tile's passages, the stats on the footprints' content; measured on Dresden: warm 1–2 s, still warm (2.0 s) after a Leipzig config edit, a palette edit re-baked only the map picture (3.3 s), a Dresden config edit re-baked the site (≈ 3 min) | [061-bake-cache-keyed-per-artifact.md](./061-bake-cache-keyed-per-artifact.md) |
| 062 | The counted traffic's bodies are built on the first switch-on, like the bikes and trams — not for every tile at every load (≈ 21 MB of GPU buffers plus CPU copies for the spawn tile's fine level, 260 k vertices, for a layer that is off at start; ≈ 50–100 MB of a phone's cache, reasoned); no vertex normals on an unlit material | **BLOCKED** — STOP condition 1: `trafficMaterial()` reads the normal (`glassColour`/`glassGrazing` in `glass.ts` use `normalView` for the fresnel rim, the density and the refraction offset), so dropping `computeVertexNormals()` would change the look; nothing implemented — the lazy slot (steps 2–6) can go ahead once the plan drops or reworks step 1 | [062-traffic-bodies-built-on-first-switch-on.md](./062-traffic-bodies-built-on-first-switch-on.md) |
| 063 | The build and the fetch fail loudly and write atomically: a site without `provenance.json` builds (today `prepare-data` dies and no site is served), only a NoData grid falls back to the grid level, `bun run fetch` exits non-zero on a required product and guards the Wikidata/cadastre/traffic fetches, the Wikidata and GTFS caches go through `.part`, landmarks tie by id (not the build machine's locale) | DONE (2026-10-07) — all five steps; deviations: the provenance note is printed by `scripts/site-report.ts` (`absentSiteFiles` in `lib/city/site-report.ts`), the cache tests are a new `pipeline/tests/test_caches.py`, and an unreadable trams cache is derived again rather than kept | [063-build-and-fetch-fail-loudly.md](./063-build-and-fetch-fail-loudly.md) |
| 064 | CI: the Next-cache key hashes the repo's sources (not `node_modules`, 11 541 files against 476), lint and typecheck check out without the 811 MB of geodata (the comment says ~130 MB), the shards re-cut with measured numbers and their date (149 / 220 / 340 s against "~100 / ~135 / ~125") | **IMPLEMENTED, awaiting PR run (2026-10-07)** — unverified: CI green (incl. the sparse checkout on a real runner) and the shard spread (est. ~93 s > the 60 s criterion); flip to DONE with the PR run's measured shard times. Next-cache key over the repo's sources (+ `types/**/*.ts`); lint/typecheck sparse checkout without `data/` (both pass locally with `data/` moved aside); shards re-cut from run 37496735478 (161 / 132 / 315 s): `@phone` moved to the HUD shard, not shard 1 as suggested (the rendering group can't be split by tag without a second boot); `grep -c sparse-checkout` is 4 (two lines per job, cone mode off is required) | [064-ci-hashes-what-it-means-and-clones-what-it-reads.md](./064-ci-hashes-what-it-means-and-clones-what-it-reads.md) |
| 065 | The reference docs say what the code does: the skill's per-provider frame and complete bake list (`traffic`, `transit`), README's CRS and "nothing persisted", ADR 0001's storage list (`gpu-safety`), ADR 0003/0015 references, the ledger's and survey's built rows, `report-choice` under `app/_components/`, `?at`/`safety` among the URL reads; optionally a backtick-path check in `links.test.ts` | **DONE (2026-10-07)** — steps 1–6 as planned (058 had already added `#at=lat,lng` to AGENTS.md's knobs; ledger #15 marks only its built part ✅, the rest of the row stays 📋; the survey got a Status column); optional step 7 not built: its check also fails on paths that open plans (043, 045, 046, 048, 066) propose to create — its STOP condition | [065-docs-say-what-the-code-does.md](./065-docs-say-what-the-code-does.md) |
| 066 | The page's GPU-loss, memory-emergency and resume decisions as one pure machine (`lib/city/page-lifecycle.ts`, signals → effects, like `boot-phases.ts`) with the incident sequences of the 2026-10-06 fixes as its tests; `create-app.ts` keeps a binder | DONE (2026-10-07) — steps 1–5; deviations: `gpuAnswers`/`gpuFailure` are lazy thunks (the probe asked only where the closures asked it), an initial `hiddenAt` option for a page that starts hidden, `onGpuLost` is now asked inside `dispatch` (before the stop's effects run; trail-note order unchanged), 15 tests not 10; `create-app.ts` shrank by 45 lines (3 024 → 2 979), not ≥ 80 (the binder keeps the effect map and the hooks' comments); e2e `@desktop-render\|@phone` 9 passed locally | [066-page-lifecycle-as-a-pure-machine.md](./066-page-lifecycle-as-a-pure-machine.md) |
| 067 | The data layers and the twin: a tram timetable that failed to load can be tried again (`loading` never reset), Dresden's counts judged in Europe/Berlin (today the viewer's zone: all grey in Tokyo, a dead counter lit in New York), orchard trees askable, the card credits the site's own provider and register (not GeoSN/Dresden on Hamburg), a malformed feed element left out instead of thrown, polling only in view | DONE (2026-10-07) — all six steps; deviations: the tram failure is `TramCarsStatus.failed` shown by `TramStatusLine` in `data-layers-panel.tsx` (a two-line edit, not `city-walk.tsx`); orchard trees are marked `s: "orchard"` (`cultivated.ts`, `features.ts` type, a flag bit in `ask-items.ts`, tests in `cultivated`/`ask-items`); the zone is a feed fact (`BikeFeedReader.zone`); credits via `cardCredits(site)` in `card-lines.ts`, `GEOSN_CREDIT` deleted; the bike card still formats the count time in the visitor's zone (`inquiry-traffic.ts`, out of scope); e2e `@desktop-hud` not run here (Playwright's chromium 1243 missing in the container) | [067-data-layers-and-the-twin-small-fixes.md](./067-data-layers-and-the-twin-small-fixes.md) |
| — | Aesthetic and visual fine-tuning roadmap (ten items) | DONE except atmospheric motes | [completed.md](./completed.md#aesthetic-and-visual-fine-tuning-roadmap--done-except-motes) |

## Open work

**Direction since 2026-09-27: a digital twin with an aesthetic claim.**
The maintainer set it and fixed two rules: the app stays **static where
possible** (ADR 0001, amended), and **text appears only in a card, on
demand** — the scene stays wordless (ADR 0042). Plans 052 (ask the city),
050 (time and live sources) and 051 (scenarios) carry it; plan 019's GPU
pass comes first for them too, since every new look is unjudged there.

Ordered by leverage. Everything here is vetted against the code; effort
S/M/L.

0. **Plans 037–048 (2026-10-01 audit) — before the items below.** Done
   2026-10-03 (picked for the phones: crashes and slowness): 037, 038,
   041, 042, 044; 043 is BLOCKED on bundling a worker (its findings name
   the options). Left, in order: 040 → 039 → 045 → 046 (moves only, after
   039, which edits the same files). The spikes 047 and
   048 can go any time after 038. Plan 019 (item 1) stays the one that
   needs a GPU; 039 step 4 and 048 part B add to its checklist. Plan 022
   (the four tiles' re-bake) waits for 040 step 1. Plan 017 phase C was
   built by plan 049 without 045's named class ids; 045 then covers
   `landcover_osm.py` too.
   **Plans 056–067 (2026-10-06 audit) — order:** 056 (a skipped test,
   minutes) → 057 (seam buildings) → 058 → 059 (privacy) → 060 (the
   spine's failure paths) → 061 (the bake cache) → 062 (traffic on
   demand, phones) → 067 (data layers, the twin) → 063 (build and fetch)
   → 064 (CI, needs a PR run) → 065 (docs) → 066 (the lifecycle machine,
   after 060). 040 and 046 are **drifted** and must be refreshed before
   they run (their rows and amendments say what moved); 039's step 3 is
   moot. The non-interactive run picked these twelve by leverage from the
   vetted findings below; the rest is the 2026-10-06 backlog.

1. **Plan 019 (M, GPU) — the one GPU checklist.** Everything since the 3D
   Tiles switch was verified headless only. Since 2026-10-01 every "look
   unjudged on a GPU" of the condensed plans (023–035) and of the backlog
   is a ticked item there, grouped by feature; the plans' records in
   [completed.md](./completed.md) point to it.
2. **Plan 017, the rest (S–M).** Plans 049 and 051 built most of it
   (providers, per-site data, OSM land cover, rails and decks, `bun run
   site`, every site in the tests); left: a NAS reader for Hamburg's open
   Basis-DLM (B), row-only trees without DOM1 (D.1), per-tile provenance
   (A.3), and a first run of Berlin's adapter. Decide which sites to
   commit and deploy (plan 049, ADR 0037).
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
    `waterGeometryOf`) — the first two done by
    [plan 041](./completed.md#041--tests-where-the-regressions-are--done-2026-10-03), the last
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

### 2026-10-06 audit (`improve deep`, against `4b0310a`)

Eight parallel auditors (the viewer's spine; the layers, the data layers,
the twin and `lib/city`; the build step and the bakes; security and
dependencies; performance; tests and DX; architecture; docs and
direction), every finding re-opened in the code before it was ranked —
the two data claims (the seam buildings, the markings test's skip) were
re-measured with Python over the committed data, the cache-key claim
with the repo's own `moduleGraph`. In scope: the 196 commits since
`a28de75` (the data layers, the twin, the crash reports, Modell, the
legal pages, the safety ladder, the phone memory budget, the network
retries). Baseline green at `4b0310a`: `bun run verify` (2 082 unit
tests, 1 skipped — plan 056's), pipeline pytest (359) + ruff. The run
was non-interactive: the twelve plans 056–067 are the top findings by
leverage; what follows is vetted but **not planned** (backlog, S unless
noted), then what was refuted or judged not worth doing.

- **Bavaria's LoD2 reads its own 2 km cells only (S; from plan 057).**
  `by.py` `lod2` iterates `cells(tile, 2)`, so a seam building LDBV filed
  in a neighbouring 2 km file is dropped by the converter's centre rule
  (München). Same design as Saxony's: `margin=1` on the 2 km grid, a
  margin cell skipped only on a 404/410 (`fetch.not_published`), the own
  cells raise; optionally keep the ZIPs/GMLs under `downloads/` for the
  neighbouring tiles, and a monkeypatched adapter test like sn's.
- **The scene clock's zone (M, design).** The HUD composes the scene
  date in the viewer's zone and the sun is computed for that absolute
  instant at the site — right for the sun, wrong for everything that is
  Europe/Berlin time: the tram timetable (`tram-timetable.ts` `getDay`/`getHours`),
  the traffic curve (`traffic-hours.ts`), the clock hands
  (`furniture-layer.ts`), the *Verschattungsstudie*'s panels
  (`image-export.ts` `new Date(year, m, d, hour)`, labelled "Ortszeit").
  A visitor in New York at 09:00 sees the 15:00 sun with the 09:00
  timetable; the exported study's "9 Uhr" panel is 01:00 Dresden time for
  Tokyo. Fix: one `timeZone` per provider (`"Europe/Berlin"`), the scene
  instant composed and split through `Intl.DateTimeFormat` parts, a
  `siteLocal(date)` helper for `secondsOfDay`/`dayKindOf`/`setClockTime`/`studyPanels`/`trafficHourStatus`;
  the season's wall-clock fields stay in the site's zone; tests under a
  foreign `TZ`. Plan 067 step 2 fixes the bike counts' half of it.
- **A seam deck drawn by one tile, askable in the other (S, MED).**
  `rail-layer.ts` `drawsDeck` averages the ring *with* its closing vertex;
  `ask-items.ts` `bridgeItems` owns by `ringCentre` (open ring): the two
  centroids differ by `(p0 − mean)/(n+1)`, metres on a long deck with
  few vertices, so a deck across a seam can be drawn by A and asked in B
  — a click answers nothing. Fix: one `deckOwnerPoint(feature)` in
  `lib/city/decks.ts` used by `drawsDeck`, `bridgeItems` and the coarse
  path; a synthetic seam-deck test. How many committed decks straddle it
  is unmeasured.
- **The outline keeps a released tile's flow mesh (S, MED).** The
  selection mask shares the asked tile's flow attributes; nothing clears
  the selection when the tile is released, so the next mask render
  re-uploads the whole geometry from the retained CPU arrays. Fix: in the
  plugin's release, re-resolve or clear the outline's subject when it
  belongs to the leaving tile.
- **`runLevelAt` yields NaN when a baked run outruns the samples (S,
  latent).** `levels.ts:454-467` has no bound on `b`; a tile re-baked
  with another `LEVEL_STEP` would lose its rails to a NaN bounding sphere.
  Clamp, and assert no NaN level in the line-levels test.
- **Tram cars re-sample the ground ≈ 4 000 times per frame while on
  (M, measure first).** `tram-cars.ts` per frame: `runningTrams` over
  2 598 trips, then 8 `railTop` (a deck-table scan + a TIN bucket scan)
  per tram and 24 per trail for ≈ 128 trams, and the trail and instance
  buffers re-uploaded whole. Reasoned ≈ 2–5 ms a frame on a desktop,
  2–3× on a phone — only with *Straßenbahnen* on. Fix: sample `railTop`
  once per pattern vertex into a `Float32Array` (re-sampled on
  `streamChanged`), interpolate per frame, `updateRanges` on the buffers,
  `runningTrams` at the 1 s status cadence. Profile with the layer on at
  17:30 before doing it.
- **The minimap's boot payload (S–M, measure first).** Every tile's
  footprints (≈ 4 MB of JSON), 15 bridge files and 15 PNGs for a 192 px
  map, and the static layer repainted ≈ 30 times during the boot (once
  per arriving file). Fix: offscreen canvases per layer, or one
  site-wide footprint raster baked at prepare time.
- **Pack the street-tree cadastre like the canopy (S–M).** `trees_<tile>.geojson`
  is 0.4–0.9 MB / up to 7 453 features per tile, `JSON.parse`d on the
  main thread in `buildDressing`; `lib/city/point-pack.ts` exists and plan
  044's record named this file as the next pack (`x, y, h, d, a, g`; the
  facts stay in `treefacts`).
- **An e2e over the network failure path (M).** `tile-retry.ts`,
  `fetch-optional.ts`, `fetch-retry.ts` and `net-gate.ts` are unit-tested;
  the pill (`stream-pill.tsx`), `boot-error.tsx` (*Keine Verbindung zum
  Server*), `gpu-failure-card.tsx` and `createTileStream`'s wiring have
  no test, and the suite never aborts a `/data/**` request (one
  `page.route` exists: the bike WFS stub). Five of the last week's fixes
  sit in that seam. A spec: `page.route("**/data/dresden/**", abort)` for
  the first N requests, assert the pill (German), lift the route, assert
  `ready` and the pill gone; a second case aborts everything and asserts
  the boot error. Budget it in frames, in the whole-site shard.
- **The bake runner's order and a failing step's name (S).**
  `pipeline/bake/__main__.py`'s `STEPS` carries hard constraints in
  comments ("rail before the canopy", "lowveg last", "structures after
  landmarks") and no test; the loop prints no site/tile/step on a raise.
  Folded into plan 040's refresh (its step 1 already adds `test_main.py`):
  assert the index relations, wrap the loop in a `try` that prints
  `f"{site} {tile} {step}: {exc}"` and re-raises, parametrise two bakes'
  fixtures on EPSG 25832 too (three of seven sites; the fixtures are all
  25833).
- **`coverage-gaps.ts` hides loaded-but-barely-executed sources (S).** A
  source counts as covered when any test's import graph loads it:
  `ground-detail.ts` (784 lines), `sport-ground.ts`, `water-layer.ts`,
  `monument-layer.ts` vanish behind their tested importers. The lcov
  carries `LF`/`LH`: add a second table "loaded, under 20 % executed".
- **A `test:data` lane (S, MED).** `ground-joins.test.ts` (a DGM bake,
  60 s cap), `line-levels.test.ts` (15 tiles, 120 s cap) and
  `features.test.ts` (743 GeoJSON, 118 MB) run in every `bun run test` /
  `test:watch`; the unit job is 85 s. Name the data-walking files and
  give them their own script; `verify` runs both.
- **An environment-variables table in the README (S).** `SITE_URL`
  (`app/layout.tsx`, the metadata base — relative OG/canonical URLs when
  unset), `SHOTS_QUERY`/`SHOTS_TAG`, `CHROME`/`BUN_CHROME_PATH`/`DEBUG_CHROME`/`DUMP_RAW`,
  `PORT`/`E2E_DEV`, `BASE`/`RUNS` (`scripts/eval/`) are named nowhere a
  newcomer looks; `scripts/eval/*.py` sit outside ruff/pytest and rot.
- **Agent DX (S each; the maintainer's settings, not an executor's):**
  `.claude/settings.json` pre-approves `git commit *` and `git add *` but
  not `bun run verify`, `bun lint`, `bun typecheck`, `bun run fix`,
  `bun run test:pipeline` (inverted friction: the gate prompts, the
  mutation does not), and carries three one-off grep/awk entries; there
  is no format-on-save hook for Claude Code (removed after it reformatted
  conflict markers) while `.cursor/hooks.json` still runs a whole-tree
  `bun fix` after every edit; a `PostToolUse` hook on `Edit|Write` running
  `oxfmt <file>` and skipping files with `^<<<<<<< ` would restore it
  safely. `bun run fix` formats before the lint autofix (`oxfmt && oxlint --fix`);
  `.vscode/settings.json` does the reverse — investigate whether an
  autofix can leave the tree unformatted.
- **Two real-timer unit tests (S):** `crown-season.test.ts:125` sleeps
  80 ms against a 40 ms throttle; `tile-stream.test.ts:295` a 1 ms sleep
  as "next task" — fake timers (`net-gate.test.ts:30-35` shows the pattern).
- **Architecture, moves only (fold into plan 046's refresh unless
  noted):** `tile-stream.ts` (1 780 lines) holds four concerns 046 does
  not list — the retrying content fetch and the phone's pacing
  (`ContentFetchPlugin`, `paceStreaming`), the dressing builders and the
  part table, the `DressingPlugin` (25 instance fields) and
  `createTileStream` — split into `tile-fetch.ts`, `dressing-builders.ts`
  (the home item 23 wants), `dressing-plugin.ts`; `three-utils.ts` is a
  junk drawer (25 exports, fan-in 23: disposal, shared buffers, byte
  accounting, CPU-copy drops, scene materials, compile representatives)
  — `gpu-bytes.ts`, `scene-shared.ts`, the compile helpers into
  `compile-lanes.ts`; the TSL `hash21` is byte-identical in
  `post-stack.ts` and `stylize-effect.ts`, the sin-dot hash and the value
  noise identical in `water-layer.ts` and `vegetation-layer.ts` (beyond
  046 step 3's list: a `valueNoise(hash)` factory in the helper home);
  `smoothstep` re-implemented at 13 sites in 10 files (three named
  copies with different parameter orders) — `lib/city/math.ts` gains
  `lerp`, `smooth01`, `smoothstep`; the Python bakes keep two `_count`/`_share`
  pairs that **drifted** (`traffic.py` rejects numeric strings,
  `traffic_sources.py` accepts them — unify on the tolerant one and pin
  the string case; a baked traffic file may change) and three identical
  pairs (`load_wikidata`, `surface_id`, `table_json`) — `common.py`;
  dead exports beyond 046's three (`pageUsable`, `activeDataLayers`,
  `pannedBy`, `HORIZON_BANDS`, `LANGS`) and ten exports referenced by
  their test only (`skyview.ts`'s `sunAngles`/`horizonBracket`/`horizonTexel`,
  `shadowStreamError`, `screenOfPoint`, `insideCutOut`, `stripeCoverage`,
  `buildingFootprints`, `colonyEdgeMetres`/`colonyAxis`, `projectOntoAxis`)
  — wire in or drop; three clocks (`performance.now`, `Date.now`, the
  net-gate's visible clock) in the same files with no rule which a
  timeout uses — one `clocks` object in `net-gate.ts`; twelve `userData`
  tags as bare literals across 19 files — a typed `scene-tags.ts` when a
  file is next touched; two soft import cycles in `lib/city`
  (`snapshot` → `model-view` → `pose` → `snapshot` type-only;
  `city-mesh` ↔ `object-facts`) — a leaf `model-presets.ts`.
- **Adding a data layer touches five spine files (M).** `DATA_LAYERS`
  is a registry, but `data-overlays.ts` applies each key by hand,
  `create-app.ts` hand-lists `LayerName` and one callback per layer
  (`onBikeCounts`, `onTramStatus`, `onTrafficHour`), `city-walk.tsx` a
  `useState` and a detail component per layer, the e2e census a list:
  the bikes commit touched 9 files, the trams 17. Give each
  `DataLayerDef` its overlay factory, HUD detail and census part; one
  `onDataLayer(key, payload)`. Plan 062's `TrafficSlot` is the first
  per-tile shape.
- **The HUD's 35-prop sidebar and 47-member handle (M–L, design).**
  Every new HUD fact adds a `useState` in `city-walk.tsx`, a callback in
  `CityWalkOptions` (26 fields, 17 callbacks), a prop in
  `SceneSidebarProps` and a handle member; backlog item 24's time context
  is the small version. Generalise `look-state.ts` into a scene-facts
  store and a HUD store; the React Compiler is on, so memo is not the fix.
- **Direction (choices):** a bake-freshness record per tile (every
  Python artifact carries only `attribution`; `bun run site` reports
  presence, the re-bake ledger is hand-kept in rows 050/051/022 — write a
  `bake: {step, code, inputs, at}` member and let the report say `stale`;
  M); the storage keys and the guide's tables pinned to the code (plan
  059 does the keys and hosts; `guide-labels.test.ts` could also pin
  `KEY_ACTIONS`, the styles, the data-layer labels, the Modell presets
  and the other six sites' viewpoints; S); *ride a tram* (the only moving
  thing in the twin is not askable — no `tram-ask.ts`; `glideTo` and the
  live-mode follow exist; ask a tram → the card names the line →
  *Mitfahren* until any input; S–M, the maintainer's call); the official
  storeys and heritage flag from the city's WFS (data-streams #1/#2; the
  WFS reader pattern exists in `cadastre.py`/`traffic_sources.py`;
  Dresden-only, a stand-in row for the others; S–M); view links (plan 048)
  — half the mechanism exists since the `at` hand-off: extend that read.

**Refuted or not worth doing (2026-10-06):**

- *The dressing part-table test asserts its fixture against itself* —
  the production table carries `satisfies Record<Exclude<keyof TileDressing, "asks" | "tile">, …>`
  (`tile-stream.ts:356-360`): a new field fails `bun typecheck`; the
  test's cast is redundant, not a gap.
- *`frameLoss`'s "emergency before it" sign has no time window* — the
  raise is deduplicated per incident (`raisedBy`); the only effect is
  which cap counts the reload. Note it when the frame guard (plan 060
  step 2) widens what reaches `onFrameFailed`; no fix on its own.
- *A zero-sized container drives NaN into the camera* — only if the
  mount can be `display:none` while mounted; no `<Activity>`/hidden
  route exists. An early return in the resize observer when a dimension
  is 0 is a one-liner when that path appears.
- *The Sentry tunnel as an open relay* — the DSN's host, path, project
  and key are pinned at build time; Next merges a request's query below
  the destination's; anyone may POST envelopes, as the public DSN already
  allows. *The beacons' fields vs the privacy page* — every field of
  `common()`/`pageContext()`/`breadcrumbs()` is named on the page; IPs
  are `infer_ip: "never"`. *Local-storage reads* — all validated or
  shape-checked, rings capped. *HTML sinks* — none in `app/`, `components/`,
  `lib/`. *URL parameters* — exact matches and anchored regexes, no sink.
  *Routes* — in-memory lookups, no filesystem path from a param.
  *Credentials in history* — none (pattern search over the tree and
  `git log -S`; the hits are placeholders and docs).
- *The vendored Sentry skills put the org token on `curl` command lines*
  (`.agents/skills/sentry-create-alert/SKILL.md:47,170`) — a one-line
  note in AGENTS.md's Sentry paragraph ("the token is `$SENTRY_AUTH_TOKEN`
  from the environment, never typed into a command") is enough; no token
  was ever pasted.
- *Version lag* — none with cost (`next` 16.3.7 → 16.3.8, Dependabot's
  group); no three r186 deprecation in use (`GTAONode`'s deprecated
  options unused); lockfiles and the loader patch in order; the two
  Markdown pipelines (MDX for the legal pages, unified for `/wissen`) and
  the two Inter sources (site vs the diagram renderer) are different jobs.
- *`@types/three` in `dependencies`* — harmless for a static app.
- *`prepare-sites.ts <ids>` prunes every other site's output* — a
  documented design ("only the ones named"); the next full run restores
  them. *Two cache keys in `prepare-data` miss inputs* (the stats' key
  misses the sheds/structures appended to the footprints; the fine
  terrain's key misses the neighbours' passages) — real but rare; fold
  into plan 061's key rework if it touches those sites. *The DGM's
  georeferencing vs the tile extent*, *hollow buildings counted by
  `write_cityjson`*, *NDVI by band count not by `products.dop`*, *a WFS
  answer without `numberMatched` written as complete* — latent, LOW
  occurrence; one assertion each when a provider trips them.
- *The joystick's `setThumb` state at pointer-move rate*, *`nextTask`'s
  nested timers*, *the beat's 2 s traverse*, *per-pass `updateMatrixWorld`*,
  *the date popover's calendar in the viewer chunk* — small or
  unmeasured; profile first.
- *The serial `@desktop-hud` group's failure cascade* — the trade-off
  AGENTS.md prescribes; split only if flakes appear. *"Exported for
  tests" seams* (`buildBallast`, `vineInstances`, `model-view.ts:760`) —
  the cheapest guard at the right boundary; leave.
- *A `bun run ci`* chaining verify, pytest and e2e — one line if wanted;
  not a finding.

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
- **Docs:** the crash trail is in the guide (*When it crashes*) and ADR
  0001's amendment since ADR 0043 (2026-10-03); `cityjson-threejs-loader` 0.4.0 is unmaintained
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
  levels share half each) and the dressing; tested since
  [plan 041](./completed.md#041--tests-where-the-regressions-are--done-2026-10-03) (`raster-shares.ts`).
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
   Since 2026-10-06 the safety ladder's levels (ADR 0046) are such tuples:
   a menu would set the level `?safety=N` sets for QA.
6. ~~**A provenance manifest per tile (S).**~~ Now plan 017 phase A step 3
   (the ingest adapter writes `data/<site>/<tile>.provenance.json` from the
   values its checked downloads already know). `bun run fetch <site>
   [tile]` exists (plan 049), and `data/<site>/provenance.json` is the
   hand-kept per-site version until then. The client side is built: the
   card's provenance manifest, derived from it at build time (plan 052
   phase 2).
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
   worker itself. Plan 044 took the canopy's parse off (packed points,
   2026-10-03); plan 043 (the city BVH) found that Turbopack does not
   bundle a module worker — the same wall this option meets, so its
   findings' options apply here too.
9. **A bilingual HUD (M).** The page is `lang="de"` since 2026-09-26: the
   HUD, the spoken feedback and the `/wissen` landing are German, while
   the guide comes in both languages. About sixty HUD strings, picked by
   `navigator.language` or a `?lang=`, including the `aria-label`s and
   the spoken feedback, would follow the guide's pairing.
10. **"Problem melden" (S) — [plan 047](./047-spike-report-a-problem.md)
    (spike).** The crash panel says "copy and send it on" but names no
    destination; a prefilled report (the trail; the view only on opt-in)
    closes the loop the crash trail was built for. (2026-10-01.)
11. ~~**A recovered page starts one memory step down (S).**~~ Done
    2026-10-06, wider than offered: a per-device safety level (0–3, kept
    in local storage, one level lower every three days) that a lost GPU,
    a crashed previous page or a memory emergency raises; each level
    lowers the pixel ratio, the shadow map, the tile cache and the
    governor's lines and starts the governor at a floor — one automatic
    reload per level, then a card
    ([ADR 0046](../adr/0046-a-per-device-safety-ladder-for-gpu-loss.md)).
    The iPhone's recovery loop in Sentry (CITY-WALK-1…8) showed why the
    old cap (plan 038 step 3) was not enough: each reload replayed the
    budget that had failed.
12. **Committed QA views (S) — [plan 048](./048-spike-view-links-and-qa-views.md)
    part B.** Plan 019's reference views have no coordinates and eleven
    rows say "look unjudged on a GPU"; `qa/views/*.json` read by the shot
    harness makes GPU passes repeatable. (2026-10-01.)

### Maintainer actions

- After plan 057 lands: re-fetch Leipzig, Grimma and Meißen
  (`bun run fetch <site>` with `data/<site>/cityjson/` cleared, so the
  converter rewrites the tiles with their seam buildings), then
  `bun run bake <site>` and commit; Dresden's committed CityJSON already
  holds them (the older converter kept GeoSN's files whole) — plan 022's
  re-fetch gets them through the same path. (2026-10-06.) The fetch now
  keeps Saxony's LoD2 ZIPs in `data/_raw/sn/downloads/LoD2_CityGML/`
  (new; nine per tile, shared with the neighbours), and `_step` skips an
  existing `lod2_<tile>.city.json`, so the per-tile CityJSON must be
  deleted for the re-fetch to rewrite it. (2026-10-07.)
- Condense plans 049 and 055 (DONE, kept in full) into
  [completed.md](./completed.md) per the lifecycle above, and settle
  050/051's "BUILT" rows (a status the vocabulary lacks: DONE or PARTIAL
  with what is open). (2026-10-06.)
- Refresh plans 040 and 046 (drifted — their rows say what moved) before
  handing either to an executor. (2026-10-06.)
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
not render it (no GPU, no WebGPU in Bun). The 2026-10-06 run ran lint,
typecheck, the unit and pipeline suites, read the committed CityJSON,
markings and traffic data with Python and measured the bake's import
graph with the repo's helper; no e2e, no `next build`, no GPU, no real
fetch; the CI timings come from the two latest `main` runs' logs;
`components/ui/**` and the vendored skills were scanned for
prompt-injection content only (none found).

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
- **2026-10-03**: asked which plans address the phone crashes and the
  slowness, the maintainer had them executed in order: 037 (prerequisite)
  → 038 → 041 (043's prerequisite) → 042 → 043 → 044. All but 043 built
  and condensed into [completed.md](./completed.md); 043 stopped at its
  bundling STOP condition (Turbopack copies a module worker as a raw
  asset), its findings kept in the plan. Plan 047 is another agent's.
- **2026-10-06, the phone crash fixes** (no plan file; branch
  `claude/phone-crash-fixes`): thirteen Sentry events from one iPhone
  (CITY-WALK-1…8) were mapped by seven parallel analyses (textures,
  geometry, post, loss, network, three's internals, the budget) and fixed
  by five work packages on one branch: the safety ladder and the
  recovery (ADR 0046, backlog item 11), the reports' classification and
  the heartbeat, the phone's post profile and the one-byte shadow colour
  target, the stream's memory (the shadow camera at 64 px on a phone, 128 on a
  desktop, the phone's
  pacing, the raster gate, shared coarse indices, CPU copies dropped;
  ADR 0047), and the network retries (ADR 0048). Verified headless and by
  the unit tests only; what a real iPhone and a WebGPU desktop must show
  is plan 019's section M.
- **2026-10-06 run** (against `4b0310a`, `improve deep`, non-interactive):
  eight parallel auditors over the 196 commits since `a28de75`; every
  finding re-opened in the code, the data claims re-measured; plans
  056–067 written by leverage, the rest of the vetted findings and the
  refuted ones recorded above; 039 step 3 marked moot (ADR 0041), 040 and
  046 marked drifted with amendments. Baseline green (2 082 unit tests,
  359 pipeline tests).
