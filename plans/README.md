# Implementation Plans

Two `improve` runs have written plans here. The first (effort `deep`,
2026-09-18, against `8075a21`) produced plans 001–007; all of them are now
**DONE or REJECTED** and merged on `main` (PRs #18, #21, #24, #25). The
second (effort `deep`, 2026-09-20, against `2079c3a` on `main`) audited the
resulting tree across all nine categories with eight parallel auditors,
vetted every finding against the code, and produced plans **008–014**.

Execute in the order below unless dependencies say otherwise. Each executor:
read the plan fully before starting, honor its STOP conditions, and update
your row when done.

**Selection note (2026-09-20).** The run was non-interactive, so plans were
written for the top findings by leverage — seven rather than three to five,
because the first plan (the verification net) is a prerequisite that the
others lean on, and several small findings cluster into one plan each.
Everything else is recorded below as deferred (with why) or rejected so it
is not re-audited next time.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Make the test baseline real — `app/` tests run, e2e waits for frames, `bun run verify` | P1 | S | — | DONE (PR #18) |
| 002 | Remove per-frame waste: terrain BVH at load, on-demand shadow map, half-res transmission, no MSAA backbuffer | P1 | S | 001 | DONE (PR #18; the shadow gate lives on the light, see History) |
| 003 | Derive ink edges from CityJSON rings instead of welding the GPU mesh | P1 | M | 001 | REJECTED — #16 removed ink edges; no target left |
| 004 | Preprocess the DGM into a heightfield at build time | P1 | M | — | DONE (PR #25; primary 1024², neighbours 512², `lib/city/tile.ts` owns the block; the size-only staleness check survives for the *copies* — plan 011 removes it) |
| 005 | Input & collision fixes: stuck keys, diagonal speed, pinch baseline, inserted building, failure-path cleanup | P2 | M | 001 | DONE (PR #25) |
| 006 | Scaffold cleanup, unused deps, lint config, fonts, README + AGENTS.md | P2 | M | — | DONE (PR #25) |
| 007 | Adaptive quality while the camera moves (skip AO + DoF during motion) | P2 | S | 002 | DONE (PR #25; step 4, the pixel-ratio drop, was not attempted — needs a real-GPU look) |
| 008 | Make the verification net catch what it exists to catch — e2e fails without WebGL, per-layer census, fixture-integrity and shader-anchor tests, CI gate, harness opt-in | P1 | M | — | TODO |
| 009 | Re-render the shadow map only when the player has moved a real distance (20 m dead zone; LOD swaps invalidate; `shadowRenders` counter; sun-rig unit test) | P1 | S | 008 (recommended) | TODO |
| 010 | One tile artifact map in `lib/city/tile.ts`, one optional-fetch/abort policy, walls fetched once, neighbours loaded concurrently | P1 | M | 008; after 009 | DONE (loading-performance PR; ran before 008/009 — the layer census that plan 008 adds should still be added) |
| 011 | Six confirmed defects: flight not cancelled by teleport/snapshot/flyTo, keyup swallowed by text fields, size-only copy staleness, minimap re-decode on demolish, null/MultiPolygon rail data, WebGL2 preflight | P2 | M | 008; after 010 | TODO |
| 012 | Drive the 21 look controls from one table (`lib/city/look-controls.ts`), validate the Snapshot contract (`parseSnapshot`), re-seed a fresh handle, share the type with the e2e harness | P2 | L | 008; after 011 | TODO |
| 013 | One type-checker (`tsc`, TS 6), suncalc 2 migration, dependency/pin hygiene, `.mcp.json` pin, agent allowlist + skills-lock prune, delete the redundant bvh shim, `--max-warnings=0`, tsconfig tidy, editorconfig | P2 | M | — (run last of 008–013) | DONE (except `.editorconfig`/`.vscode/extensions.json`, and `allowJs` — `next build` re-adds it; ultracite held at 7.8.3, see below) |
| 014 | Bring AGENTS.md, the city-walker skill, `docs/`, code comments and the OSM attribution back in line with the code | P3 | S–M | after 008–013 | TODO |
| 015 | Progressive first frame: show the primary tile as soon as its terrain + buildings exist, stream the neighbours, vegetation, lamps, rails and walls afterwards behind a non-blocking chip | P1 | L | the loading-performance PR (010, hashed data, baked meshes); 008 recommended | DONE (loading-performance PR; `?scene=lite&block=1` exercises the streaming headless) |
| 016 | Replace `sharp` with `Bun.Image` for the 2048² raster downsample (Bun ≥ 1.4 pin, lockfile v2, pure-JS PNG decoder for the pixel test, sharp out) | P3 | S | #28 + #29 merged; **Step 0**: the Vercel build must run Bun 1.4 | TODO — gated on Step 0; measured +24 % RGB / +21 % class file size, pixels equivalent |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale).

## Dependency notes

- **008 first.** It is the net every other plan is verified against: the e2e
  suite currently *skips* when WebGL is missing and asserts nothing about
  the vegetation, lamp, rail, wall or water layers; 009–012 each add or
  change scene behaviour that only 008's layer census and shader-anchor
  tests can catch.
- **009, 010, 011 and 012 all edit `create-app.ts`** (009 the render loop,
  010 the load path, 011 the camera/keyboard/footprints, 012 the interface
  header) and 011/012 both edit `city-walk.tsx`. Run them sequentially in
  that order, not in parallel worktrees. Each plan's drift check names the
  expected overlap.
- 010's `CityWalkOptions.primary: TileSrc` shrinks the HUD effect's
  dependency array; 012 builds on that.
- 011's rail `MultiPolygon` fix is checked by 008's fixture test (which
  already accepts both geometry types) and 008's layer census.
- 013 rewrites `bun.lock`; running it last keeps the other plans'
  `--frozen-lockfile` installs untouched while they are in flight. Its
  `tsc` switch changes what `bun typecheck` means — the other plans'
  verification commands work under either compiler.
- 014 documents the post-008–013 state (the `shots` script, the dead zone,
  the artifact map, the typecheck command) and locates every edit by text so
  earlier line moves do not break it.

## Verification baseline (recon)

CI (`.github/workflows/ci.yml`: lint, typecheck, unit, build + e2e) is
**green on `main` at `2079c3a`** (run #55, 2026-09-19). Commands:
`bun lint`, `bun typecheck`, `bun test` (= `bun test ./lib ./app`),
`bun run verify`, `bun run build`, `bun run test:e2e`. The audit ran nothing
locally (`node_modules` absent; the skill forbids installs); every claim
below was verified by reading the code at `2079c3a`, plus read-only registry
lookups for dependency facts (dated 2026-09-20). GPU-side costs are reasoned
from the three.js r186 source and the committed data sizes, not measured.

## Findings (vetted), ordered by leverage

Impact ÷ effort, discounted by confidence and fix risk. Numbering continues
from the previous run (1–30). Line numbers are against `2079c3a`.

| # | Finding | Category | Impact | Effort | Risk | Evidence | Plan |
|---|---------|----------|--------|--------|------|----------|------|
| 31 | The 3072² shadow map is re-rendered on essentially every moving frame: the follow logic re-centres the frustum whenever the texel-snapped centre (0.072 m texels) changes, and walking moves 0.15 m/frame. The full depth pass (four merged city meshes, every tree chunk in the frustum, lamps, walls, bridges) runs while the motion regression is trying to shed cost. A 20 m dead zone cuts it ~100×. | perf | HIGH | S | MED | `sun-rig.ts:90, 138-163`; `create-app.ts:1196`; `fps-movement.ts:6-8` | 009 |
| 32 | The e2e suite passes with nothing rendered: WebGL absence *skips* every render test; the "renders" test asserts data counts and `shadowsEnabled`, a flag set unconditionally at boot; no test checks that vegetation/lamps/rail/walls/water exist (all loaders swallow failures into an empty group); demolish is judged by the filtered document, not the mesh; `afterAll` never checks errors. | tests | HIGH | S | LOW | `e2e/city-walk.spec.ts:164-179, 194-198, 324-328, 181-183`; `create-app.ts:316, 985` | 008 |
| 33 | Deferred #21, still fully true: 21 look sliders are wired by hand in six places (handle interface + forwarder, `PocDebugInfo`, 21 `useState`s, 21 JSX blocks, `Snapshot.look` + copy/apply, the `__poc` registration list, and the e2e harness's own copy of the type and apply loop). 39 `useState` and a 62-prop controls component; 35 of 96 commits touch the three core files together. | tech-debt | HIGH | L | MED | `create-app.ts:186-287`; `poc-debug.ts:19-118`; `city-walk.tsx:470-534, 660-898, 1009-1082, 1158-1204, 1254-1360`; `e2e/snapshot-shot.spec.ts:23-60, 85-156` | 012 |
| 34 | `lib/city/tile.ts` ("the one place a tile id is written") names 3 of 15 artifacts; the rest are template literals in `city-walk-client.tsx` and again in `prepare-data.ts`, and four are derived at runtime by string replacement (`landcover_`→`walls_` twice, `vegrows_`→`canopy_`/`ndvi_`, `lod2_`→`roofcolor_`). The wall file is fetched and parsed twice per tile. A typo degrades silently to "feature off". | tech-debt | HIGH | S | LOW | `tile.ts:41-52`; `city-walk-client.tsx:24-38`; `prepare-data.ts:42-69`; `create-app.ts:372-374, 557-559, 576-579, 699-704`; `terrain-layer.ts:107-115` | 010 |
| 35 | Boot awaits ~34 dependent round trips serially (primary CityJSON, then roof LUT, then terrain → vegetation → lamps, then each neighbour in a `for` loop): no network/CPU overlap for ~21 MB gzipped over four tiles. | perf | HIGH | S–M | LOW | `create-app.ts:505-512, 550-603, 619-633` | 010 |
| 36 | Three abort policies across the optional loaders: `fetchFeatures` and `loadWallLines` swallow `AbortError` and return `[]`, so after a StrictMode remount the doomed instance keeps building rail/wall/lamp geometry from partial data until the next `ensureAlive()`; `fetchRoofLut` and `loadNdviSampler` rethrow correctly. `fetchFeatures` is exported from `vegetation-layer.ts` and imported by three unrelated layers. | bug / tech-debt | MED | S | LOW | `vegetation-layer.ts:753-767`; `terrain-layer.ts:168-189`; `rail-layer.ts:13`; `wall-layer.ts:11`; `lamp-layer.ts:21` | 010 |
| 37 | A scenic flight (1.4–3.8 s) owns the camera every frame; `teleportTo`, `applyCameraState` and the QA hook's `flyTo` set a pose but never `cancelFlight()`, so a minimap click, a double-tap travel or a Snapshot "Apply" during a glide is overwritten on the next frame and `pendingMode` then overrides the requested mode. | bug | MED | S | LOW | `create-app.ts:1134-1143, 906-945, 1311-1318, 874-877` | 011 |
| 38 | A pasted Snapshot is applied after checking only `camera.pos.x`: a trimmed or hand-edited snapshot (the documented QA workflow) yields a NaN camera (`headingDeg * DEG2RAD` → `lookAt(NaN)`), NaN fog/DoF, `undefined` slider values and `mode` outside the enum — and reports "Snapshot applied". Local-only (no persistence, no URL), so a support cost, not a security issue. | bug | MED | S | LOW | `city-walk.tsx:1362-1398, 1346-1360`; `create-app.ts:909-919`; `e2e/snapshot-shot.spec.ts:85-97` | 012 |
| 39 | The crown LOD swap (`updateLod` flips `.visible` on shadow-casting meshes every frame) and the Multi-Tuft toggle never call `invalidateShadows()`; with a stationary camera the old crowns' shadows persist until the camera moves — the every-frame re-render (#31) is what hid it. | bug | MED | S | LOW | `vegetation-layer.ts:876-878, 888-899, 645-651`; `create-app.ts:1283-1287, 784-793` | 009 |
| 40 | `onKeyUp` skips `movement.release` when the event targets a text field, but the press landed on the canvas: hold `W`, click into the Snapshot textarea, release → the camera walks until the window blurs. Same class as fixed #7, different path. | bug | MED | S | LOW | `create-app.ts:1063-1067` | 011 |
| 41 | `prepare-data.ts` treats a copy as up to date when byte sizes are equal: a re-baked artifact of the same length is never copied into `public/data/`; the mtime helper exists 90 lines lower and is used only for the heightfields. The 004 status row says the size-only check is gone. | bug / dx | MED | S | LOW | `prepare-data.ts:78-79, 107-108, 170-179` | 011 |
| 42 | Every demolish (and every sidebar resize) makes the minimap decode and recolour all four 4096² land-cover PNGs again and blanks the map until they arrive, because the static-layer effect depends on `footprints`; `getFootprints` also recomputes polygons for all four tiles although only the primary changes. | bug / perf | MED | S | LOW | `minimap.tsx:150-194`; `city-walk.tsx:1120-1129`; `create-app.ts:1343-1346` | 011 |
| 43 | The rail loader reads `properties.deck/kind/structure/tracks` unguarded (GeoJSON allows `null`) and skips any non-`Polygon` ballast: `railarea_33410_5658_2_sn.geojson` holds 2 `MultiPolygon` + 1 `Polygon`, so two of three yard surfaces on that tile are silently missing today. | bug | MED | S | LOW | `rail-layer.ts:38-60, 579-601, 806-827, 840`; `data/dlm/railarea_33410_5658_2_sn.geojson` | 011 (loader) + 008 (fixture test) |
| 44 | No test reads the committed `data/**`: a renamed property or a wrong geometry type in a bake passes lint/typecheck/unit/e2e (layers are non-fatal). #43 is the proof. | tests | MED | S | LOW | `prepare-data.ts:57-69, 88-106`; loader types in `rail-layer.ts:38-60`, `wall-layer.ts:24-27`, `lamp-layer.ts:43-46`, `vegetation-layer.ts:105-113` | 008 |
| 45 | Every `onBeforeCompile` patch is a string `.replace` against three chunk names (`<common>`, `<begin_vertex>`, `<map_fragment>`, `<fog_fragment>`, the literal `vec4 diffuseColor = …`, …) that nothing pins; `injectHeightFog` prepends declarations unconditionally, so a renamed chunk switches height fog / meadow NDVI / rim light off with green CI. Dependabot bumps the three group weekly. | tests | MED | S | LOW | `visual-style.ts:108-187`; `terrain-layer.ts:320-377`; `water-layer.ts:224-294`; `height-fog.ts:78-92`; `vegetation-layer.ts:385, 557, 673` | 008 |
| 46 | The CI e2e scope gate skips the suite for PRs that touch only `scripts/`, `data/`, `patches/`, `tsconfig.json` or `postcss.config.mjs` — the data path the viewer specs exist to protect. | dx | MED | S | LOW | `ci.yml:96-99` | 008 |
| 47 | The `--headed` snapshot harness is picked up by plain `bun run test:e2e` whenever `shots/*.json` exist: it re-renders each at the full profile headless and overwrites the real-GPU plates. | dx | MED | S | LOW | `playwright.config.ts:31`; `e2e/snapshot-shot.spec.ts:62-74, 187` | 008 |
| 48 | No screenshot or trace on a first-attempt failure (`trace: "on-first-retry"`, `retries: 0` locally): a failing WebGL test leaves nothing to look at. | dx | LOW–MED | S | LOW | `playwright.config.ts:34, 54-57`; `ci.yml:152-158` | 008 |
| 49 | Three type-checkers: `bun typecheck` runs a frozen July daily build of the TS 7 preview (last publish 2026-07-07; TS 7.0.2 GA the next day), `next build` type-checks with TS 6.0.3, ESLint uses TS 6 via typescript-eslint (peer `<6.1`). A green `verify` does not predict a green build. | migration / dx | MED | S | LOW–MED | `package.json:34, 40, 49`; `ci.yml:41, 122`; registry (2026-09-20) | 013 |
| 50 | Dependabot's five-PR npm budget is fully occupied by superseded PRs (#15 next 16.3.3 vs. manifest 16.3.5; #13 recharts, removed; #12 three, already latest; #3 lint group since June) plus #26; Biome 2.5.0→2.5.14, ultracite 7.8.3→7.12.0, ESLint 9.39.5 and `@types/node` cannot move. | deps | MED | S | LOW | `.github/dependabot.yml:10`; GitHub PRs #3, #12, #13, #15, #26 | 013 (+ maintainer closes the PRs) |
| 51 | suncalc 2.0 (Dependabot #26) changes units to degrees, the azimuth origin to north-based and the export shape to named ESM exports; `lib/city/sun.ts` encodes the 1.9 conventions and the test calls `.getTime()` on now-nullable times. A mechanical import fix would ship a sun rotated 180° (the noon test would catch it). | deps | MED | S | LOW | `lib/city/sun.ts:1, 27-33`; `sun.test.ts:2, 61-66`; registry `suncalc@2.0.2` | 013 |
| 52 | `@types/proj4` is a deprecated stub (proj4 ships types); `geotiff` sits in runtime `dependencies` for a build-only script; `postprocessing`/`n8ao`/`three-mesh-bvh` are caret where AGENTS.md says exact; `packageManager` bun 1.3.11 vs. `@types/bun` 1.4.2. | deps | LOW–MED | S | LOW | `package.json:9, 11, 13, 21, 28, 30, 58`; `AGENTS.md:191-193` | 013 |
| 53 | `.mcp.json` launches `next-devtools-mcp@latest` via `npx -y` on every session — unpinned, outside the lockfile, `bun audit` and Dependabot, against the repo's own pinning convention; Node is an undocumented prerequisite for it. | security / dx | LOW–MED | S | LOW | `.mcp.json:5`; `AGENTS.md:193-196`; `README.md:11-14` | 013 |
| 54 | The committed `.claude/settings.json` allowlist pre-approves `node -e ' *` and `python3 -` (arbitrary interpreter execution) and five `node shoot.mjs …` commands for a file that no longer exists; `skills-lock.json` locks two skills that are not installed. | security / dx | LOW–MED | S | LOW | `.claude/settings.json:8, 11-16`; `skills-lock.json:16-27` | 013 |
| 55 | `types/three-mesh-bvh.d.ts` duplicates (with a looser signature) the `module 'three'` augmentation that `three-mesh-bvh@0.9.15` ships in `src/index.d.ts:326-341`; `skipLibCheck` hides the disagreement. | tech-debt | LOW | S | LOW | `types/three-mesh-bvh.d.ts`; registry `three-mesh-bvh@0.9.15` | 013 |
| 56 | ESLint warnings never fail `bun lint` (no `--max-warnings=0`); `eslint-config-next` registers most of its rules at `warn`. | dx | LOW–MED | S | LOW–MED | `package.json:48`; `ci.yml:29` | 013 |
| 57 | No WebGL2 preflight: a user without WebGL2 sees three's raw "Error creating WebGL context" under the failure Alert instead of the one prerequisite the README states. | dx | LOW–MED | S | LOW | `create-app.ts:302-305`; `city-walk.tsx:1207-1217, 1489-1496` | 011 |
| 58 | ODbL attribution covers lamps only; walls (292 features on the primary tile), station platforms and `bridge:structure` arches are OSM-derived and uncredited; the bake header's promise that the GeoJSON carries the credit is unkept (0 matches). | docs (licence) | MED | S | LOW | `city-walk.tsx:1583`; `README.md:65-69`; `extract-lamps.sh:7-8`; `data/dlm/{lamps,walls,platform}_*.geojson` | 014 |
| 59 | AGENTS.md says raw DGM rasters must not be committed; six DGM1 GeoTIFFs (82 MB, two of them for tiles nothing loads) are committed and `prepare-data.ts` fails without them. A contributor following the doc breaks `bun dev`. | docs | MED | S | LOW | `AGENTS.md:89-91`; `SKILL.md:189-190`; `git ls-files data/dgm`; `prepare-data.ts:194-204`; `lib/city/tile.ts:12-19` | 014 (doc); deleting the two unused tiles is a maintainer call |
| 60 | The city-walker skill describes tree LOD as planned (shipped), the cheap crown as detail 1 (code: detail 2 — decision drift, see #66), a lite-profile transmission knob (removed) and a Snapshot `style` key (never read); AGENTS.md's file map omits 15 of 32 viewer modules and 5 of 7 bake scripts; `sun-rig.ts` comments describe 2048², a whole-scene frustum and VSM; `create-app.ts` still mentions the ghost style and "three 0.184"; three bake headers are stale. | docs | MED | S | LOW | `SKILL.md:107-109, 118-128, 163, 170-176, 196-204`; `AGENTS.md:42, 48-59, 166-167`; `sun-rig.ts:43-46, 70-73, 117`; `create-app.ts:249, 317`; `extract-canopy.sh:7, 12`; `extract-roof-colour.sh:5-7`; `extract-ndvi.sh:8` | 014 |
| 61 | The portability checklist names the wrong file for the tile list, lists 4 of 7 bakes, tags roof colour experimental (it is active) and omits the Geofabrik `.osm.pbf` the wall bake needs. | docs | MED | S | LOW | `docs/portability.md:44-52, 66-72`; `extract-walls.sh:14-18` | 014 (010 fixes the tile-list line) |
| 62 | Ledger/data-flow drift: planned #8 is half shipped; five shipped atmosphere transforms (height fog, mist, clouds, golden/blue hour, meadow mottle) have no entry; the minimap's DLM background and CityJSON footprints are missing from the diagram. | docs | LOW–MED | S | LOW | `docs/transformations.md:213-214`; `docs/data-flow.md:95, 115`; `plans/aesthetic-and-visual-fine-tuning.md:8-15` | 014 |
| 63 | The sun rig's on-demand gate — the project's highest-value perf decision and its documented "stale, never a crash" failure mode — has no unit test although everything it constructs works under bun. | tests | MED | S | LOW | `sun-rig.ts:102-103, 138-163, 207-209` | 009 |
| 64 | The "`lib/city` is three-free" rule is enforced by nobody; coverage is never observed (`test:coverage` exists, no CI use, no `bunfig.toml`). | tests / dx | LOW–MED | S | LOW | `package.json:52-54`; `ci.yml:53`; `AGENTS.md:52` | 008 (purity guard + coverage artifact; no threshold) |
| 65 | HUD look state is not re-applied to a freshly created handle (only the sun is seeded); latent while the effect runs once per mount, wrong the moment a tile switcher or model URL changes a prop. | tech-debt | LOW | S | LOW | `city-walk.tsx:1147-1206, 1225-1237` | 012 |
| 66 | Decision drift on the crown: the code quadrupled the "cheap" crown to a detail-2 icosphere (320 tris ×42k trees, paid in the main and every shadow pass) against the skill's recorded decision, and there is no far tier — a tree 2 km away draws 404 triangles. | perf / docs | MED | S–M | LOW–MED | `vegetation-layer.ts:247-258, 304-365, 75-76`; `SKILL.md:107-109` | 014 documents the drift; the far tier is deferred (needs a real-GPU look) |
| 67 | The primary tile's sources are spelled four times (`TileSrc`, `CityWalkOptions`, the HUD `Props`, the client's ten JSX props) and re-folded three times inside `bootApp`. | tech-debt | LOW–MED | S | LOW | `create-app.ts:129-184, 606-612, 661-669`; `city-walk.tsx:123-146`; `city-walk-client.tsx:47-61` | 010 (`CityWalkOptions.primary: TileSrc`) |

## Direction — options for the maintainer (not ranked against the bugs)

Grounded in repo evidence; each is a choice, not a defect. The previous run's
four options (placement tool, inspect/undo, URL state, neighbour tiles) were
re-checked; the ones still open are folded in below with fresh evidence.

1. **Make portability real: a second, OSM-only location (spike M, build L).**
   `docs/portability.md` promises "any city, village, or area" with OSM
   footprint extrusion, a flat-plane terrain and OSM landuse fallbacks; the
   code has none of them (`grep -rniE "building:levels|extrud|flat plane|landuse" app lib` → 0),
   `prepare-data.ts` exits without CityJSON/DLM/DGM per tile, and
   `fetchCityJson` rejects any CRS but 25832/25833. Pick one non-Saxon 2 km
   tile, run the pipeline with OSM + a public DEM, write down what breaks;
   then decide bake-side extrusion (runtime untouched, flat boxes the clay
   detailing cannot dress) vs. runtime fallbacks (touches every layer).
2. **Shareable view links (S–M).** The Snapshot serializer/parser exist and
   are versioned (`city-walk.tsx:170`, and `lib/city/snapshot.ts` after plan
   012); the only URL read anywhere is `?scene=` (`scene-profile.ts:22-24`).
   A `?snap=<base64>` read once after `ready` and written on Copy turns
   "this corner at 08:00 on 21 December" into a link and collapses the shot
   harness to `page.goto(url)`. Trade-off: URL length (~600 chars with every
   slider) vs. camera+date only; throttle `replaceState` on drags.
3. **Guided tour / attract mode and a day-cycle play button (S–M).**
   Five authored viewpoints (`viewpoints.ts`), an arc tween with duration
   clamps (`camera-flight.ts`), and cancel-on-input already exist
   (`create-app.ts:1050-1052, 1338-1340`); nothing chains them or animates
   `setSun`. Caveat: a moving sun forces a shadow re-render per step, so
   step the sun at a few Hz, not per frame (plan 009's counter shows it).
4. **Finish the editing pair (M).** `insertedModelUrl`/`insertAt` are
   plumbed through three layers with no caller (`city-walk-client.tsx:47-61`);
   plan 005 removed the previous blocker (the inserted object is now
   collidable and focusable). Place/move/delete via the existing double-tap
   terrain raycast; undo for demolish is a stack of removed CityObjects plus
   a re-parse (`filterCityObject` never mutates).
5. **A user-facing quality tier so touch devices are playable (S–M).**
   `scene-profile.ts` already parses `?scene=`; the coarse-pointer path
   changes only HUD chrome while a phone pays DPR 2 × 3072² shadows × AO ×
   DoF. A `medium` tuple (DPR 1, 2048² shadows, AO/DoF off, neighbours on)
   defaulted on coarse pointers is the deferred #22 as product. Needs
   real-device looks; CI cannot judge it.
6. **Productize the bake and write the provenance manifest (S–M).** Seven
   `extract-*.sh` scripts with an implicit order only the docs know
   (inconsistently); the README's `TODO(maintainer)` on dataset editions and
   licences is still open although `data/dgm/*_akt.csv` and the roof-colour
   `meta` blocks already hold most of the inputs. `bun run bake <tile>` that
   runs the scripts in order, skips absent inputs and writes
   `data/<tile>.provenance.json` (dataset, edition, download date, licence,
   attribution) — which the HUD footer could then read (see #58).

## Deferred findings (real, not planned this run — with why)

- **Water and mist sheets draw the entire terrain geometry** (`terrain-layer.ts:472-474`;
  `water-layer.ts:139, 303, 311`): ≈7.3 M of the ≈10.9 M terrain-derived
  triangles per frame belong to transparent sheets that `discard` on ~95 % of
  each tile. Fix = a water-only index buffer over the shared positions from a
  baked coarse water mask. M effort, needs a bake change and a real-GPU look
  — next perf item after 009/010.
- **Far crown LOD tier / detail-2 decision drift** (#66): a third
  `InstancedMesh` per cell (detail 1 or 0, trunk hidden) beyond ~500 m. The
  swap mechanism exists; the look must be judged with the `--headed` harness.
- **Terrain BVH → heightfield ray-march** (`create-app.ts:749-756`): the
  synchronous `computeBoundsTree()` over ≈3.6 M terrain triangles at boot
  (≈1–1.5 s) serves two rays per second that a bilinear march answers in
  microseconds. M; pure `lib/city/heightfield-ray.ts` + tests.
- **Stream the three neighbours after the first frame** (`create-app.ts:496-503, 619-633`):
  ≈⅓ of the boot CPU and ≈7 MB gz before first paint. M–L; needs a
  "primary ready" vs "block ready" split of `__poc.ready` and dynamic
  minimap bounds/focus targets. Plan 010's parallel fetch gets the cheaper
  half of the win first.
- **First-frame decode/compile** (`terrain-layer.ts:73-140`; no `compileAsync`):
  eight 4096² `<img>` decodes plus every program compile land in the first
  visible frame. S (`ImageBitmapLoader` + `renderer.compileAsync` under the
  overlay); needs a GPU to judge.
- **Splat VRAM (~620 MB) and neighbour tiles at 4096²** (`terrain-layer.ts:73-105`):
  bake 2048² neighbour variants, upload the class raster as `RedFormat`.
  S–M; bake + GPU look.
- **Bundle: `GLTFLoader` and `proj4` for paths that never run**
  (`inserted-building.ts:8`; `lib/city/crs.ts:1, 48`): dynamic-import the
  loader behind `modelUrl`; a 40-line UTM inverse for zones 32/33 replaces
  proj4. S; bundle sizes unmeasured (`next build` unavailable here).
- **Split the 900-line `bootApp`** (`create-app.ts:465-1365`, ~24
  responsibilities, highest churn in the repo) into `tile-loader.ts`,
  `camera-state.ts` (also de-duplicates the heading/pitch→direction math
  that `camera-flight.ts:75-87` re-implements), `keyboard-controls.ts`,
  `focus-controller.ts`. L; plans 010–012 extract pieces and make it smaller.
- **`lib/city/math.ts` and one `densify`**: `clamp` is re-implemented 36×
  in 17 files, smoothstep 3×, `DEG2RAD` 2×; four polyline resamplers with
  divergent carry semantics (`rail-layer.ts:377`, `wall-layer.ts:62`,
  `terrain-conflate.ts:70`, `vegetation-layer.ts:139`); `terrain-conflate.ts:90-124`
  forks `sampleHeightfield`. S–M; unifying `densify` changes geometry
  slightly and needs a shot comparison.
- **`LayerControl` base + clamp at the handle boundary**: six control shapes,
  three hand-rolled dispose traversals, 15 unclamped 0..1 setters. S; plan
  012 clamps the HUD path; the handle path is a one-liner per setter.
- **`cityjson-threejs-loader` vendoring** (`patches/cityjson-threejs-loader@0.4.0.patch`,
  13 hunks; upstream unpublished since 2023-07, last commit 2025-07,
  `main` still writes the removed `tex.encoding`). Correction to the previous
  run's premise: the package **is typed** — it has no `types` field but ships
  `src/index.d.ts` beside `main`, which `moduleResolution: bundler` resolves;
  the duck types in `city-layer.ts:32-35`, `visual-style.ts:262-264`,
  `collision.ts:25` are unnecessary or the 2023 `.d.ts` is stale. Vendor
  (M) at the latest when the next three bump breaks the loader.
- **Materials whose GLSL depends on `heightFog` but whose cache key does
  not** (`vegetation-layer.ts:509-511, 572-574`; `visual-style.ts:188-190`):
  latent while every caller passes `heightFog`; one `customProgramCacheKey`
  each, as terrain/water already do. S.
- **Pure-helper tests**: rail geometry (`pushTri`, `densify`, `deckLift`,
  `addArches`, `buildRails` — none of which run in CI because the lite
  primary tile has no rail lines and the only arch bridge is on a
  neighbour), the wall collider under the −90° world rotation, camera-pose
  round trips, vegetation (`sampleLine`, `bucketByCell`, `crownColor`,
  `updateLod`), lamps (`nearestThree`), walls (`columnAt`), `prepare-data`'s
  staleness/bounds helpers, and the NaN/`nodata: null` path the terrain tests
  never exercise (they still use the retired `-9999` sentinel). Plan 008
  builds the net; fill these in when each module is next touched.
- **`dispose()` leaves textures, the shadow map and the GL context to the
  GC** (`three-utils.ts:22-31`; no `TerrainLayer.dispose`; no `sun.dispose()`
  or `forceContextLoss()`). Bounded today (only dev/CI unmount). S.
- **Low-confidence items** (investigate, not fix): NoData smearing in the
  bilinear bake before the sentinel compare (`prepare-data.ts:230-236` vs.
  `heightfield.ts:94`); `worldBounds.min.y` (includes the 30 m skirt) as the
  ground fallback; the minimap assumes square bounds; the joystick releases
  on any `pointerup`; `#27` (`crs.ts:22` trailing-slash regex) — all latent
  on the shipped data.
- **Maintainer actions**: close Dependabot #3/#12/#13/#15 (superseded) and
  #26 (plan 013 migrated suncalc); decide ESLint 10 vs. dropping ESLint
  (loses the React-Compiler-aware hooks rules); delete or `_raw/` the two
  unused `33414_*` DGM tiles (~28 MB); move or delete `aesthetic-sandbox.html`.
- **Deliberately held back (re-checked 2026-09-21, registry)**:
  - `ultracite` 7.8.3 → 7.12.0. The preset turns on ~10 new rule families:
    **451** violations, of which `assist/source/useSortedKeys` 249,
    `style/noIncrementDecrement` 94, `performance/noJsxPropsBind` 43,
    `style/useDestructuring` 21, `suspicious/noUnnecessaryConditions` 15,
    `noShadow`/`noLeakedRender` 9 each. Biome 2.5.14 **on its own** is clean
    (verified), so this is a style-refactor decision, not a dependency bump —
    and `noIncrementDecrement` alone rewrites the renderer's hot loops.
  - `eslint` 10. `eslint-plugin-react` (`^9.7`), `eslint-plugin-import` (`^9`)
    and `eslint-plugin-jsx-a11y` (`^9`) — all via `eslint-config-next` — still
    cap their peer at 9. `typescript-eslint` 8.70 *does* accept `^10` now, so
    the block is down to those three plugins.
  - `typescript` 7.0.2. `typescript-eslint` 8.70 peers `typescript <6.1.0`.
    (`^6.0.3` is safe to leave: 6.0.3 is the last 6.x, so it cannot float.)
  - `n8ao` 1.10.3 → 2.0.1. Ships no types (`types/n8ao.d.ts` would need
    rewriting) and changes SSAO output; per AGENTS.md, a visual change needs
    the `--headed` snapshot harness on a real GPU, which headless CI cannot do.
  - `bun` 1.3.11 → 1.4.2 in `packageManager` (and the `@types/bun` skew it
    would fix): needs a machine running 1.4.2 to regenerate and validate the
    lockfile.
  - `postprocessing` 7.x is alpha/beta only.

## Findings considered and rejected

### Rejected in the 2026-09-20 run

- **A `tsconfig.node.json` / project-references split (deferred #26)** —
  tests are colocated with browser code and need `bun:test` types, the e2e
  specs need the app's `Window` augmentation, and no file uses a `Bun`
  global; M effort for a hazard nothing trips. Plan 013 tidies `target` and
  `allowJs` instead.
- **`cacheComponents: true` as dead config** — it is a valid top-level
  Next 16 option (the deprecated one is `experimental.cacheComponents`);
  harmless on this one-route app. Leave it.
- **Bake-script tile-id validation** — `$1` enters bash arithmetic unvalidated,
  but the sole caller is the maintainer's own shell; all seven scripts use
  `set -euo pipefail`, `mktemp`/`trap`, quoted expansions and heredoc
  Python. A regex guard is a nicety, not a plan.
- **Dev-tree `bun audit` advisories** (19 high, all in eslint/ultracite/shadcn
  CLI transitive trees, none reachable from the shipped bundle) — routine
  Dependabot merges once plan 013 frees the queue.
- **`console.*` policy, prompt-injection scan of vendored skills, secrets in
  tree/history, client-side sinks, CI token exposure** — all checked, all
  clean (see "What was not audited" for the limits).
- **CI dependency caching, dropping ESLint, CSP headers, SHA-pinned actions,
  `.env.example`, CONTRIBUTING, `docs/architecture.md`, render-on-demand,
  react-three-fiber, `date-fns`→`Intl`, terrain `castShadow`, BatchedMesh** —
  rejected in the previous run; nothing new changes those verdicts.

### Rejected in the 2026-09-18 run (kept so nobody re-audits them)

- "Walk-mode collider can lock the player inside a building" — all city
  materials are `FrontSide`; the ray never hits back faces; not a bug.
- CI dependency caching / build-cache key — 2m38s wall, installs 3–9 s; not
  worth a plan.
- Drop ESLint (keep Biome only) — a maintainer judgment; recorded, not planned.
- CSP / security headers — no auth, cookies, user content or backend.
- Verify `skills-lock.json` in CI, SHA-pin GitHub Actions, hooks running
  `bun fix` — low value for a solo POC.
- Replace `date-fns` with `Intl` — `react-day-picker` depends on it.
- Render-on-demand loop — continuous input needs continuous frames; would
  break `waitForFrames`; motion-keyed *quality* reduction (007) is the
  version that pays.
- Migrating the viewer to react-three-fiber — frame-for-frame identical
  loop, every `onBeforeCompile` becomes an escape hatch, the `__poc` handle
  would be rebuilt on a store; static-after-load scene is r3f's weakest case.
- `docs/architecture.md`, pre-push hook, `.env.example`, CONTRIBUTING,
  `next.config.ts` `/city` redirect, `terrain.mesh.castShadow = false`,
  characterisation tests for `create-app.ts`/`city-walk.tsx`, demolish as
  data-level re-parse, synchronous CityJSON parser, fly mode without
  collision, global three-mesh-bvh prototype patching — documented decisions
  or not worth doing.

## What was not audited

- Internals of `components/ui/**` (vendored shadcn) and `.agents/skills/**`
  (vendored skills; scanned for prompt-injection content only — none found,
  unchanged since `8075a21`).
- `data/**` beyond file names, sizes, feature counts, geometry types and
  property *keys* (no values were read; the CityJSON attribute keys are the
  public LoD2/ALKIS set, no address/owner fields).
- Anything executed: `node_modules` was absent and the skill forbids
  installs, so `bun run verify`, `bun run build`, the e2e suite and
  `next build`'s bundle composition were not run; CI's green run #55 is the
  baseline. Registry facts are as of 2026-09-20.
- Real-GPU behaviour: every shader, shadow and fill-rate statement is
  reasoned from the three.js r186 source and the committed data sizes.
- The production deploy environment (no deploy workflow in the repo), so
  the absence of `NEXT_PUBLIC_POC_DEBUG` in the shipped build is inferred
  from `poc-debug.ts:126-128`, not observed.
- GitHub's archived flag for `cityjson-threejs-loader` and the skills'
  source repositories (API blocked in the audit environment; upstream
  history was read via `git clone`).

## History

- **2026-09-18 run** (against `8075a21`): plans 001–006 from the audit, 007
  from a separate react-three-fiber feasibility check (rejected; the r3f
  verdict is in the rejected list above). PR #16 (the aesthetic branch) was
  merged *into* the plan tree, which tripped every drift check; 001 and 002
  were ported onto it (the shadow gate moved from the renderer to the light —
  `sun.shadow.autoUpdate` in `sun-rig.ts` — because the rig re-renders the
  map from inside the loop, and `invalidateShadows()` became the single entry
  point). 003 lost its target when #16 removed ink edges. 004–007 were
  executed in PR #25 with the deviations recorded in their status rows.
- **2026-09-20 run** (against `2079c3a`, this file): all of 001–007 verified
  closed on `main`; findings 31–67 above; plans 008–014.
- **2026-09-21** (against `e1c00c9`, PR #29): plan 016 written by hand after the
  `/code-review` of the 2048² raster change found sharp's alpha premultiply
  painting the ground black (fixed in #29). Bun 1.4's `Bun.Image` was measured
  against sharp on the real rasters before planning; the plan is gated on the
  Vercel build container running Bun 1.4.
