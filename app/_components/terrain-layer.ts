import {
  BufferAttribute,
  BufferGeometry,
  ImageBitmapLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  type Vector3,
} from "three";
import {
  decodeHeightfield,
  parseHeightfieldHeader,
  resolveSiblingUrl,
} from "@/lib/city/heightfield";
import { conflateWalls, type WallLine } from "@/lib/city/terrain-conflate";
import {
  buildTerrainGeometryData,
  sampleHeightfield,
  type TerrainBounds,
} from "@/lib/city/terrain-geometry";
import { fetchGzipped, fetchRequiredJson } from "./fetch-optional";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { textureBytes, trackTexture } from "./three-utils";
import { createWaterLayer, type WaterLayer } from "./water-layer";

export interface TerrainLayer {
  /** [minX, minY, maxX, maxY] in the projected CRS */
  bounds: TerrainBounds;
  /** bilinear elevation lookup at projected (not recentered) coordinates */
  heightAt: (x: number, y: number) => number | null;
  mesh: Mesh;
  /** lowest valid elevation (m) on this tile — the valley/river floor */
  minElevation: number;
  vertexCount: number;
  /** animated water surface, present only when a splatmap was loaded */
  water?: WaterLayer;
}

export interface TerrainOptions {
  /** shared valley height-fog uniforms (by reference); patched into the
   * terrain + water materials so the river/floor pools haze without a seam */
  heightFog?: HeightFogUniforms;
  /** optional pre-baked pastel RGB splat (needs `landcoverUrl`) */
  landcoverRgbUrl?: string;
  /** optional ATKIS land-cover class raster (PNG), tinted per surface class */
  landcoverUrl?: string;
  /** shared meadow-NDVI tint strength (by reference) for the HUD slider */
  meadowNdvi?: { value: number };
  /** optional DOP NDVI raster for the meadow tint (needs `landcoverUrl`) */
  ndviUrl?: string;
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** aborts the raster download */
  signal?: AbortSignal;
  /** shared world (Y-up) sun direction, read by the water Fresnel/glitter */
  sunDirection?: Vector3;
  /** URL of the heightfield header JSON (see lib/city/heightfield.ts); the
   * grid size and bounds come from it, baked by scripts/prepare-data.ts */
  url: string;
  /** OSM wall lines (EPSG:25833) for this tile, already fetched; retaining/city
   * walls are burned into the heightfield as steps so they sit on a real edge,
   * not the smooth bank the DGM blurs them into (lib/city/terrain-conflate.ts) */
  wallLines?: WallLine[];
}

/**
 * Decodes a raster into a texture OFF the main thread. `TextureLoader` hands
 * three an <img>, which the browser decodes lazily — for a 4096² PNG that is
 * ~64 MB of pixels decoded (and flipped) synchronously at the first upload,
 * on the main thread, per tile and per raster. `createImageBitmap` decodes
 * in the browser's image workers, already in the orientation three needs
 * (`imageOrientation: "none"` = the flipY=false these rasters use), so the
 * first frame only pays the GPU upload. Rejects on a decode/network failure.
 */
async function loadBitmapTexture(
  url: string
): Promise<{ height: number; texture: Texture; width: number }> {
  if (typeof createImageBitmap === "undefined") {
    const texture = await new TextureLoader().loadAsync(url);
    texture.flipY = false;
    const img = texture.image as { height: number; width: number };
    return { texture, width: img.width, height: img.height };
  }
  const loader = new ImageBitmapLoader();
  loader.setOptions({
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const bitmap = await loader.loadAsync(url);
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.needsUpdate = true;
  // The decoded bitmap is 64 MB for a 4096² raster and, unlike an <img>'s
  // purgeable decode cache, stays resident as long as three holds it in
  // `texture.image`. Twelve of them took mobile Safari past its per-tab
  // memory limit. Once the GPU has the texels the CPU copy is dead weight:
  // release it right after the upload (mipmaps are generated on the GPU).
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
async function loadSplatTexture(url: string): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadBitmapTexture(url);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    // The class id lives in the red channel; uploading the grey PNG as RGBA
    // would spend four bytes per texel on one (64 MB instead of 16 MB at
    // 4096²). WebGL2 accepts a RED upload straight from the bitmap.
    texture.format = RedFormat;
    trackTexture(texture, textureBytes(width, height, 1, false));
    return texture;
  } catch {
    return null;
  }
}

/**
 * Loads the pre-baked pastel RGB splatmap (the colours the terrain shows).
 * LINEAR + mipmaps + anisotropy let the GPU filter it smoothly, so class
 * boundaries no longer stair-step at grazing angles. Colour data → sRGB.
 */
async function loadColorSplat(url: string): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadBitmapTexture(url);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.colorSpace = SRGBColorSpace;
    trackTexture(texture, textureBytes(width, height, 4, true));
    return texture;
  } catch {
    return null;
  }
}

