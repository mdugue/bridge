# ADR 0058: The Szenario-Assistent's what-ifs are model sums on open data, said so in every answer

- **Status:** accepted
- **Date:** 2026-10

## Context

The fourth step of the agentic concept (ADR 0055–0057) is a scenario
assistant inside *Frag die Stadt*: a visitor asks "what if" — how high
the Elbe stood here in 2002, what a planned tower would shade — and the
twin shows it and gives the numbers. The concept set three rules: the
model fills structured parameters, heavy sums run as server tools, and
every answer says it is no official result.

Two risks shape it. A flood map or a shadow study looks authoritative,
and the official ones (the city's flood hazard maps, a planning
office's shadow report) rest on surveys of dykes, walls, drainage and
terrain the twin does not have. And a model asked for numbers invents
them unless a tool gives them.

## Decision

**Two scenarios, each a pair of tools on one shared core**
(`lib/city/scenario.ts`, pure):

- **Hochwasser.** The river's water surface at a reading of its city
  gauge: the gauge zeros (WSV, PEGELONLINE) joined by straight lines
  along the chords between the gauges, raised by the reading — Pirna,
  Dresden and Meißen for Dresden's Elbe, with the crests of 1845, 1890,
  2002, 2006 and 2013 at the Dresden gauge from the city's Umweltatlas
  (`SITE_RIVERS`). `hochwasser_betroffen` (server) counts the
  Stadtwissen's buildings whose base lies below it, by depth band, with
  the deepest named ones and the landmarks; `zeige_hochwasser`
  (browser) lays the surface into the scene as one see-through grid.
- **Baukörper.** A planned box: centre, sides, height, turn.
  `schattenwurf` (server) works out the sun every full hour of a day
  (suncalc, Europe/Berlin), the shadow's outline on flat ground and the
  named or addressed neighbours whose centre lies in it;
  `plane_baukoerper` (browser) stands the box in the scene, where the
  real shadow map draws its shadow at the hour `setze_zeit` sets.

**The parameters are the tools' schemas.** The model passes numbers
within fixed ranges (a reading of 0–1 500 cm, sides of 2–300 m), never
free text the sum interprets; the server clamps them again.

**Every result carries its assumptions and `SCENARIO_NOTE`** ("model
sum of the city model, no official result"), and the system prompt
tells the model to say so and name the assumptions in every scenario
answer: no dykes, walls or barriers; every hollow below the level wet;
the flood's slope the gauge zeros'; flat ground and no neighbours'
shadows for the study.

**The scene keeps what it is shown only while the card is open.**
Closing *Frag die Stadt* takes the water and the box away; neither is
picked, walked into or stored.

## Consequences

- Only a site with a river in `SITE_RIVERS` offers floods (Dresden);
  the prompt says which events exist and that other cities have none.
  Adding one is a few gauges and crests with their sources, not a bake.
- The water surface is wrong where the river's slope departs from its
  gauge zeros', and the counts include hollows a dyke keeps dry (and
  miss the Weißeritz, which flooded Dresden's centre in 2002). The
  answer says so; the official flood maps stay the reference.
- The shadow study names only buildings the Stadtwissen names or
  addresses, by their centre; a long, low neighbour may be shaded and
  not named.
- Two objects can join the scene after the first frame: each compiles
  before it shows and redraws the shadow map (`scenario-layer.ts`).

## Alternatives

- **A flood from the DGM by flood fill from the river** (only connected
  ground wet): closer to reality, but it needs the whole site's DGM on
  the server or the browser's loaded tiles only, and still knows no
  dyke; the plain level, said so, is honest about what it is.
- **The official flood hazard maps as a layer**: the right reference,
  but a WMS of the city's, not open as vector data for every site, and
  a third-party request (ADR 0045); a link in the answer is enough.
- **Shadows counted on the GPU** (the scene's shadow map at each hour):
  exact for what is loaded, but the server cannot run it and the
  browser would render a day per question.

## References

- `lib/city/scenario.ts`, `lib/city/ask-scenario.ts`,
  `lib/city/ask-tools.ts`, `app/_components/scenario-layer.ts`,
  `app/_components/ask-scene-tools.ts`
- ADR 0055, 0056, 0057
