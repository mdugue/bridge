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
- **Terrain TIN (glTF, two levels)** — DGM1 at its **native 1 m (2000²)** →
  Delatin error-bounded TIN (every source grid point within the tolerance of
  the mesh) + a 30 m edge skirt, at two levels per tile: **L1 ±0.5 m**
  (coarse, geometric error 40 m) replaced by **L0 ±0.15 m** near the camera
  (`TERRAIN_LEVELS`, `lib/city/tileset.ts`;
  [ADR 0028](./adr/0028-terrain-tin-per-tile-and-wall-snap.md)). Baked **at
  build time** from the committed GeoTIFF (`scripts/bake-tiles.ts`
  `tinTerrainMesh`, mesh + skirt in `lib/city/terrain-tin.ts`), normals
  computed, written as glTF (`EXT_meshopt_compression` +
  `KHR_mesh_quantization`, welded and reordered, pre-gzipped
  `terrain_<tile>_l0|l1.glb.gz`) — no TIN codec of its own. The browser
  reads ground height from the very triangles it draws: `terrain-layer.ts`
  builds a bucket index over the streamed mesh (`TriangleIndex`), and the
  water sheet gets an up-facing normal twin of the geometry. **No wall
  conflation** on a TIN: the earth-retaining ribbons instead snap to the
  step the ground measures (`lib/city/wall-snap.ts`: steepest metre within
  6 m of the OSM line, running medians along the wall, face just in front of
  the ramp foot + a coping cap to the crest). Dresden, per tile: L0 290–480 k
  triangles in 0.89–1.47 MB, L1 47–86 k in 0.17–0.31 MB — against the
  first tileset's 1024² / 512² grids (2.1 M / 0.53 M triangles, 1.5–2.0 /
  0.4–0.55 MB); ≈2 s of Delatin per tile at ±0.15 m (cached). No NoData on
  any of the four tiles. **History:** prototyped as `?terrain=tin` on the
  primary tile with its own codec (`dgm1_<t>.tin-<cm>cm.json` + `.bin.gz`),
  then rolled out to the three neighbours at ±0.25 m (147 k / 168 k / 236 k
  triangles, 0.50 / 0.60 / 0.84 MB) before the 3D Tiles port folded it into
  the tileset; with distance deciding which tile is detailed, the fine level
  is ±0.15 m everywhere and the coarse level ±0.5 m (a tenth of the 512²
  grid's triangles in half its bytes, still sharper at walls than 4 m
  cells).
  **Study** (`scripts/terrain-study/`, reproducible from the committed DGM + the
  gitignored LSC LAZ; held-out = a seeded 10 % of the 34 M class-2 ground
  returns, 3.4 M points; 35 profiles across the 7 tallest OSM retaining/city
  walls; DGM1 was made from all returns, so its numbers are slightly
  optimistic):

  | variant | main-step width (m, median) | profile RMSE vs laser (m) | RMSE / p95 tile (m) | RMSE / p95 20 m wall band (m) | triangles | gz |
  |---|---|---|---|---|---|---|
  | laser ground (0.25 m bins) | 0.75 | — | — | — | — | — |
  | V0 1024² grid (shipped then) | 2.85 | 0.79 | 0.095 / 0.114 | 0.43 / 0.80 | 2.09 M | 1.08 MB |
  | V0 + client conflation (what the viewer shows) | 1.75 | **1.47** | 0.140 / 0.122 | **0.76 / 1.62** | 2.09 M | 1.08 MB |
  | V1 DGM1 2000² grid | 1.70 | 0.29 | 0.048 / 0.053 | 0.23 / 0.18 | 8.0 M | 3.7 MB |
  | V2 laser ground 0.5 m grid | 1.20 | 0.16 | 0.046 / 0.046 | 0.22 / 0.10 | 32 M | 12.8 MB |
  | **TIN of V1 ±0.15 m (the prototype)** | **1.30** | **0.23** | **0.066 / 0.108** | **0.22 / 0.15** | **0.30 M** | **1.04 MB** |
  | TIN of V1 ±0.10 / ±0.25 m | 1.30 / 1.40 | 0.23 / 0.22 | 0.056 / 0.091 | 0.22 / 0.22 | 0.55 / 0.14 M | 1.79 / 0.49 MB |
  | TIN of V2 ±0.25 / ±0.10 m | 1.00 / 1.10 | 0.17 / 0.16 | 0.089 / 0.054 | 0.23 / 0.22 | 0.23 / 1.03 M | 0.85 / 3.72 MB |
  | TIN of V1 + conflation burned in ±0.10 m | 0.60 | 1.40 | 0.135 / 0.084 | 0.78 / 1.52 | 0.55 M | 1.78 MB |

  Client cost at the time (Bun, decode → mesh → normals, then the idle-time
  BVH): grid ~300 ms + 470 ms BVH → TIN ±0.15 m ~115 ms + 90 ms BVH; GPU
  geometry ~50 → ~9 MB, and the terrain, water and mist sheets each draw a
  seventh of the triangles. (The 3D Tiles terrain has no BVH at all; the
  triangle index costs what the TIN's did.)
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
  **Visual (real GPU, the primary-only prototype):** terraced
  Jungfernbastei reads correctly (terrace levels kept, trees on the first
  level visible), quay walls straight and clean from the air; residue: a few
  sub-metre ground spikes at wall feet and faint shading bands on snapped wall
  faces, faint facet streaks on the water next to bridge piers.
  **Still open:** constrained breaklines (a vertical wall is two vertices at
  one xy — Delatin cannot, a constrained Delaunay with the snapped wall line
  could, and would remove the spikes and the cap), NoData support (a DGM with
  holes falls back to the grid below), crease-angle normals. Two independent TINs meet at a seam
  with different border vertices (T-junctions, each tile's own edge
  heights); the skirt hides the crack. **Neighbour check (real GPU, full
  block):** the Brühlsche Terrasse west of the seam (33410_5656), the
  Terrassenufer across the 33410/33412 seam, the Altstadt around the
  Frauenkirche from the air and the northern seam (33412_5658) show no
  ground step, crack or wall break at the tile edges; the terrace wall reads
  as one continuous face across the seam. The one seam artifact left is on
  the Elbe: a faint light line / band where two tiles' water sheets meet — it
  was there with the grid too (grid-grid, grid-TIN), so it is not the TIN's.
  *Not yet re-checked on a GPU since the 3D Tiles port* (quantised positions,
  the ±0.5 m coarse level, L0/L1 seams — plan 019).
- **Terrain grid** (fallback for a DGM with NoData) — DGM1 → a triangulated
  grid + the 30 m skirt at **1024²** (L0) / **512²** (L1), resampled at build
  time (`scripts/bake-tiles.ts` `readDgm`, bilinear, NoData → NaN → the quads
  touching it are left out), the wall breaklines burned in (below), written
  as glTF in grid order: the browser reads ground height back from the grid
  vertices. Meshed for no tile of the Dresden site.
  `scripts/bake-tiles.ts` `terrainMesh`, `lib/city/terrain-geometry.ts`.
- **Surface colours** — Basis-DLM land-cover → a 4096² **class-id raster**
  (8-bit, ids 0–8, burned lowest priority first so water wins;
  `pipeline/bake/landcover.py` → `landcover_<tile>.png` + legend). The colours
  are **not** baked: `lib/city/landcover.ts` holds the one pastel palette, and
  `landcover-splat.ts` paints it on the GPU once per tile at load (RGB =
  palette, A = water coverage from a 3×3 tent over class 8) into an sRGB,
  mipmapped, anisotropy-16 target — what the baked PNG used to be sampled
  with. The minimap and the `/wissen` picture use the same table; a colour
  change is a look change, not a re-bake
  ([ADR 0023](./adr/0023-land-cover-colours-painted-at-runtime.md)).
  `terrain-layer.ts`.
- **Meadow NDVI tint** (*Wiesenfärbung*) — on class-1 farmland/meadow only, the
  DOP greenness (`ndvi_<tile>.png`, LINEAR-filtered to low-pass the ~2 m raster)
  shifts the pastel sage lush deep-green↔dry hay. In the terrain fragment shader
  (`uNdvi`/`uMeadowNdvi`, gated by the class raster `grMeadow`), HUD slider
  *Wiesenfärbung* (default 0.5). The higher-variance NDVI canvas the analysis
  flagged (meadow carries 1.46× the crown NDVI variance). Absent raster → no-op.
- **Water** — the painted splat's alpha (water coverage, `smoothstep`ed
  shoreline) + the terrain geometry + animated normal wobble; the water and
  mist sheets hang next to their terrain mesh and leave with the tile.
  `water-layer.ts`. Missing class raster → no splat, no water: the tile's
  ground falls back to the flat sage.
