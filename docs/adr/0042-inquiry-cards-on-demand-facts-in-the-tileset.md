# ADR 0042: The twin answers on demand — facts and provenance ride in the tileset, text appears only when asked

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10

## Context

The viewer is a digital twin with an aesthetic claim: a visitor should be
able to ask what a building, a tree, a bridge or a data mark is and where
the answer comes from, without words cluttering the scene and without a
server.

## Decision

1. **The facts ride in the tileset.** The building table carries fact
   columns (`lib/city/object-facts.ts`: the Building's id, use and roof
   from the AdV code lists as ENUMs, OSM name and address, height, pitch,
   area, storeys; noData is a marker, never 0). Any 3D Tiles client reads
   the same attributes. Large or per-feature facts that most visitors
   never ask for (a tree's) are a side file fetched with the question.
2. **Provenance is published** as `provenance.json` per site: label,
   credit, licence per source, edition per tile. The card fetches it with
   its first question.
3. **Text appears only on demand.** A click, a long press or `I` asks
   what is under the pointer; the answer is a non-modal card in the HUD
   (a bottom sheet on touch), its name repeated in the scene (point 4). It shows only measured or mapped
   facts, never an estimate, with a source line per source.
4. **The scene is wordless until asked.** The asked element is marked in
   the scene — a pencil hatch in the clay and an outline along its
   silhouette — and named beside it while the question stands: one
   nameplate, set in the picture style, saying what the card's title and
   address say (a landmark's name with its Wikidata facts, a name, an
   address) and nothing else. It keeps clear of what hides it and of the
   HUD, and goes with the question. Nothing in the scene is labelled
   unasked.
5. **An ensemble is asked as one:** LoD2 objects under one named OSM
   outline answer together, across tile edges.

## Consequences

- A new kind of askable thing adds a ray target from its data and lines in
  `lib/city/inquiry*.ts`; the card stays the only place facts become text
  at length; the nameplate (`lib/city/nameplate.ts`) only repeats its
  title and a line or two.
- Generated or estimated text, if ever shown, must be marked as such and
  kept apart from the measured facts.

## Alternatives

- **Every attribute as STRING, part UUIDs included:** +10 % a tile for ids
  nobody joins on.
- **All facts in a side file:** a second path for per-object data, and a
  tileset no other client can read the semantics of.
- **Labels in the scene for everything:** a city of captions; only the
  thing asked is named.
- **A modal dialog:** the city must stay live and the next tap must ask the
  next thing.
