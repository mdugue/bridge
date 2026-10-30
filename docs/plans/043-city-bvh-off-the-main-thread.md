# Plan 043: Build each city tile's collision BVH in a worker, not in the frame that shows the tile

> **Executor instructions**: This plan has a **measurement gate** (step 1)
> and a **prototype gate** (step 3). Follow the steps in order, run every
> verification, and honour the STOP conditions — this is the riskiest perf
> change in this batch. When done (or stopped at a gate), update this
> plan's row in `docs/plans/README.md` with the numbers you measured.
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- app/_components/city-layer.ts app/_components/collision.ts app/_components/create-app.ts app/_components/tile-stream.ts next.config.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — a window where a fresh tile has no BVH; a worker in the Next build
- **Depends on**: 041 step 3 (the collider tests guard this change) — do 041 first
- **Category**: perf
- **Planned at**: commit `a28de75`, 2026-10-01

## Why this matters

`dressCity` builds a three-mesh-bvh BVH over every city tile's merged
building mesh synchronously, inside `processTileModel` — for the spawn
tile that is before the first frame, and for every other tile it is a long
task in the middle of streaming or a flight. Measured in Bun on this
machine with the real baked geometry: **79 ms for 141 703 triangles and
87 ms for 156 056** (two tiles). On a phone that is plausibly 3–5× (unmeasured).
Fifteen tiles is over a second of desktop main thread, and the memory
governor makes phones evict and reload city tiles, rebuilding each time.
The BVH only serves collision, the DoF autofocus ray and demolish picks;
none of them needs it the instant a tile appears.

## Current state

`app/_components/city-layer.ts:122-174` (`dressCity`):

```ts
  const alive = new Uint8Array(count).fill(1);
  const featureIds = geometry.getAttribute("featureId");
  const rebuild = () => {
    const index = geometry.getIndex();
    if (!index) {
      return;
    }
    geometry.setIndex(
      new BufferAttribute(liveTriangles(index.array, featureIds.array, (i) => alive[i] === 1), 1)
    );
    geometry.disposeBoundsTree();
    // BVHs make per-frame collision rays (and demolish picks) cheap.
    geometry.computeBoundsTree();
  };
  for (const i of demolished) {
    alive[i] = 0;
  }
  if (demolished.size > 0) {
    rebuild();
  } else {
    geometry.computeBoundsTree();
  }
```

`computeBoundsTree` is installed on `BufferGeometry.prototype` by
`app/_components/collision.ts:22-25` (global wiring; a documented decision —
keep it). By default `MeshBVH` **rewrites the geometry's index** (it
reorders triangles); `indirect: true` keeps the index untouched and stores
its own indirect buffer.

Raycast users (all over `stream.visibleCities().map((c) => c.mesh)`):
- the collider, `create-app.ts:924-926` → `collision.ts`: `blockingNormal`
  uses `raycaster.intersectObjects(...)` (falls back to a brute-force
  raycast over ~150 k triangles on a mesh without a BVH); `vertical()`
  already skips meshes without `geometry.boundsTree` (`frameOf` returns null).
- the DoF autofocus, `create-app.ts:1128-1131` (`focusRaycaster.intersectObjects(targets, false)`), 10 Hz.
- demolish picks, `city-layer.ts:208-223` `pickCityObject` (on a key press).
- `create-app.ts:972` (check what it does; likely the double-tap target).

