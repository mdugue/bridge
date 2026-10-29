# ADR 0053: The twin's knowledge is baked as files; walks are written ahead, their narration marked, every claim sourced

- **Status:** accepted
- **Date:** 2026-10

## Context

The maintainer wants the twin to *tell* the city, not only answer what a
clicked thing is (the agentic concept of 2026-10-29: first baked
"Stadtwissen" and written walks, then a chat that brings its own key,
later a voice guide). Three constraints shaped the first step:

- **An agent — the one writing walks now, a chat later — needs what the
  twin knows as text it can search.** That knowledge existed, but spread
  over a glTF property table per tile (ADR 0042), the OSM bakes, the
  landmark files and `provenance.json`; nothing joined a name to a place
  and a source.
- **Generated text must not pass for data.** ADR 0042 kept text out of the
  scene and let only the inquiry card speak, in facts with a source each.
  The maintainer accepted generated narration in the viewer *if it is
  marked as such*.
- **The viewer may not grow on a phone** (memory, first load), and there
  is no backend (ADR 0001): a walk cannot be generated per visitor
  without a key and a server function, which belong to the chat step.

## Decision

**The Stadtwissen is baked, not served.** `prepare-data.ts` publishes
per tile a directory of every root Building that OSM names or addresses,
that is listed, or that is part of a landmark — its gml:id, name,
address, use and roof (decoded AdV codes), height, storeys, position and
Q-id — and the tile's named monuments (`stadtwissen_<tile>.json`,
`scripts/bake-stadtwissen.ts`); and a site index `stadtwissen.json` with
the landmarks, an excerpt of Wikidata's statements about each (architect,
inception, height, heritage status, named after, …, in words) and the
sources with their licences. The excerpt is fetched once
(`bun scripts/fetch-stadtwissen.ts <site>`, CC0) and committed as
`data/<site>/wissen/wikidata.json`, so the build stays offline and
reproducible. `lib/city/stadtwissen.ts` is its shape and search;
`bun scripts/stadtwissen.ts <site> such|nah|wahrzeichen|quellen` its
command line. The viewer never loads it.

**Walks are written ahead and committed.** A walk
(`data/<site>/walks/<id>.json`, `lib/city/walks.ts`) is a sequence of
stops: where the eye stands and what it looks at (site CRS, the ground
under the eye from the DGM), the hour, an optional Modell view or picture
style, the narration, a closer look, notes for days of the year and
seasons, and the facts it rests on — each a sentence and an https source
or a Stadtwissen id. `walks.test.ts` holds them to their data: well formed,
inside the site, on the measured ground (0.2 m), naming only Stadtwissen
entries the build publishes. `prepare-data.ts` bundles them into
`walks.json`, which the tileset names; the HUD fetches it when it lists
the walks (≈ 25 kB gzipped for Dresden's four).

**The narration is marked, the facts are sourced.** Every stop's card
says it was told by Claude (KI) and when, and folds the claims out with
their sources. The narration may tell a legend as a legend; a claim in
`facts` is one a source states. The visitor's day picks the notes (a
consecration's anniversary, the Striezelmarkt in Advent) and the season;
the stop is shown today at its hour.

## Consequences

- An agent — in the workshop now, the chat later — reads the city through
  one module and a few files, with the source beside each value.
- A walk's view is checked numerically (ground, extent, references), not
  visually: a stop's look is checked with `bun scripts/walks.ts <site>
  shots` and `bun run shots` when it is written or the scene changes.
- The walks are German and Dresden's for now; another city's are a
  writing task, not a code change.
- The narration is generated text under the maintainer's review in a PR;
  a chat's free answers (the next step) need their own decision on how
  they are marked and checked.
- Amends ADR 0042: text other than the inquiry card's now shows in the
  viewer, in the walk card only, marked as narration.

## Alternatives

- **Generating walks at runtime** (a visitor's key, a server function):
  belongs to the chat step; a written walk can be reviewed, sourced and
  tested before anyone reads it.
- **Serving the Stadtwissen** (an API, an MCP server): rejected by the
  maintainer for now; static files cost nothing to host and need no
  backend.
- **Wikidata live in the browser**: a third-party request per visitor
  (ADR 0045) and an answer that can change under a written walk.
