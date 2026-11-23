# 082 — One answer turn, and a code for every way it ends

**Status:** BUILT (2026-11-04; see the row in README.md)

Planned 2026-11-04 from an architecture review of *Frag die Stadt*
(ADR 0056), verified against `04d8fad3`. A refactor with one visible
side: the page reads the server's reason instead of guessing it. No new
request, no new field leaves the browser, no text a visitor sees changes
except where Findings says it does.

> **Executor instructions.** Read the whole plan, ADR 0056,
> `app/api/frag/route.ts`, `lib/city/ask-run.ts` and `errorText` in
> `app/_components/ask-city.tsx` first. Each step ships on its own, as
> its own commit (Conventional Commits, scope `frag`), and leaves
> `bun run verify` green. Do them in order; stop after any step if the
> STOP conditions say so. Update this plan's row in
> `docs/plans/README.md` (add one if none: `082 | One answer turn and
> its end codes | …`) when you stop, with what you built and what you did
> not. Words in this plan follow the `codebase-design` skill: module,
> interface, seam, adapter, depth, leverage, locality.
>
> **Drift check (run first):**
> `git log --oneline 04d8fad3..HEAD -- app/api/frag app/api/schluessel lib/city/ask-run.ts lib/city/ask-run.test.ts lib/city/ask-city.ts app/_components/ask-city.tsx e2e/city-walk.spec.ts docs/adr/0056-frag-die-stadt-runs-on-the-visitors-key.md`
> and `grep '"version"' node_modules/@tanstack/ai*/package.json`
> (planned against `@tanstack/ai` and `@tanstack/ai-client` 1.0.1). A
> commit that touched `route.ts` or `ended`: redo the order list and the
> text table in Findings before you start. A new `@tanstack/ai-client`:
> re-read `assertResponseOk` and the `fetchClient` option (Findings,
> "How a reason reaches the page"). Line numbers are not given; find code
> by its name.

## Context

`POST /api/frag` relays one turn of a visitor's chat to their provider.
Its handler composes six exports of `lib/city/ask-run.ts`
(`withStoppedCallsAnswered`, `roundsSinceQuestion`, `runAsk`, `scrubbed`,
`ended`, `DEADLINE`) and four of `lib/city/ask-city.ts`
(`parseAskProps`, `plausibleKey`, `conversationProblem`, `lastQuestion`)
in an order that matters, with two `AbortController`s and a timer. The
parts are deep and tested (`lib/city/ask-run.test.ts`, 20 tests); the
composition is not tested at all, and it is where the bugs were: 8 of the
19 `fix(frag)` commits on main touched `route.ts`.

