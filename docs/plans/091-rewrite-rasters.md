# Plan 091 [rewrite]: A tile's rasters arrive as the GPU reads them — plain arrays for ids, blocks for soft fields, a few files and bindings

> **Executor instructions**: Read
> [086-rewrite-programme.md](./086-rewrite-programme.md) and AGENTS.md
> first, then the `city-walker` skill's parts on tiles and rasters. Work
> phase by phase; each phase is one PR and ends in a **Verify** you run.
> Phase 0 measures and decides which later phases are built at all: a
> phase its numbers do not carry is closed as rejected, with the numbers.
> On a STOP condition, stop and report. When a phase lands, update this
> plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 5dfa300d..HEAD -- lib/city/tile.ts lib/city/tileset.ts lib/city/png-raster.ts app/_components/tile-rasters.ts app/_components/raster-upload.ts app/_components/shared-rasters.ts app/_components/raster-shares.ts app/_components/terrain-layer.ts app/_components/sky-light.ts app/_components/landcover-splat.ts scripts/downsample-raster.ts scripts/crop-raster.ts scripts/prepare/side-files.ts`
> If an in-scope file changed, compare *Current state* with the code
> before you go on; a mismatch is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (phases 0 and 2, the trial), M (phase 1), M–L (phases
  3–5, only those phase 0 and 2 carry)
- **Risk**: MED — a class id that changes paints the wrong ground on
  every tile; a soft field that changes shifts the light
- **Depends on**: [087](./087-rewrite-measuring-stick.md) (plates and
  ledger); [088](./088-rewrite-tiles-as-a-data-product.md) for phase 1
  and phase 4 (transport compression); phase 3's NDVI waits for
  [090](./090-rewrite-dressing-gpu-ready.md)
- **Category**: rewrite — fewer bytes on the wire, a phone's GPU bytes
  (ADR 0047), less complexity (no PNG decoder in the viewer, fewer
  files, fewer shader variants)
- **Series**: [086-rewrite-programme.md](./086-rewrite-programme.md)
- **Planned at**: commit `5dfa300d`, 2026-11-16
- **Status**: REJECTED (2026-11-24, the series closed): its row in
  [README.md](./README.md) says what holds. As it stood before:
  IN PROGRESS — phase 0 measured (*Findings*); phases 2, 3 and 5 decided below; phase 2's trial was built behind a build flag and a page knob, measured, and removed again before milestone 1 (*Findings*; the code is at commit `b00b08c2`): it passes its criteria except the plates (four views move slightly), it halves the sky view's GPU bytes and grows its wire bytes by 11–12 %; a real GPU's look and the reference phone's features stand between it and the default

## Why this matters

A fine terrain level reads its ground from nine raster files and two
tables and binds twelve textures. Every raster is a greyscale PNG the
viewer inflates and unfilters itself (`lib/city/png-raster.ts`),
because a browser's image decoder colour-manages what it decodes and on
iPhones rewrote class ids. PNG is a picture format carrying data: hence
a decoder of our own, a rule in AGENTS.md against image tools, channels
interleaved into a picture four times as wide, and twins of the same
raster at two or three sizes, each a file.

This plan sends each raster in the layout its texture has, and
compresses on the GPU only what tolerates it. The table below corrects
the expectation the series started from: **block compression is the
small lever here**. The rasters that tolerate it are 4.7 MiB of the
40–60 MiB a phone holds for a fine level; the weight is in the id
rasters, which must stay exact, and in the colour splat painted from
the classes. So the order is: exact rasters as plain arrays, a trial of
block compression on one soft raster, then fewer files and bindings.

## Current state

**The table of a tile's files** — `lib/city/tile.ts`, `ARTIFACTS`: one
row a file, `terrain` naming the extras keys a level reads it under,
`bakedFrom` a twin the build cuts from a committed raster. The viewer's
side is `app/_components/tile-rasters.ts`, `RASTER_KINDS`: one row a
kind with its `look`, its `phone` and `far` twins and its table.

Every raster of Dresden's spawn tile `33412_5656_2_sn`, read on
2026-11-16 from the committed PNG headers and from each kind's `look`.
GPU bytes are width × height × channels, × 4/3 with a mip chain
(`three-utils.ts` `textureBytes`).

| Kind (`RasterKind`) | Texels, channels | Sampled | What the bytes are | Sort | GPU, desktop | GPU, phone |
|---|---|---|---|---|---|---|
| `class` | 4096², 1 (phone 2048², coarse level 1024²) | nearest | land-cover class ids | **exact** | 16 MiB | 4 MiB |
| — its colour splat | painted on the GPU from the classes, RGBA8, mips (`landcover-splat.ts`) | linear | palette colour and water coverage | derived at runtime | 21 MiB | 21 MiB |
| `surface` | 2048², 4 (far twin 1024²) | nearest | R packed road, walk and parking ids; G bearing; BA a 13-bit offset along the street (`surface.py`) | **exact** | 16 / 4 MiB | 16 / 4 MiB |
| `sport` | 2048², 4 (far twin 1024²) | nearest | rows of the sports table, a bit | **exact** | 16 / 4 MiB | not read |
| `markings` | 2048², 4 (phone and far twin 1024²) | nearest | rows of the markings table, lane bits, an offset | **exact** | 16 / 4 MiB | 4 MiB |
| `edges` | 2048², 2 (far twin 1024²) | linear | signed distance to the road edge and the meadow edge, 5 cm a step (`EDGE_SCALE` 20) | **measured field** | 8 / 2 MiB | 8 / 2 MiB |
| `colonies` | a crop of 2048², 2 (phone half) | linear | R signed distance to the garden land's edge, G an axis code 0–126 | **measured field** | ≤ 8 MiB | ≤ 2 MiB |
| `ndvi` | 1024², 1 | linear, mips, anisotropy | the orthophoto's greenness | **soft field** | 1.3 MiB | 1.3 MiB |
| `svf` | 1024², 1 | linear, mips | the share of the sky a point sees | **soft field** | 1.3 MiB | 1.3 MiB |
| `horizon` | 8 layers of 256², 4 | linear | skyline angles, four azimuths a texel (0–45° and 0–90° over a byte) | **soft field** | 2.0 MiB | 2.0 MiB |

The sorts, each checked in its reader: an **exact** raster is read
texel by texel and compared (`idLook`); a **measured field** is read
with its neighbours and a line is drawn where it crosses a value
(`ground-detail.ts` `edgeAt`, `bakedDistances`: a kerb band 0.12 m
wide, `WALK_EDGE_M`); a **soft field** is light or tint
(`sky-light.ts`: `mix(1, svf, SKY_VIEW)`, `hzSunVisible` with a soft
band of 0.8°, `HORIZON_SOFT_DEG`). The murals' pictures
(`data/<site>/murals/*.webp`, `mural-layer.ts`) are pictures and go
through `createImageBitmap`; they are not a tile's raster and not in
this plan.

The NDVI is also read **on the CPU**: `vegetation-layer.ts` fetches the
PNG again and samples it for the crowns (`maxWindowSampler`,
`lib/city/raster-sampler.ts`). That and `raster-upload.ts` are the
viewer's two calls of `decodeGreyPng`.

**How a raster loads** — `app/_components/raster-upload.ts`,
`loadDataRaster`: fetch (six at once, nearest tile first), then in its
turn `decodeGreyPng`, `textureOf` (the PNG's bytes are already the
RG8 / RGBA8 layout, a layered one layer-major, handed to a
`DataTexture` or `DataArrayTexture` as they are), `applyLook`,
`uploadNow` on a phone. A one-channel PNG the decoder rejects goes to
the browser's (`browserFallback`, `loadBitmapTexture`); a class raster
loaded that way has no water mask.

**What the build does** — `scripts/prepare/side-files.ts` publishes the
committed PNGs and makes the twins: `scripts/downsample-raster.ts`
(`downsampleClassRaster` through sharp with a nearest kernel,
`downsampleInterleaved` by copying texels) and `scripts/crop-raster.ts`
(`colonyCrop`: only the texels that carry a colony, the crop named in
the extras as `cultivatedCrop`). The bakes write the PNGs
(`pipeline/bake/common.py`, `skyview.py` `save_png`).

**What a level binds** — `terrain-layer.ts` `splatNodes`: `class`,
`color`, `ndvi`, `surface`, `edges`, `sportRaster`, `sportTable`,
`markingsRaster`, `markingsTable`, `colonies`, and from `sky-light.ts`
`lightSvf` and `lightHorizon`: twelve. A term whose raster is absent is
left out of the graph, so the rasters a tile has pick its shader:

```ts
// terrain-layer.ts, splatVariant: eight optional rasters, one build each way
[splat.ndviTexture ? "ndvi" : "", splat.surfaceTexture ? "surface" : "", …]
```

**On the wire**, the same tile, measured 2026-11-16 (kB; gzip level 9;
xz preset 6 stands in for a stronger transport codec, it is not one a
browser has; *up* = each row minus the row above, then gzip):

| Raster | PNG today | raw, gzip | up, gzip | raw, xz |
|---|---|---|---|---|
| `class` 4096² | 218 | 200 | 213 | 207 |
| `surface` | 787 | 556 | 731 | 376 |
| `markings` | 217 | 196 | 210 | 152 |
| `sport` | 26 | 23 | 24 | 8 |
| `colonies` | 19 | 20 | 18 | 9 |
| `edges` | 1 426 | 2 027 | 1 414 | 1 243 |
| `ndvi` | 376 | 391 | 400 | 342 |
| `svf` | 580 | 780 | 628 | 614 |
| `horizon` | 1 164 | 1 212 | 1 172 | 982 |

Plain arrays are smaller than PNG for the exact rasters and larger for
the fields unless a row predictor comes first: PNG's filters are a
predictor.

**What three r187 offers** (read in `node_modules/three`; the executor
reads it again):

- `WebGPUBackend` asks the adapter for every feature it has, and
  `renderer.hasFeature("texture-compression-bc" | "-etc2" | "-astc")`
  answers after `await renderer.init()`. `WebGPUTextureUtils` maps
  `RED_RGTC1_Format` and `RED_GREEN_RGTC2_Format` to BC4 and BC5,
  `R11_EAC_Format` and `RG11_EAC_Format` to EAC, and uploads a
  `CompressedTexture`'s or `CompressedArrayTexture`'s mips as given.
- `KTX2Loader` (`examples/jsm/loaders/KTX2Loader.js`) transcodes Basis
  only to colour formats — ASTC 4×4, BC7, DXT, ETC2 RGBA — at eight
  bits a texel: **no saving for a one-channel raster**. A KTX2 file
  that already holds BC4, BC5 or EAC blocks it reads without the
  transcoder (527 kB of WebAssembly, 57 kB of script, its own workers).

**Earlier decisions**: plan 076 and
[077](./077-one-rasters-module.md) rejected KTX2 for the rasters
("data, not colour: block compression would change class ids") — that
stands for every exact raster. [070](./070-raster-diet.md) shrank the
coarse class raster, took the sports grounds off phones and halved the
desktop's splat. [074](./074-architecture-deepening.md)'s backlog names
"one raster stack per tile": nine loads to two, twelve bindings to
about four.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Format, then gate | `bun run fix && bun run verify` | exit 0 |
| Build the data and the app | `bun run build` | exit 0 |
| Headless e2e | `bun run test:e2e` | all pass |
| Plates on a GPU | `bun run shots` (and plan 087's `bun run plates`) | plates written, compared |
| The ledger | plan 087's `bun run ledger` | `qa/ledger.json` as committed |

## Scope

**In scope**: `lib/city/tile.ts`, `lib/city/tileset.ts` (the raster
keys), a new `lib/city/raster-pack.ts` with its test,
`app/_components/tile-rasters.ts`, `raster-upload.ts`,
`shared-rasters.ts`, `raster-shares.ts`, `terrain-layer.ts` (the splat's
slots and variant), `sky-light.ts` (the horizon's read),
`scripts/prepare/side-files.ts`, `scripts/downsample-raster.ts`,
`scripts/crop-raster.ts`, `scripts/bake-entries.ts`, their tests,
`docs/rendering.md`, `docs/data-pipeline.md`, AGENTS.md's data rule,
ADRs 0024 and 0047.

**Out of scope**:
- The bakes' own files. Python keeps writing what it writes; what a
  bake hands over is [092](./092-rewrite-bake-store.md)'s.
- The colour splat's painting and its palette (ADR 0010: a colour
  change is not a re-bake). See *Maintenance notes* for its weight.
- The murals' pictures, the minimap's picture, the ground plate.
- Tile sizes and levels: [093](./093-rewrite-streaming-quadtree.md).
- Any lossy step on an exact raster, in any phase.

## Phases

### Phase 0 — The table, for every site, in the ledger

Extend plan 087's ledger with, per site and raster kind: files, wire
bytes, GPU bytes a tier (the table above, computed from the published
files, not typed in), the share of texels that carry anything and their
bounding box for `sport`, `markings`, `colonies` and `surface`, and the
number of distinct `splatVariant` keys the site's tiles produce. Add
the CPU reads: which rasters the viewer decodes without uploading.

**Verify**: `bun run ledger` writes the figures; `bun run verify` → exit
0. **Decides**: phase 3 by the soft fields' share of a phone's fine
level; phase 5 by the variant count and the sparse rasters' cover.

### Phase 1 — Exact rasters as plain arrays (needs 088)

1. `lib/city/raster-pack.ts`: a file is a 16-byte header (magic, width,
   height, channels, layers, a predictor flag) and then the texture's
   bytes exactly as `textureOf` lays them out today. Writer and reader
   in one module, a round-trip test, no THREE, no DOM — as
   `lib/city/point-pack.ts` is. If 090 has landed a container for a
   tile's tables, the bytes go in it and the header is its entry.
2. The build writes them: `side-files.ts` decodes each committed PNG
   with `decodeGreyPng` (it runs in Bun already, `scripts/prepare/`
   uses it) and writes the array. The twins become slices of the array:
   every n-th texel (`downsampleInterleaved`'s rule, and for the class
   raster the same rule with one channel). **No image tool resizes a
   raster any more**; sharp leaves this path.
3. The viewer reads them: `loadDataRaster` wraps the fetched bytes in
   the texture, and the crowns' NDVI sampler (`vegetation-layer.ts`,
   the viewer's only other `decodeGreyPng` call) reads the same array.
   `browserFallback`, `loadBitmapTexture` and the undefined water mask
   go. `png-raster.ts` stays for the build (`scripts/prepare/plate.ts`,
   `scripts/coarse-crowns.ts`, and `decodeLift` in
   `lib/city/water-bodies.ts`, which only the build calls). The viewer
   imports `water-bodies.ts` for other things: if the bundle still
   carries the decoder, move `decodeLift` into a module of its own.
4. Transport: the files carry no compression of their own. They are
   served compressed by 088's CDN. Until 088 has landed this phase does
   not merge: a static host sends an unknown binary type as it is.
5. A test reads every published exact raster of every committed site
   both ways (PNG and array) and compares every byte.

**Verify**: `bun run test` → the byte-equality test passes for all
sites; `bun run test:e2e` → all pass; the plates show no view above
087's noise floor. **Ledger**: wire bytes of each exact raster (gate:
none grows), the viewer chunk's bytes without the decoder.

### Phase 2 — The trial: `svf` as blocks

`svf` is the trial: one channel, soft, mipmapped, read by the ground
and the clay, never on the CPU, and the largest soft raster on the
wire.

1. Read the installed three: `WebGPUTextureUtils.js` (compressed
   uploads, mip levels), `CompressedTexture`, and its docs. Confirm
   that `renderer.hasFeature` answers for BC and ETC2 inside the
   scene's worker. Record which features the reference phone, the
   reference desktop and SwiftShader report.
2. **Route A (the default)**: the build encodes `svf` and its mip chain
   (a box filter; a compressed texture gets no mips from the GPU) as
   BC4 and as EAC R11 — two published twins, picked by feature as the
   phone twins are picked by tier, the plain array as the fallback for
   a device with neither. Both encoders are small and deterministic and
   are written in TypeScript in `scripts/`: no dependency. A decoder of
   each, for the test only.
3. **Route B (compare, do not build out)**: KTX2 through three's
   `KTX2Loader`. It needs an encoder (a native CLI or an npm package: a
   new dependency — name its size, licence and whether it is
   deterministic, and ask the maintainer) and, for Basis, the
   transcoder fetched from our own origin. For a one-channel raster it
   saves no GPU bytes (see *Current state*); it is in the comparison
   only so that the choice is recorded.
4. Judge: the error of the value the shader reads, in byte steps (mean,
   p99, max) over every committed site; 087's plates on the views that
   show ground light (`ao-wall-foot`, `seam-eye`, `low-sun`,
   `oblique-400`); GPU bytes a tile on a phone; wire bytes.

**Verify**: a unit test decodes each encoder's output and holds the
error to the figure the trial recorded; plates within the noise floor.
**Ledger**: the four figures above for `svf`, both routes.

### Phase 3 — The other soft fields (only on phase 2's numbers)

- `horizon`: its texels hold four unrelated angles, which a colour
  codec handles badly. Offer it as thirty-two one-channel layers in the
  phase 2 format (`sky-light.ts` `hzAngle` then reads a layer's `.r`);
  judge the angle's error against `HORIZON_SOFT_DEG`.
- `ndvi`: only once 090 has baked the crowns' greenness into their
  table, so that nothing reads it on the CPU; until then it stays a
  plain array.
- `edges` and `colonies` are **not** candidates without a trial of
  their own: a 4 × 4 block spans about four metres of a field whose
  line is 0.12 m wide. Try `edges` last, and expect to reject it.

**Verify** and **Ledger** as phase 2, a raster at a time.

### Phase 4 — The fields that stay plain (needs 088)

`edges`, `colonies`, and every soft field phase 3 did not convert,
as plain arrays with the *up* predictor flag: the reader adds each row
to the one above, in the raster's turn. Gate: no raster's wire bytes
grow against its PNG under the codec 088 serves — measured, since gzip
alone was level with PNG and no better.

**Verify**: byte-equality after the predictor's inverse, every site.
**Ledger**: wire bytes a kind.

### Phase 5 — Fewer files, fewer bindings

Spike first, on the spawn tile and one tile without sports grounds:

1. **Files.** One file for what both levels and the buildings share
   (the coarse class raster, `ndvi`, `svf`, `horizon`) and one for a
   fine level's own, per reach and tier that reads a different list
   today. `shared-rasters.ts` keeps sharing by file name; a level never
   downloads what it does not read today.
2. **Bindings.** Group by sampler where the sizes agree: `surface`,
   `sport` and `markings` as layers of one array texture, the two
   tables as one, `ndvi` and `svf` as two layers. An absent layer must
   cost no memory: the array holds only the layers a tile has, and a
   slot uniform says which is which.
3. **Variants.** With layers and a presence uniform the ground needs
   fewer builds than `splatVariant`'s. Per-pixel graphs use `mix` and
   `step`, never `select` (AGENTS.md); measure the frame.

**Verify**: a fine level's requests and bindings, counted by a test;
`bun run test:e2e` → all pass; plates within noise; the frame's GPU
time on the reference phone not above its figure before. **Ledger**:
files, bindings, distinct ground variants, frame time.

## Test plan

- `lib/city/raster-pack.test.ts`: round trip, a truncated file, a wrong
  magic, the predictor's inverse; modelled on
  `lib/city/point-pack.test.ts`.
- Byte equality of every published exact raster against its committed
  PNG, every committed site (beside `lib/city/tile-data.test.ts`).
- The twins: the texels `scripts/downsample-raster.test.ts` holds
  today, now from arrays. The block encoders: decode and compare.
- `app/_components/tile-rasters.test.ts`: which file a level, a tier
  and a reach read — unchanged rows keep their tests.

## Done criteria

- [ ] `grep -rn "decodeGreyPng\|loadBitmapTexture\|browserFallback" app/`
      returns nothing, and the ledger's viewer chunk no longer holds
      the decoder
- [ ] `grep -rn "sharp" scripts/downsample-raster.ts scripts/crop-raster.ts`
      returns nothing
- [ ] The byte-equality test passes for every committed site
- [ ] `qa/ledger.json` shows no exact raster larger on the wire than at
      `5dfa300d`, and a phone's fine level no larger on the GPU
- [ ] Phases 2–3 are built or closed as rejected, the figures in this
      file's *Findings*
- [ ] AGENTS.md's rule on data rasters says what holds now; ADRs 0024
      and 0047 rewritten where they name the files; `docs/rendering.md`
      and `docs/data-pipeline.md` current
- [ ] `bun run verify` and `bun run test:e2e` pass

## STOP conditions

- A published exact raster differs from its committed PNG in any byte.
- Phase 0 shows the soft fields under a twentieth of a phone's fine
  level and the maintainer has not asked for the trial regardless:
  report the table and stop before phase 2.
- The reference phone reports neither BC nor ETC2, or three's upload of
  a compressed mip chain needs a `_` member.
- Route A's encoders are not byte-stable between two runs (the bake's
  cache and the content hashes need them to be).
- A phase would need an encoder or loader dependency: ask first.
- Phase 5's unified ground costs the reference phone frame time, or an
  absent layer costs memory.
- A phone's GPU bytes grow in any phase (ADR 0047).

## Maintenance notes

- A new raster is still a row in `ARTIFACTS` and a row in
  `RASTER_KINDS`; its sort — exact, measured field, soft field — is now
  part of the row, and only a soft field may be lossy.
- The heaviest raster a phone holds is none of the files: the colour
  splat, 21 MiB a fine level, painted at runtime so that a colour is
  not a re-bake. Halving it on a phone, or reading the classes without
  a splat, is plan 070's kind of question and needs a GPU look; it is
  named here so the next audit does not rediscover it.
- `sport`, `markings` and `surface` are sixteen MiB each for a few
  dozen to a few hundred kB of content. If phase 0 shows them mostly
  empty, cropping them as `colonyCrop` crops the colonies is the next
  plan, larger than anything block compression offers here.
- The cache keys: every new build module is a row in
  `scripts/bake-entries.ts` or imported from one.

## What the series changes about this plan

- **With 088** the arrays carry no compression of their own. Built
  alone, phase 1 would pre-gzip them as the glTF is, and phase 4 would
  not pay (joint 10 of 086).
- **With 090** nothing reads the NDVI on the CPU, so it may become
  blocks; alone it stays plain.
- **With 093** a tile's raster is its level's: the phone and far twins
  and `lib/city/ground-reach.ts` go, and phase 5's files are one a
  tile. Without 093 the twins stay, as rows and as files.
- **With 094** phase 5's fewer ground variants are what makes the set
  of pipelines small enough to list at boot.
- Against 086's table: the trial is kept, but its expected gain is
  about three MiB a fine level on a phone, not a large one; the plan's
  weight has moved to phases 1 and 5.

## Findings

> **Slimmed before milestone 1 (2026-11-24; plan 086, ruling 5).** The
> measuring and the trial were removed from `rewrite` once their figures
> were taken: the ledger's `rasters` and `blocks` sections with their
> modules, and phase 2's sky-view blocks (`scripts/block-encode.ts`,
> `block-known.ts`, `lib/city/block-raster.ts`, the build flag
> `SVF_BLOCKS`, the page knob `?svf=blocks`, the probes under
> `scripts/eval/`). They are history at commit `b00b08c2`; whoever builds
> phase 2 for good starts from there. The figures below are the record.

### Phase 0 — the table (2026-11-16, every committed site)

`qa/ledger.json`'s `rasters` section, computed from the published files
by the viewer's own rules (`scripts/ledger-rasters.ts`,
`lib/city/ledger-rasters.ts`; the table and how to read it in
`docs/data-pipeline.md`, "The rasters, every site"). Every figure is
gated. The drift check found no in-scope file changed since `5dfa300d`.

**A phone's fine level near the camera** is the same on all seven sites
to within 2 MiB: exact 24.0 MiB (class 4, paving 16, markings 4; no sports
raster), measured 8.0–10.0 (edges 8, a colony crop 0–2), soft 4.7 (NDVI
1.3, sky view 1.3, horizon 2.0), the colour splat 21.3 — **58.0–60.0 MiB,
the soft fields 7.8–8.0 %**. A desktop's: exact 64.0 (class, paving,
sports, markings 16 each), 98.0–106.0 in all, soft 4.4–4.8 %.

**Beyond the ground detail's reach** (`fineFar`: the far twins of the
paving, edges, sports and markings, `lib/city/ground-reach.ts`) a phone's
fine level is **40.0–42.0 MiB, the soft fields 11.1–11.7 %**: exact 12.0
(class 4, paving 4, markings 4), measured 2.0–4.0, the splat unchanged. A
desktop's is 56.0–58.0 (soft 8.0–8.3 %).

**A coarse level** is 11.0 MiB on both tiers: class 1.0, splat 5.3, and
the same three soft fields, 4.7 MiB — **42.4 %**. Both levels of a tile
share the soft textures (by file, `shared-rasters.ts`).

**Programs**: 2–4 `splatVariant` keys a site and tier over both levels;
over all seven sites 4 on a desktop, 3 on a phone (with sports grounds or
not, with colonies or not, the coarse level's). The far twins do not add
one.

**Cover** (mean share of texels that carry anything, over the tiles whose
fine level holds the raster on a desktop): paving 31–47 %, its bounding
box the whole tile; markings 8–17 %, box 93–100 %; sports grounds
**0.4–1.2 % (largest 3.8 %)** in a box of 17–82 % (a site's mean;
Dresden's tile `33416_5658` has a sports raster but no grounds in its
table, holds none, and is not counted); colonies 0.3–6.1 % (already
cropped, `colonyCrop`).

**CPU reads**: one — the NDVI, decoded again for the crowns' greenness
(`vegetation-layer.ts` `loadNdviSampler`, every fine level, every tier;
the same file is uploaded for the ground).

**What it decides**

- **The STOP condition before phase 2 does not hold**: the soft fields are
  7.8–8.0 % of a phone's fine level near the camera and 11.1–11.7 %
  beyond its reach, above a twentieth either way. Phase 2's trial goes
  ahead as planned.
- **Phase 3 is carried, on phase 2's numbers.** BC4 or EAC R11 halve a
  one-channel raster: sky view 1.3 → 0.7, NDVI the same (after 090), the
  horizon as 32 one-channel layers 2.0 → 1.0. Since both levels of a tile
  share them, that is 2.3 MiB a tile — 1.7 until 090 frees the NDVI of
  its CPU read: 15 % of a coarse level, 4 % of a phone's fine level near
  the camera, 4 % beyond its reach. The horizon is the larger part and
  the first candidate. How many coarse levels against fine ones a phone
  holds on a flight is not measured here.
- **Phase 5 is carried narrowed.** *Variants*: 4 programs a desktop, 3 a
  phone, over all sites — the variant leg has nothing to win and is
  closed. *Bindings*: paving and markings span the whole tile (box
  93–100 %), so stacking them as layers costs no empty layers. Near the
  camera a phone's paving (2048²) and markings (1024²) differ in size and
  do not stack; beyond the reach both are 1024² and do. *Sports grounds*:
  about 1 % of their texels carry, so a 2048² RGBA layer (16 MiB on a
  desktop) is the wrong home for them — cropped as the colonies are
  (*Maintenance notes*), a desktop's fine level near the camera saves
  16 MiB × (1 − box): 0–15.9 MiB a tile. That is a plan of its own or
  phase 5's first step, desktop only (a phone does not read them).
  *Files*: unchanged, a fine level still fetches 9 rasters and 2 tables.

### Phase 2 — the trial: `svf` as blocks (2026-11-16)

**Built, behind a build flag and a page knob.** A build with
`SVF_BLOCKS=1` publishes every tile's sky view beside its PNG as BC4 and
as EAC R11 with a box-filtered mip chain (`svf_<t>.bc4.gz`, `.eac.gz`;
the file `lib/city/block-raster.ts`, the encoders
`scripts/block-encode.ts`, bake entry `svfBlocks`), named in both levels'
and the buildings' extras (`svfBc4`, `svfEac`). A build without it — the
default, every deployment — publishes what it published before: the
ledger's `published.*` and `bytes.*` do not move. On a flagged build,
`?svf=blocks` reads BC4 where the renderer has `texture-compression-bc`,
else EAC where it has `-etc2`, else the PNG (`scene-profile.ts`
`blockFormatFor`), as a `CompressedTexture` uploaded at once
(`raster-upload.ts` `loadBlockRaster`); a block file that is absent,
malformed or refused by the GPU falls back to the PNG (`rasterFiles`'
`fallback`). Without the knob, or on a build without the flag, the
viewer reads the PNG as before. The drift check found no in-scope file
changed since `5dfa300d`.

**Three r187 (step 1).** `WebGPUBackend` requests every adapter feature;
`renderer.hasFeature` answers in the scene's worker after `init`.
`WebGPUTextureUtils` maps `RED_RGTC1_Format` → `bc4-r-unorm` and
`R11_EAC_Format` → `eac-r11unorm` and writes a `CompressedTexture`'s
`mipmaps` level by level (`_copyCompressedBufferToTexture`); the mip
count is the array's length. Public API only: no `_` member. One trap
of our own: a material slot's stand-in (`material-slots.ts` `stubLike`)
was a 1 × 1 `DataTexture` of the slot texture's format, which three
cannot create for a block format ("Unsupported texture format 36283")
— a compressed slot texture now gets one 4 × 4 block of its format.
three's `info.memory` counts any compressed texture as one byte
(`Info._getTextureMemorySize`, r187), so a phone's `texturesSize` does
not show the blocks at all: the tracked bytes (`trackTexture`, what the
tile cache weighs) are the figure.

**Adapters.** SwiftShader (Chromium 1243, the e2e's flags) reports
`texture-compression-bc`, `-etc2` and `-astc`. The compressed path drew
there in two places: `scripts/eval/block-raster-probe.ts` (raw WebGPU,
every texel of the spawn tile's level 0 in both formats read back
through a fragment pass — a compute pass reads compressed textures as
zeros there) and the viewer's lite spawn tile with the knob on a flagged
build (the BC4 file fetched, no error, the plates below). SwiftShader's
reads differ from the formats' nominal values a little: BC4's
interpolation truncated to whole bytes (≤ 0.86 steps), EAC's eleven
bits widened without repeating them (≤ 0.12). **The reference phone and
the reference desktop were not available**; what they report is not
recorded.

**The encoders (step 2).** TypeScript, integers only, no dependency:
BC4 an exhaustive search of both modes' endpoints within 2 of the
block's range, EAC every table with the multipliers around the block's
span and three bases each. Two encodes of every committed raster are
the same bytes. 0.25–0.95 s a 1024² raster for BC4, 1.3–2.7 s for EAC,
once a tile (cached). Their tables are pinned from outside: a designed
level (`scripts/block-known.ts`: every EAC table, multipliers 0–8, both
BC4 modes, every index) read on SwiftShader's WebGPU, 256 texels a
format, matches our decoders exactly (`scripts/block-encode.test.ts`);
a changed modifier entry or palette rule fails it.

**The figures** (every committed site, 32 tiles; `qa/ledger.json`
`blocks`, read with `bun run ledger -- --blocks`, which encodes the
published PNGs with the build's own call; the table in
`docs/data-pipeline.md`, "The sky view as blocks"):

| | PNG today | BC4 | EAC R11 |
|---|---|---|---|
| GPU a tile (with mips) | 1.33 MiB | **0.67 MiB** | **0.67 MiB** |
| Wire, all sites (pre-gzipped) | 16.7 MiB | 18.7 MiB (**+12 %**) | 18.6 MiB (**+11 %**) |
| Level 0, byte steps: mean (site range) | — | 0.58–0.91 | 0.62–0.92 |
| p99 (largest tile) | — | 4.0–4.9 | 4.0–4.9 |
| largest texel | — | 11.3–14.6 | 12.1–17.1 |
| Levels 1–10, largest texel | — | ≤ 16.0 | ≤ 22.0 |
| Encode stable | — | yes | yes |

**The gain is GPU bytes only: the wire grows.** Per site the blocks are
7–18 % above the PNG under gzip; brotli 11 halves that (+7 % / +5 % over
all sites). The error is the formats' nominal decode of the file, not a
GPU's read (SwiftShader's is lower by the amounts above). Decode and
upload time were not measured: a block raster is inflated and written as
it is, with no PNG unfiltering and no mips made on the GPU, but no
figure says what that saves on a phone.

With the knob, the lite spawn tile's cache weight (`calculateBytesUsed`)
falls by 699 036 bytes, half of the sky view's 1.33 MiB, a share from
each level, as the share rule says. What an error of this size does to
the light: the ground's ambient term is `mix(1, svf, 0.5)`, so 4 steps
(p99) move its indirect light by 0.8 %; the facades read twice the sky
view (`FACADE_SVF_GAIN`), 1.6 %.

**The picture.** Tier 1 (SwiftShader, `lite`, 400 × 250 drawn pixels),
the eight CI views and the plan's four ground-light views, without and
with the knob on one flagged build: 8 of 12 identical to the pixel;
`across-400` 11 pixels (largest step 11/255), `fountain-july-day` 16
(10), `street-crossings` 10 (7), `street-crossings-comic` 276 pixels
(103: the Comic style's ink and tone bands flipping at a threshold,
scattered single pixels). `ao-wall-foot`, `seam-eye`, `low-sun` and
`oblique-400` — the views that show ground light — identical. Tier 1's
noise floor is 0 (plan 087), so these are the change.

**Route B (step 3), not built.** KTX2 through `KTX2Loader` saves
nothing over Route A here: Basis transcodes a one-channel raster only to
8-bit colour formats (no GPU saving), and a KTX2 holding BC4 or EAC
blocks is Route A's blocks in another container, which the loader reads
with 57 kB of script beside it. An encoder for it (`basisu` / `toktx`,
native, Apache-2.0) would be a new dependency; none was installed or
measured.

**What it decides**

- **Phase 2 passes its criteria except the plates.** The unit test holds
  the spawn tile's error, every mip level's included, to the figures
  above; the encoders are byte-stable and pinned against a GPU's read; no
  dependency; public API only; a phone's GPU bytes fall. The plan's
  Verify asks for plates within the noise floor, which is 0: four views
  move slightly (above), so that criterion fails as written and is a
  slight deviation under ruling 3.
- **Not the default.** Two STOP conditions cannot be checked here: what
  the reference phone reports (neither BC nor ETC2 would stop the plan)
  and how the blocks look on a real GPU. Until both are in, the flag and
  the knob stay off. Switching on is the flag on the deployment's build
  and `blockFormatFor`'s `requested`, then the ledger's figures.
- **Phase 3 is carried on these numbers** for the GPU: block compression
  halves a soft field's GPU bytes at under a byte step's mean error, at
  a wire cost of about a tenth. The horizon next, as 32 one-channel
  layers judged against `HORIZON_SOFT_DEG`, behind the same flag and
  knob; only its default waits for the real-GPU look above.
- **The cost on the default build**: +2.1 kB of first-load JavaScript
  (the loader and the knob's code, in every page; `browser.firstLoad`),
  nothing published. On a flagged build: the block files (about 1.2 MB a
  tile on the server) and two names in each level's extras.
- **The knob in the crash trail** (`crash-trail.ts` keeps `svf` with
  the other test switches): it names no place, so the privacy page's
  sentence on the test switches covers it, as it did `stands` and
  `rails`.

**What a real GPU must look at before the default changes**, on a
preview built with `SVF_BLOCKS=1` (a project setting for that preview):
the four ground-light views and `street-crossings-comic` at tier 2 with
and without `?svf=blocks` (the facades' sky light most of all: doubled
there); the adapter's features on the reference phone and desktop
(`navigator.gpu.requestAdapter()`, then `adapter.features`); the time a
block raster's load takes against the PNG's (`?trace=1`, `raster:decode`);
and the lite spawn tile's texture count on a phone with the knob, which
SwiftShader's run left unexplained (61 textures without the knob, 45
with, read once each at one moment of the load; `texturesSize` counts
the blocks as one byte, see above).
