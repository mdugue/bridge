# ADR 0043: Crashes, page summaries and sessions go to an error tracker, from the crash trail, only where a DSN is set

- **Status:** accepted; a per-browser opt-out and the privacy page since
  2026-10-04 ([ADR 0045](./0045-legal-pages-from-the-deployment.md))
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

The viewer sends four kinds of report, all built from the crash trail
(`lib/city/crash-reports.ts`, pure; sent by
`app/_components/crash-reports.ts`):

1. **A crash** — the previous page died in use (`offerAsCrash`: its record
   ended `running`, not on its way to a reload for a lost GPU, not the
   record iOS leaves around a recovery). Sent by the next load, once per
   record, as a fatal event grouped by renderer and how far the page got
   (`boot after <stage>`, `streaming`, `running`), with the trail's last
   events and beats as breadcrumbs. Not while that page is still open in
   another tab: every tab writes the one record key, so a second viewer
   moves the first one's live record aside; each page answers for its own
   record on a `BroadcastChannel` (`pageStillOpen`), and a record whose
   page answers is neither reported nor offered.
2. **A problem on this page** — an uncaught error or rejection, a lost
   device, a GPU error, a failed frame, a file that did not load, a
   failed boot: each kind and detail once (URLs and numbers out of the
   grouping), at most five a page.
3. **The page's summary** — a transaction each time the page leaves
   view (hidden or left), for the stretch since the last one: the time to
   the first frame and to loaded (in the stretch they fell in), the mean
   frame rate and the share of the stretch in view below 10, 20 and 30
   fps, the most memory held so far; tagged `stretch` (1 is the page's
   first, so pages are counted at `stretch:1`). The stretch a page never
   got to summarise (a killed one) is sent by the next load. The trail
   counts the beats over the whole page (`TrailStats`), not only its last
   twelve, and only beats in view after the first frame; the record
   keeps where the last summary ended (`TrailReport.sent`).
4. **The page's session** (Sentry's release health) — started `ok` with
   the page, ended `exited` when it is left, or `crashed` by the next
   load when it died in use (a page that went to the background and never
   came back ends `exited` there too); its error count is the problems
   the page noted. A page restored from the back-forward cache starts a
   new session. The crash-free rate per release is the number to watch
   — and the one a fix should move.

They go out in **Sentry's envelope protocol**, as a `sendBeacon` (a
`fetch` with `keepalive` where a beacon is refused) — **no SDK**: nothing
is loaded from the tracker, the bundle does not grow, and a beacon
outlives the page that sends it. Any tracker that takes Sentry envelopes
works (Sentry, GlitchTip, Bugsink, self-hosted or not). They go to the
site's **own origin**, `/r/e`, which a rewrite in `next.config.ts`
forwards to the DSN's envelope endpoint (`tunnelRewrites`): content
blockers (uBlock's lists, Brave's shields) drop requests to
`*.ingest.sentry.io`, and a page on its own origin is not that.

**Off unless the build has a DSN** (`NEXT_PUBLIC_SENTRY_DSN`, inlined by
`next.config.ts` as `reportBuild` read it — trimmed and checked), and off
for a visitor whose browser sends Global Privacy Control. Without a DSN the
build is exactly what it was: CI, the e2e and every deploy without one
send nothing. The console says once per load whether the reports are on,
where they go and under which release; `crashReports.test()` sends one
test event.

**One release name, derived once** (`reportBuild` in
`lib/city/crash-reports.ts`): `bridge@<commit>` from Vercel's
`VERCEL_GIT_COMMIT_SHA` (`SENTRY_RELEASE` overrides it), the environment
from `VERCEL_ENV` (`SENTRY_ENVIRONMENT` overrides it). `next.config.ts`
inlines both into the page, and **`scripts/sentry-release.ts`**, the last
step of `bun run build`, creates the release under the same name through
Sentry's REST API: its commit — by ref when the repository is connected
to the Sentry organisation, so Sentry fetches the range since the last
release itself — a deploy into the environment, and, in production, the
finalize. It needs `SENTRY_AUTH_TOKEN` (an organisation token),
`SENTRY_ORG` and `SENTRY_PROJECT` in the build's environment, skips with a
line in the log without them, and never fails a build. It runs with
`NODE_ENV=production`, so it reads the same `.env.production` as
`next build`. Nothing in the reports may stop the viewer: their start
returns nothing when anything in it throws.

