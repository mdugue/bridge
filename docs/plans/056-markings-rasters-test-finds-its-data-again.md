# Plan 056: The committed markings rasters are checked again — the test finds the per-site data and an empty parametrize fails loudly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- pipeline/tests/test_markings.py pipeline/tests/test_committed.py pipeline/pyproject.toml`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

`pipeline/tests/test_markings.py` ends with the one test that checks the
*committed* road-marking rasters (`markings_<tile>.png` and
`markings_low_<tile>.png`) against their tables: every row of a tile's
`markings_<tile>.json` must still have its texels painted. Since commit
`6fda8e9` (2026-09-30) the data lives per site under `data/<site>/dlm/`,
but the test still globs `data/dlm/`, which no longer exists. pytest turns
an empty `parametrize` into a **skip** by default, so the suite has
reported green for a week while this test protected nothing — the
baseline run at `4b0310a` shows exactly `359 passed, 1 skipped`, and the
skip is this test. Thirty-two tiles over seven sites were re-baked in that
time with no check on their markings. The fix is a few lines: the same
per-site glob `test_committed.py` already uses, the tile's CRS read from
its table instead of a hard-coded `25833` (Hamburg, München and Unna are
EPSG:25832), and a pytest setting so the next path move fails at
collection instead of skipping.

## Current state

- `pipeline/tests/test_markings.py` — unit tests of `bake/markings.py`;
  the last test (lines 300–320) reads committed data.
- `pipeline/tests/test_committed.py` — the tests over every committed
  site's data; its helpers are the pattern to copy (lines 14–27).
- `pipeline/pyproject.toml` — pytest's options (`[tool.pytest.ini_options]`,
  currently only `pythonpath = ["."]`).

`pipeline/tests/test_markings.py:300-320` as it is today:

```python
DLM = Path(__file__).resolve().parents[2] / "data" / "dlm"
DROPPED_OK = 0.005


@pytest.mark.parametrize("table", sorted(DLM.glob("markings_*.json")), ids=lambda p: p.stem)
def test_the_committed_rasters_lose_no_paint(table):
    doc = json.loads(table.read_text())
    xmin, ymin, xmax, ymax = doc["bounds"]
    tile = Tile(doc["tile"], (xmin, ymin, xmax, ymax), 25833, Path("."), Path("."))
    rows = [[xmin + r[0], ymax + r[1], *r[2:]] for r in doc["markings"]]
    for name in (f"markings_{doc['tile']}.png", f"markings_low_{doc['tile']}.png"):
        grey = np.asarray(Image.open(DLM / name))
        px = grey.shape[0]
        q = grey.reshape(px, px, 4).astype(np.uint16)
        lost = paint_lost(rows, q[..., 0] + 256 * q[..., 3], tile)
        # Two crossings that cross each other at an angle (an X at a
        # junction, not merged: they are not on one axis) share a few
        # texels at their corners, and a texel can only name one of them:
        # up to ~0.1 % of such a row's samples fall there. Nothing larger.
        assert [i for i, (_, d) in enumerate(lost) if d > DROPPED_OK] == [], name
```

Note that `DLM / name` is also used to open the PNGs: the PNG must be read
from the *table's own folder* (`table.parent`), not from a global `DLM`.

`pipeline/tests/test_committed.py:14-27` — the per-site pattern to copy:

```python
# Every site whose data is on disk (Dresden's is committed; another site's
# is there once it is fetched and baked).
DLMS = sorted(p for p in (Path(__file__).resolve().parents[2] / "data").glob("*/dlm"))


def _glob(pattern: str) -> list[Path]:
    return sorted(p for dlm in DLMS for p in dlm.glob(pattern))


def _tile(path: Path, kind: str) -> str:
    return path.name.removeprefix(f"{kind}_").removesuffix(".geojson")


def _id(path: Path, kind: str) -> str:
    return f"{path.parent.parent.name}/{_tile(path, kind)}"
```

