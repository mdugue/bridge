# Plan 035: A hidden soundscape — the city you hear

> **Executor instructions**: Read fully first. The maintainer asked for a
> surprise, **opt-in and hidden**: nothing may make a sound until the
> visitor turns it on, and the entry point stays out of the way. Phases
> in order. Judge with headphones and speakers, in a real browser (Chrome,
> Safari, iOS Safari). Update the status row in `docs/plans/README.md`
> when a phase lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- app/_components/city-walk.tsx app/_components/keyboard-controls.ts app/_components/create-app.ts app/_components/scene-sidebar.tsx`

## Status

- **Priority**: P3 (delight)
- **Effort**: M (engine M, sources M, entry S)
- **Risk**: LOW for the scene (audio is a separate graph, lazy-loaded);
  MED for taste — procedural sound gets cheesy fast
- **Planned at**: 2026-09-25
- **Status**: TODO

## Idea

Everything the viewer already knows about a place has a sound: the class
raster knows water, meadow, road and rail; the paving raster knows sett
from asphalt; the trees sway with a known wind phase; the sun rig knows the
hour and whether it is night; the date knows the season. The soundscape
**reads the same data the picture reads** — and makes it audible:

- **Footsteps that know the ground.** On foot, each step sounds like what
  the paving raster says is underfoot: the hollow clack of sett in the
  Neustadt, soft asphalt, crunching gravel paths in the Großer Garten,
  muffled grass on the Elbwiesen. Silent in fly mode.
- **The Elbe** — a low, broad murmur rising as you approach class 8.
- **Wind and leaves** — wind grows with height and open sky (the SVF of
  plan 033 when present, else how open the classes around are); leaf
  rustle scales with the trees within 40 m and pulses with the same wind
  phase the crown shader sways with.
- **Birds by day** near meadow, parks and trees: a few synthesized call
  types (sparrow chirps in streets, a blackbird's phrase at dusk, a dawn
  chorus in spring mornings); silent at night and sparse in winter.
- **Crickets** on warm summer nights near meadows.
- **The city** — a far, low hum near roads and rail, quieter at night.
- **Bells at the full hour** — the surprise: at each full hour of the
  **scene clock**, the churches within 1.5 km strike the hour, each from
  its own direction, each **delayed by its distance at 343 m/s**. Scrub
  the time slider past 18:00 on the Neumarkt and the Frauenkirche answers
  first, the Kreuzkirche a beat later.
- **A tram bell** now and then near tram lines (plan 024's data), rare.

No audio files and no dependency: everything is synthesized with the
WebAudio API (filtered noise, FM chirps, modal bell partials), so the
bundle stays small and nothing needs licensing.

## The hidden opt-in

- Keyboard: **`L`** (for *lauschen*) toggles the soundscape — free today
  (`keyboard-controls.ts` uses R, F, WASD, Space, E, Q, Shift, 1–9). It is
  **not** listed in `CONTROL_HINTS`.
- One quiet line at the very bottom of the **Erweitert** tab: a switch
  "Klang (experimentell)" — the only visible trace, for touch devices.
- Off at every load (no persistence): a page must never start making
  sound on its own, and browsers block autoplay anyway. The `AudioContext`
  is created inside the toggle's user gesture (iOS Safari requires it).
- A small speaker glyph appears in the HUD corner while it plays; clicking
  it mutes. Mute on `visibilitychange` (hidden tab) and while the loading
  overlay shows.

## Design

- **Pure core — `lib/city/soundscape.ts`** (DOM- and THREE-free; the purity
  test enforces it): `mix(env) → gains` where `env` = { class fractions
  within 30 m, distance to water, tree count within 40 m, surface under
  the camera, height above ground, night factor, day of year, minutes,
  mode }. Unit-tested: silence at night for birds, water gain monotone in
  distance, footsteps off in fly mode, the bell schedule (which hour
  strikes how many times, the distance delay).
- **Engine — `app/_components/soundscape/`**, **dynamically imported** on
  first toggle (zero cost to everyone who never presses `L`): one
  `AudioContext`, a master gain, one voice per source with smoothed gain
  ramps (`setTargetAtTime`, 0.4 s), a `StereoPannerNode` per positional
  source from its bearing relative to the camera heading.
- **Environment sampling** at the existing 10 Hz `onPose` stream
  (`city-walk.tsx:374-381`) — never inside the render loop. The class
  raster is sampled on the CPU from the minimap-level PNGs the handle
  already exposes (`landcoverTiles`, `create-app.ts:1136-1139`) through
  `decodeGreyPng`; the paving class from the surface PNG fetched and
  decoded once per nearby tile **only while sound is on** (the viewer
  drops its own CPU copies after upload for iOS memory reasons — do not
  change that).
- **Footsteps** are driven by distance walked (a step every ~0.75 m of
  horizontal travel at walking speed), not by time.
- **Bell towers**: a small bake — `pipeline/bake/soundmarks.py` →
  `data/dlm/soundmarks_<tile>.geojson`: churches with a tower
  (`building=church|cathedral`, `amenity=place_of_worship` +
  `religion=christian`) as points with a size class (large → deep bell);
  fountains come from the monuments file (a splash near basins). OSM
  attribution. Loaded with the dressing as an optional artifact.
- Time comes from `setSun(date)`; the clock strike fires when the scene
  minute crosses a full hour, whether by real time or a slider scrub
  (scrubbing across several hours strikes only the last one).

### Docs

`docs/guide/*/using-the-viewer.md`: one short entry under a
"Kleinigkeiten / Small things" heading (en + de), so the feature is
findable by those who read and stays hidden from those who do not. Ledger (new section "Sound"), `rendering.md`
has no audio section — add a short one; `data-pipeline.md` for the
soundmarks bake.

## Phases

1. Engine, toggle (`L` + the switch), speaker glyph, mute rules; wind and
   the city hum only.
2. Water, leaves, birds, crickets (the class/tree/time driven sources).
3. Footsteps by paving.
4. Soundmarks bake + the hour bells with distance delay; tram bell once
   plan 024 has landed.

## STOP conditions

- Any sound before an explicit toggle, in any browser: a blocker.
- The render loop's frame time changes measurably with sound on: move
  the offending work out of the 10 Hz handler into the audio thread
  (scheduled parameters) or lower its rate.
- The maintainer finds a source cheesy on listening: it is removed, not
  tuned endlessly — the soundscape is better sparse.
