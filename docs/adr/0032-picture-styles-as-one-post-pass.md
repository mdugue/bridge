# ADR 0032: Picture styles are one optional post pass over the clay scene

- **Status:** accepted
- **Date:** 2026-09

## Context

The pastel look (clay on paper, ADR 0010) is the product. The maintainer
asked for further styles to switch to at runtime — a comic with fine,
hand-drawn outlines and flat colour areas, film noir, Sin City, and later
"Papier": the city as a white paper model with real light and shadow. ADR 0010
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

Papier is the one style a post pass cannot make: it needs every surface
white with its shading intact, and a colour does not say how much of it is
surface and how much is light. For that style's frames only, the post
stack sets `scene.overrideMaterial` to one white paper material
(`paper-scene.ts`) and hides what that material cannot stand in for
(sprites, glows, see-through sheets without depth); the render restores
the scene right after. That is a render-time swap owned by the post stack
— still no branch in any layer's material, and nothing a tile builds knows
about it.

The same frame-scoped swap dresses a style's geometry
(`style-dressing.ts`): Comic draws its trees as cartoon clouds of three
balls, Papier as folded card polyhedra, and Film noir hangs a soft light
cone under every street lamp (faint by day, full at night — no forced
night). The layers only tag what may be dressed (`userData.styleCrown`,
`userData.styleLampHeads`); the swap happens before the render and is
undone after it, and a style change redraws the shadow map because the
crowns cast. Sin City's rain is drawn in the pass instead: streaks on a
grid of world directions in three depth layers, each hidden behind nearer
geometry — as scene geometry it would not survive the style's threshold.

Lines come from the second difference of inverse view depth, which is zero
on any plane: relative to `w` it marks silhouettes, relative to the local
slope it marks folds at any distance. The hand-drawn quality is a
screen-fixed noise that wobbles the lookup by about a pixel and swells the
stroke weight.

## Consequences

- Switching a style costs no rebuild and at most one compile (the first
  non-default style); the e2e control walk draws frames through it.
- A non-default style adds one full-screen pass of ~17 depth taps — fill
  rate, the scene's bottleneck, but only when chosen. Sin City adds nine
  colour taps (a blur before its threshold, so it draws masses, not
  stipple) and four depth taps for the skyline; the pass is therefore
  marked CONVOLUTION, which is free while it holds this effect alone.
- The pass knows a surface's slope (a normal rebuilt from the depth
  buffer's derivatives against world up), which is how Sin City keeps its
  red to pitched roofs: a post pass can tell a roof from the ground by
  geometry where colour alone cannot.
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

- A layer that wants its geometry dressed by a style tags it; it never
  reads the style. A style crown must keep the scene crown's anchor and
  size, so every instance matrix fits (`buildStyleCrownGeo`).
- Papier costs the scene render its specialised shaders (wind sway, water
  wobble, the terrain's ground detail): the white model is static and
  plain by design. The override material compiles a few programs
  (instanced, vertex-coloured, plain) the first time the style is chosen.

## Alternatives

- **Per-material toon shading** (a cel ramp in the clay, terrain and
  vegetation shaders): cleaner bands, world-anchored hatching — but every
  shader patched once per style, the path ADR 0010 closed.
- **Normal buffer + Sobel:** a second geometry pass (or MRT on every
  material) for what the depth second difference already finds.
- **Bake-time outlines from the CityJSON rings** (ADR 0010's suggestion):
  buildings only, not trees, terrain or dressing, and a style switch would
  have to toggle geometry.
- **Papier from colour alone** (desaturate, lift, normalise locally):
  albedo and light cannot be told apart in the finished frame — green
  crowns stay grey, a lit dark roof and a shaded light wall meet.
- **Kuwahara / painterly filter for the flat areas:** 60+ colour taps per
  pixel; the tone bands plus lines already read as flat colour.

## References

- `lib/city/render-style.ts`, `app/_components/stylize-effect.ts`,
  `app/_components/post-stack.ts`, `app/_components/paper-grain-effect.ts`
- ADR 0010 (clay only), ADR 0017 (look table and snapshot contract)
- `docs/rendering.md` "Post-processing"