**What goes out** is what the trail holds and nothing else: the path
without its query, the user agent, the screen and the device's memory,
the renderer, the events and beats (frame rates, memory, tiles, style,
walk or fly, the camera's height above the ground). No position — the
trail never had one, and the guide's promise that the location never
leaves the device stays true. No user id — a session's id names one page
load, never the visitor — and no cookie. Through the forwarding the
tracker sees the host's address rather than the visitor's, but set the
Sentry project to store none anyway (*Security & Privacy → Prevent
Storing of IP Addresses*) and pick the EU region when creating the
organisation.

## Amendment (2026-10-04): an opt-out, and the privacy page says it all

The reports are described on the site's privacy page, `/datenschutz`
([ADR 0045](./0045-legal-pages-from-the-deployment.md)), which names the
tracker and its region. A visitor can say no there:
a switch keeps the choice in local storage
(`app/_components/report-choice.ts`), and `crash-reports.ts` checks it
before every report — not only at the start — so it holds at once in a
tab already open; the console says `off: turned off in this browser`.
Every event carries `user.ip_address: null`, so Sentry infers no address
from the request. The privacy page promises that no address is stored:
keep *Prevent Storing of IP Addresses* on in the Sentry project.

## Consequences

- ADR 0001's "no analytics" now has this one exception (see its
  amendment); plan 047's "nothing leaves the device without a click" was
  written for the copied report and the view, and holds for the view:
  the Snapshot (the camera's position) is never part of a report.
- The crash card says the report is already on its way when reports are
  on; *Kopieren* stays for a deploy without a DSN and for `?trail=1`.
- A crash is known only if the visitor comes back on the same browser —
  the share of crashes we see is a floor, not a rate. With two viewer
  tabs open, the one still running keeps writing the record key, so a
  crash in the other can go unreported (never the reverse: a live tab is
  never reported as a crash). The summaries are
  the denominator: pages per device and release, against the crashes.
- The free tier counts events (crashes and problems) and spans (one per
  summary) separately; the problem cap keeps a GPU error that repeats per
  frame from spending a month's events.
- A stack trace points into minified chunks: no source maps are uploaded.
  For a killed page there is no stack anyway; the beats before it are the
  lead. Suspect commits therefore come only from the release's commits,
  not from blame on a frame.
- Sessions count only under a release: a build without a commit (a local
  one) sends events but no sessions. In development, StrictMode's second
  mount adds a short session of its own (`environment: development`).
- The project carries Sentry's agent skills (`sentry-setup-releases`,
  `sentry-debug-issue`, `sentry-create-alert` in `.agents/skills`) and its
  hosted MCP server (`.mcp.json`) for working the issues; the SDK setup
  skills are left out on purpose — there is no SDK here.

## Alternatives

- **`@sentry/browser` (or `@sentry/nextjs`)**: rejected for now. It cannot
  see the kill, which is the case that matters; it adds a third-party
  bundle (lazily loaded, it would still miss the boot), and the
  `nextjs` variant wraps the build for a server this app does not have.
  What it would add — symbolicated stacks, its own breadcrumbs — the trail
  already approximates. Revisit if uncaught errors, not kills, become the
  main problem.
- **Sending to the tracker's host directly**: what the first version did;
  blockers drop it, silently, for the very visitors on desktop most
  likely to report a problem. The forwarding is a rewrite, not a route —
  no code runs on the server.
- **`sentry-cli` for the release** (`@sentry/cli`): it downloads a native
  binary on install, which Bun runs only for a trusted dependency — on
  every install, CI's included, for a step only Vercel's build needs.
  Four REST calls do the same; `set-commits --auto` would need the git
  history Vercel's build does not have, and the connected repository
  gives Sentry the range anyway.
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
  `TrailStats`, `firsts`, `offerAsCrash`, `TrailReport`),
  `app/_components/crash-reports.ts`, `app/_components/crash-trail.ts`,
  `app/_components/crash-report.tsx`, `next.config.ts` (`env`,
  `rewrites`), `scripts/sentry-release.ts` (+ test)
- [ADR 0001](./0001-client-only-static-app.md) (amendment 2026-10-03),
  [plan 047](../plans/047-spike-report-a-problem.md),
  [plan 038](../plans/completed.md#038--five-runtime-fixes-in-the-viewers-spine--done-2026-10-03) step 3 (`offerAsCrash`, which the reports share with the card)
- `docs/rendering.md`, "GPU memory on a phone"; the guide's *Using the
  viewer*, "Crash reports"
