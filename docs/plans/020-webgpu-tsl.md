# Plan 020: WebGPURenderer and TSL instead of WebGL and `onBeforeCompile`

> **Executor instructions**: Phase 0 is a spike on a machine with a real
> GPU; nothing after it starts until the maintainer has seen its plates and
> numbers and accepted [ADR 0027](../adr/0027-webgpu-renderer-and-tsl.md).
> Then one phase per PR, each leaving the scene looking the same (headed
> `bun run shots` against the previous phase). If anything in "STOP
> conditions" occurs, stop and report. Update the status row in
> `docs/plans/README.md` after each phase.
>
> **Drift check (run first)**:
> `git diff --stat 2c2f228..HEAD -- app/_components package.json`
> and re-count the patch sites (`grep -c onBeforeCompile app/_components/*.ts`).

## Status

- **Priority**: P2 (simplification and headroom, not a defect)
- **Effort**: L — six phases of S–M
- **Risk**: MED–HIGH — every custom look is re-expressed; GTAO ≠ N8AO
- **Depends on**: [plan 019](./019-gpu-verification.md) (the branch it
  builds on is verified); three r186 or later
- **Decision record**: ADR 0027 (proposed)
- **Planned at**: commit `2c2f228`, 2026-09-24
- **Status**: IN PROGRESS — Phase 0 spike run 2026-09-24 (see "Phase 0 findings"); the gate awaits the maintainer

## Why this matters

Every custom look in the scene is a string patch on three.js's GLSL chunks:
15 `onBeforeCompile` sites in 7 files (`height-fog.ts` 3, `terrain-layer.ts`
3, `vegetation-layer.ts` 3, `visual-style.ts` 2, `water-layer.ts` 2,
`rail-layer.ts` 1, `wall-layer.ts` 1), each with `.replace("#include <…>")`
anchors three may rename, and `customProgramCacheKey` bookkeeping. A failed
replace switches a feature off with green CI; plan 008 step 7 exists only to
catch that. The post stack is two more libraries (`postprocessing`, `n8ao`
with a hand-written type shim, `types/n8ao.d.ts`) plus two custom effects.

three r186 has the replacements in the box:

| Today | TSL / node equivalent |
|---|---|
| clay, terrain, water, crown, trunk, rail, wall patches | `MeshStandardNodeMaterial` with `colorNode`, `positionNode`, `normalNode`, `roughnessNode`, `emissiveNode` |
| `injectHeightFog` (patched into every lit material) | one `scene.fogNode` (height + distance fog as a node) |
| the land-cover paint pass (`RawShaderMaterial`, GLSL3) | a TSL fullscreen pass or compute node into the same render target |
| N8AO | `GTAONode` (+ `DenoiseNode`) |
| `DepthOfFieldEffect` | `DepthOfFieldNode` |
| `SMAAEffect` | `SMAANode` |
| `DepthGradingEffect`, `PaperGrainEffect`, vignette | a few lines of TSL in the output node; grading as a `Lut3DNode` |
| single fitted shadow frustum (ADR 0009) | `CSMShadowNode` (optional, own decision) |
| three real lamp lights (ADR 0020) | clustered/tiled lighting (optional, own decision) |

`WebGPURenderer` falls back to a WebGL2 backend where WebGPU is missing, so
the headless e2e keeps running on SwiftShader.

## Phase 0 — Spike (GPU, gate)

On a throwaway branch:

1. Swap `WebGLRenderer` for `WebGPURenderer` in `create-app.ts`
   (`await renderer.init()`), drop the post stack, keep the materials as
   plain `MeshStandardMaterial` (three converts them to node materials).
2. Port **one** material fully to TSL: the clay (`visual-style.ts`), since it
   is the most involved (per-object table texture, facade detail, dithered
   transparency, height fog).
3. Add `GTAONode` + `SMAANode` through `RenderPipeline`.
4. Measure on the reference snapshots of plan 019: frame time (desktop +
   laptop GPU, WebGPU backend and forced WebGL2 backend), first frame,
   memory; and plates of the clay against `main`.
5. Check 3DTilesRendererJS under `WebGPURenderer` (its core is
   renderer-agnostic; the fade/overlay plugins are GLSL and stay unused).

**Gate**: the maintainer compares the plates and numbers and accepts or
rejects ADR 0027. Reject if the WebGL2 backend is > 25 % slower than today
on the same GPU (phones without WebGPU would pay it), or if the clay cannot
be matched.

## Phase 0 findings (2026-09-24, Apple Silicon Mac, Chrome, 1600×1000 @2×)

The spike lives on the local branch `spike/webgpu-tsl` (worktree
`../webgpu-spike`): `?gpu=webgpu` and `?gpu=webgl2` switch the same build to
`WebGPURenderer` (WebGPU backend, or forced onto its WebGL2 backend); no
parameter is today's path. Ported to TSL: the clay (complete), the terrain
colour (splat + contour ink), a simple water sheet (coverage, colour,
Fresnel tint), the land-cover paint pass, the sky (`SkyMesh`), and the post
as a `RenderPipeline` (GTAO half-res, vignette, SMAA). Not ported: DoF,
depth grading, paper grain, height fog, meadow mottle / NDVI, water
ripples / glitter / mist, crown sway / shimmer, rail and wall fog. Every
material with an `onBeforeCompile` patch simply renders unpatched.
`e2e/spike-probe.ts` boots each mode, flies to four viewpoints, measures
frames over 8 s and writes plates.

