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
