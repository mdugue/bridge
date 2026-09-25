# Plan 033: Sky-view factor and horizon shading — the city's large-scale light

> **Executor instructions**: Read fully first. Phases in order; each lands
> on its own behind a look slider whose 0 is today's picture. Look and
> cost are judged on a real GPU (`bun run shots --headed`, full profile);
> this is lighting work, SwiftShader is useless for it. Update the status
> row in `docs/plans/README.md` when a phase lands. Read the city-walker
> skill's shadow section first.
>
> **Ground**: the fine level is a TIN since PR #49 (ADR 0030), the coarse
> one a 512² grid. The rasters here are sampled by data-frame position, so
> they serve both levels unchanged.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- app/_components/terrain-layer.ts app/_components/visual-style.ts app/_components/sun-rig.ts lib/city/shadow-fit.ts`

## Status

- **Priority**: P1 (light is the look; this fixes the long-shadow limit cheaply)
- **Effort**: M (bake M, terrain S, clay S–M, horizon shadow M)
- **Risk**: MED — double-darkening with SSAO and the shadow map
- **Planned at**: 2026-09-25
- **Status**: PARTIAL (2026-09-25) — built without a GPU:
  - Phase 1: `pipeline/bake/skyview.py` (committed DGM + LoD2 only,
    `lowveg.py`'s CityJSON walk extracted as `lod2_rings`), `svf_<tile>.png`
    for all four tiles (1024², 0.47–0.56 MB), terrain ambient
    (`sky-light.ts`, *Himmelslicht*, default 0.5).
  - Phase 2: the far horizon — **STOP measured**: at 4 m the spawn tile's
    PNG was 1.86 MB (> 1.5 MB), so it ships at **8 m, 16 azimuths**
    (256², 0.54–0.60 MB; 12 azimuths at 4 m would have been 1.36 MB).
    Terrain far shadow by `min` with the shadow map (*Ferne Schatten*,
    default 0.8), ADR 0031. Bake ≈22 s per tile (SVF ≈19 s, horizon ≈3 s).
  - Phase 3: clay facades read the SVF (2.5 m outside the wall, ×2, faded to
    the eaves), shared with the terrain through a refcounted registry
    (`shared-rasters.ts`). *Boden-Verlauf* kept as is (not retuned —
    needs plates). Horizon on facades: not done (plates first).
  - Open: every plate the phases name, the N8AO double-darkening check and
    the frustum-seam check (both STOPs need a GPU; the conservative
    defaults stand in).

## Why this matters

Two lighting gaps, both screen- or frustum-bound today:

1. **Ambient light does not know the city.** The hemisphere light
   (`sun-rig.ts:155`) lights a narrow Neustadt courtyard as brightly as the
   open Elbwiesen. N8AO only darkens contact creases, and only on screen,
   at half resolution. A **sky-view factor** (the fraction of the sky a
   point sees) is the physical answer, and it is a static property of the
   DGM and the LoD2 — bakeable once.
2. **Long shadows stop at the frustum.** The shadow map covers 110 m at eye
   level (`lib/city/shadow-fit.ts`); at low sun the long shadows of the
   Frauenkirche or a Plattenbau row simply end, and streets 300 m away
   are fully sunlit. The ledger calls this "only solvable with CSM"
   (📋 #7). A **horizon map** — per texel, the elevation angle of the
   horizon in N directions — answers "is the sun above the horizon here?"
   for any distance, at the cost of one texture fetch. It is the cheap
   90 % of CSM for the far field.

## Design

### Bake — `pipeline/bake/skyview.py` (committed inputs only)

- **Height field**: DGM1 (committed, 1 m) with the LoD2 roof surfaces
  rasterised on top (max over triangles; the CityJSON is committed;
  `lowveg.py` `building_mask` already projects every LoD2 surface onto a
  grid — extend that walk to burn heights, do not write a third CityJSON
  reader). No DOM1 → the bake is
  reproducible from the repo; trees are left out on purpose (they cast
  real shadows and have their own shading).
- Neighbour tiles are read for the margin; outside the site counts as
  open ground at the tile edge's mean height.
- **SVF** at 2 m (1024² per tile): 16 azimuths, horizon angle within
  150 m, `svf = 1 − mean(sin² h)` (the standard isotropic form). Written
  as `data/dlm/svf_<tile>.png` (8-bit).
- **Far horizon** at 4 m (500² per tile, padded to 512²): the horizon
  angle per 16 azimuths for occluders **80–1 500 m away** (the near field
  is the shadow map's), 0–45° in 8 bits (0.18° steps), packed as four
  RGBA planes interleaved in one greyscale PNG (the `png-raster.ts` route
  — never the browser's image decoder). `horizon_<tile>.png` + a JSON
  legend (azimuth order, angle scale).
- Vectorised numpy (shifted-array marching); log the runtime per tile.
- Tests: a flat field → SVF 1, horizon 0; a single 20 m block → the
  expected angle at a known distance and direction; the seam margin.

### Terrain (`terrain-layer.ts`, the NDVI route)

New optional rasters in `TileArtifactKind`, `TerrainExtras` (both
levels), `DetailRasters`, `applyTerrainUniforms`, `dispose` and — easy to
miss — the `customProgramCacheKey` has-flags (`terrain-layer.ts:613`).

- SVF multiplies **indirect diffuse only**: replace the (empty, the
  terrain has no aoMap) `#include <aomap_fragment>` chunk with
  `reflectedLight.indirectDiffuse *= mix(1.0, svf, uSkyView);` — it runs
  after `lights_fragment_end`, so direct sun stays untouched.
