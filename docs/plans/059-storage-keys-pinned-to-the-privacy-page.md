# Plan 059: One table of the browser's storage keys, a test that the privacy page names each, and tests for the reports' "no"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- app/_components/report-choice.ts app/_components/crash-reports.ts app/_components/crash-trail.ts app/_components/style-memory.ts app/_components/hud-toolbar.tsx app/_components/control-hints.tsx app/_components/gpu-safety.ts app/_components/gpu-recovery.ts "app/(legal)/datenschutz/page.mdx" lib/city/bike-feeds.ts lib/city/bike-counts.ts`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (independent of 058; both edit the privacy page in
  different sections — merge in either order)
- **Category**: tests (privacy)
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

ADR 0045 makes the privacy page part of the code: "a new key in the
browser's storage is not done until that page says so", and the same for
every request the browser makes to a third party. Today that rule is
enforced by a reviewer's eye alone, and it has already slipped once: the
code writes ten local/session-storage keys in eight files, the page
describes nine of them, and `crash-trail.reported` (the start time of the
last previous record that was reported, `app/_components/crash-reports.ts:53`)
is not mentioned. The reports' opt-out itself — the switch on
`/datenschutz`, `reportsDeclined()` checked before every beacon, the
in-memory "no" for a browser that keeps nothing — has **no test at any
layer**: `lib/city/crash-reports.test.ts` (590 lines) stops at the
envelope bytes, `app/_components/report-choice.ts` has no test file, and
CI builds without a DSN so no e2e page ever sends. A regression that moved
the `declined` check below the beacon would send reports a visitor
refused, and nothing would notice.

This plan adds (1) one `storage-keys.ts` table every writer imports its
key from, (2) a unit test that each key's literal name and each live-feed
host appears in the privacy page's text, with the page amended to name
the keys literally (it names `gpu-safety` that way already), and (3) unit
tests for `report-choice.ts` and for the sender's gate in
`crash-reports.ts`. No behaviour changes.

## Current state

The ten keys and where they are written (all `localStorage` unless noted):

| Key | File:line (constant) | Purpose |
|---|---|---|
| `bildstil` | `app/_components/style-memory.ts:10` `STYLE_KEY` | the last picture style |
| `city-walk:hints-dismissed` | `app/_components/control-hints.tsx:83` `DISMISSED_KEY` | the control hints closed |
| `city-walk:model-hints-dismissed` | `app/_components/control-hints.tsx:85` `MODEL_DISMISSED_KEY` | Modell's hints closed |
| `hud-toolbar-collapsed` | `app/_components/hud-toolbar.tsx:13` `COLLAPSED_KEY` | the toolbar folded |
| `crash-trail` | `app/_components/crash-trail.ts:30` `CURRENT_KEY` | this page's record |
| `crash-trail.previous` | `app/_components/crash-trail.ts:39` `PREVIOUS_KEY` | the previous page's record |
| `crash-trail.reported` | `app/_components/crash-reports.ts:53` `REPORTED_KEY` | which previous record was reported — **not on the page** |
| `crash-reports.declined` | `app/_components/report-choice.ts:12` `DECLINED_KEY` | the visitor's "no" |
| `gpu-safety` | `app/_components/gpu-safety.ts:24` `KEY` | the device's safety level (ADR 0046) |
| `gpu-recovery` (**session** storage) | `app/_components/gpu-recovery.ts:28` `KEY` | the view a GPU recovery returns to |

The two live-feed hosts (ADR 0040): `lib/city/bike-counts.ts:18`
`CITY_WFS = "https://kommisdd.dresden.de/net3/public/ogcsl.ashx"` and
`lib/city/bike-feeds.ts:37` `HAMBURG_STA = "https://iot.hamburg.de/v1.1/Datastreams"`.

