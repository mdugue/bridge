/**
 * Bakes one DGM GeoTIFF into the heightfield the viewer loads
 * (lib/city/heightfield.ts): a bilinear n×n resample of the raster, quantised
 * to centimetre uint16 and gzipped, plus the header the client parses. The
 * browser used to fetch each tile's 13.6 MB GeoTIFF and resample it on the
 * main thread (~0.6 s per tile, ×4 tiles); doing it here leaves the client
 * with a header plus a grid it dequantises in one pass. Called by
 * scripts/prepare-data.ts, which owns the paths, the cache and the publish
 * step; no DOM, no filesystem.
 */
import { gzipSync } from "node:zlib";
import { fromArrayBuffer } from "geotiff";
import {
  encodeHeightfield,
  HEIGHTFIELD_VERSION,
  type HeightfieldHeader,
} from "../lib/city/heightfield";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { tfwToBounds } from "../lib/city/tfw";

export interface BakedHeightfield {
  /** the gzipped centimetre uint16 grid (the `.u16.gz` artifact) */
  data: Buffer;
  /** the header minus its `data` sibling name, which the publisher assigns */
  header: Omit<HeightfieldHeader, "data">;
  /** the source raster's size, for the log line */
  source: { height: number; width: number };
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
 * The raster's georeferenced bounds. geotiff.js cannot read .tfw sidecars, so
 * when a GeoTIFF carries no embedded geotransform the sidecar's text is
 * parsed instead — and a tile with neither fails loudly rather than being
 * silently misplaced.
 */
function resolveBounds(
  embedded: number[] | null,
  width: number,
  height: number,
  tfw: string | null
): TerrainBounds {
  if (embedded && !isPixelSpaceBounds(embedded, width, height)) {
    return embedded as TerrainBounds;
  }
  if (tfw !== null) {
    return tfwToBounds(tfw, width, height);
  }
  throw new Error(
    "DGM GeoTIFF has no embedded georeferencing and no readable .tfw sidecar. " +
      "Embed it with: gdal_translate -a_srs EPSG:25833 in.tif out.tif"
  );
}

/**
 * Resamples the GeoTIFF in `tif` to an n×n grid and encodes it. `tfw` is the
 * sidecar's text when one exists (null otherwise); it is only consulted when
 * the GeoTIFF carries no georeferencing of its own.
 */
export async function bakeHeightfield(
  tif: ArrayBuffer,
  tfw: string | null,
  n: number
): Promise<BakedHeightfield> {
  const tiff = await fromArrayBuffer(tif);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  let embedded: number[] | null = null;
  try {
    embedded = image.getBoundingBox();
  } catch {
    embedded = null;
  }
  const bounds = resolveBounds(embedded, width, height, tfw);
  const raster = await image.readRasters({
    width: n,
    height: n,
    samples: [0],
    interleave: true,
    resampleMethod: "bilinear",
  });
  if (!ArrayBuffer.isView(raster)) {
    throw new Error("unexpected raster shape (expected one interleaved band)");
  }
  // reason: geotiff types the result as TypedArray | TypedArray[]; isView narrowed it above
  const encoded = encodeHeightfield(
    raster as unknown as ArrayLike<number>,
    image.getGDALNoData()
  );
  return {
    header: {
      version: HEIGHTFIELD_VERSION,
      n,
      bounds,
      zMin: encoded.zMin,
      zScale: encoded.zScale,
    },
    // Pre-gzipped: static hosts don't compress binary MIME types, and the
    // browser inflates it natively (DecompressionStream) — see heightfield.ts.
    data: gzipSync(Buffer.from(encoded.samples.buffer)),
    source: { width, height },
  };
}
