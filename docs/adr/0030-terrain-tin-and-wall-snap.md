# ADR 0030: The ground — a TIN of the native DGM, its static parts baked in, every part meeting it by one set of rules

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10

## Context

The ground is the bare-earth DGM1. It rounds every step a city has — a
kerb, a quay wall, a flight of steps, a bridge abutment — into a ramp one
to two metres wide, and models nothing built on it. Measured against
held-out laser ground, most of the "wall smear" was a resample of ours,
and burning OSM walls into the ground tripled the error around them.
Layers that each solved "how do I stand on this" on their own failed the
same way in five places at once.

## Decision

1. **The fine level is an error-bounded TIN of the native DGM** (±0.15 m,
   finer under track beds, ADR 0041); the coarse level is a regular grid
   with the walls burned in, where a 4 m cell smears any wall anyway. The
   walker stands on exactly the triangles the GPU draws.
2. **The ground is shaped only where nothing else works:** raised
   terraces a flight's tagged rise proves, the ground under stairs, line
   beds and passages (ADR 0041). Walls are not burned in; their ribbons
   snap to the step the TIN measures.
3. **Static parts are baked into the fine terrain glTF** as named nodes
   beside the ground: stairs (OSM `highway=steps` as stone blocks), walls,
   kerbs, fences. Built by the same step from the same file as the ground
   under them, they cannot disagree, and the browser computes nothing.
4. **Every part meets the ground by one set of rules**
   (`lib/city/ground-join.ts`): feet go under by a row of `SINK`; a top's
   edge on the ground side ends at the ground (`meetGround`) or runs on
   until the ground reaches it (`reachLevel`); per-sample decisions are
   smoothed along the part, never taken once per line and never left raw.
5. **Every part reports where it meets the ground** (`joins`), and
   `scripts/ground-joins.test.ts` holds the baked parts' misses to budgets
   over the committed tiles. A new part lists itself in `JOIN_PARTS` or
   tests its joins with `checkJoins`, and says in its doc comment what
   happens where the ground beside it is higher and where it is lower.

## Consequences

- Ground and parts arrive with the fine terrain, not behind the dressing
  gate. A change to one tile's walls, stairs or DGM re-bakes every fine
  level that probes it.
- Fine and coarse levels differ at walls; visible only at the switch.
- A budget is the measured state; lowering one follows a fix, raising one
  needs a reason in the commit.

## Alternatives

- **Burning walls into the ground (grid or TIN):** sharp steps, but the
  step lands on the OSM line, misses the measured edge, and flattens
  terraced walls into one cliff.
- **A native 1 m grid:** accurate, eight million triangles a tile.
- **A laser-scan DTM:** better only at the sharpest quay walls, for 2–4×
  the triangles.
- **Building stairs and walls in the browser:** two sources of truth, and
  walls standing on whichever level happened to be loaded.
- **Reshaping the terrain at every part:** every reshaping changes the
  ground the other parts read.
- **Fixing each place by its snapshot:** the next layer breaks the same
  rule and someone finds it on a phone months later.
