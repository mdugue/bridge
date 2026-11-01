import {
  type BufferGeometry,
  type Camera,
  type ClippingGroup,
  DepthTexture,
  FloatType,
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
  type Texture,
  type TextureNode,
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
import { LOOK_DEFAULTS, type LookValues } from "@/lib/city/look-controls";
import {
  type PaperKind,
  RENDER_STYLE_BY_ID,
  type RenderStyleDef,
} from "@/lib/city/render-style";
import { compileInLanes, compileInTurn, type Compiling } from "./compile-lanes";
import { crownsPrinted } from "./crown-season";
import { DATA_MARKS, dataMarks } from "./glass";
import { crownSwayShare } from "./vegetation-layer";
import { fxaa } from "./fxaa";
import { createMotionBlur } from "./motion-blur";
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
import { createStylize, type SunShadowMap } from "./stylize-effect";
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
/**
 * Kontaktschatten: the AO raised to this exponent (occlusion^k) — what its
 * slider stood at by default (50 % of 3), fixed since it went (plan 073).
 */
const AO_EXPONENT = 1.5;

// The finish's strengths before the picture style weights them
// (RenderStyleDef's gradingWeight, grainWeight, inkWeight): what their
// sliders stood at by default, fixed since they went (plan 073). The
// uniforms they feed stay: a style switch and Modell write those.
/** Tiefenfärbung: warm near, cool far. */
const GRADING = 0.5;
/** Papierkorn: the paper grain over the frame (film grain in the
 *  monochrome styles). */
const GRAIN = 0.25;
/** Tuschelinien: the outlines' strength in the graphic styles. */
const INK = 0.7;

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
  /** the focus distance in metres: the distance to the crosshair's hit */
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
   * Pushes the picture style into the passes: its weights on the depth
   * grading, the paper grain and the ink. (Their strengths and the contact
   * shadows' are fixed; depth of field is always on where it is built,
   * focused on the crosshair.)
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
   * a bug, not as a saving. Layered beside the picture style's gate and
   * Modell's: recovery brings DoF back only where those allow it.
   */
  setRegressed: (on: boolean) => void;
  /** Follows the canvas (the scene target is drawing-buffer sized). */
  setSize: () => void;
  /**
   * Modell (plan 055): a parallel view draws without depth of field, depth
   * grading and vignette — far means higher up the sheet there, and a haze
   * or a dark corner reads as an error.
   */
  setModel: (on: boolean) => void;
  /**
   * What to outline around the asked element, or null
   * (selection-outline.ts): drawn over every picture style, after the
   * antialiasing, under the paper grain.
   */
  setSelection: (selection: OutlineSelection | null, flash?: boolean) => void;
  /** The scene pass's depth (the nameplate reads what stands in front). */
  readonly sceneDepth: DepthTexture;
  /**
   * What is drawn onto the canvas after the finished frame (the nameplate,
   * nameplate-layer.ts): over every picture style, its own antialiasing,
   * no target of its own. Compiled with the outline, for every camera.
   */
  setOverlay: (overlay: Overlay | null) => void;
  /** How many pipeline anchors hold scene-wide pipelines (diagnostics). */
  anchorCount: () => number;
  /**
   * Builds and holds, off the frames, every program the Ausschnitt
   * (model-cuts.ts, `group`) switches `roots`' drawables between: the
   * clipped ones and the plain ones they come back to, as `view` (Modell's
   * parallel camera) draws them. Resolves when all are held; the scene can
   * show the cut then without building a thing. Tiles that land while it
   * holds are held as they compile.
   */
  holdCut: (
    group: ClippingGroup,
    roots: Object3D[],
    view: Camera
  ) => Promise<void>;
  /**
   * Builds the scene's programs for `view` as well, off the frames, and
   * from then on every landing tile's: three builds a material's programs
   * per kind of camera, so Modell's parallel camera would otherwise build
   * every material in sight inside its first frames. One stand-in per
   * pipeline (as the Ausschnitt's hold), the swaps' one drawable per build
   * where Papier is wanted or on, and the outline's mask.
   */
  warmView: (view: Camera) => Promise<void>;
  /** Landing tiles compile for `view` no longer (Modell was left). */
  dropView: (view: Camera) => void;
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

/** Something drawn onto the canvas after the frame (`setOverlay`). */
export interface Overlay {
  render: (renderer: WebGPURenderer, camera: Camera) => void;
  compile: (renderer: WebGPURenderer, camera: Camera) => Promise<void>;
}

/** A cheap 2D hash for the paper grain. */
function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

/** The finish's live settings (the fixed strengths times the style's
 *  weights). */
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
  // Only what lies beyond the focus goes soft. Nearer than it is read as
  // at the focus (view Z is negative ahead): a lens blurs the foreground
  // too, but in a first-person view the foreground is the street at your
  // feet, the lower half of the screen — blurred, it read as a streaky
  // veil lying flat on the screen rather than as depth. The node still
  // runs its near-field passes, now over an empty field: the clamp saves
  // no work, a far-only pass of our own would.
  const behindFocus = viewZ.min(focusDistance.negate());
  const node = dof(
    input,
    behindFocus,
    focusDistance,
    focusRange,
    uniform(BOKEH_SCALE)
  );
  // reason: getTextureNode is DepthOfFieldNode's documented output (its
  // composite target's texture) but missing from the @types.
  const output = node as unknown as { getTextureNode: () => TextureNode };
  return {
    // reason: the effect nodes' types don't carry their vec4 output.
    focused: nodeObject(node) as unknown as V4,
    /** the target the blur composites the frame into, each frame it runs */
    composite: output.getTextureNode().value,
    /** the frame copy it blurs, idle while it does not run */
    input: input.renderTarget as RenderTarget,
    dispose: () => {
      node.dispose();
      input.dispose();
    },
  };
}

