import {
  abs,
  dot,
  float,
  Fn,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  normalize,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { F, V2, V3 } from "./shader-chunks";

/**
 * The wind on open water, drawn rather than simulated: one wave field every
 * water surface reads — the river and lake sheet (water-layer.ts) and the
 * fountains' basins (monument-layer.ts) — so a ripple is the same thing
 * everywhere, only its size differs (`RIVER_WAVES`, `BASIN_WAVES`).
 *
 * An abstraction in the scene's pastel manner, not a sea:
 * - two layers of gradient noise stretched across the wind, so a crest is
 *   a long soft stroke rather than a blob, each drifting downwind at its
 *   own speed; the finer one bent by the coarser's value (a warp for free),
 *   so no stroke runs straight and nothing repeats — no crossing sines,
 *   whose interference tiled the river from any height;
 * - `stroke`: a thin band on a crest's lee side where the field crosses
 *   one level — the water's drawn line, a light arc lit by the sky and,
 *   on the sun's path, by the sun (water-layer.ts; a basin is too small
 *   for it and reads the slope alone);
 * - gusts: a noise tens of metres wide that drifts with the wind and
 *   leaves calm, mirroring patches beside rough ones, where the strokes
 *   thin out (cat's paws, the unevenness that reads from afar);
 * - each layer, and the strokes, fading out where its wavelength spans
 *   fewer than a few pixels (`fwidth`), so far water lies calm and mirrors
 *   the sky instead of shimmering grey.
 *
 * Three noise reads a pixel (the realistic five-octave field before it
 * took eight). Everything is a function of the position and the clock
 * alone: two tiles' sheets agree at their seam, and so do a level's two
 * meshes. The hash is sin-free (stable at the data frame's kilometres).
 * Branch-free: the fades read `fwidth`, which needs uniform control flow.
 */

/** A wave field's size. */
export interface WaveScale {
  /** the coarse layer's wavelength across a crest (m); its strokes run
   *  `stretch` times longer along it, the fine layer is a share of it */
  wavelength: number;
  /** the gusts' patches (m across) */
  gusts: number;
  /** the slope a gust gives the water (m/m) */
  steepness: number;
  /** how much longer a crest runs than the wave is wide */
  stretch: number;
  /** how calm the water is between gusts (0 a mirror … 1 as rough) */
  calm: number;
}

/** The Elbe, a lake: strokes of a dozen metres to thirty-odd along their
 *  crest under gusts eighty metres across. */
export const RIVER_WAVES: WaveScale = {
  wavelength: 12,
  gusts: 80,
  steepness: 0.4,
  stretch: 2.6,
  calm: 0.3,
};

/** A fountain's basin: ripples a span across and hardly longer (a basin
 *  is a few metres), the wind's patch a few metres. */
export const BASIN_WAVES: WaveScale = {
  wavelength: 1.2,
  gusts: 5,
  steepness: 0.32,
  stretch: 1.3,
  calm: 0.45,
};

/** The two layers: wavelength (a share of the scale's), the share of the
 *  steepness, the drift's speed (m/s per metre of wavelength, slowed: the
 *  eye reads real speeds as a slide) and the turn off the wind (rad). */
const LAYERS = [
  { size: 1, share: 0.6, speed: 0.07, turn: 0 },
  { size: 0.37, share: 0.4, speed: 0.13, turn: 0.23 },
] as const;
/** How far the coarse layer bends the fine one (its noise units). */
const WARP = 0.8;
/** The stroke's level in the field (about −0.7 … 0.7) and its half-width. */
const STROKE_LEVEL = 0.16;
const STROKE_HALF = 0.03;
/** The summed field's slope (before gusts and steepness) below which a
 *  stroke's side is undecided. */
const LEE_SOFT = 0.05;
/** The wind's heading (rad, data frame) and its gusts' drift (m/s). */
const WIND = 0.42;
const GUST_DRIFT = 1.1;
/** A layer fades out between these wavelengths per pixel. */
const FADE_PX: [number, number] = [6, 2.5];

/** Dave Hoskins' hash22 in −1…1 (sin-free: stable at large coordinates). */
const hash22 = Fn(
  ([p]: [V2]): V2 => {
    const a = fract(
      vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973))
    ).toVar();
    a.addAssign(dot(a, a.yzx.add(33.33)));
    return fract(vec2(a.x.add(a.y), a.x.add(a.z)).mul(a.zy))
      .mul(2)
      .sub(1);
  },
  { p: "vec2", return: "vec2" }
);

/** Gradient noise at `p` with its derivatives (Quílez): (value, ∂/∂x,
 *  ∂/∂y), the value in about −0.7…0.7. */
