# ADR 0056: *Frag die Stadt* runs on the visitor's own key, through one stateless function with a fixed prompt and fixed tools

- **Status:** accepted
- **Date:** 2026-10

## Context

The second step of the agentic concept (ADR 0055 baked the Stadtwissen
and wrote the walks) is a chat: a visitor asks about the city, the
answer comes from the twin's knowledge and the view goes there. The
maintainer decided on 2026-10-29:

- **The visitor brings their own key** ("bring your own key"): the site
  pays for no model, and nobody can run up a bill on it.
- **Not Claude only**: any of the usual providers, chosen by the key.
- **The answers may show in the viewer if they are marked** as
  generated, like the walks.
- **The phone must not grow**: nothing of the chat may load before it is
  opened, and none of it in the scene's chunk.

And three constraints the code already had: no backend (ADR 0001) — a
key cannot go from the browser straight to every provider (CORS,
and a key in a cross-origin request leaks into more logs); ADR 0042 keeps
facts on the inquiry card with a source each; ADR 0045 lists every
request to a third party and every key in the browser's storage.

## Decision

**One stateless server function relays each turn.** `POST /api/frag`
(`app/api/frag/route.ts`) takes the conversation, the visitor's key in
the `x-frag-key` header and the provider and model the visitor picked;
it builds the provider's adapter for that request (TanStack AI:
Anthropic, OpenAI, OpenRouter, the Vercel AI Gateway) and streams the
answer back as server-sent events. It keeps nothing: no conversation,
no key, no log of either. `POST /api/schluessel` checks a key once
with a request that spends no tokens (the provider's model list, or its
key record) and returns a token — an HMAC over provider, expiry and a
hash of the key with the site's `FRAG_SECRET` — that the chat route
asks for, so it relays only for a key that was checked
(`lib/city/ask-token.ts`; on Vercel the chat refuses to run without the
secret, a local server skips the check).

**The prompt and the tools are fixed on the server.** The route never
takes a tool list or a system prompt from the request
(`lib/city/ask-run.ts`): the model gets the site's prompt
(`askSystemPrompt`: one job — this city and this viewer; facts from the
tools, with their source; legends as legends; today's date) and nine
tools (`lib/city/ask-tools.ts`). Four answer from the Stadtwissen on
the server — `suche_stadt`, `in_der_naehe`, `fakten`, `quellen`
(`lib/city/ask-knowledge.ts`, over a copy of the published files the
build keeps outside `public/` for this function,
`scripts/prepare-sites.ts`); five act on the scene in the browser —
`wo_bin_ich`, `zeige`, `setze_zeit`, `setze_stil`, `datenschicht`
(`app/_components/ask-scene.ts`). A scene tool interrupts the run; the
browser runs it and resumes the run with its result. Only curated models
are accepted (`ASK_PROVIDERS`), and a conversation keeps to caps
(`ASK_LIMITS`: 40 messages, 60 000 characters, 1 200 per question, eight
model turns per answer, twelve entries per tool result).

**The answer shows its places.** `zeige` takes every place an answer
is about — the rejected candidates too, the chosen one first — with the
footprint radius and height the Stadtwissen gives (`r`, baked from the
LoD2 extent; a landmark's from the buildings that draw it). The browser
frames them itself (`frameTargets`, `lib/city/ask-view.ts`): from the
air, the nearest eye that fits them into the screen as it is shaped, on
the best of twelve headings by size, the visitor's approach, the sun
behind the camera, the places beside each other and the sight lines the
loaded buildings leave open; places that would need an eye more than
900 m off are shown one at a time. The model never computes a camera.
Under the answer (`app/_components/ask-chips.tsx`) each place is a chip,
"nearby" shows the reach it took with a narrower and a wider one, and
the follow-ups come from `vorschlaege`, a server tool that only takes
them in — one model turn more per answer, cheap on the prompt cache,
and more reliable than parsing a line of the text.

**The key stays in the visitor's browser.** For the tab (session
storage), or on the device if the visitor asks (local storage,
`frag-die-stadt`); it is sent with each question to the site's function,
which forwards it to the provider and scrubs it from any error the
provider sends back.

**The answer is marked.** The card (`app/_components/ask-city.tsx`, its
own chunk, loaded on first open) labels every answer *KI*, says under
the conversation that it is generated and can be wrong, and lists each
tool the model used under its answer — what it looked up and what it did
to the view.

## Consequences

- The site runs a server function again (ADR 0001 kept the app static).
  It is stateless and costs the site function time only; the model's cost
  is the visitor's. The function bundles the Stadtwissen of every built
  site (about 4 MB a site).
- Abuse is bounded by the token (a checked key), the caps and the curated
  models; the rest is the host's: a rate limit and bot protection on
  `/api/frag` and `/api/schluessel` in the Vercel firewall, and a spend limit at the visitor's
  provider. Those are the maintainer's settings, not code.
- The privacy page names the chat: what is sent, to whom (the site's
  host, the chosen provider), and the storage key (ADR 0045).
- `FRAG_SECRET` must be set on a deployment (Preview and Production), or
  the key check and the chat answer 501 that it is not set up (not 503,
  which the chat client retries as an outage); every refusal logs its
  status and a reason code (`[frag] 501 no-secret`), never the key or the
  conversation;
  `FRAG_FAKE=1` swaps the model for a scripted one in local tests and
  must never be set on one.
- Amends ADR 0001 (one stateless function), ADR 0042 (generated answers
  show in a second card, marked), ADR 0045 (a request to a provider the
  visitor chose, a storage key).

## Alternatives

- **The browser calls the provider directly**: Anthropic allows it with a
  special header, OpenAI does not; the tools that read the Stadtwissen
  would load ~4 MB per site into the browser; and the prompt and tools
  would be the browser's to change.
- **The site's own key**: the bill and the abuse would be the site's.
- **A conversation stored on the server** (resumable streams,
  persistence): a database and a privacy question for little gain; a
  conversation lives as long as its card.
- **A free model id**: a key could be pointed at any model; the curated
  list keeps the prompt tested on what it runs on.
- **The provider SDKs' own chat UIs or a vendor SDK**: the viewer's card
  is built from the vendored shadcn chat components (`Message`,
  `MessageScroller`, `Trace`) so it reads like the rest of the HUD.

## References

- `lib/city/ask-city.ts`, `ask-tools.ts`, `ask-knowledge.ts`,
  `ask-run.ts`, `ask-token.ts`, `ask-view.ts`
- `app/api/frag/route.ts`, `app/api/schluessel/route.ts`,
  `app/api/frag/adapters.ts`, `app/api/frag/knowledge.ts`
- `app/_components/ask-city.tsx`, `ask-scene.ts`, `ask-key.ts`
- ADR 0001, 0042, 0045, 0055
