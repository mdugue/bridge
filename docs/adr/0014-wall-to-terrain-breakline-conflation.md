# ADR 0014: Burn OSM wall lines into the heightfield as breaklines

- **Status:** superseded by ADR-0023 for TIN tiles (every tile of the shipped block); in force for a tile meshed from its heightfield
- **Date:** 2026-06

## Context

The DGM blurs a vertical wall into a ramp about a metre wide. The OSM wall
ribbon (ADR 0012) drawn over that ramp either floated above it or was
swallowed by it, and the ground never "stepped" — the Brühlsche Terrasse
read as a bank with a fence on it.

## Decision

`lib/city/terrain-conflate.ts` runs inside `loadTerrain` before the mesh is
built. For each wall line of an earth-retaining kind (`retaining_wall`,
`city_wall`, `embankment`) it probes the terrain's natural shelf level 11 m
out on each side, and — only where the two sides differ by ≥ 1.5 m — snaps
cells within 2 m of the line fully to the high-side level on one side and
the low-side level on the other, feathering back to the untouched DGM
within an 11 m band, nearest wall wins. The step is clamped to 18 m so a
bad height tag cannot gouge a canyon. The wall ribbon then skins a real
step. The function is pure and unit-tested.

## Consequences

- Deterministic and source-portable: any DEM plus any OSM wall lines.
- Freestanding garden walls and flat fountain rims (sides equal) leave the
  ground alone.
- Walls must be fetched before the terrain mesh is built; the wall file is
  fetched once and shared with the wall layer (ADR 0006).
- The conflated terrain is what collision and ground-clamp see, so the
  player walks up onto the terrace.

## Alternatives

- **Model the step into the DGM offline:** would tie the committed
  GeoTIFF to one OSM edition and hide the rule.
- **Raise only the ribbon and ignore the ground:** the state before; the
  ribbon floated.
- **Take the step from the laser point cloud:** the wall is smoothed there
  too. *(Corrected 2026-09 — see Update.)*

## Update (2026-09, terrain study)

Measured against held-out laser-scan ground returns, the premise and the
remedy both need qualifying (ledger 🧪 "Terrain TIN"). The laser ground
steps within ~0.75 m and the native 1 m DGM1 within ~1.7 m; the ~3 m bank
was mostly our 1024² resample. The burn sharpens the step but raises the
error in the 20 m band around walls from 0.43 to 0.76 m RMSE: the 11 m
probe reads the top of terraced walls (the Jungfernbastei's three levels
become one cliff) and the step lands on the OSM line, which misses the
measured edge by −0.5…+1 m (4 m at one bastion face). This ADR stays in
force for the default heightfield; the `?terrain=tin` experiment meshes the
native DGM1 without the burn and snaps the ribbon to the measured step
instead (`lib/city/wall-snap.ts`). If that is adopted, this ADR is
superseded for TIN tiles.

## Update (2026-09, adopted)

The TIN was adopted for every tile ([ADR 0023](./0023-terrain-tin-per-tile-and-wall-snap.md)):
the primary at ±0.15 m, the neighbours at ±0.25 m. This decision now applies
only to a tile whose spec names no TIN tolerance.

## References

- Ledger "Wall → terrain conflation"; `lib/city/terrain-conflate.ts` and
  its test; `app/_components/terrain-layer.ts` (`loadTerrain`).
