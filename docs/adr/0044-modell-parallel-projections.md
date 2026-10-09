# ADR 0044: Modell — the city in parallel projection, through one pipeline and a view lens

- **Status:** accepted
- **Date:** 2026-10

## Context

Urban planners read a city in drawings, not in walks: the 30° isometry,
the Militärperspektive, the Lageplan, the Ansicht and the Schnitt, the
Schwarzplan, the shadow study for the equinox and the solstices — all of
them parallel projections, at a stated scale, with a north arrow and a
source. The viewer had one perspective camera, and everything after the
scene pass assumed it: depth became distance by the perspective formula
(AO smoothing, grading, the stylize pass's sky test and edge metric, the
selection outline), the stylize pass read `camera.fov`, the tram wires
floored their width with a perspective formula, picking used
`Raycaster.setFromCamera`, the shadow frustum, the vegetation tiers, the
map overlay and the fog keyed off the camera's height or distance.

The prototype (plan 055) faked a parallel view with a long lens: the
perspective camera 40 km back, a sub-degree FOV. It looked right, but it
is only *nearly* parallel (2.5 % front to back over a 1 km deep view),
loses float precision at that distance, cannot draw the sheared
Militärperspektive, and still broke every depth-keyed post term.

## Decision

**A real parallel camera.** Modell is a third view mode beside Gehen
and Fliegen (`M`, the sidebar's segmented control, the HUD toolbar). Its
camera is three's `OrthographicCamera`, subclassed (`model-camera.ts`)
to multiply a shear onto the projection for the Militärperspektive
(view-space y' = y + k·(z + standoff): x and depth untouched, so depth
stays linear). The pure half (`lib/city/model-view.ts`) owns the views'
table (Isometrie at the true 35.26° tilt, Vogelschau, Militär, Lageplan,
Ansicht, Schnitt), the scale (metres per CSS pixel ↔ 1 : n at 96 dpi,
1:250 … 1:25 000), pan / zoom about the pointer / turn / tilt, the
footprint, the scale bar and north arrow, and the dolly-zoom in and out
of the perspective view. **Free roaming stays parallel**: pan, turn and
zoom never leave the projection; coming nearer only changes the scale.
A view from inside a street stays a perspective thing.

**One post pipeline, read through a view lens.** No pass holds the real
camera. They read a stand-in `PerspectiveCamera` (`view-lens.ts`) that
copies near, far, projection and world matrices from the camera drawing
the frame, plus two uniforms: `ortho` (a per-pixel select between
`orthographicDepthToViewZ` and `perspectiveDepthToViewZ`) and
`equivalent` (the distance a 55° camera would show the same picture
from, for every far-field fade). Builds are keyed by material and render
context, not camera, so the scene's build-time camera branches
(`positionViewDirection`, points' size attenuation) keep their
perspective builds; the parallel camera therefore stands 20 km back
along the view (`MODEL_STANDOFF`), where its view vectors are within a
fraction of a degree of the true direction — except in a
Militärperspektive, whose shear tilts the true direction 45° off the
camera's forward. What the scene's materials read of the view (a Fresnel
rim, a mirror, a window's recess) therefore comes from `viewDirection()`
(`view-direction.ts`, 2026-10-09; `eyeDirectionView()` in view space, in
place of TSL's `positionViewDirection`): the camera's place in
perspective, one direction for every pixel in a parallel projection,
unprojected each frame like a pick ray. Tiles and dressings still compile with the
perspective camera. Entering Modell builds nothing.

**Picking unprojects.** One `setPickRay` (`view-ray.ts`) unprojects the
near and far plane for any camera, so the sheared camera picks right;
a parallel ray starts at the scene's top, not 20 km out. Inquiry,
demolish and double-click centring all use it.

**Scale, not distance.** In Modell the shadow frustum fits the
footprint (half-octave steps, 110–1600 m on desktop, 880 m on phones),
the vegetation tiers, lamp lights, map overlay and soundscape read an
eye above the pivot at the equivalent distance, the distance fog is
open, the sky dome hidden and the background the style's paper. Depth
of field, grading and the vignette are off.

**Each terrain level carries its trees** (2026-10-04, revised twice on
2026-10-05). A parallel picture loads one terrain level across the
whole sheet, and the trees rode on the fine one: past 2.5 m/px (about
1 : 9 450) they all went at once. The fine level now draws every tree
and the coarse level a fixed third of them, chosen by a hash of where
each stands, as tall and √3 wider so a wood covers what the whole one
did — baked per tile by the build from the fine level's own placement
(`crowns_<t>.crw.gz`, lib/city/coarse-crowns.ts) and drawn whenever the
coarse level is, in every mode. Modell has no tree rule of its own: the
picture shows the trees of whichever level the renderer shows.

Two versions lost on the way. The first thinned the trees to none at
1 : 9 000 and let the ground's green be the vegetation — an overview of
the city showed no tree at all, which is not how a planner's axonometry
reads. The second generalized them by scale, as a plan does — every tree
to 1 : 5 000, a floor of 30 % from 1 : 9 000, folded in the crown
shader — and fetched the coarse level's crowns only once Modell thinned.
That was two rules for one picture, and they disagreed: the coarse level
shows wherever the fine one is not loaded, not only past 2.5 m/px — the
memory governor raises the error target ×2 to ×8 (×4 puts the switch at
≈ 1 : 2 400), and fine tiles take a moment to load — so at 1 : 3 000 a
picture could show no tree at all. Keeping the fine level, and so the
trees, for the whole series was weighed and lost: at 1 : 10 000 a
desktop picture covers 9–12 tiles, which a fine level's rasters do not
fit in the tile cache. What else rides on the fine level and has to be
carried by the coarse one is the constraint this sets — the bridges and
the trees are; the rest (lamps, furniture, walls) is below a pixel past
2.5 m/px, and goes with the fine level where a device saves memory.

**The Ausschnitt shows once its programs are held** (2026-10-04).
Switching a `ClippingGroup` switches the build of every drawable under
it; three keeps one render object per drawable for both sides and frees
the build a switch leaves. The first cut froze the picture while the
whole city's programs built in one frame, and so did every switch after
it, both ways — long enough on a phone for the tab to die. A cut now
shows when both sides are compiled off the frames on stand-ins and held
(`holdCut`), the HUD saying *Wird vorbereitet …* until then, and is let
go a frame after it is lifted. The shadow pass stays unclipped — no
compile ahead reaches it, and clipped it rebuilt every caster in the
frame that showed the cut: a building outside casts over the cut's edge.
Rejected: drawing the cut-out frames into a second render target (their
own render context, both sides alive at once) — every post pass reads
the scene target; and clipping always (a cut that moves only its
planes) — every material in every mode would carry the clip.

**The legend is HUD and file, never scene.** The scale bar (with its
numbers — the maintainer's call) and the north arrow are HUD glass, the
minimap draws the picture's footprint; the export (`image-export.ts`)
draws the same legend, the printed scale at 300 dpi and the sources'
credits into the PNG's strip. ADR 0042 holds: no text in the scene.

**The export is tiled.** A parallel view is rendered larger than the
canvas by sliding the frustum (`setViewOffset`) over overlapping tiles
of the canvas's size, each margin cut away (the screen-space passes see
the frame's edge there): no tile costs more memory than a frame, the
picture up to 4× the canvas and 25 MP (desktop aims at 3 image px per
CSS px, phones at 2). A perspective frame is taken as it is — its
vignette and depth of field belong to the whole frame.

**The planner styles are picture styles** (ADR 0034), selectable in
every mode: *Strich* (Papier's white card on the ground in muted plan
colours, a constant one-pixel pen, shade as one light grey wash) and the
*Schwarzplan* (the clay, tagged `userData.figure`, drawn unlit black;
the terrain white; everything else hidden for its frames; one threshold
cuts the light away). Both go through the Papier swap
(`paper-scene.ts`, now one of three kinds) and the terrain's
`paperGroundOn` uniform — no branch in a layer.

## Consequences

- Three new rows in the code's camera assumptions: a pass that reads
  depth goes through the lens, a ray through `setPickRay`, a distance-
  keyed look through the equivalent distance. A new one that reads
  `camera.fov` or `camera.position` directly is a bug in Modell.
- Snapshots gain an optional `model` member; a reader without it shows
  the perspective pose Modell would leave to (ADR 0017: add, never change
  a meaning).
- The scene's camera-keyed branches are approximate in Modell (the
  specular highlight's view vector, the halo size), by a fraction of a
  degree. Judge them on a GPU before tightening.
- The shadow map covers 1:5 000 on desktop; beyond the footprint cap the
  baked horizon map shades the ground, as in perspective.

## Alternatives

- **The long lens** (plan 055's prototype): only nearly parallel, float
  precision at 20–200 km, no shear, and the post passes needed the same
  rework anyway. Lost.
- **A second post pipeline built for the ortho camera**: correct builds
  for every camera branch, but a second set of node builds (a phone tab's
  memory, the reason a phone's post profile warms no Papier programs —
  `postProfileFor`, ADR 0047) and a hitch on first entry.
  The lens made it unnecessary.
- **Lettering on the sheet** (scale numbers, labels in the scene):
  ADR 0042 and plan 032's removal stand; the numbers live on the HUD's
  glass and in the export's strip.

## References

- [Plan 055](../plans/055-model-view-parallel-projections.md)
- `lib/city/model-view.ts`, `lib/city/image-export.ts`,
  `app/_components/{model-rig,model-camera,view-lens,view-ray,image-export,projection-panel,model-instruments}.ts(x)`
- ADR 0027 (node materials, public API), ADR 0034 (picture styles),
  ADR 0042 (no text in the scene), ADR 0017 (snapshot contract)
