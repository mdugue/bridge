# ADR 0061: The scene runs in a worker; the page hosts it

- **Status:** accepted
- **Date:** 2026-11

## Context

The scene's script shared the page's thread with the HUD. While it booted
(compiles, tile parsing, uploads) the page stalled, and a phone's sidebar
sheet scrolled against a busy scene: the frame pace kept a scroll guard
and a 12 fps cap behind the sheet to keep the scroll alive. Browsers draw
WebGPU into an `OffscreenCanvas` from a dedicated worker, and
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
- The server runs in a worker (`scene-worker.ts`, created as
  `new Worker(…, { type: "module" })`; the bundler emits a classic
  bootstrap that loads the scene's chunks with `importScripts`) on the
  canvas's `OffscreenCanvas`; the page keeps input capture, pointer lock, layout,
  fonts and image composing. A browser that cannot draw from a worker —
  its hello reports no WebGPU adapter, no `requestAnimationFrame` or no
  `OffscreenCanvas` — is told so, as one without WebGPU is (ADR 0027); there is no fallback onto the page for old browsers.
  The same server runs on the page behind a `MessageChannel` only for
  debugging: `?thread=main` and three's Inspector (`?inspect=1`).
- A lost GPU the page recovers from by a reload is listed in the init
  (`reloadable`); the scene releases its device, then reports
  `onReload`.
- Behind a covering sheet the scene draws only what is asked of it: a
  call draws half a second at 12 fps and does not end the scene's
  standing still; a scene that moves in those frames (a glide a call
  started, a stream landing) keeps that rate; a still one draws nothing
  else.

## Consequences

- A scene module needs no DOM in tests or the worker; a new DOM need is a
  call from the page or a page-view field, never a global.
- Every HUD read of the scene is either the mirror (one frame stale) or a
  promise; a spec that writes and then reads awaits `handle.sync()`.
- A worker frees the page's thread, not the GPU: a long compile still
  holds the GPU process and can still stall the compositor.
- Errors and unhandled rejections in the worker reach the page's crash
  trail as page errors.
- A dependency that reads `window` breaks in the worker: 3DTilesRendererJS
  resolves tileset paths against `window.location`, patched to
  `globalThis.location` (`patches/3d-tiles-renderer@0.5.4.patch`) until
  upstream changes it. three's TextureLoader makes an `<img>`: an OBJ's
  textures decode through `createImageBitmap` (`design-bitmap-texture.ts`),
  and a Rhino file's textures and text dots, which three's 3DMLoader
  draws through the DOM, are left out, the panel saying so
  (`design-formats.ts`).

## Alternatives

- **Comlink or a generic RPC proxy:** hides which calls cross and makes
  every getter a promise; the mirror keeps the HUD's per-frame reads
  synchronous. Rejected.
- **Only the boot in a worker** (parse and compile there, draw on the
  page): three's renderers do not share a device across threads.
- **Keep the scroll guard and the 12 fps cap:** they treat the symptom
  and cost frames on every page.
