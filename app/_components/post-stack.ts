import {
  type BufferGeometry,
  type Camera,
  type ClippingGroup,
  DepthTexture,
  HalfFloatType,
  type Node,
  NoToneMapping,
  type Object3D,
  type PerspectiveCamera,
  RedFormat,
  RenderPipeline,
  RenderTarget,
  SRGBColorSpace,
  type Scene,
  UnsignedByteType,
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
  int,
  max,
  min,
  mix,
  nodeObject,
  pow,
  renderOutput,
  rtt,
  screenCoordinate,
  screenUV,
  smoothstep,
  texture,
  textureSize,
  time,
  uniform,
  uv,
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
import {
  type PaperKind,
  RENDER_STYLE_BY_ID,
  type RenderStyleDef,
} from "@/lib/city/render-style";
import { compileInLanes, type Compiling } from "./compile-lanes";
import { fxaa } from "./fxaa";
import type { SceneFog } from "./height-fog";
import { createPaperScene } from "./paper-scene";
import {
  createSelectionOutline,
  type OutlineSelection,
} from "./selection-outline";
import {
  createPipelineAnchors,
  type PipelineAnchors,
} from "./pipeline-anchors";
import type { PostProfile } from "./scene-profile";
import type { F, Live, V2, V3, V4 } from "./shader-chunks";
import { aloneUnder, compileRepresentatives } from "./three-utils";
import { createStyleDressing } from "./style-dressing";
import { createStylize } from "./stylize-effect";
import type { ViewLens } from "./view-lens";

/** Initial focus distance before the first crosshair raycast lands. */
const HYPERFOCAL_M = 600;

/**
 * The contact shadows, their noise taken out. GTAO rotates its horizon
 * search per pixel by a 5×5 tile of noise and leaves the averaging to a
 * denoiser; drawn raw, every contact shadow — and every sliver of distant
 * city at the horizon — was a speckle (main's N8AO denoised its own). A 5×5
 * box at the AO's resolution holds each rotation of the tile once, so it
 * averages the pattern away exactly; its taps are weighed by depth, so the
 * shadow at a wall's foot does not bleed onto the street in front. Its own
 * half-resolution pass: 50 reads a texel, a quarter of the pixels. (three's
 * DenoiseNode rebuilds a normal from depth for each of its 16 taps, at
 * full resolution — too much for a phone.) Its target holds the one value
 * in one byte, as GTAO's own does, and no depth buffer (a quad draws it):
 * a half-float RGBA with depth was twelve bytes a texel for it.
 */
function aoSmoothed(
  raw: ReturnType<ReturnType<typeof ao>["getTextureNode"]>,
  depthTexture: DepthTexture,
  lens: ViewLens
) {
  const at = uv();
  // reason: textureSize's node type is not in the @types' vec2 overloads.
  const size = textureSize(raw, int(0)) as unknown as Node<"uvec2">;
  const texel = vec2(1).div(vec2(size));
  const viewZ = (p: V2): F => lens.distance(texture(depthTexture, p).r);
  const z0 = viewZ(at).toVar();
  // what counts as the same surface: a few percent of the distance (in a
  // parallel view, of the distance the picture is equivalent to)
  const tolerance = lens.fade(z0).mul(0.04).add(0.15);
  let sum: F = float(0);
  let weights: F = float(0);
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const p = at.add(texel.mul(vec2(x, y)));
      const w = clamp(
        float(1).sub(viewZ(p).sub(z0).abs().div(tolerance)),
        0,
        1
      );
      sum = sum.add(texture(raw.value, p).r.mul(w));
      weights = weights.add(w);
    }
  }
  const smoothed = vec4(sum.div(max(weights, 1e-4)), 0, 0, 1);
  return rtt(smoothed, null, null, {
    resolutionScale: 0.5,
    format: RedFormat,
    type: UnsignedByteType,
    depthBuffer: false,
  });
}

