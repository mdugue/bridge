# Plan 063: The build step and the fetch fail loudly and write atomically — a missing provenance record, a TIN that is not NoData, a fetch that failed, a half-written Wikidata cache, a locale-dependent landmark order

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command
> and confirm the expected result before moving on. If anything in the
> "STOP conditions" section occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- scripts/prepare-data.ts scripts/bake-tiles.ts scripts/bake-terrain-tin.ts lib/city/site-report.ts lib/city/site-report.test.ts lib/city/landmarks.ts lib/city/landmarks.test.ts pipeline/bake/fetch.py pipeline/bake/landmarks.py pipeline/bake/bridge.py pipeline/bake/transit.py pipeline/tests/test_fetch.py pipeline/tests/test_landmarks_structures.py scripts/pipeline.ts`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition for that step.
>
> **Ordering**: plan 040 (open) edits `pipeline/bake/__main__.py` and
> `prepare-data.ts`'s writes; this plan does not touch those lines. Plan
> 057 edits `fetch.py`'s `cells()`; this plan edits `fetch.py`'s `run()`
> and `fetch_tile()` — merge in either order.

## Status

- **Priority**: P2 (step 1 is P1 for anyone adding a site)
- **Effort**: M in all (S per step)
- **Risk**: LOW per step
- **Depends on**: none
- **Category**: bug (build / pipeline)
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

Five places where the build or the fetch hides a failure or depends on
the machine it runs on, all confirmed by reading at `4b0310a`:

1. **A freshly fetched and baked site breaks the whole build.**
   `prepare-data.ts` reads `data/<site>/provenance.json` unconditionally
   (`readFileSync` → `ENOENT`, a stack trace, no hint), but the readiness
   check (`lib/city/site-report.ts` `tileReport`, used by
   `prepare-sites.ts`'s `isReady`) never asks for that hand-kept file. So
   `bun run fetch berlin && bun run bake berlin && bun dev`: `bun run site`
   says "ready", `prepare-sites` picks the site, `prepare-data` dies, and
   `prepare-sites` fails the run — **no site is served** until the folder
   is removed or the file written by hand.
2. **Every error in the TIN builder degrades the fine level to a grid.**
   `tinTerrainMesh` wraps `tinFromGrid` in `try { … } catch { return null; }`;
   the only intended throw is "the source grid has NoData", but a
   regression, a `RangeError` or NaNs from `burnStairs`/`carvePassages`
   are swallowed the same way, logged as "the DGM has NoData, the fine
   level stays a grid", and the walls stop snapping to the measured step.
   The build "succeeds".
3. **`bun run fetch` exits 0 whatever failed.** `_step` catches every
   exception per product and prints; `run()` returns normally; so
   `bun run fetch x && bun run bake x` proceeds after a tile's DGM or LoD2
   failed. Four per-tile fetches (`cadastre.fetch`, `traffic_sources.fetch`,
   `bridge.fetch_wikidata`, `landmarks.fetch_wikidata`) run *outside*
   `_step`; the Wikidata ones catch `OSError` only, so a non-JSON answer
   (a WDQS outage page) or a binding without a label aborts the remaining
   tiles with a traceback.
4. **The Wikidata and GTFS caches are written directly.** `landmarks.py`,
   `bridge.py` and `transit.py` guard with `dest.exists()` and write with
   `write_text` — every other product goes through `.part` + rename. A run
   killed mid-write leaves a truncated JSON that every later fetch keeps
   and that the bake crashes on until someone deletes it.
5. **The landmark order in `tileset.json` depends on the machine's
   locale.** `siteLandmarks` breaks ties with `a.name.localeCompare(b.name)`
   — no locale given — and the result (`extras.landmarks`, the HUD's
   list, which ties make the `limit` cut) goes into a content-hashed
   file. Committed Dresden data: 289 landmarks, 194 of them tied at
   `links = 2`, 118 names with ß/ü/ö. A build on a `de_DE` laptop and one
   on a `C.UTF-8` runner can produce a different `tileset.json` hash
   (every client re-fetches a tileset that did not change) and a
   different list. The Python ranking breaks ties by `id`.

## Current state

### 1 — provenance (`scripts/prepare-data.ts:945-957`, `lib/city/site-report.ts:70-112`)

```ts
const provenanceFile = publish(
  PROVENANCE_FILE,
  utf8(
    siteProvenance(
      readJson<ProvenanceRecord>(at(`${siteDataDir(SITE)}/provenance.json`)),
      baked.map((t) => t.id),
      SITE
    )
  )
);
```

`readJson` (`:176`) is `JSON.parse(readFileSync(path, "utf8"))`. The file
has a `HINT` constant used by `fail(...)` for missing sources (grep
`HINT` in the file). `tileReport` lists `sources` (DGM, CityJSON),
`required` side files, `absent` optional inputs and decides `next`
(`"ready" | "fetch" | "bake"`) — `provenance.json` appears nowhere in it.
`lib/city/provenance.ts` `siteProvenance(record, tiles, site)` — read
whether it tolerates an empty record (`{}`); the audit says it tolerates
missing members.

### 2 — the TIN (`scripts/bake-tiles.ts:308-324`, `scripts/bake-terrain-tin.ts:40-48`, `scripts/prepare-data.ts:655-668`)

```ts
  let tin: TerrainTin;
  try {
    tin = tinFromGrid(elevations, dgm.n, dgm.bounds, maxError);
  } catch {
    return null;
  }
