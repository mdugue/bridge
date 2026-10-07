# Plan 056: Window axes from street photos — spike result

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
- **Status**: **BLOCKED** on coverage — nothing drawn

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

## What it would take

1. **Coverage first.** Mapillary has far denser Dresden coverage
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
