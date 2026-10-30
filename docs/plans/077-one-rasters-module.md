# Plan 077: One rasters module — a tile's rasters loaded, shared and weighed behind one interface, their files named by the artifact table

**Status:** TODO

> **Executor instructions**: Follow this plan step by step. Each step
> ships on its own; run its verification before the next. If anything in
> "STOP conditions" occurs, stop and report — do not improvise. When done,
> update the status row for this plan in `docs/plans/README.md` (with
> deviations) and backlog item 22 there.
>
> **Drift check (run first)**:
> `git diff --stat 6c2a70ba..HEAD -- app/_components/terrain-layer.ts app/_components/sky-light.ts app/_components/raster-upload.ts app/_components/shared-rasters.ts app/_components/raster-shares.ts app/_components/tile-stream.ts app/_components/vegetation-layer.ts lib/city/tile.ts lib/city/tileset.ts scripts/prepare-data.ts scripts/bake-entries.ts`
> Line numbers below are approximate (planned at `6c2a70ba`); find code
> by its name. Plan 076 is IN PROGRESS and edits `tile-stream.ts`'s
> `DressingPlugin`: if the drift check shows its raster members
> (`skyView`, `horizon`, `splats`, `ndvis`, `sports`, `rasterShares`,
> `holdRasters`, `shareSkyView`) changed, re-read them before step 3.

## Status

- **Priority**: P2
- **Effort**: M–L (four steps; step 1 needs a cold Dresden bake twice,
  ≈ 10 min each on 4 cores)
- **Risk**: MED — no look should change, but the class raster's absence
  makes a tile's ground plain, a wrong tier twin grows a phone's memory,
  and a raster present on one branch and not the other builds a different
  ground program. Each has a check below.
- **Depends on**: nothing open. Read ADR 0047 (phone memory, the
  site-wide decode turn), ADR 0048 (retried fetches), ADR 0027 (node
  materials), ADR 0024 (hashed names in the glTF extras), ADR 0010 (the
  class raster painted with one palette on the GPU).
- **Category**: tech-debt (deepening)
- **Planned at**: commit `6c2a70ba`, 2026-10-30, from an architecture
  review of 2026-10-29/30 corrected by three verifiers and re-checked
  against the code for this plan.

## Why this matters

