# How the viewer comes by what it shows

*Deutsch: [Wie der Viewer zu einer Angabe kommt](../de/methods.md)*

Everything in the viewer comes from open data, but not everything is in
the data as it is shown. Some of it is taken over unchanged, some worked
out with a formula, some only found by pattern recognition, and some the
viewer assumes because nothing at all is known of the thing. This page
explains the four badges the viewer marks that with: in the detail view of
a building, tree or bridge (under *Daten*) and here in the knowledge base.

## The four badges

| Badge | Meaning | Example |
|---|---|---|
| `❝ taken` | As the source publishes it, shown unchanged. | Footprint and eave height from the 3D building model, a tree's species from the street-tree register, an address from OpenStreetMap |
| `= computed` | By a fixed formula over measured values. The same data always give the same result. | A crown's height as surface minus ground, a meadow's green from the aerial photo's infrared band, a roof's colour as the median of its pixels |
| `◎ detected` | By pattern recognition: thresholds, matching two sources or image analysis. It can be wrong. | A tree where the surface shows a crown's peak; a shed the laser scan sees; a shop whose point is assigned to a building |
| `≈ assumed` | Nothing is known of this thing: a default, an average or a design choice. | The shape of a crown, brick or plaster as in the neighbourhood, the traffic at the scene's hour from the typical day |

The first two are **deterministic** and have a solid border: whoever takes
the same data comes to the same result, and the result is as good as the
measurement. The last two are **inferred** and have a dashed border: a rule,
a match or a design decision has added something that is not measured. The
glyph before the word (❝, =, ◎, ≈) tells the four apart without colour.

In the detail view the badges stand at every line under *Daten*. The facts
at the top of the card (height, roof, ground floor …) carry a small ◎ or ≈
after the value only where it is inferred; a value without a mark is taken
or computed.

## What pattern recognition means here

No part of the viewer is a trained neural network. "Detected" here almost
always means: a rule with thresholds decides *what* something is, or two
sources are matched against each other. The rules are open and
reproducible, but they can be wrong where the world does not fit the rule.

- **Trees without a register:** in wood, copse and park the highest point of
  the surface between 3 and 45 m above the ground becomes a tree, one per
  cell of about 7 m. A bridge pylon in a park would be as tall as a crown,
  so bridges are left out.
- **Small buildings:** what stands 2–6.5 m high in the laser scan, outside
  the 3D building model, and sends back a single echo per light pulse
  (foliage splits a pulse, a roof does not) becomes a shed or a garden
  house.
- **Roofs, chimneys, towers, dormers:** where the surface model misses the
  building model's roof by more than 2 m on at least 40 % of the roof, the
  viewer rebuilds the roof from the measurement. A height above the building
  model becomes a chimney or tower only where OpenStreetMap names one.
- **Bridge superstructure:** what stands at least 3 m above the deck along
  the bridge's axis, for at least 25 m, becomes an arch or a truss.
- **Assignments:** a shop from OpenStreetMap belongs to the building whose
  footprint holds its point, else to the nearest within a few metres; a
  landmark from Wikidata to the building parts its outline covers.
- **Someone else's recognition:** lamps and litter bins Mapillary found in
  street photos were detected there by Mapillary's own image recognition —
  trained networks whose hits the viewer takes over.

## How sure is a detection?

Where a rule was checked against an independent source, the result stands
with the dataset in [Where the data comes from](./data-sources.md). Two
examples of what the numbers do: about a third of the hedges and shrubs
only the laser scan finds were the rims of tree crowns, so the viewer does
not show them. And Munich's aerial photos have no infrared band; the green
from the visible colours agrees only moderately with the real vegetation
index (r ≈ 0.7), which is why Munich is yellow there in
[Sources by city](./sources-by-city.md).

## Everything at a glance

