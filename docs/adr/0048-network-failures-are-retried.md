# ADR 0048: A network failure is retried for a budget of usable time, never decided at once; a tile that gives up is healed, and nothing is decided while the page leaves

- **Status:** accepted
- **Date:** 2026-10-06

## Context

Nothing that the viewer fetched was ever retried. On the iPhone of
[ADR 0046](./0046-a-per-device-safety-ladder-for-gpu-loss.md) a boot failed
because all eleven tile fetches got Safari's "Load failed" in the same
millisecond (Sentry CITY-WALK-1…8): a Wi-Fi handover, a resume from the
background, the networking process reset with the rest. A failed fetch was
a decision on the spot:

- the spawn tile or the tileset failing failed the boot, 175 ms in;
- any other tile stayed a hole: 3DTilesRendererJS counts a FAILED tile as
  loaded (its REPLACE parent gives way to it) and never asks for it again;
- an optional side file failing on the network turned its feature off
  for the tile's life ([ADR 0006](./0006-tile-block-with-one-primary-and-one-artifact-map.md)'s
  policy: "404, network or parse failure → feature off");
- a manifest that did not arrive fell back to the unhashed
  `tileset.json`, which the build never publishes (ADR 0007): a 404 and a
  broken boot;
- and the reports took every one of them for a fault — the fetches a
  reload cancels as "boot failed" (fatal) from a page that was leaving.

## Decision

**One retry policy** (`lib/city/fetch-retry.ts`, pure). An abort is the
caller's and never retried; 404 and 410 mean absent; a network error (any
`TypeError` — Safari's "Load failed", Chrome's "Failed to fetch",
Firefox's "NetworkError …", a body cut off —, a `NetworkError`) and 408,
425, 429 and 5xx are transient; any other status is fatal, and so is a
gzip that does not inflate once its body was read whole: a corrupt file
(a broken upload, a mangling proxy), which `fetchBytes` rethrows as a
plain Error — retried and healed as a blip, it was downloaded six times
a round under *Keine Verbindung zum Server*, for good. A transient
failure is retried with jittered exponential backoff: 0.5 s doubling to
15 s, × 0.5–1.5, a `Retry-After` honoured up to 60 s. The first try goes
at once — a working network is exactly as fast as before; each retry
waits until the page is usable.

**The budget counts the page's visible time only**
(`createVisibleClock`), offline or not. A phone in a pocket does not use
it up — a hidden page's requests are what iOS cancels and starves
first —; a visible page that cannot reach the network does, so an outage
ends in a give-up the healer, the manifest's cached copy and the boot's
message take up. (The clock first ran only while the page was visible
*and online*: offline, no budget ever ran out — every retry woke on the
15 s probe, failed and waited again, the manifest's fallback was never
reached, the first optional file held the serial dressing chain, and a
tile held its download slot.) 20 s for a tile's content, 8 s for an
optional side file or a raster (it must not hold up the tile's serial
dressing chain for long), 20 s for the manifest, 60 s for the tileset
and the boot. A fetch that outlasts its budget throws a
`NetworkError` whose message starts `network: ` and says the cause, the
attempts and the page's state (`online=… vis=…`); the HUD and the reports
tell a network cause by that prefix.

**The page's view of the network is one module** (`app/_components/net-gate.ts`):
`whenUsable` (resolves on `online`, on visible again, on `pageshow`, and
every 15 s on a visible page the browser calls offline — `navigator.onLine`
is a hint, and a missed `online` event would strand it), the budgets'
clock, and `pageLeaving()`: true from `pagehide` — a navigation, a reload, the
GPU recovery's too — until the page comes back from the bfcache. **While
the page leaves, nothing is decided or reported**: the loads a leaving
page loses are its own doing.

