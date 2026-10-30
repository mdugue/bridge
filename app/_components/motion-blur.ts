import {
  type DepthTexture,
  Matrix4,
  type Texture,
  Vector2,
} from "three/webgpu";
import {
  float,
  getScreenPosition,
  getViewPosition,
  min,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  blurs,
  MAX_BLUR_PX,
  motionPixels,
  SHUTTER,
} from "@/lib/city/motion-blur";
import type { F, V3, V4 } from "./shader-chunks";
import type { ViewLens } from "./view-lens";

/** Reads along a pixel's way (a phone's FXAA reads about as many). */
const TAPS = 8;

export interface MotionBlur {
  /**
   * `source` smeared along each pixel's way on screen, `occlusion` (the
   * contact shadows, read once at the pixel) multiplied in after.
   */
  over: (source: Texture, occlusion: F) => V4;
  /**
   * Measures the camera's motion since the last frame and sets the
   * uniforms for it: true while the frame is to be drawn blurred. Call it
   * once a frame, after the lens took the frame's camera. `on` false (a
   * style or Modell without the blur, a still camera) measures nothing
   * and forgets the last pose, so the next blurred frame starts from a
   * fresh one; so does a new size or projection, or a page that comes
   * back to the front.
   * `everywhere`: the blur replaces the antialiasing (lib/city/
   * motion-blur.ts `blurs`).
   */
  update: (size: Vector2, on: boolean, everywhere: boolean) => boolean;
  dispose: () => void;
}

/**
 * The camera's motion blur (lib/city/motion-blur.ts measures it): each
 * pixel's point, rebuilt from depth in the current view, taken into the
 * last frame's view and projected there; the way between the two on
 * screen, half of it (a 180° shutter) and at most `MAX_BLUR_PX`, is where
 * `TAPS` reads of the frame are averaged. The camera's movement only: a
 * swaying crown or a tram is smeared as the camera moved past it, and the
 * picture holds nothing of the last frame — no target, no history — only
 * three matrices. It draws inside a pass that is drawn anyway or in place
 * of one (post-stack.ts), never in a target of its own.
 */
export function createMotionBlur(
  depth: DepthTexture,
  lens: ViewLens
): MotionBlur {
  const view = lens.camera;
  // the lens's own matrix, written in place every frame
  const projectionInverse = uniform(view.projectionMatrixInverse);
  const viewToPrev = uniform(new Matrix4());
  const prevProjection = uniform(new Matrix4());
  const pixels = uniform(new Vector2(1, 1));

  const at = uv();
  const z = texture(depth, at).r;
  const here = getViewPosition(at, z, projectionInverse);
  const before = getScreenPosition(
    viewToPrev.mul(vec4(here, 1)).xyz,
    prevProjection
  );
  const way = at.sub(before).mul(SHUTTER);
  const length = way.mul(pixels).length().max(1e-4);
  // the longest smear, in uv
  const smear = way.mul(min(float(1), float(MAX_BLUR_PX).div(length))).toVar();

  const prevView = new Matrix4();
  const prevProj = new Matrix4();
  const prevSize = new Vector2();
  let held = false;
  // A page brought back to the front: its first frame is no frame's
  // motion (a flight went on while it was hidden). Not a time gap: a slow
  // renderer (or the QA's held loop) draws seconds apart and still moves
  // one frame at a time.
  const forget = () => {
    held = false;
  };
  document.addEventListener("visibilitychange", forget);

  return {
    over: (source, occlusion) => {
      let sum: V3 = vec3(0);
      for (let i = 0; i < TAPS; i++) {
        const t = (i + 0.5) / TAPS - 0.5;
        sum = sum.add(texture(source, at.add(smear.mul(t)), float(0)).rgb);
      }
      return vec4(sum.div(TAPS).mul(occlusion), 1);
    },
    update: (size, on, everywhere) => {
      const fresh =
        !held ||
        !size.equals(prevSize) ||
        !view.projectionMatrix.equals(prevProj);
      if (!on || lens.isOrtho()) {
        held = false;
        return false;
      }
      let blurred = false;
      if (!fresh) {
        viewToPrev.value.multiplyMatrices(prevView, view.matrixWorld);
        prevProjection.value.copy(prevProj);
        pixels.value.copy(size);
        blurred = blurs(
          motionPixels(
            viewToPrev.value.elements,
            view.projectionMatrix.elements,
            prevProj.elements,
            size.x,
            size.y
          ),
          everywhere
        );
      }
      prevView.copy(view.matrixWorldInverse);
      prevProj.copy(view.projectionMatrix);
      prevSize.copy(size);
      held = true;
      return blurred;
    },
    dispose: () => document.removeEventListener("visibilitychange", forget),
  };
}
