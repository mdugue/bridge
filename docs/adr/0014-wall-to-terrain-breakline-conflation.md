# ADR 0014: Burn OSM wall lines into the heightfield as breaklines

- **Status:** accepted
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
  too.

## References

- Ledger "Wall → terrain conflation"; `lib/city/terrain-conflate.ts` and
  its test; `app/_components/terrain-layer.ts` (`loadTerrain`).
