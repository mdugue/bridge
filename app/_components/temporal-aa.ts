import {
  HalfFloatType,
  Matrix4,
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  Vector2,
} from "three/webgpu";
import type { Camera, DepthTexture, WebGPURenderer } from "three/webgpu";
import {
  dot,
  float,
  getScreenPosition,
  getViewPosition,
  max,
  min,
  mix,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { CURRENT_WEIGHT, jitterOffset } from "@/lib/city/temporal-aa";
import type { F, V3 } from "./shader-chunks";
import type { ViewLens } from "./view-lens";

/**
 * Temporal antialiasing (*TAA*, a desktop's): each frame of the scene is
 * drawn a fraction of a pixel off the last (`jitter`, a Halton cycle), and
 * averaged into a history the camera's motion carries along (`resolve`).
 * What no single frame can draw — a window a pixel wide in a street seen
 * along its length, a crown's leaves, a fine line — settles to its share
 * of the pixel instead of hopping from pixel to pixel as the eye moves.
 *
 * The camera's motion only, rebuilt from depth (as the motion blur does:
 * the clay has no inter-stage variable left for a velocity output); what
 * moves of itself (a tram, a swaying crown) is held to its neighbourhood
 * by clamping the history to the new frame's 3×3 colours, so it leaves no
 * trail. The resolved frame is copied back over the scene target, so
 * every pass after reads it where it read the scene before.
 *
 * Two full-resolution half-float targets (the history, ping-pong): 16
 * bytes a pixel, ≈ 30 MB at 2560×1440 — a desktop only (scene-profile.ts
 * `PostProfile.taa`).
 */
export interface TemporalAA {
  /** Shifts a perspective camera by this frame's offset before the scene
   *  is drawn; false (nothing done) for a parallel one, or one whose view
   *  is offset already (an export's tile). */
  jitter: (view: Camera, size: Vector2) => boolean;
  /** Takes the shift off again, right after the scene is drawn. */
  unjitter: (view: Camera) => void;
  /** Averages the scene target into the history and writes the result
   *  back over it; `fresh`: start the history from this frame. */
  resolve: (renderer: WebGPURenderer, fresh: boolean) => void;
  /** Forgets the history (a jump, a style change, a new size). */
  reset: () => void;
  setSize: (size: Vector2) => void;
  dispose: () => void;
}

type Offsettable = Camera & {
  isPerspectiveCamera?: boolean;
  view?: { enabled: boolean } | null;
  setViewOffset?: (
    fullWidth: number,
    fullHeight: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;
  clearViewOffset?: () => void;
};

/** Luma, for the weights that keep a bright highlight from flickering. */
const luma = (c: V3): F => dot(c, vec3(0.299, 0.587, 0.114));

export function createTemporalAA(
  scene: RenderTarget,
  depth: DepthTexture,
  lens: ViewLens,
  size: Vector2
): TemporalAA {
  const history = [0, 1].map((i) => {
    const t = new RenderTarget(size.x, size.y, {
      type: HalfFloatType,
      depthBuffer: false,
    });
    t.texture.name = `TemporalHistory${i}`;
    return t;
  });
  let current = 0;
  let frame = 0;
  let valid = false;

  const texel = uniform(new Vector2(1 / size.x, 1 / size.y));
  const viewToPrev = uniform(new Matrix4());
  const prevProjection = uniform(new Matrix4());
  const prevView = new Matrix4();
  const prevProj = new Matrix4();
  // 1: this frame alone (no history yet)
  const restart = uniform(1);
  const past = texture(history[0].texture);

  const at = uv();
  const z = texture(depth, at).r;
  const here = getViewPosition(at, z, lens.inverseProjection);
  const before = getScreenPosition(
    viewToPrev.mul(vec4(here, 1)).xyz,
    prevProjection
  );
  const now = texture(scene.texture, at);
  // the new frame's neighbourhood: the history is held within it
  let lo: V3 = now.rgb;
  let hi: V3 = now.rgb;
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    const n = texture(scene.texture, at.add(vec2(dx, dy).mul(texel))).rgb;
    lo = min(lo, n);
    hi = max(hi, n);
  }
  const inside = before.x
    .greaterThanEqual(0)
    .and(before.x.lessThanEqual(1))
    .and(before.y.greaterThanEqual(0))
    .and(before.y.lessThanEqual(1));
  const held = past.sample(before).rgb.clamp(lo, hi);
  const share = select(inside, float(CURRENT_WEIGHT), float(1)).max(restart);
  // weighted by 1 / (1 + luma): a highlight a pixel wide does not pulse
  const wNow = share.div(luma(now.rgb).add(1));
  const wPast = float(1).sub(share).div(luma(held).add(1));
  const resolved = mix(held, now.rgb, wNow.div(wNow.add(wPast).max(1e-6)));

  const material = new NodeMaterial();
  material.fragmentNode = vec4(resolved, now.a);
  material.name = "TemporalAA";
  const quad = new QuadMesh(material);

  let jittered: Offsettable | null = null;

  return {
    jitter: (view, drawn) => {
      const v = view as Offsettable;
      if (!v.isPerspectiveCamera || v.view?.enabled || !v.setViewOffset) {
        jittered = null;
        valid = false;
        return false;
      }
      const [jx, jy] = jitterOffset(frame);
      v.setViewOffset(drawn.x, drawn.y, jx, jy, drawn.x, drawn.y);
      jittered = v;
      return true;
    },
    unjitter: (view) => {
      const v = view as Offsettable;
      if (jittered === v) {
        v.clearViewOffset?.();
      }
      jittered = null;
    },
    resolve: (renderer, fresh) => {
      const cam = lens.camera;
      viewToPrev.value.multiplyMatrices(prevView, cam.matrixWorld);
      prevProjection.value.copy(prevProj);
      restart.value = fresh || !valid ? 1 : 0;
      const into = history[1 - current];
      past.value = history[current].texture;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(into);
      try {
        quad.render(renderer);
      } finally {
        renderer.setRenderTarget(previous);
      }
      renderer.copyTextureToTexture(into.texture, scene.texture);
      current = 1 - current;
      prevView.copy(cam.matrixWorldInverse);
      prevProj.copy(cam.projectionMatrix);
      frame += 1;
      valid = true;
    },
    reset: () => {
      valid = false;
    },
    setSize: (s) => {
      for (const t of history) {
        t.setSize(s.x, s.y);
      }
      texel.value.set(1 / s.x, 1 / s.y);
      valid = false;
    },
    dispose: () => {
      for (const t of history) {
        t.dispose();
      }
      material.dispose();
    },
  };
}
