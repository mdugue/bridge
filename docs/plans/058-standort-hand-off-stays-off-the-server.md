# Plan 058: The jump to another city carries the visitor's position in the URL fragment, never in a request or the crash trail — the privacy page's "never leaves your device" holds again

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- lib/city/geolocation.ts lib/city/geolocation.test.ts app/_components/city-walk.tsx app/_components/locate-button.tsx app/_components/locate-offsite-dialog.tsx app/_components/crash-trail.ts app/_components/crash-trail.test.ts lib/city/crash-reports.ts "app/(legal)/datenschutz/page.mdx" docs/guide/en/using-the-viewer.md docs/guide/de/using-the-viewer.md AGENTS.md`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (privacy)
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

The privacy page (`/datenschutz`, which ADR 0045 makes part of the code)
says "Dein Standort verlässt dein Gerät nie" and, under *Standort und
Kompass*, "nie an mich oder Dritte gesendet; auch die Fehlerberichte
enthalten es nicht". The guide repeats it in both languages, and
`lib/city/crash-reports.ts` carries "no position (the trail has none)".
One flow contradicts all of them: when *Standort* finds the visitor in
another city this deployment serves, the off-site dialog offers a plain
link `/<site>?at=<lat>,<lng>` with six decimals (about 0.1 m). Following
it:

1. sends the position to the host in the request line of a full document
   request (the page itself states the host logs the requested address),
   and in the `Referer` of every request the new page makes until its
   first frame;
2. stores it in local storage: the crash trail records
   `location.pathname + location.search` at `note("start")`, which runs at
   mount, while the parameter is stripped from the URL only at the first
   frame (`arriveAt`);
3. offers it for pasting: the crash card prints the trail with
   `url …?at=…` and invites the visitor to copy and send it on.

The automatic reports are **not** affected (`path()` in
`lib/city/crash-reports.ts` drops the query), and nothing else reads the
parameter. The fix: carry the fix in the URL **fragment** (`#at=lat,lng`
— a fragment is never sent to a server nor in a `Referer`, and the trail
stores `location.search`, not the hash), drop it with `replaceState` as
today, and — as defence in depth — let the trail keep only the known QA
parameters of the query, never the whole string. Then say so on the
privacy page and in the guide.

## Current state

- `lib/city/geolocation.ts` — the pure half: `ARRIVAL_PARAM`,
  `arrivalHref(siteId, fix)`, `arrivalOf(search)` (lines 185–209).
- `lib/city/geolocation.test.ts:166-176` — their test.
- `app/_components/locate-button.tsx:98` — builds the link:
  `elsewhere: { href: arrivalHref(there.id, fix), site: there }`.
- `app/_components/locate-offsite-dialog.tsx:72-79` — renders it as a plain
  `<a href={shown.elsewhere.href}>` ("Nach … springen").
- `app/_components/city-walk.tsx:337-369` — `arriveAt(h, site, say)` reads
  `arrivalOf(location.search)`, strips the parameter, places the player;
  called at `:715` after the first frame. The crash trail starts at
  `:548` (`startCrashTrail(…)`), i.e. at mount, before that.
- `app/_components/crash-trail.ts:183-197` — `startCrashTrail` records
  `url: location.pathname + location.search`.
- `lib/city/crash-trail.ts:534` — `formatTrail` prints `url ${trail.url}`;
  `app/_components/crash-report.tsx` offers that text to copy.
- `app/(legal)/datenschutz/page.mdx:23` and `:140-148` — the two claims.
- `docs/guide/en/using-the-viewer.md:112-114`, `docs/guide/de/using-the-viewer.md:119-120`
  — "the location never leaves the device — not even in a crash report".
- `AGENTS.md` "QA: self-verify" — lists the URL knobs (`?scene`, `?gpu`,
  `?safety`, `?trail`); `?at` is listed nowhere (docs finding).

`lib/city/geolocation.ts:185-209` today:

```ts
/** The query that hands a fix to another site's page (`?at=lat,lng`). */
export const ARRIVAL_PARAM = "at";

/** `/<site>?at=lat,lng`: the other site's page, told where the player is. */
export function arrivalHref(
  siteId: string,
  fix: Pick<GeoFix, "lat" | "lng">
): string {
  return `/${siteId}?${ARRIVAL_PARAM}=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}`;
}

/** The fix a page was opened with (`?at=lat,lng`), or null. */
export function arrivalOf(search: string): Pick<GeoFix, "lat" | "lng"> | null {
  const value = new URLSearchParams(search).get(ARRIVAL_PARAM);
  const m = value?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!m) {
    return null;
  }
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
```

`app/_components/city-walk.tsx:343-350`:

```ts
function arriveAt(h: CityWalkHandle, site: Site, say: Say): void {
  const at = arrivalOf(location.search);
  if (!at) {
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete(ARRIVAL_PARAM);
  history.replaceState(history.state, "", url);
```

`app/_components/crash-trail.ts:183-191`:

```ts
export function startCrashTrail(listener?: TrailListener): CrashTrail {
  rotate();
  const t0 = performance.now();
  const seconds = () => (performance.now() - t0) / 1000;
  const trail = createTrail({
    startedAt: new Date().toISOString(),
    url: location.pathname + location.search,
```

`lib/city/geolocation.test.ts:166-176`:

```ts
  test("the fix travels to the other page and back out of its query", () => {
    const href = arrivalHref("leipzig", { lat: 51.3393, lng: 12.3726 });
    expect(href).toBe("/leipzig?at=51.339300,12.372600");
    expect(arrivalOf(href.slice(href.indexOf("?")))).toEqual({
      lat: 51.3393,
      lng: 12.3726,
    });
    expect(arrivalOf("?at=91,0")).toBeNull();
    expect(arrivalOf("?at=nowhere")).toBeNull();
    expect(arrivalOf("")).toBeNull();
  });
```

The known query knobs the viewer reads (all parsed with exact matches):
`scene`, `gpu`, `block`, `safety`, `trail` (`app/_components/scene-profile.ts`,
`lib/city/gpu-safety.ts`, `crash-report.tsx`).

Conventions: `lib/city` is pure and DOM-free (no `location` there — the
callers pass strings in); TypeScript strict; Conventional Commits; the
privacy page is German prose in MDX; the guide is kept in sync in both
languages (`lib/docs/guide-labels.test.ts` pins labels, not this prose, so
keep the two sentences parallel by hand).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Format + autofix | `bun run fix` | exit 0 |
| Lint | `bun lint` | exit 0 |
| Typecheck | `bun typecheck` | exit 0 |
| Unit tests (targeted) | `bun test lib/city/geolocation.test.ts app/_components/crash-trail.test.ts` | pass |
| The gate | `bun run verify` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `lib/city/geolocation.ts`, `lib/city/geolocation.test.ts`
- `app/_components/city-walk.tsx` (only `arriveAt`)
- `app/_components/crash-trail.ts`, `app/_components/crash-trail.test.ts`
- `lib/city/crash-reports.ts` (one comment line, ≈ line 46)
- `app/(legal)/datenschutz/page.mdx` (the *Standort und Kompass* section)
- `docs/guide/en/using-the-viewer.md`, `docs/guide/de/using-the-viewer.md` (the one sentence each)
- `AGENTS.md` (the QA knobs line: add `#at=lat,lng`)

**Out of scope** (do NOT touch, even though they look related):
- `app/_components/locate-button.tsx`, `locate-offsite-dialog.tsx` — they
  call `arrivalHref`; its return value changes shape, their code does not.
- `lib/city/crash-reports.ts` beyond the comment — the envelopes already
  drop the query.
- `lib/city/crash-trail.ts` (`formatTrail`) — it prints whatever `url`
  the trail holds; with the fix the URL no longer holds a position.
- Any other URL parameter's parsing.

## Git workflow

