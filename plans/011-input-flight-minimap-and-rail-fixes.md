# Plan 011: Six confirmed defects — flight cancel, stuck keys, stale copies, minimap re-decode, rail data, WebGL2 preflight

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- app/_components/create-app.ts app/_components/camera-flight.ts app/_components/minimap.tsx app/_components/rail-layer.ts app/_components/city-walk.tsx scripts/prepare-data.ts e2e/city-walk.spec.ts`
> Plans 008–010 touch `create-app.ts`, `city-walk.tsx`, `prepare-data.ts`
> and the e2e spec — expected drift; re-locate each excerpt by its text
> (line numbers will have moved). A missing excerpt is a STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/008-verification-net.md (fixture test + layer census); run after 010 (both edit `create-app.ts`, `prepare-data.ts`)
- **Category**: bug
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

Six defects, each confirmed by reading the code, each small, each with a
user-visible symptom:

1. A scenic flight owns the camera for up to 3.8 s; a minimap click, a
   double-tap travel, a Snapshot "Apply" or the QA hook's `flyTo` during that
   time is silently overwritten on the next frame, and the flight's pending
   movement mode then overrides the mode the snapshot asked for.
2. Releasing a movement key while the focus is in a text field (the Snapshot
   textarea, the date field) leaves the key held: the camera keeps walking
   until the window blurs.
3. `prepare-data.ts` decides a copy is up to date when the byte sizes match,
   so a re-baked artifact of the same length is never copied into
   `public/data/`; the plans index also records this as already fixed.
4. Every demolish (and every sidebar resize) makes the minimap decode and
   recolour all four 4096² land-cover PNGs again and blanks the map until
   they arrive; each demolish also recomputes footprints for all four tiles
   although only the primary changed.
5. The rail loader dereferences `properties` without a null check (valid
   GeoJSON allows `null`) and skips `MultiPolygon` ballast — two of the three
   ballast features on tile `33410_5658` are MultiPolygons and are dropped.
6. On a browser without WebGL2 the user sees three.js's raw context error
   instead of a sentence pointing at the one prerequisite the app has.

## Current state

### 1. Flight vs. teleport / snapshot / flyTo

`app/_components/create-app.ts:851-877`:

```ts
  const cameraFlight = createCameraFlight(camera);
  let pendingMode: MovementMode | null = null;
  const flyToViewpoint = (viewpoint: Viewpoint) => {
    ...
    setMovementMode("fly");
    cameraFlight.start({ ... });
    pendingMode = viewpoint.mode;
  };
  const cancelFlight = () => {
    cameraFlight.cancel();
    pendingMode = null;
  };
```

`:1134-1143`:

```ts
  const stepMovement = (dt: number) => {
    if (cameraFlight.update(dt)) {
      return;
    }
    if (pendingMode) {
      setMovementMode(pendingMode);
      pendingMode = null;
    }
    movement.update(dt);
  };
```

`applyCameraState` (`:906-926`), `teleportTo` (`:928-945`) and the handle's
`flyTo` (`:1311-1318`) set the camera pose but never call `cancelFlight()`;
only `onKeyDown` (`:1050-1052`) and `setMoveInput` (`:1338-1340`) do.

`app/_components/camera-flight.ts:89-137` — `isActive`, `cancel`
(`flight = null`), `start(target)` (duration clamped to `[1.4, 3.8]` s via
`BASE_DURATION + dist * SECONDS_PER_METRE`), `update(dt)` (returns `true`
while a flight owns the camera; drives `camera.position`, `quaternion`,
`fov`; releases at `t >= 1`). It is constructed with a `PerspectiveCamera`
only.

`Viewpoint` (used by `flyToViewpoint`) has `epsg: { x, y }`, `aboveGround`,
`headingDeg`, `pitchDeg`, `fov`, `mode` and the HUD-facing `id`, `label`,
`description`; the interface and `SCENIC_VIEWS` live in
`app/_components/viewpoints.ts` — read it for the exact shape.

### 2. Key release swallowed by text fields

`app/_components/create-app.ts:1036-1067`:

```ts
  /** True for a key event aimed at a text field — the HUD owns those keys. */
  const isTextEntry = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || isTextEntry(e.target)) {
      return;
    }
    movement.press(e.code);
    ...
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!isTextEntry(e.target)) {
      movement.release(e.code);
    }
  };
