# ADR 0009: Light, shadows and post — soft PCF redrawn on demand, a baked horizon for the far field, a fixed lamp pool

- **Status:** accepted
- **Date:** 2026-06, rewritten 2026-10 (absorbs ADRs 0011, 0020, 0031)

## Context

Sun shadows are the most expensive item after post-processing and the
hardest to get right on a large, gently sloped ground at a grazing sun.
The shadow frustum must stay tight for sharp texels, so the far field has
none. Fill rate, not draw calls, is the bottleneck. three builds the
number of lights into every lit material.

## Decision

1. **The shadow recipe:** `PCFShadowMap` with a raised `shadow.radius`
   (the softness knob); the terrain receives but never casts;
   `normalBias = 0`; a small negative `bias`; a one-byte colour target.
2. **The map is redrawn only on demand**: when its centre leaves a dead
   zone, its size re-fits, the sun moves or a caster changes
   (`invalidateShadows()`). The frustum sits on the ground under the
   camera and grows with altitude in octaves with hysteresis
   (`lib/city/shadow-fit.ts`).
3. **Past the frustum the ground's shadows come from a baked horizon map**
   (`pipeline/bake/skyview.py`): the skyline's elevation per azimuth in a
   near and a far band, combined with the shadow map by `min`. The same
   bake writes the sky-view factor, which scales the ambient light only.
4. **Nothing animated reaches the shadow map.** Sway casts rigidly
   through `castShadowPositionNode`; clouds, water and moving data layers
   cast nothing.
5. **A fixed pool of real point lights**, sized per tier before the first
   frame and never changed (three on a desktop, one on a phone), retargeted
   to the nearest lamps. Every other lamp is emissive and additive, scaled
   by the night factor.
6. **Post:** the scene renders into its own target; GTAO at half
   resolution, smoothed, never gated by motion; depth of field on a
   desktop only, dropped while the camera moves by switching between two
   prebuilt pipelines; SMAA on a desktop, FXAA on a phone; grading,
   grain and vignette in the output node. No tone mapping.

## Consequences

- Walking redraws the map a few times a minute instead of every frame.
  Every change to casters or the sun must call `invalidateShadows()`; a
  missed call is a stale shadow, never a crash.
- The far field has the angle of shadows, not their shape; shapes there
  and on facades are a job for cascaded shadow maps (`CSMShadowNode`), its
  own decision when it comes.
- A new lit feature fits into the pool or is faked.
- A pass's sample counts are construction-time settings; switching them
  by motion is a rebuild hitch.

## Alternatives

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
