# ADR 0018: Headless tests run a lite profile and count frames; a picture is judged on a real GPU, and compared with its base in two tiers

- **Status:** accepted
- **Date:** 2026-09, rewritten 2026-11

## Context

Headless Chromium shades every pixel on the CPU (WebGPU over
SwiftShader's Vulkan): seconds per frame at the full profile, and
shadows and antialiasing nothing like a GPU. A reviewer needs to see a
visual change at a place and time, reproducibly. A change that means
none asks another question — did anything change? — which a software
renderer can answer, since it only has to agree with itself.

## Decision

1. **Specs are budgeted in frames, not seconds** (`__poc.frames`,
   `waitForFrames`), and share one booted page per group.
2. **The viewer specs run `?scene=lite`**: the spawn tile only, a small
   shadow map, a low pixel ratio, fewer AO samples, with the same
   loaders, layers and materials as the full profile. Lite is never
   used to judge a look.
3. **On CI a missing WebGPU adapter fails, never skips.** Layers are
   checked by a scene census.
4. **Whether a picture is good is judged on a real GPU** (`bun run
   shots`, headed, full profile). No SwiftShader plate answers that.
5. **Whether a picture changed is compared, in two tiers** over one
   harness (`bun run plates`): QA views of a base commit and of the
   head, rendered by the same browser on the same adapter with the
   scene held still, diffed against that adapter's own noise floor.
   *Tier 1* is CI's software renderer: a tripwire that says *changed*,
   never *good*, over the few views that fit a job there — eight of
   fifty, on the spawn tile, in `lite`. It runs where it is asked for (a
   pull request's label `plates`, or by hand), as scaffolding while the
   rewrite series moves pixels (plan 087): not on every pull request.
   *Tier 2* is a real GPU and every view; it gates nothing until the
   maintainer has chosen where it runs.
6. **No reference image is stored.** The base is rendered in the same
   run, so a driver or browser bump moves both sides alike.
7. **The Snapshot is a validated contract** (`lib/city/snapshot.ts`): the
   camera pose, the sun's time and the look's few controls (one table,
   `lib/city/look-controls.ts`). Parsing never throws, rejects
   non-finite numbers and clamps ranges. A key is never renamed; a
   removed control's key is retired for good (`RETIRED_SNAPSHOT_KEYS`).
8. **The look's fixed strengths are named constants** in their owners,
   not controls. Tuning one is a code change judged by snapshots of place
   and time against production.
9. **A PR that changes what the viewer shows carries snapshots** in its
   description (the `pr-snapshots` skill) and names there the views it
   means to change. A compared run fails on a differing view and names
   it; the description says whether it was meant.

## Consequences

- A new spec drives `/dresden?scene=lite`; untagged it lands in the
  whole-site CI shard.
- A new control is a table row plus its owner's entry; a row without an
  owner is a type error.
- What holds a frame still lives behind the debug hook (`__poc.still`):
  never a URL parameter, never in a build without
  `NEXT_PUBLIC_POC_DEBUG`. A side that was not held fails the run.
- A tier's tolerance is a named constant with its measurement
  (`lib/city/plate-diff.ts`). A view that does not repeat is fixed or
  left out, never retried.
- A green tier 1 covers what it rendered and no more.

## Alternatives

- **The full profile headless:** minutes per spec.
- **Skipping when WebGPU is missing:** hides a broken browser bump.
- **Judging a look on SwiftShader:** its output is not the product.
  Comparing the renderer with itself asks nothing of its light.
- **Golden images**, in git or a bucket: megabytes that change with
  every look, and a driver update fails every PR.
- **A slider for every look term:** each cost a table row, a store
  value, a snapshot key and a guide line in two languages.
