# Plan 052: A queryable twin — identity, semantics and provenance, asked on demand

> **Executor instructions**: Read fully first, and ADR 0042 with it. The
> maintainer's two rules: the scene stays wordless (**text only in a card,
> only on demand**), and the app stays **static where possible** (ADR 0001,
> amended). Only measured or mapped facts reach the card — never an
> estimate. Update the status row in `docs/plans/README.md` when a phase
> lands.
>
> **Drift check (run first)**:
> `git log --oneline -5 -- lib/city/object-facts.ts lib/city/inquiry.ts app/_components/inquiry-card.tsx scripts/bake-city-mesh.ts pipeline/bake/osm_buildings.py`

## Status

- **Priority**: P1 (the direction the maintainer set on 2026-09-27)
- **Effort**: M (phases 1–4 built; 4b–7 S–M each)
- **Risk**: LOW — additive columns, an opt-in mode, no change to the
  default frame
- **Planned at**: 2026-09-27
- **Status**: **PARTIAL** — phases 1–3 built (2026-09-27), phase 4
  (trees, monuments, bridges; the traffic flows and bicycle counters)
  2026-10-01, the outline for every kind the same day; the hatch and the outline unjudged on a real GPU; phases
  4b–7 open

## Idea

A digital twin is a model you can ask. The viewer already streams
measured geometry; what it lacked was the answer to "what is this, how do
we know, and since when?". The answer belongs in the data (so any 3D Tiles
client can read it) and in a card that appears only when asked (so the
look stays the product).

## Phases

### 1. Identity and semantics through the bake — ✅ built

