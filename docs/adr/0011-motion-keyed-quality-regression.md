# ADR 0011: Motion-keyed quality regression — DoF off while moving, SSAO never gated

- **Status:** accepted (amended 2026-09-22)
- **Date:** 2026-09 (plan 007), amended 2026-09-22 (SSAO)

## Context

The frame budget is fill-rate: N8AO (SSAO) and depth of field are the two
priciest passes and both are paid every frame, including while the camera
moves, when the eye cannot resolve bokeh anyway. Plan 007 introduced a
pure debounce (`lib/city/regression.ts`): regress on the first moving
frame, recover after 250 ms of stillness, with motion detected from the
camera transform so every input path is caught uniformly. SSAO was gated
too — and the contact shadows then blinked on every footstep, which reads
as a bug, not a saving.

## Decision

While the camera moves, only the **DoF pass** is skipped; it returns after
`RECOVER_MS = 250` of stillness. **SSAO is never motion-gated**: the N8AO
pass runs permanently at `configuration.halfRes` with depth-aware
upsampling, which costs about what the skip used to save. User intent and
regression are separate layers: sliders write `aoWanted`/`dofWanted`, the
loop writes `regressed`, and only `applyPassGating()` writes `.enabled`, so
recovery never resurrects a pass the user turned off. The SMAA / grading /
vignette / grain pass and the shadow map are never regressed.

## Consequences

- No visible pop on start/stop except the DoF blur returning, which the
  eye accepts.
- `halfRes`, `aoSamples` and `denoiseSamples` rebuild N8AO's materials and
  are construction-time settings; a motion-keyed switch there trades the
  flicker for a shader-recompile hitch.
- `regressed` is exposed on `__poc` so the e2e can assert the mechanism.
- The pixel-ratio drop under motion (plan 007 step 4) remains open: it
  needs a ~1 s hold before restoring and a real-GPU look.

## Alternatives

- **react-three-fiber's `regress()`:** rejected (ADR 0002).
- **Render-on-demand:** rejected — continuous input needs continuous
  frames.
- **Gating SSAO (the original plan):** rejected after shipping — the
  blink.

## Update (2026-09, ADR 0027)

The decision holds; the passes changed. N8AO is gone: the contact shadows
are three's `GTAONode`, always on, at half resolution with normals
reconstructed from depth, its occlusion raised to the *Kontaktschatten*
slider's exponent (0 = no darkening; there is no `aoWanted` and no pass
`.enabled` any more). The sample count (`aoSamplesFor`: 16, lite 8)
rebuilds the pass's material and stays a construction-time setting. DoF is
dropped while moving by switching between **two prebuilt
`RenderPipeline`s**, with and without `DepthOfFieldNode`, both built under
the load screen — never by swapping one pipeline's output node, which
would re-translate the whole post graph on the main thread each time a
flight starts or stops. `dofWanted` and `regressed` stay separate layers
and only the pipeline choice combines them (`post-stack.ts`).

## References

- plan 007; AGENTS.md "Contact shadows (SSAO) are never motion-gated";
  `post-stack.ts` (`setRegressed`), `lib/city/regression.ts`; commit
  bf05171.