`app/(legal)/datenschutz/page.mdx:113-134` ("Was in deinem Browser
bleibt") lists, in prose: the last picture style; the hints closed and the
toolbar folded; "den Verlauf des laufenden und des vorigen Besuchs"; the
reports choice; the recovery's place and time (session); and
`` `gpu-safety` `` by name. Lines 150–170 name the live feeds' hosts
(`kommisdd.dresden.de`, `iot.hamburg.de`) in the data-layers section —
confirm by reading the page; the test in step 3 will tell you.

`app/_components/report-choice.ts` (whole file, 66 lines) — the
functions `reportsDeclined()`, `setReportsDeclined(declined)` (returns
`false` when storage throws, keeping the "no" in the module variable
`declinedHere`), `reportsState()` (`"on" | "no-dsn" | "gpc" | "declined"`;
`HAS_DSN` is read from `process.env.CRASH_REPORTS_DSN` at module load).

`app/_components/crash-reports.ts:90-110` — the gate:

```ts
function post(body: string): void {
  // Said no since the page started (on /datenschutz, maybe in another
  // tab): nothing goes out after a no — the session's end included, so
  // Sentry closes that session itself.
  if (reportsDeclined()) {
    return;
  }
  try {
    // A string goes as text/plain: no preflight, which a beacon cannot make.
    if (navigator.sendBeacon(TUNNEL_PATH, body)) {
      return;
    }
  } catch {
    // No beacon (or refused): the fetch below.
  }
  fetch(TUNNEL_PATH, { method: "POST", body, keepalive: true }).catch(() => {
    // Lost: a report is never worth an error of its own.
  });
}
```

`post` is module-private; the public surface is `startCrashReports()` and
`crashReportsOn()`. `DSN` is read at module load (`:49`), so a test must
set `process.env.CRASH_REPORTS_DSN` **before** a dynamic
`await import("./crash-reports")`.

The fake-storage pattern this repo uses (`app/_components/style-memory.test.ts:1-18`):

```ts
import { afterEach, expect, test } from "bun:test";
import { readStoredStyle, writeStoredStyle } from "./style-memory";

const globals = globalThis as { localStorage?: unknown };
const original = globals.localStorage;

function fakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  globals.localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
  };
  return map;
}

afterEach(() => {
  globals.localStorage = original;
});
```

The "a doc names what the code has" pattern (`lib/docs/guide-labels.test.ts`):
read the Markdown with `readFileSync`, collapse whitespace, assert every
label is a substring.

Conventions: TypeScript strict; `lib/city` stays DOM-free (the table lives
in `app/_components/`); tests are `bun:test` beside the module; no
behaviour change in this plan; Conventional Commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Format + autofix | `bun run fix` | exit 0 |
| Targeted tests | `bun test app/_components/storage-keys.test.ts app/_components/report-choice.test.ts app/_components/crash-reports.test.ts` | pass |
| The gate | `bun run verify` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `app/_components/storage-keys.ts` (create), `app/_components/storage-keys.test.ts` (create)
- The eight key writers listed above (import their key from the table; nothing else)
- `app/_components/report-choice.test.ts` (create)
- `app/_components/crash-reports.test.ts` (create)
- `app/(legal)/datenschutz/page.mdx` (the storage section: name the keys literally; the trail bullet: the reported marker)

**Out of scope** (do NOT touch, even though they look related):
- `lib/city/crash-reports.ts` and its test — the envelopes are covered.
- The wrappers' try/catch bodies — leave each file's reading/writing as it
  is; this plan moves the *names*, not the accessors (a shared accessor is
  backlog item "browser-store", not this plan).
- `e2e/legal.spec.ts` — an e2e over the switch needs a DSN in CI's build;
  deferred (see Maintenance notes).
- `docs/adr/0001-client-only-static-app.md` — its storage list is plan 065's.

## Git workflow

- Branch: the branch you were given, or `plan/059-storage-keys`.
- Commits per step, Conventional Commits, lowercase subject, e.g.
  `test(privacy): the storage keys in one table, each named on /datenschutz`,
  `test(reports): the visitor's no and the sender's gate`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The table

Create `app/_components/storage-keys.ts`:

```ts
/**
 * Every key the viewer keeps in the browser's storage (ADR 0045: the
 * privacy page, app/(legal)/datenschutz/page.mdx, names each one; its
 * test holds it to that). A new key is added here first.
 */
export const STORAGE_KEYS = {
  /** the last picture style (style-memory.ts) */
  style: "bildstil",
  /** the control hints closed (control-hints.tsx) */
  hintsDismissed: "city-walk:hints-dismissed",
  /** Modell's hints closed (control-hints.tsx) */
  modelHintsDismissed: "city-walk:model-hints-dismissed",
  /** the toolbar folded (hud-toolbar.tsx) */
  toolbarCollapsed: "hud-toolbar-collapsed",
  /** this page's crash trail (crash-trail.ts) */
  trail: "crash-trail",
  /** the previous page's trail (crash-trail.ts) */
  trailPrevious: "crash-trail.previous",
  /** which previous trail was reported (crash-reports.ts) */
  trailReported: "crash-trail.reported",
  /** the visitor's "no" to the reports (report-choice.ts) */
  reportsDeclined: "crash-reports.declined",
  /** the device's safety level (gpu-safety.ts, ADR 0046) */
  gpuSafety: "gpu-safety",
} as const;

/** Session storage: gone with the tab. */
export const SESSION_KEYS = {
  /** the view a GPU recovery returns to (gpu-recovery.ts) */
  gpuRecovery: "gpu-recovery",
} as const;
```

Then, in each of the eight writers, replace the local literal with the
table's entry — e.g. in `style-memory.ts`:
`const STYLE_KEY = STORAGE_KEYS.style;` (keep the local constant name so
nothing else in the file changes), and likewise `DISMISSED_KEY`,
`MODEL_DISMISSED_KEY`, `COLLAPSED_KEY`, `CURRENT_KEY`, `PREVIOUS_KEY`,
`REPORTED_KEY`, `DECLINED_KEY`, `KEY` (gpu-safety → `STORAGE_KEYS.gpuSafety`),
`KEY` (gpu-recovery → `SESSION_KEYS.gpuRecovery`).

**Verify**: `bun typecheck` → exit 0;
`grep -rn '"bildstil"\|"city-walk:hints-dismissed"\|"city-walk:model-hints-dismissed"\|"hud-toolbar-collapsed"\|"crash-trail"\|"crash-trail.previous"\|"crash-trail.reported"\|"crash-reports.declined"\|"gpu-safety"\|"gpu-recovery"' app lib --include=*.ts --include=*.tsx | grep -v "storage-keys.ts\|\.test\."`
→ **no match** (every literal lives in the table now; tests may keep literals).

### Step 2: The privacy page names each key

In `app/(legal)/datenschutz/page.mdx`, section "Was in deinem Browser
bleibt", name the keys the way `gpu-safety` already is — in backticks
inside the existing bullets, e.g.:

- "den zuletzt gewählten Bildstil (`bildstil`),"
- "ob du die Bedienhinweise geschlossen (`city-walk:hints-dismissed`,
  `city-walk:model-hints-dismissed`) und die Werkzeugleiste eingeklappt
  hast (`hud-toolbar-collapsed`),"
