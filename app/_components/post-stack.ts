import {
  type BufferGeometry,
  DepthTexture,
  HalfFloatType,
  NoToneMapping,
  type Object3D,
  type PerspectiveCamera,
  RenderPipeline,
  RenderTarget,
  SRGBColorSpace,
  type Scene,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import {
  clamp,
  distance,
  dot,
  float,
  floor,
  fract,
  mix,
  nodeObject,
  perspectiveDepthToViewZ,
  pow,
  reference,
  renderOutput,
  screenCoordinate,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  type FocusMode,
  LOOK_DEFAULTS,
  type LookValues,
  type PostLookKey,
} from "@/lib/city/look-controls";
import type { F, V2, V4 } from "./shader-chunks";

/** Initial focus distance before the first crosshair raycast lands. */
const HYPERFOCAL_M = 600;
/** GTAO radius in metres (view space). */
const AO_RADIUS_M = 6;
/** The AO's exponent at contact-shadows slider = 1 (occlusion^k). */
const AO_INTENSITY_MAX = 3;

// focusRange is the metric over which a fragment ramps from sharp to fully
// blurred. A fixed value can't serve a 2 km-deep scene, so — like a real
// lens — it scales with the focus distance: tight DoF up close, very deep
// DoF far away. The band is generous on purpose: the lens should only hint
// at depth. At 0.7 × distance (min 12 m) a crosshair on the pavement ten
// metres ahead blurred the whole street beyond 22 m — it read as smeared,
// not as a lens.
const FOCUS_RANGE_FACTOR = 1.6;
const FOCUS_RANGE_MIN = 45;
const FOCUS_RANGE_MAX = 3000;
/** Bokeh radius scale: a soft hint of lens, never a smear. */
const BOKEH_SCALE = 0.5;
function focusRangeFor(distanceM: number): number {
  return Math.min(
    Math.max(distanceM * FOCUS_RANGE_FACTOR, FOCUS_RANGE_MIN),
    FOCUS_RANGE_MAX
  );
}

/** Depth grading reaches full strength at this view distance (m). */
const GRADE_DISTANCE_M = 800;
/** The vignette: offset and darkness of the classic smoothstep falloff. */
const VIGNETTE_OFFSET = 0.28;
const VIGNETTE_DARKNESS = 0.5;

/** Live DoF state for QA/diagnostics. */
export interface FocusInfo {
  bokehScale: number;
  /** the focus distance in metres (auto: distance to the crosshair hit) */
  focusDistance: number;
  /** the sharp-ramp distance in metres */
  focusRange: number;
}

export interface PostStack {
  /**
   * Builds `object`'s node materials and compiles their pipelines off the
   * frame, for the target the scene renders into (a pipeline is specific
   * to its attachments). Tiles await it before they show, so a landing tile
   * never stalls a frame on a synchronous build.
   */
  compile: (object: Object3D) => Promise<void>;
  /**
   * Pushes the rendering rows of the look — depth grading, contact shadows,
   * paper grain, depth of field and its focus mode/distance — into the passes.
   */
  applyLook: (look: LookValues) => void;
  dispose: () => void;
  /** current DoF focus distance/range/bokeh (QA). */
  getFocusInfo: () => FocusInfo;
  /** Draws the scene into its target, then the post chain to the canvas. */
  render: () => void;
  /** world-space point under the crosshair; null = nothing hit (sky) */
  setFocusTarget: (point: Vector3 | null) => void;
  /**
   * Reduced-quality mode while the camera moves: skips the DoF pass, whose
   * bokeh the eye cannot resolve through motion anyway. Contact shadows (AO)
   * stay on — the pass runs at half resolution for that — because a shadow
   * that vanishes the moment you move and reappears when you stop reads as
   * a bug, not as a saving. Layered under the sliders: it never resurrects a
   * pass the user turned off, and recovery restores exactly what they asked
   * for.
   */
  setRegressed: (on: boolean) => void;
  /** Follows the canvas (the scene target is drawing-buffer sized). */
  setSize: () => void;
}

/** A cheap 2D hash for the paper grain. */
function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

/**
 * Depth grading, vignette and paper grain on the antialiased image:
 * - painterly aerial perspective — a warm tint up close, cooler and gently
 *   desaturated with distance (the classic watercolour depth cue);
 * - the vignette's smoothstep falloff toward the corners;
 * - a static, screen-anchored paper speckle plus faint row-correlated fibre
 *   banding — the sheet the scene is drawn on, not film grain.
 */
function finish(input: V4, viewZ: F, grading: F, grain: F): V4 {
  const t = smoothstep(
    0.04,
    1,
    clamp(viewZ.negate().div(GRADE_DISTANCE_M), 0, 1)
  ).mul(grading);
  const tinted = input.rgb.mul(
    mix(vec3(1.045, 1, 0.94), vec3(0.91, 0.965, 1.06), t)
  );
  const luma = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
  const graded = mix(tinted, vec3(luma), t.mul(0.3));
  const vignette = smoothstep(
    0.8,
    VIGNETTE_OFFSET * 0.799,
    distance(screenUV, vec2(0.5)).mul(VIGNETTE_DARKNESS + VIGNETTE_OFFSET)
  );
  const cell = floor(screenCoordinate.xy.div(1.6));
  const speckle = hash21(cell)
    .mul(0.65)
    .add(hash21(cell.mul(0.31).add(17)).mul(0.35));
  const fibre = hash21(vec2(cell.y.mul(0.713), 3.7))
    .sub(0.5)
    .mul(0.045);
  const paper = float(1).add(speckle.sub(0.5).mul(0.13).add(fibre).mul(grain));
  return vec4(graded.mul(vignette).mul(paper), input.a);
}

type Drawable = Object3D & {
  geometry?: BufferGeometry;
  isLine?: boolean;
  isMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  material?: unknown;
};

/** Every drawable under `root`. */
function drawablesOf(root: Object3D): Drawable[] {
  const list: Drawable[] = [];
  root.traverse((object) => {
    const o = object as Drawable;
    if (o.geometry && (o.isMesh || o.isLine || o.isPoints || o.isSprite)) {
      list.push(o);
    }
  });
  return list;
}

/** Drawables compiled side by side (each compile yields between steps). */
const COMPILE_LANES = 4;

/**
 * The frame: the scene drawn into its own target — a top-level render, so
 * a build prepared ahead by `compileAsync` against the same target is the
 * very build the frame looks up (three keys builds by render context, and
 * a context by target *and* call depth; a scene pass nested inside the post
 * pipeline would sit one level deeper than any compile) — then three's node
 * `RenderPipeline` from its colour and depth: GTAO (half resolution, normals
 * reconstructed from depth) × the contact slider → DoF (`DepthOfFieldNode`,
 * crosshair autofocus, dropped while moving) → SMAA → depth grading,
 * vignette and paper grain → sRGB. The scene target has no MSAA; SMAA
 * carries the antialiasing. There is no tone mapping: the look was tuned
 * without it.
 */
export function createPostStack(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  /** GTAO samples (scene-profile.ts `aoSamplesFor`) */
  aoSamples: number
): PostStack {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const depthTexture = new DepthTexture(size.x, size.y);
  const target = new RenderTarget(size.x, size.y, {
    type: HalfFloatType,
    depthTexture,
  });
  target.texture.name = "ScenePass";
  const colour = texture(target.texture);
  const depth = texture(depthTexture);
  const viewZ = perspectiveDepthToViewZ(
    depth.r,
    reference("near", "float", camera),
    reference("far", "float", camera)
  );

  // Half resolution: contact occlusion is low-frequency by nature, and at a
  // quarter of the pixels the pass costs about what skipping it while moving
  // used to save — paid every frame instead of flickering. The sample count
  // rebuilds the pass's material: a construction-time setting.
  // reason: GTAONode takes null to reconstruct normals from depth; the
  // @types signature does not say so.
  const aoPass = ao(depth, null as never, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = AO_RADIUS_M;
  aoPass.samples.value = aoSamples;
  const contact = uniform(LOOK_DEFAULTS.contact * AO_INTENSITY_MAX);
  const occlusion = pow(aoPass.getTextureNode().r, contact);
  const lit = vec4(colour.rgb.mul(occlusion), colour.a);

  const focusDistance = uniform(HYPERFOCAL_M);
  const focusRange = uniform(focusRangeFor(HYPERFOCAL_M));
  // reason: the effect nodes' types don't carry their vec4 output.
  const focused = nodeObject(
    dof(lit, viewZ, focusDistance, focusRange, uniform(BOKEH_SCALE))
  ) as unknown as V4;

  const grading = uniform(LOOK_DEFAULTS.grading);
  const grain = uniform(LOOK_DEFAULTS.grain);
  const output = (input: V4) =>
    renderOutput(
      finish(
        // reason: as above, SMAANode's vec4 output
        nodeObject(smaa(input)) as unknown as V4,
        viewZ,
        grading,
        grain
      ),
      NoToneMapping,
      SRGBColorSpace
    );
  // Two pipelines, both built once: DoF drops while the camera moves, and
  // swapping one pipeline's output node would re-translate the whole post
  // graph on the main thread every time a flight starts or stops.
  const withDof = new RenderPipeline(renderer, output(focused));
  const plain = new RenderPipeline(renderer, output(lit));
  withDof.outputColorTransform = false;
  plain.outputColorTransform = false;

  // User intent vs. motion regression are two independent layers: the look
  // writes dofWanted, the render loop `regressed`, and only the choice below
  // combines them — recovery never clobbers the user's choice.
  let dofWanted = LOOK_DEFAULTS.dof;
  let regressed = false;
  let warm = false;
  const pipeline = () => (dofWanted && !regressed ? withDof : plain);

  let focusMode: FocusMode = LOOK_DEFAULTS.focusMode;
  let manualDistance = LOOK_DEFAULTS.focusDistanceM;
  const focusPoint = new Vector3(0, 0, -HYPERFOCAL_M);
  const inView = new Vector3();
  const updateFocus = () => {
    let d = manualDistance;
    if (focusMode === "auto") {
      inView.copy(focusPoint).applyMatrix4(camera.matrixWorldInverse);
      d = Math.max(1, -inView.z);
    }
    focusDistance.value = d;
    focusRange.value = focusRangeFor(d);
  };

  const rows: Record<PostLookKey, (value: number) => void> = {
    contact: (strength) => {
      contact.value = Math.max(strength, 0) * AO_INTENSITY_MAX;
    },
    grading: (v) => {
      grading.value = Math.min(Math.max(v, 0), 1);
    },
    grain: (v) => {
      grain.value = Math.min(Math.max(v, 0), 1);
    },
  };

  /**
   * One drawable, shown and unculled for the call: `compileAsync` walks a
   * tree the way a frame does, skipping what is hidden or outside the view,
   * and whatever the camera did not see yet would otherwise build inside
   * the frame that first shows it.
   */
  const compileOne = (object: Drawable): Promise<void> => {
    const previous = renderer.getRenderTarget();
    const { visible, frustumCulled } = object;
    object.visible = true;
    object.frustumCulled = false;
    renderer.setRenderTarget(target);
    try {
      return renderer.compileAsync(object, camera, scene);
    } finally {
      renderer.setRenderTarget(previous);
      object.visible = visible;
      object.frustumCulled = frustumCulled;
    }
  };
  // Once is enough for a drawable and its material (a tile, then the whole
  // scene at boot, walks the same objects).
  const compiled = new WeakMap<Object3D, unknown>();
  const gone = new WeakSet<BufferGeometry>();
  const onGone = (event: { target: BufferGeometry }) => gone.add(event.target);

  return {
    compile: async (root) => {
      const list = drawablesOf(root);
      const geometries = new Set(list.map((o) => o.geometry as BufferGeometry));
      for (const g of geometries) {
        g.addEventListener("dispose", onGone);
      }
      let next = 0;
      // One at a time per lane: a drawable whose tile left meanwhile is
      // skipped — compiling it would re-create the GPU buffers of a disposed
      // geometry, and nothing would free them again.
      const lane = async () => {
        while (next < list.length) {
          const drawable = list[next++];
          if (
            compiled.get(drawable) === drawable.material ||
            gone.has(drawable.geometry as BufferGeometry)
          ) {
            continue;
          }
          compiled.set(drawable, drawable.material);
          await compileOne(drawable);
        }
      };
      try {
        await Promise.all(Array.from({ length: COMPILE_LANES }, lane));
      } finally {
        for (const g of geometries) {
          g.removeEventListener("dispose", onGone);
        }
      }
    },
    render: () => {
      updateFocus();
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      if (!warm) {
        // Build both post graphs up front (the first frames are under the
        // load screen), so the first toggle costs nothing.
        warm = true;
        (pipeline() === plain ? withDof : plain).render();
      }
      pipeline().render();
    },
    getFocusInfo: () => ({
      focusDistance: focusDistance.value,
      focusRange: focusRange.value,
      bokehScale: BOKEH_SCALE,
    }),
    setSize: () => {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
    },
    applyLook: (look) => {
      for (const key of Object.keys(rows) as PostLookKey[]) {
        rows[key](look[key]);
      }
      dofWanted = look.dof;
      focusMode = look.focusMode;
      manualDistance = Math.max(1, look.focusDistanceM);
    },
    setRegressed: (on) => {
      regressed = on;
    },
    setFocusTarget: (point) => {
      // Manual mode pins its own distance; no hit (sky) keeps the last focus,
      // so tilting a degree above a far building doesn't snap it near.
      if (focusMode === "auto" && point) {
        focusPoint.copy(point);
      }
    },
    dispose: () => {
      withDof.dispose();
      plain.dispose();
      target.dispose();
    },
  };
}