/**
 * GTAO's reach and what it takes for an occluder, in metres (view space).
 * Contact, as main's N8AO drew it: a 6 m radius and three's 1 m thickness
 * counted a bench leg standing half a metre in front of the ground behind
 * it as that ground's occluder — a smoky halo on the far side of every
 * post, leg and pillar, and blotches along wall feet. 2 m and 0.15 m keep
 * the dark where things meet (wall feet, kerbs, legs) and nothing behind
 * them (compared against main from the same snapshots).
 */
const AO_RADIUS_M = 2;
const AO_THICKNESS_M = 0.15;
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
   * never stalls a frame on a synchronous build. Resolves once every
   * drawable under `object` is uploaded — those another compile had
   * started too (compile-lanes.ts): a tile drops its CPU copies on it.
   */
  compile: (object: Object3D) => Promise<void>;
  /**
   * Pushes the rendering rows of the look — the picture style, depth
   * grading, contact shadows, paper grain, ink, depth of field and its
   * focus mode/distance — into the passes.
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
  /**
   * Modell (plan 055): a parallel view draws without depth of field, depth
   * grading and vignette — far means higher up the sheet there, and a haze
   * or a dark corner reads as an error. The sliders keep their values.
   */
  setModel: (on: boolean) => void;
  /**
   * What to outline around the asked element, or null
   * (selection-outline.ts): drawn over every picture style, after the
   * antialiasing, under the paper grain.
   */
  setSelection: (selection: OutlineSelection | null, flash?: boolean) => void;
  /** How many pipeline anchors hold scene-wide pipelines (diagnostics). */
  anchorCount: () => number;
  /**
   * Builds and holds, off the frames, every program the Ausschnitt
   * (model-cuts.ts, `group`) switches `roots`' drawables between: the
   * clipped ones and the plain ones they come back to. Resolves when all
   * are held; the scene can show the cut then without building a thing.
   * Tiles that land while it holds are held as they compile.
   */
  holdCut: (group: ClippingGroup, roots: Object3D[]) => Promise<void>;
  /** Lets them go, after the next frame (which switches back to plain). */
  releaseCut: () => void;
  /** The sun's altitude in degrees (Film noir opens up at dusk). */
  setSunAltitude: (altitudeDeg: number) => void;
  /**
   * Objects came, went or changed visibility: the styles' scene halves
   * (the Papier swap, the style dressing) re-read the scene on their next
   * frame instead of walking it every frame.
   */
  sceneChanged: () => void;
  /**
   * Prepares every picture style off the frames that show it — the style
   * dressing and the Papier programs of the scene's objects compiled
   * ahead, the style pipelines built one per frame — so the first switch
   * to a style does not stall. Idempotent; create-app calls it once the
   * scene has loaded and the browser is idle. On a phone (scene-profile.ts
   * `PostProfile.warmStyles`) only the outline's programs: a style builds
   * on the first frame that shows it there.
   */
  warmStyles: () => Promise<void>;
}

/** A cheap 2D hash for the paper grain. */
function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

/** The finish's live settings (the sliders times the style's weights). */
interface Finish {
  grading: Live;
  grain: Live;
  /** 1 = animated film grain (the monochrome styles), 0 = the paper */
  film: Live;
  vignetteOffset: Live;
  vignetteDarkness: Live;
}

/**
 * Depth grading, vignette and paper grain on the antialiased image:
 * - painterly aerial perspective — a warm tint up close, cooler and gently
 *   desaturated with distance (the classic watercolour depth cue);
 * - the vignette's smoothstep falloff toward the corners (per style);
 * - a static, screen-anchored paper speckle plus faint row-correlated fibre
 *   banding — the sheet the scene is drawn on, not film grain. `film` 1
 *   turns it into film grain for the monochrome styles: the speckle is
 *   re-drawn 24 times a second and the fibres go (a film has none); like
 *   silver grain it is strongest in the mid-tones.
 */
