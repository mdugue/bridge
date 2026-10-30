# ADR 0012: Sources — official data first, OSM and Wikidata for what it lacks, named stand-ins marked per city

- **Status:** accepted
- **Date:** 2026-06, rewritten 2026-10

## Context

The official products (DGM1, DOM1, LoD2, DOP, Basis-DLM, laser scan) are
measured and licensed openly, but they lack street furniture, walls,
stairs, platforms, building names and uses, and nothing in them says which
buildings are a city's landmarks. Länder publish different subsets:
Hamburg and Berlin have no open Basis-DLM, Bavaria's orthophoto has no
infrared band, a street-tree register is a city's, not a Land's.

## Decision

1. **The best open source per layer.** Official data where it exists;
   OpenStreetMap for what it does not model; Wikidata (CC0) for what is
   notable (landmarks, bridge types, materials); open street photos
   (Mapillary, Panoramax — never Google Street View) for what only a
   facade shows. Sources under different licences stay in separate files
   (Mapillary's CC BY-SA output is never merged into an ODbL file). Every
   source's licence and credit travels with the data (HUD footer, `attribution` members, the
   guide's licence table, `NOTICE`).
2. **OSM is read only from a local extract** (`.osm.pbf` through GDAL's OSM
   driver, indexed once per bake), Wikidata only from the fetch's cached
   answer. No Overpass, no live query in a bake.
3. **Where a Land lacks a source, a named stand-in where one measures or
   maps the same thing; otherwise the layer is off and the matrix says so;
   never an invention:** land cover, rails and bridge ways from OSM where
   there is no Basis-DLM; a visible-band vegetation index where the DOP
   has no infrared; a register mapping per city for street trees.
4. **The stand-ins are visible per city.** The guide's *Sources by city*
   pages are generated from the site and provider configs
   (`lib/city/source-matrix.ts`, `bun run docs:matrix`); a test fails when
   they drift.
5. **No look switch per city.** A look that differs between cities (facade
   material, haze depth, tram gauge, how many landmarks a tile has) is
   derived from the city's own data in the bake or build, never added to
   `Site`.

## Consequences

- What a city shows depends on its data, and the guide says so.
- OSM layers are as complete as the mappers made them; an empty or missing
  file means "layer off".
- A new look parameter that differs between cities is a derivation, not a
  config field.

## Alternatives

- **Overpass at bake time:** rate limits and no reproducibility.
- **Leaving a layer out where a stand-in exists:** a city of bridges
  without bridges reads as broken.
- **Per-site switches** (`facades: "brick"`): one more thing to tune per
  city, and one value cannot follow the quarters inside a city.
- **A hand-written source table:** drifts with the first new product.
