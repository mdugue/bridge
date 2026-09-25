# How the city walker works

*Deutsch: [So funktioniert der Stadtspaziergang](../de/how-it-works.md)*

This page explains, without assuming any background in geodata or 3D
graphics, what you are looking at when you open the viewer, where it all
comes from, and how much of it is "real". Terms in **bold** are explained in
the [glossary](./glossary.md).

## What you see

A stylised, walkable 3D model of the centre of Dresden: a square of
4 km × 4 km on both banks of the Elbe, with the historic Altstadt in the
south-west, the Inner and Outer Neustadt in the north and the Johannstadt
in the south-east. You start low over the Elbe near the Carolabrücke,
looking at the Altstadt skyline, and can walk at street level or fly above
the roofs.

Nothing is installed, nothing is stored about you, and no server computes
the picture. Your browser downloads prepared files as you move — about
4 MB for the tile you start on, up to about 17 MB if you visit every
corner — and your own graphics card draws every frame, using a library
called **three.js**.

The look is deliberately not photo-realistic. It is a soft, pastel,
"watercolour on paper" rendering: buildings are matte clay volumes, the
ground is coloured by land use rather than textured with aerial photos, and
a faint paper grain lies over the whole image. That is an artistic choice,
documented in the [art-direction notes](../../transformations.md).

## The one-picture summary

```mermaid
flowchart LR
  A["Open geodata<br/>(Saxony + OpenStreetMap)"] --> B["Prepared once, offline<br/>by the maintainer"]
  B --> C["Small per-tile files<br/>stored in the repository"]
  C --> D["Packaged at build time<br/>(3D Tiles, hashed file names)"]
  D --> E["Your browser<br/>streams what the camera sees"]
  E --> F["Your graphics card<br/>draws the city"]
```

Every station in this picture is described in
[From download to browser](./data-journey.md); the datasets themselves in
[Where the data comes from](./data-sources.md).

## What the scene is made of

The scene is built from layers. Each layer comes from one or two datasets,
and each is a mix of measured fact and deliberate simplification.

