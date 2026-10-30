# ADR 0043: Crash and page reports go to an error tracker without an SDK, and the privacy page says what the code does

- **Status:** accepted
- **Date:** 2026-10

## Context

Phones kill the page without warning, and a killed page runs no handler.
The maintainer needs to know which devices and releases crash, without
tracking visitors. A site in Germany needs an Impressum and a privacy
policy that are true for this code.

## Decision

1. **The crash trail** (local storage) records each page's boot stages,
   errors, lost device and heartbeats. The next load reports a page that
   died in use, and offers the trail as text to copy (`?trail=1` always).
2. **Four kinds of report**, built from the trail
   (`lib/city/crash-reports.ts`): a crash, a problem on this page (capped),
   a summary per stretch in view (frame rates, memory, boot times) and a
   session for the crash-free rate per release.
3. **Sentry's envelope protocol in beacons, no SDK**, to the site's own
   origin (`/r/e`), which a rewrite forwards to the tracker. Any tracker
   that takes envelopes works.
4. **Off unless the build has a DSN**, off with Global Privacy Control,
   and off for a browser whose visitor said no on `/datenschutz` — checked
   before every report. No position, no user id, no cookie, no IP stored.
5. **One release name** per build (`bridge@<commit>`), created with its
   commit and deploy by `scripts/sentry-release.ts`; never fails a build.
6. **Impressum and privacy policy are static MDX pages**
   (`app/(legal)/`), linked from every footer and the sidebar. The privacy
   page describes exactly what this deployment does: **a new request to a
   third party, a new field in a report or a new key in the browser's
   storage is not done until `datenschutz/page.mdx` says so.**
7. **Reports are on by default with an opt-out**, on the legitimate
   interest in a viewer that runs on as many devices as possible.

## Consequences

- Reports never stop the viewer; their start returns nothing when anything
  in it throws.
- Every report carries the device's safety level (ADR 0047); a page's
  aftermath (after its render stopped, while it leaves) stays a breadcrumb.
- The Sentry skills and MCP server work the issues; the SDK they would
  set up is never added.

## Alternatives

- **`@sentry/browser` or `@sentry/nextjs`:** cannot see the kill, adds a
  third-party bundle, and wraps a build for a server this app lacks.
- **Sending to the tracker's host directly:** content blockers drop it.
- **`sentry-cli`:** a native binary on every install for one build step.
- **Opt-in per report or a consent banner:** a handful of reports, too few
  to tell devices apart, and a banner over a canvas that is the page.
- **A hosted or generated policy:** loads a third party on the very page
  that promises not to.
