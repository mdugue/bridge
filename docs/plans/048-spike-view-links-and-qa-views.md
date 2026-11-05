# Plan 048 (spike): Share a view as a link, and commit the reference views the GPU checks need

> **Executor instructions**: A **design spike with a small build**: part A
> (the link) ends in a decision note and a prototype; part B (the QA view
> catalogue) is small enough to build. Append findings under "Findings".
> Do not change the Snapshot format's meaning (ADR 0018) — only add a
> transport for it. When done, update this plan's row in
> `docs/plans/README.md` (and annotate Direction option 2 there).
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- lib/city/snapshot.ts app/_components/city-walk.tsx app/_components/scene-sidebar.tsx e2e/snapshot-shot.spec.ts .gitignore docs/adr/0018-lite-profile-for-headless-tests-real-gpu-for-visuals.md`

## Status

- **Status**: BUILT (2026-11-05) — A and B; the link is a **fragment**,
  `#snap=`, not `?snap=` (Findings, decision 1); the ADR 0018 line and
  the GPU plates wait for the maintainer.
- **Priority**: P3 (direction option, chosen by the maintainer on 2026-10-01)
- **Effort**: S–M (A: S–M, B: S)
- **Risk**: LOW
- **Depends on**: 038 step 5 (a restored view must end live mode) — do 038 first
- **Category**: direction
- **Planned at**: commit `a28de75`, 2026-10-01

## Why this matters

**A — links.** "This corner at 08:00 on 21 December in Film noir" is today
a JSON blob to copy into a text field. The Snapshot codec is versioned and
validated (`lib/city/snapshot.ts`, ADR 0018), and the viewer already
restores a Snapshot string right after its first frame — that is how a
page recovers from a lost GPU (`city-walk.tsx`, `recovery.current.restore`).
A `?snap=` parameter is a second source for the same hook; "Link kopieren"
next to *Kopieren* makes views shareable and turns the shot harness into a
`page.goto`.

**B — QA views.** Plan 019 (GPU verification) names reference views
(`shore-eye`, `seam-fly`, …) without coordinates, and eleven rows across
the plans and the transformation ledger say "look unjudged on a GPU".
`shots/` is gitignored, so every GPU session re-invents its views. A
committed `qa/views/*.json` catalogue (Snapshots) read by the shot harness
makes those checks repeatable.

## Current state

- `lib/city/snapshot.ts`: `SNAPSHOT_VERSION = 1`;
  `encodeSnapshot(look, camera, date)` → `{ v, camera, date, look }`
  (the look as percent integers + five flags); `parseSnapshot(text)` →
  `{ ok: true, snapshot } | { ok: false, reason }` (validates every field);
  `decodeLook`, `snapshotInstant`.
- `app/_components/city-walk.tsx:321-344` — the recovery hook:

  ```ts
  const recovery = useRef<{ capture: () => string | null; restore: (h: CityWalkHandle, text: string) => void } | null>(null);
  ...
      restore: (h, text) => {
        const parsed = parseSnapshot(text);
        if (!parsed.ok) { return; }
        h.applyCameraState(parsed.snapshot.camera);
        time.setInstant(snapshotInstant(parsed.snapshot));
        look.set(decodeLook(parsed.snapshot.look));
      },
  ```

  and after the first frame (`:473-478`):
  `const recovered = takeRecoverySnapshot(); if (recovered) { recovery.current?.restore(h, recovered); … }`.
- `copySnapshot` (`city-walk.tsx:535-547`) writes
  `JSON.stringify(encodeSnapshot(...), null, 2)` to the clipboard; the
  sidebar's Snapshot section (`scene-sidebar.tsx:≈923-947`) has *Kopieren*
  and *Anwenden*.
- URL parameters read today: `scene`, `gpu`, `block` (`scene-profile.ts`),
  `safety` (`lib/city/gpu-safety.ts`, ADR 0047), `trail` (`crash-report.tsx`), and
  the fragment `#at=lat,lng` (the arrival hand-off, `lib/city/geolocation.ts`
  `ARRIVAL_PARAM` — the spike should extend that read rather than add a
  parallel one). None reaches a sink beyond literal
  comparison — keep it that way: `?snap=` goes only through `parseSnapshot`.
- `e2e/snapshot-shot.spec.ts`: reads `shots/*.json`
  (`readdirSync(SHOTS_DIR).filter((f) => f.endsWith(".json"))`), renders
  each to `shots/<name>.png` (headed, full profile; `bun run shots`).
- `.gitignore:58` ignores `shots/`.
- Privacy: a Snapshot's `camera.epsg` is the camera position — after
  "Standort"/live mode, the visitor's real location. A link is shared only
  by the visitor's own action; say so next to the button.

## Part A — links (spike, then prototype)

### A1: Encoding and length