```

```ts
  for (let i = 0; i < grid.length; i++) {
    if (!Number.isFinite(grid[i])) {
      throw new Error("terrain TIN: the source grid has NoData");
    }
  }
  const mesher = new Delatin(grid, n, n);
```

```ts
        if (tin) {
          return { ...tin, bounds: dgm.bounds };
        }
        log(`${tile}: the DGM has NoData, the fine level stays a grid`);
```

### 3 — the fetch (`pipeline/bake/fetch.py:89-100`, `:166-169`, `:178-195`)

```python
def _step(what: str, tile: Tile, dest: Path, make) -> None:
    if dest.exists():
        return
    try:
        make()
        print(f"{tile.id}: {what} → {dest}")
    except Exception as err:  # noqa: BLE001 — report, then fetch the rest
        print(f"{tile.id}: {what} not fetched ({type(err).__name__}: {err})")
```

```python
    cadastre.fetch(tile)
    traffic_sources.fetch(tile)
    bridge.fetch_wikidata(spec.raw, tile.id, tile.bounds, tile.epsg)
    landmarks.fetch_wikidata(spec.raw, tile.id, tile.bounds, tile.epsg)
```

`run(spec, tiles, lsc)` (`:181-195`) fetches the DLM (try/except, prints),
the OSM extract, the GTFS, then `fetch_tile` per tile, and returns `None`.
`scripts/pipeline.ts:127` exits with Python's status. `bridge.py:451-456`
and `landmarks.py:116-120` catch `OSError` around their SPARQL request.

### 4 — the caches (`pipeline/bake/landmarks.py:107-112, 142-146`, `bridge.py:431-437, 472-476`, `transit.py:199-210`)

```python
    dest = raw / "wikidata" / f"landmarks_{tile_id}.json"
    if dest.exists():
        return
    …
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {"source": "Wikidata (CC0)", "query": SPARQL, "landmarks": ranked}
    dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
```

(`bridge.py` is the same with `bridges`.) `transit.py`:

```python
    cache = folder / f"trams_{key}.json"
    if cache.exists() and cache.stat().st_mtime >= zip_path.stat().st_mtime:
        return json.loads(cache.read_text())
    feed = site_trams(zip_path, bounds, epsg)
    cache.write_text(json.dumps(feed))
    return feed
```

The `.part` convention elsewhere: `pipeline/bake/citygml.py:220-222`
(`tmp = dest.with_name(dest.name + ".part"); tmp.write_text(…); tmp.rename(dest)`),
`rasters.py:89-92`, `net.py:101-115`.

### 5 — the landmark order (`lib/city/landmarks.ts:77-80`)

```ts
  const ranked = [...byId.values()].sort(
    (a, b) => b.links - a.links || a.name.localeCompare(b.name)
  );
```

`pipeline/bake/landmarks.py:141`: `ranked = sorted(items.values(), key=lambda i: (-i["links"], i["id"]))`.
`lib/city/landmarks.test.ts` exists — read it for the fixture shape.

Conventions: TypeScript strict (`scripts/` run by bun); Python 3.12,
ruff (`E, F, I, B, UP, SIM`, line length 100); every writer through
`.part`; a failed fetch prints one line per product; tests beside the
module (`bun:test`) and in `pipeline/tests/` (pytest, `tmp_path`,
`monkeypatch`); Conventional Commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Python env | `cd pipeline && uv sync --locked` | exit 0 |
| TS unit tests (targeted) | `bun test lib/city/site-report.test.ts lib/city/landmarks.test.ts scripts/bake-tiles.test.ts` | pass |
| Pipeline tests | `bun run test:pipeline` | green |
| Typecheck | `bun typecheck` | exit 0 |
| The gate | `bun run verify` | exit 0 |
| A site report | `bun run site dresden` | prints per tile |

Do not run a real `bun run fetch` (network, gigabytes).

## Scope

**In scope** (the only files you should modify):
- `scripts/prepare-data.ts` (the provenance read only), `lib/city/site-report.ts`, `lib/city/site-report.test.ts`
- `scripts/bake-tiles.ts`, `scripts/bake-tiles.test.ts` (create or extend), `scripts/prepare-data.ts` (the one log line)
- `pipeline/bake/fetch.py`, `pipeline/bake/bridge.py`, `pipeline/bake/landmarks.py`, `pipeline/bake/transit.py`, `pipeline/tests/test_fetch.py`, `pipeline/tests/test_landmarks_structures.py` (or a new `test_caches.py`)
- `lib/city/landmarks.ts`, `lib/city/landmarks.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `pipeline/bake/__main__.py` and `prepare-data.ts`'s publish/cached
  writes — plan 040.
