import {
  type BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  type Texture,
  Vector3,
} from "three";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import type { SplatLayer } from "./terrain-layer";

/** Default river-mist strength (0..1). */
export const DEFAULT_WATER_MIST = 0.6;

/** Animated water surface, masked to the land-cover "water" class (id 8). */
export interface WaterLayer {
  mesh: Mesh;
  /** drifting river-haze sheet (added to the Z-up `world`, like the water) */
  mistMesh: Mesh;
  /** 0..1 — river-mist (Flussnebel) strength */
  setMist: (strength: number) => void;
  /**
   * Advance the ripple + glitter animation (elapsed seconds) and refresh the
   * Fresnel sky-tint colour, kept in lockstep with the time-of-day palette.
   */
  update: (seconds: number, skyColor: Color) => void;
}

// Drifting river haze as a SINGLE masked sheet sharing the Z-up terrain geometry
// (the right tool — thousands of particles over a river is not). A scrolling
// ≤3-octave fbm "steam" band, gated to the water class, tinted from the same
// palette sky colour as the water. `depthWrite:false` so it never punches the
// composer's shared depth (DoF would otherwise focus on the haze).
const MIST_VERT = /* glsl */ `
  varying vec2 vSplatUv;
  varying vec2 vMistXY;
  uniform vec2 uOrigin;
  uniform vec2 uSize;
  void main() {
    vSplatUv = vec2( ( position.x - uOrigin.x ) / uSize.x, ( uOrigin.y - position.y ) / uSize.y );
    vMistXY = position.xy;
    // Float the sheet a few metres above the water (Z is data-frame up here) so
    // it has vertical presence — a sheet lying ON the water is edge-on (and so
    // invisible) from street level.
    vec3 raised = vec3( position.x, position.y, position.z + 4.0 );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( raised, 1.0 );
  }
`;
const MIST_FRAG = /* glsl */ `
  varying vec2 vSplatUv;
  varying vec2 vMistXY;
  uniform sampler2D uSplat;
  uniform float uTime;
  uniform vec3 uSkyTint;
  uniform float uStrength;
  float mistHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float mistNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mistHash( i ), mistHash( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( mistHash( i + vec2( 0.0, 1.0 ) ), mistHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }
  float mistFbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 3; i++ ) { v += a * mistNoise( p ); p *= 2.0; a *= 0.5; }
    return v;
  }
  void main() {
    float cov = texture2D( uSplat, vSplatUv ).a;
    if ( cov <= 0.02 ) discard;
    // Feather the shoreline with a WIDE band and square it so the bank dissolves
    // gradually instead of ending on a hard edge.
    float wcov = smoothstep( 0.1, 0.95, cov );
    wcov *= wcov;
    // Continuous density (no hard threshold): a soft floor + gentle fbm swell, so
    // the mist has soft internal variation and no crisp blob/cutout edges.
    vec2 q = vMistXY * 0.025 + vec2( uTime * 0.018, uTime * 0.012 );
    float steam = mix( 0.35, 1.0, smoothstep( 0.1, 0.9, mistFbm( q ) ) );
    float alpha = wcov * steam * uStrength * 0.8;
    if ( alpha <= 0.001 ) discard;
    // Near-white warm haze (brighter than the sky tint) so it clearly reads as
    // mist over the pale water rather than blending into it.
    vec3 mistCol = mix( uSkyTint, vec3( 1.0 ), 0.65 );
    gl_FragColor = vec4( mistCol, alpha );
  }
`;

