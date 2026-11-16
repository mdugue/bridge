# Plan 086 [rewrite]: The rewrite series — faster on the device, fewer bytes on the wire, less to hold in the head

> **What this file is.** The map of the **rewrite series**, plans
> 086–096. It is not executed itself: it says what the series is for, in
> which order its plans go, what each one may assume of the others, and
> what was considered and left out. Every plan of the series carries
> `[rewrite]` in its title and in its row in
> [README.md](./README.md), and names this file under *Series*. An
> executor reads this file once, then its own plan.
>
> **Planned at**: commit `5dfa300d`, 2026-11-16.

## Where it comes from

On 2026-11-16 the maintainer asked what one would do differently if the
project, as it stands, were built from scratch — after the moves it has
made one at a time (WebGL to WebGPU and TSL, a fixed block of tiles to a
streamed 3D Tiles tileset, LoD2 and the DGM alone to OSM, the DLM, the
orthophoto, the laser scan and street photos, the page's thread to a
worker). The answer, read from the ADRs, the plans and the code: the big
decisions stand. What a fresh start would place differently are the
**seams between the stages**, because each move left its predecessor's
seam where it was:

- the bake hands over about fifty loose files a tile (GeoJSON, JSON,
  PNG), and the browser still builds seventeen kinds of dressing from
  them, tile by tile, on the thread that draws;
- the 2 km tile is at once the Land's download cell, the bake's unit,
  the stream's unit and the memory's unit;
- the baked data lives in git and is baked again inside the web build;
- looks are judged by hand on a GPU nobody has in CI.

The maintainer chose all of it, with three aims and two rulings.

## The three aims, and how each is counted

Every plan says which of these it serves and proves it in the ledger
plan 087 sets up. A plan that buys one aim with another says so in its
row and waits for the maintainer's word, as ADR 0047's exceptions do.

| Aim | Counted as | Where it stands (source) |
|---|---|---|
| **Faster on the device** | time to the first frame and to *ready*; CPU a landing tile costs the scene's thread; frames kept while tiles stream | a fine level's dressing 1.65–2.90 s on SwiftShader (PR #156, 2026-10-10); before they were sliced, on the phone profile: rails 1.3 s, trees 0.8–1.3 s, tram 0.7 s a tile (`docs/rendering.md`, "The frame budget") |
| **Fewer bytes on the wire** | gzip bytes of the first load's JavaScript; bytes and requests of the spawn tile, of a fine level, of a far tile, of the site | 1.0 MB of JavaScript for `/dresden` (audit 2026-11-11); a tile 4.0–9.7 MB, Dresden ≈ 98.9 MB (`docs/data-pipeline.md`, measured 2026-09-25: stale, 087 measures again) |
| **Less complexity** | kinds of side file and formats a tile has; lines of mesh building in the viewer; modules that handle a tile's seam; rules AGENTS.md has to state because nothing checks them | 17 dressing kinds, 4 hand-made binary formats beside GeoJSON; 27 `*-layer.ts` with 18 769 lines; 52 of 77 bake modules mention neighbours, seams or margins; `bootApp` 3 088 lines |

Beside them, counted but not an aim of its own: a phone's memory
(ADR 0047 stays — it must not grow), the repository's size (`data/`
937 MB, the pack 1.2 GiB after eighteen days) and the build's time
(`prepare-sites` cold 360 s).

## The maintainer's rulings (2026-11-16)

1. **Official data first stays** (ADR 0012): LoD2 and the surface model
   before OpenStreetMap. A base level from global data (OSM buildings,
   GLO-30) for any place on earth was offered and declined for now.
2. **The newest versions of the dependencies stay**, unless something
   grave speaks against one. A "novelty budget" (new only where the
   product needs it) was offered and declined. Consequence for the
   series: every bump of three is a risk to the look, which plan 087's
   plates exist to catch; and plan 094 waits for what upstream does
   with `compileAsync` before it builds machinery around it.

## The plans, in the order they go

