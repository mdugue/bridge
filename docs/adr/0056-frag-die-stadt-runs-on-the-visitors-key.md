# ADR 0056: *Frag die Stadt* runs on the visitor's own key, through one stateless function with a fixed prompt and fixed tools

- **Status:** accepted
- **Date:** 2026-10

## Context

A visitor asks about the city in a chat; the answer comes from the twin's
knowledge (ADR 0055) and the view goes there. The site pays for no
model, the visitor brings a key of any of the usual providers, a
generated answer may show if it is marked, and a phone loads nothing of
the chat before it is opened. A key cannot go from the browser to every
provider directly (CORS, more logs), and the Stadtwissen is too large to
load into the browser.

## Decision

1. **One stateless server function relays each turn, and the turn is one
   function.** `POST /api/frag` takes the conversation, the key in the
   `x-frag-key` header and the chosen provider and model, and streams the
   answer as server-sent events. The turn — the request's checks in
   their order, the run, how it ends — is `answerTurn`
   (`lib/city/ask-run.ts`); the route (`app/api/frag/route.ts`) only
   binds it to the provider's adapter (TanStack AI: Anthropic, OpenAI,
   OpenRouter, the Vercel AI Gateway) or the scripted one, the
   Stadtwissen and the secret. It keeps no conversation, no key and no
   log of either. `POST /api/schluessel` checks a key once without
   spending tokens and returns a token (an HMAC with the site's
   `FRAG_SECRET`, `lib/city/ask-token.ts`) the chat route requires.
   Every refusal, and every end the stream would not explain (the turn
   cap, the deadline, the model's output spent, a filtered answer),
   carries a code from one table, `lib/city/ask-failure.ts`, whose words
   the card shows; the card turns a coded refusal into a stream error, so
   both reach it alike.
2. **The prompt and the tools are fixed on the server**
   (`lib/city/ask-run.ts`, `ask-city.ts`, `ask-tools.ts`): one job (this
   city, this viewer; facts from the tools with their source; legends as
   legends; today's date). The Stadtwissen's tools run on the server
   (`ask-knowledge.ts`, over a copy the build keeps in `.stadtwissen/`),
   the scene's in the browser (`app/_components/ask-scene.ts`): a scene
   tool interrupts the run, the browser runs it and resumes. Only curated
   models are accepted, and a conversation keeps to caps (`ASK_LIMITS`).
   A call an earlier answer ended without a result (the visitor stopped
   it, or the run ended) gets a stand-in result, `abgebrochen`, before the
   next question, and arguments cut off mid-stream become `{}` in every
   row (`withStoppedCallsAnswered`): providers refuse a history with
   either.
3. **The key stays in the visitor's browser**, for the tab or, if asked,
   on the device (`frag-die-stadt`); the function forwards it to the
   provider and scrubs it from any error it sends back.
4. **The answer is marked.** The card (`app/_components/ask-city.tsx`, its
   own chunk) labels every answer *KI*, says it is generated and can be
   wrong, and lists the tools the model used.

## Consequences

- The function costs the site function time only and bundles the
  Stadtwissen of every built site (about 4 MB a site).
- Abuse is bounded by the token, the caps and the curated models; rate
  limits, bot protection and the spend limit are host and provider
  settings, not code.
- `FRAG_SECRET` must be set on a production server, or the routes answer
  501; every refusal logs a status and reason code, never the key or the
  conversation. A new reason a turn is refused or ends with is a row in
  the table; its codes are kebab-case, so a provider's code (`"401"`,
  `max_tokens`) is never read as ours. `FRAG_FAKE=1` is a scripted model for local tests only
  and is ignored on Vercel. One request takes at most eight model turns
  and ends with an error 10 s before its 300 s of function time; one
  answer, across the requests the scene tools resume, takes at most
  twelve turns.
- The privacy page names what is sent, to whom, and the storage key
  (ADR 0043). Generated answers show in their own card, marked
  (ADR 0042).
