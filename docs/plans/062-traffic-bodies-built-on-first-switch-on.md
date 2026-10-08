# Plan 062: The counted-traffic bodies are built when the layer is first switched on, not for every tile at every load

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- app/_components/tile-stream.ts app/_components/tile-stream.test.ts app/_components/traffic-layer.ts app/_components/traffic-layer.test.ts app/_components/traffic-ask.ts app/_components/data-overlays.ts lib/city/data-layers.ts e2e/city-walk.spec.ts docs/rendering.md`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (phones)
- **Effort**: S–M
- **Risk**: LOW–MED (the ask set and the e2e census need the bodies while
  the layer is on; both already assume "built by the time it shows")
- **Depends on**: none (plan 060 edits other parts of `tile-stream.ts`;
  merge either first)
- **Category**: perf (phone memory)
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

Every data layer is off at start (ADR 0040), and the bicycle columns and
the timetable trams are built on the first switch-on
(`data-overlays.ts`). The counted motor traffic is not: `buildDressing`
builds the traffic bodies for **every fine terrain level** and
`buildCoarseDressing` for **every coarse level**, compiles them hidden,
weighs them into the tile cache, and the switch only flips `visible`.
Measured on the committed Dresden data with the layer's own rules
(`lib/city/traffic.ts`): the spawn tile has 209 counted sections = 47.4 km
of lanes; at the fine detail's 2 m sampling and 11-vertex ring that is
≈ 23 700 samples ≈ 260 000 vertices with four float attributes (52 B) plus
an index — about **21 MB of GPU buffers for the fine level** of one tile
(19.5 MB on `33410_5654`, 4.4 MB on a quiet tile), plus ≈ 3.3 MB for each
coarse level, plus `computeVertexNormals()` adding a 12 B/vertex `normal`
the material (`MeshBasicNodeMaterial`) never reads, plus the same bytes
again as JS arrays, which `dropContentCopies` does not drop for a
dressing. On a phone, where every coarse level in the 6 km frustum stays
loaded and four or five fine levels are in reach, that is roughly
50–100 MB of the 336 MiB tile cache (ADR 0047) spent on a layer nobody
has switched on — real tiles unload sooner, and the build runs inside the
dressing's last task (the longest one) on every tile load. GPU bytes are
reasoned, not measured; the vertex counts are.

The fix follows the two overlays that already do it: keep the feature
lists (30–60 kB per tile) in the dressing, build the bodies on the first
switch-on per dressing in a task of their own, drop them (or keep them
hidden — see step 2) when the layer goes off, and stop computing normals.

## Current state

- `app/_components/tile-stream.ts` — the dressing: `TileDressing.traffic?: Group`
  (`:148`), `showDataLayers` (`:411-418`), `catchUp` (`:398-408`), the
  fine build (`:830-842`), the coarse build (`:588-598`), the ask set
  (`:611`, `:841`), the byte weighing through `dressingBytes`
  (`calculateBytesUsed`, `:1024-1030`).
- `app/_components/traffic-layer.ts` — `buildTraffic(features, bridges, ctx, detail, bounds): Group`
  (`:355-412`); its geometry at `:386-392` sets `position`, `trafficAcross`,
  `trafficLane`, `trafficCount`, the index, then `computeVertexNormals()`.
- `app/_components/traffic-ask.ts` — `trafficAskSet(bands, traffic, tile)`
  (`:35`): the probe asks a section on its body.
- `app/_components/data-overlays.ts:168-230` — the lazy pattern
  (`tramOverlay`: `load()` on the first `apply(true)`, compiled hidden,
  shown once compiled).
- `lib/city/data-layers.ts` — `DataLayerKey = "bikeLayer" | "trafficLayer" | "tramLayer"`;
  the look carries `trafficLayer: boolean`.
- `e2e/city-walk.spec.ts:846-848` — the census asserts traffic triangles
  only **after** the HUD switch is clicked:

```ts
    // The spawn tile's counted sections are built (hidden until now).
    const stats = await page.evaluate(() => window.__poc?.stats?.layerStats);
    expect(stats?.traffic.triangles ?? 0).toBeGreaterThan(0);
```

`tile-stream.ts:411-418`:

```ts
export function showDataLayers(
  d: Pick<TileDressing, "traffic">,
  look: Pick<LookValues, "trafficLayer">
): void {
  if (d.traffic) {
    d.traffic.visible = look.trafficLayer;
  }
}
```

`tile-stream.ts:830-842` (the fine level):

```ts
  const trafficBands =
    traffic.length > 0
      ? buildTraffic(
          traffic,
          bridges,
          ground,
          "fine",
          ctx.tileBounds(tile) ?? terrain.bounds
        )
      : undefined;
  // The counted sections are asked on their bodies, while the layer shows.
  const trafficSet = trafficAskSet(trafficBands, traffic, tile);
