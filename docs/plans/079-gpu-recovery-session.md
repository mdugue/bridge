# Plan 079: A page that lost its GPU comes back where it stood, through one recovery session

**Status:** TODO

> **Executor instructions.** Read the whole plan first. Run each step's
> check before the next step. If a STOP condition occurs, stop and report;
> do not improvise. When done, update this plan's row in
> `docs/plans/README.md` with what you built and every deviation.
>
> **Drift check (run first):**
> `git diff --stat 9bd5ee49..HEAD -- app/_components/gpu-recovery.ts app/_components/gpu-recovery.test.ts app/_components/city-walk.tsx lib/city/gpu-safety.ts lib/city/gpu-safety.test.ts app/_components/gpu-safety.ts app/_components/crash-reports.ts app/_components/crash-report.tsx app/_components/storage-keys.ts`
> `city-walk.tsx` changes often: find every excerpt below by its text, not
> by its line number. The line numbers are approximate (at `9bd5ee49`).

## Context

"A page that lost its GPU comes back where it stood, lighter, but not
forever" is one concept. Today it is held in three places, and the
protocol between them is known by the caller:

1. **The caps**, in `lib/city/gpu-safety.ts`, the section headed
   `// --- the automatic recovery's caps (gpu-recovery.ts) ---` (≈ line 262
   on): `RecoveryHistory`, `LOSS_WINDOW_MS`, `RECLAIM_TRIES`,
   `RECLAIM_WINDOW_MS`, `FAILURE_TRIES`, `within`, `recentHistory`,
   `mayRecover`. The same section also holds `GpuLoss`, `RESUME_AWAY_MS`,
   `RESUME_WINDOW_MS`, `FrameSigns` and `frameLoss`. Those belong to the
   page's lifecycle machine (`lib/city/page-lifecycle.ts`, plan 066) and
   the crash reports. They stay where they are.
2. **The record**, in `app/_components/gpu-recovery.ts`: one session
   storage value under `SESSION_KEYS.gpuRecovery` (`"gpu-recovery"`),
   read and written by seven exports — `recoverFromGpuLoss` (≈ 86),
   `recoverOnRequest` (≈ 127), `keepPlaceForReload` (≈ 144),
   `recentlyRecovered` (≈ 171), `peekRecoverySnapshot` (≈ 193),
   `recoveryWasReset` (≈ 210), `takeRecoverySnapshot` (≈ 222). Six have
   `app/_components/city-walk.tsx` as their only caller.
   `recentlyRecovered` has three other callers, all for the crash
   classification (`offerAsCrash`, `lib/city/crash-trail.ts`):
   `crashedBefore` in `app/_components/gpu-safety.ts` (≈ 145),
   `reportPrevious` in `app/_components/crash-reports.ts` (≈ 141) and
   `initialOffer` in `app/_components/crash-report.tsx` (≈ 39).
3. **The protocol**, in `app/_components/city-walk.tsx`: about 60–70
   lines over six sites, none tested.
   - The boot preamble (≈ 748–760, in the boot `useEffect`): it peeks the
     snapshot *before* the boot (`peekRecoverySnapshot`), parses it, asks
     `recoveryWasReset`, and calls `recovery.current?.prepare(restored)`
     only when no place was picked (`restored && !start`).
   - `initialCamera: start ? start.camera : restored?.camera` (≈ 779).
   - `onGpuLost` (≈ 795): `!cancelled && recoverFromGpuLoss(how, capture, budget.safety, (from) => raiseSafety(from, { by: trail.startedAt })) ? () => location.reload() : null`.
   - The first-frame branch (≈ 813–850): with a picked place it takes the
     snapshot unused ("a place picked meanwhile wins"); with a restored
     one it takes it, applies its camera (Modell stripped unless
     `restoresLook(budget.safety)`), notes `quality reset` or
     `recovered`, and says *Mit weniger Details neu geladen* from level 1.
   - The boot's `catch` (≈ 887): "a boot that failed drops the snapshot".
   - `reloadAfterFailure(lighter)` (≈ 636, the failure card's buttons:
     `recoverOnRequest`) and `resetQuality` (≈ 656, *Qualität*:
     `keepPlaceForReload(…, { reset: true })`).
   - `restoresLook` gating: inside `recovery.current.prepare` (≈ 624, the
     style) and the first-frame branch (≈ 838, Modell).

