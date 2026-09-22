# ADR 0007: Content-hashed data files with a `manifest.json`

- **Status:** accepted
- **Date:** 2026-09 (PR #28)

## Context

`public/` files are served by Next with `max-age=0`, i.e. one revalidation
round trip per file per visit — ~60 of them here. A previous copy step
treated an artifact as up to date when its byte size matched, so a re-bake
of equal length was never published (audit finding #41). Data files change
rarely but must reach every client when they do.

## Decision

`prepare-data.ts` publishes every artifact under
`<stem>.<8 hex of sha1(content)>.<ext>` and writes `public/data/manifest.json`
mapping logical names to hashed names. `next.config.ts` serves `/data/*` as
`public, max-age=31536000, immutable` and the manifest as `no-cache`. The
client fetches the manifest first and resolves every URL through it
(`manifestUrl`). Files the manifest no longer references are pruned from
`public/data/`.

## Consequences

- One small revalidation per visit; everything else is cached forever.
- A re-bake changes the hash, so staleness is impossible by construction;
  the size-only check is gone.
- A heightfield header names its data sibling, so headers are published
  after their data and rewritten with the hashed name.
- Removing an optional source really turns its feature off (prune).
- Anything that builds a `/data` URL must go through the manifest; a
  hard-coded path breaks on the next re-bake.

## Alternatives

- **mtime-based copy + revalidation headers:** what it replaced; every
  visit paid ~60 conditional requests.
- **Query-string cache busting:** CDNs and browsers treat it inconsistently.

## References

- `scripts/prepare-data.ts` (publish stage), `lib/city/tile.ts`
  (`MANIFEST_FILE`, `manifestUrl`), `next.config.ts`.
