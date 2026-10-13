# ADR 0029: Static dressing is baked into the fine terrain glTF

- **Status:** accepted; the rails, trams and riverside are baked too since the update below
- **Date:** 2026-09

## Context

The fine terrain level is dressed in the browser from per-tile GeoJSON:
vegetation, lamps, rails, walls, and (briefly) stairs. For walls and stairs
that split one feature across two places. The ground under them was shaped
at build time (the wall breaklines, ADR 0014; the stair burn and terraces,
ADR 0028), while their geometry was built at runtime from the same file,
over whichever terrain levels happened to be loaded. Neither depends on
anything the runtime knows: no look slider, no time of day, no device.

## Decision

Geometry that depends only on baked data is baked into the fine terrain
glTF (`terrain_<tile>_l0.glb.gz`), as named nodes beside the grid:

- `stairs`: the flights the tile owns (the one owning a flight's middle),
  treads, risers and cheeks with 8-bit `COLOR_0` shades
  (`scripts/bake-tiles.ts` `stairMesh`, `lib/city/stairs.ts`).
- `walls`: the tile's wall ribbons (`wallMesh`, `lib/city/walls.ts`),
  standing on the shaped fine ground of **every** tile of the site. A wall
  near a seam probes 9 m into its neighbour, so the fine grids of all tiles
  are built first, and the L0 cache key covers every tile's terrain inputs.

The viewer finds a tile's meshes by node name (`terrain`, `city`,
`stairs`, `walls`) and only gives the baked nodes their materials
(`stair-layer.ts`, `wall-layer.ts`). The kerb stones (`kerbs`) and the
fences with their gates (`fences`, plan 029: `lib/city/fences.ts`, one
low band per line in a tone `fence-layer.ts` gives it) followed the
same way. The GeoJSON they come from stays in
`data/<site>/dlm/` as a build input and is no longer served.

## Consequences

- Ground and geometry come from one build step and one file; they cannot
  disagree, and the browser computes neither.
- Walls and stairs arrive with the fine terrain, not behind the dressing
  gate, and leave with it; they count in the census from the terrains.
- A fine terrain glTF grows by 35–70 kB (walls) and 20–60 kB (stairs),
  gzipped; the walls GeoJSON (8–22 kB) is no longer fetched.
- Changing one tile's walls, stairs or DGM re-bakes every tile's L0 (about
  20 s for the site, cold).

## Alternatives

- **Keep building them in the browser**: two sources of truth, and walls
  that stood on the coarse level's ground when only that was loaded.
- **Separate glTF content per layer**: more requests and more tileset
  plumbing for geometry that always travels with the fine terrain.
- **Vegetation, lamps and rails too**: vegetation carries the look state
  (crown LOD, NDVI tint, sliders) and instancing; lamps drive the light
  pool; rails are the next candidate once their deck heights move to the
  build — not part of this decision (they are since ADR 0041 and the
  update below).

## Update (2026-10-10): the rails, trams and riverside are baked too

Plan 074 part A's spike moved the next candidates the *Alternatives*
named into the fine terrain glTF, now that the build solves the lines'
levels (ADR 0041): the **rails** (ballast yards, the steel on its level,
the polygon and line platforms, the decks under a span), the **trams**
(the tracks in their bed, their span decks, the masts — merged where they
stand —, the contact and span wires as the camera-facing ribbons'
attributes) and the **riverside** (piers on piles, pontoons with their
huts and gangways, groynes, the ferry's wake). The builders are the ones
the viewer ran per tile, moved DOM-free to `lib/city/rail-mesh.ts`,
`tram-mesh.ts`, `riverside-mesh.ts`, `wire-mesh.ts` and `mesh3.ts`
(three's triangulation handed in); `scripts/bake-lines.ts` writes one node
per part (`lib/city/line-nodes.ts`: `rail-*`, `tram-*`, `riverside-*`) on
every tile's fine ground, the lines with the build's levels (`lv`,
`scripts/line-sources.ts`). The viewer finds the nodes by name and gives
each its layer's look (`app/_components/line-looks.ts`) — a per-tile copy
of the layer's scene-wide material, since the tile renderer disposes every
material in a tile's content when it unloads (the copy keeps the nodes:
one build; `setGraph` lets the pipeline anchors keep it). The
`rail`, `railarea`, `platform`, `tram` and `riverside` side files are bake
inputs now (`lib/city/tile.ts` `baked`), never served; the stops and
landing stages the inquiry asks ride in the level's extras (`asked`), and
the stops' signs are still the furniture's instanced model, stood at
runtime.

**What stays at runtime.** The **bridges** (decks, the measured steel,
piers, arches): the inquiry asks a bridge by its meshes (`bridge-ask.ts`),
and the coarse level draws the same bridges from the same file — so the
`bridge` file is still fetched by both levels, and the bake reads it for
the decks the lines ride and the ballast leaves out.

**Measured** (Dresden, 2026-10-10; plan 074's findings): the spawn tile's
fine glTF 1.86 → 2.07 MB gzipped (+11 %), the site's fifteen 31.2 →
34.4 MB (+10 %; the Neustadt's yards +35 %); 19 → 14 requests per fine
level (75 files, 138 kB gzipped, no longer fetched over the site); the
fine level's `dressing:build` on the spawn tile 1.7–2.9 → 1.3–1.8 s
at the same load (headless, lite, a loaded box: directional), while the line materials'
programs now build in the fine content's compile instead of the
dressing's — see the plan. Float positions for the lines (16 bits over a
tile step by 3 cm; a street rail stands 2 cm over the road) cost +28 % on
the spawn tile and +24 % over the site and were left out: the lines are
quantised like the walls.

**Consequences.** The lines arrive and leave with the fine level, like the
walls; their parse and build left the main thread's dressing, their
compile joined the content's. They stand on the fine ground of every
tile, not on whatever terrain had loaded. A change to a line bake input
re-bakes that tile's fine level. Their joins are measured
(`scripts/ground-joins.ts` `JOIN_PARTS`: `rails`, `tram`, `riverside`),
with what they brought from the runtime: the polygon platforms' fascia
reaches the ground only at its outline's vertices (38 % of its feet miss
over the site), the line platforms are a ribbon at platform height (no
joins: they float by construction) — both left as they were drawn.

## References

`scripts/bake-tiles.ts` (`stairMesh`, `wallMesh`), `scripts/prepare-data.ts`
(`shapedTerrain`, `siteGround`, `fineChildren`), `lib/city/walls.ts`,
`lib/city/stairs.ts`, `app/_components/tile-stream.ts` (`meshNamed`),
`scripts/bake-lines.ts`, `scripts/line-sources.ts`, `lib/city/line-nodes.ts`,
`app/_components/line-looks.ts`, ADR 0014, ADR 0024, ADR 0028, ADR 0041,
[plan 074](../plans/074-architecture-deepening.md) part A.