The rules are fixed by **ADR 0047** (decisions 5–7). ADR 0046 no longer
exists: the 2026-10-30 simplification merged it into 0047
(`docs/adr/README.md`: "a device that lost its GPU gets a lighter page").
They are: the safety level lives in local storage through the ladder
(`app/_components/gpu-safety.ts`, `raiseSafety`/`resetSafety`); the
snapshot and the reload times live in session storage; one reload per
level, none from level 3; a reclaim and a failed frame reload at the same
level under caps of their own; *Leichter weiter* reloads a level lighter
past every cap; the reset to full detail keeps the record marked `reset`
and adds no reload time. The reset's teardown is the heavier
`disposeForReload`; the recovery's is `releaseGpu` (both on the handle,
`create-app.ts`). The key `gpu-recovery` is named on the privacy page
(`app/(legal)/datenschutz/page.mdx`) and pinned by
`app/_components/storage-keys.test.ts`.

This plan follows plan 066's pattern: lift the decisions behind one small
interface, keep the browser-facing code as a thin adapter, and let the
incident sequences be the tests.

## Findings

**The interface today is the record's protocol.** To use
`gpu-recovery.ts` correctly, a caller must know: peek before the boot,
never take before the scene is up; take after a picked place too; take in
a failed boot's `catch`, but not in an aborted one; pass `null` as the
snapshot for a page that never drew; pass the right `raise` (with `by`
for a loss, without for *Leichter weiter*); ask `recoveryWasReset` only
when the snapshot parsed. None of this is in the module. All of it is in
`city-walk.tsx`, which has no tests. The module is shallow: seven
functions over one value, each nearly as simple as its body.

**The deletion test.** Delete `gpu-recovery.ts` and its complexity
reappears in `city-walk.tsx` — so it earns its keep, but only half of it.
Delete the protocol sites in `city-walk.tsx` and nothing replaces them.

**Why not a consume-once `arrive()`.** It is wrong. React StrictMode
mounts the boot effect twice. The first boot is aborted before its first
frame; the second must find the snapshot still there. That is why today's
code peeks first and takes only once the scene is up (documented in
`peekRecoverySnapshot`'s comment and at city-walk.tsx ≈ 748). The new
interface keeps the read and the commit apart.

**What a session holds.** No copy of the record. Every call reads the
store, as today, so the double mount, the three crash readers and the
boot see one value.

**The snapshot codec stays the HUD's.** `capture` (`encodeSnapshot` of the
look store, the camera, the time) and `prepare` (the time store and the
look store) stay in `city-walk.tsx`. The parse stays there too: the
crash readers' import graph must not grow. `app/_components/gpu-safety.ts`
is in the client's entry chunk (`city-walk-client.tsx` imports
`pageSafety`), and it imports `gpu-recovery.ts`. Today that pulls in only
`lib/city/gpu-safety.ts`. If the recovery modules imported
`lib/city/snapshot.ts` at runtime, the look controls and the data layers
would join the entry chunk. So the arrival rule below takes a parsed
`Snapshot` and imports `snapshot.ts` as a type only.