```

`movement.release(code)` is `keys.delete(code)` (`fps-movement.ts:136`) — a
no-op for a code that was never pressed.

### 3. Size-only staleness

`scripts/prepare-data.ts:78-79` and `:107-108`:

```ts
  const upToDate =
    existsSync(destPath) && statSync(destPath).size === statSync(srcPath).size;
```

`:170-179`:

```ts
/** True when `dest` is missing or older than any of its sources. */
function isStale(dest: string, ...sources: string[]): boolean {
  if (!existsSync(dest)) {
    return true;
  }
  const destTime = statSync(dest).mtimeMs;
  return sources.some(
    (src) => existsSync(src) && statSync(src).mtimeMs > destTime
  );
}
```

`plans/README.md:95` (plan 004's status) says "mtime-based staleness (the
size-only check is gone)" — true for the heightfield bake only.

### 4. Minimap re-decode and four-tile footprints

`app/_components/minimap.tsx:150-194`:

```ts
  // Static layer: per-tile land-cover background + frame + footprints. Redrawn
  // after demolish and again as each tile's image decodes.
  useEffect(() => {
    const canvas = staticRef.current;
    if (!canvas) {
      return;
    }
    const ctx = setupCanvas(canvas, size);
    const tiles = landcoverTiles ?? [];
    const decoded = new Map<string, HTMLCanvasElement>();

    const repaint = () => {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, size, size);
      for (const tile of tiles) {
        const cv = decoded.get(tile.src);
        if (!cv) {
          continue;
        }
        const a = epsgToMapPx(tile.bounds[0], tile.bounds[3], bounds, size);
        const b = epsgToMapPx(tile.bounds[2], tile.bounds[1], bounds, size);
        ctx.drawImage(cv, a.px, a.py, b.px - a.px, b.py - a.py);
      }
      ctx.strokeStyle = FRAME;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      drawFootprints(ctx, footprints, bounds, size);
    };

    repaint(); // paper + footprints immediately; tiles fill in as they decode
    let cancelled = false;
    for (const tile of tiles) {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) {
          decoded.set(tile.src, colorizeLandcover(img, 256));
          repaint();
        }
      };
      img.src = tile.src;
    }
    return () => {
      cancelled = true;
    };
  }, [footprints, bounds, size, landcoverTiles]);
```

`colorizeLandcover` (`:40-64`) draws the 4096² image into a 256² canvas and
recolours it via `getImageData`. `footprints` changes on every demolish
(`city-walk.tsx:1120-1129`: `onStats` → `setFootprints(h.getFootprints())`),
and `size` changes with the sidebar width (`city-walk.tsx:318-328`).

`app/_components/create-app.ts:1343-1346`:

```ts
    getFootprints: () => [
      ...buildingFootprintPolys(cityLayer.data),
      ...extraCities.flatMap((c) => buildingFootprintPolys(c.data)),
    ],
```

`extraCities` never change after boot.

### 5. Rail properties and MultiPolygon ballast

`app/_components/rail-layer.ts:38-60`:

```ts
interface RailFeature {
  geometry: { coordinates: [number, number][]; type: "LineString" };
  properties: { electrified: number; tracks: number };
}

interface BridgeFeature {
  geometry: { coordinates: [number, number][][]; type: "Polygon" };
  properties: {
    deck: number[];
    kind: "other" | "path" | "rail" | "road";
    name: string | null;
    structure?: string | null;
  };
}

