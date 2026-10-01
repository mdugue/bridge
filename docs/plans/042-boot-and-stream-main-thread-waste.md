# Plan 042: Less main-thread churn while tiles stream — stats once per beat, footprints only when they change, the viewer chunk fetched in parallel

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command
> and confirm the expected result before moving on. On a STOP condition,
> stop and report. When done, update this plan's row in
> `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- app/_components/create-app.ts app/_components/city-walk.tsx app/_components/minimap.tsx app/_components/city-walk-client.tsx`
> Compare the excerpts below against the live code; a mismatch in the
> lines a step edits is a STOP condition for that step.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (the e2e reads `__poc.stats`; it must still arrive, throttled is fine)
- **Depends on**: 037 (test commands)
- **Category**: perf
- **Planned at**: commit `a28de75`, 2026-10-01

## Why this matters

AGENTS.md names the main thread (node builds, dressing builds) as one of
the two bottlenecks. While the site streams, every tile event —
`load-model`, `tile-visibility-change`, a settled dressing, a release
(about four per tile, fifteen tiles, plus every coarse↔fine flip in
flight) — runs a full stats pass (a whole-scene geometry-byte traversal
plus four census traversals), and the HUD then re-flattens **every
building footprint of the site** (≈ 33 600 LoD2 buildings plus ≈ 6 600
scanned structures; one measured tile alone is 3 111 polygons / 12.6 k
points) into a fresh array. Because the array is always new, the minimap
repaints its whole static layer — land cover plus one fill and one stroke
per footprint polygon — on each event. On desktop the minimap is open by
default. Separately, the 15 footprint files (~0.3 MB raw each) are
fetched before the first frame, competing with the spawn tile's glTF; and
the viewer's JavaScript chunk (three/webgpu, 3d-tiles-renderer, the whole
viewer) only starts downloading after the manifest round trip, which it
does not depend on.

## Current state

`app/_components/create-app.ts`:

```ts
// :997-1017
  const emitStats = () => {
    const cities = stream.visibleCities();
    const dressings = stream.visibleDressings();
    opts.onStats?.({
      buildingCount: cities.reduce((n, c) => n + countBuildings(c), 0),
      ...
      gpuMegabytes: Math.round(gpuBytes() / 1_048_576),
      layerStats: { city: census(...), terrain: census(...), ... },
    });
  };
// :1018-1039
  const footprints = new Map<string, [number, number][][][]>();
  function loadFootprints(): void {
    for (const tile of extras.tiles) {
      fetchOptionalJson<[number, number][][][]>(new URL(tile.footprints, tilesetUrl).href, opts.signal)
        .then((polys) => {
          if (polys && !disposed) {
            footprints.set(tile.id, polys);
            emitStats();
          }
        })
        .catch(() => undefined);
    }
  }

  loadFootprints();
// :1041-1066  onChange = () => { ...; postStack.sceneChanged(); invalidateShadows(); emitStats(); checkLoaded(); };
// :1069-1083  demolishAtCrosshair: ... stream.demolished.set(picked.layer.tile, kept); invalidateShadows(); emitStats();
// :1498-1505
  const startStreaming = (): void => {
    if (disposed || !boot.startStreaming()) {
      return;
    }
    stage("details", 0);
    openGate();
    checkLoaded();
  };
// :1562-1566 (on the returned handle)
    getFootprints: (): FootprintPoly[] =>
      [...footprints].flatMap(([tile, polys]) => {
        const gone = stream.demolished.get(tile);
        return footprintPolys(polys, (i) => !gone?.has(i));
      }),
```

The render loop's own comment (`:1307-1308`): "FPS at ~2 Hz on its own
channel — must NOT churn the heavier stats emit (which refreshes
footprints and would re-flash the minimap)."

`app/_components/city-walk.tsx:427-438` (`onStats`):

```ts
      onStats: (s) => {
        if (cancelled) {
          return;
        }
        updatePocDebug({ stats: s });
        const h = handleRef.current;
        startTransition(() => {
          setStats(s);
          if (h) {
            setFootprints(h.getFootprints());
          }
        });
      },
```

and `:480` calls `setFootprints(h.getFootprints())` once after the first
frame.

`app/_components/minimap.tsx:275-297`: the static-layer `useEffect`
repaints land cover, bridges, the frame and `drawFootprints(ctx, footprints, bounds, size)`
with deps `[footprints, bounds, size, height, landcoverTiles, decoded, bridges]`.

`app/_components/city-walk-client.tsx` (`"use client"`):

```ts
const CityWalk = dynamic(() => import("./city-walk"), {
  ssr: false,
  loading: () => <BootScreen />,
});
...
export function CityWalkClient() {
  const manifest = useDataManifest();      // fetch(`/data/manifest.json`, { cache: "no-cache" })
  ...
  if (!setup) {
    return <BootScreen />;
  }
  return <CityWalk budget={setup.budget} tilesetUrl={setup.tilesetUrl} />;
}
```

`next/dynamic` with `ssr: false` calls the loader only when `<CityWalk>`
first renders — after the manifest resolves.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `bun run test` | all pass |
| Gate | `bun run fix && bun run verify` | exit 0 |
| E2E (HUD + minimap) | `bunx playwright test e2e/city-walk.spec.ts -g "minimap\|every scene layer\|demolish"` | pass |

E2E needs Playwright's Chromium (`/opt/pw-browsers` in a Claude Code web
container; never `playwright install`). Without a browser, note "e2e not
run locally" in the status row.

## Scope

**In scope**: `app/_components/create-app.ts`, `app/_components/city-walk.tsx`
(only `onStats` / the post-first-frame footprint read, if needed),
`app/_components/city-walk-client.tsx`.

