# ADR 0008: Progressive two-phase boot — first frame from the primary tile, everything else streamed

- **Status:** accepted
- **Date:** 2026-09-21 (plan 015)

## Context

The boot was all-or-nothing: a black canvas behind an overlay until every
tile, layer and the post stack existed. Measured on localhost with four
cores, the fetch-and-build stretch was ~3.3 s, of which the primary tile
alone was ~1.0 s; on phones the three backdrop tiles' rasters dominated the
wait.

## Decision

`bootApp` returns — and the overlay drops — as soon as the primary tile's
terrain and buildings, the sun rig and the post stack exist (HUD phase
`streaming`). `loadRest()` then streams, in order: the primary tile's
vegetation and lamps, the neighbour tiles (fetched concurrently, built in
order), rails and walls (which need the cross-tile `heightAt`), and the
idle-time terrain BVH; `onLoaded` flips the HUD to `ready`. Every step
re-checks the abort signal (`ensureAlive()`) and ends with
`invalidateShadows()`. Errors in `loadRest` surface via `onError` and never
take the first frame down. While the block is incomplete the fog far plane
is clamped to ~1.1 km so the missing neighbours read as haze.

Supporting decisions: the four heightfield headers (~150 B each) are
fetched up front so the sky dome, minimap bounds and fog floor do not wait
for neighbours; the fixed lamp-light pool is allocated before the first
frame (ADR 0020).

## Consequences

- The scene is walkable in roughly a third of the old boot time; the HUD's
  six load stages (`lib/city/load-stages.ts`) show the split at the
  "begehbar" mark.
- Anything added after the first frame **must** invalidate the shadow map
  and re-check the abort signal, or it shows up as a missing shadow or a
  leak after a StrictMode remount.
- The e2e hook distinguishes `__poc.firstFrame` from `__poc.ready`;
  `?scene=lite&block=1` exercises the streaming headless.
- New layers go into `loadRest()` unless the first frame cannot do without
  them.

## Alternatives

- **Clamp the player to loaded bounds:** unnecessary — movement already
  holds height off the DGM and the missing tiles are hazed.
- **Stream the primary tile's own layers too (terrain-first):** the
  buildings are the scene; a terrain-only first frame reads as broken.

## References

- plan 015; ledger "Progressive first frame"; AGENTS.md "The boot has two
  phases"; `create-app.ts` (`loadRest`), `lib/city/load-stages.ts`.