**Every tile and tileset request goes through the retrying fetch**
(`fetchBytes` in `fetch-optional.ts`, by `ContentFetchPlugin` in
`tile-stream.ts`, which also inflates `.gz` inside the retries), and so
do the terrain, sky-view and horizon rasters (`fetchRasterBytes` in
`raster-upload.ts`, the download outside the raster gate) and the trees'
NDVI sampler (`fetchOptionalBinary`), each for an optional file's 8 s: a
blip on a class raster had dressed its level with the flat fallback
ground — and both levels, while the shared copy of that null was held —
with no load-error for the healer to see. A tile
that retries stays LOADING, so its REPLACE parent — the coarse level —
stays drawn and the boot keeps waiting.

**A tile that gives up is healed** (`app/_components/tile-retry.ts`). Its
load-error is collected when it is the network's (`isNetworkFailure`: a
give-up, or a `TypeError` in one of the browsers' exact network texts —
not any `TypeError`, which is as often a bug), and the collected tiles are
asked for again as soon as the page may have its network back (`online`,
visible, `pageshow`) and otherwise after 5, 15, 45 and then every 120 s
(`HEAL_DELAYS_MS`) while any are left. Healing is
`lruCache.remove(tile)` for each, then `tiles.resetFailedTiles()`.
3d-tiles-renderer 0.5.3's `resetFailedTiles()` alone does not re-request a
tile, though its API says so: the FAILED tile stays in the LRU cache,
whose `add` refuses an item it already holds, so the request returns
early. Removing it first runs the renderer's own unload (UNLOADED, every
plugin's `disposeTile`), and the next update asks for it. **An upstream
bug, to be reported to NASA-AMMOS/3DTilesRendererJS**; the `remove` goes
once a release fixes it. Only a tile still FAILED is removed: one the
cache evicted meanwhile (an unused FAILED tile goes first) is UNLOADED
again, and the renderer asks for it itself once it wants it — removing
it then unloaded a tile that had come back, or aborted its load. The
HUD's pill goes (`onErrorCleared`) once nothing the network failed is
outstanding: every tile that gave up has landed, or the renderer's
update after the heal did not ask for it again (its `update-after`: left
UNLOADED out of view, or failed for another reason) — `landed()` says
so at a landing, the watch's `onClear` at once. A pill that went with
the first healed tile to land stayed up for good over a working network
when the player had moved on, and went while others were still missing.

**The boot waits for the network.** Before the first frame a network
give-up on the spawn tile or the tileset notes `net-wait` instead of
failing the boot; the boot fails only after 60 s of a visible page since
the stream started without those tiles back, with a `network: `
message. The wait ends when the last of them lands — a boot that got its
tiles back and is only slow is not failed for the blip — and a give-up
after that waits afresh, from its own moment.
Then, and when the manifest never came, the boot error
(`boot-error.tsx`) says *Keine Verbindung zum Server. Prüfe die
Internetverbindung und versuche es noch einmal.*, the browser's own text
under *Details*, and offers *Erneut versuchen*. After the first frame a
tile that gave up says *Keine Verbindung zum Server — ein Teil der Stadt
fehlt, neuer Versuch folgt.* in the pill.

**The manifest never falls back to an unhashed name.** It is fetched
`no-cache` for 20 s; once that gives up, the copy this browser cached last
will do (`force-cache`; its hashed files are likely cached too). Without
either there is nothing to start from, and the boot error's *Erneut
versuchen* fetches it again in place.

**An optional side file** (lamps, rails, trees, …) is retried for its 8 s
first; only a failure that outlasts them, a 404 or unparseable content
turns its feature off — ADR 0006's policy, amended.

**What the reports see** (ADR 0043): the breadcrumbs `net-retry` (one
note at the start of a burst, then one per 10 s with the count, the
cause and `online=… vis=…`) and `net-wait`; `load-error` only once a
budget is spent; a `boot failed` with a `network:` detail is an error, not
fatal; a load-error or failed boot noted while the page is hidden, or once
it is leaving, is aftermath (a breadcrumb, no event). The heartbeat says
what is in flight: `net 4d 2p 0f`, and `offline` when the browser thinks
so.

## Consequences

