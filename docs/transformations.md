# Transformation catalog

The ledger of every **data → look** transformation we've built, tried, or
planned — so a decision made in one chat thread is not re-litigated or
re-discovered in the next. This is the in-repo, version-controlled successor to
scattered notes; **append here when you ship, shelve, or reject a transformation.**

**Status legend:** ✅ active (shipped) · 🧪 experimental (prototype / behind a
slider, not load-bearing) · 📋 planned (designed, not built) · 🗃️ discontinued
(tried or considered and rejected — kept so we don't retry it blindly).

Each entry records **inputs**, **what it does**, **source preference / fallback**
(what it degrades to when its best input is absent — see
[portability.md](./portability.md)), and **where it lives**. The *why* behind
the load-bearing choices is in the [ADRs](./adr/README.md); the attribute →
visual-variable codebook is in
[rendering.md](./rendering.md#visual-encoding--which-data-drives-which-pixel).

---

## ✅ Active

### Geometry & ground
- **Terrain heightfield** — DGM1 → triangulated heightfield + edge skirt to hide
  inter-tile seams. The GeoTIFF is resampled **at build time**
  (`scripts/prepare-data.ts` → `<tile>.heightfield-<n>.json` + `.u16.gz`, primary
  tile 1024², neighbours 512², NoData stored as `0xFFFF` and decoded to NaN — see
  `lib/city/heightfield.ts`); the browser fetches the gzipped uint16 (cm) grid and never
  decodes a raster. `terrain-layer.ts`, `lib/city/terrain-geometry.ts`.
- **Surface splatmap** — Basis-DLM land-cover → 4096² RGBA PNG (RGB = pastel
  palette per class, A = water coverage), sampled with anisotropy 16.
  `extract-dlm.sh` → `terrain-layer.ts`.
- **Meadow NDVI tint** (*Wiesenfärbung*) — on class-1 farmland/meadow only, the
  DOP greenness (`ndvi_<tile>.png`, LINEAR-filtered to low-pass the ~2 m raster)
  shifts the pastel sage lush deep-green↔dry hay. In the terrain fragment shader
  (`uNdvi`/`uMeadowNdvi`, gated by the class raster `grMeadow`), HUD slider
  *Wiesenfärbung* (default 0.5). The higher-variance NDVI canvas the analysis
  flagged (meadow carries 1.46× the crown NDVI variance). Absent raster → no-op.
- **Water** — DLM alpha (water mask, `smoothstep`ed shoreline) + DGM1 geometry +
  animated normal wobble. `water-layer.ts`. Missing RGBA splat → coverage falls
  back to the NEAREST class raster tested against class 8 (hard-edged bank);
  the class PNG's own alpha decodes to 1 everywhere and must never be read.
- **Progressive first frame** — the primary tile's terrain + buildings render
  first; vegetation, lamps, the neighbour tiles, rails and walls stream in
  afterwards (`loadRest` in `create-app.ts`), each addition re-rendering the
  shadow map. Until the block is complete the fog far plane is clamped to
  ~1.1 km so the missing neighbours read as haze.
- **Rasters at 2048²** — `prepare-data.ts` downsamples the land-cover rasters
  (class ids NEAREST, RGB splat Lanczos; `scripts/downsample-raster.ts`) to a
  quarter of the texture memory: for the three backdrop tiles on every device,
  and for the primary tile too on phones (`MOBILE_RASTER_PX`, chosen by the
  client per device tier). The splat's colour and its alpha (= water coverage)
  are resized as two separate images: sharp premultiplies alpha across a
  resize, which turned every land texel of the first version of this bake
  black. Cost: ~1 m instead of ~0.5 m class boundaries — on desktop only on
  the neighbours (visible near a tile seam or flying low), on phones
  everywhere.
- **Buildings** — CityJSON LoD2 → **build-time** binary mesh (one merged
  mesh/tile, per-vertex `objectid`, uint16-quantised positions, gzipped) + a
  meta JSON with the per-object style table, demolish tree and footprints
  (`scripts/bake-city-mesh.ts`, `lib/city/city-mesh.ts`); demolish = filter the
  building tree out of the vertex stream + rebuild; BVH picking/collision.
  `city-layer.ts`. The DOP roof LUT is folded in at bake time.
- **Ground-clamp** — DGM1 sampled to seat buildings, trees, lamps, and the player
  on terrain. `lib/city/ground-clamp.ts`.

### Building detailing (all keyed off CityJSON attrs + the loader's `surfacetype`)
- **Per-building clay tint** (*Farbvariation*) — deterministic `hash(objectid)` +
  `function` family + `measuredHeight` nudge → muted per-building wall colour.
  **Source preference:** real per-building colour *(planned: DOP)* would replace
  the hash; the hash exists precisely so the look survives when `function` is 86 %
  "unspecified". `lib/city/building-tint.ts`, `visual-style.ts`.
- **Roof colour** (*Dachfarbe*) — real **DOP-sampled** colour per building when
  available (`roofColor()` + the per-tile LUT, ~83 % coverage), else the
  synthesized palette (`surfacetype==RoofSurface` + `roofType` / `Dachneigung` →
  terracotta pitched / slate flat). Bake: `scripts/extract-roof-colour.sh`.
- **Roof vividness** (*Dachsättigung*) — raw DOP reads drab/hazy (audited: 38 %
  near-grey, mean R−B slightly negative). `uRoofVibrance` (default **0.5**, HUD
  slider *Dachsättigung*) applies a **hue-preserving chroma
  boost**: it lifts each roof's saturation around the grey axis, weighted so
  dull/hazy roofs lift most and vivid ones barely (nothing blows out), plus a
  tiny warm nudge on the muddy greys only. **Keeps each roof's TRUE hue** —
  copper-green stays green, terracotta red, slate cool — curing drabness without
  homogenising toward terracotta. *(Rejected: blending toward a terracotta target
  — it destroyed the ~187 genuine copper-patina-green roofs the DOP captured.)*
- **Storey bands** (*Höhenlinien*) — band spacing from `storeyHeight(measuredHeight)`
  (`storeysAboveGround` is only ~4 % populated, so derived).
- **Eave line** (*Traufkante*) — cornice stroke at min RoofSurface-Z per building
  (geometry-derived; the attribute is ~4 %).
- **Dusk glow** (*Abendlicht*) — warm emissive on commerce/public/special
  (`function`), gated by the sun rig's `nightFactor`.
- **Roughness jitter** (*Materialstreuung*) — `hash(objectid)` → roughness
  clamped to [0.55, 1.0] (stays matte).

### Vegetation
- **Tree/hedge rows** — Basis-DLM hedge & tree-row lines → InstancedMesh, chunked
  into 250 m cells for frustum culling. `vegetation-layer.ts`.
- **Canopy fill** — `nDOM = DOM1 − DGM1`, one tree per ~7 m cell at the tallest
  pixel, scaled to measured height, **gated off road/bridge/water** via the DLM
  class raster. `extract-canopy.sh`.
- **NDVI crown colour** — per-tree DOP greenness (`ndvi_<tile>.png`, sampled on
  the CPU at placement) shifts the crown dry pale-sage → lush deep green.
  `extract-ndvi.sh` → `vegetation-layer.ts` `crownColor`; falls back to the
  hash-only sage when no NDVI raster (graceful — see portability). Sampled with a
  **5×5 footprint max** + a remap recentred on the low NDVI median: the raster is
  ~2 m/px and median-zero, so a single-pixel sample left ~95 % of crowns reading
  "dry" (invisible); the footprint max + recentre make lush↔dry read clearly.
  The low median has a cause: the DOP was flown on **2024-03-19**, leaf-off
  (`data/provenance.json`), so deciduous crowns are bare in the imagery and
  the index mostly separates evergreens and grass from everything else. A
  summer DOP would make the recentre less necessary and the meadow tint truer.
- **Crown shaping** — radial crown normals (free), organic trunk, base darkening;
  the cheap crown is a detail-2 icosphere (≈320 tris) with lobes;
  **multi-tuft crown LOD** (rich ~1 440-tri crown near / cheap icosphere far,
  per-chunk distance, 220 m in / 300 m out);
  **backlight shimmer** (one shadow-gated sample, far cheaper than transmission).
- **Canopy motion** — per-frame in `buildCrownMaterial`, **main pass only** (the
  shadow/depth material has none of it → no shadow-pass cost, no extra buffers):
  **wind sway** (vertex bend, stiff base → loose top, per-tree phase from the
  instance origin); **leaf flutter** (small world-space value-noise specks, ~1-2 m,
  blend the crown toward a paler silver-sage "underside" on *sunlit, sun-facing*
  leaves — shadow + NdotL gated + distance-faded, so it reads as light glinting off
  turning leaves, leaf-clump-sized, not a tree-group-wide band);
  **sway-coupled brightness** (the crown brightens leaning into the same gust,
  centred so the mean colour is unchanged). Flutter & brightness are independent
  HUD sliders (*Blattflimmern* / *Windhelligkeit*) — zero one to preview the other.
- **Street lamps** — OSM lamp points → instanced lamp posts (ODbL). `extract-lamps.sh`.
  Gated off **water (8) and railway (5)** land-cover so no poles stand in the
  Elbe or the track bed (the rail corridor is now its own layer).

### Railway & bridges
All baked by `scripts/extract-rail.sh`, built **once for the whole tile block** in
`app/_components/rail-layer.ts` (Y-up scene; on the cross-tile `heightAt` so tracks
don't truncate at seams). Replaces the old "brown smear". All geometry is
hand-wound to match its supplied normal (`pushTri`), so every material is
`FrontSide` (halves shadow/fill cost). *(Redesigned after the v1 per-line approach
z-fought into ragged edges, fragmented, and stacked into "2-story" bridges — see
🗃️ below.)*
- **Ballast yards** — Basis-DLM `ver03_f` (railway AREA, `OBJART=42010`),
  **dissolved** with spatialite `ST_Union(ST_MakeValid())` in the bake and clipped
  to the tile (~5 non-overlapping parts) → **one merged surface**, so dozens of
  yard tracks can't z-fight. Per-vertex ground-clamp + `BALLAST_RAISE`, short edge
  fascia, `polygonOffset`. The recoloured class-5 splat sits underneath so any gap
  reads as ballast, not seam.
- **Steel rails** — Basis-DLM `ver03_l`, **heavy rail only** (`SPW=1000`; trams
  `SPW=3000`/`BKT=1201` run in the street, excluded). Short ATKIS fragments are
  **snap-merged by shared endpoints** in the bake (≈91→9 continuous lines/tile); at
  runtime a polyline is **split into runs of valid ground** (never bridged across a
  NoData gap) and each track gets a thin rail pair (`±GAUGE/2`, count from `GLS`)
  with a small web. Draped on terrain; **lifted onto a rail bridge's deck** (point-
  in-deck test) so they ride the deck with no ballast stacked on top. Railway splat
  recoloured dusty-mauve → **ballast warm-grey** (`extract-dlm.sh` + terrain shader).
- **Bridge decks** — driven by the **complete `ver06_l` (`BWF=1800`) centreline
  set** (carries every road/rail/path bridge + `NAM`), each snapped to a clean
  **`ver06_f` deck AREA footprint** where one matches (≤50 m) else **buffered by
  kind-width** — so the parallel Marienbrücke rail + road decks are separate
  single-volume slabs (top face + one continuous fascia) AND road/path bridges
  without an area polygon still render. Per-ring-vertex deck Z = abutment ramp from
  **DGM1** lifted to the **DOM1** surface (+ camber) so Elbe spans float above the
  water. **Flush parapet walls** (no floating cap). **Kind** (rail/road/path) from
  rasterising the networks + sampling the *centreline*. *(Tried ver06_f-only — it
  dropped the road/path bridges, which lack area polygons; see 🗃️.)*
- **Bridge arches** — OSM `man_made=bridge` `bridge:structure` (ODbL, nearest-
  centroid match ≤60 m → deck `structure`) drives the under-deck shape: where it
  contains **`arch`** (Augustus-/Marienbrücke), `addArches` builds segmental
  spandrel walls (arched intrados, high at the crown, springing low) on both deck
  edges, carried on slim **river piers** — a masonry-viaduct read. `beam`/absent →
  flat soffit + box piers. Gated on real deck clearance (`ARCH_MIN_RISE`) so flat
  bridges don't get spurious arches. Falls back to box piers when no OSM/structure.
- **Station platforms** — OSM `railway=platform` (ODbL) → triangulated flat slabs
  (`ShapeUtils.triangulateShape`), per-vertex terrain-clamped. The OSM half of the
  blend (Basis-DLM has no platform geometry); absent/empty when Overpass is down.

### Retaining / city walls
- **Walls** (*Brühlsche Terrasse &c.*) — OSM `barrier=retaining_wall|city_wall|
  wall` + `man_made=embankment` (ODbL), with the tagged `height` (e.g. the
  8.5–9 m city walls). `extract-walls.sh` → `wall-layer.ts`: vertical sandstone
  ribbons, base draped on the DGM via the cross-tile `heightAt`, top = base +
  height, nudged slightly onto the low side so the face skins the (now stepped)
  terrain. **Why OSM:** the monumental wall is NOT in the elevation data —
  DGM1/DOM1/**LiDAR-ground all smooth it into a gentle bank** (verified by
  sampling: ground ≈ DGM across the wall), and it's not a CityJSON building, so it
  "went missing". OSM has it as explicit vector lines with heights.
  **Source:** a LOCAL Geofabrik `.osm.pbf` read via GDAL's OSM driver (both the
  `lines` and `multipolygons` layers — GDAL files closed barrier ways as
  polygons), so the whole block bakes in one pass with **no Overpass rate limits**
  and reproducibly (verified feature-for-feature identical to the old Overpass
  bake: 436 walls, same kinds/lengths/heights).

### Wall → terrain conflation (heightfield breakline burn)
- **Stepped ground at walls** — `lib/city/terrain-conflate.ts`, applied inside
  `loadTerrain` before the mesh is built. The DGM blurs a vertical wall into a
  ramp, so the OSM ribbon used to float over it / get swallowed and the ground
  never "stepped". The conflation reads the terrain's natural shelf level a short
  way out on each side of each wall line, then snaps nearby cells toward the
  **high-side** level on one side and the **low-side** level on the other — a
  sharp step concentrated AT the line, feathering back to the untouched DGM within
  a ~11 m band (nearest-wall-wins). The wall ribbon then skins a real step.
  **Deterministic + source-portable** (any DEM + any OSM wall lines). **Gated** to
  earth-retaining kinds (`retaining_wall`/`city_wall`/`embankment`) and only where
  the two sides actually differ by ≥1.5 m, so freestanding garden walls and flat
  fountain rims leave the ground alone; a ≤18 m clamp stops a bad height tag
  gouging a canyon. Pure + unit-tested (`terrain-conflate.test.ts`).

### Lighting
- **Soft shadows** — `PCFShadowMap` + raised `shadow.radius`; terrain
  `castShadow=false`; `normalBias=0`; tight camera-following frustum. Full recipe
  and dead-ends in the [city-walker skill](../.claude/skills/city-walker/SKILL.md).

### Atmosphere & time of day
- **Height-term fog** — DGM elevation (per-fragment world height) → extra haze
  pooling in low ground, folded into every fog-receiving material via
  `onBeforeCompile`; HUD *Talnebel*. `height-fog.ts`.
- **River mist** — DLM water mask (the water surface) → a drifting, sun-lit
  mist sheet over the Elbe; HUD *Flussnebel*. `water-layer.ts` `createWaterMist`.
- **Drifting clouds** — sun instant → the sky dome's `time`/`cloudSpeed` so the
  cloud cover moves with the frame. `sun-rig.ts`.
- **Golden/blue-hour palette stops** — sun altitude → sky/fog/hemisphere colours
  from a palette with stops at −2° (blue hour) and +6° (golden hour).
  `lib/city/atmosphere.ts` `STOPS`.
- **Meadow mottle** — DLM class 1 (farmland/meadow) → a low-frequency
  colour + normal mottle so grass reads as ground, not paint. `terrain-layer.ts`
  `GRASS_MOTTLE`/`GRASS_NORMAL`.

---

## 🧪 Experimental

- **DOP-lean caveat (recorded):** standard DOP has building lean (tall roofs
  displaced over facades). Mitigated in the bake by eroding the roof footprint
  inward + a robust median; revisit with true-orthophotos if available.
- **Low vegetation — hedges & shrubs 0.5–3 m** (`?veg=low`) and **trees
  outside the canopy mask** (`?veg=trees`; `?veg=low,trees` for both). Off by
  default; nothing is fetched without the flag. Primary tile only (the one LSC
  tile on disk); the neighbours get the OSM-only fallback.
  - *Why:* `extract-canopy.sh` keeps nothing under `MINH = 3 m` and only
    forest/copse/sport-and-leisure areas, so courtyard and garden trees are
    dropped at any height; the Basis-DLM carries a hedge only when it is
    landscape-shaping (≥ 200 m) — `vegrows` on 33412_5656 has **0 hedges**.
  - *Inputs:* GeoSN laser scan (LAZ, 2024-11-30, leaf-off) → PDAL 0.5 m
    rasters: ground (classes 2/8/30), surface max (2/20), non-ground count, its
    multi-echo share, and the mean **intensity of the low returns** (0.25–4 m
    above ground). DOP NDVI (2024-03-19). OSM `barrier=hedge`,
    `natural=scrub|shrubbery|shrub`. Exclusions: LoD2 surfaces (+1 m), OSM
    walls (+0.75 m), bridges, water/rail classes, the rim (1 m) of any > 3 m
    crown.
  - *Cue — measured, and not the one expected:* per-pixel AUC of OSM-hedge
    pixels against cars (road class) / OSM fences / building rims: **NDVI
    0.94 / 0.71 / 0.89**, low-return intensity 0.70 / 0.83 / 0.80,
    multi-echo ratio 0.76 / **0.28** / 0.42. The echo ratio separates tall
    trees from roofs perfectly (≥ 0.5 on 100 % of > 5 m forest pixels, 3 % of
    roofs) but not low vegetation: only 26 % of hedge pixels reach it, against
    56 % of fence pixels — a clipped hedge rarely splits a pulse, and 1–2 m
    above ground the two echoes are too close to separate. The leaf-off NDVI
    works *because* the city's hedges are largely evergreen. Rule: `NDVI ≥
    0.12 ∨ (intensity ≥ 1250 ∧ echo ≥ 0.3)`; inside OSM scrub `NDVI ≥ 0.06 ∨
    echo ≥ 0.3`. Then close 3×3, open 2×2, blobs ≥ 2 m².
  - *Shape:* elongated components (skeleton ≥ 4 m, length/width ≥ 3, width ≤
    3 m from the distance transform on the skeleton, few spurs) → skeleton →
    polyline → Douglas-Peucker 0.4 m, `h` = median ridge nDOM, `w` = 2 × median
    inscribed radius; compact ones → one shrub (centroid, equivalent radius,
    p90 height), beds > 12 m² → shrubs at height peaks ≥ 1.5 m apart.
    **OSM geometry wins**: a mapped hedge keeps its line and takes the LSC
    height where ≥ 30 % of it is supported (`src: "osm+lsc"`), else its
    `height` tag or 1.5 m (`"osm"`); LSC hedges within 2 m of it are dropped,
    the rest fill the unmapped ones (`"lsc"`).
  - *Evaluation (33412_5656):* only **47 %** of the 4.3 km of OSM hedges is
    observable at all — 53 % runs under a > 3 m crown, invisible to a first-
    surface model. Of the observable length, the mask comes within 1.5 m of
    **58 %** (echo ≥ 0.5 alone: 25 %, NDVI alone: 48 %, no cue at all: 76 %
    but 9.7 ha of mask instead of 2.6 ha). Fences: 3 % of 17.9 km of OSM fence
    (> 3 m from a hedge) is hit — the 2×2 opening removes them. Mask
    breakdown: 30 % lies 1–2 m from a > 3 m crown (understory *or* crown-edge
    false positives — the main remaining risk), 1.9 % on the road class
    (cars), 1.8 % 1–2 m from a building, 2 % beside a fence. Checked by eye on
    DSM-hillshade overlays: a clipped evergreen hedge beside a row of parked
    cars is taken and the cars are not; grave shrubs on the Trinitatisfriedhof
    come out as shrubs; a branchy scrub mass was first mis-skeletonised into a
    "hedge network" (fixed by the inscribed-width + spur test).
    Output: 594 hedges (65 OSM, 51 OSM+LSC, 478 LSC-only; 7.3 km) and
    3 226 shrubs; 574 KB raw / 43 KB gzipped.
  - *Trees outside the mask* (`canopyx`): crown peaks of the multi-echo (≥ 0.5)
    > 3 m canopy, ≥ 3 m apart, more than 5 m from any current canopy point —
    **8 006 trees** on top of today's 5 118 (96 % built-up class; 57 % more
    than 15 m from the DLM road area, 1 969 of them enclosed by buildings on
    ≥ 6 of 8 rays = courtyards; 16 % street-side). Rendered as ordinary canopy
    trees. 910 KB raw / 70 KB gzipped.
  - *Rendering* (`low-vegetation-layer.ts`, separate from the tree layer):
    hedges are chains of superellipsoid "clay" blocks (288 tris, ≤ 2.5 m
    pieces, 0.6 m overlap), shrubs a lobed dome (144 tris); rooted-base
    darkening + a static world-space foliage mottle; 250 m chunks; cast and
    receive shadows, no animation (ADR 0020).
  - *Cost* (real GPU, 3200×2000, full block): `?veg=low` +9 364 instances
    (5 882 hedge pieces + 3 482 shrubs; ≈ 2.2 M triangles built), +11–13 draw
    calls/frame, +0.9–1.4 % triangles drawn, frame time 19.8 → 20.2 ms on the
    fly-over (measured with a 216-triangle hedge block; the final one has 288). `?veg=trees` +8 006 trees
    (+24 k instances incl. both crown LODs), +4.9–7 % triangles drawn, fly-over
    19.8 → 23.0 ms.
  - *Verdict so far:* the trees are the big visual win (the estates and
    courtyards stop being bare); hedges read well along streets and parks;
    shrubs add detail but facet at arm's length. Dedup with the municipal tree
    cadastre: cadastre wins position/species; drop an LSC crown peak within
    max(4 m, cadastre crown radius) of a cadastre tree; keep the LSC `h`
    where the cadastre has none.
  - Bake: `scripts/extract-lowveg.sh` (+ `extract-lowveg.py`, run under `uv`).

---

## 📋 Planned (designed, not built)

Ranked roughly by impact-vs-effort (full rationale lives in chat history / the
research that produced them):

1. **DOP NDVI tree-placement density** — *(crown colour + meadow tint now ✅
   active)* — the remaining NDVI use: thin/thicken canopy placement by local NDVI
   so sparse/stressed areas get fewer trees. Lower priority than the two shipped.
2. **Stylized DOP ground-drape** — posterized, desaturated DOP blended over
   terrain past ~150 m for far-distance texture. *Aesthetic risk* — prototype
   behind a slider, judge on GPU before committing.
3. **ALKIS parcels** — plot boundaries → per-parcel ground tint, garden/courtyard
   vs street, fences along lot lines; richer `Gebäudefunktion` than CityGML.
4. **Cartographic minimap** — DTK / basemap.de P10 raster tile + Ortsteile labels
   replacing the math-drawn minimap.
5. **Dappled canopy shadow** — alpha-tested colour-less proxy caster per chunk
   (mind the `WebGLShadowMap` alphaMap-override gotcha; see skill).
6. **Real trees from the laser-scan point cloud** — segment high-veg returns →
   per-tree position/height/crown; bake to per-tile GeoJSON. *(First step 🧪
   above: `canopyx` crown peaks with `h` + `r`, outside the canopy mask only;
   the renderer still sizes a crown from `h` alone.)*
7. **Cascaded Shadow Maps** — the one shadow limit the skill calls unsolved (long
   low-sun shadows clip the 110 m frustum). Sizeable integration.
8. **Adaptive resolution while moving** — *partly shipped*: DoF is skipped
   while the camera moves (`lib/city/regression.ts`, plan 007). AO is **not**
   — gating it made the contact shadows blink on every step, so N8AO runs
   permanently at half resolution instead
   ([ADR 0011](./adr/0011-motion-keyed-quality-regression.md)). A pixel-ratio
   drop under motion is the open half (needs a ~1 s hold and a real-GPU look).
9. **Cable-stayed / truss bridge structures** — arch + beam now ship (✅ above);
   `bridge:structure=cable-stayed` (Pieschener Molenbrücke) / `truss` still fall
   back to a flat soffit. Pylons + stay cables / truss webs would finish the set.
10. **Atmospheric motes** — the one unbuilt item of the aesthetic roadmap:
    camera-local `Points` (2–4 k) drifting in a toroidal volume (R ≈ 30 m),
    additive, `depthWrite: false`, `fog: false` (fog would brighten distant
    motes), hash-seeded so snapshots reproduce, opacity + `setDrawRange` on
    one slider. +1 draw call. Design notes in [plans/README.md](./plans/README.md#open-work).
11. **Far crown LOD tier** — a third InstancedMesh per 250 m cell (detail 1 or 0,
    trunk hidden) beyond ~500 m; today a tree 2 km away still draws ~400
    triangles in the main and every shadow pass. The swap mechanism exists
    (`updateLod`); the look needs the `--headed` harness.

---

## 🗃️ Discontinued / rejected (do not retry blindly)

| Idea | Why rejected | Caveat |
|---|---|---|
| **Procedural window grid** on facades | Reads as a modern office block, fights the historic LoD2 silhouette (user veto). | Faint storey banding is the only kept remnant. |
| **Orthophoto for facade colour** | Nadir DOP only sees roofs — no facade data. | DOP for **roofs** is fine and is now the 🧪 entry above. |
| **Plain foliage translucency** | Reads as "noise" at instance distance. | Only OK if **shadow-gated** (kept as the shimmer transform). |
| **VSM shadows** | "Corduroy"/grid rings on large ground at grazing sun. | Use `PCFShadowMap` + radius instead. |
| **Large `normalBias`** | Bright peter-panning contact strip. | Keep `normalBias=0`, small negative `bias`. |
| **Bigger shadow frustum / 4096 map** | Coarser texels → fraying / cost without gain once radius softens. | Tight ~110 m frustum at 3072 + radius. |
| **Sobel / deferred outlines** | Hard edges clash with the watercolor look. | — |
| **Selective bloom, quad leaf billboards** | No payoff yet for the cost. | Revisit only with a concrete need. |
| **`BatchedMesh` for buildings** | Already merged per tile; would break `objectid` picking/demolish and not cut draw calls. | Bottleneck is fill-rate, not draw calls. |
| **Blender texture baking** | No UVs on the source geometry. | — |
| **Orthophoto as the *only* tint source** | Leaves everything identical where imagery is flat; no facade info. | Hash carries variation; DOP augments roofs. |
| **Per-line ballast ribbons** (rail v1: one ~9.6 m ribbon per `ver03_l` line) | 42+ overlapping coplanar ribbons in the yard z-fought into ragged/torn edges. | Replaced by the **dissolved `ver03_f` area** as one merged surface. |
| **`ver06_l` centreline-buffered decks** (rail v1) | Buffered planks stacked deck-top + ballast + parapet-cap → "2-story" bridges, and one plank merged the parallel Marienbrücke spans. | Replaced by **`ver06_f` deck polygons** (one slab per real footprint); kept as the no-`ver06_f` portability fallback. |
| **Per-tile rail layer** (rail v1) | Each tile's own `heightAt` returned null off-tile → tracks truncated at every seam. | Build **once for the block** on the cross-tile `heightAt`. |
| **`ver06_f`-only bridge decks** (rail v2 first cut) | `ver06_f` has area polygons only for (mostly rail) major spans → road/path bridges (Augustusbrücke etc.) vanished + everything mis-classified rail. | Drive from the **complete `ver06_l`** set, footprint from `ver06_f` where matched. |
| **Motion-gated SSAO** (plan 007 as first shipped) | The contact shadows blinked on every footstep — reads as a bug, not a saving. | N8AO runs permanently at `halfRes`; only DoF is dropped while moving ([ADR 0011](./adr/0011-motion-keyed-quality-regression.md)). |
| **Cloud shadows / per-frame shadow updates for wind sway** | Would force the 3072² depth pass every frame over tens of thousands of trees, undoing the on-demand shadow map. | Sway, flutter and cloud drift run in the main pass only; the cast shadow stays static ([ADR 0020](./adr/0020-fixed-light-pool-and-static-shadow-casters.md)). |
| **Multi-echo ratio as the low-vegetation cue** (LSC, 🧪 low vegetation) | Measured: only 26 % of OSM-hedge pixels reach echo ≥ 0.5, fences 56 % (AUC hedge-vs-fence 0.28); recall 25 % of observable hedge length vs 58 % for the NDVI + intensity rule. | Keep it as the *tall*-vegetation cue (100 % of > 5 m forest vs 3 % of roofs) and as a qualifier of intensity. |
| **OSM scrub polygons filled with shrubs** (OSM-only tiles) | A jittered 3–4 m grid gave 4–9 k shrubs per neighbour tile — more than the laser scan finds on the primary — mostly under existing crowns. | OSM-only tiles get hedges + `natural=shrub` nodes only. |
| **Camera-follow grass tuft ring** | Shadow-casting instances rewritten every frame; reads as confetti. | Meadow mottle + normal perturbation in the terrain shader (✅ above). |
| **Per-lamp real point lights** | three bakes the light count into every program → a recompile storm on every add/remove, plus per-light cost. | A fixed pool of 3 real lights retargeted to the nearest heads; every other lamp is emissive + sprite ([ADR 0020](./adr/0020-fixed-light-pool-and-static-shadow-casters.md)). |
| **Plain (non-shadow-gated) foliage translucency, quad leaf billboards, selective bloom** | Noise at instance distance / no payoff for the cost. | Shadow-gated shimmer + translucency only (✅ above). |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
