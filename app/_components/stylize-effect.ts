import {
  Color,
  DepthTexture,
  LessEqualCompare,
  Matrix3,
  type Matrix4,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  abs,
  asin,
  atan,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  distance,
  dot,
  exp2,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  getViewPosition,
  If,
  length,
  log2,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { RenderStyleDef } from "@/lib/city/render-style";
import { DATA_HUE } from "./glass";
import { fogFactorAt, type SceneFog } from "./height-fog";
import type { F, V2, V3, V4 } from "./shader-chunks";
import { styleNight } from "./sun-rig";
import type { ViewLens } from "./view-lens";

/**
 * The picture styles' one pass (lib/city/render-style.ts): ink lines from
 * the depth buffer plus a per-style tone treatment of the colour, as one
 * node over the frame. It runs after AO/DoF and BEFORE SMAA, so the lines
 * and the band edges it draws are antialiased like any other edge. The
 * default style draws a pipeline without it (post-stack.ts), so the pastel
 * look pays nothing for it. Every other style is this one node graph; the
 * mode and the pen are uniforms, so a switch between them rebuilds nothing.
 *
 * Lines. Inverse view distance w = 1/z is affine in screen space across any
 * plane, so its second difference along a screen axis is zero on a plane and
 * spikes where the surface folds (a crease) or jumps (a silhouette) — ONE
 * stencil finds both without a normal buffer, and a grazing street a
 * kilometre long stays clean where a first-difference (gradient) test would
 * paint it solid. Two normalisations split the cases:
 *  - `lap / w0` is the relative jump: large only at a silhouette;
 *  - `lap / grad` is the relative change of slope: near 0 on a plane, ≈ 1
 *    at a fold whatever its distance — so a far facade corner gets its line
 *    as surely as a near one. A noise floor (`w0 · CREASE_FLOOR`) keeps
 *    surfaces facing the camera, whose slope is ~0, from boiling.
 * Silhouettes draw at full weight, creases lighter, as a hand would.
 *
 * The hand. The lookup point wanders by ≈ one pixel on a slow, screen-fixed
 * noise field and the stroke weight breathes with a second one, so a long
 * edge reads as a pen line (slightly wavy, thicker and thinner), not as a
 * Sobel filter. Both fields are in CSS pixels, so a retina screen draws the
 * same hand, only finer.
 *
 * Every derivative and texture read sits in uniform control flow: the only
 * branch is on the style's mode (a uniform); per pixel, `select` and `mix`.
 */

/** The sky dome writes no depth: the background lies at the far plane.
 *  Anything nearer than this share of it is geometry — a fixed 4 km once
 *  cut the city off there, an edge that flew along with the camera. */
const SKY_FAR_SHARE = 0.995;
/** A parallel view's background: the cleared depth (its geometry lies well
 *  inside the depth range, which is linear there). */
const SKY_DEPTH = 0.9999;
/** Slope noise floor, relative to w0. */
const CREASE_FLOOR = 0.0012;
/** How much haze a style takes off again at most (`unhaze`). */
const HAZE_CAP = 0.8;
/** How much of the haze, below the cap, the styles fade into their
 *  background over (a step there drew a line that moved with the camera). */
const HAZE_FADE = 0.3;
/** three's `EPSILON` (the effect template's HSL helpers used it). */
const EPS = 1e-6;

/**
 * The pen of each style. Comic and Papier draw by hand: the stroke sways
 * and trembles, swells and thins along its length, lifts off now and then,
 * and sits a little off the edge it outlines (an ink plate printed slightly
 * out of register). Film noir and Sin City keep a steady line.
 */
interface Pen {
  /** relative depth jump: silhouette ramp */
  sil: [number, number];
  /** weight of folds against silhouettes */
  creaseW: number;
  /** CSS px of slow wander (±half) */
  sway: number;
  /** CSS px of fast wander (±half) */
  tremor: number;
  /** CSS px the whole ink plate sits off the fill */
  misregister: [number, number];
  /** stroke width range, CSS px */
  weight: [number, number];
  /** 0 = unbroken, 1 = the pen lifts often */
  lifts: number;
  /** metres over which small detail fades (0 = never) */
  detail: number;
  /**
   * 0..1: how much the stroke's weight and darkness breathe along its
   * length. The fields that drive it are fixed to the screen, so the
   * breathing slides along an edge when the camera moves: a steady pen
   * (0) draws the same line in every frame of a flight.
   */
  hand: number;
  /** the share of ink a line keeps deep in the haze and the far field */
  farInk: number;
}

const PENS: Record<number, Pen> = {
  // Comic: a bold, steady brush line, as a pop-art panel is inked — the
  // same stroke in every frame of a flight (nothing in it is fixed to the
  // screen); silhouettes heavy, folds lighter.
  1: {
    sil: [0.012, 0.045],
    creaseW: 0.8,
    sway: 0,
    tremor: 0,
    misregister: [0, 0],
    weight: [1.5, 1.5],
    lifts: 0,
    detail: 1100,
    hand: 0,
    farInk: 0.35,
  },
  2: {
    sil: [0.012, 0.045],
    creaseW: 0.7,
    sway: 2,
    tremor: 0,
    misregister: [0, 0],
    weight: [0.8, 1.6],
    lifts: 0,
    detail: 0,
    hand: 1,
    farInk: 0.1,
  },
  // Sin City only inks the big jumps — a building standing clear of what
  // is behind it — never a tree lobe over the next one; the folds of a
  // building (eaves, corners, a hall's vaults) out to a few hundred metres.
  3: {
    sil: [0.05, 0.14],
    creaseW: 0.55,
    sway: 0,
    tremor: 0,
    misregister: [0, 0],
    weight: [1.1, 1.1],
    lifts: 0,
    detail: 1100,
    hand: 0,
    farInk: 0.7,
  },
  // Papier: a fine graphite hand, clean, rarely broken.
  4: {
    sil: [0.012, 0.045],
    creaseW: 0.75,
    sway: 2.4,
    tremor: 0.7,
    misregister: [0.6, -0.4],
    weight: [0.6, 1.7],
    lifts: 0.35,
    detail: 1100,
    hand: 1,
    farInk: 0.55,
  },
  // Strich: a technical pen — one weight (a CSS pixel), no wander, never
  // lifted; every fold a line, as on a drawn plan.
  5: {
    sil: [0.01, 0.035],
    creaseW: 0.9,
    sway: 0,
    tremor: 0,
    misregister: [0, 0],
    weight: [1, 1],
    lifts: 0,
    detail: 1400,
    hand: 0,
    farInk: 0.75,
  },
  // Schwarzplan: no ink on the sheet; the line only parts one black
  // building from the one behind it.
  6: {
    sil: [0.03, 0.08],
    creaseW: 0,
    sway: 0,
    tremor: 0,
    misregister: [0, 0],
    weight: [0.75, 0.75],
    lifts: 0,
    detail: 2000,
    hand: 0,
    farInk: 1,
  },
};

// --- small helpers --------------------------------------------------------

function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

function valueNoise(p: V2): F {
  const i = floor(p);
  const f0 = fract(p);
  const f = f0.mul(f0).mul(f0.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Clamped: the scene buffer is HDR (the sun's halo runs past 1), and HSL
 *  of a colour above white folds its hue into nonsense. */
const toPerceptual = (c: V3): V3 => pow(clamp(c, 0, 1), vec3(1 / 2.2));
const toLinear = (p: V3): V3 => pow(max(p, vec3(0)), vec3(2.2));
const lumaOf = (p: V3): F => dot(p, vec3(0.2126, 0.7152, 0.0722));

/** A crisp but antialiased step: the transition spans one pixel of the
 *  input's own gradient, whatever the gradient is. */
function aaStep(edge: F | number, x: F): F {
  const w = max(fwidth(x), 1e-4);
  const e = typeof edge === "number" ? float(edge) : edge;
  return smoothstep(e.sub(w), e.add(w), x);
}

// Hue, chroma and value; HSL (Ian Taylor's, as postprocessing's template).
function rgbToHcv(rgb: V3): V3 {
  const p = mix(
    vec4(rgb.b, rgb.g, -1, 2 / 3),
    vec4(rgb.g, rgb.b, 0, -1 / 3),
    step(rgb.b, rgb.g)
  );
  const q = mix(
    vec4(p.x, p.y, p.w, rgb.r),
    vec4(rgb.r, p.y, p.z, p.x),
    step(p.x, rgb.r)
  );
  const c = q.x.sub(min(q.w, q.y));
  const h = abs(q.w.sub(q.y).div(c.mul(6).add(EPS)).add(q.z));
  return vec3(h, c, q.x);
}

function rgbToHsl(rgb: V3): V3 {
  const hcv = rgbToHcv(rgb);
  const l = hcv.z.sub(hcv.y.mul(0.5));
  const s = hcv.y.div(
    float(1)
      .sub(abs(l.mul(2).sub(1)))
      .add(EPS)
  );
  return vec3(hcv.x, s, l);
}

/**
 * The frame's uv runs from the top-left corner (three's full-screen quad),
 * where the GLSL's ran from the bottom-left: how far up the frame a uv is,
 * and its normalised device coordinates (y up) for view rays.
 */
const frameUp = (at: V2): F => float(1).sub(at.y);
const ndcOf = (at: V2): V2 => vec2(at.x, frameUp(at)).mul(2).sub(1);

/** Pop art's printing inks (perceptual sRGB). */
const POP = {
  paper: vec3(0.99, 0.97, 0.92),
  black: vec3(0.07, 0.06, 0.08),
  night: vec3(0.1, 0.16, 0.42),
  nightGround: vec3(0.05, 0.08, 0.24),
  nightRoof: vec3(0.22, 0.34, 0.66),
  nightHaze: vec3(0.2, 0.27, 0.5),
  nightSky: vec3(0.05, 0.07, 0.2),
  red: vec3(0.89, 0.12, 0.14),
  yellow: vec3(1, 0.84, 0.13),
  orange: vec3(0.93, 0.52, 0.12),
  paperShade: vec3(0.74, 0.81, 0.9),
  blue: vec3(0.13, 0.36, 0.72),
  green: vec3(0.16, 0.62, 0.3),
  greenDeep: vec3(0.05, 0.36, 0.2),
  blueDeep: vec3(0.06, 0.2, 0.52),
  sky: vec3(0.55, 0.8, 0.95),
  skyHigh: vec3(0.3, 0.62, 0.9),
};

/** A step this many device pixels tall (from, to) begins to draw its
 *  line, and draws it whole (`edgeAxis`, `low`). */
const LOW_STEP_PX = { x: 1.8, y: 3.6 };
/** A dot of the screen spans about this many CSS pixels, at any distance. */
const DOT_CSS = 4;
/** The sun's world height (sin of its altitude) where `inSun` has faded
 *  it out entirely. */
const SUN_GONE_Y = -0.02;
/** The sky screen's finest cell (rad): a whole fraction of the circle,
 *  as is every coarser one (`skyDots`). */
const SKY_CELL = (2 * Math.PI) / 8192;
/**
 * Papier's night card (perceptual): its own faces, those the sky's light
 * reaches, what the lamps and lit windows light, the sky overhead and at
 * the horizon, and the white pencil it is drawn with. The night's light
 * is dim: `gain` opens it up before the cut (as Film noir's camera does).
 */
const PAPER_NIGHT = {
  card: vec3(0.1, 0.115, 0.18),
  moon: vec3(0.3, 0.34, 0.46),
  glow: vec3(1, 0.86, 0.6),
  sky: vec3(0.06, 0.075, 0.13),
  horizon: vec3(0.15, 0.17, 0.25),
  dusk: vec3(0.6, 0.53, 0.6),
  pencil: vec3(0.66, 0.7, 0.8),
  gain: 2,
  moonFrom: 0.06,
  moonTo: 0.3,
};
/** What counts as a night light (a lamp's pool, a lit window), on the
 *  gained lightness: from, to. */
const NIGHT_LIGHT = { from: 0.32, to: 0.6 };
/** Strich's gain on the night's light, and the warm wash under a lamp. */
const STRICH_NIGHT_GAIN = 2;
const NIGHT_WASH = vec3(1, 0.9, 0.62);
/**
 * Strich's night as an etcher prints it: an aquatint's tone under the
 * hatch — the ground's, a dark wall's, the sky's from the horizon to the
 * zenith — and the pen's black, so what a lamp leaves white stands out.
 */
const AQUATINT = {
  ground: vec3(0.42, 0.43, 0.5),
  deep: vec3(0.27, 0.28, 0.34),
  horizon: vec3(0.38, 0.39, 0.46),
  zenith: vec3(0.16, 0.17, 0.23),
  pen: vec3(0.05, 0.055, 0.07),
};
/** Strich's hatch lines lie this many CSS pixels apart. */
const HATCH_CSS = 6;
/** The finest screen's cell (m); each coarser one doubles it. */
const SCREEN_BASE_M = 0.05;

/** What the depth buffer says of the surface at a pixel. */
interface Surface {
  /** its world position */
  world: V3;
  /** its world normal, turned to the camera */
  n: V3;
  /** the normal's up component: 1 on flat ground, 0 on a wall */
  up: F;
  /** 1 on a pitched roof */
  roofSlope: F;
  /** how much of the scene's fog colour it took (0..1; 0 for the sky) */
  haze: F;
  /** |cos| of the angle between the view and the normal: 0 at grazing */
  facing: F;
}

// --- the pass -------------------------------------------------------------

export interface StylizeInputs {
  /** what the passes know of the camera (view-lens.ts) */
  lens: ViewLens;
  /** the scene pass's depth */
  depth: DepthTexture;
  /** the scene's fog: its range and colour, read live */
  fog: SceneFog;
  /** the lit (AO'd, not DoF'd) scene colour at a uv, linear */
  litAt: (at: V2) => V3;
  /** towards the sun, world space (read live) */
  sunDirection: Vector3;
  /** the sun's shadow map */
  sunShadow: SunShadowMap;
}

/** What the styles read of the sun's shadow map (sun-rig.ts `shadowMap`). */
export interface SunShadowMap {
  /** its depth, null until the first lit material made it */
  depth: () => DepthTexture | null;
  /** world → map ([0, 1]³), kept current by three */
  matrix: Matrix4;
  /** the depth bias the scene's own lookup adds (three's `shadow.bias`):
   *  a fixed one on foot, one per fit of the warped map from the air */
  bias: () => number;
}

export interface Stylize {
  /** The styled frame over `input` (the colour at this pixel). */
  node: (input: V4) => V4;
  /** Sets the mode and pen of a style (no rebuild: uniforms). */
  setStyle: (style: RenderStyleDef) => void;
  /** Outline strength, 0..~1.25 (post-stack.ts `INK` times the style's
   *  weight). */
  setInk: (value: number) => void;
  /**
   * The sun's altitude, for Film noir's exposure: the light starts to go
   * well before sunset (the sun's intensity ramps below ~12°), so the gain
   * follows from there to civil dusk (-6°), where the lamps are all lit.
   */
  setSunAltitude: (altitudeDeg: number) => void;
  /** Per frame: the camera's frame and the drawing buffer's pixels. */
  update: (pixelRatio: number, size: Vector2) => void;
  /**
   * Per frame, while the scene renders: the fog colour it is drawn with
   * (a style's swap brings its own, restored before the pass runs), the
   * colour the pass takes off again.
   */
  captureFog: () => void;
  dispose: () => void;
}

export function createStylize(inputs: StylizeInputs): Stylize {
  const { lens, fog, litAt } = inputs;
  const camera = lens.camera;
  const skyZ = uniform(6000 * SKY_FAR_SHARE);
  const ortho = lens.ortho.greaterThan(0.5);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const mode = uniform(1);
  const ink = uniform(0.7);
  const dusk = uniform(0);
  // the sun rig's night factor (sun-rig.ts `styleNight`): the nights of
  // Papier and Strich follow the lamps, not the fading sun
  const night = styleNight;
  const pixelScale = uniform(1);
  const resolution = uniform(new Vector2(1, 1));
  const upView = uniform(new Vector3(0, 1, 0));
  const projScale = uniform(new Vector2(1, 1));
  const viewToWorld = uniform(new Matrix3());
  const eye = uniform(new Vector3());
  const sunWorld = uniform(inputs.sunDirection);
  // The shadow map is made by the first lit material, after this graph:
  // the read binds a stand-in until then, swapped for the map (a binding,
  // not a build) in `update`. The stand-in compares like the map.
  const frameFog = uniform(new Color());
  const shadowStandIn = new DepthTexture(1, 1);
  shadowStandIn.compareFunction = LessEqualCompare;
  // every read of it, so `update` can bind the map to each
  const shadowReads: ReturnType<typeof texture>[] = [];
  const shadowMatrix = uniform(inputs.sunShadow.matrix);
  const shadowBias = uniform(0).onRenderUpdate(() => inputs.sunShadow.bias());
  const shadowReady = uniform(0);
  const pen = {
    sil: uniform(new Vector2(0.012, 0.045)),
    creaseW: uniform(0.7),
    sway: uniform(4),
    tremor: uniform(1.3),
    misregister: uniform(new Vector2(1.3, -0.9)),
    weight: uniform(new Vector2(0.55, 2.5)),
    lifts: uniform(1),
    detail: uniform(260),
    hand: uniform(0),
    farInk: uniform(0.1),
  };
  const texel = vec2(1).div(resolution);
  /** A linear colour as it was before the fog took `haze` of it (up to
   *  HAZE_CAP: past it there is too little of the colour left to lift). */
  const unhaze = (c: V3, haze: F): V3 => {
    const amount = min(haze, HAZE_CAP);
    // reason: a colour uniform is a vec3 in the graph; its type says Color.
    const smoke = frameFog as unknown as V3;
    return max(c.sub(smoke.mul(amount)).div(float(1).sub(amount)), vec3(0));
  };

  const viewDistance = (at: V2): F =>
    lens.distance(texture(inputs.depth, at).r);
  /** Is the pixel at `at` (whose distance is `z`) sky — the background? */
  const isSky = (at: V2, z: F): F =>
    select(ortho, step(SKY_DEPTH, texture(inputs.depth, at).r), step(skyZ, z));

  /**
   * What the stencil differences: in perspective w = 1/z, which is affine
   * in screen space across a plane; in a parallel view z itself is. The
   * relative jump divides by `norm`: w0 in perspective (Δz/z), the
   * equivalent distance in a parallel view — so a step inks as it would
   * seen from that far.
   */
  const metric = (z: F): F => select(ortho, z, float(1).div(max(z, 1e-3)));

  /**
   * Is the surface at `world` in the sun? Turned towards it, and not in a
   * cast shadow: the pixel's world point tested against the sun's own
   * shadow map — the shadow the scene drew, exactly, whatever the colour
   * of the surface (a post pass cannot tell a dark roof in the sun from a
   * pale one in shade by its colour). Off the map's frustum (it follows
   * the camera, a few hundred metres round) the caller's `beyond` stands
   * in — the style's guess from lightness —, faded in over the frustum's
   * last 4 % so its edge draws no line; below the horizon nothing is in
   * the sun. 0..1, the map's own 2×2 filter at a shadow's edge.
   */
  const inSun = (world: V3, n: V3, z: F, beyond: F): F => {
    const towards = aaStep(0.02, dot(n, sunWorld));
    // off the surface a little, against its own depth's quantisation
    const lifted = world.add(n.mul(z.mul(0.0015).add(0.12)));
    const s = shadowMatrix.mul(vec4(lifted, 1));
    const c = s.xyz.div(s.w);
    const at = vec2(c.x, float(1).sub(c.y));
    const edge = min(
      min(at.x, float(1).sub(at.x)),
      min(at.y, float(1).sub(at.y))
    );
    const inside = smoothstep(0, 0.04, edge).mul(step(c.z, 1)).mul(shadowReady);
    const read = texture(shadowStandIn, at);
    shadowReads.push(read);
    const shadowed = read.compare(c.z.add(shadowBias)).x;
    const cast = mix(beyond, shadowed, inside);
    return towards.mul(cast).mul(smoothstep(SUN_GONE_Y, 0.04, sunWorld.y));
  };

  /** The world direction a pixel looks along (every ray of a parallel
   *  view runs the same way). */
  const viewRayWorld = (at: V2): V3 =>
    normalize(
      viewToWorld.mul(
        select(
          ortho,
          vec3(0, 0, -1),
          normalize(vec3(ndcOf(at).mul(projScale), -1))
        )
      )
    );

  /**
   * A print screen on the surface: a 45° pattern laid on the world plane
   * the surface most faces (a roof and the ground on the map's, a wall on
   * its own), so a dot or a hatch stays where it is printed while the
   * camera flies. Its cell keeps to about `cellCss` on screen: the pattern
   * is one of a ladder of cells doubling in size, picked by how many
   * metres a pixel spans there, and between two rungs the two cross-fade
   * — dots split or merge as one comes nearer, they never crawl.
   * `pattern` gives the ink's coverage at a point in cell units (0..1
   * across the cell) and the pixel's size in those units; `turn` (radians,
   * from the plane's own axes) the screen's angle on it.
   */
  const surfaceScreen = (
    world: V3,
    n: V3,
    cellCss: number,
    pattern: (cell: V2, pixel: F) => F,
    mean: F,
    facing: F,
    turn: F
  ): F => {
    const a = abs(n);
    const top = step(max(a.x, a.z), a.y);
    const side = step(a.z, a.x);
    const plane = mix(mix(world.xy, world.zy, side), world.xz, top);
    const c = cos(turn);
    const t = sin(turn);
    const q = vec2(
      plane.x.mul(c).add(plane.y.mul(t)),
      plane.y.mul(c).sub(plane.x.mul(t))
    ).toVar();
    // metres a device pixel spans here, foreshortening included
    const mpp = max(length(fwidth(plane)).mul(0.7071), 1e-4).toVar();
    const level = log2(mpp.mul(pixelScale.mul(cellCss)).div(SCREEN_BASE_M));
    const l0 = floor(level);
    const blend = smoothstep(0.3, 0.7, level.sub(l0));
    const cell0 = exp2(l0).mul(SCREEN_BASE_M).toVar();
    // the pixel's longer axis, in metres: across a grazing street it is
    // many times `mpp`
    const major = max(length(dFdx(q)), length(dFdy(q))).toVar();
    // A cell the pixel's long axis spans half of or more is sampled too
    // coarsely to draw: its dots or lines beat against the pixels and
    // crawl with every step. It gives way to its mean tone before then,
    // the way a mip level would.
    const at = (cell: F): F =>
      mix(
        pattern(fract(q.div(cell)), mpp.div(cell)),
        mean,
        smoothstep(0.3, 0.6, major.div(cell))
      );
    // Seen at a grazing angle a screen is squeezed to nothing across the
    // view and beats against the pixels: there it gives way to its mean
    // tone, as a print does at a distance.
    return mix(
      mix(at(cell0), at(cell0.mul(2)), blend),
      mean,
      smoothstep(0.32, 0.12, facing)
    );
  };

  /** Ben-Day dots covering `fill` of the cell, at 45° — or, as far as
   *  `stripes` says (0..1), printed stripes covering 0.8 of that: one
   *  screen, one cell ladder, whichever a surface takes. */
  const benDay = (world: V3, n: V3, fill: F, facing: F, stripes: F): F => {
    const radius = sqrt(fill.div(Math.PI)).toVar();
    const half = fill.mul(0.4).toVar();
    return surfaceScreen(
      world,
      n,
      DOT_CSS,
      (cell, pixel) => {
        // Anti-aliased over the pixel's footprint across the edge, not its
        // mean size: on a foreshortened plane the two differ many times.
        const r = length(cell.sub(0.5));
        const aa = max(fwidth(r), pixel.mul(0.5)).mul(0.8);
        const dot = float(1).sub(smoothstep(radius.sub(aa), aa.add(radius), r));
        const x = abs(cell.x.sub(0.5));
        const ax = max(fwidth(x), pixel.mul(0.5)).mul(0.8);
        const w = max(half, pixel.mul(0.5));
        const stripe = float(1).sub(smoothstep(w.sub(ax), w.add(ax), x));
        return mix(dot, stripe, stripes);
      },
      fill.mul(mix(1, 0.8, stripes)),
      facing,
      float(Math.PI / 4)
    );
  };

  /** Parallel lines `fill` of the cell wide, `cellCss` apart, at `turn`:
   *  Strich's hatch. */
  const lines = (
    world: V3,
    n: V3,
    fill: F,
    facing: F,
    turn: F,
    cellCss: number
  ): F =>
    surfaceScreen(
      world,
      n,
      cellCss,
      (cell, pixel) => {
        const d = abs(cell.x.sub(0.5));
        const half = max(fill.mul(0.5), pixel.mul(0.5));
        const aa = max(fwidth(d), pixel.mul(0.5)).mul(0.7);
        return float(1).sub(smoothstep(half.sub(aa), half.add(aa), d));
      },
      fill,
      facing,
      turn
    );

  /** The metres a device pixel spans at view distance `z`. */
  const metresPerPixel = (z: F): F =>
    select(ortho, float(1), z).mul(projScale.y.mul(2)).div(resolution.y);

  /** One axis of the stencil: (silhouette, crease) in 0..1. The caller
   *  widens the silhouette ramp with distance, so far away only big jumps
   *  (a building over the street) are inked, not every crown on a lawn.
   *
   *  `low` lets a low step give way: where the two taps lie less than a
   *  couple of pixels apart in height, the jump is a rail, a kerb or a
   *  track's bed hiding the ground behind it — a step a pixel or two
   *  tall, whose raster flips from frame to frame in a move and drew a
   *  crawling, pixelated line. The level axis never gives way: across a
   *  vertical edge the taps sit at one height. */
  const edgeAxis = (
    at: V2,
    s: V2,
    w0: F,
    norm: F,
    sil: V2,
    low: boolean
  ): V2 => {
    const da = texture(inputs.depth, at.sub(s)).r;
    const db = texture(inputs.depth, at.add(s)).r;
    const za = lens.distance(da);
    const zb = lens.distance(db);
    const wa = metric(za);
    const wb = metric(zb);
    const lap = abs(wa.add(wb).sub(w0.mul(2)));
    const grad = max(abs(wb.sub(w0)), abs(w0.sub(wa)));
    const jump = lap.div(norm);
    const fold = lap.div(grad.add(norm.mul(CREASE_FLOOR)));
    const silhouette = smoothstep(sil.x, sil.y, jump);
    const crease = smoothstep(0.35, 0.8, fold).mul(
      smoothstep(0.0004, 0.0016, jump)
    );
    if (!low) {
      return vec2(silhouette, crease);
    }
    // (the world's up in view space: no full turn into the world)
    const ya = dot(getViewPosition(at.sub(s), da, inverseProjection), upView);
    const yb = dot(getViewPosition(at.add(s), db, inverseProjection), upView);
    // (heights from the eye; both in pixels at the nearer tap)
    const mpp = metresPerPixel(min(za, zb));
    const stepPx = abs(ya.sub(yb)).div(mpp);
    // Seen level, a step at the eye's height has its taps at one height
    // too, whatever its size: only a step well under the horizon gives way.
    const underPx = max(ya, yb).negate().div(mpp);
    const keep = mix(
      1,
      smoothstep(LOW_STEP_PX.x, LOW_STEP_PX.y, stepPx),
      smoothstep(3, 5, underPx)
    );
    // (the silhouette only: a crease is a fold of one surface, and at a
    // thin pen the wall's foot or an eave has its taps a few pixels apart)
    return vec2(silhouette.mul(keep), crease);
  };

  /** The four-axis stencil at an integer texel radius around a texel
   *  centre. Integer on purpose: the depth texture is read NEAREST, and a
   *  fractional radius rounds its two taps unevenly — on a grazing street
   *  that uneven second difference is as large as a fold, and whole
   *  patches inked over. */
  const edgeStencil = (p: V2, r: F, w0: F, norm: F, sil: V2): V2 => {
    const sx = vec2(texel.x, 0).mul(r);
    const sy = vec2(0, texel.y).mul(r);
    const sd = texel.mul(r);
    const sa = vec2(texel.x, texel.y.negate()).mul(r);
    return max(
      max(
        edgeAxis(p, sx, w0, norm, sil, false),
        edgeAxis(p, sy, w0, norm, sil, true)
      ),
      max(
        edgeAxis(p, sd, w0, norm, sil, true),
        edgeAxis(p, sa, w0, norm, sil, true)
      )
    );
  };

  /** Ink coverage at `at` (0 = paper, 1 = a full stroke) and the
   *  silhouette's share of it. */
  const inkLines = (
    at: V2,
    z0: F,
    up: F,
    haze: F
  ): { line: F; silhouette: F } => {
    const css = at.mul(resolution).div(pixelScale).toVar();
    const sway = vec2(
      valueNoise(css.div(120).add(3.1)),
      valueNoise(css.div(120).add(17.7))
    ).sub(0.5);
    const tremor = vec2(
      valueNoise(css.div(28).add(7.3)),
      valueNoise(css.div(28).add(29.1))
    ).sub(0.5);
    // Weight changes within a stroke (~50 px), lifts on a slower field.
    const p0 = valueNoise(css.div(50).add(41));
    const pressure = p0.mul(p0).mul(p0.mul(-2).add(3)).toVar();
    const lift = valueNoise(css.div(80).add(91));
    const hasDetail = pen.detail.greaterThan(0);
    const detail = max(pen.detail, 1e-3);
    let widthPx = pixelScale.mul(
      mix(pen.weight.x, pen.weight.y, mix(0.5, pressure, pen.hand))
    );
    // A drawn background is drawn with a finer pen.
    widthPx = select(
      hasDetail,
      widthPx.mul(
        mix(
          1,
          0.55,
          smoothstep(detail.mul(0.5), detail.mul(2.5), lens.fade(z0))
        )
      ),
      widthPx
    );
    // Never below one device pixel: a sub-pixel stencil reads the same
    // depth texel on both sides and finds no edge at all.
    const width = max(widthPx, 1).toVar();
    // Snap the (wandering) lookup to a texel centre; the width then blends
    // between the two integer radii around it, so the stroke still swells
    // continuously.
    const offsetCss = sway
      .mul(pen.sway)
      .add(tremor.mul(pen.tremor))
      .add(pen.misregister);
    const moved = at.add(offsetCss.mul(texel).mul(pixelScale));
    const p = floor(moved.mul(resolution)).add(0.5).mul(texel).toVar();
    const z = viewDistance(p);
    const w0 = metric(z).toVar();
    const norm = select(ortho, lens.equivalent, w0).toVar();
    const zf = lens.fade(min(z0, z)).toVar();
    // Detail falls away with distance: far off only the big jumps count.
    const far = select(hasDetail, zf.div(detail), 0);
    const sil = pen.sil.mul(far.add(1)).toVar();
    const r0 = floor(width);
    const e = mix(
      edgeStencil(p, r0, w0, norm, sil),
      edgeStencil(p, r0.add(1), w0, norm, sil),
      width.sub(r0)
    ).toVar();
    const creaseFade = select(
      hasDetail,
      float(1).sub(smoothstep(detail.mul(0.35), detail.mul(1.4), zf)),
      1
    );
    // Folds in the open ground (the terrain's gentle slope changes) are not
    // lines a hand would draw; kerbs and walls are silhouettes and stay.
    const groundFold = float(1).sub(smoothstep(0.9, 0.97, up).mul(0.75));
    let line = max(e.x, e.y.mul(pen.creaseW).mul(creaseFade).mul(groundFold));
    // The haze swallows ink as it swallows colour: the line fades with the
    // scene's own distance fog, and far detail thins out like a drawn
    // background even on a clear day.
    line = line.mul(
      mix(1, pen.farInk, max(haze, smoothstep(300, 2400, zf).mul(0.6)))
    );
    // Pressure also lightens the ink a little, and the pen lifts off.
    line = line.mul(
      mix(1, mix(0.72, 1, smoothstep(0.15, 0.55, pressure)), pen.hand)
    );
    line = line.mul(
      float(1).sub(pen.lifts.mul(float(1).sub(smoothstep(0.1, 0.24, lift))))
    );
    // A dry, toothy edge: the coverage is cut against the paper's grain.
    const tooth = hash21(floor(css.mul(1.5))).mul(0.45);
    const toothed = mix(
      line,
      smoothstep(tooth, tooth.add(0.4), line),
      pen.lifts.mul(0.6)
    );
    return { line: clamp(toothed, 0, 1), silhouette: e.x };
  };

  /** The perceptual colour through a small blur (nine taps on a ring of
   *  radiusCss): what a flat style decides its areas on, so the fine
   *  shading of crowns, AO and shadow penumbrae cannot break an area into
   *  flecks. */
  const blurredColor = (at: V2, radiusCss: number, haze?: F): V3 => {
    const clear = (c: V3): V3 => toPerceptual(haze ? unhaze(c, haze) : c);
    const r = texel.mul(max(pixelScale.mul(radiusCss), 1));
    const d = r.mul(0.7071);
    const e = vec2(r.x, r.y.negate()).mul(0.7071);
    const taps = [
      at.add(vec2(r.x, 0)),
      at.sub(vec2(r.x, 0)),
      at.add(vec2(0, r.y)),
      at.sub(vec2(0, r.y)),
      at.add(d),
      at.sub(d),
      at.add(e),
      at.sub(e),
    ];
    let sum = clear(litAt(at)).mul(2);
    for (const tap of taps) {
      sum = sum.add(clear(litAt(tap)));
    }
    return sum.div(10);
  };

  /**
   * Comic's sky screen: pale dots on the sky's blue, filling 42 % of the
   * cell at the horizon and none from ~15° up. Laid on the view
   * direction's azimuth and elevation, so a turn carries them like the
   * sky (it is infinitely far: a step does not move it); the cell keeps
   * about `DOT_CSS` on screen through a ladder of cells that halve, each
   * a whole fraction of the circle, so the azimuth wraps without a seam.
   * A parallel view looks along one direction: there its mean tone.
   */
  const skyDots = (at: V2): F => {
    const ray = viewRayWorld(at);
    const el = asin(clamp(ray.y, -1, 1)).toVar();
    const q = vec2(atan(ray.z, ray.x), el).toVar();
    const fill = mix(0.42, 0, smoothstep(0, 0.26, el)).toVar();
    const radius = sqrt(fill.div(Math.PI)).toVar();
    // radians a device pixel spans (the elevation's: the azimuth's
    // derivative jumps where it wraps)
    const rpp = max(fwidth(el), 1e-5).toVar();
    const level = log2(rpp.mul(pixelScale.mul(DOT_CSS)).div(SKY_CELL));
    const l0 = floor(level);
    const blend = smoothstep(0.3, 0.7, level.sub(l0));
    const cell0 = exp2(l0).mul(SKY_CELL).toVar();
    const dotAt = (cell: F): F => {
      const c = q.div(cell);
      // the 45° screen: every other row shifted half a cell
      const shifted = vec2(c.x.add(floor(c.y).mul(0.5)), c.y);
      const d = length(fract(shifted).sub(0.5));
      const aa = rpp.div(cell).mul(0.8);
      return float(1).sub(smoothstep(radius.sub(aa), radius.add(aa), d));
    };
    const dots = mix(dotAt(cell0), dotAt(cell0.mul(2)), blend);
    return select(ortho, fill, dots);
  };

  /** How much of the light at a pixel is warm — a lamp's, a lit
   *  window's, the walker's lantern — not the night sky's cool fill
   *  (0..1, from the perceptual colour). */
  const warmth = (p: V3): F =>
    clamp(
      p.x
        .sub(p.z)
        .div(max(max(p.x, p.y), 1e-3))
        .mul(2.5),
      0,
      1
    );

  /** A night light on the card: bright and warm (lamps, lit windows). */
  const nightLight = (p: V3, y: F): F =>
    smoothstep(NIGHT_LIGHT.from, NIGHT_LIGHT.to, y).mul(
      smoothstep(0.12, 0.45, warmth(p))
    );

  // --- Comic: pop art — a few printing inks, Ben-Day dots, black. ---
  //
  // Every surface is printed in ONE ink picked from what it is (the depth
  // buffer's normal says wall, roof or ground) and from its own hue: the
  // pastel city is all warm beige, so hue alone would print it all in
  // yellow. Light is three steps, no gradient: in the sun the plain ink;
  // turned from the sun or in a cast shadow the ink overprinted with a dot
  // screen; in deep shade black. The dots sit on the surfaces (world
  // space, `benDay`), so they travel with a facade instead of the facade
  // sliding under a screen.
  const comic = (
    at: V2,
    z: F,
    sky: F,
    surface: Surface
  ): { col: V3; foliage: F } => {
    const { world, n, up, roofSlope, haze } = surface;
    // Decided on the colour under the haze, a little blurred: an ink per
    // surface, not per fleck of its shading.
    const b = blurredColor(at, 3, haze).toVar();
    const hsl = rgbToHsl(b).toVar();
    const hcv = rgbToHcv(b).toVar();
    const chroma = hcv.y;
    const hue = hsl.x;
    const l = hsl.z.toVar();
    // What the surface is: the open ground faces up, a wall sideways.
    const flat = smoothstep(0.9, 0.97, up).toVar();
    const wall = float(1)
      .sub(smoothstep(0.25, 0.45, up))
      .toVar();
    const green = step(0.17, hue).mul(step(hue, 0.47)).mul(step(0.05, chroma));
    const warmRed = step(hue, 0.075).add(step(0.9, hue)).mul(step(0.1, chroma));
    // Roofs: a red one red, any other blue-black slate.
    const roofInk = mix(POP.blue, POP.red, step(0.5, warmRed));
    // Walls: a warm one yellow, a pale one the paper. Decided on the
    // saturation (chroma over value): the warm sun on a pale stone lends it
    // chroma, not saturation, and it stays the paper.
    const saturation = chroma.div(max(hcv.z, 1e-3));
    const wallInk = mix(
      POP.paper,
      POP.yellow,
      step(0.04, chroma).mul(step(0.17, saturation))
    );
    // The ground: paving the paper, grass green.
    const groundInk = mix(POP.paper, POP.green, green);
    const isRoof = step(0.5, roofSlope);
    let inkCol = mix(groundInk, wallInk, wall);
    inkCol = mix(inkCol, roofInk, isRoof.mul(float(1).sub(flat)));
    // Foliage, wherever it stands, is green: one flat green, a deeper one
    // where the crown is in its own shade. A crown's every leaf turns its
    // own way, so light, dots and creases decided per pixel there shimmer
    // with every step; a crown is printed as a cut-out instead, decided on
    // a wider blur, its outline its only line.
    const foliage = green.mul(float(1).sub(flat)).toVar();
    // (one wide blur tells both the crowns' and the river's areas)
    const wide = blurredColor(at, 8, haze).toVar();
    const crownL = rgbToHsl(wide).z;
    const crown = mix(POP.green, POP.greenDeep, aaStep(0.3, crownL).oneMinus());
    // Water: the river's waves and glints flicker in the colour, so it is
    // told on a wide blur and printed one flat blue, a deeper one in a
    // cast shadow — no dots, no black: a river is a plain shape on a map.
    const wideHcv = rgbToHcv(wide);
    const wideHue = rgbToHsl(wide).x;
    const water = step(0.45, wideHue)
      .mul(step(wideHue, 0.7))
      .mul(step(0.03, wideHcv.y))
      .mul(smoothstep(0.75, 0.9, up))
      .toVar();
    // Light: in the sun or not (`inSun`, the scene's own shadow).
    const lit = inSun(world, n, z, aaStep(0.42, l));
    const deep = float(1).sub(aaStep(0.2, l));
    const neutral = float(1).sub(step(0.05, distance(inkCol, POP.paper)));
    // The screen: on the paper blue dots, on an ink black ones. The darker
    // the shade, the bigger the dots — a printer's tone, in two or three
    // steps of the eye, not a gradient.
    const dotInk = mix(POP.black, POP.blue, neutral);
    const fill = mix(0.16, 0.42, smoothstep(0.15, 0.6, l).oneMinus());
    // far off, the screen prints lighter: a city of dots reads as noise
    const farOff = mix(1, 0.55, smoothstep(400, 1600, z));
    // A roof in the shade is printed in stripes, not dots: the roofscape
    // reads apart from the walls under it.
    const dots = benDay(
      world,
      n,
      fill,
      surface.facing,
      isRoof.mul(float(1).sub(flat))
    )
      .mul(farOff)
      .toVar();
    const shaded = mix(inkCol, dotInk, dots);
    let day = mix(shaded, inkCol, lit);
    day = mix(day, POP.black, deep.mul(0.85));
    day = mix(day, crown, foliage);
    // A crown that wears its marker ink (vegetation-layer.ts
    // `printedCrown`): saturated as nothing else in the clay, its season in
    // the hue, its light in the value. Printed flat — green, an autumn one
    // yellow, a bare one the paper — and shaded in one step, never dotted:
    // a screen on a swaying crown shimmers.
    const printed = smoothstep(0.82, 0.92, saturation).toVar();
    const crownLit = aaStep(0.3, hcv.z);
    const printInk = mix(
      mix(
        mix(POP.paperShade, POP.paper, crownLit),
        mix(POP.orange, POP.yellow, crownLit),
        step(0.08, hue)
      ),
      mix(POP.greenDeep, POP.green, crownLit),
      step(0.2, hue)
    );
    // A data mark wears a marker ink too (glass.ts `dataMarkColour`), on
    // hues clear of the crowns': printed in a pop ink by its place on its
    // scale — blue, yellow, red — flat, its light left white.
    const dataT = hue.sub(DATA_HUE.from).div(DATA_HUE.to - DATA_HUE.from);
    const dataInk = mix(
      mix(POP.blue, POP.yellow, step(1 / 3, dataT)),
      POP.red,
      step(2 / 3, dataT)
    );
    const isData = step(DATA_HUE.from - 0.05, hue);
    const dataPrinted = printed.mul(isData).toVar();
    day = mix(day, mix(printInk, dataInk, isData), printed);
    // (a marker ink is no river: a blue data mark lies flat, faces up)
    day = mix(
      day,
      mix(POP.blueDeep, POP.blue, lit),
      water.mul(float(1).sub(printed))
    );
    // The sky: one blue, printed lighter towards the horizon with dots of
    // the pale blue (`skyDots`) — a printed gradient, no band.
    const daySky = mix(POP.skyHigh, POP.sky, skyDots(at));
    // Deep in the haze, where too little of the colour is left to tell
    // its ink, the paper. Faded in over a wide band of the haze, not cut
    // in one step: a cut is a hard line across the far city that slides
    // with every move of the camera.
    const toPaper = smoothstep(HAZE_CAP - HAZE_FADE, HAZE_CAP, haze).toVar();
    day = mix(day, POP.paper, toPaper);
    // Night: the city one night blue under black dots; what the lamps
    // light a yellow pool, a window or a lamp itself the paper.
    // The night's blues part the blocks: a pitched roof the palest (the
    // sky on it), a wall the night blue, the open ground the deepest.
    const nightTone = mix(
      mix(POP.nightGround, POP.night, wall),
      POP.nightRoof,
      isRoof.mul(float(1).sub(flat))
    );
    // The dots only up close and where the night is deepest: from the air
    // a city of dots on blue is a blur.
    const nightDots = dots.mul(float(1).sub(smoothstep(120, 500, z)));
    // (a lamp's light is warm: the dusk sky's on a wall is not a lamp —
    // but a white light is one, a data mark's comet or head)
    const lamp = aaStep(0.3, l).mul(
      max(smoothstep(0.05, 0.25, warmth(b)), aaStep(0.8, l))
    );
    const nightInk = mix(
      mix(mix(nightTone, POP.black, nightDots), nightTone, aaStep(0.12, l)),
      mix(POP.yellow, POP.paper, aaStep(0.72, l)),
      lamp
    );
    // (a data mark keeps its pop ink at night: printed over the plate —
    // a mark is lit, a night-blue surface as saturated is not)
    const nightHazed = mix(
      mix(nightInk, dataInk, dataPrinted.mul(aaStep(0.25, l))),
      POP.nightHaze,
      toPaper
    );
    // The night plate is printed once the lamps are all lit (the sun rig's
    // night factor, at civil dusk), over a short step: earlier, the dusk
    // sky's light on a wall printed as lamp yellow. Until then the blue
    // hour prints in the day's inks, all of it in the shade's dots.
    const printNight = smoothstep(0.85, 1, night);
    const col = mix(day, nightHazed, printNight);
    return {
      col: mix(col, mix(daySky, POP.nightSky, printNight), sky),
      foliage: max(foliage, printed).mul(float(1).sub(sky)),
    };
  };

  // --- Film noir: hard silver-gelatine curve, smoky distance, dark sky. ---
  const noir = (p: V3, at: V2, z: F, sky: F): V3 => {
    // Dusk: the whole frame darkens as the sun sets, and a fixed S-curve
    // would crush everything under its pivot to black. The camera opens up
    // instead — an exposure gain (less on the sky, which should stay the
    // darkest thing in a night scene) and a gentler curve pivoting lower.
    let y = lumaOf(p).mul(mix(1, mix(1.6, 1.25, sky), dusk));
    // a shoulder: lit crowns keep their modelling
    y = y.div(dusk.mul(0.4).mul(y).add(1));
    // Smoke in the distance, a lighter grey than the night it sits in.
    y = mix(y, 0.58, smoothstep(300, 2600, z).mul(0.5));
    // A graduated filter: the sky darkens towards the top of the frame.
    y = mix(
      y,
      mix(y.mul(0.95), y.mul(0.35), smoothstep(0.35, 1, frameUp(at))),
      sky
    );
    // S-curve: steep mid-tones, crushed shadows, highlights that still hold.
    const pivot = mix(0.47, 0.43, dusk);
    const s = clamp(
      y
        .sub(pivot)
        .mul(mix(1.55, 1.45, dusk))
        .add(0.5),
      0,
      1
    ).toVar();
    const curved = mix(s, s.mul(s).mul(s.mul(-2).add(3)), 0.6);
    const out = max(curved.sub(0.025), 0).div(0.975);
    return vec3(out).mul(vec3(0.985, 1, 1.02));
  };

  // --- Sin City: black, white and a red that bleeds through. ---
  //
  // The scene arrives as a white card under the real sun (paper-scene.ts
  // `ink`): the foliage and the river black, the red roofs red, the sky
  // black, the haze a pale smoke. What is left in the frame is the light
  // alone, so ONE threshold cuts it into the masses of a Miller panel —
  // the sunlit faces white, everything turned away or in a cast shadow
  // black — with nothing of a roof's or a lawn's own colour to break a
  // mass into blotches, and at no blur: the edges stay as sharp as the
  // geometry, near and far.
  //
  // The haze is taken off again before the cut: the scene's range fog is
  // laid over by distance, and a threshold on the hazed light drew a band
  // across the city where the shade turned white. Its colour and its range
  // are known, so the cut is made on the light as it was under the haze —
  // until the haze is nearly all there is.
  const unhazed = (p: V3, haze: F): F =>
    // back to linear light, where the fog was mixed in, and out of the
    // fog there colour by colour (`unhaze`), before the luma is taken
    lumaOf(toPerceptual(unhaze(pow(clamp(p, 0, 1), vec3(2.2)), haze)));

  /** Does the skyline pass through this pixel? (A neighbour two pixels
   *  away is sky and this one is not.) */
  const skyRim = (at: V2): F => {
    const r = texel.mul(max(floor(pixelScale.mul(2).add(0.5)), 1));
    const p = floor(at.mul(resolution)).add(0.5).mul(texel);
    const hit = (o: V2) => isSky(p.add(o), viewDistance(p.add(o)));
    return max(
      max(hit(vec2(r.x, 0)), hit(vec2(r.x.negate(), 0))),
      max(hit(vec2(0, r.y)), hit(vec2(0, r.y.negate())))
    );
  };

  /** Sin City's rain: streaks on a grid of world DIRECTIONS (azimuth,
   *  elevation), so they stay put when the camera turns and fall with
   *  time, slanted by the wind. Each layer stands at a distance and is
   *  hidden behind anything nearer — rain in front of a wall, not painted
   *  on it. */
  const rainLayer = (
    dir: V3,
    cellsPerRad: number,
    speed: number,
    seed: number,
    pixelAngle: F
  ): F => {
    const az = atan(dir.z, dir.x);
    const el = asin(clamp(dir.y, -1, 1));
    const qy = el.mul(cellsPerRad * 0.22).add(time.mul(speed));
    const q = vec2(az.mul(cellsPerRad).add(qy.mul(0.9)), qy);
    const cell = floor(q).toVar();
    const f = fract(q).toVar();
    const present = step(0.84, hash21(cell.add(seed)));
    const x0 = hash21(cell.add(seed + 7.1))
      .mul(0.6)
      .add(0.2);
    const y0 = hash21(cell.add(seed + 3.3))
      .mul(0.4)
      .add(0.1)
      .toVar();
    const len = hash21(cell.add(seed + 9.9))
      .mul(0.22)
      .add(0.28);
    // At least a pixel wide, whatever the layer's scale.
    const w = max(0.035, pixelAngle.mul(1.1 * cellsPerRad));
    const across = float(1).sub(smoothstep(w.mul(0.5), w, abs(f.x.sub(x0))));
    const end = y0.add(len);
    const along = smoothstep(y0, y0.add(0.05), f.y).mul(
      float(1).sub(smoothstep(end.sub(0.05), end, f.y))
    );
    return present.mul(across).mul(along);
  };

  const sinCityRain = (at: V2, z: F): F => {
    const dir = viewRayWorld(at).toVar();
    const pixelAngle = length(fwidth(dir)).toVar();
    const near = rainLayer(dir, 55, 1.5, 1.7, pixelAngle).mul(step(4, z));
    const mid = rainLayer(dir, 120, 1.05, 5.3, pixelAngle).mul(step(12, z));
    // Looking steeply down (a flight over the roofs) the rain would only be
    // noise over everything: it thins out.
    const down = float(1).sub(smoothstep(0.3, 0.75, dir.y.negate()));
    return max(near.mul(0.85), mid.mul(0.55)).mul(down);
  };

  const sincity = (
    p: V3,
    at: V2,
    z: F,
    sky: F,
    surface: Surface
  ): { col: V3; white: F } => {
    const { haze } = surface;
    const ground = float(1).sub(sky);
    // A pixel's worth of blur: the shadow map's soft edge and the contact
    // shadows' noise would otherwise cut into a stipple along every shadow.
    const blurred = blurredColor(at, 1).toVar();
    const y = unhazed(blurred, haze).toVar();
    // White is what the sun reaches (`inSun`) — unless the card is dark
    // there (foliage, the river: black shapes in any light). Past where
    // the haze leaves enough light to cut, the smoke: white. Sin City
    // always draws in its own afternoon sun (render-style.ts `ownLight`):
    // its masses are the sun's, and it has no night to cut.
    const sunWhite = inSun(surface.world, surface.n, z, aaStep(0.55, y)).mul(
      aaStep(0.4, y)
    );
    const white = max(
      sunWhite,
      smoothstep(HAZE_CAP - HAZE_FADE, HAZE_CAP, haze)
    )
      .mul(ground)
      .toVar();
    // The red roofs: the only colour the card carries. Lit slopes glow,
    // slopes in shade stay a deep oxblood. Decided whole on the blur too:
    // a half-red is pink.
    const hsl = rgbToHsl(blurred).toVar();
    const hueToRed = min(hsl.x, float(1).sub(hsl.x));
    const red = float(1)
      .sub(aaStep(0.06, hueToRed))
      .mul(aaStep(0.35, hsl.y))
      .mul(step(0.04, hsl.z))
      .mul(ground)
      .toVar();
    const lit = aaStep(0.3, lumaOf(p)).toVar();
    const blood = mix(vec3(0.42, 0.015, 0.04), vec3(0.86, 0.05, 0.09), lit);
    const paper = vec3(0.97, 0.965, 0.95);
    const col = mix(mix(vec3(0.012), paper, white), blood, red);
    return { col, white: max(white.mul(float(1).sub(red)), red.mul(lit)) };
  };

  // --- Papier: a white model under real light. ---
  //
  // The scene arrives already white (paper-scene.ts swaps every surface for
  // one paper material for this style); here its light is laid out as a
  // duotone — shade a cool graphite-blue, light a warm paper — so the
  // shadows read as drawn, not photographed.
  //
  // At night the model stands on dark blue card (Tonpapier): the card's
  // own faces a deep blue, those the night sky reaches a slate, and what
  // the lamps and the lit windows light — the card glows through
  // (paper-scene.ts `windowGlow`) — warm, like a paper lantern; drawn
  // with a white pencil (`node`). The sky is the card, paler towards the
  // horizon; the far city fades into it as into the day's paper.
  const paperTone = (p: V3, at: V2, haze: F, sky: F): V3 => {
    const paper = vec3(0.972, 0.958, 0.93);
    // the light as it is under the haze: a far block keeps its shade
    // side, where the hazed light had lifted it into the paper
    const y = unhazed(p, haze).toVar();
    // Sunlit card is the paper itself; only true shade turns blue-grey.
    const t = smoothstep(0.08, 0.6, y);
    const shade = vec3(0.55, 0.58, 0.67);
    // Keep the whisper of hue the paper material lets through — and more
    // of a hue the card never carries: a data mark's tissue paper.
    const tint = p.div(max(y, 1e-3));
    const hcv = rgbToHcv(p);
    // (a cool hue only, and by day: a low sun's or a lit window's warmth
    // on the card, and the blue hour's sky light, keep their whisper)
    const saturated = smoothstep(0.3, 0.5, hcv.y.div(max(hcv.z, 1e-3)))
      .mul(float(1).sub(smoothstep(0.12, 0.45, warmth(p))))
      .mul(float(1).sub(dusk));
    const model = mix(shade, paper, t).mul(
      mix(vec3(1), tint, mix(0.35, 0.8, saturated))
    );
    // ...and a little of the haze laid back over: a model's far end is
    // paler, not gone
    // the sky through the dusk: the day's paper, a mauve card, the night's
    const daySky = mix(
      paper.mul(0.985),
      PAPER_NIGHT.dusk,
      smoothstep(0, 0.5, night)
    );
    const day = mix(mix(model, paper, haze.mul(0.2)), daySky, sky);
    const moonlit = smoothstep(
      PAPER_NIGHT.moonFrom,
      PAPER_NIGHT.moonTo,
      y.mul(PAPER_NIGHT.gain)
    );
    const lamp = nightLight(p, y.mul(PAPER_NIGHT.gain));
    const card = mix(
      mix(PAPER_NIGHT.card, PAPER_NIGHT.moon, moonlit),
      PAPER_NIGHT.glow,
      lamp
    );
    const el = viewRayWorld(at).y;
    const nightSky = mix(
      PAPER_NIGHT.horizon,
      PAPER_NIGHT.sky,
      smoothstep(0, 0.5, el)
    );
    // (the card at night knows no hue but a lamp's: the night light is
    // as blue as a cool tissue, so a data mark reads as lit card — and a
    // warm one glows like a lamp)
    const nightCol = mix(
      mix(card, PAPER_NIGHT.horizon, haze.mul(0.6)),
      nightSky,
      sky
    );
    return mix(day, nightCol, mix(night, smoothstep(0.5, 1, night), sky));
  };

  /**
   * Strich's night sky: the etcher's ruled lines — level lines of the
   * view's elevation, so a turn carries them like the sky — denser
   * towards the zenith and opening up over the horizon, where the city's
   * light is. Their spacing keeps to `HATCH_CSS` through a ladder of cells
   * that halve. A parallel view (Modell) has none: its background is the
   * sheet the plan is drawn on.
   */
  const skyHatch = (at: V2): F => {
    const ray = viewRayWorld(at);
    const el = asin(clamp(ray.y, -1, 1)).toVar();
    const fill = mix(0.16, 0.5, smoothstep(0.02, 0.7, el)).toVar();
    const rpp = max(fwidth(el), 1e-5).toVar();
    const level = log2(rpp.mul(pixelScale.mul(HATCH_CSS)).div(SKY_CELL));
    const l0 = floor(level);
    const blend = smoothstep(0.3, 0.7, level.sub(l0));
    const cell0 = exp2(l0).mul(SKY_CELL).toVar();
    const lineAt = (cell: F): F => {
      const d = abs(fract(el.div(cell)).sub(0.5));
      const pixel = rpp.div(cell);
      const half = max(fill.mul(0.5), pixel.mul(0.5));
      const aa = pixel.mul(0.7);
      return float(1).sub(smoothstep(half.sub(aa), half.add(aa), d));
    };
    const ruled = mix(lineAt(cell0), lineAt(cell0.mul(2)), blend);
    // (a parallel view's background is the sheet round the plan, no sky)
    return ruled.mul(float(1).sub(step(0.5, lens.ortho)));
  };

  // --- Strich: a pen drawing — lines, a hatch for the shade. ---
  //
  // The scene arrives as Papier's card on the plan-coloured ground
  // (paper-scene.ts, terrain-layer.ts). Nothing is shaded: the sheet is
  // white, the ground keeps its plan colours, and what lies in shade —
  // turned from the sun or in a cast shadow — is hatched with the pen at
  // a pen's angle, the hatch printed on the surface (`lines`), so it stays
  // put in a flight. That is the whole difference to Papier's tonal card
  // model: there the light is a tone, here it is a line.
  //
  // The night is an etcher's nocturne: the dark lies in an aquatint's
  // tone and is hatched over it — once where the sky's light still
  // reaches, crossed where it does not — the sky is a darker tone, ruled,
  // and only what a lamp or a lit window lights is left white, under a
  // wash of warm yellow.
  const strich = (p: V3, at: V2, z: F, sky: F, surface: Surface): V3 => {
    // (a plan has no night: in Modell's parallel view the sheet stays
    // unshaded, its lines alone; the nocturne is the perspective's)
    const plan = step(0.5, lens.ortho);
    const nightHere = night.mul(float(1).sub(plan)).toVar();
    // The light fades long before the night: from a sun at 12° to civil
    // dusk (`dusk`) the whole sheet lies in shade and the scene's light
    // dims under it. What is deep shade and what is poché is read on that
    // dimming light, not the day's — else a sunset hatches the sheet
    // crossed all over and blacks it in before the nocturne begins.
    const evening = dusk.mul(float(1).sub(plan)).toVar();
    const sheet = vec3(0.995, 0.993, 0.99);
    const y = unhazed(p, surface.haze).toVar();
    // by day in the sun or not; by night under a lamp or not
    const lamp = nightLight(p, y.mul(STRICH_NIGHT_GAIN)).toVar();
    // (a plan from a low sun on: an unshaded sheet, as one with no sun)
    const lit = mix(
      mix(inSun(surface.world, surface.n, z, aaStep(0.42, y)), lamp, nightHere),
      1,
      dusk.mul(plan)
    ).toVar();
    // the surface's colour (its hue and chroma) without the light — the
    // plan's greens and blues. The warm hues (red to yellow) are the sun's
    // colour on the white card, never a plan colour: they stay white.
    const hue = clamp(p.div(max(lumaOf(p), 1e-3)), 0, 1.25);
    const hcv = rgbToHcv(hue);
    const cool = smoothstep(0.19, 0.24, hcv.x).mul(
      float(1).sub(smoothstep(0.85, 0.92, hcv.x))
    );
    // (from dusk on the light's own blue is all the hue left: no plan
    // colour, in Modell's plan too — its night is the bare sheet — but
    // what is saturated beyond a sky's tint on white, a data mark's plan
    // colour, chroma 0.22 at its palest)
    const planned = smoothstep(0.03, 0.08, hcv.y)
      .mul(cool)
      .mul(float(1).sub(dusk.mul(float(1).sub(smoothstep(0.12, 0.2, hcv.y)))));
    const tint = mix(vec3(1), hue, planned.mul(mix(0.35, 0.85, lit)));
    const pen = mix(vec3(0.2, 0.21, 0.24), AQUATINT.pen, nightHere).toVar();
    // The hatch as a draughtsman lays it: each face of a block at its own
    // angle (the two wall directions crossed, the ground and the roofs
    // nearly level), a second layer across only where the shade is deep,
    // the ground's lighter than a wall's, and thinning with distance so an
    // overview stays a drawing, not a grey.
    const a = abs(surface.n);
    const top = step(max(a.x, a.z), a.y);
    const side = step(a.z, a.x);
    const turn = mix(
      mix(float(-Math.PI / 4), float(Math.PI / 4), side),
      float(0.3),
      top
    ).toVar();
    const thin = float(0.11);
    const first = lines(
      surface.world,
      surface.n,
      thin,
      surface.facing,
      turn,
      HATCH_CSS
    );
    // deep shade by day; from dusk on the dark of a wall the sky's light
    // leaves (what faces up — the ground, a roof under 45° — keeps one
    // layer: crossed all over, the ground read as a fence)
    const deep = mix(
      smoothstep(0.3, 0.12, y),
      float(1)
        .sub(smoothstep(0.03, 0.12, y.mul(STRICH_NIGHT_GAIN)))
        .mul(float(1).sub(top)),
      evening
    );
    const across = lines(
      surface.world,
      surface.n,
      thin,
      surface.facing,
      turn.add(Math.PI / 2),
      HATCH_CSS
    ).mul(deep);
    const strength = mix(
      mix(0.6, 0.35, top),
      mix(0.72, 0.5, top),
      nightHere
    ).mul(mix(1, 0.45, smoothstep(150, 1200, z)));
    // by night the hatch lies on the aquatint's tone, deeper where it is
    // crossed
    const ground = mix(
      tint,
      mix(AQUATINT.ground, AQUATINT.deep, deep),
      nightHere
    );
    const hatched = mix(ground, pen, max(first, across).mul(strength));
    // what the night lights: the sheet under a warm wash
    const lamplit = mix(tint, NIGHT_WASH, lamp.mul(nightHere));
    let col = mix(hatched, lamplit, lit);
    // the near-black stays black: the Schnitt's poché, not a shade
    // (from dusk on, in Modell's plan too: the evening's dark is no poché)
    const fill = float(1)
      .sub(smoothstep(0.2, 0.28, lumaOf(p)))
      .mul(float(1).sub(dusk));
    col = mix(col, vec3(0.11), fill);
    const el = viewRayWorld(at).y;
    const tone = mix(
      sheet,
      mix(AQUATINT.horizon, AQUATINT.zenith, smoothstep(0, 0.5, el)),
      nightHere
    );
    const ruled = mix(tone, pen, skyHatch(at).mul(0.6).mul(nightHere));
    return mix(col, ruled, sky);
  };

  // --- Schwarzplan: the figure black, the ground white. ---
  //
  // Only the buildings are drawn (unlit black) on the terrain's white
  // (paper-scene.ts); the light the ground still carries — shade, contact
  // shadows, the sky view — is cut away by one threshold.
  const figure = (p: V3, sky: F, line: F): V3 => {
    const ground = max(aaStep(0.16, lumaOf(p)), sky);
    // In a view from the side the blocks stand in front of each other: a
    // white hairline where one building's outline crosses another's
    // keeps them apart. On the white nothing is drawn.
    const parted = float(1)
      .sub(ground)
      .mul(smoothstep(0.25, 0.6, line));
    return mix(mix(vec3(0.07), vec3(1), ground), vec3(1), parted);
  };

  // An Fn: `If` builds into the current function's stack.
  const node = (input: V4): V4 =>
    Fn(() => {
      const at = uv().toVar();
      const z = viewDistance(at).toVar();
      // what the far-field looks read (the equivalent distance in Modell)
      const zFade = lens.fade(z).toVar();
      const sky = isSky(at, z).toVar();
      const p = toPerceptual(input.rgb).toVar();
      // The surface's slope from the depth buffer (derivatives taken here, in
      // uniform control flow): up is 1 on flat ground, 0 on a wall;
      // roofSlope is 1 on a pitched roof only. The normal is turned to face
      // the camera, whichever way the backend's screen y runs. The view
      // position comes through the inverse projection: right for the
      // perspective and the parallel camera (and its shear) alike.
      const viewPos = getViewPosition(
        at,
        texture(inputs.depth, at).r,
        inverseProjection
      );
      const n0 = normalize(cross(dFdx(viewPos), dFdy(viewPos)));
      const normal = select(dot(n0, viewPos).greaterThan(0), n0.negate(), n0);
      const up = dot(normal, upView).toVar();
      const roofSlope = smoothstep(0.2, 0.35, up)
        .mul(float(1).sub(smoothstep(0.92, 0.97, up)))
        .toVar();
      const world = viewToWorld.mul(viewPos).add(eye).toVar();
      const surface: Surface = {
        world,
        n: normalize(viewToWorld.mul(normal)).toVar(),
        up,
        roofSlope,
        haze: fogFactorAt(fog, world, viewPos).mul(float(1).sub(sky)).toVar(),
        // the view ray through this pixel from the projection itself:
        // right for the parallel and the sheared camera too
        facing: abs(
          dot(
            normal,
            normalize(
              getViewPosition(at, float(1), inverseProjection).sub(
                getViewPosition(at, float(0), inverseProjection)
              )
            )
          )
        ).toVar(),
      };
      const inked = inkLines(at, z, up, surface.haze);
      const line = inked.line.mul(ink).toVar();
      const silhouette = inked.silhouette.toVar();
      const out = vec3(0).toVar();
      If(mode.lessThan(1.5), () => {
        const printed = comic(at, zFade, sky, surface);
        // a crown keeps its outline only (see `comic`)
        const stroke = line.mul(mix(1, silhouette, printed.foliage));
        out.assign(mix(printed.col, POP.black, clamp(stroke, 0, 1)));
      })
        .ElseIf(mode.lessThan(2.5), () => {
          out.assign(
            mix(noir(p, at, zFade, sky), vec3(0.03), clamp(line, 0, 1))
          );
        })
        .ElseIf(mode.greaterThan(5.5), () => {
          out.assign(figure(p, sky, line.mul(silhouette)));
        })
        .ElseIf(mode.greaterThan(4.5), () => {
          out.assign(
            mix(
              strich(p, at, zFade, sky, surface),
              vec3(0.11, 0.115, 0.13),
              clamp(line, 0, 1)
            )
          );
        })
        .ElseIf(mode.greaterThan(3.5), () => {
          // by night a white pencil on the dark card
          out.assign(
            mix(
              paperTone(p, at, surface.haze, sky),
              mix(vec3(0.22, 0.23, 0.28), PAPER_NIGHT.pencil, night),
              clamp(line, 0, 1).mul(mix(0.92, 0.7, night))
            )
          );
        })
        .Else(() => {
          const { col, white } = sincity(p, at, zFade, sky, surface);
          const rain = sinCityRain(at, zFade).toVar();
          // On white, only the big silhouettes are inked — in solid black: a
          // half-weight stroke would be grey, and Sin City has no grey. On a
          // lit wall the rain barely shows.
          const onWhite = mix(
            mix(col, vec3(0), smoothstep(0.16, 0.3, line)),
            vec3(0),
            rain.mul(0.18)
          );
          // On black, white cuts: the skyline against the night, and a big
          // silhouette against a black behind it — without them a tree
          // before a dark wall is one black mass.
          const cut = max(
            skyRim(at),
            smoothstep(0.35, 0.6, line.mul(silhouette))
          ).mul(float(1).sub(sky));
          const onBlack = mix(
            mix(col, vec3(0.93), cut.mul(step(0.001, ink))),
            vec3(0.93),
            rain
          );
          out.assign(select(white.greaterThan(0.5), onWhite, onBlack));
        });
      return vec4(toLinear(out), input.a);
    })();

  return {
    node,
    setStyle: (style) => {
      mode.value = style.shaderMode;
      const def = PENS[style.shaderMode];
      if (!def) {
        return;
      }
      pen.sil.value.set(...def.sil);
      pen.creaseW.value = def.creaseW;
      pen.sway.value = def.sway;
      pen.tremor.value = def.tremor;
      pen.misregister.value.set(...def.misregister);
      pen.weight.value.set(...def.weight);
      pen.lifts.value = def.lifts;
      pen.detail.value = def.detail;
      pen.hand.value = def.hand;
      pen.farInk.value = def.farInk;
    },
    setInk: (value) => {
      ink.value = Math.max(value, 0);
    },
    setSunAltitude: (altitudeDeg) => {
      const t = Math.min(Math.max((12 - altitudeDeg) / 18, 0), 1);
      dusk.value = t * t * (3 - 2 * t);
    },
    captureFog: () => {
      frameFog.value.copy(fog.color.value);
    },
    dispose: () => {
      shadowStandIn.dispose();
    },
    update: (pixelRatio, size) => {
      skyZ.value = camera.far * SKY_FAR_SHARE;
      pixelScale.value = pixelRatio;
      resolution.value.copy(size);
      // The view ray per uv and world up in view space, for the roof slope
      // and the rain's directions.
      // From the projection itself (the lens's stand-in holds the active
      // camera's): a perspective's tangents; unused in a parallel view.
      const e = camera.projectionMatrix.elements;
      projScale.value.set(1 / (e[0] || 1), 1 / (e[5] || 1));
      upView.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
      viewToWorld.value.setFromMatrix4(camera.matrixWorld);
      eye.value.setFromMatrixPosition(camera.matrixWorld);
      const map = inputs.sunShadow.depth();
      for (const read of shadowReads) {
        if (map && read.value !== map) {
          read.value = map;
        }
      }
      shadowReady.value = map ? 1 : 0;
    },
  };
}

/** The pens by mode, exported for its test alone: a style that inks
 *  without a pen would draw with the last style's lines (`setStyle`). */
export const STYLE_PENS: Readonly<Record<number, Readonly<Pen>>> = PENS;
