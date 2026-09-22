# ADR 0002: Imperative three.js inside a React shell, not react-three-fiber

- **Status:** accepted
- **Date:** 2026-06 (initial architecture), confirmed by a feasibility check 2026-09-18

## Context

React owns the HUD (sidebar, sliders, minimap, loading screen). The scene
is a large imperative three.js program: custom `onBeforeCompile` shader
patches on nearly every material, instanced vegetation chunked by hand, a
shadow rig that re-renders on demand, and a QA hook (`window.__poc`) that
tests drive. react-three-fiber (r3f) was evaluated when adaptive quality
under motion was planned, because r3f ships a `regress()` mechanism.

## Decision

`app/_components/create-app.ts` builds the scene imperatively and returns
a handle of setters; `city-walk.tsx` mounts it and forwards HUD state into
the handle. Pure, DOM-free logic lives in `lib/city/` with unit tests; the
WebGL glue lives in `app/_components/`. r3f is not used.

## Consequences

- The scene has one owner (`create-app.ts` plus the layer modules); React
  never touches three objects directly.
- Sliders are wired through one table (ADR 0017) instead of React state
  per uniform.
- `lib/city` must stay free of `three` and the DOM (enforced by
  `lib/city/purity.test.ts`) so its math is testable under `bun test`.
- Anyone porting to r3f would rebuild every `onBeforeCompile` patch as an
  escape hatch and the `__poc` handle on a store — the reasons it lost.

## Alternatives

- **react-three-fiber:** rejected 2026-09-18. Its frame loop is a bare
  `requestAnimationFrame`, frame-for-frame identical to
  `renderer.setAnimationLoop`; its scheduling win is time-slicing component
  mounts, useless to imperative loaders; a static-after-load scene is r3f's
  weakest case; every custom shader becomes an escape hatch.
- **Render-on-demand loop:** rejected — continuous input needs continuous
  frames, and it would break the frame-counted e2e waits (ADR 0018).

## References

- [plans/README.md](../plans/README.md#history) (plan 007 feasibility
  check, rejected list).
- README.md "Architecture"; AGENTS.md "Where things live".