`lib/city/object-facts.ts`, `scripts/bake-city-mesh.ts`,
`scripts/bake-tiles.ts`, `scripts/tile-glb.ts` (STRING and ENUM columns).
Ten fact columns per object in the building glTF's property table
(ADR 0042): `buildingId` (the Building's `gml:id`), `function`, `roofType`,
`created` (ENUM), `name`, `addr` (STRING), `height`, `roofPitch`, `area`,
`levels` (FLOAT32, noData −1). Spawn tile: +46 kB gzipped (+3.5 %).
The code lists are `lib/city/adv-codes.ts` (the AdV CityGML profile's
BuildingFunctionTypeAdV and RoofTypeTypeAdV, 301 + 15 codes).
Fixed on the way: `bake-city-mesh.ts` read the footprints after the
CityJSON loader had rewritten the document, which cost every Solid its
GroundSurface — 2 012 of 2 041 BuildingParts on the spawn tile had no
minimap footprint. They are read before the loader now (the minimap
draws every part).

`pipeline/bake/osm_buildings.py` adds `name`, `addr` and `levels` per
LoD2 object from the OSM outline covering most of it, else the address
points on it. Re-baked on all fifteen tiles on 2026-09-27 (BBBike extract
of 2026-09-26); the spawn tile: 2 363 of 4 404 objects addressed, 444
named, 2 470 with storeys. 33416_5658 carries nothing (its LoD2 file and
the extract's cut leave no building to join).

### 2. The provenance manifest — ✅ built

`lib/city/provenance.ts` derives `provenance.json` from
`data/<site>/provenance.json` at build time (`scripts/prepare-data.ts`); the
tileset's extras name it (`TilesetExtras.provenance`). Per source: label,
credit, licence; per tile: the edition of LoD2, the laser scan, DGM1,
DOM1, DOP. The LoD2 edition is split into the model year and its inputs'
years ("Modell 2024 · Dach gemessen 2016 · Grundriss 2022").

### 3. Asking and the card — ✅ built

`app/_components/inquiry-probe.ts` (pick under a screen point, the ground
in front of a building wins, the tree marked), `city-layer.ts` (`facts`,
`mark`), `visual-style.ts` (`askedColour`: a paper lift and light, a
pencil hatch every 0.9 m on the building, 45° screen-space strokes every
7 px where those crowd), `inquiry-card.tsx` (a
non-modal `<aside>`, Esc and × close it), `lib/city/inquiry.ts` (the German
lines). A **click** asks (a mouse tap: no drag, a double click still
glides there); a **long press** (a finger or pen held still 450 ms,
`touch-controls.ts`; not the mouse, whose drags often start with a pause)
asks on glass, where a plain tap is too easily a missed drag; `I` asks
at the crosshair. There is no mode: the first cut had one (`I` or the
toolbar's *Befragen*, then a tap), and a key before every click was too
much (maintainer, 2026-10-01). The card looks like the HUD's other cards
(the shadcn Card's surface, ring and shadow); a warm paper sheet was
too warm next to the pastel scene (same review). A tap off target still finds its building: when the ray under
the finger meets nothing, two rings of rays (11 and 22 px) vote and the
tree most of them hit wins (`chooseSample`). On touch screens the card is
a **bottom sheet**, the shadcn Drawer (Base UI) — non-modal
(`modal={false}`, `disablePointerDismissal`), two snap points (8.25 rem
folded: kicker, title, address; 75 % unfolded: facts, id, sources),
retinted to the paper through the popover tokens; swipe up or
*Angaben und Quellen* unfolds, swipe down folds, then closes. The
joystick and the toolbar step aside while it is open. The scene
suppresses text selection and the iOS callout (`select-none`,
`-webkit-touch-callout: none`), so a long press never marks the page's
text. Added 2026-09-28 at the maintainer's request.
E2E: `the inquiry card tells what the data knows…` in the
`@desktop-render` group; the long press and the sheet in the `@phone`
spec.

**Open in this phase**: plates on a real GPU (`bun run shots`, headed) of
the hatch at walking height and from 150 m, day and dusk; whether the
paper lift (0.4), the paper light (0.06 by day) and the ink (0.6 near,
0.55 on the screen strokes) sit calm next to the listed-building cornice
and the shop glow, and whether the screen-space strokes read as pencil or
as a screen door while the camera moves. Checked headless only
(SwiftShader, lite): the first cut's wash and lift cancelled, the current
one reads from 100 m. Its cost: the hatch (`askedColour`) is branch-free,
so every clay fragment pays its ~20 ALU ops whether or not anything is
asked. Measure the main pass with and without it on a phone; if it
shows, give the marked tile's clay its own graph variant with the hatch
(`setGraph` key `clay|asked`, warmed with the others) and keep it out of
the default build — a uniform branch around it would put `fwidth` under
WGSL's uniformity analysis, unverifiable headless.

### 4. More things to ask — **BUILT** (2026-10-01)

The same card for trees, monuments and fountains, and bridges, each with
its own source lines (`lib/city/inquiry-features.ts`):

- **Trees** — species (German and botanical), the register's location
  and tree number, the sizes the register *measured* (a crown it filled
  in from the tile's statistics is no fact), the age it records with the
  record's date; an OSM tree its tagged taxon and sizes. `trees.py` writes
  them to `treefacts_<tile>.json`, columns aligned with the trees file
  (≈ 37 kB gzipped a tile), named in the tileset's tile list (`ask`) and
  fetched with the first question about a tree there — ADR 0042's
  side-file pattern. The register was re-read for all fifteen tiles for
  it (626 trees new on 33414_5656; the ten laser-scan trees they claim
  thinned by lowveg's own last step).
- **Monuments and fountains** — the DLM's official name, the basin's
  form (OSM), a measured height where the bake measured the form.
- **Bridges** — name and deck (Basis-DLM, measured in DOM1), structure
  and main span (Wikidata where matched, else OSM), the fairway
  clearance; keyed by the Wikidata item.
- **Traffic flows and bicycle counters** (the data layers, while they
  show) — a section's vehicles a day both ways and per direction (named
  by the compass point it heads to, with the heavy-goods share), the
  year and method, an even split said as one, the scene's hour as an
  estimate on the typical day's curve; a counter's bicycles in the last
  hour per direction and when they were counted. Picked on the drawn
  glass (`traffic-ask.ts`, the vertex → section table on the CPU) and
  the columns as they stand (`bike-ask.ts`); cards in
  `lib/city/inquiry-traffic.ts`.

Picking: the raycaster cannot pick instanced sets (`Instances` since the
WebGPU port), so trees and monuments are rays against solids from their
data (`lib/city/ask-solids.ts`, `ask-items.ts`): a tree's trunk and crown
cylinders — packed per 64 m cell in typed arrays, 0.8 MB on the busiest
tile where objects took 3.5 MB — a monument's marker or measured form, a
basin's prism. Bridges are met on the drawn bridge itself (deck, arches,
piers; `bridge-ask.ts`, a BVH on the first question): a slab from the
data would either miss the masonry under an arch or block the open space
under a beam bridge. The nearest answer of any kind wins; the ground in
front cancels; the tolerant rings vote across kinds.

The mark: every asked element, the building included, gets one outline
along its silhouette as the camera sees it now — not along its edges
(`selection-outline.ts`, numbers in `lib/city/outline.ts`). Its
triangles are drawn into a mask where the scene pass's depth shows them
(a building's or bridge's own; a tree's crown and trunk, a monument's
cylinder, a basin's prism as stand-ins, which count only where the
scene's surface lies inside them), the mask is blurred at half
resolution, and a band of the blur is the line: rounded, simplified
below its own width, smooth at its edge (fwidth), 4.5 CSS px whatever
the screen's pixel ratio or the distance. Graphite with a hair of paper
outside, the hatch's two colours, so it reads on dark asphalt as on a
lawn. A first mark, a pencil loop on the ground around a tree and along
a deck's parapets, said "here" rather than "this" and left a building
without a line (maintainer review, 2026-10-01; 🗃️ in the ledger). E2E:
a register tree asked from above in the `@desktop-render` group.

**Open in this phase**: plates on a real GPU of the outline at walking
height and from the air (headless only so far, lite at half resolution:
it follows a building's, a crown's and a bridge's silhouette; the
half-resolution lite frame shows its steps, a full-resolution one
should not); a neighbouring crown inside a tree's stand-in can join its
outline; the season model's state on a
tree's card; the timetable's trams as a kind (a car moves, so the
pick runs on its sections' current frames); furniture, lamps and stops as further kinds (their files
are in the dressing already).

### 4c. The data behind each thing — **BUILT** (2026-10-07)

The card's source lines were the bottom third of every card and read as
small print between the facts and the next question. They now sit
folded under **Daten** (`inquiry-data.tsx`), which unfolds into two
parts: *Angaben* — the card's own source lines, where each stated fact
comes from — and *Darstellung* — what the thing as drawn is made of:
each dataset with what it gave the form, colour, place and light (the
LoD2's walls and roof, the surface model's rebuilt roof, OSM's facade
colour and shop fronts, the orthophoto's roof colour, the sky light
baked from DGM1 and LoD2, a tree's register and its NDVI leaf colour, a
bridge's Wikidata item), its edition, its credit and a link to it, and
last what the viewer works out itself (the tint's scatter, the crown
forms, the hour's light). `lib/city/lineage.ts` decides, only from what
the object carries (its flags, source and facts; the feature's
properties; the site's products), and is its own chunk, imported when
the section is first opened or the pointer nears its toggle — the boot
carries none of it, and nothing new is fetched (the manifest is the
card's).

### 4d. What the ray met — **BUILT** (2026-10-07)

A click used to answer with the nearest thing on its ray, and a tree's
crown is a stand-in wider than its leaves: a house half behind a street
tree was answered as the tree. The probe now keeps everything a ray
meets before the ground (`cityObjectsAlong` for the buildings, one hit a
tree; `hitsInSets` for the things — a set's `along`, else its nearest)
and chooses the first *solid* thing on the exact ray, a crown only where
nothing solid stands behind it (`firstSolid`); the tolerant rings still
vote when the exact ray meets nothing. The rest are candidates
(`mergeCandidates`: the exact ray's hits and each ring ray's first two,
each thing once, at most eight, nearest first, the chosen one never cut),
listed apart from the card, so the card stays about one thing — the way
an editor's "select the layer under the pointer" list works
(`inquiry-strip.tsx`): on a desktop a quiet glass list in the card's
column, under it ("Hier auch · vorn zuerst", an icon, the
card's title and the distance each, the chosen one marked); on a touch
screen a row of chips above the folded sheet, scrolled to the chosen
one. The pointer on a candidate moves the outline to it for as long as
it stays (`previewCandidate`), a click shows it in the card and moves
the hatch (`selectCandidate`). A ring a finger wide pulses once at the
tap: how far round it the question looked.

### 4b. Aim and ask in live mode (S–M)

With live mode on (the phone's compass and GPS steer the view), a tap
anywhere asks what stands under the crosshair: point the phone at a real
house, learn what it is. GPS is often 5–20 m off and a compass a few
degrees: below a stated accuracy the card should say "vermutlich". Needs
testing on site.

### 5. A link to an asked building (S)

`?asked=<buildingId>` (with plans/README direction option 2's `?snap=`):
after `ready`, find the object by `buildingId` in the loaded tiles (a scan
over the fact column, only on that URL), glide to it, open the card. The
id is stable across re-bakes of the same LoD2 edition.

### 6. A "Datenstand" section (S)

The sidebar's *Erweitert* tab lists the provenance manifest for the tile
the player stands on: every source, its edition, its licence — the
guide's dataset table, live and per tile. Reuses `provenance.json`.

### 7. The ingest writes the provenance (S–M)

Today `data/<site>/provenance.json` is hand-kept. `ingest_sn.py` knows every
download's `stand` (the download-links service returns it) and checks
each file; it should write those values itself, so a re-bake cannot leave
the card quoting an old edition (plans/README direction option 6).

## Rejected on the way

- Part UUIDs in the tileset — 41 incompressible bytes per part, known to
  no other dataset (ADR 0042).
- A label over the asked building — plan 032's decision: no text in the
  scene.
- Guessing storeys from the height — the card shows mapped storeys only.