- On a dead network (online, nothing answers) or none (offline) the boot
  waits about a minute of a visible page instead of failing at once, and
  the load screen gives no reason meanwhile — a *Warte auf Verbindung*
  hint there is a follow-up. A retry waits for a usable page, so offline
  a give-up comes up to one probe (15 s) past its budget.
- A tile that retries holds one of the renderer's download slots for up
  to 20 s of visible time (a phone has four per origin, ADR 0047).
- `resetFailedTiles()` also turns a tile that FAILED for another reason (a
  404, a parse error) back to UNLOADED: it is not asked for again until
  evicted, and its parent is drawn instead of a hole.
- Not yet through the policy: the soundscape's and the minimap's PNGs and
  the inquiry card's facts fetch directly, and a dressing that failed
  transiently is not queued again — follow-ups. The optional fetchers
  still return null after their budget (throwing would turn two callers'
  failures into unhandled rejections and settle a dressing for good); a
  raster that gave up is absent for as long as its shared copy is held.
- The live bicycle feed (ADR 0040) is retried for up to 8 s too: a few
  more requests to the city's host while it is down.
- A gzip is inflated only once its body was read whole (a body cut off
  in transit fails its read, which is retried), so whatever the
  `DecompressionStream` throws there is the file's: a corrupt tile is a
  hole and one `onError`, a corrupt optional file is off.
- New network reads use `fetchBytes` with a budget from
  `fetch-retry.ts`; a new decision on a load-error asks `failed()` of the
  network watch first.

## Alternatives

- **Deciding at once** (the state before): every blip a hole, an "off"
  feature or a failed boot, and a report of it.
- **Retrying forever**: a boot that never says why it waits, a tile slot
  held for good. The budgets end in a decision the HUD can word.
- **Counting wall-clock time**: a phone in a pocket or a tab in the
  background would use the budget up while it could not have succeeded.
- **Counting only usable time** (visible and online; the first version):
  offline, nothing ever gave up (above).
- **Trusting `navigator.onLine`**: a hint; a missed `online` event would
  strand a page that has its network back. A visible page tries every 15 s
  whatever it says, and the healer runs on any visible page.
- **The tile renderer's own retry**: 0.5.3 has none, and its
  `resetFailedTiles()` does not do what it says (above).
- **A service worker over the tileset** (the backlog's direction option
  7): it would make repeat visits survive a dead network, not a first
  one; a cache to keep and update. Still an option.
- **Falling back to the unhashed tileset**: it is not published
  ([ADR 0007](./0007-content-hashed-publishing-with-a-manifest.md)); the
  browser's cached manifest is the only honest fallback.

## References

- `lib/city/fetch-retry.ts` (+ test), `app/_components/net-gate.ts`
  (`createNetGate`, + test),
  `app/_components/fetch-optional.ts` (`fetchBytes`, + test),
  `app/_components/raster-upload.ts` (`fetchRasterBytes`, + test),
  `app/_components/vegetation-layer.ts` (`loadNdviSampler`),
  `app/_components/tile-retry.ts` (+ test), `app/_components/tile-stream.ts`
  (`ContentFetchPlugin`), `app/_components/boot-error.tsx`,
  `app/_components/city-walk-client.tsx` (the manifest),
  `app/_components/create-app.ts` (the load-error block)
- `node_modules/3d-tiles-renderer`: `TilesRendererBase.resetFailedTiles`,
  `LRUCache.add` (0.5.3)
- [ADR 0006](./0006-tile-block-with-one-primary-and-one-artifact-map.md),
  [ADR 0007](./0007-content-hashed-publishing-with-a-manifest.md),
  [ADR 0043](./0043-crash-and-page-reports-to-an-error-tracker.md),
  [ADR 0045](./0045-legal-pages-from-the-deployment.md),
  [ADR 0046](./0046-a-per-device-safety-ladder-for-gpu-loss.md),
  [ADR 0047](./0047-phone-memory-budget-in-true-bytes.md)
