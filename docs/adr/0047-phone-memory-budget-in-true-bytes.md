# ADR 0047: A phone's memory is budgeted in true bytes — a post profile per tier, fixed costs counted, the cache derived from the governor's line, CPU copies dropped after upload

- **Status:** accepted
- **Date:** 2026-10-06

## Context

The phone's numbers did not add up (the iPhone of
[ADR 0046](./0046-a-per-device-safety-ladder-for-gpu-loss.md): a 603×1311
drawing buffer, 790 533 px):

- **Fixed costs nobody counted.** The post stack's screen-sized targets
  came to 68 MiB before a single tile: SMAA's three full-resolution
  half-float targets and the frame copy it reads (24 MiB), depth of
  field's six targets and its own copy of its input (23 MiB), the
  selection outline's half-float mask and blur (9 MiB, drawn every frame),
  the AO smoothing's half-float target with a depth buffer. The shadow map
  was 32 MiB, not the 16 the docs said: three's `ShadowNode` gives the
  2048² depth map a colour attachment of the shadow's `mapType` (RGBA, 4
  bytes a texel) beside it. About 100 MiB that no step of the memory
  governor could touch.
- **A cache that never bound.** The phone's tile cache was 320–600 MB of
  true tile bytes; with the fixed costs and three's count on top, its upper
  bound sat near 750 MB held — above every loss seen (495–761 MB) and above
  the governor's own hard line (560 MB). The cache never held anything
  back before Safari took the GPU.
- **Per-tile rasters.** A coarse level held 45.7 MiB of rasters on a phone,
  16 of them the sports grounds' 2048² RGBA index, read on both levels (14
  of Dresden's 15 tiles have grounds); a tile showing its fine level 75.7.
  That model matched the heartbeats (333 MiB modelled, 339 seen).
- **The sun's shadow camera pinned fine terrain.** It streamed at the
  shadow map's 2048 px, and the tile renderer measures an orthographic
  camera's error as the geometric error over its pixel, whatever the
  distance: the coarse level's 40 m came to 372, 186, 93 and 46.5 px over
  the 110–880 m frustums, against a target of 16. Every tile the frustum
  touched was refined to its fine level, and flying at 228 m held up to
  four of them (642 → 677 MB).
- **The page's own process.** Safari charges WebGPU allocations to the
  page and three keeps every attribute's CPU array after upload; the glTF
  parser's result (its binary chunk and decoded buffers) stayed with each
  tile; a fine level held its decoded rasters (up to 16 MiB each, ~48 MiB
  a level) until its compile; the tile renderer downloaded 25 and parsed 5
  contents at once — the boot asked for eleven in one millisecond. Pages
  died right after the first frame at only 277–312 MB held.

## Decision

**A post profile per device tier** (`postProfileFor` in
`scene-profile.ts`). A phone builds no depth of field (since 2026-10-10
no device has a switch for it), antialiases with FXAA inside the last
pass (`fxaa.ts`: three's FXAANode ported with a perceptual luma, √ of the
linear luma, over the linear frame, and explicit level-0 samples), draws
into `BeforeAA` only while a picture style is on (freed on the first
pastel frame), and its idle warm-up compiles only the outline's programs —
a style builds on its first frame. On every tier the AO smoothing target
is one byte without depth; the outline's mask is one byte at full
resolution, blurred by its own two-pass one-byte blur at half resolution
(the kernel `outlineKernel`), drawn only while something is asked and
freed `OUTLINE_KEEP_MS` (10 s) after; depth of field (desktop) reads its
input without a depth buffer. **The shadow map's colour target is one red
byte** (`OneByteShadowNode`, installed as the light's
`shadow.shadowNode` — the hook three's own CSM and tiled shadows use, so
nothing of three is patched, ADR 0027). On the iPhone the fixed costs went
from 100 to 29.6 MiB (9.6 of targets, 20 of shadow map), +0.9 while
something is asked, +6 while a style is on; at 2560×1440 on a desktop
from 388 to 296 MiB.

