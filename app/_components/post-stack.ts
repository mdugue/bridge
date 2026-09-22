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
import {
  type FocusMode,
  LOOK_DEFAULTS,
  type LookValues,
  type PostLookKey,
} from "@/lib/city/look-controls";
import { DepthGradingEffect } from "./depth-grading-effect";
import { PaperGrainEffect } from "./paper-grain-effect";
import type { AoQuality } from "./scene-profile";

/** Initial focus distance before the first crosshair raycast lands. */
const HYPERFOCAL_M = 600;
/** AO intensity at contact-shadows slider = 1. */
const AO_INTENSITY_MAX = 6;
/** Below this slider value the AO pass is off rather than invisibly cheap. */
const AO_OFF_EPSILON = 0.01;

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
  /**
   * Pushes the rendering rows of the look — depth grading, contact shadows,
   * paper grain, depth of field and its focus mode/distance — into the passes.
   */
  applyLook: (look: LookValues) => void;
  dispose: () => void;
  /** current DoF focus distance/range/bokeh (QA). */
  getFocusInfo: () => FocusInfo;
  render: (deltaSeconds: number) => void;
  /** world-space point under the crosshair; null = nothing hit (sky) */
  setFocusTarget: (point: Vector3 | null) => void;
  /**
   * Reduced-quality mode while the camera moves: skips the DoF pass, whose
   * bokeh the eye cannot resolve through motion anyway. Contact shadows (AO)
   * stay on — see the half-res note at the pass — because a shadow that
   * vanishes the moment you move and reappears when you stop reads as a bug,
   * not as a saving. Layered under the sliders: it never resurrects a pass the
   * user turned off, and recovery restores exactly what they asked for.
   */
  setRegressed: (on: boolean) => void;
  setSize: (width: number, height: number) => void;
}

/**
 * postprocessing pipeline: render -> N8AO (soft contact shadows, half-res) ->
 * photographic DoF (toggleable, crosshair autofocus) -> SMAA + depth
 * grading + vignette + paper grain. The composer bypasses the renderer's
 * MSAA, so SMAA carries the antialiasing.
 */
export function createPostStack(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  aoQuality: AoQuality
): PostStack {
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const size = renderer.getSize(new Vector2());
  const ao = new N8AOPostPass(scene, camera, size.x, size.y);
  ao.configuration.aoRadius = 12;
  ao.configuration.intensity = LOOK_DEFAULTS.contact * AO_INTENSITY_MAX;
  // Half-resolution AO with depth-aware upsampling (n8ao's default upsampler).
  // This is what buys the pass its permanent seat: the AO buffer and its
  // denoise iterations are the priciest fill in the stack, and at a quarter of
  // the pixels they cost roughly a third — about what skipping the pass while
  // moving used to save, but paid every frame instead of flickering on and off.
  // Contact occlusion is low-frequency by nature (aoRadius 12 m), so the
  // upsample costs almost nothing visually; a hard geometric edge is carried
  // by the depth-aware weights, not by the AO resolution.
  // NB this is a construction-time setting on purpose: writing halfRes,
  // aoSamples or denoiseSamples rebuilds the pass's materials (see the
  // configuration Proxy in n8ao), so it must never be toggled per frame —
  // a motion-keyed quality switch here would trade a flicker for a recompile
  // hitch on every step.
  ao.configuration.halfRes = true;
  // Medium for the product, Performance for headless SwiftShader — decided
  // with the rest of the render budget (scene-profile.ts `aoQualityFor`).
  ao.setQualityMode(aoQuality);
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
  let focusMode: FocusMode = LOOK_DEFAULTS.focusMode;
  let manualDistance = LOOK_DEFAULTS.focusDistanceM;
  const dofPass = new EffectPass(camera, dof);
  dofPass.enabled = LOOK_DEFAULTS.dof;
  composer.addPass(dofPass);

  // User intent vs. motion regression are two independent layers: the look
  // writes the *Wanted flags, the render loop writes `regressed`, and only
  // applyPassGating() ever touches `.enabled`. Writing `.enabled` directly
  // from either side would make recovery clobber the user's choice.
  //
  // Only DoF is motion-gated. AO follows the slider alone: its contact
  // shadows are scene lighting, and lighting that blinks with every footstep
  // is worse than lighting that costs a little more.
  let aoWanted = LOOK_DEFAULTS.contact > AO_OFF_EPSILON;
  let dofWanted = LOOK_DEFAULTS.dof;
  let regressed = false;
  const applyPassGating = () => {
    ao.enabled = aoWanted;
    dofPass.enabled = dofWanted && !regressed;
  };

  const grading = new DepthGradingEffect();
  grading.setIntensity(LOOK_DEFAULTS.grading);
  const grain = new PaperGrainEffect();
  grain.setIntensity(LOOK_DEFAULTS.grain);
  composer.addPass(
    new EffectPass(
      camera,
      new SMAAEffect(),
      grading,
      new VignetteEffect({ offset: 0.28, darkness: 0.5 }),
      grain
    )
  );

  // One writer per rendering row — a Record over the keys, so a row added to
  // the table cannot go unapplied.
  const rows: Record<PostLookKey, (value: number) => void> = {
    contact: (strength) => {
      ao.configuration.intensity = strength * AO_INTENSITY_MAX;
      aoWanted = strength > AO_OFF_EPSILON;
    },
    grading: (intensity) => grading.setIntensity(intensity),
    grain: (intensity) => grain.setIntensity(intensity),
  };

  const setFocusMode = (mode: FocusMode) => {
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
  };
  const setFocusDistance = (meters: number) => {
    manualDistance = Math.max(1, meters);
    if (focusMode === "manual") {
      dof.cocMaterial.focusDistance = manualDistance;
      dof.cocMaterial.focusRange = focusRangeFor(manualDistance);
    }
  };

  return {
    render: (deltaSeconds) => composer.render(deltaSeconds),
    getFocusInfo: () => ({
      focusDistance: dof.cocMaterial.focusDistance,
      focusRange: dof.cocMaterial.focusRange,
      bokehScale: dof.bokehScale,
    }),
    setSize: (width, height) => composer.setSize(width, height),
    applyLook: (look) => {
      for (const key of Object.keys(rows) as PostLookKey[]) {
        rows[key](look[key]);
      }
      dofWanted = look.dof;
      applyPassGating();
      if (look.focusDistanceM !== manualDistance) {
        setFocusDistance(look.focusDistanceM);
      }
      if (look.focusMode !== focusMode) {
        setFocusMode(look.focusMode);
      }
    },
    setRegressed: (on) => {
      if (on === regressed) {
        return;
      }
      regressed = on;
      applyPassGating();
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
