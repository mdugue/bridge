# Plan 054: Scenarios — what-if studies drawn in the scene's own hand

> **Executor instructions**: Read fully first. A scenario is a *tool*: the
> visitor turns it on, it answers a question about the city, and it is
> drawn in the watercolour/contour language (washes, hatching, contour
> lines) — never a rainbow heat map, never text in the scene (ADR 0040;
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

From the baked horizon map (ADR 0031, plan 033): per ground texel, the
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
building removed with ADR 0026 is the history; the transformations ledger
names this use as its revival condition.

## Not in scope

- Noise, heat and air-quality maps: the city's data (Umweltatlas) is
  worth a look, but each needs its own licence check and a look decision.