| Layer | What it shows | Where it comes from | Real or stylised? |
|---|---|---|---|
| **Ground** | The shape of the terrain: river banks, the slope up to the Neustadt, embankments | The official 1 m terrain model (**DGM1**) | Real heights, on a grid of about 2 m near you and 4 m further away. Vertical walls and stairs are smoothed into ramps by the source, so the project sharpens them again where OpenStreetMap knows a wall, a cliff edge or a flight of steps |
| **Ground colours** | Roads grey, paths sand, meadows sage, forest moss, built-up areas pale clay, water blue | The official land-use map (**Basis-DLM**), squares refined from **OpenStreetMap** | Real classification; the colours are a designed pastel palette, painted in your browser, not photographs |
| **Kerbs and paving** | A kerb line where the road meets the pavement; asphalt, paving slabs, cobbles or gravel underfoot; painted parking bays along streets and in car parks; green courtyards | Road edges from the **Basis-DLM**, the material and the parking from **OpenStreetMap** (`surface`, `parking`), the green from the infrared aerial photo (**NDVI**) | The kerb stone (a low 12 cm step, casting its shadow) follows the surveyed road width; the material is what volunteers mapped (about two thirds of the streets), the rest shows asphalt or slabs by default; the patterns themselves are drawn, not photographed, and the pavement behind the kerb stays at road level |
| **Sports grounds** | Football pitches in mown stripes, clay tennis courts, tartan running tracks with their lanes, basketball courts, beach-volleyball sand — each with its lines, goals, basketball posts and nets | **OpenStreetMap** (`leisure=pitch`, `leisure=track`, with `sport` and `surface`) | The outline, sport and surface are what volunteers mapped; without a surface the sport's usual one is shown (football on grass, tennis on clay). The lines are the standard ones, scaled to the mapped size, not surveyed; goals and nets are simple stand-ins, not the real ones |
| **Water** | The Elbe and smaller water bodies, with a gently moving surface and drifting mist | Basis-DLM water areas, laid on the real terrain | Real outline, invented ripples |
| **Buildings** | Every building with its real footprint, height and roof shape | The official 3D building model (**LoD2**), roughly 16,000 buildings and building parts in the four tiles | Real geometry. Facades are plain by design; there are no windows in the source data |
| **Building colours** | Roof colours; a subtle tint per building; a warm glow in shops and public buildings at dusk; single lit windows at night | Roof colour sampled from aerial photos (**DOP**); the rest derived from building attributes | Roof colours are real (about 83 % coverage), wall tints are synthesised |
| **Trees and hedges** | Individual trees with crowns of the measured height; hedges and tree rows | Tree positions and heights from the difference between the surface model (**DOM1**) and the terrain model; rows from Basis-DLM; greenness from the infrared aerial photo (**NDVI**) | Positions and heights are measured; the crown shape is generic, the species unknown |
| **Street lamps** | Lamp posts along streets and squares | **OpenStreetMap** | Real positions, default height |
| **Street furniture** | Benches, picnic tables, litter bins, bicycle stands, bollards, post boxes and stop shelters | **OpenStreetMap**; which way a bench faces from its tagged direction, else from the nearest path or street | Real positions (a bollard at its tagged height); one soft, abstracted model per kind in the scene's pastels — like the pieces of an architect's model. Few benches say which way they look, so most are turned towards the nearest way — a guess that is usually, not always, right |
| **Playgrounds** | The playground's area as a pale sand floor, with its swings, slides, climbing frames, sandpits and seesaws as soft, single-coloured pastel sculptures | **OpenStreetMap** (the outline and each piece of equipment mapped on it) | Real outline and positions; only the equipment that is mapped stands there — many playgrounds are mapped without it and stay empty rather than being filled with invented pieces |
| **Fountains and monuments** | Fountain basins with still water and translucent water bells; statues, memorial stones and columns | Positions and official names from the Basis-DLM; basin outlines and the smaller fountains from OpenStreetMap; the sculpture's form from the surface model (**DOM1**) | Real positions and outlines. A sculpture is its measured bulk, softened into clay — the right size and silhouette, no detail; where nothing could be measured, an abstract marker. The water bells, their gentle motion and the night lighting are designed. Both surveys were flown while the fountains were drained and their sculptures boxed for winter, so the measured bulk at the Albertplatz is the winter housing |
| **Railways and bridges** | Tracks, ballast beds, bridge decks with arches or piers, station platforms | Basis-DLM (tracks, bridges), terrain and surface models (deck heights), OpenStreetMap (platforms, whether a bridge is an arch bridge) | Real alignment and deck heights; the structural detail is simplified |
| **Walls** | The Brühlsche Terrasse and other retaining walls and city walls, cliff edges | OpenStreetMap lines with their tagged heights | Real position, tagged or default height |
| **Stairs** | Flights of steps such as the one beside the Italienisches Dörfchen or the one from the Schlossplatz up to the Brühlsche Terrasse, as individual steps | OpenStreetMap (`highway=steps`: position, width, step count; without a width a flight spans wall to wall when the slope between climbs); the heights at the foot and the head from the terrain model | Real position and height; step count as tagged or estimated from the height (16 cm a step). The Brühlsche Terrasse stands on casemates and is missing from the terrain model; there the tagged steps set the height, and the terrace area from OpenStreetMap is lifted to it |
| **Sun, shadows and sky** | Sunlight for any date and time of day; blue hour, golden hour, night | Computed from the calendar, the clock and Dresden's latitude | Astronomically correct sun position; the colours are designed |
| **Atmosphere** | Distance haze, valley fog in the low ground, river mist, depth tint, paper grain | Computed in the browser; the valley fog reads the real terrain height | Artistic |

