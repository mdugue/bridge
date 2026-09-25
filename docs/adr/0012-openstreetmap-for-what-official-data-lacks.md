# ADR 0012: OpenStreetMap for what the official data lacks, read from a local extract where possible

- **Status:** accepted; "where possible" tightened to "always" by [ADR 0025](./0025-bakes-are-one-python-package.md)
- **Date:** 2026-06 (lamps, platforms), 2026-09 (walls from a local extract)

## Context

The official datasets model no street furniture and no platforms, and the
monumental retaining walls of the old town (Brühlsche Terrasse) are in
none of them as a wall: DGM1, DOM1 and the classified laser ground all turn
it into a ramp (1–2 m wide in DGM1, ~0.75 m in the laser returns; the
"gentle bank" the viewer showed was mostly its 1024² resample — corrected
2026-09, ledger "Terrain TIN"), and it is not a building in
the LoD2 model, so it "went missing". OpenStreetMap has all of these as
tagged vector features, including wall heights and bridge structure types,
under the ODbL. Overpass, the public query API, rate-limits bursts with an
HTML 429 page.

## Decision

OSM is the source for street lamps (`highway=street_lamp`), station
platforms (`railway=platform`), retaining / city walls and embankments
(`barrier=*`, `man_made=embankment` with `height`), and the
`bridge:structure` tag that decides between arches and box piers. Small
point queries go through Overpass with the raw response cached and
validated as JSON before reuse. Walls are read from a local Geofabrik
`.osm.pbf` extract via GDAL's OSM driver (both the `lines` and
`multipolygons` layers, because GDAL routes closed ways with an area key
into the latter) — no rate limits, reproducible, one pass for the whole
block; verified feature-for-feature identical to the previous Overpass
bake. The ODbL credit is carried in the HUD footer, the README and as an
`attribution` member in the emitted GeoJSON.

## Consequences

- Four layers depend on volunteer data whose completeness varies; the
  loaders treat an empty or missing file as "feature off".
- Heights default per wall kind (city_wall 6 m, retaining_wall 3 m, wall
  1.5 m, embankment 2.5 m) when untagged, clamped 0.5–30 m.
- Re-baking OSM layers means deleting the cached Overpass responses and,
  for walls, downloading a fresh extract; the extract date should be
  recorded (guide: dataset editions).
- The attribution must stay wherever OSM-derived geometry is shown.

## Alternatives

- **Overpass for walls too:** the original bake; rejected for rate limits
  and irreproducibility.
- **Model the walls by hand or derive them from the laser point cloud:**
  the wall is not in the point-cloud ground either; hand modelling is out of
  scope.
- **ALKIS building-parts for platforms:** not available in the tiles.

## References

- `scripts/extract-lamps.sh`, `extract-walls.sh`, `extract-rail.sh`;
  ledger "Street lamps", "Station platforms", "Bridge arches", "Walls";
  plan 014 (attribution audit, finding #58).
