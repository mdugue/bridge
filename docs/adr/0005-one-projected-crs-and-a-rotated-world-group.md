# ADR 0005: Data stays in its provider's UTM zone, under one recenter offset and a rotated `world` group

- **Status:** accepted
- **Date:** 2026-06, generalised 2026-10

## Context

German state data comes in ETRS89 / UTM — EPSG:25833 for Saxony and
Berlin, 25832 for Hamburg, Bavaria and NRW — in metres, Z-up. three.js is
Y-up. Tiles must align to the centimetre, and lengths must be metres.

## Decision

- Data stays in the provider's CRS (`Provider.epsg`). The bakes never
  reproject to WGS84; OSM is reprojected into the provider's CRS at bake
  time. The client never reprojects.
- One recenter offset `(cx, cy)` per site, taken at bake time from the
  spawn tile and carried in the tileset's extras:
  `x = E − cx`, `z = −(N − cy)`, `y = elevation`.
- A parent `world` group is rotated −90° about X, so data-Z becomes
  scene-Y. The glTF content is Y-up and the renderer's up-axis turn cancels
  the rotation, so a tile's content root is the Y-up scene frame.
- Dressing that computes its own Y-up positions lives in the Y-up frame,
  never inside the rotated group.

## Consequences

- Coordinates in the baked files can be checked on a map.
- Putting Y-up coordinates into the rotated group applies the turn twice
  (trees shoot skyward); AGENTS.md carries the rule.
- Shaders that need data-frame coordinates derive them from world space
  (world (x, y, z) = data (x, −z, y)), because quantised glTF positions
  are not metres.

## Alternatives

- **Rotating the data to Y-up at bake time:** every bake and loader would
  carry the swap, and the files would stop matching their sources.
- **WGS84 degrees:** not a metric frame.
