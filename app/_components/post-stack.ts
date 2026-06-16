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
import { PaperGrainEffect } from "./paper-grain-effect";

/** Photographic depth of field (autofocus on the crosshair) — default on. */
export const DEFAULT_DOF = true;
/** Focus mode: "auto" tracks the crosshair, "manual" uses a fixed distance. */
export type FocusMode = "auto" | "manual";
export const DEFAULT_FOCUS_MODE: FocusMode = "auto";
/** Default manual focus distance (m). */
export const DEFAULT_FOCUS_DISTANCE = 40;
/** Default warm-near/cool-far grading intensity (0..1). */
export const DEFAULT_DEPTH_GRADING = 0.5;
/** Default contact-shadow (SSAO) strength (0..1). */
export const DEFAULT_CONTACT_SHADOWS = 0.5;
/** Default paper-grain intensity (0..1). */
export const DEFAULT_PAPER_GRAIN = 0.25;

/** Initial focus distance before the first crosshair raycast lands. */
const HYPERFOCAL_M = 600;
/** AO intensity at contact-shadows slider = 1. */
const AO_INTENSITY_MAX = 6;

// focusRange is the metric over which a fragment ramps from sharp to fully
// blurred (CoC = smoothstep(0, focusRange, |dist − focusDistance|)). A fixed
// value can't serve a 2 km-deep scene, so — like a real lens — it scales with
// the focus distance: tight DoF up close, very deep DoF far away.
const FOCUS_RANGE_FACTOR = 0.7;
const FOCUS_RANGE_MIN = 12;
const FOCUS_RANGE_MAX = 2500;
function focusRangeFor(distance: number): number {
  return Math.min(
    Math.max(distance * FOCUS_RANGE_FACTOR, FOCUS_RANGE_MIN),
    FOCUS_RANGE_MAX
  );
}

/** Live DoF state for QA/diagnostics. */
export interface FocusInfo {
  bokehScale: number;
  /** the cocMaterial focus distance in metres (auto: distance to crosshair hit) */
  focusDistance: number;
  /** the cocMaterial sharp-ramp distance in metres */
  focusRange: number;
}

export interface PostStack {
  dispose: () => void;
  /** current DoF focus distance/range/bokeh (QA). */
  getFocusInfo: () => FocusInfo;
  render: (deltaSeconds: number) => void;
  /** 0..1 — soft contact-shadow (SSAO) strength; 0 disables the pass */
  setContactShadows: (strength: number) => void;
  /** 0..1 — strength of the warm-near/cool-far depth grade */
  setDepthGrading: (intensity: number) => void;
  setDepthOfField: (enabled: boolean) => void;
  /** manual focus distance in metres (only used in "manual" focus mode) */
  setFocusDistance: (meters: number) => void;
  /** "auto" = crosshair autofocus; "manual" = fixed distance slider */
  setFocusMode: (mode: FocusMode) => void;
  /** world-space point under the crosshair; null = nothing hit (sky) */
  setFocusTarget: (point: Vector3 | null) => void;
  /** 0..1 — paper-grain overlay intensity */
  setPaperGrain: (intensity: number) => void;
  setSize: (width: number, height: number) => void;
}

/**
 * postprocessing pipeline: render -> N8AO (soft contact shadows) ->
 * photographic DoF (toggleable, crosshair autofocus) -> SMAA + depth
 * grading + vignette + paper grain. The composer bypasses the renderer's
 * MSAA, so SMAA carries the antialiasing.
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
  ao.configuration.intensity = DEFAULT_CONTACT_SHADOWS * AO_INTENSITY_MAX;
  // Software WebGL (headless test runs) can't afford full-quality SSAO.
  ao.setQualityMode(navigator.webdriver ? "Performance" : "Medium");
  composer.addPass(ao);

  // Photographic DoF. focusDistance/focusRange are WORLD METRES in this version;
  // with `dof.target` set the effect recomputes focusDistance from that point
  // each frame (= "auto" crosshair focus). A wide focus range + gentle bokeh keep
  // most of a walking view sharp (the old 90 m / 2.4 read as a tilt-shift toy).
  const focusPoint = new Vector3(0, 0, -HYPERFOCAL_M);
  const dof = new DepthOfFieldEffect(camera, {
    focusRange: focusRangeFor(HYPERFOCAL_M),
    bokehScale: 0.9,
    resolutionScale: 0.5,
  });
  dof.target = focusPoint;
  let focusMode: FocusMode = DEFAULT_FOCUS_MODE;
  let manualDistance = DEFAULT_FOCUS_DISTANCE;
  const dofPass = new EffectPass(camera, dof);
  dofPass.enabled = DEFAULT_DOF;
  composer.addPass(dofPass);

  const grading = new DepthGradingEffect();
  grading.setIntensity(DEFAULT_DEPTH_GRADING);
  const grain = new PaperGrainEffect();
  grain.setIntensity(DEFAULT_PAPER_GRAIN);
  composer.addPass(
    new EffectPass(
      camera,
      new SMAAEffect(),
      grading,
      new VignetteEffect({ offset: 0.28, darkness: 0.5 }),
      grain
    )
  );

  return {
    render: (deltaSeconds) => composer.render(deltaSeconds),
    getFocusInfo: () => ({
      focusDistance: dof.cocMaterial.focusDistance,
      focusRange: dof.cocMaterial.focusRange,
      bokehScale: dof.bokehScale,
    }),
    setSize: (width, height) => composer.setSize(width, height),
    setDepthOfField: (enabled) => {
      dofPass.enabled = enabled;
    },
    setDepthGrading: (intensity) => grading.setIntensity(intensity),
    setContactShadows: (strength) => {
      const s = Math.min(Math.max(strength, 0), 1);
      ao.configuration.intensity = s * AO_INTENSITY_MAX;
      ao.enabled = s > 0.01;
    },
    setPaperGrain: (intensity) => grain.setIntensity(intensity),
    setFocusMode: (mode) => {
      focusMode = mode;
      if (mode === "manual") {
        // Drop the auto target and pin a fixed focus distance (world metres).
        dof.target = null;
        dof.cocMaterial.focusDistance = manualDistance;
        dof.cocMaterial.focusRange = focusRangeFor(manualDistance);
      } else {
        dof.target = focusPoint;
        dof.cocMaterial.focusRange = focusRangeFor(
          camera.position.distanceTo(focusPoint)
        );
      }
    },
    setFocusDistance: (meters) => {
      manualDistance = Math.max(1, meters);
      if (focusMode === "manual") {
        dof.cocMaterial.focusDistance = manualDistance;
        dof.cocMaterial.focusRange = focusRangeFor(manualDistance);
      }
    },
    setFocusTarget: (point) => {
      // Manual mode pins its own distance — ignore the crosshair raycast.
      if (focusMode !== "auto") {
        return;
      }
      // No hit (crosshair on sky) → keep the last focus (sticky), so tilting a
      // degree above a far building doesn't snap focus back to a near default.
      if (!point) {
        return;
      }
      focusPoint.copy(point);
      // Scale the sharp band to the focus distance: near subjects isolate, far
      // subjects (the old-town silhouette) keep the whole distance crisp.
      dof.cocMaterial.focusRange = focusRangeFor(
        camera.position.distanceTo(point)
      );
    },
    dispose: () => composer.dispose(),
  };
}
