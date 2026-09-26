# ADR 0032: Bridges are measured in the surface model, typed by Wikidata

- **Status:** accepted
- **Date:** 2026-09

## Context

A bridge was a deck slab with parapets over one of two undersides — masonry
arches or box piers every 26 m — chosen by OSM's `bridge:structure`
(ADR 0013). Nothing stood above the deck, so the bridges that make
Dresden's river recognisable, the Blaues Wunder (a steel truss sagging
between two pylons) and the Waldschlößchenbrücke (a flat steel arch), could
only ever be slabs. Looking for better sources turned up:

- **The official vector data has no bridge types.** In the current
  Basis-DLM every Dresden bridge is `BWF=1800` ("bridge"): the codes for
  arch, truss and suspension bridges (1802–1804) and for river piers (1850)
  exist in the AdV catalogue but are not captured statewide, and the
  clearance and width attributes are empty. Saxony's open ALKIS (NAS, per
  municipality) contains no structures at all.
- **LoD2 carries bridges, but only as flat 1 m slabs** (`Building`,
  function `53001_1800`). The building bake drew them as clay houses, 1–3 m
  off the rail layer's decks: every Elbe bridge had a second deck.
- **DOM1 sees the superstructure.** A longitudinal section of the highest
  surface over the deck shows the Blaues Wunder's two towers ~140 m apart,
  22–26 m above the roadway, and the truss between them sagging to ~2 m;
  over the Waldschlößchenbrücke the arch's crown rises ~10–15 m above the
  road. It also shows the roadway itself — the Waldschlößchenbrücke's deck
  is 3 m higher than the abutment ramp the bake used.
- **OSM's inland-waterway marks** (`seamark:type=bridge`) give each Elbe
  bridge's navigation clearance and where the fairway crosses;
  **Wikidata** (CC0) gives the structural class (Bogen-, Hänge-,
  Gerberträgerbrücke …) and sometimes the main span. OSM's own
  `bridge:structure` is patchy and sometimes wrong (the
  Waldschlößchenbrücke is tagged `truss`).
- Nothing airborne sees *under* a wide deck: a steel arch's springing and
  the piers are hidden.

## Decision

Measure what the surface model can see, take the type from Wikidata, and
model only what no source shows:

1. **The building mesh leaves out ALKIS traffic structures** (`53001_*`,
   `withoutTrafficStructures` in `lib/city/city-mesh.ts`). Bridges are the
   rail layer's alone.
2. **The deck height is the roadway DOM1 measures** along the deck's axis
   (the lower third of the cross-section, smoothed), held within −6/+4 m of
   the DGM abutment ramp, which stays the fallback.
3. **The superstructure is baked as ribs**: per half of the cross-section,
   the highest surface above the deck, opened and closed along the axis to
   drop lamps and fill raster gaps, kept where it stands ≥ 3 m for ≥ 25 m
   (`pipeline/bake/bridge.py`). At runtime a rib on an arch bridge that fits
   a parabola becomes a steel arch continued below the deck to where it
   meets the ground; any other rib is drawn as an **open frame** on its
   deck edge — the measured rise smoothed as one chord, a post every 10 m,
   no diagonals — with a tower on a river pier and a portal where it
   peaks (`app/_components/rail-layer.ts`,
   `lib/city/bridge.ts`). The measurement gives the silhouette, not the
   members: the first cut drew chord, posts and diagonals as measured, in
   a dark steel, and the bridges came out busier and darker than any
   building. They are abstracted as the buildings are — the frame, pale
   matte steel, the deck tops in their land-cover colours — and two ribs
   are placed on the deck's two edges rather than at their measured
   offsets, which follow a DLM centreline that can sit metres off the
   bridge.
4. **The deck's depth comes from the fairway clearance** over the DGM's
   water surface; beam-bridge piers leave the fairway clear.
5. **Wikidata's class overrides OSM's `bridge:structure`** when a deck
   matches an item (an OSM `wikidata` tag on the bridge or its fairway
   mark, else the DLM name). The ingest fetches Wikidata into the raw
   folder; the bake reads the file, never the network (ADR 0025).
6. **Heights come from a mosaic of the tile and its neighbours**, and only
   the tile owning a deck's centre draws it, so a bridge across a seam is
   one bridge.
7. **Ribs are kept only where the class stands above the deck** (arch,
   truss, suspension, cantilever, cable-stayed): over a beam bridge the
   filters still pass catenary, trains and trees. On an arch bridge a rib
   that follows no arch is not drawn either.
8. **A bridge line takes the footprint it runs on**, not the nearest one:
   the Marienbrücke's road line, 16 m beside the rail bridge's footprint,
   once took it, and the road was laid on the tracks. The measured deck is
   grade-limited from midspan outwards (8 %, rail 4 %), so a deck the scan
   loses near an abutment ramps down instead of dropping.
9. **No canopy tree within 10 m of a bridge**: on a park bank a bridge's
   steel is as tall in the nDOM as a crown (the Blaues Wunder's pylons had
   become two trees).

## Consequences

- The Blaues Wunder and the Waldschlößchenbrücke read as themselves, from
  measurements, with no per-bridge code or hand-made model. Any bridge with
  steel above its deck gets its ribs the same way.
- The arch below the deck, the piers and the deck depth are modelled; the
  clearance's reference level is not NHN-anchored in OSM, so the DGM's water
  surface at scan time stands in (a metre or two of slack, clamped).
- A tree canopy or a standing train over a deck can still lift the measured
  deck (bounded: −6/+4 m); ribs are gated by class and by the arch fit. The
  committed ribs were checked (the Blaues Wunder, the Waldschlößchen- and
  Molenbrücke, three bridges in the Friedrichstadt, the Marienbrücke's
  rejected at runtime); a new site should be.
- Stay cables are too thin for a 1 m raster; the Molenbrücke's fan is
  modelled from its measured pylon. The laser point cloud (LSC, already
  ingested for the low vegetation) would resolve members and cables.
- Bridge GeoJSON grows by the 2 m profiles (a few kB per tile). Bridges are
  still built in the browser from it, not baked into the terrain glTF like
  walls and stairs (ADR 0029): rails are lifted onto their decks at runtime.
