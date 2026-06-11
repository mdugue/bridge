import { N8AOPostPass } from "n8ao";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  TiltShiftEffect,
  VignetteEffect,
} from "postprocessing";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { HalfFloatType, Vector2 } from "three";

/** The chosen DoF flavor: a horizontal focus band, miniature-model look. */
export const DEFAULT_TILT_SHIFT = true;

export interface PostStack {
  dispose: () => void;
  render: (deltaSeconds: number) => void;
  setSize: (width: number, height: number) => void;
  setTiltShift: (enabled: boolean) => void;
}

/**
 * postprocessing-based pipeline: render -> N8AO (grounding/clay feel) ->
 * tilt-shift band blur (toggleable) -> SMAA + vignette. The composer bypasses
 * the renderer's MSAA, so SMAA carries the antialiasing.
 */
export function createPostStack(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera
): PostStack {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const size = renderer.getSize(new Vector2());
  const ao = new N8AOPostPass(scene, camera, size.x, size.y);
  ao.configuration.aoRadius = 12;
  ao.configuration.intensity = 3;
  // Software WebGL (headless test runs) can't afford full-quality SSAO.
  ao.setQualityMode(navigator.webdriver ? "Performance" : "Medium");
  composer.addPass(ao);

  const tiltShiftPass = new EffectPass(
    camera,
    new TiltShiftEffect({ focusArea: 0.35, feather: 0.25 })
  );
  tiltShiftPass.enabled = DEFAULT_TILT_SHIFT;
  composer.addPass(tiltShiftPass);

  composer.addPass(
    new EffectPass(
      camera,
      new SMAAEffect(),
      new VignetteEffect({ offset: 0.28, darkness: 0.5 })
    )
  );

  return {
    render: (deltaSeconds) => composer.render(deltaSeconds),
    setSize: (width, height) => composer.setSize(width, height),
    setTiltShift: (enabled) => {
      tiltShiftPass.enabled = enabled;
    },
    dispose: () => composer.dispose(),
  };
}
