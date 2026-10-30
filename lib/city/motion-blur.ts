/**
 * The camera's motion blur, measured on the CPU (app/_components/
 * motion-blur.ts draws it). The blur smears each pixel along the way its
 * point moved on screen since the last frame — the camera's movement only,
 * reconstructed from depth — and is drawn only where that way is long
 * enough to see: below it the frame keeps its antialiasing instead.
 *
 * `motionPixels` measures how far, in pixels, a sample of points in view
 * moved: a 3×3 grid across the picture, each near (the street at your
 * feet) and far off (the sky's rotation). A point that was behind the
 * last camera is a jump (a flight's start, a teleport): Infinity.
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

/** A frame's motion over the samples (px). */
export interface Motion {
  least: number;
  median: number;
  most: number;
}

// scratch: the measure runs every frame and allocates nothing
const moved = new Float64Array(SAMPLE_DISTANCES_M.length * GRID.length ** 2);
const view = new Float64Array(4);
const prev = new Float64Array(4);
const clip = new Float64Array(4);

function into(m: Mat4, v: Float64Array, out: Float64Array): void {
  for (let r = 0; r < 4; r++) {
    out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
  }
}

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
): Motion {
  // a perspective projection: 1 / tan of the half angles
  const sx = projection[0];
  const sy = projection[5];
  let n = 0;
  for (const d of SAMPLE_DISTANCES_M) {
    for (const y of GRID) {
      for (const x of GRID) {
        view[0] = (x / sx) * d;
        view[1] = (y / sy) * d;
        view[2] = -d;
        view[3] = 1;
        into(viewToPrev, view, prev);
        into(prevProjection, prev, clip);
        if (clip[3] <= 1e-6) {
          return { least: Infinity, median: Infinity, most: Infinity };
        }
        const dx = ((clip[0] / clip[3] - x) * width) / 2;
        const dy = ((clip[1] / clip[3] - y) * height) / 2;
        moved[n++] = Math.hypot(dx, dy);
      }
    }
  }
  moved.sort();
  return {
    least: moved[0],
    median: (moved[n / 2 - 1] + moved[n / 2]) / 2,
    most: moved[n - 1],
  };
}

/**
 * Whether a frame that moved so is drawn blurred. `everywhere`: only if
 * every sample smears a pixel — where the blur takes the antialiasing's
 * place (a phone), a point that barely moved would keep neither; under
 * SMAA (after the blur) half of them is enough.
 */
export function blurs(motion: Motion, everywhere: boolean): boolean {
  const measure = everywhere ? motion.least : motion.median;
  return measure >= BLUR_MIN_PX / SHUTTER && motion.most < BLUR_JUMP_PX;
}
