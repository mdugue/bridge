# ADR 0002: Imperative three.js inside a React shell, not react-three-fiber

- **Status:** accepted
- **Date:** 2026-06, confirmed 2026-09

## Context

React owns the HUD (sidebar, cards, minimap, loading screen). The scene is
a large imperative program: streamed tiles dressed by a plugin, instanced
sets, a shadow rig redrawn on demand, and a QA hook (`window.__poc`) the
tests drive.

## Decision

`app/_components/create-app.ts` builds the scene and returns a handle;
`city-walk.tsx` mounts it and talks to it through the handle and the
scene-status store. React never touches a three.js object. Pure, DOM-free
logic lives in `lib/city/` with unit tests (`lib/city/purity.test.ts`
keeps it free of the DOM and the renderer).

## Consequences

- The scene has one owner; a HUD change cannot rebuild the renderer.
- `lib/city` stays testable under `bun test`.

## Alternatives

- **react-three-fiber:** its frame loop is a bare `requestAnimationFrame`,
  its scheduling win (time-sliced mounts) is useless to imperative
  loaders, and the `__poc` handle would move onto a store. Rejected
  2026-09-18.
- **A render-on-demand loop:** continuous input needs continuous frames,
  and the e2e waits count frames (ADR 0018).
