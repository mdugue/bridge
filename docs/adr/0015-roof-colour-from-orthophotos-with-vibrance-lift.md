# ADR 0015: Roof colour from orthophotos with a hue-preserving vibrance lift

- **Status:** accepted
- **Date:** 2026-06-17

## Context

The LoD2 model carries no colours. A synthesised palette from `roofType`
and `Dachneigung` (terracotta pitched, slate flat) reads plausible but
uniform. The nadir DOP sees roofs well — and only roofs; facades are
invisible from above, and tall buildings lean sideways in the image. The
raw sampled colours read drab and hazy: an audit found 38 % near-grey with
a slightly negative mean red-minus-blue.

## Decision

`scripts/extract-roof-colour.sh` samples the DOP under each building's
RoofSurface footprint, eroded 5 px inward to dodge building lean, and takes
a per-channel median of ≥ 12 samples, emitting a per-tile LUT keyed by the
CityJSON object id (linear RGB). The bake folds the LUT into the building
mesh's per-object table; buildings without a sample fall back to the
synthesised palette. At render time a `uRoofVibrance` term (HUD
*Dachsättigung*, default 0.5) applies a **hue-preserving chroma boost**:
it lifts each roof's saturation around the grey axis, weighted so dull
roofs lift most and vivid ones barely, plus a tiny warm nudge on the muddy
greys only.

## Consequences

- About 83 % of buildings carry a real roof colour; copper-green,
  terracotta and slate keep their true hues.
- The DOP is used for roofs and NDVI only; it is never a facade or ground
  texture (ledger: "Orthophoto for facade colour" discontinued).
- A new DOP edition means re-running the bake and re-baking the mesh
  (automatic at build).
- True-orthophotos, if ever available, would remove the lean and let the
  erosion shrink.

## Alternatives

- **Blend toward a terracotta target to cure drabness:** rejected — it
  destroyed the ~187 genuine copper-patina-green roofs the DOP captured.
- **DOP as the only tint source:** leaves everything identical where the
  imagery is flat and has no facade information; the per-building hash
  carries wall variation instead.
- **Per-vertex sampling:** unnecessary; one colour per roof matches the
  clay look.

## References

- Ledger "Roof colour", "Roof vividness", 🗃️ orthophoto rows;
  `scripts/extract-roof-colour.sh`, `lib/city/building-tint.ts`
  (`roofColor`), `visual-style.ts`.
