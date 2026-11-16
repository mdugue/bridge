# Plan 088 [rewrite]: The tileset is a published product, named by a lock file; the web build bakes nothing and `data/` leaves git

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and AGENTS.md
> first. This plan has five phases, each one PR; phase 0 is a spike and
> three decisions of the maintainer, and nothing after it starts before
> they are written into this file's *Findings*. Run every **Verify**
> before the next phase. On a STOP condition, stop and report. Update
> this plan's row in `docs/plans/README.md` after each phase.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- scripts/prepare-sites.ts scripts/prepare-data.ts scripts/prepare/context.ts scripts/publisher.ts scripts/shared-cache.ts scripts/warmers.ts scripts/site-choice.ts app/_lib/built-sites.ts lib/city/site-index.ts app/_components/fetch-optional.ts app/_components/city-walk-client.tsx next.config.ts .gitignore .github/workflows/ci.yml`
> — on a change, compare *Current state* with the code before going on.

## Status

- **Priority**: P1 — second in the series, and what plans 090–093
  publish into
- **Effort**: M, plus storage and traffic that are paid every month
- **Risk**: MED — a new piece of infrastructure, a credential, and the
  step that removes the data from git cannot be tried halfway
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (the ledger
  the byte figures go into; the plates that tie a picture to a data
  version)
- **Category**: rewrite — less complexity (build and deploy), fewer
  bytes on the wire (transport compression, if phase 0 measures a
  gain); beside the aims: the repository's size and the build's time
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: IN PROGRESS — phase 0: step 1 measured (brotli clears
  the 3 % line), decisions 1–3 prepared in *Findings*, waiting for the
  maintainer (2026-11-16)

## Why this matters

The baked data lives in git and is baked a second time inside every web
build. `data/` holds 937 MB and the pack is 1.2 GiB after eighteen days
(2026-11-16); a cold `prepare-sites` takes 360 s on four cores (audit
2026-11-11) and has to be squeezed, one tile a process, into the host's
8.6 GB builder (`scripts/warmers.ts`); every deployment carries 561 MB of
`public/data` again. ADR 0037 already says it: "Beyond a handful of
committed cities, site data should move out of git (a release asset or
object storage) — not decided yet." The files are content-hashed and
immutable since ADR 0024, so the step is small in code: publish them once
to a store, let a small lock file in git say which ones a commit runs on,
and let the web build read the lock. The rest of the series needs it:
092's binary tables must never enter git, 091's raw rasters only pay
when the store compresses them, and 093 multiplies the number of files.

## Current state

Read these before changing anything; the roles are as of `5dfa300d`.

- `scripts/prepare-sites.ts` — runs before `next dev` and `next build`
  (`package.json`, scripts `dev` and `build`). Picks every site whose
  data is on disk (`isReady`, through `siteReport`), runs
  `scripts/prepare-data.ts <site>` for each (`prepareAll`), writes
  `public/data/sites.json` (`SiteIndex`: per site `id`, `map`,
  `tileset`, `stats`), copies each site's Stadtwissen to `.stadtwissen/`
  for the chat's function (`publishServerWissen`) and prunes.
- `scripts/prepare-data.ts` and `scripts/prepare/*.ts` — the TypeScript
  bake of one site: `data/<site>/` in, `public/data/<site>/` out.
  `scripts/prepare/context.ts` is its plumbing: `OUT_DIR`, `CACHE_DIR`
  (`.cache/prepare-data`; on Vercel `.next/cache/prepare-data`),
  `cacheKey` (`createKeyMaker`, `scripts/cache-keys.ts`), `cached`.
- `scripts/publisher.ts` — `createPublisher(outDir, …)`: `publish`
  writes a file as `<stem>.<8 hex of sha1>.<ext>` (`hashedName`;
  `.glb.gz`, `.pts.gz`, `.crw.gz` keep both suffixes), `finish` writes
  `manifest.json` (`{ version: 1, files: { logical: hashed } }`) and
  prunes what the run did not name.
- `scripts/shared-cache.ts` (a second bake cache in Vercel's Remote
  Cache, its token `VERCEL_ARTIFACTS_TOKEN` passed by Vercel's build
  alone) and `scripts/warmers.ts` (`bakeLimits`, `warmSteps`: one tile a
  process, so the peaks fit the builder) exist because the deploy bakes.
- `lib/city/site-index.ts` — `siteDataBase(id)` returns `/data/${id}`:
  the one place the served base is made. `app/_lib/built-sites.ts`
  (`builtSites`, `firstFetches`) reads `public/data/sites.json` at build
  time for the routes' static params and preloads
  `/data/<site>/manifest.json`.
- `app/_components/city-walk-client.tsx` fetches
  `${base}/manifest.json`, looks the tileset up in it, and every other
  URL resolves relative to the tileset's. The scene fetches from a
  worker (ADR 0061).
- `app/_components/fetch-optional.ts` — `isGzipped` and `inflate`: a
  `.gz` body is inflated with `DecompressionStream("gzip")` "unless the
  host already did". The comment in `tile-content-fetch.ts` gives the
  reason: "static hosts do not compress binary types".
