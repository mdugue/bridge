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
- **Status**: TODO

## Why this matters

The baked data lives in git and is baked a second time inside every web
build. `data/` holds 937 MB and the pack is 1.2 GiB after eighteen days
(2026-11-16); a cold `prepare-sites` takes 360 s on four cores (audit
2026-11-11) and has to be squeezed, one tile a process, into the host's
8.6 GB builder (`scripts/warmers.ts`); every deployment carries 561 MB of
`public/data` again. ADR 0037 already says it: "beyond a handful of
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
  (`package.json`: `"dev": "bun scripts/copy-wasm.ts && bun
  scripts/prepare-sites.ts && next dev …"`, `"build"` likewise). Picks
  every site whose data is on disk (`isReady`, through `siteReport`),
  runs `scripts/prepare-data.ts <site>` for each (`prepareAll`), writes
  `public/data/sites.json` (`SiteIndex`: per site `id`, `map`,
  `tileset`, `stats`), copies each site's Stadtwissen to `.stadtwissen/`
  for the chat's function (`publishServerWissen`) and prunes
  `public/data`.
- `scripts/prepare-data.ts` and `scripts/prepare/*.ts` — the TypeScript
  bake of one site: `data/<site>/` in, `public/data/<site>/` out.
  `scripts/prepare/context.ts` holds the plumbing: `OUT_DIR`,
  `CACHE_DIR` (`.cache/prepare-data`, on Vercel
  `.next/cache/prepare-data`), `cacheKey` (from `createKeyMaker` in
  `scripts/cache-keys.ts`), `cached`, and the shared cache.
- `scripts/publisher.ts` — `createPublisher(outDir, …)`: `publish`
  writes a file as `<stem>.<8 hex of sha1>.<ext>` (`hashedName`;
  `.glb.gz`, `.pts.gz`, `.crw.gz` keep both suffixes), `finish` writes
  `manifest.json` (`{ version: 1, files: { logical: hashed } }`) and
  prunes what the run did not name.
- `scripts/shared-cache.ts` — a second bake cache every branch shares,
  in Vercel's Remote Cache (`https://api.vercel.com/v8/artifacts`, the
  token `VERCEL_ARTIFACTS_TOKEN` that only Vercel's build passes). It
  exists because the deploy bakes.
- `scripts/warmers.ts` — `bakeLimits`, `warmSteps`: one tile a process
  so that the peaks fit the builder's memory.
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
- `lib/city/fetch-retry.ts` (ADR 0048): 404 and 410 mean absent;
  network errors, 408, 425, 429 and 5xx are retried; any other status
  is fatal.
- `next.config.ts` — `/data/:path*` is served `public,
  max-age=31536000, immutable`; `/data/:site/manifest.json` and
  `/data/sites.json` `no-cache`; `outputFileTracingExcludes` keeps
  `public/data` out of the server functions.
- `.gitignore` — `/data/*` is ignored and seven folders are un-ignored
  by name (`!/data/dresden/` … `!/data/unna/`); `/public/data/` and
  `/.cache/` are ignored.
- `.github/workflows/ci.yml` — the unit job keys a cache by
  `git rev-parse HEAD:data/dresden/dgm`; the e2e job runs `bun run
  build`, which bakes from the checkout's `data/`, and keys its bake
  cache by `hashFiles('data/**', …)`; its scope step lists `data`
  among the paths that make the viewer shards run.
- Tests bound to the data: 34 test files under `lib/`, `app/` and
  `scripts/` read a site's folder (list them with `grep -rlE
  "siteDataDir|sideFileSource|wallSourceFile|kerbSourceFile|data/dresden|dgm-cache|readDgm\(|tileSources\("
  lib app scripts --include=*.test.ts`); several walk every site that
  is on disk (`features.test.ts`: `SITES_BAKED`, `bake-files.test.ts`,
  `tile-data.test.ts`, `png-raster.test.ts`, `markings.test.ts`).
  `pipeline/tests/test_committed.py` globs the committed files and
  fails on an empty glob.

Sizes on 2026-11-16 (`du`): `data/dresden` 506 MB (DGM 204, `dlm/` 176,
CityJSON 119), `muenchen` 119, `leipzig` 113, `hamburg` 81, `unna` 54,
`grimma` 40, `meissen` 27. Dresden's spawn tile `33412_5656_2_sn` alone:
DGM 13.0 MB, `dlm/` 11.6 MB, CityJSON 9.3 MB, `dop/` 0.3 MB.

What ADR 0037 promises today and this plan replaces: "Clone, `bun
install`, `bun dev` works without GDAL or a download", and "a re-bake is
a maintainer action and shows up as a data diff".

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install` | exit 0 |
| Gate | `bun run verify` | lint, both type checks and the units pass |
| Units | `bun run test` | all pass |
| Build | `bun run build` | exit 0 |
| E2E | `bun run test:e2e` | all pass (CI runs the shards) |
| Where a site stands | `bun run site --all` | one line a tile |
| One site's bake | `bun scripts/prepare-sites.ts dresden` | `public/data/dresden/manifest.json` written |
| Python tests | `bun run test:pipeline` | pytest and ruff pass |

