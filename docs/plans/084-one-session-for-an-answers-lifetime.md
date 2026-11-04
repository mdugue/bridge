# 084 — One session for an answer's lifetime: reading aloud, dictation and the scene's waits in one module

**Status:** TODO

Planned 2026-11-04 from an architecture review of *Frag die Stadt* and
its Sprachführer (ADR 0056, 0057), verified against `04d8fad3`. Mostly a
refactor. Four behaviours change, each decided by the maintainer; they
are listed in Findings, "Decisions", and each one is its own step. No new
request, no new report field, no new browser-storage key, and no audio
leaves the browser.

> **Executor instructions.** Read the whole plan first, then ADR 0056,
> ADR 0057, `app/_components/ask-city.tsx`, `ask-voice.ts`,
> `ask-scene.ts`, `ask-scene-tools.ts` and `lib/city/frame-pace.ts`. Each
> step ships on its own, as its own commit (Conventional Commits, scope
> `frag`), and leaves `bun run verify` green. Do them in order, and stop
> after any step if a STOP condition says so. When you stop, update this
> plan's row in `docs/plans/README.md` with what you built and what you
> did not; add the row if there is none:
> `084 | One session for an answer's lifetime | …`. Words follow the
> `codebase-design` skill: module, interface, seam, adapter, depth,
> leverage, locality.
>
> **Drift check (run first):**
> `git log --oneline 04d8fad3..HEAD -- app/_components/ask-city.tsx app/_components/ask-voice.ts app/_components/ask-scene.ts app/_components/ask-scene-tools.ts lib/city/frame-pace.ts app/_components/model-rig.ts docs/adr/0057-the-sprachfuehrer-speaks-with-the-browsers-voice.md`
> and `grep '"version"' node_modules/@tanstack/ai-client/package.json`
> (planned against 1.0.1).
> - If a commit changed `useReadAloud`, `VoiceBar`, `ask`/`askSpoken`, the
>   stop button or the unmount effect, redo the rule table before you
>   start.
> - If `@tanstack/ai-client` changed, re-read `ChatClient.stop` and
>   `addToolResultForClientTool` (Findings, "Ordering").
>
> Line numbers are not given; find code by its name.

## Context

An answer in *Frag die Stadt* has a lifetime: it is asked (typed or
spoken), it streams, it may wait on a scene tool (`was_ist_da` waits for
a glide to land and the tiles to come), and it ends as done, failed or
stopped. Reading aloud, the microphone, the Hörmodus's frame pace and
the scene tools' waits all react to that lifetime. Today those
reactions are wired by hand, spread over five places:

- in `ask-city.tsx`: `AskCity`, `VoiceBar`, `Conversation` (`ask`,
  `askSpoken`, the stop button, the unmount effect) and `useReadAloud`;
- in `useAskScene` (`ask-scene.ts`), which holds the scene's half.

`ask-city.tsx` is 1 058 lines with no unit test, and the repo has no
React test tooling. None of the rules below is tested. Two orderings
already disagree: the unmount stops the chat before abandoning the
waits, the stop button does the reverse. That difference cannot be seen
today (Findings, "Ordering"), but no test would notice when it can.

This plan puts the lifetime behind one pure module,
`lib/city/ask-session.ts`. The module takes events and calls four ports.
Its interface is small (`dispatch`, a state snapshot, `subscribe`), and
every rule becomes a unit test against fakes.

## Findings

### Today's rules (verified 2026-11-04 against `04d8fad3`)

Nothing in this table is tested. What is tested nearby:

- `speakable` and `dictationProblem` (`ask-voice.test.ts`);
- the scene tools' binding (`ask-scene-tools.test.ts`);
- the listening pace (`lib/city/frame-pace.test.ts`, "listening pace");
- one e2e, `e2e/city-walk.spec.ts`, "Frag die Stadt checks a key and
  marks its answer as generated": a key check, the KI label, close.

