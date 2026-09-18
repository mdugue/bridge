# Plan 004: Preprocess the DGM into a 512² heightfield at build time (12.6 MB → ~0.75 MB, no in-browser GeoTIFF decode)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8075a21..HEAD -- scripts/prepare-data.ts app/_components/terrain-layer.ts app/_components/create-app.ts app/_components/city-walk.tsx app/_components/city-walk-client.tsx lib/city/terrain-geometry.ts lib/city/terrain-geometry.test.ts lib/city/heightfield.ts lib/city/heightfield.test.ts lib/city/tile.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (PR #16 changes `terrain-layer.ts`,
> `create-app.ts`, `city-walk.tsx` and `city-walk-client.tsx`; if it has
> merged, stop and ask whether to port.)

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (plan 001 recommended first so `bun run verify` exists)
- **Category**: perf
- **Planned at**: commit `8075a21`, 2026-09-18

## Why this matters

Every page load fetches the raw DGM GeoTIFF (`dgm1_33412_5656_2_sn.tif`,
13.6 MB; a 2000×2000 uncompressed float32 raster that gzips to 12.6 MB
because it is noise-like) and then decodes and bilinearly resamples it to
512×512 **in the browser, on the main thread** — measured at 632 ms under
Bun on a server CPU, so likely 1–2 s on a phone. The 512×512 result the app
actually uses is 1 MB raw and gzips to ~750 KB. The CityJSON (5 MB, gzips to
1 MB) is fine as it is.

`scripts/prepare-data.ts` already runs before `dev` and `build` and is the
natural place to do this once. After this plan the browser fetches a ~150
byte JSON header plus a 1 MB float32 buffer (~750 KB over the wire), the
`geotiff` library leaves the client bundle, the `.tfw` fallback logic moves
to the build step where it belongs, and three smaller defects go away:

- the tile id is typed in two places (`scripts/prepare-data.ts:9` and
  `app/_components/city-walk-client.tsx:17`) with nothing tying them together;
- the script's up-to-date check compares file sizes only, so a swapped tile
  of identical size is never re-copied;
- NoData terrain vertices are written at elevation 0 (`lib/city/terrain-geometry.ts:67`),
  which drags the scene bounding box ~110 m below the real ground on any
  tile that has NoData pixels (the shipped tile has none, so this is
  latent — but the same module is being touched, and it has tests).

Measured facts about the shipped tile (verified with `geotiff` under Bun):
2000×2000, 1 sample, 32-bit float, NoData −9999, embedded georeferencing
(`getBoundingBox()` = `[412000, 5656000, 414000, 5658000]`, EPSG:25833 in
GeoKeys), elevation range 104.13–123.73 m. The `.tfw` sidecar is therefore
never needed for this tile, but other Saxony tiles may lack embedded tags,
so the fallback stays in the script.

## Current state

- `scripts/prepare-data.ts` (41 lines) — copies three files from `data/`
  to `public/data/` (gitignored) if sizes differ. Lines 6–41 (the five-line
  module doc comment at lines 1–5 is omitted here):

```ts
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const TILE = "33412_5656_2_sn";

const copies: [string, string][] = [
  [
    `data/cityjson/lod1_${TILE}.city.json`,
    `public/data/lod1_${TILE}.city.json`,
  ],
  [
    `data/dgm/dgm1_${TILE}_tiff/dgm1_${TILE}.tif`,
    `public/data/dgm1_${TILE}.tif`,
  ],
  [
    `data/dgm/dgm1_${TILE}_tiff/dgm1_${TILE}.tfw`,
    `public/data/dgm1_${TILE}.tfw`,
  ],
];

for (const [src, dest] of copies) {
  const srcPath = join(process.cwd(), src);
  const destPath = join(process.cwd(), dest);
  if (!existsSync(srcPath)) {
    process.stderr.write(`prepare-data: missing source file ${src}\n`);
    process.exit(1);
  }
  const upToDate =
    existsSync(destPath) && statSync(destPath).size === statSync(srcPath).size;
  if (upToDate) {
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
  process.stdout.write(`prepare-data: copied ${src} -> ${dest}\n`);
}
```

- `app/_components/terrain-layer.ts` (183 lines) — fetches the `.tif`,
  resolves bounds (embedded or `.tfw`), resamples with `readRasters`, builds
  the mesh via `buildTerrainGeometryData`, exposes `heightAt` via
  `sampleHeightfield`. Key excerpts:

```ts
// lines 1-16
import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from "three";
import {
  buildTerrainGeometryData,
  sampleHeightfield,
  type TerrainBounds,
} from "@/lib/city/terrain-geometry";
import { tfwToBounds } from "@/lib/city/tfw";

/** Downsample target (N x N). 512 is plenty for a POC. */
const DEFAULT_TARGET_SIZE = 512;

// lines 27-36
export interface TerrainOptions {
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** aborts the raster download */
  signal?: AbortSignal;
  targetSize?: number;
  /** .tfw sidecar fallback, used only when the GeoTIFF has no embedded georef */
  tfwUrl?: string;
  url: string;
}

// lines 138-183
export async function loadTerrain(opts: TerrainOptions): Promise<TerrainLayer> {
  const n = opts.targetSize ?? DEFAULT_TARGET_SIZE;

  const tiff = await fromArrayBuffer(
    await fetchArrayBuffer(opts.url, opts.signal)
  );
  const image = await tiff.getImage();
  const bounds = await resolveBounds(image, opts.tfwUrl);
  const nodata = image.getGDALNoData();

  const raster = await image.readRasters({
    width: n,
    height: n,
    samples: [0],
    interleave: true,
    resampleMethod: "bilinear",
  });
  const elevations = raster as unknown as ArrayLike<number>;

  const { positions, indices } = buildTerrainGeometryData({
    elevations,
    n,
    bounds,
    offset: opts.offset,
    nodata,
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const mesh = new Mesh(geometry, createTerrainMaterial());
  mesh.name = "terrain";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    mesh,
    vertexCount: positions.length / 3,
    bounds,
    heightAt: (x, y) =>
      sampleHeightfield({ elevations, n, bounds, nodata }, x, y),
  };
}
```

  `isPixelSpaceBounds` starts at line 50 and `resolveBounds` at line 69
  (doc comments from 45 and 64) — the `.tfw` fallback with its
  `gdal_translate -a_srs EPSG:25833` error message; `createTerrainMaterial`
  is lines 105–136 (doc from 100) — keep it unchanged.

- `app/_components/create-app.ts` — `CityWalkOptions.demTfwSrc?: string`
  (line 84) and the call:

```ts
  opts.onProgress?.("Loading DGM terrain…");
  const terrain = await loadTerrain({
    url: opts.demSrc,
    tfwUrl: opts.demTfwSrc,
    offset,
    signal: opts.signal,
  });
```

- `app/_components/city-walk.tsx` — `Props.demTfwSrc?: string` (lines 76–77),
  destructured at line 113, passed at line 174, in the effect deps at line 259:
  `}, [citySrc, demSrc, demTfwSrc, insertedModelUrl]);`
- `app/_components/city-walk-client.tsx:16-27`:

```ts
// Tile prepared by scripts/prepare-data.ts (copied from data/ to public/data).
const TILE = "33412_5656_2_sn";

export function CityWalkClient() {
  return (
    <CityWalk
      citySrc={`/data/lod1_${TILE}.city.json`}
      demSrc={`/data/dgm1_${TILE}.tif`}
      demTfwSrc={`/data/dgm1_${TILE}.tfw`}
    />
  );
}
```

- `lib/city/terrain-geometry.ts:56-69` (the NoData write):

```ts
  let p = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const z = elevations[i];
      const bad = isInvalidElevation(z, nodata);
      valid[i] = bad ? 0 : 1;

      // Pixel centers; raster row 0 = north (maxY).
      positions[p++] = minX + (col + 0.5) * dx - offset.cx;
      positions[p++] = maxY - (row + 0.5) * dy - offset.cy;
      positions[p++] = bad ? 0 : z;
    }
  }
```

  `isInvalidElevation` (lines 34–40) already treats non-finite values as
  invalid: `!Number.isFinite(z) || z < MIN_PLAUSIBLE_ELEVATION || (nodata !== null && z === nodata)`.

- `lib/city/tfw.ts` — `tfwToBounds(text, width, height)`; stays, now used by the script.
- `e2e/city-walk.spec.ts:74` fetches `/data/lod1_33412_5656_2_sn.city.json`
  directly — unaffected (the CityJSON copy is unchanged).
