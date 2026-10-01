# ADR 0038: Geometry beyond LoD2 only where a measurement and a name agree; attributes tint within the clay

- **Status:** accepted
- **Date:** 2026-09

## Context

LoD2 is the building model: footprints from the cadastre, roofs fitted to
a laser scan as the nearest standard type. It leaves out what is not a
building in the cadastre's sense and flattens what no standard roof fits:

- **Slim structures** are missing. Unna's Lindenbrauerei chimney (the
  "Fibonacci-Reihe", 48 m, the town's best-known silhouette) is not in
  LoD2; neither are most masts, towers and water towers.
- **The newest buildings** are missing: LoD2 is a year or more behind the
  surface model and OSM.
- **Unusual roofs** are simplified. The Elbphilharmonie is a flat 96.3 m
  block in LoD2; DOM1 reaches ≈ 109 m over its wave roof. The Congress
  Center Dresden's curved roof over a glass facade is a set of flat parts
  13–27 m high.
- **What a building is made of and what colour it is** is not in LoD2 at
  all. OSM carries `building:material`, `building:colour` and
  `roof:colour` on some buildings; Wikidata carries a material (P186) on
  notable ones.
- **Which buildings are the city's landmarks** is not in any official
  dataset. Wikidata knows it for every city, with the number of Wikipedia
  articles (sitelinks) as a measure of notability.

The surface model (DOM1) sees everything that stands, so `DOM − max(DGM,
LoD2 roof)` shows every gap. But the gap is mostly not buildings: tree
crowns, power pylons, and the construction cranes that stood on the
flight day — Leipzig's centre showed dozens of 50–95 m spikes with no
mapped structure, Hamburg 90–98 m ones beside a 2023 building.

The viewer's look is one opaque clay with hashed pastel tints
([ADR 0010](./0010-opaque-clay-buildings-only.md)); a procedural window
grid was tried and vetoed (ledger 🗃️). Every step must run unchanged for
the next city ([ADR 0037](./0037-sites-providers-and-per-site-data.md)).

## Decision

1. **Geometry beyond LoD2 needs a measurement and a name.** The surface
   model measures, OSM names: a column (chimney, tower, mast, water
   tower, communications tower, lighthouse) is drawn where OSM maps a
   `man_made=*` of that kind *and* the gap there reaches 5 m; a missing
   building where OSM maps an outline LoD2 barely covers *and* the
   surface model fills it. The shape is simple and measured — a column
   lathed from its kind's ring profile at the measured height and radius,
   a building as its outline extruded to the 60th percentile of the
   measured height — never a modelled likeness.
2. **A landmark's roof relief is the one gap drawn without its own
   outline**, and only on a landmark (a Wikidata item matched to LoD2
   objects), only above its highest LoD2 roof (a courtyard's trees and a
   roof step a metre off stay below it), only where the excess is large
   (≥ 3 m on ≥ 60 m²): stacked slabs, a contour model of
   the measured roof, wearing the host object's row. On an ordinary roof
   the excess is antennas, dormers and trees.
3. **Attributes change the look only within the clay palette.** A mapped
   colour keeps its hue; its saturation is capped (0.45) and its
   lightness held (walls 0.45–0.9, roofs 0.3–0.8). A material picks a
   palette family. Glass and metal are object flags with a subtle shader
   response (cooler, smoother, a Fresnel sky sheen on glass). No textures,
   no window grids, no panes. Priority: walls OSM colour > material
   family > use family; roofs DOP colour > OSM `roof:colour` > palette.
4. **Landmarks come from Wikidata, ranked relatively per tile.** The fetch
   caches a SPARQL answer per tile (architectural structures with ≥ 2
   sitelinks); the bake matches items to the LoD2 objects that draw them
   (OSM `wikidata=` outlines, else the building under the point), drops
   what matches nothing drawn, and keeps the tile's twelve most notable.
   The site's twelve most notable go into the tileset's extras for the
   HUD, which glides to a computed vantage. No list is written by hand.
5. **Everything is a pipeline step fed by the site config** (`landmarks`,
   `structures`, the extended `osm-buildings`), reading the network only
   at fetch time ([ADR 0025](./0025-bakes-are-one-python-package.md)).

## Consequences

- Unna gets its chimney, every city its mapped masts and towers and the
  buildings newer than its LoD2; a new city gets them, its landmark list
  and its mapped colours from `bun run fetch` → `bake` → build.
- What OSM does not map is not drawn, even when the surface model shows
  it. A structure mapped as the wrong kind is drawn as that kind.
