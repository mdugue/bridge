# ADR 0027: WebGPURenderer and TSL node materials, one path, public API only

- **Status:** accepted
- **Date:** 2026-09

## Context

Every custom look used to be a string patch on three.js shader chunks
(`onBeforeCompile`), fragile against renames and silent when a patch
failed. three r186 ships `WebGPURenderer` (WebGPU, with a WebGL2 backend),
TSL node materials, `scene.fogNode` and node post-processing. A spike
measured WebGPU 40–80 % faster at the same look, and found where a naive
port stalls: node builds run on the main thread, every `InstancedMesh`
builds separately, and a scene pass nested in the post pipeline never
matches what `compileAsync` prepared. The spike fixed those by patching
renderer internals, which kept misbehaving.

## Decision

- **One renderer:** `WebGPURenderer`, on WebGPU where the browser has it,
  else its WebGL2 backend (`?gpu=webgl2` forces it). No WebGLRenderer, no
  GLSL, no second path.
- **Every look term is a TSL node** on a node material; a fixed strength is
  a named constant node, anything that moves a shared uniform's `.value`.
  Fog is the one `scene.fogNode`.
- **Public API only:** no prototype patches, no private members. The
  stalls are designed out instead: the scene renders top-level into its
  own target that the post pipeline reads; instanced sets are `Instances`
  (a plain `Mesh` over an `InstancedBufferGeometry`), so sets share a
  build; materials without per-tile data are scene-wide; tiles and
  dressings are compiled before they show.

## Consequences

- A look term is a type-checked expression; there are no chunk names to
  pin.
- The shadow pass's pipelines for new casters still build in the frame
  that first draws them, and the WebGL2 backend compiles synchronously —
  the price of public API. Measure before adding machinery.
- WebGPU's limits bind every material: eight vertex buffers, sixteen
  inter-stage variables (the clay uses all but two). A mesh past either
  does not draw on WebGPU while WebGL2 still draws it.
- Headless CI renders through the WebGL2 backend over SwiftShader.

## Alternatives

- **WebGL with GLSL patches:** worked, but the patches were the most
  fragile code in the repo.
- **WebGPU plus a WebGLRenderer fallback:** every look written twice.
- **Patching three's renderer** (render guard, shared instancing, context
  override): depended on private members and misbehaved unpredictably.
- **`InstancedMesh`:** three puts its uuid in the build key — one build per
  set.
