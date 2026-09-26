import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  ShaderChunk,
  type Texture,
  UnsignedByteType,
} from "three";
import { decodeGreyPng } from "@/lib/city/png-raster";
import {
  FACADE_SVF_GAIN,
  FACADE_SVF_OFFSET_M,
  HORIZON_AZIMUTHS,
  HORIZON_LAYERS,
  HORIZON_MAX_DEG,
  HORIZON_SOFT_DEG,
  HORIZON_TEXTURE_LAYERS,
  NEAR_BAND_FADE_FROM,
  NEAR_MAX_DEG,
} from "@/lib/city/skyview";
import { isAbortError } from "./fetch-optional";
import { sceneShared, textureBytes, trackTexture } from "./three-utils";

/**
 * The city's large-scale light (plan 033), from two baked rasters
 * (pipeline/bake/skyview.py; constants in lib/city/skyview.ts):
 *
 * - **Himmelslicht** (sky-view factor): the fraction of the sky a point
 *   sees within 150 m scales the INDIRECT diffuse light only — the
 *   hemisphere fill that lit a narrow courtyard as brightly as the open
 *   Elbwiesen. It runs in `aomap_fragment` (after `lights_fragment_end`),
 *   so the sun's direct light is untouched. Terrain and clay facades.
 * - **Ferne Schatten** (horizon): per texel the skyline's elevation angle
 *   in 16 azimuths, in two bands — occluders 80–1 500 m out, and 8–80 m
 *   out. Where the sun stands below it, the sun's direct light is cut: the
 *   long low-sun shadows the shadow map's frustum ends, and beyond the
 *   frustum the shadows of the buildings next door. Inside the frustum the
 *   shadow map has the near occluders (with their shapes), so the near band
 *   only fades in over the frustum's last 20 % (`uShadowReach`, kept by the
 *   sun rig) and counts whole beyond it. Combined with the shadow map by
 *   `min`, never a product: where both see the same occluder it must not
 *   darken twice. Terrain only (the plan's facade step waits on plates).
 *
 * Both rows at 0 are the picture without them.
 */

/** Declarations for the terrain's fragment (after the ground detail's,
 *  which declare `uSunDir`). */
export function skyLightDecl(hasSvf: boolean, hasHorizon: boolean): string {
  const svf = hasSvf
    ? /* glsl */ `
  uniform sampler2D uSvf;
  uniform float uSkyView;`
    : "";
  const horizon = hasHorizon
    ? /* glsl */ `
  uniform mediump sampler2DArray uHorizon;
  uniform float uHorizonShade;
  // the shadow frustum: its centre (data frame, m) and half-size
  uniform vec3 uShadowReach;
  // Azimuth k's horizon angle (°) at uv in the band whose planes start at
  // layer base: layer base + k / 4, channel k % 4.
  float hzAngle( vec2 uv, float k, float base, float maxDeg ) {
    vec4 v = texture( uHorizon, vec3( uv, base + floor( k / 4.0 ) ) );
    float c = mod( k, 4.0 );
    float s = c < 0.5 ? v.r : c < 1.5 ? v.g : c < 2.5 ? v.b : v.a;
    return s * maxDeg;
  }
  float hzClears( float h, float el ) {
    return smoothstep( h - ${HORIZON_SOFT_DEG.toFixed(2)}, h + ${HORIZON_SOFT_DEG.toFixed(2)}, el );
  }
  // The near band's weight: 0 inside the shadow frustum, 1 beyond it
  // (lib/city/skyview.ts nearBandWeight).
  float hzNearWeight() {
    float r = max( uShadowReach.z, 1.0 );
    return smoothstep( r * ${NEAR_BAND_FADE_FROM.toFixed(2)}, r, distance( vWorldXY, uShadowReach.xy ) );
  }
  // How much of the sun clears the skyline (1 = all), before the row
  // (lib/city/skyview.ts horizonSunVisibility).
  float hzSunVisible( vec2 uv ) {
    // straight overhead the azimuth is undefined, and the sun clears all
    if ( length( uSunDir.xz ) < 1e-4 ) return 1.0;
    // world (x, y, z) = data (x, -z, y): azimuth clockwise from north
    float el = degrees( asin( clamp( uSunDir.y, -1.0, 1.0 ) ) );
    float az = mod( degrees( atan( uSunDir.x, -uSunDir.z ) ) + 360.0, 360.0 );
    float f = az / ${(360 / HORIZON_AZIMUTHS).toFixed(1)};
    float k0 = mod( floor( f ), ${HORIZON_AZIMUTHS.toFixed(1)} );
    float k1 = mod( k0 + 1.0, ${HORIZON_AZIMUTHS.toFixed(1)} );
    float far = hzClears( mix( hzAngle( uv, k0, 0.0, ${HORIZON_MAX_DEG.toFixed(1)} ), hzAngle( uv, k1, 0.0, ${HORIZON_MAX_DEG.toFixed(1)} ), fract( f ) ), el );
    float w = hzNearWeight();
    if ( w <= 0.0 ) return far;
    float hn = mix( hzAngle( uv, k0, ${HORIZON_LAYERS.toFixed(1)}, ${NEAR_MAX_DEG.toFixed(1)} ), hzAngle( uv, k1, ${HORIZON_LAYERS.toFixed(1)}, ${NEAR_MAX_DEG.toFixed(1)} ), fract( f ) );
    return min( far, mix( 1.0, hzClears( hn, el ), w ) );
  }`
    : "";
  return `${svf}${horizon}`;
}

