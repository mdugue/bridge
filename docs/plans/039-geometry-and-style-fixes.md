# Plan 039: Bridge ramps without black faces, rails that pass under decks stay down, Papier keeps both sides and the bare crowns, rain that lasts the session

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command and
> confirm the expected result before moving on. Steps 1–3 are verified by
> unit tests; step 4 (Papier) also needs a look on a real GPU — if you have
> none, finish the code and tests and mark the row "look unjudged on a GPU",
> as other plans do. On a STOP condition, stop and report. When done, update
> this plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat dd470e9..HEAD -- app/_components/rail-layer.ts app/_components/rail-layer.test.ts lib/city/bridge.ts lib/city/ground-join.ts app/_components/stylize-effect.ts app/_components/paper-scene.ts app/_components/paper-scene.test.ts app/_components/post-stack.ts`
> On a change in the lines a step edits, compare against the excerpts; a
> mismatch is a STOP condition for that step.
>
> **Ordering**: plan 046 splits `rail-layer.ts`. Run this plan **before**
> 046, or re-locate the functions named here in the split files.
>
> **Amendment (2026-10-06 audit, against `4b0310a`)**: **step 3 is moot.**
> `buildRails` no longer lifts every sample inside a rail-deck polygon
> through `deckLift`; since commit 677fe7c (ADR 0041, 2026-10-01) it calls
> `lineLevelsAt(dense, "rail", f.properties?.lv, ctx, decks)`
> (`app/_components/rail-layer.ts:2350`), and the line's level is solved
> along its whole run by the build step — exactly the "rails passing
> under a rail deck stay down" rule this step planned. Skip step 3 and
> its two tests; if a rail still climbs onto a deck it passes under, that
> is a line-levels bug (`scripts/line-levels.ts`, `lib/city/levels.ts`),
> not this plan's. The excerpts of steps 1 and 4 moved by ≈ 250 lines in
> `rail-layer.ts` (the span-deck code was added above them): find them by
> text (`addApproach`, `approachLanding`, `paper-scene.ts`'s override).

## Status

- **Priority**: P1 (steps 1, 3), P2 (steps 2, 4)
- **Effort**: S (1, 2), M (3), M (4)
- **Risk**: LOW (1, 2), LOW–MED (3), MED (4: new paper programs to warm)
- **Depends on**: 037 (correct test command)
- **Category**: bug
- **Planned at**: commit `a28de75`, 2026-10-01; refreshed against `dd470e9` (main with ADR 0035)

## Why this matters

1. **Bridge approach ramps shade black.** The newest bridge feature (an
   approach from every raised deck end down to the ground, commit `864e2da`)
   computes each ramp quad's normal from three corners; where a deck-end
   column is already flush with the ground, two of those corners coincide
   and the normal is (0, 0, 0). Counted on the committed bridge data:
   145 approaches, **78 quads on 51 approaches** get a zero normal.
   `normalize(vec3(0))` is NaN on the GPU — black or garbage faces, and the
   NaN can bleed into the post passes' neighbours.
2. **Sin City rain degrades after ~1 h.** The rain hashes a cell index that
   grows with the renderer's clock; past ~2²¹ the `fract` in the hash has
   quarter steps (≈ 51 min for the near layer), past 2²³ it is constant
   (≈ 3.4 h): the rain turns into columns, then stops varying.
3. **Heavy rails passing under a rail bridge jump up onto it.** The rail
   builder lifts every rail sample inside any rail-deck polygon onto the
   deck — there is no check that the line actually rides the deck. Seven
   places in the committed data have a rail line crossing *under* a rail
   deck about 7 m above (e.g. tile `33408_5656` near E 408435 / N 5657136,
   `33412_5658` near E 412905 / N 5659540): the rails climb onto the deck and
   drop back near-vertically at its edges. Trams already have this gate
   (`approachLift` in `tram-layer.ts`: "not one passing under it, far
   below").
4. **Papier draws double-sided things from one side and bare crowns solid.**
   Papier swaps every surface for one paper material with
   `scene.overrideMaterial`. three takes the *override's* `side` (front)
   and copies neither `side` nor `maskNode` from the drawn material. So in
   Papier: fences and freestanding walls (single quads) vanish from one
   side, stairs and clock hands may vanish, and in autumn/winter every bare
   crown (thinned through `maskNode`) draws as a full solid crown while its
   shadow is still thin.

## Current state

### 1 — approaches (`app/_components/rail-layer.ts`, `lib/city/bridge.ts`)

`lib/city/bridge.ts:639-649` (`approachLanding`, since ADR 0035 through the
shared `reachLevel` of `lib/city/ground-join.ts`):

```ts
  return reachLevel(groundAt, (d) => top - grade * d, {
    reach: APPROACH_REACH_M,
    step: APPROACH_STEP_M,
    tolerance: APPROACH_FLUSH_M,
    onUnknown: "stop",
  });
