# ADR 0020: A fixed pool of real point lights; animated geometry never updates the shadow map

- **Status:** accepted
- **Date:** 2026-06 (aesthetic roadmap), reaffirmed by plan 015

## Context

three.js bakes the number of lights of each type into every compiled
shader program (`WebGLProgram.replaceLightNums`; the count is part of the
program cache key). Adding or removing a `PointLight` at runtime therefore
recompiles every lit material — a hitch across the whole scene. The night
look wants hundreds of lamps; the shadow map (ADR 0009) is re-rendered on
demand and would be forced every frame by anything that moves and casts.

## Decision

- **Lamps:** a fixed pool of `MAX_REAL_LAMPS = 3` real point lights is
  allocated **before the first frame** with no heads, sized once and never
  added to or removed from; each frame the pool is retargeted to the
  nearest lamp heads, intensity 0 by day. Every other lamp is "fake":
  emissive heads plus additive sprites and pool decals (`toneMapped:
  false`, `polygonOffset`), all scaled by one `nightFactor =
  smoothstep(2°, −6°)` of sun altitude. Lamps never cast shadows (the
  crown shimmer hard-codes `directionalLightShadows[0]`).
- **Animation and shadows:** wind sway, leaf flutter, cloud drift and
  water motion run in the main pass only; the depth/shadow materials carry
  none of it. The cast shadow of a swaying crown does not follow the sway,
  and clouds cast no shadows — accepted, because forcing
  `shadow.needsUpdate` per frame would re-render the 3072² map over tens
  of thousands of trees and destroy the on-demand win.
- More generally, look features are driven by by-reference `{ value }`
  uniforms, never by `#define`s or light counts that change at runtime.

## Consequences

- `NUM_POINT_LIGHTS` never changes after the first frame; a new lit
  feature must fit into the pool or be faked.
- A second `.replace` of an already-substituted shader chunk silently
  no-ops — patches append to the existing replacement.
- Additive terms fight ACES tone mapping; multipliers run higher than
  intuition suggests.

## Alternatives

- **Per-lamp real lights:** recompile storm and per-light cost; rejected.
- **Forward+ / clustered lighting:** a renderer change (WebGPU territory);
  deferred.
- **Cloud shadows / per-frame shadow updates for sway:** rejected — the
  on-demand shadow map is the project's largest perf decision.

## Update (2026-09, ADR 0027)

The pool stays, for the same reason in node form: three's lights node
hashes every light (its id and whether it casts) into the cache key of
every lit node build, so adding or removing a light rebuilds every lit
material. The GLSL-specific lines are history — there are no chunk
`.replace`s, no `#define`s and no `directionalLightShadows[0]` any more
(the crown shimmer no longer reads the shadow map; its gate is the sun's
daylight ramp). Look values are uniform nodes shared by every tile.
Animation still never reaches the shadow map: a crown sways in its
`positionNode` and casts through a rigid `castShadowPositionNode`. The
scene has no tone mapping (it never had: the old composer rendered to a
target, so the renderer's ACES setting was inert), so additive terms no
longer fight ACES. Clustered lighting is available on `WebGPURenderer`,
still its own decision.

## References

- [plans/completed.md](../plans/completed.md#aesthetic-and-visual-fine-tuning-roadmap--done-except-motes)
  (the aesthetic roadmap), plan 015 (pool before the first frame);
  `app/_components/lamp-layer.ts`, `vegetation-layer.ts`, `sun-rig.ts`.
