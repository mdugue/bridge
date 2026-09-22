# Plan 016: Replace sharp with Bun.Image for the raster downsample

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Premise drift (noted 2026-09-22, when the plans moved into `docs/`)**:
> `package.json` already pins `packageManager: bun@1.4.2`, yet `bun.lock` is
> still `lockfileVersion: 1` and `sharp` remains in `dependencies` and
> `trustedDependencies` — so the Bun-pin half of Step 1 happened elsewhere
> and everything from Step 0 onward is untouched. Re-verify whether Bun
> 1.4.2 rewrites the lockfile to v2 before trusting the lockfile reasoning
> below; the measured numbers (+24 % RGB / +21 % class PNG size, pixels
> equivalent) still stand.
>
> **Drift check (run first)**:
> `git diff --stat e1c00c9..HEAD -- scripts/downsample-raster.ts scripts/downsample-raster.test.ts scripts/prepare-data.ts package.json bun.lock AGENTS.md docs/transformations.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S (one function, one test, one dependency, the Bun pin)
- **Risk**: MED — not the code, the deploy toolchain (Step 0 is the gate)
- **Depends on**: PR #28 and PR #29 merged (this plan rewrites the file
  #29 introduces); Step 0 answered "yes"
- **Category**: dx / dependency hygiene
- **Planned at**: commit `e1c00c9` (branch `claude/code-review-findings-64m8wz`,
  PR #29), 2026-09-21
- **Status**: TODO — gated on Step 0

## Why this matters

`sharp` is the build step's only native dependency and it exists for one
function: `scripts/downsample-raster.ts`, which turns the committed 4096²
land-cover rasters into the 2048² variants (`lib/city/tile.ts`,
`landcoverArtifact`). It costs ~30 MB of platform binaries (libvips) per
install, needs a `trustedDependencies` entry for its postinstall, and its
resampler premultiplies alpha across `resize` — which, because the RGB
splat's alpha is *water coverage*, turned every land texel black until
PR #29 split colour and alpha into two resizes.

Bun 1.4 ships `Bun.Image` built in: PNG decode → resize → PNG encode with
both kernels this bake needs (`nearest` for class ids, `lanczos3` for
colour) and **straight (non-premultiplied) alpha throughout**. The function
shrinks from ~60 lines to ~10, the workaround and its AGENTS.md paragraph go
away with the dependency, and `Bun.Image` is already typed in the installed
`@types/bun` (`node_modules/bun-types/bun.d.ts`, `export class Image`).

### Measured (Bun 1.4.2 binary vs sharp 0.35.4, primary tile, 4096² → 2048²)

| | Bun.Image | sharp (PR #29's split) |
|---|---|---|
| RGB splat, lanczos3 | 952 ms, **613 KB**, RGBA, 0 black land texels, land mean 220/215/198 | 968 ms, **495 KB**, RGBA, same pixels |
| Class raster, nearest | 738 ms, **105 KB**, RGBA (alpha 255), ids exactly `1..8` | 434 ms, **87 KB**, grey+alpha, ids exactly `1..8` |

Pixels are equivalent (checked texel by texel with the same statistics PR #29
used). Speed is a wash: Bun's own PR notes say the integer pre-shrink for
PNG downscales is not implemented yet. **Files grow ~24 % (RGB) / ~21 %
(class)** because Bun.Image standardises on RGBA8 and its libspng encoder
packs less tightly than libvips at level 9: about **+0.4 MB per desktop
visit** (three neighbour pairs) and **+0.5 MB on phones** (all four), on an
18–74 MB boot. Accept it or stop here — there is no lossless knob to claw it
back (`png({ palette: true })` quantises, which is lossy for the RGB splat
and not guaranteed id-exact for the class raster).

## Current state

### `scripts/downsample-raster.ts` (PR #29)

```ts
export async function downsampleRaster(
  source: string | Buffer,
  px: number,
  kernel: RasterResample
): Promise<Buffer>
```

Decodes with sharp, resizes the colour bands and the alpha band as two
alpha-less raw images (`removeAlpha()` / `extractChannel()` → raw →
`resize` → `joinChannel`), pins single-band stages to `b-w` so sharp does
not widen them to sRGB, and encodes PNG at `compressionLevel: 9`. The
header comment explains the premultiply trap. `scripts/prepare-data.ts`
imports it and lists it in `RASTER_BAKE_SOURCES`, so a change to the file
re-bakes all eight variants (`isStale(dest, src, ...RASTER_BAKE_SOURCES)`).

### `scripts/downsample-raster.test.ts` (PR #29)

Three tests on synthetic rasters: land colour survives alpha 0 under
`lanczos3` (the regression); `nearest` keeps class ids exact, opaque and in a
2-band grey+alpha layout; a raster without alpha resizes as is. Synthetic
inputs are *encoded* with sharp and outputs are *decoded* through sharp's
`.raw()` plus `metadata()` for the band layout.

### `package.json`

- `"sharp": "^0.35.4"` in `dependencies`; `trustedDependencies: ["sharp",
  "unrs-resolver"]`
- `"packageManager": "bun@1.3.11"`; `bun.lock` is `lockfileVersion: 1`
- `"@types/bun": "^1.4.2"` already (Bun.Image is typed)
- CI (`.github/workflows/ci.yml`) installs Bun from `packageManager`
  (`bun-version-file: package.json`)
- No `vercel.json`. The Vercel deploy runs the `build` script
  (`bun scripts/prepare-data.ts && next build`) — `public/data` is
  gitignored, so the bake runs on every deploy with the build container's
  Bun.

### What `Bun.Image` offers and lacks (Bun 1.4.2)

- Inputs: path, `Uint8Array`/`ArrayBuffer`, `Blob`/`BunFile`; `metadata()`
  gives `{ width, height, format }` only (no channels / hasAlpha).
- `resize(w, h, { fit: "fill" | "inside", filter, withoutEnlargement })`;
  filters `nearest | box | bilinear | cubic | mitchell | lanczos2 | lanczos3 |
  mks2013 | mks2021`.
- `png({ compressionLevel: 0–9, palette, colors, dither })` → always RGBA8
  (or RGB when opaque — verify in Step 5; the class raster came out RGBA
  with alpha 255).
- **No raw pixel output** (no `.raw()`, no pixel arrays), so the unit test
  needs a pure-JS PNG decoder.
- Straight alpha end to end (Bun PR #30032); platform backends that hand
  over premultiplied data are un-premultiplied at the boundary.

### The deploy toolchain (why Step 0 exists)

Bun 1.4 writes `bun.lock` as `lockfileVersion: 2`, which Bun 1.3 cannot
parse. Vercel's build container bundles Bun 1.3.14 at `/bun1` and also
ships `/bun1.4`. Neither `packageManager` nor `bunVersion` in `vercel.json`
changes which Bun runs the install (vercel/vercel#17577, closed); the fix
that routes `bun install` to `/bun1.4` when the lockfile is version 2
(vercel/vercel#17608) merged on 2026-09-15 and covers the **install
phase**. Which Bun runs the **build command** — where prepare-data would
call `Bun.Image` — is not documented anywhere. On Bun 1.3 that call throws
(`Bun.Image` is undefined) and the deploy fails.

## Scope

**In**: `scripts/downsample-raster.ts`, its test, `package.json` +
`bun.lock` (Bun pin, sharp out, decoder in), `AGENTS.md`,
`docs/transformations.md`, `plans/README.md`.

**Out**: any change to what is baked (edges, kernels, file names,
`RASTER_BAKE_SOURCES`), to `lib/city/tile.ts`, to the client, or to CI
beyond what the Bun pin implies. No `vercel.json` unless Step 0 forces the
override route and the maintainer chooses it.

## Steps

### Step 0: Confirm the deploy runs Bun 1.4 (the gate)

1. Open the latest production build log on Vercel for this project. Find
   the install line (`bun install …`) and the build line (`Running "bun run
   build"` or the framework equivalent) and read the Bun version each
   reports. If the log does not print one, push a probe branch whose
   `build` script starts with `bun --version &&` and read the preview
   deploy's log.