Backlog item 22 ("One terrain raster loader driven by the artifact
table"). A new raster on the ground today takes about sixteen edits in
five files: a table row, a hand-written extras field in
`prepare-data.ts`, a field in `TerrainExtras`, a loader wrapper, a slot
in each of nine per-raster lists in `terrain-layer.ts`, a `SharedRasters`
instance in `tile-stream.ts` (if two levels share it), its weighing and
its teardown. The knowledge of *how a raster is loaded* — its look, its
tier twin, its sharing, its weight in the tile cache — is spread over
`terrain-layer.ts`, `sky-light.ts`, `tile-stream.ts`, `raster-shares.ts`
and `prepare-data.ts`. Nothing tests the loaders through one interface:
`raster-upload.test.ts` has to import `loadNdviTexture` from
`terrain-layer.ts` because the upload has no interface of its own.

After this plan, one module (`app/_components/tile-rasters.ts`) hands a
content root its rasters by kind — on the GPU when the promise resolves,
shared by file, freed with the last holder, weighed a share per holder —
and the build writes the terrain's raster extras from the artifact
table's rows. A new raster drops to about seven edits, not one: the
ground graph's named slot interface stays (see Findings, "What stays").

## Findings

### The loaders (two halves, one of them twice)

The *fetch → site-wide turn → upload → drop* half is already one module:
`app/_components/raster-upload.ts` (`fetchRasterBytes`, `inRasterTurn`,
`dropDataOnUpload`, `uploadNow`, `setRasterTier`, which sets the module's
gate limit and `uploadAtDecode`; `RASTER_TURNS` = desktop 5, mobile 1).
What exists twice is the *decode → texture with its look* half and the
*null on failure, abort rethrown* wrapper:

| File | Function (≈ line) | Role |
|---|---|---|
| `terrain-layer.ts` | `RasterLook`, `idLook`, `FIELD_LOOK`, `NDVI_LOOK` (≈ 259–282) | the looks |
| | `lookAs` (≈ 284) | filters, mips, anisotropy, `NoColorSpace`, `trackTexture` |
| | `loadRasterTexture` (≈ 319) | fetch, turn, decode, inspect, look, upload |
| | `decodeRaster` (≈ 343) | `decodeGreyPng` → R/RG/RGBA `DataTexture`, `flipY = false`, `dropDataOnUpload`; a 1-channel PNG it rejects falls back to `loadBitmapTexture` |
| | `loadOptionalRaster` (≈ 387) | null on failure, abort rethrown |
| | `loadBitmapTexture` (≈ 409) | the browser-decoder fallback |
| | look-only wrappers: `loadSplatTexture` (≈ 437), `loadNdviTexture` (≈ 534, exported), `loadSurfaceTexture` (≈ 550), `loadEdgesTexture` (≈ 565), `loadColonyTexture` (≈ 659) | |
| | `loadSplatRasters` (≈ 466), `freeSplatRasters` (≈ 498) | class raster + water mask (`inspect` → `waterMaskOf`) + GPU paint (`paintLandcoverSplat`, ADR 0010); disposes and rethrows if aborted after the load |
| | `sportKey` (≈ 510), `loadSportKey` (≈ 514), `freeSport` (≈ 523) | the sports pair keyed by one string (`raster + "\n" + table`, because `SharedRasters` keys by one string) |
| | `tableTexture` (≈ 576), `loadIndexedRaster` (≈ 600), `loadSportGrounds` (≈ 634), `loadMarkings` (≈ 676) | JSON table (`fetchOptionalJson`) packed into a 2-texel float texture, then the raster; sports need `grounds.length`, markings only `markings` |
| `sky-light.ts` | `loadLightRaster` (≈ 459) | fetch, turn, decode, `make`, flags, drop, upload, null on failure — **no browser-decoder fallback** |
| | `loadSkyViewTexture` (≈ 493) | look-only: R, LINEAR + mips |
| | `loadHorizonTexture` (≈ 526) | **not look-only**: 8-layer RGBA `DataArrayTexture`, null unless `height === (width / 4) · 8` |

### Who holds what, and what it weighs

- `shared-rasters.ts` `createSharedRasters` — load once per key, refs,
  abort a load every reader left, `clear`. Deep as it is (2026-09-26
  review). Instantiated five times in `tile-stream.ts` `DressingPlugin`
  (≈ 1486–1512): `skyView`, `horizon`, `splats`, `ndvis`, `sports`;
  cleared at teardown (≈ 1993–1997).
- `terrain-layer.ts` `loadTerrainRasters` (≈ 1555): `owned` (textures the
  level owns: surface, edges, colonies, markings raster and table),
  `holds` (releases of shared ones), `hold: Hold` (≈ 1532; wraps
  `share.acquire` in `untilAborted` so an abort lets go at once),
  `owning` (≈ 1632), `free`; `settledAll` (≈ 1603);
  `loadDetailRasters` (≈ 1647) picks each file from the extras with the
  tier twin and the gate (`readsSportGrounds`, ≈ 1627; plan 070).
- `raster-shares.ts` `RasterShares` — holders per texture, `bytesOf` =
  Σ tracked bytes / holders. Plan 041 split it out on purpose, with its
  tests. Used by `DressingPlugin.calculateBytesUsed` (≈ 1665) and
  `holdRasters` (≈ 1675, after `dressTerrain` resolves and at `release`,
  ≈ 2374), which asks the renderer to reweigh the other holders' tiles.
- `three-utils.ts` `trackTexture` / `trackedBytesOf` / `textureBytes` —
  the byte tracker every raster's weight comes from.
- The clay's sky view: `DressingPlugin.shareSkyView` (≈ 1824) acquires
  from `skyView` for a building tile and releases at `release` (≈ 2370).
  **The buildings hold the sky view in `SharedRasters` but are not a
  holder in `RasterShares`** (a city tile weighs no raster). So the two
  holder counts are not the same count: they stay two (see the design).

### The spellings of one raster

- `lib/city/tile.ts` `ARTIFACTS` (≈ 142) has no raster columns;
  `bakedFrom.raster` is a partial one (the downsampled class rasters).
- `cultivatedLow` is published but has **no row**: `prepare-data.ts`
  widens its `Published` type for it (≈ 357) and `publishColonies`
  (≈ 368) derives its name with `file.replace(/\.png$/u, ".r1024.png")`.
- `lib/city/tileset.ts` `TerrainExtras` (≈ 101) has ~25 fields; 12 are
  raster file names (`landcover`, `landcoverLow`, `ndvi`, `surface`,
  `edges`, `sport`, `cultivated`, `cultivatedLow`, `markings`,
  `markingsLow`, `svf`, `horizon`), two are tables (`sportTable`,
  `markingsTable`) and one a crop tuple (`cultivatedCrop`).
- They are written by hand in `scripts/prepare-data.ts`: `described` in
  `bakeTerrain` (≈ 1307) and `paintAndLight` (≈ 1195). Three quirks the
  table must express:
  - the extras key `cultivated` names the artifact `cultivatedRaster`
    (the GeoJSON owns the kind name `cultivated`);
  - on level 1 both `landcover` and `landcoverLow` name
    `landcoverCoarse`; both keys are always written (`?? ""`);
  - surface, edges, markings and colonies are level 0 only; the sports
    pair, NDVI, sky view and horizon both levels; a table twin is written
    only beside its raster, `cultivatedCrop` only beside `cultivated`.
- **The key order is load-bearing.** `described` is part of the terrain
  cache keys (`cacheKey(inputs, bake, offset, described, opened)`) and
  goes into the glb's extras JSON: a different key order changes every
  terrain glb's bytes and so its content-hashed name. Today's order:
  `kind, tileId, level, n, landcover, landcoverLow, ndvi, surface, edges,
  sport, sportTable, cultivated, cultivatedCrop, cultivatedLow, markings,
  markingsTable, markingsLow, svf, horizon`, then `waterExtras`, then
  `dressing` / `coarse`. `ARTIFACTS`' own order differs (svf and horizon
  come before markings there), and must not be reordered: the publish
  loop (≈ 605) and `kindsWith` (`DRESSING_KINDS` order) follow it.
- `terrain-layer.ts` reads 12 of those fields, `tile-stream.ts` 6
  (`extras.ndvi` for the crown sampler ≈ 1176, `extras.sportTable` for
  the fixtures ≈ 1190, `extras.svf` for the clay ≈ 1805).
- The runtime cannot compute names from the table: they are hashed
  (ADR 0024). It maps a kind to a file through the extras.

### What stays: the ground graph's slot interface