- `.gitignore` already ignores `/public/data/`.
- `geotiff` (`package.json`) stays a dependency; it is now used only by the
  Bun script at build time (Bun runs `geotiff` fine — verified).

Layout contract you must keep: the heightfield is `n × n`, row-major, row 0
= north (`maxY`), exactly what `readRasters` returns and what
`buildTerrainGeometryData`/`sampleHeightfield` expect (see the header
comment of `lib/city/terrain-geometry.ts`).

Conventions: `lib/city/*` stays three-free and DOM-free with colocated
`bun:test` files; script style as in the current `prepare-data.ts`
(`node:fs`, `process.stdout.write`, `process.exit(1)` on missing sources).
Conventional Commits, lowercase subject. No `console.log`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Run the data step alone | `bun scripts/prepare-data.ts` | prints what it produced; exit 0 |
| Typecheck | `bun typecheck` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Unit tests | `bun run test` | all pass |
| Build (runs the data step first) | `bun run build` | exit 0 |
| E2E | `bun run test:e2e` | 3 passed |

## Scope

**In scope**:
- `lib/city/tile.ts` (create), `lib/city/heightfield.ts` (create), `lib/city/heightfield.test.ts` (create)
- `lib/city/terrain-geometry.ts`, `lib/city/terrain-geometry.test.ts` (NoData elevation only)
- `scripts/prepare-data.ts` (rewrite)
- `app/_components/terrain-layer.ts` (replace the GeoTIFF path)
- `app/_components/create-app.ts`, `app/_components/city-walk.tsx`, `app/_components/city-walk-client.tsx` (remove `demTfwSrc`, use `lib/city/tile.ts`)
- `plans/README.md` (status row)

**Out of scope**:
- `lib/city/tfw.ts` and its test — reused as is.
- `e2e/city-walk.spec.ts` — keep its literal tile URL; it stays valid.
- `package.json` — do not move `geotiff` to devDependencies in this plan.
- `data/**` — never modify committed data.
- Multi-tile loading — direction item, not this plan.
- `terrain.mesh.castShadow`, terrain material/shader — unchanged.

## Git workflow

- Branch: `advisor/004-build-time-heightfield` from `main`.
- Commits per step (messages below).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: One home for the tile id

Create `lib/city/tile.ts`:

```ts
/**
 * The single tile the POC loads. data/ holds more tiles (see README);
 * scripts/prepare-data.ts prepares this one into public/data/.
 * Tile id scheme (Saxony open data): <UTM zone><easting km>_<northing km>_<edge km>_sn.
 */
export const POC_TILE = "33412_5656_2_sn";

/** Files served from /data (public/data/), all derived from the tile id. */
export function cityJsonFile(tile: string): string {
  return `lod1_${tile}.city.json`;
}
export function heightfieldHeaderFile(tile: string): string {
  return `dgm1_${tile}.heightfield.json`;
}
export function heightfieldDataFile(tile: string): string {
  return `dgm1_${tile}.heightfield.f32`;
}
```

**Verify**: `bun typecheck` → exit 0.

### Step 2: The heightfield format as a pure module

Create `lib/city/heightfield.ts`:

```ts
import type { TerrainBounds } from "./terrain-geometry";

/**
 * Preprocessed DGM heightfield produced by scripts/prepare-data.ts and read
 * by app/_components/terrain-layer.ts. Two files next to each other:
 *  - <name>.heightfield.json — this header
 *  - <name>.heightfield.f32  — n*n little-endian float32 samples, row-major,
 *    row 0 = north (the GeoTIFF convention); NoData is stored as NaN.
 * No THREE, no DOM.
 */
export const HEIGHTFIELD_VERSION = 1;

export interface HeightfieldHeader {
  /** [minX, minY, maxX, maxY] in the projected CRS (EPSG:25833 for the POC) */
  bounds: TerrainBounds;
  /** file name of the .f32 samples, relative to the header's directory */
  data: string;
  /** grid size (n x n) */
  n: number;
  version: typeof HEIGHTFIELD_VERSION;
}
```

Implement and export:

- `parseHeightfieldHeader(json: unknown): HeightfieldHeader` — validates:
  object; `version === HEIGHTFIELD_VERSION`; `n` a positive integer;
  `bounds` an array of 4 finite numbers with `maxX > minX` and `maxY > minY`;
  `data` a non-empty string containing no `/` or `..`. Throws
  `new Error("Invalid heightfield header: <reason>")` otherwise.
