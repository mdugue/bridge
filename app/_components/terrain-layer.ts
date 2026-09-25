import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Texture,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer,
} from "three";
import {
  sampleHeightfield,
  type TerrainBounds,
} from "@/lib/city/terrain-geometry";
import {
  LANDCOVER_CLASSES,
  MEADOW_CLASS,
  ROAD_CLASS,
  srgbToLinear,
} from "@/lib/city/landcover";
import { decodeGreyPng, type GreyRaster } from "@/lib/city/png-raster";
import { packSportTable, type SportTable } from "@/lib/city/sport";
import { TinIndex } from "@/lib/city/terrain-tin";
import type { TerrainExtras } from "@/lib/city/tileset";
import { fetchOptionalJson, isAbortError } from "./fetch-optional";
import {
  GROUND_DETAIL,
  GROUND_NORMAL,
  groundDetailDecl,
  groundFields,
  urbanGreen,
} from "./ground-detail";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { DATA_POSITION } from "./shader-chunks";
import { SPORT_DECL, SPORT_GROUND, sportPalette } from "./sport-ground";
import { type LandcoverSplat, paintLandcoverSplat } from "./landcover-splat";
import { textureBytes, trackTexture } from "./three-utils";
import { createWaterLayer, type WaterLayer } from "./water-layer";

/**
 * One tile's terrain at one level: the baked glTF mesh (scripts/bake-tiles.ts,
 * streamed by tile-stream.ts) dressed with the land-cover material, its
 * water and mist sheets, and a ground-height sampler read from its grid —
 * or, on the fine level, from its TIN's triangles.
 */
export interface TerrainLayer {
  /** [minX, minY, maxX, maxY] in the projected CRS */
  bounds: TerrainBounds;
  /** Frees the rasters (the tile's geometry and materials go with it). */
  dispose: () => void;
  /** bilinear elevation lookup at projected (not recentered) coordinates */
  heightAt: (x: number, y: number) => number | null;
  level: 0 | 1;
  mesh: Mesh;
  /** the tile's baked stairs (fine level only; stair-layer.ts) */
  stairs?: Mesh;
  /** the tile's baked kerb stones (fine level only; kerb-layer.ts) */
  kerbs?: Mesh;
  /** the tile's baked walls (fine level only; wall-layer.ts) */
  walls?: Mesh;
  /** lowest valid elevation (m) on this tile — the valley/river floor */
  minElevation: number;
  tile: string;
  vertexCount: number;
  /** animated water surface, present only when the class raster loaded */
  water?: WaterLayer;
}

export interface TerrainOptions {
  /** resolves a file named in the tile's extras to its URL */
  fileUrl: (file: string) => string;
  /** shared valley height-fog uniforms (by reference); patched into the
   * terrain + water materials so the river/floor pools haze without a seam */
  heightFog?: HeightFogUniforms;
  /** phones sample the ≤ 2048² class raster */
  lowRasters: boolean;
  /** the ground's look strengths (by reference) for the HUD sliders */
  ground?: GroundUniforms;
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** paints the colour splat from the class raster (one GPU pass) */
  renderer: WebGLRenderer;
  /** aborts the raster downloads */
  signal?: AbortSignal;
  /** shared world (Y-up) sun direction, read by the water Fresnel/glitter */
  sunDirection?: Vector3;
}

/**
 * The terrain's look rows, shared by reference with every tile's material so
 * a slider retunes them live (a uniform write, no recompile).
 */
export interface GroundUniforms {
  /** kerbs, lawn edges and paving patterns (ground-detail.ts) */
  groundDetail: { value: number };
  /** the meadow's DOP greenness tint */
  meadowNdvi: { value: number };
  /** meadow colour on green built-up ground (courtyards, parks) */
  urbanGreen: { value: number };
}

/**
 * Loads a single-channel DATA raster (class ids, NDVI) as a RED texture
 * holding exactly the baked bytes. The PNG is inflated and unfiltered here
 * (lib/city/png-raster.ts), not by the browser's image decoder: WebKit
 * colour-manages (and dithers) untagged greyscale even with
 * `colorSpaceConversion: "none"`, which on iPhones rewrote class ids into
 * speckles of the neighbouring classes' colours. The inflate is async and
 * the unfiltering yields every few hundred rows, so a 4096² raster does not
 * stall the frame it streams in with. A PNG the decoder does not handle
 * falls back to the browser (`loadBitmapTexture`). Rejects on a network
 * failure and on abort.
 */
