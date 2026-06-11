import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from "three";
import {
  buildTerrainGeometryData,
  sampleHeightfield,
  type TerrainBounds,
} from "@/lib/city/terrain-geometry";
import { tfwToBounds } from "@/lib/city/tfw";

/** Downsample target (N x N). 512 is plenty for a POC. */
const DEFAULT_TARGET_SIZE = 512;

export interface TerrainLayer {
  /** [minX, minY, maxX, maxY] in the projected CRS */
  bounds: TerrainBounds;
  /** bilinear elevation lookup at projected (not recentered) coordinates */
  heightAt: (x: number, y: number) => number | null;
  mesh: Mesh;
  vertexCount: number;
}

export interface TerrainOptions {
  /** recenter offset shared with the city layer */
  offset: { cx: number; cy: number };
  /** aborts the raster download */
  signal?: AbortSignal;
  targetSize?: number;
  /** .tfw sidecar fallback, used only when the GeoTIFF has no embedded georef */
  tfwUrl?: string;
  url: string;
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

  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ color: 0x6b_7a_4f, roughness: 1 })
  );
  mesh.name = "terrain";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    mesh,
    vertexCount: positions.length / 3,
    bounds,
    heightAt: (x, y) =>
      sampleHeightfield({ elevations, n, bounds, nodata }, x, y),
  };
}
