# ADR 0041: A line's level is decided along the whole line; a cut under a deck opens a passage

- **Status:** accepted
- **Date:** 2026-10

## Context

Railway and tram lines are 2D polylines (the Basis-DLM's `ver03_l`, OSM's
tram ways); their height came from what lay under each sample on its own:
any rail deck whose outline held the point lifted it onto the deck
([ADR 0013](./0013-rail-layer-from-dissolved-areas-and-centreline-driven-decks.md)),
else the ground. A tram took OSM's `bridge` tag the same way. Measured
over the committed sites (2026-10-01), that drew:

- **Lower lines riding the decks they pass under.** Where one line crosses
  under another's bridge — the flyovers north of Dresden-Neustadt, a road
  over the tracks — the lower line jumped 7–8 m onto the deck for its
  width and down again: 16 of 109 rail–deck crossings in Dresden, 795
  samples in Hamburg.
- **Upper lines falling through the gap beside a bridge.** The DGM removes
  a bridge, and its gap is often longer than the deck's outline (a
  viaduct the DLM outlines for 60 m of its 190 m), or no outline exists:
  the track dropped into the street below for metres beside the deck.
- **Lines climbing the fill under a deck.** No laser sees under a deck; the
  DGM fills it from the embankment around, or (where a Land's DGM keeps
  its bridges, Hamburg) with the bridge itself. A track through such an
  underpass climbed over the fill, and the passage was closed.

A train climbs a few per cent at most, a tram a little more, so none of
these heights is one a line could drive. The DLM's rails carry no level;
the bakes cut each tile's lines at (or just past) its edge, so a tile sees
only a piece of each.

## Decision

The level of a line is the path through its candidate heights — the
ground and every deck the point lies on (or runs within 2 m of) — that
the line can drive: a Viterbi over the candidates with the climb beyond
its grade (rail 4 %, tram 8 %) as the cost, OSM's bridge tag a preference
between two levels as good (`lib/city/levels.ts`). What no candidate path
can drive is read off with a grade cone: a sample the line cannot get
down to from either side lies in a gap — a straight **span** between its
rims, pushed out over the gap's sloped sides (≤ 400 m); a sample it
cannot get up to from either side lies in a fill — a straight **cut**
(≤ 120 m). A jump that never comes back (a deck end above lower ground)
stays; the approaches meet it.

The build step solves every line of a site with its context
(`lib/city/line-levels.ts`, `scripts/line-levels.ts`): past each end of a
tile's piece, the line that runs on through that end in another piece,
any tile's, for 450 m. It bakes the result into the published rail and
tram files as each line's runs off the ground (`lv`: first and last
sample, mode, level at both ends); the layers draw the ground from the
loaded terrain, a deck from the deck table and a span or cut from the
run. Without `lv` a layer solves its own piece. Under a span the layer
draws a deck: a slab as wide as the tracks, piers every 26 m where it
clears the ground by 2.5 m.

The ballast yard under the lines follows the same ground: draped on it
(each triangle split where the ground strays from it by more than a
metre, down to 6 m) and left out on the rail decks, never stretched
across what lies between its outline's corners.

A cut that lies at least 30 % under a drawn deck (any kind) opens a
**passage** in the terrain bake (`lib/city/passages.ts`, `shapeDgm`): the
ground along the line, as wide as its tracks plus a 1.5 m shoulder,
lowered to the line's level — the clearance the bridge was built for. A
cut no deck covers is left closed: a tunnel, a station's cover, or a
road the bridge data lacks.

## Consequences

- Dresden: steps beyond a line's grade by more than a metre 230 → 18,
  Hamburg 330 → 62, Leipzig 41 → 17, Unna 20 → 0. `scripts/line-levels.test.ts`
  holds the reference site to a budget; `bun scripts/line-levels-cli.ts <site>`
  prints the count and the worst places.
- What remains: deck ends standing above lower ground for good (the
  approaches reach 1.2 m at a rail's 3 %), and deck tops the DOM1
  measurement put 1.5–2 m off the embankment they continue. Both are
  the decks' heights, not the lines'.
- Published rail and tram files differ from the committed ones by `lv`;
  the committed files stay as the bakes write them, and `lv` is never
  committed. The levels are solved on the native DGM, the layers draw on
  the TIN (±0.15 m): a span's rims can sit a few centimetres off.
- What closed the underpass at Dresden's Bahnhof Mitte was not the
  ground: the station's ballast yard spans the bridge, and draped at its
  outline's corners alone, it sloped from the embankment down to corners
  in the street under the deck — a wall across the passage, seen from the
  tram tracks themselves. The yard is now draped on the ground and left
  out on the rail decks (`addDrapedArea`). The DGM under a deck no line
  passes through stays as measured: there it rises along one edge of the
  outline (the abutment the DLM outline includes), and telling a fill from
  an abutment would need the road under the bridge, which no committed
  file carries.
- Tunnels proper are still the bakes' (ADR 0013's DLM tunnel cut, OSM's
  `tunnel` and `layer`); a cut under no deck hides the line in the
  ground, as a tunnel would.

## Alternatives

- **Lift by the source's level** (OSM `layer`, a DLM level): the DLM's
  rails have none, OSM's `layer` is relative to the crossing and patchy.
  Kept as a preference where it exists (the tram's `bridge` tag).
- **A median filter along the line**: removes short gaps and humps, but
  shifts every real ramp and deck end and cannot tell a gap (span it)
  from a fill (cut it).
- **Pairing a drop with the next rise**: misses gaps whose sides the DGM
  rounds into several steps; the grade cone sees the whole gap.
- **Joining the tiles' pieces end to end**: the trams are cut at the tile
  edge, but the DLM's rails overlap their neighbours' — context from
  whichever piece runs on through an end works for both.
- **Opening every fill under a deck from the DGM alone**: under Bahnhof
  Mitte the raised part of the outline is the abutment, not fill; without
  a line through it there is nothing to say which.
- **The ballast at its outline's corners, or as a grid**: the corners left
  sheets across every passage and pit; a uniform split of every triangle
  to 5 m made a million triangles a tile (the triangulation of a yard is
  long slivers), a grid cell mask a staircase at the yard's edge.

## References

- `lib/city/levels.ts`, `lib/city/line-levels.ts`, `lib/city/decks.ts`,
  `lib/city/passages.ts`; `scripts/line-levels.ts` (+ its test),
  `scripts/prepare-data.ts` (`publishLevels`, the passages in
  `shapedTerrain`), `scripts/bake-tiles.ts` (`shapeDgm`)
- `app/_components/rail-layer.ts` (`lineLevelsAt`, `addSpanDeck`,
  `addDrapedArea`),
  `app/_components/tram-layer.ts` (`trackRuns`)
- Ledger: *Railway & bridges* → *Line levels*, *Passages under decks*;
  🗃️ *A line lifted onto every deck under it*
