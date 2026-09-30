# ADR 0027: WebGPURenderer and TSL node materials, one path

- **Status:** accepted (2026-09-26)
- **Date:** 2026-09

## Context

Every custom look was a string patch on three.js shader chunks
(`onBeforeCompile` + `.replace("#include <…>")`, 33 sites in 19 files by
the time of the port), with `customProgramCacheKey` bookkeeping and chunk
names that three can rename under us; a failed replace switched a feature
off with green CI. The post stack was two extra libraries
(`postprocessing`, `n8ao` with a hand-written type shim) plus two custom
effect classes, and height fog a patch folded into every lit material — a
material that forgot it floated out of the haze.

three r186 ships `WebGPURenderer` (WebGPU, with a WebGL2 fallback backend),
TSL node materials, `scene.fogNode`, node post (`GTAONode`,
`DepthOfFieldNode`, `SMAANode`), `CSMShadowNode` and clustered lighting.
A spike (plan 020) measured WebGPU 40–80 % faster than the WebGL path at
the same look on an Apple Silicon Mac, and found where a naive port
stalls: node builds (TSL → WGSL) run on the main thread, three builds
every `InstancedMesh` separately, and a scene pass nested inside the post
pipeline never matches what `compileAsync` prepared. The spike answered
those by patching renderer internals, which kept misbehaving; its branch
was set aside.

## Decision

- **One renderer:** `WebGPURenderer` — its WebGPU backend where the browser
  has WebGPU, its WebGL2 backend otherwise (`?gpu=webgl2` forces it for
  QA). No WebGLRenderer, no GLSL, no second path.
- **Every look is a TSL node material** (`colorNode`, `normalNode`,
  `emissiveNode`, `aoNode`, `receivedShadowNode`, `maskNode`,
  `positionNode`, …). The look's sliders are uniform nodes every tile
  shares; fog is one `scene.fogNode`.
- **Public API only.** No prototype patches, no private renderer members.
  The stalls are designed out instead:
  - the scene renders **top-level into its own target** and the node
    `RenderPipeline` reads its colour and depth — so a build prepared by
    `compileAsync` against that target is the build the frame uses (three
    keys a build by render context, and a context by target and call
    depth);
  - instanced layers draw through **`Instances`** (a plain `Mesh` over an
    `InstancedBufferGeometry`, the instance matrix and colour as named
    attributes): the build key then holds material and layout, not a mesh
    uuid, so every set with the same material shares one build;
  - materials without per-tile data are **scene-wide** (`sceneMaterial`),
    one build for the whole site;
  - tiles and dressings are compiled ahead (`compileAsync`, per material
    and layout) before they show.
- **Post:** three's `RenderPipeline` — GTAO (half resolution, normals from
  depth) × the contact slider → DoF (dropped while moving, two prebuilt
  pipelines) → SMAA → depth grading, vignette and paper grain → sRGB, no
  tone mapping.

## Consequences

- No chunk-name patches, no cache keys, no shader-anchor tests; a look
  term is a type-checked node expression. `postprocessing`, `n8ao`,
  `types/n8ao.d.ts` and the two effect classes are gone.
- The shadow recipe keeps its numbers (PCF with a raised `shadow.radius` —
  three's `ShadowFilterNode` spreads the same 5-tap Vogel disk —,
  `normalBias` 0, a small negative bias, the fitted frustum). There are no
  custom depth materials: the shadow pass takes a material's
  `castShadowPositionNode ?? positionNode` and honours `maskNode`.
- GTAO is not N8AO: the contact shadows were re-tuned and still want a
  look on a real GPU.
- The shadow pass's pipelines for newly landed casters still compile
  inside the frame that first draws them (`compileAsync` prepares the main
  pass); on the WebGL2 backend compiles are synchronous. Both are the
  price of staying on public API; measure with the flight probe before
  reaching for more.
- Browsers without WebGPU get the WebGL2 backend: the same picture.
- CSM and clustered lights become available (each its own decision).
- 3DTilesRendererJS works with any renderer for loading; its fade and
  overlay plugins patch GLSL and stay unused.
- Headless CI keeps SwiftShader through the WebGL2 backend.

## Alternatives

- **Stay on WebGL + GLSL patches:** worked; the patches were the most
  fragile code in the repo.
- **WebGPU plus a WebGLRenderer fallback:** the fastest fallback today, at
  the price of every look written twice.
- **Patch three's renderer internals** (the spike's render guard, shared
  instancing and render-context override): fixed stalls on paper but
  depended on private members three renames at will, and misbehaved in
  ways that could not be pinned down.
- **Own `ShaderMaterial`s with explicit includes:** trades chunk anchors
  for copies of three's lighting code.

## References

- Plan 020 (condensed in [completed.md](../plans/completed.md)); ADRs 0009,
  0010, 0011, 0020, 0024.
