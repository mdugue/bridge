# Plan 065: The reference docs say what the code does — the skill's single-provider frame and bake list, the ledger's and survey's done rows, the storage lists, `#at`, and one misplaced path

> **Executor instructions**: Follow this plan step by step; each step is
> one commit. Every change is prose or a table — verify each by the grep
> given, then run the docs tests. If anything in the "STOP conditions"
> section occurs, stop and report. When done, update the status row for
> this plan in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- .claude/skills/city-walker/SKILL.md AGENTS.md README.md docs/transformations.md docs/data-streams.md docs/adr/0001-client-only-static-app.md docs/adr/0003-bake-heavy-inputs-at-build-time.md docs/adr/0015-roof-colour-from-orthophotos-with-vibrance-lift.md docs/plans/048-spike-view-links-and-qa-views.md lib/docs/links.test.ts`
> If any of these changed since this plan was written, re-check each
> step's "today" sentence against the live file; a sentence already fixed
> is skipped, not re-done.
>
> **Ordering**: plan 058 edits AGENTS.md's QA knobs line and the guide's
> *Standort* sentences; this plan's step 5 edits the same AGENTS.md line
> for `?at` only if 058 has not landed — check first.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (058 overlaps one line; see Ordering)
- **Category**: docs
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

These are the docs an agent loads before touching geometry, the bakes or
the privacy claims, and each sentence below is actively wrong against
the code at `4b0310a` (confirmed by reading both):

1. `.claude/skills/city-walker/SKILL.md` — the "deep reference" — still
   says the data is EPSG:25833 and tiles are `33EEE_NNNN_2_sn`; three of
   the seven built cities are EPSG:25832 with `_nw`/`_by`/`_hh` suffixes.
   An agent that hard-codes zone 33 breaks them. Its bake-step list omits
   the `traffic` step and the site-wide `transit` step.
2. `README.md` says "Source data is EPSG:25833, Z-up" (twice) and "no
   backend, no database, no accounts, nothing persisted" while its own
   reports paragraph describes the stored trail; ADR 0001's 2026-10-03
   amendment lists the storage keys and omits `gpu-safety` (ADR 0046,
   three days later).
3. `docs/transformations.md`'s 📋 planned #15 ("The twin, next — ask
   trees, bridges and monuments too") was built 2026-10-01 (the same
   file's ✅ twin section says so); `docs/data-streams.md`'s ranking lists
   #5 (facade colour/material — built by plan 050), #7 (the "what am I
   looking at" card — ADR 0042) and #14 (passing trams — `tram-cars.ts`,
   ADR 0040) as open.
4. `AGENTS.md` places `reports-choice.tsx` / `report-choice.ts` under
   `app/(legal)/`; they live in `app/_components/`. The QA knobs list
   omits the arrival hand-off (`?at=` today, `#at=` after plan 058).
   Plan 048's text says "the URL reads are `scene`, `gpu`, `block` and
   `trail`" — `safety` (ADR 0046) and `at` are missing.
5. ADR 0003 ("accepted") points at `lib/city/heightfield.ts` and
   `scripts/bake-heightfield.ts` (gone since ADRs 0024/0030); ADR 0015 at
   `scripts/extract-roof-colour.sh` (now `pipeline/bake/roof_colour.py`).
   `lib/docs/links.test.ts` checks Markdown link targets only; backtick
   paths are stripped — which is why none of this fails a test.

## Current state

- `.claude/skills/city-walker/SKILL.md:346-362` ("Coordinate frame
  (critical)"): "Data is EPSG:25833 (UTM33), Z-up. … Tiles `33EEE_NNNN_2_sn`
  (the site's `tileSuffix`, `sites/`); `33412_5656_2_sn` is the spawn
  tile." and `:8` "walk through Dresden from Saxon open geodata".
  `:806-814` the bake command block:

  ```
  bun run bake dresden --step canopy     # one step (STEPS in pipeline/bake/__main__.py, in this order):
                                         #   landcover islands rail canopy trees ndvi roof-colour
                                         #   osm-buildings lamps monuments furniture walls stairs surface edges
                                         #   markings sport tram riverside roofs skyview soundmarks
                                         #   lowveg cultivated small-buildings
                                         #   landmarks structures
  ```

  The code (`pipeline/bake/__main__.py:43-102`): `… tram riverside traffic roofs skyview soundmarks …`
  and `SITE_STEPS = ("transit",)`, run once for the site after every tile.
- `README.md:16` "… no backend, no database, no accounts, nothing
  persisted."; `:122` "**EPSG:25833**. The viewer streams every tile…";
  `:179` "Source data is EPSG:25833, Z-up; a parent …". The correct
  statement is AGENTS.md's "Coordinate system" paragraph: EPSG:25833 for
  Saxony and Berlin, 25832 for Hamburg, Bavaria and NRW (the provider
  sets it).
- `docs/adr/0001-client-only-static-app.md:48-66` (the amendment): "What
  the page keeps in local storage: the crash trail …, the visitor's "no"
  to the reports, the last picture style, the toolbar's fold, the
  dismissed control hints; in session storage the view a GPU recovery
  returns to. The privacy page, `/datenschutz`, lists the same."
- `docs/transformations.md` ≈ `:2471-2473`: "📋 15. The twin, next — ask
  trees, bridges and monuments too …" (grep `The twin, next`).
- `docs/data-streams.md` ≈ `:165-177`: rows #5, #7, #14 (grep
  `Facade colour`, `What am I looking at`, `passing trams`).
- `AGENTS.md:331` (in the `app/(legal)/` bullet): "`<ReportsChoice />` in
  the privacy page is the reports' opt-out switch (`reports-choice.tsx`,
  kept by `report-choice.ts`)". AGENTS.md "QA: self-verify": "URL knobs:
  `?scene=lite` …, `?gpu=webgl2` …, `?safety=N` …, `?trail=1` …".