The page then guesses why an answer failed. The server knows (a refusal
has a code; a run's end is classified as a `RunEnd`), but the end is
collapsed into a German sentence without a code, and the refusal's code
never reaches the page. `errorText` in `ask-city.tsx` re-derives the
reason from the HTTP status, provider codes and
`message === TOO_MANY_STEPS`, with its own copies of the server's texts.

This plan puts the turn behind one function whose seam is the model
adapter (two adapters exist: the providers' and the scripted
`FRAG_FAKE=1` model), makes every refusal and end carry a code, and
gives server and page one table of code → words.

## Findings

### The claims of the review, checked (2026-11-04)

- **Route composition: true.** `POST` in `app/api/frag/route.ts` (with
  its helpers `refuse`, `answerHistory`, `conversationRefusal`,
  `keyRefusal`) runs, in this order: (1) `chatParamsFromRequestBody` on
  the JSON body → 400 `bad-request`; (2) `parseAskProps(forwardedProps)`
  → 400 `bad-props`; (3) `keyRefusal`: not scripted and
  `!plausibleKey` → 401 `no-key`; no scripted model, no `FRAG_SECRET`
  and `NODE_ENV === "production"` → 501 `no-secret`; not scripted, a
  secret, `verifyAskToken` false → 401 `bad-token` (outside production
  without a secret, nothing checks the token); (4) caps on the **raw**
  rows, `conversationProblem(params.messages, lastQuestion(...))` →
  413 `too-long`; (5) `answerHistory`: `withStoppedCallsAnswered`, then
  `turns = ASK_LIMITS.answerRounds − roundsSinceQuestion(mended)`; a
  throw → 400 `bad-request`, `turns <= 0` → 422 `too-many-steps`;
  (6) `siteById` + `siteKnowledge` → 404 `no-knowledge`; (7) two
  controllers: `abortController` (given to `toServerSentEventsResponse`,
  aborted by the request's signal or a cancelled body) aborts
  `runController` (given to `chat()`); `request.signal.aborted` → 499
  `gone`; (8) `runAsk(...)` with the scripted or the provider's adapter;
  a timer aborts `runController` with reason `DEADLINE` at
  `(maxDuration − 10) s`; (9) the response is
  `ended(scrubbed(stream, key), runController.signal, clearTimeout)`.
  Why the order matters: the caps run before mending because the
  stand-in rows mending adds would count against `ASK_LIMITS.messages`;
  turns are counted on the mended rows because the conversion that
  counts them is the run's own and must not throw halfway through it;
  `scrubbed` sits inside `ended` so that the abort's own error, turned
  into a `RUN_ERROR` by `scrubbed`, is the one `ended` drops at the
  deadline.
- **No test of the route: true.** No `*.test.ts` in `app/api/`. `bun run
  test` runs `bun test --parallel ./lib ./app ./scripts`, so a test
  beside the route would run.
- **8 of 19 `fix(frag)` commits touch `route.ts`: true**
  (`git log --grep='^fix(frag)'`, then `--name-only` per commit).
- **End without a code: true for the stream, wrong for refusals.**
  `ended` → `runEnd` → `stopText` turns a `RunEnd`
  (`stop|waits|cut|length|refused|other`) plus "late" into a sentence,
  and `runError(why)` sends it without `code`. Refusals do carry one:
  `refuse(status, code, message)` answers `{ code, message }` — but the
  page never reads that body (next section).
- **`errorText` re-derives: true** — from `error.status` (401, 400, 413,
  422, 404, 501, any other number), `message === TOO_MANY_STEPS`,
  provider codes (`"401" "402" "403"`, `max_tokens`,
  `incomplete` + `max_output_tokens`, `context_overflow`) and the
  `KEY_TROUBLE` regex over the provider's words.
- **Duplicated texts: true, and more than one.** See the text table.
- **The adapters: half right.** `askAdapter(provider, model, key)` and
  `fakeAskAdapter()` in `app/api/frag/adapters.ts`; the latter is built
  on `fakeText` from `@tanstack/ai/testing` (which `ask-run.test.ts` uses
  directly with its own scripts). `fakeModel()` (`app/api/frag/env.ts`)
  switches it on with `FRAG_FAKE=1`, never on Vercel. Two adapters, so
  the seam is real.

### How a reason reaches the page today

Two channels, and the page reads only one of them well.

1. **Before the stream: an HTTP status.** `fetchServerSentEvents`
   (`@tanstack/ai-client`, `connection-adapters.js`, `assertResponseOk`)
   turns any non-2xx response into a `StreamHttpError` carrying
   `status` and the message `HTTP error! status: N …`. It reads the body
   only for a 401 in the BYOK shape (`isByokMissingBody`), which ours is
   not. **So the route's `{ code, message }` is discarded; the page sees
   the status alone.** Worse, the connection's `send` wrapper also pushes
   a run-less `RUN_ERROR` with that message (no status, no code) before
   rethrowing, and `ChatClient.reportStreamError` calls `setError` on
   every report (last wins). Which of the two `chat.error` ends up as is
   not covered by any test or spec; `errorText`'s status branches assume
   the thrown one.
2. **Inside the stream: a `RUN_ERROR` event.** The SSE body is AG-UI
   events (`data: {"type":"RUN_ERROR","message":…,"code"?:…}`). The
   client's stream processor turns one into an `Error` with `message`
   and, if present, `code` (`runErrorEventToError`,
   `@tanstack/ai/dist/esm/utilities/errors.js`); that is `chat.error`.
   Provider errors arrive this way through `scrubbed` (message scrubbed
   of the key, `code` kept if a string, `rawEvent`/`error` dropped), and
   so do `ended`'s own closing errors — without a code, and without a
   `runId`, a shape the client already handles.

**So a code can travel:** in the stream, as `RUN_ERROR.code` (works
today, the provider codes use it). Before the stream, only if the page
reads the refusal's body. The cleanest place is the connection's
`fetchClient` option (`FetchConnectionOptions.fetchClient?: typeof
fetch`): a page-side adapter that, for a non-2xx response whose JSON body
carries one of our codes, returns a `200 text/event-stream` response with
one `RUN_ERROR { code, message }`. Then both channels end as the same
`Error` with a `code`, there is one error path instead of the racing two,
and the server's statuses, logs and `curl` view stay as they are. A
response without our code (a host's 502/504) is passed through and keeps
today's status fallback.

### Every place that knows the wire

| Where | Function | What it knows |
|---|---|---|
| `app/api/frag/route.ts` | `POST` | the AG-UI request body (`chatParamsFromRequestBody`: `threadId`, `runId`, `messages`, `forwardedProps`, `resume`, `parentRunId`), the key header, `toServerSentEventsResponse` |
| `app/api/frag/route.ts` | `refuse` | the refusal: status + `{ code, message }`, `Cache-Control: no-store`, the log line `[frag] <status> <code>` |
| `lib/city/ask-run.ts` | `runAsk` | `chat()`'s AG-UI stream |
| `lib/city/ask-run.ts` | `errorChunk`, `runError` | the `RUN_ERROR` shape the browser gets |
| `lib/city/ask-run.ts` | `ended`, `runEnd` | `RUN_FINISHED.outcome.type === "interrupt"`, `metadata.tanstack.finishReason`, `TOOL_CALL_RESULT` and its `metadata.tanstack.state` |
| `lib/city/ask-run.ts` | `scrubbed` | `RUN_ERROR.message/code`, thrown errors |
| `lib/city/ask-run.ts` | `withStoppedCallsAnswered`, `roundsSinceQuestion` | the wire rows (assistant `toolCalls`, `tool` rows) and their model conversion |
| `lib/city/ask-city.ts` | `ASK_KEY_HEADER`, `parseAskProps`, `lastQuestion`, `conversationProblem` | the header name, `forwardedProps`' shape, a message's `parts`/`content` |
| `app/api/schluessel/route.ts` | `refuse`, `answer`, `POST` | `{ ok, code, message }` / `{ ok, token, expires }` |
| `app/_components/ask-city.tsx` | `KeyForm` `submit` | reads `/api/schluessel`'s `res.ok` and `body.message` (a plain `fetch`: the body *is* read) |
| `app/_components/ask-city.tsx` | `Conversation` (`connection`, `useChat`) | `fetchServerSentEvents("/api/frag", { headers, reconnect })`, the `forwardedProps`, `sendMessage`'s `body: { voice }` |
| `app/_components/ask-city.tsx` | `errorText` | `error.status` (a `StreamHttpError`), `error.code`, `error.message` |
| `e2e/city-walk.spec.ts` | "Frag die Stadt checks a key and marks its answer as generated" | hand-written SSE events for `/api/frag`, JSON for `/api/schluessel` |

### Every refusal and end text today

The page's text is what a visitor reads; the route's refusal text is read
by nobody but `curl` (the page discards the body).

| Code (today) | Where it is made | Status | Route's text | Page's text (`errorText`) | Key / reset |
|---|---|---|---|---|---|
| `bad-request` | `POST`, twice | 400 | Die Anfrage ist unvollständig. | Die Anfrage passt nicht zu diesem Server — lade die Seite neu. | – / – |
| `bad-props` | `POST` | 400 | `parseAskProps`' string (unbekannter Anbieter / unbekanntes Modell / unbekannte Stadt) | as `bad-request` | – / – |
| `no-key` | `keyRefusal` | 401 | Ohne Schlüssel geht es nicht. | Der Schlüssel muss neu geprüft werden. | key / – |
| `bad-token` | `keyRefusal` | 401 | Der Schlüssel muss neu geprüft werden. | the same | key / – |
| `no-secret` | `keyRefusal`; `schluessel` `POST` | 501 | Frag die Stadt ist auf diesem Server nicht eingerichtet. (both routes) | the same | – / – |
| `too-long` | `conversationRefusal` | 413 | `conversationProblem`'s string (keine Frage / `TOO_LONG` + " Bitte neu beginnen." / Die Frage ist zu lang (…)) | `TOO_LONG`: Das Gespräch ist zu lang geworden. | – / reset |
| `too-many-steps` | `POST` | 422 | `TOO_MANY_STEPS`: Die Antwort brauchte zu viele Schritte. | `TOO_MANY_STEPS` + " Frag bitte anders." | – / reset |
| `no-knowledge` | `POST` | 404 | Für diese Stadt gibt es kein Stadtwissen. | the same | – / – |
| `gone` | `POST` | 499 | Die Anfrage wurde abgebrochen. | (never seen: the tab is gone) Der Server antwortet mit Status 499. | – / – |
| – (cut) | `stopText` | stream | `TOO_MANY_STEPS` | matched by `message === TOO_MANY_STEPS` → as 422 | – / reset |
| – (length) | `stopText` | stream | `CUT_SHORT`: Die Antwort wurde abgeschnitten: dem Modell gingen die Wörter aus. | the message as sent | – / – |
| – (refused) | `stopText` | stream | Das Modell brach die Antwort ab. Frag bitte noch einmal. | the message as sent | – / – |
| – (late) | `stopText` | stream | Die Antwort dauerte zu lange. | the message as sent | – / – |
| – | `scrubbed` (a non-`Error` thrown) | stream | Die Antwort brach ab. | the message (also `errorText`'s default for an empty one) | – / – |
| provider codes | `scrubbed` passes them | stream | the provider's words | `"401" "402" "403"` → the words, key; `max_tokens`, `incomplete`+`max_output_tokens` → `CUT_SHORT`; `context_overflow` → `TOO_LONG`, reset; else the words, key if `KEY_TROUBLE` matches | |
| other status | – | any | – | Der Server antwortet mit Status N. | – / – |

The key form's own texts (`schluessel` `POST`: Das ist kein Schlüssel.,
`${label}` ist gerade nicht zu erreichen., nimmt diesen Schlüssel nicht
an., antwortet mit Status N.; `KeyForm`: Das sieht nicht nach einem
Schlüssel aus., Die Prüfung schlug fehl (N)., Keine Verbindung zum
Server.) already travel in a body the page reads; only `no-secret` is
shared with the chat.

### Constraints

- `export const maxDuration = 300` stays a literal in `route.ts` (Next
  reads route segment config statically; check
  `node_modules/next/dist/docs/` for the route segment config page before
  moving anything near it).
- `ask-city.tsx` is its own chunk (`dynamic(() => import("./ask-city"))`
  in `city-walk.tsx`); the new `lib/` module is imported by that chunk,
  the two routes and `ask-run.ts` only — never by the main bundle.
- No `any` without a reason; no casts beyond those `ask-run.ts` has.
- ADR 0056: no key, conversation or token in a log line or an error.

## The interface

In `lib/city/ask-run.ts` (the module that already owns the run; the
route's six imports become internal to it):

```ts
export interface TurnDeps {
  /** the model for a request that passed every check */
  adapterFor: (props: AskRequestProps, key: string) => AnyTextAdapter;
  /** a site's prompt facts and Stadtwissen; null where none was built */
  knowledgeFor: (
    siteId: string
  ) => Promise<{ site: AskPromptSite; knowledge: Knowledge } | null>;
  /** FRAG_SECRET; undefined where unset */
  secret: string | undefined;
  /** a production server: without a secret, no relay */
  production: boolean;
  /** the scripted model answers: no key, no token check */
  scripted: boolean;
  /** ms since the epoch: the token's clock and today's date */
  now: () => number;
  /** when the run is aborted with DEADLINE, from the request's start */
  deadlineMs: number;
  /** one line per refusal: `[frag] <status> <code>` */
  log: (line: string) => void;
}

export async function answerTurn(
  request: { body: unknown; key: string; signal: AbortSignal },
  deps: TurnDeps
): Promise<Response>;
```

`route.ts` becomes the binding to the production adapters:
`adapterFor` = `scripted ? fakeAskAdapter() : askAdapter(provider, model,
key)`, `knowledgeFor` = `siteById` + `askPromptSite` + `siteKnowledge`,
`secret` = `process.env.FRAG_SECRET`, `production` = `NODE_ENV ===
"production"`, `scripted` = `fakeModel()`, `now` = `Date.now`,
`deadlineMs` = `(maxDuration − 10) * 1000`, `log` = `console.warn`; the
body is `await request.json().catch(() => undefined)`.

**Invariants** (each one a test in Step 1):

- The checks run in the order of Findings (1)–(7); the first that fails
  answers, nothing after it runs (`adapterFor` and `knowledgeFor` are not
  called for a refused request).
- Caps read the rows as sent; turns are counted on the mended rows.
- Every refusal is JSON `{ code, message }` with `Cache-Control:
  no-store` and logs exactly `[frag] <status> <code>`.
- An answer is `text/event-stream`, `no-store`; no byte of it and no log
  line contains the key.
- The run stops when the response body is cancelled, when the request's
  signal aborts, or at `deadlineMs` (reason `DEADLINE`); the deadline
  timer never outlives the stream.
- A run that ends without saying why closes with one `RUN_ERROR` naming
  the reason (`ended`), and after Step 3 every such error carries a code.

**Error modes.** `answerTurn` answers every bad request with a refusal; it
rejects only if a dependency throws (`adapterFor` with props that passed
`parseAskProps` does not; `siteKnowledge` returns null rather than
rejecting). Provider failures arrive in the stream, scrubbed.

**The text table** (Step 2–3), `lib/city/ask-failure.ts`:

```ts
export type AskFailureCode =
  | "bad-request" | "bad-props" | "no-key" | "bad-token" | "no-secret"
  | "too-long" | "too-many-steps" | "no-knowledge" | "gone"
  | "cut-short" | "too-late" | "broke-off";
export const ASK_FAILURES: Record<
  AskFailureCode,
  { status?: number; text: string; key?: true; reset?: true }
>;
/** what the card says and offers for a failed answer */
export function askFailure(error: Error): { text: string; key: boolean; reset: boolean };
/** fetch for the chat's connection: a coded refusal becomes a stream error */
export function codedRefusals(fetchFn: typeof fetch): typeof fetch;
```

`status` is set for the refusals (the route reads it), absent for the
four stream ends. `text` is the page's text of the Findings table.

## Steps

### Step 0 — Pin the route as it is (tests only)

On unchanged code, `app/api/frag/route.test.ts`:

1. Import `POST` after `mock.module("./knowledge", …)` (bun's
   `mock.module`, then `await import("./route")`) so that
   `siteKnowledge("dresden")` returns a fixture built with `knowledgeOf`
   from the `INDEX`/tiles shape in `lib/city/ask-run.test.ts`. The
   file-system read is the only thing replaced; the scripted model is the
   real `fakeAskAdapter` via `FRAG_FAKE=1`. Set and restore
   `process.env` (`FRAG_FAKE`, `FRAG_SECRET`, `VERCEL`) per test.
   Bodies: `chatParamsFromRequestBody`'s input as in
   `ask-run.test.ts` (`uiMessagesToWire`, `forwardedProps`).
2. **Refusals** — status, `code`, `message`, `no-store`, and the
   `console.warn` line (spy on it): a body that is not JSON (400
   `bad-request`); an unknown model (400 `bad-props`); no key, not
   scripted (401 `no-key`); a secret and a wrong token (401
   `bad-token`); 41 messages (413 `too-long`); a history with twelve
   tool rounds since the question (422 `too-many-steps`); a site id that
   passes `parseAskProps` but `siteById` does not know, e.g. `"atlantis"`
   (404 `no-knowledge`); an aborted request signal (499 `gone`); no
   secret under `NODE_ENV=production` (501 `no-secret`) — if bun does
   not let a test set `NODE_ENV`, pin it in Step 1 through `production`
   and say so in the commit.
3. **The scripted answer**: "Wer baute die Frauenkirche?" →
   `text/event-stream`; the events read back from the body include
   `suche_stadt`'s call and result, then `zeige`'s call, and end on a
   `RUN_FINISHED` whose `outcome.type` is `interrupt`; no `RUN_ERROR`.
   The resume with `zeige`'s result → a text that starts
   "Testantwort: Hier ist es". No byte of either contains the key.
4. `bun run verify`. Commit: `test(frag): pin the route's refusals and
   the scripted answer`.

### Step 1 — One answer turn behind one function

1. Add `TurnDeps` and `answerTurn` to `lib/city/ask-run.ts`. Move the
   body of `POST` and its helpers (`refuse`, `answerHistory`,
   `conversationRefusal`, `keyRefusal`) there verbatim, reading the
   environment, the clock, the adapter, the knowledge and the log from
   `deps`. Keep the order of Findings exactly.
2. `route.ts` keeps its head comment (shortened), `maxDuration` and a
   `POST` that builds `TurnDeps` and calls `answerTurn`. Nothing else.
3. Move Step 0's tests to `lib/city/ask-turn.test.ts` (a new file: the
   run's own file is 621 lines) against `answerTurn` with a `fakeText`
   adapter per test and an in-memory `knowledgeFor`; their assertions
   stay as they were. Keep in `route.test.ts` only what the binding
   adds: `no-secret` under production and one scripted answer through
   `POST` (still with `mock.module` for the file read).
4. Add the tests the seam now allows: a provider error with the key in
   its message and `code: "401"` (`fakeText` `{ error }`, or a stub
   adapter yielding a `RUN_ERROR`) reaches the body scrubbed, code kept;
   `turns` left = 1 with a model that calls a server tool twice ends on
   `TOO_MANY_STEPS`; `deadlineMs: 50` with a slow `fakeText`
   (`tokensPerSecond`) ends on "Die Antwort dauerte zu lange." and on no
   other `RUN_ERROR`; cancelling the response body stops the model
   (`state.callCount` does not grow); a stopped call before the question
   reaches the model with its stand-in result; `adapterFor` and
   `knowledgeFor` are not called for any refusal; no log line holds the
   key.
5. `ask-run.ts`'s head comment: it now owns the whole turn. The six
   former route imports stay exported for `ask-run.test.ts` only (an
   internal seam; say so in one comment line).
6. `bun run verify`. Commit: `refactor(frag): one answer turn behind one
   function, the route binds its adapters`.

### Step 2 — One table, the page's words moved to `lib/` (no change seen)

1. New `lib/city/ask-failure.ts` with `AskFailureCode`, `ASK_FAILURES`
   (status and the page's text from the Findings table) and
   `askFailure(error)`: `errorText` moved verbatim from
   `ask-city.tsx`, with `KEY_TROUBLE`, `KEY_CODES` and `say`. Move
   `TOO_MANY_STEPS`, `TOO_LONG`, `CUT_SHORT` into it (re-export nothing;
   repoint `ask-city.ts`'s `conversationProblem`, `ask-run.ts`,
   `ask-city.tsx`).
2. `ask-city.tsx` calls `askFailure` where it called `errorText`
   (`failure`, the `renewed` check).
3. `lib/city/ask-failure.test.ts`: one case per row of the Findings
   table's page column, as literals — every status branch, the
   `TOO_MANY_STEPS` message, each provider code, a `KEY_TROUBLE` word, a
   plain provider message, an empty message.
4. `bun run verify`. Commit: `refactor(frag): the card's failure words in
   one lib module`.

### Step 3 — Codes on the wire, a lookup on the page

1. **Server ends.** `stopText` returns an `AskFailureCode | null`
   (`cut` → `too-many-steps`, `length` → `cut-short`, `refused` →
   `broke-off`, late → `too-late`); `ended` yields
   `runError(ASK_FAILURES[code].text, code)`. `runEnd` and its tests are
   untouched; `ask-run.test.ts`'s "an answer that stops says why" gains a
   `code` assertion per case.
2. **Server refusals.** `refuse(code)` in `answerTurn` takes status and
   message from the table; the `bad-props` and `too-long` details
   (`parseAskProps`'s and `conversationProblem`'s strings) no longer go
   into the body — nobody reads them; the code says enough. They go
   into the server log line beside the code instead (never the key —
   `scrubbed` as today), so a refusal stays diagnosable. The
   `schluessel` route takes its `no-secret` text from the table.
3. **Page.** `codedRefusals(fetch)` in `ask-failure.ts`: a non-2xx
   response with a JSON body whose `code` is in `ASK_FAILURES` becomes
   `new Response("data: " + JSON.stringify({ type: "RUN_ERROR",
   timestamp, code, message }) + "\n\n", { headers: { "Content-Type":
   "text/event-stream" } })`; anything else passes through unchanged.
   `ask-city.tsx` passes `fetchClient: codedRefusals(fetch)` to
   `fetchServerSentEvents`.
4. `askFailure` becomes: a code in the table → its row; else the
   provider-code fallback as it is (`KEY_CODES`, `max_tokens`,
   `incomplete`, `context_overflow`, `KEY_TROUBLE`); else a numeric
   `status` → "Der Server antwortet mit Status N.". The status branches
   for 400/401/404/413/422/501 and the `message === TOO_MANY_STEPS`
   branch go. The table's `too-many-steps` text is "Die Antwort brauchte
   zu viele Schritte. Frag bitte anders." (what the page showed), so the
   in-stream message now carries the suffix too.
5. Tests: `ask-failure.test.ts`'s Step 2 cases keep their expected
   output, now given as `{ code }` errors for our codes; add
   `codedRefusals` (a coded 401 → one `RUN_ERROR` with `bad-token`; a
   501 with HTML → the same response; a 200 → the same response); a test
   that no table code is a provider's shape (all kebab-case: no `_`, not
   numeric), so `askFailure` never mistakes a provider's code for ours.
6. E2E: extend "Frag die Stadt checks a key and marks its answer as
   generated": before the answered question, `/api/frag` once fulfils
   `status: 401, json: { code: "bad-token", message: "…" }`; the card's
   alert says "Der Schlüssel muss neu geprüft werden." and shows
   *Schlüssel prüfen*. Clear the logged 401 from `errors.console` as the
   spec already does for the key check. Keep it in its group, inside
   `withFramesHeld`.
7. `bun run verify`; `bun run test:e2e --grep "Frag die Stadt"`. Commit:
   `feat(frag): every refusal and end names its code, the card looks it
   up`.

### Step 4 — Docs

1. Rewrite ADR 0056 per `docs/adr/README.md` (state today's decision; no
   "Update"): Decision 1 says the turn is one function,
   `answerTurn` in `lib/city/ask-run.ts`, with the route binding the
   provider and scripted adapters, the Stadtwissen and the secret to it;
   a new point (or a sentence in 1) says every refusal and every end the
   stream would not explain carries a code from `lib/city/ask-failure.ts`,
   whose words the card shows, and the card turns a coded refusal into a
   stream error so both reach it alike. Consequences: "every refusal logs
   a status and reason code" stays; add that a new reason is a row in the
   table, and that the table's codes are kebab-case so a provider's code
   is never read as ours.
2. `app/(legal)/datenschutz/page.mdx`: **no change** — codes travel from
   the server to the browser; no new field leaves the browser, no new
   request, no storage key. Say so in the commit body.
3. `docs/plans/README.md`: this plan's row. Grep `docs/` and
   `.claude/skills/` for `errorText`, `TOO_MANY_STEPS` and
   `app/api/frag/route.ts` and fix what names the old shape (none on
   main besides ADR 0056 as of 2026-11-04).
4. Commit: `docs(frag): ADR 0056 says the turn is one function and its
   ends have codes`.

## Verification

After every step:

- `bun run fix`, then `bun run verify`; `bun run typecheck:tsc` after
  Steps 1 and 3 (the reference checker).
- `git diff --stat` touches only the step's files.
- `lib/city/ask-run.test.ts`'s existing tests pass with their `expect`
  lines unchanged (Step 3 only adds `code` assertions).

After Step 3:

- `bun run test:e2e --grep "Frag die Stadt"` against a production build.
- By hand, `FRAG_FAKE=1 bun dev`: ask "Wer baute die Frauenkirche?" →
  the view goes there, the answer is marked *KI*. Then without
  `FRAG_FAKE` and without `FRAG_SECRET` under `bun run build && bun
  start`: a question shows "Frag die Stadt ist auf diesem Server nicht
  eingerichtet." — the coded refusal reached the card.
- `curl -si -X POST localhost:3000/api/frag -d '{}'` still answers 400
  with `{ code, message }` and the log shows `[frag] 400 bad-request`.

## STOP conditions

Stop, leave the tree green at the last finished step, and write the
reason in the status row if:

- **A visitor-visible text changes** other than the two Findings and
  Step 3 name (the in-stream `too-many-steps` suffix; a refusal the page
  now words by code where the status branch said the same).
- **The order changes**: any Step 0 or Step 1 test needs a different
  expected status or code to pass.
- **`fetchClient` cannot carry the refusal**: the synthetic stream does
  not reach `chat.error` with its `code` (the e2e of Step 3 fails), or
  `@tanstack/ai-client` no longer takes `fetchClient`. Fall back to a
  status → code lookup in `askFailure` (the statuses are unique per page
  text today), ship it, and record why.
- **A key, token or conversation reaches a log line or an error body**
  in any test.
- **`maxDuration` cannot stay a literal** in `route.ts`, or Next warns
  about the route's config after Step 1.
- **The new module enters the main bundle**: `ask-failure.ts` imported
  from anything outside `ask-city.tsx`, the two routes and `ask-run.ts`.
- `mock.module` does not isolate under `bun test --parallel`: drop the
  route-level stream test of Step 0, keep its refusals, pin the stream
  in Step 1 through `answerTurn`, and say so.

## Out of scope

- What the model says, the prompt, the tools, the caps' values, the
  curated models.
- `ended`/`runEnd`'s classification and `withStoppedCallsAnswered`'s
  mending: deep and tested; they move behind `answerTurn`, they do not
  change.
- The key check's own texts (`/api/schluessel`, `KeyForm`): they already
  travel in a body the page reads; only `no-secret` joins the table.
- Rate limits, bot protection, retries (host and provider settings,
  ADR 0056).
- The provider adapters (`askAdapter`) and the scripted model's script.
- Sentry or any new report field.

## Maintenance notes

- A new reason a turn can be refused or end with: a code and a row in
  `ASK_FAILURES`, the check in `answerTurn` (or the case in `stopText`),
  a test in `ask-turn.test.ts`. The page needs no edit.
- A new dependency of a turn (a clock, a store, a second model) goes
  into `TurnDeps`, never read from `process.env` inside `ask-run.ts`.
- Provider codes stay in `askFailure`'s fallback; our codes stay
  kebab-case.
- When `@tanstack/ai-client` changes `assertResponseOk` (e.g. reads the
  body of a non-2xx), re-check whether `codedRefusals` is still needed.
- When DONE, condense this plan into `completed.md` per the README's
  Lifecycle (the order invariants and the two-channel finding are the
  durable part) and delete it.