interface AreaFeature {
  geometry: {
    coordinates: [number, number][] | [number, number][][];
    type: "LineString" | "Polygon";
  };
  properties: Record<string, never>;
}
```

`:579-601` reads `f.properties.deck`, `f.properties.kind`,
`f.properties.structure` unguarded; `:840` reads `f.properties.tracks`.
`buildBallast` (`:806-827`):

```ts
function buildBallast(features: AreaFeature[], ctx: RailContext): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    if (f.geometry?.type !== "Polygon") {
      continue;
    }
    const ring = ringToWorld(
      (f.geometry.coordinates as [number, number][][])[0],
      ctx.offset
    );
    const topY = clampRing(ring, BALLAST_RAISE, ctx);
    if (topY) {
      addFootprint(acc, ring, topY, BALLAST_DROP);
    }
  }
  return meshFrom(acc, COLORS.ballast, ctx.heightFog, { cast: false, offsetUnits: -2, roughness: 1 });
}
```

`buildPlatforms` (`:875-908`) handles `Polygon` (outer ring only) and
`LineString`. `ringToWorld(ring, offset)`, `clampRing`, `addFootprint`,
`meshFrom`, `mesh3` are module-private helpers. The vegetation layer models
the same hazard correctly (`vegetation-layer.ts:102-113`: `properties … | null`
and `?.` on every read). Committed data: `railarea_33410_5658_2_sn.geojson`
has 2 `MultiPolygon` + 1 `Polygon`; a GeoJSON `MultiPolygon`'s
`coordinates` is `[number, number][][][]` (polygons → rings → points).

### 6. No WebGL2 preflight

`app/_components/city-walk.tsx:1091-1100` starts the effect with
`createCityWalkApp({...})` directly; `create-app.ts:302-305` constructs
`new WebGLRenderer(...)`, which throws when no context can be created.
The catch at `city-walk.tsx:1207-1217` stores `err.message` and the Alert at
`:1489-1496` prints it under "Failed to start the city viewer". The `Status`
type is at `:148-151`. `README.md:14` lists "A WebGL2-capable browser" as a
prerequisite.

### Conventions

- Unit tests colocated (`bun test`); three classes without WebGL are fine.
  Model `camera-flight.test.ts` on `app/_components/visual-style.test.ts`
  (structure) — construct a `new PerspectiveCamera(55, 1, 0.3, 6000)`.
- e2e: `/?scene=lite`, shared page, `waitForFrames`; the `__poc` members used
  here — `flyToViewpoint`, `applyCameraState`, `getCameraState`, `teleportTo`,
  `getPose` — already exist (`poc-debug.ts`).
- Complexity cap (ultracite): keep new helpers small and top-level.
- Conventional Commits: `fix: input and collision defects in the viewer` is
  the precedent for a multi-fix commit; one commit per step is preferred.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Full gate | `bun run verify` | exit 0 |
| One test file | `bun test app/_components/camera-flight.test.ts` | all pass |
| Prepare data | `bun scripts/prepare-data.ts` | exit 0 |
| E2E | `bun run test:e2e` | all pass |

## Scope

**In scope**:

- `app/_components/create-app.ts` (`applyCameraState`, `teleportTo`, `flyTo`, `onKeyUp`, `getFootprints`)
- `app/_components/camera-flight.test.ts` (create)
- `app/_components/minimap.tsx` (the static-layer effect)
- `app/_components/rail-layer.ts` (feature types, property guards, `buildBallast`, `buildPlatforms`; export `buildBallast`)
- `app/_components/rail-layer.test.ts` (create)
- `scripts/prepare-data.ts` (the two `upToDate` checks)
- `app/_components/city-walk.tsx` (the effect's first lines; the error copy)
- `app/_components/webgl-support.ts` (create)
- `e2e/city-walk.spec.ts` (one new test)
- `plans/README.md` row 004 (one clause)

**Out of scope**:

- `fps-movement.ts`, `touch-controls.ts`, `collision.ts` — plan 005 covered them.
- `lib/city/minimap.ts` (the math is tested and correct).
- Any rail *geometry* change beyond accepting MultiPolygon rings.
- `virtual-joystick.tsx` (a LOW item, deferred).

## Git workflow

- Branch: `advisor/011-input-flight-minimap-and-rail-fixes`.
- One `fix:` commit per step (Step 1 may be `fix:` + `test:`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Cancel a scenic flight whenever something else takes the camera

1. In `create-app.ts`, move the `cameraFlight`/`pendingMode`/`cancelFlight`
   block so it is declared **before** `applyCameraState` and `teleportTo`
   (it currently sits between them and `getPose`; `flyToViewpoint` may stay
   where it is as long as `cancelFlight` is in scope for all three callers).
2. Add `cancelFlight();` as the first statement of `applyCameraState`,
   `teleportTo` and the handle's `flyTo`, each with the comment
   `// A pose set from outside wins over a scenic glide in progress.`
