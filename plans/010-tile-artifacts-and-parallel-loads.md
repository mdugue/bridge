# Plan 010: One tile artifact map, one optional-fetch policy, parallel per-tile loads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2079c3a..HEAD -- lib/city/tile.ts lib/city/tile.test.ts scripts/prepare-data.ts app/_components/city-walk-client.tsx app/_components/city-walk.tsx app/_components/create-app.ts app/_components/terrain-layer.ts app/_components/vegetation-layer.ts app/_components/wall-layer.ts app/_components/rail-layer.ts app/_components/lamp-layer.ts`
> Plans 008 and 009 touch `create-app.ts`, `vegetation-layer.ts` and add
> `lib/city/tile.test.ts` — expected drift. For everything else, compare the
> "Current state" excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/008-verification-net.md (its fixture test and layer census are the safety net); run after 009 (both edit `create-app.ts`)
- **Category**: tech-debt / perf
- **Planned at**: commit `2079c3a`, 2026-09-20

## Why this matters

`lib/city/tile.ts` is documented as "the one place a tile id is written",
but it names only 3 of the 15 per-tile artifacts. The other 12 are spelled
as template literals in `city-walk-client.tsx` and again in
`scripts/prepare-data.ts`, and four are *derived at runtime by string
replacement* in `create-app.ts` and `terrain-layer.ts` (`landcover_`→`walls_`,
`vegrows_`→`canopy_`, `vegrows_`→`ndvi_`, `lod2_`→`roofcolor_`). A typo in any
of them degrades silently to "feature off", because every optional loader
swallows its 404. The wall file is derived twice and therefore fetched and
parsed twice per tile.

The optional loaders also disagree on aborts: `fetchFeatures` and
`loadWallLines` swallow `AbortError` and return `[]`, so after a StrictMode
remount or navigation the doomed instance keeps building rail, wall and lamp
geometry from partial data until the next `ensureAlive()` throws. Two other
loaders rethrow aborts correctly. And the boot path awaits everything
serially: primary CityJSON, then roof LUT, then terrain, vegetation, lamps,
then each neighbour tile in a `for` loop — ~34 dependent round trips with no
overlap between network transfer and main-thread parsing.

After this plan: `tileArtifacts()` in `lib/city/tile.ts` is the single map
(with a unit test that `prepare-data` and the client agree), `TileSrc` carries
every URL explicitly, one `fetchOptionalJson` helper implements one abort
policy, walls are fetched once, and the three neighbour tiles fetch and
build concurrently.

## Current state

### The three spellings and the four derivations

`lib/city/tile.ts:41-52`:

```ts
/** Files served from /data (= public/data/), all derived from the tile id. */
export function cityJsonFile(tile: string): string {
  return `lod2_${tile}.city.json`;
}

export function heightfieldHeaderFile(tile: string, n: number): string {
  return `dgm1_${tile}.heightfield-${n}.json`;
}

export function heightfieldDataFile(tile: string, n: number): string {
  return `dgm1_${tile}.heightfield-${n}.f32`;
}
```

`app/_components/city-walk-client.tsx:23-38`:

```ts
/** Builds the per-tile URLs (all prepared by scripts/prepare-data.ts). */
function tile({ tile: name, n }: TileSpec): TileSrc {
  return {
    citySrc: `/data/${cityJsonFile(name)}`,
    demSrc: `/data/${heightfieldHeaderFile(name, n)}`,
    landcoverSrc: `/data/landcover_${name}.png`,
    vegetationSrc: `/data/vegrows_${name}.geojson`,
    // Optional (OSM, ODbL); the loader treats a 404 as "no lamps".
    lampsSrc: `/data/lamps_${name}.geojson`,
    // Railway tracks + bridge decks + ballast yards (Basis-DLM); platforms (OSM).
    railSrc: `/data/rail_${name}.geojson`,
    bridgeSrc: `/data/bridge_${name}.geojson`,
    railareaSrc: `/data/railarea_${name}.geojson`,
    platformSrc: `/data/platform_${name}.geojson`,
  };
}
```

