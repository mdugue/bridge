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
- **Status**: TODO — Phase 0 needs a GPU

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
