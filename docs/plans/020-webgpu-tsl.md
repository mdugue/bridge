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
- **Status**: IN PROGRESS — Phase 0 spike done 2026-09-24 (see "Phase 0 findings": WebGPU 40–80 % faster at the same look); the gate awaits the maintainer

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
`../webgpu-spike`, `bun dev -- --port 3002`): `?gpu=webgpu` and
`?gpu=webgl2` switch the same build to `WebGPURenderer` (WebGPU backend, or
forced onto its WebGL2 backend); no parameter is today's path.
`e2e/spike-probe.ts` boots each mode, flies to four viewpoints, lets each
settle 10 s, counts frames over 8 s and writes plates;
`e2e/spike-bisect.ts` measures one view with one effect off at a time.

**Ported to TSL, term for term:** the clay; terrain (splat, contour ink,
meadow mottle, grass normals, NDVI tint); water (feathered coverage,
Fresnel sky tint, ripples, sun glitter, river mist); crowns (sway,
sway-coupled brightness, leaf twinkle, backlit shimmer, translucency) and
trunks; the land-cover paint pass; the sky (`SkyMesh`); lamp halos (an
instanced `Sprite` with `PointsNodeMaterial` — WebGPU draws point
primitives 1 px wide); height fog as **one `scene.fogNode`** for every
material instead of a patch per material; the post stack as a
`RenderPipeline`: GTAO (half res) → `DepthOfFieldNode` (crosshair focus,
dropped while moving) → SMAA → depth grading → vignette → paper grain.
Each of these is a few lines of TSL; `postprocessing`, `n8ao` and the two
custom effect classes have no counterpart.

**Not ported:** the shimmer's shadow gate (the GLSL samples the sun's
shadow map 2 m toward the sun; the node version gates on sun elevation),
the rail and wall materials' own details (fog now comes from the scene),
the per-tree sway phase from the instance's world column (it hashes the
instance index). GTAO reads a little darker than N8AO; the sky is paler by
day and pure black at night (Sky.js was a dark warm grey) — both tuning.

**Frame rate, all effects on, settled (fps):**

| View | today (WebGL, GLSL + postprocessing) | WebGPURenderer → WebGL2 | WebGPURenderer → WebGPU |
|---|---|---|---|
| Canaletto (eye level) | 67 | 59 | **94** |
| Über den Dächern | 42 | 30 | **60** |
| Elbe-Panorama (246 m) | 33 | 39 | **50** |
| Carolabrücke (70 m) | 54 | 63 | **98** |
| ready (dev server) | 8.1 s | 18.7 s | **6.3 s** |

- **WebGPU is 40–80 % faster than today at the same look** and boots
  faster. (A first run before a machine restart showed the WebGPU backend
  2–3× slower in wide views; that was the machine, not the renderer.)
- **The WebGL2 backend** — what a browser without WebGPU gets — is about
  as fast as today in steady state but stalls for seconds whenever new
  materials appear (a camera jump, a tile landing: 1.8 fps right after the
  jump to Carolabrücke, 43 fps a few seconds later). It compiles node
  shaders synchronously. `renderer.compileAsync` under the load overlay
  and when a tile is dressed is the fix to try first.

**Vertex formats.** The first run rendered nothing on WebGPU. The cause
was not the quantised positions and normals (three pads snorm16×3 and
snorm8×3 to ×4 by itself) but the two **one-component** 8/16-bit
attributes: the per-vertex feature id (uint16) and roof flag (uint8).
three's WebGPU backend has no mapping for 1-component 8/16-bit formats,
and its WebGL2 backend rejects them against TSL's float attribute. The
spike widens exactly those two to Float32 on load (≈ 0.5 MB per city
tile, no measurable frame cost). For the real port, write them as FLOAT in
the bake (`EXT_mesh_features` allows it; ≈ tens of KB more per tile on the
wire after meshopt + gzip) and drop the runtime widening.

**Also found:** closing the class raster's `ImageBitmap` in `onUpdate`
leaves it empty on node pages (the renderer uploads it again) — keep the
bitmap or upload from a typed array. 3DTilesRendererJS needed no change.

