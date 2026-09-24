# Plan 023: Many sites, one env var — `SITE` in `.env.local`, fetch → bake → build

> Written and executed in one run (branch
> `claude/multi-location-env-setup-w01c3g`). Continues
> [plan 017](./017-germany-wide-sites.md): 017 made one site configurable,
> this makes several sites *operable* — pick one in `.env.local`, fetch its
> data with one command, bake, build, deploy it under its own host.

## Status

- **Status**: DONE (this branch) — see "Result" at the end.
- **Priority**: P1 (the maintainer's next direction)
- **Effort**: L
- **Risk**: MED — Dresden must build byte-identically after its data moves;
  the non-Saxon portals are only partly reachable from the agent's
  container, so those adapters are written from the portals' documentation
  and tested where the network allows
- **Planned at**: commit `3b5ba7c`, 2026-09-24

## What the maintainer asked for

1. The place is chosen by an environment variable, ideally in a `.env`
   file. Set it, run a script or two (download raw data, bake), then
   `bun dev` or `bun run build`.
2. Scripts and docs follow; what is specific to a place is formalised.
3. Deployments later under `<site>.walkedby.manuel.fyi` (or similar).
4. Candidates: Leipzig, Meißen, Grimma; if possible Hamburg, München,
   Berlin, Unna. Good viewpoints per place, persisted.
5. Clean, lean, type-safe. Improve the proposal where it is not optimal.

## Where the proposal is improved

- **`.env.local`, not `.env`.** Bun (every script) and Next (dev/build)
  both load it automatically; `.env*` is already gitignored, so the choice
  stays per machine. A committed `.env.example` documents the variable. A
  deployment sets `SITE` in its host's environment instead — one project
  per site, no file.
- **What is per place vs. per provider.** A place (site) is a label,
  tiles and viewpoints. The CRS, the licence and credit line, which
  products exist openly (DOM1? RGBI or RGB? an open Basis-DLM?), the
  download grid and the OSM extract belong to the **data provider** (the
  Land), and every site of that Land shares them. So a typed provider
  table (`sites/providers.ts`) holds them once, and a site names its
  provider. Adding Leipzig after Dresden is then a label, tiles and
  viewpoints — nothing else.
- **Raw downloads shared per provider.** `data/_raw/<provider>/` instead
  of `data/_raw/<site>/`: Leipzig, Meißen, Grimma and Dresden share one
  1.2 GB statewide Basis-DLM and one OSM extract. Tile ids carry their
  coordinates, so per-tile raw files never collide.
- **Committed data per site.** `data/<site>/{dgm,cityjson,dlm,dop}` +
  `provenance.json`. A site is one folder: easy to see, to size, to
  delete, and to decide about in git.
- **What gets committed is a decision per site, and the default is no.**
  Dresden's folder is committed (CI builds it). Every other `data/<site>/`
  is gitignored until the maintainer un-ignores it (one line in
  `.gitignore`) — a 2×2 site is ~40 MB even compact, and seven of them
  would triple the repo. `bun run site` prints each site's size, so the
  decision is informed. (Beyond ~3 deployed sites, data bundles outside
  git are the next step; recorded in the ADR as the alternative.)
- **Compact sources.** The fetch step writes the DGM as a tiled GeoTIFF
  with DEFLATE + floating-point predictor, rounded to centimetres: 5.6 MB
  instead of 15 MB per tile, ≤ 5 mm off after the build's resample
  (checked against Dresden's spawn tile). Dresden's committed files stay
  as they are (rewriting them would only add blobs to the history).
- **No Java.** The build reads CityJSON; the providers ship CityGML.
  Instead of `citygml-tools` (a JRE on the maintainer's machine) the
  pipeline gets a small streaming CityGML → CityJSON converter for the
  AdV LoD2 profile — the one profile every Land publishes — writing the
  exact shape the build reads (MultiSurface with semantics, `function`,
  `roofType`, `measuredHeight`, the generic attributes, Building →
  BuildingPart links). Buildings are assigned to the tile holding their
  envelope centre, so a building on a download seam exists once.
- **Durable download links for Saxony.** GeoSN's link service still
  returns the rotated LoD2 share (503 today). The batch-download page
  carries the live share id and file-name template per product; the
  adapter reads those.
- **Three commands, three stages.** `bun run fetch` (network: the
  provider's downloads into `data/_raw/<provider>/` and the site's
  sources into `data/<site>/`), `bun run bake` (offline, derived
  artifacts), `bun dev` / `bun run build` (unchanged). `bun run site`
  reports what is there. The old `bake --ingest` flag goes.

## Phases

### 1 — Site selection and per-site data (TS + Python plumbing)

1. `.env.example` (`SITE=dresden`), `!.env.example` in `.gitignore`.
   `currentSite()` stays the one resolver (a typo fails with the list of
   known sites).
2. `git mv data/{dgm,cityjson,dlm,dop,provenance.json} data/dresden/`.
   `lib/city/tile.ts`: every source path is a function of the site
   (`siteDataDir(site)`); `prepare-data.ts`, `bake.ts`, the Python
   `--data`, the tests and CI follow.
3. `.gitignore`: `/data/*` then `!/data/dresden/`.
4. **Verify**: `bun scripts/prepare-data.ts` produces the same manifest
   (hashed names) as before the move; `bun run verify`,
   `bun run test:pipeline` green.

### 2 — Providers formalised

1. `sites/providers.ts`: `Provider` (id, name, EPSG, credit, licence,
   portal, OSM extract, products: `dom1`, `dop: "rgbi" | "rgb" | null`,
   `dlm`, tile suffix). `Site` names its `provider`; the site's
   attribution is derived (provider credit + OSM credit).
2. `bake.ts` passes the provider id, the raw dir and the OSM extract to
   the Python side; steps whose product the provider lacks are skipped by
   the table, not by a missing file.
3. **Verify**: Dresden's `Site` resolves to the same EPSG, tile ids,
   attribution text as before (unit test).

### 3 — Fetch: one command per site, per-provider adapters

1. `bun run fetch [tile…]` → `python -m bake.fetch --provider <id>` per
   tile: the adapter's `fetch_tile` (DGM1, DOM1, DOP, LoD2 into the raw
   layout) and `fetch_shared` (Basis-DLM, OSM) — then the common
   `sources` step writes `data/<site>/dgm/…` (compact) and
   `data/<site>/cityjson/…` (converted).
2. `pipeline/bake/citygml.py`: the streaming converter, with a unit test
   on a hand-written two-building fixture (parts, semantics, attributes,
   seam ownership).
3. Saxony (`sn`): URLs from the batch page product table.
4. Other providers (`nw`, `by`, `hh`, `be`): an adapter per portal, from
   the research in this run; a provider's missing open product is
   `null` in the table and skipped with a note.
5. **Verify**: Leipzig fetched from GeoSN in the agent's container; the
   converted CityJSON builds; Dresden's committed files are untouched.

### 4 — Sites and viewpoints

1. `sites/{leipzig,meissen,grimma,hamburg,muenchen,berlin,unna}.ts` with
   tiles (spawn first) and 3–5 viewpoints each, anchored on real
   coordinates (landmarks from OSM/Wikipedia, headings computed).
2. For every site whose data could be fetched here: the walk viewpoints
   are checked against the data (not inside a building footprint, not on
   water), and the site boots in the lite e2e path.

### 5 — `bun run site`: the site report

Per tile: which sources, raw inputs and derived artifacts exist, which
fallback applies, and the site folder's size on disk; lists every
registered site with its provider. Pure logic in `lib/city/site-report.ts`
(unit-tested), the script prints.

### 6 — Deployment

`next.config.ts` inlines `SITE`; `metadataBase` from `SITE_URL` (optional).
Docs: one hosting project per site, `SITE=<id>` in its environment, domain
`<id>.walkedby.manuel.fyi`; the site's data must be in git for a
git-based host (phase 1, step 3).

### 7 — Docs and review

ADR 0028 (provider table, per-site data, fetch/bake/build stages, commit
policy); `docs/portability.md`, `docs/data-pipeline.md`, AGENTS.md,
README, the guide's data-sources page (EN + DE), plan 017's row. Code
reviews after phases 1–3 and at the end.

## STOP conditions (for this run: record, don't ask)

- Dresden's manifest changes after the move → find out why before going on.
- A provider's licence needs terms the footer cannot carry → leave that
  provider's products `null` and say so.
- A portal is unreachable from the container → write the adapter from the
  documentation, mark it untested in the provider table's comment and in
  the report, and leave the fetch for the maintainer's machine.

## Result (2026-09-24)

- **Dresden unchanged:** after the move to `data/dresden/` the build's
  `manifest.json` is byte-identical.
- **Fetched, baked and built in the agent's container** (headless lite
  shots from every viewpoint): Leipzig (4 tiles), Meißen (1), Grimma (2)
  from GeoSN; Unna (2) from Geobasis NRW; München (4) from LDBV; Hamburg
  (4) from LGV with OSM land cover. Sizes of `data/<site>/`: 18–76 MB.
  Geofabrik was unreachable there, so Leipzig's, Hamburg's and München's
  OSM layers were baked from BBBike city extracts (local only, nothing
  committed); Meißen, Grimma and Unna have no lamps/walls yet.
- **Berlin is configured but not fetched:** `gdi.berlin.de` failed TLS
  from the container; the adapter follows the ATOM feeds' documented URLs.
  The block is 3×2 so that both the Brandenburger Tor and the Fernsehturm
  are in it.
- **Walk viewpoints** were checked against OSM when chosen and against the
  fetched data by `bun run site` (none inside a building or on water).
- **OSM land cover vs. the DLM** on Leipzig's centre tile: 71 % of texels
  agree (water 95 %, settlement 78 %, roads 55 %).
- **Two code reviews** (subagents) ran after the pipeline and after the
  fixes; their findings are fixed (district-cut orthophotos in Hamburg,
  half-written products counted as done, partial DLM, Berlin URL and
  extraction bugs, report logic).
- **Open, for a real GPU:** small black squares in some headless
  SwiftShader shots (likely a lite-profile artifact of one dressing layer)
  — look once with `bun run shots` on a real GPU. Brick cities (Hamburg)
  may want a per-site building tint.
