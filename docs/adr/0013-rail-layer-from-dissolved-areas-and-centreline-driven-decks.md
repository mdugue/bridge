# ADR 0013: Rail layer from dissolved ballast areas and centreline-driven decks, built once per block

- **Status:** accepted; built per tile on the heights of every loaded terrain since [ADR 0024](./0024-site-streams-as-3d-tiles.md), baked by the Python pipeline ([ADR 0025](./0025-bakes-are-one-python-package.md))
- **Date:** 2026-06 (v2 after the v1 per-line approach), re-baked 2026-09

## Context

The railway corridor and the bridges first existed only as a flat
land-cover colour on the terrain: a brown smear, no tracks, bridges that
sank into the Elbe (the DGM removes decks by definition). The first
geometric attempt (v1) built one ~9.6 m ribbon per `ver03_l` line, buffered
`ver06_l` centrelines into deck planks, and built the layer per tile. It
z-fought in yards (42+ overlapping coplanar ribbons → ragged edges),
stacked deck + ballast + parapet cap into "2-storey" bridges, merged the
parallel Marienbrücke rail and road spans into one plank, and truncated
tracks at every tile seam because each tile's `heightAt` returned null
off-tile. A second cut that used only `ver06_f` deck polygons dropped every
road and path bridge (they have no area polygon) and misclassified the
rest as rail.

## Decision

`scripts/extract-rail.sh` bakes, per tile:

- **ballast yards** from Basis-DLM `ver03_f` (`OBJART=42010`) **dissolved**
  with `ST_Union(ST_MakeValid())` and clipped to the tile → one merged,
  non-overlapping surface;
- **rails** from `ver03_l` heavy rail only (`SPW=1000`; trams excluded),
  fragments snap-merged by shared endpoints, with `tracks` and
  `electrified`;
- **bridge decks** driven by the **complete `ver06_l` centreline set**
  (`BWF=1800`, carries every road/rail/path bridge and the name), each
  snapped to a `ver06_f` footprint where one matches within 50 m, else
  buffered by kind width; per-ring-vertex deck Z = DGM abutment ramp lifted
  to the DOM1 surface; `kind` by rasterising the networks; `structure` from
  the nearest OSM `man_made=bridge` within 60 m;
- **platforms** from OSM.

`app/_components/rail-layer.ts` builds the layer **once for the whole
block** on the cross-tile `heightAt`, splits polylines into runs of valid
ground, lifts rails onto decks by a point-in-deck test, draws flush parapet
walls, and synthesises segmental arches on river piers only where OSM says
`arch` and the deck clearance allows. All geometry is hand-wound to its
normal so every material is `FrontSide`.

## Consequences

- Yards cannot z-fight (one surface); parallel spans are separate slabs;
  road and path bridges render even without an area polygon; tracks cross
  tile seams.
- The bake needs GDAL with the SQLite/Spatialite dialect.
- The buffered-centreline deck survives as the portability fallback for
  regions without `ver06_f`.
- `cable-stayed` and `truss` structures still fall back to a flat soffit
  (ledger: planned).

## Alternatives

- **v1 per-line ribbons, buffered planks, per-tile build:** rejected by
  experience (above).
- **`ver06_f`-only decks:** rejected — drops road/path bridges.
- **OSM `railway=rail` as the primary track source:** kept as the
  portability fallback; Basis-DLM carries track count and electrification.

## References

- Ledger "Railway & bridges" and the four 🗃️ rail rows;
  `scripts/extract-rail.sh` (since ADR 0025: `pipeline/bake/rail.py`),
  `app/_components/rail-layer.ts`;
  `lib/city/features.ts` (`RailFeature`, `BridgeFeature`, `AreaFeature`).
