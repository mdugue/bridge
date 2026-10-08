# Plan 057: Every seam building is converted — the LoD2 fetch reads the neighbouring cells so the centre-ownership rule finds what the provider filed next door

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- pipeline/bake/fetch.py pipeline/bake/citygml.py pipeline/bake/providers/ pipeline/tests/test_fetch.py docs/data-pipeline.md`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

The pipeline's CityGML → CityJSON converter keeps a building only when
the centre of its envelope lies inside the tile ("owned by the tile
holding their envelope centre", `docs/data-pipeline.md`), so that a
building at a seam is written by exactly one tile. That rule assumes the
provider's files overlap at the seams — that the neighbour's file also
holds the building, so the neighbour's conversion keeps it. **Saxony's
files do not overlap.** Measured on the committed data at `4b0310a`
(read-only, over `data/<site>/cityjson/lod2_*.city.json`):

| Site (converter) | Buildings whose envelope centre lies outside their tile | Of those, present in a committed neighbour |
|---|---|---|
| Dresden, 14 of 15 tiles (the older converter kept whatever GeoSN's file held) | 9–34 per tile (e.g. `33412_5656`: 29, `33410_5658`: 33, `33414_5654`: 34) | 0–2 |
| Leipzig, all 4 tiles (converted by `citygml.py`) | 0 | — |

So GeoSN files each building in **one** 2 km file by a rule that is not
"envelope centre", and never repeats it. For every Saxony site fetched
through the pipeline (Leipzig, Grimma, Meißen; Dresden too on the
re-fetch plan 022 wants) the converter drops on the order of **10–35
buildings per 2 km seam**: a line of holes in the clay, the minimap, the
shadow casters and the inquiry card, with nothing in the log. The 1 km
providers (NRW, Hamburg, Berlin) read only the four 1 km cells *inside*
the tile and so lose the same class of building along the tile's outer
rim.

The fix keeps the ownership rule (it is what makes seams clean) and reads
one ring of neighbouring cells around the tile when fetching LoD2, so
that every file that can hold a centre-owned building is seen; `convert()`
already dedupes by `gml:id` across files. The DGM/DOM/DOP fetches are
unchanged (their mosaics are clipped to the tile).

## Current state

- `pipeline/bake/fetch.py` — the fetch: `cells()` (the provider grid cells
  covering a tile), `Ctx` (`raw`, per-tile `scratch`, `downloads`), `_step`.
- `pipeline/bake/citygml.py` — the converter; `convert()` applies the centre
  rule; `write_cityjson()` writes through `.part`.
- `pipeline/bake/providers/sn.py` — Saxony: every product per 2 km cell
  (`TILE_KM = 2`), the LoD2 ZIP downloaded into the tile's scratch folder.
- `pipeline/bake/providers/{nw,hh,be,by}.py` — the 1 km providers' `lod2()`.
- `pipeline/tests/test_fetch.py` — tests of `cells()` and of `convert()`.
- `docs/data-pipeline.md` — the table row for `citygml.py` and
  `providers/*.py`.

`pipeline/bake/fetch.py:77-82`:

```python
def cells(tile: Tile, km: int) -> Iterator[tuple[int, int]]:
    """South-west corners (km) of a provider's `km` grid covering the tile."""
    xmin, ymin, xmax, ymax = (int(b) // 1000 for b in tile.bounds)
    for e in range(xmin - xmin % km, xmax, km):
        for n in range(ymin - ymin % km, ymax, km):
            yield e, n
```

`pipeline/bake/fetch.py:47-58` (`Ctx`): `raw` (the provider's raw folder),
`scratch` (the tile's own download folder, removed once its products are
written — see `_scratch`, `:103-113`), and `downloads` = `raw / "downloads"`
(statewide packages, kept).

`pipeline/bake/citygml.py:198-206`:

```python
def convert(sources: Iterable[Path], bounds: tuple[float, float, float, float], epsg: int) -> dict:
    """The CityJSON of every building in `sources` owned by `bounds`."""
    out = _Builder()
    for path in sources:
        for b in buildings(path):
            centre = _centre(b)
            if centre and owns(bounds, *centre) and b.get(GML_ID) not in out.objects:
                out.add(b, "Building", None)
    return out.document(epsg)
```

`pipeline/bake/providers/sn.py:40-50, 65-66`:

```python
def _zip(ctx: Ctx, product: str, e: int, n: int) -> Path:
    entry = products()[product]
    name = entry["filename"].replace("$Rechtswert$", str(e)).replace("$Hochwert$", str(n))
    return download(f"{CLOUD}/{entry['share_id']}/{name}", ctx.scratch / name)


def _files(ctx: Ctx, tile: Tile, product: str, pattern: str) -> list[Path]:
    out = []
    for e, n in cells(tile, TILE_KM):
        out += unzip_members(_zip(ctx, product, e, n), pattern, ctx.scratch / product)
    return out
…
def lod2(ctx: Ctx, tile: Tile) -> list[Path]:
    return _files(ctx, tile, "LoD2_CityGML", r"\.gml$")
```

The other adapters' `lod2()` iterate `cells(tile, 1)`:
`providers/nw.py:55` (`_files`, shared with the rasters), `providers/hh.py:41`
(`_members`, shared), `providers/be.py:90` (`lod2` itself, downloads into
`ctx.scratch / "lod2"`), `providers/by.py:28` (`_files(ctx, tile, km, url)`,
shared).

`pipeline/tests/test_fetch.py:60-63` pins the drop as intended behaviour:

```python
    # B2's envelope centre (2005, 105) lies on the next tile: dropped here.
    doc = convert([gml, gml], (0.0, 0.0, 2000.0, 2000.0), 25833)
    assert list(doc["CityObjects"]) == ["B1", "P1"]
```

and `:92-96` tests `cells()`:

```python
    assert sorted(cells(tile, 1)) == [(408, 5708), (408, 5709), (409, 5708), (409, 5709)]
    assert list(cells(tile, 2)) == [(408, 5708)]
    …
    assert sorted(cells(odd, 2)) == [(408, 5708), (408, 5710), (410, 5708), (410, 5710)]
```

`net.download(url, dest, …)` (`pipeline/bake/net.py:88`) keeps `dest` when it
already exists and checks a download before it takes the name, so a file
placed under `ctx.downloads` is fetched once per provider and reused by
every tile.

Conventions: Python 3.12, ruff (`E, F, I, B, UP, SIM`, line length 100);
every writer goes through `.part`; a fetch step prints one line per
product; tests in `pipeline/tests/test_fetch.py` use synthetic GML strings
and `tmp_path`. A download that a provider's server refuses is reported by
`_step` and the fetch goes on (`fetch.py:89-100`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Python env | `cd pipeline && uv sync --locked` | exit 0 |
| Fetch tests | `cd pipeline && uv run pytest -q tests/test_fetch.py` | all pass |
| Whole pipeline suite | `bun run test:pipeline` | pytest green, ruff clean |
| Docs link test | `bun run test -- lib/docs` | pass |

A real fetch (`bun run fetch leipzig`) needs the provider's servers and
gigabytes of downloads: **do not run it** as part of this plan unless the
operator asked for a re-fetch; the unit tests are the gate.

## Scope

**In scope** (the only files you should modify):
- `pipeline/bake/fetch.py` (`cells` gains a `margin`)
- `pipeline/bake/providers/sn.py`, `nw.py`, `hh.py`, `be.py`, `by.py` (their `lod2()`)
- `pipeline/tests/test_fetch.py`
- `docs/data-pipeline.md` (the two table rows named above)

**Out of scope** (do NOT touch, even though they look related):
- `pipeline/bake/citygml.py` — the ownership rule stays as it is; this plan
  changes what is *read*, not what is *kept*.
- `data/**` — no re-fetch, no re-bake, no committed data edited here. The
  re-fetch of the Saxony sites is the maintainer's action (plan 022 for
  Dresden; a note in the index for the others).
- `scripts/`, the viewer — the CityJSON contract is unchanged.
- The rasters' cell ranges (`dgm`, `dom`, `dop`, `lsc`): margin 0 stays.

## Git workflow

- Branch: the branch you were given, or `plan/057-seam-buildings`.
- Commits per step, Conventional Commits, lowercase subject, e.g.
  `fix(fetch): the LoD2 fetch reads the neighbouring cells, so seam buildings are kept`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `cells()` takes a margin

In `pipeline/bake/fetch.py`, extend `cells`:

```python
def cells(tile: Tile, km: int, margin: int = 0) -> Iterator[tuple[int, int]]:
    """South-west corners (km) of a provider's `km` grid covering the tile,
    plus `margin` rings of cells around it (the LoD2 fetch reads one: a
    provider files a seam building in one cell by its own rule, and the
    converter keeps it for the tile holding its envelope centre — which
    may be the cell next door)."""
    xmin, ymin, xmax, ymax = (int(b) // 1000 for b in tile.bounds)
    pad = margin * km
    for e in range(xmin - xmin % km - pad, xmax + pad, km):
        for n in range(ymin - ymin % km - pad, ymax + pad, km):
            yield e, n
```

Add to `pipeline/tests/test_fetch.py`, beside the existing `cells` test
(`:92-96`), using the same `tile` (2 km at 408/5708) and `odd` fixtures:

```python
    assert len(list(cells(tile, 2, margin=1))) == 9
    assert (406, 5706) in set(cells(tile, 2, margin=1))
    assert (410, 5710) in set(cells(tile, 2, margin=1))
    assert len(list(cells(tile, 1, margin=1))) == 16
    assert sorted(cells(tile, 1, margin=1))[0] == (407, 5707)
```

**Verify**: `cd pipeline && uv run pytest -q tests/test_fetch.py -k cells` → pass.

### Step 2: Saxony reads the 3×3 ring for LoD2 and keeps the ZIPs across tiles

In `pipeline/bake/providers/sn.py`:

1. Give `_files` a `margin: int = 0` parameter passed to `cells(tile, TILE_KM, margin)`.
2. Let `_zip` take the destination folder: LoD2 ZIPs go to
   `ctx.downloads / "lod2"` (kept, shared by the site's tiles — nine
   files per tile overlap heavily with the neighbours' nine), the raster
   ZIPs stay in `ctx.scratch`. The simplest shape:

   ```python
   def _zip(ctx: Ctx, product: str, e: int, n: int, keep: bool = False) -> Path:
       entry = products()[product]
       name = entry["filename"].replace("$Rechtswert$", str(e)).replace("$Hochwert$", str(n))
       folder = ctx.downloads / product if keep else ctx.scratch
       return download(f"{CLOUD}/{entry['share_id']}/{name}", folder / name)
   ```

   and `_files(ctx, tile, product, pattern, margin=0, keep=False)` passing
   `keep` through; `lod2()` calls `_files(ctx, tile, "LoD2_CityGML", r"\.gml$", margin=1, keep=True)`.
   The extracted `.gml` members still go to `ctx.scratch / product`
   (removed with the tile's scratch).
3. A neighbouring cell may lie outside the provider's coverage (the edge
   of Saxony) and 404: `_files` must catch that per cell for the margin
   cells only — wrap the margin cells' `_zip` in `try/except OSError` and
   skip them with one printed line (`f"{tile.id}: LoD2 {e}_{n} (neighbour) not available"`);
   a failure on the tile's **own** cell still raises as today.

**Verify**: `cd pipeline && uv run ruff check . && uv run pytest -q tests/test_fetch.py` → pass.
There is no network test for `sn.py`; the behaviour is pinned by step 4.

### Step 3: The 1 km providers read one ring too

- `providers/nw.py`: give `_files` a `margin` parameter and call
  `cells(tile, 1, margin)`; `lod2()` passes `margin=1`; the rasters keep 0.
  A margin cell with no file in the listing (the `FileNotFoundError` at
  `:58`) is **skipped** for margin cells and raised for the tile's own.
- `providers/hh.py`: the same for `_members` (margin cells that no archive
  holds are skipped; see the `if not found:` branch at `:46`).
- `providers/be.py`: `lod2()` iterates `cells(tile, 1, margin=1)`; a 404 on
  a margin cell's ZIP is skipped with a printed line, the tile's own raised.
- `providers/by.py`: read its `lod2()`; if it goes through `_files(ctx, tile, km, url)`,
  add the same optional `margin` and pass 1 from `lod2()` only.

Put the "own cells raise, margin cells skip" distinction in one helper in
`fetch.py` so the four adapters share it:

```python
def own_cells(tile: Tile, km: int) -> set[tuple[int, int]]:
    """The cells inside the tile (`cells(tile, km)` without a margin)."""
    return set(cells(tile, km))
```

**Verify**: `cd pipeline && uv run ruff check . && uv run ruff format --check .` → clean;
`uv run pytest -q tests` → pass.

### Step 4: The converter test shows the seam building kept when the neighbour's file is among the sources

In `pipeline/tests/test_fetch.py`, keep the existing assertion (B2 is
dropped when converting tile `(0, 0, 2000, 2000)`) and add a second
conversion of the **next** tile with the same two files, asserting that
B2 is kept there:

```python
    # The next tile reads the same files (the fetch's one-cell margin) and
    # keeps B2, whose centre it owns — once, although it appears twice.
    nxt = convert([gml, gml], (2000.0, 0.0, 4000.0, 2000.0), 25833)
    assert list(nxt["CityObjects"]) == ["B2"]
```

**Verify**: `cd pipeline && uv run pytest -q tests/test_fetch.py` → pass.

### Step 5: The docs say what the fetch reads

In `docs/data-pipeline.md`, the `providers/{sn,nw,by,hh,be}.py` row: add
"`lod2` reads one ring of neighbouring cells around the tile, so a seam
building the provider filed next door is seen by the tile that owns its
envelope centre"; the `citygml.py` row keeps "buildings owned by the tile
holding their envelope centre" and gains "(the fetch reads the
neighbouring cells, so the rule never drops a building: Saxony files each
building in exactly one 2 km file)". Also add one sentence to the index's
*Maintainer actions* (see the README reconcile note for this plan): the
Saxony sites fetched before this change (Leipzig, Grimma, Meißen) are
missing their seam buildings until `bun run fetch <site>` runs again
with the LoD2 ZIPs cleared (`data/_raw/sn/downloads/LoD2_CityGML/` is
new; the per-tile CityJSON under `data/<site>/cityjson/` must be deleted
for the fetch to rewrite it, since `_step` skips an existing `dest`).

**Verify**: `bun run test -- lib/docs` → pass (the link test).

## Test plan

- `test_fetch.py`: `cells(…, margin=1)` counts and corners (step 1); the
  seam building kept by the next tile (step 4).
- Existing: `convert` drops B2 for the first tile (unchanged).
- Verification: `bun run test:pipeline` → green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "def cells(tile: Tile, km: int, margin: int = 0)" pipeline/bake/fetch.py` matches
- [ ] `grep -n "margin=1" pipeline/bake/providers/sn.py pipeline/bake/providers/nw.py pipeline/bake/providers/hh.py pipeline/bake/providers/be.py` shows one hit per file (and `by.py` if its `lod2` goes through `cells`)
- [ ] `grep -n "ctx.downloads" pipeline/bake/providers/sn.py` matches (LoD2 ZIPs kept)
- [ ] `cd pipeline && uv run pytest -q tests/test_fetch.py` exits 0 with the two new tests
- [ ] `bun run test:pipeline` exits 0
- [ ] `grep -n "neighbouring cells" docs/data-pipeline.md` matches
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 057 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `convert()` in `citygml.py` no longer dedupes by `gml:id` (the
  `b.get(GML_ID) not in out.objects` test is gone) — the margin would then
  double buildings.
- A provider's `lod2()` does not go through `cells()` at all (then its
  margin needs its own design — report which).
- The `by.py` adapter's LoD2 cells are not 1 km (read its `lod2()` and
  report the grid size instead of guessing).
- Any existing `test_fetch.py` test fails after step 2 or 3.

## Maintenance notes

- The ownership rule and the margin are a pair: whoever changes
  `owns()` (`common.py:162`) or the tile size must keep "every file that
  can hold an owned building is read" true.
- Disk: Saxony's LoD2 ZIPs now stay under `data/_raw/sn/downloads/LoD2_CityGML/`
  (gitignored). A site of N tiles reads about N + 2√N + 4 ZIPs; `bun run
  site --all` reports the raw folder's size.
- After this lands, the committed Saxony sites other than Dresden need a
  re-fetch to gain their seam buildings; Dresden's committed CityJSON
  already holds them (the older converter kept GeoSN's files whole).
- Reviewer: check that the raster fetches still pass `margin=0` (a margin
  there would mosaic the neighbours' DGM into the tile's clip for nothing).
