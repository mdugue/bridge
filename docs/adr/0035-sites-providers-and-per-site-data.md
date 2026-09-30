# ADR 0035: Sites pick a provider; data per site, downloads per provider; one deployment, a route per site

- **Status:** accepted (extends [ADR 0026](./0026-one-site-config-per-build.md)
  and supersedes its one-site-per-build part;
  amends [ADR 0025](./0025-bakes-are-one-python-package.md): `scripts/bake.ts`,
  `ingest_sn.py` and `bake --ingest` became `scripts/pipeline.ts`,
  `providers/sn.py` and `bun run fetch`)
- **Date:** 2026-09

## Context

ADR 0026 made one place configurable. Running several places — Dresden,
Leipzig, Meißen, Grimma, Hamburg, München, Berlin, Unna — showed what was
still in the way: the CRS, the licence, the ingest adapter and the
products each Land publishes sat on every site although they belong to
the Land; all committed data lived flat under `data/`; raw downloads were
per site although Leipzig and Dresden share one 1.2 GB statewide
Basis-DLM; the DGM1 and LoD2 were copied in by hand (and GeoSN's link
service still pointed at a retired LoD2 share); and choosing a site meant
prefixing every command with `SITE=`. A first round moved `SITE` into
`.env.local`, one site per deployment; that made every further city a
further deployment, with its own host, domain and build, for an app
whose sites differ only in data.

## Decision

1. **One deployment serves every site whose data is ready, each under
   its own route** (`/dresden`, `/unna`). There is no `SITE` variable:
   the build (`scripts/prepare-sites.ts`) prepares each ready site into
   `public/data/<site>/` (`prepare-data.ts <site>`) and writes the index
   `public/data/sites.json`; `app/[site]/page.tsx` prerenders one page
   per indexed site (`generateStaticParams`) and 404s the rest; `/` is
   the start page, a card per city with its land-cover map. The viewer
   takes its site from the route (a React context for the HUD, an option
   for the scene) and its manifest from `/data/<site>/`. Commands name
   the site as their first argument (`bun run bake leipzig --step rail`,
   `siteFromArgs`); a wrong name stops with the known ids. Dresden is the
   *reference site* (`REFERENCE_SITE`): committed, described by
   /wissen, measured by the checks.
2. **A site names a `Provider`** (`sites/providers.ts`, typed in
   `lib/city/site.ts`): EPSG, licence and credit line, portal, Geofabrik
   extract, and which optional products are open — a surface model, the
   orthophoto's bands (`"rgbi"` / `"rgb"` / none), the Basis-DLM in the
   AdV Shape profile, a laser scan the adapter reads (`lsc`, opt-in). A
   site is a name, a label, tiles, viewpoints and optionally a smaller OSM
   extract and the city's street-tree register (`treeCadastre`: its
   entry in `bake/cadastre.py` and its credit). The HUD credit is derived
   from the provider (plus the OSM line, which names land cover when OSM
   supplies it, and the register's line). Every tile is 2 km (`TILE_KM`); adapters cut other grids to it.
3. **Data per site, downloads per provider.** `data/<site>/{dgm,cityjson,
   dlm,dop}` + `provenance.json` is what the build reads;
   `data/_raw/<provider>/` holds the downloads every site of that provider
   shares (tile ids are coordinates, so they never collide).
4. **Three stages, three commands.** `bun run fetch <site>` (network: the
   adapter `pipeline/bake/providers/<id>.py` returns the provider's own
   files; common code mosaics and clips rasters to the tile, writes the
   DGM compact — DEFLATE, float predictor, centimetres: ~6 MB instead of
   15 — and converts CityGML to CityJSON with its own streaming converter,
   `bake/citygml.py`), `bun run bake <site>` (offline), `bun dev` /
   `bun run build` (every ready site). `bun run site <site>` reports where
   a site stands, `--all` every site. The site
   config reaches Python as one JSON spec (`scripts/pipeline.ts` →
   `bake/spec.py`).
5. **No open Basis-DLM → land cover from OSM** (`bake/landcover_osm.py`):
   the same class raster, legend and veg rows, so the client cannot tell.
   Rails, ballast and bridge decks stay DLM-only (optional at runtime).
6. **Committing a site's data is a decision, default no.** `.gitignore`
   ignores `data/*` and un-ignores each committed site by name. A site is
   served exactly when its data is where the build runs: from git, that
   means un-ignoring its folder — `bun run site --all` prints the sizes.
   Committed so far: Dresden, then Grimma, Hamburg, Leipzig, Meißen,
   München and Unna (≈ 310 MB together, each with its `provenance.json`).
   Plain git, no LFS: the largest file is a 16 MB LoD2 tile, well under
   GitHub's 50 MB warning; LFS would add a bandwidth quota and a host
   setting for every build without solving anything here.

## Consequences

- A new place in a covered Land is one file in `sites/` and one line in
  `sites/index.ts`; a new Land is a provider entry and one adapter module
  (five functions: `dgm`, `dom`, `dop`, `lod2`, `dlm`).
- Dresden builds byte-identically (same manifest) after the move; its
  files moved from `/data/` to `/data/dresden/`, and `/city` redirects to
  `/dresden`.
- Adding a city to a deployment is data, not configuration: no host
  setting, no second domain. The client bundle carries the registry of
  every site (a few kB of names and viewpoints); the data stays per site
  and is only fetched on its route.
- The build time grows with the sites built — each one is a separate,
  cached `prepare-data.ts` run.
- No Java, no citygml-tools, no cjio on the maintainer's machine; the
  converter keeps only what the build reads (MultiSurface with semantics,
  the attributes, the part tree).
- A git-hosted deployment of a non-committed site cannot build. Beyond a
  few deployed sites the repo would grow by ~20–40 MB per site; that is
  when to move site data out of git (below).

## Alternatives

- **One deployment per site** (`SITE` on the host, the first round of
  this ADR): a host, a domain and a build per city, and a start page
  that could only link out to other deployments.
- **Choosing the site at runtime from a query parameter** (`/?site=unna`):
  no prerendered page or metadata per city, and a URL that is not the
  city's.
- **Everything per site** (raw included): duplicates statewide packages
  per site (1.2 GB in Saxony, 4.7 GB in NRW before member extraction).
- **Commit every site:** seven sites would roughly triple the repository.
- **Data bundles outside git** (a release asset or object storage per
  site, fetched and hash-checked by the build): the right next step for
  many deployments, but it adds hosting the maintainer has to run —
  not decided here.
- **citygml-tools + cjio:** a JRE and a Python tool on every machine that
  fetches, for a conversion the AdV profile makes simple.
- **Building a site from the provider at build time:** the host would
  depend on every portal's uptime and on share links that rotate.

## References

- `sites/`, `lib/city/site.ts`, `lib/city/tile.ts`, `lib/city/site-report.ts`,
  `lib/city/site-index.ts`, `scripts/prepare-sites.ts`, `app/[site]/page.tsx`,
  `app/page.tsx`, `app/_components/site-context.tsx`,
  `scripts/pipeline.ts`, `scripts/site-report.ts`, `pipeline/bake/{fetch,
  spec,net,rasters,citygml,landcover_osm}.py`, `pipeline/bake/providers/`.
- [Plan 037](../plans/037-many-sites-one-env-var.md), [plan 017](../plans/017-germany-wide-sites.md),
  [portability.md](../portability.md).