| Event | Today | Where |
|---|---|---|
| Typed question / suggestion | Refused while loading. Otherwise `speech.stop()`, `prime()` if reading is on, then `sendMessage(q, { body: { voice } })` | `Conversation.ask` |
| Spoken question (recognition result) | While loading or `paused`: the text goes into an empty field, never over a draft. Otherwise reading = `speech.supported`, then it is asked with `voice` = that value | `askSpoken` |
| Mic tap | Closed: `speech.stop`, `prime`, `dictation.start`. Open: `dictation.stop`. Disabled while loading, unless the mic is already open | `VoiceBar` |
| Mic closes | An owed answer is read now | `useReadAloud` |
| Answer done (loading falls, last part is text) | Read when reading is on, the answer did not fail and was not stopped. While the mic is open it is owed until the mic closes ("never into an open microphone"). `lastAnswer` gives "" between tool-resume streams, so nothing is read there | `useReadAloud`, `lastAnswer` |
| Answer failed | Not read. The scene's waits are **not** abandoned | `useReadAloud` |
| Stop button (shown only while loading) | `stopReading` (the answer is owed no more), `scene.abandon`, `chat.stop`. Speech, the mic and a glide the answer started go on | button `onClick` |
| Vorlesen off | `speech.stop`, Hörmodus off, owed answer dropped | `VoiceBar` |
| Vorlesen on | `prime`. An answer that already finished is not read | `VoiceBar` |
| Hörmodus on | `prime`, reading on; `setListening(true)` through an effect | `VoiceBar`, `AskCity` effect, `ask-scene.ts` → `FramePace.setListening` |
| Hörmodus off (banner or switch) | Hörmodus only; reading stays on | `AskCity`, `VoiceBar` |
| Card closes (× or `showStop` → `setAsking(false)` in `city-walk.tsx`) | Unmount, in this order: `chat.stop`, then `scene.abandon`. `useSpeech`'s cleanup cancels speech, `useDictation`'s aborts recognition, the effect's cleanup does `setListening(false)`. Reading and Hörmodus are forgotten (state in `AskCity`) | unmount effects |
| "Schlüssel ändern" / "Schlüssel prüfen" | `Conversation` stays mounted but hidden (`paused`). The answer streams on, its tools run, it is read aloud when done, and a spoken question goes into the field | `AskCity` |
| New key | `Conversation` remounts (`key=`): as a close, but reading and Hörmodus stay | `AskCity` |
| Forget key | `Conversation` unmounts; Hörmodus off, reading off | `KeyForm.onForget` |
| iOS | `prime()` speaks a silent utterance, once per `useSpeech` instance, from a tap. Only a local German voice (`localService`); without one, neither switch shows | `ask-voice.ts` |
| Page hidden / phone locked | No rule for speech, the mic or the stream; an answer is read when it ends if JS still runs. `was_ist_da` alone counts hidden time: 20 s visible (`LAND_MAX_MS`), capped at 30 s of wall time (`HIDDEN_GRACE_MS`), then "unterwegs" | `ask-scene.ts` `waitWhile` |

### Ordering (`@tanstack/ai-client` 1.0.1)

- `ChatClient.stop()` raises `continuationGeneration` synchronously.
- `addToolResultForClientTool` drops a result from an older generation.
- `abandon()` aborts the `was_ist_da` wait, and `look()` settles only a
  microtask later, after a `chat.stop()` called in the same handler has
  run.

So the stop button's order (abandon, then stop) and the unmount's
(stop, then abandon) behave the same, and neither leaks a request on the
visitor's key. The session issues `run.stop` **before**
`waits.abandon` everywhere, so the guarantee does not rest on library
internals.

Checked and harmless: a spoken question sent as the mic closes cannot
read the old answer aloud. `sendMessage` sets `isLoading` and adds the
user message synchronously, before `onend`.

### A failed answer leaves the scene waiting

On a stream error, `streamResponse` returns without awaiting pending
client tools. A `was_ist_da` wait runs on for up to 30 s. Its result
then arrives with the **same** `continuationGeneration`, while
`isLoading` is false. `checkForContinuation` may then send a new
request on the visitor's key, after the visitor saw the error.

This was traced in the code, not reproduced. The fix does not depend on
reproducing it: a failed answer issues `run.stop`, then
`waits.abandon`, like the stop button.

### Decisions (the maintainer's, binding)

