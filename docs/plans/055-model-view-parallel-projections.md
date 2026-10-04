# Plan 055: *Modell* — the city in parallel projection, the way planners draw it

> **Executor instructions**: Read fully first, then ADR 0027 (node
> materials, public API only), ADR 0034 (picture styles are one post
> pass), ADR 0042 (the scene stays wordless) and the two audits under
> *Current state*. Phase 0 is a spike on a real GPU and **decides the
> camera architecture**; do not start phase 1 before its findings are
> appended below. Every look in this plan is unjudged until it has been
> seen on a GPU (`bun run shots --headed`, plan 019). Update the status
> row in `docs/plans/README.md` when a phase lands.

## Status

- **Priority**: P2 (direction — the maintainer asked for it on 2026-10-03)
- **Effort**: L (phase 0 S, 1 L, 2 M, 3 M, 4 M, 5 S–M)
- **Risk**: MED–HIGH — the first second camera kind in the viewer: every
  depth-reading post term, every distance-keyed LOD and the shadow fit
  assume one perspective camera at eye level or in the air
- **Depends on**: nothing to start; phase 2's export wants plan 048's
  `?snap=` transport (a link to the same view); phase 5 meets plan 054
  phase 2 (sun hours)
- **Planned at**: 2026-10-03, commit `0568c26`
- **Status**: **DONE** — decided and built 2026-10-03 (below, *As built*);
  still to judge on a real GPU: the scene's perspective-built specular and
  halo branches, the water glitter in a parallel view, Strich's washes

## Decisions (2026-10-03, the maintainer)

- **Everything is in scope now**: the planner styles *Strich* and
  *Schwarzplan*, the image export with scale bar, north arrow and credits,
  and the shadow study (21.3. · 21.6. · 21.12.) are built with Modell,
  not later.
- **The scale bar carries its numbers.** It is HUD legend on the HUD's
  glass; nothing is pinned into the scene (ADR 0042 holds).
- ***Strich* and *Schwarzplan* are picture styles like the others**:
  selectable in every mode (Gehen, Fliegen, Modell), `V` cycles through
  them.
- **A real parallel camera**, no long lens.
- **Free roaming stays parallel.** In Modell the view pans, turns and
  zooms freely and stays orthographic; Isometrie keeps its 35.26° tilt
  while the turn is free (the 30° holds for the turned axes), Vogelschau
  tilts too. "Flying through a street" stays a perspective thing: in a
  parallel view coming nearer only changes the scale, and a view at eye
  level is an Ansicht.

## As built (2026-10-03)

All five phases landed together ([ADR 0044](../adr/0044-modell-parallel-projections.md)).
Where the build differs from the plan below, the build wins:

- **One pipeline, not two.** The post passes read the active camera
  through a stand-in (`view-lens.ts`); the parallel camera stands 20 km
  back so the scene's perspective-built camera branches stay right
  (*Rendering*). Phase 0's spike and its STOP were not needed: entering
  Modell builds nothing.
- **Esc stays the card's and the immersive mode's**; `M` alone leaves.
- **The Schnitt cuts at the near plane**; the clay is drawn two-sided
  while it shows (a second build of the clay's graph, made on the first
  Schnitt) and its back faces are the poché. The paper styles' card is
  one-sided, so in *Papier* and *Strich* a cut building is open.
- **The Ausschnitt clips by planes, buildings included** (a
  `ClippingGroup` around the city's group; its four planes are
  uniforms): a building on the edge is cut, as a model cut from a city
  model is. Keeping or dropping whole buildings by their centroid needs a
  per-object centroid in the object table — not done. The cut-out is a
  north-aligned square (a rhombus in the Isometrie), 80 % of the largest
  the picture holds; it ends with Modell and is not in the snapshot. Its
  first use builds the clipped programs in the frame (no compile ahead).
  No plinth along the site's own edge.
- **The export is tiled one tile per animation frame** (three's SMAA and
  GTAO render once per frame), up to 4× the canvas and 25 MP; a
  perspective frame is taken as it is. A veil covers the canvas while
  the tiles are taken.
