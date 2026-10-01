# ADR 0040: The twin answers on demand — facts ride in the tileset, text only in a card

- **Status:** accepted
- **Date:** 2026-09

## Context

The maintainer wants the viewer to grow from a stylised walk into a
*digital twin with an aesthetic claim*: a model you can ask what a thing
is, how tall, how old the data about it is and where it comes from —
without giving up the look that makes it worth walking through. Three
things stood in the way:

- **The bake threw the semantics away.** The building glTF's
  `EXT_structural_metadata` table carried only what the clay shader needs
  (tint, heights, roof colour, glow, flags). The CityGML `gml:id` — the
  key any other dataset (ALKIS, the heritage register, OSM, a city's own
  data) joins on — the ALKIS use, the roof form, the measured height and
  the object's date ended at `bake-city-mesh.ts`.
- **Nothing said how current the data is.** `data/<site>/provenance.json` records
  every product's edition per tile, but only for the repository's readers.
- **Text in the scene was rejected.** Plan 032's street lettering was built
  and removed after the maintainer saw it on a device: the map look reads
  better without text (ledger 🗃️). A twin still has to say things.

Measured on the spawn tile (4 404 objects), the building glTF gzipped at
level 9: 1 340 617 B with the style columns alone. Every CityJSON attribute
as a STRING column: +132 kB (+9.6 %), 70 kB of it the object ids — Saxon
BuildingParts carry random `UUID_…` ids of 41 bytes that no other dataset
knows and gzip cannot shrink.

## Decision

**The facts ride in the tileset.** The building table gains ten columns
(`lib/city/object-facts.ts`): `buildingId` (the Building's `gml:id`; a part
carries its Building's), `function` and `roofType` (AdV code lists) and
`created` (the object's export date) as ENUM columns of the codes a tile
uses, `name`, `addr` (OSM) as STRING, `height`, `roofPitch`, `area`,
`levels` as FLOAT32 with `noData = default = −1`, so a reader resolving
noData hands back the marker, never 0 (a flat roof's pitch). The glTF
stays self-describing: any 3D Tiles client (CesiumJS, deck.gl) shows the
same attributes. Cost: +46 kB (+3.5 %) on the spawn tile. The viewer reads
the style columns column by column at load and a fact row only when asked.

**Provenance is published.** The build derives `provenance.json` from
`data/<site>/provenance.json` (`lib/city/provenance.ts`): per source its label,
credit and licence; per tile its edition. The tileset's extras name it; the
card fetches it with its first question, never at boot. Every site
(ADR 0037) gets one: credits and licences are its provider's (and its
tree register's); per-tile editions where its record carries them (the
GeoSN rows, Dresden so far), else the card names the source alone. The
OSM names, addresses and storeys are baked for Dresden's tiles; another
site's card has them once its `osm-buildings` step is re-run.

**Text appears only on demand, in one place.** A click asks the building
under the mouse, a long press the one under a finger or pen, `I` the one
under the crosshair — there is no mode to switch on first (a first cut
had one, `I` or a toolbar button; the maintainer found a key before
every click too much, 2026-10-01). The answer is a non-modal card in the
HUD, the HUD's own card surface — a bottom sheet on touch screens (`inquiry-card.tsx`,
the model in `lib/city/inquiry.ts`). The scene itself stays wordless: the asked
building is marked by a pencil hatch in the clay (flag 32 in the packed
object texture, set at runtime), not by a label. The card shows only
measured or mapped facts — no estimate (a building without a mapped storey
count has no storey line) — and a source line for every source it quotes,
with its edition and licence.

**Static where possible.** The maintainer relaxed ADR 0001 on 2026-09-27
from "no backend" to "static where possible": the facts, the provenance
and the card need no server, and live sources (plan 053) are fetched from
the browser where their APIs allow it; a small stateless proxy is allowed
only where a source offers no CORS.

## Consequences

- Other data can now join a building by `buildingId` — at bake time (a
  new column) or in the browser (a side file keyed by it).
- A part's own UUID is not in the tileset. It stays in the committed
  CityJSON; the part is addressed as its Building plus its feature index.
- Adding a fact is a column in `object-facts.ts` and a line in
  `inquiry.ts`; the numeric columns must keep the noData marker.
- The card's German strings live in `lib/city/inquiry.ts` (the HUD is
  German, like the rest of it; plans/README direction option 9 covers a
  second language).
- The OSM building bake (`osm_buildings.py`) now reads the whole building
  outline layer and the address points; its facts stay on the object
  itself, never its root, because one LoD2 Building often spans several
  houses with an address each.
- Papier (ADR 0034) replaces every material for its frames, so it does not
  show the hatch; the card still opens.
- An object whose LoD2 roof was rebuilt from DOM1 (ADR 0036) answers with
  what is drawn: `roofType` `DOM1` (not an AdV code; the card says "flach,
  gestuft (gemessen)"), no pitch, the rebuilt shape's height (the LoD2's
  `measuredHeight` can be a 3 m placeholder), and DOM1 as the roof's
  source line. 75 such objects on the spawn tile.
- **Phase 4 (2026-10-01): trees, monuments, bridges.** The side-file
  pattern took the trees' facts: `treefacts_<tile>.json`, aligned with the
  trees file, named in the tileset's tile list (the artifact table's `ask`
  column), fetched with the first question about a tree on the tile.
  Monuments and bridges answer from the features the dressing already has.
  Every asked element, building or not, is outlined: one line along its
  silhouette as seen now, a constant width in screen pixels, in the
  hatch's graphite on a hair of its paper (`selection-outline.ts`; it
  replaced a first pencil loop on the ground) — still no text in the
  scene.
  Instanced sets cannot be raycast one by one since ADR 0027, so trees and
  monuments are picked by rays against solids from their data; bridges by
  their drawn meshes.

## Alternatives

- **Every attribute as STRING, part UUIDs included** — +9.6 % per tile for
  ids nobody joins on. Rejected; ENUMs for code lists are what the
  extension has them for.
- **A side file per tile fetched on the first question** — zero cost for
  visitors who never ask, but a second path for per-object data, a tileset
  no other client can read the semantics of, and a fetch before the first
  answer. Rejected for the core facts; kept as the pattern for large or
  third-party datasets joined by `buildingId`.
- **Labels in the scene** (a floating name over the asked building) — the
  plan 032 decision stands: no text in the scene.
- **Highlight by an ink outline** (post pass, object-id buffer) — would
  need an id render target the stylize pass does not have; the hatch in the
  clay costs a uniform-free texel write and a few ALU ops.
- **A modal dialog** — the city must stay live and the next tap must ask
  the next building; a non-modal `<aside>` landmark does both.

## References

- `lib/city/object-facts.ts`, `lib/city/inquiry.ts`,
  `lib/city/provenance.ts`, `lib/city/adv-codes.ts` (the AdV code lists)
- `scripts/tile-glb.ts` (STRING and ENUM columns), `scripts/bake-tiles.ts`,
  `scripts/bake-city-mesh.ts`, `scripts/prepare-data.ts`
- `app/_components/inquiry-probe.ts`, `inquiry-card.tsx`, `city-layer.ts`
  (`facts`, `mark`), `visual-style.ts` (`askedColour`)
- `pipeline/bake/osm_buildings.py` (name, address, storeys)
- [plan 052](../plans/052-queryable-twin.md), [053](../plans/053-time-and-live-sources.md),
  [054](../plans/054-scenarios.md); ADR 0001 (amended), 0024, 0027, 0034
