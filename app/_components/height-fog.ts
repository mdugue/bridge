/**
 * Height-term fog (valley pooling). Built-in three `Fog` is purely
 * distance-based; this adds a world-Y term so the Elbe valley floor pools with
 * deeper haze than bridge decks / high ground at the same distance — on-aesthetic
 * aerial depth.
 *
 * It is **folded into** each fog-receiving material's existing `onBeforeCompile`
 * (NOT wrapped around it): three derives a material's program-cache key from
 * `onBeforeCompile.toString()`, so replacing every fog material's callback with
 * one identical wrapper would collapse distinct shaders (terrain, crown, clay…)
 * onto a shared cached program. Each builder keeps its own callback and calls
 * `injectHeightFog(shader, uniforms)` at the end.
 *
 * Apply it to ALL of them or a seam appears (e.g. terrain pools but the water
 * sheet floats out of the haze). The uniforms are by-reference so the start (the
 * river/DGM minimum, captured at boot) and strength retune with no recompile.
 */

import { LOOK_DEFAULTS } from "@/lib/city/look-controls";

/** Shape passed to a material's `onBeforeCompile` (the bits we touch). */
export interface OnBeforeCompileShader {
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

export interface HeightFogUniforms {
  /** metres of fade above the start over which the height haze decays to 0 */
  uFogHeightFalloff: { value: number };
  /** world-Y (elevation, m) below which the extra haze pools */
  uFogHeightStart: { value: number };
  /** 0..1 — extra haze added toward the palette fog colour in low ground */
  uFogHeightStrength: { value: number };
}

/** Default fade height (m) above the valley floor — ~the Elbe-to-rim drop. */
const DEFAULT_FALLOFF = 28;

export function createHeightFogUniforms(): HeightFogUniforms {
  return {
    uFogHeightStart: { value: 0 },
    uFogHeightFalloff: { value: DEFAULT_FALLOFF },
    uFogHeightStrength: { value: LOOK_DEFAULTS.heightFog },
  };
}

// vWorldY = TRUE world-Y (elevation): modelMatrix bakes the −90° world rotation
// for terrain/buildings, and is ~identity for the Y-up vegetation/scene — so the
// same expression is correct everywhere. Guarded for instanced meshes.
const FOG_VERTEX_INJECT = `#include <fog_vertex>
#ifdef USE_INSTANCING
	vWorldY = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;
#else
	vWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
#endif`;

// Builds ON the existing distance fogFactor (never replaces it): only adds haze
// toward fogColor in low+near ground, so distant high ground still hazes normally.
const FOG_FRAGMENT_REPLACE = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float heightMask = 1.0 - smoothstep( uFogHeightStart, uFogHeightStart + uFogHeightFalloff, vWorldY );
	fogFactor = clamp( fogFactor + uFogHeightStrength * heightMask * ( 1.0 - fogFactor ), 0.0, 1.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

/**
 * Registers the by-reference uniforms and patches the (untouched) `<fog_vertex>`
 * / `<fog_fragment>` chunks. Declarations are prepended (the materials' own
 * compiles already replaced `<common>`, so a second replace there would no-op).
 */
export function injectHeightFog(
  shader: OnBeforeCompileShader,
  uniforms: HeightFogUniforms
): void {
  shader.uniforms.uFogHeightStart = uniforms.uFogHeightStart;
  shader.uniforms.uFogHeightFalloff = uniforms.uFogHeightFalloff;
  shader.uniforms.uFogHeightStrength = uniforms.uFogHeightStrength;
  shader.vertexShader = `varying float vWorldY;
${shader.vertexShader.replace("#include <fog_vertex>", FOG_VERTEX_INJECT)}`;
  shader.fragmentShader = `varying float vWorldY;
uniform float uFogHeightStart;
uniform float uFogHeightFalloff;
uniform float uFogHeightStrength;
${shader.fragmentShader.replace("#include <fog_fragment>", FOG_FRAGMENT_REPLACE)}`;
}
