# ADR 0017: Look controls declared in one table; the Snapshot is a validated, versioned contract

- **Status:** accepted
- **Date:** 2026-09-21 (plan 012)

## Context

Twenty-one look sliders were wired by hand in six places (the handle
interface and its forwarder, the debug hook, 21 `useState`s, 21 JSX
blocks, the Snapshot type with its copy/apply loops, and a second copy of
the type inside the e2e harness): ~16 edits in 4–5 files per new slider,
and 35 of 96 commits touched the three core files together. A pasted
Snapshot was applied after checking only `camera.pos.x`; a trimmed or
hand-edited one produced a NaN camera and `undefined` slider values while
reporting success.

## Decision

- `lib/city/look-controls.ts` is the one table: key, DOM id, label, group,
  initial value, optional max, and `snapshotKey`. It is pure (no three, no
  DOM) so the Playwright harness imports it. The HUD renders sliders from
  it, `lib/city/look-state.ts` holds one clamped value per row in a
  HUD-owned store the scene subscribes to (a late-streamed tile reads the
  current look at birth), `lib/city/snapshot.ts` serialises one
  `snapshotKey` per row, and each owner (clay material, post stack, scene,
  vegetation) applies its rows through a `Record<…LookKey, …>` the compiler
  keeps complete.
- `parseSnapshot` never throws and validates every field: finite numbers
  (`1e999` parses to Infinity and is rejected), `mode ∈ {walk, fly}`,
  `fov ∈ (0, 180)`, a parseable date, numeric percent keys,
  `focusMode ∈ {auto, manual}`, `focusDistanceM ≥ 1`. Unknown versions and
  unknown look keys are accepted (forward compatibility); legacy six-key
  snapshots still load. Ranges are clamped by the applier, not rejected.

## Consequences

- Adding a slider is one table row plus its owner's `apply` entry; a row
  without an owner is a type error, never a silent no-op.
- `snapshotKey` values are the persisted format: **never rename one**
  (old snapshots would silently lose that slider); add a key and keep the
  old one readable.
- The `__poc` setter names, slider DOM ids and labels are the e2e
  contract.
- The HUD's boot effect must never list the look state as a dependency —
  that would reboot the renderer on every slider move; the re-seed reads
  it through a ref.

## Alternatives

- **Copy the table into the e2e spec:** rejected (a STOP condition of the
  plan); the spec imports the pure module.
- **Reject out-of-range values:** clamping is friendlier for hand-edited
  QA snapshots.

## References

- plan 012; `lib/city/look-controls.ts`, `look-state.ts`, `snapshot.ts`
  and their tests; the skill's Snapshot JSON example.
