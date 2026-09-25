# ADR 0031: A baked horizon map casts the far field's shadows; the shadow map keeps the near field

- **Status:** accepted (the look unjudged on a GPU as of 2026-09-25)
- **Date:** 2026-09

## Context

The sun's shadow map covers a camera-following frustum of 110 m half-size
at eye level ([ADR 0009](./0009-shadow-recipe.md), `lib/city/shadow-fit.ts`).
At a low sun the long shadows of a church or a Plattenbau row end at its
edge, and a street 300 m away lies fully sunlit. The ledger called that
"only solvable with Cascaded Shadow Maps" (📋 #7): on WebGL a sizeable
integration with its own material patching, extra depth passes every time
the sun or the camera moves, and on WebGPU a `CSMShadowNode` that comes
with a renderer migration of its own ([ADR 0027](./0027-webgpu-renderer-and-tsl.md)).

What occludes the far field in this scene is static: the DGM and the LoD2
roofs. The sun is the only thing that moves.

## Decision

Bake, per tile and from the committed DGM1 + LoD2 only
(`pipeline/bake/skyview.py`), the **elevation angle of the skyline** in 16
azimuths for occluders **80–1 500 m** away, and let the terrain shader cut
the sun's direct light where the sun stands below it:

- The raster: 256² (≈8 m) × 16 azimuths, 0–45° in 8 bits, four RGBA planes
  in one greyscale PNG decoded by the viewer's own decoder into a 4-layer
  `DataArrayTexture`. The plan's 4 m raster was 1.86 MB on the spawn tile,
  past its 1.5 MB budget; 8 m keeps all 16 azimuths at ≈0.6 MB.
- The shader interpolates the two azimuths around the sun and fades across
  ±0.8° of the angle; three's directional-light loop becomes
  `min(shadow map, horizon)` (`sky-light.ts` `lightsWithFarShadow`). **Min,
  not product**: where the shadow map and the horizon see the same
  occluder, the ground must not darken twice.
- The near field (< 80 m) stays the shadow map's: it has the shape (trees,
  facades, the pixel-exact edge); the horizon has only the angle.
- A look row (*Ferne Schatten*) scales it; 0 is the picture before.

The same bake writes the **sky-view factor** (≈2 m, occluders within
150 m), which scales the ambient term only — the hemisphere fill that lit a
courtyard as brightly as a meadow.

## Consequences

- Long low-sun shadows reach across the whole site for one or two texture
  fetches per terrain fragment and no extra pass; the cost is ≈1.2 MB of
  rasters per tile and ≈22 s of bake per tile.
- The far field's shadows are only as sharp as 8 m and 22.5°: a single
  narrow tower smears over the arc of sun azimuths between two planes. A
  continuous skyline (a block, a ridge) is where it is right.
- Only the ground receives it; facades do not (the plan's phase 3 waits on
  plates). Trees cast nothing into it.
- CSM is no longer needed for "the far streets are sunlit"; it would still
  add the middle distance's shadow *shapes* and shadows on facades, and
  stays the ledger's 📋 #7 for that.
- The frustum hand-over may show a seam where the shadow map ends; the plan
  names the remedy (fade the horizon in over the frustum's last 20 %) once
  a GPU plate shows one.

## Alternatives

- **Cascaded Shadow Maps (WebGL, three's examples `CSM`)** — right in
  principle, but a render pass per cascade on every sun or camera move, and
  its shader patching competes with the clay's and the terrain's own. Kept
  as the upgrade path, not the first step.
- **A bigger frustum** — coarser texels near the eye (the fraying ADR 0009
  rejected); the far field still ends somewhere.
- **The horizon at 4 m, 12 azimuths** — 1.36 MB, under the cap, but a 30°
  azimuth step smears every narrow occluder over a wider arc of sun
  positions than the coarser raster blurs its edge.
- **Occluders from DOM1** — includes trees (which cast their own shadows)
  and needs a raw download; the bake is reproducible from the repository.

## References

- [plan 033](../plans/033-sky-view-and-horizon-shading.md), ledger
  "Lighting" (*Sky-view factor*, *Far horizon shade*) and 📋 #7
- `pipeline/bake/skyview.py`, `pipeline/tests/test_skyview.py`,
  `lib/city/skyview.ts`, `app/_components/sky-light.ts`,
  `app/_components/terrain-layer.ts`
