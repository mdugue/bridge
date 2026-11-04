# ADR 0059: One schema per file a bake hands over, checked by the build

- **Status:** accepted
- **Date:** 2026-11

## Context

A Python bake writes a file as a dict literal; TypeScript reads it with
`readJson(path) as T`. Each such file had its shape written three or four
times — the dict, the pytest asserts, a TypeScript interface, sometimes a
hand guard in the viewer — and nothing compared the copies. A renamed key,
a number turned string or a field whose meaning changed in Python passed
every check: the reader saw `undefined`, and a layer, a card or the
Stadtwissen was silently poorer. One such drift was live: the monuments'
`wikidata` names the item their material came from, while the Stadtwissen
republished it as the item OSM links the monument to.

The GeoJSON layers are already held by `features.test.ts`, which reads
every committed file of every tile kind; the JSON files a build-side
reader casts were held by nothing.

## Decision

1. **Every file a bake writes and TypeScript reads has one zod schema**, in
   its own module `lib/city/<name>-file.ts`, written from the Python
   writer and naming its writer, its step and its readers in the module's
   head comment. The schema is strict (an unknown key is an error), has no
   `.transform`, `.default`, `.catch` or `.pipe`, and its type is the
   file's type: readers take `z.infer` of it, and the hand-written
   interfaces go. A union the viewer already has (`WallMaterial`,
   `MonumentKind` …) is mirrored as the schema's enum, and a test holds the
   two equal.
2. **The build parses before it reads.** `parseBakeFile`
   (`lib/city/bake-file.ts`) replaces the cast: per tile in the step
   module that reads the file, site-wide in `prepare-data.ts` every run
   before it publishes the same bytes. A file that does not match ends the
   build with the file, the schema, its writer, the first problems with
   their key paths and the re-bake command. The parse returns its input,
   never zod's copy, because a copy reorders keys and baked bytes follow
   the file's order.
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

- A drift fails `bun run verify` or the build, never a layer at runtime.
  Between a schema change and its re-bake, `bake-files.test.ts` fails by
  design.
- The parsing step modules put the schema modules and zod's locked
  version into the keys of the `city`, `stadtwissen` and `siteStats`
  bakes: zod is pinned exactly, and a bump re-bakes those artifacts once
  for every site, byte for byte the same.
- A new handed-over file gets a schema module, a row in
  `bake-files.test.ts` and `parseBakeFile` where it is read; a site-wide
  one read uncached also gets its `NOT_A_BAKE` entry
  (`bake-entries.test.ts`).

## Alternatives

- **A hand guard per reader**: what drifted; each guard is one more copy
  of the shape.
- **pydantic models with generated TypeScript**: a generator in the
  build, and the truth on the side the browser never runs.
- **protobuf or another IDL**: a toolchain, and files no longer diffable
  in review.
- **pytest against a JSON Schema exported by `z.toJSONSchema`**: rejected
  for now as a new Python dependency (`jsonschema`); the export keeps it a
  small step later.
