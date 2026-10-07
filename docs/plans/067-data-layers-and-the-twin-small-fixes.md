# Plan 067: The data layers and the twin answer right — a tram load that can be retried, Dresden's counts judged in Dresden's time, orchard trees that can be asked, the site's own credits, a feed that polls only in view and never throws

> **Executor instructions**: Follow this plan step by step; each step is
> independent and ends in its own commit. Run every verification command
> and confirm the expected result before moving on. If anything in the
> "STOP conditions" section occurs, stop and report — do not improvise.
> When done, update the status row for this plan in `docs/plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4b0310a..HEAD -- app/_components/data-overlays.ts app/_components/data-overlays.test.ts app/_components/bike-layer.ts app/_components/bike-layer.test.ts lib/city/bike-counts.ts lib/city/bike-counts.test.ts lib/city/bike-feeds.ts lib/city/bike-feeds.test.ts app/_components/tile-stream.ts lib/city/inquiry-features.ts lib/city/inquiry-features.test.ts lib/city/inquiry.ts lib/city/card-lines.ts app/_components/inquiry-card.tsx lib/city/site.ts`
> If any of these changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition for that step.

## Status

- **Priority**: P2 (steps 1–2 P1 for the data layers' users)
- **Effort**: M in all (S per step)
- **Risk**: LOW per step
- **Depends on**: none (plan 062 changes the traffic slot in
  `tile-stream.ts`; step 3 here touches the tree ask set a few lines
  away — merge in either order, re-read after)
- **Category**: bug
- **Planned at**: commit `4b0310a`, 2026-10-06

## Why this matters

Six defects in the newest layers (ADR 0040, 0042), each confirmed by
reading at `4b0310a`:

1. **The tram layer is dead for the page after one failed load.** The
   overlay's `load()` sets `loading = true` and returns early when the
   timetable fetch yields `null` (a 404, a network failure past the
   optional budget) without resetting it — no `finally`; `apply(true)`
   only loads while `cars` is null and `load()` returns at once while
   `loading`. One Wi-Fi blip on the first switch-on and *Straßenbahnen*
   stays on with nothing drawn and no status, for the session. The bike
   overlay's `compiling` flag has the same shape: a rejected `compile`
   leaves `compiled` false for the page's life.
2. **Dresden's bicycle counters are judged stale in the viewer's time
   zone.** The WFS's `messzeit` ("01.10.2026 07:00:00", Dresden local
   time) is parsed with `new Date(y, mo, d, h, mi, s)` — the browser's
   zone — and compared with `new Date()`. A visitor in Tokyo sees every
   counter grey (all "older than three hours") though the feed is live; a
   visitor in New York sees a counter down for hours still lit (its
   parsed time lies in the future). Hamburg's feed is ISO with `Z` and is
   right. Only a browser in Europe/Berlin gets Dresden right.
3. **Orchard trees are drawn but cannot be asked.** The inventory layer
   draws `[...inventory, ...orchardTrees(cultivated)]`; the ask sets are
   built from `inventory` alone — a click on an orchard tree answers with
   whatever stands behind it.
4. **A card on a non-Saxon site credits GeoSN and Dresden** until the
   provenance manifest arrives (and after a failed manifest fetch): the
   tree register's credit is the literal "Landeshauptstadt Dresden,
   dl-de/by-2-0" and `GEOSN_CREDIT` is the fallback of every `lod2`,
   `dom`, `dlm` line — against the repo's "attribution is part of the
   data" rule, on Hamburg, München and Unna. The site already carries
   `provider.credit` and `treeCadastre.credit` (`lib/city/site.ts`).
5. **A null element in a live feed answer throws out of the poll.**
   `parseBikeCounts` maps `counterOf` over the features — a `null` entry
   throws on `f.properties`; `parseHamburgBikes` likewise on
   `stream.Thing`; the layer's `read()` rethrows every non-abort error
   from `void read()` — an unhandled rejection (a crash-class report)
   every five minutes while the layer is on. The doc comment promises
   "anything malformed is left out, never thrown".
