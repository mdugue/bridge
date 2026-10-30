# ADR 0048: A network failure is retried for a budget of the page's visible time, never decided at once

- **Status:** accepted
- **Date:** 2026-10

## Context

On phones the network blinks: a tunnel, a lift, a tab in the pocket.
Every failed fetch used to be final — a hole in the city, a layer
switched off, a failed boot — and a report of it.

## Decision

1. **One retry policy** (`lib/city/fetch-retry.ts`): an abort is the
   caller's and never retried; 404 and 410 mean absent; a network error,
   408, 425, 429 and 5xx are transient and retried with jittered
   exponential backoff, honouring `Retry-After`; any other status and a
   corrupt body are fatal.
2. **The budget counts the page's visible time only**, offline or not, so a
   phone in a pocket does not use it up and a visible page without a
   network does end in a decision.
3. **One module is the page's view of the network** (`net-gate.ts`):
   when it is usable, the budgets' clock, and whether the page is leaving.
   While it leaves, nothing is decided or reported.
4. **Every tile, tileset and raster request goes through the retrying
   fetch.** A tile that gave up is asked for again when the network is
   back (`tile-retry.ts`), and the boot waits for it.
5. **The manifest falls back only to the browser's cached copy**, never to
   an unhashed name. The boot's failure is worded in German with a retry.

## Consequences

- A working network is exactly as fast as before; the first try goes at
  once.
- A new fetch uses `fetchBytes` or `fetchOptional*`, never a bare `fetch`.

## Alternatives

- **Retrying forever:** a boot that never says why it waits.
- **Wall-clock or "visible and online" budgets:** the first runs out in a
  pocket, the second never runs out offline.
- **Trusting `navigator.onLine`:** a hint; a missed `online` event strands
  the page.
- **A service worker over the tileset:** helps repeat visits, not a first
  one; still an option.