2. Both must be **1.4.x**. Install logging `Unknown lockfile version` /
   `Ignoring lockfile`, or the build command running 1.3.x, is a STOP.

If it is a STOP, the only known workaround is a project-level override in
Vercel's Build & Development Settings (or `vercel.json`): `installCommand:
"npx --yes bun@1.4.2 install --frozen-lockfile"` and `buildCommand: "npx
--yes bun@1.4.2 run build"`. That downloads Bun on every deploy and pins
the version in a second place; it is a maintainer decision, not the
executor's. Record the outcome in the PR either way.

**Verify**: the two version strings, pasted into the PR description.

### Step 1: Bump Bun first, alone

1. `packageManager` → `"bun@1.4.2"` (or the current 1.4.x; check
   `registry.npmjs.org/bun/latest`).
2. Install that Bun locally (`bun upgrade`, or
   `curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"`), then
   `bun install` — the lockfile becomes `lockfileVersion: 2`.
3. Commit this on its own so a Bun-only regression is separable.

**Verify**: `bun --version` → `1.4.2`; `head -2 bun.lock` shows
`"lockfileVersion": 2`; `bun install --frozen-lockfile && bun run verify`
→ exit 0 (148+ tests).

### Step 2: Rewrite the resampler

Replace the body of `scripts/downsample-raster.ts` (keep the export name;
`prepare-data.ts` calls `writeFileSync(dest, await downsampleRaster(...))`,
which takes a `Uint8Array`):