The committed tables carry their CRS: every `data/<site>/dlm/markings_<tile>.json`
has the top-level keys `tile`, `crs` (e.g. `"EPSG:25832"` for Hamburg),
`bounds`, `size`, `lowSize`, `encoding`, `kinds`, `attribution`,
`markings`. Counts on disk at `4b0310a`: Dresden 15 tables, Grimma 2,
Hamburg 4, Leipzig 4, Meißen 1, München 4, Unna 2 — 32 in all, each with
its `markings_<tile>.png` and `markings_low_<tile>.png` beside it.

`Tile` (`pipeline/bake/common.py:72-91`) is a dataclass
`Tile(id, bounds, epsg, raw, data, …)`; `paint_lost(rows, raster, tile)`
uses `tile.bounds` and `tile.transform(px)`; the `epsg` is informational
here but must be the tile's own.

Conventions: Python 3.12, ruff with `line-length = 100` and rules
`E, F, I, B, UP, SIM` (`pipeline/pyproject.toml`); tests are plain pytest
functions, parametrized over committed files with readable ids, as in
`test_committed.py`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Python env | `cd pipeline && uv sync --locked` | exit 0 |
| This test file | `cd pipeline && uv run pytest -q tests/test_markings.py -rs` | all pass, **0 skipped** |
| Whole pipeline suite | `bun run test:pipeline` | pytest green (0 skipped), ruff check and format clean |

(`bun run test:pipeline` is `cd pipeline && uv run pytest -q tests && uv run ruff check . && uv run ruff format --check .`.)

## Scope

**In scope** (the only files you should modify):
- `pipeline/tests/test_markings.py`
- `pipeline/pyproject.toml`

**Out of scope** (do NOT touch, even though they look related):
- `pipeline/bake/markings.py` — the bake itself; if the re-pointed test
  fails on a real tile, that is a finding to report, not a bake to patch.
- `pipeline/tests/test_committed.py` — the pattern source; copy from it,
  do not move this test into it.
- `data/**` — never re-bake or edit committed data in this plan.

## Git workflow

- Branch: the branch you were given, or `plan/056-markings-test-data`.
- One commit, Conventional Commits, lowercase subject, e.g.
  `test(pipeline): the committed markings test reads the per-site data again`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the skip

Run `cd pipeline && uv run pytest -q tests/test_markings.py -rs`.

**Verify**: the summary names one skipped test with a reason like
`got empty parameter set ['table'], function test_the_committed_rasters_lose_no_paint`.
If it does **not** skip (the test already collects 32 cases), STOP — the
plan has drifted.

### Step 2: Re-point the glob and read the CRS per table

Edit `pipeline/tests/test_markings.py`. Replace the `DLM = …` line and the
test with:

```python
# Every site whose data is on disk, as test_committed.py walks it.
DLMS = sorted(p for p in (Path(__file__).resolve().parents[2] / "data").glob("*/dlm"))
TABLES = sorted(p for dlm in DLMS for p in dlm.glob("markings_*.json"))
DROPPED_OK = 0.005


def _epsg(doc: dict) -> int:
    """The table's CRS, `"EPSG:25832"` → 25832 (three of the seven sites are
    not in zone 33)."""
    return int(str(doc["crs"]).rsplit(":", 1)[-1])


@pytest.mark.parametrize(
    "table", TABLES, ids=lambda p: f"{p.parent.parent.name}/{p.stem.removeprefix('markings_')}"
)
def test_the_committed_rasters_lose_no_paint(table):
    doc = json.loads(table.read_text())
    xmin, ymin, xmax, ymax = doc["bounds"]
    tile = Tile(doc["tile"], (xmin, ymin, xmax, ymax), _epsg(doc), Path("."), Path("."))
    rows = [[xmin + r[0], ymax + r[1], *r[2:]] for r in doc["markings"]]
    for name in (f"markings_{doc['tile']}.png", f"markings_low_{doc['tile']}.png"):
        grey = np.asarray(Image.open(table.parent / name))
        px = grey.shape[0]
        q = grey.reshape(px, px, 4).astype(np.uint16)
        lost = paint_lost(rows, q[..., 0] + 256 * q[..., 3], tile)
        # Two crossings that cross each other at an angle (an X at a
        # junction, not merged: they are not on one axis) share a few
        # texels at their corners, and a texel can only name one of them:
        # up to ~0.1 % of such a row's samples fall there. Nothing larger.
        assert [i for i, (_, d) in enumerate(lost) if d > DROPPED_OK] == [], name
```