Nine per-raster lists live in `terrain-layer.ts`. Five are the ground
graph's named slot interface (`material-slots.ts`; read by name in
`sport-ground.ts` `sportGround`, `road-markings.ts`, `cultivated-layer.ts`
`colonyGarden`, `water-layer.ts`) and **stay**: `SplatLayer` (≈ 695),
`SplatNodes` (≈ 749), `splatVariant` (≈ 770), `splatNodes` (≈ 784),
`splatSlots` (≈ 818). Four go: `DetailRasters`, `NO_DETAIL`,
`splatDetail` (≈ 1495–1529) and `splatRasters` (≈ 1729) — the last one is
a correction to the review, which kept it: it only lists what the tile
cache weighs, and the module will know what it handed each holder. Only
the water sheet's tint texture stays in `TerrainLayer.rasters`.

The ground graph depends on the loaders only through:

- **presence** — `splatVariant` keys the program by which optional
  rasters loaded; one more or one fewer is another build (ADR 0027);
- **look** — NEAREST for ids (class, surface, sport, markings), LINEAR for
  fields; the NDVI's meadow bias assumes its mip chain (`NDVI_LOOK`:
  LINEAR, mips, anisotropy 16);
- **orientation** — `flipY = false`, row 0 north;
- **CPU reads** before the bytes go — the class raster's water mask.

These become table columns and hooks; none of them changes.

### Hooks that stay outside a plain row

The class raster's water-mask `inspect` and its GPU paint
(`landcover-splat.ts` `paintLandcoverSplat`, ADR 0010); the table-indexed
pairs (sports grounds, markings); the horizon's layer check; the colony
crop rect (`colonyCropUv(extras.cultivatedCrop)`, a per-level value, not
a load concern — it stays in `terrain-layer.ts`).

### Other findings

- The crown colour's NDVI is decoded a second time per fine level:
  `vegetation-layer.ts` `loadNdviSampler` (≈ 1339), called from
  `tile-stream.ts` `buildDressing` (≈ 1177), fetches with
  `fetchOptionalBinary` and decodes with `decodeGreyPng` **outside the
  raster turn**, so on a phone it can overlap a turn's decode. The
  sampler (`lib/city/raster-sampler.ts` `maxWindowSampler`) keeps the
  whole decoded raster while the dressing builds. The README's 2026-10-01
  audit lists it (S).
- `tableTexture`'s float tables are not tracked: they weigh 0 in the
  cache today. Keep it so.
