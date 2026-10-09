# Plan 068: Window axes from street photos — spike result

> **Superseded (2026-10-09)** by [ADR 0049](../adr/0049-windows-drawn-by-the-clay.md):
> the photos now drive windows on every house through what does not move
> with the camera — the rhythm, not the positions. See *What came of it*
> at the end; this plan stays the record of why the positions are not
> measured.

> **Executor instructions**: Read fully first. The window-grid veto
> (`docs/transformations.md`, discontinued table) was loosened on
> 2026-10-07 for one case only: window axes **measured** in open street
> photos may show as fine vertical articulation — no panes, no mullions, no
> glass, nothing where nothing was measured. This plan records what a spike
> on Dresden's spawn tile found and what it would take to ship. Google
> Street View is out by its terms; Panoramax and Mapillary are CC BY-SA.

## Status

- **Priority**: P3
- **Effort**: L (pose refinement and facade rectification are the bulk)
- **Risk**: HIGH — a wrongly placed axis is an invented one
- **Planned at**: 2026-10-07
- **Status**: **SUPERSEDED** (2026-10-09, ADR 0049) — the rhythm is drawn on every house; the axes' positions stay BLOCKED on pose accuracy (Mapillary tried 2026-10-07)

## What the spike found (Panoramax, spawn tile `33412_5656_2_sn`)

- **789 photos** on the 2 × 2 km tile (2026-10-07; `api.panoramax.xyz`
  search over the tile's bounds): 497 from one GoPro HERO5 (bike,
  2025-11/12), 235 from an iPhone XR (from the tram, 2022-01), the rest
  phones. No 360° panoramas.
- **Every photo looks along the street.** A facade beside the camera
  shows only near the image edge, at a grazing angle, behind parked cars;
  the HERO5 adds a wide-angle lens with no published distortion model.
- **Positions are poor.** The median `quality:horizontal_accuracy` is
  29.7 m (the GoPro sequences); the iPhone's is 5 m. Which house in a row
  a facade belongs to needs ~1 m.
- **Reach, with perfect poses**: of 3 731 LoD2 footprints with a ground
  surface, 84 have a facade ≥ 6 m long within 25 m and inside some photo's
  field of view; **58 (1.6 %)** at an obliquity under 60°; **9** in three
  or more such photos. That is the ceiling before pose errors, occlusion
  by trees and parked cars, and failed rectifications.
- A vanishing-point rectification (LSD line segments, the vertical and the
  dominant horizontal vanishing direction, the known field of view) gives
  usable facade strips only where the facade fills the image edge; on most
  frames the dominant horizontal direction is the street and its cars.

So: too few houses, too unreliably placed. Drawing axes from this would
mostly draw them where nothing was measured, which the veto forbids.

## What Mapillary showed (spawn tile, 2026-10-07)

Coverage is no longer the problem: 32 379 images on the tile, 8 097 of
them 360° panoramas with computed poses (`computed_geometry`,
`computed_rotation`, one batched `?ids=` request per 50 images; the
bbox listing does not return the rotation). 5 366 outer LoD2 walls of
6 m or more stand under eaves of 6 m or more; 536 of them are seen
face-on (≤ 57° obliquity, 5–25 m, line of sight clear of other
footprints) from two or more sequences.

- **Rectification works.** The panorama sampled onto the LoD2 wall at
  20 px/m (2048 px thumbnails, equirectangular, the full SfM rotation)
  gives straight, upright facade strips; window rows and storeys read
  clearly.
- **Positions do not hold to the metre.** Strips of one wall from two
  sequences show the same rhythm shifted along the wall: of 111
  cross-sequence pairs over 30 walls, 8 correlate (r > 0.45) at all and
  their median shift is 0.6 m; 3 agree within 0.25 m. The SfM poses are
  metre-level, not decimetre-level.
- **Skyline refinement did not fix it.** Fitting each pose (±2.5 m,
  ±2°, ±1 m camera height) so the LoD2 roof edges, densified per
  angle, meet the photo's sky line converges to a mean misfit of 1–3°:
  trees, the camera car's own roof boxes and LoD2's simplified eaves
  dominate it, and the along-street offset is barely constrained by a
  near-flat roofline. With it, 3 of 9 pairs correlated, 1 within
  0.25 m.
- **Detection is the smaller problem.** Texture energy over each storey's
  window band, z-scored and agreed across storeys, finds the window
  columns on plain plaster facades; darkness alone does not (curtains,
  reflections).

So the rhythm is measurable, its position on the wall is not: an axis
drawn from this would sit up to a metre beside the real window — an
invented axis by the veto's rule.

## What it would take

1. ~~**Coverage first.**~~ Done (see above); the blocker is now the pose.
   A position good to ~0.2 m along the wall needs either feature
   matching between the sequences and a joint bundle adjustment anchored
   to LoD2 corners, or one anchor per wall (a measured corner or door
   edge) that each photo's strip is registered to before agreeing.
1. **Coverage.** Mapillary has far denser Dresden coverage
   (sequences from cars, several directions); its API needs a client
   token (`MLY|…`), which the maintainer would have to create and put in
   the environment (never committed). Its images carry computed poses
   (`computed_geometry`, `computed_compass_angle`) from structure from
   motion — metre-level, which removes most of the pose problem.
2. **Pose refinement** where only GPS exists: snap to the OSM way the
   sequence follows, then fit the azimuth and the along-street offset so
   LoD2 building corners project onto strong vertical edges.
3. **Rectification** of each facade (homography from the LoD2 wall
   polygon and the refined pose), at ~20 px/m, masking cars and trees
   (low saturation, texture).
4. **Measurement**: a column profile of vertical-edge energy over the
   upper storeys (above the first storey line, under the eave);
   autocorrelation gives the axis spacing, the profile's peaks the
   positions. Kept only where two photos agree within 0.3 m and the period
   lies in 1.2–5 m. Output per LoD2 wall: the axes' positions along it
   (`dlm/axes_<tile>.json`), with the photo ids for provenance.
5. **Drawing**: fine vertical pencil lines in the clay shader at the
   measured positions (a per-object list in the object table texture,
   capped at e.g. 24 axes per wall), from the first storey line to the
   eave, on the *Gliederung* slider. No panes.

Revisit when (1) is possible; until then the facades keep the storey
lines, the *Gliederung* (plinth, cornices, shop zones) and the doors.

## What came of it (2026-10-09)

The way round the poses was to measure only what does not move with the
camera. `pipeline/bake/facade_traits.py` and `windows.py` read per wall,
from Mapillary's panoramas, the column profile's period (the axis
spacing) and its peak (a regular or a loose grid), the row profile's
period (the storey), the openings' width and proportion and ornament —
each feature only where two sequences agree at Spearman ρ ≥ 0.6. The
clay draws windows from that rhythm on every house (ADR 0049, PR #143):
over Dresden's fifteen tiles 891 buildings carry their own measured
rhythm, 4 823 borrow a measured neighbour's of the same roof form and
eave, and 31 361 take their type's, whose numbers are the photos'
medians. The drawing is the clay's recess per window, not pencil lines
(step 5 above).

What this plan wanted beyond that — each axis where the photo saw it —
is still blocked on step 1: the axes are centred on each wall, and a
measured position would need poses good to about 0.2 m along the wall.
