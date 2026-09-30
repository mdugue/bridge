# Plan 038: Landmarks and what LoD2 leaves out — measured in DOM1, named by OSM and Wikidata

> **Executor instructions**: Read fully first. The code is built; what is
> open is the look on a real GPU (`bun run shots --headed`, full profile)
> and baking the landmarks on every committed site. Update the status row
> in `docs/plans/README.md` when a phase lands.
>
> **Builds on** plan 034 (the scan's small structures appended to the
> city mesh: the same append path, `source` column and footprint rules),
> plan 027 (OSM facts per LoD2 object, `osm_buildings.py`, the `flags`
> column) and ADR 0033 (bridges measured in DOM1, typed by Wikidata; its
> fetch-time Wikidata cache is the pattern here).
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/structures.py pipeline/bake/landmarks.py pipeline/bake/osm_buildings.py scripts/bake-city-mesh.ts`

## Status

- **Priority**: P2 (a city's silhouette and its names; every site)
- **Effort**: M (two bakes S–M, the look S, the HUD S)
- **Risk**: MED — false positives from the surface model (cranes,
  pylons, crowns); a loud colour or sheen breaking the clay
- **Planned at**: 2026-09-28
- **Status**: BUILT (2026-09-28), look unverified on a real GPU. Baked
  on the seven committed sites in step order (`fetch` for the Wikidata
  landmarks, then `osm-buildings`, `landmarks`, `structures`): 386
  columns, 920 missing buildings, 508 relief slabs on 74 landmark
  objects, 310 landmarks (Dresden 180 / 370 / 196 / 142; Unna 5 / 32 /
  34 / 6).

## Why this matters

The maintainer asked (in German) for four things: search the gaps between
the surface model and LoD2; give buildings an appearance from their
attributes, in the app's style; derive geometry where it can be derived;
a landmark list per city — all of it repeatable for every future city.
Three buildings make the case:

- **Unna, the Lindenbrauerei chimney** — the "Fibonacci-Reihe" (Mario
  Merz's neon numbers on a 48 m brewery chimney) is the town's
  silhouette and is not in LoD2. OSM maps it as `man_made=chimney`; DOM1
  sees 48 m.
- **Hamburg, the Elbphilharmonie** — LoD2 draws a flat block at 96.3 m.
  DOM1 reaches ≈ 109 m over the wave roof. Wikidata knows it with 41
  sitelinks, and OSM tags its outline with the item.
- **Dresden, the Congress Center** — a glass facade under a curved roof;
  LoD2 has flat parts 13–27 m high and, like every LoD2 object, no
  material or colour. OSM's `building:material` and `building:colour`
  are where that lives.

LoD2 has neither slim structures nor materials nor colours, and no dataset
says which buildings a city is known by.

## Design

### Phase 0 — measurement (done)

`gap = DOM − max(DGM, LoD2 roof)` over the tile and a 60 m margin at 1 m
(the neighbours' DGM, LoD2 and DOM mosaicked, `skyview.Roofs` burning the
roofs). Findings:

- Tall slim gaps are common and **mostly not buildings**: tree crowns,
  power pylons and, on the flight day, cranes. Leipzig's centre: dozens
  of 50–95 m spikes with no mapped structure; Hamburg: 90–98 m spikes
  beside a building finished in 2023.
- Where OSM maps a `man_made` chimney, tower or mast, the gap is there
  and its height is right; its width is not — a 1 m surface model sees a
  slim shaft too thin (the Lindenbrauerei's measured 1.7 m).
- On landmarks, the excess over the LoD2 roof is the roof's real form
  (the Elbphilharmonie); on ordinary roofs it is antennas, dormers, lift
  housings and trees.

**Gate**: add nothing from the surface model alone. Passed as a design
rule, not a threshold.

### Phase 1 — structures beyond LoD2 (`structures` step)

`pipeline/bake/structures.py` → `data/<site>/dlm/structures_<tile>.geojson`
(ODbL; empty for a site without DOM).

- **Columns**: OSM `man_made=chimney/tower/mast/communications_tower/
  water_tower/lighthouse`, point or outline. Kept when the gap within
  6 m (2 m of an outline) reaches 5 m and the structure 8 m. Axis at the
  gap's peak; foot at the lowest ground; height from the DOM, or OSM's
  `height` when the DOM undershoots it by > 25 % (a lattice mast);
  radius from the outline, OSM `diameter`, else the gap blob low down;
  a chimney at least h/24; clamped per kind (chimney 0.8–6 m, mast
  0.3–2.5 m, …) with a per-kind taper.
- **Missing buildings**: an OSM building outline ≥ 40 m² (no roof,
  carport, construction site, ruin, underground or negative layer), LoD2
  under < 20 % of it, ≥ 60 % of its cells ≥ 2.5 m above ground; a flat
  roof at the 60th percentile of the measured height.
- **Landmark roof relief** (after phase 3's `landmarks`): per LoD2 object
  of a landmark, where the DOM stands ≥ 3 m above that object's highest
  LoD2 roof on ≥ 60 m² (and ≥ 2 % of its footprint), the excess as slabs in
  ≥ 2 m bands (at most 8; parts ≥ 6 m²), `kind: relief`, `of` = the
  object.
- A structure is written by the tile owning its anchor.

Build: `lib/city/structures.ts` lathes a column from its kind's ring
profile (16 sides) and extrudes a building or slab; `appendGapStructures`
(`scripts/bake-city-mesh.ts`) appends them to the city mesh like the scan
sheds, `source` = 2. A column is not a `Building` (the HUD's count);
chimneys, towers and lighthouses take the brick palette with the roof
tint = the wall's. A relief slab copies its host's row (tint, roof,
flags, root: demolish takes it along) and has no footprint.

### Phase 2 — surfaces from attributes (`osm-buildings`, extended)

`building:material` / `building:facade:material` / `facade:material`
(normalised to glass, metal, brick, stone, concrete, wood, plaster),
`building:colour`, `roof:colour` (CSS name or hex → `#rrggbb`) on building
and `building:part` outlines covering ≥ 50 % of an object → `material`,
`colour`, `roof_colour` in `osmbuild_<tile>.json`; parts after buildings,
so a part's own tags win; a part inherits its root's (`inheritedLook`).

