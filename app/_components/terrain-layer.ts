import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";
import {
  BufferAttribute,
  BufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from "three";
import {
  buildTerrainGeometryData,
  sampleHeightfield,
  type TerrainBounds,
} from "@/lib/city/terrain-geometry";
import { tfwToBounds } from "@/lib/city/tfw";
import { createWaterLayer, type WaterLayer } from "./water-layer";

/** Downsample target (N x N). 1024 over a 2 km tile ≈ 2 m — fine enough that
 * the terrain silhouette no longer reads as coarse polygonal steps. */
const DEFAULT_TARGET_SIZE = 1024;

/** Filename token swapped to find the RGB splat next to the class-id one. */
const LANDCOVER_PREFIX = /landcover_/;

export interface TerrainLayer {
  /** [minX, minY, maxX, maxY] in the projected CRS */
  bounds: TerrainBounds;
  /** bilinear elevation lookup at projected (not recentered) coordinates */
  heightAt: (x: number, y: number) => number | null;
  mesh: Mesh;
  vertexCount: number;
  /** animated water surface, present only when a splatmap was loaded */
  water?: WaterLayer;
}

export interface TerrainOptions {
  /** optional ATKIS land-cover splatmap (PNG), tinted per surface class */
  landcoverUrl?: string;
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** aborts the raster download */
  signal?: AbortSignal;
  targetSize?: number;
  /** .tfw sidecar fallback, used only when the GeoTIFF has no embedded georef */
  tfwUrl?: string;
  url: string;
}

/**
 * Loads the land-cover splatmap as a NEAREST-filtered data texture (class ids
 * must not be interpolated) in linear space (the red channel is a class id,
 * not a colour). Non-fatal: a failure just falls back to the flat sage ground.
 */
async function loadSplatTexture(url: string): Promise<Texture | null> {
  try {
    const texture = await new TextureLoader().loadAsync(url);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.colorSpace = NoColorSpace;
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
    const texture = await new TextureLoader().loadAsync(url);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.flipY = false;
    texture.colorSpace = SRGBColorSpace;
    return texture;
  } catch {
    return null;
  }
}

/** Derives the RGB splatmap URL from the class-id URL (…/landcover_X → …_rgb_X). */
function colorSplatUrl(classUrl: string): string {
  return classUrl.replace(LANDCOVER_PREFIX, "landcover_rgb_");
}

async function fetchArrayBuffer(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return await res.arrayBuffer();
}

/** True when getBoundingBox() returned pixel indices instead of map units. */
function isPixelSpaceBounds(
  bounds: number[],
  width: number,
  height: number
): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  return (
    Math.abs(minX) <= 1 &&
    Math.abs(minY) <= 1 &&
    Math.abs(maxX - width) <= 1 &&
    Math.abs(maxY - height) <= 1
  );
}

/**
 * Resolves the raster's georeferenced bounds. geotiff.js CANNOT read .tfw
 * sidecars, so if the GeoTIFF carries no embedded geotransform we parse the
 * .tfw ourselves — and fail loudly rather than silently misplace the terrain.
 */
async function resolveBounds(
  image: GeoTIFFImage,
  tfwUrl: string | undefined
): Promise<TerrainBounds> {
  const width = image.getWidth();
  const height = image.getHeight();

  let embedded: number[] | null = null;
  try {
    embedded = image.getBoundingBox();
  } catch {
    embedded = null;
  }
  if (embedded && !isPixelSpaceBounds(embedded, width, height)) {
    return embedded as TerrainBounds;
  }

  if (tfwUrl) {
    const res = await fetch(tfwUrl);
    if (res.ok) {
      return tfwToBounds(await res.text(), width, height);
    }
  }

  throw new Error(
    "DGM GeoTIFF has no embedded georeferencing and no readable .tfw sidecar. " +
      "Embed it with: gdal_translate -a_srs EPSG:25833 in.tif out.tif " +
      "(or serve the .tfw next to the .tif)."
  );
}

