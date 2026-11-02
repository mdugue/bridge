# ADR 0041: Rails, trams and bridges — decks measured in the surface model, every line on a drivable profile solved by the build

- **Status:** accepted
- **Date:** 2026-06, rewritten 2026-10

## Context

The bare-earth DGM removes bridge decks by definition and rounds every
embankment and cutting. The official vector data has no bridge types and
LoD2 draws bridges as flat 1 m slabs. A track lifted onto whatever deck
lay under a point jumped between levels; a track laid on the DGM bumped
and dipped, and the terrain's triangles rose through the rails.

## Decision

1. **Bridges are the rail layer's alone.** The building mesh leaves out
   LoD2's traffic structures. A deck's height is the roadway DOM1 measures
   along its axis, held near the DGM ramp, grade-limited and never
   sagging; its depth comes from the fairway clearance.
2. **What stands above a deck is measured, typed by Wikidata.** Ribs are
   the highest surface above the deck where it stands high enough for long
   enough, kept only where the bridge's class (arch, truss, suspension,
   cable-stayed) stands above it. An arch rib becomes a steel arch; any
   other rib a simple open frame in pale matte steel — the silhouette, not
   the members. Wikidata's class overrides OSM's `bridge:structure`.
3. **Everything across a deck is measured from its centreline**, and a
   bridge line takes the footprint it runs on.
4. **A line's level is solved along the whole line**
   (`lib/city/levels.ts`): ground, a deck, a span over a gap the DGM
   leaves, or a cut through fill, chosen as the path the line can drive
   within its grade (rail 4 %, tram 8 %, a funicular 100 %: its track
   climbs its slope), with the line's context across tiles — a
   funicular's only across funiculars. A cut under a drawn deck opens a
   passage in the terrain.
5. **A line lies on a profile** within its grade and vertical-curve
   radius (rail 2 000 m, tram 500 m, funicular 100 m), fitted by the
   build step and published with the levels (`lv`, `lz`). The layers
   draw a baked line on its profile, never on the ground.
6. **The ground is laid under the bed:** the terrain bake shapes the DGM
   to the profile under each bed and grades the sides at 1 : 1.5; under a
   deck it only lowers. The ballast drapes on the beds.
7. **Platforms keep their edge distance from the tracks**, and a flat
   LoD2 top just over a track is lowered to its bed.
8. **A monorail is a beam, not a track:** the bake lays its underside on
   the upper hull of the ground plus a car's clearance along the whole
   way (straight over a hollow, bent over a crest), and the rail layer
   stands it on supports. It takes no level, no profile and no bed.

## Consequences

- The Blaues Wunder and the Waldschlößchenbrücke read as themselves with
  no per-bridge code; any bridge with steel above its deck gets its ribs.
- A new line layer takes its levels and profile the same way
  (`lineLevelsAt`); `scripts/line-levels.test.ts` holds the jumps to a
  budget.
- A standing train or a crown over a deck can still lift the measured deck
  (bounded); stay cables are too thin for a 1 m raster.

## Alternatives

- **Bridge types from OSM or the DLM:** OSM's tag is patchy and sometimes
  wrong; the DLM's codes are not captured.
- **Drawing the members as measured, in dark steel:** busier and darker
  than any building.
- **Lifting a line by its source's layer tag, or by a median filter:** the
  DLM has none, OSM's is relative and patchy; a median shifts every real
  ramp and cannot tell a gap from a fill.
- **Smoothing or draping at runtime:** piece ends disagree across seams
  and the ground still rises over the rails.
- **Lifting the rails by a margin:** they float wherever the ground is
  lower.