```

`tile-stream.ts:588-598` (the coarse level) is the same call with
`"coarse"` and `{ offset, heightAt: terrain.heightAt }`.

`traffic-layer.ts:386-392`:

```ts
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(body.pos, 3));
  geo.setAttribute("trafficAcross", new Float32BufferAttribute(body.across, 3));
  geo.setAttribute("trafficLane", new Float32BufferAttribute(body.lane, 4));
  geo.setAttribute("trafficCount", new Float32BufferAttribute(body.count, 3));
  geo.setIndex(body.index);
  geo.computeVertexNormals();
```

`traffic-layer.test.ts` holds the attribute count ("WebGPU draws from at
most eight vertex buffers", AGENTS.md) — read it before step 1.

The dressing is compiled before it shows (`PostStack.compile` through
`ctx.compile`, AGENTS.md "Tiles and dressings compile before they
show"); anything added to a dressing later must go through `ctx.compile`
too (the overlays do: `await opts.compile(built.group)`).

Conventions: everything a tile adds is built in the plugin's build path
and freed in `disposeTile`/`disposeDressing` (never leaked when the
layer goes off); bytes a dressing adds must reach `calculateBytesUsed`;
`Instances`/`sceneMaterial` rules (AGENTS.md "Rendering gotchas"); tests
with `bun:test` beside the module; Conventional Commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Unit tests (targeted) | `bun test app/_components/traffic-layer.test.ts app/_components/tile-stream.test.ts` | pass |
| Typecheck | `bun typecheck` | exit 0 |
| The gate | `bun run verify` | exit 0 |
| e2e (the data layers) | `bun run test:e2e --grep "@desktop-hud"` | pass (slow, SwiftShader) |

## Scope

**In scope** (the only files you should modify):
- `app/_components/tile-stream.ts`, `app/_components/tile-stream.test.ts`
- `app/_components/traffic-layer.ts`, `app/_components/traffic-layer.test.ts`
- `app/_components/traffic-ask.ts` (only if its input type changes)
- `docs/rendering.md` (the data layers' paragraph: "built on first switch-on")

**Out of scope** (do NOT touch, even though they look related):
- `data-overlays.ts` — the site-wide overlays already build lazily.
- `lib/city/traffic.ts` and the bake — the features are unchanged.
- `selection-outline.ts`, `selection-shape.ts` — they read a body's
  `position`/index for the outline; the bodies keep those attributes.
- The HUD switch and `lib/city/data-layers.ts`.

## Git workflow

- Branch: the branch you were given, or `plan/062-traffic-lazy`.
- Commits per step, Conventional Commits, e.g.
  `perf(traffic): the counted traffic's bodies are built on the first switch-on`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: No normals

In `traffic-layer.ts` remove `geo.computeVertexNormals();` (the material
is a `MeshBasicNodeMaterial`; confirm by reading `trafficMaterial()` —
if it reads `normalNode`/lighting, STOP). Update `traffic-layer.test.ts`'s
attribute count if it counts `normal`.

**Verify**: `bun test app/_components/traffic-layer.test.ts` → pass.
Commit: `perf(traffic): no vertex normals on the flow bodies (unlit)`.

### Step 2: The dressing keeps the features; the bodies come on demand

In `tile-stream.ts`:

1. Change the dressing's slot from a built group to a lazy holder. Add a
   small type in the file:

   ```ts
   /** The counted traffic of a tile (traffic-layer.ts): its features at
    *  once, its bodies built on the first switch-on and freed with the
    *  dressing — a data layer costs nothing while it is off. */
   export interface TrafficSlot {
     /** the bodies, once built and compiled (null before, and while off if
      *  `release` dropped them) */
     group: Group | null;
     /** builds (or rebuilds) the bodies; resolves once compiled and hung */
     show: () => Promise<void>;
     /** hides the bodies (keeps them: a second switch-on is instant) */
     hide: () => void;
     /** the ask set for the probe, valid while `group` is set */
     asks: () => AskSet<TrafficInquiry> | null;   // use the real type trafficAskSet returns
     dispose: () => void;
   }
   ```

   and `TileDressing.traffic?: TrafficSlot`. The part table
   (`DRESSING_PARTS.traffic`) maps to `d.traffic?.group ?? undefined` so
   disposal and the census still reach the bodies when they exist.
2. In the fine and coarse builds, replace the `buildTraffic(...)` call with
   a slot created by a helper `trafficSlot(features, bridges, ground, detail, bounds, ctx)`
   placed beside the builders: `show()` builds the group in its own task
   (`await nextTask()` — the file's helper), sets `group.visible = false`,
   adds it to the content root, `await ctx.compile(group)`, then
   `visible = true`, bumps the dressing's bytes and calls `ctx.onChange()`;
   a second `show()` while building awaits the same promise; `hide()` sets
   `visible = false`; `dispose()` disposes the group through the file's
   `disposeObject3D` path. Keep the bodies after `hide()` (toggling is
   common and the rebuild is the expensive part); the tile's release
   frees them with the dressing. If a phone's memory is the concern on
   hide, note it as a follow-up — not in this plan.
3. `showDataLayers` becomes: `if (look.trafficLayer) void d.traffic?.show(); else d.traffic?.hide();`
   — it is called from `catchUp` (on look changes and when a dressing
   lands), so a dressing that lands while the layer is on builds at once,
   and a layer switched on builds every loaded dressing's bodies, one
   task each.
4. The ask set: `trafficAskSet(trafficBands, traffic, tile)` is built once
   the bodies exist (inside `show()`) and exposed through `asks()`; where
   the dressing's `asks` list is assembled (`:822-826` and the coarse
   equivalent), include the traffic set lazily — read how the probe
   consumes `TileDressing.asks` (`inquiry-probe.ts`, `ask-items.ts`) and
   make the traffic set a member that is `null` until shown (the probe
   already skips a null bridge set at `:826`: mirror that).