1. Closing the card while reading: reading stops (as today).
2. Reopening the card: Vorlesen and Hörmodus forgotten (as today).
3. Key form opened mid-answer: the answer runs on hidden and is read
   aloud (as today).
4. **Change.** Stop button while the answer's glide (`zeige`) flies: the
   camera stops where it is.
5. **Change.** Vorlesen switched on after an answer finished: the last
   finished answer is read now, from the tap (iOS). It is not read into
   an open mic; it is owed until the mic closes.
6. **Change.** Ending the Hörmodus turns Vorlesen off too, if the
   Hörmodus turned it on. If the visitor had Vorlesen on before, it
   stays on.
7. An answer stopped partway is not read (as today).
8. An answer that finishes while the page is hidden or the phone is
   locked is read at once if the page's JS still runs (as today). This
   becomes an explicit rule: the session takes no visibility event.

**Technical decisions** (this plan's):

- `run.stop` before `waits.abandon`, everywhere.
- A failed answer stops the run and abandons the waits (**change**:
  closes the possible resume above).
- Closing the card does not halt a glide. Decision 4 covers the stop
  button only, and the card's × ending an answer is today's behaviour.

### The glide (decision 4)

- `CityWalkHandle.stopGlide` (`create-app.ts`) is `pose.cancelGlide`
  (`camera-pose.ts`). It stops a walk/fly glide where it is, and is
  already used by `city-walk.tsx`'s `endWalk`. Nothing sets
  `camera.position` outside `camera-pose.ts` (ADR 0032); this call keeps
  that.
- Only the answer's own glide stops, never one the visitor started
  since. `useAskScene`'s `show` passes `flyToViewpoint` an
  `onProgress` and keeps a token, cleared at `t >= 1`. This is
  `city-walk.tsx`'s `walkGlide` idiom.
- In Modell, `flyToViewpoint` calls `modelRig.centreOn` (a short glide
  of the rig's own). `model-rig.ts` has no halt. Stopping it is
  optional: see Step 5.

## The module

`lib/city/ask-session.ts`, pure, DOM- and React-free, with
`ask-session.test.ts` beside it. It is
`createAskSession(ports): AskSession` with this interface:

- `dispatch(event)`;
- `state()`: `{ reading, hearing }`, which the switches show;
- `subscribe(listener)`, for `useSyncExternalStore`.

`dispatch({ type: "spoken" })` returns `"sent" | "draft"`; on `"draft"`,
React puts the text into the field.

**Events:**

| Event | When |
|---|---|
| `typed{text}` | Typed question or suggestion |
| `spoken{text}` | Recognition result |
| `answerStarted` | Loading rises |
| `answerEnded{text, failed}` | Loading falls; `text` = `lastAnswer(messages)`; `failed` = `chat.error !== undefined`, **not** the error's classification |
| `stopPressed` | Stop button |
| `micPressed`, `micClosed` | Mic tap; recognition ends |
| `readingPressed`, `hearingPressed` | The switches; the banner sends `hearingPressed` while the Hörmodus is on |
| `paused(on)` | The key form opens or closes |
| `conversationEnded` | `Conversation` unmounts: new key or forgotten key |
| `keyForgotten` | Forget key |
| `closed` | `AskCity` unmounts |

**State:**

- `reading`, `hearing`, `readingByHearing` (decision 6);
- `loading`, `stopped`, `micOpen`, `paused`;
- `owed: boolean`;
- `lastFinished: string | null`: the last answer that ended done, not
  failed or stopped, with text.

**Ports.** Each port has one browser adapter and a fake as its second
adapter, so the seam is real. No production adapter sends audio
anywhere: TanStack's `AudioRecorder` (MediaRecorder to a provider) is
**not** an adapter here.

| Port | Interface | Browser adapter | Second adapter |
|---|---|---|---|
| `Speech` | `prime()`, `speak(text)`, `stop()`, `supported` | `useSpeech` (speechSynthesis, local voice) | `fakeSpeech()`, which records calls |
| `Dictation` | `start()`, `stop()`, `abort()` | `useDictation` (SpeechRecognition; its `onText` dispatches `spoken`, its `onend` dispatches `micClosed`) | fake |
| `SceneWaits` | `abandon()`, `setListening(on)`, `haltAnswerGlide()` | `useAskScene` (AbortController, `FramePace`, `stopGlide`) | fake |
| `Run` | `send(text, voice)`, `stop()` | `useChat` in `Conversation`, attached with `session.attachRun(run)` (returns a detach) | fake |

**Invariants** (each a test):

- Commands run **synchronously inside `dispatch`**. iOS speaks only what
  a tap began, so `prime` and `speak` from a pressed event must stay in
  the tap's call stack. No command is deferred to an effect, a promise
  or a timer.
- `speak` is never called while `micOpen`; such a reading is owed until
  `micClosed`.
- `run.stop` is always called before `waits.abandon`.
- A stopped or failed answer is never read; a failed one stops the run
  and abandons the waits.
- `answerEnded{text: ""}` (a tool-resume gap) reads nothing and keeps
  `lastFinished`.
- No visibility event exists. `answerEnded` while hidden reads at once
  (decision 8).

**What stays in React** (`ask-city.tsx`):

- the JSX, the key form, `errorText` and the failure line, the field's
  draft;
- turning `chat.isLoading` edges and `lastAnswer` into
  `answerStarted` / `answerEnded`;
- turning `dictation.listening` into `micClosed`.

`useSpeech`, `useDictation` and the session move up into `AskCity`, so
there is one instance per card. Reading and Hörmodus already live there,
and iOS priming then survives a key change. `Conversation` attaches the
`Run` port and dispatches `conversationEnded` when it unmounts. That
event does what the remount does today: `run.stop`, `waits.abandon`,
`speech.stop`, `dictation.abort`. `useSpeech`'s own unmount cancel
stays as a backstop.

The Hörmodus effect in `AskCity` goes; `hearingPressed` and `closed`
call `setListening`.

## Steps

### Step 0 — Pin today's rules (the module and its tests; nothing wired)

1. Write `lib/city/ask-session.ts` as described, with **today's**
   behaviour, including today's answers to decisions 4–6 (no glide halt,
   Vorlesen on reads nothing, Hörmodus off leaves Vorlesen) and today's
   failure path (no abandon).
2. `lib/city/ask-session.test.ts`: one test per row of the rule table,
   plus the invariants. Name the four tests that later steps change:
   `stop leaves the glide`, `reading on reads nothing past`,
   `hearing off keeps reading`, `a failed answer leaves the waits`.
3. Nothing imports the module yet.
4. Commit: `test(frag): pin an answer's lifetime in a pure session`.

### Step 1 — Wire the card to the session (no behaviour change)

1. In `AskCity`: create the session with `useSpeech`, `useDictation`
   and the scene (`useOnce`); dispatch `closed` on unmount; read
   `reading` and `hearing` through `useSyncExternalStore`.
2. In `Conversation`: `attachRun` in an effect; the `isLoading` and
   `listening` edges dispatch events; `ask`, `askSpoken`, the stop
   button and `VoiceBar`'s three buttons dispatch.
3. Delete `useReadAloud`, the stopChat ref and the unmount effect. Keep
   the comment's reason (a tool returning at the abort) in
   `ask-session.ts` beside the `run.stop`-first rule.
4. `AskScene` gains `haltAnswerGlide` as a no-op for now; the stub in
   `ask-scene-tools.test.ts` gets it.
5. The e2e spec "Frag die Stadt checks a key…" passes unchanged.
6. Commit: `refactor(frag): one session owns an answer's lifetime`.

### Step 2 — A failed answer stops its run and its waits

1. In the session, `answerEnded{failed: true}` issues `run.stop`, then
   `waits.abandon`.
2. Rewrite `a failed answer leaves the waits` as `a failed answer ends
   its run, then its waits`.
3. Check by hand that `chat.error`, and with it the failure line,
   survives `chat.stop()`. `stop()` sets the status to ready and does
   not call `setError`.
4. Commit: `fix(frag): a failed answer leaves no scene tool waiting`.

### Step 3 — The Hörmodus takes back only its own Vorlesen (decision 6)

1. `hearingPressed` while the Hörmodus is off and reading is off sets
   `readingByHearing`.
2. `hearingPressed` while the Hörmodus is on turns reading off only when
   `readingByHearing` is set.
3. `readingPressed` and `spoken` clear `readingByHearing`: the visitor
   chose reading.
4. Replace `hearing off keeps reading` with both cases.
5. Commit: `feat(frag): ending the Hörmodus ends the reading it began`.

### Step 4 — Vorlesen on reads the last answer (decision 5)

1. `readingPressed` turning reading on, while not loading and with
   `lastFinished` set: `prime` then `speak(lastFinished)` in the same
   dispatch.
2. While the mic is open, the answer is owed instead.
3. Replace `reading on reads nothing past`. Add tests:
   - a stopped answer stays unread;
   - a failed answer stays unread;
   - a new question clears `lastFinished`.
4. Commit: `feat(frag): Vorlesen reads the last answer when switched on`.

### Step 5 — The stop button stops the answer's glide (decision 4)

1. In `useAskScene`'s `show`: pass `onProgress` and keep the token.
2. `haltAnswerGlide()` calls `handleRef.current?.stopGlide()` only while
   the token is the current glide's.
3. The session calls it on `stopPressed` (after `run.stop` and
   `waits.abandon`), never on `closed`.
4. Replace `stop leaves the glide`.
5. **Modell (optional).** A rig glide stops only through a new
   `halt()` in `model-rig.ts` that freezes `view()` at its current
   value, with a `model-rig.test.ts` case. If it needs more than that,
   leave Modell's short centring glide alone and say so in the status
   row.
6. Commit: `feat(frag): stopping an answer stops its glide`.

### Step 6 — Docs

1. Rewrite ADR 0057 in place (`docs/adr/README.md`: an ADR states
   today's decision; no "Update" or "Amendment"):
   - **Decision 1:** reading aloud starts when switched on, with the
     last finished answer. It is never read into an open microphone, and
     is read at once even with the page hidden if the page still runs.
     A stopped or failed answer is never read.
   - **Decision 3:** its banner, its switch, turning Vorlesen off or
     closing the card ends the Hörmodus. Ending it turns Vorlesen off
     again when the Hörmodus turned it on.
   - **New decision:** one session, `lib/city/ask-session.ts`, owns an
     answer's lifetime. The stop button halts the answer's run, its
     scene waits and its glide, in that order. A failed answer ends its
     run and its waits. Commands run inside the tap's dispatch (iOS).
   - **Consequences:** the rules are unit-tested against fakes.
2. ADR 0056 point 2 (the stand-in result) stays true; no edit.
3. The guide (`docs/guide/de/` and `en/using-the-viewer.md`, the
   Sprachführer paragraph): one clause for decisions 4–6, if the
   `docs-upkeep` skill asks for it.
4. The privacy page: **no edit**. This plan adds no request, no field
   and no storage key. Confirm with
   `git diff 04d8fad3 -- 'app/(legal)'` (empty).
5. Add the row to `docs/plans/README.md` (status as built).
6. Commit: `docs(frag): ADR 0057 states an answer's lifetime`.

## Sequencing with plan 082

Plan 082 (`082-one-answer-turn-and-end-codes.md`) and this plan both
edit `ask-city.tsx`. Either may go first; the second rebases. The
conflict surface is three places:

- **`errorText`.** 082 Step 2 moves `errorText`, `KEY_TROUBLE`,
  `KEY_CODES` and `say` to `lib/city/ask-failure.ts`. 084 does not touch
  them, but the `failure` line it leaves in React calls them.
- **`connection`.** 082 Step 3 adds `fetchClient: codedRefusals(fetch)`
  to `Conversation`'s `connection` `useMemo`. 084 Step 1 rewrites the
  hooks around it (`useChat`, the effects).
- **The error check.** 084's `answerEnded.failed` is
  `chat.error !== undefined`. It must not switch to 082's codes; 082 must
  not make a stopped answer surface as an error.

Whichever lands second re-runs its drift check. Both drift checks name
`ask-city.tsx`, so they will trigger.

## Verification

After every step:

- `bun run fix`, then `bun run verify`.
- `git diff --stat` touches only the step's files.
- Step 0's tests pass. Only the four named tests change, each in its
  step; any other changed `expect` is a STOP.

After Steps 1 and 5:

- `bun run typecheck:tsc`;
- `bun run test:e2e --grep "Frag die Stadt"`.

Headless Chromium has no local voice and no recognition, so the voice
bar does not render there and no e2e covers it.

**Manual, on real devices.** Use an iPhone with Safari (a local German
voice such as Anna), an Android phone with Chrome, and desktop Chrome,
Safari and Firefox (Firefox has no recognition, so no mic chip). Use a
real key; `FRAG_FAKE=1` with `bun dev` is enough where its script covers
a step. Check each item; any iOS failure is a STOP.

1. Vorlesen on, ask by typing: the answer is heard (iOS: also after a
   key change, without a fresh tap on Vorlesen).
2. Mic: a spoken question is heard back with Vorlesen switched on by it;
   the mic chip is disabled while it loads.
3. Mic open, then a typed question: the answer is not heard until the
   mic closes, then it is.
4. An answer finished with Vorlesen off; tap Vorlesen: it is heard at
   once (iOS: from that tap). The same with the mic open: heard after
   the mic closes.
5. Hörmodus on from Vorlesen off, then off: Vorlesen off. Vorlesen on
   first, then Hörmodus on and off: Vorlesen stays on. The banner
   behaves as the switch.
6. Ask "Zeig mir das älteste Gebäude", press stop during the glide: the
   camera stops where it is, nothing is read, and nothing more is sent
   (the network panel shows no further `/api/frag`).
7. "Was ist das da vorne?", stop during the wait: the trace says
   *abgebrochen*, and no further request is sent.
8. Lock the phone while an answer streams (Hörmodus on): note whether it
   is heard while locked or on unlock. Either is today's behaviour;
   record what each browser does in the status row.
9. Close the card while it reads: silence, vignette gone, the frame rate
   back. Reopen: Vorlesen and Hörmodus off.
10. "Schlüssel ändern" mid-answer: the answer finishes hidden and is
    heard.
11. A failed answer during `was_ist_da` (go offline mid-wait): the error
    shows, and no request follows within 30 s.

## STOP conditions

Stop, leave the tree green at the last finished step, and write the
reason in the status row if:

- **iOS priming leaves the tap's call stack.** A command reaches
  `prime`/`speak` through an effect, a promise or a timer, or the manual
  iOS checks 1, 2 or 4 fail.
- Any Step 0 test other than the four named needs a different `expect`.
- `chat.error` does not survive `chat.stop()` (Step 2): the failure line
  would vanish.
- Halting a glide needs `camera.position` written outside
  `camera-pose.ts`, or a change to `camera-pose.ts` beyond calling
  `cancelGlide` (ADR 0032). This applies to Step 5.
- Anything needs a new request, report field or storage key; the privacy
  page would have to change.
- `@tanstack/ai-client` is no longer 1.0.1 and `stop()` no longer raises
  the continuation generation synchronously: redo "Ordering" first.

## Out of scope

- **K7, "view settled" owned by the viewer.** The 250 ms
  `STREAM_NOTICE_MS` guess and the 100 ms polling in `ask-scene.ts` get
  their own plan. The session only calls `waits.abandon()`, whose
  interface K7 does not change. K7 may later take the session's
  per-answer signal.
- Any audio leaving the browser. No recorder adapter and no provider
  transcription; dictation stays the browser's (ADR 0057).
- 082's error codes and texts; the server; the prompt's `voice`.
- Visibility handling for speech or the stream (decision 8 keeps today's
  behaviour).
- React test tooling: the rules are tested in the pure module.

## Maintenance notes

- A new rule about an answer's lifetime goes into `ask-session.ts` with
  its test, never into a handler in `ask-city.tsx`.
- A new side effect is a port method with its fake.
- `prime` and `speak` stay synchronous in `dispatch`; a test pins that
  `readingPressed` speaks before `dispatch` returns.
- The four-port seam is for testing: the fakes are the second adapters.
  A production second adapter (another speech engine) needs an ADR and,
  if it sends anything, the privacy page.
- When this plan is DONE, condense it into `completed.md` per the
  README's Lifecycle.