- **The shadow study is one sheet of 3 dates × 4 hours** (21.3., 21.6.,
  21.12. of the year shown; 9, 12, 15, 18 Uhr, the device's local time),
  each panel a full capture, scaled to a sheet ≤ 6 000 px wide. The
  date/hour chips sit in *Sonne & Zeit* in every mode.
- **Strich and Schwarzplan** are picture styles in every mode (V cycles
  through seven). The Schwarzplan hides everything but the clay and the
  ground — trees, walls, furniture, bridges, rails.

Follow-ups (2026-10-04): the two-finger twist turned the ground against
the fingers (the turn's sign; `twistedTurn` and its test now hold it);
the trees thin out with the scale (all to 1 : 5 000, none from
1 : 9 000) instead of all leaving at the fine terrain's 2.5 m/px — ADR
0044, *Trees follow the scale*; and *Erkunden* puts Modell's
*Projektion* right under the mode switch, with the viewpoints and
landmarks merged into one list of *Orte* below it.

## Why this matters

Planners do not look at a city from a pedestrian's eye or a drone. They
look at it in **parallel projection**, where sizes do not shrink with
distance, parallel edges stay parallel and a scale bar is true everywhere
in the picture. Competition entries, Rahmenpläne, Gestaltungssatzungen and
shadow studies are drawn in a small, fixed set of views. The viewer
already has the material those views are made of — LoD2 masses, a clay
"Tonmodell auf Papier" look, a white *Papier* model, ink lines, a true
sun for any date — but only a perspective camera to show them.

The views, and what they are called in German practice:

| View | Geometry | Planners use it for |
|---|---|---|
| **Isometrie** | parallel; camera tilted 35.26° (arctan 1/√2) below the horizon and turned 45°, so the three axes are foreshortened equally and horizontal edges run at **30°** to the picture's horizontal | the "30° iso" of competition sheets, block studies |
| **Vogelschau** (dimetric) | parallel; tilt free (default 30°), turn free | overview axonometries, presentation |
| **Militärperspektive** (planometric axonometry) | *oblique* parallel: the **plan stays true** (undistorted, rotated 30°/60° or 45°/45°), verticals stay vertical at full (or ⅔) height | the classic German competition axonometry; footprints measurable in the picture |
| **Lageplan / Draufsicht** | parallel, straight down, north up | site plans; with the *Schwarzplan* style the figure-ground plan |
| **Ansicht / Abwicklung** | parallel, horizontal, everything in front of a cut line removed | street elevations, the Elbe silhouette |
| **Schnitt** | an Ansicht whose cut faces are filled (poché) and whose ground is drawn as a profile line | site sections, Geländeschnitte |

Around those views planners expect a **Maßstab** (scale bar, scale steps
1:500 … 1:10 000), a **Nordpfeil**, rotation in fixed steps, a
**Massenmodell / Weißmodell** look (white masses, true shadows), the
**Schwarzplan**, **Verschattungsstudien** (21 March / 21 June /
21 December at fixed hours) and an **image export** with scale, north
arrow and credits.

## The proposal in one paragraph

A third camera mode, **Modell**, next to *Gehen* and *Fliegen*. It
looks at the city as a model on a table: the camera orbits a **pivot on
the ground** in parallel projection, pans like a map, zooms in scale
steps and turns in 45°/90° steps. Its views are presets (Isometrie,
Vogelschau, Militärperspektive, Lageplan, Ansicht). The picture styles
stay the picture styles (ADR 0034); Papier becomes the Weißmodell, and two
planner styles are added (*Strich*, *Schwarzplan*). The HUD swaps the
walk/fly instruments (joystick, altitude stick, crosshair) for a north
arrow with rotate buttons and a scale bar. Text stays in the card and
the HUD (ADR 0042); the scene stays wordless. No bake, no new data.

## How it looks

Prototype plates of the Altstadt (rendered with a long-lens approximation
of a parallel projection through a local hack, under SwiftShader — the
composition is right, the light and anti-aliasing are not a GPU's) are in
the PR that adds this plan. The hack: the one perspective camera 40 km
back at a ≈ 1° FOV, near/far around the scene, the distance fog off, the
shadow fit and the vegetation LOD keyed to the target. What the plates
showed beyond the composition:

- **Papier and Comic drew nothing but paper** until the stylize pass's
  depth was measured from ~1.2 km instead of 40 km: its sky test
  (`SKY_Z` 4 000 m) took every pixel for sky. With that offset Papier is
  a convincing Weißmodell; the Comic **ink lines are still missing** (the
  1/z edge metric sees no jumps at that depth ratio) — the depth helpers
  and the ortho edge metric below are needed, not optional.
- **Depth grading tinted the whole sheet cool** (everything was "far");
  with grading at 0 the Pastell plate reads like a model on a table.
- **The vegetation appeared only after its dressing finished** — with
  the LOD keyed to the camera 40 km away every chunk is "far"; keyed to
  the target the trees look as on foot.
- **The Ansicht works by the near plane alone**: the Neustadt in front of
  a cut in the Elbe is gone and the Altstadt silhouette stands; the cut
  through the ground shows as a band of smeared land-cover colour — the
  ground profile of phase 3 replaces it.
- **The Lageplan's shadows** (21 March, 10:00; frustum pinned on the
  target at its 880 m cap) came out soft and blotchy under SwiftShader —
  judge them on a GPU before tuning the footprint fit's texel size.

What the look rules are:

- **Paper, not sky.** A parallel view looking down has no horizon; where
  the site ends the model ends on the paper colour of the current style
  (Pastell `#efe6d8`, Papier white), not in sky or haze. The site's outer
  edge is shown as a cut (phase 4: a plinth), not dissolved.
- **No distance fog, no depth grading, no vignette, no DoF.** In parallel
  projection "far" means "higher up the sheet", and haze or a cool tint
  there reads as an error. The valley pool fog (world-Y) may stay as a
  faint wash in the Elbe valley — judge on a GPU.
- **Shadows are the drawing.** With the shadow frustum fit to the visible
  footprint (below), a parallel view is the best case for a shadow map:
  every pixel covers the same ground, so one map at roughly one texel per
  screen pixel is uniform across the picture — no cascades needed.
- **Line weight is constant.** Ink lines (Comic, *Strich*) are in screen
  pixels and do not thin with distance, as on a drawn sheet.
- **Trees are drawn the same everywhere.** The vegetation LOD keys off
  the view's scale, not the camera's distance, so a tree at the top of
  the sheet is drawn like one at the bottom.

## How it fits the interaction design

### The mode

`Gehen | Fliegen | Modell` in the sidebar's segmented control
(`scene-sidebar.tsx`), **M** on the keyboard (free today; `P` is promised
to plan 053's play button), and a *Modell* tool in the HUD toolbar
(`hud-toolbar.tsx`) on touch. Entering glides; leaving glides back
(*Transitions*). The mode is a camera mode, not a picture style: any
style can be used in it, and the style picker and `V` work unchanged.

### Input

| Input | Gehen / Fliegen today | Modell |
|---|---|---|
| Drag (mouse, one finger) | look around | **pan** the ground under the pointer (grab the map) |
| Right-drag / Ctrl-drag, two-finger twist | — | **turn** about the pivot; released, snaps to the nearest 15° |
| Shift + right-drag, two-finger vertical drag | — | **tilt**, snapping to the presets' angles (90°, 45°, 35.26°, 30°, 0°) |
| Wheel / pinch | move forward (Alt: FOV) | **zoom** about the pointer; Shift+wheel steps through the scale series |
| W A S D, arrow keys | move | pan (Shift: faster) |
| Q / E | sink / climb | turn −90° / +90° |
| + / − | — | one scale step in / out |
| Double-click / double-tap | glide to the spot | **centre** the pivot there (a short pan glide) |
| Click / long press / I | ask | ask — unchanged (the pointer, not a crosshair) |
| R | demolish at the crosshair | demolish the **asked** building |
| 1–9, landmark chips | glide to a viewpoint | **re-centre** the pivot on the viewpoint's spot, keep the view |
| F | walk ↔ fly | leave Modell into Fliegen |
| M | — | leave Modell (Esc stays the inquiry card's and the immersive mode's: one key, one meaning) |

### The HUD

| Region | Gehen / Fliegen | Modell |
|---|---|---|
| Centre | crosshair | none (asking follows the pointer) |
| Bottom-left | virtual joystick | **Nordpfeil** (rotates with the view; a click turns north up) with ⟲ ⟳ (90°), above it the **Maßstabsleiste** (a graphic scale bar 0–50–100 m, black and white segments). It measures every length parallel to the picture plane — the picture's horizontal in every parallel view, and in Lageplan, Militärperspektive (the ground) and Ansicht every length in the drawn plane. Along the Isometrie's three axes lengths are shortened alike (×0.816); the sidebar says so under the scale |
| Bottom-right | altitude stick (fly), toolbar | toolbar with *Modell* active; altitude stick hidden |
| Sidebar · Erkunden | minimap (player wedge), viewpoints, landmarks, Gehen/Fliegen | minimap draws the **view's footprint** (the parallelogram of ground on screen) instead of the wedge; a **Projektion** section with the presets as cards with a small line glyph each (Schnitt its own card once phase 3 lands), the current scale as a readout ("1 : 2 950" — zoom is free between the steps), and the scale series (1:500, 1:1 000, 1:2 500, 1:5 000, 1:10 000 — "bei 96 dpi", the CSS pixel); Gehen/Fliegen/Modell |
| Sidebar · Szene | Sonne & Zeit, Bildstil, look groups | the same, plus date chips *21.3. · 21.6. · 21.12.* under the calendar (phase 5) |
| Sidebar · Erweitert | Werkzeuge, Snapshot | + **Bild speichern** (phase 2) |
| Hint bar | walk/fly hints | Modell hints: "Ziehen verschieben · Rad Maßstab · Q/E drehen · M zurück" |

**ADR 0042.** The scale bar's numbers and the scale series are HUD
legend on the HUD's own glass, like the clock readout and the minimap's
caption — nothing is pinned to a place in the scene, and the scene stays
wordless. Plan 032 rejected *lettering in the scene*; this is not that.
It is still a look decision: **the maintainer confirms** before phase 1
ships the bar (the fallback is a bar without numbers plus the scale in
the sidebar).

### Transitions

- **Entering** from Gehen or Fliegen: the pivot is where the view axis
  meets the ground (or 150 m ahead of a walker), the preset is the last
  one used (first time: Isometrie, turned to the nearest 45° of the
  current heading so the city does not spin). The camera **dolly-zooms**:
  it backs away along the view while the FOV closes, keeping the pivot's
  framing, and tilts to the preset; at the end the parallel camera takes
  over with a matched frustum (≈ 1.1 s, any input cancels — as every
  glide does today).
- **Leaving**: back to the pose Modell was entered from when the pivot is
  within 150 m of it; otherwise to a Fliegen vantage over the pivot
  (heading = the view's turn, pitch −22°, altitude from the scale — the
  shape of `landmarkVantage`).
- **Viewpoints, landmarks, minimap clicks** pan the pivot (a glide of the
  pivot, scale and turn kept). A double-click centres.

### What else changes behaviour

- **Inquiry, outline, card** — unchanged; picking takes the ray from the
  parallel camera (*Architecture*). The card is how a planner reads
  heights, use and storeys, which is exactly what they ask a model.
- **Locate (Standort)** centres the pivot on the fix; **Live** is hidden
  in Modell (a parallel view does not follow a compass).
- **Data layers** — their "from the air" widening (`map-overlay.ts`)
  takes an equivalent altitude from the scale.
- **Soundscape** — the ear sits above the pivot at the equivalent
  altitude: a model on a table hears the city from above.
- **Snapshot** — carries the Modell state (*Architecture*), so a view
  round-trips, and (with plan 048) becomes a link.

## Current state — what assumes one perspective camera

From two audits of the code at `0568c26` (line numbers there):

**Breaks outright with an `OrthographicCamera`:**
1. Depth → distance is perspective everywhere: AO smoothing
   (`post-stack.ts:91-98`), the shared `viewZ` for DoF and grading
   (`post-stack.ts:360-364`, `GRADE_DISTANCE_M` 800), the stylize pass's
   `viewDistance` (`stylize-effect.ts:314-320`: its sky test `SKY_Z`, its
   1/z edge metric, its view-position rebuild `ndc*projScale*z`), and the
   selection outline's visibility test (`selection-outline.ts:116-124`).
   three has `orthographicDepthToViewZ` (`ViewportDepthNode.js:177`).
2. `stylize-effect.ts:840-841` (and the rain ray, `:659`) read
   `camera.fov`/`aspect` — `undefined` on an ortho camera.
3. Tram wires (`tram-layer.ts:197-206`) floor their width in pixels with a
   perspective formula — hundreds of metres wide under ortho.
4. `PerspectiveCamera` is the declared type in `post-stack.ts`,
   `stylize-effect.ts`, `selection-outline.ts`, `camera-pose.ts`,
   `camera-flight.ts`, `fps-movement.ts`.
5. **Render objects are keyed by (object, material, render context,
   lights), not by camera** (`RenderObjects.js:105-108`): build-time
   camera branches — `positionViewDirection` (`Position.js:114`, PBR
   specular and `glass.ts`), `PointsNodeMaterial` size attenuation (the
   lamp halos) — keep whichever camera built them first. A parallel view
   rendered into **its own scene-pass target** gets its own render
   contexts and so its own, correct builds.
6. Zoom is FOV (`camera-pose.ts` `setFov`/`zoomBy`, `camera-flight.ts`'s
   FOV tween, `lib/city/pose.ts` `MIN_FOV`/`MAX_FOV`/`nextFov`); the
   snapshot requires `0 < fov < 180` (`snapshot.ts:83-86`).
7. No straight-down view: `PITCH_LIMIT` ≈ 83° and poses built with
   `lookAt` + up = +Y, degenerate at −90°.

**Works, with care:**
- 3DTilesRendererJS 0.5.3 handles ortho cameras for screen-space error
  (`TilesRenderer.js:547-556`: `pixelSize`, distance = ∞). The view loads
  one level across the whole picture — fine terrain and all dressing
  below 2.5 m/px (`COARSE_TERRAIN_ERROR` 40 / error target 16). Swapping
  cameras needs `deleteCamera` on the old one. The sun's shadow camera
  already streams through this path.
- `Raycaster.setFromCamera` handles ortho (origin on the camera plane,
  direction forward) — but not a *sheared* (oblique) projection.
- GTAO rebuilds positions with `projectionMatrixInverse` (fine), but its
  `viewDir = normalize(-viewPosition)` is perspective-only; at 1 m/px its
  2 m radius is one texel anyway — AO all but vanishes in an overview.

**Keyed to the camera's height or distance** (needs the view's scale
instead): vegetation tiers (`create-app.ts` `updateVegetationLod`,
`vegetation-lod.ts`), crown translucency fade (`vegetation-layer.ts:739-747`),
fence fade (`fence-layer.ts:70`), glass fades (`glass.ts`), the map
overlay altitude (`map-overlay.ts`, fed at `create-app.ts`), lamp lights
(nearest to the camera), fly speed, soundscape, crash-trail heartbeat;
the shadow fit (`lib/city/shadow-fit.ts`, `sun-rig.ts` `follow`: radius
from altitude, capped at 880 m, centred ahead of the camera); the fog
(`height-fog.ts`: `rangeFogFactor` on view distance — a whole parallel
view would be fogged); the sky dome (centred on the camera).

## Architecture

### Camera: a real parallel camera (recommended) or a long lens

Two ways, compared in phase 0:

- **A. Long lens.** Keep the one `PerspectiveCamera`, put it 20–200 km
  back with a 0.3–3° FOV and a near plane just in front of the scene.
  Proven by the prototype plates. No second build, one pipeline, and the
  dolly-zoom transition is continuous by construction. But it is only
  *nearly* parallel (the residual is depth extent ÷ distance: 2.5 % front
  to back at 40 km for a 1 km deep view, 0.5 % at 200 km), float32 view-space depth
  loses centimetres at that distance (z-fighting of the baked ground
  dressing), the oblique Militärperspektive is impossible, and every
  depth-keyed post term (stylize's sky test and 1/z edges, grading, fog)
  breaks just as under B.
- **B. A real `OrthographicCamera`** (recommended): exact, sections and
  scale bar true by construction, the oblique projection available (a
  sheared ortho matrix — below), the camera close to the scene (no
  precision games). Costs: a second set of render objects (own scene-pass
  target, point 5 above), the depth helpers made camera-aware, and a
  frustum swap at the end of the transition.

**Decided: B** (the maintainer, 2026-10-03). As built it needs no second
set of builds at all — see *Rendering* below: the post passes read the
active camera through a stand-in (the *view lens*), and the scene's
camera-keyed node branches are reused from their perspective builds,
correct to within a fraction of a degree because the parallel camera
stands `MODEL_STANDOFF` (20 km) back along the view.

### The rig — `lib/city/model-view.ts` (pure) + `app/_components/model-rig.ts`

- **State**: `{ pivot: {epsgX, epsgY}, pivotY, turnDeg, tiltDeg,
  preset, metresPerPixel, oblique?: { planTurnDeg, heightScale } }`.
  The camera is derived: position = pivot − dir × `MODEL_STANDOFF`
  (above the tallest roof in view + margin; it only clips, it does not
  change the picture), orientation from turn/tilt via a YXZ Euler (no
  `lookAt`, so straight down works), frustum half-height =
  `metresPerPixel × viewportHeight / 2`.
- **Presets** are a table (like `RENDER_STYLES`): id, label, tilt, turn
  snap, oblique flag, glyph. Isometrie tilt is `atan(1/√2)` = 35.264°,
  not 30° — the 30° is the edges' angle on the sheet; the docs say so.
- **Scale**: `metresPerPixel` in CSS pixels; the scale series is
  1:500 … 1:10 000 at 96 dpi (1 CSS px = 0.2646 mm). Free zoom in
  between, clamped to [1:250, 1:25 000].
- **Oblique (Militärperspektive)**: an `OrthographicCamera` subclass
  whose `updateProjectionMatrix` multiplies a shear onto three's ortho
  matrix, so world-up maps to screen-up by `heightScale` while the ground
  plane maps undistorted. Depth stays linear (the shear is in x/y), so
  three's ortho depth handling holds. `Raycaster.setFromCamera` does not
  know the shear: all picking goes through **one** `rayFromNdc(camera,
  ndc)` that unprojects ndc at z = −1 and z = +1 — correct for every
  camera — used by `inquiry-probe.ts`, `city-layer.ts` and the
  double-tap/autofocus rays in `create-app.ts`.
- **Glides** tween pivot / turn / tilt / scale (a `ModelFlight` beside
  `camera-flight.ts`); every input cancels, as today.
- `camera-pose.ts` stays the one owner of where the player stands: it
  gains the third mode and hands the rig the camera; the clearance rules
  (ADR 0032) do not apply to a camera that only looks down on the model.

### Rendering

- **Active camera.** `create-app.ts` keeps both cameras; the tile stream
  swaps `setCamera`/`deleteCamera` with the mode; the resize handler
  updates both.
- **One pipeline, a view lens** (as built; the second pipeline planned
  here was not needed). The post passes never hold the real camera: they
  read a stand-in `PerspectiveCamera` (`view-lens.ts`) whose near, far,
  projection and world matrices are copied from the camera drawing the
  frame, every frame, plus two uniforms — `ortho` (which depth formula:
  `orthographicDepthToViewZ` or `perspectiveDepthToViewZ`, a per-pixel
  `select`, no rebuild) and `equivalent` (the distance a 55° perspective
  camera would show the same picture from, for every far-field fade).
  GTAO takes the lens as its camera (its uniforms reference the lens's
  matrices). Builds are keyed by material and render context, not camera
  (point 5 above), so the scene's build-time camera branches
  (`positionViewDirection`, points' size attenuation) keep their
  perspective builds; with the camera 20 km back along the view their
  view vectors are within a fraction of a degree of the parallel ones.
  Compiles (`PostStack.compile`) keep using the perspective camera.
- **Depth helpers.** `lens.viewZ(depth)`, `lens.distance(depth)` and
  `lens.fade(z)` for AO smoothing, grading, stylize and the outline.
  Stylize's sky test in a parallel view is "depth ≥ 0.9999" (the cleared
  depth); its edge metric differences z itself (affine on a plane under a
  parallel projection) normalised by the equivalent distance instead of
  1/z; the view position comes from the inverse projection
  (`getViewPosition`), which is right for the shear too; `projScale`
  comes from the projection matrix, not `fov`.
- **Pixel-floored widths** (tram wires) read the projection: the w of
  P·(0, 0, 1, 0) is 1 for a perspective and 0 for a parallel camera, so
  the floor is `mix(1, depth, perspective) · 2 / (focalY · height)`.
- **Scale instead of distance.** One `viewScale` the frame loop publishes
  (metres per pixel, plus an *equivalent altitude* = the height a 55°
  perspective camera would need for that scale) replaces
  `camera.position.y − ground` as the input of the vegetation tiers, the
  map overlay, crown/fence/glass fades, the soundscape and the trail.
  In Gehen/Fliegen it is computed from the camera as now, so nothing
  changes there.
- **Shadows.** `lib/city/shadow-fit.ts` gets `fitShadowToFootprint`: the
  four corner rays meet the ground plane at the pivot's height → the
  footprint → centre and half-size. The cap rises to cover a 1:5 000 view
  on desktop (≈ 1.5 km; 3072² → ~1 m texels, about a screen pixel) and
  stays 880 m on phones (beyond it the baked horizon map shades the
  ground, as today). The dead zone is in footprint fractions, so a pan
  re-renders the map only after ~18 % of the view.
- **Fog, sky, background.** Under Modell the distance fog's range is
  infinite, the site-edge haze off, the sky dome hidden and the clear
  colour the style's paper. The valley pool stays (judge on a GPU).
- **Grading, vignette, DoF.** A `RenderStyleDef` already gates DoF
  (`allowDof`); Modell gates DoF, depth grading and vignette the same way
  in `post-stack.ts`, without touching the styles' table.

### New picture styles (phase 2, ADR 0034's way)

Each is a row in `lib/city/render-style.ts` and a mode in the stylize
node — never a branch in a scene material:

- **Strich** (line drawing): Papier's white scene (`paperScene`) under the
  real light, ink at a constant 1 px, cast shadows as a light grey wash,
  the ground in the muted plan palette (green, water blue, roads white).
- **Schwarzplan**: buildings black, everything else white, no trees, no
  shadows — Papier's override machinery with a black material, the
  terrain's own paper mode set to plain white, crowns and dressing hidden
  for its frames through `style-dressing.ts`. Offered in every mode, but
  meant for the Lageplan.

### Snapshot

`CameraStateJson` gains an optional `model` member (the rig's state);
`mode` stays `walk | fly` and `pos`/`headingDeg`/`pitchDeg`/`fov` hold the
perspective pose Modell would leave to. A v1 reader without `model`
therefore shows the nearest perspective view — no version bump
(ADR 0017's contract: add, never change a meaning).

### Sections and elevations (phase 3)

In a parallel view **the near plane is a section plane**: placed at the
cut line, everything in front of it is gone. The *Ansicht* is a
horizontal Modell view with the near plane at a line the user draws (two
clicks on the ground, or "this street" from the asked object's nearest
highway). The *Schnitt* adds:

- **Poché**: a cut building shows its inside; with the clay material
  drawn double-sided under Schnitt, a back face seen through the cut is
  filled black (`frontFacing` on the clay graph under a shared uniform —
  one build; `side` changes the pipeline once, measure it).
- **The ground profile**: a strip mesh along the cut line from
  `ground.ts`'s height function down to a base, filled like the poché —
  the Geländeschnitt.

### The model cut-out (phase 4)

*Ausschnitt*: a rectangle (default: what is on screen) outside of which
nothing is drawn, with a plinth along its edges — the look of a model
cut from the city. Buildings are kept or dropped **whole** by their
footprint centroid (the object table, like demolish, `city-mesh.ts`);
terrain and dressing are clipped by planes (`ClippingGroup`, public in
three r186); the plinth is four strips from the ground heights. The
site's own outer edge gets the same plinth when no cut-out is set.

## Phases

### 0. Spike: the camera (S, GPU)

1. Behind `?view=model` (debug only): an `OrthographicCamera` swapped
   into the tile stream and a second pipeline as described; the iso
   preset over the spawn tile.
2. Measure on a desktop GPU and one phone: first-entry build + compile
   time, frame time, GPU memory (`getGpuDebug`) against A (the long
   lens).
3. Plates (shots harness) of Pastell, Papier, Comic in both.
4. **Append findings and the decision (A or B) to this file.**

STOP: if B's first entry costs more than ~1.5 s of builds on desktop even
when compiled during the glide, or a phone tab dies on it → report; the
maintainer chooses (A for phones only, or A everywhere and no
Militärperspektive).

### 1. Modell: Isometrie, Vogelschau, Lageplan (L)

The rig and its pure math; the third mode in `camera-pose.ts`, the
sidebar and the toolbar; M (`ONE_SHOTS` in `keyboard-controls.ts`; the
arrow keys and `+`/`−` are unbound today, the arrows join
`MOVEMENT_KEYS` so pressing one cancels a glide); the input table above; the HUD swaps (north
arrow, scale bar, hints, minimap footprint); the dolly-zoom in and the
glide out; picking through `rayFromNdc`; depth helpers; the Modell
pipeline; `viewScale` for every distance-keyed consumer; the footprint
shadow fit; fog/sky/background; snapshot `model`; Locate centres, Live
hidden. Guide pages (de + en) and the glossary.

### 2. Planner styles and the image export (M)

*Strich* and *Schwarzplan* (above). **Bild speichern**: the current view
rendered once at 2× (desktop: 3×) into a PNG with a legend strip — scale
bar, north arrow, date and sun time, the sources' credits
(dl-de/by-2-0 asks for the source with the picture; the HUD footer's
credit lines) and, from the metres per pixel, "1:2 500 bei 300 dpi". The
strip is drawn into the file, never into the scene.

### 3. Militärperspektive, Ansicht, Schnitt (M)

The sheared camera and its preset (30°/60° and 45°/45°, heights ×1 or
×⅔); the Ansicht with a drawn cut line; the Schnitt's poché and ground
profile.

### 4. Model cut-out and plinth (M)

The *Ausschnitt* tool (above), the site-edge plinth.

### 5. Shadow study (S–M)

Date chips 21.3./21.6./21.12. and hour chips 9 · 12 · 15 · 18 Uhr in
*Sonne & Zeit*; **Verschattungsstudie** in the export: the same view at
the chosen hours of one date as one sheet (3×1 or 4×3). With plan 054
phase 2 the sun-hours wash belongs here too.

## Test plan

Units (`bun:test`, colocated):
- `lib/city/model-view.test.ts`: the Isometrie preset projects the unit
  axes to equal lengths at ±30°; a straight-down view has no NaN;
  `metresPerPixel` ↔ scale denominator round-trips; pan keeps the point
  under the pointer under the pointer; turn and tilt keep the pivot; the
  oblique matrix maps a ground square to a square and world-up to
  screen-up; `rayFromNdc` hits the ground point that projects to that ndc
  for perspective, ortho and oblique; the footprint and its shadow radius.
- `lib/city/snapshot.test.ts`: a `model` member round-trips; a snapshot
  without it parses as before; a v1 reader's view of a Modell snapshot is
  the stored perspective pose.
- `lib/city/shadow-fit.test.ts`: `fitShadowToFootprint` covers the
  footprint, caps per tier, hysteresis holds.
- the vegetation LOD and map overlay take `viewScale` (their existing
  tests, re-keyed).

e2e (lite, the `@desktop-hud` shard): M enters Modell (`__poc` reports
the projection), a click on a building opens the card, Q turns, the
snapshot carries `model`, M leaves to the pose it came from. HUD steps in
`withFramesHeld`; the shared booted page.

GPU (plan 019's checklist, and plan 048's QA views): one committed view
per preset and style.

## Docs to keep current

ADR 0044 (a second camera kind: parallel projection as a camera mode,
not a style; the near plane as the section; the scale bar as HUD legend);
`AGENTS.md` (where things live); `docs/rendering.md` (camera and post);
the guide's *Bedienung / Using the viewer* in both languages and the
glossary (Isometrie, Axonometrie, Militärperspektive, Schwarzplan,
Maßstab, Abwicklung); the `city-walker` skill's camera section.

## Not in scope

- Parcels (ALKIS Flurstücke) and land-use plans (B-Pläne via XPlanung)
  under the model — the natural next data for planners, each needing its
  own licence check per Land; a separate plan.
- A measuring tool (distances and heights on screen, the number in the
  card) — fits Modell well, after phase 1.
- Text in the scene: no street names, heights or labels on the model.

## Rejected on the way

- **Modell as a picture style.** A projection changes picking, LOD,
  shadows and streaming — it is a camera, not a way of drawing one.
- **Isometrie as a fixed 2:1 "game" dimetry** (tilt 30°, edges at
  26.57°): it is what pixel art calls isometric; planners mean the true
  one. Vogelschau covers a 30° tilt.
- **A canvas or SVG redraw of the plan from the footprints** (like the
  minimap): flat, without the city's heights, light or styles — the
  minimap already is that.

## Findings

(phase 0 appends here)