Build (`lib/city/building-tint.ts`): a mapped colour keeps its hue, its
saturation capped at 0.45 and its lightness held in [0.45, 0.9] (walls)
or [0.3, 0.8] (roofs) — a red wall becomes a clay terracotta. Walls: OSM
colour > material family > use family. Roofs: DOP > OSM `roof:colour` >
palette. Glass and metal set flags 4 and 8 (`lib/city/city-mesh.ts`);
the clay shader (`osmColour`, `clayGlow`) turns them a little cooler and smoother,
glass with a Fresnel sky sheen on the rim slider, dimmed at night.
**Veto**: no window grid, no panes, no texture.

### Phase 3 — landmarks (`landmarks` step + fetch)

- Fetch (`landmarks.fetch_wikidata`, called by `bun run fetch` for every
  provider): SPARQL per tile, `wikibase:box`, instance of a subclass of
  Q811979 (architectural structure), ≥ 2 sitelinks, top 80 by sitelinks;
  label (de), position, height P2048, materials P186, building = subclass
  of Q41176. A box that times out (504) is re-asked in quarters, two
  levels deep. → `data/_raw/<provider>/wikidata/landmarks_<tile>.json`
  (CC0).
- Bake (`pipeline/bake/landmarks.py`): an item's LoD2 objects are those
  an OSM outline tagged `wikidata=<Q>` covers by half, else (a building)
  the LoD2 building under its point, root and parts. Items that match
  nothing drawn (districts, streets, harbours) are dropped; ≤ 12 per
  tile, most sitelinks first; Wikidata's material read as a wall
  material. → `data/<site>/dlm/landmarks_<tile>.json`.
- Build: `withLandmarks` (`prepare-data.ts`) sets `OBJECT_FLAG_LANDMARK`
  (16) and fills the material where OSM names none; `siteLandmarks` puts
  the site's twelve most notable into the tileset's `extras.landmarks`.
- HUD: the *Erkunden* tab lists them as *Wahrzeichen* chips under the
  viewpoints; a click glides to `landmarkVantage` (via `overlook`: from
  the south-south-west, altitude clamp(h + 50, 60, 300) m, pitch
  −22°, fov 55°).

### Docs

Ledger (the five entries and four 🗃️ rows), `data-flow.md`,
`rendering.md` codebook, `data-pipeline.md`, `portability.md`, the guide
(data sources, using the viewer, how it works; en + de), ADR 0036.

## Phases

