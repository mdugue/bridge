# Plan 014: Bring the knowledge base, the skill and the code comments back in line with the code

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- AGENTS.md README.md .claude/skills/city-walker/SKILL.md docs/ app/_components/sun-rig.ts app/_components/create-app.ts app/_components/city-walk.tsx scripts/extract-canopy.sh scripts/extract-roof-colour.sh scripts/extract-ndvi.sh scripts/extract-lamps.sh scripts/extract-walls.sh scripts/extract-rail.sh`
> Plans 008–013 edit several of these (AGENTS.md lines 36/147–149/191–193,
> SKILL.md line 80 and 149–151, `docs/portability.md` step 5, `sun-rig.ts`,
> `create-app.ts`, `city-walk.tsx`, README prerequisites) — expected. This
> plan locates every target **by its text**, never by line number; if a
> quoted phrase is not found, STOP.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW (documentation and comments; one licence-attribution change in the HUD)
- **Depends on**: run last (after 008–013) so it documents the final state
- **Category**: docs
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

The repo's own rule is that the knowledge base is part of "done", and its
skill is "the deep reference … load it for any non-trivial rendering, data,
or perf work". Both have drifted from the code in ways that mislead the next
agent: the skill says tree LOD is *planned* (it shipped), that the cheap
crown is a detail-1 icosphere "because detail 2 is too costly" (the code
uses detail 2), that the lite profile has a transmission knob (transmission
was removed), and it shows a Snapshot JSON key (`style`) the app never
reads. AGENTS.md says raw DGM rasters "must not be committed" while 82 MB of
DGM1 GeoTIFFs are committed and *required* by `bun dev`; its file map omits
15 of 32 viewer modules and five of seven bake scripts. The portability
checklist lists four of seven bakes and omits the Geofabrik `.osm.pbf` the
wall bake needs. Comments in `sun-rig.ts` describe a 2048² map, a
whole-scene frustum and VSM — none true. And the OSM attribution covers
lamps only, while walls, platforms and bridge structure are OSM-derived too
(ODbL requires the credit).

## Current state

All excerpts below are quoted so you can `grep -n` for them.

### AGENTS.md

- Line 42: `Lint is **ultracite** (a biome preset) — it auto-formats on save via the hook`
  — the Claude Code hook was removed in commit `dc6a572`; `.cursor/hooks.json`
  still runs `bun fix --skip=correctness/noUnusedImports` after edits in
  Cursor only.
- Lines 48–59 ("Where things live"): the `app/_components/` bullet lists
  `create-app.ts`, `terrain-layer.ts`, `water-layer.ts`, `vegetation-layer.ts`,
  `city-layer.ts`, `sun-rig.ts`, `post-stack.ts`, `visual-style.ts`,
  `minimap.tsx`, `city-walk.tsx`, `poc-debug.ts`. Absent: `rail-layer.ts`,
  `wall-layer.ts`, `lamp-layer.ts`, `height-fog.ts`, `camera-flight.ts`,
  `viewpoints.ts`, `scene-profile.ts`, `collision.ts`, `fps-movement.ts`,
  `touch-controls.ts`, `inserted-building.ts`, `depth-grading-effect.ts`,
  `paper-grain-effect.ts`, `virtual-joystick.tsx`, `city-walk-client.tsx`
  (plus, after plans 008–012: `scene-census.ts`, `fetch-optional.ts`,
  `webgl-support.ts`, `look-defaults.ts`). The `scripts/` bullet names
  `extract-dlm.sh`, `extract-canopy.sh` and `prepare-data.ts` only; the
  others are `extract-lamps.sh`, `extract-ndvi.sh`, `extract-rail.sh`,
  `extract-roof-colour.sh`, `extract-walls.sh`, `ndvi-at-trees.py`.
- Lines 89–91: `Raw downloads (DLM ~5 GB, DOM1/DGM ~100s MB) **must not be committed** — keep them in \`data/_raw/\` (gitignored).`
  — but `git ls-files data/dgm` lists six `dgm1_*.tif` (13–15 MB each;
  `33414_5656` and `33414_5658` are not in `TILE_BLOCK`), and
  `scripts/prepare-data.ts` `fail()`s without them.