- **Streaming site (3D Tiles)** — `scripts/prepare-data.ts` bakes the site
  into an OGC 3D Tiles 1.1 tileset (`lib/city/tileset.ts`): per site tile the
  buildings (refine ADD, loaded whenever the tile is in view) over the two
  terrain levels (REPLACE). 3DTilesRendererJS loads and unloads by
  screen-space error (16 px) from the view camera **and the sun's shadow
  camera**, so a tile casting into the view stays loaded. Only the fine level
  is dressed (vegetation, lamps, rails, walls); distance, not a "primary"
  role, decides which tile is detailed, and collision, demolish, focus and
  double-tap work on every visible tile. Everything a tile adds leaves with
  it (`tile-stream.ts`, `processTileModel` / `disposeTile`)
  ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). The lite e2e
  profile streams `tileset-spawn.json`, the spawn tile alone.
- **Progressive first frame** — the spawn tile's buildings + any of its
  terrain levels render first; the heavy dressing waits behind a gate the HUD
  opens after the handover (`startStreaming` in `create-app.ts`) and is built
  one tile at a time, each landing re-rendering the shadow map. Until the site
  has first loaded the fog far plane is clamped to ~1.1 km so tiles still in
  flight read as haze ([ADR 0008](./adr/0008-progressive-two-phase-boot.md)).
