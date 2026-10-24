# ADR 0052: A line lies on a profile within its grade and vertical curve; the ground is laid under its bed

- **Status:** accepted
- **Date:** 2026-10

## Context

[ADR 0041](./0041-line-levels-along-the-whole-line.md) decides on what a
rail or tram line runs — the ground, a deck, a span, a cut — along the
whole line. On the ground it still took the DGM sample by sample (every
4 m for a rail, 2 m for a tram), and three things drew the tracks into
the surface (measured 2026-10-24 over the seven committed sites, the
drawn meshes against the fine TIN and the ballast mesh):

- **The ballast covered its own tracks.** The yard's ballast (the beds of
  `rail_osm.beds`, dissolved) was draped on the ground with triangles up
  to 48 m long that may stray 1 m from it: wherever its plane lay above
  the track, the rails and sleepers vanished under it — in Dresden 1.8 %
  of the rail heads and 14 % of the sleepers' area, in Munich 4.3 % and
  16.5 %, worst in the yards (the Hauptbahnhof's west throat).
- **The tracks followed every bump of the DGM.** The 1 m DGM rounds a
  platform's edge, a kerb, an abutment into a ramp; the track beside it
  climbed it and came down again — steps of half a metre the grade cone
  of ADR 0041 (a metre beyond the grade) let through, kinks no track has.
- **The TIN rose over the rails between their samples.** A street's
  grooved rail stands 2 cm out of the road, the fine level's TIN may lie
  15 cm off the DGM: 2.6 % of Dresden's tram rails lay in the road, in
  dashes.

A track cannot do any of that. Its profile (*Gradiente*) is straight
grades joined by vertical curves, and the ground under it is the bed its
builders laid for it: the *Planum*, with an embankment or a cutting
beside it.

## Decision

**The profile.** Each line's height is a profile fitted to its levels
under the two limits a track's geometry obeys (`lib/city/line-profile.ts`):
the grade stays within the line's steepest (`LEVEL_GRADE`: rail 4 %, tram
8 %) and a change of grade is rounded by a vertical curve of at least
`PROFILE_RADIUS` — 2 000 m for the railway (EBO/Ril 800.0110:
r_a ≥ 0.4·v², 2 000 m at the least), 500 m for a tram (the BOStrab
alignment rules' sag minimum). Within them it is the least-squares fit to
the levels, robust (Huber, 0.1 m: a DGM bump a few metres long pulls it
by centimetres), solved as a QP with ADMM over the grade and curvature
rows (a pentadiagonal system per iteration). On a deck the profile is the
deck's top (weighted ×10⁴: the deck is measured, the approaches meet it).
The build step fits it per piece with 150 m of context either side
(`solvePieces`, `PROFILE_CONTEXT_M`) and publishes it with the levels as
`lz` (centimetres, the first absolute, then steps). The layers draw a
baked line on its profile, never on the ground (`lineLevelsAt`).

**Crossings.** A line on the ground that crosses another a storey below
it — its profile ≥ 3 m over the other's within 5 m, at ≥ 20° — is a
*span* there (`spansOver`, `CROSS_CLEAR_M`): the DGM kept the structure
it crosses on (Hamburg's keeps its bridges), and the layer draws the span
deck. Two lines side by side on terraces a storey apart run along each
other and stay on the ground.

**The bed.** The terrain bake lays the ground under every line's bed at
its profile (`lib/city/track-beds.ts`, `shapeDgm`): under the bed — the
ballast's width (`rail_osm.py` BED_ONE + BED_MORE per track), a tram's
track — the ground is the profile less `drop` (0.1 m under ballast, 3 cm
under a track in the paving); beside it the ground the bed leaves above
or below is graded at 1 : 1.5, the slope an embankment and a cutting
stand at, for at most 4 m (further out a wall or a quay stays). Under two
beds the nearest wins — unless they lie more than a metre apart in
height: then the lower, the line that passes under the other's
structure; beside them every bed's slope bounds the ground.
Under a deck the ground is only ever lowered — a road under a bridge is
never filled — and a line on a deck or a span lays a bed that only lowers
(Hamburg's DGM keeps its bridges: it held a footbridge's deck over the
rails). A cut has no bed: it is a passage's (ADR 0041) or a tunnel's. The
fine TIN is held to 3 cm under a bed (`BED_TIN_ERROR`; Delatin's error
scaled per grid point, `ScaledDelatin` in `scripts/bake-terrain-tin.ts`,
delatin pinned exactly), 0.15 m elsewhere.

**The ballast.** The yard's ballast is draped on the beds' surface — the
nearest bed's profile within the bed and half the gap the bake closes
between two beds (`BedIndex`) — to 2 cm, down to 1 m triangles where two
beds meet, and only off every bed on the ground as before. Rails (0.17 m),
sleepers (0.05 m) and ballast (0.03 m) stand on the profile; the ground
lies 0.1 m under it and the ballast's 0.45 m fascia hides the step.

## Consequences

- Measured on the seven sites (drawn meshes against the fine TIN and the
  ballast, before → after): Dresden's sleepers under the ballast 14.3 % →
  0.06 %, its rail heads 1.84 % → 0.01 %, its street tram rails in the
  road (> 2 cm) 2.6 % → 0.2 %; Munich's sleepers under the ballast
  16.5 % → 0.05 %; Leipzig, Meißen, Unna and Grimma alike. The numbers
  per site are in the PR that made the change; `scripts/line-levels.test.ts`
  holds the reference site's steps to its budget.
- The line levels take twice as long (Dresden 12 → 23 s; cached per
  site). The fine ground re-bakes when a line's file or the profile
  changes (its cache key holds the beds reaching into the tile).
- A baked line no longer rides the approach ramps (`decksAt` "ramps"): its
  profile climbs to the deck itself, and the bed fills the approach.
- What a profile cannot fit stays visible as earthwork: a line whose
  levels misjudge a stretch (a cut ADR 0041 did not see) is laid through
  it at its grade, the ground graded beside it.
- Unbaked lines (a layer solving its own piece, no `lz`) keep the old
  rule: the ground sample by sample, the ballast on the ground.

## Alternatives

- **Smoothing at runtime** (per piece, a median or a spline): the piece
  ends disagree across seams, and the TIN still rises over the smoothed
  rails — the ground has to be laid under them.
- **Draping the rails on the TIN exactly** (a sample at every triangle
  edge): no rail under the ground, but every DGM bump drawn as a kink.
- **Draping the ballast finer on the ground alone**: a uniform 5 m split
  made a million triangles a tile (ADR 0041), and the ballast on a bumpy
  ground still covers a smooth track.
- **Lifting the rails by a margin**: they float over the ground wherever
  it is lower, and the margin needed (the TIN's 0.15 m and the DGM's
  bumps) is larger than the track's own height.
- **A per-point grade and median filter** (the old cone with a lower
  threshold): it cannot tell a ramp the line drives from one it does not,
  and it bends no curve.

## References

- `lib/city/line-profile.ts`, `lib/city/track-beds.ts`,
  `lib/city/line-levels.ts` (`solvePieces`), `scripts/line-levels.ts`
  (`siteBeds`, `underDecks`), `scripts/bake-tiles.ts` (`shapeDgm`,
  `fineTin`), `scripts/bake-terrain-tin.ts` (`ScaledDelatin`),
  `scripts/prepare-data.ts` (`publishLevels`, `bedsIn`)
- `app/_components/rail-layer.ts` (`lineLevelsAt`, `ballastBeds`,
  `buildBallast`), `app/_components/tram-layer.ts`
- Ledger: *Railway & bridges* → *Line profiles and beds*
