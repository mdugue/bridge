# Plan 019: Verify and tune the 3D Tiles branch on a real GPU

> **Executor instructions**: This plan needs a machine with a real GPU and a
> display (`--headed`). Work through the checks in order; each names what to
> look at, what "good" is, and which knob to turn if it is not. Write the
> numbers and the verdicts into the "Findings" section at the bottom, then
> update the status row in `docs/plans/README.md`. If anything in "STOP
> conditions" occurs, stop and report.
>
> **Drift check (run first)**:
> `git diff --stat 2c2f228..HEAD -- app/_components lib/city scripts/prepare-data.ts scripts/bake-tiles.ts scripts/tile-glb.ts`

## Status

- **Priority**: P1 — the branch that adopted 3D Tiles was verified headless
  only (SwiftShader, lite profile)
- **Effort**: S–M (half a day of looking, plus whatever tuning it finds)
- **Risk**: LOW — observation and constants
- **Depends on**: the branch with ADRs 0023–0026
- **Planned at**: commit `2c2f228`, 2026-09-24
- **Status**: TODO

## Why this matters

Four structural changes landed without a GPU:

1. the land-cover colours are painted at runtime by a GPU pass from the
   class raster (ADR 0023), no longer read from a baked RGB splat;
2. the site streams as 3D Tiles through 3DTilesRendererJS (ADR 0024): two
   terrain levels per tile, building content per tile, dressing per tile,
   the shadow camera as a second streaming camera;
3. the terrain and buildings are quantised glTF (`KHR_mesh_quantization`,
   16-bit positions, 8-bit normals), and the shaders take their data-frame
   coordinates from world space;
4. rails and walls are built per tile, no longer once for the block.

What headless proved: the lite scene's census is identical to before
(2369 buildings, 142 703 city triangles, 17 679 vegetation instances, 867
lamps, the same rail and wall triangle counts), all 18 e2e specs pass, and
SwiftShader plates of the ground look the same. What it cannot prove:
shading precision, soft shadows, LOD pops, seams, the look at distance, and
real frame times.

## Setup

```bash
git checkout claude/architecture-review-redesign-kddx6u
bun install
bun dev                        # bakes public/data, then http://localhost:3000
```

For before/after plates, a second checkout of `main`:

```bash
git worktree add ../bridge-main main && (cd ../bridge-main && bun install)
```

The shot harness: save a view from the in-app Snapshot panel ("Copy") into
`shots/<name>.json`, then `bun run shots` (headed, full profile) writes
`shots/<name>.png`. Run it in both checkouts with the same JSONs and compare
the plates side by side. Keep one set of reference snapshots for this plan:

| Snapshot | Where / when | Checks |
|---|---|---|
| `shore-eye` | Elbe bank at eye level, 11:00 | palette, shoreline feather, water |
| `meadow-eye` | Großer Garten edge, 17:30 | meadow mottle, NDVI tint, forest |
| `seam-eye` | on the 412/410 tile border at eye level, looking across | terrain seam, rails/walls across the seam |
| `seam-fly` | 200 m above the four-tile corner, pitched −35° | seams, LOD switch, far shadows |
| `oblique-400` | 400 m up, oblique over the Altstadt | coarse terrain, look at distance |
| `low-sun` | Neumarkt, 07:30 in December | long shadows from buildings outside the view |
| `roof-close` | a roof at 30 m distance, 13:00 | quantisation (faceting, normal banding) |

## Checks

### 1. Palette (ADR 0023)

Look at `shore-eye` and `meadow-eye` against `main`.

- Good: colours indistinguishable at eye level; the shoreline feather as
  soft as before (the water alpha is now a 3×3 tent over class 8 in the
  paint pass, it was the bake's Gaussian).
- Knobs: the palette in `lib/city/landcover.ts` (a look change, no re-bake);
  the tent width in `app/_components/landcover-splat.ts`.

### 2. Quantisation (glTF content)

`roof-close` and a flat street at grazing sun.

- Good: no visible faceting on roofs, no banding in flat-ground shading.
  8-bit normals are the usual glTF choice; the terrain grid is 2 m.
- Knob: `scripts/tile-glb.ts` quantisation bits (normals 8 → 10/16), then
  `bun dev` re-bakes. Note the wire-size change in the findings.

### 3. LOD switch and seams (ADR 0024)

Fly slowly from `oblique-400` down to eye level and back; watch the
terrain under the horizon switch 512² ↔ 1024².

- Good: no visible pop at the switch, no cracks at tile seams (both levels
  have a 30 m skirt), no colour step at a seam.
- Knobs: `COARSE_TERRAIN_ERROR` in `lib/city/tileset.ts` (geometric error
  of the coarse level; higher = the fine level loads earlier), the
  renderer's `errorTarget` (default 16 px, `app/_components/tile-stream.ts`).
  Both only change when things load, not what they look like.

### 4. Shadows from outside the view

`low-sun`, and turning on the spot at `seam-eye`.

- Good: long shadows of buildings behind the camera stay (the shadow
  camera is a streaming camera); no shadow blinks when turning
  (`displayActiveTiles`).
- If shadows appear late after a tile lands: every tile change runs the
  stream's `onChange` in `create-app.ts`, which re-renders the shadow map;
  check that it fires for the tile in question.

### 5. Rails and walls across seams

`seam-eye` where a rail line or retaining wall crosses the tile border.

- Good: continuous; a deck or ribbon may be split at the seam but must not
  gap or double up visibly.
- If it gaps: each tile builds its features clipped to its own tile; the
  fix is a small overlap in the bake (`pipeline/bake/rail.py`,
  `walls.py`) or building from both neighbours' data.

### 6. Frame time and memory

With the Performance panel (or `__poc.stats`) at `oblique-400` and at eye
level in the Altstadt:

- frame time vs `main` at the same view (desktop GPU and one laptop GPU);
- GPU memory after a flight across all four tiles and back — it should
  settle, not climb (the LRU unloads out-of-view tiles);
- first frame and `ready` times on a cold cache.

Good: within ±10 % of `main`. Knobs: the LRU cache limits and
`errorTarget` in `tile-stream.ts`. Phones stream the full tileset with
the 2048² rasters (`lowRasters`); if they struggle, `TILESET_SPAWN_FILE`
(spawn tile only, what the lite profile uses) is the fallback to wire to
the mobile tier in `scene-profile.ts`.

### 7. Phones

One Android and one iOS device on the dev server over the LAN (the
"Network" URL `bun dev` prints): boot, walk, double-tap travel, one
demolish.

- Good: no reload/crash from GPU memory, the phone tier's 2048² rasters are
  the ones fetched (Network panel), frame rate as on `main`.

### 8. Deploy host

On a preview deploy: `*.glb.gz` must arrive **unchanged** — no second
`Content-Encoding: gzip` added by the host, no content-type sniffing that
rewrites it. The client inflates it itself (magic-byte check), so a host
that decompresses it transparently is also fine; one that re-compresses and
drops the gzip magic is not.

## STOP conditions

- A visible regression against `main` that no knob above fixes (report the
  snapshot JSON and both plates).
- GPU memory keeps climbing across repeated flights (leak in the dressing
  plugin's `disposeTile`).
- Frame time more than 20 % worse than `main` at the same view.

## Findings

(fill in: date, GPU, per check the verdict, numbers, knob changes made)