function createWaterMist(
  geometry: BufferGeometry,
  maskTexture: Texture,
  origin: number[],
  size: number[],
  uTime: { value: number },
  uSkyTint: { value: Color }
): { mesh: Mesh; setMist: (strength: number) => void } {
  const uStrength = { value: DEFAULT_WATER_MIST };
  const material = new ShaderMaterial({
    uniforms: {
      uSplat: { value: maskTexture },
      uTime,
      uOrigin: { value: origin },
      uSize: { value: size },
      uSkyTint,
      uStrength,
    },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "water-mist";
  mesh.renderOrder = 3; // after the water sheet (2)
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = DEFAULT_WATER_MIST > 0.001;
  return {
    mesh,
    setMist: (strength) => {
      const v = Math.min(Math.max(strength, 0), 1);
      uStrength.value = v;
      // Drop the sheet from the render submission entirely when off (mirrors the
      // lamp-glow visibility gate — keep additive overdraw fading to 0).
      mesh.visible = v > 0.001;
    },
  };
}

/**
 * A translucent water sheet that re-uses the terrain geometry (so it drapes on
 * the same heightfield) but discards every fragment whose land-cover class is
 * not water. Built on MeshStandardMaterial so the scene's sun, shadows and fog
 * apply for free; a cheap sine-wave normal wobble gives stylized movement.
 *
 * On top of the base sheet it fakes poetic water at standard-material cost (no
 * `transmission`): a view-angle Fresnel sky-tint (mirrors the sky colour at
 * grazing angles), a tight additive sun-glitter lobe that fades out at night,
 * and a feathered shoreline. The Fresnel/glitter need world (Y-up) vectors, so
 * they are derived from a world-space varying (`vWaterWP`) and `cameraPosition`,
 * NOT the data-frame ripple normal used for shading.
 *
 * Geometry is SHARED with the terrain mesh — do not dispose it here.
 */
export function createWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer,
  sunDirection?: Vector3,
  heightFog?: HeightFogUniforms
): WaterLayer {
  const uTime = { value: 0 };
  // Shared, by-reference: the sun rig mutates sunDirection (surface→sun, Y-up
  // world) in place; the sky tint is refreshed each frame from the fog palette.
  const uSunDir = { value: sunDirection ?? new Vector3(0, 1, 0) };
  const uSkyTint = { value: new Color(0x9f_b6_cc) };
  const uSunColor = { value: new Color(0xff_f4_e0) };
  const uFresnel = { value: 0.55 };
  const uGlitter = { value: 0.7 };
  const [minX, minY, maxX, maxY] = splat.bounds;
  const origin = [minX - splat.offset.cx, maxY - splat.offset.cy];
  const size = [maxX - minX, maxY - minY];

  const material = new MeshStandardMaterial({
    color: 0x86_a8_c4,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.8,
    // Pull slightly towards camera so it never z-fights the shared terrain.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // Sample the LINEAR + mipmapped + anisotropic colour splat's ALPHA channel
  // for water coverage — the GPU anti-aliases the shoreline at grazing angles,
  // unlike the NEAREST class raster which stair-stepped.
  const maskTexture = splat.colorTexture ?? splat.texture;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: maskTexture };
    shader.uniforms.uTime = uTime;
    shader.uniforms.uOrigin = { value: origin };
    shader.uniforms.uSize = { value: size };
    shader.uniforms.uSunDir = uSunDir;
    shader.uniforms.uSkyTint = uSkyTint;
    shader.uniforms.uSunColor = uSunColor;
    shader.uniforms.uFresnel = uFresnel;
    shader.uniforms.uGlitter = uGlitter;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vSplatUv;
         varying vec2 vWorldXY;
         varying vec3 vWaterWP;
         uniform vec2 uOrigin;
         uniform vec2 uSize;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vSplatUv = vec2( ( position.x - uOrigin.x ) / uSize.x, ( uOrigin.y - position.y ) / uSize.y );
         vWorldXY = position.xy;
         // World (Y-up) position — modelMatrix bakes the -90° world rotation.
         vWaterWP = ( modelMatrix * vec4( position, 1.0 ) ).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vSplatUv;
         varying vec2 vWorldXY;
         varying vec3 vWaterWP;
         uniform sampler2D uSplat;
         uniform float uTime;
         uniform vec3 uSunDir;
         uniform vec3 uSkyTint;
         uniform vec3 uSunColor;
         uniform float uFresnel;
         uniform float uGlitter;`
      )
      // Water coverage = the splat's alpha channel, sampled LINEAR + mipmapped
      // + anisotropic, so the shoreline is hardware anti-aliased (straight, no
      // stair-steps). A widened, feathered band dissolves the bank instead of
      // stair-stepping. Then a view-angle Fresnel tints toward the sky colour.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         float wcov = smoothstep( 0.28, 0.72, texture2D( uSplat, vSplatUv ).a );
         if ( wcov <= 0.001 ) discard;
         diffuseColor.a *= wcov;
         vec3 wtrV = normalize( cameraPosition - vWaterWP );
         float wtrFres = pow( 1.0 - clamp( wtrV.y, 0.0, 1.0 ), 4.0 );
         diffuseColor.rgb = mix( diffuseColor.rgb, uSkyTint, wtrFres * uFresnel );`
      )
      // Stylized ripples: perturb the shading normal with crossing sine waves
      // (data-frame normal, so normal.z is data-up).
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         float wv = sin( vWorldXY.x * 0.35 + uTime * 0.8 )
                  + sin( vWorldXY.y * 0.27 - uTime * 0.6 );
         float wu = sin( ( vWorldXY.x + vWorldXY.y ) * 0.20 + uTime * 0.5 );
         normal = normalize( normal + vec3( wv, wu, 0.0 ) * 0.06 );`
      )
      // Sun glitter: a tight specular lobe off a SEPARATE Y-up ripple normal
      // (the shading normal above is data-frame), so it reads as a real
      // highlight. Gated by clamp(uSunDir.y) so it vanishes after sunset.
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
         float gWv = sin( vWorldXY.x * 0.35 + uTime * 0.8 ) + sin( vWorldXY.y * 0.27 - uTime * 0.6 );
         float gWu = sin( ( vWorldXY.x + vWorldXY.y ) * 0.20 + uTime * 0.5 );
         vec3 wtrN = normalize( vec3( gWv * 0.12, 1.0, gWu * 0.12 ) );
         vec3 wtrH = normalize( wtrV + uSunDir );
         float wtrSpec = pow( clamp( dot( wtrN, wtrH ), 0.0, 1.0 ), 120.0 );
         totalEmissiveRadiance += wtrSpec * uGlitter * clamp( uSunDir.y, 0.0, 1.0 ) * uSunColor;`
      );

    // Valley height-fog so the river pools with the same haze as the terrain
    // (without it the water sheet floats out of the haze — a visible seam).
    if (heightFog) {
      injectHeightFog(shader, heightFog);
    }
  };

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 2; // after the opaque terrain fill
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // River mist: a second masked sheet on the SAME (shared) geometry. Shares
  // uTime + uSkyTint so update() drives both in lockstep.
  const mist = createWaterMist(
    geometry,
    maskTexture,
    origin,
    size,
    uTime,
    uSkyTint
  );

  return {
    mesh,
    mistMesh: mist.mesh,
    setMist: mist.setMist,
    update: (seconds, skyColor) => {
      uTime.value = seconds;
      uSkyTint.value.copy(skyColor);
    },
  };
}