## How a visit unfolds

The scene is not loaded all at once, and it never has to be loaded
completely. The city is cut into 2 km tiles, and the viewer **streams**
them: it fetches what the camera can see, in detail near you and coarser
further away, and can let go of what you have left far behind. The first
picture needs only the tile you start on; the loading screen shows the
rest arriving:

```mermaid
flowchart LR
  subgraph P1["Phase 1 — until the scene is walkable"]
    direction LR
    a["Buildings of your tile"] --> b["Terrain of your tile"] --> c["Sun and shadows"]
  end
  subgraph P2["Phase 2 — streamed while you already walk"]
    direction LR
    d["Trees, lamps, rails and walls<br/>of your tile"] --> e["The tiles around you<br/>detailed near, coarse far"]
  end
  P1 --> P2
```

Phase 1 ends when the loading screen says *begehbar* ("walkable"): the
overlay dissolves and you can move. Phase 2 continues in the background; a
small pill at the top of the screen counts the stages as they arrive.
Until everything around you is in, the horizon is deliberately hazy so the
missing tiles do not read as a cliff edge. After that the streaming simply
goes on as you move: a distant tile shows its buildings on coarse ground,
and gets its trees, lamps, rails and walls once you are close enough for
the detailed ground.

## What is real, what is not

**Measured, from official surveys:** terrain heights, building footprints,
heights and roof shapes, land use, water outlines, railway alignments,
bridge positions and deck heights, tree positions and heights, roof colours,
meadow greenness.

**Contributed by volunteers (OpenStreetMap):** street lamps, benches and
other street furniture, playgrounds, station platforms, retaining walls
with their heights, the structural type of bridges, what streets and
pavements are paved with. Completeness varies from street to street.

**Computed:** the sun position, all shadows, fog and haze, the depth of
field, the slow motion of leaves and water.

**Invented for the look:** the pastel palette, the paper grain and vignette,
the shape of tree crowns, the wall tint per building, the ripples on the
water, the stones and slabs of the paving patterns, the warm windows at dusk (the *presence* of a shop or public building
is real; its lit windows are not), and the lit windows at night (the storeys
are derived from the building's height, the windows are placed by chance).

**Not in the data at all:** windows and doors, facade materials, the
smaller street furniture (planters, bus-stop poles; traffic and street-name
signs are mapped too sparsely to show), vehicles, people, vegetation
smaller than about 3 m, and anything indoors.

## Things worth knowing before you draw conclusions from the picture

- The datasets have **different dates**. The terrain was surveyed in late
  2024, the building model was generated in spring and summer 2025, the
  land-use map and the aerial photos have their own editions. A house that
  is new in one dataset may be missing in another. See the edition table in
  [Where the data comes from](./data-sources.md#dataset-editions-in-use).
- A tile is a 2 km square. At the **seams** between tiles a small step or a
  colour change can show, and tiles further away are drawn with coarser
  ground and without trees, lamps, rails or walls until you come closer.
- Aerial photos look slightly **sideways** at tall buildings, so a sampled
  roof colour can include a bit of facade. The sampling avoids the edge of
  each roof to reduce this.
- Tree **species** are unknown; every tree is the same generic shape, scaled
  to its measured height and tinted by how green it looked from the air.
- The building model contains **no bridges, walls or towers** for these
  tiles even though newer editions of the product may; that is why bridges
  and walls are rebuilt from other sources.

## Where to go next

- [Where the data comes from](./data-sources.md) — every dataset, where it
  was downloaded, what it is good at and what it is not, the licences.
- [From download to browser](./data-journey.md) — the stations of the data,
  what is the single source of truth, what is a derivative, what your
  browser actually receives.
- [Using the viewer](./using-the-viewer.md) — controls and the settings
  panel, explained label by label (the interface is in German).
- [Glossary](./glossary.md) — the abbreviations.
- For developers: [docs/README.md](../../README.md).