- "den Verlauf des laufenden und des vorigen Besuchs (`crash-trail`,
  `crash-trail.previous`) und ob der vorige schon gemeldet wurde
  (`crash-trail.reported`; siehe [Fehlerberichte](#fehlerberichte)),"
- "deine Wahl zu den Fehlerberichten (`crash-reports.declined`),"
- the recovery bullet gains "(`gpu-recovery`, im Session Storage)".

Keep the prose otherwise as it is.

**Verify**: `grep -c "crash-trail.reported" "app/(legal)/datenschutz/page.mdx"` → `1`.

### Step 3: The test that holds the page to the table

Create `app/_components/storage-keys.test.ts`:

```ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HAMBURG_STA } from "@/lib/city/bike-feeds";
import { CITY_WFS } from "@/lib/city/bike-counts";
import { SESSION_KEYS, STORAGE_KEYS } from "./storage-keys";

const PAGE = readFileSync(
  join(import.meta.dir, "../(legal)/datenschutz/page.mdx"),
  "utf8"
);

test("the privacy page names every key the viewer keeps in the browser", () => {
  const missing = [...Object.values(STORAGE_KEYS), ...Object.values(SESSION_KEYS)]
    .filter((key) => !PAGE.includes(`\`${key}\``));
  expect(missing).toEqual([]);
});

test("the privacy page names every host the viewer reads live", () => {
  const hosts = [CITY_WFS, HAMBURG_STA].map((url) => new URL(url).host);
  expect(hosts.filter((host) => !PAGE.includes(host))).toEqual([]);
});
```

If the hosts test fails because the page names a host differently (e.g.
a parent domain), read the page's data-layers section and adjust the
**page** to name the exact host, not the test.

**Verify**: `bun test app/_components/storage-keys.test.ts` → 2 pass.

### Step 4: `report-choice.ts` tests

Create `app/_components/report-choice.test.ts` with the fake-storage
pattern above (note: `report-choice.ts` also calls `localStorage.removeItem`
— add `removeItem: (key) => void map.delete(key)` to the fake). Cases:

1. **default**: `reportsDeclined()` is `false` with an empty storage.
2. **a no is kept**: `setReportsDeclined(true)` returns `true`, the map has
   `crash-reports.declined` = `"1"`, `reportsDeclined()` is `true`;
   `setReportsDeclined(false)` removes it.
3. **a no without storage**: replace the fake with one whose `setItem`
   throws; `setReportsDeclined(true)` returns `false` and `reportsDeclined()`
   is still `true` (the in-memory "no"); then `setReportsDeclined(false)`
   → `reportsDeclined()` is `false` (reset the module's `declinedHere`
   between cases this way, since it is module state).
4. **`reportsState()`**: with no DSN in the environment it is `"no-dsn"`
   whatever the storage says. (A DSN case needs a module re-import — covered
   in step 5 through the sender.) Set `globalThis.navigator` to
   `{ globalPrivacyControl: undefined }` for this test if `navigator` is
   undefined under Bun — check with `typeof navigator` first and skip the
   GPC branch if it cannot be modelled.

**Verify**: `bun test app/_components/report-choice.test.ts` → pass.

### Step 5: The sender's gate

Create `app/_components/crash-reports.test.ts`. Model the environment,
then import the module dynamically so its module-level `DSN` sees it:

```ts
import { afterEach, beforeEach, expect, test } from "bun:test";