const gradientNoise = Fn(
  ([p]: [V2]): V3 => {
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f
      .mul(f)
      .mul(f)
      .mul(f.mul(f.mul(6).sub(15)).add(10))
      .toVar();
    const du = f
      .mul(f)
      .mul(f.mul(f.sub(2)).add(1))
      .mul(30)
      .toVar();
    const ga = hash22(i).toVar();
    const gb = hash22(i.add(vec2(1, 0))).toVar();
    const gc = hash22(i.add(vec2(0, 1))).toVar();
    const gd = hash22(i.add(vec2(1, 1))).toVar();
    const va = dot(ga, f).toVar();
    const vb = dot(gb, f.sub(vec2(1, 0))).toVar();
    const vc = dot(gc, f.sub(vec2(0, 1))).toVar();
    const vd = dot(gd, f.sub(vec2(1, 1)));
    const k = va.sub(vb).sub(vc).add(vd).toVar();
    const value = va
      .add(u.x.mul(vb.sub(va)))
      .add(u.y.mul(vc.sub(va)))
      .add(u.x.mul(u.y).mul(k));
    const slope = ga
      .add(u.x.mul(gb.sub(ga)))
      .add(u.y.mul(gc.sub(ga)))
      .add(u.x.mul(u.y).mul(ga.sub(gb).sub(gc).add(gd)))
      .add(du.mul(u.yx.mul(k).add(vec2(vb, vc)).sub(va)));
    return vec3(value, slope);
  },
  { p: "vec2", return: "vec3" }
);

/** The water's slope, gusts and drawn strokes. */
export interface WaveField {
  /** the surface's slope, data frame (∂height/∂x, ∂height/∂y; m/m) */
  slope: V2;
  /** 0 between gusts … 1 in one */
  gust: F;
  /** 0 … 1 on a crest's drawn line */
  stroke: F;
}

/**
 * The wave field at data-frame `xy` (m) at time `t` (s): two stretched
 * layers' slopes summed, turned back to the data frame, scaled by the gust
 * over the spot and faded by the pixel's footprint; the stroke where their
 * sum crosses STROKE_LEVEL.
 */
export function waves(xy: V2, t: F, scale: WaveScale): WaveField {
  const { wavelength, gusts, steepness, stretch, calm } = scale;
  const wind = vec2(Math.cos(WIND), Math.sin(WIND));
  // the gusts: a wide noise drifting downwind, its value 0…1
  const gustAt = gradientNoise(
    xy.div(gusts).sub(wind.mul(t.mul(GUST_DRIFT / gusts)))
  ).x;
  const gust = smoothstep(-0.3, 0.4, gustAt).toVar();
  // metres per pixel, for the fades
  const fw = fwidth(xy);
  const px = max(fw.x, fw.y).toVar();
  let slope: V2 = vec2(0, 0);
  let height: F = float(0);
  let warp: F = float(0);
  // the warp's gradient (per metre): the finer layer reads its noise at
  // c + warp, so its slope carries ∂warp too
  let warpSlope: V2 = vec2(0, 0);
  let near: F = float(1);
  for (const [i, layer] of LAYERS.entries()) {
    const size = wavelength * layer.size;
    const heading = WIND + layer.turn;
    const along = vec2(Math.cos(heading), Math.sin(heading));
    const across = vec2(-Math.sin(heading), Math.cos(heading));
    // the layer's frame: a wave per `size` downwind, `stretch` times longer
    // along its crest, drifting downwind
    const a = dot(xy, along)
      .sub(t.mul(layer.speed * size))
      .div(size);
    const c = dot(xy, across).div(size * stretch);
    const n = gradientNoise(vec2(a, c.add(warp))).toVar();
    const fade = smoothstep(
      size / FADE_PX[0],
      size / FADE_PX[1],
      px
    ).oneMinus();
    // back to the data frame: ∂/∂xy = along·∂a/size + across·(∂c/(size·S)
    // + ∂warp)
    const d = along
      .mul(n.y.div(size))
      .add(across.mul(n.z.div(size * stretch)))
      .add(warpSlope.mul(n.z))
      .toVar();
    slope = slope.add(d.mul(fade.mul(layer.share * size)));
    // faded like the slope: an octave too fine for the pixel would alias
    // into the stroke's level
    height = height.add(n.x.mul(fade.mul(layer.share)));
    warp = n.x.mul(WARP);
    warpSlope = d.mul(WARP);
    if (i === 0) {
      near = fade;
    }
  }
  // the drawn line: a thin band where the field crosses its level, as wide
  // on screen as it may be without aliasing, thinned between gusts
  const h = height.toVar();
  const band = smoothstep(
    STROKE_HALF,
    max(fwidth(h).mul(1.5), 1e-4).add(STROKE_HALF),
    abs(h.sub(STROKE_LEVEL))
  ).oneMinus();
  // only the crest's lee half: an open arc drawn downwind, never a ring
  // round a hump; where the water lies level (a crest's top, a calm
  // patch) the direction is undecided and the stroke thins out smoothly
  // rather than flickering
  const lee = smoothstep(
    -0.1,
    0.5,
    dot(slope, wind).negate().div(length(slope).add(LEE_SOFT))
  );
  const stroke = band
    .mul(lee)
    .mul(near)
    .mul(mix(0.45, 1, gust));
  return {
    slope: slope.mul(mix(calm, 1, gust).mul(steepness)),
    gust,
    stroke,
  };
}

/** The surface's normal (Y-up world) for a data-frame `slope`, its tilt
 *  scaled by `k`. */
export function waveNormal(slope: V2, k = 1): V3 {
  return normalize(vec3(slope.x.mul(-k), 1, slope.y.mul(k)));
}

/** A ripple's brightness for a shimmer (0…1): how far the surface tilts. */
export function waveTilt(slope: V2): F {
  return smoothstep(0, 0.25, abs(slope.x).add(abs(slope.y)));
}
