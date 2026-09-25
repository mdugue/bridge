# Plan 025: Trees by species and season

> **Executor instructions**: Read fully first. **This plan builds on
> `feat/tin-kataster-lowveg`** — the Dresden street-tree cadastre
> (`pipeline/bake/trees.py`, `tree_archetypes.py`,
> `lib/city/tree-inventory.ts`, `app/_components/tree-inventory-layer.ts`)
> lives there. Do not start before that branch has merged; if it has not,
> STOP and report. Look is judged on a real GPU (`bun run shots --headed`,
> full profile). Update the status row in `docs/plans/README.md` when a
> phase lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/trees.py app/_components/tree-inventory-layer.ts app/_components/vegetation-layer.ts app/_components/create-app.ts`

## Status

- **Priority**: P1 (trees are the second-largest thing on screen)
- **Effort**: M (OSM trees S, season model S, crown shader M, bare crowns M)
- **Risk**: MED — bare crowns must not read as noise; shadows must follow
- **Planned at**: 2026-09-25
- **Status**: TODO (blocked on `feat/tin-kataster-lowveg`)

## Why this matters

The cadastre branch already places ~120 000 municipal trees with height,
crown diameter, archetype (round, oval, columnar, conifer, weeping, small),
leaf type and purple/golden cultivars. Two things are still missing:

1. **Trees the city does not register.** OSM has **6 160 `natural=tree`**
   in the four tiles (BBBike extract 2026-09-19), 4 339 with `leaf_type`,
   ~370 with `genus` (Tilia 125, Castanea 124, Quercus 44, Betula 33, …)
   and some `species`. Many stand on private or Free-State land (courts,
   the Zwinger, Großer Garten edges) that the municipal register skips.
2. **The year.** Nothing varies with the month: the scene date lives only
   in React state (`city-walk.tsx:82-91`) and `setSun(date)`
   (`create-app.ts:584-595`) passes on nothing but the night factor. A
   snapshot on 21 December shows full summer crowns. With species known,
   autumn colour and leaf fall follow from real phenology, not decoration.

## Design

### A. OSM trees as a complement (bake)

- In `trees.py`, after the cadastre: `read_osm(tile, "points",
  "other_tags LIKE '%\"natural\"=>\"tree\"%'", ["other_tags"])`; keep a
  tree only if no cadastre tree lies within 3 m (the cadastre wins; it is
  measured). Map `species`/`genus`/`taxon` through `tree_archetypes.py`
  (it already maps taxa); only `leaf_type` known → round/conifer by leaf
  type; nothing known → drop the tree (the DOM canopy fill covers
  unknown trees; do not invent a species).
- `height` / `diameter_crown` / `circumference` tags when present, else
  the archetype median of the tile (the branch's `impute`).
- Mark provenance per point (`s: "osm"`), and extend the `attribution`
  member to both credits.
- Also read the cadastre's `stammdurchmesser_akt` (trunk diameter, cm):
  trunk radius scale today follows crown size only.

### B. Season model (pure) — `lib/city/tree-season.ts`

`seasonAt(dayOfYear, genus) → { leaf: 0..1, autumn: 0..1 }`:
- leaf-out mid-April → early May, full leaf to September, colouring
  October, leaf fall late October → late November (Dresden climate).
- per-genus offsets and autumn hues in one table: Acer (orange-red; the
  `'October Glory'` cultivars deep red), Tilia (butter yellow, early fall),
  Aesculus (early browning — leaf miner), Betula (golden, early), Quercus
  (russet, late, holds dead leaves), Platanus (tan, late), Ginkgo (pure
  yellow, drops within days), Larix/Metasequoia/Taxodium (deciduous
  conifers: rust, then bare); evergreens never change.
- per-tree hash jitter ±6 days so a street turns over a week, not at once.
- Canopy-fill and row trees (species unknown): a generic deciduous curve.
- Unit-tested (`bun test`): monotone within each phase, evergreen constant,
  the day-of-year wrap.

### C. Season in the scene

- `create-app.ts` `setSun(date)` stores the day of year next to
  `currentNight`; `TileStreamContext` gets `season()` like `night()`
  (`tile-stream.ts:91`); `stream.dressings` receive `setSeason(day)`.
- Crown material (`buildCrownMaterial`, `vegetation-layer.ts:330-472`):
  per-instance `aGenus` (u8) and the two season scalars computed on the
  CPU per instance on a date change (not per frame) into an
  `InstancedBufferAttribute`; the fragment mixes summer colour → autumn
  hue by `autumn`.
- **Bare crowns** by `leaf`: hash-dithered discard of crown fragments (the
  clay already uses hash-dithered transparency) down to a sparse twig
  density (~25 %) tinted grey-brown, plus a `customDepthMaterial` with the
  same discard so the winter shadow thins with it. Trunks stay.
- The snapshot codec already carries the date (`lib/city/snapshot.ts`), so
  seasons round-trip with no format change.

### Docs

Ledger (Vegetation: species colour + season ✅), `data-flow.md`,
`rendering.md` codebook, guide `how-it-works.md` "Trees and hedges" (it says
"the species unknown") and `data-sources.md` (OSM trees) in en + de.

## Phases

1. A (OSM complement + trunk diameter) — plate: the Zwinger courtyard.
2. B + C colour only (autumn hues) — plates on 15 Oct and 1 Nov, the
   Königsufer and a lime avenue.
3. C bare crowns + thinned shadows — plates on 10 Jan at noon and low sun.

## STOP conditions

- Bare crowns read as flicker or "noise" in a motion check (the rejected
  plain translucency did, ledger 🗃️): raise the dither cell / fade twigs
  with distance before anything else; if still noisy, ship colour only.
- Recomputing season attributes on a date drag stalls > 16 ms on the full
  site: throttle to the drag end.
- OSM-only trees duplicate visible cadastre or canopy trees in a plate:
  tighten the 3 m rule and the canopy veto, do not add a second veto path.
