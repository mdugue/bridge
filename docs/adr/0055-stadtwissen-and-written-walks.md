# ADR 0055: What the twin knows is baked as files; walks are written ahead, their narration marked, every claim sourced

- **Status:** accepted
- **Date:** 2026-10

## Context

The twin should *tell* the city, not only answer what a clicked thing is.
An agent (writing walks now, the chat of ADR 0056 later) needs what the
twin knows as searchable text, with a name joined to a place and a
source. Generated text must not pass for data (ADR 0042), and a phone's
memory and first load must not grow (ADR 0047).

## Decision

1. **The Stadtwissen is baked, not served.** `prepare-data.ts` publishes
   per tile a directory of every root Building that OSM names or
   addresses, that is listed or part of a landmark (gml:id, name,
   address, decoded use and roof, height, storeys, position, Q-id) and
   the tile's named monuments (`stadtwissen_<tile>.json`,
   `scripts/prepare/stadtwissen.ts`), and a site
   index `stadtwissen.json`: the landmarks, an excerpt of Wikidata's
   statements about each in words, the sources with their licences. The
   excerpt is fetched once (`bun scripts/fetch-stadtwissen.ts <site>`,
   CC0) and committed as `data/<site>/wissen/wikidata.json`, so the build
   stays offline. `lib/city/stadtwissen.ts` is its shape and search,
   `bun scripts/stadtwissen.ts` its command line. The viewer never loads
   it.
2. **Walks are written ahead and committed** (`data/<site>/walks/*.json`,
   `lib/city/walks.ts`, the guide `docs/walks.md`): stops with an eye on
   the measured ground, the hour, an optional picture style (never
   Modell: a walk is seen, and the jump into it broke the glide), the
   narration, notes for days and seasons, and the facts it rests on —
   each a sentence with an https source or a Stadtwissen id.
   `walks.test.ts` holds them to the data; the build bundles them into
   `walks.json`, which the HUD fetches when it lists the walks.
3. **The narration is marked, the facts are sourced.** Every stop's card
   says it was told by Claude (KI) and when, and folds the claims out with
   their sources. A legend is told as a legend; a claim in `facts` is one
   a source states.
4. **A walk is told on the way.** Each stop glides at 2.2× the usual
   pace, so the stop's story starts on the way, and the light glides to
   the next stop's hour with it; a stop's text fits a phone screen (560
   characters). A look from the air or the street does not stop the
   glide: the stop still lands. On a phone the card is a bottom sheet
   that starts folded, so the scene stays in view.
5. **The text points only at what the model draws; a photo shows the
   rest.** The model has masses, roofs as planes, towers, bridges, the
   river and the ground; a statue is a generic figure, and reliefs,
   inscriptions, colours and interiors are not there. A sentence that
   sends the eye to look ("Schau …", "Sieh …") points at the stop's
   photo, which `walks.test.ts` checks. The photo is a Wikimedia Commons
   file the stop names, copied once by `bun scripts/walks.ts <site>
   photos` as an 800 px WebP into `data/<site>/walks/photos/`, committed
   and served by the site itself with its author, licence and link on the
   card: the viewer asks no third party for it.

## Consequences

- An agent reads the city through one module and a few files, the source
  beside each value; serving it (an API, an MCP server) is not needed.
- A walk is checked numerically (ground, extent, references); its look
  with `bun scripts/walks.ts <site> shots` and `bun run shots` when it is
  written or the scene changes.
- Another city's walks are a writing task, not a code change.
- A photo is a few dozen kilobytes in the repository and loads only with
  its stop's card.
- Text other than the inquiry card's shows in the viewer, in the walk
  card only, marked as narration (amends ADR 0042).
