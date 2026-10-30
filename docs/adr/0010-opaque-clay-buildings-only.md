# ADR 0010: The look — opaque clay on a painted ground, colours within one palette, detail drawn softly

- **Status:** accepted
- **Date:** 2026-06, rewritten 2026-10 (absorbs ADRs 0015, 0016, 0023, 0049 and the colour rules of ADR 0038)

## Context

The default picture is the product: a pastel, archviz city of clay on
paper. Earlier building styles (raw LoD colours, transmissive "ghost"
glass) doubled every shader or rendered the scene twice. A procedural
window grid read as an office block over historic silhouettes; raw OSM
colours put a signal-red facade into a pastel city. Detail has to come
from data, read the same on every house, and stay calm.

## Decision

1. **One building material: opaque clay** with a per-building tint and the
   facade terms of the clay shader. No `transmission`, no textures, no
   second building style. Other looks are picture styles over the frame
   (ADR 0034).
2. **Colour comes from data and stays in the palette.** Roofs from the
   orthophoto under each roof, lifted by a hue-preserving vibrance; walls
   from OSM colour, else material family, else use. A mapped colour keeps
   its hue with capped saturation and held lightness. Glass and metal are
   object flags with a subtle response, not a texture.
3. **The ground is painted at runtime from one palette**
   (`lib/city/landcover.ts`): the bake writes class ids only, so a colour
   change is a code change, not a re-bake.
4. **Windows are drawn by the clay's fragment shader on every house** —
   a recess with a sill, never glass, panes or mullions. Their rhythm per
   building is measured where open street photos saw it (Panoramax,
   Mapillary — never Google Street View), else a neighbour's, else its
   type's. None on party walls, over doors or shopfronts; a monumental
   facade gets no town-house windows (listed palaces a kind of their own,
   churches none). No window row below the ground in front of the wall.
5. **Facade parts are soft, abstract geometry**: plinths, cornices, doors
   from OSM entrances, dormers, shopfronts — rounded profiles, never hard
   bevels, relief lit from above and never darker than the wall.
   Landmarks get none of the generic parts.
6. **One named exception to "no glass":** a shop's ground floor shows
   muted glass at the back of a soft niche, without mullions.
7. **Night:** walls do not glow; every unlit or additive layer is dimmed by
   the one night factor.
8. **Water is matte** (a sun path, glints, gentle waves); fountains keep
   their sky mirror.

## Consequences

- One shader budget, spent on post and shadows, not on a second scene.
- A new building attribute is a row in the object table that tints within
  the palette, never a texture.
- A new facade term must fit the clay's varyings (ADR 0027) and read the
  flat facet normal.

## Alternatives

- **Ghost (transmission) or raw LoD styles:** a style that halves the frame
  rate is a trap.
- **A window grid, a window texture, glass panes:** the veto's core.
- **Geometry niches for windows:** plump at the mesh's precision and only
  on measured walls; a street with every thirtieth house windowed was
  rejected.
- **Blending roofs toward terracotta:** destroyed the real copper greens.
- **Raw OSM colours:** pure hues in a pastel city.
- **A palette lookup per fragment:** class ids cannot be mipmapped.