**Out of scope**: the minimap's drawing code (`minimap.tsx`) — with stable
footprints its effect simply stops re-running; baking footprints into the
minimap raster (a bigger change); the stats' content (the e2e asserts on
it).

## Git workflow

Branch `claude/042-boot-stream-waste`; commits:
`perf(hud): stats at most four times a second`,
`perf(minimap): footprints change only when they load or a building goes`,
`perf(boot): footprints after the handover, the viewer chunk with the manifest`.
No push unless instructed.

## Steps

### Step 1: Stable footprints

In `create-app.ts`, keep a version counter and a cached flattened array:

```ts
  let footprintVersion = 0;
  let flattened: { version: number; polys: FootprintPoly[] } | null = null;
  const currentFootprints = (): FootprintPoly[] => {
    if (flattened?.version !== footprintVersion) {
      flattened = {
        version: footprintVersion,
        polys: [...footprints].flatMap(([tile, polys]) => {
          const gone = stream.demolished.get(tile);
          return footprintPolys(polys, (i) => !gone?.has(i));
        }),
      };
    }
    return flattened.polys;
  };
```

Increment `footprintVersion` where a footprint file lands
(`footprints.set(...)`) and in `demolishAtCrosshair` after
`stream.demolished.set(...)`. `getFootprints: currentFootprints`. Now
`setFootprints(h.getFootprints())` in `city-walk.tsx` passes the same array
until something changed, React bails out, and the minimap's static effect
does not re-run.

**Verify**: `bun run typecheck` → exit 0; e2e "minimap click teleports"
and the demolish test (`grep -n "demolish" e2e/city-walk.spec.ts`) pass.

### Step 2: Stats at most every 250 ms

Replace direct `emitStats()` calls in `onChange`, the footprint `.then`
and `demolishAtCrosshair` with `scheduleStats()`:

```ts
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Coalesces the stream's bursts of events into one stats pass. */
  const scheduleStats = () => {
    if (statsTimer !== null || disposed) {
      return;
    }
    statsTimer = setTimeout(() => {
      statsTimer = null;
      if (!disposed) {
        emitStats();
      }
    }, 250);
  };
  cleanups.push(() => {
    if (statsTimer !== null) {
      clearTimeout(statsTimer);
    }
  });
```

Keep any **synchronous** `emitStats()` call the boot relies on before
returning the handle (search: `grep -n "emitStats()" app/_components/create-app.ts`
after the change — if one runs right before `bootApp` resolves, keep it
direct so `__poc.stats` exists at `firstFrame`). Use `setTimeout`, not the
render loop, so stats still arrive while e2e holds frames (`__poc.hold`).

**Verify**: `bun run typecheck` → exit 0; e2e "every scene layer is built
on the primary tile" passes (it reads `__poc.stats.layerStats` after
`ready`).

### Step 3: Footprints after the handover; viewer chunk in parallel

1. Move the `loadFootprints();` call from boot into `startStreaming()`
   (after `openGate()`), guarded so it runs once (`startStreaming` is
   already idempotent through `boot.startStreaming()`). The minimap shows
   land cover until they arrive.
   Check first: `grep -n "footprints" e2e/city-walk.spec.ts` — a spec that
   expects footprints at `firstFrame` (before the handover) must still
   pass; if one does, STOP for this sub-step.
2. `city-walk-client.tsx`: start the chunk download on mount, in parallel
   with the manifest:

   ```ts
   // The viewer chunk does not depend on the manifest: fetch both at once
   // (next/dynamic would only start the import once <CityWalk> renders).
   const loadViewer = () => import("./city-walk");
   const CityWalk = dynamic(loadViewer, { ssr: false, loading: () => <BootScreen /> });
   ...
   export function CityWalkClient() {
     useEffect(() => {
       void loadViewer();
     }, []);
     ...
   ```

   Do **not** call `import()` at module scope (this component is also
   rendered on the server; three must not load there).

**Verify**: `bun run typecheck` → exit 0; `bun run build` → exit 0;
e2e "serves the viewer shell" and "every scene layer…" pass.

### Step 4: Gate

**Verify**: `bun run fix && bun run verify` → exit 0.

## Test plan

No new unit tests are reasonable here (the changes are in the
`bootApp` closure and a client component). The guards are the existing
e2e specs: the layer census (stats still arrive), the minimap teleport
(footprints and bounds still reach the minimap), demolish (the footprint
version bumps). If `create-app.ts`'s footprint cache is extracted into a
small pure helper later, give it a unit test then.

## Done criteria

- [ ] `bun run verify` exits 0; `bun run build` exits 0
- [ ] `grep -n "scheduleStats" app/_components/create-app.ts` → defined and used ≥ 3×
- [ ] `grep -n "footprintVersion" app/_components/create-app.ts` → ≥ 3 matches
- [ ] `grep -n "loadViewer" app/_components/city-walk-client.tsx` → 3 matches
- [ ] E2E specs named above pass (or "not run locally" noted)
- [ ] Only in-scope files changed

## STOP conditions

- An e2e spec reads `__poc.stats` synchronously right after an action
  that used to emit immediately (e.g. demolish) and now times out → do not
  add waits that hide it; report which spec.
- Deferring `loadFootprints` breaks a spec that expects footprints before
  the handover → keep the boot-time fetch and only do steps 1–2 and 3.2.

## Maintenance notes

- Anything new that changes footprints (an "undo demolish") must bump
  `footprintVersion`.
- If the minimap ever draws something that changes per tile event, give it
  its own version instead of reusing the stats channel.