3. Create `app/_components/camera-flight.test.ts`:
   - `"start then update moves the camera and reports ownership"`: camera at
     origin; `start({ pos: {x: 100, y: 50, z: 0}, headingDeg: 90, pitchDeg: 0, fov: 55 })`;
     `update(0.5)` returns `true` and `camera.position.x` is between 0 and 100
     exclusive; after `update(5)` it returns `true` once more on the frame
     that lands (`t >= 1`) and `false` on the next call; the landed position
     equals the target within 1e-6 and `isActive()` is `false`.
   - `"cancel releases the camera where it is"`: start, `update(0.3)`, record
     the position, `cancel()`, `update(1)` returns `false` and the position is
     unchanged.
   - `"duration is clamped"`: a 1 m hop and a 10 km flight both finish:
     after `update(1.39)` the 1 m hop is still active (`MIN_DURATION` 1.4 s);
     after `update(3.81)` from a fresh start the 10 km flight is finished
     (`MAX_DURATION` 3.8 s).
4. Add an e2e test after "snapshot camera state round-trips":

   ```ts
   test("a snapshot applied mid-flight wins over the glide", async () => {
     const target = {
       mode: "fly" as const,
       pos: { x: -40, y: 160, z: 30 },
       epsg: { x: 0, y: 0 },
       headingDeg: 200,
       pitchDeg: -15,
       fov: 55,
     };
     await page.evaluate((t) => {
       const api = window.__poc;
       if (!(api?.flyToViewpoint && api.applyCameraState)) {
         throw new Error("flight api incomplete");
       }
       // Any viewpoint inside the primary tile; copied from SCENIC_VIEWS[0].
       api.flyToViewpoint(/* paste the first SCENIC_VIEWS entry literally */);
       api.applyCameraState(t);
     }, target);
     await waitForFrames(page, 3);
     const state = await page.evaluate(() => window.__poc?.getCameraState?.());
     expect(state?.pos.x).toBeCloseTo(target.pos.x, 0);
     expect(state?.pos.y).toBeCloseTo(target.pos.y, 0);
     expect(state?.pos.z).toBeCloseTo(target.pos.z, 0);
     expect(state?.mode).toBe("fly");
     expectNoErrors(errors);
   });
   ```

   Paste the first entry of `SCENIC_VIEWS` from `viewpoints.ts` as an
   object literal (the spec cannot import app modules). Before the fix this
   test fails (the flight moves the camera on the next frame).

**Verify**: `bun test app/_components/camera-flight.test.ts` → 3 pass.
`bunx playwright test e2e/city-walk.spec.ts` → all pass including the new one.

### Step 2: Always release keys on `keyup`

Replace `onKeyUp` with:

```ts
  const onKeyUp = (e: KeyboardEvent) => {
    // Always release: the press may have landed on the canvas while the
    // release lands in a text field the user clicked into meanwhile. Releasing
    // a key that was never pressed is a no-op.
    movement.release(e.code);
  };
```

**Verify**: `bun typecheck && bun lint` → exit 0. Manual (in `bun dev`):
hold `W`, click into the Snapshot textarea while holding, release `W` — the
camera stops.

### Step 3: Copy staleness by mtime

