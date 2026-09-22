# ADR 0001: Client-only static app — no backend, no database, no persistence

- **Status:** accepted
- **Date:** 2026-06 (initial commit), reaffirmed 2026-09

## Context

The viewer is a proof of concept for walking through a city built from
open geodata. The interesting work is offline (turning gigabytes of
geodata into a few megabytes of artifacts) and on the GPU (rendering it).
Nothing in the experience needs a per-user state: no accounts, no saved
worlds, no multiplayer. A backend would add hosting cost, an attack
surface and an operational burden to a solo project.

## Decision

The app is a single-route Next.js site deployed as static assets. All data
the viewer needs is prepared ahead of time and served as files under
`/data`. The browser does all computation. There is no API route, no
database, no cookie, no analytics, and nothing the user does is persisted
beyond `localStorage` conveniences (the dismissed hint bar). Sharing a view
is done by copying a Snapshot JSON, not by a server-side link.

## Consequences

- Hosting is any static host; the build (`bun build`) is the whole deploy.
- Every feature must be expressible as "a file the client fetches" plus
  client code; the [data pipeline](../data-pipeline.md) exists to make that
  cheap.
- Security review reduces to the client: no secrets, no user content, no
  CSP needed (audit finding, rejected as not applicable).
- Shareable links, user-saved places and editing that survives a reload
  are out of scope until this ADR is superseded (see
  [plans/README.md](../plans/README.md) direction options 2 and 4).

## Alternatives

- **A tile server / API** for on-demand data: rejected — the world is four
  fixed tiles; precomputing them is simpler and faster.
- **Server-side rendering of the scene:** not applicable; WebGL runs in
  the browser.

## References

- README.md ("one route, no backend, no database, no accounts, nothing
  persisted"); AGENTS.md "When in doubt, ask before introducing a backend".
- Audit rejections in [plans/README.md](../plans/README.md#rejected-kept-so-nobody-re-audits-them)
  (CSP headers, `.env.example`).