**Stutter on long flights** (a 56 s flight over eight viewpoints, frames
recorded in the page, 2026-09-24):

| | frames > 100 ms | > 500 ms | total stalled |
|---|---|---|---|
| today, before | 6 | 2 | 2.4 s |
| today, with compileAsync + no terrain BVH | **0** | 0 | **0 s** |
| WebGPU, before | 21 | 4 | 7.8 s |
| WebGPU, with both | 5 | 2 | 2.4 s |
| WebGPURenderer → WebGL2, with both | 69 | 24 | 55 s |

Two fixes landed on the main branch and help both renderers: tiles and
dressings are compiled with `compileAsync` before they show, and the
terrain BVH (~1 s of main thread per fine tile) is gone — the two ground
rays march the height grid (`lib/city/ground-ray.ts`). On the node
renderer `compileAsync` only pays off if the precompiled shader is the one
the scene pass uses: three builds node shaders asynchronously and reads
MRT, tone mapping and colour space at that time, so the spike's pass has
no MRT (GTAO reconstructs normals from depth), the renderer stays linear
and untonemapped, and `renderOutput(ACES, sRGB)` is the last node.

What remains on WebGPU (two long tasks of 0.6–1.2 s early in a flight)
is **the first shadow render of newly landed content**: the CPU profile's
longest task sits in `render › updateBefore › render` — the sun's shadow
map redrawn while a receiving object draws, creating the shadow pass's
render objects and pipelines for the new objects synchronously.
`compileAsync` only primes the main pass. Neither geometry upload nor tile
size is the cause (an earlier reading of the profile blamed `writeBuffer`;
that time is spread over every frame), and more, smaller tiles would add
objects. Next steps for Phase 1: prime the shadow pass (compile against
the shadow camera and map), or ask upstream.

**First-visit stalls, found and fixed (2026-09-26).** The long stalls
that came only on the first flight into unseen parts of the city (the
same flight again was smooth) had three causes in three r186, all in the
first frame that drew a new object — and the shadow pass above was where
most of them landed:

1. **Instanced WGSL depended on the instance count.** Under the uniform
   buffer limit three reads an `InstancedMesh`'s matrices from a uniform
   array whose length is written into the shader (`Instance.js`), so every
   vegetation cell, lamp or monument group with a new instance count was a
   new shader module and a new render pipeline, compiled blocking. A
   headless probe (`?gpu=webgl2&scene=lite&block=1`, five hops) counted 82
   new programs and 82 blocking pipelines on the first hop, 3 on the same
   hop again.
2. **Pipelines were created blocking** wherever `compileAsync` had not
   reached — and it does not reach the shadow pass, nor anything hidden or
   off screen when it ran (it culls like a frame).