| What is drawn | From | How |
|---|---|---|
| Ground heights | Terrain model DGM1 | `❝ taken` |
| The ground as a triangle mesh, to 15 cm | Terrain model DGM1 | `= computed` |
| Walls and steps, sharpened in the ground | DGM1 and OpenStreetMap | `◎ detected` |
| What an area is (road, water, meadow …) | Basis-DLM (Hamburg, Berlin: OpenStreetMap) | `❝ taken` |
| The colour per area | a palette of the viewer's | `≈ assumed` |
| Green of meadows and foliage | aerial photo, infrared (Munich: visible colours) | `= computed` |
| Footprint, height and roof shape of buildings | 3D building model LoD2 | `❝ taken` |
| Roofs where the model misses them | Surface model DOM1 | `◎ detected` |
| Chimneys, towers, newer buildings, dormers | DOM1, confirmed by OpenStreetMap | `◎ detected` |
| Sheds and garden houses | Laser scan | `◎ detected` |
| Roof colour | Aerial photo | `= computed` |
| Facade colour and material, where mapped | OpenStreetMap | `❝ taken` |
| Brick or plaster where nothing is mapped | OpenStreetMap, the neighbourhood | `≈ assumed` |
| Tint per building, storey bands | the viewer | `≈ assumed` |
| Front doors | OpenStreetMap, the entrances | `❝ taken` |
| Shop or restaurant on the ground floor | OpenStreetMap, assigned to the building | `◎ detected` |
| Landmarks | Wikidata, assigned to the building parts | `◎ detected` |
| Street trees: place, species, size | Street-tree register | `❝ taken` |
| Trees without a register: place | DOM1 or laser scan | `◎ detected` |
| Trees without a register: height | DOM1 or laser scan | `= computed` |
| Crown shape, leaf-out, autumn colour | the viewer, per genus | `≈ assumed` |
| Hedges: course | Basis-DLM or OpenStreetMap | `❝ taken` |
| Hedges: height | Laser scan (without one: a default) | `= computed` `≈ assumed` |
| Bridges: outline and kind | Basis-DLM (Hamburg, Berlin: OpenStreetMap) | `❝ taken` |
| Bridges: height of the roadway | DOM1 | `= computed` |
| Bridges: arch or truss above the deck | DOM1 | `◎ detected` |
| Bridges: piers | the viewer, clear of the fairway | `≈ assumed` |
| Tracks and their course | Basis-DLM or OpenStreetMap | `❝ taken` |
| Which level a track runs on (ground, deck, cut) | from ground and decks along the whole line | `◎ detected` |
| Lamps, benches, street furniture: place | OpenStreetMap | `❝ taken` |
| Lamps and bins from street photos | Mapillary | `◎ detected` |
| Their form; where a bench without a direction faces | the viewer | `≈ assumed` |
| Monuments: place and name | Basis-DLM, OpenStreetMap | `❝ taken` |
| Monuments: form, where measured | DOM1 | `= computed` |
| Sports grounds: outline, sport, surface | OpenStreetMap | `❝ taken` |
| Their lines | the sport's standard dimensions | `≈ assumed` |
| Allotment plots, orchard trees without an entry | the viewer | `≈ assumed` |
| Water outline | Basis-DLM | `❝ taken` |
| Waves, fog, haze, paper grain | the viewer | `≈ assumed` |
| Sky light and horizon | Terrain and building model | `= computed` |
| Sun position and shadows at the scene's time | the viewer | `= computed` |
| Data layer motor traffic: daily counts | Traffic counts | `❝ taken` |
| Data layer motor traffic: value at the hour | the typical day | `≈ assumed` |
| Data layers cycling, trams | live counters, timetable | `❝ taken` |

The developer documentation carries the same badges on every entry of the
[transformation catalogue](../../transformations.md).

## What the badges do not say

A badge describes what **the viewer** does with the data, not how the
source itself was made. The 3D building model is partly modelled
automatically by the survey office from laser scan and footprints;
OpenStreetMap is mapped by volunteers and is as complete as the street
someone mapped. How good a source itself is, [Where the data comes
from](./data-sources.md) and [Sources by city](./sources-by-city.md)
describe. And what is taken can still be out of date: the datasets have
different editions, which the detail view names at every line.
