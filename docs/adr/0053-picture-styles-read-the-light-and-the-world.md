# ADR 0053: The picture styles read the sun's shadow, the fog and the world, not only the frame's colour

- **Status:** accepted
- **Date:** 2026-10

## Context

[ADR 0034](./0034-picture-styles-as-one-post-pass.md) draws every picture
style as one post pass over the finished frame. By October 2026 the
maintainer judged them unconvincing (thread "Darstellungs-Stile
grundlegend verbessern", 2026-10-29). The renders before the rework
(SwiftShader, the full Dresden tile set, a fly view from 600 m and the
Neumarkt at eye level) showed the same faults in every style:

- **They cut on the fogged picture.** Every threshold read the colour the
  height fog had already pulled towards its own. In the distance a
  building's lit and shaded sides were two greys a few percent apart, and
  Sin City split them into blotches. The lines faded with the same fog
  factor, and the crease threshold grew with distance, so beyond ~150 m
  Papier and Strich were an empty white sheet.
- **Light was guessed from lightness.** Comic and Sin City decided light
  and shade from how bright a pixel was. A dark roof in the sun and a
  white wall in the shade are the same brightness, so flat roofs in the
  sun went black and pale walls in the shade stayed lit.
- **Screens and pens hung on the screen.** Comic's dots and the hand-drawn
  wobble were laid out in screen pixels and swam over the city in every
  flight.
- **The Schwarzplan took the fog.** Its unlit black material kept
  `fog = true`, and from the air the scene's white fog made the figure
  white.

## Decision

**The fog is undone before any cut.** The pass rebuilds the height fog's
factor for each pixel from the depth buffer (`fogFactorAt` in
`height-fog.ts`, the same function `scene.fogNode` uses, now taking a
world and a view position). `unhaze` lifts a colour back out of the fog
colour up to `HAZE_CAP` (0.8). Past that too little colour is left, and
each style draws the haze as its own background: Comic and Papier the
paper, Sin City the white smoke.

**Light comes from the sun's own shadow map.** `sun-rig.ts` hands the
shadow map's depth texture (captured in `OneByteShadowNode`) and
`shadow.matrix` to the post stack. `inSun` projects each pixel's world
position into it and compares, so a surface faces the sun and is not
shadowed, or it is in shade. Comic, Sin City and Strich decide light and
shade this way while the sun is up. After dusk they fall back to
lightness, which the lamps then carry. Outside the shadow frustum a
surface counts as lit.

**Screens are anchored to the world.** Comic's Ben-Day dots and Strich's
hatching are laid on the surface's dominant world plane at 45°. Their cell
comes from a ladder that doubles in size, picked by the metres a pixel
spans there, and two rungs cross-fade, so the screen keeps its size on
screen without swimming. At grazing angles it gives way to its mean tone.
The pens that must hold still in a flight (Comic, Sin City, Strich,
Schwarzplan) have no sway, tremor or lifts (`hand` 0). Film noir and
Papier keep the hand.

**Sin City draws on its own card.** A fourth swap kind, `ink`
(`paper-scene.ts`), draws every surface as white card under the real
light. Foliage is black, red roof faces (the clay's roof colours in the
`facade` attribute) are red, and the ground's water is black
(`paperGroundOn` = 4). The fog is smoke grey. Light then means sun, which
gives the hard black cast shadows the comic is known for.

**Night is each style's own.** Past civil dusk the shadow map has nothing
left to say. Comic prints a navy city: black dots only where the night is
deepest, yellow where the lamps light, paper for a lit window or a lamp.
Sin City leaves its card once the sun is 2° under the horizon
(`Stylize.night`). The card knows only the sun, so the night is cut from
the scene's own frame and its lit windows, lamps and floodlights. A plan
has no night, so Strich keeps its sheet unshaded and drops the light's
hue.

**The Schwarzplan figure takes no fog.** Its hairline (inkWeight 1) parts
blocks that stand in front of each other.

## Consequences

- Every styled frame reads the shadow map once per pixel, one compare tap.
  On a phone that is one texture read against a fill-bound pass. Nothing
  new is allocated: the map exists for the scene.
- Light and shade in the styles follow the shadow map's frustum. Beyond it
  (from ~880 m in fly mode) everything is lit. The fog hides most of that
  far field.
- The Sin City swap is a third swap program the first switch to it builds,
  like Papier's. `PostStack.compile` compiles the swap kinds a tile needs
  (`SWAP_KINDS`).
- The sky is told from the depth buffer as anything past 99.5 % of the
  camera's far plane (the sky dome writes no depth). A fixed distance
  (4 km at first) treated the far city as sky, which drew a hard edge
  past which nothing was stylized, and it moved with every flight.
- A new style that cuts on light uses `inSun`, and a new screen uses
  `surfaceScreen`, never screen-space noise.

## Alternatives

- **Thresholds that adapt to the neighbourhood** (Sin City's old ring of
  eight taps) cannot tell a dark material from a shadow. They split a far
  view into noise.
- **A per-style material that carries light as an extra output** (an MRT
  target) would know the light exactly, but would add a render target at
  full resolution, which is memory a phone does not have.
- **Screen-space dots that scroll with the camera** wobble on every turn.
