import { Effect } from "postprocessing";
import { Uniform } from "three";

/**
 * Static paper grain: a screen-anchored value-noise speckle plus faint
 * horizontal fiber banding, multiplied onto the final image. Not animated —
 * it should read as the sheet the scene is drawn on, not as film grain.
 * `intensity` 0 disables it.
 *
 * `film` 1 turns it into film grain for the monochrome styles
 * (lib/city/render-style.ts): the speckle is re-drawn 24 times a second and
 * the fibers go (a film has none); like silver grain it is strongest in the
 * mid-tones.
 *
 * `resolution` and `time` are provided to effect shaders by postprocessing.
 */
const fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform float film;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 cell = floor(uv * resolution / 1.6);
    // A new sheet of grain per film frame; the static paper keeps seed 0.
    vec2 seed = film * vec2(floor(time * 24.0) * 7.31, 0.0);
    float speckle = hash21(cell + seed) * 0.65 + hash21(cell * 0.31 + 17.0 + seed) * 0.35;
    float grain = (speckle - 0.5) * 0.13;
    // Paper fibers: subtle row-correlated brightness variation.
    float fiber = (hash21(vec2(cell.y * 0.713, 3.7)) - 0.5) * 0.045 * (1.0 - film);
    float luma = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float midtones = mix(1.0, 0.35 + 2.6 * luma * (1.0 - min(luma, 1.0)), film);
    vec3 color = inputColor.rgb * (1.0 + (grain * midtones + fiber) * intensity);
    outputColor = vec4(color, inputColor.a);
  }
`;

export class PaperGrainEffect extends Effect {
  constructor() {
    super("PaperGrainEffect", fragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["intensity", new Uniform(0.25)],
        ["film", new Uniform(0)],
      ]),
    });
  }

  /** 0..2 — the slider (0..1) times the picture style's grain weight. */
  setIntensity(value: number): void {
    const uniform = this.uniforms.get("intensity");
    if (uniform) {
      uniform.value = Math.min(Math.max(value, 0), 2);
    }
  }

  /** true = animated film grain, false = the static paper sheet. */
  setFilm(on: boolean): void {
    const uniform = this.uniforms.get("film");
    if (uniform) {
      uniform.value = on ? 1 : 0;
    }
  }
}