async function loadRasterTexture(
  url: string,
  signal?: AbortSignal,
  channels: 1 | 2 | 4 = 1
): Promise<{ height: number; texture: Texture; width: number }> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  let raster: GreyRaster;
  try {
    raster = await decodeGreyPng(bytes);
  } catch (err) {
    // The browser's decoder cannot de-interleave a multi-channel raster.
    if (channels > 1) {
      throw err;
    }
    return loadBitmapTexture(new Blob([bytes]));
  }
  signal?.throwIfAborted();
  // A two- or four-channel raster is baked as a greyscale PNG two or four
  // times as wide, its bytes interleaved (R0 G0 B0 A0 R1 …) — exactly the
  // RG8 / RGBA8 layout.
  const width = raster.width / channels;
  const { height } = raster;
  const texture = new DataTexture(
    raster.data,
    width,
    height,
    channels === 4 ? RGBAFormat : channels === 2 ? RGFormat : RedFormat,
    UnsignedByteType
  );
  // Row 0 is the PNG's first (northern) row, as with the bitmap upload
  // (flipY = false; v grows southward).
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  // 16 MB of CPU bytes for a 4096² raster: dead weight once the GPU has
  // them (mipmaps are generated on the GPU). Twelve resident copies took
  // mobile Safari past its per-tab memory limit when these were bitmaps.
  texture.onUpdate = () => {
    (texture.image as { data: Uint8Array | null }).data = null;
    texture.onUpdate = null;
  };
  return { texture, width, height };
}

/**
 * The browser-decoded fallback for a raster the PNG decoder rejects:
 * `createImageBitmap` decodes in the browser's image workers, already in the
 * orientation three needs (`imageOrientation: "none"` = flipY false).
 */
async function loadBitmapTexture(
  blob: Blob
): Promise<{ height: number; texture: Texture; width: number }> {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.format = RedFormat;
  texture.needsUpdate = true;
  // Release the decoded pixels right after the upload (see above).
  texture.onUpdate = () => {
    bitmap.close();
    texture.onUpdate = null;
  };
  return { texture, width: bitmap.width, height: bitmap.height };
}

/**
 * Loads the land-cover splatmap as a NEAREST-filtered data texture (class ids
 * must not be interpolated) in linear space (the red channel is a class id,
 * not a colour). Non-fatal: a failure just falls back to the flat sage ground.
 */
