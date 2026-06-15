import { Effect } from "postprocessing";
import { Uniform } from "three";
import { clamp01 } from "@/lib/math";

/**
 * Static paper grain: a screen-anchored value-noise speckle plus faint
 * horizontal fiber banding, multiplied onto the final image. Not animated —
 * it should read as the sheet the scene is drawn on, not as film grain.
 * `intensity` 0 disables it.
 *
 * `resolution` is provided to effect shaders by postprocessing.
 */
const fragmentShader = /* glsl */ `
  uniform float intensity;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 cell = floor(uv * resolution / 1.6);
    float speckle = hash21(cell) * 0.65 + hash21(cell * 0.31 + 17.0) * 0.35;
    float grain = (speckle - 0.5) * 0.13;
    // Paper fibers: subtle row-correlated brightness variation.
    float fiber = (hash21(vec2(cell.y * 0.713, 3.7)) - 0.5) * 0.045;
    vec3 color = inputColor.rgb * (1.0 + (grain + fiber) * intensity);
    outputColor = vec4(color, inputColor.a);
  }
`;

export class PaperGrainEffect extends Effect {
  constructor() {
    super("PaperGrainEffect", fragmentShader, {
      uniforms: new Map<string, Uniform>([["intensity", new Uniform(0.25)]]),
    });
  }

  setIntensity(value: number): void {
    const uniform = this.uniforms.get("intensity");
    if (uniform) {
      uniform.value = clamp01(value);
    }
  }
}