- `encodeHeightfield(samples: ArrayLike<number>, nodata: number | null): Float32Array`
  — returns a new array where every value equal to `nodata` (when not
  null) or non-finite becomes `Number.NaN`; everything else is copied.
- `decodeHeightfield(buffer: ArrayBuffer, n: number): Float32Array` — throws
  `Error("Heightfield size mismatch: expected <n*n*4> bytes, got <len>")`
  unless `buffer.byteLength === n * n * 4`; returns `new Float32Array(buffer)`.
  (Little-endian is assumed on both sides; every browser and Bun target the
  app supports is little-endian — say so in a comment.)
- `resolveSiblingUrl(headerUrl: string, file: string): string` — replaces
  the last path segment of `headerUrl` with `file` (e.g.
  `/data/x.heightfield.json` + `x.heightfield.f32` → `/data/x.heightfield.f32`).

Create `lib/city/heightfield.test.ts` (model after `lib/city/tfw.test.ts`):
valid header round-trips; rejects wrong `version`, non-integer `n`,
degenerate `bounds`, a `data` containing `..`; `encodeHeightfield` maps
`-9999` (with `nodata: -9999`) and `Infinity` to NaN and leaves `120.5`
untouched; with `nodata: null` only non-finite values become NaN;
`decodeHeightfield` rejects a wrong-length buffer and returns the values
written by `encodeHeightfield` (round-trip through `.buffer`);
`resolveSiblingUrl` for the example above and for a bare file name.

**Verify**: `bun test lib/city/heightfield.test.ts` → all pass (≥ 8 tests).

Commit: `feat: heightfield format module for preprocessed terrain`.

### Step 3: NoData vertices sit at the mean valid elevation

In `lib/city/terrain-geometry.ts` `buildTerrainGeometryData`, before the
position loop, compute the mean of all valid samples (one pass using
`isInvalidElevation`; `0` if none are valid). In the loop write
`positions[p++] = bad ? meanValid : z;` and update the comment: NoData
vertices are excluded from the index buffer, but their positions still feed
bounding boxes, so park them at the mean valid height instead of 0.

Add to `lib/city/terrain-geometry.test.ts` a new test that builds its own
array exactly like the existing "omits quads touching a NoData vertex" test
does (`const elevations = new Float32Array(9).fill(100); elevations[0] = -9999;`
then spread `{ ...flat3x3, elevations, offset }`) — never mutate the shared
`flat3x3.elevations`. Assert `positions[2]` equals `100` (the mean of the
valid samples) and that the existing tests still pass.

**Verify**: `bun test lib/city/terrain-geometry.test.ts` → 6 pass.

Commit: `fix: park NoData terrain vertices at the mean valid elevation`.

### Step 4: Rewrite `scripts/prepare-data.ts`

Replace the file. Structure:

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fromArrayBuffer } from "geotiff";
import { encodeHeightfield, HEIGHTFIELD_VERSION, type HeightfieldHeader } from "../lib/city/heightfield";
import { tfwToBounds } from "../lib/city/tfw";
import { cityJsonFile, heightfieldDataFile, heightfieldHeaderFile, POC_TILE } from "../lib/city/tile";
import type { TerrainBounds } from "../lib/city/terrain-geometry";

