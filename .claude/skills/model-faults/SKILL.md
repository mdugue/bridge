---
name: model-faults
description: "Modellfehler aus Straßenfotos, run weekly by a scheduled task (or by hand): put recent Panoramax street photos beside renders of the twin from the same pose, find where the twin is wrong (roof form, height, storeys, colour, a missing or invented object) and turn what recurs into proposals for the general heuristic — never a fix for one building. Reports on the model-faults issue."
---

# Modellfehler aus Straßenfotos

The twin's buildings, roofs, colours and storeys come from heuristics over
open data. A street photo shows where a heuristic goes wrong. This skill
compares a handful of photos a week with the twin and looks for the
**pattern** behind what differs.

**The rule (the maintainer's):** correct the general heuristic, never the
single building. A proposal names the bake step or runtime term, the rule
that misfires, what in the data would tell the case apart, and how many
places it would touch — not "make Hauptstraße 5 red".

## Make the pairs

```bash
bun scripts/street-photos.ts dresden --n 8      # the week's photos + snapshots
NEXT_PUBLIC_POC_DEBUG=1 bunx next build && bunx next start -p 3000 &
# a real GPU (headed):
SHOTS=1 bunx playwright test e2e/snapshot-shot.spec.ts --headed -g "foto-dresden"
# the cloud container (SwiftShader, small, the whole site in lite):
SHOTS=1 SHOTS_SMALL=1 SHOTS_QUERY="scene=lite&block=1" \
  bunx playwright test e2e/snapshot-shot.spec.ts --workers=1 -g "foto-dresden"
```

The first walks the site's 400 m cells in an order the ISO week draws
(`--seed` to repeat one) and takes the newest usable Panoramax photo of
each until it has N: flat, aimed, placed within 6 m. It writes a
snapshot at each photo's pose to `shots/foto-<site>-<n>.json` and the
photo to `street-photos/<site>/` with `pairs.json` (author, licence,
link). The second renders the snapshots to `shots/foto-<site>-<n>.png`.
SwiftShader is good for geometry and colour, wrong for light and shadow
— never judge shading from it; a lite render is coarse (half the pixel
ratio), enough for roofs, heights and storeys.

## Compare

Read each photo and its render side by side. The pose is approximate:
the photo's GPS can be 5 m off, its heading a few degrees, its pitch is
unknown (the render looks level), its lens assumed where the photo does
not say (`lensAssumed`). So first find the same building in both; a
pair where you cannot is skipped, not a finding.

For each building both show, note what differs, by category:

- **Dachform** (gable vs hip vs flat, the ridge direction), **Dachfarbe**;
- **Höhe / Geschosse** (count the storeys in the photo);
- **Fassade**: colour (plaster vs brick, ADR: OSM `building:colour`,
  the neighbourhood's `context`), material, the window rhythm (the
  windows' columns — only from photos, ADR 0010);
- **Fehlt / zu viel**: a building, a tree, a wall, a kiosk the twin lacks
  or invents; **Lage** (an object metres off).

Ignore what the twin draws on purpose (stylised clay, no glass, no
signage, no people or cars, the pastel light) and what the photo's season
or time explains.

## Turn it into proposals

1. Group the week's notes by category and find the rule behind each
   group: which step makes that value (`roofs.py`, `roof_colour.py`,
   `osm_buildings.py`, `windows.ts`, `building-tint.ts`,
   `small-buildings.py`, the canopy …; the knowledge base's
   `docs/transformations.md` names them) and why it misfires there.
2. Check the rule across the site before proposing: how many buildings
   share the trait (the Stadtwissen, `bun scripts/stadtwissen.ts`, or the
   bake's own outputs)? A proposal states that count.
3. A proposal that is clear, small and testable may become a **draft PR**
   on its own branch, with a unit test, the bake re-run on every tile
   (the maintainer's rule: never dodge a re-bake) and snapshots
   (`pr-snapshots`); anything larger is an issue comment for the
   maintainer.

## Report

One comment in German on the open issue labelled **`model-faults`** in
`mdugue/bridge` (create it, „Modellfehler aus Straßenfotos“, only if none
is open): the week's pairs (Panoramax link, the snapshot JSON inline so
the maintainer can paste it into the preview, the photographer and
„CC BY-SA 4.0“), the differences by category, and the proposals with
their counts. The photos and renders stay out of the repository and the
issue (the licence asks for attribution and share-alike; a link is
enough).

## Never

- fix a single building (a patch, an override list, a special case by
  id);
- use Google Street View or Maps; Mapillary only where the maintainer
  lifts the pause on its poses (2026-10);
- commit photos or renders.