Keep the existing imports (`json`, `Path`, `np`, `Image`, `pytest`, `Tile`,
`paint_lost`); add nothing new.

**Verify**: `cd pipeline && uv run pytest -q tests/test_markings.py -rs -k committed_rasters`
→ `32 passed`, 0 skipped, and the ids read `dresden/33412_5656_2_sn`,
`hamburg/32564_5932_2_hh`, … (one per committed table).

If a tile **fails** the paint check: STOP and report the tile id and the
failing row indices — the test has found a real bake regression, which is
out of this plan's scope to fix.

### Step 3: Make an empty parametrize a collection error

In `pipeline/pyproject.toml`, under `[tool.pytest.ini_options]`, add:

```toml
empty_parameter_set_mark = "fail_at_collect"
```

(so that a glob that finds nothing fails the run instead of skipping it —
the failure mode this plan exists for).

**Verify**: `cd pipeline && uv run pytest -q tests` → the same number of
passed tests as before plus the 32 of step 2, **0 skipped**. Then a
negative check: temporarily change `"markings_*.json"` to
`"nothing_*.json"`, run `uv run pytest -q tests/test_markings.py` → the
run **errors at collection** (`Empty parameter set`); revert the change
before continuing.

### Step 4: Lint and format

`cd pipeline && uv run ruff check . && uv run ruff format --check .`
→ `All checks passed!` and `… files already formatted`. If `ruff format
--check` complains, run `uv run ruff format tests/test_markings.py` and
re-check.

## Test plan

- The re-pointed test is the test: 32 parametrized cases over the
  committed tables, ids per site and tile.
- The negative check in step 3 (an empty glob errors) is run once by hand
  and not committed.
- Verification: `bun run test:pipeline` → green with 0 skipped.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd pipeline && uv run pytest -q tests -rs` exits 0 and prints no `SKIPPED` line for `test_markings.py`
- [ ] `cd pipeline && uv run pytest -q tests/test_markings.py --collect-only -q | grep -c committed_rasters` prints `32`
- [ ] `grep -n 'empty_parameter_set_mark = "fail_at_collect"' pipeline/pyproject.toml` matches
- [ ] `grep -n '"data" / "dlm"' pipeline/tests/test_markings.py` returns no match
- [ ] `grep -n ", 25833, Path" pipeline/tests/test_markings.py` returns no match
- [ ] `bun run test:pipeline` exits 0
- [ ] `git status --short` shows only the two in-scope files
- [ ] `docs/plans/README.md` status row for 056 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 does not show the skip (the test already collects cases).
- Any committed tile fails the paint check in step 2 — report the tile
  and rows; do not loosen `DROPPED_OK` and do not touch `bake/markings.py`.
- A table lacks a `crs` key (then `_epsg` raises) — report which file.
- `empty_parameter_set_mark` makes an *unrelated* test error at collection
  (another empty parametrize somewhere) — report which one rather than
  removing the setting.

## Maintenance notes

- Every test that walks committed data should use the `data/*/dlm` glob
  (or `test_committed.py`'s `_glob`); a hard-coded site path is the bug
  this plan fixes.
- `fail_at_collect` means a fresh clone **without** `data/<site>/` folders
  would fail here too — today seven sites are committed, so the glob is
  never empty on a checkout. If the committed data ever leaves the repo,
  this setting (not the test) is what to revisit.
- Reviewer: check the ids in the pytest output name all seven sites.
