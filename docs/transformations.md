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
- **Squares and islands from OSM** (*Plätze, Inseln*) — the DLM draws many
  squares as one road area: the Albertplatz's pedestrian island, its lawns
  and fountains were grey carriageway with no kerb. The land-cover bake
  carves them back out, over road texels only: OSM `highway=pedestrian` /
  `area:highway` (footway, pedestrian, traffic island) areas and fountain
  basins become built-up (4), `leisure=park|garden` and
  `landuse=grass|village_green|meadow|flowerbed` meadow (1), the lawn
  winning inside a pedestrian area. Idempotent, so `bun run bake --step
  islands` applies it to the committed raster without the raw DLM
  (2026-09-25: ≈ 0.2–0.7 M texels per tile, Prager Straße and the Altmarkt
  among them). The legend then carries the OSM credit.
  `pipeline/bake/landcover.py` `carve_islands`.
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
- **Kerbs and lawn edges** (*Bordsteine, Rasenkanten*) — the DLM road
  class (7) is the surveyed carriageway, so its edge is the kerb line.
  `pipeline/bake/edges.py` measures, from the committed class raster, the
  signed distance to the road edge and to the meadow edge (urban green
  included) out to ±6 m, box-smoothed so the isolines run straight along a
  diagonal instead of following the 0.5 m staircase → `edges_<tile>.png`
  (2048², two bytes per texel). From the road's 0-isoline it also writes
  the **kerb lines** (`kerbs_<tile>.geojson`, road on the left) where the
  far side is ground (not water or railway). The terrain bake stands a
  **kerb stone** on them in the fine terrain glTF (`lib/city/kerbs.ts`,
  12 cm above the road, 24 cm wide, its top level at the higher side, face
  toward the road; `kerb-layer.ts`, casts shadow) — the DGM1 smooths the
  step away and the 2 m grid cannot hold it. In the fragment pass
  (`ground-detail.ts`) the distance draws a pale stone band on the
  pavement side and a darker gutter on the road side (the coarse level's
  kerb), a lawn lip with a normal kink, the parking lanes and the paving
  rows along the kerb. The first cut drew the kerb as a shading-normal
  step from the class texels alone; on the raster's staircase it read as
  dashes and odd shadow flecks (replaced 2026-09-25). The stone's own
  shadow on the road is drawn from the sun: when the sun stands behind the
  kerb, the strip out to 12 cm · cot(elevation) is shaded — a shadow the
  shadow map cannot hold (7 cm texels spread by the soft PCF, less the depth
  bias). HUD *Bodendetail*.
  Plan [023](./plans/023-ground-detail.md).