const g = globalThis as Record<string, unknown>;
const saved = { localStorage: g.localStorage, navigator: g.navigator, fetch: g.fetch };
let beacons: string[] = [];

beforeEach(() => {
  beacons = [];
  const map = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  };
  g.navigator = { sendBeacon: (_url: string, body: string) => (beacons.push(body), true), userAgent: "test", onLine: true };
  g.fetch = () => Promise.resolve(new Response(null, { status: 200 }));
  process.env.CRASH_REPORTS_DSN = "https://abc123@o1.ingest.de.sentry.io/42";
});

afterEach(() => {
  Object.assign(g, saved);
  delete process.env.CRASH_REPORTS_DSN;
});
```

Then two tests that reach `post` through the public surface. Read
`startCrashReports()` (`app/_components/crash-reports.ts`, the function
after `reportPrevious`) to see what it needs: it returns a `TrailListener`
which `startCrashTrail` calls with `(event, trail)`; the listener sends a
problem report for an event whose `kind` is in `PROBLEM_KINDS` (e.g.
`"error"`) once `begin(trail, ctx)` ran on a `"start"` event. Build a
minimal `Trail` with `createTrail` from `lib/city/crash-trail.ts` (it is
pure) and drive the listener with a `"start"` event followed by an
`"error"` event:

1. **reports on**: one beacon arrives at `TUNNEL_PATH` (the body is a
   Sentry envelope: `expect(beacons[0]).toContain('"type":"event"')` or
   whatever `lib/city/crash-reports.test.ts` asserts for a problem report —
   mirror its check).
2. **declined**: with `setReportsDeclined(true)` (import from
   `./report-choice`) before the events, `beacons` stays empty.

If `startCrashReports` needs more of the DOM than the fake provides
(`document`, `window.addEventListener`), add the minimal stubs to the
`beforeEach`; if it needs the real viewer, STOP (see below).

**Verify**: `bun test app/_components/crash-reports.test.ts` → 2 pass.

### Step 6: The gate

`bun run fix && bun run verify` → exit 0.

## Test plan

- `storage-keys.test.ts`: the page names every key and every live host.
- `report-choice.test.ts`: default, kept, kept-in-memory, reset, no-DSN state.
- `crash-reports.test.ts`: a report goes out when on, none after a no.
- Verification: `bun run verify` → all pass, five+ new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `app/_components/storage-keys.ts` exports `STORAGE_KEYS` (9 keys) and `SESSION_KEYS` (1 key)
- [ ] the literal grep in step 1 returns no match outside the table and tests
- [ ] `bun test app/_components/storage-keys.test.ts app/_components/report-choice.test.ts app/_components/crash-reports.test.ts` passes
- [ ] `grep -c "crash-trail.reported" "app/(legal)/datenschutz/page.mdx"` ≥ 1
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 059 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A writer keeps its key under a different access pattern than
  `localStorage.getItem/setItem/removeItem` (then the table may not fit —
  report which file).
- `startCrashReports()` cannot run under Bun with small stubs (needs
  `document`/`window` deeply) — report what it touches; the fallback is to
  export `post` for tests behind a comment, which a reviewer must approve.
- The privacy page names a host by a different domain than the code's URL
  (adjust the page, not the test — but if the host in the code is not what
  the page should say, report it).
- Any existing test fails after step 1 (a test may have asserted the
  literal; update the test to import the table).

## Maintenance notes

- Adding a key: add it to `STORAGE_KEYS` with a one-line purpose, name it
  on `/datenschutz` in backticks, and the test stays green. Adding a live
  host: name it on the page (the hosts test) — plan 053's weather and gauge
  feeds are the next ones.
- A shared try-wrapped accessor (`browser-store.ts`) replacing the eight
  hand-rolled wrappers is a separate, optional move (backlog); the table
  is what makes it easy.
- An e2e that toggles the switch and counts `/r/e` requests needs CI's
  build to carry a dummy `NEXT_PUBLIC_SENTRY_DSN`; deferred until the
  maintainer wants the e2e half to exercise the reports.
- Reviewer: the crash-reports test's first assertion must check the body
  is an envelope, not merely that a beacon was sent.