- `docs/plans/048-spike-view-links-and-qa-views.md` (grep `URL reads are`).
- `docs/adr/0003-…md` (grep `heightfield`), `docs/adr/0015-…md` (grep `extract-roof-colour`).
- `lib/docs/links.test.ts` — the link test; its `withoutCode` strips
  backtick spans before checking.

Conventions: prose is hand-wrapped Markdown (oxfmt excludes `*.md`);
ADR decision text is never edited — a stale "References" line gets a
"superseded by"/"now" note, the decision stays; the ledger's statuses are
✅ 🧪 📋 🗃️; the guide is bilingual (not touched here). Commit style
`docs(…): …`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Docs tests | `bun test lib/docs` | pass (links resolve, guide labels, docs matrix) |
| Site docs matrix (unchanged) | `bun run docs:matrix && git diff --stat docs/guide` | no diff |
| The gate | `bun run verify` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `.claude/skills/city-walker/SKILL.md` (the two passages)
- `README.md` (three sentences)
- `docs/adr/0001-client-only-static-app.md` (one list), `docs/adr/0003-…md` and `docs/adr/0015-…md` (a "now" note under References)
- `docs/transformations.md` (one row's status), `docs/data-streams.md` (three rows)
- `AGENTS.md` (one path, one knob)
- `docs/plans/048-spike-view-links-and-qa-views.md` (one sentence)
- `lib/docs/links.test.ts`, `lib/docs/links.ts` (optional step 7)

**Out of scope** (do NOT touch, even though they look related):
- The guide (`docs/guide/**`) — plan 058 edits its *Standort* sentences;
  nothing else here is user-facing.
- ADR decision paragraphs — only the References get a note.
- `docs/plans/README.md` beyond your own status row — the index is
  reconciled by the audit that wrote this plan.
- The privacy page — plans 058/059.

## Git workflow

- Branch: the branch you were given, or `plan/065-docs-currency`.
- One commit per step, `docs(skill): …`, `docs(readme): …`, `docs(adr): …`, `docs(ledger): …`, `docs(agents): …`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The skill's frame is per provider; its bake list is complete

In `SKILL.md`'s "Coordinate frame (critical)": replace "Data is
EPSG:25833 (UTM33), Z-up." with "Data is ETRS89/UTM, Z-up — EPSG:25833
(zone 33) for Saxony and Berlin, EPSG:25832 (zone 32) for Hamburg,
Bavaria and NRW; the provider sets it (`sites/providers.ts`, `Provider.epsg`)
and every path takes it from the site." Replace "Tiles `33EEE_NNNN_2_sn`
(the site's `tileSuffix`, `sites/`); `33412_5656_2_sn` is the spawn tile."
with "Tiles are `<zone><EEE>_<NNNN>_2<suffix>` — the zone from the CRS,
the suffix the provider's (`_sn`, `_nw`, `_by`, `_hh`, `_be`); Dresden's
spawn tile is `33412_5656_2_sn`, Hamburg's tiles look like
`32564_5932_2_hh`." Line 8: "walk through a German city from its Land's
open geodata (Dresden is the reference)".

In the bake block: insert `traffic` after `riverside` and add a line
"`transit` runs once for the site after every tile (SITE_STEPS)".

**Verify**: `grep -n "EPSG:25833 (UTM33)" .claude/skills/city-walker/SKILL.md` → no match;
`grep -n "tram riverside traffic roofs" .claude/skills/city-walker/SKILL.md` → match;
`grep -n "transit" .claude/skills/city-walker/SKILL.md` → match.

### Step 2: README

- `:16`: "… no backend, no database, no accounts; nothing persisted but
  what the browser keeps for itself (the crash trail, a few preferences —
  all on `/datenschutz`)".
- `:122` and `:179`: EPSG per provider, as in step 1 (one clause each:
  "EPSG:25833 for Saxony and Berlin, 25832 for Hamburg, Bavaria and NRW").

**Verify**: `grep -c "EPSG:25833" README.md` → the two sites both now
mention 25832 beside it (`grep -c "25832" README.md` ≥ 2);
`grep -n "nothing persisted\." README.md` → no match.

### Step 3: ADR 0001's list and two References notes

- ADR 0001 amendment: after "the dismissed control hints" add the
  clause `, the device's GPU safety level ([ADR 0046](./0046-a-per-device-safety-ladder-for-gpu-loss.md))`
  (a link relative to `docs/adr/`, where it lands).
- ADR 0003 References: add a note reading "(2026-10: the heightfield
  and `bake-heightfield.ts` are gone — the terrain is a TIN per ADR 0030,
  baked by `scripts/bake-terrain-tin.ts`; the decision — bake heavy
  inputs at build time — stands)", with "ADR 0030" as a Markdown link to
  `0030-terrain-tin-and-wall-snap.md` (relative to `docs/adr/`).
- ADR 0015 References: "(now `pipeline/bake/roof_colour.py`, ADR 0025)".

**Verify**: `grep -n "ADR 0046" docs/adr/0001-client-only-static-app.md` → match;
`grep -n "bake-terrain-tin" docs/adr/0003-bake-heavy-inputs-at-build-time.md` → match;
`grep -n "roof_colour.py" docs/adr/0015-roof-colour-from-orthophotos-with-vibrance-lift.md` → match.

### Step 4: The ledger and the survey

- `docs/transformations.md`: the 📋 #15 row becomes ✅ with "built
  2026-10-01 (plan 052 phase 4; see the twin section above)" — or, if the
  ledger's convention is to delete a planned row once its ✅ exists, delete
  it and say so in the commit. Read the file's own header for the
  convention first.
- `docs/data-streams.md`: mark #5 "built (plan 050: `osmColourTint`)",
  #7 "built (ADR 0042)", #14 "built (`tram-cars.ts`, ADR 0040)" in the
  rows (a status column if the table has none — add "Status" with "open"
  on the others; the survey is referenced by the index as the feeder for
  new plans, so a status column is worth it).

**Verify**: `grep -n "The twin, next" docs/transformations.md` → no match
or a ✅ row; `grep -c "built" docs/data-streams.md` ≥ 3.

### Step 5: AGENTS.md and plan 048

- Move the `<ReportsChoice />` sentence's file names: "(`app/_components/reports-choice.tsx`,
  kept by `app/_components/report-choice.ts`)".
