# ADR 0040: Traffic is shown as switchable data layers, and one of them is read live from the city

- **Status:** accepted
- **Date:** 2026-10

## Context

The maintainer asked to show traffic over the city — how dense the
motor traffic is, how many people cycle and walk — and to be able to show
and hide each of these. Three open sources fit the site (checked
2026-10-01): the city's counted motor traffic per road section (WFS
`cls:L363`, a daily mean per direction), the city's permanent bicycle
counters (WFS `cls:L1781`, the last hour per direction, updated hourly),
and the DVB's tram timetable (gtfs.de's GTFS from DELFI). There is no open
measured source for pedestrians on the site.

Two things about them are new for the viewer. They are *measurements laid
over* the poetic city rather than part of its look; nothing so far was
optional in that sense except the hidden soundscape. And the bicycle
counts are only worth showing live — a baked copy is an hour old by the
time it is committed — while the viewer has so far fetched nothing at
runtime but its own files under `/data` ([ADR 0001](./0001-client-only-static-app.md)).

## Decision

**Each source is a data layer with a switch of its own**, declared once in
`lib/city/data-layers.ts` (label, explanation, credit) and held as one
boolean per layer in the look store (`trafficLayer`, `bikeLayer`,
`tramLayer`), so the snapshot carries them and the HUD renders the
switches from the table (*Erkunden* → *Verkehrsdaten*). Every layer starts
**off**; the look reset leaves them as they are. A layer that is off
draws nothing and polls nothing. What a layer says in words (the counts,
the number of trams) is in the sidebar, never as text in the scene.

- **Motor traffic** is baked per tile like any other side file
  (`pipeline/bake/traffic.py` → `traffic_<tile>.geojson`) and built with the
  tile's dressing, hidden until switched on (37 KB a tile; building it
  late would put a node build inside a frame). Unlike every other
  dressing it is built on **both terrain levels** — coarser on the coarse
  one (`coarse` in its extras) — because a layer read from the air must
  not end at the first tile the fine level has not loaded.
- **The bicycle counters are read by the browser from the city's server**
  when the layer is switched on and every five minutes while it is on
  (the service answers any origin). Nothing is fetched until the visitor
  asks for it — the same stance as the Ko-fi link, which loads nothing from
  there until clicked — and a failed read keeps the last counts. The e2e
  spec answers for the city's server, so CI never depends on it.
