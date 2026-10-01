# Plan 044: Ship the canopy points as a packed binary, not a 9.5 MB GeoJSON parsed in one long task

> **Executor instructions**: Follow the steps in order; step 1 is a
> measurement gate. Run every verification and honour the STOP conditions.
> The committed bake contract (`data/dlm/*.geojson`) does **not** change —
> only what `prepare-data.ts` publishes for the browser and how the browser
> reads it. When done, update this plan's row in `docs/plans/README.md`
> with the numbers.
>
> **Drift check (run first)**:
> `git diff --stat dd470e9..HEAD -- scripts/prepare-data.ts app/_components/tile-stream.ts app/_components/fetch-optional.ts lib/city/tile.ts lib/city/features.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — a published-artifact format change (the runtime is the only reader)
- **Depends on**: 037; best after 042 (both touch the boot's main-thread budget, no file overlap)
- **Category**: perf
- **Planned at**: commit `a28de75`, 2026-10-01; refreshed against `dd470e9` (main with ADR 0035)

## Why this matters

The tree point layers dominate what the browser parses per tile. The
canopy file of tile `33416_5658` is **9.5 MB** for 81 269 point features
(≈ 117 bytes each: `{"type":"Feature","properties":{"h":…},"geometry":{"type":"Point","coordinates":[…]}}`);
canopy + canopyx + trees are **52.7 MB of the 60 MB** of GeoJSON in
`data/dlm/`. Each is fetched as an optional artifact and parsed with one
`await res.json()` — a single long task that cannot be sliced (≈ 87 ms for
that file in V8 on this machine; several hundred ms plausible on a phone),
plus ≈ 325 k throwaway objects on heavy tiles while the phone's memory
governor is already busy. Wire size is fine (gzip takes 9.5 MB to
0.55 MB); this is CPU and heap. A packed little-endian Float32 layout is
≈ 12 bytes per point and costs nothing to parse.

## Current state

`scripts/prepare-data.ts:252-281` — the canopy and the laser-scan crowns
are already re-serialised at build time (points inside scan structures
dropped):

```ts
async function publishCanopy(tile: string, file: string): Promise<string> {
  const src = at(`data/dlm/${file}`);
  const sheds = at(cityMeshSourceFiles(tile).smallBuild);
  const bytes = await cached(file, cacheKey([src, sheds]), () => {
    const doc = readJson<FeatureCollection<CanopyFeature>>(src);
    if (!existsSync(sheds)) {
      return readFileSync(src);
    }
    const trees = doc.features ?? [];
    const structures = readJson<FeatureCollection<SmallBuildingFeature>>(sheds).features ?? [];
    const features = treesOffStructures(trees, structures);
    log(`${file}: ${trees.length - features.length} points in a scan structure dropped`);
    return utf8({ ...doc, features });
  });
  return publish(file, bytes);
}
```

(Find where it is called: `grep -n "publishCanopy" scripts/prepare-data.ts`
— for the `canopy` and `canopyx` kinds.) `publish(logical, content)`
returns the hashed name; the terrain's `extras.dressing[kind]` carries it
to the browser (`lib/city/tile.ts`: `canopy: { file: named("canopy", "geojson"), dressing: true }`,
`canopyx: { file: named("canopyx", "geojson"), dressing: true }`).

`lib/city/features.ts`:

```ts
export interface CanopyFeature {
  geometry: PointGeometry;
  properties: { h: number } | null;
}
export interface CanopyExtraFeature extends CanopyFeature {
  properties: { h: number; r: number } | null;
}
```

`app/_components/tile-stream.ts:432-436, 456, 475, 493`:

```ts
  const get = <T>(kind: DressingKind): Features<T> => {
    const file = d[kind];
    return file ? fetchFeatures<T>(url(file), signal) : Promise.resolve([]);
  };
  ...
    canopy: get<CanopyFeature>("canopy"),
  ...
    scanTrees: get<CanopyExtraFeature>("canopyx"),
  ...
      canopy: offMonuments([...canopy, ...scanTrees], monuments),