- Horizon shadow: sun azimuth → the two nearest planes, interpolate the
  angle `h`; `far = smoothstep(h − 0.8°, h + 0.8°, sunElevation)`;
  direct light *= `min(shadowMapTerm, mix(1, far, uHorizonShade))`. Min,
  not product: where both see the same occluder it must not darken twice.
  Plumb it through the shadow chunk the way the kerb shadow reads
  `uSunDir` (ground-detail).

### Buildings (clay, `visual-style.ts`)

- Facades sample the SVF at their data-frame xy and fade it toward 1 with
  height above the base (`vLocalH`): a courtyard's ground floor is dim,
  its eaves are not. Same `aomap_fragment` hook; the existing
  "Boden-Verlauf" surrogate (`visual-style.ts:173-175`) is retuned or
  retired against it (report which).
- The terrain tile's rasters are needed by the city tile of the same id:
  share them through a per-tile registry in `tile-stream.ts`
  (loaded once, refcounted, freed when both are gone).
- Horizon shadow on facades: phase 3, only if plates call for it.

### Look rows

`skyView` (*Himmelslicht*, default tuned on plates) and `horizonShade`
(*Ferne Schatten*) in `lib/city/look-controls.ts` — the table drives
store, snapshot and HUD.

### Docs

Ledger (Lighting: SVF ✅, horizon shade ✅; 📋 #7 CSM amended), a new
**ADR** ("baked horizon map for the far-field shadow"; the CSM decision
depends on it), `rendering.md` light/post section and codebook,
`data-pipeline.md`, the city-walker skill's shadow section.

## Phases

1. SVF bake + terrain ambient. Plates: a Neustadt courtyard, the Prager
   Straße, the Elbwiesen, noon and overcast-like low sun.
2. Horizon map + far shadow on the terrain. Plates at 17:30 on
   21 December from the Brühlsche Terrasse looking along the Terrassenufer.
3. Clay facades (SVF), then horizon on facades if needed.

## STOP conditions

- Double-darkening with N8AO in courtyards (SVF + SSAO read as dirt):
  lower the N8AO intensity where SVF is low before lowering SVF.
- A visible seam at the shadow frustum's edge where the shadow map hands
  over to the horizon term: fade the horizon term in across the last
  20 % of the frustum radius; report the plate.
- Bake > 5 min per tile or the horizon PNG > 1.5 MB per tile: halve the
  azimuths to 12 or the resolution to 8 m and report.