- **The trams run from the timetable**, baked once for the whole site
  (`pipeline/bake/transit.py` → `data/transit/trams.json`, named in the
  tileset's extras) and placed every frame at the scene's clock, which runs
  on in real time from the HUD's instant. They are not live positions, and
  the HUD says so.

The layers are site-wide where their data is (the counters, the trams:
`data-overlays.ts`, owned by `create-app.ts`) and per tile where it is
(the traffic bands: dressing parts in `tile-stream.ts`). None casts a
shadow: the flows and columns are data marks, and the trams move every frame — a
moving caster would redraw the sun's shadow map in each one
([ADR 0020](./0020-fixed-light-pool-and-static-shadow-casters.md)). From
the air their geometry widens with one shared uniform
(`map-overlay.ts` `mapWidenNode`), never a rebuild.

**The look: tinted glass and light, not paint.** A layer has to be
plain to read and still belong to the clay-and-paper city. The bodies
(the traffic flows, the bicycle columns) are glass in one colour family
per layer (sage → peach → coral → rose → wine over five stops placed
where the counts spread, teal and lilac; the trams keep the DVB's
yellow), refracting what lies behind them, and light moves through
them (comets with the traffic, rings rising with the bicycles, a trail
behind each tram — after deck.gl's TripsLayer). The refraction is one
copy of the frame (`glass.ts`): the scene target is copied when the
first glass draws — after every opaque object, so the copy holds the
city — and each body samples it through its own bent normal. That is
not `transmission`, which renders the scene again for the glass
([ADR 0010](./0010-opaque-clay-buildings-only.md)); it costs one
texture copy the size of the scene target per frame, and nothing while
no layer is on. Glass does not see glass (the copy is taken before the
first one). From the air and far off the glass thickens into its own
colour, so the layers read as a map there.

## Consequences

- ADR 0001 still holds — no backend, nothing persisted, every computation
  in the browser — but the viewer is no longer self-contained once the
  bicycle layer is on: it depends on `kommisdd.dresden.de` being up and
  answering cross-origin requests. If either changes, the layer shows
  nothing new and keeps the last counts; the rest of the scene is
  untouched.
- A new data layer is a row in the table, a flag the scene reads, a
  credit and a swatch (`data-layer-swatch.tsx`: a moving sample in the
  layer's own colours, the bridge from the switch to the picture) — the
  HUD, the snapshot and the reset follow.
- The trams' timetable ages: the feed covers about a month, the committed
  file three dates in it. The viewer runs a date by its kind (working day,
  Saturday, Sunday), so an old file still runs plausibly; re-bake with
  `bun run bake --ingest --step transit` to follow a timetable change.
- The visual tuning (body sizes, glass density, colours, column heights,
  tram size, trail length) was judged on SwiftShader plates only; it
  wants a real-GPU look. Papier hides transparent sheets for its frames,
  so the glass layers do not show under that picture style (the tram
  cars do, as paper).

## Alternatives

- **Bake the bicycle counts.** An hour old at best, a week at worst; the
  live counts are the point. Rejected. (The hourly history since 2017,
  `cls:L1780`, could still be baked into a typical day per counter: 📋 in
  the ledger.)
- **A proxy route for the city's WFS.** A backend for one GET the browser
  can make itself ([ADR 0001](./0001-client-only-static-app.md)). Rejected
  while the service answers cross-origin.
- **Live tram positions** (gtfs.de's GTFS-RT, one protobuf for all of
  Germany; the TLMS volunteers' radio-telegram socket). Too heavy for a
  browser to poll, or a service whose uptime the viewer cannot vouch for
  (🗃️ in the ledger). Delays from the VVO's departure monitor per stop are
  the planned next step.
- **Pedestrian density from a model** (stops, shops, census cells). A model
  drawn as if measured; rejected. The only pedestrian counter on the site
  (hystreet, Prager Straße) is commercial.
- **`transmission` glass** (`MeshPhysicalMaterial`): a second scene
  render per frame for the glass alone — what ADR 0010 dropped the ghost
  buildings for. The one frame copy gives the same bent, tinted view for
  a texture copy.
- **Flat painted bands** (the first cut): legible from the air, but on
  foot a stripe of paint on the road, and they fought the road markings
  and the pastel ground. Replaced by the glass bodies.
- **Data layers as look sliders.** A slider at 0 still builds and draws;
  a switch can keep a layer from fetching at all.

## References

- `lib/city/data-layers.ts`, `app/_components/data-layers-panel.tsx`,
  `app/_components/data-overlays.ts`
- `pipeline/bake/traffic.py`, `app/_components/traffic-layer.ts`,
  `lib/city/traffic.ts`
- `lib/city/bike-counts.ts`, `app/_components/bike-layer.ts`
- `pipeline/bake/transit.py`, `lib/city/tram-timetable.ts`,
  `app/_components/tram-cars.ts`
- [transformations.md](../transformations.md) — *Traffic (the data
  layers)*; the 🗃️ rows on pedestrian counts and live tram positions

**Counts per day, shown per hour.** The city counts motor traffic per
day; the scene has a clock. Rather than a static daily picture, each
street's count is spread over the day on one measured curve — Hamburg's
inner-city counters (hourly, open), per working day, Saturday and Sunday
(`lib/city/traffic-hours.ts`) — and the flows' colour, size and light
follow the hour through two shared uniforms. It is a typical shape, not
a measurement of the street, and the sidebar says so. Live detector
counts exist for some cities (Hamburg, Berlin's archive); a city that
publishes per-hour counts per street would replace the curve there, not
sit beside it.

**Every site its own sources, and only the layers it has.** A site names
the source of each layer in its config (`Site.dataLayers`): the
traffic-count source (`pipeline/bake/traffic_sources.py` — a city's own
counts, or a Land's road census), the live bicycle feed
(`lib/city/bike-feeds.ts`), whether it runs timetable trams (and whose).
The HUD offers only the switches a site has a source for, rather than a
switch that would draw nothing; the "sources by city" page marks the
gaps and why. Where a source counts both directions together — every one
so far but Dresden's — the total is split evenly between them and the
HUD says so: one picture for every city, honest about what it knows. A
source is adopted only when it is open, machine-readable and reaches the
site's tiles; a feed is "live" only when the browser can read it as it
is updated (Leipzig's daily, Munich's monthly counts are not offered as
live).
