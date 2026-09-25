# ADR 0023: Land-cover colours are painted at runtime from one palette

- **Status:** accepted (supersedes [ADR 0016](./0016-land-cover-rasters-downsampled-with-alpha-as-data.md))
- **Date:** 2026-09

## Context

The DLM bake wrote two rasters per tile: the class ids and a pastel RGBA
splat (RGB = palette colour, A = water coverage), plus 2048² variants of
both. The look lived in the bake: a colour change meant re-running the
DLM bake for every tile. The RGBA splat's alpha channel was data, which
forced the colour/alpha split in the downsampler (ADR 0016), a unit test,
an AGENTS.md warning and plan 016 (swap sharp for `Bun.Image`). The same
palette was spelled three times: the bake, the minimap and a shader
fallback.

## Decision

The bake writes class ids only. `lib/city/landcover.ts` holds the one
palette; the terrain paints its colour splat on the GPU at load
(`app/_components/landcover-splat.ts`: one full-screen pass per tile,
RGB = palette, A = water coverage from a 3×3 tent over class 8, into an
sRGB, mipmapped, anisotropic target — what the PNG was sampled with).
The minimap and the `/wissen` picture use the same table. Only the class
raster is downsampled (NEAREST, single band).

## Consequences

- A palette change is a look change: no re-bake, and a per-site palette is
  a table away.
- The committed `landcover_rgb_*` PNGs, their variants, the alpha split
  and plan 016 are gone; no raster whose alpha carries data goes through
  an image tool any more.
- GPU memory is unchanged (the painted splat is RGBA8 with mips, as
  before); KTX2 compression of the splat (plan 018, phase 7) is moot.
- The water shoreline is a 3×3 tent instead of a 1 px Gaussian: slightly
  softer, judged on a real GPU (plan 019).

## Alternatives

- **Palette lookup per fragment from the class raster:** half the texture
  memory, but class ids cannot be mipmapped, so distant boundaries would
  alias; painting once keeps LINEAR + mips + anisotropy.
- **Paint on the CPU at load:** a 16 M-texel loop on the main thread.

## References

- `lib/city/landcover.ts`, `app/_components/landcover-splat.ts`,
  `app/_components/terrain-layer.ts`, `app/_components/water-layer.ts`;
  ledger "Surface colours"; ADR 0016.
