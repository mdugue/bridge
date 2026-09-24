# ADR 0016: Land-cover rasters downsampled to 2048² with the alpha channel treated as data

- **Status:** superseded by [ADR 0023](./0023-land-cover-colours-painted-at-runtime.md)
- **Date:** 2026-09-20/21 (PRs #28, #29)

## Context

The DLM bake writes 4096² rasters (≈0.5 m per texel). A 4096² RGBA splat
is ~85 MB of GPU memory with its mip chain; four of them plus four class
rasters exceeded what a phone's shared memory pool tolerates, and the
three backdrop tiles do not need the resolution. The RGB splat's alpha
channel is **water coverage**, not transparency. The first downsample
through sharp came out with every land texel black: sharp premultiplies
alpha across a resize, and alpha 0 (land) multiplied the colour to 0.

## Decision

`prepare-data.ts` bakes 2048² variants of both rasters
(`scripts/downsample-raster.ts`): class ids with NEAREST (ids must not
blend), the pastel RGB with Lanczos. **Colour and alpha are resized as two
separate alpha-less images** and recombined, so no premultiplication can
touch the colour. Neighbour tiles are served the 2048² variants on every
device; phones take them for the primary tile too (`MOBILE_RASTER_PX`).
A unit test asserts that alpha-0 texels keep their RGB. Which variants
exist is declared in `tileArtifacts()`, not in the script.

## Consequences

- Texture memory for the block drops to roughly a quarter for the
  neighbours; class boundaries there are ~1 m instead of ~0.5 m (visible
  only near a seam or flying low).
- Anyone touching the resampler must keep the split and its test; the
  bake's source files are part of the staleness check, so an edit re-bakes
  all eight variants.
- `sharp` is the build's only native dependency and exists for this one
  function. Replacing it with Bun 1.4's built-in `Bun.Image` (straight
  alpha end to end) is measured and planned (plan 016: +21–24 % PNG size,
  same pixels) but gated on the deploy container running Bun 1.4.

## Alternatives

- **Serve 4096² everywhere:** the phone crashes it was meant to fix.
- **Store water coverage in a separate single-channel raster:** would
  double the texture count; the alpha channel is free in an RGBA sampler.
- **`removeAlpha()` / `premultiplied` flags in sharp:** do not prevent the
  trap.

## References

- Ledger "Rasters at 2048²"; plan 016; `scripts/downsample-raster.ts` and
  its test; `lib/city/tile.ts` (`MOBILE_RASTER_PX`, `landcoverArtifact`).
