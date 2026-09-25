# Plan 030: More street furniture — columns, signals, hydrants, clocks, stop signs

> **Executor instructions**: Read fully first. Each kind lands on its
> own; follow the "new kind, end to end" path below for each. Look is
> judged on a real GPU (`bun run shots --headed`, full profile). Update
> the status row in `docs/plans/README.md` when a kind lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/furniture.py lib/city/furniture.ts app/_components/furniture-layer.ts lib/city/features.ts`

## Status

- **Priority**: P2 (the small things a walker passes every few metres)
- **Effort**: S per kind, M in total
- **Risk**: LOW — the furniture path exists and is type-enforced
- **Planned at**: 2026-09-25
- **Status**: DONE 2026-09-25 — every kind, built without a real GPU:
  the plates are still to be taken; SwiftShader proves only that it
  compiles and boots clean.

## Implementation notes (2026-09-25)

Counts after the bake (four tiles, BBBike 2026-09-19): columns 85
(4 lit), signals 288, pillar hydrants 6, hydrant signs 454, pole clocks 8,
wall clocks 3 (of 8; the rest have no facade within 3 m), drinking
fountains 8, stop signs 79. Every earlier object of the committed files
comes out byte-identical; the new kinds are appended.

- **Signals at the kerb.** OSM puts `highway=traffic_signals` on the
  carriageway at the stop line; standing the pole there would plant 288
  poles in the road. The bake walks a signal on the road class to the
  kerb on the right of the traffic its `traffic_signals:direction` names
  (the kerb from the committed class raster, ≤ 15 m), facing that
  traffic; without a direction to the nearest kerb, facing the nearest
  way. The same kerb walk moves an underground hydrant's sign out of the
  lane (166 are tagged `fire_hydrant:position=lane`).
- **Hydrant signs**: the STOP needs a GPU plate; without one the
  conservative fallback was taken — the plates are drawn at 70 %
  (`HYDRANT_SIGN_SCALE`) rather than dropped.
- **Wall clocks** hang on the nearest OSM building outline (≤ 3 m), not
  on a runtime ray against the LoD2 BVH (a dressing cannot count on the
  buildings being loaded; the result must not depend on load order).
- **Clock hands**: one shared `uClockMinutes` uniform, set by
  `setClockTime` from `setSun` and changed on the minute only; the hands
  (`furniture-*-hands`) never cast, so the shadow map is not redrawn.
- **Stop sign**: `highway=bus_stop` without `shelter=yes`, dropped within
  8 m of a shelter; plan 024 phase 3 stands the same model at the tram
  stops.
- **Style** (maintainer feedback on the fences): no near-black and no fine
  detail — the signal head a shade deeper than the metal with barely
  darker glass, the hydrant sign one soft rose plate (no border), the stop
  sign's "H" as colour fields (a green disc in a yellow one, no letter),
  three poster fields on a column, clock hands a soft slate.

## Why this matters

`furniture.py` covers benches, bins, bicycle stands, bollards, post boxes,
shelters, picnic tables and playgrounds. Mapped but unused (four tiles,
BBBike 2026-09-19):

| Kind | OSM | Count |
|---|---|---|
| Advertising column (*Litfaßsäule*) | `advertising=column` | 87 (lit=yes 4) |
| Traffic signals | `highway=traffic_signals` | 311 (244 with direction) |
| Fire hydrant | `emergency=fire_hydrant` | 464 — **454 underground**, 7 pillar |
| Clock | `amenity=clock` | 32 (pole 9, wall 8, tower 2) |
| Drinking water | `amenity=drinking_water` | 9 |
| Bus / tram stop sign | `highway=bus_stop`, `railway=tram_stop` | 281 |

The Litfaßsäule is a Dresden/Berlin street icon; the stop signs and
signal poles are what make a junction read as one.

## New kind, end to end (per kind)

1. `furniture.py`: widen `POINT_WHERE` (`:57-62`; `emergency`,
   `advertising`, `highway=traffic_signals` and `railway=tram_stop` are not
   matched yet), a branch in `kind_of` (`:99-112`), whether it gets a
   bearing `a` (`:226-230`), a test case in `test_bakes.py:370`.
2. `FurnitureKind` in `lib/city/features.ts:107-150` + the kinds list in
   `features.test.ts:97-119`.
3. `FurnitureModel`, `FURNITURE_MODELS`, `MODEL_OF` in
   `lib/city/furniture.ts:11-129` + its test.
4. A builder in `MODEL_PARTS` (`furniture-layer.ts:367-392`, the `Record`
   enforces it) from `block`/`pillar`/`tube`/`extrudedX`/`tinted`; front
   is local +Z; palette constants at `:73-95`.
5. Credit list `sites/dresden.ts:42`, provenance `furniture.query`,
   `docs/data-pipeline.md`, ledger row "Street furniture", guide OSM row
   (en + de).

## The kinds

- **Advertising column**: a 2.7 m cylinder, Ø 1.2 m, a darker cap ring and
  crown, the body in a pale paper tone with a few hash-placed muted poster
  rectangles in the clay palette (colour fields, **no text, no imagery**).
  `lit=yes` ones get the dusk glow of the lamp heads.
- **Traffic signals**: a 3.2 m grey pole with a dark three-lamp head
  facing the approach — `traffic_signals:direction` (forward/backward) on
  the way through the node gives the bearing; no direction → face the
  nearest road like benches do. Lamps unlit, dark glass: the viewer has no
  traffic and a cycling phase would be invented.
- **Hydrant**: pillar → a 0.8 m red-ochre pillar hydrant (in the pastel
  range, not signal red); underground → the German hydrant sign plate
  (a small white/red rectangle) on a 1.8 m post at the point, as on
  Dresden pavements. A 454-strong sign forest must pass the plate check.
- **Clock**: `support=pole` → a 3.5 m post with a double-faced round
  clock; `wall_mounted`/`wall` → a disc on the nearest facade (≤ 3 m;
  ray against the city BVH), else dropped; `tower` → dropped (the tower is
  LoD2). The hands show the **scene time** (`setSun(date)` fans out the
  minutes; two instanced hand quads per face, rotated in the vertex shader
  from a uniform — a detail people notice).
- **Drinking water**: a slim 1 m bronze column with a small basin.
- **Stop sign**: the German "H" sign (green-yellow disc, abstracted) on a
  2.6 m pole with a small timetable box, at every stop point not already
  carrying a shelter within 8 m; tram stops share it with plan 024
  (build it here, plan 024 uses it).

## STOP conditions

- The underground-hydrant sign plates clutter the pavements in plates
  (454 in the four tiles): render them 30 % smaller, or drop them and keep
  the pillars — report which.
- Clock hands drive a per-frame uniform update that invalidates the
  shadow map: hands must not cast; update on the minute only.