- **Paving materials** (*Beläge*) — OSM `surface=*` on the highways (plus
  `sidewalk:*:surface` bands beside the roads, `footway:surface`, pedestrian
  squares, parking lots) → a 2048² two-byte raster per tile
  (`pipeline/bake/surface.py` → `surface_<tile>.png`, greyscale, the bytes
  interleaved so the viewer's own PNG decoder reads it exactly): R packs the
  carriageway's and the pavement's material (asphalt, concrete, slabs, sett,
  unpaved, grass pavers; `park · 64 + walk · 8 + road`), G the way's
  direction. The
  shader reads `road` on class 7 and `walk` elsewhere; unknown falls back to
  asphalt / slabs (class 4) / sand (class 6). Patterns in the street's own
  frame — slabs in running bond (low-contrast joints), concrete plates,
  gravel and asphalt mottles, grass pavers; sett as a darker, warmer tone
  with a fine direction-free grain (the drawn stone grid with pillow
  shading read as busy and seamed where two streets' frames met, and was
  abstracted away on review) — fade out by `fwidth` before they alias; the material's tint
  stays at any distance. Coverage (Dresden, 2026-09-19 extract): ~87 % of the
  highway ways carry `surface`, ~68 % of the DLM carriageway texels get a
  material. Fine terrain level only; absent raster → the class defaults.
  HUD *Bodendetail*. `ground-detail.ts`, `terrain-layer.ts`.
- **Parking** (*Parkplätze*) — OSM street parking (`parking:{left,right,both}`
  = lane / yes / street_side / on_kerb …, with `:orientation`) and car parks
  on the ground (`amenity=parking`, `amenity=parking_space`; the
  `service=parking_aisle` driveways cleared) → the paving raster's top two
  bits. On the carriageway a parking lane from the kerb distance — 2 m with
  bays every 5.5 m (parallel) or 5 m with bays every 2.5 m (perpendicular /
  diagonal) — with its edge line; in a car park bay lines every 2.5 m across
  the aisle (or, without a mapped aisle, the lot's long axis). Pale painted
  lines, faded out past ~15 cm/px; a car park without `surface` is asphalt.
  Dresden: ~600 surface car parks, ~530 mapped bays, ~780 aisles, street
  parking on ~1 000 roads. No cars (not in any dataset). HUD *Bodendetail*.
  `ground-detail.ts`.
- **Urban green** (*Stadtgrün*) — the DLM's built-up class (4) covers
  courtyards, front gardens and parks inside the settlement alike. Where
  the DOP NDVI (upsampled, blurred) passes 0.3 on classes 0 and 4 and OSM
  does not call the ground paved, `edges.py` counts it as meadow; the
  shader paints it exactly as meadow — its colour, mottle, NDVI tint and
  lawn edge. The first cut blended toward the meadow colour at 0.85 ×
  slider and read as barely there. HUD *Stadtgrün* (default 1).
  `ground-detail.ts` `urbanGreen`.
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
  is dressed (vegetation, lamps, monuments, rails; its stairs and walls are
  baked into it); distance, not a "primary"
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
  seat trees, lamps, monuments, rails, walls and the player on terrain.
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
  the mid crown is a detail-2 icosphere (180 tris) with lobes;
  **three-tier crown LOD** per 250 m chunk (`lib/city/vegetation-lod.ts`),
  planned over every loaded tile at once: the rich ~1 440-tri multi-tuft
  crown near (220 m in / 300 m out) but only while the site's rich trees fit
  a budget of 2 500, nearest chunks first; the mid crown + trunk; and past
  650 m (back at 550 m) a detail-1 crown (80 tris) without trunk, dense
  chunks (≥ 400 trees) thinned to every other tree drawn 1.35× wider. Before
  the budget, a camera in the Dresdner Heide's forest tiles (one tree per
  7 m) put ~9 000 rich crowns on screen — ~80 M triangles per pass over the
  site, which stalled the GPU into a lost context; the same view is now
  ~23 M;
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

- **Street furniture** — OSM benches (`amenity=bench`, points and the
  ways a bench is sometimes drawn as), picnic tables, litter bins
  (`waste_basket`), bicycle stands (`bicycle_parking`, not wall loops),
  bollards, post boxes and stop shelters (`highway=bus_stop` /
  `public_transport=platform` with `shelter=yes`, `amenity=shelter` of
  `shelter_type=public_transport`; one per 8 m) → one point layer per tile
  (ODbL), about 3 000 objects over the four tiles. OSM seldom says which way
  a bench looks (`direction`, on ~3 %), so **the bake turns an untagged
  object to the nearest highway within 25 m** (across it when it stands on
  it); a bench way stands at its midpoint at its mapped length, facing the
  path side. Only what the tags carry varies: `backrest=no` benches are
  stools, a stand's `capacity` gives its hoops (two bikes each). Dropped:
  indoors, underground, classes 5 and 8, bridge decks (the terrain under
  them is the river). A bollard keeps its tagged `height` and a metal
  `material` (the Stallhof's 1.46 m bronze columns of 1591 are mapped as
  bollards). `pipeline/bake/furniture.py`; the viewer instances one small,
  **abstracted** model per kind — softened blocks, capsules and single tube
  strokes, a bench one extruded seat-and-back profile — in the scene's
  palette at its own brightness (a warm sand-clay for seating, the roads'
  lavender-grey for metal, the buildings' clay for stone; one matte
  vertex-coloured material). **Low contrast on purpose:** a first,
  deeper palette (honey 211/176/140, slate 157/156/176) stood out from the
  pale ground and the clay buildings; the pieces now differ from them by
  form and shadow, not by tone (`furniture-layer.ts`,
  `lib/city/furniture.ts`). Not (yet): bicycle-parking *areas*, shelters
  mapped as areas, planters, signs (OSM maps ~100 traffic signs and almost
  no street-name signs here; the 321 traffic-signal nodes sit on the
  carriageway, not at the mast — both too sparse or too placed-by-guess).
- **Playgrounds** — OSM `leisure=playground` outlines (≥ 20 m²; 88 over the
  four tiles) → a pale sand floor flush on the ground (a breath warmer than the paving), seated on the
  ground under each ring vertex (densified to 2 m), and **only the
  equipment OSM maps** (`playground=swing/basketswing/slide/sandpit/
  climbingframe/structure/climbingwall/springy/spring_board/seesaw/
  roundabout/playhouse`, ~100 pieces) standing on it; a sandpit drawn as an
  area is its own sand slab, one drawn as a way stands at its midpoint
  turned along it. **A playground mapped without equipment stays an empty
  patch — nothing is invented** (the choice against filling them with
  typical pieces). The pieces are not catalogue equipment but soft, single-coloured
  sculptures (an arch, a wave, a faceted dome, an egg) in five pastels taken
  from the scene and lifted to the buildings' brightness — a first, literal
  rendering (A-frames, ladders, a rose safety floor) read as busy and out of
  place, and saturated pastels stood out as much. Same bake and layer as the street furniture.

- **Fountains, statues, memorial stones, columns** — the Basis-DLM's
  monument points (`sie03_p`, `OBJART=51009`, `BWF` 1750/1770/1780, with
  their official names; GeoSN) conflated with OSM's `amenity=fountain`
  points and basin outlines (ODbL; the DLM names none of its monuments a
  fountain and gives no basin size). A DLM monument on an OSM fountain names
  it; the other OSM fountains are added. **What a monument looks like is in
  no register, but its bulk is measured:** DOM1 − DGM1 (the canopy's nDOM)
  holds the sculpture groups of the Albertplatz fountains as ~4 × 5 m bodies
  3.7 m tall, the Goldener Reiter as 7 m. Where that body stands clear — one
  connected patch within 6 m (or inside the basin's water), ≤ 60 cells,
  below 8.5 m and touching nothing taller (a leafless crown reads the same
  on a 1 m grid) — the bake writes it as `relief` (27 of 174 monuments). 
  `pipeline/bake/monuments.py` → `monument-layer.ts`: a relief is smoothed
  (`reliefSurface`: ×4 bilinear, one binomial pass) into one soft form in
  the buildings' clay, seated per sample on the terrain; a monument nothing
  measured is an abstract clay marker (rounded pillar · slab · shaft,
  `MARKER_SHAPE`) — no invented figure. Basins are the OSM outline as a low
  clay rim (the water its 0.35 m inset) over the highest ground under it,
  with translucent water bells that grow with the basin, round a measured
  sculpture when there is one (splash pads flush, reflecting pools still);
  a point fountain is a 2.2 m round basin. The canopy loses the "trees" its
  own bake planted on a measured monument (`onRelief`). The fountains move
  gently — each bell breathes on its own phase, droplets run down its
  curtain, light shimmers across the water — and by night the water glows
  and a fountain's sculpture is lit warm from its basin (`setFountainTime`,
  `setFountainNight`, one shared clock and night factor). Merged/instanced,
  seven draw calls per tile at most. Not walk-blocking (collision is
  buildings only).
  **Caveats, checked against the sources:** DOM1 (November 2024) and DOP
  (March 2024) were both taken while Dresden's fountains are drained and
  their sculptures boxed for winter — the Albertplatz "bodies" are those
  housings (flat-topped, ~3.7 m), right in size and place, not the figures.
  The DOP shows the gilded Goldener Reiter only as glare (its shadow holds
  the horse's silhouette), so no colour is sampled. The laser point cloud
  (LSC, the only official source with more form) was unreachable from
  GeoSN's share when this was built; no openly licensed 3D scan of the
  landmarks was found.

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
- **Contour ink guard** — a flat terrain quad lying exactly on a 2 m or 10 m
  contour has `fwidth` 0, and 0/0 striped it with NaN ink (a diamond of
  lines on flat roads). No slope, no contour line. `terrain-layer.ts`.

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
11. **Far crown LOD tier** — ✅ shipped (see *Crown shaping* above); still to
    judge on a real GPU with the `--headed` harness: whether the far tier's
    pop at 650 m and the thinned forest read well, and whether a detail-0
    crown (20 tris) beyond ~1.5 km is worth a fourth tier.
12. **Ground, the rest of plan [023](./plans/023-ground-detail.md)** — a
    raised pavement (today the kerb stone stands on a pavement at road
    level); DGM1 micro-relief as a
    1 m normal texture over the 2 m mesh; shell-textured grass near the
    camera (4–8 shells, meadow only, no shadow casting — judge the fill-rate
    on a real GPU); parks, cemeteries and sports grounds split out of the
    DLM's built-up class by object type (`sie02_f` `OBJART`/`FKT`, needs the
    raw DLM); the laser-scan intensity (LSC) as a measured surface-material
    map where OSM is silent.

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
| **Overpass-based OSM bakes** (lamps, platforms, bridge structure) | Live queries: rate-limited and not reproducible, and one more way of reading OSM next to the local extract the walls already used ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). | Every OSM layer comes from one local Geofabrik `.osm.pbf` via GDAL's OSM driver (`pipeline/bake/osm.py`). The committed lamp/platform/bridge-structure files still predate this; the next re-bake moves them (`data/provenance.json`). |
| **Bash bakes** (`scripts/extract-*.sh` + Python/Pillow heredocs) | Three languages, string-built paths, tile names and CRS spelled per script; numpy and `gdal_calc.py` were missing, so raster maths was written around Pillow ([ADR 0025](./adr/0025-bakes-are-one-python-package.md)). | One package, `pipeline/bake/`, on numpy/rasterio/pyogrio/shapely in a uv environment, driven per site tile by `bun run bake`. |
| **uint16 heightfield + custom building vertex-stream codecs** (`<tile>.heightfield-<n>.json` + `.u16.gz`; vertex stream + meta JSON) | Private formats with a codec on each side that no other tool could open, and the browser still burned the wall breaklines into the grid at load ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | Standard glTF 2.0 (meshopt + quantisation) with an `EXT_structural_metadata` table; the bake does the breaklines. Costs wire size (≈1.0 + 1.1 MB → ≈1.4 + 1.5 + 0.4 MB per tile); a heightmap-PNG custom content type is the fallback if that ever matters more than tooling. |
| **Fixed 2×2 block loaded at boot** (one primary tile + three neighbours, never unloaded) | The world was bounded by boot cost, nothing ever unloaded, and collision/demolish stopped at the primary tile's edge. The hand-written tile manager proposed instead (ADR 0022, never accepted) would have re-built the schedule, LRU and worker 3DTilesRendererJS already has ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | The site streams as a 3D Tiles tileset; distance, not a role, decides which tile is detailed. |
| **Inserted building** (a glTF model, else an orange marker box, dropped at a fixed Dresden spot; once on the B key) | No caller since the B key was disabled — dead plumbing through the HUD, the scene and a Dresden-only constant; removed with the site config ([ADR 0026](./adr/0026-one-site-config-per-build.md)). | Revisit only with a concrete use (e.g. a planned building to preview). |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