/** The frame's antialiasing (scene-profile.ts `PostProfile.antialias`). */
interface Antialiasing {
  /** the frame a pipeline drew before it (FXAA: into `beforeAa`); SMAA:
   *  whatever `read` named, every frame */
  afterPre: V4;
  /** the scene's own colour with its contact shadows, where nothing drew
   *  into `beforeAa` — null: `afterPre` reads that too (SMAA) */
  direct: V4 | null;
  /**
   * SMAA's input this frame, set before the frame draws: the texture it
   * antialiases, and whether that is the scene target itself, the contact
   * shadows still to be multiplied in after. FXAA: nothing (one FXAA node
   * per input, and no targets of its own).
   */
  read: (from: Texture, raw: boolean) => void;
  setSize: (size: Vector2) => void;
  dispose: () => void;
}

/**
 * SMAA reads a texture and renders three passes of its own into three
 * full-resolution half-float targets, so there is one SMAA for every frame
 * and its input is a texture binding the frame switches (`read`): the lens
 * blur's composite, a style's frame in `beforeAa`, or — nothing drawn
 * before it — the scene target, the contact shadows multiplied in after
 * it. A binding is not a build: the passes' programs and their render
 * contexts (keyed by the targets they draw into) stay as built, the
 * texture changes in a bind group three caches by texture. FXAA needs no
 * target: it runs inside the last pass, on `beforeAa` when a pipeline drew
 * there, else on the scene target itself — the contact shadows multiplied
 * in after it as well. At half resolution and smoothed they carry no edge
 * of their own to antialias.
 */
