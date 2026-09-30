# ADR 0031: A baked horizon map casts the shadows past the frustum; the shadow map keeps the near field

- **Status:** accepted (the look unjudged on a GPU as of 2026-09-25)
- **Date:** 2026-09 (amended 2026-09-25: the near band)

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
azimuths, in two bands — occluders **80–1 500 m** away (the far band) and
**8–80 m** away (the near band) — and let the terrain shader cut the sun's
direct light where the sun stands below it:

- The raster: 256² (≈8 m) × 16 azimuths × 2 bands, eight RGBA planes in
  one greyscale PNG decoded by the viewer's own decoder into an 8-layer
  `DataArrayTexture`: the far band 0–45°, the near band 0–90° in 8 bits
  (beside a wall the near skyline is steep). Cells under a roof carry the
  nearest open cell's angles, so LINEAR filtering pulls no roof's horizon
  onto the street. The plan's 4 m raster was 1.86 MB on the spawn tile for
  the far band alone, past its 1.5 MB budget; 8 m keeps all 16 azimuths,
  both bands at 1.13–1.23 MB.
- The shader interpolates the two azimuths around the sun and fades across
  ±0.8° of the angle; three's directional-light loop becomes
  `min(shadow map, horizon)` (`sky-light.ts` `lightsWithFarShadow`). **Min,
  not product**: where the shadow map and the horizon see the same
  occluder, the ground must not darken twice.
- **Which band counts depends on the shadow frustum.** The sun rig keeps
  the frustum's centre and half-size on the ground in a uniform
  (`uShadowReach`; the frustum follows the camera and grows in fly mode,
  `lib/city/shadow-fit.ts`). Inside it the near field stays the shadow
  map's — it has the shape (trees, facades, the pixel-exact edge), the
  horizon only the angle — and the terrain reads the far band alone. Over
  the frustum's last 20 % the near band fades in (no seam at the
  hand-over), and beyond the frustum the horizon is the higher of the two
  bands (`lib/city/skyview.ts` `nearBandWeight`, `horizonSunVisibility`).
- A look row (*Ferne Schatten*) scales it; 0 is the picture before.

The same bake writes the **sky-view factor** (≈2 m, occluders within
150 m), which scales the ambient term only — the hemisphere fill that lit a
courtyard as brightly as a meadow.

## Consequences

- Ground past the frustum gets both the long low-sun shadows and its
  neighbours' shadows, for two to four texture fetches per terrain
  fragment and no extra pass; the cost is ≈1.6–1.8 MB of rasters per tile
  (sky view and both horizon bands) and ≈25–40 s of bake per tile. *Why
  the near band (review, 2026-09-25):* with the far band alone, a street
  past the ~110 m frustum lost the shadow of the block beside it — a 20 m
  block's 55 m shadow at a 20° sun was missing entirely, at 10° only the
  detached 80–113 m tail showed — so the claim that long shadows reached
  across the site held only for occluders more than 80 m from the ground
  they shade.
- The bake sees what is committed: beyond the site's rim the ground is
  open at the tile edge's mean height, so a tile on the rim has no skyline
  past it, and a neighbour with a DGM but no LoD2 is bare ground (on the
  first four tiles the east edge's horizon toward 90° read 3.3° against
  ≈8° elsewhere while the 33414 column had no LoD2; with the fifteen tiles
  only the rim remains).
- The far field's shadows are only as sharp as 8 m and 22.5°: a single
  narrow tower smears over the arc of sun azimuths between two planes. A
  continuous skyline (a block, a ridge) is where it is right.
- Only the ground receives it; facades do not (the plan's phase 3 waits on
  plates). Trees cast nothing into it.
  What is baked into the fine terrain takes the ground's terms too
  (`sky-light.ts` `injectGroundLight`): kerbs, fences and stairs both,
  walls the horizon only (the ground's sky view at a wall's foot counts
  the wall itself).
- CSM is no longer needed for "the far streets are sunlit"; it would still
  add the middle distance's shadow *shapes* and shadows on facades, and
  stays the ledger's 📋 #7 for that.
- Inside the frustum the far band can still spill its 22.5° azimuthal smear
  past the shadow map's crisp edges where an occluder 80–110 m away is in
  both; the near band's own smear is kept out of the frustum by the
  weighting. The hand-over's fade is unjudged on a GPU.

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

## Update (2026-09, ADR 0027)

The mechanism is node slots now, the terms unchanged. The horizon is the
ground material's `receivedShadowNode`, combined with the shadow map by
`min` (`sky-light.ts` `applyGroundLight`, which replaced the patch of
three's directional-light loop, `lightsWithFarShadow`, and
`injectGroundLight`); the sky view is its `aoNode`, which three multiplies
into the indirect light only; the frustum reaches the terrain as a shared
`uniform` (`shadowReach`). The "CSM on WebGL" alternative is now
`CSMShadowNode` on the same renderer — no shader patching to compete
with, but still a pass per cascade; its own decision.

## References

- [plan 033](../plans/033-sky-view-and-horizon-shading.md), ledger
  "Lighting" (*Sky-view factor*, *Far horizon shade*) and 📋 #7
- `pipeline/bake/skyview.py`, `pipeline/tests/test_skyview.py`,
  `lib/city/skyview.ts`, `app/_components/sky-light.ts`,
  `app/_components/terrain-layer.ts`