3. **Every instanced mesh is its own node build** (three keys the build by
   the mesh's uuid), in the main pass and again in the shadow pass, so a
   representative per material primed one mesh of hundreds.

The fix is `app/_components/node-render-guard.ts`: a uniform buffer limit
of 0 (instancing through instance attributes — the same code for any
count, as on WebGL), every in-frame pipeline through the async API (an
object waits, undrawn, until its pipeline is ready; the shadow map is
redrawn then), and a 6 ms per-frame budget for in-frame node builds. Tiles
and dressings compile ahead with every object exposed (not culled, not
hidden), and the node renderer compiles every part of a dressing, not a
representative. With the guard, the same probe counted 0 new programs and
0 blocking pipelines on every hop (37 frames instead of 10 in the first
hop's 45 s; SwiftShader frame times say little else). Plates and frame
times on a real GPU are still to take. `app/_components/node-probe.ts` keeps the counters on
`window.__gpuStats` for the next probe.

**Precompiling never reached the frame, and panning rebuilt the scene
(2026-09-26).** three keys a node build by its render context
(`RenderObject.getMaterialCacheKey` adds `context.id`), and a context by
its target *and the call depth* it is drawn at. The scene pass is drawn
inside the post pipeline's other draws, at a depth that depends on which
pass asks for it first — a different one in the DoF and the plain
pipeline — and `compileAsync` always asks for depth 0. So nothing a tile
precompiled was the build its frame looked up, and every switch between
the two pipelines (DoF drops while the camera moves) built every object
again inside frames: the old spike stalled for seconds while panning
from the air, and with the render guard the scene went missing in
patches instead. `post-stack-node.ts` now gives the scene pass's target
and the shadow map one context at any depth (each is drawn once per
frame, never inside itself). In a headless boot the in-frame builds of
scene objects went from all of them to none; what is still built in
frames is the post stack's own passes at boot and the shadow casters. On
the node path a tile also waits up to 12 s (not 3 s) for its compile
before it shows, so a finer terrain level never shows as a hole.

**Hundreds of builds per tile, and iPhones gave up (2026-09-26).** On an
iPhone the node path hung at "4/5" (the neighbour tiles), closed the tab,
or reported a tile failing with "Maximum call stack size exceeded".
three builds every `InstancedMesh` on its own (the render object's key
carries the mesh's uuid, as its instancing node binds that mesh's matrix
buffer), and a tile's dressing is hundreds of instanced meshes, each
drawn twice (main and shadow pass): hundreds of identical WGSL
translations and pipelines per tile. `shared-instancing.ts` hands a
mesh's matrices and colours to the build as named geometry attributes
(`iMat0`…`iMat3`, `iColor`, views of its own arrays) and takes the uuid
out of the key, so every mesh with the same material and layout shares
one build; the crown's sway reads the same attributes. A headless lite
boot went from 255 to 31 node builds. The rasters' CPU bytes are now
released after upload on the node path too (a re-upload counter in
`node-probe.ts` counted none on either backend). The stack overflow did
not reproduce: WebKit on Linux has no WebGPU, and its WebGL2 path boots
under a much smaller stack. The toast now carries the first frames of
the failing stack on the node path, for the next report.

**What a tile keeps resident (2026-09-26, after the audit of PR #67).**
The main branch's audit listed what the port should start from; the
memory items are done here, as iPhones kept crashing while looking
around. A tile's painted splat was the class raster's size on both
levels: at 4096² RGBA with mipmaps that is ~89 MB for the fine level and
~22 MB for the coarse one (phones: 22 MB each). The coarse level now
paints at half the edge (~5.6 MB), the two levels share one class raster
where they read the same file and one NDVI texture, and the tile cache
counts what it did not see before: the rasters bound as uniforms and the
dressing. With those in the count the cache's phone budget (120–180 MB)
bounds what lingers, which it did not while a fine tile's rasters alone
could exceed it. The merge of main also silently removed the shared-
material check from `disposeMaterial` (dead on main, live here): restored
with its test.

Also tried and dropped: one shared terrain / water / clay material with
the per-tile textures bound per draw via `onObjectUpdate`. The per-object
textures did not reach the draws (grey ground, untinted clay), and node
builds per tile material turned out cheap (none over 20 ms). Shared
materials stay for the trees, which carry no per-tile data. The post
stack keeps two prebuilt pipelines (with and without DoF) instead of
swapping one pipeline's output node when the camera starts or stops.

**Colour:** today's WebGL path applies **no tone mapping**. three
tone-maps only renders straight to the screen; the composer renders to a
target and postprocessing's passes are `toneMapped: false`, so
`renderer.toneMapping = ACESFilmicToneMapping` in `create-app.ts` is
inert. The spike first applied ACES in its output node, which washed the
clay out; it now outputs plain sRGB like today.

**The WebGL2 backend** of WebGPURenderer stalls far worse than either:
it compiles node shaders synchronously even under `compileAsync`. Browsers
without WebGPU should keep today's WebGLRenderer path rather than get the
node renderer's fallback — or wait for three to make that backend's
compile asynchronous.

**Gate reading.** Neither reject criterion triggers: the WebGL2 backend
is not > 25 % slower than today, and the clay (indeed the whole look)
matches. Recommended: accept ADR 0027 for browsers with WebGPU,
keep today's WebGL path as the fallback (not the node renderer's WebGL2
backend), and start Phase 1 with chunked fine terrain. The FLOAT id/roof
attributes and `compileAsync` are already on the main branch.

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
