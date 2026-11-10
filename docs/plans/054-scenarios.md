# Plan 054: Scenarios — what-if studies drawn in the scene's own hand

> **Executor instructions**: Read fully first. A scenario is a *tool*: the
> visitor turns it on, it answers a question about the city, and it is
> drawn in the watercolour/contour language (washes, hatching, contour
> lines) — never a rainbow heat map, never text in the scene (ADR 0042;
> numbers go into the inquiry card or the sidebar). Each phase is
> independent. Judge every overlay on a real GPU (`bun run shots`,
> headed) before it ships. The scene is node materials since the WebGPU
> port (ADR 0027): every overlay is a TSL node on the terrain's or the
> clay's graph, driven by shared uniform nodes (no rebuild per change).

## Status

- **Priority**: P2
- **Effort**: L (four phases, S–M each)
- **Risk**: MED — new terms in the shared terrain and clay node graphs
- **Planned at**: 2026-09-27
- **Status**: **TODO**

## Phases

### 1. Flood (M) — the Elbe at a chosen level

A slider *Pegel Dresden* (the gauge's scale, cm) with marks at the
August 2002 crest (940 cm) and June 2013 (878 cm); the gauge's zero
(Pegelnullpunkt) comes from Pegelonline's station metadata and is recorded
in the site config. Everything of the DGM below the level (and hydraulically
connected to the river — a flood-fill on the coarse terrain grid, baked
per level step or computed on the CPU once per slider release) is drawn
as the water sheet in a flood tint; the flood edge gets a contour line.
Buildings standing in it get their ground-floor band tinted. This is a
static fill, not a hydraulic model — the card says so.

### 2. Sun hours (M) — Besonnung for a date

From the baked horizon map (ADR 0009, plan 033): per ground texel, the
hours of direct sun on the chosen date, sampled at 15 min steps against
the eight horizon directions. Drawn as a hatch density (more hatch = more
shade) or a warm wash, on the terrain only (facades need CSM). A CPU pass
per tile on demand (≈ 1 s), cached per date.

### 3. Sight lines (M) — what you see from here

A viewshed from the camera over the DGM + building heights (a ray march
over the coarse terrain and the footprints), drawn as a light wash on the
visible ground and a hatch on the hidden. Named views as presets (the
Canaletto view from the Neustadt bank to the Altstadt).

### 4. A planned building (M) — and undo for demolish

Demolish exists; undo is a stack of removed object ids plus the per-tile
index rebuild. A placed glTF (a planned building, dropped at a spot, its
height from a slider) in clay with the pencil hatch, casting shadows —
together with phase 2 it answers "whose sun does it take?". The inserted
building removed with ADR 0037 is the history; the transformations ledger
names this use as its revival condition.

## Not in scope

- Noise, heat and air-quality maps: the city's data (Umweltatlas) is
  worth a look, but each needs its own licence check and a look decision.

## Spikes (2026-11-03)

The maintainer asked to try the simulation concept before building it
(thread "Simulationen im digitalen Zwilling konzipieren": a study is a
question answered by typed values over a set of places, its recipe in the
link). Two throwaway spikes, flood first:

- **Phase 1, offline (not in the repo).** The lowest Dresden gauge reading
  at which each 2 m cell is wet *and* connected to the Elbe (DGM1, 2 × 2
  maximum so narrow dykes stay; a morphological reconstruction from the
  river; 80 s on one core), against the official extents: 2013 (878 cm,
  city of Dresden, WFS `cls:L836`) recall 0.96, precision 0.79, IoU 0.76 —
  a plain level fill (no connection) only 0.59; 2002 (940 cm, LfULG) recall
  0.60, the 3.9 km² missed being the Weißeritz. What the fill floods and
  the city did not lies behind the protection built after 2002 (Zwinger,
  Theaterplatz, Friedrichstadt, Terrassenufer): walls and mobile walls are
  not in a bare-earth DGM, and OSM's walls burned in change nothing. So
  phase 1 needs the protection lines with their crests as data (the city's
  Plan Hochwasservorsorge, LTV) and the Weißeritz as a second river.
- **Phase 2, in the viewer behind `?studie=`.** Not the terrain term this
  plan describes: the horizon leaves trees out, and on a playground the
  trees make most of the shade, so the spike computes on the CPU over the
  places a question names (`lib/city/sun-study.ts`; the ledger's
  experimental entry has the model). A recipe — season, hours, playgrounds
  or benches, a circle — ranks the places by their share of shade with its
  spread, hatches them on the ground (`study-marks.ts`) and writes itself
  into the link. The crowns are the viewer's own (its sizes, its register
  veto, its rows). Äußere Neustadt, 1 km, summer 11–17 h: 12 playgrounds,
  1 190 points × 234 sun positions, 111 000 crowns from three tiles,
  loaded in 0.7–1.2 s and computed in 0.2 s (desktop browser); ≈ 13 MB
  held while it runs (≈ 23 MB for 2 km, six tiles), then only the results.
  Trees make the shade: 0.30 of the window on average, 0.03 from the
  buildings alone.

Open: the terrain-wide field (every texel, for the hatch beyond the
places) as a GPU pass; names from OSM (the furniture bake drops them);
whether a phone's CPU keeps the 0.2 s within a second.