```

`reachLevel` walks `d = 0, step, 2·step, …` and returns the first `d` where
the ground reaches the level — **0 when the column is already flush** (the
ground at the deck end within `APPROACH_FLUSH_M` = 0.05 m of the top).

A column with landing distance 0 gets `land` = the column itself
(`rail-layer.ts:900-909`: `land: { x: c.x + dir.x * d, y: c.y - grade * d, z: c.z + dir.z * d }`).
`addApproach` (`rail-layer.ts:955-981`):

```ts
  for (let i = 0; i < cols.length - 1; i++) {
    const p = cols[i];
    const q = cols[i + 1];
    const p0: P3 = [p.x, p.y, p.z];
    const q0: P3 = [q.x, q.y, q.z];
    const q1: P3 = [q.land.x, q.land.y, q.land.z];
    const p1: P3 = [p.land.x, p.land.y, p.land.z];
    quad(top, p0, q0, q1, p1, surfaceNormal(p0, q0, p1, true));
    const under = (v: P3): P3 => [v[0], v[1] - depth, v[2]];
    quad(stone, under(p0), under(q0), under(q1), under(p1), [0, -1, 0]);
  }
```

When `p` is flush, `p1` equals `p0` and `surfaceNormal(p0, q0, p1, true)`
is the cross product of a zero vector: `unit()` (`:1568-1571`) returns
`[0,0,0]` (`Math.hypot(...v) || 1`). `quad(acc, p0, p1, p2, p3, n)`
(`:209`) writes two triangles (p0,p1,p2) and (p0,p2,p3) with that one
normal; the first triangle still has area.

The existing test pattern: `rail-layer.test.ts:370-387`, "no face of a
bridge is left without a normal (it would shade black)" — iterates every
child mesh's `normal` attribute and expects length > 0.5. The approach
test (`:389-427`) builds a ring with `ringToWorld(square(...))`, deck tops
`topY`, and calls `approaches(ring, topY, "road", undefined, ctx, [])`.

### 2 — rain (`app/_components/stylize-effect.ts:161-165, 624-660`)

```ts
function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}
...
    const qy = el.mul(cellsPerRad * 0.22).add(time.mul(speed));
    const q = vec2(az.mul(cellsPerRad).add(qy.mul(0.9)), qy);
    const cell = floor(q).toVar();
    const f = fract(q).toVar();
    const present = step(0.84, hash21(cell.add(seed)));
```

`time` is three's TSL `time` (seconds since the renderer started).
`hash21` is also used elsewhere in the file (do not change `hash21`
itself — other callers' patterns would change).

### 3 — rails (`app/_components/rail-layer.ts:2086-2128`)

```ts
    for (const [ex, ey] of dense) {
      const ground = ctx.heightAt(ex, ey);
      const w = epsgToWorld(ex, ey, ctx.offset);
      const lift = deckLift(decks, w.x, w.z, RAIL_DECKS);
      if (lift !== null) {
        run.push({ x: w.x, y: lift + RAIL_DECK_RAISE, z: w.z });
      } else if (ground === null) {
        flush();
      } else {
        run.push({ x: w.x, y: ground + RAIL_RAISE, z: w.z });
      }
    }
