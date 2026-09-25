# ADR 0031: Picture styles are one optional post pass over the clay scene

- **Status:** accepted
- **Date:** 2026-09

## Context

The pastel look (clay on paper, ADR 0010) is the product. The maintainer
asked for further styles to switch to at runtime — a comic with fine,
hand-drawn outlines and flat colour areas, film noir, Sin City. ADR 0010
removed the earlier building styles because each one was a second material
path (every shader patch twice) or a second scene render (transmission),
and rejected ink outlines built from `EdgesGeometry` (seconds at boot and
on every demolish) and Sobel outlines *in the default look*.

Everything these styles change is a property of the finished picture:
where the edges are, how many tones a colour gets, whether there is colour
at all. The depth buffer the composer already shares with N8AO and DoF
carries the edges; the colour buffer carries the rest.

## Decision

A picture style is one `EffectPass` (`stylize-effect.ts`) between depth of
field and the SMAA pass, driven by a table (`lib/city/render-style.ts`)
and one look-store value, `style` (persisted in the Snapshot, cycled with
`V`). The default *Pastell* has shader mode 0, which disables the pass: the
default frame is the one from before styles existed. No scene material
knows the style. The other styles share one program; the mode is a
uniform. Per style the table also weights the existing *Tiefenfärbung*,
*Papierkorn* and new *Tuschelinien* sliders, sets the vignette, switches
the grain to animated film grain and may gate depth of field (a gate, like
the motion regression, never a write to the user's switch).

Lines come from the second difference of inverse view depth, which is zero
on any plane: relative to `w` it marks silhouettes, relative to the local
slope it marks folds at any distance. The hand-drawn quality is a
screen-fixed noise that wobbles the lookup by about a pixel and swells the
stroke weight.

## Consequences

- Switching a style costs no rebuild and at most one compile (the first
  non-default style); the e2e control walk draws frames through it.
- A non-default style adds one full-screen pass of ~17 depth taps — fill
  rate, the scene's bottleneck, but only when chosen.
- New scene layers get outlines for free, and so does demolish (the depth
  buffer changes with the index buffer).
- Screen-space noise and halftone are anchored to the screen, not the
  world: they swim slightly under camera motion. Accepted as the style's
  hand; a world-anchored hatch would need per-material work, which is what
  this decision avoids.
- The depth buffer is read NEAREST at integer texel radii only — a
  fractional radius inks whole grazing surfaces (see `docs/rendering.md`).
- Anything whose outline matters but writes no depth (water sheets, mist)
  gets none.

## Alternatives

- **Per-material toon shading** (a cel ramp in the clay, terrain and
  vegetation shaders): cleaner bands, world-anchored hatching — but every
  shader patched once per style, the path ADR 0010 closed.
- **Normal buffer + Sobel:** a second geometry pass (or MRT on every
  material) for what the depth second difference already finds.
- **Bake-time outlines from the CityJSON rings** (ADR 0010's suggestion):
  buildings only, not trees, terrain or dressing, and a style switch would
  have to toggle geometry.
- **Kuwahara / painterly filter for the flat areas:** 60+ colour taps per
  pixel; the tone bands plus lines already read as flat colour.

## References

- `lib/city/render-style.ts`, `app/_components/stylize-effect.ts`,
  `app/_components/post-stack.ts`, `app/_components/paper-grain-effect.ts`
- ADR 0010 (clay only), ADR 0017 (look table and snapshot contract)
- `docs/rendering.md` "Post-processing"
