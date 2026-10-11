# ADR 0051: Optional features start on first use through the spine's hooks; their code ships in the scene's chunk

- **Status:** accepted
- **Date:** 2026-10-10

## Context

The data layers, the picture styles and Modell are important, but most
visits never switch them on. Their runtime cost on the first load was
already gone (the data layers build on their first switch-on, no tier
warms the styles); what was left was their code in the scene's chunk —
the plan's estimate ≈ 33 KB gz for all three — and their wiring:
`bootApp` (create-app.ts) hooked each of them into `setSun`, `applyLook`,
the stream-change handler and the frame by hand. Plan 074 part B set out
to load them with `import()` on first use, behind one seam, the data
layers first.

Measured on plan 069's branch (plan 074's Findings: POC builds of both
sides, every script headless Chromium fetched until `__poc.ready` at
`/dresden?scene=lite`, `gzip -9` of the build's files): the data layers
as a chunk of their own moved 10.1 KB gz out of the first load and added
32.8 KB gz to it — 904 619 → 927 361 bytes. Next.js 16.3.7's Turbopack
hoists the modules only one chunk group needs into one scope; three.js
had been in the scene's, its functions called by local names. Imported
by the data layers' chunk too, it became a module both groups share and
left that scope: the scene's code went from 180 calls through a module
object (`(0,X.fn)(…)`) to 2 929. Keeping the largest app module the two
shared (rail-layer.ts) out of the data layers' reach won back 2.7 KB.
The cost is three's and is paid once, by the first lazy chunk that
imports it; the styles and Modell import `three/tsl` as much.

## Decision

- **An optional feature starts on its first use and from then on hears
  the spine through hooks** (`app/_components/feature-seam.ts`): the
  frame, the stream's changes, the look store and the scene's clock (a
  watched value: a feature that starts late reads it first, then hears
  its changes). `lazyFeature` starts it once, never after the spine is
  gone, and asks for a failed load again on the next use (the spine
  wants it on each switch-on, `wantOnSwitchOn`). The data
  layers are the first such feature (`data-layers-feature.ts`); a tile's
  traffic slot waits for the same start before it builds its bodies
  (`TileStreamContext.trafficBuilder`).
- **Its code ships in the scene's chunk** while it imports three.js:
  `lazyFeature`'s importer is the module itself, not an `import()`.

## Consequences

- The spine no longer wires the data layers by hand; it emits, and reads
  a started feature where it must answer synchronously (the probe's
  asks, the census, the card's hour). The seam measured byte-neutral
  (+97 B gz on the first load).
- A feature that imports three.js does not become a chunk of its own: the
  first one would cost the first load about 33 KB gz. Going lazy stays a
  one-line change in `create-app.ts`, worth making once what it moves
  outweighs that tax, the feature no longer imports three, or the bundler
  hoists a shared module with its importers — measure the first-load set
  again before and after.
- What the rest of the scene reads of a feature without it stays in the
  scene apart from the feature (the traffic's outline and hour,
  `traffic-flow.ts`), so the feature's module is the one place its code
  starts.
- The picture styles and Modell are not behind the seam yet: their
  hookups stay in `post-stack.ts` and `create-app.ts`.

## Alternatives

- **Each feature behind `import()`** (plan 074 part B as written):
  measured, a larger first load for the data layers; for all three about
  break-even after the one-time tax, with Modell's input checks still to
  untangle.
- **A lazy chunk that takes three's functions from the spine** instead of
  importing them: every layer module a factory with a prologue of
  injected TSL functions — a framework bigger than the three features,
  and a style no other layer follows.
- **Another bundler** (webpack's module concatenation): not measured —
  `next build` uses Turbopack here.