0. Measurement (above). Done.
1. `structures` bake + tests (a chimney beside a hall; a landmark's roof
   as slabs; an ordinary roof's antennas make none) + the append. Built.
2. Looks from OSM + tests (colours, materials). Built.
3. Landmarks: fetch, bake, build, HUD + tests (the timed-out box in
   quarters; a landmark point beside its building). Built.
4. **Open**: finish baking every committed site (`osm-buildings`,
   `landmarks`, `structures`, in that order), then plates on a real GPU:
   Unna's chimney and the Lindenbrauerei; the Elbphilharmonie's relief
   from the vantage and from the Elbe; the Congress Center's glass at
   dusk and noon; a mapped red and a mapped green facade beside hashed
   neighbours; a Leipzig centre view (no crane).

## STOP conditions

- A column or block appears where nothing stands on the DOP: tighten the
  gap rule before adding a kind.
- A mapped colour reads louder than a DOP roof beside it: lower the
  saturation cap, not the clamp per colour.
- The glass sheen reads as a highlight or a reflection: halve it before
  tuning anything else; it must stay clay.
- A relief reads as a stack of plates from the ground: coarser bands or
  none — never an invented smooth roof.

## Findings (the bake on the seven sites)

- **Relief measured cell by cell against the LoD2 roof was wrong**: a
  courtyard's trees over its low roof and every roof step a metre off
  counted (the Museum für Kunst und Gewerbe in Hamburg got 99 slabs).
  Measured against the object's highest LoD2 roof (its 98th percentile)
  they stay below; the 15 % share gate then missed the Elbphilharmonie,
  whose LoD2 roof already slopes to 97 m and whose crests reach 12 m
  above it on 173 m² (3 % of the footprint) — so ≥ 60 m² and ≥ 2 %.
- **What the relief now finds is what LoD2 cuts short**: the
  Heinrich-Hertz-Turm's top (to 271 m), the spires of Leipzig's
  Peterskirche and Neues Rathaus, the City-Hochhaus's mast, the
  Elbphilharmonie's crests, and Unna's Katharinen-Hospital, which LoD2
  carries at 9.3 m on a 2017 floor plan while the surface model measures
  16–22 m more over 2 100 m².
- **Wikidata's point is often beside the building** (the Lindenbrauerei
  and the Zentrum für Internationale Lichtkunst in it: a courtyard):
  matched to the nearest LoD2 building within 25 m.
- **Place outlines carry `wikidata` too**: HafenCity and Wachwitz were
  matched through them to a quarter of LoD2 objects; only outlines of
  buildings, building parts and `man_made` structures count now.
- **A dense box times out** at the endpoint (504 on a Hamburg and a
  München tile): it is asked again in quarters.
- **The chimney floor**: the Lindenbrauerei's 48 m shaft measured 1.7 m
  across in the 1 m surface model; with r ≥ h/24 it is 4 m at the foot.

## What was rejected

- **Additions from the surface model alone** — cranes (Leipzig's centre,
  50–95 m), pylons, crowns. OSM names, the DOM measures (🗃️ ledger).
- **Window grids, panes, textures** for glass and metal — the standing
  veto; a cool tint and a sheen only (🗃️ ledger).
- **Invented or imported geometry** — a stock spire, a hand-modelled
  landmark, a warehouse glTF: not repeatable, a licence each, off-style
  (ADR 0036).
- **An absolute sitelink threshold** — it left Unna with one landmark;
  the ranking is per tile.

## Open items

- **GPU plates not judged**: every look here (columns, mapped colours,
  the glass and metal response, the relief) was checked headless only.
- **Relief thresholds** (3 m above the highest roof, 60 m², 2 %, 2 m
  bands, ≤ 8 slabs) are tuned on synthetic tests and a handful of real
  cases (the Elbphilharmonie's crests, the Heinrich-Hertz-Turm's top,
  truncated spires, Unna's hospital — see Findings); the Congress Center's
  curved roof and a domed church are the next checks.
- **Wikidata coverage varies**: sitelinks favour the internationally
  known; an item without an OSM `wikidata=` tag and not a building
  matches only by point. A small town's list may name a museum over its
  church.
- **Column width** is a floor and a clamp, not a measurement; the laser
  point cloud (LSC) would resolve a shaft.
- **Dense tiles**: at most 12 landmarks a tile, so on an old town's tile
  the most notable win — Dresden's Congress Center is not on the Altstadt
  tile's list (Frauenkirche, Zwinger, Semperoper, …) and so has neither
  the flag nor Wikidata's material; its OSM tags still colour it.