```ts
import type { RasterResample } from "../lib/city/tile";

const PNG = { compressionLevel: 9 } as const;

/**
 * The raster at `px`² as a PNG. NEAREST keeps class ids exact (none may
 * blend); Lanczos filters colour. Bun.Image resamples straight alpha, so
 * the RGB splat's land colour (alpha = water coverage = 0) survives — the
 * sharp version needed a colour/alpha split because sharp premultiplies
 * (see docs/transformations.md). Output is always RGBA8.
 */
export function downsampleRaster(
  source: string | Uint8Array,
  px: number,
  kernel: RasterResample
): Promise<Uint8Array> {
  return new Bun.Image(source)
    .resize(px, px, { fit: "fill", filter: kernel })
    .png(PNG)
    .bytes();
}
```

Rewrite the file header: what the trap *was* and that Bun.Image does not
have it; point at the test as the guard.

**Verify**: `bun typecheck` → exit 0 (`filter: kernel` must type-check
against Bun's `Filter` union without a cast; if it does not, STOP and
report the union).

### Step 3: Give the test a decoder and an encoder

1. `bun add -d fast-png` (pure JS: `fflate` + `iobuffer`; written in
   TypeScript, declarations ship in `lib/`). `decode(bytes)` returns
   `{ width, height, channels, depth, data }`; `encode({ width, height,
   channels, data })` returns PNG bytes. If the declarations are missing or
   `channels` is not reported, STOP: fall back to `pngjs` + `@types/pngjs`.
2. Build the synthetic inputs with `encode(...)` instead of sharp, decode
   outputs with `decode(...)`. Keep the three tests and their assertions,
   with two layout changes: the class-raster test now expects **4 channels
   with alpha 255** (Bun.Image emits RGBA), and the no-alpha test expects
   RGB or RGBA (assert `channels >= 3` and every channel value ≈ 200).
3. The alpha-0 colour assertion (`texel(0, y)` ≈ `[220, 215, 198, 0]`,
   no all-zero RGB anywhere) is the reason this test exists — keep it
   exactly.

**Verify**: `bun test ./scripts` → 3 pass. Temporarily change `filter` to
resize through a premultiplying path is not possible here, so instead
sanity-check the test bites: set `px` in the first test to `8` and confirm
the `[16, 16, …]` layout assertion fails, then restore.

### Step 4: Remove sharp

1. `bun remove sharp`; delete `"sharp"` from `trustedDependencies`
   (keep `unrs-resolver`).
2. `grep -rn 'from "sharp"' --include=*.ts . | grep -v node_modules` → no
   output.

**Verify**: `bun install --frozen-lockfile && bun run verify` → exit 0;
`ls node_modules/@img 2>/dev/null` → nothing (the libvips binaries are
gone).

### Step 5: Bake and check the pixels

1. `bun scripts/prepare-data.ts` → the log shows all eight `downsampled …`
   lines (the resampler changed, so `RASTER_BAKE_SOURCES` marks every
   variant stale).
2. Run the check below (scratch script, not committed) against
   `.cache/prepare-data/`:

