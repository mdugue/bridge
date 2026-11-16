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

The maintainer chose all of it, with three aims and four rulings.

## The three aims, and how each is counted

Every plan says which of these it serves and proves it in the ledger
plan 087 sets up. A plan that buys one aim with another says so in its
row and waits for the maintainer's word, as ADR 0047's exceptions do.

| Aim | Counted as | Where it stands (source) |
|---|---|---|
| **Faster on the device** | time to the first frame and to *ready*; CPU a landing tile costs the scene's thread; frames kept while tiles stream | a fine level's dressing 1.65–2.90 s on SwiftShader (PR #156, 2026-10-10); before they were sliced, on the phone profile: rails 1.3 s, trees 0.8–1.3 s, tram 0.7 s a tile (`docs/rendering.md`, "The frame budget") |
| **Fewer bytes on the wire** | gzip bytes of the first load's JavaScript; bytes and requests of the spawn tile, of a fine level, of a far tile, of the site | 1.0 MB of JavaScript for `/dresden` (audit 2026-11-11); a tile 4.0–9.7 MB, Dresden ≈ 98.9 MB (`docs/data-pipeline.md`, measured 2026-09-25: stale, 087 measures again) |
| **Less complexity** | kinds of side file and formats a tile has; lines of mesh building in the viewer; modules that handle a tile's seam; rules AGENTS.md has to state because nothing checks them | 17 dressing kinds, 4 hand-made binary formats beside GeoJSON; 27 `*-layer.ts` with 14 420 lines of code (18 769 with comments and blank lines); 57 of 83 bake modules handle a tile's edge in their code (plan 092's five ways, or another read with a margin; "52 of 77" was the count of modules that *mention* neighbours, seams or margins, nine of which never touch an edge); `bootApp` 2 354 lines of code (3 088 as written) — as `qa/ledger.json` counts them since plan 087's hardening |

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
3. **The result need not equal today's.** A slight deviation — in the
   picture, in a published byte, in a value a bake writes — is
   acceptable where it serves one of the three aims. Wherever a plan of
   the series says "identical", "the same bytes" or "no pixel changes",
   read: identical, **or** a deviation that is slight, named in the PR
   and shown there (a plate or a snapshot before and after, the
   ledger's figures). Identity stays the cheapest proof for a change
   that means none — a move, a refactor — and the plans keep using it
   for those. What is not slight is a fault as before: a layer that is
   gone, a thing visibly displaced, ground painted as the wrong class,
   a phone's memory that grew.
4. **A decision record may be questioned.** A plan that finds an ADR in
   its way does not work around it: it says which one, why its reason
   no longer holds or what it costs the aims, and rewrites it in the
   same PR, as `docs/adr/README.md` says a record is rewritten. Still
   the maintainer's to grant first: rulings 1 and 2 above, and what
   AGENTS.md lists under "When in doubt, ask before" (a backend, a
   heavy dependency, a second render path, committing raw data).

## The plans, in the order they go

| Plan | What is true afterwards | Effort | Needs |
|---|---|---|---|
| [087](./087-rewrite-measuring-stick.md) | Reference views rendered on a real GPU and compared with main rendered on the same machine (no reference image is stored); one ledger of bytes, requests, counters, first-load JavaScript and a phone's tile bytes that gates CI and that every later plan writes its before and after into (timings are recorded, never gated); published tilesets compared by content | M, plus a machine with a GPU that keeps running | — |
| [088](./088-rewrite-tiles-as-a-data-product.md) | The tileset is published to a store under its content hashes; a lock file in git names what a commit runs on; the web build bakes nothing; `data/` leaves git but for a fixture; one transport encoding in place of the pre-gzipped files, if its spike measures a gain | M, plus storage and traffic every month; three decisions of the maintainer first | 087 |
| [089](./089-rewrite-python-types.md) | The bakes are type-checked in CI against a baseline that only shrinks | M (the checker and its baseline: S) | — |
| [090](./090-rewrite-dressing-gpu-ready.md) | A tile's dressing arrives in the layout the GPU draws from: instance tables, line tables, baked parts; the viewer places nothing, slices nothing and parses no GeoJSON | L, a layer at a time | 087; 088 for the byte gates |
| [091](./091-rewrite-rasters.md) | Exact rasters (class ids, tables, packed channels) travel as plain arrays in their texture's layout, so the viewer carries no PNG decoder; a trial of block compression on one soft raster decides the others; fewer files and bindings a level | S for the table and the trial, M–L for what the numbers carry | 087, 088; 090 for the NDVI |
| [092](./092-rewrite-bake-store.md) | The bakes read and write through one store — by extent, by owner — over site-wide typed tables of the vector features (rasters stay cut by window with a halo) and cut tiles at publishing; a step never rewrites another's file; one schema says what both languages read; the format decided by a spike | L–XL, with a full re-bake of every site | 087, 088, 089; leans on 090 |
| [093](./093-rewrite-streaming-quadtree.md) | The stream's tile is smaller than the bake's: an explicit quadtree under each bake tile whose levels replace the raster twins — built only if a phone's numbers after 090 and 091 still ask for it, and only if a spike on one tile passes its kill criteria | XL, the series' largest risk | 087, 088, 090, 091, 092, 094 |
| [094](./094-rewrite-fixed-pipeline-set.md) | The clay's vertex buffers and inter-stage variables are counted by a test; every material variant is known at boot, and a flight builds no pipeline after it | S now, M before 093 (cheaper after 090 and 091) | 087 |
| [095](./095-rewrite-packages-and-frames.md) | The viewer is a package with one entrance; data-frame and scene-frame coordinates are different types; `bootApp` is owners, not one function | M–L, last | 090, 093 |
| [096](./096-rewrite-heuristic-scores.md) | Each bake heuristic that guesses (roofs, dormers, windows, crowns) has a reference set and a score a bake PR must hold | M a family, open-ended | 087 |

Order: 087 first, then 088 and 089's checker side by side, then 090 a
layer at a time with 091's trial beside it, then 092, then the decision
on 093. 089's edits to the bake modules wait until just before 092's
re-bake: a step's key hashes its module's bytes
(`step_cache.code_hash`), so an annotation re-runs that step on every
tile of every site. 094's counting test goes at any time; 095's frame
types too, the rest of 095 last; 096 runs beside everything.

## How the series is built (the maintainer's word, 2026-11-16)

- **One branch, `rewrite`.** Every PR of the series targets it, not
  main. It is main plus what the series has merged; main is merged
  into it daily, so it does not drift.
- **Reviewed before it merges.** A PR goes into `rewrite` when an
  independent code review of its head has run, the findings that
  matter are fixed by the session that owns the PR, and CI is green on
  that head. The coordinating session does this; a reviewer has not
  seen the PR's own session, and reads the branch as fetched then.
- **Milestones go to main, by the maintainer alone.** A milestone is a
  PR from `rewrite` to main with the ledger's figures before and
  after: about one for each line below, not one for each phase.

  1. *The measuring stick* — nothing a visitor sees: the ledger, the
     comparison of published tilesets, plates in CI, the buildings'
     bake the same on every machine, the counting test, the type
     checker's gate, a BBBike extract where Geofabrik cannot be
     reached. It goes first and alone because it is what guards main
     from then on — for every PR, the series' or not — and because the
     bake fix changes published bytes once: a later difference in the
     picture is then some other change's.
  2. *The dressing arrives GPU-ready* (090), a family of layers at a
     time.
  3. *Rasters* (091).
  4. *Tiles as a data product* (088), once the maintainer has decided
     the store.
  5. *The bake store* (092).
  6. The decision on 093, then *packages and frames* (095).
- **The rows of `docs/plans/README.md` are the coordinator's.** A
  session sends its row's text and leaves the file alone: nine PRs'
  rows side by side conflict.
- **Who does what.** Fable 5.2 coordinates, reviews, and builds the
  plans that are hard (088 from phase 1, 090, 092, 093, 094's
  register, the plates); Opus 5.5 builds the rest.

## What each plan may assume of the others

The series is built whole. A plan is therefore written for the state the
others leave, not for today's alone. These are the joints.

1. **Measure first.** Nothing that changes the picture merges before
   087's plates exist, and every plan writes its numbers into 087's
   ledger. The plates come in two tiers (ruling 4 reopened ADR 0018's
   rejection of pixel comparison on SwiftShader): in CI, base against
   head on the same runner's software renderer, as a tripwire for a
   change nobody meant — it says *changed*, never *good*; and on a real
   GPU, where light, shadow and anti-aliasing are the product's. A
   plate is compared with the base rendered on the same machine, so no
   reference image is kept anywhere. A PR with a *Snapshots* section
   claims a change, and the plates report which views it changed; a PR
   without one claims none, and a differing view fails its check until
   the PR names the change and shows it (ruling 3: named and shown, a
   slight deviation is acceptable — unnamed, it is not). The reason is
   the series' own history: PR #156 (plan 074 part A's spike) has
   waited since 2026-10-11 for a look on a real GPU, and plan 019
   since September.
2. **Data leaves git before a binary hand-over format enters it**
   (088 before 092). GeoJSON's one merit is the diff a re-bake shows in
   git; a binary table in git has neither a diff nor a delta. Which
   format it is, 092's spike decides: the pinned GDAL wheel writes
   FlatGeobuf and GeoPackage but no Parquet, and GeoJSON under the one
   schema is the fallback.
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
   that build it today. Areas and irregular solids (ballast, platforms,
   piers, basins) have no table smaller than their triangles: they are
   baked nodes, each kind behind a stop on the level's bytes.
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
   every bake step. Together they cost less than apart. The proof this
   repository leans
   on — "a cold bake publishes 0 new files" — holds through 092's
   schema, its own-output rule, its store and even its change of
   format; only the last step, windows in place of tiles, changes
   published bytes by design, and there a comparison by content takes
   over: 087 compares two published tilesets, 092 its own tables with
   today's files, and 087's plates watch the seams.
9. **The quadtree is decided by numbers, not by this file** (093). It
   needs 092 (or every cut is sixteen times the seams), 090's one
   container a tile (or sixteen times the requests), 091 (levels in
   place of raster twins) and 094's register (more tiles arriving a
   second). Plan 076 rejected implicit tiling "for now (15 tiles)",
   and 093 does not bring it back: the installed library's implicit
   tiling keeps one content a tile and addresses by template, against
   our hashed names, so the tree is explicit. What 093 reopens, under a
   gate, is the smaller tile: what a phone still pays after 090 and
   091.
10. **Raw rasters pay only with 088** (091): without a transport
    encoding a pre-gzipped array is a PNG by another name. 088 measures
    first what an encoding saves over files that are gzipped at level 9
    already, and builds it only on a gain. Measured on one tile for
    091: a plain array is smaller than its PNG for the exact rasters
    and a third larger for the fields unless a row predictor comes
    first — PNG's filters are one.
11. **Packages follow the seams the other plans leave** (095). Regrouping
    699 files first would cross every open PR; after 090 the viewer's
    edge is where the builders left. A move re-keys every bake (the
    cache key hashes a module's path), so its proof is a build that
    publishes 0 new files.
12. **Block compression is the small lever** (091). The first advice
    called GPU-compressed textures the largest unused one; 091's table
    says otherwise: the rasters that tolerate it (NDVI, sky view,
    horizon) are 4.7 MiB of the 40–60 MiB a phone holds for a fine
    level, and three's KTX2 path saves nothing on a one-channel raster.
    The weight is in the id rasters, which stay exact, and in the
    colour splat painted from them. So 091 leads with plain arrays and
    fewer bindings and keeps compression to a trial.

## Plans this series touches

- **074 part A** (bake the static dressing) and its spike **PR #156**:
  taken over by 090, which starts from the spike's numbers.
- **019** (the GPU checklist): 087 turns its reference views into
  compared plates and rewrites ADR 0018, which rejected pixel
  comparison on SwiftShader: it stays rejected for judging a look and
  is taken up as tier 1's tripwire (ruling 4); whether a picture is
  good, the two phones and the deploy host stay 019's.
- **070** (raster diet, partial) and 074's backlog item "one raster
  stack per tile": continued by 091. 076's and 077's rejection of KTX2
  stands for every exact raster (block compression would change ids);
  091 tries blocks on one soft raster and lets the numbers decide.
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
