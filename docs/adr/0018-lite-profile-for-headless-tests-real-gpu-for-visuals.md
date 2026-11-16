# ADR 0018: Headless tests run a lite profile and count frames; a picture is judged on a real GPU, and compared with its base in two tiers

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-11

## Context

Headless Chromium shades every pixel on the CPU (WebGPU over
SwiftShader's Vulkan): seconds per frame at the full
profile, and shadows and antialiasing nothing like a GPU. A green run once
proved little — it skipped without a GPU and checked no layer. A reviewer
needs to see a visual change at a place and time, reproducibly. A change
that means none — a refactor, a bump of three — asks another question:
did anything change? That one a software renderer can answer, since it
only has to agree with itself.

## Decision

1. **Specs are budgeted in frames, not seconds** (`__poc.frames`,
   `waitForFrames`), and share one booted page per group.
2. **The viewer specs run `?scene=lite`**: the spawn tile only, a small
   shadow map, a low pixel ratio, fewer AO samples — the knobs that cost
   seconds per frame — with the same loaders, layers and materials as the
   full profile. Lite is never used to look at pixels.
3. **On CI a missing WebGPU adapter fails, never skips.** Layers are checked by a
   scene census, not by pixels.
4. **Whether a picture is good is judged on a real GPU** with the
   snapshot harness (`bun run shots`, headed, full profile). No
   SwiftShader plate ever answers that.
5. **Whether a picture changed is compared, in two tiers** over one
   harness (`bun run plates`): the QA views of a base commit and of the
   head, rendered by the same browser on the same adapter on a held
   clock, diffed against that adapter's own noise floor. *Tier 1* is the
   CI runner's software renderer, on every pull request of this
   repository: a tripwire that says *changed*, never *good*. *Tier 2* is
   a real GPU; it gates nothing until the maintainer has chosen where
   it runs.
6. **No reference image is stored.** The base is built and rendered in
   the same run, so a driver or browser bump moves both sides alike.
7. **The Snapshot is a validated contract** (`lib/city/snapshot.ts`): the
   camera pose, the sun's time and the look's few controls (*Nebel*, the
   style, the data layers — one table,
   `lib/city/look-controls.ts`). Parsing never throws, rejects non-finite
   numbers and clamps ranges. A snapshot key is never renamed; a removed
   control's key is retired for good (`RETIRED_SNAPSHOT_KEYS`), ignored on
   read and never reused.
8. **The look's fixed strengths are named constants** in their owners,
   not controls. Tuning one is a code change judged by snapshots of place
   and time against production.
9. **A PR that changes what the viewer shows carries snapshots** in its
   description (the `pr-snapshots` skill), and so claims the change: the
   plates report its differing views. **A PR without them claims the
   picture is the same**: a differing view fails its check.

## Consequences

- A new spec drives `/dresden?scene=lite`; untagged it lands in the
  whole-site CI shard.
- A new control is a table row plus its owner's entry; a row without an
  owner is a type error.
- `bun run verify` (lint, typecheck, unit tests) is the pre-push gate.
- What holds a frame still for a plate lives behind the debug hook
  (`__poc.still`, `frameMs`): never a URL parameter, never in a build
  without `NEXT_PUBLIC_POC_DEBUG`.
- A tier's tolerance is a named constant with its measurement
  (`lib/city/plate-diff.ts`). A view that does not repeat is fixed or
  left out of the tier, never retried.
- A differing view is a question the PR answers, not by itself a fault
  (plan 086, ruling 3).

## Alternatives

- **The full profile headless:** minutes per spec.
- **Skipping when WebGPU is missing:** hides a broken browser bump.
- **Judging a look on SwiftShader:** its output is not the product.
  Comparing the renderer with itself asks nothing of its light.
- **Golden images**, in git or a bucket: megabytes that change with
  every look, and a driver update fails every PR.
- **A slider for every look term:** each cost a table row, a store value,
  a snapshot key and a guide line in two languages, and the maintainer did
  not need the look tunable.