- **Rasters at 2048²** — `prepare-data.ts` downsamples the 4096² class raster
  NEAREST, one band (`scripts/downsample-raster.ts` `downsampleClassRaster`),
  to a quarter of the texture memory: for the coarse terrain level on every
  device, for every level on phones (`MOBILE_RASTER_PX`, chosen by the
  client per device tier), and for the minimap. No raster whose alpha is
  data goes through an image resize any more (the painted splat has the
  only such alpha, and it is made on the GPU). Cost: ~1 m instead of ~0.5 m
  class boundaries — on desktop only on the far terrain, on phones
  everywhere.
- **Buildings** — CityJSON LoD2 → **build-time** glTF per tile:
  `scripts/bake-city-mesh.ts` runs cityjson-threejs-loader, and
  `scripts/bake-tiles.ts` `cityMesh` welds it into one mesh with an
  `EXT_mesh_features` feature id per vertex (`_FEATURE_ID_0`) and a roof
  flag. The per-object style (tint, roof colour, base, eave and storey
  heights, glow, roughness) and the demolish tree ride as an
  `EXT_structural_metadata` **property table** (`scripts/tile-glb.ts`); the
  client packs it into an RGBA32F texture the clay shader `texelFetch`es
  (`lib/city/city-mesh.ts` `packObjectTexels`), so the style lives once per
  building, not once per vertex. Footprints go to `footprints_<tile>.json`
  for the minimap. Demolish = filter the building tree out of the index
  buffer + rebuild the BVH; BVH picking/collision. `city-layer.ts`. The DOP
  roof LUT is folded in at bake time.
- **Ground-clamp** — the loaded terrains' grids (fine level first) sampled to
  seat trees, lamps, rails, walls and the player on terrain.
  `lib/city/ground-clamp.ts`, `heightAt` in `create-app.ts`.