- `lib/city/fetch-retry.ts` (ADR 0048): 404 and 410 mean absent; 408,
  425, 429, 5xx and network errors are retried; any other is fatal.
- `next.config.ts` — `/data/:path*` is served `immutable` for a year,
  each `manifest.json` and `sites.json` `no-cache`;
  `outputFileTracingExcludes` keeps `public/data` out of the functions.
- `.gitignore` — `/data/*` is ignored and seven folders are un-ignored
  by name (`!/data/dresden/` … `!/data/unna/`).
- `.github/workflows/ci.yml` — the unit job keys a cache by
  `git rev-parse HEAD:data/dresden/dgm`; the e2e job's `bun run build`
  bakes from the checkout's `data/`, its bake cache is keyed by
  `hashFiles('data/**', …)`, and its scope step lists `data`.
- Tests bound to the data: 24 test files name a site's folder (`grep
  -rlE "siteDataDir|sideFileSource|wallSourceFile|kerbSourceFile|data/dresden|dgm-cache|readDgm\(|tileSources\("
  lib app scripts --include=*.test.ts`), and more reach it through
  helpers; several walk every site on disk (`features.test.ts`:
  `SITES_BAKED`, `bake-files.test.ts`, `tile-data.test.ts`).
  `pipeline/tests/test_committed.py` globs the committed files and
  fails on an empty glob.

Sizes on 2026-11-16 (`du`): `data/dresden` 506 MB (DGM 204, `dlm/` 176,
CityJSON 119), `muenchen` 119, `leipzig` 113, `hamburg` 81, `unna` 54,
`grimma` 40, `meissen` 27. Dresden's spawn tile `33412_5656_2_sn`: DGM
13.0 MB, `dlm/` 11.6 MB, CityJSON 9.3 MB, `dop/` 0.3 MB.

What ADR 0037 promises today and this plan replaces: "Clone, `bun
install`, `bun dev` works without GDAL or a download", and "a re-bake is
a maintainer action and shows up as a data diff".

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Gate | `bun run verify` | lint, both type checks and the units pass |
| Build | `bun run build` | exit 0 |
| E2E | `bun run test:e2e` | all pass (CI runs the shards) |
| One site's bake | `bun scripts/prepare-sites.ts dresden` | `public/data/dresden/manifest.json` written |
| Python tests | `bun run test:pipeline` | pytest and ruff pass |

## Scope

**In scope**

- `scripts/publisher.ts`, `scripts/prepare-sites.ts`,
  `scripts/prepare/context.ts`, `scripts/shared-cache.ts`,
  `scripts/site-choice.ts`; new, with tests: `scripts/data-store.ts`,
  `scripts/publish-data.ts`, `scripts/data-pull.ts`,
  `scripts/data-lock.ts`; `data.lock.json` at the repository's root
- `lib/city/site-index.ts`, `lib/city/tile.ts` (the manifest's names),
  `app/_lib/built-sites.ts`, `app/_components/city-walk-client.tsx`,
  `app/_components/fetch-optional.ts` (phase 5 only), `next.config.ts`,
  `package.json` (scripts), `.gitignore`
- `.github/workflows/ci.yml` and one new workflow that publishes
- `app/(legal)/datenschutz/page.mdx`; ADRs 0001, 0024, 0037, 0048;
  `docs/data-pipeline.md`, `docs/portability.md`, `docs/routines.md`,
  AGENTS.md, the `add-city` skill

**Out of scope**

- `pipeline/` — the Python bakes write `data/<site>/` as they do.
- The format of any file (plans 090, 091, 092). The publisher and the
  lock must not care what a file holds.
- `data/_raw/` — the bulk downloads stay on the machine that fetched
  them; they are never published.
- **git's history.** Removing the files leaves every old version in
  the pack; shrinking it rewrites history under 23 open pull requests
  (2026-11-16) and every clone. The maintainer's decision, no step here.
- A service worker over the store (the README's Direction item 7).

## Phases

### Phase 0 — a spike and three decisions (no merge)

1. **What does transport compression buy?** Build Dresden
   (`bun scripts/prepare-sites.ts dresden`) and compare, by kind
   (`.glb.gz`, `.pts.gz`/`.crw.gz`, `.png`, `.webp`, JSON and GeoJSON),
   what the production host sends today (`curl -sI -H
   'Accept-Encoding: br, gzip'` on three files a kind: the
   `content-encoding` and the size) with brotli and zstd at a high
   level over the bytes *before* any gzip. The table goes into
   *Findings* and 087's ledger. Under 3 % for the whole site, phase 5
   is not built and the files are published as they are.
2. **Decision 1 — the store.** Put a short table to the maintainer.
   A candidate must set `Content-Encoding` and `Cache-Control: …
   immutable` on each object, answer a missing object with 404
   (`fetch-retry.ts` reads any other status as fatal or transient),
   serve many small requests at once over HTTP/2 or 3, and take writes
   with a credential scoped to this store. It costs storage for every
   version ever published (a re-bake adds only what changed) and
   traffic. Assert no host's behaviour from memory: try ten files on
   each candidate.
3. **Decision 2 — the site's own origin, or a second one.** Either
   `/data/*` on the site's host is forwarded to the store (the browser
   meets no new host; no CORS; the store is a processor behind the
   host), or the store has its own host name (then: CORS for the
   worker's fetches, `images.remotePatterns` for `next/image`, and a
   new section on the privacy page). ADR 0043 binds both: "a new
   request to a third party … is not done until `datenschutz/page.mdx`
   says so." Try the forwarding with the ten files: is the
   `Content-Encoding` passed through, is the answer cached at the
   edge, what does a missing object answer.
4. **Decision 3 — who publishes.** The TypeScript bake leaves the
   deploy. It runs in a CI job that holds the write credential and
   commits the lock to the pull request's branch, or by hand (`bun
   scripts/publish-data.ts`, on the maintainer's machine or in an
   agent's session given the credential). Recommended: the job, the
   command as the way out. The credential is a secret of the CI or
   the session, never in the repository, a log or this file.

**Verify**: *Findings* holds the size table, the three decisions with
the maintainer's name and date, and the ten-file trial's answers.

### Phase 1 — publish beside git (nothing reads it yet)

1. `scripts/data-store.ts`: `has`, `put`, `get` against the store,
   behind an interface with a directory-backed twin for tests and
   local trials (as `shared-cache.ts` has `BAKE_SHARED_CACHE_API`). A
   write that fails fails the run.
2. `scripts/publish-data.ts <site…>`: after a normal bake, upload every
   file the site's manifest names to `tiles/<site>/<hashed name>` when
   it is not there (the same bytes are the same name: never overwrite,
   never delete), then the manifest itself under its own hash
   (`manifest.<hash>.json` — a manifest is then immutable too).
3. The **source set**: the same for `data/<site>/` as the bakes wrote
   it — each file under `sources/<sha256>`, and a list
   `sources/<site>.<hash>.json` (path, sha256, bytes). `provenance.json`
   and the credits travel in it: attribution is part of the data.
   `scripts/data-pull.ts <site…>` writes `data/<site>/` back from a
   list, checks every hash, and leaves a file that is already right.
4. `data.lock.json`: per site the tileset's manifest hash, the source
   list's hash, the site's index entry (`SiteIndexEntry`: `map`,
   `tileset`, `stats`) so that a build needs nothing but git, and from
   phase 3 the `key` it was built from; the store's base address once,
   at the top. Sorted keys, one site a block, so that two pull
   requests that touch two sites merge.
5. CI, after its build: `bun scripts/publish-data.ts --check` compares
   the manifest just built from git's `data/` with the lock's. Equal
   proves that what is published is what git bakes.

**Verify**: `bun run verify` passes with new tests for the store's
twin, the lock's reader and `--check`; `--check` passes in CI for all
seven sites; `bun scripts/data-pull.ts meissen` into an empty folder
gives a tree `diff -r` finds equal to git's.

### Phase 2 — the viewer and the web build read the lock

1. `siteDataBase` takes its base from the lock; `DATA_ORIGIN=local`
   keeps `/data/<id>` from `public/data` for a site baked on the
   machine. `builtSites` reads the lock, not `public/data/sites.json`.
2. The page names the hashed manifest and preloads it with the
   tileset, as `firstFetches` does. The manifest is immutable now, so
   the one `no-cache` round trip a visit goes. (The viewer picks the
   tileset or `tileset-spawn.json` and the map picture from it; skip
   the manifest altogether only if nothing else reads it.) ADR 0048's
   item 5, "the manifest falls back only to the browser's cached
   copy", is rewritten: no unhashed file is left to fall back from.
3. `bun run build` is `next build` alone unless `DATA_ORIGIN=local`.
   `bun dev` in a fresh clone serves every published site from the
   store, with no bake and no download; `PREPARE_SITES=dresden bun dev`
   bakes that site on the machine as today (from phase 4 on, once its
   sources are pulled).
4. The chat's function reads a copy of each site's Stadtwissen from
   `.stadtwissen/` (`next.config.ts`, `outputFileTracingIncludes`).
   The build fetches those few files by the lock's hashes and checks
   them; a mismatch fails the build.
5. CI's e2e job keeps baking with `DATA_ORIGIN=local` (from git's
   data, after phase 4 from pulled sources): it is the check that the
   bake's code works. One smoke spec in the build-check shard loads a
   site from the store, so its path (encoding, CORS or forwarding) is
   tested too.
6. The privacy page says what decision 2 made true, before this merges.

**Verify**: a preview deployment streams `/dresden` from the store
(the network panel shows the store's address or the forwarded path, and
no unhashed `manifest.json`); the deploy's log shows no `prepare-sites`
line; `bun run test:e2e` passes; the ledger gets the deploy's build
time and the first load's requests, before and after.

### Phase 3 — the lock is kept honest

1. `scripts/data-lock.ts check`, without one byte of data: a site's
   tileset is current when the lock's `key` equals a hash over the
   source list's hash, the text of every module any bake entry reaches
   (`scripts/bake-entries.ts` through `moduleGraph`), their locked
   package versions (`lockedVersions`), the site's config,
   `sites/providers.ts` and `patches/`. It is coarser than the
   artifact keys on purpose: it only says "publish again", and the
   publishing run still bakes only what its own keys miss.
2. The check is a required CI check. The publishing workflow (decision
   3) runs when it fails: pull the sources (cached by their hash),
   restore `.cache/prepare-data`, bake, upload, write the lock.
3. **A re-bake without a git diff.** A pull request that changes a
   site's sources changes two hashes in the lock. The publishing job
   writes what a reviewer needs into it: per kind and tile the files
   added, removed and changed with their sizes, for GeoJSON and JSON
   the features that differ (`scripts/eval/compare-bakes.py` does it
   by content for the vegetation files: the pattern), and the result
   of the data tests on the new set. 087's plates, which record the
   lock's hashes, show the picture on the preview.

**Verify**: a trial pull request that edits a comment in
`lib/city/tile.ts` fails the check, the workflow republishes and it
passes; one that edits `app/_components/minimap.tsx` passes at once.

### Phase 4 — `data/` leaves git but for a fixture

1. The fixture: Dresden's spawn tile `33412_5656_2_sn` (its files under
   `cityjson/`, `dgm/`, `dlm/`, `dop/`) and the site's small files
   (`provenance.json`, `landmark-facts.json`, `walks/`, `wissen/`,
   `transit/`, `murals/`). Everything else under `data/` is ignored and
   comes from `scripts/data-pull.ts`.
2. Sort the tests that read data (run the units in a clone without
   `data/` to find every one) and `pipeline/tests/`: a test that needs
   one tile runs on the fixture; one that walks every site runs on
   what is pulled. CI pulls all seven (a cache keyed by the lock's
   source hashes replaces `git rev-parse HEAD:data/dresden/dgm`) and
   sets `DATA_REQUIRED=1`: a site the lock names and the disk lacks
   then fails. Without it, in a fresh clone, those tests say in one
   line that they did not run. None may pass silently on nothing
   (`empty_parameter_set_mark = "fail_at_collect"` stays).
3. `git rm --cached` the rest; `.gitignore` names the fixture.
   `ci.yml`: the bake cache's key and the e2e scope's path list take
   `data.lock.json` in place of `data/**` and `data`.
4. The scripts that read `public/data` on a desk
   (`scripts/street-photos.ts`, `scripts/osm-gaps.ts`,
   `scripts/stadtwissen-files.ts`) pull the published tileset, or say
   which command does.
5. Docs in the same PR: ADR 0037 rewritten (what is committed, what
   a clone does, a re-bake as a lock diff with a report), ADR 0024
   (the manifest hashed, the lock names it), ADR 0001 (where the
   static files are), `docs/data-pipeline.md` ("Cache and publish",
   "Bakes side by side"), `docs/portability.md`, AGENTS.md (the Data
   rules; "committing another city's `data/<site>/`" becomes
   publishing one), the `add-city` skill.

**Verify**: `git ls-files data | wc -l` counts the fixture only and
`du -sh` of the tracked files is under 40 MB; `bun run verify` passes
in a fresh clone with no pull; CI passes with `DATA_REQUIRED=1`.

### Phase 5 — what the move makes unnecessary (if phase 0 says so)

1. One transport encoding, chosen at publish and set as the object's
   `Content-Encoding`: the files are stored as `.glb`, `.pts`, `.crw`
   without the `.gz`, and `isGzipped` and `inflate` leave
   `fetch-optional.ts`. Every hashed name changes once.
   `DecompressionStream` stays required while `lib/city/png-raster.ts`
   inflates PNGs (plan 091).
2. The deploy no longer bakes, so its crutches go: the Vercel branch of
   `CACHE_DIR`, `scripts/shared-cache.ts` (or it points at the store,
   if the publishing job is too slow without it: measure first), the
   builder's figures in `warmers.ts` (the limits stay, for the runner).

**Verify**: `grep -rn "isGzipped\|VERCEL_ARTIFACTS_TOKEN" app lib
scripts` finds nothing; the ledger gets the site's and the spawn
tile's bytes on the wire, before and after.

## Test plan

- `scripts/data-store.test.ts` (new): the directory twin; a `put` of
  an existing key writes nothing; a missing key reads as absent.
- `scripts/data-lock.test.ts` (new): an unknown version is refused;
  `check` changes with a bake module's text and not with a viewer
  module's. `scripts/data-pull.test.ts` (new): a wrong hash fails.
- `lib/city/site-index.test.ts`: the base from the lock, and
  `DATA_ORIGIN=local`. Pattern for all: `scripts/site-choice.ts` and
  its test — no file access in the logic, the caller hands it in.

## Done criteria

- [ ] `bun run verify`, `bun run test:pipeline` and the e2e shards pass
- [ ] a production deploy's log contains no bake, and its build is
      shorter than before (both figures in 087's ledger)
- [ ] `git ls-files data` lists the fixture alone
- [ ] `bun scripts/data-lock.ts check` is a required check and passes
- [ ] `/datenschutz` names the store as decision 2 requires; ADRs 0001,
      0024, 0037 and 0048 state the new decision, with no "update" note
- [ ] `docs/plans/README.md`: this plan's row updated

## STOP conditions

- A candidate store answers a missing object with anything but 404, or
  drops the `Content-Encoding` an object was stored with; or decision
  2's forwarding is not cached at the edge, or bills the bytes twice
  at a rate the maintainer has not accepted.
- `--check` (phase 1) finds a site whose published manifest differs
  from what git bakes: the bake is not deterministic there. Find out
  why before anything reads the lock.
- Any step would need the write credential in the repository, in a
  log, or in a pull request from a fork.
- A test can only be kept green by skipping it without a word, or a
  phase can only be finished by rewriting history.

## Maintenance notes

- The store only grows. Deleting is its own, deliberate job: an object
  may go when no lock on `main`'s recent history and no open pull
  request names it. Not built here; write it when the bill asks.
- A new published kind needs nothing here: the publisher uploads what
  the manifest names. In phase 4's review, read the list of tests that
  no longer run without pulled data, not the removal's size.

## What the series changes about this plan

Built alone, this plan would stop after phase 4 and leave the formats
alone. In the series:

- 092's tables enter the source set, never git (086, joint 2) — the
  source set of phase 1 is their home, and its report (phase 3) is
  where 092's comparison by content appears.
- 091's raw rasters need phase 5's encoding (joint 10); without it a
  raw array is larger on the wire than the PNG it replaces.
- 093 multiplies the number of objects a site has by about sixteen:
  decision 1 must not pick a store that prices or throttles by
  request.
- The build's memory (1.3–1.9 GiB a tile) stops binding on the
  publishing runner; 086 rests "no Rust for the build" on that.

## Findings

### Phase 0, step 1 — what transport compression buys (2026-11-16)

Step 1 is done. Decisions 1–3 below are prepared for the maintainer and
not yet taken. Nothing after them has started. No store, account or
credential was created, and nothing was uploaded.

**Method.** I baked Dresden at `67e6d45` with
`bun scripts/prepare-sites.ts dresden`: 146 s wall on four cores, cache
cold, 700 files, 208 MB in `public/data/dresden/`. For every file I took
the bytes before any gzip (a `.gz` file gunzipped, every other file as it
is). I compressed those bytes three ways:

- gzip level 9, the level the bake writes today
  (`scripts/prepare/context.ts`; the `.gz` files on disk come within
  0.05 % of it);
- brotli at quality 11 with a 16 MB window (`lgwin` 24);
- zstd at level 19.

All three ran on Bun's `node:zlib`. Brotli 11 took 11 min on one core
for the whole site. That is a publishing cost, paid once for each new
file, never by the deploy.

**What the host sends today was not read off the wire.** Production is
`mit.manuel.fyi` (named in the `sentry-triage` skill). Its newest
production deployment builds the same commit as this measurement
(`67e6d45`). Every request from this session answered `429` with
`x-vercel-mitigated: challenge`, the "Vercel Security Checkpoint" page.
That held for plain `curl -sI -H 'Accept-Encoding: br, gzip'` and for
Vercel's own authenticated fetch, both on the domain and on the
deployment's `*.vercel.app` URL. I did not try to get past the
checkpoint. The *today* column is therefore what Vercel documents, not
what was measured:

- Vercel compresses only an allowlist of MIME types, with gzip or br.
  JSON and GeoJSON are on it. PNG and WebP are left out on purpose
  ("already compressed"). `model/gltf-binary`, `application/gzip` and
  `application/octet-stream` are not listed
  ([CDN compression](https://vercel.com/docs/how-vercel-cdn-works/compression),
  updated 2026-03-05).
- So the pre-gzipped kinds go out as stored, and the viewer inflates them
  (`fetch-optional.ts`, `isGzipped`). PNG and WebP go out as stored too.
- JSON is compressed on the fly at a level Vercel does not document. The
  table brackets it: gzip 9 as the upper bound, brotli 11 as the lower
  (no gain on JSON at all).

**Before step 2 is closed, the maintainer runs this from a browser
session that has passed the checkpoint:**
`curl -sI -H 'Accept-Encoding: br, gzip'` on three files of each kind,
with the cookie that session holds. If a `.glb.gz` comes back with
`content-encoding: gzip`, the *today* column is wrong for that kind.

The `brotli saves` and `zstd saves` columns compare against *today*, a
file never getting larger than it is today. Sizes are in MB (10⁶ bytes).

| Dresden, whole site (700 files) | files | before gzip | today | brotli 11 | zstd 19 | brotli saves | zstd saves |
|---|--:|--:|--:|--:|--:|--:|--:|
| `.glb.gz` (buildings near and far, terrain L0 and L1) | 60 | 184.60 | 99.93 | 89.98 | 93.23 | 10.0 % | 6.7 % |
| `.pts.gz` / `.crw.gz` | 45 | 10.09 | 4.36 | 3.58 | 4.04 | 17.9 % | 7.4 % |
| other `.gz` (`footprints.fpr.gz`, `plate.bin.gz`) | 16 | 4.61 | 1.98 | 1.67 | 1.74 | 15.5 % | 12.1 % |
| `.png` | 236 | 85.29 | 85.29 | 83.77 | 83.98 | 1.8 % | 1.5 % |
| `.webp` | 33 | 3.34 | 3.34 | 3.34 | 3.34 | 0.0 % | 0.0 % |
| GeoJSON (today = gzip 9) | 225 | 15.19 | 1.62 | 1.24 | 1.33 | 23.5 % | 17.9 % |
| JSON (today = gzip 9) | 85 | 6.10 | 1.15 | 0.86 | 0.93 | 25.1 % | 19.0 % |
| **site, JSON today = gzip 9** | 700 | 309.21 | 197.68 | 184.44 | 188.60 | **6.7 %** | **4.6 %** |
| **site, JSON today = brotli 11** | 700 | 309.21 | 197.01 | 184.44 | 188.44 | **6.4 %** | **4.4 %** |

| Bracketed total (JSON today = gzip 9 … brotli 11) | files | today | brotli 11 | zstd 19 | brotli saves | zstd saves |
|---|--:|--:|--:|--:|--:|--:|
| spawn tile `33412_5656_2_sn`: every file named for it, both levels and the buildings¹ | 44 | 13.83 … 13.77 | 12.89 | 13.16 … 13.15 | 6.8 … 6.4 % | 4.8 … 4.5 % |
| the spawn tile's fine level: terrain L0 and every file its extras name in `tileset.json` | 35 | 7.99 … 7.96 | 7.64 | 7.76 … 7.75 | 4.4 … 4.0 % | 3.0 … 2.6 % |

**The verdict on the plan's 3 % line.**

- **Brotli 11 clears it.** It saves 6.4–6.7 % for the whole site (about
  13 MB of Dresden's 197 MB), 6.4–6.8 % for the spawn tile and 4.0–4.4 %
  for a fine level.
- **Zstd 19 clears it only for the site and the spawn tile** (4.4–4.8 %).
  On a fine level it sits on the line (2.6–3.0 %), and it is behind
  brotli on every kind.
- **Brotli clears the plan's 3 % bar.** Whether phase 5 is built
  follows from the plan's rule and from the maintainer's choice of store:
  the store must pass a stored `Content-Encoding` through (decision 1).
- **The gain is in the meshes and the point packs.** `.glb` brotli is
  10 % smaller than its gzip, and the packed points 18 %. PNGs gain 1.5–2 %
  and stay as they are; plan 091 decides their future. WebP gains
  nothing.
- **What phase 5 can claim over today is the `.gz` kinds alone.** On
  JSON the gain over the host's own on-the-fly brotli is unknown, between
  0 and 25 %.
- **These figures go into PR #307's ledger** (plan 087) once it is on
  this branch. Its spawn tile counts 43 files where the table above
  counts 44 (¹): the 44th is the tile's Stadtwissen
  (`stadtwissen_33412_5656_2_sn.<hash>.json`), which the bake publishes
  under the tile's name but `tileset.json` does not name. The ledger
  counts what the tileset names; this table counts every published file
  with the tile in its name. It is 0.31 MB before gzip; over the 43
  files the ledger counts, brotli saves 6.4–6.7 % (13.74–13.78 MB today,
  12.86 MB with brotli).

**Side observations.**

- `public/data/dresden` holds 208 MB on disk, against the
  "≈ 98.9 MB on the wire" `docs/data-pipeline.md` measured on
  2026-09-25. The difference is every raster twin and both terrain
  levels counted at once; a visit never fetches them all. 087 measures
  what a visit fetches.
- The bake writes `manifest.json` and `site-stats.json` unhashed. Every
  other file carries its hash.

### Decisions 1–3, prepared (not decided)

Decisions 1–3 rest on the providers' documentation, read on 2026-11-16,
with the page cited. "Not documented" means the cited pages say nothing
about it; "documented, not tried" means a page says so and nobody here
has tried it. Nothing below is asserted from memory. **The plan's ten-file
trial has not been run.** It needs an account on each candidate, which
this step was not to create. Each "not documented" below is something
that trial must answer.

**Decision 1 — the store.** The plan's criteria, one per column.

| Candidate | stored `Content-Encoding` served as-is | `Cache-Control … immutable` per object | missing object | HTTP/2–3 | write credential scoped to the store | price (storage; traffic; requests) |
|---|---|---|---|---|---|---|
| **Vercel Blob**, public store | not documented: `put()` takes `contentType`, `cacheControlMaxAge` and no other header ([SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)) | **no**: `cacheControlMaxAge` only, "defaults to one month", and "blobs may occasionally expire earlier" ([public storage](https://vercel.com/docs/vercel-blob/public-storage)) | not documented for a URL (the SDK's `get()` returns `null`) | not documented | the store's `BLOB_READ_WRITE_TOKEN`, "long-lived static", one token a store; to be used "outside Vercel, such as in a CI job" ([Blob](https://vercel.com/docs/vercel-blob)) | fra1: $0.025/GB-month; Blob Data Transfer $0.05/GB; Simple operations $0.43 a million, counted on a cache MISS only; every read is a CDN request ([fra1](https://vercel.com/docs/pricing/regional-pricing/fra1), [usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing), 2026-09-23). Hobby: 1 GB storage, 10 GB transfer, then "you will not be able to access Vercel Blob" for 30 days. Rate limits on operations (Hobby 20/s, Pro 120/s simple) |
| **Cloudflare R2** behind a custom domain | `Content-Encoding` and `Cache-Control` are object metadata on PutObject ([S3 API](https://developers.cloudflare.com/r2/api/s3/api/)). At the edge Cloudflare "will keep the same compression" for br or gzip when the client supports it, and may convert unless the origin sends `cache-control: no-transform`; it asks its origin with `accept-encoding: br, gzip` ([compression](https://developers.cloudflare.com/speed/optimization/content/compression/)). zstd from the origin is not documented | yes, per object; but "HTML and JSON are not cached" by default and `.glb` is not in the default list, so a Cache Rule is needed ([default cache behaviour](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)) | 404 `NoSuchKey` on the S3 API ([error codes](https://developers.cloudflare.com/r2/api/error-codes/)); not documented for the custom domain | HTTP/3 "available to all plans" ([HTTP/3](https://developers.cloudflare.com/speed/optimization/protocol/http3/)) | an API token limited "to a set of buckets", read and write ([tokens](https://developers.cloudflare.com/r2/api/tokens/)) | $0.015/GB-month; "no charges for egress bandwidth"; Class B reads $0.36 a million; free: 10 GB-month, 10 M reads ([pricing](https://developers.cloudflare.com/r2/pricing/), 2026-10-30). `r2.dev` is "rate-limited", for development only ([public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)) |
| **Bunny Storage + pull zone** | not documented for storage: upload headers are `AccessKey`, `Content-Type`, `Checksum` ([storage HTTP](https://bunny.net/docs/storage/http)). The CDN "automatically compresses responses using gzip, Brotli, or Zstandard", glTF and JSON included ([performance](https://bunny.net/docs/cdn/performance)): it may serve phase 5's gain without phase 5 | "Bunny follows the origin's `Cache-Control`"; per object on storage not documented; an Edge Rule can set it ([smart cache](https://bunny.net/docs/cdn/smart-cache), [edge rules](https://bunny.net/docs/cdn/edge-rules)) | not documented | not documented | the storage zone's password, one a zone ([storage HTTP](https://bunny.net/docs/storage/http)) | storage $0.01/GB (one region), "No API Request Fees"; CDN EU $0.01/GB, "No Request Fees"; $1 monthly minimum ([storage](https://bunny.net/pricing/storage/), [CDN](https://bunny.net/pricing/cdn/)) |
| **Hetzner Object Storage**, no CDN | not documented ([supported actions](https://docs.hetzner.com/storage/object-storage/supported-actions/)) | not documented | not documented | not documented | a key pair is "valid for every Bucket within the same project": a project of its own is needed ([credentials](https://docs.hetzner.com/storage/object-storage/faq/s3-credentials)) | €6.49 a month for 1 TB storage and 1 TB egress, operations free, but a "minimum billable object size of 64 kB"; "up to 750 requests/s per Bucket" ([product](https://www.hetzner.com/storage/object-storage/), [overview](https://docs.hetzner.com/storage/object-storage/overview/)) |
| GitHub release assets | not documented | not documented | the API answers 404; the download URL is not documented ([assets](https://docs.github.com/en/rest/releases/assets)) | not documented | push access | "Up to 1000 release assets" a release ([releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)) |

**Reading the table for decision 1.**

- **GitHub releases fall out.** A thousand assets a release is less than
  one site after plan 093.
- **Hetzner falls out as a store the browser reads directly.** It has no
  edge, a 750-requests-a-second ceiling, and a 64 kB minimum that bills
  most of our files at several times their size. It stays possible only
  behind a CDN.
- **Vercel Blob fails the `immutable` criterion as documented.** It also
  cannot be shown to keep a stored encoding, and Hobby's limits would
  lock it for 30 days once passed.
- **R2's documentation answers the most criteria, not all.**
  - Documented, not tried: a stored `Content-Encoding` and
    `Cache-Control` on each object, kept at the edge for br and gzip
    (with a Cache Rule for JSON and `.glb`); HTTP/3; a token limited to
    the bucket.
  - Not documented: what a missing object answers on the custom domain
    (the 404 is documented for the S3 API only), and what the edge does
    with a stored zstd.
- **A 404 is documented on an API, never on the public URL.** That holds
  for R2's S3 API and for GitHub's assets API alike. No candidate
  documents the status a browser gets for a missing object; the trial
  must.
- **Storage and egress, each from its page:**
  - Vercel Blob: $0.025/GB-month, Blob Data Transfer $0.05/GB in fra1
    ([fra1](https://vercel.com/docs/pricing/regional-pricing/fra1)).
  - R2: $0.015/GB-month, egress free
    ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)).
  - Bunny: storage $0.01/GB in one region
    ([storage pricing](https://bunny.net/pricing/storage/)), CDN traffic
    in Europe $0.01/GB ([CDN pricing](https://bunny.net/pricing/cdn/)).
  - Hetzner: €6.49 a month including 1 TB storage and 1 TB egress
    ([product](https://www.hetzner.com/storage/object-storage/)).

  Bunny stores for less; R2 sends for nothing. Which is cheaper depends
  on the ratio of traffic to stored bytes, which 087's ledger and the
  host's traffic figures give.
- **Bunny is EU-based but documents least.** Its CDN's own brotli or
  zstd might make phase 5 unnecessary; the trial would tell.
- **A recommendation, for the maintainer to accept or not:** R2 behind a
  custom domain, with Bunny as the alternative the ten-file trial is also
  run on.

**Decision 2 — the site's own origin or a second one.**

- **Forwarding `/data/*` through the site's host.** A Vercel external
  rewrite honours the upstream's `Cache-Control` and `CDN-Cache-Control`
  "for projects created on or after April 6, 2026"
  ([rewrites](https://vercel.com/docs/routing/rewrites), 2026-08-11).
  Whether the project falls under that date, or needs
  `x-vercel-enable-rewrite-caching`, the trial checks.
- **What Vercel does not document about forwarding.** Its pages say
  nothing on:
  - whether the upstream's `Content-Encoding` is passed through or redone;
  - what a 404 from upstream becomes, and whether it is cached;
  - whether a forwarded byte is billed twice.

  On billing, Vercel documents only that each external rewrite counts as
  a CDN request
  ([changelog](https://vercel.com/changelog/fast-data-transfer-for-rewrites-between-a-teams-projects-is-now-free),
  2025-02-27). The visitor's bytes are Fast Data Transfer at $0.15/GB in
  fra1 ([fra1](https://vercel.com/docs/pricing/regional-pricing/fra1)), on
  top of whatever the store bills.
- **Where forwarding hits the STOP conditions.** "Forwarding not cached
  at the edge, or bills the bytes twice": the first is documented, not
  tried; the second is open. "The store drops the `Content-Encoding`": open.
  The ten-file trial has to answer all three before forwarding is chosen.
- **The checkpoint above applies to forwarded files too.** A forwarded
  `/data/*` stays behind Vercel's checkpoint, as the files are today. A
  second host does not.
- **A second host** needs a CORS rule for the worker's fetches. R2's
  custom domain "automatically return[s] CORS response headers" once a
  bucket policy exists
  ([CORS](https://developers.cloudflare.com/r2/buckets/cors/)), and Bunny
  has a pull-zone switch
  ([pull zone API](https://bunny.net/docs/api-reference/core/pull-zone/add-pull-zone.md)).
  It also needs `images.remotePatterns`, and a page on the privacy policy.

**What each choice means for `app/(legal)/datenschutz/page.mdx`**
([ADR 0043](../adr/0043-crash-and-page-reports-to-an-error-tracker.md):
"a new request to a third party … is not done until the page says so").

| Choice | The visitor's browser talks to | The privacy page |
|---|---|---|
| Vercel Blob, any host | Vercel Inc. (the same processor; DPF, DPA for Pro and Enterprise: [DPA](https://vercel.com/legal/dpa), [privacy policy](https://vercel.com/legal/privacy-policy)) | One sentence in "Aufruf der Seite und Hosting": the city's files come from Vercel's storage host. There is no new processor, but on Hobby there is no DPA to name. |
| R2 or Bunny, forwarded through `/data/*` | Vercel only | Whether Vercel passes the visitor's address on to the upstream is not documented. Until the trial shows it, name the store as a further processor in the hosting section. |
| R2, its own host | Cloudflare, Inc., USA ("complies with the EU-U.S. DPF", [privacy policy](https://www.cloudflare.com/privacypolicy/)) | A new section: who, which data (IP address, URL, User-Agent, as for Vercel), Art. 6 (1) f and Art. 28, transfer to the USA under DPF (Art. 45). Storage can be held in the EU ("eu" jurisdiction, [data location](https://developers.cloudflare.com/r2/reference/data-location/)), but the edge's location is not documented. |
| Bunny, its own host | BunnyWay d.o.o., Ljubljana, Slovenia ([terms](https://bunny.net/tos/)); a DPA "within your bunny.net panel" ([GDPR](https://bunny.net/gdpr/)) | A new section: who, which data, Art. 6 (1) f and Art. 28. A processor in the EU; whether its edge serves EU visitors from outside the EU is not documented. |

**Decision 3 — who publishes.**

- **The plan's recommendation stands:** a CI job with the write
  credential, and `bun scripts/publish-data.ts` as the way out.
- **I found no page documenting GitHub Actions OIDC** for writes to any
  candidate, on the pages cited in decision 1's table. Vercel Blob
  documents an OIDC token for code that runs on Vercel, and for "a CI
  job" outside Vercel names the read-write token instead
  ([Blob](https://vercel.com/docs/vercel-blob)). The credential is
  therefore a long-lived token in a repository or environment secret:
  - Blob: the store's token;
  - R2: a token limited to the bucket;
  - Bunny: the zone's password;
  - Hetzner: a key in a project of its own.
- **GitHub keeps secrets from forked pull requests.** "With the exception
  of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow
  is triggered from a forked repository"
  ([secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)).
  So a fork's pull request cannot publish, which the STOP conditions want.
  Its lock is then republished by the maintainer, by hand or by a re-run
  on a branch of the repository.
- **What the maintainer decides:**
  - whether the job runs on every pull request that fails
    `data-lock check` or only on a label;
  - which of the two holds the credential: a GitHub environment, or the
    maintainer's machine alone.

**Still open before phase 1:**

- the maintainer's name and date on each decision;
- the ten-file trial on the chosen candidates: the encoding, the
  `Cache-Control`, a missing object, HTTP/2 or 3, and for forwarding the
  edge cache and the bill;
- the curl on the production host (above).
