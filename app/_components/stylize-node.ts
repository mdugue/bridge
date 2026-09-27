import {
  Color,
  FloatType,
  Fog,
  MathUtils,
  Matrix3,
  NearestFilter,
  type PerspectiveCamera,
  type Scene,
  Vector2,
  Vector3,
} from "three";
import {
  abs,
  asin,
  atan,
  clamp,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  If,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  rtt,
  screenSize,
  screenUV,
  select,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * SPIKE (plan 020): the picture styles' one pass of stylize-effect.ts in TSL,
 * term for term — ink lines from the depth buffer's second difference, the
 * hand (sway, tremor, pressure, lifts, a paper tooth), and the four tone
 * treatments: Comic's bands and Ben-Day dots, Film noir's silver curve with
 * its dusk exposure, Sin City's inks with the red roofs and the rain,
 * Papier's duotone. The GLSL's comments are the reference; the notes here
 * are only where TSL differs.
 *
 * - The GLSL works in postprocessing's uv (origin bottom left, y up); so does
 *   this, and it flips y only to sample (three's render targets read top
 *   down), so the sky's graduated filter and the view ray are the same.
 * - The surface normal from depth derivatives is turned to face the camera:
 *   a derivative in y runs the other way on WebGPU, and a visible surface
 *   always faces the camera, so the orientation is right on either backend.
 * - Each style is its own graph (`apply(input, mode)`), its pen constants:
 *   one pass holding all four styles behind a uniform branch came to
 *   thousands of lines, and the headless GPU drew it black.
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

/** stylize-effect.ts SKY_Z / CREASE_FLOOR. */
const SKY_Z = 4000;
const CREASE_FLOOR = 0.0012;
/** postprocessing's EPSILON (the colour helpers). */
const EPS = 1e-6;

function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

function valueNoise(p: V2): F {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// postprocessing's colour helpers (RGBToHCV, RGBToHSL, HueToRGB, HSLToRGB).
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
  const h = hsl.x.mul(6);
  const rgb = clamp(
    vec3(
      abs(h.sub(3)).sub(1),
      float(2).sub(abs(h.sub(2))),
      float(2).sub(abs(h.sub(4)))
    ),
    0,
    1
  );
  const c = float(1)
    .sub(abs(hsl.z.mul(2).sub(1)))
    .mul(hsl.y);
  return rgb.sub(0.5).mul(c).add(hsl.z);
}

const toPerceptual = (c: V3): V3 => pow(clamp(c, 0, 1), vec3(1 / 2.2));
const toLinear = (p: V3): V3 => pow(max(p, vec3(0)), vec3(2.2));
const lumaOf = (p: V3): F => dot(p, vec3(0.2126, 0.7152, 0.0722));
function aaStep(edge: F | number, x: F): F {
  const w = max(fwidth(x), 1e-4);
  const e = typeof edge === "number" ? float(edge) : edge;
  return smoothstep(e.sub(w), e.add(w), x);
}
function softStep(edge: number, x: F, minWidth: F): F {
  const w = max(fwidth(x), max(minWidth, 1e-4));
  return smoothstep(float(edge).sub(w), float(edge).add(w), x);
}

/** stylize-effect.ts's Pen: the hand of each style (by shader mode). */
interface Pen {
  /** CSS px of slow wander (±half) */
  sway: number;
  /** CSS px of fast wander (±half) */
  tremor: number;
  /** relative depth jump: silhouette ramp */
  sil: [number, number];
  /** weight of folds against silhouettes */
  creaseW: number;
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
  // Sin City only inks the big jumps, and the folds of a building near by.
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
};

export interface NodeStylize {
  /** The styled colour of `input` (drawn to a texture first: the pass
   *  reads its neighbours), in the same linear space. */
  apply: (input: Node<"vec4">, mode: number) => Node<"vec4">;
  setInk: (value: number) => void;
  /** Film noir's dusk exposure (stylize-effect.ts setSunAltitude). */
  setSunAltitude: (altitudeDeg: number) => void;
}

export function createNodeStylize(
  /** the scene pass's view-space z (PassNode.getViewZNode) */
  viewZ: Node<"float">,
  scene: Scene,
  camera: PerspectiveCamera,
  pixelRatio: () => number
): NodeStylize {
  const ink = uniform(0.7);
  const dusk = uniform(0);
  const pixelScale = uniform(1).onRenderUpdate(() => pixelRatio());
  // Read per frame: the fog slider and the partial-world clamp move it.
  const fogRangeValue = new Vector2(1e5, 1e5 + 1);
  const fogColorValue = new Color(1, 1, 1);
  const fogRange = uniform(fogRangeValue).onRenderUpdate(() => {
    const fog = scene.fog;
    if (fog instanceof Fog) {
      fogRangeValue.set(fog.near, Math.max(fog.far, fog.near + 1));
      fogColorValue.copy(fog.color);
    }
    return fogRangeValue;
  });
  const fogColor = uniform(fogColorValue);
  const upValue = new Vector3();
  const upView = uniform(upValue).onRenderUpdate(() =>
    upValue.set(0, 1, 0).transformDirection(camera.matrixWorldInverse)
  );
  const projValue = new Vector2(1, 1);
  const projScale = uniform(projValue).onRenderUpdate(() => {
    const tanHalf = Math.tan(MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
    return projValue.set(tanHalf * camera.aspect, tanHalf);
  });
  const rotation = new Matrix3();
  const viewToWorld = uniform(rotation).onRenderUpdate(() =>
    rotation.setFromMatrix4(camera.matrixWorld)
  );

  const apply = (input: Node<"vec4">, mode: number): Node<"vec4"> => {
    // reason: the screen size uniform's type is its Vector2, not a node's.
    const resolution = screenSize as unknown as V2;
    const texelSize = vec2(1, 1).div(resolution);
    // postprocessing's uv (y up) ↔ three's render-target uv (y down)
    const flip = (uv: V2): V2 => vec2(uv.x, float(1).sub(uv.y));
    // The colour and the view distance in ONE float texture (alpha = the
    // distance, in metres). Sampled side by side from the colour's render
    // target and the scene pass's depth texture, the WebGL2 backend read
    // the colour for both, and every style drew as if the world were two
    // metres deep. Nearest: taps land on texel centres, and a float target
    // is not filterable everywhere.
    const packed = rtt(vec4(input.rgb, viewZ.negate()), null, null, {
      type: FloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    const at = (uv: V2): Node<"vec4"> => packed.sample(flip(uv));
    const colorAt = (uv: V2): V3 => at(uv).rgb;
    const viewDistance = (uv: V2): F => at(uv).a;

    // The pen of this style (stylize-effect.ts penFor), as constants: each
    // style is its own graph (see apply).
    const pen = PENS[mode] ?? PENS[1];
    const hasDetail = pen.detail > 0;

    const edgeAxis = (uv: V2, s: V2, w0: F, sil: V2): V2 => {
      const wa = float(1).div(max(viewDistance(uv.sub(s)), 1e-3));
      const wb = float(1).div(max(viewDistance(uv.add(s)), 1e-3));
      const lap = abs(wa.add(wb).sub(w0.mul(2)));
      const grad = max(abs(wb.sub(w0)), abs(w0.sub(wa)));
      const jump = lap.div(w0);
      const fold = lap.div(grad.add(w0.mul(CREASE_FLOOR)));
      const silhouette = smoothstep(sil.x, sil.y, jump);
      const crease = smoothstep(0.35, 0.8, fold).mul(
        smoothstep(0.0004, 0.0016, jump)
      );
      return vec2(silhouette, crease);
    };
    const edgeStencil = (p: V2, r: F, w0: F, sil: V2): V2 => {
      const sx = vec2(texelSize.x, 0).mul(r);
      const sy = vec2(0, texelSize.y).mul(r);
      const sd = texelSize.mul(r);
      const sa = vec2(texelSize.x, texelSize.y.negate()).mul(r);
      return max(
        max(edgeAxis(p, sx, w0, sil), edgeAxis(p, sy, w0, sil)),
        max(edgeAxis(p, sd, w0, sil), edgeAxis(p, sa, w0, sil))
      );
    };

    /** Ink coverage (x) and the silhouette share (y) at uv. */
    const inkLines = (uv: V2, z0: F, up: F): V2 => {
      const css = uv.mul(resolution).div(pixelScale);
      const sway = vec2(
        valueNoise(css.div(120).add(3.1)),
        valueNoise(css.div(120).add(17.7))
      ).sub(0.5);
      const tremor = vec2(
        valueNoise(css.div(28).add(7.3)),
        valueNoise(css.div(28).add(29.1))
      ).sub(0.5);
      const pressure0 = valueNoise(css.div(50).add(41));
      const pressure = pressure0
        .mul(pressure0)
        .mul(float(3).sub(pressure0.mul(2)));
      const lift = valueNoise(css.div(80).add(91));
      const width0 = pixelScale.mul(
        mix(pen.weight[0], pen.weight[1], pressure)
      );
      const width1 = hasDetail
        ? width0.mul(
            mix(1, 0.55, smoothstep(pen.detail * 0.5, pen.detail * 2.5, z0))
          )
        : width0;
      const widthPx = max(width1, 1);
      const offsetCss = sway
        .mul(pen.sway)
        .add(tremor.mul(pen.tremor))
        .add(vec2(...pen.misregister));
      const p0 = uv.add(offsetCss.mul(texelSize).mul(pixelScale));
      const p = floor(p0.mul(resolution)).add(0.5).mul(texelSize);
      const z = viewDistance(p);
      const w0 = float(1).div(max(z, 1e-3));
      const zf = min(z0, z);
      const far = hasDetail ? zf.div(pen.detail) : float(0);
      const sil = vec2(...pen.sil).mul(far.add(1));
      const r0 = floor(widthPx);
      const e = mix(
        edgeStencil(p, r0, w0, sil),
        edgeStencil(p, r0.add(1), w0, sil),
        widthPx.sub(r0)
      );
      const creaseFade = hasDetail
        ? float(1).sub(smoothstep(pen.detail * 0.35, pen.detail * 1.4, zf))
        : float(1);
      const groundFold = float(1).sub(smoothstep(0.9, 0.97, up).mul(0.75));
      let line: F = max(
        e.x,
        e.y.mul(pen.creaseW).mul(creaseFade).mul(groundFold)
      );
      line = line.mul(
        float(1).sub(smoothstep(fogRange.x, fogRange.y, zf).mul(0.9))
      );
      line = line.mul(mix(1, 0.45, smoothstep(300, 2400, zf)));
      line = line.mul(mix(0.72, 1, smoothstep(0.15, 0.55, pressure)));
      if (pen.lifts > 0) {
        line = line.mul(
          float(1).sub(
            float(1)
              .sub(smoothstep(0.1, 0.24, lift))
              .mul(pen.lifts)
          )
        );
        const tooth = hash21(floor(css.mul(1.5)));
        line = mix(
          line,
          smoothstep(tooth.mul(0.45), tooth.mul(0.45).add(0.4), line),
          pen.lifts * 0.6
        );
      }
      return vec2(clamp(line, 0, 1), e.x);
    };

    const blurredColor = (uv: V2, radiusCss: number): V3 => {
      const r = texelSize.mul(max(pixelScale.mul(radiusCss), 1));
      const taps: V2[] = [
        vec2(r.x, 0),
        vec2(r.x.negate(), 0),
        vec2(0, r.y),
        vec2(0, r.y.negate()),
        r.mul(0.7071),
        r.mul(-0.7071),
        vec2(r.x, r.y.negate()).mul(0.7071),
        vec2(r.x, r.y.negate()).mul(-0.7071),
      ];
      let sum: V3 = toPerceptual(colorAt(uv)).mul(2);
      for (const t of taps) {
        sum = sum.add(toPerceptual(colorAt(uv.add(t))));
      }
      return sum.div(10);
    };

    // --- Comic ---
    const comic = (p: V3, uv: V2, z: F, sky: Node<"bool">): V3 => {
      // reason: a colour uniform is a vec3 in the graph.
      const fogP = toPerceptual(fogColor as unknown as V3);
      const fogness = float(1)
        .sub(smoothstep(0.03, 0.26, length(blurredColor(uv, 4).sub(fogP))))
        .mul(smoothstep(80, 250, z));
      const haze = max(
        smoothstep(fogRange.x, mix(fogRange.x, fogRange.y, 0.7), z),
        smoothstep(0.45, 0.9, fogness)
      );
      const farField = smoothstep(180, 600, z);
      const bandSoft = max(fogness.mul(0.12), farField.mul(0.1));
      const hsl = rgbToHsl(p);
      const l = rgbToHsl(blurredColor(uv, 2.5)).z;
      const t1 = softStep(0.3, l, bandSoft);
      const t2 = softStep(0.52, l, bandSoft);
      const t3 = softStep(0.74, l, bandSoft);
      const tone = t1.mul(0.24).add(t2.mul(0.22)).add(t3.mul(0.19)).add(0.24);
      const chroma = rgbToHcv(p).y.mul(1.3).add(0.015);
      const satFor = (light: F): F =>
        min(
          chroma.div(
            float(1)
              .sub(abs(light.mul(2).sub(1)))
              .add(1e-3)
          ),
          1
        );
      const paper = vec3(0.975, 0.95, 0.89);
      const flat = mix(
        hslToRgb(vec3(hsl.x, satFor(tone), tone)),
        paper,
        t3.mul(0.3).mul(float(1).sub(farField))
      );
      const css = uv.mul(resolution).div(pixelScale);
      const g = vec2(
        css.x.mul(0.7071).add(css.y.mul(0.7071)),
        css.x.mul(-0.7071).add(css.y.mul(0.7071))
      ).div(5);
      const d = length(fract(g).sub(0.5));
      const aa = max(fwidth(d), 1e-3);
      const wash = mix(hslToRgb(vec3(hsl.x, satFor(l), l)), paper, 0.18);
      const shade = float(1).sub(t1);
      const radius = smoothstep(0.3, 0.1, l).mul(0.18).add(0.22);
      const dotCover = float(1)
        .sub(smoothstep(radius.sub(aa), radius.add(aa), d))
        .mul(shade)
        .mul(float(1).sub(smoothstep(60, 200, z)));
      const banded = mix(flat, flat.mul(0.45), dotCover.mul(0.8));
      return select(
        sky.or(haze.greaterThan(0.999)),
        wash,
        mix(banded, wash, haze)
      );
    };

    // --- Film noir ---
    const noir = (p: V3, uv: V2, z: F, sky: Node<"bool">): V3 => {
      let y: F = lumaOf(p).mul(
        mix(1, select(sky, float(1.25), float(1.6)), dusk)
      );
      y = y.div(dusk.mul(0.4).mul(y).add(1));
      y = mix(y, 0.58, smoothstep(300, 2600, z).mul(0.5));
      y = select(
        sky,
        mix(y.mul(0.95), y.mul(0.35), smoothstep(0.35, 1, uv.y)),
        y
      );
      const pivot = mix(0.47, 0.43, dusk);
      y = clamp(
        y
          .sub(pivot)
          .mul(mix(1.55, 1.45, dusk))
          .add(0.5),
        0,
        1
      );
      y = mix(y, y.mul(y).mul(float(3).sub(y.mul(2))), 0.6);
      y = max(y.sub(0.025), 0).div(0.975);
      return vec3(y).mul(vec3(0.985, 1, 1.02));
    };

    // --- Sin City ---
    const sinCityLuma = (c: V3, up: F, upRough: F): F => {
      const green = c.g.sub(max(c.r, c.b));
      const blue = c.b.sub(max(c.r, c.g));
      const grass = smoothstep(0.85, 0.96, up).mul(
        float(1).sub(smoothstep(0.03, 0.1, upRough))
      );
      const crown = float(1).sub(grass);
      return lumaOf(c)
        .sub(crown.mul(0.36).mul(smoothstep(0.01, 0.05, green)))
        .sub(smoothstep(0.006, 0.02, blue).mul(0.42));
    };
    const localLuma = (uv: V2): F => {
      const r = texelSize.mul(pixelScale.mul(48));
      let sum: F = float(0);
      for (let i = 0; i < 8; i++) {
        const a = i * 0.7854 + 0.39;
        sum = sum.add(
          lumaOf(
            toPerceptual(colorAt(uv.add(r.mul(vec2(Math.cos(a), Math.sin(a))))))
          )
        );
      }
      return sum.div(8);
    };
    const skyRim = (uv: V2): F => {
      const r = texelSize.mul(max(floor(pixelScale.mul(2).add(0.5)), 1));
      const p = floor(uv.mul(resolution)).add(0.5).mul(texelSize);
      const at = (o: V2) => step(SKY_Z, viewDistance(p.add(o)));
      return max(
        max(at(vec2(r.x, 0)), at(vec2(r.x.negate(), 0))),
        max(at(vec2(0, r.y)), at(vec2(0, r.y.negate())))
      );
    };
    const rainLayer = (
      dir: V3,
      cellsPerRad: number,
      speed: number,
      seed: number,
      pixelAngle: F
    ): F => {
      const az = atan(dir.z, dir.x);
      const el = asin(clamp(dir.y, -1, 1));
      const q0 = vec2(
        az.mul(cellsPerRad),
        el.mul(cellsPerRad * 0.22).add(time.mul(speed))
      );
      const q = vec2(q0.x.add(q0.y.mul(0.9)), q0.y);
      const cell = floor(q);
      const f = fract(q);
      const present = step(0.84, hash21(cell.add(seed)));
      const x0 = hash21(cell.add(seed + 7.1))
        .mul(0.6)
        .add(0.2);
      const y0 = hash21(cell.add(seed + 3.3))
        .mul(0.4)
        .add(0.1);
      const len = hash21(cell.add(seed + 9.9))
        .mul(0.22)
        .add(0.28);
      const w = max(0.035, pixelAngle.mul(1.1 * cellsPerRad));
      const across = float(1).sub(smoothstep(w.mul(0.5), w, abs(f.x.sub(x0))));
      const along = smoothstep(y0, y0.add(0.05), f.y).mul(
        float(1).sub(smoothstep(y0.add(len).sub(0.05), y0.add(len), f.y))
      );
      return present.mul(across).mul(along);
    };
    const sinCityRain = (uv: V2, z: F): F => {
      const ray = normalize(vec3(uv.mul(2).sub(1).mul(projScale), -1));
      const dir = normalize(viewToWorld.mul(ray));
      const pixelAngle = length(fwidth(dir));
      const near = rainLayer(dir, 55, 1.5, 1.7, pixelAngle).mul(step(4, z));
      const mid = rainLayer(dir, 120, 1.05, 5.3, pixelAngle).mul(step(12, z));
      const down = float(1).sub(smoothstep(0.3, 0.75, dir.y.negate()));
      return max(near.mul(0.85), mid.mul(0.55)).mul(down);
    };
    /** Sin City's colour (rgb) and whether it is white (w). */
    const sincity = (
      p: V3,
      uv: V2,
      z: F,
      sky: Node<"bool">,
      roofSlope: F,
      up: F
    ): Node<"vec4"> => {
      const blurred = blurredColor(uv, 3);
      const far = smoothstep(700, 2600, z);
      const y = sinCityLuma(blurred, up, fwidth(up)).mul(
        float(1).sub(far.mul(0.55))
      );
      const t = clamp(
        mix(0.38, localLuma(uv).mul(float(1).sub(far.mul(0.55))), 0.33),
        0.24,
        0.56
      );
      const b1 = aaStep(t.sub(0.13), y);
      const b2 = aaStep(t, y);
      const b3 = aaStep(t.add(0.15), y);
      const tone = b1.mul(0.13).add(b2.mul(0.63)).add(b3.mul(0.175)).add(0.012);
      const paper = vec3(0.96, 0.955, 0.94);
      const col = select(sky, vec3(0), paper.mul(tone.div(0.947)));
      const hsl = rgbToHsl(blurred);
      const hueToRed = min(hsl.x, float(1).sub(hsl.x));
      const redRaw = float(1)
        .sub(smoothstep(0.075, 0.11, hueToRed))
        .mul(smoothstep(0.05, 0.13, hsl.y))
        .mul(smoothstep(0.08, 0.18, hsl.z))
        .mul(roofSlope);
      const red = aaStep(0.45, redRaw).mul(select(sky, float(0), float(1)));
      const lit = aaStep(0.36, lumaOf(p));
      const blood = mix(vec3(0.42, 0.015, 0.04), vec3(0.84, 0.06, 0.1), lit);
      const white = max(b2.mul(select(sky, float(0), float(1))), red.mul(lit));
      return vec4(mix(col, blood, red), white);
    };

    // --- Papier ---
    const paperTone = (p: V3, sky: Node<"bool">): V3 => {
      const paper = vec3(0.972, 0.958, 0.93);
      const y = lumaOf(p);
      const t = smoothstep(0.08, 0.6, y);
      const shade = vec3(0.55, 0.58, 0.67);
      const tint = p.div(max(y, 1e-3));
      return select(
        sky,
        paper.mul(0.985),
        mix(shade, paper, t).mul(mix(vec3(1), tint, 0.35))
      );
    };

    return Fn(() => {
      const uv = vec2(screenUV.x, float(1).sub(screenUV.y));
      const inputColor = vec4(colorAt(uv), 1);
      const z = viewDistance(uv);
      const sky = z.greaterThan(SKY_Z);
      const p = toPerceptual(inputColor.rgb);
      const viewPos = vec3(uv.mul(2).sub(1).mul(projScale).mul(z), z.negate());
      const n0 = normalize(cross(dFdx(viewPos), dFdy(viewPos)));
      const normal = select(dot(n0, viewPos).greaterThan(0), n0.negate(), n0);
      const up = dot(normal, upView);
      const roofSlope = smoothstep(0.2, 0.35, up).mul(
        float(1).sub(smoothstep(0.92, 0.97, up))
      );
      const lines = vec2(0, 0).toVar();
      If(ink.greaterThan(0.001), () => {
        lines.assign(inkLines(uv, z, up));
      });
      const line = clamp(lines.x.mul(ink), 0, 1);
      const silhouette = lines.y;
      let outP: V3;
      if (mode === 2) {
        outP = mix(noir(p, uv, z, sky), vec3(0.03), line);
      } else if (mode === 3) {
        const sc = sincity(p, uv, z, sky, roofSlope, up);
        const rain = sinCityRain(uv, z);
        const onWhite = mix(
          mix(sc.rgb, vec3(0), smoothstep(0.3, 0.55, line)),
          vec3(0),
          rain.mul(0.18)
        );
        const cut = max(
          skyRim(uv),
          smoothstep(0.35, 0.6, line.mul(silhouette))
        ).mul(step(0.001, ink));
        const cutOnBlack = select(sky, sc.rgb, mix(sc.rgb, vec3(0.93), cut));
        const onBlack = mix(cutOnBlack, vec3(0.93), rain);
        outP = select(sc.w.greaterThan(0.5), onWhite, onBlack);
      } else if (mode === 4) {
        outP = mix(paperTone(p, sky), vec3(0.22, 0.23, 0.28), line.mul(0.92));
      } else {
        outP = mix(comic(p, uv, z, sky), vec3(0.13, 0.1, 0.12), line);
      }
      return vec4(toLinear(outP), inputColor.a);
    })();
  };

  return {
    apply,
    setInk: (value) => {
      ink.value = Math.max(value, 0);
    },
    setSunAltitude: (altitudeDeg) => {
      const t = MathUtils.clamp((12 - altitudeDeg) / 18, 0, 1);
      dusk.value = t * t * (3 - 2 * t);
    },
  };
}
