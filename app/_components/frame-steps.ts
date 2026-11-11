/** The order of a frame's steps, in one list. */

/**
 * What a frame does, in the order it does it (create-app.ts `frame` binds
 * each name to its work). The order carries weight, and this list is where
 * it stands — frame-steps.test.ts holds it:
 *
 * - `clock` before everything: every step reads the frame's time step and
 *   whether the 10 Hz tick is due.
 * - `move` before `stream`: the tiles are asked for from where the cameras
 *   stand in this frame, not the last one.
 * - `stream` before `follow` and `view`: what the update brought into view
 *   or took out is flushed to the scene (the shadow map, the lamp pool,
 *   the styles' gathering) before anything follows the view over it.
 * - `follow` (the veil, the water's clock, vegetation and shadows after
 *   the eye, Modell's cuts) before `view`: the lens takes the frame's
 *   equivalent focal length from it.
 * - `view` (a capture's frustum, the lens, the view direction, the
 *   features hooked on the frame) before `tick` and `overlay`: the focus
 *   ray and the nameplate read the camera as this frame draws it.
 * - `tick` (the 10 Hz work, the focus, the fps) and `overlay` (the
 *   nameplate's placing) are CPU work before the render, not render time.
 * - `render` reads the shadow flag first: three clears it once the map is
 *   drawn.
 * - `after` in the render's own task: a capture's tile is only readable
 *   until the task ends; then the frame's times, its stillness and the
 *   boot's marks.
 */
export const FRAME_STEPS = [
  "clock",
  "move",
  "stream",
  "follow",
  "view",
  "tick",
  "overlay",
  "render",
  "after",
] as const;

export type FrameStep = (typeof FRAME_STEPS)[number];

/**
 * A frame from its steps: `begin` makes the frame's state from the
 * animation frame's time, and every step works on it in `FRAME_STEPS`'
 * order, whatever order `steps` names them in. A step that throws ends the
 * frame there (the loop's guard hears it).
 */
export function frameOf<F>(
  begin: (time: number) => F,
  steps: Record<FrameStep, (frame: F) => void>
): (time: number) => void {
  const ordered = FRAME_STEPS.map((name) => steps[name]);
  return (time) => {
    const frame = begin(time);
    for (const step of ordered) {
      step(frame);
    }
  };
}