function finish(input: V4, viewZ: F, f: Finish): V4 {
  const { grading, grain, film } = f;
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
    f.vignetteOffset.mul(0.799),
    distance(screenUV, vec2(0.5)).mul(f.vignetteDarkness.add(f.vignetteOffset))
  );
  const cell = floor(screenCoordinate.xy.div(1.6));
  // A new sheet of grain per film frame; the static paper keeps seed 0.
  const seed = vec2(floor(time.mul(24)).mul(7.31), 0).mul(film);
  const speckle = hash21(cell.add(seed))
    .mul(0.65)
    .add(hash21(cell.mul(0.31).add(17).add(seed)).mul(0.35));
  const fibre = hash21(vec2(cell.y.mul(0.713), 3.7))
    .sub(0.5)
    .mul(0.045)
    .mul(float(1).sub(film));
  const lumaIn = dot(input.rgb, vec3(0.2126, 0.7152, 0.0722));
  const midtones = mix(
    1,
    lumaIn
      .mul(float(1).sub(min(lumaIn, 1)))
      .mul(2.6)
      .add(0.35),
    film
  );
  const paper = float(1).add(
    speckle.sub(0.5).mul(0.13).mul(midtones).add(fibre).mul(grain)
  );
  return vec4(graded.mul(vignette).mul(paper), input.a);
}

/**
 * Depth of field over `lit` (`DepthOfFieldNode`). Its input is drawn into
 * a target of its own first; `dof()` would make that target itself, with
 * the depth buffer every render target gets by default and nothing here
 * reads (a third more memory for the copy) — the picture is the same.
 */
function lensBlurOf(lit: V4, viewZ: F, focusDistance: Live, focusRange: Live) {
  const input = rtt(lit, null, null, { depthBuffer: false });
  const node = dof(
    input,
    viewZ,
    focusDistance,
    focusRange,
    uniform(BOKEH_SCALE)
  );
  return {
    // reason: the effect nodes' types don't carry their vec4 output.
    focused: nodeObject(node) as unknown as V4,
    dispose: () => {
      node.dispose();
      input.dispose();
    },
  };
}

/** The frame's antialiasing (scene-profile.ts `PostProfile.antialias`). */
interface Antialiasing {
  /** the frame a pipeline drew into `beforeAa` (a style, depth of field) */
  afterPre: V4;
  /** the scene's own colour with its contact shadows, where nothing drew
   *  into `beforeAa` — null: every frame goes through it (SMAA) */
  direct: V4 | null;
  setSize: (size: Vector2) => void;
  dispose: () => void;
}

/**
 * SMAA reads a texture and renders three passes of its own into three
 * full-resolution half-float targets, so every frame is drawn into
 * `beforeAa` first. FXAA needs no target: it runs inside the last pass,
 * on `beforeAa` when a pipeline drew there, else on the scene target
 * itself — the contact shadows multiplied in after it, which at half
 * resolution and smoothed carry no edge of their own to antialias.
 */
function antialiasingOf(
  kind: PostProfile["antialias"],
  beforeAa: RenderTarget,
  scene: RenderTarget,
  occlusion: F
): Antialiasing {
  if (kind === "smaa") {
    const node = smaa(texture(beforeAa.texture));
    return {
      // reason: as above, SMAANode's vec4 output
      afterPre: nodeObject(node) as unknown as V4,
      direct: null,
      setSize: () => undefined,
      dispose: () => node.dispose(),
    };
  }
  const texel = uniform(new Vector2());
  const setSize = (size: Vector2) => texel.value.set(1 / size.x, 1 / size.y);
  setSize(new Vector2(scene.width, scene.height));
  const sceneAa = fxaa(scene.texture, texel);
  return {
    afterPre: fxaa(beforeAa.texture, texel),
    direct: vec4(sceneAa.rgb.mul(occlusion), sceneAa.a),
    setSize,
    dispose: () => undefined,
  };
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
 * crosshair autofocus, dropped while moving; not built on a phone) → the
 * picture style (ink + tone; not in the default pastel style's pipelines
 * at all) → SMAA (FXAA on a phone) → depth grading, vignette and paper
 * grain → sRGB. The scene target has no MSAA; SMAA carries the
 * antialiasing — of the style's ink lines too, which is why the style sits
 * before it. There is no tone mapping: the look was tuned without it.
 *
 * What it builds follows the device tier (scene-profile.ts `PostProfile`):
 * its screen-sized targets stay in the GPU process for the whole session,
 * and on a phone that was ~68 MB of them before a single tile — the lens
 * blur's, SMAA's and the frame copy they read. There the pastel frame is
 * the scene pass, the contact shadows and one last pass that antialiases
 * (FXAA), grades and outlines; a picture style draws into `beforeAa` only
 * while it is on, and the target goes when it is left.
 */