/** Land-cover splatmap aligned to the terrain, for per-surface tinting. */
export interface SplatLayer {
  bounds: TerrainBounds;
  /** pre-baked pastel RGB colours; sampled LINEAR for soft transitions */
  colorTexture?: Texture;
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
    if ( cls < 5.5 ) return vec3( 0.490, 0.396, 0.396 ); // 5 railway
    if ( cls < 6.5 ) return vec3( 0.804, 0.706, 0.518 ); // 6 path
    if ( cls < 7.5 ) return vec3( 0.255, 0.263, 0.302 ); // 7 road
    return vec3( 0.353, 0.588, 0.784 );                  // 8 water
  }
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
function createTerrainMaterial(splat?: SplatLayer): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  material.onBeforeCompile = (shader) => {
    const hasSplat = splat !== undefined;
    const hasColor = splat?.colorTexture !== undefined;
    if (splat) {
      const [minX, minY, maxX, maxY] = splat.bounds;
      // Recentered tile origin (north-west corner) + size; v grows southward.
      shader.uniforms.uSplat = {
        value: splat.colorTexture ?? splat.texture,
      };
      shader.uniforms.uSplatOrigin = {
        value: [minX - splat.offset.cx, maxY - splat.offset.cy],
      };
      shader.uniforms.uSplatSize = { value: [maxX - minX, maxY - minY] };
    }

    // Base colour: sample the RGB splat directly, or map the class id via the
    // fallback palette.
    const baseColExpr = hasColor
      ? "vec3 baseCol = texture2D( uSplat, vSplatUv ).rgb;"
      : "vec3 baseCol = terrainPalette( floor( texture2D( uSplat, vSplatUv ).r * 255.0 + 0.5 ) );";

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vElevation;
         ${hasSplat ? "varying vec2 vSplatUv;\nuniform vec2 uSplatOrigin;\nuniform vec2 uSplatSize;" : ""}`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vElevation = position.z;
         ${hasSplat ? "vSplatUv = vec2( ( position.x - uSplatOrigin.x ) / uSplatSize.x, ( uSplatOrigin.y - position.y ) / uSplatSize.y );" : ""}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vElevation;
         ${hasSplat ? `varying vec2 vSplatUv;\nuniform sampler2D uSplat;\n${hasColor ? "" : TERRAIN_PALETTE}` : ""}`
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `${hasSplat ? baseColExpr : "vec3 baseCol = diffuse;"}
         float minorD = vElevation / 2.0;
         float minor = 1.0 - min( abs( fract( minorD - 0.5 ) - 0.5 ) / fwidth( minorD ), 1.0 );
         float majorD = vElevation / 10.0;
         float major = 1.0 - min( abs( fract( majorD - 0.5 ) - 0.5 ) / fwidth( majorD ), 1.0 );
         float ink = clamp( minor * 0.10 + major * 0.15, 0.0, 0.26 );
         vec4 diffuseColor = vec4( mix( baseCol, vec3( 0.30, 0.33, 0.38 ), ink ), opacity );`
      );
  };
  return material;
}

export async function loadTerrain(opts: TerrainOptions): Promise<TerrainLayer> {
  const n = opts.targetSize ?? DEFAULT_TARGET_SIZE;

  const tiff = await fromArrayBuffer(
    await fetchArrayBuffer(opts.url, opts.signal)
  );
  const image = await tiff.getImage();
  const bounds = await resolveBounds(image, opts.tfwUrl);
  const nodata = image.getGDALNoData();

  const raster = await image.readRasters({
    width: n,
    height: n,
    samples: [0],
    interleave: true,
    resampleMethod: "bilinear",
  });
  const elevations = raster as unknown as ArrayLike<number>;

  const { positions, indices } = buildTerrainGeometryData({
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

  const [splatTexture, colorTexture] = opts.landcoverUrl
    ? await Promise.all([
        loadSplatTexture(opts.landcoverUrl),
        loadColorSplat(colorSplatUrl(opts.landcoverUrl)),
      ])
    : [null, null];
  const splat: SplatLayer | undefined = splatTexture
    ? {
        texture: splatTexture,
        colorTexture: colorTexture ?? undefined,
        bounds,
        offset: opts.offset,
      }
    : undefined;

  const mesh = new Mesh(geometry, createTerrainMaterial(splat));
  mesh.name = "terrain";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Water re-uses the terrain geometry, masked to the water class.
  const water = splat ? createWaterLayer(geometry, splat) : undefined;

  return {
    mesh,
    vertexCount: positions.length / 3,
    bounds,
    water,
    heightAt: (x, y) =>
      sampleHeightfield({ elevations, n, bounds, nodata }, x, y),
  };
}
