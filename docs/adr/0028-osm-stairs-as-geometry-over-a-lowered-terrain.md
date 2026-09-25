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
  `area:highway=steps` outline over the way (area ÷ axis length), else the
  gap between the OSM walls either side (within 15 m, the axis re-centred
  between them) when the slope fills that gap — both edges climb at least
  half the axis's rise, as beside the Italienisches Dörfchen — else
  2.5 m, and the step count from `step_count` when it gives a riser of
  8–25 cm, else the rise ÷ 16 cm. Flatter than 30 cm: left out (the DGM
  cannot place it). Unclipped; the viewer stands a flight on the tile that
  owns its middle.
- **Structures the DGM lacks**: the Brühlsche Terrasse stands on casemates,
  so the bare-earth DGM runs flat under it and the Freitreppe from the
  Schlossplatz came out as two 18 cm steps. When the DGM gives a flight
  less than half its tagged rise (`step_count` × `step:height`, 15 cm
  untagged), its `incline` says which end is up, and that end lies within
  3 m of a raised OSM area (`layer` ≥ 1; no building, bridge or railway
  area), the tagged rise is taken from the lower landing, and the area is
  written to `terraces_<tile>.geojson` at the flight's top level (the
  highest, when several reach it) — its outer rings, holes filled: the
  lawns, fountain and monuments cut out of the promenade stand on the
  platform too.
- **Build** (`lib/city/stairs.ts`, after the wall conflation):
  `raiseTerraces` lifts the grid inside each terrace to its level; then
  `burnStairs` sets the grid under each flight to 12 cm below the ramp
  through the steps' inner corners, lifting it where the DGM runs below
  — the player walks on the grid, not on the steps, so under a lifted
  flight the ground must climb with it. Beside the flight, every vertex
  out to half the width plus 1.5 cells (its ends included, because each
  vertex of a triangle under a tread lies within √2 cells of it) is only
  lowered, and never across a wall: a vertex with a wall between it and
  the axis is left alone, so a flight between walls does not dig into the
  terrace beyond them.
- **Geometry, baked** (`lib/city/stairs.ts` `stairGeometry`, written by
  `scripts/bake-tiles.ts` `stairMesh`): the fine terrain glTF carries a
  `stairs` node next to its grid, the flights the tile owns (the one owning
  a flight's middle) with their shades as 8-bit vertex colours — built by
  the same build step, from the same file, that shapes the ground under
  them, so ground and steps cannot disagree, and the browser computes
  nothing. `stair-layer.ts` only gives the node its material. Each flight
  is stone blocks — a tread per step at z0 + (k+1)·rise (the last tread is the top landing),
  a riser at each step's front, and side cheeks reaching 0.6 m below the
  bottom landing, so a lifted flight is a solid block down to the ground.
  The stone is a warm sandstone a shade deeper than the pale ground, risers
  at 62 %, cheeks at 80 % of it, so the steps read under flat light. A bend closes its outer wedge instead of mitring
  (a mitred inner edge folds back on a short step).

## Consequences

- The player walks on the terrain, 12 cm under the ramp — below the eye's
  noticing; stairs are not colliders. (The first lifted Freitreppe only
  lowered the ground, so walking up it led underneath the steps.)
- One level per terrace: the DOM1 puts the Brühlsche Terrasse at 118.3 m
  in the west and 117.4 m in the east, so the east end sits up to ~1 m
  high.
- A flight's heights come from the raw DGM, before the wall conflation;
  where a flight ends at a conflated wall step, its landing and the
  terrain may differ by the wall's feathering.
- A step count is a tag or an estimate, never measured.
- The stairs cost the fine terrain glTF 20–60 kB per tile (gzipped, 16–43 k
  vertices); `stairs_<tile>.geojson` is a build input and no longer served.
  The stairs arrive with the terrain, not behind the dressing gate.
- A terrace is only as good as its OSM outline: the Brühlsche Terrasse
  area is the promenade strip, not the whole platform; the buildings on the
  platform keep their LoD2 bases.
- The first rendering had a margin capped at 0.5 m and a 2.5 m default
  width for the Dörfchen flight: the ground beside the steps covered their
  edges like snow, and the flight was a seventh of its real width. Both
  were reported and are what the wall rules above replace.
- Portable: any DEM plus any OSM extract; no DOM or DOP needed.

## Alternatives

- **Burning the steps into the heightfield**: the grid is 2 m (4 m on the
  coarse level); a 30 cm tread cannot exist in it.
- **Building the steps in the browser from the GeoJSON** (the first
  version, like the walls): the same arrays computed on every tile load,
  and two sources of truth for one flight — the ground baked, the steps
  not. The steps depend on nothing the runtime knows, so they are baked.
- **A textured ramp** (a stripe shader on the slope): no silhouette, no
  shadows between steps, and the ramp keeps the DGM's rounded profile.
- **Trusting a tagged rise everywhere the DGM disagrees**: the top of such
  a flight would float in the air wherever nothing raises the ground to
  meet it; the rise is only taken where a raised area is there to lift.
- **Treads raised over the untouched DGM**: the smoothed profile bulges
  above the straight line between the landings, so the ground cut through
  the lower half of the treads (a zebra of terrain and stone).
- **ALKIS stairs**: official and complete, but not in the ingest adapter;
  a candidate source for the same bake when an ALKIS download is added.

## References

`pipeline/bake/stairs.py`, `lib/city/stairs.ts`, `app/_components/stair-layer.ts`,
`scripts/bake-tiles.ts` (`terrainMesh`), ADR 0012, ADR 0014;
[transformations.md](../transformations.md).
