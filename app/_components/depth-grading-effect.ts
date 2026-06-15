import { Effect, EffectAttribute } from "postprocessing";
import { Uniform } from "three";
import { clamp01 } from "@/lib/math";

/**
 * Painterly aerial perspective: warm tint up close, cooler and slightly
 * desaturated with distance — the classic watercolor/sketch depth cue,
 * driven by the depth buffer. `intensity` 0 disables it entirely.
 *
 * `getViewZ` is provided by postprocessing for effects that declare the
 * DEPTH attribute.
 */
const fragmentShader = /* glsl */ `
  uniform float intensity;
  uniform float gradeDistance;

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    float viewZ = getViewZ(depth);
    float dist = clamp(-viewZ / gradeDistance, 0.0, 1.0);
    float t = smoothstep(0.04, 1.0, dist) * intensity;

    vec3 warm = vec3(1.045, 1.0, 0.94);
    vec3 cool = vec3(0.91, 0.965, 1.06);
    vec3 graded = inputColor.rgb * mix(warm, cool, t);

    // Gentle far desaturation — distant blocks recede into the paper.
    float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
    graded = mix(graded, vec3(luma), 0.3 * t);

    outputColor = vec4(graded, inputColor.a);
  }
`;

export class DepthGradingEffect extends Effect {
  constructor() {
    super("DepthGradingEffect", fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ["intensity", new Uniform(0.5)],
        // Distance (m) over which the grade fully shifts to "cool".
        ["gradeDistance", new Uniform(800)],
      ]),
    });
  }

  setIntensity(value: number): void {
    const uniform = this.uniforms.get("intensity");
    if (uniform) {
      uniform.value = clamp01(value);
    }
  }
}