- Line 25: `Playwright for e2e + the screenshot harness; \`bun test\` for \`lib/\` units`
  — units also live in `app/_components/`.
- Lines 166–167: `renders at **\`pixelRatio\` 0.5** with a quarter-res transmission buffer`
  — transmission was removed in commit `8f30471`.

### `.claude/skills/city-walker/SKILL.md`

- Lines 107–109: `Crown is \`IcosahedronGeometry(r, 1)\` (≈80 tris; detail 2 is 320 — too costly ×tens of thousands ×shadow pass).`
  — `vegetation-layer.ts:258` is `new IcosahedronGeometry(CROWN_R, 2)` (320
  tris, "a cheap ~4× over the old icosphere"), and the rich near crown is
  ~1 440 tris.
- Lines 118–119: `**Tree LOD (planned):** chunking gives per-cell camera distance, so the rich crown can be used near the camera and the cheap icosphere far away.`
  — shipped: `LOD_NEAR_IN_M`/`LOD_NEAR_OUT_M` and `updateLod` in
  `vegetation-layer.ts`; `docs/transformations.md` lists the multi-tuft
  crown LOD as active.
- Lines 121–128 ("Porting the sandbox crown … cost"): radial normals,
  backlight shimmer and the LOD-gated multi-tuft crown all shipped; only the
  dappled canopy shadow is still planned (`docs/transformations.md`, planned
  #5).
- Line 163: the Snapshot JSON example contains `"style":"clay"` — the real
  `Snapshot.look` has no `style` key (`city-walk.tsx`, and after plan 012
  `lib/city/snapshot.ts`).
- Lines 170–176: the lite table's third row `| \`pixelRatio\` / \`transmissionResolutionScale\` | dpr≤2 / 0.5 | **0.5** / 0.25 | …`
  — only `pixelRatio` exists (`create-app.ts:312-314`).
- Lines 189–190: `commit only the small derived per-tile artifacts in \`data/dlm/\` and \`data/dgm/\`` — see the AGENTS.md item.
- Lines 196–204: the "Regenerate one tile" block lists `extract-dlm.sh`,
  `extract-canopy.sh`, `extract-roof-colour.sh`, `extract-ndvi.sh`,
  `prepare-data.ts` — missing `extract-lamps.sh`, `extract-walls.sh`,
  `extract-rail.sh`.

### `docs/portability.md`

- Lines 44–49 (step 4): lists `extract-dlm.sh`, `extract-canopy.sh`,
  `extract-lamps.sh`, `extract-roof-colour.sh` ("experimental") — missing
  `extract-ndvi.sh`, `extract-rail.sh`, `extract-walls.sh`; roof colour is
  active (`docs/transformations.md` "Roof colour", `create-app.ts` `fetchRoofLut`).
- Lines 66–72 ("Fetching source data"): no row for the Geofabrik regional
  `.osm.pbf` that `scripts/extract-walls.sh` requires (header lines 14–18:
  `data/_raw/osm/*.osm.pbf`, override `WALLS_PBF=`).

### `docs/transformations.md` and `docs/data-flow.md`

- `transformations.md` lines 213–214 (planned #8): `**Adaptive / half-res post** — fill-rate is the bottleneck; a resolution scale under load buys headroom…`
  — the motion-keyed AO+DoF skip shipped (`lib/city/regression.ts`,
  `post-stack.ts` `setRegressed`); DoF already runs at `resolutionScale: 0.5`;
  only a pixel-ratio drop remains open.
- `transformations.md` has no ✅ entries for height-term fog
  (`height-fog.ts`), water mist (`water-layer.ts` `createWaterMist`),
  drifting clouds (`sun-rig.ts:57-65`), golden/blue-hour stops
  (`lib/city/atmosphere.ts`), or the meadow mottle (`terrain-layer.ts`
  `GRASS_MOTTLE`) — all shipped per `plans/aesthetic-and-visual-fine-tuning.md:8-15`,
  while same-class entries (dusk glow, roughness jitter) are in the ledger.
- `data-flow.md` line 95 (`DGM -. "tile bounds" .-> MM`) and the table row
  `| **Minimap** | derived from tile bounds | …` — `minimap.tsx` draws the
  per-tile DLM class PNG as background (`landcoverTiles`) and CityJSON
  footprints (`getFootprints`), so two edges are missing.

### Code comments

- `app/_components/sun-rig.ts:43-46`: `160 m → ~0.16 m texels at 2048².`
  (values are 110 m and 3072²); `:70-73`: `orthographic shadow camera sized to the whole scene`
  (it is camera-following); `:117`: `VSM softens edges via a SMALL blur.`
  (the renderer uses `PCFShadowMap`; VSM is a documented dead end).
- `app/_components/create-app.ts:249`: `/** transparency 0..1 of the ACTIVE style (ghost: frosted, clay: alpha) */`
  (ghost is gone); `:317`: `// three 0.184 deprecated PCFSoftShadowMap`
  (AGENTS.md and `sun-rig.ts:120` say r182, which matches the Migration Guide).
- `scripts/extract-canopy.sh:7`: `#   - data/dgm/<tile>/dgm1_<tile>.tif` (the
  path read at `:28` is `data/dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif`); `:12`:
  `#   nDOM = DOM1 - DGM1            (object height above ground, gdal_calc)`
  (computed in Python/Pillow, see `:60-61`).
- `scripts/extract-roof-colour.sh:5-7`: `# STATUS: 🧪 EXPERIMENTAL … the runtime hook that consumes it + the GPU A/B … are the next step`
  (the hook exists; the ledger says active).
- `scripts/extract-ndvi.sh:8`: `# colour lush↔dry (and, later, meadow tint).` (meadow tint shipped).

### Attribution

- `app/_components/city-walk.tsx` footer: `Lamp positions © OpenStreetMap contributors (ODbL).`
  (the only in-app credit). OSM also supplies walls (`extract-walls.sh`),
  station platforms and `bridge:structure` arches (`extract-rail.sh`).
- `README.md:65-69`: credits OSM `for street lamps and walls (ODbL)`.
- `scripts/extract-lamps.sh:7-8` claims `the derived file carries "© OpenStreetMap contributors (ODbL)"` —
  `grep -ci "openstreetmap" data/dlm/lamps_33412_5656_2_sn.geojson` → 0
  (same for walls/platform).

### Conventions

- `docs/README.md` "Keeping these docs current" is the rule being applied.
- Markdown is formatted by Biome (`bun run fix`); keep the existing table
  styles.
- Conventional Commits: `docs:` for docs and comments, `fix:` for the
  attribution footer.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint (formats Markdown too) | `bun lint` | exit 0 |
| Typecheck (comment-only code edits) | `bun typecheck` | exit 0 |
| Full gate | `bun run verify` | exit 0 |
| E2E (footer text is not asserted, but run it) | `bun run test:e2e` | all pass |

## Scope

**In scope**:

- `AGENTS.md`, `README.md`, `.claude/skills/city-walker/SKILL.md`
- `docs/portability.md`, `docs/transformations.md`, `docs/data-flow.md`
- comments only in `app/_components/sun-rig.ts`, `app/_components/create-app.ts`
- `app/_components/city-walk.tsx` (the footer paragraph only)
- header comments in `scripts/extract-canopy.sh`, `extract-roof-colour.sh`, `extract-ndvi.sh`
- the FeatureCollection emitters in `scripts/extract-lamps.sh`, `extract-walls.sh`, `extract-rail.sh` (one `"attribution"` key)

**Out of scope**:

- Any behavioural code change; `data/**` (the committed GeoJSONs gain the
  attribution key at the next bake, not by hand).
- `plans/README.md` beyond your status row (this run's index already
  collapsed the previous reconciliation notes).
- Deleting the unused `33414_*` DGM tiles (maintainer decision — see notes).
- `aesthetic-sandbox.html` (move/delete is a maintainer decision; only its
  mention in the skill changes).

## Git workflow

- Branch: `advisor/014-knowledge-base-currency`.
- Commits per step (`docs:` / `fix:`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: AGENTS.md

1. Replace the hook sentence with: `Lint is **ultracite** (a biome preset). Run \`bun run fix\` before \`bun run verify\` — there is no format-on-save hook for Claude Code (it was removed after it reformatted files carrying merge-conflict markers); Cursor still runs \`bun fix\` after edits via \`.cursor/hooks.json\`. It also enforces a complexity cap; extract helpers rather than fighting it.`
2. Rewrite the `app/_components/` bullet as a grouped list — spine
   (`create-app.ts`, `city-walk.tsx`, `city-walk-client.tsx`, `poc-debug.ts`,
   `scene-profile.ts`), layers (`terrain-layer.ts`, `water-layer.ts`,
   `vegetation-layer.ts`, `city-layer.ts`, `rail-layer.ts`, `wall-layer.ts`,
   `lamp-layer.ts`, `inserted-building.ts`), lighting/post (`sun-rig.ts`,
   `height-fog.ts`, `post-stack.ts`, `depth-grading-effect.ts`,
   `paper-grain-effect.ts`, `visual-style.ts`), input/camera
   (`fps-movement.ts`, `touch-controls.ts`, `collision.ts`, `camera-flight.ts`,
   `viewpoints.ts`, `virtual-joystick.tsx`), HUD (`minimap.tsx`) — and add
   the modules plans 008–012 created if they exist (`ls app/_components/`).
   List all seven `extract-*.sh` scripts and `ndvi-at-trees.py` in the
   `scripts/` bullet.
3. Replace the data-policy sentence with: `Bulk raw downloads (DLM ~5 GB, DOM1, DOP, OSM \`.osm.pbf\`) **must not be committed** — keep them in \`data/_raw/\` (gitignored). The exception is the **DGM1 GeoTIFF + \`.tfw\` per tile (~13–15 MB, \`data/dgm/\`)**: it is committed because \`prepare-data.ts\` bakes the heightfield from it at build time and \`extract-canopy.sh\`/\`extract-rail.sh\` read it. No Git-LFS. Only small derived per-tile artifacts (\`data/dlm/*.png|geojson\`, \`data/dop/*.json\`) are committed otherwise.`
4. Line 25: `\`bun test\` for \`lib/\` and \`app/_components/\` units`.
5. Lines 166–167: delete `with a quarter-res transmission buffer`.

**Verify**: `grep -c "auto-formats on save\|transmission buffer" AGENTS.md`
→ 0; `grep -c "rail-layer.ts\|extract-walls.sh" AGENTS.md` → ≥ 2.

### Step 2: The city-walker skill

1. Lines 107–109 → `Crown = \`IcosahedronGeometry(r, 2)\` (≈320 tris) with lobes and radial normals; the near-camera **rich multi-tuft crown** (~1 440 tris) is swapped in per 250 m chunk by \`updateLod\` (in at 220 m, out at 300 m). Detail 1 (≈80 tris) is the fallback if the far field ever needs a third tier.`
2. Lines 118–119 → `**Tree LOD (shipped):** per-chunk distance swaps the rich crown in near the camera and the cheap one far away; a swap invalidates the shadow map (plan 009).`
3. Lines 121–128 → shorten to what remains: `### Sandbox crown — what is left to port: **dappled canopy shadow** (\`customDepthMaterial\` + alphaMap in the depth pass; mind the WebGLShadowMap alphaMap-override gotcha). Radial normals, backlight shimmer and the LOD-gated multi-tuft crown are in \`vegetation-layer.ts\`. \`aesthetic-sandbox.html\` at the repo root is the historical playground those were ported from; the layer file, not the sandbox, is the source of truth.`
4. Line 163: remove `"style":"clay",` from the JSON example.
5. Lines 170–176: make the third table row `| \`pixelRatio\` | dpr≤2 | **0.5** | …` (delete the transmission half of the cell and the "quarter-res" wording in the Why column) and change "changes exactly three things" to match.
6. Lines 189–190: mirror Step 1.3 (DGM1 committed by design).
7. Lines 196–204: list all seven bakes in dependency order with one-line
   comments: `extract-dlm.sh` (splat + class raster + veg rows) →
   `extract-canopy.sh` (needs the class raster; DOM1 + DGM1) →
   `extract-ndvi.sh` (DOP) → `extract-roof-colour.sh` (DOP + CityJSON) →
   `extract-lamps.sh` (Overpass; needs the class raster) →
   `extract-walls.sh` (local `.osm.pbf`) → `extract-rail.sh` (Basis-DLM +
   DOM1/DGM1 + Overpass platforms) → `bun scripts/prepare-data.ts`.

**Verify**: `grep -c "Tree LOD (planned)\|transmissionResolutionScale\|\"style\":\"clay\"" .claude/skills/city-walker/SKILL.md` → 0;
`grep -c "extract-walls.sh" .claude/skills/city-walker/SKILL.md` → ≥ 1.

### Step 3: `docs/portability.md`

1. Step 4: the same seven-script list as Step 2.7 (or a one-line pointer to
   the skill's list plus the dependency order); drop "— experimental" from
   roof colour.
2. Add a row to "Fetching source data": `| OSM walls, platforms, bridge structure | Geofabrik regional extract (\`.osm.pbf\`, e.g. Sachsen ~250 MB) into \`data/_raw/osm/\`; \`extract-walls.sh\` reads it via GDAL's OSM driver, \`extract-lamps.sh\`/\`extract-rail.sh\` platforms use Overpass |` and rename the existing "Street lamps" row accordingly.
3. Confirm step 5 already points at `lib/city/tile.ts` (plan 010); fix it if not.

**Verify**: `grep -c "osm.pbf" docs/portability.md` → ≥ 1;
`grep -c "prepare-data.ts. (.TILES" docs/portability.md` → 0.

### Step 4: The ledger and the data-flow diagram

1. `docs/transformations.md`:
   - Under "✅ Active" add a heading `### Atmosphere & time of day` with
     five short entries in the existing style (inputs → effect → where):
     **Height-term fog** (`height-fog.ts`, folded into every fog-receiving
     material, HUD *Talnebel*), **River mist** (`water-layer.ts`
     `createWaterMist`, HUD *Flussnebel*), **Drifting clouds** (`sun-rig.ts`
     drives the Sky dome's `time`/`cloudSpeed`), **Golden/blue-hour palette
     stops** (`lib/city/atmosphere.ts` STOPS at −2° and +6°), **Meadow
     mottle** (`terrain-layer.ts` `GRASS_MOTTLE`/`GRASS_NORMAL`, class-1 only).
   - Planned #8 → `**Adaptive resolution while moving** — *partly shipped*: AO and DoF are skipped while the camera moves (\`lib/city/regression.ts\`, plan 007) and DoF runs at half resolution; a pixel-ratio drop under motion is the open half (needs a real-GPU look).`
   - In "Crown shaping", state the cheap crown is detail 2 with lobes.
2. `docs/data-flow.md`: add `DLM -. "class PNG as map background" .-> MM`
   and `CJ -. "building footprints" .-> MM` to the diagram; change the
   Minimap table row's primary source to `tile bounds + DLM class PNG + CityJSON footprints`.

**Verify**: `grep -c "Height-term fog\|River mist\|Drifting clouds" docs/transformations.md` → 3;
`grep -c "map background" docs/data-flow.md` → 1.

### Step 5: Code comments

1. `sun-rig.ts`: `160 m → ~0.16 m texels at 2048².` → `110 m → ~0.07 m texels at 3072².`;
   `sized to the whole scene` → `that follows the camera (see follow())`;
   delete the sentence `VSM softens edges via a SMALL blur.`
2. `create-app.ts`: `(ghost: frosted, clay: alpha)` → `(clay: hash-dithered alpha)`;
   `three 0.184 deprecated PCFSoftShadowMap` → `three r182 deprecated PCFSoftShadowMap`.
3. `scripts/extract-canopy.sh`: fix the DGM path in the header to
   `data/dgm/dgm1_<tile>_tiff/dgm1_<tile>.tif` and `(… gdal_calc)` →
   `(… Python/Pillow — gdal_calc/numpy are unavailable)`.
4. `scripts/extract-roof-colour.sh`: replace the STATUS paragraph with
   `# STATUS: ✅ active (see docs/transformations.md "Roof colour"). The runtime reads the LUT in create-app.ts (fetchRoofLut) and falls back to the synthesized palette when it is absent.`
5. `scripts/extract-ndvi.sh`: `(and, later, meadow tint)` → `(and the meadow tint, HUD "Wiesenfärbung")`.

**Verify**: `bun typecheck && bun lint` → exit 0;
`grep -c "2048²\|whole scene\|VSM softens" app/_components/sun-rig.ts` → 0;
`grep -c "ghost: frosted\|three 0.184" app/_components/create-app.ts` → 0;
`grep -c "gdal_calc)" scripts/extract-canopy.sh` → 0;
`grep -c "EXPERIMENTAL" scripts/extract-roof-colour.sh` → 0.

### Step 6: OSM attribution everywhere it is owed

1. `city-walk.tsx` footer: `Lamp positions © OpenStreetMap contributors (ODbL).`
   → `Street lamps, retaining walls, station platforms and bridge structure © OpenStreetMap contributors (ODbL).`
2. `README.md` provenance paragraph: `plus OpenStreetMap for street lamps and walls (ODbL)`
   → `plus OpenStreetMap for street lamps, retaining walls, station platforms and bridge structure (ODbL)`.
3. In `scripts/extract-lamps.sh`, `scripts/extract-walls.sh` and
   `scripts/extract-rail.sh` (platforms and the bridge `structure` join), find
   where the output FeatureCollection is written
   (`grep -n "FeatureCollection" scripts/extract-lamps.sh scripts/extract-walls.sh scripts/extract-rail.sh`)
   and add a top-level key `"attribution": "© OpenStreetMap contributors (ODbL)"`
   to the emitted object (GeoJSON allows foreign members). If an emitter is
   an `ogr2ogr` invocation rather than a Python/`jq` write-out, add the key
   with a post-processing step only if the script already post-processes
   the file; otherwise STOP and report which script.

**Verify**: `bun typecheck && bun lint` → exit 0;
`grep -c "station platforms" app/_components/city-walk.tsx README.md` → 2;
`grep -c '"attribution"' scripts/extract-lamps.sh scripts/extract-walls.sh scripts/extract-rail.sh` → ≥ 3;
`bash -n scripts/extract-lamps.sh scripts/extract-walls.sh scripts/extract-rail.sh` → exit 0.

### Step 7: README data section

In the "Data" section, after the DGM1 heightfield paragraph, add one
sentence: `The DGM1 GeoTIFFs themselves are committed under \`data/dgm/\` (they are the bake input); every other raw source stays in the gitignored \`data/_raw/\`.`
In "Development", add `bun run shots   # --headed snapshot harness on a real GPU (see AGENTS.md)` if plan 008 landed.

**Verify**: `grep -c "bake input" README.md` → 1; `bun lint` → exit 0.

## Test plan

- No new tests: every change is prose or a comment except the footer
  string and the three bake-script emitters. `bun run verify` and
  `bash -n` on the scripts are the gates; `bun run test:e2e` once at the end
  (the mobile spec reads HUD text — labels are untouched, but run it).

## Done criteria

- [ ] `bun run verify` exits 0; `bun run test:e2e` exits 0
- [ ] All `grep` counts in Steps 1–7 hold
- [ ] `git diff --stat` touches only the in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- A quoted phrase in "Current state" is not found (the text moved or was
  already fixed by another plan — report which and skip that item only if
  the replacement is already present).
- A bake script's FeatureCollection emitter cannot take the attribution key
  without restructuring the script.
- Any step needs a behavioural code change.

## Maintenance notes

- **Maintainer decisions recorded, not taken here**: the two committed but
  unloaded DGM tiles (`33414_5656`, `33414_5658`, ~28 MB in the working
  tree) can be `git rm`ed or moved to `data/_raw/`; `aesthetic-sandbox.html`
  can move under `tools/` or be deleted; the README's
  `TODO(maintainer)` on dataset editions/licences is still open — the
  `data/dgm/*_akt.csv` sidecars and the roof-colour `meta` blocks already
  hold most of the inputs for a provenance manifest (see the direction list
  in `plans/README.md`).
- When plan 009's dead zone, plan 010's artifact map or plan 012's table
  change again, the skill's shadow row, the portability checklist and the
  snapshot example are the three places that must follow.
- The committed OSM GeoJSONs get their `attribution` member at the next
  bake; until then the HUD footer and README carry the credit.
