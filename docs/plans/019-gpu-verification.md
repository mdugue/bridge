# Plan 019: The GPU checklist — look at everything built headless, on real GPUs and phones

> **Executor instructions**: This plan needs a machine with a real GPU and
> a display (`--headed`), and for section I two phones. It is the **one
> place** for every "look unjudged on a GPU" in the project: the condensed
> plans in [completed.md](./completed.md) and the backlog point here. Work
> through the sections in any order; each names what to look at, what
> "good" is, and which knob to turn if it is not. Write numbers and
> verdicts into "Findings" at the bottom (one line per item: date, GPU or
> device, verdict, knob changed), tick the item, and update the status row
> in `docs/plans/README.md`. On a STOP condition, stop that item and report
> with the snapshot JSON and the plate.
>
> **Drift check (run first)**: `git log --oneline -15 -- app/_components lib/city scripts/tile-glb.ts scripts/prepare-data.ts`
> — the knobs below are named by symbol; find them by name if lines moved.

## Status

- **Priority**: P1 — everything since the 3D Tiles switch (ADRs 0023–0035)
  was verified headless only (SwiftShader through the WebGL2 backend, lite
  profile)
- **Effort**: M (one to two days of looking, plus the tuning it finds);
  sections can be done in separate sittings
- **Risk**: LOW — observation and constants
- **Depends on**: none; plan 048 part B (committed QA views) makes it
  repeatable — if 048 has landed, use `qa/views/*.json` instead of
  hand-made snapshots
- **Planned at**: commit `2c2f228`, 2026-09-24; rewritten 2026-10-01 as
  the single GPU checklist (the old before/after-branch method is gone:
  the branch it compared is long merged)
- **Status**: TODO

## Why this matters

The viewer is WebGPU-first with TSL node materials (ADR 0027), streams the
site as 3D Tiles with a TIN fine terrain (ADRs 0024, 0030), lights the
ground from a baked sky view and horizon (ADR 0031), draws picture styles
in one post pass (ADR 0034), and keeps phones alive with a memory governor
and a GPU-loss reload. None of it has been looked at on a real GPU: the CI
renders through SwiftShader's WebGL2 backend, which shows shadows,
anti-aliasing and precision nothing like a GPU, and the batch of features
from 2026-09-25 on (plans 023–035) and the fixes of plans 037–046 were all
built blind. Bugs that only a picture shows — moiré, shimmer, a pop, a
black face, a shadow that blinks — are found here or by visitors.

## Setup

```bash
bun install
bun dev        # bakes public/data, then serves https://localhost:3000 (self-signed)
```

- **Backends**: the default picks WebGPU where the browser has it;
  `?gpu=webgl2` forces the WebGL2 backend (`app/_components/scene-profile.ts`).
  Check sections A–G on **both**.
- **Snapshots**: the in-app Snapshot panel ("Kopieren") copies the camera,
  the time and the look as JSON. Save it as `shots/<name>.json`, then
  `bun run shots` (headed, full profile) writes `shots/<name>.png`. Never
  judge from `?scene=lite` (AGENTS.md: lite is for CI only).
- **Oblique angles**, never only head-on (AGENTS.md: a tree through a
  bridge is invisible from straight above).
- **Reference views** (make each once, keep the JSON; plan 048 commits
  them as `qa/views/`):

| View | Where / when | Used by |
|---|---|---|
| `shore-eye` | Elbe bank below the Brühlsche Terrasse at eye level, 11:00 | B, K (riverside) |
| `meadow-eye` | Großer Garten edge at eye level, 17:30 | B, K (trees, NDVI) |
| `seam-eye` | on a tile border at eye level, looking across (e.g. E 412 000 in the Neustadt) | D, K (rails, walls, fences across a seam) |
| `seam-fly` | 200 m above a four-tile corner (E 412 000 / N 5 658 000), pitched −35° | D, E |
| `oblique-400` | 400 m up, oblique over the Altstadt | D, H |
| `low-sun` | Neumarkt, 07:30 on 21 December | E |
| `roof-close` | a roof at 30 m, 13:00 | C |
| `night-street` | Hauptstraße (Neustadt) at eye level, 21:00 | K (lamps, shop glow), G (noir) |