- The sports table JSON is fetched twice per fine level (the terrain and
  the dressing's fixtures; the second from the HTTP cache). Out of scope.
- The browser-decoder fallback (`loadBitmapTexture`) serves the class and
  NDVI rasters only, and contradicts the hard rule "nothing whose values
  carry data goes through the browser's image decoder". Kept as a column
  here (behaviour unchanged); see Maintenance notes.
- The review cited "ADR 0023" for the class raster's GPU paint. There is
  no such record in `docs/adr/` (merged); the paint is ADR 0010's.

## The design

### The interface

`app/_components/tile-rasters.ts` (new; three.js, so `app/_components`,
not `lib/city`):

```ts
/** What a content root reads, by kind (one row each in RASTER_KINDS). */
export type RasterKind =
  | "class" | "ndvi" | "surface" | "edges" | "sport"
  | "markings" | "colonies" | "svf" | "horizon";

export interface RasterOf {
  class: SplatRasters;           // moved here from terrain-layer.ts
  ndvi: Texture; surface: Texture; edges: Texture; colonies: Texture;
  sport: IndexedRaster;          // { raster: Texture; table: DataTexture }
  markings: IndexedRaster;
  svf: Texture;
  horizon: DataArrayTexture;
}

/** A site's rasters: loaded once per file, on the GPU (or set up for the
 *  compile, on a desktop) when handed out, shared by every content root
 *  that names the file, freed with the last holder, weighed a share per
 *  weighed holder. */
export interface TileRasters {
  /** `root`'s handle. `weighed: false` for a holder the tile cache does
   *  not weigh by its rasters (a building tile's sky view). */
  holder(root: object, opts?: { weighed?: boolean }): RasterHold;
  /** Σ over `root`'s rasters of tracked bytes / weighed holders. */
  bytesOf(root: object): number;
  /** frees everything, aborting loads on their way (the stream's end) */
  clear(): void;
}

export interface RasterHold {
  /** The raster `kind` the extras name for this level and tier, or null
   *  (not named, gated off, absent, undecodable, refused by the GPU).
   *  Rejects only with an abort of `signal`, at once: the hold is let go
   *  by `release`, not by the wait. */
  acquire<K extends RasterKind>(
    kind: K,
    extras: ContentExtras,
    signal?: AbortSignal
  ): Promise<RasterOf[K] | null>;
  /** lets go of everything this holder took; idempotent */
  release(): void;
}

export function createTileRasters(opts: {
  renderer: WebGPURenderer;
  url: (file: string) => string;   // DressingPlugin.url
  lowRasters: boolean;             // the tier's twins and gates
  /** another root's share changed: reweigh its tile */
  onShareChange: (root: object) => void;
}): TileRasters;
```

Depth: the caller learns two calls and nine kind names. Behind them: the
file choice (tier twin, gate, table twin), the fetch policy, the turn,
the decode, the look, the upload, the CPU drop, the byte tracking, the
sharing and the weighing.

### The kinds table (runtime, in `tile-rasters.ts`)

| kind | extras key | phone key (falls back to full?) | table key | channels | filter | mips | aniso | layers | read when | browser fallback | hook |
|---|---|---|---|---|---|---|---|---|---|---|---|
| class | `landcover` | `landcoverLow` (no) | – | 1 | nearest | – | – | – | always | yes | water mask, paint, free both |
| ndvi | `ndvi` | – | – | 1 | linear | yes | 16 | – | always | yes | (step 4) |
| surface | `surface` | – | – | 4 | nearest | – | – | – | always | – | – |
| edges | `edges` | – | – | 2 | linear | – | – | – | always | – | – |
| sport | `sport` | – | `sportTable` | 4 | nearest | – | – | – | `readsSportGrounds(level, low)` | – | `packSportTable`, needs `grounds.length` |
| markings | `markings` | `markingsLow` (yes) | `markingsTable` | 4 | nearest | – | – | – | always | – | `packMarkingTable`, needs `markings` |
| colonies | `cultivated` | `cultivatedLow` (yes) | – | 2 | linear | – | – | – | always | – | – |
| svf | `svf` | – | – | 1 | linear | yes | – | – | always | **no** | – |
| horizon | `horizon` | – | – | 4 | linear | no | – | 8 | always | no | null unless 8 layers |

"Falls back": today `(low ? extras.markingsLow : undefined) ??
extras.markings`, but `low ? extras.landcoverLow : extras.landcover` —
keep both exactly. A table key means the raster is acquired only when
both files are named, and the share key is both files (the `sportKey`
`"\n"` join becomes internal). The kind names are the runtime's; the
extras keys are the build's (step 1 ties them by a test).

### Inside (internal seams, not interface)

- `shared-rasters.ts` stays as the load-lifetime adapter (one instance
  per kind, made from the table). Its test stays.
- `raster-shares.ts` stays as the weighing adapter, fed only by weighed
  holders. Re-merging the two counts (plan 041 split `RasterShares` out)
  is **not** done: they count different holders (the buildings' sky
  view). Its test stays.
- `raster-upload.ts` stays the turn and upload (`setRasterTier` and its
  module state unchanged), and gains the one decode-with-look path in
  step 2.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Unit tests of the module | `bun test app/_components/tile-rasters.test.ts` | pass |
| The table and writer | `bun test lib/city/tile.test.ts lib/city/tileset.test.ts lib/city/tile-data.test.ts scripts/bake-entries.test.ts` | pass |
| Typecheck | `bun typecheck` (reference: `bun run typecheck:tsc`) | exit 0 |
| The gate | `bun run fix && bun run verify` | exit 0 |
| Prepare one site | `bun scripts/prepare-sites.ts dresden` | exit 0 |
| e2e | `bun run test:e2e --grep "@desktop-render\|@phone"`, then `bun run test:e2e` | pass (slow) |
| Real-GPU plates | `SHOTS_TAG=before bun run shots` / `SHOTS_TAG=after bun run shots` | `shots/<name>.<tag>.png` |

## Scope

**In scope:**
- `app/_components/tile-rasters.ts`, `app/_components/tile-rasters.test.ts` (create)
- `app/_components/raster-upload.ts`, `raster-upload.test.ts` (step 2)
- `app/_components/terrain-layer.ts`, `terrain-layer.test.ts`
- `app/_components/sky-light.ts` (its loaders only)
- `app/_components/tile-stream.ts` (`DressingPlugin`'s raster members,
  `dressCity`/`shareSkyView`, `dressTerrain`'s options, `release`,
  `dispose`, `calculateBytesUsed`; step 4: the sampler call)
- `app/_components/vegetation-layer.ts` (step 4 only: `loadNdviSampler`)
- `lib/city/tile.ts`, `lib/city/tile.test.ts`, `lib/city/tileset.ts`,
  `lib/city/tileset.test.ts`, `scripts/prepare-data.ts` (step 1)
- Docs (step 5): `docs/rendering.md`, `docs/data-pipeline.md`,
  `docs/transformations.md`, `.claude/skills/city-walker/SKILL.md`,
  `docs/plans/README.md` (status row, backlog item 22, the NDVI bullet)

**Out of scope** (do not touch): the shader terms and their slot lists
(`SplatLayer` … `splatSlots`, `sport-ground.ts`, `road-markings.ts`,
`cultivated-layer.ts`, `ground-detail.ts`, `water-layer.ts`,
`sky-light.ts`'s light graph), `landcover-splat.ts`, `material-slots.ts`,
`shared-rasters.ts`, `raster-shares.ts`, `three-utils.ts`'s tracker,
`png-raster.ts`, the bakes in `pipeline/`, the minimap's raster, the
ground plate (`bakePlate`), `RASTER_TURNS` and `setRasterTier`.

## Git workflow

- Branch: the one you were given, or `plan/077-one-rasters-module`.
- One commit per step at least (`refactor(build): …` for step 1,
  `refactor(viewer): …` for 2–4, `docs: …` for 5). Stage only the paths
  you changed. Do not push or open a PR unless told to.
- Step 1 can be its own PR (a build refactor; no snapshots needed if the
  output is byte-identical). Steps 2–4 change no picture by design, but
  touch rendering: their PR carries the `pr-snapshots` section anyway,
  with "before = production" (the look has no control for this).

## Steps

### Step 0: Baselines on the base commit (before any edit)

1. **The build's output.** `bun scripts/prepare-sites.ts dresden`, then
   copy `public/data/dresden/` to
   `<scratchpad>/077/before/dresden/`. Run it a second time into
   `before2/` and `diff -r before before2`: if two runs of the base differ,
   STOP (the comparison would mean nothing).
2. **Real-GPU plates.** Capture four to six snapshots from the Snapshot
   panel (`pr-snapshots` skill), all oblique, afternoon sun: a street with
   crossings and kerbs (fine level: markings, surface, edges), a sports
   ground with lines (desktop fine level only), an allotment colony
   (colonies), the Elbe meadows (NDVI, water, the class raster's
   shoreline), and one view from ≈ 400 m up across the city (the coarse
   level, the sky view and the horizon past the shadow frustum). Drop
   them in `shots/` and run `SHOTS_TAG=before bun run shots`.
3. **The probe.** Write a throwaway spec, `e2e/zz-raster-probe.spec.ts`
   (never committed), with two contexts: a desktop (1280×720) and a phone
   (`isMobile: true, hasTouch: true`, 390×844, `deviceScaleFactor: 3` —
   Chromium maps it to the coarse pointer, so the mobile tier and
   `lowRasters`). For each of `/dresden?scene=lite` and `/dresden`: record
   every request whose path ends in `.png` or `.json` under
   `/data/dresden/` (`page.on("request")`), wait for `__poc.ready`, let
   120 frames pass (`__poc.frames`), then record
   `__poc.handle.getGpuDebug()` (its `held`, `tileCache.bytes`,
   `tileCache.sizes`), `__poc.handle.getRenderInfo().gpuBytes` and
   `__poc.stats?.gpuMegabytes`. Add an uncommitted probe line at the end
   of `DressingPlugin.dressTerrain` that pushes
   `graphOf(mesh.material as Material)` (`material-slots.ts`) onto
   `globalThis.__terrainGraphs`, and record that list sorted. Write each
   run's JSON to `<scratchpad>/077/before/`. Run the full-profile pair
   twice to learn its noise (streaming order varies); the lite runs should
   repeat exactly.

**Verify**: the plates, two identical prepare outputs and the probe JSONs
exist. Keep the probe spec and probe line out of every commit (`git
status` before each commit).

### Step 1: The terrain's raster extras written from the table

1. `lib/city/tile.ts`: add a `terrain` column to `ArtifactSpec` and
   `TileArtifact` — the terrain extras key(s) each level names the file
   under, and the kinds it is written only beside:

   ```ts
   /** Named in the terrain extras: per level, the keys that carry it,
    *  and the kinds it is written only beside (a table and its raster). */
   terrain?: {
     levels: Partial<Record<0 | 1, readonly string[]>>;
     with?: readonly TileArtifactKind[];
   };
   ```

   Rows: `landcover` {0: [`landcover`]}, `landcoverLow` {0:
   [`landcoverLow`]}, `landcoverCoarse` {1: [`landcover`, `landcoverLow`]},
   `ndvi` {0, 1}, `surface` {0}, `edges` {0}, `sport` {0, 1; with
   `sportTable`}, `sportTable` {0, 1; with `sport`}, `cultivatedRaster`
   {0: [`cultivated`]}, `markings` {0; with `markingsTable`},
   `markingsTable` {0; with `markings`}, `markingsLow` {0; with `markings`,
   `markingsTable`}, `svf` {0, 1}, `horizon` {0, 1}. (Use a `satisfies`
   or a test to keep the keys within `keyof TerrainExtras`; an
   `import type` from `tileset.ts` is fine.)
2. Add the missing row: `cultivatedLow: { file: (tile) =>
   \`cultivated_${tile}.r1024.png\`, built: true, terrain: { levels: { 0:
   ["cultivatedLow"] }, with: ["cultivatedRaster"] } }`, placed right
   after `cultivatedRaster`. `built: true` keeps it out of
   `site-report.ts` and `tile-data.test.ts`'s committed-file checks.
3. `lib/city/tileset.ts`: add `terrainRasterExtras(names, level, crop)`
   (pure; `names: Partial<Record<TileArtifactKind, string>>`, `crop:
   TerrainExtras["cultivatedCrop"] | undefined`) returning the raster part
   of `TerrainExtras` **in today's key order** (Findings): `landcover`,
   `landcoverLow` (always written, `""` when missing), `ndvi`, `surface`,
   `edges`, `sport`, `sportTable`, `cultivated`, `cultivatedCrop`,
   `cultivatedLow`, `markings`, `markingsTable`, `markingsLow`, `svf`,
   `horizon`. The rows say *which* keys a level writes and beside what;
   the order is a key tuple in `tileset.ts`
   (`TERRAIN_RASTER_KEYS`), not `ARTIFACTS`' order. `cultivated` and its
   crop are written only with a crop. `tileset.ts` is already a terrain
   bake entry (`GROUND` in `scripts/bake-entries.ts`); `tile.ts` is in
   `BAKE_ENTRIES.terrain`: no new entry.
4. `scripts/prepare-data.ts`: `Published` becomes
   `Partial<Record<TileArtifactKind, string>>`; `publishColonies` takes
   the twin's file from `tileArtifacts(tile).cultivatedLow.file` (the same
   string); the publish loop skips `cultivatedLow` like `crowns`
   (`publishColonies` writes it); in `described` (≈ 1307) the hand-written
   raster fields and `...paintAndLight(...)` become one
   `...terrainRasterExtras(names, level, colonyCrops.get(tile))` at the
   same position, before `...waterExtras(...)`. Delete `paintAndLight`.
5. Tests. `lib/city/tileset.test.ts`: **before** editing `prepare-data.ts`,
   run today's `described` raster part and `paintAndLight` once (a
   temporary script) for fixtures — level 0 and 1; every file present;
   no low twins; a table without its raster and a raster without its
   table; a colony raster without a crop — and pin the outputs as literal
   `JSON.stringify` strings; then assert `terrainRasterExtras` gives the
   same strings. `lib/city/tile.test.ts`: every `terrain` key is a
   `TerrainExtras` key, and every kind named in `with` is a kind.