and `:40-62` builds `PRIMARY`/`EXTRA_TILES` and passes the primary's fields
as ten separate props to `<CityWalk>`.

`scripts/prepare-data.ts:38-69` builds `copies` (required: cityjson,
`landcover_`, `landcover_rgb_`, `vegrows_`, `canopy_`) and `optionalCopies`
(`lamps_`, `roofcolor_` from `data/dop`, `ndvi_`, `rail_`, `bridge_`,
`railarea_`, `platform_`, `walls_`) from `TILE_BLOCK`, each as a
`[src, dest]` literal pair.

Runtime derivations:

- `app/_components/create-app.ts:368-377` (`fetchRoofLut`):
  `citySrc.replace("lod2_", "roofcolor_").replace(".city.json", ".json")`.
- `create-app.ts:557-559` (`loadTileScene`):
  `wallLinesUrl: tile.landcoverSrc?.replace("landcover_", "walls_").replace(".png", ".geojson")`.
- `create-app.ts:576-579`: `canopyUrl: tile.vegetationSrc.replace("vegrows_", "canopy_")`
  and `ndviUrl: tile.vegetationSrc.replace("vegrows_", "ndvi_").replace(".geojson", ".png")`.
- `create-app.ts:699-704`: `wallUrls` derived from every tile's
  `landcoverSrc` a second time (for `loadWalls`).
- `app/_components/terrain-layer.ts:29-30, 107-115`:
  `LANDCOVER_PREFIX = /landcover_/`, `colorSplatUrl` (→ `landcover_rgb_`) and
  `ndviSplatUrl` (→ `ndvi_`), used at `:443-449`.

### The `TileSrc` / options shape

`app/_components/create-app.ts:128-145`:

```ts
/** A neighbouring tile loaded for visual context (no collision/demolish). */
export interface TileSrc {
  /** optional baked bridge-deck GeoJSON (Basis-DLM + DGM/DOM1 heights) */
  bridgeSrc?: string;
  citySrc: string;
  /** URL of this tile's heightfield header JSON (see lib/city/heightfield.ts) */
  demSrc: string;
  /** optional OSM street-lamp GeoJSON (ODbL); absent/404 = no lamps */
  lampsSrc?: string;
  landcoverSrc?: string;
  /** optional OSM station-platform GeoJSON (ODbL) */
  platformSrc?: string;
  /** optional baked dissolved ballast-area GeoJSON (Basis-DLM ver03_f) */
  railareaSrc?: string;
  /** optional baked railway-track GeoJSON (Basis-DLM ver03_l, heavy rail) */
  railSrc?: string;
  vegetationSrc?: string;
}
```

`CityWalkOptions` (`:147-184`) repeats the same nine `*Src` fields at top
level for the primary tile, plus `container`, `extraTiles`, `initialDate`,
`insertAt`, `insertedModelUrl`, the `on*` callbacks and `signal`. The HUD's
`Props` (`city-walk.tsx:123-146`) repeats them a third time and forwards them
one by one (`city-walk.tsx:1100-1112`), listing all of them in the effect's
dependency array (`:1225-1237`).

Inside `bootApp` the primary tile is re-folded into a `TileSrc` for
`loadTileScene` (`:606-612`), and again for the rail URL lists (`:661-669`).

### The loaders' fetch/abort behaviour

`app/_components/vegetation-layer.ts:753-767` (imported by `rail-layer.ts:13`,
`wall-layer.ts:11`, `lamp-layer.ts:21`):

```ts
export async function fetchFeatures<T>(
  url: string,
  signal?: AbortSignal
): Promise<T[]> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { features?: T[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}
```

`app/_components/terrain-layer.ts:161-207`: `loadWallLines(url, signal)` has
the same swallow-everything shape and maps features to
`WallLine { coords, kind }`; `conflateTerrain(base, grid, wallLinesUrl, signal)`
calls it. `loadTerrain` (`:407-427`) takes `wallLinesUrl` in `TerrainOptions`
(`:65`).