In `scripts/prepare-data.ts`, move `isStale` above the copy loops and replace
both `upToDate` computations with `const upToDate = !isStale(destPath, srcPath);`.
In `plans/README.md` row 004, change "(the size-only check is gone)" to
"(the size-only check is gone for the heightfields; the copies switched to
mtime in plan 011)".

**Verify**: `bun scripts/prepare-data.ts` twice → the second run copies
nothing (no `copied` lines). `touch data/dlm/lamps_33412_5656_2_sn.geojson && bun scripts/prepare-data.ts`
→ exactly one `copied … lamps_33412_5656_2_sn.geojson` line. (`touch` only
changes the mtime; `git status` stays clean.)

### Step 4: Cache the decoded minimap tiles; compute neighbour footprints once

1. `minimap.tsx` — split the static effect in two:
   - Keep a `const decodedRef = useRef(new Map<string, HTMLCanvasElement>())`
     and `const [decodedCount, setDecodedCount] = useState(0)`.
   - Effect A, deps `[landcoverTiles]`: for each tile whose `src` is not in
     the map, load the image and on `onload` (if not cancelled)
     `decodedRef.current.set(tile.src, colorizeLandcover(img, 256)); setDecodedCount((c) => c + 1);`.
     Cleanup sets `cancelled = true`. Never clears the map.
   - Effect B, deps `[footprints, bounds, size, landcoverTiles, decodedCount]`:
     `setupCanvas` + the `repaint()` body, reading `decodedRef.current`.
   Refs may be read in effects (not during render); the existing
   `focusRingRef` pattern at `:143-148` is the precedent.
2. `create-app.ts` — after `extraCities` is complete (after the neighbour
   loop) add
   `const neighbourFootprints = extraCities.flatMap((c) => buildingFootprintPolys(c.data));`
   and change the handle to
   `getFootprints: () => [...buildingFootprintPolys(cityLayer.data), ...neighbourFootprints],`
   with a comment that neighbours are never demolished.

**Verify**: `bun typecheck && bun lint` → exit 0; `bunx playwright test e2e/city-walk.spec.ts`
→ the minimap click test still passes. Manual: in `bun dev`, demolish with
`R` — the minimap keeps its land-cover background (no blank-paper flash).

### Step 5: Null-safe rail properties and MultiPolygon rings

1. In `rail-layer.ts`, make every feature's `properties` nullable in the
   three interfaces (`| null`) and read them with `?.` and defaults:
   `f.properties?.deck ?? []`, `f.properties?.kind ?? "other"`,
   `f.properties?.structure ?? ""`, `f.properties?.tracks ?? 1`,
   `f.properties?.electrified ?? 0` (if read). A bridge with a missing or
   short `deck` is skipped by the existing `deck.length < ring.pts.length`
   check.
2. Extend `AreaFeature.geometry` to
   `{ coordinates: [number, number][] | [number, number][][] | [number, number][][][]; type: "LineString" | "MultiPolygon" | "Polygon" }`
   and add a small helper:

   ```ts
   /** Outer rings of a Polygon or MultiPolygon geometry (holes are ignored). */
   function outerRings(geometry: AreaFeature["geometry"]): [number, number][][] {
     if (geometry.type === "Polygon") {
       return [(geometry.coordinates as [number, number][][])[0]];
     }
     if (geometry.type === "MultiPolygon") {
       return (geometry.coordinates as [number, number][][][]).map((poly) => poly[0]);
     }
     return [];
   }
   ```

   Use it in `buildBallast` (iterate `outerRings(f.geometry)`, one
   `ringToWorld`/`clampRing`/`addFootprint` per ring) and in the Polygon
   branch of `buildPlatforms`.