```

`deckLift(decks, x, z, kinds?, which = "all")` (`:603-627`) returns the
deck's profile height at (x, z) for any deck *or ramp* polygon containing
the point. The DLM rail lines carry only `tracks`/`electrified`
(`pipeline/bake/rail.py`), so the runtime cannot read a bridge flag.
The tram layer's rule (`tram-layer.ts:267-280`):

```ts
const APPROACH_RIDE_M = 1.5;
function approachLift(decks, x, z, ground) {
  const lift = deckLift(decks, x, z, undefined, "ramps");
  return lift !== null && ground !== null && lift - ground < APPROACH_RIDE_M
    ? Math.max(lift, ground)
    : null;
}
```

### 4 — Papier (`app/_components/paper-scene.ts`)

`paperMaterial()` (`:82-101`) is a `MeshStandardNodeMaterial` with default
`side` (FrontSide), `flatShading: true`, a `colorNode` tinted by
`ownColour()`. `createPaperScene` sets `scene.overrideMaterial = material`
in `begin()` and restores in the returned function; `swapped(object,
during)` is used by `PostStack.warmStyles` to compile the paper programs of
the scene's own objects (it sets the paper material's `positionNode` to
the object's for the call). `gather()` walks the scene once per scene
change (`sceneChanged()` resets it) and already collects objects to hide
and `paperOwn` materials (`allowOverride = false` during the frame).
The file header documents that "the sky dome's inside is culled by the
front-sided material" — **a DoubleSide override for everything is
therefore wrong** (it would draw the dome as paper over the background).

three r186 `Renderer` (`node_modules/three/src/renderers/common/Renderer.js`,
around `:3735-3775`): for a non-shadow override it takes
`materialSide = scene.overrideMaterial.side`, copies `positionNode`,
`alphaTest`, `alphaMap`, displacement and `transparent` from the drawn
material — not `side`, not `maskNode`. A material with
`allowOverride === false` is drawn with itself.

Double-sided opaque materials that Papier overrides:
`wall-layer.ts:21`, `fence-layer.ts:111`, `stair-layer.ts:17` (plain
meshes baked into the fine terrain glTF), `furniture-layer.ts:681` (clock
hands, `MeshBasicNodeMaterial`), `monument-layer.ts:512` and
`sport-fixtures.ts:151` (check whether these are transparent — transparent
ones are hidden in Papier anyway by `hiddenInPaper`). Materials with a
`maskNode`: the seasonal crown (`vegetation-layer.ts:825`
`m.maskNode = season.keep`), water (`water-layer.ts:164, 258`, transparent
→ hidden in Papier).

Tests: `app/_components/paper-scene.test.ts` (read it first; follow its
fixtures).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Rail tests | `bun test app/_components/rail-layer.test.ts` | all pass |
| Paper tests | `bun test app/_components/paper-scene.test.ts` | all pass |
| All unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |
| GPU plate (step 4, optional) | `bun run shots` with a snapshot JSON in `shots/` | PNG in `shots/` |

## Scope

**In scope**: `app/_components/rail-layer.ts` (+ test),
`app/_components/stylize-effect.ts`, `app/_components/paper-scene.ts`
(+ test), and — only if step 4's warm-up needs it — `app/_components/post-stack.ts`.

**Out of scope**: `lib/city/bridge.ts` and `lib/city/ground-join.ts` (the
landing rule is right; the drawing is wrong), `tram-layer.ts`, the bakes (`pipeline/bake/rail.py`:
adding a bridge flag to rail lines is a better long-term fix but a re-bake
of fifteen tiles — note it, don't do it), `hash21`'s formula, every layer
material (Papier must stay a render-time swap: ADR 0034, "nothing a tile
builds knows about it").

## Git workflow

Branch `claude/039-geometry-and-style-fixes`; one commit per step:
`fix(bridges): approach ramps never carry a zero normal`,
`fix(styles): Sin City rain keeps its pattern all session`,
`fix(rail): rails passing under a rail deck stay on the ground`,
`fix(paper): both sides of a ribbon, and bare crowns stay bare`. No push
unless instructed.

## Steps

### Step 1: Approach normals

In `addApproach`, compute the top quad's normal from the triangle that has
area: use `surfaceNormal(p0, q0, q1, true)` when `p` is flush (p1 equals
p0) and `surfaceNormal(p0, q0, p1, true)` otherwise — or, simpler and
robust, the normalised sum of both triangles' normals
(`(q0−p0)×(q1−p0)` + `(q1−p0)×(p1−p0)`), turned up. If both columns are
flush (p1 = p0 and q1 = q0), skip the top and under quads for that pair
(the quad is degenerate). If the sum is still zero, fall back to
`[0, 1, 0]`.

Add a test next to "a deck end above the ground gets an approach down to
it": a deck whose west end has one corner flush with the ground and one
raised (e.g. ground sloping across the deck end — use a `ctx` whose
`heightAt` returns `100` for y < 0 and `95` otherwise, or construct
`topY` so one end column is within `APPROACH_FLUSH_M` of the ground), build
it through `buildRail({ ...empty, bridges: [b] }, ctx)` and assert every
normal of every child mesh has length > 0.5 (same loop as the test at
`:370-387`).

**Verify**: `bun test app/_components/rail-layer.test.ts` → all pass; with
the fix reverted, the new test fails.

### Step 2: Rain that lasts

In `rainLayer`, wrap the cell before hashing so the hash input stays small:
`const key = mod(cell, 1024).add(seed)` (import `mod` from `three/tsl`) and
use `key`, `key.add(7.1)`, `key.add(3.3)`, `key.add(9.9)` where the code
now uses `cell.add(seed)`, `cell.add(seed + 7.1)` etc. 1024 cells per
layer is far more than any screen shows, so the repeat is invisible; the
fall stays continuous because `f = fract(q)` is untouched.

There is no WebGPU in the unit tests and no unit test for this file, so
this step is checked by the type-checker only. A full check is an hour of
Sin City on a GPU; skip it and note "arithmetic fix, not watched for an
hour" in the status row.

**Verify**: `bun run typecheck` → exit 0; `grep -n "mod(cell" app/_components/stylize-effect.ts` → 1 match.

### Step 3: Rails that pass under a deck stay down

Change `buildRails` so a stretch of consecutive samples on a rail deck is
lifted only if the line *arrives at deck level*:

1. First pass over `dense`: compute, per sample, `ground`, `w` and
   `lift = deckLift(decks, w.x, w.z, RAIL_DECKS)`.
2. Group consecutive samples with `lift !== null` into stretches. For each
   stretch, look at the sample just before it and just after it (if they
   exist and have ground): the stretch rides the deck if **any** existing
   neighbour's `ground` is within `RAIL_DECK_ENTRY_M` (new constant, 3 m)
   of the deck top at the adjoining end of the stretch, or if the stretch
   has no neighbour with ground at all (a line that lies wholly on a deck,
   or ends on it at a tile edge).
3. Second pass: as today, but use the lift only for samples in riding
   stretches; samples in non-riding stretches use `ground + RAIL_RAISE`
   (or `flush()` on null ground).

Document the rule in a comment, citing trams' `approachLift`. Tests in
`rail-layer.test.ts` (use `buildDeckTable` and the deck helpers the
existing tests use; reach `buildRails` through `buildRail({ rails: [line], bridges: [deck],
ballast: [], platforms: [] }, ctx)` as the "buildRail: empty inputs…" test
at `:75` does; a deck feature is `{ geometry: Polygon, properties: { kind:
"rail", deck: [tops…] } }` as in the test at `:429`):

- a rail deck 7 m above flat ground (ground 100, deck 107), a rail line
  crossing it at right angles from ground to ground → every rail vertex
  within 1 m of 100 + `RAIL_RAISE`;
- the same deck with a line that arrives along the deck's axis from ground
  at 106.5 (a `ctx.heightAt` that returns 106.5 outside the deck on that
  side) → the vertices on the deck are at 107 + `RAIL_DECK_RAISE`.

**Verify**: `bun test app/_components/rail-layer.test.ts` → all pass,
including the two new tests.

### Step 4: Papier keeps sides and masks

Design (keep it a render-time swap, ADR 0034):

- In `gather()`, also collect the meshes whose (first) material is opaque
  and either `side === DoubleSide` or has a non-null `maskNode`.
- For each such mesh, pick a **stand-in paper material** from a small
  cache keyed by `(side, positionNode, maskNode)`: a `paperMaterial()`
  clone with that `side`, the source's `positionNode` and `maskNode`, and
  `allowOverride = false` (so three draws it instead of the override).
  Sharing by key keeps the program count to the number of distinct
  combinations (a few), not one per mesh.
- In `begin()`, swap those meshes' `material` to their stand-in and
  restore the originals in the returned restore function (same pattern as
  `hidden`). `drawsAsPaper` stays true for them.
- `swapped(object, during)` (the warm-up path) must also apply the
  stand-in for `object` when it has one, so `PostStack.warmStyles`
  compiles the stand-in programs before the first Papier frame. Read
  `post-stack.ts`'s `warmStyles`/`compilePaper` first and confirm it calls
  `swapped` per object; if it does not, STOP.
- `dispose()` disposes the stand-ins too.

Tests in `paper-scene.test.ts`: a scene with a `DoubleSide`
`MeshStandardNodeMaterial` mesh and a mesh whose material has a
`maskNode`; after `begin()`, each mesh's material is a stand-in with the
matching `side` / `maskNode` and `allowOverride === false`; two meshes
with the same key share one stand-in; after restore, the original
materials are back; a FrontSide mesh without mask keeps its material (the
override draws it).

GPU check (if available): a snapshot at a fenced yard and a winter date
(`shots/papier-fence-winter.json`), Papier style; fences show from both
sides, bare crowns look bare.

**Verify**: `bun test app/_components/paper-scene.test.ts` → all pass;
`bun run verify` → exit 0.

## Test plan

- `rail-layer.test.ts`: approach with a flush column has only unit normals;
  rail under a deck stays at ground; rail arriving at deck level rides it.
- `paper-scene.test.ts`: stand-ins for double-sided and masked meshes,
  shared per key, restored after the frame.
- Step 2 has no unit test (no GPU in `bun test`); it is a two-line change
  to the node graph.

## Done criteria

- [ ] `bun run verify` exits 0
- [ ] New tests exist in `rail-layer.test.ts` (3) and `paper-scene.test.ts` (≥ 3) and pass
- [ ] `grep -n "RAIL_DECK_ENTRY_M" app/_components/rail-layer.ts` → defined and used
- [ ] `grep -n "mod(cell" app/_components/stylize-effect.ts` → 1 match
- [ ] Only in-scope files changed
- [ ] Status row says whether step 4 was looked at on a GPU

## STOP conditions

- Step 3's tests show that a real bridge in the existing tests (e.g. the
  arch or truss fixtures) loses its rails → stop; the entry rule is wrong
  for that case.
- Step 4: `warmStyles` does not compile per object through `swapped`, or a
  stand-in with `allowOverride = false` is still drawn with the override
  in three r186 (check `Renderer.js` around the override branch) → stop
  and report; do not patch three.
- Step 4 would require a change in any layer file → stop (ADR 0034).

## Maintenance notes

- A rail bridge flag from the bake (`rail.py`, per segment, as `tram.py`
  carries `bridge`) would replace step 3's heuristic; record it in the
  backlog if the heuristic misfires.
- New double-sided or masked layer materials get Papier stand-ins
  automatically; new *transparent* ones stay hidden in Papier.
- Reviewers: check that step 1 did not change any approach's geometry, only
  normals (vertex positions identical before/after in the test).