/** Heightfield grid size; 512 is plenty for a POC. */
const HEIGHTFIELD_N = 512;
const OUT_DIR = "public/data";
```

Source paths (keep the existing patterns): CityJSON
`data/cityjson/lod1_${POC_TILE}.city.json`, GeoTIFF
`data/dgm/dgm1_${POC_TILE}_tiff/dgm1_${POC_TILE}.tif`, sidecar
`data/dgm/dgm1_${POC_TILE}_tiff/dgm1_${POC_TILE}.tfw` (optional).

Behaviour:

1. `requireSource(path)` — as today: stderr message + `process.exit(1)` if missing.
2. `isStale(dest, ...sources)` — true if `dest` is missing or any source's
   `statSync(...).mtimeMs` is newer than `dest`'s. (Replaces the size check.)
3. CityJSON: `copyFileSync` when stale; log `prepare-data: copied … -> …`.
4. Heightfield: when either output is stale relative to the `.tif` (and the
   `.tfw` if present), OR the existing header fails to parse / has a
   different `version`:
   - read the `.tif` into an `ArrayBuffer` (`readFileSync(...).buffer.slice(byteOffset, byteOffset + byteLength)`),
     `const tiff = await fromArrayBuffer(buf); const image = await tiff.getImage();`
   - `width/height = image.getWidth()/getHeight()`; `nodata = image.getGDALNoData()`;
   - bounds: `image.getBoundingBox()` inside try/catch; if it throws or is
     pixel-space (`|minX|<=1 && |minY|<=1 && |maxX-width|<=1 && |maxY-height|<=1`
     — move `isPixelSpaceBounds` here verbatim from `terrain-layer.ts`), fall
     back to `tfwToBounds(readFileSync(tfw, "utf8"), width, height)` when the
     sidecar exists; otherwise fail with the existing message
     (`"DGM GeoTIFF has no embedded georeferencing and no readable .tfw sidecar. Embed it with: gdal_translate -a_srs EPSG:25833 in.tif out.tif"`) and exit 1;
   - `const raster = await image.readRasters({ width: HEIGHTFIELD_N, height: HEIGHTFIELD_N, samples: [0], interleave: true, resampleMethod: "bilinear" });`
     then `if (!ArrayBuffer.isView(raster)) { fail("unexpected raster shape") }`;
   - `const samples = encodeHeightfield(raster as unknown as ArrayLike<number>, nodata);`
     (`// reason: geotiff types the result as TypedArray | TypedArray[]; isView narrowed it above`)
   - write `join(OUT_DIR, heightfieldDataFile(POC_TILE))` with `Buffer.from(samples.buffer)`;
   - write the header JSON `{ version: HEIGHTFIELD_VERSION, n: HEIGHTFIELD_N, bounds, data: heightfieldDataFile(POC_TILE) }`
     (typed as `HeightfieldHeader`, `JSON.stringify(header, null, 2)`);
   - log `prepare-data: built <header> (<n>x<n> from <width>x<height>, bounds […])`.
5. Top-level `await` is fine (Bun runs the script as ESM).

**Verify**:
- `bun scripts/prepare-data.ts` → logs a copy line (if `public/data` was empty) and a `built` line; exit 0.
- `stat -c %s public/data/dgm1_33412_5656_2_sn.heightfield.f32` → `1048576`.
- `cat public/data/dgm1_33412_5656_2_sn.heightfield.json` → `"n": 512`, `"bounds": [412000, 5656000, 414000, 5658000]`, `"data": "dgm1_33412_5656_2_sn.heightfield.f32"`.
- Run the script again → prints nothing (up to date), exit 0.
- `touch data/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif` then run → rebuilds (prints `built`). (Touching only changes the mtime of a committed file; `git status` stays clean.)

Commit: `feat: preprocess the DGM into a 512² heightfield in prepare-data`.

### Step 5: Load the heightfield in `terrain-layer.ts`

Replace the GeoTIFF path:

- Remove the `geotiff` import, `DEFAULT_TARGET_SIZE`, `isPixelSpaceBounds`,
  `resolveBounds`, and the `tfwToBounds` import.
- `TerrainOptions` becomes `{ offset: { cx: number; cy: number }; signal?: AbortSignal; /** URL of the heightfield header JSON (see lib/city/heightfield.ts) */ url: string; }`.
- Add `fetchJson(url, signal): Promise<unknown>` next to `fetchArrayBuffer`
  (same error message style: `Failed to fetch ${url}: HTTP ${status}`).
- `loadTerrain`:

```ts
  const header = parseHeightfieldHeader(await fetchJson(opts.url, opts.signal));
  const buffer = await fetchArrayBuffer(resolveSiblingUrl(opts.url, header.data), opts.signal);
  const elevations = decodeHeightfield(buffer, header.n);
  const { n, bounds } = header;
  const nodata = null; // NoData is NaN in the preprocessed samples
```

  then the existing `buildTerrainGeometryData` → geometry → mesh → return
  block unchanged (with `nodata` now `null`). Update the module comment to
  say the raster is preprocessed by `scripts/prepare-data.ts`.

**Verify**: `bun typecheck` → errors only in `create-app.ts` (`tfwUrl`), expected until Step 6. `grep -n "geotiff" app/_components/terrain-layer.ts` → no output.

