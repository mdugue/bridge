import { Effect, EffectAttribute } from "postprocessing";
import type { Scene, WebGLRenderer } from "three";
import { Fog, Uniform, Vector2 } from "three";

/**
 * The picture styles' one pass (lib/city/render-style.ts): ink lines from
 * the depth buffer plus a per-style tone treatment of the colour. It runs
 * after AO/DoF and BEFORE the SMAA pass, so the lines and the band edges it
 * draws are antialiased like any other edge. The default style switches the
 * pass off (post-stack.ts), so the pastel look pays nothing for it.
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
 * `readDepth`, `getViewZ`, `RGBToHSL`, `HSLToRGB`, `resolution`,
 * `texelSize` and `time` are provided by postprocessing's effect template.
 */
const fragmentShader = /* glsl */ `
  uniform float styleMode;   // 1 comic, 2 film noir, 3 Sin City (0 = pass off)
  uniform float ink;         // outline strength, already weighted per style
  uniform float pixelScale;  // device pixels per CSS pixel
  uniform vec2 fogRange;     // the scene's linear fog (near, far) in metres

  const float SKY_Z = 4000.0;        // the sky dome writes no depth (far = 6000)
  const float CREASE_FLOOR = 0.0012; // slope noise floor, relative to w0

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float viewDistance(vec2 uv) {
    return -getViewZ(readDepth(uv));
  }

  // One axis of the stencil: returns (silhouette, crease) in 0..1.
  vec2 edgeAxis(vec2 uv, vec2 s, float w0) {
    float wa = 1.0 / max(viewDistance(uv - s), 1e-3);
    float wb = 1.0 / max(viewDistance(uv + s), 1e-3);
    float lap = abs(wa + wb - 2.0 * w0);
    float grad = max(abs(wb - w0), abs(w0 - wa));
    float jump = lap / w0;
    float fold = lap / (grad + w0 * CREASE_FLOOR);
    float silhouette = smoothstep(0.012, 0.045, jump);
    float crease = smoothstep(0.35, 0.8, fold) * smoothstep(0.0004, 0.0016, jump);
    return vec2(silhouette, crease);
  }

  // The four-axis stencil at an integer texel radius around a texel centre.
  // Integer on purpose: the depth texture is read NEAREST, and a fractional
  // radius rounds its two taps unevenly — on a grazing street that uneven
  // second difference is as large as a fold, and whole patches inked over.
  vec2 edgeStencil(vec2 p, float r, float w0) {
    vec2 sx = vec2(texelSize.x, 0.0) * r;
    vec2 sy = vec2(0.0, texelSize.y) * r;
    vec2 sd = texelSize * r;
    vec2 sa = vec2(texelSize.x, -texelSize.y) * r;
    return max(
      max(edgeAxis(p, sx, w0), edgeAxis(p, sy, w0)),
      max(edgeAxis(p, sd, w0), edgeAxis(p, sa, w0))
    );
  }

  // Ink coverage at uv: 0 = paper, 1 = a full stroke.
  float inkLines(vec2 uv, float z0, out float silhouetteOut) {
    vec2 css = uv * resolution / pixelScale;
    // The wandering pen: ≈ ±1 px on a ~90 px field; weight on a ~140 px one.
    vec2 wobble = vec2(
      valueNoise(css / 90.0 + 3.1),
      valueNoise(css / 90.0 + 17.7)
    ) - 0.5;
    float pressure = valueNoise(css / 140.0 + 41.0);
    float widthPx = pixelScale * mix(0.8, 1.6, pressure);
    if (styleMode > 2.5) {
      widthPx *= 1.5; // Sin City: a brush, not a nib
    }
    // Never below one device pixel: a sub-pixel stencil reads the same depth
    // texel on both sides and finds no edge at all.
    widthPx = max(widthPx, 1.0);
    // Snap the (wobbled) lookup to a texel centre; the width then blends
    // between the two integer radii around it, so the stroke still swells
    // continuously.
    vec2 p = uv + wobble * 2.0 * texelSize * pixelScale;
    p = (floor(p * resolution) + 0.5) * texelSize;
    float z = viewDistance(p);
    float w0 = 1.0 / max(z, 1e-3);
    float r0 = floor(widthPx);
    vec2 e = mix(
      edgeStencil(p, r0, w0),
      edgeStencil(p, r0 + 1.0, w0),
      widthPx - r0
    );
    silhouetteOut = e.x;
    float line = max(e.x, e.y * 0.7);
    // The haze swallows ink as it swallows colour: the line fades with the
    // scene's own fog factor (three's linear Fog on view depth), and far
    // detail thins out like a drawn background even on a clear day.
    float zf = min(z0, z);
    line *= 1.0 - 0.9 * smoothstep(fogRange.x, fogRange.y, zf);
    line *= mix(1.0, 0.45, smoothstep(300.0, 2400.0, zf));
    // Pen pressure also lifts the line a little here and there.
    line *= mix(0.72, 1.0, smoothstep(0.2, 0.6, pressure));
    return clamp(line, 0.0, 1.0);
  }

  // Clamped: the scene buffer is HDR (the sun's halo runs past 1), and HSL
  // of a colour above white folds its hue into nonsense.
  vec3 toPerceptual(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
  vec3 toLinear(vec3 p) { return pow(max(p, vec3(0.0)), vec3(2.2)); }
  float lumaOf(vec3 p) { return dot(p, vec3(0.2126, 0.7152, 0.0722)); }

  // A crisp but antialiased step: the transition spans one pixel of the
  // input's own gradient, whatever the gradient is.
  float aaStep(float edge, float x) {
    float w = max(fwidth(x), 1e-4);
    return smoothstep(edge - w, edge + w, x);
  }

  // --- Comic: flat colour bands, a halftone in the shade, warm paper. ---
  vec3 comic(vec3 p, vec2 uv, float z, bool sky) {
    vec3 hsl = RGBToHSL(p);
    float l = hsl.z;
    // Four flat tones; the steps are where a colourist would cut.
    float t1 = aaStep(0.30, l);
    float t2 = aaStep(0.52, l);
    float t3 = aaStep(0.74, l);
    float tone = 0.24 + 0.24 * t1 + 0.22 * t2 + 0.19 * t3;
    // Keep what the tone is made of: its hue and a lifted CHROMA. (HSL
    // saturation explodes as lightness nears white — the pale sky around the
    // sun reads as S ≈ 1 — so the band is rebuilt from the chroma instead.)
    float chroma = RGBToHCV(p).y * 1.3 + 0.015;
    float sat = min(chroma / (1.0 - abs(2.0 * tone - 1.0) + 1e-3), 1.0);
    vec3 flat_ = HSLToRGB(vec3(hsl.x, sat, tone));
    vec3 paper = vec3(0.975, 0.95, 0.89);
    // The top band leans into the paper — the white of the page.
    flat_ = mix(flat_, paper, 0.3 * t3);
    // Ben-Day dots in the darkest band, on a 45° grid in CSS pixels. (The
    // derivative is taken before any branch: fwidth needs the whole quad.)
    vec2 css = uv * resolution / pixelScale;
    vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * css / 5.0;
    float d = length(fract(g) - 0.5);
    float aa = max(fwidth(d), 1e-3);
    // Sky: an unbanded wash — a band edge across the open sky draws a hard
    // ellipse round the zenith that no colourist would cut.
    if (sky) {
      float skySat = min(chroma / (1.0 - abs(2.0 * l - 1.0) + 1e-3), 1.0);
      return mix(HSLToRGB(vec3(hsl.x, skySat, l)), paper, 0.18);
    }
    float shade = 1.0 - t1;
    float radius = 0.22 + 0.18 * smoothstep(0.30, 0.10, l);
    float dot_ = (1.0 - smoothstep(radius - aa, radius + aa, d)) * shade;
    // Halftones fade into the distance with the lines.
    dot_ *= 1.0 - smoothstep(120.0, 600.0, z);
    return mix(flat_, flat_ * 0.45, dot_ * 0.8);
  }

  // --- Film noir: hard silver-gelatine curve, smoky distance, dark sky. ---
  vec3 noir(vec3 p, vec2 uv, float z, bool sky) {
    float y = lumaOf(p);
    // Smoke in the distance, a lighter grey than the night it sits in.
    y = mix(y, 0.58, smoothstep(300.0, 2600.0, z) * 0.5);
    if (sky) {
      // A graduated filter: the sky darkens towards the top of the frame.
      y = mix(y * 0.95, y * 0.35, smoothstep(0.35, 1.0, uv.y));
    }
    // S-curve: steep mid-tones, crushed shadows, highlights that still hold.
    y = clamp((y - 0.47) * 1.55 + 0.5, 0.0, 1.0);
    y = mix(y, y * y * (3.0 - 2.0 * y), 0.6);
    y = max(y - 0.025, 0.0) / 0.975;
    return vec3(y) * vec3(0.985, 1.0, 1.02);
  }

  // --- Sin City: two inks and a red that bleeds through. ---
  vec3 sincity(vec3 p, float z, bool sky, out float white) {
    float y = lumaOf(p);
    // Night takes the distance: far things sink into black.
    y *= 1.0 - smoothstep(500.0, 2200.0, z) * 0.85;
    white = aaStep(0.42, y) * (sky ? 0.0 : 1.0);
    vec3 paper = vec3(0.96, 0.955, 0.94);
    vec3 col = paper * white;
    // Selective colour: saturated reds (terracotta, brick, signal red) keep
    // a pure, deep red; everything else is black or white.
    vec3 hsl = RGBToHSL(p);
    float hueToRed = min(hsl.x, 1.0 - hsl.x);
    // The window is wide enough to catch the clay city's muted terracotta
    // roofs (the scene's only reds), narrow enough to leave ochre and sand.
    float red = (1.0 - smoothstep(0.045, 0.075, hueToRed))
      * smoothstep(0.1, 0.22, hsl.y)
      * smoothstep(0.12, 0.25, hsl.z);
    // A cut-out, not a tint: the red is on or off (a half-red is pink).
    red = smoothstep(0.4, 0.6, red) * (sky ? 0.0 : 1.0);
    vec3 blood = mix(vec3(0.55, 0.02, 0.05), vec3(0.86, 0.07, 0.12), white);
    return mix(col, blood, red);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    float z = -getViewZ(depth);
    bool sky = z > SKY_Z;
    vec3 p = toPerceptual(inputColor.rgb);
    float silhouette = 0.0;
    float line = ink > 0.001 ? inkLines(uv, z, silhouette) * ink : 0.0;
    vec3 outP;
    if (styleMode < 1.5) {
      outP = comic(p, uv, z, sky);
      outP = mix(outP, vec3(0.13, 0.1, 0.12), clamp(line, 0.0, 1.0));
    } else if (styleMode < 2.5) {
      outP = noir(p, uv, z, sky);
      outP = mix(outP, vec3(0.03), clamp(line, 0.0, 1.0));
    } else {
      float white = 0.0;
      outP = sincity(p, z, sky, white);
      // Frank Miller's trick: on black, the contour is cut out in white —
      // the skyline is drawn against the night by its silhouette alone.
      vec3 contour = white > 0.5 ? vec3(0.0) : vec3(0.93);
      // Cut-out contours are all or nothing: a grey one reads as a smudge.
      float weight = white > 0.5 ? line : smoothstep(0.15, 0.45, line * silhouette);
      outP = mix(outP, contour, clamp(weight, 0.0, 1.0));
    }
    outputColor = vec4(toLinear(outP), inputColor.a);
  }
`;

