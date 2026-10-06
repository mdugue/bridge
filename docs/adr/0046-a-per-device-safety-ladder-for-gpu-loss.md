# ADR 0046: A device that lost its GPU gets a lighter page, one safety level per loss, kept across visits and decaying over days

- **Status:** accepted
- **Date:** 2026-10-06

## Context

Thirteen Sentry events from one iPhone (Safari, WebGPU, a 603×1311
drawing buffer at pixel ratio 1.5; issues CITY-WALK-1…8) showed the GPU
recovery of plan 038 running in a loop. The GPU process went at 495–761 MB
held (three's `info.memory.total`): "GPUCommandEncoder.finish: Unable to
finish", "createCommandEncoder: Unable to make command encoder" — once on
the first frame after two minutes in the background —, "Range consisting
of offset and length are out of bounds … createAttribute" (a
`mappedAtCreation` buffer whose allocation failed) and, after it, the
rejection "t.get(this._getBufferAttribute(e)).buffer.destroy" from freeing
the half-made attribute.

`gpu-recovery.ts` reloaded the page where the player stood, at most twice
in ten minutes (the docs said two). The recovered page got the very budget
that had just failed — pixel ratio 1.5, the 2048² shadow map, a tile cache
of 320–600 MB, the memory governor back at its first step — and the same
look (Comic, Modell), put back after it had first booted at the spawn. It
held 534 MB three seconds in and 642–677 MB within twenty, then lost the
GPU at 495–531 MB, lower than the first loss at 614 MB. The cap ran out 62
seconds after the first loss and left a frozen canvas with an 11-px pill
of WebKit's raw text. Pages also died right after their first frame at
only 277–312 MB held (the page's own process, killed in the boot burst:
[ADR 0047](./0047-phone-memory-budget-in-true-bytes.md)).

The reports misread the loop as well: a tab opened in the background
never left the state "running", so its kill came in as "Page died in
use"; a recovery page that died before its first frame was suppressed as
the record iOS leaves around a reload; and what a dying page did last (the
`buffer.destroy` rejection, the fetches its reload cancelled) came in as
new problems.

What a page can know about its device is little: Safari exposes neither
`navigator.deviceMemory` nor `performance.memory`. What it does know is
whether this device ran out before — the crash trail of the previous page
(ADR 0043) and the losses it saw itself.

## Decision

**A safety level per device, 0–3, kept in local storage** under one key,
`gpu-safety`: `{ level, raisedAt, crash?, raisedBy? }`
(`lib/city/gpu-safety.ts`, pure; `app/_components/gpu-safety.ts`, the
storage, every access in `try`/`catch`). It is settled once per page,
before the budget is made (`pageSafety()` → `currentSceneBudget`), and
every budget table takes it (`SceneBudget.safety`).

**What raises it**, by one each time (`raisedSafety`: one above the higher
of what is stored and the level the page runs at, at most 3):

- a GPU lost in use that reloads the page — the raise is stored before the
  reload, and a raise that cannot be stored means no reload: the next page
  would be no lighter;