| Plan | What is true afterwards | Effort | Needs |
|---|---|---|---|
| [087](./087-rewrite-measuring-stick.md) | Reference plates rendered on a real GPU and compared in CI; one ledger of bytes, requests, boot marks and tile costs that every later plan writes its before and after into | M, plus a GPU runner that runs | — |
| [088](./088-rewrite-tiles-as-a-data-product.md) | The tileset is published to object storage under its content hashes and served compressed by a CDN; a lock file in git names it; the web build bakes nothing; `data/` leaves git but for a fixture | M, plus storage and traffic | 087 |
| [089](./089-rewrite-python-types.md) | The bakes are type-checked in CI against a baseline that only shrinks | M | — |
| [090](./090-rewrite-dressing-gpu-ready.md) | A tile's dressing arrives in the layout the GPU draws from: instance tables, line tables, baked parts; the viewer places nothing, slices nothing and parses no GeoJSON | L, a layer at a time | 087; 088 for the byte gates |
| [091](./091-rewrite-rasters.md) | Data rasters travel as plain arrays, continuous ones as GPU-compressed textures; one raster stack a tile | S for the trial, M–L to roll out | 087, 088 |
| [092](./092-rewrite-bake-store.md) | The bakes work on site-wide typed tables and cut tiles last; a step never rewrites another's file; one schema says what both languages read | L–XL, with a full re-bake of every site | 087, 088, 089 |
| [093](./093-rewrite-streaming-quadtree.md) | The stream's tile is smaller than the bake's: a quadtree whose levels replace the raster twins — built only if a phone's numbers after 090 and 091 still ask for it | XL, the series' largest risk | 090, 091, 092, 094 |
| [094](./094-rewrite-fixed-pipeline-set.md) | The clay's vertex buffers and inter-stage variables are counted by a test; every material variant is known at boot | S now, M before 093 | 087 |
| [095](./095-rewrite-packages-and-frames.md) | The viewer is a package with one entrance; data-frame and scene-frame coordinates are different types; `bootApp` is owners, not one function | M–L, last | 090, 093 |
| [096](./096-rewrite-heuristic-scores.md) | Each bake heuristic that guesses (roofs, dormers, windows, crowns) has a reference set and a score a bake PR must hold | M a family, open-ended | 087 |

Order: 087 first, then 088 and 089 side by side, then 090 a layer at a
time with 091's trial beside it, then 092, then the decision on 093.
094's counting test goes at any time; 095 goes last; 096 runs beside
everything.

## What each plan may assume of the others

The series is built whole. A plan is therefore written for the state the
others leave, not for today's alone. These are the joints.

1. **Measure first.** Nothing that changes the picture merges before
   087's plates exist, and every plan writes its numbers into 087's
   ledger. The reason is the series' own history: PR #156 (plan 074
   part A's spike) has waited since 2026-10-11 for a look on a real
   GPU, and plan 019 since September.
2. **Data leaves git before a binary hand-over format enters it**
   (088 before 092). GeoJSON's one merit is the diff a re-bake shows in
   git; a Parquet file in git has neither a diff nor a delta.
3. **Bake where a thing stands, never how it looks** (090). Colour,
   season, picture style and the palette stay at runtime (ADRs 0010,
   0012: "a colour change is not a re-bake"). A baked record is
   semantic — place, size, turn, kind, genus — and the shader makes the
   look of it.
4. **A file's layout is the GPU's layout** (090, 091). What a tile
   brings is uploaded, not rebuilt: an instance is the compact record
   the vertex shader expands, not sixteen floats written on the CPU.
