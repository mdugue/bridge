import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  type Mesh,
  MeshStandardNodeMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  RGFormat,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type UniformNode,
  type WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  length,
  materialColor,
  max,
  min,
  mix,
  normalize,
  normalView,
  positionWorld,
  property,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
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
import { colonyCropUv } from "@/lib/city/cultivated";
import { type MarkingTable, packMarkingTable } from "@/lib/city/markings";
import { packSportTable, type SportTable } from "@/lib/city/sport";
import { TinIndex } from "@/lib/city/terrain-tin";
import type { TerrainExtras } from "@/lib/city/tileset";
import { colonyGarden } from "./cultivated-layer";
import { fetchOptionalJson, isAbortError } from "./fetch-optional";
import {
  type GroundColour,
  type GroundInputs,
  groundDetail,
  groundFields,
  groundNormal,
  urbanGreen,
} from "./ground-detail";
import { type LandcoverSplat, paintLandcoverSplat } from "./landcover-splat";
import { roadMarkings } from "./road-markings";
import {
  dataXY,
  type F,
  type Live,
  rasterUv,
  type V2,
  type V3,
} from "./shader-chunks";
import type { SharedRasters } from "./shared-rasters";
import { applyGroundLight, type GroundLight } from "./sky-light";
import { sportGround } from "./sport-ground";
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
  /** the tile's baked fences and gates (fine level only; fence-layer.ts) */
  fences?: Mesh;
  /** the tile's baked walls (fine level only; wall-layer.ts) */
  walls?: Mesh;
  /** lowest valid elevation (m) on this tile — the valley/river floor */
  minElevation: number;
  tile: string;
  vertexCount: number;
  /** animated water surface, present only when the class raster loaded */
  water?: WaterLayer;
  /** the tile's baked light for what stands on this level (kerbs, fences,
   *  stairs, walls; sky-light.ts `applyGroundLight`), when it has any */
  light?: GroundLight;
}

export interface TerrainOptions {
  /** resolves a file named in the tile's extras to its URL */
  fileUrl: (file: string) => string;
  /** the scene fog's colour (height-fog.ts), the water's sky tint */
  fogColor: UniformNode<"color", Color>;
  /** phones sample the ≤ 2048² class raster */
  lowRasters: boolean;
  /** the ground's look rows and the sun (uniform nodes, shared by every
   *  tile) */
  ground: GroundUniforms;
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** paints the colour splat from the class raster (one GPU pass) */
  renderer: WebGPURenderer;
  /** aborts the raster downloads */
  signal?: AbortSignal;
  /** the sky-view rasters, shared with the tile's buildings (tile-stream.ts) */
  skyView?: SharedRasters<Texture>;
  /** the horizon rasters, shared by a tile's two terrain levels (both name
   *  the same file) */
  horizon?: SharedRasters<Texture>;
}

/**
 * The terrain's look rows and the sun: uniform nodes shared by every tile's
 * material, so a slider retunes them live (a uniform write, no rebuild).
 */
