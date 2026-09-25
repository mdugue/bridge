import {
  type BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  type Texture,
  Vector3,
} from "three";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { DATA_POSITION } from "./shader-chunks";
import type { SplatLayer } from "./terrain-layer";

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

/**
 * Water coverage at a splat uv, as a GLSL helper over the bound `uSplat`: the
 * ALPHA channel of the palette-painted colour splat (landcover-splat.ts), a
 * soft coverage field sampled LINEAR + mipmapped + anisotropic, so the
 * shoreline is hardware anti-aliased.
 */
const WATER_COVERAGE =
  "float waterCoverage( vec2 uv ) { return texture2D( uSplat, uv ).a; }";

// Drifting river haze as a SINGLE masked sheet sharing the Z-up terrain geometry
// (the right tool — thousands of particles over a river is not). A scrolling
// ≤3-octave fbm "steam" band, gated to the water class, tinted from the same
// palette sky colour as the water. `depthWrite:false` so it never punches the
// composer's shared depth (DoF would otherwise focus on the haze).
const MIST_VERT = /* glsl */ `
  varying vec2 vSplatUv;
  varying vec2 vMistXY;
  varying vec3 vMistWP;
  uniform vec2 uOrigin;
  uniform vec2 uSize;
  void main() {
    vec3 transformed = position;
    ${DATA_POSITION}
    vSplatUv = vec2( ( dataPos.x - uOrigin.x ) / uSize.x, ( uOrigin.y - dataPos.y ) / uSize.y );
    vMistXY = dataPos.xy;
    // Float the sheet a few metres above the water (world Y is up) so it has
    // vertical presence — a sheet lying ON the water is edge-on (and so
    // invisible) from street level.
    vec4 wp = dataWP + vec4( 0.0, 4.0, 0.0, 0.0 );
    vMistWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const MIST_FRAG = /* glsl */ `
  varying vec2 vSplatUv;
  varying vec2 vMistXY;
  varying vec3 vMistWP;
  uniform sampler2D uSplat;
  uniform vec2 uSize;
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
  // Water coverage blurred over tens of metres: the colour splat's alpha read
  // from a coarse mip (bias) at five spread taps. The shoreline in the splat
  // is ~1 m wide, which is what made the mist end on a crisp outline of the
  // river; the haze has to thin out over the banks instead.
  float mistCoverage( vec2 uv ) {
    vec2 o = 18.0 / uSize;
    float c = texture2D( uSplat, uv, 5.0 ).a * 0.4;
    c += texture2D( uSplat, uv + vec2( o.x, 0.0 ), 5.0 ).a * 0.15;
    c += texture2D( uSplat, uv - vec2( o.x, 0.0 ), 5.0 ).a * 0.15;
    c += texture2D( uSplat, uv + vec2( 0.0, o.y ), 5.0 ).a * 0.15;
    c += texture2D( uSplat, uv - vec2( 0.0, o.y ), 5.0 ).a * 0.15;
    return c;
  }
  void main() {
    float cov = mistCoverage( vSplatUv );
    if ( cov <= 0.01 ) discard;
    // Broad feather, then a smooth cubic so the haze has no visible rim.
    float wcov = smoothstep( 0.02, 0.85, cov );
    wcov = wcov * wcov * ( 3.0 - 2.0 * wcov );
    // Two slowly drifting fbm layers at different scales and directions:
    // large soft banks and thinner wisps, no threshold anywhere, so the density
    // varies continuously instead of forming blobs with edges.
    vec2 q = vMistXY * 0.012 + vec2( uTime * 0.010, uTime * 0.006 );
    vec2 r = vMistXY * 0.031 - vec2( uTime * 0.004, uTime * 0.013 );
    float banks = smoothstep( 0.15, 0.85, mistFbm( q ) );
    float wisps = mistFbm( r + banks * 1.7 );
    float steam = mix( 0.25, 1.0, banks ) * mix( 0.7, 1.15, wisps );
    // A sheet has an outline where it meets the eye up close: thin it out in
    // the first tens of metres so it reads as air, not as a plane.
    float dist = length( cameraPosition - vMistWP );
    float nearFade = smoothstep( 8.0, 90.0, dist );
    float alpha = wcov * steam * nearFade * uStrength * 0.62;
    if ( alpha <= 0.002 ) discard;
    // Near-white warm haze (brighter than the sky tint) so it clearly reads as
    // mist over the pale water rather than blending into it.
    vec3 mistCol = mix( uSkyTint, vec3( 1.0 ), 0.6 );
    gl_FragColor = vec4( mistCol, alpha );
  }
