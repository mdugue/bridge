# Plan 073: The look is fixed; the sidebar keeps only the controls people use

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Step 1 produces a decision table that the maintainer may
> amend — if you were given an amended table, use it instead of step 1's
> defaults. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the plans index — unless a reviewer dispatched you and told you they
> maintain it.
>
> **Drift check (run first)**:
> `git diff --stat 85a41b7..HEAD -- lib/city/look-controls.ts lib/city/look-state.ts lib/city/snapshot.ts app/_components/scene-sidebar.tsx app/_components/visual-style.ts app/_components/terrain-layer.ts app/_components/post-stack.ts app/_components/vegetation-layer.ts app/_components/tree-inventory-layer.ts app/_components/create-app.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status (2026-10-10)**: **PARTIAL — awaits the maintainer** for the
  rest. Asked which settings can go, the maintainer decided: *Transparenz*
  removed, *Blattflimmern* removed (*Windhelligkeit* baked), *Flussnebel*
  and *Tiefenschärfe* stay but are no longer parametrisable (all four built
  on the performance PR, with old snapshots still loading). The ~20
  cosmetic sliders were not decided: they cost the GPU nothing (uniform
  multipliers), only code and UI — step 1's decision table needs the
  maintainer's answer before steps 2–6.

- **Priority**: P3
- **Effort**: M
- **Risk**: MED — reverses most of ADR 0017's slider table and changes the reviewers' snapshot workflow
- **Depends on**: plan 071 (it moves the DoF and contact-shadow choices to construction time; land it first so this plan does not re-plumb them)
- **Category**: tech-debt (simplification; small perf and bundle gain)
- **Planned at**: commit `85a41b7`, 2026-10-10

## Why this matters

The maintainer asked whether the sidebar's free parameters cost
performance and bundle size and could be fixed instead ("we don't need many
of the settings anyway"). The honest answer, from the code:

- **A slider that is a uniform costs almost nothing on the GPU.** Each of
  the 30 percent rows (`lib/city/look-controls.ts`) is a shared uniform
  node; changing it rebuilds nothing. Baking its value in saves a uniform
  read, not a pass.
- **What costs is that every term runs at any value, 0 included**: the
  clay's windows, facade reading, articulation noise, storey bands, eave,
  rim and roughness jitter (`visual-style.ts:192–313`); the terrain's
  ground detail, urban green and NDVI terms (`terrain-layer.ts:923–970`);
  the crowns' shimmer, translucency, flutter and brightness. A slider at 0
  hides a term; only deleting it saves the work.
- **The few switches with a real cost are construction-time choices**:
  depth of field and contact shadows (plan 071 moves them per tier),
  multi-tuft crowns (plan 071's phone default), and `transparency`, whose
  crossing of 0 flips the clay to a hashed-alpha build (`applyTransparency`,
  `visual-style.ts:923–947`, `clay.needsUpdate = true`) — a rebuild hitch.
- **The plumbing is real code**: one table, a store, a versioned snapshot
  codec (ADR 0017), the sidebar's slider groups (`scene-sidebar.tsx`,
  1 307 lines), each owner's `Record<…LookKey, …>` writer, and the guide
  pages in two languages that a test pins to the labels
  (`lib/docs/guide-labels.test.ts`).

So: freezing the values is a simplification with a small runtime gain; the
GPU gain comes from deleting terms, which this plan does only where the
frozen value is 0 (`transparency`) and leaves to a measured follow-up
otherwise.

## Current state

- `lib/city/look-controls.ts` — 30 rows, each `{ key, id, label, group,
  initial, snapshotKey }`; owners: `SceneLookKey` (fogAmount, heightFog,
  waterMist, groundDetail, urbanGreen, meadowNdvi, skyView, horizonShade,
  reflections), `ClayLookKey` (articulation, bands, duskGlow, eave,
  facadeReading, groundShade, rim, roofTint, roofVibrance, roughness, tint,
  transparency, windows), `PostLookKey` (contact, grading, grain, ink),
  `VegetationLookKey` (leafBright, leafFlutter, shimmer, translucency).
  Initial values (line by line in the file): fogAmount 0.2, heightFog 0.2,
  waterMist 0.6, grading 0.5, transparency 0, groundShade 0.34, bands 0.18,
  rim 0.6, tint 0.6, roofTint 0.7, roofVibrance 0.5, eave 0.35,
  articulation 0.8, windows 1, facadeReading 1, duskGlow 0.5, roughness
  0.12, groundDetail 0.7, urbanGreen 1, meadowNdvi 0.6, shimmer 0.45,
  translucency 0.5, leafFlutter 0.5, leafBright 0.5, contact 0.5, skyView
  0.5, horizonShade 0.8, reflections 1, grain 0.25, ink 0.7. Plus the
  non-percent fields `dof`, `focusMode`, `focusDistanceM`, `multiTuft`,
  `style` and the data-layer flags (`LookValues`, `LOOK_DEFAULTS` line 405).
- Owners apply rows through complete records: `visual-style.ts:976–1009`
  (`CLAY_UNIFORM_FOR`, `applyCityLook`), `post-stack.ts:674–690` (`rows`),
  `create-app.ts:1479ff.` (`sceneRows`; the transparency hook at ~1531), `vegetation-layer.ts:1217–1250` and
  `tree-inventory-layer.ts:527–590` (`rowUniform`).
- `lib/city/snapshot.ts` serialises one `snapshotKey` per row; ADR 0017:
  "`snapshotKey` values are the persisted format: never rename one";
  "unknown look keys are accepted (forward compatibility)".
- QA depends on it: `e2e/snapshot-shot.spec.ts:79` (`poc.look.set(patch)`),
  the `pr-snapshots` skill ("before and after as a look-key pair where the
  change has a slider"), AGENTS.md's "`__poc.look.set()` drives the
  sliders". One e2e spec finds a slider by id (`height-fog`,
  `grep -n height-fog e2e/*.ts`).
- `lib/docs/guide-labels.test.ts` requires every `LOOK_CONTROLS` label in
  `docs/guide/{en,de}/using-the-viewer.md`.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Unit tests | `bun run test` | all pass |
| Typecheck / lint | `bun typecheck && bun run fix && bun lint` | exit 0 |
| E2E | `bun run build && bun run test:e2e` | all pass |
| Bundle size | `bun run build`, then `ls -l .next/static/chunks/*.js` and `gzip -c <file> \| wc -c` for the two largest | numbers to compare |
| Real-GPU plates | `bun run shots` | PNGs |

## Scope

**In scope**: `lib/city/look-controls.ts` (+ test), `lib/city/look-state.ts`,
`lib/city/snapshot.ts` (+ test), `app/_components/scene-sidebar.tsx`,
`app/_components/visual-style.ts`, `app/_components/terrain-layer.ts`,
`app/_components/post-stack.ts`, `app/_components/vegetation-layer.ts`,
`app/_components/tree-inventory-layer.ts`, `app/_components/create-app.ts`
(`sceneRows`), `e2e/*.spec.ts` (only where a removed slider id is used),
`docs/guide/{en,de}/using-the-viewer.md`, `docs/adr/0017-…md` (amend),
`.claude/skills/pr-snapshots/SKILL.md`, AGENTS.md (the snapshot line).

**Out of scope**: the picture styles (*Bildstil*), the data-layer
switches, the time of day, Modell — they are features, not look tuning;
whether to keep them is a direction question (see the plans index).
Deleting any term other than the hashed transparency (that is the
follow-up, gated on a GPU measurement).

## Git workflow

- Branch: `refactor/073-fixed-look`
- Conventional Commits, e.g. `refactor(look): the facade and ground looks are fixed`.
- Visual change (the defaults must render exactly as today, but the PR
  still carries a before/after snapshot pair at the spawn to prove it).

## Steps

### Step 1: The decision table (default, unless the maintainer gave one)

Write `docs/plans/073-look-decisions.md` (or a section in the PR) with one
line per row: key, label, owner, what 0 does (hides / skips work — read
the owner's code), decision. Defaults:

- **Keep as a slider**: `fogAmount` (*Nebel*) — it is the one look people
  change on purpose, and plan 068 streams by it.
- **Fixed at its current `initial`**: every other percent row.
- **Fixed and its term deleted**: `transparency` (initial 0 — the hashed
  build and `setCityTransparency` go).
- Non-percent fields: `dof` and `focusMode`/`focusDistanceM` stay where
  plan 071 left them (desktop `?dof=1` only); `multiTuft` stays a switch.

**Verify**: the table exists and lists 30 rows.

### Step 2: Fixed values live with their owners

For each fixed row:
- Delete it from `LOOK_CONTROLS` and from its owner union type.
- In the owner, replace the uniform with a constant node of the same value
  (`float(0.6)`, or the plain number where it scales a JS value), named
  after the row, with the row's description moved into a comment
  (e.g. `/** Farbvariation: … */ const TINT = float(0.6);` in
  `visual-style.ts`), and delete its entry from the owner's record
  (`CLAY_UNIFORM_FOR`, `rows`, `sceneRows`, `rowUniform`).
- Keep `LookValues` complete for the rows that remain; delete the fields
  of the removed rows. The compiler's `Record<…LookKey, …>` checks then
  find every leftover writer.

Do it owner by owner (clay, terrain/scene, vegetation, post), running
`bun typecheck && bun run test` after each.

**Verify** after the last owner: `bun typecheck` exit 0; `bun run test` all
pass; `grep -c "key: \"" lib/city/look-controls.ts` → 1 (only `fogAmount`)
with the default table.

### Step 3: Delete the hashed transparency

Remove `setCityTransparency`, the `alphaHash`/`opacity` handling in
`applyTransparency` (keep the double-sided switch Modell's Schnitt needs —
`setClaySection` — and its graph key `clay|solid|double`), and the
`"hashed"` graph variant, `StyleResources.transparency`
(`visual-style.ts:145–148, 847`) and the look hook that forwards it
(`create-app.ts:~1531`, `lastTransparency`). The clay is always opaque.

**Verify**: `bun typecheck && bun run test` → pass;
`grep -n "alphaHash" app/_components/visual-style.ts` → nothing.

### Step 4: Snapshots stay readable

`lib/city/snapshot.ts`: keep **parsing** the removed `snapshotKey`s
(ignore their values) so every snapshot already pasted in a PR still
loads; stop **writing** them. Add a test: a snapshot carrying e.g.
`tintPct` parses `ok` and applies the camera; the look patch it yields has
no `tint`. Follow ADR 0017's rule: never reuse a removed `snapshotKey`.

**Verify**: `bun test lib/city/snapshot.test.ts` → pass.

### Step 5: The sidebar, the e2e, the guide

- `scene-sidebar.tsx`: the slider groups render from the shrunken table;
  delete group headings that became empty.
- E2E: replace the `height-fog` slider use (if `heightFog` is fixed) with
  the *Nebel* slider or delete that assertion if it only tested the
  slider; `bun run test:e2e` must pass.
- Guides (both languages): describe the fixed look in one paragraph
  instead of each slider; keep `lib/docs/guide-labels.test.ts` green.

**Verify**: `bun run build && bun run test:e2e` → pass; `bun run test` → pass.

### Step 6: Measure, amend the ADR, update the QA instructions

1. Bundle: the gzip size of the HUD chunk (the one containing
   `Erweitert`) and the scene chunk (the one containing `TilesRenderer`),
   `main` vs branch. Record both.
2. Plates: spawn and a building close up at dusk, `main` vs branch, on a
   real GPU — identical except where `transparency` was non-zero (it never
   is by default).
3. Amend ADR 0017 (status "amended 2026-10"): the table now holds the
   controls people use; tuning values live as named constants in their
   owners; removed `snapshotKey`s are read and ignored, never reused.
4. `.claude/skills/pr-snapshots/SKILL.md` and AGENTS.md: a look change is
   now a code change judged by before/after snapshots of the camera and
   time; "look-key pairs" apply only to the remaining sliders.

**Verify**: `bun run test` → pass (docs link tests); numbers in the PR.

## Test plan

- `lib/city/look-controls.test.ts`: whatever it pins about the table now
  pins the shrunken one (one row with the default table).
- `lib/city/snapshot.test.ts`: old keys read and ignored; new snapshots do
  not write them.
- The owners' existing tests (`visual-style.test.ts`, `terrain-layer.test.ts`,
  `vegetation-layer.test.ts`, `post-stack`-adjacent tests) must pass
  unchanged except for removed-uniform references.

## Done criteria

- [ ] `bun typecheck`, `bun lint`, `bun run test` exit 0
- [ ] `bun run build && bun run test:e2e` passes
- [ ] `LOOK_CONTROLS` holds only the rows the decision table keeps
- [ ] `grep -n "alphaHash" app/_components/visual-style.ts` returns nothing
- [ ] An old snapshot with removed keys parses and applies (tested)
- [ ] ADR 0017 amended; pr-snapshots skill and AGENTS.md updated; both guides updated
- [ ] Bundle sizes before/after recorded

## STOP conditions

- Drift in the excerpts.
- A fixed value renders differently from the slider at the same value
  (a plate differs at the defaults): a term read the uniform in a way the
  constant does not reproduce — report it.
- A removed row turns out to be written by something other than the
  slider (a style weighting it, Modell, the export) — grep the key first;
  if it is, keep that row as an internal uniform and say so.
- The maintainer's table keeps more than five sliders — then this plan's
  premise (less plumbing) is weak; do steps 3–4 only and report.

## Maintenance notes

- Tuning a look is now an edit of a named constant, reviewed with
  snapshots of place and time (no slider pair). That is the price; the
  gain is one table, store and codec path fewer per look term.
- Follow-up, gated on a GPU measurement (plan 019's checklist): delete or
  tier-gate the most expensive fixed terms (the clay's windows and facade
  reading, ADR 0049; the terrain's ground detail) on phones — a
  construction-time variant per tier, like plan 071's AO.
- Reviewer: check that every removed key is still parsed by the snapshot
  codec and never written.