/**
 * Loads the DOP NDVI raster (single-channel greenness) for the meadow tint.
 * LINEAR + mipmaps low-pass the ~2 m raster (the workflow's recommendation), so
 * the meadow colour reads as a smooth gradient. Data values, not colour → no
 * sRGB. Absent/404 → null and the meadow keeps its flat pastel sage.
 */
async function loadNdviTexture(url: string): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadBitmapTexture(url);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.colorSpace = NoColorSpace;
    // Greenness is a single channel too.
    texture.format = RedFormat;
    trackTexture(texture, textureBytes(width, height, 1, true));
    return texture;
  } catch {
    return null;
  }
}

/** A baked OSM wall feature (see wall-layer.ts / scripts/extract-walls.sh). */
export interface WallFeature {
  geometry?: { coordinates?: [number, number][]; type?: string };
  properties?: { h?: number; kind?: string };
}

/** Maps baked wall features to the LineStrings the conflation step burns in. */
export function wallLinesFrom(features: WallFeature[]): WallLine[] {
  const out: WallLine[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (f.geometry?.type === "LineString" && Array.isArray(coords)) {
      out.push({ coords, kind: f.properties?.kind ?? "wall" });
    }
  }
  return out;
}

/** Returns the DGM elevations with retaining/city walls burned in as steps, or
 *  the untouched raster when there are no wall lines for this tile. */
function conflateTerrain(
  base: ArrayLike<number>,
  grid: { bounds: TerrainBounds; n: number; nodata: number | null },
  walls: WallLine[] | undefined
): ArrayLike<number> {
  if (!walls || walls.length === 0) {
    return base;
  }
  return conflateWalls({ elevations: base, ...grid, walls });
}

/** Land-cover splatmap aligned to the terrain, for per-surface tinting. */
export interface SplatLayer {
  bounds: TerrainBounds;
  /** pre-baked pastel RGB colours; sampled LINEAR for soft transitions */
  colorTexture?: Texture;
  /** live meadow-NDVI tint strength (shared ref, mutated by the HUD slider) */
  meadowNdvi?: { value: number };
  /** DOP NDVI raster (LINEAR) for the meadow greenness tint */
  ndviTexture?: Texture;
  offset: { cx: number; cy: number };
  /** class-id raster (NEAREST); used by the water mask */
  texture: Texture;
}

/**
 * Stylized colour per land-cover class id (see scripts/extract-dlm.sh).
 * Kept muted to sit beside the paper-sage palette and the contour ink.
 */
const TERRAIN_PALETTE = /* glsl */ `
  vec3 terrainPalette( float cls ) {
    if ( cls < 0.5 ) return vec3( 0.679, 0.698, 0.620 ); // 0 background (base sage)
    if ( cls < 1.5 ) return vec3( 0.706, 0.761, 0.522 ); // 1 farmland / meadow
    if ( cls < 2.5 ) return vec3( 0.286, 0.471, 0.310 ); // 2 forest
    if ( cls < 3.5 ) return vec3( 0.451, 0.612, 0.408 ); // 3 copse
    if ( cls < 4.5 ) return vec3( 0.800, 0.760, 0.690 ); // 4 built-up
    if ( cls < 5.5 ) return vec3( 0.698, 0.663, 0.627 ); // 5 railway (ballast grey)
    if ( cls < 6.5 ) return vec3( 0.804, 0.706, 0.518 ); // 6 path
    if ( cls < 7.5 ) return vec3( 0.255, 0.263, 0.302 ); // 7 road
    return vec3( 0.353, 0.588, 0.784 );                  // 8 water
  }
`;

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
  baseCol *= 1.0 + grMottle * 0.06 * grDetail;
