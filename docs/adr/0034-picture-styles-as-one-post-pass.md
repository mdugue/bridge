# ADR 0034: Picture styles are one post pass over the clay scene, reading the light and the world

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10

## Context

Beside the default *Pastell* the viewer offers picture styles: Comic,
Film noir, Sin City, Papier, and for Modell Strich and Schwarzplan.
Most of what they change is a property of the finished picture — where
the edges are, how many tones a colour gets, whether there is colour at
all — and the depth buffer the post pipeline already reads carries the
edges. ADR 0010 closed the path of one material per style.

## Decision

1. **A style is one node over the frame** (`stylize-effect.ts`), driven by
   a table (`lib/city/render-style.ts`) and one look value, `style` (in the
   Snapshot, cycled with `V`, remembered in local storage). *Pastell* draws
   without the node. No scene material knows the style; a new style is a
   table row and a mode in the node.
2. **Lines come from the second difference of inverse view depth**, read
   at integer texel radii; the node branches only on the mode, so
   derivatives and texture reads stay in uniform control flow.
3. **Where a post pass cannot make the style, a render-time swap does**,
   owned by the post stack and undone after the render: Sin City, Papier,
   Strich and Schwarzplan draw every surface with one card material of
   their kind under the real light (`scene.overrideMaterial`, the row's
   `paperScene`). The ground alone opts out
   (`userData.paperOwn`) and draws its paint and water itself under one
   shared uniform. A style's own crowns and lamp cones are visibility
   swaps of tagged siblings (`style-dressing.ts`).
4. **Styles read the world, not the screen:** the fog is undone before any
   cut; light and shade come from the sun's own shadow map; screens
   (dots, hatching) are laid on the world's dominant plane with a cell
   size chosen by metres per pixel; pens that must hold still in a flight
   have no sway. Night is each style's own.
5. **A still view is still, a move moves smoothly.** Nothing a style
   draws may change between two frames of a still camera, or flip in a
   sub-pixel step: a screen too fine for its pixel gives way to its mean
   tone, a step a pixel or two tall draws no line, and no screen slides
   over moving geometry — a crown is printed flat, or the style holds it
   still (`sway`). Measured, not judged by eye (the `flicker-probe`
   skill).
6. **No style is warmed ahead** (only the selection outline is); a style
   builds on its first frame.

## Consequences

- New layers get outlines for free, and so does demolish.
- A non-default style costs fill rate only while chosen.
- A layer that wants its geometry dressed tags it and never reads the
  style. A style crown keeps the scene crown's anchor and size.
- Anything that writes no depth (water sheets, mist) gets no outline.

## Alternatives

- **Toon shading per material:** every shader patched once per style.
- **A normal buffer and Sobel:** a second geometry pass for what the
  depth difference already finds.
- **Bake-time outlines from the CityJSON:** buildings only, and a switch
  would toggle geometry.
- **Papier from colour alone:** albedo and light cannot be told apart in
  the finished frame.
- **Adaptive thresholds for light:** cannot tell a dark material from a
  shadow.
- **A light buffer per style (MRT):** a full-resolution target a phone
  cannot spare.
- **Screen-anchored dots and hatching:** they swim on every turn.
- **Warming every style's programs at idle:** cost an iPhone tab its
  memory and compiled Papier for every landing tile on a desktop.
- **A history buffer (temporal antialiasing) against the flicker:** a
  full-resolution target more on a phone (ADR 0047), and it smears the
  ink in a move.
