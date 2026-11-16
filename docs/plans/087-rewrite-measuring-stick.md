# Plan 087 [rewrite]: Plates compared on a real GPU, and one ledger every plan of the series writes its figures into

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and `AGENTS.md`
> first. This plan builds the series' measuring stick; it changes no look
> and no data. Work the phases in order, one pull request each. Run each
> phase's **Verify** and write its figures into the ledger before the
> next. On a STOP condition, stop and report; do not improvise. When
> done, update this plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- e2e/snapshot-shot.spec.ts e2e/swiftshader-webgpu.ts playwright.config.ts scripts/qa-views.ts qa/views app/_components/poc-debug.ts app/_components/poc-scene.ts app/_components/stream-timing.ts app/_components/scene-client.ts app/_components/scene-protocol.ts lib/city/tile.ts lib/city/tileset.ts .github/workflows/ci.yml package.json`
> If a file under *Current state* no longer matches its excerpt, find the
> symbol by name; if it is gone, that is a STOP condition.

## Status

- **Priority**: P1 — the first plan of the series; 088–096 write into
  what it builds
- **Effort**: M, plus a machine with a GPU that keeps running
- **Risk**: MED — a comparison that flakes is worse than none, and a
  self-hosted runner executes code
- **Depends on**: none. 088 later changes where the ledger finds the
  tileset (phase 3 names the one function to change)
- **Category**: rewrite — all three aims, as their proof
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: IN PROGRESS — phase 1 (the ledger) built 2026-11-16;
  phase 2 (the browser's figures) built 2026-11-16; phases 3–6 TODO

## Why this matters

The series promises three things: faster on the device, fewer bytes on
the wire, less complexity. Today none of them is counted by a machine,
and the picture is checked by no machine at all. CI draws the `lite`
profile on SwiftShader and asserts that layers are present; how a thing
looks is judged by hand on a GPU (ADR 0018). That hand has been the
bottleneck: plan 019, the GPU checklist, is open since September, and
PR #156 — the spike that bakes rails, trams and riverside, plan 074
part A — waits since 2026-10-11 with "don't merge before a look on a
real GPU". Every plan of the series moves geometry, textures or the
stream; each would queue behind the same hand.

After this plan a pull request is told two things without anyone
looking: which reference views changed — in CI on the runner's
software renderer, and on a real GPU where one runs — and which of the
series' figures moved. What stays a person's is the judgement whether a
changed picture is good.

## Current state

**The shot harness** — `e2e/snapshot-shot.spec.ts`, started by
`bun run shots` (`SHOTS=1 playwright test e2e/snapshot-shot.spec.ts
--headed`; `playwright.config.ts` ignores the spec unless `SHOTS` is
set). For every `shots/*.json` and every `qa/views/*.json` it opens the
site's route, waits for `window.__poc.ready`, applies the snapshot
(`handle.applyCameraState`, `handle.setSun`, `look.set`), waits in
frames until the picture has settled, hides the HUD and writes
`shots/<name>.png` (`qa-<name>.png` for a QA view). Its knobs, all
environment variables: `SHOTS_QUERY`, `SHOTS_TAG` (`<name>.<tag>.png`),
`SHOTS_SITE`, `SHOTS_AT`, `SHOTS_SMALL`. The settle test it waits on:

```ts
drawn >= settle && !poc?.regressed && (focus?.settled ?? true) &&
!poc?.handle?.shadowBusy() && !poc?.handle?.streamBusy() &&
((poc?.shadowRenders ?? 0) > shadows || drawn >= shadowless)
```

Real GPU: the default path (1600 × 1000 at 2×, the browser's own
adapter). `SHOTS_SMALL=1` is the container's path on SwiftShader
(`e2e/swiftshader-webgpu.ts`), never for judging light.

**The reference views** — `qa/views/`: 50 Snapshots (ADR 0018's
contract, `lib/city/snapshot.ts`) and an index, all written by
`bun scripts/qa-views.ts` from a table of poses (`--check` says which
files differ). `shots/` is gitignored.

**Held frames** — `window.__poc` (`app/_components/poc-debug.ts`, only
in a build with `NEXT_PUBLIC_POC_DEBUG=1`): `hold = true` stops the
loop, `step = n` draws exactly `n` frames, `frameMs = 1000 / 60` puts
the scene's clock on a fixed step. The scene's end is
`app/_components/poc-scene.ts` (`setPocProbe`, `pocFramesHeld`). The
`flicker-probe` skill (`.claude/skills/flicker-probe/`) lists what still
moves on a held clock: the clouds (`SkyMesh` runs on the renderer's real
time), Sin City's rain, the near crowns' sway in the styles that keep
it.

**Timings** — `app/_components/stream-timing.ts`: categories counted by
name (`boot:renderer-init`, `boot:tileset`, `boot:spawn-wait`,
`boot:frame`, `boot:loaded`, `tile:compile`, `tile:bvh`,
`dressing:build`, `dressing:queue-wait`, `longtask`, …) with `count`,
`totalMs`, `maxMs` (`streamTimings.summary()`). Nothing hands the
summary to a spec: `printTrace` writes it to the console, in the
scene's worker, with `?trace=1` only.

**Memory** — `SceneApp.getGpuDebug()` (`create-app.ts`, type
`GpuDebug`), reachable as `__poc.handle.getGpuDebug()` (a promise,
listed in `scene-client.ts`): three's `info.memory`, the tile cache's
`bytes`, `maxBytes` and each tile's size, the CPU bytes by kind. A
phone is emulated in the specs by `isMobile` + `hasTouch`
(`e2e/city-walk.spec.ts`; the tier is `MOBILE_MEDIA_QUERY` in
`scene-profile.ts`).

**Bytes** — `docs/data-pipeline.md`, "Measuring what the browser
downloads", holds the procedure as an inline Python snippet over
`public/data/<site>/manifest.json` (`DataManifest`: `files`, logical →
hashed name): `.png`, `.webp` and `.gz` at face value, JSON and GeoJSON
gzipped at level 6. Its table is from 2026-09-25: a tile 4.0–9.7 MB,
Dresden ≈ 98.9 MB. Which files a level fetches is one table,
`ARTIFACTS` in `lib/city/tile.ts` (`DRESSING_KINDS`,
`COARSE_DRESSING_KINDS`, `ASK_KINDS`), and the tileset names them per
tile (`TerrainFiles`, `CityFiles` in `lib/city/tileset.ts`).

**First-load JavaScript** — measured twice by hand: 904 619 bytes gz
(plan 074's Findings, 2026-10-10) and "1.0 MB" (audit 2026-11-11). The
method is in plan 074: a `NEXT_PUBLIC_POC_DEBUG=1` build served by
`next start`, headless Chromium at `/dresden?scene=lite`, every
`/_next/static/*.js` fetched until `__poc.ready`, each file `gzip -9`.

**CI** — `.github/workflows/ci.yml`: four e2e shards on `ubuntu-latest`
over SwiftShader, none with a GPU. The shard "whole site, shell, docs"
(`buildCheck: true`) always builds, so `public/data/` exists there.

**ADR 0018** rejects "Pixel diffs in CI: SwiftShader output is not the
product". That stands for judging a look. Since 2026-11-16 this plan
also compares base with head on SwiftShader, as a tripwire ("Two
tiers" below), and Phase 6 rewrites the record.

**Conventions to match**: a script's head comment says what it does; a
generated file has a `--check` (`scripts/qa-views.ts`); pure logic
lives in `lib/city/` with a unit test beside it; a CI report goes to
`$GITHUB_STEP_SUMMARY` as `scripts/coverage-gaps.ts` does.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install` | exit 0 |
| Format, then gate | `bun run fix && bun run verify` | exit 0 |
| Build with the debug hook | `NEXT_PUBLIC_POC_DEBUG=1 bun run build` | exit 0, `public/data/` written |
| Plates today | `bun run shots -- --grep qa-oblique-400` | `shots/qa-oblique-400.png` |
| Views current | `bun scripts/qa-views.ts --check` | no file differs |
| Headless e2e | `bun run test:e2e` | all pass |

## Scope

**In scope**:

- `scripts/ledger.ts`, `lib/city/ledger.ts` and their tests (create);
  `qa/ledger.json` (create, generated)
- `scripts/plates.ts`, `lib/city/plate-diff.ts` and their tests
  (create); `e2e/snapshot-shot.spec.ts` (a tag for base and head, the
  held clock)
- `scripts/compare-tilesets.ts` and its test (create)
- `app/_components/poc-debug.ts`, `poc-scene.ts`, `scene-protocol.ts`,
  `scene-server.ts`, `scene-client.ts`: one read of the timing summary,
  one probe that holds what still moves
- `.github/workflows/` (a ledger step; a plates workflow), `.gitignore`,
  `package.json` (scripts only)
- `docs/adr/0018-…md` (rewritten), a new ADR for the ledger rule,
  `docs/rendering.md` ("Verifying a change"), `AGENTS.md`, the
  `pr-snapshots` skill, plan 019's header

**Out of scope**:

- Any look, material, bake or tile format. A plate that shows a fault is
  reported, not fixed here.
- Plan 019's checks by hand (below, "What stays plan 019's").
- Judging a look on SwiftShader. (Comparing base with head there, as a
  tripwire, is in scope since the maintainer's ruling of 2026-11-16 —
  see "Two tiers" below.)
- A new image or diff dependency: `sharp` is already pinned and decodes
  a PNG to raw pixels.
- Golden images in git, Git-LFS, or a bucket of this plan's own.

## Phases

### Phase 1 — The ledger (deterministic figures, gated)

One committed file, `qa/ledger.json`, and `bun scripts/ledger.ts`
(`package.json`: `"ledger"`): without a flag it writes the file,
`--check` recomputes and exits 1 naming each figure that differs. The
shapes and the arithmetic are `lib/city/ledger.ts`, pure, with tests.

Figures, for the reference site (`REFERENCE_SITE` in `sites/`), read
from `public/data/<site>/` through **one** function,
`publishedFiles(site)` (088 will point it at the published tileset):

1. **Bytes and requests.** Per tile and level, from the tileset's
   `files` and the manifest: bytes on the wire (the rule of
   `docs/data-pipeline.md`, above) and the number of files. Recorded as
   the spawn tile, the median and the largest tile, and the site, for
   five sets: *far tile* (far buildings, coarse terrain, its rasters and
   coarse side files), *fine level* (the fine terrain, its rasters, its
   dressing files), *near buildings*, *ask files*, *everything*; and the
   phone's variant where a row has a low twin.
2. **Complexity counters.** `DRESSING_KINDS.length`, the coarse and ask
   kinds, the distinct extensions among published files, the lines of
   `app/_components/*-layer.ts` without tests, the lines of `bootApp`
   in `create-app.ts`, the files in `pipeline/bake/` that match
   `neighbour|seam|margin`, the comments that say `upstream workaround`
   under `app` and `lib`. Each counter's rule is one function with a
   test on a fixture.

Then delete the inline Python from `docs/data-pipeline.md` in favour of
the command, and replace its 2026-09-25 table with the ledger's figures.

CI: in the build-check shard, after `Build`, run
`bun scripts/ledger.ts --check`. A PR that moves a figure commits the
new `qa/ledger.json`; the diff is what the reviewer reads.

**Verify**: `bun scripts/ledger.ts && git diff --exit-code qa/ledger.json`
→ no diff on a second run (the file is a function of the tree);
`bun test lib/city/ledger.test.ts` → pass. **Ledger**: the first
baseline of bytes, requests and counters, dated.

**Built (2026-11-16), hardened the same day after an independent
review** (no way past `--check` for a figure it compared; the holes were
in what it compared and what its figures were named). What later phases
and plans can rely on:

- `qa/ledger.json` (version 2) has `published`, `bytes`, `buildings`,
  `counters` and `rasters`, all gated; `ledgerDiff` skips the paths of
  `UNCOMPARED` with everything under them — today `dated` alone; a
  section's recorded part joins by its path (`browser.readWith`).
- **Every published file is in exactly one class** (`published`: `tiles`,
  `boot` — the manifest, the tileset and the ground plate —, `site`,
  `server`; each
  site-wide row's bytes in `kinds`). The script lists the directory, not
  the manifest: a file that no tile and no row of `SITE_FILES`
  (`lib/city/ledger.ts`) names is an error, and so is an extension the
  wire rule does not know, and so is a tile that names a file the set
  `all` does not hold (a new extras key, a path out of the directory).
  Nothing is left out of a sum: PR #310 made the
  buildings' bytes the same on every machine, so the buildings, the
  manifest and the tileset JSONs count at their full bytes.
- **The sets are what a visit does**: `far`, `fine` (the fine level
  beyond the ground detail's reach: the 1024² twins), `approached` (the
  full rasters on top), `near`, `ask`, `all`, and `unvisited` (what a tile
  names and no set fetches: the footprints); each on a desktop and, where
  a phone reads other files, on a phone. The reads are the viewer's
  `rasterFiles` over the kinds a level acquires, handed in as
  `RasterReads`; `scripts/ledger.test.ts` fails when
  `loadTerrainRasters`, `loadReachSet` or `buildDressing` fetch something
  else than the sets count.
- **The counters count code** (`lib/city/ledger-counters.ts`, each with
  what it cannot see): `layerModules` the `*-layer.ts` modules wherever
  they lie, in lines of code; `longestFunction` the longest top-level
  function of the sources (the boot, however it is written, wrapped or
  moved; a `.tsx` file is read with its JSX);
  `bakeSeamModules` the bake modules whose code handles a tile's edge,
  with each way's count; `upstreamWorkarounds` the register's entries in
  `docs/rendering.md` and the marked comments.
- **A further section** (as 091's raster table is; phase 2's browser
  figures, 090's dressing baseline) is a module of its own beside
  `lib/city/ledger.ts`, one more field of `Ledger` and one more key of
  the `fresh` object in `run` (`scripts/ledger.ts`), measured from the
  `site` and `root` that `run` is handed: `datedLedger` and `ledgerDiff`
  take whatever they are handed and write a section where it was
  measured. **A gated figure is a leaf**: one named key a number (or a
  string), compared by its path and named by it when it moves — a list is
  one leaf and moves whole, so a figure a reviewer should read by name is
  a key, not an entry. What is recorded and not gated goes under a path
  of `UNCOMPARED`. A switch of its own joins `FLAGS`; any other argument
  is refused with exit 2, and nothing is written.
- `datedLedger` keeps the committed date while no gated figure moves, so
  a second run writes the same file.
- `publishedFiles(site)` in `scripts/ledger.ts` is the one reader of the
  published site (088 repoints it); `run(argv, { root, site })` is the
  script, which the tests run end to end on a fixture site; `main` is
  `run` with an error printed as its message (exit 1).
- The wire rule gzips text with Bun's zlib: the figure is that Bun's, not
  what a host sends, and a Bun upgrade may move the JSON figures by a few
  bytes — that diff is committed with the upgrade.
- The tests are written from mutations of the code: every rule changed
  once, each change failing a test (the PR says how many).
- CI runs `bun scripts/ledger.ts --check` as the build-check shard's last
  step, after its e2e, whenever the build succeeded.
- Baseline (Dresden): the spawn tile's fine level 5.45 MB in 29 files
  beyond the reach (a phone's 5.31 MB in 28) and 7.92 MB in 34 once
  approached (a phone's 7.52 MB in 30), its far set 4.69 MB in 10, the
  tiles' files 193.6 MB in 641, the boot 39.8 kB in 3, 39 site-wide files
  with 3.51 MB, 17 of the server's; 17 dressing kinds, 27 layer modules
  with 14 420 lines of code, `bootApp` 2 354 lines of code, 58 of 84 bake
  modules on seams, 10 registered upstream workarounds at 8 marked sites.
  The figures are in the file and in `docs/data-pipeline.md`, "Measuring
  what the browser downloads".

### Phase 2 — Figures a browser has to produce

`e2e/ledger.spec.ts` (ignored unless `LEDGER=1`, as the shot spec is
unless `SHOTS=1`), run by `bun run ledger -- --browser` against the
`NEXT_PUBLIC_POC_DEBUG=1` production build:

1. **First-load JavaScript**: plan 074's method (above), as code. The
   set of files and their gzip-9 bytes; the scene's chunks named.
2. **A phone's tile bytes**: a context with `isMobile` and `hasTouch`
   at `/dresden?scene=lite`; after `ready`, `getGpuDebug()`'s
   `tileCache` (bytes, each tile's size) and `held`. This is ADR 0047's
   rule — "a phone's memory must not grow" — as a number.
3. **Timings**: add a value call `getTimings()` to the scene's handle
   beside `getGpuDebug` (same path through `scene-protocol.ts`,
   `scene-server.ts`, `scene-client.ts`), returning
   `streamTimings.summary()`. Record the `boot:*` marks,
   `dressing:build`, `tile:compile` and `longtask`.

**Built (2026-11-16).** `bun run ledger -- --browser` runs
`e2e/ledger.spec.ts` (never retried) and writes `browser` (gated
exactly) and `timings` (recorded) into `qa/ledger.json`; without the flag
both stay as committed and `--check` says they were not compared. The
section is its own module, `lib/city/ledger-browser.ts` and
`scripts/ledger-browser.ts`. `getTimings` needed no protocol change: a
value call is a name in `ASKED` (`scene-client.ts`), served generically.
`getGpuDebug()` gained `tier` and `tileCache.tiles` (each content's URI,
exact bytes, and whether it loaded). After the review of 2026-11-16:

- the scripts' bodies are gzipped by the pinned Bun, not in Playwright's
  Node (26–79 bytes a file apart), so the JavaScript is gated exactly,
  without the ±0.5 % this phase first named;
- the first-load set is cut by what it waits for — `ready`, the named
  workers `scene`, `ground`, `niches`, then five quiet seconds — and a
  second read must equal it; a body that cannot be read fails the read;
- the phone figure is `phoneLiteSpawnCache`: the cache's own accounting
  of its loaded contents under the lite profile, read until two reads
  agree, the scene's tier asserted `mobile`. It is not the phone's
  memory; `held` (three's `info.memory`) is recorded, since two reads of
  one build differed (attributes 332 against 325).

After the second review: the phone's two reads are 4 s apart, more than
a late part's 3 s compile wait, and need no compile queued; a worker
whose resource timing is full (250) fails the read, and so does a script
outside the counted workers when no BVH worker ran; `--browser` refuses a
build environment that inlines what CI does not set (the crash reports'
DSN, release, environment) and a running server that does not serve
`.next`'s current build.

`longtask` has no row: the scene counts long tasks only with `?trace=1`.
Figures: `docs/data-pipeline.md`, "What a browser reads".

Gated: 1 and 2, exactly (as built: the ±0.5 % first planned for the
JavaScript went with the gzip into the pinned Bun). **Recorded only**: 3. On SwiftShader a
timing depends on the runner drawn (`ci.yml` documents a factor of two
between runners), so the ledger keeps timings in a section of their own
that `--check` never compares, each with the machine and date it was
read on.

**Verify**: `bun run ledger -- --browser` twice → figures 1 and 2
equal. **STOP** if the first-load set
differs between two runs of the same build: find out why before gating
it. **Ledger**: JavaScript, a phone's tile bytes, the first timings.

### Two tiers (the maintainer's ruling 4 in plan 086, 2026-11-16)

ADR 0018 rejected pixel comparison on SwiftShader because its picture
"is not the product". That holds for judging a look. It does not hold
for the question a refactor asks — did anything change that nobody
meant — and a GPU is not at hand for every PR. So phases 3 and 4 are
built twice over the same code (`lib/city/plate-diff.ts`,
`scripts/plates.ts`, the held clock):

- **Tier 1, in CI**: the merge base and the head rendered by the same
  runner's software renderer (`SHOTS_SMALL=1`, the views that hold
  there), compared with a tolerance from that renderer's own noise
  floor. It reports *changed* and names the views. A PR with a
  *Snapshots* section may differ; one without may not. It never says a
  picture is good.
- **Tier 2, on a real GPU**: as phases 3 and 4 describe — light, shadow,
  anti-aliasing and precision as a visitor's device draws them. It
  gates nothing until the maintainer has chosen where it runs.

Since ruling 3 (a slight deviation that is named and shown is
acceptable), a differing view is a question to answer in the PR, not
by itself a fault. Phase 6's rewrite of ADR 0018 records both tiers.

### Phase 3 — A frame that repeats (spike; its numbers decide)

On a machine with a GPU (the maintainer's, or any the executor has):

1. Render every QA view twice from the same build
   (`SHOTS_TAG=a`, `SHOTS_TAG=b`) and diff each pair with a first
   `lib/city/plate-diff.ts`: per pixel the largest channel difference;
   a pixel *differs* above a level; a view *differs* above a share of
   pixels. Start from the `flicker-probe` skill's level (24 of 255).
2. Name what moves between two renders of the same commit. Expected
   from the skill: clouds, rain, crown sway; possibly the order tiles
   landed in, and the lens blur's settle.
3. Remove each cause at its source, behind the debug hook only: the
   harness sets `frameMs` and a new probe field (`PocProbe`, name it
   `still`) that the sky, the rain and the sway read as "no time
   passes". Never a URL parameter, never in a build without
   `NEXT_PUBLIC_POC_DEBUG`. A cause that cannot be held is masked per
   view in the views' table (`scripts/qa-views.ts`), with the reason.
4. Fix the tolerance from the measured floor: the level and the share
   under which every view passed in ten same-commit pairs, plus a
   margin; write both into `lib/city/plate-diff.ts` as named constants
   with the measurement in the comment.

**Verify**: ten same-commit pairs of all 50 views → 0 views differ.
Then a known change (set `"fogPct"` from 20 to 60 in one view) → that
view differs. **STOP** if, after step 3, more than five views still
differ between same-commit renders: report which and why; the plates
are then built on the views that hold, and the rest stay plan 019's.
**Ledger**: the noise floor, the seconds one view takes, the adapter.

### Phase 4 — Where the GPU comes from (a decision, then the workflow)

The reference is **main, rendered on the same machine**: `bun run
plates` renders the merge base and the head with the same browser on
the same adapter and diffs them. No golden image is stored anywhere;
a driver update cannot fail a PR, since both sides move with it. Base
plates are cached on the machine in a gitignored `plates/` folder under
the base's commit and the adapter's name.

First a spike, each candidate judged by the same four questions — is
the adapter hardware (`navigator.gpu.requestAdapter()` then
`adapter.info`; SwiftShader is a fail), what is Phase 3's noise floor
there, how many minutes does a PR's run take, and who can start it:

- **a self-hosted runner** on the maintainer's machine (plan 019's
  figures of 2026-11-05 were read on an M1 Max);
- **a hosted runner with a GPU** (macOS on Apple silicon, or a GPU
  runner: availability and cost are for the spike to find, not assumed
  here);
- **no runner**: `bun run plates` by hand or by an agent on a machine
  with a GPU, its report posted on the PR.

Write the findings into this file and stop for the maintainer's choice.
Then build the workflow for the chosen one. Whatever is chosen:

- It never runs code from a fork. Tier 2's triggers are
  `workflow_dispatch` and a label a maintainer sets, on branches of
  this repository only. Tier 1 runs on hosted runners for every PR
  from a branch of this repository, whatever its base.
- It reports each differing view with base, head and difference image
  as workflow artifacts (seven days, as the Playwright report) and a
  table in the job summary.
- **How an intended change is approved.** A PR whose description has a
  `## Snapshots` section (the `pr-snapshots` skill) claims a visible
  change: the plates *report*, and the PR lists the differing views by
  name under that section. A PR without one claims the picture is the
  same: a differing view *fails* the check until the PR names the
  change and shows it — the check asks that a change be owned, not
  that there be none (plan 086, ruling 3). The `pr-snapshots` skill
  gains this rule and the command.

**Verify**: a branch that changes only a comment → the check passes
with 0 differing views; a branch that changes one palette colour, with
no Snapshots section → the check fails and names the views.
**STOP** (tier 2) if no candidate gives a hardware adapter with a floor
Phase 3 accepts: tier 2 stays a local command, and the row says so.
**Tier 1's own gates**: its noise floor is measured on the hosted
runner's SwiftShader the same way (ten same-commit pairs of the views
that hold there → 0 differ; a seeded change → that view differs), its
run fits one CI job, and it stops if fewer than half of the views hold
on SwiftShader — then tier 1 is those views and the row names them.

### Phase 5 — The published tileset compared by content

`bun scripts/compare-tilesets.ts <dir-a> <dir-b>`: two published sites
(`public/data/<site>` trees, or two manifests after 088). Files with
the same hash are equal. For the rest, by kind: a glTF's decoded
positions, indices, attributes and property table equal within its
quantisation step; a raster's decoded values equal; a JSON or GeoJSON
file's records equal with the order of records and keys ignored; a
packed binary (`.pts`, `.fpr`, `.crw`, the plate) through its own
reader in `lib/city/`. It prints what differs and exits 1.

This is the proof plan 092 needs once a hand-over format changes and
"a cold bake publishes 0 new files" no longer holds. What 092 changes
*before* the build reads it (its own tables against today's files) is
092's to compare; `scripts/eval/compare-bakes.py` is its starting
point.

**Verify**: a site against itself → equal; against a copy with one
tree moved 1 m in `trees_<tile>.geojson` and re-published → exactly
that file named.

### Phase 6 — The records

Rewrite ADR 0018 (decision 4: compared on a real GPU against main on
the same machine; decision 7: a PR without snapshots claims no change;
SwiftShader stays rejected for judging a look and is the first tier's
tripwire). Write a new ADR, numbered
as `docs/adr/README.md` says under "Numbering": every plan writes its
figures into the ledger; a gated figure that gets worse is committed
with the PR that moves it. Update `docs/rendering.md` ("Verifying a
change"), `AGENTS.md` (Commands; "QA"), and plan 019's header.

**What stays plan 019's**: whether a picture is *good* (the plates say
*changed*); the two phones (section I); the deploy host (J); frame time
on a second GPU and hitches in flight (H); the device checks of
section M. Plan 019 keeps its reference views; they are now the plates'.

**Verify**: `bun run verify` → exit 0; `bun test lib/docs` → every
relative link resolves.

## Findings: tier 1 of phases 3 and 4 (2026-11-16)

Built and measured in the cloud container (4 cores, no GPU; headless
Chromium 1243, WebGPU on SwiftShader's Vulkan — the adapter reports
`google swiftshader`), 800 × 500 at 1×. These figures move into the
ledger when phase 1 has it.

**What it costs there.** A SwiftShader frame takes 4–5 s while the shadow
rings redraw or a tile lands, at any profile. With the whole site
streamed (`?scene=lite&block=1`) a view took 3–5 min to settle; all 50
views would be hours a side. With `?scene=lite` alone — the spawn tile —
a view takes 25–55 s and the page boots in 20 s. `lite` streams no other
tile, so tier 1 can only show views that stand on the spawn tile
(`33412_5656`): 25 of the 50. Eight of them are the tier
(`TIER1_VIEWS`, `scripts/plates.ts`): `across-400`, `shore-eye`,
`street-crossings`, `street-crossings-comic`, `fountain-july-day`,
`lamps-july-night`, `rooftops`, `modell-night` — the oblique flight, the
street's ground and markings, a picture style, monuments and trees, the
night's lamps, the roofs, the water's edge, Modell's parallel camera.
One render of the eight: 319–343 s, the boot included. The other 42 views are tier 2's.

**What moved between two renders of one build**, and what holds it:

| Cause | Seen as | Held by |
|---|---|---|
| The harness never waited. Its settle test was an `async` predicate of `waitForFunction`; on an interval Playwright takes the returned promise for the answer. Every plate was taken as soon as the calls were posted — 30 of 50 views differed, some showing the view before | whole plates, 80–99 % | one awaited loop in the page (`applyAndSettle`); the single shots (`bun run shots`) take it too |
| The scene had not heard the view: its counters reach the page as a mirror (ADR 0061) | the frames of the boot's stream counted as the view's | `handle.sync()` after the calls, before the first read |
| The clouds (`SkyMesh`, on TSL `time`) | 6–7 % of a plate with sky (`rooftops`, `shore-eye`) | `__poc.still`: TSL `time` reads one instant |
| The crowns' sway (the scene's clock, a different frame count each run) | 40–290 pixels along crown edges (`street-crossings`, its Comic twin, `fountain-july-day`) | `__poc.still`: the scene's phase clock reads one instant |

Not seen in the tier's views, held by the same probe: the film grain,
Sin City's rain, the water's ripple, the fountains, the lamps'
reflections. Not held: a data layer's own clock (`performance.now()`,
the traffic flow and the timetable trams) — `traffic-albertstrasse` is
not in the tier; tier 2 masks or holds it when it gets there. The order
tiles land in and the lens's settle, which the plan expected, did not
show: `lite` has one tile, and the harness waits for the lens.

`still` is one field of `PocProbe`. The loop's clock runs on (at
`frameMs` = 50 ms a frame for a plate, the loop's largest step), so what
settles by it still settles; only the phase handed to what animates
(`pocPhase`) and three's `time` node (its public
`onRenderUpdate`) stand. `create-app.ts` reads the probe exactly as it
reads `pocFrameTime`: in a build without `NEXT_PUBLIC_POC_DEBUG` the
phase is the elapsed time (`poc-scene.test.ts`).

**The noise floor.** With the hold, ten same-commit pairs of the eight
views (eleven renders, each a page of its own): 0 views differed, and no
pixel moved by a single step (the largest channel difference was 0 in
all 80 comparisons). Between two builds of one commit, or two servers of
one build: 3 pixels of `across-400` by one step, nothing else. Without
the hold (`PLATES_STILL=0`), one pair of nine views: five differed.

**The tolerance** (`TIER1_TOLERANCE`) is that floor and a small margin:
a pixel differs above 3 of 255; a view differs above 4 such pixels
(`lite` draws at pixel ratio 0.5, so a plate is 400 × 250 drawn pixels
and four of its pixels are one drawn), or above 0.1 of 255 on average
over the plate — the broad small shift no pixel of which reaches the
level. The first numbers, 24 of 255 and 20 pixels, were the
flicker-probe's and far too wide for a renderer that repeats exactly:
the independent review showed them passing a whole frame 9 % brighter,
a 20-pixel object and the sun five minutes later in `rooftops`. Those
are fixtures of `plate-diff.test.ts` now. Seeded on real renders: the
sun five minutes later in `rooftops` differs in 10 322 pixels (2.6 %,
mean 0.62) and in no other view; `fogPct` 20 → 60 in `across-400` in
43.6 % of its pixels under the first level already. (The plan's own
seed, the fog in `rooftops`, moved no pixel: that view is 300 m deep and
`lite` has no farther tile to haze.) A plate depends on the views before
it — `rooftops` rendered alone, not seventh in the row, differed by up
to 19 of 255 in 276 pixels — so both sides render the same row in the
same order, and a kept base plate is used again only for the same row,
harness and page (`harnessKey`).

**What a run refuses.** Base and head are driven by one harness, so a
harness that fails draws the same wrong picture twice. A run therefore
ends without a verdict, exit 2 and a summary that says why, when: a
side was not held still (the head always; the base once it has
`lib/city/plate-diff.ts` — only a base from before the plates is
reported as *not compared* and passes, which was true of this plan's own
pull request; a base git cannot read is an error); a view does not
settle within three minutes (named), or a side's whole render takes
more than ten; the settled camera is not at the snapshot's pose
(`lib/city/plate-pose.ts`; in Modell its pivot, scale, turn and tilt); a plate is blank; two
views of a side have the same pixels; a view is missing on a side.

**The job.** `.github/workflows/plates.yml`, on a pull request of this
repository, whatever its base, that is not a draft and touches what can
move a pixel: it builds the head and, in a worktree, the base (each
`PREPARE_SITES=dresden`), renders both with the head's harness and
compares. The base bakes cold into a cache of its own: with the head's,
a bake keyed without a changed input would show on neither side. On the
hosted runner the first run took 16 min 17 s (15 min 26 s of it
building and rendering, the base's bake still warm); in the container
14 min 20 s with the cold bake. The budget is 30 min. A PR names the
views it means to change under `## Snapshots` (read when the job runs,
so a re-run sees an edit): those are reported; a differing view not
named there fails, with the section or without.

**What the tolerance lets through** in a view tier 1 renders (the
second review's measurement): a change of 4 pixels or fewer at any
contrast; a step of 3 of 255 or less over less than about 3 % of the
frame; one step over less than 10 %. And a run that flakes has no
remedy but a re-run by hand or naming the view — nothing retries, since
the renderer repeated to the pixel wherever it was measured.

**What tier 1 does not see**, so that a green job is not taken for
more: 42 of the 50 views; every tile but the spawn's, and so every
seam; the full profile's shadow rings, AO and resolution (a plate is
400 × 250 drawn pixels); the data layers; a view's page query
(`?safety=3`, `?trail=1`); late parts (murals, window niches) that land
after the scene reports itself settled, which the harness does not
count; drafts, and PRs outside the workflow's `paths`.

**Open, tier 1's own gates.** The noise floor on the hosted runner: the
ten pairs above are the container's. The workflow measures them when
started by hand with `pairs: 10` (`workflow_dispatch`), which GitHub
allows once the file is on the default branch. "Stop if fewer than half
of the views hold" is met as its limit, not passed: 25 of 50 can be
shown at all (`lite` streams one tile) and 8 fit a job. Tier 1 is those
eight. `bun run shots` shares the settle loop and was not run on a GPU
here: a shot that never goes quiet within its budget is still written,
with an annotation.

### What is left for tier 2

The command is the same without `SHOTS_SMALL`: `bun run plates` renders
all 50 views headed, at the full profile, 1600 × 1000 @2×, on the
machine's own adapter, and keeps the base's plates under
`plates/tier2/<commit>/` for the next run on that adapter. Not done,
because no GPU was at hand:

1. **Its own noise floor.** `bun run plates -- pairs 10` on the chosen
   machine; write the level, share and mean into `TIER2_TOLERANCE` (it
   holds tier 1's numbers until then, which a GPU's dither and
   anti-aliasing will hardly meet). Expect what tier 1 could not show: the order tiles
   land in across fifteen tiles, the late parts, the data layers'
   clock, the views with a page query (`?safety=3`, `?trail=1` — the
   harness boots one page and ignores a view's query).
2. **Whether the adapter is hardware.** `run.json` records what the
   adapter says of itself; phase 4's first question is a check of that
   string, not built.
3. **Where it runs** — the maintainer's decision, phase 4's three
   candidates. The workflow is written for a hosted runner; a
   self-hosted one needs the label trigger phase 4 describes, and is
   not registered by an agent.
4. **Minutes.** Unknown: a real GPU draws a frame in milliseconds, so
   the settle (eight frames, then three quiet) is no longer the cost;
   the stream of fifteen tiles is.
5. **The late parts.** At the full profile murals and window niches
   land after "settled"; tier 2 counts them or masks them.

## Test plan

- `lib/city/ledger.test.ts`: each counter on a fixture; the byte rule
  (a `.gz` at face value, a GeoJSON gzipped); a level's file set from a
  two-tile tileset. Model after `lib/city/tile.test.ts`.
- `lib/city/plate-diff.test.ts`: equal images; one pixel over the
  level; a share just under and just over; images of different size
  are an error, not a difference.
- `scripts/compare-tilesets.test.ts`: reordered GeoJSON records are
  equal; a changed property is not; a glTF re-encoded with the same
  content is equal. Model after `scripts/tile-glb.test.ts`.
- `app/_components/scene-client.test.ts`: `getTimings` is a value call.

## Done criteria

- [ ] `bun scripts/ledger.ts --check` exits 0 on main and runs in CI's
  build-check shard
- [ ] `qa/ledger.json` holds bytes, requests, counters, first-load
  JavaScript, a phone's tile bytes, and a timings section marked as
  recorded
- [ ] `grep -n "python3 - <<" docs/data-pipeline.md` finds nothing
- [ ] Ten same-commit pairs of the kept views differ in 0 views
  (figure in the ledger)
- [ ] Tier 1 runs in CI for PRs from this repository's branches, base
  against head on the runner's renderer, and fails a no-snapshot PR
  that changes a view
- [ ] Tier 2 exists as the maintainer chose it and never runs a fork's
  code
- [ ] `bun scripts/compare-tilesets.ts` names a moved tree and nothing
  else
- [ ] ADR 0018 rewritten, the ledger ADR written, `bun run verify`
  exits 0
- [ ] The row in `docs/plans/README.md` updated

## STOP conditions

- A view cannot be made to repeat and no mask is honest (the changing
  thing is what the view checks): leave it out, say so.
- The only GPU on offer is the maintainer's machine and the repository
  accepts PRs from forks: do not register a runner; keep Phase 4 local.
- Holding the clock needs a change outside the debug hook's reach (a
  production code path that reads the probe): stop — a plate must show
  what a visitor sees, not a second scene.
- `qa/ledger.json` differs between two machines on the same commit:
  some figure is not a function of the tree. Find it; do not widen a
  tolerance to hide it.
- A phase needs a new dependency. Ask first (AGENTS.md).

## Maintenance notes

- A new QA view is a row in `scripts/qa-views.ts`; the plates take it
  up by themselves. A view that flakes is fixed or dropped, never
  retried.
- A new kind of published file needs its reader in
  `compare-tilesets.ts`, or it compares as bytes only.
- The plates compare one adapter with itself. They do not say that an
  iPhone draws the same; that is plan 019.
- Each bump of three is run through the plates before it merges: the
  maintainer keeps the newest versions (086, ruling 2), and this is
  what makes that cheap.

## What the series changes about this plan

Built alone, this plan would store reference images and would have to
say where — in git they are megabytes that change with every look.
In the series there are none to store: the reference is main on the
same machine, and after 088 both sides read their tileset from the
lock file, so a plate is a function of two commits. Alone, the ledger
would be a report; here it is the form every plan's *Verify* fills in,
which is why its deterministic half gates and its timings only record.
And the content comparison would not exist: it is here because 092
gives up byte-identical bakes and needs another proof, as 090, 091 and
093 need the plates.