By contrast `fetchRoofLut` (`create-app.ts:368-391`) and `loadNdviSampler`
(`vegetation-layer.ts:713-751`) rethrow when
`err instanceof DOMException && err.name === "AbortError"`.

`app/_components/wall-layer.ts:24-36` (`WallFeature` is not exported;
`WallContext.wallUrls: string[]`) and `:190-197`:

```ts
export async function loadWalls(ctx: WallContext): Promise<WallControl> {
  const group = new Group();
  group.name = "walls";

  const all = await Promise.all(
    ctx.wallUrls.map((u) => fetchFeatures<WallFeature>(u, ctx.signal))
  );
  const features = all.flat();
```

`lib/city/terrain-conflate.ts` exports `WallLine` (`coords: [number, number][]`,
`kind: string`) and `conflateWalls`.

### The serial boot

`app/_components/create-app.ts:505-512`:

```ts
  opts.onProgress?.("Loading CityJSON tile…");
  const cityData = await fetchCityJson(opts.citySrc, opts.signal);
  const roofLut = await fetchRoofLut(opts.citySrc, opts.signal);
  ensureAlive();

  opts.onProgress?.("Parsing buildings…");
  let cityLayer: CityLayer = createCityLayer(cityData, world, null, roofLut);
  const offset = recenterOffset(cityLayer.matrix);
```

`:550-603` defines `loadTileScene(tile)` (terrain → vegetation → lamps,
each awaited in turn, adding to `world`/`scene` and pushing to
`vegControls`/`lampControls`); `:605-614` loads the primary and calls
`assertCityOnTerrain(offset, terrain)`; `:619-633`:

```ts
  const terrains: TerrainLayer[] = [terrain];
  const extraCities: CityLayer[] = [];
  for (const tile of neighbourTiles) {
    opts.onProgress?.("Loading neighbouring tiles…");
    const data = await fetchCityJson(tile.citySrc, opts.signal);
    const tileRoofLut = await fetchRoofLut(tile.citySrc, opts.signal);
    ensureAlive();
    extraCities.push(
      createCityLayer(data, world, cityLayer.matrix, tileRoofLut)
    );
    // Neighbours are background — their heightfield is baked at half the
    // primary's resolution (~4 m), see lib/city/tile.ts.
    terrains.push(await loadTileScene(tile));
    ensureAlive();
  }
```

`landcoverTiles` (`:735-747`) pairs `neighbourTiles[i]` with
`terrains[i + 1]` by index — the order of `terrains` must match
`neighbourTiles`.

### Conventions

- `lib/city/` is three-free and DOM-free (a `fetch` wrapper belongs in
  `app/_components/`, not there). Unit tests colocated; model data tests on
  `lib/city/tfw.test.ts`, three-importing tests on
  `app/_components/visual-style.test.ts`.
- `TileSpec` is `{ tile: string; n: number }` (`lib/city/tile.ts:29-33`).
- Conventional Commits, e.g. `refactor: keep only the clay building style`,
  `perf: bake the DGM into a heightfield at build time`.
- Plan 008's `lib/city/tile.test.ts` lists artifact file names literally;
  Step 1 switches it to the new map.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Full gate | `bun run verify` | exit 0 |
| Build (runs prepare-data) | `bun run build` | exit 0; `public/data/` populated |
| Prepare only | `bun scripts/prepare-data.ts` | exit 0 |
| E2E | `bun run test:e2e` | all pass |

## Suggested executor toolkit

- Load the `city-walker` skill ("Scene architecture", "Data pipeline") before
  Step 3.

## Scope

**In scope**:

- `lib/city/tile.ts`, `lib/city/tile.test.ts`
- `scripts/prepare-data.ts`
- `app/_components/fetch-optional.ts` (create) + `fetch-optional.test.ts` (create)
- `app/_components/city-walk-client.tsx`
- `app/_components/city-walk.tsx` (only `Props`, the `createCityWalkApp` call and its effect deps)
- `app/_components/create-app.ts` (`TileSrc`, `CityWalkOptions`, `fetchRoofLut`, `loadTileScene`, the tile loop, the rail/wall URL assembly)
- `app/_components/terrain-layer.ts` (`TerrainOptions`, the URL helpers, `loadWallLines`/`conflateTerrain`, the texture loads)
- `app/_components/vegetation-layer.ts` (remove `fetchFeatures`)
- `app/_components/wall-layer.ts` (`WallContext`, `loadWalls`, export `WallFeature`)
- `app/_components/rail-layer.ts`, `app/_components/lamp-layer.ts` (import path only)
- `docs/portability.md` step 5 (one line)

**Out of scope**:

- `e2e/city-walk.spec.ts:280` hard-codes the primary CityJSON URL — leave it.
- Any change to what the loaders *build*, to `heightAt`, to the layer
  interfaces, or to `bootApp`'s post-load sections (sun rig, style, controls).
- Streaming the neighbours after the first frame (deferred; see README).
- `components/ui/**`, `data/**`.

## Git workflow

- Branch: `advisor/010-tile-artifacts-and-parallel-loads`.
- One commit per step; `refactor:` for Steps 1–5, `perf:` for Step 6.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The artifact map in `lib/city/tile.ts`

Append to `lib/city/tile.ts`:

```ts
/** Where a committed source lives under data/ (null = generated by prepare-data). */
export type ArtifactSource = "cityjson" | "dgm" | "dlm" | "dop" | null;

export interface TileArtifact {
  /** file name under public/data (= the URL's last segment) */
  file: string;
  /** false = the loader treats a 404 as "feature off" */
  required: boolean;
  source: ArtifactSource;
}

export type TileArtifactKind =
  | "bridge"
  | "canopy"
  | "city"
  | "heightfieldData"
  | "heightfieldHeader"
  | "lamps"
  | "landcover"
  | "landcoverRgb"
  | "ndvi"
  | "platform"
  | "rail"
  | "railarea"
  | "roofColor"
  | "vegrows"
  | "walls";

/**
 * Every file the viewer may request for a tile — the ONE list that
 * scripts/prepare-data.ts copies and city-walk-client.tsx requests. Add an
 * artifact here, nowhere else.
 */
export function tileArtifacts(spec: TileSpec): Record<TileArtifactKind, TileArtifact> {
  const { tile, n } = spec;
  const dlm = (file: string, required = false): TileArtifact => ({ file, required, source: "dlm" });
  return {
    city: { file: cityJsonFile(tile), required: true, source: "cityjson" },
    heightfieldHeader: { file: heightfieldHeaderFile(tile, n), required: true, source: null },
    heightfieldData: { file: heightfieldDataFile(tile, n), required: true, source: null },
    landcover: dlm(`landcover_${tile}.png`, true),
    landcoverRgb: dlm(`landcover_rgb_${tile}.png`, true),
    vegrows: dlm(`vegrows_${tile}.geojson`, true),
    canopy: dlm(`canopy_${tile}.geojson`, true),
    ndvi: dlm(`ndvi_${tile}.png`),
    lamps: dlm(`lamps_${tile}.geojson`),
    rail: dlm(`rail_${tile}.geojson`),
    bridge: dlm(`bridge_${tile}.geojson`),
    railarea: dlm(`railarea_${tile}.geojson`),
    platform: dlm(`platform_${tile}.geojson`),
    walls: dlm(`walls_${tile}.geojson`),
    roofColor: { file: `roofcolor_${tile}.json`, required: false, source: "dop" },
  };
}

/** The same map as URLs under `base` (default: the /data route). */
export function tileUrls(spec: TileSpec, base = "/data"): Record<TileArtifactKind, string> {
  const out = {} as Record<TileArtifactKind, string>;
  for (const [kind, artifact] of Object.entries(tileArtifacts(spec))) {
    out[kind as TileArtifactKind] = `${base}/${artifact.file}`;
  }
  return out;
}
```