`;

function createWaterMist(
  geometry: BufferGeometry,
  mask: Texture,
  origin: number[],
  size: number[],
  uTime: { value: number },
  uSkyTint: { value: Color }
): { mesh: Mesh; setMist: (strength: number) => void } {
  const uStrength = { value: LOOK_DEFAULTS.waterMist };
  const material = new ShaderMaterial({
    uniforms: {
      uSplat: { value: mask },
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
  mesh.visible = LOOK_DEFAULTS.waterMist > 0.001;
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
 * Geometry is SHARED with the terrain mesh — do not dispose it here. Both
 * sheets sit beside the terrain mesh with its transform.
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
  const uFresnel = { value: 0.4 };
  const uGlitter = { value: 0.7 };
  const [minX, minY, maxX, maxY] = splat.bounds;
  const origin = [minX - splat.offset.cx, maxY - splat.offset.cy];
  const size = [maxX - minX, maxY - minY];

  const material = new MeshStandardMaterial({
    color: 0x7a_9e_bc,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    // Pull slightly towards camera so it never z-fights the shared terrain.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // The colour splat's ALPHA channel is the water coverage (see WATER_COVERAGE).
  const mask = splat.colorTexture;
  // The emitted GLSL branches on `heightFog`, but three keys its program cache
  // on `onBeforeCompile.toString()` — identical for every tile's material.
  material.customProgramCacheKey = () => `water-${heightFog !== undefined}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: mask };
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
         ${DATA_POSITION}
         vSplatUv = vec2( ( dataPos.x - uOrigin.x ) / uSize.x, ( uOrigin.y - dataPos.y ) / uSize.y );
         vWorldXY = dataPos.xy;
         vWaterWP = dataWP.xyz;`
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
         uniform float uGlitter;
         ${WATER_COVERAGE}`
      )
      // A widened, feathered band dissolves the bank instead of stair-stepping.
      // Then a view-angle Fresnel tints toward the sky colour.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         float wcov = smoothstep( 0.28, 0.72, waterCoverage( vSplatUv ) );
         if ( wcov <= 0.001 ) discard;
         diffuseColor.a *= wcov;
         // Depth by distance from the bank, as on a drawn map: the coverage
         // read from a coarse mip (~30 m) is 1 mid-stream and falls toward
         // the shore, so the channel deepens in tone and the shallows lighten.
         float wDeep = smoothstep( 0.55, 1.0, texture2D( uSplat, vSplatUv, 6.0 ).a );
         diffuseColor.rgb *= mix( vec3( 1.1, 1.08, 1.04 ), vec3( 0.86, 0.92, 0.98 ), wDeep );
         vec3 wtrV = normalize( cameraPosition - vWaterWP );
         float wtrFres = pow( 1.0 - clamp( wtrV.y, 0.0, 1.0 ), 4.0 );
         diffuseColor.rgb = mix( diffuseColor.rgb, uSkyTint, wtrFres * uFresnel );`
      )
      // Stylized ripples: perturb the shading normal with crossing sine waves
      // (data-frame normal, so normal.z is data-up).
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         // The sheet shares the terrain's grid, whose normals carry the
         // DGM's noisy river surface (and 8-bit quantisation): lit, that
         // painted the Elbe in dark blotches. Water is level — start from up.
         normal = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
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
  const mist = createWaterMist(geometry, mask, origin, size, uTime, uSkyTint);

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
