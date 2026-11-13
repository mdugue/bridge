# ADR 0061: The scene runs in a worker; the page hosts it

- **Status:** proposed
- **Date:** 2026-11

## Context

The scene's script shared the page's thread with the HUD. While it booted
(compiles, tile parsing, uploads) the page stalled, and a phone's sidebar
sheet scrolled against a busy scene: the frame pace kept a scroll guard
and a 12 fps cap behind the sheet to keep the scroll alive. Browsers draw
WebGPU and WebGL2 into an `OffscreenCanvas` from a dedicated worker, and
three's renderers run there since r180.

## Decision

- The scene (`create-app.ts` and everything it imports) touches no DOM.
  It reads the page through `page-view.ts`, gets its size, input, page
  events and the HUD's covers as calls, and asks the page for what only
  the page has: nameplate letters in the site's web fonts. An oxlint
  rule keeps `document`, `window` and `location` out of scene modules.
- `scene-server.ts` serves the scene over messages
  (`scene-protocol.ts`). `scene-client.ts` is the page's end: a handle
  whose getters read the mirror the scene sends when it changed, whose
  value calls return promises, and whose `sync()` waits for the mirror
  after a write.
- The server runs in a module worker (`scene-worker.ts`) on the canvas's
  `OffscreenCanvas`, and the page keeps input capture, pointer lock,
  layout, fonts and image composing. Where the worker cannot draw as the
  page would — its hello reports no WebGPU where the page has it, no
  WebGL2, no `requestAnimationFrame`, no `OffscreenCanvas`, or a loader
  that would decode images through `<img>` — the same server runs on the
  page behind a `MessageChannel`. One render path either way.
  `?thread=main|worker` chooses by hand; `?inspect=1` keeps the page.
- A worker that fails before the first frame (not the scene's boot) is
  retried once on the page on a new canvas. A lost GPU the page recovers
  from by a reload is listed in the init (`reloadable`); the scene
  releases its device, then reports `onReload`.
- Behind a covering sheet the scene draws only what is asked of it: a
  call wakes it for half a second at 12 fps; nothing else draws.

## Consequences

- A scene module needs no DOM in tests or the worker; a new DOM need is a
  call from the page or a page-view field, never a global.
- Every HUD read of the scene is either the mirror (one frame stale) or a
  promise; a spec that writes and then reads awaits `handle.sync()`.
- A worker frees the page's thread, not the GPU: a long compile still
  holds the GPU process and can still stall the compositor.
- Errors and unhandled rejections in the worker reach the page's crash
  trail as page errors.

## Alternatives

- **Comlink or a generic RPC proxy:** hides which calls cross and makes
  every getter a promise; the mirror keeps the HUD's per-frame reads
  synchronous. Rejected.
- **Only the boot in a worker** (parse and compile there, draw on the
  page): three's renderers do not share a device across threads.
- **Keep the scroll guard and the 12 fps cap:** they treat the symptom
  and cost frames on every page.
