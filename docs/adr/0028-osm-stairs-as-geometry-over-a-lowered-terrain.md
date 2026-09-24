# ADR 0028: OSM stairs as step geometry over a lowered terrain

- **Status:** accepted
- **Date:** 2026-09

## Context

The DGM1 smooths a flight of steps into a bank, just as it smooths a wall
(ADR 0014). The Freitreppe beside the Italienisches Dörfchen, between the
Terrassenufer promenade (~108 m) and the Theaterplatz (~112 m), rendered as
a grassy slope. The terrain grid is ~2 m at its fine level; a riser is
~16 cm, so no heightfield edit can draw steps. OSM maps the flights
(`highway=steps`, often with `width`, `step_count`, sometimes an
`area:highway=steps` outline); the official ALKIS models stairs too
(`AX_SonstigesBauwerkOderSonstigeEinrichtung`), but Saxony's ALKIS is not
in the ingest adapter and the Geofabrik extract is already read.

## Decision

- **Bake** (`pipeline/bake/stairs.py`): every `highway=steps` way that is
  not indoor, underground, in a tunnel or on a bridge becomes a flight:
  its axis oriented bottom → top, the two landing heights read from the DGM
  a metre beyond each end (3×3 m median), the width from `width`, else an
  `area:highway=steps` outline over the way (area ÷ axis length), else
  2.5 m, and the step count from `step_count` when it gives a riser of
  8–25 cm, else the rise ÷ 16 cm. Flatter than 30 cm: left out (the DGM
  cannot place it). Unclipped; the viewer stands a flight on the tile that
  owns its middle.
- **Build** (`lib/city/stairs.ts` `burnStairs`, after the wall conflation):
  the terrain grid under the flight is lowered to 12 cm below the ramp
  through the steps' inner corners, so no ground pokes through a tread.
  It only ever lowers; the cells beside the flight whose triangles reach
  under its edge may sink by at most 0.5 m, so a flight along a retaining
  wall does not dig into the terrace above it.
- **Viewer** (`stair-layer.ts`): each flight is built as stone blocks —
  a tread per step at z0 + (k+1)·rise (the last tread is the top landing),
  a riser at each step's front, and side cheeks reaching 0.6 m below the
  ramp. Risers are shaded darker than treads, cheeks between, so the steps
  read under flat light. A bend closes its outer wedge instead of mitring
  (a mitred inner edge folds back on a short step).

## Consequences

- The player still walks on the terrain, now 12 cm under the ramp — below
  the eye's noticing; stairs are not colliders.
- A flight's heights come from the raw DGM, before the wall conflation;
  where a flight ends at a conflated wall step, its landing and the
  terrain may differ by the wall's feathering.
- A step count is a tag or an estimate, never measured.
- Portable: any DEM plus any OSM extract; no DOM or DOP needed.

## Alternatives

- **Burning the steps into the heightfield**: the grid is 2 m (4 m on the
  coarse level); a 30 cm tread cannot exist in it.
- **A textured ramp** (a stripe shader on the slope): no silhouette, no
  shadows between steps, and the ramp keeps the DGM's rounded profile.
- **Treads raised over the untouched DGM**: the smoothed profile bulges
  above the straight line between the landings, so the ground cut through
  the lower half of the treads (a zebra of terrain and stone).
- **ALKIS stairs**: official and complete, but not in the ingest adapter;
  a candidate source for the same bake when an ALKIS download is added.

## References

`pipeline/bake/stairs.py`, `lib/city/stairs.ts`, `app/_components/stair-layer.ts`,
`scripts/bake-tiles.ts` (`terrainMesh`), ADR 0012, ADR 0014;
[transformations.md](../transformations.md).
