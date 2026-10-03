# ADR 0001: Client-only static app — no backend, no database, no persistence

- **Status:** accepted, **relaxed 2026-09-27** to "static where possible" (see the amendment below); crash and page reports to an error tracker where a DSN is set since 2026-10-03 ([ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md)); the "four fixed tiles" below became fifteen streamed ones with [ADR 0024](./0024-site-streams-as-3d-tiles.md) — still static files
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

- Hosting is any static host; the build (`bun run build`) is the whole deploy.
- Every feature must be expressible as "a file the client fetches" plus
  client code; the [data pipeline](../data-pipeline.md) exists to make that
  cheap.
- Security review reduces to the client: no secrets, no user content, no
  CSP needed (audit finding, rejected as not applicable).
- Shareable links, user-saved places and editing that survives a reload
  are out of scope until this ADR is superseded (see
  [plans/README.md](../plans/README.md) direction options 2 and 4).

## Amendment (2026-09-27): static where possible

The maintainer set the project's direction to a digital twin with an
aesthetic claim and relaxed this decision from "strictly static" to
"static where possible". Everything the twin knows about the city stays
baked into files ([ADR 0042](./0042-inquiry-cards-on-demand-facts-in-the-tileset.md));
live sources ([plan 053](../plans/053-time-and-live-sources.md)) are read
from the browser where their APIs allow it (CORS), and a small, stateless
proxy — no database, no accounts, no user data — is allowed only where a
source offers no other way. Anything stateful (saved places, shared edits)
still needs its own decision.

## Amendment (2026-10-03): crash and page reports

"No analytics" has one exception: where the build has a DSN
(`NEXT_PUBLIC_SENTRY_DSN`), the viewer reports its crashes, the problems
it catches and a summary of each page (frame rates, memory, boot times)
to an error tracker, built from the crash trail and sent as beacons to the
site's own origin, which a rewrite forwards to the tracker (a proxy in
configuration, no server code) — no SDK, no user id, no cookie, no
position
([ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md)).
Without a DSN nothing is sent. What the page keeps in local storage: the
crash trail (this page's record and the previous one's, and which
previous record was reported), the last picture style, the toolbar's
fold, the dismissed control hints; in session storage the view a GPU recovery returns to.

## Alternatives

- **A tile server / API** for on-demand data: rejected — the world is four
  fixed tiles; precomputing them is simpler and faster.
- **Server-side rendering of the scene:** not applicable; the renderer
  runs in the browser (WebGL then; WebGPU with a WebGL2 fallback since
  [ADR 0027](./0027-webgpu-renderer-and-tsl.md)).

## References

- README.md ("no backend, no database, no accounts, nothing persisted";
  since [ADR 0037](./0037-sites-providers-and-per-site-data.md) a start page
  and one prerendered route per site rather than one route); AGENTS.md "When in doubt, ask before introducing a backend".
- Audit rejections in [plans/README.md](../plans/README.md#rejected-kept-so-nobody-re-audits-them)
  (CSP headers, `.env.example`).