## Checks

### A. Backends and boot

- [ ] Boot on WebGPU and on `?gpu=webgl2`: no console errors, the
  crash-trail record (`window.crashTrail.current()`) shows the backend and
  no `error` events; first frame and `ready` times on a cold cache (write
  them down).
- [ ] The same view on both backends looks the same (land-cover paint not
  mirrored — fixed in `6b9343f`, re-check; contour ink; water).
- Knob: none — a difference is a bug; report it with both plates.

### B. Palette (ADR 0023)

- [ ] `shore-eye`, `meadow-eye`: the class colours read as intended at eye
  level; the shoreline feather is soft (the water alpha is a 3×3 tent over
  class 8 in the paint pass).
- Knobs: the palette in `lib/city/landcover.ts` (a look change, no
  re-bake); the tent width in `app/_components/landcover-splat.ts`.

### C. Quantisation (glTF content)

- [ ] `roof-close` and a flat street at grazing sun: no faceting on roofs,
  no banding in flat-ground shading (8-bit normals; the fine terrain is a
  ±0.15 m TIN, ADR 0030, whose near-flat normals `terrainNormal` calms on
  purpose).
- Knob: the quantisation bits in `scripts/tile-glb.ts` (normals 8 → 10/16),
  then `bun dev` re-bakes; note the wire-size change.

### D. LOD switch and seams (ADR 0024, 0030)

- [ ] Fly slowly from `oblique-400` down to eye level and back; watch the
  terrain switch between the coarse 512² grid and the fine TIN: no visible
  pop, no cracks at tile seams (both levels have a 30 m skirt), no colour
  step at a seam.
- [ ] `seam-fly`: the far crown tier's switch at 650 m
  (`lib/city/vegetation-lod.ts` `FAR_IN_M`) does not pop, and a thinned
  forest from the air reads as forest; say whether a detail-0 crown beyond
  ~1.5 km would be worth a fourth tier.
- Knobs: `COARSE_TERRAIN_ERROR` (`lib/city/tileset.ts`), the renderer's
  `errorTarget` (`tile-stream.ts`; the memory governor scales it on phones,
  `lib/city/memory-governor.ts`), `FAR_IN_M`/`FAR_OUT_M`.

### E. Shadows

- [ ] `low-sun`: long shadows of buildings behind the camera stay (the sun's
  shadow camera is a streaming camera); turning on the spot at `seam-eye`
  never blinks a shadow (`displayActiveTiles`).
- [ ] Fly up from eye level to 600 m: the shadow frustum grows in octaves
  (`lib/city/shadow-fit.ts`, 110 → 880 m) without visible jumps; the
  shadowed patch sits where the camera looks.
- [ ] Past the frustum, the baked horizon (ADR 0031) takes over without a
  seam: the near band fades in over the frustum's last 20 %
  (`nearBandWeight`); look at the hand-over ring at a low sun.
- [ ] Eye-level shadows clip ahead at a low sun? If long shadows visibly
  end a few tens of metres ahead, note it — the backlog's "shadow centre
  biased ahead at eye level" (README, Open work 11) is the fix to try.
- [ ] Night: after dusk no tile stays pinned where the last daytime shadow
  was (plan 038 step 1 — check `getGpuDebug()` after a night flight).
- Knobs: `shadow.radius`, `bias` in `app/_components/sun-rig.ts` (keep
  `normalBias = 0`, ADR 0009); the horizon's band weights in
  `lib/city/skyview.ts`.

### F. Contact shadows and sky light

- [ ] GTAO's contact shadows at feet, kerbs, benches and facades: present,
  smooth (the 5×5 depth-aware box, `post-stack.ts` `aoSmoothed`), no
  speckle; compare with the plates of the WebGPU spike if you have them.
- [ ] Sky view (ADR 0031) and GTAO together: no double darkening in narrow
  courtyards and street canyons; decide whether *Boden-Verlauf* (`uAO`,
  `app/_components/visual-style.ts`) is still needed next to the sky view,
  or retire it.
