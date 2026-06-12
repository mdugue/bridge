import { N8AOPostPass } from "n8ao";
import {
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  VignetteEffect,
} from "postprocessing";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { HalfFloatType, Vector2, Vector3 } from "three";
import { DepthGradingEffect } from "./depth-grading-effect";

/** Photographic depth of field (autofocus on the crosshair) — default on. */
export const DEFAULT_DOF = true;
/** Default warm-near/cool-far grading intensity (0..1). */
export const DEFAULT_DEPTH_GRADING = 0.5;

/** Focus fallback when the crosshair rests on the sky. */
const HYPERFOCAL_M = 600;

export interface PostStack {
  dispose: () => void;
  render: (deltaSeconds: number) => void;
  /** 0..1 — strength of the warm-near/cool-far depth grade */
  setDepthGrading: (intensity: number) => void;
  setDepthOfField: (enabled: boolean) => void;
  /** world-space point under the crosshair; null = nothing hit (sky) */
  setFocusTarget: (point: Vector3 | null) => void;
  setSize: (width: number, height: number) => void;
}

/**
 * postprocessing pipeline: render -> N8AO (grounding/clay feel) ->
 * photographic DoF (toggleable, crosshair autofocus) -> SMAA + depth
 * grading + vignette. The composer bypasses the renderer's MSAA, so SMAA
 * carries the antialiasing.
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

  // Photographic DoF: assigning `target` enables built-in autofocus.
  const focusPoint = new Vector3(0, 0, -HYPERFOCAL_M);
  const dof = new DepthOfFieldEffect(camera, {
    focusRange: 90,
    bokehScale: 2.4,
    resolutionScale: 0.5,
  });
  dof.target = focusPoint;
  const dofPass = new EffectPass(camera, dof);
  dofPass.enabled = DEFAULT_DOF;
  composer.addPass(dofPass);

  const grading = new DepthGradingEffect();
  grading.setIntensity(DEFAULT_DEPTH_GRADING);
  composer.addPass(
    new EffectPass(
      camera,
      new SMAAEffect(),
      grading,
      new VignetteEffect({ offset: 0.28, darkness: 0.5 })
    )
  );

  const viewDir = new Vector3();
  return {
    render: (deltaSeconds) => composer.render(deltaSeconds),
    setSize: (width, height) => composer.setSize(width, height),
    setDepthOfField: (enabled) => {
      dofPass.enabled = enabled;
    },
    setDepthGrading: (intensity) => grading.setIntensity(intensity),
    setFocusTarget: (point) => {
      if (point) {
        focusPoint.copy(point);
        return;
      }
      // Sky under the crosshair: relax toward a far focus.
      camera.getWorldDirection(viewDir);
      focusPoint.copy(camera.position).addScaledVector(viewDir, HYPERFOCAL_M);
    },
    dispose: () => composer.dispose(),
  };
}
