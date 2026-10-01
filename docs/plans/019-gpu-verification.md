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

Each block comes from a condensed plan in [completed.md](./completed.md);
the plan's record there says what was built and why. Tick items here.

#### 023 — The ground up close (kerbs, paving, lawn edges, urban green; plan 023 phase 4)

([record](./completed.md#023--the-ground-up-close-kerbs-paving-lawn-edges-urban-green--closed-2026-09-25-phases-13-and-5-built-rest-rejected-or-moved))

All at the full profile, `bun run shots --headed`, oblique (never straight
down), eye level (walk mode) unless said otherwise, default pastel style.
Each spot at noon and at a low sun (≈ 1 h before sunset, a summer date),
with *Bodendetail* at 0, 0.7 (default) and 1.

- [ ] **Sett street, Äußere Neustadt** — EPSG 412 991 / 5 657 977
  (33412_5656). Look at the sett tone and grain, the slab running bond on
  the pavement, the kerb stone and gutter. Good: sett reads as a darker,
  warmer paving, not a quilt or a grid; joints vanish smoothly with
  distance, no moiré at any distance. STOP: moiré anywhere → fix the
  `fwidth` fades in `ground-detail.ts`; do not raise the texture budget.
- [ ] **Asphalt road with a lawn** — 413 456 / 5 657 131 (33412_5656). Kerb
  width and contrast, the lawn lip, any parking lane with its bays. Good:
  the kerb stone (12 cm, 24 cm wide) meets the pavement without a second
  step and its foot does not float over the gutter (ADR 0035); the lawn
  edge is a soft lip, not a dark line; parking bays faint and straight.
  Tune kerb width/contrast and the gutter darkening if it reads as a
  stripe.
- [ ] **Green courtyard** — 412 777 / 5 657 187 (33412_5656), *Stadtgrün* 0
  and 1. Good: NDVI-green courtyards read as meadow with a lawn edge, and
  no paved ground goes green; tune the 0.3 NDVI threshold (`GREEN_NDVI`
  in `pipeline/bake/edges.py`, a re-bake of `edges`) if trees' shade or
  roofs leak green onto paving.
- [ ] **Kerb shadow at low sun** — any of the spots above with the sun behind
  the kerb. Good: a thin shaded strip on the road out to
  12 cm · cot(elevation) that lines up with the stone's real shadow where
  the shadow map draws one; no double shadow, no bright gap at the foot.
- [ ] **Albertplatz** (33412_5656, the "Albertplatz" viewpoint, then down to
  eye level). Good: the pedestrian island, lawns and fountain basins
  carved out of the DLM road area have kerbs and lawn edges like any
  street.
- [ ] **Kerb joins** — the worst place `scripts/ground-joins.ts` reports for
  kerbs, oblique at eye level. Good: no gap under the stone, no stone
  standing proud of the pavement.
- [ ] **Frame time** — the same three spots at 1080p, *Bodendetail* 0 vs 1
  (16 class-texel fetches per near fragment where no edge raster is read,
  plus the edge and paving reads). Record the delta. Bar: ≤ 0.5 ms; over
  it, report the number — the plan's fallback (drop the 4×4 smoothing to
  3×3) no longer applies on the fine level, which reads the baked edges.

#### 024 — Trams

([record](./completed.md#024--trams-tracks-overhead-line-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019))

Full profile, `bun run shots --headed`, oblique plates; default pastel
style unless said.

- [ ] **Postplatz junction** (≈ EPSG 411 260 / 5 656 200, 33410_5656), noon,
  eye level and ~30 m up. Look at the rails and their beds where the
  street, grass and ballast stretches meet. Good: street track flush in
  the paving with no brown ballast strip on the square (the per-20 m bed
  rule of 2026-09-30 is unseen on a GPU); rails a shade deeper than the
  road, calm, no groove line.
- [ ] **Augustusbrücke** (≈ 411 650 / 5 656 700, 33410_5656), noon, oblique
  from the bank. Good: the tracks ride the deck along its ramp, not
  through it or floating above; also check a tram passing *under* a
  railway bridge stays on the ground (and Albertbrücke ≈ 412 700 /
  5 656 950, 33412_5656, Carolabrücke — "Carolabrücke" viewpoint).
- [ ] **Wires at dusk against the sky** — a street with spans and rosettes
  (Postplatz; Hauptstraße, 33410_5656 / 33412_5656; Albertplatz), eye level,
  sun just set. Good: contact wire, spans and hangers read as faint
  pencil lines; no crawling, shimmer or dashed breakup while walking.
- [ ] **Wires from 150 m in fly mode** over the same streets. Good: wires fade
  out cleanly by 350 m, no aliasing stipple. STOP: shimmer or crawl at any
  distance → fix the pixel-width floor (`WIRE_MIN_PX` 0.8) and the fade
  (`WIRE_FADE` 150–350 m) in `tram-layer.ts`; do not add MSAA or a line
  library.
- [ ] **Shadow cost** — the frame's shadow pass with the tram layer on vs off
  on 33410_5656. STOP if it rises > 0.3 ms: wires and spans must not cast
  (they don't; only the masts do) — find what does.
- [ ] **Masts and supports** — a span street and a rosette street up close.
  Good: pale green-grey masts stand on the ground, spans reach a mast or
  a facade (no wire ending in mid-air at a tile seam), arms sit over
  their track.
- [ ] **Stop signs** — Postplatz or Albertplatz stops. Good: the "H" sign
  stands on the platform facing the track, not on the rails, and no
  doubled sign beside a shelter.

#### 025 — Trees by species and season

([record](./completed.md#025--trees-by-species-and-season--done-2026-09-25-look-unjudged-on-a-gpu--plan-019))

Full profile, `bun run shots --headed`, oblique, default pastel style; set
the date in the HUD (the Snapshot carries it).

- [ ] **OSM trees vs the cadastre — the Zwinger courtyard** (33410_5656, the
  "Zwinger & Semperoper" viewpoint, then down to eye level), summer noon.
  Good: courtyard and court trees present once each, no OSM tree doubling
  a cadastre, canopy or laser-scan crown. STOP: duplicates visible →
  tighten the 3 m rule and the canopy veto (`keepTree`); do not add a
  second veto path.
- [ ] **Autumn hues, 15 October and 1 November, noon** — the Königsufer
  (the Neustadt bank between Augustus- and Carolabrücke, ≈ EPSG
  411 950 / 5 657 050, 33410_5656, eye level) and a lime avenue (the
  Tilia run around EPSG 413 550 / 5 657 150, 33412_5656: 72 limes in
  that 100 m cell). Good: a street turns over a week, not at once
  (±6-day jitter); limes butter yellow and early, maples orange to red,
  horse-chestnuts already brown; hues sit in the pastel palette, not
  saturated decoration.
- [ ] **Bare crowns, 10 January, noon and low sun** — same places, eye level
  and ~60 m up. Good: a sparse grey-brown twig stipple that reads as a
  winter crown, trunks unchanged, oaks holding some brown leaves; the
  shadow on the ground is visibly thinner than in summer.
- [ ] **Motion check of the stipple** — walk and turn under bare crowns, then
  fly over at 150 m, 10 January. STOP: flicker or "noise" (the reason
  plain foliage translucency was rejected) → raise the dither cell
  (`HASH_PIXELS`, 1.25 px) or fade the twigs with distance first; if
  still noisy, ship colour only (no bare variant).
- [ ] **Date drag** — drag the date across the leaf fall (October → January)
  on the full site. Good: no visible hitch; the change is throttled to
  150 ms and measured 4–7 ms on CPU, so a stall points at the upload or
  a compile the warm-up missed.

#### 026 — Road markings

([record](./completed.md#026--road-markings--done-2026-09-25-look-unjudged-on-a-gpu--plan-019))

- [ ] **Crossings at Albertplatz** (`33412_5656`, viewpoint *Albertplatz*;
  daylight, e.g. noon in June; walking height and oblique from ~30 m):
  zebras and *Furt* lines sit on the carriageway, across it, at the
  footway's angle; a far zebra averages to a pale band, never stripes.
  STOP: more than 1 in 10 of 20 sampled crossings (across the tiles)
  visibly off the carriageway or at the wrong angle — report before
  tuning; the node-to-road snap is the suspect.
- [ ] **Crossings and stop lines at Postplatz** (`33410_5656`; same light,
  walking height and from 150 m): stop lines 3 m before the signals, on
  the right half of the approach; a doubly mapped crossing shows one
  marking, not two overlapping.
- [ ] **Cycle lanes and centre lines on the Königsbrücker Straße**
  (`33412_5658`, north of Albertplatz; walking height and from 150 m):
  the broken cycle line 1.85 m from the kerb on the tagged side; centre
  dashes only on the main road. STOP: centre lines on a road a human
  reads as one lane — drop the centre lines, keep the rest.
- [ ] **Moiré** (any of the above, slow fly-out from street level to ~250 m,
  low sun and noon): no shimmer or moiré at any distance. If there is,
  the fades are wrong, not the raster budget — fix the box filter / fade,
  do not enlarge the raster.
- [ ] **Phone** (a real phone, the 1024² twin): crossings and stop lines
  still resolve; cycle and centre lines may be coarser (≈90 % agreement
  with the full raster) but must not break into blocks.

#### 027 — Shop glow and heritage at dusk

([record](./completed.md#027--what-osm-knows-about-the-buildings--done-2026-09-25-phase-3-rejected-dusk-look-unjudged-on-a-gpu--plan-019))

- [ ] **Phase 0, parts at dusk** (`33410_5656`, the Altstadt — viewpoint
  *Neumarkt* or *Zwinger & Semperoper*; dusk, ~21:00 in June, walking
  height): commerce/public buildings made of `BuildingPart`s now glow and
  wear their use's tint over every part, not housing tint with a dark
  part beside a lit one. Before/after plate if an old build is at hand.
- [ ] **Shop fronts, Äußere Neustadt** (`33412_5658`, Alaunstraße /
  Louisenstraße, viewpoint *Äußere Neustadt*; 21:00, walking height and
  oblique from ~20 m): a soft warm wash on the ground floor of shop
  buildings only, varying along a long front, soft top edge; housing
  without a shop stays dark. STOP: the wash reads as a window band or a
  glowing plinth on housing — keep it to shop buildings and lower the
  strength (0.4 × the dusk glow today); never add window structure.
- [ ] **Shop fronts, Prager Straße** (`33410_5654`; 21:00, walking height):
  the same check on large modern blocks — the wash stays on the ground
  floor and does not light the whole slab.
- [ ] **Listed facades** (`33410_5656`, Zwinger, Schloss, the Altstadt
  blocks; daylight and dusk, walking height and from ~150 m): the warm
  lift and the second cornice line 0.45 m under the eave are barely
  there. STOP: if they read as highlighting (listed buildings popping out
  of the block), switch them off.

#### 028 — Allotments, orchards, vineyards

([record](./completed.md#028--cultivated-land-allotments-orchards-vineyards--done-2026-09-25-look-unjudged-on-a-gpu--plan-019))

- [ ] **Allotment colonies from the air** (`33410_5658`, the densest tile
  with 47 colonies; from ≈180 m up, oblique, daylight in summer): the
  colonies read as soft gardens with a soft, wandering edge — no raster
  staircase along the edge or the carved paths, no flat stripes, no
  moiré; far off they settle to one calm colony tone. This is the exact
  view that rejected the first look (🗃️ *Allotment bed bands*).
- [ ] **Allotments on foot** (the colonies east of the Großer Garten on
  `33414_5654`, ≈414 400–415 600 E / 5 654 000–5 655 900 N, and the two
  in the Johannstadt on `33412_5656`, ≈413 200–414 000 E / 5 657 800 N;
  walking height, noon and low sun): plots
  with thin soft paths, soft greens, a few warm beds and flower dots,
  sitting with the LoD2 sheds, OSM hedges and fences. STOP (chessboard):
  if the plots read as a regular board, orient beds per mapped parcel only
  and fall back to plain meadow mottle elsewhere — since no colony maps
  parcels today, that means lowering or switching off the plot texture.
  STOP (noise): if the texture alone reads as noise from walking height,
  ship it at a lower strength (`COLONY_GARDEN.strength`, now 0.85 of
  *Bodendetail*).
- [ ] **Phone** (a real phone, half-resolution colony raster): the colony
  edge stays soft, no stair-stepping.
- [ ] **Orchards** (`33408_5654`, the orchard with 30 mapped trees; walking
  height): small round crowns on ≈1.3 m stems, not doubled with a canopy
  or cadastre tree beside them.
- [ ] **Vineyard plate — possible now** (the Loschwitz slopes, `33416_5656`
  has 7 vineyards with 144 rows, also `33414_5656` and `33416_5654`; near
  the viewpoint *Blaues Wunder*; oblique from ~50 m and from the river
  at walking height; summer and low sun): rows run along the contour,
  1.8 m apart, standing on the slope without floating or sinking, no
  kink at the seam x = 416 000; no moiré from the air. Season: the rows
  stay in leaf all year until the open season item is built — note
  whether a winter date looks wrong enough to raise its priority.

#### 029 — Fences and gates

([record](./completed.md#029--fences-railings-and-gates--done-2026-09-25-restyled-to-one-band-look-unjudged-on-a-gpu--plan-019))

- [ ] **The band's look, Großer Garten edge** (`33412_5654`, viewpoint
  *Großer Garten*; noon and low sun, walking height and from 150 m,
  oblique): one low calm band in a muted tone close to the ground and
  the hedges, a little deeper at the foot, lighter at the top edge; no
  stripes, no moiré, no shimmer, no side gone dark grey against the sun;
  far off it fades into the pale ground (40–160 m). The colour itself has
  only been seen on SwiftShader. If a band still reads as ink or as a
  wall, lighten the tone or the far fade — do not bring back bars,
  posts, holes or dither (🗃️ *Drawn fence panels*).
- [ ] **A school yard and a Neustadt courtyard** (`33412_5658`, Äußere
  Neustadt; noon and low sun, walking height): the band reads as a fence
  line, not a kerb or a wall; it receives shadows and casts none, and
  that absence does not look wrong at low sun.
- [ ] **Gates** (any fenced yard or park entrance; walking height): a gap
  with a lighter leaf in it reads as a gate; a lift gate / cycle barrier
  shows as a boom at the band's top; a gate on a freestanding wall cuts
  the wall cleanly.
- [ ] **Fence crossing buildings or roads** (sample 10–20 fences across the
  tiles; oblique): STOP if a fence visibly crosses a building or the
  carriageway in more than 1 in 10 checked — the OSM line is misaligned
  with LoD2/DLM; report, do not shift lines heuristically. (Headless
  numbers on the four first tiles: 5.4 % run > 1 m inside a footprint,
  9.7 % over the DLM road class, which includes pavements.)
- [ ] **Ground join** (the worst places `bun scripts/ground-joins.ts` prints
  for fences; oblique, walking height): the band's foot never floats
  over a dip or ends in the air on a slope (ADR 0035); a seam of tile
  edges shows no ruler-straight fence along it.
- [ ] **Phone** (a real phone, walking height and fly mode): the band stays
  calm — the drawn panels failed exactly here.

#### 030 — Street furniture, second set

([record](./completed.md#030--more-street-furniture-columns-signals-hydrants-clocks-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019))

Full profile, `bun run shots --headed`, eye level (≈1.7 m) unless noted,
oblique views, the default pastel style.

- [ ] **Hydrant sign plates — clutter check (the plan's STOP).** Where:
  tile 33410_5656 (251 plates — the Altstadt south towards Prager Straße
  and the *Hauptbahnhof* viewpoint) and 33410_5654 (228), on foot along a
  residential pavement, midday. Good: the small rose plates on their
  posts read as incidental pavement detail, not a forest of signs; none
  stands in a lane. Fallback the plan set: they are already drawn at 70 %
  (`HYDRANT_SIGN_SCALE`); if they still clutter, drop the underground
  hydrants' plates and keep only the 24 pillar hydrants — report which.
- [ ] **Traffic signals at a junction.** Where: a signalled junction on
  33412_5656 (105 signals) or the *Albertplatz* viewpoint, eye level,
  midday. Good: poles stand on the pavement at the kerb, not in the
  carriageway; each head faces the traffic it controls; the head is a
  shade deeper than the pole with barely darker glass (no near-black
  boxes). If heads face the wrong way, the bake's direction walk is the
  suspect, not the model.
- [ ] **Advertising columns, day and dusk.** Where: any column (the lit
  one at about 410 181 E / 5 655 015 N on 33410_5654), once at midday and
  once at dusk (e.g. 21 December, 16:45). Good: a pale paper drum with
  three muted poster fields, no two alike; the few lit columns glow
  softly with the night factor, the rest stay dark.
- [ ] **Clocks show the scene time.** Where: a pole clock (20 over the
  site) and the two wall clocks at about 411 488 E / 5 656 486 N
  (33410_5656). Scrub the time slider across a few minutes and hours.
  Good: the hands follow the slider; the wall clocks sit flush on the
  facade (they hang on the OSM outline, so check they neither float off
  the LoD2 wall nor sink into it); scrubbing does not redraw shadows
  (the hands never cast).
- [ ] **Stop signs and drinking fountains.** Where: a bus stop without a
  shelter, and a drinking fountain (15 over the site), eye level. Good:
  the "H" reads as a stop sign from colour fields alone (green disc in a
  yellow one, no letter); the fountain is a slim bronze column with a
  basin, in the furniture's soft palette.
- [ ] **Cost.** Frame time at a dense junction with the new kinds in view,
  noted next to plan 019's frame-time numbers (there is no furniture
  toggle to compare against); the kinds are instanced sets sharing the
  furniture's materials, so nothing should stand out.

#### 031 — The Elbe: landing stages, groynes, ferries

([record](./completed.md#031--the-elbe-landing-stages-groynes-ferries--done-2026-09-25-look-unjudged-on-a-gpu--plan-019))

Full profile, `bun run shots --headed`, oblique views (the plan: from the
Brühlsche Terrasse and from the Neustadt bank), the default pastel style.

- [ ] **Terrassenufer landing stages (phase 1 plate).** Where: the
  *Brühlsche Terrasse* viewpoint (120 m, looking south-southwest over the
  river) and then down at the Terrassenufer at eye level; the pontoons lie
  on 33410_5656 (9 pontoons, 17 piers) and 33412_5656 (20 pontoons);
  midday. Good: hulls sit on the drawn water line — neither buried in the
  bank nor floating above it — decks pale, hulls soft slate, gangways
  reaching their bank point, ticket huts on the long pontoons. STOP the
  plan set: if a hull clips or floats visibly, report the offset at that
  pontoon; the runtime floats it on the lowest terrain under its cut hull
  (the surface the water sheet is drawn on), so a mismatch points at the
  cut, not at a water level.
- [ ] **Piers and railings.** Where: the piers on 33410_5656 and the
  cluster on 33416_5656 (10 piers, 9 pontoons, towards the *Blaues
  Wunder* viewpoint), eye level from the bank. Good: the timber deck on
  its piles over the water only, the railing along the water edges only.
  Compare with plan 029's fences on the same bank: if the railing's
  rail-and-posts reads unlike the fences' calm band, note it for a
  restyle.
- [ ] **Groyne.** Where: 33412_5656 (the only one), from the bank at eye
  level and from ~40 m. Good: a low stone ridge, half under the drawn
  water, not a wall.
- [ ] **Ferry wakes (the plan's STOP).** Where: the Johannstadt ferry on
  33412_5656 and the steamer route along the river; fly from 20 m up to
  ~80 m over the water, and the *Elbe-Panorama* viewpoint. Good: nothing
  at eye level; from 25 m the faint dashed wake fades in (full at 60 m)
  and reads as part of the water, a map mark in the contour-map spirit.
  Fallback the plan set: the fly-mode-only fade is already the
  conservative choice taken without a plate; if the wake still reads as a
  UI overlay from the air, drop the ferry lines.

#### 033 — Sky view and horizon shade

([record](./completed.md#033--sky-view-factor-and-baked-horizon-shading--done-2026-09-25-plates-and-tuning-open-on-a-gpu--plan-019))

Lighting work: full profile, `bun run shots --headed`, a real GPU only
(SwiftShader is useless here), the default pastel style. Shipped defaults
are conservative stand-ins: *Himmelslicht* 0.5, *Ferne Schatten* 0.8 — the
point of these plates is to set them.

- [ ] **Sky view on the ground (phase 1 plates).** Where: a Neustadt
  courtyard (the *Äußere Neustadt* viewpoint, 33410_5658 / 33412_5658),
  Prager Straße (33410_5656, towards the *Hauptbahnhof* viewpoint) and
  the Elbwiesen (the *Elbufer* viewpoint); eye level; once at noon in June
  and once at a low sun (e.g. 21 December, 14:00). Take each with
  *Himmelslicht* at 0, 0.5 and 1. Good: a narrow courtyard is visibly
  dimmer in its ambient light than the open meadow, the sunlit parts are
  untouched, no dark band at the wall feet. Then set the default.
- [ ] **Double-darkening with the contact shadows (the plan's STOP).**
  Same courtyard plates, *Kontaktschatten* at its default and at 0.
  Good: sky view and GTAO together read as soft, deep light, not as dirt
  in the corners. Remedy the plan set: weaken the contact shadows where
  the SVF is low before lowering the SVF.
- [ ] **Facades (phase 3).** Same courtyard, looking up a facade. Good: the
  ground floor of an enclosed courtyard dims, the eaves and roofs do not.
  Then decide *Boden-Verlauf* (the clay's ~5 m ground darkening, untouched
  so far): retune or retire it against the sky view, and report which.
- [ ] **Far shadows at a low sun (phase 2 plate).** Where: the *Brühlsche
  Terrasse*, looking along the Terrassenufer (33410_5656 → 33412_5656), on
  21 December at a low sun. The plan named 17:30, but the sun sets near
  16:00 CET then; take about 15:00–15:30 CET (sun ≈ 6–3°). Take it with
  *Ferne Schatten* at 0 and at the default. Good: streets and the river
  bank beyond the shadow frustum carry the long shadows of the Altstadt
  and of their own neighbours instead of lying fully sunlit; the edge of
  the far shadow is soft (±0.8°), not stair-stepped by the 8 m raster.
  Then set the default.
- [ ] **Frustum hand-over seam (the plan's STOP).** Same view, walk and fly
  slowly (eye level, then ~100 m, ~300 m — the frustum grows in octaves
  with altitude). Good: no visible line or brightness step where the
  shadow map hands over to the horizon term. The fade over the frustum's
  last 20 % was built pre-emptively; if a seam still shows, report the
  plate (and the distance) before widening the fade.
- [ ] **Site rim.** From the *Elbe-Panorama* or *Über den Dächern*
  viewpoint at a low sun, look toward an outer tile (e.g. 33416_5658).
  Expected: past the site's edge the baked skyline is open ground, so a
  rim tile gets fewer far shadows than the centre — confirm it does not
  read as a lit band.
- [ ] **Cost.** Frame time with both rows at 0 and at their defaults, same
  view: a few texture fetches in the ground and clay passes, so no
  measurable change is expected.

#### 034 — Small structures from the laser scan

([record](./completed.md#034--small-structures-from-dom--lod2--done-2026-09-26-look-unjudged-on-a-gpu--plan-019))

Full profile, `bun run shots --headed`, oblique views at eye level
(≈1.7 m) and from ~30–60 m, midday and a low sun, the default pastel
style. Checked headless only so far.

- [ ] **An allotment colony (phase 2 plate).** Where: the densest cells
  lie around 411 400–411 900 E / 5 659 000–5 659 400 N (33410_5658, north
  of the *Alaunpark* viewpoint, ~100 boxes per 250 m cell) and around
  408 600 E / 5 656 300 N (33408_5656). Eye level along a colony path and
  from ~40 m. Good: garden houses read as small clay buildings among the
  plan 028 allotment beds — the same family as the LoD2, flat or pent
  roofs in the slate palette, standing on the ground (no floating corner,
  no sunk wall foot), no tree crown growing through a roof.
- [ ] **A Neustadt courtyard (phase 2 plate).** Where: a courtyard in the
  *Äußere Neustadt* (33410_5658 / 33412_5658), eye level and from ~30 m.
  Good: sheds and carports sit against the LoD2 blocks without
  z-fighting or slivers along a roof edge; their shadows fall like the
  buildings'.
- [ ] **The squares stay empty (the plan's STOP: what the flight saw that
  day only).** Where: the Altmarkt and the Neumarkt (33410_5656, the
  *Neumarkt* viewpoint), Prager Straße, from ~40 m. Good: no Christmas
  market stalls (the flight was 27–30 Nov 2024, the Striezelmarkt was up;
  the bake drops pedestrian areas and squares). Known leftovers to judge:
  three probable stalls on the Schloßstraße pavement beside the
  Kulturpalast, and the Alberthafen's container stacks (33408_5656) — if
  they read as clutter, report them for an OSM exclusion.
- [ ] **Seams.** Where: any seam between two tiles crossing a colony (27
  structures straddle one). Good: a straddling shed is drawn once, whole,
  from the tile that owns its centre.

#### 035 — The soundscape — listening pass (rides along with section I)

([record](./completed.md#035--a-hidden-soundscape--done-2026-09-26-unheard-the-listening-pass-is-a-maintainer-action))

Not a GPU check, but it needs real browsers and a real phone, so it rides
along with plan 019's phone session. Listen with headphones and with
speakers, in Chrome, Safari and iOS Safari, full profile. Nothing has
been heard yet: every level and timbre was set on paper. The plan's rule
for the whole pass: a source the maintainer finds cheesy is **removed,
not tuned** — the soundscape is better sparse.

- [ ] **Nothing before the toggle (blocker).** Load the viewer in each
  browser, walk and fly, scrub the time slider: silence. A sound before
  **L** or the *Klang (experimentell)* switch, in any browser, is a
  blocker. Also: no sound while the loading overlay shows, and the sound
  fades out on a hidden tab.
- [ ] **iOS unlock and the audio session.** On an iPhone, turn it on with
  the *Klang* switch (the Erweitert tab). Good: it plays, mixes with the
  phone's own audio and keeps to the silent switch (the `ambient`
  session). Fallback the build set: if iPhones stay silent, switch the
  session type to `"playback"` and listen again.
- [ ] **Beds: wind, hum, water, leaves.** On foot on the Elbwiesen (the
  *Elbufer* viewpoint), in a narrow Neustadt street (*Äußere Neustadt*),
  among trees in the *Großer Garten*, and flying at ~150 m. Good: the
  Elbe's low murmur rises as you near the water and pans to its side;
  wind grows with height and open sky; the city's hum is far and low,
  quieter at night; leaf rustle follows the crowns' sway and is gone in
  winter (Dec–Mar) and above the crowns.
- [ ] **Events: birds, crickets, fountains.** In the *Großer Garten* at a
  spring dawn (e.g. 5 May, 05:30), at noon and at night; on a meadow on a
  warm July night; next to a fountain (April–October, 8–22 h). Good:
  birds sparse and natural (sparrows in streets, tits in parks, a
  blackbird at dusk), silent at night; crickets only on summer nights
  near meadows; the fountain's splash only within ~45 m.
- [ ] **Footsteps by paving.** Walk over sett in the Neustadt, asphalt,
  a gravel path in the *Großer Garten*, the grass of the Elbwiesen; then
  sprint, then fly. Good: the surface is audible in each step; sprinting
  lengthens the stride instead of a drum roll; silent in fly mode and on
  a jump.
- [ ] **Hour bells.** On the *Neumarkt*, scrub the time slider past 18:00
  and let go. Good: after ~0.7 s the Frauenkirche strikes first, the
  Kreuzkirche a beat later from its own direction (distance at 343 m/s);
  six strokes; a minor-third bell, deep for the large towers; nothing on
  a backward scrub.
- [ ] **Tram bell.** Within 70 m of a track between 4:30 and 0:30, wait a
  few minutes. Good: a rare two-stroke bell from the track's side, about
  once in 2½ minutes — not a nag.
- [ ] **Cost on a phone (the plan's STOP).** On the same iPhone and
  Android device, frame time with sound off and on at the same view.
  Good: no measurable change (the 10 Hz sampling is ≈ 600 raster reads
  and a tree count; the reverb is one 2.4 s convolver). If it shows,
  move the work out of the 10 Hz handler into scheduled audio parameters
  or lower its rate.
- [ ] **Write down** the levels kept or changed and every source removed,
  in the ledger's *Sound* section, and say whether plan 036's rank 6 (a
  soundscape from measured data) is worth building on what was heard.

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
