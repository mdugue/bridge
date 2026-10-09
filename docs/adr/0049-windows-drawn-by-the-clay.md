# ADR 0049: Windows are drawn by the clay on every house, their rhythm measured where photos saw it and inferred where not

- **Status:** accepted
- **Date:** 2026-10-09

## Context

The facades had no windows: a procedural window grid was vetoed early on
(it read as an office block and fought the LoD2 silhouette; 🗃️
*Procedural window grid* in [transformations.md](../transformations.md)).
Street photos then measured the window rhythm of some walls
(`pipeline/bake/windows.py`: the axis spacing, the grid's regularity, the
window's width and proportion, the storey, ornament — each only where two
drives agree at Spearman ρ ≥ 0.6), and the first answer to them was
geometry: each measured window cut into its wall as a soft niche, rounded
6 cm into a 14 cm reveal, re-triangulating the wall round it (PR #143 as
first pushed).

The maintainer's verdict on it (2026-10-09): the window forms are too
plump, very many houses have none, and a house without facade detail next
to one with it must still look right. The measurement explains the second
point: 588 walls on 527 buildings were modelled, about 3 % of Dresden's
buildings; most streets were never photographed from close enough, or not
at all. Geometry explains the first: a rounded niche cut into a 2 km
tile's quantised mesh needs radii of several centimetres to survive the
16-bit positions, which is what made the openings soft lumps, and every
window added triangles (+0.84 % over the site for 4 000 windows; all
windows of all houses would have been millions).

## Decision

**Windows are drawn by the clay's fragment shader, not modelled**
(`app/_components/clay-windows.ts`). Per fragment on a wall the shader
finds its window cell from two inputs the building bake writes
(`lib/city/windows.ts`):

- **per building, its rhythm** — one more band of the object table
  (`WindowSpec`: axis spacing, width, height, a style word with a loose
  grid, a Fasche, a Verdachung, no ground floor, the reveal's depth and the
  sill's height as classes);
- **per wall vertex, where it stands on its wall** — the `_FACADE`
  attribute (snorm16 vec4): metres along the wall from its middle, the
  wall's length (negative where the ground floor has no windows: over a
  shopfront, or with more doors than the two it holds; 0 on a party
  wall), and up to two of OSM's doors along it, each its place and width
  in one code. A wall is one plane
  of one object's triangles; a party wall is one another wall stands
  against back to back.

The opening is a **recess the eye looks into** (parallax against its box:
the back, a side or the head or sill reveal, each with its own normal), the
sun lighting it only where it reaches through the opening
(`receivedShadowNode`), a slim sill under it with its drop shadow, and
where the style says so a Fasche or a Verdachung standing a few
centimetres out of the wall. The back is the wall's colour darker and
cooler, lit by little of the sun — never glass, no panes, no mullions.
Every edge is anti-aliased by its pixel footprint, and where a window is a
few pixels wide the drawing hands over to the facade's mean tone, so a far
street does not shimmer. A slider (*Fenster*) fades them.

**The rhythm comes from the photos where they saw the house, and is
inferred where they did not**, best first: the house's own measured walls;
another part of its building; the nearest measured building within 150 m
of the same roof form and about its eave (a block's houses share their
era); its type — a town house of tall storeys, a walk-up, a small house, a
flat-roofed block or a low flat building — whose numbers are calibrated
to the medians the photos measured on Dresden's walls of that type. A
measured rhythm is drawn towards its type's: one wall's reading is noisy,
and neighbours whose windows differ by half read restless. A window's
height follows its storey (its head a type's distance under the next
floor), so windows stand tall in a Gründerzeit front and squat in a
Plattenbau; the storey snaps so that a whole number of floors reaches the
eave.