**Verify**: the unit tests above and `bun run verify` pass; then
`bun scripts/prepare-sites.ts dresden` (cold: `prepare-data.ts` and
`tile.ts` are in every terrain key) and `diff -r` of `public/data/dresden/`
against `before/dresden/` is **empty** — the manifest, every file name and
every byte. Report the bake time.

### Step 2: One decode-with-look path

1. `raster-upload.ts`: move in `RasterLook` (add `layers?: number` and
   `browserFallback?: true`), `lookAs` (as an internal `applyLook`),
   `decodeRaster`, `loadBitmapTexture`, and export one loader:

   ```ts
   /** A data raster on the GPU (or set up for the compile) when it
    *  resolves, or null: absent, undecodable, the wrong shape for
    *  `look.layers`, or refused by the GPU (freed). Rejects with an abort. */
   export function loadDataRaster(
     url: string,
     look: RasterLook,
     opts: { renderer?: WebGPURenderer; signal?: AbortSignal;
             inspect?: RasterInspect }
   ): Promise<LoadedRaster | null>;
   ```

   Inside its turn, in this order (today's): decode → `DataTexture` (R,
   RG, RGBA by `channels`) or, with `layers`, a `DataArrayTexture` of
   `width / channels` square layers after the shape check → `flipY =
   false`, `unpackAlignment = 1`, `needsUpdate`, `dropDataOnUpload` →
   `inspect` → `applyLook` (filters, mips, anisotropy, `NoColorSpace`,
   `trackTexture` with `textureBytes(w, h · layers, channels, mips)`) →
   `uploadNow`. The bitmap fallback only where `browserFallback` is set.
