import {
  abs,
  dot,
  Fn,
  floor,
  fract,
  fwidth,
  max,
  mix,
  normalize,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { F, V2, V3 } from "./shader-chunks";

/**
 * The wind on open water: one wave field every water surface reads — the
 * river and lake sheet (water-layer.ts) and the fountains' basins
 * (monument-layer.ts) — so a ripple is the same thing everywhere, only its
 * size differs (`RIVER_WAVES`, `BASIN_WAVES`).
 *
 * It replaces crossing sine waves, whose interference repeats every few
 * tens of metres and reads as a tiled pattern from any height. Here:
 * - five octaves of gradient noise, each turned by its own angle (no axis
 *   or grid shared) and drifting its own way at its own speed, so the
 *   crests evolve instead of sliding as one picture; the longest, a swell
 *   three times the scale's wavelength, still reads where the finer ones
 *   have faded (from the bank, the water a hundred metres off);
 * - their coordinates bent by a slower noise (a domain warp), so no crest
 *   runs straight;
 * - the whole field's strength set by gusts: a noise tens of metres wide
 *   that drifts with the wind and leaves calm, mirroring patches beside
 *   rough ones (cat's paws) — the unevenness that reads from afar;
 * - each octave fading out where its wavelength spans fewer than a few
 *   pixels (`fwidth`), so the far water neither shimmers nor turns grey.
 *
 * Everything is a function of the position and the clock alone: two tiles'
 * sheets agree at their seam, and so do a level's two meshes. The hash is
 * sin-free (stable at the data frame's kilometres). Branch-free: the
 * octave fades read `fwidth`, which needs uniform control flow.
 */

/** A wave field's size. */
export interface WaveScale {
  /** the longest octave's wavelength (m); the others are fractions of it */
  wavelength: number;
  /** the gusts' patches (m across) */
  gusts: number;
  /** the slope a gust gives the water (m/m, the octaves' sum) */
  steepness: number;
  /** how calm the water is between gusts (0 a mirror … 1 as rough) */
  calm: number;
}

/** The Elbe, a lake: ripples of decimetres to eight metres and a swell of
 *  twenty-odd under gusts seventy metres across. */
export const RIVER_WAVES: WaveScale = {
  wavelength: 8,
  gusts: 70,
  steepness: 0.32,
  calm: 0.25,
};

/** A fountain's basin: the jets' rings, a span across, the wind's patch a
 *  few metres. */
export const BASIN_WAVES: WaveScale = {
  wavelength: 1.2,
  gusts: 5,
  steepness: 0.16,
  calm: 0.45,
};

/** The octaves: wavelength (a share of the scale's), the share of the
 *  steepness, the grid's turn (rad) and the drift's heading (rad, off the
 *  wind's) — none of them a multiple of another. */
const OCTAVES = [
  { size: 2.9, share: 0.22, turn: 5.11, heading: -0.27 },
  { size: 1, share: 0.27, turn: 0.31, heading: 0 },
  { size: 0.43, share: 0.23, turn: 1.47, heading: 0.52 },
  { size: 0.19, share: 0.17, turn: 2.68, heading: -0.61 },
  { size: 0.083, share: 0.11, turn: 4.02, heading: 1.13 },
] as const;
/** The wind's heading (rad, data frame) and its gusts' drift (m/s). */
const WIND = 0.42;
const GUST_DRIFT = 1.1;
/** How far the warp bends the crests (shares of the wavelength). */
const WARP = 0.35;
/** An octave fades out between these wavelengths per pixel. */
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

/** `p` turned by `a` (rad). */
const turned = (p: V2, a: number): V2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
};

/** The water's slope and gusts. */
export interface WaveField {
  /** the surface's slope, data frame (∂height/∂x, ∂height/∂y; m/m) */
  slope: V2;
  /** 0 between gusts … 1 in one */
  gust: F;
}

/**
 * The wave field at data-frame `xy` (m) at time `t` (s): the octaves'
 * slopes summed, each turned back from its grid, scaled by the gust over
 * the spot and faded by the pixel's footprint.
 */
export function waves(xy: V2, t: F, scale: WaveScale): WaveField {
  const { wavelength, gusts, steepness, calm } = scale;
  const wind = vec2(Math.cos(WIND), Math.sin(WIND));
  // the gusts: a wide noise drifting downwind, its value 0…1
  const gustAt = gradientNoise(
    xy.div(gusts).sub(wind.mul(t.mul(GUST_DRIFT / gusts)))
  ).x;
  const gust = smoothstep(-0.3, 0.4, gustAt).toVar();
  // the warp: a noise three wavelengths wide bends every octave's crests
  const w = xy.div(wavelength * 3).toVar();
  const drift = t.mul(0.05);
  const warp = vec2(
    gradientNoise(w.add(vec2(drift, 0))).x,
    gradientNoise(w.add(vec2(17.3, drift.negate()))).x
  ).mul(wavelength * WARP);
  const q = xy.add(warp).toVar();
  // metres per pixel, for the fades
  const fw = fwidth(xy);
  const px = max(fw.x, fw.y).toVar();
  let slope: V2 = vec2(0, 0);
  for (const o of OCTAVES) {
    const size = wavelength * o.size;
    // a ripple's phase speed, slowed: the eye reads real speeds as a slide
    const speed = 0.35 * Math.sqrt((9.81 * size) / (2 * Math.PI));
    const heading = WIND + o.heading;
    const go = vec2(Math.cos(heading), Math.sin(heading)).mul(t.mul(speed));
    const n = gradientNoise(turned(q.sub(go), o.turn).div(size));
    const fade = smoothstep(
      size / FADE_PX[0],
      size / FADE_PX[1],
      px
    ).oneMinus();
    slope = slope.add(turned(n.yz, -o.turn).mul(fade.mul(o.share)));
  }
  return {
    slope: slope.mul(mix(calm, 1, gust).mul(steepness)),
    gust,
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
