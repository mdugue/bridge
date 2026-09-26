# ADR 0010: Buildings render as opaque clay only — no transmission, no outlines

- **Status:** accepted; its "no outlines" and "no `style` key" consequences
  are narrowed by [ADR 0032](./0032-picture-styles-as-one-post-pass.md)
  (outlines exist as an optional picture style, never in the default look)
- **Date:** 2026-06 (aesthetic PR #16), reaffirmed 2026-09

## Context

Early versions offered three building styles: the loader's raw LoD colours
("standard"), a frosted "ghost" built on `MeshPhysicalMaterial.transmission`,
and an archviz "clay". Transmission re-renders the whole opaque scene into
a buffer every frame (~2× the scene cost) even at half resolution. Ink
outlines (`EdgesGeometry` over a welded copy of the GPU mesh) cost ~1.1 s
at boot and ~0.65 s per demolish and, more importantly, read as hard edges
against the watercolour look. A procedural window grid read as a modern
office block over the historic LoD2 silhouettes.

## Decision

One style: opaque archviz clay plus the facade-detail shader (per-building
tint, ground shade, storey bands, eave line, rim light, dusk glow,
roughness jitter) with hash-dithered transparency for the see-through
slider. Ghost and standard styles, ink edges and window grids are removed,
not hidden behind a flag. Keep `transmission` out of the scene entirely.

## Consequences

- The shader budget is spent on the post stack and shadows, not on a
  second scene render.
- The Snapshot has no `style` key; the lite profile has no transmission
  knob.
- Faint storey banding is the only remnant of the window-grid experiment.
- Contour ink survives only as a fragment-shader term on the terrain.
- If outlines ever return, derive them from the CityJSON polygon rings at
  bake time (plan 003's extractor design: ~85 ms for ~88 k segments), never
  by welding the GPU mesh.

## Alternatives

- **Keep ghost as an option:** rejected — an option that halves the frame
  rate is a trap, and two styles double every shader patch.
- **Sobel / deferred outlines:** hard edges clash with the look.
- **Selective bloom, quad leaf billboards:** no payoff for the cost.

## References

- Ledger "Buildings", 🗃️ rows (window grid, outlines, bloom); plan 003
  (rejected); AGENTS.md "Buildings render in exactly one style";
  `visual-style.ts`.
