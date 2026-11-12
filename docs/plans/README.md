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
| 016 | Replace `sharp` with `Bun.Image` for the 2048² raster downsample | REJECTED — premise gone with ADR 0010 (no baked RGB splat) | [completed.md](./completed.md#016--bunimage-instead-of-sharp-for-the-raster-downsample--rejected-premise-gone) |
| 017 | Any German city: site config, per-Land ingest adapters, NAS input, OSM land cover as a DLM substitute | **PARTIAL** — site config, Python bake package and the Saxony adapter built; plans 049 and 051 built most of phases A, C and D in their own shape (providers for SN, NW, BY, HH, BE; per-site data and provenance; OSM land cover, rails and decks; `bun run site <site>`; every site in the tests); open: B (NAS), D.1 (row-only trees without DOM1), a first run of Berlin's adapter | [017-germany-wide-sites.md](./017-germany-wide-sites.md) |
| 018 | Stream tiles around the camera: tile manager, loader worker, 1 km near cells, KTX2 splat | REJECTED — superseded by 3D Tiles + 3DTilesRendererJS (ADR 0024) | [completed.md](./completed.md#018--stream-tiles-around-the-camera--rejected-superseded-by-adr-0024) |
| 019 | **The one GPU checklist**: backends, palette, quantisation, LOD and seams, shadows, GTAO and sky light, picture styles, frame time and memory, phones, deploy host, and the feature plates of plans 023–039 | **TODO** — needs a GPU and two phones; rewritten 2026-10-01; section M, the phone crash fixes of 2026-10-06 (ADRs 0047, 0048), added; its reference views and every open device check's views are committed in [`qa/views/`](../../qa/views/README.md) (plan 048), each with a `?snap=` link | [019-gpu-verification.md](./019-gpu-verification.md) |
| 020 | WebGPURenderer + TSL instead of WebGL and `onBeforeCompile`; node post instead of `postprocessing`/`n8ao` | DONE (2026-09-26) — the whole port, one path (WebGPU, its WebGL2 backend as the fallback), public API only; the spike's internal patches rejected for a top-level scene pass, `Instances` and `sceneMaterial`; look unjudged on a real GPU | [completed.md](./completed.md#020--webgpurenderer-and-tsl-node-materials--done-2026-09-26) |
| 021 | `/wissen` on Astro Starlight instead of a hand-built Next route | **TODO** — plan only; Phase 0 awaits the maintainer | [021-wissen-astro-starlight.md](./021-wissen-astro-starlight.md) |
| 022 | Re-bake from the current editions, the whole chain downstream of the land cover | DONE (2026-11-05) — the four tiles' old products were gone by the 2026-10-20/11-01 re-bakes; the collected re-bake ran every tile step of the Saxon sites on GeoSN's Basis-DLM of 2026-11-04: Dresden's western column 99.986–99.995 % of land-cover texels the same, no class lost, the rest of Saxony identical; OSM held at the committed bake's BBBike extracts (Geofabrik unreachable). Open: the Saxon `lowveg`/`small-buildings` (GeoSN's laser scan 404) | [completed.md](./completed.md#022--re-bake-from-the-current-editions-the-whole-chain--done-2026-11-05) |
| 023 | The ground up close: kerbs, lawn edges, OSM paving and parking, urban green | CLOSED (2026-10-01) — phases 1–3 and 5 built; the raised pavement and micro-relief rejected (🗃️), shell grass an idea only; the look in plan 019, the DLM split and LSC intensity in the [data-streams survey](../data-streams.md), trees in carved parks in plan 022 | [completed.md](./completed.md#023--the-ground-up-close-kerbs-paving-lawn-edges-urban-green--closed-2026-09-25-phases-13-and-5-built-rest-rejected-or-moved) |
| 024 | Trams: OSM tracks (street, grass, ballast), contact wire, masts, span wires, stop signs | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#024--trams-tracks-overhead-line-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 025 | Trees by species and season: OSM trees beside the cadastre, autumn colour, bare winter crowns | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#025--trees-by-species-and-season--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 026 | Road markings: zebra and signalled crossings, stop lines, cycle lanes, centre lines | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#026--road-markings--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 027 | Buildings from OSM: part attribute inheritance (bug), ground-floor shop glow, heritage, era (spike) | DONE (2026-09-25) — phases 0–2 built, 3 REJECTED (0.8 % dated); dusk look in plan 019 | [completed.md](./completed.md#027--what-osm-knows-about-the-buildings--done-2026-09-25-phase-3-rejected-dusk-look-unjudged-on-a-gpu--plan-019) |
| 028 | Cultivated land: allotment colonies, orchards, vineyards | DONE (2026-09-25) — look in plan 019; open: vine rows ignore the season (backlog) | [completed.md](./completed.md#028--cultivated-land-allotments-orchards-vineyards--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 029 | Fences, railings and gates, baked into the fine terrain | DONE (2026-09-25) — restyled to one calm band, ground join per ADR 0030; look in plan 019 | [completed.md](./completed.md#029--fences-railings-and-gates--done-2026-09-25-restyled-to-one-band-look-unjudged-on-a-gpu--plan-019) |
| 030 | More street furniture: advertising columns, traffic signals, hydrants, clocks, drinking water, stop signs | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#030--more-street-furniture-columns-signals-hydrants-clocks-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 031 | The Elbe: landing stages, pontoons, groynes, ferry lines | DONE (2026-09-25) — look in plan 019 | [completed.md](./completed.md#031--the-elbe-landing-stages-groynes-ferries--done-2026-09-25-look-unjudged-on-a-gpu--plan-019) |
| 032 | Street names: map lettering in fly mode, a caption on foot | REJECTED — built 2026-09-25, removed 2026-09-26 by the maintainer's decision after seeing it | [completed.md](./completed.md#032--street-names-lettering-and-the-on-foot-caption--rejected-removed-2026-09-26) |
| 033 | Sky-view factor and baked horizon map: city-scale ambient light and far-field shadows | DONE (2026-09-25) — plates and tuning in plan 019; horizon on facades folded into ledger 📋 #7 (CSM) | [completed.md](./completed.md#033--sky-view-factor-and-baked-horizon-shading--done-2026-09-25-plates-and-tuning-open-on-a-gpu--plan-019) |
| 034 | Small structures from DOM − LoD2 (kiosks, sheds, carports), gated on a measurement | DONE (2026-09-26) — look in plan 019 | [completed.md](./completed.md#034--small-structures-from-dom--lod2--done-2026-09-26-look-unjudged-on-a-gpu--plan-019) |
| 035 | A hidden, opt-in soundscape synthesised from the scene's data | REJECTED — built 2026-09-26, never heard; removed 2026-10-10 by the maintainer's decision, to cut code and maintenance (the listening pass withdrawn) | [completed.md](./completed.md#035--a-hidden-soundscape--rejected-removed-2026-10-10) |
| 036 | What the data streams carry that we do not use (OSM, LoD2, the city's WFS, Wikidata, GeoSN, DLM): a measured survey and a ranking | **REFERENCE** — moved to [docs/data-streams.md](../data-streams.md) on 2026-10-01 (a survey, not a plan); pick an item into its own plan | [data-streams.md](../data-streams.md) |
| 037 | The commands agents run work (`bun run build`/`test`, E2E_DEV over HTTPS), the skill's phone cache numbers, "1024²" → TIN, guide viewpoints and sizes, codebook pointers, Dependabot/CI paths, lockfile header; a test pins the guide to the HUD | DONE (2026-10-03) — `bunfig.toml` keeps a bare `bun test` out of e2e; coverage gaps listed in CI; a docs link test besides the guide test | [completed.md](./completed.md#037--the-commands-agents-run-and-docs-that-say-what-the-code-does--done-2026-10-03) |
| 038 | Runtime spine: the shadow camera follows by night (no pinned tile), "loaded" without a spawn dressing nobody builds, no GPU-recovery loop and the crash it hid, no stuck key after a ⌘ chord, a jump ends live mode | DONE (2026-10-03) — step 2's decision moved into the pure boot machine; the GPU failure has its own HUD path | [completed.md](./completed.md#038--five-runtime-fixes-in-the-viewers-spine--done-2026-10-03) |
| 039 | Bridge approach ramps without zero normals, Sin City rain that lasts, Papier keeps double-sided ribbons | DONE (2026-11-05) — steps 1, 2, 4; step 3 moot since ADR 0041. Deviations in step 4: the stand-ins go through the renderer's object function, main pass only (in the shadow pass they would read the map they draw into); bare crowns stay whole, masked they turned into grey clots on a GPU. Rain not watched for an hour (plan 019) | [completed.md](./completed.md#039--bridge-ramps-rain-that-lasts-papiers-ribbons--done-2026-11-05) |
| 040 | Bakes: step-major `bun run bake`, seam stair flights kept, atomic ingest + timeouts + https check, atomic `prepare-data` writes, the `/wissen` hero as tall as the site | DONE (2026-11-05) — code and tests 2026-11-04 (refreshed against `8b8ec332`: steps 3 and 5 already built, step 1's tests, step 2's DGM mosaic, step 4 for the publisher); the stairs re-baked on every tile of every site 2026-11-05 (Dresden +6 flights, München +4, Leipzig +1) | [completed.md](./completed.md#040--bakes-that-read-finished-neighbours-keep-their-seam-stairs-never-trust-a-half-written-file--done-2026-11-05) |
| 041 | Test net: raster shares and the aborted-load free, the collider through a real BVH, census for stairs/sport/kerbs, eye height vs the DGM, pens per style, three's real geometry key | DONE (2026-10-03) — raster shares in their own module; tree rows left allowed empty (Grimma, Munich) | [completed.md](./completed.md#041--tests-where-the-regressions-are--done-2026-10-03) |
| 042 | Main thread while streaming: stats coalesced, footprints only when they change (no minimap repaint per tile event), footprints after the handover, the viewer chunk fetched with the manifest | DONE (2026-10-03) — the first frame and "loaded" flush the coalesced stats | [completed.md](./completed.md#042--less-main-thread-churn-while-tiles-stream--done-2026-10-03) |
| 043 | The city BVH in a worker (≈ 80 ms per tile on desktop today) | **CLOSED** (2026-11-04; built in another shape) — 038d55a (2026-10-26): the BVH lazy (a ray builds a tile's), the tiles within 400 m built ahead in `bvh-client.ts`'s worker, the spawn tile's at the placing; nothing left to plan — the worker's first-load chunk cost was not measured again (the record keeps the options). Before: BLOCKED twice (2026-10-03 a misread Turbopack asset; 2026-10-11 the +20.8 KB gz chunk and no earlier first frame) | [completed.md](./completed.md#043--the-city-bvh-in-a-worker--closed-2026-11-04-built-in-another-shape) |
| 044 | The canopy points as a packed binary instead of a 9.5 MB GeoJSON parsed in one task | DONE (2026-10-03) — 96 ms of JSON.parse → ≈ 13 ms to unpack on the biggest tile; published pre-gzipped (`.pts.gz`) | [completed.md](./completed.md#044--the-canopy-points-packed-not-geojson--done-2026-10-03) |
| 045 | One source for the raster decoders (the stale `surfaceHeading`) and the Python class ids; one OSM number parser; the byte scales pinned across languages | DONE (2026-11-05) — steps 1–4 2026-11-04 (`classes.py`, `osm_number`/`osm_metres`/`osm_width` for every length reader); re-baked on every site 2026-11-05: Hamburg's OSM land cover lost the 100 m wide paths of 36 `width=100 cm` stairs (up to 2.1 % of a tile's texels), elsewhere a wall or two. Open: the Saxon `lowveg` (hedge heights; GeoSN's laser scan 404) | [completed.md](./completed.md#045--one-source-for-the-raster-decoders-and-the-class-ids--done-2026-11-05) |
| 046 | Moves only: `rail-layer.ts` into mesh kit / deck table / bridge, telemetry and picking out of `bootApp`, a home for the TSL helpers, the terrain↔water cycle, the dead-code sweep | **CLOSED** (2026-11-04; drifted) — the mesh kit, the deck table, the cycle, the GPU-loss trio and most dead exports moved elsewhere; step 2's section-sized `bootApp` moves dropped (item 14's 2026-11-04 verdict); the rest is backlog item 27 | [completed.md](./completed.md#046--moves-only-split-the-god-modules-and-sweep--closed-2026-11-04-drifted-the-rest-in-the-backlog) |
| 047 | Spike: "Problem melden" — the crash report with a destination, the view only on opt-in | **TODO** — spike; maintainer answers needed at its step 3. Crashes now also go out on their own where a DSN is set (ADR 0043); what is left is the view on opt-in and a destination for deploys without a DSN | [047-spike-report-a-problem.md](./047-spike-report-a-problem.md) |
| 048 | Spike: a view as a `?snap=` link; committed QA views for plan 019 | **BUILT** (2026-11-05) — A: *Link kopieren* and the boot read a view link, `/<site>?snap=<base64url of the snapshot>` (only `snap` in the copied query, not this page's QA knobs), read only through `parseSnapshot` (`snapshotFromSearch`, ≤ 4 KB), the whole snapshot as *Kopieren* writes it (470 characters, 648 with Modell); a waiting recovery wins, the link is gated by the safety level (`arrivalOf`'s `linked`); another link is another page load; nothing stored, the crash trail and the reports keep no `snap`, the privacy page and the guide (de/en) say the opened link reaches the host's request log. B: 50 views in `qa/views/` written from the data by `scripts/qa-views.ts`, their index `qa/views/README.md` with each link, rendered by `bun run shots` as `shots/qa-<name>.png`, parsed by `scripts/qa-views.test.ts`. Deviations: a fragment first, reversed by the maintainer the same day (URL parameters go in the query: diagnosis in the request log, several parameters); no compact form; the views computed, not captured (no GPU); the test beside the generator; `low-sun` at 09:00. **Open:** ADR 0018's line on the link (text in the plan's Findings) and `?style=` as a short form — the maintainer's; the views' plates on a GPU (plan 019) | [048-spike-view-links-and-qa-views.md](./048-spike-view-links-and-qa-views.md) |
| 049 | Many sites: providers, per-site data, `bun run fetch <site>` → `bake` → build, eight sites with viewpoints; one deployment with a route per site (`/dresden`) and a start page to pick the city | **DONE** (2026-10-01) — Berlin's adapter untested; committing sites other than Dresden is the maintainer's call | [completed.md](./completed.md#049--many-sites-fetch-bake-build-a-route-per-site--done-2026-10-01) |
| 050 | Landmarks and what LoD2 leaves out: DOM1 gaps named by OSM (chimneys, towers, masts, missing buildings, a landmark's roof relief), OSM materials and colours in the clay palette, Wikidata landmarks in the HUD | **BUILT** (2026-09-28) — all three parts, baked on the seven committed sites: 386 columns, 920 missing buildings, 508 relief slabs on 74 landmark objects, 310 landmarks; the relief a measured height field since 2026-09-30 (re-bake `structures` everywhere), towers LoD2 draws no longer doubled; look unverified on a real GPU; since 2026-10-01 a tile's landmarks are those with ≥ 8 % of its top sitelinks (the *Dense tiles* item, plan 051) and the relief stands on the roof under each cell (Unna re-baked) | [050-landmarks-and-gaps.md](./050-landmarks-and-gaps.md) |
| 051 | Stand-ins where a Land publishes less (OSM rails and decks without a DLM, a visible-band vegetation index without infrared, tree registers per city, Bavaria's laser scan), marked in a generated *Sources by city* page; looks derived from each city's data (facade context, valley-haze depth, tram gauge, landmarks per tile) instead of per-site switches | **BUILT** (2026-10-01) — Hamburg's 348 decks and 81 km of track, Hamburg's and Leipzig's registers, Munich's GLI baked; `osm-buildings`, `landmarks` and `structures` still to re-bake on most sites; Berlin not built; looks unverified on a real GPU | [051-stand-ins-and-derived-looks.md](./051-stand-ins-and-derived-looks.md) |
| 052 | A queryable twin: object ids and semantics in the tileset, the provenance manifest, asking by a click or a long press, the card | **PARTIAL** — 1–3 built (2026-09-27; ten fact columns, +3.5 % per building tile; OSM names, addresses, storeys re-baked on fifteen tiles; a click asks (no mode since 2026-10-01); since 2026-09-28 a long press asks, taps are tolerant, a bottom sheet on touch); the hatch unjudged on a GPU; 4 built 2026-10-01 (trees with the register's facts, monuments, bridges; one screen-space outline for every kind); 4b–7 open (aim and ask, a link, a Datenstand panel, ingest-written provenance) | [052-queryable-twin.md](./052-queryable-twin.md) |
| 053 | Time and live sources: the day plays, weather sets the mood, the Elbe follows its gauge | **TODO** — static where possible (ADR 0001 amended); CORS of each source to verify first | [053-time-and-live-sources.md](./053-time-and-live-sources.md) |
| 054 | Scenarios in the scene's own hand: flood, sun hours, sight lines, a planned building | **TODO** — TSL terms on the terrain and clay graphs | [054-scenarios.md](./054-scenarios.md) |
| 055 | *Modell*: the city in parallel projection for planners — Isometrie, Vogelschau, Lageplan, Militärperspektive, Ansicht and Schnitt; scale bar, north arrow, planner styles, image export, shadow study | **DONE** — all five phases (ADR 0044); still to judge on a real GPU: the perspective-built specular and halo branches, the water glitter, Strich's washes | [completed.md](./completed.md#055--modell-the-city-in-parallel-projection--done-2026-10-03-three-looks-unjudged-on-a-gpu--plan-019) |
| 056 | The committed markings rasters are checked again: the test globs `data/*/dlm` (it globbed the moved `data/dlm` and skipped, green, since 2026-09-30), reads each tile's CRS, and an empty parametrize fails at collection | **DONE** (2026-10-07) — 32 tables over seven sites, 0 skipped; `empty_parameter_set_mark = "fail_at_collect"`. Deviation: the bound scales with the raster (`DROPPED_OK × size / px`: 0.5 % at 2048², 1 % on the phones' 1024²) — the one table over 0.5 %, Leipzig `33318_5688_2_sn` row 22 (a signalled crossing over a zebra at an angle, 0.8 % on the 1024² raster, 0 % at 2048²), is what the current code bakes from the committed table, not stale data: the shared corner texels are twice as wide at 1024² | [completed.md](./completed.md#056--the-markings-rasters-test-finds-its-data-again--done-2026-10-07) |
| 057 | Every seam building is converted: the LoD2 fetch reads one ring of neighbouring cells, so the centre-ownership rule finds what Saxony filed next door (9–34 buildings per Dresden tile centred outside it, none in the neighbour's file; Leipzig's pipeline-converted tiles have 0 — dropped) | DONE (2026-10-07) — `cells(…, margin)` + `own_cells`; sn (ZIPs kept in `downloads/`), nw, hh, be read one ring for LoD2, margin cells past the border skipped; deviation: `by.py` untouched — its LoD2 is a 2 km grid (a STOP condition), its margin left for a follow-up (backlog, 2026-10-06 audit); review fixes: a margin cell is skipped only on a 404/410 (sn, be — any other failure raises), adapter tests for sn and nw; re-fetch of Leipzig, Grimma, Meißen is the maintainer's | [completed.md](./completed.md#057--seam-buildings-are-fetched-and-kept--done-2026-10-07) |
| 058 | The jump to another city hands the GPS fix over in the URL fragment, not `?at=` (which reached the host's request log, the crash trail in local storage and the crash card's text, against the privacy page's "never leaves your device"); the trail keeps only the QA knobs of a query; the page, the guide and AGENTS.md say so | DONE (2026-10-07), **reversed 2026-11-05** by the maintainer: the fix is `?at=` again (diagnosis in the request log, several parameters), named on the privacy page; the trail still keeps only the QA knobs — as planned; deviations: `arrivalOf` requires a leading `#` (URLSearchParams also strips `?`, so the plan's `replace(/^#/u, "")` still read a query), and `crash-trail.test.ts` was new (no fake storage needed, `trailUrl` is pure) | [completed.md](./completed.md#058--the-standort-hand-off-stays-off-the-server--done-2026-10-07) |
| 059 | One table of the ten storage keys, a test that `/datenschutz` names each (it misses `crash-trail.reported`) and each live-feed host, and tests for the reports' "no" and the sender's gate (none existed) | **DONE (2026-10-07)** — as planned; the report-choice test loads its own module instance (query specifier) since Bun's test files share a registry and the sender's test loads it with a DSN; the BroadcastChannel name `crash-trail` and the Sentry logger label stay literals (not storage keys) | [completed.md](./completed.md#059--storage-keys-pinned-to-the-privacy-page--done-2026-10-07) |
| 060 | The spine's failure paths: a dressing build that fails is noted and reported (an allocation failure sheds memory), the whole frame is guarded (a throw before the render re-threw 60×/s into the trail's storage write), a failed cut-out hold settles, the missing-part word keeps one latch per cause, a released root is never dressed, heartbeats after a stop do not count, `exitNow` restores the FOV, a cancelled pointer is no tap | DONE (2026-10-07) — all eight steps; deviations: the HUD's layer word takes the bare message (the HUD prefixes it), a cut-out failure goes through the same latch and is a problem kind too, a layer word covered by a network one shows again when that clears, the trail's coalescing is a tested `errorCoalescer`, steps 1/5 drive the private queue through casts (no fake timers), `model-rig.test.ts` is new; e2e not run here | [completed.md](./completed.md#060--the-spine-fails-loudly-and-settles--done-2026-10-07) |
| 061 | Each baked artifact's cache key walks its own bake's imports: the one graph from `prepare-data.ts` holds 68 modules incl. all ten `sites/*.ts` and the palette, so 40 of 267 commits since the cache was born re-baked every site (≈ 2 min locally, ≈ 110 s × 3 shards on CI) | **DONE** (2026-10-07) — each `cacheKey` names its bake's entries (the graph from each, plus `prepare-data.ts`, the site's own config, `bun.lock`, `patches/`); the levels CLI split into `scripts/line-levels-cli.ts` so no bake reaches `sites/`; the fine terrain keys on every tile's passages, the stats on the footprints' content; measured on Dresden: warm 1–2 s, still warm (2.0 s) after a Leipzig config edit, a palette edit re-baked only the map picture (3.3 s), a Dresden config edit re-baked the site (≈ 3 min) | [completed.md](./completed.md#061--the-bake-cache-keyed-per-artifact--done-2026-10-07) |
| 062 | The counted traffic's bodies are built on the first switch-on, like the bikes and trams — not for every tile at every load (≈ 21 MB of GPU buffers plus CPU copies for the spawn tile's fine level, 260 k vertices, for a layer that is off at start; ≈ 50–100 MB of a phone's cache, reasoned); no vertex normals on an unlit material | **DONE** (2026-10-07) — the bodies are built on the first switch-on per tile (`TrafficSlot` in `tile-stream.ts`: a task of their own, compiled hidden, then shown, weighed and asked; kept while off, freed with the tile, nothing hung on a tile released mid-build); step 1 dropped: the glass reads the normals | [completed.md](./completed.md#062--traffic-bodies-built-on-the-first-switch-on--done-2026-10-07) |
| 063 | The build and the fetch fail loudly and write atomically: a site without `provenance.json` builds (today `prepare-data` dies and no site is served), only a NoData grid falls back to the grid level, `bun run fetch` exits non-zero on a required product and guards the Wikidata/cadastre/traffic fetches, the Wikidata and GTFS caches go through `.part`, landmarks tie by id (not the build machine's locale) | DONE (2026-10-07) — all five steps; deviations: the provenance note is printed by `scripts/site-report.ts` (`absentSiteFiles` in `lib/city/site-report.ts`), the cache tests are a new `pipeline/tests/test_caches.py`, and an unreadable trams cache is derived again rather than kept | [completed.md](./completed.md#063--the-build-and-the-fetch-fail-loudly--done-2026-10-07) |
| 064 | CI: the Next-cache key hashes the repo's sources (not `node_modules`, 11 541 files against 476), lint and typecheck check out without the 811 MB of geodata (the comment says ~130 MB), the shards re-cut with measured numbers and their date (main's run 37476256017 measured 149 / 220 / 340 s against the comment's "~100 / ~135 / ~125") | **DONE** (2026-11-04; implemented 2026-10-07, `3de5ea2d`, `3fb9a505`) — CI on `main` green since; the Next-cache key over the repo's sources (+ `types/**/*.ts`), lint/typecheck sparse without `data/`, shards re-cut (`@phone` to the HUD shard). Not met: the shards within ~60 s — the whole-site spec sets the floor (457 / 321 / 246 s on 2026-10-24, the workflow's comment) | [completed.md](./completed.md#064--ci-hashes-what-it-means-and-clones-what-it-reads--done-2026-11-04) |
| 065 | The reference docs say what the code does: the skill's per-provider frame and complete bake list (`traffic`, `transit`), README's CRS and "nothing persisted", ADR 0001's storage list (`gpu-safety`), ADR 0024/0010 references, the ledger's and survey's built rows, `report-choice` under `app/_components/`, `?at`/`safety` among the URL reads; optionally a backtick-path check in `links.test.ts` | **DONE (2026-10-07)** — steps 1–6 as planned (058 had already added `#at=lat,lng` to AGENTS.md's knobs; ledger #15 marks only its built part ✅, the rest of the row stays 📋; the survey got a Status column); optional step 7 not built: its check also fails on paths that open plans (043, 045, 046, 048, 066) propose to create — its STOP condition | [completed.md](./completed.md#065--the-docs-say-what-the-code-does--done-2026-10-07) |
| 066 | The page's GPU-loss, memory-emergency and resume decisions as one pure machine (`lib/city/page-lifecycle.ts`, signals → effects, like `boot-phases.ts`) with the incident sequences of the 2026-10-06 fixes as its tests; `create-app.ts` keeps a binder | DONE (2026-10-07) — steps 1–5; deviations: `gpuAnswers`/`gpuFailure` are lazy thunks (the probe asked only where the closures asked it), an initial `hiddenAt` option for a page that starts hidden, `onGpuLost` is now asked inside `dispatch` (before the stop's effects run; trail-note order unchanged), 15 tests not 10; `create-app.ts` shrank by 45 lines (3 024 → 2 979), not ≥ 80 (the binder keeps the effect map and the hooks' comments); e2e `@desktop-render\|@phone` 9 passed locally | [completed.md](./completed.md#066--the-page-lifecycle-as-a-pure-machine--done-2026-10-07) |
| 067 | The data layers and the twin: a tram timetable that failed to load can be tried again (`loading` never reset), Dresden's counts judged in Europe/Berlin (today the viewer's zone: all grey in Tokyo, a dead counter lit in New York), orchard trees askable, the card credits the site's own provider and register (not GeoSN/Dresden on Hamburg), a malformed feed element left out instead of thrown, polling only in view | DONE (2026-10-07) — all six steps; deviations: the tram failure is `TramCarsStatus.failed` shown by `TramStatusLine` in `data-layers-panel.tsx` (a two-line edit, not `city-walk.tsx`); orchard trees are marked `s: "orchard"` (`cultivated.ts`, `features.ts` type, a flag bit in `ask-items.ts`, tests in `cultivated`/`ask-items`); the zone is a feed fact (`BikeFeedReader.zone`); credits via `cardCredits(site)` in `card-lines.ts`, `GEOSN_CREDIT` deleted; the bike card still formats the count time in the visitor's zone (`inquiry-traffic.ts`, out of scope); e2e `@desktop-hud` not run here (Playwright's chromium 1243 missing in the container) | [completed.md](./completed.md#067--data-layers-and-the-twin-small-fixes--done-2026-10-07) |
| 068 | The tile stream loads only what the fog lets you see: a stream camera whose far plane ends at the fog (`streamFarFor`), the camera keeps 6 km for the sky | DONE (2026-10-10) — steps 1–4, 6; step 5 (the boot's own fog) not built; no saving at Dresden's south-west spawn view (the site's edge is inside the reach), the gain is across the city and from the air | [completed.md](./completed.md#068--the-tile-stream-loads-only-what-the-fog-lets-you-see--done-2026-10-10) |
| 069 | Find what holds the load at 52 %, then take it off the tile path: local timing marks, an honest 52 %, a per-tier hand-over wait, meshopt workers, ask sets in idle time, a lazy BVH | **PARTIAL** (2026-10-10) — steps 1, 3–7 built (5 on the performance PR with a bounded scene compile, deduplicated stage reports, concurrent raster fetches, a stall guard, one change pass per task, WebKit's `scheduler.yield`; then one meshopt worker on a phone, the tiles' CPU arrays counted (`cpuMB`), step 7 ungated by the iPhone crash reports — the BVH when a ray needs it); step 2's device rows open: measured locally, mobile-emulated (the plan's Findings) | [069-streaming-without-stalls.md](./069-streaming-without-stalls.md) |
| 070 | Each tile holds a fraction of the raster memory: a 1024² coarse class raster, the sports raster on a desktop's fine level only, optionally a half-resolution desktop splat | **PARTIAL** (2026-10-10) — steps 1–4 built (step 4, the desktop's fine splat at 2048², judged on SwiftShader plates: nothing blockier, −64 MiB a fine tile; one real-GPU glance at the PR's snapshots left); step 5's GPU and phone measurements open | [070-raster-diet.md](./070-raster-diet.md) |
| 071 | A phone renders a lean scene, a desktop a lighter one | **PARTIAL** (2026-10-10) — phone GTAO at 8 samples (not 0), a phone rich-crown budget of 800 (not *Multi-Tuft* off), no autofocus ray without a lens blur; step 4.2 (no desktop DoF) REJECTED by the maintainer; steps 3 (no shadow-camera tiles on a phone), 4.1 (desktop DPR ≤ 1.5), 5 (a phone streams to 2.2 km) and 7 built in a second pass; step 6 measured headless only — frame rates, an iPhone's memory and real-GPU plates open | [071-tier-budgets-lean-phone-lighter-desktop.md](./071-tier-budgets-lean-phone-lighter-desktop.md) |
| 072 | A cold build bakes a site's tiles on every core | **DONE** (2026-10-31) — the warmers bake every cold site, tile by tile (`PREPARE_WARMERS=0` turns them off): once a whole cold site no longer fitted twice on Vercel's 4-core, 8.6 GB builder, one process per site baked one site at a time; two tile warmers at once took a cold build of all seven sites from 11:07 to 5:19 min on a box held to that builder, manifests identical. 2026-10-10 they had shown no gain there (322 s; main 232–235 s, two sites side by side) and were opt-in for Dresden | [completed.md](./completed.md#072--a-cold-build-bakes-a-sites-tiles-on-every-core--done-2026-10-31) |
| 073 | The look is fixed; the sidebar keeps only the controls people use | **DONE** (2026-10-10) — the default table: *Nebel* the one slider left, the multi-tuft switch kept, the other 25 fixed at their defaults as named constants in their owners (four keep an internal uniform a style or Modell writes); old snapshots load, their keys retired for good (`RETIRED_SNAPSHOT_KEYS`); ADR 0018 amended; ~3 kB gzip; the two edited e2e specs pass; not done: GPU plates (none in the container), the rest of the e2e (CI) | [completed.md](./completed.md#073--the-look-table-frozen--done-2026-10-10) |
| 074 | Architecture: bake the static dressing into the fine level, the optional features (Modell, picture styles, data layers) behind one lazy seam, the spine with a test surface, one store for the HUD | **PARTIAL** (2026-10-10) — part D built: the HUD's scene-status store (`lib/city/slice-store.ts`, `app/_components/scene-status.ts`), each widget reading its own slice, `create-app.ts` unchanged; over a lite boot, 30 frames standing and 30 in Modell `CityWalk` committed 4 times instead of 75 and `SceneSidebar` 4 instead of 75; part B: the seam built (`feature-seam.ts`: the spine's hooks, `lazyFeature`, since 2026-11-11 `startOnce`; the data layers start on their first switch-on, the traffic slot waits for its builder), the `import()` measured and **stopped** — the data layers as a chunk of their own made the first-load JS 22.7 KB gz larger for 10.1 KB moved (three.js lost its scope hoisting with the scene), so their code ships with the scene, and the styles and Modell were not started (the Findings); parts A and C open (each opens with a spike) | [074-architecture-deepening.md](./074-architecture-deepening.md) |
| 075 | Window axes measured in open street photos (Panoramax, Mapillary) as fine vertical lines — the one case the window-grid veto allows | **DONE (2026-11-01)**: the photos' rhythm draws windows on every house (ADR 0010, PR #143); the axes stand where the drives, registered onto each other, saw them (`window_axes.py`) | [completed.md](./completed.md#075--window-axes-from-street-photos--done-2026-11-01) |
| 076 | Streaming without holes: the ground before the buildings, a ground plate under every tile without terrain, LoD1 as the buildings' far level, the coarse crowns from the start — no cost in phone memory or bytes before the first picture | **BUILT** (2026-11-04, checked against the code in PR #265) — all four steps built (`stream-order.ts`; `aefc090b`; `a08c6813`; `4eafaf42`); open: phone memory and frame time measured on a device, then condense | [076-streaming-without-holes.md](./076-streaming-without-holes.md) |
| 077 | One rasters module: a tile's rasters loaded, shared and weighed behind one interface, their files named by the artifact table | **BUILT** (2026-11-05) — steps 0–6, step 4 option (a) only. Step 1 (2026-11-04): `lib/city/tile.ts` has a `terrain` column and a `cultivatedLow` row, `terrainRasterExtras` writes the raster extras in `TERRAIN_RASTER_KEYS`' order; a cold bake byte-identical to the base (`diff -r` empty; 667 artifacts, 375 s on 4 cores). Step 2: `raster-upload.ts` `loadDataRaster`, one decode-with-look path. Step 3: `app/_components/tile-rasters.ts` (`createTileRasters`, `RASTER_KINDS`, `rasterFiles`), 11 tests; the shares, `holdRasters` and the loaders gone from `tile-stream.ts`, `terrain-layer.ts`, `sky-light.ts`. Step 4 (a): `loadNdviSampler` fetches through `fetchRasterBytes` and decodes in `inRasterTurn`. Measured on a Mac's real GPU (headed Chromium, WebGPU, production builds; two runs a profile, three of the base's lite; the probe waits past the plan's 120 frames for the stream to idle and `held` to rest 8 s, on either side): after each of steps 2–4 the requests and their counts and the sorted graph keys equal the base's per tier and scene (lite desktop 19 requests, phone 16; full 83, 46; graphs 2, 2, 8, 5). `tileCache.bytes` and `gpuBytes` equal it: phone lite 204 777 917 and 177 324 236, phone full 403 439 483 and 370 529 357, desktop lite 247 053 645 and 219 599 964, desktop full 808 662 700 / 808 712 092 (the base shows both) and 806 015 495. `held` moves within the base's own noise: `textures` ±1 (a 1-byte target; phone lite 60–61 on base and after step 4, phone full 81 on base and 82 after steps 3–4, `texturesSize` +1 B); step 2's runs reached phone lite `texturesSize` 71 615 280 and desktop lite `geometries` 452, against 71 409 344 and 445 settled (an unsettled base run had shown 71 615 281; step 3 and 4 are back at the base's values, in code that step 2's loaders did not change: read as noise, not proven). Plates (`qa/views`: street-crossings, sports-ground, colony, elbwiesen, meadow-eye, across-400, oblique-400), before against after each step, pixel-diffed and read: the ground, the sports lines, the colony beds, the shoreline, the crown tints and the far shadows the same; what moves is crown sway, water and sub-pixel edges. `bun run verify` 3 934 pass; e2e 35 of 35 on the last commit (`--workers=2`, headless). Deviations: `createTileRasters` is made in the plugin's constructor, not as a field (`this.ctx` is unset when fields initialise); `calculateBytesUsed` counts a level's share only once its terrain is dressed, so a tile still in `processTileModel` weighs 0 as before; `onShareChange` skips a root that left (`released`), since rasters now weigh from their landing, a level still dressing is a holder, and reweighing a tile inside its eviction adds its bytes back for good; `acquire` answers null after the hold's release or the rasters' `clear`; the terrain test keeps its name's meaning over a real holder, and `tile-stream.test.ts`'s clear test watches `rasters.clear` instead of `held()`; a test of the sampler's turn added in `vegetation-layer.test.ts`; one comment in `lib/city/tileset.ts` still says `terrain-layer.ts readsSportGrounds` (now `tile-rasters.ts`): an edit there re-bakes every site's terrain, left for its next change. **Open:** a phone's memory on a device (the phone profile here is Chromium's emulation); the `pr-snapshots` section when this goes up as a PR. | [077-one-rasters-module.md](./077-one-rasters-module.md) |
| 078 | One scene environment the dressings bind at birth: one night node, one season watch, one clock; `catchUp` goes | **BUILT** (2026-11-04) — steps 1–5 (`scene-environment.ts`: `sceneNight`, `fountainsOn`, `clockMinutes`, `drawnAtNight`, the season and clock watches; `withMaterialsShown` in `compileNow`/`compileUnder`; `followEnvironment`; `follow`; later (review) a season change redraws the shadow map once for every hung dressing — `castersBatch`, a microtask — and never for one built but not hung); the latent bug fixed (mist, wakes, fences follow the night with no lamp tile dressed). Deviations: drift since `6c2a70ba` large but every name found; the environment writes in two calls, `light(sun)` (from `relight`, which a style change runs alone) and `date(date)` (from `setSun`), not one `set(sun, date)` — one call would re-emit the data layers' clock on a style change; `groundSeason` (new since the plan) follows the season watch in `create-app.ts`, and the nameplate's per-frame night reads `sceneNight.value`; three is r187, whose `material.visible` check sits in `StandardDrawingPipeline` (same semantics as the plan's r186 reading); the material lift is in `compileNow` (so `compileOne`, the plain cut holds and the paper swaps) and `compileUnder`; the catch-up test became a `followEnvironment` test plus the stream's dispose letting a dressing's follow go (no plugin-level compile test); AGENTS.md has no *Where things live* section on this branch, so it was not touched; probe frames were taken by the step-0 script itself (pastel, 800×600, lite, a held fixed-step loop) instead of `probe.mjs`. Measured (lite, SwiftShader, `NEXT_PUBLIC_POC_DEBUG` builds per step; two base runs for the spread): `framedBuilds` deltas over night → dusk → January day → July day → January night → July day and traffic on/off 0/0 on base and after every step; `anchors` 62 (63 with traffic) throughout; the boot's own count varies run to run (desktop `other` 58–60, phone 42–46, base included); memory deltas over the instants identical; phone after step 4: `gpuBytes` 168.69 MB (base 168.69–168.70), `memory.total` not higher, traffic on/off deltas not higher; frames per instant against the base ≤ 0.06 % changed (base against base the same). Unit tests green but `lib/city/png-raster.test.ts`'s whole-site decode, which times out at 5 s under the shared container's load (passes alone; not touched here). e2e (CI timings, `CI=1`): `@desktop-render` 10 passed with the new night step in *post and shader controls*; *Modell: M enters …* times out on this container on base and branch alike (the glide back, line 1495); `@desktop-hud` and `@phone` 12 passed. Plates judged 2026-11-05 on a Mac GPU, against the base 5f6c049b (`qa/views`: lamps, fountain, river, Modell at night): the same picture; the lamps' hard-edged halos and the brown Elbe of Modell's low sun were there before it | [078-one-scene-environment.md](./078-one-scene-environment.md) |
| 079 | A page that lost its GPU comes back where it stood, through one recovery session | **BUILT** (2026-11-04) — steps 1–6: the caps and `arrivalOf` in `lib/city/gpu-recovery.ts` (snapshot.ts as a type only), `createRecoverySession`/`pageRecovery` in `app/_components/gpu-recovery.ts` (15 sequence tests), the three crash readers and `city-walk.tsx` call it; nothing stored changes (privacy page, `storage-keys.ts`, `create-app.ts`, `page-lifecycle.ts` untouched). Deviations: steps 3 and 4 are one commit (the old exports go in 3, their callers follow in 4); `city-walk.tsx` imports `arrivalOf` as `recoveryArrival` (`lib/city/geolocation.ts` exports an `arrivalOf` of its own); the session's members are property signatures (lint `method-signature-style`); the boot's "cancelled" is `aborter.signal.aborted` since the plan. Verified: `bun run verify`, `typecheck:tsc`, e2e `@phone|@desktop-hud` headless (12 passed; the container's Chromium 1243 under a 1248 alias). **Open:** the manual preview checks 1–5 (a forced `loseContext`, the caps, the reset, StrictMode, `?safety=2`) and the automatic recovery on a real iPhone (plan 019 §M) — not run here | [079-gpu-recovery-session.md](./079-gpu-recovery-session.md) |
| 080 | One row per inquiry kind: the twin's per-kind dispatch in one place | **BUILT** (2026-11-04) — steps 0–4 and 6; step 5 skipped by its own rule (no tram kind planned: no plan, no `tram-ask.ts`). Drift: a 13th kind, `design` (d54ecce1, 2026-10-30, `lib/city/inquiry-design.ts`), already had an arm in every switch, so the Findings' counts are 13 kinds, `KindIcon` has 14 names (`pencil-ruler`), the design row's key is `design:${file}:${partIndex}`; `inquiryCard` takes `landmarks` too (the `CardInput` carries it); the crown form had moved from `outlineShape` into `selection-shape.ts` `crownFormOf` (deleted with `CrownForm`). The table's generic lookup needs no cast (`bun check` and tsc); the vote key is on the rows through a conditional `KeyRow` and a `KeyTable` view (`keyOf(kind, t)`), so `thingKey` and `porous` left the probe (`thingKey`, `isPorous` in `lib/city/inquiry.ts`). Step 6's one `PIER_REACH` lives in `lib/city/ask-solids.ts` beside `ringDistanceXz` (review: the outline no longer imports the pick for a constant). Card texts unchanged (every card test as before). Lineage chunk lazy: its string in one file, not fetched by `/dresden?scene=lite` before `__poc.ready`; first-load JS 1 035 454 B gz against 1 034 999 at 8b8ec332 (+0.44 KiB, with plan 079 on the same build). e2e headless: the inquiry card and tree specs passed; long-press ask timed out once under a load of 15 and passed in the `@phone` run. **Open:** step 6's real-GPU plate of an asked cone tree, a round crown and a bridge (`bun run shots`) | [080-one-row-per-inquiry-kind.md](./080-one-row-per-inquiry-kind.md) |
| 081 | One schema per file a bake hands over: zod schemas checked in the build for the files Python writes and TypeScript reads; the monuments carry their own OSM Wikidata link | DONE (2026-11-05) — steps 0–7 2026-11-04 (ADR 0059, seven schemas, `bake-files.test.ts`); step 8: `wikidata` is OSM's link, `materialWikidata` the material's item, a linked item first and shared by every monument linked to it; step 9 re-baked all seven sites (457 OSM links, 67 Wikidata materials, +12.3 kB; Dresden's four more Bronze the only change beyond the keys). 254 linked items the cache lacks: backlog item 28, closed by a measurement (2026-11-05: one has a `P186`) | [completed.md](./completed.md#081--one-schema-per-file-a-bake-hands-over--done-2026-11-05) |
| 082 | One answer turn and end codes for *Frag die Stadt*: the route a thin binding, every refusal and end a code from one table | **BUILT** (2026-11-04) — Steps 0–4 built: `answerTurn` in `ask-run.ts` with `TurnDeps`, the route a binding (`route.test.ts`, `ask-turn.test.ts`); `lib/city/ask-failure.ts` (the table, `askFailure`, `codedRefusals` as the connection's `fetchClient`); every refusal and stream end carries its code; ADR 0056 rewritten. Verified: `bun run verify`, `typecheck:tsc`, the Frag e2e headless against a production build, `curl` (400 `bad-request`, 501 `no-secret` coded, the log line). Deviations: Step 0's question is „Frauenkirche“ and the fixture stands on whole metres (the scripted model matches every word and reads integers); a non-JSON body reaches the turn as `null`; `ask-city.ts` imports from `ask-failure.ts` (as Step 2.1 says; still outside the main bundle); `gone`'s row keeps the route's words; refusal bodies now carry the card's words, the `bad-props` detail only the log line; `conversationProblem` returns a code, so its three reasons are three rows (`no-question` 400, `too-long` 413 with a reset, `question-too-long` 413 without) and the card says which (a review's find: one `too-long` had hidden the question's cap), `QUESTION_CHARS` moving into `ask-failure.ts` for its words and `ASK_LIMITS`; the e2e reads the answer's *KI* label as the last (a refused answer leaves an empty labelled row, as an uncoded one did). Finding: an *uncoded* non-2xx reaches `chat.error` as the run-less `RUN_ERROR` without `status` (`HTTP error! status: 401 …`), so `askFailure`'s status fallback does not fire for a host's 502/504 — pre-existing, unchanged. Not done: the by-hand `FRAG_FAKE=1 bun dev` walk (the e2e and the scripted turn tests cover its parts) | [082-one-answer-turn-and-end-codes.md](./082-one-answer-turn-and-end-codes.md) |
| 083 | One lifecycle for a tile's late parts: dressings, murals and traffic bodies behind one per-tile registry | **DONE** (2026-11-04) — `late-parts.ts` (Design B) with three adapters (`dressingPart`, `muralsPart`, the traffic slot's part owned by the dressing); `hangDressing`, `dropDressing`, `weighDressing`, `hangMurals`, `TrafficHost`, the plugin's lane and the private test reaches gone; behaviour changes D1–D5, D7–D10 as planned, D6 kept (finding 4). Deviations: `hang` returns the take-down; a `"wait"` part settles `"hung"` as it hangs and one out of memory within its wait never hangs; the murals' adapter takes its drawings' builder; the fake host is `late-parts.fixture.ts`. Measured (SwiftShader, load 2–4.6, shared container): `framedBuilds` deltas 0, `anchors` 62/63, phone `gpuBytes`/`memory`/`cpuBytesOf` within the base's own range, switch-on peak no higher; veil to loaded within noise (base median 224 s over seven runs, step 4 233 s over seven; run order alone moved a pair by 119 s); switch-on last body 135–185 s (base 158–202), coarse bodies first. e2e (headless, local): `@phone` green at steps 2–4; `@desktop-render` 10/11 at every step and on the base — *quality regresses while moving* fails on the base too (shadow renders 4–15 of 8 frames); `@desktop-hud` *live mode* failed 3 of 6 runs at step 4 and passed at the base, steps 2 and 3 (one run each) — flaky on this container, watch it on CI. **Open:** finding 4's gate — the bodies hold the lane ≈ 110–130 s of a headless switch-on (more than 1 s): measure on a desktop GPU before letting `"compile"` parts overlap there (follow-up). No real-GPU plates needed (no check moved). | [completed.md](./completed.md#083--one-lifecycle-for-a-tiles-late-parts--done-2026-11-04) |
| 084 | One session for an answer's lifetime: reading aloud, Hörmodus and the scene's waits behind one pure session, with the maintainer's product decisions | **BUILT** (2026-11-04, after 082) — Steps 0–6 built: `lib/city/ask-session.ts` with its tests, the card wired to it (`useSpeech`/`useDictation` moved up into `AskCity`), decisions 4–6 and the failed-answer fix, ADR 0057 rewritten, the guide (de/en) one clause. Drift check: only 082's commits touched `ask-city.tsx` (not the rule table's parts); ai-client 1.0.1. Verified: `bun run verify` per step, `typecheck:tsc` and the Frag e2e headless (production build) after Steps 1 and 5; `chat.stop()` calls no `setError` (Step 2, read in ai-client 1.0.1). Deviations: `run.stop` comes before `waits.abandon` from Step 0 (the stop button's today order reversed, as the plan's Ordering allows); `lastFinished` joins the state in Step 4 (unused before, the linter refuses it); the dictation port's `start` returns whether the microphone opened and `useDictation` gained `abort`; a failed answer ends its run even when its text is empty (a failure during `was_ist_da`, the case Findings names); Hörmodus off with its own reading also stops the voice, as Vorlesen off does; Step 0's stop test pinned the whole call list and was narrowed in Step 5 (besides the four named tests); Modell's centring glide is left alone (5.5: it reports 1 at once). Open, not done here: every manual device check (Verification 1–11: iPhone Safari, Android Chrome, desktop Chrome/Safari/Firefox — iOS priming, locked phone, the network panel); the headless e2e has no voice bar | [084-one-session-for-an-answers-lifetime.md](./084-one-session-for-an-answers-lifetime.md) |
| 085 | Window niches and shop windows: performance (refill, object texture, wall copy, first-cut compile, shadow discard) and rare follow-ups from #273's review | TODO (2026-11-10) | [085-window-niche-follow-ups.md](./085-window-niche-follow-ups.md) |
| — | Aesthetic and visual fine-tuning roadmap (ten items) | DONE except atmospheric motes | [completed.md](./completed.md#aesthetic-and-visual-fine-tuning-roadmap--done-except-motes) |

## Open work

**Direction since 2026-09-27: a digital twin with an aesthetic claim.**
The maintainer set it and fixed two rules: the app stays **static where
possible** (ADR 0001, amended), and **text appears only in a card, on
demand** — the scene stays wordless (ADR 0042). Plans 052 (ask the city),
050 (time and live sources) and 051 (scenarios) carry it; plan 019's GPU
pass comes first for them too, since every new look is unjudged there.

**URL parameters go in the query, `?…`, never the fragment** (the
maintainer, 2026-11-05: a query shows in the host's request log for
diagnosis, and several parameters sit side by side). `?snap=` (048) and
`?at=` (058) moved there; one that carries a place is named on the
privacy page, and the crash trail — so the reports — keeps only the QA
knobs (`TRAIL_QUERY`), never a place.

Ordered by leverage. Everything here is vetted against the code; effort
S/M/L.

0. **Plans 037–048 (2026-10-01 audit) — before the items below.** Done
   2026-10-03 (picked for the phones: crashes and slowness): 037, 038,
   041, 042, 044; 043 was closed 2026-11-04, built in another shape
   (the near tiles' BVH in a worker), and 046 closed drifted — its rest
   is item 27. 039, 040 and 045 are done (2026-11-05). The spikes 047 and
   048 can go any time after 038. Plan 019 (item 1) stays the one that
   needs a GPU; 048 part B adds to its checklist. Plan 022
   (the re-bake from the current editions) is done (2026-11-05). Plan 017
   phase C was built by plan 049 without 045's named class ids; 045
   covered `landcover_osm.py` too.
   **Plans 056–067 (2026-10-06 audit) — order:** 056 (a skipped test,
   minutes) → 057 (seam buildings) → 058 → 059 (privacy) → 060 (the
   spine's failure paths) → 061 (the bake cache) → 062 (traffic on
   demand, phones) → 067 (data layers, the twin) → 063 (build and fetch)
   → 064 (CI, needs a PR run) → 065 (docs) → 066 (the lifecycle machine,
   after 060). All twelve done; condensed 2026-11-04. 040 was
   refreshed and built (2026-11-04); 039's step 3 is
   moot. The non-interactive run picked these twelve by leverage from the
   vetted findings below; the rest is the 2026-10-06 backlog.
   **Plans 068–074 (2026-10-10 performance audit) — order:** 069 steps
   1–2 first (the timing marks, measured on a desktop and an iPhone: they
   decide 069's gated steps and 074 part A) → 071 step 6 and 070 step 5
   on a real GPU and an iPhone (071's 3, 4.1, 5 and 070's 4 are built)
   → 072 → 074 B (built as far as it pays: the seam, no lazy chunk —
   see its row) → 074 A. (073 is built: the maintainer let the
   default table stand.) Authorize the Sentry connector before measuring: the
   per-device frame-rate and memory summaries already arrive there (ADR
   0043).

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
13. ~~**Bundle: `proj4` for one conversion (S).**~~ Done 2026-10-10:
    `lib/city/crs.ts` sums Krüger's series to n⁶ (forward, inverse and the
    convergence), held to proj4 over every site's tiles by its test;
    proj4 is a devDependency (that test, the e2e). The chunk the HUD and
    the scene both wait on went from 178 965 to 51 263 bytes (60 686 to
    20 058 gzip -9). (`GLTFLoader` is load-bearing now: every tile is
    glTF.)
14. **Split the `create-app.ts` closure (L; 1 598 lines at `a28de75`).**
    Partly done 2026-09-26: the ground (`lib/city/ground.ts`) and the
    second boot phase (`lib/city/boot-phases.ts`) left the closure.
    Telemetry and picking were plan 046's step 2, dropped with it
    ([record](./completed.md#046--moves-only-split-the-god-modules-and-sweep--closed-2026-11-04-drifted-the-rest-in-the-backlog)).
    Left: lamps and the scene-wide state the dressings bind — see item
    20.
    The 2026-11-04 review (PR #265) found that the rest fails the deletion
    test as section-sized modules: each section reads 10–20 of `bootApp`'s
    locals. Move pure functions only (`outlineShape` to
    `selection-shape.ts`, `answered` to `lib/city/inquiry.ts`, perhaps
    capture/export); demolitions are item 26's own candidate.
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
20. ~~**One scene environment the dressings bind at birth (M).**~~ Done
    by plan 078 (2026-11-04): `scene-environment.ts` holds the night, the
    fountains' season, the clocks' minutes and the season and clock
    watches; `setSun` and `applyLook` no longer loop over the dressings,
    and `catchUp` is gone. What it was: half done
    by plan 020: the per-tile copies are gone. Scene-wide values are
    uniform nodes every tile's materials share — the sun, the ground rows,
    the fog (`scene.fogNode`), the crowns' look and wind clock
    (`sceneCrowns`), and module-level nodes for the lamps' night, the
    fountains, the furniture and the map overlay (the old
    `FOUNTAIN_UNIFORMS`/`FURNITURE_UNIFORMS`/`MAP_OVERLAY_UNIFORMS`
    objects). The per-frame clock is one write a frame since 2026-10-30
    (`setCrownTime`, `setWaterTime`). Left: `create-app.ts` still loops
    over every dressing on a change (the lamps' night — which also flips
    each tile's glow and pool visibility, so it is no plain node write —,
    the vegetation's look), and `catchUp`
    (`tile-stream.ts`) still brings a dressing that was compiling up to the
    present (season, look, night). One environment object bound once
    would delete the loops and shrink `catchUp` to the per-dressing state
    (the season's instance buffers, the rich-crown toggle). Planned in
    [plan 078](./078-one-scene-environment.md).
21. **A geometry kit for what stands on the ground (M).**
    Seven triangle-soup writers decide the winding rule in four ways
    (rail's `pushTri` auto-winds to the normal, furniture's `addSlab`,
    `kerbs.ts` reorders, `walls.ts` is double-sided, `fences.ts`,
    `stairs.ts`, `small-buildings.ts`). The runtime half is built
    (2026-10-30): `app/_components/mesh-kit.ts` is the soup accumulator the
    rail, tram, riverside and catenary layers share, its winding guarantee
    tested on its own (`mesh-kit.test.ts`); the catenary's copy of `quad`
    went with the import cycle that forced it. Left: one pure module
    (soup accumulator with one winding rule, ribbons, footprints, columns,
    the resamplers) used by the runtime layers and the bakes. Deferred on
    2026-09-26 until the WebGPU port had rewritten those files (done);
    unifying the winding changes baked geometry — needs its own earcut
    (`lib/city` forbids `three`) and a headed shot comparison.
22. **One terrain raster loader driven by the artifact table (M).** The
    artifact table (`lib/city/tile.ts`) now names the dressing, coarse,
    ask and OSM files, but the terrain's rasters still go their own way:
    `prepare-data.ts` spells their names into the terrain extras by hand,
    and `terrain-layer.ts` has one loader per raster (splat, NDVI, paving,
    edges, sports grounds, colonies, markings) plus the detail-raster
    bookkeeping. A raster column in the table (level,
    channels, filter, mipmaps) would let one loader serve them all.
    Deferred on 2026-09-26 until the port had rewritten the loaders; it
    kept them as `DataTexture` loaders bound to node textures, so this is
    unblocked. **Built** ([plan 077](./077-one-rasters-module.md)): the
    build writes the raster extras from the table's `terrain` column, and
    `tile-rasters.ts` hands a content root its rasters by kind. What
    remains: the ground graph's slot lists (`SplatLayer` … `splatSlots`)
    and `TerrainExtras`, still hand-typed, keep a new raster at about
    seven edits.
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
    join; tram tracks have no ground-join test (ADR 0030: a runtime part is
    tested with `checkJoins`).
26. **Leftovers of the 2026-11-04 architecture review (PR #265).**
    *Nameplate placement in one module* (M): the eave rule spans
    `nameplate.ts`, `create-app.ts`, `nameplate-ask.ts` and the pose and
    was rewritten in nine review rounds; **the maintainer decides first**
    how the property table encodes a missing `baseZ` (noData, ADR 0042:
    never 0, yet `nameplate.ts` `ownMass` reads 0 as missing today; a
    marker changes the baked table),
    then `createPlacement({now})` and one `plateSubject`, un-exporting the
    test-only helpers. *Card and plate from one answer* (M, after 080,
    **the maintainer's decision first**): two caches and two retry rules
    hold "the plate says nothing the card does not". *The view's rest
    owned by the viewer* (S–M, after 084): `ask-scene.ts` guesses the loop
    (250 ms, 100 ms polling). Looked at and left: it needs a decision, for
    a wait counted in the loop's updates changes the timing beyond the
    guess. The loop is paced (`frame-pace.ts`: covered, still, listening)
    and a hidden page draws nothing, so two frames are about 30 ms on a
    desktop and a second under the Hörmodus (2 fps), none at all while a
    sheet scrolls, where 250 ms is 250 ms today; the visible-clock and wall-clock bounds stay either way (a
    locked phone). Options: (a) an update counter beside
    `stream.tiles.update()` and a `viewAtRest(signal)` promise, with the
    pace woken while an answer waits; (b) (a) without waking, accepting
    the slower answer under the Hörmodus; (c) events for the 100 ms polling
    only (`onBusy`), the 250 ms stays. *Demolitions as one module*:
    built (`app/_components/demolitions.ts`, with its tests), but for its
    last step: the memory still lies in `TileStream.demolished` and
    `demolishedGroups`, which only the module writes now. Moving them into
    it touches `tile-stream.ts` (a few lines and its test's fixtures), left
    until plan 077 lands there. ~~*`facades_<tile>.json`*~~ and ~~*the tile sources' schema
    pass*~~: built, ADR 0059's excuse gone. What stays cast is what the
    item did not name: the land-cover legend's `water`
    (`scripts/tile-sources.ts` `waterMember`).
27. ~~**The moves plan 046 left (S each; moves only, no pixel change).**~~
    Done 2026-11-05 (plan 046's [record](./completed.md#046--moves-only-split-the-god-modules-and-sweep--closed-2026-11-04-drifted-the-rest-in-the-backlog)).
    *The rail split:* `rail-layer.ts` (2 982 → 1 215 lines) keeps rail
    proper, `bridge-layer.ts` the drawn bridges and the span decks,
    `bridge-deck.ts` the deck table and the approaches' plan (the table
    reads them; `addApproach`, their drawing, is `bridge-layer.ts`'s).
    `COLORS` went to `mesh-kit.ts`. Every vertex rail and tram build from
    Dresden's and Hamburg's committed data hashed the same before and
    after. *The TSL helpers* live in `shader-chunks.ts`, `hash21` one export
    of the two byte-identical copies. *The sweep:* `texSize`, `pageUsable`
    and `SVF_PX` gone, `HORIZON_BANDS` and `LANGS` private,
    `use-coarse-pointer.ts` beside its one user. **Left out:**
    `quadXYZ` and `pushTri` keep plain numbers: point structs would allocate
    per quad, which those two exist not to do. `lineLevelsAt` and `addRail`
    stay in `rail-layer.ts`, so `tram-layer.ts` still imports it.
    `components/ui/{dropdown-menu,input-group,kbd,spinner}.tsx` still have
    no importer and are still here: shadcn 4.23 has no `remove` command, and
    `components/ui/` is not edited by hand — the maintainer's call.
    `SUPPORTED_EPSG_CODES` (`crs.ts`, used nowhere) and the comment in
    `lib/city/decks.ts` that still named `rail-layer.ts` went with the
    2026-11-11 audit's first PR, whose platform cache re-keyed every
    site's bakes anyway.
28. ~~**The monuments' linked Wikidata items the fetch misses (S).**~~
    Closed 2026-11-05 by a measurement, nothing built: of the 156 items
    OSM's monuments link to and that still have no material (every
    committed site), Wikidata gives one a `P186` (Q113997592, aluminium,
    which the material table does not read); a control query confirms the
    question answers. A `VALUES ?i` query and a re-fetch and re-bake of
    all seven sites would add no material. Ask again if Wikidata's
    coverage grows.

### 2026-11-11 audit (the whole code, against `f762ce78`)

Asked by the maintainer: *a comprehensive review — correctness, what can
be simpler, how the app, the bakes and the start get faster, what makes
the footprint smaller; effort is no criterion.* Eight parallel read-only
auditors (spine, frame, memory, layers, the TypeScript build, the Python
pipeline, the web shell, the repository), every finding re-read or
re-measured by the lead. The report with its evidence (German):
<https://claude.ai/artifact/SdfpkgbXtF1L6MBBVJQchV>. Baseline (four
cores): `prepare-sites` cold 360 s, warm 10 s; `next build` 49 s; the
units 42 s (4 522 tests); `/dresden`'s first load 1.0 MB gz of JS;
`public/data` 561 MB, `data/` 936 MB, the git pack 1.10 GiB after 16
days.

The maintainer chose all of it, as eight stacked PRs in this order. The
ids are the report's.

1. **Bugs and small wins — built (2026-11-11).** K1 a `.shp` record
   length that does not advance looped for ever, and a `.dbf` header
   could count more records than the file holds (`shapefile.ts`; a
   design's every picked file is weighed, not the first). K2 the
   teardown is total (`cleanups.ts`: every cleanup runs, the renderer is
   released whatever threw; a boot that failed is `disposed`; queued
   captures reject). K3 a step whose raw input is merely not on the
   machine leaves its committed file (`Tile.raw_absent`: dormers,
   structures, the Mapillary lamps). K4 the timetable's days count from
   the feed's own date, not the clock. K6 a tile whose dressing threw is
   freed; the facade readings stop with the stream; `withinWait` clears
   its timer. L5 the street lamps' loop does not run on pixels no lamp
   of the set can reach. L7 the lamps are ranked ten times a second, not
   every frame. L8 the painted ground is read once a pixel, not three
   times. B3 the platforms' cut is cached (`BAKE_ENTRIES.platforms`): a
   warm `prepare-sites` 6.7 s → 2.3 s. B8 a site's tiles are placed by
   their names, a deck's surface model opens its neighbours only. T1
   `verify` runs the reference `tsc`. T2 the boot's marks before the
   first frame (`boot:page-to-viewer`, `boot:renderer-init`,
   `boot:tileset`, `boot:setup`, `boot:spawn-wait`). T3 the bake says
   each tile's and each step's seconds. T4 a docs-only PR runs one e2e
   shard; the unit and pipeline jobs have ten minutes. V9 three dead
   exports gone (`KNOWLEDGE_TOOLS`, `bedAt`, `SUPPORTED_EPSG_CODES`).
   **Left for their PRs:** `SKY_REFLECTION_BYTES` (dead; PR #286 edits
   the file), V8 (the lazy seam's importer, with the spine in 7),
   `networkx` as a named dependency (with 5: today a changed `uv.lock`
   re-keys every Python step).
2. **The buildings' vertex stream, byte-identical (V2, B6) — built
   (2026-11-11).** `bake-city-mesh.ts` (3 833 lines) is nine modules on
   one typed stream (`scripts/vertex-stream.ts`: `appended`,
   `streamWriter`; the attribute list stands in one place, no copy goes
   through plain arrays). A cold bake of all seven sites publishes 0 new
   files. The measurement corrected the report: the stream's copies were
   not the peak. A tile's memory peaks in the walls' cut for the
   passages, the rounded normals and the glb's writer, so those took the
   work — the mesh is released once the glb is written (the far glb
   needs its table alone), the writer turns positions and normals in
   place, the normals keep one bucket table, the passages copy only
   triangles in a passage's box, two more collections. München's
   heaviest tile baked alone: 2.58 → 1.88 GiB; Dresden's (33414_5654):
   1.64–1.88 → 1.33–1.49 GiB. Four tiles side by side still reach
   1.9 GiB (garbage the collector has not yet taken when the cores are
   busy), so `TILE_PEAK` stays; measure again after 3, which takes most
   of the triangles away. **Not done:** each stage its own cache entry
   (stream, glb, far glb) — the stream would have to be written to the
   cache, 400 MB a dense tile; the table read back from the glb (it
   saves a parse only when the far glb alone is stale).
3. **Bands, kerbs and what the cache weighs (F1, F3, F9, T8) — built
   (2026-11-11); re-bakes every site's buildings and fine terrain.** F1:
   a band is cut where its wall bends, not every metre
   (`lib/city/doors.ts` `thinned`: a knot stays where the line between
   its neighbours would sink the band more than 1 cm into the wall as
   read or stand it more than 3 cm off). Dresden's fifteen tiles: 22.4 M
   → 7.1 M triangles, 20.1 M → 10.4 M vertices, 59 → 41 MB of download;
   the dense tile 33412_5656 1.84 M → 0.57 M, its bands 1.63 M → 0.36 M
   (still 63 %: ten to twelve triangles a piece of the rounded profile).
   The maintainer decides whether the rounds become one facet and
   whether the far level carries bands at all (asked 2026-11-11). The
   far level hardly moves (4.08 M → 3.68 M triangles, 37 → 35 MB): its
   simplifier had already taken the knots, and it is now nearly as heavy
   as the near one — F4's part for it stands. A tile's bake peaks at
   1.26 GiB (1.9), so `TILE_PEAK` is 2.0 GB and Vercel's builder bakes
   three tiles at once. F3: the fine terrain's kerbs, stairs and walls
   are indexed (`tile-glb.ts` `indexed`, exact: the same picture):
   Dresden's kerbs 9.2 M → 4.6 M vertices, the fine level's glb 66 →
   48 MB decoded, 33 → 31 MB of download. F9: a city tile weighs its
   table, its texture and its positions' padding in the cache
   (`CityLayer.heldBytes`). T8: the numbers this moved (rendering.md's
   table, `tileset.ts`, the workflow's sizes). **Left, each a PR of its
   own to judge on a phone:** F4 (the object id in the position's
   padding and a lighter far-level vertex: a vertex format the WebGPU
   path alone can prove, and after F1 worth a third of what the report
   counted), F10 (one table file for both levels: a second request a
   tile before it can be dressed, for 0.4 MB a tile both levels of which
   load).
4. **Rails (F2) — the viewer's part built (2026-11-11); no picture
   change, no baked byte changes.** The line and bridge meshes were a
   triangle soup of floats. `mesh-kit.ts` now finishes every mesh welded
   and indexed (`lib/city/weld.ts`, exact: corners that agree in every
   attribute bit for bit are one vertex; 16-bit indices where they
   reach), with normals as signed bytes (a unit axis exact, any other
   within half a degree; the tiles' own normals are bytes too). The
   sleepers' ribbons take the same finish (`geometrySteps`), and the fine
   terrain's `indexed` (PR 3) is the same weld. Measured on the DGM, built
   as the viewer builds them: the yard tile 33408_5656 2.24 M → 0.74 M
   vertices, 56.4 → 20.4 MB (its ballast 1.22 M → 0.28 M vertices, its
   rails 714 k → 323 k, its sleepers 117 k → 39 k); 33410_5656 rails 23.5
   → 8.1 MB, tram 13.7 → 7.0 MB; 33412_5656 tram 7.1 → 3.5 MB. The
   report's 31.9 MB for the yard tile was low: the ballast alone was
   29 MB. A cold bake of all seven sites publishes 0 new files.
   **Left:** (a) the index is now a third of a rail's bytes (32-bit: a
   yard's steel is one mesh of 323 k vertices); (b) thinning straight
   runs (a rail is sampled every 4 m, a tram every 2 m) would take most
   of what is left, but a line is pressed under a planner's design per
   vertex (`lineUnderDesign`), so longer pieces would rise through a
   design's plate at its edge — it needs a per-fragment cut for lines
   first; (c) the meshes keep their CPU copy (as much again on the page's
   process: only the bridges are asked by ray) — `dropCpuCopies` covers
   the tile's content, not its dressing; (d) the builders still collect
   into plain arrays (some 34 MB of transient heap for the yard) and run
   on the main thread, 3 s for the yard tile on a desktop core, most of
   it the ballast's drape. Baking the lines into the fine ground (PR
   #156, plan 074 A) ends (c) and (d); the maintainer decides whether to
   take that spike up again (asked 2026-11-11): it lies a month behind
   main and across PR #187.
5. **Cache keys (B1, B2, B5, B7, V5) — built in part (2026-11-11);
   renames every site's glbs once.** **B2 built:** the side files a
   content is dressed with are named on its tile in the tileset
   (`lib/city/tileset.ts` `TerrainFiles`, `CityFiles`, `contentExtras`),
   not in the glTF's extras, and in no key: a new sky-view raster no
   longer re-bakes the tile's buildings (20–45 s a tile), a new lamp or
   tree file no longer renames the fine terrain (which visitors then
   loaded again unchanged). Dresden's tileset grows from 21.9 to 57.6 kB
   (3.3 → 9.0 kB gz at the start). **B5 built in part:** the local cache
   keeps a name's three newest entries (`bake-cache.ts` `generations`; one
   on Vercel and in CI), so a checkout across a bake module and back bakes
   neither way. Not built: read access to Vercel's shared cache from CI
   and a desk (a token for the store outside Vercel is the maintainer's
   to give). **B7 built in part:** a Python step's key carries what
   `uv.lock` resolved for the packages a bake runs with
   (`step_cache.locked_runtime`: 40 of 46, not ruff or pytest and what
   only they need) and leaves `step_cache.py` itself out (`VERSION`
   stands for it); `networkx`, which `transit.py` imports, is a named
   dependency. This re-keys every step once, where a cache exists (the
   ruff bump in PR #278 would have under the old key; under this one it
   no longer does). Not built: the spec's part of the key (the tile list
   stays: steps reach their neighbours through it, and a new neighbour
   must run them again), the year in a dated step's key. **B1 not built,
   by measurement:** the key as the hash of each entry's tree-shaken
   bundle (`Bun.build`, 47 ms for all 36 entries) was replayed over the
   last 200 commits on main: the buildings' key changed in 29 of them as
   text and in 26 as bundle, the terrain's in 7 and 2, the ground's in 1
   and 1; over the 55 merges, 18 and 15, 12 and 9, 6 and 5. Nearly every
   commit that touches the buildings' graph changes code they run; three
   bakes in two hundred commits do not pay for a key that every Bun
   release would change. Narrowing the table to the step modules alone
   changes nothing more. **V5 not built:** `islands` and `lamp-heights`
   rewriting an earlier step's file can only be taken apart with the raw
   data at hand (every site's Python bake runs again), which a cloud
   session does not hold.
6. **The start (L1, L2, B4, F6, F12) — built (2026-11-11).** **L1, L2:**
   the route preloads the manifest and the tileset
   (`app/[site]/page.tsx`), and the boot asks for the tileset and the
   start tile's far buildings and coarse terrain as soon as the tileset's
   name is known (`boot-ahead.ts`), beside the scene's chunk and the
   renderer's start; the stream takes them from there and no longer
   fetches the tileset twice. Headless (SwiftShader, CPU ×4, 9 Mbit/s,
   150 ms; three runs each): manifest asked at 0.2 s (was 1.2), tileset
   at 0.2 s (2.9–3.1), first tile content at 2.0–2.2 s (9.3–10.2), the
   far buildings landed at 7.3–7.7 s (24.2–25.0), the boot's wait for
   its tile over at 59–61 s (69–74; that machine parses and compiles for
   most of it). Not built: the viewer's chunks still start after
   hydration (≈ 1.1 s here; starting them when the module first runs
   moved nothing, and preloading them from the HTML needs chunk names
   only Next's private build manifest has), and the timings on an iPhone
   (`?trace=1`) are the maintainer's to read. **F6:** the minimap's
   footprints are a packed file (`lib/city/footprint-pack.ts`,
   `footprints_<tile>.fpr.gz`): Dresden 11.0 MB of JSON (3.0 MB gzipped)
   → 1.9 MB gzipped, no parse, and 460 000 points held as 3.7 MB of
   integers where they were two-element arrays (≈ 50 MB of heap); the
   minimap draws from the pack, a design's cover reads one object at a
   time. **F12:** the tooltips' provider is the viewer's
   (`city-walk.tsx`), not the root layout's: `/impressum` loads 190 kB
   of scripts where it loaded 220 kB. **B4:** `PREPARE_SITES=meissen bun
   dev` prepares that site alone and leaves the others served as built
   last (`scripts/site-choice.ts`): 0.5 s where every site took 10 s
   warm. Not built: a stat fingerprint per site, and starting `next dev`
   before the bakes end.
7. **`create-app.ts` in owners, one worker client (V1, V3, V8) — a first
   cut built (2026-11-11).** **V3:** the ground's, the niches' and the
   BVH's clients stand on one `createWorkerClient` (`worker-client.ts`,
   on `createTaskGate(1)`) with one rule: a handshake before anything is
   handed over (the niches' client copied its first job instead, the
   ground's sent at once), the fallback one job a later task (the
   ground's ran all its queue in one), one restart after a death at work
   (none had one: a dead worker moved its work onto the page for good),
   an aborted job leaving the line at once. The three clients 811 → 501
   lines, the rule 247, eight tests of it on a fake worker; a worker
   that says nothing for 15 s is ended and started once more (a job
   waited on it for ever). **V8:**
   `lazyFeature` is `startOnce`; the `import()` measured again: 1 096.5 kB
   of viewer JS against 1 096.0 static, and the chunk fetched during the
   boot all the same — no gain, so the data layers stay in the scene's
   chunk. **K2** was whole after PR 1; a picture asked for after the
   render stopped now fails at once (it waited for ever).
   **V1, first cut:** the frame is `frameOf` over nine named steps
   (`frame-steps.ts`, the order and its reasons in one list, held by a
   test), and five owners left `bootApp`: `scene-capture.ts`,
   `frame-meter.ts`, `tile-memory.ts` (the governor's late-bound
   `reserveCache` and `forcedStep` gone), `crosshair-focus.ts`,
   `load-veil-follow.ts`. `create-app.ts` 4 796 → 4 437 lines. **Left of
   V1** (each its own PR, each to be walked on a real GPU): the scene
   core, the light (`setSun`, the shadow tiles), the stream's follow-up
   (`onChange`, which still calls its subsystems by name — the
   `sceneChanged` event), the start sequence, the inquiry, the view
   (pose, Modell), the design, the handle. The report's risk stands:
   those share the 60 `let`s that only events remove.
8. **The desktop's post (F8, K5, F11, L6)** — **F8, K5, F11 done**
   (2026-11-11). The desktop's SMAA is `smaa.ts`: the edges in RG8, the
   weights in RGBA8, the blend in the pass that reads it — 6 bytes a
   pixel where three's node held 24 (107 → 27 MiB at 2880 × 1620, one
   full-screen pass less). **K5:** the edges are found on square-rooted
   colours. **F11:** the two tables are worked out
   (`lib/city/smaa-tables.ts`, held to three's pictures by a test); the
   viewer's JS is 1 096.0 → 1 061.3 kB (−34.7). Checked in the container on
   SwiftShader only (the low sun and the night street of `qa/views/`,
   beside three's at 400 %: the same edges); the look on a real GPU and
   on WebGPU is the maintainer's to judge. **Left out:** the lens blur's
   copy of the frame (36 MiB) — under SMAA it is also the motion blur's
   target, and dropping it means a target allocated when a motion
   starts, to be measured on a real GPU in a PR of its own; **L6** (the
   AO's 5 × 5 smoothing made separable) changes the picture and its gain
   is GPU time no container measures.

9. **Follow-ups the maintainer asked for (2026-11-11 evening)**, each a
   draft stacked on the last: **(a) the minimap's picture** — the build
   draws one picture of the site (`minimap.webp`, 640 px wide: land
   cover, bridge decks, buildings as ink) and the minimap shows it as an
   image: Dresden's minimap fetches 87 kB in one request where it
   fetched 2.0 MB of footprints, fifteen class rasters and fifteen
   bridge files, and holds no canvas of them; a tile's footprints come
   only for a demolish or a design's cover (`footprintsIn`,
   `footprintsSettled`). A first cut (a 192² grey figure per tile, drawn
   on a canvas) showed seams at the tile edges and pale buildings. Left:
   the 512² class raster is still published and named on each tile.
   **(b) the bands' rounds
   one facet each** — the plinth's shoulder and the Traufgesims's round
   one face, the Gurtgesims's half-round nose two, their normals bending
   from face to face (`plinths.ts` `bend`): a band 10–12 → 6–8 triangles
   a piece, caps 5 → 3. Dresden 7.05 M → 5.30 M triangles, 41.3 → 37.2 MB;
   the far level 3.68 M → 3.46 M, 35.0 → 33.4 MB; (c) a lighter far level; (d) the
   weld for trees and furniture; (e) the dressing in a worker; (f) the
   rails baked into the ground.

Not planned, for the maintainer: F14 (the re-baked rasters of 16 days
are 633 MB of superseded blobs: squash-merge data PRs, or rewrite the
history once), F15 (Dresden's DGMs are still LZW: 204 MB against about
85), L3, L4, V4, V6, V7, V10, B9–B11, T5–T10 (in the report).

**Checked and sound (not to be audited again):** the object flag bits
and the window style word (below 2^24, two bits free); the half-open
tile ownership; `disposeTile`; the view lens and the reversed depth; no
network in a bake (ADR 0012); the ask token's HMAC; the lazy chunks of
the chat, IFC, Rhino and sql.js.

### 2026-10-10 audit (performance and stability, against `85a41b7`)

Asked by the maintainer: *the load sometimes freezes at 52 %, movement is
jerky, phones crash often, the build takes very long — which sidebar
parameters cost performance and bundle size, which effects have cheaper
alternatives, can the architecture be slimmed?* Six parallel auditors
(`improve`, standard; `improve-codebase-architecture`; the HUD's
parameters; the boot to 52 %; frame time and phone memory; bundle and
build), their top claims re-opened in the code, and a baseline measured
before any change: a cold build of the seven sites 419 s (Dresden's 15
tiles 414 s, serial, on one of four cores) + `next build` 61 s; the
viewer's boot payload 811 KB gz (scene chunk 578 KB, a dead classic
`WebGLRenderer` with every GLSL chunk in it, proj4 in a shared chunk);
headless (SwiftShader, full profile, 400×300) the first frame at 58 s,
*loaded* at 501 s, *Umgebung* done at 456 s — right after the sixth of
eight dressings — and 1.26 GB held on the GPU, 750 MB of it textures.

**The maintainer's decisions:** the soundscape removed; the picture
styles, Modell and the data layers stay but must not weigh on the
initial load ("lazy?"); *Transparenz* and *Blattflimmern* removed;
*Tiefenschärfe* and *Flussnebel* stay but are not parametrisable. The
~20 cosmetic sliders went unanswered at first — they cost the GPU
nothing (a uniform multiplier; baking a constant emits the same
instruction), only code and UI — then the maintainer said to continue
without asking: plan 073 fixed them with its default table, *Nebel*
the one slider left.

**Built on the performance PR (branch `claude/perf-optimizations`):**
plan 068; plan 069 step 5 and the items listed in its row; plan 070
steps 1–3; plan 071's phone half as listed in its row; no tier warms the
picture styles any more (a desktop compiled Papier's programs for every
landing tile, for the session); the four look decisions; the soundscape's
removal (≈ 3 600 lines, its bake and 32 data files); the property tables
read by `gltf-content.ts` (the WebGL renderer gone), the date picker on
demand, proj4 replaced by `lib/city/crs.ts`'s own transverse Mercator —
the boot payload 811 → 657 KB gz; on the build side Shiki loading seven
grammars (the 104 docs pages 13.3 → 6.3 s to render), the spawn tile
parsed once, typed-array plinths, cache keys on the bakes' own packages.

**Vetted, not planned (backlog, S unless noted):**

- ~~**The parse slot waits on the dressing chain**~~ — built (plan 069
  step 4): `handOverWaitMs`, 0 on a phone, 1.5 s on a desktop.
- **Timers starve on a saturated main thread** (plan 069's Findings, M):
  in the local mobile-emulated runs a 1 s `setTimeout` fired up to 206 s
  late, on `main` too — every `withinWait` bound (the 3 s compile wait,
  the hand-over wait), the veil's 600 ms timer and `whenIdle` with it.
  three's compile steps yield through Chromium's native
  `scheduler.yield`, whose continuations run ahead of timers. A bound
  that must hold needs a clock the frames check (`performance.now()`
  against a deadline in the loop), not a timer. Measure on a device
  first: SwiftShader's 1–26 s frames saturate the thread as a phone may
  not.
- **The tiles' CPU arrays are not weighed** (plan 069; S once measured):
  `cpuBytesOf` counts them (`cpuMB` in the trail, `max_cpu_mb` in the
  reports) but neither the tile cache nor the memory governor reads it;
  their lines were derived against three's GPU count. Bring it in once
  the reports show `cpuMB` on the iPhones that die.
- **Shadow-pass pipelines compile in the frame** that first draws a new
  caster (`compileAsync` covers the main pass only) — a hitch per new
  kind of tree, lamp or furniture (M–L, needs a public-API spike).
  *Spiked 2026-10-11: not on public API — left as it is.* three r186
  keeps the shadow pass out of every compile, three ways over: (1)
  `compileAsync` sets `_isPreCompiling`, and `ShadowNode.updateBefore`
  returns on it (ShadowNode.js:796) — no compile draws the map, so
  none makes its render objects; (2) the map is drawn by
  `renderer.render(scene, shadow.camera)` (ShadowNode.js:654) from inside
  the main pass's first lit draw, so at call depth 1, while
  `compileAsync` always takes the depth-0 context (Renderer.js:933 against
  `_renderScene`'s 1733; `RenderContexts.get` keys by depth, the
  context's id is in the material key, RenderObject.js:854, and the node
  build is cached by that key, NodeManager.js:151); (3) each caster's
  shadow nodes come from the private `_getShadowNodes` (Renderer.js:3498)
  and sit on the light's shadow material only around the draw
  (3757–3809) — `compileAsync` only queues there and makes the render
  object after the restore (1061–1068), and node keys go by identity
  (`customCacheKey` is the node's id, Node.js:470–474), so no stand-in can
  match. The public detours — a one-off pass nested at depth 1 into a
  target with the map's attachments, or an override material that
  catches the swap — rest on that undocumented keying and ordering, and a
  real draw builds synchronously anyway (NodeManager.js:198+): they move
  the hitch, they do not take it off the main thread. The way out is
  upstream (three's `compileAsync` building the shadow pass itself).
  Measured headless (`getRenderInfo().framedBuilds`: three's public
  `debug.onNodeBuilderCreated`, counted while a frame draws), over a lite
  boot of Dresden's spawn tile: 16 shadow-pass node builds inside frames,
  all in frames that redrew the shadow map — 1, then 3, then **12 in the
  one frame** where the tile's dressing landed (the frame `ready` flips);
  none in the 51 walking and standing frames after. The other 25
  in-frame builds all fell in the first 34 frames (the post pipelines
  build on their first render; not split further). On WebGL2 (the headless
  backend) a program also links synchronously in the frame, so the count
  transfers, SwiftShader's times do not; on WebGPU the node builds are
  the main-thread half either way.
- ~~**The vegetation LOD runs every frame**~~ — built (2026-10-11): on
  the 10 Hz pose tick, and in the frame the tiles in view or the crown
  switch change or the eye jumps 25 m (`createLodSchedule`, no timer);
  its arrays and plan states kept between passes. A pass over 1 024
  chunks 260 → 40 µs in Bun, and 60 → 10 passes a second at 60 fps
  (SwiftShader's ~1 fps frames are each a tick apart: it shows neither).
- ~~**The crash trail's heartbeat walks the scene**~~ — built
  (2026-10-11): its two walks (`gpu`'s geometry, `cpu`) counted again
  only once what they count changed (`createRecount`); over the streamed
  site (lite, eight dressings, SwiftShader) the walk a beat skips is
  13.7 ms (median of 17 beats, 23 ms the most), what a beat still takes
  0.7 ms, none of the 17 recounted. The write stays: one JSON value
  under one key (nothing to append to), bounded by its rings, 8 KB in
  0.05 ms.
- ~~**The inquiry's ask sets are built eagerly**~~ — built (plan 069
  step 6): in idle time once the dressing hangs; `canopySetsSteps` still places
  every canopy tree a second time there.
- ~~**A desktop at DPR 2 runs SMAA's three full-resolution passes** plus a
  copy of the frame; skipping the copy (SMAA on the scene target, the AO
  multiplied after, as the FXAA path does) saves a full-resolution pass.~~
  Built 2026-10-11 (spiked first): the copy was on both paths — standing,
  the DoF pipeline's quad copied the lens blur's own composite target into
  `BeforeAA`; walking, `lit` was drawn there — and both went without a
  second SMAA and without switching any pass's output target. SMAA's
  input is a texture binding the frame switches (`Antialiasing.read`):
  the composite where the blur leaves it (its passes run for a one-pixel
  draw into a 1×1 target), or the scene target with the contact shadows
  multiplied in after SMAA (walking, as FXAA does). Modell keeps drawing
  into `BeforeAA` first, so its sheets are unchanged; a standing frame is
  pixel for pixel what it was. *Whether a binding switch is the "input
  target switch" this entry ruled out*: it builds nothing — 0 node builds
  inside frames over two walk/stand rounds (51 frames), counted with
  `getRenderInfo().framedBuilds` — and keeps every render context
  (they key by the target drawn into). Passes a frame (`frameCalls`, lite,
  headless): standing 18 → 18, one of them now one pixel; walking 8 → 7;
  Modell 8 → 8, its pipeline warmed into the 1×1 target (entering it
  built nothing in the frame — the pixel's context is `BeforeAA`'s).
  `BeforeAA` (8 B a pixel: 36 MiB at 1920×1080 × 1.5) is held only in
  Modell or a picture style. Fill-rate and memory are not measurable on
  SwiftShader; the saving is one full-resolution read and write a frame.
- ~~**Three real point lights** sit in every lit build even by day~~ —
  built (2026-10-11): a phone builds one (`LAMP_LIGHTS`, a tier constant
  fixed before the first frame), faded through zero where it hands over
  to the next head; the desktop keeps three.
- ~~**A shadow redraw every ~20 m** while walking~~ — built
  (2026-10-11): on foot a 30 m dead zone and a 121 m half-size (was
  19.8 m and 110 m), the walker as far from every edge as before (91 m,
  was 90.2), 17 redraws over a straight 500 m instead of 26, texels 10 %
  coarser; the air and Modell unchanged.
- **The minimap's 512² class raster** has one reader left that paints
  256² a tile (a re-bake and a look).
- **A tile's fine level re-bakes when any tile's terrain inputs change**
  (plan 072's maintenance note, M): its key covers every tile's DGM,
  walls, stairs, terraces and kerbs (ADR 0030), though its walls, kerbs,
  stairs and fences ask only the grounds near them — since plan 072 the
  site ground reads a tile's heights only once a point asks, so the bake
  could record which tiles it read and key on those alone (1–9, not 15).
- **A tile warmer is admitted with Dresden's heaviest tile's peak**
  (plan 072, `TILE_PEAK` 3 GB): on an 8 GB builder two run at once,
  though ten of the fifteen tiles peak under 2 GB. An estimate from the
  tile's CityJSON size (≈ 0.6 GB + 0.17 GB per MB on Dresden's) would
  let three run beside a heavy one — measure it on another city before
  trusting it.

**Measured, not built:** WebKit's missing `scheduler.yield` is shimmed
(`main-yield.ts`) but unmeasured on an iPhone — in Chromium with the API
removed the lite boot was not slower; plan 069 step 2 should time it on
the device.

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
  `bridge-layer.ts` `drawsDeck` averages the ring *with* its closing vertex;
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
  `HORIZON_BANDS`, `LANGS`) and exports referenced by their test only
  (`stripeCoverage`, `buildingFootprints`, `colonyEdgeMetres`/`colonyAxis`)
  — wire in or drop (**dropped**, 2026-10-24, the test audit:
  `stripeCoverage`, `buildingFootprints`, `colonyEdgeMetres`/`colonyAxis`
  (the colony test pins the byte scales against `cultivated.py`), `pannedBy`,
  `projectOntoAxis`, and the CPU copies of shader code — `skyview.ts`'s
  `sunAngles`/`horizonBracket`/`horizonTexel`/`farSunVisibility`/
  `nearBandWeight`/`horizonSunVisibility`/`facadeSkyView`, `windows.ts`'s
  `windowAxes`/`windowRows`: the shader is the only implementation, and a
  CPU copy no caller uses cannot catch a shader regression; moved into
  their tests as oracles: `shadowStreamError`, `insideCutOut`;
  `screenOfPoint` stays, the documented QA projection); three clocks (`performance.now`, `Date.now`, the
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
  unmeasured; profile first. (The calendar: 56 KB, 17 KB gzip; it loads
  with its popover since 2026-10-10.)
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
  `pipeline/pyproject.toml` pinned `pillow==11.3.0` (18 HIGH OSV advisories,
  fixed in 12.x; reached only by offline bakes on self-made rasters —
  done 2026-10-20: Pillow 13.0, pip-audit clean). No
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
  import) — check with a bundle analyser. (It did, ~380 KB of the scene
  chunk; gone 2026-10-10: the viewer reads the property tables itself,
  `app/_components/gltf-content.ts`.)
- **Small robustness:** only `postStack.render` is guarded in the frame
  loop (a throw before it freezes silently while the crash trail writes
  on every error); the stream's `dispose()` during an in-flight compile
  leaves a dressing to attach to a disposed stream (teardown only);
  style-dressing siblings dispose a shared geometry's buffers on every
  tile release (re-uploaded by the next frame — churn, not a bug);
  vegetation LOD re-plans and allocates every frame though only camera
  movement can change it (built 2026-10-11: on the pose tick, see the
  2026-10-10 audit).
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
  (`tile-rasters.ts`); the crown sampler (`loadNdviSampler`) still
  decodes the PNG a second time per tile (S), since plan 077 in the raster
  turn: one decode would keep CPU bytes past the upload or change the
  crowns' colours (its own plan).
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
   ADRs 0037). The OSM-only case outside Germany stays open here; the
   CRS check still accepts only 25832/25833.
2. **Shareable view links (S–M) — built by [plan 048](./048-spike-view-links-and-qa-views.md)
   (2026-11-05) as a `?snap=` query (a fragment first; the maintainer chose the query the same day); what follows is the
   option as first written.** The cheaper path: the boot already restores a Snapshot string
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
   `insertAt`, the disabled `B` key) was removed with ADR 0037; demolish
   stays and now works on every visible tile. Place/move would return as a
   glTF in the scene (or in the tileset); undo for demolish is a stack of
   removed object ids plus the per-tile index rebuild.
5. **A user-facing quality tier (S–M).** The device tier already halves
   shadow texels and rasters on phones; a selectable `medium` tuple (DPR 1,
   2048² shadows, AO/DoF off) for weak desktops needs real-device looks.
   Since 2026-10-06 the safety ladder's levels (ADR 0047) are such tuples:
   a menu would set the level `?safety=N` sets for QA. Since 2026-10-12
   the sidebar's *Erweitert › Qualität* shows the level, what it sets and
   when it falls, and goes back to full detail (`quality-panel.tsx`); what
   is left is choosing a lighter level by hand.
6. ~~**A provenance manifest per tile (S).**~~ Now plan 017 phase A step 3
   (the ingest adapter writes `data/<site>/<tile>.provenance.json` from the
   values its checked downloads already know). `bun run fetch <site>
   [tile]` exists (plan 049), and `data/<site>/provenance.json` is the
   hand-kept per-site version until then. The client side is built: the
   card's provenance manifest, derived from it at build time (plan 052
   phase 2).
7. **Offline repeat visits: a service worker over the tileset (S–M).**
   [ADR 0024](../adr/0024-site-streams-as-3d-tiles.md)
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
   2026-10-03); plan 043 (the city BVH) found on 2026-10-11 that
   Turbopack does bundle a module worker, but that one importing three
   takes three's core out of the scene chunk's scope (ADR 0040: +20.8 KB
   gz on the first load for three's core and three-mesh-bvh) — the cost
   this option meets too, so those findings' options apply here.
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
    ([ADR 0047](../adr/0047-phone-memory-budget-in-true-bytes.md)).
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
- Settle 050/051's "BUILT" rows (a status the vocabulary lacks: DONE or
  PARTIAL with what is open). (2026-10-06; 049 and 055 condensed
  2026-11-04.)
- Run plan 019 on a GPU machine (the 3D Tiles branch is long merged;
  the look of everything since is unjudged on a GPU).
- When GeoSN serves its laser scan again (`lsc_<tile>_laz.zip` answered
  404 on 2026-11-05): `bun run fetch <site> --lsc`, then
  `bun run bake <site> --step lowveg` and `--step small-buildings` for
  Dresden, Leipzig, Meißen and Grimma — the last steps the 2026-11-05
  collected re-bake (plans 022, 040, 045, 081) could not run there; the
  hedge heights read through plan 045's `osm_metres` only then. The
  `facades` and `windows` steps were not re-run either (no code of theirs
  changed; the panorama measurement takes hours a tile). (2026-11-05.)
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
    Snapshot codec (ADR 0018); `fetch-optional.ts`; `shared-rasters.ts`;
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
    feature contract* — checked, sound. (The feature contract holds for
    the GeoJSON in `tileArtifacts`, which `features.test.ts` reads on
    committed data; the JSON files and `dormers_<tile>.geojson` outside
    it were unchecked — plan 081, 2026-11-04.)
  - *Regrouping `app/_components` into folders* — import churn across
    ≈ 110 files for orientation AGENTS.md already gives.
  - *Version lag* — none: three, 3d-tiles-renderer, three-mesh-bvh,
    TypeScript 7, oxlint, mermaid at npm latest; `next` one patch behind.
- **From the 2026-11-04 review (PR #265):**
  - *graphify as a standing tool* (its CLAUDE.md section and PreToolUse
    hook) — ran once, code-only: it sees no edge between the Python bakes
    and their TypeScript readers, the seam this repo most needs checked;
    the container is rebuilt each session; AGENTS.md, head comments, ADRs
    and skills already route an agent. A one-off `graphify extract
    --code-only` into a scratch dir stays fine for a review.
  - *A registry per dressing kind in `buildDressing`* — the cross-kind
    joins (monuments, Mapillary, bridges feeding tram and traffic) belong
    in one orchestrator.
  - *More hooks through `feature-seam.ts`* — one adapter, a hypothetical
    seam.
  - *Splitting `lib/city/features.ts`* — shared type vocabulary, checked
    on committed data by `features.test.ts`.
  - *`city-walk.tsx` ⟷ `bake-stadtwissen.ts`, `ask-scene` ⟷ `ask-voice`
    co-change* — batched review commits, no data path.

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
- **2026-09-23**: plan 018 (tile streaming) and ADR 0024 (proposed) written
  by hand after a Q&A on adding more tiles: Next.js/Bun is not the limit,
  GPU memory, the main thread and the committed source size are.
- **2026-09-24**: after an architecture review aimed at fewer own concepts,
  one branch built the runtime palette (ADR 0010), the site config and plan
  017 phases 1–2 (ADRs 0037) and 3D Tiles via 3DTilesRendererJS with
  glTF + `EXT_mesh_features` content (ADR 0024). That superseded plan 018
  and ADR 0024 and removed plan 016's premise. Plans 019 (GPU
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
- **2026-10-01, plan cleanup** (on the same PR, after merging ADR 0030):
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
  recovery (ADR 0047, backlog item 11), the reports' classification and
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
- **2026-10-10 run** (against `85a41b7`): a performance and stability
  audit on the maintainer's report (a load stuck at 52 %, jerky movement,
  phones crashing, a slow build): `improve` (standard) and
  `improve-codebase-architecture` in parallel with four focused auditors,
  a measured baseline (build timing, chunk sizes, headless boot timelines
  and CPU profiles), and the maintainer's decisions on the features and
  the HUD's settings. Plans 068–074 written; 068, most of 070 and parts of
  069, 071 and 073 built on the same PR; see the "2026-10-10 audit"
  section.
- **2026-11-11 run** (against `f762ce78`): the whole code, on the
  maintainer's ask for correctness, simplicity, speed (app, bake, start)
  and footprint with effort no criterion: eight parallel read-only
  auditors, every finding re-read or re-measured, a measured baseline,
  the report as a document. The maintainer chose all of it as eight
  stacked PRs; see the "2026-11-11 audit" section for each one's state.