- Branch: the branch you were given, or `plan/058-standort-fragment`.
- Two commits: the code (`fix(locate): the jump to another city hands the fix over in the URL fragment, off every request and the trail`)
  and the docs (`docs(privacy): the hand-off between cities, and the URL knobs`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: The fix travels in the fragment

In `lib/city/geolocation.ts`:

```ts
/** The fragment that hands a fix to another site's page (`#at=lat,lng`):
 *  a fragment never reaches a server — not in the request, not in a
 *  Referer — and the crash trail keeps the query alone. */
export const ARRIVAL_PARAM = "at";

/** `/<site>#at=lat,lng`: the other site's page, told where the player is. */
export function arrivalHref(
  siteId: string,
  fix: Pick<GeoFix, "lat" | "lng">
): string {
  return `/${siteId}#${ARRIVAL_PARAM}=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}`;
}

/** The fix a page was opened with (its `#at=lat,lng`), or null. */
export function arrivalOf(hash: string): Pick<GeoFix, "lat" | "lng"> | null {
  const value = new URLSearchParams(hash.replace(/^#/u, "")).get(ARRIVAL_PARAM);
  …the rest unchanged…
}
```

Update the test (`geolocation.test.ts:166-176`): the href is
`"/leipzig#at=51.339300,12.372600"`; `arrivalOf(href.slice(href.indexOf("#")))`
round-trips; add `expect(arrivalOf("?at=51.3,12.3")).toBeNull()` — a query
is no longer read — and `expect(arrivalOf("#at=91,0")).toBeNull()`.

**Verify**: `bun test lib/city/geolocation.test.ts` → pass.

### Step 2: `arriveAt` reads and drops the hash

In `app/_components/city-walk.tsx` `arriveAt`:

```ts
  const at = arrivalOf(location.hash);
  if (!at) {
    return;
  }
  const url = new URL(location.href);
  url.hash = "";
  history.replaceState(history.state, "", url);
```

Update the doc comment above it (`?at=lat,lng` → `#at=lat,lng`, "the
fragment: never sent to the server, not kept by the trail").

**Verify**: `bun typecheck` → exit 0; `grep -n "location.search" app/_components/city-walk.tsx` → no match.

### Step 3: The trail keeps only the known query knobs

In `app/_components/crash-trail.ts`, replace `url: location.pathname + location.search`
with a filtered form. Add near the top of the file:

```ts
/** The query parameters worth a record (the QA knobs, AGENTS.md): anything
 *  else a page was opened with stays out of the trail — it goes into
 *  reports and the crash card's text. */
const TRAIL_QUERY = ["scene", "gpu", "block", "safety", "trail"] as const;

/** The path plus the known knobs of `search`, in their given order. */
export function trailUrl(pathname: string, search: string): string {
  const given = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of TRAIL_QUERY) {
    const value = given.get(key);
    if (value !== null) {
      kept.set(key, value);
    }
  }
  const query = kept.toString();
  return query ? `${pathname}?${query}` : pathname;
}
```

and use `url: trailUrl(location.pathname, location.search)`.

Add to `app/_components/crash-trail.test.ts` (follow its existing style —
read the file's first test for the imports and the fake-storage helper
it uses):

```ts
test("the trail keeps the path and the QA knobs of the URL, nothing else", () => {
  expect(trailUrl("/dresden", "")).toBe("/dresden");
  expect(trailUrl("/dresden", "?scene=lite&block=1")).toBe("/dresden?scene=lite&block=1");
  expect(trailUrl("/leipzig", "?at=51.339300,12.372600&gpu=webgl2")).toBe("/leipzig?gpu=webgl2");
});
```

**Verify**: `bun test app/_components/crash-trail.test.ts` → pass (the new test included).

### Step 4: The comment in the reports' core

`lib/city/crash-reports.ts` ≈ line 46 says "no position (the trail has
none)". Extend it: "no position (the trail has none: the URL it keeps is
the path and the QA knobs, and the hand-off between cities travels in the
fragment)".

**Verify**: `bun lint` → exit 0.

### Step 5: The privacy page and the guide say what happens

`app/(legal)/datenschutz/page.mdx`, section *Standort und Kompass*: after
"nie an mich oder Dritte gesendet; auch die Fehlerberichte enthalten es
nicht." add one sentence:

> Bietet das Standort-Fenster den Sprung in eine andere Stadt dieser Seite an,
> reist dein Standort dabei im Fragment der Adresse (hinter dem `#`) mit:
> den sieht nur dein Browser, nicht der Hoster, und die Seite entfernt ihn,
> sobald sie dich dort abgesetzt hat.

`docs/guide/en/using-the-viewer.md:112-114`: after "its viewer opens with
you standing where you are." add "(the position travels in the link's
fragment, which never reaches the server)". The same in
`docs/guide/de/using-the-viewer.md:117-118`: "(die Position reist im
Fragment des Links mit, das nie beim Server ankommt)".

`AGENTS.md`, section "QA: self-verify, don't ask for screenshots", the URL
knobs line: append "`#at=lat,lng` (the off-site dialog's hand-off to
another city's page: placed there after the first frame, then dropped —
a fragment, so it never reaches the server or the crash trail)".

