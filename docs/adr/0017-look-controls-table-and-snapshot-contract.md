# ADR 0017: Look controls declared in one table; the Snapshot is a validated, versioned contract

- **Status:** accepted; amended 2026-10-10: a row has no `max` any more
  (only the removed *Transparenz* had one); `focusMode`/`focusDistanceM`
  are no longer checked (depth of field lost its switch and its manual
  focus); and a removed control's key — `transparencyPct`,
  `leafFlutterPct`, `leafBrightPct`, `waterMistPct`, `dof`, `focusMode`,
  `focusDistanceM` — is an unknown key: kept, ignored on Apply, never an
  error; amended again 2026-10 (plan 073): the table holds only the
  controls people use — *Nebel*, beside the multi-tuft switch, the picture
  style and the data layers. The other 25 sliders are gone: the
  maintainer did not need the look tunable ("we don't need many of the
  settings anyway"), and each cost a table row, a store value, a
  snapshot key, a writer in its owner and a guide line in two languages
  while saving the GPU nothing (a uniform multiplier).
  Their terms stay, fixed at the sliders' defaults as named constants
  beside them in their owners (`TINT`, `WINDOWS`, `GROUND_DETAIL`,
  `SKY_VIEW`, `AO_EXPONENT`, …), so the default picture is unchanged.
  Their `snapshotKey`s are read and ignored, and never reused
  (`RETIRED_SNAPSHOT_KEYS`, which a test holds the table to)
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
- Tuning the fixed look (since plan 073) is an edit of a named constant
  in the term's owner, reviewed with snapshots of place and time — not a
  look-key pair, which only the remaining controls have. A snapshot does
  not carry the fixed strengths: it shows them as the build it is pasted
  into has them.
- `snapshotKey` values are the persisted format: **never rename one**
  (old snapshots would silently lose that slider); add a key and keep the
  old one readable. A removed control's key is retired for good
  (`RETIRED_SNAPSHOT_KEYS`): an old snapshot would set a new control that
  took it.
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
