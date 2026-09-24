# Using the viewer

*Deutsch: [Bedienung](../de/using-the-viewer.md)*

The interface is in German. This page walks through it label by label. You
need a browser with **WebGL2** (every current desktop and mobile browser
has it) and, for a smooth picture, a reasonably recent graphics card. Phones
are supported: they automatically get a lighter render budget.

## Loading

The loading screen lists six stages and a bar. The first three (buildings,
terrain, light) end at the mark labelled *begehbar* ("walkable"): from that
moment the overlay dissolves and you can move, while the remaining stages
(trees and lamps, neighbouring tiles, rails and walls) stream in behind a
small pill at the top of the screen. *Alles geladen* means everything
around you is in. After that the viewer keeps loading quietly as you move:
the city is streamed tile by tile, detailed near you and coarse further
away (see [how a visit unfolds](./how-it-works.md#how-a-visit-unfolds)).

## Moving around

| Input (desktop) | Does |
|---|---|
| Drag with the mouse | look around |
| `W` `A` `S` `D` | walk (or fly) |
| `Shift` | sprint |
| `F` | switch between walking and flying |
| `Space` / `Shift` | up / down while flying |
| Mouse wheel | zoom (narrows or widens the field of view) |
| Double-click on the ground | travel there in a short glide |
| Click on the minimap | teleport there |
| `R` | demolish the building under the crosshair |
| `Esc` | leave immersive mode |

| Input (touch) | Does |
|---|---|
| Drag | look around |
| Joystick (bottom left) | walk |
| Double-tap on the ground | travel there |
| Two-finger pinch | zoom |

While walking you are held at eye height on the terrain and collide with
buildings and walls. While flying there is no collision. Any input cancels
a glide that is in progress.

A floating bar shows the four essential controls until you dismiss it with
*Verstanden*; the full table stays available in the panel under
*Steuerung*.

## The panel

The button in the corner opens a panel with three tabs.

### Erkunden ("Explore")

- **Minimap** — the whole area from above, with the land-use colours and
  the footprints of the buildings currently loaded. Your position and view
  direction are drawn on it; a click teleports.
- **Gehen / Fliegen** — walk or fly.
- **Aussichtspunkte** ("viewpoints") — five hand-picked vantages the camera
  glides to: *Carolabrücke* (over the river), *Elbe-Panorama* (high above
  the bend), *Über den Dächern* (a low glide over the old town roofs),
  *Canaletto-Blick* (on foot on the Elbe meadow, the old town across the
  grass) and *Elbufer* (a walk along the tree-lined Neustadt bank). The
  sixth card, *Aktuelle Sicht merken*, remembers where you stand; it then
  becomes *Gemerkte Sicht*, which jumps back there, with an ✕ to forget it.
- **Steuerung** — the full controls table.

### Szene ("Scene")

- **Sonne & Zeit** ("sun and time") — a date picker and a time-of-day slider.
  The slider's colour band marks that day's real sunrise and sunset. The
  sun's position is computed for Dresden for the chosen instant; shadows,
  sky, fog colours and the dusk glow in buildings follow it. *Standardzeit*
  returns to 14:00, the time the default look is tuned for.
- **Darstellung** ("look") — sliders in four collapsible groups. Every
  slider is a percentage; the defaults are the tuned look.

| Group | Slider | What it does |
|---|---|---|
| Atmosphäre | *Nebel* | distance haze |
| | *Talnebel* | extra haze pooling in the low ground along the river; reads the real terrain height |
| | *Flussnebel* | drifting mist sheet over the water |
| | *Tiefenfärbung* | warm near, cool far: a depth-based colour grade |
| Gebäude | *Transparenz* | see through buildings (dithered), up to 90 % |
| | *Boden-Verlauf* | darkening of walls towards the ground |
| | *Höhenlinien* | faint storey bands, spaced from the measured height |
| | *Streiflicht* | rim light on edges facing away from the sun |
| | *Farbvariation* | per-building wall tint from function and height |
| | *Dachfarbe* | how strongly the real (or synthesised) roof colour shows |
| | *Dachsättigung* | lifts the saturation of the aerial-photo roof colours without shifting their hue; 0 = raw photo |
| | *Traufkante* | a soft line where wall meets roof |
| | *Abendlicht* | warm windows in shops and public buildings at dusk |
| | *Materialstreuung* | matte-to-silky variation between buildings |
| Vegetation | *Wiesenfärbung* | tints meadows lush-to-dry from the infrared aerial photo |
| | *Gegenlicht-Schimmer* | backlight shimmer on crowns between you and the sun |
| | *Blattdurchscheinen* | translucency of nearby, large crowns (shadow-dependent) |
| | *Blattflimmern* | gusts flip leaves to their pale underside on sunlit crowns |
| | *Windhelligkeit* | crowns brighten as they lean into a gust |
| Rendering | *Kontaktschatten* | ambient-occlusion contact shadows in corners and under eaves |
| | *Papierkorn* | the paper grain over the whole image |
| | *Tiefenschärfe* (switch) | photographic depth of field; *Auto* focuses on the crosshair, *Manuell* on a fixed distance |
| | *Detaillierte Kronen* (switch) | rich multi-tuft crowns near the camera; off = the cheap crown everywhere |

While the camera moves, the depth-of-field blur is switched off (the eye
cannot resolve it in motion) and comes back when you stop.

### Erweitert ("Advanced")

- **Werkzeuge** — *Gebäude unter dem Fadenkreuz abreißen* demolishes the
  building you are looking at (same as `R`), on any tile in view; it is
  not undoable. *Immersiver Modus* locks the mouse pointer
  for a first-person feel; `Esc` leaves it.
- **Snapshot** — *Kopieren* copies your exact position, the date and time
  and every slider as a small JSON text; paste such a text into the box and
  press *Anwenden* to restore it. This is how a specific view is shared or
  reproduced for a screenshot. A malformed snapshot is rejected with a
  message instead of breaking the scene.
- **Statistik** — number of buildings and terrain points currently in
  view, estimated graphics memory and the frame rate.

The footer credits the data sources: the Saxon survey office for the
official datasets and OpenStreetMap contributors for lamps, walls,
platforms and bridge structures. Next to it, *Unterstützen* (support)
leads to the project's Ko-fi page; it is a plain link that loads nothing
from Ko-fi until it is clicked.

## Tips

- Judge the picture from **oblique angles**, not straight down; that is
  also how the maintainers check it.
- Golden hour (sun a few degrees above the horizon) and blue hour (a few
  degrees below) give the richest colours; try 07:00 or 20:00 in summer.
- On a laptop without a discrete graphics card, lower *Kontaktschatten*
  and switch off *Tiefenschärfe* for a higher frame rate.
- `?scene=lite` in the address bar streams only the start tile, with
  coarse shadows. It exists for automated tests and is not how the scene
  is meant to look.