async function loadSplatTexture(
  url: string,
  signal?: AbortSignal
): Promise<{ height: number; texture: Texture; width: number } | null> {
  try {
    const loaded = await loadRasterTexture(url, signal);
    const { texture, width, height } = loaded;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    // One byte per texel: the class id is the RED channel.
    trackTexture(texture, textureBytes(width, height, 1, false));
    return loaded;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * Loads the DOP NDVI raster (single-channel greenness) for the meadow tint.
 * LINEAR + mipmaps low-pass the ~2 m raster (the workflow's recommendation), so
 * the meadow colour reads as a smooth gradient. Data values, not colour → no
 * sRGB. Absent/404 → null and the meadow keeps its flat pastel sage.
 */
async function loadNdviTexture(
  url: string,
  signal?: AbortSignal
): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadRasterTexture(url, signal);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.colorSpace = NoColorSpace;
    // Greenness is a single channel too (RED, from loadRasterTexture).
    trackTexture(texture, textureBytes(width, height, 1, true));
    return texture;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * Loads the OSM paving raster (pipeline/bake/surface.py): R = the packed
 * road/walk surface ids and parking kind, G = the street bearing, BA = the
 * along-street offset, NEAREST. Absent or
 * undecodable → null and the ground falls back to the land-cover class's
 * pattern.
 */
async function loadSurfaceTexture(
  url: string,
  signal?: AbortSignal
): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadRasterTexture(url, signal, 4);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    trackTexture(texture, textureBytes(width, height, 4, false));
    return texture;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * Loads the edge-distance raster (pipeline/bake/edges.py): R, G = the
 * signed distances to the road and the meadow edge, LINEAR so the isolines
 * are smooth (no mipmaps: it is only read near the camera). Absent → null
 * and the shader falls back to the class texels.
 */
async function loadEdgesTexture(
  url: string,
  signal?: AbortSignal
): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadRasterTexture(url, signal, 2);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    trackTexture(texture, textureBytes(width, height, 2, false));
    return texture;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * Loads the sports grounds (pipeline/bake/sport.py): the index raster (R =
 * the row, G = the second row, B = the exact bit; NEAREST) and its table as a 2-texel-high float
 * texture (lib/city/sport.ts). Either absent, empty or undecodable → null
 * and the ground under a pitch stays its land-cover class.
 */
async function loadSportGrounds(
  rasterUrl: string,
  tableUrl: string,
  signal?: AbortSignal
): Promise<{ raster: Texture; table: DataTexture } | null> {
  const doc = await fetchOptionalJson<SportTable>(tableUrl, signal);
  if (!doc?.grounds?.length) {
    return null;
  }
  try {
    const { texture, width, height } = await loadRasterTexture(
      rasterUrl,
      signal,
      4
    );
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    trackTexture(texture, textureBytes(width, height, 4, false));
    const packed = packSportTable(doc);
    const table = new DataTexture(
      packed.data,
      packed.width,
      2,
      RGBAFormat,
      FloatType
    );
    table.magFilter = NearestFilter;
    table.minFilter = NearestFilter;
    table.generateMipmaps = false;
    table.needsUpdate = true;
    return { raster: texture, table };
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/** Land-cover splatmap aligned to the terrain, for per-surface tinting. */
export interface SplatLayer {
  bounds: TerrainBounds;
  /** the palette-painted colours (RGB) + water coverage (A); LINEAR +
   *  mipmapped for soft transitions (landcover-splat.ts) */
  colorTexture: Texture;
  /** the look strengths (shared refs, mutated by the HUD sliders) */
  ground?: GroundUniforms;
  /** DOP NDVI raster (LINEAR) for the meadow and urban-green tints */
  ndviTexture?: Texture;
  offset: { cx: number; cy: number };
  /** OSM paving raster (NEAREST, RGBA) for the paving and parking patterns */
  surfaceTexture?: Texture;
  /** baked road/meadow edge distances (LINEAR, RG) for kerbs, lanes, lawns */
  edgesTexture?: Texture;
  /** sports grounds: the index raster (NEAREST, RGBA) and its table */
  sport?: { raster: Texture; table: Texture };
  /** shared world sun direction (surface → sun), for the kerb's shadow */
  sunDirection?: Vector3;
  /** class-id raster (NEAREST); the meadow detail tests it */
  texture: Texture;
}

/**
 * Meadow (class 1) painterly depth, added in the already-running terrain
 * fragment pass — zero geometry. A value mottle (±~6%) plus a faint shading-
 * normal break-up so the grazing sun catches texture; the class id comes from
 * the NEAREST class raster (`uSplatClass`), not RGB colour-distance, which would
 * misfire on the forest/copse/farmland greens. Distance-faded via `fwidth` so it
 * never aliases/shimmers in the far field (the failure mode that got plain
 * foliage translucency rejected as "noise").
 */
const GRASS_MOTTLE = /* glsl */ `
  float grCls = floor( texture2D( uSplatClass, vSplatUv ).r * 255.0 + 0.5 );
  float grMeadow = 1.0 - step( 0.5, abs( grCls - 1.0 ) );
  float grFw = max( fwidth( vWorldXY.x ), fwidth( vWorldXY.y ) );
  float grDetail = grMeadow * ( 1.0 - smoothstep( 0.5, 2.5, grFw ) );
  float grMottle = sin( vWorldXY.x * 0.85 + 1.3 ) * sin( vWorldXY.y * 0.78 - 0.7 ) * 0.7
                 + sin( vWorldXY.x * 2.7 - 0.5 ) * sin( vWorldXY.y * 2.3 + 1.1 ) * 0.3;
  baseCol *= 1.0 + grMottle * 0.035 * grDetail;
`;

/**
 * Calm the ground's shading. The DGM1 carries every kerb, rut and survey
 * wobble, and the baked normals are quantised to 8 bits, so lit by a low
 * sun a street, a meadow or a quay reads as coarse dark-and-light flecks —
 * "dirty" rather than drawn. Near-flat normals (under ~12°) are pulled to
 * straight up, keeping a trace of the relief; real slopes (embankments, the
 * valley sides) keep their full shading, and the contour ink carries the
 * rest of the terrain's form.
 */
const TERRAIN_NORMAL = /* glsl */ `
  #include <normal_fragment_begin>
  vec3 tnUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float tnKeep = 1.0 - smoothstep( 0.93, 0.985, dot( normal, tnUp ) );
  normal = normalize( mix( tnUp, normal, max( tnKeep, 0.12 ) ) );
`;

const GRASS_NORMAL = /* glsl */ `
  ${TERRAIN_NORMAL}
  float grGx = cos( vWorldXY.x * 0.85 + 1.3 ) * sin( vWorldXY.y * 0.78 - 0.7 ) * 0.85;
  float grGy = sin( vWorldXY.x * 0.85 + 1.3 ) * cos( vWorldXY.y * 0.78 - 0.7 ) * 0.78;
  normal = normalize( normal + vec3( grGx, grGy, 0.0 ) * 0.06 * grDetail );
`;

/**
 * Meadow NDVI tint (Wiesenfärbung): on class-1 farmland/meadow only, shift the
 * pastel sage toward lush deep-green where the DOP greenness is high and a drier
 * yellow-tan where it's low — large-area colour variation the flat splat can't
 * give. `grMeadow` (from the class raster) and `baseCol` are in scope from
 * GRASS_MOTTLE; the NDVI is LINEAR-filtered so the ~2 m raster reads smooth, and
 * a tiny `step` gates out zero/nodata texels (keep the base sage, don't grey out).
 */
const MEADOW_NDVI = /* glsl */ `
  // Read from a coarser mip: the 2 m raster carries every path, tree shadow
  // and bare patch, which painted the meadows in dark flecks. Averaged over
  // ~10 m it is what it should be — broad lush and dry drifts.
  float grNdvi = texture2D( uNdvi, vSplatUv, 2.5 ).r;
  float grNdviT = smoothstep( 0.1, 0.6, grNdvi );
  vec3 grTint = mix( baseCol * vec3( 1.08, 1.02, 0.88 ),  // dry: paler warm hay
                     baseCol * vec3( 0.84, 1.06, 0.74 ), grNdviT );  // lush: deeper grass
  baseCol = mix( baseCol, grTint, uMeadowNdvi * grMeadow * step( 0.012, grNdvi ) );
`;

/**
 * Sketch contour lines (2 m minor / 10 m major) on the data-frame elevation,
 * one pixel wide via fwidth. Each set fades out once its lines crowd closer
 * than a few pixels: past that a 1 px line per contour is no longer a line
 * but a grey stipple, and on the gently rolling DGM (streets, meadows, the
 * river surface) it read as dirty blotches across the whole middle distance.
 */
const CONTOUR_INK = /* glsl */ `
  float minorD = vElevation / 2.0;
  float minorW = fwidth( minorD );
  // A flat quad lying exactly on a contour has fwidth 0: 0/0 there striped
  // it with NaN ink (and NaN survives the slope gate's multiply).
  float minor = minorW > 1e-6 ? 1.0 - min( abs( fract( minorD - 0.5 ) - 0.5 ) / minorW, 1.0 ) : 0.0;
  minor *= 1.0 - smoothstep( 0.08, 0.2, minorW );
  float majorD = vElevation / 10.0;
  float majorW = fwidth( majorD );
  float major = majorW > 1e-6 ? 1.0 - min( abs( fract( majorD - 0.5 ) - 0.5 ) / majorW, 1.0 ) : 0.0;
  major *= 1.0 - smoothstep( 0.06, 0.16, majorW );
  float ink = clamp( minor * 0.08 + major * 0.14, 0.0, 0.22 );
`;

/**
 * Where contours mean nothing, drop them: on near-flat ground (a street,
 * a meadow, the river's DGM surface) every centimetre of measurement noise
 * crosses the 2 m level in a squiggle — the lines only belong on real slopes.
 * The slope is the elevation change per metre across the pixel footprint.
 * Under water the ink is gone too (the sheet is translucent, it showed).
 */
const CONTOUR_SPLAT_GATE = /* glsl */ `
  float ctRun = max( length( fwidth( vWorldXY ) ), 1e-4 );
  float ctSlope = fwidth( vElevation ) / ctRun;
  ink *= smoothstep( 0.025, 0.09, ctSlope );
  ink *= 1.0 - smoothstep( 0.05, 0.4, texture2D( uSplat, vSplatUv ).a );
`;

/**
 * Light paper-sage ground with sketch-style contour lines (2 m minor / 10 m
 * major) drawn in the fragment shader, on the data-frame elevation derived
 * from world space (DATA_POSITION).
 *
 * When a `splat` is given, the base diffuse comes from the ATKIS land-cover
 * at each fragment (streets, water, meadow, …) instead of the flat sage; the
 * contour ink is composited on top. The colours are the palette-painted
 * splat (landcover-splat.ts; LINEAR, soft boundaries).
 * UVs are derived from the recentered data-frame XY and the tile bounds —
 * the terrain geometry carries no uv attribute.
 */
/** The slice of an `onBeforeCompile` shader object the terrain patches touch. */
interface TerrainShader {
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
}

function applyTerrainUniforms(shader: TerrainShader, splat: SplatLayer): void {
  const [minX, minY, maxX, maxY] = splat.bounds;
  // Recentered tile origin (north-west corner) + size; v grows southward.
  shader.uniforms.uSplat = { value: splat.colorTexture };
  shader.uniforms.uSplatOrigin = {
    value: [minX - splat.offset.cx, maxY - splat.offset.cy],
  };
  shader.uniforms.uSplatSize = { value: [maxX - minX, maxY - minY] };
  // The NEAREST class-id raster, so the meadow detail can test the exact
  // land-cover class (the colour splat's texels are blended).
  shader.uniforms.uSplatClass = { value: splat.texture };
  // Bind the shared refs by identity so the HUD sliders retune them live.
  shader.uniforms.uGroundDetail = splat.ground?.groundDetail ?? { value: 0 };
  shader.uniforms.uMeadowColor = { value: MEADOW_LINEAR };
  shader.uniforms.uRoadColor = { value: ROAD_LINEAR };
  // By reference: the sun rig keeps it current.
  shader.uniforms.uSunDir = { value: splat.sunDirection ?? DEFAULT_SUN };
  shader.uniforms.uUrbanGreen = splat.ground?.urbanGreen ?? { value: 0 };
  if (splat.surfaceTexture) {
    shader.uniforms.uSurface = { value: splat.surfaceTexture };
  }
  if (splat.edgesTexture) {
    shader.uniforms.uEdges = { value: splat.edgesTexture };
  }
  if (splat.sport) {
    shader.uniforms.uSport = { value: splat.sport.raster };
    shader.uniforms.uSportTable = { value: splat.sport.table };
    shader.uniforms.uSportColors = { value: SPORT_LINEAR };
  }
  if (splat.ndviTexture) {
    shader.uniforms.uNdvi = { value: splat.ndviTexture };
    shader.uniforms.uMeadowNdvi = splat.ground?.meadowNdvi ?? { value: 0 };
  }
}

/** The meadow's palette colour, linear — the urban green and grass pavers. */
const MEADOW_LINEAR = LANDCOVER_CLASSES[MEADOW_CLASS].srgb.map(srgbToLinear);
const DEFAULT_SUN = new Vector3(0, 1, 0);

/** The sports surfaces' colours, linear (sport-ground.ts). */
const SPORT_LINEAR = sportPalette();

/** The road's palette colour, linear — sealed ground off the carriageway. */
const ROAD_LINEAR = LANDCOVER_CLASSES[ROAD_CLASS].srgb.map(srgbToLinear);

function patchTerrainVertex(shader: TerrainShader, hasSplat: boolean): void {
  const decl = hasSplat
    ? "varying vec2 vSplatUv;\nvarying vec2 vWorldXY;\nuniform vec2 uSplatOrigin;\nuniform vec2 uSplatSize;"
    : "";
  const assign = hasSplat
    ? "vSplatUv = vec2( ( dataPos.x - uSplatOrigin.x ) / uSplatSize.x, ( uSplatOrigin.y - dataPos.y ) / uSplatSize.y );\n         vWorldXY = dataPos.xy;"
    : "";
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\n         varying float vElevation;\n         ${decl}`
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n         ${DATA_POSITION}\n         vElevation = dataPos.z;\n         ${assign}`
    );
}

/** The splat-dependent fragment code: declarations and the colour body. */
function splatFragment(splat: SplatLayer): { body: string; decl: string } {
  const hasNdvi = splat.ndviTexture !== undefined;
  const hasSurface = splat.surfaceTexture !== undefined;
  const hasEdges = splat.edgesTexture !== undefined;
  const hasSport = splat.sport !== undefined;
  const ndviDecl = hasNdvi
    ? "uniform sampler2D uNdvi;\nuniform float uMeadowNdvi;\n"
    : "";
  return {
    decl: `varying vec2 vSplatUv;\nvarying vec2 vWorldXY;\nuniform sampler2D uSplat;\nuniform highp sampler2D uSplatClass;\n${ndviDecl}${groundDetailDecl(hasSurface, hasEdges)}${hasSport ? SPORT_DECL : ""}`,
    body: `vec3 baseCol = texture2D( uSplat, vSplatUv ).rgb;
         ${GRASS_MOTTLE}
         ${groundFields(hasSurface, hasEdges)}
         ${urbanGreen(hasNdvi, hasEdges)}
         ${GROUND_DETAIL}
         ${hasSport ? SPORT_GROUND : ""}
         ${hasNdvi ? MEADOW_NDVI : ""}`,
  };
}

function patchTerrainFragment(shader: TerrainShader, splat?: SplatLayer): void {
  const hasSplat = splat !== undefined;
  const parts = splat ? splatFragment(splat) : undefined;
  const decl = parts?.decl ?? "";
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\n         varying float vElevation;\n         ${decl}`
    )
    .replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `${parts?.body ?? "vec3 baseCol = diffuse;"}
         ${CONTOUR_INK}
         ${hasSplat ? CONTOUR_SPLAT_GATE : ""}
         vec4 diffuseColor = vec4( mix( baseCol, vec3( 0.30, 0.33, 0.38 ), ink ), opacity );`
    );
  // Calmed ground normals; with the class raster also the meadow-only
  // shading break-up (grDetail declared above, in scope), then the kerbs',
  // lawn edges' and stones' tilt.
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <normal_fragment_begin>",
    hasSplat ? `${GRASS_NORMAL}\n${GROUND_NORMAL}` : TERRAIN_NORMAL
  );
}

function createTerrainMaterial(
  splat?: SplatLayer,
  heightFog?: HeightFogUniforms
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  // The patched GLSL branches on which optional rasters actually loaded, but
  // three keys its program cache on `onBeforeCompile.toString()` — identical for
  // every tile's terrain material. Without an explicit key a tile that lost its
  // class raster or NDVI would be handed a neighbour's compiled program (and its
  // unbound samplers). Neighbour tiles do load independently, so this happens.
  const cacheKey = `terrain-${splat !== undefined}-${splat?.ndviTexture !== undefined}-${splat?.surfaceTexture !== undefined}-${splat?.edgesTexture !== undefined}-${splat?.sport !== undefined}-${heightFog !== undefined}`;
  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    if (splat) {
      applyTerrainUniforms(shader, splat);
    }
    patchTerrainVertex(shader, splat !== undefined);
    patchTerrainFragment(shader, splat);
    if (heightFog) {
      injectHeightFog(shader, heightFog);
    }
  };
  return material;
}

/**
 * The grid's elevations in the data frame, read back from the mesh: the bake
 * wrote the n·n grid first (row 0 = north), quantised, with the node carrying
 * the dequantisation and the renderer the glTF→3D Tiles up-axis turn. `toData`
 * is that chain up to (not including) the viewer's `world` group.
 */
function gridElevations(mesh: Mesh, n: number, toData: Matrix4): Float32Array {
  const position = mesh.geometry.getAttribute("position");
  const out = new Float32Array(n * n);
  const v = new Vector3();
  for (let i = 0; i < out.length; i++) {
    out[i] = v.fromBufferAttribute(position, i).applyMatrix4(toData).z;
  }
  return out;
}

/**
 * Ground height over a TIN (`extras.tin`, the fine level): its surface
 * triangles indexed in the projected frame (lib/city/terrain-tin.ts
 * TinIndex), vertices read back from the mesh like `gridElevations` — so
 * the walker stands on exactly the triangles the GPU draws.
 */
function tinHeightAt(
  mesh: Mesh,
  bounds: TerrainBounds,
  toData: Matrix4,
  offset: { cx: number; cy: number }
): (x: number, y: number) => number | null {
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  if (!index) {
    return () => null;
  }
  const xy = new Float64Array(position.count * 2);
  const z = new Float32Array(position.count);
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(toData);
    xy[2 * i] = v.x + offset.cx;
    xy[2 * i + 1] = v.y + offset.cy;
    z[i] = v.z;
  }
  const tin = new TinIndex({
    bounds,
    xy,
    z,
    // Every triangle, skirt included: a skirt quad is vertical, so its
    // triangles have no area in plan and the lookup never picks one.
    triangles: index.array,
  });
  return (x, y) => tin.heightAt(x, y);
}

/**
 * The water's geometry: the terrain's positions without its skirt. The water
 * and mist sheets drape the terrain mesh, and its skirt — the 30 m vertical
 * wall that hides cracks between tiles — would otherwise be drawn as a wall
 * of water at every seam across the river, a bright band where the two
 * sheets meet. A skirt triangle is vertical: two of its corners share a plan
 * position (the same quantised x and z, glTF being Y-up), so it has no area
 * in plan. A TIN's water also faces straight up (`upFacing`): it spans the
 * river with a few huge triangles whose vertex normals are averaged with the
 * steep bank faces they share a vertex with, so the water's shading would
 * fan out in streaks across them.
 */
function waterGeometryOf(
  geometry: BufferGeometry,
  upFacing: boolean
): BufferGeometry {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const water = new BufferGeometry();
  water.setAttribute("position", position);
  if (upFacing) {
    const normals = new Float32Array(position.count * 3);
    for (let i = 1; i < normals.length; i += 3) {
      normals[i] = 1;
    }
    water.setAttribute("normal", new BufferAttribute(normals, 3));
  } else {
    water.setAttribute("normal", geometry.getAttribute("normal"));
  }
  if (index) {
    const kept: number[] = [];
    const plan = (i: number) => [position.getX(i), position.getZ(i)] as const;
    for (let t = 0; t < index.count; t += 3) {
      const [ax, az] = plan(index.getX(t));
      const [bx, bz] = plan(index.getX(t + 1));
      const [cx, cz] = plan(index.getX(t + 2));
      if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) !== 0) {
        kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
      }
    }
    water.setIndex(kept);
  }
  water.boundingBox = geometry.boundingBox?.clone() ?? null;
  water.boundingSphere = geometry.boundingSphere?.clone() ?? null;
  return water;
}

interface DetailRasters {
  edgesTexture: Texture | null;
  ndviTexture: Texture | null;
  sport: { raster: Texture; table: DataTexture } | null;
  surfaceTexture: Texture | null;
}

const NO_DETAIL: DetailRasters = {
  ndviTexture: null,
  surfaceTexture: null,
  edgesTexture: null,
  sport: null,
};

/** The optional rasters over the class raster, one after another (see
 *  dressTerrain); each absent one is null. */
async function loadDetailRasters(
  extras: TerrainExtras,
  opts: TerrainOptions
): Promise<DetailRasters> {
  const url = (file?: string) => (file ? opts.fileUrl(file) : undefined);
  const ndvi = url(extras.ndvi);
  const ndviTexture = ndvi ? await loadNdviTexture(ndvi, opts.signal) : null;
  // The paving patterns are close-range: the build names the raster on the
  // fine level only.
  const surface = url(extras.surface);
  const surfaceTexture = surface
    ? await loadSurfaceTexture(surface, opts.signal)
    : null;
  const edges = url(extras.edges);
  const edgesTexture = edges
    ? await loadEdgesTexture(edges, opts.signal)
    : null;
  const sportRaster = url(extras.sport);
  const sportTable = url(extras.sportTable);
  const sport =
    sportRaster && sportTable
      ? await loadSportGrounds(sportRaster, sportTable, opts.signal)
      : null;
  return { ndviTexture, surfaceTexture, edgesTexture, sport };
}

/**
 * Dresses a streamed terrain mesh: loads its class raster (and NDVI), paints
 * the colour splat, swaps in the land-cover material and hangs the water and
 * mist sheets under it. `toData` maps the mesh's local frame to the data
 * frame (see gridElevations). The mesh stays owned by the tile.
 */
export async function dressTerrain(
  mesh: Mesh,
  extras: TerrainExtras,
  toData: Matrix4,
  opts: TerrainOptions
): Promise<TerrainLayer> {
  const { bounds, n } = extras;
  // The fine level is a TIN; the coarse one (and a fine level whose DGM had
  // holes) the grid.
  const elevations = extras.tin ? null : gridElevations(mesh, n, toData);
  const heightAt = elevations
    ? (x: number, y: number) =>
        sampleHeightfield({ elevations, n, bounds }, x, y)
    : tinHeightAt(mesh, bounds, toData, opts.offset);

  // Decoded one after another on purpose: several 4096² rasters decoding at
  // once is a peak mobile Safari kills the tab for.
  const classFile = opts.lowRasters ? extras.landcoverLow : extras.landcover;
  const classRaster = classFile
    ? await loadSplatTexture(opts.fileUrl(classFile), opts.signal)
    : null;
  const painted: LandcoverSplat | null = classRaster
    ? paintLandcoverSplat(
        opts.renderer,
        classRaster.texture,
        classRaster.width,
        classRaster.height
      )
    : null;
  const { ndviTexture, surfaceTexture, edgesTexture, sport } = classRaster
    ? await loadDetailRasters(extras, opts)
    : NO_DETAIL;
  const splat: SplatLayer | undefined =
    classRaster && painted
      ? {
          texture: classRaster.texture,
          colorTexture: painted.texture,
          ndviTexture: ndviTexture ?? undefined,
          surfaceTexture: surfaceTexture ?? undefined,
          edgesTexture: edgesTexture ?? undefined,
          sport: sport ?? undefined,
          sunDirection: opts.sunDirection,
          ground: opts.ground,
          bounds,
          offset: opts.offset,
        }
      : undefined;

  mesh.material = createTerrainMaterial(splat, opts.heightFog);
  mesh.name = "terrain";
  // The terrain only RECEIVES shadows. If it also cast, the grazing sun makes
  // every triangle face self-shadow → the jagged "staircase"/triangle acne
  // along shadow edges. Buildings and trees sit on the ground and cast onto it;
  // the ground itself has nothing meaningful to cast, so this is pure win and
  // also lets the sun rig run a much smaller shadow bias (no contact light-leak).
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // Water re-uses the terrain geometry, masked to the water class: siblings
  // of the mesh with its (dequantising) transform, so they come and go with
  // the tile.
  const waterGeometry = waterGeometryOf(
    mesh.geometry,
    extras.tin !== undefined
  );
  const water = splat
    ? createWaterLayer(waterGeometry, splat, opts.sunDirection, opts.heightFog)
    : undefined;
  if (water) {
    for (const sheet of [water.mesh, water.mistMesh]) {
      sheet.position.copy(mesh.position);
      sheet.quaternion.copy(mesh.quaternion);
      sheet.scale.copy(mesh.scale);
      mesh.parent?.add(sheet);
    }
  }

  return {
    mesh,
    tile: extras.tileId,
    level: extras.level,
    vertexCount: mesh.geometry.getAttribute("position").count,
    bounds,
    minElevation: extras.minElevation,
    water,
    heightAt,
    dispose: () => {
      // Shares the tile's positions; only its own index (and normals) go.
      waterGeometry.dispose();
      for (const texture of [
        classRaster?.texture,
        ndviTexture,
        surfaceTexture,
        edgesTexture,
        sport?.raster,
        sport?.table,
      ]) {
        texture?.dispose();
      }
      painted?.dispose();
    },
  };
}
