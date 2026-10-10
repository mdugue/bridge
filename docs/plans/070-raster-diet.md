# Plan 070: Each tile holds a fraction of the raster memory it holds today

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Step 4 is optional and gated on a real-GPU look. If anything
> in the "STOP conditions" section occurs, stop and report — do not
> improvise. When done, update the status row for this plan in the plans
> index — unless a reviewer dispatched you and told you they maintain it.
>
> **Drift check (run first)**:
> `git diff --stat 85a41b7..HEAD -- lib/city/tile.ts lib/city/tile.test.ts scripts/prepare-data.ts app/_components/terrain-layer.ts app/_components/terrain-layer.test.ts app/_components/landcover-splat.ts docs/rendering.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Status (2026-10-10)**: **PARTIAL** — steps 1–3 built on the
  performance PR (`COARSE_RASTER_PX`, `landcoverCoarse`, the coarse level
  names it on every tier; `readsSportGrounds` = a desktop's fine level
  only). Open: step 4 (the desktop fine splat at half resolution — needs
  the real-GPU look) and step 5's measurements on a GPU and a phone.

- **Priority**: P1
- **Effort**: S–M (steps 1–3); M for optional step 4
- **Risk**: LOW–MED (softer far ground colours; sports-ground lines gone on phones)
- **Depends on**: none (composes with 068 and 071)
- **Category**: perf (GPU memory — the phones' crashes; the desktop cache)
- **Planned at**: commit `85a41b7`, 2026-10-10

## Why this matters

Phones lose their GPU at 495–761 MB held (docs/rendering.md, "GPU memory
on a phone"; Sentry CITY-WALK-1…8), and the tile cache gives a phone only
**336 MiB** for every tile it holds (`app/_components/scene-profile.ts`,
`TILE_CACHE_BYTES`). Most of a tile's weight is rasters, and several are
far larger than what they draw needs:

| Raster (per tile) | Today | Needed |
|---|---|---|
| Coarse level's class raster + painted splat (with mips), both tiers | 2048²: 4 + 21.3 MiB | the coarse level draws a 40 m-error mesh 2.1–2.6 km out, mostly under the fog: 1024² (1 + 5.3 MiB) is ample |
| Sports-ground index raster (2048² RGBA) | **16 MiB** per tile on the GPU for a PNG of **24 KB** (Hamburg `sport_32564_5934_2_hh.png`) — read by both levels on a desktop, by the fine level on a phone | nothing beyond the fine level; on a phone nothing (lines lost) |
| Desktop fine level's painted splat (4096² RGBA + mips) | **≈ 85 MiB** | 2048² (≈ 21 MiB), optional, step 4 |

Measured sizes: the published PNG headers of `public/data/hamburg/*32564_5934*`
(class 4096², `.r2048`, `.r512`; sport/markings/surface 8192×2048 grey =
2048² RGBA; edges 4096×2048 grey = 2048² RG; NDVI and sky view 1024²).
Steps 1–3 cut ≈ 19 MiB from every tile showing its coarse level, another
16 MiB from every desktop coarse-only tile, and 16 MiB from every phone
fine tile — a phone's fine tile goes from 75.7 to ≈ 60 MiB and a coarse
one from ≈ 30 to ≈ 11 MiB. More tiles fit under the cache, fewer get
evicted and re-streamed (less jank), and the governor's lines are reached
later (fewer crashes).

## Current state

- `lib/city/tile.ts` — the artifact table. Lines 33 and 100:
  `export const MOBILE_RASTER_PX = 2048;`, `export const SMALL_RASTER_PX = 512;`.
  Lines 132–147:
  ```ts
  landcover: { file: named("landcover", "png"), required: true },
  landcoverLow: {
    file: (tile) => `landcover_${tile}.r${MOBILE_RASTER_PX}.png`,
    required: true,
    bakedFrom: { file: named("landcover", "png"), raster: MOBILE_RASTER_PX },
  },
  landcoverSmall: {
    file: (tile) => `landcover_${tile}.r${SMALL_RASTER_PX}.png`,
    required: true,
    bakedFrom: { file: named("landcover", "png"), raster: SMALL_RASTER_PX },
  },
  ```
  A `bakedFrom` artifact is made by `prepare-data.ts` from the committed
  4096² raster (no Python re-bake, nothing new committed), and the data
  tests skip it (`lib/city/tile-data.test.ts:109` filters `!a.bakedFrom`).
- `scripts/prepare-data.ts:488–501` publishes every `bakedFrom` artifact
  through `downsampleClassRaster(src, raster)` (NEAREST, so no class id
  blends), cached by content. Lines 942–943 name the class rasters in each
  level's extras:
  ```ts
  landcover: (level === 0 ? names.landcover : names.landcoverLow) ?? "",
  landcoverLow: names.landcoverLow ?? "",
  ```
- `app/_components/terrain-layer.ts:1416` — the only reader:
  `const classFile = opts.lowRasters ? extras.landcoverLow : extras.landcover;`
  The splat is painted at the class raster's size
  (`paintLandcoverSplat(renderer, texture, width, height)`,
  `landcover-splat.ts:172`; one paint pass per raster size, a scene
  material keyed `landcover-splat-WxH`).
- `app/_components/terrain-layer.ts:1441–1443`:
  ```ts
  export function readsSportGrounds(level: 0 | 1, lowRasters: boolean): boolean {
    return !(lowRasters && level === 1);
  }
  ```
  Its test: `app/_components/terrain-layer.test.ts:76–90`
  (`"a phone's coarse level reads no sports grounds, …"`).
- Docs: `docs/rendering.md` "GPU memory on a phone" (the per-tile MiB
  numbers) and the frame-budget table row *Land-cover rasters*
  (`L0 4096², L1 2048²`).

Conventions: the artifact table is the one place a tile's files are
named; tests pin it (`lib/city/tile.test.ts`, exemplar
`"the minimap and the soundscape read a 512² class raster baked from the 4096² one"`).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Unit tests | `bun run test` | all pass |
| Focused | `bun test lib/city/tile.test.ts app/_components/terrain-layer.test.ts` | all pass |
| Typecheck / lint | `bun typecheck && bun run fix && bun lint` | exit 0 |
| Prepare one site | `bun scripts/prepare-sites.ts dresden` | exit 0; `public/data/dresden/manifest.json` lists `landcover_*.r1024.png` |
| E2E | `bun run build && bun run test:e2e` | all pass |
| Real-GPU plates | `bun run shots` | PNGs in `shots/` |

## Scope

**In scope**: `lib/city/tile.ts`, `lib/city/tile.test.ts`,
`scripts/prepare-data.ts` (the two extras lines), `app/_components/terrain-layer.ts`
(`readsSportGrounds` only), `app/_components/terrain-layer.test.ts`,
`app/_components/landcover-splat.ts` (step 4 only), `docs/rendering.md`.

**Out of scope**: the Python bakes (`pipeline/`); the committed rasters in
`data/<site>/dlm/`; the markings, surface and edges rasters (step 5 notes
them as follow-ups); `scene-profile.ts`'s cache bounds and
`LARGEST_TILE_BYTES` (keep them — they become conservative, which is safe).

## Git workflow

- Branch: `perf/070-raster-diet`
- Conventional Commits, e.g. `perf(terrain): the coarse level paints a 1024² splat`.
- This changes what the viewer shows: the PR carries snapshots
  (`.claude/skills/pr-snapshots/`).

## Steps

### Step 1: A 1024² class raster for the coarse level

In `lib/city/tile.ts`, add `export const COARSE_RASTER_PX = 1024;` with a
doc comment (the coarse level is a 40 m-error mesh shown from ~2.1 km on a
phone and ~2.6 km on a desktop at the default error target, where the fog
ends; 2 m texels are ≈ 1 px there), and an artifact next to
`landcoverLow`:

```ts
landcoverCoarse: {
  file: (tile) => `landcover_${tile}.r${COARSE_RASTER_PX}.png`,
  required: true,
  bakedFrom: { file: named("landcover", "png"), raster: COARSE_RASTER_PX },
},
```

Update `lib/city/tile.test.ts`: the required list gains
`"landcoverCoarse"` (sorted), and add a test mirroring the 512² one for
the 1024² raster.

**Verify**: `bun test lib/city/tile.test.ts` → pass. `bun run test` → all
pass (if `lib/city/tile-data.test.ts` or `features.test.ts` fail on the new
kind, read why — they should skip `bakedFrom`; STOP if they do not).

### Step 2: The coarse level names it, on both tiers

In `scripts/prepare-data.ts` (lines 942–943), level 1 names the coarse
raster in both fields:

```ts
landcover:
  (level === 0 ? names.landcover : names.landcoverCoarse) ?? "",
landcoverLow:
  (level === 0 ? names.landcoverLow : names.landcoverCoarse) ?? "",
```

Nothing changes in `terrain-layer.ts`: line 1416 already reads
`landcoverLow` on a phone and `landcover` on a desktop, and both now name
the 1024² file at level 1. (On a phone the two levels no longer share one
class raster: a tile showing its fine level holds 2048² + 1024², +6.3 MiB;
every coarse-only tile saves ≈ 19 MiB. Most tiles in view are coarse-only.)

**Verify**: `bun scripts/prepare-sites.ts dresden` → exit 0, and
`grep -c 'r1024' public/data/dresden/manifest.json` → ≥ 1 (one entry per
tile in its file map). The level's extras live in each terrain glTF's JSON
chunk (`writeMeshGlb({ … extras })`), so check one coarse and one fine
level:
`for f in public/data/dresden/terrain_33412_5656_2_sn_l1.*.glb.gz public/data/dresden/terrain_33412_5656_2_sn_l0.*.glb.gz; do echo "$f $(gunzip -c "$f" | strings | grep -o 'landcover_[^"]*png' | sort -u | tr '\n' ' ')"; done`
→ the `_l1` file names only `…r1024.png`; the `_l0` file names the 4096²
file and `…r2048.png` as before.

### Step 3: Sports grounds on the fine level only — and not at all on a phone

Change `readsSportGrounds` to:

```ts
/**
 * Whether a terrain level reads its tile's sports grounds: the fine level
 * on a desktop only. The index raster is a 2048² RGBA — 16 MiB on the GPU
 * for a PNG of a few dozen kB — and the lines it places are a pixel or
 * less beyond the fine level's reach. A phone draws its pitches in their
 * land-cover class, without lines: 16 MiB a fine tile, against a 336 MiB
 * cache. Without the slot the level builds the variant every tile without
 * grounds shares.
 */
