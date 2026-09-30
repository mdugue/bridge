# ADR 0018: Headless tests run a lite profile and assert presence; visuals are judged on a real GPU

- **Status:** accepted
- **Date:** 2026-09 (plans 001, 008; the lite profile)

## Context

Headless Chromium renders WebGL through SwiftShader: every pixel is shaded
on the CPU. At the full profile the scene took ~14 s to boot and ~4 s per
frame at 1280×720 on four cores, so specs that waited in seconds walked
into timeouts, and a green run proved little: the suite once *skipped* when
WebGL was missing, asserted a flag set unconditionally at boot, and checked
no layer beyond terrain and buildings while every loader swallowed failures
into an empty group. Shadows and anti-aliasing under SwiftShader look
nothing like a GPU.

## Decision

- **Budget in frames, not seconds.** The animation loop counts rendered
  frames on `__poc.frames`; specs wait with `waitForFrames`, never
  `waitForTimeout`.
- **The viewer specs run `?scene=lite`** (`scene-profile.ts`): primary
  tile only (`&block=1` keeps the block to exercise streaming), a 512²
  shadow map, pixel ratio 0.5 and N8AO's Performance mode — the four knobs
  that cost seconds per frame — while loaders, layers, shader programs and
  HUD wiring are identical to `full`. Boot 14 s → ~4.4 s, 74 MB → 18 MB.
  Specs share one booted page (`serial` + `beforeAll`).
- **On CI, missing WebGL fails, never skips.** Layers are verified by a
  per-layer scene census (`__poc.stats.layerStats`: meshes, instances,
  triangles); demolish must shrink the city triangle count; `afterAll`
  checks for page errors; failure leaves a screenshot and a trace.
- **Anything visual is judged on a real GPU** with the snapshot harness:
  a Snapshot JSON in `shots/` and `bun run shots` (`SHOTS=1`, `--headed`,
  full profile). The harness is excluded from the default e2e run so it
  can never overwrite real-GPU plates with SwiftShader renders.
- `bun run verify` (lint + typecheck + unit) is the pre-push gate and
  mirrors CI; unit tests are invoked with explicit directories because a
  bare `bun test` would load the Playwright specs.

## Consequences

- Lite is never used to look at pixels; the AO quality is keyed on the
  profile, not on `navigator.webdriver`, so the headed harness renders the
  product's AO.
- Adding a layer requires a `LayerName`, a census line and an e2e
  assertion; adding a GeoJSON artifact requires a contract row in
  `lib/city/features.ts`.
- Perf mechanisms are asserted by counters (`shadowRenders < frames / 2`
  while walking, `regressed`), not profilers.
- Open from plan 008: the CI e2e path gate does not yet include
  `scripts/`, `data/`, `patches/`; no shader-anchor tests pin the
  `onBeforeCompile` chunk names; coverage is not published.

## Alternatives

- **Full profile headless:** minutes per spec; rejected.
- **Skip when WebGL is missing:** hides a broken Chromium/Playwright
  bump; rejected.
- **Pixel-diff screenshots in CI:** SwiftShader output is not the
  product; rejected.

## Update (2026-09, ADR 0027)

Headless Chromium offers no WebGPU adapter, so the e2e runs on
`WebGPURenderer`'s WebGL2 backend over SwiftShader: the same node
materials as on a GPU, compiled synchronously. The lite profile's fourth
knob is now GTAO at 8 samples instead of 16 (`aoSamplesFor`; N8AO's
Performance mode is gone with N8AO), still keyed on the profile. The
preflight is `gpu-support.ts` (WebGPU or WebGL2). The open shader-anchor
tests are moot: there are no `onBeforeCompile` chunk names left to pin.

## References

- plans 001, 008; AGENTS.md "QA: self-verify"; the skill's "The `lite`
  scene profile"; `app/_components/scene-profile.ts`,
  `app/_components/scene-census.ts`, `e2e/`.
