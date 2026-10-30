/**
 * The camera's motion blur, measured on the CPU (app/_components/
 * motion-blur.ts draws it). The blur smears each pixel along the way its
 * point moved on screen since the last frame — the camera's movement only,
 * reconstructed from depth — and is drawn only where that way is long
 * enough to see: below it the frame keeps its antialiasing instead.
 *
 * `motionPixels` is how far, in pixels, a sample of points in view moved:
 * a 3×3 grid across the picture, each at the near distances a walk sees
 * (the street at your feet) and far off (the sky's rotation). The largest
 * is the frame's measure. A point that was behind the last camera is a
 * jump (a flight's start, a teleport): Infinity.
 */

/** Below this (px) the blur is not drawn: the frame keeps its AA. */
export const BLUR_MIN_PX = 1;
/** Above this (px) a frame is a jump, not motion: no blur (one frame). */
export const BLUR_JUMP_PX = 600;
/** Share of a frame's motion the shutter is open for (180°). */
export const SHUTTER = 0.5;
/** The longest smear (px): a fast flight's street does not dissolve. */
export const MAX_BLUR_PX = 32;

/** View distances (m) the measure samples at. */
const SAMPLE_DISTANCES_M = [3, 1000];
const GRID = [-0.9, 0, 0.9];

/** A 4×4 matrix's elements, column-major (three's `Matrix4.elements`). */
export type Mat4 = ArrayLike<number>;

/**
 * How far (px) the view's points moved on screen since the last frame.
 * `viewToPrev` takes the current view space into the last frame's (its
 * view matrix times the current camera's world matrix), `projection` and
 * `prevProjection` are the two frames' perspective projections.
 */
export function motionPixels(
  viewToPrev: Mat4,
  projection: Mat4,
  prevProjection: Mat4,
  width: number,
  height: number
): number {
  // a perspective projection: 1 / tan of the half angles
  const sx = projection[0];
  const sy = projection[5];
  const into = (m: Mat4, v: number[]): number[] =>
    [0, 1, 2, 3].map(
      (r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]
    );
  let largest = 0;
  for (const d of SAMPLE_DISTANCES_M) {
    for (const y of GRID) {
      for (const x of GRID) {
        const clip = into(
          prevProjection,
          into(viewToPrev, [(x / sx) * d, (y / sy) * d, -d, 1])
        );
        if (clip[3] <= 1e-6) {
          return Infinity;
        }
        const dx = ((clip[0] / clip[3] - x) * width) / 2;
        const dy = ((clip[1] / clip[3] - y) * height) / 2;
        largest = Math.max(largest, Math.hypot(dx, dy));
      }
    }
  }
  return largest;
}

/** Whether a frame that moved `px` is drawn blurred. */
export function blurs(px: number): boolean {
  return px >= BLUR_MIN_PX / SHUTTER && px < BLUR_JUMP_PX;
}
