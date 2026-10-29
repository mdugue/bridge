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

1. **A design is a file read in the page, never uploaded.** A .glb, a
   .gltf with its resources picked together, an IFC, an OBJ with its MTL
   or a Rhino .3dm; a resource from anywhere else is refused, so a design
   never makes the page fetch from a third party. The WebAssembly readers
   (web-ifc, rhino3dm) load only when their format is picked, from the
   site's own `/wasm/`. Its parts are
   flattened into one geometry about its anchor (the box's middle in
   plan, its lowest point), moved there in doubles before float32.
2. **It is placed by its coordinates where they say something**, else
   ahead of the player. An easting of the site's UTM zone and a northing
   are its place, and so is an IFC's `IfcMapConversion` (its IfcSite's
   latitude and longitude roughly) and a Rhino file's earth anchor; its height is kept as NHN where the
   ground under it agrees, else it is set on the ground (a model whose
   height runs through 0 on its ±0). The *Entwurf* panel moves, turns and lifts it
   and saves the placement as a small JSON file to load with it again.
3. **It stands in for the buildings it covers.** Each LoD2 object whose
   footprint its plan covers for at least half leaves its tile's index
   (`CityLayer.setHidden`), with its plinths, cornices and other parts,
   and comes back when the design moves or goes. Collider, picks,
   shadows and minimap follow the index. A switch turns this off for a
   model that carries its own context.
4. **It is drawn in a model-maker's white** (one scene material) or in
   the file's colours, casts and takes shadows, and is walked against.
5. **Its bytes come out of the tile cache** while it is loaded, within a
   per-tier budget; past it the textures go first, then the design is
   refused with the numbers.
6. **What else stands in its site goes too.** The site is the design's
   plan with the lowest height it reaches per cell, one raster the vertex
   stages read (`design-site.ts`): instanced sets fold away what stands
   in it, and the ground, with what is baked into it, is pressed under
   that height and cut where it would rise through the design's plate.
   The walked ground follows. Rails, tram tracks and water stay.

## Consequences

- The privacy page says that a design stays on the device. Sharing a
  design by link would need storage for the visitor's content and is not
  offered.
- One design at a time.
- The site raster (2 MB at most) is taken from the tile cache with the
  design, so a phone's memory does not grow.
- An IFC's kernel memory is freed once the model is read; a phone reads
  IFC files up to 80 MB, a desktop up to 512 MB (past that web-ifc's
  32-bit heap aborts), the tessellated model then weighed like any
  other.
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
