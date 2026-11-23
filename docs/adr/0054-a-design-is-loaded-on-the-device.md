# ADR 0054: A planner's design is loaded on the device, placed by its coordinates or by hand, and stands in for the buildings it covers

- **Status:** accepted
- **Date:** 2026-10

## Context

Architects, landscape architects and planners want to see their designs
in the city: walk past them, see their shadows at a given hour, draw them
in Modell. Their formats differ, and their georeference is rarely
dependable: glTF has no place at all, architectural models often stand on
±0 with the NHN height only in the title block, and exports that write
the Land's coordinates into float32 vertices have rounded them. The page
keeps nothing about a visitor (ADR 0001), a phone's memory must not grow
(ADR 0047), and nothing the visitor does goes to a third party
unannounced (ADR 0043).

## Decision

1. **A design is a file read in the page, never uploaded**: glTF, IFC,
   OBJ, Rhino .3dm, or a landscape plan as DXF, Shapefile, GeoPackage or
   LandXML. Nothing it names is fetched; the WebAssembly readers load
   only when their format is picked, from the site's own `/wasm/`. Its
   parts become one geometry about its anchor, moved there in doubles
   before float32.
2. **It is placed by its coordinates where they say something**: UTM in
   the site's zone, an IFC's `IfcMapConversion` (its IfcSite roughly), a
   Rhino earth anchor. Its height is kept as NHN where the ground under
   it agrees, else it is set on the ground. A place more than 2 km
   beyond the site, or no place at all, puts it in front of the player,
   and the panel says why.
3. **It is read in metres unless the visitor sets a scale** (a unit times
   a factor; a hint when it is under 4 m or over 3 km). A plan is not
   scaled: its CRS gives its unit. The *Entwurf* panel moves, turns,
   lifts and scales it and saves all of it as a small JSON file.
4. **It stands in for the buildings it covers.** Each LoD2 object whose
   footprint its plan covers for at least half leaves its tile's index
   (`CityLayer.setHidden`) with all its parts, and comes back when the
   design moves or goes; collider, picks, shadows and minimap follow.
5. **Its site is cleared.** One raster of the design's plan and lowest
   height (`design-site.ts`), read by the vertex stages: instanced sets
   fold away what stands in it; ground, water and the tracks near the
   floor are pressed under it. A plan's areas clear the site but take no
   house away.
6. **A plan is drawn in the city's own palette.** Its areas become
   land-cover classes by their attributes, then their layer's name;
   trees are low-poly crowns, a building with a height a block, a TIN a
   planned ground. Lines are not drawn: in a plan they are edges.
7. **A design is drawn in a model-maker's white** or its own colours,
   casts and takes shadows, is walked against, and is asked like any
   thing: the card says only what the file and its placement say.
8. **Its bytes come out of the tile cache**, within a per-tier budget;
   past it the textures go first, then the design is refused with the
   numbers.

## Consequences

- The privacy page says that a design stays on the device. Sharing one
  by link would need storage for the visitor's content and is not
  offered.
- One design at a time; a phone's memory does not grow with it.
- A building hidden by a design and demolished meanwhile stays gone when
  the design leaves.

## Alternatives

- **An upload to a store**, so a design could be shared by link: a
  backend for the visitor's content, with questions of liability,
  deletion and confidentiality (competition entries are anonymous).
- **Hiding by a flag in the clay shader**: no index rebuild, but the
  collider and the picks would still meet the hidden buildings.
- **A convex hull as the design's plan**: an L-shaped design would take
  the house in its corner.