Measure: `JSON.stringify(encodeSnapshot(...))` length with every slider;
base64url of it; base64url of a compact form (e.g. drop look keys equal to
`LOOK_DEFAULTS`). Write the three lengths in "Findings". Proposal to test:
`?snap=<base64url(JSON)>` with default-valued look keys omitted (the
decoder already treats missing keys as "keep current" — check
`decodeLook`; a link should mean "defaults" for missing keys, so the
restore must reset the look to `LOOK_DEFAULTS` first, then apply).

### A2: Prototype

- `lib/city/snapshot.ts`: `snapshotToParam(snapshot): string` and
  `snapshotFromParam(param): SnapshotParse` (base64url ↔ JSON, then
  `parseSnapshot`), with unit tests (round trip, a malformed param → `ok: false`,
  an oversized param > 4 KB → rejected).
- `city-walk.tsx`: after the first frame, if there is no recovery
  Snapshot, read `?snap=` once and restore it through the same
  `recovery.current.restore` path (reset the look to defaults first).
  Leave the URL as it is (no `replaceState` loop).
- Sidebar: "Link kopieren" beside *Kopieren*: `location.origin + location.pathname + "?snap=" + snapshotToParam(...)`,
  with one line under it: "Der Link enthält den Ort der Kamera."
- E2E (whole-site shard is fine, lite profile): `page.goto("/?scene=lite&snap=…")`
  with a known Snapshot → after `ready`, `getCameraState().epsg` matches
  within 1 m.

**Verify**: `bun run verify` → exit 0; the new e2e passes.

### A3: Open questions for the maintainer (write in "Findings")

- ADR 0001 says the app persists nothing; a link is not persistence, but
  ADR 0018 (the Snapshot contract) should get a line on the URL transport
  and its version handling — write the proposed ADR text, do not merge it
  without the maintainer.
- Should a link also carry the picture style only (`?style=noir`) as a
  shorter form?

## Part B — QA view catalogue (build)

1. Create `qa/views/` with one Snapshot JSON per reference view that plan
   019 names (read `docs/plans/019-gpu-verification.md` for the list and
   what each should show). Make each from the running viewer
   (*Kopieren*), at full profile. Name files after the plan's view names.
2. `e2e/snapshot-shot.spec.ts`: also read `qa/views/*.json` (write their
   plates to `shots/qa-<name>.png`, so `shots/` stays the only output and
   stays gitignored). `bun run shots` renders both sets.
3. A bun test (e.g. `lib/city/qa-views.test.ts`) that parses every
   `qa/views/*.json` with `parseSnapshot` → all `ok` (a Snapshot format
   change then fails here, not in a GPU session).
4. Point plan 019's view list at the files, and add a short "QA views"
   paragraph to AGENTS.md's QA section.

**Verify**: `bun test lib/city/qa-views.test.ts` → pass; `bun run verify` → exit 0;
`bun run shots` on a machine with a GPU renders `shots/qa-*.png` (if no
GPU, say so).

## Findings

### 2026-11-05 — built

**Drift since `a28de75`** (54 files, +3 503/−3 327 in the check's
paths and `docs/adr/`). What moved, and what the build follows:

- `lib/city/snapshot.ts`: the look is one percent row (`fogPct`), the
  crown switch, the style and three data layers; Modell's view rides in
  `camera.model`; retired keys are ignored (`RETIRED_SNAPSHOT_KEYS`).
  ADR 0018 point 5 now calls the Snapshot "a validated contract".
- The recovery is no longer a `restore` after the first frame: plan 079
  made it a session (`app/_components/gpu-recovery.ts`) peeked before
  the boot, and `lib/city/gpu-recovery.ts` `arrivalOf` decides where a
  page starts — the snapshot's time and look before the boot, its
  camera as the boot's `initialCamera`, gated by the safety level (from
  level 2 no picture style, no Modell). The link is a second input to
  that function (`linked`), not a second restore path.
- Plan 058 moved the arrival hand-off from `?at=` to the fragment
  (`#at=`) because a query reaches the host's request log, the crash
  trail and the crash card; `arrivalOf(hash)` reads only a fragment.
- `e2e/snapshot-shot.spec.ts` gained `SHOTS_QUERY`, `SHOTS_TAG`,
  `SHOTS_SITE`, `SHOTS_AT`, `SHOTS_SMALL` and a frame-counted settle.
- Plan 019 has sections M (the phone crash fixes) and N (left by the
  plans closed on 2026-11-04); plan 038 step 5 is in
  (`applyCameraState` ends the follow), so the dependency holds.

**A1 — lengths** (a full `encodeSnapshot` of the default look, a camera
with unrounded floats; `bun` on the codec):

| Form | Characters |
|---|---|
| JSON | 352 |
| `encodeURIComponent(JSON)` | 546 |
| base64url(JSON), every key | 470 |
| base64url(JSON), default look keys dropped | 334 |
| base64url(JSON) with a Modell view | 648 |