### Building detailing (all keyed off CityJSON attrs + the loader's `surfacetype`)
- **Per-building clay tint** (*Farbvariation*) — deterministic `hash(objectid)` +
  `function` family + `measuredHeight` nudge → muted per-building wall colour.
  **Source preference:** real per-building colour *(planned: DOP)* would replace
  the hash; the hash exists precisely so the look survives when `function` is 86 %
  "unspecified". `lib/city/building-tint.ts` (at bake time, into the property
  table's `tint`), `visual-style.ts`.
- **Roof colour** (*Dachfarbe*) — real **DOP-sampled** colour per building when
  available (`roofColor()` + the per-tile LUT, ~83 % coverage), else the
  synthesized palette (`surfacetype==RoofSurface` + `roofType` / `Dachneigung` →
  terracotta pitched / slate flat). Bake: `pipeline/bake/roof_colour.py`.
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
  into 250 m cells for frustum culling. `pipeline/bake/landcover.py`
  (`vegrows_<tile>.geojson`) → `vegetation-layer.ts`, per fine terrain tile.
- **Canopy fill** — `nDOM = DOM1 − DGM1`, one tree per ~7 m cell at the tallest
  pixel, scaled to measured height, **gated off road/bridge/water** via the DLM
  class raster. `pipeline/bake/canopy.py`.
- **NDVI crown colour** — per-tree DOP greenness (`ndvi_<tile>.png`, sampled on
  the CPU at placement) shifts the crown dry pale-sage → lush deep green.
  `pipeline/bake/ndvi.py` → `vegetation-layer.ts` `crownColor`; falls back to
  the hash-only sage when no NDVI raster (graceful — see portability).
  Sampled with a **5×5 footprint max** + a remap recentred on the low NDVI
  median: the raster is ~2 m/px and median-zero, so a single-pixel sample
  left ~95 % of crowns reading "dry" (invisible); the footprint max +
  recentre make lush↔dry read clearly.
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
- **Tree inventory from the Dresden street-tree cadastre** (every tile, by
  default) — *inputs:* the city's *Stadtbaumkataster* (WFS `cls:L1261`, dl-de/by-2-0
  "Landeshauptstadt Dresden"; street trees, parks, schools — not the Großer
  Garten, not private ground): position, height, crown diameter, taxon.
  `pipeline/bake/ingest_trees_dresden.py` fetches it, `pipeline/bake/trees.py`
  bakes `data/dlm/trees_<tile>.geojson` (h, d, archetype id, leaf type,
  foliage colour; missing h/d imputed from the genus median / the
  archetype's d:h), with the taxonomy in `pipeline/bake/tree_archetypes.py`: genus + cultivar + German name → six
  archetypes (round 66 %, oval 15 %, small ornamental 12 % incl. 276 globe
  cultivars, columnar 5 %, conifer 1.8 %, weeping 0.1 % of the block's 18 444
  trees), leaf type (318 evergreen; *Larix/Metasequoia/Taxodium* are
  leaf-off) and 193 purple / 40 golden cultivars. *What it does:*
  `tree-inventory-layer.ts` plants each tree at its surveyed spot; the
  per-instance scale is non-uniform (crown width = `d`, crown depth = `h`
  minus an archetype clear stem), so round/oval/small share the lobed
  broadleaf crown and only three silhouettes get geometry of their own (a
  flame for fastigiate cultivars, a tiered lathe cone for conifers, a
  curtained dome for weeping trees) — same crown material, LOD swap and
  250 m chunks as the canopy. Evergreens, purple and golden cultivars are
  tinted from the cadastre; deciduous crowns keep the NDVI remap. Row and
  canopy trees inside a cadastre crown (radius max(d/2, 3.5 m)) are dropped
  unless they overtop it by max(5 m, 30 %) (`lib/city/tree-inventory.ts`) —
  **except around a cadastre tree in DLM forest/copse** (classes 2/3; the bake
  flags it `f = 1`, 599 of 18 444 trees): there the measured canopy is kept
  whole, because the veto made parks and woods visibly thinner (the canopy
  draws every 7 m cell, the register only the trees it tends). **Draw calls:**
  the trunks and the broadleaf crowns (≈93 % of the trees) are handed to
  `buildVegetation` as precomputed `TreeInstance`s and ride in the canopy's
  own chunk meshes; only the flame/cone/dome silhouettes are meshes of the
  inventory layer.
  *Findings* (`scripts/eval/kataster-eval.py`): only **31 %** of cadastre
  trees have a canopy point (21 % on the spawn tile) — the canopy mask
  misses 99 % of the trees standing on road pixels and 67 % of those on
  built-up land; 7 743 of the missing trees are ≥ 8 m tall. 41 % of the DLM
  tree-row samples duplicate a cadastre tree. Where both exist, heights agree
  to a 2.8 m median absolute difference (canopy 1.0 m lower, r = 0.72).
  **Leaf-off NDVI cannot assign a leaf type**: AUC 0.87, but at the best
  balanced threshold (NDVI ≥ 0.37) precision for "evergreen" is 6.5 %
  (265 of 4 073 flagged), and it would flag 31 % of all canopy points; the
  best raw accuracy (98.3 %) is no better than calling everything leaf-off.
  *Look* (prototype, `shots/kat-*`): bare streets
  and squares (Radeberger Straße, Albertplatz, Stolpener Straße) become
  avenues, the fly-over reads as an inhabited city; dense parks (Rosengarten)
  get visibly thinner, because the canopy's uniform scale draws every 7 m
  cell as a 0.77·h-wide crown where the cadastre draws measured crowns.
  *Cost* (`scripts/eval/kataster-cost.ts`, block, main-pass vegetation draw
  calls after the LOD swap; canopy only → prototype as a separate layer →
  merged, as shipped): Albertstraße 222 → 581 → **401**, Albertplatz 168 →
  432 → 297, Rosengarten 140 → 385 → 259, fly-over 61 → 180 → 126 (the
  merge removes ~50 % of the added calls; what is left is the reshaped
  silhouettes, up to three per chunk). Built vegetation meshes 675 → 1 944 →
  1 367; +179 KB gzipped transfer; the prototype measured −4 to −9 % fps on
  an M1 Max (`scripts/eval/kataster-perf.ts`) and no change in time-to-ready.
  *Fallback:* no `trees_<tile>.geojson` → rows + canopy, unchanged.
  *Portability:* any city's tree register (or segmented LiDAR trees) fills
  the same contract.

- **Hedges (OSM, laser-scan height)** and **trees outside the canopy mask**
  (laser scan) — on by default. The laser scan is baked for the spawn tile
  only; the neighbours are baked OSM-only (hedges at their tag / 1.5 m, no
  extra trees). **Shipped:** the OSM `barrier=hedge` lines (`src` `osm` /
  `osm+lsc`) and the extra trees. **Not shipped** (🗃️ below): the
  laser-scan-only hedges and all shrubs. The first bake still derived them
  (`LOWVEG_ALL=1`); the Python port (`pipeline/bake/lowveg.py`) no longer
  does — the scan's hedge lines survive only to lend an OSM hedge its width.
  - *Why:* the canopy bake keeps nothing under `MIN_H = 3 m` and only
    forest/copse/sport-and-leisure areas, so courtyard and garden trees are
    dropped at any height; the Basis-DLM carries a hedge only when it is
    landscape-shaping (≥ 200 m) — `vegrows` on 33412_5656 has **0 hedges**.
  - *Inputs:* GeoSN laser scan (LAZ, 2024-11-30, leaf-off) → PDAL 0.5 m
    rasters: ground (classes 2/8/30), surface max (2/20), non-ground count, its
    multi-echo share, and the mean **intensity of the low returns** (0.25–4 m
    above ground). DOP NDVI (2024-03-19). OSM `barrier=hedge`,
    `natural=scrub|shrubbery` (from Overpass at the time; the port reads the
    local Geofabrik extract). Exclusions: LoD2 surfaces (+1 m), OSM
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
    Candidates: 594 hedges (65 OSM, 51 OSM+LSC, 478 LSC-only; 7.3 km) and
    3 226 shrubs. **Shipped: the 116 OSM hedges** (4.3 km; 54 / 94 / 45 on
    the OSM-only neighbours).
  - *Trees outside the mask* (`canopyx`): crown peaks of the multi-echo (≥ 0.5)
    > 3 m canopy, ≥ 3 m apart, more than 5 m from any current canopy point —
    8 006 peaks (96 % built-up class; 57 % more than 15 m from the DLM road
    area, 1 969 of them enclosed by buildings on ≥ 6 of 8 rays = courtyards;
    16 % street-side). **Deduplicated against the cadastre in the bake**: the
    cadastre wins position and species, and a peak within max(4 m, the
    cadastre crown radius) of a cadastre tree is dropped (radius match, not
    1:1 — one big crown often yields two peaks) → **5 739 shipped, 2 267
    dropped**. (Taking the scan height where the cadastre has none is not
    done: the cadastre bake imputes missing heights and does not mark them.)
    Rendered as ordinary canopy trees.
  - *Rendering* (`low-vegetation-layer.ts`, separate from the tree layer):
    hedges are chains of superellipsoid "clay" blocks (288 tris, ≤ 2.5 m
    pieces, 0.6 m overlap); rooted-base darkening + a static world-space
    foliage mottle; 250 m chunks; cast and receive shadows, no animation
    (ADR 0020).
  - *Cost* (prototype, real GPU, 3200×2000, full block, all candidates):
    hedges + shrubs +11–13 draw calls/frame, frame time 19.8 → 20.2 ms on the
    fly-over; the 8 006 extra trees +4.9–7 % triangles drawn, 19.8 → 23.0 ms.
    Shipped (OSM hedges + 5 739 trees), `kataster-cost.ts`: +9–58 draw calls
    in the main pass over the merged cadastre (fly-over 126 → 144,
    Albertstraße 401 → 459).
  - Bake: `pipeline/bake/lowveg.py` (`bun run bake --step lowveg`; the laser
    scan is gridded by the PDAL CLI from `data/_raw/<site>/lsc/<tile>.laz`).
    Ported from `scripts/extract-lowveg.sh` + `.py` (Overpass, per-script
    `uv run --with`) and not yet re-run against the committed files.
- **Street lamps** — OSM lamp points (the local Geofabrik extract, only those
  the tile owns: west and south edges in, east and north out, so a seam lamp
  stands once) → instanced lamp posts (ODbL). `pipeline/bake/lamps.py`; the
  viewer applies the same ownership to older files (`ownsPoint`).
  Gated off **water (8) and railway (5)** land-cover so no poles stand in the
  Elbe or the track bed (the rail corridor is now its own layer). Built per
  fine terrain tile; the three real lights go to the nearest heads of the
  visible tiles.

### Railway & bridges
All baked by `pipeline/bake/rail.py`, built **per fine terrain tile** in
`app/_components/rail-layer.ts` (Y-up, part of the tile's dressing) on the
cross-tile `heightAt` over every loaded terrain, so tracks don't truncate at
seams (until [ADR 0024](./adr/0024-site-streams-as-3d-tiles.md) it was built
once for the fixed block). Replaces the old "brown smear". All geometry is
hand-wound to match its supplied normal (`pushTri`), so every material is
`FrontSide` (halves shadow/fill cost). *(Redesigned after the v1 per-line approach
z-fought into ragged edges, fragmented, and stacked into "2-story" bridges — see
🗃️ below.)*
- **Ballast yards** — Basis-DLM `ver03_f` (railway AREA, `OBJART=42010`),
  **dissolved** with shapely `union_all(make_valid())` in the bake and clipped
  to the tile (~5 non-overlapping parts) → **one merged surface**, so dozens of
  yard tracks can't z-fight. Per-vertex ground-clamp + `BALLAST_RAISE`, short edge
  fascia, `polygonOffset`. The recoloured class-5 splat sits underneath so any gap
  reads as ballast, not seam.
- **Steel rails** — Basis-DLM `ver03_l`, **heavy rail only** (`SPW=1000`; trams
  `SPW=3000`/`BKT=1201` run in the street, excluded). Short ATKIS fragments are
  **snap-merged by shared endpoints** (1 m) in the bake (≈91→9 lines/tile); at
  runtime a polyline is **split into runs of valid ground** (never bridged across a
  NoData gap) and each track gets a thin rail pair (`±GAUGE/2`, count from `GLS`)
  with a small web. Draped on terrain; **lifted onto a rail bridge's deck** (point-
  in-deck test) so they ride the deck with no ballast stacked on top. Railway
  class recoloured dusty-mauve → **ballast warm-grey** (class 5 in
  `lib/city/landcover.ts`).
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
- **Bridge arches** — OSM `man_made=bridge` `bridge:structure` (ODbL, from the
  local extract; nearest-centroid match ≤60 m → deck `structure`) drives the
  under-deck shape: where it contains **`arch`** (Augustus-/Marienbrücke),
  `addArches` builds segmental spandrel walls (arched intrados, high at the
  crown, springing low) on both deck edges, carried on slim **river piers** —
  a masonry-viaduct read. `beam`/absent → flat soffit + box piers. Gated on
  real deck clearance (`ARCH_MIN_RISE`) so flat bridges don't get spurious
  arches. Falls back to box piers when no OSM/structure.
- **Station platforms** — OSM `railway=platform` (ODbL) → triangulated flat slabs
  (`ShapeUtils.triangulateShape`), per-vertex terrain-clamped. The OSM half of the
  blend (Basis-DLM has no platform geometry); absent/empty when the site has
  no `.osm.pbf` extract.

### Retaining / city walls
- **Walls** (*Brühlsche Terrasse &c.*) — OSM `barrier=retaining_wall|city_wall|
  wall` + `man_made=embankment` (ODbL), with the tagged `height` (e.g. the
  8.5–9 m city walls). `pipeline/bake/walls.py` → `wall-layer.ts`: vertical
  sandstone ribbons, built per fine terrain tile, base draped on the DGM via
  the cross-tile `heightAt` over every loaded terrain, top = base + height; on
  a TIN tile snapped to the measured step with a coping cap (`wall-snap.ts`,
  "Terrain TIN" above), on a grid-fallback tile nudged slightly onto the low
  side so the face skins the stepped terrain. **Why OSM:** no elevation
  product has the wall as a *vertical face* (a 2.5D surface cannot), and it's
  not a CityJSON building, so it "went missing". OSM has it as explicit
  vector lines with heights. *(Corrected by the terrain study, "Terrain TIN"
  above: the source data does NOT smooth the wall into a gentle bank. The
  laser ground returns step within ~0.75 m (median, 7 tall walls) and the
  native 1 m DGM1 within ~1.7 m at 77° — Jungfernbastei: 108.6 → 117.3 m
  over 2 m, then two more terrace levels at 119.7 and 121.1 m. It is the
  1024² resample that widened the step to ~2.9 m at 69°, the "bank" the
  viewer showed. The earlier claim "LiDAR-ground ≈ DGM" was right about the
  level — the two agree to 0.00 ± 0.05 m tile-wide — but not about the
  edge.)*
  **Source:** a LOCAL Geofabrik `.osm.pbf` read via GDAL's OSM driver (both the
  `lines` and `multipolygons` layers — GDAL files closed barrier ways as
  polygons), with **no Overpass rate limits** and reproducibly (the bash-era
  version of this bake was verified feature-for-feature identical to the old
  Overpass bake: 436 walls, same kinds/lengths/heights). Since
  [ADR 0025](./adr/0025-bakes-are-one-python-package.md) every OSM layer
  comes from that extract (`pipeline/bake/osm.py`).