- `fetch.py` `cells()` — plan 057.
- `data/**` — nothing is re-baked here; the landmark order change
  (step 5) will change `tileset.json`'s hash on the next build, which is
  fine (it is generated, gitignored).
- `scripts/pipeline.ts` — it already exits with Python's status.

## Git workflow

- Branch: the branch you were given, or `plan/063-build-fetch-loud`.
- One commit per step, Conventional Commits (examples per step).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: A missing provenance record is tolerated and named

1. `lib/city/site-report.ts`: add the provenance file to what `tileReport`
   (or a site-level report — read `siteReport`) lists under `absent` with
   a hint, **not** under `missing` (it must not block `ready`: the record
   is hand-kept). Simplest: in `siteReport`, after the tiles, push a
   site-level note; if the type has no place for it, add
   `absentSiteFiles: string[]` to the report's type and print it in
   `scripts/site-report.ts`'s output ("provenance.json: absent — the
   inquiry cards show sources without editions; copy
   `data/dresden/provenance.json` and edit").
2. `scripts/prepare-data.ts`: read the record through a helper that
   returns `{}` (typed as an empty `ProvenanceRecord` — check the type;
   if its members are required, `siteProvenance` needs a `Partial`)
   when the file is absent, and logs one line:
   `` log(`${SITE.id}: no provenance.json — the cards name sources without editions`) ``.
   Any other read error (malformed JSON) still throws.

Test (`lib/city/site-report.test.ts`, following its existing `exists`
fake): a site whose every tile file exists but no `provenance.json` is
`ready` and reports the record as absent.

**Verify**: `bun test lib/city/site-report.test.ts` → pass; `bun typecheck` → exit 0;
`bun run site dresden` → unchanged output plus nothing about provenance (Dresden has one).
Commit: `fix(build): a site without a provenance record builds, and the report says so`.

### Step 2: Only NoData falls back to the grid

In `scripts/bake-tiles.ts` `tinTerrainMesh`: test the grid before meshing
and let everything else throw:

```ts
  if (elevations.some((z) => !Number.isFinite(z))) {
    return null;
  }
  const tin = tinFromGrid(elevations, dgm.n, dgm.bounds, maxError);
```

(`tinFromGrid` keeps its own check as a guard.) In `prepare-data.ts` the
log line stays accurate ("the DGM has NoData") because `null` now means
exactly that.

Test (`scripts/bake-tiles.test.ts` — read the existing tests for how a
DGM fixture is built; if none exists for `tinTerrainMesh`, add one with a
4×4 grid): a grid with one `NaN` → `null`; a grid where `tinFromGrid`
throws for another reason (monkeypatch by passing `maxError = NaN` or
`n = 0`, whichever makes Delatin throw — try and assert `toThrow`) →
the call throws.

**Verify**: `bun test scripts/bake-tiles.test.ts` → pass.
Commit: `fix(bake): only a NoData grid falls back to the grid level; any other TIN failure fails the build`.

### Step 3: The fetch exits non-zero when a required product failed; the extra fetches are guarded

In `pipeline/bake/fetch.py`:

1. `_step` returns `bool` (True when `dest` exists or was made, False on a
   failure) — keep its print lines.
2. `fetch_tile` returns the list of products that failed (DGM1 and LoD2
   are required; DOM1, DOP, the laser scan are optional — mark which in
   the calls; read the five `_step` calls to see their `what` strings).
3. Wrap the four extra fetches in `_step`-like guards (they have no
   `dest` to skip on — write a sibling `_try(what, tile, call)` that
   prints and returns False on any `Exception`).
4. `run()` collects the required failures per tile and, at the end,
   prints a summary and `raise SystemExit(1)` when any required product
   failed (the optional ones stay a printed line). `scripts/pipeline.ts`
   then exits 1 and a chained `&& bun run bake` stops.
5. `bridge.py` and `landmarks.py`: the `except OSError` around the SPARQL
   request becomes `except (OSError, ValueError, KeyError)` with the same
   printed line (a non-JSON answer, a binding without a label).

Test (`pipeline/tests/test_fetch.py`, with a fake adapter module via
`monkeypatch.setattr(fetch, "adapter", lambda provider: fake)` — read how
the existing fetch tests stub the adapter): a `dgm` that raises →
`run()` raises `SystemExit` with code 1 after trying the other products;
a `dop` that raises → no `SystemExit`.