export function createPostStack(
  renderer: WebGPURenderer,
  scene: Scene,
  /** the perspective camera: tiles and styles compile against it */
  camera: PerspectiveCamera,
  /** the camera the frame is drawn with (Modell's parallel one, or `camera`) */
  active: () => Camera,
  /** what the passes know of the active camera (view-lens.ts) */
  lens: ViewLens,
  /** GTAO samples (scene-profile.ts `aoSamplesFor`) */
  aoSamples: number,
  /** the scene's fog (height-fog.ts): the styles read and paper it */
  fog: SceneFog,
  /** what the tier builds and warms (scene-profile.ts `postProfileFor`) */
  profile: PostProfile
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
  const viewZ = lens.viewZ(depth.r);

  // Half resolution: contact occlusion is low-frequency by nature, and at a
  // quarter of the pixels the pass costs about what skipping it while moving
  // used to save — paid every frame instead of flickering. The sample count
  // rebuilds the pass's material: a construction-time setting.
  // reason: GTAONode takes null to reconstruct normals from depth; the
  // @types signature does not say so.
  const aoPass = ao(depth, null as never, lens.camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = AO_RADIUS_M;
  aoPass.thickness.value = AO_THICKNESS_M;
  aoPass.samples.value = aoSamples;
  const aoTexture = aoSmoothed(aoPass.getTextureNode(), depthTexture, lens);
  const contact = uniform(LOOK_DEFAULTS.contact * AO_INTENSITY_MAX);
  const occlusion = pow(aoTexture.r, contact);
  const lit = vec4(colour.rgb.mul(occlusion), colour.a);
  // The same, at any uv: the styles read the frame's neighbourhood.
  const litAt = (at: V2): V3 =>
    texture(target.texture, at).rgb.mul(
      pow(texture(aoTexture.value, at).r, contact)
    );

  const focusDistance = uniform(HYPERFOCAL_M);
  const focusRange = uniform(focusRangeFor(HYPERFOCAL_M));
  const lensBlur = profile.dof
    ? lensBlurOf(lit, viewZ, focusDistance, focusRange)
    : null;

  let style: RenderStyleDef = RENDER_STYLE_BY_ID[LOOK_DEFAULTS.style];
  const stylize = createStylize({ lens, depth: depthTexture, fog, litAt });
  const paperScene = createPaperScene(scene, fog.color);
  const styleDressing = createStyleDressing(scene);

  const finishing: Finish = {
    grading: uniform(LOOK_DEFAULTS.grading),
    grain: uniform(LOOK_DEFAULTS.grain),
    film: uniform(0),
    vignetteOffset: uniform(style.vignette.offset),
    vignetteDarkness: uniform(style.vignette.darkness),
  };
  // The frame before its antialiasing, whichever pipeline drew it: one
  // target and one SMAA for all four. SMAA reads a texture, and each
  // pipeline carrying its own made a copy of its input and three targets
  // of its own — sixteen at full resolution, all resident once the styles
  // were warmed, ~95 MB on an iPhone. With FXAA only a style (or the lens
  // blur) draws here: the target is allocated by the first frame that
  // does, and freed by the first that does not.
  const beforeAa = new RenderTarget(size.x, size.y, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  beforeAa.texture.name = "BeforeAA";
  const antialiasing = antialiasingOf(
    profile.antialias,
    beforeAa,
    target,
    occlusion
  );
  // The asked element's outline: its own antialiasing (a smooth band of a
  // blurred mask), so after SMAA, and under the paper grain like the ink.
  const outline = createSelectionOutline({
    lens,
    depthTexture,
    width: size.x,
    height: size.y,
  });
  // The last pass, to the canvas: one per antialiased input.
  const finishedOf = (antialiased: V4) => {
    const p = new RenderPipeline(
      renderer,
      renderOutput(
        finish(outline.over(antialiased), viewZ, finishing),
        NoToneMapping,
        SRGBColorSpace
      )
    );
    p.outputColorTransform = false;
    return p;
  };
  const finished = {
    afterPre: finishedOf(antialiasing.afterPre),
    direct: antialiasing.direct && finishedOf(antialiasing.direct),
  };
  // A pipeline renders into the current target: these into `beforeAa`.
  const pipelineOf = (node: V4) => {
    const p = new RenderPipeline(renderer, node);
    p.outputColorTransform = false;
    return p;
  };
  // Four pipelines, each built once: DoF drops while the camera moves (and
  // under a graphic style), and swapping one pipeline's output node would
  // re-translate the whole post graph on the main thread every time a
  // flight starts or stops. The pastel pair has no style node in it at all;
  // every other style is the one styled pair (its mode is a uniform).
  // Without a lens blur there is no DoF half; with FXAA the plain pastel
  // frame needs no pipeline before the last pass.
  const pastel = {
    dof: lensBlur && pipelineOf(lensBlur.focused),
    plain: antialiasing.direct ? null : pipelineOf(lit),
  };
  const styled = {
    dof: lensBlur && pipelineOf(stylize.node(lensBlur.focused)),
    plain: pipelineOf(stylize.node(lit)),
  };

  // User intent vs. motion regression are two independent layers: the look
  // writes dofWanted, the render loop `regressed`, and only the choice below
  // combines them — recovery never clobbers the user's choice. The picture
  // style is a third layer of the same kind: a graphic style gates DoF off
  // (RenderStyleDef.allowDof) without touching the switch.
  let dofWanted = LOOK_DEFAULTS.dof;
  let regressed = false;
  let model = false;
  /** What draws into `beforeAa` this frame (null: nothing), and the last pass. */
  const frame = () => {
    const pair = style.shaderMode > 0 ? styled : pastel;
    const lensOn = dofWanted && style.allowDof && !regressed && !model;
    const pre = (lensOn ? pair.dof : null) ?? pair.plain;
    return {
      pre,
      finished: pre
        ? finished.afterPre
        : (finished.direct ?? finished.afterPre),
    };
  };
  // Pipelines that still have to build: a pipeline builds its graph on its
  // first render, so each is rendered once, one per frame, before the one
  // the frame shows (which draws over it). The pastel pair goes first —
  // those frames are under the load screen.
  const toWarm: RenderPipeline[] = [pastel.dof, pastel.plain].filter(
    (p) => p !== null
  );
  // whether `beforeAa` holds its memory (FXAA lets it go between styles)
  let preHeld = false;
  /** Draws what goes before the antialiasing into `beforeAa`, if anything. */
  const drawPre = (pre: RenderPipeline | null) => {
    const warming = toWarm.shift();
    if (!(pre || warming)) {
      if (preHeld) {
        beforeAa.dispose();
        preHeld = false;
      }
      return;
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(beforeAa);
    preHeld = true;
    try {
      if (warming && warming !== pre) {
        warming.render();
      }
      pre?.render();
    } finally {
      renderer.setRenderTarget(previous);
    }
  };

  // The sliders' raw values; the style weights them on the way in, so a
  // style switch re-applies them without the store changing.
  const raw = {
    grading: LOOK_DEFAULTS.grading,
    grain: LOOK_DEFAULTS.grain,
    ink: LOOK_DEFAULTS.ink,
  };
  const applyStyleWeights = () => {
    finishing.grading.value = model ? 0 : raw.grading * style.gradingWeight;
    finishing.grain.value = Math.min(raw.grain * style.grainWeight, 2);
    finishing.film.value = style.grainAnimated ? 1 : 0;
    // offset and darkness 0: the vignette's smoothstep is 1 everywhere
    finishing.vignetteOffset.value = model ? 0 : style.vignette.offset;
    finishing.vignetteDarkness.value = model ? 0 : style.vignette.darkness;
    stylize.setInk(raw.ink * style.inkWeight);
    stylize.setStyle(style);
  };
  applyStyleWeights();

  let focusMode: FocusMode = LOOK_DEFAULTS.focusMode;
  let manualDistance = LOOK_DEFAULTS.focusDistanceM;
  const focusPoint = new Vector3(0, 0, -HYPERFOCAL_M);
  const inView = new Vector3();
  const updateFocus = () => {
    let d = manualDistance;
    if (focusMode === "auto") {
      inView.copy(focusPoint).applyMatrix4(active().matrixWorldInverse);
      d = Math.max(1, -inView.z);
    }
    focusDistance.value = d;
    focusRange.value = focusRangeFor(d);
  };

  // One writer per rendering row — a Record over the keys, so a row added
  // to the table cannot go unapplied.
  const rows: Record<PostLookKey, (value: number) => void> = {
    contact: (strength) => {
      contact.value = Math.max(strength, 0) * AO_INTENSITY_MAX;
    },
    grading: (v) => {
      raw.grading = Math.min(Math.max(v, 0), 1);
    },
    grain: (v) => {
      raw.grain = Math.min(Math.max(v, 0), 1);
    },
    ink: (strength) => {
      raw.ink = strength;
    },
  };

  /**
   * One drawable, shown and unculled for the call: `compileAsync` walks a
   * tree the way a frame does, skipping what is hidden or outside the view,
   * and whatever the camera did not see yet would otherwise build inside
   * the frame that first shows it. One call per drawable on purpose: a
   * call builds its node graphs (TSL → WGSL) synchronously, and the await
   * between calls is where a frame gets in. Each call also walks the
   * scene for its lights — cheap next to one node build, and the price of
   * never blocking a frame for a whole tile.
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
  // A scene-wide material's pipelines outlive the tiles that brought them
  // (pipeline-anchors.ts): flying back compiles nothing.
  const anchors = createPipelineAnchors(compileOne);
  const compileAnchored = async (object: Drawable): Promise<void> => {
    await compileOne(object);
    await anchors.anchor(object);
  };
  // The swap's programs of one drawable (Papier's and Strich's card, the
  // Schwarzplan's figure): compiled under the swap, which lasts for the
  // synchronous half of the call only — where three makes the render
  // object and reads the override's position node for its build.
  const compileSwap =
    (kind: PaperKind) =>
    (object: Drawable): Promise<void> =>
      paperScene.drawsAsPaper(object, kind)
        ? paperScene.swapped(object, () => compileOne(object), kind)
        : Promise.resolve();
  const compilePaper = compileSwap("paper");
  const compileFigure = compileSwap("figure");
  // The Ausschnitt (model-cuts.ts) is a ClippingGroup around the city.
  // three keeps ONE render object per drawable on both sides of it and
  // keys the drawable's build by the clipping: switching the group swaps
  // every drawable's build, and releases the one it leaves as soon as no
  // render object uses it. Built inside the frame, that was every material
  // of the city at once, both ways — seconds on a laptop, long enough on a
  // phone for the browser to give up on the page. So the cut's programs
  // are compiled ahead on stand-ins (pipeline-anchors.ts, every material):
  // the clipped ones under the group, the plain ones as the frames draw
  // them now (and the swap's, in a paper style), held while the cut shows.
  interface CutHold {
    group: ClippingGroup;
    kind: PaperKind | undefined;
    /** both sides of each build: clipped and plain, and the swap's */
    anchors: { a: PipelineAnchors; paper: boolean }[];
    done: WeakMap<Drawable, Compiling>;
  }
  let cut: CutHold | null = null;
  let releaseAfterFrame: PipelineAnchors[] = [];
  /**
   * `object` compiled under `group`'s clipping (three-utils.ts
   * `aloneUnder`): the render object the call makes has the very context
   * the frames use while the cut shows.
   */
  const compileUnder = (group: ClippingGroup, object: Object3D) => {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
      return aloneUnder(group, object, () =>
        renderer.compileAsync(group, camera, scene)
      );
    } finally {
      renderer.setRenderTarget(previous);
    }
  };
  const newHold = (group: ClippingGroup, kind?: PaperKind): CutHold => {
    const under = (o: Object3D) => compileUnder(group, o);
    const plain = (o: Object3D) => compileOne(o);
    const anchors = [
      { a: createPipelineAnchors(under, true), paper: false },
      { a: createPipelineAnchors(plain, true), paper: false },
    ];
    if (kind) {
      const swapped =
        (compile: (o: Object3D) => Promise<void>) => (o: Object3D) =>
          paperScene.swapped(o, () => compile(o), kind);
      anchors.push(
        { a: createPipelineAnchors(swapped(under), true), paper: true },
        { a: createPipelineAnchors(swapped(plain), true), paper: true }
      );
    }
    return { group, kind, anchors, done: new WeakMap() };
  };
  /** Holds both sides of the cut for `roots`' drawables, one per build. */
  const holdAll = async (held: CutHold, roots: Object3D[]) => {
    const step = async (drawable: Drawable) => {
      const paper =
        held.kind !== undefined && paperScene.drawsAsPaper(drawable, held.kind);
      for (const { a, paper: swap } of held.anchors) {
        if (cut !== held) {
          return;
        }
        if (!swap || paper) {
          await a.anchor(drawable);
        }
      }
    };
    // every drawable, not one per material and attribute names: the
    // anchors key a build as three does (strides, item sizes, the index),
    // and a build the frames come back to that no anchor holds is one
    // built inside the frame
    await compileAll(roots.flatMap(drawablesOf), step, held.done);
  };
  const letGo = () => {
    if (cut) {
      releaseAfterFrame.push(...cut.anchors.map(({ a }) => a));
      cut = null;
    }
  };

  // Once is enough for a drawable and its material (a tile, then the whole
  // scene at boot, walks the same objects) — and a walk resolves only once
  // the steps another walk started on its drawables have (compile-lanes.ts).
  const compiled = new WeakMap<Drawable, Compiling>();
  const compiledPaper = new WeakMap<Drawable, Compiling>();
  const compiledFigure = new WeakMap<Drawable, Compiling>();
  const gone = new WeakSet<BufferGeometry>();
  const onGone = (event: { target: BufferGeometry }) => gone.add(event.target);
  // Papier's programs are made once the styles are warmed (where the
  // profile's `warmPaper` allows) or while Papier is on; otherwise a tile
  // compiles for the scene's own look only.
  let paperWanted = false;

  const compileAll = async (
    list: Drawable[],
    step: (drawable: Drawable) => Promise<void>,
    done: WeakMap<Drawable, Compiling>
  ) => {
    const geometries = new Set(list.map((o) => o.geometry as BufferGeometry));
    for (const g of geometries) {
      g.addEventListener("dispose", onGone);
    }
    // One at a time per lane: a drawable whose tile left meanwhile is
    // skipped — compiling it would re-create the GPU buffers of a disposed
    // geometry, and nothing would free them again.
    try {
      await compileInLanes(list, step, done, {
        lanes: COMPILE_LANES,
        skip: (drawable) => gone.has(drawable.geometry as BufferGeometry),
      });
    } finally {
      for (const g of geometries) {
        g.removeEventListener("dispose", onGone);
      }
    }
  };

  let stylesWarm: Promise<void> | null = null;
  const warmStyles = async () => {
    // A phone keeps the styles to their first frame: their pipelines, and
    // the sibling crown sets and lamp cones each would make and compile
    // for every loaded tile, for a style most never pick.
    if (profile.warmStyles !== "all") {
      return;
    }
    toWarm.push(...[styled.plain, styled.dof].filter((p) => p !== null));
    // Whatever the styles dress the scene with (their crowns share the
    // scene crowns' builds; the lamp cones are new), then — where it is
    // worth it — the Papier programs of every material and layout.
    const dressed = [
      ...styleDressing.prepare({ crowns: "comic", lampCones: true }),
      ...styleDressing.prepare({ crowns: "paper", lampCones: false }),
    ] as Drawable[];
    await compileAll(dressed, compileOne, compiled);
    if (!profile.warmPaper) {
      return;
    }
    paperWanted = true;
    const representatives = compileRepresentatives([scene]);
    await compileAll(representatives, compilePaper, compiledPaper);
    await compileAll(representatives, compileFigure, compiledFigure);
  };

  return {
    compile: async (root) => {
      await compileAll(drawablesOf(root), compileAnchored, compiled);
      // a tile landing under a cut that shows: its builds held before it does
      if (cut) {
        await holdAll(cut, [root]);
      }
      // The override's build is keyed by the source's material and layout,
      // so one drawable of each is all Papier needs.
      const kind = style.paperScene;
      if (paperWanted || kind) {
        const representatives = compileRepresentatives([root]);
        if (paperWanted || kind !== "figure") {
          await compileAll(representatives, compilePaper, compiledPaper);
        }
        if (paperWanted || kind === "figure") {
          await compileAll(representatives, compileFigure, compiledFigure);
        }
      }
    },
    anchorCount: () => anchors.count(),
    holdCut: async (group, roots) => {
      if (cut?.group !== group) {
        letGo();
        cut = newHold(group, style.paperScene ?? undefined);
      }
      await holdAll(cut, roots);
    },
    releaseCut: letGo,
    warmStyles: () => {
      // the outline's mask and blur programs too, on every tier: the first
      // question builds nothing
      stylesWarm ??= outline
        .compile(renderer, camera)
        .then(warmStyles)
        .catch(() => undefined);
      return stylesWarm;
    },
    sceneChanged: () => {
      paperScene.sceneChanged();
      styleDressing.sceneChanged();
    },
    setSunAltitude: (altitudeDeg) => stylize.setSunAltitude(altitudeDeg),
    render: () => {
      updateFocus();
      stylize.update(renderer.getPixelRatio(), size);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      // A style's scene dressing (its crowns, lamp cones) and the Papier
      // swap are on for the scene's render only, and off right after.
      const dressed =
        style.crowns || style.lampCones
          ? styleDressing.begin({
              crowns: style.crowns,
              lampCones: style.lampCones,
            })
          : null;
      const restore = style.paperScene
        ? paperScene.begin(style.paperScene)
        : null;
      const view = active();
      try {
        renderer.render(scene, view);
      } finally {
        restore?.();
        dressed?.();
        renderer.setRenderTarget(previous);
      }
      // a released cut's builds go once a frame has drawn without them
      if (releaseAfterFrame.length > 0) {
        for (const a of releaseAfterFrame) {
          a.dispose();
        }
        releaseAfterFrame = [];
      }
      outline.update(renderer.getPixelRatio());
      outline.renderMask(renderer, view);
      const shown = frame();
      drawPre(shown.pre);
      shown.finished.render();
    },
    getFocusInfo: () => ({
      focusDistance: focusDistance.value,
      focusRange: focusRange.value,
      bokehScale: BOKEH_SCALE,
    }),
    setSize: () => {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
      beforeAa.setSize(size.x, size.y);
      antialiasing.setSize(size);
      outline.setSize(size.x, size.y);
    },
    setSelection: (selection, flash) => outline.set(selection, flash),
    setModel: (on) => {
      model = on;
      applyStyleWeights();
    },
    applyLook: (look) => {
      for (const key of Object.keys(rows) as PostLookKey[]) {
        rows[key](look[key]);
      }
      style = RENDER_STYLE_BY_ID[look.style];
      applyStyleWeights();
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
      for (const p of [
        pastel.dof,
        pastel.plain,
        styled.dof,
        styled.plain,
        finished.afterPre,
        finished.direct,
      ]) {
        p?.dispose();
      }
      // the passes' own targets and materials: a pipeline frees its quad's
      // material only, and these hold the screen-sized memory
      antialiasing.dispose();
      lensBlur?.dispose();
      aoTexture.dispose();
      aoPass.dispose();
      beforeAa.dispose();
      outline.dispose();
      paperScene.dispose();
      styleDressing.dispose();
      anchors.dispose();
      letGo();
      for (const a of releaseAfterFrame) {
        a.dispose();
      }
      releaseAfterFrame = [];
      target.dispose();
    },
  };
}