3. Export `buildBallast` (`/** exported for tests */`) and create
   `app/_components/rail-layer.test.ts`: build a `RailContext`
   `{ offset: { cx: 0, cy: 0 }, heightAt: () => 100, bridgeUrls: [], platformUrls: [], railareaUrls: [], railUrls: [] }`;
   one square `Polygon` feature and one `MultiPolygon` with two squares →
   `buildBallast(features, ctx)` returns a `Mesh` whose geometry has more
   triangles for the MultiPolygon case than for the Polygon-only case; a
   feature with `properties: null` and a `Polygon` still yields a mesh.

**Verify**: `bun test app/_components/rail-layer.test.ts` → pass.
`bun test lib/city/tile.test.ts` (plan 008's fixture test) → still passes.
`bun run test:e2e` → the layer census still reports `rail.triangles > 0`.

### Step 6: WebGL2 preflight with a plain-language message

1. Create `app/_components/webgl-support.ts`:

   ```ts
   /** True when this browser can create a WebGL2 context (the one hard requirement). */
   export function hasWebGl2(): boolean {
     try {
       const probe = document.createElement("canvas");
       return probe.getContext("webgl2") !== null;
     } catch {
       return false;
     }
   }
   ```

2. In `city-walk.tsx`'s boot effect, before `createCityWalkApp(...)`:

   ```ts
       if (!hasWebGl2()) {
         setStatus({
           phase: "error",
           message:
             "This viewer needs WebGL2, which this browser or device does not provide. " +
             "Try a current desktop or mobile browser with hardware acceleration enabled.",
         });
         return;
       }
   ```

   (returning before `createCityWalkApp` means no handle and no cleanup are
   needed — the effect's return value is only reached when the app boots).

**Verify**: `bun typecheck && bun lint` → exit 0; `bun run test:e2e` → all
pass (SwiftShader provides WebGL2). Manual: in Chromium with
`--disable-gpu --disable-software-rasterizer` (or DevTools → Rendering →
"Emulate … WebGL disabled" where available) the Alert shows the new
sentence, not "Error creating WebGL context".

## Test plan

- `camera-flight.test.ts` (3 cases), `rail-layer.test.ts` (3 cases).
- e2e: the mid-flight snapshot test; existing minimap/demolish tests.
- Manual checks (no display on CI): stuck key (Step 2), minimap flash
  (Step 4), WebGL2 message (Step 6) — record the outcome in the PR.

## Done criteria

- [ ] `bun run verify` exits 0; `bun run test:e2e` exits 0 including "a snapshot applied mid-flight wins over the glide"
- [ ] `grep -c "cancelFlight();" app/_components/create-app.ts` → ≥ 5 (two existing + three new call sites)
- [ ] `grep -n "isTextEntry(e.target)" app/_components/create-app.ts` → 1 match (keydown only)
- [ ] `grep -c "statSync(destPath).size" scripts/prepare-data.ts` → 0
- [ ] `grep -n "decodedRef" app/_components/minimap.tsx` → ≥ 2 matches
- [ ] `grep -n "MultiPolygon" app/_components/rail-layer.ts` → ≥ 2 matches
- [ ] `grep -n "hasWebGl2" app/_components/city-walk.tsx` → 1 match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (and the 004 clause)

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- `SCENIC_VIEWS[0]` lies outside the primary tile's bounds
  (`412000–414000 E / 5656000–5658000 N`) — pick another entry that is inside.
- `buildBallast` cannot be exercised without WebGL (it should not need it —
  `meshFrom` creates a `MeshStandardMaterial` only).
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any future code that sets the camera pose from outside the movement system
  (a tour mode, a URL-state loader) must call `cancelFlight()` first — the
  three call sites added here are the pattern.
- The minimap now assumes `landcoverTiles` is stable across a session
  (module constants in `city-walk-client.tsx`); a future tile switcher must
  clear `decodedRef` when the tile block changes.
- Deferred, related: the joystick releases on any pointer-up regardless of
  `pointerId` (`virtual-joystick.tsx:53-64`), `dispose()` leaves splat
  textures and the shadow map to the GC, and `worldBounds.min.y` (used as a
  ground fallback) includes the 30 m terrain skirt — all LOW, listed in
  `plans/README.md`.
