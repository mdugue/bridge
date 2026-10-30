# ADR 0001: Static where possible — no database, no accounts, nothing kept about a visitor

- **Status:** accepted
- **Date:** 2026-06, rewritten 2026-10

## Context

The heavy work is offline (gigabytes of geodata baked into files) and on
the GPU (rendering them). Nothing in the experience needs state per
visitor. A backend would add cost, an attack surface and operations to a
solo project. A few things still need a server's hand: forwarding the
crash reports past content blockers (a rewrite today), a live source
without CORS, or a model called with a visitor's own key.

## Decision

- Every page is prerendered: a start page, a route per built city, the
  knowledge base and the legal pages. `next build` fails when a page reads
  request-time data (`ensureStatic = "navigation"` in `app/layout.tsx`).
- All data is static files under `/data`, baked ahead of time. The browser
  does all computation.
- A **stateless server function or rewrite** is allowed where a source or
  service offers no other way (the reports' forwarding, ADR 0043). It
  stores nothing, logs no content and keeps no secret of a visitor.
- No database, no accounts, no cookies. The browser keeps only
  conveniences in local storage, each listed on `/datenschutz` (ADR 0043).
- Sharing a view is a Snapshot JSON (ADR 0018), not a server-side link.

## Consequences

- Any static host with rewrites and functions serves it; `bun run build`
  is the deploy.
- A feature is "a file the client fetches" plus client code, or it needs a
  server function and the reason in its own ADR.
- Saved places, shared edits and shareable links need a new decision:
  they are state.

## Alternatives

- **A tile server or API for the data:** the data changes with a bake,
  not per request; files behind an immutable cache are faster and free.
- **Server-side rendering of the scene:** the renderer runs in the
  browser.