### Wall → terrain conflation (breakline burn at build time)
*Superseded on TIN tiles — every tile of the Dresden site* ([ADR
0028](./adr/0028-terrain-tin-per-tile-and-wall-snap.md)): it now runs only
for a tile whose DGM has NoData, which falls back to the grid. On TIN ground
the wall ribbons snap to the measured step instead (`lib/city/wall-snap.ts`,
"Terrain TIN" above).
- **Stepped ground at walls** — `lib/city/terrain-conflate.ts`, applied at build
  time to both terrain levels before the grid is meshed (`scripts/bake-tiles.ts`
  `terrainMesh`; it ran in the browser at load until
  [ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). The DGM blurs a vertical
  wall into a ramp, so the OSM ribbon used to float over it / get swallowed and
  the ground never "stepped". The conflation reads the terrain's natural shelf
  level a short way out on each side of each wall line, then snaps nearby cells
  toward the **high-side** level on one side and the **low-side** level on the
  other — a sharp step concentrated AT the line, feathering back to the
  untouched DGM within a ~11 m band (nearest-wall-wins). The wall ribbon then
  skins a real step. **Deterministic + source-portable** (any DEM + any OSM wall
  lines). **Gated** to earth-retaining kinds
  (`retaining_wall`/`city_wall`/`embankment`) and only where the two sides
  actually differ by ≥1.5 m, so freestanding garden walls and flat fountain rims
  leave the ground alone; a ≤18 m clamp stops a bad height tag gouging a canyon.
  Pure + unit-tested (`terrain-conflate.test.ts`).
  **Measured cost (terrain study, "Terrain TIN"):** against held-out laser
  ground it raises the RMSE in the 20 m band around walls from 0.43 to 0.76 m
  (p95 0.80 → 1.62 m) — the 11 m probe reads the *top* of a terraced wall, and
  the step lands on the OSM line, not the measured edge. The terrain TIN
  skips it and snaps the ribbons to the measured step instead.

### Lighting
- **Soft shadows** — `PCFShadowMap` + raised `shadow.radius`; terrain
  `castShadow=false`; `normalBias=0`; tight camera-following frustum, whose
  camera also drives the tile streaming (casters behind the player stay
  loaded). Full recipe and dead-ends in the
  [city-walker skill](../.claude/skills/city-walker/SKILL.md).

### Atmosphere & time of day
- **Height-term fog** — DGM elevation (per-fragment world height) → extra haze
  pooling in low ground, folded into every fog-receiving material via
  `onBeforeCompile`; HUD *Talnebel*. `height-fog.ts`.
- **River mist** — DLM water mask (the painted splat's alpha) → a drifting,
  sun-lit mist sheet over the Elbe; HUD *Flussnebel*. `water-layer.ts`
  `createWaterMist`.
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
   per-tree position/height/crown; bake to per-tile GeoJSON. *(First step ✅
   above: `canopyx` crown peaks with `h` + `r`, outside the canopy mask only,
   thinned against the cadastre; the renderer still sizes a crown from `h`
   alone.)*
7. **Cascaded Shadow Maps** — the one shadow limit the skill calls unsolved (long
   low-sun shadows clip the 110 m frustum). Sizeable integration on WebGL;
   `CSMShadowNode` comes with the proposed move to WebGPURenderer + TSL
   ([ADR 0027](./adr/0027-webgpu-renderer-and-tsl.md),
   [plan 020](./plans/020-webgpu-tsl.md)), as its own decision.
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
| **Per-tile rail layer** (rail v1) | Each tile's own `heightAt` returned null off-tile → tracks truncated at every seam. | Build on the **cross-tile `heightAt`** — once for the block until ADR 0024, now per fine terrain tile over every loaded terrain. |
| **`ver06_f`-only bridge decks** (rail v2 first cut) | `ver06_f` has area polygons only for (mostly rail) major spans → road/path bridges (Augustusbrücke etc.) vanished + everything mis-classified rail. | Drive from the **complete `ver06_l`** set, footprint from `ver06_f` where matched. |
| **Motion-gated SSAO** (plan 007 as first shipped) | The contact shadows blinked on every footstep — reads as a bug, not a saving. | N8AO runs permanently at `halfRes`; only DoF is dropped while moving ([ADR 0011](./adr/0011-motion-keyed-quality-regression.md)). |
| **Cloud shadows / per-frame shadow updates for wind sway** | Would force the 3072² depth pass every frame over tens of thousands of trees, undoing the on-demand shadow map. | Sway, flutter and cloud drift run in the main pass only; the cast shadow stays static ([ADR 0020](./adr/0020-fixed-light-pool-and-static-shadow-casters.md)). |
| **Multi-echo ratio as the low-vegetation cue** (LSC, low vegetation) | Measured: only 26 % of OSM-hedge pixels reach echo ≥ 0.5, fences 56 % (AUC hedge-vs-fence 0.28); recall 25 % of observable hedge length vs 58 % for the NDVI + intensity rule. | Keep it as the *tall*-vegetation cue (100 % of > 5 m forest vs 3 % of roofs) and as a qualifier of intensity. |
| **OSM scrub polygons filled with shrubs** (OSM-only tiles) | A jittered 3–4 m grid gave 4–9 k shrubs per neighbour tile — more than the laser scan finds on the primary — mostly under existing crowns. | OSM-only tiles get the OSM hedges only. |
| **Laser-scan-only hedges** (LSC, the 478 unmapped "hedges" of the low-vegetation bake) | ~30 % of the low-vegetation mask lies 1–2 m from a > 3 m crown: crown-rim false positives a first-surface model cannot tell from understory, and they read as stray hedges along tree rows. | Only the OSM hedges ship (with the LSC height). The bake still finds them (`LOWVEG_ALL=1`); revisit with a leaf-on scan or a crown-rim test. |
| **Shrubs** (LSC blobs + OSM `natural=shrub` nodes, 3 226 on the primary) | Same crown-rim false positives, and the lobed dome reads as a faceted grey "boulder" at arm's length. | Kept in the bake behind `LOWVEG_ALL=1` until the Python port, which dropped it (the research bake is in git history); a better shrub shape is shape polish, not data. |
| **Camera-follow grass tuft ring** | Shadow-casting instances rewritten every frame; reads as confetti. | Meadow mottle + normal perturbation in the terrain shader (✅ above). |
| **Per-lamp real point lights** | three bakes the light count into every program → a recompile storm on every add/remove, plus per-light cost. | A fixed pool of 3 real lights retargeted to the nearest heads; every other lamp is emissive + sprite ([ADR 0020](./adr/0020-fixed-light-pool-and-static-shadow-casters.md)). |
| **Plain (non-shadow-gated) foliage translucency, quad leaf billboards, selective bloom** | Noise at instance distance / no payoff for the cost. | Shadow-gated shimmer + translucency only (✅ above). |
| **Baked RGB splatmap** (`landcover_rgb_<tile>.png`: RGB = pastel palette, A = water coverage, plus a 2048² variant) | The look lived in the bake: a colour change meant re-baking every tile, and the palette was spelled three times (bake, minimap, shader fallback). Its alpha was data, so every resize had to split colour from alpha — sharp premultiplies alpha across a resize, which once turned every land texel black ([ADR 0023](./adr/0023-land-cover-colours-painted-at-runtime.md), superseding ADR 0016). | The bake writes class ids only; the one palette (`lib/city/landcover.ts`) is painted on the GPU at load. A per-fragment palette lookup was rejected too: class ids cannot be mipmapped, so far boundaries would alias. |
| **Overpass-based OSM bakes** (lamps, platforms, bridge structure) | Live queries: rate-limited and not reproducible, and one more way of reading OSM next to the local extract the walls already used ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). | Every OSM layer comes from one local Geofabrik `.osm.pbf` via GDAL's OSM driver (`pipeline/bake/osm.py`). The committed lamp/platform/bridge-structure files still predate this; the next re-bake moves them (`data/provenance.json`). |
| **Bash bakes** (`scripts/extract-*.sh` + Python/Pillow heredocs) | Three languages, string-built paths, tile names and CRS spelled per script; numpy and `gdal_calc.py` were missing, so raster maths was written around Pillow ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). | One package, `pipeline/bake/`, on numpy/rasterio/pyogrio/shapely in a uv environment, driven per site tile by `bun run bake`. |
| **uint16 heightfield + custom building vertex-stream codecs** (`<tile>.heightfield-<n>.json` + `.u16.gz`; vertex stream + meta JSON) | Private formats with a codec on each side that no other tool could open, and the browser still burned the wall breaklines into the grid at load ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | Standard glTF 2.0 (meshopt + quantisation) with an `EXT_structural_metadata` table; the bake does the breaklines. Costs wire size (≈1.0 + 1.1 MB → ≈1.4 + 1.5 + 0.4 MB per tile); a heightmap-PNG custom content type is the fallback if that ever matters more than tooling. |
| **Terrain grid as the shipped ground** (1024² / 512² heightfield, walls burned in; ADR 0014, then the first tileset) | Measured against held-out laser ground: the resample, not the data, smeared walls into ~3 m banks, and the breakline burn tripled the error in the wall band while costing 7× the triangles of an equally accurate TIN ([ADR 0028](./adr/0028-terrain-tin-per-tile-and-wall-snap.md)). | Both levels are error-bounded TINs of the native DGM (±0.15 / ±0.5 m); the grid + burn remain only for a DGM with NoData. |
| **Custom terrain-TIN codec** (`dgm1_<t>.tin-<cm>cm.json` + `.bin.gz`: byte-split delta planes, varint triangles; the prototype's format) | A second private format next to the tileset once the site streamed glTF ([ADR 0028](./adr/0028-terrain-tin-per-tile-and-wall-snap.md)). | The TIN is ordinary glTF terrain content (meshopt + quantisation); the runtime indexes the streamed triangles. |
| **Fixed 2×2 block loaded at boot** (one primary tile + three neighbours, never unloaded) | The world was bounded by boot cost, nothing ever unloaded, and collision/demolish stopped at the primary tile's edge. The hand-written tile manager proposed instead (ADR 0022, never accepted) would have re-built the schedule, LRU and worker 3DTilesRendererJS already has ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | The site streams as a 3D Tiles tileset; distance, not a role, decides which tile is detailed. |
| **Inserted building** (a glTF model, else an orange marker box, dropped at a fixed Dresden spot; once on the B key) | No caller since the B key was disabled — dead plumbing through the HUD, the scene and a Dresden-only constant; removed with the site config ([ADR 0026](./adr/0026-one-site-config-per-build.md)). | Revisit only with a concrete use (e.g. a planned building to preview). |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
