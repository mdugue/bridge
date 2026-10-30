# Plan 072: A cold build bakes a site's tiles on every core

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Step 1 is a measurement that can change the order of what
> follows — honour its gate. If anything in the "STOP conditions" section
> occurs, stop and report — do not improvise. When done, update the status
> row for this plan in the plans index — unless a reviewer dispatched you
> and told you they maintain it.
>
> **Drift check (run first)**:
> `git diff --stat 85a41b7..HEAD -- scripts/prepare-data.ts scripts/prepare-sites.ts scripts/bake-tiles.ts scripts/bake-terrain-tin.ts lib/city/terrain-tin.ts docs/data-pipeline.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status (2026-10-10)**: **PARTIAL — the warmers showed no gain on
  Vercel and are opt-in** (`PREPARE_WARMERS=1`). Built: steps 1, 3–6 on
  `266bb89` (the performance PR's base); step 2 skipped by its gate.
  Measured on Vercel's builder (4 cores, 8.6 GB; `process.constrainedMemory()`
  reports the 8.6), cold builds of all seven sites, `prepare-sites`:
  main 235 s (#149's production build) and 232 s (its preview); the
  warmers 322 s; this plan's default schedule 387 s. The builders
  differed: Next's static pages, which none of this touches, took 7.5–8.7 s
  in main's builds and 11.3–11.9 s in the branch's, so these single builds
  cannot settle a difference under ≈ 40 %. What the logs do show: at 3 GB a
  tile warmer, two run at once in 6.9 GB — the parallelism main already
  gets from two sites side by side —, the smaller sites held the slots
  until t ≈ 95 s while Dresden's ground warmers waited, and the warmers'
  31 processes cost ≈ 10 % more CPU. On one box, alternating, the default
  schedule costs main's CPU (Grimma 28.6/28.7 s, Hamburg 59.7/60.1 s of
  user time; main/branch). So the default is main's schedule again (one
  process per site, counted at 3 GB, largest first — two at once on that
  builder, four on CI's 16.8 GB runner; against 80 % of the memory where
  main counted all of it, so one fewer on a 12–15 GB box); on by default:
  atomic cache entries (two sites already baked
  side by side into one cache), each tile's fine ground as its own entry,
  the timing lines. The local numbers below came from a box shared with
  other agents' e2e runs.
  - **Step 1** (cold, all seven sites side by side, Dresden one process,
    load ≈ 7): Dresden's 15 tiles — buildings 268.9 s, fine 265.3 s (of
    which the site ground's first call, fifteen TINs, 202.7 s), coarse
    31.8 s; line levels 105.6 s (20 s alone), side files 34.1 s. The
    whole-run CPU profile could not run on the shared box (the profiler
    held 8–12 GB within 2–5 min); the two warmers were profiled instead:
    a ground warmer is Delatin (`_findCandidate`, `_queueLess`,
    `_legalize`, `_queueRemove`) and the DGM's LZW (`decompress`,
    `getNext`, `appendReversed`); a tile warmer (the heaviest tile)
    `rayHit` (lib/city/doors.ts) 5.9 %, `unionArea` (object-facts.ts)
    4.2 %, `set` 4.2 %, glTF-Transform's `hashLookup` 4.0 %, meshopt's wasm
    3.8 %, `quantizeAttribute` 3.6 %, `compactAttribute` 3.1 %, `gzipSync`
    2.9 %, `murmurHash2` 2.6 %, `hashLookup` 2.3 %.
  - **Step 2 skipped**: gz is not in the top 3 (11.0 s over Dresden's 45
    glbs at level 9; level 6 5.4 s, +0.98 % bytes — and it would change
    every `.glb.gz`, which the byte-identical output forbids).
  - **Step 3**: atomic entries (`scripts/bake-cache.ts`); each tile's fine
    ground cached (`scripts/ground-pack.ts`, `ground_<t>.bin`, ≈ 6.7 MB a
    Dresden tile); the site ground reads a tile's heights only once a point
    asks. To rebuild the mesh from the entry, `scripts/bake-tiles.ts` (out
    of this plan's scope) splits its two meshers into their shaping and
    meshing halves (`fineTin` + `tinMesh`, `shapeGrid` + `gridMesh`),
    computing the same — the manifests prove it.
  - **Steps 4–5, with deviations**: one tile per warmer, not K round-robin
    lists (a process's memory grows with every tile it bakes: all fifteen
    in one, 4.3 GiB; the heaviest tile alone, 2.7 GB — and a slot that
    frees late still finds a tile); admission by cores and by memory
    (`warmers.ts` `bakeLimits`: 80 % of the memory or the container's
    limit, a tile warmer counted at 3 GB, any other bake at 1.6 GB), with
    `PREPARE_MEMORY_GB` beside `PREPARE_JOBS`; the smaller sites first
    (each is one process that cannot be split); a `--if-cached` plain run
    first, so a warm build runs no warmer (it had made a warm build of all
    sites 9.3 → 22.3 s), the first warmer in its slot.
  - **Measured** on a shared 4-core, 15 GB box (other agents' e2e; load
    12–19), cold, all seven sites, back to back: main 1115 s, the branch
    1206 s wall — the box's CPU bound both, not their parallelism; the
    bakes' CPU 836 s (main) and 916 s (the branch: +10 %, 31 processes'
    start-up). From each bake's measured CPU time, on an idle machine:
    main ≈ 491 s (Dresden's one process) → the branch ≈ 280 s on four
    cores; on a 4-core, 8 GB builder (main runs two jobs there) 491 →
    ≈ 340 s. Warm: 9.1 → 9.8 s for all sites (loaded), 3.5 s for Dresden;
    a warm build runs no warmer. The last cold run (the first warmer in
    the probe's slot: it started at 6 s) again matched every manifest.
    Peak RSS: Dresden in one process 4.5–4.9 GiB, a tile warmer at most
    2.7 GB; all sites cold as on an 8 GB builder (`PREPARE_MEMORY_GB=8`):
    4.07 GB summed (main at its default on the 15 GB box: 5.3–6.2 GB).
    Every `manifest.json` identical to main's, seven sites, every cold run.
  - Backlog: a finer L0 key, and tile warmers admitted by a size-based
    estimate ([README](./README.md), 2026-10-10 list).

- **Priority**: P2
- **Effort**: M–L
- **Risk**: MED (concurrent cache writes; build-machine memory)
- **Depends on**: none
- **Category**: perf (build time) / DX
- **Planned at**: commit `85a41b7`, 2026-10-10

## Why this matters

`bun run build` is `prepare-sites.ts` + `next build` + the Sentry release.
A cold build measured on this repo at `85a41b7` (4 cores, 15 GB, all seven
committed sites, empty `.cache/prepare-data`):

| Phase | Time |
|---|---|
| `prepare-sites` — six sites (1–4 tiles each), side by side | done by 135 s |
| `prepare-sites` — **Dresden, 15 tiles, one process** | **414 s** (the whole phase: 419 s) |
| `next build` (Turbopack compile 28 s, TypeScript 6 s, 119 static pages 18.6 s) | 61 s |

So 87 % of a cold build is **one single-threaded process baking Dresden's
15 tiles one after another** (`scripts/prepare-data.ts:1042–1066`), with
three cores idle for its last ~280 s. And "cold" is common: the cache key
of an artifact walks every module its bake imports (plan 061), and every
fine terrain level's key covers **every** tile's terrain inputs
(`prepare-data.ts:935`, `TILES.flatMap(terrainInputs)`, ADR 0030: "changing
one tile's walls, stairs or DGM re-bakes every tile's L0"), so any edit to
a shared bake module (`lib/city/windows.ts`, `stairs.ts`, `walls.ts`, …)
re-bakes all of Dresden. Splitting a site's tiles over the machine's cores
should bring the long pole from ~7 min to ~2–2.5 min on four cores.

## Current state

- `scripts/prepare-sites.ts:82–103` runs one `prepare-data.ts <site>`
  process per site, largest first, `jobs = min(sites, cores,
  floor(totalmem / 3e9))`; its comment: "A cold bake peaks at ~3 GB
  (Dresden; the others ~1 GB)". (Observed here: Dresden's process at
  ~4.0 GB RSS.)
- `scripts/prepare-data.ts` is one top-level module (no functions exported):
  - Cache dir (lines 159–162): `.cache/prepare-data` (or
    `.next/cache/prepare-data` on Vercel). `cached(name, key, bake)` (lines
    298–316) writes with `writeFileSync` (not atomic) and first **deletes
    every other entry with the same `name`** ("one entry per name").
  - Phase 1, side files: the loop at line 456 over `TILES`.
  - Site-wide values computed once before the tile loop: `frame` (the
    shared recenter offset, cached as `frame.json`, line 620),
    `lineLevels` (cached `line-levels-<site>.json`, line 411), `passages`.
  - `shapedTerrain(tile, level)` (lines ~728–775) is **memoised in process
    only** (a `Map` of promises); `siteGround()` (lines 783–793) awaits the
    fine level of **every** tile, because `fineChildren` (lines 798–824)
    stands each tile's walls, kerbs, stairs and fences on the whole site's
    ground.
  - Phase 2, the serial tile loop (lines 1042–1066):
    ```ts
    for (const [i, tile] of TILES.entries()) {
      const city = await bakeCity(tile);
      footprintFiles.set(tile, city.footprints);
      const fine = await bakeTerrain(tile, 0);
      const coarse = await bakeTerrain(tile, 1);
      ...
      Bun.gc(true);
    }
    ```
  - `gz()` (lines 637–644): `Bun.gzipSync(bytes, { level: 9, library: "libdeflate" })`.
- Bun supports `--cpu-prof` / `--cpu-prof-md` (`bun --help`).
- Plan 040 (open, drifted) also wants atomic `prepare-data` writes; step 3
  here does the cache's half of that.

Conventions: build scripts are TypeScript run by Bun; logs go through the
file's `log()` (stdout, `prepare-data: …`); `fail()` exits non-zero.
Scripts' pure helpers are tested in `scripts/*.test.ts` (exemplar:
`scripts/bake-sources.test.ts`).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Cold Dresden bake | `rm -rf .cache/prepare-data && time bun scripts/prepare-sites.ts dresden` | exit 0, prints the wall time |
| Profile | `bun --cpu-prof-md --cpu-prof-dir=/tmp/prof scripts/prepare-data.ts dresden` (with an empty cache) | a markdown profile in `/tmp/prof` |
| Unit tests | `bun run test` | all pass |
| Typecheck / lint | `bun typecheck && bun run fix && bun lint` | exit 0 |
| Same output check | see step 6 | identical manifests |

## Scope

**In scope**: `scripts/prepare-data.ts`, `scripts/prepare-sites.ts`, a new
`scripts/prepare-warm.ts` if you prefer a separate entry (optional),
`scripts/*.test.ts` for any pure helper you extract,
`docs/data-pipeline.md` (the build-step section), AGENTS.md's one line on
the cold-run time.

**Out of scope**: the bakes' algorithms (`bake-city-mesh.ts`,
`bake-tiles.ts`, `bake-terrain-tin.ts`, `lib/city/*`) — this plan changes
*where and when* they run, not what they compute; the Python pipeline;
`next build`.

## Git workflow

- Branch: `perf/072-parallel-site-bake`
- Conventional Commits, e.g. `perf(build): bake a site's tiles side by side`.

## Steps

### Step 1: Measure where Dresden's 414 s go

Add per-tile, per-artifact timings to the tile loop (lines 1042–1066):
`log(\`${tile}: city ${ms} ms, fine ${ms} ms, coarse ${ms} ms\`)`, and time
`siteGround()`'s first call. Keep them (they are cheap and useful). Then,
with an empty cache, run
`bun --cpu-prof-md --cpu-prof-dir=/tmp/prof scripts/prepare-data.ts dresden`
and record the top 10 self-time functions.

Record in the PR: the three per-tile columns summed over the 15 tiles,
`siteGround()`, and the profile's top 10. Gate for step 2: if `gz` is in
the top 3, do step 2; otherwise skip it.

**Verify**: the table is in the PR; `bun typecheck` exit 0.

### Step 2 (gated): A cheaper gzip

Measure `level: 6` against `level: 9` on Dresden's glbs (time and total
bytes, printed by a throwaway script you do not commit). If level 6 is
≥ 2× faster for ≤ 2 % more bytes, switch to it and say so in `gz()`'s
comment with the numbers. Otherwise leave it.

### Step 3: Atomic cache writes and a cached site ground

1. `cached()`: write to `${path}.${process.pid}.part` and `renameSync` it
   into place; when deleting stale entries of the same `name`, skip files
   ending in `.part` and the entry you are writing. Two processes writing
   different names must never delete each other's files; two writing the
   same name must leave one complete file.
2. Persist each tile's **fine shaped terrain** in the cache, so a process
   that needs the whole site's ground loads it instead of building fifteen
   TINs: in `shapedTerrain(tile, 0)`, cache (through `cached`, keyed on
   the tile's `terrainInputs` + `GROUND_BAKE` + `offset` + its passages)
   the minimum that rebuilds `heightAt` and `input` — the TIN's vertex
   positions, triangle indices, bounds, min/max elevation and `tin`
   metadata, as one binary blob — and on a hit rebuild the height index
   from it (`lib/city/terrain-tin.ts` `TinIndex` — read how
   `tinTerrainMesh` in `scripts/bake-tiles.ts:304–330` builds it and reuse
   that constructor). If `TerrainMesh.input` cannot be rebuilt from such a
   blob without re-running the bake's code paths, cache only what
   `heightAt` needs and keep building `input` where the glb is written.

**Verify**: `bun run test` → pass; a second `bun scripts/prepare-sites.ts
dresden` right after a cold one is still fast (a warm run ≈ 1–2 s, as
plan 061 measured); a cold run produces the same `manifest.json` as before
this step (step 6's check).

### Step 4: Two warm-only modes for a subset of tiles

A fine level's glb stands its walls, kerbs, stairs and fences on the
**whole site's** fine ground (`siteGround()` → `shapedTerrain(t, 0)` for
every tile). If tile bakes run side by side before every tile's fine
ground is cached, each process builds most of the fifteen TINs itself (×K
work, ×K memory) and they race on the same cache names. So the warm-up has
two phases, and phase B must start only after phase A has finished for
**every** tile:

- **Phase A — `--warm-ground=<tile>,<tile>,…`**: compute only the
  site-wide values the ground needs (frame, line levels, passages) and
  `shapedTerrain(tile, 0)` for the listed tiles, which step 3 caches.
  Nothing else.
- **Phase B — `--warm=<tile>,<tile>,…`**: compute the site-wide values as
  the full run does (frame, line levels, passages, side files' names —
  all cache hits by now), then `bakeCity`, `bakeTerrain(…, 0)` and
  `bakeTerrain(…, 1)` for the listed tiles only. Every `siteGround()` call
  here must be a cache hit: log a line `ground <tile>: built` from
  `shapedTerrain` when it actually builds a TIN (not on a hit).

Both modes **publish nothing**: no writes under `public/data/<site>/`, no
manifest, no pruning, no tileset. Guard `publish()` and the final phases
with the mode, so a warmer can never prune what another process wrote.

**Verify**: with an empty cache,
`bun scripts/prepare-data.ts dresden --warm-ground=33412_5656_2_sn` → exit
0 and the cache gains that tile's fine-ground entry only; after warming
the ground of all tiles,
`bun scripts/prepare-data.ts dresden --warm=33412_5656_2_sn` → exit 0,
**no** `ground … built` line in its output, `public/data/dresden`
untouched (`ls -la` timestamps unchanged), and the cache gains that
tile's `city_*.glb.gz`, `terrain_*_l0.glb.gz`, `terrain_*_l1.glb.gz`
entries.

### Step 5: prepare-sites runs the warmers

For a site with more than 4 tiles, `prepare-sites.ts`:

1. runs `prepare-data.ts <site> --warm-ground=<first tile>` alone (it
   fills the site-wide caches: frame, line levels);
2. runs phase A over the remaining tiles in K parallel processes
   (round-robin tile lists) and **waits for all of them**;
3. runs phase B over all tiles in K parallel processes and waits;
4. runs the normal `prepare-data.ts <site>` (all hits: it publishes).

K comes from the same budget as today —
`min(cores, floor(freeMemory / perWarmer))` — with `perWarmer` measured in
step 1 (log `process.memoryUsage().rss` at the end of a warmer and take
the max; start from 2 GB if you have no number). The small sites keep
running one process each, as now, and the total of running processes never
exceeds the budget.

**Verify**: `rm -rf .cache/prepare-data && time bun scripts/prepare-sites.ts`
on a 4-core machine → exit 0; `grep -c "ground .* built"` over the phase-B
and final-run output → 0; the wall time is recorded in the PR next to
step 1's 419 s. Expected: Dresden's share falls to roughly a third.

### Step 6: Same output, documented

1. Prove the bake is unchanged: run the full cold build on `main` and on
   the branch into two copies of `public/data` and compare
   `jq -S . public/data/<site>/manifest.json` for every site — identical
   (content-hashed names make this a byte-for-byte check of every artifact).
2. `docs/data-pipeline.md`: describe the warmers and the cached site ground;
   update AGENTS.md's "cold run ≈ 6 min for fifteen tiles" with the new
   measured number.

**Verify**: the manifests are identical; `bun run test` → pass.

## Test plan

- A unit test for the tile split (round-robin of N tiles into K lists,
  every tile once) if you extract it as a pure helper in
  `scripts/prepare-sites.ts` → test in `scripts/prepare-sites.test.ts`
  (pattern: `scripts/bake-sources.test.ts`).
- A unit test for the atomic `cached()` behaviour if you extract it into a
  small module (two "processes" simulated by two calls with the same
  `name`: one complete file remains, no `.part` left).
- The end-to-end check is step 6's identical manifests.

## Done criteria

- [ ] `bun typecheck`, `bun lint`, `bun run test` exit 0
- [ ] Cold `bun scripts/prepare-sites.ts` wall time recorded before (419 s here) and after
- [ ] Every site's `manifest.json` identical between `main` and the branch (cold builds)
- [ ] A warmer never writes under `public/data/` (step 4's check)
- [ ] Every `siteGround()` call in phase B and in the final run is a cache hit (no `ground … built` line after phase A)
- [ ] `docs/data-pipeline.md` and AGENTS.md updated
- [ ] No files outside the in-scope list modified

## STOP conditions

- Drift in the excerpts.
- Step 6's manifests differ (the parallel bake changed an artifact): find
  which and report — do not "fix" by changing a bake.
- Peak memory of the warmers together exceeds the machine (a process is
  OOM-killed, or swap is used heavily): report the per-warmer RSS.
- The site ground cannot be cached without changing what `fineChildren`
  computes.

## Maintenance notes

- Anything new that is site-wide (computed from every tile) must be cached
  before the warmers start, or every warmer computes it again.
- The L0 key covering every tile's inputs stays (ADR 0030); this plan only
  makes the resulting cold re-bake parallel. A finer key (a tile's L0 on
  its neighbours' inputs only) is a separate, later idea — record it in
  the backlog.
- Vercel's build machine size decides K; log K at the start of
  `prepare-sites` so a slow deploy shows why.
- Optional, tiny: `next build` type-checks again (6 s) what CI's
  `bun typecheck` job already checks; `typescript.ignoreBuildErrors` in
  `next.config.ts` would drop that — a maintainer's call (AGENTS.md: "One
  TypeScript … `next build` type-checks with").
