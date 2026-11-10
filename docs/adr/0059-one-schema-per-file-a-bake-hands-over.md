# ADR 0059: One schema per file a bake hands over, checked by the build

- **Status:** accepted
- **Date:** 2026-11

## Context

A Python bake writes a file as a dict literal; TypeScript read it with
`readJson(path) as T`. Its shape was written three or four times — the
dict, the pytest asserts, a TypeScript interface, sometimes a viewer
guard — and nothing compared the copies. A renamed key,
a number turned string or a field whose meaning changed in Python passed
every check: the reader saw `undefined`, and a layer, a card or the
Stadtwissen was silently poorer. One such drift was live: the monuments'
`wikidata` names the item their material came from, while the Stadtwissen
republished it as the item OSM links the monument to.

The GeoJSON layers and the city mesh's other tile sources were held by
`features.test.ts`, which checks every committed file but not the build's
reads; the JSON files the build and the Stadtwissen cast were held by
nothing.

## Decision

1. **Every JSON file a bake writes and TypeScript reads has one zod
   schema**, in `lib/city/<name>-file.ts`, its head comment naming its
   writer, step and readers. Strict (an unknown key is an error), no
   `.transform`, `.default`, `.catch` or `.pipe`; readers take its
   `z.infer`, and the hand-written interfaces go. A union the viewer has
   (`WallMaterial`, `MonumentKind` …) is the schema's enum, held equal by
   a test. The city mesh's and the terrain's tile sources came under this
   in a later pass (doors, dormers, passages, plinths, small buildings,
   structures, measured roofs, shopfronts, windows, kerbs, walls, stairs,
   terraces); `features.test.ts` keeps the value rules a shape does not
   say (a door's range, a normal's length). A new file takes a schema.
2. **The build parses before it reads.** `parseBakeFile`
   (`lib/city/bake-file.ts`) replaces the cast: per tile in the step
   module that reads the file, site-wide in `prepare-data.ts` before it
   publishes the bytes. A mismatch ends the build naming the file, the
   schema, its writer, the first problems' key paths and the re-bake
   command. The parse returns its input, never zod's copy: a copy
   reorders keys, and baked bytes follow the file's order.
3. **Every committed file is parsed by a test** (`bake-files.test.ts`),
   which also checks that what a schema accepts it returns unchanged.
4. **The viewer takes the types only.** `app/` and the other `lib/city`
   modules import a schema module with `import type`; zod stays in the
   *Frag die Stadt* chunk alone (ADR 0047). The viewer keeps its hand
   guards for what it fetches, and a test pins each guard to its schema:
   it accepts every committed file, and refuses what the schema refuses.
5. **A bake that changes a key it writes changes the schema in the same
   commit**, and the committed data is re-baked before that commit merges.

## Consequences

- A drift fails `bun run verify` or the build, never a layer at runtime;
  between a schema change and its re-bake, `bake-files.test.ts` fails.
- The schema modules and zod's locked version are in the keys of the
  `city`, `stadtwissen` and `siteStats` bakes and, through
  `scripts/tile-sources.ts` and the canopy's and the crowns' readers, of
  the ground's family and the side bakes: zod is pinned exactly, and a bump
  re-bakes those artifacts once, byte for byte the same.
- A new handed-over file gets a schema module, a row in
  `bake-files.test.ts` and `parseBakeFile` where it is read (uncached and
  site-wide: a `NOT_A_BAKE` entry too).

## Alternatives

- **A hand guard per reader**: what drifted; one more copy of the shape.
- **pydantic models with generated TypeScript**: a generator in the
  build, and the truth on the side the browser never runs.
- **protobuf or another IDL**: a toolchain; files no longer diffable.
- **pytest against `z.toJSONSchema`'s export**: a new Python dependency
  (`jsonschema`) for now; the export keeps it a small step later.