Also export the DGM source path the bake reads, so `prepare-data.ts` stops
spelling it: `export function dgmSourceFiles(tile: string): { tif: string; tfw: string }`
returning `data/dgm/dgm1_${tile}_tiff/dgm1_${tile}.tif` / `.tfw` (relative
to the repo root).

In `lib/city/tile.test.ts` (created by plan 008) add a table test that the
map reproduces today's names for the primary spec `{ tile: "33412_5656_2_sn", n: 1024 }`:
`city` → `lod2_33412_5656_2_sn.city.json`, `heightfieldHeader` →
`dgm1_33412_5656_2_sn.heightfield-1024.json`, `walls` →
`walls_33412_5656_2_sn.geojson`, `roofColor` → `roofcolor_33412_5656_2_sn.json`,
`ndvi` → `ndvi_33412_5656_2_sn.png`, `landcoverRgb` →
`landcover_rgb_33412_5656_2_sn.png`; that exactly 7 kinds are `required`;
that `tileUrls(spec).canopy === "/data/canopy_33412_5656_2_sn.geojson"`.
Then switch the fixture-integrity test's file list to iterate
`tileArtifacts(spec)` (source `!== null`) plus `dgmSourceFiles(tile)`.

**Verify**: `bun test lib/city/tile.test.ts` → all pass.

### Step 2: `prepare-data.ts` consumes the map

Replace the `copies` / `optionalCopies` literals (`scripts/prepare-data.ts:42-69`)
with lists derived from `tileArtifacts`:

```ts
const artifacts = TILE_BLOCK.flatMap((spec) =>
  Object.values(tileArtifacts(spec)).filter((a) => a.source !== null)
);
const copies: [string, string][] = artifacts
  .filter((a) => a.required)
  .map((a) => [`data/${a.source}/${a.file}`, join(OUT_DIR, a.file)]);
const optionalCopies: [string, string][] = artifacts
  .filter((a) => !a.required)
  .map((a) => [`data/${a.source}/${a.file}`, join(OUT_DIR, a.file)]);
```

and use `dgmSourceFiles(tile)` in `bakeHeightfield` (`:194-201`). Keep the
copy loops and the heightfield bake unchanged otherwise. Update the comment
at `:34-37`.

**Verify**: `rm -rf public/data && bun scripts/prepare-data.ts` → exit 0;
`ls public/data | wc -l` → 60 (4 tiles × 13 copied artifacts + 4 × 2
heightfield files). `bun typecheck && bun lint` → exit 0.

### Step 3: `TileSrc` carries every URL; the primary is a `TileSrc`

1. In `create-app.ts`, extend `TileSrc` with (alphabetical, with one-line
   doc comments in the existing style): `canopySrc?`, `landcoverRgbSrc?`,
   `ndviSrc?`, `roofColorSrc?`, `wallsSrc?`.
2. Replace the nine top-level `*Src` fields of `CityWalkOptions` with one
   `/** the spawn tile: walked on, collided with, demolished from */ primary: TileSrc;`
   (keep `container`, `extraTiles`, `initialDate`, `insertAt`,
   `insertedModelUrl`, the callbacks and `signal`). Inside `bootApp` read
   `opts.primary.citySrc` etc.; the `loadTileScene({ citySrc: opts.citySrc, … })`
   re-fold at `:606-612` becomes `loadTileScene(opts.primary)`, and the
   rail/wall URL lists at `:661-704` become
   `const allTiles = [opts.primary, ...neighbourTiles];` with
   `allTiles.map((t) => t.railSrc)…` / `allTiles.map((t) => t.wallsSrc)…`.
3. `fetchRoofLut(citySrc, signal)` → `fetchRoofLut(url: string | undefined, signal)`:
   return `undefined` when `url` is undefined; delete the `replace` lines.
   Callers pass `tile.roofColorSrc`.
4. `loadTileScene`: pass `landcoverRgbUrl: tile.landcoverRgbSrc`,
   `ndviUrl: tile.ndviSrc` to `loadTerrain` (see Step 4 for the option
   names), `canopyUrl: tile.canopySrc`, `ndviUrl: tile.ndviSrc` to
   `loadVegetation`; delete every `.replace(` on a URL in `create-app.ts`.