**One deliberate change in behaviour.** Today the first-frame branch
takes the snapshot only when it parsed. A stored snapshot that does not
parse (a tab that kept a record across a deploy that changed the
snapshot's version) is never taken once a boot succeeds; only a failed
boot drops it. After this plan `landed()` takes whatever waited. Nothing
reads such a value but the next `peek`, which ignores it again; the
record's keys and shape are unchanged. Pin it with a test.

**Commits that are the same.** Taking the snapshot used, taking it unused
(a picked place) and dropping it after a failed boot all do the same
thing to the record today: the snapshot and the `reset` mark go, the
reload times stay. The interface keeps two names, `landed()` and
`abandoned()`, so each end of a boot says which it is at the call site,
and the aborted boot (neither called) stays visible. It does not take a
"used / unused" argument: the record ignores it, and which of the two it
was is the arrival rule's answer, tested there.

**What is untested today and becomes testable:** peek → prepare → take;
a StrictMode abort between peek and take; a picked place winning; a
failed boot dropping the snapshot; the `restoresLook` gating of the style
and of Modell; which note the trail gets and when the HUD says the page
came back lighter.

**No e2e covers the recovery.** `e2e/city-walk.spec.ts` checks only the
*Qualität* panel's words at level 0 (`@desktop-hud`, ≈ 716). No spec loses
a device. The automatic recovery is still unverified on a real iPhone
(plan 019 §M, all boxes open). The refactor's net is the unit tests, as
plan 066 accepted.

## The interface

Two modules, in the house's pair pattern (`lib/city/gpu-safety.ts` with
`app/_components/gpu-safety.ts`, `lib/city/crash-trail.ts` with
`app/_components/crash-trail.ts`).

**`lib/city/gpu-recovery.ts`** (create; pure, no DOM, no storage):

- The caps, moved verbatim from `lib/city/gpu-safety.ts`:
  `RecoveryHistory`, `LOSS_WINDOW_MS`, `RECLAIM_TRIES`,
  `RECLAIM_WINDOW_MS`, `FAILURE_TRIES`, `recentHistory`, `mayRecover`,
  with their comments. They import `type GpuLoss`, `MAX_SAFETY` and
  `type SafetyLevel` from `./gpu-safety`.
- The arrival rule:

```ts
import type { Snapshot } from "./snapshot";

/** Where this load starts, and what it says once the scene is up. */
export interface Arrival {
  /**
   * The snapshot the boot starts from: its time and look go back before
   * the boot (the HUD's `prepare`), its camera is the boot's
   * `initialCamera` and is applied again after the first frame. Gated by
   * the level (`restoresLook`): from level 2 without the picture style
   * and without Modell. Null when nothing waited, it did not parse, or a
   * place was picked meanwhile (the player's time and look stay theirs).
   */
  snapshot: Snapshot | null;
  /** the trail's note once the scene is up, or null */
  note: { event: "recovered"; detail: "after a lost GPU" }
      | { event: "quality reset"; detail: "back where the player stood" }
      | null;
  /** the HUD says "Mit weniger Details neu geladen" (a recovery, level ≥ 1) */
  sayLighter: boolean;
}

export function arrivalOf(inputs: {
  snapshot: Snapshot | null; // the waiting one, parsed by the HUD
  reset: boolean;            // it waited for Qualität's reset
  picked: boolean;           // a place was picked meanwhile
  level: SafetyLevel;        // this page's safety level
}): Arrival;
```

Gating the snapshot: `look` without its `style` key, `camera` without
`model`. Today `prepare` deletes `patch.style` after `decodeLook`; leaving
`style` out of `SnapshotLook` gives the same patch (`decodeLook` only sets
`style` when it is present). The boot's `initialCamera` today gets the
ungated camera, but the boot never reads `model`: `bootingPose`
(`lib/city/boot-start.ts`) and `camera-pose.ts`'s `applyCameraState` take
only the perspective, and `CityWalkOptions.initialCamera`'s comment says
"Modell's part is the caller's". Step 1 checks this.

**`app/_components/gpu-recovery.ts`** (rewrite; the browser side):

