# Plan 029: Fences, railings and gates

> **Executor instructions**: Read fully first. Phases in order. Look is
> judged on a real GPU (`bun run shots --headed`, full profile, oblique).
> Update the status row in `docs/plans/README.md` when a phase lands.
>
> **Neighbours**: hedges are `pipeline/bake/lowveg.py`'s (OSM
> `barrier=hedge`, shipped in PR #49) — this plan never touches hedges.
> The fine terrain is a TIN with **no wall conflation**; earth-retaining
> walls snap to the measured step instead (`lib/city/wall-snap.ts`,
> ADR 0030). Read that ADR before touching `walls.ts`.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- pipeline/bake/walls.py lib/city/walls.ts scripts/bake-tiles.ts scripts/prepare-data.ts`

## Status

- **Priority**: P2 (fences edge almost every yard, park and school)
- **Effort**: M (bake S, geometry M, gates S)
- **Risk**: MED — 78 km of line work; triangle and fill budget
- **Planned at**: 2026-09-25
- **Status**: PARTIAL — phases 1–2 built; open: the plates on a real GPU
  (none was available to the executor)

## Outcome (2026-09-25)

- **Bake** — `pipeline/bake/walls.py` appends `{kind: "fence", type, h}`
  lines and `{kind: "gate", w, on, type?}` points (on a wall or fence line
  within 0.5 m, snapped onto it) after the walls. The committed wall
  features stayed verbatim (Geofabrik 2026-06-15; the terrain study
  addresses them by index); the fences and gates come from the BBBike
  extract of 2026-09-19. 99 km of fence (15.7 / 45.9 / 14.7 / 22.9 km on
  `33410_5656` / `33410_5658` / `33412_5656` / `33412_5658`), 875 gates on
  a line (746 on fences, 129 on walls); about 520 gate points on no line
  are dropped. `lowveg.py` and the terrain study ignore fences and gates;
  `prepare-data.ts` keeps them out of the conflation, the stair burn and
  the step snap.
- **Geometry — deviation** — one flat double-sided quad per ≤ 2.5 m panel
  (`lib/city/fences.ts`), its post and top rail drawn by the pattern, a
  narrow quad for a run's last post. The first cut built posts (4 × 4 cm
  boxes) and a rail as geometry: 125–361 k triangles per tile and +12 to
  +32 % on the fine terrain glTF — over the 10 % STOP. Lean: 14.4 / 41.2 /
  13.5 / 20.0 k triangles, +46 / +115 / +44 / +53 kB gzipped (+2.7 / +6.8 /
  +2.7 / +2.7 %).
- **Pattern — deviation** — procedural in `fence-layer.ts` from the first UV
  set (code + distance along, 16-bit), box-filtered over the pixel
  footprint, not a baked 64 × 64 atlas: no image in the glTF, and exact
  coverage at any distance. The shimmer STOP's fallback (fade to a flat,
  lighter tint far off) is taken up front: where the infill's bars fall
  under a pixel, or beyond 40–60 m, it becomes a lighter veil of its mean
  coverage, dithered in screen space.
- **Shadows** — a custom depth material with the same discards (no alpha
  map: three copies a colour material's alphaMap/alphaTest onto the depth
  material); posts and rails cast in full, the infill dithered by coverage
  per shadow texel, softened by the PCF.
- **Gates** — a `w`-wide gap with a closed leaf (denser bars, darker), a
  boom at 1 m for a lift gate or cycle barrier; gates on a freestanding
  wall (`kind` wall) cut that ribbon too (119 leaves); retaining walls are
  never cut.
- **STOP checks** — size: under 10 % on every tile (above). Crossing: 5.4 %
  of the fence lines run > 1 m inside a LoD2 footprint (inset 0.3 m; 3.3 /
  9.0 / 2.5 / 2.6 % per tile), mostly ends tucked into a wall and hidden by
  the clay; 9.7 % run > 1 m over the DLM road class (18.7 / 8.1 / 7.9 /
  6.1 %), which is ±3 m and includes pavements — the check has to be
  visual on a GPU; lines are not shifted. Shimmer and the look: GPU.
- Headless (SwiftShader, `?scene=lite`): boots with no shader or console
  errors; the spawn tile's fences census 13 500 triangles.

## Why this matters

Walls are drawn (`walls.py`: wall, retaining_wall, city_wall), fences are
not read anywhere. In the four tiles (BBBike 2026-09-19): **1 174
`barrier=fence` ways, 77.8 km** (plus 52 closed as areas), `fence_type`
mostly untagged (railing 42, metal 30, wire 30, wood 10, chain_link 6,
bars 6); `barrier=handrail` 27 ways; gates as **1 142 `barrier=gate`
points** on walls and fences, 35 gate ways, 171 `lift_gate`, 33
`cycle_barrier`.

## Design

Fences are static and follow the ground, like walls and kerbs — so they
are **baked into the fine terrain glTF** as a child node
([ADR 0029](../adr/0029-static-dressing-baked-into-the-fine-terrain.md)),
not built at runtime.

### Bake — extend `pipeline/bake/walls.py`

- Add `barrier IN ('fence','handrail')` from `lines` and the exterior ring
  of `multipolygons`, as `{kind: "fence", type, h}`: `type` from
  `fence_type` (railing/metal/bars → `railing`, wire/chain_link →
  `mesh`, wood → `picket`, untagged → `railing`, Dresden's default
  wrought-iron look), `h` from `height`, else 1.2 m (handrail 1.0 m).
- Gates: `barrier IN ('gate','lift_gate','swing_gate','cycle_barrier')`
  points **on** a wall or fence line (≤ 0.5 m) → `{kind: "gate", w}`
  (`width`, else 1.2 m; lift gates 4 m) in the same file, so the builder
  can cut the gap.
- Fences never enter the coarse level's conflation (`CONFLATE_KINDS`)
  and never snap to a step (`RETAINING_KINDS` in `lib/city/walls.ts`
  stays as it is): a fence stands on its OSM line.
- Tests: a fence way, a gate on it, a gate off any line (dropped).

### Build — `lib/city/fences.ts` → `fenceMesh` in `scripts/bake-tiles.ts`

- Along each fence, sampled every 2.5 m on the fine terrain surface (the
  TIN, read through the same build-time `heightAt` the walls use): a
  thin post every 2.5 m (4 × 4 cm, 6 faces), a top rail, and one
  **alpha-tested double-sided panel** strip between posts whose texture
  (a tiny generated atlas: bars / mesh / pickets, 64 × 64 each) gives
  the see-through look. The atlas is built at bake time and written into
  the glTF (no runtime fetch).
- Gate gaps: the fence is cut `w` wide at each gate; a gate leaf (the same
  panel, a darker frame) stands in the gap, closed.
- Budget: ≈ 31 k posts × 10 triangles + ≈ 62 k panel triangles across the
  four tiles, well below the kerbs' 130–200 k per tile.

### Runtime — `app/_components/fence-layer.ts`

Only its material, like `wall-layer.ts`: dark iron/grey tones from the
furniture palette, `alphaTest`, `side: DoubleSide`, cast shadows with a
`customDepthMaterial` that honours the alpha (see the skill on the
`WebGLShadowMap` alphaMap-override gotcha before touching this).

### Docs

Ledger (Retaining / city walls → "Walls and fences"), `data-flow.md`,
`rendering.md` codebook, `data-pipeline.md`, provenance, guide OSM row
(en + de).

## Phases

1. Bake + fence geometry + material. Plates: the Großer Garten edge, a
   school yard, a Neustadt courtyard, noon and low sun.
2. Gates and gaps.

## STOP conditions

- Alpha-tested panels shimmer at distance: fade panel alpha to a flat,
  lighter tint beyond ~60 m in the fragment shader before anything else.
- The fine terrain glTF grows > 10 % per tile: drop panels to every other
  segment far from paths, or report.
- A fence visibly crosses a building or the carriageway in > 1 in 10
  checked: the OSM line is misaligned with LoD2/DLM; report, do not
  shift lines heuristically.