```ts
import { decode } from "fast-png";
import { NEIGHBOUR_TILES, PRIMARY_TILE } from "../lib/city/tile";
for (const tile of [PRIMARY_TILE, ...NEIGHBOUR_TILES]) {
  const rgb = decode(await Bun.file(`.cache/prepare-data/landcover_rgb_${tile}.r2048.png`).bytes());
  let land = 0, black = 0;
  for (let i = 0; i < rgb.width * rgb.height; i++) {
    if (rgb.data[i * rgb.channels + 3] !== 0) continue;
    land++;
    if (!rgb.data[i * 4] && !rgb.data[i * 4 + 1] && !rgb.data[i * 4 + 2]) black++;
  }
  const cls = decode(await Bun.file(`.cache/prepare-data/landcover_${tile}.r2048.png`).bytes());
  const src = decode(await Bun.file(`data/dlm/landcover_${tile}.png`).bytes());
  const ids = new Set<number>(), srcIds = new Set<number>();
  for (let i = 0; i < cls.width * cls.height; i++) ids.add(cls.data[i * cls.channels]);
  for (let i = 0; i < src.width * src.height; i++) srcIds.add(src.data[i * src.channels]);
  console.log(tile, { land, black, idsSubsetOfSource: [...ids].every((v) => srcIds.has(v)) });
}
```

**Verify**: `black: 0` and `idsSubsetOfSource: true` for all four tiles.
Record the eight file sizes in the PR next to the sharp sizes from the
table above.

### Step 6: Docs

1. `AGENTS.md`, Tech stack: add that the data bake needs **Bun ≥ 1.4**
   (`Bun.Image`), also on the deploy.
2. `AGENTS.md`, Data pipeline: replace the sharp premultiply bullet with:
   the 2048² variants come from `Bun.Image` (straight alpha, always RGBA8
   out); the earlier sharp resampler premultiplied and painted the ground
   black — the pixel test in `scripts/downsample-raster.test.ts` is the
   guard, keep it.
3. `docs/transformations.md`, "Rasters at 2048²": swap the split-resize
   sentence for the Bun.Image one and keep the dead end on record (sharp
   premultiplies; a plain `sharp().resize()` turns land black — 🗃️).
4. `plans/README.md`: status row → DONE (PR #N), and the measured size
   delta.

**Verify**: `grep -rn "sharp" AGENTS.md docs/ scripts/` shows only the
historical mentions you intended.

### Step 7: Final gate

**Verify**: `bun install --frozen-lockfile && bun run verify && bun run build`
→ exit 0. Push; on the preview deploy, confirm the build log reports Bun
1.4.x for install and build (Step 0's evidence, now on the real change) and
open the preview: the neighbour tiles' ground is pastel, not black, from an
oblique angle (or drop a snapshot into `shots/` and run the `--headed`
harness on a real GPU).

## Test plan

- `bun test ./scripts`: land colour under alpha 0, exact class ids, no-alpha
  path — through fast-png, no sharp anywhere.
- Step 5's pixel check on all four tiles' baked outputs.
- CI green (Lint, Typecheck, Unit, E2E — the e2e half runs because
  `package.json`/`bun.lock` changed).
- A preview deploy that built with Bun 1.4 and renders coloured ground.

## Done criteria

- `sharp` is gone from `dependencies`, `trustedDependencies` and the
  lockfile; no `@img/*` binaries in `node_modules`.
- `packageManager` is `bun@1.4.x`, `bun.lock` is `lockfileVersion: 2`, CI
  installs that Bun from `package.json`.
- `scripts/downsample-raster.ts` is the ~10-line Bun.Image version; its
  test still fails on a premultiplying resampler.
- All eight baked variants: 0 black land texels, ids ⊆ source ids.
- Docs updated per Step 6; the size delta is recorded in the README row.

## STOP conditions

- Step 0: the Vercel install ignores the lockfile, or the build command
  runs Bun 1.3.x. Report the log lines and the override option; do not
  work around it inside the repo.
- Step 1: `bun run verify` fails on Bun 1.4.2 before any code change
  (report — it is a Bun regression, not this plan's).
- Step 2: `filter: kernel` needs a cast, or `png()` output is not RGBA/RGB
  8-bit.
- Step 3: `fast-png` ships no declarations *and* `pngjs` cannot report the
  channel count (drop the layout assertions only if the maintainer agrees).
- Step 5: any black land texel, or an id outside the source's set.
- The code at the locations in "Current state" does not match.

## Maintenance notes

- `lockfileVersion: 2` means every contributor needs Bun ≥ 1.4 (`bun
  upgrade`); a 1.3 install prints `Unknown lockfile version` and silently
  ignores the pins. Say so in the PR.
- `Bun.Image` is one release cycle old. If a future Bun changes the
  resampler or the encoder, the unit test and Step 5's check are the two
  places that would notice; the headless e2e never will.
- If the size delta ever matters (a phone budget, a slow link), the
  alternative is not sharp but a leaner encoder pass (e.g. running the
  baked PNGs through `oxipng` in the pipeline) — a separate plan.
