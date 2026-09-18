# Plan 003: Derive ink edges from CityJSON rings instead of welding the GPU mesh

> **⛔ OBSOLETE — do not execute.** PR #16 removed welded ink edges entirely:
> `visual-style.ts` no longer imports `EdgesGeometry`, and `buildEdges` /
> `mesh.userData.edges` are gone (buildings carry no outline overlay; the
> terrain's contour ink is a fragment-shader term). The 1,069 ms boot cost and
> the 652 ms per demolish that justified this plan no longer exist, and every
> "Current state" excerpt below describes deleted code. Kept for the ring
> extractor design in Step 2, which is still the right approach **if** outlines
> ever come back — in that case re-plan against the live `visual-style.ts`.
> Status in `plans/README.md`: REJECTED (superseded by PR #16).

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8075a21..HEAD -- app/_components/visual-style.ts app/_components/city-layer.ts app/_components/create-app.ts lib/city/types.ts lib/city/edges.ts lib/city/edges.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (PR #16 "Aesthectic and visual fine
> tuning" rewrites `visual-style.ts` and `create-app.ts` — if it has merged,
> the excerpts below will not match. Stop and ask the operator whether to
> port this plan onto the new code.)

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-test-baseline-and-real-e2e-frames.md (recommended, not required — it makes the e2e shader check real)
- **Category**: perf
- **Planned at**: commit `8075a21`, 2026-09-18

## Why this matters

The "ink edges" overlay (the sketch-style building outlines) is built by
welding the loader's non-indexed GPU mesh with `mergeVertices` and then
running `EdgesGeometry` over it. Measured against the real tile
(`data/cityjson/lod1_33412_5656_2_sn.city.json`, 4410 CityObjects, ~118k
triangles) under Bun on a server CPU, that costs **about 1,070 ms at boot**
and **about 650 ms again after every demolish** (the demolish path re-parses
the tile and starts with bare meshes, so all edges are rebuilt). Together
with the re-parse itself (≈520 ms) a single demolish freezes the page for
roughly 1.2 s on a fast desktop and several seconds on a phone.

The same outlines can be computed directly from the CityJSON polygon rings:
the source document already shares vertices (63,259 vertices for 118k
triangles) so no welding is needed, and each surface's normal comes from its
ring by Newell's method. A prototype of this approach produced 88,228
segments in **85 ms** (versus 92,143 segments from `EdgesGeometry` at the
same 30° crease threshold — the small difference is coplanar-neighbour
handling and is visually indistinguishable at LoD1). It is also a pure,
three-free function, so it gets unit tests, unlike the current code.

After this plan: boot is ~1 s faster, demolish is ~0.6 s faster, and the
outline logic lives in `lib/city/edges.ts` with tests.

## Current state

Files and their roles:

- `app/_components/visual-style.ts` — materials for the three styles plus
  the edge overlay. `buildEdges` (lines 198–218) does the expensive weld;
  `applyCityStyle` (lines 233–260) builds edges lazily per batched mesh and
  caches them on `mesh.userData.edges`.
- `app/_components/city-layer.ts` — parses the CityJSON into a `Group`
  (`createCityLayer`, `demolishObject`), exposes `CityLayer { data, group,
  matrix }`. `matrix` is the loader's recenter matrix (a pure translation by
  `(-cx, -cy, 0)`).
- `app/_components/create-app.ts` — calls `applyCityStyle` at boot (line
  301), after demolish (line 412), in `setStyle` (line 505) and in
  `setEdges` (line 517).
- `lib/city/types.ts` — minimal `CityJsonDocument` typing (`geometry?:
  unknown[]` today — this plan tightens it).
- `lib/city/recenter.ts` — `recenterOffset(matrix)` returns `{ cx, cy }`
  from the loader matrix.
- `lib/city/filter-city-object.ts` + `.test.ts` — the demolish filter; its
  test file is the structural pattern for the new tests.

Excerpt — `app/_components/visual-style.ts:193-218` (the code being replaced):

```ts
/**
 * Ink outline for one batched city mesh. The loader geometry is non-indexed
 * (flat-shaded), so EdgesGeometry would treat every triangle edge as a
 * boundary — weld a positions-only copy first.
 */
function buildEdges(mesh: Mesh, material: LineBasicMaterial): LineSegments {
  const positionsOnly = new BufferGeometry();
  positionsOnly.setAttribute(
    "position",
    mesh.geometry.getAttribute("position")
  );
  const welded = mergeVertices(positionsOnly, 1e-4);
  const edges = new EdgesGeometry(welded, EDGE_THRESHOLD_DEG);
  welded.dispose();
  const lines = new LineSegments(edges, material);
  lines.name = "city-edges";
  // Render AFTER all building fills so hidden edges are depth-tested away —
  // otherwise lines of occluded buildings draw through walls and the whole
  // city reads as x-ray glass no matter how opaque the fills are.
  lines.renderOrder = 1;
  // Decoration only: keep the demolish raycast off ~100k line segments.
  lines.raycast = () => {
    // intentionally empty
  };
  return lines;
}
```

Excerpt — `app/_components/visual-style.ts:220-260` (the caller; abridged — the
five-line doc comment above `applyCityStyle` at lines 228–232 is omitted):

```ts
interface StyledCityMesh extends Mesh {
  isCityObjectMesh?: boolean;
  userData: {
    edges?: LineSegments;
    originalMaterial?: Material | Material[];
  };
}

export function applyCityStyle(
  cityGroup: Group,
  style: CityStyleId,
  resources: StyleResources
): void {
  cityGroup.traverse((obj) => {
    const mesh = obj as StyledCityMesh;
    if (!mesh.isCityObjectMesh) {
      return;
    }
    mesh.userData.originalMaterial ??= mesh.material;

    if (style === "standard") {
      mesh.material = mesh.userData.originalMaterial;
    } else {
      mesh.material = style === "ghost" ? resources.ghost : resources.clay;
    }

    const wantEdges = style !== "standard" && resources.edgesVisible;
    if (wantEdges && !mesh.userData.edges) {
      mesh.userData.edges = buildEdges(mesh, resources.edgeLines);
      mesh.add(mesh.userData.edges);
    }
    if (mesh.userData.edges) {
      mesh.userData.edges.visible = wantEdges;
    }
  });
}
```

Excerpt — `app/_components/city-layer.ts:9-19` and `53-82` (abridged — the
six-line doc comment above `demolishObject` at lines 62–67 is omitted):

```ts
export interface CityLayer {
  /** mutable in-memory CityJSON — the source of truth for demolish */
  data: CityJsonDocument;
  /** current loader output (re-created on every reload) */
  group: Group;
  /**
   * Pure-translation recenter matrix captured on the FIRST load and reused
   * on every reload, so the world never jumps after a demolish.
   */
  matrix: Matrix4;
}
// ...
export function createCityLayer(
  data: CityJsonDocument,
  world: Group
): CityLayer {
  const { group, matrix } = parseCity(data, null);
  world.add(group);
  return { data, group, matrix };
}

export function demolishObject(
  layer: CityLayer,
  world: Group,
  objectId: string
): CityLayer {
  const filtered = filterCityObject(layer.data, objectId);
  if (filtered === layer.data) {
    return layer;
  }
  world.remove(layer.group);
  disposeObject3D(layer.group);
  const { group } = parseCity(filtered, layer.matrix);
  world.add(group);
  return { data: filtered, group, matrix: layer.matrix };
}
```

Excerpt — `app/_components/create-app.ts` call sites (lines 298–302, 405–414, 503–518):

```ts
  opts.onProgress?.("Preparing render styles…");
  const styleResources = createStyleResources();
  let currentStyle: CityStyleId = DEFAULT_CITY_STYLE;
  applyCityStyle(cityLayer.group, currentStyle, styleResources);
  const postStack = createPostStack(renderer, scene, camera);
// ...
  const demolishAtCrosshair = () => {
    const objectId = pickCityObjectId(camera, cityLayer);
    if (!objectId) {
      return;
    }
    cityLayer = demolishObject(cityLayer, world, objectId);
    // The reload produces bare loader meshes — re-dress them.
    applyCityStyle(cityLayer.group, currentStyle, styleResources);
    emitStats();
  };
// ...
    setStyle: (style) => {
      currentStyle = style;
      applyCityStyle(cityLayer.group, style, styleResources);
    },
// ...
    setEdges: (opacity) => {
      setEdgeOpacity(styleResources, opacity);
      // Visibility of the (lazily built) edge overlays follows the flag.
      applyCityStyle(cityLayer.group, currentStyle, styleResources);
    },
```

Excerpt — `lib/city/types.ts:6-14`:

```ts
export interface CityObject {
  attributes?: Record<string, unknown>;
  /** ids of child objects, e.g. BuildingParts of a Building */
  children?: string[];
  geometry?: unknown[];
  /** ids of parent objects (a BuildingPart points at its Building) */
  parents?: string[];
  type: string;
}
```

Facts about the data and frames you must honour:

- CityJSON 2.0 `vertices` are integer triples; real coordinates are
  `v * transform.scale + transform.translate` (the loader does exactly this in
  `applyTransform`). The tile in this repo has a `transform`; a document
  without one uses the raw vertices.
- Geometry boundary nesting: `MultiSurface`/`CompositeSurface` →
  `[surface][ring][vertexIndex]`; `Solid` → `[shell][surface][ring][vertexIndex]`;
  `MultiSolid`/`CompositeSolid` → `[solid][shell][surface][ring][vertexIndex]`.
  Ring 0 of a surface is the outer ring; further rings are holes. All rings
  contribute edges.
- The city meshes live in the "recentered data frame": data coordinates
  minus `(cx, cy, 0)`, still Z-up. The parent `world` group applies the
  −90° X rotation. Anything added to `cityLayer.group` must be in that
  recentered data frame — do NOT rotate or swap axes yourself.
- `recenterOffset(layer.matrix)` gives `{ cx, cy }` (see `lib/city/recenter.ts`).
- `lib/city/*` must stay free of `three` imports (every module there is
  pure and unit-tested — see the header comments in `lib/city/minimap.ts`
  and `lib/city/sun.ts`). The new module follows that rule; the
  `LineSegments` wrapper lives in `app/_components/`.

Conventions to match:

- Tests: `bun:test`, colocated `*.test.ts`, small hand-built fixtures with
  exact assertions — model after `lib/city/filter-city-object.test.ts`.
- Clamping/validation style and doc comments as in `lib/city/terrain-geometry.ts`.
- Conventional Commits, e.g. `perf: derive ink edges from CityJSON rings`.
- No `console.log`. No `any` without a `// reason:` comment.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Typecheck | `bun typecheck` | exit 0, no errors |
| Lint | `bun lint` | exit 0 |
| Auto-fix formatting | `bun fix` | exit 0 (run before lint if lint complains about format) |
| Unit tests | `bun run test` | all pass (today: 12 test files under `lib/`) |
| E2E smoke | `bun run test:e2e` | 3 passed (needs Playwright browsers: `bunx playwright install chromium`) |
| Build | `bun run build` | exit 0 |

Note: `bun run test` runs `bun test ./lib` at the time of writing; if plan
001 has landed it also covers `./app`. Either way the new tests in
`lib/city/edges.test.ts` are picked up.

## Scope

**In scope** (the only files you should modify):
- `lib/city/edges.ts` (create)
- `lib/city/edges.test.ts` (create)
- `lib/city/types.ts` (tighten the `geometry` typing)
- `app/_components/visual-style.ts` (replace `buildEdges`; change `applyCityStyle`'s first parameter)
- `app/_components/city-layer.ts` (no functional change required; only if you choose to store the edges object on `CityLayer` — see Step 4)
- `app/_components/create-app.ts` (call-site updates only)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `app/_components/collision.ts`, `fps-movement.ts`, `post-stack.ts`,
  `sun-rig.ts`, `terrain-layer.ts` — unrelated systems.
- The demolish re-parse design in `city-layer.ts` (`demolishObject`) — a
  documented decision; this plan only removes the edge-rebuild cost, not the
  re-parse.
- `patches/cityjson-threejs-loader@0.4.0.patch` and anything under
  `node_modules`.
- The edge material (`resources.edgeLines`), colour, opacity defaults, the
  30° threshold value, `renderOrder = 1`, and the no-op `raycast` — keep all
  of them exactly as they are so the look does not change.
- `e2e/city-walk.spec.ts` — no new e2e assertions are needed; the existing
  `setEdges(0)` / `setEdges(0.7)` calls exercise the new path.

## Git workflow

- Branch: `advisor/003-cityjson-derived-ink-edges` from `main`.
- Commit per step where noted; message style is Conventional Commits with a
  lowercase subject, e.g. `perf: derive ink edges from CityJSON rings`,
  `test: cover buildingEdgeSegments`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Tighten the CityJSON geometry typing

In `lib/city/types.ts`, replace `geometry?: unknown[];` on `CityObject` with
a minimal typed union that covers only the boundary shapes this repo needs:

```ts
/** Nested vertex-index arrays; depth depends on the geometry type. */
export type RingIndices = number[];
export type SurfaceBoundaries = RingIndices[];
export type ShellBoundaries = SurfaceBoundaries[];

export type CityGeometry =
  | { type: "MultiSurface" | "CompositeSurface"; lod?: string; boundaries: SurfaceBoundaries[] }
  | { type: "Solid"; lod?: string; boundaries: ShellBoundaries[] }
  | { type: "MultiSolid" | "CompositeSolid"; lod?: string; boundaries: ShellBoundaries[][] }
  | { type: string; lod?: string; boundaries?: unknown };

export interface CityObject {
  attributes?: Record<string, unknown>;
  children?: string[];
  geometry?: CityGeometry[];
  parents?: string[];
  type: string;
}
```

Keep the existing doc comments on `children`/`parents`. The last union
member keeps unknown geometry types (e.g. `MultiPoint`, `GeometryInstance`)
typeable without lying about their shape.

**Verify**: `bun typecheck` → exit 0. (The existing fixtures in
`lib/city/filter-city-object.test.ts` use `geometry: []`, which still
typechecks.)

### Step 2: Write the pure edge extractor

Create `lib/city/edges.ts`:

```ts
import type { CityGeometry, CityJsonDocument } from "./types";

/**
 * Ink-edge extraction straight from CityJSON polygon rings. No THREE, no
 * DOM. Every ring edge is a candidate; an edge shared by two surfaces is
 * kept only when the surfaces meet at a crease of at least
 * `creaseAngleDeg`, so coplanar neighbours (roof facets, split walls) don't
 * draw a line. Output positions are in the recentered data frame (Z-up,
 * minus the (cx, cy) recenter offset) — the same frame as the loader meshes.
 */

export interface EdgeSegments {
  /** [x1,y1,z1, x2,y2,z2, ...] — 6 floats per segment */
  positions: Float32Array;
  segmentCount: number;
}

export interface EdgeOptions {
  /** minimum dihedral angle between two surfaces for their shared edge to be drawn */
  creaseAngleDeg?: number;
}

export const DEFAULT_CREASE_ANGLE_DEG = 30;
```

Then implement `export function buildingEdgeSegments(doc: CityJsonDocument, offset: { cx: number; cy: number }, options?: EdgeOptions): EdgeSegments` with this algorithm:

1. Build three `Float64Array`s `X, Y, Z` of length `doc.vertices.length`
   holding transformed coordinates: `v[i] * scale[i] + translate[i]` when
   `doc.transform` exists, otherwise the raw values. Subtract `offset.cx` from
   X and `offset.cy` from Y here (Z untouched).
2. Define `forEachSurface(geometry: CityGeometry, cb: (surface: number[][]) => void)`
   that walks the nesting per geometry type (see "Current state"); ignore
   any other `type`.
3. Define `ringNormal(ring: number[]): [nx, ny, nz]` using Newell's method
   over the ring's vertices (accumulate `nx += (Y[a]-Y[b])*(Z[a]+Z[b])`,
   `ny += (Z[a]-Z[b])*(X[a]+X[b])`, `nz += (X[a]-X[b])*(Y[a]+Y[b])` for each
   consecutive pair including the closing pair), then normalise; a
   zero-length normal (degenerate ring) becomes `[0, 0, 0]`.
4. Iterate every object in `doc.CityObjects`, every `geometry`, every
   surface, every ring (index 0 and holes alike). Skip rings with fewer than
   3 indices. Compute the normal from ring 0 of the surface once and reuse
   it for the surface's hole rings. For each consecutive pair `(a, b)`
   (including last→first) with `a !== b`, compute the numeric key
   `min * 4_194_304 + max` (safe while a document has fewer than 4,194,304
   vertices — assert this once at the top and throw a descriptive `Error`
   otherwise) and record it in a `Map<number, { normals: number[]; faces: number }>`:
   on first sight store `{ normals: [nx, ny, nz], faces: 1 }`; on second
   sight append the second normal (length 6) and set `faces = 2`; on third
   or later sight only increment `faces` (non-manifold edge).
5. Emit: for each map entry, keep the edge if `faces === 1` (boundary edge),
   or if `faces > 2` (non-manifold — always drawn), or if
   `Math.abs(dot(n1, n2)) <= Math.cos(creaseAngleDeg in radians)`. Note the
   `<=`: with `creaseAngleDeg: 0` the threshold is `cos(0) = 1`, so every
   shared edge is kept (coplanar neighbours have `|dot| = 1`); with the
   default 30° the threshold is ≈0.866, so coplanar edges are dropped and
   90° creases (`dot = 0`) are kept.
   Write both endpoints (from X/Y/Z) into a growing `number[]`, then copy
   into a `Float32Array`. Return `{ positions, segmentCount: positions.length / 6 }`.
6. `creaseAngleDeg` defaults to `DEFAULT_CREASE_ANGLE_DEG`; clamp it to
   `[0, 180]`.

Keep the function synchronous and allocation-light (typed arrays for
coordinates, one Map, one output array). No `three` import anywhere in this
file.

**Verify**: `bun typecheck` → exit 0; `bun lint` → exit 0 (run `bun fix`
first if only formatting is reported).

### Step 3: Unit-test the extractor

Create `lib/city/edges.test.ts` modelled on
`lib/city/filter-city-object.test.ts` (a `doc()` fixture builder, exact
expectations). Use a helper `unitCubeDoc()` that builds a `Solid` with 8
vertices and 6 quads (a closed unit cube from (0,0,0) to (1,1,1)) and a
`quadDoc()` with a single `MultiSurface` quad. Cases (all must exist):

1. A single `MultiSurface` quad yields 4 segments (all boundary edges).
2. The unit cube yields exactly 12 segments at the default threshold (every
   edge is a 90° crease).
3. Two coplanar adjacent quads sharing one edge in a `MultiSurface` yield 6
   segments (the shared edge is dropped) at 30°, and 7 segments with
   `creaseAngleDeg: 0`.
4. `transform` is applied: with `scale [0.5, 0.5, 0.5]` and `translate [10, 20, 30]`
   a vertex `[2, 2, 2]` appears in `positions` as `11, 21, 31` (before offset).
5. `offset` is subtracted from X and Y only: with `offset { cx: 10, cy: 20 }`
   the same vertex appears as `1, 1, 31`.
6. Rings with fewer than 3 indices and consecutive duplicate indices produce
   no segment and do not throw.
7. A `Solid` with a hole ring in one surface includes the hole's edges.
8. Unknown geometry types (`{ type: "MultiPoint", boundaries: [0, 1] }`) are ignored.
9. Characterisation against the real tile, skipped when the file is absent:

```ts
import { existsSync, readFileSync } from "node:fs";
const TILE = "data/cityjson/lod1_33412_5656_2_sn.city.json";
test.skipIf(!existsSync(TILE))("real tile: ~88k segments in well under a second", () => {
  const doc = JSON.parse(readFileSync(TILE, "utf8")) as CityJsonDocument;
  const t0 = performance.now();
  const { segmentCount } = buildingEdgeSegments(doc, { cx: 413_000, cy: 5_657_000 });
  expect(performance.now() - t0).toBeLessThan(1000);
  expect(segmentCount).toBeGreaterThan(80_000);
  expect(segmentCount).toBeLessThan(100_000);
});
```

(The prototype measured 88,228 segments in 85 ms; the bounds above leave
room for minor implementation differences without letting a broken
implementation through.)

**Verify**: `bun test ./lib/city/edges.test.ts` → 9 tests pass.

### Step 4: Replace `buildEdges` in `visual-style.ts` with a group-level overlay

In `app/_components/visual-style.ts`:

1. Remove the `mergeVertices` and `EdgesGeometry` imports and the
   `buildEdges` function. Add `import { buildingEdgeSegments } from "@/lib/city/edges";`,
   `import { recenterOffset } from "@/lib/city/recenter";`,
   `import type { CityLayer } from "./city-layer";` and `BufferAttribute`
   from `three`.
2. Add a new module-private function:

```ts
const EDGES_NAME = "city-edges";

/**
 * One LineSegments overlay for the whole city, computed from the CityJSON
 * rings (see lib/city/edges.ts) and added to the loader group so it is
 * disposed together with the group on demolish. Idempotent: returns the
 * existing overlay if the group already has one.
 */
function ensureCityEdges(layer: CityLayer, material: LineBasicMaterial): LineSegments {
  const existing = layer.group.getObjectByName(EDGES_NAME);
  if (existing instanceof LineSegments) {
    return existing;
  }
  const { positions } = buildingEdgeSegments(layer.data, recenterOffset(layer.matrix), {
    creaseAngleDeg: EDGE_THRESHOLD_DEG,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, material);
  lines.name = EDGES_NAME;
  lines.renderOrder = 1; // keep the existing comment about depth-testing hidden edges
  lines.raycast = () => {
    // intentionally empty — decoration only, keep picks/collision off the lines
  };
  layer.group.add(lines);
  return lines;
}
```

3. Change `applyCityStyle`'s signature to `applyCityStyle(layer: CityLayer, style: CityStyleId, resources: StyleResources)`. Inside, traverse `layer.group` exactly as before for the material swap (keep `mesh.userData.originalMaterial ??= mesh.material;`), but delete the per-mesh `userData.edges` logic. After the traverse:

```ts
  const wantEdges = style !== "standard" && resources.edgesVisible;
  if (wantEdges) {
    ensureCityEdges(layer, resources.edgeLines).visible = true;
  } else {
    const existing = layer.group.getObjectByName(EDGES_NAME);
    if (existing) {
      existing.visible = false;
    }
  }
```

4. Remove the `edges?: LineSegments;` field from `StyledCityMesh.userData`.
5. Update the doc comment above `applyCityStyle` to say the edge overlay is
   one group-level object built from the CityJSON and rebuilt after a
   demolish-reload because the group is replaced.

Frame check before trusting the coordinates: the loader bakes
`layer.matrix` into the mesh vertices (`geom.applyMatrix4(matrix)` in the
vendored `CityObjectsMesh`), and `layer.group` itself carries no transform.
Confirm once in `bun dev` via the console —
`window.__poc` does not expose the group, so add a temporary
`console.assert(layer.group.matrix.determinant() === 1 && layer.group.position.length() === 0)`
in `ensureCityEdges` while developing and remove it before committing
(AGENTS.md forbids committed console calls). If the group is NOT identity,
STOP: the extractor's offset handling would need to change.

Why the group, not the meshes: `demolishObject` calls
`disposeObject3D(layer.group)` and swaps in a fresh group, so the overlay is
freed and rebuilt automatically; `pickCityObjectId`, `buildCityBvh`,
`createCityCollider` and `updateFocus` all traverse the group but either
check `isCityObjectMesh` or go through `raycast`, which the no-op keeps
inert. Do NOT store the overlay on `CityLayer` unless you find a concrete
need; `getObjectByName` on a group with ≤ 4 children is free.

**Verify**: `bun typecheck` → errors only at the four `applyCityStyle` call
sites in `create-app.ts` (expected until Step 5).

### Step 5: Update the call sites in `create-app.ts`

Replace all four `applyCityStyle(cityLayer.group, …)` calls with
`applyCityStyle(cityLayer, …)` (lines 301, 412, 505, 517 in the excerpts).
Update the comment in `setEdges` from "lazily built edge overlays" to "the
group-level edge overlay". Nothing else changes.

**Verify**:
- `bun typecheck` → exit 0
- `bun lint` → exit 0
- `grep -n "mergeVertices\|EdgesGeometry\|userData.edges" app/_components/visual-style.ts` → no output
- `grep -c "applyCityStyle(cityLayer," app/_components/create-app.ts` → `4`

Commit: `perf: derive ink edges from CityJSON rings`.

### Step 6: Run the full verification

- `bun run test` → all pass, including the 9 new tests.
- `bun run build` → exit 0.
- `bun run test:e2e` → 3 passed. The desktop test toggles `setEdges(0)` and
  `setEdges(0.7)` and asserts no console/page errors; the screenshot at
  `test-results/city-walk-smoke.png` should still show dark outlines on the
  buildings (open it and look — this is the one visual check).

## Test plan

- New: `lib/city/edges.test.ts` — the 9 cases in Step 3 (happy path,
  crease/coplanar behaviour, transform, offset, degenerate input, holes,
  unknown types, real-tile characterisation).
- Existing: `e2e/city-walk.spec.ts` covers edge toggling end to end; no
  changes required.
- Pattern: `lib/city/filter-city-object.test.ts`.
- Verification: `bun run test` → all pass including 9 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun typecheck` exits 0
- [ ] `bun lint` exits 0
- [ ] `bun run test` exits 0 and `lib/city/edges.test.ts` contributes 9 passing tests
- [ ] `bun run build` exits 0
- [ ] `bun run test:e2e` reports 3 passed
- [ ] `grep -rn "mergeVertices\|EdgesGeometry" app/ lib/` returns no matches
- [ ] `grep -rn "from \"three\"" lib/` returns no matches (lib stays three-free)
- [ ] `git status --porcelain` lists only files in the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts do not match the live files (PR #16 or other
  work has rewritten `visual-style.ts` / `create-app.ts`).
- The real-tile characterisation test reports a `segmentCount` outside
  80,000–100,000 after you have double-checked the nesting walk — the
  boundary walk is wrong, not the threshold.
- The e2e smoke screenshot shows no building outlines at all, or outlines
  floating away from the buildings (the frame/offset handling is wrong —
  re-read the "frames you must honour" facts; do not add rotations).
- A step's verification fails twice after a reasonable fix attempt.
- You find you need to modify `city-layer.ts`'s `demolishObject` beyond
  types, or any out-of-scope file.

## Maintenance notes

- If a second CityJSON tile is ever loaded into the same group (see the
  multi-tile direction note in `plans/README.md`), call `ensureCityEdges`
  per layer — the function is per `CityLayer`, not per scene.
- If the crease threshold or the look of the outlines is tuned in PR #16's
  successor work, change `EDGE_THRESHOLD_DEG` only; the extractor takes it
  as an option.
- Reviewer focus: the `forEachSurface` nesting per geometry type (an
  off-by-one level silently produces zero or garbage edges — the
  characterisation test is the guard), and that no `three` import crept into
  `lib/city/edges.ts`.
- Deferred on purpose: incremental demolish (filtering cached per-object
  segments instead of recomputing). At 85 ms for the full tile the
  recompute is cheaper than the bookkeeping; revisit only if tiles grow
  10×.
