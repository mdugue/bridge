# Plan 095 [rewrite]: The viewer is a package with one entrance, a coordinate's frame is its type, and `bootApp` is owners

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and `AGENTS.md`
> first. The plan has three parts. **Part B may go at any time**; parts A
> and C go last in the series, after
> [090](./090-rewrite-dressing-gpu-ready.md) has landed and
> [093](./093-rewrite-streaming-quadtree.md) is built or rejected. Every
> phase is one PR, changes no behaviour and no pixel, and ends in a
> **Verify**. On a STOP condition, stop and report. When a phase lands,
> update this plan's row in `docs/plans/README.md` (keep the `[rewrite]`
> mark) and write its figures into the ledger of
> [087](./087-rewrite-measuring-stick.md).
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- app/_components/create-app.ts app/_components/scene-protocol.ts app/_components/scene-client.ts app/_components/scene-server.ts app/_components/scene-worker.ts lib/city/ground-clamp.ts oxlint.config.ts tsconfig.json package.json`
> The counts under "Current state" are of 2026-11-16 and will have moved:
> count again with the recipes given there before you plan a move.

## Status

- **Priority**: P3 (part B: P2)
- **Effort**: M–L (A: M, B: S–M, C: M)
- **Risk**: MED for A (the bundler, every open PR), LOW for B, MED for C
- **Depends on**: A and C on 090 and on 093's outcome; B on nothing
- **Category**: rewrite — less complexity (orientation; rules the
  compiler, the linter or a test holds instead of a sentence)
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md),
  joint 11
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: TODO

## Why this matters

Three things an agent or a person must hold in the head today because
nothing else holds them. Where the scene ends and the page begins is a
lint rule with fifteen exceptions over two flat folders of about 310 and
390 files. Which frame a pair of numbers is in — the provider's UTM, or
the scene's — is in its variable's name, and the rule that goes wrong
worst ("trees shoot skywards", ADR 0005) is a paragraph in `AGENTS.md`.
And `bootApp` is one function of about 3 090 lines with some 230 locals,
reached only by the end-to-end suite. Each part turns a sentence into
something that fails when it is broken.

## Current state (2026-11-16)

**The two folders.** `app/_components/`: 176 `.ts`, 34 `.tsx`, 99 tests,
no subfolder. `lib/city/`: 211 modules, 181 tests, no subfolder.
`lib/city` imports nothing from `app/`, no three and no DOM
(`lib/city/purity.test.ts` reads every file for it). `package.json` is
one package (`"name": "bridge"`, no `workspaces`); `tsconfig.json` maps
`@/*` to `./*`. Counted over the value imports on 2026-11-16: of
`lib/city`'s modules 58 (20 236 lines) are reached by the build and the
viewer, 45 by the build alone, 104 by the viewer alone.

**The entrance exists; nothing enforces it.** The scene is served over
messages: `scene-protocol.ts` (the messages), `scene-server.ts` (the
scene's end), `scene-client.ts` (the page's end, a handle), `scene-host.ts`,
`page-view.ts` (the one door to the page), `scene-worker.ts`. The worker
is made in `scene-client.ts`, `workerChannel`, as
`new Worker(new URL("./scene-worker.ts", import.meta.url), { type: "module", name: "scene" })`;
three more workers (BVH, ground, window niches) the same way through
`worker-client.ts`. What keeps a scene module off the DOM is
`oxlint.config.ts`:

```ts
files: ["app/_components/*.ts", "lib/**/*.ts"],
rules: { "no-restricted-globals": ["error", { name: "document", … },
  { name: "window", … }, { name: "location", … }] },
