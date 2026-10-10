# Using the viewer

*Deutsch: [Bedienung](../de/using-the-viewer.md)*

The interface is in German. This page walks through it label by label. You
need a browser with **WebGPU** (the newer graphics interface most current
browsers offer) or, where that is missing, **WebGL2** (every current
desktop and mobile browser has it; the picture is the same, but the view
may stutter briefly while new areas appear), and, for a smooth picture, a
reasonably recent graphics card. Phones are supported: they automatically
get a lighter render budget.

## Choosing a city

The start page (`/`) shows one card for every city this deployment was
built with: the city's map in the viewer's ground colours, its Land, the
area it covers and how many viewpoints it has. A card opens that city's
viewer, which has an address of its own — `/dresden`, `/leipzig`, … — so a
link or bookmark leads straight into it. Inside the viewer, *Andere Stadt
wählen* ("choose another city") under the city's name at the top of the
panel leads back to the start page. The start page also links to the
knowledge base (`/wissen`).

Above the cards, *Sortieren* ("sort") orders them. *Empfohlen*
("featured") puts Dresden first — the best-kept city — and the rest by
name; the other orderings rank by a figure the build measured for every
city the same way, and each card then shows its figure: the most tree
crowns per km² (as the surface model sees them), the greenest (forest,
meadow and fields in the land cover), the most water, the tallest houses
(the median building's height), the most densely built (the share of the
ground under a roof), the hilliest (the ground's height range), the most
landmarks, the largest area.

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

The side panel is there from the start, over the loading screen. While
the city loads you can already pick a place, click a spot on the map or
apply a snapshot: the load starts over at that place (the loading screen
names it as *Start*), so you arrive there instead of at the usual start
and then travel. The sun, the time and the look can be set too; Modell,
the tools, *Sicht merken* (remember this view), the sound and saving a
picture wait until the scene is up.

## Moving around

| Input (desktop) | Does |
|---|---|
| Drag with the mouse | look around (the pointer is a hand that grabs the view) |
| `W` `A` `S` `D` | walk (or fly) |
| `↑` `↓` / `←` `→` | walk forward and back / turn left and right |
| `Shift` | sprint |
| `F` | switch between walking and flying (take off / land) |
| `Space` / `Shift` (or `E` / `Q`) | up / down while flying |
| `1` – `9` | glide to the first to ninth viewpoint |
| Mouse wheel (or a two-finger trackpad gesture, or pinching on it) | move towards the spot under the pointer (the crosshair in immersive mode), or back from it: on foot along the ground, flying along the line to that spot, which stays under the pointer; each step covers most of the way left, never past it, and over the sky the flight stays level |
| `Alt` + mouse wheel | zoom (narrows or widens the field of view) |
| Double-click on the ground | travel there in a short glide; flying, glide part of the way towards it |
| Click on the minimap | glide there (on foot you land standing; flying, at the same height) |
| *Standort* (toolbar, bottom right) | teleport to where you really are |
| Click on a building | ask it: a card says what the data knows about it |
| `I` | ask what stands under the mouse pointer (immersive: at the centre) |
| `R` | demolish the building under the mouse pointer (immersive: at the centre) |
| `V` | switch to the next picture style (Pastell → Comic → Film noir → Sin City → Papier → Strich → Schwarzplan) |
| `M` | switch to *Modell*, the city in parallel projection, and back (see [Modell](#modell-the-city-as-a-planner-draws-it)) |
| `Esc` | leave immersive mode |

| Input (touch) | Does |
|---|---|
| Drag | look around |
| Joystick (bottom left) | walk |
| *Standort* (toolbar, bottom right) | teleport to where you really are, facing the way the phone points |
| *Live* (toolbar, only with a compass) | view and position follow you and your phone — flying too — until you switch it off, drag or use the joystick |
| *Fliegen* (toolbar) | switch between walking and flying (take off / land) |
| *Modell* (toolbar) | switch to the city in parallel projection and back |
| Long press on a building | ask it |
| ⌄ under the toolbar | fold the toolbar into one button (⋮ opens it again) |
| Altitude slider (above the toolbar, flying only) | push up to climb, down to sink; let go to hold the height |
| Double-tap on the ground | travel there in a short glide; flying, glide part of the way towards it |
| Two fingers apart / together | towards / away from the spot between the fingers: on foot along the ground, flying along the line to it (the higher, the further) |

While walking you are held at eye height on the terrain and collide with
buildings and walls. Flying, you meet facades too, sinking stops at eye
height above the ground, and rising ground lifts you with it. You never
end up inside a building or below the ground: a double click on a facade,
a snapshot or your location inside a house sets you down in front of it,
in the air over its roof, and a glide climbs over whatever stands on its
way. Any input cancels a glide to a viewpoint that is in progress.

Switching between walking and flying glides instead of jumping: taking
off rises to about 30 m above the ground, looking slightly down onto the
street; landing sinks straight down onto the ground below you (beside a
building, not on its roof), and the view levels out again, even if you
were looking down while flying. During a landing or a double-tap glide you
can look around without stopping it. Flying, the higher you are, the
faster you go.

Bottom right sits the **toolbar**; each button carries its name under the
icon. The ⌄ below it folds it into one small button, which the browser
remembers; a green dot on it says *Live* is still on.

*Standort* ("location") asks the browser where you
are and puts you down there at eye height, on foot. On a phone with a
compass you then look the way the back of the phone points (its top edge
when it lies flat); without one the view keeps its direction. A short line
at the top reports the precision — GPS in a city is often 5–20 m off, a
phone compass a few degrees. If you stand outside the area, a small window
says how far and offers where to go instead: one of the vantage points, a
spot you pick on the map, or staying where you are. If you stand in
another city this site also shows, the window says so first and offers to
jump there: its viewer opens with you standing where you are (the
position travels in the link's fragment, which never reaches the server).
Browsers ask for permission first
(iPhones for the compass too); the location never leaves the device — not
even in a crash report (see *When it crashes*).

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

## Modell: the city as a planner draws it

`M`, *Modell* in the toolbar or *Modell* beside *Gehen* and *Fliegen* in
the panel switch to **Modell**: the city in parallel projection, the way
urban planners draw it. The view backs away and narrows in a short dolly
zoom until the perspective is gone; `M` again glides back to where you
were — or, if you have moved the picture far, to a view from the air over
its middle.

A parallel projection has a scale instead of a distance: equal lengths
stay equal wherever they stand in the picture, near or far. You move the
sheet, not yourself, and it stays parallel whatever you do — coming nearer
only changes the scale:

| Input | Does |
|---|---|
| Drag | move the picture (the ground under the pointer stays under it) |
| Mouse wheel / two fingers apart or together | scale, about the pointer |
| `+` / `−` | one step of the scale |
| Right-drag or `Ctrl`-drag / two-finger twist | turn (under two fingers the ground turns with them); on release it settles on the nearest 15° |
| `Shift` + right-drag | tilt (the view becomes *Vogelschau*) |
| `Q` / `E`, ⟲ ⟳ | turn by 90° |
| `W` `A` `S` `D`, arrow keys | move the picture |
| Double-click / double-tap | centre the picture there |
| `1` – `9`, *Orte*, the minimap | centre the picture on that place, keeping scale and turn |
| Click / long press | ask, as always |
| `F` | leave Modell into flight |

Bottom left, where the joystick sits on foot, are the **scale bar** — a
round length in black and white segments, with the scale under it
("1 : 2 500 bei 96 dpi": a screen pixel taken as 0.26 mm) — and the
**north arrow** between two quarter-turn buttons; a click on the arrow
turns north up. The minimap draws the ground the picture shows.

Under *Gehen · Fliegen · Modell* in the panel, **Projektion** offers the
views, each card with the cube it draws:

| View | What it is |
|---|---|
| *Isometrie* | the 30° isometry: tilted 35.26°, all three axes shortened alike (lengths along them × 0.816), turned to the diagonals |
| *Vogelschau* | parallel from above at a free tilt (slider) and turn |
| *Militär* | the Militärperspektive: the ground plan undistorted and to scale, heights standing straight up over it — at 30°/60° or 45°/45° to the sheet's edges, heights × 1 or × ⅔ |
| *Lageplan* | straight down, north up |
| *Ansicht* | level, onto the line through the middle of the picture; everything in front of it is cut away |
| *Schnitt* | the same, with what the cut opens filled black (poché) and the ground drawn as a profile below it |

Beneath them: the current scale and the steps 1:500 … 1:10 000 (zoom is
free in between); *Ausschnitt mit Sockel* ("cut-out with plinth"), which
keeps only the middle of the picture and stands it on a dark plinth, like
a model cut from the city (*neu setzen* takes the current middle; it ends
with Modell; the first time it says *Wird vorbereitet …* for a moment
while the city's drawing is prepared for the cut, and the city keeps
moving meanwhile — buildings just outside the cut still cast their
shadows over its edge; should it fail to prepare, the line beneath says
so, with *noch einmal versuchen*, "try again"); and *Bild speichern*.

**Trees stand at every scale.** Close up every tree is in the picture;
where the city is drawn coarser — zoomed far out, the whole city at
once, or when the device has to save memory — a third of them stand, their
crowns drawn wider so a wood still reads as a wood, each where its tree
stood. The same happens in the distance on foot and in flight. The
bridges stand at every
scale, a road bridge with its footways, kerbs and carriageway, the stone
ones in courses of dressed stone.

Every picture style works in Modell; *Strich* and *Schwarzplan* are made
for it. Depth of field, the warm/cool grade and the vignette rest while
Modell is on, the distance haze opens, and the sky gives way to the
style's paper.

**Bild speichern** ("save picture", also under *Erweitert*) saves the
current view as a PNG with a legend strip under it: north arrow, scale
bar, the view and the scale the picture has when printed at 300 dpi, date
and time, and the data sources' credits (their licences ask for them). In
Modell the picture is rendered larger than the screen — on a computer
about three image pixels per screen point, on a phone two, in tiles, with
a veil over the city for the moment it takes; in Gehen and Fliegen it is
the frame as you see it, with the credits.

## Asking a building

The city itself carries no text. Ask it instead: with a mouse, a
**click** on a building; on a touch screen, a **long press** (hold a
finger still for half a second); `I` asks what stands under the
mouse pointer (in immersive mode, which hides the pointer, what stands at
the centre; only there a dot marks it). The building gets a fine hatch and a line round its outline,
both in the controls' pink accent, and a card opens; a
click on nothing closes it again. You need not hit a small house exactly:
when nothing stands right under your finger, the building most of the
ground around it belongs to answers. On a phone the card is a sheet at
the bottom: folded it says what the building is and where; swipe it up
(or tap *Angaben und Quellen*) for the rest, swipe it down to fold or
close it — the joystick and the toolbar step aside while it is open, and
the city stays live behind it. A long press never selects text on the
page. The card says only
what the data knows:

- the building's **name** (from OpenStreetMap) or its official **use**
  (the ALKIS building function of the city model; for most houses it is
  recorded as *not specified*, and the card says exactly that),
- its **address** (OpenStreetMap),
- **height** (measured), eave, **roof** form and pitch, ground area, the
  **storeys** where OpenStreetMap has them, how many parts the model
  divides it into, whether it is a listed monument or has a shop on the
  ground floor,
- its **identifier** in the official city model (to copy — other datasets
  know the building by it),
- and one **source line** per dataset the card quotes, with its edition
  and licence: for the city model the year of the model, the year its
  roofs were measured and its footprints drawn.

A shed or garden house the laser scan found but the city model lacks says
so. Esc, × or a swipe down closes the card and removes the hatch; the
next question asks the next building. Nothing is estimated: a building without mapped
storeys simply has no storey line.

Trees, monuments and fountains, and bridges answer the same way.
Whatever you asked is framed by a soft pink line on a pale fringe —
along its outline as you see it now, the same width on screen near or
far. The fringe flashes briefly when you ask. A **street tree**
says its species (German and botanical), its street and number in the
city's tree register, the height, crown and trunk the register measured
(a size the register lacks is left out, not guessed) and the age it
records, with the date of that record. A **monument** says its official
name and, for a fountain, the basin's form; a **bridge** its name, its
structure and main span (from Wikidata, whose identifier you can copy),
its length and the shipping clearance under it.

The **traffic data** can be asked too, while its layer is on. A
**traffic flow** says its street, the vehicles counted a day both ways
and per direction (named by the compass point they head to, with the
heavy-goods share), the year and how they were counted — and where the
source counts both directions only together, the card says so rather
than inventing a split. It adds an estimate for the time set, labelled
as one, from a typical daily curve. A **bicycle counter** says the
bicycles of the last full hour per direction and when they were counted.
Both cards name their source and licence.

## The panel

The button in the corner opens a panel with three tabs.

### Erkunden ("Explore")

- **Minimap** — the whole area from above, with the land-use colours, the
  bridges and the footprints of the buildings currently loaded. Your position and view
  direction are drawn on it; a click glides there.
- **Gehen / Fliegen / Modell** — walk, fly, or see the city in parallel
  projection ([Modell](#modell-the-city-as-a-planner-draws-it)); in Modell
  the **Projektion** section follows.
- **Orte** ("places") — where to go, as one list: the hand-picked
  vantages and the city's landmarks together. The first six show; *Alle …
  Orte zeigen* ("show all places") opens the rest with a search field
  over every name. A row glides there (in Modell it centres the picture on
  it); the icon says how you arrive — on foot, from the air, or at a
  landmark — and on a keyboard the first nine also answer to `1` – `9`.
  - *The vantages* come first, in the order they were chosen. In Dresden,
    *from the air*: *Altstadt-Silhouette* (the start view, low over the
    Elbe), views from above onto the *Frauenkirche*, the *Brühlsche
    Terrasse*, *Albertplatz*, *Alaunpark* and *Zwinger & Semperoper*, a
    low flight over the *Äußere Neustadt*, plus *Carolabrücke* (over the
    river), *Elbe-Panorama* (high above the bend), *Über den Dächern*
    (a low glide over the old town roofs), *Großer Garten* (above the
    Palais, the Palaisteich and the park's crowns behind it), *Blaues
    Wunder* (over the Elbe, the bridge spanning from Blasewitz to
    Loschwitz), *Waldschlößchenbrücke* (over the Elbe meadows, the old
    town's towers downstream) and *Hauptbahnhof* (down onto the platform
    halls, Prager Straße leading to the old town); *at eye level*:
    *Canaletto-Blick* (on the Elbe meadow, the old town across the
    grass), *Elbufer* (the tree-lined Neustadt bank), *Am Japanischen
    Palais* (on the Neustadt meadow where Canaletto painted), *Neumarkt*
    (in front of the Frauenkirche) and *Palais im Großen Garten* (at the
    south end of the Palaisteich, the baroque Palais across the water).
  - *The landmarks* follow: the city's best-known buildings and
    structures, up to twelve — the Hofkirche and the Kreuzkirche in
    Dresden, the Chilehaus and St. Michaelis in Hamburg. The list is not
    hand-picked: it comes from Wikidata (the buildings with the most
    Wikipedia articles, matched to the buildings the viewer draws), so
    every city gets its own. A landmark a vantage already shows is not
    listed twice — the Frauenkirche is the vantage *Frauenkirche*, the
    Zwinger and the Semperoper are *Zwinger & Semperoper* (the search
    finds them by their own names) — and an institution housed in a more
    famous building is that building (the Rüstkammer is the
    Residenzschloss). A landmark row glides up to a view from the
    south-south-west, a little above it and higher the taller it is.

  *Sicht merken* ("remember view") in the list's heading remembers where
  you stand: *Gemerkte Sicht* then heads the list and jumps back there,
  with an ✕ to forget it.
- **Verkehrsdaten** ("traffic data") — up to three data layers over the
  city, each with its own switch, all off at start; a city shows only those
  it has open data for (see [Sources by city](./sources-by-city.md) and
  [Where the data comes from](./data-sources.md)):
  - *Kfz-Verkehr* ("motor traffic"): the vehicles counted per day as
    glass flows on the carriageway, one per direction — wider, taller and
    deeper in colour (sage, peach, coral, rose, wine) where more traffic
    runs, light running through them. The flows follow the time set: each
    day's count is spread over the day on a measured typical daily curve
    (slim and nearly dark at night, full and slow at the rush hours);
    below the switch, how busy the hour is;
  - *Radverkehr (live)* ("cycling, live"): at each of the city's counters
    two glass columns, as tall as the last hour's bicycles per direction; below
    the switch the list of counters with their numbers, a click flies
    there;
  - *Straßenbahnen (Fahrplan)* ("trams, by timetable"): every one of the city's trams
    where the timetable has it at the time set, trailing light — the clock runs on from
    there; below the switch, how many are out.

  From the air the flows, columns and trails widen and thicken so they
  stay legible.
- **Steuerung** ("controls") — the full controls table, folded until you
  open it (the bar over the scene shows the first few).

### Szene ("Scene")

- **Sonne & Zeit** ("sun and time") — a date picker and a time-of-day slider.
  The slider's colour band marks that day's real sunrise and sunset. The
  sun's position is computed for Dresden for the chosen instant; shadows,
  sky, fog colours and the dusk glow in buildings follow it. *Standardzeit*
  returns to 14:00, the time the default look is tuned for.
  Below, the **Verschattungsstudie** ("shadow study"): chips for 21 March,
  21 June and 21 December of the year shown and for 9, 12, 15 and 18
  o'clock set the sun in one click; *Als Blatt speichern* renders the
  current view at all twelve instants and saves them as one sheet — a row
  per date, a column per hour — with the legend under it (in Modell with
  scale bar and north arrow). The hours are your device's local time.
- **Darstellung** ("look") — the **Bildstil** (picture style) on top, then
  sliders in four collapsible groups. Every slider is a percentage; the
  defaults are the tuned look. *Zurücksetzen* ("reset") returns the
  sliders and leaves the picture style as it is.

A picture style draws the same city another way; switch it at any time,
with a click or with `V`. The browser remembers the last style for your
next visit:

| Style | What it looks like |
|---|---|
| *Pastell* | the default: a clay model on paper, soft light, no outlines |
| *Comic* | ink lines as if drawn by hand — wavy, thick and thin, now and then broken, a little off the fill —, flat colour areas in a few tones, a dot screen in the deepest shade up close; the trees become round cartoon clouds of three balls; from the air and in the distance the drawing gets looser and sparser |
| *Film noir* | black and white with a hard curve, a smoky distance, a sky that darkens towards the top, running film grain and a dark frame edge; a soft light cone under every street lamp — only hinted at by day, full at dusk; as it gets dark the camera opens up instead of letting everything go black |
| *Sin City* | hard areas in four tones (black, near-black, near-white, white) that follow the brightness around them, so even a dark view stays readable; crowns and the Elbe go black, meadows stay light, the skyline and big silhouettes stand as a white edge against the black; rain falls in front of the scene; only the red tiled roofs keep their colour |
| *Papier* | the city as a white paper model: every surface a slightly broken white, real sunlight and real (blue-grey) shadows, fine drawn graphite outlines; the trees become folded card polyhedra; road markings and sports lines stay as a faint grey, water as a cooler, deeper paper; lights and mist sheets drop out |
| *Strich* ("line") | a line drawing as on a plan: the white model with every edge in one even line, the shade as one light grey wash, the ground in plan colours (pale green, pale blue water, near-white streets), the trees as folded card |
| *Schwarzplan* ("figure-ground plan") | the buildings black, everything else white, the street-tree register's trees as crown circles with a stem dot (measured, so only those) — no shadows, no lines; made for the *Lageplan*, usable everywhere |

In the graphic styles *Comic*, *Sin City*, *Strich* and *Schwarzplan* the
depth of field rests (a blurred background under crisp lines reads as a
mistake).

| Group | Slider | What it does |
|---|---|---|
| Atmosphäre | *Nebel* | distance haze |
| | *Talnebel* | extra haze pooling in the low ground along the river; reads the real terrain height and sets in some way off, so what stands right in front of you stays clear |
| | *Tiefenfärbung* | warm near, cool far: a depth-based colour grade |
| Gebäude | *Boden-Verlauf* | darkening of walls towards the ground |
| | *Höhenlinien* | faint storey bands, spaced from the measured height |
| | *Streiflicht* | rim light on edges facing away from the sun |
| | *Farbvariation* | per-building wall tint from function and height |
| | *Dachfarbe* | how strongly the real (or synthesised) roof colour shows |
| | *Dachsättigung* | lifts the saturation of the aerial-photo roof colours without shifting their hue; 0 = raw photo |
| | *Traufkante* | a soft line where wall meets roof |
| | *Gliederung* | what a house shows at eye level, painted: a darker shop zone where a shop is mapped. The plinth, the ledge over the ground floor and the eave cornice are modelled, run on from house to house and are always there |
| | *Fenster* | rows of windows on every house, drawn into the wall: an opening you look into, its reveals in the wall's plaster, its back darker and cooler, a slim sill with its shadow — no glass, no panes, no mullions. Spacing and size where street photos measured the house (Dresden), else the nearest measured house's of the same kind, else its type's; one row per storey, the windows as tall as the storey allows, the ground floor's above the plinth, the top floor's under the eave cornice; a town house's ground floor a little raised, its windows with a surround. None on party walls, beside doors, over shop fronts, on churches, palaces and halls. From a distance they fade into the facade's tone |
| | *Fassadenbild* | what street photos (Mapillary) say about a facade, abstracted: a fine relief where it is busy, a ledge at every storey of a busy period front, a slightly darker or lighter tone, a shop plinth where a shop sign hangs; where panoramas show the front (every city but Unna, which has none) |
| | *Abendlicht* | warm windows in shops and public buildings at dusk |
| | *Materialstreuung* | matte-to-silky variation between buildings |
| Vegetation | *Bodendetail* | kerbs, lawn edges, parking bays, road markings (crossings, stop, cycle and centre lines), the gardens of allotment colonies and the paving underfoot (asphalt, slabs, cobbles from OpenStreetMap), the mown stripes and grain of sports grounds, visible up close |
| | *Stadtgrün* | paints green courtyards, front gardens and parks inside built-up areas like meadow, from the infrared aerial photo |
| | *Wiesenfärbung* | tints meadows lush-to-dry from the infrared aerial photo |
| | *Gegenlicht-Schimmer* | backlight shimmer on crowns between you and the sun |
| | *Blattdurchscheinen* | translucency of nearby, large crowns (shadow-dependent) |
| | *Multi-Tuft-Kronen (nah)* (switch) | rich multi-tuft crowns near the camera; off = the cheap crown everywhere |
| Rendering | *Kontaktschatten* | ambient-occlusion contact shadows in corners and under eaves |
| | *Himmelslicht* | narrow courtyards and street canyons get less skylight than open meadows — precomputed from the terrain and the building model |
| | *Ferne Schatten* | shadows beyond the ordinary shadow range: the long shadows of distant buildings and slopes at a low sun, and in the distance the shadows of the buildings next door too |
| | *Spiegelung* | the sky mirrored in glass facades, gilding and water; the sky only, not the buildings across the street |
| | *Papierkorn* | the paper grain over the whole image (running film grain in *Film noir* and *Sin City*) |
| | *Tuschelinien* | how strong the outlines are in *Comic*, *Film noir*, *Sin City*, *Papier* and *Strich* |

Two effects have no control at all. The mist over the river drifts over
the water from about 120 m ahead, denser only far off. The photographic
depth of field blurs only what lies behind the focus (the foreground stays
sharp), and the focus is always what lies at the centre of the view. While
the camera moves, the blur is switched off (the eye cannot resolve it in
motion) and comes back when you stop. Phones draw without it: the blur
needs more graphics memory than a phone can spare for a hint a small
screen barely shows.

### Erweitert ("Advanced")

- **Werkzeuge** — *Gebäude in der Bildmitte abreißen* demolishes the
  building you are looking at (`R` the one under the pointer), on any tile in view; it is
  not undoable. *Bild speichern* saves the view as a PNG with its sources
  (see [Modell](#modell-the-city-as-a-planner-draws-it)). *Immersiver Modus* locks the mouse pointer
  for a first-person feel; `Esc` leaves it.
- **Snapshot** — *Kopieren* copies your exact position, the date and time,
  the picture style and every slider as a small JSON text; paste such a text into the box and
  press *Anwenden* to restore it. This is how a specific view is shared or
  reproduced for a screenshot. A malformed snapshot is rejected with a
  message instead of breaking the scene.
- **Statistik** — number of buildings and terrain points currently in
  view, estimated graphics memory and the frame rate.

The footer credits the data sources: the Land's survey office (in
Dresden the Saxon one) for the official datasets and OpenStreetMap
contributors for, among others, lamps, walls and fences, platforms, bridge
structures, shops and listed buildings (and the land cover where the Land
publishes no Basis-DLM). Next to it, *Unterstützen* (support) leads to the
project's Ko-fi page; it is a plain link that loads nothing from Ko-fi
until it is clicked.

## Tips

- Judge the picture from **oblique angles**, not straight down; that is
  also how the maintainers check it.
- Golden hour (sun a few degrees above the horizon) and blue hour (a few
  degrees below) give the richest colours; try 07:00 or 20:00 in summer.
- On a laptop without a discrete graphics card, lower *Kontaktschatten*
  for a higher frame rate.
- `?scene=lite` after the city's address (`/dresden?scene=lite`) streams
  only the start tile, with coarse shadows. It exists for automated tests
  and is not how the scene is meant to look.

## When it crashes

A phone can end the page when the city takes more memory than it allows;
the page then simply disappears or reloads. On the next visit a card says
the last session ended unexpectedly and shows its record: what had loaded,
the frame rate and the memory in its last seconds.

If the graphics fail — a phone takes the graphics memory away from the
browser —, the viewer rebuilds itself where you stood, **a step
lighter**: a slightly softer image, coarser ground in the distance, fewer
parts of the city kept in memory, and from the second step without the
picture style or *Modell* you were in. It remembers this for your device
(a crash that ended the last visit counts too) and returns to full detail
by itself after a few days, one step every three days. If the graphics
fail again at the lightest step, a card says *Die Grafik ist
ausgefallen* ("the graphics failed") and offers *Leichter weiter* ("go on
lighter": a step lighter, back where you stood) and *Neu laden*
("reload"). A phone may also take the graphics away from a page that sat
in the background for a while; then the viewer simply reloads at the same
step.

**When the connection drops**, the viewer keeps trying by itself: parts
of the city that could not load are missing or only coarse for the
moment, a short note at the top says *Keine Verbindung zum Server — ein
Teil der Stadt fehlt, neuer Versuch folgt.* ("no connection to the
server — part of the city is missing, trying again"), and the gaps close
once the connection is back. A start without a connection keeps
waiting while your device is offline; if the server still does not
answer once it is online again, the viewer says after a while (20
seconds to a minute) *Keine Verbindung zum Server* and offers *Erneut
versuchen* ("try again").

Where this site is set up for it, that record also goes out on its own, to
an error tracker (Sentry), together with errors the viewer runs into and,
for every visit, a few numbers about how it ran: how long until the first
picture and until everything had loaded, the frame rate, the most memory
used, and whether it ended normally or in a crash. That is how the slow and the crashing phones become visible. A
report holds the browser and device type, the screen size, which city
(without the rest of the address), the step the viewer runs at on your
device and these numbers — never your location
or where in the city you were, no name, no IP address and no cookie. If
your browser sends *Global Privacy Control*, nothing is sent, and the
switch on the privacy page (*Datenschutz*, linked at the
foot of every page and of the sidebar) turns the reports off for your
browser at once. That page also says who runs the site, where the reports
are kept and for how long. Without the tracker set up, the card offers the
record to copy instead.

## Small things

- **Listen.** Press **L** (or, on a phone, turn on *Klang (experimentell)*
  at the very bottom of *Erweitert*) and the city makes a quiet sound: wind,
  the Elbe, birds by day and crickets on summer nights, footsteps that
  know the paving underfoot — and when you move the clock past a full
  hour, the nearby churches strike it, each a little later the further
  away it stands, as sound travels. It is off every time the page loads,
  goes quiet in a background tab, and the small speaker in the top left
  corner turns it off again.
