# Plan 047 (spike): "Problem melden" — the crash report with somewhere to go

> **Executor instructions**: This is a **design spike**, not a build plan.
> Its deliverable is a short decision note (appended to this file under
> "Findings") plus, if the gate in step 3 passes, a small prototype on a
> branch. Do not merge a prototype without the maintainer's answer to the
> open questions. Honour the privacy constraints below — they are not
> optional. When done, update this plan's row in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- app/_components/crash-report.tsx lib/city/crash-trail.ts app/_components/crash-trail.ts lib/docs/routes.ts docs/adr/0001-client-only-static-app.md docs/guide`

## Status

- **Priority**: P3 (direction option, chosen by the maintainer on 2026-10-01)
- **Effort**: S (spike) → S (build)
- **Risk**: LOW technically; MED for privacy if done carelessly
- **Depends on**: 038 step 3 (the crash panel's offer logic) — do 038 first
- **Category**: direction
- **Planned at**: commit `a28de75`, 2026-10-01

> **2026-10-03:** [ADR 0043](../adr/0043-crash-and-page-reports-to-an-error-tracker.md)
> sends the crash trail (never the view) to an error tracker on its own
> where the build has a DSN, and the card says so. This spike's question
> is now the **view on opt-in** and the destination for a deploy without
> a DSN; `offerAsCrash` (plan 038 step 3) is in place.

## Why this matters

The 2026-09-28…30 memory work was driven by iPhone crashes only the
maintainer saw. Since then the viewer keeps a **crash trail** (boot
stages, errors, a lost device, heartbeats with frame rate, GPU and heap
estimates) and offers it on the next load — but the panel says
"Kopiere den Bericht und schick ihn weiter" without saying *where*, and no
guide page mentions it. A visitor who hits a crash has no way to close the
loop. A "Problem melden" action that opens a prefilled report (the trail,
and — only if the visitor agrees — the view as a Snapshot) would turn a
visitor's crash into a reproducible case for `bun run shots`, while the
site stays a static app with no backend (ADR 0001).

## Current state

`app/_components/crash-report.tsx` (`CrashReport`): shown when the previous
page died in use (or always with `?trail=1`); a read-only `Textarea` with
`formatTrail(trail)`, buttons *Schließen* and *Kopieren*:

```tsx
      <p className="text-muted-foreground text-xs">
        Kopiere den Bericht und schick ihn weiter — er hilft, den Absturz zu
        finden.
      </p>
```

`lib/city/crash-trail.ts`: `Trail` holds `startedAt`, `url` (path and
query), `userAgent`, `backend`, `screen`, `events` (≤ 40, `{ t, kind, detail? }`)
and `beats` (≤ 12: frames, fps, gpuMB, heldMB, calls, triangles, heapMB,
cities, dressings, style, mode, heightM) — **no coordinates**.
`formatTrail(trail)` renders it as text (a few KB).

`lib/docs/routes.ts:17`: `export const REPO_URL = "https://github.com/mdugue/bridge";`
`lib/brand.ts`: `SUPPORT_URL` — the pattern for an outbound link: a plain
`<a>`, nothing loaded from the other site until it is clicked.

`lib/city/snapshot.ts` `encodeSnapshot(look, camera, date)` → `{ v, camera, date, look }`;
`camera.epsg` is the position. After "Standort" (locate me) or live mode,
that position **is the visitor's real location**. The user guide promises
"the location never leaves the device" (`docs/guide/en/using-the-viewer.md`
≈ :76, DE ≈ :81).

`docs/adr/0001-client-only-static-app.md`: no backend, no stateful API
routes.

## Privacy constraints (hard)

1. Nothing leaves the device without an explicit click, and the visitor
   sees the exact text before it is sent.
2. The Snapshot (position) is **off by default** and offered as a separate,
   clearly labelled opt-in ("Ansicht mitsenden — enthält den Ort der
   Kamera"). If locate-me or live mode was used in the crashed session (the
   trail can record that as an event — add one if it does not), say so next
   to the checkbox.
3. The destination must be stated before the click ("öffnet ein
   öffentliches GitHub-Issue" or "öffnet dein E-Mail-Programm").
4. The guide's "the location never leaves the device" stays true or is
   reworded in both languages to "… unless you choose to attach your view
   to a problem report".

## Steps

### Step 1: Destinations — evaluate and write down

Compare, in the "Findings" section of this file:
- **GitHub issue** prefilled: `${REPO_URL}/issues/new?title=…&body=…`
  (check GitHub's documented query parameters; measure the maximum
  practical URL length — browsers ~32 k+, GitHub's limit is lower: try
  bodies of 4, 8 and 16 KB). Needs a GitHub account; the issue is
  **public**.
- **mailto:** to an address the maintainer chooses (do not invent one —
  leave a placeholder and list it as an open question); body length
  limits of common mail clients (~2 KB safe).
- **Copy + link to a short page** in `/wissen` explaining where to send it.

### Step 2: Size the report

Measure `formatTrail` output for a realistic trail (run `bun dev`, use the
viewer for a minute, `window.crashTrail.current()` in the console, count
bytes; then with `?trail=1` on the next load). Decide what to trim for the
chosen destination (e.g. beats to the last 6) — a pure function
`reportBody(trail, snapshot?)` in `lib/city/crash-trail.ts` with tests.

### Step 3: Gate — the maintainer's answers

Write the open questions into "Findings" and stop for the maintainer:
- GitHub issues (public) or e-mail (which address)?
- Is a GitHub issue template wanted (`.github/ISSUE_TEMPLATE/crash.md`)?
- Should the HUD's *Erweitert* tab also offer "Problem melden" without a
  crash (with `?trail=1`'s current trail)?

### Step 4 (only after the answers): Prototype

- `reportBody` + tests (lengths, trimming, the snapshot only when opted in).
- In `crash-report.tsx`: a "Problem melden" link (`<a target="_blank"
  rel="noopener noreferrer">`) with the prefilled URL, the opt-in
  checkbox, and the destination sentence; keep *Kopieren*.
- Guide paragraph in both languages (`docs/guide/{en,de}/using-the-viewer.md`)
  on the crash panel and the report; a line in `docs/rendering.md` next to
  the GPU recovery; an amendment line in ADR 0001 listing what the page
  stores locally (crash trail ring, style memory, toolbar fold, the
  recovery Snapshot in session storage).
- `bun run verify` → exit 0; the guide-label test from plan 037 passes.

## Findings

(Executor: write the comparison, measurements and open questions here.)

## Done criteria (spike)

- [ ] "Findings" has the destination comparison with measured URL limits
- [ ] `formatTrail` sizes measured; trimming rule proposed
- [ ] Open questions listed for the maintainer
- [ ] (After answers) prototype on a branch with tests; privacy constraints 1–4 met

## STOP conditions

- Any design that sends data without a click, or includes the position by
  default → do not build it.
- The maintainer has not answered step 3 → stop after step 3.
