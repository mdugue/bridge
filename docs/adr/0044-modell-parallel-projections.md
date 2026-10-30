# ADR 0044: Modell — the city in parallel projection, every pass reading the camera through a lens

- **Status:** accepted
- **Date:** 2026-10

## Context

Planners read a city in drawings: isometry, Militärperspektive, Lageplan,
Ansicht, Schnitt, Schwarzplan, the shadow study — all parallel
projections at a stated scale. Everything after the scene pass assumed a
perspective camera. A long-lens fake was only nearly parallel, lost float
precision, could not shear, and still broke every depth-keyed term.

## Decision

1. **A real parallel camera.** Modell (`M`) is a third mode beside walking
   and flying, an `OrthographicCamera` sheared for the Militärperspektive
   (`model-camera.ts`). Pan, zoom, turn and tilt never leave the
   projection; coming nearer only changes the scale.
2. **One post pipeline, read through a view lens** (`view-lens.ts`): no
   pass holds the real camera. Depth becomes distance through the lens, a
   pick ray through `setPickRay`, a material's view direction through
   `viewDirection()`, a distance-keyed look through the equivalent
   distance. Entering Modell builds nothing.
3. **Scale, not distance.** The shadow frustum fits the footprint, the
   vegetation and lamps read an eye at the equivalent distance, fog and sky
   are off, the background is the style's paper.
4. **Each terrain level carries its trees** (the coarse level a third of
   them, wider), so a parallel picture shows trees whichever level the
   renderer loads. Modell has no tree rule of its own.
5. **Cuts are prepared before they show:** the Ausschnitt shows once both
   sides of its clipping are compiled and held (`holdCut`); its shadows
   stay unclipped.
6. **Text lives on the HUD and in the export**, never in the scene: scale
   bar, north arrow and legend; *Bild speichern* and the shadow study add
   them to the exported sheet.

## Consequences

- A new pass that turns depth into distance, a new ray or a new view
  direction goes through the lens; reading `camera.fov`, `camera.position`
  or TSL's `cameraPosition` for a direction is a bug in Modell.
- Screen passes built on frame updates render once per animation frame;
  anything that renders the frame twice in one (the export's tiles)
  spreads over frames.

## Alternatives

- **The long lens:** nearly parallel, no shear, the same post rework.
- **A second post pipeline for the parallel camera:** a second set of
  builds a phone tab cannot afford, and a hitch on entry.
- **Trees by scale, or none past a scale:** two rules for one picture that
  disagreed wherever the coarse level showed early.
- **Lettering in the scene:** against ADR 0042's wordless scene.
