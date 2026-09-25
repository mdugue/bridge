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
- **Terrain (glTF, two levels)** — DGM1 → a triangulated grid + a 30 m edge
  skirt to hide inter-tile seams, at two levels per tile: **L1 512²** (coarse,
  geometric error 40 m) replaced by **L0 1024²** near the camera. The GeoTIFF
  is resampled **at build time** (`scripts/bake-tiles.ts` `readDgm`, bilinear,
  NoData → NaN → the quads touching it are left out), the wall breaklines are
  burned in (below), normals computed, and the mesh written as glTF
  (`EXT_meshopt_compression` + `KHR_mesh_quantization`, pre-gzipped
  `terrain_<tile>_l0|l1.glb.gz`). The browser never decodes the DGM: it reads
  ground height back from the grid vertices (`gridElevations`).
  `scripts/bake-tiles.ts`, `lib/city/terrain-geometry.ts`, `terrain-layer.ts`
  ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)).
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
  `terrain-layer.ts`. **Fallback: OpenStreetMap** where the provider
  publishes no Basis-DLM in the Shape profile (Hamburg, Berlin):
  `pipeline/bake/landcover_osm.py` writes the same class raster, legend and
  hedge / tree-row lines from `landuse`/`natural`/`leisure` areas, buildings
  and amenity areas (as settlement, burned first because OSM nests the green
  inside it), buffered highways, waterways and rail. On Leipzig's centre
  tile 71 % of texels agree with the DLM raster — water 95 %, settlement
  78 %, roads 55 % ([ADR 0030](./adr/0030-sites-providers-and-per-site-data.md)).
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
  is dressed (vegetation, lamps, rails; its stairs and walls are baked into
  it); distance, not a "primary"
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
  "unspecified". **Per site:** `Site.facades` picks the wall material —
  `"render"` (default: sand, ochre, soft terracotta plaster) or `"brick"`
  (Hamburg: four clinker swatches from orange brick to dark red-brown plus
  one pale render; civic buildings keep their cool stone). The brick
  swatches are saturated because the shader mixes them 60 % into the pale
  clay in linear light, where they land on a washed, dusty brick.
  `lib/city/building-tint.ts` (at bake time, into the property table's
  `tint`), `visual-style.ts`.
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
  (`data/dresden/provenance.json`), so deciduous crowns are bare in the imagery and
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
  wall` + `man_made=embankment` + `natural=cliff` (kind `cliff`, default 3 m;
  read from `other_tags`, since GDAL has no `natural` column on `lines`)
  (ODbL), with the tagged `height` (e.g. the
  8.5–9 m city walls). `pipeline/bake/walls.py` → vertical sandstone
  ribbons (`lib/city/walls.ts`), **baked into the fine terrain glTF** as a
  `walls` node (`scripts/bake-tiles.ts` `wallMesh`,
  [ADR 0029](./adr/0029-static-dressing-baked-into-the-fine-terrain.md)):
  base on the shaped ground of every tile's fine grid (so a wall near a seam
  reads its neighbour's), top on the high shelf, nudged slightly onto the
  low side so the face skins the (stepped) terrain; `wall-layer.ts` only
  gives it its material. Until then the browser built the ribbons from the
  GeoJSON over whichever terrains were loaded. **Why OSM:** the monumental wall is NOT in the elevation data —
  DGM1/DOM1/**LiDAR-ground all smooth it into a gentle bank** (verified by
  sampling: ground ≈ DGM across the wall), and it's not a CityJSON building, so it
  "went missing". OSM has it as explicit vector lines with heights.
  **Source:** a LOCAL Geofabrik `.osm.pbf` read via GDAL's OSM driver (both the
  `lines` and `multipolygons` layers — GDAL files closed barrier ways as
  polygons), with **no Overpass rate limits** and reproducibly (the bash-era
  version of this bake was verified feature-for-feature identical to the old
  Overpass bake: 436 walls, same kinds/lengths/heights). Since
  [ADR 0025](./adr/0025-bakes-are-one-python-package.md) every OSM layer
  comes from that extract (`pipeline/bake/osm.py`).

### Wall → terrain conflation (breakline burn at build time)
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
  (`retaining_wall`/`city_wall`/`embankment`/`cliff`) and only where the two sides
  actually differ by ≥1.5 m, so freestanding garden walls and flat fountain rims
  leave the ground alone; a ≤18 m clamp stops a bad height tag gouging a canyon.
  Pure + unit-tested (`terrain-conflate.test.ts`).

### Stairs (OSM steps over a lowered terrain)
- **Flights of steps** (*Freitreppe am Italienischen Dörfchen &c.*) — OSM
  `highway=steps` (ODbL). `pipeline/bake/stairs.py` → `stairs_<tile>.geojson`:
  the axis oriented bottom → top, `w` from `width` (else an
  `area:highway=steps` outline: area ÷ axis length; else the gap between the
  OSM walls either side when the slope fills it, the axis re-centred; else
  2.5 m), `z` = the two
  landing heights from the DGM 1 m beyond each end (3×3 m median), `n` from
  `step_count` when its riser is 8–25 cm, else rise ÷ 16 cm. Indoor,
  underground, tunnel and bridge flights and anything flatter than 30 cm are
  left out. Where the DGM lacks the structure a flight climbs (less than
  half its tagged rise) and its top lands on a raised OSM area (`layer` ≥ 1),
  the tagged rise wins and the area goes to `terraces_<tile>.geojson` at the
  flight's top level — the Brühlsche Terrasse, 118.3 m over the
  Schlossplatz's 112.2 m. At build, `lib/city/stairs.ts` lifts the ground
  inside each terrace (`raiseTerraces`, after the wall conflation; holes in
  the OSM area filled), then `burnStairs` sets the terrain under each
  flight to 12 cm below the ramp through the steps' inner corners — lifting
  it where the DGM runs below, since the player walks on the grid — and
  lowers every vertex beside it whose triangles reach under it, never
  across a wall. The same build step writes each flight as sandstone blocks
  — treads, darker risers, side cheeks down past the bottom landing — into
  the fine terrain glTF of the tile owning its middle (a `stairs` node,
  vertex colours); `stair-layer.ts` only gives it its material.
  **Why:** the DGM1 smooths a staircase into a bank (the flight beside the
  Italienisches Dörfchen read as a grassy slope) and its ~2 m grid cannot
  hold a 16 cm riser ([ADR 0028](./adr/0028-osm-stairs-as-geometry-over-a-lowered-terrain.md)).
  **Fallback:** no `.osm.pbf` → the step is skipped, the committed file stays;
  no file → no stairs, the terrain as before. Pure + unit-tested
  (`stairs.test.ts`, the bake end-to-end against a synthetic OSM extract in
  `pipeline/tests`).

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
   The same download would carry the surveyed stairs and walls
   (`AX_SonstigesBauwerkOderSonstigeEinrichtung`: *Treppe*, *Mauer*,
   *Stützmauer*) — a second, official source for `stairs.py` and `walls.py`
   where OSM is thin (ADR 0028).
4. **Cartographic minimap** — DTK / basemap.de P10 raster tile + Ortsteile labels
   replacing the math-drawn minimap.
5. **Dappled canopy shadow** — alpha-tested colour-less proxy caster per chunk
   (mind the `WebGLShadowMap` alphaMap-override gotcha; see skill).
6. **Real trees from the laser-scan point cloud** — segment high-veg returns →
   per-tree position/height/crown; bake to per-tile GeoJSON.
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
| **Camera-follow grass tuft ring** | Shadow-casting instances rewritten every frame; reads as confetti. | Meadow mottle + normal perturbation in the terrain shader (✅ above). |
| **Per-lamp real point lights** | three bakes the light count into every program → a recompile storm on every add/remove, plus per-light cost. | A fixed pool of 3 real lights retargeted to the nearest heads; every other lamp is emissive + sprite ([ADR 0020](./adr/0020-fixed-light-pool-and-static-shadow-casters.md)). |
| **Plain (non-shadow-gated) foliage translucency, quad leaf billboards, selective bloom** | Noise at instance distance / no payoff for the cost. | Shadow-gated shimmer + translucency only (✅ above). |
| **Baked RGB splatmap** (`landcover_rgb_<tile>.png`: RGB = pastel palette, A = water coverage, plus a 2048² variant) | The look lived in the bake: a colour change meant re-baking every tile, and the palette was spelled three times (bake, minimap, shader fallback). Its alpha was data, so every resize had to split colour from alpha — sharp premultiplies alpha across a resize, which once turned every land texel black ([ADR 0023](./adr/0023-land-cover-colours-painted-at-runtime.md), superseding ADR 0016). | The bake writes class ids only; the one palette (`lib/city/landcover.ts`) is painted on the GPU at load. A per-fragment palette lookup was rejected too: class ids cannot be mipmapped, so far boundaries would alias. |
| **Overpass-based OSM bakes** (lamps, platforms, bridge structure) | Live queries: rate-limited and not reproducible, and one more way of reading OSM next to the local extract the walls already used ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). | Every OSM layer comes from one local Geofabrik `.osm.pbf` via GDAL's OSM driver (`pipeline/bake/osm.py`). The committed lamp/platform/bridge-structure files still predate this; the next re-bake moves them (`data/dresden/provenance.json`). |
| **Bash bakes** (`scripts/extract-*.sh` + Python/Pillow heredocs) | Three languages, string-built paths, tile names and CRS spelled per script; numpy and `gdal_calc.py` were missing, so raster maths was written around Pillow ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). | One package, `pipeline/bake/`, on numpy/rasterio/pyogrio/shapely in a uv environment, driven per site tile by `bun run bake`. |
| **uint16 heightfield + custom building vertex-stream codecs** (`<tile>.heightfield-<n>.json` + `.u16.gz`; vertex stream + meta JSON) | Private formats with a codec on each side that no other tool could open, and the browser still burned the wall breaklines into the grid at load ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | Standard glTF 2.0 (meshopt + quantisation) with an `EXT_structural_metadata` table; the bake does the breaklines. Costs wire size (≈1.0 + 1.1 MB → ≈1.4 + 1.5 + 0.4 MB per tile); a heightmap-PNG custom content type is the fallback if that ever matters more than tooling. |
| **Fixed 2×2 block loaded at boot** (one primary tile + three neighbours, never unloaded) | The world was bounded by boot cost, nothing ever unloaded, and collision/demolish stopped at the primary tile's edge. The hand-written tile manager proposed instead (ADR 0022, never accepted) would have re-built the schedule, LRU and worker 3DTilesRendererJS already has ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | The site streams as a 3D Tiles tileset; distance, not a role, decides which tile is detailed. |
| **Inserted building** (a glTF model, else an orange marker box, dropped at a fixed Dresden spot; once on the B key) | No caller since the B key was disabled — dead plumbing through the HUD, the scene and a Dresden-only constant; removed with the site config ([ADR 0026](./adr/0026-one-site-config-per-build.md)). | Revisit only with a concrete use (e.g. a planned building to preview). |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
