# Plan 089 [rewrite]: The bakes are type-checked in CI against a baseline that only shrinks

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and AGENTS.md
> first. Five phases, each one PR. Phases 0 and 1 touch no bake module
> and can go at once; phases 2 to 4 edit bake modules and wait for the
> maintainer's word on *when* (see "The cost nobody sees"). Run every
> **Verify** before the next phase; on a STOP condition, stop and
> report. Update this plan's row in `docs/plans/README.md` after each
> phase.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- pipeline/pyproject.toml pipeline/uv.lock pipeline/bake/common.py pipeline/bake/step_cache.py .github/workflows/ci.yml package.json`
> — and run the checker again (below): the counts in *Current state*
> are of `5dfa300d`.

## Status

- **Priority**: P2 — cheap to start, and what plan 092 stands on
- **Effort**: M (phases 0–1: S)
- **Risk**: LOW for the gate; MED for the fixes, each of which re-runs
  bake steps on the maintainer's machine
- **Depends on**: none. Needed by
  [092](./092-rewrite-bake-store.md).
- **Category**: rewrite — less complexity (contracts that are checked,
  not remembered); beside the aims: a re-bake that fails before it
  runs, not hours in
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: IN PROGRESS — phases 0–2 done (2026-11-16); phases 3–4 wait for decision B

## Why this matters

`pipeline/bake/` is 41 757 lines of Python in 83 files, and nothing
checks its types. 1 696 of its 2 031 functions state a return type, so
the intent is written down — and unread: CI's pipeline job runs pytest
and ruff. A bake step runs for minutes to hours on raw data only the
maintainer's machine holds, so a `None` that arrives where a geometry
was expected is found late and far from its cause. Plan 092 will rewrite
the input and output of every step (site-wide typed tables in place of a
file per tile); doing that to unchecked code would trade one drift for
another.

## Current state

Measured on 2026-11-16 at `5dfa300d` with pyright 1.1.414 in its default
mode, Python 3.13 (`cd pipeline && uv sync --locked && pyright
--pythonpath .venv/bin/python --outputjson bake`): **593 errors in 56 of
83 files**, 27 files clean. By what they are:

| Class | Findings | What it is |
|---|---|---|
| The bakes' own annotation | 184 | 229 uses of `shapely.Geometry` in 35 modules (`def carriageways(tile: Tile) -> list[shapely.Geometry]`, `ways.py`). In the stubs the checker has for shapely that is the bare base class without `area`, `buffer`, `is_empty`, `geom_type`; the class meant is `shapely.geometry.base.BaseGeometry`. Most asked: `geom_type` 29, `area` 25, `is_empty` 14, `length` 14, `buffer` 12, `interpolate` 12, `exterior` 9 |
| `None` not handled | 67 | `reportOptionalMemberAccess` 29, `reportOptionalSubscript` 13, `reportOptionalOperand` 7, "`None` is not iterable" 18 — `p.text.split()` on an XML element (`citygml.py`), `tile.tree_cadastre.credit` (`cadastre.py`), `bridge.py`, `rail.py`, `cultivated.py` |
| Possibly unbound | 15 | a name bound in one branch and read after it: `roofs.py` (`lab`, `faces`, `surface`, `drawn`), `facades.py` (`ws`), `lsc.py`, `facade_measure.py` |
| A library without types | 93 | `labels, n = ndi.label(mask)` 60 (scipy's partial stubs); `rasterio.transform`, `pyogrio.raw` "not a known attribute of module" 16; laspy's array views 12; `from scipy.spatial import cKDTree` 5 |
| Calls | 52 | "no overloads match" 32 (numpy), a wrong count of positional arguments 20 (`_moved(mask, *moves[k], 0, res)` in `dormers.py`: a star over a tuple of unknown length; `Window(c0, r0, …)` of rasterio) |
| What follows from the rows above | 182 | `reportArgumentType` 119, `reportOperatorIssue` 29, the rest of `reportAttributeAccessIssue` 16, `reportReturnType` 9, `reportIndexIssue` 5, `reportAssignmentType` 4 — mostly numpy unions grown from an untyped call upstream |

Most findings: `roofs.py` 56, `furniture.py` 43, `water.py` 36,
`roof_planes.py` 34, `dormers.py` 33, `lowveg.py` 32. The modules plan
092 rewrites are nearly clean already: `common.py` 4, `osm.py` 1,
`osm_index.py` 6, `spec.py` 1, `citygml.py` 6, and none in
`step_cache.py`, `rasters.py`, `fetch.py`, `net.py`, `__main__.py`.

Which libraries ship types (looked up in `pipeline/.venv`, 2026-11-16):
numpy, pyproj, Pillow and scikit-image do (`py.typed`); shapely,
rasterio, pyogrio, networkx and onnxruntime do not; scipy and laspy
ship a few `.pyi` files. For shapely the checker brings stubs of its
own, so a new version of the checker can move the counts.

The files that matter:

- `pipeline/pyproject.toml` — the dependencies, pinned exactly; the dev
  group is `["pytest==9.2.0", "ruff==0.17.3"]`; ruff's rules are `E`,
  `F`, `I`, `B`, `UP`, `SIM`. No checker's section yet.
- `.github/workflows/ci.yml`, job `pipeline`: `uv sync --locked`, `uv
  run pytest -q tests`, `uv run ruff check .`, `uv run ruff format
  --check .`. `package.json`'s `test:pipeline` runs the same three.
- `pipeline/bake/common.py` — what every step reads and writes with:
  `Tile`, `read_layer` (returns `tuple[np.ndarray, dict[str,
  np.ndarray]]`), `feature(geometry: dict, properties: dict | None) ->
  dict`, `write_geojson(path, features: list[dict], epsg, …)`,
  `geometry_json`, `table_json`, `save_grey_png`. A handed-over file's
  shape is a dict literal here and a zod schema in
  `lib/city/<name>-file.ts` (ADR 0059).
- `pipeline/bake/step_cache.py` — `code_hash(module)` hashes **the
  bytes** of the step's module and of every bake module it reaches,
  and `locked_runtime(uv.lock)`: the lockfile's lines for the project's
  dependencies and what they depend on, "not the dev group — a new
  ruff or pytest bakes nothing differently"
  (`tests/test_step_cache.py`,
  `test_the_locked_runtime_is_what_a_bake_runs_with`).
- Today's escapes in `bake/`: 5 `type: ignore`, 2 `cast(`.

### The cost nobody sees

Because `code_hash` hashes a module's bytes, **an annotation is a code
change to the step cache**. Replacing `shapely.Geometry` in `common.py`
re-keys every step of every tile of every site: the next `bun run bake`
runs them all again, on the maintainer's machine, from raw downloads
some of which were not reachable at the last re-bake (plan 022's row:
GeoSN's laser scan). A checker in the dev group, its settings in
`pyproject.toml`, a script outside `bake/` and stub files re-key
nothing.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Environment | `cd pipeline && uv sync --locked` | `.venv/` (git-ignored) |
| Python tests | `bun run test:pipeline` | pytest and ruff pass |
| The checker, as measured | `cd pipeline && pyright --pythonpath .venv/bin/python --outputjson bake` | JSON, `summary.errorCount` |
| A re-bake of one tile | `bun run bake dresden 33412_5656_2_sn` | needs the raw data: the maintainer's machine |
| TypeScript gate | `bun run verify` | passes (only `package.json` and docs change on that side) |

## Scope

**In scope**: `pipeline/pyproject.toml`, `pipeline/uv.lock`,
`pipeline/typecheck.py` and `pipeline/typecheck-baseline.json` (new),
`pipeline/typings/` (new, stubs), `pipeline/tests/test_typecheck.py`
(new), `pipeline/bake/**/*.py` (phases 2–4 only),
`.github/workflows/ci.yml` (the `pipeline` job), `package.json`
(`test:pipeline`), AGENTS.md (the Commands block),
`docs/data-pipeline.md` (the paragraph on `pipeline/tests/`).

**Out of scope**

- `pipeline/tests/` under the checker — the bakes first; say so in the
  settings (`include = ["bake"]`).
- What a step computes. A fix that changes a written file is a STOP.
- `pipeline/bake/step_cache.py`'s key (see decision B below).
- A typed record for each handed-over file: 40 hand-written
  `TypedDict`s would be a fourth copy of each shape. Plan 092 derives
  them from the one schema.
- Stricter modes (`strict`, unknown-type reports): after the baseline
  is empty, not before.

## Phases

### Phase 0 — choose the checker, pin it, prove it re-keys nothing

1. **Decision A (executor, with a note to the maintainer).** The
   baseline above was measured with pyright. Before pinning it, try
   what is current: a checker must run under `uv run` from an exact pin
   in the dev group, on CI's runner as it is (pyright's Python package
   fetches a Node program when first run — check that the `pipeline`
   job needs no new set-up step and no download at run time, or name
   the alternative that does not), print machine-readable findings,
   and know shapely. Run each candidate once over `bake/` and put its
   count, its time and what it needs into *Findings*. Without a reason
   against it, take the one measured here.
2. Add it to `[dependency-groups] dev` with an exact pin, its settings
   to `pyproject.toml` (`include = ["bake"]`, the Python version the
   lower bound of `requires-python`, the environment `.venv`, the stub
   path `typings`).
3. Prove the claim of "The cost nobody sees": with the new `uv.lock`,
   `step_cache.locked_runtime` returns what it returned before.

**Verify**: `cd pipeline && uv run pytest -q tests/test_step_cache.py`
passes; with the lockfile of before saved to a scratch file (`git show
HEAD:pipeline/uv.lock > "$TMPDIR/uv.lock.before"`), `uv run python -c
"import os; from bake import step_cache as s;
print(s.locked_runtime(open(os.environ['TMPDIR'] +
'/uv.lock.before').read()) ==
s.locked_runtime(s.LOCK.read_text()))"` prints `True`; `git diff --stat
-- pipeline/bake` is empty.

### Phase 1 — the baseline and the gate

1. `pipeline/typecheck.py` (outside `bake/`, so no step's closure
   reaches it): runs the checker with JSON output, folds the findings
   to `{file: {rule: count}}` — no line numbers, so an edit above a
   finding moves nothing — and compares with
   `pipeline/typecheck-baseline.json`:
   - a count above the baseline, or a file or rule the baseline lacks:
     exit 1, listing the new findings with their lines;
   - a count below it: exit 1 too, "the baseline is stale — run
     `uv run python typecheck.py --update`"; `--update` writes the
     file and refuses to raise any count;
   - it also counts `type: ignore` and `cast(` in `bake/` and holds
     them at today's 5 and 2.
   The checker has no baseline of its own that can be trusted to stay;
   this file is ours, and the comparison is a pure function with a
   test.
2. CI: one more line in the `pipeline` job, `uv run python
   typecheck.py`; the same in `package.json`'s `test:pipeline`.
   AGENTS.md's Commands block says `pytest + ruff + types`.
3. `docs/data-pipeline.md` says in its `pipeline/tests/` paragraph
   that the bakes are type-checked against a baseline and how to lower
   it.

**Verify**: `bun run test:pipeline` passes; a scratch edit that adds
`x: int = None` to `bake/classes.py` fails it with that line; the
baseline's counts sum to what the checker reports; `git diff --stat --
pipeline/bake` is empty.

### Phase 2 — stubs for what the libraries lack (still no bake edit)

Stub files change no module's bytes, so do them first.

1. `pipeline/typings/scipy/ndimage.pyi` (or the narrowest file the
   checker accepts): `label` returns `tuple[NDArray[np.int32], int]`
   for the call the bakes make — 60 findings.
2. `rasterio`: the surface the bakes use and no more (`open`,
   `transform.xy`, `windows.Window`, `features.rasterize`, …: list it
   from `grep -rhoE "rasterio\.[a-z_.A-Z]+" pipeline/bake | sort -u`);
   `pyogrio.raw.read`; laspy's views as the arrays they behave as.
3. Run phase 1's `--update` and commit the lower baseline.

**Verify**: `uv run python typecheck.py` passes; the baseline no longer
has an entry for "is not iterable" on `Literal[…]` nor for an unknown
attribute of a module; `git diff --stat -- pipeline/bake` is empty.

### Decision B (maintainer) — when the bake modules may be edited

Phases 3 and 4 re-key the step cache. Three ways; pick one and write
it into *Findings*:

- **With plan 092's re-bake (recommended in the series).** 092 re-bakes
  every site anyway. Phases 3 and 4 are prepared as a stack of PRs and
  merged in the days before that re-bake; nothing is baked twice.
- **Now, and pay.** Merge, re-bake the affected steps, and take the
  proof that comes with it: a re-bake after an edit that changed no
  behaviour writes no file anew (`git status data/` is clean; under
  plan 088, the source set's hash is the old one).
- **Teach the cache.** Make `code_hash` hash what a module *does*
  (its syntax tree without annotations, comments and docstrings) and
  bump `VERSION`. It changes what the cache trusts, costs one full
  re-key itself, and belongs in a PR and a test of its own. Not
  without the maintainer's word.

### Phase 3 — the bakes' own annotations

1. One name for "a geometry" in `bake/common.py` (an alias of
   `shapely.geometry.base.BaseGeometry`), and the 229 uses of
   `shapely.Geometry` in annotations take it (every use is an
   annotation: none constructs or tests one). Where a function needs
   what only one kind has (`exterior` 9 findings, `geoms` 7), say the
   real class in the signature, or narrow once at the top where
   another kind really can arrive (`if not isinstance(g, Polygon):
   return …`; the bakes already write `if g is not None and not
   g.is_empty`).
2. `--update` the baseline.

**Verify**: `uv run python typecheck.py` passes; `grep -rc
"shapely\.Geometry" pipeline/bake | awk -F: '{s+=$2} END {print s}'`
prints 0; `uv run pytest -q tests` and ruff pass; per decision B, one
tile re-baked shows no changed file.

### Phase 4 — the findings that are real

In this order, a module a PR where it helps review (`roofs.py`,
`furniture.py`, `water.py` are the largest):

1. **`None`** (67). For each: can it be `None` here? If the code above
   rules it out, say so where it is ruled out (return early, or raise
   with the file and the tile in the message — the bakes fail loudly,
   plan 063). If it can, that is a defect: write the pytest that
   reaches it first, then the fix.
2. **Possibly unbound** (15): bind before the branch or return in it.
3. **Calls** (20 wrong counts, 32 overloads) and the 182 that follow:
   re-run after steps 1–2 and the stubs; fix what is ours (a star over
   a tuple: give the tuple its length in its type); a numpy overload
   that is right at run time and wrong in numpy's types stays in the
   baseline with one line in *Findings* per kind.
4. Never silence: no new `type: ignore`, no `cast` (phase 1 counts
   them).

**Verify**: `uv run python typecheck.py` passes; the baseline has no
entry for `reportOptionalMemberAccess`, `reportOptionalSubscript`,
`reportOptionalOperand` or `reportPossiblyUnboundVariable`;
`common.py`, `osm.py`, `osm_index.py`, `spec.py`, `citygml.py`,
`rasters.py`, `fetch.py`, `net.py`, `step_cache.py` and `__main__.py`
have no entry at all; every defect found has its test.

## Test plan

- `pipeline/tests/test_typecheck.py` (new): the comparison alone — a
  raised count fails and names the file and rule; a lowered one fails
  as stale; `--update` lowers and never raises; an unknown rule in the
  findings is a failure, not a pass. Pattern:
  `pipeline/tests/test_step_cache.py` (pure functions on literal
  inputs, no bake run).
- Every defect of phase 4 step 1: a test in the module's existing test
  file that reaches the `None`.
- No test runs the checker itself; CI does.

## Done criteria

- [ ] `bun run test:pipeline` runs the checker and passes
- [ ] `pipeline/typecheck-baseline.json` has no `reportOptional*` and
      no `reportPossiblyUnboundVariable` entry, and none for the ten
      modules named in phase 4's Verify
- [ ] `grep -rc "type: ignore" pipeline/bake | awk -F: '{s+=$2} END
      {print s}'` prints at most 5
- [ ] `locked_runtime` is unchanged by the checker's pin
      (`test_step_cache.py` passes)
- [ ] decision B is recorded, and what was re-baked after phases 3–4
      wrote no changed file
- [ ] `docs/plans/README.md`: this plan's row updated, with the
      baseline's total before and after

## STOP conditions

- The checker cannot run in CI's `pipeline` job without a new set-up
  step or a download at run time, and no candidate can.
- Adding it changes `locked_runtime`'s text (every step would re-run).
- A fix changes a file a step writes. The plan is types, not
  behaviour: report the difference and the tile.
- More than a handful of the 67 `None` findings turn out to be real
  defects in files already published: stop and list them — that is a
  finding about the data, and the maintainer decides what to re-bake.
- A phase can only pass by raising a count in the baseline.

## Maintenance notes

- A bump of the checker can move counts in either direction (its
  shapely stubs travel with it): bump it in a PR of its own and
  `--update` there, saying which rule moved.
- A bump of shapely, rasterio or pyogrio: check `typings/` against the
  calls the bakes make.
- New bake modules start clean: a file the baseline does not name may
  have no finding.
- When the baseline is empty, delete it and the comparison, and let
  the checker's exit code be the gate.

## What the series changes about this plan

Built alone, this plan would finish its fixes whenever they are ready
and pay a re-bake for each batch. In the series:

- Plan 092 rewrites every step's input and output. It needs phase 4's
  ten modules clean first (they are the readers and writers), and it
  — not this plan — gives each handed-over file its Python type, from
  the one schema both languages read. So this plan stops at the
  writers' signatures and writes no `TypedDict` by hand.
- 092's full re-bake is the window for phases 3 and 4 (decision B):
  086 puts this plan beside 088, early; only phases 0–2 go then.
- Plan 088 moves the bakes' outputs out of git. After it, "wrote no
  changed file" is read from the source set's hash, not from `git
  status`.

## Findings

> **Slimmed before milestone 1 (2026-11-24; plan 086, ruling 5).** The
> gate is halved to its job: `typecheck.py` keys a finding by file, rule
> and message, fails on a count above or below the baseline and when
> pyright did not read every module; the escapes' count, the settings
> check and `--against` with `Typecheck-baseline-raise` are gone (a
> raised baseline shows in the PR's diff). Of phase 2's stubs scipy's
> stay; rasterio's, pyogrio's and laspy's were dropped, which put back
> the 31 findings they had covered: the baseline holds **436** (405
> before, the escapes not counted). The text below describes the gate
> and the stubs as they were at commit `b00b08c2`.

### Phase 0: the checker (2026-11-16)

**Decision A: pyright 1.1.414**, pinned as `pyright[nodejs]==1.1.414` in
the dev group. Its wheel carries pyright's JavaScript, and the `nodejs`
extra brings Node as a wheel (`nodejs-wheel-binaries` 24.19.0, locked),
so `uv sync --locked` is the whole set-up and a run downloads nothing:
measured with the proxy pointed at a closed port. CI's `pipeline` job
needs no new step. Each candidate once over `bake/`, from the bakes'
`.venv`, on the session's container:

| Checker | Findings | Time | What it needs | Verdict |
|---|---|---|---|---|
| pyright 1.1.414 (`[nodejs]`) | 593 errors (`errorCount`), the plan's count | 25 s | a 38 MB wheel and Node's wheel; no download at run time | **taken**: measured here, knows shapely through its bundled stubs |
| basedpyright 1.40.2 | 1 421 errors, 17 906 warnings in its own default mode | 26 s | the same Node wheel, 77 MB | a fork of the same checker with stricter defaults; nothing it adds is wanted before the baseline is empty |
| ty 0.0.104 | 102 | 1 s | one Rust binary | brings no stubs for shapely, so the 184 findings of the bakes' own `shapely.Geometry` annotation read as none (no finding names shapely); a 0.0 version whose counts move a release. Worth a look again at 1.0 |
| pyrefly 1.4.1 | 435 errors (preset `default`; preset `basic` exits 0) | 2.5–5 s | one Rust binary | fast; its own rule names would make a new baseline nothing in this plan is measured against |

Settings in `pyproject.toml`'s `[tool.pyright]`: `include = ["bake"]`,
`pythonVersion = "3.12"` (the lower bound of `requires-python`; the
count is 593 under 3.12 as under 3.13), `pythonPlatform = "Linux"` (on
Windows the count is 597), `venv = ".venv"`, `stubPath = "typings"`.

One package is shared: pyright depends on `typing-extensions`, which is
also in the bakes' runtime closure (`locked_runtime` lists
`typing-extensions 4.16.0`). A bump of pyright that moves it re-keys
every bake; phase 0's check (`locked_runtime` before and after) belongs
in every such bump.

No key moved. `locked_runtime` of the new `uv.lock` equals that of the
old (the plan's command prints `True`; `tests/test_step_cache.py`
passes), and beyond the plan's check: `step_cache.code_hash` of each of
the 81 bake modules computed on `HEAD` and on the branch, from the same
`.venv`, is identical. `git diff --stat -- pipeline/bake` is empty.

### Phase 1: the baseline (2026-11-16)

After review, the baseline keys a finding by file, rule, the innermost
function or class it stands in and the first line of its message,
whitespace folded — not by file and rule alone, where a finding fixed and
another added in the same file and rule passed as no change (102 of 167
such buckets held more than one). The 593 findings fall into 500 keys,
68 of them holding more than one (the same message in the same
function). The escapes are keyed alike, and are every way to silence
pyright: `type: ignore`, `pyright: ignore`, a `# pyright:` directive of
any kind, `@no_type_check`, `typing.cast`. The gate also fails when
pyright did not read all 83 modules of `bake/`, when `[tool.pyright]`
holds anything but its six settings or a `pyrightconfig.json` appears,
and — in CI on a pull request — when the baseline holds a key or count
the base branch's does not, unless the description carries a line
`Typecheck-baseline-raise: <why>` (a bump of pyright: `--update` may
raise only when the checker's version changed).

`pipeline/typecheck-baseline.json` holds **593 findings in 56 files**
(pyright 1.1.414), by rule: `reportAttributeAccessIssue` 233,
`reportArgumentType` 119, `reportGeneralTypeIssues` 78,
`reportCallIssue` 52, `reportOperatorIssue` 29,
`reportOptionalMemberAccess` 29, `reportPossiblyUnboundVariable` 15,
`reportOptionalSubscript` 13, `reportReturnType` 9,
`reportOptionalOperand` 7, `reportIndexIssue` 5,
`reportAssignmentType` 4. All are errors; the default mode reports no
warning.

Escapes held beside them: `type: ignore` 5, `pyright: ignore` 0,
`typing.cast` **0**, not the 2 of *Current state*: those two `cast(`
are `dop_balance.cast`, a function of the bake's own and its call.
`typecheck.py` counts calls of `typing.cast` through the syntax tree, so
neither is one.

How the rows of *Current state* map to rules: every
`reportGeneralTypeIssues` finding (78) is "… is not iterable" — the 60
of `ndi.label` and the 18 of `None` — and the 32 "no overloads" are
`reportCallIssue`, beside its 20 wrong counts of arguments. Phase 2's
Verify ("no entry for is not iterable") therefore reads as: no
`reportGeneralTypeIssues` left where `ndi.label` was.

Decision B: open (the maintainer's).

### Phase 2: the stubs (2026-11-16)

`pipeline/typings/` holds four **partial** stub packages (`<library>-stubs/`
with `py.typed` saying `partial`, PEP 561): only the modules they hold
replace the library's for pyright; every other module is read from the
source as before, and a module stub re-exports by name, from the library's
own modules, what it does not type. Each is written from the installed
source (file and version in its docstring), or, for a compiled function,
from what it returns on that version. No bake module, no `uv.lock`, no
setting changed.

Why partial packages and not plain module stubs: a stub directory without
an `__init__.pyi` is ignored beside the real package, and one with it
replaces the whole package, so `from scipy import fft` stops resolving. And
a stub of `scipy/ndimage` alone was read or not by the order pyright
happened to check the bakes in: after `dop_lean.py`'s `from scipy import
fft`, pyright had cached the source package's subpackages, and every later
`from scipy import ndimage` got the source (24 `label` findings came back
in a full run and not in any half of it). The partial `scipy-stubs` makes
the result the same in any order (checked forwards and backwards).

The baseline: **593 → 405 findings** (`--update`; nothing rose, the escapes
unchanged). By rule: `reportGeneralTypeIssues` 78 → 2,
`reportArgumentType` 119 → 83, `reportAttributeAccessIssue` 233 → 206,
`reportOperatorIssue` 29 → 3, `reportCallIssue` 52 → 31,
`reportOptionalSubscript` 13 → 11; the rest as they were. By library, each
stub package alone over the old baseline: scipy 157 (`ndimage.label` 60
and what follows from its labels, `distance_transform_edt`'s `tuple |
None` — 16 of the 18 "`None` is not iterable" were it — the binary
morphology's float arrays, `fft.rfft2`/`irfft2` and `next_fast_len`),
laspy 14 (the point records' `__getitem__`), rasterio 9 (its submodules
as attributes, `Window`'s constructor), pyogrio 8 (`pyogrio.raw`).

Held back, each because typing it honestly raises a key the gate counts
(the phase's STOP condition):

- **`scipy.spatial.cKDTree`** (compiled, no stub; 5 "unknown import
  symbol"): typed, `query_ball_point` on an array returns `list[int] |
  NDArray[object_]`, and `canopy.thinned` indexes a mask with it (2 new
  findings) — the point is 1-D there, which its type does not say. With
  that fix in phase 4: −5 +0.
- **`ndimage.binary_opening`**: typed like its siblings it lowers 3
  findings and re-words one in `facade_measure.profile` (`Any |
  NDArray[bool_] | None` becomes `NDArray[bool_] | None`: the same
  `None`, a new key). With that `None`'s fix in phase 4.

Left for phase 4, not a stub's: `"BICUBIC" is not a known attribute of
module "PIL.Image"` (`facade_glass.py`). Pillow ships types; it binds the
old constants with `setattr` at import, which its types do not declare.
The bake should say `Image.Resampling.BICUBIC` (the same value). So
phase 2's Verify holds for the libraries without types: no "is not
iterable" on a `Literal` and no unknown attribute of a module of theirs
remain.

No key moved: `step_cache.code_hash` of each of the 81 bake modules is the
same on `origin/rewrite` and on the branch, from the same `.venv`, and so
is `locked_runtime`.