`;

const GRASS_NORMAL = /* glsl */ `
  #include <normal_fragment_begin>
  float grGx = cos( vWorldXY.x * 0.85 + 1.3 ) * sin( vWorldXY.y * 0.78 - 0.7 ) * 0.85;
  float grGy = sin( vWorldXY.x * 0.85 + 1.3 ) * cos( vWorldXY.y * 0.78 - 0.7 ) * 0.78;
  normal = normalize( normal + vec3( grGx, grGy, 0.0 ) * 0.12 * grDetail );
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
  float grNdvi = texture2D( uNdvi, vSplatUv ).r;
  float grNdviT = clamp( ( grNdvi - 0.1 ) / 0.5, 0.0, 1.0 );
  vec3 grTint = mix( baseCol * vec3( 1.14, 1.02, 0.82 ),  // dry: paler warm hay
                     baseCol * vec3( 0.70, 1.12, 0.52 ), grNdviT );  // lush: deep grass
  baseCol = mix( baseCol, grTint, uMeadowNdvi * grMeadow * step( 0.012, grNdvi ) );
`;

/**
 * Light paper-sage ground with sketch-style contour lines (2 m minor / 10 m
 * major) drawn in the fragment shader. The geometry lives in the Z-up data
 * frame, so `position.z` IS the absolute elevation.
 *
 * When a `splat` is given, the base diffuse comes from the ATKIS land-cover
 * at each fragment (streets, water, meadow, …) instead of the flat sage; the
 * contour ink is composited on top. Prefers the pre-baked pastel RGB splat
 * (LINEAR, soft boundaries) and falls back to the in-shader class palette.
 * UVs are derived from the recentered world XY and the tile bounds — the
 * terrain geometry carries no uv attribute.
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
  shader.uniforms.uSplat = { value: splat.colorTexture ?? splat.texture };
  shader.uniforms.uSplatOrigin = {
    value: [minX - splat.offset.cx, maxY - splat.offset.cy],
  };
  shader.uniforms.uSplatSize = { value: [maxX - minX, maxY - minY] };
  // Always the NEAREST class-id raster (even when uSplat is the RGB splat),
  // so the meadow detail can test the exact land-cover class.
  shader.uniforms.uSplatClass = { value: splat.texture };
  if (splat.ndviTexture) {
    shader.uniforms.uNdvi = { value: splat.ndviTexture };
    // Bind the shared ref by identity so the HUD slider retunes it live.
    shader.uniforms.uMeadowNdvi = splat.meadowNdvi ?? { value: 0 };
  }
}

function patchTerrainVertex(shader: TerrainShader, hasSplat: boolean): void {
  const decl = hasSplat
    ? "varying vec2 vSplatUv;\nvarying vec2 vWorldXY;\nuniform vec2 uSplatOrigin;\nuniform vec2 uSplatSize;"
    : "";
  const assign = hasSplat
    ? "vSplatUv = vec2( ( position.x - uSplatOrigin.x ) / uSplatSize.x, ( uSplatOrigin.y - position.y ) / uSplatSize.y );\n         vWorldXY = position.xy;"
    : "";
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\n         varying float vElevation;\n         ${decl}`
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n         vElevation = position.z;\n         ${assign}`
    );
}

function patchTerrainFragment(shader: TerrainShader, splat?: SplatLayer): void {
  const hasSplat = splat !== undefined;
  const hasColor = splat?.colorTexture !== undefined;
  const hasNdvi = splat?.ndviTexture !== undefined;
  // Base colour: sample the RGB splat directly, or map the class id via the
  // fallback palette.
  const baseColExpr = hasColor
    ? "vec3 baseCol = texture2D( uSplat, vSplatUv ).rgb;"
    : "vec3 baseCol = terrainPalette( floor( texture2D( uSplat, vSplatUv ).r * 255.0 + 0.5 ) );";
  const ndviDecl = hasNdvi
    ? "uniform sampler2D uNdvi;\nuniform float uMeadowNdvi;\n"
    : "";
  const decl = hasSplat
    ? `varying vec2 vSplatUv;\nvarying vec2 vWorldXY;\nuniform sampler2D uSplat;\nuniform sampler2D uSplatClass;\n${ndviDecl}${hasColor ? "" : TERRAIN_PALETTE}`
    : "";
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\n         varying float vElevation;\n         ${decl}`
    )
    .replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `${hasSplat ? baseColExpr : "vec3 baseCol = diffuse;"}
         ${hasSplat ? GRASS_MOTTLE : ""}
         ${hasNdvi ? MEADOW_NDVI : ""}
         float minorD = vElevation / 2.0;
         float minor = 1.0 - min( abs( fract( minorD - 0.5 ) - 0.5 ) / fwidth( minorD ), 1.0 );
         float majorD = vElevation / 10.0;
         float major = 1.0 - min( abs( fract( majorD - 0.5 ) - 0.5 ) / fwidth( majorD ), 1.0 );
         float ink = clamp( minor * 0.10 + major * 0.15, 0.0, 0.26 );
         vec4 diffuseColor = vec4( mix( baseCol, vec3( 0.30, 0.33, 0.38 ), ink ), opacity );`
    );
  if (hasSplat) {
    // Meadow-only shading-normal break-up (grDetail declared above, in scope).
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      GRASS_NORMAL
    );
  }
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
  // RGB splat or NDVI would be handed a neighbour's compiled program (and its
  // unbound samplers). Neighbour tiles do load independently, so this happens.
  const cacheKey = `terrain-${splat !== undefined}-${splat?.colorTexture !== undefined}-${splat?.ndviTexture !== undefined}-${heightFog !== undefined}`;
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