**Look.** The TSL clay is indistinguishable from the GLSL clay at the
rooftop and aerial views (tint, roof vibrance, storey lines, eave, rim);
terrain palette and contours match; the sky is paler (`SkyMesh` vs `Sky`,
and no depth grading). GTAO reads darker and harder than N8AO and needs
tuning by eye. PCF shadows look slightly harder (check `shadow.radius`
under node shadows).

**Frame rate (fps, vsync-capped ~120; same views):**

| View | today (WebGL, full post) | WebGPURenderer → WebGL2 | WebGPURenderer → WebGPU |
|---|---|---|---|
| Canaletto (eye level) | 34 | 73 | 94 |
| Über den Dächern | 23 | 44 | 45 |
| Elbe-Panorama (246 m) | 19 | 40 | **15** |
| Carolabrücke (70 m) | 29 | 67 | **21** |

Ready (`__poc.ready`, dev server): today 9.6 s, node paths ≈ 21 s.

Reading the numbers:
- **Not apples to apples against today**: the node path renders no DoF,
  grading, grain, height fog or any of the patched detail. The
  two-to-one lead of the WebGL2 backend is mostly that.
- **Apples to apples between the two backends** (same scene, same
  materials): WebGPU is faster at eye level and **2–3× slower in the wide
  views**, where the draw count is highest (every streamed tile, every
  250 m vegetation cell, lamps, rails, walls). That points at three's
  per-draw CPU cost on the WebGPU backend, not the GPU. Before Phase 1,
  profile one wide view (Chrome performance panel, `renderer.info`).
- The first boot doubles: node materials compile on first use. Warm them
  with `renderer.compileAsync` under the overlay (backlog item 12).

**What had to change for WebGPU at all:**
- **Quantised vertex attributes.** `KHR_mesh_quantization` writes positions
  as snorm16×3 and normals as snorm8×3; **WebGPU has no 3-component 8/16-bit
  vertex formats** (only ×2/×4), so pipeline creation failed and nothing
  rendered. The spike dequantises to Float32 on load (losing the GPU-memory
  saving). The real fix is in the bake: pad positions/normals to 4
  components (valid glTF with a byte stride, but three then needs an
  `itemSize` 3 view) or write floats for the WebGPU path.
- **Integer attributes.** `_FEATURE_ID_0` / `_ROOF` as integers against a
  TSL `attribute(…, "float")` fail on the WebGL2 backend (buildings
  missing); read them as ints in TSL or bake them as floats.
- **`ImageBitmap` textures.** Closing the bitmap in `onUpdate` left the
  class raster empty on node paths (the renderer uploads again); keep it,
  or upload from a typed array.
- 3DTilesRendererJS itself needed no change.

**Gate reading.** The WebGL2 backend is not slower than today — on this
machine and at this feature level it is faster — so the plan's reject
criterion does not trigger. But the WebGPU backend's wide-view cost is
the open question for the maintainer: phones with WebGPU (recent Safari)
would take that path. Suggested decision: accept ADR 0027 on the condition
that Phase 1 starts with the profiling above and the bake change for
4-component attributes; or defer until three's WebGPU backend improves
its per-draw cost.

## Phase 1 — Renderer and post (M)

`WebGPURenderer`, `RenderPipeline` (r186; formerly `PostProcessing`) with `pass(scene, camera)`, GTAO, DoF,
SMAA, and the grading/grain/vignette as one output node. Remove
`postprocessing`, `n8ao`, `types/n8ao.d.ts`, `depth-grading-effect.ts`,
`paper-grain-effect.ts`. Keep the motion-keyed DoF drop (plan 007). Re-tune
the contact shadows by eye (GTAO is a different algorithm).

## Phase 2 — Fog as one node (S)

Replace `height-fog.ts`'s per-material injection with `scene.fogNode`. The
look sliders keep driving `uniform()` nodes.

## Phase 3 — Terrain, water, paint pass (M)

Terrain and water sheets as node materials over the same glTF content;
the land-cover paint pass as TSL. `DATA_POSITION` (`shader-chunks.ts`)
becomes a shared node function.

## Phase 4 — Clay (M)

From the spike, finished: the per-object table read (`textureLoad` on the
object texture), facade detail, dithered transparency, glow.

## Phase 5 — Vegetation, rail, walls (M)

Crown wind sway and shimmer in `positionNode`/`colorNode`; the trunk; rail
and wall ribbons.

## Phase 6 — Clean-up and docs (S)

Delete the shader-anchor step from plan 008 (moot), the `customProgramCacheKey`
code, `shader-chunks.ts`. Update `docs/rendering.md` (light and post, the
budgets), the city-walker skill, AGENTS.md "Rendering gotchas" (the shadow
recipe's three-internal details may change under node shadows), ADR 0027 to
accepted. Optional follow-ups, each its own decision: `CSMShadowNode` for
long low-sun shadows; clustered lamp lights.

## STOP conditions

- Phase 0 fails its gate.
- A phase cannot match the previous plates at eye level after tuning.
- The e2e suite gets slower than its frame budget under the WebGL2 backend
  on SwiftShader (AGENTS.md "Budget the e2e specs in frames").
- A needed node is missing in the pinned three version: report; do not
  vendor a copy of three's internals.

## Out of scope

CesiumJS or another renderer; rewriting the camera/input code; changing
the look beyond keeping it.
