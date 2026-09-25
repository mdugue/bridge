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

import { Vector4 } from "three";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";

/** Shape passed to a material's `onBeforeCompile` (the bits we touch). */
export interface OnBeforeCompileShader {
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

export interface HeightFogUniforms {
  /**
   * The site's extent in world XZ (minX, minZ, maxX, maxZ). Terrain and
   * everything on it dissolve into the fog colour over the last
   * `SITE_EDGE_FADE_M` before this edge, so the data's end reads as haze
   * rather than a cut against the sky. Infinite = no edge haze.
   */
  uFogSiteRect: { value: Vector4 };
  /** metres of fade above the start over which the height haze decays to 0 */
  uFogHeightFalloff: { value: number };
  /** world-Y (elevation, m) below which the extra haze pools */
  uFogHeightStart: { value: number };
  /** 0..1 — extra haze added toward the palette fog colour in low ground */
  uFogHeightStrength: { value: number };
}

/** Default fade height (m) above the valley floor — ~the Elbe-to-rim drop. */
const DEFAULT_FALLOFF = 28;

/**
 * Width (m) of the haze band inside the site's outer edge. Wide enough that
 * the tile edge (and the terrain skirt under it) is fully fogged before the
 * data stops, narrow enough that the walkable city keeps its colour.
 */
export const SITE_EDGE_FADE_M = 450;

export function createHeightFogUniforms(): HeightFogUniforms {
  const far = 1e9;
  return {
    uFogSiteRect: { value: new Vector4(-far, -far, far, far) },
    uFogHeightStart: { value: 0 },
    uFogHeightFalloff: { value: DEFAULT_FALLOFF },
    uFogHeightStrength: { value: LOOK_DEFAULTS.heightFog },
  };
}

// vFogWP = TRUE world position (Y = elevation): modelMatrix bakes the −90°
// world rotation for terrain/buildings, and is ~identity for the Y-up
// vegetation/scene — so the same expression is correct everywhere. Guarded for
// instanced meshes.
const FOG_VERTEX_INJECT = `#include <fog_vertex>
#ifdef USE_INSTANCING
	vFogWP = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
	vFogWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`;

// Builds ON the existing distance fogFactor (never replaces it): only adds haze
// toward fogColor in low+near ground, so distant high ground still hazes normally.
const FOG_FRAGMENT_REPLACE = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float heightMask = 1.0 - smoothstep( uFogHeightStart, uFogHeightStart + uFogHeightFalloff, vFogWP.y );
	fogFactor = clamp( fogFactor + uFogHeightStrength * heightMask * ( 1.0 - fogFactor ), 0.0, 1.0 );
	// Site-edge haze: the data ends at the outer tile edge, so let the world
	// dissolve into the fog colour over the last stretch before it. Never on
	// what is right in front of the camera (the depth ramp), so walking along
	// the edge does not wade through a wall of mist.
	vec2 edgeD = min( vFogWP.xz - uFogSiteRect.xy, uFogSiteRect.zw - vFogWP.xz );
	float edgeHaze = 1.0 - smoothstep( 0.0, ${SITE_EDGE_FADE_M.toFixed(1)}, min( edgeD.x, edgeD.y ) );
	edgeHaze *= smoothstep( 60.0, 600.0, vFogDepth );
	fogFactor = max( fogFactor, edgeHaze * edgeHaze * ( 3.0 - 2.0 * edgeHaze ) );
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
  shader.uniforms.uFogSiteRect = uniforms.uFogSiteRect;
  shader.uniforms.uFogHeightStart = uniforms.uFogHeightStart;
  shader.uniforms.uFogHeightFalloff = uniforms.uFogHeightFalloff;
  shader.uniforms.uFogHeightStrength = uniforms.uFogHeightStrength;
  shader.vertexShader = `varying vec3 vFogWP;
${shader.vertexShader.replace("#include <fog_vertex>", FOG_VERTEX_INJECT)}`;
  shader.fragmentShader = `varying vec3 vFogWP;
uniform vec4 uFogSiteRect;
uniform float uFogHeightStart;
uniform float uFogHeightFalloff;
uniform float uFogHeightStrength;
${shader.fragmentShader.replace("#include <fog_fragment>", FOG_FRAGMENT_REPLACE)}`;
}