- A column's radius is at the mercy of a 1 m raster: a chimney is held
  to at least h/24, and each kind is clamped, but a slim shaft's true
  width is not measured.
- The relief was first a stack of flat slabs, and a smooth curve read as
  terraces; it is now the measured height field (see the update below).
  Its thresholds were tuned on synthetic tests and a handful of real
  cases.
- The landmark list is as good as Wikidata's coverage and OSM's
  `wikidata=` tags; ranking by sitelinks favours the internationally known
  over the locally loved.
- All three looks (columns, mapped colours, the glass sheen) are
  conservative defaults, not yet judged on a real GPU.

## Update (2026-09-30)

- **The relief is the measured height field, not slabs.** Per connected
  patch the bake writes the 1 m grid of the surface model's heights
  above the host's highest LoD2 roof (`grid`, −1 outside the patch),
  smoothed only lightly (half the cell, half a Gaussian of σ = 1 cell
  normalised over the patch); `reliefMesh` builds one surface from it.
  Stacked 2 m slabs had made a spire LoD2 cuts short a stepped pyramid
  (Unna's Stadtkirche: LoD2 137 m, the surface model ≈ 178 m). It stays
  within point 2: every height is a measured cell, nothing is invented.
- **A tower LoD2 draws is not added again.** A mapped tower, lighthouse or
  water tower whose foot lies under a LoD2 roof is the building's own
  (a church's, a castle's); the column search had lathed a second one
  inside it (Meißen's cathedral, Grimma's churches, 13 of Munich's 14
  towers). Masts and chimneys on roofs are not in LoD2 and stay.
- **What no open source records is left undrawn**, even on a landmark:
  the Elbphilharmonie's brick base (the Kaispeicher A) is in neither
  LoD2, OSM (one outline, no `building:part`) nor Wikidata (steel, glass,
  concrete), so the building wears one look. Mapping the part in OSM is
  the route, not a hand-drawn exception (plan 050's open items).

## Alternatives

- **Every gap from the surface model alone:** cranes, pylons and tree
  crowns become towers (Leipzig's centre, Hamburg).
- **Hand-modelled landmarks per city:** not repeatable for the next city,
  and a detailed model stands out of a clay city of LoD2 boxes.
- **glTF models from 3D warehouses** (Sketchfab, Google's 3D Tiles, …):
  a licence per model or a terms-of-use wall, and a photographic or
  detailed look the clay style cannot absorb.
- **Raw OSM colours:** a signal red or pure blue facade in a pastel city.
- **Textures or a window grid for glass and metal:** the recorded veto on
  the window grid; a texture needs UVs the LoD2 does not have.
- **Overpass or Wikidata at runtime:** no backend
  ([ADR 0001](./0001-client-only-static-app.md)), and a bake must be
  reproducible from cached inputs, never the live network (ADR 0025).
- **A fixed sitelink threshold for landmarks:** set where a metropolis's
  landmarks stand out, it left Unna with one.

## References

- `pipeline/bake/structures.py`, `pipeline/bake/landmarks.py`,
  `pipeline/bake/osm_buildings.py` (`LOOK_KEYS`, `MATERIALS`,
  `colour_of`, `apply_looks`), `pipeline/bake/fetch.py`;
  `lib/city/structures.ts`, `lib/city/landmarks.ts`,
  `lib/city/building-tint.ts` (`osmColourTint`, `MATERIAL_FAMILY`),
  `lib/city/city-mesh.ts` (`OBJECT_FLAG_GLASS`, `OBJECT_FLAG_METAL`,
  `OBJECT_FLAG_LANDMARK`, `OBJECT_SOURCE_GAP`, `inheritedLook`),
  `scripts/bake-city-mesh.ts` (`appendGapStructures`),
  `scripts/prepare-data.ts` (`withLandmarks`), `app/_components/
  visual-style.ts` (`osmColour`, `clayGlow`), `app/_components/scene-sidebar.tsx`.
- [Plan 050](../plans/050-landmarks-and-gaps.md), [plan 034](../plans/completed.md#034--small-structures-from-dom--lod2--done-2026-09-26-look-unjudged-on-a-gpu--plan-019)
  (the scan's small structures, the same append path),
  [ADR 0033](./0033-bridges-measured-in-the-surface-model.md) (bridges:
  measured in DOM1, typed by Wikidata), [ADR 0010](./0010-opaque-clay-buildings-only.md).
- Ledger: *Structures beyond LoD2*, *Landmark roof relief*, *Mapped wall
  and roof colour*, *Glass and metal facades*, *Landmarks from Wikidata*
  and the 🗃️ rows in [transformations.md](../transformations.md).
