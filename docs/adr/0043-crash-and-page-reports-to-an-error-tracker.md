# ADR 0043: Crashes and page summaries go to an error tracker, from the crash trail, only where a DSN is set

- **Status:** accepted
- **Date:** 2026-10-03

## Context

On phones the viewer crashes often and is often slow, and so far only the
maintainer's own iPhone told us how. The crash trail
(`lib/city/crash-trail.ts`) already records what matters — boot stages,
errors, a lost device, a heartbeat every two seconds with the frame rate
and what the renderer holds — and offers the trail of a page that died as
text to copy on the next load. Nothing reached us from anybody else's
phone.

An error tracker's SDK does not close that gap by itself. The crash that
matters most here is the page the browser **kills**: iOS ends a tab that
holds too much memory (Safari's GPU process failed at ~720 MB,
`docs/rendering.md`), Chrome kills a renderer out of memory. A killed page
runs no handler — no `error`, no `pagehide`, no `beforeunload` — so no SDK
can report it. Chrome's Reporting API can (`crash` reports with reason
`oom`), but only from Chromium, only to an endpoint that takes the
reports, and not on the iPhone. A lost WebGPU device, a frame that threw
and a tile that failed to load are not exceptions either: the viewer
catches them itself.

What does survive the kill is local storage. So the report of a crash can
only come from the **next** load — which on an iPhone often follows at
once (Safari reloads a page that crashed), and which `gpu-recovery.ts`
causes itself after a lost GPU.

## Decision

The viewer sends three kinds of report, all built from the crash trail
(`lib/city/crash-reports.ts`, pure; sent by
`app/_components/crash-reports.ts`):

1. **A crash** — the previous page died in use (`offerAsCrash`: its record
   ended `running`, not on its way to a reload for a lost GPU, not the
   record iOS leaves around a recovery). Sent by the next load, once per
   record, as a fatal event grouped by renderer and how far the page got
   (`boot after <stage>`, `streaming`, `running`), with the trail's last
   events and beats as breadcrumbs.
2. **A problem on this page** — an uncaught error or rejection, a lost
   device, a GPU error, a failed frame, a file that did not load, a
   failed boot: each kind and detail once (URLs and numbers out of the
   grouping), at most five a page.
3. **The page's summary** — a transaction over the page's time with the
   time to the first frame and to loaded, the mean frame rate and the
   share of the time in view below 10, 20 and 30 fps, the most memory
   held. Sent as the page is first hidden or left; a page that never got
   to (a killed one) is summarised by the next load. The trail counts
   the beats for it over the whole page (`TrailStats`), not only its last
   twelve, and only beats in view after the first frame.

They go out in **Sentry's envelope protocol**, as a `sendBeacon` (a
`fetch` with `keepalive` where a beacon is refused) — **no SDK**: nothing
is loaded from the tracker, the bundle does not grow, and a beacon
outlives the page that sends it. Any tracker that takes Sentry envelopes
works (Sentry, GlitchTip, Bugsink, self-hosted or not).

**Off unless the build has a DSN** (`NEXT_PUBLIC_SENTRY_DSN`), and off
for a visitor whose browser sends Global Privacy Control. Without a DSN the
build is exactly what it was: CI, the e2e and every deploy without one
send nothing. `NEXT_PUBLIC_SENTRY_RELEASE` (on Vercel the commit, without
setting anything) names the build, so a fix's effect shows per release.

**What goes out** is what the trail holds and nothing else: the path
without its query, the user agent, the screen and the device's memory,
the renderer, the events and beats (frame rates, memory, tiles, style,
walk or fly, the camera's height above the ground). No position — the
trail never had one, and the guide's promise that the location never
leaves the device stays true. No id, no cookie. The tracker sees the
sender's IP address with every request: set the Sentry project to store
none (*Security & Privacy → Prevent Storing of IP Addresses*)
and pick the EU region when creating the organisation.

## Consequences

- ADR 0001's "no analytics" now has this one exception (see its
  amendment); plan 047's "nothing leaves the device without a click" was
  written for the copied report and the view, and holds for the view:
  the Snapshot (the camera's position) is never part of a report.
- The crash card says the report is already on its way when reports are
  on; *Kopieren* stays for a deploy without a DSN and for `?trail=1`.
- A crash is known only if the visitor comes back on the same browser —
  the share of crashes we see is a floor, not a rate. The summaries are
  the denominator: pages per device and release, against the crashes.
- The free tier counts events (crashes and problems) and spans (one per
  summary) separately; the problem cap keeps a GPU error that repeats per
  frame from spending a month's events.
- A stack trace points into minified chunks: no source maps are uploaded.
  For a killed page there is no stack anyway; the beats before it are the
  lead.

## Alternatives

- **`@sentry/browser` (or `@sentry/nextjs`)**: rejected for now. It cannot
  see the kill, which is the case that matters; it adds a third-party
  bundle (lazily loaded, it would still miss the boot), and the
  `nextjs` variant wraps the build for a server this app does not have.
  What it would add — symbolicated stacks, its own breadcrumbs — the trail
  already approximates. Revisit if uncaught errors, not kills, become the
  main problem.
- **Chrome's Reporting API** (`Reporting-Endpoints`, `crash` reports with
  reason `oom`): a useful second signal on Android, but it needs an
  endpoint that accepts `application/reports+json` (a forwarder: a server
  route, ADR 0001) and says nothing about the iPhone. Not now.
- **Opt-in per report** (plan 047's "Problem melden"): kept as the plan
  for attaching the view, which needs consent. As the only channel it
  would show a handful of crashes from the visitors patient enough to
  click — too few to tell a device class or a release apart.
- **Real-user monitoring products / analytics**: they measure page loads
  and Web Vitals, which say little about a WebGPU canvas; the frame rate
  and memory per page are what the trail already has.

## References

- `lib/city/crash-reports.ts` (+ test), `lib/city/crash-trail.ts` (+ test:
  `TrailStats`, `firsts`, `offerAsCrash`),
  `app/_components/crash-reports.ts`, `app/_components/crash-trail.ts`,
  `app/_components/crash-report.tsx`
- [ADR 0001](./0001-client-only-static-app.md) (amendment 2026-10-03),
  [plan 047](../plans/047-spike-report-a-problem.md),
  [plan 038](../plans/038-runtime-spine-fixes.md) step 3 (`offerAsCrash`)
- `docs/rendering.md`, "GPU memory on a phone"; the guide's *Using the
  viewer*, "Crash reports"
