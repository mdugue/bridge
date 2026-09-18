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
[portability.md](./portability.md)), and **where it lives**.

---

## ✅ Active

### Geometry & ground
- **Terrain heightfield** — DGM1 → triangulated heightfield + edge skirt to hide
  inter-tile seams. `terrain-layer.ts`, `lib/city/terrain-geometry.ts`.
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
  animated normal wobble. `water-layer.ts`.
- **Buildings** — CityJSON LoD2 → one merged mesh/tile, per-vertex `objectid`;
  demolish = drop from CityJSON + re-parse; BVH picking/collision. `city-layer.ts`.
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
- **Crown shaping** — radial crown normals (free), organic trunk, base darkening;
  **multi-tuft crown LOD** (rich near / cheap icosphere far, per-chunk distance);
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

---

## 🧪 Experimental

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
8. **Adaptive / half-res post** — fill-rate is the bottleneck; a resolution scale
   under load buys headroom before the larger WebGPU move. See *App shell & frame
   budget* below for the two cheap levers that pair with it (movement regression,
   idle frameloop).
9. **Cable-stayed / truss bridge structures** — arch + beam now ship (✅ above);
   `bridge:structure=cable-stayed` (Pieschener Molenbrücke) / `truss` still fall
   back to a flat soffit. Pylons + stay cables / truss webs would finish the set.

### App shell & frame budget (not data→look)

Runtime/architecture items rather than source→feature transformations. Recorded
here so they survive threads alongside everything else. All four came out of the
react-three-fiber feasibility check (see 🗃️ below) — they are the parts of the
r3f playbook that are worth having **without** adopting the reconciler.

- **Movement regression** — r3f's `regress()` pattern, hand-rolled: while the
  camera is moving or turning, drop `setPixelRatio` and/or skip the DoF + N8AO
  passes, then restore after a short debounce once it settles. Aims straight at
  the stated fill-rate bottleneck, and motion blur/DoF is exactly what the eye
  misses least mid-movement. Pairs with 📋 8 above (same lever, different
  trigger). `create-app.ts` render loop + `post-stack.ts`.
- **On-demand rendering (idle frameloop)** — r3f's `frameloop="demand"`: skip
  `postStack.render()` entirely when nothing changed. **Caveat that limits this
  here:** water ripple, wind sway and cloud drift all advance every frame, so a
  general dirty-flag buys nothing. Only worth scoping to a *real* idle state
  (pointer-lock released, no input for N seconds, sliders untouched) — a
  battery/fan win on a parked camera, not a framerate win. `create-app.ts:1028`.
- **Sliced layer build (load jank)** — the vegetation chunk loop
  (`vegetation-layer.ts`, `bucketByCell`) is the one naturally sliceable part of
  the load: `await scheduler.yield()` between 250 m cells lets the `onProgress`
  loading message actually paint instead of the main thread freezing through it.
  The monolithic phases (merged CityJSON parse, raster→heightfield, rail
  extrusion) are **not** sliceable without restructuring — a worker is the real
  answer there, and neither needs React.
- **HUD state split** — `CityWalk` (`city-walk.tsx`) is one ~600-line JSX
  component holding ~30 `useState`, so every slider drag *and* the 2 Hz `onFps`
  tick re-render the whole HUD root. React Compiler blunts it (children memoize)
  but the root still re-renders each time. Move the look sliders into a store or
  per-group state so a drag re-renders only its own `ControlGroup`. The 60 Hz
  pose path (`subscribePose`, deliberately never through React state) is already
  the right pattern — leave it alone.

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
| **react-three-fiber migration** | The scheduler win people cite is time-slicing *component mounts* (pmndrs' 510-`TextGeometry` benchmark). r3f's own frameloop is a bare `requestAnimationFrame` with React out of the per-frame path — identical to our `setAnimationLoop`, so **zero** frame-time delta. And React only yields *between* component renders: our load is monolithic imperative work (merged CityJSON parse, raster→heightfield, rail extrusion) it cannot preempt inside a call. Cost side: 13 `onBeforeCompile` sites across 7 layers become `<primitive>` escape hatches; the hand-ordered `post-stack.ts` (2 custom `Effect`s + crosshair autofocus) goes under `@react-three/postprocessing` (which also pins `n8ao ^2`, we run `^1.10`); and the ~60-method `CityWalkHandle` that `window.__poc` and the snapshot e2e harness drive would have to be rebuilt on a store. | Our scene graph is static-after-load (only demolish/insert add or remove) — r3f's weakest case. The genuinely useful parts of the r3f playbook need no reconciler and are filed under 📋 *App shell & frame budget*. Revisit only if the scene becomes dynamically composed. |
| **`ver06_f`-only bridge decks** (rail v2 first cut) | `ver06_f` has area polygons only for (mostly rail) major spans → road/path bridges (Augustusbrücke etc.) vanished + everything mis-classified rail. | Drive from the **complete `ver06_l`** set, footprint from `ver06_f` where matched. |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
