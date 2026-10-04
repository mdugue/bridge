# ADR 0045: Impressum and privacy policy are MDX pages of the site; the reports get an opt-out

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

## Decision

**Two static pages, `/impressum` and `/datenschutz`, that are MDX files**
(`app/(legal)/impressum/page.mdx`, `app/(legal)/datenschutz/page.mdx`):
Next.js compiles them itself through `@next/mdx` (`pageExtensions` and
`createMDX` in `next.config.ts`, the required `mdx-components.tsx` at the
root), with their `metadata` exported from the file. They are excluded
from oxfmt like all Markdown (`.oxfmtrc.json`): it would rewrite them as
Markdown and break the MDX. German, on the Wissen pages' paper and type,
linked from every page's footer (start page, `/wissen`, the legal pages
themselves) and from the viewer's sidebar, where they open in a new tab so
the walk stays (`app/_components/legal-links.tsx`). The crash card links
the reports' section when it says a report went out.

**The operator's details are written into the MDX**, as on the
maintainer's own site (manuel.fyi): name, address, e-mail, VAT id.

**The privacy page describes what the code does**, for this deployment:
Vercel as the host, Sentry's EU region as where the reports are kept. So
**a new request to a third party, a new kind of data in a report, or a new
entry in the browser's storage is not done until
`datenschutz/page.mdx` says so.**

**The reports stay on by default, with an opt-out** — the legal basis is
the legitimate interest in a viewer that runs on as many devices as
possible (Art. 6 (1) f DSGVO), the device information and the trail in
local storage counted as strictly necessary for it (§ 25 (2) 2 TDDDG).
The visitor can object at any time: a switch on `/datenschutz`
(`app/_components/reports-choice.tsx`, imported and placed in the MDX as
`<ReportsChoice />`) keeps a "no" in
local storage (`app/_components/report-choice.ts`), which
`crash-reports.ts` checks before **every** report, so it holds at once in
a tab already open; Global Privacy Control still turns everything off. The
switch also says when a build has no DSN. Without storage (blocked site
data) the "no" holds for the tab, in memory — the reports run without
storage too. Every event now names its sender with
`sdk.settings.infer_ip: "never"`: Relay's legacy rule otherwise derives
the address from the request for every `javascript` event that names
none, and treats `user.ip_address: null` the same as `{{auto}}`
(`relay-event-schema`, `AutoInferSetting`).

## Consequences

- Changing the operator, the host or the tracker's region means editing
  the MDX; a fork that deploys the code edits both files.
- The Sentry project must keep *Prevent Storing of IP Addresses* on (ADR
  0043 asked for it; the page now promises it), and the policy's 90-day
  retention is the longest of Sentry's plans.
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
- **The operator from the build's environment** (`IMPRESSUM_*` variables,
  the first version of this change): keeps the address out of git and
  lets a fork name itself without an edit, but the address is public on
  the site anyway, and a missing variable silently ships an Impressum
  that names nobody. The maintainer chose the plain text.
- **The pages as TSX, or as Markdown read by a TSX page** through the
  Wissen pages' remark/rehype chain (the second version of this change):
  TSX buries the legal text in markup; the reader is a page and a
  renderer for what Next.js does itself with `@next/mdx`, and needed a
  custom element for the switch. MDX costs `@next/mdx`, `@mdx-js/loader`,
  `@mdx-js/react` and `@types/mdx` — small, and Next's own.
- **A generator or a hosted policy (an embedded third-party text):** the
  embed would load from a third party on the very page that promises not
  to; a static text describes this code exactly.

## References

- `app/(legal)/` (the two `page.mdx`, the layout), `mdx-components.tsx`,
  `next.config.ts` (`pageExtensions`, `createMDX`),
  `app/_components/legal-links.tsx`,
  `app/_components/reports-choice.tsx`, `app/_components/report-choice.ts`,
  `app/_components/crash-reports.ts` (`reportsState`),
  `lib/city/crash-reports.ts` (`SDK`), `e2e/legal.spec.ts`
- [ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md)
  (amendment 2026-10-04), [ADR 0001](./0001-client-only-static-app.md)
- The guide's *Using the viewer*, "Crash reports" (both languages)