2. `terrain-layer.ts`: `loadRasterTexture`, `loadOptionalRaster`,
   `decodeRaster`, `loadBitmapTexture`, `lookAs` go; the wrappers become
   calls of `loadDataRaster` with today's looks (class and NDVI with
   `browserFallback: true`).
3. `sky-light.ts`: `loadLightRaster` goes; `loadSkyViewTexture` is
   `loadDataRaster(url, { channels: 1, filter: "linear", mipmaps: true },
   …)`, `loadHorizonTexture` the same with `{ channels: 4, filter:
   "linear", layers: HORIZON_TEXTURE_LAYERS }`. No fallback for either.
4. `raster-upload.test.ts`: its three tests call `loadDataRaster` with the
   NDVI look (its own interface now); add a horizon case (8 layers → a
   `DataArrayTexture` of `n × n × 8`; 7 layers' height → null) and a
   1-channel PNG the decoder rejects → null without `browserFallback`.

**Verify**: `bun test app/_components/raster-upload.test.ts`,
`bun run verify` pass. Probe (step 0.3) on the branch: requests,
`held`, `tileCache.bytes`, `gpuBytes` and the graph list equal the lite
baseline exactly, and the full-profile one within its noise. Plates
`SHOTS_TAG=after2 bun run shots`: the ground indistinguishable from
`before` (crowns and water move; judge the ground, the sky view in
courtyards and the far shadows).

### Step 3: The rasters module

1. Create `app/_components/tile-rasters.ts` with the interface and the
   kinds table above. Move `SplatRasters` (and the class kind's load:
   water mask, paint, abort-after-load disposal), the indexed pair's load
   (`tableTexture`, the table packers' calls) and `IndexedRaster` here.
   `readsSportGrounds` moves here too (re-export it from
   `terrain-layer.ts` only if a test still needs the old import path;
   prefer updating the test). Export the pure file resolver
   (`rasterFiles(extras, kind, low) → { raster, table? } | null`) for its
   tests.
2. Sharing: one `createSharedRasters` per kind, keyed by its file (and
   table file). `acquire` takes the share's reference **synchronously**,
   then returns `untilAborted(promise, signal)`; `release` lets go of
   every reference the holder took, once. Weighing: when an acquire
   resolves with a value for a weighed holder, hand its textures (class:
   texture and painted texture; pairs: raster and table) to the internal
   `RasterShares` and call `onShareChange` for each other holder it
   returns; `release` does the reverse. (Today a level is weighed from the
   end of `dressTerrain` — this starts at each acquire's resolution: the
   only timing change, steady state identical.)
3. `terrain-layer.ts`: `TerrainOptions` loses `fileUrl`, `renderer`,
   `lowRasters`, `skyView`, `horizon`, `splats`, `ndvis`, `sports` and
   gains `rasters: RasterHold`. `loadTerrainRasters` acquires, in today's
   order and all at once (one `settledAll` over the promises):
   `class`, `ndvi`, `surface`, `edges`, `sport`, `markings`, `colonies`,
   `horizon`, `svf`; without a class raster it calls `rasters.release()`
   and goes on with no detail (as `NO_DETAIL` did); `free` is
   `rasters.release()`. Build `SplatLayer`'s optional members directly
   (the colony rect from `colonyCropUv(extras.cultivatedCrop)` here).
   Delete the six look wrappers, `loadSplatTexture`, `loadSplatRasters`,
   `freeSplatRasters`, `sportKey`, `loadSportKey`, `freeSport`,
   `loadIndexedRaster`, `loadSportGrounds`, `loadMarkings`, `Hold`,
   `owning`, `DetailRasters`, `NO_DETAIL`, `splatDetail`, `splatRasters`.
   `TerrainLayer.rasters` keeps only the water tint (say so in its doc
   comment).
4. `sky-light.ts`: delete `loadSkyViewTexture` and `loadHorizonTexture`
   (the rows replace them).
5. `tile-stream.ts` `DressingPlugin`: one `readonly rasters =
   createTileRasters({ renderer: this.ctx.renderer, url: this.url,
   lowRasters: this.ctx.lowRasters, onShareChange: (root) => { const tile
   = this.tileOf.get(root as Object3D); if (tile) {
   this.tiles?.recalculateBytesUsed(tile); } } })` replaces the five
   shares and `rasterShares`; `holdRasters` goes; `dressTerrain` passes
   `rasters: this.rasters.holder(scene)`; `shareSkyView` takes
   `this.rasters.holder(scene, { weighed: false })`, keeps it on the
   `Dressed` entry and acquires `"svf"` with the city's extras; `release`
   lets go of it; `dispose` calls `this.rasters.clear()` once;
   `calculateBytesUsed` is `this.rasters.bytesOf(scene)` + the tracked
   bytes of `terrain.rasters` (the tint) + the dressing − shared, as now.
   The level's wait keeps its signal (`eitherSignal(own, this.lifetime)`,
   ≈ 1861): the loads themselves are the module's, and `clear` aborts them.
6. Tests, `app/_components/tile-rasters.test.ts`, through the interface
   only (fake `globalThis.fetch` serving small PNGs as
   `raster-upload.test.ts` builds them; a fake renderer whose
   `initTexture` records and calls `onUpdate`). Never test the class kind
   past its load (the paint needs a GPU); use another kind where a case
   needs a raster to land.
   1. a raster is on the GPU, set up as its row says, its bytes dropped,
      its tracked bytes known;
   2. two holders of one file: one fetch; freed with the last release;
   3. a holder released before its raster lands: freed when it lands; a
      load every holder left is aborted (the fetch's signal fires);
   4. a holder whose signal aborts while it waits rejects at once and,
      released, lets go (restates `terrain-layer.test.ts`'s "a level whose
      tile leaves while it waits…": keep that test too, rewritten to give
      `dressTerrain` a real holder over a fetch that never answers, and to
      assert the fetch was aborted);
   5. weighing: one holder whole, two half each, one leaving hands the
      other the whole and calls `onShareChange` for it; an unweighed
      holder (the buildings) changes nobody's share;
   6. `clear` frees what landed and aborts what is on its way;
   7. the files: a phone's fine level asks for `landcoverLow`,
      `markingsLow` (or `markings` when the twin is absent), `cultivatedLow`
      (or `cultivated`), no sports; a desktop's coarse level no sports; a
      pair with one file missing is null without a fetch;
   8. the looks: each row's filters, mips and anisotropy equal today's
      (`idLook`, `FIELD_LOOK`, `NDVI_LOOK`, the sky view's, the horizon's)
      — write the expected values out, do not import the old constants;
   9. the tie: every extras key the table reads is written by some
      `terrain` column of `tileArtifacts` (step 1).

**Verify**: `bun test app/_components/`, `bun run verify` pass;
`grep -n "createSharedRasters\|RasterShares\|loadNdviTexture\|loadSplatRasters\|sportKey" app/_components/tile-stream.ts app/_components/terrain-layer.ts`
→ no match; probe and plates as in step 2 (`SHOTS_TAG=after3`), with the
same rule: lite equal, full within noise; then
`bun run test:e2e --grep "@desktop-render|@phone"` and the whole
`bun run test:e2e`.

### Step 4 (optional): The crown sampler's second decode

Two options; do (a) only, unless a measurement asks for more.

- (a) **Same values, in the turn.** `loadNdviSampler` fetches through
  `fetchRasterBytes` and decodes inside `inRasterTurn`, so a phone's
  second decode no longer overlaps a turn's. The values are the same; the
  sampler still holds the decoded bytes while the dressing builds (as
  today).
- (b) **One decode.** The NDVI row's `inspect` could keep what the
  sampler needs — but the dressing runs after the upload dropped the
  bytes, so either the bytes live as long as the shared texture (a phone's
  memory grows: STOP) or a max-pooled grid is kept instead, which changes
  the crown colours (a look change: its own plan, with plates).

**Verify**: `bun test app/_components/vegetation-layer.test.ts`,
`bun run verify`; the probe's requests and bytes unchanged; one plate of
a park in leaf (crown tints) against `before`.

### Step 5: Docs

- `docs/rendering.md`: the phone-memory paragraph (≈ 780, "shared by file
  … `shared-rasters.ts`"), the decode-turn paragraph (≈ 937) and "The
  burst is paced" (≈ 1384, `loadTerrainRasters`) name `tile-rasters.ts`:
  "a content root takes its rasters by kind from `tile-rasters.ts`
  (shared by file, weighed a share per level); `raster-upload.ts` decodes
  and uploads them in the site's turn".
- `docs/data-pipeline.md` (≈ 687, the terrain glb's `extras` list): the
  raster keys are written from the artifact table's `terrain` column
  (`terrainRasterExtras`); add the keys it leaves out today (`cultivated`,
  `cultivatedCrop`, `cultivatedLow`, `markings`, `markingsLow`,
  `markingsTable`, `svf`, `horizon`).
- `docs/transformations.md` (≈ 4288, the sky view "shared-rasters.ts"):
  name `tile-rasters.ts`.
- `.claude/skills/city-walker/SKILL.md` (the `sky-light.ts` bullet and the
  Surfaces paragraph): the same names.
- `docs/plans/README.md`: this plan's row; backlog item 22 marked built
  (with what remains: the slot lists, `TerrainExtras` still hand-typed);
  the 2026-10-01 NDVI bullet if step 4 ran.

**Verify**: `bun test lib/docs` → pass (links and paths).

### Step 6: The gate

`bun run fix && bun run verify` → exit 0. Delete the probe spec and the
probe line; `git status --short` shows only in-scope files.

## Verification (the whole change)

- **Byte-identical build** (step 1): `diff -r` of `public/data/dresden/`
  empty against the base's.
- **Same programs**: the sorted terrain graph keys at both lite views
  (desktop, phone) equal the base's.
- **Same requests**: the set of raster and table URLs each profile asked
  for equals the base's (a wrong twin shows here first).
- **Phone memory** (ADR 0047): on the phone lite run, `held.textures`,
  `tileCache.bytes`, `tileCache.sizes` and `gpuBytes` equal the base's;
  on the full run none exceeds the base's range over two runs. Byte
  totals must not grow.
- **Upload order**: no edit to `RASTER_TURNS`, `setRasterTier`,
  `uploadNow` or `inRasterTurn`; `uploadNow` is still called inside the
  turn, after the look. Case 1 of the module's tests pins it.
- **Real GPU**: `before` / `after` plates of the oblique views; the ground
  unchanged. The PR carries the views as snapshot JSON (`pr-snapshots`).

## Done criteria

- [ ] `lib/city/tile.ts` has a `cultivatedLow` row and a `terrain` column;
      `grep -n 'TileArtifactKind | "cultivatedLow"' scripts/prepare-data.ts` → no match
- [ ] `grep -n "paintAndLight" scripts/prepare-data.ts` → no match
- [ ] `public/data/dresden/` byte-identical to the base's
- [ ] `app/_components/tile-rasters.ts` exports `createTileRasters`,
      `RasterKind`, `TileRasters`, `RasterHold`
- [ ] `grep -cn "createSharedRasters" app/_components/tile-stream.ts` → 0;
      `grep -n "RasterShares" app/_components/tile-stream.ts` → no match
- [ ] `grep -n "loadNdviTexture\|loadSurfaceTexture\|loadEdgesTexture\|loadColonyTexture\|loadSplatTexture\|loadSkyViewTexture\|loadLightRaster\|loadOptionalRaster" app/_components/*.ts` → no match
- [ ] `bun test app/_components/tile-rasters.test.ts` → ≥ 9 pass
- [ ] the probe's lite runs equal the base's (requests, graph keys, bytes)
- [ ] `bun run verify` exits 0; the e2e passes
- [ ] docs updated; `docs/plans/README.md` row for 077 updated

## STOP conditions

Stop and report (do not improvise) if:

- Two runs of the base's prepare differ (step 0), or the branch's output
  differs from the base's in any byte (step 1) and the cause is not a key
  order you can see and fix in `terrainRasterExtras`.
- The terrain graph keys differ at any probe view: a raster present on
  one side and not the other is another program (ADR 0027).
- Any byte total on the phone profile grows, or the phone asks for a
  full-size file it did not ask for before (a twin lost).
- Keeping the behaviour needs an edit to `raster-upload.ts`'s gate, its
  limits, `uploadNow`, or where `uploadNow` is called.
- A raster's look (filter, mips, anisotropy, channels, orientation) would
  have to change to fit the table.
- Step 4 (b) would keep CPU bytes past the upload, or change the
  sampler's values.
- Merging the two holder counts looks necessary (it changes what the
  cache weighs a building tile by — a decision for the maintainer).
- A plate shows a tile's ground plain sage, black, or without a term it
  had (WebGPU-only failures do not show in the headless e2e).
- Something outside the files in Findings reads a raster extras field or
  one of the deleted loaders (grep before deleting).

## Out of scope

- Typing `TerrainExtras`' raster fields from the rows, and the slot lists
  (`SplatLayer` … `splatSlots`): what keeps a new raster at ≈ 7 edits
  (row, extras field, kinds row, `SplatLayer`, `SplatNodes`/`splatNodes`,
  `splatVariant`, `splatSlots`) plus its shader term and its bake.
- Weighing the buildings' share of the sky view (a change to eviction).
- Dropping the browser-decoder fallback (Maintenance notes).
- The sports table's second fetch; the colony crop's own file; KTX2
  (rejected: data, not colour); the minimap raster; the ground plate.

## Maintenance notes

- A new raster: a row in `ARTIFACTS` with its `terrain` column (and its
  key in `TERRAIN_RASTER_KEYS`, at the end, so no other glb's bytes
  change), its `TerrainExtras` field, a `RASTER_KINDS` row, and the slot
  lists. A new tier twin or gate is a column of its row, never a branch in
  `terrain-layer.ts`.
- `tile.ts` and `tileset.ts` are bake entries: an edit there re-bakes
  every site's terrain. The runtime kinds table is deliberately not in
  `lib/city/` bake entries, so a look column never re-bakes anything.
- The browser-decoder fallback (class, NDVI) contradicts the hard rule on
  data rasters and serves only a PNG `png-raster.ts` rejects; if the
  decoder covers every baked PNG, remove the column (a one-row change)
  and say so in `docs/rendering.md`.
- `RasterShares` and `SharedRasters` count different holders on purpose
  (the buildings hold the sky view, unweighed); plan 041's split stands.
- Reviewer: diff the probe's request lists and graph keys before and
  after, per tier — they must be identical.
