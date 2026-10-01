# Plan 050: Landmarks and what LoD2 leaves out — measured in DOM1, named by OSM and Wikidata

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
  34 / 6). The relief as slabs was replaced by a height field on
  2026-09-30 (Findings); re-bake `structures` on every site — a file
  baked before it carries slabs without a `grid`, which build nothing.

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
  LoD2 roof on ≥ 60 m² (and ≥ 2 % of its footprint), the excess as a
  height field per connected patch (≥ 6 m²): its outline and the 1 m grid
  of heights above that roof (`grid`: `x`, `y` = north-west corner, `res`,
  `cols`, `rows`, `z`, −1 outside), lightly smoothed (half the cell, half
  a Gaussian σ = 1 cell normalised over the patch), `kind: relief`, `of` =
  the object. *(First built as slabs in ≥ 2 m bands, at most 8 — see
  Findings.)*
- **Towers LoD2 draws**: a `tower`, `lighthouse` or `water_tower`
  (`BUILT_TOWERS`) whose mapped foot lies under a LoD2 roof is skipped —
  LoD2 draws it already. Masts and chimneys on roofs stay.
- A structure is written by the tile owning its anchor.

Build: `lib/city/structures.ts` lathes a column from its kind's ring
profile (16 sides), extrudes a building and builds a relief's height
field as a surface (`reliefMesh`: each corner the mean of the patch cells
around it, walls down to the roof along the patch's edge, no floor);
`appendGapStructures` (`scripts/bake-city-mesh.ts`) appends them to the
city mesh like the scan sheds, `source` = 2. A column is not a `Building` (the HUD's count);
chimneys, towers and lighthouses take the brick palette with the roof
tint = the wall's. A relief copies its host's row (tint, roof, flags,
root: demolish takes it along) and has no footprint.

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
(data sources, using the viewer, how it works; en + de), ADR 0038.

## Phases

0. Measurement (above). Done.
1. `structures` bake + tests (a chimney beside a hall; a landmark's roof
   as a height field, a spire to its tip; an ordinary roof's antennas make
   none; a church tower under its LoD2 roof makes no column) + the append.
   Built.
2. Looks from OSM + tests (colours, materials). Built.
3. Landmarks: fetch, bake, build, HUD + tests (the timed-out box in
   quarters; a landmark point beside its building). Built.
4. **Open**: finish baking every committed site (`osm-buildings`,
   `landmarks`, `structures`, in that order), then plates on a real GPU:
   Unna's chimney and the Lindenbrauerei; the Elbphilharmonie's relief
   from the vantage and from the Elbe; the Congress Center's glass at
   dusk and noon; a mapped red and a mapped green facade beside hashed
   neighbours; a Leipzig centre view (no crane); Unna's Stadtkirche spire
   and Meißen's cathedral towers (one tower each, not two).

## STOP conditions

- A column or block appears where nothing stands on the DOP: tighten the
  gap rule before adding a kind.
- A mapped colour reads louder than a DOP roof beside it: lower the
  saturation cap, not the clamp per colour.
- The glass sheen reads as a highlight or a reflection: halve it before
  tuning anything else; it must stay clay.
- A relief reads as a stack of plates from the ground: it did (the
  slabs), and the height field replaced them. If the height field reads
  as a lumpy blanket, smooth less or drop it — never an invented smooth
  roof.

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

- **Stacked slabs made a truncated spire a stepped pyramid** (Unna's
  Stadtkirche: LoD2 stops at 137 m, the surface model reaches ≈ 178 m) and
  the Elbphilharmonie's crests a flight of terraces — this plan's own
  STOP. The relief is now the measured height field on the 1 m grid,
  lightly smoothed, built as one surface: the spire rises to a point, the
  crests roll (2026-09-30).
- **The relief hovered at the ridge** (Unna's Evangelische Stadtkirche,
  2026-10-01): LoD2 draws the church as one gabled block (ridge
  ≈ 137 m, eaves ≈ 122 m); the west tower (walls ≈ 147 m, spire
  ≈ 187 m) is only in DOM1. The relief is measured above the highest
  roof, so its walls ended at the ridge's height and stood in the air
  beside the slope — and where the laser saw through the tower's sound
  openings to the ground, those cells tore "legs" down into it. Now the
  height field carries a `floor` per cell — the lowest LoD2 roof in the
  3 × 3 around it (roof cells only), sunk 0.3 m — and `reliefMesh` drops
  each edge wall to it; DOM cells more than 1 m below the LoD2 roof under
  them are voids, filled from the nearest measured cell before the excess
  is taken (`fill_voids`). Unna's tower now stands on the nave's slope,
  its walls down to ≈ 126 m (floor −10.1 m under the 136.3 m roof). Only
  Unna's `structures` is re-baked so far; a file without `floor` keeps
  the old walls.
- **Towers were drawn twice**: a church's or castle's tower is in LoD2,
  and the column search lathed a second one inside it — Meißen's
  cathedral towers (81 / 83 m), Grimma's churches, 13 of Munich's 14
  towers. A tower, lighthouse or water tower whose foot is under a LoD2
  roof is now skipped (`BUILT_TOWERS`).
- **Hamburg's ground was 0 m everywhere**: the committed DGM tiles were
  all zeros (an old mosaic bug), so every building — the Elbphilharmonie
  among them — floated 5–10 m above the ground. Re-fetched; the fetch now
  refuses a height mosaic whose 1–99 % spread is under 0.5 m, a pipeline
  test holds every committed DGM to ≥ 2 m, and every Hamburg bake ran
  again on the real terrain.
- **Underground rails at street level** (Munich's Marienplatz and
  Odeonsplatz looked broken): the Basis-DLM files U-Bahn and S-Bahn trunk
  lines as ordinary rail. A stretch within 2 m of a DLM tunnel (`BWF=1870`)
  for > 15 m is cut (Munich: 23 km U-Bahn, the 4.2 km trunk line, 0 m of
  mainline); a 6 m reach had taken the Hauptbahnhof's surface tracks.
  DLM trams are left to the OSM tram layer (Munich's rail layer ≈ 84 →
  22 km), OSM platforms and tram ways below ground are skipped, and a
  tram through a paved square gets the street bed (Munich's ballast
  ≈ 13 → 3 km, Dresden's 23.8 → 11.6 km). Leipzig's City-Tunnel left
  the Markt (815 m of rail there → 0). Not a landmark matter, but found
  while looking at them.
- **The laser scan for more sites**: Saxony's for Meißen, Grimma and
  Leipzig, NRW's "3D-Messdaten" for Unna (four 1 km LAZ merged per tile,
  intensities scaled 1/16) — sheds, extra crowns and hedges there as in
  Dresden (Meißen 475 small structures and 6 449 extra trees; Grimma 960
  and 7 964; Leipzig 1 303 and 27 893; Unna 1 596 and 2 385). The scan could later measure a column's width too (open
  item below).

## What was rejected

- **Additions from the surface model alone** — cranes (Leipzig's centre,
  50–95 m), pylons, crowns. OSM names, the DOM measures (🗃️ ledger).
- **Window grids, panes, textures** for glass and metal — the standing
  veto; a cool tint and a sheen only (🗃️ ledger).
- **Invented or imported geometry** — a stock spire, a hand-modelled
  landmark, a warehouse glTF: not repeatable, a licence each, off-style
  (ADR 0038).
- **An absolute sitelink threshold** — it left Unna with one landmark;
  the ranking is per tile.
- **A fixed count per tile** (the first 12) — on a dense tile it cut the
  second rank; replaced by a floor relative to the tile's top (2026-10-01).

## Open items

- **GPU plates not judged**: every look here (columns, mapped colours,
  the glass and metal response, the relief) was checked headless only.
- **Relief thresholds** (3 m above the highest roof, 60 m², 2 %, the
  smoothing: half the cell, σ = 1 cell) are tuned on synthetic tests and
  a handful of real cases (the Elbphilharmonie's crests, the
  Heinrich-Hertz-Turm's top, truncated spires, Unna's hospital — see
  Findings); the Congress Center's curved roof and a domed church are the
  next checks.
- **Wikidata coverage varies**: sitelinks favour the internationally
  known; an item without an OSM `wikidata=` tag and not a building
  matches only by point. A small town's list may name a museum over its
  church.
- **Column width** is a floor and a clamp, not a measurement; the laser
  point cloud (LSC) would resolve a shaft.
- ~~**Dense tiles**: at most 12 landmarks a tile, so on an old town's tile
  the most notable win — Dresden's Congress Center is not on the Altstadt
  tile's list (Frauenkirche, Zwinger, Semperoper, …) and so has neither
  the flag nor Wikidata's material; its OSM tags still colour it.~~
  **Resolved 2026-10-01** ([plan 051](./051-stand-ins-and-derived-looks.md),
  ADR 0039): a tile keeps every landmark with ≥ 8 % of its most notable
  one's sitelinks (`NOTABLE_SHARE`, never under 2), 40 a tile only as a
  safety cap — a floor relative to the tile, not a count; re-baked on
  every site. The roof relief stays with the tile's 12 most notable
  (`RELIEF_LANDMARKS`): further down the list the buildings are ordinary,
  and over a villa among old trees the crowns would read as its roof's
  form. The Congress Center itself is still not on the list: it is not in
  Wikidata's answer for the tile at all (the query keeps a box's 80 most
  linked items; the Altstadt tile has more), so the floor cannot reach
  it — its OSM tags colour it.
- **The Elbphilharmonie's brick base** (the Kaispeicher A, ≈ 37 m) is in
  no open source we read: LoD2 is one block, OSM maps the Elbphilharmonie
  as one outline without `building:part`, and Wikidata names steel, glass
  and concrete only — so the whole building wears one look. The data to
  add is an OSM `building:part` for the warehouse with `height` ≈ 37 and
  `building:material=brick`. Vertical zoning from OSM parts (a part's
  height band wearing its own material) is a possible later step, but
  thin today: 11 parts with both a height and a material in our Hamburg
  tiles, 1 in Munich.
- ~~**NRW's laser-scan intensity scale is unverified**~~ **Resolved
  2026-10-01** ([plan 051](./051-stand-ins-and-derived-looks.md)): every
  scan is normalised against its own ground's median intensity (NRW's
  factors 0.025–0.027), and NRW's classes are mapped by a table of their
  own — its crown tops are class 1, which the rasters had dropped.