**The windows keep to the Gliederung.** The storeys count from the
street: a LoD2 base is the lowest ground round the whole footprint (a
courtyard's, a ramp's), so a building's base moves up to the street its
plinths stand on, and the storey lines, the Gurtgesims and the windows
start from the pavement. The ground floor's windows open over the
plinth's highest top (a plinth stepping up a slope lifts them; where that
would take more than 1.5 m, or leave them lower than four fifths of their
width, that ground floor has none), a town house's a little higher still
(a Hochparterre); the Gurtgesims sits on the first storey line, between
the ground floor's heads and the first floor's sills; a top floor's
windows end under the Traufgesims, shorter if they must.

**None where the facade is its own**: a church, a palace, a theatre, a
museum or a hall (the ALKIS function, or storeys taller than 5.5 m), glass
or metal cladding, a garage, shed or plant, anything under 3.2 m of wall,
a party wall, a shopfront's ground floor, and on the ground floor none
within 0.6 m of a door's opening — its surround and a pier of wall
between. A Wikidata
landmark's flag alone does not keep them off: most are town houses whose
neighbours carry windows.

## Consequences

- Every house that should have windows has them (on the spawn tile: 308
  buildings measured, 1 223 by a neighbour, 1 638 by type; over Dresden's
  fifteen tiles 891, 4 823 and 31 361), at no cost in triangles: the
  building glTF's float roof flag gives way to the snorm16 vec4 that
  carries it and the wall coordinate (4 bytes a vertex more), and the
  object table gains a band. The wall area under windows is 69–80 % a
  tile, party walls 20–27 %, shop ground floors up to 4 %.
- What it costs, measured over Dresden's fifteen tiles against main: the
  city glTFs download 6.1 % larger (66.4 → 70.5 MB gzipped), their GPU
  buffers 15 % (737.7 → 847.6 MB with every tile loaded; the spawn tile
  59.9 → 68.7 MB). The triangles grow by 1.1 %, none of them windows: the
  plinth and band pieces follow the storeys now counted from the street.
- The veto is narrowed, not lifted: what it rejected — a uniform grid
  pasted over facades, glass panes, mullions, a texture — stays out.
  Windows follow each building's own rhythm and its storeys, keep off
  party walls, doors and shopfronts, and stop under the eave.
- The clay's fragment cost grows on walls (a parallax step, a few
  smoothsteps), built once: the window graph, and the Schnitt's poché
  round the facade colour, are steps and mixes, never a TSL `select`,
  which three emits as if/else and builds again inside its arm (a first
  cut ran the windows twice a pixel, a derivative in a branch). Its vertex buffers stay four of
  WebGPU's eight, the roof flag riding in the wall coordinate's first
  door slot (−1, `FACADE_ROOF`). Its varyings grow by two vec4 (the
  rhythm, the wall coordinate), which brings the clay to WebGPU's limit:
  with transparency on and the Ausschnitt's clip distances it passes
  fifteen, all that WebGPU's default sixteen leave once `front_facing`
  takes one. A new value
  per building or per vertex rides in a varying the clay already passes;
  one more and WebGPU drops the buildings without a word, while WebGL2
  still draws them.
- The reveals look along the view: from the camera in perspective, and
  in Modell's parallel projection along one direction for the whole
  frame, sheared off the camera's forward in a Militärperspektive
  (`viewDirection()`, `view-direction.ts`, set each frame with the post's
  lens; the clay's rim and mirrors read the same).
- A window's place along the wall is not measured (two drives' poses
  differ by ~0.6 m): the axes are centred on each wall. A house the
  photos measured gets its spacing and width, drawn towards its type's;
  its window height is the type's for its storey, scaled by its measured
  height against the type's median (the photos read openings short).
- The niche geometry and its re-triangulation are gone (🗃️ *Window
  niches as geometry*).

## Alternatives

- **Geometry niches** (the first cut of PR #143): plump at the radii the
  quantised mesh allows, triangles per window, and measured walls only.
- **Measured walls only, drawn in the shader**: elegant where it applies,
  but a street of plain houses with every thirtieth one windowed is what
  the maintainer rejected.
- **A window texture or glass**: the veto's core; never.
