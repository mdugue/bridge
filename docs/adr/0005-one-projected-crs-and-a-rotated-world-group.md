# ADR 0005: One projected CRS (EPSG:25833) and a −90° rotated `world` group

- **Status:** accepted
- **Date:** 2026-06

## Context

Every Saxon dataset is delivered in ETRS89 / UTM zone 33 N (EPSG:25833):
metres east and north, Z-up heights in DHHN2016. three.js is Y-up. Tiles
must align to the centimetre, and geometry must be expressible in metres so
that heights, widths and camera speeds mean what they say.

## Decision

- All data stays in EPSG:25833; the bake scripts never reproject to
  WGS84 (`RFC7946=NO`), and OSM inputs are reprojected *into* 25833 at bake
  time. The client never reprojects.
- A parent `world` group is rotated −90° about X, so data-Z (elevation)
  becomes scene-Y. Layers built from data-frame geometry (terrain, water,
  the city mesh) live in `world`; layers that compute Y-up positions
  themselves (vegetation, lamps, rails, walls, the sun rig) live in `scene`.
- A shared **recenter offset** `(cx, cy)` is captured from the primary
  tile's building bake and reused by every tile, so all tiles land in one
  frame: `x = epsgX − cx`, `z = −(epsgY − cy)`, `y = elevation`.
- The sun direction is computed in an east-north-up frame from suncalc and
  mapped into the same world frame.

## Consequences

- Coordinates in GeoJSON can be eyeballed on a map; viewpoints are
  authored in EPSG:25833 with a height above terrain.
- Adding a Y-up object to `world` (or a data-frame object to `scene`)
  applies the rotation twice — the "trees shoot skyward" bug. The rule is
  written into AGENTS.md and the skill.
- Porting to another UTM zone is a matter of capturing a different `(cx,
  cy)`; the math is CRS-agnostic. The CityJSON must declare EPSG:25832 or
  25833 (`lib/city/crs.ts`).
- Float precision is fine because everything is recentred to the tile
  block (offsets of ±4 km, not ±5,000 km).

## Alternatives

- **Rotate the data at bake time to Y-up:** rejected — every bake and
  every loader would carry the swap, and the baked artifacts would stop
  matching the source coordinates.
- **Work in WGS84 degrees:** not a metric frame; rejected.

## References

- AGENTS.md "Coordinate system"; `lib/city/ground-clamp.ts`,
  `lib/city/recenter.ts`, `lib/city/sun.ts`.
