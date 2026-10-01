# Plan 037: The commands agents run work, and the docs say what the code does

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> a STOP condition occurs, stop and report — do not improvise. When done,
> update this plan's row in `docs/plans/README.md` (status + deviations).
>
> **Drift check (run first)**:
> `git diff --stat dd470e9..HEAD -- AGENTS.md README.md playwright.config.ts package.json bun.lock .github .claude/skills/city-walker/SKILL.md docs/rendering.md docs/data-pipeline.md docs/data-flow.md docs/portability.md docs/transformations.md docs/guide app/_components/keyboard-controls.ts lib/docs`
> If any of these changed, compare the "Current state" excerpts against the
> live files; a mismatch is a STOP condition.

## Status

- **Priority**: P1 (every other plan's executor runs these commands)
- **Effort**: S
- **Risk**: LOW — docs, config and one new test
- **Depends on**: none. Do this plan **first**.
- **Category**: dx + docs
- **Planned at**: commit `a28de75`, 2026-10-01; refreshed against `dd470e9` (main with ADR 0035) the same day

## Why this matters

Coding agents follow `AGENTS.md` literally, and two of its commands do
something other than what it says: `bun build` runs Bun's bundler
("Missing entrypoints") and a bare `bun test` also loads the Playwright
specs in `e2e/` and fails with three errors that have nothing to do with
the change being tested. `bun dev` became HTTPS-only on 2026-09-30
(deliberately: WebGPU on a phone over the LAN needs a secure context), but
the Playwright config still assumes `http://`, so the documented
`E2E_DEV=1` loop and "leave `bun dev` running" both break. On top of that,
the agents' deep reference (the city-walker skill) still states the phone
tile-cache numbers that the code records as the cause of a phone bug, and
several docs describe the fine terrain as a "1024² grid" although it has
been a TIN since ADR 0030. This plan fixes the commands, the config and the
wrong statements, and adds one test so the user guide cannot silently lose
a viewpoint or a slider again.

## Current state

### Commands (`AGENTS.md:40-56`)

```bash
bun install
bun dev            # prepare-data.ts (geodata -> public/data) then next dev
bun build
bun run verify     # lint + typecheck + unit tests — the pre-push gate
...
bun test           # unit tests in lib/, app/_components/ and scripts/
```

`package.json` scripts: `"build": "bun scripts/prepare-data.ts && next build"`,
`"test": "bun test ./lib ./app ./scripts"`, `"dev": "bun scripts/prepare-data.ts && next dev --experimental-https"`.
In Bun, `bun build` / `bun test` are built-ins; only `bun run build` /
`bun run test` run the scripts. `bun test --help` lists
`--path-ignore-patterns=<val>` (Bun 1.4.2, the pinned version).

Same wrong commands elsewhere (fix them all):
- `AGENTS.md:35` ("`bun test` for the `lib/`, …" — prose, keep but say `bun run test`)
- `AGENTS.md:44`, `AGENTS.md:49`
- `README.md:149` ("Unit tests are `bun test` files colocated…" — prose about
  the runner; keep "`bun test` files", but make any *command* `bun run test`)
- `docs/data-pipeline.md:15` (Mermaid label `bun dev · bun build`),
  `:22`, `:298`, `:553`, `:569`, `:582`
- `docs/adr/0001-client-only-static-app.md:26` ("the build (`bun build`)")
- `docs/guide/de/data-journey.md:25` and `docs/guide/en/data-journey.md`
  (Mermaid label `bun dev / bun build`)

`bun dev` is fine as is (`dev` is not a Bun built-in). Leave historical
text in `docs/plans/completed.md` alone.

### Playwright vs HTTPS dev (`playwright.config.ts:1-28, 59-77`)

```ts
const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;
...
  if (process.env.E2E_DEV) {
    return "bun run dev";
  }
...
  use: { baseURL, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: serverCommand(), url: baseURL, reuseExistingServer: !process.env.CI, timeout: 240_000 },
```

`next dev --experimental-https` serves **only** `https://localhost:3000`
with a self-signed certificate. The HTTPS dev server is a maintainer
decision (commit `efae831`: "`bun dev` serves HTTPS (WebGPU on a phone
needs a secure context) for the LAN origin"). **Do not change the `dev`
script.** Fix the test side instead.

`README.md:27`: `bun dev     # prepares public/data, then serves http://localhost:3000`
`README.md:34`: "(about 20 s on the first run, …)" — AGENTS.md says the cold
run is ≈ 2 min for fifteen tiles.
`README.md:59`: "resamples the DGM into terrain meshes (1024² and 512² grids, with retaining walls burned in as breaklines)".

### Phone cache numbers in the skill (`.claude/skills/city-walker/SKILL.md:491-495`)

```
- Phones keep only 120–180 MB of out-of-view tile content cached
  (`tileCacheBytesFor`, `lruCache.min/maxBytesSize`): with the library's
  0.3–0.4 GB default, a minimap jump from the start into the Heide kept the
  start area loaded while the forest tiles arrived and Safari killed the
  tab.
```

The code (`app/_components/scene-profile.ts:170-185`):

```ts
 * `max − min` must exceed the largest tile. The cache never unloads a tile
 * that would take it below `min`, and asks for no new tile while it is at
 * or above `max`: at 120–180 MB a phone that flew to the Alaunpark sat at
 * 181 MB with a 62 MB tile first in line to go — unloading it would have
 * left 119 MB — and never loaded the ground there.
 */
export function tileCacheBytesFor(tier: DeviceTier): { max: number; min: number } {
  return tier === "mobile"
    ? { min: 320 * MB, max: 600 * MB }
    : { min: 1.2 * GB, max: 1.6 * GB };
}
```

`docs/rendering.md` (section "GPU memory on a phone") already has the right
numbers — point to it.

### "1024² grid" for the fine terrain

The fine level (L0) is an error-bounded TIN of the native 1 m DGM within
±0.15 m (ADR 0030, `scripts/bake-tiles.ts` `tinTerrainMesh`), with earth-
retaining walls **snapped** to the measured step; only the coarse level (L1,
512² grid) has walls **burned in**. Wrong statements:

- `README.md:59` (above)
- `docs/rendering.md:372`: `| Terrain grid | L0 1024² near, L1 512² beyond (≈1.2 km at 1080p) | same | same |`
- `docs/data-pipeline.md:336`: "…512² to 1024² by screen-space error…"
- `docs/data-flow.md:292` (Mermaid): `tTER["terrain glTF<br/>L0 1024² · L1 512²"]`
- `docs/portability.md:90` ("resamples any GeoTIFF to its 1024² / 512² grids") and `:94` ("1024² terrain over a 2 km tile")
- `docs/guide/en/glossary.md:188` ("a detailed one (1024² grid)"), `docs/guide/de/glossary.md:201` ("einer detaillierten (1024²-Raster)")
- `docs/guide/en/data-journey.md:138` ("…on a 1024 × 1024 grid and a coarse
  one on a 512 × 512 grid…") and `docs/guide/de/data-journey.md:144`.
- `docs/transformations.md:170` ("the 2 m grid cannot hold it") and
  `:1355` ("its ~2 m grid cannot") — the ledger's own wording of the same
  error. (The third hit, `:1580`, is plan 023 phase 7's micro-relief idea;
  the 2026-10-01 audit already moved it to 🗃️ — leave it.)

Do **not** touch correct 1024² mentions: `docs/rendering.md:386` (says
"the 1024² grid it replaced"), the NDVI/SVF/markings_low raster sizes in
`docs/data-pipeline.md`.

### User guide (`docs/guide/{en,de}/using-the-viewer.md`)

- en `:117-118` / de `:123-124`: "The Großer Garten lies just south of the
  area, so it has no viewpoint yet." — false: `sites/dresden.ts` has 19
  viewpoints, including `grosser-garten` ("Großer Garten", aerial, 250 m),
  `palais-grosser-garten` ("Palais im Großen Garten", walk, eye level),
  `blaues-wunder` ("Blaues Wunder", aerial 60 m), `waldschloesschenbruecke`
  ("Waldschlößchenbrücke", aerial 60 m) and `hauptbahnhof` ("Hauptbahnhof",
  aerial 180 m). The guide lists 14.
- en `:180` / de `:187`: a row `*Detaillierte Kronen* (switch)` under
  Rendering. The HUD's switch is labelled **"Multi-Tuft-Kronen (nah)"** in
  the *Vegetation* group (`app/_components/scene-sidebar.tsx:850-860`).
- `docs/guide/en/how-it-works.md:23` / de `:24`: "about 4 MB for the tile
  you start on, up to about 17 MB if you visit every corner". The measured
  numbers in `docs/guide/en/data-journey.md` (around `:190-197`): ≈ 6.4 MB
  per tile in full detail, ≈ 97 MB for all fifteen tiles on a desktop,
  ≈ 95 MB on a phone. Use those (and the DE equivalents from
  `docs/guide/de/data-journey.md`).

### Codebook pointers (`docs/rendering.md:86-91`)

GLSL-era names that no longer exist anywhere in the code:
`TERRAIN_NORMAL` → `terrainNormal()` (`app/_components/terrain-layer.ts:943`),
`CONTOUR_INK` → `contourInk()` (`:803`), `DATA_POSITION` → `dataPosition`
(`app/_components/shader-chunks.ts:27`), `GRASS_MOTTLE` / `GRASS_NORMAL` →
`grassMottle()` (`terrain-layer.ts:742`; check where the mottle *normal* is
applied — `terrainNormal(withDetail)` — and name what you find).
Also `docs/rendering.md:39` (Mermaid) says "trunk + crown (two LODs)": there
are three crown tiers (`lib/city/vegetation-lod.ts`: `far`, `mid`, `rich`).
And `app/_components/keyboard-controls.ts:8`: the comment
`(pastel → comic → noir → Sin City)` misses Papier (see
`lib/city/render-style.ts` for the order; comment-only change).

### Dependabot and CI (`.github/dependabot.yml`, `.github/workflows/ci.yml`)

```yaml
      lint-and-format:
        patterns: [oxlint, oxfmt]
      # The three.js stack moves as one: postprocessing caps `three`, and
      # n8ao / three-mesh-bvh / the CityJSON loader all peer on it, ...
      three:
        patterns: [three, "@types/three", three-mesh-bvh, postprocessing, n8ao, cityjson-threejs-loader]
```

`postprocessing` and `n8ao` were removed by the WebGPU port. `oxlint`
declares a `>=` peer on `oxlint-tsgolint` (AGENTS.md: "bump them
together"); `3d-tiles-renderer` peers on `three`. There is no
`package-ecosystem: uv` entry for `pipeline/uv.lock`.

CI's "Decide whether the e2e half has to run" step greps
`app components hooks lib e2e public types scripts data sites patches …`
— **not `docs`**. But `e2e/wissen.spec.ts` asserts docs text (e.g. "Der Weg
der Daten", "Transformation catalog", diagram labels), so a docs-only PR
that renames a heading merges green and breaks `main`.

### Lockfile drift

`package.json:79-82` `"trustedDependencies": ["sharp", "unrs-resolver"]`;
`unrs-resolver` is an ESLint-era leftover and appears nowhere in `bun.lock`
(whose `trustedDependencies` lists only `sharp`). `bun.lock:6` names the
workspace `"activity-card"` while `package.json` says `"bridge"`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Format + autofix | `bun run fix` | exit 0 |
| Verify gate | `bun run verify` | exit 0 (lint, typecheck, unit tests) |
| Docs tests | `bun test ./lib/docs` | all pass |
| Diagrams | `bun run docs:diagrams` | exit 0; changed SVGs under `docs/diagrams/` |
| Lockfile | `bun install --frozen-lockfile` | exit 0, no changes |

## Scope

**In scope**: `AGENTS.md`, `README.md`, `playwright.config.ts`,
`package.json` (`trustedDependencies` only), `bun.lock` (header only),
`.github/dependabot.yml`, `.github/workflows/ci.yml` (the path list and the unit job),
`.claude/skills/city-walker/SKILL.md`, `docs/rendering.md`,
`docs/data-pipeline.md`, `docs/data-flow.md`, `docs/portability.md`,
`docs/adr/0001-client-only-static-app.md` (the one command), `docs/guide/{en,de}/*.md`,
`docs/diagrams/*.svg` (regenerated only), `app/_components/keyboard-controls.ts`
(comment only), `lib/docs/guide-labels.test.ts` (create), `lib/docs/links.test.ts` (create),
`scripts/coverage-gaps.ts` (+ test, create), `.gitignore` (`coverage/`),
`bunfig.toml` (create).

**Out of scope**: the `dev` script and `next.config.ts` (HTTPS dev and
`allowedDevOrigins` are maintainer choices); `docs/plans/**` (the advisor
maintains the index); any code behaviour.

## Git workflow

- Branch: `claude/037-agent-commands-and-doc-drift` (or what the operator gives you)
- Conventional Commits, e.g. `docs: run the package scripts, not Bun's built-ins`,
  `fix(e2e): E2E_DEV talks HTTPS to bun dev`, `chore(deps): dependabot groups match the stack`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Commands

Replace the command lines in `AGENTS.md:44` with `bun run build` and
`AGENTS.md:49` with `bun run test` (keep the comment). Fix every other
*command* occurrence listed under "Current state → Commands". Mermaid labels
in `docs/data-pipeline.md:15` and both `data-journey.md` files become
`bun dev · bun run build` (or `/`, matching the original).

Optional guard (do it): create `bunfig.toml` at the repo root with

```toml
[test]
pathIgnorePatterns = ["e2e/**", "node_modules/**"]
```

then check whether Bun honours it: `bun test 2>&1 | tail -5` must end with
`0 fail` and no Playwright error. **If** Bun does not accept the key (error
or the e2e specs still load), delete `bunfig.toml` again and note it in the
plan's status row — the doc fix alone is the deliverable.

**Verify**: `grep -rnE '^\s*bun (build|test)\b' AGENTS.md README.md docs --include=*.md | grep -v plans/` → no matches;
`bun run test` → all pass.

### Step 2: E2E_DEV against the HTTPS dev server

In `playwright.config.ts`, derive the scheme from `E2E_DEV`:

```ts
const PORT = Number(process.env.PORT ?? 3000);
// `bun dev` serves HTTPS only (WebGPU on a phone needs a secure context),
// with a self-signed certificate; the production server is plain HTTP.
const devServer = Boolean(process.env.E2E_DEV) && !process.env.CI;
const baseURL = `${devServer ? "https" : "http"}://localhost:${PORT}`;
```

and in `use` add `ignoreHTTPSErrors: devServer`. `webServer.url` stays
`baseURL`; add `ignoreHTTPSErrors: devServer` to `webServer` as well
(Playwright's `webServer` accepts it). Update the comment block above
`serverCommand()`: "leave `bun dev` running" now requires `E2E_DEV=1` too
(without it the suite expects the production server on plain HTTP).

Update `README.md:27` to `https://localhost:3000` and say in one sentence
that the certificate is self-signed (Next generates it on first run). Fix
`README.md:34` ("about 20 s") to match AGENTS.md ("≈ 2 min cold for fifteen
tiles, ≈ 1 s warm").

**Verify**: `bun run typecheck` → exit 0. If a local machine with a
browser is available: `E2E_DEV=1 bunx playwright test e2e/wissen.spec.ts`
reaches the tests (does not time out on `webServer`). If no browser is
available, say so in the status row — do not install one.

### Step 3: The skill's phone cache numbers

Replace the SKILL.md bullet (lines 491-495) with: phones cache
**320–600 MB** of tile content, weighed as the GPU holds it (the dressing
plugin's `calculateBytesUsed`), and `max − min` must exceed the largest
tile; at 120–180 MB a phone flying to the Alaunpark never loaded the ground
there (the 0.3–0.4 GB default before that kept the start area while the
Heide arrived). Point to `docs/rendering.md` "GPU memory on a phone" and
`tileCacheBytesFor` in `app/_components/scene-profile.ts`.

**Verify**: `grep -n "120–180" .claude/skills/city-walker/SKILL.md` → only
inside the sentence that calls it the old, broken value.

### Step 4: Fine terrain is a TIN

Rewrite each "1024²" statement listed under "Current state" to: L0 = an
error-bounded TIN of the native 1 m DGM (±0.15 m), earth-retaining walls
snapped to the measured step; L1 = the DGM resampled to 512², walls burned
in. For `docs/rendering.md:372` the row becomes e.g.
`| Terrain | L0 TIN (±0.15 m) near, L1 512² grid beyond (≈1.2 km at 1080p) | same | same |`.
Both glossaries: add/adjust the entry so the detailed level is "a TIN
(triangulated irregular network): more triangles where the ground bends"
(DE: "ein TIN (unregelmäßiges Dreiecksnetz): mehr Dreiecke, wo sich der
Boden krümmt"). Keep both languages saying the same thing.

**Verify**: `grep -rn "1024²" README.md docs/rendering.md docs/data-pipeline.md docs/data-flow.md docs/portability.md docs/guide | grep -viE "ndvi|svf|sky|horizon|markings|replaced|ersetzt"` → no matches.

### Step 5: Guide, codebook, comments

- `using-the-viewer.md` (en and de): delete the "no viewpoint yet" sentence;
  add the five missing viewpoints to the two lists (aerial: *Großer
  Garten*, *Blaues Wunder*, *Waldschlößchenbrücke*, *Hauptbahnhof*; eye
  level: *Palais im Großen Garten*), with a short description in each
  language taken from `sites/dresden.ts` `description` (DE is the source;
  translate for EN). Move the crown switch row to the Vegetation group with
  the label *Multi-Tuft-Kronen (nah)*.
- `how-it-works.md` (en `:23`, de `:24`): use data-journey's measured numbers.
- `docs/rendering.md:86,88,91`: the new pointers; `:39` "trunk + crown (three tiers: far, mid, rich)".
- `keyboard-controls.ts:8`: add Papier in the right place of the cycle.

**Verify**: `grep -rn "TERRAIN_NORMAL\|CONTOUR_INK\|DATA_POSITION\|GRASS_MOTTLE\|GRASS_NORMAL\|Detaillierte Kronen\|no viewpoint yet\|keinen Aussichtspunkt" docs .claude AGENTS.md` → no matches.

### Step 6: Pin the guide to the HUD (new test)

Create `lib/docs/guide-labels.test.ts` modelled on `lib/docs/content.test.ts`
(plain `bun:test`, `describe`/`test`, reads files with `node:fs`). For each
of `docs/guide/en/using-the-viewer.md` and `docs/guide/de/using-the-viewer.md`:
read the file, **collapse all whitespace runs to one space** (labels wrap
across lines, e.g. "*Brühlsche\n    Terrasse*"), then assert that every
`DRESDEN.viewpoints[].label` (`sites/dresden.ts`) and every
`LOOK_CONTROLS[].label` (`lib/city/look-controls.ts`) occurs. Report the
missing labels in the failure message (`expect(missing).toEqual([])`).

Check that importing `sites/dresden.ts` from a `lib/docs` test does not
trip `lib/city/purity.test.ts` (it only scans `lib/city`; it should not).

**Verify**: `bun test ./lib/docs` → all pass, including the new tests. Then
temporarily delete one viewpoint name from the EN guide, re-run, see it
fail naming that label, and restore it.

### Step 7: Dependabot, CI path list, lockfile

- `dependabot.yml`: `lint-and-format.patterns: [oxlint, oxfmt, oxlint-tsgolint]`;
  `three` group: remove `postprocessing` and `n8ao`, add `3d-tiles-renderer`,
  rewrite the comment (three-mesh-bvh, the CityJSON loader and
  3d-tiles-renderer peer on `three`; a solo bump is a version skew). Add:

  ```yaml
  - package-ecosystem: uv
    directory: /pipeline
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 3
  ```
- `ci.yml`: add `docs` to the path list of the "Decide whether the e2e half
  has to run" step, and fix the comment above it that counts docs among the
  paths that cannot affect e2e.
- `package.json`: remove `"unrs-resolver"` from `trustedDependencies`. Run
  `bun install`. If `bun.lock:6` still says `"activity-card"`, change it by
  hand to `"bridge"` and run `bun install --frozen-lockfile` — it must pass
  without changes.

**Verify**: `bun install --frozen-lockfile` → exit 0;
`python3 -c "import yaml,sys;yaml.safe_load(open('.github/dependabot.yml'));yaml.safe_load(open('.github/workflows/ci.yml'))"` → no error
(if `python3` lacks yaml, use `uv run --project pipeline python -c …`).

### Step 7b: Coverage as a CI artifact, untested files included (from plan 008)

Bun's coverage report lists only files some test imports — `create-app.ts`,
`post-stack.ts`, `stylize-effect.ts`, `prepare-data.ts` and the soundscape
(≈ 6 600 lines) are simply absent, so a plain lcov would read ≈ 86 % while
the riskiest modules do not appear at all.

1. In the `bunfig.toml` from step 1 (create it if step 1 dropped it), add
   under `[test]`: `coverageReporter = ["text", "lcov"]` and
   `coverageDir = "coverage"` (check the key names with
   `bun test --help`; `coverage/` must be gitignored — add it if not).
2. `scripts/coverage-gaps.ts`: reads `coverage/lcov.info`, lists every
   `app/_components/**/*.ts(x)`, `lib/**/*.ts` and `scripts/*.ts` source
   (not tests) that has no `SF:` entry, and prints them with their line
   counts as a Markdown table (for `$GITHUB_STEP_SUMMARY`). A unit test
   with a tiny fake lcov and file list.
3. `ci.yml`, unit job: `bun run test:coverage`, then
   `bun scripts/coverage-gaps.ts >> "$GITHUB_STEP_SUMMARY"`, then upload
   `coverage/` with `actions/upload-artifact` (match the version the e2e
   job already uses). No threshold — this is a report, not a gate.

**Verify**: `bun run test:coverage` → writes `coverage/lcov.info`;
`bun scripts/coverage-gaps.ts` lists `app/_components/create-app.ts`;
`git status` shows no `coverage/` files.

### Step 7c: Relative links in docs/ resolve (new test)

Plans get condensed and deleted (docs/plans/README.md, "Lifecycle"), and
nothing checks the links pointing at them. In `lib/docs/` add a test that
walks every `*.md` under `docs/` (and `AGENTS.md`), extracts the relative
link targets with `linkTargets` (`lib/docs/content.ts`), resolves each
against the file's folder (drop `#anchors` and `http(s):`/`mailto:`
targets), and asserts the target file exists. Report all misses in one
failure message.

**Verify**: `bun test ./lib/docs` → passes; temporarily break one link in
a plan → fails naming file and target; restore.

### Step 8: Diagrams and gate

Run `bun run docs:diagrams` (Mermaid blocks changed in data-pipeline.md,
data-flow.md, rendering.md and both data-journey.md). Then `bun run fix`
and `bun run verify`.

**Verify**: `bun run verify` → exit 0; `bun test ./lib/docs` → all pass
(the diagram freshness test fails if an SVG was not regenerated).

## Test plan

- New: `lib/docs/guide-labels.test.ts` — viewpoints and look-control labels
  in both guide languages; failure lists the missing labels.
- Existing: `lib/docs/diagrams.test.ts` proves the SVGs match the Mermaid
  sources after Step 8.

## Done criteria

- [ ] `bun run verify` exits 0
- [ ] `bun test ./lib/docs` passes, including `guide-labels.test.ts`
- [ ] `grep -rnE '^\s*bun (build|test)\b' AGENTS.md README.md docs --include=*.md | grep -v plans/` → no matches
- [ ] `grep -n "https://localhost\|ignoreHTTPSErrors" playwright.config.ts README.md` → matches in both
- [ ] `grep -n "320" .claude/skills/city-walker/SKILL.md` → the new cache numbers
- [ ] `grep -n "n8ao\|postprocessing" .github/dependabot.yml` → no matches
- [ ] `bun install --frozen-lockfile` exits 0; `grep -n activity-card bun.lock` → no matches
- [ ] `bun scripts/coverage-gaps.ts` runs after `bun run test:coverage`; CI's unit job uploads `coverage/`
- [ ] the docs link test exists and passes
- [ ] `git status` shows only in-scope files changed

## STOP conditions

- `bun run docs:diagrams` cannot start a browser in your environment →
  stop after Step 7 and report; do not hand-edit SVGs.
- The guide test reveals look-control labels missing from the guide beyond
  the ones this plan names → add them to both guides only if the HUD label
  is unambiguous; otherwise stop and list them.
- `bun install` changes more than the header / trusted list of `bun.lock`
  (it re-resolves versions) → revert `bun.lock`, stop and report.

## Maintenance notes

- A new viewpoint or slider now fails `guide-labels.test.ts` until both
  guides name it — that is the point; the error message lists what to add.
- If the dev server ever goes back to HTTP, revert Step 2's scheme switch.
- Reviewers: check the EN and DE guide edits say the same thing.