5. `city-walk-client.tsx`: build each `TileSrc` from `tileUrls(spec)`:

   ```ts
   function tile(spec: TileSpec): TileSrc {
     const u = tileUrls(spec);
     return {
       citySrc: u.city,
       demSrc: u.heightfieldHeader,
       landcoverSrc: u.landcover,
       landcoverRgbSrc: u.landcoverRgb,
       ndviSrc: u.ndvi,
       vegetationSrc: u.vegrows,
       canopySrc: u.canopy,
       lampsSrc: u.lamps,
       railSrc: u.rail,
       bridgeSrc: u.bridge,
       railareaSrc: u.railarea,
       platformSrc: u.platform,
       wallsSrc: u.walls,
       roofColorSrc: u.roofColor,
     };
   }
   ```

   and render `<CityWalk extraTiles={EXTRA_TILES} primary={PRIMARY} />`.
6. `city-walk.tsx`: `Props` becomes `{ extraTiles?: TileSrc[]; insertedModelUrl?: string; primary: TileSrc }`;
   pass `primary` through to `createCityWalkApp`; the effect dependency
   array becomes `[primary, extraTiles, insertedModelUrl]`.

**Verify**: `bun typecheck && bun lint` → exit 0.
`grep -n '\.replace("' app/_components/create-app.ts` → 0 matches.

### Step 4: One optional-fetch helper, one abort policy

1. Create `app/_components/fetch-optional.ts`:

   ```ts
   /** True for the DOMException a fetch throws when its AbortSignal fires. */
   export function isAbortError(err: unknown): boolean {
     return err instanceof DOMException && err.name === "AbortError";
   }

   /**
    * Fetches an OPTIONAL artifact. A 404, a network failure or unparseable
    * JSON means "feature off" and yields null; an abort is never swallowed —
    * the doomed instance (StrictMode remount, navigation away) must stop
    * building geometry from partial data, and the caller's ensureAlive()
    * relies on the rejection.
    */
   export async function fetchOptionalJson<T>(
     url: string,
     signal?: AbortSignal
   ): Promise<T | null> {
     try {
       const res = await fetch(url, { signal });
       if (!res.ok) {
         return null;
       }
       return (await res.json()) as T;
     } catch (err) {
       if (isAbortError(err)) {
         throw err;
       }
       return null;
     }
   }

   /** The `features` of an optional GeoJSON FeatureCollection, or []. */
   export async function fetchFeatures<T>(
     url: string | undefined,
     signal?: AbortSignal
   ): Promise<T[]> {
     if (!url) {
       return [];
     }
     const doc = await fetchOptionalJson<{ features?: T[] }>(url, signal);
     return doc?.features ?? [];
   }
   ```

2. Create `app/_components/fetch-optional.test.ts`. Stub `globalThis.fetch`
   per test (save and restore it in `beforeEach`/`afterEach`): ok JSON →
   parsed object; `{ ok: false, status: 404 }` → `null`; a rejecting fetch
   (`new TypeError("network")`) → `null`; a rejecting fetch with
   `new DOMException("aborted", "AbortError")` → the promise **rejects** with
   that error; `fetchFeatures(undefined)` → `[]`; `fetchFeatures` on
   `{ features: [1, 2] }` → `[1, 2]`.
3. Delete `fetchFeatures` from `vegetation-layer.ts` (`:753-767`) and import
   it from `./fetch-optional` there and in `rail-layer.ts`, `wall-layer.ts`,
   `lamp-layer.ts`. Replace the body of `fetchRoofLut` in `create-app.ts`
   with `fetchOptionalJson<{ roofs?: RoofColorLut }>` (`doc?.roofs`).
