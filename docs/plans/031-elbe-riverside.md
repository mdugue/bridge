# Plan 031: The Elbe — landing stages, groynes, ferries

> **Executor instructions**: Read fully first. Phases in order. Look is
> judged on a real GPU (`bun run shots --headed`, full profile, oblique
> from the Brühlsche Terrasse and the Neustadt bank). Update the status
> row in `docs/plans/README.md` when a phase lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- app/_components/water-layer.ts pipeline/bake/landcover.py app/_components/rail-layer.ts`

## Status

- **Priority**: P3 (character of the Altstadt panorama)
- **Effort**: M (bake S, landing stages M, ferry lines S)
- **Risk**: LOW — separate dressing over the water class
- **Planned at**: 2026-09-25
- **Status**: TODO

## Why this matters

The Elbe is the view from the Brühlsche Terrasse, and it is empty water
today: nothing reads OSM `waterway`, `man_made=pier` or ferries; water is
the DLM class 8 with the terrain mesh masked to it (`water-layer.ts`),
and lamps and furniture are dropped on water on purpose. OSM in the four
tiles (BBBike 2026-09-19): **51 `man_made=pier` ways + 5 areas** — the
*Anlegestellen* of the Sächsische Dampfschifffahrt below the Terrasse and
the smaller jetties — **1 groyne**, **3 `route=ferry` lines**
("Johannstadt Fähre", two paddle-steamer routes).

## Design

### Bake — `pipeline/bake/riverside.py` → `data/dlm/riverside_<tile>.geojson`

- Piers: `man_made='pier'` from `lines` (buffered by `width`, else 3 m)
  and `multipolygons` → `{k: "pier", deck}`; `deck` = the bank's DGM
  height at the pier's landward end + 0.4 m, a floating pontoon (`floating=yes`
  or a pier whose far end lies > 25 m into class 8) → `{k: "pontoon"}` at
  the water surface + 0.5 m.
- Groynes: `man_made='groyne'` lines → `{k: "groyne"}`.
- Ferry routes: `route=ferry` lines → `{k: "ferry", name}`, clipped to the
  water class.
- `attribution` = OSM. Tests on a synthetic bank.

### Runtime — `app/_components/riverside-layer.ts`

- **Pier**: a timber-tone deck slab 0.3 m thick on piles every 4 m
  (instanced), railings with the fence panel of plan 029 if merged.
- **Pontoon**: a dark hull block with a light deck and a small ticket hut
  where the pontoon is > 15 m long; a hinged gangway to the bank. The
  paddle steamers themselves are **not** drawn — no dataset has them.
- **Groyne**: a rough stone ridge (clay, low), half submerged.
- **Ferry**: a faint dashed wake line on the water surface along the
  route (drawn in the water shader via a small line table, like the sport
  table) — a map element, in the contour-map spirit.

### Docs

Ledger (Water), `data-flow.md`, `rendering.md` codebook, guide OSM row
(en + de).

## Phases

1. Bake + piers/pontoons — plate: the Terrassenufer landing stages.
2. Groynes and ferry wake lines.

## STOP conditions

- Pontoons at the water line clip or float visibly because the DGM water
  surface is not flat along the bank: sample the water surface the way
  `water-layer.ts` does, not the DGM, and report the offsets.
- The ferry lines read as a UI overlay rather than part of the water: keep
  them only in fly mode (altitude fade), or drop them.
