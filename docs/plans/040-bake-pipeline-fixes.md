# Plan 040: Bakes that read finished neighbours, keep their seam stairs, and never trust a half-written file

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command
> and confirm the expected result before moving on. Nothing here needs the
> raw downloads (`data/_raw/`) or re-bakes committed data — the tests use
> synthetic tiles. On a STOP condition, stop and report. When done, update
> this plan's row in `docs/plans/README.md`.
>
> **Multi-site layout (merged 2026-10-01, ADR 0037, plan 049)**: the data
> lives per site — `data/<site>/{dgm,cityjson,dlm,dop}` (Dresden's under
> `data/dresden/`), raw downloads in `data/_raw/<provider>/` — and the bakes
> run as `bun run fetch <site>` / `bun run bake <site> [tile…] [--step X]`
> through `scripts/pipeline.ts` (`scripts/bake.ts` and `--ingest` are gone;
> Saxony's adapter is `pipeline/bake/providers/sn.py`). Read the paths and
> commands below in that layout; this is drift, not a STOP condition.
>
> **Drift check (run first)**:
> `git diff --stat dd470e9..HEAD -- scripts/bake.ts pipeline/bake/__main__.py pipeline/bake/stairs.py pipeline/bake/rail.py pipeline/bake/ingest_sn.py pipeline/bake/common.py scripts/prepare-data.ts scripts/bake-wissen-hero.ts app/wissen/_components/landing.tsx`
> On a change in the lines a step edits, compare with the excerpts below;
> a mismatch is a STOP condition for that step.

## Status

- **Priority**: P1 (steps 1–2: wrong committed data), P2 (steps 3–5)
- **Effort**: S–M overall (each step S)
- **Risk**: LOW
- **Depends on**: 037 (correct test commands)
- **Category**: bug
- **Planned at**: commit `a28de75`, 2026-10-01; refreshed against `dd470e9` (main with ADR 0035)

## Why this matters

1. **`bun run bake` runs tile-major, but several steps read their
   neighbours' outputs of earlier steps.** For each tile it runs every step
   before moving to the next tile, so a tile reads neighbours that have not
   been baked yet in this run (stale or absent files). Seam results then
   disagree between the two sides of a seam, and running the bake twice in
   a row gives a different diff. The script's own header says "run a step
   for every tile" — its default mode does not.
2. **Stair flights across a tile seam are dropped by both tiles.** The
   stairs bake reads ground only from its own tile's DGM; a flight with an
   end beyond the edge gets no landing height and is discarded. The code
   comments promise the opposite ("a flight across a seam is burned into
   both tiles' terrain"). Measured on the committed data: **0 of 1 197
   flights** extend past their own tile.
3. **Raw ingest extraction is not atomic and has no timeouts.** Interrupting
   the multi-GB DLM extraction leaves a partial `dlm/` that every later run
   trusts (it only checks that *some* `.shp` exists); a missing layer reads
   as "no features", and the step writes an empty file that passes the
   tile-data test. Four `urlopen` calls have no timeout (a stalled
   connection hangs the bake), and the download URL taken from the
   service's JSON is used without checking its scheme.
4. **`prepare-data` trusts half-written files forever.** Published files
   and cache entries are written in place and trusted by name; a run killed
   mid-write leaves a truncated file that is never rewritten (the published
   name is the content hash, the cache entry is reused until its inputs
   change) — a tile that fails to inflate in the browser, with nothing in
   the build log.
5. **The `/wissen` hero image has a white band.** It is baked on a square
   canvas (`cols × cols` cells), but the site is now 5 × 3 tiles, so two
   rows of cells stay white; the landing page crops near the 68 % mark,
   into or next to that band.

## Current state

### 1 — bake order (`scripts/bake.ts:57-87`, `pipeline/bake/__main__.py`)

```ts
for (const cell of SITE.tiles) {
  const tile = tileIdOf(SITE, cell);
  if (wanted.size > 0 && !wanted.has(tile)) { continue; }
  const bounds = tileExtentOf(SITE, cell).map(String);
  if (flag("--ingest")) {
    python(`bake.ingest_${SITE.ingest}`, ["--raw", raw, "--tile", tile, "--bounds", ...bounds, ...(flag("--lsc") ? ["--lsc"] : [])]);
  }
  python("bake", [step, "--tile", tile, "--bounds", ...bounds, "--epsg", String(SITE.epsg), "--raw", raw, "--data", "data", ...(flag("--research") ? ["--research"] : [])]);
}
```

`python()` spawns `uv run --project pipeline python -m <module> …` with
`spawnSync` and an argv array (keep it that way — no shell).

`pipeline/bake/__main__.py` `main()`:

```python
    parser.add_argument("step", choices=[*STEPS, "all"])
    parser.add_argument("--tile", required=True)
    parser.add_argument("--bounds", nargs=4, type=float, required=True)
    ...
    tile = Tile(args.tile, tuple(args.bounds), args.epsg, args.raw, args.data)
    steps = list(STEPS) if args.step == "all" else [args.step]
    for step in steps:
        if step == "lowveg":
            lowveg.run(tile, research=args.research)
        else:
            STEPS[step](tile)
```

`STEPS` is an ordered dict (land cover first … `small-buildings` last).
Steps that read neighbours' outputs of earlier steps (reported, spot-check
two): `tram.py` (neighbours' `furniture_*.geojson`), `markings.py`
(neighbours' `landcover_*.png`), `cultivated.py` (neighbours' canopy,
canopyx, trees), `small_buildings.py` (neighbours' walls and bridges).

### 2 — stairs (`pipeline/bake/stairs.py`)

```python
class Dgm:
    """The tile's DGM1 on its 1 m grid, read as small-window medians."""

    def __init__(self, tile: Tile):
        self.xmin, self.ymin, self.xmax, self.ymax = tile.bounds
        with rasterio.open(tile.dgm) as src:
            self.z = src.read(1).astype(np.float64)
            self.res = src.res[0]

    def at(self, x: float, y: float) -> float | None:
        if not (self.xmin <= x < self.xmax and self.ymin <= y < self.ymax):
            return None
        n = self.z.shape[0]
        c = min(int((x - self.xmin) / self.res), n - 1)
        r = min(int((self.ymax - y) / self.res), n - 1)
        block = self.z[max(r - 1, 0) : r + 2, max(c - 1, 0) : c + 2]
        vals = block[block > -1000]
        return float(np.median(vals)) if len(vals) else None


def landing(dgm: Dgm, end, inner) -> float | None:
    """The ground a probe's length beyond one end of the way (the end itself
    when that lies off the tile)."""
    ...
    beyond = dgm.at(end[0] + dx / d * LANDING_PROBE, end[1] + dy / d * LANDING_PROBE)
    return beyond if beyond is not None else dgm.at(end[0], end[1])
```

`flight()` returns None when either landing is None. `run(tile)`
(`:330-345`) builds `dgm = Dgm(tile)` and keeps every OSM line that
intersects the tile box ("Unclipped: a flight across a seam is burned into
both tiles' terrain; the viewer stands it once, on the tile owning its
middle"). The sibling `rail.py` already reads ground across seams:
`mosaic(paths, bounds)` (`rail.py:144-166`) merges every committed DGM
overlapping `bounds` on the 1 m grid, NaN where there is no data, and
returns `(array, transform)`; `Ground` uses it with `MARGIN = 700`.
`Tile.neighbours()` (`common.py:73-84`) lists every committed tile's id and
bounds. The synthetic test tile (`pipeline/tests/synthetic.py` `osm_tile`)
writes its DGM to `data/dgm/dgm1_t_tiff/dgm1_t.tif`; stairs tests are in
`pipeline/tests/test_bakes.py:231-270`.

### 3 — ingest (`pipeline/bake/ingest_sn.py`)

- `urlopen` without `timeout`: `:76` (`_published_md5`), `:111`
  (`download`), `:162`, `:188` (`download_link`'s service query). The tree
  WFS calls at `:314`/`:320` already pass `timeout=300`.
- `download_link` (`:180-197`) returns `attrs["Download"]` from the
  service's JSON, used as a URL without a scheme check.
- `extract()` (`:199-207`) writes members straight to their final names
  (`dest / f"{stem}{suffix}"`); `ingest_tile` skips a product whose target
  `.tif` exists.
- `ingest_dlm` (`:241-254`): returns early when `any(dlm.glob("*.shp"))`,
  else extracts every inner ZIP's shapefile parts straight into `dlm/`.
- `Tile.has_dlm` (`common.py:58-64`) also only checks `any(self.dlm.glob("*.shp"))`.

The download tests (`pipeline/tests/test_ingest.py`) use `file://` URLs
(`src.as_uri()`) — a scheme check must not live in `download()` itself.

### 4 — prepare-data (`scripts/prepare-data.ts:144-197`)

```ts
function publish(logical: string, content: Uint8Array): string {
  ...
  const dest = join(OUT_DIR, hashed);
  if (!existsSync(dest)) {
    writeFileSync(dest, content);
    published++;
  }
  return hashed;
}
...
async function cached(name, key, bake) {
  const path = join(CACHE_DIR, `${key}.${name}`);
  if (existsSync(path)) {
    return readFileSync(path);
  }
  const bytes = await bake();
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const entry of readdirSync(CACHE_DIR)) {
    if (entry.endsWith(`.${name}`)) {
      rmSync(join(CACHE_DIR, entry));
    }
  }
  writeFileSync(path, bytes);
  return bytes;
}
```

### 5 — hero (`scripts/bake-wissen-hero.ts`)

`gridOf(tiles, step)` returns `{ tile, col, row }` with
`row = (maxN − n) / step`. `bakeWissenHero` computes
`cols = max(col) + 1`, `cell = round(size / cols)` and creates the canvas
`{ width: cell * cols, height: cell * cols, … background: "#ffffff" }`.
The landing shows it with `className="-z-20 object-cover object-[50%_68%]"`
(`app/wissen/_components/landing.tsx:48`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Pipeline tests + lint | `bun run test:pipeline` | pytest all pass, ruff clean |
| One pipeline test file | `cd pipeline && uv run pytest -q tests/test_bakes.py -k stairs` | pass |
| Unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |

## Scope

**In scope**: `scripts/bake.ts`, `pipeline/bake/__main__.py`,
`pipeline/bake/stairs.py`, `pipeline/bake/ingest_sn.py`,
`pipeline/bake/common.py` (only `has_dlm` and, if moved there, `mosaic`),
`pipeline/bake/rail.py` (only if `mosaic` moves to `common.py`),
`pipeline/tests/*` (new tests), `scripts/prepare-data.ts` (`publish`,
`cached` only), `scripts/bake-wissen-hero.ts`,
`app/wissen/_components/landing.tsx` (the `object-[…]` position only),
`docs/data-pipeline.md` (the bake runner's description, if it states the
order).

**Out of scope**: re-baking committed data under `data/` (the maintainer
runs `bun run bake` on the machine that has the raw downloads; note in the
status row that the stairs need a re-bake on every tile); the TS terrain
burn (`scripts/bake-tiles.ts` already handles flights across seams); the
DGM NoData resample in `bake-tiles.ts` (latent, all committed DGMs are
hole-free — parked in the backlog).

## Git workflow

Branch `claude/040-bake-pipeline-fixes`; one commit per step:
`fix(bake): run each step for every tile before the next step`,
`fix(stairs): a flight across a seam keeps its landings`,
`fix(ingest): atomic extraction, timeouts, https from the service`,
`fix(build): a killed prepare-data never leaves a trusted half file`,
`fix(wissen): the hero is as tall as the site`. No push unless instructed.

## Steps

### Step 1: Step-major bake

1. `__main__.py`: accept several tiles in one run. Make `--tile` and
   `--bounds` repeatable (`action="append"`; `--bounds` keeps `nargs=4`,
   `type=float`), require equal counts, build one `Tile` per pair, and run

   ```python
   for step in steps:
       for tile in tiles:
           ...run step on tile (lowveg with research=args.research)...
   ```

   With one `--tile` the behaviour is identical to today.
2. `scripts/bake.ts`: first the ingest pass per wanted tile (unchanged),
   then **one** `python("bake", [step, ...for each wanted tile: "--tile", id, "--bounds", ...bounds], "--epsg", …, "--raw", raw, "--data", "data", …)`.
   Update the header comment to say the steps run in order, each over every
   tile.
3. Add a pytest (in `pipeline/tests/test_bakes.py` or a new
   `pipeline/tests/test_main.py`) that monkeypatches `bake.__main__.STEPS`
   with two recording functions, runs `main()` with
   `sys.argv = ["bake", "all", "--tile", "a", "--bounds", "0","0","1","1", "--tile", "b", "--bounds", "1","0","2","1", "--epsg", "25833", "--raw", str(tmp), "--data", str(tmp)]`
   and asserts the call order is `[(s1,a),(s1,b),(s2,a),(s2,b)]`.

**Verify**: `cd pipeline && uv run pytest -q tests -k main` → pass;
`bun run typecheck` → exit 0.

### Step 2: Seam stairs

Make `Dgm` read a mosaic of every committed DGM around the tile:

- Reuse `mosaic` from `rail.py` (import it, or move it — with `NODATA` —
  to `common.py` and import it in both; moving is cleaner, keep `rail.py`'s
  behaviour identical).
- `Dgm.__init__`: `bounds = (xmin − 50, ymin − 50, xmax + 50, ymax + 50)`
  (50 m covers `LANDING_PROBE` plus any flight that straddles the seam);
  paths = `sorted((tile.data / "dgm").glob("dgm1_*_tiff/dgm1_*.tif"))`;
  keep the array and transform; `at(x, y)` indexes through the transform,
  returns None outside the mosaic, and takes the median of the 3 × 3 block
  ignoring NaN (`np.nanmedian` over non-NaN values; None if all NaN).
- Update `landing()`'s docstring.

Test: build two adjacent synthetic DGMs (copy what `osm_tile` does for the
DGM; the second at `X0 + SIZE`, file `data/dgm/dgm1_u_tiff/dgm1_u.tif`)
with different flat heights (100 and 103), and an OSM stair way crossing the
seam (tagged as the existing stairs tests do). `stairs.run(tile)` on the
first tile writes the flight (one feature, both landings set, z ≈ 100 and
≈ 103). Model it on `test_a_flight_is_oriented_uphill_with_its_landings_and_tagged_steps`
(`test_bakes.py:231`).

**Verify**: `cd pipeline && uv run pytest -q tests -k stairs` → all pass,
including the new seam test.

### Step 3: Ingest hardening

1. Module constant `TIMEOUT = 120` (seconds); pass `timeout=TIMEOUT` to the
   four `urlopen` calls at `:76`, `:111`, `:162`, `:188`.
2. In `download_link`, before returning, check the URL the service gave:
   `urllib.parse.urlparse(url)` must have scheme `https` and a host ending
   in `sachsen.de`; otherwise `raise SystemExit(f"layer {layer}: unexpected download URL host")`
   (do not print the URL's query). Keep `download()` generic (its tests
   use `file://`).
3. Atomic extraction: `extract()` writes each member to
   `<final>.part` and `os.replace`s it onto the final name after the copy.
   `ingest_dlm` extracts into `raw/dlm.part/` (cleared first if present)
   and, after the loop, renames the directory to `raw/dlm` (if a `dlm/`
   exists without the completion marker, remove it first), then writes
   `raw/dlm/.complete`. `ingest_dlm`'s early return and `Tile.has_dlm`
   check `(dlm / ".complete").exists()` instead of `any(*.shp)`.
   **Migration**: an existing complete `dlm/` from before this change has
   no marker. In `has_dlm`, accept a `dlm/` without the marker when it
   holds the layers the bakes read — at least `veg01_f.shp`, `ver01_l.shp`,
   `ver03_l.shp`, `ver06_l.shp`, `sie02_f.shp` (check the names the bakes
   pass to `read_layer` with `grep -rhn "tile.dlm /" pipeline/bake | sort -u`
   and use that list) — and print a one-line note suggesting a re-ingest.
4. Tests in `pipeline/tests/test_ingest.py`: `extract()` interrupted (make
   the ZIP member reader raise mid-copy via a fake) leaves no final file;
   `download_link` with a monkeypatched service response whose `Download`
   is `file:///etc/hosts` raises `SystemExit`; `has_dlm` false for a `dlm/`
   with one `.shp` and no marker, true with the marker.

**Verify**: `bun run test:pipeline` → all pass, ruff clean.

### Step 4: Atomic writes in prepare-data

In `publish` and `cached`, write to `dest + ".tmp"` then `renameSync(tmp, dest)`
(import from `node:fs`). In `cached`, make sure the stale-entry sweep does
not match `.tmp` files of other names (the sweep matches `.${name}` at the
end; `x.${name}.tmp` does not end with it — keep it that way) and remove
this name's own leftover `${path}.tmp` if present before writing.

**Verify**: `bun run typecheck` → exit 0; `bun run test` → all pass
(`scripts/` tests included). Optional: `bun scripts/prepare-data.ts`
twice → second run ≈ 1 s and `git status` clean (it writes only to the
gitignored `public/data/` and `.cache/`).

### Step 5: Hero height

In `bakeWissenHero`, compute `rows = max(row) + 1` and create the canvas
`height: cell * rows`. Update the doc comment ("The block as a WebP `size`
px wide, as tall as the block is"). Then adjust the landing's
`object-[50%_68%]` only if the image now crops badly: the new aspect is
5 : 3, so `object-center` (`object-[50%_50%]`) is the neutral start; check
`/wissen` with `bun dev` in a browser if you can, otherwise use
`object-center` and note "crop unjudged".

**Verify**: `bun run typecheck` → exit 0; if a test exists for the hero
(`ls scripts/*hero*.test.ts`), it passes; otherwise add one that calls
`bakeWissenHero` on three tiles in one row with a tiny synthetic class
PNG (see how `prepare-data.ts` calls it) and asserts the output's height
equals one cell (`sharp(buf).metadata()`).

## Test plan

- `pipeline/tests`: step-major order; a seam-crossing flight is written
  with both landings; extraction leaves no partial final file; service URL
  scheme/host check; `has_dlm` with and without the marker.
- `scripts`: hero height (if no test exists, the new one).
- Existing suites stay green: `bun run test:pipeline`, `bun run verify`.

## Done criteria

- [ ] `bun run test:pipeline` exits 0 (pytest + ruff check + ruff format --check)
- [ ] `bun run verify` exits 0
- [ ] `grep -n "timeout" pipeline/bake/ingest_sn.py | wc -l` → at least 6
- [ ] `grep -n "renameSync" scripts/prepare-data.ts` → 2 matches
- [ ] `grep -n "cell \* rows" scripts/bake-wissen-hero.ts` → 1 match
- [ ] Status row notes: "stairs need `bun run bake --step stairs` on every
      tile, then `bun scripts/prepare-data.ts`" (a maintainer action)

## STOP conditions

- A bake step turns out to keep module-level state between tiles (step 1
  would then mix tiles) — check with `grep -n "^[a-z_]* = \|global " pipeline/bake/*.py`
  for mutable module globals beyond constants; if one exists, stop.
- The seam test shows the mosaic's NaN edges make `landing()` return None
  for a flight whose ends lie inside the two synthetic tiles → stop and
  report the mosaic bounds.
- `has_dlm`'s migration list cannot be derived from the code (layers are
  built dynamically) → stop and ask for the list.

## Maintenance notes

- After merge, the maintainer re-bakes the stairs (`bun run bake --step
  stairs`, then the terrain via `prepare-data`); `tile-data.test.ts` keeps
  passing either way.
- A new step that reads neighbours' outputs needs no special handling now —
  the runner is step-major.
- Reviewers: step 3's `has_dlm` migration must not make an *empty* or
  partial `dlm/` pass.
