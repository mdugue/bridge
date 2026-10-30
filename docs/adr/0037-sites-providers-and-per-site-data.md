# ADR 0037: Cities, providers and the pipeline — fetch, bake, build; one deployment, a route per city

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10

## Context

The project renders several German cities (Dresden, Leipzig, Meißen,
Grimma, Hamburg, München, Berlin, Unna) from what their Land publishes
openly. Cities differ only in data; a Land decides CRS, licence and which
products exist. Raw downloads are gigabytes and shared by every city of a
Land; what the viewer needs per tile is megabytes.

## Decision

1. **A city is a config, a Land is a provider.** `sites/<id>.ts` holds the
   name, label, 2 km tiles, viewpoints and optional extras (a smaller OSM
   extract, the street-tree register). `sites/providers.ts` holds per
   Land the CRS, licence and credit, portal, OSM extract and the open
   products. The runtime and the bakes know no place names.
2. **Three stages, three commands.** `bun run fetch <site>` (network, the
   provider's adapter in `pipeline/bake/providers/`), `bun run bake <site>`
   (offline, Python), `bun run build` (every ready city, TypeScript). The
   site is the first argument of every command.
3. **The bakes are one Python package** (`pipeline/`, uv, numpy, rasterio,
   pyogrio, shapely — GDAL inside the wheels). Python turns geodata into
   `data/<site>/`; TypeScript turns `data/<site>/` into the tileset
   (ADR 0024). A step reads the network only at fetch time.
4. **What is committed:** per city `data/<site>/` — the build sources
   (DGM1 GeoTIFF, CityJSON) and the small derived files, with
   `provenance.json`. Raw downloads (`data/_raw/<provider>/`) never. No
   Git-LFS. Committing a new city's folder is the maintainer's call
   (`.gitignore` un-ignores each by name).
5. **One deployment serves every city whose data is present** at build
   time, each under its own prerendered route (`/dresden`); `/` lists them.
   Dresden is the reference site: its data is what the checks measure and
   `/wissen` describes.

## Consequences

- A new city in a covered Land is a config file and a line in
  `sites/index.ts`; a new Land is a provider entry and one adapter.
- Clone, `bun install`, `bun dev` works without GDAL or a download.
- A re-bake is a maintainer action and shows up as a data diff.
- Build time grows with the cities built; each is a separately cached
  `prepare-data.ts` run.
- Beyond a handful of committed cities, site data should move out of git
  (a release asset or object storage) — not decided yet.

## Alternatives

- **One deployment per city** (`SITE=` on the host): a host, domain and
  build per city for what differs only in data.
- **The city as a query parameter:** no prerendered page per city.
- **Raw data per city:** duplicates statewide packages (1.2 GB in Saxony).
- **Bash scripts around GDAL CLIs:** three languages and string-built
  paths; replaced by the package.
- **Downloading in the build:** the deploy would depend on every portal's
  uptime and rotating share links.
- **Git-LFS:** a bandwidth quota and a host setting for files that fit
  plain git (the largest is 16 MB).