4. In `terrain-layer.ts`, replace `loadWallLines` with a pure mapper
   `wallLinesFrom(features: WallFeature[]): WallLine[]` and make
   `TerrainOptions` take `wallLines?: WallLine[]` instead of `wallLinesUrl`;
   `conflateTerrain` becomes synchronous over the given lines. Rename the
   URL options: `landcoverUrl` stays, add `landcoverRgbUrl?` and `ndviUrl?`,
   and delete `LANDCOVER_PREFIX`, `colorSplatUrl`, `ndviSplatUrl` (`:29-30`,
   `:107-115`); `:443-449` loads the two optional textures only when their
   URL is given.
5. In `wall-layer.ts`, export `WallFeature`, and change `WallContext.wallUrls: string[]`
   to `wallFeatures: WallFeature[]` (already fetched). `loadWalls` drops its
   `Promise.all` fetch and uses `ctx.wallFeatures` directly.

**Verify**: `bun test app/_components/fetch-optional.test.ts` → 6 pass.
`grep -rn "export async function fetchFeatures" app/_components/` → only
`fetch-optional.ts`. `grep -n "wallLinesUrl\|LANDCOVER_PREFIX" app/_components/` → 0.

### Step 5: Fetch each tile's walls once and hand them to both consumers

In `bootApp`, inside `loadTileScene` (before `loadTerrain`):

```ts
    // OSM walls feed two consumers — the heightfield step (conflation) and
    // the ribbon geometry — so fetch them once per tile.
    const wallFeatures = await fetchFeatures<WallFeature>(tile.wallsSrc, opts.signal);
    const t = await loadTerrain({
      ...,
      wallLines: wallLinesFrom(wallFeatures),
      ...
    });
```

Return the features alongside the terrain (change `loadTileScene`'s return
type to `{ terrain: TerrainLayer; wallFeatures: WallFeature[] }`, or keep a
`wallFeaturesByTile: WallFeature[][]` array in tile order). After all tiles
are loaded, build the walls once:

```ts
  const wallFeatures = wallFeaturesByTile.flat();
  if (wallFeatures.length > 0) {
    opts.onProgress?.("Building walls…");
    const walls = await loadWalls({ offset, heightAt, wallFeatures, signal: opts.signal, heightFog });
    ...
  }
```

Delete the `wallUrls` derivation (`:699-704`). Export `wallLinesFrom` from
`terrain-layer.ts` for this.

**Verify**: `bun typecheck && bun lint` → exit 0; `bun run test:e2e` → all
pass, including plan 008's layer census (`walls.triangles > 0`).

### Step 6: Load the neighbours concurrently

Replace `create-app.ts:505-508` with:

```ts
  opts.onProgress?.("Loading CityJSON tile…");
  const [cityData, roofLut] = await Promise.all([
    fetchCityJson(opts.primary.citySrc, opts.signal),
    fetchRoofLut(opts.primary.roofColorSrc, opts.signal),
  ]);
  ensureAlive();
```

and the neighbour loop (`:619-633`) with:

```ts
  const terrains: TerrainLayer[] = [terrain];
  const extraCities: CityLayer[] = [];
  if (neighbourTiles.length > 0) {
    opts.onProgress?.("Loading neighbouring tiles…");
    // Fetch every neighbour's documents at once (network overlaps the
    // main-thread parse below), then parse in tile order so the batched
    // meshes are deterministic.
    const docs = await Promise.all(
      neighbourTiles.map((tile) =>
        Promise.all([
          fetchCityJson(tile.citySrc, opts.signal),
          fetchRoofLut(tile.roofColorSrc, opts.signal),
        ])
      )
    );
    ensureAlive();
    for (const [data, tileRoofLut] of docs) {
      extraCities.push(createCityLayer(data, world, cityLayer.matrix, tileRoofLut));
    }
    // Terrain / water / vegetation / lamps per neighbour, concurrently.
    // Promise.all preserves order, which landcoverTiles below relies on.
    const scenes = await Promise.all(neighbourTiles.map(loadTileScene));
    ensureAlive();
    terrains.push(...scenes.map((s) => s.terrain));
    wallFeaturesByTile.push(...scenes.map((s) => s.wallFeatures));
  }
```

(`loadTileScene` pushes to `vegControls`/`lampControls` itself; their order
does not matter. `world.add`/`scene.add` order does not matter either.)