```ts
type Store = Pick<Storage, "getItem" | "setItem">;

/** The level a reload goes lighter from, and how it is raised (gpu-safety.ts). */
export interface Ladder {
  level: SafetyLevel;
  /** a level lighter from the next page on; false: it could not be stored */
  raise: (from: SafetyLevel) => boolean;
}

/** What a recovery or a reset left for this load. */
export interface Waiting {
  snapshot: string;
  /** kept for Qualität's reset to full detail, not for a lost GPU */
  reset: boolean;
}

export type Leaving =
  | { kind: "lighter"; ladder: Ladder } // the failure card's "Leichter weiter"
  | { kind: "reset" };                  // Qualität's full detail

export interface RecoverySession {
  /** What waits for this load, without taking it. Before the boot. */
  peek(): Waiting | null;
  /** The scene is up: what waited is taken (used, or a place picked won). */
  landed(): void;
  /** The boot failed: what waited goes with it. */
  abandoned(): void;
  /**
   * The GPU went (`how`); `snapshot` is the place now (null: the page never
   * drew, and the stored one stays). True: the caller reloads. The record
   * is written first, then — for a loss in use — the level raised; a raise
   * that cannot be stored is no reload.
   */
  onLoss(how: GpuLoss, snapshot: string | null, ladder: Ladder): boolean;
  /** The player asks for a reload; the caller reloads. */
  leave(leaving: Leaving, snapshot: string | null): void;
  /** This page follows a recovery (the last reload under two minutes ago). */
  followsRecovery(): boolean;
}

export function createRecoverySession(
  store: Store | null,
  now: () => number = Date.now
): RecoverySession;

/** This page's session, over session storage (none where it is refused). */
export function pageRecovery(): RecoverySession;
```

The ladder is passed per call, not at creation: the three crash readers
need `followsRecovery()` before the page's level exists (it is an input
to settling the level), and the two raises differ — a loss raises as this
page's (`{ by: trail.startedAt }`), *Leichter weiter* raises on top (no
`by`). Passing `raise` in also keeps `gpu-recovery.ts` from importing
`gpu-safety.ts`, which imports it (no cycle).

`pageRecovery()` builds a new session on each call
(`createRecoverySession(session())`). It does not memoise: the session
holds nothing, and the test that makes `sessionStorage` throw must see
its getter.

## Steps

### Step 1: Check the premises

- `grep -n "model" lib/city/boot-start.ts app/_components/camera-pose.ts`:
  neither `bootingPose` nor `applyCameraState` in `camera-pose.ts` reads a
  camera's `model`. (At `9bd5ee49` only `create-app.ts`'s handle
  `applyCameraState` does, ≈ 3804, after the first frame.)
- `grep -rn "recentHistory\|mayRecover\|RecoveryHistory\|LOSS_WINDOW_MS\|RECLAIM_TRIES\|RECLAIM_WINDOW_MS\|FAILURE_TRIES" app lib scripts --include=*.ts --include=*.tsx`:
  only `app/_components/gpu-recovery.ts`, `lib/city/gpu-safety.ts` and
  `lib/city/gpu-safety.test.ts`.
- `grep -rn "from \"./gpu-recovery\"" app`: only `city-walk.tsx`,
  `gpu-safety.ts`, `crash-reports.ts`, `crash-report.tsx` (and the test).
- Record the current test count: `bun test app/_components/gpu-recovery.test.ts lib/city/gpu-safety.test.ts`.

**Verify:** all three greps as stated. Otherwise STOP.

### Step 2: The pure module

Create `lib/city/gpu-recovery.ts`. Move the caps from `lib/city/gpu-safety.ts`
(from `/** When the page reloaded itself, per kind` to the end of
`mayRecover`) unchanged. In `lib/city/gpu-safety.ts` keep `GpuLoss`,
`RESUME_AWAY_MS`, `RESUME_WINDOW_MS`, `FrameSigns`, `frameLoss`; rename the
section header to say it is the GPU loss's kinds (the lifecycle's and the
reports'); in the file's head comment replace "Also here: the caps on the
automatic recovery (one reload per level, gpu-recovery.ts)" with a pointer
to `lib/city/gpu-recovery.ts`. `restoresLook` stays in `gpu-safety.ts`
(`city-walk.tsx` also reads it for the remembered style, ≈ 573).