**Decisions** (the conservative defaults the task asked for: ADRs 0001,
0043, 0054 kept — the page stays static, nothing new leaves the
browser, a link carries only view state):

1. **A fragment, not a query: `/<site>#snap=<base64url(JSON)>`.** A
   `?snap=` query is sent with the request (the host's log) and in the
   Referer, and the camera's place after *Standort*/*Live* is the
   visitor's own — exactly why plan 058 moved `?at=` to `#at=`.
   `snapshotFromHash` reads only a fragment (a `?snap=` query is not
   read at all); the crash trail keeps the query alone and the reports
   only the path (`crash-reports.ts`), so nothing of a link reaches a
   report. Nothing is stored. The privacy page says what *Link
   kopieren* puts in the clipboard and that an opened link is read only
   in the browser.
2. **The whole snapshot, as *Kopieren* writes it**, not a compact form:
   470–650 characters is short enough, and a link then means exactly
   what pasting its JSON means (missing look keys keep the current
   value) — no second meaning to define, no "defaults first" reset, no
   change to ADR 0018's contract. Over 4 KB a param is refused unread.
3. **One validator.** `snapshotFromParam` decodes base64url and hands
   the text to `parseSnapshot`; nothing else parses it (the STOP
   condition held).
4. **Recovery wins.** A snapshot waiting from a lost GPU or a
   *Qualität* reset is used over the link (a reload keeps the address);
   a place picked while loading wins over both. A link is gated by the
   safety level as a recovery is (`arrivalOf`), so a device at level 2
   does not open Modell in Comic. The trail notes `view link` (no
   position). A broken link boots at the spawn and says *Der Link
   enthält keine gültige Ansicht*.
5. **The link is the site's page without this page's query**
   (`origin + pathname + #snap=…`): `?scene=lite`, a pinned `?safety=`
   or `?trail=1` are the page's knobs, not the view's; a QA view that
   needs one says so in the index.
   **The address keeps the fragment** (no `replaceState`): a reload
   opens the view again. A new `#snap=` on a page that is already up
   (`hashchange`) is applied as *Anwenden* applies a snapshot, gated the
   same way — so the QA views can be clicked through in one tab.
6. **The QA views live in `qa/views/`** as the plan said, written by
   `scripts/qa-views.ts` from the data (no GPU here to capture them):
   places from `sites/dresden.ts` and the baked monuments, furniture,
   trees, bridges, riverside and sport tables, heights from the
   committed DGM1, `pos` in the spawn tile's frame. Their index,
   `qa/views/README.md`, gives each view what it checks and its link
   (path form: put the preview's or production's origin in front). The
   parse test is `scripts/qa-views.test.ts`, beside the generator (not
   `lib/city/`): it also holds every `pos` to its `epsg` in the site's
   frame and the index to the files.
7. `low-sun` is at **09:00**, not 07:30, on 21 December: the sun rises
   in Dresden at ≈ 08:10 that day. `seam-eye` faces east at 17:30 in
   July, so it is also section M's "tile seam with the sun behind".

**Open questions for the maintainer:**

- **ADR 0018, point 5 — proposed text** (not merged): "A Snapshot also
  travels as a view link, `/<site>#snap=<base64url of its JSON>`: in the
  fragment, never a query, so a camera's place never reaches the host;
  read through the same `parseSnapshot`, refused over 4 KB; its `v`
  handled as a pasted one's (unknown versions accepted, non-numbers
  refused). A waiting recovery wins over a link, and a link is gated by
  the safety level as a recovery is." ADR 0001 needs no change: a link
  persists nothing.
- **`?style=noir` as a short form?** Not built: it would be a second
  meaning for a link and a query the host logs. A whole snapshot in
  Film noir is ≈ 470 characters; if a short form is wanted, it should be
  `#style=` beside `#snap=`, read by the same reader.
- The QA views' poses were computed, not looked at: the first GPU
  session should fix any badly framed one in the table of
  `scripts/qa-views.ts` and write the files again.

**Verified:** `bun run verify`; the codec's units (round trip, malformed,
oversized, query not read); `arrivalOf`'s link cases; the QA view test
(and its negative control: an `epsg` moved 10 m fails two tests); e2e
*a view link* (`@desktop-render`, headless lite against a production
build). `bun run shots` on a GPU: not run (no GPU in the container).

## Done criteria

- [x] A1 measurements and the encoding decision in "Findings"
- [x] A2 prototype with unit tests + one e2e; `bun run verify` exits 0
- [x] B: `qa/views/*.json` committed, harness reads them, parse test passes
- [x] Plan 019 and AGENTS.md point to `qa/views/`

## STOP conditions

- `?snap=` would need anything beyond `parseSnapshot` to validate it →
  stop (no new parsing surface).
- A2's restore conflicts with the GPU-recovery restore (both present) →
  recovery wins; if that is not cleanly expressible, stop and report.