**Verify**: `cd pipeline && uv run pytest -q tests/test_fetch.py` → pass.
Commit: `fix(fetch): a required product that failed fails the run; every per-tile fetch is guarded`.

### Step 4: The caches go through `.part`

In `landmarks.py` and `bridge.py` `fetch_wikidata`, and `transit.py`
`cached_site_trams`: write to `dest.with_name(dest.name + ".part")` then
`os.replace`/`rename` (copy `citygml.py:220-222`). In `load_wikidata`
(both files, `bridge.py:477`, `landmarks.py:148`): if `json.loads` raises
`ValueError`, delete the file and raise a clear `OSError(f"{path}: not JSON — deleted; run bun run fetch again")`.

Test (`pipeline/tests/test_landmarks_structures.py` or a new
`test_caches.py`, `tmp_path`): a truncated `landmarks_<tile>.json` makes
`load_wikidata` raise `OSError` and the file is gone afterwards; a
`monkeypatch`ed `fetch_text`/`urlopen` returning a small SPARQL JSON
writes the cache and leaves no `.part` behind.

**Verify**: `cd pipeline && uv run pytest -q tests -k "cache or wikidata"` → pass;
`bun run test:pipeline` → green.
Commit: `fix(fetch): the Wikidata and GTFS caches are written through .part and re-fetched when unreadable`.

### Step 5: The landmark tie-break is the id

`lib/city/landmarks.ts:79-80`:

```ts
  const ranked = [...byId.values()].sort(
    (a, b) => b.links - a.links || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
```

(the bake sorts by `id` too; ids are Wikidata `Q…` strings, compared by
code point on both sides — deterministic). Test (`lib/city/landmarks.test.ts`):
two landmarks tied on `links` whose names differ in a non-ASCII letter
(`"Äußere Neustadt"`, `"Zwinger"`) sort by `id` regardless of the
process's locale (set `process.env.LANG` is not enough to change JSC's
collation; the assertion is that the order equals the id order).

**Verify**: `bun test lib/city/landmarks.test.ts` → pass;
`grep -n "localeCompare" lib/city/landmarks.ts` → no match.
Commit: `fix(build): landmarks tie by id, so the tileset's hash does not depend on the build machine's locale`.

### Step 6: The gate

`bun run fix && bun run verify && bun run test:pipeline` → exit 0.

## Test plan

- Step 1: `site-report.test.ts` — ready without provenance, reported absent.
- Step 2: `bake-tiles.test.ts` — NaN → null; other errors throw.
- Step 3: `test_fetch.py` — required failure exits 1; optional does not.
- Step 4: cache tests — truncated cache deleted and raised; `.part` leaves nothing.
- Step 5: `landmarks.test.ts` — tie by id.
- Verification: `bun run verify` and `bun run test:pipeline` → green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "provenance.json" lib/city/site-report.ts` matches; `grep -n "no provenance.json" scripts/prepare-data.ts` matches
- [ ] `grep -n "catch {" scripts/bake-tiles.ts` shows no catch around `tinFromGrid`
- [ ] `grep -n "SystemExit" pipeline/bake/fetch.py` matches
- [ ] `grep -n "OSError, ValueError, KeyError" pipeline/bake/bridge.py pipeline/bake/landmarks.py` → both match
- [ ] `grep -n '\.part' pipeline/bake/landmarks.py pipeline/bake/bridge.py pipeline/bake/transit.py` → all three match
- [ ] `grep -n "localeCompare" lib/city/landmarks.ts` → no match
- [ ] `bun run verify` and `bun run test:pipeline` exit 0 with the new tests
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 063 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `siteProvenance` cannot take an empty record without a type change
  beyond `Partial` (report the type).
- `tinFromGrid` cannot be made to throw for a non-NoData reason in a test
  (then test the NaN branch only and say so).
- The existing fetch tests stub the adapter in a way step 3's test cannot
  reuse (report; do not restructure the fetch module to fit the test).
- A committed `data/_raw` cache exists in the tree (it must not; if a
  `wikidata/*.json` is tracked, report before touching the writer).

## Maintenance notes

- A new per-tile fetch goes inside `_step`/`_try`; a new cache writer
  goes through `.part`; a new required product is named in `fetch_tile`'s
  required list so the run fails on it.
- The TIN fallback is now exactly NoData; a tile whose DGM has holes still
  gets the grid (backlog: "DGM NoData blended by the resample").
- Step 5 changes `tileset.json`'s content for tied landmarks: the first
  build after it re-publishes the tileset once (content-hashed name).
- Reviewer: `bun run site --all` should still list every committed site as
  ready; the provenance line appears only for a site without the record.
