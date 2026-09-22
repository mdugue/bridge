# ADR 0009: Shadow recipe — soft PCF, receive-only terrain, on-demand refresh with a dead zone, altitude-fitted frustum

- **Status:** accepted
- **Date:** 2026-06 (recipe), 2026-09 (on-demand refresh: plans 002/009; altitude fit: 2026-09-22)

## Context

Sun shadows are the single most expensive per-frame item after
post-processing (a full depth pass over four city meshes, every tree chunk
in the frustum, lamps, walls and bridges into a 3072² map). They are also
the hardest thing to get right on a large, gently sloped ground plane at
grazing sun angles. three r182 deprecated `PCFSoftShadowMap` and made
`PCFShadowMap` the soft option (a 5-tap Vogel disk spread by
`shadow.radius × texel`; radius 1 ≈ hard). Many rounds of trial produced
the working recipe; the dead ends are as valuable as the result.

## Decision

| Setting | Value | Why |
|---|---|---|
| `renderer.shadowMap.type` | `PCFShadowMap` | the only soft option that does not ring |
| `shadow.radius` | raised (~5) | the actual softness knob |
| `shadow.normalBias` | **0** | a positive value offsets the flat ground sample toward the light → a bright peter-panning contact strip; safe at 0 because terrain does not cast and solids cast via back faces |
| `shadow.bias` | small negative | residual cleanup |
| terrain `castShadow` | **false** | a casting heightfield self-shadows into staircase acne at grazing sun |
| map size | 3072² desktop, 2048² mobile, 512² lite | soft radius lets 3072 look like 4096 at ~44 % less fill |
| frustum half-size | 110 m at eye level → 880 m with altitude, in octaves with hysteresis (`lib/city/shadow-fit.ts`) | a fixed 110 m box under a camera 200 m up covers ground barely on screen; the whole view rendered unshadowed in fly mode |
| frustum centre | on the **ground** under the camera, pushed ahead by half the radius above the base | zero offset at eye level, so walking and turning behave exactly as before |
| `shadow.autoUpdate` | **false** | re-render only when the centre leaves a dead zone (18 % of the half-size = 20 m at the base), the size re-fits, the sun moves or a caster changes via `invalidateShadows()` |

## Consequences

- Walking re-renders the map ~0.45 times per second instead of ~60
  (≈100× fewer depth passes); the look between re-renders is unchanged
  because the centre is texel-snapped.
- Every mutation of casters, depth-affecting materials or the sun **must**
  call `invalidateShadows()` — a missed call is a stale shadow, never a
  crash. The crown LOD swap reports its flips for this reason.
- Very long low-sun shadows still clip beyond the frustum, and the far
  field at high altitude is coarse; only Cascaded Shadow Maps fix that
  properly (ledger: planned).
- Animated geometry (wind sway, clouds) does not update the map
  (ADR 0020).

## Alternatives (dead ends — do not retry blindly)

- **VSM:** "corduroy"/grid rings on large ground at grazing angles, at
  any blur.
- **Large `normalBias`:** the bright peter-panning strip.
- **A bigger frustum at eye level or a 4096 map:** coarser texels →
  fraying, or cost without visible gain once the radius softens.
- **Re-centre per texel (the pre-009 behaviour):** a depth pass on
  essentially every moving frame.
- **A camera-centred (not ground-anchored) frustum when airborne:** the
  tight depth range sits hundreds of metres above the terrain.

## References

- AGENTS.md "Shadows", "The shadow frustum is not fixed"; the city-walker
  skill "Shadows — the recipe and why"; plans 002, 009; `sun-rig.ts`,
  `lib/city/shadow-fit.ts`; commit bf05171 ("cast sun shadows from the
  air").
