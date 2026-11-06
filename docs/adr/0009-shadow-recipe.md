# ADR 0009: Light, shadows and post — soft PCF redrawn on demand, four concentric rings, a baked horizon for the far field, a fixed lamp pool

- **Status:** accepted
- **Date:** 2026-06, rewritten 2026-11

## Context

Sun shadows are the most expensive item after post-processing and the
hardest to get right on a large, gently sloped ground at a grazing sun.
A shadow frustum must stay tight for sharp texels, yet the view reaches
kilometres, on foot and from the air. Fill rate, not draw calls, is the
bottleneck. three builds the number of lights into every lit material, and a
phone has no memory to spare (ADR 0047).

## Decision

1. **The shadow recipe:** `PCFShadowMap` with a `shadow.radius` that leaves
   no gaps between its samples; the terrain receives but never casts;
   `normalBias = 0`; a small bias per ring; no colour target.
2. **The map is four concentric rings:** squares of one resolution, each
   three times as wide as the one inside it, the layers of one depth array
   drawn by one camera. A fragment reads the finest it lies on, cross-faded
   into the next at the edge. A phone's four of 900² hold fewer bytes than the
   one 2048² it had and pay for what the wide rings' casters hold beside them,
   so the rings are the one path on every device. Modell,
   of one scale across its picture, tiles its square with the same layers.
3. **A ring is redrawn only on demand, one a frame:** when it has drifted a
   share of its size, the sun moves or a caster changes
   (`invalidateShadows()`). A small ring redraws often with few casters, a
   wide one rarely with many. Thin casters stop short of the coarse rings. The
   tile stream keeps its own square (`lib/city/shadow-fit.ts`), so what loads
   does not change with the rings.
4. **Past the map the ground's shadows come from a baked horizon map**
   (`pipeline/bake/skyview.py`): the skyline's elevation per azimuth in a
   near and a far band, combined with the shadow map by `min`. The same
   bake writes the sky-view factor, which scales the ambient light only.
5. **Nothing animated reaches the shadow map.** Sway casts rigidly
   through `castShadowPositionNode`; clouds, water and moving data layers
   cast nothing.
6. **A fixed pool of real lamp lights**, sized per tier before the first
   frame and never changed (three on a desktop, one on a phone), retargeted
   to the nearest lamps: spot lights aimed down, as a street lamp's shade
   throws its light. The walls and a fountain's water take the lamps near
   the eye in one loop over a fixed uniform array (48, a phone 12), each
   less the share a real light gives it; every lamp's head, halo and pool
   is emissive and additive. All scaled by the night factor.
7. **Post:** the scene renders into its own target; GTAO at half
   resolution, smoothed, never gated by motion; depth of field on a
   desktop only, dropped while the camera moves by switching between two
   prebuilt pipelines; SMAA on a desktop, FXAA on a phone; grading,
   grain and vignette in the output node. No tone mapping.

## Consequences

- A shadow looks the same from anywhere at the same distance: its sharpness
  depends on no height, no direction and no history of the flight, and no
  switch or refit changes the whole picture at once.
- Walking redraws a ring a few times a minute instead of every frame. Every
  change to casters or the sun must call `invalidateShadows()`; a missed
  call is a stale shadow, never a crash.
- Half of each ring lies behind the camera on foot, unseen, the price of not
  redrawing on every turn: far off, its texels are wider than a map fitted to
  the view would have at its best.
- A desktop holds 64 MiB of shadow map (36 with the one 3072² before).
- Depth passes are more frequent and each smaller. Whether that holds on a
  real phone, where the memory was measured only in emulation, is judged there,
  not on a desktop.
- A new lit feature fits into the pool or is faked.
- A pass's sample counts are construction-time settings; switching them
  by motion is a rebuild hitch.

## Alternatives

- **One map warped over the view (LiSPSM, shipped until 2026-11):** it held
  shapes out to the fog from one map, but a warp has nothing to work with
  along the light. At a low sun, looking within about 35° of its azimuth or
  away from it, its near texels were 0.5–1.2 m against 0.06 elsewhere: every
  winter day lamp shadows vanished and house edges blurred, and it needed a
  second, sharper-or-softer map on foot, switched at one height, with steps
  of its own as it refitted.
- **`CSMShadowNode`:** slices the view and follows it every frame, one texture
  per cascade, one camera per cascade, and binds one camera for good; on-demand
  redraws, Modell and the phone's memory all fall out of that. `TileShadowNode`
  redraws all its layers at once.
- **Virtual shadow maps** (Unreal's clipmap, Sundial on three): the same
  rings at page granularity, but on three's internals and without multi-draw
  on WebGPU, tile by tile. Worth another look when three has multiview.
- **VSM:** corduroy rings on large ground at grazing angles, at any blur.
- **A large `normalBias`:** a bright peter-panning strip at every contact.
- **A bigger frustum or a 4096 map at eye level:** coarser texels, or cost
  without visible gain once the radius softens.
- **Re-centring per texel:** a depth pass on almost every moving frame.
- **Gating AO by motion:** the contact shadows blinked on every step.
- **Swapping one pipeline's output node for DoF:** re-translates the whole
  post graph.
- **A real light per lamp, or per-frame shadow updates for sway:** a
  rebuild storm, or the end of the on-demand map.
- **Occluders from DOM1 for the horizon:** includes trees, which cast
  their own shadows.