- the previous page, on WebGPU, offered by the crash trail as a crash —
  once per record (the record's start is kept as `crash`), and not if that
  page answers that it is still open in another tab (`pageStillOpen`):
  the level settles only after the answer (at most 250 ms, beside the
  manifest's fetch, and asked only for a record that looks crashed), so no
  page runs at a raise that turns out not to be one;
- a memory emergency in the page (a `GPUOutOfMemoryError`, a compile the
  stream reports out of memory: `memoryEmergency` in `create-app.ts`) —
  once per page, and only in use: an allocation refused while the page is
  hidden or within 5 s of a return is the symptom of a reclaimed GPU
  (below), no sign of the page's;
- the visitor's *Leichter weiter* on the failure card.

**One incident raises it once.** A memory emergency foretells the loss
that follows it, and a page killed after one died of the same shortage.
A raise in use names the page (`raisedBy`, its crash record's start): the
page's own loss after its emergency renews that raise — at least a level
above the page — instead of adding one, and its record, offered as a
crash on the next load, raises nothing more (it is only marked counted).
Another tab's raise in between is not the page's own, and *Leichter
weiter* is a request on top: it adds a level, so it is lighter than *Neu
laden*.

**What lowers it:** time. One level per three days since it was last
raised (`SAFETY_DECAY_MS`; a clock set back gains nothing). `?safety=N`
(0–3) sets one page's level for QA and stores nothing.

**What each level changes** (`scene-profile.ts`, `memory-governor.ts`):

| Level | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| pixel-ratio cap, phone · desktop | 1.5 · 2 | 1.25 · 1.5 | 1.0 · 1.25 | 0.85 · 1.0 |
| shadow map, phone · desktop | 2048² · 3072² | 2048² · 2048² | 1024² · 2048² | 1024² · 1024² |
| tile cache, phone (min–max, MiB) | 168–336 | 148–296 | 136–272 | 96–232 |
| tile cache, desktop (min–max, GB) | 1.2–1.6 | 1.0–1.4 | 0.8–1.2 | 0.6–1.0 |
| governor lines (× 0.9 per level; phone soft / hard, MiB) | 480 / 560 | 432 / 504 | 389 / 454 | 350 / 408 |
| governor floor, phone · desktop | 0 · 0 | 1 · 0 | 2 · 1 | 3 · 2 |
| the sun's shadow camera streams tiles | yes | yes | no | no |
| a recovered page puts back the picture style and Modell | yes | yes | no | no |

The governor starts at its floor — already for the stream's first update —
and never steps above it. From level 2 the remembered picture style is
not used either (it stays stored): a Comic page held 761 MB, a Modell view
699 MB, and putting them back replays the load that took the GPU.

**Recovery is bounded by levels, not by time** (`gpu-recovery.ts`,
`mayRecover`). A GPU lost in use reloads once per level — the reload is a
level lighter — and not from level 3; a tab-wide net of three loss reloads
in ten minutes covers a `?safety=N` page, whose level cannot rise. Past
that the HUD shows the failure card (`gpu-failure-card.tsx`): *Die Grafik
ist ausgefallen*, one sentence, *Leichter weiter* (a level lighter, back
where the player stood, past every cap) and *Neu laden*, the browser's own
words folded under *Details*.

**A frame that throws is a loss only with a sign of the GPU running out**
(`frameLoss`): an allocation error (`lib/city/gpu-allocation.ts`), a
memory emergency on the page before it, or a GPU that no longer takes
work (the resume guard's probe, below). Otherwise — a `TypeError` from a
node build, a bug in three, and every throw on the WebGL2 backend, which
has nothing to probe — it is `failed`: noted `frame failed` (a report),
reloaded where the player stood at the same level, at most twice in ten
minutes (the old cap), then the card. A bug that comes back with the
place would otherwise climb the ladder in three reloads and leave a
desktop at level 3 for nine days. A device the browser reports lost (a
WebGL2 context loss too) stays a loss.

**A reload frees the old device first.** `renderer.dispose()` runs before
it (raced against 300 ms): it unhooks every geometry's dispose listener
and destroys the device, which WebKit otherwise frees only once the old
document is collected — after the new page has started allocating in the
same process. A page hidden at that moment reloads once it is visible: a
page reloaded in the background boots hidden, which is where iOS takes
GPUs away.

**A recovered page starts where the player stood.** The snapshot
(session storage) is read before the boot; the tile under the camera is
the start tile (`startTileOf`), the pose is set before the stream's first
update — **looking straight down** onto that tile (the pitch clamped to
its limit) — and the first frame waits for that tile, or for any shown
tile once the renderer is idle without it. A pose that looks at the sky,
or out past the site's edge, from the air sees no tile: nothing would be
requested, and by night or from level 2 no shadow camera streams one, so
the boot would wait for ever, every reload of the tab replaying it. The
player's own aim goes back once the tile has landed, and the HUD applies
the whole camera after the first frame. A page lost before its first
frame keeps the snapshot it booted with for the next load (it has no
camera of its own to give); a boot that fails takes it, so the next load
starts at the spawn.

**A GPU taken in the background is not the page's failure** (the resume
guard in `create-app.ts`). Hidden, a phone's page lets go of every tile not
in use at once (`unloadPercent` 1 for that call: no frame runs in a hidden
page to free the rest) and keeps none while hidden (the cache's lower
bound 0, whatever step the memory governor takes meanwhile). Shown again,
it gets its cache back and probes the GPU — an empty command buffer
encoded, finished and submitted — before the next frame. A failed probe,
a device lost while hidden, or a frame that fails within 5 s of a return
after at least 10 s away (`RESUME_WINDOW_MS`, `RESUME_AWAY_MS`) is noted
`gpu reclaimed`: the page reloads at the same level, under a cap of its
own (three in 30 minutes). The time away is the wall clock's: iOS stops
`performance.now()` while the device sleeps, and an hour with the phone
locked would read as a glance away.

**The reports tell these apart** (`lib/city/crash-reports.ts`,
`lib/city/crash-trail.ts`, ADR 0043). A trail that starts in a hidden
document starts `hidden`, and a kill there is no crash. After a recovery
only a record with nothing but its start (no first frame, no stage note,
no beat with frames) is suppressed; a recovery page that dies is reported
as "Recovery page died (phase, backend)" with a fingerprint of its own.
Whatever a page notes after `render stopped`, `reloading` or `gpu
reclaimed`, or after it ended clean (pagehide, the viewer's end), is its
aftermath: a breadcrumb, no event, no session error. So is a reclaim's
own word — a `device-lost` or an `alloc-failed` noted while the page is
hidden or within the 5 s after a return (the same constants as the
resume guard's): the device's note comes before the page notes `gpu
reclaimed`, and the order the signs arrive in must not decide the
report. A page that does not reload (the failure card, or a failed boot)
notes `gpu failed`, reported even past saving: after a reclaim it is the
only word there is. Every report carries the tags `safety`, `resumed_s`
(seconds since a return after ≥ 10 s hidden, when under a minute) and, on
a crash, `restart_gap_s` (the next page's start minus the record's last
write: under ~2 s, Safari reloading a page whose process it killed — its
last beat may be 2 s before the death); both by the wall clock the trail
keeps beside its own (`hiddenWall`, `lastWall`), so a sleep in between
does not skew them. `alloc-failed` is a warning, `device-lost` and `gpu
failed` fatal; `gpu reclaimed`, `memory emergency` and `safety` are never
problems. A page's cap of five problems counts only those it goes on
after — one out-of-memory episode is one `alloc-failed`, whatever the
parts it failed on — and the first problem that ends the page
(`device-lost`, `frame failed`, `boot failed`, `gpu failed`) goes out
past it; the first only, so a failure card is one report: its cause's,
or its own after a reclaim.

## Consequences

- A device that crashed looks plainer for days: up to nine, three levels
  of three days. At level 3 a phone draws at pixel ratio 0.85, visibly soft
  on a 3× panel. A desktop reaches the levels only through WebGPU losses
  and crashes of its own; a bug that throws in a frame costs it a reload,
  never a level.
- A browser whose storage is blocked never reloads after a lost GPU: it
  shows the card. The privacy page names the key, what it holds and its
  decay (ADR 0045).
- A page whose previous record looks crashed waits up to 250 ms for that
  page to answer before its budget is made (in parallel with the
  manifest's fetch); a GPU recovery's own reload is never asked, its
  record carries `reloading`.
- A new cost per frame or per tile that a phone may not afford gets a
  value per level in the tables of `scene-profile.ts` (or the governor's),
  never a switch of its own; the tests hold every rung strictly lighter
  than the one before and level 0 as it was.
- `memoryEmergency` is the one entry for every allocation-failure signal;
  a new one connects there.
- The automatic recovery, the probe, the release and the emergency are
  unverified on a real iPhone (plan 019, section M).

## Alternatives

- **Caps in time** (the old two reloads in ten minutes): they bound the
  loop's length, not its load. Every reload replayed the budget that had
  failed, failed sooner, and the cap ended it in a frozen canvas.
- **Session-only state** (`sessionStorage`, like the recovery snapshot):
  it survives a reload, not Safari's kill-and-reopen, a new tab or the
  next visit — and the device that ran out at 600 MB will run out on the
  next visit too. Session storage keeps only what belongs to the tab: the
  snapshot and the reload times.
- **A user-facing quality menu** (the backlog's direction option 5):
  the first crash still happens, and the visitor has to know what failed.
  Not rejected: the ladder's tables are what such a menu would set, so it
  could become one later; deferred.
- **A loss that also counts the background reclaims**: a reclaim says
  nothing about the page; every phone switched away from for a while
  would end up plain.
- **Stepping the budget down inside the page** (resizing the screen
  targets and the shadow map, rebuilding the post pipelines): a hitch and
  the builds again, on a device already short of memory. The ladder
  applies at boot, where everything is built once; inside the page the
  memory governor stays the knob.

## References

- `lib/city/gpu-safety.ts` (+ test), `app/_components/gpu-safety.ts`
  (+ test), `app/_components/gpu-recovery.ts` (+ test),
  `app/_components/gpu-failure-card.tsx`, `app/_components/scene-profile.ts`
  (+ test), `lib/city/memory-governor.ts` (+ test),
  `app/_components/create-app.ts` (`stopRendering`, `onFrameFailed`,
  `probeGpu`, `releaseGpu`, `memoryEmergency`, the resume guard),
  `lib/city/gpu-allocation.ts` (+ test),
  `app/_components/city-walk.tsx` (the restore),
  `app/_components/city-walk-client.tsx` (the level settled before the
  budget), `lib/city/crash-trail.ts`, `lib/city/crash-reports.ts`
  (+ tests)
- Sentry CITY-WALK-1…8; [plan 038](../plans/completed.md#038--five-runtime-fixes-in-the-viewers-spine--done-2026-10-03)
  step 3 (the reload loop's first cap); the backlog's item 11 in
  [plans/README.md](../plans/README.md)
- [ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md),
  [ADR 0045](./0045-legal-pages-from-the-deployment.md),
  [ADR 0047](./0047-phone-memory-budget-in-true-bytes.md),
  [ADR 0048](./0048-network-failures-are-retried.md)
