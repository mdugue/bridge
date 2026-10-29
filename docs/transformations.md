# Transformation catalog

The ledger of every **data → look** transformation we've built, tried, or
planned — so a decision made in one chat thread is not re-litigated or
re-discovered in the next. This is the in-repo, version-controlled successor to
scattered notes; **append here when you ship, shelve, or reject a transformation.**

**Status legend:** ✅ active (shipped) · 🧪 experimental (prototype / behind a
slider, not load-bearing) · 📋 planned (designed, not built) · 🗃️ discontinued
(tried or considered and rejected — kept so we don't retry it blindly).

**Method badges:** each active or experimental entry says how the viewer
comes by what it draws — `❝ taken` as the source publishes it, `= computed`
by a fixed formula over measured values, `◎ detected` by pattern recognition
(thresholds, matching, image analysis: it can be wrong), `≈ assumed` where
nothing is known for the thing (a default, an average, a design choice). The
badges are defined in `lib/city/methods.ts`, explained for readers in the
guide's [How the viewer comes by what it shows](./guide/en/methods.md), and
the inquiry card shows the same four per line. A new or changed entry carries
its badge.

Each entry records **inputs**, **what it does**, **source preference / fallback**
(what it degrades to when its best input is absent — see
[portability.md](./portability.md)), and **where it lives**. The *why* behind
the load-bearing choices is in the [ADRs](./adr/README.md); the attribute →
visual-variable codebook is in
[rendering.md](./rendering.md#visual-encoding--which-data-drives-which-pixel).

---

## ✅ Active

### Geometry & ground
- **Terrain TIN** `= computed` (the fine level, every tile, **±0.15 m**) — DGM1 read at
  its **native 1 m (2000²)** → the terraces lifted and the ground lowered
  under the stairs (below; the stairs ±0.15 m deeper, so no approximating
  triangle pierces a tread) → Delatin error-bounded TIN (every source grid
  point within the tolerance of the mesh) → the fine level's glTF
  (`terrain_<tile>_l0.glb.gz`, reordered for meshopt, `extras.tin`), baked
  by `scripts/bake-terrain-tin.ts` + `scripts/bake-tiles.ts`
  (`tinTerrainMesh`) inside `prepare-data.ts` from the committed GeoTIFF (no
  new committed input). The viewer indexes its triangles for `heightAt`
  (`lib/city/terrain-tin.ts` `TinIndex`, skirt skipped) and gives the water
  an up-facing normal twin (`terrain-layer.ts` `tinHeightAt`,
  `waterGeometryOf`). **No wall conflation** on the TIN: the earth-retaining
  ribbons baked beside it snap to the step the ground measures
  (`lib/city/wall-snap.ts` via `lib/city/walls.ts`: steepest metre within
  6 m of the OSM line, running medians along the wall over the neighbours
  that found the same step (crests within 1.5 m, `SAME_STEP_M`;
  2026-10-21: on a terraced slope a median over two terraces' steps stood
  one block from the lower foot to the upper crest, up to 15 m tall on
  walls tagged 3 m — Meißen's Burgberg, read from above as boulders on
  the vineyard), face just in front of
  the ramp foot + a coping cap back to where the ground reaches its level,
  per column, the ribbon broken between runs whose caps differ by more
  than 1 m (`stepRuns`) and each run's cap ends smoothed within it (cap
  triangles deeper than 6.5 m: Meißen 586 → 193, Dresden's 33410_5656
  391 → 144, Leipzig's 33316_5688 1 323 → 641, whose faces over 10 m went
  50 → 0) — a cap ending at the median crest left the DGM's steep ramp
  showing behind it as a row of jagged facets wherever the ramp ran wider;
  where it finds no shelf within 5 m it drops a back face to the ground,
  and the foot reaches the lowest ground along the face — ADR 0030).
  The coarse 512² level keeps
  the grid and the conflation; a DGM with NoData keeps the grid for its fine
  level too ([ADR 0030](./adr/0030-terrain-tin-and-wall-snap.md)).
  **In the 3D Tiles bake** (2026-09-25): 0.30 / 0.39 / 0.49 / 0.31 M
  triangles (33410_5656 / 33410_5658 / 33412_5658 / 33412_5656) for
  1.70 / 1.68 / 1.99 / 1.61 MB gzipped — the 1024² grid it replaced was
  2.1 M triangles and 2.30 / 2.15 / 2.45 / 2.19 MB (20–27 % more); about 8 s
  per tile to bake. The earlier prototype (a private header + delta-plane
  payload, ±0.25 m on the neighbours, before the move to glTF) is where the
  numbers below come from.
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
  **Visual (real GPU, the primary-only prototype):** terraced
  Jungfernbastei reads correctly (terrace levels kept, trees on the first
  level visible), quay walls straight and clean from the air; residue: a few
  sub-metre ground spikes at wall feet and faint shading bands on snapped wall
  faces, faint facet streaks on the water next to bridge piers.
  **Still open:** constrained breaklines (a vertical wall is two vertices at
  one xy — Delatin cannot, a constrained Delaunay with the snapped wall line
  could, and would remove the spikes and the cap), NoData support (the bake
  refuses holes), crease-angle normals. Two independent TINs meet at a seam
  with different border vertices (T-junctions, each tile's own edge
  heights); the skirt hides the crack. **Neighbour check (real GPU, full
  block):** the Brühlsche Terrasse west of the seam (33410_5656), the
  Terrassenufer across the 33410/33412 seam, the Altstadt around the
  Frauenkirche from the air and the northern seam (33412_5658) show no
  ground step, crack or wall break at the tile edges; the terrace wall reads
  as one continuous face across the seam. **Seam bands (fixed
  2026-09-25, grids and TIN alike):** a bright band ran along every seam,
  one border triangle wide — metres on a TIN's flat road — because the 30 m
  skirt shared the border vertices and dominated their area-weighted
  normals; the terrain's normals now come from its surface triangles alone
  (`scripts/bake-tiles.ts` `terrainNormals`). Across the Elbe the water and
  mist sheets drew the skirt as a wall of water; their geometry now leaves
  out every triangle without area in plan (`terrain-layer.ts`
  `waterGeometryOf`). Checked on a real GPU at the 33410/33412_5656 seam
  (heights there agree to 5 cm on average).
- **Terrain (glTF, two levels)** `= computed` — DGM1 → a triangulated mesh + a 30 m edge
  skirt to hide inter-tile seams, at two levels per tile: **L1 512²**
  (coarse, geometric error 40 m) replaced near the camera by **L0**, the TIN
  above (a 1024² grid until 2026-09-25, and still for a DGM with NoData).
  The coarse GeoTIFF is resampled **at build time** (`scripts/bake-tiles.ts`
  `readDgm`, bilinear, NoData → NaN → the quads touching it are left out),
  the wall breaklines are burned in (below), normals computed, and the mesh
  written as glTF (`EXT_meshopt_compression` + `KHR_mesh_quantization`,
  pre-gzipped `terrain_<tile>_l0|l1.glb.gz`). The browser never decodes the
  DGM: it reads ground height back from the grid vertices
  (`gridElevations`), or from the TIN's triangles.
  `scripts/bake-tiles.ts`, `lib/city/terrain-geometry.ts`, `terrain-layer.ts`
  ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)).
- **Ground plate** `= computed` (*Bodenplatte*) — the whole site's ground
  at a 62.5 m grid (33² vertices per tile, the edges shared with the
  neighbours, so it has no seams), each vertex the fine ground's height
  and the commonest land-cover class within half a cell around it, read
  across the tile edges (so colour and shading meet without a seam too),
  coloured by the palette at runtime. One small site file
  (`plate.bin.gz`, 49 kB for Dresden's fifteen tiles, 21 kB gzipped)
  fetched with the tileset; the viewer draws a tile's plate (its inner
  vertices 1.5 m under their heights, its edges on them, so it meets a
  landed neighbour without a step) wherever that tile has no terrain
  level on screen yet, so a tile that never streamed, or that the cache let
  go of, shows ground instead of the sky on a flight or a turn.
  `lib/city/ground-plate.ts`, `scripts/prepare/plate.ts` `bakePlate`,
  `ground-plate-layer.ts` ([plan 076](./plans/076-streaming-without-holes.md)).
- **Far buildings** `= computed` (*Gebäude in der Ferne*) — each tile's
  buildings a second time, the same glTF with every vertex its shape does
  not need dropped (meshopt's simplifier over the written glTF, at most
  0.5 m: 1.85 M → 0.29 M triangles and 5.0 → 2.6 MB gzipped on Dresden's
  spawn tile; 5 cm kept 62 % of them, 20 cm 32 %), shown beyond ≈ 260 m
  of the tile and from the air, the baked LoD2 replacing it near
  (`FAR_CITY_ERROR` 4 m). The shape is the same but for small roof
  detail; the windows lose the per-vertex ground samples along the walls
  and the doors, which nothing at that distance resolves. Chosen over
  LoD1 blocks from the footprints, the plan's first idea: blocks would
  have cost about as many triangles (≈ 30 a building) and lost the roofs,
  a jump at every switch. `scripts/tile-glb.ts` `simplifyGlb`,
  `lib/city/tileset.ts` ([plan 076](./plans/076-streaming-without-holes.md)).
- **Squares and islands from OSM** `❝ taken` (*Plätze, Inseln*) — the DLM draws many
  squares as one road area: the Albertplatz's pedestrian island, its lawns
  and fountains were grey carriageway with no kerb. The land-cover bake
  carves them back out, over road texels only: OSM `highway=pedestrian` /
  `area:highway` (footway, pedestrian, traffic island) areas and fountain
  basins become built-up (4), `leisure=park|garden` and
  `landuse=grass|village_green|meadow|flowerbed` meadow (1), the lawn
  winning inside a pedestrian area. Idempotent, so `bun run bake <site> --step
  islands` applies it to the committed raster without the raw DLM
  (2026-09-25: ≈ 0.2–0.7 M texels per tile, Prager Straße and the Altmarkt
  among them). The legend then carries the OSM credit.
  `pipeline/bake/landcover.py` `carve_islands`.
- **Surface colours** `❝ taken` `= computed` — Basis-DLM land-cover → a 4096² **class-id raster**
  (8-bit, ids 0–9 — 9 arable since 2026-10-21, below —, burned lowest priority first so water wins;
  `pipeline/bake/landcover.py` → `landcover_<tile>.png` + legend). The colours
  are **not** baked: `lib/city/landcover.ts` holds the one pastel palette, and
  `landcover-splat.ts` paints it on the GPU once per tile at load (RGB =
  palette, A = water coverage from a 3×3 tent over class 8) into an sRGB,
  mipmapped, anisotropy-16 target — what the baked PNG used to be sampled
  with. A desktop's fine level paints its 4096² raster at **half size**
  (2026-10-10, plan 070 step 4, `splatScaleFor`): a texel is the mean of
  the 2×2 class colours under it and the water the four tents' mean — the
  full-size splat's first mip, so only the near field changes, where a
  boundary now blends over 1 m instead of 0.5 m and the 0.5 m staircase
  of a diagonal edge is gone. 64 MiB less per fine tile (85 → 21 MiB with
  mips); SwiftShader plates of the Elbe shore, a road's meadow edge at eye
  level and the Großer Garten from 50 m showed nothing blockier. The minimap and the site's map picture (`site-map.webp`: the start
  page's city card, the `/wissen` hero) use the same table; a colour
  change is a look change, not a re-bake
  ([ADR 0010](./adr/0010-opaque-clay-buildings-only.md)).
  `terrain-layer.ts`. **Fallback: OpenStreetMap** where the provider
  publishes no Basis-DLM in the Shape profile (Hamburg, Berlin):
  `pipeline/bake/landcover_osm.py` writes the same class raster, legend and
  hedge / tree-row lines from `landuse`/`natural`/`leisure` areas, buildings
  and amenity areas (as settlement, burned first because OSM nests the green
  inside it), buffered highways, waterways and rail. On Leipzig's centre
  tile 71 % of texels agree with the DLM raster — water 95 %, settlement
  78 %, roads 55 % ([ADR 0037](./adr/0037-sites-providers-and-per-site-data.md)).
  The OSM land cover (2026-10-21, B15–B26): a one-way main road (motorway
  to tertiary) at half its class's width (at least 2 m a side: a dual
  carriageway's two ways had each burned a whole road's width), light
  rail, subway, narrow gauge and a tram on its own bed (not embedded)
  burned as railway (off bridges), allotments and cemeteries as meadow,
  OSM `farmland` as arable. Hamburg's road land 44.9 → 43.8 ha, its
  railway 4.7 → 5.1 ha on one tile.
  **Road widths from OSM** `❝ taken` `≈ assumed` (2026-10-21,
  `pipeline/bake/road_widths.py`): a DLM axis without `BRF` (71–77 % of the
  road length in Grimma, Meißen and Unna, 95 % in Dresden) took one width
  per road class (5 m for every Gemeindestraße); now, piece by piece
  (20 m), it takes the carriageway of the OSM car way running with it
  (≤ 3 m, ≤ 20°): `width:carriageway`/`width`, else `lanes` (else the DLM's
  `FSZ`) × 3 m + 2 m per side of parking on the carriageway (1 m for bays
  half on the kerb, none for bays on it), else the class's width plus that
  parking; 1.5–12 m a side. Mean error against `BRF`: 0.98 / 1.58 /
  2.34 m in Grimma / Meißen / Unna, against 1.64 / 1.72 / 2.96 m for the
  class default (on Dresden's main roads with `BRF` it would be worse,
  2.15 against 1.67 — they keep their `BRF`). Road land against main,
  measured on the re-baked tiles with this change's other road rules
  (tunnels, below): Dresden 415.6 → 518.7 ha over 15 tiles (+25 %),
  Leipzig +23 %, München +15 %, Grimma +13 %, Unna +9 %, Meißen +5 %;
  Hamburg −5 % (its land cover is OSM's, no DLM widths: only the tunnels).
  **Arable** `❝ taken` `= computed` (class 9, 2026-10-21): the
  Basis-DLM's arable land (`veg01` `VEG` 1010/1011/1013, `arable_areas`)
  and OSM `farmland` are no longer meadow; painted a pale loam
  (`ARABLE_CLASS`, [204, 186, 154]), a crop's green where the NDVI sees
  one (bias 2.5, `smoothstep(0.12, 0.42)`; about 40 % of it reads as
  crop), faint 0.75 m furrows along the field's long axis (the paving
  raster's bearing on arable land, `surface.py` `field_frames`;
  `terrain-layer.ts` `arableGround`). It counts as lawn for the kerbs and
  as green in the site's statistics. Grimma 215 ha, Unna 129 ha, Meißen
  1.5 ha (measured on the re-baked class rasters).
  **Nothing in a tunnel is burned** (2026-10-20): a DLM road axis loses
  its stretch along a DLM tunnel (`ver06` `BWF=1870`, the rail layer's
  rule: > 15 m within 2 m, `common.above_ground`), and every OSM way a
  terrain bake reads (`osm.read_ways`: the OSM land cover, paving, road
  markings, lamps, furniture, allotments) skips `tunnel=*` and
  `location=underground` — a culvert too. Before, the road of a tunnel was
  painted on the ground above it, with a kerb along both sides: measured
  against OSM's tunnels, Dresden painted 36 % of its tunnels' 2.2 ha off
  the surface roads as road with 2.1 km of kerb (Tunnel Bramschstraße,
  Wiener Platz), Meißen 0.8 ha over the Schottenbergtunnel's hillside
  (336 m of kerb), Hamburg 57 % of its tunnels (Wallring-, Deichtortunnel),
  Munich 30 % (Altstadtringtunnel, Paul-Heyse-Unterführung).
  **Nothing piped is burned either** (2026-10-21, `landcover.py`
  `stream_buffers`): not a DLM stream axis flagged `HDU_X`
  (*hatDirektUnten*), nor its stretch in a `ver06` culvert (`BWF` 2010
  *Durchlass*, 2011 *Rohrdurchlass*, 2012 *Düker*, 2 m round its line or
  area; a bridge, 1800, does not cut it) — on the six DLM sites every
  flagged axis lies in such a structure but 46 m in Grimma, and the
  orthophoto shows no water there; and on an OSM land cover (Hamburg,
  Berlin) no water area or waterway tagged `covered`, in a tunnel, or
  underground or indoors (`landcover_osm.hidden_water`; `read_ways`
  already skipped the culverted lines). It was a straight blue line
  through Unna's station (the Kortelbach, 1.0 km) and a blue stripe across
  every road over a culvert: 8.5 km of stream axis in Dresden (23 % of
  them, 1.70 ha), 8.6 km in München (88 %), 4.9 km in Leipzig (59 %; the
  Pleißemühlgraben under the square by the Neues Rathaus), 2.0 km in Unna
  (57 %) and Grimma (30 %; the Thostgrundbach under its street), 1.8 km in
  Meißen (43 %). OSM's own culverts are not used on the DLM sites: they
  cut an open stream in Unna.
- **Meadow NDVI tint** `= computed` (*Wiesenfärbung*) — on class-1 farmland/meadow only, the
  DOP greenness (`ndvi_<tile>.png`, LINEAR-filtered to low-pass the ~2 m raster)
  shifts the pastel sage lush deep-green↔dry hay. In the terrain's colour node
  (`meadowNdvi`, gated by the meadow class of the raster), at
  *Wiesenfärbung*'s fixed strength (`MEADOW_NDVI`, 0.6). The higher-variance NDVI canvas the analysis
  flagged (meadow carries 1.46× the crown NDVI variance). Absent raster → no-op.
- **Kerbs and lawn edges** `= computed` `≈ assumed` (*Bordsteine, Rasenkanten*) — the DLM road
  class (7) is the surveyed carriageway, so its edge is the kerb line.
  `pipeline/bake/edges.py` measures, from the committed class raster, the
  signed distance to the road edge and to the meadow edge (urban green
  included) out to ±6 m, box-smoothed so the isolines run straight along a
  diagonal instead of following the 0.5 m staircase → `edges_<tile>.png`
  (2048², two bytes per texel). From the road's 0-isoline it also writes
  the **kerb lines** (`kerbs_<tile>.geojson`, road on the left) where the
  far side is ground (not water or railway) and the road is not one out of
  town: none where the nearest OSM carriageway (within 20 m) is a motorway
  or its link, lies in a speed zone tagged `DE:rural`/`DE:motorway`, or
  posts 70 km/h or more without an urban zone (`edges.out_of_town`). The
  road edge is the carriageway's, not the parcel's (2026-10-21): green
  road land past it (a verge, *Urban green* below) is meadow in both
  distances, so its kerb stands at the carriageway — in town only. Every
  road edge had one; Mapillary at 13 such kerbs on three sites (2026-10-20)
  showed an edge line, a verge and reflector posts at 12, the 13th a
  junction's island (Unna). It takes 8.1 km of stone off Unna (5.2 % of
  its kerbs), 6.6 km off Dresden (0.6 %), 5.2 km off Grimma (4.9 %),
  under a kilometre off Hamburg, Meißen and Leipzig, none off München.
  The painted band and its sun shadow (below) follow the same lines
  (2026-10-21): `markings.py` sets bit 8 of the road-markings raster's G
  channel (`KERB`, `LANE_BITS.kerb`) within 2 m and a texel's diagonal of
  every kerb line (less its lowered stretches, below: `full_height`), and
  the fine level's shader draws the band only there
  (`ground-detail.ts` `kerbLines`, bilinear over the four texels, so the
  band fades out over a texel where a kerb ends); before, it ran on along
  every road out of town, beside water and rails and over a tunnel, for
  the shader did not know the kerb lines. The coarse level keeps the
  class rule. *(The road-markings PNG grows: Dresden's 33408_5658
  50 → 100 kB, the phone's 16.5 → 36 kB. Where a kept kerb ends against
  rail or water the band may overrun it by up to 3 m.)* The terrain bake stands a
  **kerb stone** on them in the fine terrain glTF (`lib/city/kerbs.ts`,
  12 cm above the road, 24 cm wide, face toward the road, its top falling
  to the pavement's level where the stone ends (a verge or bank below the
  road too), densified where the ground bends between its 2.5 m columns,
  its face's foot down to a gutter below the road (ADR 0030) — a stone level across stood
  a second step on the pavement side, whose smoothed DGM lies only a few
  centimetres above the road; `kerb-layer.ts`, casts shadow) — the DGM1 smooths the
  step away and no terrain mesh built from it can hold it. In the fragment pass
  (`ground-detail.ts`) the distance draws a pale stone band on the
  pavement side and a darker gutter on the road side (the coarse level's
  kerb), a lawn lip with a normal kink, the parking lanes and the paving
  rows along the kerb. The first cut drew the kerb as a shading-normal
  step from the class texels alone; on the raster's staircase it read as
  dashes and odd shadow flecks (replaced 2026-09-25). The stone's own
  shadow on the road is drawn from the sun: when the sun stands behind the
  kerb, the strip out to 12 cm · cot(elevation) is shaded — a shadow the
  shadow map cannot hold (7 cm texels spread by the soft PCF, less the depth
  bias). On *Bodendetail* (`GROUND_DETAIL`).
  Plan [023](./plans/completed.md#023--the-ground-up-close-kerbs-paving-lawn-edges-urban-green--closed-2026-09-25-phases-13-and-5-built-rest-rejected-or-moved).
  **Lowered kerbs** (`pipeline/bake/kerb_drops.py`, 2026-10-21) — 3 cm over
  the road (flush for `kerb=flush|no`) ±1.5 m at a crossing node's kerbs
  either side, where a crossing way meets a kerb, at `kerb=lowered|rolled`
  nodes (snapped within 3 m), and across driveways and untagged service
  ways (half their width, ≥ 1.5 m); `kerb=raised|regular` keeps it; a
  0.5 m ramp at each end (`low` on the kerb lines, `kerbHeightAt`). 0.8–3.4 %
  of the kerb per tile, 0.6–3.8 km. The painted band and its shadow leave
  the lowered stretches out; the ramps keep them.
- **Paving materials** `❝ taken` `≈ assumed` (*Beläge*) — OSM `surface=*` on the highways (plus
  `sidewalk:*:surface` bands beside the roads, `footway:surface`, pedestrian
  squares, parking lots) → a 2048² four-byte raster per tile
  (`pipeline/bake/surface.py` → `surface_<tile>.png`, greyscale, the bytes
  interleaved so the viewer's own PNG decoder reads it exactly): R packs the
  carriageway's and the pavement's material (asphalt, concrete, slabs, sett,
  unpaved, grass pavers; `park · 64 + walk · 8 + road`), G the way's
  direction (on arable land the field's long axis), B and A's low five
  bits the 13-bit offset along the street, A's bits 5–6 the street
  parking's place and bit 7 whether its bays are painted (*Parking* below).
  The
  shader reads `road` on class 7 and `walk` elsewhere; unknown falls back to
  asphalt / slabs (class 4) / sand (class 6). **A path OSM gives no
  surface** (2026-10-21, `path_defaults`) takes the Basis-DLM's `BEF`, else
  asphalt inside the settlement and unpaved outside it — texels of an
  unknown path: Dresden 12 638 → 1 748, Unna 22 779 → 562, Grimma
  24 919 → 1 462, München 4 752 → 203. A street's `sidewalk:*:surface`
  band reaches from the kerb to the nearest building its normal meets
  (1–8 m, `band_depths`), else 3 m. Patterns in the street's own
  frame — slabs in running bond (low-contrast joints), concrete plates,
  gravel and asphalt mottles, grass pavers; sett as a darker, warmer tone
  with a fine direction-free grain (the drawn stone grid with pillow
  shading read as busy and seamed where two streets' frames met, and was
  abstracted away on review) — fade out by `fwidth` before they alias; the material's tint
  stays at any distance. Coverage (Dresden, 2026-09-19 extract): ~87 % of the
  highway ways carry `surface`, ~68 % of the DLM carriageway texels get a
  material. Fine terrain level only; absent raster → the class defaults.
  On *Bodendetail*. `ground-detail.ts`, `terrain-layer.ts`.
- **Parking** `❝ taken` `≈ assumed` (*Parkplätze*) — OSM street parking (`parking:{left,right,both}`
  = lane / yes / street_side / on_kerb …, with `:orientation`) and car parks
  on the ground (`amenity=parking`, `amenity=parking_space`; the
  `service=parking_aisle` driveways cleared) → the paving raster's top two
  bits. On the carriageway a parking lane from the kerb distance — 2 m with
  bays every 5.5 m (parallel) or 5 m with bays every 2.5 m (perpendicular /
  diagonal) —, its lines **only where OSM says the bays are marked**
  (2026-10-21, `parking:<side>:markings`, the old `marked` /
  `painted_area_only`; A's bit 7), else a 3 % tint and no line;
  `half_on_kerb` straddles the kerb by 1 m, `on_kerb` lies on the
  pavement (A's bits 5–6, `ground-detail.ts` `parkPlace`, `parkPainted`); in a car park bay lines every 2.5 m across
  the aisle (or, without a mapped aisle, the lot's long axis), painted
  unless `markings=no` or the lot is unpaved. Pale painted
  lines, faded out past ~15 cm/px; a car park without `surface` is asphalt.
  Painted street bays: Dresden 310 → 7.0 km (225 825 → 10 777 m² on a
  tile), Leipzig 162 → 4.7 km, Hamburg 47.7 → 0.4 km, München 169 → 0 km,
  Meißen's 6 598 m² → 0.
  Dresden: ~600 surface car parks, ~530 mapped bays, ~780 aisles, street
  parking on ~1 000 roads. No cars (not in any dataset). On *Bodendetail*.
  `ground-detail.ts`.
- **Sports grounds** `❝ taken` `≈ assumed` (*Sportplätze*) — OSM `leisure=pitch` / `track`
  (areas, and tracks mapped as a line), nothing `indoor`, `covered` or on
  a roof (playgrounds are street furniture, below) → `pipeline/bake/sport.py`: a table of grounds
  (`sport_<tile>.json`, one row each: centre, long axis, size, surface,
  line scheme, shape) and a 2048² index raster (`sport_<tile>.png`, four
  bytes per texel: the row on top, a second row reaching it, the exact
  outline bit). The surface is the `surface` tag, else the one the
  orthophoto shows (2026-10-20, below), else the sport's usual one
  (football grass, tennis clay, basketball hard court, athletics tartan,
  beach volleyball sand); the lines are the sport's (the first of a
  `;` list): football, tennis, basketball, volleyball, a handball / multi-
  sport court, running lanes, a chess board. The shape is the minimum
  rotated rectangle (area ≥ 85 % of it), a capsule band for an oval track
  (the band's width solved from the mapped area), else the mapped outline.
  In the terrain fragment pass (`sport-ground.ts`) the four texels around
  a fragment name up to eight candidate rows; each row's analytic shape
  decides inside or out, so edges are exact rather than the raster's metre
  staircase — the first cut read one row per texel and sawed teeth into a
  track's inner edge where its capsule model strayed past the mapped
  outline into the pitch's texels (fixed with the second row). Pastel
  surfaces (`lib/city/sport.ts`), mown stripes on grass, fine grain, and
  the standard line dimensions (FIFA, ITF, FIBA, FIVB) scaled down to fit
  a smaller ground; lines box-filtered over the pixel footprint (a 12 cm
  line is a steady hairline from afar); blue tape on sand.
  An untagged surface is read off the orthophoto (`photo_surface`): the
  football default had drawn every untagged pitch as grass, and in
  Dresden one of the twelve is — four are artificial turf, six the red
  rubber of a small all-weather pitch, one cinder. The photo is taken to
  Dresden's colour balance (`dop_balance.py`) and read on the outline
  shrunk by 2 m, in its sunlit texels, when at least half of them are in
  sun and no more than a quarter stands 2 m over the ground (crowns,
  roofs): a calibrated NDVI ≥ 0.2 is grass; then in linear RGB a b/g over
  1 (not red) a blue or teal coated hard court, an r/g ≤ 0.9 artificial
  turf (green but not growing), an r/g ≥ 1.4 tartan when its b/g is
  ≥ 0.8 (pink-red) and otherwise clay on a tennis court or cinder,
  anything else earth below a b/g of 0.88 (clay on a tennis court, else
  cinder) or a hard court. A running track is not read (its band is
  narrow, and its mapped area often holds the infield: the first pass
  read football grass into tracks), and a sand ground — a riding arena,
  beach volleyball — only turns grass (sand reads as earth or a pale hard
  court). A flight without infrared (Bavaria's GLI) cannot tell turf from grass, so
  a green ground keeps its default there (🗃️ *A visible-band turf test*,
  below). On the tagged grounds of the
  cities with infrared the NDVI tells grass from turf on 63 of 69 (five
  tagged grass show nothing growing — converted since, perhaps); a tagged
  surface is never changed (the photo is one day's). A pitch of no known
  sport, drawn only with a tagged surface until then, is drawn with the
  photo's too (no lines). On the fine
  level the dressing stands **goals**, **basketball posts** and **nets**
  (`sport-fixtures.ts`, `sportFixtures`): pale-clay bars, the nets a
  lavender-grey veil in the street furniture's palette and matte material, one merged mesh each per tile, in the tile that owns
  the ground's centre. The lines on a desktop's fine level only; a
  phone's pitches show their land-cover class, its goals and nets stay
  (🗃️ *Sports-ground lines beyond a desktop's fine level*); absent files
  → the land-cover class. Dresden (2026-09-19 extract): 431 grounds over the fifteen tiles
  (175 on the four first; a table row per tile a ground reaches).
  Textures scale with *Bodendetail*; colours and lines stay.
  **A block of tennis courts** (2026-10-21, W20): a tennis ground over
  1000 m² is round(area / 650) courts — its rectangle cut into the grid
  nearest a court's 2 : 1 (one row on a tie), each cell its own row with
  its lines and net (Dresden 53 → 56 rows, München 6 → 8).
- **Road markings** `❝ taken` `≈ assumed` (plan 026) — OSM `highway=crossing` nodes,
  `highway=traffic_signals` nodes with a `traffic_signals:direction` (or
  `direction`), and the roads' `lanes`, `oneway`, `lane_markings` and
  `cycleway[:right|:left|:both]=lane` → `pipeline/bake/markings.py`: a
  table of rotated rectangles (`markings_<tile>.json`: centre, the axis
  across the road, half extents, kind) and a 2048² raster
  (`markings_<tile>.png`, four bytes per texel: the row reaching it,
  16-bit; lane bits; the signed distance to the carriageway's middle).
  A crossing is painted when OSM says it is marked (2026-10-21, B18–B26,
  `crossing_kind`): a zebra only from `crossing:markings` zebra/ladder,
  `crossing_ref=zebra`, `crossing=zebra` or the zebra's sign `DE:350`; a
  *Furt* (two broken lines) for `crossing:markings` lines/dashes/dots/yes
  or a signalled crossing (German signalled crossings are a *Furt*: 97 %
  of Dresden's and Leipzig's that say so); `marked` or `uncontrolled`
  alone paints nothing (in the orthophotos they are mostly unmarked, or
  cross a cycle track — only about 30 % of the zebras they drew were
  there), nor do `unmarked` and `markings=no`. Zebras: Dresden 172 → 35,
  Leipzig 88 → 34, Hamburg 149 → 81, München 100 → 33, Unna 63 → 26,
  Meißen 11 → 7, Grimma 3. Its axis is the normal of the nearest
  carriageway way at the node, its length the contiguous DLM road texels
  along that normal — measured also 5 and 10 m along the road, the
  narrowest valid run winning, because at a junction the normal through
  the node runs down the crossing street. A stop line lies 3 m before a
  directed signal, across the right half of the approach (the whole road
  on a oneway). Cycle lanes (2026-10-21, `cycle_sides`, `cycle_lane_bits`):
  a *Radfahrstreifen* (`:lane=exclusive`) a solid 25 cm line at 1.85 m from
  the kerb, a *Schutzstreifen* 12 cm dashes at 1.5 m, 2.25 m where it is
  tagged ≥ 2.05 m wide; moved out past a parking lane on that side; red
  where `surface:colour=red` (and the whole track of a red cycleway mapped
  on its own, `RED`); none for pictograms only — on the side the raster
  says (resolved in the bake per texel — the paving raster's bearing is
  only known modulo 180°; `lib/city/markings.ts` `cycleLineFromKerb`).
  Solid / dashed: Dresden 51.8 / 27.0 km, Leipzig 40.9 / 10.4, Hamburg
  27.8 / 6.0 (+ 1.5 km red), München 19.7 / 5.0, Unna 0.4 / 8.8. Centre
  lines: 12 cm dashes
  (3 m in 8.25 m) where the signed distance to the middle crosses zero, on
  two-way primary/secondary/tertiary/trunk/unclassified roads with
  `lanes` ≥ 2 and a carriageway ≥ 5.5 m, clear of junctions by 12 m —
  residential streets tagged `lanes=2` (≈300 ways) are left unmarked, as
  they mostly are in Dresden; solid where `overtaking=no` or the
  `divider` is a solid line, none on a physical divider or within 2 m of a
  tram track (the tracks run on the axis: Dresden 33.1 km, Leipzig 9.0,
  München 4.7 dropped); with four lanes or more a solid middle and dashed
  lane lines halfway to each kerb (`centre_bits`, `lane_fields`). Painted in the terrain's fragment pass
  (`road-markings.ts`), box-filtered (a zebra far off averages to a pale
  band), clipped to the carriageway, worn, fine level only; scales with
  *Bodendetail*. Baked from the BBBike extract of 2026-09-19: over the
  fifteen tiles (2026-09-26) **837 crossings** (127 zebra, 710 *Furt*) and
  **583 stop lines**, 169 crossings and 93 signals left unpainted; the
  first bake (2026-09-25, four tiles) had 364 crossings (59 zebra, 305
  *Furt*) and 214 stop lines, 60 crossings and 32 signals unpainted (no DLM road
  within 3 m of the node — mostly service roads the DLM does not carry —
  or no carriageway narrower than 30 m nearby). **Across a seam**
  (2026-09-26): rows are measured on the class rasters of the tile and its
  neighbours, so a carriageway is no longer cut at the tile edge (8 rows
  had been, one down to a 0.12 m half-length), and a neighbour's row whose
  paint reaches into the tile is painted there too (13 such rows; before,
  4 rows reached past an edge that no neighbour painted). Checked on the
  four first tiles against the crossing footway through each node: the painted axis is within 20° of
  it for 278 of 301 (median 2°), and 18 of 364 rectangles lie less than
  70 % on the DLM carriageway — under the plan's 1-in-10 stop. ≈12 s per
  tile, 77–107 KB raster + 5–11 KB table. **Overlapping rows** (review,
  2026-09-25): the raster names one row per texel, last wins, so a
  crossing OSM maps twice (a node per way, a zebra node beside a signal
  node) clipped its twin — 62 of the 578 rows lost paint, 6 of them all of
  it (e.g. a *Furt* under a zebra on 33410_5658). The bake now merges rows
  of one family on one axis (within 30°) whose outlines come within 1.5 m
  — a zebra wins over a *Furt*, the union across the road, along it only
  when parallel — and gives each texel within 0.75 m of a rectangle to the
  nearest one before any margin: 516 rows (52 zebra, 251 *Furt*, 213 stop
  lines), none losing paint; 9 lose a sliver only where another row paints
  over it (`paint_lost`, logged and tested). Phones read a **1024² twin**
  (`markings_low_<tile>.png`, 25–36 KB; a 1.45 m core so the rows still
  resolve — none loses paint): 4 MiB of GPU memory per fine tile instead
  of 16; its lane bits are coarser (≈90 % of the cycle-lane and
  centre-line texels agree with the 2048² raster). **Two carriageways
  in line** (the other sites, 2026-09-26): on Leipzig's ring and Hamburg's
  wide streets the crossings of both carriageways touch across the median
  and merged into one row painted over it (44 m across on Leipzig's
  ring); a merge that would reach further across than one carriageway
  plus a metre (`MAX_MERGED_HALF_M`, 16 m half-length) now leaves them two
  rows. Dresden's largest merged row is 15.18 m, so its files are
  unchanged. **Not yet judged on a GPU.**
- **Urban green** `◎ detected` (*Stadtgrün*) — the DLM's built-up class (4) covers
  courtyards, front gardens and parks inside the settlement alike. Where
  the DOP NDVI (upsampled, blurred) passes 0.3 on classes 0 and 4 and OSM
  does not call the ground paved, `edges.py` counts it as meadow; the
  shader paints it exactly as meadow — its colour, mottle, NDVI tint and
  lawn edge. The railway class (5) too, off every track bed
  (`ways.track_beds` + 0.5 m; 2026-10-20): the DLM's parcel holds the
  embankments and verges, which the ballast grey painted grey — off the
  traffic, the calibrated index passes 0.3 on 5 % of it in Dresden, 8 % in
  Leipzig, 23 % in Hamburg and 29 % in Unna. The road class (7) too,
  beyond everything paved (2026-10-21, PR #173 B12, `edges.py`
  `verge_green`): the DLM's parcel holds the embankments, verges, junction
  islands and the woods between a dual carriageway's lanes, which the
  class raster painted as asphalt. Clear of the carriageways and track
  beds (`ways.traffic`), OSM's highways at their width (+ 3 m with a
  `sidewalk` tag, each + 0.5 m) and its paved areas (car parks, squares,
  highway areas but the traffic islands, buildings), what is green low
  ground (NDVI > 0.3, DOM1 under 1 m over the DGM) or a wood (a crowned
  patch at least 8 m across, ≥ 20 % of it green: under a crown the NDVI
  may be the crown's own green over a pavement, and a leaf-off wood reads
  green in patches only) counts; closed over 2 m, holes under a crown
  filled (the tree on an island), patches ≥ 25 m². It repaints 0.43–1.57 %
  of a site's road land (Dresden 2.8 ha, Leipzig 1.7, Unna 0.9, München
  0.7, Meißen 0.3, Grimma 0.15; Hamburg none: its road class is OSM's
  buffers, which the paved ways cover). Without DOM1 none (a street tree's
  crown reads green over a pavement), nor without the DLM's road axes on a
  DLM site. The first cut blended toward the meadow colour at 0.85 ×
  slider and read as barely there. *Stadtgrün* at full strength
  (`URBAN_GREEN`, fixed).
  `ground-detail.ts` `urbanGreen`.
- **Water** `❝ taken` `= computed` `≈ assumed` — the painted splat's alpha (water coverage, `smoothstep`ed
  shoreline) + the terrain geometry + the wind's waves on a level normal
  (+ the drifting mist); the water and mist sheets hang next to their
  terrain mesh and leave with the tile, each over only the triangles
  within its reach of the class raster's water (100 m, the mist 600 m;
  since 2026-10-24, `lib/city/water-mask.ts` — they draped the whole
  tile before). `water-layer.ts`. Missing class
  raster → no splat, no water: the tile's ground falls back to the flat
  sage.
  *Waves* `≈ assumed` (since 2026-10-23, `water-waves.ts`; drawn, not
  simulated, since 2026-10-25): one wave field for the river sheet and
  the fountains' basins, a function of the place and the clock alone, so
  two tiles meet without an edge — two layers of gradient noise stretched
  2.6× along the crest (12 m and 4.4 m across on the river, 1.2 m in a
  basin), each drifting downwind, the finer bent by the coarser, under
  gusts 80 m across (5 m in a basin) that leave calm patches beside rough
  ones. Each layer fades where its wavelength spans fewer than a few
  pixels. The river is *matte* (the maintainer's choice, 2026-10-25): its
  body's tint and depth tone, lit by the scene, the waves' normal tilting
  that light a little so the water moves — no sky mirrored in it. The
  sun's reflection: the material's own specular (roughness 0.6) a soft
  path toward the sun, shadowed by houses and decks, and emissive on it
  tight glints and, on the crests' lee side (where the field crosses one
  level, `stroke`), dashes of light. Three noise reads a pixel; the five-octave
  field before it took eight. It replaced crossing sine waves (⛔ below).
  Since 2026-10-21 the land-cover bake also splits the water class into
  **bodies** (`pipeline/bake/water.py`, the legend's `water`): 4-connected
  1 m texels, cut only where OSM maps `waterway=weir|lock_gate|dam` across
  them. *One surface per body:* a DGM fill of at least 50 m² whose edge
  lies mostly more than 0.5 m below a larger fill of the same body is
  lifted to it, smallest first; nothing is lowered. A measured sloping
  surface keeps its slope (so a seam never steps), and so does a step at
  a weir. The terrain bake raises lifted cells on both levels
  (`raiseWater`). Hamburg 32564_5932: 16 629 → 1 701 step cells,
  42 027 m² raised; its four tiles 35 087 → 5 036. The tide is not
  modelled: the Elbe stays at its DGM fill, 2.00 m, about mean high water.
  *Shore* `◎ detected`: water texels more than 0.3 m above the body's
  local level (20th percentile per 5 m block, median over 45 m) become
  meadow where the DOP is green (NDVI ≥ 0.15, GLI ≥ 0.05), the
  neighbouring built, rail or road class within 3 m, else sand (class 6).
  Streams under 8 m wide are left alone. On a quay the dry band is the
  DGM's ramp up the wall: the measured quay stands over it (*Walls*
  below). Dry area before → after: Dresden
  33412_5656 12 140 → 468 m²; München 18 824 → 2 423 m²; Meißen
  7 415 → 1 009 m². *Tint* `= computed`: each body's open water (≥ 5 m
  from its bank) is read in the cast-corrected DOP as a Lab median and
  pooled across the tiles it spans; drawn as its hue at the sheet's
  lightness, back to the palette where the read is grey, dark or close to
  it. Hamburg's Elbe is ochre and the Isar green; the Alster, the Fleete
  and Saxony's rivers keep the palette colour. *Foam* `◎ detected`
  `≈ assumed`: a white band along OSM weirs (the DGM's drop there, else
  0.8 m) and along drops of more than 0.5 m within 20 m of open water with
  water on both sides; at most 16 per tile, fine terrain level only.
  München 784 m (up to 4.6 m), Dresden's Weißeritz 0.9 and 1.9 m. **Not
  yet judged on a real GPU** (the foam and the tint).
- **Landing stages, groynes, ferries** `❝ taken` `= computed` `≈ assumed` (plan
  [031](./plans/completed.md#031--the-elbe-landing-stages-groynes-ferries--done-2026-09-25-look-unjudged-on-a-gpu--plan-019)) — OSM `man_made=pier` (51 ways,
  buffered by `width`, else 3 m, flat ends; 5 areas), `man_made=groyne`
  (1) and `route=ferry` ways (3: the Johannstadt ferry, two paddle-steamer
  routes) (ODbL) → `pipeline/bake/riverside.py` → `riverside_<tile>.geojson`
  (44 piers, 43 pontoons, 1 groyne, 9 ferry stretches over the fifteen
  tiles, 2026-09-26; the OSM counts above and 25 / 31 / 1 / 4 are the four
  first tiles'). **A pier's deck from DOM1** (2026-10-21, V27/V28):
  DOM1's median over its part on the water or the low ground beside it
  (≤ 1 m over the water), read off the cells 0.3–2.5 m over the water or
  the ground; the bank's DGM at its landward end (its highest dry sample)
  + 0.4 m only without DOM1 (that rule had a Dresden pier 5.7 m over the
  river). A pier DOM1 has under the DGM's river (Hamburg: the DGM's river
  at 2.0 m, the scan at −0.6 m with the tide) floats as a pontoon. A
  pontoon's freeboard `fb` = DOM1 over its hull − DOM1's open water 3–12 m
  out, clamped 0.4–1.5 m (0.9 m without DOM1); a fixed pier on the water
  touching a pontoon is its finger (`finger: 1`: its `fb`, no hut, no
  gangway). A stage is drawn only where a quarter of its cells stand
  ≥ 0.3 m over the water — Dresden's 145 m pontoon at 417284,5654960 lies
  under the river. A groyne is cut to where the DGM along it stands
  ≥ 0.3 m over the water beside it (`w`, the water's level 3–15 m out),
  its crest on the DGM — Dresden's one groyne lies under the water and is
  not drawn. Piers / pontoons: Dresden 44 / 43 → 16 / 48 (15 fingers, 23
  not drawn; `fb` median 0.67 m, 18 of 48 at the 1.5 m cap), Hamburg
  38 / 106 → 23 / 109 (4 floated by their deck; `fb` median 1.5 m, 61 of
  109 at the cap — the cap may be too low for Hamburg), Leipzig's piers
  7 → 5, Meißen's 2 → 1. A **pontoon** (`floating=yes`, or a pier
  reaching > 25 m out on the water class) is cut to its part on the water
  class — OSM draws many up the bank, and the DGM's river surface is flat
  (103.75 m, 104.3 m, 105.05 m by stretch) while the bank rises 2–5 m, so
  the uncut outlines spread 2.7–5.2 m of DGM under a hull; cut, the median
  spread is 0.22 m (max 2.27 m, a shoreline cell) — the plan's STOP asked
  for the water surface the way `water-layer.ts` draws it: the water sheet
  *is* the terrain there, so the runtime floats the hull on the **lowest
  ground under it** (`waterLevel`), never on a baked DGM value. `bank` is
  the nearest dry point (≤ 30 m) for its gangway, unless a fixed pier
  reaches it (28 of 31 have one). Ferry routes are cut to their stretches
  over the water class. Runtime `riverside-layer.ts`: a pier is a timber
  deck 0.3 m thick on instanced piles every 4 m round its edge where it
  stands over the water, with a railing (top rail + posts every 2 m) along
  the edges over the water (plan 029's fence panel is not merged here); a
  pontoon a soft slate hull from 0.3 m under the water to its deck's
  underside, under a pale deck 0.15 m thick at the water + `fb` (until
  2026-10-21 −0.3 → +0.35 m under a deck at +0.5 m), a
  clay ticket hut with a slate roof on one longer than 15 m, a 1.4 m
  gangway with hand rails to its bank point (a finger pier the same
  without hut or gangway); a groyne a low stone ridge
  along the stretch the DGM shows, its crest 0.12 m over the DGM (which
  holds its stones), flanks 2.5 m out down to 0.3 m under the water beside
  it (`w`), else 1 m down; a ferry a **faint dashed wake** (1.2 m, 14 m dashes,
  alpha 0.55) on the water — drawn as its own ribbon over the water sheet
  rather than inside the water shader (no line table; same look, one
  draw), and, the STOP's conservative fallback taken without a GPU plate,
  **only from the air**: it fades in with the camera's height over the
  ground from 25 to 60 m (`map-overlay.ts`). The paddle steamers themselves are not drawn: no dataset
  has them. Look unverified on a real GPU.
- **Streaming site (3D Tiles)** `= computed` — `scripts/prepare-data.ts` bakes the site
  into an OGC 3D Tiles 1.1 tileset (`lib/city/tileset.ts`) under
  `public/data/<site>/`, one per built site, each streamed at its own route
  (`/dresden`; `scripts/prepare-sites.ts`, ADR 0037): per site tile the
  buildings (loaded whenever the tile is in view, far off simplified,
  near as baked — REPLACE, plan 076) beside the two terrain levels
  (REPLACE). 3DTilesRendererJS loads and unloads by
  screen-space error (16 px) from the view camera **and the sun's shadow
  camera**, so a tile casting into the view stays loaded. Only the fine level
  is dressed (vegetation, lamps, monuments, rails; its stairs and walls are
  baked into it); distance, not a "primary"
  role, decides which tile is detailed, and collision, demolish, focus and
  double-tap work on every visible tile. Everything a tile adds leaves with
  it (`tile-stream.ts`, `processTileModel` / `disposeTile`)
  ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). The lite e2e
  profile streams `tileset-spawn.json`, the spawn tile alone.
- **Progressive first frame** `= computed` — the spawn tile's buildings + any of its
  terrain levels render first; the heavy dressing waits behind a gate the HUD
  opens after the handover (`startStreaming` in `create-app.ts`) and is built
  one tile at a time, each landing re-rendering the shadow map. Until the site
  has first loaded the fog far plane is clamped to ~1.1 km so tiles still in
  flight read as haze ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)).
- **Rasters at 2048²** `= computed` — `scripts/prepare/side-bakes.ts` downsamples the 4096² class raster
  NEAREST, one band (`scripts/downsample-raster.ts` `downsampleClassRaster`),
  to a quarter of the texture memory: for the fine level on phones
  (`MOBILE_RASTER_PX`, chosen by the client per device tier); a 1024² one
  for the coarse terrain level on every device (`COARSE_RASTER_PX`, since
  2026-10-10 — 2048² before) and a 512² one for the minimap.
  No raster whose alpha is
  data goes through an image resize any more (the painted splat has the
  only such alpha, and it is made on the GPU). Cost: ~1 m instead of ~0.5 m
  class boundaries on a phone's fine level, ~2 m on the far terrain on
  every device (a pixel or less out there).
- **Buildings** `❝ taken` — CityJSON LoD2 → **build-time** glTF per tile:
  `scripts/bake-city-mesh.ts` runs cityjson-threejs-loader, and
  its `cityMesh` welds it into one mesh with an
  `EXT_mesh_features` feature id per vertex (`_FEATURE_ID_0`) and a roof
  flag. The per-object style (tint, roof colour, base, eave and storey
  heights, glow, roughness) and the demolish tree ride as an
  `EXT_structural_metadata` **property table** (`scripts/tile-glb.ts`); the
  client packs it into an RGBA32F texture the clay node reads with
  `textureLoad`
  (`lib/city/city-mesh.ts` `packObjectTexels`), so the style lives once per
  building, not once per vertex. Footprints go to `footprints_<tile>.json`
  for the minimap (which draws the bridge decks from each tile's `bridge`
  file too, in the colour of the class they carry — the class raster
  shows the river under them). Demolish = filter the building tree out of the index
  buffer + rebuild the BVH; BVH picking/collision, each tile's BVH built
  when a ray first reaches it (`ensureCityBvh`, plan 069,
  [ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)), not as it
  lands. `city-layer.ts`. The DOP
  roof LUT is folded in at bake time.
- **Small structures from the laser scan** `◎ detected` (plan 034) — what the laser saw
  2–6.5 m above ground and LoD2 does not carry: garden and allotment
  houses, sheds, carports, container buildings, pavilions, and parts of
  larger buildings the LoD2 lacks. `pipeline/bake/small_buildings.py` on
  the 0.5 m scan rasters (`lsc.py`): candidates outside the LoD2 (+1 m),
  mapped walls and bridge decks, off rail/road/water (classes 5/7/8); the
  **core** = cells with no multi-echo return in their 3 × 3 window (in the
  leaf-off flight vegetation splits the pulse, a roof does not — but a
  roof's *edge* does, so the plan's blob-wide "multi-echo ≈ 0" rule found
  4 blobs on the spawn tile, the per-cell rule 130, none of them touching
  a crown); cores ≥ 4 m² grown back one cell, kept at 6–150 m² with a
  planar top (residual < 0.35 m, tilt ≤ 35°), filling > 60 % of their
  minimum rotated rectangle, ≥ 2 m wide, NDVI ≤ 0.25 (a clipped evergreen
  block is flat and single-echo too), not a roof-edge sliver (aspect ≥ 3
  with ≥ 20 % of its rim on the LoD2), not vehicle-sized (2–2.8 × 4.5–18 m,
  < 4.2 m) unless an OSM building outline confirms it. **What the flight
  saw that day only** is left out through OSM: pedestrian areas and
  squares (the Christmas markets were up on 27–30 Nov 2024 — the Altmarkt
  alone held 101 blobs, the Neumarkt 39, the Stallhof 11, Prager Straße
  28), within 6 m of a pedestrian street's line, marketplaces, building
  sites and surface car parks; monuments and stop shelters (other layers
  draw them) within 3 m. Each is its rectangle with `z` (lowest ground),
  `h` (the fitted top's median above it) and, tilted > 8°, `hc` (a pent
  roof's corner heights) → `data/<site>/dlm/smallbuild_<tile>.geojson` (the provider's credit).
  **6 625** on the fifteen tiles (703 pent roofs; the first bake shipped
  6 783 of 8 168 before the OSM context), the allotment colonies most of
  them. `bakeCityMesh` appends each
  as a closed box (`lib/city/small-buildings.ts`, sunk 0.2 m) — its own
  object and root (demolish, picking, collision and the minimap work
  unchanged), `building` true, the wall tint hashed from its first corner,
  its DOP roof colour where in sun, else the flat-roof slate palette, no
  glow, no storey band, `source` = 1 in the
  property table (0 = LoD2). +3.3 % city glTF. **Review fixes (2026-09-26):**
  the bake reads 40 m of the neighbours' scan and layers across each seam
  and keeps a structure on the tile holding its centroid (27 now straddle
  a seam; before, a blob touching the edge was lost on both sides); `z` is
  the lowest ground under the whole rectangle and the DGM1 at its corners,
  and a box over ground falling > 1.5 m is dropped (21 boxes had floated
  > 0.5 m at a corner, the worst 1.74 m; now 1, 0.84 m); of two rectangles
  overlapping > 0.5 m² the larger stays (43 z-fighting pairs → 0); the
  canopy and scan points in or within 0.5 m of one are dropped at build
  time (1 232; see *Canopy fill*). Gate (phase 0): 16 of 20 sampled on the spawn tile are
  structures against the DOP (March 2024; the misses two roof-edge slivers,
  now ruled out, and a shadow). Unverified on a real GPU. Remaining
  temporaries: 3 probable stalls on the Schloßstraße pavement (a living
  street), container stacks in the Alberthafen.
  **More sites (2026-09-30):** Saxony's scan is now fetched and baked
  (`bun run fetch <site> --lsc`) for Meißen, Grimma and Leipzig too
  (Meißen: 475 small structures; Leipzig: 1 303), and NRW's
  "3D-Messdaten" for Unna (1 596 small structures, 2 385 extra crowns)
  (the same AdV classes, 2 ground / 20 non-ground; `providers/nw.py`
  merges the four 1 km LAZ of a tile, see *Hedges* below), and (2026-10-01)
  the LDBV's laser points for München (526 small structures: 147 / 88 /
  168 / 123 in tile order 32690_5334, 32692_5334, 32690_5332, 32692_5332;
  32 552 extra crowns), its classes mapped
  to AdV with buildings (6) kept in the non-ground class, so the sheds'
  roofs are in the surface (`providers/by.py`, see *Hedges*). The rules
  were tuned on Dresden's flight alone.
  **In the photo's shadow** (2026-10-21, G28): a candidate whose DOP
  luminance median is under 45 must fit its plane to < 0.2 m and fill
  > 75 % of its rectangle — a crown's or a house's shadow on a courtyard
  read as a shed. Unna 877 → 872, München 599 → 542 (about half of the
  München drops look like shade in the orthophoto, some like courtyard
  roofs).
- **Structures beyond LoD2: columns** `◎ detected` `❝ taken` (plan 050,
  [ADR 0036](./adr/0036-lod2-roofs-that-miss-the-scan-are-rebuilt.md)) — the chimneys,
  towers, masts, water towers, communications towers and lighthouses the
  LoD2 leaves out. `pipeline/bake/structures.py` reads DOM1, DGM1 and the
  burned LoD2 roofs over the tile and a 60 m margin at 1 m and takes
  `gap = DOM − max(DGM, LoD2 roof)`; an OSM `man_made=*` of those kinds
  (point or outline) is kept where the gap within 6 m (2 m of an outline)
  reaches 5 m and the structure 8 m. Axis at the gap's peak, foot at the
  lowest ground there, height the DOM's — OSM's `height` where the DOM
  undershoots it by more than a quarter (a lattice mast); radius from the
  outline, OSM `diameter` or the gap blob low down, a chimney at least
  h/24 (a 1 m surface model sees a slim shaft too thin: Unna's 48 m
  Lindenbrauerei chimney, the "Fibonacci-Reihe", measured 1.7 m), clamped
  per kind, tapered per kind. **Nothing is added from the surface model
  alone** (🗃️ below). **Nor twice**: a tower, lighthouse or water tower
  (`BUILT_TOWERS`) whose mapped foot lies under a LoD2 roof is LoD2's own
  — a church's or a castle's tower is in the building mesh already, and a
  lathed column inside it doubled it (Meißen's cathedral towers, 81 and
  83 m, Grimma's churches, 13 of Munich's 14 towers); masts and chimneys
  on a roof are not in LoD2 and stay (🗃️ below). `lib/city/structures.ts` lathes each from its
  kind's ring profile (16 sides: a chimney's head band, a TV tower's
  cabin and antenna, a water tower's tank on a slim shaft, a lighthouse's
  lantern); `bakeCityMesh` appends it (`appendGapStructures`) as an object
  of its own, `source` = 2, not a `Building` (the HUD's count stays
  houses), chimneys, towers and lighthouses in the brick palette, the head
  in the wall's tint (no terracotta cap); clay, shadows, picking,
  collision, demolish and the minimap as for any building. 386 on the
  seven committed sites (2026-09-28; Dresden 180, mostly masts and
  chimneys). → `data/<site>/dlm/structures_<tile>.geojson` (ODbL); a site
  without a surface model writes an empty file. Look unverified on a real
  GPU.
- **Structures beyond LoD2: missing buildings** `◎ detected` `❝ taken` `= computed` (plan 050) — the
  buildings OSM maps and LoD2 does not carry yet (LoD2 is a year or more
  behind; the newest buildings of a city are the usual case): an OSM
  building outline or `building:part` ≥ 40 m² (not `roof`, `carport`,
  `construction`, `ruins`, underground or on a negative `layer`) that
  LoD2 covers < 20 % and the surface model fills (≥ 2.5 m above ground
  on ≥ 60 % of it), extruded from its lowest ground to the 60th
  percentile of the measured height (the mass, not its antenna) — or to
  **OSM's height** (`height`, else `building:levels` × 3.2 m) where the
  model was flown before the building stood: it measured under 60 % of
  that and at least 1.5 storeys short, or did not fill the outline at all
  (Hamburg's DOM1, 2022-11-21, saw the Überseequartier as shells: The
  Lyte 21.6 → 51.2 m). Not where OSM dates the building before 2010,
  where the model does not fill it and OSM maps it under two storeys, or
  where DOM1 covers < 95 % of the outline (the site's edge, where nothing
  says the flight predates it); a building OSM maps no height of needs the
  model. Such a building carries `src: "osm"`, and its card says the
  height is OpenStreetMap's. A part OSM lifts off the ground
  (`min_height`, else `building:min_level` storeys) starts at that floor
  (`base`): a bridge between two buildings, an overhang. Outlines
  overlapping one already taken by more than half are left out (a block
  mapped over its own parts). The canopy's trees inside a missing
  building are dropped at build time (`lib/city/roof-trees.ts`
  `gapRoofs`): DOM1 − DGM1 there was the building, or the shell, never a
  crown. Flat roof (or the measured roof's shape, below), its DOP roof
  colour where in sun, else the slate palette, storey bands from that height,
  `source` = 2, `building` true. Same bake and build as the columns. 866
  on the seven committed sites (2026-10-21; Dresden 369, Leipzig 235, of
  them 50 at OSM's height, Hamburg 81, of them 21: The Lyte 51.2 m, Luv
  44.8 m, LEE and The Yard 16.0 m). Windowless; a tower inside its podium
  may leave coincident walls.
  **Roofs from DOM1** (2026-10-21, G27): a missing building the model
  measured (not at OSM's height, not lifted off the ground) takes its
  roof's shape from it the way `roofs.py` rebuilds a LoD2 roof
  (`shaped_roof`): flat levels and measured faces as `parts`
  (`[{coordinates, z, surface?}]`), written where the model holds two
  levels or more or a face and misses the scan on at most 30 % of its
  cells (`roofs.KEEP_SHARE`); the build draws them as a measured roof
  (`shapedGap`, `measuredRoofMesh`), else the flat box stands. Shaped:
  Leipzig 17, Dresden 13, Meißen 9, Unna 4, Hamburg 3, Grimma 3,
  München 2. **A lattice is no roof** (2026-10-21, `structures.lattice`):
  a measured level with no face of its own that stands more than 6 m over
  the building's height, where fewer than 40 % of the surface model's
  cells lie within 1.5 m of its top, is a mast, a crane or a floodlight,
  and stands on the highest level below its top that 40 % of the cells
  lie within 1.5 m of (`solid_level`: a roof), or at the building's height
  where none does. *(The Rickmer Rickmers' masts stood as 25 m towers on
  its hull, Dock I's cranes 11 m over the dock, Leipzig's Paralympische
  Sporthalle a floodlight 50 m up. The median of the cells below the top,
  tried the same day, stood the ship's masts as 24 m blocks again: its
  rigging reads at every height from the deck up.)* Nine levels on the
  seven sites.
- **Roofs on posts** `◎ detected` `❝ taken` `= computed` (2026-10-21) —
  a platform roof, a fuel station's canopy, a carport, a bus shelter: a
  roof with nothing under it but its posts. `structures.py` takes an OSM
  `building=roof` or `carport`, or an `amenity=shelter` that is not a
  walled hut (`shelter_type=basic_hut`), ≥ 12 m², that LoD2 lacks
  (< 20 %) and DOM1 shows as a level surface: ≥ 60 % of its cells ≥ 2 m
  up, their middle half within 1 m (a crown over a carport is a dome), at
  most 4.5 m (carport), 6 m (shelter) or 16 m (roof) over the ground
  (higher is a tree over it). Its top is the 60th percentile of the
  surface there (`kind: "roof"`). `lib/city/open-roofs.ts` draws it as a
  slab under that top, 0.04 × √area deep within 0.2–0.7 m (`roofDepth`),
  on 0.3 m posts (`roofPosts`): a roof under 5 m wide on both long edges,
  a post every 4 m at most; a wider one on rows under its middle, one row
  per 10 m of width, a post every 8 m along — a platform roof's centre
  posts, a fuel station's two rows; only posts 0.4 m inside the outline
  stand. `building` false, the flat-roof palette, no windows or doors. 289
  on the seven committed sites (Dresden 187, 26 892 m², the Hauptbahnhof's
  forecourt among them; Leipzig 36, Unna 18, of them seven platform
  roofs, 1 627 m², 5.8–6.0 m up — LoD2 carries none of the
  railway's; Hamburg 26, München 15, Meißen 4, Grimma 3). Flat; the
  canopy's trees under one are dropped at build time like a missing
  building's.
- **LoD2 Überdachung opened** `= computed` (2026-10-21) — LoD2 draws
  the ALKIS roofs on posts (`51009_1610` Überdachung, `51009_1611`
  Carport) as solid blocks down to the ground: a platform under one
  vanished, a fuel station's pumps stood inside it.
  `scripts/bake-city-mesh.ts` (`withOpenRoofs`) cuts their walls to a
  fascia as deep as the slab above, drops the floor and adds an underside
  and the same posts, where at least 1.8 m stays clear (a bin shelter or a
  cellar entrance under that reads as well as a block); they take no
  windows (`WINDOWLESS`). Opened on 2026-10-21: München 913 of 989,
  Hamburg 356 of 368, Unna 524 of 536; Saxony's LoD2 carries no roofs at
  all.
- **Landmark roof relief** `◎ detected` `= computed` (plan 050) — a landmark's roof form that LoD2
  flattens: on the LoD2 objects of a Wikidata landmark (below) only,
  where DOM1 stands ≥ 3 m above the object's highest LoD2 roof on ≥ 60 m²
  (and ≥ 2 % of its footprint), the excess as a **height field**: per
  connected patch (≥ 6 m²) its outline and the 1 m grid of the surface
  model's heights above that highest roof (`grid`: the north-west corner
  `x`, `y`, `res`, `cols`, `rows`, `z` row by row, −1 outside the patch),
  lightly smoothed — half the measured cell, half a Gaussian (σ = 1 cell)
  normalised over the patch alone, so a tip keeps its height and the 1 m
  cells stop reading as steps. `lib/city/structures.ts` `reliefMesh` builds
  a surface from it, each corner the mean of the patch cells around it,
  with walls along the patch's edge down to **the roof under each cell**
  and no bottom face (it rests on the roof it was measured above) — the
  measured roof, not an invented shape. *Floor* (2026-10-01): the grid
  carries `floor` per cell (m relative to `z`, ≤ 0, at least 0.5 m below
  the cell's top): the lowest LoD2 roof in the 3 × 3 cells around it —
  roof cells only, so at the footprint's edge the ground does not pull a
  wall down along the LoD2 facade — sunk `FLOOR_SINK_M` = 0.3 m so the
  roof's slope inside a cell leaves no slit. *Voids*: a surface-model
  cell more than `VOID_M` = 1 m below the LoD2 roof under it is no
  surface (the laser saw through a sound opening, glass or dark slate)
  and is filled from the nearest measured cell (`fill_voids`) before the
  excess is taken. The case: Unna's Evangelische Stadtkirche — LoD2 draws
  the church as one gabled block (ridge ≈ 137 m, eaves ≈ 122 m), the west
  tower (walls ≈ 147 m, spire ≈ 187 m) is only in DOM1; the relief used to
  hover at the ridge height with its walls ending in the air beside the
  slope, and the voids tore "legs" into it. A file without `floor` builds
  every wall down to `z`, as before. The Elbphilharmonie is LoD2's flat 96.3 m block; the
  DOM reaches ≈ 109 m over its crests, which now roll; a spire LoD2 cuts
  short rises to a point (Unna's Stadtkirche: LoD2 stops at 137 m, the
  surface model at ≈ 178 m). *(Until 2026-09-30 the excess was stacked
  slabs, one per ≥ 2 m band — 🗃️ below.)* A relief (`kind: relief`, `of`:
  the host object) copies its host's row — tint, roof, flags, root — so it
  wears the building's look and demolish takes it along; no footprint of
  its own. Not on ordinary roofs: there the excess is antennas, dormers,
  lift housings and trees. Thresholds tuned on synthetic tests and a
  handful of real cases (plan 050's findings); a site whose `landmarks`
  step has not run has no relief (run `landmarks` before `structures`),
  and a relief without a `grid` (a file baked before the height field)
  builds nothing.
- **Roofs rebuilt from DOM1** `◎ detected` ([ADR 0036](./adr/0036-lod2-roofs-that-miss-the-scan-are-rebuilt.md))
  — a LoD2 roof that misses the surface model is drawn in the form the
  scan shows, inside the object's own footprint: flat levels where the
  scan is flat, its measured surface where it slopes or curves (since
  2026-10-03; first as stepped flat blocks only — 🗃️ below). The fault: the
  2025 edition's `tdcFreeFormRoof` (10 305 objects) is, on a complex
  building, often a handful of non-planar facets over the whole footprint —
  the Westin Bellevue (`DESNATPU1000GHDs`) was three facets rising from 7 m
  at the eaves to a 25 m peak, a tent over a slab, wings and two
  courtyards; and buildings finished after the LoD2's roofs were
  measured (2016 here) stand as 3 m placeholders (a block on the
  Ferdinandplatz: 3 m, 19 m in the scan). `pipeline/bake/roofs.py`: each
  building's roof burned at 1 m with its vertices' own heights (as the
  loader draws it; cells under another object's higher roof are not its
  own); a candidate when ≥ 150 m² and > 40 % of its cells (one inside the
  edge, NDVI ≤ 0.3) stand > 2 m off DOM1 — unless its form holds
  (`form_holds`, 2026-10-03): it rises ≥ 3 m, the scan follows it
  (Pearson r ≥ 0.85), it misses on ≤ 20 % once shifted by its median
  offset, and that offset is under the form's own height; the
  Frauenkirche's modelled dome (r 0.90, 5.6 m under the scan) is kept so.
  **Missing on > 20 %, up to 40 %** (since 2026-10-21, `level_share`,
  `pitch_holds`): a candidate only where the scan rises < 0.15 m per metre
  under ≥ 60 % of the missed cells (a step's edge aside) and the LoD2's
  pitch is not confirmed — the LoD2 rising > 0.15 m/m on ≥ half the cells
  and the scan on ≥ half of those keeps it. The 40 % had left the low
  hipped roofs the 2025 edition models over Leipzig's department stores
  (a quarter of the roof off, along the ridges, over a level roof: 5 667
  m² on `DESNATPU1000Bk2M`) and many flat roofs a storey off on part of
  them (Hamburg's); the pitch test keeps a row house's gable or a barrel
  vault whose flanks are too narrow for faces, which a rebuild would have
  drawn flat for an annex the LoD2 left out (checked against the DOP on
  Hamburg's and Dresden's largest and a random draw).
  **The decision** is made on the
  flat model: DOM1 3 × 3-median filtered over the footprint, cut into 1 m
  bands, pieces < 20 m² into the neighbour closest in height, neighbours
  < 1.5 m apart merged, each region at its median; kept only when it
  misses on ≤ half the LoD2's share and ≤ 30 % (the hotel: 78 % → 3 %),
  not where the scan sees open ground on > 15 % of the footprint (a block
  torn down since: the footprint is out of date too). **What is drawn:**
  the same scan split into its *faces* first — cells rising > 0.15 m per
  metre (8.5°) over a patch ≥ 10 m across (a disk-shaped opening: narrower,
  the scan's metre of blur at each edge rounds a slope into a blanket — the
  Westin Bellevue's slab did at 5 m — where its few levels read better), or
  > 0.5 m per metre (27°) over a patch ≥ 5 m across (since 2026-10-20: a
  mansard's or a hipped roof's flank, which as levels read as a flight of
  1 m terraces — the Schauspielhaus; a slab edge's blur is a step, never
  this steep over 5 m), the 1–2
  cells of a ridge or valley closed in, never a cell beside a step of
  > 2 m between neighbours (`inclined_cells`, `step_cells`) — and the
  rest banded and merged as above; faces never merge by height, and a
  part that holds no disk 7 m across (a step's flank, a parapet run, a
  plant room) joins the neighbour closest in height when that lies within
  3 m (since 2026-10-19; a cell or two wide before — the strips stood as
  boxes), unless that makes the drawn roof miss on more than half the
  LoD2's share or 30 % (since 2026-10-21; 30 % alone before): a hall's
  monitor roofs, 5 m strips 3 m over the rest, had merged into blocks
  that missed as much as the LoD2 (5 of the 109 rebuilt objects on
  33408_5654, one of them worse than its LoD2) — they stay strips;
  where the faces then still miss more, the flat model the decision was
  taken on is drawn (13 objects over five cities, one in München whose
  LoD2 missed on 88 %).
  A face's surface is the scan on its face cells (pieces it took in filled
  from them), smoothed twice by an edge-preserving Gaussian (σ 1 cell, 1 m
  height σ); written as a 1 m grid in cm from the part's `z` (its median),
  two cells past the outline and carried on there on the face's own local
  plane. Polygonised from the labels smoothed by a 2 m majority (twice:
  a border diagonal to the grid no longer a staircase of 1 m teeth),
  `coverage_simplify` 2 m, clipped to the footprint,
  parts under 2 m dropped → `data/<site>/dlm/roofs_<tile>.geojson` (Polygons
  with the object `id`, the roof `z` and, for a face, its `surface`; the
  provider's credit). **1 081 objects on Dresden's fifteen tiles, 2 755
  parts, 222 of them faces** (2026-10-21; 886 objects, 2 227 parts before
  the band below 40 %; 2 956 parts before the strips merged; the
  Altstadt most); the step runs on every site — Hamburg 587 objects (365
  before the band), Leipzig 357 (269), Unna 61 (43), Meißen 56 (46),
  Grimma 17 (13), München 121 (120).
  `bakeCityMesh` (`withMeasuredRoofs`, `scripts/measured-roofs.ts`) drops
  the object's LoD2 triangles and stands each part from the object's
  lowest LoD2 vertex — a flat part as a prism, a face as an error-bounded
  TIN of its grid (Delatin, 0.25 m) whose inner vertices are triangulated
  with the outline's points where the height along it bends (Delaunay,
  the outline's edges enforced by splitting), its walls on those same
  points, shading with normals smoothed over the face but not across a
  crease of > 30° (a ridge stays sharp) — same object id, so the table row, picking, demolish, collision
  and minimap stay; eave and storey rows follow the new shape, and the
  card says *geformt wie gemessen* where a face is part of it
  (`MEASURED_SHAPE`). The rebuilt objects' triangles: 215 k before and
  after on the site (a face's TIN costs what its terraces did). The sky-view and horizon bake
  (`skyview.py`) burns the rebuilt parts — flat tops, faces on their grid —
  in place of their objects' LoD2 surfaces, so the far shadows match the
  mesh (`roofs` runs before `skyview`). Limits: a face is the scan's,
  smoothed: a sharp ridge reads rounded over a metre or two, a dormer or a
  chimney is smoothed away; a face's TIN keeps its 0.25 m lumps, which the
  smoothed shading hides more than it removes. Judged in headless
  SwiftShader renders only (before/after), not on a real GPU.
- **Ground-clamp** `= computed` — the loaded terrains' grids (fine level first) sampled to
  seat trees, lamps, monuments, rails, walls and the player on terrain.
  `lib/city/ground-clamp.ts`, `heightAt` in `create-app.ts`.

### Building detailing (all keyed off CityJSON attrs + the loader's `surfacetype`)
- **Per-building clay tint** `≈ assumed` (*Farbvariation*) — deterministic `hash(objectid)` +
  `function` family + `measuredHeight` nudge → muted per-building wall colour.
  **Source preference:** real per-building colour *(planned: DOP)* would replace
  the hash; the hash exists precisely so the look survives when `function` is 86 %
  "unspecified". **Palette:** `"render"` (sand, ochre, soft terracotta
  plaster) or `"brick"` (four clinker swatches from orange brick to dark
  red-brown plus one pale render; in a brick context every building is
  brick, civic ones too — Hamburg's schools, the Kaispeicher: 471 objects,
  Dresden 14, München 9; 2026-10-21, G24/G25 —, while structures that are
  no building, a non-`31001` function — tanks, canopies, towers — keep
  their cool stone), chosen per building by its **facade context** (below) — no longer per
  site. The brick swatches are saturated because the shader mixes them
  60 % into the pale clay in linear light, where they land on a washed,
  dusty brick. `lib/city/building-tint.ts` (at bake time, into the
  property table's `tint`), `visual-style.ts`.
- **Facade context** `≈ assumed` (*Farbvariation*; 2026-10-01, ADR 0012) — the walls a
  building without a mapped material wears: what its OSM neighbourhood is
  mapped as. `osm_buildings.py` `apply_contexts`: every OSM outline with a
  wall material votes — brick for brick; plaster, stone, concrete and wood
  against it; glass and metal (curtain walls) not at all — weighted by
  1 / (distance + 50 m) within 300 m of the LoD2 object (`local_contexts`,
  ≥ 6 votes); with fewer, the tile and ≈ 350 m around it vote
  (`area_context`, ≥ 20 votes), else plaster. Brick wins at ≥ 50 %. The
  file carries the tile's vote as a top-level `context` and an object's
  own `context` only where it differs (`meta.objects_context` counts
  them); an object with a mapped material keeps its own. The build passes
  the tile's context (`prepare-data.ts`), `bake-city-mesh.ts` uses
  `look.context ?? facades`, and a part inherits its root's
  (`inheritedLook`). Mapped wall materials in the baked files: Hamburg
  106 brick / 11 plaster, Unna 45 plaster / 0 brick, Munich 272 plaster /
  38 brick, Dresden 866 plaster / 246 brick. Hamburg's four tiles vote
  brick, and 128 objects on 32564_5934 whose neighbourhood is mapped
  otherwise wear plaster; HafenCity's mapped glass keeps its own
  material (glass does not vote, so its unmapped neighbours follow the
  brick around them).
  Replaces the per-site `Site.facades` switch (🗃️ below). Not yet judged
  on a real GPU.
- **Rounded walls and roofs** `= computed` (2026-10-19) — LoD2 draws a
  curved wall or roof as flat facets a few metres wide (the Kathedrale's
  apses turn 10–20° a facet, the Frauenkirche's drum 20°, the domes of
  the Frauenkirche, the Yenidze and the Kunstakademie); shaded flat, each facet caught its own share of the sun
  and the curve read as light and dark stripes. The bake now gives every
  triangle corner the angle-weighted mean of the faces meeting at its
  point within 30° of its own (`lib/city/crease-normals.ts`; the measured
  roofs round their faces at the same 30°, ADR 0036), per object, walls
  apart from roofs, only between facets no wider than 8 m in plan that
  lean to about the same side; a measured face keeps its own normals.
  Corners of 45° and more (an octagonal tower, a house, the eave), a
  plain wall's slight kink and a low gable's ridge stay sharp. Only the
  lit shading changes: the clay lays its windows, relief and glow cells
  in the facet's own flat plane (`normalFlat` in `visual-style.ts`), and
  a facet turned from the sun takes none, since the buildings cast with
  their back faces and its shadow-map depth is its own. The welded tiles
  are smaller: Dresden's city glTF 70.5 → 63.6 MB gzipped.
  `bake-city-mesh.ts` `vertexNormals`.
- **Roof colour** `= computed` `≈ assumed` (*Dachfarbe*) — real **DOP-sampled** colour per building when
  available (`roofColor()` + the per-tile LUT, ~83 % coverage), else the
  synthesized palette (`surfacetype==RoofSurface` + `roofType` / `Dachneigung` →
  terracotta pitched / slate flat). Bake: `pipeline/bake/roof_colour.py`.
  The colour is read from the orthophoto's **sunlit texels only**, face by
  face (`pipeline/bake/dop_light.py`, 2026-10-19): the DOP is flown in sun,
  and a face turned from it or shaded by a neighbour reads three to five
  times darker and bluer than its tiles — one median over a whole roof had
  painted the Frauenkirche's dome slate grey, half the Altstadt's red roofs
  brown and the Taschenbergpalais' red mansard slopes the grey of its zinc
  top. A texel is in shadow when dim and blue (B > 1.3 R under luminance
  110, or under 40), and a whole face is when the sun meets it at a
  cosine under 0.17 (red tiles in skylight alone pass the blue test); the
  flight's sun is the one whose shadows of the LoD2
  roofs over the DGM best match the image's near the roofs, **searched
  only along the flight day's solar path** (2026-10-21, G2): the fetch
  writes the days a tile was flown from the provider's DOP metadata
  (`dop/<tile>.flight.json`: GeoSN's download-link service, Hamburg's AdV
  metadata per 1 km, Bavaria's and NRW's DOP info WMS; Berlin none, which
  keeps the old whole-sky grid), and the sun is scored every 10 min of
  that day, then every 2 min around the best, at the elevation the clock
  gives (`dop_light.estimate_sun`) — Dresden 38.5–38.7°, 173–184° (a
  whole-sky grid had fitted 33416_5654 at 29° and Grimma's 33342_5678 at
  23° under a 38.5° and a 40° sun, 🗃️ below). Flight days: Dresden
  2024-03-19, Leipzig 2025-03-09, Meißen 2024-04-07, Grimma 2025-04-04,
  Hamburg 2024-05-08, München 2024-08-24, Unna 2025-03-19. A fit whose
  shadows hardly prefer their sun to the opposite one (contrast < 2.8,
  `MIN_SUN_CONTRAST`) takes the sun the flight's sure tiles agree on
  together (`pooled_sun`: Dresden's 33416_5656, all fields to its east,
  33416_5658 and 33408_5654; three of Leipzig's tiles), else none. A
  flight whose sun-and-sky over sky alone is under 2 (`OVERCAST_RATIO`;
  Meißen's 1.87) is read as overcast: no face scaled by its slope, none
  dropped as turned from the sun. The tile's own unsure fit still finds
  the roofs' lean (`lean_sun`). The file's `meta` keeps `flight`,
  `sun_from`, `overcast`, `lean_sun`. Roofs changed by more than 6 sRGB
  steps: Dresden's 33416_5654 (own fit, 172.9° / 38.5°) 44 %, 33416_5656
  (pooled) 58 %, Grimma's 33342_5678 (146.7° / 40.1°) 58 %, Meißen
  (overcast) 65 %, the well-fitted tiles 3 %. *Watch:* on Meißen the
  faces read apart rose 1 987 → 5 875 — striped roofs, unless faces get
  no colours of their own under an overcast flight. Each sunlit texel is scaled by its face's slope to
  how a flat roof in that sun reads it (0.7–1.4), so a roof's faces turned
  to and from the sun come out alike. A building's colour is its faces'
  sunlit texels together (the old median where fewer than 12 are lit); a
  face with ≥ 12 sunlit texels and a quarter of it in sun takes its own
  where it differs from the building's by more than 6 sRGB steps
  (`faces`, keyed by the loader's geometry and surface ids), carried in the
  roof vertex's free `_FACADE` slots — no vertex buffer more.
  **One flat roof is one roof** (2026-10-21, `_planes`): faces whose
  normals agree within 0.05 and whose planes lie within 0.3 m, touching at
  a corner, are read together and take one colour; a rebuilt part stays
  its own. *(LoD2 splits many a flat roof into pieces, and each piece read
  alone took the colour of what stood on it: Leipzig's department stores
  read from above as pyramids of three shades.)* **A face's own colour is
  read from its core** (2026-10-21, `_face_mask`): its texels two in from
  its drawn edge, so a face too narrow to have one — a coping, a parapet's
  top, a gutter strip — reads no colour of its own and takes the
  building's. *(Three to four in a hundred faces read apart were such
  slivers, coloured by the street or the neighbour's roof beside them.)*
  The face is drawn with an empty margin, so one along the building's edge
  is eroded there too (the filter repeats an image's edge, and the eave
  and the coping kept their outer texels). Faces read apart, both changes
  together: Dresden 38 730 → 33 818, Leipzig 10 741 → 9 157, Hamburg
  8 302 → 7 805, München 45 120 → 42 821, Unna 7 749 → 7 067, Grimma
  4 183 → 4 013, Meißen 5 847 → 5 365. A roof drawn
  as its measured parts (ADR 0036) is read part by part instead of by its
  LoD2 faces (`parts`, keyed by the part's index in the roofs file; the
  `roof-colour` step runs after `roofs`): LoD2 often lays one flat lid
  over a whole block of red tiles, zinc and courtyards (the Neumarkt's
  quarters, the Schauspielhaus), and one colour for all of it read as
  beige or brown. Where the fetch has DOM1, a face more than 4 m over the
  ground is read only where the surface model shows its roof (at least
  half way up from the ground to the face), so a street, forecourt or
  courtyard inside its outline drops out.
  A roof face is read where the image shows it: the DOP leans a roof off
  its outline by its height times the strip's off-nadir angle (Dresden up
  to 0.15 m per metre, a 30 m roof 4–5 m), so `dop_lean.py` fits that
  lean on a 125 m grid from how well the tall roofs' expected shading
  (bright to the sun, dark from it) matches the image, and each roof's
  rings are shifted by it before they are read. A wall at most 1.5 m tall
  standing on its building's roof (a step between roof levels, a parapet,
  a dormer's cheek) is drawn as roof (`withRoofSteps`): as sunlit plaster
  with an eave stroke it read from above as a white dash. A gable is not
  (a triangle, one top corner over a level foot at the eave, where the
  dataset keeps it apart from the wall under it): on a shallow roof the
  rule had coloured 362 gables of 5 m and wider as roof on Meißen's tile,
  173 on Dresden's spawn tile.
  Every flight's photo is first taken to Dresden's colour balance
  (`pipeline/bake/dop_balance.py`, 2026-10-20): each flight has its own
  cast, and every colour read off it carried it — Leipzig's photo is cyan
  (its sunlit carriageways read r/g 0.79, b/g 1.15 in linear RGB,
  Dresden's 0.95 and 0.94), so its grey roofs came out blue-green, and
  München's is yellow (b/g 0.82); Hamburg, Unna, Meißen and Grimma lie
  within 8 %. The cast is the flight's, not the asphalt's: the photo's
  grey pixels (its sunlit texels within 12 % of grey) give it to 3 %.
  The site's sunlit carriageways (the class raster's roads, the brighter
  half of their texels, pooled over its tiles) are scaled to Dresden's
  chromaticity per channel in linear RGB, their brightness kept (the
  exposure stays the flight's), and the whole photo goes through the same
  factors before its shadows are found (a blue cast reads as shade).
  Leipzig's factors are (1.24, 1.01, 0.83), München's (0.93, 0.98, 1.12),
  Dresden's 1 within half a percent; the file's `meta.balance` keeps them.
  **On to grey** (2026-10-23): Dresden's balance is its own flight's, and
  that flight is about 5 % green (its sunlit roads r/g 0.95, b/g 0.94),
  so every roof read in it carried a faint green. The roof colours now go on from
  Dresden's balance to neutral grey roads (`dop_balance.neutral_gains`,
  ≈ (1.013, 0.963, 1.026), the brightness kept) — every city's, as every
  flight is first taken to Dresden's. The water's tint and the sports
  grounds' surfaces keep Dresden's balance: their thresholds were
  measured in it.
  **A part raised on another leans with its building** (2026-10-23,
  `bases`): the landmarks' modelled parts stand on each other — a dome on
  its drum, a lantern on the dome (Dresden 190 parts, Leipzig 28; no other
  city's LoD2 stacks them) — and the photo shows them as far off the
  ground as their building. Leaned from their own lowest point instead,
  the Frauenkirche's dome (41 m over the square, 0.13 m/m) was read 5 m
  off its place, on its drum's shade and its lantern, and came out a
  blue-green grey (sRGB 164, 173, 171; now 200, 201, 197, the sandstone's
  light grey); the Yenidze's dark glass dome had read the white drum
  round it. A part whose lowest point lies more than 2 m over its
  building's foot (the lowest point of it and its parents) and over the
  DGM1 under it is leaned from that foot, takes its building's lean and
  measures none (a landmark's dozens of parts outvoted the houses round a
  lean node). A part on the ground keeps its own foot, one on a slope too
  (its foot metres over its building's lowest corner, but on the
  terrain). And any part of a building (a CityJSON `BuildingPart`) not in
  sun takes its building's roof, as a face in shadow does
  (`parts_carried`): none of it lit, or under a quarter of its roof lit
  and read the shadow test's blue there — skylight on a light roof, too
  bright for the test's dimness: the Frauenkirche's corner towers stand in
  the dome's shadow, read 26 of their 959 texels lit and came out sky blue
  (sRGB 100, 150, 171), its lantern and the platform round it slate blue.
  A dark reading stays (the Yenidze's glass dome, most of it dark enough
  to count as shadow).
  **Discontinued** the same day: one colour for a roof's pitched (≥ 20°)
  and one for its low faces (`roofPitched`, a fifth texel band), the first
  answer to the mansards — the face colours cover it, and it still read
  the shaded slopes dark.
  **Sheds and structures, read** (2026-10-21, G5; the bake side): the
  scan's small structures and DOM1's buildings and roofs on posts are read
  the same way — the outline at its top (a pent shed by its corners),
  sunlit texels only, the nearest lean node — into `scan` / `gaps`
  (`[index, z, r, g, b]`, by index in their file and `z`); one in shadow
  gets no row. Unna 32408_5710: 503 of 513 sheds, 20 of 20 structures;
  Grimma 33340: 794 of 804, 53 of 53; München 32690_5334: 130 of 156,
  23 of 23. The build takes a row whose index and `z` match its
  feature's (within 5 mm; `appendedRoofColour`, G2 2026-10-21), the card
  says `dop` or `palette`; one in shadow keeps the slate palette. Meißen:
  460 of 475 sheds and 61 of 61 gap buildings take the DOP colour.
  Before, every shed was slate.
- **Roof vividness** `≈ assumed` (*Dachsättigung*) — raw DOP reads drab/hazy (audited: 38 %
  near-grey, mean R−B slightly negative). `ROOF_VIBRANCE` (**0.5**,
  *Dachsättigung*, fixed) applies a **hue-preserving chroma
  boost**: it lifts each roof's saturation around the grey axis, weighted so
  dull/hazy roofs lift most and vivid ones barely (nothing blows out), plus a
  tiny warm nudge on the muddy greys only. **Keeps each roof's TRUE hue** —
  copper-green stays green, terracotta red, slate cool — curing drabness without
  homogenising toward terracotta. *(Rejected: blending toward a terracotta target
  — it destroyed the ~187 genuine copper-patina-green roofs the DOP captured.)*
  **The clay a roof mixes into is a grey** (2026-10-21, G6,
  `visual-style.ts` `clayColour`): the pale clay at its luminance, warmed
  only as far as the roof is warm (*Dachwärme*, `ROOF_WARM_FROM`/`TO`:
  smoothstep(0.1, 0.4, (R − B) / L)) — the warm clay had turned a cool grey
  roof warm (Hamburg 49 % of them, München 40, Meißen 36, Unna 31, Grimma
  22, Dresden 21, Leipzig 19; now none). At runtime, no re-bake.
- **Storey bands** `❝ taken` `≈ assumed` (*Höhenlinien*) — where OSM counts the storeys
  (`building:levels`, a part's own or its Building's), the walls up to the
  eave divided by that count (`mappedStoreyHeight`), kept when the storey
  comes out 2.4–5.5 m (outside it the count is another part's or a typo);
  else `storeyHeight(measuredHeight)`, whole ~3.2 m storeys
  (`storeysAboveGround` is only ~4 % populated). Spawn tile: 2 172 objects
  on mapped storeys (median 3.67 m, p10 3.06, p90 4.79), 298 back on the
  estimate. None on a facade of its own (flag 512: a church, a palace, a
  hall, a listed public building OSM counts no storeys of, and the parts
  that share it): the 3.2 m estimate drew six lines on the Kulturpalast's
  hall and ten on the Ständehaus, whose storeys are 5–7 m.
  **Storeys from the neighbours** (2026-10-21, G21): where OSM counts no
  storeys (or a count outside 2.4–5.5 m), `osm_buildings.py` writes
  `storey`, the median of eave ÷ `building:levels` over at least three
  mapped LoD2 objects within 200 m with the same roof form (flat or
  pitched) and an eave within max(3 m, 35 %) of its own, else the tile's
  median of its roof form (at least ten mapped); the build splits the
  walls up to the eave into whole storeys of about that, held to
  2.5–4.5 m (`neighbourStorey`), before it falls back on the 3.2 m
  estimate. The card says *von der Traufe gezählt, in der Geschosshöhe der
  kartierten Nachbarhäuser* (`storey: "neighbours"`). Storey counts that
  match OSM's, each mapped building left out of its own neighbours:
  Leipzig 34 → 65 %, Hamburg 36 → 49, München 49 → 63, Meißen 53 → 79,
  Grimma 56 → 84, Unna 84 → 92, Dresden 49 → 75.
- **Gliederung** `≈ assumed` (plinth, cornices, shop zone) — painted in the clay
  shader from heights the object table already carries, no new data: a
  0.6 m stone plinth (the ledges at the first storey line and under the
  eave are modelled now, with the plinth: see *Plinths*), and on a building with
  a mapped shop the ground floor a shade darker as its recessed shop
  front. Walls only, not on a door, and not on a facade that is its own
  (flag 16: a Wikidata landmark, a monumental ALKIS use — church,
  theatre, palace, museum … —, OSM storeys taller than 5.5 m, a hall,
  or a listed public building, OSM `heritage` on an ALKIS `31001_3xxx`,
  whose storeys OSM does not count: a court's or an academy's storeys
  are 5–7 m, and the height's 3.2 m drew twice its rows of windows; a
  part shares its building's where OSM's count does not fit it, the
  Kulturpalast's raised roof; `ownFacade`, `partFacade`), which gets no drawn door either, and not under a flat
  roof (flag 256: three quarters of the LoD2 roof area level — post-war
  slabs and modern blocks have no town house's cornices); the ground floor's three only on a part
  standing on the ground (flag 128: within 3 m of its tree's lowest base,
  so a tower's part on a roof gets no plinth). *Gliederung*, fixed
  at 80 % (`ARTICULATION`). The windows are the clay's too (*Windows on every house*),
  on a gate of their own: a Wikidata landmark's flag alone does not keep
  them off, a monumental use or a hall's storeys do.
- **Plinths** `= computed` `≈ assumed` — modelled, not painted: every open stretch of a LoD2
  footprint edge (its outside not in another footprint, so no party wall;
  1.5 m and longer; objects 5 m tall and more) on the DGM1 read 0.6 m in
  front of the wall and smoothed over 3 m (`pipeline/bake/plinths.py`),
  cut into level pieces wherever the ground under one spans more than
  0.45 m (the steps of a plinth on a sloping street). Each piece's top
  stands 0.9 m over its highest ground, its foot under the lowest. A
  stretch already covered by another object's run (within 0.25 m, running
  the same way: a BuildingPart standing in its Building, two parts on
  one facade line) is that run's, the tallest object's first, so no two
  bands stack. Runs end on the footprint's vertices. The building bake
  lays each piece on its host's LoD2 wall, which stands up to a couple
  of decimetres off the footprint line and is often turned a little
  against it, and bends a few centimetres along a long stretch (rays
  every metre against the host's triangles, the band laid piece by piece
  through them, `wallShiftKnots` — one line fitted through five rays
  sank the 6 cm Gurtgesims into the wall where it bulged; a mitre meets
  where the two shifted walls meet),
  and appends a stone band 7 cm proud of it whose front rolls over a
  12 cm quarter-round shoulder into its top, shaded smooth (no hard
  edge), with square ends (`lib/city/plinths.ts`, `appendPlinths`); the
  pieces that meet round a corner of the footprint (turning up to 135°)
  are mitred into one another on the bisector and share one foot and
  one top, so a corner closes without overlap. One object per host in a
  shade a touch darker and cooler than its tint — the form carries it,
  not the colour (`source` 5, flag 64); not on a
  host that is a landmark, glass, metal, flat-roofed or its own colour,
  lower than 3 m of wall, or standing more than 1.5 m over the ground at
  its plinth (a part on a roof) — the painted *Gliederung*'s gate. The
  painted 0.6 m plinth stays under it, hidden where the band stands.
  Along the same stretches the **Gurtgesims** is modelled too, in the
  same register (`corniceMesh`): level at the first storey line over the
  host's base (where the wall holds two storeys and the line stands a
  metre over the plinth's top), a rounded nose 6 cm proud and 14 cm tall
  over a flat underside, its top washed 3 cm back to the wall, shaded
  smooth; the pieces in line joined into one run, the runs mitred round
  corners; a plaster shade barely off the wall's. The
  painted Gurtgesims is gone: its painted shadow read as a smear. A first
  cut with hard bevels and ends run past each corner read too hard and
  overlapped at corners.
  The **Traufgesims** follows the same stretches under the eave, where
  the host's roof runs level along the wall (`eaveAlong`: the topmost
  roof face just inside the wall at five points, its plane carried out
  to the wall; four of them within 0.3 m — not along a gable), from 5 m
  of wall and 1.5 m over the band below: a quarter-round 16 cm proud
  rolling out of the wall into a short lip, 32 cm tall, its top flush
  with the eave. The painted ledge under the eave is gone: it read as a
  stain under the roof.
  All three **run on from house to house** (`joinStretches`): LoD2's
  footprints stop a few decimetres short of each other and the bake
  leaves a party wall's end out, so a row's bands broke at every house.
  A gap of up to 1.2 m between one stretch's end and the next's start,
  in line (turning by up to 20°, 0.4 m aside), is closed at its middle;
  neighbours whose levels lie within 0.6 m (Gurtgesims), 0.25 m
  (Traufgesims) or 0.2 m (plinth top) take one level, the nearest first,
  so a row on a slope steps where its houses do rather than drifting.
  On the spawn tile 2 439 ends run on, most over gaps of 0.4–0.6 m.
  Dresden: 175 570 pieces on 35 850 objects on fifteen tiles (13 777 on
  3 026 on the spawn tile; the files up to 2 MB each). Ground
  joins: `plinths` in `JOIN_PARTS`, budget 1 %.
  **Cornices only on town houses** (2026-10-21, G19): the Gurtgesims and
  the Traufgesims stand only on a town house — storeys from 3.3 m, listed
  (OSM `heritage`), or a flat-roofed town house (*Windows*, below;
  `carriesCornices`); a post-war house keeps its plinth but has no
  cornices. On Dresden's sample tile 558 bands went.
- **Doors** `❝ taken` `◎ detected` — OSM `entrance=*` nodes on the ground floor (no `level`, or
  one with a 0; not `no`, `entry_only`, `emergency_ward_entrance`) snapped
  onto the nearest LoD2 footprint edge within 3 m (`pipeline/bake/
  doors.py`), with the outward normal; dropped on a party wall (its
  outside lies in another footprint), an edge too short for 0.7 m, or a
  wall too low for the door plus 0.6 m; one door per 1.2 m of wall. The
  sill stands on the lowest DGM1 sample in front of it. The building bake
  lays each door onto its host's wall triangles (`wallShift` in
  `lib/city/doors.ts` — LoD2 walls stand up to ±0.15 m off the footprint
  line, and a wall proud of it swallowed the leaf) and appends a pale
  surround and a darker leaf set back between it, as two objects in the
  host's building tree (`source` 3, flag 64: their tint at full strength).
  Dresden: 6 628 doors on fifteen tiles (3 208 `main`, 2 794 `yes`, 299
  `staircase`), 489 on the spawn tile. Never an invented door: a building
  without a mapped entrance has none. Ground joins: `doors` in
  `JOIN_PARTS`, budget 1 % (the misses are sills at the top of mapped
  steps).
- **Passages through buildings** (*Durchgänge*, 2026-10-23) `❝ taken`
  `≈ assumed` — LoD2 draws every building as a closed shell from the
  ground up, so a gateway into a courtyard, a city gate or the Zwinger's
  passages to its pond were solid wall. Nothing measures one (the surface
  model sees the roof over it; the street photos' poses miss by half a
  metre, Plan 075), but OSM maps them: a way tagged
  `tunnel=building_passage` where it runs through the building
  (`pipeline/bake/passages.py`). Per way on the ground floor (a `level`
  without a 0 or a `layer` above 0 is skipped; `layer=-1` stays) and
  chains of them merged end to end, the stretches inside the tile's LoD2
  footprints (joined across a gap under 2 m, each at least 1 m long, one
  that meets no outline dropped), run on 0.6 m past either wall — but
  where the way ends inside the buildings, more than 0.6 m from their
  joint outline (a drive into a garage, a yard track into its shed), the
  passage ends there and a wall across it shuts it: run on, it had opened
  into the hollow LoD2 shell, and one saw through the building; its width
  from `width` (1.5–12 m), else 3.5 m for a drive, 4.5 m for a track (a
  `railway`, a single track's structure gauge; before, the tracks into
  Dresden's and Hamburg's sheds ran into 2.5 m slots) and 2.5 m for a
  walk; the lowest DGM1 sample within 1 m of each axis vertex as its
  ground. Per LoD2 object the passage's strip reaches — a part of the
  building beside the way as much as the one it runs through, for the
  build cuts every tree the passage runs through and a part cut but not
  lined stood open into its interior — the bake writes the ceiling's
  plan, the walls along it (and across it at a shut end) and its portals
  (`dlm/passages_<t>.geojson`). The
  building bake (`bake-city-mesh.ts` `withPassages`, the geometry in
  `lib/city/building-passages.ts`) gives it its clear height —
  `maxheight:physical` or `maxheight` where plausible, else the larger of
  3.8 m for a drive, 5 m for a track (a contact wire's lowest in a
  structure) or 3 m for a walk and the ground storey less a 0.6 m
  lintel (a palace's 5.5 m storey: 4.9 m), never closer than 1 m under
  the lowest eave over it, none under 2.2 m —, cuts every triangle but a
  roof's of the building trees it runs through to what lies outside its
  volume (a prism per segment, mitred at a bend, from `SINK.wall` under
  the ground to the clear height over it, so it falls with its ground: the
  Zwinger's to its pond falls 4 m), and lines it with walls and a ceiling
  in the host's own clay (`source` 7, flag 64, no windows, no eave);
  where two passages cross or run side by side through one gateway, each
  one's lining is cut out of the other's opening (it had stood across it,
  and the collider blocked the way). The ground floor's windows keep off a portal as off a door (its width up to
  6 m in the door slot), and no OSM door is drawn in an opening. The
  openings are rectangles: no source gives an arch's form. Last of the
  building bake, so a cut piece keeps its wall's place in `_FACADE`.
  Dresden: 482 passages on fifteen tiles (106 on the Zwinger's), Leipzig
  245, München 763, Hamburg 353, Meißen 10, Unna 12, Grimma none.
- **Dormers** `◎ detected` — what DOM1 shows over a pitched LoD2 roof (25–62°) that
  LoD2 leaves out (`pipeline/bake/dormers.py`): the excess `DOM − roof`
  against its own 9 m median, blobs 0.7 m and more over it, 3–30 m² and
  compact, their top 0.9–3.5 m over the roof and under the object's
  ridge, clear of every tree point — a chimney is too small, a crown
  overhanging the roof irregular or too high. Each becomes a front facing
  down the slope, two cheeks and a roof running back into the main roof:
  flat at the measured top, or a **shed dormer** (*Schleppgaube*) falling
  with the main roof (`lib/city/dormers.ts`). Its fall (`tf`) is read
  along its axis through the centre: DOM1 every 0.5 m over the blob and
  up to 3 m behind it while it stands ≥ 0.3 m over the roof, the front
  1.5 m left out (front wall and eave smear it), a line through ≥ 3
  samples over ≥ 1 m. A fall of 8° to the main slope − 8° is a shed
  dormer; its top is then where its roof meets the main roof (under the
  ridge), its front ≥ 0.6 m over the roof. A plane over the whole blob
  read 45 % of Meißen's dormers as shed (front and cheek cells tilt it).
  2026-10-21 (G11): 8–25 % shed dormers per tile (Meißen 15.6, Grimma
  16–25, Leipzig 12, Dresden 11–14, Hamburg 8–10, München 21, Unna
  11–13 %); about half the blobs are under 3 m deep and stay flat. A
  host's dormers are appended as one object in its tint and roof colour
  (`source` 4), no storey band, eave line, plinth or shop zone on it. No window in the front: the veto
  stands. Dresden: 10 514 on fifteen tiles, 862 on the spawn tile.
- **Eave line** `= computed` (*Traufkante*) — cornice stroke at min RoofSurface-Z per building
  (geometry-derived; the attribute is ~4 %).
- **Night light on facades** `❝ taken` `≈ assumed` (*Abendlicht*) — after dark
  (the sun rig's `nightFactor`) a building of commerce or public use
  (`function` `31001_2xxx`/`3xxx`, `buildingGlows`; structures that are no
  building stay dark — 22 % of Hamburg's lit objects were tanks and
  canopies, 16 % of München's; 2026-10-21, G30) is lit from in front,
  never glowing itself: soft cones of
  warm light from the wall's foot every 6 m, about half of them on, gone
  by a storey and a half (*Lichtkegel*, `GROUND_LIGHT`); three in five of
  the landmarks and monumental buildings (flag 16), whole buildings at
  once and whatever their use, floodlit (*Anstrahlung*, `FLOODLIGHT`,
  `isFloodlit` in lib/city/city-mesh.ts): cones every 7 m
  up to the eave over a faint wash, seven in ten on, each a little off
  its slot and of its own strength — every one of them, evenly, was "schick
  aber übertrieben" (the maintainer, 2026-10-20). Lit objects: Dresden
  8 867 → 8 654, Leipzig 3 036 → 2 970, Meißen 563 → 542, Grimma
  401 → 393, Hamburg 3 861 → 3 020 (422 tanks, 373 canopies), München
  6 865 → 5 794 (1 004 canopies), Unna 6 156 → 5 587 (549 canopies). A shop's band (*Ladenlicht*)
  lights two cells in three and none on a landmark: on the Zwinger and the
  terrace parts of the Kunstakademie it lit the low walls all round.
  *Streiflicht* drops to a tenth at night (`NIGHT_RIM`). `visual-style.ts`
  `nightLight`.
- **Dusk glow (whole walls)** 🗃️ discontinued 2026-10-19 — a warm emissive
  wash over every wall of a commerce/public/special building (0.25 at full
  night) plus the full-strength rim: the centre glowed beige from afar and
  every grazing roof shone pale, "Gebäude viel zu hell" (the maintainer).
  Replaced by the light on the facades above; compared at six night views
  against dimming the wash (still a lit block) and floodlighting every
  listed building (too many, too flat).
- **Attributes through the building tree** `❝ taken` — the Saxon LoD2 puts the
  geometry of 7 950 Buildings (fifteen tiles; 7 866 have none of their
  own — 2 391 / 2 327 on the four first) on 24 143 `BuildingPart`s (7 239), and the parts carry no `function`: only the
  parent does. The bake resolves each object's attributes through its
  `root` (the part's own value first, `inheritedAttributes` in
  `lib/city/building-tint.ts`), so
  tint, roof palette and glow see the building's use; heights stay the
  part's own. Before the fix every part read as housing: 1 682 parts of
  338 commerce/public/special buildings were dark at dusk (646 / 177 /
  412 / 447 on `33410_5656` / `33410_5658` / `33412_5656` /
  `33412_5658`). Plan 027 phase 0.
- **Shop fronts at dusk** `❝ taken` `◎ detected` (*Abendlicht*) — OSM `shop=*` and the places to
  eat and drink (`amenity=cafe/restaurant/bar/pub/fast_food/ice_cream/
  biergarten`) on the ground floor (no `level`, or a list with 0), joined to
  the LoD2 footprints by `pipeline/bake/osm_buildings.py`: the footprint a
  point lies in, else the nearest within 3 m (entrances sit on the facade
  line); an OSM building outline carrying one marks the objects it covers
  ≥ 50 %. The bit rides in the property table's `flags` column (band 2's
  free float); the clay shader lays a warm wash under the first storey line
  (soft top edge, walls only, a ≈3.5 m hash along the facade so a long
  front is not one strip) at 0.14 of the dusk glow's strength (`SHOP_LIGHT`) ×
  `nightFactor` (0.4 until 2026-10-19), a shopfront's pane lit
  from inside (`PANE_LIGHT`). No window
  structure (the grid is a recorded veto, 🗃️ below). 1 555 of 1 855 ground-
  floor points placed (per-tile sums); 264–323 objects with a shop per
  tile, 1 188 in all, matched directly — a part also carries its root
  Building's flags (a Saxon LoD2 Building with parts has no geometry of its
  own; `inheritedFlags`, like the attributes), so 2 060 drawn objects show
  the wash (759 / 359 / 513 / 429). STOP check:
  8.2 % of the placed points (2 of a seeded 20) land in a footprint more
  than 20 m from any street centreline (a courtyard building) — under the
  plan's 20 %, so the join stays containment-first. Strength 0.4, **not
  yet judged on a real GPU** (plan 019). Plan 027 phase 1.
- **Listed facades** `❝ taken` `◎ detected` (*Farbvariation*, *Traufkante*) — OSM building
  outlines with `heritage=*` (167 touch the four first tiles) mark the LoD2 objects
  they cover ≥ 50 % (1 302 over the fifteen tiles, 2026-09-26; on the four
  first 842 objects: 478 / 28 / 139 / 197 on `33410_5656` /
  `33410_5658` / `33412_5656` / `33412_5658` — the Zwinger, the Schloss and
  the Altstadt blocks are many parts each; with a root's flag handed to its
  parts, 882 drawn: 513 / 28 / 141 / 200). A barely-there warm lift of the
  wall tint (+3.5 % red at full *Farbvariation*) and a finer second cornice
  line 0.45 m under the eave. The official list (LfD Sachsen,
  *Kulturdenkmale_Flaeche*) is reachable only as a WMS here: a possible
  second source. Not yet judged on a real GPU — off if it reads as
  highlighting. Plan 027 phase 2.
- **Mapped wall and roof colour, wall material** `❝ taken` `◎ detected` (*Farbvariation*,
  *Dachfarbe*; plan 050) — OSM `building:colour`, `roof:colour` (a CSS name
  or hex) and `building:material` / `building:facade:material` /
  `facade:material` (normalised to glass, metal, brick, stone, concrete,
  wood, plaster) on the building and `building:part` outlines covering an
  LoD2 object ≥ 50 % (`osm_buildings.py`; buildings first, then parts, so
  a part's own tags win; a part without its own inherits its root's,
  `inheritedLook`). **Colours are brought into the clay's register, never
  used raw** (`osmColourTint` in `lib/city/building-tint.ts`): hue kept,
  saturation ≤ 0.45, lightness held in [0.45, 0.9] for walls and [0.3,
  0.8] for roofs, plus the palette's per-building jitter — a red wall is a
  dusty terracotta, not a signal red. Walls: OSM colour > the material's
  palette family (brick → brick, stone / glass / metal → cool, concrete →
  neutral, wood / plaster → warm) > the use family (`function`). Roofs:
  DOP colour > OSM `roof:colour` > palette. For a landmark Wikidata's
  material (P186) fills in where OSM names none. Counts per tile in
  `osmbuild_<tile>.json` (`meta.objects_look`).
- **Glass and metal facades** `❝ taken` `≈ assumed` (*Streiflicht*; plan 050) — the material's
  glass and metal set object flags (4, 8; a part takes its root's): the
  clay turns a little cooler (×(0.93, 0.99, 1.07), metal at 60 %) and
  smoother (roughness 0.42 glass, 0.5 metal), and glass mirrors the sky
  (*Spiegelung*, `sky-reflection.ts`: a mipmapped cube map of the sky
  dome, 10 % face on to all of it at a grazing view; metal a third as
  much; fixed at full,
  `REFLECTIONS` — below it the old pale Fresnel³ sheen at the rim's
  strength would show). No panes, no mullions, no texture
  and no drawn windows (*Windows on every house* leaves glass and metal
  plain) — the window-grid veto holds (🗃️ below). `osmColour` / `clayGlow` in `visual-style.ts`. Conservative strengths,
  not yet judged on a real GPU.
- **Landmarks from Wikidata** `◎ detected` `❝ taken` (HUD *Erkunden* → *Orte*; plan 050)
  — `bun run fetch` asks Wikidata per tile (`wikibase:box`, instance of a
  subclass of *architectural structure* Q811979, ≥ 2 sitelinks, top 80;
  height P2048, material P186, building = subclass of Q41176; a box that
  times out is asked again in quarters) → `data/_raw/<provider>/wikidata/
  landmarks_<tile>.json` (CC0). `pipeline/bake/landmarks.py` matches each
  item to the LoD2 objects that draw it — OSM outlines tagged
  `wikidata=<Q>` covering objects by half, else, for a building, the LoD2
  building under its point (root and parts), else the nearest (below) — drops what matches nothing
  drawn (districts, streets, harbours) and keeps, most notable first,
  those with at least `NOTABLE_SHARE` = 8 % of the sitelinks of the tile's
  most notable one (never fewer than `MIN_SITELINKS` = 2; `MAX_PER_TILE` =
  40 is a safety cap, not the rule): a **relative** floor per tile, so
  Unna gets its own (its churches have two sitelinks each; an absolute
  floor gave it one, 🗃️ below) and a dense old town keeps its second rank
  (a fixed 12 per tile cut it, 🗃️ below). → `data/<site>/dlm/landmarks_<tile>.json`. The build flags the
  objects (`OBJECT_FLAG_LANDMARK` = 16; no look of its own), gives them
  the Wikidata material where OSM names none (`withLandmarks` in
  `prepare-data.ts`), and writes the site's twelve most notable into the
  tileset's `extras.landmarks` (`siteLandmarks`) — one per building drawn:
  an item whose LoD2 objects a more notable one already holds is that
  one (the Rüstkammer and the Staatliche Kunstsammlungen in the
  Residenzschloss, the Galerie Neue Meister in the Albertinum), its name
  kept in the host's `also` for the search. The HUD merges them with the
  authored vantages into one list, *Orte* (`lib/city/places.ts`
  `sitePlaces`): a landmark a vantage names — every word of one in the
  other, German endings, fillers, the city's name and Wikidata's
  brackets aside ("Zwinger" in "Zwinger & Semperoper", "Dresden
  Hauptbahnhof" in "Hauptbahnhof") — or one within 60 m of where a
  vantage looking down ≥ 20° looks is folded into that vantage, the rest
  follow the vantages; a click on a landmark glides to an aerial vantage from
  the south-south-west (`landmarkVantage`: altitude clamp(h + 50, 60,
  300) m, pitch −22°, fov 55°). Examples: the Elbphilharmonie (41
  sitelinks, material glass), the Chilehaus (35) and St. Michaelis (27,
  brick) in Hamburg, the Frauenkirche in Dresden, the Lindenbrauerei and
  the Zentrum für Internationale Lichtkunst in it in Unna (Wikidata's
  point lies beside the building: matched to the nearest within 10 m,
  within 25 m only where OSM names it alike — a word not generic shared
  with its OSM name; 2026-10-21, it had taken Krenkelstraße 7 for
  "Mietvilla Krenkelstraße 3"). **What is gone stays out** (2026-10-21,
  G31): the fetch also asks each item's P576 (dissolved/demolished) and
  P5816 (state of conservation) (`fetch_status`, asked apart, so an older
  cache is completed in place, `complete_status`); an item demolished or
  destroyed (P5816, or P576 without a standing state) is matched only
  through an OSM outline tagged with it (`gone`) — its point had flagged
  the building on its site now (Dresden: the Alte Reformierte Kirche on
  the Neues Rathaus's 30 objects, the Gothic Frauenkirche on 59, the
  Opernhaus am Taschenberg on 65, the Palais Brühl, the Sophienkirche;
  München's Braunes Haus among the site's twelve, now the Museum
  Brandhorst). Dresden's listed landmarks 284 → 238, flagged objects
  1 411 → 1 342 (37 demolished items dropped, 13 by the 10 m rule);
  Leipzig 76 → 69, Hamburg 68 → 63 (the Bucerius Kunst Forum, 11 m off,
  is lost), München 124 → 121.
  Districts are kept out by matching only OSM outlines of buildings,
  building parts and `man_made` structures (HafenCity, Wachwitz got in
  through their place outlines before). On a dense tile the floor follows
  the tile's top (2026-10-01): an old town's second rank stays on the
  list beside the Frauenkirche, the Zwinger and the Semperoper, where a
  fixed 12 cut it (Dresden's tiles now list up to 40). The roof relief
  stays with each tile's 12 most notable (`RELIEF_LANDMARKS`): over an
  ordinary villa among old trees the crowns would read as its roof.
  Dresden's Congress Center is not in Wikidata's answer for its tile (the
  query keeps a box's 80 most linked items), so it is still not listed.
  Coverage follows Wikidata's, which varies by city; a site fetched before
  the query existed needs `bun run fetch <site>` again (it only adds what
  is missing) before `bun run bake <site> --step landmarks`.
- **Roughness jitter** `≈ assumed` (*Materialstreuung*) — `hash(objectid)` → roughness
  clamped to [0.55, 1.0] (stays matte).

### The twin: identity, facts and provenance (asked on demand)

The scene says nothing on its own; asked (a click, a long press, `I` under
the pointer), it answers in a card ([ADR 0042](./adr/0042-inquiry-cards-on-demand-facts-in-the-tileset.md),
[plan 052](./plans/052-queryable-twin.md)).

- **Object identity and semantics in the tileset** `❝ taken` — CityJSON attributes →
  ten columns of the building glTF's `EXT_structural_metadata` table
  (`lib/city/object-facts.ts`, `scripts/bake-city-mesh.ts`): `buildingId`
  (the Building's `gml:id`; a part carries its Building's — the Saxon parts'
  `UUID_…` ids are dropped), `function` (ALKIS Gebäudefunktion, the root's
  for a part), `roofType`, `created` (the object's export date, date only)
  as ENUM columns of the codes a tile uses; `height` (`measuredHeight`,
  else the model's top − base), `roofPitch` (`Dachneigung`), `area` (the
  GroundSurface rings' area) as FLOAT32, noData −1. A scan structure
  (plan 034) carries its key, height and area only. The code lists'
  German labels: `lib/city/adv-codes.ts` (AdV CityGML profile). Spawn tile
  +46 kB gzipped (+3.5 %). No look: read one row when asked. Found on the
  way: the bake read the footprints after the CityJSON loader had
  rewritten the document (a Solid's semantic values come back flattened),
  so every Solid lost its GroundSurface — on the spawn tile 2 012 of 2 041
  BuildingParts had no minimap footprint (and would have had no area);
  the footprints are now read before the loader runs.
- **How a building is drawn, and from what** `❝ taken` — the bake's own
  decisions behind the walls, roof, storeys and windows, which the style
  columns carry only as their outcome: where the wall colour came from
  (OSM `building:colour`, else the palette of OSM's `building:material`,
  the neighbourhood's brick, or the use's), the mapped material (or
  Wikidata's for a landmark), where the roof colour came from (DOP, OSM
  `roof:colour`, palette), where the storey came from (OSM
  `building:levels`, the street photos, the estimate from the height),
  where the window rhythm came from (its own walls, another part, a
  neighbour, its type) or why there are none (a facade of its own and
  why — its use or a hall's storeys —, glass or metal, a low wall, a use
  without windows, no window fitting the storey), and the landmark's
  Wikidata item → one ENUM column `drawn` of the same table, a short
  `key=value;…` text (`lib/city/drawn-facts.ts`, `drawnOf` and
  `assignWindows` in `scripts/bake-city-mesh.ts`). The card's *Daten*
  section reads it with the object's style row and lists every drawn
  value with its source, its badge and a link to the place (OSM's objects
  there, Mapillary's photos there, the Wikidata item:
  `lib/city/drawn-lines.ts`, plan 052) — the values as the bake wrote
  them, never recomputed. Added 2026-10-19 so a strange rendering can be
  traced to its source from the card.
- **Names, addresses and storeys** `❝ taken` `◎ detected` — OSM building outlines (`name`,
  `addr:street` + `addr:housenumber`, `building:levels`) covering ≥ 50 %
  of a LoD2 footprint (the one covering most), else the `addr:housenumber`
  points on it (inside, or ≤ 3 m off the facade), grouped by street
  (`pipeline/bake/osm_buildings.py` → `osmbuild_<tile>.json`, per object,
  never handed to the root) → the `name`, `addr`, `levels` columns. Spawn
  tile: 2 363 of 4 404 objects addressed, 444 named, 2 470 with storeys
  (BBBike extract 2026-09-26). The card merges a building's parts.
- **Ensembles** `◎ detected` (2026-10-19) — LoD2 Buildings that are one
  building to a visitor: the cadastre splits Dresden's Residenzschloss
  into three (the main complex, the Hausmannsturm's spire one of its
  parts, and the tower's shaft among them), and OSM maps it as one named
  outline. `osm_buildings.py` `tree_outlines` writes on each root the key
  of the *named* OSM building outline covering at least half of its whole
  tree (`outline`, `w<way>` / `r<relation>`); `lib/city/ensembles.ts`
  joins trees sharing it, and, for a wing the outline misses, trees of
  the same name whose footprints touch (≤ 0.5 m, overlap or crossing) —
  never two trees whose outlines differ (two halls named alike). Joined
  in `bake-city-mesh.ts` → the `ensemble` column (the tile's lowest root,
  its facts the tile's whole ensemble's: the union of the footprints,
  lowest base to highest top) and `group` (the outline's key hashed,
  FNV-1a: the same in every tile, so a building a tile edge cuts in two
  is asked, outlined and demolished in both tiles on screen; the card
  takes the highest of the tiles' tops and sums their grounds). Asked,
  outlined, listed in *Hier auch* and demolished as one; the card counts
  its Buildings (*Gebäude: 3 im Stadtmodell*) and keeps the picked one's
  `buildingId`. Unnamed outlines are left out: OSM often draws a whole
  block as one (up to 38 LoD2 Buildings under one in Dresden, each house
  with its own address). Dresden, extract of 2026-10-17: 262 named
  outlines over 732 trees, 4 of them across a tile edge (the World Trade
  Center among them); the name rule alone had made 292 groups, 14 of
  them not one outline. A first cut joined by name and touch only (no
  outline, not across tiles); the outline replaced it on the
  maintainer's ask.
- **Provenance manifest** `❝ taken` — `data/provenance.json` (hand-kept) →
  `provenance.json` next to the tileset (`lib/city/provenance.ts`, at build
  time): per source its label, credit and licence, per tile its edition
  (LoD2 split into the model year and its inputs' years). The card's
  source lines; fetched with the first question.
- **The asked building** `≈ assumed` (no slider) — the picked object's building tree,
  or its ensemble's trees (the set demolish takes), gets flag 32 in the packed object texture at
  runtime; the clay lifts it 40 % towards paper white, adds a faint
  paper light (brighter at night) and draws a pencil hatch: near, strokes
  on the building every 0.9 m (up the facade at 45°, across the roof;
  fwidth-constant); where those would crowd closer than a few pixels, 45°
  strokes every 7 px in screen space instead, so the mark reads from the
  air too. A first cut (0.45 m strokes, a flat graphite wash far off, a
  35 % lift) was checked headless: the wash and the lift cancelled, and
  from 100 m the building looked unchanged. Not in *Papier* (its override
  material). **Not yet judged on a real GPU.**
- **The inquiry card** `❝ taken` (asked by a click, a long press on touch, or `I`
  under the pointer — at the centre without one — no mode since 2026-10-01; the HUD's card surface, no
  longer a warm paper sheet; a tap slightly off a small house still finds it — two rings of
  rays vote; a bottom sheet on touch screens) — `lib/city/inquiry.ts` →
  `inquiry-card.tsx`: the
  OSM name or the ALKIS use as the title, the address, then only the facts
  that are known (the Building's height — its tree's base to top unless
  the survey measured it —, eave, roof form and pitch, the ground area
  of its parts' union, overlaps counted once, mapped storeys, parts, *Kulturdenkmal*, a
  shop on the ground floor), the `buildingId` to copy, and one source line
  per source quoted, with edition and licence. Unspecified use (86 % of
  the objects) is said as such, never guessed. A roof rebuilt from DOM1
  (ADR 0036) is said to be measured there: no LoD2 form, pitch or
  height, DOM1 as its source.
- **Tree facts** `❝ taken` (plan 052 phase 4) — the street-tree register's
  `art_deutsch`, `art_botanisch`, `name` (the location), `standort_nr`,
  `jalter` (age), `aend_dat` (the record's date) and which of height,
  crown and trunk it measured rather than the bake filled in →
  `treefacts_<tile>.json` (`pipeline/bake/trees.py`), columns aligned with
  the trees file, names, places and dates as tables; an OSM tree its
  tagged taxon, German name and sizes. ≈ 37 kB gzipped a tile, fetched
  with the first question about a tree there, never to draw. The card:
  species, location and tree number, measured sizes only, age with the
  record's date.
- **Asking trees, monuments, bridges** `❝ taken` — `lib/city/ask-items.ts` builds
  each tile's askable things from the features the dressing already has:
  a tree's trunk and crown cylinders (as the inventory sizes them; packed
  per 64 m cell), a monument's marker or measured form, a basin's prism;
  bridges are met on their drawn meshes (`bridge-ask.ts`), the point
  naming its deck. The card (`lib/city/inquiry-features.ts`): a
  monument's official name (Basis-DLM), basin form (OSM), measured
  height; a bridge's name and measured deck (Basis-DLM, DOM1), structure
  and main span (Wikidata or OSM), clearance (OSM), keyed by its Wikidata
  item.
- **Asking the traffic layers** `❝ taken` — while a data layer shows, its flows
  and counters answer like the rest. A counted section is met on its
  drawn glass bodies, on whichever terrain level shows them
  (`traffic-ask.ts`; the bodies' BVH built on the first question that
  reaches them), the vertex the ray meets names its
  section (`userData.trafficSection`, a CPU-side table — WebGPU allows
  eight vertex buffers and the bodies use them). A counter is met on its
  columns as tall as they stand now (`bike-ask.ts`, cylinders from
  `bikeColumns`). The cards (`lib/city/inquiry-traffic.ts`): a section's
  vehicles a day both ways, per direction named by the compass point it
  heads to with its heavy-goods share (where the source counted per
  direction; an even split says so instead), the year and how it was
  counted, the scene's hour as an estimate (≈ the day's count on the
  typical curve, rounded to tens, the curve's source named) and the
  layer's credit; a counter's bicycles in the last hour per direction,
  when they were counted, and whether that is older than three hours.
  The outline takes a section's own triangles, drawn with the layer's
  own position node (grown with the hour, widened from the air); the
  glass writes no depth, so its mask tests only what stands in front.
  Trams are not asked yet.
- **The outline** `= computed` (no slider) — whatever is asked, building, tree,
  monument, bridge, traffic flow or bicycle counter, gets one line along its silhouette as the camera
  sees it now, not along its edges: the element's triangles (a
  building's own out of its tile's mesh, a bridge's out of the tile's
  bridge meshes within 12 m of its deck; a tree's crown ellipsoid — a
  cone for a conifer — on its trunk, a monument's cylinder, a basin's
  prism) are drawn into a mask where the scene pass's depth shows them
  (a stand-in only where the scene's own surface lies inside it), the
  mask is blurred at half resolution, and the band of the blur between
  0.07 and 0.66 is the line: 4.5 CSS px in the HUD's accent pink
  (`SELECTION_ACCENT`, the theme's `--sidebar-primary`; the hatch on a
  building is `--primary`), on a hair of its pale outside (0.012–0.07,
  55 %), anti-aliased by its own gradient. The selection leaves the
  city's palette on purpose: it is the interface's, and the card's
  kicker and the chosen candidate carry the same colour. A new question
  flashes: the pale fringe widens to 0.002 and glows in the accent, easing
  out over 650 ms (`OUTLINE_PULSE`); a hover over a candidate does not.
  (Graphite and paper until 2026-10-07: maintainer review asked for a
  bolder mark.) The blur rounds the corners and drops what is finer than
  the line; its reach follows the device pixel ratio, so the width is
  in screen pixels at any distance (`lib/city/outline.ts`,
  `selection-outline.ts`, `selection-shape.ts`; over the finished frame,
  before the output transform, so every picture style shows it). It
  replaced the pencil loop (🗃️ below). **Not yet judged on a real
  GPU.**

### Vegetation
- **Cultivated land** `❝ taken` `≈ assumed` (plan 028) — OSM `landuse=allotments|orchard|vineyard`
  (and `leisure=garden` plots inside a colony) → `pipeline/bake/cultivated.py`:
  `cultivated_<tile>.geojson` (colonies, parcels, orchards with their trees,
  vineyards with their rows) and a 2048² colony raster
  (`cultivated_<tile>.png`, two bytes per texel: the signed distance to
  the edge of the garden land and the colony's long axis; the viewer gets
  it cropped to the colonies, phones at half resolution). No new
  land-cover class (ADR 0010): dressing only. **Allotments** get little
  gardens in the terrain's fragment pass (`cultivated-layer.ts`
  `colonyGarden`, a node function): the colony's edge is the baked
  distance field (the colony less its paths — OSM footways, paths, service roads, tracks —
  roads, rail and water), sampled LINEAR and faded over a metre with a
  slow wobble, so it is soft and organic from walking height to 200 m up;
  inside, everything is analytic in the data frame — plots ≈12 × 17 m
  (a jittered Voronoi in the colony's axis frame, borders meandering by a
  domain warp and drawn as thin soft paths), each a lawn in one of a few
  soft greens, a third with warm vegetable beds, some with sparse pastel
  flower dots, the rest with darker shrub mottles, and a faint hedge green
  inside the rim. Every line and band is box-filtered over the pixel
  footprint; with distance the detail gives way to the plots' tones and
  then to one calm colony tone (no moiré). *Redesigned 2026-09-25 after
  the maintainer looked at it on a phone* — see 🗃️ *Allotment bed bands*.
  A mapped parcel takes its own axis and a 0.5 m seam along its border.
  **STOP measured:** of the 66 colonies
  (77.9 ha) in the four first tiles, **0** carry mapped parcels — and 0 of
  the ≈195 (208 ha) over the fifteen tiles (2026-09-26; the four first
  tiles' counts: the 351
  `leisure=garden` areas lie elsewhere; inside the colonies OSM maps
  sheds, 196 footways and 123 fences) — under the plan's one-third, so
  the plots are invented texture, kept low in contrast
  (`COLONY_GARDEN.strength` 0.85 of *Bodendetail*), and no parcel outline
  is claimed as data. **Colonies** (2026-10-21, P23): the plots' axis
  follows the colony's mapped paths (footways, paths, service ways and
  tracks inside it: their length-weighted prevailing direction, at least
  40 m of them, `cultivated.py` `path_axis`), the long axis without them;
  plots ≈ 15 × 24 m (`COLONY_GARDEN`; were ≈ 12 × 17). Turned more than
  20°: Dresden 7 of 24, 9 of 47 and 9 of 30 colonies on three tiles,
  Meißen 5 of 19, Grimma 3 of 19 and 2 of 6, Leipzig 1 of 4.
  **Orchards** (2026-10-21, P21): where the tile has DOM1, a tree at each
  crown peak inside the orchard (`crown_peaks`, `orchard_dom`: nDOM
  smoothed 1 m, 2–12 m tall, off LoD2), as tall as measured, its crown
  0.85 × its height (2–9 m) (`src: "dom"`, `m: 1` in the viewer's file);
  without DOM1 the mapped `natural=tree` inside, else a grid 8 m apart
  along the long axis, centred; either way less the spots a measured tree
  already fills (a canopy, scan or inventory tree of any tile within 4 m,
  or within its crown radius when wider — so the step runs after the
  canopy, its scan crowns and the register). Their genus from the
  orchard's `trees=*` (else `produce=*`); a Christmas-tree plantation's
  trees evergreen cones. Dresden's 33408_5654: 30 grid trees → 4
  measured; the four invented trees of Dresden's embankment "orchard"
  became the one DOM1 shows; Unna 11 → 1. Drawn by the tree layer as the
  cadastre's "small" archetype (a round crown on a ≈1.3 m stem), a
  measured one at its measured size; asked, a measured tree's card gives
  its height and crown and names DOM1 for its place, height and crown
  (`inquiry-features.ts` `orchardCard`, `lineage.ts` `orchardLineage`;
  before, it said the orchard's default). *(Before: 5 orchards and 35
  trees over Dresden's fifteen tiles, all on the grid or mapped.)*
  **Vineyards** (2026-10-21, P22): row direction and spacing from the
  orthophoto (`dop_rows`: an FFT of 40 m windows, the direction most
  windows agree on within 15°, the spacing where one wave stands alone,
  1.5–3.6 m); else down the fall line below 25 % slope and along the
  contour above (`slope_layout`; the DGM's mean gradient over the whole
  polygon, read from every committed DGM it touches), 2.3 m apart (were
  1.8 m along the contour everywhere); `dir`, `gap`, `src` in the file.
  Meißen: 12 of 15 from the photo, the gentle vineyards turned 61–85° to
  their fall line, the terraces unchanged; rows 890 → 597. Dresden's
  rows 305 → 252 (33416_5654 turned 83°), Hamburg's 30 → 25. Drawn as
  chains of low boxes 1.3 m tall and 0.5 m wide, chunked into 250 m
  cells, and the seasonal bare
  canes wait for plan 025's season plumbing. ≈18 s per tile. **Not yet
  judged on a GPU** (the chessboard check is the plan's other STOP).
- **Tree/hedge rows** `❝ taken` `◎ detected` `≈ assumed` — Basis-DLM (or OSM) hedge & tree-row lines → instanced sets
  (`Instances`), chunked into 250 m cells for frustum culling. `pipeline/bake/landcover.py`
  (`vegrows_<tile>.geojson`) → `vegetation-layer.ts`, per fine terrain tile.
  **Where DOM1 exists the canopy step places a row's trees itself**
  (2026-10-21, P7, `canopy.py` `row_trees`): DOM1's crown peaks within 3 m
  of the line (nDOM smoothed 1 m, over 3 m, off LoD2 and the traffic),
  projected onto it, as tall as measured, thinned tallest-first 3 m apart,
  none within 4.5 m of a canopy or scan crown; written into
  `canopy_<t>.geojson` as `row: 1` with a `rows` member, which the pack
  carries as `ROWS_MEASURED` (`lib/city/point-pack.ts`), and the viewer
  then plants only the hedges from `vegrows`. Without DOM1 the trees stand
  every 9 m along the line as before. Row trees: Dresden's 33408_5656
  1 176 → 540 (doubles 26 % → 2 trees, standing on a crown 80 → 97 %),
  33412_5656 927 → 274, Leipzig's 33316_5688 1 378 → 408, Unna 904 → 85
  and 362 → 64, Hamburg's 32564_5934 157 → 37, Grimma 208 → 15 and
  98 → 16, Meißen 67 → 7; heights now measured 7–20 m (were ~7). *Why:*
  the 9 m grid stood 25–61 % of its trees within 4.5 m of a measured
  crown (Unna 61 %, Dresden 35 %) and 9–41 % of them over open ground, at
  5–9 m where DOM1 measures 9–20 m. A DLM hedge within 2 m of an OSM hedge
  is left to the OSM one (`hedges.without_mapped`, 2026-10-21; Dresden
  0.43 of 4.48 km). Without a DLM only `natural=tree_row` is written here
  (Hamburg's 2.26 km of OSM hedges were drawn twice).
- **Canopy fill** `◎ detected` `= computed` — `nDOM = DOM1 − DGM1`, one tree per ~7 m cell at the tallest
  pixel, as tall as measured and **0.58 × its height wide**
  (`CROWN_TO_HEIGHT`, `lib/city/tree-placement.ts`: the median of Dresden's
  50 123 surveyed trees with height and crown, the same in every 5 m class;
  until 2026-10-07 the generic crown was scaled uniformly by `h / 5.8`,
  0.88 × h wide and 1.1 × h tall, so a park point stood under ~5 crowns).
  **A crown starts at clamp(0.15 + 0.012 · H, 0.22, 0.6) · H** (2026-10-21,
  P8, `crownBase`; the laser scans' crown base ratios: street trees
  0.31–0.35, tall ones 0.39–0.50), at least 3 m over the ground where it
  reaches over a carriageway (`c: 1` in the canopy file, `canopy.py`
  `over_carriageway`: one within 0.29 · H + 0.5 m of the trunk; the pack
  then 5 values a point, 20 B, else 3) — up to the share's top; before,
  every crown started at 0.28 · H. Over a road: Dresden 769 of 6 823 and
  747 of 8 252 on two tiles, Leipzig 1 829 of 14 986, Hamburg 3 986 of
  24 680, Unna 640 of 6 537 and 773 of 8 737, Grimma 971 of 21 855 and
  616 of 15 302, Meißen 454 of 14 506. The trunk drops to the crown's
  base (`vegetation-layer.ts` `crownFrame`, `fitTrunks`); the coarse
  level's crowns carry the same base (*The coarse level's trees* below),
  and an asked canopy tree's solid starts there too (`ask-more.ts`).
  **Gated off paths and water** via the DLM
  class raster, **off the carriageways and track beds** (`ways.traffic`, below), and off everything within 10 m of a DLM bridge (a bridge's
  steel on a park bank is as tall as a crown: the Blaues Wunder's pylons came
  out as two trees; without a DLM the decks the rail step baked from OSM,
  `bridge_<tile>.geojson` — so `rail` runs before `canopy`). **And off a
  building's roof** (2026-10-20, `roof_mask`): inside an OSM building
  outline (shrunk by 1 m, its courtyards out) a texel no more than 2 m
  above the outline's roof — the upper quartile of its nDOM, so a stadium's
  pitch or a hall's skylight wells do not pull it down — is that roof, not
  a crown. *(The DLM files a stadium's stands, a fair's halls and a park's
  glasshouses as sports or park ground; LoD2 lacks some of them, and their
  roofs became rows of trees: Dresden's stadium, the Leipzig and Dresden
  fair halls, Planten un Blomen's glasshouses in Hamburg, a tennis club's
  halls in Unna. 0.7–1.6 % of the canopy points, per city.)*
  **Without a laser scan** (Hamburg, Berlin; 2026-10-20, `green_mask`) the
  canopy also takes the texels outside the vegetation mask that the DOP
  shows green (NDVI ≥ 0.3, the GLI where the DOP has no infrared) and DOM1
  rough (a 3 × 3 spread above 0.5 m on most of the 5 × 5 around), off every
  LoD2 outline grown by 1 m — the same gates as the rest of the canopy
  after it. A Land with a scan leaves those trees to `lowveg` (`canopyx`,
  below), whose crowns the scan measures. *(Hamburg had no tree in its
  courtyards and gardens: no scan step finds them there, and OSM maps a
  park, not a back garden. Its crown cover against DOM1's rough tall
  vegetation off the buildings went from 0.68 to 0.99 — 0.61 to 0.96 in the
  built-up class — at the same precision (0.67 → 0.66), 19 600 → 46 900
  canopy trees; the summer DOP's crowns are green, and its harbour's cranes,
  piles and scrap are grey.)*
  **On transport land the veto is the traffic, not the parcel**
  (2026-10-20, `pipeline/bake/ways.py`, `verge_mask`): no tree stands on a
  carriageway (the DLM's road centrelines at their surveyed width, the
  buffers the class raster burns; without a DLM OSM's roads at the class
  raster's widths) or a track bed (the baked rails by their track count
  and every OSM track above ground — sidings, yards, trams in their own
  bed — one track each, at the drawn ballast's widths: 4.5 m, 4 m more
  per further track), each grown by 0.5 m. Beyond them the road and railway land the DLM files to its fences
  is planted from the crowns DOM1 shows there — rough, 3–45 m, off every
  LoD2 outline, a blob of at least 15 m² after a 3 × 3 opening — with or
  without a scan, and not gated on the DOP's green: Saxony's is flown
  leaf-off, where 1–4 % of a crown's texels read green (Leipzig), against
  19 % in Unna's summer flight. *(The class gate vetoed the parcel: the
  station forecourts, embankments, verges, junction islands and the strips
  of wood beside a road the DLM files as road or railway, with their
  trees — on Leipzig's tiles 5.2 % of the crown cover DOM1 shows, 6.9 % of
  what the model left out; Dresden 1.6 % and 3.9 %. Leipzig gains
  5 373 canopy trees (+11 %), Unna 840; on Unna's tile with a scan every
  added point on rail and road land is tall vegetation to the scan
  (multi-echo ≥ 0.5 within 1.5 m).)* Nor is a bare plane a crown there
  (2026-10-21, `bare_planes`): a texel whose 5 × 5 neighbourhood is at
  least half plane — the residual of its 3 × 3 window about the
  least-squares plane at most 0.25 m (`PLANE_M`; a heap's flank reads
  0.05–0.15 m, a Saxon crown over 1 m) — and whose calibrated index reads
  below 0.1 (`BARE`; asphalt, gravel, sand and roofs 0.0–0.05, a mown
  lawn 0.33) is no crown, on transport land only. *(`rough_mask` read a
  gravel heap's smooth flank as rough for its slope alone, and leafless
  trees are no greener than gravel in Saxony's DOP: Leipzig's freight yard
  on 33318_5690 grew 22 trees on its heaps. Not in the forests and parks:
  there Dresden's DOM1 of bare limes and München's smooth DOM under a
  visible-band index read like planes too. Removed: Leipzig 26, Dresden 6
  (on four tiles), Meißen 1, München 52 (cranes, containers, kiosks, a
  covered rail approach; one tree loses one cell), none in Grimma, Unna
  and Hamburg; 33 of the 37 Saxon removals were no tree.)*
  `pipeline/bake/canopy.py`. At build time
  (`scripts/prepare/side-bakes.ts`, `treesOffStructures` in
  `lib/city/small-buildings.ts`) a canopy or laser-scan point in or within
  0.5 m of one of the tile's small structures is dropped: DOM1 reads a
  shed's roof as a 3–4 m tree (859 canopy points stood in 636 sheds, 807
  within 1 m of the shed's own height). Not in the canopy bake: it runs
  before the structures are found. Likewise a point more than 1 m inside a
  LoD2 footprint and at most 2 m taller than that building is its roof
  (`treesOffRoofs`, `lib/city/roof-trees.ts`): where the Basis-DLM still
  files a since-built hall's ground as park, DOM1 over its roof made a
  grove on it (2 153 points over Dresden's 15 tiles, most on the halls
  west of the Yenidze; 2026-10-19). A taller point is a tree over a shed
  or garage and stays. At build time, so every site has it without a
  re-bake.
- **NDVI crown colour** `= computed` — per-tree DOP greenness (`ndvi_<tile>.png`, sampled on
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
- **Vegetation index from the visible bands** `= computed` (GLI; 2026-10-01, ADR 0012)
  — a DOP without an infrared band (Bavaria's open DOP is RGB only) gets
  the same `ndvi_<tile>.png` from its colours: the Green Leaf Index
  GLI = (2G − R − B) / (2G + R + B), mapped onto the NDVI's scale by
  `GLI_SCALE` 3.3 · GLI + `GLI_OFFSET` 0.14, clamped to 0..1 (`ndvi.py`
  `_gli`). The line was fitted where both exist — Unna's two summer
  DOP tiles, NRW's RGBI: r ≈ 0.7 against the NDVI, 85 % agreement on
  NDVI > 0.3; checked on Hamburg's four tiles, r 0.75–0.86. Every consumer
  (crown colour, meadow tint, the tram's lawn bed, the hedge cue) reads it
  as it reads the NDVI. It tells green from grey well and vigour less
  well — a stand-in, marked 🟡 in the *Sources by city* page. München's
  four tiles have it. A DOP with fewer than three bands still skips.
- **One vegetation-index scale for every flight** `= computed`
  (2026-10-20) — the orthophotos are not calibrated reflectances: each
  flight's bands carry their own gain and offset, so the same asphalt read
  NDVI −0.30 in Dresden, −0.37 in Meißen, −0.15 in Leipzig, −0.07 in
  Hamburg and +0.02 in Unna, and the same mown lawn 0.33, 0.41, 0.12, 0.14
  and 0.22 (Munich's GLI: 0.20 and 0.43). Every threshold downstream (the lawn edges'
  and the urban green's 0.3, the hedge cue's 0.12, the canopy's courtyard
  crowns, the sheds' and the rebuilt roofs' green veto, the tram's lawn
  bed, the crown colour and the meadow tint) was tuned on Dresden's: on
  Leipzig's flight 1–4 % of the OSM lawns passed the urban green's 0.3
  (Dresden's 18–82 % a tile), so its courtyards drew grey; on Munich's GLI the
  asphalt read 0.19 and passed the hedge cue. `ndvi.py` now maps the raw
  index by one line per site onto Dresden's scale: the medians on the
  site's carriageways (`ways.carriageways`) and its mown lawns (OSM grass,
  meadow, village green, park, garden), both where DOM1 stands within
  0.5 m of the ground, pooled over the site's tiles, go to Dresden's own
  (−0.298, 0.332), so Dresden's raster stays as it was and a threshold
  means the same green in every city. Two materials every city shows and
  that hardly change between flights, asphalt and a mown lawn, and per
  site rather than per tile: Dresden's lawns alone range 0.14–0.46 a tile
  under one flight (the Großer Garten against the Heide), which a
  per-tile scale would have turned into seams. A site with too few of
  either keeps the raw index. The step now runs before the canopy, which
  reads its raster.
- **Evergreen canopy crowns** `≈ detected` (2026-10-20) — a canopy crown
  has no species, so every one followed the generic deciduous year and
  the Dresdner Heide's pines stood bare from November to April. Two
  sources tell a conifer without a register. The Basis-DLM's forest kind
  (`veg02_f` `VEG`: 1100 broadleaf, 1200 needle, 1300 mixed; without a
  DLM OSM's `leaf_type` on a wood or forest): a crown in a needle forest
  is an evergreen (`l: "e"`). And in a mixed forest the orthophoto, where
  it was flown leaf-off: on Dresden's March flight the crowns of the
  Heide's needle stands read NDVI 0.39 (median, 3 × 3 max at the peak)
  and its broadleaf stands' 0.16 — a cut at 0.354 parts them best
  (Youden's J 0.40) — so a mixed forest's crown at 0.35 or more on the
  calibrated index is one too (`l: "e"`, `ls: "dop"`), but only where
  the site's broadleaf crowns read below 0.30 (at least 200 of them):
  under leaves a summer flight shows every crown green. 44 % of the
  Heide's mixed-forest crowns pass. Baked: Dresden 91 076 of its 303 113
  canopy crowns (the Heide's two northern tiles 63 % and 60 %), Grimma
  807, Meißen 129, Unna 68; none on Leipzig's, Hamburg's and München's
  tiles. The DOM's form (a cone's peak over
  its shoulders) does not part them (J 0.17) and is not used. An
  evergreen crown keeps its leaves and colour all year (no season
  jitter) on both terrain levels (`lib/city/coarse-crowns.ts` byte 10),
  and the card says *Nadelbaum, immergrün* with the source that told it.
  It stands as a conifer (2026-10-21, `app/_components/conifer-crown.ts`):
  a three-tier lathe cone in the lobed crown's box, on the same trunk, its
  own chunk set beside the broad crowns, sharing their node build (the
  same attributes, no index, the same material), in the register
  conifers' deeper blue-green (`evergreenColor`; before, the NDVI's
  lush↔dry green), outlined as its cone when asked; the coarse level draws
  it as a six-sided cone of one skirt, and the register's conifers carry
  their cone there too (`lib/city/coarse-crowns.ts`, the code byte's
  0x80). A canopy evergreen is a needle forest's crown or a mixed forest's
  green in March, so a pine, spruce or fir — an evergreen broadleaf
  (holly, box, cherry laurel) is a shrub under the canopy's 3 m — and a
  larch in a needle forest is drawn as one (the data tells no larch
  apart). **Pines** (2026-10-21, P12–P14, `pipeline/bake/crown_form.py`,
  `canopy.py` `mark_pines`): a crown whose surface a fifth of its height
  out stays within 0.3 H of its top is a pine's (`pine: 1`; on the
  registers' conifers DOM1 sees, 73 % of the pines and 29 % of the cones
  fall under it): it wears the pine's flat-topped crown from 0.55 H
  (`buildPineGeo`, `lib/city/tree-inventory.ts` `PINE_CROWN_BASE`,
  `pineBase`), the rest the cone — Dresden 54 600 of 91 076, Grimma 493 of
  806, Meißen 77 of 129, Unna 32 of 68. Asked, a canopy pine's solid
  starts its crown at 0.55 H too, and only a tree drawn as a cone is
  outlined as one (`ask-items.ts` bit 16, `CanopyInquiry.cone`).
- **Crown shaping** `≈ assumed` — radial crown normals (free), organic trunk, base darkening;
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
  **backlight shimmer** (far cheaper than transmission; gated on the sun's
  daylight ramp — until plan 020 on one shadow-map sample 2 m toward the sun,
  which a node material cannot reach: node lights keep their shadow map to
  themselves, so a crown behind a building now glows too).
- **The coarse level's trees** `≈ assumed` (2026-10-05) — each terrain level carries
  its own trees. The fine level draws every tree (the tiers above). The
  coarse level, which the tile renderer shows wherever the fine one is
  not loaded — in the distance and from the air, in a Modell picture past
  2.5 m/px, at any scale on a phone whose memory governor coarsens the
  stream, and while fine tiles load — draws a fixed third of them, chosen
  by a hash of where each stands (`drawnCoarse`,
  `lib/city/coarse-crowns.ts`): as tall, their crowns √3 wider
  (`COARSE_TREE_WIDEN`) so a wood covers what the whole one did, in the
  same colours (NDVI, the register's foliage) and seasons, on the scene's
  crown material, the far crown's geometry one subdivision coarser and
  without trunks (`coarse-crowns-layer.ts`); its conifers — a canopy
  evergreen, a register tree whose crown is the cone — as a six-sided
  cone of one skirt in a set of their own (`coarseConifer`, 2026-10-21),
  and its pines with the pine's crown in a third set (`coarseForm`). A
  canopy or row crown's record carries its crown base in millimetres (the
  third `uint16`; 2026-10-21), so a distant crown starts where its near one
  does (`crownBase` above); a coarse crown had ignored it.
  The build step runs the fine
  level's own placement over each tile's tree files (the packed canopy as
  the browser unpacks it, the scan crowns, the rows, the register and the
  orchards, its veto, on the fine level's ground;
  `lib/city/tree-placement.ts`, `lib/city/tree-inventory.ts`,
  `scripts/coarse-crowns.ts`) and packs that third, 20 bytes a crown
  (`crowns_<t>.crw.gz`, ≈ 136 000 crowns and 1.5 MB gzipped for
  Dresden's fifteen tiles). The coarse level fetches it with its other
  side files and builds it with its dressing, whatever the mode or scale,
  so a tree stays where it stood when the level changes and no scale and
  no device is left without trees. A level that takes over from the
  other on screen shows only once its trees are built (`handsOver`,
  `tile-stream.ts`): the old level's trees stay until the new level's
  arrive, in the same frame — first built, the new level showed bare and
  its trees followed a moment later, a blink at every change of level.
  The cost of the switch: where the levels meet, a wood goes from all its
  trees to a third of them, wider.
  Since 2026-10-25 (plan 076, step 4) a coarse level's dressing — light:
  its crowns and bridges — goes ahead of every fine level's in the
  dressings' one-at-a-time turn (`COARSE_DRESSING_RANK`), so every tile in
  view has its third before the nearest has all; and where the fine level
  shows without its own trees — a phone shows it the moment it loads, and
  its dressing waited behind the nearer tiles' — the coarse level's crowns
  stand in on it until they hang (`coarseCrownsStandIn`,
  `DressingPlugin.standInCrowns`). They are the coarse level's own, kept
  loaded under the fine one anyway: no byte more on the GPU or the wire.
  A site file of every tile's crowns at boot (the plan's first idea) would
  have held all ≈ 136 000 crowns on a phone for the whole visit, ≈ 12 MB.
- **Canopy motion** `≈ assumed` — per-frame in `buildCrownMaterial`, **main pass only** (the
  shadow pass draws the rigid `castShadowPositionNode` → no shadow-pass cost, no
  extra buffers):
  **wind sway** (vertex bend, stiff base → loose top, per-tree phase from the
  instance origin) and **sway-coupled brightness** (the crown brightens
  leaning into the same gust, × (1 + 0.09 · gust), centred so the mean colour
  is unchanged). The brightness is fixed at what its slider
  (*Windhelligkeit*) defaulted to; the leaf flutter is gone (🗃️ below).
- **Tree inventory from the Dresden street-tree cadastre** `❝ taken` `≈ assumed` (every tile, by
  default) — *inputs:* the city's *Stadtbaumkataster* (WFS `cls:L1261`, dl-de/by-2-0
  "Landeshauptstadt Dresden"; street trees, parks, schools — not the Großer
  Garten, not private ground): position, height, crown diameter, taxon.
  `pipeline/bake/trees.py` bakes `data/<site>/dlm/trees_<tile>.geojson` (from the WFS cache `bun run fetch` writes, `cadastre.py`) (h, d,
  archetype id, leaf type, foliage colour; missing h/d imputed from the genus
  median / the archetype's d:h), with the taxonomy in
  `pipeline/bake/tree_archetypes.py`: genus + cultivar + German name → eight
  archetypes (round 66 %, oval 15 %, small ornamental 12 % incl. 276 globe
  cultivars, columnar 5 %, conifer 1.8 %, weeping 0.1 % of the block's 18 444
  trees; since 2026-10-21, P12–P14, the conifers split three ways: the
  cone — *Picea, Abies, Thuja, Chamaecyparis, Larix, Pseudotsuga* —, the
  **pine** (archetype 6: *Pinus* but *cembra*/*peuce*, a flat-topped crown
  from 0.55 H on a long clear stem) and the **bush** (7: *Taxus,
  Cephalotaxus*, the dwarf pines and spreading junipers, a dwarf cultivar:
  the lobed crown from 0.04 H); Dresden's 2 174 conifers → 805 cones, 883
  pines, 480 bushes, Leipzig's 257 → 111 / 78 / 68, Hamburg's
  117 → 76 / 39 / 2), leaf type (318 evergreen; *Larix/Metasequoia/Taxodium* are
  leaf-off) and 193 purple / 40 golden cultivars. *What it does:*
  `tree-inventory-layer.ts` plants each tree at its surveyed spot; the
  per-instance scale is non-uniform (crown width = `d`, crown depth = `h`
  minus an archetype clear stem), so round/oval/small share the lobed
  broadleaf crown and only four silhouettes get geometry of their own (a
  flame for fastigiate cultivars, a tiered lathe cone for conifers, a
  pine's flat-topped crown — the lobed crown reshaped, `conifer-crown.ts`
  `reshapeCrown`, `pineSilhouette` —, a curtained dome for weeping trees;
  a bush is the lobed crown from the ground) — same crown material, LOD swap and
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
- **Tree registers of other cities** `❝ taken` (2026-10-01; Hamburg and Leipzig
  baked, Berlin configured) — *inputs:* `pipeline/bake/cadastre.py` holds
  a register per city as data: its WFS (service, one or more feature
  types, output format, CRS) and a field mapping (`Fields`: botanical and
  German name, height, crown, trunk diameter or circumference — a
  circumference is divided by π —, planting year, felled date, position
  from two properties or from the geometry). `trees.py` reads every
  register through it into one record; no per-city branch. Registers:
  **Hamburg**'s *Straßenbaumkataster* (`de.hh.up:strassenbaumkataster`,
  dl-de/by-2-0, BUKEA; street trees only; taxon from the cultivar, else
  species, else genus), **Leipzig**'s *Baumkataster* (`OpenData:Baeume`,
  dl-de/by-2-0, Amt für Stadtgrün und Gewässer; street and park trees;
  felled trees and the "Bestandsfläche"/"waldartiger Bestand" points —
  a stand, not a tree — skipped), **Berlin**'s *Baumbestand*
  (`baumbestand:strassenbaeume` + `baumbestand:anlagenbaeume`,
  dl-de/zero-2-0; its root CA is only in certifi's bundle, which the
  fetch adds to the system trust — verification stays on). The taxon
  table gained *Calocedrus* (conifer), *Eriolobus* and *Crataemespilus*
  (small) and the registers' placeholders ("unbekannt", "nicht
  bestimmt") as no taxon: trees of no genus the classifier knows are
  2.3 % in Hamburg (all of them records without any name), 0.3 % in
  Leipzig, 0.1 % in Berlin's spawn tile (2.4 % in Dresden).
  **Hamburg records no height.** Since 2026-10-21 (P10) a register tree
  without a height takes it from its genus and trunk diameter
  (`pipeline/bake/allometry.py`, the table `tree_allometry.json`: per
  genus the median height of each trunk class, made non-decreasing,
  fitted on Dresden's and Leipzig's registers, ~74 000 trees; a genus
  with few trees its archetype's curve; cross-validated, 1.8 m median
  absolute error against 3–4 m for a genus median), else from its crown,
  else its genus's median (`_missing_height`). Hamburg's DOM1 is matched
  from a leaf-off flight and read its street trees 10–40 % low (a
  25–40 cm lime 9.7 m against 13 m in Saxony); it now only drops absent
  trees (75) and raises stale heights (32; *Register heights checked
  against the surface model* below). Hamburg's median register height
  8.3 → 12.9 m (25–40 cm limes 9.7 → 14.1 m). *(Until then the bake
  measured the height in the surface model — the highest texel within a
  quarter of the crown diameter, 1–3 m, of the trunk, kept when it fit the
  recorded crown, 0.6·d ≤ h ≤ max(3·d, 6 m) + 2 m —, else imputed it from
  the crown; on Leipzig's register that read 0.6 m low in the median and
  1.5 m off, but Hamburg's November flight is not Saxony's, and 8 575 of
  its 10 418 trees had taken that low height.)* Baked (before P10): Hamburg 10 418 register
  + 3 224 OSM trees (1 838 / 3 330 / 2 139 / 3 111 + 694 / 875 / 757 /
  898 on 32564_5932, 32564_5934, 32566_5932, 32566_5934), Leipzig 25 498 +
  2 826 (5 452 / 5 424 / 7 237 / 7 385 + 794 / 735 / 612 / 685 on
  33316_5688, 33316_5690, 33318_5688, 33318_5690); Leipzig's scan trees
  (`canopyx`) were thinned against the new register (8 814 of 27 893
  dropped as register trees). Dresden's output is unchanged by the
  generalisation (re-bake of 33412_5656: the same 6 121 trees,
  property for property).
- **Register heights checked against the surface model** `❝ taken` `◎ detected`
  (2026-10-21, P11; `trees.py` `surface_check`) — the surface model has a
  say over every register tree, and over an OSM tree with a height.
  *Stale:* where DOM1 by the trunk (the highest texel within a quarter of
  the crown diameter, 1–3 m) stands over the recorded height by
  max(5 m, 30 %), fits the recorded crown (`plausible_measure`) and is at
  most 1.9 × the allometry's height for the trunk on record (99 % of
  Dresden's and Leipzig's measured trees are; a 5 cm sapling read 9 m
  under a neighbour's crown), DOM1's height is taken (the crown filled in
  from the height again; the card's measured bit set): raised in the
  registers Dresden 1 920, Leipzig 705, Hamburg 32; OSM trees Dresden
  555, Leipzig 638, Hamburg 718. *Absent:* a tree the model must see (8 m
  or more expected) where DOM1 by its trunk stays under 2 m, the disc all
  in view, the orthophoto bare there and the register not dating its
  planting within 6 years of the flight is left out: Dresden 51, Leipzig
  8, Hamburg 75 (DOM1 alone does not tell: Hamburg's leaf-off model shows
  nothing at 4 % of its 25 cm trunks, most of them green in its summer
  photo). A conifer of no known genus takes its form from DOM1
  (`crown_form.py`: pine or cone). OSM trees stand clear of a register
  tree by max(3 m, its crown radius ≤ 15 m) (were 3 m): the doubles 3–6 m
  from their register twin fell from 1 364 / 609 / 1 288 to
  440 / 278 / 227 in Dresden / Leipzig / Hamburg (OSM trees dropped:
  274, 372, 60). The registers' weeping trees: Hamburg 51 → 52.
- **OSM trees beside the cadastre, genus and trunk** `❝ taken` (plan 025 phase A,
  every tile) — *inputs:* the site's OSM extract (`natural=tree` nodes,
  ODbL) and the cadastre's `stammdurchmesser_akt`. `trees.py` writes each
  tree's **genus** `gn` (an index into `tree_archetypes.GENERA`, 38
  entries, the file's `genera` member; the red maples and red oaks are
  entries of their own because their autumn is) — 17 228 of the 18 444
  cadastre trees (93 %) have one, the rest follow the generic curve — and
  the **trunk diameter** `t` (cm, 17 233 trees; a diameter implausible
  for the tree's height — over 15 cm per metre, or over 4 m, 0.1 % of
  the register — is dropped, not clamped). The viewer fits a measured
  trunk's girth to the radius the trunk geometry draws at 1.3 m, its
  flared foot included (× 1.3 for the seven-sided, barkless trunk;
  `tree-inventory.ts` `trunkGirth` / `trunkRadiusAt`; a taper-only fit
  drew a 25 m tree's trunk half as thick again), the height rule stays
  where none is measured. **OSM trees**: the BBBike extract (2026-09-19)
  has 10 854 `natural=tree` in the fifteen tiles (6 018 in the four first);
  8 292 (4 385) carry a taxon that
  names a genus the classifier knows (`species`/`taxon`/`genus`, then
  `species:de`/`genus:de`; German names such as "Platane" or "Gemeine
  Fichte" mapped by their last word, a lower-case genus capitalised, an
  unambiguous bare epithet such as `hippocastanum` read — a family or an
  English name is no taxon) or at least `leaf_type` (which wins over a
  taxon it contradicts; `leaf_cycle` sets the leaf type), the rest are
  dropped (the DOM canopy covers unknown trees; no species is invented).
  **The cadastre wins**: an OSM tree within 3 m of a cadastre tree — any
  of the cached WFS answer, its 10 m margin across the seams included —
  is taken to be it (4 839 dropped; 2 565 on the four first), leaving
  **3 453** over the fifteen tiles (0–854 per tile; 1 820 on the four
  first, 854 / 252 / 368 / 346; `s: "osm"`, 298 with a genus) — courts, the Zwinger,
  Free-State and private ground. Their height/crown/circumference tags are read (53 / 1 /
  2 in the four first tiles), the gaps filled from the cadastre's own statistics
  for the tile. They join the cadastre's veto path (`keepTree`), so an OSM
  tree replaces the canopy or laser-scan crown it stands in. The re-bake
  left the cadastre trees unchanged (same set, positions, properties);
  features are now sorted by position so a re-bake diffs by content.
  Since 2026-10-21 (P11) the clearance is the register tree's crown radius,
  at least 3 m (*Register heights checked against the surface model*
  above). **A site without a register keeps its OSM trees** (2026-10-21):
  the `trees` step runs there too and writes `trees_<t>.geojson` and
  `treefacts_<t>.json` on every tile, the OSM trees alone, their
  heights measured in DOM1 (`measure_heights`), vetoing the canopy
  crowns at their place as a register's do — München 3 271 (3 055 of them
  measured), Unna 191, Grimma 100, Meißen 92. Before, the step skipped a
  site without a register.
- **Trees by season** `≈ assumed` (plan 025 phases B–C, every tile; look **not yet
  judged on a GPU**) — *inputs:* the genus above and the scene date.
  `lib/city/tree-season.ts` maps (day of year, genus, per-tree jitter of
  ±6 days) → `{ leaf, autumn }`: leaf-out mid-April → early May, colouring
  in October, leaf fall late October → late November, per genus (limes
  early and butter yellow, horse-chestnuts browned from August by the leaf
  miner, oaks late, russet and holding 30 % dead leaves through winter,
  the ginkgo bare within days, larch and dawn redwood rust then bare);
  evergreens never change; canopy and row trees (species unknown) follow a
  generic deciduous curve. **Another city's year is Dresden's warped by
  its climate** (2026-10-21, P17, `SITE_SEASON`, `climateDay`): per site
  a spring and an autumn shift, the median over the species the Deutscher
  Wetterdienst observes of the difference between the city's and
  Dresden's median day of each phase (leaf-out and flowering; colouring
  and leaf fall), from DWD's annual phenology reporters 2010–2023 within
  30 km and 150 m of height of the city (dl-de/by-2-0, "Quelle: Deutscher
  Wetterdienst"; read once offline, the shifts are a table in the code —
  the browser asks DWD nothing): Hamburg +3 / +5 days, München +2 / +4,
  Unna −6 / +1, Leipzig −1 / +1, Meißen +1 / +1, Grimma 0 / −1, Berlin
  0 / −3; the shift holds from March to June and from August through
  November and runs over between. The birch turns and drops two weeks
  later than before (DWD around Dresden: colouring on day 284, half its
  leaves gone on 304; the table had it 16 and 20 days early).
  `crown-season.ts` writes, **on a change of
  calendar day only** (the local calendar the HUD composes the date in;
  never per frame; throttled to one run per 150 ms),
  each crown's colour (summer green → the genus hue, divided by the crown
  material's base so it lands as itself) into the sets' per-instance tint
  (`instanceTints`), and `aBare` = 1 − leaf into a per-chunk instanced
  attribute (read with `instanceFloat`). A chunk with any bare crown
  switches to the **seasonal crown material**: a hashed alpha test in the crown's own
  local space (Wyman & McGuire's method, as three's `alphaHash`: cells
  about 1.25 px wide at every distance, fixed to the tree so they sway
  with it) discards the leafless part down to a 25 % grey-brown twig
  stipple; the test is the material's `maskNode`, which three's **shadow
  pass honours**, so the shadow thins the same way (PCF softens the stipple
  into a lighter shadow; until plan 020 a matching custom depth material
  did this). The first cut
  used fixed cells in crown space (~8 across a crown) with a solid,
  twig-tinted crown past 160–320 m: headless plates showed big trees
  shattered into flat brown shards up close, so it was replaced before
  shipping. A chunk in full leaf keeps the plain material (no
  discard, early depth test intact). A season change redraws the shadow
  map. Both crown materials are scene-wide (`sceneCrowns`) and are
  compiled once per scene before the first tree lands (`crownWarmup`,
  stand-ins through `PostStack.compile`), so the first date change across
  the leaf fall builds nothing inside a frame. *Cost* (`scripts/eval/season-cost.ts`, the whole site, 58 988
  crowns, CPU): 4–7 ms median per date change (July → October 6.4 ms,
  October → January 3.6 ms), under the plan's 16 ms bar; the upload is 16 B
  per crown. *Not seasonal:* hedges and trunks. *Unverified:* the autumn
  hues and whether the bare-crown dither reads as noise in motion (the
  plan's STOP condition) need the `--headed` plates on a real GPU.

- **Tree families** `≈ assumed` (2026-10-07, every register tree) — *inputs:* the
  genus `gn` (and the archetype's leaf for a conifer without one).
  `lib/city/tree-family.ts` groups the 37 genera into ten families an
  illustrator tells apart (lime, maple, oak/beech, plane, chestnut,
  pinnate — robinia, ash, honey locust —, birch/poplar/willow, blossom —
  cherry, apple, pear, hawthorn, rowan —, hornbeam/elm, conifer) and gives
  each a lean of its summer green (HSL offsets ≤ 0.07 on the NDVI
  colour: a chestnut deeper, a robinia yellower, a plane lighter; not on
  the copper, golden or evergreen cultivars) and a bark colour, written
  as the trunk's per-instance tint (a birch's white stem, a plane's pale
  bark, a pine's reddish one; canopy trunks keep the material's own).
  **Blossom:** `Phenology.bloom` gives eight genera a flowering span,
  colour and strength (cherries pink 2–26 April, before their leaves;
  pears, apples, hawthorn white; rowan, horse-chestnut candles, robinia
  and catalpa a partial cream), `bloomAt` a rise and fall over it;
  `crown-season.ts` mixes the crown's colour toward the blossom and keeps
  a flowering crown full (`aBare` = 1 − max(leaf, bloom)) — on the same
  day change, no new attribute. An illustrator's table, not botany.
- **Tree age** `❝ taken` `≈ assumed` (2026-10-07, Dresden; the other registers on their next
  bake) — *inputs:* the planting year `y` (`trees.py` `planting_year`: a
  register's `pflanzjahr`, else the year of its record less Dresden's
  `jalter`; 43 471 of Dresden's 60 266 trees). `lib/city/tree-age.ts`
  turns the age into what the measured sizes do not say: a tree under
  15 years has, without a measured trunk, a trunk down to 0.6 × the
  height rule's; under 5 years (1 960 trees) it
  stands between stakes (`tree-stakes.ts`: three posts and two rails, one
  set per tile, a scene-wide material); past 80 years an unmeasured trunk
  thickens to 1.3 × by 150. The crown's colour leans with the age too: a
  sapling's lighter and fresher (fading out by 15 years), an ancient
  tree's deeper and duller (from 80 to 150 years); on the fine level only,
  the coarse level's crowns carry no age. The age is
  counted to the current year, so the picture ages with the calendar.
  Height and crown size stay as measured.
- **Trees by picture style** `≈ assumed` (2026-10-07) — what the tree changes above
  mean per style, with one new mark. *Pastell*, *Film noir*, *Sin City*:
  everything (families, blossom, age, stakes). *Comic*: its cloud
  crowns copy every per-instance attribute (`style-dressing.ts`), so they
  turn and flower with the season, printed in marker inks (green, an
  autumn crown yellow, a bare or blossoming one the paper;
  `printedCrown`), a bare one whole. *Papier* and *Strich*: the paper
  override has no mask, so their card crowns stay closed outlines (a
  plan's cloud, not a noise). *Schwarzplan*: until now no trees; now the register's trees as
  a site plan draws them (`tree-plan.ts`: the measured crown as a circle,
  its line 8 % of the radius, the stem a dot, 0.4 m above the foot), one
  hidden set per tile shown only in its frames (`paper-scene.ts` shows
  what is tagged `planOnly`) and drawn in the figure's black by the swap.
  Only the register's trees: measured, so they may stand on a plan; the
  canopy's are inferred. On the fine terrain level only, so a Schwarzplan
  zoomed out past it shows none.

- **Hedges (OSM, laser-scan height)** `◎ detected` `❝ taken` and **trees outside the canopy mask**
  (laser scan) — on by default. The laser scan is baked for every tile of the
  site (`bun run fetch <site> --lsc`, then `bun run bake <site>`); a tile without one would bake
  OSM-only (hedges at their tag / 1.5 m, no extra trees). Where a scan is
  read (`products.lsc`): Saxony (Dresden, and since 2026-09-30 Meißen,
  Grimma and Leipzig — Meißen 6 449 extra trees), NRW (Unna, the same
  date) and, since 2026-10-01, Bavaria (München, see below); Hamburg and
  Berlin stay OSM-only. **Shipped:** the OSM hedges (`src` `osm`, `osm+lsc`,
  `osm+dom`), the extra trees and, since 2026-10-21, the scan's own hedges
  that pass `scan_hedge_ok` (`lsc`): at least 6 m long, at least 4× as
  long as wide, 80 % of the axis at least 1.5 m from any crown over 3 m,
  median NDVI at least 0.12 where the raster exists. München 123 of 453
  (1.42 of 3.12 km); Unna 961 of 2 990 (11.68 of 21.31 km; their
  precision is not measured yet). Without a scan an OSM hedge takes DOM1's
  height (the median along the line of the highest nDOM within 1 m,
  ignoring anything over 3 m, clamped to 0.5–3 m) and is dropped under
  0.4 m. Hamburg: median 1.4–1.8 m instead of the 1.5 m default, 7 of 53
  dropped. **Not shipped** (🗃️ below): the rest of the laser-scan-only
  hedges (short, wide, along crown rims, not green) and all shrubs — the
  bake still finds them (`bun run bake <site> --step lowveg --research`
  writes every candidate under `data/_raw/` for research), but the
  committed `lowveg_<tile>.geojson` holds only what renders.
  - *Why:* the canopy bake (`canopy.py`) keeps nothing under `MIN_H = 3 m` and only
    forest/copse/sport-and-leisure areas, so courtyard and garden trees are
    dropped at any height; the Basis-DLM carries a hedge only when it is
    landscape-shaping (≥ 200 m) — `vegrows` on 33412_5656 has **0 hedges**.
  - *Inputs:* GeoSN laser scan (LAZ, 2024-11-30, leaf-off) → 0.5 m
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
    *Other scans: intensity normalised per scan* (2026-10-01). Two
    sensors' intensities are not calibrated against each other, so
    `lsc.rasterise` scales every scan's low-return intensities by
    1352 / the median intensity of its own measured ground (class 2) in
    the tile — 1352 being that median on the spawn tile 33412_5656 where
    the 1250 was measured (34.1 M ground points, p10/p90 958/1637), so
    that tile keeps a factor of exactly 1 and its rasters are byte for
    byte what they were. Bavaria (LDBV, CC BY 4.0, flight 2022): ground
    medians 1436–1548 per 1 km file, factors ≈ 0.88–0.94. NRW
    ("3D-Messdaten", Geobasis NRW, dl-de/zero-2-0) records 16-bit
    intensities; it had been divided by a hand-set 16 (a ratio of whole-
    scan medians, not of like surfaces) — still applied while merging, now
    moot: a fixed factor does not change the median ratio. *Assumption:*
    the same mix of ground (asphalt, lawn) reads equally bright to every
    sensor — a first-order gain correction, not a calibration. Not
    verified on Unna's or München's hedges by eye.
    On Unna's 32408_5710 the NRW ground median is 3152 after the old 1/16
    (raw 48–52 k per 1 km file), factor 0.43: the old scale had left its
    intensities 2.3× too bright, yet the shipped result is the same — the
    11 OSM hedges (4 with the scan's height) identical, the low-vegetation
    mask 10.39 → 10.29 ha, the scan trees (echo only) unchanged at 1 258 —
    because Unna's mask leans on NDVI. So Unna was not re-baked for it.
    *Bavaria's classes* are not AdV's: 6 building, 20 "object point, e.g.
    vegetation" (no 3/4/5), 9 water, 23/24 synthetic ground, 22 bridge
    (≤ 2020) or cellar entrance (≥ 2021). `providers/by.py` maps them into
    the AdV scheme while merging (6 and 20 → 20, 9 → 8, 23/24 → 30, 22 →
    20 up to 2020 and dropped after, 0/1/7 dropped): buildings stay in the
    non-ground class as in GeoSN's, because every rule here was measured
    with roofs in it and the small structures need the sheds' roofs; LoD2,
    land cover, NDVI, echo ratio and intensity decide what is vegetation.
    München (2026-10-01, the four tiles): 108 of 195 OSM hedges take the
    scan's height (`osm+lsc`); 6 104 / 8 068 / 7 708 / 10 655 extra trees
    (no cadastre to thin them; 97 % of the Altstadt tile's on the built-up
    class, median 13.3 m). Intensity factors per tile 0.92 / 0.90 / 0.89 /
    0.86.
    *NRW's classes are not AdV's either* (measured 2026-10-01 on 32408_5710,
    66.7 M points): class 1 is 22 % of the scan, every point of it a
    multi-echo return 1.7–22 m above ground (the crowns' non-last echoes),
    while 20 is 18 % multi-echo (roofs, the last echoes); 17 bridge, 18
    noise, 24 below ground, 26 synthetic ground. Read as GeoSN's (20 only)
    Unna's surface missed most crown tops; `providers/nw.py` now maps
    1/17/20 → 20, 26 → 30 and drops 18/24 (`LSC_CLASSES`), and Unna's
    re-bake found 14 457 scan trees (was 2 385) and 897 small structures
    (was 1 596: crown gaps had read as low roofs).
    München's open DOP is RGB, so its NDVI branch reads the RGB stand-in
    (`ndvi.py`) rather than a near-infrared NDVI, and its flight is
    leaf-on (June 2022): the cue's thresholds are Dresden's, untested
    against either.
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
    > 3 m canopy, ≥ 3 m apart, more than 5 m from any current canopy point,
    off paths, water, carriageways and track beds (`ways.traffic`; until
    2026-10-20 off the whole road and railway class, see *Canopy fill*) —
    8 006 peaks (96 % built-up class; 57 % more than 15 m from the DLM road
    area, 1 969 of them enclosed by buildings on ≥ 6 of 8 rays = courtyards;
    16 % street-side). **Deduplicated against the cadastre in the bake**: the
    cadastre wins position and species, and a peak within max(4 m, the
    cadastre crown radius) of a cadastre tree is dropped (radius match, not
    1:1 — one big crown often yields two peaks) → **5 739 shipped, 2 267
    dropped** in the first bake; **5 788 shipped, 2 528 dropped** (8 316
    peaks) since the re-bake of 2026-09-25 with the current bridges and the
    land cover with the OSM squares carved in, where more trees may stand. (Taking the scan height where the cadastre has none is not
    done: the cadastre bake imputes missing heights and does not mark them.)
    Each peak's crown radius `r` is its watershed share of the crown mass
    (`crown_radii`, from every peak and every canopy and cadastre tree, so a
    neighbour's share stays its own), as a disc of the same area, 1–12 m.
    *(Until 2026-10-20 the distance to the mass's edge at the peak: lone
    scan crowns came out a third of the area DOM1 shows them, against half
    for lone cadastre trees with a surveyed crown — Dresden, Leipzig; in
    Unna the median radius went from 1.8 to 3.5 m, and the circles over the
    orthophoto now cover the crowns they stand in. Saxony's scan trees keep
    the old radii until GeoSN's laser-scan share answers again: on
    2026-10-20 it answered 404 for every tile.)*
    Rendered as ordinary canopy trees.
  - *Rendering* (`low-vegetation-layer.ts`, separate from the tree layer):
    hedges are chains of superellipsoid "clay" blocks (288 tris, ≤ 2.5 m
    pieces, 0.6 m overlap); rooted-base darkening + a static world-space
    foliage mottle; 250 m chunks; cast and receive shadows, no animation
    (ADR 0009).
  - *Cost* (prototype, real GPU, 3200×2000, full block, all candidates):
    hedges + shrubs +11–13 draw calls/frame, frame time 19.8 → 20.2 ms on the
    fly-over; the 8 006 extra trees +4.9–7 % triangles drawn, 19.8 → 23.0 ms.
    Shipped (OSM hedges + 5 739 trees), `kataster-cost.ts`: +9–58 draw calls
    in the main pass over the merged cadastre (fly-over 126 → 144,
    Albertstraße 401 → 459).
  - Bake: `pipeline/bake/lowveg.py` (scipy, scikit-image in the uv
    environment; `lsc.py` rasterises the LAZ with laspy by PDAL's binning
    rules — the committed rasters were PDAL's). The committed files
    were baked by its predecessor (`extract-lowveg.sh`, OSM via Overpass);
    the port reads the hedges from the local extract (ADR 0037).
- **Street lamps** `❝ taken` — OSM lamp points (the local Geofabrik extract, only those
  the tile owns: west and south edges in, east and north out, so a seam lamp
  stands once) → instanced lamp posts (ODbL). `pipeline/bake/lamps.py`; the
  viewer applies the same ownership to older files (`ownsPoint`).
  Gated off **water (8) and railway (5)** land-cover so no poles stand in the
  Elbe or the track bed (the rail corridor is now its own layer). Built per
  fine terrain tile; the three real lights (a phone's one, 2026-10-11) go
  to the nearest heads of the visible tiles.
  **Lamps on bridges** `= computed` (2026-10-20) — a lamp a drawn road or
  path deck holds stands on the deck (`deck`: the deck's top there, from
  its `line` along its `axis`, the viewer's `deckAt`) when its nearest
  highway within 15 m is a bridge or the ground below is water or railway.
  Before, the gate dropped those over water or a railway and stood those
  over a meadow or a street on the ground under the deck, their 5 m posts
  ending in it: Dresden 36 (the Budapester Straße's and the Löbtauer
  Brücke's over the tracks), Hamburg 32 (the Kennedybrücke's over the
  Alster, the Reesendamm's, the Altmannbrücke's), Grimma 11 (the
  Pöppelmannbrücke), München 8 (the Boschbrücke), Meißen 1 (Schloßbrücke).
  One mapped within 2 m of a street's line on the deck — in its lanes —
  stands at the deck's nearer side, 0.4 m in, straight across its axis:
  on the ground such a lamp moves to the class raster's kerb, which on a
  bridge is the ground's under it (Meißen's Schloßbrücke lamp, mapped on
  its lane). A lamp under a rail deck, or beside a street the bridge
  spans, lights that street and stays on the ground. Its post height is
  read in DOM1 over the deck's top, not over the ground below (over the
  river the deck around it was never clear, so no bridge lamp gave a
  reading). **Street furniture on bridges** `= computed` (2026-10-20) —
  by the same rule a bench, bin, bollard, bicycle stand or shelter stands
  on the deck where it is mapped; before, everything on a deck was
  dropped; one in the lanes (a bench, bin, stand, shelter, post box,
  column, picnic table or drinking fountain) moves to the deck's side as
  the lamps do (Meißen's Schloßbrücke bin). Hamburg gains 28 pieces (12
  benches, 7 bins, 6 stands: the Busanbrücke, the Brooktorkaibrücke, the
  Kehrwiedersteg), Meißen 4 (the Johannesbrücke's benches), Dresden 2,
  Grimma and München 1. A signal or hydrant sign mapped in the lanes
  stands on the deck too (2026-10-21, `furniture.py` `ON_DECK_KERB`;
  before, it was left out: the kerb it moves to on the ground is the class
  raster's, the ground's under the bridge). A directed signal goes to the
  right of its traffic, facing it, at its carriageway's kerb (the street's
  `width`, else its class's half-width, + 0.6 m) or the deck's edge if
  that is nearer — a deck over a station's tracks is 30–46 m wide —; one
  without a direction to the nearer side, no farther than the kerb. A
  hydrant sign goes to the deck's nearer edge. A wall clock hangs on a
  facade within reach, else it is dropped. Kept: 11 signals and 3 hydrant
  signs (Hamburg 6 + 1, its signals on the Altmann-, Kornhaus- and
  Rentzelstraßenbrücke; Dresden 3 + 1; München 1 + 1, its signal on the
  Maximiliansbrücke; Leipzig 1).
  **Lamps on a wall** `= computed` (2026-10-20) — a lamp OSM tags
  `support=wall_mounted` or `lamp_mount=wall` (and not on a wire) hangs on
  the facade when an OSM outline lies within 1.5 m of it: its head 3.5 m up
  and 0.5 m out of the facade on the side no building covers, on a short
  bracket from the wall (`wall`: its foot), with no post. The 3.5 m is the
  Mapillary photo at Meißen's Burgkeller, lanterns on brackets at about the
  first floor. Before, they stood as 5 m posts in the facade line, and
  `lamp-heights` read the eave above them as a post. Meißen hangs 16 of its
  24 wall lamps on a facade, Dresden 5; no other city tags one where a
  facade stands. München's lamps on wires were already hung (71 across
  its streets). Seven more of Meißen's hang on the Burgberg's terrace walls
  by the Schlossstufen (2026-10-21, `on: "wall"`, `lamps.py` `Walls`):
  with no outline within 1.5 m, a mapped wall, retaining wall or city
  wall within 1.5 m holds the lantern, its bracket's foot on the wall's
  line. It hangs on the low face where the DGM 2–4 m either side differs
  by 0.5 m or more, at min(3.5 m, the step − 0.5 m) in 0.5 m steps (6 at
  3.5 m, 1 at 3.0 m); a freestanding wall at its tagged height, else its
  kind's default, on the side of the nearest street (else the side the
  lamp is mapped on). A wall lower than 3 m — a garden wall — holds none.
  One stays a post. The card's lineage names the wall and the side the
  DGM told.
  **Lamps hung across the street** `= computed` (2026-10-08) — OSM maps the
  old town's catenary lamps (Äußere Neustadt: Alaunstraße, …) in the
  carriageway, where they stood as posts in the traffic. A lamp hangs when
  `support`/`lamp_mount` = `suspended`/`wire` says so, or, untagged, when it
  stands in the road class within 2 m of a street's centre line with
  facades (OSM outlines) closing both sides within 12 m; its wire runs
  across the street to the facade on each side (within 20 m, a 2.5 m
  corridor either side so a gateway does not miss the wall) or to a mast at
  the kerb, its head 7 m up, the wire's ends 0.6 m higher (the sag). Any
  other lamp in the road class moves to the nearest kerb. Dresden: 19 hung,
  nearly all tagged (OSM tags `support=suspended` on 17 lamps, 16 of them in
  the road class; ~480 untagged lamps stand in it, most a pole the road's
  width covers). The wires are the trams' ribbons (`wire-ribbons.ts`), in
  the posts' dark metal so the head reads as hung. Mapillary's lamps in the
  carriageway hang by the untagged rule too (Dresden: 142, most of them in
  the Äußere Neustadt, re-baked 2026-10-08).

- **Lamp post heights, street by street** `= computed` (2026-10-20) — every
  post stood 5 m tall, from a pedestrian lane to a six-lane road. The
  surface model shows the posts where the scan caught them: at a lamp clear
  of trees and facades the highest DOM1 − DGM1 texel within a metre is its
  head. Leipzig's primary roads' lamps read 10 m (quartiles 7.6–12.6 m), its
  residential streets' and footpaths' 5 m; Dresden's Ostra-Allee 8.3 m, the
  Sarrasanistraße 3.4 m; Mapillary's photos of a few of them agree (8–12 m
  masts with arms on Leipzig's and Hamburg's main roads). One lamp is a
  poor reading — the scan misses a thin post as often as it hits it (a
  quarter of Leipzig's read under a metre), a van or a branch reads as one,
  and the readings along one street spread by 1.6–1.8 m (interquartile) —
  but a street's lamps are alike, and the streets differ by more (3.4 to
  10 m). So `lamp_heights.py` gives every post on a street with three
  readings their median, a post on another its kind of street's on the tile
  (main, mid, residential, walk; ten readings), else the 5 m it had (`h`,
  `hs`); a reading must stand alone (a crown over a lamp is tall over
  metres: Hamburg's footpath lamps read 7.4 m without that rule, 6.8 m with
  it) over clear ground. The viewer draws one post set per height and a
  taller post's light pool wider (`lamp-layer.ts`); the card says the
  height and how it was found.
  **Arms (Ausleger)** `≈ assumed` (2026-10-21) — a post from 7 m up
  (`ARM_MIN_H`), or of any height that OSM tags `lamp_mount=bent_mast`
  (`bent`, `lamps.py`), holds its head on an arm (`arm`: one compass
  bearing, `lamp_heights.py` `arm_of`) reaching to the nearest
  carriageway line within 15 m, a street's before a service way's
  (`carriageways`); a post standing on that line (within 0.5 m) gets
  none. DOM1 shows why 7 m: at clear lamps the highest texel lies a median
  0.3–0.6 m towards the carriageway at 5–7 m (the mapped point's own
  scatter) and 1.0–1.3 m at 7–8 m (Hamburg's 6.5–11 m masts 2.0–2.7 m);
  Mapillary's photos show arms and bent masts from 7 m and heads on top
  of posts of 4–5 m. Where a service way is nearest and a street in reach
  too, the head reads a median 1.9 m towards the street and none towards
  the service way. A second arm between a dual carriageway's lines was
  dropped: DOM1 shows a head on both sides at 1 of 53 such masts, no more
  often than beside one carriageway. The viewer draws an arm of 0.2 · h
  (1.2–2.5 m, `lib/city/lamps.ts` `armReach`) leaving the pole 0.35 m
  under the head and rising to it, a flat cap over the head, the head, its
  light and its pool at the arm's end (`lamp-layer.ts`); the card's
  lineage names the carriageway it reaches over. The bearing is set
  without DOM1 too (a bent mast keeps 5 m and its arm). Dresden 331 arms
  (131 of them bent masts under 7 m) and 253 on Mapillary's lamps,
  Hamburg 926 of 1 933 posts (38 bent), Leipzig 31, München 25 (bent
  masts).
- **Street lamps OSM lacks, from Mapillary** `◎ detected` — Mapillary's
  detected street lights ("map features": `object--street-light`, each
  one triangulated across the street photos that saw it; CC BY-SA 4.0)
  fill in where OSM is thin. On Dresden's spawn tile OSM maps 339 lamps;
  Mapillary places ~1 500 street lights, of which 125 lie within 5 m of an
  OSM one (its positions are 2–6 m off; median 4 m against the OSM lamps
  it matches). Kept: seen since 2020; **seen well** (2026-10-21,
  `seen_well`): some image within 25 m of where it was placed (seen only
  from farther, it lay along a long ray, as a bridge's lamps did on the
  meadow below), and some image taken with the sun above −12°
  (`dop_light.solar_position`; at night the detector takes headlights and
  lit signs for street lights); not a tunnel's lighting laid on the ground
  above (within 20 m of a road in a tunnel and nearer it than any way on
  the ground, `Tunnels`: Meißen's ten over the Schottenbergtunnel); the
  two detectors' copies of one object merged within 4 m; nothing within
  8 m of an OSM lamp; nothing inside a LoD2 footprint (a facade lamp, or
  a placement through the wall); one in the carriageway moved to the kerb,
  none on water, railway or a bridge deck (furniture.py's gate); kept
  lamps 7 m apart (one lamp placed twice from two sequences). *QA
  2026-10-21:* of 45 kept lamps from before the gate (Grimma, Meißen,
  Unna), 31 were real, 7 wrong, 7 unclear; the gate kept all 31 real
  lamps and dropped 5 of the 7 wrong ones; two or more images says
  nothing (98–100 % have that many). Precision after the gate: Grimma
  ~75 %, Meißen ~57 % before the tunnel rule, Unna ~83 %. Lamps after
  the re-bake of 2026-10-21: Dresden 5 439 on fifteen tiles (6 792
  before the gate), Grimma 949 (944 on 33340_5678, where OSM maps 66),
  Meißen 122 (OSM 696), Unna 133.
  Stood by the lamp layer like OSM's; the card names Mapillary. Its own
  file (`dlm/mly_<t>.geojson`), never merged into the OSM files: ODbL and
  CC BY-SA do not mix in one database. `pipeline/bake/mapillary.py` (the
  fetch caches the tile's street lights with each image's place and time
  under `<raw>/mapillary/<t>.v2.json`, it needs `MAPILLARY_TOKEN`; without
  that cache the file is empty and the lamps are OSM's alone),
  `lib/city/mapillary.ts`; per site `Site.mapillary` with `objects`
  (Dresden, Grimma, Meißen, Unna), whose credit joins the footer
  (`mapillaryCredit`: "Lampen, Schaufenster", or "Lampen" alone where no
  panorama is measured — Unna, `panoramas: false`). Its litter bins are
  no longer taken (🗃️ below). *Not yet:* Hamburg and München (Hamburg
  2 731 raw, 745 kept against OSM's 553; München 5 180 raw, 2 273 kept
  against 461; 3 of 12 sampled in each were lamps hung on wires drawn as
  posts — they need a hang decision from the photos or DOM1). Not (yet): Mapillary's benches and bicycle
  stands (fewer than OSM's: 111 and 48 against 587 and 292 on the spawn
  tile), traffic signs (no layer draws them), signals (OSM's are placed by
  the direction they face, which a detection lacks).

- **Facade readings from street photos (experimental)** `◎ detected` —
  Mapillary's panoramas of a street front (since 2016; on Dresden nearly
  all from 2025), rectified onto the LoD2 wall with their computed poses
  and masked to the "building" class, give
  per wall the share of the upper wall that is not plain render (openings,
  frames, stucco, glass), the share clearly darker than the render, and
  how open the ground floor is; two sequences of one wall agree at
  Spearman ρ 0.66–0.71 (window size, window count, storey height and
  "ornament" did not, and stucco cannot be told from glass). A building
  takes the length-weighted median of its walls, graded: busy 1–3 (busy
  only where two sequences saw it), dark 1–3, and a shop where a shop sign
  hangs within 4 m of the wall or the ground floor is more than 80 % open.
  On Dresden 2 798 walls of 1 957 buildings over thirteen tiles (864 walls
  and 614 buildings on the spawn tile, a third of its street fronts;
  courtyards hardly at all; two tiles have no usable panorama). Since
  2026-10-09 every committed site with panoramas is measured the same way
  (`Site.mapillary`; its detected objects — the lamps alone since 2026-10-21
  — are taken in Dresden, Grimma, Meißen and Unna, `objects`):
  Leipzig 1 635 buildings on four tiles, Hamburg 109, Meißen 49, Grimma
  229 (its eastern tile has no panorama), München 3 609; Unna has no
  panorama at all, only flat photos. Its own file
  (`dlm/facades_<t>.json`, CC BY-SA 4.0), read at runtime into the flags
  column above the OSM bits (`lib/city/facade-reading.ts`); the clay draws
  a fine plaster relief lit from above on mid and busy facades, a tone a few per
  cent darker or lighter, a ledge at every storey of a busy front under a
  pitched roof, and the shop zone of a signed shop (*Fassadenbild*,
  `visual-style.ts` `facadeReading`). No windows from this reading: its
  window size, count and storey height did not agree between two drives
  (the windows' rhythm comes from the traits measured since, *Windows on
  every house*).
  The photo analysis is the `facades` step (`pipeline/bake/facades.py`,
  `facade_measure.py`): `bun run fetch` plans the walls, asks Mapillary
  for each panorama's pose and segmentation, measures its 2048 px
  thumbnail on every wall it serves and deletes it, caching only the
  measurements (`<raw>/mapillary/facades/<t>.jsonl`); `bun run bake
  --step facades` grades them per building. 13 717 panoramas measured
  for Dresden's fifteen tiles in about an hour (the spawn tile's 3 341 in
  six minutes); re-baked from the step, the spawn tile agrees with the
  spike's hand-converted file on busy for 584 of 590 shared buildings and
  on dark for 581; shop is set on 59 more, since the step joins the store
  signs per building (the spike's table had matched them to walls by an
  index from a different wall list).

- **Shopfronts from street photos (experimental)** `◎ detected` `≈ assumed` — the same
  panoramas measured once more per wall (`<raw>/mapillary/facades/<t>.v2.jsonl`;
  the first fetch's cache stays): the ground floor's profile along the
  LoD2 wall in 0.5 m bins from its start vertex — how open each 0.3 m row
  of the band 0.3–3.4 m is against the ground floor's own plaster (the
  brighter half of its smooth pixels: a mean over piers and glass, as the
  upper-wall reading takes, makes a whole shopfront read open), where
  Mapillary's segmentation finds a store sign (`object--sign--store`, its
  band in metres), and the top of wide, low openings. Per wall
  (`pipeline/bake/shopfronts.py`) each sequence's median profile is shifted
  onto the best-seen one by the best correlation within ±1.5 m (taken only
  where it beats no shift by 0.15 and reaches 0.5), every image votes per
  bin — open where both knee height (0.6–1.2 m) and eye height (1.2–2.4 m)
  are at least 60 % open, so a house window above its sill and a dark
  plinth are no opening —, two images must agree, and the runs of open
  bins at least 1.2 m wide are the bays (three or more of nearly one width
  take their median width; none is added). A **glazed row** — the bins
  any image saw at least 75 % open over at least 6 m of the wall, the
  modernist shop rows the boulevard's panoramas see one stretch at a
  time — takes one image's verdict where no other looked and bridges
  unknown gaps up to 1 m (a tree trunk, a column): its glass runs from
  pier to pier (`row`). A wall is a shopfront with a bay over at least
  half its decided bins, as a glazed row, or with a store sign seen twice
  (or once beside a Mapillary sign feature). Over a shopfront the surface
  model may show a **canopy** (`canopy`): per metre along the wall nDOM =
  DOM1 − DGM1 every 0.5 m out to 8 m; where it is 2.6–6.5 m high a metre
  out, no higher than the building behind, and stays level (−0.6/+1 m)
  until it drops off, that is the canopy's depth; runs of at least 4 m
  (one miss bridged) keep their median depth and height. Under a canopy
  the glass runs its whole length but for runs of 1.5 m or more two
  images agree are wall — the Hauptstraße's GDR pavilions are glass from
  end to end, and their canopy's shade and columns break the photo
  profile up —, and a wall of the same LoD2 object facing the same way
  that no photo measured gets the row too where its canopy goes on
  (`src: "canopy"`). `dlm/shopfronts_<t>.json` (per Building, per wall:
  base points in the tile's CRS, bays, sign, ground-floor top, canopies;
  credited to Mapillary and, with a canopy, GeoSN). All fifteen Dresden
  tiles measured (2026-10-08: 13 717 panoramas — the spawn tile's 3 341
  first, the other fourteen tiles' 10 376 in 30 min of fetch at ≈ 6
  images/s on four cores): 1 003 shopfront walls on 780 buildings, 223 of them
  glazed rows, 19 under a canopy (3 of them continuing one). The other
  cities (2026-10-09, `Site.mapillary`, the same step and constants):
  **Leipzig** 7 945 panoramas on four tiles, 1 130 shopfront walls on 843
  buildings (226 glazed rows, 11 under a canopy — its DOM1 fetched for
  this); **München** 22 212 panoramas, the most of any city (11 679 on the Marienplatz tile, 10 362 of all of them from 2026), 3 079 walls on 2 229 buildings (889 glazed rows; no DOM1 on disk, so no canopies) — on the Marienplatz tile 1 741 of the 3 231 walls seen, a larger share than anywhere else, worth a look for false openings (arcades, dark plinths); **Hamburg** 842 panoramas (61 on the
  Jungfernstieg tile), 152 walls on 112 buildings (33 glazed rows; no
  DOM1 on disk, so no canopies); **Grimma** 855 panoramas, all on the
  old-town tile, 79 walls on 75 buildings (12 glazed rows); **Meißen** 196
  panoramas, 23 walls on 21 buildings; **Unna** none — Mapillary has only
  flat photos there (1 676 in the square kilometre at the old-town
  tile's centre, not one panorama), which the rectification cannot place on a wall, so Unna is
  left without `mapillary`. The panorama search now asks for a cell the
  API keeps answering 500 on in quarters, as it does a full one
  (Leipzig's centre). Noisy: two
  sequences' profiles correlate at a median 0.31 unshifted, 0.56 after
  the shift; a single image misreads graffiti and painted panels as
  openings; a long wall is often seen by two images only. The building
  bake draws them (`lib/city/shopfronts.ts`, `appendShopfronts`, column
  `source` = 6), soft and abstract (*Weiche Nische*, 2026-10-08): per
  run of bays a surround 15 cm proud with rounded outer edges, a niche
  per bay whose reveal rolls into the front over a 7 cm quarter round
  (smooth normals), the glass at the niche's back 6 cm out of the wall
  from 0.5 m (a glazed row: 0.3 m) to the measured ground-floor top (3 m
  where none; under a canopy's slab, into which the head reaches over
  a strip of wall under 0.25 m) —
  no mullions, no frame boards —, a rounded fascia band 10 cm proud at
  the measured sign band (none under a canopy: its fascia is the sign
  band); a canopy is a slab 0.3 m thick under its measured top from the
  wall out to a 0.2 m deep fascia at its edge, at most 1 m tall, with
  2.6 m headroom, its outer edges rounded, in the host's own clay (its
  columns are not measured and not drawn). The glass is a muted tone a
  little darker and cooler than its wall (not black), with the head's
  soft shadow over its top (`paneShade`); it is smooth (roughness 0.2)
  and catches the sun calmly; the upper pane and a grazing view hold a
  calm sky (`paneSky`), so it reads as glass
  out of the sun too. Shop windows on a shop's ground floor are the one
  exception to the glass veto (🗃️ *Procedural window grid*, user
  decision 2026-10-08); a wall no photo shows as a shopfront gets none
  (🗃️ *A shop window at an OSM shop node*).
  **Passages** (2026-10-21, G20): a bay crossed by an OSM
  `tunnel=building_passage` or `covered=arcade` way (4 m inside the wall
  to 1 m out) is no shop window; the wall keeps its sign and canopy.
  Dresden 8 of 1 147 bays, Leipzig 10 of 1 476, München 31 of 4 774,
  Hamburg 1 of 165, Meißen and Grimma none. Without the facade cache the
  step only takes the passages out of the committed file (it used to
  write an empty one).

- **Windows on every house (*Fenster*)** `◎ detected` `≈ assumed` `= computed` —
  drawn by the clay ([ADR 0010](./adr/0010-opaque-clay-buildings-only.md)), their rhythm
  measured where street photos saw the house and inferred where not.
  **The measurement:** the same panoramas measured a third time per LoD2 wall, over the upper
  storeys (from 3.6 m to 0.3 m under the eave; `<raw>/mapillary/facades/<t>.v3.jsonl`,
  the v1/v2 caches stay; `pipeline/bake/facade_traits.py`): column and row
  profiles in 0.1 m bins of how dark the wall is against its local plaster
  and how much of it is an opening, the plaster's vertical and horizontal
  edges, its fine texture, the openings' surround against the plaster
  further out, and the ground floor's plaster rows. Two drives' poses
  differ by about 0.6 m, so *where* a window lies is not reproducible —
  the facade-reading spike found window size, count and storey height did
  not agree (2026-10-07). The bake (`pipeline/bake/windows.py`, step
  `windows`) therefore reads only features that do not move with the
  camera: the column profile's period (autocorrelation: the **window
  axis** spacing, 1.2–7 m) and its peak (**grid** regular ≥ 0.45, loose
  ≥ 0.25), the row profile's period (**storey**, 2.6–5 m), the openings'
  **share**, the profiles' dark duty times their periods (**width**,
  **height**, **proportion**), the surround (**Fasche**), horizontal edges
  recurring at the storey (**sill band**), vertical edges at the axis
  (**lisenes**), the texture (**ornament**), the ground floor's tone step
  and joints (**plinth**, height, **rustication**) and a fine joint grid
  both ways (**panel joints**). Only images that see at least half the
  upper wall at 7 cm a pixel or finer count (over every image the axis
  agreed at ρ 0.58, over these 0.72 on the spawn tile); a wall's value is
  the median of its sequences' medians. Each feature's reliability is
  **Spearman ρ between the two sequences with the most images on each
  wall**; only ρ ≥ 0.6 over at least 30 walls may drive the model, fixed
  in the code from Dresden's tiles pooled (2026-10-09, 1 931 walls with a
  usable image on thirteen tiles):

  | feature | ρ pooled (walls) | ρ spawn tile (walls) | drives the model |
  |---|---|---|---|
  | axis spacing | 0.667 (273) | 0.717 (122) | yes |
  | grid (peak) | 0.684 (334) | 0.676 (154) | yes |
  | storey height | 0.605 (186) | 0.745 (90) | yes |
  | opening share | 0.710 (334) | 0.733 (154) | (recorded) |
  | darkness | 0.745 (334) | 0.784 (154) | (recorded) |
  | width duty | 0.662 (333) | 0.650 (153) | via width |
  | height duty | 0.465 (329) | 0.390 (150) | no |
  | window width | 0.640 (273) | 0.678 (122) | yes |
  | window height | 0.615 (182) | 0.616 (87) | via proportion |
  | proportion | 0.656 (156) | 0.713 (72) | yes |
  | Fasche (surround) | 0.509 (239) | 0.545 (115) | **no** |
  | Fasche, signed | 0.559 (239) | 0.551 (115) | **no** |
  | sill band | 0.534 (85) | 0.649 (48) | **no** (passed on the spawn tile alone) |
  | lisenes | 0.565 (143) | 0.494 (69) | **no** |
  | ornament | 0.711 (319) | 0.743 (149) | yes |
  | plinth tone | 0.594 (133) | 0.512 (67) | **no** |
  | plinth height | 0.549 (133) | 0.437 (67) | **no** |
  | rustication | 0.528 (143) | 0.517 (70) | **no** |
  | panel joints | 0.466 (334) | 0.505 (154) | **no** |

  A wall gets a **model** where at least two images found an axis period
  and 60 % of them lie within 15 % of their median, the period is a window
  rhythm (1.8–4.8 m: not a stucco band, not its double) and the grid is
  regular or loose — no window on a wall without that measurement: the
  axis spacing; the window's width measured (0.7–2.2 m, a 0.6 m pier
  kept) and its height from the measured proportion (0.8–2.4 m), else
  Dresden's medians (width 0.44 of the axis, width over height 0.77); the
  storey where measured (2.8–4.6 m); ornament where the texture is in
  the upper third. `dlm/windows_<t>.json` (per Building, per wall: the
  wall's base points, its eave, images and sequences, every trait, the
  model; the tile's ρ table; credited to Mapillary, CC BY-SA 4.0); a tile
  without traits writes an empty file. **Dresden, 2026-10-09:** 13 717
  panoramas fetched again in ≈ 75 min (three workers), 1 931 walls with
  traits, 588 modelled (389 regular, 199 loose, 409 with a storey, 108
  with ornament) on 527 buildings; two tiles (33408_5656, 33416_5658)
  have no panorama on their walls and 33410_5654's see too little.
  **The rhythm per building** (`lib/city/windows.ts` `windowSpecs`, in
  the building bake; one more band of the object table, `WindowSpec`:
  axis spacing, width, height and a style word), best first: the
  model on the building's own walls (the wall most images saw); another
  part of its building; the nearest measured building within 30 m (150 m
  until 2026-10-21, G14: on Dresden's sample tile the rhythms lent fell
  from 1 211 to 278) with the same roof form and an eave within 4 m or 35 % (score: distance +
  10 m a metre of eave — a block's houses share their era); its **type**
  — a town house (pitched roof, storeys from 3.3 m), a walk-up (lower
  storeys), a house (eave ≤ 6.5 m), a block (flat roof, eave ≥ 7 m) or a
  low flat building. A type's numbers are Dresden's measured medians
  (`scripts/windows-report.ts`, 2026-10-09: town house 442 walls, axis
  2.72 m, width 1.18 m; walk-up 104, 2.68 m, 1.14 m; block 37, 2.62 m,
  1.05 m; house 5, 2.56 m, 0.94 m): axis 2.7 m (house 2.6, low 3), width
  1.15 / 1.1 / 0.95 / 1.2 / 1.4 m. A window's **height follows its
  storey**: its head 0.75 m under the next floor in a town house, 0.55 m
  in a walk-up, 0.5 m in a house, 0.45 m in a block (at most 2.4 / 1.8 /
  1.45 / 1.6 m), the sill 0.85–0.9 m over the floor; a measured height
  scales that by its share of the type's median (the photos read
  openings short — the reveal's shade, curtains —, a town house's 1.63 m
  median against the 2 m its storeys give). A measured rhythm is drawn
  towards its type's (`TOWARD_TYPE`: the ratio to the type's value to a
  power, bounded — the axis ^0.75 within 0.75–1.35, the width ^0.5
  within 0.8–1.25, the height's share ^0.5 within 0.85–1.2): one wall's
  reading is noisy (ρ 0.64–0.67 between two drives), and a row of houses
  whose windows differ by half reads restless (Königsbrücker Straße's
  measured widths ran from 0.78 to 1.97 m side by side). The storey
  snaps so that a whole number of floors reaches the eave (OSM's levels
  first, else the photos', else the height's estimate), and is written
  into the object's row before the plinths and shopfronts read it. A
  town house gets a Fasche round each window and a raised ground floor
  (its windows 0.45 m higher, their heads where the upper floors' are),
  and every ground floor's windows open at least 0.2 m over its
  plinth's top — its highest piece, so a plinth stepping up a slope
  lifts them —, and over the ground in front of every wall, read in the
  tile's fine terrain 0.5 m out of the wall every 2 m along it, also of
  a wall standing on a step of its building, not where the ground lies
  more than 1 m under the wall (a wall over a lower roof) (`wallRises`;
  2026-10-19/20, Manuel: the windows sank into the Brühlsche Terrasse —
  the plinth pieces alone reach only open street runs of buildings from
  5 m, so the Kunstakademie's terrace walls had no ground under them).
  The plinth pieces' tops are levels like the ground's, not a floor for
  every wall. The lift is a class of 0.05 m up to 1.55 m; a wall whose
  ground or plinth rises past its reach (at most 2.2 m over the base,
  `GROUND_REACH_M`, and no higher than leaves the ground floor's windows
  at least 0.8 of their width tall, `overGround`; a shop's: its first
  floor's) loses its own ground floor, signed like a shopfront's, the
  building's other walls keep theirs. Such a wall keeps that height
  (`_FACADE`'s first door slot) and draws no row under it, so where the
  ground rises more than a storey the upper floors' windows go too (the
  Kunstakademie on the terrace). Dresden, 2026-10-20: wall feet whose
  windows the fine ground covered 11 925 → 0 (of ~610 000), objects
  without a ground floor 6 258 → 3 590 (the rest are shops). **The storeys
  count from the street** (`liftToStreet`): a LoD2 base is the lowest
  ground round the whole footprint — a courtyard's, a light well's, a
  cellar ramp's — and lay a median 0.3 m under the street on the spawn
  tile, so each LoD2 object's base moves up to its building's street
  level where its plinths say where that is (the highest of its pieces'
  lowest ground, at most 1 m over the lowest), from at most 1.5 m under
  it, its eave staying where it is; the storey lines, the Gurtgesims and
  the windows then start from the pavement, not behind the plinth; a
  measured or borrowed loose grid shifts each axis by up to 8 % of the
  spacing (a hash per column), measured ornament a Verdachung over each
  window. **None** on a facade of its own (a church or hall — ALKIS
  function or OSM storeys over 5.5 m —, not a Wikidata landmark's flag
  alone: most are town houses) except a palace's: a public use (ALKIS
  `31001_3010`–`3072` but the churches' 3038–3048 — a Schloss, museum,
  theatre, parliament, court, school, hospital; no barracks, bunker or
  prison, no station, no sports hall; `palatialFacade`) gets the type **palace**
  (3.6 m axis, 1.45 m wide, up to 3 m tall, a Fasche, 21 cm reveals) on
  storeys of OSM's count where it gives 2.4–7.5 m, else the eave split
  into ~5.5 m storeys (`palaceStorey`), and only its own walls' measured
  rhythm, never a neighbour's (2026-10-19: the Zwinger, Albertinum,
  Japanisches Palais, Residenzschloss and Landtag stood blank; 540
  objects in Dresden gain windows, none lose any). None on glass or
  metal, on a garage, shed, warehouse or plant (ALKIS 2461–2464, 2513,
  2522–2523, 2720–2729), under 3.2 m of wall, or on a part the bake adds
  (the scan's sheds, gaps, dormers, shopfronts).
  **Where on its wall** (`facadeAttribute`; the glTF's `_FACADE`, a
  snorm16 vec4 per vertex, 512 m a unit): metres along the wall from its
  middle, the wall's length — negative where its ground floor has no
  windows (over a shopfront, or with more doors than the two slots), 0 on
  a party wall —, and up to two of OSM's doors along it, each its place
  (in 0.1 m) and its width rounded up to a class (0.2 m steps to 2 m,
  whole metres to 6 m, the widest OSM width the doors bake takes) in one
  code: a ground-floor window keeps at least 0.6 m of wall between its
  opening and a door's (the door's surround, a pier); a roof vertex carries
  −1 in the first door's slot, the clay's roof flag. A wall is one object's coplanar,
  vertex-connected triangles; a party wall is one with another wall back
  to back against it (opposite normals within 10°, planes within 0.5 m,
  over a quarter of it covered). Positions along the wall are not
  measured, so the axes are centred on it with 0.7 m of wall kept at its
  ends.
  **The drawing** (`app/_components/clay-windows.ts`, in the clay's
  fragment pass, walls only): per storey a row of openings from the
  ground floor's (a top floor's windows end 0.5 m under the eave, under
  the Traufgesims, shorter if they must, none if less than 0.55 m is
  left) — a **recess**
  the eye looks into, 9–18 cm deep by type (the ray against its box: the
  back, a side reveal or the head or sill reveal, each with its normal
  and its share smoothed over the pixel's footprint), its reveals the
  wall's plaster ×0.93, its back the wall's colour ×(0.40, 0.43, 0.50),
  lit by a quarter of the sun plaster would get, the sun reaching in only
  through the opening and only where it falls on the wall at a fair angle
  (`receivedShadowNode`); a sill 6 cm tall and 4.5 cm proud, 6 cm past
  the opening either side, throwing the sun's shadow down the wall; a
  Fasche 11 cm wide, 1.5 cm proud and 3.5 % lighter, with a hairline of
  contact shade; a Verdachung 9 cm tall, 5 cm proud; the wall rolling
  into the opening over a 3 cm quarter round at its sides and head
  (normals only, where it spans a pixel). Every edge is anti-aliased by
  the pixel's footprint along the wall and up; where a window is under
  6 pixels wide the drawing fades into the facade's mean tone (the wall
  darker by 0.6 × the openings' share of a storey) and under 2.5 pixels
  only that tone is left, so a far street does not shimmer. At night 25 %
  of the windows glow warm, at 0.6 of *Abendlicht* (a hash per window,
  `NIGHT_WINDOWS`; 40 % at full until 2026-10-19).
  *Fenster* at full strength (`WINDOWS`, fixed). **Drawn on Dresden's
  spawn tile** (2026-10-09): windows on 308 buildings measured, 1 223 by
  a neighbour, 1 638 by type; of the window-carrying wall area 70 % has
  windows, 27 % is party wall, 3 % stands over shops (over all fifteen
  tiles 891 measured, 4 823 by a neighbour, 31 361 by type; 69–80 %
  windows). Of the objects with 3.2 m of wall or more, the spawn tile
  leaves plain only the facades of their own — 122 Wikidata landmarks
  (churches, palaces, ministries, halls: ALKIS function, or OSM's storeys
  over 5.5 m) and one glass front — and 11 garages and sheds. The building glTF
  trades its float roof flag for the snorm16 vec4 that carries it too (4
  bytes a vertex more): over the fifteen tiles 6.1 % more to download, 15 %
  more GPU buffer; no window adds a triangle (the plinth and band pieces,
  following the street-level storeys, 1.1 % more). Replaces the geometry niches
  (🗃️ *Window niches as geometry*). User request 2026-10-09: "Details für
  die Fassaden von deutlich mehr Häusern (möglichst allen)".
  **Facade heuristics** (2026-10-21, G2). *Flat-roofed town houses*
  (G10/G13, `flatTownHouse`): housing (ALKIS `31001` without a commerce
  `2xxx` or public `3xxx` use) from 9 m of wall whose storeys are 3.4 m
  or more (OSM's count, or the neighbours' storey) or that is listed is a
  town house under its flat roof — windows of type `tall`, the plinth and
  the cornices, not a block (a 9 m bound: Meißen had 412 "town houses"
  without it, four in five under 9 m). Town houses among the flat-roofed
  houses from 9 m on one sample tile per site: Leipzig 805 of 986,
  Hamburg 241 of 326, München 296 of 676, Dresden 190 of 483, Unna 61 of
  382, Meißen 102 of 183, Grimma 32 of 76. *Window frames only on rendered
  walls* (G12): a type's Fasche is not drawn on brick (a measured one
  stays); Hamburg 656 removed, Dresden 129, München 66, Leipzig 4. *A
  wall's own eave* (G22, `WALL_EAVE`): a wall whose roof edge stands over
  its object's eave carries the difference in `_FACADE`'s second door
  slot where it holds no door (code 32 412 + round(Δ / 0.1 m)), and its top row sits under its
  own eave; no new buffer or varying; 36–62 % of the wall triangles carry
  one. *Party walls of low houses* (G16, `PARTY_LOW_EAVE_M`): a house of
  at most 9 m of wall whose party wall (over a quarter covered) rises at
  least 2 m over the neighbour's top gets windows above it; 3.7–12 % of
  the party-wall triangles reopened. *Structures windowless* (G17): an
  object whose ALKIS function lies outside `31001` (a tank, a silo, a
  crane, a canopy) gets no windows, doors, plinth or shop band; the card
  says *Nutzung ohne Fenster* (`noWindows: "use"`); windowed structures
  → 0 on every sample tile.

- **Street furniture** `❝ taken` `≈ assumed` — OSM benches (`amenity=bench`, points and the
  ways a bench is sometimes drawn as), picnic tables, litter bins
  (`waste_basket`), bicycle stands (`bicycle_parking`, not wall loops),
  bollards, post boxes and stop shelters (`highway=bus_stop` /
  `public_transport=platform` with `shelter=yes`, `amenity=shelter` of
  `shelter_type=public_transport`; one per 8 m) → one point layer per tile
  (ODbL), about 3 000 objects over the four first tiles when first baked;
  11 782 of every kind (plan 030's included) over the fifteen tiles
  (2026-09-26). OSM seldom says which way
  a bench looks (`direction`, on ~3 %), so **the bake turns an untagged
  object to the nearest highway within 25 m** (across it when it stands on
  it); a bench way stands at its midpoint at its mapped length, facing the
  path side. Only what the tags carry varies: `backrest=no` benches are
  stools, a stand's `capacity` gives its hoops (two bikes each). A bench,
  stand, bin, post box, column, stop or shelter mapped in a street's lanes
  (the road class, the nearest way a carriageway, `STREETS`) moves to the
  nearest kerb (2026-10-08: Alaunstraße's stands stood in the lane); in a
  square, a pedestrian zone or on a platform — the road class covers those
  too — it stays where it is mapped. Dropped:
  indoors, underground, classes 5 and 8, under a bridge deck (the terrain
  there is the river or the road it spans); on a bridge's road or path deck
  a piece stands on the deck (2026-10-20, below). A bollard keeps its tagged `height` and a metal
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
  mapped as areas, planters, traffic signs (OSM maps ~100 here) and
  street-name signs (almost none).
  **Facing the water** (2026-10-21): a bench without a `direction` with
  water (class 8) within 12 m on the side away from its way (±60°) looks
  at the water, and so does a playground's piece (Hamburg 200 of 1 413
  benches, München 101, Dresden 47, Leipzig 16). **Bin colours:** a bin's
  own `colour`, else the site's when ≥ 20 bins are tagged and ≥ 60 % agree
  — Hamburg's red (850 of 868); München stays grey (85 % of its 435
  tagged), its own-tagged blue and green kept. Five muted tones besides
  the grey (`binRed`, `binGreen`, `binBlue`, `binOrange`, `binYellow`).
- **Signs and fixtures** `❝ taken` `≈ assumed` (plan [030](./plans/completed.md#030--more-street-furniture-columns-signals-hydrants-clocks-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019)) —
  the same bake and layer, eight more kinds (the counts below are the four
  first tiles', BBBike 2026-09-19; over the fifteen: 175 columns, 786
  signals, 24 hydrants and 1 482 sign plates, 20 + 3 clocks, 15 drinking
  fountains, 231 bus-stop signs): **advertising columns** (`advertising=column`, 85; a pale
  paper drum on a plinth with a darker ring and dome, three poster fields
  in the palette wrapped round it — colour, no text, turned by the scatter
  yaw so no two read alike; the 4 `lit=yes` ones glow softly with the
  night factor), **traffic signals** (`highway=traffic_signals`, 288: a
  3.2 m grey pole, a three-lamp head a shade deeper than the metal, the
  glass barely darker and unlit — the viewer has no
  traffic to time. The node sits on the carriageway at the stop line, so
  with `traffic_signals:direction` the bake **walks it to the kerb on the
  right of the traffic it controls** — the kerb from the class raster, ≤ 15
  m — and turns the head to face that traffic; without a direction it goes
  to the nearest kerb, facing the nearest way; kept where it is off the
  road), **fire hydrants** (`emergency=fire_hydrant`: the 6 pillars a
  0.8 m red-ochre pillar; the **454 underground** ones only their
  sign plate on a post (the red-bordered white plate abstracted to one soft
  rose field), moved out of the lane to the nearest
  kerb — **drawn at 70 %**, the plan's STOP fallback taken without a GPU
  plate: the smaller plates were chosen over dropping them), **clocks**
  (`amenity=clock`: 8 on a pole as a double face on a 3.5 m post; 3 of the
  8 wall clocks hung on the nearest OSM building outline ≤ 3 m, facing out
  — the plan asked for a ray against the LoD2 BVH, the bake uses the
  outlines for the same reason as the tram rosettes; tower clocks and
  sundials dropped), **drinking fountains** (`amenity=drinking_water`, 8: a
  slim bronze column with a small basin) and the bus stop's **"H" sign**
  (`highway=bus_stop` without `shelter=yes`, 79, dropped within 8 m of a
  shelter: the "H" abstracted to colour fields — a soft green disc in a
  yellow one, no letter — on a 2.6 m pole, a timetable box —
  shared with the tram stops of plan 024). The clocks' hands show the
  **scene time**: two hand quads per face, turned in the vertex shader from
  one shared uniform that `setSun` updates on the minute only
  (`setClockTime`); the hands (a soft slate, not black) never cast, so
  the shadow map is not redrawn for them. All in the furniture's soft
  pastels: nothing near-black, no fine detail. The re-bake leaves every earlier object byte-identical (checked
  per tile); the new kinds are appended. Look unverified on a GPU.
  **Pedestrian signals, mast arms, repeaters** (2026-10-21; before, no
  signalled crossing was read — the QA counted Dresden 934, Hamburg 726,
  München 666, Leipzig 583): a `highway=crossing|traffic_signals` with
  `crossing=traffic_signals` or `crossing:signals=yes` stands a 2.5 m post
  with a two-lamp head and a push button at each kerb end of its crossing
  way (the footway through the node, else straight across), looking
  across; within 2.5 m of another, one; on a deck by `Decks.kerbside`
  (`pedsignal`: Dresden 1 718, München 1 312, Hamburg 1 270, Leipzig
  1 082). A directed signal on a road of ≥ 3 lanes hangs on a 5 m mast
  arm over the lanes (`arm`; Dresden 271). An approach whose junction
  lies within 40 m past its stop line repeats its signal at the far kerb
  on the traffic's right. A carriageway is its `width`, else `lanes` ×
  3.25 m (≥ 2), else its class's (half for one carriageway of a dual main
  road); where the road class reaches beyond 15 m round a signal the kerb
  is searched to 30 m, then taken from the way, instead of the signal
  being dropped. Signals: Dresden 784 → 1 338, Hamburg 588 → 894, München
  571 → 837.
- **Playgrounds** `❝ taken` `◎ detected` — OSM `leisure=playground` outlines (≥ 20 m²; 339 over the
  fifteen tiles, 88 on the four first) → a pale sand floor flush on the ground (a breath warmer than the paving), seated on the
  ground under each ring vertex (densified to 2 m), and **only the
  equipment OSM maps** (`playground=swing/basketswing/slide/sandpit/
  climbingframe/structure/climbingwall/springy/spring_board/seesaw/
  roundabout/playhouse`, ~100 pieces) standing on it; a sandpit drawn as an
  area is its own sand slab, one drawn as a way stands at its midpoint
  turned along it. **A playground mapped without equipment** (the QA found
  7 of 9 checked had some) **stands what the surface model measures
  there** (2026-10-21, `src: "dom"`): DOM1 − DGM1 blobs 1.2–4 m tall,
  2–40 m², ≥ 1 m inside the outline (its hedge or fence), touching nothing
  taller, NDVI < 0.3 and no canopy tree within 1.5 m, the largest eight —
  a long narrow one a swing across it, any other a climbing frame.
  Nothing stands where nothing was measured. Dresden 200 pieces on 122 of
  its 263 empty playgrounds, Leipzig 54, Hamburg 41. On the Saxon leaf-off
  flight a bare shrub reads the same. The pieces are not catalogue equipment but soft, single-coloured
  sculptures (an arch, a wave, a faceted dome, an egg) in five pastels taken
  from the scene and lifted to the buildings' brightness — a first, literal
  rendering (A-frames, ladders, a rose safety floor) read as busy and out of
  place, and saturated pastels stood out as much. Same bake and layer as the street furniture.

- **Fountains, statues, memorial stones, columns** `❝ taken` `= computed` — the Basis-DLM's
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
  `pipeline/bake/monuments.py` → `monument-layer.ts`: a fountain's relief is smoothed
  (`reliefSurface`: ×4 bilinear, one binomial pass) into one soft form in
  the buildings' clay, seated per sample on the terrain (a monument's is composed, below); a monument nothing
  measured is an abstract clay marker (rounded pillar · slab · shaft,
  `MARKER_SHAPE`) — no invented figure. Basins are the OSM outline as a low
  clay rim (the water its 0.35 m inset) over the highest ground under it,
  with translucent water bells that grow with the basin, round a measured
  sculpture when there is one (splash pads flush, reflecting pools still);
  a point fountain is a 2.2 m round basin. The canopy loses the "trees" its
  own bake planted on a measured monument (`onRelief`). The fountains move
  gently — each bell breathes on its own phase, droplets run down its
  curtain, light shimmers across the water — and by night the water keeps
  a faint glow from below and the jets a faint warm white, and a
  fountain's sculpture is lit softly from its basin (until 2026-10-20 a
  glow and jets bright enough to outshine the lit streets, "viel zu hell",
  the maintainer) (`setFountainTime`,
  `setFountainNight`, one shared clock and night factor). Merged/instanced,
  nine draw calls per tile at most (eight until 2026-10-21). Not walk-blocking (collision is
  buildings only).
  **What a monument is, from OSM** (2026-10-08): the DLM's Denkmal,
  Standbild and Gedenkstein share one code, so 179 of Dresden's monuments
  were one rounded pillar. OSM's `memorial=*` / `artwork_type=*` tell a
  statue from a bust, a free sculpture, a stele, a stone or an obelisk: a
  DLM monument takes the form of the OSM memorial or artwork of its name
  within 15 m, else the nearest — never a plaque, which is the sign that
  explains it — and a name that says *Obelisk*, *Stele* or *Büste* wins.
  The marker is then that form's parts in clay (`markerPieces`: a
  body-sized pillar on a 1.6 m pedestal, a head-sized one on a slender
  plinth, a broad mass without a pedestal, an upright slab, a low rounded
  block, a four-sided needle on its base), scaled whole to a tagged
  `height`; still no figure. A measured `relief` wins over any form.
  Free-standing OSM sculptures and memorials the DLM lacks are added
  (160 on Dresden's fifteen tiles, mostly park and estate sculptures; not
  inside a LoD2 footprint, not within 3 m of one kept). The card names the
  form, the artist (`artist_name`) and the material (`material`, in
  German). On Dresden: 274 of 396 non-fountain monuments carry a form.
  Not used: **Mapillary** detects no monuments (its map-feature classes
  are street furniture and signs; checked over the Altstadt, 2026-10-08),
  **Wikidata** types more finely (32 *Reiterstandbilder* round Dresden)
  but rarely carries a height (7 of 941) and its points match ours worse
  than OSM's (its materials are used, below); **Panoramax** and Mapillary photos would need photogrammetry
  per monument; Wikimedia Commons holds no 3D scan of a Dresden monument.
  **What a monument is made of, as a tone** (2026-10-08): where OSM
  names no `material`, Wikidata's `P186` does for the monuments,
  sculptures and memorials it knows (fetched per tile,
  `data/_raw/<provider>/wikidata/monuments_<t>.json`, Stolpersteine left
  out; the item of the monument's name within 40 m, else the nearest
  within 10 m): 15 on Dresden, the Goldener Reiter's copper and gold leaf
  among them, `wikidata` naming the item on the card. The viewer turns
  the material into a muted tone in the clay's palette (`MATERIAL_TONE`,
  `markerTones`: warm sandstone, grey granite, bronze's dark green-brown
  patina, copper's verdigris, a soft gold): the figure takes the most
  striking metal, the pedestal the stone named (else clay). A marker's
  pedestal piece and figure piece are tinted apart; a measured relief 3 m
  or taller is a figure on a pedestal, its upper 45 % the figure's tone
  (`figureShare` — the laser scan puts the Goldener Reiter's pedestal top
  at 4.6 of 8.5 m). Glass, plastic and ceramic stay clay. No texture, no
  gilding glint: one colour per part. **The laser scan** (LSC, the same
  November 2024 flight, ~16 points/m² there) shows the Goldener Reiter as
  a pedestal and an elongated body with the rider's peak — orientation and
  mass at 0.5 m, still no horse; not baked (a 380 MB download per tile).
  **Measured monuments as composed solids** (2026-10-08): the smoothed
  1 m relief read as a heap (the Goldener Reiter a soft gold mound), so a
  monument's relief is no longer drawn as a surface; it is measured
  (`measuredMarker`): its cells' principal axis, footprint and top. A
  relief of 3 m or more with 6 cells or more becomes a pedestal at its
  footprint (x0.85) and the cells' median height, with the figure (the
  cells well above it) on top: lying along the axis where it is long
  (2.5 m and 1.6 times its width: a body block with an upright pillar on
  it, the horse and rider, the reclining river gods), else one upright
  pillar. Else the OSM form at the measured height and axis (an obelisk
  or stele always), else one mass at the footprint and height. The same
  clay solids as the markers, tinted per part. A fountain's sculpture
  keeps its smoothed relief (the winter housings below).
  **What a part is made of, in its surface** (2026-10-08): one smooth
  clay read as a plastic cast. A pedestal is now built as masonry
  (`pedestalCourses`: a plinth course a little wider at its foot, the
  shaft, a projecting cap; sharp-edged blocks, no rounding) and dressed
  as the bridges' ashlar (courses, running-bond joints, a shade per
  block). A figure's finish follows its material (`partFinish`, the
  instance attribute `iFinish`): stone tooled (a fine mottle, a touch
  less matte), bronze and copper a patina (rain streaks, verdigris in
  soft spots, roughness 0.55, a faint sky sheen at grazing angles),
  gilding smoother (roughness 0.33) with a warm sheen; no metalness, as
  no environment map lights the scene. A figure nothing names stays
  plain clay; a pedestal is masonry, named or not.
  **Caveats, checked against the sources:** DOM1 (November 2024) and DOP
  (March 2024) were both taken while Dresden's fountains are drained and
  their sculptures boxed for winter — the Albertplatz "bodies" are those
  housings (flat-topped, ~3.7 m), right in size and place, not the figures;
  since 2026-10-21 they are recognised (`winter_cover`) and drawn as a
  free sculpture's marker.
  The DOP shows the gilded Goldener Reiter only as glare (its shadow holds
  the horse's silhouette), so no colour is sampled. The laser point cloud
  (LSC, the only official source with more form) was unreachable from
  GeoSN's share when this was built; no openly licensed 3D scan of the
  landmarks was found.
  **QA corrections** `= computed` (2026-10-21, check-water W5–W9).
  *Outlines:* an OSM memorial/artwork outline ≤ 1000 m² stands at its
  representative point unless a node of it lies inside (Hamburg's
  Bismarck-Denkmal, 635 m²); larger ones are sites, left out.
  `memorial=war_memorial` and a bare `historic=monument` take the form
  their measured top says (`default_form`: < 1.5 m a stone, < 3 m a
  stele, else a statue; a column where a slim shaft stands; unmeasured a
  stele or a statue); an OSM name states a form as a DLM one does.
  *Slim columns:* a shaft over 8.5 m at a monument named column or
  obelisk — ≤ 24 cells above 0.3 of its top (12 for an unformed
  memorial), its ring ≤ 0.45 of the top at the median, under half in a
  LoD2 footprint — is measured at its height with its pedestal
  (`slim_column`), on the laser scan's surface where the provider's LAZ
  is on disk (`hs: "lsc"`): the Mariensäule 13.2 m, the Karolinenplatz
  obelisk 26.4, the Friedensengel 36.6, Dresden's Autobahn-Obelisk 12.9;
  drawn as a column (pedestal, round shaft, capital) or an obelisk up to
  40 / 35 m, its girth at most ×3. *Winter housings:* on a site flown
  leaf-off (the canopy's median NDVI < 0.4: the Saxon sites) a box-shaped
  relief is the housing — `cover`, no relief: a fountain's figure is then
  the free sculpture's marker (`coveredFigure`; the Albertplatz's two
  fountains, until now drawn as their 3.7 m boxes). *Heights in the open:* without a relief, the tallest cell
  within 1.5 m where 80 % of the 2.5–4.5 m ring stays under 0.7 m (`hm`),
  raised to the form's least; above the form's most it is a branch or a
  mast and is dropped (Hamburg's obelisks 2.4–4.5 m, drawn 6 m before). A
  monument without a relief faces the centre of its square, else its
  nearest way (`a`). *Small fountains:* a drinking fountain or stone
  block node is ~1 m across (`r`), not the 2.2 m basin; a point fountain
  inside a LoD2 footprint moves out within 3 m or is dropped (Dresden
  3 / 2, München 6 / 6). The jets run mid-April to October
  (`fountainsRun`, one shared uniform, `setFountainSeason`). Scratch
  bakes, HEAD code → this: forms Dresden 275 → 321, Hamburg 172 → 184,
  München 197 → 222; reliefs München 34 → 54, Dresden 82 → 88; `hm`
  Dresden 25, Hamburg 17, München 11.

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
- **Rails, ballast and decks from OSM where there is no Basis-DLM** `❝ taken`
  (Hamburg, Berlin; 2026-10-01, ADR 0012) — `rail.py` `run_osm` writes the
  same four files from the site's extract (`pipeline/bake/rail_osm.py`).
  *Rails:* `railway=rail|light_rail|subway|narrow_gauge` (Hamburg's
  S-Bahn is `light_rail`, its U-Bahn `subway`; the trams stay the tram
  layer's), out of tunnels and off the underground, with `tracks` and
  `electrified`, clipped to the tile and snap-merged like the DLM's.
  *Ballast:* those rails off bridges, buffered by their bed width (4.5 m
  for one track, 4 m more for each further one), dissolved into one
  surface. *Decks:* every `bridge`-tagged `highway`/`railway` way ≥ 4 m
  (not a proposal or construction), on its `man_made=bridge` outline where
  it runs on one; else — OSM maps a carriageway, its pavements and a
  cycle track as separate ways — the buffers of one bridge's ways on one
  `layer` merged into one deck (`decks(..., merge=True)`,
  `merged_decks`: the outline, the first name — `bridge:name` before
  `name` —, the weightiest kind, rail over road over path, the longest
  way as its axis), each at its `width`, else `lanes` × 3.25 m + 2 m,
  else the kind's width; a way on an outline another way already claimed
  adds nothing. The kind of an outline no way runs on comes from OSM's
  networks (`Ground(tile, networks)`, the masks the DLM's lines fill
  otherwise). Deck heights (DOM1 over the DGM ramp), the superstructure,
  the fairway clearance and Wikidata are the DLM path's, unchanged.
  Hamburg (four tiles): 348 decks — the Busanbrücke, Brooktorkaibrücke,
  Kuhmühlenbrücke, the Berlin–Hamburg and Lübeck–Hamburg lines' bridges
  among them —, 81 km of track (OSM maps each track as its own way where
  the DLM bundles them, so the count is high against a DLM city's) and
  0.27 km² of ballast. Before, the layer was DLM-only and Hamburg, a city
  of bridges, had none. Marked 🟡 (OSM + DOM1) in *Sources by city*.
  Not yet judged on a real GPU.
- **Tracks one by one from OSM** `❝ taken` `≈ assumed` (2026-10-21, every
  site; not yet judged on a GPU) — every OSM
  `railway=rail|light_rail|subway|narrow_gauge` way above ground, clipped
  to the tile, with `bridge`, `layer`, its gauge `g`, `electrified` (1
  overhead, 2 third rail, 0 none; an untagged way takes the nearest DLM
  line's `ELK`, a DLM U-Bahn line, `BKT` 1202, its third rail) and its
  mapped catenary masts `m` (`rail.py` `rails`, `rail_osm.rails`). The
  DLM's lines only where OSM maps no track within 6 m (each rest ≥ 20 m;
  `rail_osm.claimed`). The DLM gave a line one centreline and at most
  three tracks: 2 for Dresden Hbf's 15. Track-km Dresden 77.4 → 196.7
  (overhead 70.7 → 107.2), Leipzig 25.4 → 54.4, München 24.3 → 35.7, Unna
  8.3 → 13.8, Meißen 3.6 → 3.2, Grimma 0.74 → 0.77; Hamburg's 81.2 as
  before (26.4 km of it third rail). OSM's `bridge` is the line levels'
  preference: a deck on a bridge way, the ground off one (`railPrefer`;
  20 % of Hamburg's bridge rails lay on the ground under their own deck).
  The OSM credit now stands on the DLM sites' rail files too.
  **Covered and below ground:** a way `covered` for more than 30 m (a lid
  or a building over it) is not drawn; `layer` < 0 marks a line below,
  which cuts under a lid up to 800 m at 0.5 % grade (`lib/city/levels.ts`
  `coverCuts`; 832 m of Hamburg's rails had lain on such lids); a cut more
  than 0.5 m under the ground with no deck over it is buried: no rails,
  ballast or catenary. Hamburg's passages 17 (405 m) → 41 (1 224 m), a
  199 m opening at the Hauptbahnhof among them. Line jumps Dresden
  12 → 16 (budget 20), Hamburg 62 → 29, Leipzig 0 → 2, München 5 → 4.
  **Paved track** (`paved`, `rail_osm.Paving`): `embedded`, or a service
  track both of whose sides are paving (a quay, a factory yard): no
  ballast, no sleepers, the rail head 2 cm up (Hamburg's harbour spurs had
  stood on 4.5 m of raised ballast). Dresden 6.8 km, Hamburg 3.7, München
  0.17, Unna 0.08. **Heights:** the rail head 0.17 m over the DGM (it holds
  the ballast's surface) and over a rail deck's top (were 0.34 and
  0.08 m); the ballast 0.03 m up (was 0.18); a tram's ballast rail top
  0.25 → 0.17 m (`lib/city/tram.ts` `RAIL_TOP_M`). **Sleepers**
  (`app/_components/track-bed.ts`, one `sceneMaterial`): a ribbon per
  track, a concrete sleeper every 0.6 m drawn by its fragment pass, timber
  over dark gaps on a truss's open floor; the ballast and sleepers run on
  across a rail deck, its top painted as ballast between 1 m walkways
  (`bridge-surface.ts` `railTop`). The mesh grows: Dresden Hbf's tiles
  341k → 534k rail vertices, 57k → 88k sleeper vertices.
- **Main-line catenary** `≈ assumed` (2026-10-21; not yet judged on a GPU)
  — over every track with a contact line (`electrified` 1), drawn by
  `app/_components/catenary-layer.ts` from `lib/city/catenary.ts`: the
  contact wire 5.5 m over the rail head, staggered ±0.3 m; the messenger
  1.4 m above it, sagging ≤ 0.9 m (1 m on a long span); droppers every 8 m;
  supports where a track crosses a site-wide 50 m grid line (a seam moves
  no mast); three or more parallel tracks within 7 m on one level share a
  portal, else a mast 3.2 m out with a cantilever. A mapped
  `power=catenary_mast` within 12 m of the track (`m`) replaces the grid's
  supports within 30 m of it (Dresden 215, München 83); masts within 15 m
  of a tram track are left to the tram layer. Under a bridge no support
  within 10 m and the wires drop under the soffit (the contact wire at
  least 4.95 m over the rail head). Hamburg's S- and U-Bahn take their
  current from a third rail: no catenary. Dresden Hbf's tiles carry 94k
  wire and 24k mast vertices — a phone's memory still to check.
- **Ballast yards** `❝ taken` `= computed` — Basis-DLM `ver03_f` (railway AREA, `OBJART=42010`),
  **dissolved** with shapely `union_all(make_valid())` in the bake and clipped
  to the tile (~5 non-overlapping parts) → **one merged surface**, so dozens of
  yard tracks can't z-fight. **Only where a track's bed lies on it**
  (2026-10-20): the parcel reaches the railway's fences and holds its
  depots, their yards' tarmac and parking, the embankments' grass and the
  station forecourts — on the orthophotos half of Dresden's (49 %), two
  thirds of Leipzig's and three quarters of Meißen's and Grimma's lay off
  every track, all of it drawn as raised gravel (Leipzig's bus depot east
  of the Hauptbahnhof, Dresden's Wiener Platz). So the parcel is cut to the
  beds of the baked rails (by their track count) and of OSM's every track
  above ground and off a bridge (which maps a yard's sidings the DLM
  bundles), at `rail_osm.py`'s bed widths (4.5 m, 4 m more per further
  track), and gaps up to 4 m between two beds closed (a yard's tracks lie
  4.5–6 m apart; open, each would stand as its own strip with its own
  fascia). Ballast then: Dresden 165 → 80 ha, Leipzig 76 → 27, Munich
  31 → 14, Unna 8.5 → 4.6, Meißen 2.0 → 0.5. Since 2026-10-21 the beds are
  the baked tracks' own (`rail.py` `ballast(tile, lines)`, `rail_osm.beds`,
  replacing `osm_beds`): none on a bridge or a paved track. A track neither the DLM nor
  OSM maps loses its ballast; outside the parcel no bed is drawn. **Draped on the ground** (2026-10-01, ADR 0041,
  `addDrapedArea`): the outline and its holes triangulated, each triangle split
  in four while the ground at its edge midpoints and centre strays from its
  plane by > 1 m (and always above 48 m), down to 6 m, every corner on the
  ground + `BALLAST_RAISE`; the fascia (0.45 m) on the ground every 6 m; **left
  out on the rail decks** (the tracks ride the deck). ~5·10⁴ triangles and
  ~0.3 s a tile with a big yard (750 before). *(Clamped at the outline's corners alone, the
  yard spanned whatever lay between them: across the underpass at Dresden's
  Bahnhof Mitte its sheets sloped from the embankment down to the street
  corners under the deck — the passage read as a closed wall, from the
  tracks too.)* `polygonOffset`. The recoloured class-5 splat sits underneath so any gap
  reads as ballast, not seam.
- **Steel rails** `❝ taken` `◎ detected` — since 2026-10-21 OSM's every
  track (*Tracks one by one from OSM* above), and the Basis-DLM's lines
  only where OSM maps none within 6 m. Basis-DLM `ver03_l`, **heavy rail only** (`SPW=1000`; the
  DLM carries trams poorly — `SPW=3000`/`BKT=1201` — so they come from OSM,
  see **Trams** below; a line whose Bahnkategorie is tram alone is skipped
  even at standard gauge, which is how Bavaria files Munich's trams).
  **Not underground:** the DLM line has nothing on it to say a subway or
  an S-Bahn trunk line is in a tunnel, so a stretch that runs within 2 m
  of a DLM tunnel (`ver06_l`/`ver06_f`, `BWF=1870` "Tunnel, Unterführung")
  for more than 15 m is cut out; a shorter overlap is a surface track
  crossing over one and stays. In Munich this removed 23 km of U-Bahn and
  the 4.2 km S-Bahn trunk line under the Marienplatz and 0 m of mainline
  (the rail layer shrank from ≈ 84 km to ≈ 22 km, the trams now drawn by
  the tram layer alone); it applies to every DLM site (Leipzig's
  City-Tunnel). *(A 6 m reach took Munich Hauptbahnhof's surface tracks,
  which run straight over the S-Bahn tunnel — 🗃️ below.)* Short ATKIS fragments are
  **snap-merged by shared endpoints** (1 m) in the bake (≈91→9 lines/tile); at
  runtime a polyline is **split into runs of valid ground** (never bridged across a
  NoData gap) and each track gets a thin rail pair (`±GAUGE/2`, count from `GLS`)
  with a small web, on the **level its line runs on** (*Line levels* below):
  the ground, a rail bridge's deck — riding it with no ballast stacked on
  top, at the deck's height *there* (the per-vertex deck profile
  interpolated along the deck's long axis; until plan 024 the deck's mean),
  from a lift table of every deck kind that the tram layer shares — or a
  span over a gap, on a deck of its own. Railway
  class recoloured dusty-mauve → **ballast warm-grey** (class 5 in
  `lib/city/landcover.ts`).
- **Line levels** `◎ detected` (2026-10-01, [ADR 0041](./adr/0041-line-levels-along-the-whole-line.md))
  — which level a rail or tram line runs on is decided **along the whole
  line**, never per sample (`lib/city/levels.ts`): the candidates per 4 m
  (rail) or 2 m (tram) sample are the ground and every deck the line may
  ride whose outline holds the point or runs within 2 m (a rail only rail
  decks, a tram any); a Viterbi picks the path the line can drive — the
  climb beyond its grade (rail 4 %, tram 8 %, 0.35 m slack) is the cost,
  OSM's `bridge` tag a 4 m-of-jump preference between two levels as good.
  Then a grade cone: a sample the line cannot get down to from either side
  by ≥ 1 m is in a **gap** — a straight *span* between its rims (pushed out
  over the gap's sloped sides), a deck within 1 m of it riding along,
  ≤ 400 m; one it cannot get up to from either side is in a **fill** — a
  straight *cut*, ≤ 120 m. The build step solves every line of the site
  with **450 m of context** past each end of a tile's piece (the line that
  runs on through that end in another piece, a switch's straightest branch;
  `lib/city/line-levels.ts`, `scripts/line-levels.ts`) and publishes each
  line's runs off the ground as `lv` in the rail and tram files (never
  committed); a layer without them solves its own piece. Under a span the
  layer draws a **span deck**: a slab as wide as the tracks + 0.9 m (a
  tram's 1.6 m either side), its top in the deck colour, 1.1 m deep, a
  pier every 26 m where it clears the ground by 2.5 m, drawn by the tile
  owning its middle (`addSpanDeck`). Dresden: steps beyond the grade by
  > 1 m in the drawn lines 230 → 18, Hamburg 330 → 62, Leipzig 41 → 17, Unna
  20 → 0 (`bun scripts/line-levels-cli.ts <site>`; the test holds Dresden to
  20). What remains: deck ends above lower ground for good, and deck tops
  DOM1 put 1.5–2 m off their embankment. *(Until then: lifted onto every
  deck under a point — 🗃️ below.)*
- **Line profiles and beds** `◎ detected` (2026-10-24, [ADR 0041](./adr/0041-line-levels-along-the-whole-line.md))
  — on the ground a line no longer follows the DGM sample by sample: the
  build step fits each line a **profile** (*Gradiente*) within its grade
  (rail 4 %, tram 8 %) and a **vertical curve** of at least 2 000 m (rail,
  EBO/Ril 800.0110) or 500 m (tram, BOStrab) — a robust (Huber 0.1 m)
  least-squares fit to its levels, a deck's top held — with 150 m of
  context either side (`lib/city/line-profile.ts`), published as `lz`. A
  line on the ground crossing another a storey (≥ 3 m) below it at ≥ 20°
  is a *span* there (the DGM kept its bridge), and so is one standing
  ≥ 2 m over its own ground beside a line as far below (a viaduct the DGM
  lacks). The terrain bake lays the
  ground under every line's **bed** at its profile (ballast's width 0.1 m
  under it, a street track's 3 cm), the ground beside it graded at 1 : 1.5
  for ≤ 4 m, the nearest bed winning, a cut's only as a trench ≤ 0.5 m
  deep, never a fill under a deck (`lib/city/track-beds.ts`, `shapeDgm`); the fine TIN
  holds 3 cm under a bed (0.15 m elsewhere). The yard's ballast is draped
  on the beds' profile to 2 cm. Measured over the seven sites in the PR;
  Dresden's sleepers under the ballast 14.3 % → 0.05 %, its rail heads
  under ballast or ground 1.84 % → 0.01 %, its street tram rails in the
  road 2.6 % → 0.02 %. **And nothing lies on a track** (2026-10-25): a
  platform outline is cut back to its edge distance from every drawn
  track (1.65 m rail, EBO §13; 1.35 m tram; `lib/city/platform-clearance.ts`
  `clearOfTracks`) — OSM's island at Dresden Hbf stood 0.6 m from a DLM
  track's centre and covered its rails (Dresden 3.5 %, Leipzig 3 %, Munich
  1.3 % of the platforms' area cut); a Basis-DLM centreline's stretches over
  an OSM platform are dropped (`outsideAreas`, `railFeatures`: not a track,
  the axis between a station's tracks; Dresden 503 m, Leipzig 689 m, Munich
  55 m); and a flat LoD2 top less than 1.5 m over a track's profile where
  the track runs on it for 20 m is lowered to the bed before the buildings
  bake (`lib/city/track-formation.ts` `onFormations`: the formation the
  track lies on — ALKIS 31001_9998 west of Dresden Hbf, 0.4 m over the
  rails for a kilometre of track; in Hamburg a station building (ALKIS
  31001_3091) a track runs on, 1.2 m; a roof on posts — ALKIS Überdachung, drawn open —
  is never one, the track runs under it).
- **Passages under decks** `◎ detected` (2026-10-01, ADR 0041) — a *cut* lying ≥ 30 %
  under a drawn deck (any kind, within 2 m) opens the fill in the terrain
  bake (`lib/city/passages.ts`, `shapeDgm`'s last pass, both levels): along
  the line, half-width 2 m per track + 1.5 m, the ground lowered to the
  line's level − 0.15 m, never raised, its sides where the DGM stood. Where
  the DGM fills the ground under a bridge (Hamburg's keeps its bridges) the
  track ran into a hill; a cut under no deck stays closed (a tunnel, a
  station's cover, a road the bridge data lacks). Hamburg: 15 passages,
  Munich 1, Dresden none (its tracks pass under their decks on open
  ground). The fill under a deck that no line passes through stays as
  measured — under Dresden's Bahnhof Mitte the raised third of the outline
  is the abutment the DLM outline includes, and the passage beside it
  reads closed from an oblique view. **And the ways under a deck**
  (2026-10-21, B10): every OSM highway (not on a bridge, not in a tunnel,
  no steps) the DGM closes under a drawn deck (within 2 m of the deck's
  top) is opened along the way, straight between the lowest open ground
  either side, where the DGM stands ≥ 0.5 m over that level, with ≥ 2.2 m
  headroom and ≤ 12 % grade; half-width OSM `width`/2, else `lanes` ×
  1.6 m, a footway 1.25 m, else the class's, + 0.5 m (`bridge.py`
  `way_passages`, `rail_osm.passage_half`). Where a Land's DGM holds the
  bridge itself (a hump ≥ 2 m over level ground 2–6 m beside the deck on
  both sides, or over level water on one side where water runs on under
  it; ≥ 4 stations of 2 m, not an end alone) the ground under the deck is
  opened across it, edge to edge, to the lower side's level
  (`hump_passages`). Baked as the deck's `under`, opened by the terrain
  bake to their own level (no 0.15 m floor) with square ends
  (`lib/city/passages.ts` `deckPassages`; `scripts/line-levels.ts`
  appends them to the site's passages). Hamburg's 32564_5932: 2 ways and
  16 hump stations, its 32566_5934 2 + 11; Dresden's 33410_5656 1 + 4;
  München's 32692_5334 1 + 29, 32690_5332 0 + 9.
- **Bridge axis** `❝ taken` `= computed` — every deck is measured and drawn along a **centreline**
  (`bridge.py` `deck_axis`, `lib/city/bridge.ts` `axisFrame`): the DLM
  bridge line where there is one, clipped to the outline and run on to its
  ends (a polyline — the Marienbrücke's road deck curves); else the long
  axis of the outline's minimum rotated rectangle, through its middle.
  *(The first cut took the outline's two farthest-apart vertices — the ends
  of a diagonal: across a deck 11 m wide the offsets ran skewed by up to
  half its width, the Blaues Wunder's truss was measured at −5.5/+3.0 m and
  drawn beside the deck at its ends.)*
- **Bridge decks** `❝ taken` `◎ detected` — driven by the **complete `ver06_l` (`BWF=1800`) centreline
  set** (carries every road/rail/path bridge + `NAM`), each snapped to a clean
  **`ver06_f` deck AREA footprint** the line runs on (half its length within
  1 m of it) else **buffered as wide as DOM1 sees its deck** (*Deck width*
  below; the mapped width, else the kind's, where it cannot) — so the parallel Marienbrücke
  rail + road decks are separate single-volume slabs (top face + one
  continuous fascia) AND road/path bridges without an area polygon still
  render. *(The match used to be the nearest footprint centre within 50 m:
  the Marienbrücke's road line, 16 m beside the rail bridge's footprint, took
  that footprint — the road was laid on the tracks, the tracks got no rail
  deck and the road bridge was not drawn at all.)* **Deck height = the roadway DOM1
  measures**: per 1 m station along the deck's axis the lower third of the
  surface across the deck (parapets, cars and lamps stand above it), held
  within −6/+4 m of the abutment ramp from DGM1 (a train or a canopy over the
  deck is not the deck), smoothed over 15 m and then **grade-limited** from
  the middle of the span outwards — ≤ 8 % on a road or path deck, ≤ 4 % on a
  rail deck — so where the scan loses the deck near an abutment it ramps down
  instead of dropping off a cliff (the rail bridge by Neustadt station fell
  5 m at one end) (`bridge.py` `measured_deck`, `limit_grade`). What comes
  out is then **reduced to the simplest deck it can be** (`camber_fit`): a
  straight ramp between its two ends plus one upward camber fitted to it,
  never sagging, no end steeper than the grade — the raster's dips (the
  river seen through a gap) and waves are not the roadway. *(Without it the
  Waldschlößchenbrücke and the Blaues Wunder bowed inwards.)*
  Without DOM1: the ramp + camber. The ground is a **mosaic of the tile and
  its neighbours** (700 m around it), so a deck across a seam comes out the
  same in both tiles' files, and **only the tile that owns its centre draws
  it** (every copy still lifts that tile's rails). **Closed from below**
  (the soffit: a deck seen from under it was hollow). **Flush parapet
  walls** (no floating cap) along the sides of a stone bridge, an open
  steel railing on every other (*Bridge parapets* below) — not where a
  frame stands on the edge: the frame is the railing. **Kind** (rail/road/path) from **the
  network that runs on the deck** (2026-10-20, `Ground.classify`,
  `Ground.carried` in `rail.py`): of the DLM's rail (heavy rail, its
  trams aside — Bavaria files them as standard-gauge railways), road and
  path lines within 8 m (paths 5 m) of the axis, the one with the most
  metres following it within 30° (`along`), rail before road before path
  on a tie; a footprint no centreline runs on carries the network whose
  lines leave it onto ground within 2 m of the deck's top, 4 m past its
  edge, and its axis follows that network's longest line across it.
  Where nothing runs along or leaves at deck height, the networks under
  its points decide, rail first. *(Counted point by point, the tracks
  under a road or footbridge made it a rail deck — Leipzig's
  Bennigsenbrücke, Munich's Reichenbach- and Maximiliansbrücke with their
  trams —, and a footprint's long axis ran along the road under a wide
  railway bridge, so the rule by direction alone turned Dresden's
  Weißeritz rail bridges into road decks. Against OSM's bridge ways, six
  cities: 215 of 241 decks right before, 229 of 239 after; what is left
  is road against path — a 3 m service way the DLM files as a path.)*
  *(Tried ver06_f-only — it dropped the road/path
  bridges, which lack area polygons; the DGM ramp alone — it put the
  Waldschlößchenbrücke 3 m low and rail decks up to 6 m high; per-tile
  ground — seam bridges drawn twice at two heights; see 🗃️.)*
  **The deck on its measured line** `= computed` (2026-10-20,
  `rail-layer.ts` `onLine`, `splitDeckTop`; `lib/city/decks.ts`
  `deckLine`): the bake writes the deck's top every 2 m along its axis
  (`line`), but the viewer drew it from the ring's few corners — a long
  outline has four to a dozen — as flat triangles between them, which cut
  a chord under the camber, and a ring vertex took its own height. So the
  ring's edges are now divided into pieces of at most 4.8 m, every
  corner at the line's height at its station (the bake's own corner
  heights lie up to 12 cm off it, 3 cm at the 95th percentile over the
  seven cities' 1 240 corners: kept, the fascia met the slab's top with
  a step there; since 2026-10-22); the top and the soffit,
  split into triangles of at most 6 m, take the line's height at every
  vertex; the parapets, the approaches and the masonry run along the same
  corners. The lift table that stands rails, trams, lamps and benches on
  a deck read its profile from the ring's corners too: it now reads the
  `line`. Before, the drawn top missed the measured one by up to 4.39 m
  (the Waldschlößchenbrücke, mid-span), 3.08 m (the Albertbrücke), 2.47 m
  (the Waltherstraßenbrücke), 1.63 m (Meißen's Elbtalbrücke), 1.55 m
  (Hamburg's Nordkanalbrücke), 1.38 m (Munich's Reichenbachbrücke),
  1.25 m (Leipzig's Hermann-Liebmann-Brücke) — 64 of the six cities' 491
  road and path decks by more than 0.25 m, so a lamp or bench set on the
  measured top floated over the drawn one or stood in it —, and the lift
  table by up to 2.38 m (Hamburg's Güterumgehungsbahn) and 1.14 m
  (Dresden's Hafenbrücke). Now every drawn deck lies within 2 cm of its
  line (Hamburg's within 8 cm), the lift table within 7 cm.
  **Approaches** (*Rampen*, 2026-09-30): the deck's ends are measured in
  DOM1, the terrain is the bare-earth DGM, which runs on under an approach
  as the ground it was built on — every deck end stood as a slab edge a
  metre or more above the road running up to it. So from each abutment
  end (the ring's edges across the axis) that stands ≥ 0.5 m above the
  ground, a ramp runs out at the kind's grade (road 8 %, path 10 %, rail
  3 %) to where it meets the ground, column by column across the end (≤ 2 m
  apart), within 40 m (`lib/city/bridge.ts` `approachLanding`,
  `rail-layer.ts` `approaches`): the deck's own top colour, the fascia's
  sides and soffit as deep as the deck (*Deck depth* below; 1.1 m until
  2026-10-21). None where the deck runs on onto another
  deck, where most of the end finds no ground in reach (a deck over a
  street, a viaduct onto an embankment the DGM has), or where the end is
  flush. The approaches join the lift table: a line on the ground (*Line
  levels* above) rides one that stands less than 1.5 m over the ground
  under it (not a street passing below), a rail a rail deck's.
- **Deck width** `◎ detected` (2026-10-21, photo QA V10) — a bridge line on
  no footprint (DLM `ver06_l`, OSM ways) is buffered as wide as DOM1 sees
  its deck (`bridge.py` `measured_halves`, `rail.py` `band`): every 2 m over
  the middle half of the line, a cross-section out from the line to where
  the surface drops 1.2 m under the deck line and then ≥ 3 m within 2.5 m
  (the deck's side, the water or the street below), up to 22 m; another
  bridge's footprint or a point nearer another bridge line ends a side
  first (`Beside`: twin bridges with no gap); the median per side, a side
  DOM1 lost mirrored, the total 3–40 m (`deck_halves`). A side seen in
  under 30 % of the sections is not measured: the mapped width (DLM `BRF`
  of the road + 2 m of pavement per side, OSM `width`, `lanes`) or the
  kind's. *(The kind's 11 m drew the Elbe bridges at half their width:
  Marienbrücke 20.5 m, Albertbrücke 22.5, Augustusbrücke 19.5,
  Maximiliansbrücke 23.8.)* Now the Marienbrücke's road deck 11 → 20.4 m,
  the Augustusbrücke 11 → 19.4, the Maximiliansbrücke 23.5, the
  Reichenbachbrücke 24.8, Meißen's Elbtalbrücke 21.9, the
  Pöppelmannbrücke 9.5; deck area Dresden's 33410_5656
  40 340 → 51 059 m², Hamburg's 32564_5932 53 699 → 63 875, München's
  32692_5334 11 017 → 16 620, Meißen 13 451 → 19 078. Where DOM1 sees
  through a deck (Hamburg's U3 viaduct) the OSM outline stays, about 30 m.
- **Decks split by network** `= computed` (2026-10-21, V11) — a footprint or
  a merged OSM deck that carries rails and a road (or path) is cut into one
  deck per network: a Voronoi of points every 2 m along each network's
  lines, its cells joined by network (`rail.py` `split_nearest`,
  `shared_decks`), each share ≥ 20 m² a deck of that kind along its own
  lines. *(The first line's kind took the whole outline: the
  Lombardsbrücke's road lay under ballast, both Oberhafenbrücken were
  railway.)* The Lombardsbrücke is now a rail deck of 18.5 m and road
  decks of 23.7 and 5.8 m.
- **Bridge superstructure** `◎ detected` (*Oberbau*: truss, pylons, steel arch) — **DOM1**
  above the deck line, per half of the cross-section (the outline grown by
  3 m): the highest surface per station, a morphological **opening** (7 m:
  lamps, poles, cars go) and **closing** (11 m: gaps the 1 m raster leaves in
  a slender member fill), kept where it rises ≥ 3 m for ≥ 25 m and peaks
  ≥ 5 m. Each half gives one **rib** (lateral offset + rise per 2 m station;
  two within 3 m merge). Only a bridge whose class stands above its deck
  (arch, truss, suspension, cantilever, cable-stayed — Wikidata over OSM)
  keeps its ribs: over a beam bridge DOM1 sees catenary, trains and trees.
  At runtime (`rail-layer.ts`, `lib/city/bridge.ts`): on an **arch** bridge
  the tightest rib that fits a parabola (rms ≤ 1.5 m, sag ≥ 2 m, crown
  inside the run) gives its curve to every rib that follows it (the raster
  sees one side of the Waldschlößchenbrücke patchily), drawn as a steel arch
  **extended below the deck to where it meets the ground** (the springing
  the DOM cannot see), hangers above and posts below the deck; a rib that
  follows no arch is not drawn (the Marienbrücke's). On a
  **cable-stayed** bridge the peak is a pylon on a river pier with stays
  fanned to the deck by rule (the Molenbrücke). Otherwise the rib is drawn
  as an **open frame** on the deck edge in a **simple form**
  (`ribProfile`): where it peaks ≥ 10 m and ≥ 4 m above the dip to
  anything higher, a tower on a river pier with a portal between the two
  frames; a straight chord from the deck at the first run's start up to
  the first tower, a curve sagging between two towers to the lowest the
  rib was measured there but no lower than 2.6 m (lower, it lay along the
  parapet as a second thin strip), a
  straight chord down to the deck at the last run's end; without towers a
  level girder at the run's median rise. One 1.6 m chord, a post every
  10 m, no diagonals — the Blaues Wunder's silhouette at the abstraction
  of the clay buildings. *(A solid fin, tried first, read as a dark tent;
  the measured rise itself, smoothed, as waves, its side arms ending in
  mid-air where the raster lost the chord.)* The ribs' measured
  offsets are not trusted across the deck (the DLM centreline can sit
  metres off the bridge: the Blaues Wunder's came out −5.5 and +3.0 m around
  an 11 m deck, a truss through the roadway) — two ribs stand on the two
  deck edges, their outer face flush with the deck's side (towers
  included), a lone rib near the axis stays central (`placeRibs`). Pale weathered steel `0xd9dde0`, matte; hangers and stays
  every 16 / 12 m. *(Drawn member by member as measured until 2026-09 —
  chord, a post every 6 m, diagonals in dark `0x8d9ca8`: busier and
  darker than anything else in the scene.)* No DOM1: no ribs. `pipeline/bake/bridge.py`
  ([ADR 0041](./adr/0041-line-levels-along-the-whole-line.md)).
- **Bridge depth and fairway** `❝ taken` `= computed` `≈ assumed` — OSM's inland-waterway marks
  (`seamark:type=bridge` + `seamark:bridge:clearance_height`, ODbL) within
  30 m of a deck: the navigation clearance over the DGM's water surface gives
  the soffit there, hence the deck's **structural depth** (deck − water −
  clearance, clamped 0.6–5 m), and **where the fairway
  crosses**. Beam-bridge piers keep the fairway clear (the main span wide when
  Wikidata knows it, else 40 m). The clearance's reference level is not
  NHN-anchored in OSM, so the DGM's water surface at scan time stands in —
  which is why that depth is now only a cap on the structure's (below).
- **Deck depth** `≈ assumed` (2026-10-21, V16) — by what carries the deck
  (`lib/city/bridge.ts` `deckCarrier`, `deckDepth`): a beam a twentieth of
  its span (Wikidata's main span, else the median gap between its
  supports, `beamSpan`), 0.8–2.5 m; an arch's deck 1 m; a truss's or
  cables' floor 1.2 m. The fairway's `depth` only caps it; the approaches
  are as deep as their deck. *(Taken as the depth, it hit the 5 m clamp on
  the Meißen bridges, Dresden's Hafen- and Flügelwegbrücke, Hamburg's U3
  viaduct: the clearance is against mean high water, not the water the
  scan saw.)* Decks at the 5 m clamp: Dresden 3 → 0, Meißen 3 → 0,
  Hamburg 6 → 0; the U3 viaduct 5.0 → 0.8 m. At runtime, no re-bake.
- **Bridge type and main span from Wikidata** `❝ taken` `◎ detected` (CC0) — the ingest fetches the
  bridges Wikidata knows around each tile (class, main span P2787, length,
  and since 2026-10-21 the number of spans P1314 — the cache's
  `"version": 2`, an older one is fetched again)
  into `data/_raw/<provider>/wikidata/`; a deck is matched by an OSM `wikidata`
  tag on its outline or fairway mark, else by its DLM name within 150 m.
  Wikidata's classes (Bogen-, Hänge-, Ketten-, Gerberträger-, Fachwerk-,
  Balkenbrücke …) **override OSM's `bridge:structure`** — OSM calls the
  Waldschlößchenbrücke a truss; it is an arch. No file: the OSM tag stays.
- **Bridge arches** `≈ assumed` — `structure` containing **`arch`** without a measured
  steel arch (Augustus-, Albert-, Marienbrücke) → `addMasonry`: the axis
  in bays (2026-10-21, V13, `masonryBays`, `masonryArches`) from DOM1's
  piers where the deck bulges over them (`bridge.py` `bastion_piers`: the
  deck's width every metre ≥ 1.5 m over its 41 m running median for
  3–16 m, ≥ 8 m from an end, ≥ 10 m apart; kept where Wikidata's span
  count agrees, `piers`, and no bay they leave is wider than 70 m or the
  main span and a fifth), else Wikidata's number of spans (P1314, `spans`)
  with its main span (P2787) centred on the fairway, else equal bays of
  ~26 m; piers a seventh of their span thick (1.5–7 m); each arch a
  segmental arc rising a fifth of its clear span to 0.2 m under the deck's
  soffit, springing ≥ 0.5 m over the ground. *(Equal 26 m bays drew the
  Luitpoldbrücke's one 62 m span as three, the Augustusbrücke's 43 m
  arches as 26 m ones on 3.2 m piers — springing a quarter of the
  clearance above the higher ground and rising to just under the deck.)*
  The Augustusbrücke now stands on 7 piers 35–46 m apart, the
  Luitpoldbrücke on bays of 8, 62 and 8 m, the Pöppelmannbrücke on 5 bays.
  The bastion test is a heuristic: on the Marienbrücke's road deck it
  finds 14 piers with three 18 m gaps, on the Lombardsbrücke one (bays of
  15 and 47 m). The deck's **own side edges** carried
  down as spandrel walls (both faces) to the arch, or to the pier top over
  a pier, and a **vault** across the deck under each arch — closed from
  below and from the side, a masonry-viaduct read. A bay whose arch would
  rise less than 2 m gets none (the banks). *(The first cut sprang every
  arch half a metre over the water from a point, on 0.5 m slabs that read
  as a second deck under the bridge, and had no vault: from below or
  through an arch the bridge was hollow.)* `beam`/absent → flat soffit +
  box piers, or a viaduct's columns (*Viaduct columns* below). *(Until 2026-09 the walls stood on a straight line between
  the deck's two farthest-apart corners, one deck width apart and at the
  lowest deck height: on a long deck they stood metres beside it, on a
  curved one off it entirely, with water showing between wall and deck.)* The structure comes from Wikidata when it knows the bridge, else
  from the nearest OSM `man_made=bridge` `bridge:structure` (≤60 m), else
  from the OSM ways on the deck (half their length on it): their
  `bridge:structure`, else **an arch when one was built before 1850**
  (`start_date`; 2026-10-20, `rail.bridge_way`) — iron came after, and a
  bridge that old is masonry, so a measured superstructure is not looked
  for. *(Meißen's Schloßbrücke, 1221, a stone arch over the castle's moat,
  was a flat slab: neither Wikidata nor an OSM outline knows it, and its
  way says only its date.)* A deck the Basis-DLM leaves unnamed takes the
  name of its OSM ways — their `bridge:name`, else a `name` that names a
  bridge (…brücke, …steg, …viadukt; a way on a bridge is as often named
  for its street) — and with it a Wikidata match by name: on Meißen's tile
  6 of its 11 unnamed decks.
- **Viaduct columns** `≈ assumed` (2026-10-21, V17) — a railway beam deck
  longer than 100 m stands on paired 0.6 m columns under its edges every
  ≤ 13 m with a crossbeam under the girder (`lib/city/bridge.ts`
  `beamSupports`, `rail-layer.ts` `addColumnPair`; Hamburg's U3 runs on
  them every 10–15 m); over the stretches the class raster calls water
  (`water`, baked) a pier on the axis at every other station (≤ 26 m), and
  a fairway it crosses kept open between two piers (`fairwayOpening`).
  Every other beam deck: piers on the axis ≤ 26 m apart (none up to 40 m),
  the fairway kept clear (`pierStations`). Viaducts: Hamburg 5, München 3,
  Dresden 1; the U3 on 50 column pairs.
- **Bridge parapets** `≈ assumed` (2026-10-21, V18) — arch, humpback or stone
  bridges (no measured steel arch) keep the 0.85 m ashlar wall; every other
  gets an open steel railing: a 0.2 × 0.3 m kerb flush with the fascia,
  posts every 2.5 m and a top rail 1.1 m over the deck (`lib/city/bridge.ts`
  `parapetStyle`, `rail-layer.ts` `addRailing`); none where a frame stands
  on the edge. Railing against ashlar: Dresden 117 / 19, Hamburg 305 / 43,
  München 44 / 16, Leipzig 38 / 3, Meißen 13 / 4, Unna 10 / 1, Grimma
  4 / 2.
- **Station platforms** `❝ taken` `≈ assumed` — OSM `railway=platform` (ODbL) → triangulated flat slabs
  (`ShapeUtils.triangulateShape`). **On the level of the track beside
  them** (2026-10-21, `lib/city/platform-level.ts`): the edge OSM's
  `height` (`h`), else by the trains it serves (`k`) — 0.76 m a main
  line's, 0.96 m an S-Bahn's, 1.0 m a U-Bahn's, 0.55 m a narrow gauge's,
  0.25 m a tram's — over the rail head of the nearest drawn track's solved
  level (ground, deck or span), never under the DGM inside its outline.
  *(Drawn 0.55 m over the DGM, they stood too low where the DGM holds the
  platform, and on the street under Hamburg's U3.)* Hamburg's U3 platform
  top now at 13.7 m over the ground's 5.4 m, Dresden Hbf's at 120.6 m over
  the street's 113.9 m. The OSM half of the
  blend (Basis-DLM has no platform geometry); absent/empty when the site has
  no `.osm.pbf` extract. A platform below ground (in a tunnel,
  `location=underground`, or on a negative `layer` or `level`:
  `osm.below_ground`) is skipped — Munich's U-Bahn platforms under the
  Marienplatz and the Odeonsplatz had been drawn at street level.

- **Trams** `❝ taken` `◎ detected` `≈ assumed` (plan [024](./plans/completed.md#024--trams-tracks-overhead-line-stops--done-2026-09-25-look-unjudged-on-a-gpu--plan-019)) —
  OSM `railway=tram` (ODbL; 401 ways, 59.6 km in the four first tiles —
  146.8 km of track drawn over the fifteen —, every one
  `gauge=1450`, `electrified=contact_line`) + `power=catenary_mast`
  (321 points on the four first tiles, **167 of them within 15 m of a tram track** — the rest are
  the railway's) + the OSM building outlines. `pipeline/bake/tram.py` →
  `tram_<tile>.geojson`: each track (fragments chained at 1 m, cut at the
  tile edge) with its **bed**, read every 2 m — `street` on the road class
  of the committed class raster and on the paved squares and yards (the
  built-up and path classes), `grass` (*Rasengleis*) on the meadow class or
  NDVI > 0.3, else `ballast`, a majority over 20 m, no stretch shorter than
  20 m — the track cut where it changes; and the
  OSM `bridge`/`layer` (per-tile numbers in the table below). *(Until
  2026-09-30 one bed per whole chain: `street` only when ≥ 70 % of it lay on
  the road class, so a kilometre of street track went to ballast for a lawn
  or a square under a third of it — the Postplatz's tracks lay half in a
  brown ballast strip, half in the paving. 23.8 km of ballast became 3.2 km;
  the committed files were re-cut by the same rule from their own track
  lines, the class raster and the NDVI, without a new OSM extract — the
  table below is the bake before that.)* A way in a tunnel or tagged
  `location=underground` (`osm.in_tunnel`) is skipped: a tram tunnel is not
  drawn at street level. At the Albertplatz
  (150 m round) 87 % street / 5 % grass, the Hauptstraße 100 % street — the
  plan's > 10 % STOP was not hit. The supports are decided on the tracks
  and masts within 30 m around the tile (so a seam support is the same in
  both tiles): a **span** from a mast across the tracks to the nearest mast
  on the other side (≤ 28 m, each mast in one pair, shortest first), else
  an **arm** from the mast over the nearest track (≤ 10 m; over a parallel
  second track too); where a track is 45 m from any mapped mast, a
  **rosette** span every 30 m between the **facades either side** (the OSM
  building outlines, ≤ 15 m out; none when either side has none — the plan
  asked for a ray against the LoD2 BVH at runtime; the bake reads the OSM
  outlines instead, because a dressing cannot count on its neighbour's
  buildings being loaded, and the result must not depend on load order).
  Each track carries `s`, the distances at which a span or arm holds its
  wire. **Gauge** (2026-10-01): each track carries its OSM `gauge` in
  metres as `g` (`tram.py` `gauge_of`, 600–1700 mm accepted, else none;
  fragments of different gauges are not chained) — Dresden 1450, Leipzig
  1458, Munich 1435 mm; an untagged track gets standard gauge
  (`TRAM_GAUGE` = 1.435 m in `lib/city/tram.ts`, Dresden's 1.45 until
  then). Runtime `app/_components/tram-layer.ts`: two rails per track at
  ± half its gauge (`addTrack`; Dresden's ±0.725 m) with the rail layer's profile (`addRibbon`), in the road's
  lavender-grey a shade deeper — **street**: the heads flush with the road
  (+2 cm), no sleepers, and no groove (the plan's darker groove strip was
  left out: fewer, calmer lines); **grass**: rails +15 cm over a 2.6 m meadow strip
  (two grass tracks ≤ 4.5 m apart share one lawn, the inner edges at the
  midpoint, `lawnHalves`, 2026-10-21, V23: 67 % of Dresden's 13.3 km of
  grass track, 98 % of Leipzig's 3.7 km, 67 % of Munich's 2.6 km);
  **ballast**: rails +17 cm over a 2.8 m ballast strip (+25 cm until
  2026-10-21, the rail layer's head height). A track the OSM
  way puts on a bridge rides the deck (the shared lift table, any deck kind
  — gated on the tag, so a tram under a railway bridge stays on the
  ground). **Contact wire** 5.6 m over the rail top, sagging 0.15 m between
  the supports (`lib/city/tram.ts` `wireStations`/`wireDrop`: both line
  ends are stations, so the wire meets its neighbour tile at the same
  height; gaps > 30 m get evenly spaced virtual stations); span wires 7 m
  up the masts / 6.5 m at the rosettes, lifted to clear the wires they hold
  by 0.5 m, with a hanger down to each; arms 35 cm over the wire with a
  stay. All wires are one **camera-facing ribbon mesh** per tile whose
  width is `max(true width, 0.8 px)` in the vertex shader, its alpha the
  true coverage (≥ 0.2) × 0.6 in a light slate, faded from 150 to 350 m —
  light and faint, a pencil line rather than ink; no `Line2`, no MSAA, no
  new dependency; wires never cast (`castShadow = false`). **Masts**: a
  7.5 m pale green-grey pole, instanced, casting. **Stop signs** (phase 3): OSM puts
  `railway=tram_stop` on the track (144 of 164 within 0.5 m of it), so the
  sign stands on the nearest mapped platform (`public_transport=platform`
  / `railway=platform`, ≤ 25 m) at its point nearest the stop, facing the
  track — the "H" sign of plan 030 (`buildFurniture`), 107 of them; none
  within 8 m of a shelter, a bus stop's sign or another tram sign; the 4
  stops with no platform mapped get none. Look unverified on a real GPU
  (the plan's plates at Postplatz/Augustusbrücke, dusk and 150 m fly are
  open). **Stop signs** (2026-10-21, V25) never stand on a platform below
  ground (`osm.below_ground`) or on one tagged `subway`/`train`/`bus` = yes
  without `tram`/`light_rail`: Dresden 230 → 229; Munich's 9 signs on the
  U-Bahn platforms under their stops moved to the tram's own.
  **Side and centre poles** `≈ assumed` (2026-10-21, QA V24): supports
  stand where a track crosses a 30 m grid line along its main axis
  (`grid_stations`; both tiles of a seam pick the same places); where no
  mast is within 45 m and a side has no facade within 15 m, a side pole
  (`k: pole`) stands at the street's edge — the first class-raster change
  beyond the outer track, 0.5 m past the kerb on a road, 0.5 m inside a
  lawn or paved bed, 3 m beside the track where nothing changes within
  14 m (a square, a road so wide the tram has its own bed), never within
  1.7 m of a track — a mapped post lamp within 3 m being the pole
  (`lamp: 1`; the step reads the lamps files of the tile and its
  neighbours); spans ≤ 40 m; a centre pole with an arm over each track
  only where a double track's central strip (its spacing − 2.65 m, the
  widest car) exceeds 1.5 m. Drawn as the masts are (the same 7.5 m
  pole). Track more than 25 m from a support: Dresden 78 → 10 %, Leipzig
  83 → 8 %, Munich 62 → 8 % (2 644 / 1 357 / 684 poles; Dresden's spans
  133 → 1 587). A span from a pole to a facade is still written as a pole's
  span (its facade end at 7 m, not a rosette's 6.5 m). The tram step is
  slow: Dresden 12 min, Leipzig 4.6, Munich 7.3.
  **Style (maintainer feedback on the fences, applied before any plate):**
  everything in the scene's soft clay/watercolour idiom — no near-black,
  no fine detail: rails in the road's lavender-grey a shade deeper, the
  groove the plan asked for left out, wires a light slate at ≤ 0.6
  opacity, masts pale green-grey.

  | tile | tracks | street km | grass km | ballast km | masts | spans | rosettes | arms | stop signs |
  |---|---|---|---|---|---|---|---|---|---|
  | 33410_5656 | 95 | 20.53 | 0.76 | 4.73 | 118 | 51 | 28 | 13 | 57 |
  | 33410_5658 | 20 | 12.17 | 0.54 | 0.25 | 33 | 13 | 36 | 6 | 16 |
  | 33412_5656 | 51 | 11.34 | 0.98 | 1.90 | 16 | 7 | 27 | 2 | 23 |
  | 33412_5658 | 9 | 5.66 | 0 | 1.19 | 0 | 0 | 17 | 0 | 11 |

  (The table was baked when only the road class made a street bed.)

### Walls and fences
- **Walls** `❝ taken` `≈ assumed` (*Brühlsche Terrasse &c.*) — OSM `barrier=retaining_wall|city_wall|
  wall` + `man_made=embankment` + `natural=cliff` (kind `cliff`, default 3 m;
  read from `other_tags`, since GDAL has no `natural` column on `lines`)
  (ODbL), with the tagged `height` (e.g. the
  8.5–9 m city walls). `pipeline/bake/walls.py` → vertical ribbons toned
  by their material (`lib/city/walls.ts`), **baked into the fine terrain glTF** as a
  `walls` node (`scripts/bake-tiles.ts` `wallMesh`,
  [ADR 0030](./adr/0030-terrain-tin-and-wall-snap.md)):
  base on every tile's fine TIN (so a wall near a seam reads its
  neighbour's), top on the high shelf; an earth-retaining wall snaps to the
  step the TIN measures (face at the ramp foot, a coping cap back to where
  the ground reaches its level —
  "Terrain TIN" above), any other wall stands on the OSM line nudged
  slightly onto the low side; `wall-layer.ts` only gives it its material.
  **A freestanding wall rises its height above the ground** (2026-10-20,
  kinds `wall` and `city_wall`, `FREESTANDING_M` in `lib/city/walls.ts`):
  its top at least its tagged (or default) height above the low side, so on
  level ground it stands from the ground up instead of ending at it, with a
  body — a cap over its thickness (0.4 m, a city wall 1 m) and a back face
  to the ground — straddling its OSM line there and moving the usual 1.5 m
  onto the low side as the step across it grows to 1 m. *(The high-shelf
  rule alone buried every freestanding wall on level ground, its top at
  the ground: in Dresden 32 km of the 61 km of `barrier=wall`, of which
  DOM1 shows four in five standing a metre and more; in Leipzig and Munich
  half of them too, in Hamburg a quarter. A retaining wall still ends at
  its high shelf.)*
  **The coping cap faces up whichever side its high shelf is on**
  (2026-10-20, `pushCap`): the walls draw both sides, and three shades a
  triangle seen from behind with its normal turned over, so a cap wound
  downwards came out black from above. *(OSM draws a retaining wall with
  its high side to the left; where a way runs the other way, or the
  measured step lies the other way, the cap was wound against its normal:
  628 cap triangles on Meißen's tile, 5.8 % of its wall area, as the black
  band along the Burgberg's west wall; 99 on Dresden's spawn tile.)*
  **Quays are measured where the water meets the land** `⚙ derived`
  (2026-10-21, PR #173, `walls.py` `quays`, kind `quay`): every metre along
  the water's outline in the class raster (the dry shore re-classed
  first, "Water" below) the DGM is read 0.5–6.5 m onto the land over the
  water's level 1.5–3.5 m out on it; a station is a quay where the land
  stands 1.5 m over the water within 2.5 m, its steepest metre climbs
  1 m (a revetment's 1:1.5 or a dike's 1:2 does not), three quarters of
  the climb to 6.5 m is done by then (a wall, not a slope's foot) and the
  NDVI there is under 0.2 (a grass bank is no wall). A majority over five
  stations, runs of 8 m or more; then a mapped line takes the stations it
  draws or keeps open, so no window bridges it: a wall that holds the
  earth within 7 m (its snap reaches 6 m for the steepest metre, the same
  step), a freestanding wall within 3 m that rises 70 % of the station's
  climb (it faces the water itself; a parapet on the quay's top does not)
  and a flight of steps within 2 m (its foot stays open). The height is
  the median rise, the material the site's majority, the walls file's
  credit the provider's beside OSM's. The terrain bake treats a quay as a retaining wall: it snaps
  to the measured step, its face at the ramp's foot in the water, its
  coping on the quay. Measured on the committed tiles (2026-10-21, with
  the vetoes): 22.1 km on Hamburg's four tiles (11.2 km on the
  Landungsbrücken's, 10.0 km on the Speicherstadt's), 3.5 km in Dresden's
  Alberthafen and along the Weißeritz, 100–200 m each on Leipzig's,
  Meißen's, Grimma's and Munich's rivers, a few metres in Unna. *(A first bake left the mapped walls on Hamburg's quay
  edges standing — 1.75 km of `barrier=wall` measured down to the water
  — and drew a quay a metre from each, and a quay across the foot of
  three flights of steps.)* *(OSM maps few quays — `man_made=quay` on 5 km of
  Hamburg's harbour, three lines in Dresden — and the DGM rounds every
  quay into a 1–2 m ramp: the water class reached up it, and with the
  shore rule the ramp read as sand whose TIN triangles hung down the face
  in folds, the saw-teeth along the Landungsbrücken.)*
  Until then the browser built the ribbons from the GeoJSON over whichever
  terrains were loaded. **Why OSM:** no elevation product has the wall as a
  *vertical face* (a 2.5D surface cannot), and it's not a CityJSON building,
  so it "went missing". OSM has it as explicit vector lines with heights.
  *(Corrected by the terrain study, "Terrain TIN" above: the source data
  does NOT smooth the wall into a gentle bank. The laser ground returns step
  within ~0.75 m (median, 7 tall walls) and the native 1 m DGM1 within
  ~1.7 m at 77° — Jungfernbastei: 108.6 → 117.3 m over 2 m, then two more
  terrace levels at 119.7 and 121.1 m. It is the 1024² resample that widened
  the step to ~2.9 m at 69°, the "bank" the viewer showed. The earlier claim
  "LiDAR-ground ≈ DGM" was right about the level — the two agree to
  0.00 ± 0.05 m tile-wide — but not about the edge.)*
  **Source:** a LOCAL Geofabrik `.osm.pbf` read via GDAL's OSM driver (both the
  `lines` and `multipolygons` layers — GDAL files closed barrier ways as
  polygons), with **no Overpass rate limits** and reproducibly (the bash-era
  version of this bake was verified feature-for-feature identical to the old
  Overpass bake: 436 walls, same kinds/lengths/heights). Since
  [ADR 0037](./adr/0037-sites-providers-and-per-site-data.md) every OSM layer
  comes from that extract (`pipeline/bake/osm.py`).
  **Heights measured, materials toned** (2026-10-21, PR #173 B5/B6) — an
  untagged `wall`/`city_wall` is measured every metre along its whole way:
  the highest DOM1 cell (the laser scan's 0.5 m `dsm_050` where every tile
  read has one) within 1 m of the line, a cell the NDVI calls a crown
  (≥ 0.45) left out, over the lower ground 1.5 m either side; a station
  counts where one side lies open (the surface within 0.5 m of the ground
  2.5 m out), no OSM building within 1 m, under its class's cap (wall 6,
  noise barrier and flood wall 8, historic city wall 15 m). With ≥ 3
  stations and ≥ 30 % counting, the median is its height; else noise
  barrier 4 m, flood wall 2.5, historic city wall
  (`historic=citywalls|city_wall|castle_wall`, heritage) 6, a plain wall
  the tile's measured median (≥ 10 walls) or 1.5 m. *(Every untagged wall
  stood 1.5 m and every city wall 6 m; the surface model gives 1.8–3.1 m
  medians, Hamburg's 57 % under 1.2 m, noise barriers 2.8–4.6 m, Grimma's
  flood walls 2.3–4.2 m.)* A wall under 0.3 m is left to the kerb; a
  measured low garden wall (0.3–0.8 m) stands (`KERB_WALL_M`, `MIN_H` 0.7 m
  in `lib/city/walls.ts`; it was dropped under 0.8 m). Material (`mat`:
  `material`, `wall=*`, a historic city wall stone, else the site's
  majority of tagged walls, ≥ 8, else concrete — Dresden and Meißen stone,
  Leipzig brick, the rest concrete) is drawn as the wall's vertex colour
  (`WALL_TONES`; a cliff or an embankment keeps the sandstone).
- **Fences, railings and gates** `❝ taken` `≈ assumed` — OSM `barrier=fence|handrail` (lines and
  the outer ring of areas) ride the walls file after the walls, as
  `{kind: "fence", type, h}`: `fence_type` railing/metal/bars → `railing`,
  wire/chain_link/chain/temporary → `mesh`, wood/split_rail/pales →
  `picket`, untagged → `railing` (Dresden's wrought iron), a handrail →
  `rail`; `height` when 0.3–4 m, else 1.2 m (a handrail 1.0 m). Every line
  is clipped to the tile **as a line** — an area's outer ring first, then
  the ring cut at the tile edge; clipping the area as a polygon first had
  closed its ring along the edge, a ruler-straight fence or wall on the
  seam that stands nowhere (1.52 km of fence in 10 rings and 216 m of wall
  in 2, e.g. 328.7 m of railing along x = 412000; now 0 m on any tile
  edge, guarded by `features.test.ts`). Last come the gates
  (`barrier=gate|lift_gate|swing_gate|cycle_barrier` points within 0.5 m of
  a wall or fence line, snapped onto it, `{kind: "gate", w, on}`: `width`,
  else 1.2 m, a lift gate 4 m); a neighbour's gate whose gap reaches over
  the seam comes along as `{seam: true}` and cuts this tile's piece too
  (none over the fifteen tiles). 189.3 km of fence and 1 452 gates on a
  line over the fifteen tiles (1 238 on fences, 214 on walls; 2026-09-26);
  on the four first 97.7 km and 875 gates (15.5 / 45.0 / 14.7 / 22.5 km
  on `33410_5656` / `33410_5658` / `33412_5656` / `33412_5658`; 746 gates
  on fences, 129 on walls; about 520 gate points stand on no mapped line
  and are dropped). The committed walls are older than the gates (below):
  a gate is kept only on a line of its kind the file itself carries, which
  dropped two `on: "wall"` gates 70–73 m from any committed wall
  (33412_5656, 33412_5658) on 2026-09-26. **Baked into the
  fine terrain glTF** as a `fences` node (`lib/city/fences.ts`,
  `scripts/bake-tiles.ts` `fenceMesh`, ADR 0030): **one low, calm band**
  along the line on the fine TIN — a flat, double-sided quad per ≤ 2.5 m
  (closer where the ground bends between, ADR 0030: a band bridging a dip
  floated over it) at
  ¾ of the tagged height (0.4–1.5 m, 1 m until 2026-10-21; a handrail only its top 15 cm) — cut
  `w` wide at each gate with a leaf in a lighter tone in the gap (a boom
  at the band's top for a lift gate, swing gate or cycle barrier); a closed
  ring is cut across its closing vertex too (14 gates at a ring's closure
  had cut only half their gap). Gates on a freestanding wall (`kind` wall)
  cut that wall's ribbon the same way. Fences never enter the conflation,
  the stair burn or the step snap: they stand on their OSM line.
  `fence-layer.ts` gives the band one muted tone close to the ground's and
  the hedges' (a warm grey-sage; wood a warm stone), a breath deeper at the
  foot, lighter toward the top edge (a see-through impression by colour
  alone), fading toward the pale ground from 40 to 160 m, and lit as the ground it
  stands on (its normal the world's up), so no side turns dark; opaque, no discard, no
  dither; it receives shadows and casts none. 13 506 / 38 612 / 12 734 /
  19 032 triangles per tile. The walls file keeps its walls verbatim from
  the Geofabrik bake (the terrain study addresses them by index) but for
  the two seam artefacts, cut off exactly as the fixed bake cuts them; the
  fences and gates come from the BBBike extract of 2026-09-19. **Not yet
  judged on a real GPU** (plan 029, plan 019). Plan 029.
  An untagged fence within 15 m of an above-ground rail track, or along a
  pitch, school or industrial site (grown 3 m), over half its length, is
  2 m, others 1.2 m (2026-10-21, B9); the flights' handrails ride the same
  bands (*Flights of steps* below).
  - *Discontinued first look* (🗃️ below): a procedural panel — bars every
    12.5 cm, a wire diamond mesh, pickets, a post every 2.5 m and a top
    rail, alpha-cut, a dithered veil far off and a dithered partial shadow.
    On a phone it was "zu hart und kleinteilig" and then "stärker
    stilisiert, mildere Farbwahl, Kleinteiligkeit führt zu Artefakten"
    (maintainer, 2026-09-25): dark iron read as ink against the pastel
    scene, and the fine bars and the dither aliased (moiré, shimmer).

### Wall → terrain conflation (breakline burn at build time)
*The coarse level only since the fine one became a TIN* ([ADR
0030](./adr/0030-terrain-tin-and-wall-snap.md)); there the wall ribbons snap
to the measured step instead (`lib/city/wall-snap.ts`, "Terrain TIN" above).
- **Stepped ground at walls** `◎ detected` — `lib/city/terrain-conflate.ts`, applied at build
  time to the coarse grid (and a fine one whose DGM has holes) before it is meshed (`scripts/bake-tiles.ts`
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
  **Measured cost (terrain study, "Terrain TIN"):** against held-out laser
  ground it raises the RMSE in the 20 m band around walls from 0.43 to 0.76 m
  (p95 0.80 → 1.62 m) — the 11 m probe reads the *top* of a terraced wall, and
  the step lands on the OSM line, not the measured edge. Hence the fine
  level's TIN skips it.

### Stairs (OSM steps over a lowered terrain)
- **Flights of steps** `❝ taken` `= computed` `≈ assumed` (*Freitreppe am Italienischen Dörfchen &c.*) — OSM
  `highway=steps` (ODbL). `pipeline/bake/stairs.py` → `stairs_<tile>.geojson`:
  the axis oriented bottom → top, `w` from `width` (else an
  `area:highway=steps` outline: area ÷ axis length; else the gap between the
  OSM walls either side when the slope fills it, the axis re-centred; else
  1.5 m — 2.5 m in a pedestrian area: `highway=pedestrian` or an
  `area:highway` outline within 1 m of its middle; 2026-10-21, it was
  2.5 m everywhere), `z` = the two
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
  flight to 12 cm below the ramp (on the fine TIN 12 + 15 cm, its tolerance) through the steps' inner corners — lifting
  it where the DGM runs below, since the player walks on the grid — and
  lowers every vertex beside it whose triangles reach under it, never
  across a wall; beside a flight that stands above its surroundings (the
  ground 3.5 m out below its ramp) it digs the DGM's blurred shoulder —
  the raster rounds a raised flight's sides into a slope a metre or two
  wide, which showed as a ragged bank beside the cheeks — down to that
  ground, up to 2.5 m out. The same build step writes each flight as blocks in its material's tone
  — treads, darker risers, side cheeks down past the bottom landing; where
  the bank beside a flight stands ≥ 0.4 m above its treads (a flight cut
  into a slope, read 3.2 m out on the final ground, never across a wall), a
  *Wange* instead: a 3 m block topped at the bank's level, a 0.5 m stone
  coping along the steps and the rest in the built-up ground's tone, over
  the ground the burn lowered beside the flight, which had shown as a
  ragged trench (its outer edge meeting the bank where it ends) — since
  2026-10-21 only on a side an OSM wall or building runs along (`walled`,
  within 1 m at two of three quarter points); along an open side the bank
  stays ground (Meißen's Burgberg: grass banks) and a tagged handrail
  (`handrail`, `handrail:left|right`, turned with the axis; not where a
  fence or handrail is mapped) stands as a rail 0.15 m inside the edge on
  the nosing line, its top 0.9 m up. The tone follows `surface`
  (paving/asphalt concrete, sett stone, metal grid metal, unpaved wood),
  else the site's majority (`mat`, `STAIR_TONES`); a cheek
  reaches the ground beside it, and a top landing over lower ground drops
  a face to it (ADR 0030) — into
  the fine terrain glTF of the tile owning its middle (a `stairs` node,
  vertex colours); `stair-layer.ts` only gives it its material.
  **Why:** the DGM1 smooths a staircase into a bank (the flight beside the
  Italienisches Dörfchen read as a grassy slope), and a terrain built from
  it cannot hold a 16 cm riser ([ADR 0030](./adr/0030-terrain-tin-and-wall-snap.md)).
  **Fallback:** no `.osm.pbf` → the step is skipped, the committed file stays;
  no file → no stairs, the terrain as before. Pure + unit-tested
  (`stairs.test.ts`, the bake end-to-end against a synthetic OSM extract in
  `pipeline/tests`).

### Lighting
- **Soft shadows** `= computed` — `PCFShadowMap` + raised `shadow.radius`; terrain
  `castShadow=false`; `normalBias=0`; tight camera-following frustum, whose
  camera also drives the tile streaming (casters behind the player stay
  loaded) — on a desktop, at a resolution of its own, not the map's:
  128 px, where it still refines the eye-level frustum's fine level but
  never from the air
  (`SHADOW_STREAM_PX`, [ADR 0047](./adr/0047-phone-memory-budget-in-true-bytes.md)).
  A phone's shadow camera streams no tiles at all since 2026-10-10
  (`shadowTilesStream`, plan 071; at its 64 px it had loaded a tile's
  buildings and coarse ground, tiles in use the memory governor cannot
  free): at a seam with the sun behind the player, the neighbour's
  buildings cast no shadow until the view loads that tile;
  the map has no colour target (`DepthOnlyShadowNode`, three r187's
  depth-only render target). Full recipe and dead-ends in the
  [city-walker skill](../.claude/skills/city-walker/SKILL.md).
- **Sky-view factor** `= computed` (*Himmelslicht*, plan 033) — the committed DGM1 with
  every non-vertical LoD2 surface burned on top (max over its triangles,
  each on its surface's plane; `lowveg.py`'s one CityJSON walk,
  `lod2_rings`) → per ≈2 m cell the horizon angle `h` within 150 m in 16
  azimuths, seen from the bare ground → `svf = 1 − mean(sin² h)`
  (`svf_<tile>.png`, 1024², 8-bit, ≈0.5 MB). The cells under a roof (16–19 %
  of a tile) take the nearest open cell's value (scipy
  `distance_transform_edt`): left at their ≈0, LINEAR filtering and the
  mipmaps pulled a dark 1–2 m band onto the wall feet and dimmed distant
  streets (a tile's mean at mip 4 fell 0.03–0.05 below its open mean; now
  equal). Scales the **indirect diffuse
  only** (the hemisphere fill), as the material's `aoNode`, which three
  multiplies into the indirect light after the lights: the sun is
  untouched. Terrain: `mix(1, svf, row)`. Clay facades: the ground's
  value 2.5 m outside the wall (a margin past the footprint's filled texels),
  doubled (a vertical face sees at most half the sky; the ground at its foot
  the wall too) and faded to 1 toward the eaves — a courtyard's ground floor
  dims, its eaves and every roof do not. The raster is shared by a tile's
  terrain (both levels) and its buildings, refcounted
  (`shared-rasters.ts`); the clay binds a white texel until it lands.
  Where a LoD2 roof was rebuilt from DOM1 (ADR 0036) the rebuilt parts are
  burned instead, as the city mesh draws them. **The crowns count half**
  (2026-10-21, `CROWN_TRANSMISSION` 0.5): the crowns the viewer draws
  (canopy, laser scan, cadastre, the DLM's rows — their committed files, as
  wide as `lib/city/tree-placement.ts` draws them) are a half-transparent
  occluder, blocking half the sky they cover above the solid horizon. Left
  out, an avenue under its crowns saw 0.73–0.94 of the sky, solid
  0.01–0.03; at half, Dresden's carriageways under crowns (12.8 % of them)
  fall from 0.90 to 0.52, about halved on every site, open ground by
  0.04–0.08. The horizon (below) still leaves them out — they cast real
  shadows inside the frustum, and a horizon angle cannot hold half a crown.
  Beyond the site the field is Copernicus GLO-30 (as the horizon's, below);
  without it the site's edge continues level. Default
  0.5 — **not yet judged on a GPU**: the plan's plates (a Neustadt
  courtyard, the Prager Straße, the Elbwiesen) and the double-darkening
  check against the contact shadows (GTAO since plan 020) are open;
  *Boden-Verlauf* (the clay's 5 m ground darkening) is kept as it was, not
  retuned against it yet.
  **Fallback:** no raster → the light as before. `pipeline/bake/skyview.py`,
  `app/_components/sky-light.ts`, `lib/city/skyview.ts`.
- **Horizon shade** `= computed` (*Ferne Schatten*, plan 033,
  [ADR 0009](./adr/0009-shadow-recipe.md)) — the same
  height field at ≈8 m (the roofs burned at 2 m and max-pooled, so a spire
  still occludes) → per cell and per 16 azimuths the elevation angle of the
  skyline in **two bands**: occluders **80 m–10 km** away (the far band,
  0–45° in 8 bits: 80–1 500 m from the 8 m field, 1.5–10 km from
  Copernicus GLO-30 alone on a 31.25 m ring, `ring_horizon`, 2026-10-21)
  and **8–80 m** away (the near band, 0–90°), eight RGBA
  layers stacked in one PNG (`horizon_<tile>.png`, 256² × 16 azimuths × 2,
  1.13–1.23 MB; legend `horizon_<tile>.json`, not served); cells under a
  roof take the nearest open cell's angles. The terrain interpolates the
  two azimuths around the sun and cuts the sun's direct light by
  `smoothstep(h − 0.8°, h + 0.8°, elevation)`, combined with the shadow map
  by **min** (never a product: where both see the same occluder it must
  not darken twice). The bands split the work with the shadow map by the
  fragment's distance from the frustum's centre (`shadowReach`, a shared
  uniform node kept by
  the sun rig as the frustum follows and grows): inside, the map has the
  near occluders with their shapes and only the far band counts; over the
  frustum's last 20 % the near band fades in, and beyond it the horizon is
  the higher of the two bands. *Why two bands (2026-09-25 review):* with
  the far band alone, ground past the ~110 m frustum lost the shadows of
  its own neighbours — a 20 m block's 55 m shadow at a 20° sun was missing
  entirely, at 10° only the detached 80–113 m tail showed. Committed
  neighbour tiles fill the margin; **beyond the site the land is
  Copernicus GLO-30** (2026-10-21, `pipeline/bake/glo30.py`): the 30 m
  surface model, read once per site out of the public cloud-optimised
  GeoTIFFs (the site plus 10 km, cached as `data/_raw/glo30/<site>.tif`),
  smoothed over 3 × 3 cells and moved onto the DGM1 by the median of their
  difference over the open ground both cover (`align`: Dresden 2.84 m,
  Leipzig 3.25, Meißen 2.22, Grimma 1.45, Hamburg 0.46, München 6.36,
  Unna 1.87 taken off). Without the cached window the site's own edge
  runs on level outward (`extend_edges`). Before, the ground beyond was
  open at the whole edge's mean height (🗃️ below), a wall up to 25° too
  high near a sloping site's low side. The ring past 1.5 km adds little:
  up to 2.5°, on 5.8 % of Meißen's point-azimuths. Baked in ≈25–40 s per tile
  (sky view ≈20–35 s, horizon ≈5 s). The plan's 4 m raster came to
  **1.86 MB** for the far band alone on the spawn tile, past its 1.5 MB
  cap, so it ships at 8 m with all 16 azimuths (the far band alone was
  0.54–0.60 MB; both bands fit the cap). Terrain only; facades wait on
  plates. Default 0.8 — **not yet judged on a GPU** (the plan's 21
  December plate from the Brühlsche Terrasse and the frustum seam are
  open). `sky-light.ts` `applyGroundLight` (the material's
  `receivedShadowNode`, `min` with the shadow map), `hzSunVisible`.

### Atmosphere & time of day
- **Height-term fog** `= computed` `≈ assumed` — DGM elevation (per-fragment world height) → extra haze
  pooling in low ground, a term of the one `scene.fogNode` every material
  takes (`fog = false` opts out: the river mist); *Talnebel*, fixed at
  0.2 (`VALLEY_HAZE`; Modell fades it out).
  `height-fog.ts`. **Sets in with distance** (2026-10-09): none within
  40 m of the camera, all of it from 900 m (`VALLEY_NEAR_M`); at the full
  share 10 m off, the default 0.2 greyed every nearby surface by ≈ 18 %
  (a shop pane at sRGB 102/105/108 against 56/61/65 without it), and
  full from 90 m it laid one flat veil over the river and the meadows in
  the lower half of the start view, the same at 200 m as at 2 km. **Depth from the site's relief** (2026-10-01, ADR
  0039): the pool's fade height (`heightFalloff`) was Dresden's
  Elbe-to-rim 28 m everywhere, which hazed flat Hamburg and Munich from
  the river to the rooftops. `prepare-data.ts` samples each tile's coarse
  ground on a 32 × 32 grid and writes the site's 2nd and 90th height
  percentile into the tileset's `extras.ground` (`groundRelief`);
  `create-app.ts` sets the fade height to 0.6 × that relief, clamped to
  8–28 m (`lib/city/valley-fog.ts` `valleyFalloff`; 28 m without
  `ground`). Dresden, Grimma, Meißen and Unna keep 28 m; Hamburg ≈ 9.6 m,
  Leipzig ≈ 12 m, Munich ≈ 15 m. **The valley's depth from its rim**
  (2026-10-21): the sky-view bake measures per tile its low ground
  (`glo30.tile_floor`, the DGM1 averaged over 30 m cells and ≈ 150 m) and,
  per 22.5° sector within 5 km of it, the rim's height in GLO-30
  (`glo30.rims`; a building's or a copse's height taken out), written as
  the horizon legend's `valley`; `prepare-data.ts` (`valleyRims`) reads
  them into the tileset's `extras.ground` as a third value, the depth:
  per tile the lower side's rise over its floor across its deepest axis
  (`valleyDepth`), the site's deepest tile. The fade height is 0.6 × that
  depth, 8–28 m; without GLO-30 the site's p90 − p2 as before. Unna
  28 → 12.4 m (a one-sided slope below the Haar is no valley, 🗃️ below),
  Munich 15.1 → 10.9 m, the rest unchanged. Not yet judged on a real GPU.
- **River mist** `❝ taken` `≈ assumed` — DLM water mask (the painted splat's alpha) → a drifting,
  sun-lit mist sheet over the Elbe, always on. None within 120 m of
  the eye, full from 1.2 km, at most 24 % opaque and only 30 % of the way
  from the sky's tint to white (it was full from 90 m at up to 62 % and
  60 % of the way to white, and the near river in the start view lay
  under a pale, drifting band that read as a smear on the screen). The
  strength is the *Flussnebel* slider's old default (60 % of 0.4) since the
  slider went (🗃️ below). `water-layer.ts` `createWaterMist`.
- **Drifting clouds** `≈ assumed` — `SkyMesh`'s procedural clouds drift on TSL `time`
  (slow `cloudSpeed`), lit by the sun instant. `sun-rig.ts`.
- **Golden/blue-hour palette stops** `= computed` `≈ assumed` — sun altitude → sky/fog/hemisphere colours
  from a palette with stops at −2° (blue hour) and +6° (golden hour).
  `lib/city/atmosphere.ts` `STOPS`.
- **Meadow mottle** `≈ assumed` — DLM class 1 (farmland/meadow) → a low-frequency
  colour + normal mottle so grass reads as ground, not paint. `terrain-layer.ts`
  `grassMottle`/`terrainNormal`.
- **Contour ink guard** `= computed` — a flat terrain quad lying exactly on a 2 m or 10 m
  contour has `fwidth` 0, and 0/0 striped it with NaN ink (a diamond of
  lines on flat roads). No slope, no contour line. `terrain-layer.ts`.

### Traffic (the data layers)
Overlays on the city, each switched on and off on its own in the HUD
(*Erkunden* → *Verkehrsdaten*; `lib/city/data-layers.ts`, one flag per
layer in the look store and the snapshot, all **off** at boot): nothing is
drawn, fetched or polled for a layer that is off (the counted sections'
features, 37 KB a tile, are fetched with their tile's dressing; the glass
bodies are built on the layer's first switch-on per tile, kept hidden when
it is switched off and freed with the tile — plan 062, ADR 0040's
2026-10-07 update). They
are measurements laid over the poetic city, not part of it: unlit or flat
colours, no shadows, no text in the scene (what they say in words is in
the sidebar). Judged on SwiftShader plates only so far — **unjudged on a
GPU**.
- **Counted motor traffic** `❝ taken` `≈ assumed` — in Dresden the city's *Verkehrsmengen* (WFS
  `cls:L363` "Kfz/Tag", Straßen- und Tiefbauamt, dl-de/by-2-0; 2 082
  sections over the fifteen tiles, mostly counted 2023–2026: one-day hand
  counts scaled to the average day, induction loops and infrared detectors
  as yearly means, a few estimates) → `pipeline/bake/traffic.py` →
  `traffic_<tile>.geojson`: each section cut to the tile, the vehicles per
  day along and against its line (`f`/`b`, absent where a direction was not
  counted), the heavy-goods share per direction, the year and method, the
  street, `br` on a section that runs over a bridge (2026-10-21,
  `traffic.py` `on_deck`: at least 10 m of it inside one road deck of the
  tile's or a neighbour's bridge file, each piece within 30° of the deck's
  axis there — a road passing under a bridge stays on the ground; by the
  street's name — "…brücke" — only on a tile without a bridge file, 🗃️
  below; where the raw counts are no longer cached, `--step traffic`
  re-flags only `br` of the committed sections, `reflag`). On a bridge: Dresden 23 → 34 of 1 859 sections (25 gained,
  14 approaches named after their bridge lost), Hamburg 0 → 33, Meißen
  0 → 6, Unna 0 → 3, Grimma 0 → 1. Runtime
  (`app/_components/traffic-layer.ts`, `lib/city/traffic.ts`): one **glass
  body** per counted direction on the right of its travel (both: either
  side of the line; one: on the line; only a total: on the line, not
  flowing) — a soft dome in cross-section, 1.2–3.6 m wide and 0.6–6 m
  tall with the root of the vehicles per day, tapering to a round point
  over the last ≤ 8 m only where the flow really ends: an end within 3 m
  of another counted section's end, or on the tile's edge (the bake cut it
  there), runs on full (`openEnds` — tapering every section end drew the
  streets as strings of beads, pinched at every junction and seam). Feet
  0.2 m under the ground, on a bridge street the deck. **Both terrain
  levels carry the flows**: the fine one a cross-section every 2 m with
  ten segments, the coarse one (the tiles the fine level has not reached)
  every 8 m with six, about a seventh of the vertices, on the coarse
  ground; 3D Tiles swaps them with their terrain. Built on the fine level
  only, the flows ended at the first tile the fine level had not loaded —
  the Waldschlößchenbrücke stopped at its Johannstadt end, the
  Käthe-Kollwitz-Ufer showed nothing from across the river. Its tint runs over
  five stops placed where Dresden's lanes spread (`TRAFFIC_SCALE`: 400,
  2 000, 5 000, 9 000, 16 000 a day — sage, peach, coral, rose, wine;
  log-spaced between stops; yellow is left to the trams), slate mixed in
  with the heavy share. One log scale from 300 to 30 000 put every main
  road in the same coral (half the lanes carry under 2 700 a day, a
  quarter over 6 000). **The flows keep the scene's hour**
  (`lib/city/traffic-hours.ts`): the counts are per day, so each lane's
  count is spread over the day on a measured curve — Hamburg's infrared
  counters on 38 inner-city main roads, hourly, September 2026 (Urban
  Data Platform, dl-de/by-2-0), per working day, Saturday and Sunday.
  The hour's multiple of the average hour (≈ 0.08 at 3 h, 1.8 at 16 h on a
  working day) sets the colour (the count × that multiple on the scale),
  the body's size (√, from 0.35× to 1.5× of its daily one) and how many
  of its comets are lit (one in eight at night, all from the average hour
  on); the light runs at 11 m/s, slowing to about half at the evening
  peak (integrated on the CPU, so it never jumps). Two shared uniforms,
  nothing rebuilt; the sidebar says the hour and that the curve is a
  typical one, not a measurement of the street. Light runs through the
  body in the direction of travel (soft comets, up to three times as many
  on a busy lane), brightest along the crown. The
  glass (`glass.ts`) refracts the street, trees and houses behind it with
  a touch of dispersion, a sky sheen and a Fresnel rim, and thickens into
  its own colour from the air and past ~200 m, so the layer reads as glass
  up close and as a map from above; the bodies widen up to 5× from the
  air (`map-overlay.ts` `mapWidenNode`). A street without a count draws
  nothing — no gap filling, no model. A click on a flow asks it (the
  twin's card: its counts, directions, year, method, the hour's
  estimate and the source).
- **Bicycle counters, live** `❝ taken` — the city's permanent counters (WFS
  `cls:L1781` "aktuelle Zählwerte", dl-de/by-2-0; 35 counters, the
  bicycles of the last full hour per direction) read **by the browser**
  from the city's server (it answers any origin) when the layer is
  switched on and every 5 minutes while it is on — not while the page is
  hidden; back in view it reads at once when the counts are older than one
  poll (`app/_components/bike-layer.ts`, `lib/city/bike-counts.ts`): a pair of
  **glass columns** per counter across the street (`winkel`, its run,
  degrees counter-clockwise from north), one per direction (teal, lilac),
  height 1.5 m + 1.6 × √count (482 an hour on the Albertbrücke ≈ 37 m),
  the top a soft dome; rings of light rise through each at 0.18 m/s ×
  √count, and a soft pool of its colour lies on the ground around its
  foot; grey and still when the count is older than three hours. The sidebar lists the counts,
  busiest first; a click flies there, a click on a column asks it. The first runtime request to a
  server other than the site's own ([ADR 0040](./adr/0040-data-layers-and-live-city-data.md)).
- **Every site, its own sources** `❝ taken` (`Site.dataLayers`, `sites/<id>.ts`):
  a site names the source of each layer it has, and the HUD offers only
  those (`siteDataLayers`; the "sources by city" page marks the rest).
  Motor traffic: Dresden's own per-direction counts; **Berlin's**
  Verkehrsmengen 2023 (gdi.berlin.de WFS `dtvw2023kfz`, vehicles per
  working day, dl-de/zero-2-0; configured, Berlin's tiles not built yet);
  **Hamburg's** Verkehrsmengen 2019 on the main roads
  (`HH_WFS_Verkehrsmengen`, `dtv` + heavy % `sv`, dl-de/by-2-0; 547
  sections on its four tiles); **Saxony's road census** SVZ 2021 (LASuV,
  statewide shapefile, dl-de/by-2-0; Grimma 10, Meißen 14 sections: the
  federal, state and district roads only); **NRW's Verkehrswerte**
  (Straßen.NRW WFS, GML only, `DTVKFZA` + `DTVSVA`, dl-de/by-2-0; Unna
  23). Every source but Dresden's counts both directions together: the
  bake splits the total evenly (`sp` 1, `m` "census" for the road
  censuses; `pipeline/bake/traffic_sources.py`), and the HUD says so. A
  one-way couplet would be drawn as two half flows — the sources do not
  mark one-way roads. Leipzig and Munich name none: neither city
  publishes counts per section, and the Land's census (Saxony's SVZ,
  Bavaria's BAYSIS SVZ 2021) does not reach their centres (0 and 0
  sections on their tiles; Munich's are the motorways at the city's
  edge). Live bicycle counters: Dresden's WFS and **Hamburg's**
  SensorThings service (`iot.hamburg.de`, the "HaRaZäN" infrared
  counters, hourly per counting point and direction, dl-de/by-2-0; 21
  points on its tiles; `lib/city/bike-feeds.ts`); Leipzig's counters
  refresh daily without CORS, Munich's monthly, Berlin's yearly — not
  live, left out. Trams by timetable: **Leipzig** (LVB; 19 lines with
  the night and special lines, 2 973 / 2 504 / 1 842 trips) and
  **Munich** (MVG; 14 lines, 2 217 / 2 186 / 1 885 trips) from the same
  feed and their own OSM tracks, Berlin configured (BVG); Hamburg,
  Grimma, Meißen and Unna have no trams. The feed lives once for every
  site, `data/_raw/gtfs/` (`bun run fetch <site>` downloads it where the
  site has trams).
- **Trams by timetable** `❝ taken` `◎ detected` `≈ assumed` — in Dresden the DVB's scheduled tram trips (gtfs.de's
  Germany-wide GTFS from DELFI's NeTEx, CC BY 4.0; ≈ 290 MB, not
  committed) → `pipeline/bake/transit.py`, **site-wide** →
  `data/dresden/transit/trams.json` (≈ 680 KB): 12 lines, 127 stop patterns, 264
  running-time profiles, 2 598 / 2 002 / 1 629 trips on a working day /
  Saturday / Sunday (the busiest day of each kind in the next three weeks:
  3 October 2026, a holiday, lost to the 10th). The feed has no shapes:
  each leg is laid on the OSM tram tracks (`tram_<tile>.geojson`) as the
  shortest way between the tracks near its two platforms, a metre from
  platform to track weighing three of way, so a car keeps to the track
  beside its platform; every leg on the site finds one (Postplatz's
  platforms stand up to 60 m from a track). Runtime
  (`app/_components/tram-cars.ts`, `lib/city/tram-timetable.ts`): every
  trip of the scene's kind of day (and the night's of the day before) at
  the scene's clock, which runs on in real time from the HUD's instant;
  a car's sections each follow the path on its own,
  standing at its stops from arrival to departure and easing between them;
  the rail top over the ground, the deck on a bridge track; a slate window
  band. **Each car in its operator's livery and length** (2026-10-21,
  V26–V29): the GTFS agency of its line (`agencies`, `routeAgency` in
  `trams.json`, from `agency.txt`; `operatorOf`, `TRAM_LIVERIES` in
  `lib/city/tram-timetable.ts`) — DVB yellow, 30 / 41 / 45 m by fleet
  share; LVB silver-grey, a yellow band along the roof, a blue skirt,
  37.6 / 45 m; MVG blue, white along the roof, 36 m; BVG yellow, 30.8 /
  40 m; any other a pale neutral 30 m — in round(L / 7.5) sections (at
  least 2) stretched to the length (until then four 7.2 m sections, DVB
  yellow everywhere; a timetable baked before the agencies draws neutral
  cars). No shadow (a moving caster would redraw the
  shadow map every frame). Behind each car a **trail of light** along its
  track (deck.gl's TripsLayer in the scene's palette): 140 m, 3.2 m wide,
  0.6 m over the rail top (the coarse terrain stands up to half a metre
  over the TIN), warm white at the car fading to gold and nothing, one
  mesh for all trams rewritten every frame; it widens from the air. **Not live positions**: a delay or a
  diversion is not shown. The sidebar says how many trams run and from
  which day's timetable.

---

### Planning views (Modell, plan 055 / ADR 0044)
- **Schwarzplan** `❝ taken` (picture style) — the LoD2 clay (`userData.figure`) drawn
  with one unlit black, the terrain white (`paperGroundOn` = 3, its
  contours off), everything else hidden for the frame; one threshold in
  the stylize pass cuts the remaining light away (`paper-scene.ts`,
  `stylize-effect.ts` mode 6). No new input.
- **Strich** `≈ assumed` (picture style) — Papier's card on the ground's **plan
  palette** (`paperGroundOn` = 2, `terrain-layer.ts` `paperGround`): the
  painted class colour's grey lightened to a light neutral, green
  (g > max(r, b) in the painted colour) a plan green, the splat's water a
  plan blue, the paint grey; the pass keeps each surface's hue and lays
  the light out as two washes under a one-pixel pen (mode 5).
- **Geländeschnitt** `= computed` — in a *Schnitt* the terrain's heights along the cut
  line (`ground.ts` `atWorld`, every 3 CSS px, ≥ 0.5 m) → a poché strip
  down below the picture (`lib/city/section.ts` `groundStrip`,
  `model-cuts.ts`); unknown ground breaks the strip, never invented. The
  clay is drawn two-sided with its back faces as poché
  (`visual-style.ts` `setClaySection`).
- **Ausschnitt plinth** `= computed` — the cut-out's four edges sampled on the terrain
  → poché walls down to 12 m below the lowest corner; the city clipped by
  the square's planes (`ClippingGroup`). Buildings on the edge are cut,
  not kept or dropped whole (that would need a per-object centroid).
  Switching the group switches every drawable's build (three keys it by
  the clipping and keeps one render object for both sides), and frees
  the one it leaves: built in the frame, that was the whole city's
  programs at once, both ways — the picture froze, a phone's tab died. A
  new cut now shows once its programs are compiled off the frames on
  stand-ins, the clipped ones under the group and the plain ones they
  come back to, and held while it shows (`post-stack.ts` `holdCut`); the
  HUD says *Wird vorbereitet …* meanwhile. The shadow pass is not
  clipped (no compile ahead reaches it): a building outside still casts
  over the cut's edge.
- **Shadow study sheet** `= computed` — the sun (`suncalc`) at 9, 12, 15, 18 Uhr on
  21.3., 21.6., 21.12. of the shown year, one capture each, as a 3 × 4
  sheet with the legend (`image-export.ts`, `lib/city/image-export.ts`).
- **Trees at every scale** `≈ assumed` — Modell draws the trees of the terrain
  level under the picture, as every mode does (✅ *The coarse level's
  trees*, Vegetation): every tree where the fine level is loaded, a
  third of them, wider, where the coarse one shows. No scale thins them
  of its own (🗃️ *Modell's trees thinned by scale*).
- **Bridges on both terrain levels** `❝ taken` `◎ detected` — the coarse level draws its tile's
  bridges as the fine one does (`buildRail` with the decks alone: deck,
  parapets, piers or arches, the measured steel; no rails), and they are
  asked on it too. LoD2's bridge slabs are left out of the buildings, so
  every river crossing used to vanish where the fine level's reach ended:
  in the air beyond the fine level's reach (≈ 2.6 km on a viewport 1080
  CSS px high), and in Modell across the whole picture from
  2.5 m/px on.
- **The bridges' surfaces** `≈ assumed` — a bridge was one flat colour per part (a
  pale slab over the river). The deck's top now carries its frame — the
  station and offset on the axis and the outline's edges there, a vertex
  attribute (`aDeck`, `rail-layer.ts` `addDeckFrame`; the top split to
  triangles of ≤ 6 m, `splitDeckTop`, since a curved deck's triangulation
  joins vertices up to 190 m apart and the frame is exact only at them)
  — and its material
  (`bridge-surface.ts`, scene-wide, world space) lays a road bridge out as
  the street it carries: footways along both sides in the pavement's
  colour with their slabs, a kerb stone and a gutter, the carriageway in
  the road's colour with a grain and, on two lanes, the centre line's
  dashes; a path bridge is sand with kerbs, a rail bridge the track bed
  with its walkways, the rest stone paving. The fascia, parapets, piers
  and masonry arches are ashlar: courses and running-bond joints on every
  upright face, a shade per block, a weathering mottle. The fine detail
  fades by the pixel's footprint; the footways, the kerbs' line and the
  mottle stay to the smallest scales.
- **The export's legend** `= computed` `❝ taken` — the scale from the view's metres per pixel
  (printed at 300 dpi), the north arrow from its turn, the credits from
  the site's attribution lines (`siteAttribution`) — drawn into the PNG,
  never into the scene (ADR 0042).
- **A planner's design in the city** `❝ taken` `◎ detected` `≈ assumed` —
  a glTF the visitor loads in the sidebar's *Entwurf* panel, read on the
  device and never uploaded (`design-read.ts`; ADR 0053): its nodes and
  instances flattened into one geometry about its anchor, moved there in
  doubles. Its place is `◎ detected` from its own coordinates where they
  are the site's UTM zone (an easting in X, plain or zone-prefixed, a
  northing in −Z; `lib/city/design-placement.ts`), its own Y kept as NHN
  where the ground under it agrees within 40 m; without one it is
  `≈ assumed` on the ground ahead of the player. The panel moves, turns
  and lifts it and saves the placement as a small JSON file. The LoD2
  objects whose footprints its plan covers for half or more (every
  triangle laid flat on 1 m cells, the flat ones at its lowest level left
  out; `lib/city/design-cover.ts`) leave their tiles' index and come
  back when it moves or goes (`CityLayer.setHidden`). Drawn in a
  model-maker's white or the file's own colours; casts and takes
  shadows; walked against. Its bytes come out of the tile cache; past
  250 000 triangles / 40 MB on a phone (3 M / 400 MB on a desktop) its
  textures go, then it is refused (`lib/city/design-budget.ts`).
  **Fallback:** without coordinates, the player's place; without a
  ground under it, base 0. **Not yet:** IFC, the landscape formats, the
  terrain and the dressing under a design, asking it.

## 🧪 Experimental

- **DOP-lean caveat (recorded):** `= computed` standard DOP has building lean (tall roofs
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
   where OSM is thin (ADR 0030).
4. **Cartographic minimap** — DTK / basemap.de P10 raster tile + Ortsteile labels
   replacing the math-drawn minimap.
5. **Dappled canopy shadow** — a colour-less proxy caster per chunk whose
   `maskNode` cuts the gaps (the shadow pass honours it; the old
   `WebGLShadowMap` alphaMap-override gotcha left with plan 020).
6. **Real trees from the laser-scan point cloud** — segment high-veg returns →
   per-tree position/height/crown; bake to per-tile GeoJSON. *(First step ✅
   above: `canopyx` crown peaks with `h` + `r`, outside the canopy mask only,
   thinned against the cadastre; since 2026-10-07 the renderer sizes such a
   crown from its `r`, 2r within 0.4–0.75 × h. Since 2026-10-20 `r` is the
   crown's share of the scan's crown mass — the watershed of the smoothed
   heights from every scan peak and every canopy and cadastre tree — as a
   disc of the same area; before, it was the distance to the mass's edge at
   the peak, which read a lone crown from a peak off its centre and a
   group's at its narrowest.)*
7. **Cascaded Shadow Maps** — the one shadow limit the skill calls unsolved (long
   low-sun shadows clip the 110 m frustum). *Amended 2026-09-25:* the baked
   horizon (✅ above, [ADR 0009](./adr/0009-shadow-recipe.md))
   now casts the long shadows past the frustum onto the ground — the far
   field's and, beyond the frustum, the next building's — for a few texture
   fetches; what CSM would still add is the middle distance's *shape* (a
   tree's or a facade's shadow past the frustum, at 8 m and 22.5° the
   horizon only has its angle, on facades too). Since the move to
   WebGPURenderer + TSL ([ADR 0027](./adr/0027-webgpu-renderer-and-tsl.md),
   plan 020 in [completed.md](./plans/completed.md)) three's
   `CSMShadowNode` is available without shader patching — still a depth
   pass per cascade on every sun or camera move, and its own decision.
8. **Adaptive resolution while moving** — *partly shipped*: DoF is skipped
   while the camera moves (`lib/city/regression.ts`, plan 007; a phone
   builds no DoF at all, ADR 0047). AO is **not**
   — gating it made the contact shadows blink on every step, so the AO pass
   (GTAO since plan 020) runs permanently at half resolution instead
   ([ADR 0009](./adr/0009-shadow-recipe.md)). A pixel-ratio
   drop under motion is the open half (needs a ~1 s hold and a real-GPU look).
9. **Stay cables and bridge colour** — trusses, pylons and steel arches now
   come from DOM1 (✅ above). The Pieschener Molenbrücke's pylon measures,
   but its stay cables are too thin for a 1 m raster: they are fanned from
   the measured pylon top by rule; tracing them would need the laser point
   cloud (LSC). The steel is one painted colour; sampling the DOP
   along a rib's chord could give the Blaues Wunder its blue.
10. **Atmospheric motes** — the one unbuilt item of the aesthetic roadmap:
    2–4 k camera-local billboards (not `Points`: WebGPU draws them 1 px wide)
    drifting in a toroidal volume (R ≈ 30 m), additive, `depthWrite: false`,
    `fog: false` (fog would brighten distant motes), hash-seeded so
    snapshots reproduce, opacity + `drawCount` on one slider. +1 draw call. Design notes in [plans/README.md](./plans/README.md#open-work).
11. **Far crown LOD tier** — ✅ shipped (see *Crown shaping* above); still to
    judge on a real GPU with the `--headed` harness: whether the far tier's
    pop at 650 m and the thinned forest read well, and whether a detail-0
    crown (20 tris) beyond ~1.5 km is worth a fourth tier.
12. **Ground, what plan [023](./plans/completed.md#023--the-ground-up-close-kerbs-paving-lawn-edges-urban-green--closed-2026-09-25-phases-13-and-5-built-rest-rejected-or-moved) left** — parks,
    cemeteries and sports grounds split out of the DLM's built-up class by
    object type (`sie02_f` `OBJART`/`FKT`, needs the raw DLM); the laser-scan
    intensity (LSC) as a measured surface-material map where OSM is silent
    (both ranked in the [data-streams survey](./data-streams.md)).
    An idea only, not planned: shell-textured grass near the camera (4–8
    shells, meadow only, no shadow casting) — it runs against the calm,
    nothing-finer-than-a-pixel look the maintainer has asked for twice
    (🗃️ drawn fence panels, allotment bed bands); revisit only with a
    real-GPU plate that stays calm. The raised pavement and DGM1
    micro-relief are 🗃️ below.

13. **The 2026-09-25 batch** — each planned in
    [plans/](./plans/README.md), now condensed in
    [completed.md](./plans/completed.md) with its looks in plan
    [019](./plans/019-gpu-verification.md): trams with contact wire (024), trees by
    species and season (025 — built, GPU plates open), road markings (026), shop glow and
    heritage from OSM on the buildings (027: ✅ above; the era is 🗃️), allotments, orchards and
    vineyards (028), fences and gates (029: ✅ above), more street furniture (030),
    Elbe landing stages, groynes and ferries (031), street names (032 —
    built, then removed: 🗃️ below),
    sky-view factor and a baked horizon map (033), small structures from
    DOM − LoD2 (034), a hidden soundscape (035 — built, then removed:
    🗃️ below). Built since (✅ above,
    looks unverified on a GPU): 024 (Trams), 026 (Road markings), 028
    (Cultivated land), 030 (Signs and fixtures), 031 (Landing stages,
    groynes, ferries), 033 (Sky-view factor, Horizon shade),
    034 (Small structures from the laser scan).
14. **The traffic data layers, next** (✅ *Traffic* above) — tram delays
    from the VVO's departure monitor (`webapi.vvo-online.de/dm`, real time
    per stop, answers any origin: poll the stops in view, shift each trip
    by its delay); the bicycle counters' hourly history since 2017
    (`cls:L1780`, > 140 MB unfiltered: bake a typical day per counter and
    run the columns with the scene's hour); the accidents with injury
    (Unfallatlas, the statistics offices, dl-de/by-2-0; pedestrian and
    cyclist involvement per point) as a fourth layer.
15. **The twin, next** — asking trees, bridges and monuments too is ✅
    built 2026-10-01 (plan 052 phase 4; see the twin section above). Still
    planned: a link to an asked building, a *Datenstand* panel, the ingest
    writing the provenance ([plan 052](./plans/052-queryable-twin.md)
    phases 4b–7); the
    day playing, weather as mood, the Elbe at its gauge
    ([plan 053](./plans/053-time-and-live-sources.md)); flood, sun hours,
    sight lines and a planned building as scenarios
    ([plan 054](./plans/054-scenarios.md)).

---

## 🗃️ Discontinued / rejected (do not retry blindly)

| Idea | Why rejected | Caveat |
|---|---|---|
| **A depth-of-field switch and manual focus** (*Tiefenschärfe* on/off, *Fokus: Automatisch / Manuell* with a *Fokusdistanz* slider, 1–3 000 m, drawn as a ring on the minimap; until 2026-10-10) | The maintainer chose fewer settings: the depth of field must stay, but it need not be parametrised. | DoF is always on where it is built (desktops; a phone builds none, [ADR 0047](./adr/0047-phone-memory-budget-in-true-bytes.md)), focused on the crosshair; it still rests while moving, in the graphic styles and in Modell (two prebuilt pipelines, [ADR 0009](./adr/0009-shadow-recipe.md)). An old snapshot's `dof`, `focusMode` and `focusDistanceM` are ignored. |
| **A river-mist slider** (*Flussnebel*, until 2026-10-10: the sheet's strength 0–100 %, the sheet hidden at 0) | The maintainer chose fewer settings: the mist stays, but it is not something to tune. | The sheet is always drawn, at the slider's default (60 %: at most 24 % opaque, `MIST_OPACITY`). An old snapshot's `waterMistPct` is ignored. |
| **Leaf flutter** (*Blattflimmern*, until 2026-10-10: small world-space value-noise specks, two octaves at ~1–2 m cells drifting with the wind, blending sunlit, sun-facing crowns toward a paler silver-sage "underside" with a faint glint; and its companion slider *Windhelligkeit*) | The maintainer chose fewer settings, and the twinkle was not free: two `leafNoise` calls — eight `sin` hashes — on every crown fragment. | The sway-coupled brightness stays, fixed at its slider's default (`GUST_BRIGHTEN`, 0.09 = 50 % of 0.18); it rides on the sway's gust signal, not on the twinkle. An old snapshot's `leafFlutterPct` and `leafBrightPct` are ignored. |
| **The look's sliders** (25 of the HUD's 26 percent sliders, until 2026-10-10: *Talnebel*, *Tiefenfärbung*; the buildings' *Boden-Verlauf*, *Höhenlinien*, *Streiflicht*, *Farbvariation*, *Dachfarbe*, *Dachsättigung*, *Traufkante*, *Gliederung*, *Fenster*, *Fassadenbild*, *Abendlicht*, *Materialstreuung*; *Bodendetail*, *Stadtgrün*, *Wiesenfärbung*, *Gegenlicht-Schimmer*, *Blattdurchscheinen*; *Kontaktschatten*, *Himmelslicht*, *Ferne Schatten*, *Spiegelung*, *Papierkorn*, *Tuschelinien*) | The maintainer chose fewer settings ("we don't need many of the settings anyway", plan 073). A slider cost the GPU almost nothing — a uniform multiplier; every term ran at any value, 0 included — but each was a table row, a store value, a snapshot key, a writer in its owner and a guide line in two languages. | Every term stays, at its slider's default, as a named constant beside it in its owner (`TINT`, `WINDOWS`, `GROUND_DETAIL`, `SKY_VIEW`, `VALLEY_HAZE`, `AO_EXPONENT`, …), so the default picture is unchanged; the depth grading, paper grain, ink and valley haze keep their uniforms, which a picture style or Modell writes. *Nebel* and the multi-tuft switch stay. Tuning a term is a code change, judged by snapshots of place and time ([ADR 0018](./adr/0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md)). An old snapshot's keys (`tintPct`, `windowsPct`, …: `RETIRED_SNAPSHOT_KEYS`) are ignored and never reused. The measured follow-up: delete what now runs at a fixed 0 (the glass sheen and the gilding's and fountain water's stand-ins under full *Spiegelung*; the river's went with its mirror, 2026-10-25) and tier-gate the costly terms (windows, facade reading, ground detail) on phones. |
| **See-through buildings** (*Transparenz*, until 2026-10-10: the clay's opacity hash-dithered, `alphaHash`, up to 90 %, in the opaque pass) | The maintainer chose fewer settings. It was a second build of the clay's graph — compiled in the frame the slider first left 0 — and every crossing of 0 redrew the shadow map, for a look that judges nothing in the city. | The clay is always opaque; an old snapshot's `transparencyPct` is ignored. To see what a building hides, demolish it (`R`) or cut the model open (Modell's *Ausschnitt*). |
| **The hidden soundscape** (plan 035, 2026-09-26 → 2026-10-10: wind, the city's hum, the Elbe, leaves, birds, crickets, fountains, footsteps by paving, a tram bell and the hour struck from the bell towers, all synthesized with WebAudio behind the **L** key and the *Klang (experimentell)* switch; `app/_components/soundscape/`, `lib/city/soundscape.ts`; the towers baked by `pipeline/bake/soundmarks.py` → `soundmarks_<tile>.geojson`) | Removed at the maintainer's decision (2026-10-10) to cut code and maintenance: about 3 000 lines, a bake and a tileset column for a feature that never shipped audibly — none of it was ever listened to (plan 019's listening pass stayed open). | Engine, switch, bake and committed files all went; the viewer creates no `AudioContext`. Revive only with a listening pass first, from git history (`5b59b79`). |
| **Sports-ground lines beyond a desktop's fine level** (until 2026-10-06 on both levels on every device; until 2026-10-10 on a phone's fine level and a desktop's coarse level too: `sport_<t>.png` read there, `sport-ground.ts` in that level's colour node) | The index raster is a 2048² RGBA texture, 16 MiB on the GPU for a PNG of a few dozen kB, per tile that reads it (14 of Dresden's 15 tiles have grounds) — on a phone against a 336 MiB tile cache ([ADR 0047](./adr/0047-phone-memory-budget-in-true-bytes.md)). Beyond the fine level a pitch is a few pixels and its lines a pixel or less; on a phone the lines were the price of a sixth of a fine tile's rasters. A pitch then shows its land-cover class (`readsSportGrounds`; the level builds the shared variant without the slot); the goals and nets come from the table and stay. | A 1024² phone twin of the raster (`sport_low`, as `markings_low`) would bring the lines back on a phone at a quarter of the cost; it needs a bake and a look on a GPU. |
| **A visible-band turf test** (for a pitch with no tagged surface on a flight without infrared — Bavaria's —, where the GLI cannot tell turf from grass; measured 2026-10-21, not adopted) | On München's tagged pitches the luminance parts turf and grass (≤ 109 against ≥ 126, once two tag errors are set aside), but on every infrared flight grass reaches turf's luminance and no visible feature parts them: one flight and 14 pitches are no rule. | A green ground on an RGB-only flight keeps its sport's default (✅ *Sports grounds*). A second RGB-only flight with tagged turf and grass would be the test. |
| **One mean height for the ground beyond the site** (the sky view's and the horizon map's ground outside the site's tiles: the mean of the whole edge, until 2026-10-21) | On a sloping site one mean for the whole edge stood a wall up to 25° too high over the low side: 6.1 % of Meißen's point-azimuths came out more than 3° off, 3.2 % of Unna's. | Beyond the site the ground is Copernicus GLO-30 now (✅ *Sky-view factor*, *Horizon shade*); without its cache each unmeasured cell takes the nearest edge cell's height (`extend_edges`), so nothing beyond stands higher than the edge it continues. |
| **The site's ground relief (p90 − p2) as the valley haze's depth** (until 2026-10-21) | A one-sided slope read as a valley: Unna's 70 m from its low to its high ground set a haze 28 m deep on a town that lies on a slope, not in a valley. | The depth is each tile's rise to its lower rim within 5 km (✅ *Height-term fog*: Unna 12.4 m); p90 − p2 stays the fallback where no GLO-30 cache is. |
| **The counted traffic's bridge flag by street name** (until 2026-10-21) | A name says little about a deck: Hamburg's sections carry no names (0 of the 33 on decks flagged), Meißen's carry road numbers, and Dresden's left 25 on decks unflagged and flagged 14 off any deck. | The flag comes from the deck geometry now (✅ *Counted motor traffic*); the name is read only on a tile without a bridge file. |
| **Mapillary's litter bins** (`object--trash-can`, drawn as bins on Dresden until 2026-10-21) | The class is any trash can, mostly household wheelie bins put out for collection: 7 of 10 on Dresden's spawn tile and 13 of 15 in the small cities, none clearly public. | The bins OSM maps (`amenity=waste_basket`) stay; Mapillary gives lamps only (✅ *Street lamps OSM lacks, from Mapillary*). |
| **A whole-sky grid for the roof colour's sun** (the shadow fit's sun searched over every elevation and azimuth, until 2026-10-21) | Without the flight's clock the fit found suns the day never had: Dresden's 33416_5654 at 29° and Grimma's 33342 at 23° under a 38.5° and a 40° sun. | The sun is searched along the flight day's solar path now (✅ *Roof colour*); the grid (10°/5°, then 2°/1° round its best) remains only for a tile the fetch found no flight days for. |
| **A two-colour roof split from the DOP** (a roof's two materials told apart in the orthophoto, measured 2026-10-21, not adopted) | 242 of the 281 splits found were light, not material: a roof's sunlit and shaded faces, not two coverings. | One colour per building is the property table's row; a real split would need a mask texture ([ADR 0036](./adr/0036-lod2-roofs-that-miss-the-scan-are-rebuilt.md)). |
| **Missing buildings for outlines LoD2 covers in part** (OSM outlines LoD2 covers 20 % or more, measured 2026-10-21, not adopted) | Of the 163 candidates most were courtyards and trees, not a building LoD2 lacks. | The missing buildings keep the < 20 % rule (✅ *Structures beyond LoD2: missing buildings*). |
| **The river's mirror and drawn strokes** (the sheet's view-angle Fresnel toward the mirrored sky, *Spiegelung*, sharper between gusts; for a day, 2026-10-25, light sky-coloured arcs on the crests) | The maintainer preferred the matte water seen while the sheets were missing ("tatsächlich mag ich den matten Stil gerne", 2026-10-25): the drawn map's water, with only the sun's reflection and a gentle movement on it. | The matte river (✅ *Water*: waves): the body's tint lit through the wave field's normal, the sun's soft path, glints and dashes. The fountains keep their mirror. |
| **Crossing sine ripples on the water** (three sines on the river sheet, three swells on a fountain's basin, until 2026-10-23) | Their interference repeats every few tens of metres and read as a tiled pattern ("zu repetitiv", the maintainer, 2026-10-23). And on the river they lay flat on every tile without a foam line: their position was first built inside the foam loop (water-layer.ts `foamAt`), which a tile without a weir never runs, so the Elbe broke at a tile seam into rippling and mirror-flat water. | The wind's wave field (✅ *Water*: waves), the foam loop's position taken before the loop. |
| **Modell's trees thinned by scale** (2026-10-04 → 2026-10-05: every tree to 1 : 5 000, fewer to 1 : 9 000, a floor of 30 % beyond, the kept crowns widened by 1/√share — `treeShare`, `treeSpread`, the crown shader's `crownKept` folding the others onto their origin; the coarse level's crowns, the floor's selection, fetched only once Modell thinned. The version before it thinned to none at 1 : 9 000) | Two rules for one picture: the scale set the share, the tile renderer the level, and the two disagree. The coarse level shows wherever the fine one is not loaded, not only past 2.5 m/px — at 1 : 3 000 on a phone whose memory governor coarsens the stream, or while fine tiles load — and there the picture showed no tree at all, since its crowns came only once Modell thinned (maintainer, 2026-10-05: trees at large and at small scales, none at 1 : 3 000). The version before showed no tree in an overview of the city. | Each terrain level carries its own trees, whatever the mode or scale (✅ *The coarse level's trees*): the fine level all, the coarse one a fixed third. A generalization by scale, if it comes back, has to follow the level the renderer shows, not run as a second rule beside it. |
| **Pedestrian counts** (for the traffic data layers, 2026-10-01) | No open measured source for the site: the only pedestrian counter, hystreet.com's laser count on the Prager Straße, is commercial (access on request); the city's "Fußgängerquerung St. Petersburger Straße" is a *bicycle* counter. A density modelled from stops, shops and census cells would be a model drawn as if measured. | Revisit with an open counter network (Telraam sensors in the site, if any, through its API with a key). |
| **Live tram positions** (GTFS-RT, the TLMS radio telegrams) | gtfs.de's realtime feed is one protobuf for all of Germany, too heavy for a browser to poll; TLMS (`wss://socket.tlm.solutions`) is a volunteer service whose coverage and uptime the viewer cannot vouch for. | The timetable runs instead (✅ *Trams by timetable*); delays could come from the VVO's departure monitor (`webapi.vvo-online.de/dm`, answers any origin) per stop — 📋. |
| **Street and square name lettering and the on-foot caption** (plan 032: OSM `highway` names, named squares and the DLM bridge names lettered on the ground from a per-tile Canvas-2D atlas, fading in from 25 m up; on foot, the nearest named street ≤ 25 m in a HUD pill; `pipeline/bake/names.py` → `names_<tile>.geojson`, `name-layer.ts`, `street-caption.tsx`, `lib/city/names.ts`) | Removed at the maintainer's request after review on a device (2026-09-26): the map look reads better without text. Bake, committed files, layer and caption all went. | The DLM bridge `name` stays in the bridge files. Revive only with a new look decision, from git history (`4b08993`). Text now appears only on demand, in the inquiry card ([ADR 0042](./adr/0042-inquiry-cards-on-demand-facts-in-the-tileset.md)). |
| **Every CityJSON attribute as a string column, part ids included** (plan 052's first cut) | +132 kB gzipped (+9.6 %) on the spawn tile's building glTF, 70 kB of it object ids: Saxon BuildingParts carry random `UUID_…` ids (41 bytes, incompressible) that no other dataset joins on. | The Building's `gml:id` for every object of its tree and ENUM columns for the code lists: +46 kB (+3.5 %) ([ADR 0042](./adr/0042-inquiry-cards-on-demand-facts-in-the-tileset.md)). The part UUIDs stay in the committed CityJSON. |
| **Drawn fence panels** (plan 029's first look: bars every 12.5 cm, a wire diamond mesh, pickets, posts every 2.5 m and a top rail, alpha-cut in the shader, a dithered veil far off, a dithered partial shadow through a custom depth material) | On a real phone "zu hart und kleinteilig", then "stärker stilisiert, mildere Farbwahl, Kleinteiligkeit führt zu Artefakten" (maintainer, 2026-09-25): dark iron and slate read as ink against the pastel scene, and every feature finer than a pixel — bars, mesh, posts, the dithered holes — aliased into moiré and shimmer, near and from the air. | A fence is one low band in one muted tone (✅ above): no holes, no dither, nothing finer than its own height. Revisit a pattern only with a real-GPU plate at walking height and from 150 m that stays calm. |
| **A raised pavement behind the kerb** (plan 023's leftover: lift the pavement a kerb's height above the road) | The DGM1 has no such step to lift, and ADR 0030 makes every part meet the ground at the ground's own level: the kerb's back now runs down to the pavement (`meetGround`), which took its ground-join misses from 32 % to 2 % (2026-10-01 audit). | Only with a measured kerb height per street (none of the sources carries it) and a terrain cut that ADR 0030's join check accepts. |
| **DGM1 micro-relief as a normal texture** (plan 023 phase 7: a 1 m normal map over the "2 m mesh") | The fine level is a ±0.15 m TIN of the native DGM (ADR 0030), not a 2 m grid, and `terrainNormal` (`terrain-layer.ts`) deliberately pulls near-flat normals up: the DGM's ruts, survey wobble and 8-bit normals read as dirty flecks under a low sun. Kerbs are real geometry now. | Revisit only if a real-GPU plate shows the ground too flat — and then as a softer calm threshold, not more relief. |
| **A shop window at an OSM shop node** (2026-10-08, the shopfronts' first bake: a wall no photo showed as a shopfront, with an OSM `shop=*` or café node within 3 m, got one 2.4 m bay centred on the node — 1 074 walls over the fifteen Dresden tiles, all but the spawn tile's) | A node says a shop is there, not where its windows are or how wide: the lone narrow bay with its riser, head and piers read as a door, not a shop window (the Hauptstraße's GDR pavilions, glass from end to end, showed a row of "doors"; owner's review). Better no window than a wrong one. | Every tile's panoramas are measured now; a wall they do not show stays plain. The OSM shop still tints the ground floor (*Ladenzone*) and lights it at dusk. |
| **Window niches as geometry** (PR #143 as first pushed, 2026-10-09: each measured window cut into its wall as a niche, rounded 6 cm into a 14 cm reveal, the wall re-triangulated round it) | Too plump: a rounded niche must survive the 2 km tile's 16-bit quantised positions, so its radii were centimetres wide and the openings read as soft lumps (owner's review: "Die Fensterformen sind zu plump"); every window cost triangles (+0.84 % over the site for 4 000 windows — all windows of all houses would have been millions); and only measured walls had them, 527 buildings, about 3 % of Dresden's, so a street of plain houses carried every thirtieth one windowed. | The same measurement now drives windows drawn by the clay on every house (*Windows on every house*, ADR 0010): no triangles, the recess a parallax look into the wall. |
| **Procedural window grid** on facades | Reads as a modern office block, fights the historic LoD2 silhouette (user veto). | Faint storey banding is the only kept remnant. Re-affirmed by plan 050: a glass facade (OSM `building:material=glass`) gets a cool tint and a sky sheen, never panes, mullions or a texture. Two exceptions, both measured, never procedural: (1, user decision 2026-10-08) **shop windows on a shop's ground floor may show glass** — dark, slightly reflecting panes where street photos measured the bays, divided only by a shop window's own mullions, never a grid and never above the ground floor (*Shopfronts from street photos*); (2, Manuel's requests of 2026-10-09) **every house may show windows, drawn by the clay as recesses in the wall's own colour, darker and cooler inside** — each building's own rhythm (its axis spacing, width and storey where street photos measured it at Spearman ρ ≥ 0.6 between two drives, else borrowed from the nearest measured house of its roof form and eave, else its type's, calibrated to the photos' medians), its storeys from OSM's levels or its height, centred on each wall; **no glass, no panes, no mullions, no texture**, and never on a party wall, beside a door, over a shopfront, on a church, a hall, or a glass or metal facade — a palace, museum, theatre, parliament or court gets tall windows of its own type on storeys of ~5.5 m (*Windows on every house*, ADR 0010). What stays vetoed is the uniform grid pasted over facades regardless of the building. |
| **Structures from the surface model alone** (plan 050: every tall gap between DOM1 and `max(DGM1, LoD2 roof)` as a column or block) | The gap is mostly not buildings: tree crowns, power pylons, and on the flight day the construction cranes — Leipzig's centre showed dozens of 50–95 m spikes with no mapped structure, Hamburg 90–98 m ones beside a 2023 building. | Only where OSM names the structure (`man_made=*`, a building outline) does the surface model measure it; a landmark's roof relief is the one gap drawn without a mapped outline, and only over its own LoD2 roof. |
| **Invented or imported landmark geometry** (hand-modelled landmarks per city, glTF models from 3D warehouses, a stock spire or dome by type) | Not repeatable for the next city, a licence per model, and a detailed model breaks the clay style next to LoD2 boxes. | Geometry beyond LoD2 comes only from a measurement confirmed by a name ([ADR 0036](./adr/0036-lod2-roofs-that-miss-the-scan-are-rebuilt.md)). |
| **Landmark roof relief as stacked slabs** (plan 050 as first built: the excess over the highest LoD2 roof cut into ≥ 2 m bands, at most 8, each band's smoothed outline extruded as a flat slab — a contour model) | A spire LoD2 cuts short became a stepped pyramid (Unna's Stadtkirche: LoD2 stops at 137 m, the surface model at ≈ 178 m) and the Elbphilharmonie's crests a flight of terraces — the plan's own STOP ("reads as a stack of plates"); 508 slabs on 74 objects in the first bake. | Replaced by the measured height field on the 1 m grid, lightly smoothed, built as one surface with corner heights averaged (✅ *Landmark roof relief*). Still no invented smooth roof: every height is a surface-model cell. |
| **Rebuilt roofs as stepped flat blocks only** (ADR 0036 as first built, 2026-10-01 → 2026-10-03: every region of 1 m height bands at its median, a prism each) | Right for the flat complexes the gate was made for, wrong for every roof it caught that is not flat: the Frauenkirche's dome (its LoD2 part ~5 m under the scan, so rebuilt) became four stacked drums, the Hauptbahnhof's arched train shed a staircase of 52 ledges, the Schauspielhaus's hipped roofs contour lines — the relief's lesson again ("a stack of plates"). | Replaced by the measured faces (✅ *Roofs rebuilt from DOM1*): the same objects, flat levels where the scan is flat, its surface where it slopes or curves. |
| **Rebuilt roofs with strips and grid-edged outlines** (ADR 0036, 2026-10-03 → 2026-10-19: any part ≥ 20 m² wider than a cell or two drawn on its own, borders on the 1 m grid simplified at 1 m) | The strips a few metres wide (a parapet run, the ledges along a vault's eaves, a mansard's terraces, plant rooms) stood as boxes of their own height, and every border diagonal to the grid as a staircase of 1 m walls: the Hauptbahnhof, the Prager Spitze and An der Frauenkirche 5 read as heaps of blocks. | Replaced by the 2026-10-19 update (✅ *Roofs rebuilt from DOM1*): a part holds a disk 7 m across or joins a neighbour within 3 m; outlines from a 2 m majority, simplified at 2 m. |
| **A lathed column for every mapped tower** (plan 050 as first baked: `man_made=tower`, `lighthouse` and `water_tower` measured like masts and chimneys) | Where LoD2 has a roof over the mapped foot it draws the tower already; the column stood inside it and doubled it — Meißen's cathedral towers (81/83 m), Grimma's churches, 13 of 14 towers in Munich. | `BUILT_TOWERS` under a LoD2 roof are skipped; a mast or chimney on a roof is not in LoD2 and stays. |
| **Every Basis-DLM rail at street level** (the rail layer before 2026-09-30) | The DLM files subways and S-Bahn trunk lines as ordinary railway lines: Munich's U-Bahn (23 km) and the S-Bahn trunk line (4.2 km) ran across the Marienplatz and the Odeonsplatz as broken track, and OSM's U-Bahn platforms lay on the squares above them. | A stretch within 2 m of a DLM tunnel (`BWF=1870`) for > 15 m is cut; OSM platforms and tram ways below ground are skipped. |
| **A 6 m tunnel reach for the rail cut** (the first cut: a rail within 6 m of a DLM tunnel) | Munich Hauptbahnhof's surface tracks run straight over the S-Bahn tunnel, parallel and a few metres beside its axis: the wider reach cut them too. | The DLM draws a tunnel on its rail's own axis, so 2 m is enough; plus the 15 m overlap floor so a surface track crossing over a tunnel keeps its crossing. |
| **Street bed for trams on the road class alone** (plan 024's rule) | A track through a pedestrian zone or a paved square (class `path`, built-up) got the gravel bed: Munich's trams by the Marienplatz read as broken track (≈ 13 km ballast in Munich). | Pavement is road, path or built-up; ballast in Munich ≈ 3 km. |
| **Absolute notability floor for landmarks** (a fixed sitelink threshold) | Set where a metropolis's landmarks stand out, it left Unna with one. | A low floor (≥ 2 sitelinks), then a floor relative to the tile's most notable landmark (below). |
| **A fixed count of landmarks per tile** (the most notable 12, plan 050 as first built) | On a dense old-town tile the count, not notability, decided: the second rank fell off the Altstadt tile behind the Frauenkirche, the Zwinger and the Semperoper, while a quiet tile listed everything with two sitelinks. | Those with ≥ 8 % of the tile's top sitelinks (≥ 2), 40 as a safety cap only (2026-10-01, ADR 0012). |
| **Per-site facade material** (`Site.facades: "brick"` for Hamburg, plaster elsewhere) | One palette for a whole site is wrong inside it — Hamburg is clinker in the Speicherstadt and glass and plaster in HafenCity, Dresden has brick quarters too (246 mapped brick walls) — and every new city needed tuning by hand ([ADR 0012](./adr/0012-openstreetmap-for-what-official-data-lacks.md)). | Removed 2026-10-01: each building wears what its OSM neighbourhood is mapped as (✅ *Facade context*). A look that differs between cities is derived from data, not added to `Site`. |
| **One valley-haze depth for every site** (Dresden's 28 m Elbe-to-rim drop) | Tuned on Dresden's valley; on flat Hamburg and Munich the pool reached the rooftops and the whole city stood in haze. | The depth follows the site's ground relief (✅ *Height-term fog*), capped at Dresden's 28 m. |
| **Rails, ballast and bridge decks from the Basis-DLM only** (until 2026-10-01) | Honest, but Hamburg and Berlin publish no open DLM: a city of bridges had no bridges and no track — the U3 viaduct, the Hauptbahnhof's approaches. | OSM's rail ways and bridge ways stand in, the deck heights still measured in DOM1 (✅ *Rails, ballast and decks from OSM*). |
| **Raw OSM colours on facades** (`building:colour` used as given) | A mapped `red` or `#ff0000` is a signal colour in a pastel city. | Hue kept, saturation and lightness clamped into the clay's register. |
| **Building era** (colour by construction year; plan 027 phase 3) | Coverage: OSM carries `start_date` on 52 and `year_of_construction` on 12 of 8 310 building outlines in the four first tiles, measured 2026-09-25 (0.8 %, far under the plan's 30 % bar). No official source is reachable: the LfD Sachsen heritage layer (INSPIRE WMS `iwms_gsz_schutzgebiete`, *Kulturdenkmale_Flaeche*) answers GetFeatureInfo with designation and name but no dating, its WFS paths are refused (403); the Denkmalliste's dating lives only in its web app, per object; Dresden lists its Kulturdenkmale among the themes without an open dataset (2026-09-25). | Revisit with an official Baualter dataset (the city's, or ALKIS `baujahr` where a Land fills it); listed buildings alone would colour only the monuments. |
| **Allotment bed bands** (plan 028 as first shipped: 1.2 m soil/green/grass stripes per ≈12 m jittered-Voronoi plot over a NEAREST colony-id raster) | Maintainer feedback on a phone (2026-09-25, 33410_5658 from ≈180 m up): the colony's edge and its carved paths showed the 1 m raster's staircase, and the flat pale stripes read as a rendering glitch, not as gardens. | Replaced by a baked signed distance (LINEAR, a soft wandering edge) and analytic plots — soft greens, thin soft paths, a few warm beds, flower dots — box-filtered and faded with distance (✅ *Cultivated land*). Keep cell ids off any boundary the eye can see. |
| **Orthophoto for facade colour** | Nadir DOP only sees roofs — no facade data. | DOP for **roofs** is fine and is now the 🧪 entry above. |
| **Plain foliage translucency** | Reads as "noise" at instance distance. | Only OK if **shadow-gated** (kept as the shimmer transform). Since plan 020 the gate is the sun's daylight ramp plus the near/large-crown limit (a node material cannot sample the sun's shadow map) — judge on a GPU whether the noise returns. |
| **VSM shadows** | "Corduroy"/grid rings on large ground at grazing sun. | Use `PCFShadowMap` + radius instead. |
| **Large `normalBias`** | Bright peter-panning contact strip. | Keep `normalBias=0`, small negative `bias`. |
| **Bigger shadow frustum / 4096 map** | Coarser texels → fraying / cost without gain once radius softens. | Tight ~110 m frustum at 3072 + radius (121 m on foot since 2026-10-11, paired with a 30 m dead zone: the same reach, a third fewer redraws, texels 10 % coarser — [ADR 0009](./adr/0009-shadow-recipe.md)'s update). |
| **Sobel / deferred outlines** | Hard edges clash with the watercolor look. | The asked element's outline (✅ *The outline*) is not one: a single soft silhouette of one element, on demand, never the scene's edges. |
| **The pencil loop** (plan 052 phase 4's first mark: a wavering graphite stroke on a band of paper, once round and a little past, on the ground around an asked tree or monument and along a deck's parapets; `lib/city/pencil.ts`, `pencil-mark.ts`) | Maintainer review (2026-10-01): which element is selected should read more strongly. A ring on the ground says "here", not "this" — beside a crown among crowns, or along a deck seen from below, it did not name the element; and a building, hatched only, had no line at all. | Replaced by one screen-space outline for every kind (✅ *The outline*), in the same graphite and paper. |
| **Selective bloom, quad leaf billboards** | No payoff yet for the cost. | Revisit only with a concrete need. |
| **`BatchedMesh` for buildings** | Already merged per tile; would break `objectid` picking/demolish and not cut draw calls. | Bottleneck is fill-rate, not draw calls. |
| **Blender texture baking** | No UVs on the source geometry. | — |
| **Orthophoto as the *only* tint source** | Leaves everything identical where imagery is flat; no facade info. | Hash carries variation; DOP augments roofs. |
| **A line lifted onto every deck under it** (rails and trams until 2026-10-01: a point inside a rail deck's outline rode the deck, a tram on an OSM `bridge` way any deck) | A lower line passing under another's bridge jumped 7–8 m onto it and back (16 of 109 rail–deck crossings in Dresden; the flyovers north of Neustadt), and an upper line dropped into the DGM's gap wherever it ran longer than the deck's outline — 230 steps beyond the grade by > 1 m in Dresden. | The level is decided along the whole line within its grade (✅ *Line levels*, ADR 0041). |
| **Per-line ballast ribbons** (rail v1: one ~9.6 m ribbon per `ver03_l` line) | 42+ overlapping coplanar ribbons in the yard z-fought into ragged/torn edges. | Replaced by the **dissolved `ver03_f` area** as one merged surface. |
| **`ver06_l` centreline-buffered decks** (rail v1) | Buffered planks stacked deck-top + ballast + parapet-cap → "2-story" bridges, and one plank merged the parallel Marienbrücke spans. | Replaced by **`ver06_f` deck polygons** (one slab per real footprint); kept as the no-`ver06_f` portability fallback. |
| **Per-tile rail layer** (rail v1) | Each tile's own `heightAt` returned null off-tile → tracks truncated at every seam. | Build on the **cross-tile `heightAt`** — once for the block until ADR 0024, now per fine terrain tile over every loaded terrain. |
| **LoD2 bridge objects as buildings** (ALKIS `53001_*` in the CityJSON) | Saxony's LoD2 carries its bridges as `Building`s (52 on the first four tiles): flat 1 m slabs at one height. The building bake drew them as clay houses (with the facade detail) 1–3 m off the rail layer's decks — every Elbe bridge had a second deck. | `withoutTrafficStructures` drops them from the building mesh; the rail layer draws bridges alone. Their footprint is no better than the DLM's. |
| **Deck height from the DGM abutment ramp alone** | Two endpoints + camber: the Waldschlößchenbrücke's deck came out 3 m low (below its own navigation clearance), and rail decks whose ends sit under catenaries or trees up to 6 m high. | The roadway measured in DOM1 along the axis, held near the ramp (✅ above); the ramp stays the no-DOM fallback. |
| **Per-tile ground for bridge decks** | The rasters stopped at the tile edge (sampling clamped there), so a deck across a seam got two different profiles — and both tiles drew it: two decks metres apart (Schlachthofbrücke). | A DGM/DOM mosaic around the tile; the owner draws, every copy lifts rails. |
| **`ver06_f`-only bridge decks** (rail v2 first cut) | `ver06_f` has area polygons only for (mostly rail) major spans → road/path bridges (Augustusbrücke etc.) vanished + everything mis-classified rail. | Drive from the **complete `ver06_l`** set, footprint from `ver06_f` where matched. |
| **Motion-gated SSAO** (plan 007 as first shipped) | The contact shadows blinked on every footstep — reads as a bug, not a saving. | The AO pass runs permanently at half resolution (N8AO's `halfRes` then, GTAO since plan 020); only DoF is dropped while moving ([ADR 0009](./adr/0009-shadow-recipe.md)). |
| **Cloud shadows / per-frame shadow updates for wind sway** | Would force the 3072² depth pass every frame over tens of thousands of trees, undoing the on-demand shadow map. | Sway and cloud drift run in the main pass only; the cast shadow stays static ([ADR 0009](./adr/0009-shadow-recipe.md)). |
| **Multi-echo ratio as the low-vegetation cue** (LSC, low vegetation) | Measured: only 26 % of OSM-hedge pixels reach echo ≥ 0.5, fences 56 % (AUC hedge-vs-fence 0.28); recall 25 % of observable hedge length vs 58 % for the NDVI + intensity rule. | Keep it as the *tall*-vegetation cue (100 % of > 5 m forest vs 3 % of roofs) and as a qualifier of intensity. |
| **Blob-wide "multi-echo ≈ 0" for small structures** (plan 034 as planned) | A shed's roof edge splits the pulse (part roof, part ground), so no blob's multi-echo share is ≈ 0: 4 blobs on the spawn tile at ≤ 0.05, 43 at ≤ 0.10 (median over all band blobs 0.93); the interior share admits 377, 112 of them against tree crowns. | The rule works per cell: no multi-echo return in a cell's 3 × 3 window, the rim grown back after (the ✅ "Small structures from the laser scan"). |
| **OSM scrub polygons filled with shrubs** (OSM-only tiles) | A jittered 3–4 m grid gave 4–9 k shrubs per neighbour tile — more than the laser scan finds on the primary — mostly under existing crowns. | OSM-only tiles get the OSM hedges only. |
| **Laser-scan-only hedges** (LSC, the 478 unmapped "hedges" of the low-vegetation bake) | ~30 % of the low-vegetation mask lies 1–2 m from a > 3 m crown: crown-rim false positives a first-surface model cannot tell from understory, and they read as stray hedges along tree rows. | Shipped since 2026-10-21 where they pass the filters of *Hedges* above (long, slim, clear of crowns, green); the rest (short, wide, along crown rims, not green) stay research-only (`--research`). |
| **Shrubs** (LSC blobs + OSM `natural=shrub` nodes, 3 226 on the primary) | Same crown-rim false positives, and the lobed dome reads as a faceted grey "boulder" at arm's length. | Kept in the bake behind `--research`; a better shrub shape is shape polish, not data. |
| **Camera-follow grass tuft ring** | Shadow-casting instances rewritten every frame; reads as confetti. | Meadow mottle + normal perturbation in the terrain shader (✅ above). |
| **Per-lamp real point lights** | three bakes the light count into every program (since plan 020: every light into every lit node build's key) → a recompile storm on every add/remove, plus per-light cost. | A fixed pool of 3 real lights (1 on a phone) retargeted to the nearest heads; every other lamp is emissive + sprite ([ADR 0009](./adr/0009-shadow-recipe.md)). |
| **Plain (non-shadow-gated) foliage translucency, quad leaf billboards, selective bloom** | Noise at instance distance / no payoff for the cost. | Shadow-gated shimmer + translucency only (✅ above; daylight-gated since plan 020, see *Plain foliage translucency*). |
| **Baked RGB splatmap** (`landcover_rgb_<tile>.png`: RGB = pastel palette, A = water coverage, plus a 2048² variant) | The look lived in the bake: a colour change meant re-baking every tile, and the palette was spelled three times (bake, minimap, shader fallback). Its alpha was data, so every resize had to split colour from alpha — sharp premultiplies alpha across a resize, which once turned every land texel black ([ADR 0010](./adr/0010-opaque-clay-buildings-only.md), superseding ADR 0010). | The bake writes class ids only; the one palette (`lib/city/landcover.ts`) is painted on the GPU at load. A per-fragment palette lookup was rejected too: class ids cannot be mipmapped, so far boundaries would alias. |
| **Overpass-based OSM bakes** (lamps, platforms, bridge structure) | Live queries: rate-limited and not reproducible, and one more way of reading OSM next to the local extract the walls already used ([ADR 0037](./adr/0037-sites-providers-and-per-site-data.md)). | Every OSM layer comes from one local Geofabrik `.osm.pbf` via GDAL's OSM driver (`pipeline/bake/osm.py`). The committed lamp/platform/bridge-structure files still predate this; the next re-bake moves them (`data/dresden/provenance.json`). |
| **Bash bakes** (`scripts/extract-*.sh` + Python/Pillow heredocs) | Three languages, string-built paths, tile names and CRS spelled per script; numpy and `gdal_calc.py` were missing, so raster maths was written around Pillow ([ADR 0037](./adr/0037-sites-providers-and-per-site-data.md)). | One package, `pipeline/bake/`, on numpy/rasterio/pyogrio/shapely in a uv environment, driven per site tile by `bun run bake`. |
| **uint16 heightfield + custom building vertex-stream codecs** (`<tile>.heightfield-<n>.json` + `.u16.gz`; vertex stream + meta JSON) | Private formats with a codec on each side that no other tool could open, and the browser still burned the wall breaklines into the grid at load ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | Standard glTF 2.0 (meshopt + quantisation) with an `EXT_structural_metadata` table; the bake does the breaklines. Costs wire size (≈1.0 + 1.1 MB → ≈1.4 + 1.5 + 0.4 MB per tile); a heightmap-PNG custom content type is the fallback if that ever matters more than tooling. |
| **The terrain TIN's own payload** (`dgm1_<tile>.tin-<cm>cm.json` + `.bin.gz`: byte-split delta planes + varint triangles; the prototype, ±0.25 m on the neighbours) | A private format again, next to the glTF every other content is ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)), and two terrain paths in the viewer. | The fine level's glTF *is* the TIN (reordered for meshopt, `extras.tin`), ±0.15 m on every tile — 20–27 % smaller than the 1024² grid it replaced ([ADR 0030](./adr/0030-terrain-tin-and-wall-snap.md)). |
| **Fixed 2×2 block loaded at boot** (one primary tile + three neighbours, never unloaded) | The world was bounded by boot cost, nothing ever unloaded, and collision/demolish stopped at the primary tile's edge. The hand-written tile manager proposed instead (ADR 0024, never accepted) would have re-built the schedule, LRU and worker 3DTilesRendererJS already has ([ADR 0024](./adr/0024-site-streams-as-3d-tiles.md)). | The site streams as a 3D Tiles tileset; distance, not a role, decides which tile is detailed. |
| **Inserted building** (a glTF model, else an orange marker box, dropped at a fixed Dresden spot; once on the B key) | No caller since the B key was disabled — dead plumbing through the HUD, the scene and a Dresden-only constant; removed with the site config ([ADR 0037](./adr/0037-sites-providers-and-per-site-data.md)). | Revisit only with a concrete use (e.g. a planned building to preview). |

---

> **Art-direction north star:** a soft, illustrative **watercolor / contour-map**
> look (paper grain, depth grading, vignette, contour-line terrain). Every
> transformation above is judged against it — additions that read as hard-edged,
> photoreal, or "modern office" get rejected here.