**The fixed costs are counted** — `shadowMapBytesFor(size)` = size² × 5
(depth and the one-byte colour), and a phone's screen targets at 24 bytes
per drawn pixel (the scene's colour and depth, the one-byte AO and outline
targets, a style's `BeforeAA` while one is on): 38, 32.5, 13 and 11 MiB
on a 402×874 iPhone at the four safety levels.

**A phone's tile cache is derived from the governor's soft line**:
`max` = soft − fixed − 100 MiB (~40 for the scene-wide sets — sky, lamp
pool, data layers, uniform buffers, shader text — and ~60 of headroom:
tiles in flight weigh nothing, the cache unloads only past `max`, and
three counts a tree set's matrices once per view). Against 480, 432, 389
and 350 MiB of soft line that is 336, 296, 272 and 232 MiB; `min` is
about half (168, 148, 136, 96), and `max − min` stays above the largest
tile (`LARGEST_TILE_BYTES`, 128 MiB on a phone). The tests hold all three
relations. The desktop keeps its 1.2–1.6 GB at level 0. The governor's
lines stay on three's count (`info.memory.total`), where they were
measured on the phone.

**Fewer bytes a tile.**

- A phone's coarse level reads no sports raster (`readsSportGrounds`):
  −16 MiB per coarse tile; beyond the fine level a pitch shows its
  land-cover class.
- The coarse grid's index and the water index derived from it are one copy
  for the site (`createGridShare`, kept only where a tile's numbers are
  exactly the site's): −12 MiB per coarse tile after the first, on the GPU
  and the CPU. The cache weighs a tile without them
  (`calculateBytesUsed` subtracts `sceneSharedBytes`).
- **CPU copies go once the GPU has them.** After a content's compile
  resolved — uploaded: `PostStack.compile` resolves only once every
  drawable under the root has been through `compileAsync`, those another
  compile had started too (`compile-lanes.ts`; the boot's compile of the
  whole scene can be inside a slow tile's water when the tile's own
  compile reaches it, and the tile waits for that step instead of
  skipping it) — and while its tile is still there, an allowlist of
  attributes give up their arrays (`dropCpuCopies`, empty arrays of the
  same kind, bounds computed first): the terrain's positions and normals,
  a grid's own index, the water's own index, the stairs', walls' and
  kerbs' positions, normals and indices, the stairs' colours, the fences'
  positions, band uv and index (`cpuDroppable`); the city's normals and
  roof flags (`cityCpuDroppable`). Measured on the CPU per content: city
  9.98 → 5.33 MiB, fine terrain 27.38 → 7.71, coarse 16.39 → 0.80 (with
  the shared index) — about 190 MiB less in a view of five cities, four
  fine and six coarse levels. The glTF loader's result goes at
  `load-model` (`dropLoaderResult`), and with it the parser's chunk.
- **Rasters decode in a site-wide turn** (`raster-upload.ts` over
  `lib/city/task-gate.ts`, `setRasterTier` set by the stream for its
  tier). A phone takes **one at a time** and puts each on the GPU at once
  (`renderer.initTexture`), its bytes dropped at the upload: at most one
  decoded raster (16 MiB) waits, instead of ~48 MiB per level times five
  parses. A desktop keeps what it always did — five decodes at once, each
  raster uploaded by its level's compile: through one turn the spawn
  tile's ground waited behind every neighbour's, and uploaded at decode,
  every neighbour's rasters took the main thread before the spawn tile's
  compile (7 s of the first 18 under SwiftShader); the whole-site boot
  took 40 %, then 15 % longer, and with both kept to the phone it is as
  fast as before (134 s against main's 138 s on the same machine). The
  download — through the retrying fetch, ADR 0048 — stays outside the
  gate.
- **A level whose tile leaves stops its raster loads.** The tile cache
  evicts a level still dressing as soon as the camera no longer wants it
  (a flight, the boot camera's first looks, the emergency's shed of
  every unused tile). Its loads had only the stream's lifetime signal:
  each raster it named still took its turn, decoded and uploaded, and
  was freed at once — on the whole-site lite boot under SwiftShader
  13 s more of texture uploads than before this ADR's changes, and on a
  phone one of its two parse slots held meanwhile. `DressingPlugin` now gives each content root an
  abort of its own, fired in `disposeTile`; the level's wait on a shared
  raster ends with it (`untilAborted`), so everything it took is let go
  at once, and a shared load every holder left is aborted in its turn —
  a class raster that landed for nobody paints no splat.
- **A phone streams fewer tiles at once** (`PHONE_STREAM`: 2 parses,
  4 downloads per origin, the renderer's own queues replaced before its
  first update; the defaults are module-wide singletons).

**The shadow camera streams at a resolution of its own**
(`SHADOW_STREAM_PX` in `lib/city/shadow-fit.ts`, per tier). A phone's is
64 px: the coarse terrain's error stays at or below 11.6 px at every
radius (under the target of 16), so it never refines terrain, while a
tile's buildings (≥ 3 636 px) and the coarse level under them still load
for the shadow. A desktop's is 128 px: it has the memory for the fine
level under the eye-level frustum, where the coarse level's 23 px still
refine it (a neighbour behind the player casts its own trees' shadows,
and the whole-site boot asks for the spawn tile's fine level as early as
it did), but no longer under the wide frustums from the air (11.6 px and
less from 220 m on).

**A failed allocation costs a dressing, not the page.** A compile the GPU
had no room for (`lib/city/gpu-allocation.ts`: the `createAttribute`
RangeError, WebKit's "Unable to …" InvalidStateError, an OperationError,
`GPUOutOfMemoryError`) leaves its dressing off and reports
`onAllocationFailure` → the trail's `alloc-failed` and `memoryEmergency`
(ADR 0046); disposal steps past a half-made attribute
(`disposeGeometry`), and a leaving tile whose dressing still compiles has
its content freed by the plugin, so the renderer's own dispose never meets
one.

## Consequences

Two rules for every later change:

- **An attribute read on the CPU after the dressing, or first read by a
  material the tile's own does not use, stays off the drop lists**
  (`cpuDroppable`, `cityCpuDroppable`). Three uploads an attribute the first
  time a material reads it; met after the drop, it uploads an empty buffer
  and the draw fails validation. The city keeps its positions, index and
  feature ids (BVH, collision, picks, demolish, the outline's triangles);
  the TIN keeps its index (`TinIndex` reads it); the water's and the
  fences' normals stay because their materials never read them and a
  later one (the Papier override) might. A new style, cut or export that
  reads a tile's geometry checks the lists first, and so does a new CPU
  reader. `TileStreamContext.compile` resolving `true` must keep meaning
  "uploaded": a compile that skips a drawable must still wait for
  whoever compiles it (`compile-lanes.ts`), and a step that failed fails
  every compile waiting for it.
- **A scene-shared attribute is never on a geometry when that geometry is
  disposed** (`markSceneShared`): three's dispose destroys the GPU buffer
  of every attribute the geometry holds, and every other tile would draw
  from a destroyed buffer. A release detaches them at once
  (`detachSceneShared`, before the tile renderer's own dispose);
  `disposeGeometry` and `disposeObject3D` detach first.

And:

- A new screen-sized target goes into the phone's fixed cost, and the
  cache is derived again (`tileCacheBytesFor`'s comment carries the sum).
  Keep `renderer.shadowMap.transmitted` off: coloured shadows would read a
  red-only target.
- A new raster loader goes through `raster-upload.ts`
  (`fetchRasterBytes`, `inRasterTurn`, `uploadNow`, `dropDataOnUpload`)
  and takes its level's signal: a level whose tile left must not decode
  or upload another raster.
- A compile that throws inside three's `compileAsync` leaves three's
  private pre-compiling flag raised until the next compile that succeeds
  (only `ShadowNode.updateBefore` reads it), so the shadow map can pause
  until the next tile compiles. Accepted and reported; three's private
  members stay untouched (ADR 0027).
- A portrait spawn view wanted ~380 MiB of tile bytes at the old raster
  sizes against the 336 MiB `max`: the farthest tiles arrive later, or
  only once the governor lets fine levels go. FXAA is softer than SMAA on
  fine contrast; the AO and the outline's halo are quantised to 8 bits; a
  phone's first switch to a style hitches, and near a seam with the sun
  behind, a neighbour the phone's view does not refine casts its coarse
  crowns' shadows (the desktop keeps both its raster overlap and its
  eye-level shadow tiles). A compile now also waits for the steps another
  compile has in flight on its drawables — the boot's compile of the
  scene for one compileAsync per lane of the tiles still compiling. All
  of it waits for a look on a real GPU (plan 019, section M).
- The heartbeat says where the memory went (`rast`, `cache`, `terr`,
  `net`; docs/rendering.md, "GPU memory on a phone").

## Alternatives

- **Governing on the page's own (WebContent) footprint**: Safari exposes
  neither `performance.memory` nor `navigator.deviceMemory`; there is
  nothing to read. Deferred; the heartbeat's raster and cache figures
  stand in.
- **Admission control with predicted bytes** (the build writes each
  content's bytes into the tileset; the cache weighs tiles in flight by
  them): the root fix for the boot burst, but a bake change and a new
  tileset field. Deferred — the phone's pacing and the raster gate cut the
  burst now; revisit if boot kills stay in the reports.
- **A half-resolution splat, or 1024² phone twins of the class, sports and
  edge rasters**: up to −35 MiB per coarse tile, but a re-bake and softer
  ground near the camera to judge on a GPU. Deferred; the sports skip took
  the largest single raster.
- **Streaming only as far as the fog reaches** (a proxy camera whose far
  plane is the fog's): fewer coarse tiles out of sight, but it changes what
  flights and Modell load. Deferred.
- **Counting true bytes in the governor**: the lines would have to be
  measured on the phone again; they stay on three's count.
- **Dropping every CPU copy**: collision, picks, demolish, the outline and
  the height samplers read them.
- **No DoF on phones by the safety ladder only** (from level 1): its 23
  MiB were the cost from the first frame, for a lens hint a six-inch
  screen barely shows.

## References

- `app/_components/scene-profile.ts` (`postProfileFor`,
  `shadowMapBytesFor`, `tileCacheBytesFor`, + test),
  `app/_components/post-stack.ts`, `app/_components/compile-lanes.ts`
  (+ test), `app/_components/fxaa.ts`,
  `app/_components/selection-outline.ts`, `lib/city/outline.ts`,
  `app/_components/sun-rig.ts` (`OneByteShadowNode`)
- `app/_components/tile-stream.ts` (`PHONE_STREAM`, `paceStreaming`,
  `dropLoaderResult`, `dropContentCopies`, `calculateBytesUsed`,
  `loadAborts`), `app/_components/terrain-layer.ts`
  (`readsSportGrounds`, `createGridShare`, `cpuDroppable`, + test),
  `app/_components/three-utils.ts` (`dropCpuCopies`, `markSceneShared`,
  `disposeGeometry`), `app/_components/fetch-optional.ts`
  (`untilAborted`), `app/_components/raster-upload.ts` (`RASTER_TURNS`),
  `lib/city/task-gate.ts`,
  `lib/city/gpu-allocation.ts`, `lib/city/shadow-fit.ts`
  (`SHADOW_STREAM_PX`)
- [ADR 0011](./0011-motion-keyed-quality-regression.md) (DoF while
  moving), [ADR 0027](./0027-webgpu-renderer-and-tsl.md) (public API),
  [ADR 0046](./0046-a-per-device-safety-ladder-for-gpu-loss.md);
  🗃️ *Sports grounds on a phone's coarse level* in
  [transformations.md](../transformations.md)
