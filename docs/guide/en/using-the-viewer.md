# Using the viewer

*Deutsch: [Bedienung](../de/using-the-viewer.md)*

The interface is in German. This page walks through it label by label. You
need a browser with **WebGL2** (every current desktop and mobile browser
has it) and, for a smooth picture, a reasonably recent graphics card. Phones
are supported: they automatically get a lighter render budget.

## Loading

The loading screen lists five stages and a bar. The first three
(buildings, terrain, light) end at the mark labelled *begehbar*
("walkable"): from that moment the overlay dissolves and you can move,
while the remaining two (the surroundings in view, then trees, lamps,
rails and walls) stream in behind a small pill at the top of the screen.
*Alles geladen* means everything in your view is in – not the whole city.
After that the viewer keeps loading as you move: the city is streamed tile
by tile, detailed near you and coarse further away. When that takes a
moment, on a long flight for instance, a small *Umgebung lädt* ("loading
surroundings") hint shows at the top of the screen (see [how a visit unfolds](./how-it-works.md#how-a-visit-unfolds)).

## Moving around

| Input (desktop) | Does |
|---|---|
| Drag with the mouse | look around |
| `W` `A` `S` `D` | walk (or fly) |
| `Shift` | sprint |
| `F` | switch between walking and flying |
| `Space` / `Shift` (or `E` / `Q`) | up / down while flying |
| `1` – `9` | glide to the first to ninth viewpoint |
| Mouse wheel | zoom (narrows or widens the field of view) |
| Double-click on the ground | travel there in a short glide |
| Click on the minimap | teleport there |
| *Standort* (toolbar, bottom right) | teleport to where you really are |
| `R` | demolish the building under the crosshair |
| `Esc` | leave immersive mode |

| Input (touch) | Does |
|---|---|
| Drag | look around |
| Joystick (bottom left) | walk |
| *Standort* (toolbar, bottom right) | teleport to where you really are, facing the way the phone points |
| *Live* (toolbar, only with a compass) | view and position follow you and your phone — flying too — until you switch it off, drag or use the joystick |
| *Fliegen* (toolbar) | switch between walking and flying |
| ⌄ under the toolbar | fold the toolbar into one button (⋮ opens it again) |
| Altitude slider (above the toolbar, flying only) | push up to climb, down to sink; let go to hold the height |
| Double-tap on the ground | travel there |
| Two-finger pinch | zoom |

While walking you are held at eye height on the terrain and collide with
buildings and walls. Flying, you meet facades too, sinking stops at eye
height above the ground, and rising ground lifts you with it. You never
end up inside a building or below the ground: a double click on a facade,
a snapshot or your location inside a house sets you down in front of it,
in the air over its roof, and a glide climbs over whatever stands on its
way. Any input cancels a glide that is in progress.

Bottom right sits the **toolbar**; each button carries its name under the
icon. The ⌄ below it folds it into one small button, which the browser
remembers; a green dot on it says *Live* is still on.

*Standort* ("location") asks the browser where you
are and puts you down there at eye height, on foot. On a phone with a
compass you then look the way the back of the phone points (its top edge
when it lies flat); without one the view keeps its direction. A short line
at the top reports the precision — GPS in a city is often 5–20 m off, a
phone compass a few degrees. If you stand outside the area, the same line
says how far, and you stay where you are. Browsers ask for permission first
(iPhones for the compass too); the location never leaves the device — there
is no server to send it to.

*Live* appears as soon as your phone reports compass readings (an iPhone
asks for permission on the first tap; a computer without a compass never
shows it). Switched on, the city becomes a window you hold up: turn around
and the view turns with you; tilt the phone and you look up or down. And
when you start walking, the camera walks along — it follows your GPS
position, smoothed so the fix's scatter doesn't jolt. Outside the area, or
without a location, only the view follows. A second tap, dragging to look
around or the joystick hand the controls back to you. *Live* and
*Fliegen* combine: you then hover over your position like a drone, and the
altitude slider climbs or sinks without ending *Live*.

A floating bar shows the four essential controls until you dismiss it with
*Verstanden*; the full table stays available in the panel under
*Steuerung*.

## The panel

The button in the corner opens a panel with three tabs.

### Erkunden ("Explore")

- **Minimap** — the whole area from above, with the land-use colours, the
  bridges and the footprints of the buildings currently loaded. Your position and view
  direction are drawn on it; a click teleports.
- **Gehen / Fliegen** — walk or fly.
- **Aussichtspunkte** ("viewpoints") — hand-picked vantages the camera
  glides to (on a keyboard also with `1` – `9`):
  - *from the air*: *Altstadt-Silhouette* (the start view, low over the
    Elbe), views from above onto the *Frauenkirche*, the *Brühlsche
    Terrasse*, *Albertplatz*, *Alaunpark* and *Zwinger & Semperoper*, a
    low flight over the *Äußere Neustadt*, plus *Carolabrücke* (over the
    river), *Elbe-Panorama* (high above the bend) and *Über den Dächern*
    (a low glide over the old town roofs);
  - *at eye level*: *Canaletto-Blick* (on the Elbe meadow, the old town
    across the grass), *Elbufer* (the tree-lined Neustadt bank), *Am
    Japanischen Palais* (on the Neustadt meadow where Canaletto painted)
    and *Neumarkt* (in front of the Frauenkirche).

  The Großer Garten lies just south of the area, so it has no viewpoint
  yet. The last card, *Aktuelle Sicht merken*, remembers where you stand;
  it then becomes *Gemerkte Sicht*, which jumps back there, with an ✕ to
  forget it.
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
| Vegetation | *Bodendetail* | kerbs, lawn edges, parking bays, road markings (crossings, stop, cycle and centre lines), the gardens of allotment colonies and the paving underfoot (asphalt, slabs, cobbles from OpenStreetMap), the mown stripes and grain of sports grounds, visible up close |
| | *Stadtgrün* | paints green courtyards, front gardens and parks inside built-up areas like meadow, from the infrared aerial photo |
| | *Wiesenfärbung* | tints meadows lush-to-dry from the infrared aerial photo |
| | *Gegenlicht-Schimmer* | backlight shimmer on crowns between you and the sun |
| | *Blattdurchscheinen* | translucency of nearby, large crowns (shadow-dependent) |
| | *Blattflimmern* | gusts flip leaves to their pale underside on sunlit crowns |
| | *Windhelligkeit* | crowns brighten as they lean into a gust |
| Rendering | *Kontaktschatten* | ambient-occlusion contact shadows in corners and under eaves |
| | *Himmelslicht* | narrow courtyards and street canyons get less skylight than open meadows — precomputed from the terrain and the building model |
| | *Ferne Schatten* | shadows beyond the ordinary shadow range: the long shadows of distant buildings and slopes at a low sun, and in the distance the shadows of the buildings next door too |
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
official datasets and OpenStreetMap contributors for, among others, lamps,
walls and fences, platforms, bridge structures, shops and listed buildings.
Next to it, *Unterstützen* (support)
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

## Small things

- **Listen.** Press **L** (or, on a phone, turn on *Klang (experimentell)*
  at the very bottom of *Erweitert*) and the city makes a quiet sound: wind,
  the Elbe, birds by day and crickets on summer nights, footsteps that
  know the paving underfoot — and when you move the clock past a full
  hour, the nearby churches strike it, each a little later the further
  away it stands, as sound travels. It is off every time the page loads,
  goes quiet in a background tab, and the small speaker in the top left
  corner turns it off again.