**Why not three-mesh-bvh's own `GenerateMeshBVHWorker`**
(`node_modules/three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js`):
it *transfers* the geometry's position and index buffers to the worker
(the geometry is unusable meanwhile — the tile's compile/upload runs right
after `dressCity`), rebuilds the attribute in the worker as
`new BufferAttribute(position, 3, false)` (**ignores `normalized`** — the
glTF positions are quantised, see AGENTS.md "Positions in the glTF are
quantised"), and on return overwrites `geometry.attributes.position.array`
with the float copy. A small worker of our own avoids all three.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |
| Production build | `bun run build` | exit 0 |
| E2E | `bun run test:e2e` (or the walk/collision specs with `-g`) | pass |

## Scope

**In scope**: `app/_components/city-layer.ts`,
`app/_components/city-bvh.worker.ts` (create),
`app/_components/city-bvh.ts` (create: the main-thread client),
`app/_components/create-app.ts` (target filters only),
`app/_components/collision.ts` (target filter only), tests for the new
module.

**Out of scope**: baking BVHs at build time (a different design — record it
if this one fails); the demolish path (stays synchronous: a user action on
one tile); the terrain (it has no BVH, `lib/city/ground-ray.ts`).

## Git workflow

Branch `claude/043-city-bvh-worker`; commits per step, e.g.
`perf(city): measure the BVH build per tile`, `perf(city): build the BVH in a worker`.
No push unless instructed.

## Steps

### Step 1: Measure (gate)

Add a temporary `performance.now()` around `geometry.computeBoundsTree()`
in `dressCity` and note it into the crash trail if available (or
`console.warn` behind `NODE_ENV === "development"` — remove before
committing). Run `bun dev`, load the full site in a desktop browser, fly
over a few tiles, read the times. If you can, do the same on a phone over
the LAN (`bun dev` serves HTTPS for that).

**Gate**: if the median per tile is **under 30 ms on desktop**, STOP —
report the numbers; the plan is not worth its risk. Otherwise continue and
put the numbers in the status row.

### Step 2: The worker and its client

`app/_components/city-bvh.worker.ts`:

```ts
import { BufferAttribute, BufferGeometry } from "three/webgpu"; // or "three" — see note
import { MeshBVH } from "three-mesh-bvh";

self.onmessage = (e: MessageEvent<{ id: number; position: Float32Array; index: Uint32Array }>) => {
  const { id, position, index } = e.data;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry, { indirect: true });
  const serialized = MeshBVH.serialize(bvh, { copyIndexBuffer: false });
  self.postMessage({ id, serialized }, [...serialized.roots, serialized.indirectBuffer.buffer]);
};
```

Note: the worker is its own bundle; importing `three/webgpu` there pulls
the renderer into the worker chunk. Prefer `"three"` (core math) **only in
this worker file** with a one-line comment why (AGENTS.md's "never plain
`three` in the viewer" is about the render path; a worker never renders).
If lint forbids it, use `three/webgpu`.

`app/_components/city-bvh.ts`:
- one lazily created `Worker` (`new Worker(new URL("./city-bvh.worker.ts", import.meta.url), { type: "module" })`),
- `buildBoundsTree(geometry): Promise<void>`: makes a **dequantised
  Float32 copy** of the positions (`for i: x = attr.getX(i)…` — getX
  applies `normalized`), a Uint32 copy of the index, posts them
  (transfer the copies), and on reply
  `geometry.boundsTree = MeshBVH.deserialize(serialized, geometry, { setIndex: false })`
  (indirect mode is detected from `indirectBuffer`). Requests are matched by
  `id`; a geometry disposed meanwhile is ignored (listen for its
  `"dispose"` event).
- a synchronous fallback (`geometry.computeBoundsTree()`) when `Worker` is
  undefined (Bun tests, old browsers).
- `dispose()` terminates the worker (call it from the stream's teardown).

**Verify**: `bun run typecheck` → exit 0; `bun run build` → exit 0 and
`ls .next/static/chunks | head` shows a separate worker chunk (search the
build output for `city-bvh`).

### Step 3: Use it, with the no-BVH window covered (prototype gate)

1. `dressCity`: replace the initial `geometry.computeBoundsTree()` (the
   `else` branch) with `void buildBoundsTree(geometry)`. Keep `rebuild()`
   synchronous (demolish).
2. Raycasts skip a city mesh whose `geometry.boundsTree` is not set yet:
   the collider's `getTargets` (`create-app.ts:924-926`), the focus targets
   (`:1130`), the target list at `:972`, and `pickCityObject` (filter
   `layers`). One helper, e.g. `const withBvh = (c: CityLayer) => c.mesh.geometry.boundsTree !== undefined;`.
3. Check the MeshBVH-in-indirect-mode raycast path works with
   `acceleratedRaycast` (`firstHitOnly`): the collider tests from plan 041
   step 3 must pass with a BVH built through `buildBoundsTree` (in Bun the
   synchronous fallback runs — add one test that calls the deserialize path
   directly: build `new MeshBVH(geom, { indirect: true })`, serialize,
   deserialize onto the same geometry, raycast).

**Gate**: run the e2e walk/collision specs (`grep -n "collision\|wall\|inside" e2e/city-walk.spec.ts`)
and, in a browser, walk into a facade on a freshly streamed tile. If the
player can walk through a building after the tile has been visible for
more than a second, STOP and report.

**Verify**: `bun run verify` → exit 0; e2e specs pass.

### Step 4: Measure again

Repeat step 1's measurement (now: time from `dressCity` to the BVH being
attached, and the main-thread cost of the copy + deserialize). Record both
in the status row. Remove the temporary instrumentation.

## Test plan

- Unit: the indirect serialize/deserialize round trip raycasts the same
  hits as a directly built BVH (same `point`, same `face.a` → same
  `featureId`).
- Existing: plan 041's collider tests; e2e collision/walk specs.

## Done criteria

- [ ] Step 1's numbers recorded (and the gate passed)
- [ ] `bun run verify` and `bun run build` exit 0
- [ ] `grep -n "computeBoundsTree()" app/_components/city-layer.ts` → only inside `rebuild` (and the fallback in `city-bvh.ts`)
- [ ] Round-trip test exists and passes
- [ ] Step 4's numbers recorded; no temporary logging left (`git diff | grep -n "performance.now\|console\."` → none added)

## STOP conditions

- Step 1 gate (< 30 ms median on desktop).
- Turbopack/Next cannot bundle the module worker (`bun run build` fails or
  the worker 404s at runtime) → stop; report the error (the fallback design
  is a build-time serialized BVH per tile in `prepare-data.ts`).
- Indirect-mode raycasts return different first hits than the direct BVH
  in the round-trip test → stop.
- Step 3 gate (walking through a facade).

## Maintenance notes

- Demolish stays synchronous; if it ever shows up in a profile, route it
  through `buildBoundsTree` too (the index changes, so a new copy is needed).
- three-mesh-bvh upgrades: re-check `MeshBVH.serialize`/`deserialize` and
  the `indirect` option.

## Findings (2026-10-03, stopped at the bundling STOP condition)

- **Step 1 gate passed.** The BVH build (`new MeshBVH`, the default the
  viewer runs) over the fifteen published Dresden city tiles, in Bun on
  this container's CPU: median **75 ms**, 38–116 ms for the 90–209 k
  triangle tiles (desktop-class; a phone plausibly 3–5×). Measured on the
  glTF as `prepare-data` publishes it (meshopt-decoded, quantised
  positions), not in a browser.
- **The worker itself worked.** A worker building in indirect mode,
  answering with the serialized nodes (transferred), deserialized onto the
  tile's geometry with `setIndex: false`: same first hits and feature ids
  as a BVH built in place (a quantised int16 torus knot, 64 rays), a tile
  that left or was demolished meanwhile kept no stale BVH. The main
  thread's share: 0.2 ms to deserialize, plus the copies — 15 ms through
  `getX`, ≈ 1 ms when the quantised array is copied as it is and read
  `normalized` in the worker. The spawn tile's BVH has to be awaited
  before `placeAt` (ADR 0032 places the camera through the collider).
- **STOP: Turbopack does not bundle the worker.** `next build` (Next
  16.3.7, Turbopack) emits `new Worker(new URL("./x.worker.ts",
  import.meta.url))` as a *static asset*: the raw source is copied to
  `/_next/static/media/x.worker.<hash>.ts`, so the browser would load
  TypeScript with bare imports and the worker fails (the viewer would fall
  back to the synchronous build every time). Reproduced in a minimal
  two-file app: `.ts` and `.js` workers, with and without
  `{ type: "module" }`, inside and outside a `try`/effect — always an
  asset. (The binary has WorkerAssetReference/WorkerLoaderModule and the
  config has `turbopackWorkerAssetPrefix`, so support may exist behind a
  pattern or version not found here.)
- The attempt (worker, client, tests, the raycast filters and the spawn
  await) was reverted at the STOP, not committed.

Options for the maintainer (each a design decision):

1. **A worker bundle of our own**: `Bun.build` the worker (three +
   three-mesh-bvh, ~100 KB) in `prepare-sites.ts`/`dev`/`build` into
   `public/`, content-hashed, its name handed to the client (the site
   index or the manifest). Keeps everything above; adds a build step.
2. **A BVH baked at build time** per city tile in `prepare-data.ts`
   (serialized indirect nodes as a side artifact): no worker, no main-thread
   build at all, but ≈ 1–1.6 MB more per city tile to download and hold —
   on a phone, against the memory budget this plan exists to protect.
3. **Wait for Turbopack worker bundling** (or a Next upgrade that has it),
   then apply the patch as is.

## Findings (2026-10-11, the spawn tile only, after plan 069): bundled, then stopped at the chunk

Re-tried for the one build that still sits on the boot's path since plan
069 made the BVH lazy (ADR 0024): the spawn tile's, which `placeStart`
built synchronously (`boot:place`). Branch `claude/spawn-bvh-worker`
(based on `main` at 7cf7d2f, pushed, no PR): `city-bvh.worker.ts` +
`city-bvh-job.ts` (the job) + `city-bvh.ts` (the client), the spawn tile
lent to the worker once its content's compile has uploaded it
(`TileStream.cityUploaded`) and the worker has loaded, after the tile's
ground has landed (as ADR 0024 placed the build), awaited in `boot:place`
(`boot:bvh-wait`, `tile:bvh-worker`), every failure falling back to the
synchronous build.

- **The bundling STOP above was wrong — Turbopack bundles the worker.**
  `new Worker(new URL("./city-bvh.worker.ts", import.meta.url), { type:
  "module" })` compiles to Turbopack's worker bootstrap
  (`turbopack-worker-<hash>.js`, 849 B) loading the worker's module
  chunks with `importScripts` (its entry 1.1 KB, a runtime 10.9 KB, and
  the chunk with three's core and three-mesh-bvh). It *also* still copies
  the source to `/_next/static/media/city-bvh.worker.<hash>.ts`, behind a
  module that only exports that URL — the asset the 2026-10-03 attempt
  took for the worker. Nothing loads it. In every traced branch run the
  worker built the BVH (`tile:bvh-worker`, no `tile:bvh` before
  `boot:placed`).
- **Quantisation is handled.** The job carries the positions as GLTFLoader
  gives them — int16, `normalized`, interleaved at a stride of four (the
  glTF's byteStride of 8) — and the worker rebuilds exactly that attribute.
  three-mesh-bvh's `GenerateMeshBVHWorker` would throw on the interleaved
  attribute (and reads any position array as plain, non-normalized
  numbers). `city-bvh.test.ts`: the same nodes byte for byte, the same
  sorted index and 64 rays hitting the same faces as `computeBoundsTree()`
  on that layout; dropping `normalized` in the job fails it. The arrays are
  transferred, not copied, so while they are away `ensureCityBvh`, the
  demolish (deferred until they are back) and `nearestWithoutBvh` keep off
  the tile; bounds are taken before the loan; a worker that never loads is
  never lent anything, one that dies with the arrays leaves the tile
  without a BVH rather than with one over empty arrays.
- **STOP: the chunk (ADR 0040).** The worker imports `three` (its core)
  and three-mesh-bvh, which the scene imports too: both left the scene
  chunk's scope for a chunk the two groups share. Measured as ADR 0040's
  protocol (POC production builds, headless Chromium at
  `/dresden?scene=lite` 800×600, every `/_next/static/*.js` until
  `__poc.ready`, `gzip -9` from each build's `.next/static`):

  | build | first-load JS, gz | raw | the scene's chunk(s), gz | `(0,X.fn)(…)` calls in the scene chunk | the worker's own chunks, gz |
  |---|---|---|---|---|---|
  | main (7cf7d2f) | **904 985** | 2 803 803 | 493 512 | 193 | – |
  | branch | **925 796** (+20 811) | 2 890 201 | 410 518 + 103 736 shared | 401 | 5 436 (+ the shared chunk, a cache hit) |

  Smaller than ADR 0040's 33 KB because only three's core and the BVH are
  shared, not `three/webgpu` and `three/tsl`.
- **And it did not bring the first frame forward here.** Mobile-emulated
  as plan 069's Findings (Playwright `devices['iPhone 13']`, headless
  Chromium, SwiftShader, the WebGL2 backend, `/dresden?scene=lite&trace=1`,
  a cold profile per run), alternating, load 16–23 on four cores from
  other agents' builds — **directional only**:

  | run | first frame s | ready s | `boot:place` s | of it waiting (`boot:bvh-wait`) | `boot:scene-compile` s | the BVH's build s (`tile:bvh` / `tile:bvh-worker`) | `boot:placed` at s | `boot:light-wait` s | long tasks to first frame: n / total s / max s |
  |---|---|---|---|---|---|---|---|---|---|
  | branch 1 | 62.7 | 297.4 | 10.36 | 10.36 | 0.02 | 10.37 (worker) | 42.4 | 3.72 | 54 / 59.0 / 7.27 |
  | main 1 | 39.3 | 247.5 | 3.09 | – | 0.02 | 3.09 | 25.7 | 0.00 | 54 / 33.3 / 5.36 |
  | branch 2 | 71.9 | 270.0 | 4.15 | 4.15 | 7.16 | 11.20 (worker) | 51.7 | 3.05 | 72 / 67.5 / 8.08 |
  | main 2 | 52.6 | 268.0 | 3.46 | – | 0.04 | 3.46 | 33.1 | 0.00 | 52 / 46.1 / 6.87 |

  `boot:place` itself shrank only where the scene's compile ran beside
  the worker (branch 2: 4.2 s of an 11.2 s build); in three runs of four
  the lite boot had nothing left to do on the main thread once its ground
  had landed (`boot:scene-compile` 0.02–0.04 s), so the wait is the whole
  build. And the build took three times as long in the worker (10.4 / 11.2
  s against 3.1 / 3.5 s): the frames behind the veil keep rendering while
  the boot waits, and under SwiftShader they rasterise on the CPU beside
  it; the first shadow frame after the placing then hit the light stage's
  3 s bound. The branch also reached the landed spawn tile 9–11 s later
  (the worker's own chunks loading and evaluating at the start, or the
  load) — the first frame came 19–23 s later in both pairs. A real phone
  draws on its GPU, so the worker's build there should be about the main
  thread's; but the first frame can only come earlier where the boot has
  main-thread work to put beside it, and after the ground has landed the
  lite boot has almost none.

Options for the maintainer (each a decision; none built):

1. **Leave it** (main as it is): the spawn tile's BVH in `boot:place`.
2. **Accept the chunk**: +20.8 KB gz on the first load, for a build off
   the main thread that these numbers do not show paying back.
3. **A worker bundle of our own** (the first option above): `Bun.build`
   the worker into `public/`, its name handed to the client — no
   first-load tax, a separate fetch of its own (≤ the 104 KB gz of the
   shared chunk, three's core tree-shaken to what the BVH needs).
4. **A worker without three**: `buildPackedTree` (three-mesh-bvh's
   `core/build/buildTree.js`) imports nothing from three, but its callers
   do (`MeshBVH.js`, `core/build/geometryUtils.js`): the worker would
   reimplement `getRootRanges` and `computePrimitiveBounds` (with the
   normalized getters' rounding) against three-mesh-bvh's internals, and
   the small build modules would still be shared — unmeasured.
5. **Start it earlier**, at the city's upload, beside the terrain's
   download and parse — the one overlap the lite boot has — which brings
   the BVH's transient (≈ 50 MB, in the worker but in the same process)
   back beside the parse ADR 0024 moved it away from for the iPhones; and
   perhaps hold the veiled frames while the boot waits.