## Scope

**In scope**

- `scripts/publisher.ts`, `scripts/prepare-sites.ts`,
  `scripts/prepare/context.ts`, `scripts/shared-cache.ts`,
  `scripts/site-choice.ts`, and new scripts with their tests:
  `scripts/data-store.ts`, `scripts/publish-data.ts`,
  `scripts/data-pull.ts`, `scripts/data-lock.ts`
- `data.lock.json` (new, at the repository's root)
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
- **git's history.** Removing the files from the tree leaves every old
  version in the pack. Shrinking it means rewriting history: every open
  pull request (24 on 2026-11-16) and every clone would have to follow.
  That is the maintainer's decision and no step of this plan.
- A service worker over the store (the README's Direction item 7).

## Phases

### Phase 0 — a spike and three decisions (no merge)

1. **What does transport compression buy?** Build Dresden
   (`bun scripts/prepare-sites.ts dresden`) and, for every published
   file, compare three sizes by kind (`.glb.gz`, `.pts.gz`/`.crw.gz`,
   `.png`, `.webp`, JSON and GeoJSON): what the production host sends
   today (ask it: `curl -sI -H 'Accept-Encoding: br, gzip'` on three
   files of each kind, read `content-encoding` and the transferred
   size), brotli at its highest level and zstd at a high level over the
   bytes as they are *before* any gzip. Write the table into *Findings*
   and into 087's ledger. If the whole site saves less than 3 %, phase
   5 is not built and the files are published as they are.
2. **Decision 1 — the store.** Put a short table to the maintainer.
   What a candidate must do: set `Content-Encoding` and
   `Cache-Control: … immutable` on each object; answer a missing object
   with 404 (`fetch-retry.ts` treats every other status as fatal or
   transient); serve many small requests in parallel over HTTP/2 or 3;
   take writes with a credential scoped to this store; keep the bytes
   in the EU if the maintainer wants that. What it costs: storage for
   every version ever published (a re-bake adds only the objects that
   changed) and traffic. Do not assert a host's behaviour from memory:
   try ten files on each candidate.
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
   deploy. It runs either in a CI job that holds the write credential
   and commits the lock to the pull request's branch, or by hand
   (`bun scripts/publish-data.ts`, from the maintainer's machine or an
   agent's session that was given the credential). Recommended: the CI
   job, with the command as the way out when a branch cannot be
   written to. The credential is a secret of the CI or the session; it
   is never written into the repository, a log or this file.

**Verify**: *Findings* holds the size table, the three decisions with
the maintainer's name and date, and the ten-file trial's answers.

### Phase 1 — publish beside git (nothing reads it yet)

1. `scripts/data-store.ts`: `has`, `put`, `get` against the store,
   behind an interface with a directory-backed twin for tests and
   local trials (the pattern of `shared-cache.ts`'s
   `BAKE_SHARED_CACHE_API`). Never fatal on read; a write that fails
   fails the run.
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
   `tileset`, `stats`), so that a build needs nothing but git; and the
   store's base address once, at the top. Sorted keys, one site a
   block, so that two pull requests that touch two sites merge.
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
2. The page names the hashed tileset itself (`firstFetches` preloads
   it); the viewer no longer fetches a manifest first. One request and
   one revalidation less a visit. ADR 0048's item 5 ("the manifest
   falls back only to the browser's cached copy") is rewritten: there
   is no unhashed file left to fall back from.
3. `bun run build` is `next build` alone unless `DATA_ORIGIN=local`.
   `bun dev` in a fresh clone serves every published site from the
   store with no bake and no download; `PREPARE_SITES=dresden bun dev`
   pulls that site's sources and bakes it locally, as today.
4. The chat's function reads a copy of each site's Stadtwissen from
   `.stadtwissen/` (`next.config.ts`, `outputFileTracingIncludes`).
   The build fetches those few files by the lock's hashes and checks
   them; a mismatch fails the build.
5. CI's e2e job keeps baking Dresden from pulled sources with
   `DATA_ORIGIN=local`: it is the check that the bake's code works.
   One smoke spec in the build-check shard loads a site from the store
   itself, so the store's path (encoding, CORS or forwarding) is
   tested too.
6. The privacy page says what decision 2 made true, before this merges.

**Verify**: a preview deployment streams `/dresden` from the store
(the network panel shows the store's address or the forwarded path, and
no `manifest.json`); the deploy's log shows no `prepare-sites` line;
`bun run test:e2e` passes; the ledger gets the deploy's build time and
the first load's request count, before and after.

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
   writes what a reviewer needs into the pull request: per kind and
   tile the files added, removed and changed with their sizes, for
   GeoJSON and JSON the count of features that differ
   (`scripts/eval/compare-bakes.py` does this by content for the
   vegetation files — the pattern), and the result of the data tests
   it ran on the new set. 087's plates on the preview show the
   picture.

**Verify**: a trial pull request that edits a comment in
`lib/city/tile.ts` fails the check, the workflow republishes, the
check passes; one that edits `app/_components/minimap.tsx` passes at
once.

### Phase 4 — `data/` leaves git but for a fixture

1. The fixture: Dresden's spawn tile `33412_5656_2_sn` (its files under
   `cityjson/`, `dgm/`, `dlm/`, `dop/`) and the site's small files
   (`provenance.json`, `landmark-facts.json`, `walks/`, `wissen/`,
   `transit/`, `murals/`). Everything else under `data/` is ignored and
   comes from `scripts/data-pull.ts`.
2. Sort the 34 test files (the grep above) and `pipeline/tests/`: a
   test that needs one tile runs on the fixture; a test that walks
   every site runs on what is pulled. CI pulls all seven (a cache keyed
   by the lock's source hashes replaces the key
   `git rev-parse HEAD:data/dresden/dgm`) and sets `DATA_REQUIRED=1`,
   under which a site the lock names and the disk lacks is a failure.
   Without it — a fresh clone — those tests say in one line that they
   did not run. No test may pass silently on nothing: keep
   `empty_parameter_set_mark = "fail_at_collect"`.
3. `git rm --cached` the rest; `.gitignore` names the fixture.
   `ci.yml`: the bake cache's key and the e2e scope's path list take
   `data.lock.json` in place of `data/**` and `data`.
4. The scripts that read `public/data` on a developer's machine
   (`scripts/street-photos.ts`, `scripts/osm-gaps.ts`,
   `scripts/stadtwissen.ts`, `scripts/stadtwissen-files.ts`) get a
   pull of the published tileset, or say which command fetches it.
5. Docs in the same PR: ADR 0037 rewritten (what is committed; what a
   clone does; a re-bake is a lock diff with a report), ADR 0024 (the
   manifest is hashed, the lock names it), ADR 0001 ("all data is
   static files" — where), `docs/data-pipeline.md` ("Cache and
   publish", "Bakes side by side"), `docs/portability.md`, AGENTS.md
   (the Data rules, "ask before … committing another city's
   `data/<site>/`" becomes publishing one), the `add-city` skill.

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
   if the publishing job is too slow without it — measure first), the
   builder's memory figures in `warmers.ts` (the limits stay, sized
   for the publishing runner).

**Verify**: `grep -rn "isGzipped\|VERCEL_ARTIFACTS_TOKEN" app lib
scripts` finds nothing; the ledger gets the site's and the spawn
tile's bytes on the wire, before and after.

## Test plan

- `scripts/data-store.test.ts` (new): the directory twin; a `put` of
  an existing key writes nothing; a missing key reads as absent.
- `scripts/data-lock.test.ts` (new): the lock's reader refuses an
  unknown version; `check` changes with a bake module's text and not
  with a viewer module's; two sites' blocks merge.
- `scripts/data-pull.test.ts` (new): a wrong hash fails; a right file
  is left alone.
- `app/_lib/built-sites` and `lib/city/site-index.test.ts`: the base
  from the lock, and `DATA_ORIGIN=local`.
- Pattern for all of them: `scripts/site-choice.ts` and its test — no
  file access in the logic, the caller hands it in.

## Done criteria

- [ ] `bun run verify`, `bun run test:pipeline` and the e2e shards pass
- [ ] a production deploy's log contains no bake, and its build is
      shorter than before (both figures in 087's ledger)
- [ ] `git ls-files data` lists the fixture alone
- [ ] `bun scripts/data-lock.ts check` is a required check and passes
- [ ] `/datenschutz` names the store as decision 2 requires
- [ ] ADRs 0001, 0024, 0037 and 0048 state the new decision, with no
      "update" note
- [ ] `docs/plans/README.md`: this plan's row updated

## STOP conditions

- A candidate store answers a missing object with anything but 404, or
  drops the `Content-Encoding` an object was stored with.
- The forwarding of decision 2 is not cached at the edge, or bills the
  bytes twice at a rate the maintainer has not accepted.
- `--check` (phase 1) finds a site whose published manifest differs
  from what git bakes: the bake is not deterministic there. Find out
  why before anything reads the lock.
- Any step would need the write credential in the repository, in a
  log, or in a pull request from a fork.
- A test can only be kept green by skipping it without a word.
- Anyone proposes to rewrite history as part of a phase.

## Maintenance notes

- The store only grows. Deleting is its own, deliberate job: an object
  may go when no lock on `main`'s recent history and no open pull
  request names it. Not built here; write it when the bill asks.
- A new published kind needs nothing here: the publisher uploads what
  the manifest names.
- A reviewer of phase 4 should look at the list of tests that stopped
  running without pulled data, not at the removal's size.
- The lock is the one file two data pull requests both touch; its
  per-site blocks exist for that.

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
- 087's plates and ledger rows carry the lock's hashes, so a figure
  can be traced to the data it was measured on.
- The build's memory (1.3–1.9 GiB a tile) stops binding once the bake
  runs on the publishing runner; 086 rests its "no Rust for the build"
  on that.

## Findings

(empty — phase 0 writes here)