- The QA knobs line: if plan 058 has landed, it already names `#at=lat,lng`
  — skip; else add "`?at=lat,lng` (the off-site dialog's hand-off to
  another city's page; dropped after the first frame)".
- Plan 048: "the URL reads are `scene`, `gpu`, `block`, `safety`, `trail`
  and `at` (the arrival hand-off, `lib/city/geolocation.ts` — the spike
  should extend that read rather than add a parallel one)".

**Verify**: `grep -n "app/_components/reports-choice.tsx" AGENTS.md` → match;
`grep -n "at=" AGENTS.md` → match; `grep -n "safety" docs/plans/048-spike-view-links-and-qa-views.md` → match.

### Step 6: Docs tests

`bun test lib/docs` → pass; `bun run docs:matrix && git diff --stat docs/guide` → no diff.

### Step 7 (optional, S): Backtick paths in open plans and the two reference docs resolve

Extend `lib/docs/links.test.ts` with a second check: in `AGENTS.md`,
`.claude/skills/city-walker/SKILL.md` and every `docs/plans/0*.md` whose
index row is not DONE/REJECTED (read the index table), every backtick
span matching `^(app|lib|scripts|pipeline|sites|e2e|components)/[\w./()\[\]-]+\.(ts|tsx|py|mdx|md)$`
names an existing file. Expect it to fail first on `docs/plans/040-…md`,
`017-…md`, `022-…md`, `045-…md`, `052-…md` (they cite `scripts/bake.ts`,
`pipeline/bake/ingest_sn.py`, `pipeline/tests/test_ingest.py` — gone);
the index marks those plans as drifted. Either exclude plans from the
check until they are refreshed (say so in the test's comment) or
re-point those five files' paths (`scripts/pipeline.ts`,
`pipeline/bake/fetch.py` + `providers/sn.py`, `pipeline/tests/test_fetch.py`)
— the latter is the better outcome and still S; the plans' step bodies
otherwise stand.

**Verify**: `bun test lib/docs/links.test.ts` → pass.

## Test plan

- `bun test lib/docs` (existing links/labels/matrix tests) after every
  step; the optional step 7 adds the backtick-path check.
- Verification: `bun run verify` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] the five greps in steps 1–5 give the stated results
- [ ] `bun test lib/docs` passes
- [ ] `bun run docs:matrix` leaves `git diff --stat docs/guide` empty
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 065 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A sentence named here no longer exists in the file (already fixed —
  skip that item and say so).
- The ledger's or the survey's table structure makes a status column
  impossible without rewriting the table (report; then add the status as
  a trailing phrase in each row instead).
- Step 7's check fails on a file not in the list above (report the path;
  do not delete the reference).

## Maintenance notes

- The guard against this class of rot is step 7's test; without it, the
  next path move repeats this plan.
- The skill is loaded for geometry work: its coordinate section must be
  per provider for as long as the CRS is per provider (ADR 0037).
- Reviewer: read the four replaced sentences against AGENTS.md's
  "Coordinate system" paragraph — they must agree.
