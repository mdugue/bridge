# Plan 023: The ground up close — kerbs, paving, lawn edges, urban green

> **Executor instructions**: Phases 1–3 are built (this plan's first PR).
> The open phases are independent; take them in the order below. Phases 4,
> 6 and 7 need a real GPU to judge (`bun run shots --headed`, full
> profile). The lite profile and SwiftShader are for "does it compile",
> never for the look. If anything in "STOP conditions" occurs, stop and
> report with the numbers. Update the status row in
> `docs/plans/README.md` when a phase lands.
>
> **Drift check (run first)**:
> `git diff --stat HEAD~1..HEAD -- app/_components/ground-detail.ts app/_components/terrain-layer.ts pipeline/bake/surface.py`

## Status

- **Priority**: P2 (look; the ground is what a walker sees most of)
- **Effort**: phases 1–3 M (done); 4 S; 5 M; 6 M–L; 7 S–M; 8 M
- **Risk**: LOW for the shader phases (one fragment pass, sliders at 0
  switch them off); MED for 6 (fill-rate) and 8 (a new raw product)
- **Planned at**: 2026-09-25
- **Status**: PARTIAL — 1–3 (with 2b parking), 5 (kerb stones) done; 4, 6–8 open

## Why this matters

At eye level the ground fills half the frame, and it was the flattest thing
in it: one pastel colour per land-cover class, with a soft, stair-stepped
blend where the road met the pavement (the class raster is 0.5 m per texel
and the colour splat is sampled with LINEAR). The data knew more than the
picture showed:

- The DLM road class is the carriageway **at its surveyed width** (`BRF`),
  so its edge already is the kerb line. The pavement was the built-up clay
  beside it, with no edge.
- OpenStreetMap tags what streets are made of. In the Dresden extract
  (2026-09-19, the four tiles' bounding box) **~87 % of the 18 100 highway
  ways carry `surface`** (asphalt 5 300, paving_stones 4 600, sett 2 200,
  compacted 740, concrete 620, …), and **~1 800 roads carry
  `sidewalk:*:surface`**. ~68 % of the DLM carriageway texels get a material
  from it.
- The DOP NDVI was used on class 1 only. The built-up class (4) also covers
  courtyards, front gardens and parks: about 10 % of its texels have
  NDVI > 0.3 (median meadow ≈ 0.4, median built-up 0).

What did *not* work is recorded too: the camera-following grass-tuft ring
was rejected earlier (reads as confetti, rewrites shadow casters every
frame, ledger 🗃️), so volume for grass has to be a shader technique.

## Phase 1 — Kerbs and lawn edges in the shader ✅

`app/_components/ground-detail.ts`, patched into the terrain's fragment
pass after the meadow mottle.

- The four class texels around the fragment as 0/1 road indicators,
  bilinear, give a field whose 0.5 isoline is the road edge; dividing by
  the field's gradient gives a **signed distance in metres**.
- That alone follows the raster's staircase (checked in a SwiftShader
  plate), so near the camera (`fwidth` < 0.5 m/px) the field is built from
  the 4×4 block, box-smoothed 3×3 before the bilinear step. 16
  `texelFetch`es, near-only.
- Kerb stone 0.3 m on the pavement side, a gutter 0.35 m on the road side
  (−14 %, −8 % more in the first 8 cm), a normal step at the face (view
  space, derived from the data-frame gradient). Only where the far side is
  ground a kerb borders (classes 0–4, 6), not water or railway.
- The same distance on class 1: a lawn lip 0.25 m (−12 %) and a normal
  kink.
- Everything scales with the new look row **`groundDetail`**
  (*Bodendetail*, default 0.7).

## Phase 1b — Baked edges and kerb stones ✅ (after the first review)

On a real GPU the first cut's kerb read as colour only, and its
shading-normal "face" followed the class raster's 0.5 m staircase: a row of
dark dashes with odd shadow flecks. Two changes:

- **`pipeline/bake/edges.py`** measures, from the committed class raster,
  the signed distance to the road edge and to the meadow edge out to ±6 m
  (ring-by-ring growth, octagonal metric), smooths it (three 3×3 box
  passes) and writes `edges_<tile>.png` (2048², RG interleaved in a
  greyscale PNG). The shader reads the kerb band, gutter, lawn lip,
  parking lanes and the across-street paving coordinate from it: straight
  along diagonals, valid metres out. The 4×4 box-smoothed class texels stay
  as the fallback (coarse level, other sites). The normal "face" is gone.
- The same bake writes the **kerb lines** (marching squares on the road
  field's 0 level, beside water or railway dropped, road on the left), and
  the terrain bake stands a **kerb stone** on them in the fine terrain glTF
  (`lib/city/kerbs.ts`: 12 cm above the road, 24 cm wide, the top level at
  the higher side so an uneven road never tilts it, face toward the road;
  `kerb-layer.ts`, casting). ≈ 60–80 km of kerb per tile, sampled every
  2.5 m: ≈ 130–200 k triangles, ≈ 0.2–0.4 MB in L0.

The pavement behind the stone stays at road level (the DGM has no step);
a raised pavement would mean shaping the terrain along every kerb.

## Phase 2 — Paving from OSM ✅

`pipeline/bake/surface.py` → `data/dlm/surface_<tile>.png` (+ legend JSON
with the ODbL credit), a new optional tile artifact, named in the **fine**
terrain level's extras only (`surface`), loaded NEAREST as an RG texture
(two interleaved bytes per texel in a greyscale PNG, see 2b).

- **R = walk · 8 + road**: an OSM road buffer (half-width per `highway`
  class, else `width`) reaches past the DLM carriageway onto the pavement,
  so each texel carries both answers; the shader reads `road` on class 7
  and `walk` elsewhere. Roads burn least important first (a primary wins
  its junctions). Walks: parking and pedestrian areas, then the roads'
  `sidewalk:*:surface` bands (kerb to +3 m, on the tagged side), then the
  ways.
- **G = the way direction** (1 + bearing mod 180° over 0–254, 0 unknown),
  burned per segment: the road's reach with its pavement first, walkways,
  then the carriageway, so a crossing footway does not turn the road's
  sett. Slabs and sett rows run along the street, not the map grid.
- Patterns (`SURFACE_KINDS` in `lib/city/landcover.ts` = `SURFACES` in the
  bake): asphalt (two-octave mottle, −3 %), concrete (4 × 3 m plates),
  slabs (0.5 × 0.35 m, running bond), sett (0.15 × 0.13 m, rows across the
  street, pillow-shaded stones with a normal lean), unpaved (warm, grainy),
  grass pavers (meadow in the holes). Joints fade out between 1.2 and 5
  cm/px, mottles between 5 and 35 cm/px; the material's tint stays.
- Unknown: asphalt on the road, slabs on class 4, sand on class 6.
- `bun run bake --step surface` (runs in `all`). BBBike's Dresden extract
  was used because Geofabrik resets connections from the cloud container
  (`data/provenance.json`).

## Phase 2b — Parking ✅

The paving raster's two spare bits (R = **park · 64** + walk · 8 + road):

- **Street parking** from `parking:{left,right,both}` (lane, yes,
  street_side, on_kerb, half_on_kerb, shoulder) with `:orientation`: the
  road half on that side is marked 1 (parallel) or 2 (perpendicular /
  diagonal). The shader lays the lane out from the **kerb distance** of
  phase 1: 2 m deep with bays every 5.5 m, or 5 m with bays every 2.5 m,
  along the street direction, with the lane's edge line.
- **Car parks** on the ground (`amenity=parking` except underground,
  multi-storey, rooftop, garages; `amenity=parking_space`) = 3; the
  `service=parking_aisle` driveways (3 m half-width) are cleared after, so
  bay lines — every 2.5 m across the aisle direction — stop at the aisle.
  An aisle's direction reaches 5.5 m, over its bays; a lot without one
  takes its long axis (minimum rotated rectangle). A car park without
  `surface` is asphalt.
- Coverage (Dresden, the four tiles): ~600 surface car parks, ~530 mapped
  bays, ~780 aisles, street parking on ~1 000 roads (plus ~1 400 tagged
  `parking:both=no`).
- No cars: no dataset has them.

**Format change with it:** the raster is now an 8-bit **greyscale** PNG,
twice as wide, its two bytes per texel interleaved — `main` moved the data
rasters to the viewer's own PNG decoder (`lib/city/png-raster.ts`), because
WebKit colour-manages what its image decoder returns and rewrote class ids
on iPhones. Interleaved greyscale is exactly an RG8 texture after that
decoder; an RGB PNG would have needed the browser's.

## Phase 3 — Urban green ✅

On classes 0 and 4, where the NDVI (upsampled and blurred) passes 0.3 and
OSM does not call the ground paved, `edges.py` counts the texel as meadow,
and the shader paints it **exactly as meadow**: its colour, mottle, NDVI
tint and lawn edge; no slabs there. New look row **`urbanGreen`**
(*Stadtgrün*, default 1). The first cut only blended toward the meadow
colour (0.85 × a 0.6 default) and read as barely there.

Found on the way and fixed: the contour ink divided by `fwidth`, which is
0 on a flat quad lying exactly on a contour — a diamond of NaN stripes on
flat roads. No slope, no line.

## Open phases

### 4. Tune 1–3 on a real GPU (S)

Plates at the full profile, `--headed`, oblique, from three spots: a sett
street (Neustadt, e.g. EPSG 412 991 / 5 657 977), an asphalt road with a
lawn (413 456 / 5 657 131), a green courtyard (412 777 / 5 657 187), each
at noon and at a low sun, with *Bodendetail* 0 / 0.7 / 1. Tune: kerb
width and contrast, the sett's stone size and pillow tilt (it read a
little like a quilt under SwiftShader), the urban-green thresholds.
Measure the frame time with the slider at 0 and at 1 (16 extra fetches
per near fragment); if it costs > 0.5 ms at 1080p, drop the 4×4 smoothing
to 3×3 corners (9 fetches) first.

### 5. A real kerb step ✅ (see 1b)

A 12 cm ribbon along the carriageway edge (the class-7 boundary
vectorised in the bake, or the DLM road buffers directly), baked into the
fine terrain glTF like the walls
([ADR 0029](../adr/0029-static-dressing-baked-into-the-fine-terrain.md)):
a riser plus a top, standing on the shaped ground. Built as phase 1b: a
24 cm stone, 130–200 k triangles per tile — 6–9 % of the fine terrain's,
under the 10 % the plan set. Left open: a raised pavement behind it.

### 6. Grass volume near the camera (M–L, GPU)

Shell texturing: 4–8 copies of the fine terrain grid offset 1.5 cm each,
fragment-discarded outside class 1 and outside ~30 m, alpha-tested hashed
blades, `castShadow = false`, never in the shadow pass. Judge fill-rate
first: the bottleneck is fill, not draw calls. Alternative if too
expensive: parallax-occlusion on the meadow only. STOP if the full-profile
frame time rises > 1.5 ms on the reference GPU.

### 7. DGM1 micro-relief (S–M)

The fine terrain samples the 1 m DGM on a ~2 m grid; bake the difference
(the 1 m normal minus the mesh normal) into a 2048² RG normal-delta
texture per tile in `prepare-data.ts` and add it in the terrain's normal
pass. Embankments, ramps and some kerbs are visible in DGM1.

### 8. Official sources where OSM is silent (M)

- **Parks, cemeteries, sports grounds** split out of the DLM's built-up
  layer by object type (`sie02_f`, `OBJART` / `FKT`) into their own
  classes — needs the raw DLM (its share token rotated; the ingest adapter
  got a 401 on 2026-09-25) and a palette row each.
- **Laser-scan intensity** (LSC, already listed in `data/provenance.json`)
  as a measured surface map: asphalt returns darker than slabs, grass
  differs clearly. A candidate `walk`/`road` fallback where OSM has no
  `surface`.

## STOP conditions

- A phase's plate shows the pattern aliasing (moiré) at any distance: the
  `fwidth` fades are wrong — fix those, do not raise the texture budget.
- The OSM paving coverage of a new site is below ~30 % of its carriageway
  texels: the defaults carry the look there; do not add a per-site switch.
- Anything needs Overpass: the bakes read a local extract only.