export interface GroundUniforms {
  /** kerbs, lawn edges and paving patterns (ground-detail.ts) */
  groundDetail: Live;
  /** the meadow's DOP greenness tint */
  meadowNdvi: Live;
  /** meadow colour on green built-up ground (courtyards, parks) */
  urbanGreen: Live;
  /** the sky-view factor's hold on the ambient light (sky-light.ts) */
  skyView: Live;
  /** the far horizon's cut of the sun (sky-light.ts) */
  horizonShade: Live;
  /** the shadow frustum's centre (data frame x, y) and half-size (z), kept
   *  by the sun rig: where the horizon's near band takes over (sky-light.ts) */
  shadowReach: UniformNode<"vec3", Vector3>;
  /** world (Y-up) sun direction, surface → sun, kept by the sun rig: the
   *  kerb's drawn shadow, the horizon, the water's Fresnel and glitter */
  sunDirection: UniformNode<"vec3", Vector3>;
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
  // Not closed after the upload, unlike the data rasters' bytes: three may
  // upload the image again (a re-created GPU texture reads `image`), and a
  // closed bitmap uploads empty — the ground would turn to class 0. Freed
  // with the texture instead. Rare: only a PNG our decoder rejects lands
  // here.
  texture.addEventListener("dispose", () => {
    bitmap.close();
  });
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

/**
 * Loads the allotment-colony raster (pipeline/bake/cultivated.py, cropped
 * by prepare-data): R = the signed distance to the garden land's edge,
 * G = the colony's axis. LINEAR, so the edge is smooth (the shader fetches
 * the axis texel by texel); no mipmaps (the texture fades out before it
 * would need them). Absent → null and the colonies keep their class colour.
 */
async function loadColonyTexture(
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
 * Loads the road markings (pipeline/bake/markings.py): the index raster
 * (RA = the row, G = lane bits, B = the centre offset; NEAREST) and its
 * table as a 2-texel-high float texture (lib/city/markings.ts). Either
 * absent or undecodable → null and the roads stay unpainted.
 */
async function loadMarkings(
  rasterUrl: string,
  tableUrl: string,
  signal?: AbortSignal
): Promise<{ raster: Texture; table: DataTexture } | null> {
  const doc = await fetchOptionalJson<MarkingTable>(tableUrl, signal);
  if (!doc?.markings) {
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
    const packed = packMarkingTable(doc);
    // A table with no rows still binds a (1-texel) texture: the lane bits
    // need the program, the row lookups never run.
    const table = new DataTexture(
      packed.width > 0 ? packed.data : new Float32Array(8),
      Math.max(packed.width, 1),
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
  /** the look rows and the sun (shared uniform nodes) */
  ground: GroundUniforms;
  /** DOP NDVI raster (LINEAR) for the meadow and urban-green tints */
  ndviTexture?: Texture;
  offset: { cx: number; cy: number };
  /** OSM paving raster (NEAREST, RGBA) for the paving and parking patterns */
  surfaceTexture?: Texture;
  /** baked road/meadow edge distances (LINEAR, RG) for kerbs, lanes, lawns */
  edgesTexture?: Texture;
  /** sports grounds: the index raster (NEAREST, RGBA) and its table */
  sport?: { raster: Texture; table: Texture };
  /** allotment colonies (LINEAR, RG): the garden edge and the axis, and
   *  where the (cropped) raster lies in the tile's uv */
  colonies?: { rect: [number, number, number, number]; texture: Texture };
  /** road markings: the index raster (NEAREST, RGBA) and its table */
  markings?: { raster: Texture; table: Texture };
  /** sky-view factor (LINEAR, R) for the ambient light */
  svfTexture?: Texture;
  /** far horizon, 4 RGBA layers (LINEAR) for the far sun shadow */
  horizonTexture?: Texture;
  /** class-id raster (NEAREST); the meadow detail tests it */
  texture: Texture;
}

/** The tile's size (m) in the data frame. */
const splatSize = (splat: SplatLayer): [number, number] => {
  const [minX, minY, maxX, maxY] = splat.bounds;
  return [maxX - minX, maxY - minY];
};

/**
 * The splat uv at the fragment: from the data-frame XY and the tile bounds
 * (v grows southward) — the terrain geometry carries no uv attribute. The
 * tile's north-west corner is a uniform, so every tile builds the same
 * node code (water-layer.ts reads the splat the same way).
 */
export function splatUv(splat: SplatLayer): V2 {
  const [minX, , , maxY] = splat.bounds;
  const origin = uniform(
    new Vector2(minX - splat.offset.cx, maxY - splat.offset.cy)
  );
  return rasterUv(dataXY(), origin, splatSize(splat));
}

/** The meadow's palette colour, linear — the urban green and grass pavers. */
const MEADOW_LINEAR = LANDCOVER_CLASSES[MEADOW_CLASS].srgb.map(srgbToLinear);

/** The road's palette colour, linear — sealed ground off the carriageway. */
const ROAD_LINEAR = LANDCOVER_CLASSES[ROAD_CLASS].srgb.map(srgbToLinear);

/**
 * The meadow detail the colour writes and the normal reads: the grass
 * normal's weight and the ground detail's accumulated tilt. Named shader
 * variables (`property`), assigned by the colour node — which three builds
 * before the lighting that asks for the normal — so the normal does not
 * recompute the ground detail, the sports grounds' row search with it.
 * Unwritten (no class raster), they read 0.
 */
const grassDetail = property("float", "terrainGrassDetail", float(0));
const groundTilt = property("vec3", "terrainGroundTilt", vec3(0));

/**
 * Meadow (class 1) painterly depth, in the colour node — zero geometry. A
 * value mottle (±~6%) plus a faint shading-normal break-up (`terrainNormal`)
 * so the grazing sun catches texture; the class id comes from the NEAREST
 * class raster, not RGB colour-distance, which would misfire on the
 * forest/copse/farmland greens. Distance-faded via `fwidth` so it never
 * aliases/shimmers in the far field (the failure mode that got plain
 * foliage translucency rejected as "noise").
 */
function grassMottle(inp: GroundInputs, splat: SplatLayer): GroundColour {
  const { xy, cls, fw } = inp;
  const meadow = float(1)
    .sub(step(0.5, abs(cls.sub(MEADOW_CLASS))))
    .toVar();
  const mottle = sin(xy.x.mul(0.85).add(1.3))
    .mul(sin(xy.y.mul(0.78).sub(0.7)))
    .mul(0.7)
    .add(
      sin(xy.x.mul(2.7).sub(0.5))
        .mul(sin(xy.y.mul(2.3).add(1.1)))
        .mul(0.3)
    )
    .toVar();
  const col: GroundColour = {
    baseCol: texture(splat.colorTexture, inp.uv).rgb.toVar(),
    meadow,
    detail: meadow.mul(float(1).sub(smoothstep(0.5, 2.5, fw))).toVar(),
    mottle,
  };
  col.baseCol.mulAssign(mottle.mul(0.035).mul(col.detail).add(1));
  return col;
}

/**
 * Meadow NDVI tint (Wiesenfärbung): on class-1 farmland/meadow only, shift
 * the pastel sage toward lush deep-green where the DOP greenness is high
 * and a drier yellow-tan where it's low — large-area colour variation the
 * flat splat can't give. The NDVI is LINEAR-filtered so the ~2 m raster
 * reads smooth, and a tiny `step` gates out zero/nodata texels (keep the
 * base sage, don't grey out).
 */
function meadowNdvi(
  inp: GroundInputs,
  col: GroundColour,
  ndvi: Texture,
  strength: Live
): void {
  // Read from a coarser mip (a bias of 2.5): the 2 m raster carries every
  // path, tree shadow and bare patch, which painted the meadows in dark
  // flecks. Averaged over ~10 m it is what it should be — broad lush and
  // dry drifts.
  const g = texture(ndvi, inp.uv).bias(float(2.5)).r.toVar();
  const t = smoothstep(0.1, 0.6, g);
  const c = col.baseCol;
  const tint = mix(
    c.mul(vec3(1.08, 1.02, 0.88)), // dry: paler warm hay
    c.mul(vec3(0.84, 1.06, 0.74)), // lush: deeper grass
    t
  );
  c.assign(mix(c, tint, strength.mul(col.meadow).mul(step(0.012, g))));
}

/**
 * Sketch contour lines (2 m minor / 10 m major) on the data-frame elevation,
 * one pixel wide via fwidth. Each set fades out once its lines crowd closer
 * than a few pixels: past that a 1 px line per contour is no longer a line
 * but a grey stipple, and on the gently rolling DGM (streets, meadows, the
 * river surface) it read as dirty blotches across the whole middle distance.
 */
function contourInk(elevation: F): F {
  const set = (step: number, fade: [number, number]): F => {
    const d = elevation.div(step);
    const w = fwidth(d);
    // A flat quad lying exactly on a contour has fwidth 0: 0/0 there
    // striped it with NaN ink (and NaN survives the slope gate's
    // multiply) — the select keeps the 0.
    const line = select(
      w.greaterThan(1e-6),
      float(1).sub(min(abs(fract(d.sub(0.5)).sub(0.5)).div(w), 1)),
      0
    );
    return line.mul(float(1).sub(smoothstep(fade[0], fade[1], w)));
  };
  const minor = set(2, [0.08, 0.2]);
  const major = set(10, [0.06, 0.16]);
  return clamp(minor.mul(0.08).add(major.mul(0.14)), 0, 0.22);
}

/**
 * Where contours mean nothing, drop them: on near-flat ground (a street,
 * a meadow, the river's DGM surface) every centimetre of measurement noise
 * crosses the 2 m level in a squiggle — the lines only belong on real
 * slopes. The slope is the elevation change per metre across the pixel
 * footprint. Under water the ink is gone too (the sheet is translucent, it
 * showed).
 */
function contourGate(inp: GroundInputs, elevation: F, splat: SplatLayer): F {
  const run = max(length(fwidth(inp.xy)), 1e-4);
  const slope = fwidth(elevation).div(run);
  const water = texture(splat.colorTexture, inp.uv).a;
  return smoothstep(0.025, 0.09, slope).mul(
    float(1).sub(smoothstep(0.05, 0.4, water))
  );
}

/** The contour ink's colour, over the ground by the ink's weight. */
const INK = vec3(0.3, 0.33, 0.38);

/**
 * The colour node over the class raster: the palette splat, then — term by
 * term in the order they compose — the meadow mottle, the ground fields,
 * urban green, the ground detail, the allotment gardens, the sports
 * grounds, the road markings, the NDVI tint, and the gated contour ink on
 * top. The optional rasters that did not load leave their term out (a
 * different node graph, so three builds it apart).
 */
function splatColour(splat: SplatLayer): V3 {
  return Fn(() => {
    const uv = splatUv(splat).toVar();
    const xy = dataXY().toVar();
    const inp: GroundInputs = {
      uv,
      xy,
      size: splatSize(splat),
      classTexture: splat.texture,
      fw: max(fwidth(xy.x), fwidth(xy.y)).toVar(),
      cls: floor(texture(splat.texture, uv).r.mul(255).add(0.5)).toVar(),
      groundDetail: splat.ground.groundDetail,
      urbanGreen: splat.ground.urbanGreen,
      sunDirection: splat.ground.sunDirection,
      meadowColor: vec3(MEADOW_LINEAR[0], MEADOW_LINEAR[1], MEADOW_LINEAR[2]),
      roadColor: vec3(ROAD_LINEAR[0], ROAD_LINEAR[1], ROAD_LINEAR[2]),
    };
    const col = grassMottle(inp, splat);
    const g = groundFields(inp, splat.surfaceTexture, splat.edgesTexture);
    const ugW = urbanGreen(inp, col, g, splat.ndviTexture);
    groundDetail(inp, col, g, ugW);
    if (splat.colonies) {
      const { rect, texture: raster } = splat.colonies;
      colonyGarden(inp, col, g, {
        rect: uniform(new Vector4(...rect)),
        texture: raster,
      });
    }
    if (splat.sport) {
      sportGround(inp, col, g, splat.sport);
    }
    if (splat.markings) {
      roadMarkings(inp, col, g, splat.markings);
    }
    if (splat.ndviTexture) {
      meadowNdvi(inp, col, splat.ndviTexture, splat.ground.meadowNdvi);
    }
    grassDetail.assign(col.detail);
    groundTilt.assign(g.tilt);
    const elevation = positionWorld.y;
    const ink = contourInk(elevation).mul(contourGate(inp, elevation, splat));
    return mix(col.baseCol, INK, ink);
  })();
}

/** The flat sage ground with its contour ink (no class raster). */
function plainColour(): V3 {
  return mix(vec3(materialColor), INK, contourInk(positionWorld.y));
}

/**
 * The ground's shading normal (view space). Calm first: the DGM1 carries
 * every kerb, rut and survey wobble, and the baked normals are quantised to
 * 8 bits, so lit by a low sun a street, a meadow or a quay reads as coarse
 * dark-and-light flecks — "dirty" rather than drawn. Near-flat normals
 * (under ~12°) are pulled to straight up, keeping a trace of the relief;
 * real slopes (embankments, the valley sides) keep their full shading, and
 * the contour ink carries the rest of the terrain's form. With the class
 * raster, then the meadow-only break-up and the kerbs', lawn edges' and
 * stones' tilt (the colour node's `terrainGrassDetail`/`terrainGroundTilt`).
 */
function terrainNormal(withDetail: boolean): V3 {
  return Fn(() => {
    const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
    const keep = float(1).sub(smoothstep(0.93, 0.985, dot(normalView, up)));
    const calm = normalize(mix(up, normalView, max(keep, 0.12)));
    if (!withDetail) {
      return calm;
    }
    const xy = dataXY();
    const ax = xy.x.mul(0.85).add(1.3);
    const ay = xy.y.mul(0.78).sub(0.7);
    const gx = cos(ax).mul(sin(ay)).mul(0.85);
    const gy = sin(ax).mul(cos(ay)).mul(0.78);
    const grass = normalize(
      calm.add(vec3(gx, gy, 0).mul(grassDetail.mul(0.06)))
    );
    return groundNormal(grass, groundTilt);
  })();
}

/**
 * Light paper-sage ground with sketch-style contour lines (2 m minor / 10 m
 * major), on the data-frame elevation derived from world space. When a
 * `splat` is given, the base colour comes from the ATKIS land-cover at each
 * fragment (streets, water, meadow, …) instead of the flat sage, with the
 * ground's detail over it (`splatColour`); the contour ink is composited on
 * top. The city's large-scale light (sky-light.ts) folds in last: the sky
 * view on the ambient term, the far horizon on the sun.
 */
export function createTerrainMaterial(
  splat?: SplatLayer
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  material.colorNode = splat ? splatColour(splat) : plainColour();
  material.normalNode = terrainNormal(splat !== undefined);
  applyGroundLight(material, splat ? groundLightOf(splat) : undefined);
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
  markings: { raster: Texture; table: DataTexture } | null;
  colonies: { rect: [number, number, number, number]; texture: Texture } | null;
  /** the shared horizon's URL while this tile holds it */
  horizon: { texture: Texture | null; url: string } | null;
  /** the shared sky view's URL while this tile holds it */
  svf: { texture: Texture | null; url: string } | null;
  ndviTexture: Texture | null;
  sport: { raster: Texture; table: DataTexture } | null;
  surfaceTexture: Texture | null;
}

const NO_DETAIL: DetailRasters = {
  ndviTexture: null,
  surfaceTexture: null,
  edgesTexture: null,
  sport: null,
  markings: null,
  colonies: null,
  horizon: null,
  svf: null,
};

/** The loaded rasters as the splat's optional members (absent → unset). */
function splatDetail(d: DetailRasters): Partial<SplatLayer> {
  return {
    ndviTexture: d.ndviTexture ?? undefined,
    surfaceTexture: d.surfaceTexture ?? undefined,
    edgesTexture: d.edgesTexture ?? undefined,
    sport: d.sport ?? undefined,
    markings: d.markings ?? undefined,
    colonies: d.colonies ?? undefined,
    svfTexture: d.svf?.texture ?? undefined,
    horizonTexture: d.horizon?.texture ?? undefined,
  };
}

/** Frees a tile's rasters; the shared sky view and horizon are released,
 *  not freed. */
function disposeDetail(d: DetailRasters, opts: TerrainOptions): void {
  for (const texture of [
    d.ndviTexture,
    d.surfaceTexture,
    d.edgesTexture,
    d.sport?.raster,
    d.sport?.table,
    d.markings?.raster,
    d.markings?.table,
    d.colonies?.texture,
  ]) {
    texture?.dispose();
  }
  if (d.horizon) {
    opts.horizon?.release(d.horizon.url);
  }
  if (d.svf) {
    opts.skyView?.release(d.svf.url);
  }
}

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
  // Road markings: close-range paint, the fine level only; phones read the
  // 1024² twin (the same table).
  const markingsRaster = url(
    (opts.lowRasters ? extras.markingsLow : undefined) ?? extras.markings
  );
  const markingsTable = url(extras.markingsTable);
  const markings =
    markingsRaster && markingsTable
      ? await loadMarkings(markingsRaster, markingsTable, opts.signal)
      : null;
  // Allotment colonies: the fine level only, phones the half-resolution
  // twin of the same crop.
  const colonies = url(
    (opts.lowRasters ? extras.cultivatedLow : undefined) ?? extras.cultivated
  );
  const colonyTexture = colonies
    ? await loadColonyTexture(colonies, opts.signal)
    : null;
  // Last, the shared rasters: an acquire never throws and nothing after it
  // can, so the references are always released.
  const horizonUrl = url(extras.horizon);
  const horizon =
    horizonUrl && opts.horizon
      ? { url: horizonUrl, texture: await opts.horizon.acquire(horizonUrl) }
      : null;
  const svfUrl = url(extras.svf);
  const svf =
    svfUrl && opts.skyView
      ? { url: svfUrl, texture: await opts.skyView.acquire(svfUrl) }
      : null;
  return {
    ndviTexture,
    surfaceTexture,
    edgesTexture,
    sport,
    markings,
    colonies: colonyTexture
      ? { texture: colonyTexture, rect: colonyCropUv(extras.cultivatedCrop) }
      : null,
    horizon,
    svf,
  };
}

/** The splat's baked light as the fine level's kerbs, fences, stairs and
 *  walls bind it (the same textures and rows, by reference). */
function groundLightOf(splat: SplatLayer): GroundLight | undefined {
  const { ground } = splat;
  if (!(splat.svfTexture || splat.horizonTexture)) {
    return undefined;
  }
  const [minX, , , maxY] = splat.bounds;
  return {
    svf: splat.svfTexture,
    horizon: splat.horizonTexture,
    origin: [minX - splat.offset.cx, maxY - splat.offset.cy],
    size: splatSize(splat),
    skyView: ground.skyView,
    horizonShade: ground.horizonShade,
    shadowReach: ground.shadowReach,
    sunDirection: ground.sunDirection,
  };
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
  const detail = classRaster
    ? await loadDetailRasters(extras, opts)
    : NO_DETAIL;
  const splat: SplatLayer | undefined =
    classRaster && painted
      ? {
          texture: classRaster.texture,
          colorTexture: painted.texture,
          ...splatDetail(detail),
          ground: opts.ground,
          bounds,
          offset: opts.offset,
        }
      : undefined;

  mesh.material = createTerrainMaterial(splat);
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
    ? createWaterLayer(waterGeometry, splat, opts.fogColor)
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
    light: splat ? groundLightOf(splat) : undefined,
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
      classRaster?.texture.dispose();
      disposeDetail(detail, opts);
      painted?.dispose();
    },
  };
}
