# ADR 0018: Headless tests run a lite profile and count frames; visuals are judged on a real GPU through snapshots

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-10

## Context

Headless Chromium has no WebGPU adapter and shades every pixel on the CPU
(SwiftShader through the WebGL2 backend): seconds per frame at the full
profile, and shadows and antialiasing nothing like a GPU. A green run once
proved little — it skipped without WebGL and checked no layer. A reviewer
needs to see a visual change at a place and time, reproducibly.

## Decision

1. **Specs are budgeted in frames, not seconds** (`__poc.frames`,
   `waitForFrames`), and share one booted page per group.
2. **The viewer specs run `?scene=lite`**: the spawn tile only, a small
   shadow map, a low pixel ratio, fewer AO samples — the knobs that cost
   seconds per frame — with the same loaders, layers and materials as the
   full profile. Lite is never used to look at pixels.
3. **On CI a missing WebGL fails, never skips.** Layers are checked by a
   scene census, not by pixels.
4. **Anything visual is judged on a real GPU** with the snapshot harness
   (`bun run shots`, headed, full profile).
5. **The Snapshot is a validated contract** (`lib/city/snapshot.ts`): the
   camera pose, the sun's time and the look's few controls (*Nebel*, the
   crown switch, the style, the data layers — one table,
   `lib/city/look-controls.ts`). Parsing never throws, rejects non-finite
   numbers and clamps ranges. A snapshot key is never renamed; a removed
   control's key is retired for good (`RETIRED_SNAPSHOT_KEYS`), ignored on
   read and never reused.
6. **The look's fixed strengths are named constants** in their owners,
   not controls. Tuning one is a code change judged by snapshots of place
   and time against production.
7. **A PR that changes what the viewer shows carries snapshots** in its
   description (the `pr-snapshots` skill).

## Consequences

- A new spec drives `/dresden?scene=lite`; untagged it lands in the
  whole-site CI shard.
- A new control is a table row plus its owner's entry; a row without an
  owner is a type error.
- `bun run verify` (lint, typecheck, unit tests) is the pre-push gate.

## Alternatives

- **The full profile headless:** minutes per spec.
- **Skipping when WebGL is missing:** hides a broken browser bump.
- **Pixel diffs in CI:** SwiftShader output is not the product.
- **A slider for every look term:** each cost a table row, a store value,
  a snapshot key and a guide line in two languages, and the maintainer did
  not need the look tunable.