### Step 6: Remove `demTfwSrc` and use the shared tile id

- `create-app.ts`: delete `demTfwSrc?: string;` from `CityWalkOptions` and
  the `tfwUrl: opts.demTfwSrc,` line; update the `demSrc` doc comment in
  `city-walk.tsx` to "URL of the heightfield header JSON".
- `city-walk.tsx`: delete the `demTfwSrc` prop (interface, destructuring,
  the `createCityWalkApp` argument, and the effect dependency array → `[citySrc, demSrc, insertedModelUrl]`).
- `city-walk-client.tsx`:

```ts
import { cityJsonFile, heightfieldHeaderFile, POC_TILE } from "@/lib/city/tile";
// ...
      citySrc={`/data/${cityJsonFile(POC_TILE)}`}
      demSrc={`/data/${heightfieldHeaderFile(POC_TILE)}`}
```

  and delete the local `TILE` constant and its comment.

**Verify**:
- `bun typecheck` → exit 0; `bun lint` → exit 0.
- `grep -rn "demTfwSrc\|tfwUrl" app/` → no output.
- `grep -rn "33412_5656_2_sn" app/ scripts/ lib/` → only `lib/city/tile.ts`.

Commit: `refactor: load the preprocessed heightfield and share the tile id`.

### Step 7: Full verification

- `bun run test` → all pass (new: heightfield tests, NoData test).
- `bun run build` → exit 0 (the data step runs first and builds the heightfield).
- `bun run test:e2e` → 3 passed (`terrainVertexCount` is still 262,144 = 512²; the spec asserts `> 0`).
- Manual: `bun dev`, open the page, walk around — the ground and contour
  lines look as before, and the loading phase "Loading DGM terrain…" is
  visibly shorter. Network tab: the terrain requests are the `.json` and
  the `.f32` (~1 MB), no `.tif`.

## Test plan

- New `lib/city/heightfield.test.ts` (≥ 8 cases, Step 2).
- New NoData-mean case in `lib/city/terrain-geometry.test.ts` (Step 3).
- Existing e2e covers the load path end to end.
- Pattern files: `lib/city/tfw.test.ts`, `lib/city/terrain-geometry.test.ts`.
- Verification: `bun run test` → all pass.

## Done criteria

- [ ] `bun typecheck`, `bun lint`, `bun run test` all exit 0
- [ ] `bun run build` exits 0 and produces `public/data/dgm1_33412_5656_2_sn.heightfield.{json,f32}` with the `.f32` exactly 1,048,576 bytes
- [ ] `bun run test:e2e` reports 3 passed
- [ ] `grep -rn "geotiff" app/` → no matches (client bundle no longer decodes GeoTIFF)
- [ ] `grep -rn "demTfwSrc\|tfwUrl\|\.tif" app/` → no matches
- [ ] `grep -rn "33412_5656_2_sn" app/ scripts/ lib/` → only `lib/city/tile.ts`
- [ ] `grep -rn "from \"three\"" lib/` → no matches
- [ ] `git status --porcelain` lists only in-scope files (`public/data/` is ignored)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The "Current state" excerpts do not match the live files.
- `image.getBoundingBox()` in the script returns something other than
  `[412000, 5656000, 414000, 5658000]` for the shipped tile (georef
  handling differs from what this plan verified) — report the value.
- The `.f32` output is not exactly 1,048,576 bytes.
- The e2e minimap-teleport assertion (pose near 412,500 E / 5,657,500 N)
  fails — the bounds or row order are wrong; do not adjust the test.
- `bun run build` fails inside `next build` on a `geotiff` import from a
  client file — something still imports it under `app/`.

## Maintenance notes

- Bump `HEIGHTFIELD_VERSION` whenever the binary layout changes; the script
  rebuilds on version mismatch and the client rejects unknown versions.
- The grid size is now fixed at build time (`HEIGHTFIELD_N`). If a runtime
  resolution knob is ever needed again, emit several sizes from the script.
- Multi-tile loading (see the direction notes in `plans/README.md`) should
  reuse this format one file pair per tile; the script's tile loop is the
  place to extend.
- Deferred: moving `geotiff` to `devDependencies`; pre-gzipping the `.f32`
  (hosts compress it automatically; ~750 KB gz).
