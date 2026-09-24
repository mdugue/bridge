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
  terrain. **Why OSM:** no elevation product has the wall as a *vertical face*
  (a 2.5D surface cannot), and it's not a CityJSON building, so it "went
  missing". OSM has it as explicit vector lines with heights. *(Corrected by
  the terrain study, 🧪 "Terrain TIN" below: the source data does NOT smooth
  the wall into a gentle bank. The laser ground returns step within ~0.75 m
  (median, 7 tall walls) and the native 1 m DGM1 within ~1.7 m at 77° —
  Jungfernbastei: 108.6 → 117.3 m over 2 m, then two more terrace levels at
  119.7 and 121.1 m. It is our 1024² resample that widens the step to ~2.9 m
  at 69°, the "bank" the viewer showed. The earlier claim "LiDAR-ground ≈
  DGM" was right about the level — the two agree to 0.00 ± 0.05 m tile-wide
  — but not about the edge.)*
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
  **Measured cost (terrain study, 🧪 "Terrain TIN"):** against held-out laser
  ground it raises the RMSE in the 20 m band around walls from 0.43 to 0.76 m
  (p95 0.80 → 1.62 m) — the 11 m probe reads the *top* of a terraced wall, and
  the step lands on the OSM line, not the measured edge. The `?terrain=tin`
  experiment skips it and snaps the ribbons to the measured step instead.

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

- **Terrain TIN** (`?terrain=tin`, primary tile only; default unchanged) —
  DGM1 at its **native 1 m (2000²)** → Delatin error-bounded TIN at **±0.15 m**
  (every source grid point within 15 cm of the mesh), baked by
  `scripts/bake-terrain-tin.ts` inside `prepare-data.ts` from the committed
  GeoTIFF (no new committed input). Format + mesh + `heightAt` bucket index in
  `lib/city/terrain-tin.ts`; loader `terrain-layer.ts` (`loadTinSurface`, the
  water sheet gets an up-facing normal twin). **No wall conflation** on the TIN:
  the earth-retaining ribbons instead snap to the step the ground measures
  (`lib/city/wall-snap.ts`: steepest metre within 6 m of the OSM line, running
  medians along the wall, face just in front of the ramp foot + a coping cap to
  the crest). Neighbours keep their conflated 512² grids.
  **Study** (`scripts/terrain-study/`, reproducible from the committed DGM + the
  gitignored LSC LAZ; held-out = a seeded 10 % of the 34 M class-2 ground
  returns, 3.4 M points; 35 profiles across the 7 tallest OSM retaining/city
  walls; DGM1 was made from all returns, so its numbers are slightly
  optimistic):

  | variant | main-step width (m, median) | profile RMSE vs laser (m) | RMSE / p95 tile (m) | RMSE / p95 20 m wall band (m) | triangles | gz |
  |---|---|---|---|---|---|---|
  | laser ground (0.25 m bins) | 0.75 | — | — | — | — | — |
  | V0 shipped 1024² grid | 2.85 | 0.79 | 0.095 / 0.114 | 0.43 / 0.80 | 2.09 M | 1.08 MB |
  | V0 + client conflation (what the viewer shows) | 1.75 | **1.47** | 0.140 / 0.122 | **0.76 / 1.62** | 2.09 M | 1.08 MB |
  | V1 DGM1 2000² grid | 1.70 | 0.29 | 0.048 / 0.053 | 0.23 / 0.18 | 8.0 M | 3.7 MB |
  | V2 laser ground 0.5 m grid | 1.20 | 0.16 | 0.046 / 0.046 | 0.22 / 0.10 | 32 M | 12.8 MB |
  | **TIN of V1 ±0.15 m (the prototype)** | **1.30** | **0.23** | **0.066 / 0.108** | **0.22 / 0.15** | **0.30 M** | **1.04 MB** |
  | TIN of V1 ±0.10 / ±0.25 m | 1.30 / 1.40 | 0.23 / 0.22 | 0.056 / 0.091 | 0.22 / 0.22 | 0.55 / 0.14 M | 1.79 / 0.49 MB |
  | TIN of V2 ±0.25 / ±0.10 m | 1.00 / 1.10 | 0.17 / 0.16 | 0.089 / 0.054 | 0.23 / 0.22 | 0.23 / 1.03 M | 0.85 / 3.72 MB |
  | TIN of V1 + conflation burned in ±0.10 m | 0.60 | 1.40 | 0.135 / 0.084 | 0.78 / 1.52 | 0.55 M | 1.78 MB |

  Client cost (Bun, decode → mesh → normals, then the idle-time BVH): grid
  ~300 ms + 470 ms BVH → TIN ±0.15 m ~115 ms + 90 ms BVH; GPU geometry ~50 → ~9 MB,
  and the terrain, water and mist sheets each draw a seventh of the triangles.
  Findings: (1) most of the "wall smear" is our resample, not the data;
  (2) the laser-scan DTM beats DGM1 only at the sharpest quay walls
  (0.6–0.75 m vs 0.9–1.05 m) for 2–4× the triangles and a committed LSC-derived
  artifact — not worth it; (3) the breakline burn *sharpens* steps but
  *triples* the wall-band error: it flattens terraced walls (the Jungfernbastei
  climbs 108.6 → 117.4 → 119.7 → 121.1 m within 8 m and gets one cliff to
  121.1 m) and puts the step on the OSM line, which misses the measured step by
  −0.5…+1.0 m (4 m at the bastion's south face). Pitfalls checked: LSC class 30
  (under buildings) and class 8 (water) are the DGM1 values to the mm (synthetic
  fill, not measurements); LSC vs DGM1 datum bias 0.000 m; the TIN's seam step
  against the 512² neighbours is unchanged on average (0.14 m, max 3.1 vs
  2.5 m where a wall crosses the edge; the skirt hides it).
  **Visual (real GPU, `shots/tin-*.png` vs `*.tin.png`):** terraced
  Jungfernbastei reads correctly (terrace levels kept, trees on the first
  level visible), quay walls straight and clean from the air; residue: a few
  sub-metre ground spikes at wall feet and faint shading bands on snapped wall
  faces, faint facet streaks on the water next to bridge piers.
  **What a TIN rollout still needs:** constrained breaklines (a vertical wall is
  two vertices at one xy — Delatin cannot, a constrained Delaunay with the
  snapped wall line could, and would remove the spikes and the cap), NoData
  support (the bake refuses holes), crease-angle normals, and a TIN per
  neighbour (±0.25–0.5 m would undercut their 512² grids in bytes and
  triangles, from the committed DGMs alone).

- **DOP-lean caveat (recorded):** standard DOP has building lean (tall roofs
  displaced over facades). Mitigated in the bake by eroding the roof footprint
  inward + a robust median; revisit with true-orthophotos if available.

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
   per-tree position/height/crown; bake to per-tile GeoJSON.
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
| **Camera-follow grass tuft ring** | Shadow-casting instances rewritten every frame; reads as confetti. | Meadow mottle + normal perturbation in the terrain shader (✅ above). |
| **Per-lamp real point lights** | three bakes the light count into every program → a recompile storm on every add/remove, plus per-light cost. | A fixed pool of 3 real lights retargeted to the nearest heads; every other lamp is emissive + sprite ([ADR 0020](./adr/0020-fixed-light-pool-and-static-shadow-casters.md)). |
| **Plain (non-shadow-gated) foliage translucency, quad leaf billboards, selective bloom** | Noise at instance distance / no payoff for the cost. | Shadow-gated shimmer + translucency only (✅ above). |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
