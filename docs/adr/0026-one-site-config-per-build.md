# ADR 0026: One site config per build, with an ingest adapter per data provider

- **Status:** accepted
- **Date:** 2026-09

## Context

Dresden was spelled in constants across the code (tile list, spawn,
viewpoints, labels, attribution, the sun's fallback position) and the
bake scripts (tile suffix, extents, CRS). Plan 017 makes any German city a
goal.

## Decision

`sites/<id>.ts` (typed, `lib/city/site.ts`) holds everything about a
place that is not data: label and title, CRS and tile grid, the tile list
(the first is the spawn), the curated viewpoints, the attribution lines,
the sun's fallback position and the ingest adapter. `SITE=<id>` picks one
at build time (default `dresden`); `next.config.ts` inlines it for the
client, and the bakes read the same registry (`sites/index.ts`). The
provider-specific part of the pipeline is an ingest adapter per Land
(`pipeline/bake/ingest_<id>.py`), normalising downloads into one raw
layout the bakes read.

## Consequences

- A second site is a config file and (where needed) an adapter; the
  runtime and the bakes know no place names.
- One site per build: the app stays a static bundle (ADR 0001); a
  multi-site deployment is several builds.
- The site config is TypeScript, not JSON, so the compiler checks it.

## Alternatives

- **JSON site files:** plan 017's sketch; loses type checking of unions
  (movement modes, EPSG codes).
- **Runtime site selection:** would ship every site's data manifest and
  couple unrelated deployments.

## References

- `sites/`, `lib/city/site.ts`, plan 017.