```

`app/_components/fetch-optional.ts` holds the one optional-artifact fetch
policy (404/network/parse error → "feature off" = empty; an abort is
rethrown). Match it.

Precision: a Float32 holds EPSG northings (~5.6 M) only to ~0.5 m — store
coordinates **relative to the tile's south-west corner** (0…2000 m →
~0.1 mm), with the origin in a Float64 header.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `bun run test` | all pass |
| Build the tileset | `bun scripts/prepare-data.ts` | exit 0 (writes only gitignored `public/data`, `.cache`) |
| Gate | `bun run fix && bun run verify` | exit 0 |
| E2E census | `bunx playwright test e2e/city-walk.spec.ts -g "every scene layer"` | pass (vegetation instances > 1000) |

## Scope

**In scope**: `scripts/prepare-data.ts` (`publishCanopy`),
`lib/city/point-pack.ts` (create: pure encode/decode) + test,
`app/_components/fetch-optional.ts` (a binary variant),
`app/_components/tile-stream.ts` (the two `get` calls),
`docs/data-pipeline.md` (the published artifact table row for canopy/canopyx).

**Out of scope**: the committed GeoJSON and the Python bakes; the
street-tree cadastre (`trees`, many properties — a possible phase 2 after
the numbers); rewriting the vegetation consumers to iterate typed arrays
(phase 2, only if step 4's numbers say the object creation still matters).

## Git workflow

Branch `claude/044-tree-points-binary`; commits: `perf(data): pack the canopy points`,
`perf(dressing): read the packed canopy`. No push unless instructed.

## Steps

### Step 1: Measure (gate)

In a desktop browser with `bun dev`, add a temporary
`performance.now()` around the `fetchFeatures` parse for `canopy` (or use
the Performance panel) on a tile with a big canopy (fly to `33416_5658`).
Record the parse time. If it is **under 25 ms**, STOP and report — not
worth a format change.

### Step 2: The pack format (pure, tested)

`lib/city/point-pack.ts` (DOM-free, no three; `lib/city/purity.test.ts`
enforces it):

```
bytes 0–3   "PTS1" (ASCII magic)
bytes 4–7   uint32 count
bytes 8–11  uint32 stride (floats per point: 3 = x, y, h; 4 = x, y, h, r)
bytes 12–15 reserved (0)
bytes 16–31 float64 originX, float64 originY
bytes 32…   float32 × count × stride, little-endian; x, y relative to the origin
```

Exports: `packPoints(points: { x: number; y: number; h: number; r?: number }[], origin: [number, number], stride: 3 | 4): Uint8Array`
and `unpackPoints(buffer: ArrayBuffer): { origin: [number, number]; stride: number; count: number; data: Float32Array } | null`
(null on a bad magic/length). Unit tests: round trip of a few points
(coordinates back within 1e-3 m after adding the origin), stride 4 keeps
`r`, a truncated buffer → null, a wrong magic → null, zero points.

**Verify**: `bun test lib/city/point-pack.test.ts` → all pass;
`bun test lib/city/purity.test.ts` → pass.

### Step 3: Publish packed, read packed

1. `publishCanopy`: build the filtered feature list as today, then
   `packPoints` with the tile's SW corner as origin (the tile's bounds are
   available in prepare-data — find how other code gets them, e.g.
   `tileExtentOf`) and stride 3 for `canopy`, 4 for `canopyx` (`r` from
   properties). Publish under the logical name with a `.pts` extension
   instead of `.geojson` (e.g. `canopy_<tile>.pts`). The cache entry name
   must change with it (`cached(file.replace(/\.geojson$/u, ".pts"), …)`)
   so an old cached GeoJSON is never served as packed.
2. `fetch-optional.ts`: add `fetchOptionalBinary(url, signal): Promise<ArrayBuffer | null>`
   with the same policy as `fetchOptionalJson`.
3. `tile-stream.ts`: a `getPoints<T>(kind)` that fetches the binary,
   `unpackPoints`, and turns it into the existing feature objects
   (`{ geometry: { type: "Point", coordinates: [x + ox, y + oy] }, properties: { h } }`
   / `{ h, r }`) so every consumer stays unchanged. Use it for `canopy`
   and `canopyx`. A null unpack = feature off (empty list).
4. Update the canopy/canopyx row in `docs/data-pipeline.md`'s published
   artifacts table (format, size).

**Verify**: `bun scripts/prepare-data.ts` → exit 0; `ls public/data | grep -c "\.pts$"` → 2 per tile with a canopy;
`bun run verify` → exit 0; e2e "every scene layer is built on the primary
tile" passes (vegetation instances > 1000).

### Step 4: Measure again

Repeat step 1's measurement on the same tile (now: fetch → unpack →
feature objects). Record before/after in the status row, plus the
published sizes (raw and gzipped: `gzip -c public/data/canopy_33416_5658*.pts | wc -c`).
Remove the temporary instrumentation.

## Test plan

- `lib/city/point-pack.test.ts`: round trip, stride 4, truncated, bad
  magic, empty.
- E2E layer census guards that the canopy still plants.

## Done criteria

- [ ] Step 1 and step 4 numbers recorded
- [ ] `bun run verify` exits 0; `bun scripts/prepare-data.ts` exits 0
- [ ] `lib/city/point-pack.ts` + test exist; purity test passes
- [ ] `grep -n "getPoints" app/_components/tile-stream.ts` → used for canopy and canopyx
- [ ] Committed `data/` unchanged (`git status data/` clean)

## STOP conditions

- Step 1 gate (< 25 ms).
- The published name of a kind is assumed to end in `.geojson` somewhere
  in the runtime or the tests (`grep -rn "geojson" app/_components lib/city/tile.ts`)
  in a way that would need more than the two `get` calls changed → stop
  and list the places.
- Unpacked coordinates differ from the GeoJSON's by more than 1 mm in a
  spot check of one tile → stop.

## Maintenance notes

- Phase 2 options, if step 4 still shows a long task: hand `Float32Array`
  views to `collectCanopy`/`offMonuments` instead of objects; pack the
  cadastre (`trees`) with a small column set.
- Any new consumer of `canopy`/`canopyx` reads them through `getPoints`.
