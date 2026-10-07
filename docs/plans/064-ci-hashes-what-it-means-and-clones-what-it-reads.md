# Plan 064: CI hashes the repo, not `node_modules`; the jobs that never read `data/` do not clone 811 MB of it; the shard comments say the measured numbers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- .github/workflows/ci.yml e2e/city-walk.spec.ts AGENTS.md`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (step 1, 3), MED (step 2: a sparse checkout that drops a
  folder a job *does* read fails that job — the done criteria run the
  jobs)
- **Depends on**: none
- **Category**: dx (CI)
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

Three measured facts about `.github/workflows/ci.yml` at `4b0310a`:

1. **The Next-cache key hashes `node_modules`.** The restore and save
   keys use `hashFiles('**/*.ts', '**/*.tsx', '**/*.css')`, evaluated after
   `bun install`, so the glob walks `node_modules`: in this container
   **11 541** matching files there against **476** in the repo — 24× the
   work, twice per shard, for a key that already carries `bun.lock`.
2. **Every job clones the geodata.** The workflow comment says "the repo
   carries ~130 MB of committed geodata"; `du -sh data` is **811 MB**
   (Dresden alone 460 MB; pack 617 MiB). Seven jobs check out; the lint,
   typecheck and pipeline jobs never read `data/` (the pipeline tests
   only hold path strings — `test_committed.py` reads `data/*/dlm`, so the
   **pipeline job does** read it; see step 2). The two CI runs on `main`
   the audit could read (2026-10-06 14:07, `37476256017`) show
   `actions/checkout` at 3m13s–3m25s in the e2e jobs.
3. **The shard numbers are stale.** The comment cuts the e2e shards by
   "whole site ~100 s, desktop HUD ~135 s, rendering ~85 s + phone ~40 s";
   the same run measured **149 s / 220 s / 340 s** for the Playwright
   step, 12m58s wall clock for the longest job against a 20-minute cap.
   AGENTS.md's rule "keep the shards within a minute of each other" is
   off by three minutes. The build comment "with the caches below that is
   ~15 s" measured 2m23s–3m24s (a cold bake; plan 061 addresses the cache
   misses).

Step 1 is a pure win. Step 2 is one line per job for lint and typecheck
(sparse checkout excluding `data/`); the pipeline job keeps the data. Step
3 re-cuts the shards and writes the measured numbers with their date.

## Current state

`.github/workflows/ci.yml`:

- `:18-30` lint, `:32-44` typecheck, `:46-66` unit, `:72-86` pipeline —
  each starts with `- uses: actions/checkout@v7` (no options).
- `:119-124` the e2e checkout:

```yaml
      - uses: actions/checkout@v7
      # One extra commit, not the whole history: the repo carries ~130 MB of
      # committed geodata, so a deep clone is not free.
      - name: Fetch the PR base commit
```

- `:186-192` and `:208-212` the Next cache:

```yaml
      - uses: actions/cache/restore@v6
        if: steps.scope.outputs.run == 'true' || matrix.shard.buildCheck
        with:
          path: .next/cache
          key: nextjs-${{ runner.os }}-${{ hashFiles('bun.lock') }}-${{ hashFiles('**/*.ts', '**/*.tsx', '**/*.css') }}
          restore-keys: |
            nextjs-${{ runner.os }}-${{ hashFiles('bun.lock') }}-
            nextjs-${{ runner.os }}-
```

```yaml
      - uses: actions/cache/save@v6
        if: matrix.shard.buildCheck && github.event_name == 'push'
        with:
          path: .next/cache
          key: nextjs-${{ runner.os }}-${{ hashFiles('bun.lock') }}-${{ hashFiles('**/*.ts', '**/*.tsx', '**/*.css') }}
```

- `:88-104` the shard comment and matrix:

```yaml
  # … The shards are cut by measured time (the Playwright step on
  # CI, Sept 2026): the whole site with the shell and /wissen ~100 s, the
  # desktop HUD group ~135 s, the rendering group ~85 s and the phone ~40 s.
  # Each shard builds for itself; with the caches below that is ~15 s.
  …
      matrix:
        shard:
          - name: whole site, shell, docs
            args: --grep-invert "@desktop|@phone"
            buildCheck: true
          - name: desktop HUD
            args: --grep @desktop-hud
            buildCheck: false
          - name: desktop rendering, phone
            args: --grep "@desktop-render|@phone"
            buildCheck: false
```

`e2e/city-walk.spec.ts`: `test.describe("desktop viewer", { tag: "@desktop-hud" }, …)`
at `:392`, `test.describe("desktop viewer, rendering", { tag: "@desktop-render" }, …)`
at `:880`, `test.describe("mobile", { tag: "@phone" }, …)` at `:1232`.
`e2e/wissen.spec.ts`, `e2e/legal.spec.ts` and the untagged tests of
`city-walk.spec.ts` form the first shard.

AGENTS.md "QA: self-verify": "CI splits the suite over **three runners**
… keep the shards within a minute of each other."

What each job reads from `data/`: the unit job (`lib/city/tile.test.ts`,
`features.test.ts`, `ground-joins.test.ts`, … walk `data/**`), the
pipeline job (`test_committed.py` → `data/*/dlm`), the e2e jobs (the build
bakes `data/<site>/`). Lint (`oxlint`, `oxfmt`; `data/**` is in
`.oxlintrc.json`'s `ignorePatterns`) and typecheck (`tsc` over `**/*.ts`;
`data/` has no `.ts`) do not.

Conventions: comments in the workflow explain the *why* with the measured
number and its date; actions pinned by major tag (decided); the required
status check is "E2E (Playwright)" (`e2e-result`), so the shard names
may change but that job's name may not.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate the YAML | `bun -e 'import { readFileSync } from "node:fs"; import { parse } from "yaml"; parse(readFileSync(".github/workflows/ci.yml","utf8")); console.log("ok")'` — only if a `yaml` package resolves; otherwise `python3 -I -c 'import yaml,sys; yaml.safe_load(open(".github/workflows/ci.yml")); print("ok")'` (PyYAML may be absent: then rely on CI) | `ok` |
| Count the shard tests locally | `bunx playwright test --list --grep @desktop-render \| tail -1` | a count |
| The gate (unchanged code) | `bun run verify` | exit 0 |
| The real check | a PR run of the workflow (push the branch, read the job times) | all jobs green |

There is no local way to run GitHub Actions here; the done criteria are
read off the PR's run.

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml`
- `e2e/city-walk.spec.ts` (tags only — moving a `test.describe`'s tag or
  splitting one describe into two)
- `AGENTS.md` (the shard sentence in "QA: self-verify")

**Out of scope** (do NOT touch, even though they look related):
- The bake cache key (`prepare-data-…`, `:178`) — plan 061 fixes the
  misses from the inside; the restore key stays coarse by design.
- SHA-pinning the actions, dependency caching for `bun install`, a
  `.env.example` — rejected before (index: rejected list).
- `playwright.config.ts` — one worker on CI is deliberate.
- The e2e tests' bodies.

## Git workflow

- Branch: the branch you were given, or `plan/064-ci-keys-and-clones`.
- One commit per step, Conventional Commits, `ci: …`.
- Push and open a PR **only if** the operator instructed it — the done
  criteria need a run, so say so in your report if you could not push.

## Steps

### Step 1: The Next-cache key hashes the repo's sources

Replace both `hashFiles('**/*.ts', '**/*.tsx', '**/*.css')` with a
pattern list that cannot reach `node_modules`:

```yaml
hashFiles('app/**/*.ts', 'app/**/*.tsx', 'app/**/*.css', 'app/**/*.mdx', 'components/**/*.tsx', 'hooks/**/*.ts', 'lib/**/*.ts', 'sites/**/*.ts', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'mdx-components.tsx')
```

(the same string in the restore and the save step — keep them identical;
a comment above the restore: "the repo's sources only: a bare `**/*.ts`
walks node_modules — 11 500 files against 480 — after `bun install`").

**Verify**: `grep -c "hashFiles('\*\*/\*.ts'" .github/workflows/ci.yml` → `0`;
the two keys are byte-identical (`grep -n "nextjs-" .github/workflows/ci.yml`).

