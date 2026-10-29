# ADR 0053: A planner's design is loaded on the device, placed by its coordinates or by hand, and stands in for the buildings it covers

- **Status:** accepted
- **Date:** 2026-10

## Context

Architects, landscape architects and planners want to see their designs
in the city: walk past them, see their shadows at a given hour, take the
Modell view and the shading study of them. The assessment of
2026-10-29 ("Entwürfe in city walk") looked at the formats those
professions use and what the viewer would need:

- **Formats.** The open ones have readers that run in a browser: glTF,
  OBJ, IFC (web-ifc), DXF, Rhino 3DM, CityGML/CityJSON, LandXML,
  GeoPackage, Shapefile. DWG, Revit and SketchUp are closed; each of
  those programs exports glTF, IFC or DXF. glTF is what nearly every tool
  exports, what three.js already reads for the tiles, and needs no
  WebAssembly.
- **Georeference.** Rarely dependable. IFC4 can carry it
  (`IfcMapConversion`), DXF lies in the Land's coordinates or the office's
  own and does not say which, glTF has no place at all. Architectural
  models often stand on ±0 = their ground floor, with the NHN height in
  the title block, not in the model. Some exports write the Land's
  coordinates into the vertices, where float32 has already rounded them
  to about half a metre.
- **The rules of the page.** No backend for what the visitor does
  (ADR 0001), a phone's memory held within its line (ADR 0047) — a
  change must not make the phone's footprint grow —, and nothing the
  visitor does goes to a third party unannounced (ADR 0045).

## Decision

A design is a **file the visitor loads into the page on their own
device**: a .glb, or a .gltf with its resources picked together. It is
read in the page (`design-read.ts`), never uploaded; a .gltf's resources
come only from the files picked with it — any other URL it names is
refused, so a design never makes the page fetch from anyone. Its nodes
and instances are flattened into **one geometry about its anchor** (its
box's middle in plan, at its lowest point), moved there in doubles before
the positions become float32, with a group per material of the file.

It is **placed** by what its coordinates say where they say anything
(`lib/city/design-placement.ts`): an easting of the site's UTM zone in X
(plain, or with the zone in front as survey plans write it) and a
northing in −Z are its place; its own Y is kept as NHN where the ground
under it agrees within 40 m, else it is set on the ground. Without a
place it is set down on the ground ahead of the player. Set on the
ground, a model whose Y runs through 0 stands on its ±0 (its basement
below the ground), any other on its lowest point. The sidebar's
*Entwurf* panel moves, turns and lifts it, sets it on the ground, and
saves the placement as a small JSON file (`city-walk-entwurf/1`) to load
with the design next time.

It **stands in for the buildings it covers**: its plan, every triangle
laid flat on 1 m cells except the flat ones at its lowest level (a ground
plate, a site plan), takes each LoD2 object whose footprint it covers for
at least half (`lib/city/design-cover.ts`). Those objects leave their
tiles' index (`CityLayer.setHidden`, the demolish's filter, with their
triangles kept aside) and come back when the design moves or goes; the
collider, the picks, the shadows and the minimap follow the index. The
switch *Bestand im Umriss ausblenden* turns it off for a model that
carries its own context.

It is drawn in a **model-maker's white** (one scene material), or in the
file's own colours and textures on request; it casts and takes the sun's
shadows and is walked against like a building (its BVH, built once).

Its **bytes are taken from the tile cache** while it is loaded
(`reserveCache` in create-app.ts), and a design past its tier's budget
(`lib/city/design-budget.ts`: 250 000 triangles and 40 MB on a phone,
3 million and 400 MB on a desktop) loses its textures first and is then
refused with the numbers, so the planner can export it lighter.

## Consequences

- No backend, no upload, no third party: the privacy page says so, and
  sharing a design with someone else is not possible yet — the stage
  that would need a decision on storage (ADR 0001).
- One design at a time, in glTF only. IFC (with `IfcMapConversion`
  placing it by itself) and the landscape formats (DXF, GeoPackage,
  Shapefile, LandXML: surfaces as land-cover classes, symbols as trees,
  a planned ground) are the next stages.
- The baked ground stays under the design: a design with its own ground
  shows both; trees, lamps and street furniture inside its outline stay
  too. Cutting the terrain and hiding the dressing under a design is the
  stage after this one.
- The design is not asked (*Befragen*): a click on it asks what stands
  behind it.
- A building hidden by a design and demolished meanwhile stays gone when
  the design leaves.

## Alternatives

- **An upload to a store** (Vercel Blob), so a design could be shared by
  link: a backend for the visitor's content, with questions of liability,
  deletion and confidentiality (competition entries are anonymous). Not
  for the first stage.
- **IFC first**: it can place itself, but web-ifc is a WebAssembly
  module of its own, and large IFC models break the phone's budget; the
  placement panel glTF needs is the fallback IFC needs anyway.
- **Hiding by a flag in the clay shader** (the object's vertices
  collapsed in the vertex stage): no index rebuild, but the collider and
  the picks would still meet the hidden buildings. The index filter keeps
  every ray in step with what is drawn.
- **A convex hull as the design's plan**: an L-shaped design would take
  the house in its corner.

## References

- `app/_components/design-read.ts`, `design-layer.ts`, `design-panel.tsx`
- `lib/city/design-placement.ts`, `design-cover.ts`, `design-budget.ts`
- `app/_components/city-layer.ts` `setHidden`
- The assessment "Entwürfe in city walk" (2026-10-29)