export class StylizeEffect extends Effect {
  private readonly scene: Scene;

  constructor(scene: Scene) {
    super("StylizeEffect", fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["styleMode", new Uniform(1)],
        ["ink", new Uniform(0.7)],
        ["pixelScale", new Uniform(1)],
        ["fogRange", new Uniform(new Vector2(1e5, 1e5 + 1))],
      ]),
    });
    this.scene = scene;
  }

  /** The shader mode of a RenderStyleDef (1 comic, 2 noir, 3 Sin City). */
  setMode(mode: number): void {
    const uniform = this.uniforms.get("styleMode");
    if (uniform) {
      uniform.value = mode;
    }
  }

  /** Outline strength, 0..~1.25 (the ink slider times the style's weight). */
  setInk(value: number): void {
    const uniform = this.uniforms.get("ink");
    if (uniform) {
      uniform.value = Math.max(value, 0);
    }
  }

  override update(renderer: WebGLRenderer): void {
    const scale = this.uniforms.get("pixelScale");
    if (scale) {
      scale.value = renderer.getPixelRatio();
    }
    // Read per frame: the fog slider and the partial-world clamp move it.
    const fog = this.scene.fog;
    const range = this.uniforms.get("fogRange")?.value as Vector2 | undefined;
    if (range && fog instanceof Fog) {
      range.set(fog.near, Math.max(fog.far, fog.near + 1));
    }
  }
}
