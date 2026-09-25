# Plan 025: Trees by species and season

> **Executor instructions**: Read fully first. This plan builds on the
> street-tree cadastre shipped with PR #49 (`pipeline/bake/trees.py`,
> `tree_archetypes.py`, `lib/city/tree-inventory.ts`,
> `app/_components/tree-inventory-layer.ts`; ledger "Tree inventory from
> the Dresden street-tree cadastre") and the laser-scan crowns
> (`canopyx_<tile>`, `pipeline/bake/lowveg.py`). Look is judged on a real GPU (`bun run shots --headed`,
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
- **Status**: **PARTIAL** (2026-09-25) — A, B and C are built, tested and
  checked headless; the GPU plates (every phase's) are open: the look of
  the autumn hues and whether the bare-crown stipple reads as noise in
  motion (the first STOP condition) have not been judged on a real GPU.
  See "Execution record" at the end.

## Why this matters

The cadastre (on by default since PR #49) places 18 444 municipal trees in
the four tiles with height, crown diameter, archetype (round, oval,
columnar, conifer, weeping, small), leaf type and purple/golden cultivars;
their trunks and broadleaf crowns ride in the canopy's own chunk meshes as
`TreeInstance`s, the three reshaped silhouettes are the inventory layer's.
Three things are still missing:

1. **Trees the city does not register.** OSM has **6 160 `natural=tree`**
   in the four tiles (BBBike extract 2026-09-19), 4 339 with `leaf_type`,
   ~370 with `genus` (Tilia 125, Castanea 124, Quercus 44, Betula 33, …)
   and some `species`. Many stand on private or Free-State land (courts,
   the Zwinger, Großer Garten edges) that the municipal register skips.
2. **The genus at runtime.** `trees_<tile>.geojson` carries the archetype
   (`a`), leaf type (`l`) and cultivar colour (`c`), but not the genus
   (`TreeFeature`, `lib/city/features.ts:61-72`) — and phenology is per
   genus. `tree_archetypes.parse_taxon` already extracts it in the bake.
3. **The year.** Nothing varies with the month: the scene date lives only
   in React state (`city-walk.tsx:82-91`) and `setSun(date)`
   (`create-app.ts:585-597`) passes on nothing but the night factor. A
   snapshot on 21 December shows full summer crowns. With species known,
   autumn colour and leaf fall follow from real phenology, not decoration.

## Design

### A. OSM trees as a complement (bake)

- **Genus id**: `trees.py` writes `gn`, an index into one genus table
  shared by the bake and `lib/city/tree-season.ts` (≈ 25 genera cover
  almost all trees; the rest → 0, "other deciduous"); `TreeFeature` and
  its test gain the field. `TreeInstance` (vegetation-layer) carries it so
  the crowns in the canopy chunks get it too.
- In `trees.py`, after the cadastre: `read_osm(tile, "points",
  "other_tags LIKE '%\"natural\"=>\"tree\"%'", ["other_tags"])`; keep a
  tree only if no cadastre tree lies within 3 m (the cadastre wins; it is
  measured). Laser-scan crowns (`canopyx`) and canopy points under an OSM
  tree go through the same `keepTree` veto the cadastre uses
  (`lib/city/tree-inventory.ts`), so an OSM tree replaces the anonymous
  crown it stands in rather than doubling it. Map `species`/`genus`/`taxon` through `tree_archetypes.py`
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
  (`tile-stream.ts:101`); `stream.dressings` receive `setSeason(day)`.
- Crown material (`buildCrownMaterial`, `vegetation-layer.ts:433`):
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

## Execution record (2026-09-25)

Built without a GPU; everything measurable was measured, the look was not
judged.

**A — bake.** `trees.py` writes `gn` (genus index; `tree_archetypes.GENERA`,
38 entries incl. "Acer rubrum" and "Quercus rubra" for their red autumn),
`t` (trunk diameter, cm, from `stammdurchmesser_akt` or an OSM
`circumference`), `s: "osm"`, and the `genera` member; the attribution
names both credits when OSM trees were added. Re-baked all four tiles
from the WFS of 2026-09-25 and the BBBike extract of 2026-09-19: the
18 444 cadastre trees are the same set with the same positions and
properties as the committed ones (checked as a multiset; only the order
differed, and the output is now sorted by position). Genus coverage
17 228 / 18 444 (93 %); trunk 17 254. OSM: 6 018 `natural=tree` in the
tiles, 4 384 with a taxon or `leaf_type`, 2 564 within 3 m of a cadastre
tree, **1 820 added** (854 / 251 / 369 / 346), 207 with a genus.
`trunkGirth` fits a measured trunk at 1.3 m (× 1.3 style factor).

**B — model.** `lib/city/tree-season.ts` as designed (per-genus leaf-out,
colouring, fall, hue, marcescent `hold` for oak, beech, hornbeam; ±6 days
jitter; `dayOfYear` folds 29 February), unit-tested.

**C — scene.** `app/_components/crown-season.ts`; `VegetationControl.
setSeason(day)`; `TileStreamContext.season()`; `create-app.ts` keeps a
season clock that re-seasons only on a change of calendar day, at most
once per 150 ms (trailing), and redraws the shadow map when a crown
changed. Headless (`/?scene=lite`, SwiftShader): no console errors or
shader compile errors; booting in July and setting 20 October / 10
January adds the two seasonal programs (crown + depth) and re-renders
the shadow map.

**Deviations.**
- The autumn colour is mixed on the CPU into the per-instance colour three
  already carries (divided by the crown material's base colour), not in the
  fragment shader from an `aGenus` attribute: the hue table stays in the
  pure, tested module, and the GPU gets one float per crown (`aBare`), on
  a per-chunk geometry view over the shared crown buffers.
- A chunk wears the seasonal (discarding) material only while one of its
  crowns is out of full leaf; in summer the plain crown keeps early depth
  testing. The first switch compiles the variant once per session.
- The dither is a hashed alpha test (three's `alphaHash` method, cells
  ~1.25 px at every distance, in crown space), not a fixed cell grid: the
  first cut's fixed cells (~8 per crown, with a solid twig-tinted crown past
  160–320 m) made big trees look like flat brown shards on the headless
  plates. This is the plan's first STOP remedy applied ahead of the GPU
  check; the check itself is still open.
- The genus table is shared through the artifact (`genera` member,
  checked against `TREE_GENERA` by `features.test.ts`), not a third file.
- The 3 m rule looks at the tile's own cadastre file only; a cadastre tree
  just across a seam does not veto an OSM tree (a 3 m band).

**Numbers.** `scripts/eval/season-cost.ts` (whole site, 58 988 seasonal
crowns, CPU of the container): a date change costs 4–7 ms median (July →
20 October 6.4 ms, → 10 January 3.6 ms, first-run JIT outlier 24–34 ms) —
under the 16 ms bar, throttled anyway.

**Open.** The GPU plates of every phase (Zwinger courtyard for OSM
duplicates; 15 Oct / 1 Nov at the Königsufer and a lime avenue; 10 Jan at
noon and low sun, and a motion check of the stipple). Canopy and row trees
(species unknown) use the generic curve, including any conifers among
them. Hedges and the low vegetation stay green. A site without a cadastre
gets no OSM trees (the step is skipped); an OSM-only `trees` artifact
would be a small change in `trees.run`.