### Step 2: Lint and typecheck check out without `data/`

For the `lint` and `typecheck` jobs only:

```yaml
      - uses: actions/checkout@v7
        with:
          # These jobs never read data/ (811 MB of geodata, 2026-10-06):
          # a sparse checkout of everything else.
          sparse-checkout: |
            /*
            !/data/
          sparse-checkout-cone-mode: false
```

Leave `unit`, `pipeline` and `e2e` as they are (they read it). Fix the
e2e comment at `:120-122`: "the repo carries ~810 MB of committed geodata
(2026-10-06; seven sites)".

**Verify**: on the PR run, the Lint and Typecheck jobs are green and their
checkout step is shorter than the unit job's (read the job logs);
`bun lint` and `bun typecheck` need nothing under `data/` locally either:
`mv data /tmp/data-aside && bun lint && bun typecheck; mv /tmp/data-aside data`
→ both exit 0 (restore the folder whatever happens).

### Step 3: The shards are re-cut and the comment says what was measured

1. Measure: with the three shard times from the last `main` run on the
   Actions tab (the Playwright step's duration per shard), pick the move
   that evens them. At `4b0310a` the rendering+phone shard (340 s) is
   twice the first (149 s): move the `@phone` group to the first shard
   (`--grep-invert "@desktop"` for shard 1, `--grep "@desktop-render"` for
   shard 3), or, if `@phone` alone does not even them, also move the Modell
   tests out of `@desktop-render` into a new tag `@desktop-model` on the
   first shard. Read `e2e/city-walk.spec.ts:880-1232` to see which tests
   sit in the rendering group and how long each takes (the HTML report of
   the run lists per-test durations).
2. Edit the matrix and the tags accordingly; keep `e2e-result`'s name.
3. Rewrite the shard comment with the measured durations **and the date**
   of the run they came from, and the build comment's "~15 s" with the
   measured warm and cold times.
4. AGENTS.md: the sentence "keep the shards within a minute of each
   other" stays; add "(measured on CI, see the workflow's comment with its
   date)".

**Verify**: a PR run where the three Playwright steps are within ~60 s of
each other, every shard green, "E2E (Playwright)" green.

## Test plan

- No unit tests: the workflow is verified by its run. Locally, step 2's
  move-aside check shows lint and typecheck need no `data/`.
- Verification: the PR's run — all jobs green, shard times recorded in
  the status row.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "'\*\*/\*.ts'" .github/workflows/ci.yml` → `0`
- [ ] `grep -c "sparse-checkout" .github/workflows/ci.yml` → `2` (lint, typecheck)
- [ ] `grep -n "~130 MB" .github/workflows/ci.yml` → no match
- [ ] the shard comment names a date in 2026-10 and three measured durations
- [ ] on the PR run: Lint, Typecheck, Unit, Pipeline and all three E2E shards green; "E2E (Playwright)" green
- [ ] the three Playwright step durations differ by less than ~60 s (record them in the status row)
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 064 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bun lint` or `bun typecheck` fails with `data/` moved aside (then a
  rule reads it — report which, and skip step 2 for that job).
- The sparse checkout syntax is rejected by the runner (`actions/checkout@v7`
  supports `sparse-checkout`; if the job logs say otherwise, report the
  error text).
- No run of the workflow can be obtained (no push rights): finish steps
  1–3 from the last run's numbers, say the run-dependent criteria are
  unverified, and stop.
- Re-tagging would split a `test.describe` that shares a booted page
  (`mode: "serial"` with a `beforeAll` context) — splitting it costs a
  second boot; report the trade-off instead of splitting.

## Maintenance notes

- When a shard grows past the others by a minute, move a tagged group;
  the comment's date says how stale the numbers are.
- A new job that reads `data/` must not copy the sparse checkout.
- The Next cache's pattern list is hand-kept: a new source folder at the
  repo root (beside `app`, `lib`, …) goes into it.
- Reviewer: compare the Lint job's total time before and after (the
  checkout step is the one that shrinks).