**Verify**: `bun run verify` → exit 0. `bun run build` → exit 0.
`bun run test:e2e` → all pass. Then, with `bun dev` running, open
`http://localhost:3000/` in a browser once: the scene boots with all four
tiles, the walls and rails are present, and the DevTools Network panel shows
the three neighbours' `lod2_*.city.json` requests starting within the same
~100 ms (previously each started after the previous tile finished). Record
the "DOMContentLoaded → `__poc.ready`" time before and after in the PR.

### Step 7: Docs

`docs/portability.md` step 5 (lines 51–52) says to list the tiles in
`scripts/prepare-data.ts (TILES)`; change it to `lib/city/tile.ts`
(`TILE_BLOCK`) and add: "new per-tile artifacts go into `tileArtifacts()` in
the same file — `prepare-data.ts` and the client both read it".

**Verify**: `grep -n "tileArtifacts" docs/portability.md` → 1 match.

## Test plan

- `lib/city/tile.test.ts`: the artifact-name table test + the fixture test
  now driven by the map.
- `app/_components/fetch-optional.test.ts`: 6 cases (ok, 404, network error,
  abort rethrown, undefined URL, features unwrapping).
- e2e: plan 008's layer census proves walls/rail/vegetation/lamps still
  build; the demolish and snapshot tests prove the primary tile is intact.
- `bun run verify` and `bun run test:e2e` green; one manual boot in `bun dev`.

## Done criteria

- [ ] `bun run verify` exits 0; `bun run build` exits 0; `bun run test:e2e` exits 0
- [ ] `grep -rn 'replace("landcover_\|replace("vegrows_\|replace("lod2_' app/ scripts/` → 0 matches
- [ ] `grep -rn "fetchFeatures" app/_components/*.ts | grep -v "fetch-optional" | grep -c "import"` → 4 (vegetation, rail, wall, lamp import it) and no other definition exists
- [ ] `grep -n "wallLinesUrl\|wallUrls" app/_components/*.ts` → 0 matches
- [ ] `grep -n "primary: TileSrc" app/_components/create-app.ts app/_components/city-walk.tsx` → 2 matches
- [ ] `grep -n "Promise.all(neighbourTiles.map" app/_components/create-app.ts` → 2 matches
- [ ] `ls public/data | wc -l` → 60 after `bun scripts/prepare-data.ts`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts
  (beyond the expected drift from plans 008/009).
- A loader turns out to derive a URL by a mechanism not listed here.
- After Step 6 the e2e layer census reports a missing layer, or a manual boot
  shows a tile misaligned (the shared `offset` must still come from the
  primary's matrix before any neighbour is parsed — check that ordering if so).
- `bun scripts/prepare-data.ts` produces a different file count than 60.
- Anything requires touching `bootApp` beyond the load path.

## Maintenance notes

- Adding a per-tile artifact is now: one entry in `tileArtifacts()`, one
  field on `TileSrc`, one line in `city-walk-client.tsx`'s mapper, and its
  use in a loader. The fixture test in `lib/city/tile.test.ts` picks the file
  up automatically; add its geometry/property checks there.
- The abort policy is: **required** artifacts throw on any failure
  (`fetchCityJson`, the heightfield fetches); **optional** ones return
  `null`/`[]` on 404/network/parse and **rethrow aborts**. Reviewers should
  reject a new loader that catches everything.
- `TextureLoader.loadAsync` (the three splat textures) still cannot take an
  `AbortSignal`; that is a three.js limitation, noted, not fixed here.
- Deferred, in leverage order: streaming the three neighbours *after* the
  first frame (needs a "primary ready" vs "block ready" split of
  `__poc.ready`); replacing the terrain BVH with a heightfield ray-march;
  decoding the 4096² splats via `ImageBitmapLoader`. See `plans/README.md`.
- `CityWalkOptions.primary` also removes the last reason for
  `city-walk.tsx`'s eleven-entry effect dependency array — plan 012 builds
  on that.
