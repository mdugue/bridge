# ADR 0037: Where a Land publishes less, a named stand-in — marked per city — and no per-site switches

- **Status:** accepted
- **Date:** 2026-10

## Context

[ADR 0035](./0035-sites-providers-and-per-site-data.md) made every step a
per-tile pipeline step read from the site config, so a new city gets
whatever its Land publishes. But the Länder publish different things
openly, and a step whose source a Land lacked simply wrote an empty file:

- **Hamburg and Berlin publish no open Basis-DLM.** Land cover already
  fell back to OSM (`landcover_osm.py`), but rails, ballast and the bridge
  decks were DLM-only — Hamburg, a city of bridges, had none, and no
  track either (the U3 viaduct beside the Elbphilharmonie, the
  Hauptbahnhof's approaches).
- **Bavaria's open orthophoto is RGB only**: no infrared band, so no NDVI,
  and Munich's crowns and meadows lost the colour the others get from it.
- **Street-tree registers** are a city's, not a Land's: Dresden's was the
  only one read, with its WFS schema written into the bake.
- **Laser scans** are open in Saxony, NRW and Bavaria, not in Hamburg.

At the same time some looks were set per site by hand, or tuned on Dresden
and then applied everywhere: Hamburg's `facades: "brick"` (one palette
for every quarter of the site, whatever its own buildings are mapped as),
the valley
haze's depth (Dresden's Elbe-to-rim drop, which hazed flat Hamburg and
Munich from the river to the rooftops), the tram gauge (Dresden's
1450 mm, Leipzig's is 1458 mm), a fixed 12 landmarks a tile (which cut an
old town's second rank).

## Decision

1. **Every layer reads the best open source there is, and where a Land or
   city lacks it, a named stand-in rather than nothing**: the OSM rail
   network and bridge ways for the DLM's rails and decks (`rail_osm.py`;
   the deck heights stay measured in DOM1, the superstructure, the
   fairway clearance and Wikidata are the same code), a visible-band
   vegetation index (GLI, fitted to the NDVI's scale where both exist) for
   a DOP without infrared, a register table with a field mapping per city
   for the street trees. A stand-in is chosen only where it is honestly
   the second best — a source that measures or maps the same thing — and
   never invents what no source shows.
2. **The stand-ins are visible, per city.** The knowledge base's *Sources
   by city* page (`docs/guide/{en,de}/sources-by-city.md`) is generated
   from the site and provider configs (`lib/city/source-matrix.ts`,
   `bun run docs:matrix`), not written by hand: each cell names the
   source and marks it best (🟢), OSM as the only source (🔵), a stand-in
   (🟡, with the reason) or missing (⚪, with the reason). Its test fails
   when the committed page differs from what the configs say.
3. **No per-site look switches; derive them from the site's own data.**
   A building without a mapped material wears what its OSM neighbourhood
   is mapped as (`osm_buildings.py` `context`, a distance-weighted vote
   within 300 m, the tile's vote where too few are mapped); the valley
   haze pools over a share of the site's ground relief (its 2nd to 90th
   height percentile, `lib/city/valley-fog.ts`), capped at the depth it
   was tuned on in Dresden; a tram track carries its OSM `gauge`; a
   tile's landmarks are those with a share of its most notable one's
   Wikipedia articles. `Site.facades` is gone.

## Consequences

- Hamburg draws its rails, ballast and 300-odd bridge decks; Munich's
  vegetation is coloured; Hamburg, Leipzig and Berlin plant their
  registers' trees. What a city shows depends on its data, and the page
  says so.
- A stand-in is weaker than what it replaces, and the page's footnotes
  say how: OSM maps a track per way where the DLM bundles them, and a
  bridge as several ways (the bake merges the buffers of one level); the
  GLI tells green from grey well and vigour less well (r ≈ 0.7 against
  the NDVI on NRW's summer DOP); Hamburg's register has no heights.
- A new look parameter that differs between cities is derived from data
  in the bake or the build, not added to `Site`.
- The matrix's rows are what the viewer draws, not the steps; a new layer
  adds a row (and its sources), and the test keeps the page current.

## Alternatives considered

- **Leave the layer out where the official source is missing** (the
  status quo for rails and decks): honest, but a city of bridges without
  bridges reads as broken, and OSM's bridge ways are good where a deck's
  height is measured anyway.
- **A per-site switch for each look** (`facades`, a fog depth, a gauge):
  simple, but each is one more thing a new city must be tuned for, and a
  whole-site value cannot follow the quarters inside the site (on one of
  Hamburg's tiles 128 buildings sit among mapped plaster walls and now wear
  plaster, the rest brick).
- **A hand-written source table in the guide**: drifts the first time a
  provider gains a product; generating it from the configs costs one
  pure module and one test.
