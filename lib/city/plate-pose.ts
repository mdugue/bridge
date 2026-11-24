/**
 * Whether the scene's camera stands where a snapshot put it (plan 087):
 * the compared plates' check on their own harness. Base and head are
 * driven by one harness, so a pose that was not applied draws the same
 * wrong picture twice and a comparison alone calls it "the same". Pure:
 * the harness (e2e/snapshot-shot.spec.ts) hands it the snapshot's camera
 * and the scene's mirror of it.
 */
import type { CameraStateJson } from "./snapshot";

/**
 * How far a settled camera may stand off its snapshot: metres (the
 * walker's eye settles onto the ground, so its height has more room),
 * degrees, and Modell's scale as a share of itself. The rest is the
 * rounding of a pose written to the centimetre.
 */
export const POSE_SLACK = { m: 0.5, eyeM: 3, deg: 0.5, scale: 0.01 };

/** The angle between two headings (degrees, 0–180). */
export function turnBetween(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

type Xyz = CameraStateJson["pos"];

/** Whether two places lie further apart than `slack` on an axis (`y`:
 *  its own slack). */
function apart(a: Xyz, b: Xyz, slack: number, ySlack = slack): boolean {
  return (
    Math.abs(a.x - b.x) > slack ||
    Math.abs(a.z - b.z) > slack ||
    Math.abs(a.y - b.y) > ySlack
  );
}

/** What of Modell's view is not the snapshot's, or null. */
function modelFault(
  want: NonNullable<CameraStateJson["model"]>,
  got: NonNullable<CameraStateJson["model"]>
): string | null {
  if (got.preset !== want.preset) {
    return `Modell ${got.preset}, not ${want.preset}`;
  }
  if (apart(got.pivot, want.pivot, POSE_SLACK.m)) {
    return `Modell's pivot at ${JSON.stringify(got.pivot)}, not ${JSON.stringify(want.pivot)}`;
  }
  if (Math.abs(got.scale - want.scale) > want.scale * POSE_SLACK.scale) {
    return `Modell's scale 1:${got.scale}, not 1:${want.scale}`;
  }
  if (
    turnBetween(got.turnDeg, want.turnDeg) > POSE_SLACK.deg ||
    Math.abs(got.tiltDeg - want.tiltDeg) > POSE_SLACK.deg
  ) {
    return `Modell turned ${got.turnDeg}° and tilted ${got.tiltDeg}°, not ${want.turnDeg}° and ${want.tiltDeg}°`;
  }
  return null;
}

/**
 * What of the scene's camera (`got`) is not the snapshot's (`want`), or
 * null when it stands there. In Modell the view is its pivot, scale,
 * turn and tilt — the eye is the rig's own; outside it, the eye's place,
 * heading and pitch.
 */
export function poseFault(
  want: CameraStateJson,
  got: CameraStateJson
): string | null {
  if (got.mode !== want.mode) {
    return `mode ${got.mode}, not ${want.mode}`;
  }
  if (want.model || got.model) {
    return want.model && got.model
      ? modelFault(want.model, got.model)
      : `Modell ${got.model?.preset ?? "off"}, not ${want.model?.preset ?? "off"}`;
  }
  const off =
    apart(
      got.pos,
      want.pos,
      POSE_SLACK.m,
      want.mode === "walk" ? POSE_SLACK.eyeM : POSE_SLACK.m
    ) ||
    turnBetween(got.headingDeg, want.headingDeg) > POSE_SLACK.deg ||
    Math.abs(got.pitchDeg - want.pitchDeg) > POSE_SLACK.deg;
  return off
    ? `camera at ${JSON.stringify(got.pos)} heading ${got.headingDeg} pitch ${got.pitchDeg}, not ${JSON.stringify(want.pos)} heading ${want.headingDeg} pitch ${want.pitchDeg}`
    : null;
}