export async function loadTerrain(opts: TerrainOptions): Promise<TerrainLayer> {
  // The raster arrives ready to use: scripts/prepare-data.ts resampled the DGM
  // GeoTIFF to n x n at build time (quantised uint16, gzipped); decoding it
  // is one dequantising pass and NoData comes out as NaN, so there is no
  // nodata sentinel to carry around.
  const header = parseHeightfieldHeader(
    await fetchRequiredJson(opts.url, opts.signal)
  );
  const { n, bounds } = header;
  /** Holes are NaN in the baked samples, so there is no sentinel to match. */
  const nodata: number | null = null;
  const samples = decodeHeightfield(
    await fetchGzipped(resolveSiblingUrl(opts.url, header.data), opts.signal),
    header
  );
  const elevations = conflateTerrain(
    samples,
    { n, bounds, nodata },
    opts.wallLines
  );

  const { positions, indices, minElevation } = buildTerrainGeometryData({
    elevations,
    n,
    bounds,
    offset: opts.offset,
    nodata,
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  // Decoded one after another on purpose: three 4096² rasters decoding at
  // once (times four tiles loading concurrently) is a ~800 MB peak that
  // mobile Safari kills the tab for. Sequential keeps it to one raster's
  // worth per tile in flight.
  const splatTexture = opts.landcoverUrl
    ? await loadSplatTexture(opts.landcoverUrl)
    : null;
  const colorTexture =
    splatTexture && opts.landcoverRgbUrl
      ? await loadColorSplat(opts.landcoverRgbUrl)
      : null;
  const ndviTexture =
    splatTexture && opts.ndviUrl ? await loadNdviTexture(opts.ndviUrl) : null;
  const splat: SplatLayer | undefined = splatTexture
    ? {
        texture: splatTexture,
        colorTexture: colorTexture ?? undefined,
        ndviTexture: ndviTexture ?? undefined,
        meadowNdvi: opts.meadowNdvi,
        bounds,
        offset: opts.offset,
      }
    : undefined;

  const mesh = new Mesh(geometry, createTerrainMaterial(splat, opts.heightFog));
  mesh.name = "terrain";
  // The terrain only RECEIVES shadows. If it also cast, the grazing sun makes
  // every triangle face self-shadow → the jagged "staircase"/triangle acne
  // along shadow edges. Buildings and trees sit on the ground and cast onto it;
  // the ground itself has nothing meaningful to cast, so this is pure win and
  // also lets the sun rig run a much smaller shadow bias (no contact light-leak).
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // Water re-uses the terrain geometry, masked to the water class.
  const water = splat
    ? createWaterLayer(geometry, splat, opts.sunDirection, opts.heightFog)
    : undefined;

  return {
    mesh,
    vertexCount: positions.length / 3,
    bounds,
    minElevation,
    water,
    heightAt: (x, y) =>
      sampleHeightfield({ elevations, n, bounds, nodata }, x, y),
  };
}