/** The terrain's per-fragment terms (in the colour body, before the lights):
 *  `skySvf` and `hzLit`, each 1 where its raster is absent. */
export function skyLightBody(hasSvf: boolean, hasHorizon: boolean): string {
  return /* glsl */ `
  float skySvf = ${hasSvf ? "texture2D( uSvf, vSplatUv ).r" : "1.0"};
  float hzLit = ${hasHorizon ? "mix( 1.0, hzSunVisible( vSplatUv ), uHorizonShade )" : "1.0"};
`;
}

/** The indirect-diffuse scale, after the (empty) ambient-occlusion chunk. */
export const SKY_VIEW_AO = /* glsl */ `
  #include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mix( 1.0, skySvf, uSkyView );
`;

const DIR_SHADOW =
  /getShadow\( directionalShadowMap\[ i \], [^;]*?vDirectionalShadowCoord\[ i \] \)/u;
const DIR_INFO = "getDirectionalLightInfo( directionalLight, directLight );";

/**
 * three's `lights_fragment_begin` with the horizon folded into the
 * directional light: `min( shadow map, hzLit )` where the light casts, and
 * `hzLit` alone where it does not. Throws when three's chunk no longer has
 * the lines it patches (caught by the unit test on an upgrade).
 */
export function lightsWithFarShadow(
  chunk: string = ShaderChunk.lights_fragment_begin
): string {
  if (!(DIR_SHADOW.test(chunk) && chunk.includes(DIR_INFO))) {
    throw new Error("lights_fragment_begin: directional shadow line not found");
  }
  return chunk
    .replace(DIR_SHADOW, (m) => `min( ${m}, hzLit )`)
    .replace(
      DIR_INFO,
      `${DIR_INFO}
		#if !( defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS ) )
		directLight.color *= hzLit;
		#endif`
    );
}

// --- the clay facades --------------------------------------------------------------

/** Clay fragment declarations: the tile's sky view (a white texel until it
 *  lands) and where it lies in the data frame. */
export const CLAY_SKY_DECL = /* glsl */ `
uniform sampler2D uSvf;
uniform vec2 uSvfOrigin;
uniform vec2 uSvfSize;
uniform float uSkyView;
`;

/**
 * A facade's ambient scale: the ground's sky view a little outside the wall
 * (under the roof the ground sees no sky), doubled (a vertical face sees at
 * most half the sky, the ground at its foot the wall too), faded to the
 * open sky toward the eaves — a courtyard's ground floor is dim, its eaves
 * are not. Roofs sit above the eaves: unchanged. Needs `clayH`, `vClayWP`,
 * `vClayWN` and `vClayBuild` (visual-style.ts). lib/city/skyview.ts
 * `facadeSkyView` is the same curve.
 */
