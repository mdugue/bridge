# Plan 048 (spike): Share a view as a link, and commit the reference views the GPU checks need

> **Executor instructions**: A **design spike with a small build**: part A
> (the link) ends in a decision note and a prototype; part B (the QA view
> catalogue) is small enough to build. Append findings under "Findings".
> Do not change the Snapshot format's meaning (ADR 0017) — only add a
> transport for it. When done, update this plan's row in
> `docs/plans/README.md` (and annotate Direction option 2 there).
>
> **Drift check (run first)**:
> `git diff --stat a28de75..HEAD -- lib/city/snapshot.ts app/_components/city-walk.tsx app/_components/scene-sidebar.tsx e2e/snapshot-shot.spec.ts .gitignore docs/adr/0017-look-controls-table-and-snapshot-contract.md`

## Status

- **Priority**: P3 (direction option, chosen by the maintainer on 2026-10-01)
- **Effort**: S–M (A: S–M, B: S)
- **Risk**: LOW
- **Depends on**: 038 step 5 (a restored view must end live mode) — do 038 first
- **Category**: direction
- **Planned at**: commit `a28de75`, 2026-10-01

## Why this matters

**A — links.** "This corner at 08:00 on 21 December in Film noir" is today
a JSON blob to copy into a text field. The Snapshot codec is versioned and
validated (`lib/city/snapshot.ts`, ADR 0017), and the viewer already
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
  `safety` (`lib/city/gpu-safety.ts`, ADR 0046), `trail` (`crash-report.tsx`), and
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
  ADR 0017 (the Snapshot contract) should get a line on the URL transport
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

(Executor: lengths from A1, decisions, open questions, the ADR 0017 draft.)

## Done criteria

- [ ] A1 measurements and the encoding decision in "Findings"
- [ ] A2 prototype with unit tests + one e2e; `bun run verify` exits 0
- [ ] B: `qa/views/*.json` committed, harness reads them, parse test passes
- [ ] Plan 019 and AGENTS.md point to `qa/views/`

## STOP conditions

- `?snap=` would need anything beyond `parseSnapshot` to validate it →
  stop (no new parsing surface).
- A2's restore conflicts with the GPU-recovery restore (both present) →
  recovery wins; if that is not cleanly expressible, stop and report.