5. Bytes: `dressingBytes` (read where it is computed from the parts) must
   include the bodies once built; after `show()` compiles, recompute and
   call `this.tiles?.recalculateBytesUsed()` (the file does this after
   `hangDressing`; reuse that path).

**Verify**: `bun typecheck` → exit 0; `bun test app/_components/tile-stream.test.ts` → pass.

### Step 3: Tests

In `tile-stream.test.ts`:

- "the counted traffic costs nothing while the layer is off": a dressing
  built with traffic features and `look.trafficLayer = false` has
  `d.traffic?.group === null` and `dressingParts(d)` holds no traffic group.
- "the first switch-on builds and compiles the bodies once": `show()`
  twice → the context's `compile` was called once, `group` is set and
  visible; `hide()` → not visible, group kept; `dispose()` → freed.
- The existing part-table test (`:93-116`) keeps passing (the `traffic`
  key is still a part).

Model the context stub on `:229-266` (the `compile` fake records calls).

**Verify**: `bun test app/_components/tile-stream.test.ts` → pass with the two new tests.
Commit: `perf(traffic): the counted traffic's bodies are built on the first switch-on`.

### Step 4: The e2e census still passes

`bun run test:e2e --grep "@desktop-hud"` (slow): the data-layers test
clicks the traffic switch and then expects `layerStats.traffic.triangles > 0`
— with lazy bodies the compile happens after the click; if the assertion
races the compile, wait for it the way the trams are waited for
(`page.waitForFunction(() => (window.__poc?.stats?.layerStats.traffic.triangles ?? 0) > 0, …)`)
— that is a change to `e2e/city-walk.spec.ts:846-848` and is allowed
(add the file to the commit).

**Verify**: the `@desktop-hud` group passes.

### Step 5: Docs

In `docs/rendering.md`, the data layers' paragraph (search "counted motor
traffic"): add "built on the first switch-on per tile (like the bicycle
columns and the trams), kept hidden when switched off, freed with the
tile".

**Verify**: `bun run test -- lib/docs` → pass.

### Step 6: The gate

`bun run fix && bun run verify` → exit 0.

## Test plan

- `traffic-layer.test.ts`: attribute count without `normal`.
- `tile-stream.test.ts`: off costs nothing; first switch-on builds once;
  hide keeps; dispose frees.
- e2e `@desktop-hud`: the switch still shows triangles.
- Verification: `bun run verify` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "computeVertexNormals" app/_components/traffic-layer.ts` → no match
- [ ] `grep -n "buildTraffic(" app/_components/tile-stream.ts` → only inside the slot's `show()` (not in `buildDressing`/`buildCoarseDressing` directly)
- [ ] `grep -n "TrafficSlot" app/_components/tile-stream.ts` matches the type and the dressing field
- [ ] `bun test app/_components/tile-stream.test.ts app/_components/traffic-layer.test.ts` passes with the new tests
- [ ] `bun run test:e2e --grep "@desktop-hud"` passes
- [ ] `grep -n "first switch-on" docs/rendering.md` matches
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files (plus `e2e/city-walk.spec.ts` if step 4 needed it)
- [ ] `docs/plans/README.md` status row for 062 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `trafficMaterial()` reads normals (lighting) — then step 1 changes the look.
- The probe reads `TileDressing.asks` as a fixed array built at dressing
  time with no way to add a set later (report; the fallback is to build
  the ask set from the features alone, without bodies — read
  `trafficAskSet` to see whether it needs the bodies or only their
  section ids).
- The e2e census counts traffic triangles *before* the switch is clicked
  anywhere else (grep `traffic.triangles` in `e2e/`).
- `dressingBytes` is computed once at hang time with no path to update it
  later (then add one; if that needs `DressingPlugin` internals beyond
  `recalculateBytesUsed`, report).

## Maintenance notes

- A fourth data layer with per-tile bodies should copy `TrafficSlot`
  (or the registry item in the backlog — "adding a data layer touches five
  spine files" — may generalise it); the rule is: features at load,
  bodies on demand, bytes reported when built.
- `hide()` keeps the bodies: if phone memory ever needs them freed on
  switch-off, `hide()` can `dispose()` and `show()` rebuild — the slot's
  interface already allows it.
- Reviewer: check that a dressing landing while the layer is on builds
  its bodies (the `catchUp` path), and that a tile released mid-`show()`
  does not hang bodies on a released root (the compile path in plan 060
  step 5 covers dressings; the slot must check `released` the same way —
  simplest: `show()` returns early if the dressing was disposed).
