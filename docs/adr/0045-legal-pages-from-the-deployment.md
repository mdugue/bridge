# ADR 0045: Impressum and privacy policy are pages of the deployment; the operator comes from its environment, the reports get an opt-out

- **Status:** accepted
- **Date:** 2026-10-04

## Context

The site is public, run from Germany, and since
[ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md) it sends
crash and page reports to Sentry. That makes two pages obligatory that it
did not have:

- an **Impressum** (§ 5 DDG, § 18 MStV): who runs the site, a postal
  address that takes letters, an e-mail address — reachable from every
  page;
- a **privacy policy** (Art. 13 DSGVO): every processing of personal data
  with its purpose, legal basis, recipients, third-country transfers,
  retention and the visitor's rights. Beyond the reports, the site
  processes the connection data every host sees (Vercel, in the USA), the
  browser's local storage (§ 25 TDDDG), the position and compass for
  *Standort* and *Live* (never sent), and the live bicycle counts, which
  the browser fetches from Dresden's and Hamburg's own services.

The repository is public and Apache-2.0: whoever deploys it runs their
own site, and the maintainer's postal address does not belong in git.

## Decision

**Two static pages, `/impressum` and `/datenschutz`** (`app/(legal)/`), in
German, on the Wissen pages' paper and type, linked from every page's
footer (start page, `/wissen`, the legal pages themselves) and from the
viewer's sidebar, where they open in a new tab so the walk stays
(`app/_components/legal-links.tsx`). The crash card links the reports'
section when it says a report went out.

**The operator comes from the build's environment** (`lib/legal.ts`):
`IMPRESSUM_NAME`, `IMPRESSUM_ADDRESS` (lines split by newline or comma),
`IMPRESSUM_EMAIL`, optionally `IMPRESSUM_PHONE`. A build without them
says on the page which are missing — it never shows a stranger's — and a
production build on Vercel warns in its log (`next.config.ts`). It does
not fail: a deploy that stops on a missing variable stops every other
change too.

**The privacy page describes the build it is part of.** Where the reports
go is read from the same DSN the page reports to (`reportBuild`): Sentry
by its region (`*.ingest.de.sentry.io` is its EU region, data in Germany),
any other tracker by its host, and without a DSN the section says nothing
is sent. Everything else on the page describes the code; so **a new
request to a third party, a new kind of data in a report, or a new entry
in the browser's storage is not done until `/datenschutz` says so.**

**The reports stay on by default, with an opt-out** — the legal basis is
the legitimate interest in a viewer that runs on as many devices as
possible (Art. 6 (1) f DSGVO), the device information and the trail in
local storage counted as strictly necessary for it (§ 25 (2) 2 TDDDG).
The visitor can object at any time: a switch on `/datenschutz`
(`app/_components/reports-choice.tsx`) keeps a "no" in local storage
(`app/_components/report-choice.ts`), which `crash-reports.ts` checks
before **every** report, so it holds at once in a tab already open;
Global Privacy Control still turns everything off. Every event now says
`user.ip_address: null`, Sentry's documented way to infer no address
from the request.

## Consequences

- Deploying needs the three variables (four with a phone) set on the
  host (Vercel: Project → Settings → Environment Variables, for
  Production); a fork names its own operator without touching the code.
- The Sentry project must keep *Prevent Storing of IP Addresses* on (ADR
  0043 asked for it; the page now promises it), and the policy's 90-day
  retention is the longest of Sentry's plans — a self-hosted tracker with
  a longer one needs the text changed.
- The host is named in the text (Vercel). A deployment elsewhere must
  change that section.
- The legal pages are German only, as the viewer's interface is; the
  guide's crash-report section in both languages points to them.
- The page is not legal advice. The § 25 TDDDG reading in particular —
  that the reports are strictly necessary — is contested; see the
  alternatives.

## Alternatives

- **Consent before any report (opt-in, a banner):** the safest reading of
  § 25 TDDDG, which some take to cover any reading of device properties
  that is not needed to draw the page. Not now: ADR 0043 already measured
  what opt-in costs — a handful of reports, too few to tell a device class
  or a release apart — and a banner over a canvas that is the whole page
  is the very friction the viewer avoids. The opt-out is the same
  machinery with the default flipped: `reportsDeclined()` would become
  "not yet agreed", and the switch the question.
- **The operator in the repository** (a `lib/brand.ts` constant): simpler,
  but puts a postal address into git and into every fork.
- **Failing the production build without an operator:** loud, but it
  blocks every unrelated deploy until someone sets the variables.
- **A generator or a hosted policy (an embedded third-party text):** the
  embed would load from a third party on the very page that promises not
  to; a static text describes this code exactly.

## References

- `lib/legal.ts` (+ test), `app/(legal)/`, `app/_components/legal-links.tsx`,
  `app/_components/reports-choice.tsx`, `app/_components/report-choice.ts`,
  `app/_components/crash-reports.ts` (`reportsState`),
  `lib/city/crash-reports.ts` (`user.ip_address`), `next.config.ts`
- [ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md)
  (amendment 2026-10-04), [ADR 0001](./0001-client-only-static-app.md)
- The guide's *Using the viewer*, "Crash reports" (both languages)