function antialiasingOf(
  kind: PostProfile["antialias"],
  beforeAa: RenderTarget,
  scene: RenderTarget,
  occlusion: F
): Antialiasing {
  if (kind === "smaa") {
    const input = texture(beforeAa.texture);
    const node = smaa(input);
    // 1 while SMAA reads the scene target: its contact shadows come after
    const raw = uniform(0);
    // reason: as above, SMAANode's vec4 output
    const antialiased = nodeObject(node) as unknown as V4;
    return {
      afterPre: vec4(
        antialiased.rgb.mul(mix(float(1), occlusion, raw)),
        antialiased.a
      ),
      direct: null,
      read: (from, isRaw) => {
        input.value = from;
        raw.value = isRaw ? 1 : 0;
      },
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
    read: () => undefined,
    setSize,
    dispose: () => undefined,
  };
}

/** What draws before the antialiasing, where, and what that then reads. */
interface Pre {
  pipeline: RenderPipeline;
  /**
   * `beforeAa`, or under SMAA for the lens blur one pixel: the blur
   * composites the frame into a target of its own, which SMAA reads where
   * it lies, and a frame only has to run its passes — which drawing one
   * pixel of its output does. Drawn into `beforeAa`, that was a copy of
   * the whole frame.
   */
  into: RenderTarget;
  /** what the antialiasing reads after it */
  reads: Texture;
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

/**
 * Drawables a walk keeps queued (compile-lanes.ts): the compiles themselves
 * run one at a time (`compileInTurn`), the lanes only keep the next ones
 * ready behind them.
 */
const COMPILE_LANES = 4;

/**
 * The frame: the scene drawn into its own target — a top-level render, so
 * the style's swap and dressing wrap exactly it, and a build prepared ahead
 * by `compileAsync` against the same target is the very build the frame
 * looks up (three keys a build by the target's attachments and the kind of
 * camera; up to r186 also by the call depth, which a scene pass nested
 * inside the post pipeline never matched) — then three's node
 * `RenderPipeline` from its colour and depth: GTAO (half resolution, normals
 * reconstructed from depth) ^ `AO_EXPONENT` → DoF (`DepthOfFieldNode`,
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
 * while it is on, and the target goes when it is left. A desktop's pastel
 * frame copies nothing for SMAA either (`Antialiasing.read`): standing, it
 * reads the lens blur's composite; walking, the scene target, the contact
 * shadows multiplied in after it; only Modell's frame is drawn into
 * `beforeAa` first. A pastel frame in motion is blurred along the
 * camera's way (motion-blur.ts) without a target of its own: on a phone
 * in the last pass in place of the FXAA, on a desktop into the lens
 * blur's input copy, idle while the camera moves.
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
  profile: PostProfile,
  /** towards the sun, world space, kept current by the sun rig: the
   *  graphic styles decide light and shade by it */
  sunDirection: Vector3,
  /** the sun's shadow map (sun-rig.ts `shadowMap`): ...and by it */
  sunShadow: SunShadowMap
): PostStack {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const depthTexture = new DepthTexture(size.x, size.y);
  // a reversed buffer keeps its precision as floats (depth32float), the
  // four bytes a pixel the 24-bit one takes
  if (renderer.reversedDepthBuffer) {
    depthTexture.type = FloatType;
  }
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
  const contact = float(AO_EXPONENT);
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
  const motion = createMotionBlur(depthTexture, lens);

  let style: RenderStyleDef = RENDER_STYLE_BY_ID[LOOK_DEFAULTS.style];
  const stylize = createStylize({
    lens,
    depth: depthTexture,
    fog,
    litAt,
    sunDirection,
    sunShadow,
    reversedDepth: renderer.reversedDepthBuffer,
  });
  const paperScene = createPaperScene(scene, fog.color);
  const styleDressing = createStyleDressing(scene);

  const finishing: Finish = {
    grading: uniform(GRADING),
    grain: uniform(GRAIN),
    film: uniform(0),
    vignetteOffset: uniform(style.vignette.offset),
    vignetteDarkness: uniform(style.vignette.darkness),
  };
  // The frame before its antialiasing, where a pipeline draws it: one
  // target and one SMAA for all of them. SMAA reads a texture, and each
  // pipeline carrying its own made a copy of its input and three targets
  // of its own — sixteen at full resolution, all resident once the styles
  // were warmed, ~95 MB on an iPhone. Only a picture style draws here (and
  // Modell's pastel frame under SMAA, the lens blur under FXAA): the target
  // is allocated by the first frame that does, and freed by the first that
  // does not — the pastel look, walking or standing, never holds it.
  const beforeAa = new RenderTarget(size.x, size.y, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  beforeAa.texture.name = "BeforeAA";
  // One pixel to draw into: under SMAA the lens blur runs its passes for
  // it (`Pre.into`), and the pipelines warm into it. Its render context is
  // `beforeAa`'s — three keys a context by the target's attachments
  // (count, format, type, samples, depth, stencil), the call depth and the
  // kind of camera, not by its size — so a build made drawing here is the
  // one `beforeAa`'s frames use, and warming allocates nothing at full
  // size.
  const pixel = new RenderTarget(1, 1, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  pixel.texture.name = "PrePixel";
  const antialiasing = antialiasingOf(
    profile.antialias,
    beforeAa,
    target,
    occlusion
  );
  // drawn after the frame, onto the canvas (`setOverlay`)
  let overlay: Overlay | null = null;
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
  // The pastel frame in motion under FXAA: the motion blur in the last
  // pass, in place of the FXAA — about as many reads, no target; a smear
  // of a pixel or more hides the stairs FXAA would have smoothed.
  const finished = {
    afterPre: finishedOf(antialiasing.afterPre),
    direct: antialiasing.direct && finishedOf(antialiasing.direct),
    moving:
      antialiasing.direct && finishedOf(motion.over(target.texture, occlusion)),
  };
  // A pipeline renders into the current target (`Pre.into`).
  const pipelineOf = (node: V4) => {
    const p = new RenderPipeline(renderer, node);
    p.outputColorTransform = false;
    return p;
  };
  const preOf = (
    pipeline: RenderPipeline,
    into = beforeAa,
    reads = into.texture
  ): Pre => ({ pipeline, into, reads });
  // SMAA reads its input where it lies (`Antialiasing.read`), so nothing
  // copies the frame for it: the lens blur's composite, or the scene target
  // with the contact shadows after it.
  const readsInPlace = antialiasing.direct === null;
  // The pipelines, each built once: DoF drops while the camera moves (and
  // under a graphic style), and swapping one pipeline's output node would
  // re-translate the whole post graph on the main thread every time a
  // flight starts or stops. The pastel ones have no style node in them at
  // all; every other style is the one styled pair (its mode is a uniform).
  // Without a lens blur there is no DoF half; the walking pastel frame
  // needs no pipeline before the last pass, and Modell's under FXAA none.
  const pastel = {
    dof:
      lensBlur &&
      (readsInPlace
        ? preOf(pipelineOf(lensBlur.focused), pixel, lensBlur.composite)
        : preOf(pipelineOf(lensBlur.focused))),
    // Modell under SMAA: its still frames — the sheets people export —
    // keep the contact shadows under the antialiasing, as they always had
    model: readsInPlace ? preOf(pipelineOf(lit)) : null,
    plain: null,
    // In motion under SMAA: the frame blurred into the lens blur's own
    // copy, which lies idle while the camera moves (`regressed`), and
    // antialiased where it lies — no target of its own.
    motion:
      readsInPlace && lensBlur
        ? preOf(
            pipelineOf(motion.over(target.texture, occlusion)),
            lensBlur.input
          )
        : null,
  };
  const styled = {
    dof: lensBlur && preOf(pipelineOf(stylize.node(lensBlur.focused))),
    model: null,
    plain: preOf(pipelineOf(stylize.node(lit))),
  };

  // Three independent layers gate the lens blur, and only the choice below
  // combines them: the render loop writes `regressed` (moving), the picture
  // style its gate (RenderStyleDef.allowDof: a graphic style draws without
  // it), Modell `model` — recovery from one never overrides another.
  let regressed = false;
  let model = false;
  // the camera moved enough this frame to draw the pastel frame blurred
  // (motion-blur.ts), where this tier has a way to draw it
  let blurred = false;
  // ...and how: before SMAA on a desktop, in place of the FXAA on a phone
  const moving = pastel.motion
    ? { pre: pastel.motion, finished: finished.afterPre }
    : finished.moving
      ? { pre: null, finished: finished.moving }
      : null;
  /** What draws before the antialiasing this frame (null: nothing), and
   *  the last pass. */
  const frame = () => {
    if (blurred && moving) {
      return moving;
    }
    const pair = style.shaderMode > 0 ? styled : pastel;
    const lensOn = style.allowDof && !regressed && !model;
    const pre =
      (lensOn ? pair.dof : null) ?? (model ? pair.model : null) ?? pair.plain;
    return {
      pre,
      finished: pre
        ? finished.afterPre
        : (finished.direct ?? finished.afterPre),
    };
  };
  // Pipelines that still have to build: a pipeline builds its graph on its
  // first render, so each is rendered once, one per frame, into the pixel
  // ahead of the one the frame shows. The pastel ones go first — those
  // frames are under the load screen.
  const toWarm: RenderPipeline[] = [
    pastel.dof,
    pastel.model,
    pastel.motion,
  ].flatMap((p) => (p ? [p.pipeline] : []));
  // The phone's blurred last pass draws to the canvas, a render context
  // the pixel does not share: it warms there, once, under the frame that
  // overdraws it.
  let warmMoving = finished.moving;
  // whether `beforeAa` holds its memory (a frame that draws elsewhere lets
  // it go)
  let preHeld = false;
  /** Draws what goes before the antialiasing, if anything, and a warm-up. */
  const drawPre = (pre: Pre | null) => {
    const warming = toWarm.shift();
    if (preHeld && pre?.into !== beforeAa) {
      beforeAa.dispose();
      preHeld = false;
    }
    const previous = renderer.getRenderTarget();
    try {
      if (warming && warming !== pre?.pipeline) {
        renderer.setRenderTarget(pixel);
        warming.render();
      }
      if (pre) {
        preHeld ||= pre.into === beforeAa;
        renderer.setRenderTarget(pre.into);
        pre.pipeline.render();
      }
    } finally {
      renderer.setRenderTarget(previous);
    }
  };

  // The style weights the fixed strengths; Modell drops the grading.
  const applyStyleWeights = () => {
    finishing.grading.value = model ? 0 : GRADING * style.gradingWeight;
    finishing.grain.value = Math.min(GRAIN * style.grainWeight, 2);
    finishing.film.value = style.grainAnimated ? 1 : 0;
    // offset and darkness 0: the vignette's smoothstep is 1 everywhere
    finishing.vignetteOffset.value = model ? 0 : style.vignette.offset;
    finishing.vignetteDarkness.value = model ? 0 : style.vignette.darkness;
    stylize.setInk(INK * style.inkWeight);
    stylize.setStyle(style);
    // Comic prints its crowns flat, a bare one whole (crown-season.ts)
    crownsPrinted.value = style.crowns === "comic" ? 1 : 0;
    dataMarks.value = DATA_MARKS[style.dataMarks];
    crownSwayShare.value = style.sway;
  };
  applyStyleWeights();

  // Autofocus: the distance, along the view, to the crosshair's last hit.
  const focusPoint = new Vector3(0, 0, -HYPERFOCAL_M);
  const inView = new Vector3();
  const updateFocus = () => {
    inView.copy(focusPoint).applyMatrix4(active().matrixWorldInverse);
    const d = Math.max(1, -inView.z);
    focusDistance.value = d;
    focusRange.value = focusRangeFor(d);
  };

  /** set by `dispose`: what is let go later goes at once, and what is
   *  queued compiles nothing */
  let stackDisposed = false;
  // The geometries disposed while a walk over them runs (`compileAll`, a
  // tile's `compile`).
  const gone = new WeakSet<BufferGeometry>();
  /** `object`'s tile left while a walk over it runs */
  const left = (object: Object3D) => {
    const { geometry } = object as Drawable;
    return geometry !== undefined && gone.has(geometry);
  };
  /**
   * Notes in `gone` each of `list`'s geometries disposed until the returned
   * stop. A listener of each walk's own: three adds one function once per
   * geometry, so a shared one taken off by the walk that ended first would
   * no longer hear a geometry another walk still compiles.
   */
  const watchGone = (list: readonly Drawable[]) => {
    const geometries = new Set(list.map((o) => o.geometry as BufferGeometry));
    const onGone = (event: { target: BufferGeometry }) =>
      gone.add(event.target);
    for (const g of geometries) {
      g.addEventListener("dispose", onGone);
    }
    return () => {
      for (const g of geometries) {
        g.removeEventListener("dispose", onGone);
      }
    };
  };
  /**
   * `roots`' drawables as they are now, without those whose tile left: a
   * set of stand-ins is made when it is asked for, after the awaits before
   * it, and a tile's own material anchored as itself must not be one the
   * tile has freed — its compile would upload the freed textures again,
   * and nothing would free them then.
   */
  const present = (roots: Object3D[]) =>
    roots.flatMap(drawablesOf).filter((d) => !left(d));
  /**
   * One drawable, shown and unculled for the call: `compileAsync` walks a
   * tree the way a frame does, skipping what is hidden or outside the view,
   * and whatever the camera did not see yet would otherwise build inside
   * the frame that first shows it. One call per drawable on purpose: a
   * call builds its node graphs (TSL → WGSL) synchronously, and the await
   * between calls is where a frame gets in. Each call also walks the
   * scene for its lights — cheap next to one node build, and the price of
   * never blocking a frame for a whole tile. Made only in a compile's turn
   * (compile-lanes.ts `compileInTurn`): `compileOne` queues it. A drawable
   * whose tile left while it waited for its turn, or a stack disposed
   * meanwhile, compiles nothing: it would re-create the GPU buffers of a
   * disposed geometry, and nothing would free them again (`compileAll`
   * skips such a drawable only when it queues it).
   */
  const compileNow = (object: Object3D, view: Camera = camera) => {
    if (stackDisposed || left(object)) {
      return Promise.resolve();
    }
    const previous = renderer.getRenderTarget();
    const { visible, frustumCulled } = object;
    object.visible = true;
    object.frustumCulled = false;
    renderer.setRenderTarget(target);
    try {
      return renderer.compileAsync(object, view, scene);
    } finally {
      renderer.setRenderTarget(previous);
      object.visible = visible;
      object.frustumCulled = frustumCulled;
    }
  };
  /** Queues a compile made by `now` behind the ones in flight. */
  const inTurn =
    (now: (object: Object3D) => Promise<void>) =>
    (object: Object3D): Promise<void> =>
      compileInTurn(renderer, () => now(object));
  const compileOne = inTurn((object) => compileNow(object));
  /**
   * The cameras the frames are drawn with, one of each kind: the walk/fly
   * camera, and once it was asked for (`warmView`) Modell's parallel one.
   * three (r187) builds a material's programs per kind of camera — a
   * parallel view's light comes from one fixed direction — so a build made
   * for the one is never drawn by the other.
   */
  const views: Camera[] = [camera];
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
  // object and reads the override's position node for its build. So the
  // swap is made in the compile's turn, not when it is queued.
  const swappedIn =
    (kind: PaperKind, now: (object: Object3D) => Promise<void>) =>
    (object: Object3D): Promise<void> =>
      paperScene.swapped(object, () => now(object), kind);
  // a camera let go meanwhile (`dropView`) is compiled for no longer: the
  // rest of a walk queued nothing behind the tiles for it, and a compile
  // still queued when it was let go builds nothing
  const compileSwap = (kind: PaperKind, view: Camera) => {
    const swap = inTurn(
      swappedIn(kind, (o) =>
        views.includes(view) ? compileNow(o, view) : Promise.resolve()
      )
    );
    return (object: Drawable): Promise<void> =>
      paperScene.drawsAsPaper(object, kind) && views.includes(view)
        ? swap(object)
        : Promise.resolve();
  };
  // The swaps' own materials: Strich wears Papier's card, so its programs
  // are Papier's.
  const SWAP_KINDS = ["paper", "figure", "ink"] as const;
  type SwapKind = (typeof SWAP_KINDS)[number];
  const swapOf = (kind: PaperKind): SwapKind =>
    kind === "line" ? "paper" : kind;
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
    /** the camera the cut is seen with (Modell's) */
    view: Camera;
    kind: PaperKind | undefined;
    /** both sides of each build: clipped and plain, and the swap's */
    anchors: { a: PipelineAnchors; paper: boolean }[];
    done: WeakMap<Drawable, Compiling>;
  }
  let cut: CutHold | null = null;
  let releaseAfterFrame: PipelineAnchors[] = [];
  /**
   * Lets `held` go once the compiles queued so far — a set of their
   * stand-ins among them, maybe — have settled, and a frame has drawn
   * without them: freed before its turn, a queued set would build its
   * freed stand-ins again, and nothing would free them then (the queue is
   * an upstream workaround, `compileInTurn`: without it, wait for their
   * own compiles). Not if `release()`, asked then, says no (taken back).
   */
  const releaseWhenSettled = (
    held: PipelineAnchors[],
    release: () => boolean = () => true
  ) => {
    void compileInTurn(renderer, () => Promise.resolve()).then(() => {
      if (!release()) {
        return;
      }
      if (stackDisposed) {
        for (const a of held) {
          a.dispose();
        }
      } else {
        releaseAfterFrame.push(...held);
      }
    });
  };
  /**
   * `object` compiled under `group`'s clipping (three-utils.ts
   * `aloneUnder`): the render object the call makes has the very context
   * the frames use while the cut shows. In a compile's turn only.
   */
  const compileUnder = (
    group: ClippingGroup,
    object: Object3D,
    view: Camera
  ) => {
    if (stackDisposed) {
      return Promise.resolve();
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
      return aloneUnder(group, object, () =>
        renderer.compileAsync(group, view, scene)
      );
    } finally {
      renderer.setRenderTarget(previous);
    }
  };
  const newHold = (
    group: ClippingGroup,
    view: Camera,
    kind?: PaperKind
  ): CutHold => {
    const under = (o: Object3D) => compileUnder(group, o, view);
    const plain = (o: Object3D) => compileNow(o, view);
    const anchors = [
      { a: createPipelineAnchors(inTurn(under), true), paper: false },
      { a: createPipelineAnchors(inTurn(plain), true), paper: false },
    ];
    if (kind) {
      anchors.push(
        {
          a: createPipelineAnchors(inTurn(swappedIn(kind, under)), true),
          paper: true,
        },
        {
          a: createPipelineAnchors(inTurn(swappedIn(kind, plain)), true),
          paper: true,
        }
      );
    }
    return { group, view, kind, anchors, done: new WeakMap() };
  };
  /** Holds both sides of the cut for `roots`' drawables, one per build. */
  const holdAll = async (held: CutHold, roots: Object3D[]) => {
    // every drawable, not one per material and attribute names: the
    // anchors key a pipeline as three does (the buffers' strides and
    // offsets too), and a pipeline the frames come back to that no anchor
    // holds is one built inside the frame; the clipped and the plain side,
    // each set of stand-ins in one call, of the drawables still there
    for (const { a, paper } of held.anchors) {
      if (cut !== held) {
        return;
      }
      if (!paper) {
        await a.anchorAll(present(roots));
      }
    }
    // the swap's, drawable by drawable: the swap carries one drawable's
    // position node over
    const kind = held.kind;
    if (kind === undefined) {
      return;
    }
    const step = async (drawable: Drawable) => {
      if (!paperScene.drawsAsPaper(drawable, kind)) {
        return;
      }
      for (const { a, paper } of held.anchors) {
        // a tile that left after the clipped side's stand-in: its own
        // material, freed, anchored as itself would hold no listener that
        // ever fires, and its compile would upload the freed textures again
        if (cut !== held || left(drawable)) {
          return;
        }
        if (paper) {
          await a.anchor(drawable);
        }
      }
    };
    await compileAll(present(roots), step, held.done);
  };
  const letGo = () => {
    if (cut) {
      releaseWhenSettled(cut.anchors.map(({ a }) => a));
      cut = null;
    }
  };

  // Once is enough for a drawable and its material (a tile, then the whole
  // scene at boot, walks the same objects) — and a walk resolves only once
  // the steps another walk started on its drawables have (compile-lanes.ts).
  // The swaps' records are per camera (`views`).
  const compiled = new WeakMap<Drawable, Compiling>();
  const swapRecords = new Map<
    Camera,
    Record<SwapKind, WeakMap<Drawable, Compiling>>
  >();
  const swapRecordsOf = (view: Camera) => {
    let r = swapRecords.get(view);
    if (!r) {
      r = { paper: new WeakMap(), figure: new WeakMap(), ink: new WeakMap() };
      swapRecords.set(view, r);
    }
    return r;
  };
  // Another kind of camera's own builds (`warmView`) are held by stand-ins
  // of every material, while that camera is wanted: compiled a whole set
  // to the call, and nothing a tile frees is among them.
  const viewAnchors = new Map<Camera, PipelineAnchors>();
  // A let-go camera's anchors until the compiles queued before they go have
  // settled (`dropView`): the camera wanted again meanwhile takes them back,
  // instead of building anew what they still hold.
  const dropping = new Map<
    Camera,
    { anchors: PipelineAnchors; drop: object }
  >();
  const anchorsOf = (view: Camera) => {
    const a =
      viewAnchors.get(view) ??
      dropping.get(view)?.anchors ??
      createPipelineAnchors(
        inTurn((o) => compileNow(o, view)),
        true
      );
    dropping.delete(view);
    viewAnchors.set(view, a);
    return a;
  };
  // Papier's programs are made once the styles are warmed (where the
  // profile's `warmPaper` allows) or while Papier is on; otherwise a tile
  // compiles for the scene's own look only.
  let paperWanted = false;
  /**
   * The builds of `roots` for every view (or `only`): its own — the
   * walk/fly camera's are made drawable by drawable, which also uploads
   * them; another camera's are anchored from every drawable, as the
   * anchors key a pipeline (the buffers' strides and offsets too) — and
   * the swaps', where Papier is wanted or on, one drawable per build (the
   * override's build is keyed by the source's material and layout).
   */
  const compileBuilds = async (roots: Object3D[], only?: Camera) => {
    let representatives: Drawable[] | null = null;
    // the representatives outlive one walk (every kind, every view): a
    // tile that leaves between two walks is heard too, not only during one
    let unwatch = () => {};
    try {
      // a copy: a view asked for or let go meanwhile does not shift the walk
      for (const view of only ? [only] : [...views]) {
        // a camera let go meanwhile (`dropView`) is compiled for no longer
        if (!views.includes(view)) {
          continue;
        }
        if (view !== camera) {
          await anchorsOf(view).anchorAll(present(roots));
        }
        const kind = style.paperScene;
        if (!(paperWanted || kind)) {
          continue;
        }
        if (!representatives) {
          representatives = compileRepresentatives(roots);
          unwatch = watchGone(representatives);
        }
        for (const k of paperWanted || !kind ? SWAP_KINDS : [swapOf(kind)]) {
          if (!views.includes(view)) {
            break;
          }
          await compileAll(
            representatives,
            compileSwap(k, view),
            swapRecordsOf(view)[k]
          );
        }
      }
    } finally {
      unwatch();
    }
  };

  const compileAll = async (
    list: Drawable[],
    step: (drawable: Drawable) => Promise<void>,
    done: WeakMap<Drawable, Compiling>
  ) => {
    const unwatch = watchGone(list);
    // One at a time per lane: a drawable whose tile left meanwhile is
    // skipped — compiling it would re-create the GPU buffers of a disposed
    // geometry, and nothing would free them again.
    try {
      await compileInLanes(list, step, done, {
        lanes: COMPILE_LANES,
        skip: left,
      });
    } finally {
      unwatch();
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
    toWarm.push(
      ...[styled.plain, styled.dof].flatMap((p) => (p ? [p.pipeline] : []))
    );
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
    await compileBuilds([scene]);
  };

  return {
    compile: async (root) => {
      const drawables = drawablesOf(root);
      // a tile that leaves before its holds and other cameras' anchors are
      // made has nothing of it anchored (`present`)
      const unwatch = watchGone(drawables);
      try {
        await compileAll(drawables, compileAnchored, compiled);
        // a tile landing under a cut that shows: its builds held before it
        // does
        if (cut) {
          await holdAll(cut, [root]);
        }
        if (views.length > 1 || paperWanted || style.paperScene) {
          await compileBuilds([root]);
        }
      } finally {
        unwatch();
      }
    },
    anchorCount: () => anchors.count(),
    holdCut: async (group, roots, view) => {
      if (cut?.group !== group || cut.view !== view) {
        letGo();
        cut = newHold(group, view, style.paperScene ?? undefined);
      }
      await holdAll(cut, roots);
    },
    warmView: async (view) => {
      // a disposed stack takes no camera: its anchors would never be freed
      if (stackDisposed) {
        return;
      }
      if (!views.includes(view)) {
        views.push(view);
      }
      await outline.compile(renderer, view);
      // the plate's programs: a failed build costs the plate its first
      // frame, never the scene's warm-up after it
      await overlay?.compile(renderer, view).catch(() => undefined);
      await compileBuilds([scene], view);
    },
    dropView: (view) => {
      if (view === camera || !views.includes(view)) {
        return;
      }
      views.splice(views.indexOf(view), 1);
      // its swaps' builds may go meanwhile: compiled again when wanted again
      swapRecords.delete(view);
      const held = viewAnchors.get(view);
      if (held) {
        viewAnchors.delete(view);
        const drop = {};
        dropping.set(view, { anchors: held, drop });
        // not if the camera took them back meanwhile (`anchorsOf`), or a
        // later drop holds them; and a camera wanted again (`warmView`)
        // that has not come to them yet takes them back now
        releaseWhenSettled([held], () => {
          if (dropping.get(view)?.drop !== drop) {
            return false;
          }
          dropping.delete(view);
          if (!stackDisposed && views.includes(view)) {
            viewAnchors.set(view, held);
            return false;
          }
          return true;
        });
      }
    },
    releaseCut: letGo,
    warmStyles: () => {
      // the outline's mask and blur programs too, on every tier: the first
      // question builds nothing
      stylesWarm ??= outline
        .compile(renderer, camera)
        .then(() => overlay?.compile(renderer, camera).catch(() => undefined))
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
      // The frame names its targets and ends on the canvas, never on the
      // target it found set: a compile in flight (`compileOne`) sets the
      // scene target again after each build it resumes — three's
      // compileAsync restores the target it was called with — so between
      // two frames the renderer may be left drawing into `target`, and the
      // last pass, which reads the scene's depth, would draw into it too.
      // An upstream workaround (docs/rendering.md, "Workarounds for
      // upstream bugs") that may stay once three fixes it.
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
      const swap = style.paperScene;
      const restore = swap ? paperScene.begin(swap) : null;
      stylize.captureFog();
      const view = active();
      try {
        renderer.render(scene, view);
      } finally {
        restore?.();
        dressed?.();
        renderer.setRenderTarget(null);
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
      // `regressed`: the lens blur is off, and its copy free to draw into
      blurred = motion.update(
        size,
        moving !== null && style.shaderMode === 0 && !model && regressed,
        moving?.pre === null
      );
      const shown = frame();
      // the input named before anything is drawn or let go: `beforeAa`
      // may be freed below, and SMAA must not still be bound to it then
      antialiasing.read(shown.pre?.reads ?? target.texture, shown.pre === null);
      drawPre(shown.pre);
      if (warmMoving && shown.finished !== warmMoving) {
        warmMoving.render();
      }
      warmMoving = null;
      shown.finished.render();
      overlay?.render(renderer, view);
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
      // the lens blur sizes its copy when it runs; the motion blur draws
      // there while it does not
      lensBlur?.input.setSize(size.x, size.y);
      antialiasing.setSize(size);
      outline.setSize(size.x, size.y);
    },
    setSelection: (selection, flash) => outline.set(selection, flash),
    sceneDepth: depthTexture,
    setOverlay: (next) => {
      overlay = next;
    },
    setModel: (on) => {
      model = on;
      applyStyleWeights();
    },
    applyLook: (look) => {
      style = RENDER_STYLE_BY_ID[look.style];
      applyStyleWeights();
    },
    setRegressed: (on) => {
      regressed = on;
    },
    setFocusTarget: (point) => {
      // No hit (sky) keeps the last focus, so tilting a degree above a far
      // building doesn't snap it near.
      if (point) {
        focusPoint.copy(point);
      }
    },
    dispose: () => {
      stackDisposed = true;
      // a walk still running compiles for no other camera, and makes no
      // anchors that nothing would free
      views.splice(1);
      for (const pre of [
        pastel.dof,
        pastel.model,
        pastel.motion,
        styled.dof,
        styled.plain,
      ]) {
        pre?.pipeline.dispose();
      }
      finished.afterPre.dispose();
      finished.direct?.dispose();
      finished.moving?.dispose();
      // the passes' own targets and materials: a pipeline frees its quad's
      // material only, and these hold the screen-sized memory
      antialiasing.dispose();
      lensBlur?.dispose();
      motion.dispose();
      aoTexture.dispose();
      aoPass.dispose();
      beforeAa.dispose();
      pixel.dispose();
      outline.dispose();
      paperScene.dispose();
      stylize.dispose();
      styleDressing.dispose();
      anchors.dispose();
      for (const a of viewAnchors.values()) {
        a.dispose();
      }
      viewAnchors.clear();
      letGo();
      for (const a of releaseAfterFrame) {
        a.dispose();
      }
      releaseAfterFrame = [];
      target.dispose();
    },
  };
}