5. **Bake what is compact, not what is large.** PR #156 measured it:
   rails, trams and riverside baked as triangles made Dresden's fine
   levels 10.1 % larger (+3 MB) while halving the dressing's build.
   The series aims at both, so 090 prefers a table the GPU expands
   (an instance, a line's segment) over baked triangles, and leaves
   what is large and derived — a BVH, a height index — to the workers
   that build it today.
6. **No worker pool.** Earlier advice named one ("the render thread
   builds nothing"). With 090 the scene's thread has nothing left to
   build; the slices (`lib/city/build-steps.ts`) go with the last
   runtime builder, and the three workers there are (BVH, ground,
   window niches) stay. A pool would be built for work 090 deletes.
7. **One reader a kind** (090 for 092). 090 puts every read of a bake's
   file in the build behind one reader a kind, so that 092 changes the
   format in one place and not in every baker a second time.
8. **Format, site-wide tables and steps that overwrite nothing are one
   plan** (092): all three rewrite the same input and output layer of
   every bake step. Together they cost less than apart, and they lose
   the proof this repository leans on — "a cold bake publishes 0 new
   files" — so 092 starts with a comparison by content (087 holds the
   plates, 089 the types).
9. **The quadtree is decided by numbers, not by this file** (093). It
   needs 092 (or every cut is sixteen times the seams), 090's one
   container a tile (or sixteen times the requests), 091 (levels in
   place of raster twins) and 094's register (more tiles arriving a
   second). Plan 076 rejected implicit tiling "for now (15 tiles)";
   093 reopens it under a gate: what a phone still pays after 090 and
   091.
10. **Raw rasters pay only with 088** (091): without a CDN's
    compression a pre-gzipped array is a PNG by another name.
11. **Packages follow the seams the other plans leave** (095). Regrouping
    699 files first would cross every open PR; after 090 the viewer's
    edge is where the builders left.

## Plans this series touches

- **074 part A** (bake the static dressing) and its spike **PR #156**:
  taken over by 090, which starts from the spike's numbers.
- **019** (the GPU checklist): 087 turns its reference views into
  compared plates; 019's device checks by hand stay 019's.
- **070** (raster diet, partial) and 074's backlog item "one raster
  stack per tile": continued by 091. 076's and 077's rejection of KTX2
  stands for class rasters (block compression would change ids); 091
  asks it only for rasters whose values are continuous.
- **069** (streaming without stalls, partial): its open steps are
  re-read once 090 has taken the dressing off the tile path.
- **021** (`/wissen` as a workspace package): 095 names the workspace's
  shape, 021 stays its own plan.
- **017** (Germany-wide sites): untouched; 092 keeps the provider
  adapters' five functions.

## Considered and left out

Kept here and in the README's *Rejected* list so nobody audits them
again.

- **Rust for the bakes.** The bakes are heuristics on rasters and
  vectors, run rarely on the maintainer's machine and cached a step;
  rasterio, pyogrio and shapely bring GDAL in their wheels with no
  system set-up. Rust would cost that and solve nothing measured.
- **Rust for the TypeScript build.** 58 of `lib/city`'s 211 modules
  (20 236 of 56 803 lines; counted over the import graph on
  2026-11-16) run in the build and in the viewer — `windows.ts`,
  `terrain-tin.ts`, `city-mesh.ts`, `levels.ts`. One language is why
  the facade's packing and the shader that reads it agree. The build's
  memory (1.3–1.9 GiB a tile) stops binding once 088 takes the bake
  out of the host's builder; a hot loop that still matters gets a
  native kernel, not a port.
- **Rust and wgpu for the viewer, or a renderer of our own.** Loses TSL
  (and returns to shaders as strings, which ADR 0027 left), GLTFLoader,
  3DTilesRendererJS, three-mesh-bvh and the design loaders.
- **WebAssembly as the platform.** The costs a tile has on a phone are
  functions of its data: bake them (090) or let the GPU expand them. A
  WebAssembly heap never shrinks (`tile-stream.ts` says so of the
  meshopt workers), against ADR 0047. It stays where it is: decoders.
- **A base level from global data**, **a novelty budget**: the
  maintainer's rulings above.
- **A worker pool**: joint 6.

## Closing the series

A plan that is done is condensed into [completed.md](./completed.md)
as every plan is; its row keeps the `[rewrite]` mark. When the last one
closes, this file's table goes to completed.md with each plan's ledger
figures, and this file is deleted.
