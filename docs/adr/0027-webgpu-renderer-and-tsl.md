# ADR 0027: Move to WebGPURenderer and TSL node materials

- **Status:** proposed — gated on the GPU spike in [plan 020](../plans/020-webgpu-tsl.md)
- **Date:** 2026-09

## Context

Every custom look is a string patch on three.js shader chunks
(`onBeforeCompile` + `.replace("#include <…>")`, 15 sites in 7 files),
with `customProgramCacheKey` bookkeeping and chunk names that three can
rename under us (plan 008 step 7 would test the anchors). The post stack
is two extra libraries (`postprocessing`, `n8ao` with a hand-written type
shim). Long low-sun shadows clip beyond the single fitted frustum
(ADR 0009); the lamp pool is capped at three real lights (ADR 0020).
three r186 ships `WebGPURenderer` with a WebGL2 fallback backend, TSL
node materials and node-based post (`GTAONode`, `DepthOfFieldNode`,
`SMAANode`), `CSMShadowNode` and `ClusteredLighting`.

## Decision (proposed)

Port the materials to TSL and the post stack to three's node post
pipeline, on `WebGPURenderer` (WebGPU where available, WebGL2 otherwise),
layer by layer, after a spike on real GPUs confirms the look and the
frame time (plan 020). Do not keep a second, GLSL path.

## Consequences (expected)

- No chunk-name patches, no cache keys, no shader-anchor tests; the
  `postprocessing` and `n8ao` dependencies go.
- CSM and clustered lights become available (each its own decision).
- GTAO is not N8AO: contact shadows must be re-tuned by eye.
- 3DTilesRendererJS works with any renderer for loading; its fade and
  overlay plugins patch GLSL and stay unused.
- Headless CI keeps SwiftShader through the WebGL2 backend.

## Alternatives

- **Stay on WebGL + GLSL patches:** works; the patches remain the most
  fragile code in the repo.
- **Own `ShaderMaterial`s with explicit includes:** trades chunk
  anchors for copies of three's lighting code.

## References

- Plan 020; ADRs 0009, 0010, 0011, 0020, 0024.