export const CLAY_SKY_AO = /* glsl */ `
  #include <aomap_fragment>
  {
    vec2 csN = vec2( vClayWN.x, -vClayWN.z );
    float csL = length( csN );
    vec2 csP = vec2( vClayWP.x, -vClayWP.z ) + ( csL > 1e-3 ? csN / csL : vec2( 0.0 ) ) * ${FACADE_SVF_OFFSET_M.toFixed(1)};
    vec2 csUv = vec2( ( csP.x - uSvfOrigin.x ) / uSvfSize.x, ( uSvfOrigin.y - csP.y ) / uSvfSize.y );
    float csSvf = min( texture2D( uSvf, csUv ).r * ${FACADE_SVF_GAIN.toFixed(1)}, 1.0 );
    csSvf = mix( csSvf, 1.0, smoothstep( 0.0, max( vClayBuild.z, 3.0 ), clayH ) );
    reflectedLight.indirectDiffuse *= mix( 1.0, csSvf, uSkyView );
  }
`;

const white = sceneShared(() => {
  const texture = new DataTexture(
    new Uint8Array([255]),
    1,
    1,
    RedFormat,
    UnsignedByteType
  );
  texture.needsUpdate = true;
  return texture;
});
/** The 1×1 sky view "all sky" a clay tile binds until its raster lands;
 *  disposed with the last app that holds it (`retainOpenSkyTexture`). */
export function openSkyTexture(): DataTexture {
  return white.get();
}

/** An app's hold on the open-sky texel; call the result on dispose. */
export const retainOpenSkyTexture = white.retain;

// --- loading -------------------------------------------------------------------------

/** Drops the CPU copy once the GPU has it (as terrain-layer's rasters do). */
function releaseAfterUpload(texture: Texture): void {
  texture.onUpdate = () => {
    (texture.image as { data: Uint8Array | null }).data = null;
    texture.onUpdate = null;
  };
}

async function fetchGrey(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return decodeGreyPng(new Uint8Array(await res.arrayBuffer()));
}

/**
 * The sky-view raster as a RED texture, LINEAR + mipmapped (a soft field).
 * Decoded by the viewer's own PNG decoder, never the browser's. Absent or
 * undecodable → null (the light stays as it was); rethrows an abort.
 */
export async function loadSkyViewTexture(
  url: string,
  signal?: AbortSignal
): Promise<Texture | null> {
  try {
    const raster = await fetchGrey(url, signal);
    const texture = new DataTexture(
      raster.data,
      raster.width,
      raster.height,
      RedFormat,
      UnsignedByteType
    );
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.colorSpace = NoColorSpace;
    texture.needsUpdate = true;
    releaseAfterUpload(texture);
    trackTexture(texture, textureBytes(raster.width, raster.height, 1, true));
    return texture;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * The horizon raster as an 8-layer RGBA array texture (the far band's four
 * planes, then the near band's): the PNG is the planes stacked
 * north-to-south, each n rows of n RGBA texels with the bytes interleaved —
 * exactly a DataArrayTexture's layer-major layout. LINEAR (the angles
 * interpolate), no mipmaps. Absent, or an older one-band raster → null.
 */
export async function loadHorizonTexture(
  url: string,
  signal?: AbortSignal
): Promise<DataArrayTexture | null> {
  try {
    const raster = await fetchGrey(url, signal);
    const n = raster.width / 4;
    if (raster.height !== n * HORIZON_TEXTURE_LAYERS) {
      return null;
    }
    const texture = new DataArrayTexture(
      raster.data,
      n,
      n,
      HORIZON_TEXTURE_LAYERS
    );
    texture.format = RGBAFormat;
    texture.type = UnsignedByteType;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    texture.needsUpdate = true;
    releaseAfterUpload(texture);
    trackTexture(
      texture,
      textureBytes(n, n * HORIZON_TEXTURE_LAYERS, 4, false)
    );
    return texture;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}
