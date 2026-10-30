# ADR 0058: The Szenario-Assistent's what-ifs are model sums on open data, said so in every answer

- **Status:** accepted
- **Date:** 2026-10

## Context

Inside *Frag die Stadt* (ADR 0056) a visitor asks "what if": how high the
Elbe stood here in 2002, what a planned tower would shade. A flood map or
a shadow study looks authoritative, but the official ones rest on surveys
of dykes, walls and drainage the twin does not have; and a model asked
for numbers invents them unless a tool gives them.

## Decision

1. **Two scenarios, each a pair of tools on one pure core**
   (`lib/city/scenario.ts`):
   - **Hochwasser.** The river's surface at a reading of its city gauge:
     the gauge zeros (WSV, PEGELONLINE) joined along the river and raised
     by the reading, with the historic crests from the city's Umweltatlas
     (`SITE_RIVERS`). `hochwasser_betroffen` (server) counts the
     Stadtwissen's buildings whose base lies below it, by depth band;
     `zeige_hochwasser` (browser) lays the surface into the scene.
   - **Baukörper.** A planned box. `schattenwurf` (server) works out the
     sun every full hour of a day, the shadow on flat ground and the
     named neighbours inside it; `plane_baukoerper` (browser) stands the
     box in the scene, where the real shadow map draws its shadow.
2. **The parameters are the tools' schemas**: numbers within fixed
   ranges, clamped again on the server, never free text.
3. **Every result carries its assumptions and `SCENARIO_NOTE`** ("model
   sum of the city model, no official result"), and the prompt has the
   model say so: no dykes or walls, every hollow below the level wet,
   flat ground and no neighbours' shadows for the study.
4. **The scene keeps a scenario only while the card is open**; neither
   object is picked, walked into or stored.

## Consequences

- Only a site with a river in `SITE_RIVERS` offers floods (Dresden and
  Meißen); another is a few gauges and crests with their sources, kept
  out of `sites/` so no bake's cache key changes.
- The counts cover the buildings the Stadtwissen knows, and the result
  says so; the official flood maps stay the reference (the Weißeritz,
  which flooded Dresden's centre in 2002, is missing).
- A volume needs loaded ground under it. Both objects compile before they
  show and redraw the shadow map (`scenario-layer.ts`).
