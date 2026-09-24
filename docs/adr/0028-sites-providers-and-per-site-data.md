# ADR 0028: Sites pick a provider; data per site, downloads per provider; fetch → bake → build

- **Status:** accepted (extends [ADR 0026](./0026-one-site-config-per-build.md);
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
prefixing every command with `SITE=`.

## Decision

1. **`SITE` comes from `.env.local`** (gitignored; `.env.example` is
   committed). Bun loads it for every script, Next for dev and build; a
   deployment sets it in the host's environment. Default `dresden`.
2. **A site names a `Provider`** (`sites/providers.ts`, typed in
   `lib/city/site.ts`): EPSG, licence and credit line, portal, Geofabrik
   extract, and which optional products are open — a surface model, the
   orthophoto's bands (`"rgbi"` / `"rgb"` / none), the Basis-DLM in the
   AdV Shape profile. A site is a name, a label, tiles, viewpoints and
   optionally a smaller OSM extract. The HUD credit is derived from the
   provider (plus the OSM line, which names land cover when OSM supplies
   it). Every tile is 2 km (`TILE_KM`); adapters cut other grids to it.
3. **Data per site, downloads per provider.** `data/<site>/{dgm,cityjson,
   dlm,dop}` + `provenance.json` is what the build reads;
   `data/_raw/<provider>/` holds the downloads every site of that provider
   shares (tile ids are coordinates, so they never collide).
4. **Three stages, three commands.** `bun run fetch` (network: the
   adapter `pipeline/bake/providers/<id>.py` returns the provider's own
   files; common code mosaics and clips rasters to the tile, writes the
   DGM compact — DEFLATE, float predictor, centimetres: ~6 MB instead of
   15 — and converts CityGML to CityJSON with its own streaming converter,
   `bake/citygml.py`), `bun run bake` (offline), `bun dev` / `bun run
   build` (unchanged). `bun run site` reports where a site stands. The site
   config reaches Python as one JSON spec (`scripts/pipeline.ts` →
   `bake/spec.py`).
5. **No open Basis-DLM → land cover from OSM** (`bake/landcover_osm.py`):
   the same class raster, legend and veg rows, so the client cannot tell.
   Rails, ballast and bridge decks stay DLM-only (optional at runtime).
6. **Committing a site's data is a decision, default no.** `.gitignore`
   ignores `data/*` except `data/dresden/`. Deploying a site from git
   means un-ignoring its folder — `bun run site --all` prints the sizes.

## Consequences

- A new place in a covered Land is one file in `sites/` and one line in
  `sites/index.ts`; a new Land is a provider entry and one adapter module
  (five functions: `dgm`, `dom`, `dop`, `lod2`, `dlm`).
- Dresden builds byte-identically (same manifest) after the move.
- No Java, no citygml-tools, no cjio on the maintainer's machine; the
  converter keeps only what the build reads (MultiSurface with semantics,
  the attributes, the part tree).
- A git-hosted deployment of a non-committed site cannot build. Beyond a
  few deployed sites the repo would grow by ~20–40 MB per site; that is
  when to move site data out of git (below).

## Alternatives

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
  `scripts/pipeline.ts`, `scripts/site-report.ts`, `pipeline/bake/{fetch,
  spec,net,rasters,citygml,landcover_osm}.py`, `pipeline/bake/providers/`.
- [Plan 023](../plans/023-many-sites-one-env-var.md), [plan 017](../plans/017-germany-wide-sites.md),
  [portability.md](../portability.md).
