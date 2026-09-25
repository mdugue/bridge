import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  type Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGFormat,
  Texture,
  TextureLoader,
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
  srgbToLinear,
} from "@/lib/city/landcover";
import type { TerrainExtras } from "@/lib/city/tileset";
import { isAbortError } from "./fetch-optional";
import {
  GROUND_DETAIL,
  GROUND_NORMAL,
  groundDetailDecl,
  groundFields,
  urbanGreen,
} from "./ground-detail";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { DATA_POSITION } from "./shader-chunks";
import { type LandcoverSplat, paintLandcoverSplat } from "./landcover-splat";
import { textureBytes, trackTexture } from "./three-utils";
import { createWaterLayer, type WaterLayer } from "./water-layer";

/**
 * One tile's terrain at one level: the baked glTF mesh (scripts/bake-tiles.ts,
 * streamed by tile-stream.ts) dressed with the land-cover material, its
 * water and mist sheets, and a ground-height sampler read from its grid.
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
 * Decodes a raster into a texture OFF the main thread. `TextureLoader` hands
 * three an <img>, which the browser decodes lazily — for a 4096² PNG that is
 * ~64 MB of pixels decoded (and flipped) synchronously at the first upload,
 * on the main thread, per tile and per raster. `createImageBitmap` decodes
 * in the browser's image workers, already in the orientation three needs
 * (`imageOrientation: "none"` = the flipY=false these rasters use), so the
 * first frame only pays the GPU upload. Rejects on a decode/network failure
 * and on abort, so a torn-down instance stops decoding rasters it will
 * throw away.
 */
async function loadBitmapTexture(
  url: string,
  signal?: AbortSignal
): Promise<{ height: number; texture: Texture; width: number }> {
  if (typeof createImageBitmap === "undefined") {
    const texture = await new TextureLoader().loadAsync(url);
    texture.flipY = false;
    const img = texture.image as { height: number; width: number };
    return { texture, width: img.width, height: img.height };
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const bitmap = await createImageBitmap(await res.blob(), {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
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
async function loadSplatTexture(
  url: string,
  signal?: AbortSignal
): Promise<{ height: number; texture: Texture; width: number } | null> {
  try {
    const loaded = await loadBitmapTexture(url, signal);
    const { texture, width, height } = loaded;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    // The class id lives in the red channel; uploading the grey PNG as RGBA
    // would spend four bytes per texel on one (64 MB instead of 16 MB at
    // 4096²). WebGL2 accepts a RED upload straight from the bitmap.
    texture.format = RedFormat;
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
    const { texture, width, height } = await loadBitmapTexture(url, signal);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.colorSpace = NoColorSpace;
    // Greenness is a single channel too.
    texture.format = RedFormat;
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
 * road/walk surface ids, G = the street direction. Data, NEAREST, two
 * channels (the B channel of the RGB PNG is empty). Absent → null and the
 * ground falls back to the land-cover class's pattern.
 */
async function loadSurfaceTexture(
  url: string,
  signal?: AbortSignal
): Promise<Texture | null> {
  try {
    const { texture, width, height } = await loadBitmapTexture(url, signal);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = NoColorSpace;
    texture.format = RGFormat;
    trackTexture(texture, textureBytes(width, height, 2, false));
    return texture;
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
  /** OSM paving raster (NEAREST, RG) for the paving patterns */
  surfaceTexture?: Texture;
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
  if (splat.surfaceTexture) {
    shader.uniforms.uSurface = { value: splat.surfaceTexture };
  }
  if (splat.ndviTexture) {
    shader.uniforms.uNdvi = { value: splat.ndviTexture };
    shader.uniforms.uMeadowNdvi = splat.ground?.meadowNdvi ?? { value: 0 };
    shader.uniforms.uUrbanGreen = splat.ground?.urbanGreen ?? { value: 0 };
  }
}

/** The meadow's palette colour, linear — the urban green and grass pavers. */
const MEADOW_LINEAR = LANDCOVER_CLASSES[MEADOW_CLASS].srgb.map(srgbToLinear);

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
  const ndviDecl = hasNdvi
    ? "uniform sampler2D uNdvi;\nuniform float uMeadowNdvi;\nuniform float uUrbanGreen;\n"
    : "";
  return {
    decl: `varying vec2 vSplatUv;\nvarying vec2 vWorldXY;\nuniform sampler2D uSplat;\nuniform highp sampler2D uSplatClass;\n${ndviDecl}${groundDetailDecl(hasSurface)}`,
    body: `vec3 baseCol = texture2D( uSplat, vSplatUv ).rgb;
         ${GRASS_MOTTLE}
         ${groundFields(hasSurface)}
         ${urbanGreen(hasNdvi)}
         ${GROUND_DETAIL}
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
         float minorD = vElevation / 2.0;
         // A flat quad lying exactly on a contour has fwidth 0: 0/0 there
         // striped it with NaN ink. No slope, no contour line.
         float minorW = fwidth( minorD );
         float minor = minorW > 1e-6 ? 1.0 - min( abs( fract( minorD - 0.5 ) - 0.5 ) / minorW, 1.0 ) : 0.0;
         float majorD = vElevation / 10.0;
         float majorW = fwidth( majorD );
         float major = majorW > 1e-6 ? 1.0 - min( abs( fract( majorD - 0.5 ) - 0.5 ) / majorW, 1.0 ) : 0.0;
         float ink = clamp( minor * 0.10 + major * 0.15, 0.0, 0.26 );
         vec4 diffuseColor = vec4( mix( baseCol, vec3( 0.30, 0.33, 0.38 ), ink ), opacity );`
    );
  if (hasSplat) {
    // Meadow-only shading-normal break-up (grDetail declared above, in
    // scope), then the kerbs', lawn edges' and stones' tilt.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `${GRASS_NORMAL}\n${GROUND_NORMAL}`
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
  // class raster or NDVI would be handed a neighbour's compiled program (and its
  // unbound samplers). Neighbour tiles do load independently, so this happens.
  const cacheKey = `terrain-${splat !== undefined}-${splat?.ndviTexture !== undefined}-${splat?.surfaceTexture !== undefined}-${heightFog !== undefined}`;
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
  const elevations = gridElevations(mesh, n, toData);

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
  const ndviTexture =
    classRaster && extras.ndvi
      ? await loadNdviTexture(opts.fileUrl(extras.ndvi), opts.signal)
      : null;
  // The paving patterns are close-range: the build names the raster on the
  // fine level only.
  const surfaceTexture =
    classRaster && extras.surface
      ? await loadSurfaceTexture(opts.fileUrl(extras.surface), opts.signal)
      : null;
  const splat: SplatLayer | undefined =
    classRaster && painted
      ? {
          texture: classRaster.texture,
          colorTexture: painted.texture,
          ndviTexture: ndviTexture ?? undefined,
          surfaceTexture: surfaceTexture ?? undefined,
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
  const water = splat
    ? createWaterLayer(mesh.geometry, splat, opts.sunDirection, opts.heightFog)
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
    heightAt: (x, y) => sampleHeightfield({ elevations, n, bounds }, x, y),
    dispose: () => {
      for (const texture of [
        classRaster?.texture,
        ndviTexture,
        surfaceTexture,
      ]) {
        texture?.dispose();
      }
      painted?.dispose();
    },
  };
}