export function readsSportGrounds(level: 0 | 1, lowRasters: boolean): boolean {
  return level === 0 && !lowRasters;
}
```

Update the test (`terrain-layer.test.ts:76–90`): rename it to say what
it pins now, and assert `readsSportGrounds(0, false) === true`,
`readsSportGrounds(1, false) === false`, `readsSportGrounds(0, true) === false`,
`readsSportGrounds(1, true) === false`; keep the shared-variant
assertions.

Check other users of the sports grounds on a phone:
`grep -rn "sport" app/_components/tile-stream.ts app/_components/sport-fixtures.ts`
— the goals and nets (`buildSport`) come from the table, not the raster;
they stay. If anything else needs the raster on a phone, STOP.

**Accepted compromise** (say it in the PR): on a phone, pitches show
their land-cover green without lines; goals and nets stay.

**Verify**: `bun test app/_components/terrain-layer.test.ts` → pass;
`bun run test` → all pass.

### Step 4 (optional; only after a real-GPU look approves it): the desktop fine splat at half resolution

Paint the desktop fine level's splat at 2048² from its 4096² class raster:
in `landcover-splat.ts`, give `paintLandcoverSplat` an optional `scale`
(1 or 2); with 2 the target is `width/2 × height/2`, and the pass reads
the 2×2 class texels under each target texel (`screenCoordinate × 2 +
{0,1}²`), averages their four palette colours, and computes the water
coverage with the 3×3 tent over the 2×-scaled neighbourhood (or a 4×4 box
— whichever keeps the shoreline as soft as before in the plate). The
pass's scene-material key must include the scale. Call it with `scale: 2`
only where the class raster is 4096² (`width > MOBILE_RASTER_PX`).

Gate: plates from `bun run shots` of (1) the Elbe shore at the spawn
tile, (2) a street with a meadow edge at eye level looking along it at a
grazing angle, (3) a park from 50 m up — `main` vs branch. If the class
boundaries or the shoreline look visibly blockier, drop this step (revert
it) and record why.

**Verify**: `bun run test` → pass; plates recorded in the PR.

### Step 5: Measure, look, document

0. **The coarse level up close.** The "2.1–2.6 km, under the fog"
   argument for 1024² holds at the memory governor's step 0 only. At
   step 3 (error target ×8 — a phone at `?safety=3` starts there,
   `lib/city/memory-governor.ts`) the coarse level shows from roughly
   260–330 m, where a 1024² texel (≈ 2 m) is 5–7 px. Take a real-GPU
   plate (`bun run shots`, phone viewport, `/dresden?safety=3`) 300 m from
   a street/meadow boundary and the Elbe shore, `main` vs branch. If it is
   unacceptable, the knob is: 1024² for the coarse level on a desktop
   only, and the 2048² file kept for a phone's coarse level
   (`prepare-data.ts`: level 1's `landcoverLow` stays `names.landcoverLow`)
   — record which was chosen and why.
1. In `bun dev`, at the Dresden spawn and after a flight to the far east
   tile and back, read `__poc.handle.getGpuDebug()` (or the crash trail's
   beat, `crashTrail.current()`: `rasterMB`, `heldMB`) on `main` and the
   branch, desktop and (if available) a phone. Record the numbers.
2. Update `docs/rendering.md`: the frame-budget row *Land-cover rasters*
   (`L0 4096², L1 1024²` on a desktop; `L0 2048², L1 1024²` on a phone),
   the "Per tile" paragraph of "GPU memory on a phone" with the new MiB,
   and the sports-raster sentence. Note the follow-ups in
   `docs/plans/README.md`'s backlog: a 1024² twin of the phone's surface
   raster (16 MiB → 4 MiB; needs a 4-byte-group NEAREST downsample in
   `scripts/downsample-raster.ts`), and the same for the markings at 2048²
   on a desktop.

**Verify**: `bun run test` → pass (the docs link test).

## Test plan

- `lib/city/tile.test.ts`: the new artifact (file name, `bakedFrom`,
  required list).
- `app/_components/terrain-layer.test.ts`: the new `readsSportGrounds`
  truth table; the shared-variant assertions kept.
- Step 4 (if done): a unit test that the scaled paint pass's key differs
  from the unscaled one (pattern: the existing splat tests in
  `app/_components/landcover-splat.test.ts`).
- `bun run test`; `bun run build && bun run test:e2e`.

## Done criteria

- [ ] `bun typecheck`, `bun lint`, `bun run test` exit 0
- [ ] `public/data/dresden/manifest.json` lists a `.r1024.png` per tile after `bun scripts/prepare-sites.ts dresden`
- [ ] `readsSportGrounds(1, false) === false` and `readsSportGrounds(0, true) === false` are tested
- [ ] `bun run build && bun run test:e2e` passes
- [ ] Before/after `rasterMB`/`heldMB` recorded in the PR; snapshots in the PR description
- [ ] `docs/rendering.md` updated
- [ ] No files outside the in-scope list modified

## STOP conditions

- Drift in the excerpts.
- A data test (`tile-data.test.ts`, `features.test.ts`) demands the new
  kind be committed under `data/` — it must not be (it is baked at build).
- A real-GPU plate shows the coarse level's ground visibly wrong (a class
  colour that flashes as the fine level replaces it, a seam between the
  levels' colours): report with the snapshot JSON.
- Anything on a phone needs the sports raster beyond the terrain's colour.

## Maintenance notes

- A new raster read by the coarse level should come at `COARSE_RASTER_PX`
  or below; a new per-tile raster should be weighed against the phone's
  336 MiB before it ships (the cache weighs it, but the user pays in
  evictions).
- `LARGEST_TILE_BYTES` and `TILE_CACHE_BYTES` were derived for the old
  sizes; they are now conservative. Re-derive them only with a phone
  measurement (ADR 0047).
- Reviewer: the splat's mip chain is what makes the coarse ground calm at
  grazing angles — check the plates at a low camera over the far tiles.