- Knobs: GTAO radius/thickness/samples (`aoSamplesFor`), the sky-light
  strength sliders (*Himmelslicht*, *Ferne Schatten*).

### G. Picture styles (ADR 0034)

- [ ] Each style (key `V`: Comic, Film noir, Sin City, Papier) at
  `oblique-400`, `night-street` and eye level: ink lines calm (no crawling
  on grazing streets), tone as intended, no NaN-black pixels.
- [ ] Papier: fences, walls and stairs show from both sides; winter crowns
  are bare, not solid (plan 039 step 4); the style switch does not hitch
  once the scene is idle (`PostStack.warmStyles`).
- [ ] Sin City rain after an hour in the style still falls in streaks, not
  columns (plan 039 step 2).
- [ ] Film noir's lamp cones at night under every lamp.

### H. Frame time and memory (desktop)

- [ ] Frame time at `oblique-400` and at eye level in the Altstadt (a
  desktop GPU and one laptop GPU); the main-thread long tasks while tiles
  stream (Performance panel: dressing builds, BVH builds, JSON parses —
  plans 042–044 measure these).
- [ ] GPU memory: `__poc.handle.getGpuDebug()` (dev) before and after a
  flight across the site and back, three times — it settles (the tile
  cache), it does not climb (a leak in the dressing plugin's `disposeTile`).
- [ ] The three always-present lamp `PointLight`s cost fill rate by day
  (intensity 0, still shaded): time the scene pass with and without them
  (`app/_components/lamp-layer.ts`); if it matters, note it for a
  uniform-gated lighting term.
- [ ] Shadow-pass pipelines for new casters still build in a frame, and the
  WebGL2 backend compiles synchronously (ADR 0027): count the hitches on a
  fly-over on each backend.
- [ ] The water and mist sheets: count their triangles per frame
  (`renderer.info`) — the backlog's item 8 is ranked on a pre-TIN count.
- Knobs: the tile cache (`tileCacheBytesFor`, `scene-profile.ts`),
  `errorTarget`.

### I. Phones (one Android, one iOS)

On the dev server over the LAN (`bun dev` serves HTTPS for exactly this):

- [ ] Boot, walk, double-tap travel, one demolish, a minimap jump into the
  Heide and back: no reload from GPU memory; the phone's 2048² rasters are
  the ones fetched (Network panel).
- [ ] The memory governor steps down and back up (crash trail beats show
  its level) without leaving the ground unloaded (the Alaunpark case in
  `scene-profile.ts`).
- [ ] A forced GPU loss (background the tab under memory pressure, or a
  heavy flight) reloads in place once and restores the view; it does not
  loop (plan 038 step 3).
- [ ] Locate me and live mode with the compass; a minimap jump ends live
  mode (plan 038 step 5).
- [ ] **Listening pass** (plan 035, rides along — not a GPU check): the
  soundscape (key `L` / *Klang*) in Chrome, Safari and on the iPhone:
  levels and timbres; iOS unlock with the `ambient` audio session (fall
  back to `"playback"` if the iPhone stays silent); CPU cost on the phone.
  A source that sounds cheesy is removed (plan 035's rule).

### J. Deploy host

- [ ] On a preview deploy: `*.glb.gz` arrives **unchanged** — no second
  `Content-Encoding: gzip`, no content-type sniffing that rewrites it (the
  client inflates it itself after a magic-byte check; a host that
  decompresses transparently is fine, one that re-compresses and drops the
  magic is not).

### K. Feature plates (plans 023–039)

<!-- FEATURE-PLATES -->

### L. To decide on a GPU before building (backlog)

Not checks of something built — judgements the backlog waits for:
the pixel-ratio drop while moving (README Open work 6, needs a ~1 s hold),
atmospheric motes (7), the geometry kit's winding unification (21, plan
046's maintenance note: needs a headed before/after comparison), and a
user-facing quality tier (Direction 5).

## STOP conditions

- A visible defect that no knob above fixes: report the snapshot JSON and
  the plates of both backends.
- GPU memory keeps climbing across repeated flights.
- A phone reloads more than once in ten minutes for the same view.

## Findings

(fill in per item: date, GPU or device, verdict, numbers, knob changes)