Add `arrivalOf` and `Arrival` as above. Its rule, from today's code:

| waiting (parsed) | picked | reset | snapshot | note | sayLighter |
|---|---|---|---|---|---|
| none, or did not parse | any | any | null | null | false |
| yes | yes | any | null | null | false |
| yes | no | yes | gated | `quality reset` | false |
| yes | no | no | gated | `recovered` | `level > 0` |

The head comment says what the module is (the recovery's caps and where a
recovered page starts; pure; the record itself is
`app/_components/gpu-recovery.ts`'s). Write "session storage" with a
space: `storage-keys.test.ts` requires every source that contains the
words `localStorage` or `sessionStorage` to import `storage-keys`.

Move the three cap tests from `lib/city/gpu-safety.test.ts` ("a lost GPU
reloads once per level…", "a background reclaim reloads under its own
cap…", "a failed frame reloads twice in ten minutes…") into a new
`lib/city/gpu-recovery.test.ts`, unchanged but for imports. They test the
caps' independence, which the session's sequences do not. Add the arrival
tests: the four rows of the table, the gating at levels 0–3 (style and
Modell kept at 0 and 1, both gone at 2 and 3; position, date and the other
look keys kept at every level), and that `arrivalOf` returns a new object
(the parsed snapshot is not mutated). Use the `valid` snapshot shape from
`lib/city/snapshot.test.ts` with a `model` added to its camera (take a
`ModelStateJson` from an existing test: `grep -rn "preset:" lib/city/*.test.ts`).

**Verify:** `bun test lib/city/gpu-recovery.test.ts lib/city/gpu-safety.test.ts`
pass, with the same total count as step 1's `gpu-safety.test.ts` plus the
new arrival tests. `grep -n "^import" lib/city/gpu-recovery.ts` shows
`snapshot` only as `import type`. `bun typecheck` exits 0 (it fails in
`app/_components/gpu-recovery.ts` until step 3 if you do not update its
import; do that now — import the caps from `@/lib/city/gpu-recovery`).

### Step 3: The session

Rewrite `app/_components/gpu-recovery.ts` around `createRecoverySession`.
Keep `KEY`, `RECENT_MS`, `session()`, `Stored`, `historyOf` and `read` as
private helpers, and the module's head comment (add one paragraph on the
peek/commit order and why). Each method is one of today's functions,
body unchanged:

| method | today | notes |
|---|---|---|
| `peek()` | `peekRecoverySnapshot` + `recoveryWasReset` | one `read`: `{ snapshot, reset: stored.reset === true }`, or null |
| `landed()`, `abandoned()` | `takeRecoverySnapshot` | one private `take()`; no return value |
| `onLoss(how, snapshot, ladder)` | `recoverFromGpuLoss(how, snapshot, ladder.level, ladder.raise, store, now())` | the write before the raise; the new record drops `reset` (as today) |
| `leave({ kind: "lighter", ladder }, s)` | `recoverOnRequest(s, ladder.level, ladder.raise, store)` | the raise first, whatever the store; its answer ignored (as today) |
| `leave({ kind: "reset" }, s)` | `keepPlaceForReload(s, store, { reset: true })` | null snapshot: nothing written (as today) |
| `followsRecovery()` | `recentlyRecovered(store, now())` | |

Every method keeps today's `try`/`catch` and the null-store answers: no
store → `peek` null, `onLoss` false, `followsRecovery` false, `landed`,
`abandoned` and the reset do nothing, the lighter one still raises.

Delete the seven old exports. Export `createRecoverySession`,
`pageRecovery`, and the types `RecoverySession`, `Ladder`, `Waiting`,
`Leaving`.

Rewrite `app/_components/gpu-recovery.test.ts` through the session, with
a settable clock (`let t = 0; const session = createRecoverySession(store, () => t)`).
Keep `memoryStore()` and `ladder()`. Every existing test moves, with its
name and its numbers unchanged:

1. a lost GPU reloads where the player stood, and the next load puts it
   back once (`onLoss` → `peek` → `landed` → `peek` null; `followsRecovery`
   true at 60 000, false at 121 000);
2. each reload after a loss is a level lighter, and the lightest shows the
   message (three `true`, then `false` at level 3; `raises()` is 3);
3. a level that cannot be stored means no reload — and add: the record was
   written before the raise (`peek()` returns the snapshot);
4. reclaimed: three in half an hour, a fourth refused, one more after
   1 800 001 ms, `followsRecovery` after it; the level unchanged;
5. failed: two in ten minutes, a third refused, no raise, one more after
   600 001 ms;
6. a page lost before its first frame (`onLoss(…, null, …)`) keeps the
   place it booted at;
7. *Leichter weiter* (`leave({ kind: "lighter" })`) raises the level and
   keeps the place past every cap;
8. a reset keeps the place, is no recovery, and is cleared by landing;
   *Leichter weiter* after it clears the mark;
9. without storage (a `setItem` that throws) `onLoss` gives up;
10. with site data blocked (the `sessionStorage` getter throws) every
    method of `pageRecovery()` gives up quietly, `leave` does not throw.

New tests, each a sequence through the session (and `arrivalOf` where the
boot reads it):

11. **StrictMode:** `onLoss` → `peek` → (the boot is aborted: nothing) →
    `peek` returns the same → `landed` → `peek` null.
12. **A place picked meanwhile wins:** `arrivalOf({ …, picked: true })` has
    no snapshot and no note; `landed()` drops the stored one; the reload
    times stay (`followsRecovery` still true).
13. **A failed boot drops the snapshot:** `peek` → `abandoned` → `peek`
    null; the reload times stay.
14. **A loss after a reset mark** clears the mark (`peek().reset` false).
15. **A snapshot that does not parse** is taken by `landed()` (the one
    change, Findings).

**Verify:** `bun test app/_components/gpu-recovery.test.ts` → 15 pass.
Every reload count and every `true`/`false` in tests 1–10 is the same as
before. Otherwise STOP.

### Step 4: The callers

`app/_components/gpu-safety.ts` (`crashedBefore`),
`app/_components/crash-reports.ts` (`reportPrevious`) and
`app/_components/crash-report.tsx` (`initialOffer`): `recentlyRecovered()`
becomes `pageRecovery().followsRecovery()`. Update the comments that name
`recentlyRecovered` (`lib/city/crash-reports.ts` ≈ 560,
`crash-report.tsx`'s head comment).

`app/_components/city-walk.tsx`:

- Imports: drop the six old names; import `pageRecovery` (and the
  `Ladder` type if you name one) from `./gpu-recovery` and `arrivalOf`
  from `@/lib/city/gpu-recovery`.
- `recovery.current.prepare` (≈ 619): drop its `restoresLook` check; the
  arrival's snapshot is already gated. Update the ref's comment (≈ 601).
- `reloadAfterFailure` (≈ 636): `if (lighter) pageRecovery().leave({ kind: "lighter", ladder: { level: budget.safety, raise: (from) => raiseSafety(from) } }, recovery.current?.capture() ?? null)`.
  The release and reload after it are unchanged.
- `resetQuality` (≈ 656): `keepPlaceForReload(…, { reset: true })` becomes
  `pageRecovery().leave({ kind: "reset" }, recovery.current?.capture() ?? null)`.
  `resetSafety()` first and `disposeForReload` after stay as they are.
- The boot preamble (≈ 748–760):

  ```ts
  const recoveries = pageRecovery();
  const waiting = recoveries.peek();
  const parsed = waiting ? parseSnapshot(waiting.snapshot) : null;
  const arrival = arrivalOf({
    snapshot: parsed?.ok ? parsed.snapshot : null,
    reset: waiting?.reset ?? false,
    picked: start !== null,
    level: budget.safety,
  });
  if (arrival.snapshot) {
    recovery.current?.prepare(arrival.snapshot);
  }
  ```

  Keep the comment on why it peeks (StrictMode), shortened, and point at
  `RecoverySession.peek`.
- `initialCamera: start ? start.camera : arrival.snapshot?.camera`.
- `onGpuLost`: `!cancelled && recoveries.onLoss(how, recovery.current?.capture() ?? null, { level: budget.safety, raise: (from) => raiseSafety(from, { by: trail.startedAt }) }) ? () => location.reload() : null`.
  Keep its comment on `by`.
- The first-frame branch: after `trail.note("first frame")`, call
  `recoveries.landed()` once. The `start` branch loses its
  `if (restored) takeRecoverySnapshot()`. The restored branch becomes
  `else if (arrival.snapshot)`: `h.applyCameraState(arrival.snapshot.camera)`,
  then `if (arrival.note) trail.note(arrival.note.event, arrival.note.detail)`,
  then `if (arrival.sayLighter) sayHud("Mit weniger Details neu geladen – Erweitert › Qualität")`.
  The text of the HUD message stays in `city-walk.tsx`.
- The `catch`: `takeRecoverySnapshot()` becomes `recoveries.abandoned()`.
  It stays inside `if (!(cancelled || aborted))`: an aborted boot commits
  nothing.
- The effect's dependency list does not change (`pageRecovery` and
  `arrivalOf` are module functions).

Check the order of the trail notes against today: `first frame`, then
`recovered` / `quality reset`. It must be the same.

**Verify:** `grep -n "takeRecoverySnapshot\|peekRecoverySnapshot\|recoveryWasReset\|recoverFromGpuLoss\|recoverOnRequest\|keepPlaceForReload\|recentlyRecovered" app lib -r`
→ no match. `bun typecheck` and `bun lint` exit 0.

### Step 5: Docs

- `docs/rendering.md`, the paragraph "**If the GPU is lost anyway**"
  (≈ 1068): add one sentence: the record and its protocol are one
  recovery session (`app/_components/gpu-recovery.ts`): the page peeks
  before the boot and commits once the scene is up or the boot failed, so
  a boot StrictMode aborts leaves the place for the next; the caps and
  the arrival rule are pure (`lib/city/gpu-recovery.ts`).
- Do not edit `app/(legal)/datenschutz/page.mdx`, `storage-keys.ts` or
  ADR 0047: nothing stored changes, and no rule changes.
- `AGENTS.md` needs no change (its `lib/city/` bullet names no module).

**Verify:** `bun test lib/docs` passes.

### Step 6: The gate

`bun run fix && bun run verify` → exit 0.

## Verification

| What | Command or action | Expected |
|---|---|---|
| The session | `bun test app/_components/gpu-recovery.test.ts` | 15 pass |
| The caps and the arrival | `bun test lib/city/gpu-recovery.test.ts lib/city/gpu-safety.test.ts` | pass |
| The privacy pin | `bun test app/_components/storage-keys.test.ts` | pass, file untouched |
| The gate | `bun run verify` | exit 0 |
| e2e | `bun run test:e2e --grep "@phone\|@desktop-hud"` | pass (slow; if Playwright's browser is missing in the container, say so in the row) |
| Untouched | `git diff --stat -- "app/(legal)" app/_components/storage-keys.ts app/_components/create-app.ts lib/city/page-lifecycle.ts` | empty |
| Entry chunk | `grep -n "^import" lib/city/gpu-recovery.ts app/_components/gpu-recovery.ts` | no runtime import of `snapshot` |

**Manual check in the preview** (`bun dev`, Chrome, devtools open on the
Application tab, *Session storage* › `gpu-recovery`, *Local storage* ›
`gpu-safety`; `crashTrail.current()` in the console prints the trail):

1. **A loss.** Open `/dresden?gpu=webgl2&trail=1`, walk somewhere off the
   spawn, set the time and a picture style. In the console:
   `[...document.querySelectorAll("canvas")].map((c) => c.getContext("webgl2")).find(Boolean).getExtension("WEBGL_lose_context").loseContext()`
   (the minimap's 2D canvases answer null). Expected: the trail notes
   `render stopped`, `reloading`; the page reloads where you stood, with
   your time and style (level 1 keeps it); `gpu-safety` reads level 1;
   the HUD says *Mit weniger Details neu geladen*; once the scene is up
   `gpu-recovery` holds `tries` and no `snapshot`.
2. **The caps.** Repeat twice: level 2 comes back without the picture
   style and without Modell (enter Modell before the loss); level 3 shows
   the card *Die Grafik ist ausgefallen*. *Leichter weiter* reloads where
   you stood; *Neu laden* at the spawn.
3. **The reset.** With level > 0 stored and no `?safety=` in the address,
   *Erweitert › Qualität › Volle Qualität*: the page reloads where you
   stood, the trail notes `quality reset`, no HUD message, and
   `gpu-recovery`'s `tries` did not grow. (`?safety=N` pins the page and
   hides the button: `quality-panel.tsx`, `resettable`.)
4. **StrictMode.** In `bun dev` the boot effect mounts twice. After step
   1's loss the place still comes back: the first boot's abort did not
   take it.
5. **`?safety=2`** boots in the default style and on foot or in the air
   after a loss; `gpu-safety` is not written by the override.

The automatic recovery stays unverified on a real iPhone (plan 019 §M).
This plan does not change that; say so in the row.

## STOP conditions

Stop and report, do not improvise, if:

- Anything stored changes: a key, a field of the record (`snapshot`,
  `tries`, `reclaims`, `failures`, `reset`), or when it is written. The
  privacy page and `storage-keys.test.ts` must stay untouched.
- A reload count or a `true`/`false` in any of tests 1–10 differs from
  today's test.
- Step 1 finds the boot reading `initialCamera.model`: the gated camera
  would then change the boot. Report it; do not split the camera in
  two without asking.
- The trail's note order changes (`first frame` before `recovered` /
  `quality reset`), or a note's text changes: the reports read them.
- Keeping `snapshot.ts` out of the entry chunk would need a runtime
  import from it in either recovery module.
- `createRecoverySession` would need a DOM API in `lib/city/`.

## Out of scope

- Folding the two `renderer.onDeviceLost` wraps in `create-app.ts`
  (≈ 893 and ≈ 3034). The second carries the device's reason into the
  trail and is ordered before `render stopped`. That is a separate
  change, in plan 066's binder.
- The lifecycle machine itself (`lib/city/page-lifecycle.ts`), its
  `mayReload`, and `GpuLoss` / `frameLoss` / `RESUME_*` in
  `lib/city/gpu-safety.ts`.
- The ladder (`app/_components/gpu-safety.ts`: `raiseSafety`,
  `resetSafety`, `settleSafety`, `pageSafety`) and `restoresLook`.
- `releaseGpu` and `disposeForReload` on the handle, and the failure card
  (`gpu-failure-card.tsx`).
- *Neu laden* keeping the place too. Today it reloads at the spawn; that
  is a behaviour change, for the maintainer.
- A Playwright spec that loses a device (WebGL2's `WEBGL_lose_context`
  could do it headless). Worth a backlog line; not this refactor.

## Maintenance notes

- A new way the page leaves or arrives is a method or a `Leaving` kind on
  the session, with a sequence test; `city-walk.tsx` only calls it.
- A new arrival rule (what comes back at which level) is a row in
  `arrivalOf`'s table and its test, never a branch in `city-walk.tsx`.
- `landed()` and `abandoned()` commit the same today. If they ever
  differ (for instance, a failed boot that should keep the place for one
  more try), that is where it goes, and test 13 changes.
- ADR 0047 lists "caps in time on recovery reloads" as a rejected
  alternative: the bound is the levels. The time windows here are the
  tab's net under the ladder (`LOSS_WINDOW_MS` for a `?safety=N` page),
  not that alternative. Keep their comments saying so.
- Reviewer: diff the record before and after for each of tests 1–10 (the
  JSON in the memory store). It must be identical.
