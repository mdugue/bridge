# Plan 096 [rewrite]: Every bake heuristic that guesses has a reference set and a score a bake PR must hold

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and `AGENTS.md`
> first, then the `new-bake-step` and `docs-upkeep` skills. This plan
> builds a harness and scores two families of heuristics as the pattern;
> it changes no heuristic. One pull request a phase. Run each phase's
> **Verify** before the next. On a STOP condition, stop and report.
> When done, update this plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- scripts/eval pipeline/bake/canopy.py pipeline/bake/trees.py pipeline/bake/allometry.py pipeline/bake/landcover.py pipeline/bake/landcover_osm.py pipeline/bake/spec.py pipeline/bake/__main__.py scripts/pipeline.ts docs/routines.md .claude/skills/model-faults`
> If a file under *Current state* no longer matches, find the symbol by
> name; if it is gone, that is a STOP condition.

## Status

- **Priority**: P3 — runs beside the series, blocks nothing
- **Effort**: M a family; two families here, the rest open-ended
- **Risk**: LOW for the harness; MED that a score is trusted further
  than its reference deserves
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (the ledger's
  form, the plates). Before
  [088](./088-rewrite-tiles-as-a-data-product.md) the references are
  read from the maintainer's raw cache; after it, from beside the
  published data
- **Category**: rewrite — less complexity (fewer rules nobody can
  weigh), and quality
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: REJECTED (2026-11-24, the series closed): its row in
  [README.md](./README.md) says what holds. As it stood before:
  TODO

## Why this matters

What the twin draws beyond its sources is guessed by rules: which LoD2
roof misses the scan and what form it takes instead, where a dormer
sits, how wide a crown is, which wall is glass, what the ground is
where a Land publishes no land-cover model. The rules are hand-tuned
and many: counted on 2026-11-16 as module-level constants
(`grep -cE "^[A-Z][A-Z0-9_]* = "`), `roofs.py` has 54, `dormers.py`
72, `canopy.py` 26, `windows.py` 24. The tests in `pipeline/tests/`
hold each rule to its intent on synthetic cases; nothing says how often
a rule is *right* on a city, so nobody can tell a rule that earns its
lines from one that could go, and a bake PR that "improves the roofs"
is judged by the three places its author looked at.

After this plan a family of guesses has a number a bake PR must hold or
explain, and a way to find the constants that move nothing. That is the
series' third aim — less to hold in the head — applied to the bakes.

## Current state

**What is scored today, once and by hand.**

- `scripts/eval/kataster-eval.py` — the tree register (Dresden's
  street-tree cadastre, the raw WFS cache
  `data/_raw/sn/trees/<tile>.geojson`) against the canopy points the
  surface model yields (`data/dresden/dlm/canopy_<tile>.geojson`). It
  prints, and with `--json OUT` writes: the share of register trees
  with a canopy point (`overlap`), heights (`height_stats`), leaf-off
  NDVI as a leaf-type classifier (`classifier`, `auc`), archetype
  coverage. Recorded in `docs/transformations.md` ("Tree inventory"):
  31 % of register trees have a canopy point (21 % on the spawn tile);
  where both exist heights differ by a 2.8 m median, r = 0.72; NDVI
  reaches AUC 0.87 but 6.5 % precision for "evergreen". Run as
  `uv run --with numpy --with scipy --with pillow python
  scripts/eval/kataster-eval.py`.
- `pipeline/bake/landcover_osm.py` against the Basis-DLM's raster on
  Leipzig's centre tile: 71 % of texels agree — water 95 %, settlement
  78 %, roads 55 % (`docs/transformations.md`, `docs/portability.md`).
  No script is committed for it.
- `pipeline/bake/ndvi.py` (`_gli`): the vegetation index from visible
  bands, r ≈ 0.7 against the NDVI on NRW's RGBI. No script.
- Window axes (plan 075's record in `docs/plans/completed.md`): two
  drives of street photos agree within 0.25 m in ≈ 60 % of confident
  pairs. No script.
- `scripts/eval/compare-bakes.py` compares two bakes of the vegetation
  files by content; `kataster-cost.ts`, `season-cost.ts` and
  `kataster-perf.ts` measure cost, not correctness.

**What is tested, not scored.** `pipeline/tests/` — 74 test files;
`test_roofs.py` has 37 tests, `test_dormers.py` 43 — on synthetic
rasters and small fixtures; `test_committed.py` checks that committed
files agree with each other. A green run says the rules do what they
were written to do.

**What looks at the real city.** The weekly routine *Modellfehler aus
Straßenfotos* (`docs/routines.md`, the `model-faults` skill): six to
eight Panoramax photos beside renders from the same pose, differences
noted by category (roof form, height and storeys, facade, missing or
invented), and what recurs proposed as a change to a general rule. Its
rule, the maintainer's: "correct the general heuristic, never the
single building." Its findings live as comments on a GitHub issue;
nothing keeps them as cases a later change is held to.

**Decisions this plan must keep.**

- ADR 0036, 7: "Every rule is general. No list of buildings, no
  per-building fix."
- ADR 0060: the image model runs at fetch time only; "the photos' glass
  is the material only where no source names one" — so the objects OSM
  tags `building:material=glass` are never decided by the model, and
  can check it.
- ADR 0012: official data first; a stand-in is named per city.
- AGENTS.md: raw downloads (`data/_raw/`) are never committed; photos
  are never committed (CC BY-SA, linked with their author); a bake
  reads the network only at fetch time.

**How a bake is pointed somewhere else.** `scripts/pipeline.ts` writes
one JSON spec; `pipeline/bake/spec.py` reads `raw` (`data/_raw/<provider>`)
and `data` (`data/<site>`) from it, and every step writes under
`tile.data`. `BAKE_CACHE=0` runs steps and records nothing.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Pipeline tests | `bun run test:pipeline` | pytest and ruff pass |
| One step, one tile | `bun run bake dresden 33412_5656_2_sn --step canopy` | the step's files written |
| Today's tree evaluation | `uv run --with numpy --with scipy --with pillow python scripts/eval/kataster-eval.py --json /tmp/k.json` | JSON written (needs the raw register cache) |
| Gate | `bun run fix && bun run verify` | exit 0 |

## Scope

**In scope**:

- `scripts/eval/scores.py` (the runner), `scripts/eval/score_*.py`
  (one module a family), their tests under `pipeline/tests/`
- `qa/scores.json` (create, generated), `qa/cases/` (create: small
  hand-kept case lists)
- `scripts/eval/kataster-eval.py` (its figures move into a score
  module; the file stays as the long report or goes)
- `.github/workflows/ci.yml` (one check), `package.json` (a script)
- `docs/routines.md`, the `model-faults` and `new-bake-step` skills,
  `docs/transformations.md` (the entries that quote a figure), a new
  ADR

**Out of scope**:

- Changing any heuristic or constant. A score that is poor is recorded;
  the fix is its own PR, held to the score.
- A fix for one building, in any form (ADR 0036).
- Committing raw data, photos or a model's weights.
- Labelling at scale. No family gets more than fifty hand labels here.
- A new Python dependency. Ask first if a score needs one.

## The pattern: score against a source the rule did not read

A hand-labelled truth is expensive and goes stale. Most guesses here
have a cheaper judge: **another open source that measures the same
thing and that the rule was not allowed to read.** The register knows
where trees stand; the canopy detection does not read it. The DLM knows
the land cover; the OSM stand-in does not read it. OSM's glass tags are
never overruled by the image model. So a score is: withhold source B,
run the rule on source A, count how well it finds B.

Three properties every score has, stated in its module's head comment:

1. **What it is blind to.** A register lists street trees, not garden
   trees: recall against it is meaningful, precision is not.
2. **Where it can run.** Only on a site that has both sources
   (`Site.treeCadastre`, `Provider.products.dlm`).
3. **Its noise.** Deterministic on fixed inputs, so the gate is exact
   after rounding; what moves it is a new edition of either source,
   which a re-bake records as a new baseline.

## Phases

### Phase 1 — The harness, and the trees as its first family

1. `scripts/eval/scores.py`: `--family <name>`, `--site <id>`,
   `--write` (writes `qa/scores.json`), `--check` (recomputes the
   families whose inputs are on disk, exits 1 naming each score that
   fell). A family is a module `score_<name>.py` with one function that
   returns `{score: value}` and a declaration of its inputs (paths
   under `data/<site>/` and under `data/_raw/`) and of the bake modules
   it judges. Run through `uv run --project pipeline`, so it uses the
   pinned packages. Add `"scores": "…"` to `package.json`.
2. `score_trees.py` from `kataster-eval.py`'s functions: register
   recall of the canopy detection (all tiles, and the spawn tile),
   recall by land-cover class, the height's median absolute difference
   and r. Judges `pipeline/bake/canopy.py`.
   The allometry (`pipeline/bake/allometry.py`, fitted on Dresden's and
   Leipzig's registers together) gets a hold-out of its own: fit on one
   city, score the height error on the other.
3. `qa/scores.json`: per family and site the scores, the inputs'
   content hashes, the date, the judged modules.

**Verify**: `bun run scores -- --family trees --site dresden --write`
then `--check` → exit 0; the recall equals `docs/transformations.md`'s
31 % and 21 % within one point (the register's cache may be a newer
edition: if it differs by more, record the edition and the new
baseline, and say so in the PR). `bun run test:pipeline` → pass.
**Ledger (087)**: the count of scored families (1) and of module-level
constants in the modules a score judges.

### Phase 2 — Land cover from OSM, the second family and the pattern

On a site whose Land publishes the Basis-DLM, bake the OSM stand-in
into a scratch folder and compare it with the committed DLM raster.

1. A scratch bake: a spec whose `data` is a temporary folder and
   `BAKE_CACHE=0`, running `landcover_osm`'s raster for the tile. If
   the step cannot be pointed there without touching `data/<site>/`
   (it reads other committed files by path), that is a STOP: do not
   write into the committed folder to work around it.
2. `score_landcover_osm.py`: agreement of class ids, overall and per
   class (the legend in `pipeline/bake/classes.py`), on Leipzig's
   centre tile (the tile of the recorded 71 %) and on Dresden's spawn
   tile. Judges `pipeline/bake/landcover_osm.py`.

**Verify**: the Leipzig figures within two points of 71 / 95 / 78 / 55
(the rule changed on 2026-10-21, so they may have moved: record what is
measured, not what was). `--check` → exit 0.

### Phase 3 — The gate

A score needs raw inputs CI does not have. So CI checks what it can:
`scripts/eval/scores.py --stale` reads `qa/scores.json` and fails when
a PR changes a judged module (by the file list each family declares)
without changing that family's entry. The scores themselves are run
where the bakes run — on the maintainer's machine, with the re-bake —
and travel with the bake PR as `qa/scores.json`'s diff, as the data's
diff does today.

A score that falls is not forbidden: the PR says why in one line
(often: the reference is blind to what was fixed), and the reviewer
sees the number. Add the check to the `pipeline` job in `ci.yml`.

**Verify**: a branch that edits `canopy.py` alone → the check fails
and names `trees`; with `qa/scores.json` re-written → passes.

### Phase 4 — Constants that move nothing

For each scored family, an ablation: `scores.py --ablate <family>`
runs the judged step once per module-level constant with that rule
switched off or the constant at a neutral value, and lists the
constants whose removal moves no score. The list is a report in the
PR, not a change: each candidate is then checked on 087's plates
before a later PR deletes it. A constant a score cannot see (it shapes
the look, not the count) is marked so and left.

**Verify**: the report lists every constant of the judged module with
its effect; a constant known to matter (the canopy's lowest crown,
`MIN_H` in `canopy.py`) moves the score. **Ledger**: constants reported as without effect.

### Phase 5 — Cases from the weekly routine

Some guesses have no second source: a roof's form, a dormer, a facade's
ornament. For those the judge stays a person with a photo — the
`model-faults` routine. This phase makes its findings last:

- `qa/cases/<family>.json`: one record a confirmed finding — the site,
  the LoD2 object id, the category, what is expected in one checkable
  field (`roofForm: "gable"`, `levels: 4`, `dormers: 3`), the photo's
  link and author. No photo, no pixel.
- `score_cases.py`: the share of a family's cases the current bake
  gets right. It is a regression list, not a statistic: fifty cases say
  nothing about a city. It never becomes a table the bake reads; ADR
  0036's rule stands, and a test asserts that no file under
  `pipeline/bake/` opens `qa/cases/`.
- The `model-faults` skill and `docs/routines.md` gain one step: a
  finding the maintainer confirms is appended as a case, and a proposal
  quotes the scores before and after.

**Verify**: `bun run scores -- --family cases-roofs --check` → exit 0
on an empty list; a case added by hand with a wrong expectation →
exit 1. `grep -rn "qa/cases" pipeline/bake` → nothing.

### Phase 6 — The records, and what is next

- A new ADR, numbered as `docs/adr/README.md` says under "Numbering":
  a bake step that guesses names its score or says why it has none; a
  judged module's PR carries `qa/scores.json`; cases are never inputs.
- The `new-bake-step` skill's checklist gains that line.
- `docs/transformations.md`: the entries that quote a figure point at
  the score that now produces it.
- Candidates for later, each cheap by the pattern and none built here:
  glass (the image model against OSM's `building:material=glass`
  objects, ADR 0060); window axes (one drive withheld,
  `pipeline/bake/window_axes.py`); storeys (the guess against
  `building:levels` where OSM maps it, `osm_buildings.py`); the
  vegetation index from visible bands against the NDVI where a flight
  has infrared (`ndvi.py`). List them in this file's Findings with the
  order the maintainer picks.

**Verify**: `bun run verify` and `bun test lib/docs` → exit 0.

## Test plan

- `pipeline/tests/test_scores.py`: the runner on a synthetic family
  (two inputs, a known score); `--check` fails on a lower score and
  passes on an equal one; `--stale` on a fake file list. Model after
  `pipeline/tests/test_step_cache.py`.
- A test per score module on a small synthetic pair (ten register
  trees, six found), as `test_canopy.py` builds its rasters with
  `pipeline/tests/synthetic.py`.
- The case reader: a malformed record is an error naming the file.

## Done criteria

- [ ] `bun run scores -- --check` exits 0 on a machine with the raw
  cache; `qa/scores.json` holds `trees` and `landcover-osm`
- [ ] `scripts/eval/scores.py --stale` runs in CI's `pipeline` job and
  fails a judged module changed without its entry
- [ ] `grep -rn "qa/cases" pipeline/bake` returns nothing, and a test
  holds it
- [ ] The ablation report exists for both families
- [ ] The ADR is written; `new-bake-step`, `model-faults` and
  `docs/routines.md` say what changed
- [ ] `bun run test:pipeline` and `bun run verify` exit 0
- [ ] The row in `docs/plans/README.md` updated

## STOP conditions

- A score cannot be reproduced within its stated band on the same
  inputs: it is not deterministic. Find the cause (an unordered set, a
  clock) before anything gates on it.
- The reference for a family turns out to be read by the rule it should
  judge (the `trees` step merges the register into its output): score
  the part that does not read it, or drop the family and say so.
- A scratch bake would have to write into `data/<site>/`.
- A proposed case names a building in a way a bake could key on, or
  someone asks to read `qa/cases/` from a bake: stop; that is the
  per-building fix ADR 0036 forbids.
- A reference source's licence does not allow a derived table to be
  kept (a register's terms): keep only the score, never the table.

## Maintenance notes

- A score describes the reference's city. Dresden's register says
  little about Munich; a family lists the sites it ran on, and a new
  site with both sources is a new row, not a new rule.
- When a reference gets a new edition (the Open-Data-Wächter reports
  it), the baseline moves with the re-bake; the PR shows both.
- Do not chase a score past its blindness. Canopy recall against a
  street-tree register rises if every lamp post becomes a tree.
- What cannot be scored cheaply and is not here on purpose: dormers,
  ornament, roof colour's truth, a mural's likeness. They stay with the
  plates and the weekly photos.

## What the series changes about this plan

Built alone, this plan would have to commit its reference tables under
`data/<site>/` beside the bakes, or leave every score to the
maintainer's machine for good. With 088 the references sit beside the
published data and CI can run `--check` itself for the families whose
inputs are published; Phase 3's `--stale` check is the stand-in until
then. With 092 a score reads the site-wide tables through one reader
instead of globbing a tile's files, and a new edition is one diff of
a table. With 089 the score modules are type-checked with the bakes if
they move into the package. And 087's plates are what make Phase 4
safe: a constant that moves no score is deleted only when it also
moves no picture.