```

followed by a list of fifteen page modules that switch it off again
(`scene-client.ts`, `scene-host.ts`, `page-view.ts`, `image-export.ts`,
`nameplate-glyphs.ts`, …). Nothing stops a `.tsx` from importing a scene
module by value.

**What was tried.** The README's *Rejected* list: "Regrouping
`app/_components` into folders — import churn across ≈ 110 files for
orientation AGENTS.md already gives." Plan 046 ("moves only: split the
god modules") was closed as drifted: it lived for five weeks beside
changing code. Its lesson for `bootApp`, from the review of 2026-11-04
(backlog item 14): "the rest fails the deletion test as section-sized
modules: each section reads 10–20 of `bootApp`'s locals. Move pure
functions only."

**What worked.** Commit `bec0ca7` took "five owners out of create-app":
`crosshair-focus.ts`, `frame-meter.ts`, `load-veil-follow.ts`,
`scene-capture.ts`, `tile-memory.ts`. An owner is not a section. It
takes a narrow context and gives back a handle, and its test runs it
with a fake context:

```ts
export function bindTileMemory(ctx: TileMemoryContext): TileMemory { … }
```

`TileMemoryContext` has six members (`tiles`, `tier`, `safety`, `held`,
`shedding`, `note`); `tile-memory.test.ts` fakes them.

The frame's order is a tested list (`frame-steps.ts`, `FRAME_STEPS`),
and optional features listen to the spine through `feature-seam.ts`.
`create-app.ts` is 4 542 lines; `bootApp` runs from about line 1 455 to
the end; its hubs are `setSun`, `applyLook`, the stream's change handler
and `frame`.

**Frames.** ADR 0005: data stays in the provider's UTM; one recenter
offset a site; `x = E − cx`, `z = −(N − cy)`, `y` = height; a `world`
group turned −90° about X holds what is Z-up; dressing that computes
Y-up positions never goes inside it. The conversion has one home,
`lib/city/ground-clamp.ts`:

```ts
worldToEpsg(x: number, z: number, offset): { x: number; y: number }
epsgToWorld(x: number, y: number, offset): { x: number; z: number }
```

31 modules call them; about a hundred more lines in `app/_components`
and `lib/city` do the arithmetic on `offset.cx` / `offset.cy` by hand
(`grep -rn "offset.cx\|offset.cy\|- cx\|- cy"`). Everything is `number`:
`GroundContext.heightAt(x, y)` takes "projected (x, y)" and returns
"world Y"; `PlayerPose` has `epsgX`, `epsgY`; `Xyz` is the scene's. In
shaders the data frame comes from world space (`shader-chunks.ts`,
`dataXY = vec2(positionWorld.x, positionWorld.z.negate())`).

**A trap for part A.** The bake cache's key hashes each module's path
with its contents (`scripts/bake-sources.ts`, `contentKey`: the string
hashed is the path, a colon and the content's hash). A moved module is a
new key for every bake that reaches it.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install` | exit 0 |
| Format, then gate | `bun run fix && bun run verify` | exit 0 |
| Build | `bun run build` | exit 0 |
| End to end | `bun run test:e2e` | all pass |
| The scene's modules | `bun -e 'import {moduleGraph} from "./scripts/bake-sources.ts"; console.log(moduleGraph("app/_components/scene-server.ts").join("\n"))'` | a list of paths |

## Scope

**In scope**: B — a new `lib/city/frames.ts`, `lib/city/ground-clamp.ts`
and the call sites of its two functions, the hand arithmetic on the
offset, tests. A — `package.json`, `tsconfig.json`, `bunfig.toml`,
`oxlint.config.ts`, `next.config.ts`, the moved files, every path in
`docs/`, `AGENTS.md`, `.claude/skills/`, `scripts/bake-entries.ts` and
the tests that read a folder. C — `app/_components/create-app.ts` and
the owners taken out of it.

**Out of scope**:

- Any behaviour, constant, shader or pixel. A phase that changes a plate
  of 087 is wrong.
- `components/ui/` (vendored by `shadcn add`).
- Plan 021's `wissen/` package: named here, built there.
- A registry of dressing kinds, more hooks through `feature-seam.ts`,
  splitting `lib/city/features.ts` (rejected 2026-11-04, the README's
  *Rejected* list); an `oxlint-disable` comment, anywhere.

## Part B — a coordinate's frame is its type (independent, may go first)

### Phase B1 — spike on five modules

Add `lib/city/frames.ts`: the frames as brands that cost nothing at
runtime, and the two conversions typed with them (re-exported from
`ground-clamp.ts`, so no import moves yet). Three frames have names in
this code: the provider's projected coordinates (E, N, metres), the
recentered data frame (Z-up: the `world` group's and the tileset's) and
the scene (Y-up). Try both shapes on `ground-clamp.ts`, `ground.ts`,
`shadow-rings.ts`, one layer that drapes on the ground and one that
places instances: a brand on the point (`{ x, y }` in one frame is not
`{ x, z }` in another) and a brand on the scalar (an easting is not a
`z`). Count for each the lines touched and the casts needed, and decide.

**Verify**: `bun run verify` → exit 0; the Findings name the shape, the
lines touched and the casts (`grep -c " as Epsg\| as Scene"` over the
five modules).

### Phase B2 — the conversions and their callers

`epsgToWorld` and `worldToEpsg` take and return the branded types;
`GroundContext.heightAt` says in its type what it takes; the hand
arithmetic on the offset goes through `frames.ts`. A typed array of
positions carries its frame the same way where a builder hands one on.
The handle a layer hangs its parts on is typed by frame: a builder of
Y-up dressing is given the scene's root and never the rotated group, so
"never inside the rotated group" is a type error at the call, and a test
over a fake tile asserts that no dressing has the `world` group as an
ancestor. Shaders stay as they are (`dataXY` is one function already).

