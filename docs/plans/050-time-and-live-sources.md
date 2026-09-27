# Plan 050: Time and live sources — the twin's fourth dimension

> **Executor instructions**: Read fully first, and ADR 0001's 2026-09-27
> amendment: **static where possible** — read a live source from the
> browser when its API allows it (CORS), fall back to a value baked at
> build time, and propose a stateless proxy only when neither works (ask
> the maintainer first). Every live value must *change the look*, not add
> a dashboard: the scene stays wordless (ADR 0036). Nothing may block the
> boot on a live source. Update the status row in `docs/plans/README.md`.

## Status

- **Priority**: P2
- **Effort**: M (phase 1 S, 2 M, 3 M)
- **Risk**: MED — third-party availability, shadow-map cost when the sun
  moves, taste (weather must stay pastel)
- **Planned at**: 2026-09-27
- **Status**: **TODO**

## Idea

The twin already has a real sun for any date and season-aware trees. It
has no *now*: no weather, no river level, no running clock. Each of these
has an open source and a place in the existing look.

## Phases

### 1. The day plays (S) — no network

A play button next to the time slider (and `P`) advances the scene clock
at 1 min per 100 ms. The shadow map re-renders per sun step, so step the
sun at 2–4 Hz, not per frame (plans/README direction option 3). Stops on
any time-slider input. Snapshot unaffected (it stores an instant).

### 2. Weather sets the mood (M)

Source candidates, both keyless: **Open-Meteo** (`api.open-meteo.com`,
CC BY 4.0, CORS enabled per its docs) and **Bright Sky** (DWD open data,
`api.brightsky.dev`, CORS per its docs). Verify CORS and the licence
text from the browser before building; record both in
`data/provenance.json` and the guide's data sources (both languages).

Mapping (only existing controls; no new renderer feature):

| weather | look |
|---|---|
| cloud cover | sun intensity down, `shadow.radius` up (softer), sky/ambient mix up |
| fog / low visibility | the height fog's density (`height-fog.ts`) |
| rain (mm/h) | a wet sheen: roughness down on roads and roofs via the existing roughness uniforms; no particles in phase 2 |
| snow depth | the meadow class tinted towards paper white in the splat pass |

Opt-in: a *Wetter: live* switch in *Erweitert* (off by default, so a
snapshot reproduces). With it off, nothing is fetched.

### 3. The Elbe follows its gauge (M)

**Pegelonline** (WSV, `pegelonline.wsv.de/webservices/rest-api/v2`,
station *DRESDEN*) serves the current water level; verify CORS and the
licence (dl-de/zero-2-0 per its site) first. The river sheet
(`water-layer.ts`) takes its height from the gauge relative to the DGM's
water surface at bake time (the DGM1 flight's level, which the bake can
record per tile from the class raster's water cells). Clamp to the
channel: flooding the banks is plan 051's scenario, not a live effect.
With no answer, the baked level stands.

## Not in scope

- Live trams (DVB): the open GTFS-RT/VVO feeds need their own check of
  licence and CORS; likely a proxy. Separate decision.
- Traffic, air quality, noise: numbers without a place in the look.