**Verify**: `bun run test -- lib/docs` → pass; `grep -n "Fragment der Adresse" "app/(legal)/datenschutz/page.mdx"` → one match.

### Step 6: The gate

`bun run fix && bun run verify` → exit 0.

## Test plan

- `lib/city/geolocation.test.ts`: the fragment round-trip, a query is not
  read, an out-of-range fix is null (step 1).
- `app/_components/crash-trail.test.ts`: `trailUrl` keeps the knobs and
  drops `at` (step 3).
- Manual (optional, needs two built sites): on `/dresden?scene=lite` call
  `__poc.handle` … not needed — the e2e suite has no geolocation; the unit
  tests are the gate.
- Verification: `bun run verify` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n '#${ARRIVAL_PARAM}' lib/city/geolocation.ts` matches; `grep -n '?${ARRIVAL_PARAM}' lib/city/geolocation.ts` does not
- [ ] `grep -n "arrivalOf(location.hash)" app/_components/city-walk.tsx` matches
- [ ] `grep -n "trailUrl(location.pathname, location.search)" app/_components/crash-trail.ts` matches
- [ ] `bun test lib/city/geolocation.test.ts app/_components/crash-trail.test.ts` passes with the three new assertions/tests
- [ ] `grep -c "Fragment" "app/(legal)/datenschutz/page.mdx"` ≥ 1; `grep -c "fragment" docs/guide/en/using-the-viewer.md` ≥ 1; `grep -c "Fragment" docs/guide/de/using-the-viewer.md` ≥ 1
- [ ] `grep -n "#at=lat,lng" AGENTS.md` matches
- [ ] `bun run verify` exits 0
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 058 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Another reader of `ARRIVAL_PARAM` / `location.search` exists beyond the
  three named (`grep -rn "ARRIVAL_PARAM\|arrivalOf\|arrivalHref" app lib`).
- The off-site dialog's link is not a plain `<a href>` any more (a router
  `Link` may handle fragments differently — report, don't guess).
- `crash-trail.test.ts` has no fake-storage helper to model after (then
  copy the one in `app/_components/style-memory.test.ts:6-17`).
- The e2e suite (`e2e/`) asserts on `?at=` anywhere (`grep -rn "at=" e2e/`).

## Maintenance notes

- Anything that ever puts a *position* in a URL again must use the
  fragment and must be named on the privacy page (ADR 0045) — this plan is
  the precedent.
- `TRAIL_QUERY` is the one list of query knobs the trail records; a new
  `?knob` worth seeing in a crash record is added there, with its name on
  the privacy page's trail bullet if it carries anything personal (none
  of the five do).
- Reviewer: open the crash card on `/dresden?trail=1` and confirm the
  `url` line shows the path and knobs only.