**Verify**: `bun run verify` → exit 0; a new test like
`lib/city/purity.test.ts` reads the tree and fails if a module other
than `frames.ts` computes with `offset.cx` or `offset.cy`;
`bun run build` then `bun run test:e2e` → green; ledger: the first
load's JavaScript bytes unchanged within 0.1 % (types erase).

## Part A — the viewer as a package (after 090 and 093)

### Phase A0 — count what is left, and try the bundler

Count from the import graph, not by eye: `moduleGraph` from
`scripts/bake-sources.ts` over `app/_components/scene-server.ts` and the
three worker entries is **the scene**; over `app/**/*.tsx` and the page
modules, less the scene, is **the page**; what both reach is **shared**.
Write the three lists and their line counts into the Findings; they are
the move's manifest. On 2026-11-16 the scene's server alone reaches 281
modules (144 under `app/_components`, 137 under `lib/`). Expect fewer:
090 takes the mesh builders out of the viewer (plan 074 counted ≈ 7 400
lines of them), 093 rewrites the stream.

Then the spike, on a branch that is thrown away: declare Bun workspaces
in `package.json` (the shape plan 021 names: one `bun.lock`, its
`wissen/` beside `packages/*`), move only `scene-worker.ts` and what it
imports into `packages/scene/`, and build. The installed Next's docs say
Turbopack transpiles workspace packages without `transpilePackages`
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/transpilePackages.md`);
whether `new Worker(new URL(…, import.meta.url))` inside such a package
still gets its bootstrap and its chunks is not written there. Read that
folder again before touching `next.config.ts` (AGENTS.md: "This is NOT
the Next.js you know").

**Verify**: `bun run build` → exit 0 and `bun run test:e2e` → green on
the spike; the worker says hello (`?trace=1`); three's core is in one
chunk, not in the page's and the worker's (plan 043 once measured
+20.8 kB gz for that, ADR 0040); ledger: first-load JavaScript within
1 %. `bun dev` reloads a scene module without a full restart.

### Phase A1 — the move, in one mechanical PR

- **Shape**: `packages/city/` (today's `lib/city`, still pure),
  `packages/scene/` (the scene and its workers) with an `exports` map of
  three doors — the protocol's types, the page's client, the worker's
  entry — and `app/` (the HUD's `.tsx` and the page's own modules). A
  `.tsx` that imports a scene module then fails to resolve.
- **The lint rule** names `packages/scene/src/**` and loses its list of
  fifteen exceptions: the page's modules no longer live under the glob.
- **How**: a script does every `git mv` and rewrites every import
  specifier; it is run once, and its text stands in the PR's
  description so that any open PR can be rebased by running it again on
  its branch. No file is edited by hand in this PR. Make it when the
  list of open PRs is short, and say so in each open PR the day before.
  `@/lib/city/*` and `@/app/_components/*` stay as `paths` aliases onto
  the new places for that week, then go in a second, small PR.
- **Paths in prose** move in the same PR, by the same script: `docs/`,
  `AGENTS.md` and the skills name a module by path about nine hundred
  times, the code's comments about seven hundred.
- **The bake cache**: every key changes (the trap above). The bytes do
  not. So the proof is the one this repository already uses: a cold
  bake of every site publishes no new file, and after
  [088](./088-rewrite-tiles-as-a-data-product.md) the lock file that
  names the published tileset is unchanged.

**Verify**: `git diff --stat -M` shows renames and specifier lines only;
`bun run verify`, `bun run build`, `bun run test:e2e` → green;
a cold `bun run build` (or 088's publish) → 0 new files;
the block of `oxlint.config.ts` that switches `no-restricted-globals` off
lists test files only; ledger: first-load JavaScript and the worker's chunk within
1 %; 087's plate compare passes.

## Part C — `bootApp` as owners (after 090 and A1)

### Phase C1 — the inventory

List `bootApp`'s top-level locals and, for each, who reads and who
writes it (the TypeScript compiler's references, or by hand for the
hubs). Group them into owners in the sense of `tile-memory.ts`: a group
is an owner only if its context is narrow — the review of 2026-11-04
found that sections reading ten to twenty locals are not. Candidates to
test against that bar: the sun and the clock (`setSun`), the look
(`applyLook`), what a stream change does to the shadows, the lamp pool
and the styles' gathering, picking and the inquiry, Modell's rig, a
design's loading, the mirror the HUD reads. 090 will have emptied most
of the stream handler's dressing hookups; count after it, not before.

**Verify**: the Findings hold a table: owner, locals it takes, context
members, handle members. No code changes.

### Phase C2 — one owner a PR

Each owner leaves as `bindX(ctx): X` with a unit test on a fake context
that states what it does on each signal — as `tile-memory.test.ts` and
`frame-steps.test.ts` do. `bootApp` keeps the order things are made in
and the frame's binding. An owner whose context grows past eight members
is put back.

**Verify** (each PR): `bun run verify` → exit 0 with the owner's new
test; `bun run test:e2e` → green; 087's plates pass;
`awk` over `create-app.ts` shows `bootApp` shorter than before.

## Which rule becomes what

Check each against the tree first; a rule the tree already breaks is
reported, not repaired here.

| Rule in `AGENTS.md` | Today | After this plan |
|---|---|---|
| Scene modules touch no DOM | lint, fifteen exceptions | lint on a package, no exception; `exports` |
| A HUD read is the mirror or a promise | prose | `exports`: the page reaches only the client |
| `x = E − cx`, `z = −(N − cy)` | prose, one helper, a hundred hand copies | types (B2) and a tree-reading test |
| Dressing never inside the rotated group | prose | a typed parent and a test over a fake tile |
| `lib/` keeps three for math only, no DOM | `purity.test.ts` | the same test, on the package |
| Import three from `three/webgpu`, `three/tsl`, `three/addons` | prose | lint, if oxlint's catalogue has the rule (`oxlint --print-config -D all`); else a tree-reading test |
| Never `InstancedMesh` | prose (three files name it, `instancing.ts` among them) | the same lint or test, with those files named |
| Every `compileAsync` in its turn | prose (four call sites) | a tree-reading test listing the allowed files |
| Eight vertex buffers, sixteen inter-stage variables | prose | [094](./094-rewrite-fixed-pipeline-set.md)'s counting test |
| A phone's memory must not grow | prose, measured by hand | 087's ledger |
| `invalidateShadows()` after the first frame; the twin camera; what a tile brings is freed with it | prose | prose — they are about time, not about shape |

## Test plan

- B: `lib/city/frames.test.ts` (round trips, the edge rule of
  `ownsPoint` untouched), the offset-arithmetic test, the
  no-dressing-under-`world` test; type-level tests as
  `// @ts-expect-error` lines in `frames.test.ts`.
- A: no new behaviour, so no new test of behaviour; `purity.test.ts`
  moves with its folder; a test that the scene package's `exports` has
  exactly three doors.
- C: one test file an owner, modelled on
  `app/_components/tile-memory.test.ts`.

## Done criteria

- [ ] `bun run verify`, `bun run build`, `bun run test:e2e` exit 0
- [ ] 087's plate compare passes after every phase; the ledger's
      JavaScript bytes within 1 % of before
- [ ] No module but `frames.ts` computes with the recenter offset (its
      test passes)
- [ ] `oxlint.config.ts` holds no list of page modules
- [ ] A cold bake after A1 publishes no new file
- [ ] `bootApp` is under 1 000 lines; each owner has a unit test
- [ ] `AGENTS.md`, the `city-walker` skill, ADR 0002 and ADR 0061 name
      the packages; ADR 0005 names `frames.ts`; the row in
      `docs/plans/README.md` is updated

## STOP conditions

- A1 before 090 has landed and 093 is decided: the move would carry
  files about to be deleted or rewritten.
- A0's spike: three in two chunks, a worker that does not start from a
  package, or a dev server that needs a restart for a scene edit.
- B1: more than one cast in twenty touched lines, or a brand that has to
  be peeled inside a loop over vertices.
- Any phase: a plate of 087 differs, or the first load grows by more
  than 1 %.
- A1: the diff holds a line that is neither a rename nor a specifier nor
  a path in prose.
- C2: an owner needs more than eight context members, or a second owner
  needs to write a local the first one owns.

## Maintenance notes

- A new scene module goes into the scene's package; if the page needs
  it, it is a message in the protocol, not a fourth door.
- A new conversion between frames is a function in `frames.ts`.
- Reviewers of A1: read the script, not the diff.
- Deferred: splitting `packages/city` into what the build, the viewer
  and both read (the counts are in "Current state"); it needs
  [092](./092-rewrite-bake-store.md)'s schema modules settled first.

## What the series changes about this plan

Alone and today, part A is the regrouping the README already rejected:
churn across every open PR for orientation. Inside the series it comes
after 090 has taken the builders out of the viewer and 093 has rewritten
the stream, so it moves what will stay; it buys an entrance the resolver
enforces and a lint rule without exceptions; and with 088 its proof is a
lock file that does not change. Part C alone was dropped once (plan 046,
step 2); it is taken up again only in the shape that worked in
`bec0ca7`, and after 090 has emptied the handler that made the closure
wide. Part B owes the series nothing and can go tomorrow.

## Findings

(Empty. B1's shape and counts, A0's three lists and the spike's chunk
figures, C1's table.)
