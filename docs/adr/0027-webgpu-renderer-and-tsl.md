# ADR 0027: WebGPURenderer and TSL node materials, one path, public API only

- **Status:** accepted
- **Date:** 2026-09

## Context

Every custom look used to be a string patch on three.js shader chunks
(`onBeforeCompile`), fragile against renames and silent when a patch
failed. three (r186 then, r187 now) ships `WebGPURenderer`, TSL node materials, `scene.fogNode` and node
post-processing. A spike measured WebGPU 40–80 % faster at the same look,
and found where a naive port stalls: node builds run on the main thread,
every `InstancedMesh` built separately, and a scene pass nested in the
post pipeline never matched what `compileAsync` prepared (r187 fixed both
in three). The spike fixed those by patching renderer internals, which
kept misbehaving.

## Decision

- **One renderer, one backend:** `WebGPURenderer` on WebGPU. A browser
  without a WebGPU adapter is told so; three's WebGL2 backend is not
  used. No WebGLRenderer, no GLSL, no second path.
- **Every look term is a TSL node** on a node material; a fixed strength is
  a named constant node, anything that moves a shared uniform's `.value`.
  What the sun and the date move lives in `scene-environment.ts`: a layer
  reads it and adds no setter to `setSun`. Fog is the one `scene.fogNode`.
- **Public API only:** no prototype patches, no private members. The
  stalls are designed out instead: the scene renders top-level into its
  own target that the post pipeline reads; instanced sets are `Instances`
  (a plain `Mesh` over an `InstancedBufferGeometry`), so sets share a
  build; materials without per-tile data are scene-wide; tiles and
  dressings are compiled before they show, one compile at a time, and
  Modell's parallel camera gets its own builds before it draws.

## Consequences

- A look term is a type-checked expression; there are no chunk names to
  pin.
- The shadow pass's pipelines for new casters still build in the frame
  that first draws them — the price of public API. Measure before adding machinery.
- Compiles run one at a time (`compileInTurn`), and a frame names the
  targets it draws into: three r187's `compileAsync` keeps its state on
  the renderer around every await inside it, so two in flight resume into
  each other's, and it restores the target it was called with. Both are
  upstream bugs, worked around until a release fixes them
  ([rendering.md](../rendering.md#workarounds-for-upstream-bugs)).
- A material builds once per kind of camera (r187: a parallel view's
  light has one fixed direction): Modell's builds are made while its dolly
  zoom in runs.
- WebGPU's limits bind every material: eight vertex buffers, sixteen
  inter-stage variables (the clay uses all but two). A mesh past either
  does not draw.
- Headless CI renders WebGPU over SwiftShader's Vulkan (Chrome's own
  Vulkan on SwiftShader too, or the canvas cannot present), so it meets
  the same limits as a device.
- iPhones before iOS 26, Firefox without WebGPU and blocklisted GPUs get
  the no-WebGPU message (decided 2026-11).

## Alternatives

- **WebGL with GLSL patches:** worked, but the patches were the most
  fragile code in the repo.
- **WebGPU plus a WebGLRenderer fallback:** every look written twice.
- **Patching three's renderer** (render guard, shared instancing, context
  override): depended on private members and misbehaved unpredictably.
- **`InstancedMesh`:** up to r186 three put its uuid in the build key —
  one build per set. r187 shares those builds; `Instances` stays because
  every layer's nodes and shared buffers are written for it, and
  `instanceColor` multiplies any object's colour by an InstancedMesh-only
  varying.
