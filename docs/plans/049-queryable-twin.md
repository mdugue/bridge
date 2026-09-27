# Plan 049: A queryable twin — identity, semantics and provenance, asked on demand

> **Executor instructions**: Read fully first, and ADR 0036 with it. The
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
- **Effort**: M (phases 1–3 built; 4–7 S–M each)
- **Risk**: LOW — additive columns, an opt-in mode, no change to the
  default frame
- **Planned at**: 2026-09-27
- **Status**: **PARTIAL** — phases 1–3 built (2026-09-27); the hatch is
  unjudged on a real GPU; phases 4–7 open

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
(ADR 0036): `buildingId` (the Building's `gml:id`), `function`, `roofType`,
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
`data/provenance.json` at build time (`scripts/prepare-data.ts`); the
tileset's extras name it (`TilesetExtras.provenance`). Per source: label,
credit, licence; per tile: the edition of LoD2, the laser scan, DGM1,
DOM1, DOP. The LoD2 edition is split into the model year and its inputs'
years ("Modell 2024 · Dach gemessen 2016 · Grundriss 2022").

### 3. The Befragen mode and the paper card — ✅ built

`app/_components/inquiry-probe.ts` (pick under a screen point, the ground
in front of a building wins, the tree marked), `city-layer.ts` (`facts`,
`mark`), `visual-style.ts` (`ASKED_HATCH`: a paper lift and light, a
pencil hatch every 0.9 m on the building, 45° screen-space strokes every
7 px where those crowd), `inquiry-card.tsx` (a
non-modal `<aside>`, Esc and × close it), `lib/city/inquiry.ts` (the German
lines). `I` toggles the mode (in pointer lock it asks at the crosshair),
the toolbar's *Befragen* is its touch stand-in; a tap asks.
E2E: `the inquiry card tells what the data knows…` in the
`@desktop-render` group.

**Open in this phase**: plates on a real GPU (`bun run shots`, headed) of
the hatch at walking height and from 150 m, day and dusk; whether the
paper lift (0.4), the paper light (0.06 by day) and the ink (0.6 near,
0.55 on the screen strokes) sit calm next to the listed-building cornice
and the shop glow, and whether the screen-space strokes read as pencil or
as a screen door while the camera moves. Checked headless only
(SwiftShader, lite): the first cut's wash and lift cancelled, the current
one reads from 100 m.

### 4. More things to ask (S–M each)

The same card for the other layers, each reading a file the viewer
already has:

- **Trees** — the cadastre's genus, species (German and botanical), height
  and crown (`trees_<tile>.geojson`, Dresden's street-tree register,
  dl-de/by-2-0); the season model's state for the scene date. Needs an
  instance → feature index per vegetation chunk.
- **Bridges** — name (DLM), class and main span (Wikidata), the measured
  deck height (`bridge_<tile>.geojson`).
- **Monuments and fountains** — the DLM's official name
  (`monuments_<tile>.geojson`).

Each gets its own source line. Picking instanced meshes needs
`instanceId` from the raycast; keep the pick order: the nearest hit wins,
the ground in front of it cancels.

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

Today `data/provenance.json` is hand-kept. `ingest_sn.py` knows every
download's `stand` (the download-links service returns it) and checks
each file; it should write those values itself, so a re-bake cannot leave
the card quoting an old edition (plans/README direction option 6).

## Rejected on the way

- Part UUIDs in the tileset — 41 incompressible bytes per part, known to
  no other dataset (ADR 0036).
- A label over the asked building — plan 032's decision: no text in the
  scene.
- Guessing storeys from the height — the card shows mapped storeys only.