6. **The bicycle feed keeps polling in a hidden tab** (`setInterval` with
   no visibility gate), hitting the city's WFS from background tabs.

## Current state

### 1 — the overlays (`app/_components/data-overlays.ts`)

`:180-214` (`tramOverlay`'s `load`):

```ts
  const load = async () => {
    const url = opts.tramTimetableUrl;
    if (!url || loading) {
      return;
    }
    loading = true;
    try {
      const [timetable, bridges] = await Promise.all([
        fetchOptionalJson<TramTimetable>(url, signal),
        fetchFeaturesFrom<BridgeFeature>(opts.bridgeUrls, signal),
      ]);
      if (!(timetable && alive())) {
        return;
      }
      …
      cars = built;
      built.group.visible = on;
      opts.onChange?.();
    } catch (err) {
      if (!isAbortError(err)) {
        throw err;
      }
    }
  };
```

`:216-230` (`apply`): `if (cars) { cars.group.visible = on; } else if (on) { void load(); }`.
`:121-129` (`bikeOverlay`): `if (!compiling) { compiling = true; … void opts.compile(built.group).then(() => { compiled = true; … }); }`.
`opts.onTramStatus?: (status: TramCarsStatus | null) => void` (`:92`).

### 2 — the count time (`lib/city/bike-counts.ts:86-101`, `:187-192`)

```ts
export function parseCountTime(raw: unknown): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(
    text(raw).trim()
  );
  if (!m) {
    return null;
  }
  const [, d, mo, y, h, mi, s] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
}
…
export function isStale(counter: BikeCounter, now: Date): boolean {
  return (
    counter.measuredAt === null ||
    now.getTime() - counter.measuredAt.getTime() > BIKE_STALE_MS
  );
}
```

`lib/city/bike-counts.test.ts:86-92` asserts the local-zone parse
(`getHours()` is 18 for "… 18:00:00") — that test changes.

### 3 — the orchard trees (`app/_components/tile-stream.ts:740-746`, `:822-826`)

```ts
    // Orchard trees join the cadastre as its "small" archetype.
    [...inventory, ...orchardTrees(cultivated)],
```

```ts
  const asks = [
    ...treeSets(inventory, askCtx),
    ...askSets(monumentItems(monuments, askCtx)),
```

`treeSets` is `lib/city/ask-items.ts:140`; `orchardTrees` is
`lib/city/cultivated.ts:68` (`TreeFeature[]` from the cultivated features).
A tree's facts row is its index in the tile's `treefacts` file
(`lib/city/inquiry-features.ts` — rows past the file's end resolve to
empty facts, `NO_TREE_FACTS`).

### 4 — the credits (`lib/city/inquiry-features.ts:106-109`, `lib/city/inquiry.ts:129,144,158`, `lib/city/card-lines.ts:107`)

```ts
const REGISTER = {
  label: "Stadtbaumkataster",
  credit: "Landeshauptstadt Dresden, dl-de/by-2-0",
};
```

```ts
export const GEOSN_CREDIT = "Quelle: GeoSN, dl-de/by-2-0";
```

`inquiry.ts`: `parts.push(source?.credit ?? GEOSN_CREDIT);` (×3 for lod2,
dom, dlm); `inquiry-features.ts:221, 238, 303` use `GEOSN_CREDIT` as the
credit of the DOM/DLM lines. The site: `lib/city/site.ts:109-111`
`Provider.credit: string` ("the credit line its licence requires, in the
HUD footer"), `:160-163` `TreeCadastre.credit: string`. `inquiryCard`
(`lib/city/inquiry.ts:229`) is the entry the HUD calls
(`app/_components/inquiry-card.tsx`), which has `useSite()` available
(`site-context.tsx`).

### 5 — the parsers (`lib/city/bike-counts.ts:159-176`, `lib/city/bike-feeds.ts:152-168`, `app/_components/bike-layer.ts:315-331`)

```ts
  return (features as RawCounter[])
    .map(counterOf)
    .filter(…)
```

```ts
  for (const stream of streams as StaStream[]) {
    const at = pointOf(stream, epsg);
```

```ts
  const read = async () => {
    …
      if (doc !== null && aborter === mine) {
        opts.onCounts(opts.feed.parse(doc, opts.bounds, opts.epsg));
      }
    } catch (err) {
      if (!isAbortError(err)) {
        throw err;
      }
    }
  };
```

### 6 — the poll (`app/_components/bike-layer.ts:333-345`)

```ts
    start: () => {
      if (timer !== null) {
        return;
      }
      void read();
      timer = setInterval(() => void read(), BIKE_POLL_MS);
    },
```

Conventions: `lib/city` is pure and DOM-free (a time zone is data: pass
it in); TypeScript strict; the privacy page already names both feed
hosts; tests with `bun:test`; Conventional Commits.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Targeted tests | `bun test lib/city/bike-counts.test.ts lib/city/bike-feeds.test.ts app/_components/bike-layer.test.ts app/_components/data-overlays.test.ts lib/city/inquiry-features.test.ts lib/city/inquiry.test.ts` | pass |
| A test under another zone | `TZ=Asia/Tokyo bun test lib/city/bike-counts.test.ts` | pass |
| The gate | `bun run verify` | exit 0 |
| e2e (data layers) | `bun run test:e2e --grep "@desktop-hud"` | pass (slow) |

## Scope

**In scope** (the only files you should modify):
- `app/_components/data-overlays.ts`, `app/_components/data-overlays.test.ts` (create if absent)
- `lib/city/bike-counts.ts`, `lib/city/bike-counts.test.ts`, `lib/city/bike-feeds.ts`, `lib/city/bike-feeds.test.ts`
- `app/_components/bike-layer.ts`, `app/_components/bike-layer.test.ts`
- `app/_components/tile-stream.ts` (the two tree lines)
- `lib/city/inquiry-features.ts`, `lib/city/inquiry-features.test.ts`, `lib/city/inquiry.ts`, `lib/city/inquiry.test.ts`, `lib/city/card-lines.ts`, `app/_components/inquiry-card.tsx`
- `lib/city/site.ts` and `sites/providers.ts` only if step 2 adds a time-zone field (see step 2)

**Out of scope** (do NOT touch, even though they look related):
- The scene clock's zone (the HUD composes the scene date in the
  viewer's zone while the timetable and the sun are Berlin time — a
  design item in the backlog, not this plan).
- `tram-cars.ts`'s per-frame sampling (backlog, measure first).
- The traffic layer (plan 062).
- `lib/city/data-layers.ts`, the HUD panel.

## Git workflow

- Branch: the branch you were given, or `plan/067-data-layers-twin`.
- One commit per step, Conventional Commits (`fix(trams): …`, `fix(bikes): …`, `fix(twin): …`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: A failed load can be tried again, and says so

In `tramOverlay`'s `load`: wrap the body so `loading = false` runs in a
`finally`; on a `null` timetable or a thrown non-abort error, call
`opts.onTramStatus?.({ … })` with a status the HUD can show — read
`TramCarsStatus` (`tram-cars.ts`) for its shape; if it has no "failed"
form, add an optional `failed?: string` and have the HUD's status text
(`city-walk.tsx`, grep `onTramStatus`) show "Fahrplan nicht geladen" when
set — keep that HUD edit minimal; if it needs more than a line, report
instead. Keep the throw for non-abort errors **out**: catch, report via
status, return (an unhandled rejection is a crash-class report for a
missing file). `apply(true)` then loads again on the next switch-on
because `cars` is still null and `loading` is false.

Validate the timetable's shape before `createTramCars`: `patterns`,
`profiles`/`days` arrays (read `TramTimetable` in `lib/city/tram-timetable.ts`)
— a malformed file is the `null` path.

`bikeOverlay`: reset `compiling = false` when `opts.compile` rejects
(`.catch`), so the next counts try again.

Test (`data-overlays.test.ts` — create, with `fetchOptionalJson` stubbed
through `globalThis.fetch` returning a 404 `Response`): `apply(true)`,
await, `apply(false)`, `apply(true)` → the fetch was called twice (the
second attempt happens); `onTramStatus` saw the failure. Read how
`createDataOverlays` is constructed (`:300+`) to build it with fakes
(`parent: new Object3D()`, `compile: () => Promise.resolve()`).

**Verify**: `bun test app/_components/data-overlays.test.ts` → pass.
Commit: `fix(trams): a timetable that failed to load is tried again on the next switch-on, and the HUD says so`.

### Step 2: Dresden's count time is Dresden's

`parseCountTime(raw, zone = "Europe/Berlin")` builds the instant for that
zone: compute the UTC guess `Date.UTC(y, mo-1, d, h, mi, s)`, then the
zone's offset at that instant with `Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(…)`,
and correct once (a second correction covers the DST edge — write it as
a small helper `zonedTime(parts, zone)` with a comment; `Intl` is pure
and allowed in `lib/city`). The feed reader (`lib/city/bike-feeds.ts`
`BikeFeedReader`) gains `zone?: string`; Dresden's reader passes
`"Europe/Berlin"`, Hamburg's needs none (ISO `Z`). If the zone should be
a provider fact rather than a feed fact, add `timeZone: "Europe/Berlin"`
to `Provider` in `lib/city/site.ts`/`sites/providers.ts` instead — one
value for every German Land; either is acceptable, say which in the
commit.

Tests (`bike-counts.test.ts`): replace the `getHours()` assertion with
`expect(t?.toISOString()).toBe("2026-12-24T17:00:00.000Z")` (CET) and add
`"24.06.2026 18:00:00"` → `"2026-06-24T16:00:00.000Z"` (CEST); run the
file under `TZ=Asia/Tokyo` and `TZ=America/New_York` — the same results.

**Verify**: `bun test lib/city/bike-counts.test.ts && TZ=Asia/Tokyo bun test lib/city/bike-counts.test.ts && TZ=America/New_York bun test lib/city/bike-counts.test.ts` → pass.
Commit: `fix(bikes): a Dresden count's time is read in Europe/Berlin, whatever the visitor's zone`.

### Step 3: Orchard trees can be asked

In `tile-stream.ts`, build the list once — `const trees = [...inventory, ...orchardTrees(cultivated)];`
— and use it both for the layer and for `treeSets(trees, askCtx)`. The
indices stay aligned with the `treefacts` rows (orchard trees are
appended; rows past the end resolve to `NO_TREE_FACTS`). Mark orchard
trees so the card's kicker says "Obstbaum" and skips the register
credit: read `orchardTrees` — if its `TreeFeature`s carry a distinguishing
property (an archetype or a source), `treeInquiry`/`inquiry-features.ts`
can branch on it; if not, add `source: "orchard"` to the features there
and branch on it.

Test (`inquiry-features.test.ts`): an orchard tree's card has the kicker
"Obstbaum" and no register line.

**Verify**: `bun test lib/city/inquiry-features.test.ts` → pass.
Commit: `fix(twin): orchard trees can be asked, and the card says what they are`.

### Step 4: The site's own credits

Give `inquiryCard` (and the feature cards it dispatches to) a `credits`
argument: `{ provider: string; register?: string }` — the HUD passes
`site.provider.credit` and `site.treeCadastre?.credit` from `useSite()`.
Replace `GEOSN_CREDIT` fallbacks in `inquiry.ts` and
`inquiry-features.ts` with `credits.provider`, and `REGISTER.credit` with
`credits.register ?? credits.provider`. Keep `GEOSN_CREDIT` exported
only if a test or the HUD footer imports it (grep); otherwise delete it.

Tests (`inquiry.test.ts`, `inquiry-features.test.ts`): a card built with
`{ provider: "Quelle: LGV Hamburg, dl-de/by-2-0" }` and no manifest
names that credit, not GeoSN; the Dresden case is unchanged with Dresden's.

**Verify**: `bun test lib/city/inquiry.test.ts lib/city/inquiry-features.test.ts` → pass;
`grep -rn "Landeshauptstadt Dresden" lib/city/inquiry-features.ts` → no match.
Commit: `fix(twin): the card credits the site's own provider and register`.

### Step 5: A malformed feed answer is left out, never thrown

`parseBikeCounts`: `.filter((f): f is RawCounter => typeof f === "object" && f !== null)`
before `.map(counterOf)`; `parseHamburgBikes`: `continue` on a non-object
`stream`. In `bike-layer.ts` `read()`: catch a parse error separately —
`let counters; try { counters = opts.feed.parse(…) } catch { return; }`
— and keep the last counts; the fetch's own non-abort errors are already
retried by `fetchOptionalJson`'s budget, so drop the rethrow (a failed
poll is not a crash: the columns show stale).

Tests: `bike-counts.test.ts` and `bike-feeds.test.ts` — an answer with a
`null` element yields the other counters; `bike-layer.test.ts` — a feed
whose `parse` throws does not reject `read()`.

**Verify**: the three test files pass.
Commit: `fix(bikes): a malformed element is left out, and a failed poll keeps the last counts`.

### Step 6: The feed polls only in view

In `bike-layer.ts`: `read()` returns at once when `document.hidden`;
on `visibilitychange` → visible, read once if the last successful read is
older than `BIKE_POLL_MS`; remove the listener in `stop()`. (`document`
is fine here: `app/_components` is the DOM side.)

Test (`bike-layer.test.ts`, with a fake `document` of `{ hidden, addEventListener, removeEventListener }`
if the file has no DOM — read its existing setup): hidden → no fetch;
shown after the interval → one fetch.

**Verify**: `bun test app/_components/bike-layer.test.ts` → pass.
Commit: `fix(bikes): the counters are read only while the page is in view`.

### Step 7: The gate

`bun run fix && bun run verify` → exit 0; `bun run test:e2e --grep "@desktop-hud"` → pass.

## Test plan

- Step 1: a failed tram load retried; the bike compile reset.
- Step 2: the Berlin-zone parse under three `TZ`s.
- Step 3: an orchard tree's card.
- Step 4: a non-Saxon credit.
- Step 5: null elements; a throwing parse.
- Step 6: hidden/shown polling.
- Verification: `bun run verify` → all pass, seven+ new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "finally" app/_components/data-overlays.ts` matches in `tramOverlay`'s `load`
- [ ] `TZ=Asia/Tokyo bun test lib/city/bike-counts.test.ts` and `TZ=America/New_York bun test lib/city/bike-counts.test.ts` pass
- [ ] `grep -n "treeSets(inventory" app/_components/tile-stream.ts` → no match
- [ ] `grep -rn "Landeshauptstadt Dresden" lib/city/inquiry-features.ts` → no match
- [ ] `grep -n "document.hidden" app/_components/bike-layer.ts` matches
- [ ] `bun run verify` exits 0 with the new tests
- [ ] `bun run test:e2e --grep "@desktop-hud"` passes
- [ ] `git status --short` shows only in-scope files
- [ ] `docs/plans/README.md` status row for 067 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `TramCarsStatus` cannot carry a failure without changing the HUD beyond
  one line (report the shape; step 1 then keeps the retry and skips the
  status).
- `orchardTrees` features cannot be told apart from the register's and
  adding a property breaks `features.test.ts`'s shape check (report).
- `inquiryCard` is called from more than the one HUD component (grep
  `inquiryCard(`) — then thread `credits` to every caller, or report if a
  caller has no site.
- The `treefacts` indices do **not** stay aligned when orchard trees are
  appended (read `treeSets` — if it indexes by position in the list it
  was given, appending is safe; if it reads an id from the feature, check
  orchard trees have one).

## Maintenance notes

- Every overlay's lazy `load()` must reset its flag in `finally` and
  report a failure through its status callback; step 1 is the template.
- Times from a city's feed are that city's zone: a new feed names its
  zone (or uses the provider's), never the viewer's.
- The scene clock's zone (the HUD) is the open design item: when it is
  settled, `parseCountTime`'s zone and the scene date should come from
  the same place.
- Reviewer: run the `@desktop-hud` e2e — it stubs the Dresden WFS and
  asserts two counters land; step 2 changes their staleness only if the
  stub's `messzeit` is near the scene's "now" (read the stub at
  `e2e/city-walk.spec.ts:790`).
