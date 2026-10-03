import { Matrix3, Vector2, Vector3 } from "three/webgpu";
import {
  abs,
  asin,
  atan,
  clamp,
  cross,
  dFdx,
  dFdy,
  distance,
  dot,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  getViewPosition,
  If,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { DepthTexture } from "three/webgpu";
import type { RenderStyleDef } from "@/lib/city/render-style";
import type { SceneFog } from "./height-fog";
import type { F, V2, V3, V4 } from "./shader-chunks";
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

/** The sky dome writes no depth (far = 6000). */
const SKY_Z = 4000;
/** A parallel view's background: the cleared depth (its geometry lies well
 *  inside the depth range, which is linear there). */
const SKY_DEPTH = 0.9999;
/** Slope noise floor, relative to w0. */
const CREASE_FLOOR = 0.0012;
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
}

const PENS: Record<number, Pen> = {
  // Comic: a loaded brush pen, wavy, thick and thin, out of register.
  1: {
    sil: [0.012, 0.045],
    creaseW: 0.7,
    sway: 4,
    tremor: 1.3,
    misregister: [1.3, -0.9],
    weight: [0.55, 2.5],
    lifts: 1,
    detail: 260,
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
  },
  // Sin City only inks the big jumps — a building standing clear of what
  // is behind it — never a tree lobe over the next one; the folds of a
  // building (eaves, corners, a hall's vaults) out to a few hundred metres.
  3: {
    sil: [0.09, 0.22],
    creaseW: 0.55,
    sway: 2,
    tremor: 0,
    misregister: [0, 0],
    weight: [0.8, 1.6],
    lifts: 0,
    detail: 480,
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
    detail: 420,
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
    detail: 600,
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

/** `aaStep` with a floor on its width: soft where the caller asks for it. */
function softStep(edge: number, x: F, minWidth: F): F {
  const w = max(fwidth(x), max(minWidth, 1e-4));
  return smoothstep(float(edge).sub(w), float(edge).add(w), x);
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

function hslToRgb(hsl: V3): V3 {
  const h6 = hsl.x.mul(6);
  const rgb = clamp(
    vec3(
      abs(h6.sub(3)).sub(1),
      float(2).sub(abs(h6.sub(2))),
      float(2).sub(abs(h6.sub(4)))
    ),
    0,
    1
  );
  const c = float(1)
    .sub(abs(hsl.z.mul(2).sub(1)))
    .mul(hsl.y);
  return rgb.sub(0.5).mul(c).add(hsl.z);
}

/**
 * The frame's uv runs from the top-left corner (three's full-screen quad),
 * where the GLSL's ran from the bottom-left: how far up the frame a uv is,
 * and its normalised device coordinates (y up) for view rays.
 */
const frameUp = (at: V2): F => float(1).sub(at.y);
const ndcOf = (at: V2): V2 => vec2(at.x, frameUp(at)).mul(2).sub(1);

/** Saturation that rebuilds a tone from a chroma (HSL's explodes near white). */
const satFor = (chroma: F, lightness: F): F =>
  min(
    chroma.div(
      float(1)
        .sub(abs(lightness.mul(2).sub(1)))
        .add(1e-3)
    ),
    1
  );

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
}

export interface Stylize {
  /** The styled frame over `input` (the colour at this pixel). */
  node: (input: V4) => V4;
  /** Sets the mode and pen of a style (no rebuild: uniforms). */
  setStyle: (style: RenderStyleDef) => void;
  /** Outline strength, 0..~1.25 (the ink slider times the style's weight). */
  setInk: (value: number) => void;
  /**
   * The sun's altitude, for Film noir's exposure: the light starts to go
   * well before sunset (the sun's intensity ramps below ~12°), so the gain
   * follows from there to civil dusk (-6°), where the lamps are all lit.
   */
  setSunAltitude: (altitudeDeg: number) => void;
  /** Per frame: the camera's frame and the drawing buffer's pixels. */
  update: (pixelRatio: number, size: Vector2) => void;
}

export function createStylize(inputs: StylizeInputs): Stylize {
  const { lens, fog, litAt } = inputs;
  const camera = lens.camera;
  const ortho = lens.ortho.greaterThan(0.5);
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const mode = uniform(1);
  const ink = uniform(0.7);
  const dusk = uniform(0);
  const pixelScale = uniform(1);
  const resolution = uniform(new Vector2(1, 1));
  const upView = uniform(new Vector3(0, 1, 0));
  const projScale = uniform(new Vector2(1, 1));
  const viewToWorld = uniform(new Matrix3());
  const pen = {
    sil: uniform(new Vector2(0.012, 0.045)),
    creaseW: uniform(0.7),
    sway: uniform(4),
    tremor: uniform(1.3),
    misregister: uniform(new Vector2(1.3, -0.9)),
    weight: uniform(new Vector2(0.55, 2.5)),
    lifts: uniform(1),
    detail: uniform(260),
  };
  const texel = vec2(1).div(resolution);
  const fogNear = fog.near;
  const fogFar = max(fog.far, fog.near.add(1));

  const viewDistance = (at: V2): F =>
    lens.distance(texture(inputs.depth, at).r);
  /** Is the pixel at `at` (whose distance is `z`) sky — the background? */
  const isSky = (at: V2, z: F): F =>
    select(ortho, step(SKY_DEPTH, texture(inputs.depth, at).r), step(SKY_Z, z));

  /**
   * What the stencil differences: in perspective w = 1/z, which is affine
   * in screen space across a plane; in a parallel view z itself is. The
   * relative jump divides by `norm`: w0 in perspective (Δz/z), the
   * equivalent distance in a parallel view — so a step inks as it would
   * seen from that far.
   */
  const metric = (z: F): F => select(ortho, z, float(1).div(max(z, 1e-3)));

  /** One axis of the stencil: (silhouette, crease) in 0..1. The caller
   *  widens the silhouette ramp with distance, so far away only big jumps
   *  (a building over the street) are inked, not every crown on a lawn. */
  const edgeAxis = (at: V2, s: V2, w0: F, norm: F, sil: V2): V2 => {
    const wa = metric(viewDistance(at.sub(s)));
    const wb = metric(viewDistance(at.add(s)));
    const lap = abs(wa.add(wb).sub(w0.mul(2)));
    const grad = max(abs(wb.sub(w0)), abs(w0.sub(wa)));
    const jump = lap.div(norm);
    const fold = lap.div(grad.add(norm.mul(CREASE_FLOOR)));
    const silhouette = smoothstep(sil.x, sil.y, jump);
    const crease = smoothstep(0.35, 0.8, fold).mul(
      smoothstep(0.0004, 0.0016, jump)
    );
    return vec2(silhouette, crease);
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
      max(edgeAxis(p, sx, w0, norm, sil), edgeAxis(p, sy, w0, norm, sil)),
      max(edgeAxis(p, sd, w0, norm, sil), edgeAxis(p, sa, w0, norm, sil))
    );
  };

  /** Ink coverage at `at` (0 = paper, 1 = a full stroke) and the
   *  silhouette's share of it. */
  const inkLines = (at: V2, z0: F, up: F): { line: F; silhouette: F } => {
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
    let widthPx = pixelScale.mul(mix(pen.weight.x, pen.weight.y, pressure));
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
    line = line.mul(float(1).sub(smoothstep(fogNear, fogFar, zf).mul(0.9)));
    line = line.mul(mix(1, 0.45, smoothstep(300, 2400, zf)));
    // Pressure also lightens the ink a little, and the pen lifts off.
    line = line.mul(mix(0.72, 1, smoothstep(0.15, 0.55, pressure)));
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
  const blurredColor = (at: V2, radiusCss: number): V3 => {
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
    let sum = toPerceptual(litAt(at)).mul(2);
    for (const tap of taps) {
      sum = sum.add(toPerceptual(litAt(tap)));
    }
    return sum.div(10);
  };

  // --- Comic: flat colour bands, a halftone in the shade, warm paper. ---
  const comic = (p: V3, at: V2, z: F, sky: F): V3 => {
    // In the haze the bands give way to the plain wash: cut into four
    // tones, a fogged skyline breaks into white blotches. Haze is
    // recognised by its colour — distance fog, valley fog and the site-edge
    // fade all fade towards the one fog colour — and by distance.
    // reason: a colour uniform is a vec3 in the graph; its type says Color.
    const fogP = toPerceptual(fog.color as unknown as V3);
    const fogness = float(1)
      .sub(smoothstep(0.03, 0.26, distance(blurredColor(at, 4), fogP)))
      .mul(smoothstep(80, 250, z))
      .toVar();
    const haze = max(
      smoothstep(fogNear, mix(fogNear, fogFar, 0.7), z),
      smoothstep(0.45, 0.9, fogness)
    ).toVar();
    // ...and on the way into it, and in the distance generally, the band
    // edges soften — a background is painted looser — so a pale, noisy far
    // field cannot break into blotches.
    const farField = smoothstep(180, 600, z);
    const bandSoft = max(fogness.mul(0.12), farField.mul(0.1));
    // The bands are cut on the blurred lightness (flat areas, no flecks);
    // the hue and chroma come from the pixel itself.
    const hsl = rgbToHsl(p).toVar();
    const l = rgbToHsl(blurredColor(at, 2.5)).z.toVar();
    // Four flat tones; the steps are where a colourist would cut.
    const t1 = softStep(0.3, l, bandSoft).toVar();
    const t2 = softStep(0.52, l, bandSoft);
    const t3 = softStep(0.74, l, bandSoft).toVar();
    const tone = t1
      .mul(0.24)
      .add(t2.mul(0.22))
      .add(t3.mul(0.19))
      .add(0.24)
      .toVar();
    // Keep what the tone is made of: its hue and a lifted CHROMA (HSL
    // saturation explodes as lightness nears white — the pale sky around
    // the sun reads as S ≈ 1 — so the band is rebuilt from the chroma).
    const chroma = rgbToHcv(p).y.mul(1.3).add(0.015).toVar();
    const paper = vec3(0.975, 0.95, 0.89);
    // The top band leans into the paper — the white of the page.
    const flat = mix(
      hslToRgb(vec3(hsl.x, satFor(chroma, tone), tone)),
      paper,
      t3.mul(0.3).mul(float(1).sub(farField))
    ).toVar();
    // Ben-Day dots in the darkest band, on a 45° grid in CSS pixels.
    const css = at.mul(resolution).div(pixelScale);
    const g = vec2(
      css.x.add(css.y).mul(0.7071),
      css.y.sub(css.x).mul(0.7071)
    ).div(5);
    const d = length(fract(g).sub(0.5)).toVar();
    const aa = max(fwidth(d), 1e-3);
    // Sky and deep haze: an unbanded wash — a band edge across the open sky
    // draws a hard ellipse round the zenith that no colourist would cut.
    const wash = mix(hslToRgb(vec3(hsl.x, satFor(chroma, l), l)), paper, 0.18);
    const shade = float(1).sub(t1);
    const radius = smoothstep(0.3, 0.1, l).mul(0.18).add(0.22);
    // The halftone is a close-up device: from a rooftop or the air it would
    // fleck every crown, so it is gone by ~200 m.
    const dots = float(1)
      .sub(smoothstep(radius.sub(aa), radius.add(aa), d))
      .mul(shade)
      .mul(float(1).sub(smoothstep(60, 200, z)));
    const banded = mix(flat, flat.mul(0.45), dots.mul(0.8));
    return select(
      sky.greaterThan(0.5).or(haze.greaterThan(0.999)),
      wash,
      mix(banded, wash, haze)
    );
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

  // --- Sin City: two inks and a red that bleeds through. ---
  //
  // Masses, not contours. The luminance is read through a small blur (nine
  // taps, ~3 CSS px) before its one threshold, so the fine shading texture
  // of the crowns, the AO and the shadow-map penumbra cannot break a mass
  // into stipple. Foliage and meadow are pushed towards black (Sin City's
  // trees are black shapes, their sunlit tops cut out in white), and so is
  // the river: water at night is black, only its glints stay white.
  const sinCityLuma = (blurred: V3, up: F, upRough: F): F => {
    const green = blurred.g.sub(max(blurred.r, blurred.b));
    const blue = blurred.b.sub(max(blurred.r, blurred.g));
    // Crowns go black; open grass (facing up) keeps its light — a park of
    // black meadows read as one black hole. Open grass is flat as well as
    // facing up: a crown's sunlit top also faces up, but its slope changes
    // from pixel to pixel.
    const grass = smoothstep(0.85, 0.96, up).mul(
      float(1).sub(smoothstep(0.03, 0.1, upRough))
    );
    const crown = float(1).sub(grass);
    return (
      lumaOf(blurred)
        .sub(crown.mul(smoothstep(0.01, 0.05, green)).mul(0.36))
        // The pastel river is only faintly blue (b − max(r, g) ≈ 0.02 where
        // the paths and roads are ≤ 0), hence the low, narrow window.
        .sub(smoothstep(0.006, 0.02, blue).mul(0.42))
    );
  };

  /** The neighbourhood's brightness: eight taps on a wide ring (~48 CSS
   *  px). Sin City's threshold leans towards it, so a dark view still
   *  splits into light and dark, and a bright one keeps its shadows. */
  const localLuma = (at: V2): F => {
    const r = texel.mul(pixelScale.mul(48));
    let sum: F = float(0);
    for (let i = 0; i < 8; i++) {
      const a = i * 0.7854 + 0.39;
      const tap = at.add(r.mul(vec2(Math.cos(a), Math.sin(a))));
      sum = sum.add(lumaOf(toPerceptual(litAt(tap))));
    }
    return sum.div(8);
  };

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
    // every ray of a parallel view runs the same way
    const ray = select(
      ortho,
      vec3(0, 0, -1),
      normalize(vec3(ndcOf(at).mul(projScale), -1))
    );
    const dir = normalize(viewToWorld.mul(ray)).toVar();
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
    roofSlope: F,
    up: F
  ): { col: V3; white: F } => {
    const blurred = blurredColor(at, 3).toVar();
    let y = sinCityLuma(blurred, up, fwidth(up));
    // Night takes the distance — into the near-black, not into nothing, so
    // a far block keeps its shape.
    const far = smoothstep(700, 2600, z).mul(0.55);
    y = y.mul(float(1).sub(far)).toVar();
    // The threshold leans towards the neighbourhood's own brightness —
    // only a third of the way: further, and a meadow a shade darker than
    // its paths already fell below it (a park in black and white blotches).
    const t = clamp(
      mix(0.38, localLuma(at).mul(float(1).sub(far)), 0.33),
      0.24,
      0.56
    ).toVar();
    // Four inks, not two: black, a near-black, a near-white and white. The
    // in-between tones carry shade and turned-away walls without going grey.
    const b1 = aaStep(t.sub(0.13), y);
    const b2 = aaStep(t, y).toVar();
    const b3 = aaStep(t.add(0.15), y);
    const tone = b1.mul(0.13).add(b2.mul(0.63)).add(b3.mul(0.175)).add(0.012);
    const ground = float(1).sub(sky);
    const paper = vec3(0.96, 0.955, 0.94);
    const col = paper.mul(tone.div(0.947)).mul(ground);
    // Selective colour: the red roofs. Gated on the surface's slope (a
    // pitched roof, from the depth buffer's normal), the colour window can
    // be wide — every terracotta, brick and rust-brown roof — without the
    // sand, the paths or a warm facade turning red with it. Decided on the
    // blurred colour: a roof's aerial-photo colour varies pixel by pixel,
    // and per pixel the red came out as grain.
    const hsl = rgbToHsl(blurred).toVar();
    const hueToRed = min(hsl.x, float(1).sub(hsl.x));
    const redMask = float(1)
      .sub(smoothstep(0.075, 0.11, hueToRed))
      .mul(smoothstep(0.05, 0.13, hsl.y))
      .mul(smoothstep(0.08, 0.18, hsl.z))
      .mul(roofSlope)
      .toVar();
    // A cut-out, not a tint: the red is on or off (a half-red is pink). Cut
    // crisp, one pixel wide: a soft mask drew pink airbrush streaks where a
    // roof's colour or slope drifts across the threshold.
    const red = aaStep(0.45, redMask).mul(ground).toVar();
    // Lit slopes glow, slopes in shade stay a deep oxblood.
    const lit = aaStep(0.36, lumaOf(p)).toVar();
    const blood = mix(vec3(0.42, 0.015, 0.04), vec3(0.84, 0.06, 0.1), lit);
    const white = max(b2.mul(ground), red.mul(lit));
    return { col: mix(col, blood, red), white };
  };

  // --- Papier: a white model under real light. ---
  //
  // The scene arrives already white (paper-scene.ts swaps every surface for
  // one paper material for this style); here its light is laid out as a
  // duotone — shade a cool graphite-blue, light a warm paper — so the
  // shadows read as drawn, not photographed.
  const paperTone = (p: V3, sky: F): V3 => {
    const paper = vec3(0.972, 0.958, 0.93);
    const y = lumaOf(p);
    // Sunlit card is the paper itself; only true shade turns blue-grey.
    const t = smoothstep(0.08, 0.6, y);
    const shade = vec3(0.55, 0.58, 0.67);
    // Keep the whisper of hue the paper material lets through.
    const tint = p.div(max(y, 1e-3));
    const model = mix(shade, paper, t).mul(mix(vec3(1), tint, 0.35));
    return mix(model, paper.mul(0.985), sky);
  };

  // --- Strich: the white model and the plan's ground, in two washes. ---
  //
  // The scene arrives as Papier's card on the plan-coloured ground
  // (paper-scene.ts, terrain-layer.ts). The light is laid out as on a
  // drawn plan: sunlit is the sheet itself, everything in shade one light
  // grey wash over the colour — no gradient, no photograph.
  const strich = (p: V3, sky: F): V3 => {
    const sheet = vec3(0.992, 0.99, 0.985);
    const y = lumaOf(p).toVar();
    const lit = aaStep(0.42, y).toVar();
    // the surface's colour (its hue and chroma) without the light — in the
    // shade mostly the sky's blue, so there only a trace of it is kept
    const hue = clamp(p.div(max(y, 1e-3)), 0, 1.25);
    const tint = mix(vec3(1), hue, mix(0.3, 1, lit));
    const wash = mix(0.8, 0.975, lit);
    // the near-black stays black: the Schnitt's poché, not a shade
    const fill = float(1).sub(smoothstep(0.2, 0.28, y));
    return mix(mix(tint.mul(wash), vec3(0.11), fill), sheet, sky);
  };

  // --- Schwarzplan: the figure black, the ground white. ---
  //
  // Only the buildings are drawn (unlit black) on the terrain's white
  // (paper-scene.ts); the light the ground still carries — shade, contact
  // shadows, the sky view — is cut away by one threshold.
  const figure = (p: V3, sky: F): V3 => {
    const ground = aaStep(0.16, lumaOf(p));
    return mix(vec3(0.07), vec3(1), max(ground, sky));
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
      const inked = inkLines(at, z, up);
      const line = inked.line.mul(ink).toVar();
      const silhouette = inked.silhouette.toVar();
      const out = vec3(0).toVar();
      If(mode.lessThan(1.5), () => {
        out.assign(
          mix(
            comic(p, at, zFade, sky),
            vec3(0.13, 0.1, 0.12),
            clamp(line, 0, 1)
          )
        );
      })
        .ElseIf(mode.lessThan(2.5), () => {
          out.assign(
            mix(noir(p, at, zFade, sky), vec3(0.03), clamp(line, 0, 1))
          );
        })
        .ElseIf(mode.greaterThan(5.5), () => {
          out.assign(figure(p, sky));
        })
        .ElseIf(mode.greaterThan(4.5), () => {
          out.assign(
            mix(strich(p, sky), vec3(0.11, 0.115, 0.13), clamp(line, 0, 1))
          );
        })
        .ElseIf(mode.greaterThan(3.5), () => {
          out.assign(
            mix(
              paperTone(p, sky),
              vec3(0.22, 0.23, 0.28),
              clamp(line, 0, 1).mul(0.92)
            )
          );
        })
        .Else(() => {
          const { col, white } = sincity(p, at, zFade, sky, roofSlope, up);
          const rain = sinCityRain(at, zFade).toVar();
          // On white, only the big silhouettes are inked — in solid black: a
          // half-weight stroke would be grey, and Sin City has no grey. On a
          // lit wall the rain barely shows.
          const onWhite = mix(
            mix(col, vec3(0), smoothstep(0.3, 0.55, line)),
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
    },
    setInk: (value) => {
      ink.value = Math.max(value, 0);
    },
    setSunAltitude: (altitudeDeg) => {
      const t = Math.min(Math.max((12 - altitudeDeg) / 18, 0), 1);
      dusk.value = t * t * (3 - 2 * t);
    },
    update: (pixelRatio, size) => {
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
    },
  };
}

/** The live uniforms a caller may want in tests (the pens by mode). */
export const STYLE_PENS: Readonly<Record<number, Readonly<Pen>>> = PENS;
